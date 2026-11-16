// Ekranların kullandığı işlemler. Her biri tek bir şubenin verisini değiştirir.
// Supabase'e geçince aynı imzalarla veritabanına yazacak.

import type {
  Appointment,
  AppointmentStatus,
  BranchData,
  Customer,
  Id,
  IsoDate,
  PaymentMethod,
  Service,
  Staff,
  StaffRole,
} from '../types'
import { freeStaff, MIN_BLOCK_MIN } from '../scheduling'
import { toMinutes } from '../time'
import { mutate, newBranchData, rememberMyAppointment, slugify, uid } from './demoStore'

function onBranch(branchId: Id, fn: (b: BranchData) => void) {
  mutate((db) => {
    const b = db.branches.find((x) => x.branch.id === branchId)
    if (b) fn(b)
  })
}

/** Aynı ada sahip müşteri varsa onu kullanır (telefonu günceller), yoksa yeni açar. */
function upsertCustomer(b: BranchData, name: string, phone = ''): Id | null {
  const ad = name.trim()
  if (!ad) return null
  let c = b.customers.find((x) => x.name.toLocaleLowerCase('tr-TR') === ad.toLocaleLowerCase('tr-TR'))
  if (!c) {
    c = { id: uid(), branchId: b.branch.id, name: ad, phone: phone.trim() }
    b.customers.push(c)
  } else if (phone.trim()) c.phone = phone.trim()
  return c.id
}

function pick(b: BranchData, ids: Id[]) {
  return ids.map((id) => b.services.find((s) => s.id === id)).filter(Boolean) as Service[]
}

export const totals = (list: Service[]) => ({
  price: list.reduce((t, s) => t + s.price, 0),
  duration: list.reduce((t, s) => t + s.durationMin, 0),
})

/** Personelin randevusuz gelen müşteriyi anında kaydetmesi (ciroya hemen girer) */
export function recordWalkIn(
  branchId: Id,
  p: { staffId: Id; serviceIds: Id[]; customerName: string; price?: number; payment: PaymentMethod; date: IsoDate; time: string },
) {
  onBranch(branchId, (b) => {
    const sel = pick(b, p.serviceIds)
    b.appointments.push({
      id: uid(),
      branchId,
      date: p.date,
      time: p.time,
      durationMin: 0,
      price: p.price ?? totals(sel).price,
      serviceIds: sel.map((s) => s.id),
      serviceNames: sel.map((s) => s.name),
      staffId: p.staffId,
      customerId: upsertCustomer(b, p.customerName),
      status: 'done',
      payment: p.payment,
      walkIn: true,
    })
  })
}

/** Salon içinden (personel/resepsiyon/yönetici) randevu ekleme */
export function addAppointment(
  branchId: Id,
  p: { staffId: Id; serviceIds: Id[]; date: IsoDate; time: string; customerName: string; phone: string; note?: string; room?: string },
) {
  onBranch(branchId, (b) => {
    const sel = pick(b, p.serviceIds)
    const t = totals(sel)
    b.appointments.push({
      id: uid(),
      branchId,
      date: p.date,
      time: p.time,
      durationMin: Math.max(MIN_BLOCK_MIN, t.duration),
      price: t.price,
      serviceIds: sel.map((s) => s.id),
      serviceNames: sel.map((s) => s.name),
      staffId: p.staffId,
      customerId: upsertCustomer(b, p.customerName, p.phone),
      status: 'booked',
      note: p.note || undefined,
      room: p.room || undefined,
    })
  })
}

export type BookingResult = { ok: true; id: Id } | { ok: false; reason: 'slot_taken' }

/** Müşterinin online randevu talebi. Personel seçmediyse o saatte boş olan ilk uzman atanır. */
export function requestBooking(
  branchId: Id,
  p: { staffId: Id | null; serviceIds: Id[]; date: IsoDate; time: string; customerName: string; phone: string; note?: string },
): BookingResult {
  let result = { ok: false, reason: 'slot_taken' } as BookingResult
  onBranch(branchId, (b) => {
    const sel = pick(b, p.serviceIds).filter((s) => !s.hiddenFromCustomers)
    const t = totals(sel)
    const durationMin = Math.max(MIN_BLOCK_MIN, t.duration)
    const free = freeStaff(
      { date: p.date, durationMin, staffId: p.staffId, start: toMinutes(p.time) },
      b.staff,
      b.appointments,
    )
    if (!free.length) return
    const id = uid()
    b.appointments.push({
      id,
      branchId,
      date: p.date,
      time: p.time,
      durationMin,
      price: t.price,
      serviceIds: sel.map((s) => s.id),
      serviceNames: sel.map((s) => s.name),
      staffId: free[0],
      customerId: upsertCustomer(b, p.customerName, p.phone),
      status: 'pending_approval',
      note: p.note || undefined,
      online: true,
    })
    result = { ok: true, id }
  })
  if (result.ok) rememberMyAppointment(result.id)
  return result
}

