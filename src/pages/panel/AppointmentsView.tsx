import { useMemo, useState } from 'react'
import { addAppointment, setStatus } from '../../core/data/actions'
import { daySlots } from '../../core/scheduling'
import { addDays, longDate, shortDate } from '../../core/time'
import type { Appointment, Id } from '../../core/types'
import { t } from '../../i18n'
import { Strip } from '../../ui/layout'
import { ServicePicker, SlotPicker, StaffPicker } from '../../ui/pickers'
import { waLink } from '../../ui/whatsapp'
import { currentStaff, isManager, isOpen, isReception, seesAll, type PanelCtx } from './ctx'

export function AppointmentsView({ ctx }: { ctx: PanelCtx }) {
  const me = currentStaff(ctx)
  if (!isManager(ctx) && !me && !isOpen(ctx))
    return (
      <>
        <Strip>{t('appt.strip')}</Strip>
        <div className="card">
          <h2>{t('appt.loginFirst')}</h2>
          <p className="mute">{t('appt.loginFirstInfo')}</p>
          <div className="row">
            <button className="btn2" onClick={() => ctx.goTab('staff')}>{t('appt.staffLogin')}</button>
            <button className="btn2" onClick={() => ctx.goTab('manager')}>{t('appt.managerLogin')}</button>
          </div>
        </div>
      </>
    )

  const { today } = ctx.clock
  const all = seesAll(ctx)
  const mine = all ? ctx.data.appointments : ctx.data.appointments.filter((a) => a.staffId === me!.id)
  const byTime = (a: Appointment, b: Appointment) => (a.date + a.time).localeCompare(b.date + b.time)
  const scheduled = mine.filter((a) => !a.walkIn)
  const pending = scheduled.filter((a) => a.status === 'pending_approval' && a.date >= today).sort(byTime)
  const upcoming = scheduled.filter((a) => a.date >= today && a.status !== 'pending_approval').sort(byTime)
  const unmarked = scheduled.filter((a) => a.date < today && a.status === 'booked').sort(byTime)
  const tomorrow = addDays(today, 1)
  const remind = scheduled.filter((a) => a.date === tomorrow && a.status === 'booked').sort(byTime)

  return (
    <>
      <Strip>{t('appt.strip')}</Strip>
      <div className="grid2">
        <div>
          <NewAppointment ctx={ctx} fixedStaff={all ? null : me!.id} />
        </div>
        <div>
          {pending.length > 0 && (
            <div className="card">
              <h2>{t('appt.pending', { n: pending.length })}</h2>
              <ul className="list">
                {pending.map((a) => (
                  <Row key={a.id} ctx={ctx} a={a} showStaff={all}>
                    <button className="btn2" onClick={() => setStatus(ctx.branch.id, a.id, 'booked')}>{t('appt.approve')}</button>
                    <button className="btn2" onClick={() => setStatus(ctx.branch.id, a.id, 'cancelled')}>{t('appt.reject')}</button>
                  </Row>
                ))}
              </ul>
            </div>
          )}
          {unmarked.length > 0 && (
            <div className="card">
              <h2>{t('appt.unmarked')}</h2>
              <ul className="list">{unmarked.map((a) => <StatusRow key={a.id} ctx={ctx} a={a} showStaff={all} />)}</ul>
            </div>
          )}
          <div className="card">
            <h2>{t('appt.tomorrow', { n: remind.length })}</h2>
            <p className="mute" style={{ margin: '0 0 6px' }}>{t('appt.tomorrowInfo')}</p>
            <ul className="list">
              {remind.map((a) => {
                const c = ctx.data.customers.find((x) => x.id === a.customerId)
                return (
                  <li key={a.id}>
                    <span>
                      {a.time} · {c?.name || t('common.unnamed')}
                      <br />
                      <span className="mute">{a.serviceNames.join(', ')}</span>
                    </span>
                    {c?.phone ? (
                      <a className="btn2" target="_blank" rel="noopener"
                        href={waLink(c.phone, t('appt.tomorrowMsg', { ad: c.name, saat: a.time, hizmet: a.serviceNames.join(', '), salon: ctx.db.business.name }))}>
                        {t('appt.remind')}
                      </a>
                    ) : (
                      <span className="mute">{t('appt.noPhone')}</span>
                    )}
                  </li>
                )
              })}
              {!remind.length && <li className="empty">{t('appt.noTomorrow')}</li>}
            </ul>
          </div>
          <div className="card">
            <h2>{t('appt.upcoming')}</h2>
            <ul className="list">
              {upcoming.map((a) => <StatusRow key={a.id} ctx={ctx} a={a} showStaff={all} />)}
              {!upcoming.length && <li className="empty">{t('appt.noUpcoming')}</li>}
            </ul>
          </div>
        </div>
      </div>
    </>
  )
}

function Row({ ctx, a, showStaff, children }: { ctx: PanelCtx; a: Appointment; showStaff: boolean; children: React.ReactNode }) {
  const c = ctx.data.customers.find((x) => x.id === a.customerId)
  const staff = ctx.data.staff.find((s) => s.id === a.staffId)
  const struck = a.status === 'cancelled' || a.status === 'no_show'
  const hideMoney = isReception(ctx)
  const parts = [
    a.serviceNames.join(', '),
    showStaff ? staff?.name : '',
    hideMoney ? '' : ctx.fmt(a.price) + (a.payment ? ' · ' + t(a.payment === 'cash' ? 'common.cash' : 'common.card') : ''),
    a.room,
    a.note,
  ].filter(Boolean)
  return (
    <li className="ap">
      <span className={struck ? 'dn' : ''}>
        <b>{shortDate(a.date).slice(0, 5)} {a.time}</b> · {c?.name || t('common.unnamed')}
        <br />
        <span className="mute">{parts.join(' · ')}</span>
      </span>
      <span className="actions">{children}</span>
    </li>
  )
}

