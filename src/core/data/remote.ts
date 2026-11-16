// Sunucu bağlantısı (demo modu dışında). Ekranlar yine demoStore üzerinden
// çalışır; burası kayıtları sunucudan çeker, yerel değişiklikleri satır farkı
// olarak gönderir ve açık paneli birkaç saniyede bir günceller.

import { useEffect, useState } from 'react'
import type { Appointment, DemoDatabase, Id } from '../types'
import { isDemo } from './mode'
import { diffRows, fromRows, rowKey, toRows, type Row } from './rows'

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code)
  }
}

export async function api<T = unknown>(path: string, opts: { body?: unknown; token?: string | null } = {}): Promise<T> {
  let res: Response
  try {
    res = await fetch(path, {
      method: opts.body === undefined ? 'GET' : 'POST',
      headers: {
        ...(opts.body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}),
      },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      cache: 'no-store',
    })
  } catch {
    throw new ApiError(0, 'network')
  }
  const data = (await res.json().catch(() => ({}))) as { error?: string }
  if (!res.ok) throw new ApiError(res.status, data.error || 'server')
  return data as T
}

// --- Yerel kayıt ile bağlantı (demoStore bunu kurar) ---

interface Host {
  get(): DemoDatabase
  set(db: DemoDatabase): void
}
let host: Host
export function attach(h: Host) {
  host = h
}

/** Sunucunun bildiği son hal (gönderilmiş değişiklikler dahil) */
let base = new Map<string, Row>()
let token: string | null = null
let cursor = 0
let localVersion = 0
let timer: ReturnType<typeof setTimeout> | undefined
let chain: Promise<unknown> = Promise.resolve()
const authLost = new Set<() => void>()
const errors = new Set<(code: string) => void>()

function serial<T>(fn: () => Promise<T>): Promise<T> {
  const p = chain.then(fn, fn)
  chain = p.catch(() => undefined)
  return p
}

function failed(e: unknown) {
  const code = e instanceof ApiError ? e.code : 'server'
  if (e instanceof ApiError && e.status === 401) {
    token = null
    authLost.forEach((f) => f())
  } else errors.forEach((f) => f(code))
}

/** Ekrandaki değişiklik: kısa bir bekleme sonrası sunucuya gönderilir (ard arda yazımlar birleşir) */
export function localChanged() {
  localVersion++
  if (!token) return
  clearTimeout(timer)
  timer = setTimeout(() => void serial(push), 300)
}

async function push() {
  clearTimeout(timer)
  timer = undefined
  if (!token) return
  const after = toRows(host.get())
  const changes = diffRows(base, after)
  if (!changes.length) return
  base = after
  try {
    await api('/api/write', { body: { rows: changes }, token })
  } catch (e) {
    failed(e)
    cursor = 0 // kaydedilemeyen değişiklik geri alınsın: her şeyi baştan çek
    await pullNow()
  }
}

async function pullNow() {
  if (!token) return
  await push()
  if (!token) return
  const startVersion = localVersion
  const before = base
  const r = await api<{ seq: number; full: boolean; rows: Row[] }>(`/api/sync?since=${cursor}`, { token })
  const next = r.full ? new Map<string, Row>() : new Map(base)
  for (const row of r.rows) {
    if (row.deleted) next.delete(rowKey(row.kind, row.id))
    else next.set(rowKey(row.kind, row.id), row)
  }
  cursor = r.seq
  if (!r.full && !r.rows.length && startVersion === localVersion) return
  // Çekme sürerken ekranda yapılan değişiklikler kaybolmasın
  const pending = startVersion === localVersion ? [] : diffRows(before, toRows(host.get()))
  base = next
  const shown = new Map(next)
  for (const p of pending) {
    if (p.deleted) shown.delete(rowKey(p.kind, p.id))
    else shown.set(rowKey(p.kind, p.id), p)
  }
  const db = fromRows(shown.values())
  if (db) host.set(db)
  if (pending.length) localChanged()
}

