import { test, expect, beforeEach } from 'bun:test'
import { makeDB } from './d1.js'
import { makeWorker, hashPin, isGunu, slotlar, normShop, addDay, VARSAYILAN_HIZMET, VARSAYILAN_DERS, musaitMi, satisIsle, satisGeri } from '../src/server.js'

const W = makeWorker('<html><script>/*__BOOT__*/</script>app</html>')
let env
const KOD = 'atlas-spor'
const G = () => isGunu().gun
const YARIN = () => addDay(G(), 1)
const haftaGunu = (d) => new Date(d + 'T12:00:00Z').getUTCDay()
// Testte her gün ders olsun diye: Pilates her gün 21:00, 2 kişilik; Yoga her gün 08:00, Can'ın dersi
const DERS = [
  { id: 'pilates', ad: 'Pilates', gunler: [0, 1, 2, 3, 4, 5, 6], saat: '21:00', sure: 50, per: '', kont: 2 },
  { id: 'yoga', ad: 'Yoga', gunler: [0, 1, 2, 3, 4, 5, 6], saat: '08:00', sure: 60, per: 'can', kont: 10 },
]
async function setup({ bitis, dur = false, shop = {} } = {}) {
  env = { DB: makeDB() }
  const db = env.DB.raw
  const plat = { id: 'atlas-spor', ad: 'Atlas Spor Salonu', sektor: 'Spor Salonu', tel: '', paket: 'p1', deneme: true, bitis: bitis || '2099-01-01', dur, not: '', isl: '', kod: KOD }
  db.query('UPDATE plat_shops SET data = ? WHERE kod = ?').run(JSON.stringify(plat), KOD)
  const data = { ad: 'Atlas Spor Salonu', wa: '05321112233', acilis: '07:00', kapanis: '23:00', aralik: 30, dersler: DERS, personel: [{ id: 'can', ad: 'Can', prim: 40, aktif: true }, { id: 'ece', ad: 'Ece', prim: 50, aktif: true }], ...shop }
  db.query('UPDATE spor_shops SET data = ? WHERE kod = ?').run(JSON.stringify(data), KOD)
  db.query('INSERT INTO secrets (key, hash) VALUES (?, ?)').run('spor:yon:' + KOD, await hashPin('1111'))
  db.query('INSERT INTO secrets (key, hash) VALUES (?, ?)').run('spor:per:' + KOD + ':can', await hashPin('2222'))
  db.query('INSERT INTO secrets (key, hash) VALUES (?, ?)').run('spor:per:' + KOD + ':ece', await hashPin('3333'))
}
let ipn = 0
const req = (path, body, tok, ip) =>
  W.fetch(new Request('https://x.dev' + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip || '10.0.0.' + (ipn++ % 250), ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }), env)
const J = async (r) => ({ s: r.status, d: await r.json() })
const login = async (pin, rol) => (await J(await req(`/api/s/${KOD}/login`, { pin, rol }))).d
const st = async (tok) => (await J(await req(`/api/s/${KOD}/state`, undefined, tok))).d
const act = async (a, b, tok) => J(await req(`/api/s/${KOD}/${a}`, b, tok))
const al = async (b) => J(await req(`/api/r/${KOD}/al`, b))
const ders = async (b) => J(await req(`/api/r/${KOD}/ders`, b))
const info = async () => (await J(await req(`/api/r/${KOD}/info`))).d

beforeEach(() => setup())

test('migration: Atlas Spor Salonu 30 gün denemeyle, sektörü Spor Salonu', async () => {
  const e = { DB: makeDB() }
  const p = JSON.parse(e.DB.raw.query("SELECT data FROM plat_shops WHERE kod = 'atlas-spor'").get().data)
  expect(p.sektor).toBe('Spor Salonu')
  expect(p.deneme).toBe(true)
  const gun = Math.round((new Date(p.bitis) - new Date(new Date().toISOString().slice(0, 10))) / 86400000)
  expect(gun).toBe(30)
  expect(e.DB.raw.query("SELECT isl FROM spor_shops WHERE kod = 'atlas-spor'").get().isl).toBe('atlas-spor')
})

