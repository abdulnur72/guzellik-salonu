import { test, expect, beforeEach } from 'bun:test'
import { makeDB } from './d1.js'
import { makeWorker, hashPin, isGunu, slotlar, normShop, addDay, validTel } from '../src/server.js'

const W = makeWorker('<html><script>/*__BOOT__*/</script>app</html>')
let env
const KOD = 'fatih-berber'
const YARIN = () => addDay(isGunu().gun, 1)
async function setup({ bitis, dur = false, shop = {} } = {}) {
  env = { DB: makeDB() }
  const db = env.DB.raw
  const plat = { id: 'fatih-berber', ad: 'Fatih Berber', sektor: 'Berber', tel: '', paket: 'p1', deneme: true, bitis: bitis || '2099-01-01', dur, not: '', isl: '', kod: KOD }
  db.query('UPDATE plat_shops SET data = ? WHERE kod = ?').run(JSON.stringify(plat), KOD)
  const data = { ad: 'Fatih Berber', wa: '05321112233', acilis: '09:00', kapanis: '22:00', aralik: 30, personel: [{ id: 'ali', ad: 'Ali', prim: 40, aktif: true }, { id: 'veli', ad: 'Veli', prim: 50, aktif: true }], ...shop }
  db.query('UPDATE berber_shops SET data = ? WHERE kod = ?').run(JSON.stringify(data), KOD)
  db.query('INSERT INTO secrets (key, hash) VALUES (?, ?)').run('berber:yon:' + KOD, await hashPin('1111'))
  db.query('INSERT INTO secrets (key, hash) VALUES (?, ?)').run('berber:per:' + KOD + ':ali', await hashPin('2222'))
  db.query('INSERT INTO secrets (key, hash) VALUES (?, ?)').run('berber:per:' + KOD + ':veli', await hashPin('3333'))
}
let ipn = 0
const req = (path, body, tok, ip) =>
  W.fetch(new Request('https://x.dev' + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip || '10.0.0.' + (ipn++ % 250), ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }), env)
const J = async (r) => ({ s: r.status, d: await r.json() })
const login = async (pin, rol) => (await J(await req(`/api/s/${KOD}/login`, { pin, rol }))).d
const st = async (tok) => (await J(await req(`/api/s/${KOD}/state`, undefined, tok))).d
const act = async (a, b, tok) => J(await req(`/api/s/${KOD}/${a}`, b, tok))
const al = async (b) => J(await req(`/api/r/${KOD}/al`, b))

beforeEach(() => setup())

test('migration: Fatih Berber 30 gün denemeyle kurulu', async () => {
  const e = { DB: makeDB() }
  const p = JSON.parse(e.DB.raw.query("SELECT data FROM plat_shops WHERE kod = 'fatih-berber'").get().data)
  expect(p.sektor).toBe('Berber')
  expect(p.deneme).toBe(true)
  const gun = Math.round((new Date(p.bitis) - new Date(new Date().toISOString().slice(0, 10))) / 86400000)
  expect(gun).toBe(30)
  expect(e.DB.raw.query("SELECT isl FROM berber_shops WHERE kod = 'fatih-berber'").get().isl).toBe('fatih-berber')
})

test('iş günü: gece yarısından sonrası önceki güne yazılır', () => {
  const t = (s) => Date.parse(s + '+03:00')
  expect(isGunu('06:00', t('2026-11-19T01:30:00')).gun).toBe('2026-11-18')
  expect(isGunu('06:00', t('2026-11-19T05:59:00')).gun).toBe('2026-11-18')
  expect(isGunu('06:00', t('2026-11-19T06:00:00')).gun).toBe('2026-11-19')
  expect(isGunu('00:00', t('2026-11-19T01:30:00')).gun).toBe('2026-11-19')
  // Kapanış 02:00: gece saatleri aynı iş gününün sonunda
  const s = slotlar(normShop({ acilis: '20:00', kapanis: '02:00', aralik: 60 }))
  expect(s).toEqual(['20:00', '21:00', '22:00', '23:00', '00:00', '01:00'])
  expect(validTel('0532 111 22 33')).toBe(true)
  expect(validTel('+90 532 111 22 33')).toBe(true)
  expect(validTel('0212 111 22 33')).toBe(false)
  expect(validTel('12345')).toBe(false)
})

