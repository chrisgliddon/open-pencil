<script setup lang="ts">
import { computed } from 'vue'
import {
  SelectContent,
  SelectItem,
  SelectItemText,
  SelectPortal,
  SelectRoot,
  SelectTrigger,
  SelectViewport
} from 'reka-ui'

import { useSelectUI } from '@/components/ui/select'
import type { ACPTransportHandle } from '@/app/ai/chat/transports'

const { transport } = defineProps<{
  transport: ACPTransportHandle
}>()

const state = computed(() => transport.acpState.value)
const visible = computed(() => state.value.models.length > 0)

const selectCls = useSelectUI({
  trigger: 'gap-1 rounded border-none bg-transparent px-1.5 py-0.5 text-[10px] text-muted',
  content: 'max-h-60 overflow-y-auto',
  item: 'gap-2 rounded px-2 py-1.5 text-[11px]'
})

const currentName = computed(
  () =>
    state.value.models.find((m) => m.id === state.value.currentModelId)?.name ??
    state.value.currentModelId ??
    'Model'
)

function handleChange(value: string) {
  void transport.setModel(value)
}
</script>

<template>
  <SelectRoot
    v-if="visible"
    :model-value="state.currentModelId ?? ''"
    data-test-id="acp-model-select"
    @update:model-value="handleChange"
  >
    <SelectTrigger :class="selectCls.trigger">
      <icon-lucide-bot class="size-3" />
      {{ currentName }}
      <icon-lucide-chevron-down class="size-2.5" />
    </SelectTrigger>
    <SelectPortal>
      <SelectContent position="popper" side="top" :side-offset="4" :class="selectCls.content">
        <SelectViewport>
          <SelectItem
            v-for="model in state.models"
            :key="model.id"
            :value="model.id"
            :class="selectCls.item"
          >
            <SelectItemText class="flex-1">{{ model.name }}</SelectItemText>
          </SelectItem>
        </SelectViewport>
      </SelectContent>
    </SelectPortal>
  </SelectRoot>
</template>
