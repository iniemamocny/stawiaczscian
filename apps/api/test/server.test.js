import request from 'supertest';
import assert from 'assert';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { randomUUID } from 'crypto';

let app;
let tmpDir;

before(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'api-test-'));
  const uploadDir = path.join(tmpDir, 'uploads');
  const storageDir = path.join(tmpDir, 'storage');
  await fs.mkdir(uploadDir);
  await fs.mkdir(storageDir);
  process.env.UPLOAD_DIR = uploadDir;
  process.env.STORAGE_DIR = storageDir;
  process.env.API_TOKEN = 'testtoken';
  process.env.BLENDER_PATH = path.join(tmpDir, 'mock_blender.js');
  process.env.NODE_ENV = 'test';

  const blenderMock = `#!/usr/bin/env node\nimport fs from 'fs';\nconst args = process.argv.slice(2);\nif (args[0] === '--version') process.exit(0);\nconst out = args[args.length - 1];\nfs.writeFileSync(out, '');\n`;
  await fs.writeFile(process.env.BLENDER_PATH, blenderMock);
  await fs.chmod(process.env.BLENDER_PATH, 0o755);

  app = (await import('../server.js')).default;
});

after(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('API server', () => {
  it('rejects request without token', async () => {
    await request(app).get('/api/scans/some').expect(401);
  });

  it('uploads file and processes asynchronously', async () => {
    const res = await request(app)
      .post('/api/scans')
      .set('Authorization', 'Bearer testtoken')
      .attach('file', Buffer.from('data'), {
        filename: 'model.obj',
        contentType: 'application/octet-stream',
      });

    assert.equal(res.status, 202);
    assert.match(res.body.id, /^[0-9a-f-]{36}$/);
    assert.equal(res.headers.location, `/api/scans/${res.body.id}`);

    let status = 'pending';
    let pollRes;
    for (let i = 0; i < 20 && status === 'pending'; i++) {
      pollRes = await request(app)
        .get(`/api/scans/${res.body.id}`)
        .set('Authorization', 'Bearer testtoken');
      status = pollRes.body.status;
      if (status === 'pending') await new Promise(r => setTimeout(r, 10));
    }
    assert.equal(pollRes.body.status, 'done');
    assert.match(
      pollRes.body.url,
      new RegExp(`/api/scans/${res.body.id}/room\\.glb$`)
    );
  });

  it('responds 404 for missing id', async () => {
    const missing = randomUUID();
    await request(app)
      .get(`/api/scans/${missing}`)
      .set('Authorization', 'Bearer testtoken')
      .expect(404);
  });
});
