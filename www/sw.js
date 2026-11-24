/* CYBER AQUA service worker — offline-first app shell */
const VERSION = 'cyber-aqua-v3';
const SHELL = [
  './',
  './index.html',
  './guide.html',
  './app.css',
  './manifest.webmanifest',
  './src/main.js',
  './src/util.js',
  './src/textures.js',
  './src/world.js',
  './src/fish.js',
  './src/bottle.js',
  './src/particles.js',
  './src/camera.js',
  './src/critters.js',
  './src/postfx.js',
  './src/audio.js',
  './src/state.js',
  './src/ui.js',
  './vendor/three.module.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-180.png',
  './icons/icon-1024.png'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(VERSION)
      .then((c) => Promise.all(SHELL.map((u) => c.add(new Request(u, { cache: 'reload' })).catch(() => null))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(req, copy)).catch(() => {});
        return res;
      }).catch(() => caches.match(req).then((r) => r || caches.match('./index.html')))
    );
    return;
  }

  /* network-first so updates land immediately; cache is the offline fallback */
  e.respondWith(
    fetch(req).then((res) => {
      if (res && res.status === 200 && res.type === 'basic') {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(req, copy)).catch(() => {});
      }
      return res;
    }).catch(() => caches.match(req).then((r) => r || caches.match('./index.html')))
  );
});