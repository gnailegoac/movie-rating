import { readFile, writeFile } from "node:fs/promises";
import { calculateCalibration, calculateComposite } from "../lib/ratings.js";

const sourcePath = new URL("../data/ratings-source.json", import.meta.url);
const outputPath = new URL("../data/movies.json", import.meta.url);
const statusPath = new URL("../data/source-status.json", import.meta.url);
const PLATFORMS = ["douban", "maoyan", "taopiaopiao"];
const now = new Date();
const attemptedAt = now.toISOString();
const checkedAt = attemptedAt.slice(0, 10);
const source = JSON.parse(await readFile(sourcePath, "utf8"));

let previous = null;
try {
  previous = JSON.parse(await readFile(outputPath, "utf8"));
} catch {
  // A first run has no generated cache yet.
}

const previousById = new Map((previous?.movies ?? []).map((movie) => [movie.id, movie]));
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function normalizedTitle(value = "") {
  return String(value)
    .normalize("NFKC")
    .toLocaleLowerCase("zh-CN")
    .replace(/[\s·•:：!！?？,，.。'‘’"“”()（）\-—_]/g, "");
}

function assertTitle(movie, actual, platform) {
  if (normalizedTitle(movie.title) !== normalizedTitle(actual)) {
    throw new Error(`${platform} title mismatch for ${movie.id}: ${actual}`);
  }
}

function validScore(value) {
  const score = Number(value);
  return Number.isFinite(score) && score > 0 && score <= 10 ? score : null;
}

function validateScore(score, movieId, platform) {
  if (score === null) return;
  if (!Number.isFinite(score) || score < 0 || score > 10) {
    throw new Error(`${movieId}.${platform} score must be null or a number from 0 to 10`);
  }
}

async function fetchWithRetry(url, options = {}, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await delay(700 * attempt);
    }
  }
  throw lastError;
}

async function fetchJson(url, headers) {
  return (await fetchWithRetry(url, { headers })).json();
}

async function fetchDouban(movie) {
  const query = encodeURIComponent(movie.title);
  const searchUrl = `https://m.douban.com/rexxar/api/v2/search?q=${query}&start=0&count=10`;
  const result = await fetchJson(searchUrl, {
    Accept: "application/json",
    Referer: `https://m.douban.com/search/?query=${query}`,
    "User-Agent": "Mozilla/5.0 (compatible; MovieRatingSnapshot/1.0; +https://github.com/gnailegoac/movie-rating)",
  });
  const candidates = result?.subjects?.items ?? [];
  const expectedId = String(movie.platformIds?.douban ?? "");
  const match = candidates.find(({ target }) => expectedId && String(target?.id) === expectedId)
    ?? candidates.find(({ target }) => normalizedTitle(target?.title) === normalizedTitle(movie.title));
  if (!match?.target) throw new Error(`No exact Douban result for ${movie.title}`);
  assertTitle(movie, match.target.title, "douban");
  if (match.target.year && Math.abs(Number(match.target.year) - movie.year) > 1) {
    throw new Error(`Douban year mismatch for ${movie.id}: ${match.target.year}`);
  }

  const score = validScore(match.target.rating?.value);
  return {
    score,
    checkedAt,
    url: `https://movie.douban.com/subject/${match.target.id}/`,
    linkLabel: "豆瓣电影页",
    status: score === null ? "unavailable" : "live",
    collectionMode: "public-json",
    voteCount: Number(match.target.rating?.count) || null,
    platformId: String(match.target.id),
    lastAttemptAt: attemptedAt,
  };
}

async function findMaoyanId(movie) {
  if (movie.platformIds?.maoyan) return String(movie.platformIds.maoyan);
  const query = encodeURIComponent(movie.title);
  const result = await fetchJson(`https://m.maoyan.com/ajax/search?kw=${query}&cityId=1&stype=-1`, {
    Accept: "application/json",
    Referer: "https://m.maoyan.com/",
    "User-Agent": "Mozilla/5.0 (compatible; MovieRatingSnapshot/1.0; +https://github.com/gnailegoac/movie-rating)",
  });
  const match = result?.movies?.list?.find(({ nm }) => normalizedTitle(nm) === normalizedTitle(movie.title));
  if (!match) throw new Error(`No exact Maoyan result for ${movie.title}`);
  return String(match.id);
}

