const CACHE_NAME = 'chaines-post-shell-ontario-delivery-v17';
const APP_SHELL = [...new Set([
  '/',
  '/static/delivery-pricing.js',
  '/index.html',
  '/marketplace.html',
  '/profile.html',
  '/private-chat.html',
  '/secure.html',
  '/delivery-services.html',
  '/rewards-program.html',
  '/chaines-ar-collectibles.html',
  '/omconsole_render_single.html',
  '/omconsole_render_single_games_ROUTING.html',
  '/static/wallet.js',
  '/static/chat.js',
  '/static/visit-notifier.js',
  '/manifest.webmanifest',
  '/static/brand/v2/logo.svg',
  '/static/brand/v2/wallet.svg',
  '/static/brand/v2/screen.svg',
  '/static/brand/v2/logo.svg',
  '/static/brand/v2/logo-180.png',
  '/static/brand/v2/logo-badge-96.png',
  '/static/brand/v2/logo-192.png',
  '/static/brand/v2/logo-512.png',
  '/static/brand/v2/logo-maskable-512.png',
  '/static/brand-theme.css',
  '/static/auth-welcome.css',
  '/static/gilded-framework.css',
  '/static/brand/v2/marketplace.svg',
  '/static/brand/v2/user.svg',
  '/static/session-client.js',
  '/static/memory-bank.js',
  '/static/memory-autosave.js',
  '/static/copywriter.js'
])];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if(event.request.method !== 'GET') return;
  const requestUrl = new URL(event.request.url);
  if(requestUrl.origin !== self.location.origin) return;

  // Installed-app identity must refresh before cached metadata is returned.
  if(['/manifest.webmanifest', '/favicon.svg', '/favicon.ico'].includes(requestUrl.pathname) || requestUrl.pathname.startsWith('/static/brand/')){
    event.respondWith((async () => {
      try {
        const response = await fetch(event.request, { cache: 'no-cache' });
        if(response.ok){
          const cache = await caches.open(CACHE_NAME);
          await cache.put(event.request, response.clone());
        }
        return response;
      } catch(error){
        const cached = await caches.match(event.request);
        if(cached) return cached;
        throw error;
      }
    })());
    return;
  }

  if(event.request.mode === 'navigate'){
    event.respondWith(fetch(event.request, { cache: 'no-cache' }).catch(async () => (await caches.match(event.request)) || (await caches.match(requestUrl.pathname)) || caches.match('/index.html')));
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request, { cache: 'no-cache' }).then((response) => {
        if(response.ok){
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return response;
      });
      return cached || network;
    })
  );
});

self.addEventListener('push', event => {
  const data = event.data ? event.data.json() : {};
  const title = data.title || 'CHAINeS';
  const options = {
    body: data.body || '',
    icon: '/static/brand/v2/logo-192.png',
    badge: '/static/brand/v2/logo-badge-96.png',
    data: data
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(clients.openWindow(url));
});
