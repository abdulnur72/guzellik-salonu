// Abonelik sona erdi ekranı: dükkânın aboneliği bitince ya da sahip
// "Durdur" deyince müşteri linkinde ve panelde bu ekran görünür.
// Kayıtlar silinmez; ödeme alınınca kendiliğinden açılır.

import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { api } from '../core/data/remote'
import { setLock, type LockInfo } from '../core/data/lock'
import { t } from '../i18n'
import { waLink } from '../ui/whatsapp'

/** Açık olup olmadığını sunucuya sorar; açıksa sayfa yeniden yüklenir */
async function stillLocked(slug: string | undefined) {
  try {
    if (slug) await api(`/api/public/b/${encodeURIComponent(slug)}`)
    else {
      location.reload()
      return true
    }
  } catch {
    return true
  }
  setLock(null)
  location.reload()
  return false
}

export function LockScreen({ info }: { info: LockInfo }) {
  const { pathname } = useLocation()
  const slug = pathname.match(/^\/[rs]\/([^/]+)/)?.[1]
  const customer = pathname.startsWith('/r/')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    // Ödeme alınınca ekran kendiliğinden açılsın (dakikada bir sorar)
    const id = setInterval(() => document.visibilityState === 'visible' && void stillLocked(slug), 60_000)
    return () => clearInterval(id)
  }, [slug])
  return (
    <div className="wrap narrow">
      <div className="card lockcard" role="alert">
        <h2>{customer ? t('lock.customerTitle') : t('lock.title')}</h2>
        {info.ad && <p style={{ margin: '0 0 8px' }}><b>{info.ad}</b></p>}
        <p className="mute">{customer ? t('lock.customerInfo') : t('lock.info')}</p>
        {!customer && info.wa && (
          <a className="go" style={{ display: 'block', textAlign: 'center', textDecoration: 'none' }} href={waLink(info.wa, t('lock.waText', { ad: info.ad }))} target="_blank" rel="noopener">
            {t('lock.wa')}
          </a>
        )}
        <button className="btn2 block" style={{ marginTop: 12 }} disabled={busy} onClick={async () => {
          setBusy(true)
          await stillLocked(slug)
          setBusy(false)
        }}>{t('common.retry')}</button>
      </div>
    </div>
  )
}
