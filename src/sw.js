// Service worker for iOS PWA + web push notifications.
// Uses the standard Web Push API directly (not Firebase Messaging) so no
// Firebase Functions or Blaze-plan setup is required - notifications are
// sent via a Vercel serverless function using the `web-push` library.

self.addEventListener('push', function(event) {
  var data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) {}
  var title = data.title || 'עדכון פנימייה';
  var body = data.body || '';
  event.waitUntil(
    self.registration.showNotification(title, {
      body: body,
      icon: '/assets/icon-192.png',
      badge: '/assets/icon-192.png',
      tag: data.tag || 'yeshiva-push',
      data: data
    })
  );
});

// clicking the notification focuses an existing tab if the PWA is already
// open, otherwise launches it fresh
self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(list) {
      for (var i = 0; i < list.length; i++) {
        if ('focus' in list[i]) return list[i].focus();
      }
      if (clients.openWindow) return clients.openWindow('/');
    })
  );
});

// install/activate: take control immediately so a fresh install starts
// intercepting push events without needing a reload
self.addEventListener('install', function() { self.skipWaiting(); });
self.addEventListener('activate', function(e) { e.waitUntil(self.clients.claim()); });
