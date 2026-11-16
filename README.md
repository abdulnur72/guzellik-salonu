# Güzellik Salonu

Güzellik salonları için randevu, personel, ciro ve müşteri takip uygulaması.
"Lila Güzellik Salonu" prototipinin gerçek uygulamaya dönüşmüş hali.

## Ne var, ne çalışıyor

| Link | Kimin için | Ne yapar |
|---|---|---|
| `/` | Sahip (demo) | Şubeleri ve linklerini listeler, yeni şube ekler |
| `/s/<şube>` | Personel, resepsiyon, yönetici | Aynı linkten girilir, kim olduğu PIN ile belirlenir |
| `/r/<şube>` | Müşteri | Yalnızca randevu sayfası; personel/yönetici ekranları hiç görünmez |

**Personel:** adına dokunup kişisel PIN ile girer (ilk girişte PIN belirler), randevusuz gelen müşteriyi kaydeder, bugünkü / 7 günlük / aylık cirosunu ve payını görür, yalnızca kendi müşterilerini görür.
**Resepsiyon:** randevuları ve müşteri kartlarını yönetir, ciro ve kazançları görmez.
**Randevu:** yeni randevu (personel, oda/cihaz, çakışma kontrolü), onay bekleyen online talepler, Geldi · Nakit / Geldi · Kart / Gelmedi / İptal / Geri al, yarınki randevular için WhatsApp hatırlatma.
**Yönetici:** ciro tabloları, personel ve patron payı, nakit/kart dağılımı, gider ve net kâr, personel bazında tablo ve prim oranı, personel ekleme/çıkarma, PIN sıfırlama, müşteri kartları (doğum günü, not, alerji notu), 136 işlemlik fiyat listesi, gün sonu raporu (WhatsApp), ayarlar (salon adı, adres, telefon, çalışma saatleri, gün değişim saati, PIN), müşteri ve panel linkleri.
**Müşteri:** hizmet seçimi (çoklu, toplam tutar ve süre), personel ya da "Fark etmez", boş saatler, telefon ve aydınlatma onayı, onay mesajı, "Randevularım" ile iptal.

Telefonda tek sütun, bilgisayarda (960 px üstü) iki sütun. Telefona ve bilgisayara "Ana ekrana ekle / Uygulama olarak yükle" ile kurulur (PWA).

### Demo modu
Supabase bilgileri girilmeden önce uygulama **demo modunda** çalışır: kayıtlar o cihazın tarayıcısında durur. Demo yönetici PIN'i `1234`.

## Kurulum (geliştirici)

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # çekirdek testleri (iş günü, boş saat, ciro, online randevu)
npm run build      # dist/ klasörü Cloudflare Pages'e yüklenir
npm run test:db    # (isteğe bağlı) şema ve güvenlik kuralları, yerel PostgreSQL gerekir
```

## Klasör yapısı

```
src/
  core/            Ortak çekirdek (dört sektörde aynı)
    types.ts         Veri modeli (Supabase tablolarıyla aynı)
    time.ts          İş günü, tarih/saat, para biçimi
    scheduling.ts    Boş saat ve personel çakışma hesabı
    reports.ts       Ciro, personel payı, gider
    data/            Veri katmanı: demoStore (tarayıcı), actions (işlemler), supabase
  sectors/         Sektör paketleri: renkler, hizmet kataloğu, varsayılanlar
    guzellik/        Güzellik salonu (ilk paket)
  i18n/tr.ts       Ekrandaki tüm yazılar (ikinci dil = bu dosyanın çevirisi)
  pages/           Ekranlar: HomePage, PanelPage (+ panel/), BookingPage
  ui/              Ortak parçalar (hizmet/personel/saat seçici, tablo)
supabase/
  migrations/      Veritabanı şeması ve satır seviyesinde güvenlik kuralları
  tests/           Şema testleri
```

Para birimi, saat dilimi, dil ve ülke her işletmenin ayarıdır (varsayılan TRY, Europe/Istanbul, tr-TR, TR).

## Veritabanı (Supabase)

`supabase/migrations/0001_init.sql` hazır ve yerelde test edildi:
- Her işletmenin verisi ayrı; sahip yalnızca kendi işletmesini, şube yöneticisi kendi şubesini, uzman yalnızca kendi randevularını ve müşterilerini görür; gider yalnızca sahip ve yöneticiye açık.
- Abonelik süresi (`paid_until`) dolunca işletmenin paneli ve müşteri randevu sayfası kapanır.
- Müşteri hesap açmaz: randevu sayfası yalnızca `public_branch`, `public_busy`, `book_appointment`, `cancel_my_appointment`, `my_appointments` fonksiyonlarını çağırabilir. `book_appointment` saati sunucuda tekrar kontrol eder, aynı anda iki kişinin aynı saati almasını engeller.

## Yol haritası

1. ✅ İskelet, ortak çekirdek, güzellik paketi, demo modunda tam çalışan ekranlar, veritabanı şeması
2. Supabase ve Cloudflare hesaplarını açmak (birlikte, ekran ekran)
3. Veri katmanını Supabase'e bağlamak: giriş (sahip e-posta ile, personel davet linki ile), ortak kayıtlar
4. Prototipte olup henüz aktarılmayanlar: İşletme (çok şube) paneli ve abonelik ücreti, seanslı paket takibi, stok, oda/cihaz listesini düzenleme, personel ve salon fotoğrafı, yedek indirme, onay bekleyen talepler için bildirim
5. Pilot salon (2-3 hafta), sonra bayan kuaför, berber, spor salonu paketleri
