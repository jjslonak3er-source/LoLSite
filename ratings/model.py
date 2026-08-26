"""Fit role quality models and player impact, then blend into a rating."""

from __future__ import annotations

from collections import defaultdict

from datetime import datetime

from .features import FEATURE_KEYS, ROLES, describe_tiers, observations, team_league_map
from .mathutil import mean_std, ridge, zscore_columns, zeros

# Quality: how a player's in-game profile maps onto winning vs their region.
# Impact: leftover plus/minus after stripping teammates.
# Region: learned from international events (EWC, FST/FRST, Worlds, ...).
QUALITY_BLEND = 0.50
IMPACT_BLEND = 0.16
REGION_BLEND = 0.18
TIER_BLEND = 0.16
QUALITY_RIDGE = 40.0
IMPACT_RIDGE = 12.0
SHRINK_GAMES = 24.0
FORM_PRIOR = 28.0
TEAM_IMPACT_SHARE = 0.5
# LCK Legend / LPL Ascend vs LCK Rise / LPL Nirvana.
# Low-group games count less toward form, and the tier term itself
# is a hard haircut (~−5 on a fully Rise/Nirvana slate).
TIER_GAME_WEIGHT = {"high": 1.25, "low": 0.18, "open": 1.0}
TIER_SCORE = {"high": 0.18, "low": -3.15, "open": 0.0}
# After this many idle days, score starts fading. Half-life is extra idle time.
# The live ladder (z-scores and the ~0 center) still uses recently-active
# players only, so adding idle names does not reshuffle Tarzan/Viper.
INACTIVE_GRACE_DAYS = 30
INACTIVE_HALFLIFE = 30.0
ACTIVE_DAYS = 50
MIN_RECENT_GAMES = 6
CHAMP_MIN_GAMES = 3
CHAMP_PRIOR = 10.0
CHAMP_MIN_PLAYERS = 1
# Team BT at internationals is in win-rate deviation (0.10 ≈ 10pp).
# Scale into the same units as form_z so region can actually move rankings.
REGION_SCALE = 5.0
REGION_FLATTEN = 0.45
# Extra haircut after internationals: LCS/LEC still trail LCK/LPL.
REGION_ADJUST = {"LEC": -4.60, "LCS": -4.45}
TEAM_RIDGE = 6.0
TEAM_SHRINK = 4.0
TEAM_MIN_GAMES = 2.0
REGION_HALF_LIFE_DAYS = 45.0
LEAGUES = ("LCK", "LPL", "LEC", "LCS")
WORLD_LEAGUES = LEAGUES + ("LCP", "CBLOL", "VCS", "PCS")


def zscore_within_league(rows: list[dict]) -> list[list[float]]:
    groups: dict[str, list[int]] = defaultdict(list)
    for i, row in enumerate(rows):
        league = row.get("league") or ""
        tier = row.get("tier") or "open"
        key = f"{league}|{tier}" if tier in ("high", "low") else league
        groups[key].append(i)
    z: list[list[float]] = [[] for _ in rows]
    for idxs in groups.values():
        xs = [rows[i]["features"] for i in idxs]
        zx, _, _ = zscore_columns(xs)
        for j, i in enumerate(idxs):
            z[i] = zx[j]
    return z


def fit_quality(rows: list[dict]) -> dict:
    zx = zscore_within_league(rows)
    ys = [float(row["win"]) for row in rows]
    p = len(FEATURE_KEYS)
    xtx = zeros(p, p)
    xty = [0.0] * p
    for i, zrow in enumerate(zx):
        y = ys[i] - 0.5
        for a in range(p):
            xty[a] += zrow[a] * y
            za = zrow[a]
            row = xtx[a]
            for b in range(p):
                row[b] += za * zrow[b]
    coef = ridge(xtx, xty, QUALITY_RIDGE)
    preds = []
    for zrow in zx:
        preds.append(sum(zrow[j] * coef[j] for j in range(p)))
    return {
        "coef": coef,
        "z": zx,
        "pred": preds,
        "weights": {FEATURE_KEYS[i]: coef[i] for i in range(p)},
    }


