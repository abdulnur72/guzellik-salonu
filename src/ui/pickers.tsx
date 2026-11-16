import { useRef, useState } from 'react'
import type { Id, Service, Staff } from '../core/types'
import type { Slot } from '../core/scheduling'
import { t } from '../i18n'

export function ServicePicker(props: {
  services: Service[]
  selected: Id[]
  onChange: (ids: Id[]) => void
  fmt: (n: number) => string
}) {
  const { services, selected, onChange, fmt } = props
  const categories = [...new Set(services.map((s) => s.category))]
  const [cat, setCat] = useState(0)
  const totalRef = useRef<HTMLParagraphElement>(null)
  const current = categories[Math.min(cat, categories.length - 1)]
  const sel = selected.map((id) => services.find((s) => s.id === id)).filter(Boolean) as Service[]
  const price = sel.reduce((a, s) => a + s.price, 0)
  const dur = sel.reduce((a, s) => a + s.durationMin, 0)

  const toggle = (id: Id) => {
    const next = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]
    onChange(next)
    // İlk seçimden sonra toplam tutara kaydır: uzun listede form kaybolmasın
    if (!selected.length && next.length === 1)
      setTimeout(() => totalRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 60)
  }

  return (
    <>
      <label>{t('common.service')}</label>
      <div className="catbar">
        {categories.map((c, i) => {
          const n = sel.filter((s) => s.category === c).length
          return (
            <button key={c} type="button" className="pill" aria-pressed={c === current} onClick={() => setCat(i)}>
              {c}
              {n ? ` · ${n}` : ''}
            </button>
          )
        })}
      </div>
      <div className="qk">
        {services
          .filter((s) => s.category === current)
          .map((s) => (
            <button key={s.id} type="button" className="pk" aria-pressed={selected.includes(s.id)} onClick={() => toggle(s.id)}>
              <b>{s.name}</b>
              <span className="mute">
                {s.price ? fmt(s.price) + ' · ' : ''}
                {s.durationMin} {t('common.min')}
              </span>
            </button>
          ))}
      </div>
      {sel.length > 0 && (
        <p className="mute" style={{ margin: '10px 0 0' }}>
          {t('common.selected')}: {sel.map((s) => s.name).join(', ')}
        </p>
      )}
      <p ref={totalRef} style={{ margin: '8px 0 0' }}>
        <b>
          {t('common.total')} {fmt(price)}
        </b>{' '}
        · {dur} {t('common.min')}
      </p>
    </>
  )
}

export function Avatar({ person, size = 32 }: { person: { name: string; photo?: string }; size?: number }) {
  return (
    <span className="avatar" style={{ width: size, height: size }}>
      {person.photo ? <img src={person.photo} alt="" /> : (person.name || '?')[0]}
    </span>
  )
}

export function StaffPicker(props: {
  staff: Staff[]
  value: Id | null
  onChange: (id: Id | null) => void
  allowAny?: boolean
}) {
  return (
    <div className="pick">
      {props.allowAny && (
        <button type="button" className="pk" aria-pressed={!props.value} onClick={() => props.onChange(null)}>
          <span className="sq">?</span>
          <span className="n wrap">{t('common.anyStaff')}</span>
        </button>
      )}
      {props.staff.map((p) => (
        <button key={p.id} type="button" className="pk" aria-pressed={props.value === p.id} onClick={() => props.onChange(p.id)}>
          <span className="sq">{p.photo ? <img src={p.photo} alt="" /> : p.name[0]}</span>
          <span className="n">{p.name}</span>
        </button>
      ))}
    </div>
  )
}

export function SlotPicker(props: { slots: Slot[] | null; value: string | null; onChange: (t: string) => void; hint: string }) {
  if (!props.slots) return <p className="mute" style={{ margin: 0 }}>{props.hint}</p>
  return (
    <div className="slots">
      {props.slots.map((s) => (
        <button
          key={s.time}
          type="button"
          aria-pressed={props.value === s.time}
          disabled={!s.available}
          onClick={() => props.onChange(s.time)}
        >
          {s.time}
        </button>
      ))}
    </div>
  )
}

export function StatTiles({ items }: { items: [string, string | number][] }) {
  return (
    <div className="stats">
      {items.map(([k, v]) => (
        <div className="stat" key={k}>
          <span>{k}</span>
          <b>{v}</b>
        </div>
      ))}
    </div>
  )
}

export function Table({ head, rows }: { head: string[]; rows: (string | number | React.ReactNode)[][] }) {
  return (
    <div className="scroll">
      <table>
        <thead>
          <tr>{head.map((h, i) => <th key={i}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
