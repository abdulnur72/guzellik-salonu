import { test, expect, beforeEach } from 'bun:test'
import { makeDB } from './d1.js'
import { makeWorker, hashPin, trToday } from '../src/server.js'
const QR = require('../src/qr.js')

const W = makeWorker('<html>app</html>')
let env
const KOD = 'kopuklu-hali-yikama'
async function setup({ bitis, dur = false } = {}) {
  env = { DB: makeDB() }
  const db = env.DB.raw
  const plat = { id: 'kop', ad: 'Köpüklü Halı Yıkama', sektor: 'Halı Yıkama', tel: '', paket: 'p1', deneme: true, bitis: bitis || '2099-01-01', dur, not: '', isl: '', kod: KOD }
  db.query('INSERT INTO plat_shops (id, kod, data) VALUES (?, ?, ?)').run('kop', KOD, JSON.stringify(plat))
  db.query('INSERT INTO hali_shops (kod, data) VALUES (?, ?)').run(KOD, JSON.stringify({ ad: 'Köpüklü Halı Yıkama', wa: '05321112233' }))
  db.query('INSERT INTO secrets (key, hash) VALUES (?, ?)').run('hali:yon:' + KOD, await hashPin('1111'))
  db.query('INSERT INTO secrets (key, hash) VALUES (?, ?)').run('hali:per:' + KOD, await hashPin('2222'))
}
const req = (path, body, tok, ip = '1.1.1.1') =>
  W.fetch(new Request('https://x.dev' + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip, ...(tok ? { authorization: 'Bearer ' + tok } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }), env)
const J = async (r) => ({ s: r.status, d: await r.json() })
const login = async (pin, rol) => (await J(await req(`/api/s/${KOD}/login`, { pin, rol }))).d

beforeEach(() => setup())

test('sayfalar ve bilinmeyen halıcı', async () => {
  expect((await W.fetch(new Request('https://x.dev/r/' + KOD), env)).status).toBe(200)
  expect((await J(await req('/api/r/yok/info'))).s).toBe(404)
  const i = await J(await req(`/api/r/${KOD}/info`))
  expect(i.d.ad).toBe('Köpüklü Halı Yıkama')
  expect(i.d.turler[0]).toEqual({ ad: 'Normal halı', bf: 80 })
})

test('müşteri talebi, sorgu ve gizlilik', async () => {
  const t = await J(await req(`/api/r/${KOD}/talep`, { ad: 'Ayşe', tel: '0532 111 22 33', adr: 'Gül Sk', adet: 2, saat: 'Bu hafta sonu' }))
  expect(t.s).toBe(200)
  expect(t.d.no).toBe(101)
  const t2 = await J(await req(`/api/r/${KOD}/talep`, { ad: 'Ali', tel: '05330000000', adet: 1 }))
  expect(t2.d.no).toBe(102)
  const q = await J(await req(`/api/r/${KOD}/sorgu`, { q: '+90 532 111 22 33' }))
  expect(q.d.list.length).toBe(1)
  expect(q.d.list[0].asama).toBe('Talep alındı')
  expect(JSON.stringify(q.d)).not.toContain('Ayşe') // ad, adres gösterilmez
  expect(JSON.stringify(q.d)).not.toContain('Gül')
  expect((await J(await req(`/api/r/${KOD}/sorgu`, { q: '#102' }))).d.list[0].no).toBe(102)
  expect((await J(await req(`/api/r/${KOD}/sorgu`, { q: '999' }))).d.list.length).toBe(0)
  expect((await J(await req(`/api/r/${KOD}/talep`, { ad: 'X', tel: '123', adet: 1 }))).d.error).toBe('bad_phone')
})

test('talep sınırı', async () => {
  for (let i = 0; i < 8; i++) expect((await req(`/api/r/${KOD}/talep`, { ad: 'A', tel: '05320000000', adet: 1 }, null, '9.9.9.9')).status).toBe(200)
  expect((await J(await req(`/api/r/${KOD}/talep`, { ad: 'A', tel: '05320000000', adet: 1 }, null, '9.9.9.9'))).d.error).toBe('too_many')
})