function StatusRow({ ctx, a, showStaff }: { ctx: PanelCtx; a: Appointment; showStaff: boolean }) {
  const b = ctx.branch.id
  const c = ctx.data.customers.find((x) => x.id === a.customerId)
  if (a.status !== 'booked')
    return (
      <Row ctx={ctx} a={a} showStaff={showStaff}>
        <span className="chip" style={{ margin: 0 }}>
          {a.cancelledByCustomer ? t('appt.cancelledByCustomer') : t(`status.${a.status}`)}
        </span>
        <button className="btn2" onClick={() => setStatus(b, a.id, 'booked')}>{t('appt.undo')}</button>
      </Row>
    )
  return (
    <Row ctx={ctx} a={a} showStaff={showStaff}>
      <button className="btn2" onClick={() => setStatus(b, a.id, 'done', 'cash')}>{t('appt.cameCash')}</button>
      <button className="btn2" onClick={() => setStatus(b, a.id, 'done', 'card')}>{t('appt.cameCard')}</button>
      <button className="btn2" onClick={() => setStatus(b, a.id, 'no_show')}>{t('appt.noShow')}</button>
      <button className="btn2" onClick={() => setStatus(b, a.id, 'cancelled')}>{t('appt.cancel')}</button>
      {c?.phone && (
        <a className="btn2" target="_blank" rel="noopener"
          href={waLink(c.phone, t('appt.remindMsg', {
            ad: c.name, salon: ctx.db.business.name, gun: longDate(a.date, ctx.db.business.locale), saat: a.time, hizmet: a.serviceNames.join(', '),
          }))}>
          {t('appt.remind')}
        </a>
      )}
    </Row>
  )
}

function NewAppointment({ ctx, fixedStaff }: { ctx: PanelCtx; fixedStaff: Id | null }) {
  const { today, nowMin } = ctx.clock
  const [staffId, setStaffId] = useState<Id | null>(fixedStaff)
  const [ids, setIds] = useState<Id[]>([])
  const [date, setDate] = useState(today)
  const [time, setTime] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [note, setNote] = useState('')
  const [room, setRoom] = useState('')
  const [msg, setMsg] = useState('')
  const experts = ctx.data.staff.filter((s) => s.active && s.role === 'expert')
  const rooms = ctx.branch.rooms
  const sid = fixedStaff ?? staffId
  const duration = ids.reduce((a, id) => a + (ctx.data.services.find((s) => s.id === id)?.durationMin ?? 0), 0)

  const slots = useMemo(
    () =>
      ids.length && sid
        ? daySlots(
            { date, durationMin: duration, staffId: sid, room: room || undefined },
            { openMin: ctx.branch.openMin, closeMin: ctx.branch.closeMin, today, nowMin },
            ctx.data.staff,
            ctx.data.appointments,
          )
        : null,
    [ids.length, sid, date, duration, room, ctx.branch, today, nowMin, ctx.data],
  )

  const reset = () => { setTime(null); setMsg('') }
  const save = () => {
    if (!name.trim()) return alert(t('appt.missingName'))
    if (!ids.length || !sid || !time) return alert(t('appt.missingFields'))
    if (!slots?.find((s) => s.time === time)?.available) { setTime(null); return alert(t('appt.slotTaken')) }
    addAppointment(ctx.branch.id, { staffId: sid, serviceIds: ids, date, time, customerName: name, phone, note, room })
    setIds([]); setTime(null); setName(''); setPhone(''); setNote(''); setRoom('')
    setMsg(t('appt.added'))
  }

  return (
    <div className="card">
      <h2>{t('appt.new')}</h2>
      {msg && <p className="ok" role="status">{msg}</p>}
      {!fixedStaff && (
        <>
          <label>{t('common.staff')}</label>
          <StaffPicker staff={experts} value={staffId} onChange={(id) => { setStaffId(id); reset() }} />
        </>
      )}
      {rooms.length > 0 && (
        <>
          <label htmlFor="wr">{t('appt.room')}</label>
          <select id="wr" value={room} onChange={(e) => { setRoom(e.target.value); reset() }}>
            <option value="">{t('appt.noRoom')}</option>
            {rooms.map((r) => <option key={r}>{r}</option>)}
          </select>
        </>
      )}
      <label htmlFor="wn">{t('appt.customerName')}</label>
      <input id="wn" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
      <label htmlFor="wp">{t('appt.phoneHint')}</label>
      <input id="wp" type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="05xx xxx xx xx" autoComplete="off" />
      <ServicePicker services={ctx.data.services} selected={ids} onChange={(v) => { setIds(v); reset() }} fmt={ctx.fmt} />
      <label htmlFor="wt">{t('common.date')}</label>
      <input id="wt" type="date" min={today} value={date}
        onChange={(e) => { setDate(e.target.value && e.target.value >= today ? e.target.value : today); reset() }} />
      <label>{t('common.time')}</label>
      <SlotPicker slots={slots} value={time} onChange={setTime} hint={t('common.pickStaffAndService')} />
      <label htmlFor="wo">{t('common.note')} ({t('common.optional')})</label>
      <input id="wo" value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('appt.notePlaceholder')} />
      <button className="go" onClick={save}>{t('appt.add')}</button>
    </div>
  )
}
