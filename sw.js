// Me Leva: abre sem internet depois da primeira visita.
// Mude a VERSAO sempre que atualizar o app.
const VERSAO = "me-leva-v1";
const ARQUIVOS = ["./", "index.html", "assets/styles.css", "assets/app.js", "assets/icone.svg", "assets/icone-192.png", "assets/icone-512.png", "manifest.webmanifest"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSAO).then((c) => Promise.allSettled(ARQUIVOS.map((u) => c.add(u)))).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSAO).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
// Arquivos do próprio app: usa o guardado na hora e atualiza em segundo plano.
// Avisos (ntfy), mapas e endereços: sempre pela internet.
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  const fonte = /fonts\.(googleapis|gstatic)\.com$/.test(url.hostname);
  if (url.origin !== location.origin && !fonte) return;
  e.respondWith(caches.open(VERSAO).then(async (c) => {
    const salvo = await c.match(e.request, { ignoreSearch: url.origin === location.origin });
    const rede = fetch(e.request).then((r) => { if (r.ok || r.type === "opaque") c.put(e.request, r.clone()); return r; });
    if (salvo) { e.waitUntil(rede.catch(() => {})); return salvo; }
    return rede;
  }));
});
