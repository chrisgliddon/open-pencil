import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expect, test, type Page } from '@playwright/test'
import { strToU8, zipSync } from 'fflate'

import { CanvasHelper } from '#tests/helpers/canvas'

declare global {
  interface Window {
    __sentPrompts?: string[]
  }
}

function writeFixtureZip(): string {
  const dir = mkdtempSync(join(tmpdir(), 'op-import-'))
  const zipPath = join(dir, 'mini-design.zip')
  const bytes = zipSync({
    'App.jsx': strToU8('const App = () => <PPW.Title />'),
    'Title.jsx': strToU8('const Title = () => <div className="title">Party</div>'),
    'HUD.jsx': strToU8('const HUD = () => <div className="hud" />'),
    'screens.css': strToU8('.title { color: #fff; }'),
    'assets-min/coin.png': strToU8('png-bytes')
  })
  writeFileSync(zipPath, bytes)
  return zipPath
}

async function injectRecordingTransport(page: Page) {
  await page.evaluate(() => {
    const setChatTransport = window.openPencil?.setChatTransport
    if (!setChatTransport) throw new Error('Transport override not available')
    window.__sentPrompts = []

    let msgCounter = 0
    setChatTransport(() => ({
      async sendMessages({
        messages
      }: {
        messages: Array<{ role: string; parts: Array<{ type: string; text?: string }> }>
      }) {
        const lastUser = [...messages].reverse().find((m) => m.role === 'user')
        const text = lastUser?.parts?.find((p) => p.type === 'text')?.text ?? ''
        window.__sentPrompts?.push(text)
        const msgId = `mock-msg-${++msgCounter}`
        return new ReadableStream({
          start(controller) {
            controller.enqueue({ type: 'start', messageId: msgId })
            controller.enqueue({ type: 'text-start', id: `${msgId}-t` })
            controller.enqueue({
              type: 'text-delta',
              id: `${msgId}-t`,
              delta: 'Plan: one Screens page.'
            })
            controller.enqueue({ type: 'text-end', id: `${msgId}-t` })
            controller.enqueue({ type: 'finish' })
            controller.close()
          }
        })
      },
      async reconnectToStream() {
        return null
      }
    }))
  })
}

test('Convert sends the conversion prompt and opens the AI tab', async ({ page }) => {
  const canvas = new CanvasHelper(page)
  await page.goto('/?test')
  await canvas.waitForInit()
  await injectRecordingTransport(page)

  // Configure a provider through the UI so the conversion is allowed to run.
  await page.getByTestId('properties-tab-ai').click()
  await page.getByTestId('api-key-input').fill('sk-or-test-key-12345')
  await page.getByTestId('api-key-save').click()

  await page.getByTestId('properties-tab-code').click()
  await page.getByTestId('code-panel-import-project-toggle').click()

  const zipPath = writeFixtureZip()
  const chooserPromise = page.waitForEvent('filechooser')
  await page.getByTestId('import-project-pick-zip').click()
  const chooser = await chooserPromise
  await chooser.setFiles(zipPath)

  await expect(page.getByTestId('import-project-screens')).toBeVisible()
  await expect(page.getByTestId('import-project-screen-row')).toHaveCount(2)

  await page.getByTestId('import-project-convert').click()

  // The conversion prompt reaches the transport…
  await expect
    .poll(async () => page.evaluate(() => window.__sentPrompts?.length ?? 0), { timeout: 15_000 })
    .toBe(1)
  const prompt = await page.evaluate(() => window.__sentPrompts?.[0] ?? '')
  expect(prompt).toContain('Convert this Claude Design project')
  expect(prompt).toContain('## Screens to convert (2)')
  expect(prompt).toContain('Title.jsx')

  // …the AI tab auto-opens and shows the running thread…
  await expect(page.getByTestId('properties-tab-ai')).toHaveAttribute('data-state', 'active')
  await expect(page.getByTestId('chat-panel')).toContainText('Plan: one Screens page.', {
    timeout: 10_000
  })

  // …and the import panel settles back to idle.
  await expect(page.getByTestId('import-project-convert')).not.toContainText('Converting', {
    timeout: 10_000
  })
})