test('varsayılan liste: üyelik, paket, hizmet, ürün; benzersiz; varsayılan ders programı', () => {
  expect(new Set(VARSAYILAN_HIZMET.map((h) => h.ad)).size).toBe(VARSAYILAN_HIZMET.length)
  expect(new Set(VARSAYILAN_HIZMET.map((h) => h.tur))).toEqual(new Set(['uyelik', 'paket', 'hizmet', 'urun']))
  expect(VARSAYILAN_HIZMET.find((h) => h.ad === 'Aylık üyelik')).toMatchObject({ tur: 'uyelik', gun: 30 })
  expect(VARSAYILAN_HIZMET.find((h) => h.ad === 'PT 12 ders')).toMatchObject({ tur: 'paket', seans: 12 })
  expect(VARSAYILAN_DERS.every((d) => d.kont > 0 && d.gunler.length)).toBe(true)
  expect(normShop({}).gunbas).toBe('00:00')
})

test('müşteri sayfası tek istekte açılır; ürün, ücret ve sıfır fiyatlı kalem gizli', async () => {
  const r = await req(`/r/${KOD}`)
  const html = await r.text()
  expect(html).toContain('var BOOT=')
  expect(html).toContain('Atlas Spor')
  const i = await info()
  const adlar = i.hizmetler.map((h) => h.ad)
  expect(adlar).toContain('Aylık üyelik')
  expect(adlar).toContain('Kişisel antrenman (tek ders)')
  expect(adlar).not.toContain('Su')
  expect(adlar).not.toContain('Çay / ikram')
  expect(i.hizmetler.some((h) => 'fiyat' in h)).toBe(false)
  expect(JSON.stringify(i)).not.toContain('prim')
  expect(JSON.stringify(i)).not.toContain('fiyat')
  expect(i.personel).toEqual([{ id: 'can', ad: 'Can' }, { id: 'ece', ad: 'Ece' }])
  // Ders oturumları: geçmiş saat gelmez, boş yer sayısı gelir
  expect(i.dersler.length).toBeGreaterThan(10)
  expect(i.dersler.find((o) => o.d === 'pilates' && o.gun === YARIN())).toMatchObject({ ad: 'Pilates', saat: '21:00', bos: 2 })
  // Ürün ya da sıfır fiyatlı kalemle müşteri randevusu alınamaz
  expect((await al({ ad: 'Ali', tel: '05551112233', gun: YARIN(), saat: '10:00', hz: ['Su'] })).d.error).toBe('no_service')
  expect((await al({ ad: 'Ali', tel: '05551112233', gun: YARIN(), saat: '10:00', hz: ['Çay / ikram'] })).d.error).toBe('no_service')
})

test('müşteri randevusu: geçmiş tarih, telefon, çift randevu engeli; Randevularım ve iptal', async () => {
  const dun = addDay(G(), -1)
  expect((await al({ ad: 'Ali', tel: '05551112233', gun: dun, saat: '10:00', hz: ['Vücut analizi'] })).d.error).toBe('past_date')
  expect((await al({ ad: 'Ali', tel: '12345', gun: YARIN(), saat: '10:00', hz: ['Vücut analizi'] })).d.error).toBe('bad_phone')
  expect((await al({ ad: '', tel: '05551112233', gun: YARIN(), saat: '10:00', hz: ['Vücut analizi'] })).d.error).toBe('no_name')
  const r = await al({ ad: 'Ali', tel: '0555 111 22 33', gun: YARIN(), saat: '10:00', hz: ['Kişisel antrenman (tek ders)'], per: 'ece' })
  expect(r.s).toBe(200)
  expect(r.d).toMatchObject({ saat: '10:00', sure: 60, per: 'Ece' })
  expect(r.d.fiyat).toBeUndefined()
  // Aynı telefon aynı gün ikinci randevu alamaz
  expect((await al({ ad: 'Ali', tel: '05551112233', gun: YARIN(), saat: '15:00', hz: ['Vücut analizi'] })).d.error).toBe('double')
  const b = (await J(await req(`/api/r/${KOD}/benim`, { tel: '+90 555 111 22 33' }))).d.list
  expect(b.length).toBe(1)
  expect(b[0]).toMatchObject({ tip: 'r', saat: '10:00', per: 'Ece', durum: 'bekliyor' })
  expect((await J(await req(`/api/r/${KOD}/iptal`, { id: r.d.id, key: 'yanlis' }))).s).toBe(403)
  expect((await J(await req(`/api/r/${KOD}/iptal`, { id: r.d.id, key: r.d.key }))).d.ok).toBe(true)
  expect((await J(await req(`/api/r/${KOD}/benim`, { tel: '05551112233' }))).d.list.length).toBe(0)
  // İptalden sonra aynı gün yeniden alınabilir
  expect((await al({ ad: 'Ali', tel: '05551112233', gun: YARIN(), saat: '15:00', hz: ['Vücut analizi'] })).s).toBe(200)
})

