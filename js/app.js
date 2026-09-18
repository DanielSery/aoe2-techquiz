const { buildDeck, truth, shuffle, attachSwipe, directionFor } = window.Quiz;

const KEYS = { ArrowLeft: "left", ArrowUp: "up", ArrowRight: "right", ArrowDown: "down" };
const FLY = { left: [-1, 0], up: [0, -1], right: [1, 0], down: [0, 1] };
const STORE_KEY = "aoe2-techquiz.topics";
const MODE_KEY = "aoe2-techquiz.mode";
const MODES = ["single", "custom", "all"];

// Where the upgrades sit in the picker, and so which arrows reach them: the
// four sides first, then the corners, which take two arrows at once.
// Right is where done sits, so it is not an upgrade slot: seven are left.
const SLOTS = ["left", "up", "down", "up-left", "up-right", "down-left", "down-right"];
const DIAGONAL_WAIT = 90; // ms to see whether a second arrow is on its way

// Naming the direction is the question; the rest are worth what they cost to
// find out. An upgrade you leave alone and the civ has is worth nothing: only a
// claim scores, or doing nothing would be the safe way to play.
const POINTS = {
  tier: 100,
  tierWrong: -20,
  spotted: 10,
  falsely: -10,
  missed: -10,
  bonus: 20,
  bonusWrong: -20,
};

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
  bonus: null,
  mode: "single",
  held: new Set(),
  heldTimer: 0,
  heldSpent: false,
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
    if (event.target.closest("#picker-done")) return finishPicks();
    const upgrade = event.target.closest(".upgrade");
    if (upgrade) return pick(upgrade.dataset.id);
    const button = event.target.closest(".answer");
    if (!button) return;
    if (button.dataset.bonus) claimBonus();
    else answer(button.dataset.dir);
  });
  // a revealed card waits for you: anything but the hud moves it on
  screens.game.addEventListener("pointerdown", (event) => {
    if (state.phase === "reveal" && !event.target.closest(".hud")) advance();
  });
  el("modes").addEventListener("click", (event) => {
    const button = event.target.closest(".mode");
    if (button) setMode(button.dataset.mode);
  });
  document.addEventListener("keydown", onKey);
  document.addEventListener("keyup", onKeyUp);
}

/* ---------- menu ---------- */

function restoreSelection() {
  let saved = [];
  try {
    saved = JSON.parse(localStorage.getItem(STORE_KEY) || "[]");
    const mode = localStorage.getItem(MODE_KEY);
    if (MODES.includes(mode)) state.mode = mode;
  } catch (ignored) {
    saved = [];
  }
  const known = state.data.topics.map((t) => t.id);
  const wanted = Array.isArray(saved) ? saved.filter((id) => known.includes(id)) : [];
  state.selected = new Set(wanted.length ? wanted : known.slice(0, 1));
  applyMode();
}

function rememberSelection() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify([...state.selected]));
    localStorage.setItem(MODE_KEY, state.mode);
  } catch (ignored) {
    /* private mode, or opened off disk */
  }
}

// Single keeps one topic, All takes every one, Custom leaves the choice alone.
function applyMode() {
  if (state.mode === "all") state.selected = new Set(state.data.topics.map((t) => t.id));
  else if (state.mode === "single" && state.selected.size > 1) {
    state.selected = new Set([[...state.selected][0]]);
  }
}

function setMode(mode) {
  if (!MODES.includes(mode)) return;
  state.mode = mode;
  applyMode();
  rememberSelection();
  renderMenu();
}

/* A tile toggles only in Custom; anywhere else picking one is picking it alone. */
function chooseTopic(id) {
  if (state.mode === "custom") {
    if (!state.selected.has(id)) state.selected.add(id);
    else if (state.selected.size > 1) state.selected.delete(id);
    else return;
  } else {
    state.mode = "single";
    state.selected = new Set([id]);
  }
  rememberSelection();
  renderMenu();
}

