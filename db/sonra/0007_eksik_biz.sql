-- 0007 uygulandıktan sonra, YENİ Worker yüklenince bir kez çalıştırılır.
--
-- 0007 ile yeni kodun yüklenmesi arasındaki kısa sürede eski (tek işletmeli)
-- kod yeni satır yazarsa bu satırların işletmesi boş ('') kalır ve yeni kod
-- onları göremez. Eski kod yalnızca ilk işletmeyi (Lila) bildiği için bu
-- satırların hepsi Lila'nındır. Yeni kod hiçbir zaman boş işletme yazmaz;
-- bu yüzden komut tekrar çalıştırılsa da zararsızdır.
UPDATE rows
   SET biz = (SELECT id FROM rows WHERE kind = 'business' AND deleted = 0 AND biz <> '' ORDER BY rowid LIMIT 1)
 WHERE biz = ''
   AND EXISTS (SELECT 1 FROM rows WHERE kind = 'business' AND deleted = 0 AND biz <> '');
UPDATE sessions
   SET biz = (SELECT id FROM rows WHERE kind = 'business' AND deleted = 0 AND biz <> '' ORDER BY rowid LIMIT 1)
 WHERE biz IS NULL AND role IN ('owner', 'manager', 'staff');
