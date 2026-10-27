import assert from 'node:assert/strict';
import { LocalDevelopmentAccess } from '../src/mastra/local-access.ts';

const previous = process.env.NODE_ENV;
try {
  process.env.NODE_ENV = 'production';
  assert.throws(() => new LocalDevelopmentAccess(), /requires NODE_ENV=development/);
  process.env.NODE_ENV = 'development';
  const access = new LocalDevelopmentAccess();
  for (const origin of ['http://localhost:4111', 'http://127.0.0.1:4111']) {
    assert.equal((await access.authenticateToken('', new Request(origin)))?.id, 'barracks-local');
    assert.equal((await access.authenticateToken('', new Request(origin, { headers: { origin } })))?.id, 'barracks-local');
  }
  for (const request of [
    new Request('http://evil.example:4111'),
    new Request('http://localhost:4112'),
    new Request('http://localhost:4111', { headers: { origin: 'https://evil.example' } }),
    new Request('http://localhost:4111', { headers: { origin: 'null' } }),
    new Request('http://localhost:4111', { headers: { 'sec-fetch-site': 'cross-site' } }),
  ]) assert.equal(await access.authenticateToken('', request), null);
  console.log('PASS: local operator access accepts loopback, rejects foreign/cross-site requests and production use.');
} finally {
  if (previous === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = previous;
}
