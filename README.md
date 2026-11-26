# homework-funny-face

Etkinlikler için bir fotoğraf kabini ve gösteri sistemi. Katılımcılar telefonlarıyla fotoğraf çeker. Fotoğraflar büyük ekranda (showroom) gerçek zamanlı olarak belirir ve bir yörüngede döner. Gösteri başlatılınca film jeneriği gibi bir final oynar: her fotoğrafa rastgele bir meme filtresi uygulanır.

Bun, React ve MediaPipe (Google'ın yüz bulma modeli) ile yapıldı.

## Sayfalar

| Adres | Ne işe yarar |
| --- | --- |
| `/camera` | Telefonla fotoğraf çekme (filtresiz önizleme) |
| `/showroom` | Büyük ekran: fotoğraflar canlı gelir, sırayla sahneye çıkar, yörüngede döner. "Başlat" ile gösteri başlar (iki kez onay ister) |
| `/admin` | QR kod ekranını açma/kapama, bağlı cihazlar, fotoğraf sayısı, tüm fotoğrafları silme |

## Çalıştırma

```bash
bun install
bun dev
```

Sunucu `http://localhost:3000` adresinde açılır.

Telefonun kamerası sadece HTTPS'te çalışır. Bu yüzden telefonlar bir tünel (örneğin Cloudflare Tunnel ya da ngrok) üzerinden bağlanır.

`bun dev` çalışırken tüneli `http://localhost:3001` adresine yönlendir (3000 değil). Bun'ın dev modu, localhost dışından gelen sayfa isteklerini "Host header does not match the dev server" hatasıyla engeller; 3001 aynı uygulamayı dev modu kapalı olarak sunar. `bun start` ile çalışırken tek port (3000) yeterli. QR kodda tünel adresinin görünmesi için iki yol var:

- Showroom'u tünel adresinden aç.
- Ya da sunucuyu tünel adresiyle başlat:

```bash
PUBLIC_URL=https://<tünel-adresi> bun dev
```

## Nasıl çalışır

- Fotoğraflar `photos/` klasörüne `1.jpg`, `2.jpg`, … olarak kaydedilir. Bu klasör git'e girmez.
- En fazla 60 fotoğraf kabul edilir. Fotoğraf sayısı 30'a gelince ekrandaki her şey bir kez dağılır. Dönüş hızı da 30 fotoğrafta tam hıza ulaşır.
- Gösteri şu sırayla ilerler:
  1. Fotoğraflar durur, beyazlaşıp yıldıza dönüşür.
  2. Kamera aşağı iner: "You are the star." … "But not today."
  3. Her kişi için fotoğraf ile meme birleşiyormuş gibi görünür ve filtrelenmiş fotoğraf çıkar.
  4. Yapımcılar ve son ekran gelir.

## Yeni filtre eklemek

Filtreler [`src/filter.ts`](src/filter.ts) içinde. Her filtre iki parçadan oluşur: yüze çizilen bir `draw` fonksiyonu ve ona benzeyen bir meme görseli.

1. Meme görselini `src/memes/` içine koy. Sunucu onu `/memes/<dosya adı>` adresinden verir.
2. Yüze çizen bir `draw` fonksiyonu yaz. Örnekler: `drawClown`, `drawPoliteCat`.
3. `FILTERS` listesine `{ id, name, meme, draw }` olarak ekle.

Filtreler tekrarsız dağıtılır: tüm filtreler birer kez kullanılmadan aynı filtre tekrar gelmez.

## Dosyalar

- `src/index.ts`: sunucu (fotoğraf yükleme, WebSocket, admin komutları)
- `src/showroom.tsx`, `src/physics.ts`: büyük ekran ve yörünge fiziği
- `src/cinema.tsx`: gösteri ve jenerik
- `src/filter.ts`, `src/memes/`: filtreler ve meme görselleri
- `src/camera.tsx`, `src/admin.tsx`: telefon ve admin sayfaları
