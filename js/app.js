const { buildDeck, truth, shuffle } = window.Quiz;

const STORE_KEY = "aoe2-techquiz.topics";
const MODE_KEY = "aoe2-techquiz.mode";
const SIZE_KEY = "aoe2-techquiz.size";
const MODES = ["single", "custom", "all"];

// how long a revealed card waits before it deals the next one itself
const AUTO_NEXT_MS = 5000;

// Two claims that are not upgrades and sit with the actions rather than on the
// board: the civ's bonus, and "it cannot build this at all". The bonus is part
// of the answer; the other is a shortcut that says the answer is nothing.
const BONUS_ID = "bonus";
const NO_UNIT_ID = "no-unit";

// Naming every upgrade and nothing else is the question; the rest are worth
// what they cost to find out. An upgrade you leave alone and the civ has is
// worth nothing: only a claim scores, or doing nothing would be the safe way to
// play.
const POINTS = {
  tier: 100,
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
  mode: "single",
  // how many questions a round asks; null is "all of them", and stays all when
  // the topics change under it
  limit: null,
  timer: 0,
  wait: 0,
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

  el("start").addEventListener("click", () => beginRound(deckToPlay(), true));
  el("quit").addEventListener("click", () => show("menu"));
  el("to-menu").addEventListener("click", () => show("menu"));
  el("again-all").addEventListener("click", () => beginRound(shuffle(state.fullDeck), true));
  el("again-wrong").addEventListener("click", () =>
    beginRound(
      shuffle(state.results.filter((result) => !wasRight(result)).map((result) => result.card)),
      false
    )
  );
  el("pad").addEventListener("click", (event) => {
    if (event.target.closest("#picker-done")) return finishPicks();
    if (event.target.closest("#claim-all")) return claimAll();
    const act = event.target.closest(".act[data-claim]");
    if (act) return pick(act.dataset.claim);
    const upgrade = event.target.closest(".upgrade");
    if (upgrade) pick(upgrade.dataset.id);
  });
  // a revealed card waits for you: anything but the hud moves it on
  screens.game.addEventListener("pointerdown", (event) => {
    if (state.phase === "reveal" && !event.target.closest(".hud")) advance();
  });
  el("modes").addEventListener("click", (event) => {
    const button = event.target.closest(".mode");
    if (button) setMode(button.dataset.mode);
  });
  // dragging must not redraw the menu under the thumb, so it only moves the count
  el("size").addEventListener("input", (event) => {
    const size = Number(event.target.value);
    state.limit = size >= Number(event.target.max) ? null : size;
    showSize(size);
  });
  el("size").addEventListener("change", rememberSelection);
  document.addEventListener("keydown", onKey);
}

/* ---------- menu ---------- */

function restoreSelection() {
  let saved = [];
  try {
    saved = JSON.parse(localStorage.getItem(STORE_KEY) || "[]");
    const mode = localStorage.getItem(MODE_KEY);
    if (MODES.includes(mode)) state.mode = mode;
    const size = Number(localStorage.getItem(SIZE_KEY));
    state.limit = size > 0 ? size : null;
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
    localStorage.setItem(SIZE_KEY, state.limit === null ? "" : String(state.limit));
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
      tile.innerHTML = tileHtml(topic);
      tile.addEventListener("click", () => chooseTopic(topic.id));
      tiles.append(tile);
    }
    grid.append(section);
  }

  for (const button of el("modes").querySelectorAll(".mode")) {
    button.setAttribute("aria-pressed", String(button.dataset.mode === state.mode));
  }
  const whole = deckNow().length;
  const slider = el("size");
  slider.max = String(Math.max(whole, 1));
  slider.disabled = whole < 2;
  const asking = state.limit === null ? whole : Math.min(state.limit, whole);
  slider.value = String(Math.max(asking, 1));
  el("start").disabled = whole === 0;
  showSize(whole ? asking : 0);
  markScrollable(grid);
}

