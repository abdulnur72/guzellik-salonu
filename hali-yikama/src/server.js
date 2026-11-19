// Halı yıkama uygulamasının sunucusu (Cloudflare Pages, tek _worker.js).
//
//   /r/<kod>   müşteri sayfası: talep formu ve "Halım nerede?" sorgusu
//   /s/<kod>   halıcı paneli: Personel, Halılar, Müşteri açık; Yönetici PIN ile
//   /api/...   aşağıdaki uçlar
//
// Kayıtlar güzellik salonuyla ortak D1 veritabanında, hali_* tablolarında durur.
// Abonelik ve "Durdur" kilidi sahip panelinin (/patron) plat_shops tablosundan okunur.

export const ASAMA = ['Talep alındı', 'Halı alındı', 'Yıkanıyor', 'Kuruyor', 'Hazır', 'Teslim edildi']
export const LAST = ASAMA.length - 1
const MSGM = [
  'Talebiniz alındı, sizi arayacağız.',
  'Halılarınızı teslim aldık, yıkamaya hazırlıyoruz.',
  'Halılarınız yıkanıyor.',
  'Halılarınız kuruyor.',
  'Halılarınız hazır! Teslimat için sizi arayacağız.',
  'Halılarınız teslim edildi, teşekkürler.',
]
export const VARSAYILAN_TURLER = [
  { ad: 'Normal halı', bf: 80 },
  { ad: 'Yün / el dokuma', bf: 110 },
  { ad: 'İpek / özel', bf: 160 },
  { ad: 'Shaggy / uzun tüylü', bf: 100 },
]
const SAATLER = ['Yarın sabah (09–12)', 'Yarın öğleden sonra (13–17)', 'Bu hafta sonu', 'Aradığımda söyleyeceğim']
const YONTEM = ['Nakit', 'Havale / EFT', 'Kart']
const GIDER = ['Deterjan ve kimyasal', 'Elektrik', 'Su', 'Personel maaşı', 'Yakıt / servis aracı', 'Kira', 'Bakım / tamir', 'Diğer']

const DAY = 86_400_000
const PER_SESSION = 120 * DAY // personel telefonda açık kalır
const YON_SESSION = 12 * 3600_000 // yönetici günde bir PIN girer
const DATE = /^\d{4}-\d{2}-\d{2}$/

class HttpError extends Error {
  constructor(status, code, extra) {
    super(code)
    this.status = status
    this.extra = extra
  }
}