test('ders kaydı: telefon zorunlu, kontenjan, aynı kişi iki kez yazılmaz, iptal yer açar', async () => {
  const g = YARIN()
  expect((await ders({ d: 'pilates', gun: g, ad: 'Ayşe', tel: '' })).d.error).toBe('bad_phone')
  expect((await ders({ d: 'yok', gun: g, ad: 'Ayşe', tel: '05551112233' })).d.error).toBe('no_class')
  expect((await ders({ d: 'pilates', gun: addDay(G(), -1), ad: 'Ayşe', tel: '05551112233' })).d.error).toBe('past_date')
  const a = await ders({ d: 'pilates', gun: g, ad: 'Ayşe', tel: '05551112233' })
  expect(a.s).toBe(200)
  expect(a.d).toMatchObject({ ders: 'Pilates', saat: '21:00', gun: g })
  expect((await ders({ d: 'pilates', gun: g, ad: 'Ayşe', tel: '0555 111 22 33' })).d.error).toBe('double_class')
  expect((await ders({ d: 'pilates', gun: g, ad: 'Bora', tel: '05551112234' })).s).toBe(200)
  // Kontenjan 2: üçüncü kişi giremez
  expect((await ders({ d: 'pilates', gun: g, ad: 'Cem', tel: '05551112235' })).d.error).toBe('full')
  expect((await info()).dersler.find((o) => o.d === 'pilates' && o.gun === g).bos).toBe(0)
  // Randevularım ders kaydını gösterir, iptal edilir, yer açılır
  const b = (await J(await req(`/api/r/${KOD}/benim`, { tel: '05551112233' }))).d.list
  expect(b).toEqual([expect.objectContaining({ tip: 'd', hz: ['Pilates'], saat: '21:00', durum: 'bekliyor' })])
  expect((await J(await req(`/api/r/${KOD}/diptal`, { id: a.d.id, key: 'x' }))).s).toBe(403)
  expect((await J(await req(`/api/r/${KOD}/diptal`, { id: a.d.id, key: a.d.key }))).d.ok).toBe(true)
  expect((await info()).dersler.find((o) => o.d === 'pilates' && o.gun === g).bos).toBe(1)
  expect((await ders({ d: 'pilates', gun: g, ad: 'Cem', tel: '05551112235' })).s).toBe(200)
  // Panelden kayıt ve iptal; iptal "Geri al" kontenjan doluysa olmaz
  const y = await login('1111')
  let s = await st(y.token)
  expect(s.katilimlar.filter((k) => k.gun === g && k.durum === 'kayitli').length).toBe(2)
  expect((await act('katil', { d: 'pilates', gun: g, ad: 'Deniz', tel: '05551112236' }, y.token)).d.error).toBe('full')
  const cem = s.katilimlar.find((k) => k.ad === 'Cem')
  s = (await act('katiliptal', { id: cem.id }, y.token)).d
  expect((await act('katil', { d: 'pilates', gun: g, ad: 'Deniz', tel: '05551112236' }, y.token)).s).toBe(200)
  expect((await act('katilgerial', { id: cem.id }, y.token)).d.error).toBe('full')
  // Müşteri anahtarı panel durumuna sızmaz
  expect(JSON.stringify((await st(y.token)).katilimlar)).not.toContain('"k":')
})

test('grup dersi antrenörün randevu saatini kapatır', async () => {
  const g = YARIN()
  const bos = (await J(await req(`/api/r/${KOD}/bos?gun=${g}&per=can&sure=60`))).d.slotlar
  expect(bos.find((x) => x.s === '08:00').ok).toBe(false) // Can'ın yoga dersi
  expect(bos.find((x) => x.s === '09:00').ok).toBe(true)
  expect((await J(await req(`/api/r/${KOD}/bos?gun=${g}&per=ece&sure=60`))).d.slotlar.find((x) => x.s === '08:00').ok).toBe(true)
  expect((await al({ ad: 'Ali', tel: '05551112233', gun: g, saat: '08:00', hz: ['Vücut analizi'], per: 'can' })).d.error).toBe('slot_taken')
})

test('musaitMi: antrenör yokken tek kişilik gibi davranır', () => {
  const shop = normShop({})
  expect(musaitMi(shop, [], '', 600, 60)).toBe(true)
  expect(musaitMi(shop, [{ id: 'a', saat: '10:00', sure: 60, durum: 'bekliyor' }], '', 600, 60)).toBe(false)
  expect(musaitMi(shop, [{ id: 'a', saat: '10:00', sure: 60, durum: 'iptal' }], '', 600, 60)).toBe(true)
})

