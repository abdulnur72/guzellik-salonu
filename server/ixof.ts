// Satırın arama anahtarı (rows.ix): şubede kısa ad, randevuda tarih, müşteride telefon.
import type { Kind } from '../src/core/data/rows'

type Data = Record<string, unknown>
export const phoneKey = (phone: string) => phone.replace(/\D/g, '').slice(-10)

export function ixOf(kind: Kind, data: Data): string | null {
  if (kind === 'branch') return String(data.slug ?? '')
  if (kind === 'appointment') return String(data.date ?? '')
  if (kind === 'customer') return phoneKey(String(data.phone ?? '')) || null
  return null
}
