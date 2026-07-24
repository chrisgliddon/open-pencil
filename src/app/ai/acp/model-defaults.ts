// Maps an ACP agent's advertised modes onto the three conceptual slots users
// configure default models for (Plan / Build / Auto), and resolves which
// configured model should apply for a given mode.
//
// Agents name their modes differently — OpenCode: build/plan, Claude Code:
// default/plan/acceptEdits/bypassPermissions, Codex: read-only/auto/full — so
// slots are matched heuristically: anything plan-ish is Plan, anything
// auto-accepting/bypassing is Auto, everything else (the normal interactive
// mode) is Build.
import { acpDefaultModelFor, type ACPModeSlot } from '@/app/ai/chat/storage'

import type { ACPChoice } from './session-state'

export const ACP_MODE_SLOTS: readonly ACPModeSlot[] = ['plan', 'build', 'auto'] as const

export function slotForMode(mode: Pick<ACPChoice, 'id' | 'name'>): ACPModeSlot {
  const key = `${mode.id} ${mode.name}`.toLowerCase()
  if (key.includes('plan')) return 'plan'
  if (
    key.includes('auto') ||
    key.includes('bypass') ||
    key.includes('accept') ||
    key.includes('yolo') ||
    key.includes('full')
  ) {
    return 'auto'
  }
  return 'build'
}

/**
 * The configured default model for an agent's current mode, or '' when the
 * user hasn't configured one (keep the agent's own default).
 */
export function defaultModelForMode(
  agentId: string,
  modes: ACPChoice[],
  currentModeId: string | null
): string {
  const mode = modes.find((candidate) => candidate.id === currentModeId)
  const slot = mode ? slotForMode(mode) : 'build'
  return acpDefaultModelFor(agentId, slot)
}
