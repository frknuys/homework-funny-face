// Ekranın ortasında görünmez bir yörünge (halka) etrafında dönen fotoğraf simülasyonu: her şey merkeze değil bu yörüngeye çekilir.
// DOM'a dokunmaz, bu yüzden tarayıcı olmadan test edilebilir.

import { SCATTER_AT } from "./shared";

export const TAU = Math.PI * 2;

// Dönüş hızı: tam hız SCATTER_AT (30) fotoğrafta olur ve eski tam hızın MAX_SPIN (7) katıdır.
// Hız 30 eşit parçaya bölünmüştür: her fotoğraf tam hızın 1/30'unu ekler (15 fotoğraf = yarısı, 30+ = tam).
const MAX_SPIN = 7; // en yüksek hız (eski hızın 7 katı)
const SPIN_RISE = 1.5; // hız çarpanı yeni değerine bu hızla yumuşakça ulaşır (1/sn), zıplama olmaz
const CHUNK = 1 / 60; // yüksek hızda fizik zamanı en çok bu kadarlık parçalara bölünerek ilerler (içinden geçme olmasın)
const MAX_CHUNKS = 80; // bir karede en çok kaç parça (donmayı önlemek için)
let kickIn = 2; // bir sonraki rastgele fırlatmaya kalan süre (gerçek sn)

// Gösteri: fotoğraflar yavaşça durur (FREEZE_TIME sn'de), gösteri bitince yavaşça yeniden hareketlenir
const FREEZE_TIME = 2.5;
let frozen = 0; // 0 = serbest, 1 = tamamen durmuş
let freezeTarget = 0;
export function setFrozen(on: boolean) {
  freezeTarget = on ? 1 : 0;
}
let spin = -1; // şu anki hız çarpanı (0..MAX_SPIN); -1 = henüz başlamadı

// Fizik ayarları
const RING_K = 0.5; // her fotoğrafın kendi yörüngesine çekim sertliği (1/sn²). Küçükse yörüngeden daha kolay çıkar
const RING_FALLOFF = 1; // yörüngeden bu kadar (ana yörünge yarıçapının katı) uzaklaşınca çekim zayıflamaya başlar: uzaktakini daha az çeker
const RING_DAMP = 0.02; // iç-dış salınımı çok az sönümler (1/sn): fotoğraflar yörüngelerinin içinden dışından geçip dolaşır
const OMEGA = 0.3; // ana yörüngedeki dönüş hızı (rad/sn, fizik zamanında): 1080p'de ~21 sn'de bir tur
const SWIRL = 0.15; // her fotoğrafı kendi dönüş hızına doğru zayıfça çeker (1/sn)
const NOISE = 150; // sürekli küçük rastgele itmeler (px/sn²): yörüngeler kıpır kıpır, tam düzgün değil
const FLING_EVERY: [number, number] = [1.2, 3.7]; // birkaç saniyede bir rastgele bir fotoğraf fırlatılır (gerçek sn, aralık)
const PAIR_E = 0.9; // fotoğraflar arası çarpışma esnekliği (1 = tam esnek)
const WALL_E = 0.9; // ekran kenarlarından seken fotoğrafın esnekliği

export type Body = {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number; // şu anki yarıçap (hedefe doğru yumuşakça büyür/küçülür)
  placed: boolean; // ilk konum ve hız verildi mi
  free: number; // sahneden yeni çıktıysa: bu kadar saniye çarpışmalar kapalı
  pref: number; // tercih ettiği yörünge: ana yörüngenin kaç katı (her fotoğrafın kendi mesafesi var)
  k: number; // kendi hız çarpanı
};

export const newBody = (id: number): Body => ({
  id,
  x: 0,
  y: 0,
  vx: 0,
  vy: 0,
  r: 0,
  placed: false,
  free: 0,
  pref: 0.55 + Math.random() * 0.9, // 0,55–1,45 kat: geniş bir disk, tek bir daire değil
  k: 0.75 + Math.random() * 0.5,
});

// Ekrana göre ölçeklenen sabitler.
export function geometry(W: number, H: number) {
  const m = Math.min(W, H);
  const rMax = Math.max(60, Math.min(W / 2 - 16, H / 2 - 70));
  return {
    m,
    cx: W / 2,
    cy: H / 2 + 20, // üst çubuğa yer bırakmak için biraz aşağıda
    rMax,
    orbit: Math.min(rMax * 0.4, m * 0.15), // fotoğrafların toplandığı yörüngenin yarıçapı (1080p'de ~162 px)
  };
}

