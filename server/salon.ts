// Yeni güzellik salonunun ilk kayıtları: işletme, "Merkez" şubesi (kısa adı =
// dükkân kodu), sektörün hizmet listesi ve stok başlangıcı. Sahip paneli
// ("Güzellik salonunu kur") ve demo yükleme betiği kullanır.
// PIN'ler burada yok: secrets tablosuna ayrıca yazılır.

import { ixOf } from './ixof'
import type { Kind } from '../src/core/data/rows'
import { guzellik } from '../src/sectors/guzellik'
import type { Branch, Business, Service, StockItem } from '../src/core/types'

export interface NewRow {
  kind: Kind
  id: string
  branchId: string
  ix: string | null
  data: Record<string, unknown>
}

const uuid = () => crypto.randomUUID()

export function newSalonRows(s: { ad: string; kod: string; tel?: string }) {
  const pkg = guzellik
  const biz = uuid()
  const branchId = uuid()
  const business: Business = {
    id: biz,
    name: s.ad,
    ownerName: '',
    sector: 'guzellik',
    country: 'TR',
    currency: 'TRY',
    locale: 'tr-TR',
    timeZone: 'Europe/Istanbul',
    ownerPin: '•',
    feeFirst: 0,
    feeExtra: 0,
  }
  const branch: Branch = {
    id: branchId,
    businessId: biz,
    name: 'Merkez',
    slug: s.kod,
    address: '',
    phone: s.tel ?? '',
    hours: '',
    dayCutoffHour: pkg.defaults.dayCutoffHour,
    openMin: pkg.defaults.openMin,
    closeMin: pkg.defaults.closeMin,
    managerPin: '•',
    rooms: [...pkg.defaults.rooms],
  }
  const services: Service[] = pkg.catalog.flatMap((c) =>
    c.items.map((x) => ({
      id: uuid(),
      branchId,
      category: c.category,
      name: x.name,
      durationMin: x.durationMin,
      price: x.price,
      ...(x.sessions ? { sessions: x.sessions } : {}),
      ...(x.hiddenFromCustomers ? { hiddenFromCustomers: true } : {}),
    })),
  )
  const stock: StockItem[] = pkg.defaults.stock.map(([name, qty, min]) => ({ id: uuid(), branchId, name, qty, min }))
  const row = (kind: Kind, id: string, b: string, data: object): NewRow => ({
    kind,
    id,
    branchId: b,
    ix: ixOf(kind, data as Record<string, unknown>),
    data: data as Record<string, unknown>,
  })
  const rows: NewRow[] = [
    row('business', biz, '', business),
    row('branch', branchId, branchId, branch),
    ...services.map((x) => row('service', x.id, branchId, x)),
    ...stock.map((x) => row('stock', x.id, branchId, x)),
  ]
  return { biz, branchId, rows }
}
