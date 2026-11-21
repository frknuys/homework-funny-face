// Filtreler. Her filtre iki parçadan oluşur:
//   1) draw: kişinin fotoğrafındaki yüze çizilen filtre (örneğin palyaço makyajı)
//   2) meme: o filtreye benzeyen bir meme görseli (örneğin bir palyaço resmi)
// Gösterinin jeneriğinde "kişinin fotoğrafı + meme" birleşiyormuş gibi görünür, sonunda kişinin
// fotoğrafının o filtreyle filtrelenmiş hali çıkar. Her kişiye FILTERS içinden rastgele bir filtre gelir.
//
// Yeni filtre eklemek için:
//   - meme görselini src/memes/ içine koy; sunucu onu /memes/<dosya adı> adresinden verir
//   - yüze çizen bir draw fonksiyonu yaz (drawClown örneğine bak)
//   - FILTERS listesine { id, name, meme, draw } olarak ekle
import { FaceDetector, FilesetResolver } from "@mediapipe/tasks-vision";

// ─── Yüz bulma ───

// Hafif yüz bulma modeli (~230 KB)
const MODEL =
  "https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite";

export async function createDetector(): Promise<FaceDetector> {
  const fileset = await FilesetResolver.forVisionTasks("/wasm"); // wasm dosyaları Bun sunucusundan
  const make = (delegate: "GPU" | "CPU") =>
    FaceDetector.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL, delegate },
      runningMode: "IMAGE",
    });
  return make("GPU").catch(() => make("CPU"));
}

export type Pt = { x: number; y: number };

/**
 * Bir yüz, burun ucunu merkez alan ve baş eğimine göre döndürülmüş "yerel" koordinatlarda verilir:
 * x sağa, y aşağı; (0,0) burun ucu. Filtreler bu koordinatlarda çizer, eğik başta da doğru durur.
 */
export type Face = {
  eyeL: Pt; // ekranda soldaki göz
  eyeR: Pt; // ekranda sağdaki göz
  mouth: Pt;
  earL: Pt;
  earR: Pt;
  e: number; // gözler arası uzaklık (px): tüm boyutlar buna göre ölçeklenir
};

/** Fotoğraftaki yüzleri bulur; her yüz için çizim bağlamını yüzün yerel koordinatlarına taşıyıp çağırır. */
function forEachFace(ctx: CanvasRenderingContext2D, detector: FaceDetector, cb: (face: Face) => void) {
  const { width: W, height: H } = ctx.canvas;
  for (const d of detector.detect(ctx.canvas).detections) {
    const k = d.keypoints;
    if (k.length < 6) continue;
    const p = (i: number): Pt => ({ x: k[i]!.x * W, y: k[i]!.y * H });
    // BlazeFace noktaları: 0,1 gözler · 2 burun ucu · 3 ağız · 4,5 kulak önleri
    const [a, b] = [p(0), p(1)].sort((u, v) => u.x - v.x) as [Pt, Pt];
    const [ea, eb] = [p(4), p(5)].sort((u, v) => u.x - v.x) as [Pt, Pt];
    const nose = p(2);
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    const cos = Math.cos(-angle);
    const sin = Math.sin(-angle);
    const local = (q: Pt): Pt => ({
      x: cos * (q.x - nose.x) - sin * (q.y - nose.y),
      y: sin * (q.x - nose.x) + cos * (q.y - nose.y),
    });
    ctx.save();
    ctx.translate(nose.x, nose.y);
    ctx.rotate(angle);
    cb({ eyeL: local(a), eyeR: local(b), mouth: local(p(3)), earL: local(ea), earR: local(eb), e: Math.hypot(b.x - a.x, b.y - a.y) });
    ctx.restore();
  }
}

// ─── Filtreler ───