/* The scrollbar is hidden, so a menu taller than the screen looks like the
   whole menu: nineteen topics in seven sections do not fit a short phone, and a
   section below the fold is a topic you cannot know is there. The fade is the
   only thing that says to keep going. */
function markScrollable(grid) {
  requestAnimationFrame(() => {
    grid.classList.toggle("can-scroll", grid.scrollHeight - grid.clientHeight > 2);
  });
}

/* A topic that asks about more than one unit wears them all, one slanted band
   each: the tile is the only thing you see before you start, and a single icon
   cannot say that the Gurjaras will be asked about an Elephant Archer. */
function tileHtml(topic) {
  return splitHtml(tileUnits(topic), topic.name);
}

/* One icon, or all of them sharing the space. */
function splitHtml(images, alt = "") {
  if (images.length < 2) return `<img src="${images[0]}" alt="${alt}">`;
  const cells = images.map((src) => `<img src="${src}" alt="">`).join("");
  return `<span class="split n${images.length}">${cells}</span>`;
}

/* The group the topic's own icon belongs to: that unit first, then whatever
   stands in for it. */
function tileUnits(topic) {
  const groups = Object.values(topic.alts || {}).filter((group) => group.length > 1);
  const icon = topic.parts.find((part) => part.img === topic.icon);
  // the icon's own group, or the icon alone: the Light Cavalry is one unit even
  // though the Hussar above it comes in two
  const group = icon && groups.find((g) => g.includes(icon.id));
  if (!group) return [topic.icon];
  return group.map((id) => topic.parts.find((part) => part.id === id).img);
}

function deckNow() {
  return buildDeck(state.data, [...state.selected]);
}

/* A shorter round is a random handful of the questions, not the first of them:
   the deck is already shuffled, so the cut is the draw. */
function deckToPlay() {
  const deck = deckNow();
  return state.limit === null ? deck : deck.slice(0, state.limit);
}

function showSize(size) {
  el("start-count").textContent = size ? `${size}` : "";
  const slider = el("size");
  const span = Number(slider.max) - 1 || 1;
  slider.style.setProperty("--filled", `${((Number(slider.value) - 1) / span) * 100}%`);
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
  clearTimeout(state.wait);
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
  const card = state.deck[state.index];
  state.phase = "answer";
  layStack();
  renderBoardCard(card);
  renderProgress();
}

/* the card under this one, and the emblem of the card after it */
function layStack() {
  const stack = el("stack");
  stack.innerHTML = "";
  const next = state.deck[state.index + 1];
  if (!next) return;
  const under = document.createElement("div");
  under.className = "card under";
  under.innerHTML = `<div class="card-inner"><div class="face front"></div></div>`;
  stack.append(under);
  new Image().src = state.data.civs[next.civId].img;
}

/* Who is being asked, and about what: the card says only that, because the
   question itself is the same every time and lives over the board. The back is
   the answer -- the same band and the same name, so the flip turns over one
   card rather than swapping two. */
function renderBoardCard(card) {
  const { topic, civ, answer: fact } = truth(state.data, card);
  const node = document.createElement("div");
  node.className = "card";
  // Defense and Economy are their own section, so the kicker would say the name
  // back to itself
  const band = `${tileHtml(topic)}
    <span class="names">
      ${topic.group === topic.name ? "" : `<span class="topic-where">${topic.group}</span>`}
      <span class="topic-what">${topic.name}</span>
    </span>`;
  node.innerHTML = `
    <div class="card-inner">
      <div class="face front">
        <div class="topic-band">${band}</div>
        <div class="plate">
          <img class="emblem" src="${civ.img}" alt="${civ.name}">
          <span class="subject">${tileHtml(topic)}</span>
        </div>
        <div class="civ-name">${civ.name}</div>
      </div>
      <div class="face back">
        <div class="topic-band">${band}
          <b class="card-delta"></b>
        </div>
        <div class="judge-badge"></div>
        <div class="who">
          <img class="emblem" src="${civ.img}" alt="">
          <div class="civ-name">${civ.name}</div>
        </div>
        <div class="parts">${partsHtml(topic, fact, null)}</div>
        <div class="bonus-slot"></div>
        <div class="next-hint">
          <svg><use href="#icon-play"/></svg><svg><use href="#icon-play"/></svg>
        </div>
        <div class="auto-bar"></div>
      </div>
    </div>`;
  el("stack").append(node);
  openBoard(card);
}

