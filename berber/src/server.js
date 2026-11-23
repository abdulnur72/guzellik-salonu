// Berberim: berber uygulamasının sunucusu (Cloudflare Pages, tek _worker.js).
import { PNG_ICONS } from './icons.js'
//
//   /r/<kod>   müşteri sayfası: yalnızca randevu formu, "Randevularım", sıra numarası, iptal
//   /s/<kod>   dükkân paneli: Yönetici, Personel, Randevu, İşletme, Müşteri (PIN ile)
//   /api/...   aşağıdaki uçlar
//
// Kayıtlar güzellik salonu ve halı yıkamayla ortak D1 veritabanında, berber_* tablolarında durur.
// Abonelik ve "Durdur" kilidi sahip panelinin (/patron) plat_shops tablosundan okunur.
//
// Roller:
//   yon  yönetici (dükkân patronu): ciro, gider, net kâr, personel ve prim, ayarlar
//   per  personel: yalnızca kendi müşterisi, kendi kaydı ve kendi payı
//   isl  işletme sahibi: bütün şubelerin özeti, yeni şube (merkez şubenin yönetici PIN'i)

export const VARSAYILAN_HIZMET = [
  { ad: 'Saç kesimi', fiyat: 300 },
  { ad: 'Sakal', fiyat: 150 },
  { ad: 'Saç + sakal', fiyat: 400 },
  { ad: 'Çocuk tıraşı', fiyat: 200 },
  { ad: 'Yıkama + fön', fiyat: 100 },
  { ad: 'Cilt bakımı', fiyat: 350 },
]
export const GIDER = ['Kira', 'Elektrik', 'Su', 'Doğalgaz', 'Malzeme (jilet, köpük, kolonya)', 'Personel maaşı', 'Çay / ikram', 'Bakım / tamir', 'Diğer']
export const VARSAYILAN_PRIM = 40
const VARSAYILAN = { gunbas: '06:00', acilis: '09:00', kapanis: '22:00', aralik: 30 }
const ODEME = ['nakit', 'kart']
const ILERI_GUN = 30 // müşteri en fazla 30 gün sonrasına randevu alır

const DAY = 86_400_000
const PER_SESSION = 120 * DAY // personel telefonda açık kalır
const YON_SESSION = 12 * 3600_000 // yönetici günde bir PIN girer
const DATE = /^\d{4}-\d{2}-\d{2}$/
const SAAT = /^([01]\d|2[0-3]):[0-5]\d$/

export class HttpError extends Error {
  constructor(status, code, extra) {
    super(code)
    this.status = status
    this.extra = extra
  }
}

// --- Yardımcılar ---
const fmtTR = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
/** Türkiye saatiyle {tarih, dakika} */
export function trNow(ms = Date.now()) {
  const p = Object.fromEntries(fmtTR.formatToParts(new Date(ms)).map((x) => [x.type, x.value]))
  return { tar: `${p.year}-${p.month}-${p.day}`, dk: Number(p.hour) * 60 + Number(p.minute) }
}
export const dkOf = (s) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5))
export function addDay(d, n) {
  const x = new Date(d + 'T12:00:00Z')
  x.setUTCDate(x.getUTCDate() + n)
  return x.toISOString().slice(0, 10)
}
/**
 * İş günü: gün başlangıç saatinden (örn. 06:00) ertesi gün aynı saate kadar.
 * Gece yarısından sonra yapılan iş bir önceki güne yazılır; gece vardiyası bölünmez.
 * Dönen "dk": iş günü başından bu yana geçen dakika.
 */
export function isGunu(gunbas = VARSAYILAN.gunbas, ms = Date.now()) {
  const gb = dkOf(gunbas)
  const n = trNow(ms)
  return n.dk >= gb ? { gun: n.tar, dk: n.dk - gb } : { gun: addDay(n.tar, -1), dk: n.dk + 1440 - gb }
}
/** Bir saatin iş günü başından itibaren dakikası (gece 01:00 → 06:00 başlangıçta 1140) */
export const isDk = (saat, gunbas) => (dkOf(saat) - dkOf(gunbas) + 1440) % 1440

const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : typeof v === 'number' ? String(v).slice(0, max) : '')
const num = (v) => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(',', '.'))
  return Number.isFinite(n) ? n : NaN
}
const r2 = (n) => Math.round(n * 100) / 100
export const telKey = (t) => String(t || '').replace(/\D/g, '').slice(-10)
/** Türkiye cep telefonu: 05xx xxx xx xx (başında +90, 90 ya da 0 olabilir) */
export function validTel(t) {
  let d = String(t || '').replace(/\D/g, '')
  if (d.length === 12 && d.startsWith('90')) d = d.slice(2)
  else if (d.length === 11 && d.startsWith('0')) d = d.slice(1)
  return d.length === 10 && d[0] === '5'
}
const uid = () => crypto.randomUUID().replace(/-/g, '').slice(0, 12)
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
function randomToken(bytes = 24) {
  const a = new Uint8Array(bytes)
  crypto.getRandomValues(a)
  return hex(a.buffer)
}
const sha = async (s) => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)))
// Sahip panelindeki PIN özetiyle aynı biçim: tuz$sha256(tuz:pin)
export async function hashPin(pin, salt = randomToken(8)) {
  return `${salt}$${await sha(`${salt}:${pin}`)}`
}
async function checkPin(pin, stored) {
  return !!stored && (await hashPin(pin, stored.split('$')[0])) === stored
}
const validPin = (p) => typeof p === 'string' && /^\d{4,8}$/.test(p)

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })

