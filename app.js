import { cleanCall, cleanPerson, cleanStroke, validateBoard } from "./board.mjs";
import { freshSeed, PUBLIC_BOARD_URL } from "./seed.mjs";
import {
  DAYS,
  MAX_POINTS,
  MAX_STROKES,
  STROKE_COLORS,
  STROKE_WIDTHS,
  ZONES,
  apartLabel,
  blockWhen,
  callInstant,
  dayStatus,
  statusLine,
  untilLabel,
  zonedParts,
} from "./view.mjs";

const CODE_KEY = "side-by-side-code";
const DRAW_POLL_MS = 3000;
const COLOR_LABELS = ["Ink", "Green", "Clay", "Blue"];
const WIDTH_LABELS = ["Thin", "Medium", "Thick"];
const live = [];
const inflight = new Set();
let saveChain = Promise.resolve();
let transport = "pending";
let syncTimer = 0;

const state = {
  mode: "local",
  board: null,
  locked: false,
  lockError: "",
  editing: null,
  draft: null,
  panel: null,
  focusId: "",
  phone: null,
  penColor: STROKE_COLORS[0],
  penWidth: STROKE_WIDTHS[1],
  active: null,
  pointerId: null,
  clearing: false,
};

let focusPhoneBack = false;
const phoneMedia = typeof window !== "undefined" && typeof window.matchMedia === "function"
  ? window.matchMedia("(max-width: 700px)")
  : null;

function isPhone() {
  return Boolean(phoneMedia && phoneMedia.matches);
}

function el(tag, attrs = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key === "class") node.className = value;
    else if (key === "dataset") Object.assign(node.dataset, value);
    else if (key.startsWith("on")) node.addEventListener(key.slice(2).toLowerCase(), value);
    else node.setAttribute(key, String(value));
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    node.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return node;
}

function storedCode() {
  try {
    return localStorage.getItem(CODE_KEY) || "";
  } catch {
    return "";
  }
}

function storeCode(value) {
  try {
    if (value) localStorage.setItem(CODE_KEY, value);
    else localStorage.removeItem(CODE_KEY);
  } catch {
    // The browser can refuse storage. The code still works for this request.
  }
}

function watch(node, fn) {
  live.push({ node, fn });
  node.textContent = fn(new Date());
  return node;
}

