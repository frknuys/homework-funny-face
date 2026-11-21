// Gösteri: "You are the star." → "But not today." → jenerik (her kişi için: fotoğraf + meme birleşir → filtrelenmiş fotoğraf)
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { FunnyFilter } from "./filter";

// Gösterinin aşamaları, sırasıyla
export const PHASES = ["idle", "settle", "stars", "fall", "star", "today", "credits", "end", "outro"] as const;
export type Phase = (typeof PHASES)[number];
export const atLeast = (phase: Phase, p: Phase) => phase !== "idle" && PHASES.indexOf(phase) >= PHASES.indexOf(p);

export type CastMember = { id: number; filter: FunnyFilter; url?: string }; // url: filtrelenmiş fotoğraf (hazır değilse orijinal görünür)

const SPEED = 180; // jenerik kayma hızı (px/sn)

// Jeneriğin sonunda, son ekrandan önce görünen yapımcılar
const PRODUCERS = ["Furkan", "Maria", "Ramazan", "İsmet", "Orkun", "Tuna"];

// Kamera aşağı inerken arka planda seyrek yıldızlar yukarı kayar. Uzaktakiler (küçük, soluk) daha yavaş:
// derinlik hissi verir. Kamera durunca (yazılar, son ekran) yıldızlar da durur.
const STARS = 26;
function Starfield({ running }: { running: boolean }) {
  const stars = useMemo(
    () =>
      Array.from({ length: STARS }, () => {
        const depth = Math.random(); // 0 = uzak, 1 = yakın
        const d = 26 - depth * 16; // yukarı çıkış süresi (sn): yakındaki hızlı
        return {
          "--x": `${Math.random() * 100}%`,
          "--s": `${1.2 + depth * 2.4}px`,
          "--o": 0.35 + depth * 0.6,
          "--d": `${d}s`,
          "--delay": `${-Math.random() * d}s`, // ekrana dağılmış başlasınlar
        } as CSSProperties;
      }),
    [],
  );
  return (
    <div className={`starfield ${running ? "" : "paused"}`}>
      {stars.map((style, i) => (
        <i key={i} style={style} />
      ))}
    </div>
  );
}

// Kelimeler sırayla belirir
function Words({ text, on, className = "" }: { text: string; on: boolean; className?: string }) {
  return (
    <div className={`line ${className} ${on ? "on" : ""}`}>
      {text.split(" ").map((w, i) => (
        <span key={i} style={{ "--i": i } as CSSProperties}>
          {w}
        </span>
      ))}
    </div>
  );
}

// Jenerikteki bir kişi: ekranın ortasına gelince fotoğrafı ve filtrenin meme'i birleşiyormuş gibi olur,
// sonunda fotoğrafın o filtreyle filtrelenmiş hali çıkar (birleşim değil)
function Credit({ m }: { m: CastMember }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current!;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e?.isIntersecting) {
          el.classList.add("play");
          io.disconnect();
        }
      },
      { rootMargin: "-40% 0px -40% 0px" }, // ekranın orta bandına girince
    );
    io.observe(el.querySelector(".merge")!);
    return () => io.disconnect();
  }, []);

  return (
    <div className="credit" ref={ref}>
      <div className="merge">
        <img className="orig" src={`/photos/${m.id}`} alt="" />
        <img className="meme" src={m.filter.meme} alt="" />
        <img className="result" src={m.url ?? `/photos/${m.id}`} alt="" />
      </div>
      <div className="who">
        Funny Face <span className="muted">#{m.id}</span>
      </div>
      <div className="role muted">as {m.filter.name}</div>
    </div>
  );
}

// Son ekranın iki yanında 10 kutu (solda 5, sağda 5): filtreli fotoğraflar.
// 10'dan fazla kişi varsa kutular sırayla tek tek değişir, böylece herkes topluca görünür.
const SLOTS = 10;
const SWAP_MS = 1200; // bir kutunun değişme aralığı

