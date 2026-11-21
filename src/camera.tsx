import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { useSocket } from "./socket";
import { MAX_PHOTOS } from "./shared";
import "./index.css";

// Telefon sayfası: filtresiz, gerçek kamera görüntüsü. Filtreyi showroom (sunucu tarafı) sonradan ekler.
function Camera() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState("");
  const [count, setCount] = useState(0);

  // Toplam fotoğraf sayısını takip et (limit dolunca çekim kapanır)
  useSocket("camera", m => {
    if (m.type === "photos") setCount(m.ids.length + m.pending.length);
    else if (m.type === "photo") setCount(c => c + 1);
    else if (m.type === "removed") setCount(c => Math.max(0, c - m.ids.length));
  });
  const full = count >= MAX_PHOTOS;

  useEffect(() => {
    const video = videoRef.current!;
    let stream: MediaStream | undefined;
    let stopped = false;

    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error(
          window.isSecureContext
            ? "tarayıcı kamerayı desteklemiyor"
            : "sayfa güvenli değil (https:// tünel adresinden aç)",
        );
      }
      setStatus("Kamera açılıyor…");
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" }, audio: false });
      if (stopped) return;
      video.srcObject = stream;
      await video.play();
      setStatus("");
      setReady(true);
    })().catch(err => setStatus(`Hata: ${err?.name ?? ""} ${err?.message ?? err}`));

    return () => {
      stopped = true;
      stream?.getTracks().forEach(t => t.stop());
    };
  }, []);

  async function snap() {
    const video = videoRef.current!;
    // Ekranda ayna görüntüsü var; fotoğraf da aynı görünsün diye çevirerek kopyala
    const out = document.createElement("canvas");
    out.width = video.videoWidth;
    out.height = video.videoHeight;
    const c = out.getContext("2d")!;
    c.translate(out.width, 0);
    c.scale(-1, 1);
    c.drawImage(video, 0, 0);
    const blob = await new Promise<Blob | null>(r => out.toBlob(r, "image/jpeg", 0.85));
    if (!blob) return;

    setStatus("Gönderiliyor…");
    const res = await fetch("/api/photo", { method: "POST", body: blob }).catch(() => null);
    setStatus(res?.ok ? "Gönderildi ✓" : res?.status === 409 ? "Fotoğraf limiti doldu" : "Gönderilemedi");
    setTimeout(() => setStatus(s => (s.startsWith("Gönderi") ? "" : s)), 1500);
  }

  const message = full ? "Fotoğraf limiti doldu" : status;

  return (
    <div className="booth">
      <video ref={videoRef} playsInline muted />
      <button className="shutter" onClick={snap} disabled={!ready || full} aria-label="Fotoğraf çek" />
      {message && <div className="toast">{message}</div>}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Camera />);
