// Service worker for iOS PWA + web push notifications.
// Firebase Messaging needs its own SDK loaded here because service workers
// run in a separate context from the page - they can't reach `firebase` on
// window. Config is injected at build time by build.js.
importScripts('https://www.gstatic.com/firebasejs/10.13.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.13.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: '__FIREBASE_API_KEY__',
  authDomain: '__FIREBASE_AUTH_DOMAIN__',
  projectId: '__FIREBASE_PROJECT_ID__',
  storageBucket: '__FIREBASE_STORAGE_BUCKET__',
  messagingSenderId: '__FIREBASE_MESSAGING_SENDER_ID__',
  appId: '__FIREBASE_APP_ID__'
});

const messaging = firebase.messaging();

// fires when a push arrives while the PWA is CLOSED / in background. iOS
// won't deliver a notification unless the PWA was installed to home screen
// (Safari-only route) and permission was granted while it was open.
messaging.onBackgroundMessage(function(payload) {
  const title = (payload.notification && payload.notification.title) || 'עדכון';
  const body = (payload.notification && payload.notification.body) || '';
  self.registration.showNotification(title, {
    body: body,
    icon: '/assets/icon-192.png',
    badge: '/assets/icon-192.png',
    tag: 'yeshiva-push',
    data: payload.data || {}
  });
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

// minimal install/activate handlers - claim clients immediately so a fresh
// install starts intercepting push events without a reload
self.addEventListener('install', function() { self.skipWaiting(); });
self.addEventListener('activate', function(e) { e.waitUntil(self.clients.claim()); });
