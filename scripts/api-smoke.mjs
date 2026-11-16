// Sunucu uçtan uca denemesi (yerel): yetki kuralları, randevu, PIN.
//   npm run preview   (başka bir terminalde; örnek salon yüklenmiş olmalı)
//   node scripts/api-smoke.mjs 111111 222222
// Not: veritabanına deneme kayıtları yazar; yalnızca yerel veritabanında çalıştır.

const BASE = process.env.BASE || 'http://localhost:8788'
const [ownerPin, managerPin] = process.argv.slice(2)
let fails = 0
const ok = (cond, msg) => {
  console.log((cond ? '  ✓ ' : '  ✗ ') + msg)
  if (!cond) fails++
}
async function call(path, { body, token } = {}) {
  const res = await fetch(BASE + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: 'Bearer ' + token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { status: res.status, ...(await res.json()) }
}

const idx = await call('/api/public')
const slug = idx.branches[0].slug
const pub = await call(`/api/public/b/${slug}`)
const staff = pub.rows.filter((r) => r.kind === 'staff').map((r) => r.data)
const experts = staff.filter((s) => s.role === 'expert')
const service = pub.rows.find((r) => r.kind === 'service').data
ok(!JSON.stringify(pub).includes('$'), 'herkese açık veride PIN özeti yok')
ok(!pub.rows.some((r) => r.kind === 'customer' || r.kind === 'appointment'), 'herkese açık veride müşteri/randevu yok')

const d = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10)
const time = '11:00'
const bk = await call(`/api/public/b/${slug}/book`, {
  body: { staffId: experts[0].id, serviceIds: [service.id], date: d, time, name: 'Deneme Müşteri', phone: '0532 000 00 01' },
})
ok(bk.ok && bk.token, 'müşteri randevu talebi alındı')
const bk2 = await call(`/api/public/b/${slug}/book`, {
  body: { staffId: experts[0].id, serviceIds: [service.id], date: d, time, name: 'Başka', phone: '0532 000 00 02' },
})
ok(bk2.ok === false && bk2.reason === 'slot_taken', 'aynı saat aynı uzmana ikinci kez verilmedi')
const busy = await call(`/api/public/b/${slug}/busy?date=${d}`)
ok(busy.appointments.length >= 1 && !JSON.stringify(busy).includes('Deneme'), 'dolu saatler müşteri adı olmadan döndü')
const mine = await call(`/api/public/b/${slug}/mine`, { body: { items: [{ id: bk.id, token: bk.token }, { id: bk.id, token: 'x' }] } })
ok(mine.appointments.length === 1, 'Randevularım yalnızca doğru anahtarla görünür')

const bad = await call('/api/login', { body: { scope: 'branch', slug, as: 'manager', pin: '0000' } })
ok(bad.status === 403, 'yanlış yönetici PIN reddedildi')
const mgr = await call('/api/login', { body: { scope: 'branch', slug, as: 'manager', pin: managerPin } })
ok(!!mgr.token, 'yönetici girişi')
const ms = await call('/api/sync', { token: mgr.token })
const appt = ms.rows.find((r) => r.id === bk.id)
ok(appt && appt.data.status === 'pending_approval', 'yönetici online talebi görüyor')
ok(!JSON.stringify(ms).includes('$'), 'senkron verisinde PIN özeti yok')

// Personelin ilk girişi PIN belirler
const e0 = experts[0], e1 = experts[1]
const s1 = await call('/api/login', { body: { scope: 'branch', slug, as: 'staff', staffId: e1.id, pin: '4321' } })
ok(!!s1.token, 'uzman ilk girişte PIN belirledi')
const s1b = await call('/api/login', { body: { scope: 'branch', slug, as: 'staff', staffId: e1.id, pin: '9999' } })
ok(s1b.status === 403, 'uzman yanlış PIN reddedildi')
const es = await call('/api/sync', { token: s1.token })
const other = es.rows.find((r) => r.id === bk.id)
ok(other && other.data.price === 0, 'uzman başkasının randevusunda tutarı görmüyor')

// Uzman başkasının randevusunu değiştiremez, gider ekleyemez
const w1 = await call('/api/write', { token: s1.token, body: { rows: [{ ...other, data: { ...other.data, status: 'cancelled' } }] } })
ok(w1.status === 403, 'uzman başkasının randevusunu değiştiremedi')
const branchId = idx.branches[0].id
const exp = { kind: 'expense', id: 'exp-' + Date.now(), branchId, data: { id: 'exp-' + Date.now(), branchId, date: d, title: 'Kira', amount: 1000 } }
exp.data.id = exp.id
const w2 = await call('/api/write', { token: s1.token, body: { rows: [exp] } })
ok(w2.status === 403, 'uzman gider ekleyemedi')
const w3 = await call('/api/write', { token: mgr.token, body: { rows: [exp] } })
ok(w3.ok, 'yönetici gider ekledi')
const es2 = await call('/api/sync', { token: s1.token })
ok(!es2.rows.some((r) => r.kind === 'expense'), 'uzman giderleri görmüyor')

// Yönetici talebi onaylar; artımlı senkron yalnız değişeni getirir
const since = ms.seq
const w4 = await call('/api/write', { token: mgr.token, body: { rows: [{ ...appt, data: { ...appt.data, status: 'booked' } }] } })
ok(w4.ok, 'yönetici talebi onayladı')
const inc = await call(`/api/sync?since=${since}`, { token: mgr.token })
ok(inc.rows.length >= 1 && inc.rows.length < 10, `artımlı senkron (${inc.rows.length} satır)`)