function newId() {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function flash(message) {
  const node = document.getElementById("notice");
  if (!node) return;
  node.textContent = message;
  clearTimeout(flash.timer);
  flash.timer = setTimeout(() => {
    node.textContent = "";
  }, 2500);
}

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body !== undefined) headers["content-type"] = "application/json";
  const code = storedCode();
  if (code) headers.authorization = "Bearer " + code;
  const res = await fetch(path, {
    method: options.method || "GET",
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  let data = {};
  try {
    data = await res.json();
  } catch {
    data = {};
  }
  if (res.status === 401) {
    storeCode("");
    state.locked = true;
    state.mode = "shared";
    state.board = null;
    state.lockError = data.error || "That code didn't match.";
    state.editing = null;
    state.draft = null;
    state.panel = null;
    render();
    const error = new Error("locked");
    error.locked = true;
    throw error;
  }
  if (!res.ok) {
    const error = new Error(data.error || "Could not save.");
    error.locked = false;
    throw error;
  }
  return data;
}

function personById(id) {
  return state.board.people.find((person) => person.id === id);
}

function personClock(person, now) {
  if (!person.timezone) return "Time zone not set";
  const where = ZONES.find((zone) => zone[0] === person.timezone);
  const parts = zonedParts(now, person.timezone);
  return (where ? where[1] : person.timezone) + " · " + parts.clockLabel;
}

function personStatus(person, now) {
  if (!person.timezone) return "Set a time zone so this note knows the time.";
  const parts = zonedParts(now, person.timezone);
  const day = person.days.find((item) => item.id === parts.weekday.toLowerCase());
  if (!day) return "";
  return statusLine(day.blocks, parts.minutes);
}

function render() {
  live.length = 0;
  const app = document.getElementById("app");
  app.replaceChildren();
  if (state.locked || !state.board) {
    app.append(lockNote());
    return;
  }
  const phone = isPhone();
  if (phone) app.append(phoneBody());
  else {
    const banner = statusBanner();
    if (banner) app.append(banner);
    app.append(clocks(), actions());
    if (state.panel === "draw") app.append(drawSection());
    app.append(wall());
  }
  app.append(el("p", { class: "footnote" }, "Each note keeps its own time zone. A pinned call stays up until you take it down. A drawing stays until someone clears it."));
  paintLive();
  if (document.getElementById("draw-pad")) requestAnimationFrame(resizeCanvas);
  const backWanted = focusPhoneBack;
  focusPhoneBack = false;
  if (state.focusId) {
    const target = document.querySelector('[data-block="' + state.focusId + '"] input[name="title"]');
    state.focusId = "";
    if (target) target.focus();
  } else if (backWanted) {
    const back = document.querySelector(".phone-back");
    if (back) back.focus();
  }
}

function statusBanner() {
  if (state.mode === "local") {
    return el("p", { class: "banner" }, "Saved on this computer only. The other phone won’t see a change until this wall is shared.");
  }
  if (state.mode === "preview") {
    return el("p", { class: "banner" }, "This is the starting week. Shared saving isn’t on yet, so the notes can’t be changed from here.");
  }
  if (state.mode === "memory") {
    return el("p", { class: "banner" }, "This tab has the starting week. A change here stays in this tab.");
  }
  return null;
}

function clocks() {
  const line = watch(el("p", { class: "clock-line" }), (now) =>
    state.board.people
      .map((person) => (person.timezone ? person.name + " · " + zonedParts(now, person.timezone).clockLabel : person.name + " · set a time zone"))
      .join("  ·  ")
  );
  const apart = watch(el("p", { class: "apart" }), (now) => apartLabel(now, state.board.people[0], state.board.people[1]));
  return el("div", { class: "clocks" }, line, apart);
}

function actions() {
  const off = state.mode === "preview";
  return el(
    "div",
    { class: "actions" },
    el("button", { type: "button", disabled: off, onClick: () => openPanel("call") }, "Plan a call"),
    el(
      "button",
      {
        type: "button",
        disabled: off,
        class: state.panel === "draw" ? "is-on" : "",
        onClick: openDraw,
      },
      "Draw"
    )
  );
}

function openDraw() {
  if (state.mode === "preview") return;
  state.editing = null;
  state.draft = null;
  state.panel = state.panel === "draw" ? null : "draw";
  state.active = null;
  state.pointerId = null;
  render();
  void pullBoard();
}

function openPanel(panel) {
  if (state.mode === "preview") return;
  state.panel = panel;
  state.editing = null;
  state.draft = null;
  render();
}

function activePhoneScreen() {
  if (state.phone === "home" || state.phone === "calls" || state.phone === "draw") return state.phone;
  if (state.panel === "draw") return "draw";
  if (state.phone && personById(state.phone)) return state.phone;
  if (state.panel === "call") return "calls";
  if (state.editing && personById(state.editing)) return state.editing;
  return "home";
}

function showPhoneHome() {
  state.phone = "home";
  if (state.panel === "draw") state.panel = null;
  state.active = null;
  state.pointerId = null;
  render();
  void pullBoard();
}

function showPhonePerson(id) {
  state.phone = id;
  focusPhoneBack = true;
  render();
}

function showPhoneCalls() {
  state.phone = "calls";
  if (state.mode !== "preview") state.panel = "call";
  state.active = null;
  state.pointerId = null;
  focusPhoneBack = true;
  render();
  void pullBoard();
}

function showPhoneDraw() {
  state.phone = "draw";
  state.panel = "draw";
  state.editing = null;
  state.draft = null;
  state.active = null;
  state.pointerId = null;
  focusPhoneBack = true;
  render();
  void pullBoard();
}

function phoneChoice(label, onClick, screen) {
  const attrs = { type: "button", class: "phone-choice", onClick };
  if (screen) attrs.dataset = { screen };
  return el("button", attrs, label);
}

function phoneHome() {
  const [left, right] = state.board.people;
  return el(
    "nav",
    { class: "phone-home", "aria-label": "Choose what to open" },
    phoneChoice(left.name, () => showPhonePerson(left.id), left.id),
    phoneChoice(right.name, () => showPhonePerson(right.id), right.id),
    phoneChoice("Plan a call", showPhoneCalls, "calls"),
    phoneChoice("Draw", showPhoneDraw, "draw")
  );
}

function phoneBack() {
  return el(
    "button",
    { type: "button", class: "phone-back", onClick: showPhoneHome },
    "Back"
  );
}

function phoneBody() {
  const screen = activePhoneScreen();
  if (screen === "home") return el("div", { class: "phone-stack" }, phoneHome(), statusBanner(), clocks());
  if (screen === "calls") return phoneCalls();
  if (screen === "draw") return phoneDraw();
  return phonePerson(personById(screen));
}

function phoneDraw() {
  return el(
    "div",
    { class: "phone-screen", dataset: { screen: "draw" } },
    phoneBack(),
    statusBanner(),
    drawSection()
  );
}

function phonePerson(person) {
  return el(
    "div",
    { class: "phone-screen", dataset: { screen: person.id } },
    phoneBack(),
    statusBanner(),
    clocks(),
    personColumn(person)
  );
}

function phoneCalls() {
  const kids = [phoneBack(), statusBanner(), clocks()];
  if (state.panel !== "call" && state.mode !== "preview") {
    kids.push(phoneChoice("Plan a call", () => {
      state.panel = "call";
      render();
    }, "calls"));
  }
  kids.push(center());
  return el("div", { class: "phone-screen", dataset: { screen: "calls" } }, kids);
}

function wall() {
  const [left, right] = state.board.people;
  return el("div", { class: "wall" }, personColumn(left), center(), personColumn(right));
}

function drawVisible() {
  return state.panel === "draw" || (isPhone() && activePhoneScreen() === "draw");
}

function drawSection() {
  const off = state.mode === "preview";
  const canvas = el("canvas", {
    id: "draw-pad",
    class: "draw-pad",
    width: "2",
    height: "2",
  });
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerUp);
  const colors = STROKE_COLORS.map((color, index) =>
    el(
      "button",
      {
        type: "button",
        class: "swatch" + (color === state.penColor ? " is-on" : ""),
        style: "background:" + color,
        "aria-label": COLOR_LABELS[index] || "Color",
        "aria-pressed": color === state.penColor ? "true" : "false",
        disabled: off,
        onClick: () => {
          state.penColor = color;
          markPen();
        },
      }
    )
  );
  const widths = STROKE_WIDTHS.map((width, index) =>
    el(
      "button",
      {
        type: "button",
        class: "pen-size" + (width === state.penWidth ? " is-on" : ""),
        "aria-pressed": width === state.penWidth ? "true" : "false",
        disabled: off,
        onClick: () => {
          state.penWidth = width;
          markPen();
        },
      },
      WIDTH_LABELS[index] || String(width)
    )
  );
  return el(
    "section",
    { class: "draw-section", dataset: { screen: "draw" } },
    el("h2", {}, "Drawing"),
    el("p", { class: "draw-live" }, "Live for both of you."),
    canvas,
    el("div", { class: "pen-row" }, ...colors, ...widths),
    el(
      "button",
      {
        type: "button",
        class: "text-btn",
        dataset: { action: "clear-draw" },
        disabled: off || state.clearing || !(state.board.strokes || []).length,
        onClick: clearDrawing,
      },
      "Clear"
    )
  );
}

