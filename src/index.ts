import { serve, type Server } from "bun";
import { existsSync, mkdirSync, readdirSync, renameSync, unlinkSync, watch } from "node:fs";
import admin from "./admin.html";
import camera from "./camera.html";
import showroom from "./showroom.html";
import { MAX_PHOTOS, ROLES, type ClientMsg, type Presence, type Role, type ServerMsg, type Settings } from "./shared";

type WsData = { role: Role };

const WASM_DIR = new URL("../node_modules/@mediapipe/tasks-vision/wasm/", import.meta.url);
const PORT = Number(process.env.PORT ?? 3000);
// Telefonlar tünel üzerinden bağlanır (kamera için HTTPS şart; HTTPS'i tünel sağlar).
// PUBLIC_URL verilirse QR koddaki adres odur; verilmezse showroom'un açıldığı adres kullanılır.
const PUBLIC_URL = process.env.PUBLIC_URL?.replace(/\/+$/, "");

// Gelen fotoğraflar sunucuda bu klasörde N.jpg olarak tutulur (çekildiği gibi, filtresiz).
// Filtre sadece gösterinin jeneriğinde uygulanır, kaydedilen fotoğrafa dokunulmaz.
const PHOTO_DIR = `${import.meta.dir}/../photos`;
const RAW_DIR = `${PHOTO_DIR}/raw`; // eski sürümden kalan ham kopyaların arşivi (sayılmaz)
mkdirSync(RAW_DIR, { recursive: true });

// Eski sürümden kalan N.raw.jpg dosyaları: hazır hali varsa arşive taşı, yoksa fotoğrafın kendisi yap
for (const f of readdirSync(PHOTO_DIR)) {
  const m = /^(\d+)\.raw\.jpg$/.exec(f);
  if (!m) continue;
  const target = existsSync(`${PHOTO_DIR}/${m[1]}.jpg`) ? `${RAW_DIR}/${m[1]}.jpg` : `${PHOTO_DIR}/${m[1]}.jpg`;
  renameSync(`${PHOTO_DIR}/${f}`, target);
}

function scanPhotos() {
  const ids = readdirSync(PHOTO_DIR)
    .map(f => /^(\d+)\.jpg$/.exec(f)?.[1])
    .filter((n): n is string => !!n)
    .map(Number)
    .sort((a, b) => a - b);
  return { ids, pending: [] as number[], all: ids, total: ids.length };
}
let nextId = Math.max(0, ...scanPhotos().all) + 1;

const gzipCache = new Map<string, Uint8Array<ArrayBuffer>>();

// Sayfanın dışarıdan açıldığı adres (tünel varsa tünelin adresi)
function publicOrigin(req: Request) {
  const url = new URL(req.url);
  const proto = req.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? url.host;
  return `${proto}://${host}`;
}

const servers: Server<WsData>[] = [];

// Admin sayfasından değiştirilen canlı ayarlar (sunucu yeniden başlayınca varsayılana döner: QR kapalı)
const settings: Settings = { showQr: false };

// Bağlı tüm socket'ler
const sockets = new Set<Bun.ServerWebSocket<WsData>>();

function broadcast(msg: ServerMsg) {
  const data = JSON.stringify(msg);
  for (const s of servers) s.publish("all", data);
}

// Klasörü izle: sunucu açıkken fotoğraflar elle silinirse herkesin sayısı ve ekranı güncellensin
let known = new Set(scanPhotos().all);
let watchTimer: ReturnType<typeof setTimeout> | undefined;
const g = globalThis as { __photoWatcher?: { close(): void } };
g.__photoWatcher?.close(); // bun --hot yeniden yüklerken eski izleyici birikmesin
g.__photoWatcher = watch(PHOTO_DIR, () => {
  clearTimeout(watchTimer);
  watchTimer = setTimeout(() => {
    const now = new Set(scanPhotos().all);
    const removed = [...known].filter(id => !now.has(id));
    known = now;
    if (removed.length) broadcast({ type: "removed", ids: removed });
  }, 200);
});

function presence(): Presence {
  const p: Presence = { camera: 0, showroom: 0, admin: 0 };
  for (const ws of sockets) p[ws.data.role]++;
  return p;
}

