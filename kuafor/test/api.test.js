import { test, expect, beforeEach } from 'bun:test'
import { makeDB } from './d1.js'
import { makeWorker, hashPin, isGunu, slotlar, normShop, addDay, VARSAYILAN_HIZMET, musaitMi } from '../src/server.js'

const W = makeWorker('<html><script>/*__BOOT__*/</script>app</html>')
let env
const KOD = 'selin-kuafor'
const YARIN = () => addDay(isGunu().gun, 1)
async function setup({ bitis, dur = false, shop = {} } = {}) {
  env = { DB: makeDB() }
  const db = env.DB.raw
  const plat = { id: 'selin-kuafor', ad: 'Selin Kuaför', sektor: 'Bayan Kuaför', tel: '', paket: 'p1', deneme: true, bitis: bitis || '2099-01-01', dur, not: '', isl: '', kod: KOD }
  db.query('UPDATE plat_shops SET data = ? WHERE kod = ?').run(JSON.stringify(plat), KOD)
  const data = { ad: 'Selin Kuaför', wa: '05321112233', acilis: '09:00', kapanis: '20:00', aralik: 30, personel: [{ id: 'ayse', ad: 'Ayşe', prim: 40, aktif: true }, { id: 'elif', ad: 'Elif', prim: 50, aktif: true }], ...shop }
  db.query('UPDATE kuafor_shops SET data = ? WHERE kod = ?').run(JSON.stringify(data), KOD)
  db.query('INSERT INTO secrets (key, hash) VALUES (?, ?)').run('kuafor:yon:' + KOD, await hashPin('1111'))
  db.query('INSERT INTO secrets (key, hash) VALUES (?, ?)').run('kuafor:per:' + KOD + ':ayse', await hashPin('2222'))
  db.query('INSERT INTO secrets (key, hash) VALUES (?, ?)').run('kuafor:per:' + KOD + ':elif', await hashPin('3333'))
}
let ipn = 0
const req = (path, body, tok, ip) =>
  W.fetch(new Request('https://x.dev' + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip || '10.0.0.' + (ipn++ % 250), ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }), env)
const J = async (r) => ({ s: r.status, d: await r.json() })
const login = async (pin, rol) => (await J(await req(`/api/s/${KOD}/login`, { pin, rol }))).d
const st = async (tok) => (await J(await req(`/api/s/${KOD}/state`, undefined, tok))).d
const act = async (a, b, tok) => J(await req(`/api/s/${KOD}/${a}`, b, tok))
const al = async (b) => J(await req(`/api/r/${KOD}/al`, b))
const bos = async (gun, per = '', sure = 30) => (await J(await req(`/api/r/${KOD}/bos?gun=${gun}&per=${per}&sure=${sure}`))).d.slotlar

beforeEach(() => setup())

test('migration: Selin Kuaför 30 gün denemeyle, sektörü Bayan Kuaför', async () => {
  const e = { DB: makeDB() }
  const p = JSON.parse(e.DB.raw.query("SELECT data FROM plat_shops WHERE kod = 'selin-kuafor'").get().data)
  expect(p.sektor).toBe('Bayan Kuaför')
  expect(p.deneme).toBe(true)
  const gun = Math.round((new Date(p.bitis) - new Date(new Date().toISOString().slice(0, 10))) / 86400000)
  expect(gun).toBe(30)
  expect(e.DB.raw.query("SELECT isl FROM kuafor_shops WHERE kod = 'selin-kuafor'").get().isl).toBe('selin-kuafor')
})

test('varsayılan hizmet listesi: 64 hizmet, kategorili, benzersiz, boya hatırlatmalı', () => {
  expect(VARSAYILAN_HIZMET.length).toBe(64)
  expect(new Set(VARSAYILAN_HIZMET.map((h) => h.ad)).size).toBe(64)
  expect(new Set(VARSAYILAN_HIZMET.map((h) => h.kat)).size).toBe(7)
  for (const h of VARSAYILAN_HIZMET) expect(h.fiyat > 0 && h.sure >= 5 && h.ad.length <= 40).toBe(true)
  expect(VARSAYILAN_HIZMET.find((h) => h.ad === 'Dip boya').hat).toBe(35)
  expect(VARSAYILAN_HIZMET.filter((h) => h.hat).every((h) => h.kat === 'Boya & Renk')).toBe(true)
})

