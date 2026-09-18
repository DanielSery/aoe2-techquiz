# AoE2 Tech Quiz

A flash-card game for learning the Age of Empires II: DE tech tree. A card is one
civilisation and one topic, and every topic asks the same three questions — by
swipe, or with the arrow keys:

| Answer | Swipe | Key | Means |
|---|---|---|---|
| ✗ | left | `←` | the civ does not have the unit |
| ◐ | up | `↑` | it has the unit, but not every upgrade |
| ✓ | right | `→` | the unit and all of its upgrades |
| ★ | down | `↓` | a side bet: this civ has a bonus about it |

Naming the direction is the question, so it is worth the most; the rest are
side bets you take when you are sure.

Answering scores at once: **+100** right, **−20** wrong, thrown across the card
and counted in the corner. You never have to remember which way is which — the answers sit on a pad below
the card, each in the direction you swipe for it, showing the topic's own icons
lit or dimmed for what that answer claims, and the one you are about to pick
lights up while you drag.

Say **◐** *correctly* on a topic with more than one upgrade and it asks the
follow-up: the
upgrades take over the pad, in the same place the three answers were, laid out
as a compass — up to seven of them, reached by an arrow key, or two at once for
the corners. Each pick is answered on the spot and cannot be taken back: green
border and tick if it really is missing (**+10**), red border and cross if the
civ has it after all (**−10**). **`→` is done**, which is why right is not one of
the seven; press it when you think you have found them all, and each one you
never named costs **−10**. Leaving an upgrade alone that the civ
really has is worth nothing, so marking nothing is not the safe play.

The purple **★** is not one of the three: it claims that the civ has a civ
bonus, a team bonus or a unique tech about this unit. It scores on the spot,
**+20** or **−20**, and leaves the card where it is, so you still have to answer.
Claiming nothing costs nothing — it is there to be taken when you are sure. The
reveal then names the bonus, whether you called it or not.

Where a topic has only one upgrade — Siege Engineers for the siege units, Ring
Archer Armor for the Hand Cannoneer — there is no follow-up: **◐** already means
"has the unit, without that upgrade".

The card turns over the moment you are done: green or red for the whole card,
what the civ actually has icon by icon, your picks ringed in green, red or amber,
and what the card was worth. It then waits — any key, tap or click deals the next
one.

Nineteen topics so far, and the menu sorts them by where the unit is trained:
**Archery Range**, **Siege**, **Barracks**, **Stable**, **Monastery**. A topic's
`group` in `tools/build_data.py` is what puts it in a section. The tiles are
the units' own icons, with the name on hover -- the whole menu is one screen. Only the last step of an upgrade line
counts — Bracer, not Fletching and Bodkin Arrow as well, since a civ with Bracer
necessarily has those.

Where only a handful of civilisations field a unit at all, the deck is only
those civilisations: asking the other forty "do the Aztecs have a Steppe Lancer"
teaches nothing. The threshold is `RARE` in `tools/build_data.py`.

A topic is gated on the unit that says the line exists at all, which is not
always the unit it is named after: Arbalester is gated on the **Crossbowman**,
so a civ that stops at crossbows is ◐ with the Arbalest as one of the upgrades
it is missing, and only the two civilisations with no crossbow at all are ✗. A
gate can also be a choice of units — Shu, Wei and Wu field the **Traction
Trebuchet** where everyone else has a **Bombard Cannon**, and either counts, so
the reveal shows whichever one the civ actually fields rather than marking the
other as missing.
**Single / Custom / All** under the tiles says how many topics a set draws from:
Single replaces the selection as you pick, Custom lets the tiles toggle for a
mixed set, All takes every topic. Picking a tile outside Custom drops back to
Single on that topic, and the choice is remembered between visits.

At the end of a set you can repeat only the ones you got wrong, repeat the whole
set, or go back and pick a different topic.

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
disagreement would mean one of them is from a different patch. Forty of the
gates pass for all 53 civilisations.

Sixteen do not, and all sixteen are *regional* units — the Savar, the Eagle, the
Battle Elephant, the Steppe Lancer, the Champi, the Fire Lancer, the Winged
Hussar, the Camel Rider, the Traction Trebuchet, the Siege Elephant and their
elites. Their enabling techs sit in no civilisation's disabled list, so reading
the `.dat`'s enable side hands each of them to all 53; each disagreed for 40 to
52 civs, where every other gate agreed for all 53. Those are marked `None` in
`UNIT_ENABLER` and rest on aoe2techtree alone. One genuine single-civ divergence
is recorded in `KNOWN_DIVERGENCES`: the Mapuche's Fervor.

A topic is one unit and the upgrades that complete it, at most seven so they fit
the picker. Adding one is a line in `TOPICS` at the top of `tools/build_data.py`
— a unit id and the tech ids, as
[aoe2techtree](https://github.com/SiegeEngineers/aoe2techtree) numbers them — and
a re-run, which fetches the icons too. A `unit` may be a list, and so may one
of the `upgrades`, when two units answer the same question. List only the last
step of each
upgrade line: the run prints how many civs lack each one, and an upgrade no civ
lacks can never be a right answer in the follow-up, only a wrong one.

Whether a civ has a **bonus** about the unit is not in the tech tree at all, so
it is read out of the game's own civilisation descriptions (string 120150 + civ
id, the same text the civ panel shows). A topic's `words` are the phrases that
mean "this claim is about this unit"; `veto` throws out a claim that only
matches through a different unit — Cavalry Archers are not Arbalesters — and a
bonus *against* the unit ("+3 vs. Rams") does not count. Where the words still
get it wrong, `bonus_fix` forces one civ either way. Every run prints every
matched sentence, so the reading can be checked rather than trusted.

## Layout

| Path | What |
|---|---|
| `index.html` | the three screens and the SVG symbols |
| `js/app.js` | screens, round state, rendering |
| `data/topics.js` | generated: every civ's answer for every topic |
| `js/data.js` | deck building and shuffling |
| `js/swipe.js` | pointer drag to a direction |
| `tools/build_data.py` | generates `data/topics.js` and downloads the icons |

The data is a `.js` assignment rather than `.json` on purpose: a page opened
from `file://` may not `fetch`, but it may load a script.

## Credit

Tech tree data and icons come from
[aoe2techtree](https://github.com/SiegeEngineers/aoe2techtree) (MIT). Age of
Empires II artwork is © Microsoft; this is an unofficial fan project and is not
affiliated with or endorsed by Microsoft.
