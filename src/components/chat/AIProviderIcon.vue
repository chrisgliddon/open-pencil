<script setup lang="ts">
import { computed } from 'vue'

import type { AIIconKey } from '@/app/ai/provider-label'

const { icon } = defineProps<{
  icon: AIIconKey
}>()

// Inline brand SVGs — no icon dependency. Paths are simplified brand marks
// (single-color, currentColor) so they inherit text color. Unknown/default
// falls back to a lucide sparkles glyph via the <icon-lucide-*> component.
const paths: Record<Exclude<AIIconKey, 'default'>, string> = {
  // Anthropic (Claude): the A-sunburst mark, simplified.
  anthropic:
    'M5.36 16.68 9.91 7.32h2.18l4.55 9.36h-2.13l-3.6-7.51-3.6 7.51H5.36Zm5.04-7.51.92-1.85h2.18l.92 1.85',
  // OpenAI: the hexagonal flower mark.
  openai:
    'M10.53 4.47a3.07 3.07 0 0 1 2.94-2.4l4.06 2.2a3.07 3.07 0 0 1 1.13 4.2l-2.2 3.8a3.07 3.07 0 0 1-4.2 1.13l-4.06-2.2a3.07 3.07 0 0 1-1.13-4.2l2.2-3.8a3.07 3.07 0 0 1 1.26-1.13Zm.94 1.63a1.4 1.4 0 0 0-.51.49l-2.2 3.8a1.4 1.4 0 0 0 .51 1.92l4.06 2.2a1.4 1.4 0 0 0 1.92-.51l2.2-3.8a1.4 1.4 0 0 0-.51-1.92l-4.06-2.2a1.4 1.4 0 0 0-1.41 0Z',
  // Google: four-color G simplified to a single-path monochrome G.
  google:
    'M12 4a8 8 0 1 0 7.74 10h-2.1A6 6 0 1 1 12 6c1.6 0 3.05.63 4.13 1.65l1.42-1.42A8 8 0 0 0 12 4Zm0 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z',
  // OpenRouter: a hub-and-spoke mark.
  openrouter:
    'M7 4h10a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3V7a3 3 0 0 1 3-3Zm5 4-4 4 4 4 4-4-4-4Z',
  // DeepSeek: a whale-ish mark, simplified to a rounded diamond.
  deepseek: 'M12 3 21 12 12 21 3 12 12 3Zm0 4.5L16.5 12 12 16.5 7.5 12 12 7.5Z',
  // Z.ai: a Z mark.
  zai: 'M6 5h12v2.2L9.2 18.8H18V21H6v-2.2l8.8-11.6H6V5Z',
  // MiniMax: two opposing triangles.
  minimax: 'M4 6l5 6-5 6V6Zm16 0-5 6 5 6V6Z',
  // OpenCode: a terminal prompt mark.
  opencode: 'M5 7l4 5-4 5 1.5 0 4-5-4-5H5Zm6 9h7v1.5h-7V16Z',
  // Claude Code: the Anthropic A with a small terminal slash.
  'claude-code':
    'M5.36 16.68 9.91 7.32h2.18l4.55 9.36h-2.13l-3.6-7.51-3.6 7.51H5.36Zm10-9.36 1.6 1.6-1.6 1.6v-3.2Z',
  // Codex: OpenAI mark with a code bracket.
  codex: 'M9 8 5 12l4 4m6-8 4 4-4 4',
  // Gemini CLI: a four-point star (Gemini sparkle).
  'gemini-cli': 'M12 3c.5 3.5 2.5 5.5 6 6-3.5.5-5.5 2.5-6 6-.5-3.5-2.5-5.5-6-6 3.5-.5 5.5-2.5 6-6Z',
  // Custom OpenAI-compatible endpoint: a plug.
  custom: 'M9 2v6m6-6v6M7 8h10v3a5 5 0 0 1-10 0V8Zm5 8v6'
}

const isDefault = computed(() => icon === 'default')
const path = computed(() => paths[icon as Exclude<AIIconKey, 'default'>] ?? '')
</script>

<template>
  <svg
    v-if="!isDefault && path"
    viewBox="0 0 24 24"
    fill="currentColor"
    class="shrink-0"
    aria-hidden="true"
  >
    <path :d="path" />
  </svg>
  <icon-lucide-sparkles v-else class="shrink-0" aria-hidden="true" />
</template>
