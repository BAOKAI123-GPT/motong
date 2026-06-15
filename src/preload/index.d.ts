import type { WenshuApi } from './index'

declare global {
  interface Window {
    api: WenshuApi
  }
}

export {}
