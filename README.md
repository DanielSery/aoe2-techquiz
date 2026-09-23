# AoE2 Tech Quiz

A flash-card game for learning the Age of Empires II: DE tech tree. It asks one
question, and it is played by tapping or clicking — on a phone as much as on a
desktop. Two games ask it: **Play**, forty cards against the clock, and
**Learn**, which has no end and deals you what you know least.

**Which upgrades do they have?** A civilisation and a topic on the card, and
under it the board. Tap an upgrade to claim it: it is answered on the spot and
cannot be taken back, **+5** for a right claim, **−5** for a wrong one.

The board reads **left to right as none, some, all** — the scale the question is
asked on. The two ends are the answers that need no tiles, and they are rails
the full height of the tiles, so the board is one block whatever the topic:

```
 ┌─────────┬──────────────────┬──────┐
 │    ▣    │  ▣ ▣ ▣ ▣         │  ▣✓  │
 │ MISSING │  ▣ ▣ ▣  upgrades │ FULL │
 └─────────┴──────────────────┴──────┘
            ★ BONUS    ✔ DONE
```

**The tiles are shuffled for every card.** Held still, "the third one" becomes an
answer of its own and a position is something you can learn instead of the
upgrade. The reveal on the back keeps the topic's own order, because there the
row is being read rather than answered.

**A tile you have not claimed is drawn as one the civ does not have** — grey and
dim, the same way the reveal draws what it lacks — so the board starts as
"none of these" and claiming one turns it on. Grey, not invisible: you still
have to tell a tech by its icon.

**Both rails are the unit**, so each says what it claims about the thing on the
card rather than in the abstract: the unit the topic starts from, greyed under a
red ✗, cannot be built at all; **the unit the line ends at**, lit under a green
✓, is the whole of it — the Crossbowman on the left, the Arbalester on the right
(`fullHtml`). Three topics end in a tech (Hand Cannoneer, Bombard Cannon, Monk)
and two are techs throughout (Defense, Economy); there the right rail keeps the
topic's own icon.

**"Missing" means two different things, and the picture says which.** The left
rail is struck out under a red ✗ where the civ builds nothing of the sort — no
Cavalry Archer at all — and drawn whole where the line has something under it
the civ keeps: the **Archer** under the Crossbowman, the Spearman, the
Man-at-Arms, the Battering Ram, the Mangonel, the Scout Cavalry, the Skirmisher.
That unit is `below` in `tools/build_data.py`.

One picture stands for every civ on the topic, so it can be generous, and the
build prints how generous: every civ with no Pikeman has a Spearman, but of the
seven with no Light Cavalry only the Teutons have a Scout Cavalry — the other
six have no Stable at all. Drawn per civ instead it would *answer* the card,
since "no Scout either" is only ever true of a civ that cannot have the Light
Cavalry, so the shortfall is reported rather than fixed; a unit no civ on the
topic keeps fails the build outright. `below` is a picture and nothing else: no
tier, no claim, no bonus word, and it stays out of `parts`, so it cannot reach
what a card asks.

| | Means | |
|---|---|---|
| **missing**, left rail | it has none of this line — only the unit drawn there, or nothing where that one is struck out | ±5, **and that is the answer** |
| ✓ **full**, right rail | every upgrade is there | claims every tile, **and that is the answer** |
| ★ **bonus** | it has a civ bonus, team bonus or unique tech about this unit | ±10, bonus points only |
| ✔ **done** | that is all of them | ends the card |

The two under the board are the two that are not a reading of the scale: the
bonus, which is points rather than an answer, and done.

**✗ and ⊞ evaluate the card on the tap** — they are whole answers, not claims you
build on. ✗ said and true ends it there: the civ may own the techs anyway (the
Aztecs have Bracer and no Cavalry Archer), the reveal names them, and nothing is
charged for not claiming them. Said and wrong, the card is answered all the
same, and what you never claimed is charged as ever.

**★ is bonus points and nothing else.** Leaving it costs nothing and cannot turn
a right card into a half one; claiming one that is not there costs its **−10**
and no more. Everything else on the board counts: ✔ (or `Enter`) charges **−5**
for each upgrade you never claimed, and naming them all and nothing else is worth
a further **+100**, so the card is right only when the set is exactly right.

