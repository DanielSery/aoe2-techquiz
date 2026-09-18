# AoE2 Tech Quiz

A flash-card game for learning the Age of Empires II: DE tech tree. It asks one
question, of every civilisation in turn, and it is played by tapping or clicking
— on a phone as much as on a desktop.

**Which upgrades do they have?** A civilisation and a topic on the card, and
under it the board. Tap an upgrade to claim it: it is answered on the spot and
cannot be taken back, **+10** for a right claim, **−10** for a wrong one.

The board reads **left to right as none, some, all** — the scale the question is
asked on. The two ends are the answers that need no tiles, and they are rails
the full height of the tiles, so the board is one block whatever the topic:

```
 ┌──────┬─────────────────────┬──────┐
 │  ▨✗  │  ▣ ▣ ▣ ▣            │  ▣✓  │
 │  NO  │  ▣ ▣ ▣   upgrades   │ FULL │
 └──────┴─────────────────────┴──────┘
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
topic's own icon. The picture carries the claim, so the words under them are
only **no** and **full**; what "no" means for the topic in hand is left to the
tooltip (`cannotTitle`) — it cannot build this unit at all, or, on Defense and
Economy, which have no unit behind them, it has none of these.

| | Means | |
|---|---|---|
| ✗ **no**, left rail | it cannot build this unit at all | ±10, **and that is the answer** |
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
and no more. Everything else on the board counts: ✔ (or `Enter`) charges **−10**
for each upgrade you never claimed, and naming them all and nothing else is worth
a further **+100**, so the card is right only when the set is exactly right. Some
of them right is amber — out of the tally, and in the ones to repeat. None of
them right is simply wrong.

## How a round is dealt

A civilisation comes up **once** on a board of its own, so a round is one pass
over the civilisations — 53 cards on a topic every civ can be asked about. Every
civ is worth asking, including the ones with no unit at all: "what does it have",
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
the two civilisations with no crossbow at all have nothing. A
gate can also be a choice of units — Shu, Wei and Wu field the **Traction
Trebuchet** where everyone else has a **Bombard Cannon**, and either counts, so
the card asks for one of them rather than marking the other as missing.

**A slot wears every unit that can fill it, everywhere it is drawn**: the menu
tile, the corner of the card, the board and the card back all show
the same split. A board drawn with the civ's own Winged Hussar on it would have
answered the card before you did, so every card looks the same for all 53 and
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

The slider under it is **how many questions to ask**: all the way over is the
whole set, anywhere short of that is that many drawn at random from it. Moving
to another topic keeps the number if it fits and clamps it if it does not, and
a slider left at the end means "all of them" whatever the next topic's size.

At the end of a set you can repeat the ones you did not get right -- the wrong
ones *and* the amber half-answers, which is the same set the tally counted
against you -- repeat the whole set, or go back and pick a different topic.

## Playing it

It is a static page with no build step and no dependencies. Opening
`index.html` straight off disk works, and so does any web server:

```powershell
python -m http.server 8080
# then http://localhost:8080
```

On GitHub Pages: **Settings → Pages → Deploy from a branch → `main` / `(root)`**.

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
which extracts the tech tree from the game's own `.dat` file, pinned to a commit.

```powershell
python tools/build_data.py
python tools/build_data.py --civdata <path>/aoe2planner/gamedata/civdata.json
```

The second form cross-checks every civ against a second, independent extraction
of the same `.dat` and refuses to write anything if the two disagree — that
disagreement would mean one of them is from a different patch. Forty-one of the
gates pass for all 53 civilisations.

Twenty-five do not, and all twenty-five are *regional* or *unique* units — the
Savar, the Shrivamsha Rider, the Eagle, the Battle Elephant, the Steppe Lancer,
the Champi, the Fire Lancer, the Temple Guard, the Winged Hussar, the Camel
Rider, the Elephant Archer, the Bolas Rider, the Xianbei Raider, the Traction
Trebuchet, the Siege Elephant and their
elites. Their enabling techs sit in no civilisation's disabled list, so reading
the `.dat`'s enable side hands each of them to all 53; each disagreed for 40 to
52 civs, where every other gate agreed for all 53. Those are marked `None` in
`UNIT_ENABLER` and rest on aoe2techtree alone.

One *tech* is the same story and is listed in `UNSETTLED_TECHS`: the Khitans farm
from Pastures, and the `.dat` extraction on this machine has never heard of that
line, so nothing turns **Transhumance** off for anybody and the enable side hands
it to all 53 -- it disagreed for exactly the 52 civs that do not have it. Its
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
