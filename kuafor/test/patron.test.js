// Sahip paneli (güzellik uygulamasının /patron sunucusu) ile Kuaförüm'ün birlikte çalışması
//   PATRON_WORKER=../dist-worker/_worker.js bun test
import { test, expect } from 'bun:test'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { makeDB } from './d1.js'
import { hashPin } from '../src/server.js'
const PW = process.env.PATRON_WORKER && resolve(process.env.PATRON_WORKER)
test.skipIf(!PW || !existsSync(PW))('sahip paneli kuaför PIN verir, durdurur, ilave şubeyi gösterir', async () => {
  const patron = (await import(PW)).default
  const kuafor = (await import('../dist/_worker.js')).default
  const env = { DB: makeDB() }
  env.DB.raw.query("INSERT INTO secrets (key, hash) VALUES ('platform', ?)").run(await hashPin('654321'))
  const call = async (w, path, body, tok) => { const r = await w.fetch(new Request('https://x' + path, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined }), env); return { s: r.status, d: await r.json() } }
  const t = (await call(patron, '/api/patron/login', { pin: '654321' })).d.token
  let st = (await call(patron, '/api/patron/state', undefined, t)).d
  expect(st.ayar.kuafor).toBe('https://kuaforum.pages.dev')
  const sk = st.salonlar.find((s) => s.kod === 'selin-kuafor')
  expect(sk).toMatchObject({ ad: 'Selin Kuaför', sektor: 'Bayan Kuaför', deneme: true })
  expect(st.kuaforKurulu).toEqual([])
  // PIN yokken panel girişi olmaz, müşteri sayfası açılır
  expect((await call(kuafor, '/api/s/selin-kuafor/info')).d.kurulu).toBe(false)
  expect((await call(kuafor, '/api/s/selin-kuafor/login', { pin: '1234' })).d.error).toBe('wrong_pin')
  expect((await call(kuafor, '/api/r/selin-kuafor/info')).s).toBe(200)
  st = (await call(patron, '/api/patron/kuafor-pin', { id: sk.id, yon: '1234' }, t)).d
  expect(st.kuaforKurulu).toContain('selin-kuafor')
  const y = (await call(kuafor, '/api/s/selin-kuafor/login', { pin: '1234' })).d
  expect(y.rol).toBe('yon')
  await call(kuafor, '/api/s/selin-kuafor/personel', { ad: 'Ayşe', pin: '5678' }, y.token)
  // Yönetici PIN'i personel PIN'iyle aynı verilemez; başka sektöre kuaför PIN'i verilmez
  expect((await call(patron, '/api/patron/kuafor-pin', { id: sk.id, yon: '5678' }, t)).d.error).toBe('same_pin')
  expect((await call(patron, '/api/patron/berber-pin', { id: sk.id, yon: '9876' }, t)).d.error).toBe('not_berber')
  const fb = st.salonlar.find((s) => s.kod === 'fatih-berber')
  if (fb) expect((await call(patron, '/api/patron/kuafor-pin', { id: fb.id, yon: '9876' }, t)).d.error).toBe('not_kuafor')
  // Durdur → kapanır, yeniden aç → açılır
  await call(patron, '/api/patron/stop', { id: sk.id }, t)
  expect((await call(kuafor, '/api/s/selin-kuafor/state', undefined, y.token)).s).toBe(402)
  expect((await call(kuafor, '/api/r/selin-kuafor/info')).s).toBe(402)
  await call(patron, '/api/patron/stop', { id: sk.id }, t)
  expect((await call(kuafor, '/api/s/selin-kuafor/state', undefined, y.token)).s).toBe(200)
  // Süre bitince kapanır, ödeme alınca açılır
  await call(patron, '/api/patron/shop', { ...sk, bitis: '2020-01-01' }, t)
  expect((await call(kuafor, '/api/r/selin-kuafor/info')).s).toBe(402)
  await call(patron, '/api/patron/pay', { id: sk.id, tutar: 500, ay: 1, y: 'Havale' }, t)
  expect((await call(kuafor, '/api/r/selin-kuafor/info')).s).toBe(200)
  // Kuaför uygulamadan şube açar → sahip panelinde aynı işletme adıyla, ilave şube ücretiyle görünür
  const isl = (await call(kuafor, '/api/s/selin-kuafor/login', { pin: '1234', rol: 'isl' })).d
  expect((await call(kuafor, '/api/s/selin-kuafor/isl/sube', { ad: 'Selin Kuaför Kadıköy', pin: '4321' }, isl.token)).d.kod).toBe('selin-kuafor-kadikoy')
  st = (await call(patron, '/api/patron/state', undefined, t)).d
  const k = st.salonlar.find((s) => s.kod === 'selin-kuafor-kadikoy')
  expect(k).toMatchObject({ sektor: 'Bayan Kuaför', isl: 'Selin Kuaför' })
  expect(st.salonlar.find((s) => s.kod === 'selin-kuafor').isl).toBe('Selin Kuaför')
  expect(st.ayar.sube).toBeGreaterThan(0)
  expect(st.kuaforKurulu).toContain('selin-kuafor-kadikoy')
  // Şube ayrı durdurulur; merkez açık kalır
  await call(patron, '/api/patron/stop', { id: k.id }, t)
  expect((await call(kuafor, '/api/r/selin-kuafor-kadikoy/info')).s).toBe(402)
  expect((await call(kuafor, '/api/r/selin-kuafor/info')).s).toBe(200)
})
