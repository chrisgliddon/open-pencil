// Reads a "Claude Design project" — a folder (or zip) of React/JSX components,
// CSS, and image assets produced by a Claude Design skill — and builds a
// manifest the LLM converter can turn into OpenPencil scene nodes.
//
// A project is recognised by containing .jsx/.tsx component files plus
// optional .css and an assets/ folder. The App.jsx (or index.jsx) is the
// screen router; each screen component becomes a candidate OpenPencil page.

export interface ProjectFile {
  /** Path relative to the project root, e.g. "ppw-ui/HUD.jsx". */
  relativePath: string
  /** Absolute filesystem path (Tauri only). */
  absolutePath: string
  /** File size in bytes. */
  size: number
}

export interface ScreenFile extends ProjectFile {
  /** Component display name, e.g. "HUD" from "HUD.jsx". */
  componentName: string
  /** Source text (truncated to MAX_SOURCE_BYTES). */
  source: string
  /** Whether the source was truncated. */
  truncated: boolean
}

export interface CssFile extends ProjectFile {
  source: string
}

export interface AssetFile extends ProjectFile {
  /** Detected MIME type from the extension. */
  mimeType: string
}

export interface ProjectManifest {
  /** Absolute path to the project root, or the zip path. */
  rootPath: string
  /** Project name (folder/file basename). */
  name: string
  /** Screen components, sorted by name. */
  screens: ScreenFile[]
  /** CSS files (colors_and_type.css, hud.css, …), deduped by content. */
  css: CssFile[]
  /** Image assets (png/svg/webp/jpg) — listed, not inlined. */
  assets: AssetFile[]
  /** The App/index router file if present (source included). */
  app?: ScreenFile
  /** Raw README/SKILL text if present, for brand context. */
  readme?: string
}

const MAX_SOURCE_BYTES = 64_000
const MAX_FILES = 200
const MAX_ASSETS = 120

const JSX_EXTENSIONS = ['.jsx', '.tsx'] as const
const CSS_EXTENSIONS = ['.css'] as const
const ASSET_EXTENSIONS = ['.png', '.svg', '.webp', '.jpg', '.jpeg', '.gif'] as const
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.DS_Store', 'assets-min'])

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif'
}

function basename(path: string): string {
  return path.split('/').pop() ?? path
}

function extname(path: string): string {
  const base = basename(path)
  const dot = base.lastIndexOf('.')
  return dot !== -1 ? base.slice(dot).toLowerCase() : ''
}

function componentNameFor(file: string): string {
  const base = basename(file)
  return base.replace(/\.[^.]+$/, '')
}

function shouldSkipDir(name: string): boolean {
  return SKIP_DIRS.has(name) || name.startsWith('.')
}

async function readTextFile(absolutePath: string): Promise<string> {
  const { readTextFile } = await import('@tauri-apps/plugin-fs')
  return readTextFile(absolutePath)
}

// Walk a directory recursively (Tauri), collecting project files. readDir is
// non-recursive, so we descend manually, skipping noise directories.
async function walkDir(
  absolutePath: string,
  relativePath: string,
  files: ProjectFile[],
  budget: { count: number }
): Promise<void> {
  if (budget.count >= MAX_FILES) return
  const { readDir } = await import('@tauri-apps/plugin-fs')
  let entries
  try {
    entries = await readDir(absolutePath)
  } catch {
    return
  }
  for (const entry of entries) {
    if (budget.count >= MAX_FILES) return
    const childAbs = `${absolutePath}/${entry.name}`
    const childRel = relativePath ? `${relativePath}/${entry.name}` : entry.name
    if (entry.isDirectory) {
      if (shouldSkipDir(entry.name)) continue
      await walkDir(childAbs, childRel, files, budget)
    } else if (entry.isFile) {
      files.push({ relativePath: childRel, absolutePath: childAbs, size: 0 })
      budget.count++
    }
  }
}

function truncate(source: string): { text: string; truncated: boolean } {
  if (source.length <= MAX_SOURCE_BYTES) return { text: source, truncated: false }
  return {
    text: `${source.slice(0, MAX_SOURCE_BYTES)}\n\n/* …truncated (${source.length - MAX_SOURCE_BYTES} more bytes)… */`,
    truncated: true
  }
}

