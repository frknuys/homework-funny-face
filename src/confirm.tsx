// Apple tarzı onay penceresi (iOS uyarısı gibi). Soru değişince arka plan sabit kalır, sadece pencere yenilenir.
export function Confirm({ title, message, ok, onOk, onCancel }: { title: string; message: string; ok: string; onOk: () => void; onCancel: () => void }) {
  return (
    <div className="alert-backdrop" onClick={onCancel}>
      <div key={title} className="alert" role="alertdialog" aria-label={title} onClick={e => e.stopPropagation()}>
        <div className="alert-body">
          <div className="alert-title">{title}</div>
          <div className="alert-msg">{message}</div>
        </div>
        <div className="alert-actions">
          <button type="button" onClick={onCancel}>
            Vazgeç
          </button>
          <button type="button" className="primary" onClick={onOk} autoFocus>
            {ok}
          </button>
        </div>
      </div>
    </div>
  );
}