test('PIN girişi, roller ve personel kısıtları', async () => {
  expect((await J(await req(`/api/s/${KOD}/login`, { pin: '9999' }))).d.error).toBe('wrong_pin')
  const per = await login('2222')
  expect(per.rol).toBe('per')
  const yon = await login('1111')
  expect(yon.rol).toBe('yon')
  // Yönetici sekmesinden personel PIN'i ile yönetici olunmaz
  expect((await J(await req(`/api/s/${KOD}/login`, { pin: '2222', rol: 'yon' }))).d.error).toBe('wrong_pin')
  // Panel PIN'siz açılır: personel yetkisi, ciro/gider/abonelik yok, yönetici işi yapılamaz
  const acik = (await J(await req(`/api/s/${KOD}/state`))).d
  expect(acik.rol).toBe('per')
  expect(acik.giderler).toBeUndefined()
  expect(acik.abonelik).toBeUndefined()
  expect((await J(await req(`/api/s/${KOD}/gider`, { tur: 'Elektrik', tutar: 5 }))).d.error).toBe('yonetici')
  expect((await J(await req(`/api/s/${KOD}/ayar`, { ad: 'X' }))).d.error).toBe('yonetici')
  expect((await J(await req(`/api/s/${KOD}/pin`, { kim: 'yon', pin: '5555' }))).d.error).toBe('yonetici')
  expect((await J(await req(`/api/s/${KOD}/yeni`, { ad: 'Veli', rugs: [{ m2: 2, n: 1, tur: 0 }] }))).s).toBe(200)
  const sp = (await J(await req(`/api/s/${KOD}/state`, undefined, per.token))).d
  expect(sp.rol).toBe('per')
  expect(sp.giderler).toBeUndefined()
  expect(sp.abonelik).toBeUndefined()
  const sy = (await J(await req(`/api/s/${KOD}/state`, undefined, yon.token))).d
  expect(Array.isArray(sy.giderler)).toBe(true)
  expect(sy.abonelik.deneme).toBe(true)
  // personel gider ekleyemez, sipariş silemez
  expect((await J(await req(`/api/s/${KOD}/gider`, { tur: 'Su', tutar: 100 }, per.token))).s).toBe(403)
  // başka halıcının oturumu geçmez
  expect((await req(`/api/s/baska/state`, undefined, per.token)).status).toBe(404)
})

