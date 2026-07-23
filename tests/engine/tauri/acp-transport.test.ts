import { afterEach, describe, expect, test, vi } from 'bun:test'

import { ACP_AGENTS } from '@open-pencil/core/constants'
import type { ACPChatTransport } from '@/app/ai/acp/transport'
import { createACPTransport } from '@/app/ai/chat/transports'

import { clearTauriMocks, mockTauriIPC } from '#tests/helpers/tauri/mocks'

afterEach(async () => {
  await clearTauriMocks()
  vi.restoreAllMocks()
  Reflect.deleteProperty(globalThis, 'window')
})

describe('Tauri ACP transport', () => {
  test('uses Tauri home directory for transport cwd', async () => {
    await mockTauriIPC((cmd, args) => {
      expect(cmd).toBe('plugin:path|resolve_directory')
      expect(args).toEqual({ directory: 21 })
      return '/Users/tester'
    })

    const transport = (await createACPTransport('acp:claude-code')) as ACPChatTransport & {
      cwd: string
    }

    expect(transport.cwd).toBe('/Users/tester')
  })

  test('supports OpenCode ACP provider', async () => {
    await mockTauriIPC((cmd, args) => {
      expect(cmd).toBe('plugin:path|resolve_directory')
      expect(args).toEqual({ directory: 21 })
      return '/Users/tester'
    })

    await createACPTransport('acp:opencode')
    const agent = ACP_AGENTS.find((item) => item.id === 'opencode')

    expect(agent?.command).toBe('opencode')
    expect(agent?.args).toEqual(['acp'])
  })
})
