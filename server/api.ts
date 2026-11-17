// Sunucu: Cloudflare Pages Functions üzerinde çalışır, kayıtları D1'de tutar.
//
// Yetki kuralları (satır seviyesinde):
// - Sahip: her şey.
// - Yönetici: yalnızca kendi şubesi; işletmenin yalnızca adını değiştirebilir.
// - Resepsiyon: randevu, müşteri, paket, stok. Giderleri görmez.
// - Uzman: yalnızca kendi randevuları; müşteri ve paket. Başkalarının
//   randevularında tutar ve ödeme bilgisi gönderilmez. Giderleri görmez.
// - Müşteri (giriş yok): şubenin herkese açık bilgisi, dolu saatler,
//   randevu talebi, kendi randevusunu görme ve iptal.
// PIN'ler istemciye hiç gönderilmez; tuzlanmış özetleri secrets tablosundadır.

import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types'
import { branchOf, KINDS, SECRET_MARK, type Kind, type Row } from '../src/core/data/rows'
import { daySlots, freeStaff, MIN_BLOCK_MIN } from '../src/core/scheduling'
import { addDays, businessToday, toMinutes, zonedParts } from '../src/core/time'
import type { Appointment, Branch, Business, Customer, Service, Staff } from '../src/core/types'
import { handlePatron, lockOfOwner, lockOfSlug, type LockInfo } from './patron'

export interface Env {
  DB: D1Database
}

type Role = 'owner' | 'manager' | 'expert' | 'reception'
interface Sess {
  token: string
  role: Role
  branchId: string | null
  staffId: string | null
}

type Data = Record<string, unknown>
interface DbRow {
  kind: Kind
  id: string
  branch_id: string
  data: string
  seq: number
  deleted: number
}

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
    public extra?: object,
  ) {
    super(message)
  }
}

/** Aboneliği biten ya da durdurulan dükkân: kayıtlar durur, uygulama kapalı */
const lockedError = (info: LockInfo) => new HttpError(402, 'subscription_ended', info)

/** Sahip paneli tabloları yoksa (eski yerel veritabanı) kilit yok sayılır */
async function safeLock(f: () => Promise<LockInfo | null>) {
  try {
    return await f()
  } catch (e) {
    if (String(e).includes('no such table')) return null
    throw e
  }
}

const SESSION_DAYS = 30
const MAX_PIN_FAILS = 8
const PIN_WINDOW_MS = 15 * 60_000
const MAX_BOOKINGS_PER_HOUR = 10
const BOOK_AHEAD_DAYS = 120

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })

export async function handle(req: Request, env: Env): Promise<Response> {
  try {
    const url = new URL(req.url)
    const p = url.pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean).map(decodeURIComponent)
    const api = new Api(env.DB, req)
    const m = req.method
    if (p[0] === 'patron') return handlePatron(req, env.DB, p.slice(1))
    if (m === 'GET' && p[0] === 'public' && p.length === 1) return json(await api.publicIndex())
    if (p[0] === 'public' && p[1] === 'b' && p[2]) {
      const slug = p[2]
      await api.checkSlugLock(slug)
      if (m === 'GET' && p.length === 3) return json(await api.publicBranch(slug))
      if (m === 'GET' && p[3] === 'busy') return json(await api.publicBusy(slug, url.searchParams.get('date') || ''))
      if (m === 'POST' && p[3] === 'book') return json(await api.book(slug, await body(req)))
      if (m === 'POST' && p[3] === 'mine') return json(await api.mine(slug, await body(req)))
      if (m === 'POST' && p[3] === 'cancel') return json(await api.cancel(slug, await body(req)))
    }
    if (m === 'POST' && p[0] === 'login') return json(await api.login(await body(req)))
    if (m === 'POST' && p[0] === 'logout') return json(await api.logout())
    if (m === 'POST' && p[0] === 'pin') return json(await api.changeOwnPin(await body(req)))
    if (m === 'GET' && p[0] === 'sync') return json(await api.sync(Number(url.searchParams.get('since') || 0)))
    if (m === 'POST' && p[0] === 'write') return json(await api.write(await body(req)))
    return json({ error: 'not_found' }, 404)
  } catch (e) {
    if (e instanceof HttpError) return json({ ...e.extra, error: e.message }, e.status)
    console.error(e)
    return json({ error: 'server' }, 500)
  }
}

