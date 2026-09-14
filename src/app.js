/**
 * Filtering and sorting for the club register.
 *
 * The page is fully rendered at build time; this only rearranges and hides
 * what is already there, so everything still works with JavaScript off.
 */

;(() => {
  'use strict'

  /* ── The numbers: filter by category/status, plus free text ── */

  const stubs = [...document.querySelectorAll('.stub')]
  const filterButtons = [...document.querySelectorAll('[data-filter]')]
  const search = document.getElementById('search')
  const empty = document.querySelector('.empty')

  let filter = 'all'

  const matchesFilter = (stub) => {
    if (filter === 'all') return true
    if (filter === 'claimed') return stub.dataset.claimed === 'true'
    if (filter === 'open') return stub.dataset.claimed === 'false'
    return stub.dataset.category === filter
  }

  function apply() {
    const query = (search?.value ?? '').trim().toLowerCase()
    let shown = 0
    for (const stub of stubs) {
      const visible = matchesFilter(stub) && (!query || stub.dataset.search.includes(query))
      stub.hidden = !visible
      if (visible) shown++
    }
    if (empty) empty.hidden = shown > 0
  }

  for (const button of filterButtons) {
    button.addEventListener('click', () => {
      filter = button.dataset.filter
      for (const other of filterButtons) other.setAttribute('aria-pressed', String(other === button))
      apply()
    })
  }

  search?.addEventListener('input', apply)

  /* ── The register: recount the ranking when the sort changes ── */

  const register = document.querySelector('.register')
  const rows = register ? [...register.children] : []

  const ORDER = {
    // Most numbers wins; rarity breaks the tie.
    count: (a, b) => b.count - a.count || b.points - a.points,
    // Rarest haul wins; volume breaks the tie.
    points: (a, b) => b.points - a.points || b.count - a.count,
  }

  function sortRegister(mode) {
    const entries = rows.map((el) => ({
      el,
      count: Number(el.dataset.count),
      points: Number(el.dataset.points),
      first: el.dataset.first,
    }))

    entries.sort((a, b) => ORDER[mode](a, b) || a.first.localeCompare(b.first))

    // Standard competition ranking: ties share a place, the next one skips.
    let rank = 0
    let previous = null
    entries.forEach((entry, i) => {
      const key = `${entry.count}:${entry.points}`
      if (key !== previous) {
        rank = i + 1
        previous = key
      }
      entry.el.querySelector('.register__rank').textContent = rank
      entry.el.dataset.podium = rank
      register.appendChild(entry.el)
    })
  }

  for (const button of document.querySelectorAll('[data-sort]')) {
    button.addEventListener('click', () => {
      for (const other of document.querySelectorAll('[data-sort]')) {
        other.setAttribute('aria-pressed', String(other === button))
      }
      sortRegister(button.dataset.sort)
    })
  }
})()