const config = {
  routes: {
    "/": new Response(null, { status: 302, headers: { Location: "/camera" } }),
    "/camera": camera,
    "/showroom": showroom,
    "/admin": admin,

    // Meme görselleri (src/memes/): jenerikte filtrenin meme'i olarak gösterilir
    "/memes/:file": (req: Bun.BunRequest<"/memes/:file">) => {
      const name = req.params.file;
      if (!/^[\w-]+(\.[\w-]+)*\.(jpe?g|png|webp|gif|svg)$/i.test(name)) return new Response("Not found", { status: 404 });
      return new Response(Bun.file(`${import.meta.dir}/memes/${name}`), { headers: { "Cache-Control": "no-cache" } });
    },

    // MediaPipe wasm dosyaları
    // gzip ile gönderilir (14 MB → 4 MB), bir kez sıkıştırılıp bellekte tutulur
    "/wasm/:file": async (req: Bun.BunRequest<"/wasm/:file">) => {
      const name = req.params.file;
      if (!/^vision_wasm\w*\.(js|wasm)$/.test(name)) return new Response("Not found", { status: 404 });
      const type = name.endsWith(".wasm") ? "application/wasm" : "text/javascript";
      const headers = { "Content-Type": type, "Cache-Control": "public, max-age=86400" };
      if (!req.headers.get("accept-encoding")?.includes("gzip")) {
        return new Response(Bun.file(new URL(name, WASM_DIR)), { headers });
      }
      let gz = gzipCache.get(name);
      if (!gz) {
        gz = Bun.gzipSync(await Bun.file(new URL(name, WASM_DIR)).arrayBuffer());
        gzipCache.set(name, gz);
      }
      return new Response(gz, { headers: { ...headers, "Content-Encoding": "gzip" } });
    },

    // Telefonların gireceği adres (showroom'daki QR kod)
    "/api/info": (req: Request) => Response.json({ join: `${PUBLIC_URL ?? publicOrigin(req)}/camera` }),

    // Telefondan gelen fotoğraf (filtresiz kaydedilir)
    "/api/photo": {
      async POST(req: Request) {
        if (scanPhotos().total >= MAX_PHOTOS) return Response.json({ error: "full" }, { status: 409 });
        const data = await req.arrayBuffer();
        if (data.byteLength === 0 || data.byteLength > 5_000_000) return new Response("Bad photo", { status: 400 });
        if (scanPhotos().total === 0) nextId = 1; // klasör boşaltıldıysa numaralar yeniden 1'den başlar
        const id = nextId++;
        await Bun.write(`${PHOTO_DIR}/${id}.jpg`, data);
        broadcast({ type: "photo", id }); // showroom anında sıraya ekler
        return Response.json({ id });
      },
    },

    // Fotoğraf
    "/photos/:id": (req: Bun.BunRequest<"/photos/:id">) => {
      if (!/^\d+$/.test(req.params.id)) return new Response("Not found", { status: 404 });
      const f = Bun.file(`${PHOTO_DIR}/${req.params.id}.jpg`);
      return new Response(f, { headers: { "Content-Type": "image/jpeg", "Cache-Control": "no-cache" } });
    },
  },

  // Canlı bağlantı: /ws?role=camera|showroom|admin
  fetch(req: Request, server: Server<WsData>) {
    const url = new URL(req.url);
    const role = url.searchParams.get("role") as Role;
    if (url.pathname === "/ws" && ROLES.includes(role) && server.upgrade(req, { data: { role } })) return;
    return new Response("Not found", { status: 404 });
  },
  websocket: {
    open(ws: Bun.ServerWebSocket<WsData>) {
      ws.subscribe("all");
      sockets.add(ws);
      const { ids, pending } = scanPhotos();
      ws.send(JSON.stringify({ type: "photos", ids, pending } satisfies ServerMsg));
      ws.send(JSON.stringify({ type: "settings", settings } satisfies ServerMsg));
      broadcast({ type: "presence", presence: presence() });
    },
    close(ws: Bun.ServerWebSocket<WsData>) {
      sockets.delete(ws);
      broadcast({ type: "presence", presence: presence() });
    },
    message(ws: Bun.ServerWebSocket<WsData>, raw: string | Buffer) {
      // Sadece admin ayar değiştirebilir ve fotoğraf silebilir
      if (ws.data.role !== "admin" || typeof raw !== "string") return;
      let m: ClientMsg;
      try {
        m = JSON.parse(raw);
      } catch {
        return;
      }
      if (m.type === "set" && m.key === "showQr" && typeof m.value === "boolean") {
        settings.showQr = m.value;
        broadcast({ type: "settings", settings });
      } else if (m.type === "deleteAll") {
        // Tüm fotoğrafları sil (arşivdeki ham kopyalar dahil). Klasör izleyicisi silinenleri herkese bildirir.
        for (const dir of [PHOTO_DIR, RAW_DIR]) {
          if (!existsSync(dir)) continue;
          for (const f of readdirSync(dir)) if (/^\d+(\.raw)?\.jpg$/.test(f)) unlinkSync(`${dir}/${f}`);
        }
        console.log("🗑  Admin tüm fotoğrafları sildi");
      }
    },
  },

  development: process.env.NODE_ENV !== "production" && {
    hmr: true,
    console: true,
  },
};

servers.push(serve({ ...config, port: PORT }));

console.log(`💾 Fotoğraflar: ${PHOTO_DIR}`);
console.log(`🖼  Showroom:    http://localhost:${PORT}/showroom`);
console.log(`🛠  Admin:       http://localhost:${PORT}/admin`);
console.log(
  PUBLIC_URL
    ? `📱 Kamera:      ${PUBLIC_URL}/camera`
    : `📱 Kamera:      <tünel adresi>/camera  (QR kodda doğru adres için: PUBLIC_URL=<tünel adresi> bun dev)`,
);