async function readBody(req) {
  if (Number(req.headers.get('content-length') || 0) > 100_000) throw new HttpError(413, 'too_large')
  try {
    const v = await req.json()
    if (v && typeof v === 'object') return v
  } catch {}
  throw new HttpError(400, 'bad_json')
}

/** Dükkân ayarlarını eksiksiz hale getirir */
export function normShop(d) {
  const s = { ad: str(d.ad, 80) || 'Berber', wa: str(d.wa, 30), adres: str(d.adres, 200), ...VARSAYILAN }
  for (const k of ['gunbas', 'acilis', 'kapanis']) if (SAAT.test(d[k] || '')) s[k] = d[k]
  if ([15, 20, 30, 45, 60].includes(d.aralik)) s.aralik = d.aralik
  s.hizmetler = Array.isArray(d.hizmetler) && d.hizmetler.length ? d.hizmetler : VARSAYILAN_HIZMET
  s.personel = Array.isArray(d.personel) ? d.personel : []
  return s
}
const aktifPer = (shop) => shop.personel.filter((p) => p.aktif !== false)

/** Randevu saatleri (iş günü içinde, açılıştan kapanıştan bir aralık öncesine kadar) */
export function slotlar(shop) {
  const a = isDk(shop.acilis, shop.gunbas)
  let k = isDk(shop.kapanis, shop.gunbas)
  if (k <= a) k = 1440
  const gb = dkOf(shop.gunbas)
  const out = []
  for (let d = a; d + shop.aralik <= k; d += shop.aralik) {
    const m = (d + gb) % 1440
    out.push(String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'))
  }
  return out
}

// --- Veritabanı erişimi ---
class Store {
  constructor(db, kod) {
    this.db = db
    this.kod = kod
  }
  async plat(kod = this.kod) {
    const r = await this.db.prepare('SELECT data FROM plat_shops WHERE kod = ?').bind(kod).first()
    return r ? JSON.parse(r.data) : null
  }
  async patronWa() {
    const r = await this.db.prepare("SELECT data FROM plat_kv WHERE k = 'ayar'").first()
    return r ? str(JSON.parse(r.data).wa, 30) : ''
  }
  async shop(kod = this.kod) {
    const r = await this.db.prepare('SELECT isl, data, ver FROM berber_shops WHERE kod = ?').bind(kod).first()
    if (!r) return null
    return { ...normShop(JSON.parse(r.data)), kod, isl: r.isl, ver: r.ver }
  }
  putShop(shop) {
    const { kod, isl, ver, ...data } = shop
    return this.db.prepare('UPDATE berber_shops SET data = ? WHERE kod = ?').bind(JSON.stringify(data), this.kod)
  }
  bump() {
    return this.db.prepare('UPDATE berber_shops SET ver = ver + 1 WHERE kod = ?').bind(this.kod)
  }
  async randevu(id) {
    const r = await this.db.prepare('SELECT id, gun, data FROM berber_randevu WHERE kod = ? AND id = ?').bind(this.kod, str(id, 40)).first()
    if (!r) throw new HttpError(404, 'not_found_randevu')
    return { ...JSON.parse(r.data), id: r.id, gun: r.gun }
  }
  putRandevu(o) {
    const { id, gun, ...data } = o
    return this.db
      .prepare(
        'INSERT INTO berber_randevu (kod, id, gun, tel, data, updated) VALUES (?1, ?2, ?3, ?4, ?5, ?6) ' +
          'ON CONFLICT (kod, id) DO UPDATE SET gun = excluded.gun, tel = excluded.tel, data = excluded.data, updated = excluded.updated',
      )
      .bind(this.kod, id, gun, telKey(o.tel), JSON.stringify(data), Date.now())
  }
  async gunRandevu(gun) {
    const { results } = await this.db.prepare('SELECT id, gun, data FROM berber_randevu WHERE kod = ? AND gun = ?').bind(this.kod, gun).all()
    return results.map((r) => ({ ...JSON.parse(r.data), id: r.id, gun: r.gun }))
  }
  async kayit(id) {
    const r = await this.db.prepare('SELECT id, gun, data FROM berber_kayit WHERE kod = ? AND id = ?').bind(this.kod, str(id, 40)).first()
    if (!r) throw new HttpError(404, 'not_found_kayit')
    return { ...JSON.parse(r.data), id: r.id, gun: r.gun }
  }
  putKayit(k) {
    const { id, gun, ...data } = k
    return this.db.prepare('INSERT INTO berber_kayit (kod, id, gun, data) VALUES (?, ?, ?, ?)').bind(this.kod, id, gun, JSON.stringify(data))
  }
  delKayit(id) {
    return this.db.prepare('DELETE FROM berber_kayit WHERE kod = ? AND id = ?').bind(this.kod, id)
  }
  async nextSira(gun) {
    // Sayaç tek adımda artar; iki randevu aynı anda gelse de numaralar çakışmaz
    const r = await this.db
      .prepare('INSERT INTO berber_sira (kod, gun, n) VALUES (?1, ?2, 1) ON CONFLICT (kod, gun) DO UPDATE SET n = n + 1 RETURNING n')
      .bind(this.kod, gun)
      .first()
    return r.n
  }
  async secret(key) {
    const r = await this.db.prepare('SELECT hash FROM secrets WHERE key = ?').bind(key).first()
    return r ? r.hash : null
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

/** Abonelik kilidi: sahip panelinde süresi biten ya da durdurulan dükkân */
const isLocked = (p, today = trNow().tar) => !!p && (!!p.dur || String(p.bitis || '') < today)

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
      if (plat && plat.sektor === 'Berber') throw new HttpError(409, 'setup', { ad: plat.ad })
      throw new HttpError(404, 'shop_not_found')
    }
    if (isLocked(plat)) {
      throw new HttpError(402, 'locked', area === 'r' ? { ad: shop.ad, tel: shop.wa } : { ad: shop.ad, wa: await st.patronWa() })
    }
    if (area === 'r') return json(await customer(req, st, shop, rest[0], ip, url))
    if (rest[0] === 'isl') return json(await isletme(req, st, shop, rest[1], url))
    return json(await panel(req, st, shop, plat, rest[0], ip, url))
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message, ...(e.extra || {}) }, e.status)
    console.error(e)
    return json({ error: 'server' }, 500)
  }
}

