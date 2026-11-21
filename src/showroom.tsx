import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import QRCode from "qrcode";
import type { FaceDetector } from "@mediapipe/tasks-vision";
import { applyFilter, createDetector, pickFilter } from "./filter";
import { Cinema, atLeast, type CastMember, type Phase } from "./cinema";
import { Confirm } from "./confirm";
import { launch, newBody, scatter, setFrozen, step, type Body } from "./physics";
import { useSocket } from "./socket";
import { SCATTER_AT, type Settings } from "./shared";
import "./index.css";

const D = 200; // bubble elementinin css boyutu (gerçek boyut scale ile ayarlanır)

type Bubble = Body & { el: HTMLDivElement | null };

// Yeni fotoğraf sahnesi: bulanık cam zemin üstünde büyük fotoğraf ve küçük bir etiket
function Stage({ id, waiting }: { id: number; waiting: number }) {
  return (
    <div className="stage">
      <div className="star">
        <img src={`/photos/${id}`} alt="" />
      </div>
      <div className="caption">
        <span>Yeni fotoğraf</span>
        <span className="muted">#{id}</span>
        {waiting > 0 && <span className="muted">· {waiting} sırada</span>}
      </div>
    </div>
  );
}

// "Başlat"a basınca iki kez sorulur
const CONFIRM_STEPS = [
  { title: "Gösteriyi başlat?", message: "Ekrandaki tüm fotoğraflarla gösteri başlayacak.", ok: "Evet" },
  { title: "Emin misin?", message: "Son kez soruyorum: gösteri şimdi başlasın mı?", ok: "Başlat" },
];

