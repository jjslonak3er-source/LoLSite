"""Load Oracle's Elixir rows into per-game, per-role player observations."""

from __future__ import annotations

import csv
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from sync_oracles import MAJOR_LEAGUES, POS  # noqa: E402

ROLES = ("top", "jng", "mid", "adc", "sup")

# Oracle's Elixir puts international events in `league`. Spellings vary by year.
INTL_CODES = {
    "EWC",
    "FST",
    "FRST",
    "FIRSTSTAND",
    "WLDS",
    "WRLDS",
    "WORLDS",
    "WCS",
    "MSI",
    "IWCS",
}

# Region ratings use the same international events (including EWC).
REGION_EVENT_CODES = INTL_CODES

# Early diffs + rate stats. Box-score KDA is omitted on purpose: it mostly
# restates the result. These are the "qualities" the model is allowed to learn.
FEATURE_KEYS = (
    "gd10",
    "gd15",
    "xd15",
    "cd15",
    "dpm",
    "cspm",
    "vspm",
    "deaths_pm",
    "dpm_vs",
)
# Top-only extras. Other roles still omit KDA; tops need soak and involvement.
TOP_EXTRA_FEATURES = ("kp", "dt_share_gpm", "dt_share_kp")


def fnum(row: dict, key: str) -> float | None:
    raw = row.get(key)
    if raw is None or str(raw).strip() == "":
        return None
    try:
        return float(raw)
    except ValueError:
        return None


def role_feature_keys(role: str) -> tuple[str, ...]:
    if role == "top":
        return FEATURE_KEYS + TOP_EXTRA_FEATURES
    return FEATURE_KEYS


def player_key(name: str) -> str:
    return (name or "").strip()


def team_key(name: str) -> str:
    return " ".join((name or "").split())


def is_international(league: str) -> bool:
    lg = (league or "").strip().upper().replace(" ", "").replace("-", "")
    if lg in INTL_CODES:
        return True
    return any(lg.startswith(code) or lg.endswith(code) for code in INTL_CODES)


def is_region_event(league: str) -> bool:
    lg = (league or "").strip().upper().replace(" ", "").replace("-", "")
    if lg in REGION_EVENT_CODES:
        return True
    return any(lg.startswith(code) or lg.endswith(code) for code in REGION_EVENT_CODES)


def extract_rates(row: dict) -> dict[str, float] | None:
    gl = fnum(row, "gamelength")
    if not gl or gl < 600:
        return None
    minutes = gl / 60.0
    kills = fnum(row, "kills") or 0.0
    deaths = fnum(row, "deaths") or 0.0
    assists = fnum(row, "assists") or 0.0
    dpm = fnum(row, "dpm")
    cspm = fnum(row, "cspm")
    vspm = fnum(row, "vspm")
    dtpm = fnum(row, "damagetakenperminute")
    gold = fnum(row, "totalgold")
    gd10 = fnum(row, "golddiffat10")
    gd15 = fnum(row, "golddiffat15")
    xd15 = fnum(row, "xpdiffat15")
    cd15 = fnum(row, "csdiffat15")
    needed = (dpm, cspm, vspm)
    if any(value is None for value in needed):
        return None
    return {
        "gd10": gd10 if gd10 is not None else 0.0,
        "gd15": gd15 or 0.0,
        "xd15": xd15 if xd15 is not None else 0.0,
        "cd15": cd15 if cd15 is not None else 0.0,
        "dpm": dpm or 0.0,
        "cspm": cspm or 0.0,
        "vspm": vspm or 0.0,
        "deaths_pm": deaths / minutes,
        "dpm_vs": 0.0,
        "dtpm": dtpm or 0.0,
        "gpm": (gold or 0.0) / minutes,
        "kills": kills,
        "deaths": deaths,
        "assists": assists,
        "minutes": minutes,
    }


