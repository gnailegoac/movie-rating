"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_WEIGHTS,
  PLATFORMS,
  calculateComposite,
  calculateCoverage,
  effectiveWeights,
  normalizePlatformScore,
  normalizeWeights,
} from "../lib/ratings.js";

type Platform = "douban" | "mtime" | "maoyan" | "taopiaopiao";
type Rating = {
  score: number | null;
  scoreType?: "official" | "estimated-subitems";
  confidence?: number;
  checkedAt: string;
  url: string;
  linkLabel: string;
  status: "live" | "cached" | "unavailable";
  collectionMode: "public-json" | "public-page" | "feed";
  voteCount?: number | null;
  subItemVoteCount?: number | null;
  subItemRatings?: Array<{ title: string; score: number }>;
};
type Movie = {
  id: string;
  title: string;
  englishTitle: string;
  year: number;
  originalYear?: number;
  releaseDateChina: string;
  director: string;
  genres: string[];
  runtimeMinutes: number;
  region: string;
  summary: string;
  editorial: string;
  palette: string[];
  motif: string;
  catalogStatus: "current" | "archived";
  autoDiscovered?: boolean;
  cachedComposite: number | null;
  ratings: Record<Platform, Rating>;
};
type Dataset = {
  generatedAt: string;
  snapshotLabel: string;
  isDemo: boolean;
  defaultWeights: Record<Platform, number>;
  calibration: {
    method: "z-score";
    enabled: boolean;
    sampleSize: number;
    targetMean: number;
    targetStandardDeviation: number;
    zLimit: number;
    platforms: Record<Platform, { count: number; mean: number; standardDeviation: number }>;
  };
  catalogStatus: { current: number; archived: number; autoDiscovered: number; total: number };
  sourceStatus?: Record<Platform, { live: number; cached: number; unavailable: number; estimated?: number; total: number }>;
  movies: Movie[];
};
type Weights = Record<Platform, number>;

const PLATFORM_META: Record<Platform, { name: string; short: string; color: string }> = {
  douban: { name: "豆瓣", short: "豆", color: "#2f8b57" },
  mtime: { name: "时光网", short: "时", color: "#3576a8" },
  maoyan: { name: "猫眼", short: "猫", color: "#ef4452" },
  taopiaopiao: { name: "淘票票", short: "淘", color: "#f28a2d" },
};

const FILTERS = [
  { id: "all", label: "全部" },
  { id: "current", label: "正在上映" },
  { id: "archived", label: "历史归档" },
  { id: "high", label: "综合 9.0+" },
  { id: "animation", label: "动画" },
  { id: "documentary", label: "纪录片" },
];

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
}

function scoreSpread(movie: Movie) {
  const scores = PLATFORMS.map((platform) => movie.ratings[platform].score).filter(
    (score): score is number => Number.isFinite(score),
  );
  return scores.length > 1 ? Math.max(...scores) - Math.min(...scores) : 0;
}

function ratingStatusLabel(rating: Rating) {
  if (rating.scoreType === "estimated-subitems") {
    const sample = rating.subItemVoteCount ?? rating.voteCount;
    return `五项估算${sample ? ` · ${sample}人` : ""}`;
  }
  if (rating.status === "live") return "本次已核验";
  if (rating.status === "cached") return "沿用有效缓存";
  return "平台暂无评分";
}

function Poster({ movie, compact = false }: { movie: Movie; compact?: boolean }) {
  return (
    <div
      className={`poster-art ${compact ? "is-compact" : ""}`}
      style={{ "--poster-dark": movie.palette[0], "--poster-bright": movie.palette[1] } as React.CSSProperties}
      aria-hidden="true"
    >
      <span className="poster-year">{movie.year}</span>
      <span className="poster-motif">{movie.motif}</span>
      <span className="poster-title">{movie.title}</span>
      <span className="poster-rule" />
    </div>
  );
}

function ScoreRing({ score, label = "映鉴校准分" }: { score: number | null; label?: string }) {
  const degree = score === null ? 0 : score * 36;
  return (
    <div className="score-ring" style={{ "--score-degree": `${degree}deg` } as React.CSSProperties}>
      <div>
        <strong>{score?.toFixed(1) ?? "—"}</strong>
        <span>{label}</span>
      </div>
    </div>
  );
}

