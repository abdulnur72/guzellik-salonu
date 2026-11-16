-- Yerel test: npm run test:db (bkz. README). Hata olursa ERROR ile durur.
\set ON_ERROR_STOP 1
grant usage on schema public, auth to anon, authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;

insert into auth.users values
  ('00000000-0000-0000-0000-00000000000a'), ('00000000-0000-0000-0000-00000000000b'),
  ('00000000-0000-0000-0000-00000000000c'), ('00000000-0000-0000-0000-00000000000d');
insert into businesses (id, name) values ('10000000-0000-0000-0000-000000000001', 'Lila'), ('10000000-0000-0000-0000-000000000002', 'Başka Salon');
insert into branches (id, business_id, name, slug) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Merkez', 'lila'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'Merkez', 'baska');
insert into staff (id, branch_id, name, commission_pct) values
  ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'Ayşe', 40),
  ('30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', 'Elif', 35);
insert into memberships (user_id, business_id, branch_id, role, staff_id) values
  ('00000000-0000-0000-0000-00000000000a', '10000000-0000-0000-0000-000000000001', null, 'owner', null),
  ('00000000-0000-0000-0000-00000000000b', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'staff', '30000000-0000-0000-0000-000000000001'),
  ('00000000-0000-0000-0000-00000000000c', '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'staff', '30000000-0000-0000-0000-000000000002'),
  ('00000000-0000-0000-0000-00000000000d', '10000000-0000-0000-0000-000000000002', null, 'owner', null);
insert into services (id, branch_id, category, name, duration_min, price) values
  ('40000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'El & Tırnak', 'Manikür', 45, 300),
  ('40000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', 'Diğer', 'Ürün satışı', 5, 0);
update services set hidden_from_customers = true where name = 'Ürün satışı';
insert into expenses (branch_id, date, title, amount) values ('20000000-0000-0000-0000-000000000001', current_date, 'Kira', 10000);

-- 1) Müşteri (anon): şube bilgisi, gizli hizmet görünmez
set role anon;
do $$ declare j json := public_branch('lila'); begin
  assert json_array_length(j->'services') = 1, 'gizli hizmet görünmemeli';
  assert json_array_length(j->'staff') = 2, 'iki uzman görünmeli';
end $$;
-- Tablolara doğrudan erişim yok
do $$ begin
  perform 1 from appointments; raise exception 'anon tabloya erişmemeli';
exception when insufficient_privilege then null; end $$;

-- 2) Online randevu: iki uzman dolunca üçüncü talep reddedilir
create temp table r as select * from book_appointment('lila', null, array['40000000-0000-0000-0000-000000000001']::uuid[], current_date + 3, '10:00', 'Deniz', '0555 111 22 33');
select * from book_appointment('lila', null, array['40000000-0000-0000-0000-000000000001']::uuid[], current_date + 3, '10:30', 'Ece', '05551112244');
do $$ begin
  perform book_appointment('lila', null, array['40000000-0000-0000-0000-000000000001']::uuid[], current_date + 3, '10:15', 'Fatma', '05551112255');
  raise exception 'dolu saat alınmamalı';
exception when raise_exception then
  if sqlerrm <> 'slot_taken' then raise; end if;
end $$;
-- Geçmiş tarih ve hatalı telefon reddedilir
do $$ begin
  perform book_appointment('lila', null, array['40000000-0000-0000-0000-000000000001']::uuid[], current_date - 1, '10:00', 'X', '05551112233');
  raise exception 'geçmiş tarih alınmamalı';
exception when raise_exception then if sqlerrm <> 'past_time' then raise; end if; end $$;
do $$ begin
  perform book_appointment('lila', null, array['40000000-0000-0000-0000-000000000001']::uuid[], current_date + 3, '12:00', 'X', '123');
  raise exception 'hatalı telefon alınmamalı';
exception when raise_exception then if sqlerrm <> 'invalid_contact' then raise; end if; end $$;
-- Müşteri iptali: yanlış anahtarla olmaz, doğru anahtarla olur; saat yeniden açılır
do $$ declare x r; begin
  select * into x from r;
  assert not cancel_my_appointment(x.appointment_id, gen_random_uuid()), 'yanlış anahtar iptal etmemeli';
  assert cancel_my_appointment(x.appointment_id, x.customer_token), 'doğru anahtar iptal etmeli';
  perform book_appointment('lila', null, array['40000000-0000-0000-0000-000000000001']::uuid[], current_date + 3, '10:15', 'Fatma', '05551112255');
