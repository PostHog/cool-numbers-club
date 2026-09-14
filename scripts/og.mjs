/**
 * Renders the social preview card to src/og.png.
 *
 * The card says what the club is and shows who joined it most recently, so it
 * goes stale the moment a number is issued. The nightly refresh re-runs this
 * and commits the PNG alongside the register; run it by hand after changing
 * the design.
 *
 *   npm run og
 *
 * It drives whatever Chrome is already on the machine rather than depending on
 * a headless-browser package -- the project has no dependencies and a picture
 * is not a good enough reason to start. Set CHROME to use another binary.
 */

import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config, isHomeRepo } from './config.mjs'
import { esc, num, since } from './format.mjs'

const WIDTH = 1200
const HEIGHT = 630
const SCALE = 2 // retina-sharp; the 1.91:1 ratio is what matters to scrapers
const ROWS = 6 // recently issued rows the panel has room for
const DEADLINE = 90_000

const root = (f) => new URL(`../${f}`, import.meta.url)
const out = fileURLToPath(root('src/og.png'))
const data = JSON.parse(readFileSync(root('data/achievements.json'), 'utf8'))

/* ── Chrome ────────────────────────────────────────────────── */

const CHROMES = {
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ],
  linux: [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
  ],
  win32: [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ],
}

function findChrome() {
  const candidates = process.env.CHROME ? [process.env.CHROME] : (CHROMES[process.platform] ?? [])
  const found = candidates.find((path) => existsSync(path))
  if (!found) {
    throw new Error(
      `No Chrome found. Looked in:\n  ${candidates.join('\n  ') || '(nowhere -- no known location for this platform)'}\n` +
        'Install Chrome, or set CHROME to the binary and run again.'
    )
  }
  return found
}

/** Resolves once the screenshot is on disk and has stopped growing. */
function waitForShot(since) {
  return new Promise((resolve, reject) => {
    let last = -1
    const started = Date.now()
    const tick = setInterval(() => {
      if (Date.now() - started > DEADLINE) {
        clearInterval(tick)
        reject(new Error(`Chrome did not produce a screenshot within ${DEADLINE / 1000}s.`))
        return
      }
      const size = existsSync(out) && statSync(out).mtimeMs >= since ? statSync(out).size : -1
      if (size > 0 && size === last) {
        clearInterval(tick)
        resolve()
      }
      last = size
    }, 150)
  })
}

/* ── Avatars ───────────────────────────────────────────────── */

/**
 * Avatars are inlined as data URIs. Chrome screenshots a file:// page in one
 * pass with no retries, so a slow avatar host would otherwise punch holes in
 * the card; a monogram stands in if one cannot be fetched at all.
 */
