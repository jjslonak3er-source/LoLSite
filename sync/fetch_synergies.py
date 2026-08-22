#!/usr/bin/env python3
"""Fetch LoLalytics normalised synergy Δ2 without a browser."""

from __future__ import annotations

import argparse
import csv
import json
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from fetch_counters import champion_slug, http_get, load_champions

MEGA = (
    "https://a1.lolalytics.com/mega/"
    "?ep=build-team&v=1&patch={patch}&c={slug}"
    "&lane={lane}&tier={tier}&queue=ranked&region=all"
)
LANES = ("top", "jungle", "middle", "bottom", "support")
FIELDS = [
    "main_champion",
    "teammate_champion",
    "teammate_lane",
    "delta",
    "games",
    "winrate",
    "pick_rate",
]


def key_to_name(champs: list[dict]) -> dict[int, str]:
    mapping: dict[int, str] = {}
    for champ in champs:
        try:
            mapping[int(champ["key"])] = champ["name"]
        except (TypeError, ValueError, KeyError):
            continue
    return mapping


def parse_team(payload: dict, names: dict[int, str], main_name: str) -> list[dict]:
    team = payload.get("team")
    if not isinstance(team, dict):
        raise RuntimeError("no team object in mega response")
    rows: list[dict] = []
    seen: set[tuple[str, str]] = set()
    for lane in LANES:
        records = team.get(lane) or []
        if not isinstance(records, list):
            continue
        for record in records:
            if not isinstance(record, list) or len(record) < 6:
                continue
            champ_id, winrate, _d1, delta, pick_rate, games = record[:6]
            try:
                champ_id = int(champ_id)
                delta = round(float(delta), 2)
                games = int(games)
            except (TypeError, ValueError):
                continue
            teammate = names.get(champ_id)
            if not teammate or teammate.casefold() == main_name.casefold():
                continue
            key = (teammate, lane)
            if key in seen:
                continue
            seen.add(key)
            rows.append(
                {
                    "teammate_champion": teammate,
                    "teammate_lane": lane,
                    "delta": delta,
                    "games": games,
                    "winrate": winrate,
                    "pick_rate": pick_rate,
                }
            )
    return rows


def fetch_one(champ: dict, names: dict[int, str], tier: str, patch_query: str, lane: str) -> dict:
    slug = champion_slug(champ)
    url = MEGA.format(patch=patch_query, slug=slug, lane=lane, tier=tier)
    page = http_get(url)
    try:
        payload = json.loads(page)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"invalid JSON ({len(page)} bytes)") from exc
    if not payload.get("response", {}).get("valid") and "team" not in payload:
        raise RuntimeError(page[:160].replace("\n", " "))
    rows = parse_team(payload, names, champ["name"])
    if not rows:
        raise RuntimeError("no synergy rows parsed")
    return {"main_champion": champ["name"], "synergies": rows}


def already_done(path: Path) -> set[str]:
    if not path.exists():
        return set()
    with path.open(newline="", encoding="utf-8") as handle:
        return {row["main_champion"] for row in csv.DictReader(handle) if row.get("main_champion")}


def append_rows(path: Path, result: dict, write_header: bool) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=FIELDS)
        if write_header:
            writer.writeheader()
        for row in result["synergies"]:
            writer.writerow(
                {
                    "main_champion": result["main_champion"],
                    "teammate_champion": row["teammate_champion"],
                    "teammate_lane": row["teammate_lane"],
                    "delta": f"{row['delta']:.2f}",
                    "games": row["games"],
                    "winrate": row.get("winrate") if row.get("winrate") is not None else "",
                    "pick_rate": row.get("pick_rate") if row.get("pick_rate") is not None else "",
                }
            )
    return len(result["synergies"])


def main() -> int:
    parser = argparse.ArgumentParser(description="Download LoLalytics normalised synergy Δ2 pairings.")
    parser.add_argument("--tier", default="emerald_plus")
    parser.add_argument("--patch", default="30")
    parser.add_argument("--lane", default="all")
    parser.add_argument("--workers", type=int, default=2)
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--out", default="champion_synergies.csv")
    parser.add_argument("--fresh", action="store_true")
    args = parser.parse_args()
    out_path = Path(args.out)

    ddragon_patch, champs = load_champions()
    names = key_to_name(champs)
    done_names = set() if args.fresh else already_done(out_path)
    if args.fresh and out_path.exists():
        out_path.unlink()
    pending = [champ for champ in champs if champ["name"] not in done_names]
    if args.limit:
        pending = pending[: args.limit]

    print(
        f"Data Dragon patch {ddragon_patch}. "
        f"{len(done_names)} already in {out_path.name}, {len(pending)} remaining.",
        flush=True,
    )
    if not pending:
        print("Nothing to fetch.", flush=True)
        return 0

    failures: list[str] = []
    finished = 0
    started = time.time()
    header_needed = not out_path.exists()

    with ThreadPoolExecutor(max_workers=max(1, args.workers)) as pool:
        futures = {
            pool.submit(fetch_one, champ, names, args.tier, args.patch, args.lane): champ["name"]
            for champ in pending
        }
        for future in as_completed(futures):
            name = futures[future]
            finished += 1
            try:
                result = future.result()
                append_rows(out_path, result, header_needed)
                header_needed = False
                elapsed = time.time() - started
                rate = finished / elapsed if elapsed else 0
                print(
                    f"[{finished}/{len(pending)}] {name}: {len(result['synergies'])} synergies "
                    f"({rate:.2f}/s)",
                    flush=True,
                )
            except Exception as exc:  # noqa: BLE001
                failures.append(f"{name}: {exc}")
                print(f"[{finished}/{len(pending)}] {name}: FAILED {exc}", flush=True)

    elapsed = time.time() - started
    print(f"\nFinished {finished} champions in {elapsed:.1f}s -> {out_path}", flush=True)
    if failures:
        print(f"{len(failures)} failed (re-run the same command to retry them):", flush=True)
        for line in failures[:20]:
            print(" ", line, flush=True)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
