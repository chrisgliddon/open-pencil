import { ClientSideConnection, ndJsonStream, PROTOCOL_VERSION } from '@agentclientprotocol/sdk'
import type {
  Client,
  Agent,
  NewSessionResponse,
  SessionNotification,
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionConfigOption,
  SessionUpdate
} from '@agentclientprotocol/sdk'
import type { ChatTransport, UIMessage, UIMessageChunk } from 'ai'
import type { ShallowRef } from 'vue'

import type { ACPAgentDef } from '@open-pencil/core/constants'

import { rememberAcpModels } from '@/app/ai/chat/storage'
import SYSTEM_PROMPT from '@/app/ai/chat/system-prompt.md?raw'

import { mapUpdate } from './map-update'
import { defaultModelForMode } from './model-defaults'
import { spawnAcpProcess } from './process'
import {
  applySessionUpdate,
  configOptionIdForCategory,
  createEmptySessionState,
  createSessionStateRefs,
  sessionStateFromConfig,
  type ACPSessionState
} from './session-state'

type TauriChild = Awaited<ReturnType<typeof spawnAcpProcess>>['child']

interface ACPDebugEntry {
  ts: number
  type: string
  data: unknown
}

interface ACPSession {
  connection: ClientSideConnection
  sessionId: string
  child: TauriChild
  onUpdate: ((params: SessionNotification) => void) | null
  dead: boolean
  configOptions: SessionConfigOption[] | null
}

const MAX_LOG_AGE_MS = 5 * 60 * 1000
const IS_DEV = import.meta.env.DEV

const acpDebugLog: ACPDebugEntry[] = []

function pruneOldEntries() {
  const cutoff = Date.now() - MAX_LOG_AGE_MS
  while (acpDebugLog.length > 0 && acpDebugLog[0].ts < cutoff) {
    acpDebugLog.shift()
  }
}

export function getAcpDebugText(): string {
  pruneOldEntries()
  return acpDebugLog
    .map((e) => `[${new Date(e.ts).toISOString()}] ${e.type}\n${JSON.stringify(e.data, null, 2)}`)
    .join('\n\n---\n\n')
}

export function clearAcpDebugLog() {
  acpDebugLog.length = 0
}

export function hasAcpDebugEntries(): boolean {
  pruneOldEntries()
  return acpDebugLog.length > 0
}

function isMissingCommandError(message: string): boolean {
  const normalized = message.toLowerCase()
  return normalized.includes('enoent') || normalized.includes('program not found')
}

const SESSION_STATE_UPDATE_TYPES = new Set<SessionUpdate['sessionUpdate']>([
  'current_mode_update',
  'available_commands_update',
  'config_option_update'
])

function isSessionStateUpdate(update: SessionUpdate): boolean {
  return SESSION_STATE_UPDATE_TYPES.has(update.sessionUpdate)
}

function missingCommandMessage(agentDef?: ACPAgentDef): string {
  if (!agentDef) return 'ACP agent CLI is not installed.'
  if (!agentDef.installCommand) {
    return `"${agentDef.command}" is not installed. Install it and restart OpenPencil.`
  }
  return `"${agentDef.command}" is not installed. Install it with: ${agentDef.installCommand}`
}

export function formatConnectionError(e: unknown, agentDef?: ACPAgentDef): string {
  const msg = e instanceof Error ? e.message : String(e)
  if (
    msg.includes('ECONNREFUSED') ||
    msg.includes('fetch failed') ||
    msg.includes('Failed to fetch')
  ) {
    return 'MCP server is not running. Make sure the editor is open.'
  }
  if (msg.includes('timeout') || msg.includes('Timeout') || msg.includes('ETIMEDOUT')) {
    return 'MCP server did not respond in time.'
  }
  if (isMissingCommandError(msg)) {
    return missingCommandMessage(agentDef)
  }
  return msg
}

export function buildCrashChunks(
  destroying: boolean,
  textId: string,
  textStarted: boolean
): { chunks: UIMessageChunk[]; shouldNullSession: boolean } {
  if (destroying) return { chunks: [], shouldNullSession: false }
  const chunks: UIMessageChunk[] = []
  if (textStarted) chunks.push({ type: 'text-end', id: textId })
  chunks.push({ type: 'error', errorText: 'Agent process exited unexpectedly.' })
  chunks.push({ type: 'finish-step' })
  chunks.push({ type: 'finish', finishReason: 'error' })
  return { chunks, shouldNullSession: true }
}

