import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateCalibration,
  calculateComposite,
  calculateCoverage,
  effectiveWeights,
  normalizePlatformScore,
  normalizeWeights,
} from "../lib/ratings.js";

const ratings = {
  douban: { score: 8 },
  mtime: { score: 8.5 },
  maoyan: { score: 9 },
  taopiaopiao: { score: 10 },
};

test("uses the default 40/20/20/20 weighting", () => {
  assert.equal(calculateComposite(ratings), 8.7);
});

test("renormalizes remaining weights when a platform score is missing", () => {
  const partial = { ...ratings, taopiaopiao: { score: null } };
  assert.deepEqual(effectiveWeights(partial), { douban: .5, mtime: .25, maoyan: .25, taopiaopiao: 0 });
  assert.equal(calculateComposite(partial), 8.4);
  assert.equal(calculateCoverage(partial), 80);
});

test("normalizes user supplied weights and handles all-zero input", () => {
  assert.deepEqual(normalizeWeights({ douban: 20, mtime: 10, maoyan: 30, taopiaopiao: 40 }), { douban: .2, mtime: .1, maoyan: .3, taopiaopiao: .4 });
  assert.deepEqual(normalizeWeights({ douban: 0, mtime: 0, maoyan: 0, taopiaopiao: 0 }), { douban: .4, mtime: .2, maoyan: .2, taopiaopiao: .2 });
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
});
