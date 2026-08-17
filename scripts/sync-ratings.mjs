import { readFile, writeFile } from "node:fs/promises";
import { estimateMtimeSubitemRating } from "../lib/mtime-rating.js";
import { PLATFORMS, calculateCalibration, calculateComposite } from "../lib/ratings.js";
import { selectDoubanCandidate, selectMtimeCandidate } from "../lib/movie-match.js";

const sourcePath = new URL("../data/ratings-source.json", import.meta.url);
const outputPath = new URL("../data/movies.json", import.meta.url);
const statusPath = new URL("../data/source-status.json", import.meta.url);
const PLATFORM_NAMES = { douban: "豆瓣", mtime: "时光网", maoyan: "猫眼", taopiaopiao: "淘票票" };
const now = new Date();
const attemptedAt = now.toISOString();
const checkedAt = attemptedAt.slice(0, 10);
const discoveryLimit = Math.max(0, Number(process.env.DISCOVERY_LIMIT ?? 24));
const source = JSON.parse(await readFile(sourcePath, "utf8"));

let previous = null;
try {
  previous = JSON.parse(await readFile(outputPath, "utf8"));
} catch {
  // A first run has no generated cache yet.
}

const previousById = new Map((previous?.movies ?? []).map((movie) => [movie.id, movie]));
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const generatedPalettes = [
  ["#243d4a", "#db8a50"],
  ["#5b2c36", "#d5aa61"],
  ["#214e47", "#dc7759"],
  ["#3f3562", "#78b9ae"],
  ["#604128", "#d7b66b"],
  ["#28436d", "#dc8f9e"],
];

function decodeHtml(value = "") {
  return String(value)
    .replaceAll("&middot;", "·")
    .replaceAll("&ldquo;", "“")
    .replaceAll("&rdquo;", "”")
    .replaceAll("&amp;", "&")
    .replaceAll("&#39;", "'")
    .trim();
}

function generatedPalette(title) {
  const hash = [...title].reduce((sum, character) => sum + character.codePointAt(0), 0);
  return generatedPalettes[hash % generatedPalettes.length];
}

function generatedMotif(title) {
  return [...title].find((character) => /[\p{Script=Han}A-Za-z0-9]/u.test(character)) ?? "映";
}

function generatedEditorial(ratings) {
  const values = PLATFORMS.map((platform) => ratings[platform]?.score).filter(Number.isFinite);
  if (values.length < 2) return "目前有效评分来源较少，综合分会随后续平台开分而更新。";
  const spread = Math.max(...values) - Math.min(...values);
  if (spread < 0.6) return "各平台原始评分接近，分布校准后综合评价相对稳定。";
  if (spread < 1.5) return "平台之间存在一定评价差异，校准后的综合分更适合横向比较。";
  return "社区与购票平台评价分化明显，分布校准可以避免原始量尺差异直接放大结果。";
}

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
  if (movie.platformIds?.douban) {
    const subjectId = String(movie.platformIds.douban);
    const detail = await fetchJson(`https://m.douban.com/rexxar/api/v2/movie/${subjectId}`, {
      Accept: "application/json",
      Referer: `https://m.douban.com/movie/subject/${subjectId}/`,
      "User-Agent": "Mozilla/5.0 (compatible; MovieRatingSnapshot/1.0; +https://github.com/gnailegoac/movie-rating)",
    });
    assertTitle(movie, detail.title, "douban");
    const subjectYear = Number(detail.year) || null;
    const expectedYear = Number(movie.originalYear ?? movie.year);
    if (subjectYear && Number.isFinite(expectedYear) && Math.abs(subjectYear - expectedYear) > 1) {
      throw new Error(`Douban year mismatch for ${movie.id}: ${subjectYear}`);
    }
    const score = validScore(detail.rating?.value);
    return {
      score,
      scoreType: score === null ? undefined : "official",
      confidence: score === null ? undefined : 1,
      checkedAt,
      url: `https://movie.douban.com/subject/${subjectId}/`,
      linkLabel: "豆瓣电影页",
      status: score === null ? "unavailable" : "live",
      collectionMode: "public-json",
      voteCount: Number(detail.rating?.count) || null,
      platformId: subjectId,
      subjectYear,
      lastAttemptAt: attemptedAt,
      statusReason: score === null ? String(detail.null_rating_reason || "豆瓣暂无评分") : undefined,
    };
  }

  const query = encodeURIComponent(movie.title);
  const searchUrl = `https://m.douban.com/rexxar/api/v2/search?q=${query}&start=0&count=10`;
  const result = await fetchJson(searchUrl, {
    Accept: "application/json",
    Referer: `https://m.douban.com/search/?query=${query}`,
    "User-Agent": "Mozilla/5.0 (compatible; MovieRatingSnapshot/1.0; +https://github.com/gnailegoac/movie-rating)",
  });
  const candidates = result?.subjects?.items ?? [];
  const match = selectDoubanCandidate(candidates, movie);
  if (!match?.target) throw new Error(`No exact Douban title/year result for ${movie.title}`);
  assertTitle(movie, match.target.title, "douban");
  const expectedYear = Number(movie.originalYear ?? movie.year);
  if (match.target.year && Number.isFinite(expectedYear) && Math.abs(Number(match.target.year) - expectedYear) > 1) {
    throw new Error(`Douban year mismatch for ${movie.id}: ${match.target.year}`);
  }

  const score = validScore(match.target.rating?.value);
  return {
    score,
    scoreType: score === null ? undefined : "official",
    confidence: score === null ? undefined : 1,
    checkedAt,
    url: `https://movie.douban.com/subject/${match.target.id}/`,
    linkLabel: "豆瓣电影页",
    status: score === null ? "unavailable" : "live",
    collectionMode: "public-json",
    voteCount: Number(match.target.rating?.count) || null,
    platformId: String(match.target.id),
    subjectYear: Number(match.target.year) || null,
    lastAttemptAt: attemptedAt,
  };
}

