/**
 * Every current theatrical movie belongs in the catalog even before ratings
 * appear. Film-festival event cards are excluded because they are not movies.
 * An explicit limit remains available for diagnostics, but production defaults
 * to the complete current list.
 */
export function selectDiscoveryCards(cards, limit = Infinity) {
  const movies = (cards ?? []).filter((card) => !card.genres?.includes("影展"));
  return Number.isFinite(limit) && limit >= 0 ? movies.slice(0, limit) : movies;
}
