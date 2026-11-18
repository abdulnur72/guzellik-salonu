-- Halı yıkama uygulamasının tabloları.
-- Güzellik salonuyla aynı Cloudflare D1 veritabanında durur (ortak veritabanı):
-- abonelik ve kilit sahip panelinin plat_shops tablosundan okunur (kod = halıcının link kodu),
-- PIN özetleri secrets tablosunda (hali:yon:<kod>, hali:per:<kod>),
-- oturumlar sessions tablosunda (role = hali_yon / hali_per, branch_id = kod),
-- yanlış PIN ve talep sınırı attempts tablosunda tutulur.

CREATE TABLE IF NOT EXISTS hali_shops (
  kod     TEXT PRIMARY KEY,              -- link kodu: /r/<kod>, /s/<kod>
  data    TEXT NOT NULL,                 -- JSON: ad, wa, adres, turler [{ad, bf}]
  next_no INTEGER NOT NULL DEFAULT 101,  -- sıradaki sipariş numarası
  ver     INTEGER NOT NULL DEFAULT 1     -- her yazmada artar; panel değişikliği buradan anlar
);

CREATE TABLE IF NOT EXISTS hali_orders (
  kod     TEXT NOT NULL,
  no      INTEGER NOT NULL,              -- sipariş numarası (halıcıya göre)
  tel     TEXT NOT NULL DEFAULT '',      -- telefonun son 10 hanesi (sorgu için)
  a       INTEGER NOT NULL DEFAULT 0,    -- aşama 0..5
  data    TEXT NOT NULL,                 -- JSON: ad, tel, adr, saat, not, rugs, od, olus, kaynak
  updated INTEGER NOT NULL,
  PRIMARY KEY (kod, no)
);
CREATE INDEX IF NOT EXISTS hali_orders_tel ON hali_orders (kod, tel);

CREATE TABLE IF NOT EXISTS hali_expenses (
  kod  TEXT NOT NULL,
  id   TEXT NOT NULL,
  tar  TEXT NOT NULL,                    -- YYYY-MM-DD
  data TEXT NOT NULL,                    -- JSON: tur, tutar, not
  PRIMARY KEY (kod, id)
);
CREATE INDEX IF NOT EXISTS hali_expenses_tar ON hali_expenses (kod, tar);
