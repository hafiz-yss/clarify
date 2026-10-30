import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const PORT = process.env.PORT || 3001;
const HOST = process.env.HOST || '127.0.0.1';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://api.fontshare.com; font-src 'self' https://api.fontshare.com https://cdn.fontshare.com data:; img-src 'self' data:; connect-src 'self' https://generativelanguage.googleapis.com https://api.openai.com https://api.groq.com; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'"
};

function isAllowedAssetPath(relPath) {
  if (relPath === 'index.html') return true;
  if (relPath.startsWith('src/') && !relPath.includes('..')) return true;
  if (relPath.startsWith('resources/') && !relPath.includes('..')) return true;
  return false;
}

const server = http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { ...SECURITY_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Method Not Allowed');
    return;
  }

  let safeUrl = '/';
  try {
    safeUrl = decodeURIComponent((req.url || '/').split('?')[0]);
  } catch {
    res.writeHead(400, { ...SECURITY_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Bad Request');
    return;
  }

  const normalizedRel = (safeUrl === '/' ? 'index.html' : safeUrl.replace(/^\/+/, '')).replace(
    /\\/g,
    '/'
  );

  // Block dotfiles (.git, .env, etc.), server scripts, and any path outside index.html / src/ / resources/
  if (
    normalizedRel.split('/').some((part) => part.startsWith('.')) ||
    !isAllowedAssetPath(normalizedRel)
  ) {
    res.writeHead(403, { ...SECURITY_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  const filePath = path.resolve(__dirname, normalizedRel);
  if (!filePath.startsWith(__dirname + path.sep)) {
    res.writeHead(403, { ...SECURITY_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { ...SECURITY_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, HOST, () => {
  console.log(`Clarify dev server running at http://localhost:${PORT}`);
});