function markPen() {
  const pad = document.getElementById("draw-pad");
  if (!pad) {
    render();
    return;
  }
  const row = pad.parentElement && pad.parentElement.querySelector(".pen-row");
  if (!row) return;
  const buttons = [...row.querySelectorAll("button")];
  buttons.forEach((button, index) => {
    const on = index < STROKE_COLORS.length
      ? STROKE_COLORS[index] === state.penColor
      : STROKE_WIDTHS[index - STROKE_COLORS.length] === state.penWidth;
    button.classList.toggle("is-on", on);
    button.setAttribute("aria-pressed", on ? "true" : "false");
  });
}

function canvasBox(canvas) {
  const rect = canvas.getBoundingClientRect();
  return { w: Math.max(rect.width, 1), h: Math.max(rect.height, 1) };
}

function resizeCanvas() {
  const canvas = document.getElementById("draw-pad");
  if (!canvas) return;
  const box = canvasBox(canvas);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.max(1, Math.round(box.w * dpr));
  const h = Math.max(1, Math.round(box.h * dpr));
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
  paintStrokes();
}

function pointFromEvent(event, canvas) {
  const rect = canvas.getBoundingClientRect();
  const x = rect.width ? (event.clientX - rect.left) / rect.width : 0;
  const y = rect.height ? (event.clientY - rect.top) / rect.height : 0;
  return [
    Math.min(1, Math.max(0, Math.round(x * 10000) / 10000)),
    Math.min(1, Math.max(0, Math.round(y * 10000) / 10000)),
  ];
}

