#!/usr/bin/env python3
"""Fetch LoLalytics per-role base win rates without a browser.

The tier list table is virtualized in the DOM, but Qwik SSR embeds every
champion's Emerald+ Performance row in the page JSON. This pulls Name, Win,
and Games for top / jungle / middle / bottom / support.
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import sys
from datetime import datetime
from pathlib import Path

from fetch_counters import http_get

TIERLIST = "https://lolalytics.com/lol/tierlist/"
LANES = [
    ("top", "top"),
    ("jungle", "jng"),
    ("middle", "mid"),
    ("bottom", "adc"),
    ("support", "sup"),
]
FIELDS = ["champion", "champion_id", "role", "lane", "winrate", "games", "lane_pct", "rank", "lane_avg_wr"]
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


def qwik_objs(page_html: str) -> list:
    marker = 'type="qwik/json">'
    if marker not in page_html:
        raise RuntimeError("no qwik/json payload")
    raw = page_html.split(marker, 1)[1].split("</script>", 1)[0]
    payload = json.loads(raw)
    objs = payload.get("objs")
    if not isinstance(objs, list) or len(objs) < 100:
        raise RuntimeError("qwik objs missing")
    return objs


def deref(objs: list, val):
    if not isinstance(val, str) or not val.isalnum() or len(val) > 4:
        return val
    try:
        idx = int(val, 36)
    except ValueError:
        return val
    if 0 <= idx < len(objs):
        return objs[idx]
    return val


def unwrap_row(objs: list, row: dict) -> dict:
    return {key: deref(objs, value) for key, value in row.items()}


def find_stats_map(objs: list) -> dict:
    for obj in objs:
        if not isinstance(obj, dict) or len(obj) < 40:
            continue
        sample = deref(objs, next(iter(obj.values())))
        if isinstance(sample, dict) and "wr" in sample and "games" in sample:
            return obj
    raise RuntimeError("could not find winrate table in qwik data")


def find_key_to_slug(objs: list) -> dict:
    for obj in objs:
        if not isinstance(obj, dict) or len(obj) < 40:
            continue
        keys = list(obj.keys())[:12]
        if not all(str(key).isdigit() for key in keys):
            continue
        sample = deref(objs, next(iter(obj.values())))
        if isinstance(sample, str) and sample.isalpha() and sample.islower():
            return obj
    raise RuntimeError("could not find champion key map")


def find_slug_to_name(objs: list, slugs: set[str]) -> dict:
    for obj in objs:
        if not isinstance(obj, dict) or len(obj) < 40:
            continue
        if not (slugs & set(obj.keys())):
            continue
        sample = deref(objs, next(iter(obj.values())))
        if isinstance(sample, str) and sample[:1].isupper() and " " not in sample[:1]:
            return obj
    return {}


def to_float(val) -> float | None:
    if val is None or val == "":
        return None
    try:
        return float(str(val).replace(",", "").replace("%", "").strip())
    except ValueError:
        return None


def to_int(val) -> int | None:
    num = to_float(val)
    return int(num) if num is not None else None


def parse_avg_wr(page_html: str, objs: list) -> float | None:
    match = re.search(r"Average[^<]*Win Rate:\s*(?:<!--t=\w+-->)?([0-9.]+)", page_html)
    if match:
        return float(match.group(1))
    for obj in objs:
        if isinstance(obj, dict) and "avgWr" in obj:
            val = to_float(deref(objs, obj["avgWr"]))
            if val:
                return val
    return None


def parse_lane(page_html: str, lane: str, role: str, ids: dict[str, str]) -> tuple[float | None, list[dict], list[str]]:
    objs = qwik_objs(page_html)
    stats = find_stats_map(objs)
    key_to_slug = find_key_to_slug(objs)
    slugs = {deref(objs, value) for value in key_to_slug.values() if isinstance(deref(objs, value), str)}
    slug_to_name = find_slug_to_name(objs, slugs)
    avg_wr = parse_avg_wr(page_html, objs)
    rows = []
    missing = []
    for key, ref in stats.items():
        raw = deref(objs, ref)
        if not isinstance(raw, dict):
            continue
        row = unwrap_row(objs, raw)
        wr = to_float(row.get("wr"))
        games = to_int(row.get("games"))
        if wr is None or games is None:
            continue
        slug = deref(objs, key_to_slug.get(str(key), str(key)))
        if not isinstance(slug, str):
            slug = str(key)
        name = deref(objs, slug_to_name.get(slug, slug))
        if not isinstance(name, str):
            name = slug
        champ_id = ids.get(norm(name)) or ids.get(norm(slug))
        if not champ_id:
            missing.append(name)
        rows.append(
            {
                "champion": name,
                "champion_id": champ_id or "",
                "role": role,
                "lane": lane,
                "winrate": round(wr, 2),
                "games": games,
                "lane_pct": to_float(row.get("pctLane")),
                "rank": to_int(row.get("rank")),
                "lane_avg_wr": avg_wr,
            }
        )
    rows.sort(key=lambda item: item["rank"] if item["rank"] is not None else 10_000)
    weighted = weighted_avg_wr(rows)
    if weighted is not None:
        avg_wr = weighted
        for row in rows:
            row["lane_avg_wr"] = avg_wr
    return avg_wr, rows, missing


def weighted_avg_wr(rows: list[dict]) -> float | None:
    total_games = sum(row["games"] for row in rows)
    if not total_games:
        return None
    return round(sum(row["winrate"] * row["games"] for row in rows) / total_games, 2)


def write_js(rows: list[dict], out_path: Path, patch: str, tier: str) -> None:
    lanes: dict[str, dict] = {}
    for row in rows:
        if not row["champion_id"]:
            continue
        role = row["role"]
        bucket = lanes.setdefault(
            role,
            {"avg_wr": row.get("lane_avg_wr"), "champs": {}},
        )
        entry = {"wr": row["winrate"], "games": row["games"]}
        if row.get("lane_pct") is not None:
            entry["lane_pct"] = row["lane_pct"]
        bucket["champs"][row["champion_id"]] = entry
    payload = {
        "source": "LoLalytics tierlist",
        "patch_query": patch,
        "tier": tier or "emerald_plus",
        "synced": datetime.now().isoformat(timespec="seconds"),
        "lanes": lanes,
    }
    out_path.write_text(
        "window.RIFT_WINRATES = " + json.dumps(payload, separators=(",", ":")) + ";\n",
        encoding="utf-8",
    )
    print(f"Wrote {out_path}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Download LoLalytics per-role win rates.")
    parser.add_argument("--patch", default="14", help="LoLalytics timeframe/patch query. 14 = last 14 days.")
    parser.add_argument(
        "--tier",
        default="",
        help="LoLalytics tier query. Blank uses the site default (Emerald+).",
    )
    parser.add_argument("--out", default="champion_winrates.csv")
    parser.add_argument(
        "--site",
        default=r"C:\Users\jjslo\Code\lol-draft\winrates.js",
        help="Optional compact JS bundle for the draft site. Empty to skip.",
    )
    parser.add_argument(
        "--champions",
        default=r"C:\Users\jjslo\Code\lol-draft\champions.js",
    )
    args = parser.parse_args()
    ids = load_id_map(Path(args.champions)) if Path(args.champions).exists() else {}
    all_rows: list[dict] = []
    missing: set[str] = set()

    for lane, role in LANES:
        query = [f"lane={lane}"]
        if args.patch:
            query.append(f"patch={args.patch}")
        if args.tier:
            query.append(f"tier={args.tier}")
        url = TIERLIST + "?" + "&".join(query)
        print(f"Fetching {url}", flush=True)
        page = http_get(url)
        if len(page) < 20000:
            raise SystemExit(f"{lane}: page too small ({len(page)} bytes)")
        avg_wr, rows, lane_missing = parse_lane(page, lane, role, ids)
        missing.update(lane_missing)
        all_rows.extend(rows)
        print(f"  {role}: {len(rows)} champs, avg wr {avg_wr}", flush=True)

    out_path = Path(args.out)
    with out_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=FIELDS)
        writer.writeheader()
        for row in all_rows:
            writer.writerow(
                {
                    "champion": row["champion"],
                    "champion_id": row["champion_id"],
                    "role": row["role"],
                    "lane": row["lane"],
                    "winrate": f"{row['winrate']:.2f}",
                    "games": row["games"],
                    "lane_pct": "" if row["lane_pct"] is None else row["lane_pct"],
                    "rank": "" if row["rank"] is None else row["rank"],
                    "lane_avg_wr": "" if row["lane_avg_wr"] is None else row["lane_avg_wr"],
                }
            )
    print(f"Wrote {len(all_rows)} rows to {out_path}")
    if missing:
        print("Unmatched names:")
        for name in sorted(missing):
            print(" ", name)
    if args.site:
        write_js(all_rows, Path(args.site), args.patch, args.tier)
    return 0


if __name__ == "__main__":
    sys.exit(main())