function Showroom() {
  const [ids, setIds] = useState<number[]>([]);
  const [queue, setQueue] = useState<number[]>([]); // sahneye çıkmayı bekleyenler
  const [featured, setFeatured] = useState<number | null>(null); // şu an sahnede olan
  const [phase, setPhase] = useState<Phase>("idle"); // gösteri aşaması (idle = gösteri yok)
  const [confirmStep, setConfirmStep] = useState(0); // 0 = onay penceresi kapalı, 1-2 = kaçıncı soru
  const [settings, setSettings] = useState<Settings>({ showQr: false });
  const [join, setJoin] = useState("");
  const [qr, setQr] = useState("");

  const bubbles = useRef(new Map<number, Bubble>());
  const hidden = useRef(new Set<number>()); // sahneye çıkana kadar alanda görünmeyenler
  const queueLen = useRef(0);
  queueLen.current = queue.length;
  const shown = ids.length - queue.length; // ekrana çıkmış fotoğraflar (sırada bekleyenler dahil değil)

  const ensure = (id: number, fresh: boolean) => {
    if (bubbles.current.has(id)) return;
    bubbles.current.set(id, { ...newBody(id), el: null });
    if (fresh) hidden.current.add(id);
  };

  // Yeni fotoğraf: filtresiz haliyle anında sıraya girer; aynı anda gelenler geliş sırasıyla tek tek sahneye çıkar.
  // Fotoğrafı çeken kişi kendisine hangi filtrenin geleceğini görmez: filtre gösteride rastgele seçilir.
  const detector = useRef<Promise<FaceDetector> | null>(null); // gösteride filtre uygularken yüz bulmak için
  const seen = useRef(new Set<number>()); // ekrana eklenmiş ya da sırada olanlar

  const addPhoto = (id: number) => {
    if (seen.current.has(id)) return;
    seen.current.add(id);
    ensure(id, true);
    setIds(prev => (prev.includes(id) ? prev : [...prev, id]));
    setQueue(q => (q.includes(id) ? q : [...q, id]));
  };

  useSocket("showroom", m => {
    if (m.type === "photos") {
      m.ids.forEach(id => {
        seen.current.add(id);
        ensure(id, false); // ilk bağlantı: sahnesiz, direkt alanda
      });
      setIds(m.ids);
    } else if (m.type === "photo") addPhoto(m.id);
    else if (m.type === "removed") {
      // Klasörden silinen fotoğrafları ekrandan ve simülasyondan kaldır
      for (const id of m.ids) {
        bubbles.current.delete(id);
        hidden.current.delete(id);
        seen.current.delete(id);
      }
      setIds(prev => prev.filter(id => !m.ids.includes(id)));
      setQueue(q => q.filter(id => !m.ids.includes(id)));
      setFeatured(f => (f !== null && m.ids.includes(f) ? null : f));
    }
    else if (m.type === "settings") setSettings(m.settings);
  });

  // Ortadaki "Başlat" butonu ekranda en az 1 fotoğraf varken hep görünür (basınca gösteri başlar).
  // Fotoğraf sayısı SCATTER_AT'e (30) ulaştığı an (son sahne bitince) her şey bir kez dağılır.
  const scattered = useRef(false);
  useEffect(() => {
    if (shown < SCATTER_AT) scattered.current = false; // sayı 30'un altına inerse, tekrar 30'a gelince yine dağılır
    if (scattered.current || shown < SCATTER_AT || featured !== null || queue.length > 0 || phase !== "idle") return;
    scattered.current = true;
    scatter(
      [...bubbles.current.values()].filter(b => !hidden.current.has(b.id)),
      innerWidth,
      innerHeight,
    );
  }, [shown, featured, queue, phase]);

  // ── Gösteri: ortadaki butona basınca ──
  // yavaşça dur + beyazlaş → yıldız ol → aşağı düş → "You are the star." → "But not today." → jenerik
  const [cast, setCast] = useState<CastMember[]>([]);
  const castRef = useRef(cast);
  castRef.current = cast;
  const showRun = useRef(0); // gösteri numarası: gösteri erken biterse arka plandaki üretim durur

  const startShow = () => {
    if (phase !== "idle") return;
    const run = ++showRun.current;
    // Ekrandaki herkes, sırayla; her birine rastgele bir filtre (ve onun meme'i)
    const members = ids
      .filter(id => !hidden.current.has(id) && bubbles.current.has(id))
      .sort((a, b) => a - b)
      .map(id => ({ id, filter: pickFilter() }));
    setCast(members);
    setPhase("settle");
    setFrozen(true);

    // Filtrelenmiş fotoğrafları arka planda sırayla üret (yıldız ve düşüş aşamaları sürerken)
    (async () => {
      let det: FaceDetector | null = null;
      try {
        detector.current ??= createDetector();
        det = await detector.current;
      } catch (e) {
        console.error("Yüz bulma modeli yüklenemedi, fotoğraflar filtresiz gösterilecek", e);
        detector.current = null;
      }
      for (const m of members) {
        if (showRun.current !== run) return;
        try {
          const res = await fetch(`/photos/${m.id}`);
          if (!res.ok) throw new Error(`fotoğraf alınamadı (${res.status})`);
          const url = URL.createObjectURL(await applyFilter(await res.blob(), m.filter, det));
          if (showRun.current !== run) return URL.revokeObjectURL(url);
          setCast(c => c.map(x => (x.id === m.id ? { ...x, url } : x)));
        } catch (e) {
          console.error(`#${m.id} için filtre uygulanamadı`, e);
        }
      }
    })();
  };

  // Aşamalar arası süreler (ms). "credits" jenerik bitince ilerler, "end" (son ekran) "Başa dön" butonuyla; diğerleri bu süreler sonunda.
  useEffect(() => {
    const next: Partial<Record<Phase, [Phase, number]>> = {
      settle: ["stars", 2600], // yavaşça dur, beyazlaş
      stars: ["fall", 1800], // yıldıza dönüş
      fall: ["star", 1900], // aşağı düşüş, kamera iner
      star: ["today", 4200], // "You are the star." ... biraz bekle
      today: ["credits", 3400], // "But not today."
      outro: ["idle", 1000], // kararıp showroom'a dönüş
    };
    const n = next[phase];
    if (!n) return;
    const t = setTimeout(() => setPhase(n[0]), n[1]);
    return () => clearTimeout(t);
  }, [phase]);

  // Gösteri bitince: fotoğraflar yeniden hareketlenir, üretilen görseller bellekten atılır
  useEffect(() => {
    if (phase !== "idle") return;
    showRun.current++;
    setFrozen(false);
    castRef.current.forEach(m => m.url && URL.revokeObjectURL(m.url));
    setCast([]);
  }, [phase]);

  // Esc: onay penceresini kapat ya da gösteriyi bitir
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setConfirmStep(0); // açık onay penceresini kapat
      setPhase(p => (p === "idle" || p === "outro" ? p : "outro"));
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    fetch("/api/info")
      .then(r => r.json())
      .then(d => setJoin(d.join));
  }, []);

  useEffect(() => {
    if (join) QRCode.toDataURL(join, { margin: 1, width: 720 }).then(setQr);
  }, [join]);

  // Sahne sırası: bir anda tek fotoğraf çıkar, sıra uzunsa daha kısa kalır
  useEffect(() => {
    if (featured === null && queue.length > 0 && phase === "idle") setFeatured(queue[0]!); // gösteri sırasında bekler
  }, [featured, queue, phase]);

  useEffect(() => {
    if (featured === null) return;
    const hold = queueLen.current > 1 ? 900 : 1700; // sahnede kalma süresi (ms); sıra varsa daha kısa
    const t = setTimeout(() => {
      // Sahneden ekranın ortasından fırlar, yerçekimi onu yörüngeye oturtur
      const b = bubbles.current.get(featured);
      if (b) launch(b, innerWidth, innerHeight);
      hidden.current.delete(featured);
      setQueue(q => q.filter(x => x !== featured));
      setFeatured(null);
    }, hold);
    return () => clearTimeout(t);
  }, [featured]);

  // Her karede yerçekimi simülasyonunu ilerletip fotoğrafları yerine koyar
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      const all = [...bubbles.current.values()];
      step(
        all.filter(b => !hidden.current.has(b.id)),
        dt,
        innerWidth,
        innerHeight,
      );
      for (const b of all) {
        if (!b.el) continue;
        if (hidden.current.has(b.id)) {
          b.el.style.visibility = "hidden";
          continue;
        }
        b.el.style.visibility = "visible";
        b.el.style.transform = `translate3d(${b.x - D / 2}px, ${b.y - D / 2}px, 0) scale(${(b.r * 2) / D})`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div
      className={[
        "show",
        phase !== "idle" && "in-show",
        atLeast(phase, "settle") && "whiten",
        atLeast(phase, "stars") && "starry",
        atLeast(phase, "fall") && "falling",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {shown > 0 && phase === "idle" && (
        <button className="scatter" type="button" onClick={() => setConfirmStep(1)}>
          Başlat
        </button>
      )}
      {confirmStep > 0 && phase === "idle" && (
        <Confirm
          {...CONFIRM_STEPS[confirmStep - 1]!}
          onCancel={() => setConfirmStep(0)}
          onOk={() => {
            if (confirmStep < CONFIRM_STEPS.length) return setConfirmStep(confirmStep + 1);
            setConfirmStep(0);
            startShow();
          }}
        />
      )}
      <div className="bubbles">
        {ids.map(id => (
          <div
            key={id}
            className="bubble"
            ref={el => {
              const b = bubbles.current.get(id);
              if (b) b.el = el;
            }}
          >
            <img src={`/photos/${id}`} alt="" style={{ animationDelay: `${-((id * 0.9) % 4)}s` }} />
          </div>
        ))}
      </div>

      <div className="topbar">
        <div className="pill">
          <span className="muted">Fotoğraf</span>
          <b key={shown} className="bump">
            {shown}
          </b>
        </div>
        <div className="logo">Funny Face</div>
        <div className="pill join">
          {join && (
            <>
              <span className="muted">Katıl</span>
              <b>{join.replace(/^https?:\/\//, "")}</b>
            </>
          )}
        </div>
      </div>

      {shown === 0 && queue.length === 0 && phase === "idle" && <div className="waiting">Fotoğraf bekleniyor</div>}

      {settings.showQr && qr && phase === "idle" && (
        <div className="qr">
          <div className="qr-card">
            <h2>Katıl</h2>
            <img src={qr} alt="QR kod" />
            <p>Kamerayı QR koda tut ve fotoğrafını çek</p>
          </div>
        </div>
      )}

      {featured !== null && <Stage key={featured} id={featured} waiting={queue.length - 1} />}

      {atLeast(phase, "fall") && <Cinema phase={phase} cast={cast} onCreditsDone={() => setPhase("end")} onRestart={() => setPhase("outro")} />}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Showroom />);