def load_games(csv_path: Path, leagues: tuple[str, ...] = MAJOR_LEAGUES) -> list[dict]:
    allowed = {name.upper() for name in leagues}
    by_game: dict[str, dict] = {}

    with csv_path.open(encoding="utf-8-sig", newline="") as handle:
        for row in csv.DictReader(handle):
            league = (row.get("league") or "").strip().upper()
            if league not in allowed:
                continue
            pos = POS.get((row.get("position") or "").strip().lower())
            if not pos:
                continue
            gid = (row.get("gameid") or "").strip()
            side = (row.get("side") or "").strip()
            name = player_key(row.get("playername") or "")
            if not gid or side not in ("Blue", "Red") or not name:
                continue
            rates = extract_rates(row)
            if not rates:
                continue
            try:
                won = int(float(row.get("result") or 0))
            except ValueError:
                continue
            game = by_game.setdefault(
                gid,
                {
                    "id": gid,
                    "league": league,
                    "split": (row.get("split") or "").strip(),
                    "playoffs": (row.get("playoffs") or "").strip() or "0",
                    "date": (row.get("date") or "")[:10],
                    "patch": (row.get("patch") or "").strip(),
                    "length": rates["minutes"],
                    "blue": {},
                    "red": {},
                    "blue_win": None,
                    "tier": "open",
                },
            )
            rec = {
                "name": name,
                "team": team_key(row.get("teamname") or ""),
                "champ": (row.get("champion") or "").strip(),
                "role": pos,
                "win": 1 if won else 0,
                "league": league,
                **rates,
            }
            game[side.lower()][pos] = rec
            if side == "Blue":
                game["blue_win"] = 1 if won else 0
                game["blue_team"] = rec["team"]
            else:
                game["red_team"] = rec["team"]

    games = []
    for game in by_game.values():
        if game["blue_win"] is None:
            continue
        if any(role not in game["blue"] or role not in game["red"] for role in ROLES):
            continue
        for role in ROLES:
            blue = game["blue"][role]
            red = game["red"][role]
            blue["dpm_vs"] = blue["dpm"] - red["dpm"]
            red["dpm_vs"] = red["dpm"] - blue["dpm"]
        games.append(game)
    games.sort(key=lambda item: item["date"], reverse=True)
    tag_game_tiers(games)
    return games


def _connected_teams(pairs: list[tuple[str, str]]) -> list[list[str]]:
    opp: dict[str, set[str]] = defaultdict(set)
    for a, b in pairs:
        if not a or not b:
            continue
        opp[a].add(b)
        opp[b].add(a)
    seen: set[str] = set()
    comps: list[list[str]] = []
    for team in opp:
        if team in seen:
            continue
        stack = [team]
        seen.add(team)
        comp = []
        while stack:
            node = stack.pop()
            comp.append(node)
            for other in opp[node]:
                if other not in seen:
                    seen.add(other)
                    stack.append(other)
        comps.append(comp)
    return comps


def tag_game_tiers(games: list[dict]) -> list[dict]:
    """Mark LCK/LPL two-group stages as high vs low (Legend/Ascend vs Rise/Nirvana)."""
    for game in games:
        game["tier"] = "open"
    by_stage: dict[tuple[str, str, str], list[dict]] = defaultdict(list)
    for game in games:
        league = game.get("league") or ""
        if league not in ("LPL", "LCK"):
            continue
        key = (league, game.get("split") or "", game.get("playoffs") or "0")
        by_stage[key].append(game)

    summary = []
    for (league, split, playoffs), stage_games in by_stage.items():
        if playoffs not in ("", "0"):
            continue
        pairs = [
            (game.get("blue_team") or "", game.get("red_team") or "")
            for game in stage_games
        ]
        comps = _connected_teams(pairs)
        if len(comps) != 2 or min(len(comp) for comp in comps) < 4:
            continue
        start = min(game["date"] for game in stage_games if game.get("date"))
        prior: dict[str, list[int]] = defaultdict(lambda: [0, 0])
        for game in games:
            if game.get("league") != league or (game.get("date") or "") >= start:
                continue
            winner = game.get("blue_team") if game.get("blue_win") else game.get("red_team")
            loser = game.get("red_team") if game.get("blue_win") else game.get("blue_team")
            if winner:
                prior[winner][0] += 1
                prior[winner][1] += 1
            if loser:
                prior[loser][1] += 1

        def comp_score(comp: list[str]) -> float:
            rates = []
            for team in comp:
                wins, n = prior.get(team, [0, 0])
                rates.append(wins / n if n else 0.5)
            return sum(rates) / len(rates) if rates else 0.0

        if len(comps[0]) != len(comps[1]):
            high, low = (comps[0], comps[1]) if len(comps[0]) > len(comps[1]) else (comps[1], comps[0])
        else:
            high, low = comps if comp_score(comps[0]) >= comp_score(comps[1]) else (comps[1], comps[0])
        high_set, low_set = set(high), set(low)
        high_n = low_n = 0
        for game in stage_games:
            teams = {game.get("blue_team"), game.get("red_team")}
            if teams <= high_set:
                game["tier"] = "high"
                high_n += 1
            elif teams <= low_set:
                game["tier"] = "low"
                low_n += 1
        summary.append(
            {
                "league": league,
                "split": split,
                "high": sorted(high_set),
                "low": sorted(low_set),
                "high_games": high_n,
                "low_games": low_n,
            }
        )
    return summary


