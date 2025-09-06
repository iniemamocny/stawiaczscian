import { spawn } from 'child_process';
import assert from 'assert';
import { fileURLToPath } from 'url';

const serverPath = fileURLToPath(new URL('../server.js', import.meta.url));

describe('API server startup', () => {
  it('fails when API_TOKEN is missing', async () => {
    const env = { ...process.env };
    delete env.API_TOKEN;
    const proc = spawn('node', [serverPath], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';
    proc.stderr.on('data', data => {
      stderr += data.toString();
    });

    const code = await new Promise(resolve => {
      proc.on('close', resolve);
    });

    assert.notStrictEqual(code, 0);
    assert(stderr.includes('API_TOKEN required'));
  });
});
