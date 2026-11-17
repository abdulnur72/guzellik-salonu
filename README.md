# Güzellik Salonu

Güzellik salonları için randevu, personel, ciro ve müşteri takip uygulaması.
"Lila Güzellik Salonu" prototipinin gerçek uygulamaya dönüşmüş hali.

## Ne var, ne çalışıyor

| Link | Kimin için | Ne yapar |
|---|---|---|
| `/` | Açılış ekranı | Doğrudan sekmeli salon paneli açılır (son açılan ya da tek şube) |
| `/subeler` | Herkes | Şubeleri ve linklerini listeler |
| `/patron` | Uygulamayı kiralayan (platform sahibi) | Dükkân abonelikleri: ödeme al/geri al, durdur, geciken ödemeler, paketler, WhatsApp mesajları, yedek. Süresi biten ya da durdurulan dükkânın `/r/` ve `/s/` linkleri "abonelik sona erdi" ekranı gösterir (kayıtlar silinmez) |
| `/sahip` | İşletme sahibi | Tüm şubelerin bu ayki cirosu, gideri, net kârı; şube ekleme; abonelik ücreti; istediği şubeye yönetici olarak geçiş |
| `/s/<şube>` | Personel, resepsiyon, yönetici | Aynı linkten girilir, kim olduğu PIN ile belirlenir |
| `/r/<şube>` | Müşteri | Yalnızca randevu sayfası; personel/yönetici ekranları hiç görünmez |

**Personel:** adına dokunup kişisel PIN ile girer (ilk girişte PIN belirler), randevusuz gelen müşteriyi kaydeder, bugünkü / 7 günlük / aylık cirosunu ve payını görür, yalnızca kendi müşterilerini görür.
**Resepsiyon:** randevuları ve müşteri kartlarını yönetir, ciro ve kazançları görmez.
**Randevu:** yeni randevu (personel, oda/cihaz, çakışma kontrolü), onay bekleyen online talepler, Geldi · Nakit / Geldi · Kart / Gelmedi / İptal / Geri al, yarınki randevular için WhatsApp hatırlatma.
**Yönetici:** ciro tabloları, personel ve patron payı, nakit/kart dağılımı, gider ve net kâr, personel bazında tablo ve prim oranı, personel ekleme/çıkarma, PIN sıfırlama, müşteri kartları (doğum günü, not, alerji notu), 136 işlemlik fiyat listesi, gün sonu raporu (WhatsApp), ayarlar (salon adı, adres, telefon, çalışma saatleri, gün değişim saati, PIN), müşteri ve panel linkleri.
**Seanslı paket:** paket içeren işlem "Geldi" işaretlenince (ya da personel randevusuz kaydedince) paket açılır ve ilk seans düşülür (ör. 5/6); müşteri kartından "Seans düş" ile devam edilir, "Geri al" paketi siler.
**Diğer:** oda/cihaz listesi (aynı oda aynı saatte iki randevuya verilmez), stok ve "Azalıyor" uyarısı, personel ve salon fotoğrafı, geçen ayın kapanışı (prim hesabı için).
**Müşteri:** hizmet seçimi (çoklu, toplam tutar ve süre), personel ya da "Fark etmez", boş saatler, telefon ve aydınlatma onayı, onay mesajı, "Randevularım" ile iptal.