| the card | worth |
|---|---|
| every upgrade named and nothing else | **+100**, and up to **+20** more for the time left on the clock |
| some of them right | the claims themselves and no more — amber, out of the tally, and in the ones to repeat |
| none of them right, or the clock ran out | **−50** |

**A card is right when the claims match what the civ has** — nothing claimed
falsely, nothing it has left unclaimed — read off the facts rather than off the
claims, because "nothing to claim" is a real answer. An empty board is the shape
of two different cards: the Georgians build **Hand Cannoneers with no Ring
Archer Armour**, where ✔ on an empty board is exactly right, and the Aztecs
build none at all, where the ✗ rail is what says so and is therefore owed. Said
and true, that rail answers for the whole card, techs and all.

Speed is only ever a bonus on a card you got completely right: a card you half
knew is worth no more for being rushed. The clock is Play's; there is none in
Learn, and no speed bonus with it.

## Question formats

The format buttons are independent toggles. Enable any combination; the deck
contains one shuffled variant per enabled format, so enabling all three mixes
Standard, Reverse, and Difference questions throughout the session. At least
one format always remains enabled.

**Standard** shows a civilisation and asks for its unit level and upgrades.

**Reverse** shows the full configuration without naming the civilisation. It
offers a shuffled set of eight civilisations and asks for every displayed
civilisation with that exact configuration. Up to three matching answers are
included, with the closest configurations used as distractors. The configuration
lives on the card itself; each civilisation is marked right or wrong as soon as
it is selected.

**Difference** shows two civilisations and asks which unit levels and upgrade
slots differ. It favors nearby configurations so the answer depends on the few
details that distinguish otherwise similar tech trees. Every selected unit or
technology is evaluated immediately, while Done reveals differences left out.

Each format keeps its own learning record. Knowing a configuration when the
civilisation is supplied does not automatically mark its reverse or comparison
card as mastered.

## The two games

**Play** is forty cards, **30 seconds** each. Run out of time and the card is
answered for you and counted wrong — the same −50, and the upgrades you never
claimed charged as ever, so the clock costs exactly what pressing ✔ blind would.
Forty whatever the topics: a selection bigger than forty is drawn from at
random, a smaller one is simply all of it.

Full Play rounds multiply their final net score by a difficulty coefficient.
With one question format, the first topic is the **×1.00** baseline and every
additional topic adds **25%**. Two formats make the first topic **×1.05**, then
every additional topic adds **30%**. All three formats make the first topic
**×1.10**, then every additional topic adds **35%**. For example, two topics are
×1.25 with one format, ×1.35 with two, and ×1.45 with three. The menu shows the
coefficient before the round and the results show the calculation. A retry of
missed cards is a different, easier round, so it does not receive the coefficient
or enter the leaderboard.

**Learn** has no length and no clock. It stops when you go back to the menu, and
the bar along the top is how much of the selection you know.

**An appointment first, the open field second.** A card you have answered is due
back at a position — **2 to 4 cards** after one you got wrong and **3 to 6**
after a partial answer. A right answer earns anywhere from **3–6 cards** for a
still-uncertain card to **180–360** for a mastered one, drawn from the range at
random — and when that position
arrives the card is *taken*, longest overdue first, so "again in three cards"
means three cards.

That order is the whole of it, and the first version had it wrong: letting due
cards back into the general draw instead of taking them put a card answered
wrong **28 cards** later, because it was one of 56 the draw could equally have
picked.

**Every third card is a new one** while any card is still unseen, whatever is
owed. Six cards answered wrong come back every two to four cards each, which
between them is every card: without the let-out the deck deals those six for
ever and the other forty-seven are never seen. An appointment it makes wait is a
card or two late, which is cheaper than a session that never moves on.

**Rest grows with mastery.** A correct answer no longer sends a shaky card out
of sight: it stays in a short loop until several correct answers, at a confident
pace, establish that it is known.

| known | rest | comes round |
|---|---|---|
| under 40 | — | 3–6 cards |
| 40–64 | — | 5–10 |
| 65–79 | — | 8–16 |
| 80–91 | — | 16–32 |
| 92–97 | — | 35–70 |
| 98–99 | — | 80–160 |
| **100** | — | **180–360** |

The mastery bands apply to appointments as well as the weighted open draw, so a
shaky card cannot receive the same rest as a fluent one.

