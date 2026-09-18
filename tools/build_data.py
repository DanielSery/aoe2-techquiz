"""Generate data/topics.js and download the icons it points at.

Source of truth is SiegeEngineers/aoe2techtree's data/data.json, pinned to a
commit. Optionally cross-checked against an Aoe2Planner civdata.json, which is
extracted from the game's own empires2_x2_p1.dat -- a disagreement there means
one of the two is from a different patch, so it fails the build rather than
picking a winner.

    python tools/build_data.py
    python tools/build_data.py --civdata c:/Repos/Aoe2Planner/001/aoe2planner/gamedata/civdata.json
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import urllib.request
from pathlib import Path

REPO = "SiegeEngineers/aoe2techtree"
API = f"https://api.github.com/repos/{REPO}"
ROOT = Path(__file__).resolve().parent.parent

# A topic is one unit and the upgrades that complete it, at most seven: the
# follow-up is a compass, one upgrade per direction, and right is taken by done. Every topic answers the same
# three ways: the civ has no unit, has it with something missing, or has it all.
#
# Only the *last* step of an upgrade line belongs here. A civ that has Bracer
# necessarily has Fletching and Bodkin Arrow, so listing those adds icons that
# can never be missing -- they could only ever cost points in the picker.
MAX_UPGRADES = 7

# An upgrade is a tech id, or ("Unit", id) where the upgrade is a unit of its
# own. `unit` may be left out: then the topic is the upgrades alone, and left
# means the civ has none of them rather than "no unit".
#
# `bonus` decides the down answer: does the civ have a civ bonus, team bonus or
# unique tech about this unit? That is not in the tech tree, so it is read out
# of the game's own civilisation descriptions -- `words` are the phrases that
# mean "this claim is about this unit", `veto` throws out a claim that only
# matches through a different unit (Cavalry Archers are not Arbalesters), and
# `bonus_fix` forces a civ either way when the words get it wrong. Every build
# prints what it matched, so the reading stays reviewable.
TOPICS = [
    {
        "id": "hand_cannoneer",
        "name": "Hand Cannoneer",
        "unit": 5,
        "upgrades": [219],
        "words": [r"gunpowder", r"hand cannon\w*"],
    },
    {
        "id": "siege_ram",
        "name": "Siege Ram",
        "upgrades": [("Unit", 548), 377],
        "words": [r"rams?", r"siege workshops?", r"siege weapons?"],
    },
    {
        "id": "bombard_cannon",
        "name": "Bombard Cannon",
        "unit": 36,
        "upgrades": [377],
        "words": [r"gunpowder", r"bombard cannons?", r"siege workshops?", r"siege weapons?"],
    },
    {
        "id": "arbalester",
        "name": "Arbalester",
        "unit": 492,
        "upgrades": [201, 219, 437],
        "words": [r"archers?", r"archer-line", r"arbalest\w*", r"crossbow\w*", r"archery ranges?"],
        "veto": [
            r"cavalry archer",
            r"mounted archer",
            r"elephant archer",
            r"camel archer",
            r"fire archer",
            r"genitour",
            r"ballista",
            r"scorpion",
            r"chu ko nu",
        ],
    },
]

# The civilisation description is string 120150 + civ id - 1. Checked against
# the .dat's own civ ids and spot-checked by unique unit across the range.
HELP_STRING_BASE = 120150
CIV_ID = {
    "Britons": 1, "Franks": 2, "Goths": 3, "Teutons": 4, "Japanese": 5, "Chinese": 6,
    "Byzantines": 7, "Persians": 8, "Saracens": 9, "Turks": 10, "Vikings": 11,
    "Mongols": 12, "Celts": 13, "Spanish": 14, "Aztecs": 15, "Mayans": 16, "Huns": 17,
    "Koreans": 18, "Italians": 19, "Hindustanis": 20, "Incas": 21, "Magyars": 22,
    "Slavs": 23, "Portuguese": 24, "Ethiopians": 25, "Malians": 26, "Berbers": 27,
    "Khmer": 28, "Malay": 29, "Burmese": 30, "Vietnamese": 31, "Bulgarians": 32,
    "Tatars": 33, "Cumans": 34, "Lithuanians": 35, "Burgundians": 36, "Sicilians": 37,
    "Poles": 38, "Bohemians": 39, "Dravidians": 40, "Bengalis": 41, "Gurjaras": 42,
    "Romans": 43, "Armenians": 44, "Georgians": 45, "Shu": 49, "Wu": 50, "Wei": 51,
    "Jurchens": 52, "Khitans": 53, "Muisca": 57, "Mapuche": 58, "Tupi": 59,
}


def upgrade_nodes(spec: dict) -> list:
    return [item if isinstance(item, tuple) else ("Tech", item) for item in spec["upgrades"]]


def tiers_for(unit_id, upgrade_ids: list) -> list:
    """The same three answers for every topic; `has` is what each one claims."""
    partial = [unit_id] if unit_id else []
    return [
        {"id": "none", "dir": "left", "mark": "none", "has": []},
        {"id": "partial", "dir": "up", "mark": "partial", "has": partial},
        {"id": "full", "dir": "right", "mark": "full", "has": partial + upgrade_ids},
    ]

# aoe2techtree's civ keys map to img/Civs/<lowercase>.png; Aoe2Planner's
# extraction uses the .dat's internal names, which differ for four civs.
DAT_ALIASES = {
    "Britons": "British",
    "Franks": "French",
    "Byzantines": "Byzantine",
    "Mayans": "Mayan",
}

# In the .dat a unit is gated by an enabling tech whose id is not the unit's --
# the Hand Cannoneer (unit 5) is enabled by tech 85, and an upgraded unit by the
# upgrade itself. Only needed for the --civdata cross-check, and only for units
# a topic names.
UNIT_ENABLER = {5: 85, 36: 188, 422: 96, 492: 237, 548: 255}


def fetch(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": "aoe2-techquiz-build"})
    with urllib.request.urlopen(request, timeout=60) as response:
        return response.read()


def head_commit() -> str:
    return json.loads(fetch(f"{API}/commits/master"))["sha"]


def icon_indices(commit: str, techtree: dict, wanted: set) -> dict:
    """Resolve ("Unit", 5) -> picture_index, which is what img/Unit/<n>.png is keyed by.

    data.json carries no icon id; the per-civ tree files do, so read them until
    every node is resolved -- a civ that lacks a node does not list it.
    """
    found = {}
    for name in sorted(techtree["civs"]):
        if len(found) == len(wanted):
            break
        url = f"https://raw.githubusercontent.com/{REPO}/{commit}/data/trees/{name.upper()}.json"
        for node in walk(json.loads(fetch(url))):
            key = (node.get("use_type"), node.get("node_id"))
            if key in wanted and key not in found:
                found[key] = (node["picture_index"], node["name"])
    missing = wanted - set(found)
    if missing:
        raise SystemExit(f"no civ tree carries {sorted(missing)}")
    return found


def walk(node):
    if isinstance(node, dict):
        if "node_id" in node and "picture_index" in node:
            yield node
        for value in node.values():
            yield from walk(value)
    elif isinstance(node, list):
        for value in node:
            yield from walk(value)


def civ_claims(description: str) -> list:
    """The civ's bonuses, unique techs and team bonus, one claim per line.

    The unique *units* are dropped: naming a unit is not a bonus about it, and
    a Chakram Thrower would otherwise read as a bonus about rams.
    """
    lines, skip_next = [], False
    for raw in re.sub(r"<br>", "\n", description).split("\n"):
        line = " ".join(re.sub(r"<[^>]+>", "|", raw).replace("•", "").split())
        claim = line.strip("| ")
        if not claim or claim.endswith("civilization"):
            continue
        if "Unique Unit" in line:
            skip_next = True
            continue
        if skip_next:
            skip_next = False
            continue
        lines.append(claim)
    return lines


def bonus_claims(spec: dict, claims: list) -> list:
    words = spec.get("words", [])
    veto = spec.get("veto", [])
    found = []
    for claim in claims:
        low = claim.lower()
        if any(re.search(r"\b" + pattern, low) for pattern in veto):
            continue
        for pattern in words:
            hit = re.search(r"\b" + pattern + r"\b", low)
            # "+3 vs. Rams" is a bonus against them, not one about your own
            if hit and "vs." not in low[max(0, hit.start() - 8) : hit.start()]:
                found.append(claim)
                break
    return found


def nodes_of(spec: dict) -> list:
    """Every (kind, id) the topic names: the unit first, if it has one."""
    gate = [("Unit", spec["unit"])] if spec.get("unit") else []
    return gate + upgrade_nodes(spec)


def part_id(kind: str, item: int) -> str:
    return f"{kind.lower()}-{item}"


def build_topic(spec: dict, techtree: dict, icons: dict, descriptions: dict) -> dict:
    parts = []
    for kind, item in nodes_of(spec):
        index, name = icons[(kind, item)]
        parts.append(
            {
                "id": part_id(kind, item),
                "name": name,
                "img": f"img/topics/{part_id(kind, item)}.png",
                "icon_index": index,
            }
        )

    unit_id = part_id("Unit", spec["unit"]) if spec.get("unit") else None
    upgrade_ids = [part_id(kind, item) for kind, item in upgrade_nodes(spec)]

    civs = {}
    for name, tree in sorted(techtree["civs"].items()):
        has = [part_id(kind, item) for kind, item in nodes_of(spec) if item in tree[kind]]
        missing = [u for u in upgrade_ids if u not in has]
        # without a gate unit, having none of the upgrades is what "none" means
        nothing = unit_id not in has if unit_id else len(missing) == len(upgrade_ids)
        tier = "none" if nothing else "partial" if missing else "full"
        found = bonus_claims(spec, descriptions[name])
        fixed = spec.get("bonus_fix", {}).get(name)
        civs[name.lower()] = {
            "tier": tier,
            "has": has,
            "missing": missing,
            "bonus": bool(found) if fixed is None else fixed,
            "why": found,
        }

    return {
        "id": spec["id"],
        "name": spec["name"],
        "icon": parts[0]["img"],
        "unit": unit_id,
        "upgrades": upgrade_ids,
        "parts": parts,
        "tiers": tiers_for(unit_id, upgrade_ids),
        "civs": civs,
    }


def cross_check(techtree: dict, civdata_path: Path) -> int:
    civdata = json.loads(civdata_path.read_text(encoding="utf-8"))["civs"]
    problems = 0
    checked = []
    for spec in TOPICS:
        for kind, item in nodes_of(spec):
            if kind == "Tech":
                checked.append((kind, item, item))
            elif item in UNIT_ENABLER:
                checked.append((kind, item, UNIT_ENABLER[item]))
            else:
                print(f"cross-check: no enabling tech known for unit {item}", file=sys.stderr)
                problems += 1

    for name, tree in techtree["civs"].items():
        key = DAT_ALIASES.get(name, name)
        if key not in civdata:
            print(f"cross-check: {name} not in civdata.json", file=sys.stderr)
            problems += 1
            continue
        disabled = {int(x["d"]) for x in civdata[key]["tech_tree"]["availability"]}
        for kind, item, dat_id in checked:
            if (item in tree[kind]) != (dat_id not in disabled):
                print(f"cross-check: {name} disagrees on {kind} {item}", file=sys.stderr)
                problems += 1
    return problems


def download_images(commit: str, data: dict) -> None:
    wanted = {}
    for civ in data["civs"].values():
        wanted[civ["img"]] = f"img/Civs/{Path(civ['img']).name}"
    for topic in data["topics"]:
        for part in topic["parts"]:
            folder = "Unit" if part["id"].startswith("unit") else "Tech"
            wanted[part["img"]] = f"img/{folder}/{part['icon_index']}.png"

    for local, remote in sorted(wanted.items()):
        target = ROOT / local
        if target.exists():
            continue
        target.parent.mkdir(parents=True, exist_ok=True)
        url = f"https://raw.githubusercontent.com/{REPO}/{commit}/{remote}"
        target.write_bytes(fetch(url))
        print(f"  {local}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--civdata", type=Path, help="Aoe2Planner civdata.json to cross-check against")
    parser.add_argument("--commit", help="pin to this aoe2techtree commit instead of master")
    args = parser.parse_args()

    for spec in TOPICS:
        if len(spec["upgrades"]) > MAX_UPGRADES:
            print(f"{spec['id']}: more than {MAX_UPGRADES} upgrades", file=sys.stderr)
            return 1

    commit = args.commit or head_commit()
    print(f"aoe2techtree @ {commit}")
    techtree = json.loads(fetch(f"https://raw.githubusercontent.com/{REPO}/{commit}/data/data.json"))

    if args.civdata:
        problems = cross_check(techtree, args.civdata)
        print(f"cross-check: {len(techtree['civs'])} civs, {problems} disagreements")
        if problems:
            return 1

    wanted_nodes = {node for spec in TOPICS for node in nodes_of(spec)}
    icons = icon_indices(commit, techtree, wanted_nodes)

    strings = json.loads(
        fetch(f"https://raw.githubusercontent.com/{REPO}/{commit}/data/locales/en/strings.json")
    )
    unknown = [name for name in techtree["civs"] if name not in CIV_ID]
    if unknown:
        print(f"no civ id for {unknown} -- add them to CIV_ID", file=sys.stderr)
        return 1
    descriptions = {
        name: civ_claims(strings[str(HELP_STRING_BASE + CIV_ID[name] - 1)])
        for name in techtree["civs"]
    }

    data = {
        "source": {
            "repo": REPO,
            "commit": commit,
            "note": "civ availability extracted from the game's .dat by aoe2techtree",
        },
        "civs": {
            name.lower(): {"name": name, "img": f"img/civs/{name.lower()}.png"}
            for name in sorted(techtree["civs"])
        },
        "topics": [build_topic(spec, techtree, icons, descriptions) for spec in TOPICS],
    }

    # a .js assignment rather than .json, so the page also works opened straight
    # off disk: a file:// page may not fetch, but it may load a script
    out = ROOT / "data" / "topics.js"
    out.parent.mkdir(parents=True, exist_ok=True)
    body = json.dumps(data, indent=1, ensure_ascii=False)
    out.write_text(f"window.QUIZ_DATA = {body};\n", encoding="utf-8")
    print(f"{out.relative_to(ROOT)}: {len(data['civs'])} civs, {len(data['topics'])} topics")

    download_images(commit, data)
    for topic in data["topics"]:
        counts = {}
        for civ in topic["civs"].values():
            counts[civ["tier"]] = counts.get(civ["tier"], 0) + 1
        print(f"{topic['id']}: {counts}")
        # an upgrade no civ lacks can never be a right answer in the picker
        for upgrade in topic["upgrades"]:
            lacking = sum(1 for civ in topic["civs"].values() if upgrade in civ["missing"])
            name = next(p["name"] for p in topic["parts"] if p["id"] == upgrade)
            print(f"    {name}: lacked by {lacking}")
        with_bonus = {c: v for c, v in topic["civs"].items() if v["bonus"]}
        print(f"    bonus: {len(with_bonus)} civs")
        for civ, value in sorted(with_bonus.items()):
            for why in value["why"] or ["(forced)"]:
                print(f"      {civ:14} {why}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
