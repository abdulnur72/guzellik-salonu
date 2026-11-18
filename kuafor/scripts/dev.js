// Yerel deneme sunucusu (bellekte veritabanı): bun scripts/dev.js → http://localhost:8791/s/selin-kuafor
// Yalnızca yerel deneme için PIN'ler: yönetici 1111, personel 2222 / 3333
import { makeDB } from '../test/d1.js'
import { hashPin } from '../src/server.js'
await import('./build.mjs')
const worker = (await import('../dist/_worker.js?' + Date.now())).default
const DB = makeDB()
const KOD = 'selin-kuafor'
DB.raw.query('UPDATE kuafor_shops SET data = ? WHERE kod = ?').run(JSON.stringify({ ad: 'Selin Kuaför', wa: '05321112233', personel: [{ id: 'ayse', ad: 'Ayşe', prim: 40, aktif: true }, { id: 'elif', ad: 'Elif', prim: 50, aktif: true }] }), KOD)
DB.raw.query('INSERT INTO secrets (key, hash) VALUES (?, ?)').run('kuafor:yon:' + KOD, await hashPin('1111'))
DB.raw.query('INSERT INTO secrets (key, hash) VALUES (?, ?)').run('kuafor:per:' + KOD + ':ayse', await hashPin('2222'))
DB.raw.query('INSERT INTO secrets (key, hash) VALUES (?, ?)').run('kuafor:per:' + KOD + ':elif', await hashPin('3333'))
Bun.serve({ port: Number(process.env.PORT || 8791), fetch: (r) => worker.fetch(r, { DB }) })
console.log('http://localhost:' + (process.env.PORT || 8791) + '/s/' + KOD)
