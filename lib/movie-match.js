function normalizedTitle(value = "") {
  return String(value)
    .normalize("NFKC")
    .replace(/[\s·•:：!！?？,，.。'‘’"“”()（）\[\]【】_-]/g, "")
    .toLocaleLowerCase("zh-CN");
}

/**
 * Selects a Douban search item without confusing remakes and re-releases that
 * share the same Chinese title. A persisted platform id is authoritative;
 * otherwise title and original production year must agree.
 */
export function selectDoubanCandidate(candidates, movie) {
  const items = (Array.isArray(candidates) ? candidates : []).filter((item) => item?.target);
  const expectedId = String(movie.platformIds?.douban ?? "");
  const idMatch = items.find(({ target }) => expectedId && String(target.id) === expectedId);
  if (idMatch) return idMatch;

  const titleMatches = items.filter(({ target }) => normalizedTitle(target.title) === normalizedTitle(movie.title));
  const expectedYear = Number(movie.originalYear ?? movie.year);
  if (!Number.isFinite(expectedYear)) return titleMatches[0] ?? null;

  const yearMatches = titleMatches
    .filter(({ target }) => Number.isFinite(Number(target.year)) && Math.abs(Number(target.year) - expectedYear) <= 1)
    .sort((left, right) => Math.abs(Number(left.target.year) - expectedYear) - Math.abs(Number(right.target.year) - expectedYear));
  return yearMatches[0]
    ?? titleMatches.find(({ target }) => !Number.isFinite(Number(target.year)))
    ?? null;
}
