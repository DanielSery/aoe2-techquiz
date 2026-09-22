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

# A topic is named and pictured by the unit it starts from -- the Crossbowman,
# not the Arbalester; the Light Cavalry, not the Hussar -- because what it asks
# about is the upgrades, and the upgraded unit is one of the answers.
#
# A topic is one unit and the upgrades that complete it, at most seven: the
# follow-up is a compass, one upgrade per direction, and right is taken by done. Every topic answers the same
# three ways: the civ has no unit, has it with something missing, or has it all.
#
# Only the *last* step of an upgrade line belongs here. A civ that has Bracer
# necessarily has Fletching and Bodkin Arrow, so listing those adds icons that
# can never be missing -- they could only ever cost points in the picker.
MAX_UPGRADES = 7

DEFENSE_BUILDINGS = [79, 234, 235, 117, 155, 1665]
DEFENSE_LEVEL_NODES = [("Building", item) for item in DEFENSE_BUILDINGS] + [("Tech", 50), ("Tech", 51)]

# An upgrade is a tech id, or ("Unit", id) where the upgrade is a unit of its
# own. `unit` may be left out: then the topic is the upgrades alone, and left
# means the civ has none of them rather than "no unit".
#
# `below` is the unit a civ is left with when it has none of this topic -- the
# Archer where the topic starts at the Crossbowman -- because "no" means two
# different things and the board should say which. It is a picture and nothing
# else: no tier, no claim, no bonus word. Only four topics have one, and which
# four is not a judgement call: `build_topic` checks that *every* civ with
# nothing here really does have it, so a topic where "no" means no cavalry at
# all (the Stable civs have no Scout Cavalry either) cannot quietly acquire one.
#
# `bonus` decides the down answer: does the civ have a civ bonus, team bonus or
# unique tech about this unit? That is not in the tech tree, so it is read out
# of the game's own civilisation descriptions -- `words` are the phrases that
# mean "this claim is about this unit", `veto` marks the words that mean
# something else (Cavalry Archers are not Arbalesters), and `bonus_fix` forces a
# civ either way when the reading is wrong. Every build prints what it matched,
# so the reading stays reviewable.
#
# The topic's own part names are words too and are not repeated here: a bonus
# about a tech the topic asks you about -- free Siege Engineers, free Thumb Ring
# -- is a bonus about the topic.
#
# Three things the words alone cannot say, all of them mistakes that were in
# here:
#   - a veto kills the *word*, not the claim. "Skirmishers and Elephant Archers
#     attack +25% faster" is a Skirmisher bonus, and throwing out the whole line
#     loses it.
#   - what a unit is strong *against*, and where a different unit is trained,
#     are not bonuses for it -- GUARDS reads what comes before the word.
#   - a bonus about a unit the civ cannot build is not a bonus about it, so
#     `build_topic` drops it: no card says "no unit, and a bonus about it".
TOPICS = [
    {
        "id": "hand_cannoneer",
        "group": "Archery Range",
        "name": "Hand Cannoneer",
        "unit": 5,
        "upgrades": [219],
        "words": [r"gunpowder", r"hand cannon\w*", r"archer armou?r"],
    },
    {
        # Four civs field the Armored Elephant where everyone else has a ram,
        # paired with the first two ram levels in the unit selector.
        "id": "siege_ram",
        "group": "Siege",
        "name": "Siege Ram / Siege Elephant",
        "unit": [1258, 1744],
        "icon": ("Unit", 548),
        "upgrades": [[("Unit", 422), ("Unit", 1746)], ("Unit", 548), 377],
        "words": [r"rams?", r"siege", r"siege elephants?"],
    },
    {
        # Shu, Wei and Wu field the Traction Trebuchet where everyone else has a
        # Bombard Cannon, so either of them is "has the unit".
        "id": "bombard_cannon",
        "group": "Siege",
        "name": "Bombard Cannon / Traction Trebuchet",
        "unit": [36, 1942],
        "upgrades": [377],
        "words": [r"gunpowder", r"bombard cannons?", r"siege"],
    },
    {
        "id": "scorpion",
        "group": "Siege",
        "name": "Scorpion",
        "unit": 279,
        "upgrades": [("Unit", 542), 377],
        "words": [r"scorpions?", r"siege"],
    },
    {
        # Like the Light Cavalry: the Mangonel is what a civ without the Onager
        # is left with, except where it has no Mangonel line at all.
        "id": "onager",
        "group": "Siege",
        "name": "Onager",
        "unit": 550,
        "below": ("Unit", 280),
        "upgrades": [("Unit", 588), 377],
        "words": [r"onagers?", r"mangonels?", r"siege"],
    },
    {
        # Gated on the Crossbowman, so a civ that stops at crossbows is partial
        # rather than "has nothing": the Arbalest is then one of the upgrades it
        # is missing. Only the Bulgarians and the Spanish have no crossbow at all.
        "id": "arbalester",
        "group": "Archery Range",
        "name": "Crossbowman",
        "unit": 24,
        "below": ("Unit", 4),
        "upgrades": [("Unit", 492), 201, 219, 437],
        "words": [r"archers?", r"archer-line", r"arbalest\w*", r"crossbow\w*", r"archery ranges?",
                  r"ranged soldiers?", r"archer armou?r"],
        "veto": [r"cavalry archer", r"mounted archer", r"elephant archer", r"camel archer",
                 r"fire archer", r"genitour", r"ballista", r"scorpion", r"chu ko nu",
                 r"double crossbow"],
    },
    {
        # Gated on the *Elite* Skirmisher, unlike the rest: every civ has the
        # Skirmisher, so gating on it asks a question with one answer and makes
        # the Elite an upgrade tile nobody can meaningfully weigh. Gated here,
        # the Elite is the unit and the Skirmisher is what a civ without it
        # keeps. No Thumb Ring either: it is an archer tech the Skirmisher
        # barely trades on, and one more icon on every card.
        "id": "skirmisher",
        "group": "Archery Range",
        "name": "Elite Skirmisher",
        "unit": 6,
        "below": ("Unit", 7),
        "upgrades": [201, 219],
        "words": [r"skirmishers?", r"skirmisher-line", r"foot archers?", r"archery ranges?",
                  r"ranged soldiers?", r"archer armou?r"],
        "veto": [r"cavalry archer", r"mounted archer", r"elephant archer", r"camel archer"],
    },
    {
        # Seven civs field a mounted archer of their own instead of the Cavalry
        # Archer, and no civ has two of them. Each has an Elite except the
        # Xianbei Raider, which stands in its own last-upgrade slot: it is
        # already the top of its line, so Wei is not missing an upgrade that
        # does not exist.
        "id": "cavalry_archer",
        "group": "Archery Range",
        "name": "Cavalry Archer / Elephant Archer / Bolas Rider / Xianbei Raider",
        "unit": [39, 873, 2569, 1952],
        "upgrades": [[("Unit", 474), ("Unit", 875), ("Unit", 2571), ("Unit", 1952)],
                     201, 219, 437, 435, 39, 436],
        "words": [r"cavalry archers?", r"mounted archers?", r"archery ranges?",
                  r"elephant archers?", r"bolas riders?", r"xianbei raiders?",
                  r"ranged soldiers?", r"archer armou?r", r"mounted units?"],
        "veto": [r"genitour", r"foot archers?"],
    },
    {
        "id": "halberdier",
        "group": "Barracks",
        "name": "Pikeman",
        "unit": 358,
        "below": ("Unit", 93),
        "upgrades": [("Unit", 359), 77, 75, 215],
        "words": [r"halberdiers?", r"pikemen", r"spearman", r"spearmen", r"infantry",
                  r"barracks"],
        "veto": [r"villagers?"],
        # the Incas' only Spearman-line line is "Villagers affected by Infantry
        # Blacksmith upgrades", where the infantry named are what the villagers
        # borrow from, not who gains
        "bonus_fix": {"Incas": False},
    },
    {
        "id": "champion",
        "group": "Barracks",
        "name": "Long Swordsman / Champi Warrior",
        "unit": [77, 2552],
        "below": ("Unit", 75),
        "upgrades": [[("Unit", 473), ("Unit", 2554)], [("Unit", 567), ("Unit", 1793)], 875, 215, 77, 75],
        "words": [r"militia-line", r"champions?", r"legionar\w*", r"champi\w*", r"infantry", r"barracks"],
        "veto": [r"villagers?"],
    },
    {
        # The Barracks unit nobody else has: the Eagle for the Aztecs and the
        # Maya, the Fire Lancer for the Chinese civs, the Temple Guard for the
        # Muisca. It is one question, asked of each civ about its own.
        "id": "eagle",
        "group": "Barracks",
        "name": "Eagle Scout / Fire Lancer / Temple Guard",
        "unit": [751, 1901, 2586],
        "upgrades": [[("Unit", 752), ("Unit", 1903), ("Unit", 2587)], 875, 215, 77, 75],
        "words": [r"eagles?", r"eagle warriors?", r"fire lancers?", r"temple guards?",
                  r"infantry", r"barracks"],
        "veto": [r"villagers?"],
    },
    {
        # The Scout is what a civ without the Light Cavalry is left with -- the
        # six civs with no Stable at all are left with nothing, and the rail is
        # drawn per topic rather than per civ, so it is generous to them. Drawn
        # per civ it would answer the card: "no Scout either" is only ever true
        # of a civ that cannot have the Light Cavalry.
        "id": "hussar",
        "group": "Stable",
        "name": "Light Cavalry",
        "unit": 546,
        "below": ("Unit", 448),
        "upgrades": [[("Unit", 441), ("Unit", 1707)], 435, 39, 80, 75],
        "words": [r"hussars?", r"light cavalry", r"scout cavalry", r"cavalry", r"stables?",
                  r"mounted units?", r"stable units?"],
        "veto": [r"cavalry archer", r"camel", r"elephant", r"hei guang cavalry",
                 r"xianbei raiders?"],
    },
    {
        # Three civs field a knight of their own: the Persians' Savar tops the
        # Knight line itself, the Gurjaras have the Shrivamsha Rider and Shu, Wei
        # and Wu the Hei Guang Cavalry. No civ has two of them.
        "id": "paladin",
        "group": "Stable",
        "name": "Knight / Shrivamsha Rider / Hei Guang Cavalry",
        "unit": [38, 1751, 1944],
        "upgrades": [[("Unit", 569), ("Unit", 1813), ("Unit", 1753), ("Unit", 1946)], 435, 39, 80, 75],
        "words": [r"paladins?", r"knights?", r"knight-line", r"shrivamsha riders?",
                  r"hei guang cavalry", r"cavalry", r"stables?", r"mounted units?",
                  r"stable units?"],
        # Steppe Husbandry is its own tech and carries the Husbandry the topic
        # asks about only as part of its name
        "veto": [r"cavalry archer", r"camel", r"elephant", r"scout cavalry", r"light cavalry",
                 r"xianbei raiders?", r"steppe husbandry"],
    },
    {
        "id": "camel",
        "group": "Stable",
        "name": "Camel Rider",
        "unit": 329,
        "upgrades": [("Unit", 330), 435, 39, 80, 75],
        "words": [r"camels?", r"camel riders?", r"mounted units?", r"stable units?"],
        "veto": [r"steppe husbandry"],
    },
    {
        "id": "battle_elephant",
        "group": "Stable",
        "name": "Battle Elephant",
        "unit": 1132,
        "upgrades": [("Unit", 1134), 435, 39, 80, 75],
        "words": [r"battle elephants?", r"elephants?", r"mounted units?", r"stable units?"],
        "veto": [r"elephant archer", r"ballista elephant", r"armored elephant", r"siege elephant"],
    },
    {
        "id": "steppe_lancer",
        "group": "Stable",
        "name": "Steppe Lancer",
        "unit": 1370,
        "upgrades": [("Unit", 1372), 435, 39, 80, 75],
        "words": [r"steppe lancers?", r"cavalry", r"mounted units?", r"stable units?"],
        "veto": [r"scout cavalry", r"light cavalry", r"cavalry archer", r"heavy cavalry archer"],
    },
    {
        "id": "monk",
        "group": "Monastery",
        "name": "Monk",
        "unit": 125,
        "upgrades": [316, 230, 252, 438, 319, 233, 231],
        "words": [r"monks?", r"monasteries", r"monastery", r"relics?", r"missionar\w*"],
        # Both name Monks or Relics as somebody else's: Atheism is about the
        # enemy's relics and a victory clock, and Chieftains pays for killing
        # a Monk. Neither does anything for a Monk of your own.
        "bonus_fix": {"Huns": False, "Vikings": False},
    },
    {
        # No unit at the foot of it: the topic is the upgrades themselves, so a
        # civ with none of the seven is the ✗ rather than "no unit". Bracer is
        # here because it is what gives a tower its range, which is the one
        # archer tech that is also a defensive one.
        "id": "defense",
        "group": "Defense",
        "name": "Defense",
        "icon": ("Tech", 63),
        "upgrades": [51, 63, 608, 201, 194, 379, 64],
        # "Castle" is the age as often as the building, and every civ has a
        # bonus that mentions an age
        "words": [r"towers?", r"walls?", r"fortifications?", r"keeps?", r"donjons?",
                  r"krepost", r"buildings?", r"castles?(?!\s*(?:age|/\s*imperial))"],
        # a Palisade is not the wall this topic upgrades -- and the veto has to
        # cover the word "Walls" beside it, not just "Palisade" -- while a siege
        # bonus is about knocking defences down rather than putting them up.
        # Tower Shields is a tech that arms infantry, an enemy Castle revealed
        # is not one of yours, and a military building is where units come from.
        "veto": [r"palisade walls?", r"palisade", r"siege", r"tower shields",
                 r"enemy castles?", r"military \w*\s?buildings?"],
        # What is left of these two after the vetoes still only mentions a
        # defence in passing: Kipchaks are trained per Castle, Red Cliffs
        # Tactics sets fire to somebody else's buildings, and needing no
        # buildings to advance an age is the Khmer's economy.
        "bonus_fix": {"Cumans": False, "Khmer": False, "Wu": False},
    },
    {
        # The Khitans farm from Pastures, so their last farm upgrade is
        # Transhumance -- Grazing Grasslands to the .dat -- and they have no
        # Crop Rotation at all: one slot, either tech. The other three are the
        # last rung of their own ladders.
        "id": "economy",
        "group": "Economy",
        "name": "Economy",
        "upgrades": [[12, 1012], 221, 182, 279],
        "words": [r"farm\w*", r"lumberjacks?", r"lumber camps?", r"mining camps?",
                  r"gold miners?", r"stone miners?", r"miners?", r"mills?",
                  r"economic upgrades?", r"economic technolog\w*"],
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


def as_node(item):
    return item if isinstance(item, tuple) else ("Tech", item)


def upgrade_groups(spec: dict) -> list:
    """One group per upgrade slot. A group of several is satisfied by any of
    them: a civ has the Paladin *or* the Savar, never both."""
    groups = []
    for item in spec["upgrades"]:
        groups.append([as_node(alt) for alt in item] if isinstance(item, list) else [as_node(item)])
    return groups


def upgrade_nodes(spec: dict) -> list:
    return [node for group in upgrade_groups(spec) for node in group]


def tiers_for(gate_ids: list, upgrade_ids: list) -> list:
    """The same three answers for every topic; `has` is what each one claims."""
    partial = list(gate_ids)
    return [
        {"id": "none", "dir": "left", "mark": "none", "has": []},
        {"id": "partial", "dir": "up", "mark": "partial", "has": partial},
        {"id": "full", "dir": "right", "mark": "full",
         "has": list(dict.fromkeys(partial + upgrade_ids))},
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
#
# None means the .dat cannot settle it, and every one of those is a *regional*
# unit: their enabling techs sit in no civ's disabled list, so reading the
# enable side hands the Battle Elephant, the Eagle and the Savar to all 53. It
# is the same blind spot for all of them, and measurable -- each disagreed for
# 40 to 52 civs, where every other gate here agreed for all 53. Those rest on
# aoe2techtree alone; the other 40 nodes are still double-sourced.
UNIT_ENABLER = {
    5: 85, 6: 98, 7: 99, 24: 100, 36: 188, 38: 166, 39: 192, 77: 207, 125: 157, 279: 94,
    329: None, 330: None, 358: 197, 359: 429, 422: 96, 441: 428, 474: 218, 492: 237, 542: 239,
    546: 254, 548: 255, 550: 257, 567: 264, 569: 265, 588: 320, 751: None, 752: None, 1132: None,
    1134: None, 1258: 162, 1370: None, 1372: None, 1707: None, 1744: 837, 1746: None, 1813: None,
    873: None, 875: None, 1751: None, 1753: None, 1944: None, 1946: None, 1901: None, 1903: None, 1942: None,
    1952: None, 2552: None, 2554: None, 2569: None, 2571: None, 2586: None, 2587: None,
}

# The same blind spot on the tech side. The .dat extraction on this machine has
# never heard of the Khitans' Pasture line, so nothing turns Grazing Grasslands
# off for anybody and the enable side hands it to all 53 -- it disagreed for
# exactly the 52 civs that do not have it. This one node rests on aoe2techtree
# alone; the other ten the two new topics name are still double-sourced.
UNSETTLED_TECHS = {1012}

# The two sources disagree here and the .dat is the one that cannot be trusted:
# nothing in the Mapuche's disabled list turns Fervor or Architecture off, yet
# the tech tree they are dealt carries neither -- the same enable-side blind spot
# as the Traction Trebuchet. Recorded rather than silently accepted.
KNOWN_DIVERGENCES = {("Mapuche", "Tech", 252), ("Mapuche", "Tech", 51)}


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
        # the game wraps a long bonus mid-sentence, always after a "/", and the
        # continuation carries no bullet: "in Dark/Feudal/Castle/" + "Imperial Age"
        if lines and lines[-1].endswith("/"):
            lines[-1] += claim
            continue
        lines.append(claim)
    return lines


# What a word means when it is somebody else's: "+3 vs. Rams" and "-3 damage
# from Mounted Units" are bonuses against them, "(except Skirmishers)" is the
# one unit the bonus leaves out, and "Condottiero available at the Barracks" is
# not a bonus about the unit the Barracks otherwise makes.
GUARDS = ("vs.", "from ", "except", "available at", "trained at")


def bonus_claims(spec: dict, claims: list, parts: list = ()) -> list:
    words = list(spec.get("words", [])) + [re.escape(name.lower()) for name in parts]
    veto = spec.get("veto", [])
    found = []
    for claim in claims:
        low = claim.lower()
        # a veto covers the words it names, not the sentence they stand in
        dead = [m.span() for pattern in veto for m in re.finditer(r"\b" + pattern, low)]
        for pattern in words:
            if any(
                not any(start <= hit.start() < end for start, end in dead)
                and not any(g in low[max(0, hit.start() - 18) : hit.start()] for g in GUARDS)
                for hit in re.finditer(r"\b" + pattern + r"\b", low)
            ):
                found.append(claim)
                break
    return found


def gate_units(spec: dict) -> list:
    """The units that mean the civ has the thing at all -- any one of them does."""
    unit = spec.get("unit")
    if unit is None:
        return []
    return [unit] if isinstance(unit, int) else list(unit)


def nodes_of(spec: dict) -> list:
    """Every (kind, id) the topic names once each: the gate units first, then the
    upgrades. A unit that is its own last upgrade is named twice and drawn once.

    `below` is deliberately not one of them: it is a picture of what a civ keeps,
    never a thing the card asks about, so it stays out of `parts` -- out of the
    bonus words, out of `has`, and out of the cross-check."""
    ordered = [("Unit", u) for u in gate_units(spec)] + upgrade_nodes(spec)
    return list(dict.fromkeys(ordered))


def part_id(kind: str, item: int) -> str:
    return f"{kind.lower()}-{item}"


def below_part(spec: dict, techtree: dict, icons: dict, civs: dict) -> dict | None:
    """What a civ with none of this topic still builds, and how true that is.

    One picture stands for every civ on the topic, so it can be generous: a Turk
    with no Pikeman has a Spearman and every civ without one does, but of the
    seven with no Light Cavalry only the Teutons have a Scout Cavalry -- the
    rest have no Stable at all. Drawn per civ instead it would answer the card,
    since "no Scout either" is only ever true of a civ that cannot have the
    Light Cavalry. So the shortfall is printed rather than fixed, and only a
    unit no civ here keeps is an outright mistake."""
    node = spec.get("below")
    if node is None:
        return None
    kind, item = node
    index, name = icons[node]
    nothing = [civ for civ, answer in civs.items() if answer["tier"] == "none"]
    keep = [
        civ
        for civ in nothing
        if item in next(t for n, t in techtree["civs"].items() if n.lower() == civ)[kind]
    ]
    if nothing and not keep:
        raise SystemExit(f"{spec['id']}: no civ with nothing here has the {name}")
    if len(keep) < len(nothing):
        print(f"{spec['id']}: {name} is what {len(keep)} of {len(nothing)} with nothing here keep"
              f" -- {sorted(set(nothing) - set(keep))} have not even that")
    return {
        "id": part_id(kind, item),
        "name": name,
        "img": f"img/topics/{part_id(kind, item)}.png",
        "icon_index": index,
    }


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

    gate_ids = [part_id("Unit", u) for u in gate_units(spec)]
    wanted_icon = part_id(*spec["icon"]) if spec.get("icon") else parts[0]["id"]
    icon_part = next(part for part in parts if part["id"] == wanted_icon)
    groups = [[part_id(kind, item) for kind, item in group] for group in upgrade_groups(spec)]
    upgrade_ids = [group[0] for group in groups]          # a slot answers to its first
    alts = {group[0]: group for group in groups if len(group) > 1}
    if gate_ids:
        alts[gate_ids[0]] = gate_ids

    civs = {}
    for name, tree in sorted(techtree["civs"].items()):
        has = [part_id(kind, item) for kind, item in nodes_of(spec) if item in tree[kind]]
        if spec.get("below"):
            kind, item = spec["below"]
            if item in tree[kind]:
                has.append(part_id(kind, item))
        missing = [group[0] for group in groups if not any(alt in has for alt in group)]
        # without a gate unit, having none of the upgrades is what "none" means
        nothing = (
            not any(gate in has for gate in gate_ids)
            if gate_ids
            else len(missing) == len(upgrade_ids)
        )
        tier = "none" if nothing else "partial" if missing else "full"
        found = bonus_claims(spec, descriptions[name], [part["name"] for part in parts])
        fixed = spec.get("bonus_fix", {}).get(name)
        claimed = bool(found) if fixed is None else fixed
        civs[name.lower()] = {
            "tier": tier,
            "has": has,
            "missing": missing,
            # a civ that cannot build the unit has no bonus about it, whatever
            # its siege or stable bonus says
            "bonus": claimed and tier != "none",
            "why": found,
        }

    return {
        "id": spec["id"],
        "name": spec["name"],
        "group": spec["group"],
        "icon": icon_part["img"],
        "below": below_part(spec, techtree, icons, civs),
        "unit": gate_ids[0] if gate_ids else None,
        "gate": gate_ids,
        "alts": alts,
        "upgrades": upgrade_ids,
        "parts": parts,
        "tiers": tiers_for(gate_ids, [part for group in groups for part in group]),
        "civs": trim_to_owners(civs, gate_ids),
        **({"buildingLevels": {
            "parts": [{"id": part_id(kind, item), "name": icons[(kind, item)][1],
                       "img": f"img/topics/{part_id(kind, item)}.png", "icon_index": icons[(kind, item)][0]}
                      for kind, item in DEFENSE_LEVEL_NODES],
            "civs": {name.lower(): [part_id(kind, item) for kind, item in DEFENSE_LEVEL_NODES if item in tree[kind]]
                     for name, tree in techtree["civs"].items()},
        }} if spec["id"] == "defense" else {}),
    }


# A unit only a handful of civs field makes a duller question than "which of the
# civs that have it have it fully": below this, the deck is only those civs.
RARE = 10


def trim_to_owners(civs: dict, gate_ids: list) -> dict:
    if not gate_ids:
        return civs
    owners = {name: civ for name, civ in civs.items() if civ["tier"] != "none"}
    return owners if len(owners) < RARE else civs


def cross_check(techtree: dict, civdata_path: Path) -> int:
    civdata = json.loads(civdata_path.read_text(encoding="utf-8"))["civs"]
    problems = 0
    checked = []
    for spec in TOPICS:
        for kind, item in nodes_of(spec):
            if kind == "Tech" and item in UNSETTLED_TECHS:
                print(f"cross-check: {kind} {item} cannot be settled by the .dat", file=sys.stderr)
            elif kind == "Tech":
                checked.append((kind, item, item))
            elif UNIT_ENABLER.get(item):
                checked.append((kind, item, UNIT_ENABLER[item]))
            elif item in UNIT_ENABLER:
                print(f"cross-check: {kind} {item} cannot be settled by the .dat", file=sys.stderr)
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
                if (name, kind, item) in KNOWN_DIVERGENCES:
                    print(f"cross-check: {name} {kind} {item} is a known divergence")
                    continue
                print(f"cross-check: {name} disagrees on {kind} {item}", file=sys.stderr)
                problems += 1
    return problems


def download_images(commit: str, data: dict) -> None:
    wanted = {}
    for civ in data["civs"].values():
        wanted[civ["img"]] = f"img/Civs/{Path(civ['img']).name}"
    for topic in data["topics"]:
        for part in topic["parts"] + [p for p in [topic["below"]] if p] + topic.get("buildingLevels", {}).get("parts", []):
            folder = "Building" if part["id"].startswith("building") else "Unit" if part["id"].startswith("unit") else "Tech"
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
    wanted_nodes |= {spec["below"] for spec in TOPICS if spec.get("below")}
    wanted_nodes |= set(DEFENSE_LEVEL_NODES)
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