// --- Müşteri (herkese açık) ---
export function publicShop(s) {
  const g = isGunu(s.gunbas)
  return {
    ad: s.ad,
    wa: s.wa || '',
    adres: s.adres || '',
    hizmetler: s.hizmetler.map((h) => ({ ad: h.ad, fiyat: h.fiyat })),
    personel: aktifPer(s).map((p) => ({ id: p.id, ad: p.ad })),
    gun: g.gun,
    dk: g.dk,
    gunbas: s.gunbas,
    slotlar: slotlar(s),
    ileri: ILERI_GUN,
  }
}

/** Bir günün saatlerinin doluluğu. per: '' = fark etmez */
function doluluk(shop, list, per) {
  const cap = Math.max(1, aktifPer(shop).length)
  const say = {}
  const kisi = {}
  for (const r of list) {
    if (r.durum === 'iptal' || !r.saat) continue
    say[r.saat] = (say[r.saat] || 0) + 1
    if (r.per) kisi[r.saat + '|' + r.per] = true
  }
  return (saat) => (say[saat] || 0) < cap && !(per && kisi[saat + '|' + per])
}
const gecmis = (shop, gun, saat) => {
  const g = isGunu(shop.gunbas)
  return gun < g.gun || (gun === g.gun && isDk(saat, shop.gunbas) <= g.dk)
}
/** Sırada önünde bekleyen kişi sayısı (aynı berber ya da "fark etmez") */
function onunde(list, r) {
  return list.filter((x) => x.durum === 'bekliyor' && !x.saat && x.sira < r.sira && (!r.per || !x.per || x.per === r.per)).length
}

async function customer(req, st, shop, action, ip, url) {
  if (req.method === 'GET' && action === 'info') return publicShop(shop)
  if (req.method === 'GET' && action === 'bos') {
    const gun = str(url.searchParams.get('gun'), 10)
    if (!DATE.test(gun)) throw new HttpError(400, 'bad_date')
    const per = str(url.searchParams.get('per'), 20)
    const bos = doluluk(shop, await st.gunRandevu(gun), per)
    return { gun, slotlar: slotlar(shop).map((s) => ({ s, ok: !gecmis(shop, gun, s) && bos(s) })) }
  }
  if (req.method !== 'POST') throw new HttpError(404, 'not_found')
  const b = await readBody(req)
  if (action === 'al') {
    const key = `berber:al:${ip}`
    if (await st.limited(key, 8, 3600_000)) throw new HttpError(429, 'too_many')
    const r = await yeniRandevu(st, shop, b, 'musteri')
    const k = randomToken(16)
    r.k = await sha(k)
    await st.db.batch([st.putRandevu(r), st.note(key), st.bump()])
    const list = await st.gunRandevu(r.gun)
    return { id: r.id, key: k, gun: r.gun, saat: r.saat, sira: r.sira, onunde: r.saat ? 0 : onunde(list, r), per: perAd(shop, r.per), hz: r.hz }
  }
  if (action === 'benim') {
    const key = `berber:benim:${ip}`
    if (await st.limited(key, 30, 15 * 60_000)) throw new HttpError(429, 'too_many')
    await st.note(key).run()
    if (!validTel(b.tel)) throw new HttpError(400, 'bad_phone')
    const g = isGunu(shop.gunbas).gun
    const { results } = await st.db
      .prepare('SELECT id, gun, data FROM berber_randevu WHERE kod = ? AND tel = ? AND gun >= ? ORDER BY gun, id LIMIT 20')
      .bind(st.kod, telKey(b.tel), g)
      .all()
    const rows = results.map((r) => ({ ...JSON.parse(r.data), id: r.id, gun: r.gun })).filter((r) => r.durum !== 'iptal')
    const gunler = {}
    const out = []
    for (const r of rows) {
      if (!gunler[r.gun]) gunler[r.gun] = await st.gunRandevu(r.gun)
      out.push({ id: r.id, gun: r.gun, saat: r.saat, sira: r.sira, durum: r.durum, hz: r.hz, per: perAd(shop, r.per), onunde: r.saat || r.durum !== 'bekliyor' ? 0 : onunde(gunler[r.gun], r) })
    }
    out.sort((a, c) => (a.gun + (a.saat ? isDk(a.saat, shop.gunbas) : 0)).localeCompare(c.gun + (c.saat ? isDk(c.saat, shop.gunbas) : 0)))
    return { list: out }
  }
  if (action === 'iptal') {
    const key = `berber:iptal:${ip}`
    if (await st.limited(key, 20, 3600_000)) throw new HttpError(429, 'too_many')
    const r = await st.randevu(b.id)
    if (!r.k || r.k !== (await sha(str(b.key, 64)))) {
      await st.note(key).run()
      throw new HttpError(403, 'not_yours')
    }
    if (r.durum !== 'bekliyor') throw new HttpError(409, 'changed')
    await st.db.batch([st.putRandevu({ ...r, durum: 'iptal', iptal: 'musteri' }), st.bump()])
    return { ok: true }
  }
  throw new HttpError(404, 'not_found')
}
const perAd = (shop, id) => (id ? shop.personel.find((p) => p.id === id)?.ad || '' : '')