function onPointerDown(event) {
  if (state.mode === "preview" || state.clearing || !state.board || state.active) return;
  const canvas = event.currentTarget;
  canvas.setPointerCapture(event.pointerId);
  state.pointerId = event.pointerId;
  state.active = {
    id: newId(),
    color: state.penColor,
    width: state.penWidth,
    points: [pointFromEvent(event, canvas)],
  };
  paintStrokes();
  event.preventDefault();
}

function onPointerMove(event) {
  const stroke = state.active;
  if (!stroke || event.pointerId !== state.pointerId) return;
  if (stroke.points.length >= MAX_POINTS) return;
  const canvas = event.currentTarget;
  const next = pointFromEvent(event, canvas);
  const last = stroke.points[stroke.points.length - 1];
  if (Math.hypot(next[0] - last[0], next[1] - last[1]) < 0.004) return;
  stroke.points.push(next);
  paintStrokes();
  event.preventDefault();
}

function onPointerUp(event) {
  const stroke = state.active;
  if (!stroke || event.pointerId !== state.pointerId) return;
  state.active = null;
  state.pointerId = null;
  if (event.currentTarget.hasPointerCapture && event.currentTarget.hasPointerCapture(event.pointerId)) {
    event.currentTarget.releasePointerCapture(event.pointerId);
  }
  commitStroke(stroke);
}

