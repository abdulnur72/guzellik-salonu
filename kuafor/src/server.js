// Kuaförüm: bayan kuaför uygulamasının sunucusu (Cloudflare Pages, tek _worker.js).
//
//   /r/<kod>   müşteri sayfası: yalnızca randevu formu (çoklu hizmet, onay özeti), "Randevularım", iptal
//   /s/<kod>   kuaför paneli: Yönetici, Personel, Randevu, İşletme, Müşteri (PIN ile)
//   /api/...   aşağıdaki uçlar
//
// Kayıtlar güzellik salonu, halı yıkama ve berberle ortak D1 veritabanında, kuafor_* tablolarında durur.
// Abonelik ve "Durdur" kilidi sahip panelinin (/patron) plat_shops tablosundan okunur.
//
// Roller:
//   yon  yönetici (salon patronu): ciro, gider, net kâr, personel ve prim, ayarlar
//   per  personel: yalnızca kendi müşterisi, kendi kaydı ve kendi payı
//   isl  işletme sahibi: bütün şubelerin özeti, yeni şube (merkez şubenin yönetici PIN'i)

export const SEKTOR = 'Bayan Kuaför'

// [ad, fiyat TL, süre dk, boya hatırlatma günü]
const H = (kat, list) => list.map(([ad, fiyat, sure, hat]) => ({ ad, kat, fiyat, sure, ...(hat ? { hat } : {}) }))
export const VARSAYILAN_HIZMET = [
  ...H('Kesim & Fön', [
    ['Kadın saç kesimi', 500, 45], ['Uç alma', 250, 20], ['Kahkül kesimi', 100, 10], ['Çocuk saç kesimi', 250, 30],
    ['Fön (kısa saç)', 250, 30], ['Fön (uzun saç)', 350, 40], ['Dalgalı fön', 400, 45], ['Maşa / bukle', 450, 45],
    ['Düzleştirme (pres)', 400, 45], ['Yıkama', 100, 10],
  ]),
  ...H('Boya & Renk', [
    ['Dip boya', 800, 90, 35], ['Tüm saç boya (kısa)', 1000, 90, 42], ['Tüm saç boya (uzun)', 1500, 120, 42], ['Röfle', 1500, 150, 60],
    ['Balyaj', 2500, 180, 90], ['Ombre', 2200, 180, 90], ['Sombre', 2200, 180, 90], ['Renk değişimi', 1800, 150, 42],
    ['Renk açma', 1500, 120, 60], ['Gölge boya', 900, 60, 35], ['Beyaz kapatma', 800, 75, 30], ['Kına / bitkisel boya', 700, 90, 35],
  ]),
  ...H('Saç Bakımı', [
    ['Keratin bakım', 3000, 180], ['Brezilya fönü', 3500, 180], ['Saç botoksu', 2500, 150], ['Saç maskesi', 400, 30],
    ['Argan bakımı', 500, 30], ['Kolajen bakım', 2000, 120], ['Dökülme bakımı', 600, 40], ['Kepek bakımı', 500, 30],
    ['Ozon bakımı', 600, 40], ['Isı koruyucu bakım', 300, 20],
  ]),
  ...H('Topuz & Şekil', [
    ['Topuz', 800, 60], ['Gelin saçı', 3000, 120], ['Nişan saçı', 2000, 90], ['Örgü', 400, 40],
    ['Kaynak saç ekleme', 4000, 180], ['Kaynak sökme', 800, 60], ['Perma', 1500, 120], ['Defrize', 1500, 120],
  ]),
  ...H('Makyaj', [
    ['Günlük makyaj', 800, 45], ['Gece makyajı', 1200, 60], ['Gelin makyajı', 4000, 90], ['Nişan makyajı', 2500, 75],
    ['Kına gecesi makyajı', 2000, 75], ['Kirpik takma', 300, 20],
  ]),
  ...H('Kaş, Kirpik & Ağda', [
    ['Kaş alma', 150, 15], ['Kaş boyama', 200, 15], ['Kaş laminasyonu', 700, 45], ['Kirpik lifting', 800, 60],
    ['Kirpik boyama', 200, 15], ['Bıyık alma', 100, 10], ['Yüz ağdası', 300, 20], ['Koltuk altı ağda', 200, 15],
    ['Kol ağdası', 350, 30], ['Bacak ağdası', 500, 40],
  ]),
  ...H('Tırnak', [
    ['Manikür', 400, 40], ['Pedikür', 500, 50], ['Kalıcı oje', 500, 45], ['Kalıcı oje çıkarma', 150, 15],
    ['Protez tırnak', 1200, 90], ['Protez tırnak dolgu', 800, 60], ['Tırnak süsleme', 200, 20], ['Ayak bakımı (spa)', 600, 50],
  ]),
]
export const GIDER = ['Kira', 'Elektrik', 'Su', 'Doğalgaz', 'Boya ve malzeme', 'Bakım ürünleri', 'Personel maaşı', 'Çay / ikram', 'Bakım / tamir', 'Diğer']
export const VARSAYILAN_PRIM = 40
const VARSAYILAN = { gunbas: '06:00', acilis: '09:00', kapanis: '20:00', aralik: 30 }
const ODEME = ['nakit', 'kart']
const ILERI_GUN = 30 // müşteri en fazla 30 gün sonrasına randevu alır
const MAX_HIZMET = 150
const MAX_SECIM = 8 // bir randevuda en fazla 8 hizmet

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
 * Gece yarısından sonra yapılan iş bir önceki güne yazılır; gece mesaisi bölünmez.
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