test('müşteri sayfası bilgisi sayfaya gömülür, panel bilgisi gizli', async () => {
  const html = await (await W.fetch(new Request('https://x.dev/r/' + KOD), env)).text()
  expect(html).toContain('var BOOT=')
  expect(html).toContain('Fatih Berber')
  expect(html).not.toContain('prim')
  const i = await J(await req(`/api/r/${KOD}/info`))
  expect(i.d.personel).toEqual([{ id: 'ali', ad: 'Ali' }, { id: 'veli', ad: 'Veli' }])
  expect((await J(await req('/api/r/yok/info'))).s).toBe(404)
})

test('randevu: geçmiş gün yok, telefon kontrolü, dolu saat, kapasite', async () => {
  const g = YARIN()
  expect((await al({ ad: 'A', tel: '05320000000', gun: addDay(isGunu().gun, -1), saat: '10:00', hz: 'Sakal' })).d.error).toBe('past_date')
  expect((await al({ ad: 'A', tel: '0212 000 00 00', gun: g, saat: '10:00' })).d.error).toBe('bad_phone')
  expect((await al({ ad: 'A', tel: '05320000000', gun: g, saat: '10:10' })).d.error).toBe('bad_time')
  expect((await al({ ad: 'A', tel: '05320000000', gun: g, saat: '' })).d.error).toBe('sira_today')
  expect((await al({ ad: 'A', tel: '05320000000', gun: addDay(g, 40), saat: '10:00' })).d.error).toBe('too_far')
  const a = await al({ ad: 'Ahmet', tel: '0532 000 00 01', gun: g, saat: '10:00', per: 'ali', hz: 'Sakal' })
  expect(a.s).toBe(200)
  expect(a.d.sira).toBe(1)
  expect(a.d.per).toBe('Ali')
  expect(a.d.hz).toBe('Sakal')
  expect((await al({ ad: 'B', tel: '05320000002', gun: g, saat: '10:00', per: 'ali' })).d.error).toBe('slot_taken')
  // Veli boş; "fark etmez" de bir kişilik yer bulur
  expect((await al({ ad: 'C', tel: '05320000003', gun: g, saat: '10:00' })).s).toBe(200)
  expect((await al({ ad: 'D', tel: '05320000004', gun: g, saat: '10:00', per: 'veli' })).d.error).toBe('slot_taken')
  const bos = (await J(await req(`/api/r/${KOD}/bos?gun=${g}&per=`))).d.slotlar
  expect(bos.find((x) => x.s === '10:00').ok).toBe(false)
  expect(bos.find((x) => x.s === '10:30').ok).toBe(true)
  // Geçmiş günün saatleri hep kapalı
  const dun = (await J(await req(`/api/r/${KOD}/bos?gun=${addDay(g, -2)}&per=`))).d.slotlar
  expect(dun.every((x) => !x.ok)).toBe(true)
})

test('sıra numarası, randevularım, iptal ve sıradan çıkma', async () => {
  const bugun = isGunu().gun
  const s1 = await al({ ad: 'Bir', tel: '05320000011', gun: bugun, saat: '' })
  const s2 = await al({ ad: 'İki', tel: '05320000012', gun: bugun, saat: '' })
  expect(s1.s).toBe(200)
  expect(s2.d.sira).toBe(s1.d.sira + 1)
  expect(s2.d.onunde).toBe(1)
  const b = await J(await req(`/api/r/${KOD}/benim`, { tel: '0532 000 00 12' }))
  expect(b.d.list.length).toBe(1)
  expect(b.d.list[0].onunde).toBe(1)
  expect(JSON.stringify(b.d)).not.toContain('Bir') // başkasının adı görünmez
  expect((await J(await req(`/api/r/${KOD}/iptal`, { id: s2.d.id, key: 'yanlis' }))).d.error).toBe('not_yours')
  // Öndeki sıradan çıkınca arkadaki öne geçer
  expect((await J(await req(`/api/r/${KOD}/iptal`, { id: s1.d.id, key: s1.d.key }))).s).toBe(200)
  expect((await J(await req(`/api/r/${KOD}/benim`, { tel: '05320000012' }))).d.list[0].onunde).toBe(0)
  expect((await J(await req(`/api/r/${KOD}/benim`, { tel: '05320000011' }))).d.list.length).toBe(0)
  expect((await J(await req(`/api/r/${KOD}/iptal`, { id: s1.d.id, key: s1.d.key }))).d.error).toBe('changed')
})

