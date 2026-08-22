#!/usr/bin/env python3
"""Turn champion_counters.csv into counters.js."""

from __future__ import annotations

import argparse
import csv
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

ALIASES = {
    "nunuwillump": "Nunu",
    "nunuandwillump": "Nunu",
    "renataglasc": "Renata",
    "renata": "Renata",
    "wukong": "MonkeyKing",
    "monkeyking": "MonkeyKing",
}


def norm(name: str) -> str:
    return re.sub(r"[^a-z0-9]", "", name.lower())


def load_id_map(champions_js: Path) -> dict[str, str]:
    text = champions_js.read_text(encoding="utf-8-sig")
    text = text.replace("window.RIFT_DRAFT_DATA = ", "", 1).rstrip().rstrip(";")
    data = json.loads(text)
    mapping: dict[str, str] = {}
    for champ in data["champions"]:
        mapping[norm(champ["name"])] = champ["id"]
        mapping[norm(champ["id"])] = champ["id"]
    mapping.update(ALIASES)
    return mapping


def convert(csv_path: Path, champions_js: Path, out_path: Path) -> None:
    ids = load_id_map(champions_js)
    matchups: dict[str, dict[str, dict]] = {}
    missing: set[str] = set()
    pairs = 0
    with csv_path.open(encoding="utf-8", newline="") as handle:
        for row in csv.DictReader(handle):
            main_id = ids.get(norm(row["main_champion"]))
            counter_id = ids.get(norm(row["counter_champion"]))
            if not main_id:
                missing.add("main:" + row["main_champion"])
                continue
            if not counter_id:
                missing.add("counter:" + row["counter_champion"])
                continue
            try:
                delta = round(float(row["delta"]), 2)
            except (TypeError, ValueError):
                continue
            games = str(row.get("matchup_games") or "").replace(",", "").strip()
            entry = {"delta": delta}
            if games.isdigit():
                entry["games"] = int(games)
            matchups.setdefault(main_id, {})[counter_id] = entry
            pairs += 1

    payload = {
        "source": "LoLalytics counters",
        "pairs": pairs,
        "matchups": matchups,
    }
    out_path.write_text(
        "window.RIFT_COUNTERS = " + json.dumps(payload, separators=(",", ":")) + ";\n",
        encoding="utf-8",
    )
    print(f"Wrote {pairs} matchups to {out_path}")
    if missing:
        print("Unmatched names:")
        for name in sorted(missing):
            print(" ", name)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--csv", type=Path, default=ROOT / "cache" / "champion_counters.csv")
    parser.add_argument("--champions", type=Path, default=ROOT / "champions.js")
    parser.add_argument("--out", type=Path, default=ROOT / "counters.js")
    args = parser.parse_args()
    convert(args.csv, args.champions, args.out)


if __name__ == "__main__":
    main()
