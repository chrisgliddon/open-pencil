// Drives the AI chat to convert a Claude Design project manifest into
// OpenPencil scene nodes. The organizational rules (pages per flow,
// non-overlapping top-level frames, components on a Components page, asset
// placement) live in prompt.md; this module appends the project-specific
// manifest sections and sends the result via the shared chat session.
import { useAIChat } from '@/app/ai/chat/use'
import { getActiveEditorStore } from '@/app/editor/active-store'

import { registerImportAssets, registerImportFonts } from './assets'
import CONVERSION_RULES from './prompt.md?raw'
import type { CssFile, ProjectManifest, ScreenFile } from './read-project'

const MAX_SCREENS_PER_PASS = 8
const MAX_CSS_CHARS = 32_000
const MAX_ASSET_LINES = 60
const MAX_CARD_LINES = 40
const MAX_LIST_LINES = 40
const MAX_README_CHARS = 4_000

function screenBlock(screen: ScreenFile): string {
  return `### ${screen.componentName}.jsx${screen.truncated ? ' (truncated)' : ''}
\`\`\`jsx
${screen.source}
\`\`\``
}

function fileStem(path: string): string {
  const base = path.split('/').pop() ?? path
  return base.replace(/\.[^.]+$/, '').toLowerCase()
}

// Token CSS first (manifest order), then CSS whose filename relates to a
// selected screen, then the rest — so the cap trims the least relevant files.
function cssBlock(manifest: ProjectManifest, screens: ScreenFile[]): string {
  const screenNames = screens.map((screen) => screen.componentName.toLowerCase())
  const relevance = (file: CssFile): number => {
    const stem = fileStem(file.relativePath)
    if (stem === 'colors_and_type') return 0
    return screenNames.some((name) => name.includes(stem) || stem.includes(name)) ? 1 : 2
  }
  const ordered = manifest.css.map((file, index) => ({ file, index }))
  ordered.sort((a, b) => relevance(a.file) - relevance(b.file) || a.index - b.index)

  const cssText = ordered
    .map(({ file }) => `/* ${file.relativePath} */\n${file.source}`)
    .join('\n\n')
  if (!cssText) return ''
  if (cssText.length <= MAX_CSS_CHARS) return `\n## CSS\n\`\`\`css\n${cssText}\n\`\`\`\n`
  return `\n## CSS (truncated)\n\`\`\`css\n${cssText.slice(0, MAX_CSS_CHARS)}\n/* …truncated… */\n\`\`\`\n`
}

function assetList(manifest: ProjectManifest): string {
  if (manifest.assets.length === 0) return ''
  const lines = manifest.assets
    .slice(0, MAX_ASSET_LINES)
    .map((asset) => {
      const note = asset.relativePath.startsWith('uploads/') ? ', reference upload' : ''
      return `- ${asset.relativePath} (${asset.mimeType}${note})`
    })
    .join('\n')
  const more =
    manifest.assets.length > MAX_ASSET_LINES
      ? `\n…and ${manifest.assets.length - MAX_ASSET_LINES} more`
      : ''
  return `\n## Image assets (apply with \`place_asset\` by path)\n${lines}${more}\n`
}

function designSystemBlock(manifest: ProjectManifest): string {
  const ds = manifest.designSystem
  if (!ds) return ''
  const cards =
    ds.cards.length > 0
      ? `\n### Card index (the project's own reusable elements)\n${ds.cards
          .slice(0, MAX_CARD_LINES)
          .map((card) => `- ${card}`)
          .join('\n')}`
      : ''
  const readme = ds.readme
    ? `\n### Design system README (excerpt)\n\`\`\`md\n${ds.readme}\n\`\`\``
    : ''
  return `\n## Design system: ${ds.name}${cards}${readme}\n`
}

function namesBlock(title: string, names: string[]): string {
  if (names.length === 0) return ''
  const lines = names
    .slice(0, MAX_LIST_LINES)
    .map((name) => `- ${name}`)
    .join('\n')
  const more = names.length > MAX_LIST_LINES ? `\n…and ${names.length - MAX_LIST_LINES} more` : ''
  return `\n## ${title}\n${lines}${more}\n`
}

function fontsBlock(manifest: ProjectManifest): string {
  const families = manifest.fonts
    .map((font) => font.family)
    .filter((family): family is string => !!family)
  if (families.length === 0) return ''
  const lines = [...new Set(families)].map((family) => `- "${family}"`).join('\n')
  return `\n## Project fonts (registered in the editor — set \`font\` to EXACTLY these names)\n${lines}\n`
}

function dataFilesBlock(manifest: ProjectManifest): string {
  if (manifest.dataFiles.length === 0) return ''
  const blocks = manifest.dataFiles
    .map((file) => `### ${file.relativePath}\n\`\`\`js\n${file.source}\n\`\`\``)
    .join('\n\n')
  return `\n## Data files (use for realistic content)\n${blocks}\n`
}

// Build the conversion prompt: the fixed organizational rules from prompt.md
// followed by the project-specific manifest sections.
export function buildConversionPrompt(
  manifest: ProjectManifest,
  selectedScreens: string[]
): string {
  const screens = manifest.screens.filter((s) => selectedScreens.includes(s.componentName))
  const screenText = screens.map(screenBlock).join('\n\n')
  const appBlock = manifest.app
    ? `\n## App router (screen list + flow order — do NOT render it)\n\`\`\`jsx\n${manifest.app.source}\n\`\`\`\n`
    : ''
  const readme = manifest.readme ?? manifest.designSystem?.readme
  const readmeBlock = readme
    ? `\n## Brand/readme context (excerpt)\n\`\`\`md\n${readme.slice(0, MAX_README_CHARS)}\n\`\`\`\n`
    : ''

  return `${CONVERSION_RULES}
## Project: ${manifest.name}
${appBlock}${readmeBlock}${designSystemBlock(manifest)}${cssBlock(manifest, screens)}${assetList(manifest)}${fontsBlock(manifest)}${namesBlock('Screenshots (names only — flow/state hints)', manifest.screenshots)}${dataFilesBlock(manifest)}
## Screens to convert (${screens.length})
${screenText}

Start now: write your plan, then build the Components page.`
}

export interface ConversionResult {
  ok: boolean
  error?: string
}

// Run the conversion by sending the prompt to the shared AI chat session. The
// chat UI (ChatPanel) reflects the streaming progress; the LLM's tool calls
// build the scene on the active document's canvas. Project image assets are
// registered so the `place_asset` tool can apply them as real image fills.
export async function convertProjectWithLLM(
  manifest: ProjectManifest,
  selectedScreens: string[]
): Promise<ConversionResult> {
  const { ensureChat, isConfigured } = useAIChat()
  if (!isConfigured.value) {
    return { ok: false, error: 'Configure an AI provider in the chat panel first.' }
  }
  const screens = selectedScreens.slice(0, MAX_SCREENS_PER_PASS)
  const prompt = buildConversionPrompt(manifest, screens)
  try {
    const store = getActiveEditorStore()
    registerImportAssets(store, manifest.assets)
    const projectFonts = await registerImportFonts(manifest.fonts)
    if (projectFonts.length > 0) {
      store.renderer?.invalidateAllPictures()
      store.requestRender()
    }
    const chat = await ensureChat()
    if (!chat) return { ok: false, error: 'Chat session is not available.' }
    await chat.sendMessage({ text: prompt })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
