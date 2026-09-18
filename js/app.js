const { buildDeck, truth, shuffle, attachSwipe, directionFor } = window.Quiz;

const KEYS = { ArrowLeft: "left", ArrowUp: "up", ArrowRight: "right", ArrowDown: "down" };
const FLY = { left: [-1, 0], up: [0, -1], right: [1, 0], down: [0, 1] };
const STORE_KEY = "aoe2-techquiz.topics";

// An upgrade you leave alone and the civ has is worth nothing: only a claim
// scores, or doing nothing would be the safe way to play.
const POINTS = { tier: 1, spotted: 1, falsely: -1, missed: -1 };

const el = (id) => document.getElementById(id);
const screens = { menu: el("menu"), game: el("game"), results: el("results") };

const state = {
  data: null,
  selected: new Set(),
  deck: [],
  // the set as it was chosen on the menu, so "repeat the full set" still means
  // that after a round of only the wrong ones
  fullDeck: [],
  index: 0,
  results: [],
  phase: "answer",
  score: 0,
  picked: {},
  timer: 0,
};

start();

function start() {
  state.data = window.QUIZ_DATA;
  if (!state.data || !state.data.topics || !state.data.topics.length) {
    el("topic-grid").innerHTML =
      '<p class="lede">data/topics.js did not load. Run <code>python tools/build_data.py</code>.</p>';
    return;
  }
  restoreSelection();
  renderMenu();

  el("start").addEventListener("click", () =>
    beginRound(buildDeck(state.data, [...state.selected]), true)
  );
  el("quit").addEventListener("click", () => show("menu"));
  el("to-menu").addEventListener("click", () => show("menu"));
  el("again-all").addEventListener("click", () => beginRound(shuffle(state.fullDeck), true));
  el("again-wrong").addEventListener("click", () =>
    beginRound(shuffle(state.results.filter((r) => !r.right).map((r) => r.card)), false)
  );
  el("pad").addEventListener("click", (event) => {
    const button = event.target.closest(".answer");
    if (button) answer(button.dataset.dir);
  });
  el("picker-grid").addEventListener("click", (event) => {
    const button = event.target.closest(".upgrade");
    if (button) pick(button.dataset.id);
  });
  el("picker-done").addEventListener("click", finishPicks);
  // a revealed card waits for you: anything but the hud moves it on
  screens.game.addEventListener("pointerdown", (event) => {
    if (state.phase === "reveal" && !event.target.closest(".hud")) advance();
  });
  document.addEventListener("keydown", onKey);
}

/* ---------- menu ---------- */

function restoreSelection() {
  let saved = [];
  try {
    saved = JSON.parse(localStorage.getItem(STORE_KEY) || "[]");
  } catch (ignored) {
    saved = [];
  }
  const known = state.data.topics.map((t) => t.id);
  const wanted = Array.isArray(saved) ? saved.filter((id) => known.includes(id)) : [];
  state.selected = new Set(wanted.length ? wanted : known.slice(0, 1));
}

function rememberSelection() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify([...state.selected]));
  } catch (ignored) {
    /* private mode, or opened off disk */
  }
}

function renderMenu() {
  const grid = el("topic-grid");
  grid.innerHTML = "";

  for (const topic of state.data.topics) {
    const tile = document.createElement("button");
    tile.className = "topic";
    tile.type = "button";
    tile.setAttribute("aria-pressed", String(state.selected.has(topic.id)));
    tile.innerHTML = `<img src="${topic.icon}" alt=""><span>${topic.name}</span>
      <small>${Object.keys(topic.civs).length}</small>`;
    tile.addEventListener("click", () => {
      if (!state.selected.has(topic.id)) state.selected.add(topic.id);
      else if (state.selected.size > 1) state.selected.delete(topic.id);
      else return; // turning the last one off would leave nothing to play
      rememberSelection();
      renderMenu();
    });
    grid.append(tile);
  }

  if (state.data.topics.length > 1) {
    const all = document.createElement("button");
    all.className = "topic";
    all.type = "button";
    all.setAttribute("aria-pressed", String(state.selected.size === state.data.topics.length));
    const mosaic = state.data.topics
      .slice(0, 4)
      .map((topic) => `<img src="${topic.icon}" alt="">`)
      .join("");
    all.innerHTML = `<span class="mosaic">${mosaic}</span><span>Everything</span>
      <small>${state.data.topics.length}</small>`;
    all.addEventListener("click", () => {
      const every = state.data.topics.map((t) => t.id);
      state.selected = new Set(state.selected.size === every.length ? every.slice(0, 1) : every);
      rememberSelection();
      renderMenu();
    });
    grid.append(all);
  }

  const size = buildDeck(state.data, [...state.selected]).length;
  el("start").disabled = size === 0;
  el("start-count").textContent = size ? `${size}` : "";
}