test('antrenör yalnızca kendi üyesini ve payını görür; ciro, gider ve başkasının primi gizli', async () => {
  const y = await login('1111')
  expect(y.rol).toBe('yon')
  const c = await login('2222')
  expect(c).toMatchObject({ rol: 'per', per: 'can' })
  const e = await login('3333')
  await act('kayit', { hz: ['Aylık üyelik'], od: 'nakit', mus: 'Can üyesi', tel: '05551110001' }, c.token)
  await act('kayit', { hz: ['Aylık üyelik'], od: 'kart', mus: 'Ece üyesi', tel: '05551110002' }, e.token)
  await act('kayit', { per: 'ece', hz: ['Su'], od: 'nakit' }, y.token)
  await act('gider', { tur: 'Kira', tutar: 5000 }, y.token)
  await al({ ad: 'Can müşteri', tel: '05551112233', gun: YARIN(), saat: '10:00', hz: ['Vücut analizi'], per: 'can' })
  await al({ ad: 'Ece müşteri', tel: '05551112234', gun: YARIN(), saat: '11:00', hz: ['Vücut analizi'], per: 'ece' })
  await al({ ad: 'Sahipsiz', tel: '05551112235', gun: YARIN(), saat: '12:00', hz: ['Vücut analizi'] })
  const s = await st(c.token)
  expect(s.uyeler.map((u) => u.ad)).toEqual(['Can üyesi'])
  expect(s.kayitlar.length).toBe(1)
  expect(s.kayitlar[0]).toMatchObject({ per: 'can', prim: 40, tutar: 1500 })
  expect(s.randevular.map((r) => r.ad).sort()).toEqual(['Can müşteri', 'Sahipsiz'])
  expect(s.giderler).toBeUndefined()
  expect(s.abonelik).toBeUndefined()
  expect(s.shop.personel.find((p) => p.id === 'ece').prim).toBeUndefined()
  expect(s.shop.personel.find((p) => p.id === 'can').prim).toBe(40)
  // Ece'nin dersi yok, Can'ın yoga dersi Can'da görünür; Ece'de görünmez
  expect(s.ders.some((o) => o.d === 'yoga')).toBe(true)
  expect((await st(e.token)).ders.some((o) => o.d === 'yoga')).toBe(false)
  // Başkasının üyesine dokunamaz, gider ekleyemez, ayar değiştiremez
  const ys = await st(y.token)
  expect(ys.uyeler.length).toBe(2)
  const eceUye = ys.uyeler.find((u) => u.ad === 'Ece üyesi')
  expect((await act('giris', { id: eceUye.id }, c.token)).d.error).toBe('not_yours')
  expect((await act('kayit', { hz: ['Aylık üyelik'], od: 'nakit', uye: eceUye.id }, c.token)).d.error).toBe('not_yours')
  expect((await act('gider', { tur: 'Kira', tutar: 1 }, c.token)).d.error).toBe('yonetici')
  expect((await act('ayar', { ad: 'X' }, c.token)).d.error).toBe('yonetici')
  expect((await act('uyesil', { id: eceUye.id }, c.token)).d.error).toBe('yonetici')
  expect((await act('personel', { ad: 'X', pin: '9999' }, c.token)).d.error).toBe('yonetici')
  const eceR = ys.randevular.find((r) => r.ad === 'Ece müşteri')
  expect((await act('geldi', { id: eceR.id, od: 'nakit' }, c.token)).d.error).toBe('not_yours')
  // Antrenörün satışı kendisine yazılır, per gönderse de
  const k = (await act('kayit', { per: 'ece', hz: ['Protein bar', 'Su'], od: 'kart' }, c.token)).d
  expect(k.kayitlar.find((x) => x.hz === 'Protein bar + Su')).toMatchObject({ per: 'can', tutar: 100 })
})

test('personel PIN yönetici PIN’inden ve diğer antrenörden farklı olmalı', async () => {
  const y = await login('1111')
  expect((await act('personel', { ad: 'Mert', pin: '1111' }, y.token)).d.error).toBe('same_pin_yon')
  expect((await act('personel', { ad: 'Mert', pin: '2222' }, y.token)).d.error).toBe('same_pin_other')
  const c = await login('2222')
  expect((await act('perpin', { pin: '1111' }, c.token)).d.error).toBe('same_pin_yon')
  expect((await act('perpin', { pin: '3333' }, c.token)).d.error).toBe('same_pin_other')
  expect((await act('perpin', { pin: '4444' }, c.token)).s).toBe(200)
  expect((await login('4444')).per).toBe('can')
  expect((await act('pin', { pin: '3333' }, y.token)).d.error).toBe('same_pin_per')
})

