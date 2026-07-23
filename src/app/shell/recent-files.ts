import { useLocalStorage } from '@vueuse/core'
import { computed, watch } from 'vue'

import { IS_TAURI } from '@/constants'

export interface RecentFile {
  path: string
  name: string
  openedAt: number
}

const STORAGE_KEY = 'open-pencil:recent-files'
const MAX_RECENTS = 10

export const recentFiles = useLocalStorage<RecentFile[]>(STORAGE_KEY, [])

export const hasRecentFiles = computed(() => recentFiles.value.length > 0)

function dedupeByKey(files: RecentFile[], key: (file: RecentFile) => string): RecentFile[] {
  const seen = new Set<string>()
  const out: RecentFile[] = []
  for (const file of files) {
    const k = key(file)
    if (seen.has(k)) continue
    seen.add(k)
    out.push(file)
  }
  return out
}

/** Record a file as recently opened. Moves it to the front, dedupes by path, caps the list. */
export function recordRecentFile(path: string, name: string): void {
  if (!path) return
  const entry: RecentFile = { path, name: name || path.split('/').pop() || path, openedAt: Date.now() }
  const rest = recentFiles.value.filter((file) => file.path !== path)
  recentFiles.value = dedupeByKey([entry, ...rest], (file) => file.path).slice(0, MAX_RECENTS)
}

/** Clear the recent-files list. */
export function clearRecentFiles(): void {
  recentFiles.value = []
}

// Keep the native (Tauri) app menu's "Open Recent" submenu in sync with the
// persisted list. The browser menu reads recentFiles reactively and needs no
// rebuild; the native menu is static at build time, so we ask Rust to rebuild
// it whenever the list changes.
export function syncRecentFilesMenu(): void {
  if (!IS_TAURI) return
  watch(
    recentFiles,
    (files) => {
      void import('@tauri-apps/api/core')
        .then(({ invoke }) =>
          invoke('rebuild_recent_files_menu', {
            recents: files.map((file) => ({ path: file.path, name: file.name }))
          })
        )
        .catch(() => {
          /* command unavailable in older builds or non-tauri — ignore */
        })
    },
    { deep: true, immediate: true }
  )
}