/* ---------- round ---------- */

function beginRound(cards, isFullSet) {
  if (!cards.length) return;
  state.deck = cards;
  if (isFullSet) state.fullDeck = cards;
  state.index = 0;
  state.results = [];
  state.score = 0;
  el("score-now").textContent = "0";
  show("game");
  renderCard();
}

function show(name) {
  clearTimeout(state.timer);
  closePicker();
  for (const [key, node] of Object.entries(screens)) node.classList.toggle("is-active", key === name);
  if (name === "menu") renderMenu();
}

function bumpScore(delta) {
  state.score += delta;
  el("score-now").textContent = `${state.score}`;

  const flash = el("delta");
  flash.textContent = delta > 0 ? `+${delta}` : `${delta}`;
  flash.className = `delta ${delta >= 0 ? "up" : "down"}`;
  void flash.offsetWidth; // restart the animation on a repeated delta
  flash.classList.add("show");
}

function renderCard() {
  const stack = el("stack");
  const card = state.deck[state.index];
  const { topic, civ, answer: fact } = truth(state.data, card);
  state.phase = "answer";

  stack.innerHTML = "";
  if (state.index + 1 < state.deck.length) {
    const under = document.createElement("div");
    under.className = "card under";
    under.innerHTML = `<div class="card-inner"><div class="face front"></div></div>`;
    stack.append(under);
    new Image().src = state.data.civs[state.deck[state.index + 1].civId].img;
  }

  const node = document.createElement("div");
  node.className = "card";
  node.innerHTML = `
    <div class="card-inner">
      <div class="face front">
        <div class="topic-chip"><img src="${topic.icon}" alt="${topic.name}"></div>
        <img class="emblem" src="${civ.img}" alt="${civ.name}">
        <div class="civ-name">${civ.name}</div>
      </div>
      <div class="face back">
        <div class="card-delta"></div>
        <div class="judge-badge"></div>
        <img class="emblem" src="${civ.img}" alt="">
        <div class="options"></div>
        <div class="parts">${partsHtml(topic, fact, null)}</div>
        <div class="next-hint">
          <svg><use href="#icon-play"/></svg><svg><use href="#icon-play"/></svg>
        </div>
      </div>
    </div>`;
  stack.append(node);

  attachSwipe(node, {
    onDrag: (dx, dy) => {
      if (state.phase !== "answer") return;
      node.classList.remove("settle");
      node.style.transform = `translate(${dx}px, ${dy}px) rotate(${dx / 20}deg)`;
      arm(directionFor(dx, dy));
    },
    onRelease: (dx, dy) => {
      if (state.phase !== "answer") return;
      const direction = directionFor(dx, dy);
      arm(null);
      if (direction && tierAt(topic, direction)) return answer(direction);
      node.classList.add("settle");
      node.style.transform = "";
    },
  });

  renderProgress();
  renderPad(topic);
}

function tierAt(topic, direction) {
  return topic.tiers.find((tier) => tier.dir === direction);
}

function tierById(topic, id) {
  return topic.tiers.find((tier) => tier.id === id);
}

/* The pad is the only place that says what a direction means, so it is drawn
   per topic: the arrow, the mark, and the parts that direction claims. */
function renderPad(topic) {
  const pad = el("pad");
  pad.className = `pad${tierAt(topic, "down") ? "" : " no-down"}`;
  pad.innerHTML =
    topic.tiers
      .map(
        (tier, index) => `<button class="answer is-${tier.mark}" data-dir="${tier.dir}"
          title="${padTitle(topic, index)}">
          <svg class="arrow"><use href="#arrow-${tier.dir}"/></svg>
          <span class="mark is-${tier.mark}"><svg><use href="#mark-${tier.mark}"/></svg></span>
          <span class="mini">${miniHtml(topic, index)}</span>
        </button>`
      )
      .join("") + `<span class="pad-topic"><img src="${topic.icon}" alt="${topic.name}"></span>`;
}

// A rung is "at least this much, and not all of the next one". One part short
// of the next rung is a definite gap; two or more is only "not all of these",
// and the bottom rung is a catch-all, so it claims nothing.
function rungParts(topic, index) {
  const has = topic.tiers[index].has;
  const next = topic.tiers[index + 1] ? topic.tiers[index + 1].has : [];
  const missing = next.filter((id) => !has.includes(id));
  const vague = has.length > 0 && missing.length > 1;
  return topic.parts.map((part) => ({
    part,
    state: has.includes(part.id) ? "on" : vague && missing.includes(part.id) ? "some" : "off",
  }));
}

function miniHtml(topic, index) {
  return rungParts(topic, index)
    .map(
      ({ part, state }) =>
        `<span class="${state}" title="${part.name}"><img src="${part.img}" alt=""></span>`
    )
    .join("");
}

