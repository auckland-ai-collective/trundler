/// <reference types="vite/client" />
import type { TrundlerApi } from '../preload/index.js'

declare global {
  interface Window {
    trundler: TrundlerApi
  }
}

export {}
