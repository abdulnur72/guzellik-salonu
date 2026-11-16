import { useState } from 'react'
import { deleteAppointment, hasPackage, recordWalkIn } from '../../core/data/actions'
import { changeStaffPin, loginError, loginStaff } from '../../core/data/auth'
import { periodTotals } from '../../core/reports'
import { addDays, monthStart, toClock } from '../../core/time'
import type { Id, PaymentMethod } from '../../core/types'
import { t } from '../../i18n'
import { Strip } from '../../ui/layout'
import { ServicePicker, StaffPicker, StatTiles, Table } from '../../ui/pickers'
import { CustomersCard } from './CustomersCard'
import { currentStaff, type PanelCtx } from './ctx'

export function StaffView({ ctx }: { ctx: PanelCtx }) {
  const [picked, setPicked] = useState<Id | null>(null)
  const me = currentStaff(ctx)
  const active = ctx.data.staff.filter((s) => s.active)

  return (
    <>
      <Strip>{t('staff.strip')}</Strip>
      <div className="grid2">
        <div>
          <div className="card">
            <h2>{t('staff.whoAreYou')}</h2>
            {active.length ? (
              <StaffPicker
                staff={active}
                value={me?.id ?? picked}
                onChange={(id) => {
                  if (id === me?.id) return
                  if (ctx.session?.kind === 'staff') ctx.setSession(null)
                  setPicked(id)
                }}
              />
            ) : (
              <p className="mute">{t('staff.noStaffYet')}</p>
            )}
          </div>
          {!me && picked && <PinCard key={picked} ctx={ctx} staffId={picked} onDone={() => setPicked(null)} />}
          {me && me.role === 'reception' && (
            <>
              <Strip>{t('staff.reception')}</Strip>
              <div className="card">
                <p className="mute" style={{ margin: 0 }}>{t('staff.receptionInfo')}</p>
              </div>
            </>
          )}
          {me && me.role === 'expert' && <WalkInCard ctx={ctx} staffId={me.id} />}
        </div>
        {me && (
          <div>
            {me.role === 'expert' && <MyNumbers ctx={ctx} staffId={me.id} pct={me.commissionPct} />}
            <CustomersCard ctx={ctx} />
            <ChangePinCard key={me.id} ctx={ctx} staffId={me.id} />
            <button className="btn2 block" onClick={() => { ctx.setSession(null); setPicked(null) }}>
              {t('common.logout')}
            </button>
          </div>
        )}
      </div>
      <Strip>{t('staff.footer')}</Strip>
    </>
  )
}

function PinCard({ ctx, staffId, onDone }: { ctx: PanelCtx; staffId: Id; onDone: () => void }) {
  const p = ctx.data.staff.find((s) => s.id === staffId)!
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const go = async () => {
    if (busy) return
    if (!p.pin && pin.length < 4) return alert(t('staff.pinTooShort'))
    setBusy(true)
    const r = await loginStaff(ctx.branch, p.id, pin)
    setBusy(false)
    if (!r.ok) return alert(loginError(r.reason))
    ctx.setSession({ kind: 'staff', staffId: p.id, token: r.token })
    onDone()
  }
  return (
    <form className="card" onSubmit={(e) => { e.preventDefault(); go() }}>
      <h2>{p.name}</h2>
      <p className="mute" style={{ margin: 0 }}>{p.pin ? t('staff.enterPin') : t('staff.setPin')}</p>
      <label htmlFor="spin">{t('staff.pinLabel')}</label>
      <input id="spin" type="password" inputMode="numeric" maxLength={8} autoComplete="off" value={pin} onChange={(e) => setPin(e.target.value)} autoFocus />
      <button className="go" disabled={busy}>{t('common.enter')}</button>
      {p.pin && <p className="mute small">{t('staff.forgotPin')}</p>}
    </form>
  )
}

/** Girişli personelin kendi PIN'ini değiştirmesi */
function ChangePinCard({ ctx, staffId }: { ctx: PanelCtx; staffId: Id }) {
  const [f, setF] = useState({ current: '', next: '', again: '' })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const token = ctx.session?.kind === 'staff' ? ctx.session.token : undefined
  const go = async () => {
    if (busy) return
    setMsg('')
    if (!/^\d{4,8}$/.test(f.next)) return alert(t('staff.pinTooShort'))
    if (f.next !== f.again) return alert(t('staff.pinMismatch'))
    setBusy(true)
    const r = await changeStaffPin(ctx.branch, staffId, token, f.current, f.next)
    setBusy(false)
    if (!r.ok) return alert(loginError(r.reason))
    setF({ current: '', next: '', again: '' })
    setMsg(t('staff.pinChanged'))
  }
  const input = (k: keyof typeof f, label: string) => (
    <>
      <label htmlFor={'cp-' + k}>{label}</label>
      <input id={'cp-' + k} type="password" inputMode="numeric" maxLength={8} autoComplete="off"
        value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
    </>
  )
  return (
    <div className="card">
      <details>
        <summary>{t('staff.changePin')}</summary>
        <form onSubmit={(e) => { e.preventDefault(); go() }}>
          {msg && <p className="ok" role="status">{msg}</p>}
          {input('current', t('staff.currentPin'))}
          {input('next', t('staff.newPin'))}
          {input('again', t('staff.newPinAgain'))}
          <button className="btn2" style={{ marginTop: 10 }} disabled={busy}>{t('staff.changePin')}</button>
        </form>
      </details>
    </div>
  )
}

