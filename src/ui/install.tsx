// Ana ekrana ekleme (PWA). Android/Chrome'da tarayıcının kurulum penceresini
// açan bir buton, iPhone'da Paylaş > Ana Ekrana Ekle ipucu gösterir.

import { useEffect, useState } from 'react'
import { t } from '../i18n'

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

// Olay sayfa açılır açılmaz gelebilir; bileşen sonra yüklense de kaçmasın.
let deferred: InstallPromptEvent | null = null
const listeners = new Set<() => void>()
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    deferred = e as InstallPromptEvent
    listeners.forEach((f) => f())
  })
  window.addEventListener('appinstalled', () => {
    deferred = null
    listeners.forEach((f) => f())
  })
}

const HIDE_KEY = 'salon-install-hidden'
const isStandalone = () =>
  window.matchMedia?.('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent)

export function InstallCard() {
  const [, force] = useState(0)
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem(HIDE_KEY) === '1'
    } catch {
      return false
    }
  })
  useEffect(() => {
    const f = () => force((n) => n + 1)
    listeners.add(f)
    return () => void listeners.delete(f)
  }, [])

  if (hidden || isStandalone() || (!deferred && !isIos())) return null
  const hide = () => {
    setHidden(true)
    try {
      localStorage.setItem(HIDE_KEY, '1')
    } catch {
      /* yok say */
    }
  }
  return (
    <div className="card install">
      <h2>{t('install.title')}</h2>
      <p className="mute" style={{ margin: 0 }}>{deferred ? t('install.info') : t('install.ios')}</p>
      <div className="row" style={{ marginTop: 12 }}>
        {deferred && (
          <button
            className="go"
            style={{ marginTop: 0 }}
            onClick={async () => {
              const ev = deferred
              if (!ev) return
              await ev.prompt()
              await ev.userChoice.catch(() => undefined)
              deferred = null
              force((n) => n + 1)
            }}
          >
            {t('install.button')}
          </button>
        )}
        <button className="btn2" style={{ flex: 'none' }} onClick={hide}>
          {t('install.later')}
        </button>
      </div>
    </div>
  )
}

/**
 * Müşteri randevu sayfasında ana ekrana eklenen kısayol salon paneline değil,
 * yine bu randevu sayfasına açılsın diye sayfaya özel bir manifest verir.
 */
export function useBookingManifest(slug: string, name: string) {
  useEffect(() => {
    const link = document.querySelector<HTMLLinkElement>('link[rel="manifest"]')
    if (!link) return
    const old = link.href
    const base = `${location.origin}/r/${encodeURIComponent(slug)}`
    const manifest = {
      name,
      short_name: name,
      lang: 'tr',
      start_url: base,
      scope: base,
      display: 'standalone',
      background_color: '#FBF4F6',
      theme_color: '#B83A74',
      icons: [{ src: `${location.origin}/icon.svg`, sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }],
    }
    link.href = 'data:application/manifest+json,' + encodeURIComponent(JSON.stringify(manifest))
    return () => {
      link.href = old
    }
  }, [slug, name])
}