/* One entry per slot, so the pad asks the question the same way of every civ:
   an alternatives group answers to its first member. */
function topicSlots(topic) {
  const alts = topic.alts || {};
  const alternatives = new Set(Object.values(alts).flat());
  return topic.parts.filter((part) => !alternatives.has(part.id) || part.id in alts);
}

/* Every unit that can fill a slot, and what to call them. Before the answer the
   options show them all: drawing the civ's own Winged Hussar would already say
   it has one. */
function slotImages(topic, partId) {
  return slotGroup(topic, partId).map((part) => part.img);
}

function slotName(topic, part) {
  return slotGroup(topic, part.id)
    .map((member) => member.name)
    .join(" / ");
}

function slotGroup(topic, partId) {
  const ids = (topic.alts || {})[partId] || [partId];
  return ids.map((id) => topic.parts.find((part) => part.id === id));
}

/* What the civ has, slot by slot, ringed with how your picks did when the picker
   ran. A slot is drawn the same way it was asked -- every unit that can fill it --
   and the tick is whether this civ has one of them. */
function partsHtml(topic, answer, picks) {
  return topicSlots(topic)
    .map((part) => {
      const on = slotGroup(topic, part.id).some((member) => answer.has.includes(member.id));
      const name = slotName(topic, part);
      return `<span class="part ${on ? "on" : "off"} ${(picks && picks[part.id]) || ""}"
        title="${name}">
        ${splitHtml(slotImages(topic, part.id), name)}
        <b><svg><use href="#mark-${on ? "right" : "wrong"}"/></svg></b>
      </span>`;
    })
    .join("");
}

/* A card is right only if the board was answered clean. "half" is one you got
   some of and not the rest, and it counts as not right — in the tally, and in
   the ones to repeat. */
function verdictOf(result) {
  if (result.clean === false) return "half";
  return result.right ? "right" : "wrong";
}

function wasRight(result) {
  return verdictOf(result) === "right";
}

/* The card in hand owns a result from the moment it is dealt, so reading the
   results alone draws every card as wrong before it has been answered: until it
   is revealed, the one you are on is "now" and nothing else. */
function renderProgress() {
  const bar = el("progress");
  bar.innerHTML = "";
  state.deck.forEach((_, i) => {
    const tick = document.createElement("i");
    const pending = i === state.index && state.phase !== "reveal";
    const done = pending ? null : state.results[i];
    tick.className = done ? verdictOf(done) : i === state.index ? "now" : "";
    bar.append(tick);
  });
}

/* ---------- the board: which upgrades the civilisation has ---------- */

/* The upgrades are tiles you tap, and the board reads left to right as none,
   some, all: the unit it cannot build at all on one side, every upgrade there
   is on the other, and what it actually has in between. Both ends answer the
   card outright. Under them the two that are not answers: the bonus, which is
   points, and done. It is the whole question, so it is up from the moment the
   card is dealt.

   The tiles are shuffled for every card: held still, "the third one" becomes an
   answer of its own, and a position is a thing you can learn instead of the
   upgrade. The reveal keeps the topic's own order, because there it is being
   read rather than answered. */
