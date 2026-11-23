// Yerel deneme sunucusu (bellekte veritabanı): bun scripts/dev.js → http://localhost:8790/s/fatih-berber
// Yalnızca yerel deneme için PIN'ler: yönetici 1111, personel 2222 / 3333
// Demo dükkân da kurulur: http://localhost:8790/s/berber-demo (yönetici 1234, personel PIN'siz)
import { readFileSync } from 'node:fs'
import { makeDB } from '../test/d1.js'
import { hashPin } from '../src/server.js'
await import('./build.mjs')
const worker = (await import('../dist/_worker.js?' + Date.now())).default
const DB = makeDB()
const KOD = 'fatih-berber'
DB.raw.query('UPDATE berber_shops SET data = ? WHERE kod = ?').run(JSON.stringify({ ad: 'Fatih Berber', wa: '05321112233', personel: [{ id: 'ali', ad: 'Ali', prim: 40, aktif: true }, { id: 'veli', ad: 'Veli', prim: 50, aktif: true }] }), KOD)
DB.raw.query('INSERT INTO secrets (key, hash) VALUES (?, ?)').run('berber:yon:' + KOD, await hashPin('1111'))
DB.raw.query('INSERT INTO secrets (key, hash) VALUES (?, ?)').run('berber:per:' + KOD + ':ali', await hashPin('2222'))
DB.raw.query('INSERT INTO secrets (key, hash) VALUES (?, ?)').run('berber:per:' + KOD + ':veli', await hashPin('3333'))
DB.raw.exec(readFileSync('db/0005_berber_demo.sql', 'utf8'))
Bun.serve({ port: 8790, fetch: (r) => worker.fetch(r, { DB }) })
console.log('http://localhost:8790/s/' + KOD)
