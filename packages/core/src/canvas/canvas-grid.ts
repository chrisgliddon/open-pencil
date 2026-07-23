import type { Canvas } from 'canvaskit-wasm'

import { CANVAS_GRID_DOT_COLOR, CANVAS_GRID_DOT_RADIUS, CANVAS_GRID_SPACING } from '#core/constants'

import type { SkiaRenderer } from './renderer'
import type { CanvasViewport } from './viewport'

export function drawCanvasGrid(
  r: SkiaRenderer,
  canvas: Canvas,
  viewport: CanvasViewport = r.worldViewport,
  zoom = r.zoom
): void {
  const bgColor = r.pageColor
  const isDark = bgColor.r + bgColor.g + bgColor.b < 1.5
  if (!isDark) return

  const dotRadius = CANVAS_GRID_DOT_RADIUS / zoom
  const startX = Math.floor(viewport.x / CANVAS_GRID_SPACING) * CANVAS_GRID_SPACING
  const startY = Math.floor(viewport.y / CANVAS_GRID_SPACING) * CANVAS_GRID_SPACING
  const endX = Math.ceil((viewport.x + viewport.w) / CANVAS_GRID_SPACING) * CANVAS_GRID_SPACING
  const endY = Math.ceil((viewport.y + viewport.h) / CANVAS_GRID_SPACING) * CANVAS_GRID_SPACING

  const c = CANVAS_GRID_DOT_COLOR
  const paint = new r.ck.Paint()
  paint.setColor(r.ck.Color4f(c.r, c.g, c.b, c.a))
  paint.setAntiAlias(true)
  paint.setStyle(r.ck.PaintStyle.Fill)

  for (let x = startX; x <= endX; x += CANVAS_GRID_SPACING) {
    for (let y = startY; y <= endY; y += CANVAS_GRID_SPACING) {
      canvas.drawCircle(x, y, dotRadius, paint)
    }
  }

  paint.delete()
}
