import { describe, expect, it } from 'vitest'
import { businessToday, addDays, toClock, toMinutes } from '../time'
import { daySlots, freeStaff } from '../scheduling'
import { periodTotals } from '../reports'
import type { Appointment, Staff } from '../types'
import { getDb } from '../data/demoStore'
import { requestBooking, setStatus, cancelByCustomer } from '../data/actions'

const staff: Staff[] = [
  { id: 'a', branchId: 'b', name: 'Ayşe', role: 'expert', commissionPct: 40, active: true },
  { id: 'e', branchId: 'b', name: 'Elif', role: 'expert', commissionPct: 50, active: true },
  { id: 'r', branchId: 'b', name: 'Resepsiyon', role: 'reception', commissionPct: 0, active: true },
]
const appt = (p: Partial<Appointment>): Appointment => ({
  id: Math.random().toString(36), branchId: 'b', date: '2026-11-20', time: '10:00', durationMin: 60, price: 500,
  serviceIds: [], serviceNames: [], staffId: 'a', customerId: null, status: 'booked', ...p,
})

describe('iş günü', () => {
  it('gün değişim saatinden önceki kayıt önceki güne yazılır', () => {
    // 2026-11-17 02:30 İstanbul = 23:30 UTC önceki gün
    const at = new Date('2026-11-16T23:30:00Z')
    expect(businessToday(at, 'Europe/Istanbul', 0)).toBe('2026-11-17')
    expect(businessToday(at, 'Europe/Istanbul', 4)).toBe('2026-11-16')
  })
  it('tarih ve saat yardımcıları', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(toClock(toMinutes('09:30') + 45)).toBe('10:15')
  })
})

describe('boş saat', () => {
  const opts = { openMin: 540, closeMin: 1200, today: '2026-11-16', nowMin: 0 }
  it('dolu personel o saatte boş sayılmaz, diğeri sayılır', () => {
    const appts = [appt({ staffId: 'a', time: '10:00', durationMin: 60 })]
    expect(freeStaff({ date: '2026-11-20', durationMin: 30, start: 600 }, staff, appts)).toEqual(['e'])
    expect(freeStaff({ date: '2026-11-20', durationMin: 30, start: 630, staffId: 'a' }, staff, appts)).toEqual([])
    expect(freeStaff({ date: '2026-11-20', durationMin: 30, start: 660, staffId: 'a' }, staff, appts)).toEqual(['a'])
  })
  it('resepsiyon randevu almaz; iptal edilen saat yeniden açılır', () => {
    const appts = [appt({ staffId: 'a' }), appt({ staffId: 'e' })]
    expect(freeStaff({ date: '2026-11-20', durationMin: 30, start: 600 }, staff, appts)).toEqual([])
    appts[1].status = 'cancelled'
    expect(freeStaff({ date: '2026-11-20', durationMin: 30, start: 600 }, staff, appts)).toEqual(['e'])
  })
  it('aynı oda aynı saatte iki randevuya verilmez', () => {
    const appts = [appt({ staffId: 'a', room: 'Lazer cihazı' })]
    expect(freeStaff({ date: '2026-11-20', durationMin: 30, start: 600, room: 'Lazer cihazı' }, staff, appts)).toEqual([])
  })
  it('kapanışa sığmayan ve geçmiş saatler kapalı', () => {
    const s = daySlots({ date: '2026-11-16', durationMin: 90 }, { ...opts, nowMin: 600 }, staff, [])
    expect(s.find((x) => x.time === '10:00')!.available).toBe(false)
    expect(s.find((x) => x.time === '10:30')!.available).toBe(true)
    expect(s.find((x) => x.time === '18:30')!.available).toBe(true)
    expect(s.find((x) => x.time === '19:00')!.available).toBe(false)
  })
})

describe('ciro', () => {
  it('yalnızca "Geldi" olanlar ve personelin prim oranı', () => {
    const data = {
      staff,
      appointments: [
        appt({ staffId: 'a', status: 'done', price: 1000 }),
        appt({ staffId: 'e', status: 'done', price: 400 }),
        appt({ staffId: 'e', status: 'booked', price: 999 }),
      ],
    }
    expect(periodTotals(data, '2026-11-01', '2026-11-30')).toEqual({ count: 2, revenue: 1400, staffShare: 600 })
    expect(periodTotals(data, '2026-11-01', '2026-11-30', 'e').staffShare).toBe(200)
  })
})

describe('online randevu', () => {
  it('talep onay bekler; aynı saat ikinci kez alınamaz; müşteri iptal edince açılır', () => {
    const b = getDb().branches[0]
    const svc = b.services.find((s) => !s.hiddenFromCustomers)!
    const sid = b.staff[0].id
    const p = { staffId: sid, serviceIds: [svc.id], date: '2030-01-07', time: '10:00', customerName: 'Deniz', phone: '05551112233' }
    const r1 = requestBooking(b.branch.id, p)
    expect(r1.ok).toBe(true)
    const saved = getDb().branches[0].appointments.find((a) => r1.ok && a.id === r1.id)!
    expect(saved.status).toBe('pending_approval')
    expect(requestBooking(b.branch.id, p).ok).toBe(false)
    if (r1.ok) cancelByCustomer(b.branch.id, r1.id)
    expect(requestBooking(b.branch.id, p).ok).toBe(true)
  })
  it('"Fark etmez" seçilince boş olan ilk uzman atanır', () => {
    const b = getDb().branches[0]
    const svc = b.services[0]
    const p = { staffId: null, serviceIds: [svc.id], date: '2030-01-08', time: '11:00', customerName: 'Ece', phone: '05551112233' }
    const ids = [requestBooking(b.branch.id, p), requestBooking(b.branch.id, p), requestBooking(b.branch.id, p)]
    expect(ids.every((r) => r.ok)).toBe(true)
    const staffUsed = new Set(getDb().branches[0].appointments.filter((a) => a.date === '2030-01-08').map((a) => a.staffId))
    expect(staffUsed.size).toBe(3)
    expect(requestBooking(b.branch.id, p).ok).toBe(false)
    const first = ids[0]
    if (first.ok) setStatus(b.branch.id, first.id, 'done', 'card')
    expect(getDb().branches[0].appointments.find((a) => first.ok && a.id === first.id)!.payment).toBe('card')
  })
})