function renderMenu() {
  const grid = el("topic-grid");
  grid.innerHTML = "";

  // one section per building, in the order the topics are declared
  const groups = [];
  for (const topic of state.data.topics) {
    const group = groups.find((g) => g.name === topic.group);
    if (group) group.topics.push(topic);
    else groups.push({ name: topic.group, topics: [topic] });
  }

  for (const group of groups) {
    const section = document.createElement("section");
    section.className = "group";
    section.innerHTML = `<h2>${group.name}</h2><div class="tiles"></div>`;
    const tiles = section.querySelector(".tiles");
    for (const topic of group.topics) {
      const tile = document.createElement("button");
      tile.className = "topic";
      tile.type = "button";
      tile.setAttribute("aria-pressed", String(state.selected.has(topic.id)));
      tile.title = `${topic.name} — ${Object.keys(topic.civs).length} civilisations`;
      tile.setAttribute("aria-label", topic.name);
      tile.innerHTML = `<img src="${topic.icon}" alt="${topic.name}">`;
      tile.addEventListener("click", () => chooseTopic(topic.id));
      tiles.append(tile);
    }
    grid.append(section);
  }

  for (const button of el("modes").querySelectorAll(".mode")) {
    button.setAttribute("aria-pressed", String(button.dataset.mode === state.mode));
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
  clearScoreEffects();
  show("game");
  renderCard();
}

function show(name) {
  clearTimeout(state.timer);
  closePicker();
  for (const [key, node] of Object.entries(screens)) node.classList.toggle("is-active", key === name);
  if (name === "menu") renderMenu();
}

function clearScoreEffects() {
  el("delta").className = "delta";
  el("delta").textContent = "";
  el("burst").className = "burst";
  el("burst").textContent = "";
  el("score-now").classList.remove("bumped");
}

function bumpScore(delta) {
  state.score += delta;
  const counter = el("score-now");
  counter.textContent = `${state.score}`;

  const sign = delta > 0 ? `+${delta}` : `${delta}`;
  const flash = el("delta");
  flash.textContent = sign;
  flash.className = `delta ${delta >= 0 ? "up" : "down"}`;

  const burst = el("burst");
  burst.textContent = sign;
  burst.className = `burst ${delta >= 0 ? "up" : "down"}`;

  // the classes have to leave the elements for the animations to run again
  counter.classList.remove("bumped");
  void counter.offsetWidth;
  counter.classList.add("bumped");
  flash.classList.add("show");
  burst.classList.add("show");
}

function renderCard() {
  const stack = el("stack");
  const card = state.deck[state.index];
  const { topic, civ, answer: fact } = truth(state.data, card);
  state.phase = "answer";
  state.bonus = null;

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
        <div class="bonus-slot"></div>
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
      if (direction === "down") claimBonus();
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
  pad.className = "pad";
  pad.innerHTML =
    topic.tiers
      .map(
        (tier, index) => `<button class="answer is-${tier.mark}" data-dir="${tier.dir}"
          title="${padTitle(topic, index)}">
          <svg class="arrow"><use href="#arrow-${tier.dir}"/></svg>
          <span class="mini">${miniHtml(topic, index)}</span>
        </button>`
      )
      .join("") +
    `<button class="answer is-bonus" data-dir="down" data-bonus="1"
       title="a civ bonus, team bonus or unique tech about this unit">
      <svg class="arrow"><use href="#arrow-down"/></svg>
      <svg><use href="#icon-star"/></svg>
    </button>
    <span class="pad-topic"><img src="${topic.icon}" alt="${topic.name}"></span>`;
}

/* The bonus is a side bet: it scores at once and leaves the card where it is. */
function claimBonus() {
  if (state.phase !== "answer" || state.bonus) return;
  const { answer: fact } = truth(state.data, state.deck[state.index]);
  const right = Boolean(fact.bonus);
  state.bonus = { right, delta: right ? POINTS.bonus : POINTS.bonusWrong };
  bumpScore(state.bonus.delta);

  const button = el("pad").querySelector(".answer.is-bonus");
  button.classList.add(right ? "spotted" : "falsely");
  button.querySelector("svg:last-child").innerHTML =
    `<use href="#mark-${right ? "right" : "wrong"}"/>`;
}

// A rung is "at least this much, and not all of the next one". One part short
// of the next rung is a definite gap; two or more is only "not all of these",
// and the bottom rung is a catch-all, so it claims nothing.
function rungParts(topic, index) {
  const has = topic.tiers[index].has;
  const next = topic.tiers[index + 1] ? topic.tiers[index + 1].has : [];
  const missing = next.filter((id) => !has.includes(id));
  const vague = index > 0 && missing.length > 1;
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
  const some = named("some");
  const off = named("off");

  if (index === 0) {
    // the bottom rung is "not even the one above"; with no gate unit that is
    // every part the topic names
    const above = topic.tiers[1].has;
    const wanted = topic.parts
      .filter((part) => !above.length || above.includes(part.id))
      .map((part) => part.name);
    return `not even ${wanted.join(" + ")}`;
  }
  if (!on.length) return `some of: ${some.join(", ")}`;
  if (some.length) return `${on.join(", ")} — but not all of: ${some.join(", ")}`;
  return off.length ? `${on.join(", ")} — no ${off.join(", ")}` : on.join(", ");
}

/* Which of a slot's alternatives this civ actually fields; the others are not
   gaps, so the reveal leaves them out unless the civ has none of them. */
function shownAlt(topic, key, answer) {
  const group = (topic.alts || {})[key] || [key];
  return group.find((id) => answer.has.includes(id)) || null;
}

function groupKey(topic, partId) {
  const alts = topic.alts || {};
  return Object.keys(alts).find((key) => alts[key].includes(partId)) || partId;
}

/* The civ's own row, ringed with how your picks did when the picker ran. */
function partsHtml(topic, answer, picks) {
  const alts = topic.alts || {};
  const fielded = new Set(
    Object.keys(alts)
      .map((key) => shownAlt(topic, key, answer))
      .filter(Boolean)
  );
  const alternatives = new Set(Object.values(alts).flat());
  return topic.parts
    .filter((part) => {
      if (!alternatives.has(part.id)) return true;
      const key = groupKey(topic, part.id);
      const shown = shownAlt(topic, key, answer);
      return shown ? fielded.has(part.id) : true;
    })
    .map((part) => {
      const on = answer.has.includes(part.id);
      return `<span class="part ${on ? "on" : "off"} ${pickOutcome(part, picks, topic)}"
        title="${part.name}">
        <img src="${part.img}" alt="${part.name}">
        <b><svg><use href="#mark-${on ? "right" : "wrong"}"/></svg></b>
      </span>`;
    })
    .join("");
}

function pickOutcome(part, picks, topic) {
  return picks ? picks[groupKey(topic, part.id)] || "" : "";
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
    delta: (right ? POINTS.tier : POINTS.tierWrong) + (state.bonus ? state.bonus.delta : 0),
    picks: null,
    bonus: state.bonus,
  };
  arm(null);
  bumpScore(right ? POINTS.tier : POINTS.tierWrong);
  renderProgress();

  // saying "partial" is only half an answer -- but only when it was the answer
  if (right && guess.id === "partial" && topic.upgrades.length > 1) openPicker();
  else reveal();
}

