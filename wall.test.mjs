import assert from "node:assert/strict";
import test from "node:test";
import { memoryStore, freshSeed } from "./store.mjs";
import { createServer } from "./server.js";
import { apartLabel, dayStatus, offsetMinutes, statusLine, untilLabel, visitLine, zonedTimeToUtc } from "./view.mjs";

function day(id) {
  return freshSeed().people[0].days.find((item) => item.id === id).blocks;
}

test("her week knows what overlaps, what is optional, and what is free", () => {
  assert.equal(dayStatus(day("friday"), 14 * 60 + 30).title, "Art club");
  assert.equal(dayStatus(day("friday"), 15 * 60 + 30).title, "School");
  assert.equal(dayStatus(day("friday"), 20 * 60).title, "Panto");
  assert.equal(statusLine(day("saturday"), 9 * 60), "Free for now · Dancing at 2:45 pm");
  assert.equal(dayStatus(day("saturday"), 16 * 60 + 30).title, "Nothing else today");
  assert.equal(statusLine(day("sunday"), 15 * 60), "Free · Sometimes panto");
  assert.equal(statusLine(day("monday"), 17 * 60), "Free for now · Irish dancing at 5:45 pm");
  assert.equal(dayStatus(day("monday"), 17 * 60 + 20).title, "Up next");
  assert.equal(dayStatus(day("monday"), 19 * 60 + 45).title, "Eat, chill, and sleep");
  assert.equal(dayStatus(day("tuesday"), 16 * 60).title, "Athlone");
  assert.equal(dayStatus(day("tuesday"), 19 * 60).detail, "One or the other");
  assert.equal(dayStatus(day("wednesday"), 16 * 60).title, "Nothing on");
});

test("his week is school and basketball, and the note is named Luca", () => {
  const person = freshSeed().people.find((item) => item.id === "right");
  assert.equal(person.name, "Luca");
  assert.equal(person.timezone, "");
  const blocks = Object.fromEntries(person.days.map((item) => [item.id, item.blocks]));
  assert.deepEqual(
    blocks.monday.map((item) => [item.id, item.title, item.start, item.end]),
    [
      ["mon-school", "School", "07:50", "15:00"],
      ["mon-ball", "Basketball", "18:00", "19:30"],
    ]
  );
  assert.deepEqual(
    blocks.tuesday.map((item) => [item.id, item.title, item.start, item.end]),
    [
      ["tue-school", "School", "07:50", "13:50"],
      ["tue-ball", "Basketball", "20:00", "21:30"],
    ]
  );
  assert.equal(blocks.wednesday[0].title, "School");
  assert.equal(blocks.wednesday[0].end, "13:50");
  assert.equal(blocks.wednesday[1].title, "Nothing on");
  assert.equal(blocks.wednesday[1].start, "13:50");
  assert.deepEqual(
    blocks.thursday.map((item) => [item.id, item.title, item.start, item.end]),
    [["thu-school", "School", "07:50", "17:10"]]
  );
  assert.deepEqual(
    blocks.friday.map((item) => [item.id, item.title, item.start, item.end]),
    [
      ["fri-school", "School", "07:50", "13:50"],
      ["fri-ball", "Basketball", "18:30", "20:00"],
    ]
  );
  assert.deepEqual(blocks.saturday, []);
  assert.deepEqual(blocks.sunday, []);
  assert.equal(freshSeed().people[0].name, "Teegan");
  assert.equal(freshSeed().people[0].days[0].blocks[0].start, "08:50");
});

test("ireland and italy stay an hour apart, including summer time", () => {
  const winter = new Date("2026-11-14T12:00:00Z");
  const summer = new Date("2026-06-15T12:00:00Z");
  assert.equal(offsetMinutes(winter, "Europe/Dublin"), 0);
  assert.equal(offsetMinutes(winter, "Europe/Rome"), 60);
  assert.equal(offsetMinutes(summer, "Europe/Dublin"), 60);
  assert.equal(offsetMinutes(summer, "Europe/Rome"), 120);
  assert.equal(zonedTimeToUtc("2026-11-14", "20:00", "Europe/Dublin").toISOString(), "2026-11-14T20:00:00.000Z");
  assert.equal(zonedTimeToUtc("2026-06-15", "20:00", "Europe/Dublin").toISOString(), "2026-06-15T19:00:00.000Z");
  const people = [
    { name: "Teegan", timezone: "Europe/Dublin" },
    { name: "Luca", timezone: "Europe/Rome" },
  ];
  assert.equal(apartLabel(winter, people[0], people[1]), "Luca · 1 hr ahead");
  assert.equal(visitLine(18), "In 18 days");
  assert.equal(visitLine(0), "Today");
  assert.equal(visitLine(-1), "That day has passed");
  const soon = new Date("2026-11-14T18:00:00Z");
  assert.equal(untilLabel(soon, new Date("2026-11-14T20:00:00Z")), "in 2 hr");
});

