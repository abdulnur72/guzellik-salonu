// Giriş: demo modunda PIN bu cihazdaki kayıtla karşılaştırılır; gerçek
// modda sunucu doğrular ve bir oturum anahtarı (token) verir.

import type { Branch, Id } from '../types'
import { getDb, mutate } from './demoStore'
import { isDemo } from './mode'
import { api, ApiError } from './remote'
import { t } from '../../i18n'

export type LoginResult = { ok: true; token?: string } | { ok: false; reason: 'wrong_pin' | 'too_many' | 'bad_pin' | 'network' }

async function server(body: unknown): Promise<LoginResult> {
  try {
    const r = await api<{ token: string }>('/api/login', { body })
    return { ok: true, token: r.token }
  } catch (e) {
    const code = e instanceof ApiError ? e.code : 'network'
    if (code === 'too_many' || code === 'bad_pin' || code === 'wrong_pin') return { ok: false, reason: code }
    return { ok: false, reason: e instanceof ApiError && e.status === 403 ? 'wrong_pin' : 'network' }
  }
}

export async function loginOwner(pin: string): Promise<LoginResult> {
  if (!isDemo) return server({ scope: 'owner', pin })
  return pin === getDb().business.ownerPin ? { ok: true } : { ok: false, reason: 'wrong_pin' }
}

export async function loginManager(branch: Branch, pin: string): Promise<LoginResult> {
  if (!isDemo) return server({ scope: 'branch', slug: branch.slug, as: 'manager', pin })
  return pin === branch.managerPin ? { ok: true } : { ok: false, reason: 'wrong_pin' }
}

/** PIN'i olmayan personelin ilk girişinde verilen PIN kaydedilir */
export async function loginStaff(branch: Branch, staffId: Id, pin: string): Promise<LoginResult> {
  if (!/^\d{4,8}$/.test(pin)) return { ok: false, reason: 'bad_pin' }
  if (!isDemo) return server({ scope: 'branch', slug: branch.slug, as: 'staff', staffId, pin })
  const s = getDb().branches.find((b) => b.branch.id === branch.id)?.staff.find((x) => x.id === staffId)
  if (!s) return { ok: false, reason: 'wrong_pin' }
  if (!s.pin) {
    mutate((db) => {
      const x = db.branches.find((b) => b.branch.id === branch.id)?.staff.find((y) => y.id === staffId)
      if (x) x.pin = pin
    })
    return { ok: true }
  }
  return pin === s.pin ? { ok: true } : { ok: false, reason: 'wrong_pin' }
}

export function logout(token: string | undefined) {
  if (!isDemo && token) void api('/api/logout', { body: {}, token }).catch(() => undefined)
}

/** Giriş hatasının ekranda gösterilecek yazısı */
export function loginError(reason: 'wrong_pin' | 'too_many' | 'bad_pin' | 'network') {
  return reason === 'too_many'
    ? t('common.tooMany')
    : reason === 'network'
      ? t('common.network')
      : reason === 'bad_pin'
        ? t('staff.pinTooShort')
        : t('common.wrongPin')
}
