const { buildDeck, truth, shuffle } = window.Quiz;

const STORE_KEY = "aoe2-techquiz.topics";
const GAME_KEY = "aoe2-techquiz.game";
const FORMAT_KEY = "aoe2-techquiz.format";
const KNOWN_KEY = "aoe2-techquiz.known";
const PLAYER_KEY = "aoe2-techquiz.player";
const GAMES = ["play", "learn"];
const FORMATS = ["normal", "reverse", "difference"];

// how long a revealed card waits before it deals the next one itself
const AUTO_NEXT_MS = 30000;

// Play is a fixed round against the clock: the same forty cards' worth of work
// every time, so two scores are comparable.
const PLAY_CARDS = 40;
const CARD_SECONDS = 30;
const SCORING_VERSION = 2;

const TOP_SCORES = 25;

/* Learn keeps a percentage per card and deals the ones you know least, so it
   needs no length: what it asks drifts towards what you keep getting wrong, and
   you stop when you are done.

   The moves are shares, not steps. A right answer normally closes 70% of the
   gap to 100, adjusted by the card's smoothed response pace; getting it right
   once is still not mastery. Wrong and half keep a share of what was there, so
   forgetting is proportional too -- a card at 91 answered wrong falls to 23
   rather than shrugging off a fixed ten. */
const KNOWN_STEP = { right: 0.7, half: 0.6, wrong: 0.25 };

/* Response pace measures recall separately from operating the board. Four
   seconds is the thinking allowance; each selection gets another 300ms for the
   physical click. A known card with many present upgrades therefore does not
   look slow merely because it needs many taps. */
const RESPONSE_THINK_SECONDS = 4;
const RESPONSE_CLICK_SECONDS = 0.3;

/* A card you keep getting wrong does not come back to known at the rate of one
   you have never missed. Every miss on its record damps the climb -- the seven
   tenths of the gap a clean card closes becomes a half at one miss, a third at
   two -- so a card you have failed three times takes eight right answers to
   master where a clean one takes five. The record is paid off rather than
   carried for ever: a right answer on a card already at 70 or better clears one
   miss, so two good answers in a row begin to forgive it, and one lucky answer
   does not. */
const MISS_DAMP = 0.5;
const MISS_CAP = 6;
const MISS_FORGIVEN_AT = 70;
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
/* When a card comes round again, counted in cards dealt after it. Uncertain
   cards stay in the short loop; long rests have to be earned through repeated,
   confident right answers. Ranges keep the rotation from becoming predictable. */
const AGAIN_AFTER = { wrong: [2, 4], half: [3, 6] };

const NO_UNIT_ID = "no-unit";
const UNIT_STATE_ID = "unit-state";

// Every upgrade is a binary decision: selecting one says the civ has it, while
// leaving it clear and pressing done says it does not. Both kinds of knowledge
// are worth the same. Unit lines are multi-way decisions, so their value grows
// with the number of states and alternative units shown in a state.
const POINTS = {
  complete: 30,
  whollyWrong: -30,
  upgrade: 10,
  upgradeWrong: -10,
  unitPerState: 5,
  unitAlternative: 2,
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
  // which game: a round of forty against the clock, or endless learning
  game: "play",
  formats: new Set(["normal"]),
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
  playerName: "",
  user: null,
  avatarUrl: "",
  authReady: Promise.resolve(),
  playerRank: null,
  lastScoreId: null,
  scoreSubmission: null,
  pendingScore: null,
  publishAfterName: false,
  resultCoefficientNote: "",
  supabase: null,
  publicSupabase: null,
  scores: [],
  boardKey: "any",
  timer: 0,
  wait: 0,
  clock: 0,
  answerStartedAt: 0,
  answerClicks: 0,
  question: null,
};

start();

function start() {
  state.data = window.QUIZ_DATA;
  if (!state.data || !state.data.topics || !state.data.topics.length) {
    el("topic-grid").innerHTML =
      '<p class="lede">data/topics.js did not load. Run <code>python tools/build_data.py</code>.</p>';
    return;
  }
  mergeGunpowderTopics();
  mergeSiegeTopics();
  mergeArcherTopics();
  normalizeChampionTopic();
  mergeBarracksTopics();
  mergeStableTopics();
  prepareBlacksmithTopic();
  prepareUnitBlacksmithUpgrades();
  prepareDefenseControls();
  restoreSelection();
  connectLeaderboard();
  renderMenu();

  el("quit").addEventListener("click", () => show("menu"));
  el("to-menu").addEventListener("click", () => show("menu"));
  el("to-board").addEventListener("click", () => openBoardScreen(null));
  el("see-board").addEventListener("click", () => openBoardScreen(state.lastScoreId));
  el("board-back").addEventListener("click", () => show("menu"));
  el("leaderboard-formats").addEventListener("click", (event) => {
    const button = event.target.closest("[data-leaderboard-format]");
    if (!button) return;
    state.boardKey = button.dataset.leaderboardFormat;
    openBoardScreen(null);
  });
  el("player-name").addEventListener("click", () => openPlayerDialog());
  el("player-cancel").addEventListener("click", cancelPlayerDialog);
  el("player-dialog").addEventListener("cancel", (event) => {
    event.preventDefault();
    cancelPlayerDialog();
  });
  el("player-form").addEventListener("submit", savePlayerName);
  el("discord-auth").addEventListener("click", connectDiscord);
  el("auth-sign-out").addEventListener("click", startNewGuest);
  el("again-all").addEventListener("click", () => beginRound(shuffle(state.fullDeck), true));
  el("again-wrong").addEventListener("click", () =>
    beginRound(
      shuffle(state.results.filter((result) => !wasRight(result)).map((result) => result.card)),
      false
    )
  );
  el("pad").addEventListener("click", (event) => {
    if (event.target.closest("#picker-done")) return finishPicks();
    const option = event.target.closest(".answer-option");
    if (option) return evaluateAlternateAnswer(option);
    if (event.target.closest("#claim-all")) return claimAll();
    const unitState = event.target.closest(".unit-state");
    if (unitState) return chooseUnitState(unitState.dataset.unitState, unitState.dataset.unitKey || "");
    const act = event.target.closest(".act[data-claim]");
    if (act) return pick(act.dataset.claim);
    const upgrade = event.target.closest(".upgrade");
    if (upgrade) pick(upgrade.dataset.id);
  });
  // a revealed card waits for you: anything but the hud moves it on
  screens.game.addEventListener("pointerdown", (event) => {
    if (state.phase === "reveal" && !event.target.closest(".hud")) advance();
  });
  el("games").addEventListener("click", (event) => {
    const button = event.target.closest(".game");
    if (button && !button.disabled) startGame(button.dataset.game);
  });
  el("formats").addEventListener("click", (event) => {
    const button = event.target.closest(".format");
    if (button) setFormat(button.dataset.format);
  });
  document.addEventListener("keydown", onKey);
}

function connectLeaderboard() {
  const config = window.SUPABASE_CONFIG || {};
  const configured =
    /^https:\/\//.test(config.url || "") &&
    !config.url.includes("YOUR_PROJECT") &&
    config.publishableKey &&
    config.publishableKey !== "YOUR_PUBLISHABLE_KEY";
  if (!configured || !window.supabase?.createClient) return;
  state.supabase = window.supabase.createClient(config.url, config.publishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  // A sessionless reader keeps the legacy public board available before the
  // auth migration grants SELECT to authenticated users.
  state.publicSupabase = window.supabase.createClient(config.url, config.publishableKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storageKey: "aoe2-techquiz-public-reader",
    },
  });
  state.supabase.auth.onAuthStateChange((_event, session) => applyAuthSession(session));
  state.authReady = initializeAuth();
}

async function initializeAuth() {
  const { data } = await state.supabase.auth.getSession();
  if (data.session) return applyAuthSession(data.session);
  const { data: signedIn, error } = await state.supabase.auth.signInAnonymously();
  if (error) {
    renderPlayerName();
    return;
  }
  applyAuthSession(signedIn.session);
}

function applyAuthSession(session) {
  state.user = session?.user || null;
  const metadata = state.user?.user_metadata || {};
  state.avatarUrl = /^https:\/\/(cdn\.discordapp\.com|media\.discordapp\.net)\//.test(metadata.avatar_url || "")
    ? metadata.avatar_url
    : "";
  if (!state.playerName && hasDiscordIdentity(state.user)) {
    const suggested = String(metadata.full_name || metadata.name || metadata.preferred_username || "").trim();
    if (suggested.length >= 2 && suggested.length <= 24) state.playerName = suggested;
  }
  renderPlayerName();
  refreshPlayerRank();
}

async function connectDiscord() {
  if (!state.supabase) return;
  if (hasDiscordIdentity(state.user)) return openPlayerDialog();
  el("player-error").textContent = "";
  const options = { redirectTo: `${location.origin}${location.pathname}` };
  const request = state.user
    ? state.supabase.auth.linkIdentity({ provider: "discord", options })
    : state.supabase.auth.signInWithOAuth({ provider: "discord", options });
  const { error } = await request;
  if (error) el("player-error").textContent = error.message;
}

async function startNewGuest() {
  if (!state.supabase) return;
  await state.supabase.auth.signOut();
  const { data, error } = await state.supabase.auth.signInAnonymously();
  if (error) {
    el("player-error").textContent = error.message;
    return;
  }
  state.avatarUrl = "";
  applyAuthSession(data.session);
  openPlayerDialog();
}

async function refreshPlayerRank() {
  state.playerRank = null;
  renderPlayerName();
  if (!state.supabase || !state.user || !state.playerName || !state.formats.size) return;
  const { data, error } = await state.supabase
    .rpc("get_player_rank", {
      p_leaderboard_key: formatKey([...state.formats]),
      p_scoring_version: SCORING_VERSION,
    })
    .maybeSingle();
  if (!error && data) state.playerRank = Number(data.player_rank);
  renderPlayerName();
}

function startGame(game) {
  if (!GAMES.includes(game)) return;
  state.game = game;
  rememberSelection();
  if (game === "learn") return beginLearning();
  beginRound(deckToPlay(), true);
}

