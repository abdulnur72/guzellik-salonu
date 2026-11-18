// Sporum: spor salonu uygulamasının sunucusu (Cloudflare Pages, tek _worker.js).
//
//   /r/<kod>   müşteri sayfası: yalnızca randevu ve ders kaydı formu, "Randevularım", iptal
//   /s/<kod>   salon paneli: Yönetici, Personel, Randevu, İşletme, Müşteri (PIN ile)
//   /api/...   aşağıdaki uçlar
//
// Kayıtlar güzellik salonu, halı yıkama, berber ve kuaförle ortak D1 veritabanında, spor_* tablolarında durur.
// Abonelik ve "Durdur" kilidi sahip panelinin (/patron) plat_shops tablosundan okunur.
//
// Roller:
//   yon  yönetici (salon sahibi): ciro, gider, net kâr, antrenör ve prim, ayarlar, ders programı
//   per  antrenör: yalnızca kendi üyesi, kendi dersi, kendi satışı ve kendi payı
//   isl  işletme sahibi: bütün şubelerin özeti, yeni şube (merkez şubenin yönetici PIN'i)
//
// Kalem türleri (hizmet listesi):
//   uyelik  gün sayılı üyelik (satılınca üyenin bitiş tarihi uzar)
//   paket   ders paketi (satılınca üyenin kalan dersi artar; girişte "ders düş")
//   hizmet  tek seferlik (kişisel antrenman, vücut analizi...)
//   urun    satılan ürün (su, protein...): müşteri sayfasında görünmez, randevuya konmaz

export const SEKTOR = 'Spor Salonu'
export const TURLER = ['uyelik', 'paket', 'hizmet', 'urun']

const K = (kat, tur, list) =>
  list.map(([ad, fiyat, x, sure]) => ({
    ad,
    kat,
    tur,
    fiyat,
    ...(tur === 'uyelik' ? { gun: x, sure: sure || 30 } : tur === 'paket' ? { seans: x, sure: sure || 30 } : tur === 'hizmet' ? { sure: x } : {}),
  }))
// Üyelik: [ad, fiyat, gün], paket: [ad, fiyat, ders sayısı], hizmet: [ad, fiyat, süre dk], ürün: [ad, fiyat]
export const VARSAYILAN_HIZMET = [
  ...K('Üyelik', 'uyelik', [
    ['Günlük giriş', 250, 1], ['Haftalık üyelik', 600, 7], ['Aylık üyelik', 1500, 30], ['Öğrenci aylık', 1100, 30],
    ['3 aylık üyelik', 4000, 90], ['6 aylık üyelik', 7000, 180], ['Yıllık üyelik', 12000, 365],
  ]),
  ...K('Ders paketi', 'paket', [
    ['PT 8 ders', 6000, 8], ['PT 12 ders', 8500, 12], ['PT 24 ders', 15000, 24],
    ['Pilates 8 ders', 3500, 8], ['Grup dersi 10’lu', 2500, 10],
  ]),
  ...K('Antrenman & Ölçüm', 'hizmet', [
    ['Kişisel antrenman (tek ders)', 900, 60], ['Deneme antrenmanı', 300, 45], ['Vücut analizi', 300, 20],
    ['Beslenme danışmanlığı', 800, 45], ['Program hazırlama', 600, 30],
  ]),
  ...K('Ürün', 'urun', [
    ['Su', 20], ['Protein shake', 150], ['Protein bar', 80], ['Enerji içeceği', 60], ['Havlu', 30],
    ['Dolap kiralama (aylık)', 200], ['Eldiven', 400], ['Shaker', 250], ['Çay / ikram', 0],
  ]),
]
// Haftanın günü: 0 Pazar ... 6 Cumartesi
export const VARSAYILAN_DERS = [
  { id: 'pilates', ad: 'Pilates', gunler: [1, 3, 5], saat: '19:00', sure: 50, per: '', kont: 12 },
  { id: 'yoga', ad: 'Yoga', gunler: [2, 4], saat: '18:00', sure: 60, per: '', kont: 15 },
  { id: 'spinning', ad: 'Spinning', gunler: [2, 4, 6], saat: '20:00', sure: 45, per: '', kont: 20 },
  { id: 'zumba', ad: 'Zumba', gunler: [6], saat: '11:00', sure: 60, per: '', kont: 20 },
  { id: 'fonksiyonel', ad: 'Fonksiyonel antrenman', gunler: [1, 3], saat: '07:30', sure: 45, per: '', kont: 10 },
]
export const GIDER = ['Kira', 'Elektrik', 'Su', 'Doğalgaz', 'Ekipman', 'Bakım / tamir', 'Ürün alımı', 'Temizlik', 'Personel maaşı', 'Reklam', 'Diğer']
export const VARSAYILAN_PRIM = 40
const VARSAYILAN = { gunbas: '00:00', acilis: '07:00', kapanis: '23:00', aralik: 30 }
const ODEME = ['nakit', 'kart']
const ILERI_GUN = 30 // müşteri en fazla 30 gün sonrasına randevu alır
const DERS_ILERI = 14 // ders kaydı en fazla 14 gün sonrası
const MAX_HIZMET = 150
const MAX_DERS = 40
const MAX_SECIM = 8
const MAX_UYE = 3000

const DAY = 86_400_000
const PER_SESSION = 120 * DAY // antrenör telefonda açık kalır
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
export const gunFark = (a, b) => Math.round((new Date(a + 'T12:00:00Z') - new Date(b + 'T12:00:00Z')) / DAY)
const haftaGunu = (d) => new Date(d + 'T12:00:00Z').getUTCDay()
/**
 * İş günü: gün başlangıç saatinden (varsayılan 00:00) ertesi gün aynı saate kadar.
 * Dönen "dk": iş günü başından bu yana geçen dakika.
 */
export function isGunu(gunbas = VARSAYILAN.gunbas, ms = Date.now()) {
  const gb = dkOf(gunbas)
  const n = trNow(ms)
  return n.dk >= gb ? { gun: n.tar, dk: n.dk - gb } : { gun: addDay(n.tar, -1), dk: n.dk + 1440 - gb }
}
/** Bir saatin iş günü başından itibaren dakikası */
export const isDk = (saat, gunbas) => (dkOf(saat) - dkOf(gunbas) + 1440) % 1440

const str = (v, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : typeof v === 'number' ? String(v).slice(0, max) : '')
const num = (v) => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(',', '.'))
  return Number.isFinite(n) ? n : NaN
}
const int = (v) => Math.trunc(num(v))
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
  const s = { ad: str(d.ad, 80) || 'Spor Salonu', wa: str(d.wa, 30), adres: str(d.adres, 200), ...VARSAYILAN }
  for (const k of ['gunbas', 'acilis', 'kapanis']) if (SAAT.test(d[k] || '')) s[k] = d[k]
  if ([15, 20, 30, 45, 60].includes(d.aralik)) s.aralik = d.aralik
  s.hizmetler = Array.isArray(d.hizmetler) && d.hizmetler.length ? d.hizmetler : VARSAYILAN_HIZMET
  s.dersler = Array.isArray(d.dersler) ? d.dersler : VARSAYILAN_DERS
  s.personel = Array.isArray(d.personel) ? d.personel : []
  return s
}
const aktifPer = (shop) => shop.personel.filter((p) => p.aktif !== false)
const hzSure = (h, shop) => (h.tur === 'urun' ? 0 : Number(h.sure) || shop.aralik)

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

