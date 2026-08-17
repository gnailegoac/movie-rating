export const MTIME_SUBITEM_TITLES = Object.freeze(["音乐", "画面", "导演", "故事", "表演"]);
export const MTIME_SUBITEM_MIN_VOTES = 10;
export const MTIME_ESTIMATE_CONFIDENCE = 0.5;

/**
 * Produces a transparent proxy only when Mtime withholds its official overall
 * rating but exposes all five sub-item ratings with a usable sample.
 * @param {Array<{title?: string, rating?: number}> | null | undefined} items
 * @param {number | null | undefined} voteCount
 */
export function estimateMtimeSubitemRating(items, voteCount) {
  const votes = Number(voteCount);
  if (!Number.isFinite(votes) || votes < MTIME_SUBITEM_MIN_VOTES || !Array.isArray(items)) return null;

  const byTitle = new Map(items.map((item) => [String(item?.title ?? ""), Number(item?.rating)]));
  const subItemRatings = MTIME_SUBITEM_TITLES.map((title) => ({ title, score: byTitle.get(title) }));
  if (subItemRatings.some(({ score }) => !Number.isFinite(score) || score <= 0 || score > 10)) return null;

  const average = subItemRatings.reduce((sum, item) => sum + item.score, 0) / subItemRatings.length;
  return {
    score: Math.round((average + Number.EPSILON) * 10) / 10,
    scoreType: "estimated-subitems",
    confidence: MTIME_ESTIMATE_CONFIDENCE,
    voteCount: votes,
    subItemRatings,
  };
}
