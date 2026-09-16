/**
 * Renders data/achievements.json into a static site in dist/.
 *
 * Everything is rendered server-side -- the page is complete without
 * JavaScript. app.js only filters and re-sorts what is already in the DOM,
 * which keeps the markup the single source of truth.
 */

import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs'
import { CATEGORIES, TIERS } from './numbers.mjs'
import { config, isHomeRepo } from './config.mjs'
import { esc, num, since } from './format.mjs'

const src = (f) => new URL(`../src/${f}`, import.meta.url)
const root = (f) => new URL(`../${f}`, import.meta.url)

const data = JSON.parse(readFileSync(root('data/achievements.json'), 'utf8'))

/** Why a number is not yet on someone's wall, in the voice of the machine. */
const STATUS = {
  'not-a-pr': 'Not a pull request',
  unmerged: 'Opened, never merged',
  open: 'Still open — claim pending',
}

function odometer(n) {
  return [...String(n)]
    .map((d, i) => {
      const reel = Array.from({ length: 10 }, (_, k) => `<span>${k}</span>`).join('')
      return `<span class="odo__digit" style="--digit:${d};--i:${i}"><span class="odo__reel">${reel}</span></span>`
    })
    .join('')
}

function avatar(url, cls, alt) {
  return `<img class="${cls}" src="${esc(url)}&s=96" alt="${esc(alt)}" loading="lazy" width="48" height="48">`
}

/* ── Ticket stubs ──────────────────────────────────────────── */

function stub(a) {
  const category = CATEGORIES[a.category].label
  const tier = TIERS[a.tier].label
  const head = `<div class="stub__head"><span class="stub__tier">${esc(tier)}</span><span>${esc(category)}</span></div>`
  const title = `<div class="stub__number">${num(a.number)}</div><div class="stub__name">${esc(a.name)}</div><p class="stub__blurb">${esc(a.blurb)}</p>`
  const aka = a.alsoKnownAs.length
    ? `<div class="stub__aka">also: ${a.alsoKnownAs.map((x) => esc(x.name)).join(' · ')}</div>`
    : ''

  if (!a.claimed) {
    const status = a.future
      ? `${num(a.toGo)} pull requests away`
      : (STATUS[a.why] ?? 'Unissued')
    // A number lost to an unmerged or still-open PR links to that PR.
    const statusEl = a.pr
      ? `<a class="stub__status stub__status--link" href="${esc(a.pr.url)}" title="${esc(a.pr.title)}">${esc(status)} <span aria-hidden="true">&rarr;</span></a>`
      : `<div class="stub__status">${esc(status)}</div>`
    return `<div class="stub stub--open${a.future ? ' stub--future' : ''}" id="n-${a.number}" data-tier="${a.tier}" data-category="${a.category}" data-claimed="false" data-status="${a.future ? 'future' : 'missed'}" data-search="${esc(searchKey(a))}">
      ${head}${title}${aka}
      ${statusEl}
    </div>`
  }

  const h = a.holder
  return `<a class="stub" id="n-${a.number}" href="${esc(a.pr.url)}" data-tier="${a.tier}" data-category="${a.category}" data-claimed="true" data-status="claimed" data-bot="${a.bot}" data-search="${esc(searchKey(a))}">
    ${head}${title}${aka}
    <div class="stub__perf"></div>
    <div class="stub__holder">
      ${avatar(h.avatarUrl, 'stub__avatar', '')}
      <div>
        <div class="stub__login">${esc(h.login)}</div>
        <div class="stub__pr">${esc(a.pr.title)}</div>
      </div>
      ${a.bot ? '<span class="stub__bot">Bot</span>' : ''}
    </div>
  </a>`
}

const searchKey = (a) =>
  [a.number, a.name, a.blurb, CATEGORIES[a.category].label, a.claimed ? a.holder.login : 'unissued', a.claimed ? a.pr.title : '']
    .join(' ')
    .toLowerCase()

/* ── Register ──────────────────────────────────────────────── */