// --- Yardımcılar ---
export const trToday = (now = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : typeof v === 'number' ? String(v).slice(0, max) : '')
const num = (v) => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(',', '.'))
  return Number.isFinite(n) ? n : NaN
}
const r2 = (n) => Math.round(n * 100) / 100
export const telKey = (t) => String(t || '').replace(/\D/g, '').slice(-10)
const uid = () => crypto.randomUUID().replace(/-/g, '').slice(0, 12)
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
function randomToken(bytes = 24) {
  const a = new Uint8Array(bytes)
  crypto.getRandomValues(a)
  return hex(a.buffer)
}
// Sahip panelindeki PIN özetiyle aynı biçim: tuz$sha256(tuz:pin)
export async function hashPin(pin, salt = randomToken(8)) {
  return `${salt}$${hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${salt}:${pin}`)))}`
}
async function checkPin(pin, stored) {
  return !!stored && (await hashPin(pin, stored.split('$')[0])) === stored
}
const validPin = (p) => typeof p === 'string' && /^\d{4,8}$/.test(p)

export const olcu = (o) => r2(o.rugs.reduce((t, r) => t + r.m2 * r.n, 0))
export const tutar = (o) => r2(o.rugs.reduce((t, r) => t + r.m2 * r.n * r.bf, 0))
export const adet = (o) => o.rugs.reduce((t, r) => t + r.n, 0)
export const odenen = (o) => r2((o.od || []).reduce((t, p) => t + p.tut, 0))
export const kalan = (o) => Math.max(0, r2(tutar(o) - odenen(o)))

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })

async function readBody(req) {
  if (Number(req.headers.get('content-length') || 0) > 200_000) throw new HttpError(413, 'too_large')
  try {
    const v = await req.json()
    if (v && typeof v === 'object') return v
  } catch {}
  throw new HttpError(400, 'bad_json')
}

// --- Veritabanı erişimi ---
class Store {
  constructor(db, kod) {
    this.db = db
    this.kod = kod
  }
  async plat() {
    const r = await this.db.prepare('SELECT data FROM plat_shops WHERE kod = ?').bind(this.kod).first()
    return r ? JSON.parse(r.data) : null
  }
  async patronAyar() {
    const r = await this.db.prepare("SELECT data FROM plat_kv WHERE k = 'ayar'").first()
    return r ? JSON.parse(r.data) : {}
  }
  async patronWa() {
    return str((await this.patronAyar()).wa, 30)
  }
  // Halıcı linklerinin ve QR'ın adresi: sahip panelindeki tek ayar (Ayarlar → Halı yıkama uygulamasının adresi).
  // Boş ya da geçersizse sayfa kendi açıldığı adresi kullanır.
  async haliAdres() {
    const a = str((await this.patronAyar()).hali, 200).replace(/\/+$/, '')
    return /^https?:\/\/[a-z0-9.-]+(:\d+)?$/i.test(a) ? a : ''
  }
  async shop() {
    const r = await this.db.prepare('SELECT data, next_no, ver FROM hali_shops WHERE kod = ?').bind(this.kod).first()
    if (!r) return null
    const d = JSON.parse(r.data)
    if (!Array.isArray(d.turler) || !d.turler.length) d.turler = VARSAYILAN_TURLER
    return { ...d, next_no: r.next_no, ver: r.ver }
  }
  bump() {
    return this.db.prepare('UPDATE hali_shops SET ver = ver + 1 WHERE kod = ?').bind(this.kod)
  }
  async order(no) {
    const r = await this.db.prepare('SELECT no, a, data FROM hali_orders WHERE kod = ? AND no = ?').bind(this.kod, Math.trunc(num(no)) || 0).first()
    if (!r) throw new HttpError(404, 'order_not_found')
    return { ...JSON.parse(r.data), no: r.no, a: r.a }
  }
  putOrder(o) {
    const { no, a, ...data } = o
    return this.db
      .prepare(
        'INSERT INTO hali_orders (kod, no, tel, a, data, updated) VALUES (?1, ?2, ?3, ?4, ?5, ?6) ' +
          'ON CONFLICT (kod, no) DO UPDATE SET tel = excluded.tel, a = excluded.a, data = excluded.data, updated = excluded.updated',
      )
      .bind(this.kod, no, telKey(o.tel), a, JSON.stringify(data), Date.now())
  }
  // Sınır: anahtar başına pencere içinde en fazla n kayıt
  async limited(key, n, windowMs) {
    const r = await this.db.prepare('SELECT COUNT(*) AS n FROM attempts WHERE key = ? AND ts > ?').bind(key, Date.now() - windowMs).first()
    return (r?.n ?? 0) >= n
  }
  note(key) {
    return this.db.prepare('INSERT INTO attempts (key, ts) VALUES (?, ?)').bind(key, Date.now())
  }
}

/** Abonelik kilidi: sahip panelinde süresi biten ya da durdurulan halıcı */
const isLocked = (p, today = trToday()) => !!p && (!!p.dur || String(p.bitis || '') < today)

// --- Yönlendirme ---
export async function handleApi(req, env) {
  const url = new URL(req.url)
  const parts = url.pathname.split('/').filter(Boolean) // api, r|s, kod, ...
  try {
    const [, area, kodRaw, ...rest] = parts
    const kod = String(kodRaw || '').toLowerCase()
    if (!/^[a-z0-9-]{1,60}$/.test(kod) || (area !== 'r' && area !== 's')) throw new HttpError(404, 'not_found')
    const st = new Store(env.DB, kod)
    const ip = req.headers.get('cf-connecting-ip') || 'local'
    const plat = await st.plat()
    const shop = await st.shop()
    if (!shop) {
      if (plat && plat.sektor === 'Halı Yıkama') throw new HttpError(409, 'setup', { ad: plat.ad })
      throw new HttpError(404, 'shop_not_found')
    }
    if (isLocked(plat)) {
      throw new HttpError(402, 'locked', area === 'r' ? { ad: shop.ad, tel: shop.wa } : { ad: shop.ad, wa: await st.patronWa() })
    }
    if (area === 'r') return json(await customer(req, st, shop, rest[0], ip))
    return json(await panel(req, st, shop, plat, rest[0], ip, url))
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message, ...(e.extra || {}) }, e.status)
    console.error(e)
    return json({ error: 'server' }, 500)
  }
}

// --- Müşteri (herkese açık) ---
const publicShop = (s) => ({ ad: s.ad, wa: s.wa || '', adres: s.adres || '', turler: s.turler.map((t) => ({ ad: t.ad, bf: t.bf })), saatler: SAATLER })

async function customer(req, st, shop, action, ip) {
  if (req.method === 'GET' && action === 'info') return publicShop(shop)
  if (req.method !== 'POST') throw new HttpError(404, 'not_found')
  const b = await readBody(req)
  if (action === 'talep') {
    const key = `hali:talep:${ip}`
    if (await st.limited(key, 8, 3600_000)) throw new HttpError(429, 'too_many')
    const ad = str(b.ad, 80)
    const tel = str(b.tel, 30)
    const n = Math.trunc(num(b.adet))
    if (!ad) throw new HttpError(400, 'no_name')
    if (telKey(tel).length < 10) throw new HttpError(400, 'bad_phone')
    if (!(n >= 1 && n <= 50)) throw new HttpError(400, 'bad_count')
    const no = await nextNo(st)
    const t0 = shop.turler[0]
    const o = {
      no,
      a: 0,
      ad,
      tel,
      adr: str(b.adr, 200) || 'Adres yazılmadı',
      saat: SAATLER.includes(str(b.saat)) ? str(b.saat) : '',
      not: str(b.not, 300),
      rugs: [{ m2: 0, n, bf: t0.bf, t: t0.ad }],
      od: [],
      olus: trToday(),
      kaynak: 'musteri',
    }
    await st.db.batch([st.putOrder(o), st.note(key), st.bump()])
    return { no }
  }
  if (action === 'sorgu') {
    const key = `hali:sorgu:${ip}`
    if (await st.limited(key, 30, 15 * 60_000)) throw new HttpError(429, 'too_many')
    await st.note(key).run()
    const q = str(b.q, 30).replace(/^#/, '')
    const digits = q.replace(/\D/g, '')
    let rows = []
    if (digits.length >= 10) {
      rows = (await st.db.prepare('SELECT no, a, data FROM hali_orders WHERE kod = ? AND tel = ? ORDER BY no DESC LIMIT 10').bind(st.kod, telKey(digits)).all()).results
    } else if (/^\d{1,9}$/.test(q)) {
      const r = await st.db.prepare('SELECT no, a, data FROM hali_orders WHERE kod = ? AND no = ?').bind(st.kod, Number(q)).first()
      rows = r ? [r] : []
    } else throw new HttpError(400, 'bad_query')
    // Müşteriye ad ve adres gösterilmez; yalnızca durum ve tutar
    return {
      list: rows.map((r) => {
        const o = { ...JSON.parse(r.data), a: r.a }
        const m = olcu(o)
        return { no: r.no, a: o.a, asama: ASAMA[o.a], msg: MSGM[o.a], saat: o.a < 2 ? o.saat || '' : '', adet: adet(o), olcu: m, tutar: m ? tutar(o) : 0, kalan: m ? kalan(o) : 0 }
      }),
    }
  }
  throw new HttpError(404, 'not_found')
}

async function nextNo(st) {
  // Sayaç tek adımda artar; iki talep aynı anda gelse de numaralar çakışmaz
  const r = await st.db.prepare('UPDATE hali_shops SET next_no = next_no + 1 WHERE kod = ? RETURNING next_no').bind(st.kod).first()
  return r.next_no - 1
}

// --- Halıcı paneli ---
async function session(st, req) {
  const t = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  if (!t) return null
  const s = await st.db
    .prepare("SELECT role FROM sessions WHERE token = ? AND branch_id = ? AND role IN ('hali_yon','hali_per') AND expires > ?")
    .bind(t, st.kod, Date.now())
    .first()
  return s ? { token: t, rol: s.role === 'hali_yon' ? 'yon' : 'per' } : null
}

async function panel(req, st, shop, plat, action, ip, url) {
  if (req.method === 'GET' && action === 'info') return { ad: shop.ad }
  if (req.method === 'POST' && action === 'login') return login(st, await readBody(req), ip)
  // Panel PIN'siz açılır ve personel yetkisiyle çalışır; yönetici işleri yönetici PIN'iyle açılan oturum ister
  const s = (await session(st, req)) || { token: '', rol: 'per' }
  if (action === 'logout' && req.method === 'POST') {
    if (s.token) await st.db.prepare('DELETE FROM sessions WHERE token = ?').bind(s.token).run()
    return { ok: true }
  }
  if (req.method === 'GET' && action === 'state') {
    const v = Number(url.searchParams.get('v') || 0)
    if (v && v === shop.ver) return { same: true }
    return state(st, shop, plat, s.rol)
  }
  if (req.method !== 'POST' || !action) throw new HttpError(404, 'not_found')
  const b = await readBody(req)
  const yon = () => {
    if (s.rol !== 'yon') throw new HttpError(403, 'yonetici')
  }
  const stmts = await write(st, shop, action, b, yon, s.token)
  await st.db.batch([...stmts, st.bump()])
  return state(st, await st.shop(), plat, s.rol)
}

async function login(st, b, ip) {
  const keys = [`hali:pin:${st.kod}:${ip}`, `hali:pin:${st.kod}`]
  if ((await st.limited(keys[0], 8, 15 * 60_000)) || (await st.limited(keys[1], 40, 15 * 60_000))) throw new HttpError(429, 'too_many')
  const pin = b.pin
  const want = b.rol === 'yon' ? ['yon'] : ['per', 'yon']
  let rol = null
  if (validPin(pin)) {
    for (const k of want) {
      const r = await st.db.prepare('SELECT hash FROM secrets WHERE key = ?').bind(`hali:${k}:${st.kod}`).first()
      if (r && (await checkPin(pin, r.hash))) {
        rol = k
        break
      }
    }
  }
  if (!rol) {
    await st.db.batch(keys.map((k) => st.note(k)))
    throw new HttpError(403, 'wrong_pin')
  }
  const token = randomToken()
  const now = Date.now()
  await st.db.batch([
    st.db
      .prepare('INSERT INTO sessions (token, role, branch_id, staff_id, expires) VALUES (?, ?, ?, NULL, ?)')
      .bind(token, rol === 'yon' ? 'hali_yon' : 'hali_per', st.kod, now + (rol === 'yon' ? YON_SESSION : PER_SESSION)),
    st.db.prepare('DELETE FROM sessions WHERE expires < ?').bind(now),
  ])
  return { token, rol }
}

async function state(st, shop, plat, rol) {
  const today = trToday()
  const since = Date.now() - 60 * DAY
  // Personel teslim edilmiş eski siparişleri ve masrafları görmez
  const q =
    rol === 'yon'
      ? st.db.prepare('SELECT no, a, data FROM hali_orders WHERE kod = ? ORDER BY no').bind(st.kod)
      : st.db.prepare('SELECT no, a, data FROM hali_orders WHERE kod = ? AND (a < ? OR updated > ?) ORDER BY no').bind(st.kod, LAST, since)
  const orders = (await q.all()).results.map((r) => ({ ...JSON.parse(r.data), no: r.no, a: r.a }))
  const out = {
    v: shop.ver,
    rol,
    today,
    adres: await st.haliAdres(),
    shop: { ad: shop.ad, wa: shop.wa || '', adres: shop.adres || '', turler: shop.turler },
    orders,
    sabit: { asama: ASAMA, saatler: SAATLER, yontem: YONTEM, gider: GIDER },
  }
  if (rol === 'yon') {
    out.giderler = (await st.db.prepare('SELECT id, tar, data FROM hali_expenses WHERE kod = ? ORDER BY tar DESC').bind(st.kod).all()).results.map((r) => ({
      ...JSON.parse(r.data),
      id: r.id,
      tar: r.tar,
    }))
    out.abonelik = plat ? { bitis: plat.bitis, deneme: !!plat.deneme } : null
  }
  return out
}

function cleanRugs(list, turler) {
  if (!Array.isArray(list) || !list.length || list.length > 40) throw new HttpError(400, 'no_rugs')
  return list.map((r) => {
    const m2 = r2(num(r.m2))
    const n = Math.trunc(num(r.n))
    const t = turler[Math.trunc(num(r.tur))] || turler.find((x) => x.ad === r.t) || turler[0]
    if (!(m2 > 0 && m2 <= 500) || !(n >= 1 && n <= 50)) throw new HttpError(400, 'bad_size')
    return { m2, n, bf: t.bf, t: t.ad }
  })
}

async function write(st, shop, action, b, yon, token) {
  const db = st.db
  switch (action) {
    case 'yeni': {
      const ad = str(b.ad, 80)
      if (!ad) throw new HttpError(400, 'no_name')
      const rugs = cleanRugs(b.rugs, shop.turler)
      const no = await nextNo(st)
      const o = {
        no,
        a: 1,
        ad,
        tel: str(b.tel, 30),
        adr: str(b.adr, 200) || 'Adres yazılmadı',
        saat: SAATLER.includes(str(b.saat)) ? str(b.saat) : '',
        not: str(b.not, 300),
        rugs,
        od: [],
        olus: trToday(),
        kaynak: 'personel',
      }
      return [st.putOrder(o)]
    }
    case 'ileri':
    case 'geri': {
      const o = await st.order(b.no)
      if (Number.isInteger(b.from) && b.from !== o.a) throw new HttpError(409, 'changed')
      const a = o.a + (action === 'ileri' ? 1 : -1)
      if (a < 0 || a > LAST) throw new HttpError(409, 'changed')
      return [st.putOrder({ ...o, a })]
    }
    case 'olcu': {
      const o = await st.order(b.no)
      const m = r2(num(b.m2))
      if (!(m > 0 && m <= 2000)) throw new HttpError(400, 'bad_size')
      const t = shop.turler[Math.trunc(num(b.tur))] || shop.turler[0]
      const c = Math.max(1, adet(o))
      return [st.putOrder({ ...o, rugs: [{ m2: m / c, n: c, bf: t.bf, t: t.ad }] })]
    }
    case 'duzenle': {
      const o = await st.order(b.no)
      const ad = str(b.ad, 80)
      if (!ad) throw new HttpError(400, 'no_name')
      return [st.putOrder({ ...o, ad, tel: str(b.tel, 30), adr: str(b.adr, 200) || 'Adres yazılmadı', not: str(b.not, 300) })]
    }
    case 'ode': {
      const o = await st.order(b.no)
      if (!olcu(o)) throw new HttpError(400, 'no_measure')
      const t = r2(num(b.tut))
      if (!(t > 0)) throw new HttpError(400, 'bad_amount')
      if (t > kalan(o) + 0.01) throw new HttpError(400, 'too_much', { kalan: kalan(o) })
      const y = YONTEM.includes(str(b.yon)) ? str(b.yon) : YONTEM[0]
      return [st.putOrder({ ...o, od: [...(o.od || []), { t: trToday(), tut: t, yon: y }] })]
    }
    case 'odesil': {
      yon()
      const o = await st.order(b.no)
      const i = Math.trunc(num(b.i))
      if (!(o.od || [])[i]) throw new HttpError(404, 'payment_not_found')
      return [st.putOrder({ ...o, od: o.od.filter((_, k) => k !== i) })]
    }
    case 'sil': {
      yon()
      const o = await st.order(b.no)
      return [db.prepare('DELETE FROM hali_orders WHERE kod = ? AND no = ?').bind(st.kod, o.no)]
    }
    case 'gider': {
      yon()
      const t = r2(num(b.tutar))
      if (!(t > 0)) throw new HttpError(400, 'bad_amount')
      const tar = DATE.test(str(b.tar)) ? str(b.tar) : trToday()
      const data = { tur: GIDER.includes(str(b.tur)) ? str(b.tur) : 'Diğer', tutar: t, not: str(b.not, 200) }
      return [db.prepare('INSERT INTO hali_expenses (kod, id, tar, data) VALUES (?, ?, ?, ?)').bind(st.kod, uid(), tar, JSON.stringify(data))]
    }
    case 'gidersil': {
      yon()
      return [db.prepare('DELETE FROM hali_expenses WHERE kod = ? AND id = ?').bind(st.kod, str(b.id, 64))]
    }
    case 'ayar': {
      yon()
      const next = { ad: shop.ad, wa: shop.wa || '', adres: shop.adres || '', turler: shop.turler }
      if (b.ad !== undefined) {
        next.ad = str(b.ad, 80)
        if (!next.ad) throw new HttpError(400, 'no_name')
      }
      if (b.wa !== undefined) {
        const w = str(b.wa, 30)
        if (w && w.replace(/\D/g, '').length < 10) throw new HttpError(400, 'bad_phone')
        next.wa = w
      }
      if (b.adres !== undefined) next.adres = str(b.adres, 200)
      if (b.turler !== undefined) {
        if (!Array.isArray(b.turler) || !b.turler.length || b.turler.length > 12) throw new HttpError(400, 'bad_types')
        next.turler = b.turler.map((t) => {
          const ad = str(t?.ad, 40)
          const bf = r2(num(t?.bf))
          if (!ad || !(bf > 0 && bf <= 100000)) throw new HttpError(400, 'bad_types')
          return { ad, bf }
        })
      }
      return [db.prepare('UPDATE hali_shops SET data = ? WHERE kod = ?').bind(JSON.stringify(next), st.kod)]
    }
    case 'pin': {
      yon()
      const kim = b.kim === 'per' ? 'per' : 'yon'
      const pin = b.pin
      if (!validPin(pin)) throw new HttpError(400, 'bad_pin')
      const other = await db.prepare('SELECT hash FROM secrets WHERE key = ?').bind(`hali:${kim === 'yon' ? 'per' : 'yon'}:${st.kod}`).first()
      if (other && (await checkPin(pin, other.hash))) throw new HttpError(400, 'same_pin')
      // PIN değişince o rolün diğer cihazlardaki oturumları kapanır (değiştiren yönetici açık kalır)
      return [
        db.prepare('INSERT OR REPLACE INTO secrets (key, hash) VALUES (?, ?)').bind(`hali:${kim}:${st.kod}`, await hashPin(pin)),
        db.prepare('DELETE FROM sessions WHERE branch_id = ? AND role = ? AND token != ?').bind(st.kod, `hali_${kim}`, token),
      ]
    }
  }
  throw new HttpError(404, 'not_found')
}

// --- Sayfalar ---
const ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#B0122C"/><g fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><rect x="13" y="14" width="38" height="30" rx="3"/><path d="M32 20l9 9-9 9-9-9z"/><path d="M15 49v4M23 49v4M32 49v4M41 49v4M49 49v4"/></g></svg>`

