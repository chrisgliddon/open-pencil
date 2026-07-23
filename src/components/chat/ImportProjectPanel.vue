<script setup lang="ts">
import { computed, ref, shallowRef } from 'vue'
import { useFileDialog } from '@vueuse/core'

import AppTextButton from '@/components/ui/AppTextButton.vue'
import { useI18n } from '@open-pencil/vue'
import { isTauri } from '@/app/tauri/env'
import { useEditorStore } from '@/app/editor/active-store'
import { toast } from '@/app/shell/ui'
import {
  pickProjectFolder,
  readProjectFolder,
  readProjectZip,
  type ProjectManifest
} from '@/app/import-claude-design/read-project'
import { convertProjectWithLLM } from '@/app/import-claude-design/convert'

const { dialogs } = useI18n()
const store = useEditorStore()

const manifest = shallowRef<ProjectManifest | null>(null)
const scanning = ref(false)
const converting = ref(false)
const error = ref('')
const selectedScreens = ref<Set<string>>(new Set())

const zipDialog = useFileDialog({ accept: '.zip', multiple: false, reset: true })

zipDialog.onChange((files) => {
  const file = files?.[0]
  if (file) void handleZipFile(file)
})

const screenNames = computed(() =>
  (manifest.value?.screens ?? []).map((screen) => screen.componentName)
)
const selectedCount = computed(() => selectedScreens.value.size)
const canConvert = computed(() => !!manifest.value && selectedCount.value > 0 && !converting.value)

async function handleZipFile(file: File) {
  scanning.value = true
  error.value = ''
  try {
    manifest.value = await readProjectZip(file)
    selectedScreens.value = new Set(manifest.value.screens.map((screen) => screen.componentName))
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
    manifest.value = null
  } finally {
    scanning.value = false
  }
}

async function pickFolder() {
  if (!isTauri()) return
  scanning.value = true
  error.value = ''
  try {
    const folder = await pickProjectFolder()
    if (!folder) {
      scanning.value = false
      return
    }
    manifest.value = await readProjectFolder(folder)
    if (manifest.value.screens.length === 0) {
      error.value = dialogs.value.noScreens
    }
    selectedScreens.value = new Set(manifest.value.screens.map((screen) => screen.componentName))
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
    manifest.value = null
  } finally {
    scanning.value = false
  }
}

function toggleScreen(name: string) {
  const next = new Set(selectedScreens.value)
  if (next.has(name)) next.delete(name)
  else next.add(name)
  selectedScreens.value = next
}

function selectAll() {
  selectedScreens.value = new Set(screenNames.value)
}

function clearSelection() {
  selectedScreens.value = new Set()
}

async function convert() {
  if (!manifest.value || !canConvert.value) return
  converting.value = true
  error.value = ''
  try {
    // Switching to the AI tab makes the streaming conversion visible.
    store.state.activeRibbonTab = 'ai'
    const result = await convertProjectWithLLM(
      manifest.value,
      [...selectedScreens.value]
    )
    if (!result.ok) {
      error.value = result.error ?? 'Conversion failed.'
    } else {
      toast.info(dialogs.value.convertDone)
    }
  } finally {
    converting.value = false
  }
}
</script>

<template>
  <div data-test-id="import-project-panel" class="shrink-0 border-b border-border p-3">
    <div class="mb-2 flex items-center justify-between gap-2">
      <div class="min-w-0">
        <div class="text-xs font-medium text-surface">Import Claude Design project</div>
        <div class="text-[11px] text-muted">{{ dialogs.importProjectFolder }}</div>
      </div>
    </div>

    <div class="mb-2 flex items-center gap-1.5">
      <AppTextButton
        v-if="isTauri()"
        data-test-id="import-project-pick-folder"
        :ui="{ base: 'rounded px-2 py-1 text-[11px] bg-hover hover:bg-hover/70' }"
        :disabled="scanning || converting"
        @click="pickFolder"
      >
        <icon-lucide-folder-open class="size-3" />
        {{ dialogs.pickFolder }}
      </AppTextButton>
      <AppTextButton
        data-test-id="import-project-pick-zip"
        :ui="{ base: 'rounded px-2 py-1 text-[11px] bg-hover hover:bg-hover/70' }"
        :disabled="scanning || converting"
        @click="zipDialog.open()"
      >
        <icon-lucide-file-archive class="size-3" />
        {{ dialogs.pickZip }}
      </AppTextButton>
    </div>

    <div
      v-if="scanning"
      data-test-id="import-project-scanning"
      class="mb-2 flex items-center gap-1.5 text-[11px] text-muted"
    >
      <icon-lucide-loader-2 class="size-3 animate-spin" />
      {{ dialogs.scanning }}
    </div>

    <div
      v-if="error"
      data-test-id="import-project-error"
      class="mb-2 rounded border border-red-500/40 bg-red-500/10 px-2 py-1.5 text-[11px] text-red-200"
    >
      {{ error }}
    </div>

    <div v-if="manifest && !scanning" data-test-id="import-project-screens">
      <div class="mb-1.5 flex items-center justify-between">
        <span class="text-[11px] text-muted">
          {{ dialogs.screensFound({ count: manifest.screens.length }) }}
        </span>
        <div class="flex items-center gap-1">
          <AppTextButton
            data-test-id="import-project-select-all"
            :ui="{ base: 'rounded px-1.5 py-0.5 text-[10px] hover:bg-hover' }"
            @click="selectAll"
          >
            {{ dialogs.selectAllScreens }}
          </AppTextButton>
          <AppTextButton
            data-test-id="import-project-clear"
            :ui="{ base: 'rounded px-1.5 py-0.5 text-[10px] hover:bg-hover' }"
            @click="clearSelection"
          >
            {{ dialogs.clearScreenSelection }}
          </AppTextButton>
        </div>
      </div>

      <div class="mb-2 max-h-40 overflow-y-auto rounded border border-border">
        <label
          v-for="name in screenNames"
          :key="name"
          data-test-id="import-project-screen-row"
          class="flex cursor-pointer items-center gap-2 px-2 py-1 text-[11px] hover:bg-hover"
        >
          <input
            type="checkbox"
            :checked="selectedScreens.has(name)"
            class="size-3 accent-[var(--color-accent)]"
            @change="toggleScreen(name)"
          />
          <span class="min-w-0 flex-1 truncate text-surface">{{ name }}</span>
        </label>
      </div>

      <AppTextButton
        data-test-id="import-project-convert"
        :ui="{
          base: [
            'w-full rounded px-2 py-1.5 text-[11px] font-medium',
            canConvert ? 'bg-accent text-black hover:bg-accent/90' : 'cursor-not-allowed opacity-50'
          ].join(' ')
        }"
        @click="convert"
      >
        <icon-lucide-loader-2 v-if="converting" class="size-3 animate-spin" />
        <icon-lucide-sparkles v-else class="size-3" />
        {{ converting ? dialogs.converting : dialogs.convertScreens({ count: selectedCount }) }}
      </AppTextButton>
    </div>
  </div>
</template>