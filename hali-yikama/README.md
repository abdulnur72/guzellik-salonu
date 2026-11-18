# Halı Yıkama

Halıcılar için sipariş, aşama takibi, ödeme ve kâr uygulaması. "Köpük Halı Yıkama" prototipinin gerçek, canlı hali.

**Canlı adres:** https://hali-yikama-c86.pages.dev

| Link | Kimin için | Ne yapar |
|---|---|---|
| `/r/<kod>` | Müşteri | Talep formu, "Halım nerede?" sorgusu (telefon ya da sipariş no), fiyat listesi |
| `/s/<kod>` | Halıcı | PIN sormadan açılır (Personel, Halılar, Müşteri: link + QR). Yalnızca **Yönetici** sekmesi yönetici PIN'i ister |

- **6 aşama:** Talep alındı → Halı alındı → Yıkanıyor → Kuruyor → Hazır → Teslim edildi, geri alma var. İki telefon aynı anda basarsa ikincisi reddedilir.
- **Fiyat:** halı türüne göre TL/m²; ölçü düzeltme; kapora/kısmi ödeme (nakit, havale, kart).
- **Personel:** sipariş açar, aşama ilerletir, ölçü ve ödeme girer, ad/telefon düzenler. Ciro, gider, kâr ve borç listesini görmez; sipariş ve ödeme silemez.
- **Yönetici:** (yalnızca yönetici PIN'iyle) ciro, gider, kâr, bekleyen ödemeler, masraf ekleme, fiyatlar, işletme bilgileri, PIN'ler (yönetici ve personel PIN'i aynı olamaz).
- **Müşteri sorgusu** yalnızca aşama ve tutarı gösterir; ad ve adres göstermez. Talep ve sorgu sayısı sınırlı.

## Altyapı

- Cloudflare Pages (tek `_worker.js`), güzellik salonuyla **ortak D1 veritabanı** (`guzellik-salonu`), `hali_*` tabloları (`db/0003_hali.sql`).
- Abonelik ve **Durdur** kilidi sahip panelinden (`https://guzellik-salonu.pages.dev/patron`) gelir: `plat_shops` içinde sektörü "Halı Yıkama" olan dükkânın link kodu halıcının kodudur. Süre biterse ya da durdurulursa halıcının paneli ve müşteri sayfası kapanır; kayıtlar silinmez, ödeme alınınca açılır.
- Yeni halıcı: sahip panelinde sektör "Halı Yıkama" ile eklenir, kartındaki **Halıcı PIN'leri** bölümünden yönetici ve personel PIN'i belirlenir.
- PIN'ler tuzlu SHA-256 özeti olarak `secrets` tablosunda; yanlış PIN 15 dakikada 8 denemeyle sınırlı.

## Geliştirme

Dış bağımlılık yok; [Bun](https://bun.sh) yeter.

```bash
bun test                 # sunucu, yetki, kilit ve QR testleri
bun scripts/dev.js       # yerel deneme: http://localhost:8788/s/kopuklu-hali-yikama (PIN 1111 / 2222)
bun scripts/build.mjs    # dist/_worker.js
```

Yayın (Cloudflare API, `manifest={}` ile tek dosya):

```bash
curl -X POST https://api.cloudflare.com/client/v4/accounts/<hesap>/pages/projects/hali-yikama/deployments \
  -H "Authorization: Bearer <token>" -F 'manifest={}' -F 'branch=main' \
  -F '_worker.js=@dist/_worker.js;type=application/javascript+module'
```
