import type { SectorKey } from '../core/types'
import type { SectorPackage } from './types'
import { guzellik } from './guzellik'

// Bayan kuaför, berber ve spor salonu paketleri sırayla buraya eklenecek.
const SECTORS: Partial<Record<SectorKey, SectorPackage>> = { guzellik }

export function sector(key: SectorKey): SectorPackage {
  return SECTORS[key] ?? guzellik
}

export function applyTheme(pkg: SectorPackage) {
  const css = (vars: Record<string, string>) =>
    Object.entries(vars).map(([k, v]) => `--${k}:${v}`).join(';')
  let el = document.getElementById('sector-theme') as HTMLStyleElement | null
  if (!el) {
    el = document.createElement('style')
    el.id = 'sector-theme'
    document.head.appendChild(el)
  }
  el.textContent =
    `:root{${css(pkg.theme.light)}}` +
    `@media (prefers-color-scheme:dark){:root{${css(pkg.theme.dark)};color-scheme:dark}}`
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', pkg.theme.light.acc)
}
