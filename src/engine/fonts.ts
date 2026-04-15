import {
  IS_TAURI,
  loadFont as loadFontCore,
  markFontLoaded,
  styleToWeight
} from '@open-pencil/core'

import { bundledFontFamilies, loadBundledFonts } from './bundled-fonts'

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
    // Bundled fonts ship inside the binary and are loaded immediately
    // so designs using them render correctly even on a fresh machine
    // without those fonts installed at the OS level.
    void loadBundledFonts()
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
  if (IS_TAURI) {
    // Ensure bundled fonts have finished loading so they appear in the
    // returned list even if a caller invokes listFamilies() before the
    // preload promise resolves.
    await loadBundledFonts()
    const [systemFonts, bundled] = await Promise.all([
      getTauriFonts(),
      Promise.resolve(bundledFontFamilies())
    ])
    const merged = new Set<string>(bundled)
    for (const f of systemFonts) merged.add(f.family)
    return Array.from(merged).sort((a, b) => a.localeCompare(b))
  }

  const { listFamilies: coreList } = await import('@open-pencil/core')
  return coreList()
}

export async function loadFont(family: string, style = 'Regular'): Promise<ArrayBuffer | null> {
  if (IS_TAURI) {
    // Short-circuit for bundled fonts: their bytes are already in the
    // core renderer cache via markFontLoaded(), so loadFontCore returns
    // them without round-tripping Tauri's font-kit lookup (which would
    // fail anyway because bundled fonts aren't installed at the OS level).
    await loadBundledFonts()
    if (bundledFontFamilies().includes(family)) {
      return loadFontCore(family, style)
    }

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
    } catch {
      return loadFontCore(family, style)
    }
  }

  return loadFontCore(family, style)
}
