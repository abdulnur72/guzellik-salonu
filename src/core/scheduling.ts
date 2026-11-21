import type { Appointment, Clock, Id, IsoDate, Staff } from './types'
import { toClock, toMinutes } from './time'

export const SLOT_STEP_MIN = 30
export const MIN_BLOCK_MIN = 30

/** Saati dolduran (takvimde yer kaplayan) randevu mu? */
export function blocksCalendar(a: Appointment) {
  return !a.walkIn && a.status !== 'cancelled' && a.status !== 'no_show'
}

function overlaps(a: Appointment, date: IsoDate, start: number, dur: number) {
  if (a.date !== date || !blocksCalendar(a)) return false
  const s = toMinutes(a.time)
  const e = s + (a.durationMin || MIN_BLOCK_MIN)
  return start < e && s < start + dur
}

export interface SlotQuery {
  date: IsoDate
  durationMin: number
  /** Belirli personel; boşsa randevu alabilen herhangi bir uzman */
  staffId?: Id | null
  room?: string
}

/** Verilen saatte boş olan personel (oda/cihaz doluysa kimse boş sayılmaz) */
export function freeStaff(
  q: SlotQuery & { start: number },
  staff: Staff[],
  appts: Appointment[],
): Id[] {
  const dur = Math.max(MIN_BLOCK_MIN, q.durationMin)
  if (q.room && appts.some((a) => a.room === q.room && overlaps(a, q.date, q.start, dur))) return []
  const candidates = q.staffId
    ? staff.filter((s) => s.id === q.staffId)
    : staff.filter((s) => s.active && s.role === 'expert')
  return candidates
    .filter((s) => !appts.some((a) => a.staffId === s.id && overlaps(a, q.date, q.start, dur)))
    .map((s) => s.id)
}

export interface Slot {
  time: Clock
  available: boolean
}

export function daySlots(
  q: SlotQuery,
  opts: { openMin: number; closeMin: number; today: IsoDate; nowMin: number },
  staff: Staff[],
  appts: Appointment[],
): Slot[] {
  const dur = Math.max(MIN_BLOCK_MIN, q.durationMin)
  const past = q.date < opts.today ? Infinity : q.date === opts.today ? opts.nowMin : -1
  const out: Slot[] = []
  for (let t = opts.openMin; t < opts.closeMin; t += SLOT_STEP_MIN) {
    const available =
      t + dur <= opts.closeMin && t > past && freeStaff({ ...q, start: t }, staff, appts).length > 0
    out.push({ time: toClock(t), available })
  }
  return out
}
