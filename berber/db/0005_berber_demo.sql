-- Berberim demo (tanıtım) dükkânı: berber-demo · "Demo Berber Salonu"
--   Panel:   /s/berber-demo   (personel PIN'siz girer, Yönetici PIN'i 1234, İşletme kapalı)
--   Müşteri: /r/berber-demo
-- Bu dosya YALNIZCA kod = 'berber-demo' satırları EKLER (INSERT OR IGNORE). Hiçbir satırı güncellemez
-- ya da silmez; Fatih Berber ve diğer dükkânlar etkilenmez. İki kez çalıştırılsa da ikinci sefer bir şey eklemez.
-- Demo davranışı (PIN'siz personel, İşletme kapalı, PIN değiştirilemez) koddadır: src/server.js DEMO_SHOPS.
-- Müşteri telefonları gerçek değildir (0000 000 00 01-08); dükkân telefonu boştur. Deneme süresi 1 yıl.
-- Tarihler çalıştırıldığı güne göredir: iş günü 06:00'da başlar, Türkiye saati UTC+3 → bugünkü iş günü date('now','-3 hours').
--
-- Geri almak (yalnızca demo satırları):
--   DELETE FROM berber_randevu WHERE kod = 'berber-demo';
--   DELETE FROM berber_kayit   WHERE kod = 'berber-demo';
--   DELETE FROM berber_gider   WHERE kod = 'berber-demo';
--   DELETE FROM berber_sira    WHERE kod = 'berber-demo';
--   DELETE FROM sessions       WHERE branch_id = 'berber-demo' AND role LIKE 'berber_%';
--   DELETE FROM secrets        WHERE key = 'berber:yon:berber-demo' OR key LIKE 'berber:per:berber-demo:%';
--   DELETE FROM berber_shops   WHERE kod = 'berber-demo';
--   DELETE FROM plat_shops     WHERE kod = 'berber-demo';

-- Abonelik (sahip paneli): 1 yıl deneme, durdurulmamış, telefon boş
INSERT OR IGNORE INTO plat_shops (id, kod, data)
SELECT 'berber-demo', 'berber-demo', json_object(
  'id', 'berber-demo', 'ad', 'Demo Berber Salonu', 'sektor', 'Berber', 'tel', '',
  'paket', 'p1', 'deneme', json('true'), 'bitis', date('now', '+1 year'), 'dur', json('false'),
  'not', 'Demo (tanıtım) dükkânı', 'isl', '', 'kod', 'berber-demo')
WHERE NOT EXISTS (SELECT 1 FROM plat_shops WHERE kod = 'berber-demo');

-- Dükkân: telefon/WhatsApp boş, 3 personel, 6 hizmet
INSERT OR IGNORE INTO berber_shops (kod, isl, data) VALUES ('berber-demo', 'berber-demo', json_object(
  'ad', 'Demo Berber Salonu', 'wa', '', 'adres', 'Demo Mah. Örnek Cad. No: 1',
  'gunbas', '06:00', 'acilis', '09:00', 'kapanis', '22:00', 'aralik', 30,
  'hizmetler', json('[{"ad":"Saç kesimi","fiyat":300},{"ad":"Sakal","fiyat":150},{"ad":"Saç + sakal","fiyat":400},{"ad":"Çocuk tıraşı","fiyat":200},{"ad":"Yıkama + fön","fiyat":100},{"ad":"Cilt bakımı","fiyat":350}]'),
  'personel', json('[{"id":"ahmet","ad":"Ahmet","prim":40,"aktif":true},{"id":"mehmet","ad":"Mehmet","prim":45,"aktif":true},{"id":"can","ad":"Can","prim":50,"aktif":true}]')));

-- Yönetici PIN'i: 1234 (tuzlu SHA-256 özeti). Personelin PIN'i yok (demo'da PIN'siz girer).
INSERT OR IGNORE INTO secrets (key, hash) VALUES ('berber:yon:berber-demo', '7fb6cb667360ea05$50158cdbbd891a0860d317a97e272f17d024ee4eed65a040825350bbde724a6d');

-- Randevular ve sıra: bugün ve yarın (müşteri telefonları gerçek değil)
INSERT OR IGNORE INTO berber_randevu (kod, id, gun, tel, data, updated) VALUES
 ('berber-demo', 'demo-r1', date('now','-3 hours'), '0000000001', json_object('ad','Ali Yılmaz','tel','0000 000 00 01','saat','10:00','per','ahmet','hz','Saç kesimi','fiyat',300,'sira',1,'durum','geldi','kayit','demo-k1','kaynak','musteri','olus',unixepoch()*1000), unixepoch()*1000),
 ('berber-demo', 'demo-r2', date('now','-3 hours'), '0000000002', json_object('ad','Burak Demir','tel','0000 000 00 02','saat','11:00','per','mehmet','hz','Saç + sakal','fiyat',400,'sira',2,'durum','geldi','kayit','demo-k2','kaynak','musteri','olus',unixepoch()*1000), unixepoch()*1000),
 ('berber-demo', 'demo-r3', date('now','-3 hours'), '0000000003', json_object('ad','Cem Kaya','tel','0000 000 00 03','saat','14:00','per','can','hz','Sakal','fiyat',150,'sira',3,'durum','bekliyor','kaynak','musteri','olus',unixepoch()*1000), unixepoch()*1000),
 ('berber-demo', 'demo-r4', date('now','-3 hours'), '0000000004', json_object('ad','Deniz Arslan','tel','0000 000 00 04','saat','16:30','per','','hz','Saç kesimi','fiyat',300,'sira',4,'durum','bekliyor','kaynak','musteri','olus',unixepoch()*1000), unixepoch()*1000),
 ('berber-demo', 'demo-r5', date('now','-3 hours'), '0000000005', json_object('ad','Emre Şahin','tel','0000 000 00 05','saat','','per','','hz','Çocuk tıraşı','fiyat',200,'sira',5,'durum','bekliyor','kaynak','panel','olus',unixepoch()*1000), unixepoch()*1000),
 ('berber-demo', 'demo-r6', date('now','-3 hours','+1 day'), '0000000006', json_object('ad','Fatih Çelik','tel','0000 000 00 06','saat','10:30','per','ahmet','hz','Saç + sakal','fiyat',400,'sira',1,'durum','bekliyor','kaynak','musteri','olus',unixepoch()*1000), unixepoch()*1000),
 ('berber-demo', 'demo-r7', date('now','-3 hours','+1 day'), '0000000007', json_object('ad','Gökhan Aydın','tel','0000 000 00 07','saat','13:00','per','mehmet','hz','Cilt bakımı','fiyat',350,'sira',2,'durum','bekliyor','kaynak','musteri','olus',unixepoch()*1000), unixepoch()*1000),
 ('berber-demo', 'demo-r8', date('now','-3 hours','+1 day'), '0000000008', json_object('ad','Hakan Öztürk','tel','0000 000 00 08','saat','18:00','per','can','hz','Saç kesimi','fiyat',300,'sira',3,'durum','bekliyor','kaynak','musteri','olus',unixepoch()*1000), unixepoch()*1000);

INSERT OR IGNORE INTO berber_sira (kod, gun, n) VALUES
 ('berber-demo', date('now','-3 hours'), 5),
 ('berber-demo', date('now','-3 hours','+1 day'), 3);

-- Ciro kayıtları: bugün (2'si randevudan) ve son 5 gün
INSERT OR IGNORE INTO berber_kayit (kod, id, gun, data) VALUES
 ('berber-demo', 'demo-k1', date('now','-3 hours'), json_object('per','ahmet','hz','Saç kesimi','tutar',300,'od','nakit','prim',40,'ts',unixepoch()*1000,'rid','demo-r1','mus','Ali Yılmaz')),
 ('berber-demo', 'demo-k2', date('now','-3 hours'), json_object('per','mehmet','hz','Saç + sakal','tutar',400,'od','kart','prim',45,'ts',unixepoch()*1000,'rid','demo-r2','mus','Burak Demir')),
 ('berber-demo', 'demo-k3', date('now','-3 hours'), json_object('per','can','hz','Yıkama + fön','tutar',100,'od','nakit','prim',50,'ts',unixepoch()*1000,'mus','')),
 ('berber-demo', 'demo-k4', date('now','-3 hours','-1 day'), json_object('per','ahmet','hz','Saç + sakal','tutar',400,'od','kart','prim',40,'ts',(unixepoch()-86400)*1000,'mus','Hakan Öztürk')),
 ('berber-demo', 'demo-k5', date('now','-3 hours','-1 day'), json_object('per','mehmet','hz','Saç kesimi','tutar',300,'od','nakit','prim',45,'ts',(unixepoch()-86400)*1000,'mus','')),
 ('berber-demo', 'demo-k6', date('now','-3 hours','-1 day'), json_object('per','can','hz','Cilt bakımı','tutar',350,'od','kart','prim',50,'ts',(unixepoch()-86400)*1000,'mus','Cem Kaya')),
 ('berber-demo', 'demo-k7', date('now','-3 hours','-2 days'), json_object('per','ahmet','hz','Sakal','tutar',150,'od','nakit','prim',40,'ts',(unixepoch()-2*86400)*1000,'mus','')),
 ('berber-demo', 'demo-k8', date('now','-3 hours','-2 days'), json_object('per','can','hz','Çocuk tıraşı','tutar',200,'od','nakit','prim',50,'ts',(unixepoch()-2*86400)*1000,'mus','Emre Şahin')),
 ('berber-demo', 'demo-k9', date('now','-3 hours','-3 days'), json_object('per','mehmet','hz','Saç + sakal','tutar',400,'od','kart','prim',45,'ts',(unixepoch()-3*86400)*1000,'mus','Deniz Arslan')),
 ('berber-demo', 'demo-k10', date('now','-3 hours','-4 days'), json_object('per','ahmet','hz','Saç kesimi','tutar',300,'od','nakit','prim',40,'ts',(unixepoch()-4*86400)*1000,'mus','Ali Yılmaz')),
 ('berber-demo', 'demo-k11', date('now','-3 hours','-5 days'), json_object('per','can','hz','Saç kesimi','tutar',300,'od','kart','prim',50,'ts',(unixepoch()-5*86400)*1000,'mus','Gökhan Aydın'));

-- Giderler
INSERT OR IGNORE INTO berber_gider (kod, id, gun, data) VALUES
 ('berber-demo', 'demo-g1', date('now','-3 hours','-2 days'), json_object('tur','Malzeme (jilet, köpük, kolonya)','tutar',450,'not','Örnek gider')),
 ('berber-demo', 'demo-g2', date('now','-3 hours','-1 day'), json_object('tur','Çay / ikram','tutar',120,'not',''));
