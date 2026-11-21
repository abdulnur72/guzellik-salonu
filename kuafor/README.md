# Kuaförüm

Bayan kuaförler için randevu, personel, ciro ve boya hatırlatma uygulaması.

**Canlı adres:** https://kuaforum.pages.dev · İlk salon: **Selin Kuaför** (`selin-kuafor`, 30 gün deneme)

| Link | Kimin için | Ne yapar |
|---|---|---|
| `/r/<kod>` | Müşteri | Yalnızca randevu formu: kategorili çoklu hizmet seçimi (toplam fiyat ve süre), uzman, gün (geçmiş gün seçilemez), seçilen hizmetlerin süresine göre boş saatler, telefon kontrolü, onay özeti, "Salona WhatsApp'tan haber ver", "Randevularım" ve iptal |
| `/s/<kod>` | Personel ve yönetici | PIN ile giriş. Sekmeler: **Yönetici, Personel, Randevu, İşletme, Müşteri** |

- **Personel** yalnızca kendi müşterisini (ve uzman seçmeyen müşterileri), kendi kayıtlarını ve kendi payını görür. Ciro, gider, net kâr ve başkasının primi yalnızca yöneticide.
- **Prim** kişiye göre; yeni personel varsayılan %40. Personel PIN'i yönetici PIN'inden ve diğer personelden farklı olmak zorunda.
- **64 hizmet**, 7 kategori (Kesim & Fön, Boya & Renk, Saç Bakımı, Topuz & Şekil, Makyaj, Kaş-Kirpik-Ağda, Tırnak); her birinin fiyatı, süresi, boya hizmetlerinde hatırlatma günü var. Yönetici düzenler, varsayılana dönebilir.
- **Randevu:** süre çakışması kontrolü (uzun işlem uzmanın sonraki saatlerini kapatır), "Geldi · Nakit / Kart" ciro kaydı yazar, "Geri al" siler; yanlış kayıt "Sil" ile kaldırılır.
- **Boya günü hatırlatması:** telefonu bilinen müşterinin boya/röfle/balyajından hizmetin hatırlatma günü kadar sonra (örn. dip boya 35 gün) Randevu sekmesinde WhatsApp mesajıyla listelenir; yaklaşan randevusu olan listeye girmez.
- **Yönetici:** ciro, nakit/kart, personel payı, gider, net kâr, gün sonu WhatsApp raporu, çalışma saatleri, **iş günü başlangıcı** (varsayılan 06:00), salon bilgileri, PIN.
- **İşletme:** çok şubeli özet, uygulamadan yeni şube; ilave şube sahip panelinde ücretiyle görünür.

## Altyapı

- Cloudflare Pages (tek `_worker.js`), güzellik salonu, halı yıkama ve berberle **ortak D1 veritabanı**, `kuafor_*` tabloları (`db/0005_kuafor.sql`).
- Abonelik ve **Durdur** kilidi sahip panelinden (`https://guzellik-salonu.pages.dev/patron`): sektörü "Bayan Kuaför" olan dükkânın link kodu kuaförün kodudur. Kartındaki **Kuaför yönetici PIN'i** bölümünden PIN belirlenir.
- PIN'ler tuzlu SHA-256 özeti olarak `secrets` tablosunda; yanlış PIN 15 dakikada 8 denemeyle sınırlı.

## Geliştirme (kuafor/ klasöründe, Bun yeter)

```bash
bun test                 # sunucu, yetki, çakışma, hatırlatma, kilit testleri
PATRON_WORKER=../dist-worker/_worker.js bun test   # sahip paneliyle birlikte
bun scripts/dev.js       # yerel deneme: http://localhost:8791/s/selin-kuafor (yerel PIN'ler dev.js içinde)
bun scripts/build.mjs    # dist/_worker.js
```

Yayın (Cloudflare API, `manifest={}` ile tek dosya): `pages/projects/kuaforum/deployments` adresine `_worker.js=@dist/_worker.js;type=application/javascript+module`.