export function pull() {
  return serial(pullNow).catch(failed)
}

/** Girişli oturum: tüm kayıtları çeker ve açık kaldıkça günceller */
export async function connect(t: string) {
  if (token === t && cursor > 0) return
  // Ekrandaki (girişsiz) hal sunucuya gönderilmesin: önce eşit say, sonra tamamını çek
  clearTimeout(timer)
  timer = undefined
  token = t
  cursor = 0
  base = toRows(host.get())
  await serial(pullNow)
}

export function disconnect() {
  token = null
  cursor = 0
  base = new Map()
}

/** Girişsiz görünüm (randevu sayfası, giriş ekranları): şubenin herkese açık bilgisi */
export async function loadPublic(slug: string) {
  const r = await api<{ rows: Row[] }>(`/api/public/b/${encodeURIComponent(slug)}`)
  if (token) return
  base = new Map(r.rows.map((x) => [rowKey(x.kind, x.id), x]))
  const db = fromRows(base.values())
  if (db) host.set(db)
}

/** Randevu sayfası: seçilen gündeki dolu saatler */
export async function loadBusy(slug: string, branchId: Id, date: string) {
  const r = await api<{ appointments: Appointment[] }>(
    `/api/public/b/${encodeURIComponent(slug)}/busy?date=${encodeURIComponent(date)}`,
  )
  const db = structuredClone(host.get())
  const b = db.branches.find((x) => x.branch.id === branchId)
  if (!b) return
  b.appointments = [...b.appointments.filter((a) => a.date !== date), ...r.appointments]
  host.set(db)
}

export function onAuthLost(f: () => void) {
  authLost.add(f)
  return () => void authLost.delete(f)
}

export function onError(f: (code: string) => void) {
  errors.add(f)
  return () => void errors.delete(f)
}

const POLL_MS = 10_000

/**
 * Sayfanın veriyle bağlantısı. token varsa girişli tüm kayıtlar, yoksa
 * slug'ın herkese açık bilgisi yüklenir. Demo modunda hep hazırdır.
 */
export function useConnection(tok: string | null | undefined, slug?: string) {
  const [state, setState] = useState<'loading' | 'ready' | 'error' | 'missing'>(isDemo ? 'ready' : 'loading')
  useEffect(() => {
    if (isDemo) return
    let alive = true
    setState('loading')
    const go = tok ? connect(tok) : slug ? loadPublic(slug) : Promise.resolve()
    go.then(
      () => alive && setState('ready'),
      (e) => {
        if (!alive) return
        if (e instanceof ApiError && e.status === 401) failed(e)
        setState(e instanceof ApiError && e.status === 404 ? 'missing' : 'error')
      },
    )
    if (!tok) return () => void (alive = false)
    const tick = () => document.visibilityState === 'visible' && void pull()
    const id = setInterval(tick, POLL_MS)
    document.addEventListener('visibilitychange', tick)
    window.addEventListener('focus', tick)
    return () => {
      alive = false
      clearInterval(id)
      document.removeEventListener('visibilitychange', tick)
      window.removeEventListener('focus', tick)
    }
  }, [tok, slug])
  return state
}

export interface PublicIndex {
  business: DemoDatabase['business']
  branches: { id: Id; name: string; slug: string }[]
}

/** İşletme adı ve şube listesi (giriş sayfası için). Demo modunda yerel kayıttan. */
export function useIndex(): PublicIndex | 'loading' | 'error' {
  const [v, setV] = useState<PublicIndex | 'loading' | 'error'>(() =>
    isDemo
      ? { business: host.get().business, branches: host.get().branches.map(({ branch: b }) => ({ id: b.id, name: b.name, slug: b.slug })) }
      : 'loading',
  )
  useEffect(() => {
    if (isDemo) return
    let alive = true
    api<PublicIndex>('/api/public').then(
      (r) => alive && setV(r),
      () => alive && setV('error'),
    )
    return () => void (alive = false)
  }, [])
  return v
}