test('prim kişiye göre; yeni antrenör varsayılan %40', async () => {
  const y = await login('1111')
  let s = (await act('personel', { ad: 'Mert', pin: '5555' }, y.token)).d
  const m = s.shop.personel.find((p) => p.ad === 'Mert')
  expect(m.prim).toBe(40)
  s = (await act('personel', { id: m.id, ad: 'Mert', prim: 35 }, y.token)).d
  expect(s.shop.personel.find((p) => p.id === m.id).prim).toBe(35)
  expect((await act('personel', { id: m.id, ad: 'Mert', prim: 120 }, y.token)).d.error).toBe('bad_rate')
  await act('kayit', { per: 'ece', hz: ['Kişisel antrenman (tek ders)'], od: 'nakit' }, y.token)
  s = (await act('kayit', { per: m.id, hz: ['Kişisel antrenman (tek ders)'], od: 'kart' }, y.token)).d
  expect(s.kayitlar.map((k) => k.prim).sort()).toEqual([35, 50])
  // Yönetici antrenörsüz satış yapabilir (prim yok); antrenör yapamaz
  s = (await act('kayit', { per: '', hz: ['Su'], od: 'nakit' }, y.token)).d
  expect(s.kayitlar.find((k) => k.hz === 'Su')).toMatchObject({ per: '', prim: 0 })
  expect((await login('5555')).per).toBe(m.id)
})

test('üyelik ve paket satışı: üye adı zorunlu, bitiş tarihi ve paket ayarlanır, silinince geri döner', async () => {
  const y = await login('1111')
  const g = G()
  expect((await act('kayit', { per: 'can', hz: ['Aylık üyelik'], od: 'nakit' }, y.token)).d.error).toBe('no_member_name')
  let s = (await act('kayit', { per: 'can', hz: ['Aylık üyelik', 'PT 8 ders'], od: 'kart', mus: 'Emre', tel: '05557778899' }, y.token)).d
  let u = s.uyeler[0]
  expect(u).toMatchObject({ ad: 'Emre', per: 'can', bitis: addDay(g, 29), uyelik: 'Aylık üyelik', paket: { ad: 'PT 8 ders', kalan: 8, top: 8 } })
  expect(s.kayitlar[0]).toMatchObject({ tutar: 7500, uye: u.id, mus: 'Emre' })
  expect(s.kayitlar[0].once).toBeUndefined()
  // Aynı telefonla ikinci satış aynı karta işlenir, bitiş üstüne eklenir
  s = (await act('kayit', { per: 'can', hz: ['3 aylık üyelik'], od: 'nakit', mus: 'Emre', tel: '0555 777 88 99' }, y.token)).d
  expect(s.uyeler.length).toBe(1)
  expect(s.uyeler[0].bitis).toBe(addDay(g, 29 + 90))
  // İkinci satış silinince bitiş eski haline
  const k2 = s.kayitlar.find((k) => k.hz === '3 aylık üyelik')
  s = (await act('kayitsil', { id: k2.id }, y.token)).d
  expect(s.uyeler[0].bitis).toBe(addDay(g, 29))
  // İlk satış silinince yeni açılan üye kartı da kalkar
  s = (await act('kayitsil', { id: s.kayitlar[0].id }, y.token)).d
  expect(s.uyeler.length).toBe(0)
})

