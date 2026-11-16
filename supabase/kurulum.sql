-- Supabase SQL Editor'e tek seferde yapıştırılacak dosya.
-- supabase/migrations klasöründeki dosyaların birleşimidir (scripts/kurulum-sql.sh ile üretilir).

-- ===== supabase/migrations/0001_init.sql =====
-- Güzellik Salonu — ilk veritabanı şeması (Supabase / PostgreSQL)
--
-- Yapı: işletme (business) > şube (branch) > personel, hizmet, müşteri,
-- randevu, gider. Her işletmenin verisi satır seviyesinde güvenlik (RLS)
-- ile birbirinden ayrılır: bir kullanıcı yalnızca üyesi olduğu işletmenin /
-- şubenin kayıtlarını görür.
--
-- Roller (memberships.role):
--   owner     işletme sahibi: tüm şubeler, ciro, abonelik
--   manager   şube yöneticisi: kendi şubesinin her şeyi
--   reception resepsiyon: randevu ve müşteri; ciro/gider/prim göremez
--   staff     uzman: yalnızca kendi randevuları, müşterileri ve kazancı
--
-- Müşteri (randevu alan kişi) hesap açmaz. Randevu sayfası yalnızca
-- aşağıdaki "public_*" ve "book_appointment" fonksiyonlarını çağırabilir.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Tablolar
-- ---------------------------------------------------------------------------

create table businesses (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  owner_name    text not null default '',
  sector        text not null default 'guzellik' check (sector in ('guzellik','kuafor','berber','spor')),
  country       text not null default 'TR',
  currency      text not null default 'TRY',
  locale        text not null default 'tr-TR',
  time_zone     text not null default 'Europe/Istanbul',
  -- Abonelik: ödeme gelmezse erişim kapanır (bkz. business_active)
  fee_first     numeric(10,2) not null default 500,
  fee_extra     numeric(10,2) not null default 250,
  paid_until    date,
  created_at    timestamptz not null default now()
);

create table branches (
  id               uuid primary key default gen_random_uuid(),
  business_id      uuid not null references businesses(id) on delete cascade,
  name             text not null,
  slug             text not null unique check (slug ~ '^[a-z0-9-]{2,60}$'),
  address          text not null default '',
  phone            text not null default '',
  hours            text not null default '',
  day_cutoff_hour  smallint not null default 4 check (day_cutoff_hour between 0 and 23),
  open_min         smallint not null default 540,
  close_min        smallint not null default 1200,
  logo_url         text,
  created_at       timestamptz not null default now()
);
create index on branches (business_id);

create table staff (
  id              uuid primary key default gen_random_uuid(),
  branch_id       uuid not null references branches(id) on delete cascade,
  name            text not null,
  role            text not null default 'expert' check (role in ('expert','reception')),
  commission_pct  numeric(5,2) not null default 0 check (commission_pct between 0 and 100),
  photo_url       text,
  active          boolean not null default true,
  created_at      timestamptz not null default now()
);
create index on staff (branch_id);

-- Bir giriş hesabının (auth.users) hangi işletme/şubede hangi rolde olduğu
create table memberships (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  business_id  uuid not null references businesses(id) on delete cascade,
  branch_id    uuid references branches(id) on delete cascade, -- owner için boş
  role         text not null check (role in ('owner','manager','reception','staff')),
  staff_id     uuid references staff(id) on delete set null,   -- staff/reception için
  created_at   timestamptz not null default now(),
  check (role = 'owner' or branch_id is not null),
  unique (user_id, business_id, branch_id)
);
create index on memberships (user_id);

create table services (
  id                    uuid primary key default gen_random_uuid(),
  branch_id             uuid not null references branches(id) on delete cascade,
  category              text not null,
  name                  text not null,
  duration_min          smallint not null default 30 check (duration_min >= 0),
  price                 numeric(10,2) not null default 0 check (price >= 0),
  sessions              smallint,
  hidden_from_customers boolean not null default false,
  sort                  integer not null default 0
);
create index on services (branch_id);