test('aynı telefonla aynı güne en fazla 3 randevu ve saatlik sınır', async () => {
  const g = YARIN()
  for (const s of ['11:00', '11:30', '12:00']) expect((await al({ ad: 'X', tel: '05329999999', gun: g, saat: s })).s).toBe(200)
  expect((await al({ ad: 'X', tel: '05329999999', gun: g, saat: '12:30' })).d.error).toBe('too_many_same')
  for (let i = 0; i < 8; i++) expect((await req(`/api/r/${KOD}/al`, { ad: 'Y', tel: '0532888880' + i, gun: g, saat: String(14 + Math.floor(i / 2)) + (i % 2 ? ':30' : ':00') }, null, '7.7.7.7')).status).toBe(200)
  expect((await J(await req(`/api/r/${KOD}/al`, { ad: 'Y', tel: '05328888889', gun: g, saat: '19:00' }, null, '7.7.7.7'))).d.error).toBe('too_many')
})

test('roller: personel yalnızca kendini görür, ciro ve gider yalnızca yöneticide', async () => {
  const g = YARIN()
  await al({ ad: 'AliMusteri', tel: '05320000021', gun: g, saat: '10:00', per: 'ali' })
  await al({ ad: 'VeliMusteri', tel: '05320000022', gun: g, saat: '10:00', per: 'veli' })
  await al({ ad: 'Bosta', tel: '05320000023', gun: g, saat: '11:00' })
  const ali = await login('2222')
  expect(ali.rol).toBe('per')
  expect(ali.per).toBe('ali')
  const yon = await login('1111')
  expect(yon.rol).toBe('yon')
  expect((await login('2222', 'yon')).error).toBe('wrong_pin') // yönetici sekmesinden personel PIN'i geçmez
  const sa = await st(ali.token)
  const adlar = sa.randevular.map((r) => r.ad)
  expect(adlar).toContain('AliMusteri')
  expect(adlar).toContain('Bosta')
  expect(adlar).not.toContain('VeliMusteri')
  expect(sa.giderler).toBeUndefined()
  expect(sa.shop.personel.find((p) => p.id === 'veli').prim).toBeUndefined() // başkasının oranı gizli
  expect(JSON.stringify(sa)).not.toContain('"k":')
  await act('kayit', { hz: 'Sakal', od: 'nakit' }, ali.token)
  const veli = await login('3333')
  await act('kayit', { hz: 'Saç kesimi', od: 'kart' }, veli.token)
  const sv = await st(veli.token)
  expect(sv.kayitlar.length).toBe(1)
  expect(sv.kayitlar[0].per).toBe('veli')
  expect((await act('gider', { tutar: 100 }, ali.token)).d.error).toBe('yonetici')
  expect((await act('ayar', { ad: 'X' }, ali.token)).d.error).toBe('yonetici')
  expect((await act('personel', { ad: 'X', pin: '7777' }, ali.token)).d.error).toBe('yonetici')
  const sy = await st(yon.token)
  expect(sy.kayitlar.length).toBe(2)
  expect(Array.isArray(sy.giderler)).toBe(true)
  expect(sy.randevular.length).toBe(3)
})

