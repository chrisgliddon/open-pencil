// Registry of image assets from the most recent Claude Design project import,
// keyed per editor store. The `place_asset` tool applies these images as
// fills by filename, so the conversion agent can use real project art without
// image bytes ever passing through the model context (same idea as the
// `stock_photo` tool, but sourced from the imported ZIP/folder).
import { BLACK } from '@open-pencil/core/constants'
import { fontManager } from '@open-pencil/core/text'
import { defineTool, type ToolDef } from '@open-pencil/core/tools'

import type { EditorStore } from '@/app/editor/active-store'

import type { ProjectFontFile } from './read-project'

export interface ImportAssetSource {
  /** Path relative to the imported project root, e.g. "assets-min/coin.png". */
  relativePath: string
  mimeType: string
  /** Raw bytes (ZIP imports — already decompressed in memory). */
  bytes?: Uint8Array
  /** Absolute file path (folder imports — read lazily via the Tauri fs API). */
  absolutePath?: string
}

type ImageScaleMode = 'FILL' | 'FIT' | 'CROP' | 'TILE'

const RASTER_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

const registries = new WeakMap<EditorStore, Map<string, ImportAssetSource>>()

function normalizeKey(name: string): string {
  return name.toLowerCase().replace(/^\.\//, '')
}

function basename(path: string): string {
  return path.split('/').pop() ?? path
}

/** Replace the store's registered import assets (called when a project is converted). */
export function registerImportAssets(store: EditorStore, sources: ImportAssetSource[]): void {
  const map = new Map<string, ImportAssetSource>()
  for (const source of sources) {
    map.set(normalizeKey(source.relativePath), source)
    const base = normalizeKey(basename(source.relativePath))
    if (!map.has(base)) map.set(base, source)
  }
  registries.set(store, map)
}

/**
 * Register the project's @font-face fonts with the shared font manager so
 * imported text renders with the real brand fonts (and the families appear
 * in the font picker as project fonts). Returns the registered family names.
 */
export async function registerImportFonts(fonts: ProjectFontFile[]): Promise<string[]> {
  const families: string[] = []
  for (const font of fonts) {
    if (!font.family) continue
    let bytes = font.bytes ?? null
    if (!bytes && font.absolutePath) {
      try {
        const { readFile } = await import('@tauri-apps/plugin-fs')
        bytes = await readFile(font.absolutePath)
      } catch {
        bytes = null
      }
    }
    if (!bytes) continue
    fontManager.registerProjectFont(font.family, bytes.slice().buffer)
    families.push(font.family)
  }
  return families
}

function lookupAsset(store: EditorStore, name: string): ImportAssetSource | null {
  const registry = registries.get(store)
  if (!registry) return null
  const key = normalizeKey(name)
  return registry.get(key) ?? registry.get(normalizeKey(basename(key))) ?? null
}

async function loadAssetBytes(source: ImportAssetSource): Promise<Uint8Array | null> {
  if (source.bytes) return source.bytes
  if (source.absolutePath) {
    try {
      const { readFile } = await import('@tauri-apps/plugin-fs')
      return await readFile(source.absolutePath)
    } catch {
      return null
    }
  }
  return null
}

interface PlacementRequest {
  id: string
  asset: string
  mode?: ImageScaleMode
}

function parsePlacements(raw: string): PlacementRequest[] | null {
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return null
    return parsed.filter(
      (entry): entry is PlacementRequest =>
        typeof entry === 'object' &&
        entry !== null &&
        typeof (entry as PlacementRequest).id === 'string' &&
        typeof (entry as PlacementRequest).asset === 'string'
    )
  } catch {
    return null
  }
}

/**
 * Build the `place_asset` tool bound to a store's registered import assets.
 * Registered alongside CORE_TOOLS for AI chat; returns a helpful error when
 * no project has been imported in this session.
 */
export function createPlaceAssetTool(store: EditorStore): ToolDef {
  return defineTool({
    name: 'place_asset',
    mutates: true,
    description:
      'Apply image assets from the imported project as image fills, by filename. Pass a JSON array — all placements applied in one call: [{"id":"0:12","asset":"assets-min/coin.png","mode":"FIT"}]. mode: FILL (default, crop to cover) | FIT (letterbox) | TILE. Raster only (png/jpg/webp/gif) — approximate SVG assets with shapes or an <Icon> instead.',
    params: {
      placements: {
        type: 'string',
        description: 'JSON array of {id, asset, mode?} placements',
        required: true
      }
    },
    execute: async (figma, { placements }) => {
      const registry = registries.get(store)
      if (!registry || registry.size === 0) {
        return {
          error:
            'No imported project assets are registered. This tool only works after importing a Claude Design project.'
        }
      }
      const requests = parsePlacements(placements)
      if (!requests || requests.length === 0) {
        return { error: 'placements must be a JSON array of {id, asset, mode?} objects' }
      }

      const results: Array<Record<string, unknown>> = []
      for (const request of requests) {
        const node = figma.getNodeById(request.id)
        if (!node) {
          results.push({ id: request.id, error: `Node "${request.id}" not found` })
          continue
        }
        const source = lookupAsset(store, request.asset)
        if (!source) {
          results.push({ id: request.id, error: `Asset "${request.asset}" not found in project` })
          continue
        }
        if (!RASTER_MIME_TYPES.has(source.mimeType)) {
          results.push({
            id: request.id,
            error: `Asset "${source.relativePath}" is ${source.mimeType} — only raster images can be placed as fills`
          })
          continue
        }
        const bytes = await loadAssetBytes(source)
        if (!bytes) {
          results.push({ id: request.id, error: `Could not read "${source.relativePath}"` })
          continue
        }
        const image = figma.createImage(bytes)
        const mode: ImageScaleMode = request.mode ?? 'FILL'
        node.fills = [
          {
            type: 'IMAGE',
            color: BLACK,
            opacity: 1,
            visible: true,
            imageHash: image.hash,
            imageScaleMode: mode
          }
        ]
        results.push({ id: request.id, asset: source.relativePath, scaleMode: mode })
      }
      return { results }
    }
  })
}
