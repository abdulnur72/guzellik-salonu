import { useState } from 'react'
import {
  addExpense, addService, addStaff, removeExpense, removeService, removeStaff,
  updateBranch, updateBusinessName, updateService, updateStaff,
} from '../../core/data/actions'
import { loginError, loginManager } from '../../core/data/auth'
import { isDemo } from '../../core/data/mode'
import { expensesTotal, paymentSplit, periodTotals } from '../../core/reports'
import { addDays, monthStart, shortDate } from '../../core/time'
import type { StaffRole } from '../../core/types'
import { t } from '../../i18n'
import { Strip } from '../../ui/layout'
import { Avatar, StatTiles, Table } from '../../ui/pickers'
import { CustomersCard } from './CustomersCard'
import { isManager, type PanelCtx } from './ctx'
import { PhotoButton, PrevMonthCard, RoomsCard, StockCard } from './ManagerExtras'

export function ManagerView({ ctx }: { ctx: PanelCtx }) {
  if (!isManager(ctx)) return <ManagerLogin ctx={ctx} />
  const { today } = ctx.clock
  const m0 = monthStart(today)
  const periods: [string, string, string][] = [
    [t('common.today'), today, today],
    [t('common.last7'), addDays(today, -6), today],
    [t('common.thisMonth'), m0, today],
  ]
  const month = periodTotals(ctx.data, m0, today)
  const split = paymentSplit(ctx.data.appointments.filter((a) => a.date >= m0 && a.date <= today))

  return (
    <>
      <Strip>{t('mgr.strip')}</Strip>
      <StatTiles items={periods.map(([l, a, b]) => [t('mgr.revenueOf', { donem: l }), ctx.fmt(periodTotals(ctx.data, a, b).revenue)])} />
      <div className="grid2">
        <div>
          <div className="card">
            <h2>{t('mgr.revenueTable')}</h2>
            <Table
              head={[t('common.period'), t('common.revenue'), t('mgr.staffShare'), t('mgr.ownerShare')]}
              rows={periods.map(([l, a, b]) => {
                const r = periodTotals(ctx.data, a, b)
                return [l, ctx.fmt(r.revenue), ctx.fmt(r.staffShare), ctx.fmt(r.revenue - r.staffShare)]
              })}
            />
            <p className="mute" style={{ margin: '10px 0 0' }}>
              {t('mgr.paySplit', { nakit: ctx.fmt(split.cash), kart: ctx.fmt(split.card) })}
            </p>
          </div>
          <ProfitCard ctx={ctx} revenue={month.revenue} share={month.staffShare} />
          <ByStaffCard ctx={ctx} />
          <PrevMonthCard ctx={ctx} />
          <DayReportCard ctx={ctx} />
          <StockCard ctx={ctx} />
        </div>
        <div>
          <LinksCard ctx={ctx} />
          <StaffCard ctx={ctx} />
          <CustomersCard ctx={ctx} />
          <RoomsCard ctx={ctx} />
          <ServicesCard ctx={ctx} />
          <SettingsCard ctx={ctx} />
          <button className="btn2 block" onClick={() => ctx.setSession(null)}>{t('common.logout')}</button>
        </div>
      </div>
    </>
  )
}

function ManagerLogin({ ctx }: { ctx: PanelCtx }) {
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <form className="card narrow-card" onSubmit={async (e) => {
      e.preventDefault()
      if (busy) return
      setBusy(true)
      const r = await loginManager(ctx.branch, pin)
      setBusy(false)
      if (r.ok) ctx.setSession({ kind: 'manager', token: r.token })
      else alert(loginError(r.reason))
    }}>
      <h2>{t('mgr.loginTitle')}</h2>
      <p className="mute" style={{ margin: '0 0 8px' }}>{t('mgr.loginInfo')}{isDemo && ' ' + t('common.demoPin')}</p>
      <label htmlFor="pin">PIN</label>
      <input id="pin" type="password" inputMode="numeric" maxLength={8} autoComplete="off" value={pin} onChange={(e) => setPin(e.target.value)} />
      <button className="go" disabled={busy}>{t('common.enter')}</button>
    </form>
  )
}

