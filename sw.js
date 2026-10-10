// Service worker: ทำให้แอปเปิดได้แม้ไม่มีอินเทอร์เน็ต
// เมื่อแก้ไฟล์แอปแล้ว deploy ใหม่ ให้เปลี่ยนเลขเวอร์ชันด้านล่าง เพื่อล้างแคชเก่า
const VERSION = 'eazy-reader-v1';
const CORE = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/app.js', 'js/util.js', 'js/db.js', 'js/importer.js', 'js/sources.js', 'js/flip.js', 'js/fixedview.js', 'js/reflowview.js', 'js/pdfedit.js', 'js/tts.js',
  'icons/icon-192.png', 'icons/apple-touch-icon.png',
  'fonts/Sarabun-Regular.woff', 'fonts/Sarabun-Bold.woff', 'fonts/Sarabun-Italic.woff', 'fonts/NotoSerifThai.woff',
  'vendor/zip.min.js',
];
// ไฟล์ใหญ่: โหลดเก็บไว้เบื้องหลัง ถ้าโหลดไม่ครบแอปยังใช้ได้ และจะเก็บเพิ่มเมื่อถูกใช้ครั้งแรก
const EXTRA = [
  'vendor/pdfjs/pdf.min.mjs', 'vendor/pdfjs/pdf.worker.min.mjs', 'vendor/pdf-lib.min.js',
  'vendor/libarchive/libarchive.js', 'vendor/libarchive/worker-bundle.js', 'vendor/libarchive/libarchive.wasm',
];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then(async (c) => {
    await c.addAll(CORE);
    c.addAll(EXTRA).catch(() => {});
  }).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const hit = await cache.match(req, { ignoreSearch: true });
    const net = fetch(req).then((res) => { if (res && res.ok && res.type === 'basic') cache.put(req, res.clone()); return res; });
    if (hit) { net.catch(() => {}); return hit; } // ใช้ของในเครื่องก่อน แล้วอัปเดตเบื้องหลัง
    try { return await net; }
    catch (err) { if (req.mode === 'navigate') { const idx = await cache.match('index.html'); if (idx) return idx; } throw err; }
  })());
});
