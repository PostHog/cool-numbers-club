/**
 * Everything repo-specific lives in config.json at the root, so running this
 * for another repository is a one-file change and no code edits.
 */

import { readFileSync } from 'node:fs'

const FILE = new URL('../config.json', import.meta.url)

function load() {
  let raw
  try {
    raw = JSON.parse(readFileSync(FILE, 'utf8'))
  } catch (error) {
    throw new Error(`Could not read config.json: ${error.message}`)
  }

  const repo = raw.repo
  if (typeof repo !== 'string' || !/^[\w.-]+\/[\w.-]+$/.test(repo)) {
    throw new Error(`config.json: "repo" must look like "owner/name", got ${JSON.stringify(repo)}`)
  }

  const ceiling = raw.ceiling ?? 1_000_000
  if (!Number.isInteger(ceiling) || ceiling < 1) {
    throw new Error(`config.json: "ceiling" must be a positive whole number, got ${JSON.stringify(raw.ceiling)}`)
  }

  const title = raw.title ?? 'The Cool Numbers Club'
  if (typeof title !== 'string' || !title.trim()) {
    throw new Error(`config.json: "title" must be a non-empty string, got ${JSON.stringify(raw.title)}`)
  }

  // Public URL of the deployed site, no trailing slash. Needed for absolute
  // OG image and canonical URLs; omit it and those tags are left out.
  const url = raw.url ? String(raw.url).replace(/\/+$/, '') : null
  if (url !== null && !/^https?:\/\/[^\s/]+/.test(url)) {
    throw new Error(`config.json: "url" must be an absolute http(s) URL or be omitted, got ${JSON.stringify(raw.url)}`)
  }

  // Where this site's own code lives, for the "fork it" line in the footer.
  // Optional: leave it out and the footer simply omits that line.
  const source = raw.source ?? null
  if (source !== null && (typeof source !== 'string' || !/^[\w.-]+\/[\w.-]+$/.test(source))) {
    throw new Error(`config.json: "source" must look like "owner/name" or be omitted, got ${JSON.stringify(source)}`)
  }

  const [owner, name] = repo.split('/')
  return { repo, owner, name, ceiling, title: title.trim(), url, source }
}

export const config = load()

/**
 * Whether this is PostHog's own club rather than a fork pointed at some other
 * repository. Only the original flies PostHog's mark on the social card or
 * names PostHog as the publisher in the page's structured data.
 */
export const isHomeRepo = config.repo.toLowerCase() === 'posthog/posthog'
