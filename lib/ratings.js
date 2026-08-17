export const PLATFORMS = ["douban", "maoyan", "taopiaopiao"];

export const DEFAULT_WEIGHTS = Object.freeze({
  douban: 50,
  maoyan: 25,
  taopiaopiao: 25,
});

/** @param {{douban?: number, maoyan?: number, taopiaopiao?: number}} weights */
export function normalizeWeights(weights = DEFAULT_WEIGHTS) {
  const clean = Object.fromEntries(
    PLATFORMS.map((platform) => [platform, Math.max(0, Number(weights[platform]) || 0)]),
  );
  const total = Object.values(clean).reduce((sum, value) => sum + value, 0);
  const base = total > 0 ? clean : DEFAULT_WEIGHTS;
  const denominator = total > 0 ? total : 100;

  return Object.fromEntries(
    PLATFORMS.map((platform) => [platform, base[platform] / denominator]),
  );
}

/**
 * Missing scores are ignored and the remaining platform weights are
 * renormalized, so a missing source never behaves like a zero score.
 * @param {Record<string, {score?: number | null}>} ratings
 * @param {{douban?: number, maoyan?: number, taopiaopiao?: number}} weights
 */
export function effectiveWeights(ratings, weights = DEFAULT_WEIGHTS) {
  const normalized = normalizeWeights(weights);
  const available = PLATFORMS.filter((platform) => Number.isFinite(ratings?.[platform]?.score));
  const availableWeight = available.reduce((sum, platform) => sum + normalized[platform], 0);

  if (!available.length || availableWeight <= 0) {
    return Object.fromEntries(PLATFORMS.map((platform) => [platform, 0]));
  }

  return Object.fromEntries(
    PLATFORMS.map((platform) => [
      platform,
      available.includes(platform) ? normalized[platform] / availableWeight : 0,
    ]),
  );
}

/**
 * @param {Record<string, {score?: number | null}>} ratings
 * @param {{douban?: number, maoyan?: number, taopiaopiao?: number}} weights
 */
export function calculateComposite(ratings, weights = DEFAULT_WEIGHTS) {
  const applied = effectiveWeights(ratings, weights);
  const score = PLATFORMS.reduce((sum, platform) => {
    const value = ratings?.[platform]?.score;
    return Number.isFinite(value) ? sum + Number(value) * applied[platform] : sum;
  }, 0);

  return Object.values(applied).some((value) => value > 0)
    ? Math.round((score + Number.EPSILON) * 10) / 10
    : null;
}

/**
 * Percentage of the requested weighting covered by available source scores.
 * @param {Record<string, {score?: number | null}>} ratings
 * @param {{douban?: number, maoyan?: number, taopiaopiao?: number}} weights
 */
export function calculateCoverage(ratings, weights = DEFAULT_WEIGHTS) {
  const normalized = normalizeWeights(weights);
  return Math.round(
    PLATFORMS.reduce(
      (sum, platform) => sum + (Number.isFinite(ratings?.[platform]?.score) ? normalized[platform] : 0),
      0,
    ) * 100,
  );
}
