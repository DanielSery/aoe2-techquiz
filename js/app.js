const { buildDeck, truth, shuffle } = window.Quiz;

const STORE_KEY = "aoe2-techquiz.topics";
const MODE_KEY = "aoe2-techquiz.mode";
const GAME_KEY = "aoe2-techquiz.game";
const KNOWN_KEY = "aoe2-techquiz.known";
const SCORES_KEY = "aoe2-techquiz.scores";
const MODES = ["single", "custom", "all"];
const GAMES = ["play", "learn"];

// how long a revealed card waits before it deals the next one itself
const AUTO_NEXT_MS = 5000;

// Play is a fixed round against the clock: the same forty cards' worth of work
// every time, so two scores are comparable.
const PLAY_CARDS = 40;
const CARD_SECONDS = 30;

/* Forty cards drawn from one topic is a narrower thing to know than forty drawn
   from nineteen, and the same score for both would say otherwise. Every topic
   the round could draw on is worth this much at the end of it, so the board can
   compare them -- and it shows which topics they were, because the number alone
   still cannot. */
const PER_TOPIC = 50;
const TOP_SCORES = 25;

/* Learn keeps a percentage per card and deals the ones you know least, so it
   needs no length: what it asks drifts towards what you keep getting wrong, and
   you stop when you are done.

   The moves are shares, not steps. Right closes most of the gap to 100 and no
   more, so a card answered right once reads 70: getting it right once is not
   knowing it, and the card has to come back four more times to finish the rest
   (91, 97, 99, 100). Wrong and half keep a share of what was there, so
   forgetting is proportional too -- a card at 91 answered wrong falls to 23
   rather than shrugging off a fixed ten. */
const KNOWN_STEP = { right: 0.7, half: 0.6, wrong: 0.25 };
/* What a card is worth in the open draw: how much of it you do not know,
   squared, over a floor that keeps a mastered card possible rather than
   frequent. 0% is 10.02 against 100%'s 0.02, so an unknown card is five hundred
   times the pull of one you have down -- and the floor is why "have down" is
   not "never again". */
const LEARN_FLOOR = 0.02;
const LEARN_PULL = 10;

/* And how long it rests: the 20 to 50 of a card just recovered stretches with
   what you know, to sixteen times that at 100. Without it the queue alone
   serves a mastered card every 20 to 50 cards whatever its weight, because an
   appointment does not look at how well you know the thing -- measured, that
   was 35 of 60 draws spent on cards already mastered. */
const REST_AT_100 = 16;

/* When a card comes round again, counted in cards dealt after it. A card you
   just got wrong is worth asking again while the answer is still in the room --
   but only once, and then it has to survive the long gap to prove anything, so
   getting it right sends it 20 to 50 cards away. Drawn from the range at
   random, or the deck falls into a rhythm you can feel coming. */
const AGAIN_AFTER = { wrong: [2, 5], half: [5, 12], right: [20, 50] };

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
  tierWrong: -50,
  spotted: 5,
  falsely: -5,
  missed: -5,
  bonus: 10,
  bonusWrong: -10,
  // the most a whole right card can earn for being quick, all of it or none of
  // it: a card you only half knew is worth no more for being rushed
  speed: 20,
};

const el = (id) => document.getElementById(id);
const screens = {
  menu: el("menu"),
  game: el("game"),
  results: el("results"),
  scores: el("scores"),
};

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
  // which game: a round of forty against the clock, or endless learning
  game: "play",
  // how well each card is known, 0 to 100, keyed topic:civ -- learn's whole
  // memory, and the only thing here that outlives a round
  known: {},
  left: 0,
  // where in this session's dealing each card is wanted next, and how many have
  // been dealt. Session-only: the percentages are what learning remembers, and
  // a spacing from yesterday means nothing today.
  due: {},
  dealt: 0,
  streak: 0,
  // the topics a round was dealt from, kept as it was dealt: the menu can be
  // changed under a finished round
  played: [],
  whole: false,
  place: -1,
  scores: [],
  timer: 0,
  wait: 0,
  clock: 0,
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
    state.game === "learn" ? beginLearning() : beginRound(deckToPlay(), true)
  );
  el("quit").addEventListener("click", () => show("menu"));
  el("to-menu").addEventListener("click", () => show("menu"));
  el("to-board").addEventListener("click", () => openBoardScreen(-1));
  el("see-board").addEventListener("click", () => openBoardScreen(state.place));
  el("board-back").addEventListener("click", () => show("menu"));
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
  el("games").addEventListener("click", (event) => {
    const button = event.target.closest(".game");
    if (button) setGame(button.dataset.game);
  });
  document.addEventListener("keydown", onKey);
}

