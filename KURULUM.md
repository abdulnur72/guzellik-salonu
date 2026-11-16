# Kurulum rehberi (senin yapacağın adımlar)

Bu adımlarda hesap açılıyor ve şifre giriliyor. Bunları senin yapman gerekiyor. Her adımda yanındayım: takıldığın yerin ekran görüntüsünü at, birlikte ilerleriz.

Menü adları zamanla değişebilir. Bir düğmeyi bulamazsan ekranda ne gördüğünü yaz, yolu ben bulurum.

**Bu rehberde kimseyle paylaşmaman gerekenler:** Supabase veritabanı şifresi ve "service_role" (ya da "secret") anahtarı. Bunları bana da gönderme, ihtiyacım yok.

---

## Adım 1 — Uygulamayı internete koymak (Cloudflare Pages, ücretsiz)

Sonuç: `https://guzellik-salonu.pages.dev` gibi bir link. Uygulama telefonda ve bilgisayarda bu linkten açılır. Şimdilik demo modunda çalışır (kayıtlar cihazda durur).

1. **dash.cloudflare.com** adresine gir, "Sign up" ile e-postanla ücretsiz hesap aç, e-postana gelen onay linkine tıkla.
2. Soldaki menüden **Workers & Pages**'e gir, sonra **Create** (Oluştur) düğmesine bas.
3. **Pages** sekmesini seç, sonra **Connect to Git** (ya da "Import an existing Git repository").
4. **GitHub**'ı seç ve izin ver. Hangi depolara erişsin diye sorarsa yalnızca **guzellik-salonu** deposunu seç.
5. Depo listesinden **guzellik-salonu**'nu seç, **Begin setup** de.
6. Ayarları şöyle doldur:
   - **Project name:** `guzellik-salonu` (linkin adı bu olur)
   - **Production branch:** `main` (birleştirme yapılmadıysa `claude/guzellik-salonu-prototype-setup-13ppvl`)
   - **Framework preset:** `React (Vite)` (yoksa `None`)
   - **Build command:** `npm run build`
   - **Build output directory:** `dist`
   - **Environment variables** bölümünde **Add variable**: ad `NODE_VERSION`, değer `22`
7. **Save and Deploy** de. 1-2 dakika bekle. Bitince yeşil bir onay ve link çıkar.
8. Linki telefonunda aç:
   - iPhone: Safari'de Paylaş düğmesi → **Ana Ekrana Ekle**
   - Android: Chrome'da üç nokta → **Uygulamayı yükle** (ya da "Ana ekrana ekle")
   - Bilgisayar: Chrome adres çubuğunun sağındaki **yükle** simgesi

**Bana gönder:** çıkan linki.

---

## Adım 2 — Ortak veritabanı (Supabase, ücretsiz)

Sonuç: personel ve patron aynı kayıtları kendi telefonlarından görür. Uygulamanın bu veritabanına bağlanan kısmını sen bu adımı bitirince yazacağım.

1. **supabase.com** adresine gir, **Start your project** de, **Continue with GitHub** ile giriş yap.
2. **New project** de:
   - **Name:** `guzellik-salonu`
   - **Database password:** **Generate a password** de ve şifreyi güvenli bir yere kaydet (telefonunun şifre kasası gibi). **Bana gönderme.**
   - **Region:** `Central EU (Frankfurt)` (Türkiye'ye en yakın bölge)
   - **Plan:** Free
3. **Create new project** de. Kurulması 1-2 dakika sürer.
4. Soldaki menüden **SQL Editor**'e gir, **New query** de.
5. GitHub'da depodaki **`supabase/kurulum.sql`** dosyasını aç, sağ üstteki **kopyala** simgesiyle tamamını kopyala. SQL Editor'e yapıştır ve **Run** de. En altta "Success. No rows returned" yazmalı.
6. Soldaki menüden **Project Settings → API** (ya da "Data API" / "API Keys") bölümüne gir. İki bilgiyi kopyala:
   - **Project URL** (`https://xxxx.supabase.co` gibi)
   - **anon / public** (ya da "publishable") anahtar

**Bana gönder:** Project URL ve anon/publishable anahtar. Bu ikisi gizli değildir; uygulamanın içinde zaten herkese görünür. **service_role / secret** anahtarını gönderme.

### Bilmen gereken iki şey
- Ücretsiz planda proje **bir hafta hiç kullanılmazsa durakladı** olur. Supabase panelinden tek tıkla yeniden açılır. Pilot salon her gün kullanacağı için sorun olmaz.
- Gerçek müşteriler gelince Pro plana (yaklaşık aylık 25 dolar) geçilir. Fiyatı o gün resmî sayfadan kontrol ederiz.

---

## Adım 3 — Sonrası (sırası gelince)

- **Alan adı** (ör. `salonum.com`): istersen Cloudflare'den alınır ve Adım 1'deki projeye bağlanır.
- **KVKK aydınlatma metni:** randevu sayfasında şu an örnek metin var. Gerçek metni bir avukat ya da KVKK uzmanı hazırlamalı.
- **Abonelik tahsilatı:** PayTR ya da iyzico başvurusu (pilottan sonra).
