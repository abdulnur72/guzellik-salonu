-- Güzellik salonu veritabanı (Cloudflare D1 / SQLite)
--
-- Tüm kayıtlar tek tabloda, JSON olarak durur. Her satır bir türe (kind)
-- ve şubeye (branch_id) aittir. Her yazmada genel sayaç (meta.seq) bir artar
-- ve değişen satırlara yazılır; panel açık olan cihazlar yalnızca son
-- gördükleri sayaçtan sonra değişen satırları çeker.

CREATE TABLE rows (
  kind      TEXT NOT NULL,             -- business, branch, staff, service, customer, appointment, expense, package, stock
  id        TEXT NOT NULL,
  branch_id TEXT NOT NULL,             -- işletme satırında ''
  ix        TEXT,                      -- arama anahtarı: şubede kısa ad, randevuda tarih, müşteride telefon
  data      TEXT NOT NULL,             -- JSON (PIN'ler burada değil, secrets tablosunda)
  seq       INTEGER NOT NULL,
  deleted   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (kind, id)
);
CREATE INDEX rows_seq ON rows (seq);
CREATE INDEX rows_branch_seq ON rows (branch_id, seq);
CREATE INDEX rows_lookup ON rows (branch_id, kind, ix);
CREATE INDEX rows_kind_ix ON rows (kind, ix);

CREATE TABLE meta (k TEXT PRIMARY KEY, v INTEGER NOT NULL);
INSERT INTO meta (k, v) VALUES ('seq', 0);

-- PIN özetleri (tuzlu SHA-256). Anahtar: owner, manager:<şube>, staff:<personel>
CREATE TABLE secrets (key TEXT PRIMARY KEY, hash TEXT NOT NULL);

-- Giriş oturumları
CREATE TABLE sessions (
  token     TEXT PRIMARY KEY,
  role      TEXT NOT NULL,             -- owner, manager, staff
  branch_id TEXT,
  staff_id  TEXT,
  expires   INTEGER NOT NULL
);

-- Yanlış PIN ve randevu talebi sınırı
CREATE TABLE attempts (key TEXT NOT NULL, ts INTEGER NOT NULL);
CREATE INDEX attempts_key ON attempts (key, ts);

-- Müşterinin kendi randevusunu görmesi/iptal etmesi için verilen anahtar
CREATE TABLE booking_tokens (appt_id TEXT PRIMARY KEY, token TEXT NOT NULL);
