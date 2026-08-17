import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { calculateComposite, calculateCoverage } from "../lib/ratings.js";

const path = new URL("../data/movies.json", import.meta.url);
const dataset = JSON.parse(await readFile(path, "utf8"));
const ids = new Set();
const platforms = ["douban", "maoyan", "taopiaopiao"];
const validStatuses = new Set(["live", "cached", "unavailable"]);
const validCatalogStatuses = new Set(["current", "archived"]);

assert.equal(dataset.schemaVersion, 1, "Unsupported dataset schema");
assert.ok(Array.isArray(dataset.movies) && dataset.movies.length > 0, "No movies found");
assert.equal(dataset.calibration?.method, "z-score", "Unexpected calibration method");
assert.equal(dataset.calibration?.sampleMode, "complete-cases", "Calibration must use comparable films");
assert.ok(dataset.calibration?.sampleSize >= 5, "Calibration needs at least five complete films");
assert.equal(dataset.calibration?.enabled, true, "Distribution calibration is not active");
assert.equal(dataset.calibration?.zLimit, 2.5, "Calibration outlier guardrail is missing");

for (const movie of dataset.movies) {
  assert.ok(movie.id && !ids.has(movie.id), `Duplicate or missing id: ${movie.id}`);
  ids.add(movie.id);
  assert.ok(movie.title && movie.releaseDateChina, `${movie.id} is missing core metadata`);
  assert.ok(validCatalogStatuses.has(movie.catalogStatus), `${movie.id} catalog status is invalid`);
  for (const platform of platforms) {
    const rating = movie.ratings?.[platform];
    assert.ok(rating, `${movie.id} is missing ${platform}`);
    assert.ok(rating.score === null || (rating.score > 0 && rating.score <= 10), `${movie.id}.${platform} score is invalid`);
    assert.ok(validStatuses.has(rating.status), `${movie.id}.${platform} status is invalid`);
    assert.match(rating.url, /^https:\/\//, `${movie.id}.${platform} source URL must use HTTPS`);
    if (rating.score !== null) assert.match(rating.checkedAt, /^\d{4}-\d{2}-\d{2}$/, `${movie.id}.${platform} checkedAt is invalid`);
  }
  const score = calculateComposite(movie.ratings, dataset.defaultWeights, dataset.calibration);
  assert.equal(movie.cachedComposite, score, `${movie.id} cached score is stale`);
  assert.ok(score === null || (score >= 0 && score <= 10), `${movie.id} score is out of range`);
  assert.ok(calculateCoverage(movie.ratings, dataset.defaultWeights) > 0, `${movie.id} has no score coverage`);
}

assert.equal(dataset.catalogStatus?.current + dataset.catalogStatus?.archived, dataset.movies.length, "Catalog status totals do not reconcile");
assert.equal(dataset.catalogStatus?.total, dataset.movies.length, "Catalog total is stale");
assert.equal(dataset.catalogStatus?.autoDiscovered, dataset.movies.filter((movie) => movie.autoDiscovered).length, "Auto-discovery count is stale");

for (const platform of platforms) {
  const stats = dataset.calibration.platforms?.[platform];
  assert.equal(stats?.count, dataset.calibration.sampleSize, `${platform} calibration sample count is inconsistent`);
  assert.ok(stats?.mean > 0 && stats.mean <= 10, `${platform} calibration mean is invalid`);
  assert.ok(stats?.standardDeviation >= 0.05, `${platform} calibration spread is too small`);
  const status = dataset.sourceStatus?.[platform];
  assert.ok(status, `Missing source status for ${platform}`);
  assert.equal(status.live + status.cached + status.unavailable, dataset.movies.length, `${platform} status totals do not reconcile`);
}

console.log(`Validated ${dataset.movies.length} movie records and all cached scores.`);
