import type { Branch, Business } from '../core/types'
import { t } from '../i18n'
import { isDemo } from '../core/data/mode'

export const FLOWER = (
  <svg viewBox="0 0 40 40" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true">
    <circle cx="20" cy="10" r="6" />
    <circle cx="20" cy="30" r="6" />
    <circle cx="10" cy="20" r="6" />
    <circle cx="30" cy="20" r="6" />
    <circle cx="20" cy="20" r="2.5" />
  </svg>
)

export function SalonHeader({ business, branch, children }: { business: Pick<Business, 'name'>; branch?: Branch; children?: React.ReactNode }) {
  return (
    <header className="hd">
      <div className="brand">
        <div className="logo">{branch?.logo ? <img src={branch.logo} alt="" /> : FLOWER}</div>
        <div>
          <h1>{business.name}</h1>
          <div className="sub">
            {branch && branch.name !== 'Merkez' ? branch.name + ' · ' : ''}
            {t('app.subtitle')}
          </div>
          {isDemo && <span className="chip">{t('app.demoChip')}</span>}
        </div>
      </div>
      {children}
      <div className="orn" aria-hidden="true">
        <i />
        {FLOWER}
        <i />
      </div>
    </header>
  )
}

export function Strip({ children }: { children: React.ReactNode }) {
  return <div className="strip">{children}</div>
}
