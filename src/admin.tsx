import { useState } from "react";
import { createRoot } from "react-dom/client";
import { useSocket } from "./socket";
import { MAX_PHOTOS, type Presence, type Settings } from "./shared";
import "./index.css";

function Admin() {
  const [settings, setSettings] = useState<Settings>({ showQr: false });
  const [presence, setPresence] = useState<Presence>({ camera: 0, showroom: 0, admin: 0 });
  const [photoCount, setPhotoCount] = useState(0);

  const { send, connected } = useSocket("admin", m => {
    if (m.type === "settings") setSettings(m.settings);
    else if (m.type === "presence") setPresence(m.presence);
    else if (m.type === "photos") setPhotoCount(m.ids.length + m.pending.length);
    else if (m.type === "photo") setPhotoCount(n => n + 1);
    else if (m.type === "removed") setPhotoCount(n => Math.max(0, n - m.ids.length));
  });

  return (
    <div className="admin">
      <h1>Admin</h1>
      <div className={`conn ${connected ? "on" : ""}`}>{connected ? "Bağlı" : "Bağlanıyor…"}</div>

      <h2>Ayarlar</h2>
      <label className="row">
        <span>Showroom'da QR kod ekranı</span>
        <span className="switch">
          <input
            type="checkbox"
            checked={settings.showQr}
            onChange={e => send({ type: "set", key: "showQr", value: e.target.checked })}
          />
          <span />
        </span>
      </label>

      <h2>Canlı durum</h2>
      <div className="row">
        <span>Kamera (telefon)</span>
        <b>{presence.camera}</b>
      </div>
      <div className="row">
        <span>Showroom ekranı</span>
        <b>{presence.showroom}</b>
      </div>
      <div className="row">
        <span>Çekilen fotoğraf</span>
        <b>
          {photoCount} / {MAX_PHOTOS}
        </b>
      </div>

      <h2>Fotoğraflar</h2>
      <button className="row danger" type="button" disabled={!connected || photoCount === 0} onClick={() => send({ type: "deleteAll" })}>
        Tüm fotoğrafları sil
      </button>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Admin />);
