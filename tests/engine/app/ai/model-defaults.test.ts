import { describe, expect, test } from 'bun:test'

import { defaultModelForMode, slotForMode } from '@/app/ai/acp/model-defaults'
import { setAcpDefaultModel } from '@/app/ai/chat/storage'

describe('slotForMode', () => {
  test('maps plan-ish modes to plan', () => {
    expect(slotForMode({ id: 'plan', name: 'Plan' })).toBe('plan')
    expect(slotForMode({ id: 'planning', name: '' })).toBe('plan')
  })

  test('maps auto-accepting modes to auto', () => {
    expect(slotForMode({ id: 'acceptEdits', name: 'Accept Edits' })).toBe('auto')
    expect(slotForMode({ id: 'bypassPermissions', name: 'Bypass Permissions' })).toBe('auto')
    expect(slotForMode({ id: 'full-access', name: 'Full Access' })).toBe('auto')
    expect(slotForMode({ id: 'yolo', name: '' })).toBe('auto')
  })

  test('maps the normal interactive mode to build', () => {
    expect(slotForMode({ id: 'build', name: 'Build' })).toBe('build')
    expect(slotForMode({ id: 'default', name: 'Default' })).toBe('build')
    expect(slotForMode({ id: 'read-only', name: 'Read Only' })).toBe('build')
  })
})

describe('defaultModelForMode', () => {
  const MODES = [
    { id: 'plan', name: 'Plan' },
    { id: 'build', name: 'Build' },
    { id: 'bypassPermissions', name: 'Bypass Permissions' }
  ]

  test('resolves the configured model for the current mode slot', () => {
    setAcpDefaultModel('opencode', 'plan', 'anthropic/claude-fable-5')
    setAcpDefaultModel('opencode', 'build', 'ollama/minimax-m3')
    setAcpDefaultModel('opencode', 'auto', 'anthropic/claude-opus-4-8')

    expect(defaultModelForMode('opencode', MODES, 'plan')).toBe('anthropic/claude-fable-5')
    expect(defaultModelForMode('opencode', MODES, 'build')).toBe('ollama/minimax-m3')
    expect(defaultModelForMode('opencode', MODES, 'bypassPermissions')).toBe(
      'anthropic/claude-opus-4-8'
    )
  })

  test('falls back to the build slot for unknown modes and returns empty when unset', () => {
    setAcpDefaultModel('codex', 'build', 'gpt-5.2-codex')
    expect(defaultModelForMode('codex', MODES, 'nonexistent-mode')).toBe('gpt-5.2-codex')
    expect(defaultModelForMode('claude-code', MODES, 'build')).toBe('')
  })

  test('defaults are stored per agent', () => {
    setAcpDefaultModel('opencode', 'plan', 'ollama/minimax-m3')
    expect(defaultModelForMode('gemini-cli', MODES, 'plan')).toBe('')
  })
})
