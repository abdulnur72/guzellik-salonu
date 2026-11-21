-- Çok dükkânlı güzellik uygulaması: her güzellik salonu (işletme) kendi
-- kayıtlarını, kendi sahip PIN'ini ve kendi kodunu kullanır.
--
-- Yalnızca EKLEME yapar: hiçbir satır silinmez, hiçbir sütun ya da tablo
-- kaldırılmaz, PIN'ler değişmez. Eski sürüm (tek işletmeli) kod bu
-- veritabanıyla aynen çalışmaya devam eder; gerekirse eski Worker'a dönülebilir.
--
-- Var olan işletme (canlıda Lila Güzellik Salonu) en eski işletme satırıdır;
-- bütün mevcut güzellik kayıtları ona yazılır. Halı, berber, kuaför, spor ve
-- sahip paneli (plat_*) tablolarına dokunulmaz.

-- 1) Her güzellik satırı hangi işletmeye ait (işletme kimliği)
ALTER TABLE rows ADD COLUMN biz TEXT NOT NULL DEFAULT '';
UPDATE rows
   SET biz = (SELECT id FROM rows WHERE kind = 'business' AND deleted = 0 ORDER BY rowid LIMIT 1)
 WHERE biz = ''
   AND EXISTS (SELECT 1 FROM rows WHERE kind = 'business' AND deleted = 0);
CREATE INDEX rows_biz_seq ON rows (biz, seq);
CREATE INDEX rows_biz_kind ON rows (biz, kind, ix);

-- 2) Güzellik oturumları hangi işletmenin (halı/berber/kuaför/spor/sahip paneli
--    oturumlarında boş kalır, onlar bu sütunu kullanmaz)
ALTER TABLE sessions ADD COLUMN biz TEXT;
UPDATE sessions
   SET biz = (SELECT id FROM rows WHERE kind = 'business' AND deleted = 0 ORDER BY rowid LIMIT 1)
 WHERE role IN ('owner', 'manager', 'staff');

-- 3) İşletmeye özel sahip PIN'i: mevcut sahip PIN'inin özeti aynen kopyalanır
--    (PIN değişmez). Eski 'owner' anahtarı yerinde kalır.
INSERT OR IGNORE INTO secrets (key, hash)
SELECT 'owner:' || (SELECT id FROM rows WHERE kind = 'business' AND deleted = 0 ORDER BY rowid LIMIT 1), hash
  FROM secrets
 WHERE key = 'owner'
   AND EXISTS (SELECT 1 FROM rows WHERE kind = 'business' AND deleted = 0);
