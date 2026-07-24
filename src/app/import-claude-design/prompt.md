Convert this Claude Design project into a well-organized OpenPencil document. You are translating an existing, finished design — fidelity to the source and clean document structure matter more than invention.

## Document organization (MANDATORY)

### Pages — one per flow

- Group screens into flows and create one page per flow with `create_page`: e.g. "Title & Menus", "Game HUD", "Journal", "Social". Derive the grouping and order from the App router (its cases list the screens in narrative order) and from shared name prefixes (`Social*`, `Journal*`).
- 3–8 screens per page. If the whole project has ≤4 screens, use a single "Screens" page.
- Always create a "🧩 Components" page FIRST and build shared components there before any screen.
- `create_page` returns the page id but does NOT switch to it. Render onto a page by passing its id as `parent_id`, and call `switch_page` when you start filling a page so the user can watch progress. On follow-up passes, `list_pages` first and reuse existing pages — never create duplicates.

### Layers — top-level frames on a strict grid, never overlapping

- Each screen = exactly ONE top-level frame on its flow page, named after its source file ("HUD", "Inventory"). Everything belonging to a screen lives INSIDE its frame — no loose nodes directly on the page canvas.
- Use one canonical frame size for all screens: infer it from the source (root CSS/JSX dimensions); default to 1440×900 for desktop/game UI or 390×844 when the source is clearly mobile.
- Placement law — compute, never eyeball: screen `i` on a page goes at `x = i × (W + 200)`, `y = 0`. Alternate states of a screen go directly BELOW it in the same column at `y = j × (H + 200)`, named "Screen — State" (e.g. "Title — Signed out"). Use `calc` for the arithmetic.
- Top-level frames must NEVER overlap — keep at least 200px of clear canvas between them. When adding to a page that already has frames, `describe` the page first and continue the grid to the right of the rightmost frame.

### Assets — components for anything reused

- Anything that appears more than once — buttons, badges, pills, cards, nav/toolbar items, list rows, health hearts, currency chips — is built ONCE as a component on the Components page and placed everywhere else as an instance.
- In `render` JSX, create components with `<Component name="Badge / Warning">…</Component>` and place them with `<Instance component="Badge / Warning" />`. Slash-separated names ("Button / Primary") group components in the Assets panel.
- Variants of one element (button states, rarity tiers) become sibling components inside one `<ComponentSet name="Button">`, each with variant props.
- The design-system card index below is the source project's own list of reusable elements — mirror its groups and names when choosing what becomes a component.
- Lay out the Components page on the same non-overlap grid: one row per group, 100px gutters between components, a `<Text>` label above each row.

### Image assets — `place_asset`

- The project ships real image files (listed below). Render a placeholder Rectangle/Frame with the image's rough aspect ratio and a neutral `bg`, then batch-apply the real files with one `place_asset` call per screen: `[{"id":"0:12","asset":"assets-min/coin.png","mode":"FIT"}, …]`.
- SVG assets cannot be placed as fills — approximate them with shapes or an `<Icon>`.
- Files under `uploads/` are raw reference art. Place one only when a screen explicitly uses it (logos, character portraits); otherwise ignore them.

## Fidelity rules

- Render a faithful _static visual_ of each screen's default state. Drop interactivity: no onClick, useState, or prop branching — pick the most representative state.
- Translate React + CSS into OpenPencil JSX: resolve CSS classes to inline props (bg, rounded, p, flex, gap, size, color, weight, …). Colors as hex. No className, no CSS classes, no `style` prop.
- The design-token CSS (colors, type scale, radii, shadows) is authoritative — use its exact values, not approximations.
- Use the data files for realistic text content instead of lorem ipsum.
- Match the source project's brand from the README/design-system context. If a "Project fonts" list appears below, those families are registered in the editor — set `font` to exactly those names. Only substitute the closest Google Fonts family when a font is NOT in that list, and note the substitution in your summary.
- Screenshot filenames hint at flows and states ("01-invite", "02-mint") — use them to group screens and pick representative states. You cannot view the images themselves.

## Workflow

1. **Plan (text only):** map every selected screen to a flow page, list the 5–10 shared components you will build, and state the canonical screen size.
2. **Components page:** `create_page` → render the shared components in 2–3 `render` calls (≤40 elements each).
3. **Each flow page:** `create_page` → `switch_page` → for each screen: `calc` its grid position → `render` the skeleton with `parent_id` = page id and explicit x/y → fill sections → `describe` → fix errors with `batch_update` → one `place_asset` batch.
4. You have a 50-step budget per message. If the `_warning` appears, finish the current screen cleanly, then report which screens remain — the user can send "continue".

## Final report

Reply with 3–4 lines: pages created (with screen counts), components created, image assets placed, and anything simplified, substituted, or skipped.
