// Salon paneli: /s/:slug
// Personel, resepsiyon ve yönetici aynı linkten girer; kim olduğu PIN ile belirlenir.

import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useBranch } from '../core/data/demoStore'
import { t } from '../i18n'
import { useClock, useMoney } from '../ui/hooks'
import { SalonHeader } from '../ui/layout'
import { AppointmentsView } from './panel/AppointmentsView'
import { ManagerView } from './panel/ManagerView'
import { StaffView } from './panel/StaffView'
import type { PanelCtx, Session } from './panel/ctx'

type Tab = 'manager' | 'staff' | 'appointments'
const TABS: [Tab, Parameters<typeof t>[0]][] = [
  ['manager', 'tab.manager'],
  ['staff', 'tab.staff'],
  ['appointments', 'tab.appointments'],
]

function loadSession(key: string): Session {
  try {
    return JSON.parse(sessionStorage.getItem(key) || 'null')
  } catch {
    return null
  }
}

export function PanelPage() {
  const { slug } = useParams()
  // Şube değişince oturum ve sekme sıfırlansın
  return <Panel key={slug} slug={slug} />
}

function Panel({ slug }: { slug: string | undefined }) {
  const { db, data } = useBranch(slug)
  const sKey = 'salon-session-' + slug
  const [session, setSessionState] = useState<Session>(() => loadSession(sKey))
  const [tab, setTab] = useState<Tab>(() => (session?.kind === 'manager' ? 'manager' : 'staff'))
  const fmt = useMoney(db.business)
  const clock = useClock(db.business, data?.branch ?? db.branches[0].branch)

  const setSession = (s: Session) => {
    setSessionState(s)
    try {
      if (s) sessionStorage.setItem(sKey, JSON.stringify(s))
      else sessionStorage.removeItem(sKey)
    } catch {
      /* yok say */
    }
  }

  // Oturumdaki personel pasife alındıysa çıkış yap
  const staffGone =
    session?.kind === 'staff' && data && !data.staff.some((s) => s.id === session.staffId && s.active)
  useEffect(() => {
    if (staffGone) setSession(null)
  })

  if (!data)
    return (
      <div className="wrap">
        <div className="card">{t('book.notFound')}</div>
      </div>
    )

  const ctx: PanelCtx = { db, data, branch: data.branch, fmt, clock, session, setSession, goTab: setTab }

  return (
    <div className="wrap">
      <SalonHeader business={db.business} branch={data.branch} />
      <div className="tabs" role="group" aria-label="Görünüm">
        {TABS.map(([k, label]) => (
          <button key={k} aria-pressed={tab === k} onClick={() => setTab(k)}>
            {t(label)}
          </button>
        ))}
      </div>
      {tab === 'staff' && <StaffView ctx={ctx} />}
      {tab === 'appointments' && <AppointmentsView ctx={ctx} />}
      {tab === 'manager' && <ManagerView ctx={ctx} />}
    </div>
  )
}
