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

  const [owner, name] = repo.split('/')
  return { repo, owner, name, ceiling, title: title.trim() }
}

export const config = load()
