// Yerel deneme sunucusu (bellekte veritabanı): bun scripts/dev.js → http://localhost:8792/s/atlas-spor
// Yalnızca yerel deneme için PIN'ler: yönetici 1111, antrenör 2222 / 3333
import { makeDB } from '../test/d1.js'
import { hashPin } from '../src/server.js'
await import('./build.mjs')
const worker = (await import('../dist/_worker.js?' + Date.now())).default
const DB = makeDB()
const KOD = 'atlas-spor'
DB.raw.query('UPDATE spor_shops SET data = ? WHERE kod = ?').run(JSON.stringify({ ad: 'Atlas Spor Salonu', wa: '05321112233', personel: [{ id: 'can', ad: 'Can', prim: 40, aktif: true }, { id: 'ece', ad: 'Ece', prim: 50, aktif: true }] }), KOD)
DB.raw.query('INSERT INTO secrets (key, hash) VALUES (?, ?)').run('spor:yon:' + KOD, await hashPin('1111'))
DB.raw.query('INSERT INTO secrets (key, hash) VALUES (?, ?)').run('spor:per:' + KOD + ':can', await hashPin('2222'))
DB.raw.query('INSERT INTO secrets (key, hash) VALUES (?, ?)').run('spor:per:' + KOD + ':ece', await hashPin('3333'))
Bun.serve({ port: Number(process.env.PORT || 8792), fetch: (r) => worker.fetch(r, { DB }) })
console.log('http://localhost:' + (process.env.PORT || 8792) + '/s/' + KOD)
