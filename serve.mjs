import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

/* Static preview server. Streams files and honours HTTP Range requests, which the search page needs:
   it reads the SQLite search index a few pages at a time instead of downloading it whole.
   /api/assistant/ goes to server/assistant_api.py (port 8018) and the rest of /api/ to server/search_api.py (port 8017),
   like nginx does on the VPS; when they are not running, the site works as a static site (assistant hidden). */
const root = path.resolve('dist');
const types = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.geojson': 'application/geo+json; charset=utf-8',
  '.wasm': 'application/wasm', '.sqlite3': 'application/octet-stream', '.svg': 'image/svg+xml'
};

function proxy(req, res, port) {
  const upstream = http.request({ host: '127.0.0.1', port, path: req.url, method: req.method,
    headers: { ...req.headers, host: `127.0.0.1:${port}`, 'x-real-ip': req.socket.remoteAddress || '127.0.0.1' } }, up => {
    res.writeHead(up.statusCode || 502, up.headers);
    up.pipe(res);
  });
  upstream.on('error', () => { if (!res.headersSent) res.writeHead(502, { 'content-type': 'application/json' }); res.end('{"error":"api not running"}'); });
  req.pipe(upstream);
}

http.createServer((req, res) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); } catch { res.writeHead(400).end(); return; }
  if (pathname.startsWith('/api/')) { proxy(req, res, pathname.startsWith('/api/assistant/') ? 8018 : 8017); return; }
  const file = path.resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
  if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
  fs.stat(file, (error, stat) => {
    if (error || !stat.isFile()) { res.writeHead(404).end('Not found'); return; }
    const headers = { 'content-type': types[path.extname(file)] || 'application/octet-stream', 'accept-ranges': 'bytes', 'cache-control': 'no-cache' };
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (range) {
      let start = range[1] === '' ? stat.size - Number(range[2]) : Number(range[1]);
      let end = range[1] === '' || range[2] === '' ? stat.size - 1 : Number(range[2]);
      end = Math.min(end, stat.size - 1);
      if (start > end || start < 0) { res.writeHead(416, { 'content-range': `bytes */${stat.size}` }).end(); return; }
      res.writeHead(206, { ...headers, 'content-range': `bytes ${start}-${end}/${stat.size}`, 'content-length': end - start + 1 });
      if (req.method === 'HEAD') { res.end(); return; }
      fs.createReadStream(file, { start, end }).pipe(res);
      return;
    }
    res.writeHead(200, { ...headers, 'content-length': stat.size });
    if (req.method === 'HEAD') { res.end(); return; }
    fs.createReadStream(file).pipe(res);
  });
}).listen(4173, '127.0.0.1', () => console.log('FranceRoueLibre preview: http://127.0.0.1:4173'));
