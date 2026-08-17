import assert from "node:assert/strict";
import test from "node:test";
import { calculateComposite, calculateCoverage, effectiveWeights, normalizeWeights } from "../lib/ratings.js";

const ratings = {
  douban: { score: 8 },
  maoyan: { score: 9 },
  taopiaopiao: { score: 10 },
};

test("uses the default 50/25/25 weighting", () => {
  assert.equal(calculateComposite(ratings), 8.8);
});

test("renormalizes remaining weights when a platform score is missing", () => {
  const partial = { ...ratings, taopiaopiao: { score: null } };
  assert.deepEqual(effectiveWeights(partial), { douban: 2 / 3, maoyan: 1 / 3, taopiaopiao: 0 });
  assert.equal(calculateComposite(partial), 8.3);
  assert.equal(calculateCoverage(partial), 75);
});

test("normalizes user supplied weights and handles all-zero input", () => {
  assert.deepEqual(normalizeWeights({ douban: 20, maoyan: 30, taopiaopiao: 50 }), { douban: .2, maoyan: .3, taopiaopiao: .5 });
  assert.deepEqual(normalizeWeights({ douban: 0, maoyan: 0, taopiaopiao: 0 }), { douban: .5, maoyan: .25, taopiaopiao: .25 });
});
