// Service Worker пульта /app/ (ТЗ v2.0 §3, 31.10.2026): push-уведомления, когда пульт закрыт. Ничего не кэширует — пульт и
// переписки всегда с сервера, на устройстве сотрудника их нет. Сообщение приходит зашифрованным (Web Push) и содержит только
// то, что показать: заголовок, строку, адрес чата в пульте (данные чата пульт берёт с сервера уже со входом).
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

// Safari (iPhone, iPad, Mac) отключает push сайту, который получил уведомление и ничего не показал, — там показываем всегда
const UA = self.navigator.userAgent || "";
const MUST_SHOW = /AppleWebKit/.test(UA) && !/Chrome|Chromium|CriOS|Edg|Android/.test(UA);
const own = (u) => {
  try {
    const x = new URL(u, self.location.origin);
    return x.origin === self.location.origin && x.pathname.startsWith("/app/") ? x : null;
  } catch {
    return null;
  }
};

self.addEventListener("push", (e) => {
  let d = {};
  try {
    d = e.data ? e.data.json() : {};
  } catch {
    d = {};
  }
  e.waitUntil(
    (async () => {
      const url = own(d.u) || new URL("/app/", self.location.origin);
      if (typeof d.n === "number" && "setAppBadge" in self.navigator) {
        try {
          if (d.n > 0) await self.navigator.setAppBadge(d.n);
          else await self.navigator.clearAppBadge();
        } catch {
          /* значок на иконке не поддерживается */
        }
      }
      if (!MUST_SHOW && d.c) {
        // тот же чат уже открыт перед глазами — не шумим (кроме Safari, см. MUST_SHOW)
        const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
        const same = (w) => {
          const x = own(w.url);
          return !!x && x.search === url.search && x.hash === url.hash;
        };
        if (wins.some((w) => w.focused && w.visibilityState === "visible" && same(w))) return;
      }
      await self.registration.showNotification(String(d.t || "Пульт"), {
        body: String(d.b || ""),
        tag: d.g ? String(d.g) : undefined,
        renotify: !!d.g,
        icon: "/app/icon-192.png",
        badge: "/app/icon-192.png",
        data: { url: url.href },
      });
    })(),
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = own(e.notification.data && e.notification.data.url) || new URL("/app/", self.location.origin);
  e.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const w = wins.find((x) => own(x.url));
      if (w) {
        await w.focus();
        // открытый пульт сам переходит к чату (тот же адрес — без перезагрузки); вход и права снова проверит сервер
        w.postMessage({ type: "pult-open", url: url.href });
        return;
      }
      await self.clients.openWindow(url.href);
    })(),
  );
});
