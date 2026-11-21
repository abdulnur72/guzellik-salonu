// Uygulamanın tüm kaydı (DemoDatabase) ile veritabanı satırları arasındaki
// dönüşüm. İstemci ve sunucu aynı kodu kullanır: istemci yaptığı değişikliği
// satır farkı olarak gönderir, sunucu satırları saklar ve geri yollar.

import type { BranchData, Business, DemoDatabase, Id } from '../types'

export type Kind =
  | 'business'
  | 'branch'
  | 'staff'
  | 'service'
  | 'customer'
  | 'appointment'
  | 'expense'
  | 'package'
  | 'stock'

export interface Row {
  kind: Kind
  id: Id
  /** İşletme satırı için boş */
  branchId: Id | ''
  /** Silinmiş satırda yok */
  data?: Record<string, unknown>
  deleted?: boolean
}

/** Şube içindeki listeler ve satır türleri */
export const LISTS = [
  ['staff', 'staff'],
  ['service', 'services'],
  ['customer', 'customers'],
  ['appointment', 'appointments'],
  ['expense', 'expenses'],
  ['package', 'packages'],
  ['stock', 'stock'],
] as const satisfies readonly (readonly [Kind, keyof BranchData])[]

export const KINDS: Kind[] = ['business', 'branch', ...LISTS.map(([k]) => k)]

export const rowKey = (kind: Kind, id: Id) => `${kind}:${id}`

/** Gizli alanların (PIN) yerine gönderilen işaret: "PIN belirlenmiş" */
export const SECRET_MARK = '•'

export function toRows(db: DemoDatabase): Map<string, Row> {
  const out = new Map<string, Row>()
  const put = (r: Row) => out.set(rowKey(r.kind, r.id), r)
  put({ kind: 'business', id: db.business.id, branchId: '', data: db.business as unknown as Record<string, unknown> })
  for (const b of db.branches) {
    put({ kind: 'branch', id: b.branch.id, branchId: b.branch.id, data: b.branch as unknown as Record<string, unknown> })
    for (const [kind, list] of LISTS)
      for (const item of b[list] as { id: Id }[])
        put({ kind, id: item.id, branchId: b.branch.id, data: item as unknown as Record<string, unknown> })
  }
  return out
}

/** Satırlardan kayıt kurar. İşletme satırı yoksa null döner. */
export function fromRows(rows: Iterable<Row>): DemoDatabase | null {
  let business: Business | null = null
  const branches = new Map<Id, BranchData>()
  const items: Row[] = []
  for (const r of rows) {
    if (r.deleted || !r.data) continue
    if (r.kind === 'business') business = r.data as unknown as Business
    else if (r.kind === 'branch')
      branches.set(r.id, {
        branch: r.data as unknown as BranchData['branch'],
        staff: [],
        services: [],
        customers: [],
        appointments: [],
        expenses: [],
        packages: [],
        stock: [],
      })
    else items.push(r)
  }
  if (!business) return null
  for (const r of items) {
    const b = branches.get(r.branchId)
    const list = LISTS.find(([k]) => k === r.kind)?.[1]
    if (b && list) (b[list] as unknown[]).push(r.data)
  }
  for (const b of branches.values()) b.branch.rooms ??= []
  return { version: 1, business, branches: [...branches.values()] }
}

/** Önceki ve sonraki satırlar arasındaki fark: değişen, eklenen ve silinen satırlar */
export function diffRows(before: Map<string, Row>, after: Map<string, Row>): Row[] {
  const out: Row[] = []
  for (const [k, r] of after) {
    const old = before.get(k)
    if (!old || JSON.stringify(old.data) !== JSON.stringify(r.data)) out.push(r)
  }
  for (const [k, r] of before) if (!after.has(k)) out.push({ kind: r.kind, id: r.id, branchId: r.branchId, deleted: true })
  return out
}

/** Satırın ait olduğu şube (işletme satırı için boş) */
export function branchOf(kind: Kind, data: Record<string, unknown>): string {
  if (kind === 'business') return ''
  if (kind === 'branch') return String(data.id ?? '')
  return String(data.branchId ?? '')
}
