<script setup lang="ts">
import { computed } from 'vue'

import type { ACPTransportHandle } from '@/app/ai/chat/transports'

const { transport, input } = defineProps<{
  transport: ACPTransportHandle
  input: string
}>()

const emit = defineEmits<{
  select: [command: string]
}>()

const commands = computed(() => transport.acpState.value.commands)

// Show the menu only when the input starts with "/" and the user is still
// typing the command name (no space yet). Once a space is present the
// command is resolved and args follow, so we stop suggesting.
const query = computed(() => {
  const text = input
  if (!text.startsWith('/')) return null
  const rest = text.slice(1)
  if (rest.includes(' ')) return null
  return rest.toLowerCase()
})

const visible = computed(() => query.value !== null && filtered.value.length > 0)

const filtered = computed(() => {
  const q = query.value
  if (q === null) return []
  const all = commands.value
  if (q === '') return all.slice(0, 12)
  return all.filter((c) => c.name.toLowerCase().includes(q)).slice(0, 12)
})

function select(name: string) {
  emit('select', `/${name} `)
}
</script>

<template>
  <div
    v-if="visible"
    data-test-id="acp-command-menu"
    class="absolute bottom-full left-0 mb-1 max-h-52 w-64 overflow-y-auto rounded-lg border border-border bg-panel py-1 text-[11px] shadow-lg"
  >
    <button
      v-for="command in filtered"
      :key="command.name"
      type="button"
      data-test-id="acp-command-item"
      class="flex w-full flex-col items-start gap-0.5 px-2.5 py-1.5 text-left hover:bg-hover"
      @click="select(command.name)"
    >
      <span class="font-medium text-surface">/{{ command.name }}</span>
      <span v-if="command.description" class="line-clamp-2 text-muted">{{ command.description }}</span>
    </button>
  </div>
</template>