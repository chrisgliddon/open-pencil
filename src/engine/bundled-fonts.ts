import { markFontLoaded, styleToWeight, IS_TAURI } from '@open-pencil/core'

/**
 * Fonts shipped inside the desktop binary, defined by
 * `desktop/resources/fonts/manifest.json` and registered at app
 * startup. Solves the "design opens with system fallback when the
 * collaborator doesn't have my font" problem at the cost of ~1 MB
 * binary growth.
 */
interface BundledFontEntry {
  family: string
  file: string
  style: string
  weight: number
  variable_axes?: string[]
  license: string
  license_file: string
  category: string
}

interface BundledFontsManifest {
  fonts: BundledFontEntry[]
}

let cache: BundledFontEntry[] | null = null
let promise: Promise<BundledFontEntry[]> | null = null

async function loadManifest(): Promise<BundledFontsManifest | null> {
  const { resolveResource } = await import('@tauri-apps/api/path')
  const { readFile, readTextFile } = await import('@tauri-apps/plugin-fs')

  let manifestPath: string
  try {
    manifestPath = await resolveResource('resources/fonts/manifest.json')
  } catch {
    return null
  }
  let raw: string
  try {
    raw = await readTextFile(manifestPath)
  } catch {
    // Fallback: some Tauri builds need readFile + manual decode
    try {
      const bytes = await readFile(manifestPath)
      raw = new TextDecoder('utf-8').decode(bytes)
    } catch {
      return null
    }
  }
  try {
    return JSON.parse(raw) as BundledFontsManifest
  } catch {
    return null
  }
}

async function loadAndRegister(entry: BundledFontEntry): Promise<void> {
  const { resolveResource } = await import('@tauri-apps/api/path')
  const { readFile } = await import('@tauri-apps/plugin-fs')

  let path: string
  try {
    path = await resolveResource(`resources/fonts/${entry.file}`)
  } catch {
    return
  }

  let bytes: Uint8Array
  try {
    bytes = await readFile(path)
  } catch {
    return
  }
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  ) as ArrayBuffer

  // Register with the canvas renderer (Skia) so text nodes can render.
  markFontLoaded(entry.family, entry.style, buffer)

  // Register with the WebView so DOM-rendered text (Properties panel
  // previews, etc.) can use it too.
  if (typeof document !== 'undefined') {
    try {
      const weight = styleToWeight(entry.style)
      const italic = entry.style.toLowerCase().includes('italic') ? 'italic' : 'normal'
      const face = new FontFace(entry.family, buffer, {
        weight: String(weight),
        style: italic
      })
      await face.load()
      document.fonts.add(face)
    } catch (e) {
      // Non-fatal: even if the WebView doesn't accept this exact face,
      // the canvas renderer still has the bytes via markFontLoaded.
      console.warn(`[bundled-fonts] FontFace registration failed for ${entry.family}:`, e)
    }
  }
}

/**
 * Read the manifest, load every bundled font in parallel, register
 * each with both the canvas renderer (markFontLoaded) and the
 * WebView's CSS font registry (FontFace API). Caches the manifest so
 * subsequent calls return immediately.
 *
 * Safe to call repeatedly. Safe to call in non-Tauri runtimes (no-op).
 */
export async function loadBundledFonts(): Promise<BundledFontEntry[]> {
  if (!IS_TAURI) return []
  if (cache) return cache
  if (promise) return promise

  promise = (async () => {
    const manifest = await loadManifest()
    if (!manifest) {
      cache = []
      return cache
    }
    await Promise.all(manifest.fonts.map(loadAndRegister))
    cache = manifest.fonts
    return cache
  })()

  return promise
}

/** Family names of bundled fonts, available synchronously after loadBundledFonts() resolves. */
export function bundledFontFamilies(): string[] {
  if (!cache) return []
  return Array.from(new Set(cache.map((f) => f.family))).sort((a, b) => a.localeCompare(b))
}