function padTitle(topic, index) {
  const rows = rungParts(topic, index);
  const named = (state) => rows.filter((r) => r.state === state).map((r) => r.part.name);
  const on = named("on");

  if (!on.length) {
    const next = topic.tiers[index + 1];
    const wanted = next
      ? topic.parts.filter((p) => next.has.includes(p.id)).map((p) => p.name)
      : [topic.name];
    return `not even ${wanted.join(" + ")}`;
  }
  const some = named("some");
  if (some.length) return `${on.join(", ")} — but not all of: ${some.join(", ")}`;
  const off = named("off");
  return off.length ? `${on.join(", ")} — no ${off.join(", ")}` : on.join(", ");
}

/* The civ's own row, ringed with how your picks did when the picker ran. */
function partsHtml(topic, answer, picks) {
  return topic.parts
    .map((part) => {
      const on = answer.has.includes(part.id);
      return `<span class="part ${on ? "on" : "off"} ${pickOutcome(part, picks)}"
        title="${part.name}">
        <img src="${part.img}" alt="${part.name}">
        <b><svg><use href="#mark-${on ? "right" : "wrong"}"/></svg></b>
      </span>`;
    })
    .join("");
}

function pickOutcome(part, picks) {
  return picks ? picks[part.id] || "" : "";
}

function markRow(topic, truthId, wrongId) {
  return topic.tiers
    .map((tier) => {
      const classes = [
        "mark",
        `is-${tier.mark}`,
        tier.id === truthId ? "truth" : "",
        tier.id === wrongId ? "yours struck" : "",
      ];
      return `<span class="${classes.join(" ").trim()}"><svg><use href="#mark-${
        tier.mark
      }"/></svg></span>`;
    })
    .join("");
}

function renderProgress() {
  const bar = el("progress");
  bar.innerHTML = "";
  state.deck.forEach((_, i) => {
    const tick = document.createElement("i");
    const done = state.results[i];
    tick.className = done ? (done.right ? "right" : "wrong") : i === state.index ? "now" : "";
    bar.append(tick);
  });
}

function arm(direction) {
  for (const button of el("pad").querySelectorAll(".answer")) {
    button.classList.toggle("armed", button.dataset.dir === direction);
  }
}

function answer(direction) {
  if (state.phase !== "answer") return;

  const card = state.deck[state.index];
  const { topic, answer: fact } = truth(state.data, card);
  const guess = tierAt(topic, direction);
  if (!guess) return;

  const right = guess.id === fact.tier;
  state.results[state.index] = {
    card,
    guess: guess.id,
    tier: fact.tier,
    right,
    delta: right ? POINTS.tier : -POINTS.tier,
    picks: null,
  };
  arm(null);
  bumpScore(right ? POINTS.tier : -POINTS.tier);
  renderProgress();

  // saying "partial" is only half an answer: which upgrades are missing?
  if (guess.id === "partial" && topic.upgrades.length > 1) openPicker();
  else reveal();
}

/* ---------- which upgrades is it missing? ---------- */

function openPicker() {
  const { topic, civ } = truth(state.data, state.deck[state.index]);
  state.phase = "picking";
  state.picked = {};

  el("picker-civ").src = civ.img;
  el("picker-topic").src = topic.icon;
  el("picker-grid").innerHTML = topic.upgrades
    .map((id) => {
      const part = topic.parts.find((p) => p.id === id);
      return `<button class="upgrade" data-id="${id}" title="${part.name}">
        <img src="${part.img}" alt="${part.name}">
        <b class="verdict"></b>
      </button>`;
    })
    .join("");
  el("picker").classList.add("is-open");
  el("pad").classList.add("dim");
}

function closePicker() {
  el("picker").classList.remove("is-open");
  el("pad").classList.remove("dim");
}

/* Naming an upgrade is a claim, answered on the spot and not taken back. */
function pick(id) {
  if (state.phase !== "picking" || state.picked[id]) return;
  const { topic, answer: fact } = truth(state.data, state.deck[state.index]);

  const missing = fact.missing.includes(id);
  const outcome = missing ? "spotted" : "falsely";
  state.picked[id] = outcome;
  state.results[state.index].delta += missing ? POINTS.spotted : POINTS.falsely;
  bumpScore(missing ? POINTS.spotted : POINTS.falsely);

  const button = el("picker-grid").querySelector(`[data-id="${id}"]`);
  button.classList.add(outcome, "done");
  button.querySelector(".verdict").innerHTML = `<svg><use href="#mark-${
    missing ? "right" : "wrong"
  }"/></svg>`;

  if (topic.upgrades.every((upgrade) => state.picked[upgrade])) finishPicks();
}

