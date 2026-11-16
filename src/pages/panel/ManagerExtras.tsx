// Yönetici sekmesinin ek kartları: geçen ay, oda/cihaz, stok, fotoğraf.

import { useState } from 'react'
import { addRoom, addStock, adjustStock, removeRoom, removeStock, updateBranch, updateStaff } from '../../core/data/actions'
import { expensesTotal, periodTotals } from '../../core/reports'
import { addDays, monthStart } from '../../core/time'
import type { Id } from '../../core/types'
import { t } from '../../i18n'
import { resizeImage } from '../../ui/photo'
import { Table } from '../../ui/pickers'
import type { PanelCtx } from './ctx'

/** Geçen ayın ilk ve son günü */
export function lastMonth(today: string): [string, string] {
  const end = addDays(monthStart(today), -1)
  return [monthStart(end), end]
}

export function PrevMonthCard({ ctx }: { ctx: PanelCtx }) {
  const [a, b] = lastMonth(ctx.clock.today)
  const all = periodTotals(ctx.data, a, b)
  const exp = expensesTotal(ctx.data, a, b)
  const monthName = new Date(a + 'T12:00:00Z').toLocaleDateString(ctx.db.business.locale, { month: 'long', year: 'numeric', timeZone: 'UTC' })
  const staff = ctx.data.staff.filter((s) => s.role === 'expert')
  return (
    <div className="card">
      <details>
        <summary>{t('mgr.prevMonthTitle', { ay: monthName })}</summary>
        <p className="mute" style={{ margin: '6px 0' }}>{t('mgr.prevMonthInfo')}</p>
        <p style={{ margin: '0 0 8px' }}>
          {t('common.revenue')} {ctx.fmt(all.revenue)} · {t('mgr.staffShare')} −{ctx.fmt(all.staffShare)} · {t('mgr.expenses')} −{ctx.fmt(exp)}
          <br />
          <b>{t('mgr.netProfit')} {ctx.fmt(all.revenue - all.staffShare - exp)}</b>
        </p>
        <Table
          head={[t('common.staff'), t('mgr.customers'), t('common.revenue'), t('mgr.staffShare')]}
          rows={staff
            .map((p) => ({ p, r: periodTotals(ctx.data, a, b, p.id) }))
            .filter(({ p, r }) => p.active || r.count > 0)
            .map(({ p, r }) => [p.name, r.count, ctx.fmt(r.revenue), ctx.fmt(r.staffShare)])}
        />
      </details>
    </div>
  )
}

export function RoomsCard({ ctx }: { ctx: PanelCtx }) {
  const [name, setName] = useState('')
  const rooms = ctx.branch.rooms
  return (
    <div className="card">
      <h2>{t('mgr.rooms')}</h2>
      <p className="mute" style={{ margin: '0 0 6px' }}>{t('mgr.roomsInfo')}</p>
      <ul className="list">
        {rooms.map((r) => (
          <li key={r}>
            <span>{r}</span>
            <button className="btn2" aria-label={t('common.delete')} onClick={() => removeRoom(ctx.branch.id, r)}>×</button>
          </li>
        ))}
        {!rooms.length && <li className="empty">{t('mgr.noRooms')}</li>}
      </ul>
      <label htmlFor="oa">{t('mgr.newRoom')}</label>
      <input id="oa" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('mgr.newRoomPlaceholder')} autoComplete="off" />
      <button className="go" onClick={() => { addRoom(ctx.branch.id, name); setName('') }}>{t('common.add')}</button>
    </div>
  )
}

export function StockCard({ ctx }: { ctx: PanelCtx }) {
  const [name, setName] = useState('')
  const [qty, setQty] = useState('')
  const [min, setMin] = useState('')
  const b = ctx.branch.id
  const low = ctx.data.stock.filter((s) => s.qty <= s.min).length
  return (
    <div className="card">
      <details open={low > 0}>
        <summary>{low ? t('mgr.stockLow', { n: low }) : t('mgr.stock')}</summary>
        <ul className="list" style={{ marginTop: 8 }}>
          {ctx.data.stock.map((s) => (
            <li key={s.id}>
              <span>
                {s.name} {s.qty <= s.min && <span className="chip" style={{ margin: 0 }}>{t('mgr.lowChip')}</span>}
                <br />
                <span className="mute">{t('mgr.minQty', { n: s.min })}</span>
              </span>
              <span className="actions end">
                <button className="btn2" aria-label="−" onClick={() => adjustStock(b, s.id, -1)}>−</button>
                <b>{s.qty}</b>
                <button className="btn2" aria-label="+" onClick={() => adjustStock(b, s.id, 1)}>+</button>
                <button className="btn2" aria-label={t('common.delete')} onClick={() => removeStock(b, s.id)}>×</button>
              </span>
            </li>
          ))}
          {!ctx.data.stock.length && <li className="empty">{t('mgr.noStock')}</li>}
        </ul>
        <label htmlFor="sa2">{t('mgr.newStock')}</label>
        <input id="sa2" value={name} onChange={(e) => setName(e.target.value)} />
        <div className="row">
          <div><label htmlFor="sd">{t('mgr.qty')}</label><input id="sd" type="number" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} /></div>
          <div><label htmlFor="sm">{t('mgr.min')}</label><input id="sm" type="number" inputMode="numeric" value={min} onChange={(e) => setMin(e.target.value)} /></div>
        </div>
        <button className="go" onClick={() => {
          if (!name.trim()) return
          addStock(b, { name: name.trim(), qty: Math.max(0, Number(qty) || 0), min: Math.max(0, Number(min) || 0) })
          setName(''); setQty(''); setMin('')
        }}>{t('mgr.addStock')}</button>
      </details>
    </div>
  )
}

/** Fotoğraf seçme düğmesi: personel ya da salon */
export function PhotoButton({ ctx, staffId, label }: { ctx: PanelCtx; staffId?: Id; label: string }) {
  return (
    <label className="btn2 filebtn">
      {label}
      <input
        type="file"
        accept="image/*"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (!f) return
          try {
            const url = await resizeImage(f)
            if (staffId) updateStaff(ctx.branch.id, staffId, { photo: url })
            else updateBranch(ctx.branch.id, { logo: url })
          } catch {
            /* okunamayan dosya: yok say */
          }
        }}
      />
    </label>
  )
}
