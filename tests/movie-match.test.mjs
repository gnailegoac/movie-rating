import assert from "node:assert/strict";
import test from "node:test";
import { selectDoubanCandidate } from "../lib/movie-match.js";

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
