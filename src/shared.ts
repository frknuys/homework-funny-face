// Sunucu ve sayfaların socket üzerinden konuştuğu mesajlar

export type Role = "camera" | "showroom" | "admin";
export const ROLES: Role[] = ["camera", "showroom", "admin"];

export const MAX_PHOTOS = 60; // bundan fazla fotoğraf kabul edilmez
export const SCATTER_AT = 30; // bu sayıya gelince her şey bir kez dağılır; dönüş hızı da bu sayıda tam hıza ulaşır

export type Settings = {
  showQr: boolean; // showroom'da QR kod ekranı açık mı
};

export type Presence = Record<Role, number>; // her sayfadan kaç cihaz bağlı

// sunucu → sayfalar
export type ServerMsg =
  | { type: "photos"; ids: number[]; pending: number[] } // bağlanınca: hazır olanlar + filtresi bekleyenler
  | { type: "photo"; id: number } // yeni ham fotoğraf geldi (showroom filtreleyip hazırlar)
  | { type: "removed"; ids: number[] } // klasörden silinen fotoğraflar (herkes sayısını ve ekranını günceller)
  | { type: "settings"; settings: Settings }
  | { type: "presence"; presence: Presence };

// admin → sunucu
export type ClientMsg =
  | { type: "set"; key: keyof Settings; value: boolean }
  | { type: "deleteAll" }; // tüm fotoğrafları sil
