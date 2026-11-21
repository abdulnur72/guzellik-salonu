-- Kuaförüm (bayan kuaför uygulaması) tabloları.
-- Güzellik salonu, halı yıkama ve berberle aynı Cloudflare D1 veritabanında durur (ortak veritabanı):
-- abonelik ve "Durdur" kilidi sahip panelinin plat_shops tablosundan okunur (kod = kuaförün link kodu,
-- sektör "Bayan Kuaför"), PIN özetleri secrets tablosunda (kuafor:yon:<kod>, kuafor:per:<kod>:<personel>),
-- oturumlar sessions tablosunda (role = kuafor_yon / kuafor_per / kuafor_isl, branch_id = kod),
-- yanlış PIN ve randevu sınırı attempts tablosunda tutulur.
--
-- "gun" sütunu takvim günü değil İŞ GÜNÜDÜR: kuaförün iş günü başlangıç saatinden (varsayılan 06:00)
-- ertesi gün aynı saate kadar. Gece 01:30'daki gelin saçı bir önceki günün cirosuna yazılır.

CREATE TABLE IF NOT EXISTS kuafor_shops (
  kod  TEXT PRIMARY KEY,               -- link kodu: /r/<kod>, /s/<kod>
  isl  TEXT NOT NULL,                  -- işletme: merkez şubenin kodu (tek şubede kendi kodu)
  data TEXT NOT NULL,                  -- JSON: ad, wa, adres, hizmetler, personel, gunbas, acilis, kapanis, aralik
  ver  INTEGER NOT NULL DEFAULT 1      -- her yazmada artar; panel değişikliği buradan anlar
);
CREATE INDEX IF NOT EXISTS kuafor_shops_isl ON kuafor_shops (isl);

CREATE TABLE IF NOT EXISTS kuafor_randevu (
  kod     TEXT NOT NULL,
  id      TEXT NOT NULL,
  gun     TEXT NOT NULL,               -- iş günü (YYYY-MM-DD)
  tel     TEXT NOT NULL DEFAULT '',    -- telefonun son 10 hanesi ("Randevularım" için)
  data    TEXT NOT NULL,               -- JSON: ad, tel, saat, sure, per, hz[], fiyat, not, durum, kayit, k
  updated INTEGER NOT NULL,
  PRIMARY KEY (kod, id)
);
CREATE INDEX IF NOT EXISTS kuafor_randevu_gun ON kuafor_randevu (kod, gun);
CREATE INDEX IF NOT EXISTS kuafor_randevu_tel ON kuafor_randevu (kod, tel);

-- Ciro kaydı: her gelen müşteri bir satır (nakit/kart, personel ve o anki prim oranı).
-- Boya gibi tekrar eden hizmette "hat" hatırlatma günüdür, "hy" hatırlatıldığı gün.
CREATE TABLE IF NOT EXISTS kuafor_kayit (
  kod  TEXT NOT NULL,
  id   TEXT NOT NULL,
  gun  TEXT NOT NULL,
  data TEXT NOT NULL,                  -- JSON: per, hz, tutar, od (nakit/kart), prim, ts, rid, mus, tel, hat, hy
  PRIMARY KEY (kod, id)
);
CREATE INDEX IF NOT EXISTS kuafor_kayit_gun ON kuafor_kayit (kod, gun);

CREATE TABLE IF NOT EXISTS kuafor_gider (
  kod  TEXT NOT NULL,
  id   TEXT NOT NULL,
  gun  TEXT NOT NULL,
  data TEXT NOT NULL,                  -- JSON: tur, tutar, not
  PRIMARY KEY (kod, id)
);
CREATE INDEX IF NOT EXISTS kuafor_gider_gun ON kuafor_gider (kod, gun);

-- İlk dükkân: Selin Kuaför (30 gün deneme). Yönetici PIN'i sahip panelinden belirlenir.
INSERT OR IGNORE INTO plat_shops (id, kod, data)
SELECT 'selin-kuafor', 'selin-kuafor', json_object(
  'id', 'selin-kuafor', 'ad', 'Selin Kuaför', 'sektor', 'Bayan Kuaför', 'tel', '',
  'paket', 'p1', 'deneme', json('true'), 'bitis', date('now', '+30 days'), 'dur', json('false'),
  'not', '', 'isl', '', 'kod', 'selin-kuafor')
WHERE NOT EXISTS (SELECT 1 FROM plat_shops WHERE kod = 'selin-kuafor');

INSERT OR IGNORE INTO kuafor_shops (kod, isl, data) VALUES ('selin-kuafor', 'selin-kuafor', '{"ad":"Selin Kuaför","wa":"","adres":""}');