function drawStroke(ctx, stroke, w, h, scale) {
  if (!stroke || !STROKE_COLORS.includes(stroke.color) || !STROKE_WIDTHS.includes(stroke.width)) return;
  if (!Array.isArray(stroke.points) || !stroke.points.length) return;
  const first = stroke.points[0];
  ctx.beginPath();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = stroke.color;
  ctx.fillStyle = stroke.color;
  ctx.lineWidth = stroke.width * scale;
  if (stroke.points.length === 1) {
    ctx.arc(first[0] * w, first[1] * h, (stroke.width * scale) / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  ctx.moveTo(first[0] * w, first[1] * h);
  for (let i = 1; i < stroke.points.length; i += 1) {
    const point = stroke.points[i];
    ctx.lineTo(point[0] * w, point[1] * h);
  }
  ctx.stroke();
}

function paintStrokes() {
  const canvas = document.getElementById("draw-pad");
  if (!canvas || !state.board) return;
  const ctx = canvas.getContext("2d");
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#f8fbf9";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const strokes = [...(state.board.strokes || [])];
  if (state.active) strokes.push(state.active);
  for (const stroke of strokes) drawStroke(ctx, stroke, canvas.width, canvas.height, dpr);
}

function mergeStrokes(remote) {
  const list = Array.isArray(remote) ? remote : [];
  const seen = new Set(list.map((stroke) => stroke.id));
  const pending = (state.board.strokes || []).filter((stroke) => inflight.has(stroke.id) && !seen.has(stroke.id));
  return list.concat(pending);
}

function syncClearButton() {
  const button = document.querySelector("[data-action='clear-draw']");
  if (!button) return;
  const count = state.board && Array.isArray(state.board.strokes) ? state.board.strokes.length : 0;
  button.disabled = state.mode === "preview" || state.clearing || !count;
}

function commitStroke(stroke) {
  if (!stroke || !stroke.points.length || !state.board) return;
  inflight.add(stroke.id);
  state.board.strokes = (state.board.strokes || []).concat(stroke);
  paintStrokes();
  syncClearButton();
  persistStroke(stroke)
    .then((saved) => {
      inflight.delete(stroke.id);
      if (!saved || !saved.board || !state.board) return;
      state.board = saved.board;
      state.board.strokes = mergeStrokes(saved.board.strokes);
      paintStrokes();
      syncClearButton();
    })
    .catch((err) => {
      inflight.delete(stroke.id);
      if (state.board) state.board.strokes = (state.board.strokes || []).filter((item) => item.id !== stroke.id);
      paintStrokes();
      syncClearButton();
      if (!err.locked) flash(err.message || "Could not save.");
    });
}

async function clearDrawing() {
  if (state.clearing || state.mode === "preview" || !state.board) return;
  state.clearing = true;
  state.active = null;
  syncClearButton();
  try {
    const saved = await persistClear();
    state.board = saved.board;
    state.board.strokes = [];
    paintStrokes();
    flash("Drawing cleared.");
  } catch (err) {
    if (!err.locked) flash(err.message || "Could not save.");
  } finally {
    state.clearing = false;
    syncClearButton();
  }
}

function personColumn(person) {
  if (state.editing === person.id) return editor(state.draft);
  return personNote(person);
}

function personNote(person) {
  const any = person.days.some((day) => day.blocks.length);
  return el(
    "article",
    { class: "note note-" + person.id, dataset: { person: person.id, zone: person.timezone } },
    el("h2", {}, person.name),
    watch(el("p", { class: "note-clock" }), (now) => personClock(person, now)),
    watch(el("p", { class: "now-line" }), (now) => personStatus(person, now)),
    any ? el("div", { class: "days" }, person.days.filter((day) => day.blocks.length).map((day) => dayView(day))) : el("p", { class: "clear" }, "Nothing written on this note yet."),
    state.mode === "preview"
      ? null
      : el("div", { class: "note-actions" }, el("button", { type: "button", class: "text-btn", onClick: () => startEdit(person) }, "Write on this note"))
  );
}

function dayView(day) {
  const meta = DAYS.find((item) => item.id === day.id);
  return el(
    "section",
    { class: "day", dataset: { day: day.id } },
    el("h3", {}, meta.short),
    el(
      "ul",
      {},
      day.blocks.map((block) => {
        const when = blockWhen(block);
        return el(
          "li",
          { class: "line", dataset: { id: block.id } },
          el("p", { class: "line-title" }, when ? block.title + " — " + when : block.title),
          block.note ? el("p", { class: "line-note" }, block.note) : null
        );
      })
    )
  );
}

function startEdit(person) {
  state.editing = person.id;
  state.draft = structuredClone(person);
  state.panel = null;
  render();
}

function zoneSelect(value) {
  const select = el("select", { "aria-label": "Time zone" });
  const blank = el("option", { value: "" }, "Choose a time zone");
  if (!value) blank.selected = true;
  select.append(blank);
  for (const [id, label] of ZONES) {
    const option = el("option", { value: id }, label);
    if (id === value) option.selected = true;
    select.append(option);
  }
  if (value && !ZONES.some((zone) => zone[0] === value)) {
    const extra = el("option", { value }, value);
    extra.selected = true;
    select.append(extra);
  }
  return select;
}

function editor(person) {
  const error = el("p", { class: "form-error", role: "alert" });
  const name = el("input", {
    class: "editor-name",
    type: "text",
    value: person.name,
    maxlength: "40",
    "aria-label": "Name on this note",
    spellcheck: "false",
  });
  name.addEventListener("input", () => {
    person.name = name.value;
  });
  const zone = zoneSelect(person.timezone);
  zone.addEventListener("change", () => {
    person.timezone = zone.value;
  });
  const form = el(
    "form",
    { class: "editor" },
    name,
    zone,
    person.days.map((day) => dayEditor(person, day)),
    error,
    el(
      "div",
      { class: "form-row" },
      el("button", { type: "submit" }, "Save"),
      el("button", { type: "button", class: "text-btn", onClick: cancelEdit }, "Cancel")
    )
  );
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    error.textContent = "";
    const body = structuredClone(person);
    body.name = name.value.trim();
    body.timezone = zone.value;
    for (const day of body.days) {
      day.blocks = day.blocks.filter((block) => block.title.trim() || block.start || block.end || block.note.trim());
    }
    try {
      const saved = await persistPerson(body);
      state.board = saved.board;
      state.editing = null;
      state.draft = null;
      render();
      flash("Saved. The other note is unchanged.");
    } catch (err) {
      if (!err.locked) error.textContent = err.message;
    }
  });
  return el("article", { class: "note note-" + person.id + " is-editing" }, form);
}

function dayEditor(person, day) {
  const meta = DAYS.find((item) => item.id === day.id);
  return el(
    "section",
    { class: "day-edit" },
    el("h3", {}, meta.name),
    day.blocks.map((block) => lineEditor(person, day, block)),
    el(
      "button",
      {
        type: "button",
        class: "text-btn",
        onClick: () => {
          const id = newId();
          day.blocks.push({ id, title: "", start: "", end: "", note: "" });
          state.focusId = id;
          render();
        },
      },
      "Add a line"
    )
  );
}