export type FunnyFilter = {
  id: string;
  name: string; // jenerikte görünen rol adı: "as The Clown"
  meme: string; // filtreye benzeyen meme görselinin adresi: "/memes/<src/memes içindeki dosya adı>"
  draw: (ctx: CanvasRenderingContext2D, face: Face) => void; // yüzün yerel koordinatlarında çizer
};

/**
 * Fotoğrafın (x,y) çevresindeki bölgeyi k kat büyütüp yerine koyar (göz büyütme gibi).
 * (x,y) ve R yüzün yerel koordinatlarında; kenarlar yumuşak geçişli, yapıştırılmış gibi durmaz.
 */
function magnify(ctx: CanvasRenderingContext2D, x: number, y: number, R: number, k: number) {
  const p = ctx.getTransform().transformPoint(new DOMPoint(x, y)); // fotoğraf piksel koordinatı
  const size = Math.max(2, Math.ceil(R * 2));
  const tmp = document.createElement("canvas");
  tmp.width = size;
  tmp.height = size;
  const t = tmp.getContext("2d")!;
  const sr = R / k; // kaynak bölge yarıçapı: küçük bölge büyük daireye yayılır
  t.drawImage(ctx.canvas, p.x - sr, p.y - sr, sr * 2, sr * 2, 0, 0, size, size);
  t.globalCompositeOperation = "destination-in";
  const g = t.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "#000");
  g.addColorStop(0.6, "#000");
  g.addColorStop(1, "rgba(0,0,0,0)");
  t.fillStyle = g;
  t.fillRect(0, 0, size, size);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(tmp, p.x - size / 2, p.y - size / 2);
  ctx.restore();
}

const RAINBOW = ["#ff453a", "#ff9f0a", "#ffd60a", "#30d158", "#0a84ff", "#bf5af2"];

// Palyaço: renkli peruk, göz baklavaları, yanak allığı, kırmızı burun
function drawClown(ctx: CanvasRenderingContext2D, f: Face) {
  const { e } = f;

  // Renkli kıvırcık peruk: iki kulağın çevresinde toplar
  for (const [ear, s] of [
    [f.earL, -1],
    [f.earR, 1],
  ] as const) {
    const curls: [number, number, number][] = [
      [0.15, -0.15, 0.36],
      [0.35, -0.55, 0.32],
      [0.1, -0.95, 0.3],
      [0.45, 0.2, 0.3],
      [-0.15, -1.25, 0.26],
      [0.3, 0.6, 0.26],
    ];
    curls.forEach(([dx, dy, r], i) => {
      ctx.fillStyle = RAINBOW[(i + (s > 0 ? 3 : 0)) % RAINBOW.length]!;
      ctx.beginPath();
      ctx.arc(ear.x + s * dx * e, ear.y + dy * e, r * e, 0, Math.PI * 2);
      ctx.fill();
    });
  }

  // Yanak allığı
  for (const [eye, s] of [
    [f.eyeL, -1],
    [f.eyeR, 1],
  ] as const) {
    const cx = eye.x + s * 0.12 * e;
    const cy = (eye.y + f.mouth.y) / 2 + 0.05 * e;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, 0.32 * e);
    g.addColorStop(0, "rgba(255,69,58,0.6)");
    g.addColorStop(1, "rgba(255,69,58,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, 0.32 * e, 0, Math.PI * 2);
    ctx.fill();
  }

  // Göz baklavaları: gözün üstünde ve altında birer üçgen (göz açıkta kalır)
  ctx.fillStyle = "rgba(10,132,255,0.6)";
  for (const eye of [f.eyeL, f.eyeR]) {
    for (const dir of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(eye.x, eye.y + dir * 0.75 * e);
      ctx.lineTo(eye.x - 0.16 * e, eye.y + dir * 0.22 * e);
      ctx.lineTo(eye.x + 0.16 * e, eye.y + dir * 0.22 * e);
      ctx.closePath();
      ctx.fill();
    }
  }

  // Kırmızı burun (parlak top)
  const r = 0.27 * e;
  const g = ctx.createRadialGradient(-0.3 * r, -0.35 * r, 0, 0, 0, r);
  g.addColorStop(0, "#ff8a80");
  g.addColorStop(0.55, "#e5383b");
  g.addColorStop(1, "#a4161a");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.75)";
  ctx.beginPath();
  ctx.ellipse(-0.32 * r, -0.36 * r, 0.26 * r, 0.18 * r, 0, 0, Math.PI * 2);
  ctx.fill();
}

