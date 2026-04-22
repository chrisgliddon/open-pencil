<script setup lang="ts">
import { nextTick, ref } from 'vue'
import {
  ComboboxAnchor,
  ComboboxContent,
  ComboboxInput,
  ComboboxItem,
  ComboboxItemIndicator,
  ComboboxPortal,
  ComboboxRoot,
  ComboboxVirtualizer,
  ComboboxViewport,
  TabsList,
  TabsRoot,
  TabsTrigger,
  type AcceptableValue
} from 'reka-ui'

import { useFontPicker } from '@open-pencil/vue/FontPicker/useFontPicker'

const props = defineProps<{
  listFamilies: () => Promise<string[]>
  listGoogleFamilies?: () => Promise<string[]>
  triggerClass?: string
  contentClass?: string
  itemClass?: string
  searchClass?: string
  viewportClass?: string
  emptyClass?: string
  emptySearchText?: string
  emptyFontsText?: string
  emptyFontsHint?: string
  googleFontsHint?: string
}>()

const modelValue = defineModel<string>({ required: true })
const emit = defineEmits<{ select: [family: string] }>()

const inputRef = ref<HTMLInputElement | null>(null)
const activeSource = ref<'system' | 'google'>('system')

function setInputRef(el: HTMLInputElement | null) {
  inputRef.value = el
}

const currentListFamilies = () =>
  activeSource.value === 'google' && props.listGoogleFamilies
    ? props.listGoogleFamilies()
    : props.listFamilies()

const { searchTerm, open, filtered, select } = useFontPicker({
  modelValue,
  listFamilies: currentListFamilies,
  onSelect: (family) => emit('select', family)
})

function switchSource(source: 'system' | 'google') {
  activeSource.value = source
  searchTerm.value = ''
}
</script>

<template>
  <ComboboxRoot
    v-model:open="open"
    :model-value="modelValue"
    :ignore-filter="true"
    @update:model-value="
      (v: AcceptableValue) => {
        if (typeof v === 'string') select(v)
      }
    "
  >
    <ComboboxAnchor as-child>
      <slot name="trigger" :value="modelValue" :open="open">
        <button :class="triggerClass">
          <span class="truncate">{{ modelValue }}</span>
        </button>
      </slot>
    </ComboboxAnchor>

    <ComboboxPortal>
      <ComboboxContent
        :side-offset="2"
        align="start"
        position="popper"
        :class="contentClass"
        @open-auto-focus.prevent
        @vue:mounted="nextTick(() => inputRef?.focus())"
      >
        <slot
          name="search"
          :search-term="searchTerm"
          :set-input-ref="setInputRef"
          :active-source="activeSource"
          :switch-source="switchSource"
        >
          <div v-if="listGoogleFamilies" class="flex border-b border-border">
            <TabsRoot
              :model-value="activeSource"
              @update:model-value="switchSource as (v: string) => void"
            >
              <TabsList class="flex px-2 pt-1">
                <TabsTrigger
                  value="system"
                  class="px-2 py-1 text-xs data-[state=active]:border-b-2 data-[state=active]:border-accent data-[state=active]:text-surface text-muted"
                  data-test-id="font-picker-tab-system"
                >
                  System
                </TabsTrigger>
                <TabsTrigger
                  value="google"
                  class="px-2 py-1 text-xs data-[state=active]:border-b-2 data-[state=active]:border-accent data-[state=active]:text-surface text-muted"
                  data-test-id="font-picker-tab-google"
                >
                  Google
                </TabsTrigger>
              </TabsList>
            </TabsRoot>
          </div>
          <div class="flex items-center gap-1 border-b border-border px-2 py-1">
            <icon-lucide-search class="size-3 shrink-0 text-muted" />
            <ComboboxInput
              ref="inputRef"
              v-model="searchTerm"
              :class="searchClass"
              placeholder="Search fonts…"
              autocomplete="off"
              autocorrect="off"
              autocapitalize="off"
              spellcheck="false"
            />
          </div>
        </slot>

        <ComboboxViewport :class="viewportClass ?? 'max-h-72 overflow-y-auto'">
          <ComboboxVirtualizer
            v-slot="{ option }"
            :options="filtered"
            :text-content="(family: string) => family"
            :estimate-size="36"
          >
            <slot name="item" :family="option" :selected="option === modelValue">
              <ComboboxItem
                :value="option"
                :class="itemClass"
                :style="{ fontFamily: `'${option}', sans-serif` }"
              >
                <ComboboxItemIndicator>
                  <slot name="indicator" :selected="option === modelValue" />
                </ComboboxItemIndicator>
                <span class="truncate">{{ option }}</span>
              </ComboboxItem>
            </slot>
          </ComboboxVirtualizer>

          <div v-if="filtered.length === 0 && searchTerm" :class="emptyClass">
            {{ emptySearchText ?? 'No fonts found' }}
          </div>
          <div v-else-if="filtered.length === 0" :class="emptyClass">
            <slot name="empty">
              <div>
                <p>{{ emptyFontsText ?? 'No fonts available.' }}</p>
                <p v-if="emptyFontsHint" class="mt-1">{{ emptyFontsHint }}</p>
              </div>
            </slot>
          </div>
        </ComboboxViewport>
      </ComboboxContent>
    </ComboboxPortal>
  </ComboboxRoot>
</template>
