/**
 * Writes src/favicon.svg from @posthog/brand.
 *
 * One file carries both treatments of the logomark and a
 * `prefers-color-scheme` switch picks between them, because Chrome ignores the
 * `media` attribute on `<link rel="icon">` — two linked files would leave it
 * showing whichever it loaded first, in both schemes.
 *
 * Light gets the gradient variant, dark the flat print one. Print's head is
 * near-black and would disappear against a dark tab strip, so that one fill is
 * lifted to white; the three spikes stay exactly as the package draws them.
 *
 * Like `npm run og` this is not part of `npm run build` -- it needs packages
 * the deploy build refuses to carry, so it installs them into a temp directory,
 * renders once, and commits the result. Re-run it when the brand package moves.
 */

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const BRAND = '@posthog/brand@0.12.1'

// The head fill shared by every variant, and what dark mode gets instead.
const HEAD_INK = 'fill="#111"'
const HEAD_ON_DARK = 'fill="#fff"'

const out = new URL('../src/favicon.svg', import.meta.url)

const dir = mkdtempSync(join(tmpdir(), 'cnc-favicon-'))
try {
  console.error(`Installing ${BRAND} into ${dir}…`)
  execFileSync(
    'npm',
    ['install', '--prefix', dir, '--no-save', '--no-audit', '--no-fund', '--silent', BRAND, 'react', 'react-dom'],
    { stdio: ['ignore', 'ignore', 'inherit'] },
  )

  const resolve = (spec) => pathToFileURL(join(dir, 'node_modules', spec)).href
  const { createElement } = await import(resolve('react/index.js'))
  const { renderToStaticMarkup } = await import(resolve('react-dom/server.node.js'))
  const { Logo } = await import(resolve('@posthog/brand/dist/logo/index.mjs'))
  const version = JSON.parse(readFileSync(join(dir, 'node_modules/@posthog/brand/package.json'), 'utf8')).version

  /** The logomark's own markup, without the `<svg>` the component wraps it in. */
  function body(variant) {
    const svg = renderToStaticMarkup(createElement(Logo.Logomark, { variant }))
    const inner = svg.match(/^<svg\b[^>]*>([\s\S]*)<\/svg>$/)?.[1]
    const viewBox = svg.match(/viewBox="([^"]+)"/)?.[1]
    if (!inner || !viewBox) throw new Error(`Could not read the ${variant} logomark out of: ${svg.slice(0, 120)}…`)
    return { inner, viewBox }
  }

  const light = body('gradient')
  const dark = body('print')
  if (dark.viewBox !== light.viewBox) {
    throw new Error(`Variants disagree on their viewBox: ${light.viewBox} vs ${dark.viewBox}`)
  }

  const [, , width, height] = light.viewBox.split(/\s+/).map(Number)

  // A favicon is drawn into a square. Padding the box to the mark's own width
  // and dropping it to the middle keeps the artwork untouched and, unlike the
  // plate it replaces, leaves the corners transparent.
  const offset = (width - height) / 2
  if (offset < 0) throw new Error(`The logomark is taller than it is wide (${light.viewBox}) -- padding would crop it`)

  // Gradients are referenced by id, so they have to sit outside the group that
  // dark mode switches off.
  const defs = []
  const group = (cls, { inner }) =>
    `<g class="${cls}">${inner.replace(/<defs>[\s\S]*<\/defs>/, (d) => (defs.push(d), ''))}</g>`

  const groups = [group('light', light), group('dark', { inner: recolourHead(dark.inner) })]

  const svg = `<!--
  The PostHog logomark as a dual-scheme favicon: the gradient variant in light
  mode, the print variant (head lifted to white) in dark.

  Generated from @posthog/brand@${version} by \`npm run favicon\`. Vendored rather
  than depended on: this project ships with no dependencies, and the mark is
  stable. Regenerate it from the package if it changes; do not hand-edit it.
-->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${width}" fill="none" role="img" aria-label="PostHog">
<style>
  .dark { display: none }
  @media (prefers-color-scheme: dark) {
    .light { display: none }
    .dark { display: inline }
  }
</style>
${defs.join('')}
<g transform="translate(0 ${offset})">${groups.join('')}</g>
</svg>
`

  const comment = svg.match(/<!--([\s\S]*?)-->/)[1]
  if (comment.includes('--')) {
    throw new Error('The header comment contains "--", which is a parse error in XML and so in a lone .svg')
  }
  writeFileSync(out, svg)
  console.error(`Wrote src/favicon.svg from @posthog/brand@${version}.`)
} finally {
  rmSync(dir, { recursive: true, force: true })
}

/** Swaps the one dark fill in the print variant for white, loudly. */
function recolourHead(inner) {
  const hits = inner.split(HEAD_INK).length - 1
  if (hits !== 1) {
    throw new Error(`Expected exactly one ${HEAD_INK} in the print logomark, found ${hits} -- check the artwork`)
  }
  return inner.replace(HEAD_INK, HEAD_ON_DARK)
}