/* ---------- which upgrades is it missing? ---------- */

/* The follow-up takes over the pad, so the answers and the upgrades are asked
   in the same place, and done sits where "has it all" was. */
function openPicker() {
  const { topic } = truth(state.data, state.deck[state.index]);
  state.phase = "picking";
  state.picked = {};
  state.held.clear();
  state.heldSpent = false;
  clearTimeout(state.heldTimer);

  const pad = el("pad");
  pad.className = "pad picking";
  pad.innerHTML =
    topic.upgrades
      .map((id, index) => {
        const fact = truth(state.data, state.deck[state.index]).answer;
        const shown = shownAlt(topic, id, fact) || id;
        const part = topic.parts.find((p) => p.id === shown);
        const slot = SLOTS[index];
        return `<button class="upgrade" data-id="${id}" data-slot="${slot}"
          style="grid-area: ${slot}" title="${part.name}">
          <img src="${part.img}" alt="${part.name}">
          <svg class="dir dir-${slot}"><use href="#arrow-up"/></svg>
          <b class="verdict"></b>
        </button>`;
      })
      .join("") +
    `<button id="picker-done" class="done" title="that is all of them">
      <svg class="arrow"><use href="#arrow-right"/></svg>
      <svg><use href="#mark-right"/></svg>
    </button>
    <span class="pad-topic"><img src="${topic.icon}" alt="${topic.name}"></span>`;
}

function closePicker() {
  const pad = el("pad");
  if (!pad.classList.contains("picking")) return;
  const card = state.deck[state.index];
  if (card) renderPad(truth(state.data, card).topic);
  else pad.className = "pad";
}

function slotDirection(held) {
  const up = held.has("up");
  const down = held.has("down");
  const left = held.has("left");
  const right = held.has("right");
  const vertical = up ? "up" : down ? "down" : "";
  const horizontal = left ? "left" : right ? "right" : "";
  if (vertical && horizontal) return `${vertical}-${horizontal}`;
  return vertical || horizontal || null;
}

function pickAt(slot) {
  if (slot === "right") return finishPicks();
  const button = el("pad").querySelector(`.upgrade[data-slot="${slot}"]`);
  if (button) pick(button.dataset.id);
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

  const button = el("pad").querySelector(`.upgrade[data-id="${id}"]`);
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

/* the civ's bonus, and whether the side bet came off */
function bonusHtml(fact, claimed) {
  if (!fact.bonus && !claimed) return "";
  const said = claimed
    ? `<svg class="said ${claimed.right ? "right" : "wrong"}"><use href="#mark-${
        claimed.right ? "right" : "wrong"
      }"/></svg>`
    : "";
  const why = fact.bonus ? (fact.why || []).join(" • ") : "no bonus for this one";
  return `<div class="bonus-note"><svg><use href="#icon-star"/></svg>${said}<span>${why}</span></div>`;
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
  back.querySelector(".bonus-slot").innerHTML = bonusHtml(fact, result.bonus);
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
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      return finishPicks();
    }
    const direction = KEYS[event.key];
    if (!direction) return;
    event.preventDefault();
    if (event.repeat || state.heldSpent) return;

    // a corner is two arrows at once, so wait a moment for the second
    state.held.add(direction);
    clearTimeout(state.heldTimer);
    state.heldTimer = setTimeout(() => {
      const slot = slotDirection(state.held);
      state.heldSpent = true;
      if (slot) pickAt(slot);
    }, DIAGONAL_WAIT);
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
    if (direction === "down") claimBonus();
    else answer(direction);
  }
}

// the arrows for a corner are released one at a time; only a clean release
// arms the next pick
function onKeyUp(event) {
  const direction = KEYS[event.key];
  if (!direction) return;
  state.held.delete(direction);
  if (!state.held.size) {
    clearTimeout(state.heldTimer);
    state.heldSpent = false;
  }
}
