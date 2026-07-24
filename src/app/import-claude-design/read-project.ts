// Reads a "Claude Design project" — a folder (or zip) of React/JSX components,
// CSS, and image assets produced by a Claude Design skill — and builds a
// manifest the LLM converter can turn into OpenPencil scene nodes.
//
// Anatomy of a Claude Design export:
//   App.jsx / index.jsx        screen router — its cases enumerate the screens
//   *.jsx / *.tsx              screen + shared components
//   *.css                      per-feature stylesheets
//   *.data.js                  static data sidecars (representative content)
//   _ds/<name>/                design system: README, _ds_manifest.json card
//                              index, colors_and_type.css tokens, fonts, kits
//   assets-min/                optimized UI image assets (the canonical set)
//   uploads/                   raw user uploads — reference art, not UI assets
//   screenshots/               screen captures — visual ground truth
//   *.html, .thumbnail, fonts  bundles/previews — skipped entirely

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
  /** Raw bytes (ZIP imports) so assets can be placed as real image fills. */
  bytes?: Uint8Array
}

export interface ProjectFontFile extends ProjectFile {
  /** Family name from the project's @font-face rule, when found. */
  family?: string
  /** Raw bytes (ZIP imports) so the font can be registered for rendering. */
  bytes?: Uint8Array
}

export interface DesignSystemInfo {
  /** Design-system folder name under _ds/. */
  name: string
  /** README.md excerpt — brand and product context. */
  readme?: string
  /** One line per _ds_manifest.json card: "Group / Name — subtitle". */
  cards: string[]
}

export interface ProjectManifest {
  /** Absolute path to the project root, or the zip path. */
  rootPath: string
  /** Project name (folder/file basename). */
  name: string
  /** Screen components, sorted by name. */
  screens: ScreenFile[]
  /** CSS files, deduped by content; design-token CSS sorted first. */
  css: CssFile[]
  /** UI image assets (png/svg/webp/jpg) — placeable via `place_asset`. */
  assets: AssetFile[]
  /** The App/index router file if present (source included). */
  app?: ScreenFile
  /** Raw README/SKILL text if present, for brand context. */
  readme?: string
  /** Static data sidecars (*.data.js) with truncated source. */
  dataFiles: CssFile[]
  /** screenshots/ capture paths — visual ground truth, listed only. */
  screenshots: string[]
  /** uploads/ raw reference files — listed only, not UI assets. */
  uploads: string[]
  /** Font files shipped with the project, mapped to @font-face families. */
  fonts: ProjectFontFile[]
  /** Parsed _ds/ design system, when present. */
  designSystem?: DesignSystemInfo
}

const MAX_SOURCE_BYTES = 64_000
const MAX_FILES = 500
const MAX_ASSETS = 160
const MAX_DATA_FILES = 6
const MAX_DATA_BYTES = 6_000
const MAX_README_BYTES = 8_000
/** ZIP entries above this are bundles (e.g. offline HTML) — never decompressed. */
const MAX_ZIP_ENTRY_BYTES = 2_000_000
/** Fonts get a higher cap — CJK TTFs routinely exceed the general limit. */
const MAX_FONT_BYTES = 24_000_000

const JSX_EXTENSIONS = ['.jsx', '.tsx'] as const
const CSS_EXTENSIONS = ['.css'] as const
const ASSET_EXTENSIONS = ['.png', '.svg', '.webp', '.jpg', '.jpeg', '.gif'] as const
const FONT_EXTENSIONS = ['.ttf', '.otf', '.woff', '.woff2'] as const
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build'])
/** Bundles and binaries that are never useful to the converter. */
const SKIP_EXTENSIONS = new Set(['.html', '.pdf', '.zip'])

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

function shouldSkipFile(relativePath: string): boolean {
  const base = basename(relativePath)
  return base.startsWith('.') || SKIP_EXTENSIONS.has(extname(relativePath))
}

function isImage(relativePath: string): boolean {
  return ASSET_EXTENSIONS.includes(extname(relativePath) as (typeof ASSET_EXTENSIONS)[number])
}

function isFont(relativePath: string): boolean {
  return FONT_EXTENSIONS.includes(extname(relativePath) as (typeof FONT_EXTENSIONS)[number])
}

