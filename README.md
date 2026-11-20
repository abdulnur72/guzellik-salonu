# Esnaflar Takip

Esnaflar için takip uygulamaları. Hepsi tek alan adının altında çalışır:
**esnaflartakip.com** (Cloudflare hesabında).

## Adres planı (unutma!)

Her uygulama kendi alt adresinde olacak. Uygulamalar **gerçek haline geldikçe
sırayla** bağlanır; hazır olmayanı bağlamıyoruz.

| Sıra | Alt adres                        | Uygulama        | Cloudflare'deki adı | Durum         |
|------|----------------------------------|-----------------|---------------------|---------------|
| 1    | https://hali.esnaflartakip.com     | Halı Yıkama     | `hali-yikama` (Worker) | Bağlanıyor  |
| –    | https://guzellik.esnaflartakip.com | Güzellik Salonu | `guzellik-salonu`   | Planlandı     |
| –    | https://kuafor.esnaflartakip.com   | Kuaför          | `kuaforum`          | Planlandı     |
| –    | https://berber.esnaflartakip.com   | Berber          | `berberim`          | Planlandı     |
| –    | https://spor.esnaflartakip.com     | Spor Salonu     | `sporum`            | Planlandı     |
| –    | https://patron.esnaflartakip.com   | Sahip Paneli    | (henüz yok)         | Planlandı     |

Sahip panelinin okuduğu ayar dosyası: [`patron/adresler.json`](patron/adresler.json).
Bir uygulama bağlandığında hem bu tabloyu hem o dosyadaki `durum` alanını
güncelle (`planlandi` → `baglaniyor` → `bagli`).

## Kurallar

- İzin, ayar veya ağ adresi değişikliği sahibinin açık **"evet"** onayı olmadan yapılmaz
  (bkz. [`CLAUDE.md`](CLAUDE.md)).
- Yeni alt adres yalnızca o uygulama gerçek kullanıma hazır olunca bağlanır.

## Bir alt adresi telefondan bağlama (Cloudflare)

1. Telefonda tarayıcıdan **dash.cloudflare.com** adresine girip oturum aç.
2. Sol üstteki menüden (☰) **Compute (Workers)** → **Workers & Pages** bölümüne gir.
3. Listeden uygulamanın Worker'ına dokun (ör. `hali-yikama`).
4. **Settings** (Ayarlar) sekmesine geç → **Domains & Routes** kısmını bul.
5. **+ Add** → **Custom domain** seç.
6. Kutuya alt adresi yaz (ör. `hali.esnaflartakip.com`) → **Add domain**.
7. Birkaç dakika bekle; durum **Active** olunca adres açılır.