function openBoard(card) {
  const { topic, civ } = truth(state.data, card);
  state.phase = "picking";
  state.picked = {};
  state.results[state.index] = { card, right: false, clean: true, delta: 0, picks: null };

  const pad = el("pad");
  pad.className = "pad claiming";
  // every civ's name is a plural or a collective, so "do the Franks" and "do
  // the Shu" both read
  pad.innerHTML = `
    <p class="ask-words">which upgrades do the <b>${civ.name}</b> have?</p>
    <div class="board">
      <button class="act rail" data-claim="${NO_UNIT_ID}" title="${cannotTitle(topic)}">
        ${
          topic.below
            ? `<span class="rail-art only">
                 <img src="${topic.below.img}" alt="${topic.below.name}">
               </span>`
            : `<span class="rail-art struck">
                 ${tileHtml(topic)}<svg><use href="#mark-none"/></svg>
               </span>`
        }
        <span>no</span><b class="verdict"></b>
      </button>
      <div class="claims" style="--columns: ${columnsFor(tileCount(topic))}">
        ${shuffle(claimables(topic).filter(({ id }) => id !== BONUS_ID))
          .map(
            ({ id, name, art }) => `<button class="upgrade" data-id="${id}" title="${name}">
              ${art}<b class="verdict"></b>
            </button>`
          )
          .join("")}
      </div>
      <button id="claim-all" class="act rail" title="every upgrade is there">
        <span class="rail-art lit">${fullHtml(topic)}<svg><use href="#mark-full"/></svg></span>
        <span>full</span>
      </button>
    </div>
    <div class="claim-actions">
      <button class="act star" data-claim="${BONUS_ID}"
        title="a civ bonus, team bonus or unique tech about this unit">
        <svg><use href="#icon-star"/></svg><span>bonus</span><b class="verdict"></b>
      </button>
      <button id="picker-done" class="act primary" title="that is all of them">
        <svg><use href="#mark-right"/></svg><span>done</span>
      </button>
    </div>`;
}

function tileCount(topic) {
  return claimables(topic).filter(({ id }) => id !== BONUS_ID).length;
}

/* Two even rows rather than a full one and a remainder: five upgrades are 3 and
   2, not 4 and 1. Four is the widest the rails leave room for. */
function columnsFor(tiles) {
  return tiles <= 4 ? tiles : Math.min(4, Math.ceil(tiles / 2));
}

/* "Full" is the top of the line, so it wears the unit the line ends at -- the
   Arbalester where the topic is gated on the Crossbowman, and every unit that
   can fill that slot, as everywhere else. Three topics end in a tech (Hand
   Cannoneer, Bombard Cannon, Monk) and two are techs throughout (Defense,
   Economy); there the rail keeps the topic's own icon. */
function fullHtml(topic) {
  const top = [...topic.upgrades].reverse().find((id) => id.startsWith("unit-"));
  if (!top) return tileHtml(topic);
  return splitHtml(slotImages(topic, top), slotName(topic, topic.parts.find((p) => p.id === top)));
}

/* Both rails say "no"; the picture says what kind of no. Where the line has
   something under it the civ keeps -- the Archer under the Crossbowman -- that
   unit is drawn whole, because it can still be built. Where it has not, the
   topic's own unit is struck out: there is nothing there at all. */
function cannotTitle(topic) {
  if (topic.below) return `it only has the ${topic.below.name}, none of this line`;
  const gates = topic.parts.filter((part) => !topic.upgrades.includes(part.id));
  const unit = gates.length > 0 && gates.every((part) => part.id.startsWith("unit-"));
  return unit ? "it cannot build this unit at all" : "it has none of these";
}

/* The board itself is the upgrades. The bonus is a claim too, but it is not an
   upgrade, so it sits with the actions. */
function claimables(topic) {
  const tiles = topic.upgrades.map((id) => {
    const part = topic.parts.find((p) => p.id === id);
    const name = slotName(topic, part);
    return { id, name, art: splitHtml(slotImages(topic, id), name) };
  });
  return tiles.concat({ id: BONUS_ID, name: "a bonus about this unit", art: "" });
}

