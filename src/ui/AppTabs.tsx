// Uygulamanın üst sekmeleri: Yönetici, Personel, Randevu, İşletme, Müşteri.
// Salon paneli (/s/:slug) ve sahip paneli (/sahip) aynı sekme çubuğunu kullanır.
// Müşteri linkinde (/r/:slug) bu çubuk hiç gösterilmez.

import { t, type MessageKey } from '../i18n'

export type AppTab = 'manager' | 'staff' | 'appointments' | 'business' | 'customer'

export const APP_TABS: [AppTab, MessageKey][] = [
  ['manager', 'tab.manager'],
  ['staff', 'tab.staff'],
  ['appointments', 'tab.appointments'],
  ['business', 'tab.business'],
  ['customer', 'tab.customer'],
]

export const isAppTab = (v: string | null): v is AppTab => APP_TABS.some(([k]) => k === v)

export function AppTabs({ active, onPick }: { active: AppTab; onPick: (tab: AppTab) => void }) {
  return (
    <nav className="tabs" role="group" aria-label="Görünüm">
      {APP_TABS.map(([k, label]) => (
        <button key={k} aria-pressed={active === k} onClick={() => onPick(k)}>
          {t(label)}
        </button>
      ))}
    </nav>
  )
}

const LAST_SLUG = 'salon-last-slug'

/** Son açılan şube: sahip panelinden diğer sekmelere dönerken kullanılır. */
export function rememberSlug(slug: string) {
  try {
    localStorage.setItem(LAST_SLUG, slug)
  } catch {
    /* yok say */
  }
}

export function lastSlug(): string | null {
  try {
    return localStorage.getItem(LAST_SLUG)
  } catch {
    return null
  }
}
