/* Service worker minimal: syarat installable PWA. Tidak meng-cache API/data (data kader bersifat sensitif). */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
