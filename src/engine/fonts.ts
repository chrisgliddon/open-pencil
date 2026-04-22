import {
  IS_TAURI,
  loadFont as loadFontCore,
  markFontLoaded,
  styleToWeight
} from '@open-pencil/core'

import { downloadGoogleFont, getGoogleFontCatalog, loadGoogleFont } from './google-fonts'

interface TauriFontFamily {
  family: string
  styles: string[]
}

let tauriFontsCache: TauriFontFamily[] | null = null

let tauriFontsPromise: Promise<TauriFontFamily[]> | null = null

async function getTauriFonts(): Promise<TauriFontFamily[]> {
  if (tauriFontsCache) return tauriFontsCache
  if (!tauriFontsPromise) {
    tauriFontsPromise = import('@tauri-apps/api/core')
      .then(({ invoke }) => invoke<TauriFontFamily[]>('list_system_fonts'))
      .then((fonts) => {
        tauriFontsCache = fonts
        return fonts
      })
      .catch(() => [])
  }
  return tauriFontsPromise
}

export function preloadFonts(): void {
  if (IS_TAURI) {
    void getTauriFonts().then(registerFontFaces)
  }
}

function registerFontFaces(fonts: TauriFontFamily[]): void {
  if (typeof document === 'undefined') return
  for (const { family } of fonts) {
    const face = new FontFace(family, `local("${family}")`)
    document.fonts.add(face)
  }
}

export async function listFamilies(): Promise<string[]> {
  let base: string[] = []

  if (IS_TAURI) {
    const fonts = await getTauriFonts()
    base = fonts.map((f) => f.family)
  } else {
    const { listFamilies: coreList } = await import('@open-pencil/core')
    base = await coreList()
  }

  // Merge cached / known Google Fonts so they appear in the picker
  // without awaiting the network catalog fetch.
  try {
    const catalog = await getGoogleFontCatalog()
    const merged = new Set(base)
    for (const entry of catalog) merged.add(entry.family)
    return [...merged].sort()
  } catch {
    return base
  }
}

export async function listGoogleFamilies(): Promise<string[]> {
  try {
    const catalog = await getGoogleFontCatalog()
    return catalog.map((e) => e.family).sort()
  } catch {
    return []
  }
}

export async function loadFont(family: string, style = 'Regular'): Promise<ArrayBuffer | null> {
  if (IS_TAURI) {
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      const data = await invoke<number[]>('load_system_font', { family, style })
      const buffer = new Uint8Array(data).buffer

      markFontLoaded(family, style, buffer)

      const weight = styleToWeight(style)
      const italic = style.toLowerCase().includes('italic') ? 'italic' : 'normal'
      const face = new FontFace(family, buffer, { weight: String(weight), style: italic })
      await face.load()
      document.fonts.add(face)

      return buffer
    } catch (e) {
      console.warn('Tauri system font load failed:', e)
      // fall through to core loader (handles Google Fonts + bundled)
    }
  }

  const coreBuffer = await loadFontCore(family, style)
  if (coreBuffer) return coreBuffer

  // Attempt to fetch from Google Fonts as a last resort
  const loaded = await loadGoogleFont(family, style)
  if (!loaded) return null

  // After successful Google Font load, retrieve bytes from cache for renderer
  const bytes = await downloadGoogleFont(family, style)
  if (!bytes) return null
  markFontLoaded(family, style, bytes.buffer as ArrayBuffer)
  return bytes.buffer as ArrayBuffer
}
