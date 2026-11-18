-- Berberim (berber uygulaması) tabloları.
-- Güzellik salonu ve halı yıkamayla aynı Cloudflare D1 veritabanında durur (ortak veritabanı):
-- abonelik ve "Durdur" kilidi sahip panelinin plat_shops tablosundan okunur (kod = dükkânın link kodu),
-- PIN özetleri secrets tablosunda (berber:yon:<kod>, berber:per:<kod>:<personel>),
-- oturumlar sessions tablosunda (role = berber_yon / berber_per / berber_isl, branch_id = kod),
-- yanlış PIN ve randevu sınırı attempts tablosunda tutulur.
--
-- "gun" sütunu takvim günü değil İŞ GÜNÜDÜR: dükkânın iş günü başlangıç saatinden (varsayılan 06:00)
-- ertesi gün aynı saate kadar. Gece 01:30'daki tıraş bir önceki günün cirosuna yazılır.

CREATE TABLE IF NOT EXISTS berber_shops (
  kod  TEXT PRIMARY KEY,               -- link kodu: /r/<kod>, /s/<kod>
  isl  TEXT NOT NULL,                  -- işletme: merkez şubenin kodu (tek şubede kendi kodu)
  data TEXT NOT NULL,                  -- JSON: ad, wa, adres, hizmetler, personel, gunbas, acilis, kapanis, aralik
  ver  INTEGER NOT NULL DEFAULT 1      -- her yazmada artar; panel değişikliği buradan anlar
);
CREATE INDEX IF NOT EXISTS berber_shops_isl ON berber_shops (isl);

CREATE TABLE IF NOT EXISTS berber_randevu (
  kod     TEXT NOT NULL,
  id      TEXT NOT NULL,
  gun     TEXT NOT NULL,               -- iş günü (YYYY-MM-DD)
  tel     TEXT NOT NULL DEFAULT '',    -- telefonun son 10 hanesi ("Randevularım" için)
  data    TEXT NOT NULL,               -- JSON: ad, tel, saat, per, hz, fiyat, sira, durum, kayit, k
  updated INTEGER NOT NULL,
  PRIMARY KEY (kod, id)
);
CREATE INDEX IF NOT EXISTS berber_randevu_gun ON berber_randevu (kod, gun);
CREATE INDEX IF NOT EXISTS berber_randevu_tel ON berber_randevu (kod, tel);

-- Ciro kaydı: her yapılan hizmet bir satır (nakit/kart, personel ve o anki prim oranı)
CREATE TABLE IF NOT EXISTS berber_kayit (
  kod  TEXT NOT NULL,
  id   TEXT NOT NULL,
  gun  TEXT NOT NULL,
  data TEXT NOT NULL,                  -- JSON: per, hz, tutar, od (nakit/kart), prim, ts, rid, mus
  PRIMARY KEY (kod, id)
);
CREATE INDEX IF NOT EXISTS berber_kayit_gun ON berber_kayit (kod, gun);

CREATE TABLE IF NOT EXISTS berber_gider (
  kod  TEXT NOT NULL,
  id   TEXT NOT NULL,
  gun  TEXT NOT NULL,
  data TEXT NOT NULL,                  -- JSON: tur, tutar, not
  PRIMARY KEY (kod, id)
);
CREATE INDEX IF NOT EXISTS berber_gider_gun ON berber_gider (kod, gun);

-- Günlük sıra numarası sayacı (iş günü başına 1'den başlar)
CREATE TABLE IF NOT EXISTS berber_sira (
  kod TEXT NOT NULL,
  gun TEXT NOT NULL,
  n   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (kod, gun)
);

-- İlk dükkân: Fatih Berber (30 gün deneme). PIN'leri sahip panelinden belirlenir.
INSERT OR IGNORE INTO plat_shops (id, kod, data)
SELECT 'fatih-berber', 'fatih-berber', json_object(
  'id', 'fatih-berber', 'ad', 'Fatih Berber', 'sektor', 'Berber', 'tel', '',
  'paket', 'p1', 'deneme', json('true'), 'bitis', date('now', '+30 days'), 'dur', json('false'),
  'not', '', 'isl', '', 'kod', 'fatih-berber')
WHERE NOT EXISTS (SELECT 1 FROM plat_shops WHERE kod = 'fatih-berber');

INSERT OR IGNORE INTO berber_shops (kod, isl, data) VALUES ('fatih-berber', 'fatih-berber', '{"ad":"Fatih Berber","wa":"","adres":""}');