function registerRow(m) {
  // Count and lowest PR number per tier, so narrowing the rarities re-scores and
  // re-breaks ties against only what is still being counted.
  const perTier = Object.keys(TIERS)
    .map((t) => {
      const held = m.achievements.filter((a) => a.tier === t)
      const lowest = held.length ? Math.min(...held.map((a) => a.number)) : ''
      return `data-tier-${t}="${held.length}" data-first-${t}="${lowest}"`
    })
    .join(' ')
  const numbers = m.achievements
    .map(
      (a) =>
        `<a class="chip" data-tier="${a.tier}" href="#n-${a.number}" title="${esc(a.name)} — ${esc(a.title)}">#${num(a.number)}</a>`
    )
    .join('')
  return `<li class="register__row" data-podium="${m.rank}" ${perTier}>
    <div class="register__rank">${m.rank}</div>
    ${avatar(m.avatarUrl, 'register__avatar', '')}
    <div class="register__who">
      <a class="register__handle" href="${esc(m.url)}">${esc(m.login)}</a>
      ${m.name && m.name.toLowerCase() !== m.login.toLowerCase() ? `<div class="register__name">${esc(m.name)}</div>` : ''}
    </div>
    <div class="register__score">
      <div class="register__count">${m.count}</div>
      <div class="register__pts">${m.points} pts</div>
    </div>
    <div class="register__numbers">${numbers}</div>
  </li>`
}

/* ── Page ──────────────────────────────────────────────────── */

const next = data.upcoming[0]

const tagline = `Nobody picks their pull request number. These ${data.stats.byHumans} were worth keeping.`
const description = `${tagline} A register of cool PR numbers in ${data.repo}, rebuilt nightly.`

/* ── Structured data ───────────────────────────────────────── */

/**
 * PostHog as a schema.org Organization, matching what posthog.com's SEO
 * component emits so both describe the same entity rather than drifting
 * copies of it.
 */
const POSTHOG_ORGANIZATION = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: 'PostHog',
  url: 'https://posthog.com',
  logo: 'https://posthog.com/brand/posthog-logo-stacked.png',
  sameAs: ['https://twitter.com/PostHog', 'https://github.com/PostHog', 'https://www.linkedin.com/company/posthog'],
}

// Absolute URLs only, so there is nothing to say without a public one.
const structuredData = !config.url
  ? []
  : [
      {
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        name: config.title,
        url: `${config.url}/`,
        description,
        inLanguage: 'en',
        ...(isHomeRepo ? { publisher: { '@type': 'Organization', name: 'PostHog', url: 'https://posthog.com' } } : {}),
      },
      {
        '@context': 'https://schema.org',
        '@type': 'ItemList',
        name: 'Recently issued',
        description: 'The numbers most recently claimed by a merged pull request.',
        itemListOrder: 'https://schema.org/ItemListOrderDescending',
        numberOfItems: data.recent.length,
        itemListElement: data.recent.map((r, i) => ({
          '@type': 'ListItem',
          position: i + 1,
          name: `#${num(r.number)} — ${r.name}`,
          url: r.url,
        })),
      },
      ...(isHomeRepo ? [POSTHOG_ORGANIZATION] : []),
    ]

// Escaping `<` keeps a stray "</script>" in any of the data from closing the
// block early.
const structuredDataTags = structuredData
  .map((item) => `<script type="application/ld+json">${JSON.stringify(item).replace(/</g, '\\u003c')}</script>`)
  .join('\n')

// The masthead accents the last word of the title, whatever it happens to be.
const titleWords = config.title.split(/\s+/)
const titleTail = titleWords.at(-1)
const titleLead = titleWords.slice(0, -1).join(' ')

// Only offer a rarity toggle if someone actually holds one. Singularity stays
// hidden until the day #1,000,000 lands, then appears on its own.
const heldTiers = new Set(data.leaderboard.flatMap((m) => m.achievements.map((a) => a.tier)))

const counters = [
  { n: num(data.stats.byHumans), label: 'Numbers issued', accent: 'yellow' },
  { n: data.stats.members, label: 'Club members', accent: 'orange' },
  { n: data.stats.missed, label: 'Missed for good' },
  { n: data.stats.future, label: 'Still to come', accent: 'blue' },
  { n: data.stats.byBots, label: 'Taken by bots' },
]

const filters = [
  ['all', 'Everything'],
  ...Object.entries(CATEGORIES).map(([k, v]) => [k, v.label]),
  ['claimed', 'Issued'],
  ['missed', 'Missed'],
  ['future', 'Still to come'],
]

