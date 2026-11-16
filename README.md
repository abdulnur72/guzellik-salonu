# Güzellik Salonu

Lila Güzellik Salonu takip uygulaması (telefonda uygulama gibi çalışan tek sayfalık web uygulaması).

## Ekranlar

- **`/`** – Açılış ekranı. Üstte sekmeler: **Yönetici, Personel, Randevu, İşletme, Müşteri**.
- **`/r/lila`** – Müşteri linki. Sadece online randevu sayfası açılır; yönetim sekmeleri görünmez.

## Yerelde çalıştırma

```bash
python3 dev-server.py
# http://localhost:8000        -> salon paneli
# http://localhost:8000/r/lila -> müşteri randevu sayfası
```

## Yayınlama

Statik dosyalardan oluşur. Cloudflare Pages / Netlify için `_redirects` dosyası
`/r/*` adreslerini `index.html`'e yönlendirir.

Telefonda “Ana ekrana ekle” ile uygulama gibi açılır (`manifest.webmanifest`).

## Durum

Demo: kayıtlar tarayıcıda (localStorage) tutulur; sunucu/veritabanı henüz yok.
