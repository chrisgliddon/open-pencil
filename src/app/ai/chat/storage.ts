import { useLocalStorage } from '@vueuse/core'
import { computed, watch } from 'vue'

import {
  ACP_AGENTS,
  AI_PROVIDERS,
  DEFAULT_AI_MODEL,
  DEFAULT_AI_PROVIDER,
  IS_BROWSER,
  IS_TAURI
} from '@open-pencil/core/constants'
import type { AIProviderID } from '@open-pencil/core/constants'
import { setPexelsApiKey, setUnsplashAccessKey } from '@open-pencil/core/tools'

const STORAGE_PREFIX = 'open-pencil:'
const LEGACY_KEY_STORAGE = `${STORAGE_PREFIX}openrouter-api-key`
const PROVIDER_KEY = `${STORAGE_PREFIX}ai-provider`

export function keyStorageKey(id: string) {
  return `${STORAGE_PREFIX}ai-key:${id}`
}

function migrateLegacyStorage() {
  const legacyKey = localStorage.getItem(LEGACY_KEY_STORAGE)
  if (legacyKey) {
    localStorage.setItem(keyStorageKey('openrouter'), legacyKey)
    localStorage.removeItem(LEGACY_KEY_STORAGE)
    if (!localStorage.getItem(PROVIDER_KEY)) {
      localStorage.setItem(PROVIDER_KEY, 'openrouter')
    }
  }
}

// A previously-selected ACP agent may no longer be registered (e.g. a fork
// dropped an agent, or an agent was renamed). Fall back to the default
// provider instead of booting into an "Unknown ACP agent" error.
function migrateStaleACPProvider() {
  const stored = localStorage.getItem(PROVIDER_KEY)
  if (!stored?.startsWith('acp:')) return
  const agentId = stored.slice('acp:'.length)
  if (!ACP_AGENTS.some((agent) => agent.id === agentId)) {
    localStorage.setItem(PROVIDER_KEY, DEFAULT_AI_PROVIDER)
  }
}

if (IS_BROWSER) {
  migrateLegacyStorage()
  migrateStaleACPProvider()
}

export const providerID = useLocalStorage<AIProviderID>(PROVIDER_KEY, DEFAULT_AI_PROVIDER)
const apiKeyStorageKey = computed(() => keyStorageKey(providerID.value))
export const apiKey = useLocalStorage(apiKeyStorageKey, '')
export const modelID = useLocalStorage(`${STORAGE_PREFIX}ai-model`, DEFAULT_AI_MODEL)
export const customBaseURL = useLocalStorage(`${STORAGE_PREFIX}ai-base-url`, '')
export const customModelID = useLocalStorage(`${STORAGE_PREFIX}ai-custom-model`, '')
export const customAPIType = useLocalStorage<'completions' | 'responses'>(
  `${STORAGE_PREFIX}ai-api-type`,
  'completions'
)
export const maxOutputTokens = useLocalStorage(`${STORAGE_PREFIX}ai-max-output-tokens`, 16384)

// Per-ACP-agent default models, keyed by the conceptual mode slot the agent's
// modes map onto (see slotForMode). '' / absent means "use the agent's own
// default". Applied automatically when a session starts or the mode changes.
export type ACPModeSlot = 'plan' | 'build' | 'auto'
export type ACPModelDefaults = Partial<Record<ACPModeSlot, string>>

/** A model advertised by an ACP agent, cached for the settings UI. */
export interface ACPKnownModel {
  id: string
  name: string
}

export const acpModelDefaults = useLocalStorage<Record<string, ACPModelDefaults>>(
  `${STORAGE_PREFIX}acp-model-defaults`,
  {}
)

export const acpKnownModels = useLocalStorage<Record<string, ACPKnownModel[]>>(
  `${STORAGE_PREFIX}acp-known-models`,
  {}
)

export function acpDefaultModelFor(agentId: string, slot: ACPModeSlot): string {
  return acpModelDefaults.value[agentId]?.[slot] ?? ''
}

export function setAcpDefaultModel(agentId: string, slot: ACPModeSlot, modelId: string): void {
  const agentDefaults = { ...acpModelDefaults.value[agentId], [slot]: modelId }
  acpModelDefaults.value = { ...acpModelDefaults.value, [agentId]: agentDefaults }
}

/** Cache the models an agent advertised so the settings UI can offer them. */
export function rememberAcpModels(agentId: string, models: ACPKnownModel[]): void {
  if (models.length === 0) return
  acpKnownModels.value = {
    ...acpKnownModels.value,
    [agentId]: models.map(({ id, name }) => ({ id, name }))
  }
}

export const pexelsApiKey = useLocalStorage(`${STORAGE_PREFIX}pexels-api-key`, '')
export const unsplashAccessKey = useLocalStorage(`${STORAGE_PREFIX}unsplash-access-key`, '')

export const providerDef = computed(
  () => AI_PROVIDERS.find((p) => p.id === providerID.value) ?? AI_PROVIDERS[0]
)

export const isACPProvider = computed(() => providerID.value.startsWith('acp:'))

export const isConfigured = computed(() => {
  if (isACPProvider.value) return IS_TAURI
  if (!apiKey.value) return false
  const needsBaseURL =
    providerID.value === 'openai-compatible' || providerID.value === 'anthropic-compatible'
  if (needsBaseURL && !customBaseURL.value) return false
  return true
})

export function setAPIKey(key: string) {
  apiKey.value = key
}

export function registerAIChatEffects(markTransportDirty: () => void) {
  watch(
    pexelsApiKey,
    (key) => {
      setPexelsApiKey(key || null)
    },
    { immediate: true }
  )

  watch(
    unsplashAccessKey,
    (key) => {
      setUnsplashAccessKey(key || null)
    },
    { immediate: true }
  )

  watch(providerID, (id) => {
    const def = AI_PROVIDERS.find((p) => p.id === id)
    if (def?.defaultModel) {
      modelID.value = def.defaultModel
    }
    markTransportDirty()
  })

  watch(modelID, markTransportDirty)
  watch(customModelID, markTransportDirty)
  watch(customAPIType, markTransportDirty)
  watch(apiKey, markTransportDirty)
  watch(customBaseURL, markTransportDirty)
}
