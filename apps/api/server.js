
import express from 'express';
import multer from 'multer';
import { spawn } from 'child_process';
import { randomUUID, createHash } from 'crypto';
import path from 'path';
import fs from 'fs';
import { pipeline } from 'stream/promises';
import cors from 'cors';
import helmet from 'helmet';
import 'dotenv/config';
import PQueue from 'p-queue';
import { fileTypeFromFile } from 'file-type';
import rateLimit from 'express-rate-limit';
import morgan from 'morgan';

function parsePositiveInt(value, fallback) {
  const parsed = parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    console.warn(`Invalid value "${value}"; using default ${fallback}`);
    return fallback;
  }
  return parsed;
}

const uploadDir = path.resolve(process.env.UPLOAD_DIR || 'uploads');
const storageDir = path.resolve(process.env.STORAGE_DIR || 'storage');
const isTest = process.env.NODE_ENV === 'test';

async function initDirs() {
  await fs.promises.mkdir(uploadDir, { recursive: true });
  await fs.promises.mkdir(storageDir, { recursive: true });
}

async function verifyBlender() {
  const blender = process.env.BLENDER_PATH || 'blender';
  await new Promise((resolve, reject) => {
    const p = spawn(blender, ['--version'], { stdio: 'ignore' });
    p.on('error', err => reject(err));
    p.on('exit', code => {
      if (code === 0) resolve();
      else reject(new Error('Blender exited with code ' + code));
    });
  });
}

const app = express();
app.use(morgan(process.env.LOG_FORMAT || 'combined'));
await initDirs();
try {
  await verifyBlender();
} catch (e) {
  console.error('Blender check failed', e);
  process.exit(1);
}
const RETRY_AFTER_SECONDS = 60;
const rateLimitWindowMs = RETRY_AFTER_SECONDS * 1000;
app.use(
  rateLimit({
    windowMs: rateLimitWindowMs,
    max: 30,
    handler: (req, res) => {
      res.setHeader('Retry-After', String(RETRY_AFTER_SECONDS));
      res.status(429).json({ error: 'too many requests' });
    },
  })
);
app.use(helmet());
app.use(cors({ origin: process.env.ALLOWED_ORIGINS?.split(',') }));
const upload = multer({
  dest: uploadDir,
  limits: {
    fileSize: parsePositiveInt(process.env.MAX_UPLOAD_BYTES, 52428800),
  },
});

const maxFileAgeMs = parsePositiveInt(
  process.env.STORAGE_MAX_AGE_MS,
  24 * 60 * 60 * 1000
);

const concurrency = parsePositiveInt(process.env.CONCURRENCY, 2);
const queueLimit = parsePositiveInt(process.env.QUEUE_LIMIT, 10);
const queue = new PQueue({ concurrency });

async function cleanOldFiles() {
  try {
    const entries = await fs.promises.readdir(storageDir, {
      withFileTypes: true,
    });
    const now = Date.now();
    for (const entry of entries) {
      const fullPath = path.join(storageDir, entry.name);
      const stat = await fs.promises.stat(fullPath);
      if (now - stat.mtimeMs > maxFileAgeMs) {
        await fs.promises.rm(fullPath, { recursive: true, force: true });
      }
    }
  } catch (e) {
    if (e.code !== 'ENOENT') console.error('cleanup error', e);
  }
}

async function cleanupUploads() {
  try {
    const entries = await fs.promises.readdir(uploadDir, { withFileTypes: true });
    let count = 0;
    for (const entry of entries) {
      await fs.promises.rm(path.join(uploadDir, entry.name), { recursive: true, force: true });
      count++;
    }
    console.log(`cleanupUploads: removed ${count} file(s)`);
  } catch (e) {
    if (e.code !== 'ENOENT') console.error('cleanup uploads error', e);
  }
}

if (!isTest) {
  setInterval(cleanOldFiles, 60 * 60 * 1000);
  setInterval(cleanupUploads, 60 * 60 * 1000);
  cleanOldFiles();
  cleanupUploads();
}

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.use((req, res, next) => {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return res.status(401).json({ error: 'no token' });
  if (token !== process.env.API_TOKEN) {
    return res.status(401).json({ error: 'invalid token' });
  }
  next();
});