function lineEditor(person, day, block) {
  const title = el("input", { type: "text", name: "title", value: block.title, maxlength: "80", placeholder: "School, call, free…", "aria-label": "Line" });
  const start = el("input", { type: "time", name: "start", value: block.start, "aria-label": "Start" });
  const end = el("input", { type: "time", name: "end", value: block.end, "aria-label": "End" });
  const note = el("input", { type: "text", name: "note", value: block.note, maxlength: "120", placeholder: "Note", "aria-label": "Note" });
  title.addEventListener("input", () => {
    block.title = title.value;
  });
  start.addEventListener("input", () => {
    block.start = start.value;
  });
  end.addEventListener("input", () => {
    block.end = end.value;
  });
  note.addEventListener("input", () => {
    block.note = note.value;
  });
  return el(
    "div",
    { class: "line-edit", dataset: { block: block.id } },
    title,
    start,
    end,
    note,
    el(
      "button",
      {
        type: "button",
        class: "text-btn remove",
        onClick: () => {
          day.blocks = day.blocks.filter((item) => item.id !== block.id);
          render();
        },
      },
      "Remove"
    )
  );
}

function cancelEdit() {
  state.editing = null;
  state.draft = null;
  render();
}

function center() {
  const kids = [];
  if (state.panel === "call") kids.push(callForm());
  const calls = sortedCalls();
  if (!calls.length && state.panel !== "call") kids.push(el("p", { class: "empty-call" }, "No call pinned."));
  kids.push(...calls.map((call) => callNote(call)));
  return el("div", { class: "center" }, kids);
}

function sortedCalls(now = new Date()) {
  const mark = now.getTime() - 60_000;
  const decorated = state.board.calls.map((call) => ({ call, at: callInstant(call).getTime() }));
  const ahead = decorated.filter((item) => item.at >= mark).sort((a, b) => a.at - b.at);
  const past = decorated.filter((item) => item.at < mark).sort((a, b) => b.at - a.at);
  return [...ahead, ...past].map((item) => item.call);
}

function callForm() {
  const error = el("p", { class: "form-error", role: "alert" });
  const select = el("select", { name: "zone", "aria-label": "Time zone of this call" });
  const seen = new Set();
  for (const person of state.board.people) {
    if (!person.timezone || seen.has(person.timezone)) continue;
    seen.add(person.timezone);
    select.append(el("option", { value: person.timezone }, person.name + "’s time"));
  }
  let browserZone = "";
  try {
    browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
  } catch {
    browserZone = "";
  }
  if (browserZone && !seen.has(browserZone)) select.append(el("option", { value: browserZone }, "This phone’s time"));
  const form = el(
    "form",
    { class: "sheet-form note note-call" },
    el("h2", {}, "Plan a call"),
    labeled("Date", el("input", { type: "date", name: "date", required: "true" })),
    labeled("Time", el("input", { type: "time", name: "time", required: "true" })),
    labeled("This time is in", select),
    labeled("Note", el("input", { type: "text", name: "note", maxlength: "80", placeholder: "Goodnight, after dancing…" })),
    error,
    el(
      "div",
      { class: "form-row" },
      el("button", { type: "submit" }, "Pin it"),
      el("button", { type: "button", class: "text-btn", onClick: closePanel }, "Cancel")
    )
  );
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    error.textContent = "";
    const data = Object.fromEntries(new FormData(form));
    if (!data.zone) {
      error.textContent = "Pick which time zone that call is in.";
      return;
    }
    try {
      const saved = await persistCall({ date: data.date, time: data.time, zone: data.zone, note: data.note || "" });
      state.board = saved.board;
      state.panel = null;
      render();
      flash("Call pinned.");
    } catch (err) {
      if (!err.locked) error.textContent = err.message;
    }
  });
  return form;
}

function labeled(text, field) {
  return el("label", {}, text, field);
}

function closePanel() {
  state.panel = null;
  render();
}

function callNote(call) {
  const at = callInstant(call);
  const times = state.board.people
    .filter((person) => person.timezone)
    .map((person) =>
      watch(el("p", { class: "call-time" }), () => {
        const parts = zonedParts(at, person.timezone);
        return person.name + " · " + parts.dateLabel + " · " + parts.clockLabel;
      })
    );
  return el(
    "article",
    { class: "note note-call" },
    el("p", { class: "kicker" }, "Call"),
    watch(el("p", { class: "remain" }), (now) => untilLabel(now, at)),
    ...times,
    call.note ? el("p", { class: "call-note" }, call.note) : null,
    state.mode === "preview"
      ? null
      : el(
          "div",
          { class: "note-actions" },
          el("button", { type: "button", class: "text-btn", onClick: () => removeCall(call.id) }, "Take down")
        )
  );
}

