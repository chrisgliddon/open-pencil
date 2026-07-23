import type {
  AvailableCommand,
  ModelInfo,
  SessionConfigOption,
  SessionConfigSelectOption,
  SessionConfigValueId,
  SessionMode,
  SessionUpdate
} from '@agentclientprotocol/sdk'
import { shallowRef, type ShallowRef } from 'vue'

// A named selectable option advertised by the agent — used for both session
// modes (Plan/Build) and models, which share the same {id, name, description}
// shape. Keeping one type avoids duplicate type shapes.
export interface ACPChoice {
  id: string
  name: string
  description?: string | null
}

export interface ACPSessionState {
  modes: ACPChoice[]
  currentModeId: string | null
  models: ACPChoice[]
  currentModelId: string | null
  commands: AvailableCommand[]
}

export function createEmptySessionState(): ACPSessionState {
  return { modes: [], currentModeId: null, models: [], currentModelId: null, commands: [] }
}

// Friendly labels for well-known OpenCode modes. The agent advertises its
// modes by agent name (e.g. "build", "plan"); map the common ones to the
// Plan/Build labels users expect, and pass any other mode name through.
const MODE_LABELS: Record<string, string> = {
  build: 'Build',
  plan: 'Plan',
  ask: 'Ask'
}

export function modeLabel(id: string, fallback?: string | null): string {
  if (id in MODE_LABELS) return MODE_LABELS[id]
  return fallback ?? id
}

function flattenOptions(
  options: SessionConfigOption['options']
): SessionConfigSelectOption[] {
  if (options.length === 0) return []
  // Options are either a flat list of options or a list of groups. Groups
  // carry their own `.options`; flatten them into a single list.
  if ('options' in options[0]) {
    return (options as Array<{ options: SessionConfigSelectOption[] }>).flatMap((g) => g.options)
  }
  return options as SessionConfigSelectOption[]
}

// Parse the agent's `configOptions` (and optional `models` state) from the
// NewSessionResponse into the reactive session state. opencode surfaces mode
// and model as config-option selects with `category: "mode" | "model"`, plus
// a top-level `models` SessionModelState. Handle both so other agents that
// only send one form still work.
export function sessionStateFromConfig(
  configOptions: SessionConfigOption[] | null | undefined,
  models: { availableModels: ModelInfo[]; currentModelId: string } | null | undefined
): ACPSessionState {
  const state = createEmptySessionState()

  for (const option of configOptions ?? []) {
    if (option.category === 'mode') {
      const flat = flattenOptions(option.options)
      state.modes = flat.map((o) => ({
        id: o.value,
        name: modeLabel(o.value, o.name),
        description: o.description
      }))
      state.currentModeId = option.currentValue
    } else if (option.category === 'model') {
      const flat = flattenOptions(option.options)
      state.models = flat.map((o) => ({
        id: o.value,
        name: o.name,
        description: o.description
      }))
      state.currentModelId = option.currentValue
    }
  }

  if (models) {
    if (state.models.length === 0) {
      state.models = models.availableModels.map((m) => ({
        id: m.modelId,
        name: m.modelId,
        description: m.description
      }))
    }
    if (!state.currentModelId) state.currentModelId = models.currentModelId
  }

  return state
}

// The config-option id to use when changing the mode/model via
// setSessionConfigOption. opencode uses "mode" and "model"; fall back to a
// category-based lookup if an agent uses a different id.
export function configOptionIdForCategory(
  configOptions: SessionConfigOption[] | null | undefined,
  category: 'mode' | 'model'
): string | null {
  return configOptions?.find((o) => o.category === category)?.id ?? null
}

export interface ACPSessionStateRefs {
  state: ShallowRef<ACPSessionState>
}

export function createSessionStateRefs(): ACPSessionStateRefs {
  return { state: shallowRef(createEmptySessionState()) }
}

// Apply a session update notification to the reactive state. Returns true if
// the state changed (so the caller can decide whether to trigger a re-render).
// Ignores update types that don't affect session state (message/tool chunks).
export function applySessionUpdate(state: ACPSessionState, update: SessionUpdate): boolean {
  switch (update.sessionUpdate) {
    case 'current_mode_update': {
      if (state.currentModeId === update.currentModeId) return false
      state.currentModeId = update.currentModeId
      return true
    }
    case 'available_commands_update': {
      state.commands = update.availableCommands
      return true
    }
    case 'config_option_update': {
      const next = sessionStateFromConfig(update.configOptions, null)
      // Preserve commands — config-option updates don't carry them.
      next.commands = state.commands
      Object.assign(state, next)
      return true
    }
    default:
      return false
  }
}

export type { SessionMode, SessionConfigValueId }