test('personel PIN yönetici PIN inden ve birbirinden farklı; yeni personel %40', async () => {
  const yon = await login('1111')
  expect((await act('personel', { ad: 'Can', pin: '1111' }, yon.token)).d.error).toBe('same_pin_yon')
  expect((await act('personel', { ad: 'Can', pin: '2222' }, yon.token)).d.error).toBe('same_pin_other')
  const r = await act('personel', { ad: 'Can', pin: '4444', prim: '' }, yon.token)
  expect(r.s).toBe(200)
  const can = r.d.shop.personel.find((p) => p.ad === 'Can')
  expect(can.prim).toBe(40)
  expect((await act('personel', { ad: 'Cem', pin: '5555', prim: 35 }, yon.token)).d.shop.personel.find((p) => p.ad === 'Cem').prim).toBe(35)
  // Boş oran mevcut oranı silmez
  expect((await act('personel', { id: can.id, ad: 'Can', prim: '' }, yon.token)).d.shop.personel.find((p) => p.id === can.id).prim).toBe(40)
  expect((await act('personel', { id: can.id, ad: 'Can', prim: 120 }, yon.token)).d.error).toBe('bad_rate')
  const c = await login('4444')
  expect(c.per).toBe(can.id)
  // Personel kendi PIN'ini değiştirir; yönetici PIN'i olamaz
  expect((await act('perpin', { pin: '1111' }, c.token)).d.error).toBe('same_pin_yon')
  expect((await act('perpin', { pin: '6666' }, c.token)).s).toBe(200)
  expect((await login('4444')).error).toBe('wrong_pin')
  expect((await login('6666')).per).toBe(can.id)
  // Yönetici PIN'i personel PIN'i olamaz
  expect((await act('pin', { pin: '6666' }, yon.token)).d.error).toBe('same_pin_per')
  // Çıkarılan personel giremez, oturumu kapanır
  await act('personelsil', { id: can.id }, yon.token)
  expect((await J(await req(`/api/s/${KOD}/state`, undefined, c.token))).s).toBe(401)
  expect((await login('6666')).error).toBe('wrong_pin')
})

test('prim oranı kişiye göre; kayıt anındaki oran saklanır', async () => {
  const ali = await login('2222')
  const veli = await login('3333')
  await act('kayit', { hz: 'Saç kesimi', od: 'nakit' }, ali.token) // 300 * %40
  await act('kayit', { hz: 'Saç kesimi', od: 'kart', tutar: 200 }, veli.token) // 200 * %50
  const yon = await login('1111')
  await act('personel', { id: 'ali', ad: 'Ali', prim: 60 }, yon.token)
  const s = await st(yon.token)
  const k = Object.fromEntries(s.kayitlar.map((x) => [x.per, x]))
  expect(k.ali.prim).toBe(40)
  expect(k.ali.tutar).toBe(300)
  expect(k.veli.prim).toBe(50)
  expect(k.veli.od).toBe('kart')
})

test('Geldi · Nakit/Kart ciro yazar, Geri al siler', async () => {
  const g = isGunu().gun
  const a = await al({ ad: 'Musteri', tel: '05320000031', gun: g, saat: '', per: 'ali', hz: 'Saç + sakal' })
  const ali = await login('2222')
  const veli = await login('3333')
  expect((await act('geldi', { id: a.d.id, od: 'kart' }, veli.token)).d.error).toBe('not_yours')
  let s = (await act('geldi', { id: a.d.id, od: 'kart' }, ali.token)).d
  expect(s.kayitlar.length).toBe(1)
  expect(s.kayitlar[0]).toMatchObject({ per: 'ali', hz: 'Saç + sakal', tutar: 400, od: 'kart', rid: a.d.id, mus: 'Musteri' })
  expect(s.randevular.find((r) => r.id === a.d.id).durum).toBe('geldi')
  expect((await act('geldi', { id: a.d.id, od: 'nakit' }, ali.token)).d.error).toBe('changed')
  s = (await act('gerial', { id: a.d.id }, ali.token)).d
  expect(s.kayitlar.length).toBe(0)
  expect(s.randevular.find((r) => r.id === a.d.id).durum).toBe('bekliyor')
  // Kaydı silmek de randevuyu geri açar
  s = (await act('geldi', { id: a.d.id, od: 'nakit' }, ali.token)).d
  s = (await act('kayitsil', { id: s.kayitlar[0].id }, ali.token)).d
  expect(s.randevular.find((r) => r.id === a.d.id).durum).toBe('bekliyor')
  // "Fark etmez" randevu: yönetici berberi seçer
  const b = await al({ ad: 'Boş', tel: '05320000032', gun: g, saat: '' })
  const yon = await login('1111')
  expect((await act('geldi', { id: b.d.id, od: 'nakit' }, yon.token)).d.error).toBe('no_staff')
  s = (await act('geldi', { id: b.d.id, od: 'nakit', per: 'veli' }, yon.token)).d
  expect(s.kayitlar.find((k) => k.rid === b.d.id).per).toBe('veli')
  // Gelmedi → Geri al
  const c = await al({ ad: 'Gelmeyen', tel: '05320000033', gun: g, saat: '' })
  expect((await act('iptal', { id: c.d.id }, yon.token)).d.randevular.find((r) => r.id === c.d.id).durum).toBe('iptal')
  expect((await act('gerial', { id: c.d.id }, yon.token)).d.randevular.find((r) => r.id === c.d.id).durum).toBe('bekliyor')
})