async function body(req: Request): Promise<Record<string, unknown>> {
  const len = Number(req.headers.get('content-length') || 0)
  if (len > 2_000_000) throw new HttpError(413, 'too_large')
  try {
    const v = await req.json()
    if (v && typeof v === 'object') return v as Record<string, unknown>
  } catch {
    /* aşağıda */
  }
  throw new HttpError(400, 'bad_json')
}

// --- Yardımcılar ---

const enc = new TextEncoder()
const hex = (buf: ArrayBuffer | Uint8Array) =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')

export function randomToken(bytes = 24) {
  const a = new Uint8Array(bytes)
  crypto.getRandomValues(a)
  return hex(a)
}

export async function hashPin(pin: string, salt = randomToken(8)) {
  const d = await crypto.subtle.digest('SHA-256', enc.encode(`${salt}:${pin}`))
  return `${salt}$${hex(d)}`
}

async function checkPin(pin: string, stored: string) {
  const salt = stored.split('$')[0]
  return (await hashPin(pin, salt)) === stored
}

/** Bu PIN, verilen anahtarlardaki (ya da önekle başlayan) özetlerden biriyle aynı mı? */
async function pinMatchesAny(db: D1Database, pin: string, q: { keys?: string[]; prefix?: string }) {
  const { results } = q.prefix
    ? await db.prepare('SELECT hash FROM secrets WHERE key LIKE ?').bind(q.prefix + '%').all<{ hash: string }>()
    : q.keys?.length
      ? await db.prepare(`SELECT hash FROM secrets WHERE key IN (${q.keys.map(() => '?').join(',')})`).bind(...q.keys).all<{ hash: string }>()
      : { results: [] as { hash: string }[] }
  for (const r of results) if (await checkPin(pin, r.hash)) return true
  return false
}

const validPin = (pin: unknown): pin is string => typeof pin === 'string' && /^\d{4,8}$/.test(pin)
const str = (v: unknown, max = 200) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const phoneKey = (phone: string) => phone.replace(/\D/g, '').slice(-10)

/** Satırın arama anahtarı */
export function ixOf(kind: Kind, data: Data): string | null {
  if (kind === 'branch') return String(data.slug ?? '')
  if (kind === 'appointment') return String(data.date ?? '')
  if (kind === 'customer') return phoneKey(String(data.phone ?? '')) || null
  return null
}

/** Gizli alanı olan satır türleri: alan adı ve secrets anahtarı */
const SECRET_FIELD: Partial<Record<Kind, [string, (id: string) => string]>> = {
  business: ['ownerPin', () => 'owner'],
  branch: ['managerPin', (id) => `manager:${id}`],
  staff: ['pin', (id) => `staff:${id}`],
}

const toRow = (r: DbRow): Row & { seq: number } => ({
  kind: r.kind,
  id: r.id,
  branchId: r.branch_id,
  data: r.deleted ? undefined : (JSON.parse(r.data) as Data),
  deleted: r.deleted ? true : undefined,
  seq: r.seq,
})

/** Herkese açık işletme bilgisi */
function publicBusiness(b: Data): Data {
  const { id, name, sector, country, currency, locale, timeZone } = b
  return { id, name, sector, country, currency, locale, timeZone, ownerName: '', ownerPin: '', feeFirst: 0, feeExtra: 0 }
}

function publicBranch(b: Data): Data {
  return { ...b, managerPin: '' }
}

function publicStaff(s: Data): Data {
  const { id, branchId, name, role, photo, active, pin } = s
  return { id, branchId, name, role, photo, active, pin, commissionPct: 0 }
}

class Api {
  private sess: Sess | null | undefined
  constructor(
    private db: D1Database,
    private req: Request,
  ) {}

  private ip() {
    return this.req.headers.get('cf-connecting-ip') || 'local'
  }

  // --- Okuma yardımcıları ---

  private async row(kind: Kind, id: string) {
    const r = await this.db.prepare('SELECT * FROM rows WHERE kind = ? AND id = ? AND deleted = 0').bind(kind, id).first<DbRow>()
    return r ? toRow(r) : null
  }

  private async business() {
    const r = await this.db.prepare("SELECT * FROM rows WHERE kind = 'business' AND deleted = 0 LIMIT 1").first<DbRow>()
    if (!r) throw new HttpError(503, 'not_set_up')
    return toRow(r)
  }