function ProfitCard({ ctx, revenue, share }: { ctx: PanelCtx; revenue: number; share: number }) {
  const { today } = ctx.clock
  const m0 = monthStart(today)
  const [title, setTitle] = useState('')
  const [amount, setAmount] = useState('')
  const rows = ctx.data.expenses.filter((e) => e.date >= m0 && e.date <= today)
  const total = expensesTotal(ctx.data, m0, today)
  return (
    <div className="card">
      <h2>{t('mgr.profitTitle')}</h2>
      <p style={{ margin: 0 }}>
        {t('common.revenue')} {ctx.fmt(revenue)}
        <br />
        {t('mgr.staffShare')} −{ctx.fmt(share)}
        <br />
        {t('mgr.expenses')} −{ctx.fmt(total)}
        <br />
        <b>{t('mgr.netProfit')} {ctx.fmt(revenue - share - total)}</b>
      </p>
      <ul className="list" style={{ marginTop: 8 }}>
        {rows.map((g) => (
          <li key={g.id}>
            <span>{shortDate(g.date).slice(0, 5)} · {g.title}</span>
            <span>
              {ctx.fmt(g.amount)}{' '}
              <button className="btn2" onClick={() => removeExpense(ctx.branch.id, g.id)}>{t('common.delete')}</button>
            </span>
          </li>
        ))}
      </ul>
      <label htmlFor="gn">{t('mgr.expenseName')}</label>
      <input id="gn" value={title} onChange={(e) => setTitle(e.target.value)} />
      <label htmlFor="gt">{t('mgr.expenseAmount')}</label>
      <input id="gt" type="number" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} />
      <button className="go" onClick={() => {
        const n = Number(amount)
        if (!title.trim() || !(n > 0)) return
        addExpense(ctx.branch.id, { date: today, title: title.trim(), amount: n })
        setTitle(''); setAmount('')
      }}>{t('mgr.addExpense')}</button>
    </div>
  )
}

function ByStaffCard({ ctx }: { ctx: PanelCtx }) {
  const { today } = ctx.clock
  const m0 = monthStart(today)
  return (
    <div className="card">
      <h2>{t('mgr.byStaff')}</h2>
      <Table
        head={[t('common.staff'), t('mgr.customers'), t('common.revenue'), t('mgr.staffShare'), t('mgr.ownerShare'), t('mgr.ratePct')]}
        rows={ctx.data.staff.filter((s) => s.active && s.role === 'expert').map((p) => {
          const r = periodTotals(ctx.data, m0, today, p.id)
          return [
            p.name, r.count, ctx.fmt(r.revenue), ctx.fmt(r.staffShare), ctx.fmt(r.revenue - r.staffShare),
            <input key={p.id} type="number" min={0} max={100} defaultValue={p.commissionPct}
              onChange={(e) => updateStaff(ctx.branch.id, p.id, { commissionPct: Math.min(100, Math.max(0, Number(e.target.value) || 0)) })} />,
          ]
        })}
      />
    </div>
  )
}

function DayReportCard({ ctx }: { ctx: PanelCtx }) {
  const [text, setText] = useState('')
  const make = () => {
    const d = ctx.clock.today
    const r = periodTotals(ctx.data, d, d)
    const s = paymentSplit(ctx.data.appointments.filter((a) => a.date === d))
    const lines = ctx.data.staff
      .filter((p) => p.active && p.role === 'expert')
      .map((p) => {
        const x = periodTotals(ctx.data, d, d, p.id)
        return `${p.name}: ${x.count} müşteri, ${ctx.fmt(x.revenue)} (pay ${ctx.fmt(x.staffShare)})`
      })
      .join('\n')
    setText(t('mgr.reportText', {
      salon: ctx.db.business.name, tarih: shortDate(d), n: r.count, ciro: ctx.fmt(r.revenue),
      nakit: ctx.fmt(s.cash), kart: ctx.fmt(s.card), pay: ctx.fmt(r.staffShare), satirlar: lines,
    }))
  }
  return (
    <div className="card">
      <h2>{t('mgr.dayReport')}</h2>
      <button className="go" style={{ marginTop: 6 }} onClick={make}>{t('mgr.makeReport')}</button>
      {text && (
        <>
          <p style={{ margin: '12px 0 0', whiteSpace: 'pre-line' }}>{text}</p>
          <a className="btn2 block center" style={{ marginTop: 10 }} target="_blank" rel="noopener"
            href={`https://wa.me/?text=${encodeURIComponent(text)}`}>{t('mgr.sendWhatsApp')}</a>
        </>
      )}
    </div>
  )
}