test('üyelik/paket randevusunda Geldi üye kartını açar, Geri al geri alır', async () => {
  const y = await login('1111')
  const g = G()
  const r = await al({ ad: 'Selin', tel: '05554443322', gun: YARIN(), saat: '18:00', hz: ['Aylık üyelik'] })
  env.DB.raw.query('UPDATE spor_randevu SET gun = ? WHERE id = ?').run(g, r.d.id)
  let s = (await act('geldi', { id: r.d.id, od: 'kart', per: 'ece' }, y.token)).d
  expect(s.randevular.find((x) => x.id === r.d.id).durum).toBe('geldi')
  expect(s.kayitlar[0]).toMatchObject({ per: 'ece', tutar: 1500, od: 'kart', rid: r.d.id, prim: 50 })
  expect(s.uyeler[0]).toMatchObject({ ad: 'Selin', tel: '05554443322', per: 'ece', bitis: addDay(g, 29) })
  expect((await act('geldi', { id: r.d.id, od: 'nakit' }, y.token)).s).toBe(409)
  s = (await act('gerial', { id: r.d.id }, y.token)).d
  expect(s.kayitlar.length).toBe(0)
  expect(s.uyeler.length).toBe(0)
  expect(s.randevular.find((x) => x.id === r.d.id).durum).toBe('bekliyor')
  // Mevcut üye: Geri al yalnızca bitişi geri çeker, kart durur
  await act('uye', { ad: 'Selin', tel: '05554443322', bitis: addDay(g, 5) }, y.token)
  s = (await act('geldi', { id: r.d.id, od: 'nakit', per: 'ece' }, y.token)).d
  expect(s.uyeler[0].bitis).toBe(addDay(g, 5 + 30))
  s = (await act('gerial', { id: r.d.id }, y.token)).d
  expect(s.uyeler.length).toBe(1)
  expect(s.uyeler[0].bitis).toBe(addDay(g, 5))
  expect((await act('geldi', { id: r.d.id, od: 'cek', per: 'ece' }, y.token)).d.error).toBe('bad_payment')
})

test('satisIsle / satisGeri: üyelik süresi devam ederken üstüne eklenir', () => {
  const u = { bitis: '2026-01-10', paket: { ad: 'PT', kalan: 2, top: 8 } }
  const f = satisIsle(u, [{ tur: 'uyelik', ad: 'Aylık', gun: 30 }, { tur: 'paket', ad: 'PT 8', seans: 8 }], '2026-01-01')
  expect(u.bitis).toBe('2026-02-09')
  expect(u.paket).toEqual({ ad: 'PT 8', kalan: 10, top: 10 })
  const u2 = { bitis: '2025-12-01' }
  satisIsle(u2, [{ tur: 'uyelik', ad: 'Aylık', gun: 30 }], '2026-01-01')
  expect(u2.bitis).toBe('2026-01-30')
  // Arada ders düşülmüşse yalnızca satılan kısım geri alınır
  u.paket.kalan = 9
  expect(satisGeri(u, { ...f })).toBe(false)
  expect(u.bitis).toBe('2026-01-10')
  expect(u.paket.kalan).toBe(1)
})

test('giriş kaydı, ders düşme, dondurma ve aidat', async () => {
  const y = await login('1111')
  const g = G()
  let s = (await act('uye', { ad: 'Kaan', tel: '05553332211', bitis: addDay(g, 10), kalan: 2, per: 'can' }, y.token)).d
  const u = s.uyeler[0]
  expect(u).toMatchObject({ per: 'can', bitis: addDay(g, 10), paket: { kalan: 2 } })
  expect((await act('uye', { ad: 'Başka', tel: '05553332211' }, y.token)).d.error).toBe('tel_taken')
  // Giriş: günde bir kez
  s = (await act('giris', { id: u.id }, y.token)).d
  expect(s.girisler.length).toBe(1)
  expect(s.uyeler[0].son).toBe(g)
  expect((await act('giris', { id: u.id }, y.token)).d.error).toBe('already_in')
  // Ders düş: paketten bir eksilir; yanlış giriş silinince geri gelir
  s = (await act('giris', { id: u.id, seans: true }, y.token)).d
  expect(s.uyeler[0].paket.kalan).toBe(1)
  const sg = s.girisler.find((x) => x.seans)
  s = (await act('girissil', { id: sg.id }, y.token)).d
  expect(s.uyeler[0].paket.kalan).toBe(2)
  // Dondurma: bitiş ileri kayar, dondurulmuşken giriş yok; erken bitirince kullanılmayan gün geri düşer
  s = (await act('dondur', { id: u.id, gun: 15 }, y.token)).d
  expect(s.uyeler[0].bitis).toBe(addDay(g, 25))
  expect(s.uyeler[0].don).toMatchObject({ bas: g, bit: addDay(g, 14), gun: 15 })
  expect((await act('giris', { id: u.id }, y.token)).d.error).toBe('frozen')
  expect((await act('dondur', { id: u.id, gun: 5 }, y.token)).d.error).toBe('frozen')
  s = (await act('coz', { id: u.id }, y.token)).d
  expect(s.uyeler[0].bitis).toBe(addDay(g, 10))
  expect(s.uyeler[0].don).toBeNull()
  expect((await act('dondur', { id: u.id, gun: 500 }, y.token)).d.error).toBe('bad_days')
  // Süresi biten üye: giriş yok, aidat alınınca bugünden başlar
  s = (await act('uye', { id: u.id, ad: 'Kaan', tel: '05553332211', bitis: addDay(g, -3), kalan: 0 }, y.token)).d
  expect(s.uyeler[0].paket).toBeNull()
  expect((await act('giris', { id: u.id }, y.token)).d.error).toBe('expired')
  expect((await act('dondur', { id: u.id, gun: 5 }, y.token)).d.error).toBe('expired')
  // Antrenör kendi üyesinden aidat alır
  const c = await login('2222')
  s = (await act('kayit', { hz: ['Aylık üyelik'], od: 'nakit', uye: u.id }, c.token)).d
  expect(s.uyeler[0].bitis).toBe(addDay(g, 29))
  expect(s.kayitlar[0]).toMatchObject({ per: 'can', uye: u.id, mus: 'Kaan' })
})