// Bir fotoğrafın R uzaklığındaki hedef dönüş hızı: içtekiler dıştakilerden hızlı döner (karadelik diski gibi)
const orbitSpeed = (R: number, orbit: number, k: number) => OMEGA * orbit * Math.sqrt(orbit / Math.max(R, 20)) * k;

// Yeni bir cismi yörüngenin yakınına, dönüş yönünde bir hızla koyar
function place(b: Body, W: number, H: number) {
  const { cx, cy, orbit } = geometry(W, H);
  const R = orbit * b.pref * (0.85 + Math.random() * 0.3);
  const a = Math.random() * TAU;
  const v = orbitSpeed(R, orbit, b.k) * (0.9 + Math.random() * 0.2);
  const vr = (Math.random() - 0.5) * 220; // iç-dış hareket: her fotoğraf yörüngesini farklı genlikte keser
  b.x = cx + Math.cos(a) * R;
  b.y = cy + Math.sin(a) * R;
  b.vx = -Math.sin(a) * v + Math.cos(a) * vr;
  b.vy = Math.cos(a) * v + Math.sin(a) * vr;
  b.placed = true;
}

// Sahneden çıkan fotoğraf: ekranın ortasından başlar, yörünge onu kendine çeker
export function launch(b: Body, W: number, H: number) {
  const { cx, cy, m } = geometry(W, H);
  const a = Math.random() * TAU;
  const out = m * 0.05;
  const tan = m * 0.09;
  b.x = cx;
  b.y = cy;
  b.vx = Math.cos(a) * out - Math.sin(a) * tan;
  b.vy = Math.sin(a) * out + Math.cos(a) * tan;
  b.r = Math.min(W * 0.76, H * 0.54) / 2; // sahnedeki fotoğrafla aynı boyut
  b.free = 0.9;
  b.placed = true;
}

type Geo = ReturnType<typeof geometry>;

// Fizik zamanını sdt kadar ilerletir: yörüngeye çekim, dönüşü canlı tutma, ekran kenarları, çarpışmalar
function advance(bodies: Body[], sdt: number, W: number, H: number, { cx, cy, orbit }: Geo) {
  const n = bodies.length;

  // Yörüngeye çekim: merkeze değil, merkezden `orbit` uzaklıktaki halkaya doğru bir yay gibi çeker.
  // Halkanın içindeki de dışındaki de (savrulanlar, sahneden fırlayanlar) halkaya geri döner.
  const steps = 4;
  const h = sdt / steps;
  for (let s = 0; s < steps; s++) {
    for (const b of bodies) {
      const dx = b.x - cx;
      const dy = b.y - cy;
      const R = Math.hypot(dx, dy) || 0.01;
      const nx = dx / R;
      const ny = dy / R;
      const vr = b.vx * nx + b.vy * ny;
      const d = R - orbit * b.pref; // kendi yörüngesinden sapma
      const a = (-RING_K * d) / (1 + Math.abs(d) / (orbit * RING_FALLOFF)) - RING_DAMP * vr; // uzaklaştıkça çekim azalır
      b.vx += nx * a * h;
      b.vy += ny * a * h;
      b.x += b.vx * h;
      b.y += b.vy * h;
    }
  }

  // Sürekli küçük rastgele itmeler (türbülans): yörüngeler hiçbir zaman tam düzgün olmaz
  for (const b of bodies) {
    b.vx += (Math.random() - 0.5) * 2 * NOISE * sdt;
    b.vy += (Math.random() - 0.5) * 2 * NOISE * sdt;
  }

  // Dönüşü canlı tut: teğet hızı yavaşça kendi dönüş hızına yaklaştırır
  for (const b of bodies) {
    if (b.free > 0) continue;
    const dx = b.x - cx;
    const dy = b.y - cy;
    const R = Math.hypot(dx, dy);
    if (R < 20) continue;
    const tx = -dy / R;
    const ty = dx / R;
    const pull = (orbitSpeed(R, orbit, b.k) - (b.vx * tx + b.vy * ty)) * Math.min(1, SWIRL * sdt);
    b.vx += tx * pull;
    b.vy += ty * pull;
  }

  for (const b of bodies) {
    // ekran kenarlarından seker
    if (b.x < b.r) {
      b.x = b.r;
      b.vx = Math.abs(b.vx) * WALL_E;
    } else if (b.x > W - b.r) {
      b.x = W - b.r;
      b.vx = -Math.abs(b.vx) * WALL_E;
    }
    if (b.y < b.r) {
      b.y = b.r;
      b.vy = Math.abs(b.vy) * WALL_E;
    } else if (b.y > H - b.r) {
      b.y = H - b.r;
      b.vy = -Math.abs(b.vy) * WALL_E;
    }
  }

  // fotoğraflar birbirine çarpınca seker (eşit kütle)
  for (let i = 0; i < n; i++) {
    const p = bodies[i]!;
    if (p.free > 0) continue;
    for (let j = i + 1; j < n; j++) {
      const q = bodies[j]!;
      if (q.free > 0) continue;
      const dx = q.x - p.x;
      const dy = q.y - p.y;
      const min = p.r + q.r;
      if (Math.abs(dx) >= min || Math.abs(dy) >= min) continue;
      const d = Math.hypot(dx, dy);
      if (d >= min || d < 0.01) continue;
      const nx = dx / d;
      const ny = dy / d;
      const push = (min - d) / 2;
      p.x -= nx * push;
      p.y -= ny * push;
      q.x += nx * push;
      q.y += ny * push;
      const rv = (q.vx - p.vx) * nx + (q.vy - p.vy) * ny;
      if (rv < 0) {
        const j2 = -(1 + PAIR_E) * rv * 0.5;
        p.vx -= j2 * nx;
        p.vy -= j2 * ny;
        q.vx += j2 * nx;
        q.vy += j2 * ny;
      }
    }
  }
}

