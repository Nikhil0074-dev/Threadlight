import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { config } from '../config.js';
import { bad } from './errors.js';

export function isPrivateAddress(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return (
      a === 0 || a === 10 || a === 127 ||
      (a === 100 && b >= 64 && b <= 127) || // carrier-grade NAT
      (a === 169 && b === 254) ||           // link-local, cloud metadata
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224                              // multicast + reserved
    );
  }
  if (net.isIPv6(ip)) {
    const v = ip.toLowerCase();
    if (v === '::' || v === '::1') return true;
    if (v.startsWith('::ffff:')) return isPrivateAddress(v.slice(7)); // mapped IPv4
    return v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe8') ||
      v.startsWith('fe9') || v.startsWith('fea') || v.startsWith('feb') || v.startsWith('ff');
  }
  return true; // unknown format: block
}

export function parsePublicUrl(raw) {
  let u;
  try { u = new URL(String(raw).trim()); } catch { throw bad('INVALID_URL', 'That is not a valid URL.'); }
  if (!['http:', 'https:'].includes(u.protocol)) throw bad('UNSUPPORTED_PROTOCOL', 'Only http and https links are supported.');
  if (u.username || u.password) throw bad('INVALID_URL', 'Links with a username or password are not supported.');
  const port = u.port || (u.protocol === 'https:' ? '443' : '80');
  if (!config.allowPrivateUrls && !['80', '443'].includes(port)) throw bad('BLOCKED_URL', 'Only ports 80 and 443 are allowed.');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (!config.allowPrivateUrls) {
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local')) {
      throw bad('BLOCKED_URL', 'That address points to a private network.');
    }
    if (net.isIP(host) && isPrivateAddress(host)) throw bad('BLOCKED_URL', 'That address points to a private network.');
  }
  return u;
}

// DNS lookup that rejects private answers at connect time. This also stops DNS-rebinding,
// because the address we validate is the address we connect to.
function safeLookup(hostname, options, cb) {
  dns.lookup(hostname, { all: true }, (err, addrs) => {
    if (err) return cb(err);
    const ok = config.allowPrivateUrls ? addrs : addrs.filter((a) => !isPrivateAddress(a.address));
    if (!ok.length) return cb(new Error('BLOCKED_PRIVATE_ADDRESS'));
    if (options && options.all) return cb(null, ok);
    return cb(null, ok[0].address, ok[0].family);
  });
}

function requestOnce(u, { timeoutMs, maxBytes }) {
  return new Promise((resolve, reject) => {
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request(
      u,
      {
        method: 'GET',
        lookup: safeLookup,
        timeout: timeoutMs,
        headers: {
          'user-agent': 'ThreadlightBot/0.1 (+article-extractor)',
          accept: 'text/html,text/plain;q=0.9,*/*;q=0.1',
        },
      },
      (res) => {
        const status = res.statusCode || 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          return resolve({ redirect: new URL(res.headers.location, u).toString() });
        }
        const type = String(res.headers['content-type'] || '');
        if (status >= 400) { res.resume(); return reject(bad('FETCH_FAILED', `The website answered with status ${status}.`)); }
        if (!/text\/(html|plain)|application\/xhtml/i.test(type)) {
          res.resume();
          return reject(bad('UNSUPPORTED_CONTENT', 'That link is not a web page or plain text.'));
        }
        const chunks = [];
        let size = 0;
        let done = false;
        res.on('data', (c) => {
          size += c.length;
          if (done) return;
          if (size > maxBytes) { done = true; reject(bad('TOO_LARGE', 'That page is too large to process.')); req.destroy(); return; }
          chunks.push(c);
        });
        res.on('end', () => !done && resolve({ body: Buffer.concat(chunks).toString('utf8'), type }));
        res.on('error', (e) => { if (!done) reject(e); });
      },
    );
    req.on('timeout', () => { reject(bad('TIMEOUT', 'The website took too long to respond.')); req.destroy(); });
    req.on('error', (e) => {
      if (e && e.code && e.status) return reject(e);
      if (String(e.message).includes('BLOCKED_PRIVATE_ADDRESS')) return reject(bad('BLOCKED_URL', 'That address points to a private network.'));
      reject(bad('FETCH_FAILED', 'Could not reach that website.'));
    });
    req.end();
  });
}

export async function safeFetchText(rawUrl, { timeoutMs = 10000, maxBytes = 3 * 1024 * 1024, maxRedirects = 3 } = {}) {
  let u = parsePublicUrl(rawUrl);
  for (let i = 0; i <= maxRedirects; i += 1) {
    const r = await requestOnce(u, { timeoutMs, maxBytes });
    if (r.redirect) { u = parsePublicUrl(r.redirect); continue; } // every hop is re-validated
    return { ...r, finalUrl: u.toString() };
  }
  throw bad('TOO_MANY_REDIRECTS', 'That link redirects too many times.');
}