test('yanlış kaydı silme: personel yalnızca kendi kaydını', async () => {
  const ali = await login('2222')
  const veli = await login('3333')
  const k = (await act('kayit', { hz: 'Sakal', od: 'nakit' }, ali.token)).d.kayitlar[0]
  expect((await act('kayitsil', { id: k.id }, veli.token)).d.error).toBe('not_yours')
  expect((await act('kayitsil', { id: k.id }, ali.token)).d.kayitlar.length).toBe(0)
  expect((await act('kayit', { hz: 'Sakal', od: 'havale' }, ali.token)).d.error).toBe('bad_payment')
  expect((await act('kayit', { hz: 'Sakal', od: 'nakit', per: 'veli' }, ali.token)).d.kayitlar[0].per).toBe('ali') // başkası adına yazamaz
})

test('gider, ayarlar ve iş günü saati', async () => {
  const yon = await login('1111')
  let s = (await act('gider', { tur: 'Kira', tutar: '5000' }, yon.token)).d
  expect(s.giderler[0]).toMatchObject({ tur: 'Kira', tutar: 5000 })
  s = (await act('gidersil', { id: s.giderler[0].id }, yon.token)).d
  expect(s.giderler.length).toBe(0)
  s = (await act('ayar', { gunbas: '05:00', acilis: '18:00', kapanis: '03:00', aralik: 60 }, yon.token)).d
  expect(s.shop.gunbas).toBe('05:00')
  expect(s.shop.slotlar.slice(-3)).toEqual(['00:00', '01:00', '02:00'])
  expect((await act('ayar', { gunbas: '25:00' }, yon.token)).d.error).toBe('bad_time')
  expect((await act('ayar', { hizmetler: [{ ad: 'Sakal', fiyat: 100 }, { ad: 'Sakal', fiyat: 120 }] }, yon.token)).d.error).toBe('bad_services')
  expect((await act('ayar', { wa: '123' }, yon.token)).d.error).toBe('bad_phone')
})

test('abonelik: Durdur ve süre bitince kapanır', async () => {
  await setup({ dur: true })
  expect((await req(`/api/r/${KOD}/info`)).status).toBe(402)
  const l = await J(await req(`/api/s/${KOD}/login`, { pin: '1111' }))
  expect(l.s).toBe(402)
  await setup({ bitis: '2020-01-01' })
  const r = await J(await req(`/api/r/${KOD}/info`))
  expect(r.s).toBe(402)
  expect(r.d.tel).toBe('05321112233')
})

test('yanlış PIN sınırı', async () => {
  for (let i = 0; i < 8; i++) await req(`/api/s/${KOD}/login`, { pin: '9999' }, null, '5.5.5.5')
  expect((await J(await req(`/api/s/${KOD}/login`, { pin: '1111' }, null, '5.5.5.5'))).d.error).toBe('too_many')
})

