// Scale benchmark: sweeps each axis independently and reports ms for the
// key hot paths. Finds the breaking point (where a single op exceeds a
// frame budget). Run: `bun tools/scale-bench/src/index.ts`
import { headlessRenderNodes } from '@open-pencil/core/io/formats/raster'

import { benchAbsPosCold, benchLayout, generateDoc, type ScaleAxis } from './generate'

const FRAME_BUDGET_MS = 16 // 60fps frame
const JANK_MS = 100 // "noticeably stuck" threshold

interface Row {
  label: string
  axis: Partial<ScaleAxis>
  nodes: number
  depth: number
  layoutMs: number
  absPosMs: number
  renderMs: number | null
}

function fmtMs(ms: number | null): string {
  if (ms === null) return '—'
  if (ms < 10) return `${ms.toFixed(1)}ms`
  return `${Math.round(ms)}ms`
}

function flag(ms: number | null): string {
  if (ms === null) return ''
  if (ms > JANK_MS) return '  ❌ JANK'
  if (ms > FRAME_BUDGET_MS) return '  ⚠️  >frame'
  return ''
}

async function runRow(label: string, axis: Partial<ScaleAxis>): Promise<Row> {
  const doc = generateDoc(axis)
  const layoutMs = benchLayout(doc)
  const absPosMs = benchAbsPosCold(doc)

  let renderMs: number | null = null
  // Headless render exercises prepareForExport + recordScenePicture + encode.
  // Cap at 20s; large docs may OOM the WASM heap.
  try {
    const t = performance.now()
    const result = await Promise.race([
      headlessRenderNodes(
        doc.graph,
        doc.pageId,
        doc.graph.getChildren(doc.pageId).map((n) => n.id),
        {
          scale: 1,
          format: 'PNG'
        }
      ),
      new Promise<null>((resolve) => {
        setTimeout(resolve, 20000)
      })
    ])
    if (result) renderMs = performance.now() - t
  } catch {
    renderMs = null
  }

  return {
    label,
    axis,
    nodes: doc.nodeCount,
    depth: doc.maxDepth,
    layoutMs,
    absPosMs,
    renderMs
  }
}

function printTable(rows: Row[]): void {
  const head = ['scenario', 'nodes', 'depth', 'layout', 'absPos(cold)', 'render']
  const data = rows.map((r) => [
    r.label,
    String(r.nodes),
    String(r.depth),
    fmtMs(r.layoutMs) + flag(r.layoutMs),
    fmtMs(r.absPosMs) + flag(r.absPosMs),
    fmtMs(r.renderMs) + flag(r.renderMs)
  ])
  const widths = head.map((h, i) => Math.max(h.length, ...data.map((row) => row[i].length)))
  const fmtRow = (row: string[]) =>
    row.map((c, i) => c.padEnd(widths[i] + (row === head ? 0 : 0))).join('  ')
  console.log(fmtRow(head))
  console.log(widths.map((w) => '─'.repeat(w)).join('──'))
  for (const row of data) console.log(fmtRow(row))
}

async function main() {
  console.log('OpenPencil scale benchmark\n')

  // 1. Node count sweep (flat leaves on one page).
  console.log('── Axis 1: total node count (flat leaves, depth=1) ──')
  const nodeRows: Row[] = []
  for (const n of [100, 500, 1000, 5000, 10000, 25000, 50000]) {
    nodeRows.push(await runRow(`N=${n}`, { nodes: n }))
  }
  printTable(nodeRows)

  // 2. Depth sweep (nested groups).
  console.log('\n── Axis 2: tree depth (nested unclipped groups) ──')
  const depthRows: Row[] = []
  for (const d of [10, 50, 100, 250, 500, 1000]) {
    depthRows.push(await runRow(`D=${d}`, { nodes: 0, depth: d }))
  }
  printTable(depthRows)

  // 3. Component child count (exercises syncChildren sort — quadratic risk).
  console.log('\n── Axis 3: component direct-child count (sync sort) ──')
  const childRows: Row[] = []
  for (const c of [10, 50, 100, 250, 500, 1000]) {
    childRows.push(
      await runRow(`children=${c}`, { nodes: 0, components: 1, childrenPerComponent: c })
    )
  }
  printTable(childRows)

  // 4. Instance count (exercises instanceIndex + syncInstances — should be linear).
  console.log('\n── Axis 4: instances per component ──')
  const instRows: Row[] = []
  for (const i of [10, 50, 100, 500, 1000, 2500]) {
    instRows.push(
      await runRow(`inst=${i}`, {
        nodes: 0,
        components: 1,
        childrenPerComponent: 5,
        instancesPerComponent: i
      })
    )
  }
  printTable(instRows)

  // 5. Screen count (pages).
  console.log('\n── Axis 5: page (screen) count ──')
  const pageRows: Row[] = []
  for (const s of [1, 10, 50, 100, 250, 500]) {
    pageRows.push(await runRow(`pages=${s}`, { nodes: 100, pages: s }))
  }
  printTable(pageRows)

  // 6. Realistic mix: a large app with many screens, components, instances.
  console.log('\n── Axis 6: realistic large-app mix ──')
  const mixRows: Row[] = [
    await runRow('small app', {
      nodes: 200,
      components: 10,
      childrenPerComponent: 8,
      instancesPerComponent: 5,
      pages: 5
    }),
    await runRow('medium app', {
      nodes: 1000,
      components: 40,
      childrenPerComponent: 12,
      instancesPerComponent: 15,
      pages: 20
    }),
    await runRow('large app', {
      nodes: 3000,
      components: 100,
      childrenPerComponent: 20,
      instancesPerComponent: 30,
      pages: 50
    }),
    await runRow('huge app', {
      nodes: 8000,
      components: 200,
      childrenPerComponent: 30,
      instancesPerComponent: 50,
      pages: 100
    })
  ]
  printTable(mixRows)

  console.log(
    `\nLegend: ⚠️  >${FRAME_BUDGET_MS}ms (drops a 60fps frame)  ❌ >${JANK_MS}ms (noticeable jank)`
  )
}

await main()
