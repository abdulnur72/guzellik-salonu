# Kurulum rehberi

Uygulama tamamen **Cloudflare**'in ücretsiz planında çalışır: sayfalar Cloudflare Pages'te,
kayıtlar Cloudflare D1 veritabanında. Tek hesap yeter, alan adı gerekmez.
Sonuç: `https://guzellik-salonu.pages.dev` gibi bir link.

## Senin yapacakların (bir kere, ~5 dakika)

1. **dash.cloudflare.com** adresine gir, **Sign up** ile e-postanla ücretsiz hesap aç, e-postana gelen onay linkine tıkla.
2. Sağ üstteki kişi simgesi → **My Profile** (Profilim) → soldan **API Tokens** → **Create Token**.
3. En alttaki **Custom token** → **Get started**.
   - **Token name:** `guzellik-salonu`
   - **Permissions** (üç satır, "+ Add more" ile ekle):
     - `Account` · `Cloudflare Pages` · `Edit`
     - `Account` · `D1` · `Edit`
     - `Account` · `Account Settings` · `Read`
   - **Account Resources:** `Include` · kendi hesabın
   - **Continue to summary** → **Create Token**.
4. Çıkan uzun anahtarı kopyala. **Sohbete yapıştırma.** Claude sana güvenli bir form açacak, oraya yapıştır.

Gerisini Claude yapar: veritabanını kurar, örnek salonu yükler, uygulamayı yayına alır ve sana
linkleri ve PIN'leri verir.

> Anahtarı ileride iptal etmek istersen aynı API Tokens sayfasından **Delete** demen yeterli;
> uygulama çalışmaya devam eder (yalnızca yeni güncelleme yüklenemez).

## Yayından sonra

- **Linkler:** `/r/lila` müşteri randevu sayfası, `/s/lila` salon paneli, `/sahip` işletme sahibi paneli.
- **PIN'ler:** sahip ve yönetici PIN'ini Claude verir; ilk girişte **Ayarlar**'dan değiştir.
  Personel ilk girişinde kendi PIN'ini belirler.
- **Örnek bilgiler:** salon adı, adres, telefon, çalışma saatleri ve personel örnektir.
  Yönetici ekranındaki **Ayarlar** ve **Personel** bölümlerinden gerçekleriyle değiştirilir.
- Telefona kurmak: iPhone'da Safari → Paylaş → **Ana Ekrana Ekle**; Android'de Chrome → üç nokta → **Uygulamayı yükle**.

## Ücretsiz planın sınırları

Cloudflare'in ücretsiz planı (günde 100.000 istek, 5 GB veritabanı) tek salon için fazlasıyla yeter.
Proje uykuya geçmez, kullanılmasa da açık kalır.

## Sonrası (sırası gelince)

- **Alan adı** (ör. `salonum.com`): Cloudflare'den alınıp aynı projeye bağlanır.
- **KVKK aydınlatma metni:** randevu sayfasında örnek metin var; gerçeğini bir avukat ya da KVKK uzmanı hazırlamalı.
- **Abonelik tahsilatı:** PayTR ya da iyzico başvurusu (pilottan sonra).

## Teknik: elle yayına alma (geliştirici için)

```bash
npx wrangler d1 create guzellik-salonu          # çıkan database_id'yi wrangler.toml'a yaz
npx wrangler d1 migrations apply guzellik-salonu --remote
npx tsx scripts/seed.ts --owner-pin XXXXXX --manager-pin YYYYYY > seed.sql
npx wrangler d1 execute guzellik-salonu --remote --file seed.sql && rm seed.sql
npx wrangler pages project create guzellik-salonu --production-branch main
npm run build && npx wrangler pages deploy --branch main
```
