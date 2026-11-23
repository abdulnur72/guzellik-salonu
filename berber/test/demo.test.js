import { test, expect, beforeEach } from 'bun:test'
import { readFileSync } from 'node:fs'
import { makeDB } from './d1.js'
import { makeWorker, hashPin, isGunu, addDay, DEMO_SHOPS } from '../src/server.js'

// Demo dükkânı (berber-demo): db/0005_berber_demo.sql ile kurulur
const W = makeWorker('<html><script>/*__BOOT__*/</script>app</html>')
const DEMO = 'berber-demo'
const FATIH = 'fatih-berber'
let env, ipn = 0
const req = (path, body, tok, ip) =>
  W.fetch(new Request('https://x.dev' + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip || '10.1.0.' + (ipn++ % 250), ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }), env)
const J = async (r) => ({ s: r.status, d: await r.json() })
const login = async (kod, b, ip) => J(await req(`/api/s/${kod}/login`, b, undefined, ip))
const act = async (kod, a, b, tok) => J(await req(`/api/s/${kod}/${a}`, b, tok))
const state = async (kod, tok) => J(await req(`/api/s/${kod}/state`, undefined, tok))
const secrets = () => env.DB.raw.query('SELECT key, hash FROM secrets ORDER BY key').all()

beforeEach(async () => {
  env = { DB: makeDB() }
  const db = env.DB.raw
  // Gerçek dükkân: Fatih Berber, yönetici 1111, personel Ali 2222
  db.query('UPDATE berber_shops SET data = ? WHERE kod = ?').run(JSON.stringify({ ad: 'Fatih Berber', personel: [{ id: 'ali', ad: 'Ali', prim: 40, aktif: true }] }), FATIH)
  db.query('INSERT INTO secrets (key, hash) VALUES (?, ?)').run('berber:yon:' + FATIH, await hashPin('1111'))
  db.query('INSERT INTO secrets (key, hash) VALUES (?, ?)').run('berber:per:' + FATIH + ':ali', await hashPin('2222'))
  db.exec(readFileSync('db/0005_berber_demo.sql', 'utf8'))
})

test('demo listesi yalnızca berber-demo', () => {
  expect([...DEMO_SHOPS]).toEqual(['berber-demo'])
})

test('veri dosyası: 1 yıl deneme, telefon boş, sahte müşteri telefonları, yalnızca demo satırları', () => {
  const db = env.DB.raw
  const p = JSON.parse(db.query("SELECT data FROM plat_shops WHERE kod = 'berber-demo'").get().data)
  expect(p.ad).toBe('Demo Berber Salonu')
  expect(p.tel).toBe('')
  expect(p.dur).toBe(false)
  const gun = Math.round((new Date(p.bitis) - new Date(new Date().toISOString().slice(0, 10))) / 86400000)
  expect(gun).toBeGreaterThanOrEqual(365)
  const shop = JSON.parse(db.query("SELECT data FROM berber_shops WHERE kod = 'berber-demo'").get().data)
  expect(shop.wa).toBe('')
  expect(shop.personel.map((x) => x.ad)).toEqual(['Ahmet', 'Mehmet', 'Can'])
  expect(shop.hizmetler.length).toBe(6)
  const tels = db.query("SELECT data FROM berber_randevu WHERE kod = 'berber-demo'").all().map((r) => JSON.parse(r.data).tel)
  expect(tels.length).toBe(8)
  for (const t of tels) expect(t).toMatch(/^0000 000 00 0[1-8]$/)
  // Personelin PIN'i yok, yalnızca yönetici PIN'i
  expect(secrets().filter((s) => s.key.includes('berber-demo')).map((s) => s.key)).toEqual(['berber:yon:berber-demo'])
  // İkinci kez çalıştırmak bir şey eklemez
  const n = () => db.query("SELECT COUNT(*) AS n FROM berber_kayit WHERE kod = 'berber-demo'").get().n
  const once = n()
  db.exec(readFileSync('db/0005_berber_demo.sql', 'utf8'))
  expect(n()).toBe(once)
})

test('veri dosyası Fatih Berber satırlarını ve PIN özetlerini değiştirmez', async () => {
  const e = { DB: makeDB() }
  const db = e.DB.raw
  db.query('INSERT INTO secrets (key, hash) VALUES (?, ?)').run('berber:yon:' + FATIH, 'x$y')
  const dump = () => JSON.stringify(['plat_shops', 'berber_shops', 'secrets', 'berber_randevu', 'berber_kayit', 'berber_gider', 'berber_sira'].map((t) => db.query(`SELECT * FROM ${t} WHERE ${t === 'secrets' ? 'key' : 'kod'} NOT LIKE '%berber-demo%' ORDER BY 1`).all()))
  const once = dump()
  db.exec(readFileSync('db/0005_berber_demo.sql', 'utf8'))
  expect(dump()).toBe(once)
  // Dosyada güncelleme ya da silme komutu yok (yorum satırları hariç)
  const sql = readFileSync('db/0005_berber_demo.sql', 'utf8').split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')
  expect(sql).not.toMatch(/\b(UPDATE|DELETE|DROP|REPLACE INTO)\b/i)
})

