import { defineComponent, h } from 'vue'

function icon(name: string, paths: string[]) {
  return defineComponent({
    name,
    inheritAttrs: false,
    setup(_, { attrs }) {
      return () => h('svg', { ...attrs, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' }, paths.map(path => h('path', { d: path })))
    },
  })
}

export const SkipBackIcon = icon('SkipBackIcon', ['M19 20V4', 'M5 18V6a2 2 0 0 1 3.1-1.7l8.7 6a2 2 0 0 1 0 3.4l-8.7 6A2 2 0 0 1 5 18Z'])
export const PlayIcon = icon('PlayIcon', ['M5 5a2 2 0 0 1 3-1.7l12 7a2 2 0 0 1 0 3.4l-12 7A2 2 0 0 1 5 19Z'])
export const PauseIcon = icon('PauseIcon', ['M6 4h4v16H6z', 'M14 4h4v16h-4z'])
export const SkipForwardIcon = icon('SkipForwardIcon', ['M5 4v16', 'M19 18V6a2 2 0 0 0-3.1-1.7l-8.7 6a2 2 0 0 0 0 3.4l8.7 6A2 2 0 0 0 19 18Z'])
export const VolumeIcon = icon('VolumeIcon', ['M4 9v6h4l5 4V5L8 9H4Z', 'M16.5 8.5a5 5 0 0 1 0 7', 'M19 5a9 9 0 0 1 0 14'])
export const WindowRestoreIcon = icon('WindowRestoreIcon', ['M8 8h12v12H8V8Z', 'M4 4h10v4', 'M4 4v10h4'])
