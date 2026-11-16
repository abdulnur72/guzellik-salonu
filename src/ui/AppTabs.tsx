// Uygulamanın alt sekme çubuğu: Yönetici, Personel, Randevu, İşletme, Müşteri.
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

const ICON_PATHS: Record<AppTab, React.ReactNode> = {
  // Yönetici: yükselen grafik
  manager: (
    <>
      <path d="M4 20h16" />
      <path d="M7 16v-4M12 16V8M17 16v-7" />
    </>
  ),
  // Personel: iki kişi
  staff: (
    <>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 19c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5" />
      <circle cx="17" cy="9" r="2.5" />
      <path d="M16 14.2c2.4.1 4 1.7 4.5 4.3" />
    </>
  ),
  // Randevu: takvim
  appointments: (
    <>
      <rect x="3.5" y="5" width="17" height="15" rx="2.5" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
      <path d="M8 14h3" />
    </>
  ),
  // İşletme: mağaza
  business: (
    <>
      <path d="M4 10v10h16V10" />
      <path d="M3 10l2-6h14l2 6c0 1.4-1.1 2.4-2.5 2.4S16 11.4 16 10c0 1.4-1.1 2.4-2.5 2.4S11 11.4 11 10c0 1.4-1.1 2.4-2.5 2.4S6 11.4 6 10c0 1.4-.9 2.4-1.8 2.4" />
      <path d="M10 20v-4.5h4V20" />
    </>
  ),
  // Müşteri: kişi ve kalp
  customer: (
    <>
      <circle cx="10" cy="8" r="3.4" />
      <path d="M3.5 20c.7-3.6 3.2-5.6 6.5-5.6 1.2 0 2.3.3 3.2.8" />
      <path d="M18 20.5s-3.5-2-3.5-4.4c0-1.1.8-1.9 1.8-1.9.7 0 1.3.4 1.7 1 .4-.6 1-1 1.7-1 1 0 1.8.8 1.8 1.9 0 2.4-3.5 4.4-3.5 4.4z" />
    </>
  ),
}

function TabIcon({ tab }: { tab: AppTab }) {
  return (
    <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICON_PATHS[tab]}
    </svg>
  )
}

/** Ekranın en altında sabit duran, ikonlu sekme çubuğu (telefon uygulaması gibi). */
export function AppTabs({ active, onPick }: { active: AppTab; onPick: (tab: AppTab) => void }) {
  return (
    <nav className="tabbar" aria-label="Bölümler">
      {APP_TABS.map(([k, label]) => (
        <button key={k} aria-current={active === k ? 'page' : undefined} aria-pressed={active === k} onClick={() => { onPick(k); window.scrollTo({ top: 0 }) }}>
          <TabIcon tab={k} />
          <span>{t(label)}</span>
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
