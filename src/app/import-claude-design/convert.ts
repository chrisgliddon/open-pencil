// Drives the AI chat to convert a Claude Design project manifest into
// OpenPencil scene nodes. Builds a conversion prompt from the manifest and
// sends it via the shared chat session; the LLM uses the existing `render`
// and `createPage` tools to build each screen on the canvas.
import { useAIChat } from '@/app/ai/chat/use'
import type { ProjectManifest, ScreenFile } from './read-project'

const MAX_SCREENS_PER_PASS = 12
const MAX_CSS_CHARS = 24_000

function screenBlock(screen: ScreenFile): string {
  return `### ${screen.componentName}.jsx${screen.truncated ? ' (truncated)' : ''}
\`\`\`jsx
${screen.source}
\`\`\``
}

function cssBlock(manifest: ProjectManifest): string {
  const cssText = manifest.css
    .map((file) => `/* ${file.relativePath} */\n${file.source}`)
    .join('\n\n')
  if (!cssText) return ''
  if (cssText.length <= MAX_CSS_CHARS) return `\n## CSS\n\`\`\`css\n${cssText}\n\`\`\``
  return `\n## CSS (truncated)\n\`\`\`css\n${cssText.slice(0, MAX_CSS_CHARS)}\n/* …truncated… */\n\`\`\``
}

function assetList(manifest: ProjectManifest): string {
  if (manifest.assets.length === 0) return ''
  const list = manifest.assets
    .slice(0, 40)
    .map((asset) => `- ${asset.relativePath} (${asset.mimeType})`)
    .join('\n')
  return `\n## Available image assets (use as image fills by filename)\n${list}\n`
}

// Build the conversion prompt. The LLM gets the project's screens, CSS, and
// asset list, plus explicit instructions to translate React/CSS into the
// OpenPencil JSX the `render` tool accepts (no state, no handlers, no CSS
// classes — inline style props only), one page per screen.
export function buildConversionPrompt(manifest: ProjectManifest, selectedScreens: string[]): string {
  const screens = manifest.screens.filter((s) => selectedScreens.includes(s.componentName))
  const screenText = screens.map(screenBlock).join('\n\n')
  const appBlock = manifest.app ? `\n## App router (for context — do NOT render)\n\`\`\`jsx\n${manifest.app.source}\n\`\`\`\n` : ''
  const readmeBlock = manifest.readme ? `\n## Brand/readme context (excerpt)\n\`\`\`md\n${manifest.readme.slice(0, 4000)}\n\`\`\`\n` : ''

  return `Convert this Claude Design project into OpenPencil. Create one page per screen and render each screen's design onto its page.

## Rules
- Use the \`createPage\` tool to make a page named after each screen component (e.g. "HUD", "Inventory"), then \`render\` that screen's JSX onto it.
- Translate React + CSS into OpenPencil JSX: colors as hex (#RRGGBB), all styling as props — no className, no CSS classes, no \`style\` prop.
- Resolve CSS class styles to the equivalent inline props (bg, rounded, p, flex, gap, size, color, weight, etc.).
- Drop interactivity and state: render a faithful *static visual* of the default/initial state. No onClick, useState, props branching — pick the most representative visual state.
- Replace image asset references (e.g. \`src="assets/coin.png"\`) with a Rectangle that has an image fill using the asset's filename, or an \`<Icon>\` for known icon sets. List the assets you used.
- Use auto-layout (flex="row"/"col") for every container with 2+ children. Every Frame needs a concrete w/h or hug/fill.
- Keep the cozy, toon-shaded PPW branding from the readme if present.
- Work through screens one at a time: createPage, then render. Aim for a complete, faithful visual for each.
- After all screens, reply with a 2-3 line summary: pages created, main accent color, any layout you simplified.

## Project: ${manifest.name}
${appBlock}${readmeBlock}${cssBlock(manifest)}${assetList(manifest)}

## Screens to convert (${screens.length})
${screenText}

Start now: create the first page and render it.`
}

export interface ConversionResult {
  ok: boolean
  error?: string
}

// Run the conversion by sending the prompt to the shared AI chat session. The
// chat UI (ChatPanel) reflects the streaming progress; the LLM's tool calls
// build the scene on the active document's canvas.
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
    const chat = await ensureChat()
    if (!chat) return { ok: false, error: 'Chat session is not available.' }
    await chat.sendMessage({ text: prompt })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}