test('iş günü saati ayarlanır (varsayılan 00:00)', async () => {
  const y = await login('1111')
  let s = await st(y.token)
  expect(s.shop.gunbas).toBe('00:00')
  s = (await act('ayar', { gunbas: '04:00', acilis: '06:00', kapanis: '02:00', aralik: 60 }, y.token)).d
  expect(s.shop.gunbas).toBe('04:00')
  expect(s.shop.slotlar[0]).toBe('06:00')
  expect(s.shop.slotlar.at(-1)).toBe('01:00')
  expect((await act('ayar', { gunbas: '25:00' }, y.token)).d.error).toBe('bad_time')
  expect(isGunu('04:00', Date.UTC(2026, 0, 10, 0, 30)).gun).toBe('2026-01-09')
  expect(isGunu('00:00', Date.UTC(2026, 0, 9, 21, 30)).gun).toBe('2026-01-10')
  expect(slotlar(normShop({ acilis: '09:00', kapanis: '11:00', aralik: 30 }))).toEqual(['09:00', '09:30', '10:00', '10:30'])
})

test('kalem listesi ve ders programı düzenlenir', async () => {
  const y = await login('1111')
  let s = (await act('ayar', { hizmetler: [{ ad: '2 aylık', kat: 'Üyelik', tur: 'uyelik', fiyat: 2800, gun: 60 }, { ad: 'Su', kat: 'Ürün', tur: 'urun', fiyat: 20 }, { ad: 'İkram', tur: 'urun', fiyat: 0 }] }, y.token)).d
  expect(s.shop.hizmetler).toEqual([{ ad: '2 aylık', kat: 'Üyelik', tur: 'uyelik', fiyat: 2800, sure: 30, gun: 60 }, { ad: 'Su', kat: 'Ürün', tur: 'urun', fiyat: 20 }, { ad: 'İkram', kat: 'Diğer', tur: 'urun', fiyat: 0 }])
  expect((await act('ayar', { hizmetler: [{ ad: 'X', tur: 'uyelik', fiyat: 1, gun: 0 }] }, y.token)).d.error).toBe('bad_days')
  expect((await act('ayar', { hizmetler: [{ ad: 'X', tur: 'paket', fiyat: 1 }] }, y.token)).d.error).toBe('bad_sessions')
  expect((await act('ayar', { hizmetler: [{ ad: 'X', fiyat: 1 }, { ad: 'X', fiyat: 2 }] }, y.token)).d.error).toBe('bad_services')
  s = (await act('ayar', { varsayilan: true }, y.token)).d
  expect(s.shop.hizmetler.length).toBe(VARSAYILAN_HIZMET.length)
  s = (await act('ayar', { dersler: [{ ad: 'Kick boks', gunler: [2, 4], saat: '19:30', sure: 60, kont: 8, per: 'ece' }, { ad: 'Kick boks', gunler: [6], saat: '10:00', sure: 60, kont: 8, per: 'yok' }] }, y.token)).d
  expect(s.shop.dersler[0]).toEqual({ id: 'kick-boks', ad: 'Kick boks', gunler: [2, 4], saat: '19:30', sure: 60, per: 'ece', kont: 8 })
  expect(s.shop.dersler[1].id).not.toBe('kick-boks')
  expect(s.shop.dersler[1].per).toBe('')
  expect((await act('ayar', { dersler: [{ ad: 'A', gunler: [], saat: '10:00', sure: 60, kont: 8 }] }, y.token)).d.error).toBe('no_days')
  expect((await act('ayar', { dersler: [{ ad: 'A', gunler: [1], saat: '10:00', sure: 60, kont: 0 }] }, y.token)).d.error).toBe('bad_capacity')
})