  private async branchBySlug(slug: string) {
    const r = await this.db
      .prepare("SELECT * FROM rows WHERE kind = 'branch' AND ix = ? AND deleted = 0 LIMIT 1")
      .bind(slug)
      .first<DbRow>()
    if (!r) throw new HttpError(404, 'branch_not_found')
    return toRow(r)
  }

  private async list(branchId: string, kind: Kind, ix?: string) {
    const q = ix === undefined
      ? this.db.prepare('SELECT * FROM rows WHERE branch_id = ? AND kind = ? AND deleted = 0 ORDER BY rowid').bind(branchId, kind)
      : this.db.prepare('SELECT * FROM rows WHERE branch_id = ? AND kind = ? AND ix = ? AND deleted = 0 ORDER BY rowid').bind(branchId, kind, ix)
    const { results } = await q.all<DbRow>()
    return results.map(toRow)
  }

  // --- Yazma yardımcıları ---

  private bump() {
    return this.db.prepare("UPDATE meta SET v = v + 1 WHERE k = 'seq'")
  }

  private put(kind: Kind, id: string, branchId: string, data: Data | null) {
    return this.db
      .prepare(
        `INSERT INTO rows (kind, id, branch_id, ix, data, seq, deleted)
         VALUES (?1, ?2, ?3, ?4, ?5, (SELECT v FROM meta WHERE k = 'seq'), ?6)
         ON CONFLICT (kind, id) DO UPDATE SET branch_id = excluded.branch_id, ix = excluded.ix,
           data = excluded.data, seq = excluded.seq, deleted = excluded.deleted`,
      )
      .bind(kind, id, branchId, data ? ixOf(kind, data) : null, data ? JSON.stringify(data) : '{}', data ? 0 : 1)
  }

  // --- Sınırlama ---

  private async limited(key: string, max: number, windowMs: number) {
    const since = Date.now() - windowMs
    const r = await this.db.prepare('SELECT COUNT(*) AS n FROM attempts WHERE key = ? AND ts > ?').bind(key, since).first<{ n: number }>()
    return (r?.n ?? 0) >= max
  }

  private note(key: string) {
    return this.db.prepare('INSERT INTO attempts (key, ts) VALUES (?, ?)').bind(key, Date.now()).run()
  }

  // --- PIN çakışması ---
  // Personel PIN'i şubesinin yönetici PIN'iyle ya da sahip PIN'iyle aynı olamaz;
  // aksi halde o personel yönetici/sahip olarak da girebilirdi. Ret cevabı
  // diğer PIN hakkında ipucu verdiği için her ret, yanlış PIN denemesi gibi
  // sayılır ve aynı sınıra tabidir.

  private async staffPinClashes(branchId: string, pin: string) {
    return pinMatchesAny(this.db, pin, { keys: [`manager:${branchId}`, 'owner'] })
  }

  private async managerPinClashes(branchId: string, pin: string) {
    const staff = await this.list(branchId, 'staff')
    return pinMatchesAny(this.db, pin, { keys: staff.map((s) => `staff:${s.id}`) })
  }

  private async ownerPinClashes(pin: string) {
    return pinMatchesAny(this.db, pin, { prefix: 'staff:' })
  }

  /** Çakışan PIN'i reddeder; ret yanlış deneme sayılır */
  private async rejectClash(limitKeys: string[]): Promise<never> {
    for (const k of limitKeys) await this.note(k)
    throw new HttpError(409, 'pin_taken')
  }

  private async checkLimit(limitKeys: [string, string]) {
    if ((await this.limited(limitKeys[0], MAX_PIN_FAILS, PIN_WINDOW_MS)) || (await this.limited(limitKeys[1], MAX_PIN_FAILS * 6, PIN_WINDOW_MS)))
      throw new HttpError(429, 'too_many')
  }

  // --- Abonelik kilidi ---

  async checkSlugLock(slug: string) {
    const l = await safeLock(() => lockOfSlug(this.db, slug))
    if (l) throw lockedError(l)
  }

  private async checkSessionLock(role: Role | 'owner', branchId: string | null) {
    let l: LockInfo | null
    if (role === 'owner') {
      const { results } = await this.db.prepare("SELECT ix FROM rows WHERE kind = 'branch' AND deleted = 0").all<{ ix: string }>()
      l = await safeLock(() => lockOfOwner(this.db, results.map((r) => r.ix)))
    } else {
      const br = branchId ? await this.row('branch', branchId) : null
      l = br ? await safeLock(() => lockOfSlug(this.db, String(br.data!.slug))) : null
    }
    if (l) throw lockedError(l)
  }