// PostHog's mark only flies over PostHog's own club, exactly as on the social
// card; a fork pointed elsewhere keeps the unbranded take-a-number monogram.
// src/favicon.svg carries both colour schemes and switches between them itself,
// because Chrome ignores `media` on `<link rel="icon">`.
const icon = isHomeRepo
  ? '<link rel="icon" href="./favicon.svg" type="image/svg+xml">'
  : `<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' rx='12' fill='%23f54e00'/><text x='50' y='74' font-size='68' font-family='Helvetica,Arial' font-weight='bold' text-anchor='middle' fill='%23f2eee2'>%23</text></svg>">`

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>The Cool Numbers Club — posthog/posthog</title>
<meta name="description" content="${esc(description)}">
<meta property="og:title" content="${esc(config.title)}">
<meta property="og:description" content="${esc(tagline)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${esc(config.title)}">
<meta name="twitter:card" content="summary_large_image">
${
  config.url
    ? `<link rel="canonical" href="${esc(config.url)}/">
<meta property="og:url" content="${esc(config.url)}/">
<meta property="og:image" content="${esc(config.url)}/og.png">
<meta property="og:image:type" content="image/png">
<meta property="og:image:width" content="2400">
<meta property="og:image:height" content="1260">
<meta property="og:image:alt" content="${esc(config.title)} — the most recently issued numbers: ${data.recent
        .slice(0, 6)
        .map((r) => `#${num(r.number)} to ${esc(r.holder.login)}`)
        .join(', ')}.">