async function removeCall(id) {
  try {
    const saved = await persistRemoveCall(id);
    state.board = saved.board;
    render();
    flash("Taken down.");
  } catch (err) {
    if (!err.locked) flash(err.message);
  }
}

function lockNote() {
  const error = el("p", { class: "form-error", role: "alert" }, state.lockError);
  const input = el("input", {
    type: "text",
    autocomplete: "off",
    spellcheck: "false",
    maxlength: "80",
    "aria-label": "The code you both know",
  });
  const form = el(
    "form",
    { class: "note note-lock" },
    el("h2", {}, "This wall is locked"),
    el("p", {}, "Type the code you both know."),
    input,
    error,
    el("button", { type: "submit" }, "Open")
  );
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const code = input.value.trim();
    if (!code) {
      error.textContent = "Type the code.";
      return;
    }
    storeCode(code);
    state.lockError = "";
    try {
      await load();
    } catch (err) {
      if (!err.locked) error.textContent = err.message;
    }
  });
  return el("div", { class: "lock-wrap" }, form);
}

function enqueueSave(fn) {
  const run = saveChain.then(fn, fn);
  saveChain = run.then(
    () => {},
    () => {}
  );
  return run;
}

function paintLive() {
  const now = new Date();
  for (const item of live) item.node.textContent = item.fn(now);
  if (!state.board) return;
  for (const note of document.querySelectorAll(".note[data-person]")) {
    const person = personById(note.dataset.person);
    if (!person || !person.timezone) continue;
    const parts = zonedParts(now, person.timezone);
    const weekday = parts.weekday.toLowerCase();
    const day = person.days.find((item) => item.id === weekday);
    const status = day ? dayStatus(day.blocks, parts.minutes) : { blockId: null };
    for (const section of note.querySelectorAll(".day")) {
      section.classList.toggle("is-today", section.dataset.day === weekday);
    }
    for (const line of note.querySelectorAll(".line")) {
      line.classList.toggle("is-now", line.dataset.id === status.blockId);
    }
  }
}

function plainError(message) {
  const error = new Error(message);
  error.locked = false;
  return error;
}

function adopt(board, mode) {
  state.board = board;
  state.mode = mode;
  state.locked = false;
  state.editing = null;
  state.draft = null;
  state.panel = null;
  if (!Array.isArray(state.board.strokes)) state.board.strokes = [];
  if (!Array.isArray(state.board.calls)) state.board.calls = [];
  render();
}

function httpFailure(status) {
  const error = plainError("Could not save.");
  error.status = status;
  return error;
}

async function attempt(fn) {
  let last = null;
  for (let i = 0; i < 3; i += 1) {
    try {
      return await fn();
    } catch (err) {
      last = err;
      const status = err && err.status;
      if (err && err.locked) throw err;
      if (status && status < 500) throw err;
      if (i < 2) await new Promise((resolve) => setTimeout(resolve, 300 * (i + 1)));
    }
  }
  throw last;
}

function documentReadUrl() {
  // This host caches a bare GET for an hour. A new query reads the latest board.
  const join = PUBLIC_BOARD_URL.includes("?") ? "&" : "?";
  return PUBLIC_BOARD_URL + join + "t=" + Date.now();
}