/* "all of them are there": every tile still unanswered, claimed at once, and
   that is the answer -- the bonus is not an upgrade, so this does not claim it. */
function claimAll() {
  if (state.phase !== "picking") return;
  for (const button of el("pad").querySelectorAll(".upgrade")) {
    if (!state.picked[button.dataset.id]) pick(button.dataset.id, true);
  }
  finishPicks();
}

/* leaving the game mid-board: the next card draws its own pad */
function closePicker() {
  el("pad").className = "pad";
}

/* A right claim is one the civ has. The two that are not upgrades read their own
   facts: a bonus about the unit, and not being able to build it at all. */
function wanted(fact, id) {
  if (id === BONUS_ID) return Boolean(fact.bonus);
  if (id === NO_UNIT_ID) return fact.tier === "none";
  return !fact.missing.includes(id);
}

/* A claim is answered on the spot and cannot be taken back. Two of them are the
   whole answer and end the card: every upgrade at once, and "it cannot build
   this at all". */
function pick(id, holding) {
  if (state.phase !== "picking" || state.picked[id]) return;
  const card = state.deck[state.index];
  const { topic, answer: fact } = truth(state.data, card);

  const hit = wanted(fact, id);
  const outcome = hit ? "spotted" : "falsely";
  state.picked[id] = outcome;
  state.results[state.index].delta += hit ? POINTS.spotted : POINTS.falsely;
  bumpScore(hit ? POINTS.spotted : POINTS.falsely);
  markClaim(id, outcome);
  if (holding) return;

  // Said and true, "it cannot build this at all" is the whole answer: the civ
  // may own the techs all the same -- the Aztecs have Bracer and no cavalry
  // archer -- so the reveal names them, but nothing is charged for not claiming
  // them. Said and wrong, the card is answered too, and what you never claimed
  // is charged as ever.
  if (id === NO_UNIT_ID) return finishPicks(hit);

  // the bonus is worth points, never the answer, so the board ends on its own
  // only once every tile and any bonus going has been claimed
  if (claimables(topic).every((tile) => state.picked[tile.id])) finishPicks();
}

function markClaim(id, outcome) {
  const button = el("pad").querySelector(`[data-id="${id}"], [data-claim="${id}"]`);
  if (!button) return;
  button.classList.add(outcome, "done");
  const verdict = button.querySelector(".verdict");
  const mark = `<svg><use href="#mark-${
    outcome === "spotted" ? "right" : outcome === "falsely" ? "wrong" : "partial"
  }"/></svg>`;
  if (verdict) verdict.innerHTML = mark;
}

/* What you never claimed: the ones you missed. The bonus is not one of them --
   it is worth points and nothing else, so leaving it costs nothing and cannot
   make a right card a half one. */
function finishPicks(answered) {
  if (state.phase !== "picking") return;
  const card = state.deck[state.index];
  const { topic, answer: fact } = truth(state.data, card);

  let delta = 0;
  if (!answered) {
    for (const { id } of claimables(topic)) {
      if (id === BONUS_ID || state.picked[id] || !wanted(fact, id)) continue;
      state.picked[id] = "missed";
      markClaim(id, "missed");
      delta += POINTS.missed;
    }
  }

  // naming them all and nothing else is the answer, and only then is the card
  // worth its 100; some of them right is a half answer, none of them a wrong one
  const outcomes = Object.entries(state.picked)
    .filter(([id]) => id !== BONUS_ID)
    .map(([, outcome]) => outcome);
  const clean = outcomes.every((outcome) => outcome === "spotted");
  const named = outcomes.some((outcome) => outcome === "spotted");
  if (clean) delta += POINTS.tier;

  const result = state.results[state.index];
  result.right = clean;
  result.clean = clean || !named;
  result.picks = state.picked;
  result.delta += delta;
  if (delta) bumpScore(delta);
  reveal();
}