async function fetchMaoyan(movie) {
  const movieId = await findMaoyanId(movie);
  const result = await fetchJson(`https://m.maoyan.com/ajax/detailmovie?movieId=${movieId}`, {
    Accept: "application/json",
    Referer: `https://m.maoyan.com/asgard/movie/${movieId}`,
    "User-Agent": "Mozilla/5.0 (compatible; MovieRatingSnapshot/1.0; +https://github.com/gnailegoac/movie-rating)",
  });
  const detail = result?.detailMovie;
  if (!detail) throw new Error(`No Maoyan detail for ${movie.title}`);
  assertTitle(movie, detail.nm, "maoyan");

  const score = validScore(detail.sc);
  return {
    score,
    checkedAt,
    url: `https://www.maoyan.com/films/${movieId}`,
    linkLabel: "猫眼电影页",
    status: score === null ? "unavailable" : "live",
    collectionMode: "public-json",
    voteCount: Number(detail.snum) || null,
    platformId: movieId,
    lastAttemptAt: attemptedAt,
  };
}

let taopiaopiaoListPromise;
async function fetchTaopiaopiaoList() {
  if (!taopiaopiaoListPromise) {
    taopiaopiaoListPromise = fetchWithRetry("https://dianying.taobao.com/showList.htm?n_s=new", {
      headers: {
        Accept: "text/html,application/xhtml+xml",
        Referer: "https://dianying.taobao.com/",
        "User-Agent": "Mozilla/5.0 (compatible; MovieRatingSnapshot/1.0; +https://github.com/gnailegoac/movie-rating)",
      },
    }).then((response) => response.text()).then((html) => {
      const movies = [];
      const cardPattern = /<a href="https:\/\/dianying\.taobao\.com\/showDetail\.htm\?showId=(\d+)&amp;n_s=new(?:&amp;|&)source=current" class="movie-card">([\s\S]*?)<\/a>/g;
      for (const match of html.matchAll(cardPattern)) {
        const title = match[2].match(/class="bt-l">\s*([^<]+?)\s*<\/span>/)?.[1]?.trim();
        const scoreText = match[2].match(/class="bt-r">\s*([^<]*?)\s*<\/span>/)?.[1]?.trim();
        if (title) movies.push({ id: match[1], title, score: validScore(scoreText) });
      }
      if (!movies.length) throw new Error("No current Taopiaopiao movie cards found");
      return movies;
    });
  }
  return taopiaopiaoListPromise;
}

async function fetchTaopiaopiao(movie) {
  const movies = await fetchTaopiaopiaoList();
  const expectedId = String(movie.platformIds?.taopiaopiao ?? "");
  const match = movies.find(({ id }) => expectedId && id === expectedId)
    ?? movies.find(({ title }) => normalizedTitle(title) === normalizedTitle(movie.title));
  if (!match) throw new Error(`${movie.title} is not on the current Taopiaopiao list`);
  assertTitle(movie, match.title, "taopiaopiao");

  const score = match.score;
  return {
    score,
    checkedAt,
    url: `https://dianying.taobao.com/showDetail.htm?showId=${match.id}&n_s=new`,
    linkLabel: "淘票票电影页",
    status: score === null ? "unavailable" : "live",
    collectionMode: "public-page",
    voteCount: null,
    platformId: match.id,
    lastAttemptAt: attemptedAt,
  };
}

const fetchers = {
  douban: fetchDouban,
  maoyan: fetchMaoyan,
  taopiaopiao: fetchTaopiaopiao,
};

function cachedRating(movie, platform) {
  return previousById.get(movie.id)?.ratings?.[platform] ?? movie.ratings?.[platform] ?? {
    score: null,
    checkedAt: "",
    url: "#",
    linkLabel: "暂无来源页",
  };
}

function fallbackRating(movie, platform, error) {
  const cached = cachedRating(movie, platform);
  return {
    ...cached,
    status: Number.isFinite(cached.score) ? "cached" : "unavailable",
    lastAttemptAt: attemptedAt,
    statusReason: error instanceof Error ? error.message.slice(0, 160) : "Source unavailable",
  };
}