/** Müşteri ya da panelden gelen randevu/sıra talebini doğrular */
async function yeniRandevu(st, shop, b, kaynak, zorlaPer) {
  const ad = str(b.ad, 60)
  const tel = str(b.tel, 30)
  if (!ad) throw new HttpError(400, 'no_name')
  if (kaynak === 'musteri' || tel) if (!validTel(tel)) throw new HttpError(400, 'bad_phone')
  const g = isGunu(shop.gunbas)
  const gun = str(b.gun, 10) || g.gun
  if (!DATE.test(gun)) throw new HttpError(400, 'bad_date')
  if (gun < g.gun) throw new HttpError(400, 'past_date')
  if (gun > addDay(g.gun, ILERI_GUN)) throw new HttpError(400, 'too_far')
  const saat = str(b.saat, 5)
  if (saat && !slotlar(shop).includes(saat)) throw new HttpError(400, 'bad_time')
  if (!saat && gun !== g.gun) throw new HttpError(400, 'sira_today') // sıraya yalnızca bugün girilir
  if (saat && gecmis(shop, gun, saat)) throw new HttpError(400, 'past_time')
  let per = zorlaPer ?? str(b.per, 20)
  if (per && !aktifPer(shop).some((p) => p.id === per)) per = ''
  const hz = shop.hizmetler.find((h) => h.ad === str(b.hz, 60)) || shop.hizmetler[0]
  const list = await st.gunRandevu(gun)
  if (kaynak === 'musteri') {
    const ayni = list.filter((r) => r.durum === 'bekliyor' && telKey(r.tel) === telKey(tel)).length
    if (ayni >= 3) throw new HttpError(429, 'too_many_same')
  }
  if (saat && !doluluk(shop, list, per)(saat)) throw new HttpError(409, 'slot_taken')
  return { id: uid(), gun, ad, tel, saat, per, hz: hz.ad, fiyat: hz.fiyat, sira: await st.nextSira(gun), durum: 'bekliyor', kaynak, olus: Date.now() }
}

// --- Dükkân paneli ---
async function session(st, req, roles) {
  const t = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  if (!t) return null
  const s = await st.db
    .prepare(`SELECT role, branch_id, staff_id FROM sessions WHERE token = ? AND role IN (${roles.map(() => '?').join(',')}) AND expires > ?`)
    .bind(t, ...roles, Date.now())
    .first()
  return s ? { token: t, rol: s.role.slice(7), kod: s.branch_id, per: s.staff_id || '' } : null
}

async function panel(req, st, shop, plat, action, ip, url) {
  if (req.method === 'GET' && action === 'info') return { ad: shop.ad }
  if (req.method === 'POST' && action === 'login') return login(st, shop, await readBody(req), ip)
  const s = await session(st, req, ['berber_yon', 'berber_per'])
  if (action === 'logout' && req.method === 'POST') {
    if (s) await st.db.prepare('DELETE FROM sessions WHERE token = ?').bind(s.token).run()
    return { ok: true }
  }
  if (!s || s.kod !== st.kod) throw new HttpError(401, 'login')
  if (s.rol === 'per' && !aktifPer(shop).some((p) => p.id === s.per)) throw new HttpError(401, 'login')
  if (req.method === 'GET' && action === 'state') {
    const v = Number(url.searchParams.get('v') || 0)
    if (v && v === shop.ver) return { same: true }
    return state(st, shop, plat, s)
  }
  if (req.method !== 'POST' || !action) throw new HttpError(404, 'not_found')
  const b = await readBody(req)
  const stmts = await write(st, shop, action, b, s)
  await st.db.batch([...stmts, st.bump()])
  return state(st, await st.shop(), plat, s)
}

