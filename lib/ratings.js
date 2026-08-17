export const PLATFORMS = ["douban", "maoyan", "taopiaopiao"];

export const DEFAULT_WEIGHTS = Object.freeze({
  douban: 50,
  maoyan: 25,
  taopiaopiao: 25,
});

export const DEFAULT_CALIBRATION_TARGET = Object.freeze({
  mean: 7.5,
  standardDeviation: 1,
});

/**
 * Builds one comparable distribution per platform from the same set of films.
 * Complete cases avoid comparing a selective Douban sample with a different
 * ticketing-platform sample. At least five complete films are required.
 * @param {Array<{ratings?: Record<string, {score?: number | null}>}>} movies
 */
export function calculateCalibration(movies) {
  const completeCases = (movies ?? []).filter((movie) =>
    PLATFORMS.every((platform) => Number.isFinite(movie.ratings?.[platform]?.score)),
  );
  const platforms = Object.fromEntries(PLATFORMS.map((platform) => {
    const values = completeCases.map((movie) => Number(movie.ratings[platform].score));
    const mean = values.length
      ? values.reduce((sum, value) => sum + value, 0) / values.length
      : null;
    const variance = values.length
      ? values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length
      : null;
    const standardDeviation = variance === null ? null : Math.sqrt(variance);
    return [platform, {
      count: values.length,
      mean,
      standardDeviation,
    }];
  }));
  const enabled = completeCases.length >= 5 && PLATFORMS.every((platform) =>
    Number.isFinite(platforms[platform].standardDeviation)
      && platforms[platform].standardDeviation >= 0.05,
  );

  return {
    method: "z-score",
    enabled,
    sampleMode: "complete-cases",
    sampleSize: completeCases.length,
    targetMean: DEFAULT_CALIBRATION_TARGET.mean,
    targetStandardDeviation: DEFAULT_CALIBRATION_TARGET.standardDeviation,
    zLimit: 2.5,
    platforms,
  };
}

/**
 * Maps a raw platform score to a shared 0–10 scale. A score one platform
 * standard deviation above its mean becomes 8.5 on the shared scale.
 * @param {number | null | undefined} score
 * @param {string} platform
 * @param {{enabled?: boolean, targetMean?: number, targetStandardDeviation?: number, platforms?: Record<string, {mean?: number, standardDeviation?: number}>} | null} calibration
 */
export function normalizePlatformScore(score, platform, calibration) {
  if (!Number.isFinite(score)) return null;
  if (!calibration?.enabled) return Number(score);
  const stats = calibration.platforms?.[platform];
  if (!Number.isFinite(stats?.mean) || !Number.isFinite(stats?.standardDeviation) || stats.standardDeviation <= 0) {
    return Number(score);
  }
  const rawZScore = (Number(score) - stats.mean) / stats.standardDeviation;
  const zLimit = Number.isFinite(calibration.zLimit) ? calibration.zLimit : Infinity;
  const zScore = Math.min(zLimit, Math.max(-zLimit, rawZScore));
  const normalized = calibration.targetMean + zScore * calibration.targetStandardDeviation;
  return Math.min(10, Math.max(0, normalized));
}

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
export function calculateComposite(ratings, weights = DEFAULT_WEIGHTS, calibration = null) {
  const applied = effectiveWeights(ratings, weights);
  const score = PLATFORMS.reduce((sum, platform) => {
    const value = normalizePlatformScore(ratings?.[platform]?.score, platform, calibration);
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
