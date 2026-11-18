-- Sporum (spor salonu uygulaması) tabloları.
-- Güzellik salonu, halı yıkama, berber ve kuaförle aynı Cloudflare D1 veritabanında durur (ortak veritabanı):
-- abonelik ve "Durdur" kilidi sahip panelinin plat_shops tablosundan okunur (kod = salonun link kodu,
-- sektör "Spor Salonu"), PIN özetleri secrets tablosunda (spor:yon:<kod>, spor:per:<kod>:<antrenör>),
-- oturumlar sessions tablosunda (role = spor_yon / spor_per / spor_isl, branch_id = kod),
-- yanlış PIN ve randevu sınırı attempts tablosunda tutulur.
--
-- "gun" sütunu İŞ GÜNÜDÜR: salonun iş günü başlangıç saatinden (varsayılan 00:00) ertesi gün aynı saate kadar.

CREATE TABLE IF NOT EXISTS spor_shops (
  kod  TEXT PRIMARY KEY,               -- link kodu: /r/<kod>, /s/<kod>
  isl  TEXT NOT NULL,                  -- işletme: merkez şubenin kodu (tek şubede kendi kodu)
  data TEXT NOT NULL,                  -- JSON: ad, wa, adres, hizmetler, dersler, personel, gunbas, acilis, kapanis, aralik
  ver  INTEGER NOT NULL DEFAULT 1      -- her yazmada artar; panel değişikliği buradan anlar
);
CREATE INDEX IF NOT EXISTS spor_shops_isl ON spor_shops (isl);

-- Randevu: kişisel antrenman, ölçüm, üyelik/paket kaydı için gelme
CREATE TABLE IF NOT EXISTS spor_randevu (
  kod     TEXT NOT NULL,
  id      TEXT NOT NULL,
  gun     TEXT NOT NULL,
  tel     TEXT NOT NULL DEFAULT '',    -- telefonun son 10 hanesi ("Randevularım" için)
  data    TEXT NOT NULL,               -- JSON: ad, tel, saat, sure, per, hz[], fiyat, not, durum, kayit, k
  updated INTEGER NOT NULL,
  PRIMARY KEY (kod, id)
);
CREATE INDEX IF NOT EXISTS spor_randevu_gun ON spor_randevu (kod, gun);
CREATE INDEX IF NOT EXISTS spor_randevu_tel ON spor_randevu (kod, tel);

-- Ders kaydı: grup dersine (pilates, yoga, spinning...) katılım. Telefon zorunlu, kontenjanlı.
CREATE TABLE IF NOT EXISTS spor_katilim (
  kod     TEXT NOT NULL,
  id      TEXT NOT NULL,
  gun     TEXT NOT NULL,               -- dersin günü
  tel     TEXT NOT NULL,               -- telefonun son 10 hanesi
  data    TEXT NOT NULL,               -- JSON: ders, ad, tel, durum (kayitli/iptal), kaynak, k, olus
  updated INTEGER NOT NULL,
  PRIMARY KEY (kod, id)
);
CREATE INDEX IF NOT EXISTS spor_katilim_gun ON spor_katilim (kod, gun);
CREATE INDEX IF NOT EXISTS spor_katilim_tel ON spor_katilim (kod, tel);

-- Üye kartı: üyelik bitişi, paket (kalan ders), dondurma, sorumlu antrenör
CREATE TABLE IF NOT EXISTS spor_uye (
  kod     TEXT NOT NULL,
  id      TEXT NOT NULL,
  tel     TEXT NOT NULL DEFAULT '',
  data    TEXT NOT NULL,               -- JSON: ad, tel, per, bitis, uyelik, paket{ad,kalan,top}, don{bas,bit,gun}, son, not, olus
  updated INTEGER NOT NULL,
  PRIMARY KEY (kod, id)
);
CREATE INDEX IF NOT EXISTS spor_uye_tel ON spor_uye (kod, tel);

-- Giriş kaydı (turnike yerine): üye salona geldi; paketten ders düştüyse "seans" işaretli
CREATE TABLE IF NOT EXISTS spor_giris (
  kod  TEXT NOT NULL,
  id   TEXT NOT NULL,
  gun  TEXT NOT NULL,
  data TEXT NOT NULL,                  -- JSON: uye, ad, per, ts, seans
  PRIMARY KEY (kod, id)
);
CREATE INDEX IF NOT EXISTS spor_giris_gun ON spor_giris (kod, gun);

-- Satış / ciro kaydı: üyelik, paket, ders, ürün (nakit/kart, antrenör ve o anki prim oranı).
-- Üyelik/paket satışında üye kartının önceki ve sonraki hali saklanır ("Geri al" / "Sil" geri çevirir).
CREATE TABLE IF NOT EXISTS spor_kayit (
  kod  TEXT NOT NULL,
  id   TEXT NOT NULL,
  gun  TEXT NOT NULL,
  data TEXT NOT NULL,                  -- JSON: per, hz, tutar, od, prim, ts, rid, mus, tel, uye, once, sonra, yeni
  PRIMARY KEY (kod, id)
);
CREATE INDEX IF NOT EXISTS spor_kayit_gun ON spor_kayit (kod, gun);

CREATE TABLE IF NOT EXISTS spor_gider (
  kod  TEXT NOT NULL,
  id   TEXT NOT NULL,
  gun  TEXT NOT NULL,
  data TEXT NOT NULL,                  -- JSON: tur, tutar, not
  PRIMARY KEY (kod, id)
);
CREATE INDEX IF NOT EXISTS spor_gider_gun ON spor_gider (kod, gun);

-- İlk salon: Atlas Spor Salonu (30 gün deneme). Yönetici PIN'i sahip panelinden belirlenir.
INSERT OR IGNORE INTO plat_shops (id, kod, data)
SELECT 'atlas-spor', 'atlas-spor', json_object(
  'id', 'atlas-spor', 'ad', 'Atlas Spor Salonu', 'sektor', 'Spor Salonu', 'tel', '',
  'paket', 'p1', 'deneme', json('true'), 'bitis', date('now', '+30 days'), 'dur', json('false'),
  'not', '', 'isl', '', 'kod', 'atlas-spor')
WHERE NOT EXISTS (SELECT 1 FROM plat_shops WHERE kod = 'atlas-spor');

INSERT OR IGNORE INTO spor_shops (kod, isl, data) VALUES ('atlas-spor', 'atlas-spor', '{"ad":"Atlas Spor Salonu","wa":"","adres":""}');
