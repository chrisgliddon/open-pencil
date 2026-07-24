import { describe, expect, test } from 'bun:test'

import { strToU8, zipSync } from 'fflate'

import { readProjectZip } from '@/app/import-claude-design/read-project'

const DS_MANIFEST = JSON.stringify({
  namespace: 'PPWDesignSystem',
  cards: [
    {
      path: 'preview/badges.html',
      group: 'Brand',
      viewport: '700x380',
      subtitle: 'Rarity tiers &amp; states',
      name: 'Badges &amp; Pills'
    },
    { path: 'preview/logo.html', name: 'Logo' }
  ]
})

function makeZipFile(entries: Record<string, Uint8Array>, name = 'PPW UI.zip'): File {
  const bytes = zipSync(entries)
  return new File([bytes], name)
}

function claudeDesignZip(): File {
  return makeZipFile({
    'App.jsx': strToU8('const App = () => <PPW.HUD />'),
    'HUD.jsx': strToU8('const HUD = () => <div className="hud" />'),
    'Inventory.jsx': strToU8('const Inventory = () => <div />'),
    'social.css': strToU8('.hud { color: red; }'),
    'Birthday.data.js': strToU8('var LAYERS = ["sponge"]'),
    'README.md': strToU8('# Party Parrot World'),
    '_ds/ppw-ds/_ds_manifest.json': strToU8(DS_MANIFEST),
    '_ds/ppw-ds/colors_and_type.css': strToU8(
      "@font-face { font-family: 'Brand Pop'; src: url('fonts/brand.ttf') format('truetype'); }\n:root { --moss: #4a6f3a; }"
    ),
    '_ds/ppw-ds/README.md': strToU8('# PPW Design System'),
    '_ds/ppw-ds/ui_kits/game-hud/styles.css': strToU8('.toolbar { gap: 8px; }'),
    '_ds/ppw-ds/fonts/brand.ttf': strToU8('not-a-real-font'),
    'assets-min/coin.png': strToU8('png-bytes'),
    'assets-min/logo-flat.svg': strToU8('<svg />'),
    'uploads/logo.png': strToU8('logo-bytes'),
    'uploads/notes.txt': strToU8('reference notes'),
    'screenshots/01-invite.png': strToU8('screenshot-bytes'),
    '.thumbnail': strToU8('webp-bytes'),
    'Party Parrot World (offline).html': strToU8('<html>huge bundle</html>'),
    'huge-texture.png': new Uint8Array(2_100_000)
  })
}

describe('readProjectZip — Claude Design export anatomy', () => {
  test('classifies screens, router, css, data files, and readme', async () => {
    const manifest = await readProjectZip(claudeDesignZip())

    expect(manifest.name).toBe('PPW UI')
    expect(manifest.app?.componentName).toBe('App')
    expect(manifest.screens.map((screen) => screen.componentName)).toEqual(['HUD', 'Inventory'])
    expect(manifest.readme).toContain('Party Parrot World')
    expect(manifest.dataFiles.map((file) => file.relativePath)).toEqual(['Birthday.data.js'])
    expect(manifest.dataFiles[0].source).toContain('sponge')
  })

  test('surfaces design-token CSS first and parses the design system', async () => {
    const manifest = await readProjectZip(claudeDesignZip())

    expect(manifest.css[0].relativePath).toContain('colors_and_type.css')
    expect(manifest.css.map((file) => file.relativePath)).toContain('social.css')
    expect(manifest.css.map((file) => file.relativePath)).toContain(
      '_ds/ppw-ds/ui_kits/game-hud/styles.css'
    )

    expect(manifest.designSystem?.name).toBe('ppw-ds')
    expect(manifest.designSystem?.readme).toContain('PPW Design System')
    expect(manifest.designSystem?.cards).toEqual([
      'Brand / Badges & Pills — Rarity tiers & states',
      'Logo'
    ])
  })

  test('collects placeable assets with bytes, including image uploads', async () => {
    const manifest = await readProjectZip(claudeDesignZip())
    const assetPaths = manifest.assets.map((asset) => asset.relativePath)

    expect(assetPaths).toContain('assets-min/coin.png')
    expect(assetPaths).toContain('assets-min/logo-flat.svg')
    expect(assetPaths).toContain('uploads/logo.png')
    const coin = manifest.assets.find((asset) => asset.relativePath === 'assets-min/coin.png')
    expect(coin?.bytes).toBeDefined()
    expect(coin?.mimeType).toBe('image/png')
  })

  test('maps @font-face families onto shipped font files with bytes', async () => {
    const manifest = await readProjectZip(claudeDesignZip())

    expect(manifest.fonts).toHaveLength(1)
    expect(manifest.fonts[0].relativePath).toBe('_ds/ppw-ds/fonts/brand.ttf')
    expect(manifest.fonts[0].family).toBe('Brand Pop')
    expect(manifest.fonts[0].bytes).toBeDefined()
  })

  test('lists screenshots and uploads as reference context only', async () => {
    const manifest = await readProjectZip(claudeDesignZip())

    expect(manifest.screenshots).toEqual(['screenshots/01-invite.png'])
    expect(manifest.uploads).toEqual(['uploads/logo.png', 'uploads/notes.txt'])
    expect(manifest.screens.map((screen) => screen.relativePath)).not.toContain(
      'screenshots/01-invite.png'
    )
  })

  test('skips bundles, fonts, dotfiles, and oversized entries', async () => {
    const manifest = await readProjectZip(claudeDesignZip())
    const everyPath = [
      ...manifest.assets.map((asset) => asset.relativePath),
      ...manifest.css.map((file) => file.relativePath),
      ...manifest.screens.map((screen) => screen.relativePath)
    ]

    expect(everyPath.some((path) => path.endsWith('.html'))).toBe(false)
    expect(everyPath.some((path) => path.endsWith('.ttf'))).toBe(false)
    expect(everyPath.some((path) => path.includes('.thumbnail'))).toBe(false)
    expect(everyPath).not.toContain('huge-texture.png')
  })

  test('strips a single wrapping root folder', async () => {
    const manifest = await readProjectZip(
      makeZipFile(
        {
          'ppw-ui/App.jsx': strToU8('const App = () => null'),
          'ppw-ui/HUD.jsx': strToU8('const HUD = () => null')
        },
        'wrapped.zip'
      )
    )

    expect(manifest.screens.map((screen) => screen.relativePath)).toEqual(['HUD.jsx'])
    expect(manifest.screens[0].source).toContain('HUD')
  })

  test('keeps paths intact when root files sit beside a single folder', async () => {
    const manifest = await readProjectZip(
      makeZipFile(
        {
          'App.jsx': strToU8('const App = () => null'),
          'assets-min/coin.png': strToU8('png-bytes')
        },
        'mixed.zip'
      )
    )

    expect(manifest.app?.relativePath).toBe('App.jsx')
    expect(manifest.assets.map((asset) => asset.relativePath)).toEqual(['assets-min/coin.png'])
  })
})