test('müşteri sayfası tek istekte açılır (bilgi gömülü), panel bilgisi görünmez', async () => {
  const r = await req(`/r/${KOD}`)
  const html = await r.text()
  expect(html).toContain('var BOOT=')
  expect(html).toContain('Selin Kuaf')
  const i = (await J(await req(`/api/r/${KOD}/info`))).d
  expect(i.hizmetler.length).toBe(64)
  expect(i.hizmetler[0]).toEqual({ ad: 'Kadın saç kesimi', kat: 'Kesim & Fön', fiyat: 500, sure: 45 })
  expect(JSON.stringify(i)).not.toContain('prim')
  expect(i.personel).toEqual([{ id: 'ayse', ad: 'Ayşe' }, { id: 'elif', ad: 'Elif' }])
})

test('müşteri: geçmiş tarih, telefon kontrolü, hizmetsiz randevu reddedilir', async () => {
  const dun = addDay(isGunu().gun, -1)
  expect((await al({ ad: 'Ayşe', tel: '05551112233', gun: dun, saat: '10:00', hz: ['Fön (uzun saç)'] })).d.error).toBe('past_date')
  expect((await al({ ad: 'Ayşe', tel: '12345', gun: YARIN(), saat: '10:00', hz: ['Fön (uzun saç)'] })).d.error).toBe('bad_phone')
  expect((await al({ ad: 'Ayşe', tel: '05551112233', gun: YARIN(), saat: '10:00', hz: [] })).d.error).toBe('no_service')
  expect((await al({ ad: 'Ayşe', tel: '05551112233', gun: YARIN(), saat: '10:07', hz: ['Yıkama'] })).d.error).toBe('bad_time')
  expect((await al({ ad: 'Ayşe', tel: '05551112233', gun: addDay(isGunu().gun, 40), saat: '10:00', hz: ['Yıkama'] })).d.error).toBe('too_far')
})

test('müşteri: çoklu hizmet toplam fiyat ve süre; Randevularım ve iptal', async () => {
  const r = await al({ ad: 'Zehra', tel: '0555 111 22 33', gun: YARIN(), saat: '10:00', hz: ['Dip boya', 'Fön (uzun saç)', 'Kaş alma'], per: 'ayse', not: 'uzun saç' })
  expect(r.s).toBe(200)
  expect(r.d).toMatchObject({ saat: '10:00', fiyat: 800 + 350 + 150, sure: 90 + 40 + 15, per: 'Ayşe', hz: ['Dip boya', 'Fön (uzun saç)', 'Kaş alma'] })
  const b = (await J(await req(`/api/r/${KOD}/benim`, { tel: '+90 555 111 22 33' }))).d.list
  expect(b.length).toBe(1)
  expect(b[0]).toMatchObject({ saat: '10:00', per: 'Ayşe', durum: 'bekliyor' })
  expect((await J(await req(`/api/r/${KOD}/iptal`, { id: r.d.id, key: 'yanlis' }))).s).toBe(403)
  expect((await J(await req(`/api/r/${KOD}/iptal`, { id: r.d.id, key: r.d.key }))).d.ok).toBe(true)
  expect((await J(await req(`/api/r/${KOD}/benim`, { tel: '05551112233' }))).d.list.length).toBe(0)
})

test('süreye göre çakışma: uzun işlem uzmanın sonraki saatlerini kapatır', async () => {
  const g = YARIN()
  // Ayşe 10:00'da 145 dakikalık işte (12:25'e kadar)
  await al({ ad: 'Zehra', tel: '05551112233', gun: g, saat: '10:00', hz: ['Dip boya', 'Fön (uzun saç)', 'Kaş alma'], per: 'ayse' })
  const s = (list, saat) => list.find((x) => x.s === saat).ok
  const ayse = await bos(g, 'ayse', 30)
  expect(s(ayse, '09:30')).toBe(true)
  expect(s(ayse, '10:00')).toBe(false)
  expect(s(ayse, '12:00')).toBe(false)
  expect(s(ayse, '12:30')).toBe(true)
  // 09:00'dan 90 dk'lık iş Ayşe'nin 10:00 randevusuna çarpar
  expect(s(await bos(g, 'ayse', 90), '09:00')).toBe(false)
  expect(s(await bos(g, 'ayse', 60), '09:00')).toBe(true)
  // Elif boş: "fark etmez" 10:30 açık
  expect(s(await bos(g, '', 30), '10:30')).toBe(true)
  await al({ ad: 'Sena', tel: '05551112234', gun: g, saat: '10:30', hz: ['Yıkama'] })
  // İki uzman da dolu (biri sahipsiz randevuyla)
  expect(s(await bos(g, '', 30), '10:30')).toBe(false)
  expect((await al({ ad: 'Deniz', tel: '05551112235', gun: g, saat: '10:30', hz: ['Yıkama'], per: 'elif' })).d.error).toBe('slot_taken')
  // Kapanışa sığmayan iş: 19:30 + 90 dk > 20:00
  expect(s(await bos(g, '', 90), '19:30')).toBe(false)
  expect((await al({ ad: 'Deniz', tel: '05551112235', gun: g, saat: '19:30', hz: ['Dip boya'] })).d.error).toBe('slot_taken')
})