function EndGallery({ cast }: { cast: CastMember[] }) {
  const n = cast.length;
  // her kutuda: şu an gösterilen kişi ve bir önceki (yeni fotoğraf eskisinin üstüne gelir, arada boşluk olmaz)
  const [slots, setSlots] = useState(() =>
    Array.from({ length: Math.min(SLOTS, n) }, (_, i) => ({ cur: i, prev: -1 })),
  );
  const nextSlot = useRef(0); // sıradaki değişecek kutu
  const nextMember = useRef(Math.min(SLOTS, n)); // sıradaki gösterilecek kişi

  useEffect(() => {
    if (n <= SLOTS) return; // herkes zaten görünüyor
    const t = setInterval(() => {
      const k = nextSlot.current;
      const m = nextMember.current;
      nextSlot.current = (k + 1) % SLOTS;
      nextMember.current = (m + 1) % n;
      setSlots(prev => prev.map((v, i) => (i === k ? { cur: m, prev: v.cur } : v)));
    }, SWAP_MS);
    return () => clearInterval(t);
  }, [n]);

  // kutular sol ve sağ sütunlara dönüşümlü dağılır (az kişi varsa iki yan dengeli dolar)
  const column = (side: 0 | 1) =>
    slots.map(({ cur, prev }, i) => {
      if (i % 2 !== side) return null;
      const src = (j: number) => cast[j]!.url ?? `/photos/${cast[j]!.id}`;
      return (
        <div key={i} className="slot" style={{ "--i": i } as CSSProperties}>
          {prev >= 0 && <img key={`p${prev}`} className="under" src={src(prev)} alt="" />}
          <img key={cur} src={src(cur)} alt="" />
        </div>
      );
    });

  return (
    <div className="gallery">
      <div className="col left">{column(0)}</div>
      <div className="col right">{column(1)}</div>
    </div>
  );
}

export function Cinema({
  phase,
  cast,
  onCreditsDone,
  onRestart,
}: {
  phase: Phase;
  cast: CastMember[];
  onCreditsDone: () => void;
  onRestart: () => void;
}) {
  const reel = useRef<HTMLDivElement>(null);
  const anim = useRef<Animation | null>(null);
  const done = useRef(onCreditsDone);
  done.current = onCreditsDone;

  // Kamera aşağı iner: sahne alttan gelip yerine oturur
  const [landed, setLanded] = useState(false);
  useEffect(() => {
    const t = requestAnimationFrame(() => requestAnimationFrame(() => setLanded(true)));
    return () => cancelAnimationFrame(t);
  }, []);

  // Jenerik: kamera sabit hızla aşağı iner (içerik yukarı kayar)
  useEffect(() => {
    if (phase !== "credits" || anim.current) return;
    const el = reel.current!;
    const dist = el.scrollHeight - innerHeight;
    anim.current = el.animate([{ transform: "translateY(0)" }, { transform: `translateY(${-dist}px)` }], {
      duration: (dist / SPEED) * 1000,
      easing: "linear",
      fill: "forwards",
    });
    anim.current.onfinish = () => done.current();
  }, [phase]);
  useEffect(() => () => anim.current?.cancel(), []);

  return (
    <div className={`cinema ${landed ? "landed" : ""} ${phase === "outro" ? "out" : ""}`}>
      <Starfield running={phase === "credits"} />
      <div className="reel" ref={reel}>
        <div className="words">
          <Words text="You are the star." on={atLeast(phase, "star")} />
          <Words text="But not today." on={atLeast(phase, "today")} className="second" />
        </div>
        <div className="credits-head muted">Starring</div>
        {cast.map(m => (
          <Credit key={m.id} m={m} />
        ))}
        <div className="producers">
          <div className="producers-head muted">Produced by</div>
          {PRODUCERS.map(name => (
            <div key={name} className="producer">
              {name}
            </div>
          ))}
        </div>
        <div className="end">
          <div className="end-title">Funny Face</div>
          <div className="muted">Thanks for being the star.</div>
          {atLeast(phase, "end") && (
            <button className="restart" type="button" onClick={onRestart}>
              Başa dön
            </button>
          )}
        </div>
      </div>
      {atLeast(phase, "end") && cast.length > 0 && <EndGallery cast={cast} />}
    </div>
  );
}