  // --- Oturum ---

  private async session(): Promise<Sess> {
    if (this.sess !== undefined) {
      if (!this.sess) throw new HttpError(401, 'login')
      return this.sess
    }
    this.sess = null
    const token = (this.req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
    if (!token) throw new HttpError(401, 'login')
    const s = await this.db
      .prepare('SELECT * FROM sessions WHERE token = ? AND expires > ?')
      .bind(token, Date.now())
      .first<{ role: string; branch_id: string | null; staff_id: string | null }>()
    if (!s || s.role === 'platform') throw new HttpError(401, 'login')
    let role = s.role as Role
    if (s.role === 'staff') {
      // Rol ve aktiflik her istekte personel kaydından okunur
      const st = await this.row('staff', s.staff_id!)
      const d = st?.data as Partial<Staff> | undefined
      if (!d?.active || d.branchId !== s.branch_id) throw new HttpError(401, 'login')
      role = d.role === 'reception' ? 'reception' : 'expert'
    }
    await this.checkSessionLock(role, s.branch_id)
    this.sess = { token, role, branchId: s.branch_id, staffId: s.staff_id }
    return this.sess
  }

  async login(b: Record<string, unknown>) {
    const pin = b.pin
    const now = Date.now()
    let key: string
    let sess: Omit<Sess, 'token'>
    let secretKey: string
    let firstPin: { staff: Row } | null = null

    if (b.scope === 'owner') {
      const biz = await this.business()
      key = 'owner'
      secretKey = 'owner'
      sess = { role: 'owner', branchId: null, staffId: null }
      void biz
      await this.checkSessionLock('owner', null)
    } else {
      const br = await this.branchBySlug(str(b.slug, 80))
      await this.checkSlugLock(String(br.data!.slug))
      if (b.as === 'manager') {
        key = `manager:${br.id}`
        secretKey = key
        sess = { role: 'manager', branchId: br.id, staffId: null }
      } else {
        const st = await this.row('staff', str(b.staffId, 64))
        const d = st?.data as Partial<Staff> | undefined
        if (!st || !d?.active || d.branchId !== br.id) throw new HttpError(404, 'staff_not_found')
        key = `staff:${st.id}`
        secretKey = key
        sess = { role: d.role === 'reception' ? 'reception' : 'expert', branchId: br.id, staffId: st.id }
        if (!d.pin) firstPin = { staff: st }
      }
    }

    const limitKey = `pin:${key}:${this.ip()}`
    await this.checkLimit([limitKey, `pin:${key}`])
    if (!validPin(pin)) throw new HttpError(400, 'bad_pin')

    const stmts: D1PreparedStatement[] = []
    if (firstPin) {
      // Personelin ilk girişi: PIN'i kendisi belirler (yönetici/sahip PIN'iyle aynı olamaz)
      if (await this.staffPinClashes(firstPin.staff.branchId, pin)) await this.rejectClash([limitKey, `pin:${key}`])
      stmts.push(this.db.prepare('INSERT OR REPLACE INTO secrets (key, hash) VALUES (?, ?)').bind(secretKey, await hashPin(pin)))
      stmts.push(this.bump(), this.put('staff', firstPin.staff.id, firstPin.staff.branchId, { ...firstPin.staff.data, pin: SECRET_MARK }))
    } else {
      const s = await this.db.prepare('SELECT hash FROM secrets WHERE key = ?').bind(secretKey).first<{ hash: string }>()
      if (!s || !(await checkPin(pin, s.hash))) {
        await this.note(limitKey)
        await this.note(`pin:${key}`)
        throw new HttpError(403, 'wrong_pin')
      }
    }
    const token = randomToken()
    stmts.push(
      this.db
        .prepare('INSERT INTO sessions (token, role, branch_id, staff_id, expires) VALUES (?, ?, ?, ?, ?)')
        .bind(token, sess.staffId ? 'staff' : sess.role, sess.branchId, sess.staffId, now + SESSION_DAYS * 86_400_000),
      this.db.prepare('DELETE FROM sessions WHERE expires < ?').bind(now),
      this.db.prepare('DELETE FROM attempts WHERE ts < ?').bind(now - 86_400_000),
    )
    await this.db.batch(stmts)
    return { token, ...sess }
  }

  /** Girişli personel kendi PIN'ini değiştirir: önce eski PIN'i doğrular */
  async changeOwnPin(b: Record<string, unknown>) {
    const s = await this.session()
    if (!s.staffId || !s.branchId) throw new HttpError(403, 'forbidden')
    const key = `staff:${s.staffId}`
    const limitKey = `pin:${key}:${this.ip()}`
    await this.checkLimit([limitKey, `pin:${key}`])
    const { current, next } = b
    if (!validPin(next)) throw new HttpError(400, 'bad_pin')
    const old = await this.db.prepare('SELECT hash FROM secrets WHERE key = ?').bind(key).first<{ hash: string }>()
    if (!old || typeof current !== 'string' || !(await checkPin(current, old.hash))) {
      await this.note(limitKey)
      await this.note(`pin:${key}`)
      throw new HttpError(403, 'wrong_pin')
    }
    if (await this.staffPinClashes(s.branchId, next)) await this.rejectClash([limitKey, `pin:${key}`])
    await this.db.batch([
      this.db.prepare('INSERT OR REPLACE INTO secrets (key, hash) VALUES (?, ?)').bind(key, await hashPin(next)),
      // Diğer cihazlardaki oturumları kapanır, bu cihaz açık kalır
      this.db.prepare('DELETE FROM sessions WHERE staff_id = ? AND token != ?').bind(s.staffId, s.token),
    ])
    return { ok: true }
  }

  async logout() {
    const token = (this.req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
    if (token) await this.db.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run()
    return { ok: true }
  }

  // --- Panel: okuma ---

  /** Oturumun görebileceği hali (görmemesi gerekiyorsa null) */
  private visible(s: Sess, r: Row): Row | null {
    if (r.deleted || !r.data) return r
    if (s.role === 'owner' || s.role === 'manager') return r
    if (r.kind === 'expense') return null
    if (r.kind === 'staff') return { ...r, data: { ...r.data, commissionPct: r.data.id === s.staffId ? r.data.commissionPct : 0 } }
    if (s.role === 'expert' && r.kind === 'appointment' && r.data.staffId !== s.staffId) {
      const { price: _p, payment: _m, ...rest } = r.data
      return { ...r, data: { ...rest, price: 0 } }
    }
    return r
  }

  async sync(since: number) {
    const s = await this.session()
    const cur = await this.db.prepare("SELECT v FROM meta WHERE k = 'seq'").first<{ v: number }>()
    const full = !(since > 0)
    const cond = full ? 'deleted = 0' : 'seq > ?'
    const q =
      s.role === 'owner'
        ? this.db.prepare(`SELECT * FROM rows WHERE ${cond} ORDER BY rowid`)
        : this.db.prepare(`SELECT * FROM rows WHERE branch_id IN ('', ?) AND ${cond} ORDER BY rowid`)
    const binds: unknown[] = s.role === 'owner' ? [] : [s.branchId]
    if (!full) binds.push(since)
    const { results } = await q.bind(...binds).all<DbRow>()
    const rows: Row[] = []
    for (const r of results) {
      const v = this.visible(s, toRow(r))
      if (v) rows.push({ kind: v.kind, id: v.id, branchId: v.branchId, data: v.data, deleted: v.deleted })
    }
    return { seq: cur?.v ?? 0, full, role: s.role, branchId: s.branchId, staffId: s.staffId, rows }
  }

  // --- Panel: yazma ---

  private allowed(s: Sess, kind: Kind, oldBranch: string | null, newBranch: string | null, oldData?: Data, newData?: Data) {
    if (s.role === 'owner') return true
    if (kind === 'business') return s.role === 'manager' && oldData !== undefined && newData !== undefined
    // Şube dışı satıra dokunamaz
    for (const b of [oldBranch, newBranch]) if (b !== null && b !== s.branchId) return false
    if (kind === 'branch') return s.role === 'manager' && oldData !== undefined && newData !== undefined
    if (s.role === 'manager') return true
    if (s.role === 'reception') return ['appointment', 'customer', 'package', 'stock'].includes(kind)
    // Uzman
    if (kind === 'appointment')
      return (!oldData || oldData.staffId === s.staffId) && (!newData || newData.staffId === s.staffId)
    return kind === 'customer' || kind === 'package'
  }

  async write(b: Record<string, unknown>) {
    const s = await this.session()
    const incoming = Array.isArray(b.rows) ? (b.rows as Row[]) : []
    if (!incoming.length) return { ok: true }
    if (incoming.length > 1000) throw new HttpError(413, 'too_many_rows')

    // Var olan satırları tek seferde oku
    const existing = await this.db.batch(
      incoming.map((r) => this.db.prepare('SELECT * FROM rows WHERE kind = ? AND id = ?').bind(String(r.kind), String(r.id))),
    )
    const biz = await this.business()
    const stmts: D1PreparedStatement[] = [this.bump()]

    for (let i = 0; i < incoming.length; i++) {
      const r = incoming[i]
      if (!KINDS.includes(r.kind) || typeof r.id !== 'string' || !r.id || r.id.length > 64) throw new HttpError(400, 'bad_row')
      const oldDb = (existing[i].results as DbRow[])[0]
      const old = oldDb && !oldDb.deleted ? toRow(oldDb) : null
      const oldData = old?.data

      if (r.deleted) {
        if (!old) continue
        if (r.kind === 'business' || r.kind === 'branch') throw new HttpError(403, 'forbidden')
        if (!this.allowed(s, r.kind, old.branchId, null, oldData, undefined)) throw new HttpError(403, 'forbidden')
        stmts.push(this.put(r.kind, r.id, old.branchId, null))
        continue
      }

      let data = { ...(r.data ?? {}) } as Data
      if (data.id !== r.id) throw new HttpError(400, 'bad_row')
      if (r.kind === 'business' && data.id !== biz.id) throw new HttpError(403, 'forbidden')
      if (r.kind === 'business' && s.role !== 'owner') data = { ...oldData, name: str(data.name, 120) || oldData?.name }
      if (r.kind === 'branch') {
        if (old) data.slug = oldData!.slug
        else {
          if (data.businessId !== biz.id || typeof data.slug !== 'string' || !/^[a-z0-9-]{1,60}$/.test(data.slug))
            throw new HttpError(400, 'bad_branch')
          const dup = await this.db.prepare("SELECT 1 FROM rows WHERE kind = 'branch' AND ix = ?").bind(data.slug).first()
          if (dup) throw new HttpError(409, 'slug_taken')
        }
      }
      // Uzman başkasının randevusunda tutarı göremediği için tutarı korunur
      if (s.role === 'expert' && r.kind === 'appointment' && oldData && oldData.staffId !== s.staffId) data.price = oldData.price

      const branchId = branchOf(r.kind, data)
      if (old && old.branchId !== branchId && r.kind !== 'business') throw new HttpError(400, 'branch_change')
      if (!this.allowed(s, r.kind, old ? old.branchId : null, branchId, oldData, data)) throw new HttpError(403, 'forbidden')

      // PIN alanları
      const sec = SECRET_FIELD[r.kind]
      if (sec) {
        const [field, keyOf] = sec
        const v = data[field]
        const key = keyOf(r.id)
        const canSet =
          s.role === 'owner' || (s.role === 'manager' && r.kind !== 'business')
        if (v === undefined || v === SECRET_MARK || v === null) {
          if (oldData?.[field]) data[field] = SECRET_MARK
          else delete data[field]
        } else if (v === '') {
          // Yönetici ve sahip PIN'i silinemez (giriş imkânsız olur), yalnızca değiştirilir
          if (r.kind !== 'staff') throw new HttpError(400, 'bad_pin')
          if (oldData?.[field] && !canSet) throw new HttpError(403, 'forbidden')
          stmts.push(this.db.prepare('DELETE FROM secrets WHERE key = ?').bind(key))
          delete data[field]
          // Sıfırlanan personelin açık oturumları kapanır; bir sonraki girişte yeni PIN belirler
          stmts.push(this.db.prepare('DELETE FROM sessions WHERE staff_id = ?').bind(r.id))
        } else {
          if (!canSet) throw new HttpError(403, 'forbidden')
          if (!validPin(v)) throw new HttpError(400, 'bad_pin')
          // Personel PIN'i ile yönetici/sahip PIN'i aynı olamaz (iki yönde de)
          const limitKeys: [string, string] = [`pinset:${key}:${this.ip()}`, `pinset:${key}`]
          await this.checkLimit(limitKeys)
          const clash =
            r.kind === 'staff'
              ? await this.staffPinClashes(branchId, v as string)
              : r.kind === 'branch'
                ? await this.managerPinClashes(r.id, v as string)
                : await this.ownerPinClashes(v as string)
          if (clash) await this.rejectClash(limitKeys)
          stmts.push(this.db.prepare('INSERT OR REPLACE INTO secrets (key, hash) VALUES (?, ?)').bind(key, await hashPin(v)))
          data[field] = SECRET_MARK
          // PIN değişince o kişinin diğer oturumları kapanır
          if (r.kind === 'staff') stmts.push(this.db.prepare('DELETE FROM sessions WHERE staff_id = ?').bind(r.id))
        }
      }
      stmts.push(this.put(r.kind, r.id, branchId, data))
    }
    if (stmts.length > 1) await this.db.batch(stmts)
    return { ok: true }
  }

  // --- Herkese açık (müşteri) ---

  async publicIndex() {
    const biz = await this.business()
    const { results } = await this.db.prepare("SELECT * FROM rows WHERE kind = 'branch' AND deleted = 0 ORDER BY rowid").all<DbRow>()
    return {
      business: publicBusiness(biz.data!),
      branches: results.map((r) => {
        const d = JSON.parse(r.data) as Branch
        return { id: d.id, name: d.name, slug: d.slug }
      }),
    }
  }

  async publicBranch(slug: string) {
    const biz = await this.business()
    const br = await this.branchBySlug(slug)
    const staff = await this.list(br.id, 'staff')
    const services = await this.list(br.id, 'service')
    const rows: Row[] = [
      { kind: 'business', id: biz.id, branchId: '', data: publicBusiness(biz.data!) },
      { kind: 'branch', id: br.id, branchId: br.id, data: publicBranch(br.data!) },
      ...staff.filter((s) => s.data!.active).map((s) => ({ kind: s.kind, id: s.id, branchId: s.branchId, data: publicStaff(s.data!) })),
      ...services.filter((s) => !s.data!.hiddenFromCustomers).map(({ kind, id, branchId, data }) => ({ kind, id, branchId, data })),
    ]
    return { rows }
  }

  private async clock(br: Branch) {
    const biz = (await this.business()).data as unknown as Business
    const now = new Date()
    return {
      today: businessToday(now, biz.timeZone, br.dayCutoffHour),
      nowMin: zonedParts(now, biz.timeZone).minutes,
    }
  }

  private async busyOf(branchId: string, date: string) {
    return (await this.list(branchId, 'appointment', date)).map((r) => r.data as unknown as Appointment)
  }

  async publicBusy(slug: string, date: string) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HttpError(400, 'bad_date')
    const br = await this.branchBySlug(slug)
    const appts = await this.busyOf(br.id, date)
    // Yalnızca dolu saat bilgisi: kim, ne zaman, ne kadar, hangi oda
    return {
      appointments: appts
        .filter((a) => !a.walkIn && a.status !== 'cancelled' && a.status !== 'no_show')
        .map((a, i) => ({
          id: `busy-${date}-${i}`,
          branchId: br.id,
          date: a.date,
          time: a.time,
          durationMin: a.durationMin,
          staffId: a.staffId,
          room: a.room,
          status: 'booked',
          price: 0,
          serviceIds: [],
          serviceNames: [],
          customerId: null,
        })),
    }
  }

  async book(slug: string, b: Record<string, unknown>) {
    const limitKey = `book:${this.ip()}`
    if (await this.limited(limitKey, MAX_BOOKINGS_PER_HOUR, 3_600_000)) throw new HttpError(429, 'too_many')
    const br = await this.branchBySlug(slug)
    const branch = br.data as unknown as Branch
    const name = str(b.name, 80)
    const phone = str(b.phone, 30)
    const note = str(b.note, 300)
    const date = str(b.date, 10)
    const time = str(b.time, 5)
    const wantStaff = b.staffId ? str(b.staffId, 64) : null
    const ids = Array.isArray(b.serviceIds) ? (b.serviceIds as unknown[]).map((x) => String(x)).slice(0, 20) : []
    if (!name || !/^(0?5\d{9}|905\d{9})$/.test(phone.replace(/\D/g, ''))) throw new HttpError(400, 'bad_contact')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time) || !ids.length) throw new HttpError(400, 'bad_request')