def _obs_weight(date: str, latest: datetime | None, half_life: float) -> float:
    if not half_life or half_life <= 0 or not latest:
        return 1.0
    dt = _parse_date(date)
    if not dt:
        return 1.0
    days = max(0, (latest - dt).days)
    return 0.5 ** (days / half_life)


def inactivity_factor(last_date: str, latest: datetime | None) -> float:
    if not latest:
        return 1.0
    dt = _parse_date(last_date)
    if not dt:
        return 1.0
    idle = max(0, (latest - dt).days - INACTIVE_GRACE_DAYS)
    if idle <= 0:
        return 1.0
    return 0.5 ** (idle / INACTIVE_HALFLIFE)


def quality_scores(
    rows: list[dict],
    fitted: dict,
    half_life: float = 0.0,
) -> dict[str, dict]:
    latest = None
    for row in rows:
        dt = _parse_date(row.get("date") or "")
        if dt and (latest is None or dt > latest):
            latest = dt
    by_player: dict[str, dict] = {}
    for i, row in enumerate(rows):
        name = row["name"]
        rec = by_player.get(name)
        if not rec:
            rec = {
                "name": name,
                "team": row["team"],
                "league": row["league"],
                "teams": defaultdict(int),
                "leagues": defaultdict(int),
                "games": 0,
                "wins": 0,
                "weight": 0.0,
                "pred": 0.0,
                "season_weight": 0.0,
                "season_pred": 0.0,
                "recent_games": 0,
                "last_date": "",
                "tier_weight": 0.0,
                "tier_score": 0.0,
                "z_sum": [0.0] * len(FEATURE_KEYS),
            }
            by_player[name] = rec
        tier = row.get("tier") or "open"
        tier_w = TIER_GAME_WEIGHT.get(tier, 1.0)
        hot_w = _obs_weight(row.get("date") or "", latest, half_life) * tier_w
        long_life = half_life * 3.0 if half_life else 0.0
        season_w = _obs_weight(row.get("date") or "", latest, long_life) * tier_w
        rec["games"] += 1
        rec["wins"] += row["win"]
        rec["weight"] += hot_w
        rec["pred"] += hot_w * fitted["pred"][i]
        rec["season_weight"] += season_w
        rec["season_pred"] += season_w * fitted["pred"][i]
        rec["tier_weight"] += hot_w
        rec["tier_score"] += hot_w * TIER_SCORE.get(tier, 0.0)
        rec["teams"][row["team"]] += 1
        rec["leagues"][row["league"]] += 1
        rec["team"] = row["team"]
        date = row.get("date") or ""
        if date > rec["last_date"]:
            rec["last_date"] = date
        dt = _parse_date(date)
        if latest and dt and (latest - dt).days <= ACTIVE_DAYS:
            rec["recent_games"] += 1
        for j, value in enumerate(fitted["z"][i]):
            rec["z_sum"][j] += hot_w * value
    out = {}
    for name, rec in by_player.items():
        n = rec["games"]
        w = rec["weight"] or float(n)
        sw = rec["season_weight"] or float(n)
        hot = rec["pred"] / w
        season = rec["season_pred"] / sw
        form = (w * hot + FORM_PRIOR * season) / (w + FORM_PRIOR)
        shrink = n / (n + SHRINK_GAMES)
        out[name] = {
            "name": name,
            "team": max(rec["teams"], key=rec["teams"].get) if rec["teams"] else rec["team"],
            "league": max(rec["leagues"], key=rec["leagues"].get) if rec["leagues"] else rec["league"],
            "games": n,
            "wins": rec["wins"],
            "win_rate": rec["wins"] / n if n else 0.0,
            "form": shrink * form,
            "form_raw": form,
            "recent_games": rec["recent_games"],
            "last_date": rec["last_date"],
            "tier": rec["tier_score"] / rec["tier_weight"] if rec["tier_weight"] else 0.0,
            "qualities": {
                FEATURE_KEYS[j]: rec["z_sum"][j] / w for j in range(len(FEATURE_KEYS))
            },
        }
    return out


