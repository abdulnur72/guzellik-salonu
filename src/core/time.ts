import type { Clock, IsoDate } from './types'

/** Verilen anın, verilen saat dilimindeki tarih ve saat parçaları */
export function zonedParts(now: Date, timeZone: string) {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
  const p = Object.fromEntries(f.formatToParts(now).map((x) => [x.type, x.value]))
  return {
    date: `${p.year}-${p.month}-${p.day}` as IsoDate,
    minutes: Number(p.hour) * 60 + Number(p.minute),
  }
}

/**
 * İş günü: gün değişim saatinden (cutoffHour) önce yapılan kayıtlar bir
 * önceki güne yazılır. Ör. cutoff 4 ise gece 02:30'daki müşteri dünün
 * cirosuna girer (bayram öncesi sabaha kadar çalışan dükkanlar için).
 */
export function businessToday(now: Date, timeZone: string, cutoffHour: number): IsoDate {
  return zonedParts(new Date(now.getTime() - cutoffHour * 3_600_000), timeZone).date
}

export function addDays(date: IsoDate, n: number): IsoDate {
  const d = new Date(date + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export function monthStart(date: IsoDate): IsoDate {
  return date.slice(0, 7) + '-01'
}

export const toMinutes = (t: Clock) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5))

export const toClock = (m: number): Clock =>
  String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0')

/** 2026-11-16 -> 16.11.2026 */
export const shortDate = (d: IsoDate) => d.split('-').reverse().join('.')

export function longDate(d: IsoDate, locale: string) {
  return new Date(d + 'T12:00:00Z').toLocaleDateString(locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  })
}

export function money(n: number, locale: string, currency: string) {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(Math.round(n))
}
