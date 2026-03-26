const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..');
const firebaseConfig = JSON.parse(fs.readFileSync(path.join(repoRoot, 'firebase.json'), 'utf8'));
const publicDir = path.join(repoRoot, firebaseConfig.hosting.public || 'frontend');

function normalizeHostingPath(value) {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return '';
  const withoutQuery = raw.split('?')[0].split('#')[0].replace(/\\+/g, '/');
  if (!withoutQuery.startsWith('/')) {
    return `/${withoutQuery.replace(/^\/+/, '')}`;
  }
  return withoutQuery;
}

function normalizeWithoutTrailingSlash(value) {
  return normalizeHostingPath(value).replace(/\/+$/, '') || '/';
}

function getDirectoryBackedPaths(currentDir, relativeDir = '', result = new Set(['/'])) {
  const entries = fs.readdirSync(currentDir, { withFileTypes: true });
  const hasIndexHtml = entries.some((entry) => entry.isFile() && entry.name.toLowerCase() === 'index.html');
  if (hasIndexHtml) {
    const normalizedRelative = relativeDir.replace(/\\+/g, '/').replace(/^\/+|\/+$/g, '');
    result.add(normalizedRelative ? `/${normalizedRelative}` : '/');
  }

  entries
    .filter((entry) => entry.isDirectory())
    .forEach((entry) => {
      const nextRelative = relativeDir ? path.join(relativeDir, entry.name) : entry.name;
      getDirectoryBackedPaths(path.join(currentDir, entry.name), nextRelative, result);
    });

  return result;
}

test('directory-backed routes do not redirect to themselves with only trailing-slash differences', () => {
  const directoryBackedPaths = getDirectoryBackedPaths(publicDir);
  const redirects = Array.isArray(firebaseConfig.hosting.redirects) ? firebaseConfig.hosting.redirects : [];
  const riskyRedirects = redirects.filter((redirect) => {
    const source = normalizeHostingPath(redirect && redirect.source);
    const destination = normalizeHostingPath(redirect && redirect.destination);
    if (!source || !destination) return false;
    if (!directoryBackedPaths.has(normalizeWithoutTrailingSlash(destination))) return false;
    if (!source.endsWith('/') && destination.endsWith('/')) return false;
    return normalizeWithoutTrailingSlash(source) === normalizeWithoutTrailingSlash(destination);
  });

  assert.deepEqual(riskyRedirects, []);
});

test('blog alias redirects still point to the canonical root-level post URLs', () => {
  const redirects = Array.isArray(firebaseConfig.hosting.redirects) ? firebaseConfig.hosting.redirects : [];
  const redirectPairs = redirects.map((redirect) => [redirect.source, redirect.destination]);

  assert.deepEqual(redirectPairs.filter(([source]) => String(source).startsWith('/blog/')), [
    ['/blog/battery-automation-roi-examples', '/battery-automation-roi-examples/'],
    ['/blog/battery-automation-roi-examples/', '/battery-automation-roi-examples/'],
    ['/blog/home-battery-automation-options-compared', '/home-battery-automation-options-compared/'],
    ['/blog/home-battery-automation-options-compared/', '/home-battery-automation-options-compared/'],
    ['/blog/what-smarter-battery-automation-looks-like-as-you-level-up', '/battery-automation-roi-examples/'],
    ['/blog/what-smarter-battery-automation-looks-like-as-you-level-up/', '/battery-automation-roi-examples/']
  ]);
});

test('global hosting headers include a content security policy', () => {
  const headers = Array.isArray(firebaseConfig.hosting.headers) ? firebaseConfig.hosting.headers : [];
  const wildcardHeaders = headers.find((entry) => entry && entry.source === '**');

  assert.ok(wildcardHeaders, 'Expected wildcard hosting headers entry');

  const cspHeader = (wildcardHeaders.headers || []).find((entry) => entry && entry.key === 'Content-Security-Policy');
  assert.ok(cspHeader, 'Expected Content-Security-Policy header');
  assert.match(String(cspHeader.value || ''), /frame-ancestors 'none'/);
  assert.match(String(cspHeader.value || ''), /connect-src 'self'/);
  assert.match(String(cspHeader.value || ''), /frame-src 'self'/);
  assert.match(String(cspHeader.value || ''), /https:\/\/apis\.google\.com/);
  assert.match(String(cspHeader.value || ''), /http:\/\/127\.0\.0\.1:\*/);
});
