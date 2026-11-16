// Panelin Müşteri sekmesi: müşterinin gördüğü randevu sayfasının linki.
// Randevu formu burada değil, müşteri linkinde (/r/:slug) çalışır; o sayfada
// yönetim sekmeleri yoktur.

import { useState } from 'react'
import { t } from '../../i18n'
import { Strip } from '../../ui/layout'
import type { PanelCtx } from './ctx'

export function CustomerView({ ctx }: { ctx: PanelCtx }) {
  const { branch, db } = ctx
  const url = `${location.origin}/r/${branch.slug}`
  const [copied, setCopied] = useState(false)
  const share = t('cust.shareText', { salon: db.business.name, link: url })
  return (
    <>
      <Strip>{t('cust.strip')}</Strip>
      <div className="card">
        <h2>{t('cust.title')}</h2>
        <p className="mute" style={{ margin: '0 0 10px' }}>{t('cust.info')}</p>
        <p className="linkbox break">{url}</p>
        <a className="go center" style={{ display: 'block', textDecoration: 'none' }} href={url} target="_blank" rel="noopener">
          {t('cust.open')}
        </a>
        <div className="row" style={{ marginTop: 10 }}>
          <button
            className="btn2"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(url)
                setCopied(true)
                setTimeout(() => setCopied(false), 2000)
              } catch {
                prompt(t('cust.copy'), url)
              }
            }}
          >
            {copied ? t('cust.copied') : t('cust.copy')}
          </button>
          <a className="btn2 center" href={`https://wa.me/?text=${encodeURIComponent(share)}`} target="_blank" rel="noopener">
            {t('cust.whatsapp')}
          </a>
        </div>
      </div>
    </>
  )
}
