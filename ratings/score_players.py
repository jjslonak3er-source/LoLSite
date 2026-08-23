"""Role player ratings learned from Oracle's Elixir games.

Not wired into the draft board. The Players page reads `player-ratings.js`
(regenerated whenever this command runs).

The rater does four things, then blends them:

1. Form — in each role, a ridge model learns which in-game qualities actually
   move win probability. Stats are z-scored inside each league first, so an
   LCS box score is not compared raw against LCK/LPL. In LCK/LPL two-group
   stages, box scores are z-scored inside Legend/Ascend vs Rise/Nirvana.
2. Impact — a plus/minus (ridge RAPM) of whether the team wins when this
   player is on the rift, then team-centered and z-scored within league.
3. Region — each club is mapped to its domestic league, then international
   events rate those *teams*. A region's score is the unweighted average of
   its representatives (so a top-heavy league does not stand in for the
   2nd/3rd seeds), then flattened so LCK stays ahead without dominating.
4. Tier — LCK Rounds 3-4 and LPL group stages split into a high group
   (Legend / Ascend) and a low group (Rise / Nirvana). High-group games
   count more; low-group games are downweighted hard and carry a steep
   penalty so Rise/Nirvana box scores do not look like Legend/Ascend.

Players stay on the board after they stop playing. After 30 idle days
(including internationals and partials), extra names are mapped onto the
live ladder and then halved every 30 days. They do not move the ~0 center
or the z-scores of currently active players.

Scores are the raw blend (form / impact / region / tier). Form and impact
are z-scored, so a typical name sits near zero before region and tier
nudge them. We do not re-center the final list at 0.

  From lol-draft (not lol-counters):

    cd C:/Users/jjslo/Code/lol-draft
    python -m ratings.score_players --csv oracles.csv --role mid --top 20
    python -m ratings.score_players --csv oracles.csv --champ Ezreal --top 10
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from sync_oracles import newest_local_csv, resolve_csv

from ratings.features import FEATURE_KEYS, ROLES, load_games, load_intl_games, load_team_regions, player_last_dates
from ratings.model import FORM_PRIOR, INACTIVE_GRACE_DAYS, INACTIVE_HALFLIFE, SHRINK_GAMES, rate_players


def cutoff_from(games: list[dict], days: int) -> str:
    dates = [game["date"] for game in games if game.get("date")]
    if not dates or days <= 0:
        return ""
    latest = max(dates)
    dt = datetime.strptime(latest, "%Y-%m-%d") - timedelta(days=days)
    return dt.strftime("%Y-%m-%d")


def print_role(role: str, payload: dict, top: int) -> None:
    weights = payload.get("weights") or {}
    players = payload.get("players") or []
    print()
    print(f"=== {role.upper()}  learned qualities (z -> win) ===")
    if not weights:
        print("  not enough data")
        return
    ranked = sorted(weights.items(), key=lambda item: abs(item[1]), reverse=True)
    for key, value in ranked:
        sign = "+" if value >= 0 else "-"
        print(f"  {key:<12} {sign}{abs(value):.3f}")
    print()
    print(f"=== {role.upper()}  rankings ===")
    if not players:
        print("  no players over the game floor")
        return
    shown = players[:top]
    width = max(len(row["name"]) for row in players)
    team_w = max(len(row["team"]) for row in players)
    def line(i, row):
        score = row["score"]
        sign = "+" if score >= 0 else ""
        return (
            f"  {i:2d}  {row['name']:<{width}}  {row.get('league','') :<3}  "
            f"{row['team']:<{team_w}}  "
            f"{sign}{score:6.2f}  {row['games']:3d}g  "
            f"WR {row['win_rate']*100:5.1f}%  "
            f"form {row['form']:+5.1f}  rel {row.get('champ_score', 0):+5.1f}  "
            f"region {row.get('region', 0):+4.2f}  "
            f"tier {row.get('tier', 0):+4.2f}"
            + (f"  idle {row['idle']:.2f}" if row.get("idle", 1) < 0.999 else "")
        )
    for i, row in enumerate(shown, start=1):
        print(line(i, row))
    if len(players) > top:
        print("   ...")
        tail = players[-min(5, len(players) - top) :]
        start = len(players) - len(tail) + 1
        for i, row in enumerate(tail, start=start):
            print(line(i, row))


def print_region(payload: dict) -> None:
    region = payload.get("region") or {}
    if not region:
        return
    events = payload.get("intl_events") or {}
    event_txt = ", ".join(
        f"{name} {count}g" for name, count in sorted(events.items(), key=lambda item: -item[1])
    ) or "none"
    print()
    print("=== region strength (avg of international teams) ===")
    print(
        f"  {payload.get('intl_series', 0)} cross-region games / "
        f"{payload.get('intl_games', 0)} mapped ({event_txt})"
        + (f", through {payload['intl_through']}" if payload.get("intl_through") else "")
        + "; each team is one vote"
    )
    region_games = payload.get("region_games") or {}
    for league, value in sorted(region.items(), key=lambda item: item[1], reverse=True):
        sign = "+" if value >= 0 else ""
        n = region_games.get(league, 0)
        print(f"  {league:<6} {sign}{value:5.2f}  ({n} teams)")
    teams = payload.get("intl_teams") or {}
    majors = ("LCK", "LPL", "LEC", "LCS")
    used = [
        item
        for item in teams.items()
        if (item[1] or {}).get("used") and item[1].get("league") in majors
    ]
    if used:
        print()
        print("=== international teams (used in region avg) ===")
        by_lg: dict[str, list] = {}
        for name, rec in used:
            by_lg.setdefault(rec["league"], []).append((name, rec))
        order = {lg: i for i, lg in enumerate(sorted(region, key=lambda k: -region[k]))}
        for league in sorted(by_lg, key=lambda lg: order.get(lg, 99)):
            print(f"  {league}")
            for name, rec in sorted(by_lg[league], key=lambda item: -item[1].get("rating", 0)):
                sign = "+" if rec.get("rating", 0) >= 0 else ""
                print(
                    f"    {name:<28} {sign}{rec.get('rating', 0):5.2f}  "
                    f"{rec.get('games', 0):3d}g"
                )
    matchups = payload.get("intl_matchups") or []
    if matchups:
        print()
        print("=== international region games ===")
        for row in matchups:
            a_wins = row["a_wins"]
            b_wins = row["b_wins"]
            n = row.get("games", row.get("series", 0))
            print(
                f"  {row['a']:<6} vs {row['b']:<6}  {n:3}g  "
                f"{row['a']} {a_wins:g}-{b_wins:g} {row['b']}"
            )


def print_tiers(payload: dict) -> None:
    stages = payload.get("tiers") or []
    if not stages:
        return
    print()
    print("=== league tiers (high = Legend/Ascend, low = Rise/Nirvana) ===")
    for stage in stages:
        high = ", ".join(stage.get("high") or [])
        low = ", ".join(stage.get("low") or [])
        print(f"  {stage['league']} {stage['split']}")
        print(f"    high {stage.get('high_games', 0):3d}g  {high}")
        print(f"    low  {stage.get('low_games', 0):3d}g  {low}")


def champ_slug(name: str) -> str:
    return "".join(ch for ch in (name or "").lower() if ch.isalnum())


def print_champ(payload: dict, champ: str, top: int) -> None:
    want = champ_slug(champ)
    if not want:
        return
    merged: dict[str, dict] = {}
    found = False
    for role, block in (payload.get("roles") or {}).items():
        for title, players in (block.get("champions") or {}).items():
            if champ_slug(title) != want:
                continue
            found = True
            print()
            print(f"=== {title}  ({role}) ===")
            for i, row in enumerate(players[:top], start=1):
                score = row["score"]
                sign = "+" if score >= 0 else ""
                print(
                    f"  {i:2d}  {row['name']:<16}  {row.get('league',''):<3}  "
                    f"{row['team']:<22}  {sign}{score:6.2f}  {row['games']:3d}g  "
                    f"WR {row['win_rate']*100:5.1f}%"
                )
            for row in players:
                key = row["name"].lower()
                prev = merged.get(key)
                if not prev or row["score"] > prev["score"]:
                    merged[key] = {**row, "role": role, "title": title}
    if not found:
        print()
        print(f"No champion ladder for {champ} (need {3}+ games)")
        return
    if len(merged) > 1:
        ranked = sorted(merged.values(), key=lambda item: item["score"], reverse=True)
        title = next(iter(ranked))["title"]
        print()
        print(f"=== {title}  world ===")
        for i, row in enumerate(ranked[:top], start=1):
            score = row["score"]
            sign = "+" if score >= 0 else ""
            print(
                f"  {i:2d}  {row['name']:<16}  {row.get('league',''):<3}  "
                f"{row['team']:<22}  {sign}{score:6.2f}  {row['games']:3d}g"
            )


def write_site_js(payload: dict, path: Path) -> None:
    compact = {
        "to": payload.get("to") or "",
        "synced": payload.get("synced") or "",
        "roles": {},
        "champs": {},
        "model": {
            "features": payload.get("features") or list(FEATURE_KEYS),
            "blend": payload.get("blend") or {},
            "prior": FORM_PRIOR,
            "shrink": SHRINK_GAMES,
            "halfLife": payload.get("half_life") or 40,
            "region": payload.get("region") or {},
            "weights": {},
        },
    }
    champs: dict[str, dict] = {}
    for role, block in (payload.get("roles") or {}).items():
        weights = block.get("weights") or {}
        compact["model"]["weights"][role] = [
            round(float(weights.get(key) or 0.0), 4) for key in (payload.get("features") or FEATURE_KEYS)
        ]
        bucket = {}
        for row in block.get("players") or []:
            name = (row.get("name") or "").strip()
            if not name:
                continue
            rec = {
                "n": name,
                "s": round(float(row.get("score") or 0.0), 2),
                "l": row.get("league") or "",
                "t": row.get("team") or "",
                "sf": round(float(row.get("form_raw") or 0.0), 4),
                "c": round(float(row.get("ctx") or 0.0), 4),
            }
            if row.get("champ_score") is not None:
                rec["cs"] = round(float(row["champ_score"]), 2)
            bucket[name.lower()] = rec
        compact["roles"][role] = bucket
        for title, players in (block.get("champions") or {}).items():
            slug = champ_slug(title)
            rec = champs.setdefault(slug, {"title": title, "players": []})
            for row in players:
                rec["players"].append(
                    {
                        "n": row["name"],
                        "s": round(float(row.get("score") or 0.0), 2),
                        "g": int(row.get("games") or 0),
                        "wr": round(float(row.get("win_rate") or 0.0), 3),
                        "l": row.get("league") or "",
                        "t": row.get("team") or "",
                        "r": role,
                    }
                )
    for rec in champs.values():
        best: dict[str, dict] = {}
        for row in rec["players"]:
            key = row["n"].lower()
            prev = best.get(key)
            if not prev or row["s"] > prev["s"]:
                best[key] = row
        ranked = sorted(best.values(), key=lambda item: item["s"], reverse=True)
        for i, row in enumerate(ranked, start=1):
            row["k"] = i
        rec["players"] = ranked
    compact["champs"] = champs
    path.write_text(
        "window.RIFT_PLAYER_RATINGS = " + json.dumps(compact, separators=(",", ":")) + ";\n",
        encoding="utf-8",
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Learn role player ratings from OE games.")
    parser.add_argument("--csv", type=Path, help="Oracle's Elixir CSV")
    parser.add_argument("--min-games", type=int, default=10, help="Minimum games in-role to rank")
    parser.add_argument(
        "--days",
        type=int,
        default=40,
        help="Recency half-life in days (0 = every game counts equally). Older games still count, just less.",
    )
    parser.add_argument("--role", choices=ROLES, help="Print a single role")
    parser.add_argument("--champ", help="Print a champion ladder (e.g. Ezreal)")
    parser.add_argument("--top", type=int, default=15, help="Players to print per role")
    parser.add_argument(
        "--out",
        type=Path,
        default=ROOT / "ratings" / "player_ratings.json",
        help="JSON output path",
    )
    args = parser.parse_args()

    csv_path = args.csv
    if csv_path:
        csv_path = resolve_csv(csv_path, ROOT / "oracles.csv")
    else:
        candidates = [path for path in (newest_local_csv(), ROOT / "oracles.csv") if path and path.exists()]
        csv_path = (
            max(candidates, key=lambda path: path.stat().st_mtime)
            if candidates
            else resolve_csv(None, ROOT / "oracles.csv")
        )
    print(f"Loading {csv_path}")
    games = load_games(csv_path)
    team_league = load_team_regions(csv_path)
    intl = load_intl_games(csv_path)
    print(f"{len(games):,} complete games")
    if args.days:
        print(f"Recency half-life {args.days} days (older games still count, just less)")
    print(f"Idle decay after {INACTIVE_GRACE_DAYS} days (half-life {INACTIVE_HALFLIFE:.0f}d)")
    last_dates = player_last_dates(csv_path)
    print(f"{len(team_league):,} clubs mapped to a home league")
    print(f"{len(intl):,} international games (not windowed)")

    payload = rate_players(
        games,
        min_games=args.min_games,
        intl_games=intl,
        team_league=team_league,
        half_life=float(args.days),
        last_dates=last_dates,
    )
    payload["source"] = str(csv_path)
    payload["games"] = len(games)
    payload["from"] = min((game["date"] for game in games if game["date"]), default="")
    payload["to"] = max((game["date"] for game in games if game["date"]), default="")
    payload["synced"] = datetime.now().isoformat(timespec="seconds")
    payload["half_life"] = float(args.days)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(f"Wrote {args.out}")
    site_js = ROOT / "player-ratings.js"
    write_site_js(payload, site_js)
    print(f"Wrote {site_js}")
    print_region(payload)
    print_tiers(payload)

    roles = [args.role] if args.role else list(ROLES)
    for role in roles:
        print_role(role, payload["roles"].get(role) or {}, args.top)
    if args.champ:
        print_champ(payload, args.champ, args.top)


if __name__ == "__main__":
    main()