create table customers (
  id            uuid primary key default gen_random_uuid(),
  branch_id     uuid not null references branches(id) on delete cascade,
  name          text not null,
  phone         text not null default '',
  birthday      date,
  note          text,
  allergy_note  text, -- özel nitelikli veri: yalnızca açık rıza ile
  created_at    timestamptz not null default now()
);
create index on customers (branch_id);
create index on customers (branch_id, phone);

create table appointments (
  id                     uuid primary key default gen_random_uuid(),
  branch_id              uuid not null references branches(id) on delete cascade,
  date                   date not null,
  time                   time not null,
  duration_min           smallint not null default 30,
  price                  numeric(10,2) not null default 0,
  service_ids            uuid[] not null default '{}',
  service_names          text[] not null default '{}',
  staff_id               uuid not null references staff(id),
  customer_id            uuid references customers(id) on delete set null,
  status                 text not null default 'booked'
                         check (status in ('pending_approval','booked','done','no_show','cancelled')),
  payment                text check (payment in ('cash','card')),
  room                   text,
  note                   text,
  walk_in                boolean not null default false,
  online                 boolean not null default false,
  cancelled_by_customer  boolean not null default false,
  -- Müşterinin kendi randevusunu iptal edebilmesi için gizli anahtar
  customer_token         uuid not null default gen_random_uuid(),
  created_at             timestamptz not null default now()
);
create index on appointments (branch_id, date);
create index on appointments (staff_id, date);

create table expenses (
  id         uuid primary key default gen_random_uuid(),
  branch_id  uuid not null references branches(id) on delete cascade,
  date       date not null,
  title      text not null,
  amount     numeric(10,2) not null check (amount >= 0),
  created_at timestamptz not null default now()
);
create index on expenses (branch_id, date);

-- ---------------------------------------------------------------------------
-- Yetki yardımcıları (RLS kuralları bunları kullanır)
-- ---------------------------------------------------------------------------

-- Abonelik süresi dolmadıysa (ya da henüz deneme aşamasındaysa) işletme açık
create function business_active(b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select paid_until is null or paid_until >= current_date from businesses where id = b), false)
$$;

create function is_owner(b uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from memberships m
                 where m.user_id = auth.uid() and m.business_id = b and m.role = 'owner')
$$;

-- Kullanıcının bu şubedeki rolü: owner (işletme sahibiyse), manager, reception, staff ya da null
create function branch_role(br uuid) returns text
language sql stable security definer set search_path = public as $$
  select case
    when exists (select 1 from branches x join memberships m on m.business_id = x.business_id
                 where x.id = br and m.user_id = auth.uid() and m.role = 'owner') then 'owner'
    else (select m.role from memberships m where m.branch_id = br and m.user_id = auth.uid() limit 1)
  end
  where business_active((select business_id from branches where id = br))
$$;