async function readDocument() {
  return attempt(async () => {
    const res = await fetch(documentReadUrl(), {
      method: "GET",
      cache: "no-store",
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) throw httpFailure(res.status);
    const data = await res.json();
    if (!data || typeof data !== "object" || Array.isArray(data)) throw plainError("Could not save.");
    return validateBoard({
      people: data.people,
      calls: data.calls,
      visit: data.visit || { date: "", place: "" },
      strokes: data.strokes,
    });
  });
}

async function writeDocument(board) {
  if (transport === "server") throw plainError("Could not save.");
  const payload = {
    people: board.people,
    calls: board.calls,
    visit: board.visit || { date: "", place: "" },
    strokes: board.strokes || [],
  };
  await attempt(async () => {
    const res = await fetch(PUBLIC_BOARD_URL, {
      method: "POST",
      cache: "no-store",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) throw httpFailure(res.status);
  });
  return payload;
}

async function readWall() {
  if (transport === "server") return api("/api/board");
  if (transport === "document") return { mode: "shared", board: await readDocument() };
  throw plainError("Could not save.");
}

async function changeShared(mutator) {
  if (transport === "memory") {
    const next = validateBoard(mutator(structuredClone(state.board)));
    return { mode: "memory", board: next };
  }
  if (transport !== "document") throw plainError("Could not save.");
  const remote = await readDocument();
  const next = validateBoard(mutator(structuredClone(remote)));
  await writeDocument(next);
  return { mode: "shared", board: next };
}

async function persistPerson(person) {
  if (transport === "server") return api("/api/people/" + person.id, { method: "PUT", body: person });
  const cleaned = cleanPerson(person, person.id);
  return enqueueSave(() =>
    changeShared((board) => {
      board.people = board.people.map((item) => (item.id === cleaned.id ? cleaned : item));
      return board;
    })
  );
}

async function persistCall(input) {
  if (transport === "server") return api("/api/calls", { method: "POST", body: input });
  const call = cleanCall({ ...input, id: newId() });
  return enqueueSave(() =>
    changeShared((board) => {
      if (board.calls.length >= 20) throw plainError("Take down an old call first.");
      board.calls.push(call);
      return board;
    })
  );
}

function withStroke(board, stroke) {
  const strokes = Array.isArray(board.strokes) ? board.strokes.slice() : [];
  if (strokes.some((item) => item.id === stroke.id)) return board;
  if (strokes.length >= MAX_STROKES) strokes.shift();
  board.strokes = strokes.concat(stroke);
  return board;
}

async function persistStroke(stroke) {
  const cleaned = cleanStroke(stroke);
  if (transport === "server") {
    return enqueueSave(() => api("/api/strokes", { method: "POST", body: cleaned }));
  }
  return enqueueSave(() => changeShared((board) => withStroke(board, cleaned)));
}

async function persistClear() {
  if (transport === "server") return enqueueSave(() => api("/api/strokes", { method: "DELETE" }));
  return enqueueSave(() =>
    changeShared((board) => {
      board.strokes = [];
      return board;
    })
  );
}

async function persistRemoveCall(id) {
  if (transport === "server") return api("/api/calls/" + id, { method: "DELETE" });
  return enqueueSave(() =>
    changeShared((board) => {
      const next = board.calls.filter((call) => call.id !== id);
      if (next.length === board.calls.length) throw plainError("That call is already down.");
      board.calls = next;
      return board;
    })
  );
}

async function load() {
  try {
    const data = await api("/api/board");
    if (!data || !data.board || !Array.isArray(data.board.people)) throw plainError("Could not save.");
    transport = "server";
    adopt(data.board, data.mode);
    return;
  } catch (err) {
    if (err && err.locked) throw err;
  }
  try {
    const board = await readDocument();
    transport = "document";
    adopt(board, "shared");
    return;
  } catch {
    transport = "memory";
    adopt(freshSeed(), "memory");
  }
}

if (phoneMedia) {
  const onPhoneWidth = () => {
    if (!state.board || state.locked) return;
    render();
  };
  if (typeof phoneMedia.addEventListener === "function") phoneMedia.addEventListener("change", onPhoneWidth);
  else if (typeof phoneMedia.addListener === "function") phoneMedia.addListener(onPhoneWidth);
}

load().catch((err) => {
  if (err && err.locked) return;
  const app = document.getElementById("app");
  if (app && !state.board) app.textContent = "The wall didn’t open.";
});

window.addEventListener("resize", () => {
  if (document.getElementById("draw-pad")) resizeCanvas();
});

setInterval(() => {
  if (!state.editing && state.panel !== "call") paintLive();
}, 30000);

function armSync() {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(pullBoard, drawVisible() ? DRAW_POLL_MS : 15000);
}

let pulling = false;

async function pullBoard() {
  if (pulling) return;
  pulling = true;
  clearTimeout(syncTimer);
  try {
    if (transport === "pending" || transport === "memory") return;
    if (state.locked || state.editing || state.active || state.clearing || !state.board) return;
    if (state.panel && state.panel !== "draw") return;
    const data = await readWall();
    data.board.strokes = mergeStrokes(data.board.strokes);
    const same = JSON.stringify(data.board) === JSON.stringify(state.board);
    state.board = data.board;
    state.mode = data.mode;
    if (same) return;
    if (drawVisible() && document.getElementById("draw-pad")) {
      paintStrokes();
      syncClearButton();
      return;
    }
    render();
  } catch {
    // Keep the wall that’s already on screen.
  } finally {
    pulling = false;
    armSync();
  }
}

armSync();