app.post('/api/scans', upload.single('file'), async (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'no file' });
    if (queue.size + queue.pending >= queueLimit) {
      await fs.promises.unlink(file.path).catch(() => {});
      res.setHeader('Retry-After', String(RETRY_AFTER_SECONDS));
      return res.status(429).json({ error: 'too many requests' });
    }
    const ext = path.extname(file.originalname).toLowerCase();
    const allowedFormats = {
      '.obj': ['text/plain', 'application/octet-stream', 'model/obj'],
      '.ply': ['application/octet-stream', 'model/x-ply'],
      '.usd': ['application/octet-stream', 'model/vnd.usd', 'application/usd'],
      '.usda': ['application/octet-stream', 'model/vnd.usd', 'application/usd'],
      '.usdz': ['model/vnd.usdz+zip', 'application/octet-stream'],
    };
    const allowedMimes = allowedFormats[ext];
    if (!allowedMimes || !allowedMimes.includes(file.mimetype)) {
      await fs.promises.unlink(file.path).catch(() => {});
      return res.status(400).json({ error: 'invalid file type' });
    }

    const detected = isTest
      ? { mime: file.mimetype }
      : await fileTypeFromFile(file.path).catch(() => null);
    if (!detected || !allowedMimes.includes(detected.mime)) {
      await fs.promises.unlink(file.path).catch(() => {});
      return res.status(400).json({ error: 'invalid file type' });
    }

    const rawMeta = req.body.meta;
    const maxMetaBytes = parseInt(process.env.MAX_META_BYTES || '16384', 10);
    if (typeof rawMeta === 'string' && rawMeta.length > maxMetaBytes) {
      await fs.promises.unlink(file.path).catch(() => {});
      return res.status(400).json({ error: 'metadata too large' });
    }
    let meta;
    if (typeof rawMeta === 'string') {
      try {
        meta = JSON.parse(rawMeta);
      } catch {
        try {
          meta = Object.fromEntries(new URLSearchParams(rawMeta));
        } catch {}
      }
    }
    if (meta && Buffer.byteLength(JSON.stringify(meta)) > maxMetaBytes) {
      await fs.promises.unlink(file.path).catch(() => {});
      return res.status(400).json({ error: 'metadata too large' });
    }

    const id = randomUUID();
    const outDir = path.join(storageDir, id);
    await fs.promises.mkdir(outDir, { recursive: true });

    const inputPath = path.join(outDir, 'input' + ext);
    await fs.promises.rename(file.path, inputPath);

    const infoPath = path.join(outDir, 'info.json');
    const info = { status: 'pending', filename: 'room.glb' };
    if (meta) {
      if (meta.filename) info.filename = String(meta.filename);
      info.meta = meta;
    }
    await fs.promises.writeFile(infoPath, JSON.stringify(info, null, 2));

    queue.add(async () => {
      const glbPath = path.join(outDir, 'room.glb');
      try {
        const blender = process.env.BLENDER_PATH || 'blender';
        const script = path.join(
          path.dirname(new URL(import.meta.url).pathname),
          'convert_blender.py'
        );
        const args = ['-b', '-P', script, '--', path.resolve(inputPath), path.resolve(glbPath)];
        console.log('[BLENDER]', blender, args.join(' '));

        await new Promise((resolve, reject) => {
          const p = spawn(blender, args, { stdio: 'inherit' });
          p.on('error', e => reject(e));
          p.on('exit', async code => {
            if (code === 0) {
              try {
                await fs.promises.access(glbPath);
                const etag = await new Promise((resolveHash, rejectHash) => {
                  const hash = createHash('sha1');
                  const s = fs.createReadStream(glbPath);
                  s.on('error', rejectHash);
                  s.on('data', chunk => hash.update(chunk));
                  s.on('end', () => resolveHash('"' + hash.digest('hex') + '"'));
                });
                info.status = 'done';
                info.etag = etag;
                resolve();
              } catch {
                reject(new Error('conversion failed'));
              }
            } else {
              reject(new Error('conversion failed'));
            }
          });
        });
      } catch (e) {
        console.error(e);
        info.status = 'error';
      } finally {
        await fs.promises
          .writeFile(infoPath, JSON.stringify(info, null, 2))
          .catch(() => {});
        fs.promises.unlink(inputPath).catch(() => {});
      }
    });

    res.setHeader('Location', `/api/scans/${id}`);
    return res.status(202).json({ id });
  } catch (e) {
    console.error(e);
    if (!res.headersSent) {
      res.status(500).json({ error: 'server error' });
    }
  }
});