test('musaitMi: personel yokken tek koltuk gibi davranır', () => {
  const shop = normShop({})
  expect(musaitMi(shop, [], '', 180, 60)).toBe(true)
  expect(musaitMi(shop, [{ id: 'a', saat: '09:00', sure: 60, durum: 'bekliyor' }], '', 180, 60)).toBe(false)
  expect(musaitMi(shop, [{ id: 'a', saat: '09:00', sure: 60, durum: 'iptal' }], '', 180, 60)).toBe(true)
})

test('personel yalnızca kendi müşterisini ve payını görür; ciro, gider ve başkasının primi gizli', async () => {
  const y = await login('1111')
  expect(y.rol).toBe('yon')
  const a = await login('2222')
  expect(a).toMatchObject({ rol: 'per', per: 'ayse' })
  const g = YARIN()
  await al({ ad: 'Ayşe müşteri', tel: '05551112233', gun: g, saat: '10:00', hz: ['Yıkama'], per: 'ayse' })
  await al({ ad: 'Elif müşteri', tel: '05551112234', gun: g, saat: '11:00', hz: ['Yıkama'], per: 'elif' })
  await al({ ad: 'Sahipsiz', tel: '05551112235', gun: g, saat: '12:00', hz: ['Yıkama'] })
  await act('kayit', { per: 'elif', hz: ['Manikür'], od: 'nakit' }, y.token)
  await act('gider', { tur: 'Kira', tutar: 5000 }, y.token)
  const s = await st(a.token)
  expect(s.randevular.map((r) => r.ad).sort()).toEqual(['Ayşe müşteri', 'Sahipsiz'])
  expect(s.kayitlar.length).toBe(0)
  expect(s.giderler).toBeUndefined()
  expect(s.abonelik).toBeUndefined()
  expect(s.shop.personel.find((p) => p.id === 'elif').prim).toBeUndefined()
  expect(s.shop.personel.find((p) => p.id === 'ayse').prim).toBe(40)
  // Personel başkasının müşterisine dokunamaz, gider ekleyemez, ayar değiştiremez
  const elifR = (await st(y.token)).randevular.find((r) => r.ad === 'Elif müşteri')
  expect((await act('geldi', { id: elifR.id, od: 'nakit' }, a.token)).d.error).toBe('not_yours')
  expect((await act('gider', { tur: 'Kira', tutar: 1 }, a.token)).d.error).toBe('yonetici')
  expect((await act('ayar', { ad: 'X' }, a.token)).d.error).toBe('yonetici')
  expect((await act('personel', { ad: 'X', pin: '9999' }, a.token)).d.error).toBe('yonetici')
  // Personelin kaydı kendisine yazılır, per gönderse de
  const k = await act('kayit', { per: 'elif', hz: ['Kaş alma', 'Bıyık alma'], od: 'kart' }, a.token)
  expect(k.d.kayitlar.length).toBe(1)
  expect(k.d.kayitlar[0]).toMatchObject({ per: 'ayse', hz: 'Kaş alma + Bıyık alma', tutar: 250, od: 'kart', prim: 40 })
})

test('personel PIN yönetici PIN’inden ve diğer personelden farklı olmalı', async () => {
  const y = await login('1111')
  expect((await act('personel', { ad: 'Merve', pin: '1111' }, y.token)).d.error).toBe('same_pin_yon')
  expect((await act('personel', { ad: 'Merve', pin: '2222' }, y.token)).d.error).toBe('same_pin_other')
  const a = await login('2222')
  expect((await act('perpin', { pin: '1111' }, a.token)).d.error).toBe('same_pin_yon')
  expect((await act('perpin', { pin: '3333' }, a.token)).d.error).toBe('same_pin_other')
  expect((await act('perpin', { pin: '4444' }, a.token)).s).toBe(200)
  expect((await login('4444')).per).toBe('ayse')
  expect((await act('pin', { pin: '3333' }, y.token)).d.error).toBe('same_pin_per')
})