**A session starts by placing what you already know**, each card somewhere
inside its own interval — a mastered card a long way out, a shaky one soon.
Cards never answered keep no appointment: they are the ones the deck is for.
Without that seeding, "not scheduled yet" is a side door — the deck answers the
thirteen it has never seen, then has nothing left to deal but the forty it knows.

With nothing owed the draw is the open field, where the weight is how much of a
card you do **not** know, squared, over a floor: **10.02 at nothing against 0.02
at 100**, five hundred to one. The floor is why "have down" is not "never
again".

Measured on a deck of 40 mastered cards and 13 unknown, over 60 draws: **4 to 5
of them went to mastered cards**, each a different one, and all from their
scheduled appointments. A deck where everything is mastered deals them every
draw, because there is nothing else to deal — rare is not impossible.

**Never answered is its own state**, not 0% — the entry is kept even when a card
falls to nothing, so "keeps failing" and "never seen" are different things. The
menu and the bar count the second sort: *56 cards, 8% known, 46 new*. The
appointments themselves are for the session only; the percentages are what
learning remembers, and a spacing from yesterday means nothing today.

The percentage moves in **shares, not steps**. A right answer closes part of the
gap to 100, adjusted by its response pace. Pace separates recall from operating
the board: it allows four seconds of thinking and subtracts **300ms for every
selection click**. A card with many present upgrades can therefore still count
as fluent when the player already knows it and is simply tapping the answers.
A fast answer can close a little more than the normal 70% share; a slow answer
closes as little as 38.5%, so correctness without fluency keeps the card nearby.
Recent response pace is smoothed with the card's previous pace so one lucky
guess cannot make it look mastered. Wrong and half keep a share of what was
there, so
forgetting is proportional too — a card at 91 answered wrong falls to 23, and a
half answer to 55, rather than shrugging off a fixed ten. The three shares are
`KNOWN_STEP`.

**A card you keep getting wrong climbs back slower.** Every miss is counted
against it and damps the climb — the seven tenths of the gap a clean card closes
becomes a half at one miss, a third at two — so where a clean card is mastered
in five right answers at the normal pace, one missed three times takes nine.
These examples hold response pace neutral to show the effect of misses alone:

| record | the climb, right answer by right answer |
|---|---|
| never missed | 70 · 91 · 97 · 99 · **100** |
| missed once | 47 · 72 · 85 · 96 · 99 · **100** |
| missed twice | 35 · 58 · 73 · 82 · 90 · 97 · 99 · **100** |
| missed three times | 28 · 48 · 63 · 73 · 81 · 88 · 94 · 98 · **99** |

The record is paid off rather than carried for ever: a right answer on a card
already at 70 or better clears one miss, so **two good answers in a row** begin
to forgive it and one lucky answer does not. Measured on a live card answered
wrong three times and then right: 0 · 0 · 0 · 28 · 48 · 63 · 73 · 81 · 88, with
the misses falling away over the last two. `MISS_DAMP` is the rate and
`MISS_CAP` the worst it gets.

A card's memory is `{k, w, t}` — how well it is known, how many times it has
been missed, and its smoothed response pace. A bare number, which is what the
store held before those extra signals were counted, still reads as a clean
record.

Those percentages live in `localStorage` (`aoe2-techquiz.known`), **not** in a
cookie: a cookie is capped around 4KB and is sent to the server on every
request, and 20 topics × 56 civilisations do not fit in one. Learning progress
never leaves the browser. Cards at nothing are dropped rather than stored, so a
fresh start is an empty object.

## The board

Every full round of Play is submitted to the global Supabase leaderboard with
the player's name, score, correct count, topics and question format. The best 25
are reachable from the menu (🏆) and from the end of a round; the round just
played is outlined in gold when it is in the top 25.

There is no account or password. After a player's first full Play round, they
may enter a display name and publish the score or cancel and keep the result
private. The chosen name is stored only in their browser under
`aoe2-techquiz.player`; later scores publish under it automatically without
showing the dialog again. It can be changed from the menu. Names are not
reserved or guaranteed unique.

## How a round is dealt

A civilisation comes up **once** per topic, so the pool is one pass over the
civilisations — 56 cards on a topic every civ can be asked about. Every civ is
worth asking, including the ones with no unit at all: "what does it have",
answered with a ✗ and the techs it owns anyway, is exactly the fact worth
knowing.

