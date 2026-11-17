// Sahip paneli (güzellik uygulamasının /patron sunucusu) ile halı uygulamasının birlikte çalışması
import { test, expect } from 'bun:test'
import { existsSync } from 'node:fs'
import { makeDB } from './d1.js'
import { hashPin } from '../src/server.js'
const PW = process.env.PATRON_WORKER
test.skipIf(!PW || !existsSync(PW))('sahip paneli halıcı ekler, PIN verir, durdurur', async () => {
  const patron = (await import(PW)).default
  const hali = (await import('../dist/_worker.js')).default
  const env = { DB: makeDB() }
  env.DB.raw.query("INSERT INTO secrets (key, hash) VALUES ('platform', ?)").run(await hashPin('654321'))
  const call = async (w, path, body, tok) => { const r = await w.fetch(new Request('https://x' + path, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body ? JSON.stringify(body) : undefined }), env); return { s: r.status, d: await r.json() } }
  const t = (await call(patron, '/api/patron/login', { pin: '654321' })).d.token
  let st = (await call(patron, '/api/patron/add', { ad: 'Deneme Halı', sektor: 'Halı Yıkama', tel: '05320000000', paket: 'p1', kod: 'deneme-hali' }, t)).d
  expect(st.ayar.hali).toBe('https://hali-yikama-c86.pages.dev')
  const id = st.salonlar.find((s) => s.kod === 'deneme-hali').id
  expect((await call(hali, '/api/r/deneme-hali/info')).d.error).toBe('setup')
  expect((await call(patron, '/api/patron/hali-pin', { id, yon: '1234', per: '1234' }, t)).d.error).toBe('same_pin')
  st = (await call(patron, '/api/patron/hali-pin', { id, yon: '1234', per: '5678' }, t)).d
  expect(st.haliKurulu).toContain('deneme-hali')
  expect((await call(hali, '/api/r/deneme-hali/info')).d.wa).toBe('05320000000')
  const lp = (await call(hali, '/api/s/deneme-hali/login', { pin: '5678' })).d
  expect(lp.rol).toBe('per')
  await call(patron, '/api/patron/stop', { id }, t)
  expect((await call(hali, '/api/s/deneme-hali/state', undefined, lp.token)).s).toBe(402)
  await call(patron, '/api/patron/stop', { id }, t)
  expect((await call(hali, '/api/s/deneme-hali/state', undefined, lp.token)).s).toBe(200)
  // abonelik bitince kapanır, ödeme alınca açılır
  await call(patron, '/api/patron/shop', { ...st.salonlar.find((s) => s.id === id), bitis: '2020-01-01' }, t)
  expect((await call(hali, '/api/r/deneme-hali/info')).s).toBe(402)
  await call(patron, '/api/patron/pay', { id, tutar: 500, ay: 1, y: 'Havale' }, t)
  expect((await call(hali, '/api/r/deneme-hali/info')).s).toBe(200)
})