/* ---------- menu ---------- */

function restoreSelection() {
  let saved = [];
  try {
    saved = JSON.parse(localStorage.getItem(STORE_KEY) || "[]");
    const mode = localStorage.getItem(MODE_KEY);
    if (MODES.includes(mode)) state.mode = mode;
    const game = localStorage.getItem(GAME_KEY);
    if (GAMES.includes(game)) state.game = game;
    const known = JSON.parse(localStorage.getItem(KNOWN_KEY) || "{}");
    if (known && typeof known === "object") state.known = known;
    const scores = JSON.parse(localStorage.getItem(SCORES_KEY) || "[]");
    if (Array.isArray(scores)) state.scores = scores;
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
    localStorage.setItem(GAME_KEY, state.game);
  } catch (ignored) {
    /* private mode, or opened off disk */
  }
}

/* What learn knows about you, saved after every card rather than at the end:
   there is no end, and quitting is how you stop. Cards at nothing are dropped
   instead of stored, so the whole tech tree unlearnt is an empty object. */
function rememberKnown() {
  try {
    localStorage.setItem(KNOWN_KEY, JSON.stringify(state.known));
  } catch (ignored) {
    /* private mode, or opened off disk */
  }
}

function knownKey(card) {
  return `${card.topicId}:${card.civId}`;
}

function knownOf(card) {
  return state.known[knownKey(card)] || 0;
}

/* Answered at nothing is not the same as never answered, so the entry is kept
   even at 0: it is the difference between a card you keep failing and one the
   deck has never put in front of you, and the menu counts the second sort. */
function learnFrom(card, verdict) {
  const was = knownOf(card);
  const share = KNOWN_STEP[verdict];
  const moved = Math.round(verdict === "right" ? was + (100 - was) * share : was * share);
  state.known[knownKey(card)] = Math.max(0, Math.min(100, moved));
  rememberKnown();

  // and when to ask it again, counted from the card it was asked on
  const [from, to] = AGAIN_AFTER[verdict];
  const gap = (from + Math.random() * (to - from)) * restFactor(verdict, knownOf(card));
  state.due[knownKey(card)] = state.index + Math.round(gap);
}

/* A card you have just got wrong comes back soon whatever you used to know --
   its percentage has just fallen anyway. Getting it right is what buys rest,
   and each right answer in a row roughly doubles it. Written against the rungs
   of the ladder rather than as a curve over the percentage, because the rungs
   are what it has to line up with: 70, 91, 97, 99, 100 is one right answer,
   then two, then three, four, five.

       70  ->  1x   20-50 cards      the short interval, a card still in play
       91  ->  2x   40-100
       97  ->  4x   80-200           about one sighting a long session
       99  ->  8x   160-400
      100  -> 16x   320-800          rare, and never impossible: a deck with
                                     nothing else in it still deals them */
function restFactor(verdict, known) {
  if (verdict !== "right") return 1;
  const gap = Math.max(100 - known, 0);
  if (gap >= 30) return 1;
  if (gap >= 9) return 2;
  if (gap >= 3) return 4;
  if (gap >= 1) return REST_AT_100 / 2;
  return REST_AT_100;
}

function isNew(card) {
  return state.known[knownKey(card)] === undefined;
}

/* Every round of Play that was the whole forty, best first. A retry of the ones
   you missed is not one of them: it is a different and easier round, and putting
   it beside the others would say they were comparable. */
function recordScore(entry) {
  state.scores = [...state.scores, entry].sort((a, b) => b.score - a.score).slice(0, TOP_SCORES);
  try {
    localStorage.setItem(SCORES_KEY, JSON.stringify(state.scores));
  } catch (ignored) {
    /* private mode, or opened off disk */
  }
  return state.scores.indexOf(entry);
}

/* How well the selection is known as one number, for the menu and the bar. */
function knownShare(cards) {
  if (!cards.length) return 0;
  return Math.round(cards.reduce((sum, card) => sum + knownOf(card), 0) / cards.length);
}

