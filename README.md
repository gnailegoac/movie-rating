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

## 数据边界

仓库内置的 `data/ratings-source.json` 是用于展示产品流程的**示例快照**，不是三家平台的实时数据，也不应被当作当前正式评分。生产使用需要人工编辑审核，或接入具备授权的数据服务。

由于豆瓣、猫眼、淘票票没有在本项目中使用的统一公开评分 API，生产环境不建议让浏览器直接抓取平台页面：这样容易受到跨域、反自动化机制、页面结构变化和平台条款的影响。每条评分保留更新时间和平台站内入口，方便编辑核对。

## 本地运行

```powershell
npm install
npm run sync:ratings
npm run dev
```

打开开发服务器显示的本地地址。

## 数据更新流程

1. 编辑 `data/ratings-source.json`，维护电影资料、三平台评分、核对日期与来源入口。
2. 运行 `npm run sync:ratings`，生成前端读取的 `data/movies.json`，并固化默认综合分。
3. 运行 `npm run validate:ratings`，检查 ID、分数范围、覆盖度与缓存计算。
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

配置仓库 Secrets 后，`.github/workflows/sync-movie-ratings.yml` 会每天刷新和校验缓存；未配置 Feed 时则只验证示例源数据。

## 主要结构

- `components/MovieRatingApp.tsx`：搜索、筛选、排序、详情和权重交互。
- `lib/ratings.js`：唯一评分计算实现，前端、同步脚本和测试共同复用。
- `data/ratings-source.json`：人工维护或外部 Feed 的基础电影清单。
- `data/movies.json`：生成后的稳定前端缓存。
- `scripts/sync-ratings.mjs`：合并 Feed、校验并生成缓存。
- `scripts/validate-ratings.mjs`：数据和算术审计。

## 发布

`.github/workflows/deploy-pages.yml` 会在 `main` 分支更新后运行校验和静态构建，并自动发布到 GitHub Pages。发布前请确认数据页不再标记为示例快照。