**The card says who is being asked and about what, and nothing else** — the
emblem, the name, and a band across the top naming the topic. A round of All
deals nineteen topics from seven sections, and an icon 34px wide does not say
which of them you are looking at, so the band names both: the section as a
kicker — ARCHERY RANGE — over the topic's own name in gold, wrapping to two
lines where it covers four units and dropping the kicker on Defense and Economy,
which are their own section and would otherwise say their name twice. The
question itself is the same of every civilisation, so it lives over the board it
is answered on rather than being read and re-read on the card.

**The unit sits on the emblem**, a tile a quarter of the card wide overlapping
its bottom-right corner. A card is a civilisation *and* a unit, and with the
unit a 30px thumbnail in the band against an emblem filling half the card, you
could read "Poles" and never take in "Crossbowman".

The card turns over the moment you are done: green, amber or red for the whole card,
what the civ actually has icon by icon, your picks ringed in green, red or amber,
and what the card was worth, in the same band. Any key, tap or click deals the
next one — and if none comes, **the card deals it itself after five seconds**
(`AUTO_NEXT_MS`). The bar draining along the bottom edge of the back is that
clock; it is filled in when the card turns, so it counts the waiting and never
the answering, and its duration is set from the same constant as the timer so
the two cannot drift apart.

The strip along the top is the round: one tick per card, green, amber or red as
they are answered, and the one in hand in **blue** — it is the only mark there
that is not a verdict, so it is the only one not in the verdict colours. (A card
owns a result from the moment it is dealt, so reading those results alone drew
every card as wrong before it had been answered.)

**A topic is named and pictured by the unit it starts from** — the Crossbowman,
not the Arbalester; the Light Cavalry, not the Hussar; the Pikeman, the Knight,
the Long Swordsman, the Eagle Scout. What it asks about is the upgrades, and the
upgraded unit is one of the answers, so putting it on the tile would be showing
you the answer. Nineteen topics so far, and the menu sorts them by where the unit is trained:
**Archery Range**, **Siege**, **Barracks**, **Stable**, **Monastery** -- and then
the two that start from no unit at all, **Defense** and **Economy**, which are
their upgrades and nothing else, so ✗ there means a civ with none of them rather
than a civ that cannot build something. A topic's
`group` in `tools/build_data.py` is what puts it in a section. The tiles are
the units' own icons, with the name on hover. Nineteen topics in seven sections
no longer fit one screen on a short phone -- 174px over at 375x553, 43px over at
390x745 -- and the scrollbar is hidden, so `markScrollable` fades the bottom
edge while there is more below. That fade is the only thing saying so. A
topic that covers more than one unit shows them all, whole, sharing the tile --
biggest cell to the unit it is named for -- so it says up front that Cavalry
Archer will also ask about the Elephant Archer, the Bolas Rider and the Xianbei
Raider. Only the last step of an upgrade line
counts — Bracer, not Fletching and Bodkin Arrow as well, since a civ with Bracer
necessarily has those.

Where only a handful of civilisations field a unit at all, the deck is only
those civilisations: asking the other forty "do the Aztecs have a Steppe Lancer"
teaches nothing. The threshold is `RARE` in `tools/build_data.py`.

A topic is gated on the unit that says the line exists at all, which is where its
name comes from: the Crossbowman topic asks about the Arbalester upgrade, so a
civ that stops at crossbows has the unit and is missing that upgrade, and only
the two civilisations with no crossbow at all have nothing. **Elite Skirmisher
is the exception**, gated on the Elite itself: every civ has the Skirmisher, so
gating there asks a question with one answer and makes the Elite a tile nobody
can weigh. Gated on the Elite, the Turks are the one civ with nothing and the
plain Skirmisher is what they keep. A
gate can also be a choice of units — Shu, Wei and Wu field the **Traction
Trebuchet** where everyone else has a **Bombard Cannon**, and either counts, so
the card asks for one of them rather than marking the other as missing.

