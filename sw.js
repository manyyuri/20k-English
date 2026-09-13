// sw.js — PWA 壳缓存；API/字体请求直通。手动版本号管理（改了文件就 +1）。
const CACHE = 'en20k-v1';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon.svg',
  './css/app.css',
  './js/app.js',
  './js/util.js',
  './js/srs.js',
  './js/store.js',
  './js/llm.js',
  './js/words.js',
  './js/views/today.js',
  './js/views/drill.js',
  './js/views/bank.js',
  './js/views/harvest.js',
  './js/views/review.js',
  './js/views/audit.js',
  './js/views/speaking.js',
  './js/views/paraphrase.js',
  './js/views/upgrade.js',
  './js/views/immersion.js',
  './js/views/settings.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;                       // LLM POST 直通
  if (url.origin !== location.origin && !/fonts\.(googleapis|gstatic)\.com|cdn\.jsdelivr\.net/.test(url.hostname)) return; // 跨源直通
  e.respondWith(
    caches.match(e.request, { ignoreSearch: url.pathname === './' || url.pathname === '/' }).then((hit) =>
      hit ||
      fetch(e.request).then((res) => {
        if (res.ok && url.origin === location.origin) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      }).catch(() => caches.match('./index.html')),
    ),
  );
});