function openPlayerDialog(publishScore = false) {
  state.publishAfterName = publishScore;
  const input = el("player-input");
  input.value = state.playerName;
  el("player-dialog").querySelector("h2").textContent = publishScore ? "Publish your score" : "Player profile";
  const discord = hasDiscordIdentity(state.user);
  el("auth-status").textContent = discord
    ? "Connected with Discord. Your scores and profile belong to this account."
    : state.user
    ? "Playing as a guest. Connect Discord to keep this profile across browsers."
    : "Guest accounts must be enabled in Supabase before scores can be published.";
  el("discord-auth").hidden = discord;
  el("auth-sign-out").hidden = !discord;
  el("player-submit").textContent = publishScore ? "Publish score" : "Save name";
  el("player-error").textContent = "";
  el("player-dialog").showModal();
  requestAnimationFrame(() => input.focus());
}

function hasDiscordIdentity(user) {
  return Boolean(user?.identities?.some((identity) => identity.provider === "discord"));
}

function cancelPlayerDialog() {
  const wasPublishing = state.publishAfterName;
  state.publishAfterName = false;
  state.pendingScore = null;
  el("player-dialog").close();
  if (wasPublishing) setResultNote(state.resultCoefficientNote, "score not published");
}

function savePlayerName(event) {
  event.preventDefault();
  const input = el("player-input");
  const name = input.value.trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 24) {
    el("player-error").textContent = "Use between 2 and 24 characters.";
    return;
  }
  state.playerName = name;
  state.playerRank = null;
  try {
    localStorage.setItem(PLAYER_KEY, name);
  } catch (ignored) {
    /* private mode, or opened off disk */
  }
  const shouldPublish = state.publishAfterName;
  state.publishAfterName = false;
  el("player-dialog").close();
  renderPlayerName();
  if (shouldPublish) publishPendingScore();
  else refreshPlayerRank();
}

async function publishPendingScore() {
  await state.authReady;
  const entry = state.pendingScore;
  state.pendingScore = null;
  if (!entry || !state.supabase) return;
  setResultNote(state.resultCoefficientNote, "submitting score…");
  state.scoreSubmission = recordScore(entry);
  state.scoreSubmission.then(
    (result) => {
      state.playerRank = Number(result.best_rank);
      renderPlayerName();
      const status = result.saved
        ? `new best &middot; ${ordinal(result.best_rank)} on the leaderboard`
        : `this score would rank ${ordinal(result.attempt_rank)} &middot; your best stays ${ordinal(result.best_rank)}`;
      setResultNote(state.resultCoefficientNote, status);
    },
    () => setResultNote(state.resultCoefficientNote, "score could not be submitted")
  );
}

function normalizeChampionTopic() {
  const topic = state.data.topics.find((item) => item.id === "champion");
  if (!topic || topic.parts.some((part) => part.id === "unit-473")) return;
  const champion = topic.parts.find((part) => part.id === "unit-567");
  const eliteChampi = topic.parts.find((part) => part.id === "unit-2554");
  const twoHanded = {
    id: "unit-473",
    name: "Two-Handed Swordsman",
    img: "img/topics/unit-two-handed.png",
    icon_index: 12,
  };
  topic.parts.splice(topic.parts.indexOf(champion) + 1, 0, twoHanded);
  topic.alts["unit-473"] = ["unit-473", "unit-2554"];
  topic.upgrades = ["unit-473", "unit-567", ...topic.upgrades.filter((id) => id !== "unit-567")];
  for (const fact of Object.values(topic.civs)) {
    const hasChampion = fact.has.includes("unit-567") || fact.has.includes("unit-2554");
    fact.has = fact.has.filter((id) => id !== "unit-473");
    fact.missing = fact.missing.filter((id) => id !== "unit-473");
    if (hasChampion) fact.has.push("unit-473");
    else fact.missing.push("unit-473");
  }
}

function mergeGunpowderTopics() {
  const hand = state.data.topics.find((topic) => topic.id === "hand_cannoneer");
  const bombard = state.data.topics.find((topic) => topic.id === "bombard_cannon");
  if (!hand || !bombard || state.data.topics.some((topic) => topic.id === "gunpowder_units")) return;

  const civs = {};
  for (const civId of new Set([...Object.keys(hand.civs), ...Object.keys(bombard.civs)])) {
    const facts = [hand.civs[civId], bombard.civs[civId]].filter(Boolean);
    civs[civId] = {
      tier: "partial",
      has: facts.flatMap((fact) => fact.has),
      missing: facts.flatMap((fact) => fact.missing),
      bonus: facts.some((fact) => fact.bonus),
      why: facts.flatMap((fact) => fact.why || []),
      mergedFacts: {
        hand_cannoneer: hand.civs[civId],
        bombard_cannon: bombard.civs[civId],
      },
    };
  }

  hand.replacedUpgrades = ["tech-219"];
  bombard.replacedUpgrades = ["tech-377"];
  const traction = bombard.parts.find((part) => part.id === "unit-1942");
  const combined = {
    id: "gunpowder_units",
    name: "Hand Cannoneer + Bombard Cannon",
    group: "Gunpowder",
    icon: hand.icon,
    images: [hand.icon, bombard.icon, traction.img],
    below: null,
    unit: null,
    gate: [],
    alts: { ...hand.alts, ...bombard.alts },
    upgrades: [...new Set([...hand.upgrades, ...bombard.upgrades])],
    parts: [...hand.parts, ...bombard.parts],
    civs,
    merged: [hand, bombard],
  };
  state.data.topics = state.data.topics.filter(
    (topic) => topic.id !== hand.id && topic.id !== bombard.id
  );
  state.data.topics.push(combined);
}

function mergeSiegeTopics() {
  mergeUnitTopics(["siege_ram", "onager", "scorpion"], {
    id: "siege_units", name: "Ram / Onager / Scorpion", group: "Siege",
    icon: "img/topics/building-siege-workshop.png",
  });
}

function mergeArcherTopics() {
  mergeUnitTopics(["arbalester", "skirmisher"], {
    id: "archer_skirmisher", name: "Archer / Skirmisher", group: "Archery Range",
    icon: "img/topics/building-archery-range.png",
  });
}

function mergeUnitTopics(ids, presentation) {
  const children = ids.map((id) => state.data.topics.find((topic) => topic.id === id));
  if (children.some((topic) => !topic)) return;
  const parts = [...new Map(children.flatMap((topic) => topic.parts).map((part) => [part.id, part])).values()];
  const civs = {};
  for (const civId of Object.keys(state.data.civs)) {
    const facts = children.map((topic) => topic.civs[civId] || {
      tier: "none", has: [], missing: topic.upgrades, bonus: false, why: [],
    });
    const has = [...new Set(facts.flatMap((fact) => fact.has))];
    civs[civId] = {
      tier: "partial",
      has,
      missing: [...new Set(facts.flatMap((fact) => fact.missing))].filter((id) => !has.includes(id)),
      bonus: facts.some((fact) => fact.bonus),
      why: [...new Set(facts.flatMap((fact) => fact.why || []))],
      mergedFacts: Object.fromEntries(children.map((topic, index) => [topic.id, facts[index]])),
    };
  }
  const combined = {
    ...presentation, below: null, unit: null, gate: [],
    alts: Object.assign({}, ...children.map((topic) => topic.alts)),
    upgrades: [...new Set(children.flatMap((topic) => topic.upgrades))],
    parts, civs, merged: children,
  };
  const index = state.data.topics.findIndex((topic) => ids.includes(topic.id));
  state.data.topics = state.data.topics.filter((topic) => !ids.includes(topic.id));
  state.data.topics.splice(index, 0, combined);
}

function mergeBarracksTopics() {
  mergeUnitTopics(["champion", "halberdier", "eagle"], {
    id: "barracks_units", name: "Long Swordsman / Halberdier / Regional Barracks units", group: "Barracks",
    icon: "img/topics/building-barracks.png",
  });
}

function mergeStableTopics() {
  const hussar = state.data.topics.find((topic) => topic.id === "hussar");
  const knight = state.data.topics.find((topic) => topic.id === "paladin");
  const camel = state.data.topics.find((topic) => topic.id === "camel");
  const elephant = state.data.topics.find((topic) => topic.id === "battle_elephant");
  const steppe = state.data.topics.find((topic) => topic.id === "steppe_lancer");
  if (!hussar || !knight || !camel || !elephant || !steppe) return;
  const riderIds = ["unit-1751", "unit-1753"];
  const special = {
    ...elephant, id: "regional_cavalry", name: "Battle Elephant / Steppe Lancer / Shrivamsha Rider",
    alts: {
      "unit-1132": ["unit-1132", "unit-1370", "unit-1751"],
      "unit-1134": ["unit-1134", "unit-1372", "unit-1753"],
    },
    parts: [...new Map([...elephant.parts, ...steppe.parts, ...knight.parts.filter((part) => riderIds.includes(part.id))].map((part) => [part.id, part])).values()],
    civs: {},
  };
  special.gate = special.alts[special.unit];
  for (const civId of Object.keys(state.data.civs)) {
    const knightFact = knight.civs[civId];
    const rider = knightFact.has.some((id) => riderIds.includes(id));
    const facts = [elephant.civs[civId], steppe.civs[civId], rider ? knightFact : null].filter(Boolean);
    const allowed = new Set(special.parts.map((part) => part.id));
    const has = [...new Set([...knightFact.has.filter((id) => id.startsWith("tech-")), ...facts.flatMap((fact) => fact.has)])].filter((id) => allowed.has(id));
    const missing = special.upgrades.filter((id) => !(special.alts[id] || [id]).some((alt) => has.includes(alt)));
    special.civs[civId] = {
      tier: !special.gate.some((id) => has.includes(id)) ? "none" : missing.length ? "partial" : "full",
      has, missing, bonus: facts.some((fact) => fact.bonus),
      why: [...new Set(facts.flatMap((fact) => fact.why || []))],
    };
    knightFact.has = knightFact.has.filter((id) => !riderIds.includes(id));
    knightFact.missing = knight.upgrades.filter((id) => !(knight.alts[id] || [id]).some((alt) => knightFact.has.includes(alt)));
    if (!knight.gate.some((id) => knightFact.has.includes(id))) {
      knightFact.tier = "none";
      knightFact.bonus = false;
      knightFact.why = [];
    }
  }
  knight.name = "Knight / Hei Guang Cavalry";
  knight.parts = knight.parts.filter((part) => !riderIds.includes(part.id));
  const eliteHeiGuang = knight.parts.find((part) => part.id === "unit-1946");
  if (eliteHeiGuang) eliteHeiGuang.name = "Elite Hei Guang Cavalry";
  knight.gate = knight.gate.filter((id) => !riderIds.includes(id));
  knight.alts = Object.fromEntries(Object.entries(knight.alts).map(([id, alts]) => [id, alts.filter((alt) => !riderIds.includes(alt))]));
  state.data.topics = state.data.topics.filter((topic) => ![elephant.id, steppe.id].includes(topic.id));
  state.data.topics.push(special);
  mergeUnitTopics(["hussar", "paladin"], {
    id: "scout_knight", name: "Scout + Knight", group: "Stable",
    icon: "img/topics/building-stable.png", images: [hussar.icon, knight.icon],
  });
  mergeUnitTopics(["camel", "regional_cavalry"], {
    id: "special_cavalry", name: "Special Cavalry", group: "Stable",
    icon: "img/topics/building-stable.png", images: [camel.icon, special.icon],
  });
}

