import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { requestJson } from '../public/admin-request.mjs';
import { gitBlobSha } from '../public/admin-crypto.mjs';

test('publication requests time out before headers and during the body, and support cancellation', async () => {
  const server = createServer((request, response) => {
    if (request.url === '/headers') return;
    if (request.url === '/body') { response.writeHead(200, { 'Content-Type': 'application/json' }); response.write('{'); return; }
    if (request.url === '/denied') { response.writeHead(401); response.end('Unauthorized'); return; }
    response.setHeader('Content-Type', 'application/json'); response.end('{"sha":"accepted"}');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    for (const path of ['/headers', '/body']) {
      await assert.rejects(requestJson(base + path, {}, { timeoutMs: 80 }), /не ответил/);
    }
    const controller = new AbortController();
    const request = requestJson(base + '/body', { signal: controller.signal });
    setTimeout(() => controller.abort(), 80);
    await assert.rejects(request, /Отправка остановлена/);
    assert.deepEqual(await requestJson(base + '/ok'), { ok: true, status: 200, data: { sha: 'accepted' } });
    assert.equal((await requestJson(base + '/denied')).status, 401);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

test('retrying after a lost response can identify exactly the Git blob already submitted', async () => {
  const bytes = new TextEncoder().encode('{"project":"Новый проект"}\n');
  const expected = createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex');
  assert.equal(await gitBlobSha(bytes), expected);
});
