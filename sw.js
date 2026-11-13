// Guarda o app no celular para funcionar sem internet no deposito.
const CACHE = 'contalenha-v1';
const ARQUIVOS = ['./', 'index.html', 'app.js', 'leitura.js', 'manifest.json', 'img/logo.png', 'img/icone-180.png',
  'img/icone-192.png', 'img/icone-512.png', 'lib/tesseract.min.js', 'lib/worker.min.js', 'lib/eng.traineddata.gz',
  'lib/tesseract-core-lstm.wasm.js', 'lib/tesseract-core-simd-lstm.wasm.js'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ARQUIVOS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.pathname.endsWith('url.json')) return;
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(r => r || fetch(e.request).then(resp => {
    const copia = resp.clone(); caches.open(CACHE).then(c => c.put(e.request, copia)); return resp;
  })));
});