**A slot wears every unit that can fill it, everywhere it is drawn**: the menu
tile, the corner of the card, the board and the card back all show
the same split. A board drawn with the civ's own Winged Hussar on it would have
answered the card before you did, so every card looks the same for all 56 and
the tick on the back says only that the civ has *one* of them. The units that
stand in for each other are the Gurjaras' **Elephant Archer**, the Mapuche's
**Bolas Rider**, the Muisca's **Temple Guard**, the Champi Warrior, the Fire
Lancer, the Siege Elephant, the Savar, the Shrivamsha Rider, the Winged Hussar
and the Traction Trebuchet. Nothing on the card says which of them this civ is
the one for -- that is the part the split gives up, and the reason it is worth
it is that saying so would answer the question. The one unit with nothing above
it is Wei's **Xianbei Raider**: it is already the top of its line,
so it stands in its own last-upgrade slot and Wei is never missing an upgrade
that does not exist.

**Single / Custom / All** under the tiles says how many topics a set draws from:
Single replaces the selection as you pick, Custom lets the tiles toggle for a
mixed set, All takes every topic. Picking a tile outside Custom drops back to
Single on that topic, and the choice is remembered between visits.

**Play / Learn** under that is which game, and the line beneath says what you
are in for: how many cards the selection holds, and — in Learn — how much of it
you know. Both choices are remembered between visits, like the topics.

At the end of a round of Play you can repeat the ones you did not get right --
the wrong ones *and* the amber half-answers, which is the same set the tally
counted against you -- repeat the whole forty, or go back and pick a different
topic. Learn has no end to arrive at: the home button is how you stop, and every
card is saved as you go.

## Playing it

It is a static page with no build step. Opening `index.html` straight off disk
works, and so does any web server. The Supabase browser client is loaded from
jsDelivr:

```powershell
python -m http.server 8080
# then http://localhost:8080
```

On GitHub Pages: **Settings → Pages → Deploy from a branch → `main` / `(root)`**.

### Supabase leaderboard setup

1. Create a Supabase project and run `supabase/schema.sql` in its SQL Editor.
2. In **Project Settings → API**, copy the Project URL and publishable key into
   `js/supabase-config.js`.
3. Deploy the site. Never put a `service_role` or secret key in the browser.

The schema enables RLS, grants the unauthenticated `anon` role only `SELECT` and
`INSERT`, and provides no client-side update or delete access. Because there is
deliberately no authentication, a determined visitor can still forge names and
scores or automate submissions with the public API. Preventing that requires a
trusted server or authentication; the database constraints here limit malformed
rows, not cheating.

The scripts and stylesheet are loaded with a `?v=` marker; bump it in
`index.html` when you change them, or a plain reload can keep serving the old
copy.

### Fitting a phone

The page never scrolls, so everything is sized off the viewport that is actually
on screen — `svh`, the height with the browser's toolbars *out*.

- **The card is sized height-first.** `.stack` takes a height and lets
  `aspect-ratio` compute the width, and the cap is applied to the height in the
  width's own units. Give it a definite width *and* a definite height and
  `aspect-ratio` is ignored altogether, which is how a 3:4 card came out 254×231
  on a phone.
- **The pad shrinks before the card does.** `--cell` is one pad button, clamped
  between 54px and 78px, and everything on the pad is derived from it — so the
  pad is never wider than the screen and never crowds the card out.
- **The card's contents scale with the card**, in `cq` units against `.stack`, so
  a 161px card is the same card and not a clipped one. Under 205px it drops the
  "next" hint and holds the parts to one row, which is what was pushing the
  verdict badge off the top.
- Held sideways with under 540px of height, the pad moves beside the card instead
  of under it.

## The data

