import type { SectorPackage } from '../types'
import { CATALOG } from './catalog'

export const guzellik: SectorPackage = {
  key: 'guzellik',
  theme: {
    light: {
      bg: '#FBF4F6', card: '#fff', ink: '#2B1330', mute: '#7B6680', line: '#E4D2DD',
      acc: '#B83A74', on: '#fff', seg: '#F6E7EE', edge: '#DDB0C6', ok: '#3E8E74', bad: '#C0443B',
    },
    dark: {
      bg: '#1B0F1E', card: '#2A1A2E', ink: '#F6E9F1', mute: '#B79FBE', line: '#4A3350',
      acc: '#E26AA0', on: '#2d0b18', seg: '#3A2540', edge: '#7A4A6C', ok: '#6CC2A4', bad: '#F08077',
    },
  },
  catalog: CATALOG,
  defaults: {
    dayCutoffHour: 4,
    openMin: 9 * 60,
    closeMin: 20 * 60,
    rooms: ['Oda 1', 'Oda 2', 'Lazer cihazı', 'Cilt bakım odası', 'Makyaj köşesi'],
    stock: [
      ['Kalıcı oje', 12, 4],
      ['Jel / protez tırnak malzemesi', 8, 3],
      ['Ağda (kutu)', 6, 3],
      ['Kirpik seti', 10, 4],
      ['Cilt bakım serumu', 5, 2],
      ['Tek kullanımlık havlu', 60, 20],
    ],
  },
}
