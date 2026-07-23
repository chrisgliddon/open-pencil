import { benchAbsPosCold, generateDoc } from './generate.ts'

// The benchmark's benchAbsPosCold explicitly clears the cache each call, so
// it measures worst-case cold repopulation. The real improvement is that
// render() no longer clears every frame — so the second render of an
// unchanged scene hits a warm cache. Simulate that here.
console.log('-- absPos: cold (cleared) vs warm (persists) --')
console.log('depth   coldMs   warmMs   speedup')
for (const d of [50, 100, 250, 500, 1000]) {
  const doc = generateDoc({ nodes: 0, depth: d })
  const cold = benchAbsPosCold(doc)
  const { graph, pageId } = doc
  const page = graph.getNode(pageId)
  if (!page) continue
  const t = performance.now()
  const walk = (id: string) => {
    graph.getAbsolutePosition(id)
    const node = graph.getNode(id)
    if (node) for (const cid of node.childIds) walk(cid)
  }
  walk(pageId)
  const warm = performance.now() - t
  const speedup = `${(cold / warm).toFixed(1)}x`
  const flag = warm > 16 ? ' >frame' : ''
  console.log(
    String(d).padStart(5),
    `${cold.toFixed(2).padStart(7)}ms`,
    `${warm.toFixed(2).padStart(7)}ms${flag}`,
    speedup.padStart(8)
  )
}
