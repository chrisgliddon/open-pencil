import { computeAllLayouts } from '@open-pencil/core/layout'
import { SceneGraph } from '@open-pencil/scene-graph'

export interface GeneratedDoc {
  graph: SceneGraph
  pageId: string
  /** ids of top-level COMPONENT nodes (for instance/sync benches) */
  componentIds: string[]
  /** ids of INSTANCE nodes (for instance/sync benches) */
  instanceIds: string[]
  /** total node count on the page (excluding root) */
  nodeCount: number
  /** max tree depth on the page */
  maxDepth: number
}

export interface ScaleAxis {
  /** page node count target (leaves + containers) */
  nodes: number
  /** number of COMPONENT definitions */
  components: number
  /** instances per component */
  instancesPerComponent: number
  /** children per component (exercises syncChildren sort) */
  childrenPerComponent: number
  /** tree nesting depth for non-component nodes */
  depth: number
  /** number of pages (screens) */
  pages: number
}

const DEFAULT_AXIS: ScaleAxis = {
  nodes: 0,
  components: 0,
  instancesPerComponent: 0,
  childrenPerComponent: 0,
  depth: 1,
  pages: 1
}

function makeLeaf(graph: SceneGraph, parentId: string, x: number, y: number) {
  return graph.createNode('RECTANGLE', parentId, {
    name: 'Leaf',
    x,
    y,
    width: 40,
    height: 40,
    fills: [{ type: 'SOLID', color: { r: 0.5, g: 0.5, b: 0.5, a: 1 }, visible: true }]
  })
}

/**
 * Build a document scaled along the given axes. Other axes default to zero
 * so each dimension can be isolated. A base set of `nodes` flat leaves is
 * always created on page 1 to control N; components/instances are layered on
 * top to exercise the component/sync paths; depth nests leaves under groups.
 */
export function generateDoc(overrides: Partial<ScaleAxis> = {}): GeneratedDoc {
  const axis = { ...DEFAULT_AXIS, ...overrides }
  const graph = new SceneGraph()

  // Extra pages (screens).
  for (let p = 1; p < axis.pages; p++) graph.addPage(`Page ${p + 1}`)

  const page = graph.getPages()[0]
  const pageId = page.id

  const componentIds: string[] = []
  const instanceIds: string[] = []
  let maxDepth = 1

  // Flat leaf population — controls N independently.
  const cols = Math.ceil(Math.sqrt(Math.max(axis.nodes, 1)))
  for (let i = 0; i < axis.nodes; i++) {
    makeLeaf(graph, pageId, (i % cols) * 50, Math.floor(i / cols) * 50)
  }

  // Depth nesting — unclipped GROUP chains on the page.
  if (axis.depth > 1) {
    let parent = page
    for (let d = 1; d < axis.depth; d++) {
      parent = graph.createNode('GROUP', parent.id, {
        name: `Depth${d}`,
        x: 0,
        y: 0,
        width: 200,
        height: 200
      })
      maxDepth = d + 1
    }
    // one leaf at the bottom
    makeLeaf(graph, parent.id, 0, 0)
  }

  // Components with many direct children (exercises syncChildren sort).
  for (let c = 0; c < axis.components; c++) {
    const comp = graph.createNode('COMPONENT', pageId, {
      name: `Comp${c}`,
      x: 1000 + (c % 20) * 120,
      y: Math.floor(c / 20) * 120,
      width: 100,
      height: Math.max(axis.childrenPerComponent * 12, 40)
    })
    componentIds.push(comp.id)
    for (let k = 0; k < axis.childrenPerComponent; k++) {
      makeLeaf(graph, comp.id, k * 12, k * 12)
    }
  }

  // Instances of each component — exercises instanceIndex + syncInstances.
  for (const compId of componentIds) {
    for (let i = 0; i < axis.instancesPerComponent; i++) {
      const inst = graph.createInstance(compId, pageId, {
        name: `Inst${i}`,
        x: 3000 + (i % 50) * 110,
        y: Math.floor(i / 50) * 110
      })
      if (inst) instanceIds.push(inst.id)
    }
  }

  const nodeCount = graph.countDescendants(pageId)
  return { graph, pageId, componentIds, instanceIds, nodeCount, maxDepth }
}

/** Run computeAllLayouts and report ms. Layout is a known O(N) hot path. */
export function benchLayout(doc: GeneratedDoc): number {
  const t = performance.now()
  computeAllLayouts(doc.graph, doc.pageId)
  return performance.now() - t
}

/** Force an abs-pos cache clear + full repopulation, report ms. O(N*D) cold. */
export function benchAbsPosCold(doc: GeneratedDoc): number {
  const { graph, pageId } = doc
  graph.clearAbsPosCache()
  const page = graph.getNode(pageId)
  if (!page) return 0
  const t = performance.now()
  const walk = (id: string) => {
    graph.getAbsolutePosition(id)
    const node = graph.getNode(id)
    if (node) for (const cid of node.childIds) walk(cid)
  }
  walk(pageId)
  return performance.now() - t
}
