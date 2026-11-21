// Sahip paneli sunucusu (/api/patron/*) ve abonelik kilidi.
//
// Sahip paneli, uygulamayı kiralayan dükkânların aboneliğini tutar.
// Kendi PIN'i (secrets: 'platform') ve oturumu (sessions.role = 'platform')
// vardır. Salon kayıtlarına (rows) yalnızca "Güzellik salonunu kur" ile yeni
// salon açarken yazar; var olan salonun kayıtlarını değiştirmez.
//
// Kilit: kodu bir şubenin kısa adıyla aynı olan dükkânın süresi biterse
// (bitiş günü geçince) ya da "Durdur" denirse o şubenin müşteri linki ve
// paneli 402 "subscription_ended" alır. Kayıtlar silinmez; ödeme alınınca
// ya da "Yeniden aç" denince bir sonraki istekte açılır.

import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types'
import { newSalonRows } from './salon'

export class PatronError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}

export const SEKTORLER = ['Güzellik Salonu', 'Bayan Kuaför', 'Berber', 'Spor Salonu', 'Halı Yıkama']
const GUZELLIK = 'Güzellik Salonu'

export interface Shop {
  id: string
  ad: string
  sektor: string
  tel: string
  paket: string
  deneme: boolean
  bitis: string
  dur: boolean
  not: string
  isl: string
  kod: string
  /** Güzellik salonu: panel PIN'siz açılır, yalnızca Yönetici sekmesi PIN ister (demo dükkânı için) */
  acik?: boolean
}
export interface Payment {
  id: string
  t: string
  sid: string
  ad: string
  tutar: number
  ay: number
  y: string
  onc?: { bitis: string; deneme: boolean; dur: boolean }
}
interface Paket {
  id: string
  ad: string
  fiyat: number
  pers: number
}
interface Ayar {
  sube: number
  adres: string
  wa: string
  /** Halı yıkama uygulamasının adresi (halıcı linkleri bundan yapılır) */
  hali?: string
  /** Berber uygulamasının (Berberim) adresi */
  berber?: string
  /** Bayan kuaför uygulamasının (Kuaförüm) adresi */
  kuafor?: string
  /** Spor salonu uygulamasının (Sporum) adresi */
  spor?: string
}
// Halıcı linklerinin ve QR'ların adresi. Asıl ayar sahip panelinde (Ayarlar → Halı yıkama uygulamasının adresi,
// veritabanında plat_kv 'ayar'.hali); bu yalnızca ayar boşsa kullanılır. Halı uygulaması da aynı ayarı okur.
const HALI_ADRES = 'https://hali-yikama.esnafim.workers.dev'
const BERBER_ADRES = 'https://berberim.pages.dev'
const KUAFOR_ADRES = 'https://kuaforum.pages.dev'
const SPOR_ADRES = 'https://sporum.pages.dev'

const DAY = 86_400_000
const SESSION_DAYS = 1
const MAX_FAILS = 8
const WINDOW_MS = 15 * 60_000
const DATE = /^\d{4}-\d{2}-\d{2}$/

/** Türkiye'de bugünün tarihi (YYYY-MM-DD) */
export const trToday = (now = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)

export function addDay(d: string, n: number) {
  const x = new Date(d + 'T12:00:00Z')
  x.setUTCDate(x.getUTCDate() + n)
  return x.toISOString().slice(0, 10)
}

export const isLocked = (s: Pick<Shop, 'dur' | 'bitis'>, today = trToday()) => !!s.dur || s.bitis < today

const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const num = (v: unknown, min = 0, max = 10_000_000) => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min
}
export function slug(t: unknown) {
  return String(t ?? '')
    .toLocaleLowerCase('tr-TR')
    .replace(/ç/g, 'c').replace(/ğ/g, 'g').replace(/ı/g, 'i').replace(/i̇/g, 'i').replace(/ö/g, 'o').replace(/ş/g, 's').replace(/ü/g, 'u')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 60)
}
const uid = () => crypto.randomUUID().replace(/-/g, '').slice(0, 12)

const enc = new TextEncoder()
const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
function randomToken(bytes = 24) {
  const a = new Uint8Array(bytes)
  crypto.getRandomValues(a)
  return [...a].map((b) => b.toString(16).padStart(2, '0')).join('')
}
async function hashPin(pin: string, salt = randomToken(8)) {
  return `${salt}$${hex(await crypto.subtle.digest('SHA-256', enc.encode(`${salt}:${pin}`)))}`
}
async function checkPin(pin: string, stored: string) {
  return (await hashPin(pin, stored.split('$')[0])) === stored
}

// --- Kilit (salon sunucusu kullanır) ---

/** Kilitli dükkânın ekranda gösterilecek bilgisi */
export interface LockInfo {
  ad: string
  wa: string
}

async function shopByKod(db: D1Database, kod: string) {
  const r = await db.prepare('SELECT data FROM plat_shops WHERE kod = ?').bind(kod).first<{ data: string }>()
  return r ? (JSON.parse(r.data) as Shop) : null
}

async function ownerWa(db: D1Database) {
  const r = await db.prepare("SELECT data FROM plat_kv WHERE k = 'ayar'").first<{ data: string }>()
  return r ? str((JSON.parse(r.data) as Ayar).wa, 30) : ''
}