/** Salon ayarlarını eksiksiz hale getirir */
export function normShop(d) {
  const s = { ad: str(d.ad, 80) || 'Kuaför', wa: str(d.wa, 30), adres: str(d.adres, 200), ...VARSAYILAN }
  for (const k of ['gunbas', 'acilis', 'kapanis']) if (SAAT.test(d[k] || '')) s[k] = d[k]
  if ([15, 20, 30, 45, 60].includes(d.aralik)) s.aralik = d.aralik
  s.hizmetler = Array.isArray(d.hizmetler) && d.hizmetler.length ? d.hizmetler : VARSAYILAN_HIZMET
  s.personel = Array.isArray(d.personel) ? d.personel : []
  return s
}
const aktifPer = (shop) => shop.personel.filter((p) => p.aktif !== false)

/** Kapanışın iş günü dakikası (kapanış açılıştan önceyse gece yarısını geçer) */
function kapanisDk(shop) {
  const a = isDk(shop.acilis, shop.gunbas)
  const k = isDk(shop.kapanis, shop.gunbas)
  return k <= a ? 1440 : k
}
/** Randevu başlangıç saatleri (açılıştan kapanıştan bir aralık öncesine kadar) */
export function slotlar(shop) {
  const a = isDk(shop.acilis, shop.gunbas)
  const k = kapanisDk(shop)
  const gb = dkOf(shop.gunbas)
  const out = []
  for (let d = a; d + shop.aralik <= k; d += shop.aralik) {
    const m = (d + gb) % 1440
    out.push(String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'))
  }
  return out
}

/** Seçilen hizmetler (ad listesi) → {hz: [ad], fiyat, sure, hat} */
export function secim(shop, raw) {
  const list = (Array.isArray(raw) ? raw : raw ? [raw] : []).map((x) => str(x, 60)).filter(Boolean)
  const out = []
  for (const ad of list) {
    const h = shop.hizmetler.find((x) => x.ad === ad)
    if (h && !out.includes(h)) out.push(h)
  }
  if (!out.length) throw new HttpError(400, 'no_service')
  if (out.length > MAX_SECIM) throw new HttpError(400, 'too_many_services')
  return {
    hz: out.map((h) => h.ad),
    fiyat: r2(out.reduce((t, h) => t + (Number(h.fiyat) || 0), 0)),
    sure: Math.max(shop.aralik, out.reduce((t, h) => t + (Number(h.sure) || 0), 0)),
    hat: Math.max(0, ...out.map((h) => Number(h.hat) || 0)),
  }
}

/**
 * Bir günün randevularına göre [bas, bas+sure) aralığı boş mu?
 * Belirli bir uzman seçildiyse o uzman boş olmalı; "fark etmez" ise en az bir uzman.
 * Uzmanı seçilmemiş randevular da bir koltuk kaplar.
 */
export function musaitMi(shop, list, per, bas, sure, haric) {
  if (bas + sure > kapanisDk(shop)) return false
  const ust = list.filter((r) => r.id !== haric && r.saat && r.durum !== 'iptal').filter((r) => {
    const s = isDk(r.saat, shop.gunbas)
    return s < bas + sure && bas < s + (Number(r.sure) || shop.aralik)
  })
  const ak = aktifPer(shop)
  if (!ak.length) return ust.length === 0
  const bos = ak.filter((p) => !ust.some((r) => r.per === p.id))
  const sahipsiz = ust.filter((r) => !r.per || !ak.some((p) => p.id === r.per)).length
  if (per && !bos.some((p) => p.id === per)) return false
  return bos.length - sahipsiz >= 1
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
    const r = await this.db.prepare('SELECT isl, data, ver FROM kuafor_shops WHERE kod = ?').bind(kod).first()
    if (!r) return null
    return { ...normShop(JSON.parse(r.data)), kod, isl: r.isl, ver: r.ver }
  }
  putShop(shop) {
    const { kod, isl, ver, ...data } = shop
    return this.db.prepare('UPDATE kuafor_shops SET data = ? WHERE kod = ?').bind(JSON.stringify(data), this.kod)
  }
  bump() {
    return this.db.prepare('UPDATE kuafor_shops SET ver = ver + 1 WHERE kod = ?').bind(this.kod)
  }
  async randevu(id) {
    const r = await this.db.prepare('SELECT id, gun, data FROM kuafor_randevu WHERE kod = ? AND id = ?').bind(this.kod, str(id, 40)).first()
    if (!r) throw new HttpError(404, 'not_found_randevu')
    return { ...JSON.parse(r.data), id: r.id, gun: r.gun }
  }
  putRandevu(o) {
    const { id, gun, ...data } = o
    return this.db
      .prepare(
        'INSERT INTO kuafor_randevu (kod, id, gun, tel, data, updated) VALUES (?1, ?2, ?3, ?4, ?5, ?6) ' +
          'ON CONFLICT (kod, id) DO UPDATE SET gun = excluded.gun, tel = excluded.tel, data = excluded.data, updated = excluded.updated',
      )
      .bind(this.kod, id, gun, telKey(o.tel), JSON.stringify(data), Date.now())
  }
  async gunRandevu(gun) {
    const { results } = await this.db.prepare('SELECT id, gun, data FROM kuafor_randevu WHERE kod = ? AND gun = ?').bind(this.kod, gun).all()
    return results.map((r) => ({ ...JSON.parse(r.data), id: r.id, gun: r.gun }))
  }
  async kayit(id) {
    const r = await this.db.prepare('SELECT id, gun, data FROM kuafor_kayit WHERE kod = ? AND id = ?').bind(this.kod, str(id, 40)).first()
    if (!r) throw new HttpError(404, 'not_found_kayit')
    return { ...JSON.parse(r.data), id: r.id, gun: r.gun }
  }
  putKayit(k) {
    const { id, gun, ...data } = k
    return this.db.prepare('INSERT OR REPLACE INTO kuafor_kayit (kod, id, gun, data) VALUES (?, ?, ?, ?)').bind(this.kod, id, gun, JSON.stringify(data))
  }
  delKayit(id) {
    return this.db.prepare('DELETE FROM kuafor_kayit WHERE kod = ? AND id = ?').bind(this.kod, id)
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
      if (plat && plat.sektor === SEKTOR) throw new HttpError(409, 'setup', { ad: plat.ad })
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
    hizmetler: s.hizmetler.map((h) => ({ ad: h.ad, kat: h.kat || 'Diğer', fiyat: h.fiyat, sure: h.sure || s.aralik })),
    personel: aktifPer(s).map((p) => ({ id: p.id, ad: p.ad })),
    gun: g.gun,
    dk: g.dk,
    gunbas: s.gunbas,
    aralik: s.aralik,
    ileri: ILERI_GUN,
  }
}

