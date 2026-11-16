// Giriş sayfası (demo): şubeleri ve linklerini listeler.
// Gerçek sürümde burası işletme sahibinin girişi ve Sahip Paneli olacak.

import { useState } from 'react'
import { Link } from 'react-router-dom'
import { addBranch } from '../core/data/actions'
import { resetDemo, useDb } from '../core/data/demoStore'
import { t } from '../i18n'
import { SalonHeader } from '../ui/layout'

export function HomePage() {
  const db = useDb()
  const [name, setName] = useState('')
  return (
    <div className="wrap narrow">
      <SalonHeader business={db.business} branch={db.branches[0].branch} />
      <div className="card">
        <h2>{t('home.title')}</h2>
        <p className="mute" style={{ margin: '0 0 6px' }}>{t('home.intro')}</p>
        <ul className="list">
          {db.branches.map(({ branch }) => (
            <li key={branch.id} className="ap">
              <b>{branch.name}</b>
              <span className="actions">
                <Link className="btn2" to={`/s/${branch.slug}`}>{t('home.panelLink')}</Link>
                <Link className="btn2" to={`/r/${branch.slug}`}>{t('home.bookingLink')}</Link>
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
      <button className="btn2 block" onClick={() => confirm(t('home.resetConfirm')) && resetDemo()}>{t('home.reset')}</button>
    </div>
  )
}
