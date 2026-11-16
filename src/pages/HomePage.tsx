// Giriş sayfası: şubeleri ve linklerini listeler. Gerçek modda müşteri
// buradan randevu sayfasına, çalışanlar salon paneline geçer.

import { Link } from 'react-router-dom'
import { resetDemo } from '../core/data/demoStore'
import { isDemo } from '../core/data/mode'
import { useIndex } from '../core/data/remote'
import { t } from '../i18n'
import { SalonHeader } from '../ui/layout'
import { LoadState } from './PanelPage'

export function HomePage() {
  const idx = useIndex()
  if (typeof idx !== 'object') return <LoadState state={idx} />
  return (
    <div className="wrap narrow">
      <SalonHeader business={idx.business} />
      <div className="card">
        <h2>{t('home.title')}</h2>
        <p className="mute" style={{ margin: '0 0 6px' }}>{isDemo ? t('home.intro') : t('home.liveIntro')}</p>
        <ul className="list">
          {idx.branches.map((branch) => (
            <li key={branch.id} className="ap">
              <b>{branch.name}</b>
              <span className="actions">
                {isDemo && <Link className="btn2" to={`/s/${branch.slug}`}>{t('home.panelLink')}</Link>}
                <Link className={isDemo ? 'btn2' : 'go'} to={`/r/${branch.slug}`}>{isDemo ? t('home.bookingLink') : t('home.bookNow')}</Link>
              </span>
            </li>
          ))}
        </ul>
      </div>
      {!isDemo && (
        <div className="card">
          <h2>{t('home.staffLinks')}</h2>
          <ul className="list">
            {idx.branches.map((branch) => (
              <li key={branch.id} className="ap">
                <span>{branch.name}</span>
                <Link className="btn2" to={`/s/${branch.slug}`}>{t('home.panelLink')}</Link>
              </li>
            ))}
          </ul>
        </div>
      )}
      <Link className="btn2 block center" to="/sahip">{t('owner.link')}</Link>
      {isDemo && (
        <button className="btn2 block" onClick={() => confirm(t('home.resetConfirm')) && resetDemo()}>{t('home.reset')}</button>
      )}
    </div>
  )
}