app.get('/api/scans/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!/^[0-9a-f-]{36}$/.test(id)) {
      return res.status(400).json({ error: 'invalid id' });
    }

    const baseDir = path.resolve(storageDir);
    const infoPath = path.resolve(baseDir, id, 'info.json');
    if (!infoPath.startsWith(baseDir + path.sep)) {
      return res.status(403).json({ error: 'forbidden' });
    }

    const data = await fs.promises.readFile(infoPath, 'utf8');
    const info = JSON.parse(data);
    const result = { status: info.status || 'pending' };
    const base = `${req.protocol}://${req.get('host')}`;
    if (result.status === 'done') {
      result.url = `${base}/api/scans/${id}/room.glb`;
    }
    res.json(result);
  } catch (e) {
    if (e.code === 'ENOENT') {
      res.status(404).json({ error: 'not found' });
    } else {
      res.status(500).json({ error: 'server error' });
    }
  }
});

app.get('/api/scans/:id/info', async (req, res) => {
  try {
    const { id } = req.params;
    if (!/^[0-9a-f-]{36}$/.test(id)) {
      return res.status(400).json({ error: 'invalid id' });
    }

    const baseDir = path.resolve(storageDir);
    const filePath = path.resolve(baseDir, id, 'info.json');
    if (!filePath.startsWith(baseDir + path.sep)) {
      return res.status(403).json({ error: 'forbidden' });
    }

    const data = await fs.promises.readFile(filePath, 'utf8');
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
    res.send(data);
  } catch (e) {
    if (e.code === 'ENOENT') {
      res.status(404).json({ error: 'not found' });
    } else {
      res.status(500).json({ error: 'server error' });
    }
  }
});

app.get('/api/scans/:id/room.glb', async (req, res) => {
  try {
    const { id } = req.params;
    if (!/^[0-9a-f-]{36}$/.test(id)) {
      return res.status(400).json({ error: 'invalid id' });
    }

    const baseDir = path.resolve(storageDir);
    const filePath = path.resolve(baseDir, id, 'room.glb');
    if (!filePath.startsWith(baseDir + path.sep)) {
      return res.status(403).json({ error: 'forbidden' });
    }

    await fs.promises.access(filePath);

    const infoPath = path.resolve(baseDir, id, 'info.json');
    let info = {};
    try {
      info = JSON.parse(await fs.promises.readFile(infoPath, 'utf8'));
    } catch {}
    let etag = info.etag;
    if (!etag) {
      etag = await new Promise((resolve, reject) => {
        const hash = createHash('sha1');
        const s = fs.createReadStream(filePath);
        s.on('error', reject);
        s.on('data', chunk => hash.update(chunk));
        s.on('end', () => resolve('"' + hash.digest('hex') + '"'));
      });
      info.etag = etag;
      if (!info.status) info.status = 'done';
      await fs.promises
        .writeFile(infoPath, JSON.stringify(info, null, 2))
        .catch(() => {});
    }

    res.setHeader('ETag', etag);

    if (req.headers['if-none-match'] === etag) {
      return res.status(304).end();
    }

    res.setHeader('Content-Type', 'model/gltf-binary');
    res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
    const filename = info.filename || 'room.glb';
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    const stream = fs.createReadStream(filePath);
    stream.on('error', err => {
      if (!res.headersSent) {
        if (err.code === 'ENOENT') {
          res.status(404).json({ error: 'not found' });
        } else {
          res.status(500).json({ error: 'server error' });
        }
      }
    });

    await pipeline(stream, res);
  } catch (e) {
    if (!res.headersSent) {
      if (e.code === 'ENOENT') {
        res.status(404).json({ error: 'not found' });
      } else {
        res.status(500).json({ error: 'server error' });
      }
    }
  }
});

app.delete('/api/scans/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!/^[0-9a-f-]{36}$/.test(id)) {
      return res.status(400).json({ error: 'invalid id' });
    }

    const baseDir = path.resolve(storageDir);
    const dirPath = path.resolve(baseDir, id);
    if (!dirPath.startsWith(baseDir + path.sep)) {
      return res.status(403).json({ error: 'forbidden' });
    }

    await fs.promises.access(dirPath);
    await fs.promises.rm(dirPath, { recursive: true, force: true });
    res.status(204).end();
  } catch (e) {
    if (e.code === 'ENOENT') {
      res.status(404).json({ error: 'not found' });
    } else {
      res.status(500).json({ error: 'server error' });
    }
  }
});

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'file too large' });
  }
  next(err);
});

const port = process.env.PORT || 4000;
let server;
if (!isTest) {
  server = app.listen(port, () =>
    console.log('API on http://localhost:' + port)
  );

  const shutdown = async () => {
    queue.clear();
    try {
      await Promise.all([cleanupUploads(), cleanOldFiles()]);
    } finally {
      process.exit(0);
    }
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

export default app;
export { server };
