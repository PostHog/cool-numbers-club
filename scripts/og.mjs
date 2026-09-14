/**
 * Renders src/og.html to src/og.png, the social preview card.
 *
 * Kept out of `npm run build` on purpose: this is the only thing in the project
 * that needs a browser, and the deploy build must stay dependency-free. Run it
 * by hand when the card design changes, and commit the PNG.
 *
 *   npx playwright install chromium   # once
 *   npm run og
 */

import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'

const WIDTH = 1200
const HEIGHT = 630
const SCALE = 2 // retina-sharp; the 1.91:1 ratio is what matters to scrapers

const source = new URL('../src/og.html', import.meta.url)
const out = fileURLToPath(new URL('../src/og.png', import.meta.url))

const browser = await chromium.launch()
const page = await browser.newPage({
  viewport: { width: WIDTH, height: HEIGHT },
  deviceScaleFactor: SCALE,
})

await page.goto(source.href, { waitUntil: 'networkidle' })
// Without this the card can rasterise mid-swap, in the fallback face.
await page.evaluate(() => document.fonts.ready)
await page.waitForTimeout(300)

await page.screenshot({ path: out, clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT } })
await browser.close()

console.error(`Wrote src/og.png — ${WIDTH * SCALE}x${HEIGHT * SCALE}`)
