#!/usr/bin/env python3
"""Build the slim item/recipe file the dashboard loads.

Source: github.com/ao-data/ao-bin-dumps (items.json at repo root + formatted/items.txt).
Usage:  python3 -I build_data.py <items_root.json> <items_names.txt> docs/data/items.json
Re-run after a game patch; the dashboard needs nothing else rebuilt.
"""
import json
import re
import sys
from datetime import date

ROOT, NAMES, OUT = sys.argv[1], sys.argv[2], sys.argv[3]

# Crafting specialty city by market subcategory. Source: albionfreemarket.com city-bonus page
# (2026-11-13), inferred not measured — the dashboard labels it as such.
CRAFT_CITY = {
    "Thetford": ["mace", "naturestaff", "firestaff", "leather_armor", "cloth_helmet"],
    "Lymhurst": ["sword", "bow", "arcanestaff", "leather_helmet", "leather_shoes"],
    "Bridgewatch": ["crossbow", "dagger", "cursestaff", "plate_armor", "cloth_shoes"],
    "Martlock": ["axe", "quarterstaff", "froststaff", "plate_shoes", "booktype", "shieldtype", "torchtype"],
    "Fort Sterling": ["hammer", "spear", "holystaff", "plate_helmet", "cloth_armor"],
    "Caerleon": ["knuckles", "tools", "gatherergear"],
    "Brecilien": ["accessoires_capes_capes", "bags", "satchels"],
}
SUB_TO_CITY = {s: c for c, subs in CRAFT_CITY.items() for s in subs}

REFINE_TYPES = {  # raw -> refined, refining bonus city
    "ORE": ("METALBAR", "Thetford"),
    "HIDE": ("LEATHER", "Martlock"),
    "FIBER": ("CLOTH", "Lymhurst"),
    "WOOD": ("PLANKS", "Fort Sterling"),
    "ROCK": ("STONEBLOCK", "Bridgewatch"),
}


def as_list(v):
    if v is None:
        return []
    return v if isinstance(v, list) else [v]


def pick_recipe(item):
    """First crafting option that uses only market-tradable inputs (no faction tokens)."""
    for req in as_list(item.get("craftingrequirements")):
        res = as_list(req.get("craftresource"))
        if not res or any("TOKEN" in r["@uniquename"] for r in res):
            continue
        return {
            "in": [[r["@uniquename"], int(r["@count"])] for r in res],
            "focus": int(float(req.get("@craftingfocus", 0))),
            "out": int(req.get("@amountcrafted", 1)),
        }
    return None


names = {}
for line in open(NAMES, encoding="utf-8"):
    m = re.match(r"\s*\d+:\s*(\S+)\s*:\s*(.*)$", line)
    if m and m.group(2).strip():
        names[m.group(1)] = m.group(2).strip()

items = json.load(open(ROOT, encoding="utf-8"))["items"]
refine, craft, raw = [], [], []
used = set()

for x in as_list(items.get("simpleitem")):
    uid, tier = x["@uniquename"], int(x.get("@tier", 0))
    if x.get("@shopsubcategory1") == "resources" and x.get("@resourcetype") in REFINE_TYPES and 2 <= tier <= 8 \
            and re.fullmatch(r"T\d_[A-Z]+", uid):
        raw.append({"id": uid, "tier": tier, "type": x["@resourcetype"], "kg": float(x.get("@weight", 0))})
        used.add(uid)
    if x.get("@shopsubcategory1") == "refinedresources" and 2 <= tier <= 8 and re.fullmatch(r"T\d_[A-Z]+", uid):
        typ = next((k for k, v in REFINE_TYPES.items() if uid.endswith("_" + v[0])), None)
        rec = pick_recipe(x)
        if typ and rec:
            refine.append({"id": uid, "tier": tier, "type": typ, "city": REFINE_TYPES[typ][1],
                           "kg": float(x.get("@weight", 0)), **rec})
            used.add(uid)
            used.update(i for i, _ in rec["in"])

for group in ("weapon", "equipmentitem"):
    for x in as_list(items.get(group)):
        uid, tier = x["@uniquename"], int(x.get("@tier", 0))
        sub = x.get("@shopsubcategory1", "")
        if not (3 <= tier <= 8) or x.get("@showinmarketplace") == "false":
            continue
        rec = pick_recipe(x)
        if not rec:
            continue
        craft.append({"id": uid, "tier": tier, "cat": x.get("@shopcategory", ""), "sub": sub,
                      "city": SUB_TO_CITY.get(sub) or SUB_TO_CITY.get(x.get("@craftingcategory", ""), ""), "kg": float(x.get("@weight", 0)), **rec})
        used.add(uid)
        used.update(i for i, _ in rec["in"])

out = {
    "built": date.today().isoformat(),
    "source": "github.com/ao-data/ao-bin-dumps",
    "craftCities": CRAFT_CITY,
    "names": {k: names.get(k, k) for k in sorted(used)},
    "raw": raw,
    "refine": refine,
    "craft": craft,
}
json.dump(out, open(OUT, "w", encoding="utf-8"), separators=(",", ":"))
print(f"raw={len(raw)} refine={len(refine)} craft={len(craft)} names={len(out['names'])} -> {OUT}")
