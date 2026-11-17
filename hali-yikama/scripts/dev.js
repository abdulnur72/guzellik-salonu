// Yerel deneme sunucusu (bellekte veritabanı): bun scripts/dev.js  → http://localhost:8788/s/kopuklu-hali-yikama
import { makeDB } from '../test/d1.js'
import { hashPin } from '../src/server.js'
import { readFileSync } from 'node:fs'
await import('./build.mjs')
const worker = (await import('../dist/_worker.js?' + Date.now())).default
const DB = makeDB()
const KOD = 'kopuklu-hali-yikama'
DB.raw.query('INSERT INTO plat_shops (id, kod, data) VALUES (?, ?, ?)').run('kop', KOD, JSON.stringify({ id: 'kop', ad: 'Köpüklü Halı Yıkama', sektor: 'Halı Yıkama', tel: '', paket: 'p1', deneme: true, bitis: '2026-12-17', dur: false, not: '', isl: '', kod: KOD }))
DB.raw.query('INSERT INTO hali_shops (kod, data) VALUES (?, ?)').run(KOD, JSON.stringify({ ad: 'Köpüklü Halı Yıkama', wa: '05321112233' }))
DB.raw.query('INSERT INTO secrets (key, hash) VALUES (?, ?)').run('hali:yon:' + KOD, await hashPin('1111'))
DB.raw.query('INSERT INTO secrets (key, hash) VALUES (?, ?)').run('hali:per:' + KOD, await hashPin('2222'))
globalThis.DEVDB = DB
Bun.serve({ port: 8788, fetch: (r) => worker.fetch(r, { DB }) })
console.log('http://localhost:8788')