test('sipariş akışı: kayıt, aşama, geri al, ölçü, kısmi ödeme, düzenleme, silme', async () => {
  const per = await login('2222'), yon = await login('1111')
  let s = (await J(await req(`/api/s/${KOD}/yeni`, { ad: 'Mehmet', tel: '0534 333 44 55', rugs: [{ m2: 6, n: 1, tur: 0 }, { m2: 3, n: 2, tur: 1 }] }, per.token))).d
  const o = s.orders[0]
  expect(o.no).toBe(101)
  expect(o.a).toBe(1)
  expect(o.rugs[1]).toEqual({ m2: 3, n: 2, bf: 110, t: 'Yün / el dokuma' })
  s = (await J(await req(`/api/s/${KOD}/ileri`, { no: 101, from: 1 }, per.token))).d
  expect(s.orders[0].a).toBe(2)
  // aynı anda iki telefondan basılırsa ikincisi reddedilir
  expect((await J(await req(`/api/s/${KOD}/ileri`, { no: 101, from: 1 }, per.token))).d.error).toBe('changed')
  s = (await J(await req(`/api/s/${KOD}/geri`, { no: 101, from: 2 }, per.token))).d
  expect(s.orders[0].a).toBe(1)
  // tutar 6*80 + 6*110 = 1140; kapora 300 nakit, 500 kart
  expect((await J(await req(`/api/s/${KOD}/ode`, { no: 101, tut: 300, yon: 'Nakit' }, per.token))).s).toBe(200)
  expect((await J(await req(`/api/s/${KOD}/ode`, { no: 101, tut: 5000, yon: 'Kart' }, per.token))).d.error).toBe('too_much')
  s = (await J(await req(`/api/s/${KOD}/ode`, { no: 101, tut: 500, yon: 'Kart' }, per.token))).d
  expect(s.orders[0].od.map((p) => p.tut)).toEqual([300, 500])
  // ölçü düzeltme: toplam 10 m² ipek
  s = (await J(await req(`/api/s/${KOD}/olcu`, { no: 101, m2: 10, tur: 2 }, per.token))).d
  expect(s.orders[0].rugs).toEqual([{ m2: 10 / 3, n: 3, bf: 160, t: 'İpek / özel' }])
  s = (await J(await req(`/api/s/${KOD}/duzenle`, { no: 101, ad: 'Mehmet Kaya', tel: '0534 999 88 77', adr: 'Yeni adres', not: 'leke' }, per.token))).d
  expect(s.orders[0].ad).toBe('Mehmet Kaya')
  // telefon değişince sorgu yeni numarayla çalışır
  expect((await J(await req(`/api/r/${KOD}/sorgu`, { q: '05349998877' }))).d.list[0].kalan).toBe(800)
  expect((await J(await req(`/api/s/${KOD}/odesil`, { no: 101, i: 0 }, per.token))).s).toBe(403)
  s = (await J(await req(`/api/s/${KOD}/odesil`, { no: 101, i: 0 }, yon.token))).d
  expect(s.orders[0].od.length).toBe(1)
  expect((await J(await req(`/api/s/${KOD}/sil`, { no: 101 }, per.token))).s).toBe(403)
  s = (await J(await req(`/api/s/${KOD}/sil`, { no: 101 }, yon.token))).d
  expect(s.orders.length).toBe(0)
})

test('ölçü girilmeden ödeme alınmaz; değişmeyen durumda boş yanıt', async () => {
  const per = await login('2222')
  await req(`/api/r/${KOD}/talep`, { ad: 'Ali', tel: '05330000000', adet: 2 })
  const s = (await J(await req(`/api/s/${KOD}/state`, undefined, per.token))).d
  expect(s.orders[0].a).toBe(0)
  expect((await J(await req(`/api/s/${KOD}/ode`, { no: 101, tut: 10 }, per.token))).d.error).toBe('no_measure')
  expect((await J(await req(`/api/s/${KOD}/state?v=${s.v}`, undefined, per.token))).d).toEqual({ same: true })
})

test('yönetici: masraf, fiyatlar, ayarlar, PIN farklılığı', async () => {
  const yon = await login('1111'), per = await login('2222')
  let s = (await J(await req(`/api/s/${KOD}/gider`, { tur: 'Elektrik', tutar: 320, tar: trToday(), not: 'fatura' }, yon.token))).d
  expect(s.giderler[0].tutar).toBe(320)
  s = (await J(await req(`/api/s/${KOD}/gidersil`, { id: s.giderler[0].id }, yon.token))).d
  expect(s.giderler.length).toBe(0)
  s = (await J(await req(`/api/s/${KOD}/ayar`, { turler: [{ ad: 'Normal', bf: 90 }, { ad: 'Yün', bf: '120,5' }], wa: '0532 000 00 00', adres: 'Merkez' }, yon.token))).d
  expect(s.shop.turler).toEqual([{ ad: 'Normal', bf: 90 }, { ad: 'Yün', bf: 120.5 }])
  expect((await J(await req(`/api/r/${KOD}/info`))).d.adres).toBe('Merkez')
  expect((await J(await req(`/api/s/${KOD}/pin`, { kim: 'per', pin: '1111' }, yon.token))).d.error).toBe('same_pin')
  expect((await J(await req(`/api/s/${KOD}/pin`, { kim: 'yon', pin: '2222' }, yon.token))).d.error).toBe('same_pin')
  expect((await J(await req(`/api/s/${KOD}/pin`, { kim: 'per', pin: '3333' }, yon.token))).s).toBe(200)
  // personel PIN'i değişince personel oturumu kapanır (panel yine PIN'siz personel olarak açılır), eski PIN çalışmaz
  expect((await J(await req(`/api/s/${KOD}/state`, undefined, per.token))).d.rol).toBe('per')
  expect(await env.DB.raw.query('SELECT COUNT(*) AS n FROM sessions WHERE token = ?').get(per.token)).toEqual({ n: 0 })
  expect((await J(await req(`/api/s/${KOD}/login`, { pin: '2222' }))).d.error).toBe('wrong_pin')
  expect((await login('3333')).rol).toBe('per')
  expect((await req(`/api/s/${KOD}/state`, undefined, yon.token)).status).toBe(200)
})