Panelin üstünde sekmeler var: **Yönetici, Personel, Randevu, İşletme, Müşteri**. Sekme çubuğu kaydırınca ekranın tepesinde kalır; İşletme sekmesi sahip paneline (`/sahip`, sahip PIN'i) geçer, Müşteri sekmesi müşteri randevu linkini gösterir, açar ve paylaştırır. Müşteri linkinde (`/r/<şube>`) sekme çubuğu yoktur.

Telefonda tek sütun ve büyük yazı, bilgisayarda (960 px üstü) iki sütun. Telefona ve bilgisayara "Ana ekrana ekle / Uygulama olarak yükle" ile kurulur (PWA).

### Gerçek mod ve demo modu
Yayındaki uygulama **gerçek moddadır**: kayıtlar Cloudflare D1 veritabanında durur, müşteri kendi telefonundan randevu alır, salon panelindeki bütün cihazlar aynı kayıtları görür (açık panel 10 saniyede bir güncellenir). PIN'leri sunucu doğrular; PIN'ler tarayıcıya hiç gönderilmez.

`npm run dev` ise **demo modunda** açılır: sunucu gerekmez, kayıtlar o tarayıcıda durur, demo PIN'i `1234`.

## Hesap kurulumu

Tek hesap gerekir: Cloudflare (ücretsiz). Adımlar [KURULUM.md](KURULUM.md) dosyasında.

## Kurulum (geliştirici)

```bash
npm install
npm run dev        # demo modu, http://localhost:5173
npm test           # çekirdek testleri (iş günü, boş saat, ciro, online randevu)

# Sunucuyla birlikte yerelde (gerçek mod, http://localhost:8788)
npm run db:local
npx tsx scripts/seed.ts --owner-pin 111111 --manager-pin 222222 > seed.sql
npx wrangler d1 execute guzellik-salonu --local --file seed.sql
npm run preview
node scripts/api-smoke.mjs 111111 222222   # yetki ve randevu denemeleri (başka terminalde)
```

## Klasör yapısı

```
src/
  core/            Ortak çekirdek (dört sektörde aynı)
    types.ts         Veri modeli
    time.ts          İş günü, tarih/saat, para biçimi
    scheduling.ts    Boş saat ve personel çakışma hesabı
    reports.ts       Ciro, personel payı, gider
    data/            Veri katmanı: demoStore (kayıt), actions (işlemler), remote (sunucu), rows (satır dönüşümü)
  sectors/         Sektör paketleri: renkler, hizmet kataloğu, varsayılanlar
    guzellik/        Güzellik salonu (ilk paket)
  i18n/tr.ts       Ekrandaki tüm yazılar (ikinci dil = bu dosyanın çevirisi)
  pages/           Ekranlar: HomePage, PanelPage (+ panel/), BookingPage
  ui/              Ortak parçalar (hizmet/personel/saat seçici, tablo)
server/api.ts      Sunucu (Pages Functions)
db/migrations/     D1 veritabanı şeması
scripts/           seed.ts (örnek salon), api-smoke.mjs (sunucu denemesi)
```

Para birimi, saat dilimi, dil ve ülke her işletmenin ayarıdır (varsayılan TRY, Europe/Istanbul, tr-TR, TR).

## Sunucu ve veritabanı

- `functions/api/[[route]].ts` → `server/api.ts`: Cloudflare Pages Functions üzerinde çalışan sunucu.
- `db/migrations/0001_init.sql`: D1 şeması. Kayıtlar tek tabloda JSON olarak durur; her yazmada genel sayaç artar, paneller yalnızca değişen satırları çeker.
- Yetkiler sunucuda: sahip her şeyi; yönetici yalnızca kendi şubesini; resepsiyon randevu, müşteri, paket ve stoğu; uzman yalnızca kendi randevularını değiştirir. Uzman başkalarının randevu tutarını ve giderleri görmez.
- Müşteri hesap açmaz: randevu sayfası yalnızca şubenin herkese açık bilgisini ve dolu saatleri (isimsiz) görür. Talep sunucuda tekrar kontrol edilir; aynı saat aynı uzmana iki kez verilmez. Müşteri kendi randevusunu, telefonuna verilen gizli anahtarla görür ve iptal eder.
- Yanlış PIN 15 dakikada 8 denemeyle, randevu talebi saatte 10 taleple sınırlı.

## Yol haritası

1. ✅ İskelet, ortak çekirdek, güzellik paketi, demo modunda tam çalışan ekranlar, veritabanı şeması
2. ✅ Ortak veritabanı ve sunucu (Cloudflare Pages + D1): PIN'le giriş, ortak kayıtlar, online randevu
3. Cloudflare hesabını açıp yayına almak (KURULUM.md)
4. ✅ Prototipten kalanlar: İşletme (sahip) paneli ve abonelik ücreti, seanslı paketler, stok, oda/cihaz listesi, fotoğraflar, geçen ay görünümü (yedek indirme veritabanına geçince gereksiz)
5. Pilot salon (2-3 hafta), sonra bayan kuaför, berber, spor salonu paketleri
