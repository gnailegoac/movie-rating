import { readFile, writeFile } from "node:fs/promises";
import { calculateComposite } from "../lib/ratings.js";

const sourcePath = new URL("../data/ratings-source.json", import.meta.url);
const outputPath = new URL("../data/movies.json", import.meta.url);
const source = JSON.parse(await readFile(sourcePath, "utf8"));

function validateScore(score, movieId, platform) {
  if (score === null) return;
  if (!Number.isFinite(score) || score < 0 || score > 10) {
    throw new Error(`${movieId}.${platform} score must be null or a number from 0 to 10`);
  }
}

function mergeFeed(base, feed) {
  const updates = new Map((feed.movies ?? []).map((movie) => [movie.id, movie]));
  return {
    ...base,
    generatedAt: feed.generatedAt ?? new Date().toISOString(),
    snapshotLabel: feed.snapshotLabel ?? "授权数据源快照",
    isDemo: false,
    movies: base.movies.map((movie) => {
      const update = updates.get(movie.id);
      if (!update) return movie;
      return {
        ...movie,
        ratings: {
          ...movie.ratings,
          ...update.ratings,
        },
      };
    }),
  };
}

let dataset = source;
if (process.env.RATING_FEED_URL) {
  const headers = { Accept: "application/json" };
  if (process.env.RATING_FEED_TOKEN) {
    headers.Authorization = `Bearer ${process.env.RATING_FEED_TOKEN}`;
  }
  const response = await fetch(process.env.RATING_FEED_URL, { headers });
  if (!response.ok) {
    throw new Error(`Rating feed returned HTTP ${response.status}`);
  }
  dataset = mergeFeed(source, await response.json());
}

if (!Array.isArray(dataset.movies) || dataset.movies.length === 0) {
  throw new Error("Dataset must contain at least one movie");
}

const seen = new Set();
const movies = dataset.movies.map((movie) => {
  if (!movie.id || seen.has(movie.id)) throw new Error(`Duplicate or missing movie id: ${movie.id}`);
  seen.add(movie.id);
  for (const platform of ["douban", "maoyan", "taopiaopiao"]) {
    if (!movie.ratings?.[platform]) throw new Error(`${movie.id} is missing ${platform}`);
    validateScore(movie.ratings[platform].score, movie.id, platform);
  }
  return {
    ...movie,
    cachedComposite: calculateComposite(movie.ratings, dataset.defaultWeights),
  };
});

await writeFile(outputPath, `${JSON.stringify({ ...dataset, movies }, null, 2)}\n`, "utf8");
console.log(`Wrote ${movies.length} movies to ${outputPath.pathname}`);
