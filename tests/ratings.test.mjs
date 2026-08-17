import assert from "node:assert/strict";
import test from "node:test";
import { estimateMtimeSubitemRating } from "../lib/mtime-rating.js";
import {
  calculateCalibration,
  calculateComposite,
  calculateCoverage,
  effectiveWeights,
  hasRatingAnchor,
  normalizePlatformScore,
  normalizeWeights,
} from "../lib/ratings.js";

const ratings = {
  douban: { score: 8 },
  mtime: { score: 8.5 },
  maoyan: { score: 9 },
  taopiaopiao: { score: 10 },
};

test("uses the default 25/25/25/25 weighting", () => {
  assert.equal(calculateComposite(ratings), 8.9);
});

test("renormalizes remaining weights when a platform score is missing", () => {
  const partial = { ...ratings, taopiaopiao: { score: null } };
  assert.deepEqual(effectiveWeights(partial), { douban: 1 / 3, mtime: 1 / 3, maoyan: 1 / 3, taopiaopiao: 0 });
  assert.equal(calculateComposite(partial), 8.5);
  assert.equal(calculateCoverage(partial), 75);
});

test("does not publish a composite from ticketing-platform scores alone", () => {
  const ticketingOnly = {
    douban: { score: null },
    mtime: { score: null },
    maoyan: { score: 9.4 },
    taopiaopiao: { score: 9.2 },
  };
  assert.equal(hasRatingAnchor(ticketingOnly), false);
  assert.deepEqual(effectiveWeights(ticketingOnly), { douban: 0, mtime: 0, maoyan: 0, taopiaopiao: 0 });
  assert.equal(calculateCoverage(ticketingOnly), 0);
  assert.equal(calculateComposite(ticketingOnly), null);
  assert.equal(calculateComposite(ratings, { douban: 0, mtime: 0, maoyan: 50, taopiaopiao: 50 }), null);
});

test("normalizes user supplied weights and handles all-zero input", () => {
  assert.deepEqual(normalizeWeights({ douban: 20, mtime: 10, maoyan: 30, taopiaopiao: 40 }), { douban: .2, mtime: .1, maoyan: .3, taopiaopiao: .4 });
  assert.deepEqual(normalizeWeights({ douban: 0, mtime: 0, maoyan: 0, taopiaopiao: 0 }), { douban: .25, mtime: .25, maoyan: .25, taopiaopiao: .25 });
});

test("discounts an estimated Mtime score to 50% confidence", () => {
  const withEstimate = {
    ...ratings,
    mtime: { score: 8.5, scoreType: "estimated-subitems", confidence: 0.5 },
  };
  assert.deepEqual(effectiveWeights(withEstimate), { douban: 2 / 7, mtime: 1 / 7, maoyan: 2 / 7, taopiaopiao: 2 / 7 });
  assert.equal(calculateCoverage(withEstimate), 88);
  assert.equal(calculateComposite(withEstimate), 8.9);
  assert.equal(hasRatingAnchor(withEstimate), true);
});

test("estimates Mtime only from all five valid sub-items and enough votes", () => {
  const items = [
    { title: "音乐", rating: 6.6 },
    { title: "画面", rating: 6.9 },
    { title: "导演", rating: 6.7 },
    { title: "故事", rating: 6.7 },
    { title: "表演", rating: 6.9 },
  ];
  assert.deepEqual(estimateMtimeSubitemRating(items, 15), {
    score: 6.8,
    scoreType: "estimated-subitems",
    confidence: 0.5,
    voteCount: 15,
    subItemRatings: items.map(({ title, rating }) => ({ title, score: rating })),
  });
  assert.equal(estimateMtimeSubitemRating(items, 9), null);
  assert.equal(estimateMtimeSubitemRating(items.slice(0, 4), 15), null);
});

test("rebalances compressed platform scales before weighting", () => {
  const calibration = {
    enabled: true,
    targetMean: 7.5,
    targetStandardDeviation: 1,
    platforms: {
      douban: { mean: 7.5, standardDeviation: 1 },
      mtime: { mean: 7.5, standardDeviation: 1 },
      maoyan: { mean: 9.3, standardDeviation: 0.3 },
      taopiaopiao: { mean: 9.4, standardDeviation: 0.3 },
    },
  };
  const equivalentPositions = {
    douban: { score: 8.5 },
    mtime: { score: 8.5 },
    maoyan: { score: 9.6 },
    taopiaopiao: { score: 9.7 },
  };
  assert.ok(Math.abs(normalizePlatformScore(9.6, "maoyan", calibration) - 8.5) < 1e-10);
  assert.equal(calculateComposite(equivalentPositions, undefined, calibration), 8.5);
});

test("caps extreme z-scores before mapping them to the common scale", () => {
  const calibration = {
    enabled: true,
    targetMean: 7.5,
    targetStandardDeviation: 1,
    zLimit: 2.5,
    platforms: {
      douban: { mean: 7.5, standardDeviation: 1 },
      mtime: { mean: 7.5, standardDeviation: 1 },
      maoyan: { mean: 9.3, standardDeviation: 0.1 },
      taopiaopiao: { mean: 9.4, standardDeviation: 0.1 },
    },
  };
  assert.equal(normalizePlatformScore(8, "maoyan", calibration), 5);
  assert.equal(normalizePlatformScore(10, "maoyan", calibration), 10);
});

test("only enables calibration with a sufficient common sample", () => {
  const repeated = Array.from({ length: 5 }, (_, index) => ({
    ratings: {
      douban: { score: 6 + index * 0.5 },
      mtime: { score: 6.5 + index * 0.4 },
      maoyan: { score: 9 + index * 0.2 },
      taopiaopiao: { score: 9.1 + index * 0.15 },
    },
  }));
  const calibration = calculateCalibration(repeated);
  assert.equal(calibration.enabled, true);
  assert.equal(calibration.sampleSize, 5);
  assert.equal(calculateCalibration(repeated.slice(0, 4)).enabled, false);
  const estimatedMtime = repeated.map((movie) => ({
    ratings: { ...movie.ratings, mtime: { ...movie.ratings.mtime, scoreType: "estimated-subitems", confidence: 0.5 } },
  }));
  assert.equal(calculateCalibration(estimatedMtime).sampleSize, 0);
  assert.equal(calculateCalibration(estimatedMtime).enabled, false);
});
