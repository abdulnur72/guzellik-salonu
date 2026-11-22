// Giriş: demo modunda PIN bu cihazdaki kayıtla karşılaştırılır; gerçek
// modda sunucu doğrular ve bir oturum anahtarı (token) verir.

import type { Branch, DemoDatabase, Id } from '../types'
import { getDb, mutate } from './demoStore'
import { staffPinSkipped } from '../demoShops'
import { isDemo } from './mode'
import { api, ApiError } from './remote'
import { t } from '../../i18n'

export type PinError = 'wrong_pin' | 'too_many' | 'bad_pin' | 'pin_taken' | 'network' | 'locked'
export type LoginResult = { ok: true; token?: string } | { ok: false; reason: PinError }

const validPin = (pin: string) => /^\d{4,8}$/.test(pin)

function failure(e: unknown): { ok: false; reason: PinError } {
  const code = e instanceof ApiError ? e.code : 'network'
  if (e instanceof ApiError && e.status === 402) return { ok: false, reason: 'locked' }
  if (code === 'too_many' || code === 'bad_pin' || code === 'wrong_pin' || code === 'pin_taken') return { ok: false, reason: code }
  return { ok: false, reason: e instanceof ApiError && e.status === 403 ? 'wrong_pin' : 'network' }
}

async function server(body: unknown): Promise<LoginResult> {
  try {
    const r = await api<{ token: string }>('/api/login', { body })
    return { ok: true, token: r.token }
  } catch (e) {
    return failure(e)
  }
}

/**
 * Demo modu: personel PIN'i şubenin yönetici PIN'iyle ya da sahip PIN'iyle
 * aynı olamaz (gerçek modda sunucu denetler).
 */
export function staffPinClashes(db: DemoDatabase, branchId: Id, pin: string) {
  const br = db.branches.find((b) => b.branch.id === branchId)?.branch
  return pin === db.business.ownerPin || pin === br?.managerPin
}

/** Demo modu: yeni yönetici PIN'i şubedeki bir personelin PIN'iyle aynı mı */
export function managerPinClashes(db: DemoDatabase, branchId: Id, pin: string) {
  return !!db.branches.find((b) => b.branch.id === branchId)?.staff.some((s) => s.active && s.pin === pin)
}

/** Demo modu: yeni sahip PIN'i herhangi bir personelin PIN'iyle aynı mı */
export function ownerPinClashes(db: DemoDatabase, pin: string) {
  return db.branches.some((b) => b.staff.some((s) => s.active && s.pin === pin))
}

/** Sahip girişi: kod = salonun kodu (şubelerinden birinin kısa adı); her salonun kendi sahip PIN'i */
export async function loginOwner(pin: string, kod?: string): Promise<LoginResult> {
  if (!isDemo) return server({ scope: 'owner', slug: kod, pin })
  return pin === getDb().business.ownerPin ? { ok: true } : { ok: false, reason: 'wrong_pin' }
}

export async function loginManager(branch: Branch, pin: string): Promise<LoginResult> {
  if (!isDemo) return server({ scope: 'branch', slug: branch.slug, as: 'manager', pin })
  return pin === branch.managerPin ? { ok: true } : { ok: false, reason: 'wrong_pin' }
}

/**
 * PIN'siz panel: sahip panelinde "PIN'siz panel" açılmış salonda şube linki
 * girişsiz (resepsiyon yetkisiyle) açılır. Açık değilse null.
 */
export async function openPanel(slug: string): Promise<string | null> {
  if (isDemo) return null
  try {
    return (await api<{ token: string }>('/api/open', { body: { slug } })).token
  } catch {
    return null
  }
}

/** PIN'i olmayan personelin ilk girişinde verilen PIN kaydedilir */
export async function loginStaff(branch: Branch, staffId: Id, pin: string): Promise<LoginResult> {
  // Demo dükkânda personel PIN'siz girer (sunucu da PIN'e bakmaz)
  if (!isDemo && staffPinSkipped(branch.slug)) return server({ scope: 'branch', slug: branch.slug, as: 'staff', staffId })
  if (!validPin(pin)) return { ok: false, reason: 'bad_pin' }
  if (!isDemo) return server({ scope: 'branch', slug: branch.slug, as: 'staff', staffId, pin })
  const s = getDb().branches.find((b) => b.branch.id === branch.id)?.staff.find((x) => x.id === staffId)
  if (!s) return { ok: false, reason: 'wrong_pin' }
  if (!s.pin) {
    if (staffPinClashes(getDb(), branch.id, pin)) return { ok: false, reason: 'pin_taken' }
    mutate((db) => {
      const x = db.branches.find((b) => b.branch.id === branch.id)?.staff.find((y) => y.id === staffId)
      if (x) x.pin = pin
    })
    return { ok: true }
  }
  return pin === s.pin ? { ok: true } : { ok: false, reason: 'wrong_pin' }
}

/** Girişli personel kendi PIN'ini değiştirir (eski PIN doğrulanır) */
export async function changeStaffPin(
  branch: Branch,
  staffId: Id,
  token: string | undefined,
  current: string,
  next: string,
): Promise<{ ok: true } | { ok: false; reason: PinError }> {
  if (!validPin(next)) return { ok: false, reason: 'bad_pin' }
  if (!isDemo) {
    try {
      await api('/api/pin', { body: { current, next }, token })
      return { ok: true }
    } catch (e) {
      return failure(e)
    }
  }
  const db = getDb()
  const s = db.branches.find((b) => b.branch.id === branch.id)?.staff.find((x) => x.id === staffId)
  if (!s || !s.pin || s.pin !== current) return { ok: false, reason: 'wrong_pin' }
  if (staffPinClashes(db, branch.id, next)) return { ok: false, reason: 'pin_taken' }
  mutate((d) => {
    const x = d.branches.find((b) => b.branch.id === branch.id)?.staff.find((y) => y.id === staffId)
    if (x) x.pin = next
  })
  return { ok: true }
}

export function logout(token: string | undefined) {
  if (!isDemo && token) void api('/api/logout', { body: {}, token }).catch(() => undefined)
}

/** Giriş hatasının ekranda gösterilecek yazısı */
export function loginError(reason: PinError) {
  return reason === 'locked'
    ? t('lock.title')
    : reason === 'too_many'
    ? t('common.tooMany')
    : reason === 'network'
      ? t('common.network')
      : reason === 'bad_pin'
        ? t('staff.pinTooShort')
        : reason === 'pin_taken'
          ? t('staff.pinTaken')
          : t('common.wrongPin')
}
