/**
 * The handful of formatters the page and the social card both need, so that a
 * number or a date reads the same wherever it is rendered.
 */

export const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

export const num = (n) => n.toLocaleString('en-US')

/** How long ago, at the resolution a reader actually cares about. */
export function since(iso) {
  const days = Math.floor((Date.now() - Date.parse(iso)) / 86400000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days}d ago`
  if (days < 365) return `${Math.floor(days / 30)}mo ago`
  const years = Math.floor(days / 365)
  return `${years}y ago`
}
