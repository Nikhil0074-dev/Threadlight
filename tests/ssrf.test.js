import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { config } from '../server/config.js';
import { isPrivateAddress, parsePublicUrl, safeFetchText } from '../server/lib/ssrf.js';

test('private and special addresses are blocked', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', 'fc00::1', 'fe80::1', '::ffff:127.0.0.1']) {
    assert.equal(isPrivateAddress(ip), true, ip);
  }
});
test('public addresses are allowed', () => {
  for (const ip of ['8.8.8.8', '1.1.1.1', '172.32.0.1', '2606:4700:4700::1111']) assert.equal(isPrivateAddress(ip), false, ip);
});
test('parsePublicUrl rejects bad schemes, credentials, ports and local names', () => {
  for (const u of ['ftp://example.com', 'file:///etc/passwd', 'javascript:alert(1)', 'http://user:pw@example.com', 'http://example.com:22', 'http://localhost/', 'http://foo.localhost/', 'http://127.0.0.1/', 'http://[::1]/', 'not a url', 'http://169.254.169.254/latest/meta-data']) {
    assert.throws(() => parsePublicUrl(u), (e) => e.status === 400, u);
  }
  assert.equal(parsePublicUrl('https://example.com/a?b=1').hostname, 'example.com');
});

function server(handler) {
  return new Promise((resolve) => { const s = http.createServer(handler); s.listen(0, '127.0.0.1', () => resolve(s)); });
}

test('a real request to a local server is blocked by default', async () => {
  const s = await server((_q, r) => r.end('secret'));
  try {
    await assert.rejects(safeFetchText(`http://127.0.0.1:${s.address().port}/`), (e) => e.code === 'BLOCKED_URL');
  } finally { s.close(); }
});

test('with the test switch on: fetch works, redirects are followed, size and type limits apply', async () => {
  config.allowPrivateUrls = true;
  const s = await server((q, r) => {
    if (q.url === '/redir') { r.writeHead(302, { location: '/page' }); return r.end(); }
    if (q.url === '/page') { r.writeHead(200, { 'content-type': 'text/html' }); return r.end('<p>hello</p>'); }
    if (q.url === '/big') { r.writeHead(200, { 'content-type': 'text/html' }); return r.end('x'.repeat(5000)); }
    if (q.url === '/img') { r.writeHead(200, { 'content-type': 'image/png' }); return r.end('x'); }
    if (q.url === '/loop') { r.writeHead(302, { location: '/loop' }); return r.end(); }
    r.writeHead(404); return r.end();
  });
  const base = `http://127.0.0.1:${s.address().port}`;
  try {
    assert.match((await safeFetchText(`${base}/redir`)).body, /hello/);
    await assert.rejects(safeFetchText(`${base}/big`, { maxBytes: 1000 }), (e) => e.code === 'TOO_LARGE');
    await assert.rejects(safeFetchText(`${base}/img`), (e) => e.code === 'UNSUPPORTED_CONTENT');
    await assert.rejects(safeFetchText(`${base}/loop`), (e) => e.code === 'TOO_MANY_REDIRECTS');
    await assert.rejects(safeFetchText(`${base}/missing`), (e) => e.code === 'FETCH_FAILED');
  } finally { config.allowPrivateUrls = false; s.close(); }
});