async function login(st, shop, b, ip) {
  const keys = [`berber:pin:${st.kod}:${ip}`, `berber:pin:${st.kod}`]
  if ((await st.limited(keys[0], 8, 15 * 60_000)) || (await st.limited(keys[1], 40, 15 * 60_000))) throw new HttpError(429, 'too_many')
  const pin = b.pin
  let rol = null
  let per = null
  let kod = st.kod
  if (validPin(pin)) {
    if (b.rol === 'isl') {
      // İşletme sahibi: merkez şubenin yönetici PIN'i
      if (await checkPin(pin, await st.secret(`berber:yon:${shop.isl}`))) {
        rol = 'isl'
        kod = shop.isl
      }
    } else {
      if (await checkPin(pin, await st.secret(`berber:yon:${st.kod}`))) rol = 'yon'
      if (!rol && b.rol !== 'yon') {
        for (const p of aktifPer(shop)) {
          if (await checkPin(pin, await st.secret(`berber:per:${st.kod}:${p.id}`))) {
            rol = 'per'
            per = p.id
            break
          }
        }
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
      .prepare('INSERT INTO sessions (token, role, branch_id, staff_id, expires) VALUES (?, ?, ?, ?, ?)')
      .bind(token, 'berber_' + rol, kod, per, now + (rol === 'per' ? PER_SESSION : YON_SESSION)),
    st.db.prepare('DELETE FROM sessions WHERE expires < ?').bind(now),
  ])
  return { token, rol, per }
}

const kayitRows = async (st, since) =>
  (await st.db.prepare('SELECT id, gun, data FROM berber_kayit WHERE kod = ? AND gun >= ? ORDER BY gun, id').bind(st.kod, since).all()).results.map((r) => ({
    ...JSON.parse(r.data),
    id: r.id,
    gun: r.gun,
  }))

async function state(st, shop, plat, s) {
  const g = isGunu(shop.gunbas)
  const yon = s.rol === 'yon'
  // Randevular: dünden itibaren (gece vardiyası ve "Geri al" için) ileri tarihlere kadar
  const rows = (await st.db.prepare('SELECT id, gun, data FROM berber_randevu WHERE kod = ? AND gun >= ? ORDER BY gun').bind(st.kod, addDay(g.gun, -1)).all()).results.map(
    (r) => ({ ...JSON.parse(r.data), id: r.id, gun: r.gun }),
  )
  // Personel yalnızca kendisine ve henüz kimseye verilmemiş ("fark etmez") müşterileri görür
  const randevular = rows
    .filter((r) => yon || r.per === s.per || (!r.per && r.durum === 'bekliyor'))
    .map(({ k, ...r }) => r)
  // Ay raporu için yaklaşık iki aylık kayıt
  const since = addDay(g.gun, -62)
  const kayitlar = (await kayitRows(st, since)).filter((k) => yon || k.per === s.per)
  const out = {
    v: shop.ver,
    rol: s.rol,
    me: s.per,
    gun: g.gun,
    dk: g.dk,
    shop: {
      ad: shop.ad,
      wa: shop.wa,
      adres: shop.adres,
      gunbas: shop.gunbas,
      acilis: shop.acilis,
      kapanis: shop.kapanis,
      aralik: shop.aralik,
      hizmetler: shop.hizmetler,
      slotlar: slotlar(shop),
      // Personel diğerlerinin prim oranını görmez
      personel: shop.personel.map((p) => (yon || p.id === s.per ? p : { id: p.id, ad: p.ad, aktif: p.aktif })),
      cokSube: false,
    },
    randevular,
    kayitlar,
    sabit: { gider: GIDER, prim: VARSAYILAN_PRIM },
  }
  const n = (await st.db.prepare('SELECT COUNT(*) AS n FROM berber_shops WHERE isl = ?').bind(shop.isl).first()).n
  out.shop.cokSube = n > 1
  out.shop.merkez = shop.isl === shop.kod
  if (yon) {
    out.giderler = (await st.db.prepare('SELECT id, gun, data FROM berber_gider WHERE kod = ? AND gun >= ? ORDER BY gun DESC').bind(st.kod, since).all()).results.map((r) => ({
      ...JSON.parse(r.data),
      id: r.id,
      gun: r.gun,
    }))
    out.abonelik = plat ? { bitis: plat.bitis, deneme: !!plat.deneme } : null
  }
  return out
}

/** PIN, dükkândaki diğer PIN'lerden (yönetici ve diğer personel) farklı olmalı */
async function pinBos(st, shop, pin, kendi) {
  if (kendi !== 'yon' && (await checkPin(pin, await st.secret(`berber:yon:${st.kod}`)))) throw new HttpError(400, 'same_pin_yon')
  for (const p of aktifPer(shop)) {
    if (p.id === kendi) continue
    if (await checkPin(pin, await st.secret(`berber:per:${st.kod}:${p.id}`))) throw new HttpError(400, kendi === 'yon' ? 'same_pin_per' : 'same_pin_other')
  }
}

function cleanSaat(v, def) {
  const s = str(v, 5)
  if (!s) return def
  if (!SAAT.test(s)) throw new HttpError(400, 'bad_time')
  return s
}

async function write(st, shop, action, b, s) {
  const db = st.db
  const yon = s.rol === 'yon'
  const needYon = () => {
    if (!yon) throw new HttpError(403, 'yonetici')
  }
  const g = isGunu(shop.gunbas)
  /** Personel yalnızca kendi ve sahipsiz randevusuna dokunur */
  const benimR = (r) => {
    if (!yon && r.per && r.per !== s.per) throw new HttpError(403, 'not_yours')
  }
  const kayitYap = (per, hz, tutar, od, extra = {}) => {
    const p = shop.personel.find((x) => x.id === per)
    if (!p) throw new HttpError(400, 'no_staff')
    if (!ODEME.includes(od)) throw new HttpError(400, 'bad_payment')
    if (!(tutar >= 0 && tutar <= 100000)) throw new HttpError(400, 'bad_amount')
    return { id: uid(), gun: g.gun, per, hz, tutar: r2(tutar), od, prim: Number.isFinite(p.prim) ? p.prim : VARSAYILAN_PRIM, ts: Date.now(), ...extra }
  }
  switch (action) {
    case 'kayit': {
      const per = yon ? str(b.per, 20) : s.per
      const h = shop.hizmetler.find((x) => x.ad === str(b.hz, 60))
      const hz = h ? h.ad : str(b.hz, 60)
      if (!hz) throw new HttpError(400, 'no_service')
      const tutar = b.tutar === undefined || b.tutar === '' ? (h ? h.fiyat : NaN) : r2(num(b.tutar))
      if (!(tutar > 0)) throw new HttpError(400, 'bad_amount')
      return [st.putKayit(kayitYap(per, hz, tutar, str(b.od, 10), { mus: str(b.mus, 60) }))]
    }
    case 'kayitsil': {
      const k = await st.kayit(b.id)
      if (!yon && (k.per !== s.per || k.gun !== g.gun)) throw new HttpError(403, 'not_yours')
      const out = [st.delKayit(k.id)]
      if (k.rid) {
        // Randevudan gelen kayıt silinince randevu yeniden "bekliyor" olur
        try {
          const r = await st.randevu(k.rid)
          if (r.kayit === k.id) out.push(st.putRandevu({ ...r, durum: 'bekliyor', kayit: '' }))
        } catch {}
      }
      return out
    }
    case 'randevu': {
      // Personelin eklediği müşteri kendisine yazılır
      const r = await yeniRandevu(st, shop, b, 'panel', yon ? undefined : s.per)
      return [st.putRandevu(r)]
    }
    case 'geldi': {
      const r = await st.randevu(b.id)
      benimR(r)
      if (r.durum !== 'bekliyor') throw new HttpError(409, 'changed')
      const per = r.per || (yon ? str(b.per, 20) : s.per)
      if (!per) throw new HttpError(400, 'no_staff')
      const h = shop.hizmetler.find((x) => x.ad === r.hz)
      const tutar = b.tutar === undefined || b.tutar === '' ? (h ? h.fiyat : r.fiyat) : r2(num(b.tutar))
      if (!(tutar > 0)) throw new HttpError(400, 'bad_amount')
      // Ciro, randevunun değil hizmetin yapıldığı iş gününe yazılır
      const k = kayitYap(per, r.hz, tutar, str(b.od, 10), { rid: r.id, mus: r.ad })
      return [st.putKayit(k), st.putRandevu({ ...r, per, durum: 'geldi', kayit: k.id })]
    }
    case 'gerial': {
      const r = await st.randevu(b.id)
      benimR(r)
      if (r.durum === 'geldi') {
        return [...(r.kayit ? [st.delKayit(r.kayit)] : []), st.putRandevu({ ...r, durum: 'bekliyor', kayit: '' })]
      }
      if (r.durum === 'iptal') return [st.putRandevu({ ...r, durum: 'bekliyor', iptal: '' })]
      throw new HttpError(409, 'changed')
    }
    case 'iptal': {
      const r = await st.randevu(b.id)
      benimR(r)
      if (r.durum !== 'bekliyor') throw new HttpError(409, 'changed')
      return [st.putRandevu({ ...r, durum: 'iptal', iptal: 'dukkan' })]
    }
    case 'ustlen': {
      const r = await st.randevu(b.id)
      if (r.per) throw new HttpError(409, 'changed')
      const per = yon ? str(b.per, 20) : s.per
      if (!aktifPer(shop).some((p) => p.id === per)) throw new HttpError(400, 'no_staff')
      if (r.saat && r.durum === 'bekliyor') {
        const list = (await st.gunRandevu(r.gun)).filter((x) => x.id !== r.id)
        if (list.some((x) => x.durum !== 'iptal' && x.saat === r.saat && x.per === per)) throw new HttpError(409, 'slot_taken')
      }
      return [st.putRandevu({ ...r, per })]
    }
    case 'gider': {
      needYon()
      const t = r2(num(b.tutar))
      if (!(t > 0)) throw new HttpError(400, 'bad_amount')
      const gun = DATE.test(str(b.gun)) ? str(b.gun) : g.gun
      const data = { tur: GIDER.includes(str(b.tur)) ? str(b.tur) : 'Diğer', tutar: t, not: str(b.not, 200) }
      return [db.prepare('INSERT INTO berber_gider (kod, id, gun, data) VALUES (?, ?, ?, ?)').bind(st.kod, uid(), gun, JSON.stringify(data))]
    }
    case 'gidersil': {
      needYon()
      return [db.prepare('DELETE FROM berber_gider WHERE kod = ? AND id = ?').bind(st.kod, str(b.id, 64))]
    }
    case 'ayar': {
      needYon()
      const next = { ...shop }
      if (b.ad !== undefined) {
        next.ad = str(b.ad, 80)
        if (!next.ad) throw new HttpError(400, 'no_name')
      }
      if (b.wa !== undefined) {
        const w = str(b.wa, 30)
        if (w && !validTel(w)) throw new HttpError(400, 'bad_phone')
        next.wa = w
      }
      if (b.adres !== undefined) next.adres = str(b.adres, 200)
      next.gunbas = cleanSaat(b.gunbas, shop.gunbas)
      next.acilis = cleanSaat(b.acilis, shop.acilis)
      next.kapanis = cleanSaat(b.kapanis, shop.kapanis)
      if (b.aralik !== undefined) {
        const a = Math.trunc(num(b.aralik))
        if (![15, 20, 30, 45, 60].includes(a)) throw new HttpError(400, 'bad_step')
        next.aralik = a
      }
      if (b.hizmetler !== undefined) {
        if (!Array.isArray(b.hizmetler) || !b.hizmetler.length || b.hizmetler.length > 20) throw new HttpError(400, 'bad_services')
        const seen = new Set()
        next.hizmetler = b.hizmetler.map((h) => {
          const ad = str(h?.ad, 40)
          const fiyat = r2(num(h?.fiyat))
          if (!ad || seen.has(ad) || !(fiyat > 0 && fiyat <= 100000)) throw new HttpError(400, 'bad_services')
          seen.add(ad)
          return { ad, fiyat }
        })
      }
      return [st.putShop(next)]
    }
    case 'personel': {
      // Ekle ya da düzenle (ad, prim oranı). Yeni personele PIN de verilir.
      needYon()
      const ad = str(b.ad, 40)
      if (!ad) throw new HttpError(400, 'no_name')
      const primRaw = b.prim === undefined || b.prim === '' || b.prim === null ? NaN : num(b.prim)
      const id = str(b.id, 20)
      const list = shop.personel.slice()
      if (id) {
        const i = list.findIndex((p) => p.id === id)
        if (i < 0) throw new HttpError(404, 'no_staff')
        const prim = Number.isFinite(primRaw) ? primRaw : list[i].prim
        if (!(prim >= 0 && prim <= 100)) throw new HttpError(400, 'bad_rate')
        list[i] = { ...list[i], ad, prim: r2(prim) }
        return [st.putShop({ ...shop, personel: list })]
      }
      if (aktifPer(shop).length >= 30) throw new HttpError(400, 'too_many_staff')
      const prim = Number.isFinite(primRaw) ? primRaw : VARSAYILAN_PRIM
      if (!(prim >= 0 && prim <= 100)) throw new HttpError(400, 'bad_rate')
      if (!validPin(b.pin)) throw new HttpError(400, 'bad_pin')
      await pinBos(st, shop, b.pin, '__yeni')
      const p = { id: uid().slice(0, 8), ad, prim: r2(prim), aktif: true }
      list.push(p)
      return [st.putShop({ ...shop, personel: list }), db.prepare('INSERT OR REPLACE INTO secrets (key, hash) VALUES (?, ?)').bind(`berber:per:${st.kod}:${p.id}`, await hashPin(b.pin))]
    }
    case 'personelsil': {
      // Geçmiş kayıtlarda adı görünsün diye silinmez, pasif olur; PIN'i ve oturumları kapanır
      needYon()
      const id = str(b.id, 20)
      if (!shop.personel.some((p) => p.id === id)) throw new HttpError(404, 'no_staff')
      return [
        st.putShop({ ...shop, personel: shop.personel.map((p) => (p.id === id ? { ...p, aktif: false } : p)) }),
        db.prepare('DELETE FROM secrets WHERE key = ?').bind(`berber:per:${st.kod}:${id}`),
        db.prepare("DELETE FROM sessions WHERE role = 'berber_per' AND branch_id = ? AND staff_id = ?").bind(st.kod, id),
      ]
    }
    case 'perpin': {
      // Yönetici personelin PIN'ini yeniler; personel kendi PIN'ini değiştirir
      const id = yon ? str(b.id, 20) : s.per
      if (!aktifPer(shop).some((p) => p.id === id)) throw new HttpError(404, 'no_staff')
      if (!validPin(b.pin)) throw new HttpError(400, 'bad_pin')
      await pinBos(st, shop, b.pin, id)
      return [
        db.prepare('INSERT OR REPLACE INTO secrets (key, hash) VALUES (?, ?)').bind(`berber:per:${st.kod}:${id}`, await hashPin(b.pin)),
        db.prepare("DELETE FROM sessions WHERE role = 'berber_per' AND branch_id = ? AND staff_id = ? AND token != ?").bind(st.kod, id, s.token),
      ]
    }
    case 'pin': {
      needYon()
      if (!validPin(b.pin)) throw new HttpError(400, 'bad_pin')
      await pinBos(st, shop, b.pin, 'yon')
      return [
        db.prepare('INSERT OR REPLACE INTO secrets (key, hash) VALUES (?, ?)').bind(`berber:yon:${st.kod}`, await hashPin(b.pin)),
        db.prepare("DELETE FROM sessions WHERE role IN ('berber_yon', 'berber_isl') AND branch_id = ? AND token != ?").bind(st.kod, s.token),
      ]
    }
  }
  throw new HttpError(404, 'not_found')
}

// --- İşletme (çok şubeli) ---
async function isletme(req, st, shop, action, url) {
  const s = await session(st, req, ['berber_isl'])
  if (!s || s.kod !== shop.isl) throw new HttpError(401, 'login')
  const subeler = (await st.db.prepare('SELECT kod FROM berber_shops WHERE isl = ? ORDER BY rowid').bind(shop.isl).all()).results.map((r) => r.kod)
  if (req.method === 'GET' && action === 'ozet') {
    const g = isGunu(shop.gunbas)
    const since = addDay(g.gun, -62)
    const out = []
    for (const kod of subeler) {
      const o = new Store(st.db, kod)
      const sh = await o.shop()
      const pl = await o.plat()
      const kayit = (await kayitRows(o, since)).map((k) => ({ gun: k.gun, tutar: k.tutar, od: k.od, prim: k.prim, per: k.per }))
      const gider = (await st.db.prepare('SELECT gun, data FROM berber_gider WHERE kod = ? AND gun >= ?').bind(kod, since).all()).results.map((r) => ({ gun: r.gun, tutar: JSON.parse(r.data).tutar }))
      const bekleyen = (await st.db.prepare("SELECT COUNT(*) AS n FROM berber_randevu WHERE kod = ? AND gun = ? AND json_extract(data, '$.durum') = 'bekliyor'").bind(kod, isGunu(sh.gunbas).gun).first()).n
      out.push({ kod, ad: sh.ad, kilit: isLocked(pl), bitis: pl?.bitis || '', personel: aktifPer(sh).length, bekleyen, kayit, gider })
    }
    const ayar = await st.db.prepare("SELECT data FROM plat_kv WHERE k = 'ayar'").first()
    return { gun: g.gun, merkez: shop.isl, subeler: out, ekUcret: ayar ? Math.round(num(JSON.parse(ayar.data).sube)) || 0 : 0 }
  }
  if (req.method === 'POST' && action === 'sube') {
    const b = await readBody(req)
    return yeniSube(st, shop, b)
  }
  throw new HttpError(404, 'not_found')
}

export function slug(t) {
  return String(t ?? '')
    .toLocaleLowerCase('tr-TR')
    .replace(/ç/g, 'c').replace(/ğ/g, 'g').replace(/ı/g, 'i').replace(/i̇/g, 'i').replace(/ö/g, 'o').replace(/ş/g, 's').replace(/ü/g, 'u')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

/**
 * Yeni şube: kendi linki, kendi yönetici PIN'i olan ayrı bir dükkân.
 * Sahip panelinde aynı işletme adıyla görünür; ilave şube ücreti orada eklenir.
 * Süresi merkez şubeyle aynı başlar.
 */
async function yeniSube(st, shop, b) {
  const db = st.db
  const ad = str(b.ad, 80)
  if (!ad) throw new HttpError(400, 'no_name')
  const kod = slug(b.kod) || slug(ad)
  if (!kod || kod.length < 3) throw new HttpError(400, 'bad_kod')
  if (!validPin(b.pin)) throw new HttpError(400, 'bad_pin')
  const n = (await db.prepare('SELECT COUNT(*) AS n FROM berber_shops WHERE isl = ?').bind(shop.isl).first()).n
  if (n >= 20) throw new HttpError(400, 'too_many_branches')
  if ((await db.prepare('SELECT 1 AS x FROM plat_shops WHERE kod = ?').bind(kod).first()) || (await db.prepare('SELECT 1 AS x FROM berber_shops WHERE kod = ?').bind(kod).first()))
    throw new HttpError(409, 'kod_taken')
  const merkez = await st.plat(shop.isl)
  const ms = await st.shop(shop.isl)
  if (!merkez || !ms) throw new HttpError(409, 'no_main')
  const islAd = merkez.isl || ms.ad
  const p = {
    id: uid(),
    ad,
    sektor: 'Berber',
    tel: '',
    paket: merkez.paket || 'p1',
    deneme: !!merkez.deneme,
    bitis: merkez.bitis,
    dur: false,
    not: `${islAd} şubesi (uygulamadan açıldı)`,
    isl: islAd,
    kod,
  }
  const data = { ad, wa: ms.wa, adres: '', gunbas: ms.gunbas, acilis: ms.acilis, kapanis: ms.kapanis, aralik: ms.aralik, hizmetler: ms.hizmetler, personel: [] }
  await db.batch([
    db.prepare('INSERT INTO plat_shops (id, kod, data) VALUES (?, ?, ?)').bind(p.id, kod, JSON.stringify(p)),
    // Merkez de aynı işletme adını taşısın; ilave şube ücreti sahip panelinde bu adla hesaplanır
    db.prepare('UPDATE plat_shops SET data = ? WHERE kod = ?').bind(JSON.stringify({ ...merkez, isl: islAd }), shop.isl),
    db.prepare('INSERT INTO berber_shops (kod, isl, data) VALUES (?, ?, ?)').bind(kod, shop.isl, JSON.stringify(data)),
    db.prepare('INSERT OR REPLACE INTO secrets (key, hash) VALUES (?, ?)').bind(`berber:yon:${kod}`, await hashPin(b.pin)),
  ])
  return { ok: true, kod }
}

// --- Sayfalar ---
const ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#1F3A5F"/><rect x="24" y="8" width="16" height="48" rx="8" fill="#fff"/><path d="M24 18l16 8M24 30l16 8M24 42l16 8" stroke="#C8102E" stroke-width="4"/><rect x="24" y="8" width="16" height="48" rx="8" fill="none" stroke="#fff" stroke-width="2"/></svg>`

function manifest(area, kod, ad) {
  return JSON.stringify({
    name: ad || 'Berberim',
    short_name: area === 's' ? 'Berber Panel' : 'Randevu',
    start_url: `/${area}/${kod}`,
    scope: `/${area}/${kod}`,
    display: 'standalone',
    background_color: '#F4F6F9',
    theme_color: '#1F3A5F',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-192-maskable.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  })
}

const htmlHeaders = {
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'no-cache',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'x-content-type-options': 'nosniff',
}

export function makeWorker(APP_HTML) {
  return {
    async fetch(req, env) {
      const url = new URL(req.url)
      const p = url.pathname
      if (p.startsWith('/api/')) return handleApi(req, env)
      if (Object.hasOwn(PNG_ICONS, p)) {
        return new Response(Uint8Array.from(atob(PNG_ICONS[p]), (c) => c.charCodeAt(0)), { headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=86400' } })
      }
      if (p === '/icon.svg') return new Response(ICON, { headers: { 'content-type': 'image/svg+xml', 'cache-control': 'public, max-age=86400' } })
      const m = p.match(/^\/(r|s)\/([a-z0-9-]{1,60})\/app\.webmanifest$/)
      if (m) {
        const r = await env.DB.prepare('SELECT data FROM berber_shops WHERE kod = ?').bind(m[2]).first()
        return new Response(manifest(m[1], m[2], r ? JSON.parse(r.data).ad : ''), { headers: { 'content-type': 'application/manifest+json' } })
      }
      if (p === '/robots.txt') return new Response('User-agent: *\nDisallow: /s/\n', { headers: { 'content-type': 'text/plain' } })
      // Müşteri sayfası: dükkân bilgisi sayfanın içine gömülür, telefon tek istekle açılır (zayıf mobil veri)
      const c = p.match(/^\/r\/([a-z0-9-]{1,60})\/?$/)
      if (c && req.method === 'GET') {
        let boot = null
        try {
          const res = await handleApi(new Request(url.origin + '/api/r/' + c[1] + '/info', { headers: req.headers }), env)
          boot = { s: res.status, d: await res.json() }
        } catch {}
        if (boot) {
          const s = JSON.stringify(boot).replace(/</g, '\\u003c')
          return new Response(APP_HTML.replace('/*__BOOT__*/', () => 'var BOOT=' + s + ';'), { headers: htmlHeaders })
        }
      }
      return new Response(APP_HTML, { headers: htmlHeaders })
    },
  }
}