async function inlineAvatar(url) {
  const sized = new URL(url)
  sized.searchParams.set('s', '96')
  try {
    const res = await fetch(sized, { signal: AbortSignal.timeout(10_000) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const bytes = Buffer.from(await res.arrayBuffer())
    return `data:${res.headers.get('content-type') ?? 'image/png'};base64,${bytes.toString('base64')}`
  } catch (error) {
    console.error(`  ${sized.pathname}: ${error.message} — using a monogram instead`)
    return null
  }
}

/* ── The card ──────────────────────────────────────────────── */

// The card accents the last word of the title, exactly as the masthead does.
const titleWords = config.title.split(/\s+/)
const titleTail = titleWords.at(-1)
const titleLead = titleWords.slice(0, -1).join(' ')

const host = config.url ? new URL(config.url).host : null

// PostHog's mark signs the card only when the club is PostHog's own; someone
// else's register has no business flying someone else's flag.
const logo = isHomeRepo
  ? readFileSync(root('src/posthog-logo.svg'), 'utf8')
      .replace(/<!--[\s\S]*?-->/g, '')
      .trim()
      .replace('<svg ', '<svg class="foot__logo" ')
  : ''

function row(r) {
  const face = r.avatar
    ? `<img class="row__face" src="${r.avatar}" alt="">`
    : `<span class="row__face row__face--mono">${esc([...r.holder.login][0].toUpperCase())}</span>`
  return `<li class="row">
      <span class="row__n" data-tier="${esc(r.tier)}">${num(r.number)}</span>
      ${face}
      <span class="row__who">
        <span class="row__login">${esc(r.holder.login)}</span>
        <span class="row__name">${esc(r.name)}</span>
      </span>
      <span class="row__when">${esc(since(r.mergedAt))}</span>
    </li>`
}

function card(recent) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Big+Shoulders+Display:wght@700;800&family=DM+Mono:wght@400;500&family=Public+Sans:wght@400;600;700&display=swap" rel="stylesheet">
<style>
  /* The site's palette and type, so the preview looks like the page it links to. */
  :root {
    --ink: #14161d;
    --ink-raised: #1b1e27;
    --ink-line: #2b2f3b;
    --paper: #f2eee2;
    --paper-dim: #a8a091;
    --orange: #f54e00;
    --blue: #5c86ff;
    --yellow: #f9bd2b;
    --dim: #858c9e;
    --display: 'Big Shoulders Display', sans-serif;
    --body: 'Public Sans', sans-serif;
    --mono: 'DM Mono', monospace;
  }
  * { box-sizing: border-box; margin: 0; }
  body {
    width: ${WIDTH}px;
    height: ${HEIGHT}px;
    background: var(--ink);
    background-image:
      linear-gradient(var(--ink-line) 1px, transparent 1px),
      linear-gradient(90deg, var(--ink-line) 1px, transparent 1px);
    background-size: 64px 64px;
    color: var(--paper);
    font-family: var(--body);
    padding: 52px 56px 44px;
    display: flex;
    flex-direction: column;
    position: relative;
    overflow: hidden;
  }
  .vignette {
    position: absolute; inset: 0;
    background: radial-gradient(ellipse 110% 85% at 30% 0%, transparent 5%, var(--ink) 80%);
  }
  .layer { position: relative; display: flex; flex-direction: column; height: 100%; }
  .top { display: flex; gap: 44px; flex: 1; min-height: 0; }

  /* ── What this is ──────────────────────────────────────── */

  .intent { width: 456px; flex: none; display: flex; flex-direction: column; }
  .eyebrow {
    font-family: var(--mono);
    font-size: 14px;
    letter-spacing: 0.26em;
    text-transform: uppercase;
    color: var(--orange);
    display: flex;
    align-items: center;
    gap: 14px;
  }
  .eyebrow::after { content: ''; flex: 1; height: 1px; background: currentColor; opacity: 0.45; }

  h1 {
    font-family: var(--display);
    font-weight: 800;
    font-size: 92px;
    line-height: 0.86;
    letter-spacing: 0.005em;
    text-transform: uppercase;
    margin-top: 16px;
  }
  h1 b { color: var(--orange); font-weight: 800; }

  .tagline {
    margin-top: 20px;
    font-size: 23px;
    line-height: 1.35;
    color: var(--dim);
    text-wrap: balance;
  }
  .tagline b { color: var(--paper); font-weight: 600; }

  .serving {
    margin-top: auto;
    font-family: var(--mono);
    font-size: 14px;
    letter-spacing: 0.04em;
    color: var(--dim);
  }
  .serving b { color: var(--paper); font-weight: 500; }

  /* ── Recently issued ───────────────────────────────────── */

  .panel {
    flex: 1;
    min-width: 0;
    background: var(--ink-raised);
    border: 1px solid var(--ink-line);
    border-radius: 6px;
    padding: 22px 26px;
    display: flex;
    flex-direction: column;
  }
  .panel__head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    font-family: var(--mono);
    font-size: 13px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    padding-bottom: 12px;
    border-bottom: 1px solid var(--ink-line);
  }
  .panel__head .dim { color: var(--dim); letter-spacing: 0.12em; }

  /* The rows share out whatever height is left, so the panel is never
     part-empty however many numbers there are to show. */
  .rows { flex: 1; list-style: none; padding: 0; display: flex; flex-direction: column; }
  .row {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 16px;
    border-bottom: 1px solid var(--ink-line);
  }
  .row:last-child { border-bottom: 0; }
  .row__n {
    font-family: var(--display);
    font-weight: 800;
    font-size: 34px;
    line-height: 1;
    min-width: 148px;
    font-variant-numeric: tabular-nums;
  }
  .row__n::before { content: '#'; opacity: 0.4; font-size: 0.6em; vertical-align: 0.34em; }
  .row__n[data-tier='singularity'] { color: #c084fc; }
  .row__n[data-tier='mythic'] { color: var(--yellow); }
  .row__n[data-tier='legendary'] { color: var(--orange); }
  .row__n[data-tier='epic'] { color: var(--blue); }
  .row__n[data-tier='rare'] { color: var(--paper-dim); }

  .row__face {
    width: 34px; height: 34px;
    flex: none;
    border-radius: 50%;
    background: var(--ink-line);
  }
  .row__face--mono {
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 15px;
    font-weight: 700;
    color: var(--dim);
  }

  .row__who { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .row__login { font-size: 19px; font-weight: 600; white-space: nowrap; }
  .row__name {
    font-family: var(--mono);
    font-size: 12px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--dim);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .row__when {
    margin-left: auto;
    padding-left: 12px;
    font-family: var(--mono);
    font-size: 13px;
    color: var(--dim);
    white-space: nowrap;
  }

  /* ── Foot ──────────────────────────────────────────────── */

  .foot {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-top: 24px;
    font-family: var(--mono);
    font-size: 14px;
    color: var(--dim);
  }
  .foot__who { display: flex; align-items: center; gap: 16px; }
  .foot__logo { height: 21px; width: auto; color: var(--paper); }
  .foot__rule { width: 1px; height: 18px; background: var(--ink-line); }
  .foot .domain { color: var(--paper); }
</style>
</head>
<body>
<div class="vignette"></div>
<div class="layer">
  <div class="top">
    <div class="intent">
      <div class="eyebrow">Now serving</div>
      <h1>${titleLead ? `${esc(titleLead)} ` : ''}<b>${esc(titleTail)}</b></h1>
      <p class="tagline">Nobody picks their pull request number. <b>These ${num(data.stats.byHumans)} were worth keeping.</b></p>
      <div class="serving">Up to <b>#${num(data.highestPr)}</b> · <b>${num(data.stats.members)}</b> members · <b>${num(data.stats.future)}</b> still to come</div>
    </div>

    <div class="panel">
      <div class="panel__head"><span>Recently issued</span><span class="dim">Newest first</span></div>
      <ul class="rows">${recent.map(row).join('')}</ul>
    </div>
  </div>

  <div class="foot">
    <span class="foot__who">
      ${logo ? `${logo}<span class="foot__rule"></span>` : ''}
      <span>github.com/${esc(data.repo)}</span>
    </span>
    ${host ? `<span class="domain">${esc(host)}</span>` : ''}
  </div>
</div>
</body>
</html>
`
}

/* ── Render ────────────────────────────────────────────────── */

const chrome = findChrome()
const recent = data.recent.slice(0, ROWS)
if (!recent.length) throw new Error('data/achievements.json has no recently issued numbers to show.')

const withFaces = await Promise.all(recent.map(async (r) => ({ ...r, avatar: await inlineAvatar(r.holder.avatarUrl) })))

const work = mkdtempSync(join(tmpdir(), 'cnc-og-'))
const page = join(work, 'og.html')
writeFileSync(page, card(withFaces))

const started = Date.now()
const child = spawn(
  chrome,
  [
    '--headless',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    // Its own profile, so this never disturbs -- or waits on -- a Chrome the
    // user already has open.
    `--user-data-dir=${join(work, 'profile')}`,
    `--force-device-scale-factor=${SCALE}`,
    `--window-size=${WIDTH},${HEIGHT}`,
    // Lets the webfonts land before the shutter. Virtual time runs ahead of the
    // clock, so this costs a moment rather than ten seconds.
    '--virtual-time-budget=10000',
    `--screenshot=${out}`,
    `file://${page}`,
  ],
  { stdio: ['ignore', 'ignore', 'pipe'] }
)

let noise = ''
child.stderr.on('data', (chunk) => (noise += chunk))
const exited = new Promise((resolve) => child.once('exit', resolve))

try {
  // Chrome writes the screenshot and then, given a --user-data-dir of its own,
  // does not reliably quit. Wait for the file rather than for the process, and
  // send it on its way once the picture is safely on disk.
  await Promise.race([waitForShot(started), exited])
} catch (error) {
  throw new Error(`${error.message}\n${noise.trim()}`)
} finally {
  child.kill()
  // Chrome needs a beat to let go of its profile directory, and a stray temp
  // directory is not worth failing a render over.
  await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 2000))])
  try {
    rmSync(work, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  } catch {
    // It is in the OS temp directory; it will get cleaned up eventually.
  }
}

if (!existsSync(out) || statSync(out).mtimeMs < started) {
  throw new Error(`Chrome rendered nothing.\n${noise.trim()}`)
}

console.error(
  `Wrote src/og.png — ${WIDTH * SCALE}x${HEIGHT * SCALE}, newest ${recent.length}: ${recent.map((r) => `#${num(r.number)}`).join(', ')}`
)
