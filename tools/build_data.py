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
import sys
import urllib.request
from pathlib import Path

REPO = "SiegeEngineers/aoe2techtree"
API = f"https://api.github.com/repos/{REPO}"
ROOT = Path(__file__).resolve().parent.parent

# A topic is a ladder of rungs, worst first, and a civ sits on the highest rung
# it can reach. The short form below -- a unit and the techs that complete it --
# expands to the three-rung ladder in `default_ladder`; write `ladder` out in
# full for a topic that wants all four directions, e.g. the stable:
#
#   {"id": "knight_line", "name": "Knight line", "ladder": [
#       {"id": "none",    "dir": "left",  "mark": "none",    "units": [], "techs": []},
#       {"id": "bare",    "dir": "down",  "mark": "bare",    "units": [38], "techs": []},
#       {"id": "partial", "dir": "up",    "mark": "partial", "units": [283], "techs": []},
#       {"id": "full",    "dir": "right", "mark": "full",    "units": [569], "techs": []}]}
#
# Techs that every civ has (Chemistry, Ballistics) are left out of Hand
# Cannoneer: they cannot tell two civs apart, so they would be icons saying
# nothing.
TOPICS = [
    {
        "id": "hand_cannoneer",
        "name": "Hand Cannoneer",
        "unit": 5,
        "techs": [211, 212, 219],
    },
    {
        # A rung lists everything it has, not only what it adds, because the pad
        # draws a rung's icons: say only "Siege Ram" and the Capped Ram it was
        # upgraded from would be drawn as missing.
        "id": "siege_ram",
        "name": "Siege Ram",
        "ladder": [
            {"id": "none", "dir": "left", "mark": "none", "units": [], "techs": []},
            {"id": "bare", "dir": "down", "mark": "bare", "units": [422], "techs": [377]},
            {"id": "partial", "dir": "up", "mark": "partial", "units": [422, 548], "techs": []},
            {"id": "full", "dir": "right", "mark": "full", "units": [422, 548], "techs": [377]},
        ],
    },
    {
        "id": "bombard_cannon",
        "name": "Bombard Cannon",
        "ladder": [
            {"id": "none", "dir": "left", "mark": "none", "units": [], "techs": []},
            {"id": "partial", "dir": "up", "mark": "partial", "units": [36], "techs": []},
            {"id": "full", "dir": "right", "mark": "full", "units": [36], "techs": [377]},
        ],
    },
    {
        "id": "arbalester",
        "name": "Arbalester",
        "ladder": [
            {"id": "none", "dir": "left", "mark": "none", "units": [], "techs": []},
            {
                "id": "partial",
                "dir": "up",
                "mark": "partial",
                "units": [492],
                "techs": [201, 219],
            },
            {
                "id": "full",
                "dir": "right",
                "mark": "full",
                "units": [492],
                "techs": [201, 219, 437],
            },
        ],
    },
]


def default_ladder(spec: dict) -> list:
    return [
        {"id": "none", "dir": "left", "mark": "none", "units": [], "techs": []},
        {"id": "partial", "dir": "up", "mark": "partial", "units": [spec["unit"]], "techs": []},
        {
            "id": "full",
            "dir": "right",
            "mark": "full",
            "units": [spec["unit"]],
            "techs": spec["techs"],
        },
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


def ladder_of(spec: dict) -> list:
    return spec.get("ladder") or default_ladder(spec)


def nodes_of(spec: dict) -> list:
    """Every (kind, id) the topic mentions: units first, then techs, in rung order."""
    seen = []
    for kind in ("Unit", "Tech"):
        for rung in ladder_of(spec):
            for item in rung["units" if kind == "Unit" else "techs"]:
                if (kind, item) not in seen:
                    seen.append((kind, item))
    return seen


def part_id(kind: str, item: int) -> str:
    return f"{kind.lower()}-{item}"


def build_topic(spec: dict, techtree: dict, icons: dict) -> dict:
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

    ladder = ladder_of(spec)
    tiers = [
        {
            "id": rung["id"],
            "dir": rung["dir"],
            "mark": rung["mark"],
            "has": [part_id("Unit", u) for u in rung["units"]]
            + [part_id("Tech", t) for t in rung["techs"]],
        }
        for rung in ladder
    ]

    civs = {}
    for name, tree in sorted(techtree["civs"].items()):
        has = [part_id(kind, item) for kind, item in nodes_of(spec) if item in tree[kind]]
        reached = [tier["id"] for tier in tiers if all(need in has for need in tier["has"])]
        civs[name.lower()] = {"tier": reached[-1], "has": has}

    return {
        "id": spec["id"],
        "name": spec["name"],
        "icon": parts[0]["img"],
        "parts": parts,
        "tiers": tiers,
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
        "topics": [build_topic(spec, techtree, icons) for spec in TOPICS],
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
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
