// İşletme sahibi paneli: /sahip
// Sahip tek linkten girer, bütün şubelerin bu ayki durumunu görür,
// şube ekler ve istediği şubenin yönetici ekranına geçer.

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { addBranch, monthlyFee, updateBusiness } from '../core/data/actions'
import { loginError, loginOwner, logout, ownerPinClashes } from '../core/data/auth'
import { useDb } from '../core/data/demoStore'
import { isDemo } from '../core/data/mode'
import { disconnect, onAuthLost, onError, useConnection, useIndex } from '../core/data/remote'
import { expensesTotal, periodTotals } from '../core/reports'
import { businessToday, monthStart } from '../core/time'
import { t } from '../i18n'
import { useMoney } from '../ui/hooks'
import { AppTabs, lastSlug, type AppTab } from '../ui/AppTabs'
import { InstallCard } from '../ui/install'
import { SalonHeader, Strip } from '../ui/layout'
import { StatTiles, Table } from '../ui/pickers'
import { LoadState } from './PanelPage'

const OWNER_KEY = 'salon-owner'

/** Sahip panelindeki sekme çubuğu: diğer sekmeler son açılan şubenin paneline gider. */
function OwnerTabs({ firstSlug }: { firstSlug?: string }) {
  const nav = useNavigate()
  const go = (k: AppTab) => {
    if (k === 'business') return
    const slug = lastSlug() || firstSlug
    if (slug) nav(`/s/${slug}?tab=${k}`)
  }
  return <AppTabs active="business" onPick={go} />
}

/** Sahip oturumu: gerçek modda sunucunun verdiği anahtar, demo modunda '1' */
function ownerToken() {
  try {
    return sessionStorage.getItem(OWNER_KEY)
  } catch {
    return null
  }
}

export function OwnerPage() {
  const [tok, setTok] = useState(ownerToken)
  const setSession = (v: string | null) => {
    if (!v && tok && !isDemo) {
      logout(tok)
      disconnect()
    }
    setTok(v)
    try {
      if (v) sessionStorage.setItem(OWNER_KEY, v)
      else sessionStorage.removeItem(OWNER_KEY)
    } catch {
      /* yok say */
    }
  }
  useEffect(
    () =>
      onAuthLost(() => {
        setTok(null)
        try {
          sessionStorage.removeItem(OWNER_KEY)
        } catch {
          /* yok say */
        }
      }),
    [],
  )
  useEffect(() => onError((code) => alert(code === 'network' ? t('common.network') : code === 'pin_taken' ? t('common.pinTaken') : t('common.saveError'))), [])
  return tok ? <OwnerPanel token={tok} setSession={setSession} /> : <OwnerLogin onLogin={setSession} />
}

function OwnerLogin({ onLogin }: { onLogin: (token: string) => void }) {
  const idx = useIndex()
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <div className="wrap narrow">
      <OwnerTabs firstSlug={typeof idx === 'object' ? idx.branches[0]?.slug : undefined} />
      <SalonHeader business={{ name: typeof idx === 'object' ? idx.business.name : '' }} />
      <form className="card" onSubmit={async (e) => {
        e.preventDefault()
        if (busy) return
        setBusy(true)
        const r = await loginOwner(pin)
        setBusy(false)
        if (r.ok) onLogin(r.token ?? '1')
        else alert(loginError(r.reason))
      }}>
        <h2>{t('owner.loginTitle')}</h2>
        <p className="mute" style={{ margin: '0 0 8px' }}>{t('owner.loginInfo')}{isDemo && ' ' + t('common.demoPin')}</p>
        <label htmlFor="opin">PIN</label>
        <input id="opin" type="password" inputMode="numeric" maxLength={8} autoComplete="off" value={pin} onChange={(e) => setPin(e.target.value)} />
        <button className="go" disabled={busy}>{t('common.enter')}</button>
      </form>
      <InstallCard />
    </div>
  )
}