/** Güzellik salonunun paneli PIN'siz mi (sahip panelinde açılır; abonelik açık olmalı) */
export async function isOpenPanel(db: D1Database, branchSlug: string) {
  const s = await shopByKod(db, branchSlug)
  return !!s && s.sektor === GUZELLIK && !!s.acik && !isLocked(s)
}

/** Bu kısa ad başka sektörden bir dükkânın kodu mu (güzellik şubesi bu adı alamaz) */
export async function slugUsedByOtherSector(db: D1Database, branchSlug: string) {
  const s = await shopByKod(db, branchSlug)
  return !!s && s.sektor !== GUZELLIK
}

/** Bu şube (kısa adıyla) kilitliyse bilgisi, değilse null */
export async function lockOfSlug(db: D1Database, branchSlug: string): Promise<LockInfo | null> {
  const s = await shopByKod(db, branchSlug)
  if (!s || !isLocked(s)) return null
  return { ad: s.ad, wa: await ownerWa(db) }
}

/**
 * İşletme sahibi (/sahip) için: aboneliği takip edilen şubelerinin hepsi
 * kilitliyse kilit bilgisi. Takip edilen şubesi yoksa açık.
 */
export async function lockOfOwner(db: D1Database, branchSlugs: string[]): Promise<LockInfo | null> {
  if (!branchSlugs.length) return null
  const { results } = await db
    .prepare(`SELECT data FROM plat_shops WHERE kod IN (${branchSlugs.map(() => '?').join(',')})`)
    .bind(...branchSlugs)
    .all<{ data: string }>()
  const shops = results.map((r) => JSON.parse(r.data) as Shop)
  if (!shops.length || shops.some((s) => !isLocked(s))) return null
  return { ad: shops[0].ad, wa: await ownerWa(db) }
}

// --- Sahip paneli uçları ---

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })

export async function handlePatron(req: Request, db: D1Database, path: string[]): Promise<Response> {
  try {
    const p = new Patron(db, req)
    const b = req.method === 'POST' ? await body(req) : {}
    const [a] = path
    if (req.method === 'POST' && a === 'login') return json(await p.login(b))
    if (req.method === 'POST' && a === 'logout') return json(await p.logout())
    if (req.method === 'POST' && a === 'reset-request') return json(await p.resetRequest(b))
    if (req.method === 'POST' && a === 'reset-done') return json(await p.resetDone(b))
    await p.auth()
    if (req.method === 'GET' && a === 'state') return json(await p.state())
    if (req.method !== 'POST') throw new PatronError(404, 'not_found')
    if (a === 'shop') await p.saveShop(b)
    else if (a === 'add') await p.addShop(b)
    else if (a === 'delete') await p.deleteShop(b)
    else if (a === 'pay') await p.pay(b)
    else if (a === 'undo') await p.undo(b)
    else if (a === 'trial') await p.trial(b)
    else if (a === 'stop') await p.stop(b)
    else if (a === 'note') await p.note(b)
    else if (a === 'settings') await p.settings(b)
    else if (a === 'restore') await p.restore(b)
    else if (a === 'pin') await p.pin(b)
    else if (a === 'hali-pin') await p.haliPin(b)
    else if (a === 'berber-pin') await p.berberPin(b)
    else if (a === 'kuafor-pin') await p.kuaforPin(b)
    else if (a === 'spor-pin') await p.sporPin(b)
    else if (a === 'guzellik-kur') await p.guzellikKur(b)
    else if (a === 'acik') await p.acik(b)
    else throw new PatronError(404, 'not_found')
    return json(await p.state())
  } catch (e) {
    if (e instanceof PatronError) return json({ error: e.message }, e.status)
    console.error(e)
    return json({ error: 'server' }, 500)
  }
}

async function body(req: Request): Promise<Record<string, unknown>> {
  if (Number(req.headers.get('content-length') || 0) > 3_000_000) throw new PatronError(413, 'too_large')
  try {
    const v = await req.json()
    if (v && typeof v === 'object') return v as Record<string, unknown>
  } catch {
    /* aşağıda */
  }
  throw new PatronError(400, 'bad_json')
}

class Patron {
  constructor(
    private db: D1Database,
    private req: Request,
  ) {}

