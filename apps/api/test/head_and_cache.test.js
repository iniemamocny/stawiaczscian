import request from 'supertest';
import assert from 'assert';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

let tmpDir;
let serverProc;
let baseUrl;

before(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'api-test-'));
  const uploadDir = path.join(tmpDir, 'uploads');
  const storageDir = path.join(tmpDir, 'storage');
  await fs.mkdir(uploadDir);
  await fs.mkdir(storageDir);

  const env = {
    ...process.env,
    UPLOAD_DIR: uploadDir,
    STORAGE_DIR: storageDir,
    API_TOKEN: 'testtoken',
    BLENDER_PATH: path.join(tmpDir, 'mock_blender.js'),
    NODE_ENV: 'cache-test',
    SKIP_FILETYPE_CHECK: '1',
    PORT: '5001',
  };

  const blenderMock = `#!/usr/bin/env node\nconst fs=require('fs');\nconst path=require('path');\nconst args=process.argv.slice(2);\nif(args[0]==='--version') process.exit(0);\nconst out=args[args.length-1];\nfs.mkdirSync(path.dirname(out),{recursive:true});\nfs.writeFileSync(out,'x');\n`;
  await fs.writeFile(env.BLENDER_PATH, blenderMock);
  await fs.chmod(env.BLENDER_PATH, 0o755);

  const serverPath = fileURLToPath(new URL('../server.js', import.meta.url));
  serverProc = spawn('node', [serverPath], {
    env,
    cwd: path.dirname(serverPath),
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  await new Promise(resolve => serverProc.stdout.once('data', resolve));
  baseUrl = 'http://127.0.0.1:' + env.PORT;
});

after(async () => {
  serverProc.kill();
  await new Promise(r => serverProc.on('exit', r));
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('HEAD and caching for room.glb', () => {
  it('returns matching headers and supports conditional requests', async () => {
    const uploadRes = await request(baseUrl)
      .post('/api/scans')
      .set('Authorization', 'Bearer testtoken')
      .attach('file', Buffer.from('data'), {
        filename: 'model.obj',
        contentType: 'application/octet-stream',
      });

    assert.equal(uploadRes.status, 202);
    const id = uploadRes.body.id;

    let status = 'pending';
    let pollRes;
    for (let i = 0; i < 50 && status === 'pending'; i++) {
      pollRes = await request(baseUrl)
        .get(`/api/scans/${id}`)
        .set('Authorization', 'Bearer testtoken');
      status = pollRes.body.status || 'pending';
      if (status === 'pending') await new Promise(r => setTimeout(r, 20));
    }
    assert.equal(pollRes.body.status, 'done');

    const getRes = await request(baseUrl)
      .get(`/api/scans/${id}/room.glb`)
      .set('Authorization', 'Bearer testtoken');
    assert.equal(getRes.status, 200);
    const etag = getRes.headers.etag;
    const lastMod = getRes.headers['last-modified'];
    assert.ok(etag);
    assert.ok(lastMod);

    const headRes = await request(baseUrl)
      .head(`/api/scans/${id}/room.glb`)
      .set('Authorization', 'Bearer testtoken');
    assert.equal(headRes.status, 200);
    assert.equal(headRes.headers.etag, etag);
    assert.equal(headRes.headers['last-modified'], lastMod);

    const condRes = await request(baseUrl)
      .get(`/api/scans/${id}/room.glb`)
      .set('Authorization', 'Bearer testtoken')
      .set('If-None-Match', etag)
      .set('If-Modified-Since', lastMod);
    assert.equal(condRes.status, 304);
  });
});

