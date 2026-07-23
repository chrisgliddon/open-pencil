import { generateDoc } from './generate.ts'

function benchSync(childrenPerComponent: number, instancesPerComponent: number): number {
  const doc = generateDoc({ components: 1, childrenPerComponent, instancesPerComponent })
  const compId = doc.componentIds[0]
  doc.graph.syncInstances(compId)
  const t = performance.now()
  doc.graph.syncInstances(compId)
  return performance.now() - t
}

const before: Record<string, number> = {
  '10_10': 1.1, '10_50': 4.9, '10_100': 8.4, '10_250': 23.3,
  '50_10': 4.7, '50_50': 42.6, '50_100': 54.4, '50_250': 145.3,
  '100_10': 11.9, '100_50': 73.3, '100_100': 141.8, '100_250': 308.6,
  '250_10': 42.8, '250_50': 205.7, '250_100': 438.5, '250_250': 923.4,
  '500_10': 93.5, '500_50': 417.5, '500_100': 908.5, '500_250': 2756.7
}

console.log('-- syncInstances AFTER rank-map fix --')
console.log('children  instances   syncMs   before    speedup')
for (const c of [10, 50, 100, 250, 500]) {
  for (const i of [10, 50, 100, 250]) {
    const ms = benchSync(c, i)
    const b = before[`${c}_${i}`] ?? 0
    const speedup = b > 0 ? `${(b / ms).toFixed(1)}x` : '—'
    const flag = ms > 100 ? ' JANK' : (ms > 16 ? ' >frame' : '')
    console.log(
      String(c).padStart(8),
      String(i).padStart(10),
      `${ms.toFixed(1).padStart(8)}ms${flag}`,
      `${b}ms`.padStart(8),
      speedup.padStart(8)
    )
  }
}