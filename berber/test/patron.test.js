// Sahip paneli (güzellik uygulamasının /patron sunucusu) ile Berberim'in birlikte çalışması
//   PATRON_WORKER=../dist-worker/_worker.js bun test
import { test, expect } from 'bun:test'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { makeDB } from './d1.js'
import { hashPin } from '../src/server.js'
const PW = process.env.PATRON_WORKER && resolve(process.env.PATRON_WORKER)
test.skipIf(!PW || !existsSync(PW))('sahip paneli berber PIN verir, durdurur, ilave şubeyi gösterir', async () => {
  const patron = (await import(PW)).default
  const berber = (await import('../dist/_worker.js')).default
  const env = { DB: makeDB() }
  env.DB.raw.query("INSERT INTO secrets (key, hash) VALUES ('platform', ?)").run(await hashPin('654321'))
  const call = async (w, path, body, tok) => { const r = await w.fetch(new Request('https://x' + path, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined }), env); return { s: r.status, d: await r.json() } }
  const t = (await call(patron, '/api/patron/login', { pin: '654321' })).d.token
  let st = (await call(patron, '/api/patron/state', undefined, t)).d
  expect(st.ayar.berber).toBe('https://berberim.pages.dev')
  const fb = st.salonlar.find((s) => s.kod === 'fatih-berber')
  expect(fb).toMatchObject({ ad: 'Fatih Berber', sektor: 'Berber', deneme: true })
  expect(st.berberKurulu).toEqual([])
  // PIN yokken panel girişi olmaz, müşteri sayfası açılır
  expect((await call(berber, '/api/s/fatih-berber/login', { pin: '1234' })).d.error).toBe('wrong_pin')
  expect((await call(berber, '/api/r/fatih-berber/info')).s).toBe(200)
  st = (await call(patron, '/api/patron/berber-pin', { id: fb.id, yon: '1234' }, t)).d
  expect(st.berberKurulu).toContain('fatih-berber')
  const y = (await call(berber, '/api/s/fatih-berber/login', { pin: '1234' })).d
  expect(y.rol).toBe('yon')
  await call(berber, '/api/s/fatih-berber/personel', { ad: 'Ali', pin: '5678' }, y.token)
  // Yönetici PIN'i personel PIN'iyle aynı verilemez
  expect((await call(patron, '/api/patron/berber-pin', { id: fb.id, yon: '5678' }, t)).d.error).toBe('same_pin')
  expect((await call(patron, '/api/patron/hali-pin', { id: fb.id, yon: '1', per: '2' }, t)).d.error).toBe('not_hali')
  // Durdur → kapanır, yeniden aç → açılır
  await call(patron, '/api/patron/stop', { id: fb.id }, t)
  expect((await call(berber, '/api/s/fatih-berber/state', undefined, y.token)).s).toBe(402)
  expect((await call(berber, '/api/r/fatih-berber/info')).s).toBe(402)
  await call(patron, '/api/patron/stop', { id: fb.id }, t)
  expect((await call(berber, '/api/s/fatih-berber/state', undefined, y.token)).s).toBe(200)
  // Süre bitince kapanır, ödeme alınca açılır
  await call(patron, '/api/patron/shop', { ...fb, bitis: '2020-01-01' }, t)
  expect((await call(berber, '/api/r/fatih-berber/info')).s).toBe(402)
  await call(patron, '/api/patron/pay', { id: fb.id, tutar: 500, ay: 1, y: 'Havale' }, t)
  expect((await call(berber, '/api/r/fatih-berber/info')).s).toBe(200)
  // Berber uygulamadan şube açar → sahip panelinde aynı işletme adıyla, ilave şube ücretiyle görünür
  const isl = (await call(berber, '/api/s/fatih-berber/login', { pin: '1234', rol: 'isl' })).d
  expect((await call(berber, '/api/s/fatih-berber/isl/sube', { ad: 'Fatih Berber Kadıköy', pin: '4321' }, isl.token)).d.kod).toBe('fatih-berber-kadikoy')
  st = (await call(patron, '/api/patron/state', undefined, t)).d
  const k = st.salonlar.find((s) => s.kod === 'fatih-berber-kadikoy')
  expect(k).toMatchObject({ sektor: 'Berber', isl: 'Fatih Berber' })
  expect(st.salonlar.find((s) => s.kod === 'fatih-berber').isl).toBe('Fatih Berber')
  expect(st.ayar.sube).toBe(300)
  expect(st.berberKurulu).toContain('fatih-berber-kadikoy')
  // Şube ayrı durdurulur; merkez açık kalır
  await call(patron, '/api/patron/stop', { id: k.id }, t)
  expect((await call(berber, '/api/r/fatih-berber-kadikoy/info')).s).toBe(402)
  expect((await call(berber, '/api/r/fatih-berber/info')).s).toBe(200)
})