function OwnerPanel({ token, setSession }: { token: string; setSession: (v: string | null) => void }) {
  const conn = useConnection(isDemo ? null : token)
  const db = useDb()
  const fmt = useMoney(db.business)
  const nav = useNavigate()
  const [name, setName] = useState('')
  const [msg, setMsg] = useState('')
  const [owner, setOwner] = useState({ ownerName: db.business.ownerName, pin: '' })
  useEffect(() => setOwner((o) => ({ ...o, ownerName: db.business.ownerName })), [db.business.ownerName])
  if (conn !== 'ready' || !db.branches.length) return <LoadState state={conn === 'ready' ? 'loading' : conn} />
  const first = db.branches[0].branch

  const rows = db.branches.map((d) => {
    const today = businessToday(new Date(), db.business.timeZone, d.branch.dayCutoffHour)
    const m0 = monthStart(today)
    const r = periodTotals(d, m0, today)
    const g = expensesTotal(d, m0, today)
    return { d, r, g, net: r.revenue - r.staffShare - g }
  })
  const total = rows.reduce((a, x) => ({ c: a.c + x.r.revenue, net: a.net + x.net }), { c: 0, net: 0 })
  const n = db.branches.length

  const openBranch = (slug: string) => {
    try {
      sessionStorage.setItem('salon-session-' + slug, JSON.stringify({ kind: 'manager', token: isDemo ? undefined : token }))
    } catch {
      /* yok say */
    }
    nav(`/s/${slug}`)
  }

  return (
    <div className="wrap">
      <OwnerTabs firstSlug={first.slug} />
      <SalonHeader business={db.business} branch={first} />
      <Strip>{t('owner.strip')}</Strip>
      <StatTiles items={[[t('owner.totalRevenue'), fmt(total.c)], [t('owner.totalNet'), fmt(total.net)], [t('owner.branchCount'), n]]} />
      <div className="grid2">
        <div>
          <div className="card">
            <h2>{t('owner.branches')}</h2>
            <Table
              head={[t('owner.branch'), t('mgr.customers'), t('common.revenue'), t('owner.expense'), t('mgr.netProfit'), '']}
              rows={rows.map((x) => [
                x.d.branch.name, x.r.count, fmt(x.r.revenue), fmt(x.g), fmt(x.net),
                <button key={x.d.branch.id} className="btn2" onClick={() => openBranch(x.d.branch.slug)}>{t('owner.open')}</button>,
              ])}
            />
          </div>
          <div className="card">
            <h2>{t('owner.links')}</h2>
            <ul className="list">
              {db.branches.map(({ branch }) => (
                <li key={branch.id} className="ap">
                  <span>
                    <b>{branch.name}</b>
                    <br />
                    <span className="mute break">
                      {t('home.bookingLink')}: {location.origin}/r/{branch.slug}
                      <br />
                      {t('home.panelLink')}: {location.origin}/s/{branch.slug}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div className="card">
            <h2>{t('home.addBranch')}</h2>
            <label htmlFor="sbn">{t('home.branchName')}</label>
            <input id="sbn" value={name} onChange={(e) => setName(e.target.value)} placeholder="Örn. Kadıköy" />
            <button className="go" onClick={() => { if (name.trim()) { addBranch(name); setName('') } }}>{t('home.addBranch')}</button>
            <p className="mute small">{t('home.branchHint')}</p>
          </div>
        </div>
        <div>
          <div className="card">
            <h2>{t('owner.fee')}</h2>
            <p style={{ margin: '0 0 8px' }}>{t('owner.feeLine', { n, tutar: fmt(monthlyFee(db.business, n)) })}</p>
            <label htmlFor="fi">{t('owner.feeFirst')}</label>
            <input id="fi" type="number" inputMode="numeric" defaultValue={db.business.feeFirst}
              onChange={(e) => updateBusiness({ feeFirst: Math.max(0, Number(e.target.value) || 0) })} />
            <label htmlFor="fe">{t('owner.feeExtra')}</label>
            <input id="fe" type="number" inputMode="numeric" defaultValue={db.business.feeExtra}
              onChange={(e) => updateBusiness({ feeExtra: Math.max(0, Number(e.target.value) || 0) })} />
            <p className="mute small">{t('owner.feeHint')}</p>
          </div>
          <div className="card">
            <h2>{t('owner.settings')}</h2>
            {msg && <p className="ok" role="status">{msg}</p>}
            <label htmlFor="on">{t('owner.ownerName')}</label>
            <input id="on" value={owner.ownerName} onChange={(e) => setOwner({ ...owner, ownerName: e.target.value })} />
            <button className="btn2" style={{ marginTop: 10 }} onClick={() => { updateBusiness({ ownerName: owner.ownerName.trim() }); setMsg(t('mgr.saved')) }}>
              {t('common.save')}
            </button>
            <label htmlFor="onp">{t('owner.newPin')}</label>
            <input id="onp" type="password" inputMode="numeric" maxLength={8} value={owner.pin} onChange={(e) => setOwner({ ...owner, pin: e.target.value })} />
            <button className="btn2" style={{ marginTop: 10 }} onClick={() => {
              if (!/^\d{4,8}$/.test(owner.pin)) return alert(t('staff.pinTooShort'))
              if (isDemo && ownerPinClashes(db, owner.pin)) return alert(t('mgr.pinTakenByStaff'))
              updateBusiness({ ownerPin: owner.pin })
              setOwner({ ...owner, pin: '' })
              setMsg(t('mgr.pinChanged'))
            }}>{t('mgr.changePin')}</button>
          </div>
          <button className="btn2 block" onClick={() => setSession(null)}>{t('common.logout')}</button>
        </div>
      </div>
    </div>
  )
}