def champ_forms(
    rows: list[dict],
    fitted: dict,
    half_life: float = 0.0,
) -> dict[tuple[str, str], dict]:
    latest = None
    for row in rows:
        dt = _parse_date(row.get("date") or "")
        if dt and (latest is None or dt > latest):
            latest = dt
    by_pair: dict[tuple[str, str], dict] = {}
    for i, row in enumerate(rows):
        champ = (row.get("champ") or "").strip()
        if not champ:
            continue
        key = (row["name"], champ)
        rec = by_pair.get(key)
        if not rec:
            rec = {
                "name": row["name"],
                "champ": champ,
                "team": row["team"],
                "league": row["league"],
                "games": 0,
                "wins": 0,
                "weight": 0.0,
                "pred": 0.0,
            }
            by_pair[key] = rec
        tier = row.get("tier") or "open"
        w = _obs_weight(row.get("date") or "", latest, half_life)
        w *= TIER_GAME_WEIGHT.get(tier, 1.0)
        rec["games"] += 1
        rec["wins"] += row["win"]
        rec["weight"] += w
        rec["pred"] += w * fitted["pred"][i]
        rec["team"] = row["team"]
        rec["league"] = row["league"]
    out = {}
    for key, rec in by_pair.items():
        n = rec["games"]
        if n < CHAMP_MIN_GAMES:
            continue
        w = rec["weight"] or float(n)
        out[key] = {
            "name": rec["name"],
            "champ": rec["champ"],
            "team": rec["team"],
            "league": rec["league"],
            "games": n,
            "wins": rec["wins"],
            "win_rate": rec["wins"] / n if n else 0.0,
            "form": rec["pred"] / w,
        }
    return out


def rank_champions(
    rows: list[dict],
    fitted: dict,
    half_life: float,
    player_ctx: dict[str, dict],
) -> dict[str, list[dict]]:
    pools: dict[str, list[dict]] = defaultdict(list)
    for rec in champ_forms(rows, fitted, half_life).values():
        ctx = player_ctx.get(rec["name"])
        if not ctx:
            continue
        n = rec["games"]
        mixed = (n * rec["form"] + CHAMP_PRIOR * ctx["form"]) / (n + CHAMP_PRIOR)
        pools[rec["champ"]].append({**rec, "mixed": mixed, "ctx": ctx})
    out: dict[str, list[dict]] = {}
    for champ, recs in pools.items():
        if len(recs) < CHAMP_MIN_PLAYERS:
            continue
        form_z = z_against(
            {row["name"]: row["mixed"] for row in recs},
            {row["name"] for row in recs if row["ctx"].get("anchor")},
        )
        ranked = []
        for row in recs:
            ctx = row["ctx"]
            raw = (
                QUALITY_BLEND * form_z[row["name"]]
                + IMPACT_BLEND * ctx["impact_z"]
                + REGION_BLEND * ctx["region"]
                + TIER_BLEND * ctx["tier"]
            ) * 10.0
            if not ctx.get("anchor", True):
                raw *= ctx.get("idle", 1.0)
            ranked.append({**row, "raw": raw})
        players = []
        for row in ranked:
            players.append(
                {
                    "name": row["name"],
                    "team": row["team"],
                    "league": row["league"],
                    "games": row["games"],
                    "wins": row["wins"],
                    "win_rate": round(row["win_rate"], 4),
                    "score": round(row["raw"], 3),
                    "form": round(100.0 * row["mixed"], 3),
                }
            )
        players.sort(key=lambda item: item["score"], reverse=True)
        for i, row in enumerate(players, start=1):
            row["rank"] = i
        out[champ] = players
    return out