export default function MovieRatingApp({ dataset }: { dataset: Dataset }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [sort, setSort] = useState("composite");
  const [selectedId, setSelectedId] = useState(dataset.movies[0]?.id ?? "");
  const [weights, setWeights] = useState<Weights>({ ...dataset.defaultWeights });
  const [methodOpen, setMethodOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchRef.current?.focus();
      }
      if (event.key === "Escape") setMethodOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const normalized = normalizeWeights(weights) as Record<Platform, number>;
  const ranked = useMemo(() => {
    const search = query.trim().toLocaleLowerCase("zh-CN");
    return dataset.movies
      .map((movie) => ({ ...movie, composite: calculateComposite(movie.ratings, weights, dataset.calibration) as number | null }))
      .filter((movie) => {
        const haystack = [movie.title, movie.englishTitle, movie.director, movie.region, ...movie.genres]
          .join(" ")
          .toLocaleLowerCase("zh-CN");
        if (search && !haystack.includes(search)) return false;
        if (filter === "current" && movie.catalogStatus !== "current") return false;
        if (filter === "archived" && movie.catalogStatus !== "archived") return false;
        if (filter === "high" && (movie.composite ?? 0) < 9) return false;
        if (filter === "animation" && !movie.genres.includes("动画")) return false;
        if (filter === "documentary" && !movie.genres.includes("纪录片")) return false;
        return true;
      })
      .sort((a, b) => {
        if (sort === "douban") return (b.ratings.douban.score ?? -1) - (a.ratings.douban.score ?? -1);
        if (sort === "mtime") return (b.ratings.mtime.score ?? -1) - (a.ratings.mtime.score ?? -1);
        if (sort === "date") return b.releaseDateChina.localeCompare(a.releaseDateChina);
        return (b.composite ?? -1) - (a.composite ?? -1);
      });
  }, [dataset.calibration, dataset.movies, filter, query, sort, weights]);

  const selected = ranked.find((movie) => movie.id === selectedId) ?? ranked[0] ?? null;
  const selectedApplied = selected
    ? (effectiveWeights(selected.ratings, weights) as Record<Platform, number>)
    : normalized;
  const liveSourceCount = dataset.sourceStatus
    ? PLATFORMS.reduce((sum, platform) => sum + dataset.sourceStatus![platform].live, 0)
    : 0;
  const totalSourceCount = dataset.movies.length * PLATFORMS.length;
  const estimatedSourceCount = dataset.sourceStatus?.mtime.estimated ?? 0;

  return (
    <main className="site-shell" id="top">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="映鉴首页">
          <span className="brand-mark">映</span>
          <span><strong>映鉴</strong><small>中国上映电影综合评分</small></span>
        </a>
        <nav className="topnav" aria-label="主要导航">
          <a href="#ranking">评分榜</a>
          <button type="button" onClick={() => setMethodOpen(true)}>计算方法</button>
        </nav>
        <div className="data-status" title={dataset.isDemo ? "当前为产品演示数据，不代表平台实时评分" : `本轮成功核验 ${liveSourceCount}/${totalSourceCount} 条平台评分；含 ${estimatedSourceCount} 条时光网分项估算；失败项沿用上次有效值`}>
          <i /> {dataset.snapshotLabel} · {formatDate(dataset.generatedAt)}
        </div>
      </header>

      <section className="hero">
        <div>
          <p className="eyebrow">DOUBAN × MTIME × MAOYAN × TAOPIAOPIAO</p>
          <h1>四种口碑，<br />一个<em>透明</em>的分数。</h1>
        </div>
        <div className="hero-side">
          <p>先校准豆瓣、时光网、猫眼与淘票票各自的评分分布，再用可调权重呈现中国上映电影的综合口碑。</p>
          <button className="text-button" type="button" onClick={() => setMethodOpen(true)}>查看评分方法 <span>↗</span></button>
        </div>
      </section>

      <section className="search-section" aria-label="搜索和筛选">
        <label className="search-box">
          <span aria-hidden="true">⌕</span>
          <input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} aria-label="搜索电影" placeholder="搜索电影、导演或类型" />
          {query ? <button type="button" aria-label="清除搜索" onClick={() => setQuery("")}>×</button> : <kbd>⌘ K</kbd>}
        </label>
        <div className="weight-summary">
          {PLATFORMS.map((platform) => (
            <span key={platform}><i style={{ background: PLATFORM_META[platform].color }} />{PLATFORM_META[platform].name} {Math.round(normalized[platform] * 100)}%</span>
          ))}
          <button type="button" onClick={() => setMethodOpen(true)}>调整</button>
        </div>
      </section>

      <section className="rating-workspace" id="ranking">
        <aside className="catalog-panel">
          <div className="catalog-tools">
            <div className="filter-tabs" role="tablist" aria-label="电影筛选">
              {FILTERS.map((item) => (
                <button key={item.id} type="button" role="tab" aria-selected={filter === item.id} className={filter === item.id ? "is-active" : ""} onClick={() => setFilter(item.id)}>{item.label}</button>
              ))}
            </div>
            <label className="sort-select">排序
              <select value={sort} onChange={(event) => setSort(event.target.value)}>
                <option value="composite">综合评分</option>
                <option value="douban">豆瓣评分</option>
                <option value="mtime">时光网评分</option>
                <option value="date">内地上映日期</option>
              </select>
            </label>
          </div>
          <div className="catalog-heading"><span>共 {ranked.length} 部 · 在映 {dataset.catalogStatus.current}</span><span>校准综合分 / 10</span></div>
          <div className="movie-list">
            {ranked.map((movie, index) => (
              <button key={movie.id} type="button" className={`movie-row ${selected?.id === movie.id ? "is-selected" : ""}`} onClick={() => setSelectedId(movie.id)}>
                <span className="row-rank">{String(index + 1).padStart(2, "0")}</span>
                <Poster movie={movie} compact />
                <span className="row-copy">
                  <strong>{movie.title}</strong>
                  <small>{movie.catalogStatus === "current" ? "在映" : "归档"} · {movie.year} · {movie.genres.slice(0, 2).join(" / ")}</small>
                  <span>{movie.director} 导演</span>
                </span>
                <span className="row-score">{movie.composite?.toFixed(1) ?? "—"}<small>映鉴</small></span>
              </button>
            ))}
            {!ranked.length && (
              <div className="empty-state"><strong>没有找到对应电影</strong><span>换个片名、导演或类型试试。</span><button type="button" onClick={() => { setQuery(""); setFilter("all"); }}>清除条件</button></div>
            )}
          </div>
        </aside>

        <section className="detail-panel" aria-live="polite">
          {selected ? (
            <>
              <div className="detail-lead">
                <Poster movie={selected} />
                <div className="detail-headline">
                  <div className="detail-kicker"><span>{selected.catalogStatus === "current" ? "正在上映" : "历史归档"} · 中国上映 {formatDate(selected.releaseDateChina)}</span><span>{selected.region}</span></div>
                  <h2>{selected.title}</h2>
                  <p className="english-title">{selected.englishTitle}</p>
                  <div className="tag-row">{selected.genres.map((genre) => <span key={genre}>{genre}</span>)}<span>{selected.runtimeMinutes} 分钟</span></div>
                  <p className="summary">{selected.summary}</p>
                  <p className="director">导演 <strong>{selected.director}</strong></p>
                </div>
                <ScoreRing score={selected.composite} />
              </div>

              <div className="score-breakdown">
                <div className="section-heading"><div><p>评分拆解</p><h3>原始分可追溯，校准分可比较</h3></div><span>共同样本 {dataset.calibration.sampleSize} 部 · 证据覆盖度 {calculateCoverage(selected.ratings, weights)}%</span></div>
                <div className="source-scores">
                  {PLATFORMS.map((platform) => {
                    const rating = selected.ratings[platform];
                    const meta = PLATFORM_META[platform];
                    const calibratedScore = normalizePlatformScore(rating.score, platform, dataset.calibration);
                    return (
                      <article className="source-score-card" key={platform}>
                        <div className="source-name"><span style={{ background: meta.color }}>{meta.short}</span><strong>{meta.name}{rating.scoreType === "estimated-subitems" ? <small>估算</small> : null}</strong><em>有效权重 {Math.round(selectedApplied[platform] * 100)}%</em></div>
                        <div className={`platform-score ${rating.score === null ? "is-missing" : ""}`}>{rating.scoreType === "estimated-subitems" ? "≈" : ""}{rating.score?.toFixed(1) ?? "暂无"}</div>
                        <div className="calibrated-score">校准后 {calibratedScore?.toFixed(1) ?? "—"}{rating.scoreType === "estimated-subitems" ? " · 可信度 50%" : ""}</div>
                        <div className="score-track"><i style={{ width: `${(rating.score ?? 0) * 10}%`, background: meta.color }} /></div>
                        {rating.scoreType === "estimated-subitems" && rating.subItemRatings ? (
                          <div className="subitem-breakdown" aria-label="时光网分项评分">
                            {rating.subItemRatings.map((item) => <span key={item.title}>{item.title} {item.score.toFixed(1)}</span>)}
                          </div>
                        ) : null}
                        <div className={`source-freshness is-${rating.status}`}><span>{ratingStatusLabel(rating)}</span><time>{rating.checkedAt || "—"}</time></div>
                        <a href={rating.url} target="_blank" rel="noreferrer">{rating.linkLabel} <span>↗</span></a>
                      </article>
                    );
                  })}
                </div>
                <div className="formula-strip">
                  <span className="formula-label">校准分公式</span>
                  <div className="formula-expression">
                    {PLATFORMS.filter((platform) => selected.ratings[platform].score !== null).map((platform, index, available) => (
                      <span key={platform}>{normalizePlatformScore(selected.ratings[platform].score, platform, dataset.calibration)?.toFixed(1)}{selected.ratings[platform].scoreType === "estimated-subitems" ? "（估）" : ""} × {Math.round(selectedApplied[platform] * 100)}% {index < available.length - 1 ? <b>＋</b> : null}</span>
                    ))}
                    <strong>＝ {selected.composite?.toFixed(1)}</strong>
                  </div>
                </div>
              </div>

              <div className="reading-note">
                <div><p>如何理解这个分数</p><h3>{selected.editorial}</h3></div>
                <div className="spread-stat"><strong>{scoreSpread(selected).toFixed(1)}</strong><span>四平台最高分差</span></div>
              </div>
            </>
          ) : null}
        </section>
      </section>

      <footer>
        <div className="brand footer-brand"><span className="brand-mark">映</span><span><strong>映鉴</strong><small>看见分数背后的差异</small></span></div>
        <p>{dataset.isDemo ? "当前展示示例快照；正式使用时请连接经授权的数据源，并遵守各平台条款。" : `公开评分每日核验；本轮 ${liveSourceCount}/${totalSourceCount} 条成功，其中 ${estimatedSourceCount} 条为时光网分项估算。平台临时不可访问时沿用上次有效值，不按 0 分处理。`}</p>
        <button type="button" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>回到顶部 ↑</button>
      </footer>

      {methodOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setMethodOpen(false); }}>
          <section className="method-modal" role="dialog" aria-modal="true" aria-labelledby="method-title">
            <button className="modal-close" type="button" aria-label="关闭评分方法" onClick={() => setMethodOpen(false)}>×</button>
            <p className="eyebrow">TRANSPARENT BY DESIGN</p>
            <h2 id="method-title">评分方法</h2>
            <p className="method-intro">系统先用共同影片样本计算每个平台的均值和标准差，将原始分映射到均值 7.5、标准差 1.0 的共同尺度，再按权重合成。Z 值限制在 ±2.5，避免小样本极端值被过度放大。这样猫眼或淘票票的 9.5 不会被直接当成豆瓣的 9.5。</p>
            <div className="calibration-stats" aria-label="当前平台校准参数">
              {PLATFORMS.map((platform) => (
                <span key={platform}><i style={{ background: PLATFORM_META[platform].color }} />{PLATFORM_META[platform].name}<strong>均值 {dataset.calibration.platforms[platform].mean.toFixed(2)}</strong><small>标准差 {dataset.calibration.platforms[platform].standardDeviation.toFixed(2)}</small></span>
              ))}
            </div>
            <div className="weight-controls">
              {PLATFORMS.map((platform) => {
                const meta = PLATFORM_META[platform];
                return (
                  <label key={platform}>
                    <span><i style={{ background: meta.color }} />{meta.name}<strong>{Math.round(normalized[platform] * 100)}%</strong></span>
                    <input type="range" min="0" max="100" step="5" value={weights[platform]} onChange={(event) => setWeights((current) => ({ ...current, [platform]: Number(event.target.value) }))} />
                  </label>
                );
              })}
            </div>
            <div className="method-rule">
              <strong>为什么需要分布校准？</strong>
              <p>四个平台的打分松紧不同。校准比较的是一部电影在各自平台分布中的相对位置，而不是直接比较原始数字；当前使用 {dataset.calibration.sampleSize} 部四家均有评分的影片作为共同样本。</p>
            </div>
            <div className="method-rule">
              <strong>缺失评分怎么处理？</strong>
              <p>不按 0 分计算。系统只使用已有平台，并保持它们原来的相对权重。例如淘票票缺失时，25:25:25 会归一化为约 33%:33%:33%。</p>
            </div>
            <div className="method-rule">
              <strong>时光网没有总分怎么办？</strong>
              <p>五项分项评分齐全且至少有 10 人参与时，系统显示五项等权均值并标记为“估算”。估算分不参与校准样本，可信度按 50% 折算，因此不会被当作完整的官方来源。</p>
            </div>
            <div className="method-actions">
              <button type="button" className="secondary-button" onClick={() => setWeights({ ...DEFAULT_WEIGHTS } as Weights)}>恢复默认</button>
              <button type="button" className="primary-button" onClick={() => setMethodOpen(false)}>应用并查看</button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
