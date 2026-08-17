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

/** Selects an Mtime search result by persisted id, title and production year. */
export function selectMtimeCandidate(candidates, movie) {
  const items = (Array.isArray(candidates) ? candidates : []).filter((item) => item?.movieId);
  const expectedId = String(movie.platformIds?.mtime ?? "");
  const idMatch = items.find((item) => expectedId && String(item.movieId) === expectedId);
  if (idMatch) return idMatch;

  const title = normalizedTitle(movie.title);
  const englishTitle = normalizedTitle(movie.englishTitle);
  const titleMatches = items.filter((item) => normalizedTitle(item.name) === title);
  const expectedYear = Number(movie.originalYear ?? movie.year);
  if (!Number.isFinite(expectedYear)) return titleMatches.length === 1 ? titleMatches[0] : null;

  const candidateYear = (item) => Number(item.year) || Number(item.rYear) || null;
  const yearMatches = titleMatches
    .filter((item) => {
      const year = candidateYear(item);
      return Number.isFinite(year) && Math.abs(year - expectedYear) <= 1;
    })
    .sort((left, right) => {
      const leftYear = candidateYear(left);
      const rightYear = candidateYear(right);
      return Math.abs(leftYear - expectedYear) - Math.abs(rightYear - expectedYear);
    });
  const exactEnglishMatch = yearMatches.find((item) =>
    englishTitle
      && englishTitle !== title
      && normalizedTitle(item.nameEn) === englishTitle,
  );
  return exactEnglishMatch ?? (titleMatches.length === 1 && yearMatches.length === 1 ? yearMatches[0] : null);
}
