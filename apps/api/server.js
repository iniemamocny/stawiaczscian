
import express from 'express';
import multer from 'multer';
import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import path from 'path';
import fs from 'fs';
import { pipeline } from 'stream/promises';
import cors from 'cors';
import helmet from 'helmet';
import 'dotenv/config';
import PQueue from 'p-queue';
import FileType from 'file-type';
import rateLimit from 'express-rate-limit';

function parsePositiveInt(value, fallback) {
  const parsed = parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    console.warn(`Invalid value "${value}"; using default ${fallback}`);
    return fallback;
  }
  return parsed;
}

const app = express();
app.use(rateLimit({ windowMs: 60 * 1000, max: 30 }));
app.use(helmet());
app.use(cors({ origin: process.env.ALLOWED_ORIGINS?.split(',') }));
const uploadDir = path.resolve(process.env.UPLOAD_DIR || 'uploads');
const storageDir = path.resolve(process.env.STORAGE_DIR || 'storage');
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

setInterval(cleanOldFiles, 60 * 60 * 1000);
setInterval(cleanupUploads, 60 * 60 * 1000);
cleanOldFiles();
cleanupUploads();

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

    const detected = await FileType.fromFile(file.path).catch(() => null);
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

    await queue.add(async () => {
      const id = randomUUID();
      const inputPath = file.path;
      const outDir = path.join(storageDir, id);
      const glbPath = path.join(outDir, 'room.glb');

      try {
        await fs.promises.mkdir(outDir, { recursive: true });

        if (meta) {
          await fs.promises.writeFile(
            path.join(outDir, 'info.json'),
            JSON.stringify(meta, null, 2)
          );
        }

        const blender = process.env.BLENDER_PATH || 'blender';
        const script = path.resolve('./convert_blender.py');
        const args = ['-b', '-P', script, '--', path.resolve(inputPath), path.resolve(glbPath)];
        console.log('[BLENDER]', blender, args.join(' '));

        await new Promise((resolve, reject) => {
          const p = spawn(blender, args, { stdio: 'inherit' });
          p.on('error', e => reject(e));
          p.on('exit', async code => {
            if (code === 0) {
              try {
                await fs.promises.access(glbPath);
                const base = `${req.protocol}://${req.get('host')}`;
                res.json({ id, url: `${base}/api/scans/${id}/room.glb` });
                resolve();
              } catch {
                reject(new Error('conversion failed'));
              }
            } else {
              reject(new Error('conversion failed'));
            }
          });
        });
      } finally {
        fs.promises.unlink(inputPath).catch(() => {});
      }
    });
  } catch (e) {
    console.error(e);
    if (!res.headersSent) {
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
    res.setHeader('Content-Type', 'model/gltf-binary');

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

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'file too large' });
  }
  next(err);
});

const port = process.env.PORT || 4000;
app.listen(port, () => console.log('API on http://localhost:' + port));

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