export function setStatus(branchId: Id, apptId: Id, status: AppointmentStatus, payment?: PaymentMethod) {
  onBranch(branchId, (b) => {
    const a = b.appointments.find((x) => x.id === apptId)
    if (!a) return
    a.status = status
    a.payment = status === 'done' ? payment : undefined
    if (status !== 'cancelled') a.cancelledByCustomer = undefined
  })
}

export function cancelByCustomer(branchId: Id, apptId: Id) {
  onBranch(branchId, (b) => {
    const a = b.appointments.find((x) => x.id === apptId)
    if (a && (a.status === 'pending_approval' || a.status === 'booked')) {
      a.status = 'cancelled'
      a.cancelledByCustomer = true
    }
  })
}

export function deleteAppointment(branchId: Id, apptId: Id) {
  onBranch(branchId, (b) => {
    b.appointments = b.appointments.filter((a) => a.id !== apptId)
  })
}

// --- Personel ---

export function addStaff(branchId: Id, p: { name: string; role: StaffRole; commissionPct: number }) {
  onBranch(branchId, (b) => {
    b.staff.push({ id: uid(), branchId, active: true, ...p })
  })
}

export function updateStaff(branchId: Id, staffId: Id, patch: Partial<Omit<Staff, 'id' | 'branchId'>>) {
  onBranch(branchId, (b) => {
    const s = b.staff.find((x) => x.id === staffId)
    if (s) Object.assign(s, patch)
  })
}

export function removeStaff(branchId: Id, staffId: Id) {
  // Geçmiş ciro kayıtları bozulmasın diye personel silinmez, pasife alınır.
  updateStaff(branchId, staffId, { active: false, pin: undefined })
}

// --- Hizmetler ---

export function addService(branchId: Id, p: Omit<Service, 'id' | 'branchId'>) {
  onBranch(branchId, (b) => {
    b.services.push({ id: uid(), branchId, ...p })
  })
}

export function updateService(branchId: Id, serviceId: Id, patch: Partial<Omit<Service, 'id' | 'branchId'>>) {
  onBranch(branchId, (b) => {
    const s = b.services.find((x) => x.id === serviceId)
    if (s) Object.assign(s, patch)
  })
}

export function removeService(branchId: Id, serviceId: Id) {
  onBranch(branchId, (b) => {
    b.services = b.services.filter((s) => s.id !== serviceId)
  })
}

// --- Gider ---

export function addExpense(branchId: Id, p: { date: IsoDate; title: string; amount: number }) {
  onBranch(branchId, (b) => {
    b.expenses.push({ id: uid(), branchId, ...p })
  })
}

export function removeExpense(branchId: Id, id: Id) {
  onBranch(branchId, (b) => {
    b.expenses = b.expenses.filter((e) => e.id !== id)
  })
}

// --- Müşteri ---

export function updateCustomer(branchId: Id, id: Id, patch: Partial<Omit<Customer, 'id' | 'branchId'>>) {
  onBranch(branchId, (b) => {
    const c = b.customers.find((x) => x.id === id)
    if (c) Object.assign(c, patch)
  })
}

// --- Şube ayarları ---

export function updateBranch(branchId: Id, patch: Partial<Omit<BranchData['branch'], 'id' | 'businessId' | 'slug'>>) {
  onBranch(branchId, (b) => Object.assign(b.branch, patch))
}

export function updateBusinessName(name: string) {
  mutate((db) => {
    db.business.name = name
  })
}

export function addBranch(name: string): string {
  let slug = ''
  mutate((db) => {
    const base = slugify(name)
    slug = base
    for (let i = 2; db.branches.some((b) => b.branch.slug === slug); i++) slug = `${base}-${i}`
    db.branches.push(newBranchData(db.business.id, name.trim(), slug))
  })
  return slug
}

export type { Appointment }