/** Müşteri sayfasında görünen kalemler: ürün ve sıfır fiyatlı kalemler gizli */
const musteriGorur = (h) => h.tur !== 'urun' && Number(h.fiyat) > 0

/**
 * Seçilen kalemler (ad listesi) → {hz: [ad], items, fiyat, sure}
 * mod: 'musteri' (müşteri randevusu), 'randevu' (panel randevusu), 'satis' (kasa)
 */
export function secim(shop, raw, mod = 'satis') {
  const list = (Array.isArray(raw) ? raw : raw ? [raw] : []).map((x) => str(x, 60)).filter(Boolean)
  const out = []
  for (const ad of list) {
    const h = shop.hizmetler.find((x) => x.ad === ad)
    if (!h || out.includes(h)) continue
    if (mod !== 'satis' && h.tur === 'urun') continue
    if (mod === 'musteri' && !musteriGorur(h)) continue
    out.push(h)
  }
  if (!out.length) throw new HttpError(400, 'no_service')
  if (out.length > (mod === 'musteri' ? 3 : MAX_SECIM)) throw new HttpError(400, 'too_many_services')
  return {
    hz: out.map((h) => h.ad),
    items: out,
    fiyat: r2(out.reduce((t, h) => t + (Number(h.fiyat) || 0), 0)),
    sure: Math.max(shop.aralik, out.reduce((t, h) => t + hzSure(h, shop), 0)),
  }
}
const uyeKalemi = (h) => h.tur === 'uyelik' || h.tur === 'paket'

/** O günün grup dersleri, antrenörün meşgul olduğu saat olarak */
function dersBloklari(shop, gun) {
  const w = haftaGunu(gun)
  return shop.dersler.filter((d) => d.per && d.gunler.includes(w)).map((d) => ({ id: 'ders:' + d.id, saat: d.saat, sure: d.sure, per: d.per, durum: 'bekliyor' }))
}

/**
 * Bir günün randevularına (ve grup derslerine) göre [bas, bas+sure) aralığı boş mu?
 * Belirli bir antrenör seçildiyse o antrenör boş olmalı; "fark etmez" ise en az bir antrenör.
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

// --- Üye kartı: üyelik ve paket satışı ---
/** Üyenin dondurması bugün sürüyor mu? */
export const donuk = (u, gun) => !!(u.don && u.don.bit >= gun)
const uyeDurum = (u) => ({ bitis: u.bitis || '', uyelik: u.uyelik || '', paket: u.paket ? { ...u.paket } : null })
/** Satılan üyelik/paket kalemlerini üye kartına işler; önceki ve sonraki hali döner */
export function satisIsle(u, items, gun) {
  const once = uyeDurum(u)
  let gunTop = 0
  let seansTop = 0
  for (const h of items) {
    if (h.tur === 'uyelik') {
      const n = Math.max(1, int(h.gun) || 30)
      // Üyelik sürüyorsa bitişin ertesi gününden, bittiyse bugünden başlar
      const bas = u.bitis && u.bitis >= gun ? addDay(u.bitis, 1) : gun
      u.bitis = addDay(bas, n - 1)
      u.uyelik = h.ad
      gunTop += n
    } else if (h.tur === 'paket') {
      const n = Math.max(1, int(h.seans) || 1)
      const kalan = (u.paket?.kalan || 0) + n
      u.paket = { ad: h.ad, kalan, top: kalan }
      seansTop += n
    }
  }
  return { once, sonra: uyeDurum(u), gunTop, seansTop }
}
/** Satış geri alınınca üye kartını eski haline döndürür */
export function satisGeri(u, k) {
  const now = uyeDurum(u)
  if (JSON.stringify(now) === JSON.stringify(k.sonra)) {
    u.bitis = k.once.bitis
    u.uyelik = k.once.uyelik
    u.paket = k.once.paket
    return true // birebir eski hal
  }
  // Satıştan sonra kartta başka değişiklik olmuş: yalnızca bu satışın etkisi çıkarılır
  if (k.gunTop && u.bitis) u.bitis = addDay(u.bitis, -k.gunTop)
  if (k.seansTop && u.paket) u.paket = { ...u.paket, kalan: Math.max(0, u.paket.kalan - k.seansTop) }
  return false
}

// --- Veritabanı erişimi ---
const row = (r) => ({ ...JSON.parse(r.data), id: r.id, ...(r.gun !== undefined ? { gun: r.gun } : {}) })
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
    const r = await this.db.prepare('SELECT isl, data, ver FROM spor_shops WHERE kod = ?').bind(kod).first()
    if (!r) return null
    return { ...normShop(JSON.parse(r.data)), kod, isl: r.isl, ver: r.ver }
  }
  putShop(shop) {
    const { kod, isl, ver, ...data } = shop
    return this.db.prepare('UPDATE spor_shops SET data = ? WHERE kod = ?').bind(JSON.stringify(data), this.kod)
  }
  bump() {
    return this.db.prepare('UPDATE spor_shops SET ver = ver + 1 WHERE kod = ?').bind(this.kod)
  }
  async one(table, id, err) {
    const r = await this.db.prepare(`SELECT * FROM ${table} WHERE kod = ? AND id = ?`).bind(this.kod, str(id, 40)).first()
    if (!r) throw new HttpError(404, err)
    return row(r)
  }
  randevu(id) {
    return this.one('spor_randevu', id, 'not_found_randevu')
  }
  putRandevu(o) {
    const { id, gun, ...data } = o
    return this.db
      .prepare('INSERT OR REPLACE INTO spor_randevu (kod, id, gun, tel, data, updated) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(this.kod, id, gun, telKey(o.tel), JSON.stringify(data), Date.now())
  }
  async gunRandevu(gun) {
    const { results } = await this.db.prepare('SELECT id, gun, data FROM spor_randevu WHERE kod = ? AND gun = ?').bind(this.kod, gun).all()
    return results.map(row)
  }
  katilim(id) {
    return this.one('spor_katilim', id, 'not_found_katilim')
  }
  putKatilim(o) {
    const { id, gun, ...data } = o
    return this.db
      .prepare('INSERT OR REPLACE INTO spor_katilim (kod, id, gun, tel, data, updated) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(this.kod, id, gun, telKey(o.tel), JSON.stringify(data), Date.now())
  }
  /** Kontenjan doluysa eklemez (aynı anda gelen iki kayıt kontenjanı aşmasın) */
  putKatilimKont(o, kont) {
    const { id, gun, ...data } = o
    return this.db
      .prepare(
        'INSERT INTO spor_katilim (kod, id, gun, tel, data, updated) SELECT ?1, ?2, ?3, ?4, ?5, ?6 ' +
          "WHERE (SELECT COUNT(*) FROM spor_katilim WHERE kod = ?1 AND gun = ?3 AND json_extract(data, '$.ders') = ?7 AND json_extract(data, '$.durum') = 'kayitli') < ?8",
      )
      .bind(this.kod, id, gun, telKey(o.tel), JSON.stringify(data), Date.now(), o.ders, kont)
  }
  async dersKatilim(ders, gun) {
    const { results } = await this.db
      .prepare("SELECT id, gun, data FROM spor_katilim WHERE kod = ? AND gun = ? AND json_extract(data, '$.ders') = ?")
      .bind(this.kod, gun, ders)
      .all()
    return results.map(row)
  }
  uye(id) {
    return this.one('spor_uye', id, 'not_found_uye')
  }
  async uyeTel(tel) {
    const t = telKey(tel)
    if (t.length < 10) return null
    const r = await this.db.prepare('SELECT id, data FROM spor_uye WHERE kod = ? AND tel = ? LIMIT 1').bind(this.kod, t).first()
    return r ? row(r) : null
  }
  putUye(u) {
    const { id, ...data } = u
    return this.db
      .prepare('INSERT OR REPLACE INTO spor_uye (kod, id, tel, data, updated) VALUES (?, ?, ?, ?, ?)')
      .bind(this.kod, id, telKey(u.tel), JSON.stringify(data), Date.now())
  }
  delUye(id) {
    return this.db.prepare('DELETE FROM spor_uye WHERE kod = ? AND id = ?').bind(this.kod, id)
  }
  kayit(id) {
    return this.one('spor_kayit', id, 'not_found_kayit')
  }
  putKayit(k) {
    const { id, gun, ...data } = k
    return this.db.prepare('INSERT OR REPLACE INTO spor_kayit (kod, id, gun, data) VALUES (?, ?, ?, ?)').bind(this.kod, id, gun, JSON.stringify(data))
  }
  delKayit(id) {
    return this.db.prepare('DELETE FROM spor_kayit WHERE kod = ? AND id = ?').bind(this.kod, id)
  }
  giris(id) {
    return this.one('spor_giris', id, 'not_found_giris')
  }
  putGiris(o) {
    const { id, gun, ...data } = o
    return this.db.prepare('INSERT OR REPLACE INTO spor_giris (kod, id, gun, data) VALUES (?, ?, ?, ?)').bind(this.kod, id, gun, JSON.stringify(data))
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

/** Abonelik kilidi: sahip panelinde süresi biten ya da durdurulan salon */
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
    if (rest[0] === 'isl') return json(await isletme(req, st, shop, rest[1]))
    return json(await panel(req, st, shop, plat, rest[0], ip, url))
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message, ...(e.extra || {}) }, e.status)
    console.error(e)
    return json({ error: 'server' }, 500)
  }
}