function WalkInCard({ ctx, staffId }: { ctx: PanelCtx; staffId: Id }) {
  const [ids, setIds] = useState<Id[]>([])
  const [name, setName] = useState('')
  const [amount, setAmount] = useState('')
  const [pay, setPay] = useState<PaymentMethod>('cash')
  const list = ctx.data.services
  const suggested = ids.reduce((a, id) => a + (list.find((s) => s.id === id)?.price ?? 0), 0)
  const save = () => {
    if (!ids.length) return alert(t('staff.pickServiceFirst'))
    if (hasPackage(list, ids) && !name.trim()) return alert(t('staff.packageNeedsName'))
    recordWalkIn(ctx.branch.id, {
      staffId,
      serviceIds: ids,
      customerName: name,
      price: amount.trim() ? Number(amount) || 0 : undefined,
      payment: pay,
      date: ctx.clock.today,
      time: toClock(ctx.clock.nowMin),
    })
    setIds([])
    setName('')
    setAmount('')
    setPay('cash')
  }
  return (
    <div className="card">
      <h2>{t('staff.newCustomer')}</h2>
      <ServicePicker services={list} selected={ids} onChange={setIds} fmt={ctx.fmt} />
      <label htmlFor="kn">{t('staff.customerName')}</label>
      <input id="kn" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
      <label htmlFor="kt">{t('staff.amount', { tutar: ctx.fmt(suggested) })}</label>
      <input id="kt" type="number" inputMode="decimal" value={amount} placeholder={String(suggested)} onChange={(e) => setAmount(e.target.value)} />
      <label htmlFor="ko">{t('staff.payment')}</label>
      <select id="ko" value={pay} onChange={(e) => setPay(e.target.value as PaymentMethod)}>
        <option value="cash">{t('common.cash')}</option>
        <option value="card">{t('common.card')}</option>
      </select>
      <button className="go" onClick={save}>{t('staff.saveCustomer')}</button>
    </div>
  )
}

function MyNumbers({ ctx, staffId, pct }: { ctx: PanelCtx; staffId: Id; pct: number }) {
  const { today } = ctx.clock
  const periods: [string, string, string][] = [
    [t('common.today'), today, today],
    [t('common.last7'), addDays(today, -6), today],
    [t('common.thisMonth'), monthStart(today), today],
  ]
  const td = periodTotals(ctx.data, today, today, staffId)
  const todays = ctx.data.appointments
    .filter((a) => a.staffId === staffId && a.status === 'done' && a.date === today)
    .sort((a, b) => b.time.localeCompare(a.time))
  const cname = (id: Id | null) => ctx.data.customers.find((c) => c.id === id)?.name || t('common.unnamed')
  return (
    <>
      <StatTiles
        items={[
          [t('staff.todayCount'), td.count],
          [t('staff.todayRevenue'), ctx.fmt(td.revenue)],
          [t('staff.todayShare'), ctx.fmt(td.staffShare)],
        ]}
      />
      <div className="card">
        <h2>{t('staff.myRevenue')}</h2>
        <Table
          head={[t('common.period'), t('common.revenue'), t('staff.myShare', { oran: pct })]}
          rows={periods.map(([l, a, b]) => {
            const r = periodTotals(ctx.data, a, b, staffId)
            return [l, ctx.fmt(r.revenue), ctx.fmt(r.staffShare)]
          })}
        />
      </div>
      <div className="card">
        <h2>{t('staff.todayList')}</h2>
        <ul className="list">
          {todays.map((a) => (
            <li key={a.id}>
              <span>
                {a.time} · {cname(a.customerId)}
                <br />
                <span className="mute">{a.serviceNames.join(', ')}</span>
              </span>
              <span>
                {ctx.fmt(a.price)}{' '}
                {a.walkIn && (
                  <button className="btn2" onClick={() => deleteAppointment(ctx.branch.id, a.id)}>
                    {t('common.delete')}
                  </button>
                )}
              </span>
            </li>
          ))}
          {!todays.length && <li className="empty">{t('staff.noneToday')}</li>}
        </ul>
      </div>
    </>
  )
}
