import { useState } from 'react'
import { consumeSession, updateCustomer } from '../../core/data/actions'
import { shortDate } from '../../core/time'
import type { Customer, Id } from '../../core/types'
import { t } from '../../i18n'
import { waLink } from '../../ui/whatsapp'
import { currentStaff, isManager, seesAll, type PanelCtx } from './ctx'

export function CustomersCard({ ctx }: { ctx: PanelCtx }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<Id | null>(null)
  const { data } = ctx
  const me = currentStaff(ctx)
  const scope = seesAll(ctx)
    ? data.customers
    : data.customers.filter((c) => data.appointments.some((a) => a.customerId === c.id && a.staffId === me?.id))
  const ql = q.toLocaleLowerCase('tr-TR')
  const list = scope
    .filter((c) => !ql || c.name.toLocaleLowerCase('tr-TR').includes(ql) || c.phone.includes(q))
    .sort((a, b) => a.name.localeCompare(b.name, 'tr'))
    .slice(0, 30)
  const visits = (id: Id) => data.appointments.filter((a) => a.customerId === id && a.status === 'done')
  const sel = open ? scope.find((c) => c.id === open) : undefined

  return (
    <>
      <div className="card">
        <h2>{seesAll(ctx) ? t('mgr.customersTitle') : t('mgr.myCustomers')}</h2>
        <label htmlFor="cq">{t('mgr.search')}</label>
        <input id="cq" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('mgr.searchPlaceholder')} autoComplete="off" />
        {list.length ? (
          <ul className="list" style={{ marginTop: 8 }}>
            {list.map((c) => (
              <li key={c.id}>
                <button className="btn2" onClick={() => setOpen(c.id)}>
                  {c.name}
                </button>
                <span className="mute">{t('mgr.visits', { n: visits(c.id).length })}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mute">{t('mgr.noCustomers')}</p>
        )}
      </div>
      {sel && <CustomerDetail key={sel.id} ctx={ctx} c={sel} onClose={() => setOpen(null)} showMoney={isManager(ctx)} />}
    </>
  )
}

function CustomerDetail({ ctx, c, onClose, showMoney }: { ctx: PanelCtx; c: Customer; onClose: () => void; showMoney: boolean }) {
  const done = ctx.data.appointments
    .filter((a) => a.customerId === c.id && a.status === 'done')
    .sort((a, b) => b.date.localeCompare(a.date))
  const set = (patch: Partial<Customer>) => updateCustomer(ctx.branch.id, c.id, patch)
  const packs = ctx.data.packages.filter((p) => p.customerId === c.id && p.remaining > 0)
  return (
    <div className="card">
      <div className="row" style={{ alignItems: 'center' }}>
        <b>{c.name}</b>
        <button className="btn2" style={{ flex: 'none' }} onClick={onClose}>
          {t('common.close')}
        </button>
      </div>
      <p className="mute" style={{ margin: '6px 0' }}>
        {c.phone && (
          <>
            <a href={waLink(c.phone, 'Merhaba ' + c.name)} target="_blank" rel="noopener">
              {c.phone}
            </a>{' '}
            •{' '}
          </>
        )}
        {t('mgr.visits', { n: done.length })}
        {done[0] && ' • ' + t('mgr.lastVisit', { tarih: shortDate(done[0].date) })}
        {showMoney && ' • ' + ctx.fmt(done.reduce((s, a) => s + a.price, 0))}
      </p>
      <label>{t('mgr.birthday')}</label>
      <input type="date" defaultValue={c.birthday || ''} onChange={(e) => set({ birthday: e.target.value || undefined })} />
      <label>{t('common.note')}</label>
      <input defaultValue={c.note || ''} onBlur={(e) => set({ note: e.target.value })} />
      <label>{t('mgr.allergy')}</label>
      <input defaultValue={c.allergyNote || ''} onBlur={(e) => set({ allergyNote: e.target.value })} />
      <p className="mute small">{t('mgr.allergyHint')}</p>
      {packs.length > 0 && (
        <>
          <label>{t('pkg.remaining')}</label>
          <ul className="list">
            {packs.map((p) => (
              <li key={p.id}>
                <span>
                  {p.serviceName}: <b>{p.remaining}/{p.total}</b>
                </span>
                <button
                  className="btn2"
                  onClick={() =>
                    confirm(t('pkg.useConfirm', { paket: p.serviceName, kalan: p.remaining })) &&
                    consumeSession(ctx.branch.id, p.id)
                  }
                >
                  {t('pkg.use')}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      <label>{t('mgr.history')}</label>
      <ul className="list">
        {done.slice(0, 6).map((a) => (
          <li key={a.id}>
            <span>
              {shortDate(a.date)} · {a.serviceNames.join(', ')}
            </span>
            {showMoney && <span>{ctx.fmt(a.price)}</span>}
          </li>
        ))}
        {!done.length && <li className="empty">{t('mgr.noVisits')}</li>}
      </ul>
    </div>
  )
}