export class ACPChatTransport implements ChatTransport<UIMessage> {
  private session: ACPSession | null = null
  private agentDef: ACPAgentDef
  private cwd: string
  private sentContext = false
  private destroying = false
  // Reactive ACP session capabilities (modes, models, commands, current
  // selections). Populated from NewSessionResponse and kept in sync with
  // current_mode_update / available_commands_update / config_option_update
  // notifications. The chat UI reads this to render the Plan/Build toggle,
  // model dropdown, and slash-command autocomplete.
  readonly sessionState: ShallowRef<ACPSessionState>

  constructor(options: { agentDef: ACPAgentDef; cwd?: string }) {
    this.agentDef = options.agentDef
    this.cwd = options.cwd ?? '.'
    this.sessionState = createSessionStateRefs().state
  }

  /** Reactive ACP session state for the chat UI (modes, models, commands). */
  get acpState(): ShallowRef<ACPSessionState> {
    return this.sessionState
  }

  /** Switch the agent's operational mode (e.g. Plan/Build). No-op if unset. */
  async setMode(modeId: string): Promise<void> {
    const session = this.session
    if (!session) return
    const configId = configOptionIdForCategory(session.configOptions, 'mode')
    if (configId) {
      await session.connection.setSessionConfigOption({
        sessionId: session.sessionId,
        configId,
        value: modeId
      })
    } else {
      await session.connection.setSessionMode({
        sessionId: session.sessionId,
        modeId
      })
    }
    this.sessionState.value = { ...this.sessionState.value, currentModeId: modeId }
    await this.applyConfiguredModel()
  }

  /**
   * Apply the user's configured default model for the current mode slot
   * (Plan/Build/Auto per agent, from AI settings). Skipped when nothing is
   * configured, the model is already active, or the agent doesn't advertise
   * the configured model.
   */
  private async applyConfiguredModel(): Promise<void> {
    const state = this.sessionState.value
    const wanted = defaultModelForMode(this.agentDef.id, state.modes, state.currentModeId)
    if (!wanted || wanted === state.currentModelId) return
    if (state.models.length > 0 && !state.models.some((model) => model.id === wanted)) return
    try {
      await this.setModel(wanted)
    } catch (e) {
      // The agent rejected the model — keep its own default.
      console.warn(`ACP default model "${wanted}" was rejected by ${this.agentDef.id}:`, e)
    }
  }

  /**
   * Spawn the agent session (if needed) and return the advertised session
   * state. Used by AI settings to list an agent's models without sending a
   * prompt.
   */
  async ensureSessionState(): Promise<ACPSessionState> {
    if (this.session?.dead) {
      this.session = null
      this.sessionState.value = createEmptySessionState()
    }
    if (!this.session) {
      this.session = await this.spawnAgent()
      await this.applyConfiguredModel()
    }
    return this.sessionState.value
  }

  /** Switch the agent's active model. No-op if unset or unsupported. */
  async setModel(modelId: string): Promise<void> {
    const session = this.session
    if (!session) return
    const configId = configOptionIdForCategory(session.configOptions, 'model')
    if (configId) {
      await session.connection.setSessionConfigOption({
        sessionId: session.sessionId,
        configId,
        value: modelId
      })
    } else {
      await session.connection.unstable_setSessionModel({
        sessionId: session.sessionId,
        modelId
      })
    }
    this.sessionState.value = { ...this.sessionState.value, currentModelId: modelId }
  }

