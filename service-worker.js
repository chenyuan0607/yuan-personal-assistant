const CACHE = "yuan-assistant-v4";
const PLAN_KEY = new Request("./data/today.json");
const SHELL = ["./", "./index.html", "./styles.css", "./js/app.js", "./js/tasks.js", "./js/ledger.js", "./js/ledger-ui.js", "./js/history.js", "./js/weekly.js", "./js/review-ui.js", "./manifest.webmanifest", "./data/today.json", "./data/weekly.json", "./icons/icon-192.png", "./icons/icon-512.png"];
self.addEventListener("install", (event) => event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())));
self.addEventListener("activate", (event) => event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const isPlan = /\/data\/(today|weekly)\.json$/.test(new URL(event.request.url).pathname);
  if (isPlan) {
    const key = new URL(event.request.url).pathname.endsWith("weekly.json") ? new Request("./data/weekly.json") : PLAN_KEY;
    event.respondWith(fetch(event.request).then((response) => { const copy = response.clone(); caches.open(CACHE).then((cache) => cache.put(key, copy)); return response; }).catch(() => caches.match(key)));
  } else event.respondWith(caches.match(event.request).then((cached) => cached || fetch(event.request)));
});