// --- Grup dersleri ---
/** [bas, son] günleri arasındaki ders oturumları ve dolu yer sayısı */
async function oturumlar(st, shop, bas, son) {
  const { results } = await st.db
    .prepare(
      "SELECT gun, json_extract(data, '$.ders') AS ders, COUNT(*) AS n FROM spor_katilim WHERE kod = ? AND gun >= ? AND gun <= ? AND json_extract(data, '$.durum') = 'kayitli' GROUP BY gun, ders",
    )
    .bind(st.kod, bas, son)
    .all()
  const dolu = Object.fromEntries(results.map((r) => [r.ders + '|' + r.gun, r.n]))
  const out = []
  for (let g = bas; g <= son; g = addDay(g, 1)) {
    const w = haftaGunu(g)
    for (const d of shop.dersler) {
      if (!d.gunler.includes(w)) continue
      out.push({ d: d.id, ad: d.ad, gun: g, saat: d.saat, sure: d.sure, per: d.per || '', kont: d.kont, dolu: dolu[d.id + '|' + g] || 0 })
    }
  }
  return out.sort((a, b) => (a.gun + String(isDk(a.saat, shop.gunbas)).padStart(4, '0')).localeCompare(b.gun + String(isDk(b.saat, shop.gunbas)).padStart(4, '0')))
}