// Yönetici işletme sahibinin PIN'ini değiştiremez
const biz = ms.rows.find((r) => r.kind === 'business')
await call('/api/write', { token: mgr.token, body: { rows: [{ ...biz, data: { ...biz.data, ownerPin: '5555', feeFirst: 1 } }] } })
const own = await call('/api/login', { body: { scope: 'owner', pin: ownerPin } })
ok(!!own.token, 'sahip PIN değişmedi, sahip girişi')
const os = await call('/api/sync', { token: own.token })
ok(os.rows.find((r) => r.kind === 'business').data.feeFirst !== 1, 'yönetici abonelik ücretini değiştiremedi')

// Uzman kendi randevusunu ekleyebilir, başkası adına ekleyemez
const mk = (sid) => {
  const id = 'ap-' + Math.random().toString(36).slice(2)
  return { kind: 'appointment', id, branchId, data: { id, branchId, date: d, time: '15:00', durationMin: 30, price: 100, serviceIds: [], serviceNames: ['x'], staffId: sid, customerId: null, status: 'booked' } }
}
ok((await call('/api/write', { token: s1.token, body: { rows: [mk(e1.id)] } })).ok, 'uzman kendine randevu ekledi')
ok((await call('/api/write', { token: s1.token, body: { rows: [mk(e0.id)] } })).status === 403, 'uzman başkası adına randevu ekleyemedi')

// PIN: personel PIN'i yönetici/sahip PIN'iyle aynı olamaz; personel kendi PIN'ini değiştirir; yönetici sıfırlar
const asStaff = (sid, pin) => call('/api/login', { body: { scope: 'branch', slug, as: 'staff', staffId: sid, pin } })
ok((await asStaff(e0.id, managerPin)).error === 'pin_taken', 'ilk PIN yönetici PIN’iyle aynı olamadı')
ok((await asStaff(e0.id, ownerPin)).error === 'pin_taken', 'ilk PIN sahip PIN’iyle aynı olamadı')
const p0 = await asStaff(e0.id, '5678')
ok(!!p0.token, 'uzman ilk girişte başka bir PIN belirledi')
const p0b = await asStaff(e0.id, '5678')
const chg = (token, current, next) => call('/api/pin', { token, body: { current, next } })
ok((await chg(p0.token, '0000', '6789')).status === 403, 'PIN değişiminde eski PIN yanlışsa reddedildi')
ok((await chg(p0.token, '5678', managerPin)).error === 'pin_taken', 'yeni PIN yönetici PIN’iyle aynı olamadı')
ok((await chg(p0.token, '5678', '6789')).ok, 'uzman kendi PIN’ini değiştirdi')
ok((await call('/api/sync', { token: p0b.token })).status === 401, 'PIN değişince diğer cihazdaki oturum kapandı')
ok((await call('/api/sync', { token: p0.token })).rows, 'PIN’i değiştiren cihaz açık kaldı')
ok((await asStaff(e0.id, '5678')).status === 403 && !!(await asStaff(e0.id, '6789')).token, 'eski PIN geçmiyor, yenisi geçiyor')
ok((await chg(mgr.token, managerPin, '7777')).status === 403, 'yönetici oturumu personel PIN ucunu kullanamaz')
const ms2 = await call('/api/sync', { token: mgr.token })
const brRow = ms2.rows.find((r) => r.kind === 'branch' && r.id === branchId)
const wb = await call('/api/write', { token: mgr.token, body: { rows: [{ ...brRow, data: { ...brRow.data, managerPin: '6789' } }] } })
ok(wb.error === 'pin_taken', 'yönetici PIN’i bir personelinkiyle aynı yapılamadı')
ok(!!(await call('/api/login', { body: { scope: 'branch', slug, as: 'manager', pin: managerPin } })).token, 'yönetici PIN’i değişmedi')
const e0Row = ms2.rows.find((r) => r.kind === 'staff' && r.id === e0.id)
ok((await call('/api/write', { token: mgr.token, body: { rows: [{ ...e0Row, data: { ...e0Row.data, pin: '' } }] } })).ok, 'yönetici personel PIN’ini sıfırladı')
ok((await call('/api/sync', { token: p0.token })).status === 401, 'sıfırlanınca personelin açık oturumu kapandı')
ok(!!(await asStaff(e0.id, '1357')).token, 'sıfırlanan personel yeni PIN belirledi')

// Müşteri iptali
const c = await call(`/api/public/b/${slug}/cancel`, { body: { id: bk.id, token: bk.token } })
ok(c.ok, 'müşteri randevusunu iptal etti')
const c2 = await call(`/api/public/b/${slug}/cancel`, { body: { id: bk.id, token: 'yanlis' } })
ok(!c2.ok, 'yanlış anahtarla iptal edilemedi')

// Çıkış
await call('/api/logout', { token: s1.token, body: {} })
ok((await call('/api/sync', { token: s1.token })).status === 401, 'çıkıştan sonra oturum kapalı')

// Kaba kuvvet sınırı
let last
for (let i = 0; i < 9; i++) last = await call('/api/login', { body: { scope: 'branch', slug, as: 'staff', staffId: e1.id, pin: '000' + (i % 10) } })
ok(last.status === 429, 'çok fazla yanlış PIN sonrası giriş kilitlendi')

console.log(fails ? `\n${fails} deneme başarısız` : '\nTüm denemeler geçti')
process.exit(fails ? 1 : 0)
