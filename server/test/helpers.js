import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const serverRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Tests run against their own seeded database file so they never touch the
 * developer's working data. `node --test` runs test files in parallel, so each
 * file passes a distinct name and gets an isolated database. The environment is
 * set before any module that reads config is imported.
 */
export function prepareTestDatabase(name) {
  const relative = `./data/test-${name}.db`;
  const absolute = path.join(serverRoot, 'data', `test-${name}.db`);

  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  for (const suffix of ['', '-wal', '-shm']) {
    const file = `${absolute}${suffix}`;
    if (fs.existsSync(file)) fs.rmSync(file);
  }

  process.env.NODE_ENV = 'test';
  process.env.DATABASE_FILE = relative;
  process.env.JWT_SECRET = 'test-secret-that-is-definitely-long-enough-for-tests';
  process.env.SEED_PASSWORD = 'Passw0rd!2026';
  process.env.MAIL_TRANSPORT = 'console';

  // Tests need the rich fixture set (seedDemo.js), never the clean baseline
  // (seed.js) that a real deployment starts from.
  execFileSync(process.execPath, [path.join(serverRoot, 'src', 'db', 'seedDemo.js')], {
    cwd: serverRoot,
    env: { ...process.env },
    stdio: 'pipe',
  });
}

export const SEED_PASSWORD = 'Passw0rd!2026';

/** Minimal cookie-aware client over the app under test. */
export function createClient(baseUrl) {
  let cookie = null;

  async function request(method, url, body) {
    const headers = { 'content-type': 'application/json' };
    if (cookie) headers.cookie = cookie;

    const response = await fetch(`${baseUrl}${url}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    const setCookie = response.headers.getSetCookie?.() ?? [];
    for (const entry of setCookie) {
      const [pair] = entry.split(';');
      if (pair.startsWith('mpp_session=')) cookie = pair.endsWith('=') ? null : pair;
    }

    const contentType = response.headers.get('content-type') ?? '';
    const payload = contentType.includes('application/json')
      ? await response.json()
      : await response.text();

    return { status: response.status, body: payload };
  }

  return {
    get: (url) => request('GET', url),
    post: (url, body) => request('POST', url, body),
    patch: (url, body) => request('PATCH', url, body),
    del: (url) => request('DELETE', url),
    async login(email, password = SEED_PASSWORD) {
      const result = await request('POST', '/api/auth/login', { email, password });
      if (result.status !== 200) {
        throw new Error(`Login failed for ${email}: ${JSON.stringify(result.body)}`);
      }
      return result.body;
    },
    get cookie() {
      return cookie;
    },
  };
}

export async function startServer() {
  const { createApp } = await import('../src/app.js');
  const app = createApp();
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const { port } = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${port}`, close: () => server.close() });
    });
  });
}