test('prim kişiye göre; yeni personel varsayılan %40', async () => {
  const y = await login('1111')
  let s = (await act('personel', { ad: 'Merve', pin: '5555' }, y.token)).d
  const m = s.shop.personel.find((p) => p.ad === 'Merve')
  expect(m.prim).toBe(40)
  s = (await act('personel', { id: m.id, ad: 'Merve', prim: 35 }, y.token)).d
  expect(s.shop.personel.find((p) => p.id === m.id).prim).toBe(35)
  expect((await act('personel', { id: m.id, ad: 'Merve', prim: 120 }, y.token)).d.error).toBe('bad_rate')
  await act('kayit', { per: 'elif', hz: ['Manikür'], tutar: 400, od: 'nakit' }, y.token)
  s = (await act('kayit', { per: m.id, hz: ['Manikür'], tutar: 400, od: 'kart' }, y.token)).d
  expect(s.kayitlar.map((k) => k.prim).sort()).toEqual([35, 50])
  // Merve kendi PIN'iyle girer
  expect((await login('5555')).per).toBe(m.id)
})

test('Geldi · Nakit/Kart ciro kaydı yazar, Geri al siler; yanlış kayıt silinir', async () => {
  const y = await login('1111')
  const r = await al({ ad: 'Zehra', tel: '05551112233', gun: YARIN(), saat: '10:00', hz: ['Fön (uzun saç)', 'Kaş alma'] })
  // Uzmanı seçilmemiş randevu: yönetici uzmanı seçer
  let s = (await act('geldi', { id: r.d.id, od: 'kart', per: 'elif' }, y.token)).d
  expect(s.kayitlar.length).toBe(1)
  expect(s.kayitlar[0]).toMatchObject({ per: 'elif', tutar: 500, od: 'kart', rid: r.d.id, mus: 'Zehra', prim: 50 })
  expect(s.randevular.find((x) => x.id === r.d.id).durum).toBe('geldi')
  expect((await act('geldi', { id: r.d.id, od: 'nakit' }, y.token)).s).toBe(409)
  s = (await act('gerial', { id: r.d.id }, y.token)).d
  expect(s.kayitlar.length).toBe(0)
  expect(s.randevular.find((x) => x.id === r.d.id).durum).toBe('bekliyor')
  s = (await act('geldi', { id: r.d.id, od: 'nakit', per: 'ayse' }, y.token)).d
  s = (await act('kayitsil', { id: s.kayitlar[0].id }, y.token)).d
  expect(s.kayitlar.length).toBe(0)
  expect(s.randevular.find((x) => x.id === r.d.id).durum).toBe('bekliyor')
  expect((await act('geldi', { id: r.d.id, od: 'cek', per: 'ayse' }, y.token)).d.error).toBe('bad_payment')
})