  async sendMessages({
    messages,
    abortSignal
  }: Parameters<ChatTransport<UIMessage>['sendMessages']>[0]): Promise<
    ReadableStream<UIMessageChunk>
  > {
    const lastUserMessage = [...messages].reverse().find((m) => m.role === 'user')
    const text =
      lastUserMessage?.parts
        .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
        .map((p) => p.text)
        .join('\n') ?? ''

    await this.ensureSessionState()
    if (!this.session) throw new Error('ACP session is not available.')

    const promptText = this.sentContext ? text : `${SYSTEM_PROMPT}\n\n${text}`
    this.sentContext = true

    const { connection, sessionId } = this.session
    const session = this.session

    return new ReadableStream<UIMessageChunk>({
      start: (controller) => {
        const textId = `text-${Date.now()}`
        let textStarted = false
        let closed = false

        function finish(reason: 'stop' | 'other' | 'error', errorText?: string) {
          if (closed) return
          closed = true
          if (errorText) controller.enqueue({ type: 'error', errorText })
          if (textStarted) controller.enqueue({ type: 'text-end', id: textId })
          controller.enqueue({ type: 'finish-step' })
          controller.enqueue({ type: 'finish', finishReason: reason })
          session.onUpdate = null
          controller.close()
        }

        session.onUpdate = (params) => {
          if (closed) return
          if (IS_DEV) {
            acpDebugLog.push({
              ts: Date.now(),
              type: params.update.sessionUpdate,
              data: params.update
            })
          }
          // Route state-changing updates (mode, commands, config options) to
          // the reactive session state before mapping message chunks. These
          // updates carry no message text, so they don't produce UIMessageChunks.
          if (isSessionStateUpdate(params.update)) {
            const next = { ...this.sessionState.value }
            if (applySessionUpdate(next, params.update)) {
              this.sessionState.value = next
              rememberAcpModels(this.agentDef.id, next.models)
              // A mode change (agent- or user-initiated) re-applies the
              // configured default model for the new mode's slot.
              if (params.update.sessionUpdate === 'current_mode_update') {
                void this.applyConfiguredModel()
              }
            }
            return
          }
          const result = mapUpdate(params.update, textId, textStarted)
          for (const chunk of result.chunks) {
            controller.enqueue(chunk)
          }
          textStarted = result.textStarted
        }

        abortSignal?.addEventListener('abort', () => {
          void connection.cancel({ sessionId })
          finish('stop')
        })

        controller.enqueue({ type: 'start' })
        controller.enqueue({ type: 'start-step' })

        connection
          .prompt({
            sessionId,
            prompt: [{ type: 'text', text: promptText }]
          })
          .then((result) => {
            finish(result.stopReason === 'end_turn' ? 'stop' : 'other')
            return undefined
          })
          .catch((e) => {
            finish('error', formatConnectionError(e, this.agentDef))
          })
      }
    })
  }

  async reconnectToStream(): Promise<ReadableStream<UIMessageChunk> | null> {
    return null
  }

  async destroy(): Promise<void> {
    this.destroying = true
    if (this.session) {
      await this.session.child.kill()
      this.session = null
    }
    this.sessionState.value = createEmptySessionState()
  }

  private async spawnAgent(): Promise<ACPSession> {
    let process: Awaited<ReturnType<typeof spawnAcpProcess>>
    try {
      process = await spawnAcpProcess({
        command: this.agentDef.command,
        args: this.agentDef.args,
        logId: this.agentDef.id,
        destroying: () => this.destroying,
        onUnexpectedClose: () => {
          if (!this.session) return
          this.session.dead = true
          this.session = null
        }
      })
    } catch (e) {
      throw new Error(formatConnectionError(e, this.agentDef))
    }

    const { child, input, output } = process
    const stream = ndJsonStream(input, output)
    let onUpdate: ACPSession['onUpdate'] = null

    const clientImpl: Client = {
      async requestPermission(
        params: RequestPermissionRequest
      ): Promise<RequestPermissionResponse> {
        const { requestPermissionFromUser } = await import('@/app/ai/acp/permission')
        return requestPermissionFromUser(params)
      },

      async sessionUpdate(params: SessionNotification): Promise<void> {
        onUpdate?.(params)
      }
    }

    const connection = new ClientSideConnection((_agent: Agent) => clientImpl, stream)
    const { getAutomationAuthToken } = await import('@/app/automation/mcp/spawn')
    const automationAuthToken = await getAutomationAuthToken()

    await connection.initialize({
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: {}
    })

    let sessionResult: NewSessionResponse
    try {
      sessionResult = await connection.newSession({
        cwd: this.cwd,
        mcpServers: [
          {
            type: 'http' as const,
            name: 'open-pencil',
            url: 'http://127.0.0.1:7600/mcp',
            headers: automationAuthToken
              ? [{ name: 'Authorization', value: `Bearer ${automationAuthToken}` }]
              : []
          }
        ]
      })
    } catch (e) {
      await child.kill()
      throw new Error(formatConnectionError(e, this.agentDef))
    }

    // Seed the reactive session state from the agent's advertised config
    // options (mode/model selects) and optional model state. The UI renders
    // the Plan/Build toggle and model dropdown from this.
    const configOptions = sessionResult.configOptions ?? null
    this.sessionState.value = sessionStateFromConfig(configOptions, sessionResult.models ?? null)
    rememberAcpModels(this.agentDef.id, this.sessionState.value.models)

    const session: ACPSession = {
      connection,
      sessionId: sessionResult.sessionId,
      child,
      dead: false,
      configOptions,
      get onUpdate() {
        return onUpdate
      },
      set onUpdate(fn) {
        onUpdate = fn
      }
    }

    return session
  }
}
