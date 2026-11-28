// Service worker: lưu sẵn toàn bộ file để mở lại được khi không có Internet
const CACHE = 'lms-offline-v1';
const ASSETS = ['./', 'index.html', 'manifest.json', 'css/style.css', 'js/store.js', 'js/app.js',
                'vendor/bootstrap.min.css', 'vendor/xlsx.full.min.js'];

self.addEventListener('install', e => {
    e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
    e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
        .then(() => self.clients.claim()));
});
// Ưu tiên mạng (để nhận bản cập nhật), mất mạng thì dùng bản đã lưu
self.addEventListener('fetch', e => {
    if (e.request.method !== 'GET' || new URL(e.request.url).origin !== location.origin) return;
    e.respondWith(
        fetch(e.request).then(res => {
            const copy = res.clone();
            caches.open(CACHE).then(c => c.put(e.request, copy));
            return res;
        }).catch(() => caches.match(e.request, { ignoreSearch: true }))
    );
});
