const CACHE = "yuan-assistant-v2";
const PLAN_KEY = new Request("./data/today.json");
const SHELL = ["./", "./index.html", "./styles.css", "./js/app.js", "./js/tasks.js", "./js/ledger.js", "./js/ledger-ui.js", "./manifest.webmanifest", "./data/today.json", "./icons/icon-192.png", "./icons/icon-512.png"];
self.addEventListener("install", (event) => event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL))));
self.addEventListener("activate", (event) => event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const isPlan = new URL(event.request.url).pathname.endsWith("/data/today.json");
  if (isPlan) {
    event.respondWith(fetch(event.request).then((response) => { const copy = response.clone(); caches.open(CACHE).then((cache) => cache.put(PLAN_KEY, copy)); return response; }).catch(() => caches.match(PLAN_KEY)));
  } else event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
});
