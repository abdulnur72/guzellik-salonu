// Giriş sayfası: şubeleri ve linklerini listeler. Gerçek modda müşteri
// buradan randevu sayfasına, çalışanlar salon paneline geçer.

import { Link, Navigate } from 'react-router-dom'
import { resetDemo } from '../core/data/demoStore'
import { isDemo } from '../core/data/mode'
import { useIndex } from '../core/data/remote'
import { t } from '../i18n'
import { lastSlug } from '../ui/AppTabs'
import { SalonHeader } from '../ui/layout'
import { LoadState } from './PanelPage'

/**
 * Açılış ekranı (/): uygulama, prototipteki gibi doğrudan sekmeli salon
 * paneliyle açılır (son açılan şube ya da tek şube). Birden çok şube varsa
 * ve henüz hiçbiri açılmadıysa şube listesi gösterilir. Liste her zaman
 * /subeler adresinde de durur.
 */
export function HomePage({ list = false }: { list?: boolean }) {
  const idx = useIndex()
  if (typeof idx !== 'object') return <LoadState state={idx} />
  if (!list) {
    const last = lastSlug()
    const target = idx.branches.find((b) => b.slug === last) ?? (idx.branches.length === 1 ? idx.branches[0] : undefined)
    if (target) return <Navigate to={`/s/${target.slug}`} replace />
  }
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
      <Link className="btn2 block center" to={idx.branches[0] ? `/sahip/${idx.branches[0].slug}` : '/sahip'}>{t('owner.link')}</Link>
      {isDemo && (
        <button className="btn2 block" onClick={() => confirm(t('home.resetConfirm')) && resetDemo()}>{t('home.reset')}</button>
      )}
    </div>
  )
}