async function findMtimeMovie(movie) {
  if (movie.platformIds?.mtime) {
    return {
      movieId: String(movie.platformIds.mtime),
      name: movie.title,
      nameEn: movie.englishTitle,
      year: movie.originalYear ?? movie.year,
    };
  }
  const body = new URLSearchParams({
    keyword: movie.title,
    pageIndex: "1",
    pageSize: "20",
    searchType: "0",
    locationId: "290",
    genreTypes: "",
    area: "",
    year: "",
  });
  const response = await fetchWithRetry("https://front-gateway.mtime.com/mtime-search/search/unionSearch2", {
    method: "POST",
    headers: {
      Accept: "application/json, text/plain, */*",
      "Content-Type": "application/x-www-form-urlencoded",
      Origin: "https://film.mtime.com",
      Referer: "https://film.mtime.com/",
      "User-Agent": "Mozilla/5.0 (compatible; MovieRatingSnapshot/1.0; +https://github.com/gnailegoac/movie-rating)",
    },
    body,
  });
  const result = await response.json();
  const match = selectMtimeCandidate(result?.data?.movies ?? [], movie);
  if (!match) throw new Error(`No exact Mtime title/year result for ${movie.title}`);
  return match;
}

async function fetchMtime(movie) {
  const match = await findMtimeMovie(movie);
  const movieId = String(match.movieId);
  const result = await fetchJson(`https://front-gateway.mtime.com/library/movie/detail.api?tt=${Date.now()}&movieId=${movieId}&locationId=290`, {
    Accept: "application/json, text/plain, */*",
    Origin: "https://movie.mtime.com",
    Referer: "https://movie.mtime.com/",
    "X-Mtime-Wap-CheckValue": "mtime",
    "User-Agent": "Mozilla/5.0 (compatible; MovieRatingSnapshot/1.0; +https://github.com/gnailegoac/movie-rating)",
  });
  const detail = result?.data?.basic;
  if (!detail) throw new Error(`No Mtime detail for ${movie.title}`);
  assertTitle(movie, detail.name, "mtime");
  const subjectYear = Number(detail.year ?? match.year ?? match.rYear) || null;
  const expectedYear = Number(movie.originalYear ?? movie.year);
  if (subjectYear && Number.isFinite(expectedYear) && Math.abs(subjectYear - expectedYear) > 1) {
    throw new Error(`Mtime year mismatch for ${movie.id}: ${subjectYear}`);
  }

  const officialScore = validScore(detail.overallRating);
  const estimate = officialScore === null
    ? estimateMtimeSubitemRating(detail.movieSubItemRatings, detail.subItemRatingCount)
    : null;
  const score = officialScore ?? estimate?.score ?? null;
  return {
    score,
    scoreType: officialScore !== null ? "official" : estimate?.scoreType,
    confidence: officialScore !== null ? 1 : estimate?.confidence,
    checkedAt,
    url: `https://movie.mtime.com/${movieId}/`,
    linkLabel: "时光网电影页",
    status: score === null ? "unavailable" : "live",
    collectionMode: "public-json",
    voteCount: officialScore !== null ? Number(detail.ratingCount) || null : estimate?.voteCount ?? null,
    overallVoteCount: Number(detail.ratingCount) || null,
    subItemVoteCount: Number(detail.subItemRatingCount) || null,
    subItemRatings: estimate?.subItemRatings,
    platformId: movieId,
    subjectYear,
    lastAttemptAt: attemptedAt,
    statusReason: estimate ? "时光网未发布总分；按五项分项评分等权估算" : undefined,
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

async function fetchMaoyanDetail(movie) {
  const movieId = await findMaoyanId(movie);
  const result = await fetchJson(`https://m.maoyan.com/ajax/detailmovie?movieId=${movieId}`, {
    Accept: "application/json",
    Referer: `https://m.maoyan.com/asgard/movie/${movieId}`,
    "User-Agent": "Mozilla/5.0 (compatible; MovieRatingSnapshot/1.0; +https://github.com/gnailegoac/movie-rating)",
  });
  const detail = result?.detailMovie;
  if (!detail) throw new Error(`No Maoyan detail for ${movie.title}`);
  assertTitle(movie, detail.nm, "maoyan");
  return { movieId, detail };
}

function maoyanRating(movieId, detail) {
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
    subjectYear: Number(String(detail.frt ?? "").slice(0, 4)) || null,
    lastAttemptAt: attemptedAt,
  };
}

async function fetchMaoyan(movie) {
  const { movieId, detail } = await fetchMaoyanDetail(movie);
  return maoyanRating(movieId, detail);
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
        const title = decodeHtml(match[2].match(/class="bt-l">\s*([^<]+?)\s*<\/span>/)?.[1]);
        const scoreText = match[2].match(/class="bt-r">\s*([^<]*?)\s*<\/span>/)?.[1]?.trim();
        const details = [...match[2].matchAll(/<span>([^<]*)<\/span>/g)].map((item) => decodeHtml(item[1]));
        const detailValue = (label) => details.find((item) => item.startsWith(`${label}：`))?.slice(label.length + 1).trim() ?? "";
        const runtimeMatch = detailValue("片长").match(/(\d+)/);
        if (title) movies.push({
          id: match[1],
          title,
          score: validScore(scoreText),
          director: detailValue("导演").split(/[，,]/)[0]?.trim() ?? "",
          genres: detailValue("类型").split(/[，,]/).map((item) => item.trim()).filter(Boolean),
          region: detailValue("地区"),
          runtimeMinutes: runtimeMatch ? Number(runtimeMatch[1]) : null,
        });
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
  mtime: fetchMtime,
  maoyan: fetchMaoyan,
  taopiaopiao: fetchTaopiaopiao,
};

function cachedRating(movie, platform) {
  return previousById.get(movie.id)?.ratings?.[platform] ?? movie.ratings?.[platform] ?? emptyRating(platform, movie);
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

function emptyRating(platform, movie) {
  const query = encodeURIComponent(movie.title);
  const urls = {
    douban: `https://search.douban.com/movie/subject_search?search_text=${query}`,
    mtime: movie.platformIds?.mtime ? `https://movie.mtime.com/${movie.platformIds.mtime}/` : "https://film.mtime.com/",
    maoyan: `https://www.maoyan.com/query?kw=${query}`,
    taopiaopiao: movie.platformIds?.taopiaopiao
      ? `https://dianying.taobao.com/showDetail.htm?showId=${movie.platformIds.taopiaopiao}&n_s=new`
      : "https://dianying.taobao.com/showList.htm?n_s=new",
  };
  return {
    score: null,
    checkedAt: "",
    url: urls[platform],
    linkLabel: `${PLATFORM_NAMES[platform]}来源页`,
    status: "unavailable",
    collectionMode: platform === "taopiaopiao" ? "public-page" : "public-json",
    lastAttemptAt: attemptedAt,
  };
}

async function discoverMovie(card) {
  const provisional = {
    id: `taopiaopiao-${card.id}`,
    title: card.title,
    year: now.getUTCFullYear(),
    platformIds: { taopiaopiao: card.id },
  };
  let movieId;
  let detail;
  try {
    ({ movieId, detail } = await fetchMaoyanDetail(provisional));
  } catch (error) {
    console.warn(`Skipping ${card.title}: Maoyan metadata unavailable (${error.message})`);
    return null;
  }

  const releaseDate = String(detail.pubDesc ?? "").match(/\d{4}-\d{2}-\d{2}/)?.[0];
  if (!releaseDate) {
    console.warn(`Skipping ${card.title}: no China release date`);
    return null;
  }
  const genres = String(detail.cat || card.genres.join(","))
    .split(/[，,]/)
    .map((item) => item.trim())
    .filter(Boolean);
  if (genres.includes("影展")) return null;
  const director = String(detail.dir || card.director || "待补充").split(/[，,/]/)[0].trim();
  const chinaReleaseYear = Number(releaseDate.slice(0, 4));
  const originalYear = Number(String(detail.frt ?? "").slice(0, 4)) || chinaReleaseYear;
  const ratings = {};
  const movie = {
    ...provisional,
    englishTitle: detail.enm || card.title,
    year: originalYear,
    originalYear,
    releaseDateChina: releaseDate,
    director,
    genres: genres.length ? genres : ["电影"],
    runtimeMinutes: Number(detail.dur || card.runtimeMinutes) || 0,
    region: card.region || detail.src || "中国上映",
    summary: `${card.title}于 ${releaseDate} 在中国内地上映，由${director}执导，类型包括${(genres.length ? genres : ["电影"]).slice(0, 3).join("、")}。`,
    editorial: "",
    palette: generatedPalette(card.title),
    motif: generatedMotif(card.title),
    platformIds: { maoyan: movieId, taopiaopiao: card.id },
    catalogStatus: "current",
    autoDiscovered: true,
    firstSeenInTheatersAt: checkedAt,
    lastSeenInTheatersAt: checkedAt,
    ratings,
  };

  ratings.maoyan = maoyanRating(movieId, detail);
  ratings.taopiaopiao = {
    score: card.score,
    checkedAt,
    url: `https://dianying.taobao.com/showDetail.htm?showId=${card.id}&n_s=new`,
    linkLabel: "淘票票电影页",
    status: card.score === null ? "unavailable" : "live",
    collectionMode: "public-page",
    voteCount: null,
    platformId: card.id,
    lastAttemptAt: attemptedAt,
  };
  movie.ratings.douban = emptyRating("douban", movie);
  try {
    movie.ratings.douban = await fetchDouban(movie);
    movie.platformIds.douban = movie.ratings.douban.platformId;
    movie.originalYear = movie.ratings.douban.subjectYear ?? movie.originalYear;
  } catch (error) {
    movie.ratings.douban = fallbackRating(movie, "douban", error);
  }
  movie.ratings.mtime = emptyRating("mtime", movie);
  try {
    movie.ratings.mtime = await fetchMtime(movie);
    movie.platformIds.mtime = movie.ratings.mtime.platformId;
  } catch (error) {
    movie.ratings.mtime = fallbackRating(movie, "mtime", error);
  }
  movie.editorial = generatedEditorial(movie.ratings);
  await delay(450);

  const available = PLATFORMS.filter((platform) => Number.isFinite(movie.ratings[platform]?.score));
  return available.length >= 2 ? movie : null;
}

async function refreshMovie(movie) {
  const ratings = {};
  const platformIds = { ...movie.platformIds };
  let originalYear = movie.originalYear;
  let year = movie.year;
  for (const platform of PLATFORMS) {
    try {
      const fresh = await fetchers[platform](movie);
      const cached = cachedRating(movie, platform);
      if (Number.isFinite(fresh.score) && Number.isFinite(cached.score) && Math.abs(fresh.score - cached.score) > 1.5) {
        throw new Error(`${platform} score jump exceeds guardrail for ${movie.id}`);
      }
      ratings[platform] = fresh;
      if (fresh.platformId) platformIds[platform] = fresh.platformId;
      if (movie.autoDiscovered && fresh.subjectYear && ["douban", "mtime", "maoyan"].includes(platform)) {
        originalYear = fresh.subjectYear;
        year = fresh.subjectYear;
      }
    } catch (error) {
      ratings[platform] = fallbackRating(movie, platform, error);
    }
    if (platform === "douban") await delay(450);
    if (platform === "mtime") await delay(120);
  }
  return {
    ...movie,
    year,
    platformIds,
    originalYear,
    ratings,
    editorial: movie.autoDiscovered ? generatedEditorial(ratings) : movie.editorial,
  };
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
  snapshotLabel: "四平台公开评分快照",
  isDemo: false,
  movies: [],
};

let currentCards = null;
try {
  currentCards = await fetchTaopiaopiaoList();
} catch (error) {
  console.warn(`Movie discovery skipped: ${error.message}`);
}

const catalogById = new Map(source.movies.map((movie) => {
  const prior = previousById.get(movie.id);
  const overrides = source.platformIdOverrides?.[movie.title] ?? {};
  return [movie.id, {
    ...movie,
    platformIds: { ...movie.platformIds, ...prior?.platformIds, ...overrides },
    catalogStatus: prior?.catalogStatus ?? movie.catalogStatus ?? "current",
    autoDiscovered: false,
    firstSeenInTheatersAt: prior?.firstSeenInTheatersAt,
    lastSeenInTheatersAt: prior?.lastSeenInTheatersAt,
  }];
}));
const idByTitle = new Map(source.movies.map((movie) => [normalizedTitle(movie.title), movie.id]));

for (const movie of previous?.movies ?? []) {
  if (catalogById.has(movie.id) || idByTitle.has(normalizedTitle(movie.title))) continue;
  const overrides = source.platformIdOverrides?.[movie.title] ?? {};
  catalogById.set(movie.id, { ...movie, platformIds: { ...movie.platformIds, ...overrides } });
  idByTitle.set(normalizedTitle(movie.title), movie.id);
}

if (currentCards) {
  const currentByTitle = new Map(currentCards.map((card) => [normalizedTitle(card.title), card]));
  for (const [id, movie] of catalogById) {
    const card = currentByTitle.get(normalizedTitle(movie.title));
    catalogById.set(id, {
      ...movie,
      catalogStatus: card ? "current" : "archived",
      lastSeenInTheatersAt: card ? checkedAt : movie.lastSeenInTheatersAt,
      firstSeenInTheatersAt: movie.firstSeenInTheatersAt ?? (card ? checkedAt : undefined),
      platformIds: card
        ? { ...movie.platformIds, taopiaopiao: card.id }
        : movie.platformIds,
    });
  }

  const discoveryCards = currentCards
    .filter((card) => Number.isFinite(card.score) && !card.genres.includes("影展"))
    .slice(0, discoveryLimit);
  for (const card of discoveryCards) {
    if (idByTitle.has(normalizedTitle(card.title))) continue;
    const discovered = await discoverMovie(card);
    if (!discovered) continue;
    catalogById.set(discovered.id, discovered);
    idByTitle.set(normalizedTitle(discovered.title), discovered.id);
  }
}

const refreshQueue = [...catalogById.values()].sort((left, right) => {
  const missingLeft = PLATFORMS.filter((platform) => !Number.isFinite(left.ratings?.[platform]?.score)).length;
  const missingRight = PLATFORMS.filter((platform) => !Number.isFinite(right.ratings?.[platform]?.score)).length;
  if (missingLeft !== missingRight) return missingRight - missingLeft;
  if (left.catalogStatus !== right.catalogStatus) return left.catalogStatus === "current" ? -1 : 1;
  return left.title.localeCompare(right.title, "zh-CN");
});

for (const movie of refreshQueue) {
  const isNew = movie.autoDiscovered && !previousById.has(movie.id);
  dataset.movies.push(isNew ? movie : await refreshMovie(movie));
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
    estimated: movies.filter((movie) => movie.ratings[platform].scoreType === "estimated-subitems").length,
    total: movies.length,
  }];
}));
const catalogStatus = {
  current: movies.filter((movie) => movie.catalogStatus === "current").length,
  archived: movies.filter((movie) => movie.catalogStatus === "archived").length,
  autoDiscovered: movies.filter((movie) => movie.autoDiscovered).length,
  total: movies.length,
};

dataset = { ...dataset, calibration, sourceStatus, catalogStatus, movies };
await writeFile(outputPath, `${JSON.stringify(dataset, null, 2)}\n`, "utf8");
await writeFile(statusPath, `${JSON.stringify({ generatedAt: attemptedAt, sources: sourceStatus, catalog: catalogStatus }, null, 2)}\n`, "utf8");

const summary = PLATFORMS.map((platform) => `${platform} ${sourceStatus[platform].live}/${movies.length}`).join(", ");
console.log(`Wrote ${movies.length} movies (${catalogStatus.current} current, ${catalogStatus.archived} archived) to ${outputPath.pathname}; live sources: ${summary}`);
