import { describe, expect, test } from 'bun:test'

import { computeAllLayouts, createEditor } from '@open-pencil/core'

import { autoFrame, pageId, rect } from '#tests/helpers/layout'

// `prepareForExport` (packages/core/src/canvas/renderer/fonts.ts) runs
// `computeAllLayouts` to compute export-time positions. `applyYogaLayout` writes
// the computed x/y/width/height back through `graph.updateNode`, which emits
// `node:updated` and bumps `sceneVersion`. Export callers (asset preview,
// export panel) re-render on `sceneVersion`, so a committed mutation there
// creates a feedback loop that freezes the app. The fix wraps the layout pass
// in `graph.runPreviewUpdates`, redirecting `updateNode` to `updateNodePreview`.
// These tests lock that invariant without needing a real CanvasKit renderer.
describe('prepareForExport layout pass', () => {
  test('computeAllLayouts inside runPreviewUpdates does not bump sceneVersion', () => {
    const editor = createEditor()
    const graph = editor.graph
    const page = pageId(graph)

    // HUG-sized frame so `applyFrameSize` writes width/height back, and
    // children whose x/y are recomputed by `updateChildFromYoga`.
    const frame = autoFrame(graph, page, {
      primaryAxisSizing: 'HUG',
      counterAxisSizing: 'HUG',
      width: 999,
      height: 999,
      itemSpacing: 10
    })
    rect(graph, frame.id, 50, 50)
    rect(graph, frame.id, 70, 50)

    const initialSceneVersion = editor.state.sceneVersion
    let committedUpdates = 0
    editor.onEditorEvent('node:updated', () => {
      committedUpdates++
    })

    graph.runPreviewUpdates(() => computeAllLayouts(graph, page))

    expect(committedUpdates).toBe(0)
    expect(editor.state.sceneVersion).toBe(initialSceneVersion)

    // Sanity: the layout actually ran and wrote back (HUG width = 50 + 10 + 70).
    expect(graph.getNode(frame.id)?.width).toBe(130)
  })

  test('computeAllLayouts without runPreviewUpdates commits node updates', () => {
    const editor = createEditor()
    const graph = editor.graph
    const page = pageId(graph)

    const frame = autoFrame(graph, page, {
      primaryAxisSizing: 'HUG',
      counterAxisSizing: 'HUG',
      width: 999,
      height: 999,
      itemSpacing: 10
    })
    rect(graph, frame.id, 50, 50)
    rect(graph, frame.id, 70, 50)

    const initialSceneVersion = editor.state.sceneVersion
    let committedUpdates = 0
    editor.onEditorEvent('node:updated', () => {
      committedUpdates++
    })

    computeAllLayouts(graph, page)

    // Without the wrapper, every layout writeback is a committed mutation.
    expect(committedUpdates).toBeGreaterThan(0)
    expect(editor.state.sceneVersion).toBeGreaterThan(initialSceneVersion)
  })
})