function pathSegments(relativePath: string): string[] {
  return relativePath.split('/')
}

function decodeEntities(text: string): string {
  return text
    .replaceAll('&amp;', '&')
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
}

async function tauriReadTextFile(absolutePath: string): Promise<string> {
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
      if (shouldSkipFile(childRel)) continue
      files.push({ relativePath: childRel, absolutePath: childAbs, size: 0 })
      budget.count++
    }
  }
}

function truncate(source: string, limit = MAX_SOURCE_BYTES): { text: string; truncated: boolean } {
  if (source.length <= limit) return { text: source, truncated: false }
  return {
    text: `${source.slice(0, limit)}\n\n/* …truncated (${source.length - limit} more bytes)… */`,
    truncated: true
  }
}

interface ManifestCard {
  name?: string
  group?: string
  subtitle?: string
  viewport?: string
}

function parseDesignSystemCards(manifestJson: string): string[] {
  try {
    const parsed: unknown = JSON.parse(manifestJson)
    if (typeof parsed !== 'object' || parsed === null) return []
    const cards = (parsed as { cards?: unknown }).cards
    if (!Array.isArray(cards)) return []
    return cards
      .filter((card): card is ManifestCard => typeof card === 'object' && card !== null)
      .map((card) => {
        const name = decodeEntities(String(card.name ?? 'Untitled'))
        const group = card.group ? `${decodeEntities(String(card.group))} / ` : ''
        const subtitle = card.subtitle ? ` — ${decodeEntities(String(card.subtitle))}` : ''
        return `${group}${name}${subtitle}`
      })
  } catch {
    return []
  }
}

type ReadText = (file: ProjectFile) => Promise<string>

interface FontFaceRule {
  family: string
  src: string
}