<meta name="twitter:image" content="${esc(config.url)}/og.png">`
    : ''
}
<meta name="theme-color" content="#14161d">
${icon}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Big+Shoulders+Display:wght@700;800&family=DM+Mono:wght@400;500&family=Public+Sans:wght@400;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="./styles.css">
${structuredDataTags}
</head>
<body>

<header class="masthead">
  <div class="wrap masthead__inner">
    <div class="masthead__mark">${titleLead ? `${esc(titleLead)} ` : ''}<b>${esc(titleTail)}</b></div>
    <a class="masthead__repo" href="https://github.com/${esc(data.repo)}/pulls">${esc(data.repo)}&nbsp;↗</a>
  </div>
</header>

<main>
  <section class="dispenser wrap">
    <!-- The masthead is set as a wordmark rather than a heading, so without this
         the page would start at <h2> and have no <h1> at all. Hidden rather than
         restyled: it is here for crawlers and screen readers, not for the eye. -->
    <h1 class="visually-hidden">${esc(config.title)} — cool pull request numbers in ${esc(data.repo)}</h1>
    <div class="stencil dispenser__eyebrow">Now serving</div>
    <div class="odo" role="img" aria-label="Pull request number ${num(data.highestPr)}">${odometer(data.highestPr)}</div>
    <p class="dispenser__next">
      Nobody picks their pull request number.
      Next one worth keeping is <b>#${num(next.number)}</b>, <span class="togo">${num(next.toGo)} to go</span>.
    </p>
  </section>

  <div class="wrap">
    <div class="counters">
      ${counters
        .map(
          (c) => `<div class="counter">
        <div class="counter__n"${c.accent ? ` data-accent="${c.accent}"` : ''}>${c.n}</div>
        <div class="stencil counter__label">${c.label}</div>
      </div>`
        )
        .join('')}
    </div>
  </div>

  <section class="section wrap" id="register">
    <div class="section__head">
      <div>
        <h2 class="section__title">The register</h2>
        <p class="section__sub">Ranked by how many cool numbers you hold, then by rarity, then by whoever holds the lowest PR number. Narrow the rarities to see who leads on the good ones. Bots are on the wall but not in the running.</p>
      </div>
      <div class="controls">
        <div class="control">
          <span class="stencil control__label">Sort</span>
          <div class="sorter" role="group" aria-label="Sort the register">
            <button class="sorter__btn" type="button" data-sort="count" aria-pressed="true">By count</button>
            <button class="sorter__btn" type="button" data-sort="points" aria-pressed="false">By rarity</button>
          </div>
        </div>
        <div class="control">
          <span class="stencil control__label">Count</span>
          <div class="sorter" role="group" aria-label="Which rarities to count">
            ${Object.entries(TIERS)
              .filter(([key]) => heldTiers.has(key))
              .map(
                ([key, t]) =>
                  `<button class="sorter__btn sorter__btn--tier" type="button" data-tier-filter="${key}" aria-pressed="true">${t.label}</button>`
              )
              .join('')}
          </div>
        </div>
      </div>
    </div>
    <ol class="register" data-tier-points='${JSON.stringify(
      Object.fromEntries(Object.entries(TIERS).map(([k, v]) => [k, v.points]))
    )}'>${data.leaderboard.map(registerRow).join('')}</ol>
    <p class="empty" data-register-empty hidden>Nothing to count. Pick at least one rarity.</p>
  </section>

  <section class="section wrap" id="recent">
    <div class="section__head">
      <div>
        <h2 class="section__title">Recently issued</h2>
        <p class="section__sub">The newest members. This page rebuilds every night, so this is where new arrivals turn up first.</p>
      </div>
    </div>
    <div class="recent">
      ${data.recent
        .map(
          (r) => `<a class="recent__row" href="${esc(r.url)}">
        <span class="recent__n" data-tier="${r.tier}">${num(r.number)}</span>
        ${avatar(r.holder.avatarUrl, 'recent__avatar', '')}
        <span class="recent__name">${esc(r.holder.login)}</span>
        <span class="stencil">${esc(r.name)}</span>
        <span class="recent__when">${since(r.mergedAt)}</span>
      </a>`
        )
        .join('')}
    </div>
  </section>

  <section class="section wrap" id="numbers">
    <div class="section__head">
      <div>
        <h2 class="section__title">The numbers</h2>
        <p class="section__sub">Every number the club recognises, from #1 to #${num(config.ceiling)}. A number is only issued once a pull request with it gets merged — ${data.stats.missed} were missed for good, and ${data.stats.future} are still ahead of the repo.</p>
      </div>
    </div>
    <div class="filters">
      <div class="filters__set" role="group" aria-label="Filter numbers">
        ${filters
          .map(
            ([k, label], i) =>
              `<button class="sorter__btn" type="button" data-filter="${k}" aria-pressed="${i === 0}">${label}</button>`
          )
          .join('')}
      </div>
      <label class="visually-hidden" for="search">Search numbers</label>
      <input class="search" id="search" type="search" placeholder="Search a number, a name, a person…" autocomplete="off">
    </div>
    <div class="stubs">${data.achievements.map(stub).join('')}</div>
    <p class="empty" hidden>No numbers match that. Try something less specific.</p>
  </section>
</main>

<footer class="colophon wrap">
  <div class="colophon__about">
    <p>
      Built from the ${esc(data.repo)} pull request history.
      <a href="https://github.com/${esc(data.repo)}/pulls">Go get one&nbsp;↗</a>
    </p>
    ${
      config.source
        ? `<p>Any repo can have one of these.
      <a href="https://github.com/${esc(config.source)}">Fork it and change one&nbsp;line&nbsp;↗</a></p>`
        : ''
    }
  </div>
  <dl>
    <div><dt>Rebuilt</dt><dd>${new Date(data.generatedAt).toUTCString()}</dd></div>
    <div><dt>Highest PR</dt><dd>#${num(data.highestPr)}</dd></div>
  </dl>
</footer>

<script src="./app.js" defer></script>
</body>
</html>
`

mkdirSync(root('dist'), { recursive: true })
writeFileSync(root('dist/index.html'), html)
copyFileSync(src('styles.css'), root('dist/styles.css'))
copyFileSync(src('app.js'), root('dist/app.js'))
copyFileSync(src('_headers'), root('dist/_headers'))
copyFileSync(src('og.png'), root('dist/og.png'))
if (isHomeRepo) copyFileSync(src('favicon.svg'), root('dist/favicon.svg'))

// Both need a public URL to point at: a sitemap of relative links is no sitemap
// at all, and robots.txt is mostly here to advertise one.
if (config.url) {
  writeFileSync(root('dist/robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${config.url}/sitemap.xml\n`)
  writeFileSync(
    root('dist/sitemap.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>${config.url}/</loc>
    <lastmod>${data.generatedAt.slice(0, 10)}</lastmod>
  </url>
</urlset>
`
  )
}
console.error(`Built dist/ — ${data.achievements.length} numbers, ${data.leaderboard.length} members.`)
