/* Service worker de LectorStudio.
   - La app y las librerías se guardan para funcionar sin conexión.
   - El OCR (Tesseract, ~20 MB de idiomas) se cachea la primera vez que se usa.
   - Navegación: red primero; si no hay red, la app guardada. */

const CACHE = 'lectorstudio-1.0.1';
const SHELL = [
  './',
  'index.html',
  'css/app.css',
  'manifest.webmanifest',
  'js/app.js',
  'js/db.js',
  'js/util.js',
  'js/text.js',
  'js/prefs.js',
  'js/speech.js',
  'js/epub.js',
  'js/pdfdoc.js',
  'js/import.js',
  'js/backup.js',
  'js/library.js',
  'js/sheets.js',
  'js/reader.js',
  'vendor/jszip/jszip.min.js',
  'vendor/pdfjs/build/pdf.min.mjs',
  'vendor/pdfjs/build/pdf.worker.min.mjs',
  'icons/favicon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
  'samples/libro-demo.epub',
  'samples/fotocopia.pdf'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(SHELL.map(async (url) => {
      try { await cache.add(new Request(url, { cache: 'reload' })); } catch { /* un archivo opcional */ }
    }));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

async function putIfOk(cache, request, response) {
  if (response && response.ok && response.type === 'basic') {
    try { await cache.put(request, response.clone()); } catch { /* cuota */ }
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE);
      try {
        const fresh = await fetch(req);
        await putIfOk(cache, 'index.html', fresh.clone());
        return fresh;
      } catch {
        return (await cache.match('index.html')) || (await cache.match('./')) || Response.error();
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const hit = await cache.match(req);
    const network = fetch(req).then((res) => putIfOk(cache, req, res)).catch(() => null);
    if (hit) {
      // Actualiza en segundo plano sin retrasar la respuesta.
      try { event.waitUntil(network); } catch { /* evento ya cerrado */ }
      return hit;
    }
    const fresh = await network;
    return fresh || new Response('', { status: 504, statusText: 'Sin conexión' });
  })());
});
