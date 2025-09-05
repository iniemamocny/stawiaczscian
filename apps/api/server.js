
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

app.use((req, res, next) => {
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ')) return res.status(401).json({ error: 'no token' });
  next();
});

app.post('/api/scans', upload.single('file'), async (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'no file' });

    const id = randomUUID();
    const inputPath = file.path;
    const outDir = path.join('storage', id);
    fs.mkdirSync(outDir, { recursive: true });
    const glbPath = path.join(outDir, 'room.glb');

    const blender = process.env.BLENDER_PATH || 'blender';
    const script = path.resolve('./convert_blender.py');
    const args = ['-b','-P',script,'--', path.resolve(inputPath), path.resolve(glbPath)];
    console.log('[BLENDER]', blender, args.join(' '));

    const p = spawn(blender, args, { stdio: 'inherit' });
    p.on('error', e => { console.error('Spawn error:', e); try { res.status(500).json({ error: 'spawn failed', detail: String(e) }); } catch {} });
    p.on('exit', code => {
      if (code === 0 && fs.existsSync(glbPath)) res.json({ id, url: `/api/scans/${id}/room.glb` });
      else res.status(500).json({ error: 'conversion failed', code });
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'server error' });
  }
});

app.get('/api/scans/:id/room.glb', (req, res) => {
  const p = path.join('storage', req.params.id, 'room.glb');
  if (fs.existsSync(p)) {
    res.setHeader('Content-Type','model/gltf-binary');
    fs.createReadStream(p).pipe(res);
  } else res.status(404).json({ error: 'not found' });
});

const port = process.env.PORT || 4000;
app.listen(port, () => console.log('API on http://localhost:' + port));
