import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("builds a GitHub Pages-compatible static entry point", async () => {
  const [html, component] = await Promise.all([
    readFile(new URL("../dist/index.html", import.meta.url), "utf8"),
    readFile(new URL("../components/MovieRatingApp.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(html, /<title>映鉴｜中国电影综合评分<\/title>/);
  assert.match(html, /\.\/assets\/[^"']+\.js/);
  assert.match(html, /https:\/\/gnailegoac\.github\.io\/movie-rating\/og\.png/);
  assert.match(component, /三种口碑/);
  assert.match(component, /评分拆解/);
  assert.match(component, /正在上映/);
  assert.match(component, /历史归档/);
  assert.doesNotMatch(html, /codex-preview|SkeletonPreview|Your site is taking shape/);
});
