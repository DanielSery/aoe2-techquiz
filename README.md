# AoE2 Tech Quiz

A flash-card game for learning the Age of Empires II: DE tech tree. One topic at
a time — Hand Cannoneer to start with — you go through the civilisations and say
what each one gets:

| Answer | Swipe | Key | Means |
|---|---|---|---|
| ✗ | left | `←` | the civ does not have it at all |
| ◐ | up | `↑` | it has the unit, but not every upgrade |
| ✓ | right | `→` | unit and every upgrade |

The card turns over the moment you answer and shows what the civ actually has,
icon by icon. At the end of a set you can repeat only the ones you got wrong,
repeat the whole set, or go back and pick a different mix of topics.

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
passes for all 53 civilisations.

A topic is a unit plus the upgrades that complete it. Adding one is a few lines
in `TOPICS` at the top of `tools/build_data.py` — unit id and tech ids, both as
[aoe2techtree](https://github.com/SiegeEngineers/aoe2techtree) numbers them —
and a re-run, which fetches the icons too. Techs that every civilisation has
(Chemistry, Ballistics) are deliberately left out: they cannot tell two civs
apart.

## Layout

| Path | What |
|---|---|
| `index.html` | the three screens and the SVG symbols |
| `js/app.js` | screens, round state, rendering |
| `data/topics.js` | generated: every civ's answer for every topic |
| `js/data.js` | deck building and shuffling |
| `js/swipe.js` | pointer drag to a verdict |
| `tools/build_data.py` | generates `data/topics.js` and downloads the icons |

The data is a `.js` assignment rather than `.json` on purpose: a page opened
from `file://` may not `fetch`, but it may load a script.

## Credit

Tech tree data and icons come from
[aoe2techtree](https://github.com/SiegeEngineers/aoe2techtree) (MIT). Age of
Empires II artwork is © Microsoft; this is an unofficial fan project and is not
affiliated with or endorsed by Microsoft.
