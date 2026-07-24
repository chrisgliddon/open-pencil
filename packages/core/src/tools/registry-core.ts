import { evalCode } from './analyze'
import { calc } from './calc'
import { createComponent, createInstance, createPage, render } from './create'
import { describe } from './describe'
import {
  setFill,
  setLayout,
  setLayoutChild,
  setRadius,
  setStroke,
  setText,
  setTextProperties,
  updateNode
} from './modify'
import { findNodes, getJsx, getNode, getSelection, listPages, switchPage } from './read'
import type { ToolDef } from './schema'
import { stockPhoto } from './stock-photo'
import { batchUpdate, deleteNode, nodeResize, reparentNode } from './structure'
import { viewportZoomToFit } from './vector'

/**
 * Core tools registered by default in AI chat (~30 tools, ~3K schema tokens).
 * Covers 90%+ of design sessions: render, describe, modify, structure, icons,
 * plus document organization (pages, components, instances).
 */
export const CORE_TOOLS: ToolDef[] = [
  // Read
  getSelection,
  getNode,
  findNodes,
  getJsx,
  listPages,
  // Create & organize
  render,
  createPage,
  switchPage,
  createComponent,
  createInstance,
  // Modify
  updateNode,
  setLayout,
  setLayoutChild,
  setRadius,
  setFill,
  setStroke,
  setText,
  setTextProperties,
  // Structure
  deleteNode,
  reparentNode,
  nodeResize,
  batchUpdate,
  // Stock photos
  stockPhoto,
  // Inspect & utility
  describe,
  calc,
  evalCode,
  viewportZoomToFit
]