// Kibar kedi: kocaman gözler, kedi kulakları, pembe kedi burnu, beyaz bıyık yastıkları, bıyıklar
function drawPoliteCat(ctx: CanvasRenderingContext2D, f: Face) {
  const { e } = f;
  const eyeY = (f.eyeL.y + f.eyeR.y) / 2;

  // Kocaman gözler: önce fotoğraftaki gözleri büyüt (diğer çizimler bunun üstüne gelir)
  for (const eye of [f.eyeL, f.eyeR]) magnify(ctx, eye.x, eye.y, 0.42 * e, 1.6);

  // Kedi kulakları: alnın hemen üstünde (selfie'de yüz kadrajı doldursa da görünsün), biraz dışa açık
  for (const s of [-1, 1]) {
    ctx.save();
    ctx.translate(s * 0.78 * e, eyeY - 0.95 * e);
    ctx.rotate(s * 0.3);
    // dış kulak (beyaz kürk, ince gri kenar)
    ctx.fillStyle = "#f7f4f2";
    ctx.strokeStyle = "rgba(60,60,60,0.45)";
    ctx.lineWidth = 0.035 * e;
    ctx.beginPath();
    ctx.moveTo(-0.4 * e, 0.2 * e);
    ctx.quadraticCurveTo(-0.28 * e, -0.5 * e, 0, -0.78 * e);
    ctx.quadraticCurveTo(0.28 * e, -0.5 * e, 0.4 * e, 0.2 * e);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // iç kulak (pembe)
    ctx.fillStyle = "#f4b3c2";
    ctx.beginPath();
    ctx.moveTo(-0.23 * e, 0.1 * e);
    ctx.quadraticCurveTo(-0.15 * e, -0.35 * e, 0, -0.55 * e);
    ctx.quadraticCurveTo(0.15 * e, -0.35 * e, 0.23 * e, 0.1 * e);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // Bıyık yastıkları: burnun altında iki yanda beyaz, tombul yanaklar (o kibar gülümseme)
  for (const s of [-1, 1]) {
    const cx = s * 0.21 * e;
    const cy = 0.3 * e;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, 0.32 * e);
    g.addColorStop(0, "rgba(255,255,255,0.9)");
    g.addColorStop(0.65, "rgba(255,255,255,0.6)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(cx, cy, 0.32 * e, 0.26 * e, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // Bıyıklar: her yanda üç çizgi, dışa doğru hafif açılı
  ctx.lineCap = "round";
  ctx.strokeStyle = "rgba(30,30,30,0.85)";
  ctx.lineWidth = 0.035 * e;
  for (const s of [-1, 1]) {
    for (const [y0, y1] of [
      [0.2, 0.05],
      [0.29, 0.29],
      [0.38, 0.54],
    ] as const) {
      ctx.beginPath();
      ctx.moveTo(s * 0.34 * e, y0 * e);
      ctx.quadraticCurveTo(s * 0.78 * e, ((y0 + y1) / 2) * e - 0.04 * e, s * 1.2 * e, y1 * e);
      ctx.stroke();
    }
  }

  // Pembe kedi burnu: yuvarlatılmış ters üçgen
  const n = 0.22 * e;
  ctx.fillStyle = "#f29fb1";
  ctx.beginPath();
  ctx.moveTo(-n, -0.45 * n);
  ctx.quadraticCurveTo(0, -0.8 * n, n, -0.45 * n);
  ctx.quadraticCurveTo(0.2 * n, 0.75 * n, 0, 0.8 * n);
  ctx.quadraticCurveTo(-0.2 * n, 0.75 * n, -n, -0.45 * n);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.6)";
  ctx.beginPath();
  ctx.ellipse(-0.3 * n, -0.35 * n, 0.25 * n, 0.12 * n, 0, 0, Math.PI * 2);
  ctx.fill();

  // Islak bakış: büyütülmüş her göze iki parlak nokta
  for (const eye of [f.eyeL, f.eyeR]) {
    ctx.fillStyle = "rgba(255,255,255,0.95)";
    ctx.beginPath();
    ctx.arc(eye.x - 0.08 * e, eye.y - 0.08 * e, 0.075 * e, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.75)";
    ctx.beginPath();
    ctx.arc(eye.x + 0.06 * e, eye.y + 0.05 * e, 0.033 * e, 0, Math.PI * 2);
    ctx.fill();
  }
}

// Tüm filtreler: her kişiye bunlardan biri rastgele gelir. (Hedef: 30 filtre, her biri kendi meme'siyle.)
export const FILTERS: FunnyFilter[] = [
  { id: "clown", name: "The Clown", meme: "/memes/clown.jpeg", draw: drawClown },
  { id: "polite-cat", name: "The Polite Cat", meme: "/memes/polite-cat.webp", draw: drawPoliteCat },
];

// Rastgele ama tekrarsız: bir filtre kullanılınca, tüm filtreler birer kez kullanılana kadar tekrar gelmez.
// Hepsi bitince torba yeniden dolar. (Torba showroom sayfası açık kaldığı sürece gösteriler arasında da korunur.)
let bag: FunnyFilter[] = [];
export function pickFilter(): FunnyFilter {
  if (bag.length === 0) bag = [...FILTERS];
  return bag.splice(Math.floor(Math.random() * bag.length), 1)[0]!;
}

/** Fotoğraftaki her yüze filtreyi çizer, filtrelenmiş JPEG'i döndürür. Yüz bulunamazsa fotoğraf olduğu gibi kalır. */
export async function applyFilter(photo: Blob, filter: FunnyFilter, detector: FaceDetector | null): Promise<Blob> {
  const bmp = await createImageBitmap(photo);
  const canvas = document.createElement("canvas");
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  if (detector) forEachFace(ctx, detector, face => filter.draw(ctx, face));
  return new Promise((resolve, reject) =>
    canvas.toBlob(b => (b ? resolve(b) : reject(new Error("JPEG üretilemedi"))), "image/jpeg", 0.9),
  );
}

// Test/önizleme için: filtreyi verilen yüz noktalarıyla (görüntü koordinatlarında) çizer
export function drawOnPoints(ctx: CanvasRenderingContext2D, filter: FunnyFilter, pts: Record<"eyeA" | "eyeB" | "nose" | "mouth" | "earA" | "earB", Pt>) {
  const [a, b] = [pts.eyeA, pts.eyeB].sort((u, v) => u.x - v.x) as [Pt, Pt];
  const [ea, eb] = [pts.earA, pts.earB].sort((u, v) => u.x - v.x) as [Pt, Pt];
  const angle = Math.atan2(b.y - a.y, b.x - a.x);
  const cos = Math.cos(-angle);
  const sin = Math.sin(-angle);
  const local = (q: Pt): Pt => ({ x: cos * (q.x - pts.nose.x) - sin * (q.y - pts.nose.y), y: sin * (q.x - pts.nose.x) + cos * (q.y - pts.nose.y) });
  ctx.save();
  ctx.translate(pts.nose.x, pts.nose.y);
  ctx.rotate(angle);
  filter.draw(ctx, { eyeL: local(a), eyeR: local(b), mouth: local(pts.mouth), earL: local(ea), earR: local(eb), e: Math.hypot(b.x - a.x, b.y - a.y) });
  ctx.restore();
}
