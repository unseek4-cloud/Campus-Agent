import { defineComponent, h } from 'vue'

// A compact, consistent outline icon set for the admin workspace.
const paths: Record<string, string[]> = {
  DataBoard: ['M3 3h7v7H3z','M14 3h7v7h-7z','M3 14h7v7H3z','M14 14h7v7h-7z'],
  Files: ['M6 3h9l4 4v14H6z','M14 3v5h5','M9 12h7','M9 16h7'],
  Fold: ['M4 5h16','M4 12h10','M4 19h16','m17 9-3 3 3 3'],
  Expand: ['M4 5h16','M10 12h10','M4 19h16','m7 9 3 3-3 3'],
  School: ['M3 10 12 4l9 6','M5 9v11h14V9','M9 20v-7h6v7','M3 20h18'],
  MoreFilled: ['M5 12h.01','M12 12h.01','M19 12h.01'],
  UploadFilled: ['M12 16V4','m7 9 5-5 5 5','M4 16v4h16v-4'],
  Close: ['M5 5l14 14','M19 5 5 19'],
  ArrowRight: ['M4 12h16','m14 6 6 6-6 6'],
  DocumentAdd: ['M6 3h8l5 5v13H6z','M14 3v5h5','M9 15h7','M12.5 11.5v7'],
  CircleCheck: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z','m7 12 3 3 7-7'],
  Loading: ['M12 2a10 10 0 1 0 10 10'],
  CircleClose: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z','m8 8 8 8','m16 8-8 8'],
  Collection: ['M4 5h16v14H4z','M8 3v4','M16 3v4','M8 11h8','M8 15h6'],
  Search: ['M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z','m17 17 5 5'],
  Refresh: ['M20 11a8 8 0 1 0-2 6','m20 5v6h-6'],
}
function icon(name: keyof typeof paths) {
  return defineComponent({ name, setup: () => () => h('svg', {
    viewBox: '0 0 24 24', width: '1em', height: '1em', fill: 'none', stroke: 'currentColor',
    'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true',
  }, paths[name].map(d => h('path', { d }))) })
}
export const DataBoard=icon('DataBoard'), Files=icon('Files'), Fold=icon('Fold'), Expand=icon('Expand'), School=icon('School')
export const MoreFilled=icon('MoreFilled'), UploadFilled=icon('UploadFilled'), Close=icon('Close'), ArrowRight=icon('ArrowRight')
export const DocumentAdd=icon('DocumentAdd'), CircleCheck=icon('CircleCheck'), Loading=icon('Loading'), CircleClose=icon('CircleClose')
export const Collection=icon('Collection'), Search=icon('Search'), Refresh=icon('Refresh')
