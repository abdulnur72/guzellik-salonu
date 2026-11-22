// Çok dükkânlı güzellik uygulaması: veritabanı güncellemesi (0007), salonlar
// arası ayrım, salona özel sahip PIN'i, PIN'siz panel ve Lila'nın korunması.
// Bellekteki deneme veritabanında çalışır (bun test). Gerçek kişi bilgisi yok.
import { beforeEach, expect, test } from 'bun:test'
import { handle, hashPin } from '../server/api'
import { makeDB } from './d1'

type DB = ReturnType<typeof makeDB>
let db: DB
let ipn = 0

const LILA_BIZ = 'biz-lila'
const LILA_BR = 'br-lila'
const OWNER_PIN = '111111'
const MANAGER_PIN = '222222'
const STAFF_PIN = '3333'

async function call(path: string, body?: unknown, token?: string) {
  const res = await handle(
    new Request('https://x.dev/api/' + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        'content-type': 'application/json',
        'cf-connecting-ip': '10.0.' + Math.floor(ipn / 250) + '.' + (ipn++ % 250),
        ...(token ? { authorization: 'Bearer ' + token } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
    { DB: db as never },
  )
  return { s: res.status, d: (await res.json()) as Record<string, any> }
}

/** Güncellemeden önceki (tek işletmeli) hali: canlıdaki Lila'nın yapısına benzer, uydurma veri */
async function oldStyleLila(d: DB) {
  const q = (sql: string, ...a: unknown[]) => d.raw.query(sql).run(...(a as never[]))
  q("UPDATE meta SET v = 5 WHERE k = 'seq'")
  const put = (kind: string, id: string, branch: string, ix: string | null, data: object) =>
    q('INSERT INTO rows (kind, id, branch_id, ix, data, seq) VALUES (?, ?, ?, ?, ?, 5)', kind, id, branch, ix, JSON.stringify(data))
  put('business', LILA_BIZ, '', null, { id: LILA_BIZ, name: 'Lila Güzellik Salonu', ownerName: '', sector: 'guzellik', country: 'TR', currency: 'TRY', locale: 'tr-TR', timeZone: 'Europe/Istanbul', ownerPin: '•', feeFirst: 500, feeExtra: 250 })
  put('branch', LILA_BR, LILA_BR, 'lila', { id: LILA_BR, businessId: LILA_BIZ, name: 'Merkez', slug: 'lila', address: 'Örnek Mah.', phone: '0212 000 00 00', hours: '', dayCutoffHour: 4, openMin: 540, closeMin: 1200, managerPin: '•', rooms: [] })
  put('staff', 'st-1', LILA_BR, null, { id: 'st-1', branchId: LILA_BR, name: 'Uzman A', role: 'expert', commissionPct: 40, active: true, pin: '•' })
  put('staff', 'st-2', LILA_BR, null, { id: 'st-2', branchId: LILA_BR, name: 'Uzman B', role: 'expert', commissionPct: 40, active: true })
  put('service', 'sv-1', LILA_BR, null, { id: 'sv-1', branchId: LILA_BR, category: 'Cilt', name: 'Cilt bakımı', durationMin: 60, price: 800 })
  put('customer', 'cu-1', LILA_BR, '5000000001', { id: 'cu-1', branchId: LILA_BR, name: 'Deneme Müşteri', phone: '0500 000 00 01' })
  put('appointment', 'ap-1', LILA_BR, '2030-01-02', { id: 'ap-1', branchId: LILA_BR, date: '2030-01-02', time: '10:00', durationMin: 60, price: 800, serviceIds: ['sv-1'], serviceNames: ['Cilt bakımı'], staffId: 'st-1', customerId: 'cu-1', status: 'booked' })
  put('expense', 'ex-1', LILA_BR, null, { id: 'ex-1', branchId: LILA_BR, date: '2030-01-01', title: 'Kira', amount: 1000 })
  q('INSERT INTO secrets (key, hash) VALUES (?, ?)', 'owner', await hashPin(OWNER_PIN))
  q('INSERT INTO secrets (key, hash) VALUES (?, ?)', 'manager:' + LILA_BR, await hashPin(MANAGER_PIN))
  q('INSERT INTO secrets (key, hash) VALUES (?, ?)', 'staff:st-1', await hashPin(STAFF_PIN))
  q('INSERT INTO secrets (key, hash) VALUES (?, ?)', 'platform', await hashPin('999999'))
  q('INSERT INTO secrets (key, hash) VALUES (?, ?)', 'hali:yon:demo', await hashPin('4444'))
  const exp = Date.now() + 86_400_000
  q("INSERT INTO sessions (token, role, branch_id, staff_id, expires) VALUES ('old-owner', 'owner', NULL, NULL, ?)", exp)
  q("INSERT INTO sessions (token, role, branch_id, staff_id, expires) VALUES ('old-mgr', 'manager', ?, NULL, ?)", LILA_BR, exp)
  q("INSERT INTO sessions (token, role, branch_id, staff_id, expires) VALUES ('old-hali', 'hali_yon', 'demo', NULL, ?)", exp)
  q("INSERT INTO sessions (token, role, branch_id, staff_id, expires) VALUES ('old-plat', 'platform', NULL, NULL, ?)", exp)
  // Sahip paneli: Lila (0002 ekledi) + halı demo dükkânı ("demo" kodu halının)
  q("UPDATE plat_shops SET data = json_set(data, '$.bitis', '2099-01-01') WHERE kod = 'lila'")
  q("INSERT INTO plat_shops (id, kod, data) VALUES ('demo', 'demo', ?)", JSON.stringify({ id: 'demo', ad: 'Demo Halı Yıkama', sektor: 'Halı Yıkama', tel: '', paket: 'p1', deneme: true, bitis: '2099-01-01', dur: false, not: '', isl: '', kod: 'demo' }))
  q("INSERT INTO hali_shops (kod, data) VALUES ('demo', '{\"ad\":\"Demo Halı Yıkama\"}')")
}

const snapshot = (d: DB, sql: string) => JSON.stringify(d.raw.query(sql).all())

async function patronToken() {
  const r = await call('patron/login', { pin: '999999' })
  return r.d.token as string
}

/** Sahip panelinden demo güzellik salonunu ekler ve kurar */
async function addDemo(pt: string, opts: { acik?: boolean } = {}) {
  let st = (await call('patron/add', { ad: 'Demo Güzellik Salonu', sektor: 'Güzellik Salonu', tel: '', paket: 'p1', kod: 'guzellik-demo' }, pt)).d
  const shop = st.salonlar.find((s: any) => s.kod === 'guzellik-demo')
  st = (await call('patron/guzellik-kur', { id: shop.id, sahip: '2468', yonetici: '1234' }, pt)).d
  if (opts.acik) st = (await call('patron/acik', { id: shop.id }, pt)).d
  return { st, shop }
}

beforeEach(async () => {
  db = makeDB('0006_spor.sql')
  await oldStyleLila(db)
})

test('0007: Lila verisi korunur, işletmesine bağlanır, PIN aynı kalır, diğer uygulamalar etkilenmez', async () => {
  const beforeRows = snapshot(db, 'SELECT kind, id, branch_id, ix, data, seq, deleted FROM rows ORDER BY kind, id')
  const beforeOther = ['hali_shops', 'plat_shops', 'plat_kv', 'berber_shops', 'kuafor_shops', 'spor_shops'].map((t) => snapshot(db, `SELECT * FROM ${t}`))
  const beforeSecrets = snapshot(db, 'SELECT key, hash FROM secrets ORDER BY key')
  db.migrate('0007_coklu_salon.sql')
  // Satırlar aynen duruyor, hepsi Lila'nın işletmesine bağlı
  expect(snapshot(db, 'SELECT kind, id, branch_id, ix, data, seq, deleted FROM rows ORDER BY kind, id')).toBe(beforeRows)
  expect(db.raw.query('SELECT DISTINCT biz FROM rows').all()).toEqual([{ biz: LILA_BIZ }])
  // Diğer uygulamaların ve sahip panelinin tabloları aynen
  expect(['hali_shops', 'plat_shops', 'plat_kv', 'berber_shops', 'kuafor_shops', 'spor_shops'].map((t) => snapshot(db, `SELECT * FROM ${t}`))).toEqual(beforeOther)
  // Eski PIN özetleri aynen, sahip PIN'i işletmeye özel anahtara da kopyalandı (aynı özet)
  const secrets = db.raw.query('SELECT key, hash FROM secrets ORDER BY key').all() as { key: string; hash: string }[]
  expect(JSON.stringify(secrets.filter((s) => s.key !== 'owner:' + LILA_BIZ))).toBe(beforeSecrets)
  expect(secrets.find((s) => s.key === 'owner:' + LILA_BIZ)!.hash).toBe(secrets.find((s) => s.key === 'owner')!.hash)
  // Güzellik oturumları işletmeye bağlandı; halı ve sahip paneli oturumları boş kaldı
  const sess = Object.fromEntries((db.raw.query('SELECT token, biz FROM sessions').all() as { token: string; biz: string | null }[]).map((r) => [r.token, r.biz]))
  expect(sess).toEqual({ 'old-owner': LILA_BIZ, 'old-mgr': LILA_BIZ, 'old-hali': null, 'old-plat': null })
})

test('0007: eski (tek işletmeli) sorgular güncellenmiş veritabanında da çalışır (geri dönüş mümkün)', async () => {
  db.migrate('0007_coklu_salon.sql')
  // Eski kod satır eklerken biz sütununu yazmaz: varsayılan '' ile kabul edilmeli
  db.raw.query("INSERT INTO rows (kind, id, branch_id, ix, data, seq) VALUES ('stock', 'old-x', ?, NULL, '{}', 6)").run(LILA_BR)
  expect((db.raw.query("SELECT biz FROM rows WHERE id = 'old-x'").get() as { biz: string }).biz).toBe('')
  expect((db.raw.query("SELECT id FROM rows WHERE kind = 'business' AND deleted = 0 LIMIT 1").get() as { id: string }).id).toBe(LILA_BIZ)
  db.raw.query("INSERT INTO sessions (token, role, branch_id, staff_id, expires) VALUES ('t', 'owner', NULL, NULL, 1)").run()
})

test('Lila: eski girişler ve eski adresler aynen çalışır', async () => {
  db.migrate('0007_coklu_salon.sql')
  // Güncellemeden önce açılmış oturum geçerli
  expect((await call('sync', undefined, 'old-mgr')).s).toBe(200)
  // Kodsuz sahip girişi (/sahip) Lila'ya gider, kodlu da çalışır
  expect((await call('login', { scope: 'owner', pin: OWNER_PIN })).d.token).toBeTruthy()
  expect((await call('login', { scope: 'owner', slug: 'lila', pin: OWNER_PIN })).d.token).toBeTruthy()
  expect((await call('login', { scope: 'branch', slug: 'lila', as: 'manager', pin: MANAGER_PIN })).d.token).toBeTruthy()
  expect((await call('login', { scope: 'branch', slug: 'lila', as: 'staff', staffId: 'st-1', pin: STAFF_PIN })).d.token).toBeTruthy()
  const idx = (await call('public')).d
  expect(idx.business.name).toBe('Lila Güzellik Salonu')
  expect(idx.branches.map((b: any) => b.slug)).toEqual(['lila'])
  expect((await call('public/b/lila')).s).toBe(200)
  // Lila'da PIN'siz panel yok
  expect((await call('open', { slug: 'lila' })).s).toBe(403)
  // Halı ve sahip paneli oturumları güzellik verisini göremez
  expect((await call('sync', undefined, 'old-hali')).s).toBe(401)
  expect((await call('sync', undefined, 'old-plat')).s).toBe(401)
})

test('Sahip paneli güzellik salonu kurar: kendi kodu, kendi sahip PIN’i, kendi hizmet listesi', async () => {
  db.migrate('0007_coklu_salon.sql')
  const pt = await patronToken()
  const { st } = await addDemo(pt)
  expect(st.guzellikKurulu).toContain('guzellik-demo')
  expect(st.guzellikKurulu).toContain('lila')
  const demoBiz = (db.raw.query("SELECT biz FROM rows WHERE kind = 'branch' AND ix = 'guzellik-demo'").get() as { biz: string }).biz
  expect(demoBiz).not.toBe(LILA_BIZ)
  expect((db.raw.query("SELECT COUNT(*) AS n FROM rows WHERE kind = 'service' AND biz = ?").get(demoBiz) as { n: number }).n).toBeGreaterThan(100)
  // Sahip panelinin şube listesinde her şube kendi salonunun adıyla
  expect(st.subeler.find((x: any) => x.kod === 'guzellik-demo').ad).toBe('Demo Güzellik Salonu')
  expect(st.subeler.find((x: any) => x.kod === 'lila').ad).toBe('Lila Güzellik Salonu')
  // Her salonun sahip PIN'i yalnızca kendi salonunu açar
  expect((await call('login', { scope: 'owner', slug: 'guzellik-demo', pin: '2468' })).d.token).toBeTruthy()
  expect((await call('login', { scope: 'owner', slug: 'guzellik-demo', pin: OWNER_PIN })).s).toBe(403)
  expect((await call('login', { scope: 'owner', slug: 'lila', pin: '2468' })).s).toBe(403)
  expect((await call('login', { scope: 'owner', pin: '2468' })).s).toBe(403)
  expect((await call('login', { scope: 'branch', slug: 'guzellik-demo', as: 'manager', pin: '1234' })).d.token).toBeTruthy()
  expect((await call('public?k=guzellik-demo')).d.business.name).toBe('Demo Güzellik Salonu')
  expect((await call('public')).d.business.name).toBe('Lila Güzellik Salonu')
  // Kurulu salonda yalnızca yazılan PIN değişir; eski sahip oturumu kapanır
  const demoOwner = (await call('login', { scope: 'owner', slug: 'guzellik-demo', pin: '2468' })).d.token
  const shop = st.salonlar.find((s: any) => s.kod === 'guzellik-demo')
  await call('patron/guzellik-kur', { id: shop.id, sahip: '13579' }, pt)
  expect((await call('sync', undefined, demoOwner)).s).toBe(401)
  expect((await call('login', { scope: 'owner', slug: 'guzellik-demo', pin: '13579' })).d.token).toBeTruthy()
  expect((await call('login', { scope: 'branch', slug: 'guzellik-demo', as: 'manager', pin: '1234' })).d.token).toBeTruthy()
  // Lila'nın PIN'leri değişmedi
  expect((await call('login', { scope: 'owner', slug: 'lila', pin: OWNER_PIN })).d.token).toBeTruthy()
  // İlk kurulumda iki PIN de zorunlu; güzellik olmayan dükkân kurulamaz
  const add2 = (await call('patron/add', { ad: 'Üçüncü Salon', sektor: 'Güzellik Salonu', kod: 'ucuncu' }, pt)).d
  const s3 = add2.salonlar.find((s: any) => s.kod === 'ucuncu')
  expect((await call('patron/guzellik-kur', { id: s3.id, sahip: '1111' }, pt)).s).toBe(400)
  const hali = add2.salonlar.find((s: any) => s.kod === 'demo')
  expect((await call('patron/guzellik-kur', { id: hali.id, sahip: '1111', yonetici: '2222' }, pt)).s).toBe(400)
})

test('Salonlar birbirinin kayıtlarını göremez ve değiştiremez', async () => {
  db.migrate('0007_coklu_salon.sql')
  const pt = await patronToken()
  await addDemo(pt)
  const lilaBefore = snapshot(db, `SELECT kind, id, data, deleted FROM rows WHERE biz = '${LILA_BIZ}' ORDER BY kind, id`)
  const demoOwner = (await call('login', { scope: 'owner', slug: 'guzellik-demo', pin: '2468' })).d.token
  const demoMgr = (await call('login', { scope: 'branch', slug: 'guzellik-demo', as: 'manager', pin: '1234' })).d.token
  const lilaOwner = (await call('login', { scope: 'owner', slug: 'lila', pin: OWNER_PIN })).d.token
  const lilaMgr = (await call('login', { scope: 'branch', slug: 'lila', as: 'manager', pin: MANAGER_PIN })).d.token

  // Görme: her biri yalnız kendi işletmesini
  const ds = (await call('sync', undefined, demoOwner)).d
  expect(ds.rows.some((r: any) => r.id === LILA_BIZ || r.id === 'cu-1' || r.id === 'ap-1' || r.branchId === LILA_BR)).toBe(false)
  expect(ds.rows.filter((r: any) => r.kind === 'business').length).toBe(1)
  const dm = (await call('sync', undefined, demoMgr)).d
  expect(dm.rows.some((r: any) => r.branchId === LILA_BR || r.id === LILA_BIZ)).toBe(false)
  for (const tok of [lilaOwner, lilaMgr]) {
    const ls = (await call('sync', undefined, tok)).d
    expect(ls.rows.some((r: any) => r.kind === 'branch' && r.data.slug === 'guzellik-demo')).toBe(false)
    expect(ls.rows.filter((r: any) => r.kind === 'business').map((r: any) => r.id)).toEqual([LILA_BIZ])
  }
  // Artımlı senkron da (since > 0) başka salonun değişikliğini getirmez
  const since = (await call('sync', undefined, lilaMgr)).d.seq
  const demoBr = ds.rows.find((r: any) => r.kind === 'branch')
  const exp = { kind: 'expense', id: 'demo-exp', branchId: demoBr.id, data: { id: 'demo-exp', branchId: demoBr.id, date: '2030-01-01', title: 'Kira', amount: 1 } }
  expect((await call('write', { rows: [exp] }, demoMgr)).d.ok).toBe(true)
  expect((await call(`sync?since=${since}`, undefined, lilaMgr)).d.rows).toEqual([])

  // Değiştirme denemeleri: hepsi reddedilir
  const lilaAppt = { kind: 'appointment', id: 'ap-1', branchId: LILA_BR, data: { id: 'ap-1', branchId: LILA_BR, date: '2030-01-02', time: '10:00', durationMin: 60, price: 0, serviceIds: [], serviceNames: [], staffId: 'st-1', customerId: null, status: 'cancelled' } }
  expect((await call('write', { rows: [lilaAppt] }, demoOwner)).s).toBe(403)
  expect((await call('write', { rows: [{ kind: 'appointment', id: 'ap-1', branchId: LILA_BR, deleted: true }] }, demoOwner)).s).toBe(403)
  // Kendi şubesindeymiş gibi Lila'nın kayıt kimliğini kullanmak
  expect((await call('write', { rows: [{ ...lilaAppt, branchId: demoBr.id, data: { ...lilaAppt.data, branchId: demoBr.id } }] }, demoOwner)).s).toBe(403)
  // Lila'nın şubesine yeni satır eklemek
  const intruder = { kind: 'staff', id: 'x-1', branchId: LILA_BR, data: { id: 'x-1', branchId: LILA_BR, name: 'Yabancı', role: 'expert', commissionPct: 0, active: true, pin: '8888' } }
  expect((await call('write', { rows: [intruder] }, demoOwner)).s).toBe(403)
  // Lila'nın işletme satırı ve PIN'i
  const lilaBizRow = { kind: 'business', id: LILA_BIZ, branchId: '', data: { id: LILA_BIZ, name: 'Ele geçirildi', ownerPin: '0000' } }
  expect((await call('write', { rows: [lilaBizRow] }, demoOwner)).s).toBe(403)
  // Lila'nın şubesine yönetici PIN'i
  expect((await call('write', { rows: [{ kind: 'branch', id: LILA_BR, branchId: LILA_BR, data: { id: LILA_BR, businessId: LILA_BIZ, slug: 'lila', managerPin: '0000' } }] }, demoOwner)).s).toBe(403)
  // Başka işletmeye bağlı yeni şube
  expect((await call('write', { rows: [{ kind: 'branch', id: 'br-x', branchId: 'br-x', data: { id: 'br-x', businessId: LILA_BIZ, name: 'X', slug: 'lila-x' } }] }, demoOwner)).s).toBe(400)
  // Lila'nın verisi bit bit aynı
  expect(snapshot(db, `SELECT kind, id, data, deleted FROM rows WHERE biz = '${LILA_BIZ}' ORDER BY kind, id`)).toBe(lilaBefore)
  expect((await call('login', { scope: 'owner', slug: 'lila', pin: OWNER_PIN })).d.token).toBeTruthy()
  expect((await call('login', { scope: 'branch', slug: 'lila', as: 'manager', pin: MANAGER_PIN })).d.token).toBeTruthy()
})

test('Sahip PIN’i ve personel PIN çakışması yalnız kendi salonuna bakar', async () => {
  db.migrate('0007_coklu_salon.sql')
  const pt = await patronToken()
  await addDemo(pt)
  const demoMgr = (await call('login', { scope: 'branch', slug: 'guzellik-demo', as: 'manager', pin: '1234' })).d.token
  const br = (await call('sync', undefined, demoMgr)).d.rows.find((r: any) => r.kind === 'branch')
  // Demo personeline Lila'nın personel PIN'i verilebilir (başka salon), kendi sahip PIN'i verilemez
  const st = (id: string, pin: string) => ({ kind: 'staff', id, branchId: br.id, data: { id, branchId: br.id, name: 'Uzman ' + id, role: 'expert', commissionPct: 40, active: true, pin } })
  expect((await call('write', { rows: [st('d-1', STAFF_PIN)] }, demoMgr)).d.ok).toBe(true)
  expect((await call('write', { rows: [st('d-2', '2468')] }, demoMgr)).s).toBe(409)
  expect((await call('write', { rows: [st('d-3', '5678')] }, demoMgr)).d.ok).toBe(true)
  expect((await call('login', { scope: 'branch', slug: 'guzellik-demo', as: 'staff', staffId: 'd-3', pin: '5678' })).d.token).toBeTruthy()
  // Demo personeli, Lila'nın panelinden giremez
  expect((await call('login', { scope: 'branch', slug: 'lila', as: 'staff', staffId: 'd-3', pin: '5678' })).s).toBe(404)
})

test('PIN’siz panel: yalnız açılan salonda, resepsiyon yetkisiyle; Yönetici yine PIN ister', async () => {
  db.migrate('0007_coklu_salon.sql')
  const pt = await patronToken()
  const { shop } = await addDemo(pt)
  expect((await call('open', { slug: 'guzellik-demo' })).s).toBe(403)
  await call('patron/acik', { id: shop.id }, pt)
  const o = (await call('open', { slug: 'guzellik-demo' })).d
  expect(o.token).toBeTruthy()
  expect(o.role).toBe('reception')
  const s = (await call('sync', undefined, o.token)).d
  expect(s.role).toBe('reception')
  expect(s.rows.some((r: any) => r.kind === 'expense')).toBe(false)
  expect(s.rows.some((r: any) => r.branchId === LILA_BR)).toBe(false)
  const br = s.rows.find((r: any) => r.kind === 'branch')
  // Randevu/müşteri yazabilir; gider, personel, şube ayarı ve PIN yazamaz
  const cu = { kind: 'customer', id: 'c-open', branchId: br.id, data: { id: 'c-open', branchId: br.id, name: 'Deneme', phone: '0500 000 00 09' } }
  expect((await call('write', { rows: [cu] }, o.token)).d.ok).toBe(true)
  const exp = { kind: 'expense', id: 'e-open', branchId: br.id, data: { id: 'e-open', branchId: br.id, date: '2030-01-01', title: 'X', amount: 1 } }
  expect((await call('write', { rows: [exp] }, o.token)).s).toBe(403)
  const stf = { kind: 'staff', id: 's-open', branchId: br.id, data: { id: 's-open', branchId: br.id, name: 'X', role: 'expert', commissionPct: 0, active: true } }
  expect((await call('write', { rows: [stf] }, o.token)).s).toBe(403)
  expect((await call('write', { rows: [{ ...br, data: { ...br.data, managerPin: '0000' } }] }, o.token)).s).toBe(403)
  expect((await call('pin', { current: '1234', next: '9999' }, o.token)).s).toBe(403)
  // Yönetici sekmesi: yanlış PIN reddedilir, doğru PIN açılır
  expect((await call('login', { scope: 'branch', slug: 'guzellik-demo', as: 'manager', pin: '0000' })).s).toBe(403)
  expect((await call('login', { scope: 'branch', slug: 'guzellik-demo', as: 'manager', pin: '1234' })).d.token).toBeTruthy()
  // Kapatılınca PIN'siz oturum düşer ve yenisi açılmaz
  await call('patron/acik', { id: shop.id }, pt)
  expect((await call('sync', undefined, o.token)).s).toBe(401)
  expect((await call('open', { slug: 'guzellik-demo' })).s).toBe(403)
  // Düzenle/Kaydet PIN'siz ayarını silmez
  await call('patron/acik', { id: shop.id }, pt)
  const st2 = (await call('patron/shop', { ...shop, ad: 'Demo Güzellik Salonu', bitis: '2099-01-01' }, pt)).d
  expect(st2.salonlar.find((x: any) => x.id === shop.id).acik).toBe(true)
  // Abonelik bitince PIN'siz panel de kapanır
  await call('patron/shop', { ...shop, bitis: '2020-01-01' }, pt)
  expect((await call('open', { slug: 'guzellik-demo' })).s).toBe(402)
})

test('Abonelik kilidi salona özel: demonun süresi bitince Lila açık kalır', async () => {
  db.migrate('0007_coklu_salon.sql')
  const pt = await patronToken()
  const { shop } = await addDemo(pt)
  await call('patron/shop', { ...shop, bitis: '2020-01-01' }, pt)
  expect((await call('login', { scope: 'owner', slug: 'guzellik-demo', pin: '2468' })).s).toBe(402)
  expect((await call('public/b/guzellik-demo')).s).toBe(402)
  expect((await call('login', { scope: 'owner', slug: 'lila', pin: OWNER_PIN })).d.token).toBeTruthy()
  expect((await call('public/b/lila')).s).toBe(200)
})

test('Kod çakışması: güzellik şubesi başka sektörün dükkân kodunu alamaz, tersi de olmaz', async () => {
  db.migrate('0007_coklu_salon.sql')
  const pt = await patronToken()
  // "demo" halının kodu: Lila sahibi "demo" adlı şube açamaz
  const lilaOwner = (await call('login', { scope: 'owner', slug: 'lila', pin: OWNER_PIN })).d.token
  const nb = { kind: 'branch', id: 'br-new', branchId: 'br-new', data: { id: 'br-new', businessId: LILA_BIZ, name: 'Şube', slug: 'demo', address: '', phone: '', hours: '', dayCutoffHour: 4, openMin: 540, closeMin: 1200, rooms: [] } }
  expect((await call('write', { rows: [nb] }, lilaOwner)).s).toBe(409)
  // Başka kısa adla açılır ve yeni şube Lila'nın işletmesine bağlanır
  const ok = { ...nb, data: { ...nb.data, slug: 'lila-kadikoy' } }
  expect((await call('write', { rows: [ok] }, lilaOwner)).d.ok).toBe(true)
  expect((db.raw.query("SELECT biz FROM rows WHERE id = 'br-new'").get() as { biz: string }).biz).toBe(LILA_BIZ)
  // Başka sektörden dükkân, güzellik şubesinin kısa adını kod olarak alamaz
  expect((await call('patron/add', { ad: 'X Halı', sektor: 'Halı Yıkama', kod: 'lila-kadikoy' }, pt)).s).toBe(409)
  expect((await call('patron/add', { ad: 'X Halı', sektor: 'Halı Yıkama', kod: 'x-hali' }, pt)).s).toBe(200)
})

test('Müşteri randevusu doğru salona yazılır', async () => {
  db.migrate('0007_coklu_salon.sql')
  const pt = await patronToken()
  await addDemo(pt)
  const demoMgr = (await call('login', { scope: 'branch', slug: 'guzellik-demo', as: 'manager', pin: '1234' })).d.token
  const br = (await call('sync', undefined, demoMgr)).d.rows.find((r: any) => r.kind === 'branch')
  await call('write', { rows: [{ kind: 'staff', id: 'd-1', branchId: br.id, data: { id: 'd-1', branchId: br.id, name: 'Uzman', role: 'expert', commissionPct: 40, active: true } }] }, demoMgr)
  const pub = (await call('public/b/guzellik-demo')).d
  const sv = pub.rows.find((r: any) => r.kind === 'service').data
  const d = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10)
  const bk = (await call('public/b/guzellik-demo/book', { serviceIds: [sv.id], date: d, time: '11:00', name: 'Deneme Kişi', phone: '0532 000 00 07' })).d
  expect(bk.ok).toBe(true)
  const demoBiz = (db.raw.query("SELECT biz FROM rows WHERE kind = 'branch' AND ix = 'guzellik-demo'").get() as { biz: string }).biz
  expect(db.raw.query("SELECT DISTINCT biz FROM rows WHERE kind IN ('appointment', 'customer') AND branch_id = ?").all(br.id)).toEqual([{ biz: demoBiz }])
  // Randevularım / iptal başka salonun linkinden çalışmaz
  expect((await call('public/b/lila/mine', { items: [{ id: bk.id, token: bk.token }] })).d.appointments).toEqual([])
  expect((await call('public/b/guzellik-demo/mine', { items: [{ id: bk.id, token: bk.token }] })).d.appointments.length).toBe(1)
  expect((await call('public/b/lila/cancel', { id: bk.id, token: bk.token })).d.ok).toBe(false)
  expect((await call('public/b/guzellik-demo/cancel', { id: bk.id, token: bk.token })).d.ok).toBe(true)
})

test('0007 sonrası düzeltme: eski kodun boş işletmeyle yazdığı satırlar Lila’ya bağlanır', async () => {
  db.migrate('0007_coklu_salon.sql')
  db.raw.query("INSERT INTO rows (kind, id, branch_id, ix, data, seq) VALUES ('customer', 'cu-gap', ?, '5000000002', ?, 6)").run(LILA_BR, JSON.stringify({ id: 'cu-gap', branchId: LILA_BR, name: 'Arada Müşteri', phone: '0500 000 00 02' }))
  db.raw.query("INSERT INTO sessions (token, role, branch_id, staff_id, expires) VALUES ('gap-mgr', 'manager', ?, NULL, ?)").run(LILA_BR, Date.now() + 86_400_000)
  expect((await call('sync', undefined, 'gap-mgr')).s).toBe(401)
  db.migrate('../sonra/0007_eksik_biz.sql')
  const rows = (await call('sync', undefined, 'gap-mgr')).d.rows
  expect(rows.some((r: any) => r.id === 'cu-gap')).toBe(true)
  // Tekrar çalıştırmak zararsız
  db.migrate('../sonra/0007_eksik_biz.sql')
  expect(db.raw.query("SELECT COUNT(*) AS n FROM rows WHERE biz = ''").get()).toEqual({ n: 0 })
})

test('Demo yükleme betiği: ayrı salon, PIN’siz panel, PIN 1234/5678, en az 1 yıl, Lila’ya dokunmaz', async () => {
  db.migrate('0007_coklu_salon.sql')
  const lilaBefore = snapshot(db, `SELECT * FROM rows WHERE biz = '${LILA_BIZ}' ORDER BY kind, id`)
  const secretsBefore = snapshot(db, 'SELECT * FROM secrets ORDER BY key')
  const gen = Bun.spawnSync(['bun', 'scripts/seed-demo.ts'], { cwd: import.meta.dir + '/..' })
  expect(gen.exitCode).toBe(0)
  const sql = gen.stdout.toString()
  // Gerçek kişi bilgisi yok: telefonlar 0500 000 00 xx biçiminde
  for (const m of sql.matchAll(/0\d{3} \d{3} \d{2} \d{2}/g)) expect(m[0].startsWith('0500 000 00')).toBe(true)
  db.raw.exec(sql)
  expect(snapshot(db, `SELECT * FROM rows WHERE biz = '${LILA_BIZ}' ORDER BY kind, id`)).toBe(lilaBefore)
  const shop = JSON.parse((db.raw.query("SELECT data FROM plat_shops WHERE kod = 'guzellik-demo'").get() as { data: string }).data)
  expect(shop.acik).toBe(true)
  expect(shop.sektor).toBe('Güzellik Salonu')
  const days = (Date.parse(shop.bitis) - Date.parse(new Date().toISOString().slice(0, 10))) / 86_400_000
  expect(days).toBeGreaterThanOrEqual(365)
  // PIN'siz açılır, randevular görünür, gider/ciro yetkisi yok
  const o = (await call('open', { slug: 'guzellik-demo' })).d.token
  const s = (await call('sync', undefined, o)).d
  expect(s.rows.filter((r: any) => r.kind === 'appointment').length).toBeGreaterThan(10)
  expect(s.rows.some((r: any) => r.branchId === LILA_BR)).toBe(false)
  // Yönetici 1234, personel 5678
  expect((await call('login', { scope: 'branch', slug: 'guzellik-demo', as: 'manager', pin: '1234' })).d.token).toBeTruthy()
  const ayse = s.rows.find((r: any) => r.kind === 'staff' && r.data.name === 'Ayşe')
  expect((await call('login', { scope: 'branch', slug: 'guzellik-demo', as: 'staff', staffId: ayse.id, pin: '5678' })).d.token).toBeTruthy()
  expect((await call('public/b/guzellik-demo')).d.rows.find((r: any) => r.kind === 'business').data.name).toBe('Demo Güzellik Salonu')
  // İkinci kez çalıştırılırsa ilk satırda durur, hiçbir şey eklenmez
  const n = snapshot(db, 'SELECT COUNT(*) FROM rows')
  const gen2 = Bun.spawnSync(['bun', 'scripts/seed-demo.ts'], { cwd: import.meta.dir + '/..' })
  expect(() => db.raw.exec(gen2.stdout.toString())).toThrow()
  expect(snapshot(db, 'SELECT COUNT(*) FROM rows')).toBe(n)
  // Lila'nın PIN'leri değişmedi
  const after = JSON.parse(snapshot(db, 'SELECT * FROM secrets ORDER BY key')) as { key: string }[]
  const before = JSON.parse(secretsBefore) as { key: string }[]
  expect(after.filter((x) => before.some((b) => b.key === x.key))).toEqual(before)
})
