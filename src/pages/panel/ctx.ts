import type { Branch, BranchData, DemoDatabase, Id, IsoDate, Staff } from '../../core/types'

/** token: gerçek modda sunucunun verdiği oturum anahtarı */
export type Session = { kind: 'staff'; staffId: Id; token?: string } | { kind: 'manager'; token?: string } | null

export interface PanelCtx {
  db: DemoDatabase
  data: BranchData
  branch: Branch
  fmt: (n: number) => string
  clock: { today: IsoDate; calendarToday: IsoDate; nowMin: number }
  session: Session
  setSession: (s: Session) => void
  goTab: (t: 'manager' | 'staff' | 'appointments') => void
}

export const isManager = (c: PanelCtx) => c.session?.kind === 'manager'

export function currentStaff(c: PanelCtx): Staff | undefined {
  const s = c.session
  return s?.kind === 'staff' ? c.data.staff.find((x) => x.id === s.staffId && x.active) : undefined
}

export const isReception = (c: PanelCtx) => currentStaff(c)?.role === 'reception'

/** Tüm randevuları görebilir mi (yönetici ya da resepsiyon) */
export const seesAll = (c: PanelCtx) => isManager(c) || isReception(c)
