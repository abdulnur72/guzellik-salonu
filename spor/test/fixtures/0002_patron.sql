-- Sahip paneli (/patron): uygulamayı kiralayan dükkânların aboneliği.
-- Salon kayıtlarına (rows tablosu) dokunmaz. Dükkânın "kod"u uygulamadaki
-- şube kısa adıyla (/r/<kod>, /s/<kod>) aynıysa abonelik o şubeye uygulanır:
-- süresi biten ya da durdurulan dükkânın linkleri kapanır, kayıtlar silinmez.

CREATE TABLE plat_shops (
  id   TEXT PRIMARY KEY,
  kod  TEXT NOT NULL UNIQUE,
  data TEXT NOT NULL               -- JSON: ad, sektor, tel, paket, deneme, bitis, dur, not, isl
);

CREATE TABLE plat_payments (
  id      TEXT PRIMARY KEY,
  shop_id TEXT NOT NULL,
  t       TEXT NOT NULL,           -- ödeme günü (YYYY-MM-DD)
  data    TEXT NOT NULL            -- JSON: ad, tutar, ay, y, onc (ödemeden önceki hal)
);
CREATE INDEX plat_payments_t ON plat_payments (t);

CREATE TABLE plat_kv (k TEXT PRIMARY KEY, data TEXT NOT NULL);  -- ayar, paketler

INSERT INTO plat_kv (k, data) VALUES
  ('ayar', '{"sube":300,"adres":"https://guzellik-salonu.pages.dev","wa":""}'),
  ('paketler', '[{"id":"p1","ad":"Başlangıç","fiyat":500,"pers":2},{"id":"p2","ad":"Standart","fiyat":900,"pers":5},{"id":"p3","ad":"Pro","fiyat":1500,"pers":20}]');

-- İlk dükkân: Lila Güzellik Salonu (30 gün deneme ile başlar)
INSERT INTO plat_shops (id, kod, data)
SELECT 'lila', 'lila', json_object(
  'id', 'lila', 'ad', 'Lila Güzellik Salonu', 'sektor', 'Güzellik Salonu',
  'tel', COALESCE((SELECT json_extract(data, '$.phone') FROM rows WHERE kind = 'branch' AND ix = 'lila' AND deleted = 0), ''),
  'paket', 'p2', 'deneme', json('true'), 'bitis', date('now', '+30 days'), 'dur', json('false'),
  'not', '', 'isl', '', 'kod', 'lila');
