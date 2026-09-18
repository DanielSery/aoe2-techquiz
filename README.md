# AoE2 Tech Quiz

A flash-card game for learning the Age of Empires II: DE tech tree. A card is one
civilisation and one topic, and every topic asks the same three questions — by
swipe, or with the arrow keys:

| Answer | Swipe | Key | Means |
|---|---|---|---|
| ✗ | left | `←` | the civ does not have the unit |
| ◐ | up | `↑` | it has the unit, but not every upgrade |
| ✓ | right | `→` | the unit and all of its upgrades |

Answering scores at once: **+1** right, **−1** wrong, shown on the counter in the
corner. You never have to remember which way is which — the answers sit on a pad
below the card, each in the direction you swipe for it, showing the topic's own
icons lit or dimmed for what that answer claims, and the one you are about to
pick lights up while you drag.

Say **◐** and it asks the follow-up: up to seven upgrade icons, and you mark the
ones you think that civ is missing, then press done. **+1** for each one you
correctly call missing, **−1** for each one you accuse wrongly, **−1** for each
one you miss — leaving an upgrade alone that the civ really has is worth nothing,
so playing it safe does not pay. A topic with only one upgrade skips the
follow-up: saying ◐ has already named it.

The card turns over the moment you are done: green or red for the whole card,
what the civ actually has icon by icon, your picks ringed in green, red or amber,
and what the card was worth. It then waits — any key, tap or click deals the next
one.

Four topics so far: Hand Cannoneer, Siege Ram, Bombard Cannon and Arbalester.
At the end of a set you can repeat only the ones you got wrong, repeat the whole
set, or go back and pick a different mix of topics.

## Playing it

It is a static page with no build step and no dependencies. Opening
`index.html` straight off disk works, and so does any web server:

```powershell
python -m http.server 8080
# then http://localhost:8080
```

On GitHub Pages: **Settings → Pages → Deploy from a branch → `main` / `(root)`**.

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
disagreement would mean one of them is from a different patch. The current data
passes for all 53 civilisations and all four topics.

A topic is one unit and the upgrades that complete it, at most seven so they fit
the picker. Adding one is a line in `TOPICS` at the top of `tools/build_data.py`
— a unit id and the tech ids, as
[aoe2techtree](https://github.com/SiegeEngineers/aoe2techtree) numbers them — and
a re-run, which fetches the icons too. The run prints how many civs lack each
upgrade: an upgrade every civ has (Fletching, Bodkin Arrow, Padded Archer Armor)
can never be a right answer in the picker, only a wrong one.

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