// Single keeps one topic, All takes every one, Custom leaves the choice alone.
function applyMode() {
  if (state.mode === "all") state.selected = new Set(state.data.topics.map((t) => t.id));
  else if (state.mode === "single" && state.selected.size > 1) {
    state.selected = new Set([[...state.selected][0]]);
  }
}

function setGame(game) {
  if (!GAMES.includes(game)) return;
  state.game = game;
  rememberSelection();
  renderMenu();
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
  for (const button of el("games").querySelectorAll(".game")) {
    button.setAttribute("aria-pressed", String(button.dataset.game === state.game));
  }

  const pool = deckNow();
  const learning = state.game === "learn";
  el("start").disabled = pool.length === 0;
  el("start-count").textContent = pool.length === 0 ? "" : learning ? "∞" : `${playSize(pool)}`;
  el("pool-note").textContent = !pool.length
    ? ""
    : learning
    ? `${pool.length} cards, ${knownShare(pool)}% known${fresh(pool)}`
    : `${pool.length} cards to draw from, ${CARD_SECONDS}s each`;
  markScrollable(grid);
}

function playSize(pool) {
  return Math.min(PLAY_CARDS, pool.length);
}

/* how many of them have never been answered at all */
function fresh(pool) {
  const never = pool.filter(isNew).length;
  return never ? `, ${never} new` : "";
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

/* Forty cards, whatever the topics: the deck is already shuffled, so the cut is
   the draw, and a selection smaller than forty is simply all of it. */
function deckToPlay() {
  const deck = deckNow();
  return deck.slice(0, playSize(deck));
}

/* An appointment first, and anything else only when none is owed.

   A card that has been answered is due back at a position: soon if you got it
   wrong, a long way off if you got it right. When that position arrives the
   card is *taken*, not merely allowed -- the longest overdue first, so a
   backlog drains oldest-first and "again in three cards" means three cards.
   Letting the due ones back into the general draw instead is what the first
   version did, and a card answered wrong came back 26 cards later, because it
   was one of 53 the draw could equally have picked.

   With nothing owed the draw is the open field: every card never dealt and
   every one not yet due, and there the less you know a card the likelier it is
   -- eleven times as likely at nothing known as at mastered. A pull rather than
   a rule, so a card you have down still turns up. */
function drawLearnCard(avoid) {
  const at = state.dealt++;
  const pool = deckNow();
  const free =
    avoid && pool.length > 1
      ? pool.filter((card) => knownKey(card) !== knownKey(avoid))
      : pool;

  const owed = free.filter((card) => {
    const due = state.due[knownKey(card)];
    return due !== undefined && due <= at;
  });
  const waiting = free.filter((card) => state.due[knownKey(card)] === undefined);

  /* Two owed in a row is enough while anything is still unseen. Getting a
     handful wrong puts them back every two to five cards each, which between
     them is every card: answer the first six wrong and the deck deals those six
     for ever, and the other forty-seven are never seen. So every third card is
     a new one until there are no new ones left, and an appointment it makes
     wait is a card or two late rather than lost. */
  const hogging = waiting.length > 0 && state.streak >= 2;
  if (owed.length && !hogging) {
    state.streak += 1;
    return longestOverdue(owed);
  }
  state.streak = 0;

  /* Nobody owed and nothing new: something has to be dealt, and it is drawn by
     what you know rather than by whose appointment is nearest. Thirteen cards in
     play cannot fill sixty draws without coming round sooner than their
     interval, and asking one of those early is worth more than spending the
     draw on a card at 100 -- which is the other way the mastered forty crept
     back in. */
  const choices = waiting.length ? waiting : free;
  const weights = choices.map(learnWeight);
  let roll = Math.random() * weights.reduce((sum, weight) => sum + weight, 0);
  for (let i = 0; i < choices.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return choices[i];
  }
  return choices[choices.length - 1];
}

function learnWeight(card) {
  const unknown = (100 - knownOf(card)) / 100;
  return LEARN_FLOOR + LEARN_PULL * unknown * unknown;
}

/* the one that has been waiting longest, and of two the same the one you know
   less well */
function longestOverdue(cards) {
  return cards.reduce((best, card) => {
    const a = state.due[knownKey(card)];
    const b = state.due[knownKey(best)];
    if (a !== b) return a < b ? card : best;
    return knownOf(card) < knownOf(best) ? card : best;
  });
}

/* ---------- round ---------- */

/* At the start of a session every card already answered takes its place in the
   rotation by what is known of it: a mastered card lands somewhere inside its
   own long interval, a shaky one lands soon. Without this, "not scheduled yet"
   is a side door -- the deck answers the thirteen it has never seen, and then
   has nothing left to deal but the forty it knows, which is how 34 of 60 draws
   went to mastered cards. Never-answered cards keep no due at all: they are the
   ones the deck is for. */
function seedSchedule() {
  const [from, to] = AGAIN_AFTER.right;
  state.due = {};
  for (const card of deckNow()) {
    if (isNew(card)) continue;
    const span = (from + Math.random() * (to - from)) * restFactor("right", knownOf(card));
    state.due[knownKey(card)] = Math.round(Math.random() * span);
  }
}

/* Learning deals one card at a time and keeps one in hand, so the stack still
   has something under it and the draw still sees the answer before it. */
function beginLearning() {
  seedSchedule();
  state.dealt = 0;
  state.streak = 0;
  const first = drawLearnCard();
  if (!first) return;
  state.game = "learn";
  beginRound([first, drawLearnCard(first)], false);
}

function beginRound(cards, isFullSet) {
  if (!cards.length) return;
  state.deck = cards;
  state.whole = Boolean(isFullSet);
  state.played = [...state.selected];
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
  stopClock();
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
  startClock();
}

/* ---------- the clock ---------- */

/* Thirty seconds a card, and only in Play: learning is not a test, and a clock
   over it would make it one. What is left when the card is answered is what the
   speed bonus is worth, so the reading has to survive finishPicks -- stopClock
   leaves `left` where it stopped rather than zeroing it. */
function startClock() {
  stopClock();
  state.left = CARD_SECONDS;
  showClock();
  if (state.game !== "play") return;
  state.clock = setInterval(() => {
    state.left -= 1;
    showClock();
    if (state.left <= 0) {
      stopClock();
      finishPicks(false, true);
    }
  }, 1000);
}

function stopClock() {
  clearInterval(state.clock);
  state.clock = 0;
}

function showClock() {
  const clock = el("clock");
  clock.hidden = state.game !== "play";
  if (clock.hidden) return;
  const left = Math.max(state.left, 0);
  clock.querySelector("b").textContent = `${left}`;
  clock.classList.toggle("low", left <= 10);
  clock.classList.toggle("out", left <= 5);
  el("clock-bar").style.transform = `scaleX(${left / CARD_SECONDS})`;
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
        <div class="card-note"></div>
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

  // A learning round has no length to show, so the bar shows the thing that is
  // actually moving: how much of the selection you know.
  if (state.game === "learn") {
    const pool = deckNow();
    const share = knownShare(pool);
    bar.className = "progress meter";
    bar.innerHTML = `<i style="width: ${share}%"></i><b>${share}% known${fresh(pool)}</b>`;
    return;
  }

  bar.className = "progress";
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
        <span>missing</span><b class="verdict"></b>
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
  const worth = id === BONUS_ID
    ? (hit ? POINTS.bonus : POINTS.bonusWrong)
    : (hit ? POINTS.spotted : POINTS.falsely);
  state.picked[id] = outcome;
  state.results[state.index].delta += worth;
  bumpScore(worth);
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
function finishPicks(answered, timedOut) {
  if (state.phase !== "picking") return;
  stopClock();
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

  /* A card is right when the claims match what the civ has: nothing claimed
     falsely, and nothing it has left unclaimed. Read off the facts rather than
     off the claims, because "nothing to claim" is a real answer and an empty
     board is the shape of two different cards -- the Georgians build Hand
     Cannoneers with no Ring Archer Armour, where done on an empty board is
     exactly right, and the Aztecs build none at all, where the ✗ rail is what
     says so and is therefore owed. Said and true, that rail answers for the
     whole card: a civ may own the techs anyway and is not charged for leaving
     them (the Armenians have the armour and no Hand Cannoneer).

     Some of them right is a half answer, worth what the claims came to and no
     more; none of them right is a wrong one and costs the 50. The clock running
     out is a wrong answer however much of it was right, so it takes the same. */
  const outcomes = Object.entries(state.picked)
    .filter(([id]) => id !== BONUS_ID)
    .map(([, outcome]) => outcome);
  const owing = claimables(topic)
    .concat({ id: NO_UNIT_ID })
    .filter(({ id }) => id !== BONUS_ID && wanted(fact, id) && state.picked[id] !== "spotted");
  const shortcut = state.picked[NO_UNIT_ID] === "spotted";
  const clean =
    !timedOut &&
    !outcomes.includes("falsely") &&
    (shortcut || owing.length === 0);
  const named = !timedOut && outcomes.some((outcome) => outcome === "spotted");
  let quick = 0;
  if (clean) {
    delta += POINTS.tier;
    // the whole card right and quick with it, worth up to 20 more; there is no
    // clock to beat when learning
    if (state.game === "play") {
      quick = Math.round((POINTS.speed * Math.max(state.left, 0)) / CARD_SECONDS);
      delta += quick;
    }
  } else if (!named) {
    delta += POINTS.tierWrong;
  }

  const result = state.results[state.index];
  result.right = clean;
  result.clean = clean || !named;
  result.quick = quick;
  result.timedOut = Boolean(timedOut);
  result.picks = state.picked;
  result.delta += delta;
  if (delta) bumpScore(delta);
  learnFrom(card, verdictOf(result));
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
  back.querySelector(".card-note").innerHTML = result.timedOut
    ? `<span class="late"><svg><use href="#icon-clock"/></svg> out of time</span>`
    : result.quick
    ? `<span class="quick"><svg><use href="#icon-clock"/></svg> +${result.quick} for the pace</span>`
    : "";

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
    // learning never runs out of cards: it draws the next one as it goes
    if (state.game === "learn") state.deck.push(drawLearnCard(state.deck[state.index]));
    if (state.index >= state.deck.length) showResults();
    else renderCard();
  }, 180);
}