async function refreshMovie(movie) {
  const ratings = {};
  for (const platform of PLATFORMS) {
    try {
      const fresh = await fetchers[platform](movie);
      const cached = cachedRating(movie, platform);
      if (Number.isFinite(fresh.score) && Number.isFinite(cached.score) && Math.abs(fresh.score - cached.score) > 1.5) {
        throw new Error(`${platform} score jump exceeds guardrail for ${movie.id}`);
      }
      ratings[platform] = fresh;
    } catch (error) {
      ratings[platform] = fallbackRating(movie, platform, error);
    }
    if (platform === "douban") await delay(450);
  }
  return { ...movie, ratings };
}

function mergeFeed(base, feed) {
  const updates = new Map((feed.movies ?? []).map((movie) => [movie.id, movie]));
  return {
    ...base,
    snapshotLabel: feed.snapshotLabel ?? base.snapshotLabel,
    movies: base.movies.map((movie) => {
      const update = updates.get(movie.id);
      if (!update) return movie;
      return {
        ...movie,
        ...update,
        ratings: Object.fromEntries(PLATFORMS.map((platform) => {
          const ratingUpdate = update.ratings?.[platform];
          if (!ratingUpdate) return [platform, movie.ratings[platform]];
          const score = ratingUpdate.score === null ? null : validScore(ratingUpdate.score);
          return [platform, {
            ...movie.ratings[platform],
            ...ratingUpdate,
            score,
            checkedAt: ratingUpdate.checkedAt ?? checkedAt,
            status: score === null ? "unavailable" : "live",
            collectionMode: "feed",
            lastAttemptAt: attemptedAt,
          }];
        })),
      };
    }),
  };
}

let dataset = {
  ...source,
  generatedAt: attemptedAt,
  snapshotLabel: "三平台公开评分快照",
  isDemo: false,
  movies: [],
};

for (const movie of source.movies) {
  dataset.movies.push(await refreshMovie(movie));
}

if (process.env.RATING_FEED_URL) {
  const headers = { Accept: "application/json" };
  if (process.env.RATING_FEED_TOKEN) headers.Authorization = `Bearer ${process.env.RATING_FEED_TOKEN}`;
  const response = await fetchWithRetry(process.env.RATING_FEED_URL, { headers });
  dataset = mergeFeed(dataset, await response.json());
  dataset.snapshotLabel = "授权数据源与公开页快照";
}

if (!Array.isArray(dataset.movies) || dataset.movies.length === 0) {
  throw new Error("Dataset must contain at least one movie");
}

const seen = new Set();
const calibration = calculateCalibration(dataset.movies);
const movies = dataset.movies.map((movie) => {
  if (!movie.id || seen.has(movie.id)) throw new Error(`Duplicate or missing movie id: ${movie.id}`);
  seen.add(movie.id);
  for (const platform of PLATFORMS) {
    if (!movie.ratings?.[platform]) throw new Error(`${movie.id} is missing ${platform}`);
    validateScore(movie.ratings[platform].score, movie.id, platform);
  }
  return {
    ...movie,
    cachedComposite: calculateComposite(movie.ratings, dataset.defaultWeights, calibration),
  };
});

const sourceStatus = Object.fromEntries(PLATFORMS.map((platform) => {
  const statuses = movies.map((movie) => movie.ratings[platform].status);
  return [platform, {
    live: statuses.filter((status) => status === "live").length,
    cached: statuses.filter((status) => status === "cached").length,
    unavailable: statuses.filter((status) => status === "unavailable").length,
    total: movies.length,
  }];
}));

dataset = { ...dataset, calibration, sourceStatus, movies };
await writeFile(outputPath, `${JSON.stringify(dataset, null, 2)}\n`, "utf8");
await writeFile(statusPath, `${JSON.stringify({ generatedAt: attemptedAt, sources: sourceStatus }, null, 2)}\n`, "utf8");

const summary = PLATFORMS.map((platform) => `${platform} ${sourceStatus[platform].live}/${movies.length}`).join(", ");
console.log(`Wrote ${movies.length} movies to ${outputPath.pathname}; live sources: ${summary}`);