test('boya günü hatırlatması: zamanı gelen müşteri listelenir, hatırlatılınca düşer', async () => {
  const y = await login('1111')
  const a = await login('2222')
  const r = await al({ ad: 'Zehra', tel: '05551112233', gun: YARIN(), saat: '10:00', hz: ['Dip boya'], per: 'ayse' })
  const g = isGunu().gun
  // Yarınki randevu bugün "Geldi" sayılsın diye günü bugüne çekilir
  env.DB.raw.query("UPDATE kuafor_randevu SET gun = ? WHERE id = ?").run(g, r.d.id)
  let s = (await act('geldi', { id: r.d.id, od: 'nakit' }, a.token)).d
  const k = s.kayitlar[0]
  expect(k.hat).toBe(addDay(g, 35))
  expect(s.hatirlat).toEqual([])
  // 34 gün geçmiş gibi: hatırlatma günü 1 gün sonra → listede
  env.DB.raw.query('UPDATE kuafor_kayit SET data = ? WHERE id = ?').run(JSON.stringify({ ...k, id: undefined, gun: undefined, hat: addDay(g, 1) }), k.id)
  s = await st(a.token)
  expect(s.hatirlat.length).toBe(1)
  expect(s.hatirlat[0]).toMatchObject({ mus: 'Zehra', tel: '05551112233', hz: 'Dip boya', per: 'ayse' })
  // Başka personel görmez, yönetici görür
  expect((await st((await login('3333')).token)).hatirlat).toEqual([])
  expect((await st(y.token)).hatirlat.length).toBe(1)
  // Yaklaşan randevusu varsa listeye girmez
  const r2 = await al({ ad: 'Zehra', tel: '05551112233', gun: YARIN(), saat: '15:00', hz: ['Dip boya'] })
  expect((await st(y.token)).hatirlat.length).toBe(0)
  await J(await req(`/api/r/${KOD}/iptal`, { id: r2.d.id, key: r2.d.key }))
  s = (await act('hatirlat', { id: k.id }, a.token)).d
  expect(s.hatirlat).toEqual([])
  // Telefonsuz kayıtta hatırlatma olmaz; telefonlu randevusuz kayıtta olur
  const son = (s) => s.kayitlar.slice().sort((x, z) => x.ts - z.ts).at(-1)
  s = (await act('kayit', { hz: ['Röfle'], od: 'nakit', mus: 'Telsiz' }, a.token)).d
  expect(s.kayitlar.find((x) => x.mus === 'Telsiz').hat).toBeUndefined()
  s = (await act('kayit', { hz: ['Röfle', 'Fön (uzun saç)'], od: 'nakit', tel: '05559998877', mus: 'Sena' }, a.token)).d
  expect(s.kayitlar.find((x) => x.mus === 'Sena')).toMatchObject({ hat: addDay(g, 60), tutar: 1850 })
  expect(son(s).mus).toBe('Sena')
  expect((await act('kayit', { hz: ['Röfle'], od: 'nakit', tel: '123' }, a.token)).d.error).toBe('bad_phone')
})

test('iş günü saati ayarlanır (varsayılan 06:00)', async () => {
  const y = await login('1111')
  let s = await st(y.token)
  expect(s.shop.gunbas).toBe('06:00')
  s = (await act('ayar', { gunbas: '04:00', acilis: '10:00', kapanis: '02:00', aralik: 60 }, y.token)).d
  expect(s.shop.gunbas).toBe('04:00')
  expect(s.shop.slotlar[0]).toBe('10:00')
  expect(s.shop.slotlar.at(-1)).toBe('01:00')
  expect((await act('ayar', { gunbas: '25:00' }, y.token)).d.error).toBe('bad_time')
  const ms = Date.UTC(2026, 0, 10, 0, 30) // 03:30 Türkiye
  expect(isGunu('04:00', ms).gun).toBe('2026-01-09')
  expect(isGunu('06:00', Date.UTC(2026, 0, 10, 4, 0)).gun).toBe('2026-01-10')
  expect(slotlar(normShop({ acilis: '09:00', kapanis: '11:00', aralik: 30 }))).toEqual(['09:00', '09:30', '10:00', '10:30'])
})

test('hizmet listesi düzenlenir: kategori, süre, hatırlatma; varsayılana dönülür', async () => {
  const y = await login('1111')
  let s = (await act('ayar', { hizmetler: [{ ad: 'Fön', kat: 'Kesim', fiyat: 300, sure: 30 }, { ad: 'Dip boya', kat: 'Boya', fiyat: '900', sure: 90, hat: 30 }] }, y.token)).d
  expect(s.shop.hizmetler).toEqual([{ ad: 'Fön', kat: 'Kesim', fiyat: 300, sure: 30 }, { ad: 'Dip boya', kat: 'Boya', fiyat: 900, sure: 90, hat: 30 }])
  expect((await act('ayar', { hizmetler: [{ ad: 'Fön', fiyat: 300, sure: 2 }] }, y.token)).d.error).toBe('bad_duration')
  expect((await act('ayar', { hizmetler: [{ ad: 'Fön', fiyat: 300, sure: 30 }, { ad: 'Fön', fiyat: 1, sure: 30 }] }, y.token)).d.error).toBe('bad_services')
  s = (await act('ayar', { varsayilan: true }, y.token)).d
  expect(s.shop.hizmetler.length).toBe(64)
})

