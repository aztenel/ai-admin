// Слияние изменений чата для переписок в D1 (src/services/chatstore/merge.js, 01.11.2026): пишущий меняет только то, что поменял сам;
// чего он не видел, остаётся; статус доставки только растёт; удаляется только явно удалённое. Чистые функции, без базы.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkeyOf, mergeProfile3, mergeTurn3, mergeList, planPut, bare } from "../../src/services/chatstore/merge.js";

const T0 = 1793500000000;
const snap = (rev, turns, profile = {}, n = 1) => ({ rev, n, profile, turns });

test("ключ сообщения: номер у провайдера, номер отправки, отпечаток неизменяемых полей", () => {
  const inb = { role: "user", text: "Привет", t: T0, mid: "3EB0A1" };
  assert.equal(mkeyOf(inb), "m:3EB0A1:u");
  assert.equal(mkeyOf({ ...inb, role: "model" }), "m:3EB0A1:m", "у нашего сообщения с тем же номером — свой ключ");
  assert.equal(mkeyOf({ ...inb, text: "Привет!", ed: 1 }), mkeyOf(inb), "клиент исправил текст — то же сообщение");
  assert.equal(mkeyOf({ role: "model", text: "Ок", t: T0, rid: "out-a-1" }), "r:out-a-1");
  const bot = { role: "model", text: "Записала вас", t: T0 };
  assert.equal(mkeyOf(bot), mkeyOf({ ...bot, st: "read" }), "статус не меняет ключ");
  assert.notEqual(mkeyOf(bot), mkeyOf({ ...bot, t: T0 + 1 }));
  assert.notEqual(mkeyOf({ role: "user", text: "Да", t: T0 }), mkeyOf({ role: "model", text: "Да", t: T0 }));
  assert.notEqual(mkeyOf({ role: "user", text: "Да" }, 0), mkeyOf({ role: "user", text: "Да" }, 1), "старые реплики без времени различаются местом");
  assert.deepEqual(bare({ role: "user", text: "x", _i: 5 }), { role: "user", text: "x" });
});

test("профиль: пишущий меняет только своё; перенесённое из старой копии не затирает новое", () => {
  // пульт взял чат себе (as), пока вебхук записывал новое входящее (li, need) — оба изменения остаются
  const base = { li: T0, waName: "Арман" };
  const cur = { ...base, as: { n: "Айгерим", at: T0 + 5 } };                 // записал пульт
  const mine = { ...base, li: T0 + 9, need: { at: T0 + 9, why: "off" } };   // вебхук прочитал до пульта
  assert.deepEqual(mergeProfile3([base], mine, cur), { li: T0 + 9, waName: "Арман", as: { n: "Айгерим", at: T0 + 5 }, need: { at: T0 + 9, why: "off" } });
  // think() читает чат дважды: в начале (G1) и перед записью (G2). Поле, которое он не трогал, равно G1 — и не возвращается к G1
  const G1 = { done: 1 }, G2 = {}, curNow = { as: { n: "Ерлан" } };
  assert.deepEqual(mergeProfile3([G1, G2], { done: 1, li: T0 }, curNow), { as: { n: "Ерлан" }, li: T0 }, "«Готово» сняли между чтениями — бот его не возвращает");
  // удаление своим действием: «Вернуть бота» убирает паузу
  assert.deepEqual(mergeProfile3([{ pausedUntil: T0 + 100 }], {}, { pausedUntil: T0 + 100, need: { why: "x" } }), { need: { why: "x" } });
  // пауза и последнее сообщение клиента — только вперёд
  assert.equal(mergeProfile3([{}], { pausedUntil: T0 + 10 }, { pausedUntil: T0 + 99 }).pausedUntil, T0 + 99);
  assert.equal(mergeProfile3([{ li: T0 }], { li: T0 + 1 }, { li: T0 + 5 }).li, T0 + 5);
  // слепая запись (без чтения): совпадающее с базой — без изменений, остальное — своё
  assert.deepEqual(mergeProfile3([], { a: 1, b: 2 }, { a: 1, c: 3 }), { a: 1, b: 2, c: 3 });
});

test("списки профиля: добавленное обоими остаётся, удалённое пишущим уходит, изменённое — его версия", () => {
  const e1 = { t: 1, w: "Айгерим", a: "take" }, e2 = { t: 2, w: "Ерлан", a: "task" }, e3 = { t: 3, w: "Айгерим", a: "close" };
  assert.deepEqual(mergeList([[e1]], [e1, e3], [e1, e2]), [e1, e2, e3], "журнал действий: запись другого администратора не пропадает");
  assert.deepEqual(mergeList([["a", "b"]], ["b", "c"], ["a", "b", "x"]), ["b", "x", "c"], "echo: старое ушло за предел, новое добавилось, чужое осталось");
  const b1 = { leadId: "L1", date: "2026-11-02", time: "15:00" }, b1m = { ...b1, time: "16:00" }, b2 = { leadId: "L2", time: "12:00" };
  assert.deepEqual(mergeList([[b1]], [b1m], [b1, b2]), [b1m, b2], "запись перенесли — версия пишущего; чужая запись на месте");
  assert.deepEqual(mergeList([[b1, b2]], [b2], [b1, b2]), [b2], "отменённая пишущим запись уходит");
  assert.deepEqual(mergeList([[b1]], [b1, b2], []), [b2], "удалённое другими не возвращается, новое пишущего — добавляется");
});

