// Ortak çekirdeğin veri modeli. Supabase tablolarıyla birebir eşleşir
// (bkz. supabase/migrations/0001_init.sql). Alan adları kodda İngilizce,
// ekranda görünen her yazı src/i18n içindedir.

export type Id = string
/** YYYY-MM-DD (işletmenin saat dilimine göre iş günü) */
export type IsoDate = string
/** HH:MM */
export type Clock = string

export type SectorKey = 'guzellik' | 'kuafor' | 'berber' | 'spor'

export interface Business {
  id: Id
  name: string
  ownerName: string
  sector: SectorKey
  /** ISO 3166-1, ör. "TR" — KVKK/GDPR, KDV gibi kurallar buna göre seçilir */
  country: string
  currency: string
  locale: string
  timeZone: string
  ownerPin: string
  /** Aylık abonelik: ilk şube ve her ek şube ücreti */
  feeFirst: number
  feeExtra: number
}

export interface Branch {
  id: Id
  businessId: Id
  name: string
  /** Linklerde kullanılan kısa ad: /s/:slug (panel), /r/:slug (müşteri) */
  slug: string
  address: string
  phone: string
  hours: string
  /** Gün değişim saati (0-23). Bu saatten önceki kayıtlar önceki iş gününe yazılır. */
  dayCutoffHour: number
  /** İlk ve son randevu saati, gün başından dakika olarak */
  openMin: number
  closeMin: number
  managerPin: string
  logo?: string
}

export type StaffRole = 'expert' | 'reception'

export interface Staff {
  id: Id
  branchId: Id
  name: string
  role: StaffRole
  /** Prim yüzdesi (0-100) */
  commissionPct: number
  pin?: string
  photo?: string
  active: boolean
}

export interface Service {
  id: Id
  branchId: Id
  category: string
  name: string
  durationMin: number
  price: number
  /** Seanslı paketse seans sayısı */
  sessions?: number
  /** Müşteri randevu sayfasında gizli (ör. ürün satışı, hediye çeki) */
  hiddenFromCustomers?: boolean
}

export interface Customer {
  id: Id
  branchId: Id
  name: string
  phone: string
  birthday?: IsoDate
  note?: string
  /** Sağlık verisi: yalnızca açık rıza ile doldurulur */
  allergyNote?: string
}

export type AppointmentStatus =
  | 'pending_approval' // müşteri online talep etti, salon onayı bekliyor
  | 'booked' // onaylı, bekleniyor
  | 'done' // geldi, ciroya girer
  | 'no_show'
  | 'cancelled'

export type PaymentMethod = 'cash' | 'card'

export interface Appointment {
  id: Id
  branchId: Id
  date: IsoDate
  time: Clock
  durationMin: number
  price: number
  serviceIds: Id[]
  /** İşlem adları kayıt anındaki haliyle saklanır (işlem silinse de görünür) */
  serviceNames: string[]
  staffId: Id
  customerId: Id | null
  status: AppointmentStatus
  payment?: PaymentMethod
  room?: string
  note?: string
  /** Randevusuz gelen, personelin anında kaydettiği müşteri */
  walkIn?: boolean
  /** Müşteri randevu sayfasından geldi */
  online?: boolean
  cancelledByCustomer?: boolean
}

export interface Expense {
  id: Id
  branchId: Id
  date: IsoDate
  title: string
  amount: number
}

/** Bir şubenin tüm kayıtları. Demo modunda tek bir JSON olarak saklanır. */
export interface BranchData {
  branch: Branch
  staff: Staff[]
  services: Service[]
  customers: Customer[]
  appointments: Appointment[]
  expenses: Expense[]
}

export interface DemoDatabase {
  version: 1
  business: Business
  branches: BranchData[]
}
