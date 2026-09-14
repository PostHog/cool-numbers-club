/**
 * Fetches the current state of the club from the GitHub GraphQL API and writes
 * data/achievements.json.
 *
 * Aliased batches keep this cheap: every number in the catalogue is looked up
 * in a handful of requests, each costing a single rate-limit point.
 */

import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { catalogue } from './numbers.mjs'

const REPO = { owner: 'posthog', name: 'posthog' }
const BATCH_SIZE = 100

/**
 * Some automation runs under plain User accounts, so GraphQL reports it as
 * `User` rather than `Bot`. These suffixes catch the rest without snagging
 * anyone real.
 */
const BOT_LOGIN = /(\[bot\]|-bot|_bot|-app)$/i
const BOT_LOGINS = new Set(['posthog'])

const looksLikeABot = (author) =>
  author.__typename === 'Bot' || BOT_LOGIN.test(author.login) || BOT_LOGINS.has(author.login)

function token() {
  const fromEnv = process.env.GITHUB_TOKEN || process.env.GH_TOKEN
  if (fromEnv) return fromEnv
  try {
    // Local convenience: borrow the gh CLI's credentials.
    return execFileSync('gh', ['auth', 'token'], { encoding: 'utf8' }).trim()
  } catch {
    throw new Error('No GITHUB_TOKEN set, and `gh auth token` failed. Set GITHUB_TOKEN and retry.')
  }
}

const AUTH = token()

async function graphql(query) {
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      Authorization: `bearer ${AUTH}`,
      'Content-Type': 'application/json',
      'User-Agent': 'cool-numbers-club',
    },
    body: JSON.stringify({ query }),
  })
  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${await res.text()}`)
  const body = await res.json()
  // Missing numbers come back as NOT_FOUND errors alongside good data, which is
  // expected -- plenty of cool numbers were issues, not PRs. Anything else is real.
  const fatal = (body.errors ?? []).filter((e) => e.type !== 'NOT_FOUND')
  if (fatal.length) throw new Error(`GitHub GraphQL: ${JSON.stringify(fatal)}`)
  if (!body.data) throw new Error(`GitHub GraphQL returned no data: ${JSON.stringify(body.errors)}`)
  return body.data
}

async function highestPrNumber() {
  const data = await graphql(`query {
    repository(owner: "${REPO.owner}", name: "${REPO.name}") {
      pullRequests(first: 1, orderBy: { field: CREATED_AT, direction: DESC }) { nodes { number } }
    }
  }`)
  return data.repository.pullRequests.nodes[0].number
}

const PR_FIELDS = `
  number
  title
  url
  state
  createdAt
  mergedAt
  additions
  deletions
  author { __typename login url avatarUrl ... on User { name } }
