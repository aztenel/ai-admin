import { test } from "node:test";
import assert from "node:assert/strict";
import { score, phoneKey, phoneKeys } from "../public/score.js";

test("сильный барбершоп — A, средний — B, слабый — C", () => {
  const a = score({ reviews: 380, rating: 4.9, masters: 6, branches: 1, ig_followers: 12000, ig_alive: 1, impression: 3 });
  assert.equal(a.grade, "A"); assert.equal(a.score, 35 + 5 + 20 + 15 + 5 + 15);
  const b = score({ reviews: 120, rating: 4.5, masters: 3, ig_followers: 800 });
  assert.equal(b.grade, "B"); assert.equal(b.score, 22 + 12 + 5);
  const c = score({ reviews: 12, rating: 3.8, masters: 1, ig_alive: 0, impression: 1 });
  assert.equal(c.grade, "C"); assert.equal(c.score, 0);
});

test("мало данных — буквы нет; пустые строки и null не считаются заполненными", () => {
  const s = score({ reviews: 500, rating: "", masters: null });
  assert.equal(s.grade, ""); assert.equal(s.filled, 1); assert.equal(s.score, 35);
  assert.equal(score({}).grade, "");
});

test("сеть из трёх филиалов добавляет баллы, оценка не выходит за 100", () => {
  const one = score({ reviews: 300, masters: 8, branches: 1 }).score, net = score({ reviews: 300, masters: 8, branches: 3 }).score;
  assert.equal(net - one, 15);
  assert.ok(score({ reviews: 9999, rating: 5, masters: 50, branches: 20, ig_followers: 1e6, ig_alive: 1, impression: 3 }).score <= 100);
});

test("номер для поиска повторов: +7, 8 и пробелы — один и тот же номер", () => {
  assert.equal(phoneKey("+7 701 111-22-33"), "7011112233");
  assert.equal(phoneKey("8 (701) 111 22 33"), "7011112233");
  assert.equal(phoneKey("12345"), "");
  assert.deepEqual(phoneKeys("+7 701 111 22 33; 87011112233, +7 705 000 00 01"), ["7011112233", "7050000001"]);
});