test("сообщение: статус только растёт, правка текста и галочка не мешают друг другу", () => {
  const sent = { role: "model", text: "Ждём вас", t: T0, mid: "M1", st: "sent", _i: 7 };
  assert.equal(mergeTurn3([sent], { ...sent, st: "delivered" }, { ...sent, st: "read" }), null, "«доставлено» после «прочитано» — без изменений");
  assert.deepEqual(mergeTurn3([sent], { ...sent, st: "read" }, { ...sent, st: "delivered" }), bare({ ...sent, st: "read" }));
  assert.deepEqual(mergeTurn3([sent], { ...sent, st: "failed", se: "Timed Out" }, sent), bare({ ...sent, st: "failed", se: "Timed Out" }));
  assert.equal(mergeTurn3([sent], { ...sent, st: "failed", se: "x" }, { ...sent, st: "delivered" }), null, "доставленное не становится недоставленным");
  assert.deepEqual(mergeTurn3([{ ...sent, st: "failed", se: "x" }], { ...sent, st: "read", se: "x" }, { ...sent, st: "failed", se: "x" }), bare({ ...sent, st: "read" }), "Green-API ошибся, потом доставил — без причины ошибки");
  const inb = { role: "user", text: "Можно в 15?", t: T0, mid: "I1", _i: 8 };
  assert.deepEqual(mergeTurn3([inb], { ...inb, text: "Можно в 16?", ed: 1 }, { ...inb, re: "👍" }), bare({ ...inb, text: "Можно в 16?", ed: 1, re: "👍" }), "правка клиента и наша реакция — обе");
  assert.equal(mergeTurn3([inb], inb, { ...inb, del: 1 }), null, "пишущий не менял — пометка «удалено» остаётся");
});

test("план записи: новое — вставкой без дублей, удаление — только явное, счётчик n — приращение пишущего", () => {
  const a = { role: "user", text: "Здравствуйте", t: T0, mid: "A", _i: 1 }, b = { role: "model", text: "Добрый день", t: T0 + 1, by: "admin", mid: "B", st: "sent", _i: 2 };
  const seen = snap(3, [a, b], { li: T0 }, 4);
  // пишущий добавил реплику и поменял статус; в базе за это время появилась чужая реплика c — она не удаляется
  const c = { role: "user", text: "Спасибо", t: T0 + 2, mid: "C", _i: 3 };
  const cur = snap(4, [a, b, c], { li: T0 + 2 }, 5);
  const p = planPut([seen], { n: 5, turns: [a, { ...b, st: "delivered" }, { role: "model", text: "Ждём", t: T0 + 3, by: "admin" }], profile: { li: T0 } }, cur);
  assert.deepEqual(p.inserts.map(t => t.text), ["Ждём"]);
  assert.deepEqual(p.updates.map(u => [u.id, u.data.st]), [[2, "delivered"]]);
  assert.deepEqual(p.deletes, [], "c пишущий не видел — она остаётся");
  assert.equal(p.n, 6, "n: в базе 5, пишущий прибавил 1");
  assert.equal(p.profile.li, T0 + 2, "li пишущий не менял");
  // та же реплика без номера строки (повтор записи после сбоя) — не вставляется второй раз
  assert.equal(planPut([seen], { n: 5, turns: [a, b, { role: "user", text: "Спасибо", t: T0 + 2, mid: "C" }], profile: {} }, cur).inserts.length, 0);
  // «Очистить память» / «Удалить данные»: пустая переписка — удаляются только те, что пишущий видел
  const clr = planPut([seen], { n: 5, turns: [], profile: { forgot: T0 + 5 } }, cur);
  assert.deepEqual(clr.deletes.sort(), [1, 2], "чужая c, пришедшая после чтения, остаётся");
  // отметка forgot у пишущего (копия после очистки): реплики до неё, которых у пишущего нет, — удаляются
  const fg = planPut([seen], { n: 5, turns: [b], profile: { forgot: T0 + 1 } }, cur);
  assert.deepEqual(fg.deletes, [1]);
  // реплики больше нет в базе (удалили) — пишущий её не возвращает
  assert.deepEqual(planPut([seen], { n: 5, turns: [a, { ...b, st: "read" }], profile: {} }, snap(5, [a], {}, 5)).updates, []);
  // новый чат: никто не видел строки, n — как у пишущего
  const nw = planPut([{ absent: true, rev: 0, n: 0, profile: {}, turns: [] }], { n: 1, turns: [{ role: "user", text: "Привет", t: T0, mid: "Z" }], profile: { li: T0 } }, { absent: true, rev: 0, n: 0, profile: {}, turns: [] });
  assert.equal(nw.n, 1); assert.equal(nw.inserts.length, 1); assert.deepEqual(nw.profile, { li: T0 });
});