def attach_champ_aggregates(players: list[dict], champions: dict) -> None:
    """Games-weighted average of each player's champion-relative scores."""
    bags: dict[str, dict[str, float]] = {}
    for recs in (champions or {}).values():
        for row in recs:
            name = row.get("name") or ""
            n = float(row.get("games") or 0)
            if not name or n <= 0:
                continue
            rec = bags.setdefault(name, {"w": 0.0, "s": 0.0})
            rec["w"] += n
            rec["s"] += n * float(row.get("score") or 0.0)
    for player in players:
        rec = bags.get(player["name"])
        if not rec or rec["w"] <= 0:
            continue
        player["champ_score"] = round(rec["s"] / rec["w"], 3)


def fit_impact(games: list[dict], min_games: int, half_life: float = 0.0) -> dict[str, float]:
    counts: dict[str, int] = defaultdict(int)
    latest = None
    for game in games:
        dt = _parse_date(game.get("date") or "")
        if dt and (latest is None or dt > latest):
            latest = dt
        for side in ("blue", "red"):
            for rec in game[side].values():
                counts[rec["name"]] += 1
    names = [name for name, n in counts.items() if n >= min_games]
    index = {name: i for i, name in enumerate(names)}
    p = len(names)
    if p < 2:
        return {}
    xtx = zeros(p, p)
    xty = [0.0] * p
    for game in games:
        blue = [index[rec["name"]] for rec in game["blue"].values() if rec["name"] in index]
        red = [index[rec["name"]] for rec in game["red"].values() if rec["name"] in index]
        if len(blue) + len(red) < 4:
            continue
        w = _obs_weight(game.get("date") or "", latest, half_life)
        w *= TIER_GAME_WEIGHT.get(game.get("tier") or "open", 1.0)
        target = (1.0 if game["blue_win"] else 0.0) - 0.5
        active = [(idx, 1.0) for idx in blue] + [(idx, -1.0) for idx in red]
        for idx, sign in active:
            xty[idx] += w * sign * target
        for i, si in active:
            row = xtx[i]
            for j, sj in active:
                row[j] += w * si * sj
    coef = ridge(xtx, xty, IMPACT_RIDGE)
    return {names[i]: coef[i] for i in range(p)}


def _parse_date(value: str) -> datetime | None:
    raw = (value or "")[:10]
    if len(raw) < 10:
        return None
    try:
        return datetime.strptime(raw, "%Y-%m-%d")
    except ValueError:
        return None


def _recency_weight(date: datetime | None, latest: datetime | None) -> float:
    if not date or not latest:
        return 1.0
    days = max(0, (latest - date).days)
    return 0.5 ** (days / REGION_HALF_LIFE_DAYS)