test('gider ve net kâr verisi yalnızca yöneticide; gider silinir', async () => {
  const y = await login('1111')
  let s = (await act('gider', { tur: 'Boya ve malzeme', tutar: '1.250,50'.replace('.', ''), not: '10 tüp' }, y.token)).d
  expect(s.giderler[0]).toMatchObject({ tur: 'Boya ve malzeme', tutar: 1250.5, not: '10 tüp' })
  s = (await act('gidersil', { id: s.giderler[0].id }, y.token)).d
  expect(s.giderler.length).toBe(0)
})

test('PIN: yanlış PIN sınırı', async () => {
  for (let i = 0; i < 8; i++) expect((await J(await req(`/api/s/${KOD}/login`, { pin: '9999' }, null, '1.1.1.1'))).d.error).toBe('wrong_pin')
  expect((await J(await req(`/api/s/${KOD}/login`, { pin: '1111' }, null, '1.1.1.1'))).d.error).toBe('too_many')
  expect((await J(await req(`/api/s/${KOD}/info`))).d).toEqual({ ad: 'Selin Kuaför', kurulu: true })
})

test('abonelik: süresi biten ya da durdurulan salon kapanır (402), kayıtlar durur', async () => {
  const y = await login('1111')
  await setup({ dur: true })
  expect((await J(await req(`/api/r/${KOD}/info`))).s).toBe(402)
  expect((await J(await req(`/api/s/${KOD}/login`, { pin: '1111' }))).s).toBe(402)
  await setup({ bitis: '2020-01-01' })
  const r = await J(await req(`/api/r/${KOD}/info`))
  expect(r.s).toBe(402)
  expect(r.d.ad).toBe('Selin Kuaför')
  expect(y.token).toBeTruthy()
})

test('çok şubeli işletme: merkez PIN’iyle özet ve yeni şube', async () => {
  const y = await login('1111')
  await act('kayit', { per: 'ayse', hz: ['Manikür'], od: 'nakit' }, y.token)
  expect((await J(await req(`/api/s/${KOD}/isl/ozet`, undefined, y.token))).s).toBe(401)
  const i = await login('1111', 'isl')
  expect(i.rol).toBe('isl')
  const n = await J(await req(`/api/s/${KOD}/isl/sube`, { ad: 'Selin Kuaför Kadıköy', pin: '7777' }, i.token))
  expect(n.d.kod).toBe('selin-kuafor-kadikoy')
  expect((await J(await req(`/api/s/${KOD}/isl/sube`, { ad: 'Selin Kuaför Kadıköy', pin: '7777' }, i.token))).d.error).toBe('kod_taken')
  const o = (await J(await req(`/api/s/${KOD}/isl/ozet`, undefined, i.token))).d
  expect(o.subeler.map((s) => s.kod)).toEqual(['selin-kuafor', 'selin-kuafor-kadikoy'])
  expect(o.subeler[0].kayit.length).toBe(1)
  const p = JSON.parse(env.DB.raw.query("SELECT data FROM plat_shops WHERE kod = 'selin-kuafor-kadikoy'").get().data)
  expect(p).toMatchObject({ sektor: 'Bayan Kuaför', isl: 'Selin Kuaför', bitis: '2099-01-01' })
  // Şube kendi PIN'iyle açılır, hizmet listesi merkezden gelir
  const sb = (await J(await req('/api/s/selin-kuafor-kadikoy/login', { pin: '7777' }))).d
  const ss = (await J(await req('/api/s/selin-kuafor-kadikoy/state', undefined, sb.token))).d
  expect(ss.shop.hizmetler.length).toBe(64)
  expect(ss.shop.cokSube).toBe(true)
  // Şube tokeni merkezde geçmez
  expect((await J(await req(`/api/s/${KOD}/state`, undefined, sb.token))).s).toBe(401)
})

test('kurulmamış salon: sahip panelinde kayıtlı ama tablo satırı yok → hazırlanıyor', async () => {
  env.DB.raw.query("INSERT INTO plat_shops (id, kod, data) VALUES ('x', 'yeni-kuafor', ?)").run(JSON.stringify({ ad: 'Yeni Kuaför', sektor: 'Bayan Kuaför', bitis: '2099-01-01', kod: 'yeni-kuafor' }))
  const r = await J(await req('/api/r/yeni-kuafor/info'))
  expect(r).toEqual({ s: 409, d: { error: 'setup', ad: 'Yeni Kuaför' } })
  expect((await J(await req('/api/r/yok/info'))).s).toBe(404)
})
