// İşletme sahibi paneli: /sahip
// Sahip tek linkten girer, bütün şubelerin bu ayki durumunu görür,
// şube ekler ve istediği şubenin yönetici ekranına geçer.

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { addBranch, monthlyFee, updateBusiness } from '../core/data/actions'
import { useDb } from '../core/data/demoStore'
import { expensesTotal, periodTotals } from '../core/reports'
import { businessToday, monthStart } from '../core/time'
import { t } from '../i18n'
import { useMoney } from '../ui/hooks'
import { SalonHeader, Strip } from '../ui/layout'
import { StatTiles, Table } from '../ui/pickers'

const OWNER_KEY = 'salon-owner'

function isOwnerSession() {
  try {
    return sessionStorage.getItem(OWNER_KEY) === '1'
  } catch {
    return false
  }
}

export function OwnerPage() {
  const db = useDb()
  const fmt = useMoney(db.business)
  const nav = useNavigate()
  const [ok, setOk] = useState(isOwnerSession)
  const [pin, setPin] = useState('')
  const [name, setName] = useState('')
  const [msg, setMsg] = useState('')
  const [owner, setOwner] = useState({ ownerName: db.business.ownerName, pin: '' })
  const first = db.branches[0].branch

  const setSession = (v: boolean) => {
    setOk(v)
    try {
      if (v) sessionStorage.setItem(OWNER_KEY, '1')
      else sessionStorage.removeItem(OWNER_KEY)
    } catch {
      /* yok say */
    }
  }

  if (!ok)
    return (
      <div className="wrap narrow">
        <SalonHeader business={db.business} branch={first} />
        <form className="card" onSubmit={(e) => {
          e.preventDefault()
          if (pin === db.business.ownerPin) setSession(true)
          else alert(t('common.wrongPin'))
        }}>
          <h2>{t('owner.loginTitle')}</h2>
          <p className="mute" style={{ margin: '0 0 8px' }}>{t('owner.loginInfo')}</p>
          <label htmlFor="opin">PIN</label>
          <input id="opin" type="password" inputMode="numeric" maxLength={8} autoComplete="off" value={pin} onChange={(e) => setPin(e.target.value)} />
          <button className="go">{t('common.enter')}</button>
        </form>
      </div>
    )

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
      sessionStorage.setItem('salon-session-' + slug, JSON.stringify({ kind: 'manager' }))
    } catch {
      /* yok say */
    }
    nav(`/s/${slug}`)
  }

  return (
    <div className="wrap">
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
              if (owner.pin.length < 4) return alert(t('staff.pinTooShort'))
              updateBusiness({ ownerPin: owner.pin })
              setOwner({ ...owner, pin: '' })
              setMsg(t('mgr.pinChanged'))
            }}>{t('mgr.changePin')}</button>
          </div>
          <button className="btn2 block" onClick={() => setSession(false)}>{t('common.logout')}</button>
        </div>
      </div>
    </div>
  )
}
