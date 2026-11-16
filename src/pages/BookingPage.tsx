// Müşteri randevu sayfası: /r/:slug
// Müşteri buraya salonun linkinden ya da QR kodundan gelir. Personel,
// yönetici ve işletme ekranları bu sayfada hiç görünmez.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { cancelMyBooking, loadMyBookings, submitBooking, type MyBooking } from '../core/data/booking'
import { useBranch } from '../core/data/demoStore'
import { isDemo } from '../core/data/mode'
import { loadBusy, useConnection } from '../core/data/remote'
import { daySlots } from '../core/scheduling'
import { longDate, shortDate } from '../core/time'
import type { Id } from '../core/types'
import { t } from '../i18n'
import { useClock, useMoney } from '../ui/hooks'
import { SalonHeader } from '../ui/layout'
import { ServicePicker, SlotPicker, StaffPicker } from '../ui/pickers'
import { isValidTrPhone } from '../ui/whatsapp'
import { LoadState } from './PanelPage'

export function BookingPage() {
  const { slug } = useParams()
  const conn = useConnection(null, slug)
  const { data } = useBranch(slug)
  if (!data || conn !== 'ready') return <LoadState state={conn === 'ready' ? 'missing' : conn} />
  return <Booking key={data.branch.id} slug={data.branch.slug} />
}

