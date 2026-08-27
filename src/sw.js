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

// ─── Web Share Target intercept ───
// Browsers POST the shared file to /?ingest=share (see manifest.webmanifest).
// The service worker catches the POST, reads the file into a data URL, stashes
// it in the target client's sessionStorage, then redirects to /?ingest=share
// so the page can pick it up on load and route it into the scan preview.
self.addEventListener('fetch', function(event) {
  var url = new URL(event.request.url);
  if (event.request.method === 'POST' && url.pathname === '/' && url.searchParams.get('ingest') === 'share') {
    event.respondWith((async function() {
      try {
        var form = await event.request.formData();
        var file = form.get('file');
        if (file && file.size) {
          var buf = await file.arrayBuffer();
          var bytes = new Uint8Array(buf);
          var bin = '';
          for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
          var b64 = 'data:' + (file.type || 'image/jpeg') + ';base64,' + btoa(bin);
          var cs = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
          for (var c of cs) c.postMessage({ type: 'share-file', dataUrl: b64 });
        }
      } catch (e) { /* ignore, still redirect */ }
      return Response.redirect('/?ingest=share', 303);
    })());
  }
});
