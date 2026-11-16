// Müşteri randevu sayfasının işlemleri: talep, "Randevularım", iptal.
// Demo modunda bu cihazdaki kayda, gerçek modda sunucuya gider.

import type { Appointment, AppointmentStatus, Id, IsoDate } from '../types'
import { cancelByCustomer, requestBooking } from './actions'
import { getDb, myAppointments, rememberMyAppointment } from './demoStore'
import { isDemo } from './mode'
import { api, ApiError } from './remote'

export type SubmitResult = { ok: true } | { ok: false; reason: 'slot_taken' | 'too_many' | 'network' }

export async function submitBooking(
  slug: string,
  branchId: Id,
  p: { staffId: Id | null; serviceIds: Id[]; date: IsoDate; time: string; customerName: string; phone: string; note?: string },
): Promise<SubmitResult> {
  if (isDemo) return requestBooking(branchId, p)
  try {
    const r = await api<{ ok: boolean; id?: Id; token?: string }>(`/api/public/b/${encodeURIComponent(slug)}/book`, {
      body: { staffId: p.staffId, serviceIds: p.serviceIds, date: p.date, time: p.time, name: p.customerName, phone: p.phone, note: p.note },
    })
    if (!r.ok || !r.id) return { ok: false, reason: 'slot_taken' }
    rememberMyAppointment(r.id, r.token)
    return { ok: true }
  } catch (e) {
    return { ok: false, reason: e instanceof ApiError && e.code === 'too_many' ? 'too_many' : 'network' }
  }
}

export type MyBooking = Pick<Appointment, 'id' | 'date' | 'time' | 'serviceNames'> & { status: AppointmentStatus }

export async function loadMyBookings(slug: string, branchId: Id): Promise<MyBooking[]> {
  const mine = myAppointments()
  if (!mine.length) return []
  if (isDemo) {
    const ids = mine.map((m) => m.id)
    return (getDb().branches.find((b) => b.branch.id === branchId)?.appointments ?? []).filter((a) => ids.includes(a.id))
  }
  const withToken = mine.filter((m) => m.token)
  if (!withToken.length) return []
  const r = await api<{ appointments: MyBooking[] }>(`/api/public/b/${encodeURIComponent(slug)}/mine`, { body: { items: withToken } })
  return r.appointments
}

export async function cancelMyBooking(slug: string, branchId: Id, id: Id): Promise<boolean> {
  if (isDemo) {
    cancelByCustomer(branchId, id)
    return true
  }
  const token = myAppointments().find((m) => m.id === id)?.token
  try {
    const r = await api<{ ok: boolean }>(`/api/public/b/${encodeURIComponent(slug)}/cancel`, { body: { id, token } })
    return r.ok
  } catch {
    return false
  }
}
