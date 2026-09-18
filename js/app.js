import { loadData, buildDeck, truth, shuffle } from "./data.js";
import { attachSwipe, verdictFor } from "./swipe.js";

const VERDICTS = { ArrowLeft: "none", ArrowUp: "partial", ArrowRight: "full" };
const FLY = { none: [-1, 0], partial: [0, -1], full: [1, 0] };
const PAUSE = { right: 850, wrong: 2400 };
const STORE_KEY = "aoe2-techquiz.topics";

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
  timer: 0,
};

start();

async function start() {
  state.data = await loadData();
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
  for (const button of document.querySelectorAll(".answer")) {
    button.addEventListener("click", () => answer(button.dataset.verdict));
  }
  document.addEventListener("keydown", onKey);
}

/* ---------- menu ---------- */

function restoreSelection() {
  const saved = JSON.parse(localStorage.getItem(STORE_KEY) || "[]");
  const known = state.data.topics.map((t) => t.id);
  const wanted = saved.filter((id) => known.includes(id));
  state.selected = new Set(wanted.length ? wanted : known.slice(0, 1));
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
      state.selected.has(topic.id) ? state.selected.delete(topic.id) : state.selected.add(topic.id);
      localStorage.setItem(STORE_KEY, JSON.stringify([...state.selected]));
      renderMenu();
    });
    grid.append(tile);
  }

  if (state.data.topics.length > 1) {
    const all = document.createElement("button");
    all.className = "topic";
    all.type = "button";
    all.setAttribute("aria-pressed", String(state.selected.size === state.data.topics.length));
    all.innerHTML = `<img src="${state.data.topics[0].icon}" alt=""><span>Everything</span>
      <small>${state.data.topics.length}</small>`;
    all.addEventListener("click", () => {
      const every = state.data.topics.map((t) => t.id);
      state.selected = new Set(state.selected.size === every.length ? every.slice(0, 1) : every);
      localStorage.setItem(STORE_KEY, JSON.stringify([...state.selected]));
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
  show("game");
  renderCard();
}

function show(name) {
  clearTimeout(state.timer);
  for (const [key, node] of Object.entries(screens)) node.classList.toggle("is-active", key === name);
  if (name === "menu") renderMenu();
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
        <img class="emblem" src="${civ.img}" alt="">
        <div class="judge-badge"></div>
        <div class="options"></div>
        <div class="parts">${partsHtml(topic, fact)}</div>
      </div>
    </div>`;
  stack.append(node);

  attachSwipe(node, {
    onDrag: (dx, dy) => {
      if (state.phase !== "answer") return;
      node.classList.remove("settle");
      node.style.transform = `translate(${dx}px, ${dy}px) rotate(${dx / 20}deg)`;
      arm(verdictFor(dx, dy));
    },
    onRelease: (dx, dy) => {
      if (state.phase !== "answer") return;
      const verdict = verdictFor(dx, dy);
      arm(null);
      if (verdict) return answer(verdict);
      node.classList.add("settle");
      node.style.transform = "";
    },
  });

  renderProgress();
  renderPrompt(topic);
}

function partsHtml(topic, answer) {
  return topic.parts
    .map((part) => {
      const on = answer.has.includes(part.id);
      return `<span class="part ${on ? "on" : "off"}" title="${part.name}">
        <img src="${part.img}" alt="${part.name}">
        <b><svg><use href="#mark-${on ? "right" : "wrong"}"/></svg></b>
      </span>`;
    })
    .join("");
}

function markRow(verdict, wrongGuess) {
  return ["none", "partial", "full"]
    .map((option) => {
      const classes = [
        "mark",
        `is-${option}`,
        option === verdict ? "truth" : "",
        option === wrongGuess ? "yours struck" : "",
      ];
      return `<span class="${classes.join(" ").trim()}"><svg><use href="#mark-${option}"/></svg></span>`;
    })
    .join("");
}

function renderPrompt(topic) {
  el("prompt").innerHTML = topic.parts
    .map((part) => `<img src="${part.img}" alt="${part.name}" title="${part.name}">`)
    .join('<span class="plus">+</span>');
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
  const answered = state.results.filter(Boolean).length;
  const right = state.results.filter((r) => r.right).length;
  el("tally").textContent = answered ? `${right}/${answered}` : "";
}

function arm(verdict) {
  for (const target of document.querySelectorAll(".target")) {
    target.classList.toggle("armed", verdict !== null && target.classList.contains(`is-${verdict}`));
  }
}

function answer(guess) {
  if (state.phase !== "answer") return;
  state.phase = "reveal";

  const card = state.deck[state.index];
  const { topic, answer: fact } = truth(state.data, card);
  const right = guess === fact.verdict;
  state.results[state.index] = { card, guess, verdict: fact.verdict, right };

  const node = el("stack").querySelector(".card:not(.under)");
  const back = node.querySelector(".face.back");
  node.classList.add("settle", "revealed");
  node.style.transform = "";
  back.classList.add(right ? "right" : "wrong");

  back.querySelector(".judge-badge").className = `judge-badge ${right ? "right" : "wrong"}`;
  back.querySelector(".judge-badge").innerHTML = `<svg><use href="#mark-${
    right ? "right" : "wrong"
  }"/></svg>`;
  back.querySelector(".options").innerHTML = markRow(fact.verdict, right ? null : guess);

  renderProgress();
  state.timer = setTimeout(advance, PAUSE[right ? "right" : "wrong"]);
}

function advance() {
  clearTimeout(state.timer);
  if (state.phase !== "reveal") return;

  const node = el("stack").querySelector(".card:not(.under)");
  const [x, y] = FLY[state.results[state.index].verdict];
  node.classList.add("gone");
  node.style.transform = `translate(${x * 120}%, ${y * 120}%) rotate(${x * 18}deg)`;

  state.index += 1;
  state.phase = "between";
  setTimeout(() => {
    if (state.index >= state.deck.length) showResults();
    else renderCard();
  }, 180);
}

/* ---------- results ---------- */

function showResults() {
  const right = state.results.filter((r) => r.right).length;
  el("score").textContent = `${right} / ${state.results.length}`;

  const wrong = state.results.filter((r) => !r.right);
  el("review").innerHTML = [...wrong, ...state.results.filter((r) => r.right)]
    .map((result) => {
      const { civ } = truth(state.data, result.card);
      const yours = result.right
        ? ""
        : `<span class="mark yours struck is-${result.guess}"><svg><use href="#mark-${result.guess}"/></svg></span>`;
      return `<div class="row ${result.right ? "" : "wrong"}">
        <img src="${civ.img}" alt="${civ.name}">
        <div class="pair">${yours}<span class="mark is-${result.verdict}"><svg><use href="#mark-${result.verdict}"/></svg></span></div>
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

  if (state.phase === "reveal") {
    if (event.key === " " || event.key === "Enter" || event.key in VERDICTS) {
      event.preventDefault();
      advance();
    }
    return;
  }

  const verdict = VERDICTS[event.key];
  if (verdict) {
    event.preventDefault();
    answer(verdict);
  }
}
