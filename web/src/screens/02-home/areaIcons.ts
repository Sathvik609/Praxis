import type { AreaKey } from '../../lib/areaSummary'

/** One stroke icon per affected area (designers' `AD_ICON`, 6 Oct artifact). */
export const AREA_ICON: Record<AreaKey, string> = {
  lShoulder: 'M7 20v-6l-3-3 4-6 4 2 5-3 3 2-6 5v11',
  lElbow: 'M5 4v8a4 4 0 0 0 4 4h8m-3-3 3 3-3 3',
  lWrist: 'M8 13V5.5a1.5 1.5 0 0 1 3 0V12m0-7.5v-1a1.5 1.5 0 0 1 3 0V12m0-6.5a1.5 1.5 0 0 1 3 0V13m-9-2.5a1.5 1.5 0 0 0-3 0V15a6 6 0 0 0 12 0v-2',
}
