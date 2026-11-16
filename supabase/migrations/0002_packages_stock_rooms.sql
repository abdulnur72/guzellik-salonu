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
