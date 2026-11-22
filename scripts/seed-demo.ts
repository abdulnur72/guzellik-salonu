// Demo güzellik salonunu (çok dükkânlı yapıda ayrı bir salon) yükleyen SQL'i üretir.
// Bütün bilgiler uydurmadır: gerçek kişi, telefon ya da adres yok.
//
//   bun scripts/seed-demo.ts > demo.sql                 (varsayılan kod: guzellik-demo)
//   bun scripts/seed-demo.ts --kod guzellik-demo --yonetici 1234 --personel 5678 > demo.sql
//
// Ne yapar: sahip panelinde dükkân kaydı (Güzellik Salonu, PIN'siz panel açık,
// en az 1 yıl deneme), işletme + "Merkez" şubesi + hizmet listesi, örnek personel,
// müşteri ve randevular, PIN'ler (yönetici, bir personel; sahip PIN'i rastgele,
// yalnızca ekrana yazılır). Kod zaten varsa SQL ilk satırda (plat_shops.kod tekil)
// hata verir ve sonraki satırlar çalışmaz: var olan salona hiçbir şey yazılmaz.
// Yalnızca 0007_coklu_salon.sql uygulanmış veritabanında çalışır.

import { hashPin } from '../server/api'
import { ixOf } from '../server/ixof'
import { newSalonRows, type NewRow } from '../server/salon'
import type { Appointment, Customer, Staff } from '../src/core/types'

const arg = (name: string, def: string) => {
  const i = process.argv.indexOf(name)
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : def
}
const kod = arg('--kod', 'guzellik-demo')
const yonetici = arg('--yonetici', '1234')
const personel = arg('--personel', '5678')
const ad = arg('--ad', 'Demo Güzellik Salonu')
if (!/^[a-z0-9-]{1,60}$/.test(kod) || !/^\d{4,8}$/.test(yonetici) || !/^\d{4,8}$/.test(personel) || yonetici === personel) {
  console.error('Kod küçük harf/rakam/tire olmalı; PIN’ler 4-8 haneli rakam ve birbirinden farklı olmalı.')
  process.exit(1)
}

const trToday = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const addDays = (d: string, n: number) => {
  const x = new Date(d + 'T12:00:00Z')
  x.setUTCDate(x.getUTCDate() + n)
  return x.toISOString().slice(0, 10)
}
// En az 1 yıl deneme (bugünden 1 yıl + 1 gün)
const bitis = addDays(trToday, 366)

const salon = newSalonRows({ ad, kod })
const { biz, branchId } = salon
const branch = salon.rows.find((r) => r.kind === 'branch')!
branch.data.address = 'Örnek Mah. Demo Sok. No: 1'
branch.data.hours = 'Pazartesi–Cumartesi 09:00–20:00 (demo)'
const services = salon.rows.filter((r) => r.kind === 'service' && !r.data.hiddenFromCustomers && !r.data.sessions)
const svc = (i: number) => services[(i * 7) % services.length].data as { id: string; name: string; durationMin: number; price: number }

const uuid = () => crypto.randomUUID()
// Ad alanına yalnızca kişinin adı yazılır; unvan (Uzman/Resepsiyon) role alanındadır.
// Personel seçim kutucuğu dar olduğu için "Uzman Ayşe" gibi uzun ad "Uzman…" diye kesiliyordu.
const staff: Staff[] = [
  { id: uuid(), branchId, name: 'Ayşe', role: 'expert', commissionPct: 40, active: true, pin: '•' },
  { id: uuid(), branchId, name: 'Zeynep', role: 'expert', commissionPct: 35, active: true },
  { id: uuid(), branchId, name: 'Elif', role: 'expert', commissionPct: 40, active: true },
  { id: uuid(), branchId, name: 'Ece', role: 'reception', commissionPct: 0, active: true },
]
const experts = staff.filter((s) => s.role === 'expert')
const customers: Customer[] = Array.from({ length: 8 }, (_, i) => ({
  id: uuid(),
  branchId,
  name: `Örnek Müşteri ${i + 1}`,
  phone: `0500 000 00 ${String(i + 1).padStart(2, '0')}`,
}))

