import type { Appointment, BranchData, Id, IsoDate } from './types'

export interface PeriodTotals {
  /** Müşteri (ziyaret) sayısı */
  count: number
  revenue: number
  /** Personele düşen prim */
  staffShare: number
}

/** Prim oranı 0-100 arası sayı (eski/bozuk kayıtta metin ya da boş gelebilir) */
export function commissionOf(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(',', '.'))
  return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 0
}

/** Ciroya yalnızca "Geldi" işaretlenen randevular girer. */
export function periodTotals(
  data: Pick<BranchData, 'appointments' | 'staff'>,
  from: IsoDate,
  to: IsoDate,
  staffId?: Id,
): PeriodTotals {
  const pct = new Map(data.staff.map((s) => [s.id, commissionOf(s.commissionPct)]))
  const rows = data.appointments.filter(
    (a) =>
      a.status === 'done' && a.date >= from && a.date <= to && (!staffId || a.staffId === staffId),
  )
  return {
    count: rows.length,
    revenue: rows.reduce((t, a) => t + (Number(a.price) || 0), 0),
    staffShare: rows.reduce((t, a) => t + ((Number(a.price) || 0) * (pct.get(a.staffId) ?? 0)) / 100, 0),
  }
}

export function expensesTotal(data: Pick<BranchData, 'expenses'>, from: IsoDate, to: IsoDate) {
  return data.expenses
    .filter((e) => e.date >= from && e.date <= to)
    .reduce((t, e) => t + e.amount, 0)
}

export function paymentSplit(appts: Appointment[]) {
  const done = appts.filter((a) => a.status === 'done')
  const sum = (m: string) => done.filter((a) => a.payment === m).reduce((t, a) => t + a.price, 0)
  return { cash: sum('cash'), card: sum('card') }
}