async function listen(options) {
  const server = createServer(options);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return {
    server,
    url: "http://127.0.0.1:" + port,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

async function send(base, path, options = {}) {
  const res = await fetch(base + path, {
    method: options.method || "GET",
    headers: options.body ? { "content-type": "application/json", ...(options.headers || {}) } : options.headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }
  return { status: res.status, json, text };
}

test("a local wall saves one note, a call, and the day you'll be together", async () => {
  const store = memoryStore();
  const app = await listen({ getMode: () => "local", store });
  try {
    const first = await send(app.url, "/api/board");
    assert.equal(first.status, 200);
    assert.equal(first.json.board.people[0].name, "Teegan");
    assert.equal(first.json.board.people[1].name, "Luca");
    assert.equal(first.json.mode, "local");

    const right = structuredClone(first.json.board.people[1]);
    right.name = "Alex";
    right.timezone = "Europe/Rome";
    right.days.find((day) => day.id === "monday").blocks.push({
      id: "mon-work",
      title: "Work",
      start: "09:00",
      end: "17:00",
      note: "",
      extra: "nope",
    });
    const saved = await send(app.url, "/api/people/right", { method: "PUT", body: right });
    assert.equal(saved.status, 200);
    assert.equal(saved.json.board.people[1].name, "Alex");
    assert.equal(saved.json.board.people[0].name, "Teegan");
    const monday = saved.json.board.people[1].days[0].blocks;
    const work = monday.find((block) => block.id === "mon-work");
    assert.equal(monday[0].title, "School");
    assert.equal(monday[0].start, "07:50");
    assert.ok(monday.some((block) => block.title === "Basketball"));
    assert.equal(work.title, "Work");
    assert.equal(work.start, "09:00");
    assert.equal(work.end, "17:00");
    assert.equal(work.extra, undefined);

    const bad = await send(app.url, "/api/people/right", {
      method: "PUT",
      body: { ...right, days: right.days.map((day) => ({ ...day, blocks: [{ id: "bad-time", title: "X", start: "18:00", end: "09:00", note: "" }] })) },
    });
    assert.equal(bad.status, 400);
    const still = await send(app.url, "/api/board");
    const kept = still.json.board.people[1].days[0].blocks;
    assert.equal(still.json.board.people[1].name, "Alex");
    assert.equal(kept[0].title, "School");
    assert.equal(kept[0].start, "07:50");
    assert.equal(kept.find((block) => block.id === "mon-work").title, "Work");
    assert.ok(kept.some((block) => block.title === "Basketball"));

    const call = await send(app.url, "/api/calls", {
      method: "POST",
      body: { date: "2026-11-16", time: "20:00", zone: "Europe/Dublin", note: "After dancing" },
    });
    assert.equal(call.status, 200);
    assert.equal(call.json.board.calls.length, 1);
    assert.equal(call.json.board.calls[0].note, "After dancing");
    const id = call.json.board.calls[0].id;

    const visit = await send(app.url, "/api/visit", { method: "PUT", body: { date: "2026-12-20", place: "Athlone" } });
    assert.equal(visit.json.board.visit.place, "Athlone");

    const removed = await send(app.url, "/api/calls/" + id, { method: "DELETE" });
    assert.equal(removed.json.board.calls.length, 0);
    assert.equal(removed.json.board.visit.date, "2026-12-20");

    const hidden = await send(app.url, "/store.mjs");
    assert.equal(hidden.status, 404);
    const page = await send(app.url, "/");
    assert.equal(page.status, 200);
    assert.match(page.text, /Our calendars/);
  } finally {
    await app.close();
  }
});

test("a shared wall stays closed until the code matches", async () => {
  const app = await listen({ getMode: () => "shared", key: "our-code", store: memoryStore() });
  try {
    const closed = await send(app.url, "/api/board");
    assert.equal(closed.status, 401);
    assert.equal(closed.json.board, undefined);
    assert.doesNotMatch(closed.text, /Volleyball/);
    const wrong = await send(app.url, "/api/board", { headers: { authorization: "Bearer nope" } });
    assert.equal(wrong.status, 401);
    const open = await send(app.url, "/api/board", { headers: { authorization: "Bearer our-code" } });
    assert.equal(open.status, 200);
    assert.equal(open.json.board.people[0].name, "Teegan");

    const hiddenStroke = await send(app.url, "/api/strokes", {
      method: "POST",
      body: { id: "secret01", color: "#14211c", width: 2, points: [[0.2, 0.3]] },
    });
    assert.equal(hiddenStroke.status, 401);
    assert.doesNotMatch(hiddenStroke.text, /secret01/);
    const sharedStroke = await send(app.url, "/api/strokes", {
      method: "POST",
      headers: { authorization: "Bearer our-code" },
      body: { id: "secret01", color: "#14211c", width: 2, points: [[0.2, 0.3]] },
    });
    assert.equal(sharedStroke.status, 200);
    assert.equal(sharedStroke.json.board.strokes.length, 1);
    assert.equal(sharedStroke.json.board.strokes[0].id, "secret01");
  } finally {
    await app.close();
  }
});

test("preview mode shows the starting week and refuses edits", async () => {
  const app = await listen({ getMode: () => "preview" });
  try {
    const board = await send(app.url, "/api/board");
    assert.equal(board.json.mode, "preview");
    assert.equal(board.json.board.people[0].name, "Teegan");
    const denied = await send(app.url, "/api/visit", { method: "PUT", body: { date: "2026-12-01", place: "" } });
    assert.equal(denied.status, 403);
    const deniedStroke = await send(app.url, "/api/strokes", {
      method: "POST",
      body: { id: "prev0001", color: "#14211c", width: 2, points: [[0, 0]] },
    });
    assert.equal(deniedStroke.status, 403);
  } finally {
    await app.close();
  }
});

test("a stroke is saved, a bad stroke is rejected, and clear removes the drawing", async () => {
  const store = memoryStore();
  const app = await listen({ getMode: () => "local", store });
  try {
    const before = await send(app.url, "/api/board");
    assert.deepEqual(before.json.board.strokes, []);

    const saved = await send(app.url, "/api/strokes", {
      method: "POST",
      body: {
        id: "stroke01",
        color: "#14211c",
        width: 4,
        points: [[0, 0], [0.5, 0.25], [1, 1]],
        junk: "nope",
      },
    });
    assert.equal(saved.status, 200);
    assert.deepEqual(saved.json.board.strokes, [
      { id: "stroke01", color: "#14211c", width: 4, points: [[0, 0], [0.5, 0.25], [1, 1]] },
    ]);
    assert.equal(saved.json.board.people[0].name, "Teegan");
    assert.equal(saved.json.board.people[1].name, "Luca");
    assert.equal(saved.json.board.people[0].days[0].blocks[0].start, "08:50");
    assert.equal(saved.json.board.people[1].days[0].blocks[0].start, "07:50");

    const badColor = await send(app.url, "/api/strokes", {
      method: "POST",
      body: { id: "stroke02", color: "red", width: 4, points: [[0.2, 0.2]] },
    });
    assert.equal(badColor.status, 400);
    const badWidth = await send(app.url, "/api/strokes", {
      method: "POST",
      body: { id: "stroke03", color: "#14211c", width: 3, points: [[0.2, 0.2]] },
    });
    assert.equal(badWidth.status, 400);
    const badPoint = await send(app.url, "/api/strokes", {
      method: "POST",
      body: { id: "stroke04", color: "#14211c", width: 2, points: [[0.2, 1.4]] },
    });
    assert.equal(badPoint.status, 400);
    const tooMany = await send(app.url, "/api/strokes", {
      method: "POST",
      body: {
        id: "stroke05",
        color: "#0f6e56",
        width: 2,
        points: Array.from({ length: 501 }, () => [0.1, 0.1]),
      },
    });
    assert.equal(tooMany.status, 400);

    const still = await send(app.url, "/api/board");
    assert.equal(still.json.board.strokes.length, 1);
    assert.equal(still.json.board.strokes[0].id, "stroke01");
    assert.equal(still.json.board.strokes[0].junk, undefined);

    const cleared = await send(app.url, "/api/strokes", { method: "DELETE" });
    assert.equal(cleared.status, 200);
    assert.deepEqual(cleared.json.board.strokes, []);
    assert.equal(cleared.json.board.people[0].name, "Teegan");
    assert.equal(cleared.json.board.people[1].days[4].blocks[1].title, "Basketball");

    const page = await send(app.url, "/");
    assert.match(page.text, /Our calendars/);
    assert.match(page.text, /Teegan on the left and Luca on the right\./);
    assert.doesNotMatch(page.text, /Her week on the left, mine on the right\./);
    assert.match(page.text, /Plan a call|id="app"/);
    assert.doesNotMatch(page.text, /together/i);
    assert.doesNotMatch(page.text, /When we/);
    const css = await send(app.url, "/styles.css");
    assert.equal(css.status, 200);
    assert.match(css.text, /Atkinson Hyperlegible/);
    assert.doesNotMatch(css.text, /fonts\.googleapis\.com/i);
    assert.doesNotMatch(css.text, /Fraunces|Outfit/);
    const font = await send(app.url, "/fonts/atkinson-hyperlegible-400.woff2");
    assert.equal(font.status, 200);
    const client = await send(app.url, "/app.js");
    assert.match(client.text, /Draw/);
    assert.match(client.text, /Plan a call/);
    assert.match(client.text, /Clear drawing/);
    assert.doesNotMatch(client.text, /together/i);
    assert.doesNotMatch(client.text, /When we/);
    assert.doesNotMatch(client.text, /innerHTML/);
    const serverFile = await send(app.url, "/server.js");
    assert.equal(serverFile.status, 404);
  } finally {
    await app.close();
  }
});
