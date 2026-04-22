<script setup lang="ts">
import { FontPickerRoot } from '@open-pencil/vue'

import { useSelectUI } from '@/components/ui/select'
import { usePopoverUI } from '@/components/ui/popover'
import { listFamilies, listGoogleFamilies, loadFont } from '@/engine/fonts'

const modelValue = defineModel<string>({ required: true })
const emit = defineEmits<{ select: [family: string] }>()

const cls = usePopoverUI({
  content: 'w-[var(--reka-combobox-trigger-width)] min-w-56 overflow-hidden p-0'
})
const selectCls = useSelectUI({
  trigger: 'w-full rounded px-2 py-1 text-xs',
  item: 'w-full gap-2 px-2 py-2 text-sm'
})

async function handleSelect(family: string) {
  // For Google Fonts, preload the regular weight on selection
  // so the canvas can render it immediately
  const isGoogle = (await listGoogleFamilies()).includes(family)
  if (isGoogle) {
    void loadFont(family, 'Regular')
  }
  emit('select', family)
}
</script>

<template>
  <FontPickerRoot
    v-model="modelValue"
    data-test-id="font-picker-root"
    :list-families="listFamilies"
    :list-google-families="listGoogleFamilies"
    :trigger-class="selectCls.trigger"
    :content-class="cls.content"
    item-class=""
    search-class="min-w-0 flex-1 border-none bg-transparent text-xs text-surface outline-none placeholder:text-muted"
    empty-class="px-2 py-3 text-center text-xs text-muted"
    empty-fonts-hint="Use the desktop app or Chrome/Edge to access system fonts."
    google-fonts-hint="Downloaded from Google Fonts on demand."
    @select="handleSelect"
  >
    <template #trigger>
      <button data-test-id="font-picker-trigger" :class="selectCls.trigger">
        <span class="truncate">{{ modelValue }}</span>
        <icon-lucide-chevron-down class="size-3 shrink-0 text-muted" />
      </button>
    </template>

    <template #item="{ family, selected }">
      <div
        data-test-id="font-picker-item"
        :class="selectCls.item"
        :style="{ fontFamily: `'${family}', sans-serif` }"
      >
        <icon-lucide-check v-if="selected" class="size-3 shrink-0 text-accent" />
        <span v-else class="size-3 shrink-0" />
        <span class="truncate">{{ family }}</span>
        <span v-if="family?.startsWith?.('Google:')" class="ml-auto text-[10px] text-muted"
          >Google</span
        >
      </div>
    </template>
  </FontPickerRoot>
</template>
