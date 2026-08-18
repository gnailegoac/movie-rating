import assert from "node:assert/strict";
import test from "node:test";
import { selectDiscoveryCards } from "../lib/movie-discovery.js";
import { selectDoubanCandidate, selectMtimeCandidate } from "../lib/movie-match.js";

const candidate = (id, title, year) => ({ target: { id, title, year } });

test("matches the original year when several Douban subjects share a title", () => {
  const candidates = [
    candidate("new", "哈姆雷特", 2026),
    candidate("classic", "哈姆雷特", 1996),
    candidate("ntl", "哈姆雷特", 2015),
  ];
  const match = selectDoubanCandidate(candidates, { title: "哈姆雷特", year: 2015, originalYear: 2015 });
  assert.equal(match.target.id, "ntl");
});

test("prefers a persisted Douban id for a known re-release", () => {
  const candidates = [
    candidate("ntl", "哈姆雷特", 2015),
    candidate("known", "哈姆雷特", 2026),
  ];
  const match = selectDoubanCandidate(candidates, {
    title: "哈姆雷特",
    year: 2015,
    originalYear: 2015,
    platformIds: { douban: "known" },
  });
  assert.equal(match.target.id, "known");
});

test("rejects same-title candidates from the wrong production year", () => {
  const candidates = [candidate("wrong", "哈姆雷特", 1996)];
  assert.equal(selectDoubanCandidate(candidates, { title: "哈姆雷特", year: 2015 }), null);
});

test("matches an Mtime movie by title and original production year", () => {
  const candidates = [
    { movieId: 1, name: "恐怖游轮", nameEn: "Triangle", year: 2026 },
    { movieId: 2, name: "恐怖游轮", nameEn: "Triangle", year: 2009, rYear: 2026 },
  ];
  const match = selectMtimeCandidate(candidates, {
    title: "恐怖游轮",
    englishTitle: "Triangle",
    year: 2009,
    originalYear: 2009,
  });
  assert.equal(match.movieId, 2);
});

test("rejects ambiguous Mtime versions when the English title does not agree", () => {
  const candidates = [
    { movieId: 235751, name: "哈姆雷特", nameEn: "Royal Shakespeare Company: Hamlet", year: 2016 },
    { movieId: 224928, name: "哈姆雷特", nameEn: "Hamlet", year: 0, rYear: 2015 },
  ];
  const match = selectMtimeCandidate(candidates, {
    title: "哈姆雷特",
    englishTitle: "National Theatre Live: Hamlet",
    year: 2015,
    originalYear: 2015,
  });
  assert.equal(match, null);
});

test("discovers unscored current movies and only excludes festival event cards", () => {
  const cards = [
    { title: "已开分电影", score: 9.2, genres: ["剧情"] },
    { title: "尚未开分电影", score: null, genres: ["动作"] },
    { title: "电影节展映", score: null, genres: ["影展"] },
  ];
  assert.deepEqual(selectDiscoveryCards(cards).map(({ title }) => title), ["已开分电影", "尚未开分电影"]);
  assert.deepEqual(selectDiscoveryCards(cards, 1).map(({ title }) => title), ["已开分电影"]);
});
