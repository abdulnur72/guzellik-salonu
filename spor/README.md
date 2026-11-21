# Sporum

Spor salonları için randevu, ders kaydı, üyelik, giriş, aidat, antrenör primi ve ciro uygulaması.

**Canlı adres:** https://sporum.pages.dev · İlk salon: **Atlas Spor Salonu** (`atlas-spor`, 30 gün deneme)

| Link | Kimin için | Ne yapar |
|---|---|---|
| `/r/<kod>` | Müşteri | Yalnızca **Randevu al** ve **Ders kaydı** formu. Ürünler, ücretler ve fiyatı 0 olan kalemler görünmez; geçmiş gün seçilemez; telefon kontrolü; onay özeti; çift randevu engeli (aynı telefon aynı güne bir randevu, aynı derse bir kayıt); "Salona WhatsApp'tan haber ver"; "Randevularım" ve iptal |
| `/s/<kod>` | Antrenör ve yönetici | PIN ile giriş. Sekmeler: **Yönetici, Personel, Randevu, İşletme, Müşteri** |

- **Personel (antrenör)** yalnızca kendi üyelerini, kendi derslerini, kendi satışlarını ve kendi payını görür. Ciro, gider, net kâr ve başkasının primi yalnızca yöneticide. Antrenör PIN'i yönetici PIN'inden ve diğer antrenörlerden farklı olmak zorunda.
- **Prim** kişiye göre; yeni antrenör varsayılan %40. Yönetici antrenörsüz ("Salon", prim yok) satış da yapabilir.
- **Kalemler** dört türdür: üyelik (gün), ders paketi (ders sayısı), hizmet (süre), ürün. Yönetici düzenler.
- **Üyelik ve paket satışı:** üye adı zorunlu. Satış ya da üyelik/paket randevusunda "Geldi" üye kartını açar/uzatır (bitiş tarihi, kalan ders); satış "Sil" ya da randevu "Geri al" kartı eski haline döndürür.
- **Müşteri sekmesi:** üye listesi, giriş kaydı (günde bir), paketten ders düşme, üyelik dondurma (bitiş ileri kayar, erken bitirince kullanılmayan gün geri düşer), aidat takibi (7 gün içinde biten ya da bitmiş üyeler, WhatsApp hatırlatma, "Aidat al"), müşteri linki ve QR.
- **Ders kaydı:** haftalık ders programı (gün, saat, süre, antrenör, kontenjan). Telefon zorunlu, kontenjan dolunca kayıt kapanır, iptal yer açar. Antrenörü belli dersin saati o antrenörün randevularına kapanır.
- **Yönetici:** ciro, nakit/kart, antrenör payı, gider, net kâr, yanlış kaydı silme, gün sonu WhatsApp raporu, çalışma saatleri, **iş günü başlangıcı** (varsayılan 00:00), salon bilgileri, PIN.
- **İşletme:** çok şubeli özet (ciro, net kâr, aktif üye, giriş), uygulamadan yeni şube; ilave şube sahip panelinde ücretiyle görünür.

## Altyapı

- Cloudflare Pages (tek `_worker.js`), diğer uygulamalarla **ortak D1 veritabanı**, `spor_*` tabloları (`db/0006_spor.sql`).
- Abonelik ve **Durdur** kilidi sahip panelinden (`https://guzellik-salonu.pages.dev/patron`): sektörü "Spor Salonu" olan dükkânın link kodu salonun kodudur. Kartındaki **Spor salonu yönetici PIN'i** bölümünden PIN belirlenir.
- PIN'ler tuzlu SHA-256 özeti olarak `secrets` tablosunda; yanlış PIN 15 dakikada 8 denemeyle sınırlı.
- Sayfa betiği ve stili derlemede küçültülür (sıkıştırılmış ~27 KB); müşteri sayfası salon bilgisi gömülü olarak tek istekte açılır.

## Geliştirme (spor/ klasöründe, Bun yeter)

```bash
bun test                 # sunucu, yetki, üyelik, ders, dondurma, kilit testleri
PATRON_WORKER=../dist-worker/_worker.js bun test   # sahip paneliyle birlikte
bun scripts/dev.js       # yerel deneme: http://localhost:8792/s/atlas-spor (yerel PIN'ler dev.js içinde)
bun scripts/build.mjs    # dist/_worker.js
```

Yayın (Cloudflare API, `manifest={}` ile tek dosya): `pages/projects/sporum/deployments` adresine `_worker.js=@dist/_worker.js;type=application/javascript+module`.