async function buildManifestFromFiles(
  rootPath: string,
  name: string,
  files: ProjectFile[]
): Promise<ProjectManifest> {
  const screens: ScreenFile[] = []
  const css: CssFile[] = []
  const assets: AssetFile[] = []
  let app: ScreenFile | undefined
  let readme: string | undefined
  const seenCss = new Set<string>()

  for (const file of files) {
    const ext = extname(file.relativePath)
    if (JSX_EXTENSIONS.includes(ext as (typeof JSX_EXTENSIONS)[number])) {
      const source = await readTextFile(file.absolutePath).catch(() => '')
      const { text, truncated } = truncate(source)
      const screen: ScreenFile = {
        ...file,
        componentName: componentNameFor(file.relativePath),
        source: text,
        truncated
      }
      const base = basename(file.relativePath)
      if (/^(App|index|main)\.(jsx|tsx)$/i.test(base)) {
        app = screen
      } else {
        screens.push(screen)
      }
    } else if (CSS_EXTENSIONS.includes(ext as (typeof CSS_EXTENSIONS)[number])) {
      const source = await readTextFile(file.absolutePath).catch(() => '')
      if (seenCss.has(source)) continue
      seenCss.add(source)
      css.push({ ...file, source })
    } else if (ASSET_EXTENSIONS.includes(ext as (typeof ASSET_EXTENSIONS)[number])) {
      if (assets.length >= MAX_ASSETS) continue
      assets.push({ ...file, mimeType: MIME_BY_EXT[ext] ?? 'application/octet-stream' })
    } else if (/^readme\.md$/i.test(basename(file.relativePath))) {
      readme = await readTextFile(file.absolutePath).catch(() => undefined)
    }
  }

  screens.sort((a, b) => a.componentName.localeCompare(b.componentName))

  return { rootPath, name, screens, css, assets, app, readme }
}

/** Pick a project folder via the Tauri directory dialog. Returns null if cancelled. */
export async function pickProjectFolder(): Promise<string | null> {
  const { open } = await import('@tauri-apps/plugin-dialog')
  const result = await open({ directory: true, multiple: false })
  return typeof result === 'string' ? result : null
}

/** Read a project folder into a manifest. Tauri only. */
export async function readProjectFolder(folderPath: string): Promise<ProjectManifest> {
  const files: ProjectFile[] = []
  await walkDir(folderPath, '', files, { count: 0 })
  const name = basename(folderPath)
  return buildManifestFromFiles(folderPath, name, files)
}

/**
 * Read a .zip project into a manifest. The zip is unzipped in memory with
 * fflate; file contents come from the archive, not the filesystem (absolute
 * paths are synthetic). Browser + Tauri.
 */
export async function readProjectZip(file: File): Promise<ProjectManifest> {
  const { unzipSync, strFromU8 } = await import('fflate')
  const bytes = new Uint8Array(await file.arrayBuffer())
  const entries = unzipSync(bytes, { filter: (entry) => !entry.name.endsWith('/') })
  const files: ProjectFile[] = []
  const contents = new Map<string, Uint8Array>()
  let rootPrefix = ''
  const topDirs = new Set<string>()
  for (const name of Object.keys(entries)) {
    const clean = name.replace(/^\.\//, '')
    const top = clean.split('/')[0] ?? clean
    if (SKIP_DIRS.has(top)) continue
    const data = entries[name]
    files.push({ relativePath: clean, absolutePath: clean, size: data.length })
    contents.set(clean, data)
    if (clean.includes('/')) topDirs.add(top)
  }
  if (topDirs.size === 1) rootPrefix = `${[...topDirs][0] ?? ''}/`

  // Strip the common root so paths are relative to the project root.
  const normalized = files.map((f) => ({
    ...f,
    relativePath: rootPrefix && f.relativePath.startsWith(rootPrefix)
      ? f.relativePath.slice(rootPrefix.length)
      : f.relativePath
  }))

  const manifest = await buildManifestFromFiles(file.name, file.name.replace(/\.zip$/i, ''), normalized)
  // Fill in sources from the in-memory archive (buildManifestFromFiles reads
  // via the Tauri fs API, which won't find synthetic paths; override here).
  for (const screen of manifest.screens) {
    const data = contents.get(screen.relativePath) ?? contents.get(`${rootPrefix}${screen.relativePath}`)
    if (data) {
      const { text, truncated } = truncate(strFromU8(data))
      screen.source = text
      screen.truncated = truncated
    }
  }
  if (manifest.app) {
    const data = contents.get(manifest.app.relativePath) ?? contents.get(`${rootPrefix}${manifest.app.relativePath}`)
    if (data) {
      const { text, truncated } = truncate(strFromU8(data))
      manifest.app.source = text
      manifest.app.truncated = truncated
    }
  }
  for (const css of manifest.css) {
    const data = contents.get(css.relativePath) ?? contents.get(`${rootPrefix}${css.relativePath}`)
    if (data) css.source = strFromU8(data)
  }
  return manifest
}