  private token() {
    return (this.req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  }
  private ip() {
    return this.req.headers.get('cf-connecting-ip') || 'local'
  }

  async login(b: Record<string, unknown>) {
    const pin = b.pin
    const keys = [`platform:${this.ip()}`, 'platform']
    const since = Date.now() - WINDOW_MS
    for (const [i, k] of keys.entries()) {
      const r = await this.db.prepare('SELECT COUNT(*) AS n FROM attempts WHERE key = ? AND ts > ?').bind(k, since).first<{ n: number }>()
      if ((r?.n ?? 0) >= MAX_FAILS * (i ? 6 : 1)) throw new PatronError(429, 'too_many')
    }
    const s = await this.db.prepare("SELECT hash FROM secrets WHERE key = 'platform'").first<{ hash: string }>()
    if (typeof pin !== 'string' || !s || !(await checkPin(pin, s.hash))) {
      await this.db.batch(keys.map((k) => this.db.prepare('INSERT INTO attempts (key, ts) VALUES (?, ?)').bind(k, Date.now())))
      throw new PatronError(403, 'wrong_pin')
    }
    const token = randomToken()
    const now = Date.now()
    await this.db.batch([
      this.db.prepare("INSERT INTO sessions (token, role, branch_id, staff_id, expires) VALUES (?, 'platform', NULL, NULL, ?)").bind(token, now + SESSION_DAYS * DAY),
      this.db.prepare('DELETE FROM sessions WHERE expires < ?').bind(now),
    ])
    return { token }
  }

  // --- PIN'imi unuttum ---
  // Telefon rastgele bir gizli anahtar üretir ve saklar; sunucu yalnızca özetini tutar ve
  // telefona kısa bir sıfırlama kodu verir. Kod, uygulamanın kurucusuna (veritabanı erişimi olan)
  // iletilir ve o veritabanında onaylar. Onaydan sonra yalnızca o gizli anahtarı tutan telefon
  // yeni PIN'i belirleyebilir; kod tek başına işe yaramaz. 30 dakika geçerlidir.
  async resetRequest(b: Record<string, unknown>) {
    const sec = str(b.secret, 128)
    if (!/^[0-9a-f]{32,128}$/.test(sec)) throw new PatronError(400, 'bad_request')
    const key = `platform-reset:${this.ip()}`
    const r = await this.db.prepare('SELECT COUNT(*) AS n FROM attempts WHERE key = ? AND ts > ?').bind(key, Date.now() - 3600_000).first<{ n: number }>()
    if ((r?.n ?? 0) >= 5) throw new PatronError(429, 'too_many')
    const abc = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
    const rnd = new Uint8Array(6)
    crypto.getRandomValues(rnd)
    const kod = [...rnd].map((x) => abc[x % abc.length]).join('')
    const rec = { h: hex(await crypto.subtle.digest('SHA-256', enc.encode(sec))), kod, exp: Date.now() + 30 * 60_000, ok: false }
    await this.db.batch([
      this.db.prepare('INSERT INTO attempts (key, ts) VALUES (?, ?)').bind(key, Date.now()),
      this.db.prepare("INSERT OR REPLACE INTO plat_kv (k, data) VALUES ('reset', ?)").bind(JSON.stringify(rec)),
    ])
    return { kod }
  }

  async resetDone(b: Record<string, unknown>) {
    const key = `platform-reset:${this.ip()}`
    const r = await this.db.prepare('SELECT COUNT(*) AS n FROM attempts WHERE key = ? AND ts > ?').bind(key, Date.now() - 3600_000).first<{ n: number }>()
    if ((r?.n ?? 0) >= 10) throw new PatronError(429, 'too_many')
    const row = await this.db.prepare("SELECT data FROM plat_kv WHERE k = 'reset'").first<{ data: string }>()
    const rec = row ? (JSON.parse(row.data) as { h: string; kod: string; exp: number; ok: boolean }) : null
    const h = hex(await crypto.subtle.digest('SHA-256', enc.encode(str(b.secret, 128))))
    if (!rec || rec.h !== h) {
      await this.db.prepare('INSERT INTO attempts (key, ts) VALUES (?, ?)').bind(key, Date.now()).run()
      throw new PatronError(403, 'reset_unknown')
    }
    if (rec.exp < Date.now()) throw new PatronError(410, 'reset_expired')
    if (!rec.ok) throw new PatronError(403, 'reset_waiting')
    const pin = b.pin
    if (typeof pin !== 'string' || !/^\d{4,8}$/.test(pin)) throw new PatronError(400, 'bad_pin')
    const token = randomToken()
    const now = Date.now()
    await this.db.batch([
      this.db.prepare("INSERT OR REPLACE INTO secrets (key, hash) VALUES ('platform', ?)").bind(await hashPin(pin)),
      this.db.prepare("DELETE FROM sessions WHERE role = 'platform'"),
      this.db.prepare("DELETE FROM plat_kv WHERE k = 'reset'"),
      this.db.prepare("DELETE FROM attempts WHERE key LIKE 'platform%'"),
      this.db.prepare("INSERT INTO sessions (token, role, branch_id, staff_id, expires) VALUES (?, 'platform', NULL, NULL, ?)").bind(token, now + SESSION_DAYS * DAY),
    ])
    return { token }
  }

  async logout() {
    const t = this.token()
    if (t) await this.db.prepare("DELETE FROM sessions WHERE token = ? AND role = 'platform'").bind(t).run()
    return { ok: true }
  }

  async auth() {
    const t = this.token()
    const s = t
      ? await this.db.prepare("SELECT 1 AS x FROM sessions WHERE token = ? AND role = 'platform' AND expires > ?").bind(t, Date.now()).first()
      : null
    if (!s) throw new PatronError(401, 'login')
  }

  // --- Okuma ---

  private async shops() {
    const { results } = await this.db.prepare('SELECT data FROM plat_shops ORDER BY rowid').all<{ data: string }>()
    return results.map((r) => JSON.parse(r.data) as Shop)
  }
  private async shop(id: unknown) {
    const r = await this.db.prepare('SELECT data FROM plat_shops WHERE id = ?').bind(str(id, 64)).first<{ data: string }>()
    if (!r) throw new PatronError(404, 'shop_not_found')
    return JSON.parse(r.data) as Shop
  }
  private async kv<T>(k: string, fallback: T): Promise<T> {
    const r = await this.db.prepare('SELECT data FROM plat_kv WHERE k = ?').bind(k).first<{ data: string }>()
    return r ? (JSON.parse(r.data) as T) : fallback
  }

  async state() {
    const { results: pays } = await this.db.prepare('SELECT data FROM plat_payments ORDER BY t DESC, rowid DESC').all<{ data: string }>()
    // Güzellik uygulamasındaki şubeler, her biri kendi salonunun adıyla
    // (listede olmayanlar, örn. salonun sonradan açtığı şube, "listeye ekle" ile eklenir)
    const br = await this.branchesWithSalon()
    return {
      today: trToday(),
      salonlar: await this.shops(),
      odemeler: pays.map((r) => JSON.parse(r.data) as Payment),
      paketler: await this.kv<Paket[]>('paketler', []),
      ayar: { hali: HALI_ADRES, berber: BERBER_ADRES, kuafor: KUAFOR_ADRES, spor: SPOR_ADRES, ...(await this.kv<Ayar>('ayar', { sube: 0, adres: '', wa: '' })) },
      // PIN'leri belirlenmiş (kurulmuş) halıcıların kodları
      haliKurulu: (await this.db.prepare("SELECT key FROM secrets WHERE key LIKE 'hali:yon:%'").all<{ key: string }>()).results.map((r) => r.key.slice(9)),
      // Yönetici PIN'i belirlenmiş berberlerin kodları
      berberKurulu: (await this.db.prepare("SELECT key FROM secrets WHERE key LIKE 'berber:yon:%'").all<{ key: string }>()).results.map((r) => r.key.slice(11)),
      // Yönetici PIN'i belirlenmiş bayan kuaförlerin kodları
      kuaforKurulu: (await this.db.prepare("SELECT key FROM secrets WHERE key LIKE 'kuafor:yon:%'").all<{ key: string }>()).results.map((r) => r.key.slice(11)),
      // Yönetici PIN'i belirlenmiş spor salonlarının kodları
      sporKurulu: (await this.db.prepare("SELECT key FROM secrets WHERE key LIKE 'spor:yon:%'").all<{ key: string }>()).results.map((r) => r.key.slice(9)),
      // Uygulaması kurulmuş (şubesi olan) güzellik salonlarının kodları
      guzellikKurulu: br.map((r) => r.ix),
      subeler: br.map((r) => {
        const d = JSON.parse(r.data) as { name?: string; phone?: string }
        const bizName = r.bdata ? str((JSON.parse(r.bdata) as { name?: string }).name, 120) : ''
        return { kod: r.ix, ad: d.name && d.name !== 'Merkez' ? `${bizName} ${d.name}`.trim() : bizName || d.name || r.ix, tel: str(d.phone, 30) }
      }),
    }
  }

  /** Güzellik şubeleri ve salonlarının işletme kaydı */
  private async branchesWithSalon() {
    try {
      return (
        await this.db
          .prepare(
            `SELECT r.ix AS ix, r.data AS data, b.data AS bdata FROM rows r
               LEFT JOIN rows b ON b.kind = 'business' AND b.id = r.biz AND b.deleted = 0
              WHERE r.kind = 'branch' AND r.deleted = 0 ORDER BY r.rowid`,
          )
          .all<{ ix: string; data: string; bdata: string | null }>()
      ).results
    } catch (e) {
      // Çok dükkânlı güncelleme (0007) henüz uygulanmamış veritabanı: tek işletme
      if (!String(e).includes('biz')) throw e
      const { results } = await this.db
        .prepare("SELECT ix, data FROM rows WHERE kind = 'branch' AND deleted = 0 ORDER BY rowid")
        .all<{ ix: string; data: string }>()
      const biz = await this.db.prepare("SELECT data FROM rows WHERE kind = 'business' AND deleted = 0 LIMIT 1").first<{ data: string }>()
      return results.map((r) => ({ ...r, bdata: biz?.data ?? null }))
    }
  }

  // --- Yazma ---

  private putShop(s: Shop) {
    return this.db
      .prepare('INSERT INTO plat_shops (id, kod, data) VALUES (?1, ?2, ?3) ON CONFLICT (id) DO UPDATE SET kod = excluded.kod, data = excluded.data')
      .bind(s.id, s.kod, JSON.stringify(s))
  }

  private async kodFree(kod: string, id: string, sektor?: string) {
    const r = await this.db.prepare('SELECT id FROM plat_shops WHERE kod = ?').bind(kod).first<{ id: string }>()
    if (r && r.id !== id) throw new PatronError(409, 'kod_taken')
    // Başka sektörden dükkân, bir güzellik şubesinin kısa adını kod olarak alamaz
    // (abonelik kilidi kodla bulunduğu için iki dükkân birbirini kilitlerdi)
    if (sektor && sektor !== GUZELLIK) {
      const br = await this.db.prepare("SELECT 1 AS x FROM rows WHERE kind = 'branch' AND ix = ? AND deleted = 0").bind(kod).first()
      if (br) throw new PatronError(409, 'kod_taken')
    }
  }

  private clean(b: Record<string, unknown>, old?: Shop): Shop {
    const ad = str(b.ad, 120)
    if (!ad) throw new PatronError(400, 'no_name')
    const kod = slug(b.kod) || slug(ad)
    if (!kod) throw new PatronError(400, 'no_kod')
    const bitis = str(b.bitis, 10)
    return {
      id: old?.id ?? uid(),
      ad,
      sektor: SEKTORLER.includes(str(b.sektor)) ? str(b.sektor) : SEKTORLER[0],
      tel: str(b.tel, 30),
      paket: str(b.paket, 20) || 'p1',
      deneme: old ? old.deneme : true,
      bitis: DATE.test(bitis) ? bitis : old?.bitis ?? addDay(trToday(), 14),
      dur: old ? old.dur : false,
      not: old ? old.not : '',
      isl: str(b.isl, 80),
      kod,
      ...(old?.acik ? { acik: true } : {}),
    }
  }

  async addShop(b: Record<string, unknown>) {
    const s = this.clean({ ...b, bitis: addDay(trToday(), 14) })
    await this.kodFree(s.kod, s.id, s.sektor)
    await this.putShop(s).run()
  }

  async saveShop(b: Record<string, unknown>) {
    const old = await this.shop(b.id)
    const s = this.clean(b, old)
    await this.kodFree(s.kod, s.id, s.sektor)
    const stmts: D1PreparedStatement[] = [this.putShop(s)]
    if (s.ad !== old.ad) {
      // Eski ödemelerde de yeni ad görünsün
      const { results } = await this.db.prepare('SELECT id, data FROM plat_payments WHERE shop_id = ?').bind(s.id).all<{ id: string; data: string }>()
      for (const r of results)
        stmts.push(this.db.prepare('UPDATE plat_payments SET data = ? WHERE id = ?').bind(JSON.stringify({ ...JSON.parse(r.data), ad: s.ad }), r.id))
    }
    await this.db.batch(stmts)
  }

  async deleteShop(b: Record<string, unknown>) {
    const s = await this.shop(b.id)
    // Ödemeler raporda kalsın diye silinmez
    await this.db.prepare('DELETE FROM plat_shops WHERE id = ?').bind(s.id).run()
  }

  async pay(b: Record<string, unknown>) {
    const s = await this.shop(b.id)
    const ay = Math.round(num(b.ay, 1, 36))
    const tutar = Math.round(num(b.tutar, 0))
    const y = ['Havale', 'Kart', 'Nakit'].includes(str(b.y)) ? str(b.y) : 'Havale'
    const today = trToday()
    const onc = { bitis: s.bitis, deneme: s.deneme, dur: s.dur }
    const start = s.bitis > today ? s.bitis : today
    const next: Shop = { ...s, bitis: addDay(start, 30 * ay), deneme: false, dur: false }
    const pay: Payment = { id: uid(), t: today, sid: s.id, ad: s.ad, tutar, ay, y, onc }
    await this.db.batch([
      this.putShop(next),
      this.db.prepare('INSERT INTO plat_payments (id, shop_id, t, data) VALUES (?, ?, ?, ?)').bind(pay.id, s.id, today, JSON.stringify(pay)),
    ])
  }

  async undo(b: Record<string, unknown>) {
    const r = await this.db.prepare('SELECT data FROM plat_payments WHERE id = ?').bind(str(b.id, 64)).first<{ data: string }>()
    if (!r) throw new PatronError(404, 'payment_not_found')
    const pay = JSON.parse(r.data) as Payment
    const stmts: D1PreparedStatement[] = [this.db.prepare('DELETE FROM plat_payments WHERE id = ?').bind(pay.id)]
    const sr = await this.db.prepare('SELECT data FROM plat_shops WHERE id = ?').bind(pay.sid).first<{ data: string }>()
    if (sr && pay.onc) stmts.push(this.putShop({ ...(JSON.parse(sr.data) as Shop), ...pay.onc }))
    await this.db.batch(stmts)
  }

  async trial(b: Record<string, unknown>) {
    const s = await this.shop(b.id)
    const today = trToday()
    await this.putShop({ ...s, bitis: addDay(s.bitis > today ? s.bitis : today, 7) }).run()
  }

  async stop(b: Record<string, unknown>) {
    const s = await this.shop(b.id)
    await this.putShop({ ...s, dur: !s.dur }).run()
  }

  async note(b: Record<string, unknown>) {
    const s = await this.shop(b.id)
    await this.putShop({ ...s, not: str(b.not, 500) }).run()
  }

  async settings(b: Record<string, unknown>) {
    const stmts: D1PreparedStatement[] = []
    if (b.ayar && typeof b.ayar === 'object') {
      const a = b.ayar as Record<string, unknown>
      const old = await this.kv<Ayar>('ayar', { sube: 0, adres: '', wa: '' })
      const next: Ayar = {
        sube: a.sube === undefined ? old.sube : Math.round(num(a.sube)),
        adres: a.adres === undefined ? old.adres : str(a.adres, 200),
        wa: a.wa === undefined ? old.wa : str(a.wa, 30),
        hali: a.hali === undefined ? old.hali ?? HALI_ADRES : str(a.hali, 200),
        berber: a.berber === undefined ? old.berber ?? BERBER_ADRES : str(a.berber, 200),
        kuafor: a.kuafor === undefined ? old.kuafor ?? KUAFOR_ADRES : str(a.kuafor, 200),
        spor: a.spor === undefined ? old.spor ?? SPOR_ADRES : str(a.spor, 200),
      }
      stmts.push(this.db.prepare("INSERT OR REPLACE INTO plat_kv (k, data) VALUES ('ayar', ?)").bind(JSON.stringify(next)))
    }
    if (Array.isArray(b.paketler)) stmts.push(this.db.prepare("INSERT OR REPLACE INTO plat_kv (k, data) VALUES ('paketler', ?)").bind(JSON.stringify(cleanPaketler(b.paketler))))
    if (stmts.length) await this.db.batch(stmts)
  }

  /** Yedekten geri yükleme: sahip panelinin tüm kayıtları yedektekiyle değişir */
  async restore(b: Record<string, unknown>) {
    const o = (b.yedek ?? b) as Record<string, unknown>
    if (!Array.isArray(o.salonlar) || !Array.isArray(o.odemeler) || !Array.isArray(o.paketler)) throw new PatronError(400, 'bad_backup')
    const seen = new Set<string>()
    const shops: Shop[] = []
    for (const x of o.salonlar as Record<string, unknown>[]) {
      const s = this.clean(x)
      s.id = str(x.id, 64) || s.id
      s.deneme = !!x.deneme
      s.dur = !!x.dur
      s.not = str(x.not, 500)
      if (x.acik === true && s.sektor === GUZELLIK) s.acik = true
      if (seen.has(s.kod) || seen.has('#' + s.id)) continue
      seen.add(s.kod)
      seen.add('#' + s.id)
      shops.push(s)
    }
    const pays: Payment[] = (o.odemeler as Record<string, unknown>[])
      .filter((x) => x && DATE.test(str(x.t, 10)))
      .map((x) => {
        const onc = x.onc as Payment['onc'] | undefined
        return {
          id: str(x.id, 64) || uid(),
          t: str(x.t, 10),
          sid: str(x.sid, 64),
          ad: str(x.ad, 120),
          tutar: Math.round(num(x.tutar)),
          ay: Math.round(num(x.ay, 1, 36)),
          y: str(x.y, 20) || 'Havale',
          ...(onc && DATE.test(String(onc.bitis)) ? { onc: { bitis: String(onc.bitis), deneme: !!onc.deneme, dur: !!onc.dur } } : {}),
        }
      })
    const a = (o.ayar ?? {}) as Record<string, unknown>
    const ayar: Ayar = { sube: Math.round(num(a.sube)), adres: str(a.adres, 200), wa: str(a.wa, 30), hali: str(a.hali, 200) || HALI_ADRES, berber: str(a.berber, 200) || BERBER_ADRES, kuafor: str(a.kuafor, 200) || KUAFOR_ADRES, spor: str(a.spor, 200) || SPOR_ADRES }
    await this.db.batch([
      this.db.prepare('DELETE FROM plat_shops'),
      this.db.prepare('DELETE FROM plat_payments'),
      ...shops.map((s) => this.putShop(s)),
      ...pays.map((p) => this.db.prepare('INSERT OR REPLACE INTO plat_payments (id, shop_id, t, data) VALUES (?, ?, ?, ?)').bind(p.id, p.sid, p.t, JSON.stringify(p))),
      this.db.prepare("INSERT OR REPLACE INTO plat_kv (k, data) VALUES ('ayar', ?)").bind(JSON.stringify(ayar)),
      this.db.prepare("INSERT OR REPLACE INTO plat_kv (k, data) VALUES ('paketler', ?)").bind(JSON.stringify(cleanPaketler(o.paketler as unknown[]))),
    ])
  }

  async haliPin(b: Record<string, unknown>) {
    const s = await this.shop(b.id)
    if (s.sektor !== 'Halı Yıkama') throw new PatronError(400, 'not_hali')
    await setHaliPins(this.db, s, b.yon, b.per)
  }

  async berberPin(b: Record<string, unknown>) {
    const s = await this.shop(b.id)
    if (s.sektor !== 'Berber') throw new PatronError(400, 'not_berber')
    await setBerberPin(this.db, s, b.yon)
  }

  async kuaforPin(b: Record<string, unknown>) {
    const s = await this.shop(b.id)
    if (s.sektor !== 'Bayan Kuaför') throw new PatronError(400, 'not_kuafor')
    await setKuaforPin(this.db, s, b.yon)
  }

  async sporPin(b: Record<string, unknown>) {
    const s = await this.shop(b.id)
    if (s.sektor !== 'Spor Salonu') throw new PatronError(400, 'not_spor')
    await setSporPin(this.db, s, b.yon)
  }

  /**
   * Güzellik salonunu kurar ya da PIN'lerini yeniler. Uygulamada şubesi yoksa
   * salon (işletme + "Merkez" şubesi + hizmet listesi) açılır; sahip ve
   * yönetici PIN'i ilk kurulumda zorunlu. Kuruluysa yalnızca yazılan PIN'ler
   * değişir (unutulunca). Sahip PIN'i yalnızca bu salona aittir.
   */
  async guzellikKur(b: Record<string, unknown>) {
    const s = await this.shop(b.id)
    if (s.sektor !== GUZELLIK) throw new PatronError(400, 'not_guzellik')
    await setupGuzellik(this.db, s, { sahip: b.sahip, yonetici: b.yonetici })
  }

  /** Güzellik salonunda PIN'siz paneli açar/kapatır */
  async acik(b: Record<string, unknown>) {
    const s = await this.shop(b.id)
    if (s.sektor !== GUZELLIK) throw new PatronError(400, 'not_guzellik')
    const next: Shop = { ...s }
    if (s.acik) delete next.acik
    else next.acik = true
    const stmts = [this.putShop(next)]
    // Kapatılınca PIN'siz açılmış oturumlar da kapanır
    if (s.acik) {
      const br = await this.db.prepare("SELECT id FROM rows WHERE kind = 'branch' AND ix = ? AND deleted = 0").bind(s.kod).first<{ id: string }>()
      if (br) stmts.push(this.db.prepare("DELETE FROM sessions WHERE role = 'open' AND branch_id = ?").bind(br.id))
    }
    await this.db.batch(stmts)
  }

  async pin(b: Record<string, unknown>) {
    const pin = b.pin
    if (typeof pin !== 'string' || !/^\d{4,8}$/.test(pin)) throw new PatronError(400, 'bad_pin')
    await this.db.batch([
      this.db.prepare("INSERT OR REPLACE INTO secrets (key, hash) VALUES ('platform', ?)").bind(await hashPin(pin)),
      // Diğer cihazlardaki sahip paneli oturumları kapanır
      this.db.prepare("DELETE FROM sessions WHERE role = 'platform' AND token != ?").bind(this.token()),
    ])
  }
}

// --- Halı yıkama ---
// Halıcının yönetici ve personel PIN'ini belirler (ilk kurulum ya da unutulunca).
// Halıcı kaydı yoksa varsayılan fiyatlarla açılır; PIN'ler birbirinden farklı olmalı.
export async function setHaliPins(db: D1Database, s: Shop, yon: unknown, per: unknown) {
  if (typeof yon !== 'string' || typeof per !== 'string' || !/^\d{4,8}$/.test(yon) || !/^\d{4,8}$/.test(per)) throw new PatronError(400, 'bad_pin')
  if (yon === per) throw new PatronError(400, 'same_pin')
  await db.batch([
    db.prepare('INSERT OR IGNORE INTO hali_shops (kod, data) VALUES (?, ?)').bind(s.kod, JSON.stringify({ ad: s.ad, wa: s.tel, adres: '' })),
    db.prepare('INSERT OR REPLACE INTO secrets (key, hash) VALUES (?, ?)').bind(`hali:yon:${s.kod}`, await hashPin(yon)),
    db.prepare('INSERT OR REPLACE INTO secrets (key, hash) VALUES (?, ?)').bind(`hali:per:${s.kod}`, await hashPin(per)),
    // Eski PIN'le açılmış oturumlar kapanır
    db.prepare("DELETE FROM sessions WHERE branch_id = ? AND role IN ('hali_yon', 'hali_per')").bind(s.kod),
  ])
}

// --- Berber (Berberim) ---
// Berberin yönetici PIN'ini belirler (ilk kurulum ya da unutulunca). Personel PIN'lerini
// yönetici uygulamadan verir. Yönetici PIN'i hiçbir personelin PIN'iyle aynı olamaz.
export async function setBerberPin(db: D1Database, s: Shop, yon: unknown) {
  if (typeof yon !== 'string' || !/^\d{4,8}$/.test(yon)) throw new PatronError(400, 'bad_pin')
  const { results } = await db.prepare('SELECT hash FROM secrets WHERE key LIKE ?').bind(`berber:per:${s.kod}:%`).all<{ hash: string }>()
  for (const r of results) if (await checkPin(yon, r.hash)) throw new PatronError(400, 'same_pin')
  await db.batch([
    db.prepare('INSERT OR IGNORE INTO berber_shops (kod, isl, data) VALUES (?, ?, ?)').bind(s.kod, s.kod, JSON.stringify({ ad: s.ad, wa: s.tel, adres: '' })),
    db.prepare('INSERT OR REPLACE INTO secrets (key, hash) VALUES (?, ?)').bind(`berber:yon:${s.kod}`, await hashPin(yon)),
    // Eski PIN'le açılmış yönetici ve işletme oturumları kapanır
    db.prepare("DELETE FROM sessions WHERE branch_id = ? AND role IN ('berber_yon', 'berber_isl')").bind(s.kod),
  ])
}

// --- Bayan kuaför (Kuaförüm) ---
// Kuaförün yönetici PIN'ini belirler (ilk kurulum ya da unutulunca). Personel PIN'lerini
// yönetici uygulamadan verir. Yönetici PIN'i hiçbir personelin PIN'iyle aynı olamaz.
export async function setKuaforPin(db: D1Database, s: Shop, yon: unknown) {
  if (typeof yon !== 'string' || !/^\d{4,8}$/.test(yon)) throw new PatronError(400, 'bad_pin')
  const { results } = await db.prepare('SELECT hash FROM secrets WHERE key LIKE ?').bind(`kuafor:per:${s.kod}:%`).all<{ hash: string }>()
  for (const r of results) if (await checkPin(yon, r.hash)) throw new PatronError(400, 'same_pin')
  await db.batch([
    db.prepare('INSERT OR IGNORE INTO kuafor_shops (kod, isl, data) VALUES (?, ?, ?)').bind(s.kod, s.kod, JSON.stringify({ ad: s.ad, wa: s.tel, adres: '' })),
    db.prepare('INSERT OR REPLACE INTO secrets (key, hash) VALUES (?, ?)').bind(`kuafor:yon:${s.kod}`, await hashPin(yon)),
    // Eski PIN'le açılmış yönetici ve işletme oturumları kapanır
    db.prepare("DELETE FROM sessions WHERE branch_id = ? AND role IN ('kuafor_yon', 'kuafor_isl')").bind(s.kod),
  ])
}

// --- Spor salonu (Sporum) ---
// Salonun yönetici PIN'ini belirler (ilk kurulum ya da unutulunca). Antrenör PIN'lerini
// yönetici uygulamadan verir. Yönetici PIN'i hiçbir antrenörün PIN'iyle aynı olamaz.
export async function setSporPin(db: D1Database, s: Shop, yon: unknown) {
  if (typeof yon !== 'string' || !/^\d{4,8}$/.test(yon)) throw new PatronError(400, 'bad_pin')
  const { results } = await db.prepare('SELECT hash FROM secrets WHERE key LIKE ?').bind(`spor:per:${s.kod}:%`).all<{ hash: string }>()
  for (const r of results) if (await checkPin(yon, r.hash)) throw new PatronError(400, 'same_pin')
  await db.batch([
    db.prepare('INSERT OR IGNORE INTO spor_shops (kod, isl, data) VALUES (?, ?, ?)').bind(s.kod, s.kod, JSON.stringify({ ad: s.ad, wa: s.tel, adres: '' })),
    db.prepare('INSERT OR REPLACE INTO secrets (key, hash) VALUES (?, ?)').bind(`spor:yon:${s.kod}`, await hashPin(yon)),
    // Eski PIN'le açılmış yönetici ve işletme oturumları kapanır
    db.prepare("DELETE FROM sessions WHERE branch_id = ? AND role IN ('spor_yon', 'spor_isl')").bind(s.kod),
  ])
}

// --- Güzellik salonu ---
// Çok dükkânlı: her güzellik salonu kendi işletme kaydı (rows.biz), kendi kodu
// (şubesinin kısa adı = dükkân kodu) ve kendi sahip PIN'iyle (owner:<işletme>) çalışır.
export async function setupGuzellik(db: D1Database, s: Shop, pins: { sahip?: unknown; yonetici?: unknown }) {
  const ok = (v: unknown): v is string => typeof v === 'string' && /^\d{4,8}$/.test(v)
  const sahip = pins.sahip === undefined || pins.sahip === '' ? undefined : pins.sahip
  const yon = pins.yonetici === undefined || pins.yonetici === '' ? undefined : pins.yonetici
  if ((sahip !== undefined && !ok(sahip)) || (yon !== undefined && !ok(yon))) throw new PatronError(400, 'bad_pin')
  const br = await db
    .prepare("SELECT id, biz FROM rows WHERE kind = 'branch' AND ix = ? AND deleted = 0")
    .bind(s.kod)
    .first<{ id: string; biz: string }>()
  const stmts: D1PreparedStatement[] = []
  let biz: string
  let branchId: string
  if (br) {
    if (!br.biz) throw new PatronError(409, 'not_migrated')
    if (sahip === undefined && yon === undefined) throw new PatronError(400, 'bad_pin')
    biz = br.biz
    branchId = br.id
  } else {
    if (sahip === undefined || yon === undefined) throw new PatronError(400, 'bad_pin')
    const created = newSalonRows(s)
    biz = created.biz
    branchId = created.branchId
    stmts.push(db.prepare("UPDATE meta SET v = v + 1 WHERE k = 'seq'"))
    for (const r of created.rows)
      stmts.push(
        db
          .prepare(
            `INSERT INTO rows (kind, id, branch_id, ix, data, seq, deleted, biz)
             VALUES (?, ?, ?, ?, ?, (SELECT v FROM meta WHERE k = 'seq'), 0, ?)`,
          )
          .bind(r.kind, r.id, r.branchId, r.ix, JSON.stringify(r.data), biz),
      )
  }
  // PIN'ler personel PIN'leriyle çakışamaz (personel o PIN'le sahip/yönetici olarak girebilirdi)
  if (br) {
    const { results: staff } = await db.prepare("SELECT id, branch_id FROM rows WHERE kind = 'staff' AND biz = ? AND deleted = 0").bind(biz).all<{ id: string; branch_id: string }>()
    const hashes = async (ids: string[]) =>
      ids.length ? (await db.prepare(`SELECT hash FROM secrets WHERE key IN (${ids.map(() => '?').join(',')})`).bind(...ids.map((i) => `staff:${i}`)).all<{ hash: string }>()).results : []
    if (sahip !== undefined) for (const h of await hashes(staff.map((x) => x.id))) if (await checkPin(sahip, h.hash)) throw new PatronError(400, 'same_pin')
    if (yon !== undefined) for (const h of await hashes(staff.filter((x) => x.branch_id === branchId).map((x) => x.id))) if (await checkPin(yon, h.hash)) throw new PatronError(400, 'same_pin')
  }
  if (sahip !== undefined) {
    stmts.push(db.prepare('INSERT OR REPLACE INTO secrets (key, hash) VALUES (?, ?)').bind(`owner:${biz}`, await hashPin(sahip)))
    // Eski PIN'le açılmış sahip oturumları kapanır
    stmts.push(db.prepare("DELETE FROM sessions WHERE role = 'owner' AND biz = ?").bind(biz))
  }
  if (yon !== undefined) {
    stmts.push(db.prepare('INSERT OR REPLACE INTO secrets (key, hash) VALUES (?, ?)').bind(`manager:${branchId}`, await hashPin(yon)))
    stmts.push(db.prepare("DELETE FROM sessions WHERE role = 'manager' AND branch_id = ?").bind(branchId))
  }
  await db.batch(stmts)
  return { biz, branchId }
}

function cleanPaketler(list: unknown[]): Paket[] {
  return list
    .slice(0, 20)
    .map((x) => x as Record<string, unknown>)
    .filter((x) => x && str(x.id, 20))
    .map((x) => ({ id: str(x.id, 20), ad: str(x.ad, 40) || str(x.id, 20), fiyat: Math.round(num(x.fiyat)), pers: Math.round(num(x.pers, 0, 1000)) }))
}

/** Sahip PIN'inin özeti (ilk kurulumda elle yazmak için) */
export { hashPin as patronPinHash }