export function step(bodies: Body[], dtRaw: number, W: number, H: number) {
  const dt = Math.min(0.05, dtRaw);
  if (dt <= 0 || bodies.length === 0) return;
  const g = geometry(W, H);
  const n = bodies.length;

  // Hız çarpanı: fotoğraf sayısı / 30 oranında MAX_SPIN'e kadar. Fiziğin zamanı bu kadar hızlı akar:
  // yerçekimi, dönüş ve savrulma hepsi aynı oranda hızlanır, yörünge şekilleri bozulmaz.
  const spinTarget = MAX_SPIN * Math.min(1, n / SCATTER_AT);
  spin = spin < 0 ? spinTarget : spin + (spinTarget - spin) * Math.min(1, dt * SPIN_RISE);

  // Fotoğraf çapı: az varsa orta boy, çok varsa küçülür (ekranın %18'i dolsun)
  // Halka küçük olduğu için çapı halkanın çevresine de göre sınırla: yaklaşık 3 sıra fotoğraf sığsın
  const ringD = (TAU * g.orbit * 3) / n;
  const target = Math.max(24, Math.min(g.m * 0.08, 2 * Math.sqrt((0.18 * g.rMax * g.rMax) / n), ringD)) / 2;

  for (const b of bodies) {
    if (!b.placed) place(b, W, H);
    b.r += (target - b.r) * Math.min(1, dt * 3);
    if (b.free > 0) b.free -= dt;
  }

  // Gösteri sırasında yavaşça dur
  frozen += Math.max(-dt / FREEZE_TIME, Math.min(dt / FREEZE_TIME, freezeTarget - frozen));
  const live = (1 - frozen) ** 2; // yumuşak duruş (sona doğru iyice yavaşlar)

  // Ara sıra rastgele bir fotoğraf rastgele bir yöne fırlatılır (gelgit etkisi gibi), sonra yörüngesine döner
  kickIn -= dt;
  if (kickIn <= 0 && freezeTarget === 0) {
    kickIn = FLING_EVERY[0] + Math.random() * (FLING_EVERY[1] - FLING_EVERY[0]);
    const b = bodies[Math.floor(Math.random() * n)]!;
    if (b.free <= 0) {
      const a = Math.random() * TAU;
      const f = g.m * (0.15 + Math.random() * 0.2);
      b.vx += Math.cos(a) * f;
      b.vy += Math.sin(a) * f;
    }
  }

  // Hızlı akan zamanı küçük parçalara bölerek ilerlet
  const total = dt * spin * live;
  if (total <= 0) return;
  const chunks = Math.min(MAX_CHUNKS, Math.max(1, Math.ceil(total / CHUNK)));
  for (let i = 0; i < chunks; i++) advance(bodies, total / chunks, W, H, g);
}

// Ortada duran herkesi dışarı doğru savurur. Dağıt butonu çıktığı an bunu çağırır.
export function scatter(bodies: Body[], W: number, H: number) {
  const { cx, cy, m } = geometry(W, H);
  for (const b of bodies) {
    let dx = b.x - cx;
    let dy = b.y - cy;
    let d = Math.hypot(dx, dy);
    if (d < 1) {
      const a = Math.random() * TAU;
      dx = Math.cos(a);
      dy = Math.sin(a);
      d = 1;
    }
    const kick = m * (0.2 + Math.random() * 0.2); // savrulma: yaklaşık 215-430; yörünge hepsini geri çeker
    b.vx += (dx / d) * kick;
    b.vy += (dy / d) * kick;
  }
}