function prepareDefenseControls() {
  const topic = state.data.topics.find((topic) => topic.id === "defense");
  if (!topic?.buildingLevels) return;
  const levels = topic.buildingLevels;
  const line = (id, ids, upgrades) => ({
    id, unit: ids[1], below: ids[0] ? levels.parts.find((part) => part.id === ids[0]) : null,
    parts: levels.parts.filter((part) => ids.includes(part.id)),
    upgrades: [ids[2]], alts: {}, stateIds: ids, replacedUpgrades: upgrades,
  });
  topic.merged = [
    line("defense_towers", ["building-79", "building-234", "building-235"], ["tech-63"]),
    line("defense_walls", [null, "building-117", "building-155"], ["tech-194"]),
    line("defense_masonry", [null, "tech-50", "tech-51"], ["tech-51"]),
  ];
  topic.merged[0].parts.push(levels.parts.find((part) => part.id === "building-1665"));
  for (const [civId, fact] of Object.entries(topic.civs)) {
    fact.mergedFacts = Object.fromEntries(topic.merged.map((child) => [child.id, {
      has: levels.civs[civId], missing: [], tier: "partial",
    }]));
  }
}

function prepareBlacksmithTopic() {
  const topic = state.data.topics.find((topic) => topic.id === "blacksmith");
  if (!topic?.blacksmithLines) return;
  const names = ["Infantry Armor", "Cavalry Armor", "Archer Armor", "Archer Attack", "Melee Attack"];
  topic.icon = "img/topics/building-blacksmith.png";
  topic.merged = topic.blacksmithLines.map((ids, index) => ({
    id: `blacksmith_${index}`,
    name: names[index],
    unit: ids[1],
    below: topic.parts.find((part) => part.id === ids[0]),
    parts: topic.parts.filter((part) => ids.includes(part.id)),
    upgrades: [ids[2]],
    alts: {},
    stateIds: ids,
    blacksmithLine: true,
    replacedUpgrades: [ids[2]],
  }));
  for (const fact of Object.values(topic.civs)) {
    fact.mergedFacts = Object.fromEntries(topic.merged.map((child) => [child.id, {
      tier: "partial", has: fact.has, missing: [], bonus: false, why: [],
    }]));
  }

}

function prepareUnitBlacksmithUpgrades() {
  const blacksmith = state.data.topics.find((topic) => topic.id === "blacksmith");
  if (!blacksmith?.merged) return;
  const assignments = {
    archer_skirmisher: [2, 3],
    barracks_units: [0, 4],
    cavalry_archer: [2, 3],
    scout_knight: [1, 4],
    special_cavalry: [1, 4],
  };

  for (const [topicId, lineIndexes] of Object.entries(assignments)) {
    const topic = state.data.topics.find((item) => item.id === topicId);
    if (!topic) continue;
    const earlierLevels = new Set(lineIndexes.flatMap((index) => blacksmith.merged[index].stateIds.slice(0, -1)));
    topic.upgrades = topic.upgrades.filter((id) => !earlierLevels.has(id));
  }
}

/* ---------- menu ---------- */

function restoreSelection() {
  let saved = null;
  try {
    const storedSelection = localStorage.getItem(STORE_KEY);
    saved = storedSelection === null ? null : JSON.parse(storedSelection);
    const game = localStorage.getItem(GAME_KEY);
    if (GAMES.includes(game)) state.game = game;
    const storedFormats = localStorage.getItem(FORMAT_KEY);
    if (storedFormats) {
      let formats;
      try {
        const parsed = JSON.parse(storedFormats);
        formats = Array.isArray(parsed) ? parsed : [parsed];
      } catch (ignored) {
        formats = [storedFormats];
      }
      const valid = formats.filter((format) => FORMATS.includes(format));
      state.formats = new Set(valid);
    }
    const known = JSON.parse(localStorage.getItem(KNOWN_KEY) || "{}");
    if (known && typeof known === "object") {
      state.known = mergeFormatKnowledge(known);
      localStorage.setItem(KNOWN_KEY, JSON.stringify(state.known));
    }
    const playerName = (localStorage.getItem(PLAYER_KEY) || "").trim();
    if (playerName.length >= 2 && playerName.length <= 24) state.playerName = playerName;
  } catch (ignored) {
    saved = null;
  }
  const known = state.data.topics.map((t) => t.id);
  const mergedIds = Object.fromEntries(state.data.topics.flatMap((topic) =>
    (topic.merged || []).map((child) => [child.id, topic.id])
  ));
  if (known.includes("special_cavalry")) {
    mergedIds.battle_elephant = "special_cavalry";
    mergedIds.steppe_lancer = "special_cavalry";
  }
  const legacyIds = { stable_units: ["scout_knight", "special_cavalry"] };
  const wanted = Array.isArray(saved)
    ? saved.flatMap((id) => legacyIds[id] || [mergedIds[id] || id]).filter((id) => known.includes(id))
    : null;
  state.selected = new Set(wanted || []);
}

function rememberSelection() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify([...state.selected]));
    localStorage.setItem(GAME_KEY, state.game);
    localStorage.setItem(FORMAT_KEY, JSON.stringify([...state.formats]));
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

/* Older versions tracked Standard, Reverse and Difference independently. Keep
   the strongest record for each topic/civilisation and use it for every format. */
function mergeFormatKnowledge(records) {
  const merged = {};
  for (const [key, value] of Object.entries(records)) {
    const sharedKey = key.replace(/^(reverse|difference):/, "");
    const candidate = typeof value === "number" ? { k: value, w: 0, t: null } : value;
    const current = merged[sharedKey];
    const better = !current
      || candidate.k > current.k
      || (candidate.k === current.k && (candidate.w || 0) < (current.w || 0));
    if (better) merged[sharedKey] = candidate;
  }
  for (const [key, candidate] of Object.entries(merged)) {
    if (!key.startsWith("stable_units:")) continue;
    const suffix = key.slice("stable_units".length);
    for (const topicId of ["scout_knight", "special_cavalry"]) {
      const target = `${topicId}${suffix}`;
      const current = merged[target];
      if (!current || candidate.k > current.k || (candidate.k === current.k && (candidate.w || 0) < (current.w || 0))) {
        merged[target] = candidate;
      }
    }
    delete merged[key];
  }
  return merged;
}

function knownKey(card) {
  return `${card.topicId}:${card.civId}`;
}

/* What is remembered about a card: how well it is known, how many times it has
   been got wrong, and its smoothed response pace. Stored as a number alone
   before the extra signals were counted, so a plain number still reads as a
   clean record. */
function recordOf(card) {
  const entry = state.known[knownKey(card)];
  if (entry === undefined || entry === null) return null;
  return typeof entry === "number" ? { k: entry, w: 0, t: null } : entry;
}

function knownOf(card) {
  const record = recordOf(card);
  return record ? record.k : 0;
}

function missesOf(card) {
  const record = recordOf(card);
  return record ? record.w : 0;
}

/* Answered at nothing is not the same as never answered, so the entry is kept
   even at 0: it is the difference between a card you keep failing and one the
   deck has never put in front of you, and the menu counts the second sort. */
function responsePace(elapsedSeconds, clicks) {
  const thinkingSeconds = Math.max(0, elapsedSeconds - Math.max(0, clicks) * RESPONSE_CLICK_SECONDS);
  return thinkingSeconds / RESPONSE_THINK_SECONDS;
}

function learnFrom(card, verdict, elapsedSeconds, clicks) {
  const was = knownOf(card);
  const misses = missesOf(card);
  const previous = recordOf(card);
  const measuredPace = responsePace(elapsedSeconds, clicks);
  const pace = previous?.t == null ? measuredPace : previous.t * 0.65 + measuredPace * 0.35;
  const confidence = pace <= 0.65
    ? 1.08
    : pace <= 1
    ? 1
    : pace <= 1.75
    ? 1 - ((pace - 1) / 0.75) * 0.3
    : 0.55;
  const climb = Math.min(0.85, (KNOWN_STEP.right * confidence) / (1 + misses * MISS_DAMP));
  const moved = Math.round(
    verdict === "right" ? was + (100 - was) * climb : was * KNOWN_STEP[verdict]
  );
  const record = {
    k: Math.max(0, Math.min(100, moved)),
    w:
      verdict === "wrong"
        ? Math.min(MISS_CAP, misses + 1)
        : verdict === "right" && was >= MISS_FORGIVEN_AT
        ? Math.max(0, misses - 1)
        : misses,
    t: Math.round(pace * 100) / 100,
  };
  state.known[knownKey(card)] = record;
  rememberKnown();

  // and when to ask it again, counted from the card it was asked on
  const [from, to] = repeatRange(verdict, knownOf(card));
  const gap = from + Math.random() * (to - from);
  state.due[knownKey(card)] = state.index + Math.round(gap);
}

