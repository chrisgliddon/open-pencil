// Resolves a brand icon key + display label for an AI provider or ACP agent
// from its providerID. Icons are rendered by AIProviderIcon.vue via a small
// set of inline brand SVGs (no icon dependency) plus a lucide fallback.

import { ACP_AGENTS, AI_PROVIDERS } from '@open-pencil/core/constants'
import type { AIProviderID } from '@open-pencil/core/constants'

export type AIIconKey =
  | 'anthropic'
  | 'openai'
  | 'google'
  | 'openrouter'
  | 'deepseek'
  | 'zai'
  | 'minimax'
  | 'opencode'
  | 'claude-code'
  | 'codex'
  | 'gemini-cli'
  | 'custom'
  | 'default'

export interface AIProviderLabel {
  /** Brand icon key for AIProviderIcon. */
  icon: AIIconKey
  /** Display name of the provider or agent (e.g. "Claude Code", "OpenRouter"). */
  name: string
  /** Whether this is an ACP agent (vs a direct API provider). */
  isACP: boolean
}

function providerIconFor(id: AIProviderID): AIIconKey {
  if (id.startsWith('acp:')) {
    const agentId = id.slice('acp:'.length)
    if (agentId === 'opencode') return 'opencode'
    if (agentId === 'claude-code') return 'claude-code'
    if (agentId === 'codex') return 'codex'
    if (agentId === 'gemini-cli') return 'gemini-cli'
    return 'default'
  }
  switch (id) {
    case 'anthropic':
    case 'anthropic-compatible':
      return 'anthropic'
    case 'openai':
      return 'openai'
    case 'google':
      return 'google'
    case 'openrouter':
      return 'openrouter'
    case 'deepseek':
      return 'deepseek'
    case 'zai':
      return 'zai'
    case 'minimax':
      return 'minimax'
    case 'openai-compatible':
      return 'custom'
    default:
      return 'default'
  }
}

export function resolveAIProviderLabel(providerID: AIProviderID): AIProviderLabel {
  if (providerID.startsWith('acp:')) {
    const agentId = providerID.slice('acp:'.length)
    const agent = ACP_AGENTS.find((a) => a.id === agentId)
    return {
      icon: providerIconFor(providerID),
      name: agent?.name ?? agentId,
      isACP: true
    }
  }
  const def = AI_PROVIDERS.find((p) => p.id === providerID)
  return {
    icon: providerIconFor(providerID),
    name: def?.name ?? providerID,
    isACP: false
  }
}
