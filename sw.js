self.addEventListener('push', event => {
  const data = event.data ? event.data.json() : {};
  const title = data.title || 'CHAINeS';
  const options = {
    body: data.body || '',
    icon: '/static/logo.svg',
    data: data
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(clients.openWindow(url));
});