function repeatRange(verdict, known) {
  if (verdict !== "right") return AGAIN_AFTER[verdict];
  if (known < 40) return [3, 6];
  if (known < 65) return [5, 10];
  if (known < 80) return [8, 16];
  if (known < 92) return [16, 32];
  if (known < 98) return [35, 70];
  if (known < 100) return [80, 160];
  return [180, 360];
}

function isNew(card) {
  return recordOf(card) === null;
}

/* The database owns the best-score rule so two tabs cannot race each other:
   one case-insensitive player name has one row, replaced only by a higher score. */
async function recordScore(entry) {
  if (!state.supabase) throw new Error("Leaderboard is not configured");
  const { data, error } = await state.supabase
    .rpc("submit_best_score", {
      p_player_name: state.playerName,
      p_score: entry.score,
      p_right_answers: entry.right,
      p_cards: entry.cards,
      p_topics: entry.topics,
      p_formats: entry.formats,
      p_scoring_version: SCORING_VERSION,
      p_avatar_url: state.avatarUrl || null,
    })
    .single();
  if (error) throw error;
  state.lastScoreId = data.score_id;
  return data;
}

async function loadScores(boardKey) {
  if (!state.supabase) throw new Error("Leaderboard is not configured");
  let query = state.supabase
    .from("scores")
      .select("id, player_name, avatar_url, provider, score, right_answers, cards, topics, formats, question_format, leaderboard_key, scoring_version, created_at")
    .eq("scoring_version", SCORING_VERSION)
    .eq("is_current", true);
  if (boardKey !== "any") query = query.eq("leaderboard_key", boardKey);
  let result = await query
    .order("score", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(TOP_SCORES);
  // Keep the public board readable while the additive database migration has
  // not yet been run. Old rows have question_format but not the v2 columns.
  if (result.error && ["42501", "42703", "PGRST204"].includes(result.error.code)) {
    let legacyQuery = (state.publicSupabase || state.supabase)
      .from("scores")
      .select("id, player_name, score, right_answers, cards, topics, formats, question_format, created_at");
    if (boardKey !== "any") legacyQuery = legacyQuery.eq("question_format", boardKey);
    result = await legacyQuery
      .order("score", { ascending: false })
      .order("created_at", { ascending: true })
      .limit(TOP_SCORES);
  }
  const { data, error } = result;
  if (error) throw error;
  return data.map((entry) => ({
      id: entry.id,
      player: entry.player_name,
      avatar: safeAvatarUrl(entry.avatar_url),
      provider: entry.provider || "legacy",
    score: entry.score,
    right: entry.right_answers,
    cards: entry.cards,
    topics: entry.topics,
    formats: entry.formats || [entry.question_format || "normal"],
    format: entry.question_format,
    leaderboardKey: entry.leaderboard_key || entry.question_format,
    scoringVersion: entry.scoring_version || 1,
    at: entry.created_at,
  }));
}

/* How well the selection is known as one number, for the menu and the bar. */
function knownShare(cards) {
  if (!cards.length) return 0;
  return Math.round(cards.reduce((sum, card) => sum + knownOf(card), 0) / cards.length);
}

function setFormat(format) {
  if (!FORMATS.includes(format)) return;
  if (state.formats.has(format)) {
    state.formats.delete(format);
  } else {
    state.formats.add(format);
  }
  rememberSelection();
  renderMenu();
  refreshPlayerRank();
}

function chooseTopic(id) {
  if (state.selected.has(id)) state.selected.delete(id);
  else state.selected.add(id);
  rememberSelection();
  renderMenu();
}

function chooseTopicGroup(ids) {
  const select = ids.some((id) => !state.selected.has(id));
  for (const id of ids) select ? state.selected.add(id) : state.selected.delete(id);
  rememberSelection();
  renderMenu();
}

function topicToggle(label, ids, extraClass = "") {
  const chosen = ids.filter((id) => state.selected.has(id)).length;
  const pressed = chosen === ids.length;
  const mixed = chosen > 0 && !pressed;
  const button = document.createElement("button");
  button.type = "button";
  button.className = `topic-section-toggle ${extraClass}`.trim();
  button.setAttribute("aria-pressed", String(pressed));
  if (mixed) button.dataset.mixed = "true";
  button.innerHTML = `<span class="section-check"><svg><use href="#mark-${pressed ? "full" : mixed ? "partial" : "none"}"/></svg></span><span>${label}</span>`;
  button.addEventListener("click", () => chooseTopicGroup(ids));
  return button;
}

function renderMenu() {
  const grid = el("topic-grid");
  grid.innerHTML = "";

  const topics = [...state.data.topics].sort((a, b) => {
    return a.id === "cavalry_archer" ? 1 : b.id === "cavalry_archer" ? -1 : 0;
  });
  grid.append(topicToggle("All topics", topics.map((topic) => topic.id), "all-topics"));

  const tiles = document.createElement("div");
  tiles.className = "tiles";
  for (const topic of topics) {
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
  grid.append(tiles);
  for (const button of el("formats").querySelectorAll(".format")) {
    button.setAttribute("aria-pressed", String(state.formats.has(button.dataset.format)));
  }

  const pool = deckNow();
  for (const button of el("games").querySelectorAll(".game")) button.disabled = pool.length === 0;
  el("pool-note").textContent = !pool.length
    ? !state.selected.size && !state.formats.size
      ? "Select at least one topic and question format"
      : !state.selected.size
      ? "Select at least one topic"
      : "Select at least one question format"
    : `${pool.length} cards · ${knownShare(pool)}% known${fresh(pool)} · Play: ${CARD_SECONDS}s each, points ×${scoreCoefficient().toFixed(2)}`;
  renderPlayerName();
  markScrollable(grid);
}

function renderPlayerName() {
  const button = el("player-name");
  const avatar = button.querySelector(".profile-avatar");
  const container = button.querySelector(".profile-copy");
  const label = state.playerName || "Choose name";
  avatar.replaceChildren();
  if (safeAvatarUrl(state.avatarUrl)) {
    const image = document.createElement("img");
    image.src = state.avatarUrl;
    image.alt = "";
    image.referrerPolicy = "no-referrer";
    avatar.append(image);
  } else {
    avatar.textContent = initials(label);
  }
  container.replaceChildren();
  const name = document.createElement("span");
  name.className = "player-label";
  name.textContent = label;
  container.append(name);
  if (state.playerRank) {
    const rank = document.createElement("b");
    rank.className = "player-rank";
    rank.textContent = `#${state.playerRank}`;
    container.append(rank);
  }
}

function playSize(pool) {
  return Math.min(PLAY_CARDS, pool.length);
}

/* Breadth is harder, but its reward has diminishing returns. Formats have
   separate leaderboards, so mixing them no longer changes the score. */
function scoreCoefficient(topicCount = state.selected.size) {
  return 1 + 0.15 * Math.sqrt(Math.max(0, topicCount - 1));
}

function formatKey(formats) {
  if (formats.length > 1) return "mixed";
  return formats[0] || "normal";
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
  if (topic.id === "monk") return ["img/topics/building-monastery.png"];
  if (topic.images) return topic.images;
  const groups = Object.values(topic.alts || {}).filter((group) => group.length > 1);
  const icon = topic.parts.find((part) => part.img === topic.icon);
  // the icon's own group, or the icon alone: the Light Cavalry is one unit even
  // though the Hussar above it comes in two
  const group = icon && groups.find((g) => g.includes(icon.id));
  if (!group) return [topic.icon];
  return group.map((id) => topic.parts.find((part) => part.id === id).img);
}

function deckNow() {
  const cards = buildDeck(state.data, [...state.selected]);
  return shuffle(cards.flatMap((card) => [...state.formats].map((format) => ({ ...card, format }))));
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
     handful wrong puts them back every two to four cards each, which between
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
  state.due = {};
  for (const card of deckNow()) {
    if (isNew(card)) continue;
    const [, span] = repeatRange("right", knownOf(card));
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
  state.answerStartedAt = Date.now();
  state.question = buildQuestion(card);
  layStack();
  renderBoardCard(card);
  renderProgress();
  startClock();
}

function buildQuestion(card) {
  const format = card.format || "normal";
  if (format === "normal") return { format: "normal" };
  const { topic, answer } = truth(state.data, card);
  if (format === "reverse") {
    const target = configurationOf(topic, answer, card.civId);
    const others = Object.keys(topic.civs).filter((id) => id !== card.civId);
    const matching = shuffle(others.filter((id) =>
      configurationDistance(target, configurationOf(topic, topic.civs[id], id)) === 0
    )).slice(0, 2);
    const distractors = shuffle(others.filter((id) => !matching.includes(id)))
      .map((id) => ({ id, distance: configurationDistance(target, configurationOf(topic, topic.civs[id], id)) }))
      .filter((item) => item.distance > 0)
      .sort((a, b) => a.distance - b.distance);
    const size = 8;
    const choices = shuffle([card.civId, ...matching, ...distractors.slice(0, size - matching.length - 1).map((item) => item.id)]);
    const correct = new Set(choices.filter((id) =>
      configurationDistance(target, configurationOf(topic, topic.civs[id], id)) === 0
    ));
    return { format: "reverse", target, choices, correct };
  }

  const own = configurationOf(topic, answer, card.civId);
  const candidates = shuffle(Object.keys(topic.civs).filter((id) => id !== card.civId))
    .map((id) => ({ id, distance: configurationDistance(own, configurationOf(topic, topic.civs[id], id)) }))
    .filter((item) => item.distance > 0)
    .sort((a, b) => a.distance - b.distance);
  const nearby = candidates.slice(0, Math.min(8, candidates.length));
  const partnerId = (nearby[Math.floor(Math.random() * nearby.length)] || candidates[0])?.id
    || Object.keys(topic.civs).find((id) => id !== card.civId);
  const partner = configurationOf(topic, topic.civs[partnerId], partnerId);
  const children = topic.merged || [topic];
  const unitOptions = children
    .filter((child) => unitStateData(child, topic.merged ? answer.mergedFacts[child.id] : answer, card.civId))
    .map((child, index) => ({
      id: `difference-unit:${child.id}`,
      name: `${child.name} level`,
      art: tileHtml(child),
      differs: own.units[index] !== partner.units[index],
    }));
  const upgradeOptions = claimables(topic)
    .map((item, index) => ({
      id: `difference-upgrade:${item.id}`,
      name: item.name,
      art: item.art,
      differs: own.upgrades[index] !== partner.upgrades[index],
    }));
  const options = [...unitOptions, ...upgradeOptions];
  return {
    format: "difference",
    partnerId,
    options,
    correct: new Set(options.filter((item) => item.differs).map((item) => item.id)),
  };
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
  const question = state.question;
  const node = document.createElement("div");
  node.className = "card";
  // Defense and Economy are their own section, so the kicker would say the name
  // back to itself
  const band = `${tileHtml(topic)}
    <span class="names">
      ${topic.group === topic.name ? "" : `<span class="topic-where">${topic.group}</span>`}
      <span class="topic-what">${topic.name}</span>
    </span>`;
  const frontIdentity = question.format === "reverse"
    ? `<div class="reverse-card-configuration">
         <span class="reverse-question">Which civilisations match?</span>
         ${configurationPromptHtml(topic, fact, card.civId)}
       </div>`
    : question.format === "difference"
    ? `<div class="plate difference-plate">
         ${civChoiceHtml(card.civId, false)}
         <b>vs</b>
         ${civChoiceHtml(question.partnerId, false)}
       </div>
       <div class="civ-name">What is different?</div>`
    : `<div class="plate">
         <img class="emblem" src="${civ.img}" alt="${civ.name}">
         <span class="subject">${tileHtml(topic)}</span>
       </div>
       <div class="civ-name">${civ.name}</div>`;
  node.innerHTML = `
    <div class="card-inner">
      <div class="face front">
        <div class="topic-band">${band}</div>
        ${frontIdentity}
      </div>
      <div class="face back">
        <div class="topic-band">${band}
          <b class="card-delta"></b>
        </div>
        <div class="who">
          <img class="emblem" src="${civ.img}" alt="">
          <div class="civ-name">${civ.name}</div>
        </div>
        <div class="parts configuration-neighbors"></div>
        <div class="card-note"></div>
        <div class="bonus-slot"></div>
        <div class="next-hint">
          <svg><use href="#icon-play"/></svg><svg><use href="#icon-play"/></svg>
        </div>
        <div class="auto-bar"></div>
      </div>
    </div>`;
  el("stack").append(node);
  if (question.format === "normal") openBoard(card);
  else openAlternateBoard(card);
}

function civChoiceHtml(civId, showName = true) {
  const civ = state.data.civs[civId];
  return `<span class="quiz-civ"><img src="${civ.img}" alt="${civ.name}">${showName ? `<b>${civ.name}</b>` : ""}</span>`;
}

function configurationPromptHtml(topic, fact, civId) {
  const children = topic.merged || [topic];
  const units = children
    .filter((child) => unitStateData(child, topic.merged ? fact.mergedFacts[child.id] : fact, civId))
    .map((child) => {
      const childFact = topic.merged ? fact.mergedFacts[child.id] : fact;
      const data = unitStateData(child, childFact, civId);
      const id = unitStateFor(child, childFact, civId);
      const unit = data.states.find((item) => item.id === id);
      const art = id === NO_UNIT_ID
        ? '<svg class="missing-mark"><use href="#mark-none"/></svg>'
        : child.parts.some((part) => part.id === id)
        ? splitHtml(slotImages(child, id), slotName(child, unit))
        : `<img src="${unit.img || child.icon}" alt="${unit.name}">`;
      return `<span class="configuration-answer unit" title="${child.name}: ${unit.name}">${art}</span>`;
    });
  const upgrades = claimables(topic)
    .map(({ id, name, art }) => {
      const on = wanted(fact, id);
      return `<span class="configuration-answer ${on ? "on" : "off"}" title="${name}: ${on ? "present" : "missing"}">
        ${art}<b><svg><use href="#mark-${on ? "right" : "wrong"}"/></svg></b>
      </span>`;
    });
  return `<div class="configuration-prompt">${[...units, ...upgrades].join("")}</div>`;
}

function openAlternateBoard(card) {
  const question = state.question;
  state.phase = "picking";
  state.picked = {};
  state.answerClicks = 0;
  state.results[state.index] = { card, right: false, clean: true, delta: 0, picks: null, format: question.format };

  const reverse = question.format === "reverse";
  const options = reverse
    ? question.choices.map((civId) => `<button class="answer-option civ-option" data-answer-id="${civId}" aria-pressed="false">${civChoiceHtml(civId)}<i class="verdict"></i></button>`).join("")
    : question.options.map((item) => `<button class="answer-option difference-option" data-answer-id="${item.id}" aria-pressed="false">
        <span class="difference-art">${item.art}</span><b>${item.name}</b><i class="verdict"></i>
      </button>`).join("");
  const prompt = reverse
    ? `Select every matching civilisation`
    : `Which parts differ between <b>${state.data.civs[card.civId].name}</b> and <b>${state.data.civs[question.partnerId].name}</b>?`;
  el("pad").className = `pad claiming alternate ${question.format}`;
  el("pad").innerHTML = `
    <p class="ask-words">${prompt}</p>
    <div class="answer-options ${question.format}">${options}</div>
    <div class="claim-actions">
      <button id="picker-done" class="act primary" title="check these selections">
        <svg><use href="#mark-right"/></svg><span>done</span>
      </button>
    </div>`;
}

function evaluateAlternateAnswer(button) {
  if (state.phase !== "picking") return;
  const id = button.dataset.answerId;
  if (state.game === "play") {
    state.answerClicks += 1;
    const selected = state.picked[id] !== "selected";
    if (selected) state.picked[id] = "selected";
    else delete state.picked[id];
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-pressed", String(selected));
    return;
  }
  if (state.picked[id]) return;
  const hit = state.question.correct.has(id);
  const outcome = hit ? "spotted" : "falsely";
  state.picked[id] = outcome;
  state.answerClicks += 1;
  button.classList.add(outcome, "done");
  button.setAttribute("aria-pressed", "true");
  const verdict = button.querySelector(".verdict");
  if (verdict) verdict.innerHTML = `<svg><use href="#mark-${hit ? "right" : "wrong"}"/></svg>`;
  const worth = hit ? POINTS.upgrade : POINTS.upgradeWrong;
  state.results[state.index].delta += worth;
  bumpScore(worth);
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
  state.answerClicks = 0;
  state.unitState = topic.merged ? Object.fromEntries(topic.merged.map((child) => [child.id, defaultUnitStateId(child)])) : defaultUnitStateId(topic);
  state.results[state.index] = { card, right: false, clean: true, delta: 0, picks: null };

  const pad = el("pad");
  pad.className = "pad claiming";
  // every civ's name is a plural or a collective, so "do the Franks" and "do
  // the Shu" both read
  pad.innerHTML = `
    <p class="ask-words">which upgrades do the <b>${civ.name}</b> have?</p>
    <div class="board">
      ${topic.merged
        ? `<div class="unit-state-pair">${topic.merged.map((unitTopic) => unitStatesHtml(unitTopic, unitTopic.id)).join("")}</div>`
        : unitStatesHtml(topic)}
      <div class="claims" style="--columns: ${columnsFor(tileCount(topic))}">
        ${shuffle(claimables(topic))
          .map(
            ({ id, name, art }) => `<button class="upgrade" data-id="${id}" title="${name}">
              ${art}<b class="verdict"></b>
            </button>`
          )
          .join("")}
      </div>
    </div>
    <div class="claim-actions">
      <button id="claim-all" class="act full" title="every upgrade and the highest unit state">
        <svg><use href="#mark-full"/></svg><span>full</span>
      </button>
      <button id="picker-done" class="act primary" title="that is all of them">
        <svg><use href="#mark-right"/></svg><span>done</span>
      </button>
    </div>`;
  syncDoneState();
}

function unitStates(topic) {
  const data = unitStateData(topic);
  return data ? data.states : [];
}

function middleUnitId(topic) {
  const data = unitStateData(topic);
  return data && data.middle ? data.middle.id : "";
}

function defaultUnitStateId(topic) {
  const data = unitStateData(topic);
  if (!data) return "";
  if (["eagle", "camel", "regional_cavalry"].includes(topic.id) && data.states.some((state) => state.id === NO_UNIT_ID)) {
    return NO_UNIT_ID;
  }
  return data.default || data.middle.id;
}

function unitStatesHtml(topic, unitKey = "") {
  const data = unitStateData(topic);
  if (!data) return "";
  return `<div class="unit-states" role="group" aria-label="unit level">
    ${unitStates(topic).map((unit, index) => {
      const label = !data.three && data.lower.id === NO_UNIT_ID && unit.id === data.middle.id
        ? "Present"
        : stateLabel(topic, unit, index);
      return `
      <button class="unit-state${unit.id === defaultUnitStateId(topic) ? " selected" : ""}"
        data-unit-state="${unit.id}"${unitKey ? ` data-unit-key="${unitKey}"` : ""} title="${label}" aria-pressed="${unit.id === defaultUnitStateId(topic)}">
        ${unit.id === NO_UNIT_ID ? '<svg class="missing-mark" aria-label="Missing"><use href="#mark-none"/></svg>' : stateArt(topic, unit, index, label)}<span>${label}</span><b class="verdict"></b>
      </button>`;
    }).join("")}
  </div>`;
}

function stateLabel(topic, unit, index) {
  if (unit.id === NO_UNIT_ID) return unit.name;
  if (topic.id === "paladin") return [
    "Missing / Knight",
    "Cavalier / Hei Guang Cavalry",
    "Paladin / Savar / Elite Hei Guang Cavalry",
  ][index];
  if (topic.id === "onager") return ["Mangonel", "Onager / Rocket Cart", "Siege Onager / Heavy Rocket Cart"][index];
  if (topic.id === "siege_ram") return ["Battering Ram", "Capped Ram / Siege Elephant", "Siege Ram / Armored Elephant"][index];
  if (topic.id === "champion") return [
    "Man-at-Arms / Long Swordsman / Champi Runner",
    "Two-Handed Swordsman / Champi Warrior",
    "Champion / Legionary / Elite Champi Warrior",
  ][index];
  if (topic.blacksmithLine && index === 0) return `${unit.name} / No upgrade`;
  if (topic.id === "hussar" && index === 0) return "Scout Cavalry / Missing Scout";
  if (topic.id === "hand_cannoneer") return ["Missing", "Hand Cannoneer without Ring Archer Armor", "Hand Cannoneer + Ring Archer Armor"][index];
  if (topic.id === "bombard_cannon") return ["Missing", "Bombard Cannon / Traction Trebuchet without Siege Engineers", "Bombard Cannon / Traction Trebuchet + Siege Engineers"][index];
  if (["onager", "cavalry_archer", "eagle", "hussar", "paladin", "regional_cavalry"].includes(topic.id) && topic.parts.some((part) => part.id === unit.id)) return slotName(topic, unit);
  return unit.name;
}

function stateArt(topic, unit, index, label) {
  if (topic.id === "paladin" && index === 0) {
    return `<span class="split n2 unit-or-missing"><img src="${unit.img}" alt="Knight" title="Knight"><svg class="split-missing" aria-label="Missing"><use href="#mark-none"/></svg></span>`;
  }
  if (topic.blacksmithLine && index === 0) {
    return `<span class="split n2 unit-or-missing"><img src="${unit.img}" alt="${unit.name}" title="${unit.name}"><svg class="split-missing" aria-label="No upgrade"><use href="#mark-none"/></svg></span>`;
  }
  if (topic.id === "hussar" && index === 0) {
    return `<span class="split n2 unit-or-missing"><img src="${unit.img}" alt="Scout Cavalry" title="Scout Cavalry"><svg class="split-missing" aria-label="Missing Scout"><use href="#mark-none"/></svg></span>`;
  }
  if (topic.id === "hand_cannoneer" && index === 2) {
    const data = unitStateData(topic);
    return splitHtml([...slotImages(topic, data.middle.id), data.upper.img], label);
  }
  if (topic.id === "bombard_cannon") {
    if (index === 2) return splitHtml([
      topic.parts.find((part) => part.id === "unit-36").img,
      topic.parts.find((part) => part.id === "unit-1942").img,
      topic.parts.find((part) => part.id === "tech-377").img,
    ], label);
    if (index === 1) return splitHtml([
      topic.parts.find((part) => part.id === "unit-36").img,
      topic.parts.find((part) => part.id === "unit-1942").img,
    ], label);
  }
  if (["champion", "siege_ram", "onager", "cavalry_archer", "eagle", "hussar", "paladin", "regional_cavalry"].includes(topic.id) && topic.parts.some((part) => part.id === unit.id)) {
    const parts = slotGroup(topic, unit.id);
    if (parts.length > 1) return `<span class="split n${parts.length}">${parts.map((part) => `<img src="${part.img}" alt="${part.name}" title="${part.name}">`).join("")}</span>`;
  }
  return `<img src="${unit.img}" alt="${label}">`;
}

function unitStateData(topic, fact = currentUnitFact(topic), civId = state.deck[state.index]?.civId) {
  if (topic.id === "monk") return null;
  const customLevels = {
    champion: ["unit-75", "unit-473", "unit-567"],
    paladin: ["unit-38", "unit-283", "unit-569"],
    siege_ram: ["unit-1258", "unit-422", "unit-548"],
    onager: ["unit-280", "unit-550", "unit-588"],
  }[topic.id];
  if (customLevels) {
    const [lowerId, middleId, upperId] = customLevels;
    const lower = topic.parts.find((part) => part.id === lowerId);
    const middle = topic.parts.find((part) => part.id === middleId);
    const upper = topic.parts.find((part) => part.id === upperId);
    return { lower, middle, upper, states: [lower, middle, upper], three: true, default: middle.id };
  }
  if (topic.stateIds) {
    const [low, mid, top] = topic.stateIds;
    const lowerId = topic.id === "defense_towers" && civId === "sicilians" ? "building-1665" : low;
    const lower = lowerId ? topic.parts.find((part) => part.id === lowerId)
      : { id: NO_UNIT_ID, name: topic.id === "defense_walls" ? "No Stone Walls" : topic.id === "defense_masonry" ? "No Masonry" : "No tower" };
    const middle = topic.parts.find((part) => part.id === mid);
    const upper = topic.parts.find((part) => part.id === top);
    return { lower, middle, upper, states: [lower, middle, upper], three: true };
  }
  if (!topic.unit) return null;
  const middle = topic.parts.find((part) => part.id === topic.unit);
  const upper = topic.parts.find((part) => part.id === topic.upgrades.find((id) => id.startsWith("unit-")));
  if (!middle) return null;
  const lower = topic.below || { id: NO_UNIT_ID, name: "Missing", img: topic.icon };
  if (["hand_cannoneer", "bombard_cannon"].includes(topic.id)) {
    const upgradeId = topic.id === "hand_cannoneer" ? "tech-219" : "tech-377";
    const full = topic.parts.find((part) => part.id === upgradeId);
    const missing = { id: NO_UNIT_ID, name: "Missing" };
    if (topic.id === "bombard_cannon") {
      return { lower: missing, middle, upper: full, states: [missing, middle, full], three: true, default: middle.id };
    }
    return { lower: missing, middle, upper: full, states: [missing, middle, full], three: true, default: middle.id };
  }
  if (!upper) return { lower, middle, states: [lower, middle], three: false };
  return {
    lower,
    middle,
    upper,
    states: [lower, middle, upper],
    three: true,
  };
}

function currentUnitFact(unitTopic) {
  const card = state.deck[state.index];
  if (!card || !state.data) return null;
  const topic = state.data.topics.find((item) => item.id === card.topicId);
  const fact = topic?.civs[card.civId];
  return topic?.merged ? fact?.mergedFacts?.[unitTopic.id] : fact;
}

function chooseUnitState(id, unitKey = "", holding = false) {
  const topic = state.data.topics.find((item) => item.id === state.deck[state.index].topicId);
  const unitTopic = topic.merged ? topic.merged.find((item) => item.id === unitKey) : topic;
  const pickedKey = unitKey ? `${UNIT_STATE_ID}:${unitKey}` : UNIT_STATE_ID;
  if (state.phase !== "picking" || !unitStateData(unitTopic) || (state.game === "learn" && state.picked[pickedKey])) return;
  if (!holding) state.answerClicks += 1;
  const { answer } = truth(state.data, state.deck[state.index]);
  const fact = topic.merged ? answer.mergedFacts[unitKey] : answer;
  if (unitKey) state.unitState[unitKey] = id;
  else state.unitState = id;
  for (const button of el("pad").querySelectorAll(".unit-state")) {
    if ((button.dataset.unitKey || "") !== unitKey) continue;
    const selected = button.dataset.unitState === id && (button.dataset.unitKey || "") === unitKey;
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  }
  if (state.game === "play") {
    syncDoneState();
    return;
  }
  const hit = id === unitStateFor(unitTopic, fact);
  const outcome = hit ? "spotted" : "falsely";
  state.picked[pickedKey] = outcome;
  const value = unitStatePoints(unitTopic);
  const worth = hit ? value : -value;
  state.results[state.index].delta += worth;
  bumpScore(worth);
  markUnitState(outcome, unitKey);
  syncDoneState();
}

function syncDoneState() {
  const done = el("picker-done");
  if (!done) return;
  done.disabled = false;
  done.title = "use the selected unit states, mark the remaining upgrades absent and reveal";
}

function tileCount(topic) {
  return claimables(topic).length;
}

/* Two even rows rather than a full one and a remainder: five upgrades are 3 and
   2, not 4 and 1. Four is the widest the rails leave room for. */
function columnsFor(tiles) {
  return tiles <= 3 ? tiles : Math.ceil(tiles / 2);
}

function unitStatePoints(topic) {
  const states = unitStates(topic);
  const alternatives = Math.max(1, ...states
    .filter((state) => state.id !== NO_UNIT_ID && topic.parts.some((part) => part.id === state.id))
    .map((state) => slotGroup(topic, state.id).length));
  return states.length * POINTS.unitPerState + (alternatives - 1) * POINTS.unitAlternative;
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

/* The board itself is the upgrades. */
function claimables(topic) {
  const unitData = unitStateData(topic);
  const mergedUnits = new Set(topic.merged ? topic.merged.flatMap((item) => item.parts.filter((part) => part.id.startsWith("unit-")).map((part) => part.id)) : []);
  for (const child of topic.merged || []) for (const id of child.replacedUpgrades || []) mergedUnits.add(id);
  const stateIds = unitData?.three
    ? new Set([unitData.middle.id, unitData.second?.id, unitData.upper.id])
    : new Set();
  const tiles = topic.upgrades.filter((id) => !mergedUnits.has(id) && !stateIds.has(id)).map((id) => {
    const part = topic.parts.find((p) => p.id === id);
    const name = slotName(topic, part);
    return { id, name, art: splitHtml(slotImages(topic, id), name) };
  });
  return tiles;
}

/* "all of them are there": every tile still unanswered, claimed at once, and
   that is the answer -- the bonus is not an upgrade, so this does not claim it. */
function claimAll() {
  if (state.phase !== "picking") return;
  state.answerClicks += 1;
  const card = state.deck[state.index];
  const { topic } = truth(state.data, card);
  const unitData = unitStateData(topic);
  if (topic.merged) {
    for (const child of topic.merged) {
      const key = `${UNIT_STATE_ID}:${child.id}`;
      const childData = unitStateData(child);
      if (!state.picked[key]) chooseUnitState((childData.upper || childData.middle).id, child.id, true);
    }
  } else if (unitData && !state.picked[UNIT_STATE_ID]) {
    chooseUnitState((unitData.upper || unitData.middle).id, "", true);
  }
  for (const button of el("pad").querySelectorAll(".upgrade")) {
    if (!state.picked[button.dataset.id]) pick(button.dataset.id, true);
  }
  finishPicks();
}

/* leaving the game mid-board: the next card draws its own pad */
function closePicker() {
  el("pad").className = "pad";
}

/* A right claim is one the civ has. The bonus reads its own fact. */
function wanted(fact, id) {
  if (id === NO_UNIT_ID) return fact.tier === "none";
  return !fact.missing.includes(id);
}

/* Learn answers a claim on the spot. Play keeps it as an editable selection;
   Done grades all selections and finalizes every unselected upgrade as absent. */
function pick(id, holding) {
  if (state.phase !== "picking" || (state.game === "learn" && state.picked[id])) return;
  if (!holding) state.answerClicks += 1;
  if (state.game === "play") {
    const selected = state.picked[id] !== "selected";
    if (selected) state.picked[id] = "selected";
    else delete state.picked[id];
    const button = el("pad").querySelector(`[data-id="${id}"], [data-claim="${id}"]`);
    if (button) {
      button.classList.toggle("selected", selected);
      button.setAttribute("aria-pressed", String(selected));
    }
    return;
  }
  const card = state.deck[state.index];
  const { topic, answer: fact } = truth(state.data, card);

  const hit = wanted(fact, id);
  const outcome = hit ? "spotted" : "falsely";
  const worth = hit ? POINTS.upgrade : POINTS.upgradeWrong;
  state.picked[id] = outcome;
  state.results[state.index].delta += worth;
  bumpScore(worth);
  markClaim(id, outcome);
  if (holding) return;

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

/* What you never claimed: the upgrades you missed. */
function finishPicks(answered, timedOut) {
  if (state.phase !== "picking") return;
  if (state.question?.format !== "normal") return finishAlternatePicks(Boolean(timedOut));
  stopClock();
  const card = state.deck[state.index];
  const { topic, answer: fact } = truth(state.data, card);

  let delta = 0;
  for (const [id, outcome] of Object.entries(state.picked)) {
    if (outcome !== "selected") continue;
    const hit = wanted(fact, id);
    const graded = hit ? "spotted" : "falsely";
    state.picked[id] = graded;
    markClaim(id, graded);
    delta += hit ? POINTS.upgrade : POINTS.upgradeWrong;
  }
  const unitData = unitStateData(topic);
  const mergedUnitKeys = topic.merged ? topic.merged.map((item) => item.id) : [];
  const unitHit = topic.merged
    ? mergedUnitKeys.every((key) => {
        const child = topic.merged.find((item) => item.id === key);
        const selected = state.unitState[key] || middleUnitId(child);
        return state.picked[`${UNIT_STATE_ID}:${key}`] === "spotted" || selected === unitStateFor(child, fact.mergedFacts[key]);
      })
    : !unitData || state.picked[UNIT_STATE_ID] === "spotted" || state.unitState === unitStateFor(topic, fact);
  if (topic.merged) {
    for (const key of mergedUnitKeys) {
      if (state.picked[`${UNIT_STATE_ID}:${key}`]) continue;
      const child = topic.merged.find((item) => item.id === key);
      const childFact = fact.mergedFacts[key];
      const expected = unitStateFor(child, childFact);
      const selected = state.unitState[key] || middleUnitId(child);
      const outcome = selected === expected ? "spotted" : "falsely";
      state.unitState[key] = selected;
      state.picked[`${UNIT_STATE_ID}:${key}`] = outcome;
      markUnitState(outcome, key);
      const value = unitStatePoints(child);
      delta += outcome === "spotted" ? value : -value;
    }
  } else if (unitData) {
    if (!state.picked[UNIT_STATE_ID]) {
      const unitOutcome = unitHit ? "spotted" : "falsely";
      state.picked[UNIT_STATE_ID] = unitOutcome;
      markUnitState(unitOutcome);
      const value = unitStatePoints(topic);
      delta += unitHit ? value : -value;
    }
  }
  if (!answered) {
    for (const { id } of claimables(topic)) {
      if (state.picked[id]) continue;
      if (wanted(fact, id)) {
        state.picked[id] = "missed";
        markClaim(id, "missed");
        delta += POINTS.upgradeWrong;
      } else if (!timedOut) {
        state.picked[id] = "cleared";
        delta += POINTS.upgrade;
      }
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
     more; none of them right is a wrong one and costs the wholly-wrong penalty. The clock running
     out is a wrong answer however much of it was right, so it takes the same. */
  const outcomes = Object.values(state.picked);
  const owing = claimables(topic)
    .concat({ id: NO_UNIT_ID })
    .filter(({ id }) => wanted(fact, id) && state.picked[id] !== "spotted");
  const unitShortcut = !topic.merged && state.picked[UNIT_STATE_ID] === "spotted" && state.unitState === NO_UNIT_ID;
  const clean =
    !timedOut &&
    unitHit &&
    !outcomes.includes("falsely") &&
    (unitShortcut || owing.length === 0);
  const named = !timedOut && outcomes.some((outcome) => outcome === "spotted");
  let quick = 0;
  if (clean) {
    delta += POINTS.complete;
    // the whole card right and quick with it, worth up to 20 more; there is no
    // clock to beat when learning
    if (state.game === "play") {
      quick = Math.round((POINTS.speed * Math.max(state.left, 0)) / CARD_SECONDS);
      delta += quick;
    }
  } else if (!named) {
    delta += POINTS.whollyWrong;
  }

  const result = state.results[state.index];
  result.right = clean;
  result.clean = clean || !named;
  result.quick = quick;
  result.timedOut = Boolean(timedOut);
  result.picks = state.picked;
  result.delta += delta;
  if (delta) bumpScore(delta);
  const elapsedSeconds = (Date.now() - state.answerStartedAt) / 1000;
  learnFrom(card, verdictOf(result), elapsedSeconds, state.answerClicks);
  reveal();
}

function finishAlternatePicks(timedOut) {
  stopClock();
  const card = state.deck[state.index];
  const question = state.question;
  const ids = question.format === "reverse" ? question.choices : question.options.map((item) => item.id);
  const correct = question.correct;
  let delta = 0;
  let named = false;
  let clean = !timedOut;

  for (const id of ids) {
    const wantedAnswer = correct.has(id);
    let outcome = state.picked[id];
    if (outcome === "selected") {
      outcome = wantedAnswer ? "spotted" : "falsely";
      state.picked[id] = outcome;
      delta += wantedAnswer ? POINTS.upgrade : POINTS.upgradeWrong;
    }
    if (!outcome) {
      outcome = wantedAnswer ? "missed" : "cleared";
      state.picked[id] = outcome;
      delta += outcome === "cleared" ? POINTS.upgrade : POINTS.upgradeWrong;
    }
    if (outcome === "spotted") named = true;
    if (outcome === "falsely" || outcome === "missed") clean = false;
    const button = el("pad").querySelector(`[data-answer-id="${id}"]`);
    if (button) {
      button.classList.add(outcome, "done");
      const verdict = button.querySelector(".verdict");
      if (verdict && outcome !== "cleared") {
        verdict.innerHTML = `<svg><use href="#mark-${outcome === "spotted" ? "right" : outcome === "falsely" ? "wrong" : "partial"}"/></svg>`;
      }
    }
  }

  let quick = 0;
  if (clean) {
    delta += POINTS.complete;
    if (state.game === "play") {
      quick = Math.round((POINTS.speed * Math.max(state.left, 0)) / CARD_SECONDS);
      delta += quick;
    }
  }
  else if (!named) delta += POINTS.whollyWrong;
  const result = state.results[state.index];
  result.right = clean;
  result.clean = clean || !named;
  result.timedOut = timedOut;
  result.quick = quick;
  result.picks = { ...state.picked };
  result.delta += delta;
  if (delta) bumpScore(delta);
  const elapsedSeconds = (Date.now() - state.answerStartedAt) / 1000;
  learnFrom(card, verdictOf(result), elapsedSeconds, state.answerClicks);
  reveal();
}

function unitStateFor(topic, fact, civId) {
  const data = unitStateData(topic, fact, civId);
  if (!data) return null;
  if (fact.tier === "none" && data.states.some((state) => state.id === NO_UNIT_ID)) return NO_UNIT_ID;
  if (topic.blacksmithLine && !data.states.some((state) => fact.has.includes(state.id))) return data.lower.id;
  if (["hand_cannoneer", "bombard_cannon"].includes(topic.id)) {
    if (!slotGroup(topic, data.middle.id).some((part) => fact.has.includes(part.id))) return NO_UNIT_ID;
    if (fact.has.includes(data.upper.id)) return data.upper.id;
    return data.middle.id;
  }
  if (data.upper && slotGroup(topic, data.upper.id).some((part) => fact.has.includes(part.id))) return data.upper.id;
  if (data.second && slotGroup(topic, data.second.id).some((part) => fact.has.includes(part.id))) return data.second.id;
  if (slotGroup(topic, data.middle.id).some((part) => fact.has.includes(part.id))) return data.middle.id;
  if (["champion", "paladin", "siege_ram", "onager"].includes(topic.id)) return data.lower.id;
  if (data.lower.id !== NO_UNIT_ID && (["onager", "arbalester", "skirmisher", "halberdier", "hussar"].includes(topic.id) || fact.has.includes(data.lower.id))) {
    return data.lower.id;
  }
  return NO_UNIT_ID;
}

function markUnitState(outcome, unitKey = "") {
  const selectedId = unitKey ? state.unitState[unitKey] : state.unitState;
  const button = [...el("pad").querySelectorAll(".unit-state")].find(
    (node) => node.dataset.unitState === selectedId && (node.dataset.unitKey || "") === unitKey
  );
  if (!button) return;
  button.classList.add(outcome, "done");
  const verdict = button.querySelector(".verdict");
  if (verdict) verdict.innerHTML = `<svg><use href="#mark-${outcome === "spotted" ? "right" : "wrong"}"/></svg>`;
  if (outcome === "falsely") {
    const card = state.deck[state.index];
    const { topic, answer } = truth(state.data, card);
    const unitTopic = unitKey ? topic.merged.find((item) => item.id === unitKey) : topic;
    const fact = unitKey ? answer.mergedFacts[unitKey] : answer;
    const correctId = unitStateFor(unitTopic, fact, card.civId);
    const correct = [...el("pad").querySelectorAll(".unit-state")].find(
      (node) => node.dataset.unitState === correctId && (node.dataset.unitKey || "") === unitKey
    );
    if (correct && correct !== button) {
      correct.classList.add("spotted", "done");
      const correctVerdict = correct.querySelector(".verdict");
      if (correctVerdict) correctVerdict.innerHTML = '<svg><use href="#mark-right"/></svg>';
    }
  }
}

/* the civ's bonus, named on the reveal: it is why a civ a slot short can still
   be good */
function bonusHtml(fact) {
  if (!fact.bonus) return "";
  const why = (fact.why || []).join(" • ");
  return `<div class="bonus-note"><svg><use href="#icon-star"/></svg><span>${why}</span></div>`;
}

function configurationOf(topic, fact, civId) {
  const children = topic.merged || [topic];
  const units = children
    .filter((child) => unitStateData(child, topic.merged ? fact.mergedFacts[child.id] : fact, civId))
    .map((child) => {
      const childFact = topic.merged ? fact.mergedFacts[child.id] : fact;
      return unitStateFor(child, childFact, civId);
    });
  const upgrades = claimables(topic)
    .map(({ id }) => wanted(fact, id));
  return { units, upgrades };
}

function configurationDistance(a, b) {
  return a.units.reduce((sum, value, index) => sum + (value === b.units[index] ? 0 : 1), 0) +
    a.upgrades.reduce((sum, value, index) => sum + (value === b.upgrades[index] ? 0 : 1), 0);
}

function configurationCivHtml(civId, distance = 0, showName = true) {
  const civ = state.data.civs[civId];
  return `<span class="configuration-civ" title="${civ.name}${distance ? ` — ${distance} different ${distance === 1 ? "decision" : "decisions"}` : ""}">
    <img src="${civ.img}" alt="${civ.name}">${showName ? `<em>${civ.name}</em>` : ""}${distance ? `<small>${distance}</small>` : ""}
  </span>`;
}

function configurationHtml(topic, civId) {
  const own = configurationOf(topic, topic.civs[civId], civId);
  const comparisons = Object.keys(topic.civs)
    .filter((otherId) => otherId !== civId)
    .map((otherId) => ({
      civId: otherId,
      distance: configurationDistance(own, configurationOf(topic, topic.civs[otherId], otherId)),
    }))
    .sort((a, b) => a.distance - b.distance || state.data.civs[a.civId].name.localeCompare(state.data.civs[b.civId].name));
  const exact = comparisons.filter((item) => item.distance === 0);
  return `<section class="configuration-block exact${exact.length ? "" : " empty"}">
      <div class="configuration-summary"><b>${exact.length ? "Same configuration" : "Unique configuration"}</b><span>${exact.length ? `${exact.length} exact` : "No same configuration"}</span></div>
      ${exact.length ? `<div class="configuration-civs exact">${exact.map(({ civId: otherId }) => configurationCivHtml(otherId, 0, false)).join("")}</div>` : ""}
    </section>`;
}

function reveal() {
  const card = state.deck[state.index];
  const { topic, answer: fact } = truth(state.data, card);
  const result = state.results[state.index];
  state.phase = "reveal";

  const node = el("stack").querySelector(".card:not(.under)");
  const back = node.querySelector(".face.back");
  node.classList.add("settle", "revealed");
  node.style.transform = "";
  const verdict = verdictOf(result);
  back.classList.add(verdict);
  const comparison = back.querySelector(".parts");
  comparison.className = "parts configuration-neighbors";
  if (state.question.format === "reverse") {
    comparison.className = "parts alternate-answer";
    comparison.innerHTML = `<b>Matching choices</b><div class="answer-civs">${state.question.choices
      .filter((id) => state.question.correct.has(id))
      .map((id) => civChoiceHtml(id))
      .join("")}</div>`;
    back.querySelector(".bonus-slot").innerHTML = "";
  } else if (state.question.format === "difference") {
    back.querySelector(".who").innerHTML = `<div class="reveal-pair">${civChoiceHtml(card.civId)}<b>vs</b>${civChoiceHtml(state.question.partnerId)}</div>`;
    comparison.className = "parts alternate-answer";
    comparison.innerHTML = `<b>${state.question.correct.size ? "Different parts" : "No differences"}</b><div class="difference-summary">${state.question.options
      .filter((item) => state.question.correct.has(item.id))
      .map((item) => `<span>${item.art}<em>${item.name}</em></span>`)
      .join("")}</div>`;
    back.querySelector(".bonus-slot").innerHTML = "";
  } else {
    comparison.innerHTML = configurationHtml(topic, card.civId);
    back.querySelector(".bonus-slot").innerHTML = bonusHtml(fact);
  }
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

  const topics = state.played.filter((id) => state.data.topics.some((topic) => topic.id === id));
  const whole = state.game === "play" && state.whole;
  const baseScore = state.score;
  const coefficient = whole ? scoreCoefficient(topics.length) : 1;
  const adjustedScore = Math.round(baseScore * coefficient);
  const coefficientPoints = adjustedScore - baseScore;
  if (coefficientPoints) bumpScore(coefficientPoints);

  state.lastScoreId = null;
  const scoreEntry = {
    score: state.score,
    right,
    cards: state.results.length,
    topics,
    formats: [...state.formats],
    format: state.formats.size > 1 ? "mixed" : [...state.formats][0],
  };
  state.scoreSubmission = null;
  state.pendingScore = whole && state.supabase ? scoreEntry : null;

  el("final-score").textContent = state.score > 0 ? `+${state.score}` : `${state.score}`;
  el("final-tally").textContent = `${right} / ${state.results.length}`;
  const coefficientNote = coefficient !== 1
    ? `${baseScore} &times; ${coefficient.toFixed(2)} = ${adjustedScore}`
    : "";
  state.resultCoefficientNote = coefficientNote;
  const publishStatus = whole
    ? state.supabase
      ? state.playerName ? "submitting score…" : "choose a name to publish"
      : "leaderboard not configured"
    : "";
  setResultNote(coefficientNote, publishStatus);
  el("see-board").hidden = !state.supabase;

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
  if (state.pendingScore) {
    if (state.playerName) publishPendingScore();
    else openPlayerDialog(true);
  }
}

function setResultNote(coefficientNote, status) {
  el("final-note").innerHTML = [coefficientNote, status].filter(Boolean).join(" &middot; ");
}

function ordinal(value) {
  const n = Number(value);
  const tail = n % 100 >= 11 && n % 100 <= 13 ? "th" : ["th", "st", "nd", "rd"][n % 10] || "th";
  return `${n}${tail}`;
}

async function openBoardScreen(highlight) {
  const requestedKey = state.boardKey;
  show("scores");
  for (const button of el("leaderboard-formats").querySelectorAll("[data-leaderboard-format]")) {
    button.setAttribute("aria-pressed", String(button.dataset.leaderboardFormat === state.boardKey));
  }
  el("scoreboard").innerHTML = `<li class="empty">Loading global scores…</li>`;
  try {
    if (state.scoreSubmission) await state.scoreSubmission.catch(() => null);
    const scores = await loadScores(requestedKey);
    if (requestedKey !== state.boardKey) return;
    state.scores = scores;
    renderScores(highlight || state.lastScoreId);
  } catch (error) {
    console.error("Leaderboard request failed", error);
    el("scoreboard").innerHTML = `<li class="empty">The global leaderboard is unavailable.</li>`;
  }
}

/* The board is the scores and what they were scored on: a round of Crossbowman
   and a round of everything are both forty cards, and only the topics beside
   the number say which was which. */
function renderScores(highlight) {
  const board = el("scoreboard");
  if (!state.scores.length) {
    board.innerHTML = `<li class="empty">No global scores yet — finish a Play round to be first.</li>`;
    return;
  }
  board.innerHTML = state.scores
    .map((entry, i) => {
      const rank = i + 1;
      const topics = (entry.topics || [])
        .flatMap((id) => id === "stable_units" ? ["scout_knight", "special_cavalry"] : [id])
        .map((id) => state.data.topics.find((topic) => topic.id === id))
        .filter(Boolean);
      const shown = topics.slice(0, 5);
      const more = topics.length - shown.length;
      const formats = (entry.formats || [entry.format || "normal"]).map(formatLabel);
      const classes = [entry.id === highlight ? "mine" : "", rank <= 3 ? `top-${rank}` : ""]
        .filter(Boolean)
        .join(" ");
        return `<li class="${classes}">
          <b class="place">${rank}</b>
          <span class="score-avatar" aria-hidden="true">${entry.avatar
            ? `<img src="${escapeHtml(entry.avatar)}" alt="" referrerpolicy="no-referrer">`
            : escapeHtml(initials(entry.player))}</span>
          <span class="player" title="${escapeHtml(entry.player)}">${escapeHtml(entry.player)}</span>
        <span class="tally">${entry.score > 0 ? `+${entry.score}` : entry.score}</span>
        <span class="of">${entry.right}/${entry.cards}</span>
        <span class="topics" title="${escapeHtml(topics.map((topic) => topic.name).join(", "))}">
          ${shown.map((topic) => `<span class="badge">${tileHtml(topic)}</span>`).join("")}
          ${more > 0 ? `<em>+${more}</em>` : ""}
        </span>
        <span class="configuration" title="${escapeHtml(`Topics: ${topics.map((topic) => topic.name).join(", ")} · Formats: ${formats.join(", ")}`)}">
          <b>${topics.length}T · ${escapeHtml(topics.map((topic) => topic.name).join(", "))}</b>
          <small>${formats.join(" + ")}</small>
        </span>
        <span class="when">${when(entry.at)}</span>
      </li>`;
    })
    .join("");
}

  function formatLabel(format) {
  return { normal: "Standard", reverse: "Reverse", difference: "Difference", mixed: "Mixed (legacy)" }[format] || format;
  }

  function safeAvatarUrl(value) {
    const url = String(value || "");
    return /^https:\/\/(cdn\.discordapp\.com|media\.discordapp\.net)\//.test(url) ? url : "";
  }

  function initials(value) {
    const parts = String(value || "?").trim().split(/\s+/).filter(Boolean);
    const letters = parts.length > 1 ? parts[0][0] + parts.at(-1)[0] : parts[0]?.slice(0, 2) || "?";
    return letters.toUpperCase();
  }

  function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
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
    if (event.key === "Enter" && deckNow().length) startGame("play");
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

