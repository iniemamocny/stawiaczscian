
import express from 'express';
import multer from 'multer';
import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import path from 'path';
import fs from 'fs';
import cors from 'cors';
import 'dotenv/config';

const app = express();
app.use(cors());
const upload = multer({ dest: 'uploads/' });

const storageDir = process.env.STORAGE_DIR || 'storage';
const maxFileAgeMs = parseInt(
  process.env.STORAGE_MAX_AGE_MS || String(24 * 60 * 60 * 1000),
  10
);

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

setInterval(cleanOldFiles, 60 * 60 * 1000);
cleanOldFiles();

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

    const rawMeta = req.body.meta;
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

    const id = randomUUID();
    const inputPath = file.path;
    const outDir = path.join(storageDir, id);
    await fs.promises.mkdir(outDir, { recursive: true });
    const glbPath = path.join(outDir, 'room.glb');

    if (meta) {
      await fs.promises.writeFile(
        path.join(outDir, 'info.json'),
        JSON.stringify(meta, null, 2)
      );
    }

    const blender = process.env.BLENDER_PATH || 'blender';
    const script = path.resolve('./convert_blender.py');
    const args = ['-b','-P',script,'--', path.resolve(inputPath), path.resolve(glbPath)];
    console.log('[BLENDER]', blender, args.join(' '));

    const p = spawn(blender, args, { stdio: 'inherit' });
    p.on('error', e => { console.error('Spawn error:', e); try { res.status(500).json({ error: 'spawn failed', detail: String(e) }); } catch {} });
    p.on('exit', async code => {
      if (code === 0) {
        try {
          await fs.promises.access(glbPath);
          res.json({ id, url: `/api/scans/${id}/room.glb` });
        } catch {
          res.status(500).json({ error: 'conversion failed', code });
        }
      } else {
        res.status(500).json({ error: 'conversion failed', code });
      }
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'server error' });
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
    fs.createReadStream(filePath).pipe(res);
  } catch {
    res.status(404).json({ error: 'not found' });
  }
});

const port = process.env.PORT || 4000;
app.listen(port, () => console.log('API on http://localhost:' + port));