create function my_staff_id(br uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select m.staff_id from memberships m where m.branch_id = br and m.user_id = auth.uid() limit 1
$$;

-- Şubenin tüm kayıtlarını yönetebilir mi (sahip ya da şube yöneticisi)
create function can_manage(br uuid) returns boolean
language sql stable as $$ select branch_role(br) in ('owner','manager') $$;

-- Randevu ve müşteri kartlarının hepsini görebilir mi (resepsiyon dahil)
create function sees_all(br uuid) returns boolean
language sql stable as $$ select branch_role(br) in ('owner','manager','reception') $$;

-- ---------------------------------------------------------------------------
-- Satır seviyesinde güvenlik
-- ---------------------------------------------------------------------------

alter table businesses   enable row level security;
alter table branches     enable row level security;
alter table staff        enable row level security;
alter table memberships  enable row level security;
alter table services     enable row level security;
alter table customers    enable row level security;
alter table appointments enable row level security;
alter table expenses     enable row level security;

create policy biz_read on businesses for select
  using (exists (select 1 from memberships m where m.business_id = id and m.user_id = auth.uid()));
create policy biz_owner_update on businesses for update using (is_owner(id)) with check (is_owner(id));

create policy branch_read on branches for select using (branch_role(id) is not null);
create policy branch_owner_insert on branches for insert with check (is_owner(business_id));
create policy branch_manage on branches for update using (can_manage(id)) with check (can_manage(id));

create policy memb_read on memberships for select
  using (user_id = auth.uid() or is_owner(business_id) or (branch_id is not null and can_manage(branch_id)));
create policy memb_manage on memberships for all
  using (is_owner(business_id) or (branch_id is not null and role <> 'owner' and can_manage(branch_id)))
  with check (is_owner(business_id) or (branch_id is not null and role <> 'owner' and can_manage(branch_id)));

-- Personel listesi şubedeki herkese açık (giriş ekranı, randevu personel seçimi)
create policy staff_read on staff for select using (branch_role(branch_id) is not null);
create policy staff_manage on staff for all using (can_manage(branch_id)) with check (can_manage(branch_id));

create policy svc_read on services for select using (branch_role(branch_id) is not null);
create policy svc_manage on services for all using (can_manage(branch_id)) with check (can_manage(branch_id));

-- Uzman yalnızca kendi randevusu olan müşterileri görür
create policy cust_read on customers for select using (
  sees_all(branch_id) or exists (
    select 1 from appointments a where a.customer_id = customers.id and a.staff_id = my_staff_id(branch_id)));
create policy cust_insert on customers for insert with check (branch_role(branch_id) is not null);
create policy cust_update on customers for update using (
  sees_all(branch_id) or exists (
    select 1 from appointments a where a.customer_id = customers.id and a.staff_id = my_staff_id(branch_id)));
create policy cust_delete on customers for delete using (can_manage(branch_id));

create policy appt_read on appointments for select
  using (sees_all(branch_id) or staff_id = my_staff_id(branch_id));
create policy appt_insert on appointments for insert
  with check (sees_all(branch_id) or staff_id = my_staff_id(branch_id));
create policy appt_update on appointments for update
  using (sees_all(branch_id) or staff_id = my_staff_id(branch_id))
  with check (sees_all(branch_id) or staff_id = my_staff_id(branch_id));
-- Uzman yalnızca kendi girdiği randevusuz kaydı silebilir
create policy appt_delete on appointments for delete
  using (can_manage(branch_id) or (walk_in and staff_id = my_staff_id(branch_id)));

-- Gider yalnızca sahip ve yöneticiye açık
create policy exp_all on expenses for all using (can_manage(branch_id)) with check (can_manage(branch_id));

-- Not: Resepsiyonun ciro/prim görmemesi ekranda sağlanır; randevu satırında
-- fiyat bulunduğu için ileride resepsiyona fiyatsız bir görünüm (view) verilecek.

-- ---------------------------------------------------------------------------
-- Müşteri randevu sayfası (giriş yapmadan çağrılır)
-- ---------------------------------------------------------------------------

-- Şube bilgisi, müşteriye açık hizmetler ve randevu alan personel
create function public_branch(p_slug text) returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'branch', json_build_object('id', b.id, 'name', b.name, 'slug', b.slug, 'address', b.address,
      'phone', b.phone, 'hours', b.hours, 'dayCutoffHour', b.day_cutoff_hour,
      'openMin', b.open_min, 'closeMin', b.close_min, 'logo', b.logo_url),
    'business', json_build_object('name', z.name, 'sector', z.sector, 'currency', z.currency,
      'locale', z.locale, 'timeZone', z.time_zone),
    'services', coalesce((select json_agg(json_build_object('id', s.id, 'category', s.category,
      'name', s.name, 'durationMin', s.duration_min, 'price', s.price, 'sessions', s.sessions) order by s.sort, s.category, s.name)
      from services s where s.branch_id = b.id and not s.hidden_from_customers), '[]'),
    'staff', coalesce((select json_agg(json_build_object('id', st.id, 'name', st.name, 'photo', st.photo_url) order by st.name)
      from staff st where st.branch_id = b.id and st.active and st.role = 'expert'), '[]'))
  from branches b join businesses z on z.id = b.business_id
  where b.slug = p_slug and business_active(z.id)
$$;

-- Bir günün dolu saatleri (kimin olduğu ve müşteri bilgisi verilmez)
create function public_busy(p_slug text, p_date date) returns table (staff_id uuid, start_min int, duration_min int, room text)
language sql stable security definer set search_path = public as $$
  select a.staff_id, (extract(hour from a.time) * 60 + extract(minute from a.time))::int, greatest(a.duration_min, 30), a.room
  from appointments a join branches b on b.id = a.branch_id
  where b.slug = p_slug and a.date = p_date and not a.walk_in and a.status not in ('cancelled','no_show')