/* ---------- results ---------- */

function showResults() {
  const right = state.results.filter(wasRight).length;

  // The breadth bonus lands once, at the end, where it reads as its own line
  // rather than disappearing into whichever card happened to be last.
  const topics = state.played.filter((id) => state.data.topics.some((topic) => topic.id === id));
  const whole = state.game === "play" && state.whole;
  const bonus = whole ? topics.length * PER_TOPIC : 0;
  if (bonus) bumpScore(bonus);

  state.place = whole
    ? recordScore({
        score: state.score,
        right,
        cards: state.results.length,
        topics,
        at: Date.now(),
      })
    : -1;

  el("final-score").textContent = state.score > 0 ? `+${state.score}` : `${state.score}`;
  el("final-tally").textContent = `${right} / ${state.results.length}`;
  el("final-note").innerHTML = [
    bonus
      ? `${topics.length} ${topics.length === 1 ? "topic" : "topics"} &times; ${PER_TOPIC} = +${bonus}`
      : "",
    state.place === 0
      ? `<b class="best">best yet</b>`
      : state.place > 0
      ? `<b>${ordinal(state.place + 1)} best</b>`
      : "",
  ]
    .filter(Boolean)
    .join(" &middot; ");
  el("see-board").hidden = state.scores.length === 0;

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

function ordinal(n) {
  const tail = n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th";
  return `${n}${tail}`;
}

function openBoardScreen(highlight) {
  renderScores(highlight);
  show("scores");
}

/* The board is the scores and what they were scored on: a round of Crossbowman
   and a round of everything are both forty cards, and only the topics beside
   the number say which was which. */
function renderScores(highlight) {
  const board = el("scoreboard");
  if (!state.scores.length) {
    board.innerHTML = `<li class="empty">No rounds yet — play forty and you are on it.</li>`;
    return;
  }
  board.innerHTML = state.scores
    .map((entry, i) => {
      const topics = (entry.topics || [])
        .map((id) => state.data.topics.find((topic) => topic.id === id))
        .filter(Boolean);
      const shown = topics.slice(0, 5);
      const more = topics.length - shown.length;
      return `<li class="${i === highlight ? "mine" : ""}">
        <b class="place">${i + 1}</b>
        <span class="tally">${entry.score > 0 ? `+${entry.score}` : entry.score}</span>
        <span class="of">${entry.right}/${entry.cards}</span>
        <span class="topics" title="${topics.map((topic) => topic.name).join(", ")}">
          ${shown.map((topic) => `<span class="badge">${tileHtml(topic)}</span>`).join("")}
          ${more > 0 ? `<em>+${more}</em>` : ""}
        </span>
        <span class="when">${when(entry.at)}</span>
      </li>`;
    })
    .join("");
}

function when(at) {
  if (!at) return "";
  const date = new Date(at);
  return `${date.getDate()}/${date.getMonth() + 1}`;
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