test('çok şubeli işletme: merkez PIN ile giriş, yeni şube, ilave şube sahip panelinde', async () => {
  const per = await login('2222')
  expect((await J(await req(`/api/s/${KOD}/isl/ozet`, undefined, per.token))).s).toBe(401)
  expect((await login('2222', 'isl')).error).toBe('wrong_pin')
  const isl = await login('1111', 'isl')
  expect(isl.rol).toBe('isl')
  const y = await J(await req(`/api/s/${KOD}/isl/sube`, { ad: 'Fatih Berber Kadıköy', pin: '8888' }, isl.token))
  expect(y.d).toEqual({ ok: true, kod: 'fatih-berber-kadikoy' })
  expect((await J(await req(`/api/s/${KOD}/isl/sube`, { ad: 'Fatih Berber Kadıköy', pin: '8888' }, isl.token))).d.error).toBe('kod_taken')
  const db = env.DB.raw
  const yeni = JSON.parse(db.query("SELECT data FROM plat_shops WHERE kod = 'fatih-berber-kadikoy'").get().data)
  const merkez = JSON.parse(db.query("SELECT data FROM plat_shops WHERE kod = 'fatih-berber'").get().data)
  expect(yeni).toMatchObject({ sektor: 'Berber', isl: 'Fatih Berber', bitis: merkez.bitis, deneme: true })
  expect(merkez.isl).toBe('Fatih Berber')
  // Yeni şubenin kendi yönetici PIN'i ve kendi hizmetleri
  const k = (await J(await req('/api/s/fatih-berber-kadikoy/login', { pin: '8888' }))).d
  expect(k.rol).toBe('yon')
  const ks = (await J(await req('/api/s/fatih-berber-kadikoy/state', undefined, k.token))).d
  expect(ks.shop.cokSube).toBe(true)
  expect(ks.shop.personel).toEqual([])
  await J(await req('/api/s/fatih-berber-kadikoy/personel', { ad: 'Deniz', pin: '2222' }, k.token))
  const dn = (await J(await req('/api/s/fatih-berber-kadikoy/login', { pin: '2222' }))).d
  await J(await req('/api/s/fatih-berber-kadikoy/kayit', { hz: 'Sakal', od: 'nakit' }, dn.token))
  await act('kayit', { hz: 'Saç kesimi', od: 'kart' }, per.token)
  // Şube yöneticisi kendi panelinin token'ıyla merkezi göremez
  expect((await J(await req(`/api/s/${KOD}/state`, undefined, k.token))).s).toBe(401)
  // İşletme özeti: iki şube, ilave şube ücreti
  const o = (await J(await req(`/api/s/${KOD}/isl/ozet`, undefined, isl.token))).d
  expect(o.subeler.map((s) => s.kod)).toEqual(['fatih-berber', 'fatih-berber-kadikoy'])
  expect(o.subeler[1].kayit[0].tutar).toBe(150)
  expect(o.ekUcret).toBe(300)
  // Kadıköy panelinden de merkez PIN'iyle işletme paneline girilir
  const isl2 = (await J(await req('/api/s/fatih-berber-kadikoy/login', { pin: '1111', rol: 'isl' }))).d
  expect(isl2.rol).toBe('isl')
  expect((await J(await req('/api/s/fatih-berber-kadikoy/isl/ozet', undefined, isl2.token))).d.subeler.length).toBe(2)
  expect((await J(await req('/api/s/fatih-berber-kadikoy/login', { pin: '8888', rol: 'isl' }))).d.error).toBe('wrong_pin')
})

test('ana ekran simgesi: manifest PNG simgeleri gösterir, PNG dosyaları sunulur', async () => {
  for (const area of ['s', 'r']) {
    const m = await (await req(`/${area}/${KOD}/app.webmanifest`)).json()
    expect(m.icons.map((i) => `${i.src} ${i.sizes} ${i.purpose}`)).toEqual([
      '/icon-192.png 192x192 any', '/icon-512.png 512x512 any',
      '/icon-192-maskable.png 192x192 maskable', '/icon-512-maskable.png 512x512 maskable',
    ])
  }
  for (const [p, size] of [['/icon-192.png', 192], ['/icon-512.png', 512], ['/icon-192-maskable.png', 192], ['/icon-512-maskable.png', 512]]) {
    const r = await req(p)
    expect(r.status).toBe(200)
    expect(r.headers.get('content-type')).toBe('image/png')
    const b = new Uint8Array(await r.arrayBuffer())
    expect([...b.slice(1, 4)].map((c) => String.fromCharCode(c)).join('')).toBe('PNG')
    const dv = new DataView(b.buffer)
    expect([dv.getUint32(16), dv.getUint32(20)]).toEqual([size, size])
  }
})