test('abonelik kilidi: süresi biten ve durdurulan halıcı kapanır, açılınca döner', async () => {
  const per = await login('2222')
  const db = env.DB.raw
  const set = (p) => db.query('UPDATE plat_shops SET data = json_patch(data, ?) WHERE kod = ?').run(JSON.stringify(p), KOD)
  set({ dur: true })
  let r = await J(await req(`/api/s/${KOD}/state`, undefined, per.token))
  expect(r.s).toBe(402)
  expect(r.d.error).toBe('locked')
  r = await J(await req(`/api/r/${KOD}/info`))
  expect(r.s).toBe(402)
  expect(r.d.tel).toBe('05321112233')
  expect((await req(`/api/r/${KOD}/talep`, { ad: 'A', tel: '05320000000', adet: 1 })).status).toBe(402)
  set({ dur: false, bitis: '2020-01-01' })
  expect((await req(`/api/s/${KOD}/state`, undefined, per.token)).status).toBe(402)
  set({ bitis: '2099-01-01' })
  expect((await req(`/api/s/${KOD}/state`, undefined, per.token)).status).toBe(200)
})

test('kurulmamış halıcı (sahip panelinde var, PIN yok)', async () => {
  env.DB.raw.query("INSERT INTO plat_shops (id, kod, data) VALUES ('y', 'yeni-halici', json_object('ad','Yeni Halıcı','sektor','Halı Yıkama','bitis','2099-01-01','dur',json('false')))").run()
  const r = await J(await req('/api/r/yeni-halici/info'))
  expect(r.s).toBe(409)
  expect(r.d.error).toBe('setup')
})