// what you never named: the ones you missed
function finishPicks() {
  if (state.phase !== "picking") return;
  const { topic, answer: fact } = truth(state.data, state.deck[state.index]);

  let delta = 0;
  for (const id of fact.missing) {
    if (state.picked[id]) continue;
    state.picked[id] = "missed";
    delta += POINTS.missed;
  }

  const result = state.results[state.index];
  result.picks = state.picked;
  result.delta += delta;
  if (delta) bumpScore(delta);
  closePicker();
  reveal();
}

function reveal() {
  const { topic, answer: fact } = truth(state.data, state.deck[state.index]);
  const result = state.results[state.index];
  state.phase = "reveal";

  const node = el("stack").querySelector(".card:not(.under)");
  const back = node.querySelector(".face.back");
  node.classList.add("settle", "revealed");
  node.style.transform = "";
  back.classList.add(result.right ? "right" : "wrong");

  const verdict = result.right ? "right" : "wrong";
  back.querySelector(".judge-badge").className = `judge-badge ${verdict}`;
  back.querySelector(".judge-badge").innerHTML = `<svg><use href="#mark-${verdict}"/></svg>`;
  back.querySelector(".options").innerHTML = markRow(
    topic,
    fact.tier,
    result.right ? null : result.guess
  );
  back.querySelector(".parts").innerHTML = partsHtml(topic, fact, result.picks);
  const delta = back.querySelector(".card-delta");
  delta.className = `card-delta ${result.delta >= 0 ? "up" : "down"}`;
  delta.textContent = result.delta > 0 ? `+${result.delta}` : `${result.delta}`;

  renderProgress();
}

function advance() {
  if (state.phase !== "reveal") return;

  const node = el("stack").querySelector(".card:not(.under)");
  const { topic } = truth(state.data, state.deck[state.index]);
  const [x, y] = FLY[tierById(topic, state.results[state.index].tier).dir];
  node.classList.add("gone");
  node.style.transform = `translate(${x * 120}%, ${y * 120}%) rotate(${x * 18}deg)`;

  state.index += 1;
  state.phase = "between";
  state.timer = setTimeout(() => {
    if (state.index >= state.deck.length) showResults();
    else renderCard();
  }, 180);
}

/* ---------- results ---------- */

function showResults() {
  const right = state.results.filter((r) => r.right).length;
  el("final-score").textContent = state.score > 0 ? `+${state.score}` : `${state.score}`;
  el("final-tally").textContent = `${right} / ${state.results.length}`;

  const wrong = state.results.filter((r) => !r.right);
  el("review").innerHTML = [...wrong, ...state.results.filter((r) => r.right)]
    .map((result) => {
      const { topic, civ } = truth(state.data, result.card);
      const shown = tierById(topic, result.tier).mark;
      const yourMark = result.right ? null : tierById(topic, result.guess).mark;
      const yours = result.right
        ? ""
        : `<span class="mark yours struck is-${yourMark}"><svg><use href="#mark-${yourMark}"/></svg></span>`;
      return `<div class="row ${result.right ? "right" : "wrong"}">
        <span class="judge"><svg><use href="#mark-${result.right ? "right" : "wrong"}"/></svg></span>
        <img src="${civ.img}" alt="${civ.name}">
        <div class="pair">${yours}<span class="mark is-${shown}"><svg><use href="#mark-${shown}"/></svg></span></div>
        <em>${civ.name}</em>
      </div>`;
    })
    .join("");

  el("again-wrong").disabled = wrong.length === 0;
  el("wrong-count").textContent = wrong.length ? `${wrong.length}` : "0";
  el("all-count").textContent = `${state.deck.length}`;
  show("results");
}

/* ---------- keyboard ---------- */

function onKey(event) {
  if (event.metaKey || event.ctrlKey || event.altKey) return;

  if (screens.results.classList.contains("is-active")) {
    if (event.key === "Enter") el(el("again-wrong").disabled ? "again-all" : "again-wrong").click();
    if (event.key === "Escape") show("menu");
    return;
  }

  if (screens.menu.classList.contains("is-active")) {
    if (event.key === "Enter" && !el("start").disabled) el("start").click();
    return;
  }

  if (event.key === "Escape") return show("menu");

  if (state.phase === "picking") {
    const slot = Number(event.key);
    const upgrades = truth(state.data, state.deck[state.index]).topic.upgrades;
    if (slot >= 1 && slot <= upgrades.length) {
      event.preventDefault();
      return pick(upgrades[slot - 1]);
    }
    if (event.key === "Enter" || event.key === " " || event.key === "ArrowRight") {
      event.preventDefault();
      finishPicks();
    }
    return;
  }

  if (state.phase === "reveal") {
    if (["Shift", "Control", "Alt", "Meta", "Tab"].includes(event.key)) return;
    event.preventDefault();
    advance();
    return;
  }

  const direction = KEYS[event.key];
  if (direction) {
    event.preventDefault();
    answer(direction);
  }
}