`

async function fetchPulls(numbers) {
  const results = new Map()
  for (let i = 0; i < numbers.length; i += BATCH_SIZE) {
    const batch = numbers.slice(i, i + BATCH_SIZE)
    const aliases = batch.map((n) => `n${n}: pullRequest(number: ${n}) { ${PR_FIELDS} }`).join('\n')
    const data = await graphql(`query { repository(owner: "${REPO.owner}", name: "${REPO.name}") { ${aliases} } }`)
    for (const [alias, pr] of Object.entries(data.repository)) {
      if (pr) results.set(Number(alias.slice(1)), pr)
    }
    process.stderr.write(`  fetched ${Math.min(i + BATCH_SIZE, numbers.length)}/${numbers.length}\n`)
  }
  return results
}

async function main() {
  const max = await highestPrNumber()
  console.error(`Highest PR in ${REPO.owner}/${REPO.name}: #${max.toLocaleString('en-US')}`)

  const entries = catalogue(max)
  console.error(`Catalogue: ${entries.length} cool numbers`)

  const pulls = await fetchPulls(entries.map((e) => e.number))

  const achievements = entries.map((entry) => {
    const pr = pulls.get(entry.number)
    // Only merged PRs count. Issues, unmerged PRs and gaps leave the slot open.
    if (!pr || pr.state !== 'MERGED' || !pr.author) {
      return { ...entry, claimed: false, why: !pr ? 'not-a-pr' : pr.state === 'OPEN' ? 'open' : 'unmerged' }
    }
    const isBot = looksLikeABot(pr.author)
    return {
      ...entry,
      claimed: true,
      bot: isBot,
      holder: {
        login: pr.author.login,
        name: pr.author.name || null,
        url: pr.author.url,
        avatarUrl: pr.author.avatarUrl,
        bot: isBot,
      },
      pr: {
        title: pr.title,
        url: pr.url,
        mergedAt: pr.mergedAt,
        createdAt: pr.createdAt,
        additions: pr.additions,
        deletions: pr.deletions,
      },
    }
  })

  // Look past the current PR number to find what the repo is heading towards.
  const upcoming = catalogue(max * 2 + 1000)
    .filter((e) => e.number > max)
    .slice(0, 4)
    .map((e) => ({ ...e, toGo: e.number - max }))

  // Bots hold their numbers on the wall of fame, but they do not get to compete.
  const leaderboard = buildLeaderboard(achievements.filter((a) => a.claimed && !a.bot))

  const claimed = achievements.filter((a) => a.claimed)
  const payload = {
    generatedAt: new Date().toISOString(),
    repo: `${REPO.owner}/${REPO.name}`,
    highestPr: max,
    stats: {
      total: achievements.length,
      claimed: claimed.length,
      byHumans: claimed.filter((a) => !a.bot).length,
      byBots: claimed.filter((a) => a.bot).length,
      unclaimed: achievements.length - claimed.length,
      members: leaderboard.length,
    },
    upcoming,
    // Newest inductees first -- this is what changes between nightly builds.
    recent: achievements
      .filter((a) => a.claimed && !a.bot)
      .sort((a, b) => b.pr.mergedAt.localeCompare(a.pr.mergedAt))
      .slice(0, 6)
      .map((a) => ({ number: a.number, name: a.name, tier: a.tier, holder: a.holder, mergedAt: a.pr.mergedAt, url: a.pr.url })),
    achievements,
    leaderboard,
  }

  writeFileSync(new URL('../data/achievements.json', import.meta.url), JSON.stringify(payload, null, 2) + '\n')
  console.error(
    `Wrote data/achievements.json -- ${payload.stats.claimed} claimed ` +
      `(${payload.stats.byHumans} human, ${payload.stats.byBots} bot), ` +
      `${payload.stats.unclaimed} still up for grabs, ${leaderboard.length} club members.`
  )
}

/** Rank by number of achievements, then by rarity, then by who got there first. */
function buildLeaderboard(claimed) {
  const byLogin = new Map()
  for (const a of claimed) {
    const existing = byLogin.get(a.holder.login) ?? { ...a.holder, achievements: [], points: 0 }
    existing.achievements.push({ number: a.number, name: a.name, tier: a.tier, category: a.category, url: a.pr.url, title: a.pr.title, mergedAt: a.pr.mergedAt })
    existing.points += a.points
    byLogin.set(a.holder.login, existing)
  }

  const members = [...byLogin.values()].map((m) => ({
    ...m,
    count: m.achievements.length,
    achievements: m.achievements.sort((a, b) => a.number - b.number),
    firstMergedAt: m.achievements.reduce((min, a) => (a.mergedAt < min ? a.mergedAt : min), '9999'),
  }))

  members.sort(
    (a, b) => b.count - a.count || b.points - a.points || a.firstMergedAt.localeCompare(b.firstMergedAt)
  )

  // Standard competition ranking: equal scores share a rank, the next one skips.
  let rank = 0
  let previous = null
  return members.map((m, i) => {
    const key = `${m.count}:${m.points}`
    if (key !== previous) { rank = i + 1; previous = key }
    return { ...m, rank }
  })
}

await main()