`data/topics.js` is generated, not written by hand. Its source is
[SiegeEngineers/aoe2techtree](https://github.com/SiegeEngineers/aoe2techtree),
which extracts the tech tree from the game's own `.dat` file. The committed data
was generated from the September 22, 2026 game data so the Viking Sagas civs,
regional units, and Cranequins are available before the upstream snapshot is
updated.

```powershell
python tools/build_data.py
python tools/build_data.py --local-tree <path>/aoe2techtree
python tools/build_data.py --civdata <path>/aoe2planner/gamedata/civdata.json
```

The local form reads `data/data.json`, `data/trees`, and the English strings
created by aoe2techtree's extraction scripts.

The second form cross-checks every civ against a second, independent extraction
of the same `.dat` and refuses to write anything if the two disagree — that
disagreement would mean one of them is from a different patch. Forty-one of the
gates pass for all 56 civilisations.

Twenty-five do not, and all twenty-five are *regional* or *unique* units — the
Savar, the Shrivamsha Rider, the Eagle, the Battle Elephant, the Steppe Lancer,
the Champi, the Fire Lancer, the Temple Guard, the Winged Hussar, the Camel
Rider, the Elephant Archer, the Bolas Rider, the Xianbei Raider, the Traction
Trebuchet, the Siege Elephant and their
elites. Their enabling techs sit in no civilisation's disabled list, so reading
the `.dat`'s enable side hands each of them to all 56; each disagreed for many
civs, where every other gate agreed for all 56. Those are marked `None` in
`UNIT_ENABLER` and rest on aoe2techtree alone.

One *tech* is the same story and is listed in `UNSETTLED_TECHS`: the Khitans farm
from Pastures, and the `.dat` extraction on this machine has never heard of that
line, so nothing turns **Transhumance** off for anybody and the enable side hands
it to all 56 -- it disagreed for exactly the civs that do not have it. Its
name is worth knowing twice: `data.json` calls it *Grazing Grasslands* and only
the per-civ tree files carry the name the game shows.

Two genuine single-civ divergences are recorded in `KNOWN_DIVERGENCES`, both the
Mapuche's and both the same shape -- nothing in their disabled list turns
**Fervor** or **Architecture** off, yet the tech tree they are dealt carries
neither.

A topic is one unit and the upgrades that complete it, at most seven so they fit
the picker. Adding one is a line in `TOPICS` at the top of `tools/build_data.py`
— a unit id and the tech ids, as
[aoe2techtree](https://github.com/SiegeEngineers/aoe2techtree) numbers them — and
a re-run, which fetches the icons too. A `unit` may be a list, and so may one
of the `upgrades`, when two units answer the same question. List only the last
step of each
upgrade line: the run prints how many civs lack each one, and an upgrade no civ
lacks can never be a right answer on the board, only a wrong one.

Whether a civ has a **bonus** about the unit is not in the tech tree at all, so
it is read out of the game's own civilisation descriptions (string 120150 + civ
id, the same text the civ panel shows). A topic's `words` are the phrases that
mean "this claim is about this unit", and the topic's own part names are words
too without being listed: a bonus about a tech the topic asks you about — free
Siege Engineers, free Thumb Ring, a free Pikeman upgrade — is a bonus about the
topic. Four rules decide the rest:

- **A `veto` kills the word, not the sentence.** "Skirmishers and Elephant
  Archers attack +25% faster" is a Skirmisher bonus; throwing out the whole line
  because it says *Elephant Archer* somewhere loses it.
- **`GUARDS` reads what comes before the word.** A bonus *against* the unit
  ("+3 vs. Rams", "-3 damage **from** Mounted Units"), the unit a bonus leaves
  out ("(**except** Skirmishers)"), and where some other unit is trained
  ("Condottiero **available at** the Barracks") are all not bonuses for it.
- **A civ that cannot build the unit has no bonus about it.** Mongols' Drill is
  a Siege Workshop bonus and the Mongols have no Bombard Cannon, so that card is
  a plain ✗ rather than "no unit, and a bonus about it".
- Where the words still get it wrong, `bonus_fix` forces one civ either way.
  It carries three: the Huns' Atheism and the Vikings' Chieftains name *enemy*
  relics and monks, and the Incas' only Spearman-line sentence is about
  villagers borrowing infantry armour.

Every run prints every matched sentence, so the reading can be checked rather
than trusted. It stays a reading of English prose, and two known lines still
read across their own exception: the Armenians' Fereters ("Infantry (except
Spearman-line)") and the Incas' villager line are listed under units they do not
help — in both cases the civ has another sentence that counts as a bonus anyway, so
the answer is right and only the reason shown is generous.

## Layout

| Path | What |
|---|---|
| `index.html` | the three screens and the SVG symbols |
| `js/app.js` | screens, round state, rendering |
| `data/topics.js` | generated: every civ's answer for every topic |
| `js/data.js` | deck building, and what a card knows about its civilisation |
| `tools/build_data.py` | generates `data/topics.js` and downloads the icons |

The data is a `.js` assignment rather than `.json` on purpose: a page opened
from `file://` may not `fetch`, but it may load a script.

## Credit

Tech tree data and icons come from
[aoe2techtree](https://github.com/SiegeEngineers/aoe2techtree) (MIT). Age of
Empires II artwork is © Microsoft; this is an unofficial fan project and is not
affiliated with or endorsed by Microsoft.
