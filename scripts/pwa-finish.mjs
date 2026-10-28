// After `vite build --mode pwa`: adds the install manifest, icons and the offline service worker
// to dist-pwa/, then zips it so it can be hosted anywhere (any static host over https).
import { copyFileSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const out = 'dist-pwa';
const html = readFileSync(`${out}/index.html`);
const version = createHash('sha256').update(html).digest('hex').slice(0, 12);

for (const size of [180, 192, 512]) copyFileSync(`pwa/icon-${size}.png`, `${out}/icon-${size}.png`);

writeFileSync(`${out}/manifest.webmanifest`, JSON.stringify({
  name: 'Lights Out',
  short_name: 'Lights Out',
  description: 'Turn every light off. 50 levels of the classic 5×5 puzzle.',
  start_url: './',
  scope: './',
  display: 'standalone',
  orientation: 'any',
  background_color: '#0d1015',
  theme_color: '#0d1015',
  icons: [
    { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
    { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
    { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
}, null, 2));

// The app is one file, so the worker only needs to keep that file (plus manifest and icons).
// Serve from cache at once; refresh the cache in the background so the next launch is current.
writeFileSync(`${out}/sw.js`, `// Lights Out offline worker, version ${version}
const CACHE = 'lights-out-${version}';
const FILES = ['./', './index.html', './manifest.webmanifest', './icon-180.png', './icon-192.png', './icon-512.png'];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  const key = req.mode === 'navigate' ? './index.html' : req;
  e.respondWith(caches.open(CACHE).then(async (cache) => {
    const cached = await cache.match(key);
    const fresh = fetch(req).then((res) => { if (res.ok) cache.put(key, res.clone()); return res; }).catch(() => undefined);
    if (cached) { e.waitUntil(fresh); return cached; }
    return (await fresh) ?? new Response('Offline and not cached yet. Open the game once with a connection.', { status: 503, headers: { 'content-type': 'text/plain' } });
  }));
});
`);

const zip = 'lights-out-offline.zip';
if (existsSync(zip)) rmSync(zip);
execFileSync('python3', ['-c', `import shutil; shutil.make_archive('lights-out-offline', 'zip', '${out}')`]);
console.log(`${out}/ ready (service worker version ${version}); ${zip} for any static host`);