// --- Müşteri (herkese açık) ---
export async function publicShop(st, s) {
  const g = isGunu(s.gunbas)
  // Müşteriye 7 günlük program gösterilir (sayfa kısa ve hafif kalsın)
  const ders = (await oturumlar(st, s, g.gun, addDay(g.gun, 6)))
    .filter((o) => !gecmis(s, o.gun, o.saat))
    .map((o) => ({ d: o.d, ad: o.ad, gun: o.gun, saat: o.saat, sure: o.sure, per: perAd(s, o.per), bos: Math.max(0, o.kont - o.dolu) }))
  return {
    ad: s.ad,
    wa: s.wa || '',
    adres: s.adres || '',
    // Ürünler, sıfır fiyatlı kalemler ve fiyatlar müşteriye gösterilmez
    hizmetler: s.hizmetler.filter(musteriGorur).map((h) => ({ ad: h.ad, kat: h.kat || 'Diğer', sure: hzSure(h, s) })),
    personel: aktifPer(s).map((p) => ({ id: p.id, ad: p.ad })),
    dersler: ders,
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
const dersBul = (shop, id) => shop.dersler.find((d) => d.id === id)

async function customer(req, st, shop, action, ip, url) {
  if (req.method === 'GET' && action === 'info') return publicShop(st, shop)
  if (req.method === 'GET' && action === 'bos') {
    const gun = str(url.searchParams.get('gun'), 10)
    if (!DATE.test(gun)) throw new HttpError(400, 'bad_date')
    const per = str(url.searchParams.get('per'), 20)
    const sure = Math.min(600, Math.max(shop.aralik, int(url.searchParams.get('sure')) || shop.aralik))
    const list = [...(await st.gunRandevu(gun)), ...dersBloklari(shop, gun)]
    return { gun, sure, slotlar: slotlar(shop).map((s) => ({ s, ok: !gecmis(shop, gun, s) && musaitMi(shop, list, per, isDk(s, shop.gunbas), sure) })) }
  }
  if (req.method !== 'POST') throw new HttpError(404, 'not_found')
  const b = await readBody(req)
  if (action === 'al' || action === 'ders') {
    const key = `spor:al:${ip}`
    if (await st.limited(key, 10, 3600_000)) throw new HttpError(429, 'too_many')
    const k = randomToken(16)
    if (action === 'al') {
      const r = await yeniRandevu(st, shop, b, 'musteri')
      r.k = await sha(k)
      await st.db.batch([st.putRandevu(r), st.note(key), st.bump()])
      return { id: r.id, key: k, gun: r.gun, saat: r.saat, sure: r.sure, per: perAd(shop, r.per), hz: r.hz }
    }
    const { o, d } = await yeniKatilim(st, shop, b, 'musteri')
    o.k = await sha(k)
    await kontenjanlaEkle(st, o, d, [st.note(key)])
    return { id: o.id, key: k, gun: o.gun, saat: d.saat, sure: d.sure, ders: d.ad, per: perAd(shop, d.per) }
  }
  if (action === 'benim') {
    const key = `spor:benim:${ip}`
    if (await st.limited(key, 30, 15 * 60_000)) throw new HttpError(429, 'too_many')
    await st.note(key).run()
    if (!validTel(b.tel)) throw new HttpError(400, 'bad_phone')
    const g = isGunu(shop.gunbas).gun
    const q = (t) => st.db.prepare(`SELECT id, gun, data FROM ${t} WHERE kod = ? AND tel = ? AND gun >= ? ORDER BY gun, id LIMIT 30`).bind(st.kod, telKey(b.tel), g).all()
    const rand = (await q('spor_randevu')).results
      .map(row)
      .filter((r) => r.durum !== 'iptal')
      .map((r) => ({ tip: 'r', id: r.id, gun: r.gun, saat: r.saat, sure: r.sure, durum: r.durum, hz: r.hz, per: perAd(shop, r.per) }))
    const ders = (await q('spor_katilim')).results
      .map(row)
      .filter((r) => r.durum === 'kayitli')
      .map((r) => {
        const d = dersBul(shop, r.ders) || { ad: r.dad || 'Ders', saat: r.saat || '', sure: 0 }
        return { tip: 'd', id: r.id, gun: r.gun, saat: d.saat, sure: d.sure, durum: gecmis(shop, r.gun, d.saat) ? 'gecti' : 'bekliyor', hz: [d.ad], per: perAd(shop, d.per) }
      })
    const out = [...rand, ...ders]
    out.sort((a, c) => (a.gun + String(isDk(a.saat || '00:00', shop.gunbas)).padStart(4, '0')).localeCompare(c.gun + String(isDk(c.saat || '00:00', shop.gunbas)).padStart(4, '0')))
    return { list: out }
  }
  if (action === 'iptal' || action === 'diptal') {
    const key = `spor:iptal:${ip}`
    if (await st.limited(key, 20, 3600_000)) throw new HttpError(429, 'too_many')
    const r = action === 'iptal' ? await st.randevu(b.id) : await st.katilim(b.id)
    if (!r.k || r.k !== (await sha(str(b.key, 64)))) {
      await st.note(key).run()
      throw new HttpError(403, 'not_yours')
    }
    if (action === 'iptal') {
      if (r.durum !== 'bekliyor') throw new HttpError(409, 'changed')
      await st.db.batch([st.putRandevu({ ...r, durum: 'iptal', iptal: 'musteri' }), st.bump()])
    } else {
      if (r.durum !== 'kayitli') throw new HttpError(409, 'changed')
      await st.db.batch([st.putKatilim({ ...r, durum: 'iptal', iptal: 'musteri' }), st.bump()])
    }
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
  const sc = secim(shop, b.hz, kaynak === 'musteri' ? 'musteri' : 'randevu')
  const list = await st.gunRandevu(gun)
  const bas = isDk(saat, shop.gunbas)
  // Çift randevu engeli: müşteri aynı gün ikinci randevu alamaz; panelde aynı telefona çakışan saat verilmez
  if (tel) {
    const ayni = list.filter((r) => r.durum === 'bekliyor' && telKey(r.tel) === telKey(tel))
    if (kaynak === 'musteri' && ayni.length) throw new HttpError(409, 'double')
    if (ayni.some((r) => { const s = isDk(r.saat, shop.gunbas); return s < bas + sc.sure && bas < s + (Number(r.sure) || shop.aralik) })) throw new HttpError(409, 'double')
  }
  if (!musaitMi(shop, [...list, ...dersBloklari(shop, gun)], per, bas, sc.sure)) throw new HttpError(409, 'slot_taken')
  return { id: uid(), gun, ad, tel, saat, sure: sc.sure, per, hz: sc.hz, fiyat: sc.fiyat, not: str(b.not, 200), durum: 'bekliyor', kaynak, olus: Date.now() }
}

/** Ders kaydı: telefon zorunlu, kontenjanlı, aynı telefon aynı derse iki kez yazılmaz */
async function yeniKatilim(st, shop, b, kaynak) {
  const ad = str(b.ad, 60)
  const tel = str(b.tel, 30)
  if (!ad) throw new HttpError(400, 'no_name')
  if (!validTel(tel)) throw new HttpError(400, 'bad_phone')
  const d = dersBul(shop, str(b.d, 40))
  if (!d) throw new HttpError(404, 'no_class')
  const g = isGunu(shop.gunbas)
  const gun = str(b.gun, 10)
  if (!DATE.test(gun) || !d.gunler.includes(haftaGunu(gun))) throw new HttpError(400, 'bad_date')
  if (gun < g.gun) throw new HttpError(400, 'past_date')
  if (gun > addDay(g.gun, DERS_ILERI)) throw new HttpError(400, 'too_far')
  if (kaynak === 'musteri' && gecmis(shop, gun, d.saat)) throw new HttpError(400, 'past_time')
  const list = (await st.dersKatilim(d.id, gun)).filter((r) => r.durum === 'kayitli')
  if (list.some((r) => telKey(r.tel) === telKey(tel))) throw new HttpError(409, 'double_class')
  if (list.length >= d.kont) throw new HttpError(409, 'full')
  return { d, o: { id: uid(), gun, ders: d.id, dad: d.ad, saat: d.saat, ad, tel, durum: 'kayitli', kaynak, olus: Date.now() } }
}
async function kontenjanlaEkle(st, o, d, extra = []) {
  await st.db.batch([st.putKatilimKont(o, d.kont), ...extra, st.bump()])
  if (!(await st.db.prepare('SELECT 1 AS x FROM spor_katilim WHERE kod = ? AND id = ?').bind(st.kod, o.id).first())) throw new HttpError(409, 'full')
}

// --- Salon paneli ---
async function session(st, req, roles) {
  const t = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  if (!t) return null
  const s = await st.db
    .prepare(`SELECT role, branch_id, staff_id FROM sessions WHERE token = ? AND role IN (${roles.map(() => '?').join(',')}) AND expires > ?`)
    .bind(t, ...roles, Date.now())
    .first()
  return s ? { token: t, rol: s.role.slice(5), kod: s.branch_id, per: s.staff_id || '' } : null
}

async function panel(req, st, shop, plat, action, ip, url) {
  if (req.method === 'GET' && action === 'info') return { ad: shop.ad, kurulu: !!(await st.secret(`spor:yon:${st.kod}`)) }
  if (req.method === 'POST' && action === 'login') return login(st, shop, await readBody(req), ip)
  const s = await session(st, req, ['spor_yon', 'spor_per'])
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
  const keys = [`spor:pin:${st.kod}:${ip}`, `spor:pin:${st.kod}`]
  if ((await st.limited(keys[0], 8, 15 * 60_000)) || (await st.limited(keys[1], 40, 15 * 60_000))) throw new HttpError(429, 'too_many')
  const pin = b.pin
  let rol = null
  let per = null
  let kod = st.kod
  if (validPin(pin)) {
    if (b.rol === 'isl') {
      // İşletme sahibi: merkez şubenin yönetici PIN'i
      if (await checkPin(pin, await st.secret(`spor:yon:${shop.isl}`))) {
        rol = 'isl'
        kod = shop.isl
      }
    } else {
      if (await checkPin(pin, await st.secret(`spor:yon:${st.kod}`))) rol = 'yon'
      if (!rol && b.rol !== 'yon') {
        for (const p of aktifPer(shop)) {
          if (await checkPin(pin, await st.secret(`spor:per:${st.kod}:${p.id}`))) {
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
      .bind(token, 'spor_' + rol, kod, per, now + (rol === 'per' ? PER_SESSION : YON_SESSION)),
    st.db.prepare('DELETE FROM sessions WHERE expires < ?').bind(now),
  ])
  return { token, rol, per }
}

const rows = async (st, table, since, order = 'gun, id') =>
  (await st.db.prepare(`SELECT id, gun, data FROM ${table} WHERE kod = ? AND gun >= ? ORDER BY ${order}`).bind(st.kod, since).all()).results.map(row)

async function state(st, shop, plat, s) {
  const g = isGunu(shop.gunbas)
  const yon = s.rol === 'yon'
  const me = s.per
  // Randevular: dünden itibaren ("Geri al" için) ileri tarihlere kadar
  const randevular = (await rows(st, 'spor_randevu', addDay(g.gun, -1), 'gun'))
    // Antrenör yalnızca kendisine ve henüz kimseye verilmemiş ("fark etmez") randevuları görür
    .filter((r) => yon || r.per === me || (!r.per && r.durum === 'bekliyor'))
    .map(({ k, ...r }) => r)
  // Grup dersleri: antrenör kendi dersini ve antrenörü belli olmayan dersleri görür
  const dersGor = (id) => {
    const d = dersBul(shop, id)
    return yon || !d || !d.per || d.per === me
  }
  const ders = (await oturumlar(st, shop, addDay(g.gun, -1), addDay(g.gun, DERS_ILERI))).filter((o) => dersGor(o.d))
  const katilimlar = (await rows(st, 'spor_katilim', addDay(g.gun, -1))).filter((r) => dersGor(r.ders)).map(({ k, ...r }) => r)
  // Üyeler: antrenör yalnızca kendi üyelerini görür
  const uyeler = (await st.db.prepare('SELECT id, data FROM spor_uye WHERE kod = ? ORDER BY updated DESC LIMIT ?').bind(st.kod, MAX_UYE).all()).results
    .map(row)
    .filter((u) => yon || u.per === me)
  const uyeIds = new Set(uyeler.map((u) => u.id))
  const girisler = (await rows(st, 'spor_giris', addDay(g.gun, -1))).filter((x) => yon || uyeIds.has(x.uye) || x.per === me)
  // Ay raporu için yaklaşık iki aylık satış
  const since = addDay(g.gun, -62)
  const kayitlar = (await rows(st, 'spor_kayit', since)).filter((k) => yon || k.per === me).map(({ once, sonra, ...k }) => k)
  const out = {
    v: shop.ver,
    rol: s.rol,
    me,
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
      dersler: shop.dersler,
      slotlar: slotlar(shop),
      // Antrenör diğerlerinin prim oranını görmez
      personel: shop.personel.map((p) => (yon || p.id === me ? p : { id: p.id, ad: p.ad, aktif: p.aktif })),
      cokSube: false,
    },
    randevular,
    ders,
    katilimlar,
    uyeler,
    girisler,
    kayitlar,
    sabit: { gider: GIDER, prim: VARSAYILAN_PRIM },
  }
  const n = (await st.db.prepare('SELECT COUNT(*) AS n FROM spor_shops WHERE isl = ?').bind(shop.isl).first()).n
  out.shop.cokSube = n > 1
  out.shop.merkez = shop.isl === shop.kod
  if (yon) {
    out.giderler = await rows(st, 'spor_gider', since, 'gun DESC')
    out.abonelik = plat ? { bitis: plat.bitis, deneme: !!plat.deneme } : null
  }
  return out
}

/** PIN, salondaki diğer PIN'lerden (yönetici ve diğer antrenörler) farklı olmalı */
async function pinBos(st, shop, pin, kendi) {
  if (kendi !== 'yon' && (await checkPin(pin, await st.secret(`spor:yon:${st.kod}`)))) throw new HttpError(400, 'same_pin_yon')
  for (const p of aktifPer(shop)) {
    if (p.id === kendi) continue
    if (await checkPin(pin, await st.secret(`spor:per:${st.kod}:${p.id}`))) throw new HttpError(400, kendi === 'yon' ? 'same_pin_per' : 'same_pin_other')
  }
}

function cleanSaat(v, def) {
  const s = str(v, 5)
  if (!s) return def
  if (!SAAT.test(s)) throw new HttpError(400, 'bad_time')
  return s
}

/** Yönetici kalem listesini kaydederken doğrular */
export function cleanHizmetler(list) {
  if (!Array.isArray(list) || !list.length || list.length > MAX_HIZMET) throw new HttpError(400, 'bad_services')
  const seen = new Set()
  return list.map((h) => {
    const ad = str(h?.ad, 40)
    const kat = str(h?.kat, 30) || 'Diğer'
    const tur = TURLER.includes(h?.tur) ? h.tur : 'hizmet'
    const fiyat = r2(num(h?.fiyat))
    if (!ad || seen.has(ad) || !(fiyat >= 0 && fiyat <= 200000)) throw new HttpError(400, 'bad_services')
    seen.add(ad)
    const o = { ad, kat, tur, fiyat }
    if (tur !== 'urun') {
      o.sure = int(h?.sure) || 30
      if (!(o.sure >= 5 && o.sure <= 600)) throw new HttpError(400, 'bad_duration')
    }
    if (tur === 'uyelik') {
      o.gun = int(h?.gun)
      if (!(o.gun >= 1 && o.gun <= 1100)) throw new HttpError(400, 'bad_days')
    }
    if (tur === 'paket') {
      o.seans = int(h?.seans)
      if (!(o.seans >= 1 && o.seans <= 500)) throw new HttpError(400, 'bad_sessions')
    }
    return o
  })
}

/** Yönetici ders programını kaydederken doğrular */
function cleanDersler(list, shop) {
  if (!Array.isArray(list) || list.length > MAX_DERS) throw new HttpError(400, 'bad_classes')
  const seen = new Set()
  return list.map((d) => {
    const ad = str(d?.ad, 40)
    const gunler = [...new Set((Array.isArray(d?.gunler) ? d.gunler : []).map(int).filter((x) => x >= 0 && x <= 6))].sort()
    const saat = str(d?.saat, 5)
    const sure = int(d?.sure)
    const kont = int(d?.kont)
    let per = str(d?.per, 20)
    if (per && !aktifPer(shop).some((p) => p.id === per)) per = ''
    if (!ad) throw new HttpError(400, 'bad_classes')
    if (!gunler.length) throw new HttpError(400, 'no_days')
    if (!SAAT.test(saat)) throw new HttpError(400, 'bad_time')
    if (!(sure >= 10 && sure <= 300)) throw new HttpError(400, 'bad_duration')
    if (!(kont >= 1 && kont <= 300)) throw new HttpError(400, 'bad_capacity')
    let id = str(d?.id, 30).replace(/[^a-z0-9-]/g, '') || slug(ad) || uid()
    while (seen.has(id)) id = id + '-' + uid().slice(0, 3)
    seen.add(id)
    return { id, ad, gunler, saat, sure, per, kont }
  })
}

async function write(st, shop, action, b, s) {
  const db = st.db
  const yon = s.rol === 'yon'
  const needYon = () => {
    if (!yon) throw new HttpError(403, 'yonetici')
  }
  const g = isGunu(shop.gunbas)
  /** Antrenör yalnızca kendi ve sahipsiz randevusuna / üyesine dokunur */
  const benim = (o) => {
    if (!yon && o.per && o.per !== s.per) throw new HttpError(403, 'not_yours')
  }
  const benimDers = (id) => {
    const d = dersBul(shop, id)
    if (!yon && d && d.per && d.per !== s.per) throw new HttpError(403, 'not_yours')
  }
  const tutarOku = (v, def) => (v === undefined || v === '' || v === null ? def : r2(num(v)))
  const kayitYap = (per, sc, tutar, od, extra = {}) => {
    // Yönetici antrenör seçmeden de satış yapabilir ("Salon"; prim yok)
    const p = per ? shop.personel.find((x) => x.id === per) : yon ? { prim: 0 } : null
    if (!p) throw new HttpError(400, 'no_staff')
    if (!ODEME.includes(od)) throw new HttpError(400, 'bad_payment')
    if (!(tutar >= 0 && tutar <= 500000)) throw new HttpError(400, 'bad_amount')
    return { id: uid(), gun: g.gun, per: per || '', hz: sc.hz.join(' + '), tutar: r2(tutar), od, prim: Number.isFinite(p.prim) ? p.prim : VARSAYILAN_PRIM, ts: Date.now(), ...extra }
  }
  /**
   * Üyelik/paket satışında üye kartı: id verildiyse o, yoksa telefonla bulunur, yoksa açılır.
   * Üye adı zorunlu.
   */
  const uyeBul = async (id, ad, tel, per) => {
    let u = null
    let yeni = false
    if (id) u = await st.uye(id)
    else if (tel) u = await st.uyeTel(tel)
    if (u) benim(u)
    else {
      if (!ad) throw new HttpError(400, 'no_member_name')
      if (tel && !validTel(tel)) throw new HttpError(400, 'bad_phone')
      u = { id: uid(), ad, tel, per: per || '', bitis: '', uyelik: '', paket: null, don: null, not: '', olus: Date.now() }
      yeni = true
    }
    if (!u.per && per) u.per = per
    return { u, yeni }
  }
  /** Satış kaydı + üye kartı (üyelik/paket varsa) */
  const satis = async (per, sc, tutar, od, extra, uyeBilgi) => {
    const out = []
    if (sc.items.some(uyeKalemi)) {
      const { u, yeni } = await uyeBul(uyeBilgi.id, uyeBilgi.ad, uyeBilgi.tel, per)
      const f = satisIsle(u, sc.items, g.gun)
      const k = kayitYap(per, sc, tutar, od, { ...extra, mus: u.ad, tel: u.tel, uye: u.id, once: f.once, sonra: f.sonra, gunTop: f.gunTop, seansTop: f.seansTop, yeni })
      out.push(st.putUye(u), st.putKayit(k))
      return { k, out }
    }
    const k = kayitYap(per, sc, tutar, od, { ...extra, mus: str(uyeBilgi.ad, 60), tel: uyeBilgi.tel })
    out.push(st.putKayit(k))
    return { k, out }
  }
  /** Satış silinince / geri alınınca üye kartı eski haline döner */
  const satisSil = async (k) => {
    const out = [st.delKayit(k.id)]
    if (k.uye && k.once) {
      try {
        const u = await st.uye(k.uye)
        const birebir = satisGeri(u, k)
        out.push(k.yeni && birebir && !u.son ? st.delUye(u.id) : st.putUye(u))
      } catch {}
    }
    return out
  }
  switch (action) {
    case 'kayit': {
      // Kasa: üyelik, paket, ders ya da ürün satışı (antrenör ya da yönetici)
      const per = yon ? str(b.per, 20) : s.per
      const sc = secim(shop, b.hz, 'satis')
      const tel = str(b.tel, 30)
      if (tel && !validTel(tel)) throw new HttpError(400, 'bad_phone')
      const { out } = await satis(per, sc, tutarOku(b.tutar, sc.fiyat), str(b.od, 10), {}, { id: str(b.uye, 40), ad: str(b.mus, 60), tel })
      return out
    }
    case 'kayitsil': {
      const k = await st.kayit(b.id)
      if (!yon && (k.per !== s.per || k.gun !== g.gun)) throw new HttpError(403, 'not_yours')
      const out = await satisSil(k)
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
      // Antrenörün eklediği randevu kendisine yazılır
      const r = await yeniRandevu(st, shop, b, 'panel', yon ? undefined : s.per)
      return [st.putRandevu(r)]
    }
    case 'geldi': {
      const r = await st.randevu(b.id)
      benim(r)
      if (r.durum !== 'bekliyor') throw new HttpError(409, 'changed')
      const per = r.per || (yon ? str(b.per, 20) : s.per)
      let sc
      try {
        sc = secim(shop, r.hz, 'satis')
      } catch {
        // Kalem listeden silinmişse randevudaki adlar ve fiyat kullanılır
        sc = { hz: Array.isArray(r.hz) ? r.hz : [String(r.hz || 'Hizmet')], items: [], fiyat: r.fiyat }
      }
      // Üyelik/paket randevusu: üye kartı açılır ya da uzar, paket yüklenir
      const { k, out } = await satis(per, sc, tutarOku(b.tutar, r.fiyat ?? sc.fiyat), str(b.od, 10), { rid: r.id }, { id: str(r.uye, 40), ad: r.ad, tel: r.tel })
      return [...out, st.putRandevu({ ...r, per, durum: 'geldi', kayit: k.id })]
    }
    case 'gerial': {
      const r = await st.randevu(b.id)
      benim(r)
      if (r.durum === 'geldi') {
        let out = []
        if (r.kayit) {
          try {
            out = await satisSil(await st.kayit(r.kayit))
          } catch {}
        }
        return [...out, st.putRandevu({ ...r, durum: 'bekliyor', kayit: '' })]
      }
      if (r.durum === 'iptal') return [st.putRandevu({ ...r, durum: 'bekliyor', iptal: '' })]
      throw new HttpError(409, 'changed')
    }
    case 'iptal': {
      const r = await st.randevu(b.id)
      benim(r)
      if (r.durum !== 'bekliyor') throw new HttpError(409, 'changed')
      return [st.putRandevu({ ...r, durum: 'iptal', iptal: 'salon' })]
    }
    case 'ustlen': {
      const r = await st.randevu(b.id)
      if (r.per) throw new HttpError(409, 'changed')
      const per = yon ? str(b.per, 20) : s.per
      if (!aktifPer(shop).some((p) => p.id === per)) throw new HttpError(400, 'no_staff')
      if (r.durum === 'bekliyor') {
        const list = [...(await st.gunRandevu(r.gun)), ...dersBloklari(shop, r.gun)]
        if (!musaitMi(shop, list, per, isDk(r.saat, shop.gunbas), Number(r.sure) || shop.aralik, r.id)) throw new HttpError(409, 'slot_taken')
      }
      return [st.putRandevu({ ...r, per })]
    }
    // --- Grup dersi kaydı ---
    case 'katil': {
      benimDers(str(b.d, 40))
      const { o, d } = await yeniKatilim(st, shop, b, 'panel')
      await kontenjanlaEkle(st, o, d)
      return []
    }
    case 'katiliptal': {
      const r = await st.katilim(b.id)
      benimDers(r.ders)
      if (r.durum !== 'kayitli') throw new HttpError(409, 'changed')
      return [st.putKatilim({ ...r, durum: 'iptal', iptal: 'salon' })]
    }
    case 'katilgerial': {
      const r = await st.katilim(b.id)
      benimDers(r.ders)
      if (r.durum !== 'iptal') throw new HttpError(409, 'changed')
      const d = dersBul(shop, r.ders)
      const list = (await st.dersKatilim(r.ders, r.gun)).filter((x) => x.durum === 'kayitli')
      if (list.some((x) => telKey(x.tel) === telKey(r.tel))) throw new HttpError(409, 'double_class')
      if (d && list.length >= d.kont) throw new HttpError(409, 'full')
      return [st.putKatilim({ ...r, durum: 'kayitli', iptal: '' })]
    }
    // --- Üyeler ---
    case 'uye': {
      // Üye ekle / düzenle. Yönetici bitiş tarihini ve kalan dersi elle de girebilir (eski üyeleri aktarırken).
      const id = str(b.id, 40)
      const ad = str(b.ad, 60)
      const tel = str(b.tel, 30)
      if (!ad) throw new HttpError(400, 'no_member_name')
      if (tel && !validTel(tel)) throw new HttpError(400, 'bad_phone')
      const u = id ? await st.uye(id) : { id: uid(), bitis: '', uyelik: '', paket: null, don: null, olus: Date.now(), per: yon ? '' : s.per }
      if (id) benim(u)
      else {
        const n = (await db.prepare('SELECT COUNT(*) AS n FROM spor_uye WHERE kod = ?').bind(st.kod).first()).n
        if (n >= MAX_UYE) throw new HttpError(400, 'too_many_members')
      }
      if (tel) {
        const v = await st.uyeTel(tel)
        if (v && v.id !== u.id) throw new HttpError(409, 'tel_taken')
      }
      u.ad = ad
      u.tel = tel
      u.not = str(b.not, 200)
      if (yon) {
        if (b.per !== undefined) {
          const p = str(b.per, 20)
          u.per = p && aktifPer(shop).some((x) => x.id === p) ? p : ''
        }
        if (b.bitis !== undefined) {
          const bi = str(b.bitis, 10)
          if (bi && !DATE.test(bi)) throw new HttpError(400, 'bad_date')
          u.bitis = bi
        }
        if (b.kalan !== undefined && b.kalan !== '') {
          const n = int(b.kalan)
          if (!(n >= 0 && n <= 500)) throw new HttpError(400, 'bad_sessions')
          u.paket = n ? { ad: u.paket?.ad || 'Ders paketi', kalan: n, top: Math.max(n, u.paket?.top || 0) } : null
        }
      }
      return [st.putUye(u)]
    }
    case 'uyesil': {
      needYon()
      const u = await st.uye(b.id)
      return [st.delUye(u.id)]
    }
    case 'giris': {
      // Giriş kaydı; "seans" ise paketten bir ders düşer
      const u = await st.uye(b.id)
      benim(u)
      if (donuk(u, g.gun)) throw new HttpError(409, 'frozen')
      const seans = b.seans === true
      if (seans) {
        if (!(u.paket?.kalan > 0)) throw new HttpError(409, 'no_session')
        u.paket = { ...u.paket, kalan: u.paket.kalan - 1 }
      } else {
        if (!(u.bitis && u.bitis >= g.gun) && !(u.paket?.kalan > 0)) throw new HttpError(409, 'expired')
        const bugun = (await st.db.prepare("SELECT 1 AS x FROM spor_giris WHERE kod = ? AND gun = ? AND json_extract(data, '$.uye') = ? AND json_extract(data, '$.seans') = 0").bind(st.kod, g.gun, u.id).first())
        if (bugun) throw new HttpError(409, 'already_in')
      }
      u.son = g.gun
      return [st.putUye(u), st.putGiris({ id: uid(), gun: g.gun, uye: u.id, ad: u.ad, per: u.per || '', ts: Date.now(), seans: seans ? 1 : 0, kim: s.per || 'yon' })]
    }
    case 'girissil': {
      const x = await st.giris(b.id)
      benim(x)
      const out = [db.prepare('DELETE FROM spor_giris WHERE kod = ? AND id = ?').bind(st.kod, x.id)]
      // Yanlış giriş silinince düşen ders pakete geri yüklenir
      const u = await st.uye(x.uye).catch(() => null)
      if (u && x.seans && u.paket) out.push(st.putUye({ ...u, paket: { ...u.paket, kalan: u.paket.kalan + 1 } }))
      return out
    }
    case 'dondur': {
      // Üyelik dondurma: bitiş, dondurulan gün kadar ileri kayar
      const u = await st.uye(b.id)
      benim(u)
      if (donuk(u, g.gun)) throw new HttpError(409, 'frozen')
      if (!(u.bitis && u.bitis >= g.gun)) throw new HttpError(409, 'expired')
      const n = int(b.gun)
      if (!(n >= 1 && n <= 180)) throw new HttpError(400, 'bad_days')
      u.don = { bas: g.gun, bit: addDay(g.gun, n - 1), gun: n, eski: u.bitis }
      u.bitis = addDay(u.bitis, n)
      return [st.putUye(u)]
    }
    case 'coz': {
      // Dondurmayı erken bitir: kullanılmayan günler bitişten düşer
      const u = await st.uye(b.id)
      benim(u)
      if (!donuk(u, g.gun)) throw new HttpError(409, 'not_frozen')
      const kullanilan = Math.max(0, gunFark(g.gun, u.don.bas))
      u.bitis = addDay(u.bitis, -(u.don.gun - kullanilan))
      u.don = null
      return [st.putUye(u)]
    }
    // --- Yönetici ---
    case 'gider': {
      needYon()
      const t = r2(num(b.tutar))
      if (!(t > 0)) throw new HttpError(400, 'bad_amount')
      const gun = DATE.test(str(b.gun)) ? str(b.gun) : g.gun
      const data = { tur: GIDER.includes(str(b.tur)) ? str(b.tur) : 'Diğer', tutar: t, not: str(b.not, 200) }
      return [db.prepare('INSERT INTO spor_gider (kod, id, gun, data) VALUES (?, ?, ?, ?)').bind(st.kod, uid(), gun, JSON.stringify(data))]
    }
    case 'gidersil': {
      needYon()
      return [db.prepare('DELETE FROM spor_gider WHERE kod = ? AND id = ?').bind(st.kod, str(b.id, 64))]
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
        const a = int(b.aralik)
        if (![15, 20, 30, 45, 60].includes(a)) throw new HttpError(400, 'bad_step')
        next.aralik = a
      }
      if (b.hizmetler !== undefined) next.hizmetler = cleanHizmetler(b.hizmetler)
      if (b.varsayilan === true) next.hizmetler = VARSAYILAN_HIZMET
      if (b.dersler !== undefined) next.dersler = cleanDersler(b.dersler, shop)
      return [st.putShop(next)]
    }
    case 'personel': {
      // Antrenör ekle ya da düzenle (ad, prim oranı). Yeni antrenöre PIN de verilir.
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
      return [st.putShop({ ...shop, personel: list }), db.prepare('INSERT OR REPLACE INTO secrets (key, hash) VALUES (?, ?)').bind(`spor:per:${st.kod}:${p.id}`, await hashPin(b.pin))]
    }
    case 'personelsil': {
      // Geçmiş kayıtlarda adı görünsün diye silinmez, pasif olur; PIN'i ve oturumları kapanır
      needYon()
      const id = str(b.id, 20)
      if (!shop.personel.some((p) => p.id === id)) throw new HttpError(404, 'no_staff')
      return [
        st.putShop({ ...shop, personel: shop.personel.map((p) => (p.id === id ? { ...p, aktif: false } : p)), dersler: shop.dersler.map((d) => (d.per === id ? { ...d, per: '' } : d)) }),
        db.prepare('DELETE FROM secrets WHERE key = ?').bind(`spor:per:${st.kod}:${id}`),
        db.prepare("DELETE FROM sessions WHERE role = 'spor_per' AND branch_id = ? AND staff_id = ?").bind(st.kod, id),
      ]
    }
    case 'perpin': {
      // Yönetici antrenörün PIN'ini yeniler; antrenör kendi PIN'ini değiştirir
      const id = yon ? str(b.id, 20) : s.per
      if (!aktifPer(shop).some((p) => p.id === id)) throw new HttpError(404, 'no_staff')
      if (!validPin(b.pin)) throw new HttpError(400, 'bad_pin')
      await pinBos(st, shop, b.pin, id)
      return [
        db.prepare('INSERT OR REPLACE INTO secrets (key, hash) VALUES (?, ?)').bind(`spor:per:${st.kod}:${id}`, await hashPin(b.pin)),
        db.prepare("DELETE FROM sessions WHERE role = 'spor_per' AND branch_id = ? AND staff_id = ? AND token != ?").bind(st.kod, id, s.token),
      ]
    }
    case 'pin': {
      needYon()
      if (!validPin(b.pin)) throw new HttpError(400, 'bad_pin')
      await pinBos(st, shop, b.pin, 'yon')
      return [
        db.prepare('INSERT OR REPLACE INTO secrets (key, hash) VALUES (?, ?)').bind(`spor:yon:${st.kod}`, await hashPin(b.pin)),
        db.prepare("DELETE FROM sessions WHERE role IN ('spor_yon', 'spor_isl') AND branch_id = ? AND token != ?").bind(st.kod, s.token),
      ]
    }
  }
  throw new HttpError(404, 'not_found')
}

// --- İşletme (çok şubeli) ---
async function isletme(req, st, shop, action) {
  const s = await session(st, req, ['spor_isl'])
  if (!s || s.kod !== shop.isl) throw new HttpError(401, 'login')
  const subeler = (await st.db.prepare('SELECT kod FROM spor_shops WHERE isl = ? ORDER BY rowid').bind(shop.isl).all()).results.map((r) => r.kod)
  if (req.method === 'GET' && action === 'ozet') {
    const g = isGunu(shop.gunbas)
    const since = addDay(g.gun, -62)
    const out = []
    for (const kod of subeler) {
      const o = new Store(st.db, kod)
      const sh = await o.shop()
      const pl = await o.plat()
      const gg = isGunu(sh.gunbas).gun
      const kayit = (await rows(o, 'spor_kayit', since)).map((k) => ({ gun: k.gun, tutar: k.tutar, od: k.od, prim: k.prim, per: k.per }))
      const gider = (await rows(o, 'spor_gider', since)).map((r) => ({ gun: r.gun, tutar: r.tutar }))
      const uye = (await st.db.prepare("SELECT COUNT(*) AS n FROM spor_uye WHERE kod = ? AND json_extract(data, '$.bitis') >= ?").bind(kod, gg).first()).n
      const giris = (await st.db.prepare('SELECT COUNT(*) AS n FROM spor_giris WHERE kod = ? AND gun = ?').bind(kod, gg).first()).n
      out.push({ kod, ad: sh.ad, kilit: isLocked(pl), bitis: pl?.bitis || '', personel: aktifPer(sh).length, uye, giris, kayit, gider })
    }
    const ayar = await st.db.prepare("SELECT data FROM plat_kv WHERE k = 'ayar'").first()
    return { gun: g.gun, merkez: shop.isl, subeler: out, ekUcret: ayar ? Math.round(num(JSON.parse(ayar.data).sube)) || 0 : 0 }
  }
  if (req.method === 'POST' && action === 'sube') return yeniSube(st, shop, await readBody(req))
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
  const n = (await db.prepare('SELECT COUNT(*) AS n FROM spor_shops WHERE isl = ?').bind(shop.isl).first()).n
  if (n >= 20) throw new HttpError(400, 'too_many_branches')
  if ((await db.prepare('SELECT 1 AS x FROM plat_shops WHERE kod = ?').bind(kod).first()) || (await db.prepare('SELECT 1 AS x FROM spor_shops WHERE kod = ?').bind(kod).first()))
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
  // Kalemler ve ders programı merkezden gelir (antrenörsüz)
  const data = { ad, wa: ms.wa, adres: '', gunbas: ms.gunbas, acilis: ms.acilis, kapanis: ms.kapanis, aralik: ms.aralik, hizmetler: ms.hizmetler, dersler: ms.dersler.map((d) => ({ ...d, per: '' })), personel: [] }
  await db.batch([
    db.prepare('INSERT INTO plat_shops (id, kod, data) VALUES (?, ?, ?)').bind(p.id, kod, JSON.stringify(p)),
    // Merkez de aynı işletme adını taşısın; ilave şube ücreti sahip panelinde bu adla hesaplanır
    db.prepare('UPDATE plat_shops SET data = ? WHERE kod = ?').bind(JSON.stringify({ ...merkez, isl: islAd }), shop.isl),
    db.prepare('INSERT INTO spor_shops (kod, isl, data) VALUES (?, ?, ?)').bind(kod, shop.isl, JSON.stringify(data)),
    db.prepare('INSERT OR REPLACE INTO secrets (key, hash) VALUES (?, ?)').bind(`spor:yon:${kod}`, await hashPin(b.pin)),
  ])
  return { ok: true, kod }
}

// --- Sayfalar ---
const ICON = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#0F5C4C"/><rect x="10" y="22" width="8" height="20" rx="2" fill="#fff"/><rect x="46" y="22" width="8" height="20" rx="2" fill="#fff"/><rect x="18" y="27" width="5" height="10" rx="1" fill="#fff"/><rect x="41" y="27" width="5" height="10" rx="1" fill="#fff"/><rect x="23" y="30" width="18" height="4" fill="#fff"/></svg>`

function manifest(area, kod, ad) {
  return JSON.stringify({
    name: ad || 'Sporum',
    short_name: area === 's' ? 'Salon Panel' : 'Randevu',
    start_url: `/${area}/${kod}`,
    scope: `/${area}/${kod}`,
    display: 'standalone',
    background_color: '#F4F7F6',
    theme_color: '#0F5C4C',
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
        const r = await env.DB.prepare('SELECT data FROM spor_shops WHERE kod = ?').bind(m[2]).first()
        return new Response(manifest(m[1], m[2], r ? JSON.parse(r.data).ad : ''), { headers: { 'content-type': 'application/manifest+json' } })
      }
      if (p === '/robots.txt') return new Response('User-agent: *\nDisallow: /s/\n', { headers: { 'content-type': 'text/plain' } })
      // Müşteri sayfası: salon bilgisi ve ders programı sayfanın içine gömülür, telefon tek istekle açılır (zayıf mobil veri)
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
