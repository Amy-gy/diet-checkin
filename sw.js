self.addEventListener("install", event => {
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  event.waitUntil(self.clients.claim());
});

// 保留 Service Worker 注册与更新能力；新版不再使用网页推送提醒。
