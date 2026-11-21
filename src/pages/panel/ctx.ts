import type { Branch, BranchData, DemoDatabase, Id, IsoDate, Staff } from '../../core/types'

/** token: gerçek modda sunucunun verdiği oturum anahtarı */
/** open: PIN'siz panel (sahip panelinde açılmış salon), resepsiyon yetkisi */
export type Session =
  | { kind: 'staff'; staffId: Id; token?: string }
  | { kind: 'manager'; token?: string }
  | { kind: 'open'; token?: string }
  | null

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

/** PIN'siz açılmış panel */
export const isOpen = (c: PanelCtx) => c.session?.kind === 'open'

/** Resepsiyon yetkisi (resepsiyon personeli ya da PIN'siz panel): tutarlar görünmez */
export const isReception = (c: PanelCtx) => isOpen(c) || currentStaff(c)?.role === 'reception'

/** Tüm randevuları görebilir mi (yönetici ya da resepsiyon) */
export const seesAll = (c: PanelCtx) => isManager(c) || isReception(c)