def fit_region_strength(
    intl_games: list[dict],
    team_league: dict[str, str],
) -> dict:
    """Region skill = average of that region's international teams.

    Teams are rated against each other at FST/MSI/EWC/Worlds. Each region
    is the unweighted mean of its representatives, then gaps are flattened
    so Korea stays ahead without dominating the player ladder.
    """
    mapped = []
    events: dict[str, int] = defaultdict(int)
    team_games: dict[str, float] = defaultdict(float)
    team_raw_games: dict[str, int] = defaultdict(int)
    latest = None
    world = set(WORLD_LEAGUES)
    for game in intl_games or []:
        blue = game.get("blue_team") or ""
        red = game.get("red_team") or ""
        blue_lg = team_league.get(blue)
        red_lg = team_league.get(red)
        if not blue_lg or not red_lg:
            continue
        dt = _parse_date(game.get("date") or "")
        if dt and (latest is None or dt > latest):
            latest = dt
        mapped.append(
            (
                blue,
                red,
                blue_lg,
                red_lg,
                1.0 if game["blue_win"] else 0.0,
                dt,
            )
        )
        team_raw_games[blue] += 1
        team_raw_games[red] += 1
        events[game.get("league") or ""] += 1

    team_obs = []
    world_weight: dict[str, float] = defaultdict(float)
    matchups: dict[tuple[str, str], list[float]] = defaultdict(lambda: [0.0, 0.0, 0.0])
    for blue, red, blue_lg, red_lg, blue_win, dt in mapped:
        weight = _recency_weight(dt, latest)
        team_obs.append((blue, red, blue_win, weight))
        team_games[blue] += weight
        team_games[red] += weight
        if blue_lg != red_lg and blue_lg in world and red_lg in world:
            world_weight[blue] += weight
            world_weight[red] += weight
            lo, hi = (blue_lg, red_lg) if blue_lg < red_lg else (red_lg, blue_lg)
            row = matchups[(lo, hi)]
            row[0] += 1
            winner = blue_lg if blue_win else red_lg
            if winner == lo:
                row[1] += 1
            else:
                row[2] += 1

    def bt(pairs: list[tuple[str, str, float, float]], ridge_lambda: float) -> dict[str, float]:
        names = sorted({name for a, b, _, _ in pairs for name in (a, b)})
        if len(names) < 2:
            return {}
        index = {name: i for i, name in enumerate(names)}
        p = len(names)
        xtx = zeros(p, p)
        xty = [0.0] * p
        for a, b, a_win, weight in pairs:
            target = a_win - 0.5
            signs = [(index[a], 1.0), (index[b], -1.0)]
            for i, si in signs:
                xty[i] += weight * si * target
            for i, si in signs:
                for j, sj in signs:
                    xtx[i][j] += weight * si * sj
        coef = ridge(xtx, xty, ridge_lambda)
        mean = sum(coef) / p
        return {names[i]: coef[i] - mean for i in range(p)}

    team_rating = bt(team_obs, TEAM_RIDGE)

    buckets: dict[str, list[tuple[str, float, float]]] = defaultdict(list)
    teams_out = {}
    for name, rating in team_rating.items():
        league = team_league.get(name, "")
        w = world_weight.get(name, 0.0)
        shrink = w / (w + TEAM_SHRINK) if w else 0.0
        shrunk = shrink * rating * REGION_SCALE
        used = w >= TEAM_MIN_GAMES
        teams_out[name] = {
            "league": league,
            "rating": round(shrunk if used else rating * REGION_SCALE, 3),
            "raw": round(rating * REGION_SCALE, 3),
            "games": team_raw_games.get(name, 0),
            "world_games": round(w, 1),
            "used": used,
        }
        if used:
            buckets[league].append((name, shrunk, w))

    strength = {}
    region_n = {}
    for league, pairs in buckets.items():
        strength[league] = sum(val for _, val, _ in pairs) / len(pairs)
        region_n[league] = len(pairs)

    majors = [strength.get(league, 0.0) for league in LEAGUES]
    major_mean = sum(majors) / len(majors) if majors else 0.0
    for league in list(strength):
        strength[league] = (strength[league] - major_mean) * REGION_FLATTEN
        strength[league] += REGION_ADJUST.get(league, 0.0)
    for rec in teams_out.values():
        if rec["used"]:
            rec["rating"] = round((rec["rating"] - major_mean) * REGION_FLATTEN, 3)

    matchup_rows = []
    for (a, b), (n, a_wins, b_wins) in sorted(matchups.items(), key=lambda item: -item[1][0]):
        matchup_rows.append(
            {
                "a": a,
                "b": b,
                "games": int(n),
                "a_wins": int(a_wins),
                "b_wins": int(b_wins),
            }
        )

    return {
        "strength": strength,
        "region_games": region_n,
        "teams": teams_out,
        "games": len(mapped),
        "series": int(sum(row[0] for row in matchups.values())),
        "events": dict(events),
        "matchups": matchup_rows,
        "through": latest.strftime("%Y-%m-%d") if latest else "",
    }