// Geçmiş günlerde gelmiş (ciro görünsün), bugün ve sonraki günlerde bekleyen randevular
const plan: [number, string, Appointment['status']][] = [
  [-3, '10:00', 'done'], [-3, '14:30', 'done'], [-2, '11:00', 'done'], [-2, '16:00', 'no_show'],
  [-1, '09:30', 'done'], [-1, '13:00', 'done'], [0, '10:30', 'booked'], [0, '15:00', 'booked'],
  [1, '11:00', 'booked'], [1, '17:00', 'pending_approval'], [2, '12:00', 'booked'], [3, '10:00', 'booked'],
  [4, '14:00', 'pending_approval'], [5, '16:30', 'booked'],
]
const appointments: Appointment[] = plan.map(([day, time, status], i) => {
  const s = svc(i)
  return {
    id: uuid(),
    branchId,
    date: addDays(trToday, day),
    time,
    durationMin: s.durationMin,
    price: s.price,
    serviceIds: [s.id],
    serviceNames: [s.name],
    staffId: experts[i % experts.length].id,
    customerId: customers[i % customers.length].id,
    status,
    ...(status === 'done' ? { payment: i % 2 ? 'card' : 'cash' } : {}),
  } as Appointment
})

const rows: NewRow[] = [
  ...salon.rows,
  ...[...staff, ...customers, ...appointments].map((x) => {
    const kind = 'role' in x ? 'staff' : 'phone' in x ? 'customer' : 'appointment'
    return { kind, id: x.id, branchId, ix: ixOf(kind, x as never), data: x as unknown as Record<string, unknown> } as NewRow
  }),
]

const q = (v: unknown) => (v === null || v === undefined ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`)
const ownerPin = String(10_000_000 + Math.floor(Math.random() * 89_999_999))
const shop = { id: kod, ad, sektor: 'Güzellik Salonu', tel: '', paket: 'p1', deneme: true, bitis, dur: false, not: 'Demo dükkân (örnek veri)', isl: '', kod, acik: true }

const out: string[] = [
  '-- Demo güzellik salonu: ' + ad + ' (/s/' + kod + ', /r/' + kod + '), deneme bitişi ' + bitis,
  // Kod varsa burada hata verir; sonraki satırlar çalışmaz
  `INSERT INTO plat_shops (id, kod, data) VALUES (${q(shop.id)}, ${q(kod)}, ${q(JSON.stringify(shop))});`,
  "UPDATE meta SET v = v + 1 WHERE k = 'seq';",
  ...rows.map(
    (r) =>
      `INSERT INTO rows (kind, id, branch_id, ix, data, seq, deleted, biz) VALUES (${q(r.kind)}, ${q(r.id)}, ${q(r.branchId)}, ${q(r.ix)}, ${q(JSON.stringify(r.data))}, (SELECT v FROM meta WHERE k = 'seq'), 0, ${q(biz)});`,
  ),
  `INSERT INTO secrets (key, hash) VALUES (${q('owner:' + biz)}, ${q(await hashPin(ownerPin))});`,
  `INSERT INTO secrets (key, hash) VALUES (${q('manager:' + branchId)}, ${q(await hashPin(yonetici))});`,
  `INSERT INTO secrets (key, hash) VALUES (${q('staff:' + staff[0].id)}, ${q(await hashPin(personel))});`,
]
console.log(out.join('\n'))
console.error(`Demo SQL hazır: kod ${kod}, yönetici PIN ${yonetici}, ${staff[0].name} PIN ${personel}, bitiş ${bitis}.`)
console.error(`Sahip PIN'i (rastgele, kayıtlı değil; gerekirse sahip panelinden yenisi verilir): ${ownerPin}`)
