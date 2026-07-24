<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  SelectContent,
  SelectItem,
  SelectItemText,
  SelectPortal,
  SelectRoot,
  SelectTrigger,
  SelectViewport
} from 'reka-ui'

import { useI18n } from '@open-pencil/vue'

import { ACP_MODE_SLOTS, slotForMode } from '@/app/ai/acp/model-defaults'
import {
  acpKnownModels,
  acpModelDefaults,
  setAcpDefaultModel,
  type ACPModeSlot
} from '@/app/ai/chat/storage'
import { createACPTransport } from '@/app/ai/chat/transports'
import { useAIChat } from '@/app/ai/chat/use'
import ProviderSettingsField from '@/components/chat/ProviderSettings/ProviderSettingsField.vue'
import { useProviderSettingsContext } from '@/components/chat/ProviderSettings/context'
import { useSelectUI } from '@/components/ui/select'

const AGENT_DEFAULT = '__agent-default__'

const ctx = useProviderSettingsContext()
const { dialogs } = useI18n()
const { acpTransport } = useAIChat()

const selectCls = useSelectUI({
  trigger:
    'w-full justify-between gap-1 rounded border border-border bg-input px-2 py-1 text-[11px]',
  content: 'z-[52] max-h-60 overflow-y-auto',
  item: 'gap-2 rounded px-2 py-1.5 text-[11px]'
})

const agentId = computed(() =>
  ctx.providerID.startsWith('acp:') ? ctx.providerID.slice('acp:'.length) : null
)
const knownModels = computed(() =>
  agentId.value ? (acpKnownModels.value[agentId.value] ?? []) : []
)
const defaults = computed(() =>
  agentId.value ? (acpModelDefaults.value[agentId.value] ?? {}) : {}
)

const slotLabels = computed<Record<ACPModeSlot, string>>(() => ({
  plan: dialogs.value.acpPlanModel,
  build: dialogs.value.acpBuildModel,
  auto: dialogs.value.acpAutoModel
}))

const loading = ref(false)
const loadError = ref('')

function valueFor(slot: ACPModeSlot): string {
  return defaults.value[slot] || AGENT_DEFAULT
}

function labelFor(slot: ACPModeSlot): string {
  const value = defaults.value[slot]
  if (!value) return dialogs.value.acpAgentDefault
  return knownModels.value.find((model) => model.id === value)?.name ?? value
}

function onChange(slot: ACPModeSlot, value: unknown) {
  if (!agentId.value || typeof value !== 'string') return
  const modelId = value === AGENT_DEFAULT ? '' : value
  setAcpDefaultModel(agentId.value, slot, modelId)

  // Apply immediately when this agent's live session is in a mode that maps
  // to the slot being changed.
  const transport = acpTransport.value
  const state = transport?.acpState.value
  if (!transport || !state || !modelId) return
  const mode = state.modes.find((candidate) => candidate.id === state.currentModeId)
  if (mode && slotForMode(mode) === slot) void transport.setModel(modelId)
}

// Fetch the agent's advertised models: reuse the live chat session when this
// agent is active, otherwise spawn a short-lived session and tear it down.
async function loadModels() {
  if (!agentId.value || loading.value) return
  loading.value = true
  loadError.value = ''
  try {
    const live = acpTransport.value
    if (live) {
      await live.ensureSessionState()
      return
    }
    const transport = await createACPTransport(ctx.providerID)
    try {
      await transport.ensureSessionState()
    } finally {
      await transport.destroy()
    }
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div v-if="ctx.isACP" class="flex flex-col gap-2" data-test-id="acp-model-defaults">
    <div class="flex items-center justify-between">
      <span class="text-[10px] font-medium tracking-wide text-muted uppercase">
        {{ dialogs.acpDefaultModels }}
      </span>
      <button
        data-test-id="acp-model-defaults-load"
        class="rounded px-1.5 py-0.5 text-[10px] text-muted hover:bg-hover hover:text-surface"
        :disabled="loading"
        @click="loadModels"
      >
        <icon-lucide-loader-2 v-if="loading" class="inline size-2.5 animate-spin" />
        {{ loading ? dialogs.acpLoadingModels : dialogs.acpLoadModels }}
      </button>
    </div>

    <p
      v-if="loadError"
      data-test-id="acp-model-defaults-error"
      class="rounded border border-red-500/40 bg-red-500/10 px-2 py-1 text-[10px] text-red-200"
    >
      {{ loadError }}
    </p>

    <template v-if="knownModels.length > 0">
      <ProviderSettingsField v-for="slot in ACP_MODE_SLOTS" :key="slot" :label="slotLabels[slot]">
        <SelectRoot :model-value="valueFor(slot)" @update:model-value="onChange(slot, $event)">
          <SelectTrigger :class="selectCls.trigger" :data-test-id="`acp-model-default-${slot}`">
            <span class="truncate">{{ labelFor(slot) }}</span>
            <icon-lucide-chevron-down class="size-3 shrink-0 text-muted" />
          </SelectTrigger>
          <SelectPortal>
            <SelectContent position="popper" :side-offset="4" :class="selectCls.content">
              <SelectViewport>
                <SelectItem :value="AGENT_DEFAULT" :class="selectCls.item">
                  <SelectItemText>{{ dialogs.acpAgentDefault }}</SelectItemText>
                </SelectItem>
                <SelectItem
                  v-for="model in knownModels"
                  :key="model.id"
                  :value="model.id"
                  :class="selectCls.item"
                >
                  <SelectItemText>{{ model.name }}</SelectItemText>
                </SelectItem>
              </SelectViewport>
            </SelectContent>
          </SelectPortal>
        </SelectRoot>
      </ProviderSettingsField>
    </template>

    <p v-else class="text-[10px] leading-4 text-muted">
      {{ dialogs.acpModelsHint }}
    </p>
  </div>
</template>