    const { today, nowMin } = await this.clock(branch)
    if (date < today || date > addDays(today, BOOK_AHEAD_DAYS)) return { ok: false, reason: 'slot_taken' }

    const staff = (await this.list(br.id, 'staff')).map((r) => r.data as unknown as Staff)
    const allServices = (await this.list(br.id, 'service')).map((r) => r.data as unknown as Service)
    const sel = ids.map((id) => allServices.find((s) => s.id === id && !s.hiddenFromCustomers))
    if (sel.some((s) => !s)) throw new HttpError(400, 'bad_service')
    const services = sel as Service[]
    if (wantStaff && !staff.some((s) => s.id === wantStaff && s.active && s.role === 'expert')) throw new HttpError(400, 'bad_staff')

    const durationMin = Math.max(MIN_BLOCK_MIN, services.reduce((a, s) => a + s.durationMin, 0))
    const appts = await this.busyOf(br.id, date)
    const slot = daySlots(
      { date, durationMin, staffId: wantStaff },
      { openMin: branch.openMin, closeMin: branch.closeMin, today, nowMin },
      staff,
      appts,
    ).find((x) => x.time === time)
    const free = slot?.available ? freeStaff({ date, durationMin, staffId: wantStaff, start: toMinutes(time) }, staff, appts) : []
    if (!free.length) return { ok: false, reason: 'slot_taken' }