const gecmis = (shop, gun, saat) => {
  const g = isGunu(shop.gunbas)
  return gun < g.gun || (gun === g.gun && isDk(saat, shop.gunbas) <= g.dk)
}
const perAd = (shop, id) => (id ? shop.personel.find((p) => p.id === id)?.ad || '' : '')

async function customer(req, st, shop, action, ip, url) {
  if (req.method === 'GET' && action === 'info') return publicShop(shop)
  if (req.method === 'GET' && action === 'bos') {
    const gun = str(url.searchParams.get('gun'), 10)
    if (!DATE.test(gun)) throw new HttpError(400, 'bad_date')
    const per = str(url.searchParams.get('per'), 20)
    const sure = Math.min(600, Math.max(shop.aralik, Math.trunc(num(url.searchParams.get('sure'))) || shop.aralik))
    const list = await st.gunRandevu(gun)
    return { gun, sure, slotlar: slotlar(shop).map((s) => ({ s, ok: !gecmis(shop, gun, s) && musaitMi(shop, list, per, isDk(s, shop.gunbas), sure) })) }
  }
  if (req.method !== 'POST') throw new HttpError(404, 'not_found')
  const b = await readBody(req)
  if (action === 'al') {
    const key = `kuafor:al:${ip}`
    if (await st.limited(key, 8, 3600_000)) throw new HttpError(429, 'too_many')
    const r = await yeniRandevu(st, shop, b, 'musteri')
    const k = randomToken(16)
    r.k = await sha(k)
    await st.db.batch([st.putRandevu(r), st.note(key), st.bump()])
    return { id: r.id, key: k, gun: r.gun, saat: r.saat, sure: r.sure, fiyat: r.fiyat, per: perAd(shop, r.per), hz: r.hz }
  }
  if (action === 'benim') {
    const key = `kuafor:benim:${ip}`
    if (await st.limited(key, 30, 15 * 60_000)) throw new HttpError(429, 'too_many')
    await st.note(key).run()
    if (!validTel(b.tel)) throw new HttpError(400, 'bad_phone')
    const g = isGunu(shop.gunbas).gun
    const { results } = await st.db
      .prepare('SELECT id, gun, data FROM kuafor_randevu WHERE kod = ? AND tel = ? AND gun >= ? ORDER BY gun, id LIMIT 20')
      .bind(st.kod, telKey(b.tel), g)
      .all()
    const out = results
      .map((r) => ({ ...JSON.parse(r.data), id: r.id, gun: r.gun }))
      .filter((r) => r.durum !== 'iptal')
      .map((r) => ({ id: r.id, gun: r.gun, saat: r.saat, sure: r.sure, durum: r.durum, hz: r.hz, fiyat: r.fiyat, per: perAd(shop, r.per) }))
    out.sort((a, c) => (a.gun + String(isDk(a.saat, shop.gunbas)).padStart(4, '0')).localeCompare(c.gun + String(isDk(c.saat, shop.gunbas)).padStart(4, '0')))
    return { list: out }
  }
  if (action === 'iptal') {
    const key = `kuafor:iptal:${ip}`
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

/** Müşteri ya da panelden gelen randevu talebini doğrular */
async function yeniRandevu(st, shop, b, kaynak, zorlaPer) {
  const ad = str(b.ad, 60)
  const tel = str(b.tel, 30)
  if (!ad) throw new HttpError(400, 'no_name')
  if (kaynak === 'musteri' || tel) if (!validTel(tel)) throw new HttpError(400, 'bad_phone')
  const g = isGunu(shop.gunbas)
  const gun = str(b.gun, 10)
  if (!DATE.test(gun)) throw new HttpError(400, 'bad_date')
  if (gun < g.gun) throw new HttpError(400, 'past_date')
  if (gun > addDay(g.gun, ILERI_GUN)) throw new HttpError(400, 'too_far')
  const saat = str(b.saat, 5)
  if (!saat || !slotlar(shop).includes(saat)) throw new HttpError(400, 'bad_time')
  if (gecmis(shop, gun, saat)) throw new HttpError(400, 'past_time')
  let per = zorlaPer ?? str(b.per, 20)
  if (per && !aktifPer(shop).some((p) => p.id === per)) per = ''
  const sc = secim(shop, b.hz)
  const list = await st.gunRandevu(gun)
  if (kaynak === 'musteri') {
    const ayni = list.filter((r) => r.durum === 'bekliyor' && telKey(r.tel) === telKey(tel)).length
    if (ayni >= 3) throw new HttpError(429, 'too_many_same')
  }
  if (!musaitMi(shop, list, per, isDk(saat, shop.gunbas), sc.sure)) throw new HttpError(409, 'slot_taken')
  return { id: uid(), gun, ad, tel, saat, sure: sc.sure, per, hz: sc.hz, fiyat: sc.fiyat, not: str(b.not, 200), durum: 'bekliyor', kaynak, olus: Date.now() }
}

// --- Kuaför paneli ---
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
  if (req.method === 'GET' && action === 'info') return { ad: shop.ad, kurulu: !!(await st.secret(`kuafor:yon:${st.kod}`)) }
  if (req.method === 'POST' && action === 'login') return login(st, shop, await readBody(req), ip)
  const s = await session(st, req, ['kuafor_yon', 'kuafor_per'])
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
  const keys = [`kuafor:pin:${st.kod}:${ip}`, `kuafor:pin:${st.kod}`]
  if ((await st.limited(keys[0], 8, 15 * 60_000)) || (await st.limited(keys[1], 40, 15 * 60_000))) throw new HttpError(429, 'too_many')
  const pin = b.pin
  let rol = null
  let per = null
  let kod = st.kod
  if (validPin(pin)) {
    if (b.rol === 'isl') {
      // İşletme sahibi: merkez şubenin yönetici PIN'i
      if (await checkPin(pin, await st.secret(`kuafor:yon:${shop.isl}`))) {
        rol = 'isl'
        kod = shop.isl
      }
    } else {
      if (await checkPin(pin, await st.secret(`kuafor:yon:${st.kod}`))) rol = 'yon'
      if (!rol && b.rol !== 'yon') {
        for (const p of aktifPer(shop)) {
          if (await checkPin(pin, await st.secret(`kuafor:per:${st.kod}:${p.id}`))) {
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
      .bind(token, 'kuafor_' + rol, kod, per, now + (rol === 'per' ? PER_SESSION : YON_SESSION)),
    st.db.prepare('DELETE FROM sessions WHERE expires < ?').bind(now),
  ])
  return { token, rol, per }
}

const kayitRows = async (st, since) =>
  (await st.db.prepare('SELECT id, gun, data FROM kuafor_kayit WHERE kod = ? AND gun >= ? ORDER BY gun, id').bind(st.kod, since).all()).results.map((r) => ({
    ...JSON.parse(r.data),
    id: r.id,
    gun: r.gun,
  }))

/**
 * Boya günü hatırlatması: boya/röfle gibi tekrar eden hizmetin hatırlatma günü gelen (3 gün içinde)
 * ya da geçen müşteriler. Aynı telefonun yalnızca son boyası sayılır; yaklaşan randevusu olan,
 * hatırlatılmış ya da 60 günden fazla gecikmiş müşteri listeye girmez.
 */
async function hatirlatmalar(st, g, s, randevular) {
  const { results } = await st.db
    .prepare("SELECT id, gun, data FROM kuafor_kayit WHERE kod = ? AND gun >= ? AND json_extract(data, '$.hat') IS NOT NULL ORDER BY gun, id")
    .bind(st.kod, addDay(g, -200))
    .all()
  const son = {}
  for (const r of results) {
    const k = { ...JSON.parse(r.data), id: r.id, gun: r.gun }
    const t = telKey(k.tel)
    if (t && (!son[t] || son[t].ts <= k.ts)) son[t] = k
  }
  const gelecek = new Set(randevular.filter((r) => r.durum === 'bekliyor' && r.gun >= g).map((r) => telKey(r.tel)))
  return Object.values(son)
    .filter((k) => !k.hy && k.hat <= addDay(g, 3) && k.hat >= addDay(g, -60) && !gelecek.has(telKey(k.tel)))
    .filter((k) => s.rol === 'yon' || k.per === s.per)
    .sort((a, b) => a.hat.localeCompare(b.hat))
    .map((k) => ({ id: k.id, mus: k.mus, tel: k.tel, hz: k.hz, gun: k.gun, hat: k.hat, per: k.per }))
}

async function state(st, shop, plat, s) {
  const g = isGunu(shop.gunbas)
  const yon = s.rol === 'yon'
  // Randevular: dünden itibaren ("Geri al" için) ileri tarihlere kadar
  const rows = (await st.db.prepare('SELECT id, gun, data FROM kuafor_randevu WHERE kod = ? AND gun >= ? ORDER BY gun').bind(st.kod, addDay(g.gun, -1)).all()).results.map(
    (r) => ({ ...JSON.parse(r.data), id: r.id, gun: r.gun }),
  )
  // Personel yalnızca kendisine ve henüz kimseye verilmemiş ("fark etmez") müşterileri görür
  const randevular = rows.filter((r) => yon || r.per === s.per || (!r.per && r.durum === 'bekliyor')).map(({ k, ...r }) => r)
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
    hatirlat: await hatirlatmalar(st, g.gun, s, rows),
    sabit: { gider: GIDER, prim: VARSAYILAN_PRIM },
  }
  const n = (await st.db.prepare('SELECT COUNT(*) AS n FROM kuafor_shops WHERE isl = ?').bind(shop.isl).first()).n
  out.shop.cokSube = n > 1
  out.shop.merkez = shop.isl === shop.kod
  if (yon) {
    out.giderler = (await st.db.prepare('SELECT id, gun, data FROM kuafor_gider WHERE kod = ? AND gun >= ? ORDER BY gun DESC').bind(st.kod, since).all()).results.map((r) => ({
      ...JSON.parse(r.data),
      id: r.id,
      gun: r.gun,
    }))
    out.abonelik = plat ? { bitis: plat.bitis, deneme: !!plat.deneme } : null
  }
  return out
}

/** PIN, salondaki diğer PIN'lerden (yönetici ve diğer personel) farklı olmalı */
async function pinBos(st, shop, pin, kendi) {
  if (kendi !== 'yon' && (await checkPin(pin, await st.secret(`kuafor:yon:${st.kod}`)))) throw new HttpError(400, 'same_pin_yon')
  for (const p of aktifPer(shop)) {
    if (p.id === kendi) continue
    if (await checkPin(pin, await st.secret(`kuafor:per:${st.kod}:${p.id}`))) throw new HttpError(400, kendi === 'yon' ? 'same_pin_per' : 'same_pin_other')
  }
}

function cleanSaat(v, def) {
  const s = str(v, 5)
  if (!s) return def
  if (!SAAT.test(s)) throw new HttpError(400, 'bad_time')
  return s
}

/** Yönetici hizmet listesini kaydederken doğrular */
function cleanHizmetler(list) {
  if (!Array.isArray(list) || !list.length || list.length > MAX_HIZMET) throw new HttpError(400, 'bad_services')
  const seen = new Set()
  return list.map((h) => {
    const ad = str(h?.ad, 40)
    const kat = str(h?.kat, 30) || 'Diğer'
    const fiyat = r2(num(h?.fiyat))
    const sure = Math.trunc(num(h?.sure))
    const hat = h?.hat === undefined || h?.hat === '' || h?.hat === null ? 0 : Math.trunc(num(h.hat))
    if (!ad || seen.has(ad) || !(fiyat > 0 && fiyat <= 100000)) throw new HttpError(400, 'bad_services')
    if (!(sure >= 5 && sure <= 600)) throw new HttpError(400, 'bad_duration')
    if (!(hat >= 0 && hat <= 365)) throw new HttpError(400, 'bad_reminder')
    seen.add(ad)
    return { ad, kat, fiyat, sure, ...(hat ? { hat } : {}) }
  })
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
  const kayitYap = (per, sc, tutar, od, extra = {}) => {
    const p = shop.personel.find((x) => x.id === per)
    if (!p) throw new HttpError(400, 'no_staff')
    if (!ODEME.includes(od)) throw new HttpError(400, 'bad_payment')
    if (!(tutar > 0 && tutar <= 200000)) throw new HttpError(400, 'bad_amount')
    const k = { id: uid(), gun: g.gun, per, hz: sc.hz.join(' + '), tutar: r2(tutar), od, prim: Number.isFinite(p.prim) ? p.prim : VARSAYILAN_PRIM, ts: Date.now(), ...extra }
    // Boya günü hatırlatması: telefonu bilinen müşteride, hizmetin hatırlatma günü kadar sonrası
    if (sc.hat > 0 && validTel(k.tel)) k.hat = addDay(g.gun, sc.hat)
    return k
  }
  const tutarOku = (v, def) => (v === undefined || v === '' || v === null ? def : r2(num(v)))
  switch (action) {
    case 'kayit': {
      // Randevusuz gelen müşteri (personel ya da yönetici kaydeder)
      const per = yon ? str(b.per, 20) : s.per
      const sc = secim(shop, b.hz)
      const tel = str(b.tel, 30)
      if (tel && !validTel(tel)) throw new HttpError(400, 'bad_phone')
      return [st.putKayit(kayitYap(per, sc, tutarOku(b.tutar, sc.fiyat), str(b.od, 10), { mus: str(b.mus, 60), tel }))]
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
      let sc
      try {
        sc = secim(shop, r.hz)
      } catch {
        // Hizmet listeden silinmişse randevudaki adlar ve fiyat kullanılır
        sc = { hz: Array.isArray(r.hz) ? r.hz : [String(r.hz || 'Hizmet')], fiyat: r.fiyat, hat: 0 }
      }
      // Ciro, randevunun değil hizmetin yapıldığı iş gününe yazılır
      const k = kayitYap(per, sc, tutarOku(b.tutar, r.fiyat || sc.fiyat), str(b.od, 10), { rid: r.id, mus: r.ad, tel: r.tel })
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
      return [st.putRandevu({ ...r, durum: 'iptal', iptal: 'salon' })]
    }
    case 'ustlen': {
      const r = await st.randevu(b.id)
      if (r.per) throw new HttpError(409, 'changed')
      const per = yon ? str(b.per, 20) : s.per
      if (!aktifPer(shop).some((p) => p.id === per)) throw new HttpError(400, 'no_staff')
      if (r.durum === 'bekliyor') {
        const list = await st.gunRandevu(r.gun)
        if (!musaitMi(shop, list, per, isDk(r.saat, shop.gunbas), Number(r.sure) || shop.aralik, r.id)) throw new HttpError(409, 'slot_taken')
      }
      return [st.putRandevu({ ...r, per })]
    }
    case 'hatirlat': {
      // Boya hatırlatması gönderildi: listeden düşer
      const k = await st.kayit(b.id)
      if (!yon && k.per !== s.per) throw new HttpError(403, 'not_yours')
      return [st.putKayit({ ...k, hy: g.gun })]
    }
    case 'gider': {
      needYon()
      const t = r2(num(b.tutar))
      if (!(t > 0)) throw new HttpError(400, 'bad_amount')
      const gun = DATE.test(str(b.gun)) ? str(b.gun) : g.gun
      const data = { tur: GIDER.includes(str(b.tur)) ? str(b.tur) : 'Diğer', tutar: t, not: str(b.not, 200) }
      return [db.prepare('INSERT INTO kuafor_gider (kod, id, gun, data) VALUES (?, ?, ?, ?)').bind(st.kod, uid(), gun, JSON.stringify(data))]
    }
    case 'gidersil': {
      needYon()
      return [db.prepare('DELETE FROM kuafor_gider WHERE kod = ? AND id = ?').bind(st.kod, str(b.id, 64))]
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
      if (b.hizmetler !== undefined) next.hizmetler = cleanHizmetler(b.hizmetler)
      if (b.varsayilan === true) next.hizmetler = VARSAYILAN_HIZMET
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
      return [st.putShop({ ...shop, personel: list }), db.prepare('INSERT OR REPLACE INTO secrets (key, hash) VALUES (?, ?)').bind(`kuafor:per:${st.kod}:${p.id}`, await hashPin(b.pin))]
    }
    case 'personelsil': {
      // Geçmiş kayıtlarda adı görünsün diye silinmez, pasif olur; PIN'i ve oturumları kapanır
      needYon()
      const id = str(b.id, 20)
      if (!shop.personel.some((p) => p.id === id)) throw new HttpError(404, 'no_staff')
      return [
        st.putShop({ ...shop, personel: shop.personel.map((p) => (p.id === id ? { ...p, aktif: false } : p)) }),
        db.prepare('DELETE FROM secrets WHERE key = ?').bind(`kuafor:per:${st.kod}:${id}`),
        db.prepare("DELETE FROM sessions WHERE role = 'kuafor_per' AND branch_id = ? AND staff_id = ?").bind(st.kod, id),
      ]
    }
    case 'perpin': {
      // Yönetici personelin PIN'ini yeniler; personel kendi PIN'ini değiştirir
      const id = yon ? str(b.id, 20) : s.per
      if (!aktifPer(shop).some((p) => p.id === id)) throw new HttpError(404, 'no_staff')
      if (!validPin(b.pin)) throw new HttpError(400, 'bad_pin')
      await pinBos(st, shop, b.pin, id)
      return [
        db.prepare('INSERT OR REPLACE INTO secrets (key, hash) VALUES (?, ?)').bind(`kuafor:per:${st.kod}:${id}`, await hashPin(b.pin)),
        db.prepare("DELETE FROM sessions WHERE role = 'kuafor_per' AND branch_id = ? AND staff_id = ? AND token != ?").bind(st.kod, id, s.token),
      ]
    }
    case 'pin': {
      needYon()
      if (!validPin(b.pin)) throw new HttpError(400, 'bad_pin')
      await pinBos(st, shop, b.pin, 'yon')
      return [
        db.prepare('INSERT OR REPLACE INTO secrets (key, hash) VALUES (?, ?)').bind(`kuafor:yon:${st.kod}`, await hashPin(b.pin)),
        db.prepare("DELETE FROM sessions WHERE role IN ('kuafor_yon', 'kuafor_isl') AND branch_id = ? AND token != ?").bind(st.kod, s.token),
      ]
    }
  }
  throw new HttpError(404, 'not_found')
}

// --- İşletme (çok şubeli) ---
async function isletme(req, st, shop, action, url) {
  const s = await session(st, req, ['kuafor_isl'])
  if (!s || s.kod !== shop.isl) throw new HttpError(401, 'login')
  const subeler = (await st.db.prepare('SELECT kod FROM kuafor_shops WHERE isl = ? ORDER BY rowid').bind(shop.isl).all()).results.map((r) => r.kod)
  if (req.method === 'GET' && action === 'ozet') {
    const g = isGunu(shop.gunbas)
    const since = addDay(g.gun, -62)
    const out = []
    for (const kod of subeler) {
      const o = new Store(st.db, kod)
      const sh = await o.shop()
      const pl = await o.plat()
      const kayit = (await kayitRows(o, since)).map((k) => ({ gun: k.gun, tutar: k.tutar, od: k.od, prim: k.prim, per: k.per }))
      const gider = (await st.db.prepare('SELECT gun, data FROM kuafor_gider WHERE kod = ? AND gun >= ?').bind(kod, since).all()).results.map((r) => ({ gun: r.gun, tutar: JSON.parse(r.data).tutar }))
      const bekleyen = (await st.db.prepare("SELECT COUNT(*) AS n FROM kuafor_randevu WHERE kod = ? AND gun = ? AND json_extract(data, '$.durum') = 'bekliyor'").bind(kod, isGunu(sh.gunbas).gun).first()).n
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
 * Yeni şube: kendi linki, kendi yönetici PIN'i olan ayrı bir salon.
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
  const n = (await db.prepare('SELECT COUNT(*) AS n FROM kuafor_shops WHERE isl = ?').bind(shop.isl).first()).n
  if (n >= 20) throw new HttpError(400, 'too_many_branches')
  if ((await db.prepare('SELECT 1 AS x FROM plat_shops WHERE kod = ?').bind(kod).first()) || (await db.prepare('SELECT 1 AS x FROM kuafor_shops WHERE kod = ?').bind(kod).first()))
    throw new HttpError(409, 'kod_taken')
  const merkez = await st.plat(shop.isl)
  const ms = await st.shop(shop.isl)
  if (!merkez || !ms) throw new HttpError(409, 'no_main')
  const islAd = merkez.isl || ms.ad
  const p = {
    id: uid(),
    ad,
    sektor: SEKTOR,
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
    db.prepare('INSERT INTO kuafor_shops (kod, isl, data) VALUES (?, ?, ?)').bind(kod, shop.isl, JSON.stringify(data)),
    db.prepare('INSERT OR REPLACE INTO secrets (key, hash) VALUES (?, ?)').bind(`kuafor:yon:${kod}`, await hashPin(b.pin)),
  ])
  return { ok: true, kod }
}

// --- Sayfalar ---
const ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#7A2E5C"/><circle cx="20" cy="44" r="7" fill="none" stroke="#fff" stroke-width="4"/><circle cx="44" cy="44" r="7" fill="none" stroke="#fff" stroke-width="4"/><path d="M25 39L46 12M39 39L18 12" stroke="#fff" stroke-width="4" stroke-linecap="round"/></svg>`

function manifest(area, kod, ad) {
  return JSON.stringify({
    name: ad || 'Kuaförüm',
    short_name: area === 's' ? 'Kuaför Panel' : 'Randevu',
    start_url: `/${area}/${kod}`,
    scope: `/${area}/${kod}`,
    display: 'standalone',
    background_color: '#FAF6F8',
    theme_color: '#7A2E5C',
    icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }],
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
      if (p === '/icon.svg') return new Response(ICON, { headers: { 'content-type': 'image/svg+xml', 'cache-control': 'public, max-age=86400' } })
      const m = p.match(/^\/(r|s)\/([a-z0-9-]{1,60})\/app\.webmanifest$/)
      if (m) {
        const r = await env.DB.prepare('SELECT data FROM kuafor_shops WHERE kod = ?').bind(m[2]).first()
        return new Response(manifest(m[1], m[2], r ? JSON.parse(r.data).ad : ''), { headers: { 'content-type': 'application/manifest+json' } })
      }
      if (p === '/robots.txt') return new Response('User-agent: *\nDisallow: /s/\n', { headers: { 'content-type': 'text/plain' } })
      // Müşteri sayfası: salon bilgisi sayfanın içine gömülür, telefon tek istekle açılır (zayıf mobil veri)
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
