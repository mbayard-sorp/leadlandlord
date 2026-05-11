import http from 'node:http';

const PORT = Number(process.env.PORT ?? 8080);
const SECRET = process.env.PROXY_SECRET;
const NAMECHEAP_BASE_PROD = 'https://api.namecheap.com/xml.response';
const NAMECHEAP_BASE_SANDBOX = 'https://api.sandbox.namecheap.com/xml.response';

if (!SECRET) {
  console.error('PROXY_SECRET env var is required');
  process.exit(1);
}

const ALLOWED_COMMANDS = new Set([
  'namecheap.domains.check',
  'namecheap.domains.create',
  'namecheap.domains.getList',
  'namecheap.domains.getInfo',
  'namecheap.domains.dns.setHosts',
  'namecheap.domains.dns.setDefault',
  'namecheap.domains.dns.getHosts',
  'namecheap.users.getPricing',
]);

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

function readBody(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('payload too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/healthz') {
    return send(res, 200, { ok: true });
  }

  if (req.method !== 'POST' || req.url !== '/forward') {
    return send(res, 404, { error: 'not found' });
  }

  if (req.headers['x-proxy-secret'] !== SECRET) {
    return send(res, 401, { error: 'unauthorized' });
  }

  let payload;
  try {
    const raw = await readBody(req);
    payload = JSON.parse(raw);
  } catch (err) {
    return send(res, 400, { error: 'invalid json', detail: String(err.message ?? err) });
  }

  const { command, params, sandbox } = payload ?? {};
  if (typeof command !== 'string' || !ALLOWED_COMMANDS.has(command)) {
    return send(res, 400, { error: 'invalid or disallowed command' });
  }
  if (params == null || typeof params !== 'object') {
    return send(res, 400, { error: 'params must be an object' });
  }

  const qs = new URLSearchParams();
  qs.set('Command', command);
  for (const [k, v] of Object.entries(params)) {
    if (v == null) continue;
    qs.set(k, String(v));
  }

  const base = sandbox ? NAMECHEAP_BASE_SANDBOX : NAMECHEAP_BASE_PROD;
  const url = `${base}?${qs.toString()}`;

  try {
    const upstream = await fetch(url, { method: 'GET' });
    const text = await upstream.text();
    res.writeHead(upstream.status, { 'content-type': 'application/xml; charset=utf-8' });
    res.end(text);
  } catch (err) {
    return send(res, 502, { error: 'upstream fetch failed', detail: String(err.message ?? err) });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`namecheap-proxy listening on :${PORT}`);
});