    // Aynı telefonla kayıtlı müşteri varsa onu kullan (adını değiştirmeden)
    const pk = phoneKey(phone)
    const known = (await this.list(br.id, 'customer', pk))[0]
    const stmts: D1PreparedStatement[] = [this.bump()]
    let customerId: string
    if (known) customerId = known.id
    else {
      customerId = crypto.randomUUID()
      const c: Customer = { id: customerId, branchId: br.id, name, phone }
      stmts.push(this.put('customer', customerId, br.id, c as unknown as Data))
    }
    const id = crypto.randomUUID()
    const a: Appointment = {
      id,
      branchId: br.id,
      date,
      time,
      durationMin,
      price: services.reduce((t, s) => t + s.price, 0),
      serviceIds: services.map((s) => s.id),
      serviceNames: services.map((s) => s.name),
      staffId: free[0],
      customerId,
      status: 'pending_approval',
      online: true,
      ...(note ? { note } : {}),
      ...(known && str((known.data as Partial<Customer>).name, 80).toLocaleLowerCase('tr-TR') !== name.toLocaleLowerCase('tr-TR')
        ? { note: [note, `Online ad: ${name}`].filter(Boolean).join(' · ') }
        : {}),
    }
    const token = randomToken(16)
    stmts.push(
      this.put('appointment', id, br.id, a as unknown as Data),
      this.db.prepare('INSERT INTO booking_tokens (appt_id, token) VALUES (?, ?)').bind(id, token),
      this.db.prepare('INSERT INTO attempts (key, ts) VALUES (?, ?)').bind(limitKey, Date.now()),
    )
    await this.db.batch(stmts)
    return { ok: true, id, token }
  }

  private async owned(slug: string, items: unknown) {
    const br = await this.branchBySlug(slug)
    const list = Array.isArray(items) ? (items as { id?: unknown; token?: unknown }[]).slice(0, 50) : []
    const out: Appointment[] = []
    for (const it of list) {
      const id = str(it?.id, 64)
      const tok = await this.db.prepare('SELECT token FROM booking_tokens WHERE appt_id = ?').bind(id).first<{ token: string }>()
      if (!tok || tok.token !== it?.token) continue
      const r = await this.row('appointment', id)
      if (r && r.branchId === br.id) out.push(r.data as unknown as Appointment)
    }
    return out
  }

  async mine(slug: string, b: Record<string, unknown>) {
    const appts = await this.owned(slug, b.items)
    return {
      appointments: appts.map((a) => ({
        id: a.id,
        date: a.date,
        time: a.time,
        serviceNames: a.serviceNames,
        status: a.status,
      })),
    }
  }

  async cancel(slug: string, b: Record<string, unknown>) {
    const [a] = await this.owned(slug, [{ id: b.id, token: b.token }])
    if (!a || (a.status !== 'pending_approval' && a.status !== 'booked')) return { ok: false }
    await this.db.batch([
      this.bump(),
      this.put('appointment', a.id, a.branchId, { ...a, status: 'cancelled', cancelledByCustomer: true } as unknown as Data),
    ])
    return { ok: true }
  }
}
