#!/usr/bin/env python3
"""Fetch LoLalytics counter matchups without a browser.

Lolalytics server-renders the full counter table. This downloads those pages
over HTTP and writes cleaned Δ2 values to CSV.
"""

from __future__ import annotations

import argparse
import csv
import html as htmlmod
import json
import re
import shutil
import subprocess
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

DDRAGON_VERSIONS = "https://ddragon.leagueoflegends.com/api/versions.json"
DDRAGON_CHAMPS = "https://ddragon.leagueoflegends.com/cdn/{patch}/data/en_US/champion.json"
LOLALYTICS = "https://lolalytics.com/lol/{slug}/counters/"

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
)

SLUG_ALIASES = {
    "nunuwillump": "nunu",
    "nunuandwillump": "nunu",
    "renataglasc": "renata",
    "monkeyking": "wukong",
}

FIELDS = [
    "main_champion",
    "main_champion_games",
    "counter_champion",
    "delta",
    "matchup_games",
]

CARD_DELTA_RE = re.compile(
    r'class="text-yellow-100">Δ<sub>2</sub>\s*([+\-]?\d+(?:\.\d+)?)'
)
CARD_NAME_RE = re.compile(
    r'h-\[20px\][^>]*>\s*(?:<!--t=\w+-->)?([^<]+)'
)
CARD_GAMES_RE = re.compile(
    r'class="mb-1 text-xs text-gray-500">([\d,]+)\s+Games'
)
ANALYSED_RE = re.compile(r"Analysed:\s*([\d,]+)")
DELTA_PREFIX_RE = re.compile(r"^Δ2", re.I)
CARD_SPLIT = "h-[254px] w-[118px]"


def slugify(name: str) -> str:
    return re.sub(r"[^a-z0-9]", "", name.lower())


def champion_slug(champ: dict) -> str:
    raw = slugify(champ["name"])
    return SLUG_ALIASES.get(raw, raw)


def parse_delta(raw: str) -> float | None:
    text = htmlmod.unescape(raw).strip()
    text = DELTA_PREFIX_RE.sub("", text)
    text = text.replace("Δ", "").replace("+", "").strip()
    try:
        return round(float(text), 2)
    except ValueError:
        return None


def http_get(url: str, timeout: int = 20) -> str:
    """Download a URL, killing hung transfers instead of waiting forever."""
    curl = shutil.which("curl.exe") or shutil.which("curl")
    if curl:
        try:
            completed = subprocess.run(
                [
                    curl,
                    "-sSL",
                    "--http1.1",
                    "--connect-timeout",
                    "8",
                    "--max-time",
                    str(timeout),
                    "-A",
                    USER_AGENT,
                    url,
                ],
                capture_output=True,
                timeout=timeout + 3,
            )
        except subprocess.TimeoutExpired as exc:
            raise RuntimeError(f"timed out after {timeout}s") from exc
        if completed.returncode != 0 or not completed.stdout:
            err = completed.stderr.decode("utf-8", "replace")[:240]
            raise RuntimeError(err or f"curl exit {completed.returncode}")
        return completed.stdout.decode("utf-8", "replace")

    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "text/html"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read().decode("utf-8", "replace")


def load_champions() -> tuple[str, list[dict]]:
    versions = json.loads(http_get(DDRAGON_VERSIONS))
    patch = versions[0]
    payload = json.loads(http_get(DDRAGON_CHAMPS.format(patch=patch)))
    champs = sorted(payload["data"].values(), key=lambda c: c["name"])
    return patch, champs


def parse_counters(page_html: str, main_name: str) -> tuple[str | None, list[dict]]:
    analysed = ANALYSED_RE.search(page_html)
    games = analysed.group(1).replace(",", "") if analysed else None
    rows = []
    seen = set()
    for block in page_html.split(CARD_SPLIT)[1:]:
        name_match = CARD_NAME_RE.search(block)
        delta_match = CARD_DELTA_RE.search(block)
        games_match = CARD_GAMES_RE.search(block)
        if not name_match or not delta_match:
            continue
        name = htmlmod.unescape(name_match.group(1)).strip()
        if not name or name.casefold() == main_name.casefold():
            continue
        if name.lower().startswith("all "):
            continue
        delta = parse_delta(delta_match.group(1))
        if delta is None or name in seen:
            continue
        seen.add(name)
        rows.append(
            {
                "counter_champion": name,
                "delta": delta,
                "matchup_games": games_match.group(1).replace(",", "") if games_match else "",
            }
        )
    return games, rows


def fetch_one(champ: dict, tier: str, patch_query: str | None) -> dict:
    slug = champion_slug(champ)
    query = [f"tier={tier}"]
    if patch_query:
        query.append(f"patch={patch_query}")
    url = LOLALYTICS.format(slug=slug) + "?" + "&".join(query)
    page = http_get(url)
    if len(page) < 20000:
        raise RuntimeError(f"page too small ({len(page)} bytes), likely blocked")
    games, counters = parse_counters(page, champ["name"])
    if not counters:
        raise RuntimeError("no Δ2 rows parsed")
    return {
        "main_champion": champ["name"],
        "main_champion_games": games,
        "counters": counters,
    }


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
        for row in result["counters"]:
            writer.writerow(
                {
                    "main_champion": result["main_champion"],
                    "main_champion_games": result["main_champion_games"] or "",
                    "counter_champion": row["counter_champion"],
                    "delta": f"{row['delta']:.2f}",
                    "matchup_games": row.get("matchup_games") or "",
                }
            )
    return len(result["counters"])


def main() -> int:
    parser = argparse.ArgumentParser(description="Download LoLalytics counter Δ2 matchups to CSV.")
    parser.add_argument("--tier", default="all")
    parser.add_argument(
        "--patch",
        default="30",
        help="LoLalytics patch query. 30 = last 30 days.",
    )
    parser.add_argument(
        "--workers",
        type=int,
        default=3,
        help="Parallel downloads. Keep this low; LoLalytics will stall a stampede.",
    )
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--out", default="champion_counters.csv")
    parser.add_argument(
        "--fresh",
        action="store_true",
        help="Ignore an existing CSV and fetch every champion again.",
    )
    args = parser.parse_args()
    patch_query = args.patch.strip() or None
    out_path = Path(args.out)

    ddragon_patch, champs = load_champions()
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
            pool.submit(fetch_one, champ, args.tier, patch_query): champ["name"] for champ in pending
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
                    f"[{finished}/{len(pending)}] {name}: {len(result['counters'])} counters "
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
