"""Generate data/topics.json and download the icons it points at.

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

# A topic is a unit and the techs that have to be researched for it to be
# "complete". `key` is the one whose absence means the civ does not have the
# topic at all. Techs that every civ has (Chemistry, Ballistics) are left out:
# they cannot tell two civs apart, so they would be four more icons saying
# nothing.
TOPICS = [
    {
        "id": "hand_cannoneer",
        "name": "Hand Cannoneer",
        "unit": 5,
        "techs": [211, 212, 219],
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


def verdict(has_unit: bool, missing_techs: list) -> str:
    if not has_unit:
        return "none"
    return "full" if not missing_techs else "partial"


def build_topic(spec: dict, techtree: dict, icons: dict) -> dict:
    parts = []
    for kind, item in [("Unit", spec["unit"])] + [("Tech", t) for t in spec["techs"]]:
        index, name = icons[(kind, item)]
        parts.append(
            {
                "id": f"{kind.lower()}-{item}",
                "name": name,
                "img": f"img/topics/{kind.lower()}-{item}.png",
                "icon_index": index,
                "key": kind == "Unit",
            }
        )

    civs = {}
    for name, tree in sorted(techtree["civs"].items()):
        has_unit = spec["unit"] in tree["Unit"]
        has = [f"unit-{spec['unit']}"] if has_unit else []
        has += [f"tech-{t}" for t in spec["techs"] if t in tree["Tech"]]
        missing = [p["id"] for p in parts if p["id"] not in has]
        civs[name.lower()] = {
            "verdict": verdict(has_unit, [m for m in missing if m != parts[0]["id"]]),
            "has": has,
        }

    return {
        "id": spec["id"],
        "name": spec["name"],
        "icon": parts[0]["img"],
        "parts": parts,
        "civs": civs,
    }


def cross_check(techtree: dict, civdata_path: Path) -> int:
    civdata = json.loads(civdata_path.read_text(encoding="utf-8"))["civs"]
    # In the .dat a unit is gated by an enabling tech, and its id is not the
    # unit's: the Hand Cannoneer unit (5) is enabled by tech 85.
    unit_enabler = {5: 85}
    problems = 0

    for name, tree in techtree["civs"].items():
        key = DAT_ALIASES.get(name, name)
        if key not in civdata:
            print(f"cross-check: {name} not in civdata.json", file=sys.stderr)
            problems += 1
            continue
        disabled = {int(x["d"]) for x in civdata[key]["tech_tree"]["availability"]}
        for spec in TOPICS:
            pairs = [(spec["unit"], unit_enabler[spec["unit"]], "Unit")] + [
                (t, t, "Tech") for t in spec["techs"]
            ]
            for item, dat_id, kind in pairs:
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

    wanted_nodes = {("Unit", spec["unit"]) for spec in TOPICS}
    wanted_nodes |= {("Tech", t) for spec in TOPICS for t in spec["techs"]}
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

    out = ROOT / "data" / "topics.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(data, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"{out.relative_to(ROOT)}: {len(data['civs'])} civs, {len(data['topics'])} topics")

    download_images(commit, data)
    for topic in data["topics"]:
        counts = {}
        for civ in topic["civs"].values():
            counts[civ["verdict"]] = counts.get(civ["verdict"], 0) + 1
        print(f"{topic['id']}: {counts}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
