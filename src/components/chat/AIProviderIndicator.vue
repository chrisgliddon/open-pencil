<script setup lang="ts">
import { computed } from 'vue'

import AIProviderIcon from '@/components/chat/AIProviderIcon.vue'
import { useAIChat } from '@/app/ai/chat/use'
import { resolveAIProviderLabel } from '@/app/ai/provider-label'

const { providerID, providerDef, modelID, customModelID, acpTransport } = useAIChat()

const label = computed(() => resolveAIProviderLabel(providerID.value))

// Secondary detail: the active model for direct providers, or the agent's
// advertised current mode/model for ACP agents (when available).
const detail = computed(() => {
  if (label.value.isACP) {
    const state = acpTransport.value?.acpState.value
    if (state) {
      const mode = state.modes.find((m) => m.id === state.currentModeId)
      const model = state.models.find((m) => m.id === state.currentModelId)
      if (mode && model) return `${mode.name} · ${model.name}`
      if (mode) return mode.name
      if (model) return model.name
    }
    return label.value.name
  }
  const custom = customModelID.value.trim()
  if (providerDef.value.supportsCustomModel && custom) return custom
  return providerDef.value.models.find((m) => m.id === modelID.value)?.name ?? modelID.value
})
</script>

<template>
  <div
    data-test-id="ai-provider-indicator"
    class="flex shrink-0 items-center gap-2 border-b border-border px-3 py-1.5"
  >
    <span
      class="flex size-5 items-center justify-center rounded-md bg-hover/60 text-surface"
      aria-hidden="true"
    >
      <AIProviderIcon :icon="label.icon" />
    </span>
    <div class="min-w-0 flex-1 leading-tight">
      <div class="truncate text-[11px] font-medium text-surface" data-test-id="ai-provider-name">
        {{ label.name }}
      </div>
      <div class="truncate text-[10px] text-muted" data-test-id="ai-provider-detail">
        {{ detail }}
      </div>
    </div>
  </div>
</template>