def describe_tiers(games: list[dict]) -> list[dict]:
    stages: dict[tuple[str, str], dict] = {}
    for game in games:
        tier = game.get("tier") or "open"
        if tier not in ("high", "low"):
            continue
        key = (game.get("league") or "", game.get("split") or "")
        rec = stages.setdefault(
            key,
            {"league": key[0], "split": key[1], "high": set(), "low": set(), "high_games": 0, "low_games": 0},
        )
        teams = {game.get("blue_team"), game.get("red_team")}
        rec[tier] |= {team for team in teams if team}
        rec[f"{tier}_games"] += 1
    out = []
    for rec in stages.values():
        out.append(
            {
                "league": rec["league"],
                "split": rec["split"],
                "high": sorted(rec["high"]),
                "low": sorted(rec["low"]),
                "high_games": rec["high_games"],
                "low_games": rec["low_games"],
            }
        )
    out.sort(key=lambda item: (item["league"], item["split"]))
    return out


def team_league_map(games: list[dict]) -> dict[str, str]:
    counts: dict[str, dict[str, int]] = {}
    for game in games:
        for side in ("blue", "red"):
            rec = game[side].get("top") or next(iter(game[side].values()), None)
            if not rec:
                continue
            team = rec["team"]
            league = rec.get("league") or game.get("league") or ""
            if not team or not league:
                continue
            bucket = counts.setdefault(team, {})
            bucket[league] = bucket.get(league, 0) + 1
    out = {}
    for team, bucket in counts.items():
        out[team] = max(bucket, key=bucket.get)
    return out


def load_team_regions(csv_path: Path) -> dict[str, str]:
    """Map each club to its home league from domestic (non-international) games."""
    counts: dict[str, dict[str, int]] = {}
    with csv_path.open(encoding="utf-8-sig", newline="") as handle:
        for row in csv.DictReader(handle):
            league = (row.get("league") or "").strip().upper()
            if not league or is_international(league):
                continue
            pos = POS.get((row.get("position") or "").strip().lower())
            if not pos:
                continue
            team = team_key(row.get("teamname") or "")
            if not team:
                continue
            bucket = counts.setdefault(team, {})
            bucket[league] = bucket.get(league, 0) + 1
    return {
        team: max(bucket, key=bucket.get)
        for team, bucket in counts.items()
        if bucket
    }


def player_last_dates(csv_path: Path) -> dict[str, str]:
    """Last appearance in OE for any role row, including internationals and partials."""
    out: dict[str, str] = {}
    with csv_path.open(encoding="utf-8-sig", newline="") as handle:
        for row in csv.DictReader(handle):
            if not POS.get((row.get("position") or "").strip().lower()):
                continue
            name = player_key(row.get("playername") or "")
            if not name:
                continue
            date = (row.get("date") or "")[:10]
            if date > out.get(name, ""):
                out[name] = date
    return out