def grouped_z(values: dict[str, float], groups: dict[str, str]) -> dict[str, float]:
    buckets: dict[str, list[float]] = defaultdict(list)
    for name, value in values.items():
        buckets[groups.get(name, "")].append(value)
    stats = {group: mean_std(vals) for group, vals in buckets.items() if len(vals) >= 4}
    global_mean, global_std = mean_std(list(values.values()))
    out = {}
    for name, value in values.items():
        mean, std = stats.get(groups.get(name, ""), (global_mean, global_std))
        out[name] = (value - mean) / std
    return out


def low_division_teams(games: list[dict]) -> set[str]:
    """Teams whose most recent LCK/LPL group stage was Rise / Nirvana."""
    last: dict[str, tuple[str, str]] = {}
    for game in games or []:
        tier = game.get("tier") or "open"
        if tier not in ("high", "low"):
            continue
        date = game.get("date") or ""
        for team in (game.get("blue_team"), game.get("red_team")):
            if not team:
                continue
            prev = last.get(team)
            if not prev or date >= prev[0]:
                last[team] = (date, tier)
    return {team for team, rec in last.items() if rec[1] == "low"}


def z_against(values: dict[str, float], anchor: set[str]) -> dict[str, float]:
    ref = [values[name] for name in anchor if name in values]
    if len(ref) < 2:
        ref = list(values.values())
    mean, std = mean_std(ref)
    return {name: (value - mean) / std for name, value in values.items()}


def blend_role(
    rows: list[dict],
    impact: dict[str, float],
    min_games: int,
    region: dict[str, float],
    half_life: float = 0.0,
    last_dates: dict[str, str] | None = None,
    latest: datetime | None = None,
    low_teams: set[str] | None = None,
) -> dict:
    if len(rows) < 40:
        return {"weights": {}, "players": [], "champions": {}}
    fitted = fit_quality(rows)
    quality = quality_scores(rows, fitted, half_life=half_life)
    eligible = {
        name: rec
        for name, rec in quality.items()
        if rec["games"] >= min_games
    }
    if not eligible:
        return {"weights": fitted["weights"], "players": [], "champions": {}}
    for name, rec in eligible.items():
        extra = (last_dates or {}).get(name) or ""
        if extra > (rec.get("last_date") or ""):
            rec["last_date"] = extra
        rec["idle"] = inactivity_factor(rec.get("last_date") or "", latest)
        rec["anchor"] = rec["recent_games"] >= MIN_RECENT_GAMES
    anchor = {name for name, rec in eligible.items() if rec["anchor"]}
    if not anchor:
        anchor = set(eligible)
        for rec in eligible.values():
            rec["anchor"] = True

    # Features are already league-relative. Do not z-score form inside
    # each league again — that turns a 15-game LEC heater into "Chovy".
    # Idle players are scored on this same scale, then decayed.
    form_z = z_against({name: rec["form"] for name, rec in eligible.items()}, anchor)
    team_means: dict[str, list[float]] = defaultdict(list)
    for name, rec in eligible.items():
        if name not in anchor:
            continue
        team_means[rec["team"]].append(impact.get(name, 0.0))
    team_avg = {
        team: sum(vals) / len(vals) for team, vals in team_means.items() if vals
    }
    mixed_impact = {
        name: impact.get(name, 0.0)
        - TEAM_IMPACT_SHARE * team_avg.get(rec["team"], 0.0)
        for name, rec in eligible.items()
    }
    impact_z = z_against(mixed_impact, anchor)

    raw = []
    for name, rec in eligible.items():
        rec["impact"] = impact.get(name, 0.0)
        rec["region"] = region.get(rec["league"], 0.0)
        rec["tier_term"] = rec.get("tier", 0.0)
        if low_teams and rec["team"] in low_teams:
            rec["tier_term"] = min(rec["tier_term"], TIER_SCORE["low"])
        rec["raw"] = (
            QUALITY_BLEND * form_z[name]
            + IMPACT_BLEND * impact_z[name]
            + REGION_BLEND * rec["region"]
            + TIER_BLEND * rec["tier_term"]
        ) * 10.0
        if not rec["anchor"]:
            rec["raw"] *= rec["idle"]
        else:
            rec["idle"] = 1.0
        raw.append(rec)

    players = []
    for rec in raw:
        score = rec["raw"]
        players.append(
            {
                "name": rec["name"],
                "team": rec["team"],
                "league": rec["league"],
                "games": rec["games"],
                "wins": rec["wins"],
                "win_rate": round(rec["win_rate"], 4),
                "score": round(score, 3),
                "form": round(100.0 * rec["form"], 3),
                "impact": round(100.0 * rec["impact"], 3),
                "recent_games": rec.get("recent_games", rec["games"]),
                "last_date": rec.get("last_date", ""),
                "region": round(rec["region"], 3),
                "tier": round(rec.get("tier_term", rec.get("tier", 0.0)), 3),
                "idle": round(rec.get("idle", 1.0), 3),
                "form_raw": round(float(rec.get("form_raw", rec["form"])), 4),
                "ctx": round(
                    IMPACT_BLEND * impact_z[rec["name"]]
                    + REGION_BLEND * rec["region"]
                    + TIER_BLEND * rec.get("tier_term", 0.0),
                    4,
                ),
                "qualities": {key: round(val, 3) for key, val in rec["qualities"].items()},
            }
        )
    players.sort(key=lambda item: item["score"], reverse=True)
    player_ctx = {
        rec["name"]: {
            "form": rec.get("form_raw", rec["form"]),
            "impact_z": impact_z[rec["name"]],
            "region": rec["region"],
            "tier": rec["tier_term"],
            "idle": rec["idle"],
            "anchor": rec["anchor"],
        }
        for rec in raw
    }
    champions = rank_champions(rows, fitted, half_life, player_ctx)
    attach_champ_aggregates(players, champions)
    return {
        "weights": {key: round(val, 4) for key, val in fitted["weights"].items()},
        "players": players,
        "champions": champions,
    }


