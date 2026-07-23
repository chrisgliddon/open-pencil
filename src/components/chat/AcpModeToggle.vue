<script setup lang="ts">
import { computed } from 'vue'

import SegmentedControl from '@/components/ui/SegmentedControl.vue'
import type { ACPTransportHandle } from '@/app/ai/chat/transports'
import { modeLabel, type ACPChoice } from '@/app/ai/acp/session-state'

const { transport } = defineProps<{
  transport: ACPTransportHandle
}>()

const state = computed(() => transport.acpState.value)

// Only render when the agent advertises at least two modes. A single mode
// (or none) isn't worth a toggle.
const visible = computed(() => state.value.modes.length >= 2)
const options = computed(() =>
  state.value.modes.map((mode: ACPChoice) => ({
    value: mode.id,
    label: modeLabel(mode.id, mode.name)
  }))
)
const current = computed({
  get: () => state.value.currentModeId ?? '',
  set: (value: string) => {
    void transport.setMode(value)
  }
})
</script>

<template>
  <SegmentedControl
    v-if="visible"
    v-model="current"
    data-test-id="acp-mode-toggle"
    :options="options"
    label="Agent mode"
    size="sm"
  />
</template>