function LinksCard({ ctx }: { ctx: PanelCtx }) {
  const base = location.origin
  const links: [string, string][] = [
    [t('home.bookingLink'), `${base}/r/${ctx.branch.slug}`],
    [t('home.panelLink'), `${base}/s/${ctx.branch.slug}`],
  ]
  const [copied, setCopied] = useState('')
  return (
    <div className="card">
      <h2>{t('mgr.links')}</h2>
      <p className="mute" style={{ margin: '0 0 6px' }}>{t('mgr.linksInfo')}</p>
      <ul className="list">
        {links.map(([l, u]) => (
          <li key={u} className="ap">
            <span>
              <b>{l}</b>
              <br />
              <a href={u} className="mute break">{u}</a>
            </span>
            <button className="btn2" onClick={() => navigator.clipboard?.writeText(u).then(() => setCopied(u))}>
              {copied === u ? t('mgr.copied') : t('mgr.copy')}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function StaffCard({ ctx }: { ctx: PanelCtx }) {
  const [name, setName] = useState('')
  const [role, setRole] = useState<StaffRole>('expert')
  const [pct, setPct] = useState('')
  const b = ctx.branch.id
  return (
    <div className="card">
      <h2>{t('mgr.staffTitle')}</h2>
      <ul className="list">
        {ctx.data.staff.filter((s) => s.active).map((p) => (
          <li key={p.id}>
            <span>
              <Avatar person={p} /> {p.name}
              {p.role === 'reception' && <span className="mute"> ({t('mgr.roleReception')})</span>}
            </span>
            <span className="actions end">
              <PhotoButton ctx={ctx} staffId={p.id} label={t('common.photo')} />
              {p.pin && <button className="btn2" onClick={() => updateStaff(b, p.id, { pin: '' })}>{t('mgr.resetPin')}</button>}
              <button className="btn2" onClick={() => confirm(t('mgr.removeStaffConfirm', { ad: p.name })) && removeStaff(b, p.id)}>{t('common.delete')}</button>
            </span>
          </li>
        ))}
      </ul>
      <label htmlFor="pn">{t('mgr.addStaff')}</label>
      <input id="pn" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('mgr.staffName')} />
      <label htmlFor="pr">{t('mgr.role')}</label>
      <select id="pr" value={role} onChange={(e) => setRole(e.target.value as StaffRole)}>
        <option value="expert">{t('mgr.roleExpert')}</option>
        <option value="reception">{t('mgr.roleReception')}</option>
      </select>
      <label htmlFor="pp">{t('mgr.commission')}</label>
      <input id="pp" type="number" inputMode="numeric" value={pct} onChange={(e) => setPct(e.target.value)} placeholder="40" />
      <button className="go" onClick={() => {
        if (!name.trim()) return
        addStaff(b, { name: name.trim(), role, commissionPct: role === 'reception' ? 0 : Math.min(100, Math.max(0, Number(pct) || 0)) })
        setName(''); setPct(''); setRole('expert')
      }}>{t('mgr.addStaff')}</button>
    </div>
  )
}

function ServicesCard({ ctx }: { ctx: PanelCtx }) {
  const b = ctx.branch.id
  const cats = [...new Set(ctx.data.services.map((s) => s.category))]
  const [cat, setCat] = useState('')
  const [name, setName] = useState('')
  const [dur, setDur] = useState('')
  const [price, setPrice] = useState('')
  return (
    <div className="card">
      <details>
        <summary>
          {t('mgr.services')}{' '}
          <span className="mute normal">{t('mgr.servicesSummary', { n: ctx.data.services.length, k: cats.length })}</span>
        </summary>
        {cats.map((c) => (
          <div key={c}>
            <h2 style={{ marginTop: 14 }}>{c}</h2>
            <ul className="list">
              {ctx.data.services.filter((s) => s.category === c).map((s) => (
                <li key={s.id}>
                  <span>{s.name}<br /><span className="mute">{s.durationMin} {t('common.min')}</span></span>
                  <span className="actions end">
                    <input className="price" type="number" defaultValue={s.price}
                      onChange={(e) => updateService(b, s.id, { price: Number(e.target.value) || 0 })} />
                    <button className="btn2" aria-label={t('common.delete')} onClick={() => removeService(b, s.id)}>×</button>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
        <h2 style={{ marginTop: 16 }}>{t('mgr.addService')}</h2>
        <input list="cats" value={cat} onChange={(e) => setCat(e.target.value)} placeholder={t('mgr.category')} />
        <datalist id="cats">{cats.map((c) => <option key={c} value={c} />)}</datalist>
        <label htmlFor="sn">{t('mgr.serviceName')}</label>
        <input id="sn" value={name} onChange={(e) => setName(e.target.value)} />
        <div className="row">
          <div><label htmlFor="ss">{t('mgr.duration')}</label><input id="ss" type="number" inputMode="numeric" value={dur} onChange={(e) => setDur(e.target.value)} /></div>
          <div><label htmlFor="sf">{t('mgr.price')}</label><input id="sf" type="number" inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value)} /></div>
        </div>
        <button className="go" onClick={() => {
          if (!cat.trim() || !name.trim()) return
          addService(b, { category: cat.trim(), name: name.trim(), durationMin: Number(dur) || 30, price: Number(price) || 0 })
          setName(''); setDur(''); setPrice('')
        }}>{t('mgr.addService')}</button>
      </details>
    </div>
  )
}

function SettingsCard({ ctx }: { ctx: PanelCtx }) {
  const br = ctx.branch
  const [f, setF] = useState({ salon: ctx.db.business.name, address: br.address, phone: br.phone, hours: br.hours })
  const [pin, setPin] = useState('')
  const [msg, setMsg] = useState('')
  const field = (k: keyof typeof f, label: string, extra?: React.InputHTMLAttributes<HTMLInputElement>) => (
    <>
      <label htmlFor={'set-' + k}>{label}</label>
      <input id={'set-' + k} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} autoComplete="off" {...extra} />
    </>
  )
  return (
    <div className="card">
      <details>
        <summary>{t('mgr.settings')} <span className="mute normal">{t('mgr.settingsSummary')}</span></summary>
        {msg && <p className="ok" role="status">{msg}</p>}
        <label htmlFor="sc">{t('mgr.cutoff')}</label>
        <select id="sc" value={br.dayCutoffHour} onChange={(e) => updateBranch(br.id, { dayCutoffHour: Number(e.target.value) })}>
          {[0, 3, 4, 5, 6, 7, 8, 10].map((h) => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
        </select>
        <p className="mute small">{t('mgr.cutoffHint')}</p>
        {field('salon', t('mgr.businessName'))}
        {field('address', t('mgr.address'), { placeholder: 'Mahalle, sokak, ilçe' })}
        {field('phone', t('common.phone'), { type: 'tel', inputMode: 'tel' })}
        {field('hours', t('mgr.hours'), { placeholder: t('mgr.hoursPlaceholder') })}
        <button className="btn2" style={{ marginTop: 10 }} onClick={() => {
          if (f.salon.trim()) updateBusinessName(f.salon.trim())
          updateBranch(br.id, { address: f.address.trim(), phone: f.phone.trim(), hours: f.hours.trim() })
          setMsg(t('mgr.saved'))
        }}>{t('common.save')}</button>
        <div className="actions" style={{ marginTop: 16 }}>
          <PhotoButton ctx={ctx} label={t('mgr.salonPhoto')} />
          {br.logo && <button className="btn2" onClick={() => updateBranch(br.id, { logo: undefined })}>{t('mgr.removePhoto')}</button>}
        </div>
        <label htmlFor="np">{t('mgr.newPin')}</label>
        <input id="np" type="password" inputMode="numeric" maxLength={8} value={pin} onChange={(e) => setPin(e.target.value)} />
        <button className="btn2" style={{ marginTop: 10 }} onClick={() => {
          if (pin.length < 4) return alert(t('staff.pinTooShort'))
          updateBranch(br.id, { managerPin: pin })
          setPin(''); setMsg(t('mgr.pinChanged'))
        }}>{t('mgr.changePin')}</button>
      </details>
    </div>
  )
}
