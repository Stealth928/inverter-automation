#!/usr/bin/env node
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..', 'frontend');
const HOST = process.env.PLAYWRIGHT_STATIC_HOST || '127.0.0.1';
const PORT = Number(process.env.PLAYWRIGHT_STATIC_PORT || '8000');

const MIME_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
};

function resolveRequestPath(requestUrl) {
  const parsed = new URL(requestUrl, `http://${HOST}:${PORT}`);
  const normalizedPath = path.posix.normalize(decodeURIComponent(parsed.pathname || '/'));
  if (normalizedPath === '/') return '/index.html';
  if (normalizedPath.endsWith('/')) return `${normalizedPath}index.html`;
  return normalizedPath;
}

function resolveFilePath(requestPath) {
  const safeRelativePath = requestPath.replace(/^(\.\.[/\\])+/, '');
  return path.join(ROOT_DIR, safeRelativePath);
}

const server = http.createServer((req, res) => {
  try {
    const requestPath = resolveRequestPath(req.url || '/');
    const filePath = resolveFilePath(requestPath);

    if (!filePath.startsWith(ROOT_DIR)) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Forbidden');
      return;
    }

    fs.readFile(filePath, (error, data) => {
      if (error) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not found');
        return;
      }

      res.writeHead(200, {
        'Content-Type': MIME_TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream'
      });
      res.end(data);
    });
  } catch (error) {
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end(error && error.message ? error.message : String(error));
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[PlaywrightStaticServer] Serving ${ROOT_DIR} on http://${HOST}:${PORT}`);
});
