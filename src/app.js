/**
 * Filtering and sorting for the club register.
 *
 * The page is fully rendered at build time; this only rearranges and hides
 * what is already there, so everything still works with JavaScript off.
 */

;(() => {
  'use strict'

  const calm = matchMedia('(prefers-reduced-motion: reduce)')

  /* ── The numbers: filter by category/status, plus free text ── */

  const stubs = [...document.querySelectorAll('.stub')]
  const filterButtons = [...document.querySelectorAll('[data-filter]')]
  const search = document.getElementById('search')
  const empty = document.querySelector('.stubs ~ .empty')

  let filter = 'all'

  const STATUSES = new Set(['claimed', 'missed', 'future'])

  const matchesFilter = (stub) => {
    if (filter === 'all') return true
    if (STATUSES.has(filter)) return stub.dataset.status === filter
    return stub.dataset.category === filter
  }

  function applyFilters() {
    const query = (search?.value ?? '').trim().toLowerCase()
    let shown = 0
    for (const stub of stubs) {
      const visible = matchesFilter(stub) && (!query || stub.dataset.search.includes(query))
      stub.hidden = !visible
      if (visible) shown++
    }
    if (empty) empty.hidden = shown > 0
  }

  function setFilter(next) {
    filter = next
    for (const button of filterButtons) button.setAttribute('aria-pressed', String(button.dataset.filter === next))
    applyFilters()
  }

  for (const button of filterButtons) button.addEventListener('click', () => setFilter(button.dataset.filter))
  search?.addEventListener('input', applyFilters)

  /* ── The register ──────────────────────────────────────────
     Two controls: what to sort by, and which rarities count at
     all. Narrowing the rarities re-scores everyone, so the
     ranking is recomputed rather than just re-ordered. */

  const register = document.querySelector('.register')
  const registerEmpty = document.querySelector('[data-register-empty]')
  if (!register) return

  const tierPoints = JSON.parse(register.dataset.tierPoints)
  const TIERS = Object.keys(tierPoints)
  const selected = new Set(TIERS)
  let sortMode = 'count'

  const ORDER = {
    // Most numbers wins; rarity breaks the tie.
    count: (a, b) => b.count - a.count || b.points - a.points,
    // Rarest haul wins; volume breaks the tie.
    points: (a, b) => b.points - a.points || b.count - a.count,
  }

  const key = (prefix, tier) => `${prefix}${tier[0].toUpperCase()}${tier.slice(1)}`

  const members = [...register.children].map((el) => ({
    el,
    byTier: Object.fromEntries(TIERS.map((t) => [t, Number(el.dataset[key('tier', t)] || 0)])),
    firstByTier: Object.fromEntries(TIERS.map((t) => [t, el.dataset[key('first', t)] || ''])),
    rankEl: el.querySelector('.register__rank'),
    countEl: el.querySelector('.register__count'),
    pointsEl: el.querySelector('.register__pts'),
    chips: [...el.querySelectorAll('.chip')],
  }))

  function refreshRegister() {
    for (const m of members) {
      m.count = TIERS.reduce((n, t) => (selected.has(t) ? n + m.byTier[t] : n), 0)
      m.points = TIERS.reduce((n, t) => (selected.has(t) ? n + m.byTier[t] * tierPoints[t] : n), 0)
      // Earliest claim among the rarities still being counted.
      m.first = TIERS.filter((t) => selected.has(t) && m.firstByTier[t])
        .map((t) => m.firstByTier[t])
        .sort()[0] ?? ''
      for (const chip of m.chips) chip.hidden = !selected.has(chip.dataset.tier)
    }

    // Someone with nothing in the selected rarities is not in this contest.
    const ranked = members.filter((m) => m.count > 0)
    ranked.sort((a, b) => ORDER[sortMode](a, b) || a.first.localeCompare(b.first))

    ranked.forEach((m, i) => {
      const rank = i + 1
      m.rankEl.textContent = rank
      m.el.dataset.podium = rank
      m.countEl.textContent = m.count
      m.pointsEl.textContent = `${m.points} pts`
      m.el.hidden = false
      register.appendChild(m.el)
    })

    for (const m of members) if (m.count === 0) m.el.hidden = true
    if (registerEmpty) registerEmpty.hidden = ranked.length > 0
  }

  for (const button of document.querySelectorAll('[data-sort]')) {
    button.addEventListener('click', () => {
      sortMode = button.dataset.sort
      for (const other of document.querySelectorAll('[data-sort]')) {
        other.setAttribute('aria-pressed', String(other === button))
      }
      refreshRegister()
    })
  }

  for (const button of document.querySelectorAll('[data-tier-filter]')) {
    button.addEventListener('click', () => {
      const tier = button.dataset.tierFilter
      if (selected.has(tier)) selected.delete(tier)
      else selected.add(tier)
      button.setAttribute('aria-pressed', String(selected.has(tier)))
      refreshRegister()
    })
  }

  /* ── Register chips jump to the ticket, not to GitHub ─────── */

  register.addEventListener('click', (event) => {
    const chip = event.target.closest('.chip')
    if (!chip) return
    const target = document.getElementById(chip.getAttribute('href').slice(1))
    if (!target) return

    event.preventDefault()
    // A filter or search would otherwise hide the very stub we are jumping to.
    if (search) search.value = ''
    setFilter('all')

    target.scrollIntoView({ behavior: calm.matches ? 'auto' : 'smooth', block: 'center' })
    target.classList.remove('is-found')
    void target.offsetWidth // restart the highlight if it is already running
    target.classList.add('is-found')
    history.replaceState(null, '', chip.getAttribute('href'))
  })

  refreshRegister()
})()
