// Giriş sayfası (demo): şubeleri ve linklerini listeler.
// Gerçek sürümde burası işletme sahibinin girişi ve Sahip Paneli olacak.

import { Link } from 'react-router-dom'
import { resetDemo, useDb } from '../core/data/demoStore'
import { t } from '../i18n'
import { SalonHeader } from '../ui/layout'

export function HomePage() {
  const db = useDb()
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
      <Link className="btn2 block center" to="/sahip">{t('owner.link')}</Link>
      <button className="btn2 block" onClick={() => confirm(t('home.resetConfirm')) && resetDemo()}>{t('home.reset')}</button>
    </div>
  )
}