test('demo: giriş ekranı personel adlarını verir; personel PIN siz girer, yalnızca kendini görür', async () => {
  const info = await J(await req(`/api/s/${DEMO}/info`))
  expect(info.d).toEqual({ ad: 'Demo Berber Salonu', demo: true, personel: [{ id: 'ahmet', ad: 'Ahmet' }, { id: 'mehmet', ad: 'Mehmet' }, { id: 'can', ad: 'Can' }] })
  const r = await login(DEMO, { rol: 'per', per: 'ahmet' })
  expect(r.s).toBe(200)
  expect(r.d.rol).toBe('per')
  const s = await state(DEMO, r.d.token)
  expect(s.s).toBe(200)
  expect(s.d.demo).toBe(true)
  expect(s.d.me).toBe('ahmet')
  expect(s.d.giderler).toBeUndefined()
  expect(s.d.kayitlar.every((k) => k.per === 'ahmet')).toBe(true)
  expect(s.d.randevular.length).toBeGreaterThan(0)
  // Personel kayıt girebilir
  const k = await act(DEMO, 'kayit', { hz: 'Sakal', od: 'nakit' }, r.d.token)
  expect(k.s).toBe(200)
  // Olmayan personel giremez
  expect((await login(DEMO, { rol: 'per', per: 'yok' })).s).toBe(404)
})

test('demo: Yönetici PIN ister (1234), yanlış PIN reddedilir', async () => {
  expect((await login(DEMO, { pin: '9999', rol: 'yon' })).s).toBe(403)
  expect((await login(DEMO, { pin: '9999' })).s).toBe(403)
  const y = await login(DEMO, { pin: '1234', rol: 'yon' })
  expect(y.s).toBe(200)
  expect(y.d.rol).toBe('yon')
  const s = await state(DEMO, y.d.token)
  expect(s.d.giderler.length).toBe(2)
  expect(s.d.abonelik.deneme).toBe(true)
  // Personel oturumuyla yöneticinin işleri yapılamaz
  const p = await login(DEMO, { rol: 'per', per: 'can' })
  expect((await act(DEMO, 'gider', { tur: 'Kira', tutar: 100 }, p.d.token)).s).toBe(403)
})

test('demo: İşletme kapalı (giriş ve özet), PIN değiştirilemez', async () => {
  expect((await login(DEMO, { pin: '1234', rol: 'isl' })).d.error).toBe('demo_closed')
  expect((await J(await req(`/api/s/${DEMO}/isl/ozet`))).d.error).toBe('demo_closed')
  const y = await login(DEMO, { pin: '1234', rol: 'yon' })
  expect((await act(DEMO, 'pin', { pin: '5678' }, y.d.token)).d.error).toBe('demo_closed')
  expect((await act(DEMO, 'perpin', { id: 'ahmet', pin: '5678' }, y.d.token)).d.error).toBe('demo_closed')
  const p = await login(DEMO, { rol: 'per', per: 'ahmet' })
  expect((await act(DEMO, 'perpin', { pin: '5678' }, p.d.token)).d.error).toBe('demo_closed')
  // 1234 hâlâ geçerli
  expect((await login(DEMO, { pin: '1234', rol: 'yon' })).s).toBe(200)
  // Yönetici PIN'siz yeni personel ekleyebilir, PIN kaydedilmez
  const n = await act(DEMO, 'personel', { ad: 'Yeni' }, y.d.token)
  expect(n.s).toBe(200)
  expect(secrets().filter((s) => s.key.startsWith('berber:per:berber-demo')).length).toBe(0)
})

test('demo: dükkân geneli yanlış PIN kilidi yok, kişi başı sınır var', async () => {
  for (let i = 0; i < 45; i++) await login(DEMO, { pin: '0000', rol: 'yon' }, '10.9.' + Math.floor(i / 5) + '.' + i)
  expect((await login(DEMO, { pin: '1234', rol: 'yon' }, '10.8.0.1')).s).toBe(200)
  for (let i = 0; i < 8; i++) await login(DEMO, { pin: '0000', rol: 'yon' }, '10.7.0.1')
  expect((await login(DEMO, { pin: '1234', rol: 'yon' }, '10.7.0.1')).s).toBe(429)
})

test('Fatih Berber değişmedi: PIN siz giriş yok, İşletme açık, PIN değiştirilebilir, dükkân kilidi var', async () => {
  const info = await J(await req(`/api/s/${FATIH}/info`))
  expect(info.d).toEqual({ ad: 'Fatih Berber' })
  expect((await login(FATIH, { rol: 'per', per: 'ali' })).s).toBe(403)
  expect((await login(FATIH, { pin: '2222' })).d.rol).toBe('per')
  const y = await login(FATIH, { pin: '1111', rol: 'yon' })
  expect(y.d.rol).toBe('yon')
  expect((await state(FATIH, y.d.token)).d.demo).toBe(false)
  expect((await login(FATIH, { pin: '1111', rol: 'isl' })).d.rol).toBe('isl')
  // Yönetici, personelin PIN'ini yenileyebilir; yeni personel PIN'siz eklenemez
  expect((await act(FATIH, 'perpin', { id: 'ali', pin: '3333' }, y.d.token)).s).toBe(200)
  expect((await act(FATIH, 'personel', { ad: 'Veli' }, y.d.token)).d.error).toBe('bad_pin')
  // Dükkân geneli kilit: 40 yanlış denemeden sonra doğru PIN de beklemeye alınır
  for (let i = 0; i < 40; i++) await login(FATIH, { pin: '0000', rol: 'yon' }, '10.6.' + Math.floor(i / 5) + '.' + i)
  expect((await login(FATIH, { pin: '1111', rol: 'yon' }, '10.5.0.1')).s).toBe(429)
})

test('demo verisi: bugünkü randevular ve ciro iş gününe göre', async () => {
  const g = isGunu('06:00').gun
  const rows = env.DB.raw.query("SELECT gun FROM berber_randevu WHERE kod = 'berber-demo'").all().map((r) => r.gun)
  expect(rows.filter((x) => x === g).length).toBe(5)
  expect(rows.filter((x) => x === addDay(g, 1)).length).toBe(3)
})
