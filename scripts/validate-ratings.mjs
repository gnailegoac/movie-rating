import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { calculateComposite, calculateCoverage } from "../lib/ratings.js";

const path = new URL("../data/movies.json", import.meta.url);
const dataset = JSON.parse(await readFile(path, "utf8"));
const ids = new Set();

assert.equal(dataset.schemaVersion, 1, "Unsupported dataset schema");
assert.ok(Array.isArray(dataset.movies) && dataset.movies.length > 0, "No movies found");

for (const movie of dataset.movies) {
  assert.ok(movie.id && !ids.has(movie.id), `Duplicate or missing id: ${movie.id}`);
  ids.add(movie.id);
  assert.ok(movie.title && movie.releaseDateChina, `${movie.id} is missing core metadata`);
  const score = calculateComposite(movie.ratings, dataset.defaultWeights);
  assert.equal(movie.cachedComposite, score, `${movie.id} cached score is stale`);
  assert.ok(score === null || (score >= 0 && score <= 10), `${movie.id} score is out of range`);
  assert.ok(calculateCoverage(movie.ratings, dataset.defaultWeights) > 0, `${movie.id} has no score coverage`);
}

console.log(`Validated ${dataset.movies.length} movie records and all cached scores.`);