// QR: üretilen matrisi bağımsız bir çözücüyle geri oku (biçim, maske, hata düzeltme sendromu, veri)
const ALN = [null, [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]]
const BLK = [null, [10, [16]], [16, [28]], [26, [44]], [18, [32, 32]], [24, [43, 43]], [16, [27, 27, 27, 27]], [18, [31, 31, 31, 31]], [22, [38, 38, 39, 39]], [22, [36, 36, 36, 37, 37]], [26, [43, 43, 43, 43, 44]]]
function gfMul(a, b) { let r = 0; while (b) { if (b & 1) r ^= a; a <<= 1; if (a & 256) a ^= 0x11d; b >>= 1 } return r }
function decodeQR(M) {
  const n = M.length, ver = (n - 17) / 4
  let f = 0
  ;[[8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8], [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]].forEach(([x, y], i) => { if (M[y][x]) f |= 1 << i })
  // ikinci kopya da aynı olmalı
  let f2 = 0
  for (let i = 0; i < 8; i++) if (M[8][n - 1 - i]) f2 |= 1 << i
  for (let i = 8; i < 15; i++) if (M[n - 15 + i][8]) f2 |= 1 << i
  if (f !== f2) throw new Error('format copies differ')
  f ^= 0x5412
  const ecl = (f >>> 13) & 3, mask = (f >>> 10) & 7
  if (!M[n - 8][8]) throw new Error('dark module')
  const fn = Array.from({ length: n }, () => Array(n).fill(false))
  const mark = (x0, y0, w, h) => { for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) if (x >= 0 && y >= 0 && x < n && y < n) fn[y][x] = true }
  mark(0, 0, 9, 9); mark(n - 8, 0, 8, 9); mark(0, n - 8, 9, 8)
  mark(6, 0, 1, n); mark(0, 6, n, 1)
  const a = ALN[ver]
  a.forEach((ax, i) => a.forEach((ay, j) => { const L = a.length - 1; if ((i === 0 && j === 0) || (i === 0 && j === L) || (i === L && j === 0)) return; mark(ax - 2, ay - 2, 5, 5) }))
  if (ver >= 7) { mark(n - 11, 0, 3, 6); mark(0, n - 11, 6, 3) }
  // finder kontrolü
  for (const [cx, cy] of [[3, 3], [n - 4, 3], [3, n - 4]]) if (!M[cy][cx] || M[cy - 2][cx] || !M[cy - 3][cx]) throw new Error('finder')
  const mf = [(x, y) => (x + y) % 2 === 0, (x, y) => y % 2 === 0, (x) => x % 3 === 0, (x, y) => (x + y) % 3 === 0, (x, y) => (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0, (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0, (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0, (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0][mask]
  const bits = []
  let up = true
  for (let col = n - 1; col > 0; col -= 2) {
    if (col === 6) col--
    for (let k = 0; k < n; k++) {
      const y = up ? n - 1 - k : k
      for (const x of [col, col - 1]) if (!fn[y][x]) bits.push(M[y][x] !== mf(x, y) ? 1 : 0)
    }
    up = !up
  }
  const cw = []
  for (let i = 0; i + 8 <= bits.length; i += 8) cw.push(bits.slice(i, i + 8).reduce((v, b) => (v << 1) | b, 0))
  const [ecn, ds] = BLK[ver], nb = ds.length, maxd = Math.max(...ds)
  const blocks = ds.map(() => [])
  let k = 0
  for (let i = 0; i < maxd; i++) for (let b = 0; b < nb; b++) if (i < ds[b]) blocks[b].push(cw[k++])
  for (let i = 0; i < ecn; i++) for (let b = 0; b < nb; b++) blocks[b].push(cw[k++])
  // sendromlar sıfır olmalı (alfa^0..alfa^(ecn-1))
  for (const bl of blocks) {
    let alpha = 1
    for (let i = 0; i < ecn; i++) {
      let s = 0
      for (const c of bl) s = gfMul(s, alpha) ^ c
      if (s !== 0) throw new Error('RS syndrome')
      alpha = gfMul(alpha, 2)
    }
  }
  const data = blocks.flatMap((bl, b) => bl.slice(0, ds[b]))
  const db = data.flatMap((c) => [7, 6, 5, 4, 3, 2, 1, 0].map((i) => (c >> i) & 1))
  const rd = (p, len) => db.slice(p, p + len).reduce((v, b) => (v << 1) | b, 0)
  if (rd(0, 4) !== 4) throw new Error('mode')
  const cc = ver < 10 ? 8 : 16, len = rd(4, cc)
  const out = []
  for (let i = 0; i < len; i++) out.push(rd(4 + cc + i * 8, 8))
  return { ecl, mask, ver, text: new TextDecoder().decode(new Uint8Array(out)) }
}
test('QR kodu bağımsız çözücüyle okunuyor (sürüm 1-10)', () => {
  for (const t of ['a', 'https://hali-yikama-c86.pages.dev/r/kopuklu-hali-yikama', 'Halı yıkama ğüşiöç '.repeat(4), 'x'.repeat(150), 'y'.repeat(200)]) {
    const q = QR.encode(t)
    let d; try { d = decodeQR(q.mod) } catch (e) { throw new Error(t.length + " v" + q.ver + " m" + q.mask + " " + e.message) }
    expect(d.text).toBe(t)
    expect(d.ecl).toBe(0)
    expect(d.mask).toBe(q.mask)
  }
  expect(QR.encode('y'.repeat(200)).ver).toBe(10)
  expect(QR.svg('abc')).toContain('<svg')
})