def load_intl_games(csv_path: Path) -> list[dict]:
    """Load complete international games; `league` is the event code (EWC, FST, ...)."""
    by_game: dict[str, dict] = {}
    with csv_path.open(encoding="utf-8-sig", newline="") as handle:
        for row in csv.DictReader(handle):
            league = (row.get("league") or "").strip().upper()
            if not is_international(league):
                continue
            pos = POS.get((row.get("position") or "").strip().lower())
            if not pos:
                continue
            gid = (row.get("gameid") or "").strip()
            side = (row.get("side") or "").strip()
            team = team_key(row.get("teamname") or "")
            if not gid or side not in ("Blue", "Red") or not team:
                continue
            try:
                won = int(float(row.get("result") or 0))
            except ValueError:
                continue
            game = by_game.setdefault(
                gid,
                {
                    "id": gid,
                    "league": league,
                    "date": (row.get("date") or "")[:10],
                    "blue_team": "",
                    "red_team": "",
                    "blue_win": None,
                    "roles": {"blue": set(), "red": set()},
                },
            )
            game["roles"][side.lower()].add(pos)
            if side == "Blue":
                game["blue_team"] = team
                game["blue_win"] = 1 if won else 0
            else:
                game["red_team"] = team
    games = []
    for game in by_game.values():
        if game["blue_win"] is None or not game["blue_team"] or not game["red_team"]:
            continue
        if any(role not in game["roles"]["blue"] or role not in game["roles"]["red"] for role in ROLES):
            continue
        games.append(
            {
                "id": game["id"],
                "league": game["league"],
                "date": game["date"],
                "blue_team": game["blue_team"],
                "red_team": game["red_team"],
                "blue_win": game["blue_win"],
            }
        )
    games.sort(key=lambda item: item["date"], reverse=True)
    return games


TILT_ROLES = ("jng", "mid", "adc")


def side_kill_participation(side_recs: dict, role: str) -> float:
    team_kills = 0.0
    for key in ROLES:
        rec = side_recs.get(key) or {}
        team_kills += float(rec.get("kills") or 0.0)
    rec = side_recs.get(role) or {}
    if team_kills <= 0:
        return 0.0
    return (float(rec.get("kills") or 0.0) + float(rec.get("assists") or 0.0)) / team_kills


def side_dt_share(side_recs: dict, role: str) -> float:
    total = 0.0
    for key in ROLES:
        rec = side_recs.get(key) or {}
        total += float(rec.get("dtpm") or 0.0)
    rec = side_recs.get(role) or {}
    if total <= 0:
        return 0.0
    return float(rec.get("dtpm") or 0.0) / total


def map_tilt(side_recs: dict, role: str) -> float:
    """How much richer the rest of the map is than top. Positive = dump lane."""
    if role != "top":
        return 0.0
    top = side_recs.get("top") or {}
    top_gd = float(top.get("gd15") or 0.0)
    vals = []
    for key in TILT_ROLES:
        rec = side_recs.get(key)
        if not rec:
            continue
        vals.append(float(rec.get("gd15") or 0.0))
    if not vals:
        return 0.0
    return sum(vals) / len(vals) - top_gd


def observations(games: list[dict], role: str) -> list[dict]:
    rows = []
    for game in games:
        for side, opp in (("blue", "red"), ("red", "blue")):
            rec = game[side][role]
            rec = dict(rec)
            rec["game"] = game["id"]
            rec["date"] = game["date"]
            rec["league"] = game["league"]
            rec["tier"] = game.get("tier") or "open"
            rec["split"] = game.get("split") or ""
            rec["side"] = side
            rec["opp"] = game[opp][role]["name"]
            rec["opp_team"] = game["red_team"] if side == "blue" else game["blue_team"]
            rec["opp_roster"] = [
                ((game.get(opp) or {}).get(key) or {}).get("name") or ""
                for key in ROLES
            ]
            rec["win"] = rec["win"]
            rec["tilt"] = map_tilt(game[side], role)
            rec["kp"] = side_kill_participation(game[side], role)
            dt_share = side_dt_share(game[side], role)
            rec["dt_share_gpm"] = dt_share / max(float(rec.get("gpm") or 0.0), 1.0)
            rec["dt_share_kp"] = dt_share / max(rec["kp"], 0.05)
            rec["features"] = [rec[key] for key in role_feature_keys(role)]
            rows.append(rec)
    return rows
