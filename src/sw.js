// Service worker for iOS PWA + web push notifications.
// Uses the standard Web Push API directly (not Firebase Messaging) so no
// Firebase Functions or Blaze-plan setup is required - notifications are
// sent via a Vercel serverless function using the `web-push` library.

self.addEventListener('push', function(event) {
  var data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) {}
  var title = data.title || 'עדכון פנימייה';
  var body = data.body || '';
  var opts = {
    body: body,
    icon: '/assets/icon-192.png',
    badge: '/assets/icon-192.png',
    tag: data.tag || 'yeshiva-push',
    data: data
  };
  // iOS 16.4+ can render actions; if not shown, tapping the notification
  // still opens the app which handles snooze via URL param fallback
  if (data.actions) opts.actions = data.actions;
  event.waitUntil(self.registration.showNotification(title, opts));
});

// notificationclick: handle both the "snooze" action button and the
// default tap-to-open behaviour
self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  var data = (event.notification && event.notification.data) || {};

  if (event.action === 'snooze') {
    // fire-and-forget POST to record the snooze; nothing to show back
    event.waitUntil(fetch('/api/snooze', { method: 'POST' }).catch(function() {}));
    return;
  }

  // default: focus an existing PWA window or open a new one at the URL
  // the push carried (falls back to '/')
  var targetUrl = data.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(list) {
      for (var i = 0; i < list.length; i++) {
        if ('focus' in list[i]) {
          list[i].focus();
          if (list[i].navigate) list[i].navigate(targetUrl);
          return;
        }
      }
      if (clients.openWindow) return clients.openWindow(targetUrl);
    })
  );
});

// install/activate: take control immediately so a fresh install starts
// intercepting push events without needing a reload
self.addEventListener('install', function() { self.skipWaiting(); });
self.addEventListener('activate', function(e) { e.waitUntil(self.clients.claim()); });
