// Salon paneli: /s/:slug
// Personel, resepsiyon ve yönetici aynı linkten girer; kim olduğu PIN ile belirlenir.

import { useEffect, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { logout } from '../core/data/auth'
import { useBranch } from '../core/data/demoStore'
import { disconnect, onAuthLost, onError, useConnection } from '../core/data/remote'
import { t } from '../i18n'
import { useClock, useMoney } from '../ui/hooks'
import { AppTabs, isAppTab, rememberSlug, type AppTab } from '../ui/AppTabs'
import { InstallCard } from '../ui/install'
import { SalonHeader } from '../ui/layout'
import { AppointmentsView } from './panel/AppointmentsView'
import { CustomerView } from './panel/CustomerView'
import { ManagerView } from './panel/ManagerView'
import { StaffView } from './panel/StaffView'
import type { PanelCtx, Session } from './panel/ctx'


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
  const [params, setParams] = useSearchParams()
  const nav = useNavigate()
  const asked = params.get('tab')
  const [tab, setTab] = useState<AppTab>(() =>
    isAppTab(asked) && asked !== 'business' ? asked : session?.kind === 'manager' ? 'manager' : 'staff',
  )
  // ?tab= yalnızca açılışta okunur, sonra adres temiz kalsın
  useEffect(() => {
    if (asked) setParams({}, { replace: true })
  }, [asked, setParams])
  useEffect(() => {
    if (slug) rememberSlug(slug)
  }, [slug])
  const pickTab = (k: AppTab) => (k === 'business' ? nav('/sahip') : setTab(k))
  const fmt = useMoney(db.business)
  const clock = useClock(db.business, data?.branch)

  const setSession = (s: Session) => {
    if (!s && session?.token) {
      // Sahip başka şubeye geçerken kendi oturumu kapanmasın
      if (!isOwnerToken(session.token)) logout(session.token)
      disconnect()
    }
    setSessionState(s)
    try {
      if (s) sessionStorage.setItem(sKey, JSON.stringify(s))
      else sessionStorage.removeItem(sKey)
    } catch {
      /* yok say */
    }
  }

  const conn = useConnection(session?.token, slug)
  useEffect(
    () =>
      onAuthLost(() => {
        setSessionState(null)
        try {
          sessionStorage.removeItem(sKey)
        } catch {
          /* yok say */
        }
        alert(t('common.sessionEnded'))
      }),
    [sKey],
  )
  useEffect(() => onError((code) => alert(code === 'network' ? t('common.network') : code === 'pin_taken' ? t('common.pinTaken') : t('common.saveError'))), [])

  // Oturumdaki personel pasife alındıysa çıkış yap
  const staffGone =
    session?.kind === 'staff' && data && !data.staff.some((s) => s.id === session.staffId && s.active)
  useEffect(() => {
    if (staffGone) setSession(null)
  })

  if (!data) return <LoadState state={conn} />

  const ctx: PanelCtx = { db, data, branch: data.branch, fmt, clock, session, setSession, goTab: setTab }

  return (
    <div className="wrap">
      <SalonHeader business={db.business} branch={data.branch} />
      <AppTabs active={tab} onPick={pickTab} />
      {tab === 'staff' && <StaffView ctx={ctx} />}
      {tab === 'appointments' && <AppointmentsView ctx={ctx} />}
      {tab === 'manager' && <ManagerView ctx={ctx} />}
      {tab === 'customer' && <CustomerView ctx={ctx} />}
      <InstallCard />
    </div>
  )
}

function isOwnerToken(token: string) {
  try {
    return sessionStorage.getItem('salon-owner') === token
  } catch {
    return false
  }
}

/** Veri gelene kadar ya da gelmezse gösterilen kart */
export function LoadState({ state }: { state: 'loading' | 'ready' | 'error' | 'missing' }) {
  return (
    <div className="wrap narrow">
      <div className="card" role="status">
        {state === 'loading' ? (
          t('common.loading')
        ) : state === 'error' ? (
          <>
            <p style={{ marginTop: 0 }}>{t('common.loadError')}</p>
            <button className="btn2" onClick={() => location.reload()}>{t('common.retry')}</button>
          </>
        ) : (
          t('book.notFound')
        )}
      </div>
    </div>
  )
}