function manifest(area, kod, ad) {
  return JSON.stringify({
    name: ad || 'Halı Yıkama',
    short_name: area === 's' ? 'Halı Panel' : 'Halım nerede',
    start_url: `/${area}/${kod}`,
    scope: `/${area}/${kod}`,
    display: 'standalone',
    background_color: '#FBF3EA',
    theme_color: '#B0122C',
    icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }],
  })
}

export function makeWorker(APP_HTML) {
  return {
    async fetch(req, env) {
      const url = new URL(req.url)
      const p = url.pathname
      if (p.startsWith('/api/')) return handleApi(req, env)
      if (p === '/icon.svg') return new Response(ICON, { headers: { 'content-type': 'image/svg+xml', 'cache-control': 'public, max-age=86400' } })
      const m = p.match(/^\/(r|s)\/([a-z0-9-]{1,60})\/app\.webmanifest$/)
      if (m) {
        const r = await env.DB.prepare('SELECT data FROM hali_shops WHERE kod = ?').bind(m[2]).first()
        return new Response(manifest(m[1], m[2], r ? JSON.parse(r.data).ad : ''), { headers: { 'content-type': 'application/manifest+json' } })
      }
      if (p === '/robots.txt') return new Response('User-agent: *\nDisallow: /s/\n', { headers: { 'content-type': 'text/plain' } })
      return new Response(APP_HTML, {
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'cache-control': 'no-cache',
          'x-frame-options': 'DENY',
          'referrer-policy': 'no-referrer',
        },
      })
    },
  }
}