end $$;
reset role;

-- 3) Personel: yalnızca kendi randevuları ve müşterileri; gider göremez
set role authenticated;
set test.uid = '00000000-0000-0000-0000-00000000000b';
do $$ declare n int; m int; begin
  select count(*) into n from appointments;
  select count(*) into m from appointments a where a.staff_id = '30000000-0000-0000-0000-000000000001';
  assert n = m and n > 0, 'personel yalnızca kendi randevularını görmeli';
  select count(*) into n from expenses; assert n = 0, 'personel gider görmemeli';
  select count(*) into n from customers c where not exists (select 1 from appointments a where a.customer_id = c.id);
  assert n = 0, 'personel başkasının müşterisini görmemeli';
end $$;
-- Başkasının adına randevu yazamaz
do $$ begin
  insert into appointments (branch_id, date, time, staff_id) values ('20000000-0000-0000-0000-000000000001', current_date, '09:00', '30000000-0000-0000-0000-000000000002');
  raise exception 'başkası adına yazmamalı';
exception when insufficient_privilege then null; end $$;

-- 4) Sahip: kendi işletmesinin her şeyini görür, başka işletmeyi görmez
set test.uid = '00000000-0000-0000-0000-00000000000a';
do $$ declare n int; begin
  select count(*) into n from appointments; assert n = 3, 'sahip tüm randevuları görmeli: ' || n;
  select count(*) into n from expenses; assert n = 1, 'sahip gideri görmeli';
  select count(*) into n from branches; assert n = 1, 'sahip başka işletmenin şubesini görmemeli';
end $$;
set test.uid = '00000000-0000-0000-0000-00000000000d';
do $$ declare n int; begin
  select count(*) into n from appointments; assert n = 0, 'başka işletme sahibi bu randevuları görmemeli';
  select count(*) into n from customers; assert n = 0, 'başka işletme sahibi müşterileri görmemeli';
end $$;
reset role;

-- 5) Abonelik bitince erişim kapanır
update businesses set paid_until = current_date - 1 where id = '10000000-0000-0000-0000-000000000001';
set role authenticated;
set test.uid = '00000000-0000-0000-0000-00000000000a';
do $$ declare n int; begin
  select count(*) into n from appointments; assert n = 0, 'aboneliği biten işletme verisi kapanmalı';
end $$;
reset role;
set role anon;
do $$ begin assert public_branch('lila') is null, 'aboneliği biten şubenin randevu sayfası kapanmalı'; end $$;
reset role;
\echo 'TUM VERITABANI TESTLERI GECTI'

-- 6) Seanslı paket: "Geldi" -> paket açılır, "Geri al" -> silinir
update businesses set paid_until = null;
insert into services (id, branch_id, category, name, duration_min, price, sessions) values
  ('40000000-0000-0000-0000-000000000009', '20000000-0000-0000-0000-000000000001', 'Seanslı Paketler', 'Lazer paketi (6 seans)', 30, 6000, 6);
insert into customers (id, branch_id, name) values ('50000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'Gül');
insert into appointments (id, branch_id, date, time, staff_id, customer_id, service_ids, status) values
  ('60000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', current_date, '15:00',
   '30000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000001', array['40000000-0000-0000-0000-000000000009']::uuid[], 'booked');
update appointments set status = 'done', payment = 'card' where id = '60000000-0000-0000-0000-000000000001';
do $$ declare r session_packages; begin
  select * into r from session_packages where source_appointment_id = '60000000-0000-0000-0000-000000000001';
  assert r.total = 6 and r.remaining = 5, 'paket 5/6 açılmalı';
end $$;
-- Uzman (kendi müşterisi) paketi görür ve seans düşer; diğer uzman göremez; stok göremez
set role authenticated;
set test.uid = '00000000-0000-0000-0000-00000000000b';
update session_packages set remaining = remaining - 1;
do $$ declare n int; begin
  select remaining into n from session_packages; assert n = 4, 'uzman seans düşebilmeli';
  select count(*) into n from stock_items; assert n = 0;
end $$;
set test.uid = '00000000-0000-0000-0000-00000000000c';
do $$ declare n int; begin
  select count(*) into n from session_packages; assert n = 0, 'başka uzman paketi görmemeli';
end $$;
reset role;
update appointments set status = 'booked' where id = '60000000-0000-0000-0000-000000000001';
do $$ begin
  assert not exists (select 1 from session_packages), '"Geri al" paketi silmeli';
end $$;
\echo 'PAKET TESTLERI GECTI'