/* the civ's bonus, named on the reveal: it is why a civ a slot short can still
   be good */
function bonusHtml(fact) {
  if (!fact.bonus) return "";
  const why = (fact.why || []).join(" • ");
  return `<div class="bonus-note"><svg><use href="#icon-star"/></svg><span>${why}</span></div>`;
}

function reveal() {
  const { topic, answer: fact } = truth(state.data, state.deck[state.index]);
  const result = state.results[state.index];
  state.phase = "reveal";

  const node = el("stack").querySelector(".card:not(.under)");
  const back = node.querySelector(".face.back");
  node.classList.add("settle", "revealed");
  node.style.transform = "";
  const verdict = verdictOf(result);
  back.classList.add(verdict);
  back.querySelector(".judge-badge").className = `judge-badge ${verdict}`;
  back.querySelector(".judge-badge").innerHTML = `<svg><use href="#mark-${
    verdict === "half" ? "partial" : verdict
  }"/></svg>`;
  back.querySelector(".parts").innerHTML = partsHtml(topic, fact, result.picks);
  back.querySelector(".bonus-slot").innerHTML = bonusHtml(fact);
  const delta = back.querySelector(".card-delta");
  delta.className = `card-delta ${result.delta >= 0 ? "up" : "down"}`;
  delta.textContent = result.delta > 0 ? `+${result.delta}` : `${result.delta}`;

  // The card waits for you, but not for ever. The bar is filled in here rather
  // than in the markup, or it would drain while the board was still being
  // answered, and its duration comes off the clock that actually deals the next
  // card so the two cannot drift apart.
  const bar = back.querySelector(".auto-bar");
  bar.innerHTML = "<i></i>";
  bar.firstChild.style.animationDuration = `${AUTO_NEXT_MS}ms`;
  clearTimeout(state.wait);
  state.wait = setTimeout(advance, AUTO_NEXT_MS);

  renderProgress();
}

function advance() {
  if (state.phase !== "reveal") return;
  clearTimeout(state.wait);

  const node = el("stack").querySelector(".card:not(.under)");
  node.classList.add("gone");
  node.style.transform = "translateY(-120%)";

  state.index += 1;
  state.phase = "between";
  state.timer = setTimeout(() => {
    if (state.index >= state.deck.length) showResults();
    else renderCard();
  }, 180);
}

/* ---------- results ---------- */

function showResults() {
  const right = state.results.filter(wasRight).length;
  el("final-score").textContent = state.score > 0 ? `+${state.score}` : `${state.score}`;
  el("final-tally").textContent = `${right} / ${state.results.length}`;

  const wrong = state.results.filter((result) => !wasRight(result));
  el("review").innerHTML = [...wrong, ...state.results.filter(wasRight)]
    .map((result) => {
      const { topic, civ } = truth(state.data, result.card);
      const verdict = verdictOf(result);
      return `<div class="row ${verdict}">
        <span class="judge"><svg><use href="#mark-${
          verdict === "half" ? "partial" : verdict
        }"/></svg></span>
        <img src="${civ.img}" alt="${civ.name}">
        <div class="pair">${reviewPair(topic)}</div>
        <em>${civ.name}</em>
      </div>`;
    })
    .join("");

  el("again-wrong").disabled = wrong.length === 0;
  el("wrong-count").textContent = wrong.length ? `${wrong.length}` : "0";
  el("all-count").textContent = `${state.deck.length}`;
  show("results");
}

/* what the card was about */
function reviewPair(topic) {
  return `<span class="asked">${tileHtml(topic)}</span>
    <span class="mark is-full"><svg><use href="#mark-full"/></svg></span>`;
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
      finishPicks();
    }
    return;
  }

  if (state.phase === "reveal") {
    if (["Shift", "Control", "Alt", "Meta", "Tab"].includes(event.key)) return;
    event.preventDefault();
    advance();
  }
}

