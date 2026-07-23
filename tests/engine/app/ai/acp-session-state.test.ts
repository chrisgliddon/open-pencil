import { describe, expect, test } from 'bun:test'

import type { SessionConfigOption, SessionUpdate } from '@agentclientprotocol/sdk'

import {
  applySessionUpdate,
  configOptionIdForCategory,
  createEmptySessionState,
  modeLabel,
  sessionStateFromConfig
} from '@/app/ai/acp/session-state'

function modeOption(
  id: string,
  overrides: Partial<SessionConfigOption> = {}
): SessionConfigOption {
  return {
    type: 'select',
    category: 'mode',
    id: 'mode',
    name: 'Mode',
    currentValue: id,
    options: [
      { value: 'build', name: 'Build' },
      { value: 'plan', name: 'Plan' }
    ],
    ...overrides
  }
}

function modelOption(values: Array<{ value: string; name: string }>, current: string): SessionConfigOption {
  return {
    type: 'select',
    category: 'model',
    id: 'model',
    name: 'Model',
    currentValue: current,
    options: values.map((v) => ({ value: v.value, name: v.name }))
  }
}

describe('ACP session state', () => {
  test('sessionStateFromConfig parses mode and model config options', () => {
    const state = sessionStateFromConfig(
      [
        modeOption('plan'),
        modelOption(
          [
            { value: 'anthropic/claude-sonnet-4', name: 'Claude Sonnet 4' },
            { value: 'openai/gpt-5', name: 'GPT-5' }
          ],
          'anthropic/claude-sonnet-4'
        )
      ],
      null
    )

    expect(state.modes).toEqual([
      { id: 'build', name: 'Build', description: undefined },
      { id: 'plan', name: 'Plan', description: undefined }
    ])
    expect(state.currentModeId).toBe('plan')
    expect(state.models).toEqual([
      { id: 'anthropic/claude-sonnet-4', name: 'Claude Sonnet 4', description: undefined },
      { id: 'openai/gpt-5', name: 'GPT-5', description: undefined }
    ])
    expect(state.currentModelId).toBe('anthropic/claude-sonnet-4')
  })

  test('sessionStateFromConfig maps well-known mode ids to friendly labels', () => {
    const state = sessionStateFromConfig(
      [
        {
          type: 'select',
          category: 'mode',
          id: 'mode',
          name: 'Mode',
          currentValue: 'build',
          options: [
            { value: 'build', name: 'build' },
            { value: 'plan', name: 'plan' },
            { value: 'custom-agent', name: 'Custom Agent' }
          ]
        }
      ],
      null
    )

    expect(state.modes.map((m) => m.name)).toEqual(['Build', 'Plan', 'Custom Agent'])
  })

  test('sessionStateFromConfig fills models from the experimental models state', () => {
    const state = sessionStateFromConfig(null, {
      availableModels: [
        { modelId: 'claude-sonnet-4', name: 'Claude Sonnet 4' },
        { modelId: 'gpt-5', name: 'GPT-5' }
      ],
      currentModelId: 'gpt-5'
    })

    expect(state.models.map((m) => m.id)).toEqual(['claude-sonnet-4', 'gpt-5'])
    expect(state.currentModelId).toBe('gpt-5')
  })

  test('sessionStateFromConfig flattens grouped model options', () => {
    const state = sessionStateFromConfig(
      [
        {
          type: 'select',
          category: 'model',
          id: 'model',
          name: 'Model',
          currentValue: 'a1',
          options: [
            {
              group: 'anthropic',
              name: 'Anthropic',
              options: [
                { value: 'a1', name: 'Claude' },
                { value: 'a2', name: 'Haiku' }
              ]
            },
            {
              group: 'openai',
              name: 'OpenAI',
              options: [{ value: 'o1', name: 'GPT' }]
            }
          ]
        }
      ],
      null
    )

    expect(state.models.map((m) => m.id)).toEqual(['a1', 'a2', 'o1'])
  })

  test('applySessionUpdate handles current_mode_update', () => {
    const state = sessionStateFromConfig([modeOption('build')], null)
    const changed = applySessionUpdate(state, {
      sessionUpdate: 'current_mode_update',
      currentModeId: 'plan'
    } as SessionUpdate)

    expect(changed).toBe(true)
    expect(state.currentModeId).toBe('plan')
  })

  test('applySessionUpdate reports no change for a repeated mode', () => {
    const state = sessionStateFromConfig([modeOption('build')], null)
    expect(state.currentModeId).toBe('build')
    const changed = applySessionUpdate(state, {
      sessionUpdate: 'current_mode_update',
      currentModeId: 'build'
    } as SessionUpdate)

    expect(changed).toBe(false)
  })

  test('applySessionUpdate handles available_commands_update', () => {
    const state = createEmptySessionState()
    const changed = applySessionUpdate(state, {
      sessionUpdate: 'available_commands_update',
      availableCommands: [
        { name: 'init', description: 'Initialize project' },
        { name: 'compact', description: 'Compact conversation' }
      ]
    } as SessionUpdate)

    expect(changed).toBe(true)
    expect(state.commands.map((c) => c.name)).toEqual(['init', 'compact'])
  })

  test('applySessionUpdate preserves commands across config_option_update', () => {
    const state = createEmptySessionState()
    state.commands = [{ name: 'init', description: 'Initialize' }]
    const changed = applySessionUpdate(state, {
      sessionUpdate: 'config_option_update',
      configOptions: [modeOption('plan')]
    } as SessionUpdate)

    expect(changed).toBe(true)
    expect(state.currentModeId).toBe('plan')
    expect(state.commands.map((c) => c.name)).toEqual(['init'])
  })

  test('applySessionUpdate ignores message/tool updates', () => {
    const state = createEmptySessionState()
    // session_info_update is a real SessionUpdate the state reducer doesn't
    // handle (it carries title/updatedAt, not mode/model) — it should no-op.
    const changed = applySessionUpdate(state, {
      sessionUpdate: 'session_info_update',
      title: 'New title'
    })

    expect(changed).toBe(false)
  })

  test('configOptionIdForCategory resolves the option id', () => {
    const options = [modeOption('build'), modelOption([{ value: 'm', name: 'M' }], 'm')]
    expect(configOptionIdForCategory(options, 'mode')).toBe('mode')
    expect(configOptionIdForCategory(options, 'model')).toBe('model')
    expect(configOptionIdForCategory(null, 'mode')).toBe(null)
  })

  test('modeLabel maps well-known ids and falls back', () => {
    expect(modeLabel('build')).toBe('Build')
    expect(modeLabel('plan')).toBe('Plan')
    expect(modeLabel('custom', 'Custom Agent')).toBe('Custom Agent')
    expect(modeLabel('custom')).toBe('custom')
  })
})