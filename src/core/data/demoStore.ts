// Demo deposu: Supabase bağlanana kadar tüm kayıtları bu tarayıcının
// localStorage'ında tutar. Ekranlar veriye yalnızca bu modül ve
// actions.ts üzerinden ulaşır; Supabase'e geçişte değişecek yer burasıdır.

import { useSyncExternalStore } from 'react'
import type { BranchData, DemoDatabase, Id } from '../types'
import { sector } from '../../sectors'

const KEY = 'salon-db-v1'

export const uid = () =>
  (globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2) + Date.now().toString(36))

export function slugify(s: string) {
  const map: Record<string, string> = { ç: 'c', ğ: 'g', ı: 'i', ö: 'o', ş: 's', ü: 'u' }
  return (
    s
      .toLocaleLowerCase('tr-TR')
      .replace(/[çğıöşü]/g, (c) => map[c])
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'sube'
  )
}

export function newBranchData(businessId: Id, name: string, slug: string): BranchData {
  const pkg = sector('guzellik')
  const branchId = uid()
  return {
    branch: {
      id: branchId,
      businessId,
      name,
      slug,
      address: '',
      phone: '',
      hours: '',
      dayCutoffHour: pkg.defaults.dayCutoffHour,
      openMin: pkg.defaults.openMin,
      closeMin: pkg.defaults.closeMin,
      managerPin: '1234',
    },
    staff: [],
    services: pkg.catalog.flatMap((c) =>
      c.items.map((x) => ({
        id: uid(),
        branchId,
        category: c.category,
        name: x.name,
        durationMin: x.durationMin,
        price: x.price,
        sessions: x.sessions,
        hiddenFromCustomers: x.hiddenFromCustomers,
      })),
    ),
    customers: [],
    appointments: [],
    expenses: [],
  }
}

export function seedDemo(): DemoDatabase {
  const businessId = uid()
  const main = newBranchData(businessId, 'Merkez', 'lila')
  const bid = main.branch.id
  main.staff = [
    { id: uid(), branchId: bid, name: 'Ayşe', role: 'expert', commissionPct: 40, active: true },
    { id: uid(), branchId: bid, name: 'Elif', role: 'expert', commissionPct: 35, active: true },
    { id: uid(), branchId: bid, name: 'Selin', role: 'expert', commissionPct: 40, active: true },
  ]
  return {
    version: 1,
    business: {
      id: businessId,
      name: 'Lila Güzellik Salonu',
      ownerName: '',
      sector: 'guzellik',
      country: 'TR',
      currency: 'TRY',
      locale: 'tr-TR',
      timeZone: 'Europe/Istanbul',
      ownerPin: '1234',
      feeFirst: 500,
      feeExtra: 250,
    },
    branches: [main],
  }
}

function load(): DemoDatabase {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const db = JSON.parse(raw) as DemoDatabase
      if (db?.version === 1 && db.branches?.length) return db
    }
  } catch {
    /* bozuk ya da erişilemeyen depolama: yeni demo ile başla */
  }
  return seedDemo()
}

let db: DemoDatabase = typeof localStorage === 'undefined' ? seedDemo() : load()
const listeners = new Set<() => void>()

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(db))
  } catch {
    /* depolama dolu ya da kapalı: oturum boyunca bellekte devam */
  }
}

function emit() {
  listeners.forEach((l) => l())
}

// Aynı tarayıcıda başka sekmede yapılan değişiklikleri al
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === KEY) {
      db = load()
      emit()
    }
  })
}

export function getDb() {
  return db
}

export function subscribe(l: () => void) {
  listeners.add(l)
  return () => listeners.delete(l)
}

/** Değişiklik yap: fn kopya üzerinde çalışır, sonra kaydedilir. */
export function mutate(fn: (draft: DemoDatabase) => void) {
  const draft = structuredClone(db)
  fn(draft)
  db = draft
  persist()
  emit()
}

export function resetDemo() {
  db = seedDemo()
  persist()
  emit()
}

export function useDb() {
  return useSyncExternalStore(subscribe, getDb, getDb)
}

export function useBranch(slug: string | undefined): { db: DemoDatabase; data: BranchData | undefined } {
  const d = useDb()
  return { db: d, data: d.branches.find((b) => b.branch.slug === slug) }
}

/** Müşterinin bu cihazdan aldığı randevular ("Randevularım") */
const MY_KEY = 'salon-my-appts'
export function myAppointmentIds(): Id[] {
  try {
    return JSON.parse(localStorage.getItem(MY_KEY) || '[]')
  } catch {
    return []
  }
}
export function rememberMyAppointment(id: Id) {
  try {
    localStorage.setItem(MY_KEY, JSON.stringify([...myAppointmentIds(), id]))
  } catch {
    /* yok say */
  }
}