$$;

-- Online randevu talebi. Personel boşsa (p_staff null) o saatte boş olan ilk uzman atanır.
-- Dönen değer: randevu id'si ve müşterinin iptal için sakladığı anahtar.
create function book_appointment(
  p_slug text, p_staff uuid, p_service_ids uuid[], p_date date, p_time time,
  p_name text, p_phone text, p_note text default null
) returns table (appointment_id uuid, customer_token uuid)
language plpgsql security definer set search_path = public as $$
declare
  v_branch branches;
  v_dur int; v_price numeric; v_names text[]; v_ids uuid[];
  v_staff uuid; v_cust uuid; v_start int; v_now timestamptz := now(); v_tz text;
begin
  select * into v_branch from branches where slug = p_slug;
  if v_branch.id is null or not business_active(v_branch.business_id) then raise exception 'branch_not_found'; end if;
  if coalesce(trim(p_name), '') = '' or regexp_replace(coalesce(p_phone, ''), '\D', '', 'g') !~ '^(0?5\d{9}|905\d{9})$' then
    raise exception 'invalid_contact';
  end if;
  select time_zone into v_tz from businesses where id = v_branch.business_id;
  if p_date < (v_now at time zone v_tz)::date or (p_date = (v_now at time zone v_tz)::date and p_time <= (v_now at time zone v_tz)::time) then
    raise exception 'past_time';
  end if;

  select coalesce(sum(duration_min), 0), coalesce(sum(price), 0), array_agg(name order by name), array_agg(id order by name)
    into v_dur, v_price, v_names, v_ids
  from services where branch_id = v_branch.id and id = any(p_service_ids) and not hidden_from_customers;
  if v_ids is null then raise exception 'no_service'; end if;
  v_dur := greatest(v_dur, 30);
  v_start := extract(hour from p_time) * 60 + extract(minute from p_time);
  if v_start < v_branch.open_min or v_start + v_dur > v_branch.close_min then raise exception 'outside_hours'; end if;

  -- Aynı anda iki kişi aynı saati almasın
  perform pg_advisory_xact_lock(hashtext(v_branch.id::text || p_date::text));

  select s.id into v_staff from staff s
  where s.branch_id = v_branch.id and s.active and s.role = 'expert'
    and (p_staff is null or s.id = p_staff)
    and not exists (
      select 1 from appointments a
      where a.staff_id = s.id and a.date = p_date and not a.walk_in and a.status not in ('cancelled','no_show')
        and v_start < (extract(hour from a.time) * 60 + extract(minute from a.time)) + greatest(a.duration_min, 30)
        and (extract(hour from a.time) * 60 + extract(minute from a.time)) < v_start + v_dur)
  order by s.name limit 1;
  if v_staff is null then raise exception 'slot_taken'; end if;

  select id into v_cust from customers
  where branch_id = v_branch.id and regexp_replace(phone, '\D', '', 'g') = regexp_replace(p_phone, '\D', '', 'g') limit 1;
  if v_cust is null then
    insert into customers (branch_id, name, phone) values (v_branch.id, trim(p_name), trim(p_phone)) returning id into v_cust;
  end if;

  return query
  insert into appointments (branch_id, date, time, duration_min, price, service_ids, service_names, staff_id,
                            customer_id, status, note, online)
  values (v_branch.id, p_date, p_time, v_dur, v_price, v_ids, v_names, v_staff, v_cust, 'pending_approval',
          nullif(trim(p_note), ''), true)
  returning id, appointments.customer_token;
end $$;

-- Müşterinin kendi randevusunu iptal etmesi (anahtar ile)
create function cancel_my_appointment(p_id uuid, p_token uuid) returns boolean
language sql security definer set search_path = public as $$
  with u as (
    update appointments set status = 'cancelled', cancelled_by_customer = true
    where id = p_id and customer_token = p_token and status in ('pending_approval','booked')
    returning 1)
  select exists (select 1 from u)