test('gider ve net kâr verisi yalnızca yöneticide; gider silinir', async () => {
  const y = await login('1111')
  let s = (await act('gider', { tur: 'Ekipman', tutar: '1250,50', not: 'dambıl' }, y.token)).d
  expect(s.giderler[0]).toMatchObject({ tur: 'Ekipman', tutar: 1250.5, not: 'dambıl' })
  s = (await act('gidersil', { id: s.giderler[0].id }, y.token)).d
  expect(s.giderler.length).toBe(0)
})

test('PIN: yanlış PIN sınırı', async () => {
  for (let i = 0; i < 8; i++) expect((await J(await req(`/api/s/${KOD}/login`, { pin: '9999' }, null, '1.1.1.1'))).d.error).toBe('wrong_pin')
  expect((await J(await req(`/api/s/${KOD}/login`, { pin: '1111' }, null, '1.1.1.1'))).d.error).toBe('too_many')
  expect((await J(await req(`/api/s/${KOD}/info`))).d).toEqual({ ad: 'Atlas Spor Salonu', kurulu: true })
})

test('abonelik: süresi biten ya da durdurulan salon kapanır (402), kayıtlar durur', async () => {
  await setup({ dur: true })
  expect((await J(await req(`/api/r/${KOD}/info`))).s).toBe(402)
  expect((await J(await req(`/api/s/${KOD}/login`, { pin: '1111' }))).s).toBe(402)
  await setup({ bitis: '2020-01-01' })
  const r = await J(await req(`/api/r/${KOD}/info`))
  expect(r.s).toBe(402)
  expect(r.d.ad).toBe('Atlas Spor Salonu')
})

test('çok şubeli işletme: merkez PIN’iyle özet ve yeni şube', async () => {
  const y = await login('1111')
  await act('kayit', { per: 'can', hz: ['Aylık üyelik'], od: 'nakit', mus: 'Emre' }, y.token)
  expect((await J(await req(`/api/s/${KOD}/isl/ozet`, undefined, y.token))).s).toBe(401)
  const i = await login('1111', 'isl')
  expect(i.rol).toBe('isl')
  const n = await J(await req(`/api/s/${KOD}/isl/sube`, { ad: 'Atlas Spor Kadıköy', pin: '7777' }, i.token))
  expect(n.d.kod).toBe('atlas-spor-kadikoy')
  expect((await J(await req(`/api/s/${KOD}/isl/sube`, { ad: 'Atlas Spor Kadıköy', pin: '7777' }, i.token))).d.error).toBe('kod_taken')
  const o = (await J(await req(`/api/s/${KOD}/isl/ozet`, undefined, i.token))).d
  expect(o.subeler.map((s) => s.kod)).toEqual(['atlas-spor', 'atlas-spor-kadikoy'])
  expect(o.subeler[0]).toMatchObject({ uye: 1, personel: 2 })
  expect(o.subeler[0].kayit.length).toBe(1)
  const p = JSON.parse(env.DB.raw.query("SELECT data FROM plat_shops WHERE kod = 'atlas-spor-kadikoy'").get().data)
  expect(p).toMatchObject({ sektor: 'Spor Salonu', isl: 'Atlas Spor Salonu', bitis: '2099-01-01' })
  // Şube kendi PIN'iyle açılır, kalemler ve ders programı merkezden gelir (antrenörsüz)
  const sb = (await J(await req('/api/s/atlas-spor-kadikoy/login', { pin: '7777' }))).d
  const ss = (await J(await req('/api/s/atlas-spor-kadikoy/state', undefined, sb.token))).d
  expect(ss.shop.hizmetler.length).toBe(VARSAYILAN_HIZMET.length)
  expect(ss.shop.dersler.map((d) => d.per)).toEqual(['', ''])
  expect(ss.shop.cokSube).toBe(true)
  expect((await J(await req(`/api/s/${KOD}/state`, undefined, sb.token))).s).toBe(401)
})

test('kurulmamış salon: sahip panelinde kayıtlı ama tablo satırı yok → hazırlanıyor', async () => {
  env.DB.raw.query("INSERT INTO plat_shops (id, kod, data) VALUES ('x', 'yeni-spor', ?)").run(JSON.stringify({ ad: 'Yeni Spor', sektor: 'Spor Salonu', bitis: '2099-01-01', kod: 'yeni-spor' }))
  const r = await J(await req('/api/r/yeni-spor/info'))
  expect(r).toEqual({ s: 409, d: { error: 'setup', ad: 'Yeni Spor' } })
  expect((await J(await req('/api/r/yok/info'))).s).toBe(404)
})