function Booking({ slug }: { slug: string }) {
  const { db, data } = useBranch(slug)
  const d = data!
  const { branch } = d
  const fmt = useMoney(db.business)
  const { today, nowMin } = useClock(db.business, branch)
  const [serviceIds, setServiceIds] = useState<Id[]>([])
  const [staffId, setStaffId] = useState<Id | null>(null)
  const [date, setDate] = useState(today)
  const [time, setTime] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [note, setNote] = useState('')
  const [consent, setConsent] = useState(false)
  const [okMsg, setOkMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [slotsReady, setSlotsReady] = useState(isDemo)
  const [myList, setMyList] = useState<MyBooking[]>([])

  // Gerçek modda seçilen günün dolu saatleri sunucudan gelir
  const refreshBusy = useCallback(() => {
    if (isDemo) return Promise.resolve()
    setSlotsReady(false)
    return loadBusy(slug, branch.id, date).then(
      () => setSlotsReady(true),
      () => setSlotsReady(true),
    )
  }, [slug, branch.id, date])
  useEffect(() => void refreshBusy(), [refreshBusy])

  const refreshMine = useCallback(() => {
    loadMyBookings(slug, branch.id).then(
      (list) =>
        setMyList(
          list
            .filter((a) => a.date >= today && (a.status === 'pending_approval' || a.status === 'booked'))
            .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)),
        ),
      () => undefined,
    )
  }, [slug, branch.id, today])
  useEffect(() => refreshMine(), [refreshMine])

  const services = d.services.filter((s) => !s.hiddenFromCustomers)
  const experts = d.staff.filter((s) => s.active && s.role === 'expert')
  const sel = serviceIds.map((id) => services.find((s) => s.id === id)).filter(Boolean)
  const duration = sel.reduce((a, s) => a + s!.durationMin, 0)

  const slots = useMemo(
    () =>
      serviceIds.length && experts.length && slotsReady
        ? daySlots(
            { date, durationMin: duration, staffId },
            { openMin: branch.openMin, closeMin: branch.closeMin, today, nowMin },
            d.staff,
            d.appointments,
          )
        : null,
    [serviceIds.length, experts.length, slotsReady, date, duration, staffId, branch, today, nowMin, d],
  )

  const submit = async () => {
    if (busy) return
    if (!name.trim() || !phone.trim()) return alert(t('book.missingContact'))
    if (!isValidTrPhone(phone)) return alert(t('book.badPhone'))
    if (!consent) return alert(t('book.missingConsent'))
    if (!serviceIds.length || !time) return alert(t('book.missingSlot'))
    setBusy(true)
    const r = await submitBooking(slug, branch.id, { staffId, serviceIds, date, time, customerName: name, phone, note })
    setBusy(false)
    if (!r.ok) {
      if (r.reason === 'network') return alert(t('common.network'))
      if (r.reason === 'too_many') return alert(t('book.tooMany'))
      setTime(null)
      void refreshBusy()
      return alert(t('appt.slotTaken'))
    }
    void refreshBusy()
    refreshMine()
    setOkMsg(
      t('book.ok', {
        gun: longDate(date, db.business.locale),
        saat: time,
        hizmet: sel.map((s) => s!.name).join(', '),
        tutar: fmt(sel.reduce((a, s) => a + s!.price, 0)),
      }),
    )
    setServiceIds([])
    setTime(null)
    setNote('')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  return (
    <div className="wrap narrow">
      <SalonHeader business={db.business} branch={branch} />
      <div className="card">
        <h2>{db.business.name}</h2>
        <p className="mute" style={{ margin: 0 }}>{t('book.info')}</p>
        <SalonInfo address={branch.address} phone={branch.phone} hours={branch.hours} />
      </div>
      {okMsg && <div className="card ok" role="status">{okMsg}</div>}
      {myList.length > 0 && (
        <div className="card">
          <h2>{t('book.mine')}</h2>
          <ul className="list">
            {myList.map((a) => (
              <li key={a.id} className="ap">
                <span>
                  <b>
                    {shortDate(a.date)} {a.time}
                  </b>
                  <br />
                  <span className="mute">
                    {a.serviceNames.join(', ')} ·{' '}
                    {a.status === 'pending_approval' ? t('status.pending_approval') : t('book.approved')}
                  </span>
                </span>
                <button
                  className="btn2"
                  onClick={async () => {
                    if (!confirm(t('book.cancelConfirm'))) return
                    if (!(await cancelMyBooking(slug, branch.id, a.id))) alert(t('common.network'))
                    refreshMine()
                    void refreshBusy()
                  }}
                >
                  {t('book.cancelMine')}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="card">
        <h2>{t('book.title')}</h2>
        <ServicePicker services={services} selected={serviceIds} onChange={(ids) => { setServiceIds(ids); setTime(null) }} fmt={fmt} />
        <label>{t('common.staff')}</label>
        {experts.length ? (
          <StaffPicker staff={experts} value={staffId} onChange={(id) => { setStaffId(id); setTime(null) }} allowAny />
        ) : (
          <p className="mute" style={{ margin: 0 }}>{t('common.noStaff')}</p>
        )}
        <label htmlFor="mt">{t('common.date')}</label>
        <input
          id="mt"
          type="date"
          min={today}
          value={date}
          onChange={(e) => {
            setDate(e.target.value && e.target.value >= today ? e.target.value : today)
            setTime(null)
          }}
        />
        <label>{t('common.time')}</label>
        <SlotPicker slots={slots} value={time} onChange={setTime} hint={t('common.pickService')} />
        <label htmlFor="mn">{t('book.yourName')}</label>
        <input id="mn" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
        <label htmlFor="mp">{t('common.phone')}</label>
        <input id="mp" type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="05xx xxx xx xx" autoComplete="tel" />
        <label htmlFor="mo">
          {t('common.note')} ({t('common.optional')})
        </label>
        <input id="mo" value={note} onChange={(e) => setNote(e.target.value)} />
        <label className="check">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          <span>{t('book.consent')}</span>
        </label>
        <button className="go" onClick={submit} disabled={busy}>
          {t('book.send')}
        </button>
      </div>
    </div>
  )
}

function SalonInfo({ address, phone, hours }: { address: string; phone: string; hours: string }) {
  if (!address && !phone && !hours) return null
  return (
    <>
      <div style={{ marginTop: 10, fontSize: 14, lineHeight: 1.6 }}>
        {address && (
          <div>
            <b>{t('book.address')}:</b> {address}
          </div>
        )}
        {hours && (
          <div>
            <b>{t('book.hours')}:</b> {hours}
          </div>
        )}
        {phone && (
          <div>
            <b>{t('common.phone')}:</b> {phone}
          </div>
        )}
      </div>
      <div className="row" style={{ marginTop: 10 }}>
        {phone && (
          <a className="btn2 center" href={`tel:${phone.replace(/[^+0-9]/g, '')}`}>
            {t('book.call')}
          </a>
        )}
        {address && (
          <a
            className="btn2 center"
            target="_blank"
            rel="noopener"
            href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`}
          >
            {t('book.map')}
          </a>
        )}
      </div>
    </>
  )
}