function parseFontFaces(cssSource: string): FontFaceRule[] {
  const rules: FontFaceRule[] = []
  for (const block of cssSource.match(/@font-face\s*\{[^}]*\}/g) ?? []) {
    const family = /font-family:\s*['"]?([^'";}]+)/.exec(block)?.[1]?.trim()
    const src = /url\(\s*['"]?([^'")]+)/.exec(block)?.[1]?.trim()
    if (family && src) rules.push({ family, src })
  }
  return rules
}

// Resolve an @font-face url() relative to its stylesheet's directory.
function resolveRelativePath(fromDir: string, target: string): string {
  const segments = fromDir ? fromDir.split('/') : []
  for (const part of target.replace(/^\.\//, '').split('/')) {
    if (part === '..') segments.pop()
    else if (part !== '.' && part !== '') segments.push(part)
  }
  return segments.join('/')
}

// Assign @font-face family names to the collected font files, matching by
// resolved path first and by basename as a fallback.
function applyFontFaceFamilies(fonts: ProjectFontFile[], cssFiles: CssFile[]): void {
  const byPath = new Map(fonts.map((font) => [font.relativePath, font]))
  const byBase = new Map(fonts.map((font) => [basename(font.relativePath), font]))
  for (const css of cssFiles) {
    const cssDir = css.relativePath.includes('/')
      ? css.relativePath.slice(0, css.relativePath.lastIndexOf('/'))
      : ''
    for (const rule of parseFontFaces(css.source)) {
      const resolved = resolveRelativePath(cssDir, rule.src)
      const target = byPath.get(resolved) ?? byBase.get(basename(rule.src))
      if (target && !target.family) target.family = rule.family
    }
  }
}

interface ManifestBucket {
  screens: ScreenFile[]
  css: CssFile[]
  tokensCss: CssFile[]
  assets: AssetFile[]
  dataFiles: CssFile[]
  screenshots: string[]
  uploads: string[]
  fonts: ProjectFontFile[]
  app?: ScreenFile
  readme?: string
  designSystem?: DesignSystemInfo
  seenCss: Set<string>
  assetBytes?: Map<string, Uint8Array>
}

function addAsset(bucket: ManifestBucket, file: ProjectFile): void {
  if (bucket.assets.length >= MAX_ASSETS) return
  bucket.assets.push({
    ...file,
    mimeType: MIME_BY_EXT[extname(file.relativePath)] ?? 'application/octet-stream',
    bytes: bucket.assetBytes?.get(file.relativePath)
  })
}

// Design system folder (_ds/<name>/): README + card index + token CSS.
async function addDesignSystemFile(
  bucket: ManifestBucket,
  file: ProjectFile,
  readText: ReadText
): Promise<void> {
  const dsName = pathSegments(file.relativePath)[1] ?? '_ds'
  const base = basename(file.relativePath)
  const ensure = (): DesignSystemInfo => {
    bucket.designSystem ??= { name: dsName, cards: [] }
    return bucket.designSystem
  }

  if (/^readme\.md$/i.test(base)) {
    const text = await readText(file).catch(() => '')
    if (text) ensure().readme = truncate(text, MAX_README_BYTES).text
  } else if (base === '_ds_manifest.json') {
    const text = await readText(file).catch(() => '')
    if (text) ensure().cards = parseDesignSystemCards(text)
  } else if (extname(file.relativePath) === '.css') {
    const source = await readText(file).catch(() => '')
    if (!source || bucket.seenCss.has(source)) return
    bucket.seenCss.add(source)
    // colors_and_type.css is the token source of truth — surface first.
    const target = base === 'colors_and_type.css' ? bucket.tokensCss : bucket.css
    target.push({ ...file, source })
    ensure()
  }
}

async function addProjectFile(
  bucket: ManifestBucket,
  file: ProjectFile,
  readText: ReadText
): Promise<void> {
  const ext = extname(file.relativePath)
  const base = basename(file.relativePath)

  if (JSX_EXTENSIONS.includes(ext as (typeof JSX_EXTENSIONS)[number])) {
    const source = await readText(file).catch(() => '')
    const { text, truncated } = truncate(source)
    const screen: ScreenFile = {
      ...file,
      componentName: componentNameFor(file.relativePath),
      source: text,
      truncated
    }
    if (/^(App|index|main)\.(jsx|tsx)$/i.test(base)) {
      bucket.app = screen
    } else {
      bucket.screens.push(screen)
    }
  } else if (CSS_EXTENSIONS.includes(ext as (typeof CSS_EXTENSIONS)[number])) {
    const source = await readText(file).catch(() => '')
    if (bucket.seenCss.has(source)) return
    bucket.seenCss.add(source)
    bucket.css.push({ ...file, source })
  } else if (isImage(file.relativePath)) {
    addAsset(bucket, file)
  } else if (/\.data\.js$/i.test(base)) {
    if (bucket.dataFiles.length >= MAX_DATA_FILES) return
    const source = await readText(file).catch(() => '')
    if (source) bucket.dataFiles.push({ ...file, source: truncate(source, MAX_DATA_BYTES).text })
  } else if (/^readme\.md$/i.test(base)) {
    bucket.readme = await readText(file).catch(() => undefined)
  }
}

async function buildManifestFromFiles(
  rootPath: string,
  name: string,
  files: ProjectFile[],
  readText: ReadText,
  assetBytes?: Map<string, Uint8Array>
): Promise<ProjectManifest> {
  const bucket: ManifestBucket = {
    screens: [],
    css: [],
    tokensCss: [],
    assets: [],
    dataFiles: [],
    screenshots: [],
    uploads: [],
    fonts: [],
    seenCss: new Set(),
    assetBytes
  }

  for (const file of files) {
    const top = pathSegments(file.relativePath)[0] ?? ''

    // Fonts can live anywhere (usually _ds/<name>/fonts/) — collect globally.
    if (isFont(file.relativePath)) {
      bucket.fonts.push({ ...file, bytes: assetBytes?.get(file.relativePath) })
      continue
    }

    // Reference folders: listed for context, never converted or inlined.
    if (top === 'screenshots') {
      if (isImage(file.relativePath)) bucket.screenshots.push(file.relativePath)
    } else if (top === 'uploads') {
      bucket.uploads.push(file.relativePath)
      // Uploads are reference art, but screens do use some directly (logos,
      // portraits) — keep image uploads placeable via `place_asset`.
      if (isImage(file.relativePath)) addAsset(bucket, file)
    } else if (top === '_ds') {
      await addDesignSystemFile(bucket, file, readText)
    } else {
      await addProjectFile(bucket, file, readText)
    }
  }

  bucket.screens.sort((a, b) => a.componentName.localeCompare(b.componentName))
  bucket.screenshots.sort((a, b) => a.localeCompare(b))
  bucket.uploads.sort((a, b) => a.localeCompare(b))

  // Drop minified duplicates ("hud.min.css") when the readable sibling exists.
  const cssNames = new Set(
    [...bucket.tokensCss, ...bucket.css].map((file) => basename(file.relativePath))
  )
  const dedupedCss = bucket.css.filter((file) => {
    const base = basename(file.relativePath)
    return !(base.endsWith('.min.css') && cssNames.has(base.replace(/\.min\.css$/, '.css')))
  })

  const css = [...bucket.tokensCss, ...dedupedCss]
  applyFontFaceFamilies(bucket.fonts, css)

  return {
    rootPath,
    name,
    screens: bucket.screens,
    css,
    assets: bucket.assets,
    app: bucket.app,
    readme: bucket.readme,
    dataFiles: bucket.dataFiles,
    screenshots: bucket.screenshots,
    uploads: bucket.uploads,
    fonts: bucket.fonts,
    designSystem: bucket.designSystem
  }
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
  return buildManifestFromFiles(folderPath, name, files, (file) =>
    tauriReadTextFile(file.absolutePath)
  )
}

/**
 * Read a .zip project into a manifest. The zip is unzipped in memory with
 * fflate; file contents come from the archive, not the filesystem (absolute
 * paths are synthetic). Oversized entries (offline HTML bundles, fonts) are
 * never decompressed. Browser + Tauri.
 */
export async function readProjectZip(file: File): Promise<ProjectManifest> {
  const { unzipSync, strFromU8 } = await import('fflate')
  const bytes = new Uint8Array(await file.arrayBuffer())
  const entries = unzipSync(bytes, {
    filter: (entry) =>
      !entry.name.endsWith('/') &&
      entry.originalSize <= (isFont(entry.name) ? MAX_FONT_BYTES : MAX_ZIP_ENTRY_BYTES) &&
      !shouldSkipFile(entry.name)
  })
  const files: ProjectFile[] = []
  const contents = new Map<string, Uint8Array>()
  const allPaths: string[] = []
  const topDirs = new Set<string>()
  for (const name of Object.keys(entries)) {
    const clean = name.replace(/^\.\//, '')
    const top = clean.split('/')[0] ?? clean
    if (SKIP_DIRS.has(top)) continue
    if (files.length >= MAX_FILES) break
    const data = entries[name]
    files.push({ relativePath: clean, absolutePath: clean, size: data.length })
    contents.set(clean, data)
    allPaths.push(clean)
    if (clean.includes('/')) topDirs.add(top)
  }

  // Strip the common root only when every file lives under a single top dir.
  let rootPrefix = ''
  if (topDirs.size === 1) {
    const prefix = `${[...topDirs][0] ?? ''}/`
    if (allPaths.every((path) => path.startsWith(prefix))) rootPrefix = prefix
  }
  const normalized = files.map((f) => ({
    ...f,
    relativePath:
      rootPrefix && f.relativePath.startsWith(rootPrefix)
        ? f.relativePath.slice(rootPrefix.length)
        : f.relativePath
  }))

  const readText: ReadText = (projectFile) => {
    const data =
      contents.get(projectFile.relativePath) ??
      contents.get(`${rootPrefix}${projectFile.relativePath}`)
    return Promise.resolve(data ? strFromU8(data) : '')
  }
  const assetBytes = new Map<string, Uint8Array>()
  for (const projectFile of normalized) {
    if (!isImage(projectFile.relativePath) && !isFont(projectFile.relativePath)) continue
    const data =
      contents.get(projectFile.relativePath) ??
      contents.get(`${rootPrefix}${projectFile.relativePath}`)
    if (data) assetBytes.set(projectFile.relativePath, data)
  }

  return buildManifestFromFiles(
    file.name,
    file.name.replace(/\.zip$/i, ''),
    normalized,
    readText,
    assetBytes
  )
}
