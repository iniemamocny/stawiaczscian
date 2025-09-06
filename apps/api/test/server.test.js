import request from 'supertest';
import assert from 'assert';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { randomUUID } from 'crypto';

let app;
let tmpDir;
let uploadedId;

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
  process.env.MAX_UPLOAD_BYTES = '10';
  process.env.CONCURRENCY = '1';
  process.env.QUEUE_LIMIT = '1';

  const blenderMock = `#!/usr/bin/env node\nimport fs from 'fs';\nconst args = process.argv.slice(2);\nif (args[0] === '--version') process.exit(0);\nconst out = args[args.length - 1];\nsetTimeout(() => fs.writeFileSync(out, ''), 100);\n`;
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

  it('rejects file with disallowed extension', async () => {
    await request(app)
      .post('/api/scans')
      .set('Authorization', 'Bearer testtoken')
      .attach('file', Buffer.from('data'), {
        filename: 'model.txt',
        contentType: 'text/plain',
      })
      .expect(400);
  });

  it('returns 400 when file is missing', async () => {
    await request(app)
      .post('/api/scans')
      .set('Authorization', 'Bearer testtoken')
      .field('meta', '{}')
      .expect(400);
  });

  it('returns 413 when file is too large', async () => {
    await request(app)
      .post('/api/scans')
      .set('Authorization', 'Bearer testtoken')
      .attach('file', Buffer.alloc(20), {
        filename: 'model.obj',
        contentType: 'application/octet-stream',
      })
      .expect(413);
  });

  it('rejects invalid metadata', async () => {
    const res = await request(app)
      .post('/api/scans')
      .set('Authorization', 'Bearer testtoken')
      .field('meta', JSON.stringify({ author: 123 }))
      .attach('file', Buffer.from('data'), {
        filename: 'model.obj',
        contentType: 'application/octet-stream',
      });
    assert.equal(res.status, 400);
    assert(res.body.fields.includes('title'));
    assert(res.body.fields.includes('filename'));
    assert(res.body.fields.includes('author'));
  });

  it('returns 400 when metadata is too large', async () => {
    process.env.MAX_META_BYTES = '10';
    const res = await request(app)
      .post('/api/scans')
      .set('Authorization', 'Bearer testtoken')
      .field('meta', 'x'.repeat(20))
      .attach('file', Buffer.from('data'), {
        filename: 'model.obj',
        contentType: 'application/octet-stream',
      });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'metadata too large');
    delete process.env.MAX_META_BYTES;
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
    uploadedId = res.body.id;

    let status = 'pending';
    let pollRes;
    for (let i = 0; i < 10 && status === 'pending'; i++) {
      pollRes = await request(app)
        .get(`/api/scans/${res.body.id}`)
        .set('Authorization', 'Bearer testtoken');
      status = pollRes.body.status || 'pending';
      assert.equal(typeof pollRes.body.progress, 'number');
      if (status === 'pending') await new Promise(r => setTimeout(r, 20));
    }
    assert.equal(pollRes.body.status, 'done');
    assert.equal(pollRes.body.progress, 100);
    assert.match(
      pollRes.body.url,
      new RegExp(`/api/scans/${res.body.id}/room\\.glb$`)
    );
  });

  it('returns 400 for invalid id format', async () => {
    await request(app)
      .get('/api/scans/not-a-uuid')
      .set('Authorization', 'Bearer testtoken')
      .expect(400);
  });

  it('responds 404 for missing id', async () => {
    const missing = randomUUID();
    await request(app)
      .get(`/api/scans/${missing}`)
      .set('Authorization', 'Bearer testtoken')
      .expect(404);
  });

  it('serves attachment and respects filename in info.json', async () => {
    const res1 = await request(app)
      .get(`/api/scans/${uploadedId}/room.glb`)
      .set('Authorization', 'Bearer testtoken');
    assert.equal(
      res1.headers['content-disposition'],
      'attachment; filename="room.glb"'
    );

    const infoPath = path.join(
      process.env.STORAGE_DIR,
      uploadedId,
      'info.json'
    );
    const info = JSON.parse(await fs.readFile(infoPath, 'utf8'));
    info.filename = 'custom.glb';
    await fs.writeFile(infoPath, JSON.stringify(info, null, 2));

    const res2 = await request(app)
      .get(`/api/scans/${uploadedId}/room.glb`)
      .set('Authorization', 'Bearer testtoken');
    assert.equal(
      res2.headers['content-disposition'],
      'attachment; filename="custom.glb"'
    );
  });

  it('lists scan ids with pagination', async () => {
    const extraId = randomUUID();
    await fs.mkdir(path.join(process.env.STORAGE_DIR, extraId));

    const res1 = await request(app)
      .get('/api/scans?limit=1&page=1')
      .set('Authorization', 'Bearer testtoken');
    const res2 = await request(app)
      .get('/api/scans?limit=1&page=2')
      .set('Authorization', 'Bearer testtoken');

    assert.equal(res1.status, 200);
    assert.equal(res2.status, 200);
    assert.equal(res1.body.length, 1);
    assert.equal(res2.body.length, 1);

    const all = new Set([...res1.body, ...res2.body]);
    assert(all.has(uploadedId));
    assert(all.has(extraId));
  });

  it('deletes scan directory', async () => {
    await request(app)
      .delete(`/api/scans/${uploadedId}`)
      .set('Authorization', 'Bearer testtoken')
      .expect(204);

    await request(app)
      .get(`/api/scans/${uploadedId}`)
      .set('Authorization', 'Bearer testtoken')
      .expect(404);
  });

  it('returns 404 when deleting missing id', async () => {
    const missing = randomUUID();
    await request(app)
      .delete(`/api/scans/${missing}`)
      .set('Authorization', 'Bearer testtoken')
      .expect(404);
  });

  it('enforces queue limit', async () => {
    const res1 = await request(app)
      .post('/api/scans')
      .set('Authorization', 'Bearer testtoken')
      .attach('file', Buffer.from('data'), {
        filename: 'model.obj',
        contentType: 'application/octet-stream',
      });

    const res2 = await request(app)
      .post('/api/scans')
      .set('Authorization', 'Bearer testtoken')
      .attach('file', Buffer.from('data'), {
        filename: 'model.obj',
        contentType: 'application/octet-stream',
      });

    assert.equal(res2.status, 429);
    await new Promise(r => setTimeout(r, 300));
    await fs.rm(path.join(process.env.STORAGE_DIR, res1.body.id), {
      recursive: true,
      force: true,
    });
  });
});
