import type { SectorKey } from '../core/types'
import type { CatalogItem } from './guzellik/catalog'

/** Bir sektör paketi: ortak çekirdeğe eklenen sektöre özel parçalar */
export interface SectorPackage {
  key: SectorKey
  /** Tema renkleri (açık ve koyu) — CSS değişkenlerine yazılır */
  theme: { light: Record<string, string>; dark: Record<string, string> }
  catalog: { category: string; items: CatalogItem[] }[]
  defaults: {
    dayCutoffHour: number
    openMin: number
    closeMin: number
    rooms: string[]
    /** [ürün, adet, en az] */
    stock: [string, number, number][]
  }
}