def rate_players(
    games: list[dict],
    min_games: int = 8,
    intl_games: list[dict] | None = None,
    team_league: dict[str, str] | None = None,
    half_life: float = 0.0,
    last_dates: dict[str, str] | None = None,
) -> dict:
    impact = fit_impact(
        games,
        min_games=max(4, min_games // 2),
        half_life=half_life,
    )
    mapped = team_league or team_league_map(games)
    fitted_region = fit_region_strength(intl_games or [], mapped)
    region = fitted_region["strength"]
    latest = None
    for game in games:
        dt = _parse_date(game.get("date") or "")
        if dt and (latest is None or dt > latest):
            latest = dt
    if last_dates:
        for value in last_dates.values():
            dt = _parse_date(value)
            if dt and (latest is None or dt > latest):
                latest = dt
    low_teams = low_division_teams(games)
    roles = {}
    for role in ROLES:
        roles[role] = blend_role(
            observations(games, role),
            impact,
            min_games,
            region,
            half_life=half_life,
            last_dates=last_dates,
            latest=latest,
            low_teams=low_teams,
        )
    return {
        "min_games": min_games,
        "blend": {
            "form": QUALITY_BLEND,
            "impact": IMPACT_BLEND,
            "region": REGION_BLEND,
            "tier": TIER_BLEND,
        },
        "tiers": describe_tiers(games),
        "region": {key: round(val, 3) for key, val in sorted(region.items(), key=lambda item: -item[1])},
        "region_games": fitted_region.get("region_games") or {},
        "intl_games": fitted_region.get("games") or 0,
        "intl_series": fitted_region.get("series") or 0,
        "intl_through": fitted_region.get("through") or "",
        "intl_events": fitted_region.get("events") or {},
        "intl_matchups": fitted_region.get("matchups") or [],
        "intl_teams": fitted_region.get("teams") or {},
        "features": list(FEATURE_KEYS),
        "roles": roles,
    }