$$;

-- Müşterinin cihazında sakladığı randevuların güncel durumu
create function my_appointments(p_ids uuid[], p_tokens uuid[]) returns table (
  id uuid, date date, "time" time, service_names text[], status text)
language sql stable security definer set search_path = public as $$
  select a.id, a.date, a.time, a.service_names, a.status
  from appointments a
  join unnest(p_ids, p_tokens) as k(id, token) on k.id = a.id and k.token = a.customer_token
$$;

revoke all on function public_branch(text), public_busy(text, date),
  book_appointment(text, uuid, uuid[], date, time, text, text, text),
  cancel_my_appointment(uuid, uuid), my_appointments(uuid[], uuid[]) from public;
grant execute on function public_branch(text), public_busy(text, date),
  book_appointment(text, uuid, uuid[], date, time, text, text, text),
  cancel_my_appointment(uuid, uuid), my_appointments(uuid[], uuid[]) to anon, authenticated;

-- ===== supabase/migrations/0002_packages_stock_rooms.sql =====
-- Seanslı paketler, stok ve oda/cihaz listesi.

alter table branches add column rooms text[] not null
  default array['Oda 1','Oda 2','Lazer cihazı','Cilt bakım odası','Makyaj köşesi'];

create table session_packages (
  id                     uuid primary key default gen_random_uuid(),
  branch_id              uuid not null references branches(id) on delete cascade,
  customer_id            uuid not null references customers(id) on delete cascade,
  service_name           text not null,
  total                  smallint not null check (total > 0),
  remaining              smallint not null check (remaining >= 0 and remaining <= total),
  staff_id               uuid references staff(id) on delete set null,
  date                   date not null,
  source_appointment_id  uuid references appointments(id) on delete cascade,
  created_at             timestamptz not null default now()
);
create index on session_packages (branch_id, customer_id);
create unique index on session_packages (source_appointment_id, service_name);

create table stock_items (
  id         uuid primary key default gen_random_uuid(),
  branch_id  uuid not null references branches(id) on delete cascade,
  name       text not null,
  qty        integer not null default 0 check (qty >= 0),
  min_qty    integer not null default 0 check (min_qty >= 0)
);
create index on stock_items (branch_id);

alter table session_packages enable row level security;
alter table stock_items enable row level security;

-- Paket: yönetici/resepsiyon hepsini, uzman kendi müşterisininkini görür ve seans düşer
create policy pkg_read on session_packages for select using (
  sees_all(branch_id) or exists (
    select 1 from appointments a where a.customer_id = session_packages.customer_id and a.staff_id = my_staff_id(branch_id)));
create policy pkg_update on session_packages for update using (
  sees_all(branch_id) or exists (
    select 1 from appointments a where a.customer_id = session_packages.customer_id and a.staff_id = my_staff_id(branch_id)))
  with check (branch_role(branch_id) is not null);
create policy pkg_manage on session_packages for delete using (can_manage(branch_id));

-- Stok yalnızca sahip ve yöneticiye açık
create policy stock_all on stock_items for all using (can_manage(branch_id)) with check (can_manage(branch_id));

-- Randevu "Geldi" olunca paket açılır (ilk seans düşülmüş), başka duruma dönünce silinir.
-- Kim işaretlerse işaretlesin aynı kural çalışsın diye veritabanında.
create function sync_packages() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'done' and new.customer_id is not null then
    insert into session_packages (branch_id, customer_id, service_name, total, remaining, staff_id, date, source_appointment_id)
    select new.branch_id, new.customer_id, s.name, s.sessions, s.sessions - 1, new.staff_id, new.date, new.id
    from services s where s.id = any(new.service_ids) and s.sessions > 0
    on conflict (source_appointment_id, service_name) do nothing;
  elsif tg_op = 'UPDATE' and old.status = 'done' then
    delete from session_packages where source_appointment_id = new.id;
  end if;
  return new;
end $$;

create trigger appointments_sync_packages
  after insert or update of status on appointments
  for each row execute function sync_packages();

-- Müşteri sayfası oda listesine ihtiyaç duymaz; randevu sayfası değişmedi.
