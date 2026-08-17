# 映鉴｜中国上映电影综合评分

一个聚合豆瓣、猫眼和淘票票评分的电影查询系统。它延续 `WorldCupLookup` 的核心数据流：静态前端读取稳定的 JSON 快照，独立脚本负责校验和生成缓存，GitHub Actions 可定时接入外部数据源，页面本身不直接请求第三方平台。

线上地址：<https://gnailegoac.github.io/movie-rating/>

## 评分方法

默认权重：

- 豆瓣：50%
- 猫眼：25%
- 淘票票：25%

三家均有评分时：

```text
综合分 = 豆瓣 × 0.50 + 猫眼 × 0.25 + 淘票票 × 0.25
```

缺少某个平台评分时，不把缺失值当作 0 分，而是把剩余平台权重按原比例归一化。例如淘票票缺失时，豆瓣与猫眼的 50:25 会变成 67%:33%。页面支持用户临时调整权重，榜单和详情会即时重算；这只改变当前浏览器里的展示，不改写数据缓存。

## 数据来源与边界

仓库当前保存的是实际公开评分，不再是示例数据。同步脚本在定时任务中读取豆瓣与猫眼的公开页面数据，并从淘票票“正在热映”页核对购票评分；浏览器只读取生成后的 JSON，不会直接请求三家平台。

每条评分保存核对日期、来源页、采集方式和状态：

- `live`：本轮同步成功核验。
- `cached`：平台临时限流、页面变化或影片已下线，沿用上次有效值。
- `unavailable`：平台尚未给分，显示“暂无”，不按 0 分计算。

公开页面不是稳定 API，结构和访问策略可能变化。脚本采用标题与年份校验、分数范围检查、失败重试和逐平台缓存回退，避免一次访问失败污染整份榜单。淘票票网页仅能稳定覆盖当前热映片；历史影片若需要持续实时更新，应通过 `RATING_FEED_URL` 接入获得授权的数据服务，并遵守各平台条款。

## 本地运行

```powershell
npm install
npm run sync:ratings
npm run dev
```

打开开发服务器显示的本地地址。

## 数据更新流程

1. 编辑 `data/ratings-source.json`，维护电影资料和三平台影片 ID；其中的评分也是首次同步失败时的安全基线。
2. 运行 `npm run sync:ratings`，核验公开评分，生成 `data/movies.json` 与 `data/source-status.json`，并固化默认综合分。
3. 运行 `npm run validate:ratings`，检查 ID、来源状态、分数范围、覆盖度与缓存计算。
4. 运行 `npm test`，完成数据校验、生产构建和服务端渲染测试。

也可以配置标准化的授权数据 Feed：

- `RATING_FEED_URL`：返回 JSON 的 HTTPS 地址。
- `RATING_FEED_TOKEN`：可选 Bearer Token。

Feed 最小格式：

```json
{
  "generatedAt": "2026-08-17T00:00:00Z",
  "snapshotLabel": "授权数据源快照",
  "movies": [
    {
      "id": "herstory-2024",
      "ratings": {
        "douban": { "score": 8.9, "checkedAt": "2026-08-17", "url": "https://...", "linkLabel": "来源页" },
        "maoyan": { "score": 9.2, "checkedAt": "2026-08-17", "url": "https://...", "linkLabel": "来源页" },
        "taopiaopiao": { "score": 9.4, "checkedAt": "2026-08-17", "url": "https://...", "linkLabel": "来源页" }
      }
    }
  ]
}
```

`.github/workflows/sync-movie-ratings.yml` 每天自动刷新、校验并提交缓存；无需配置 Feed 也会核验公开数据。若配置授权 Feed，同名影片与评分会以 Feed 为准。

## 主要结构

- `components/MovieRatingApp.tsx`：搜索、筛选、排序、详情和权重交互。
- `lib/ratings.js`：唯一评分计算实现，前端、同步脚本和测试共同复用。
- `data/ratings-source.json`：影片资料、平台 ID 与首次失败时的评分基线。
- `data/movies.json`：生成后的稳定前端缓存。
- `data/source-status.json`：每次同步的三平台成功、缓存与缺失计数。
- `scripts/sync-ratings.mjs`：分平台核验、失败回退、合并 Feed 并生成缓存。
- `scripts/validate-ratings.mjs`：数据和算术审计。

## 发布

`.github/workflows/deploy-pages.yml` 会在 `main` 分支更新后运行校验和静态构建，并自动发布到 GitHub Pages。
