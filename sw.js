
self.addEventListener("install", event => {
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", event => {
  let data = {};

  if (event.data) {
    try {
      data = event.data.json();
    } catch {
      data = { body: event.data.text() };
    }
  }

  event.waitUntil(
    self.registration.showNotification(
      data.title || "饮食自律提醒 🌿",
      {
        body: data.body || "别忘了完成今天的饮食打卡！",
        icon: "./",
        badge: "./",
        tag: data.tag || "diet-reminder",
        data: { url: data.url || "./" }
      }
    )
  );
});

self.addEventListener("notificationclick", event => {
  event.notification.close();

  event.waitUntil(
    clients.openWindow(event.notification.data.url || "./")
  );
});
