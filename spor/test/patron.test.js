// Sahip paneli (güzellik uygulamasının /patron sunucusu) ile Sporum'un birlikte çalışması
//   PATRON_WORKER=../dist-worker/_worker.js bun test
import { test, expect } from 'bun:test'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { makeDB } from './d1.js'
import { hashPin } from '../src/server.js'
const PW = process.env.PATRON_WORKER && resolve(process.env.PATRON_WORKER)
test.skipIf(!PW || !existsSync(PW))('sahip paneli spor salonu PIN verir, durdurur, ilave şubeyi gösterir', async () => {
  const patron = (await import(PW)).default
  const spor = (await import('../dist/_worker.js')).default
  const env = { DB: makeDB() }
  env.DB.raw.query("INSERT INTO secrets (key, hash) VALUES ('platform', ?)").run(await hashPin('654321'))
  const call = async (w, path, body, tok) => { const r = await w.fetch(new Request('https://x' + path, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined }), env); return { s: r.status, d: await r.json() } }
  const t = (await call(patron, '/api/patron/login', { pin: '654321' })).d.token
  let st = (await call(patron, '/api/patron/state', undefined, t)).d
  expect(st.ayar.spor).toBe('https://sporum.pages.dev')
  const sk = st.salonlar.find((s) => s.kod === 'atlas-spor')
  expect(sk).toMatchObject({ ad: 'Atlas Spor Salonu', sektor: 'Spor Salonu', deneme: true })
  expect(st.sporKurulu).toEqual([])
  // PIN yokken panel girişi olmaz, müşteri sayfası açılır
  expect((await call(spor, '/api/s/atlas-spor/info')).d.kurulu).toBe(false)
  expect((await call(spor, '/api/s/atlas-spor/login', { pin: '1234' })).d.error).toBe('wrong_pin')
  expect((await call(spor, '/api/r/atlas-spor/info')).s).toBe(200)
  st = (await call(patron, '/api/patron/spor-pin', { id: sk.id, yon: '1234' }, t)).d
  expect(st.sporKurulu).toContain('atlas-spor')
  const y = (await call(spor, '/api/s/atlas-spor/login', { pin: '1234' })).d
  expect(y.rol).toBe('yon')
  await call(spor, '/api/s/atlas-spor/personel', { ad: 'Can', pin: '5678' }, y.token)
  // Yönetici PIN'i personel PIN'iyle aynı verilemez; başka sektöre spor PIN'i verilmez
  expect((await call(patron, '/api/patron/spor-pin', { id: sk.id, yon: '5678' }, t)).d.error).toBe('same_pin')
  expect((await call(patron, '/api/patron/berber-pin', { id: sk.id, yon: '9876' }, t)).d.error).toBe('not_berber')
  const fb = st.salonlar.find((s) => s.kod === 'fatih-berber')
  if (fb) expect((await call(patron, '/api/patron/spor-pin', { id: fb.id, yon: '9876' }, t)).d.error).toBe('not_spor')
  // Durdur → kapanır, yeniden aç → açılır
  await call(patron, '/api/patron/stop', { id: sk.id }, t)
  expect((await call(spor, '/api/s/atlas-spor/state', undefined, y.token)).s).toBe(402)
  expect((await call(spor, '/api/r/atlas-spor/info')).s).toBe(402)
  await call(patron, '/api/patron/stop', { id: sk.id }, t)
  expect((await call(spor, '/api/s/atlas-spor/state', undefined, y.token)).s).toBe(200)
  // Süre bitince kapanır, ödeme alınca açılır
  await call(patron, '/api/patron/shop', { ...sk, bitis: '2020-01-01' }, t)
  expect((await call(spor, '/api/r/atlas-spor/info')).s).toBe(402)
  await call(patron, '/api/patron/pay', { id: sk.id, tutar: 500, ay: 1, y: 'Havale' }, t)
  expect((await call(spor, '/api/r/atlas-spor/info')).s).toBe(200)
  // Salon uygulamadan şube açar → sahip panelinde aynı işletme adıyla, ilave şube ücretiyle görünür
  const isl = (await call(spor, '/api/s/atlas-spor/login', { pin: '1234', rol: 'isl' })).d
  expect((await call(spor, '/api/s/atlas-spor/isl/sube', { ad: 'Atlas Spor Kadıköy', pin: '4321' }, isl.token)).d.kod).toBe('atlas-spor-kadikoy')
  st = (await call(patron, '/api/patron/state', undefined, t)).d
  const k = st.salonlar.find((s) => s.kod === 'atlas-spor-kadikoy')
  expect(k).toMatchObject({ sektor: 'Spor Salonu', isl: 'Atlas Spor Salonu' })
  expect(st.salonlar.find((s) => s.kod === 'atlas-spor').isl).toBe('Atlas Spor Salonu')
  expect(st.ayar.sube).toBeGreaterThan(0)
  expect(st.sporKurulu).toContain('atlas-spor-kadikoy')
  // Şube ayrı durdurulur; merkez açık kalır
  await call(patron, '/api/patron/stop', { id: k.id }, t)
  expect((await call(spor, '/api/r/atlas-spor-kadikoy/info')).s).toBe(402)
  expect((await call(spor, '/api/r/atlas-spor/info')).s).toBe(200)
})
