const DDRAGON = "https://ddragon.leagueoflegends.com";
const TAGS = ["All", "Assassin", "Fighter", "Mage", "Marksman", "Support", "Tank"];
const ROLES = ["TOP", "JNG", "MID", "ADC", "SUP"];
const ROLE_KEYS = ["top", "jng", "mid", "adc", "sup"];
const ROLE_FILTERS = ["All"].concat(ROLES);
const POWER_PRIOR_GAMES = 4000;
const SHARP_COUNTER_DELTA = -2;
const WEIGHT_DEFAULTS = { wr: 1, pop: 1, safety: 1, counter: 1, pairing: 1, unique: 1 };
const WEIGHT_STORAGE = "riftDraft.weights.v2";
const PAIR_PRIOR_GAMES = 400;
const UNIQUE_ROLE_SCALE = 8;
const ROLE_FILL_LOCK = 0.75;
const POPULARITY_SCALE = 4.7;
const ELO_SCALE = 400;
const ELO_MULT = 10;

const els = {
  boot: document.getElementById("boot"),
  bootStatus: document.getElementById("boot-status"),
  app: document.getElementById("app"),
  splash: document.getElementById("splash"),
  fearless: document.getElementById("fearless-toggle"),
  series: document.getElementById("series-select"),
  gameLabel: document.getElementById("game-label"),
  blueName: document.getElementById("blue-name"),
  redName: document.getElementById("red-name"),
  blueBans: document.getElementById("blue-bans"),
  redBans: document.getElementById("red-bans"),
  bluePicks: document.getElementById("blue-picks"),
  redPicks: document.getElementById("red-picks"),
  search: document.getElementById("search"),
  tags: document.getElementById("tag-filters"),
  grid: document.getElementById("grid"),
  undo: document.getElementById("undo-btn"),
  reset: document.getElementById("reset-btn"),
  next: document.getElementById("next-btn"),
  swap: document.getElementById("swap-btn"),
  usedBar: document.getElementById("used-bar"),
  usedChamps: document.getElementById("used-champs"),
  expectBlueName: document.getElementById("expect-blue-name"),
  expectRedName: document.getElementById("expect-red-name"),
  expectBluePct: document.getElementById("expect-blue-pct"),
  expectRedPct: document.getElementById("expect-red-pct"),
  expectFill: document.getElementById("expect-fill"),
  expectMeter: document.getElementById("expect-meter"),
  expectSub: document.getElementById("expect-sub"),
  toast: document.getElementById("toast"),
  recs: document.getElementById("recs"),
  recsList: document.getElementById("recs-list"),
  recsLabel: document.getElementById("recs-label"),
  recsBlue: document.getElementById("recs-blue"),
  recsRed: document.getElementById("recs-red"),
  recsRoles: document.getElementById("recs-roles"),
  recsWeights: document.getElementById("recs-weights"),
  wWr: document.getElementById("w-wr"),
  wPop: document.getElementById("w-pop"),
  wSafety: document.getElementById("w-safety"),
  wCounter: document.getElementById("w-counter"),
  wPairing: document.getElementById("w-pairing"),
  wUnique: document.getElementById("w-unique"),
  wWrVal: document.getElementById("w-wr-val"),
  wPopVal: document.getElementById("w-pop-val"),
  wSafetyVal: document.getElementById("w-safety-val"),
  wCounterVal: document.getElementById("w-counter-val"),
  wPairingVal: document.getElementById("w-pairing-val"),
  wUniqueVal: document.getElementById("w-unique-val"),
};

let patch = "";
let champions = [];
let champMap = new Map();
let history = [];
let search = "";
let tag = "All";
let drag = null;
let recSide = "blue";
let recRole = "All";
let weights = Object.assign({}, WEIGHT_DEFAULTS);
let counters = {};
let synergies = {};
let champGames = {};
let oracles = { matchups: {}, positions: {}, games: 0 };
let roleRates = {};
let winrates = { lanes: {} };
let oePop = {};

let state = emptyState();

function emptyTeam(name) {
  return {
    name,
    bans: Array(5).fill(null),
    picks: Array(5).fill(null),
    roles: Array(5).fill(null),
  };
}

function emptyState() {
  return {
    fearless: false,
    seriesLength: 1,
    gameIndex: 0,
    usedPicks: [],
    blue: emptyTeam("Blue Side"),
    red: emptyTeam("Red Side"),
  };
}

function portrait(id) {
  return DDRAGON + "/cdn/" + patch + "/img/champion/" + id + ".png";
}

function splash(id) {
  return DDRAGON + "/cdn/img/champion/splash/" + id + "_0.jpg";
}

function loadingArt(id) {
  return DDRAGON + "/cdn/img/champion/loading/" + id + "_0.jpg";
}

function champName(id) {
  return (champMap.get(id) && champMap.get(id).name) || id;
}

function formatDelta(value) {
  const abs = Math.abs(value).toFixed(1);
  if (value > 0) return "+" + abs;
  if (value < 0) return "-" + abs;
  return "0.0";
}

function rebuildChampGames() {
  champGames = {};
  const ids = Object.keys(counters);
  for (let i = 0; i < ids.length; i += 1) {
    const us = ids[i];
    const vs = counters[us];
    let total = 0;
    const opp = Object.keys(vs);
    for (let j = 0; j < opp.length; j += 1) {
      const entry = vs[opp[j]];
      if (entry && typeof entry.games === "number") total += entry.games;
    }
    champGames[us] = total;
  }
}

function rebuildRoleRates() {
  roleRates = {};
  const positions = oracles.positions || {};
  const ids = Object.keys(positions);
  for (let i = 0; i < ids.length; i += 1) {
    const counts = positions[ids[i]] || {};
    let total = 0;
    for (let j = 0; j < ROLE_KEYS.length; j += 1) total += counts[ROLE_KEYS[j]] || 0;
    if (!total) continue;
    const rates = {};
    let primary = ROLE_KEYS[0];
    let best = -1;
    for (let j = 0; j < ROLE_KEYS.length; j += 1) {
      const key = ROLE_KEYS[j];
      const rate = (counts[key] || 0) / total;
      rates[key] = rate;
      if (rate > best) {
        best = rate;
        primary = key;
      }
    }
    roleRates[ids[i]] = { rates: rates, total: total, primary: primary };
  }
}

function roleLabel(key) {
  return key ? key.toUpperCase() : "";
}

function pickPrimaryRole(id) {
  const info = roleRates[id];
  if (info && info.primary) return info.primary;
  return primaryWinrateRole(id) || "";
}

function inferredSlotRole(id) {
  const primary = pickPrimaryRole(id);
  return primary ? primary.toUpperCase() : null;
}

function champFitsRole(id, role) {
  if (!role || role === "All") return true;
  const key = role.toLowerCase();
  const info = roleRates[id];
  if (info && (info.primary === key || info.rates[key] >= 0.1)) return true;
  const entry = winrateEntry(id, key);
  if (entry && ((entry.lane_pct || 0) >= 10 || primaryWinrateRole(id) === key)) return true;
  return false;
}

function winrateEntry(id, role) {
  const lane = winrates.lanes && winrates.lanes[role];
  if (!lane || !lane.champs) return null;
  return lane.champs[id] || null;
}

function primaryWinrateRole(id) {
  let best = "";
  let bestGames = -1;
  for (let i = 0; i < ROLE_KEYS.length; i += 1) {
    const role = ROLE_KEYS[i];
    const entry = winrateEntry(id, role);
    const games = entry && entry.games ? entry.games : 0;
    if (games > bestGames) {
      bestGames = games;
      best = role;
    }
  }
  return best;
}

function powerRoleFor(id) {
  if (recRole !== "All") return recRole.toLowerCase();
  const info = roleRates[id];
  if (info && info.primary) return info.primary;
  return primaryWinrateRole(id) || "mid";
}

function champPower(id) {
  const role = powerRoleFor(id);
  const lane = winrates.lanes && winrates.lanes[role];
  const entry = winrateEntry(id, role);
  if (!lane || !entry || typeof entry.wr !== "number") return null;
  const avg = typeof lane.avg_wr === "number" ? lane.avg_wr : 50;
  const games = entry.games || 0;
  const conf = games / (games + POWER_PRIOR_GAMES);
  const raw = entry.wr - avg;
  return {
    role: role,
    wr: entry.wr,
    games: games,
    avg: avg,
    lanePct: entry.lane_pct || 0,
    raw: raw,
    conf: conf,
    power: raw * conf,
  };
}

function oePickSource() {
  if (oracles.recent && oracles.recent.picks) return oracles.recent.picks;
  return oracles.positions || {};
}

function oePicks(id, role) {
  const row = oePickSource()[id];
  return (row && row[role]) || 0;
}

function oeRoleGames(role) {
  const totals = oracles.recent && oracles.recent.role_games;
  if (totals && totals[role]) return totals[role];
  const picks = oePickSource();
  const ids = Object.keys(picks);
  let total = 0;
  for (let i = 0; i < ids.length; i += 1) total += picks[ids[i]][role] || 0;
  return total;
}

function rebuildOePop() {
  oePop = {};
  const picks = oePickSource();
  const ids = Object.keys(picks);
  for (let i = 0; i < ROLE_KEYS.length; i += 1) {
    const role = ROLE_KEYS[i];
    const counts = [];
    for (let j = 0; j < ids.length; j += 1) {
      const n = picks[ids[j]][role] || 0;
      if (n) counts.push(n);
    }
    counts.sort(function (a, b) {
      return a - b;
    });
    const median = counts.length ? counts[Math.floor(counts.length / 2)] : 20;
    oePop[role] = { median: median, prior: Math.max(8, median) };
  }
}

function blindPick(id, power) {
  if (!power) return null;
  const role = power.role;
  const picks = oePicks(id, role);
  const roleGames = oeRoleGames(role);
  const popInfo = oePop[role] || { prior: 20 };
  const popularity = POPULARITY_SCALE * (picks / (picks + popInfo.prior));
  const flex = blindSafety(id, role);
  return {
    popularity: popularity,
    safety: flex.safety,
    meanDelta: flex.mean,
    sharpShare: flex.sharpShare,
    picks: picks,
    pickRate: roleGames ? picks / roleGames : 0,
    score:
      weights.wr * power.power +
      weights.pop * popularity +
      weights.safety * flex.safety,
  };
}

function blindSafety(id, role) {
  const vs = counters[id];
  if (!vs) return { mean: 0, sharpShare: 0, safety: 0 };
  const oppIds = Object.keys(vs);
  let deltaSum = 0;
  let weightSum = 0;
  let sharpWeight = 0;
  for (let i = 0; i < oppIds.length; i += 1) {
    const them = oppIds[i];
    if (them === id) continue;
    const threat = winrateEntry(them, role);
    if (!threat || (threat.lane_pct || 0) < 8) continue;
    const delta = matchupDelta(id, them);
    if (delta == null) continue;
    const weight = threat.games || 0;
    if (weight <= 0) continue;
    deltaSum += delta * weight;
    weightSum += weight;
    if (delta <= SHARP_COUNTER_DELTA) sharpWeight += weight;
  }
  if (!weightSum) return { mean: 0, sharpShare: 0, safety: 0 };
  const mean = deltaSum / weightSum;
  const sharpShare = sharpWeight / weightSum;
  return {
    mean: mean,
    sharpShare: sharpShare,
    safety: mean - 2.2 * sharpShare,
  };
}

function positionOverlap(us, them) {
  const a = roleRates[us];
  const b = roleRates[them];
  if (!a || !b) return { overlap: 0, weight: 0.55, primaryUs: "", primaryThem: "" };
  let overlap = 0;
  if (recRole !== "All") {
    const key = recRole.toLowerCase();
    overlap = a.rates[key] || 0;
  } else {
    for (let i = 0; i < ROLE_KEYS.length; i += 1) {
      const key = ROLE_KEYS[i];
      overlap += Math.min(a.rates[key] || 0, b.rates[key] || 0);
    }
  }
  return {
    overlap: overlap,
    weight: recRole !== "All" ? 0.4 + 0.6 * overlap : 0.45 + 0.55 * overlap,
    primaryUs: a.primary,
    primaryThem: b.primary,
  };
}

function formatShare(share) {
  const pct = share * 100;
  if (pct >= 10) return pct.toFixed(0) + "%";
  if (pct >= 1) return pct.toFixed(1) + "%";
  return pct.toFixed(2) + "%";
}

function matchupPopularity(us, them, games) {
  const usTotal = champGames[us] || 0;
  const themTotal = champGames[them] || 0;
  const shareUs = usTotal > 0 && games ? games / usTotal : 0;
  const shareThem = themTotal > 0 && games ? games / themTotal : 0;
  const geo =
    shareUs > 0 && shareThem > 0 ? Math.sqrt(shareUs * shareThem) : shareUs || shareThem;
  const factor = Math.max(0, Math.min(1, geo / 0.03));
  return {
    shareUs: shareUs,
    shareThem: shareThem,
    weight: 0.95 + 0.1 * factor,
  };
}

function enemyIds() {
  const other = recSide === "blue" ? "red" : "blue";
  return state[other].picks.filter(Boolean);
}

function allyIds() {
  return state[recSide].picks.filter(Boolean);
}

function champRoleRates(id) {
  const info = roleRates[id];
  if (info && info.rates) return info.rates;
  const primary = primaryWinrateRole(id);
  const rates = { top: 0, jng: 0, mid: 0, adc: 0, sup: 0 };
  if (primary) rates[primary] = 1;
  return rates;
}

function filledRoles() {
  const filled = { top: 0, jng: 0, mid: 0, adc: 0, sup: 0 };
  const team = state[recSide];
  if (!team) return filled;
  for (let i = 0; i < 5; i += 1) {
    const id = team.picks[i];
    if (!id) continue;
    const assigned = team.roles[i];
    const key = assigned ? assigned.toLowerCase() : pickPrimaryRole(id);
    if (key && filled[key] != null) filled[key] += 1;
  }
  return filled;
}

function roleTaken(key, filled) {
  return !!key && (filled[key] || 0) >= ROLE_FILL_LOCK;
}

function roleConflict(id, filled) {
  const rates = champRoleRates(id);
  let overlap = 0;
  const hits = [];
  for (let i = 0; i < ROLE_KEYS.length; i += 1) {
    const key = ROLE_KEYS[i];
    const share = (rates[key] || 0) * (filled[key] || 0);
    if (share > 0.02) hits.push({ role: key, share: share, filled: filled[key] });
    overlap += share;
  }
  hits.sort(function (a, b) {
    return b.share - a.share;
  });
  return { overlap: overlap, hits: hits };
}

function matchupEntry(us, them) {
  if (counters[us] && counters[us][them]) return counters[us][them];
  return null;
}

function matchupDelta(us, them) {
  const direct = matchupEntry(us, them);
  if (direct && typeof direct.delta === "number") return direct.delta;
  if (typeof direct === "number") return direct;
  const inverse = matchupEntry(them, us);
  if (inverse && typeof inverse.delta === "number") return -inverse.delta;
  if (typeof inverse === "number") return -inverse;
  return null;
}

function matchupGames(us, them) {
  const direct = matchupEntry(us, them);
  if (direct && typeof direct.games === "number") return direct.games;
  const inverse = matchupEntry(them, us);
  if (inverse && typeof inverse.games === "number") return inverse.games;
  return null;
}

function proMatchup(us, them) {
  const row = oracles.matchups && oracles.matchups[us];
  if (row && row[them]) return row[them];
  return null;
}

function synergyEntry(us, them) {
  if (synergies[us] && synergies[us][them]) return synergies[us][them];
  if (synergies[them] && synergies[them][us]) return synergies[them][us];
  return null;
}

function teamPickRows(side) {
  const team = state[side];
  const rows = [];
  for (let i = 0; i < 5; i += 1) {
    if (!team.picks[i]) continue;
    rows.push({ id: team.picks[i], role: team.roles[i] || "" });
  }
  return rows;
}

function expectLaneWeight(us, them, usRole, themRole) {
  if (usRole && themRole) {
    return usRole.toLowerCase() === themRole.toLowerCase() ? 1 : 0.2;
  }
  const a = roleRates[us];
  const b = roleRates[them];
  if (!a || !b) return 0.35;
  let overlap = 0;
  for (let i = 0; i < ROLE_KEYS.length; i += 1) {
    const key = ROLE_KEYS[i];
    overlap += Math.min(a.rates[key] || 0, b.rates[key] || 0);
  }
  return 0.2 + 0.8 * overlap;
}

function clampProb(p) {
  return Math.max(0.01, Math.min(0.99, p));
}

function eloFromDelta(delta) {
  const p = clampProb(0.5 + (Number(delta) || 0) / 100);
  return ELO_SCALE * (Math.log(p / (1 - p)) / Math.LN10);
}

function expectedFromElo(diff) {
  return 1 / (1 + Math.pow(10, -diff / ELO_SCALE));
}

function teamPairing(rows) {
  let eloNum = 0;
  let deltaNum = 0;
  let den = 0;
  for (let i = 0; i < rows.length; i += 1) {
    for (let j = i + 1; j < rows.length; j += 1) {
      const entry = synergyEntry(rows[i].id, rows[j].id);
      if (!entry || typeof entry.delta !== "number") continue;
      const games = entry.games || 0;
      const conf = games / (games + PAIR_PRIOR_GAMES);
      eloNum += eloFromDelta(entry.delta) * conf;
      deltaNum += entry.delta * conf;
      den += conf;
    }
  }
  return { elo: den ? eloNum / den : 0, delta: den ? deltaNum / den : 0 };
}

function teamCounter(usRows, themRows) {
  let eloNum = 0;
  let deltaNum = 0;
  let den = 0;
  for (let i = 0; i < usRows.length; i += 1) {
    for (let j = 0; j < themRows.length; j += 1) {
      const us = usRows[i];
      const them = themRows[j];
      const d = matchupDelta(us.id, them.id);
      if (d == null) continue;
      const games = matchupGames(us.id, them.id) || 0;
      const conf = games / (games + PAIR_PRIOR_GAMES);
      const lane = expectLaneWeight(us.id, them.id, us.role, them.role);
      const weight = lane * Math.max(conf, 0.15);
      eloNum += eloFromDelta(d) * weight;
      deltaNum += d * weight;
      den += weight;
    }
  }
  return { elo: den ? eloNum / den : 0, delta: den ? deltaNum / den : 0 };
}

function draftExpect() {
  const blue = teamPickRows("blue");
  const red = teamPickRows("red");
  if (!blue.length || !red.length) {
    return { ready: false, blue: 50, red: 50, counter: 0, pairing: 0, elo: 0 };
  }
  const counter = teamCounter(blue, red);
  const pairBlue = teamPairing(blue);
  const pairRed = teamPairing(red);
  const pairingDelta = pairBlue.delta - pairRed.delta;
  const elo = (counter.elo + pairBlue.elo - pairRed.elo) * ELO_MULT;
  const p = expectedFromElo(elo);
  return {
    ready: true,
    blue: p * 100,
    red: (1 - p) * 100,
    counter: counter.delta,
    pairing: pairingDelta,
    elo: elo,
  };
}

function toneClass(value) {
  if (value > 0.05) return "up";
  if (value < -0.05) return "down";
  return "";
}

function renderExpect() {
  if (!els.expectBluePct) return;
  const rec = draftExpect();
  els.expectBlueName.textContent = state.blue.name || "Blue";
  els.expectRedName.textContent = state.red.name || "Red";
  els.expectBluePct.textContent = rec.blue.toFixed(1) + "%";
  els.expectRedPct.textContent = rec.red.toFixed(1) + "%";
  if (els.expectFill) els.expectFill.style.width = rec.blue.toFixed(1) + "%";
  if (!rec.ready) {
    els.expectSub.textContent = "Drop picks on both sides to estimate win%";
    if (els.expectMeter) els.expectMeter.title = "Expected win% from counters and pairings";
    return;
  }
  els.expectSub.innerHTML =
    "Elo <span class=\"" +
    toneClass(rec.elo) +
    "\">" +
    formatDelta(rec.elo) +
    "</span> · counter <span class=\"" +
    toneClass(rec.counter) +
    "\">" +
    formatDelta(rec.counter) +
    "</span> · pairing <span class=\"" +
    toneClass(rec.pairing) +
    "\">" +
    formatDelta(rec.pairing) +
    "</span>";
  if (els.expectMeter) {
    els.expectMeter.title =
      (state.blue.name || "Blue") +
      " " +
      rec.blue.toFixed(1) +
      "% · Elo " +
      formatDelta(rec.elo) +
      " · counter " +
      formatDelta(rec.counter) +
      " · pairing " +
      formatDelta(rec.pairing);
  }
}

function scoreChampion(id, enemies, allies) {
  const power = champPower(id);
  const blind = power ? blindPick(id, power) : null;
  const parts = [];
  const pairs = [];
  allies = allies || [];
  enemies = enemies || [];
  for (let i = 0; i < enemies.length; i += 1) {
    const delta = matchupDelta(id, enemies[i]);
    if (delta == null) continue;
    const games = matchupGames(id, enemies[i]);
    const pop = matchupPopularity(id, enemies[i], games);
    const pos = positionOverlap(id, enemies[i]);
    parts.push({
      id: enemies[i],
      delta: delta,
      games: games,
      shareUs: pop.shareUs,
      shareThem: pop.shareThem,
      weight: pop.weight,
      posOverlap: pos.overlap,
      posWeight: pos.weight,
      primaryUs: pos.primaryUs,
      primaryThem: pos.primaryThem,
      weighted: delta * pop.weight * pos.weight,
      pro: proMatchup(id, enemies[i]),
    });
  }
  for (let i = 0; i < allies.length; i += 1) {
    const entry = synergyEntry(id, allies[i]);
    if (!entry || typeof entry.delta !== "number") continue;
    const games = entry.games || 0;
    const conf = games / (games + PAIR_PRIOR_GAMES);
    pairs.push({
      id: allies[i],
      delta: entry.delta,
      games: games,
      role: entry.role || "",
      conf: conf,
      weighted: entry.delta * conf,
    });
  }
  if (!parts.length && !pairs.length && !blind) return null;
  let counter = 0;
  for (let i = 0; i < parts.length; i += 1) counter += parts[i].weighted;
  let pairing = 0;
  for (let i = 0; i < pairs.length; i += 1) pairing += pairs[i].weighted;
  const roles = roleConflict(id, filledRoles());
  const unique = -UNIQUE_ROLE_SCALE * roles.overlap;
  const base = blind ? blind.score : 0;
  return {
    avg: base + weights.counter * counter + weights.pairing * pairing + weights.unique * unique,
    power: power,
    blind: blind,
    counter: counter,
    pairing: pairing,
    unique: unique,
    roles: roles,
    parts: parts,
    pairs: pairs,
  };
}

function recommendedPicks() {
  const enemies = enemyIds();
  const allies = allyIds();
  const taken = takenIds();
  const filled = filledRoles();
  const recs = [];
  for (let i = 0; i < champions.length; i += 1) {
    const champ = champions[i];
    if (taken.has(champ.id)) continue;
    if (tag !== "All" && champ.tags.indexOf(tag) === -1) continue;
    if (!champFitsRole(champ.id, recRole)) continue;
    if (recRole === "All" && roleTaken(pickPrimaryRole(champ.id), filled)) continue;
    const score = scoreChampion(champ.id, enemies, allies);
    if (!score) continue;
    recs.push({
      champ: champ,
      avg: score.avg,
      power: score.power,
      blind: score.blind,
      counter: score.counter,
      pairing: score.pairing,
      unique: score.unique,
      roles: score.roles,
      parts: score.parts,
      pairs: score.pairs,
    });
  }
  recs.sort(function (a, b) {
    return b.avg - a.avg;
  });
  return recs;
}

function scoreTooltip(champ, score) {
  if (!score) return champ.name + " · drag onto a pick or ban";
  const lines = [champ.name + "  " + formatDelta(score.avg)];
  if (score.power) {
    lines.push(
      "power  " +
        formatDelta(weights.wr * score.power.power) +
        "  (" +
        score.power.wr.toFixed(1) +
        "% " +
        roleLabel(score.power.role) +
        ", " +
        score.power.games.toLocaleString() +
        " games vs " +
        score.power.avg.toFixed(1) +
        "% avg · ×" +
        weights.wr.toFixed(2) +
        ")"
    );
  }
  if (score.blind) {
    const opening = Number(score.blind.picks || 0).toLocaleString(undefined, {
      maximumFractionDigits: 1,
    });
    lines.push(
      "popular  " +
        formatDelta(weights.pop * score.blind.popularity) +
        "  (" +
        opening +
        " opening " +
        roleLabel(score.power && score.power.role) +
        ", " +
        formatShare(score.blind.pickRate) +
        " of recent pro · ×" +
        weights.pop.toFixed(2) +
        ")  ·  safety  " +
        formatDelta(weights.safety * score.blind.safety) +
        "  (" +
        formatShare(score.blind.sharpShare) +
        " hard counters · ×" +
        weights.safety.toFixed(2) +
        ")"
    );
  }
  if (score.parts && score.parts.length) {
    lines.push(
      "counters  " +
        formatDelta(weights.counter * score.counter) +
        " vs enemy · ×" +
        weights.counter.toFixed(2)
    );
  }
  const parts = score.parts || [];
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    let line = "vs " + champName(part.id) + "  " + formatDelta(part.delta);
    if (part.games) {
      line +=
        "  (" +
        part.games.toLocaleString() +
        " games · " +
        formatShare(part.shareUs) +
        " of " +
        champ.name +
        ", " +
        formatShare(part.shareThem) +
        " of " +
        champName(part.id) +
        ")";
    }
    lines.push(line);
    if (part.posOverlap != null) {
      lines.push(
        "  roles  " +
          formatShare(part.posOverlap) +
          " overlap (" +
          roleLabel(part.primaryUs) +
          " vs " +
          roleLabel(part.primaryThem) +
          ")"
      );
    }
    if (part.pro && part.pro.games) {
      const losses = part.pro.games - part.pro.wins;
      lines.push(
        "  pro  " +
          formatDelta(part.pro.delta) +
          "  (" +
          part.pro.wins +
          "-" +
          losses +
          ", " +
          part.pro.games.toLocaleString() +
          " games)"
      );
    }
  }
  if (score.pairs && score.pairs.length) {
    lines.push(
      "pairing  " +
        formatDelta(weights.pairing * score.pairing) +
        " with allies · ×" +
        weights.pairing.toFixed(2)
    );
    for (let i = 0; i < score.pairs.length; i += 1) {
      const pair = score.pairs[i];
      lines.push(
        "with " +
          champName(pair.id) +
          "  " +
          formatDelta(pair.weighted) +
          "  (" +
          formatDelta(pair.delta) +
          " Δ2, " +
          (pair.games || 0).toLocaleString() +
          " games)"
      );
    }
  }
  if (score.unique) {
    const hits = (score.roles && score.roles.hits) || [];
    const filled = hits
      .slice(0, 2)
      .map(function (hit) {
        return roleLabel(hit.role) + " " + formatShare(hit.filled);
      })
      .join(", ");
    lines.push(
      "unique  " +
        formatDelta(weights.unique * score.unique) +
        "  (" +
        (filled ? filled + " already picked" : "role overlap") +
        " · ×" +
        weights.unique.toFixed(2) +
        ")"
    );
  }
  return lines.join("\n");
}

function slotList(team, kind) {
  return kind === "ban" ? state[team].bans : state[team].picks;
}

function takenIds() {
  return new Set(
    state.blue.bans
      .concat(state.blue.picks, state.red.bans, state.red.picks, state.usedPicks)
      .filter(Boolean)
  );
}

function findSlot(id) {
  const sides = ["blue", "red"];
  const kinds = ["bans", "picks"];
  for (const team of sides) {
    for (const kind of kinds) {
      const index = state[team][kind].indexOf(id);
      if (index !== -1) {
        return { team: team, kind: kind === "bans" ? "ban" : "pick", index: index };
      }
    }
  }
  return null;
}

function snapshot() {
  history.push(structuredClone(state));
}

function toast(message) {
  els.toast.textContent = message;
  els.toast.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(function () {
    els.toast.hidden = true;
  }, 1800);
}

function clearDropHover() {
  document.querySelectorAll(".drop-hover").forEach(function (node) {
    node.classList.remove("drop-hover");
  });
}

function allowDrop(event) {
  if (!drag) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "move";
}

function beginDrag(event, payload) {
  drag = payload;
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", payload.id || "slot");
  if (event.currentTarget.classList) {
    event.currentTarget.classList.add("is-dragging");
  }
}

function endDrag(event) {
  if (event.currentTarget.classList) {
    event.currentTarget.classList.remove("is-dragging");
  }
  drag = null;
  clearDropHover();
}

function placeChampion(id, team, kind, index) {
  if (!id) return;
  if (state.usedPicks.indexOf(id) !== -1) {
    toast("That champion is locked in the Fearless pool");
    return;
  }

  const dest = slotList(team, kind);
  const existing = findSlot(id);
  const replaced = dest[index];
  const sameSlot =
    existing && existing.team === team && existing.kind === kind && existing.index === index;
  if (sameSlot) return;

  snapshot();

  if (existing) {
    slotList(existing.team, existing.kind)[existing.index] = replaced || null;
    if (existing.kind === "pick" && kind === "pick") {
      const movingRole = state[existing.team].roles[existing.index];
      state[existing.team].roles[existing.index] = state[team].roles[index];
      state[team].roles[index] = movingRole;
    } else if (existing.kind === "pick") {
      state[existing.team].roles[existing.index] = null;
    } else if (kind === "pick") {
      state[team].roles[index] = inferredSlotRole(id);
    }
  } else if (kind === "pick") {
    state[team].roles[index] = inferredSlotRole(id);
  }

  dest[index] = id;
  render();
}

function clearSlot(team, kind, index) {
  const dest = slotList(team, kind);
  if (!dest[index]) return;
  snapshot();
  dest[index] = null;
  if (kind === "pick") state[team].roles[index] = null;
  render();
}

function returnToPool(id) {
  const found = findSlot(id);
  if (!found) return;
  clearSlot(found.team, found.kind, found.index);
}

function undo() {
  if (!history.length) return;
  state = history.pop();
  render();
}

function resetGame() {
  snapshot();
  const keep = {
    fearless: state.fearless,
    seriesLength: state.seriesLength,
    gameIndex: state.gameIndex,
    usedPicks: state.usedPicks,
    blueName: state.blue.name,
    redName: state.red.name,
  };
  state = emptyState();
  state.fearless = keep.fearless;
  state.seriesLength = keep.seriesLength;
  state.gameIndex = keep.gameIndex;
  state.usedPicks = keep.usedPicks;
  state.blue.name = keep.blueName;
  state.red.name = keep.redName;
  render();
}

function nextGame() {
  if (state.gameIndex + 1 >= state.seriesLength) {
    toast("Series complete");
    return;
  }
  snapshot();
  if (state.fearless) {
    state.usedPicks = state.usedPicks.concat(
      state.blue.picks.filter(Boolean),
      state.red.picks.filter(Boolean)
    );
  }
  state.gameIndex += 1;
  state.blue.bans = Array(5).fill(null);
  state.blue.picks = Array(5).fill(null);
  state.blue.roles = Array(5).fill(null);
  state.red.bans = Array(5).fill(null);
  state.red.picks = Array(5).fill(null);
  state.red.roles = Array(5).fill(null);
  render();
}

function swapSides() {
  snapshot();
  const blue = structuredClone(state.blue);
  state.blue = structuredClone(state.red);
  state.red = blue;
  render();
}

function cycleRole(team, index) {
  const current = state[team].roles[index];
  const next = current == null ? 0 : ROLES.indexOf(current) + 1;
  state[team].roles[index] = next >= ROLES.length ? null : ROLES[next];
  render();
}

function visibleChampions() {
  const query = search.trim().toLowerCase().replace(/['.\s]/g, "");
  return champions.filter(function (champ) {
    if (tag !== "All" && champ.tags.indexOf(tag) === -1) return false;
    if (!query) return true;
    const hay = (champ.name + champ.id + champ.key).toLowerCase().replace(/['.\s]/g, "");
    return hay.indexOf(query) !== -1;
  });
}

function bindSlotDrop(node, team, kind, index) {
  node.addEventListener("dragover", function (event) {
    allowDrop(event);
    node.classList.add("drop-hover");
  });
  node.addEventListener("dragleave", function (event) {
    if (!node.contains(event.relatedTarget)) node.classList.remove("drop-hover");
  });
  node.addEventListener("drop", function (event) {
    event.preventDefault();
    node.classList.remove("drop-hover");
    if (!drag) return;
    placeChampion(drag.id, team, kind, index);
    drag = null;
  });
  node.addEventListener("dblclick", function () {
    clearSlot(team, kind, index);
  });
}

function renderBans(team, root) {
  root.innerHTML = "";
  for (let i = 0; i < 5; i += 1) {
    const slot = document.createElement("div");
    const id = state[team].bans[i];
    slot.className = "ban";
    slot.title = id ? champName(id) + " — double-click to remove" : "Drop a ban here";
    if (id) {
      slot.classList.add("filled");
      slot.draggable = true;
      const img = document.createElement("img");
      img.src = portrait(id);
      img.alt = champName(id);
      img.draggable = false;
      slot.append(img);
      slot.addEventListener("dragstart", function (event) {
        beginDrag(event, { id: id, team: team, kind: "ban", index: i });
      });
      slot.addEventListener("dragend", endDrag);
    }
    bindSlotDrop(slot, team, "ban", i);
    root.append(slot);
  }
}

function renderPicks(team, root) {
  root.innerHTML = "";
  for (let i = 0; i < 5; i += 1) {
    const slot = document.createElement("article");
    const id = state[team].picks[i];
    slot.className = "pick";
    slot.title = id ? champName(id) + " — drag to move, double-click to remove" : "Drop a pick here";
    if (id) {
      slot.draggable = true;
      slot.classList.add("filled");
      const art = document.createElement("img");
      art.className = "pick-art";
      art.src = loadingArt(id);
      art.alt = champName(id);
      art.draggable = false;
      const meta = document.createElement("div");
      meta.className = "pick-meta";
      const name = document.createElement("div");
      name.className = "pick-name";
      name.textContent = champName(id);
      const role = document.createElement("button");
      role.type = "button";
      role.className = "role-btn";
      role.textContent = state[team].roles[i] || "ROLE";
      role.addEventListener("click", function (event) {
        event.stopPropagation();
        cycleRole(team, i);
      });
      const clear = document.createElement("button");
      clear.type = "button";
      clear.className = "role-btn";
      clear.textContent = "✕";
      clear.title = "Return to pool";
      clear.addEventListener("click", function (event) {
        event.stopPropagation();
        clearSlot(team, "pick", i);
      });
      meta.append(name, role, clear);
      slot.append(art, meta);
      slot.addEventListener("dragstart", function (event) {
        beginDrag(event, { id: id, team: team, kind: "pick", index: i });
      });
      slot.addEventListener("dragend", endDrag);
    } else {
      const empty = document.createElement("div");
      empty.className = "pick-empty";
      empty.textContent = "Pick " + (i + 1);
      slot.append(empty);
    }
    bindSlotDrop(slot, team, "pick", i);
    root.append(slot);
  }
}

function renderGrid() {
  const taken = takenIds();
  const visible = visibleChampions();
  const recs = recommendedPicks();
  const topIds = {};
  for (let i = 0; i < recs.length && i < 8; i += 1) topIds[recs[i].champ.id] = recs[i];
  const enemies = enemyIds();
  const allies = allyIds();
  els.grid.innerHTML = "";
  if (!visible.length) {
    const empty = document.createElement("p");
    empty.className = "pick-empty";
    empty.textContent = "No champions match that search.";
    els.grid.append(empty);
    return;
  }
  for (const champ of visible) {
    const locked = taken.has(champ.id);
    const rec = topIds[champ.id];
    const score = !locked ? scoreChampion(champ.id, enemies, allies) : null;
    const button = document.createElement("div");
    button.className = "champ";
    button.draggable = !locked;
    if (locked) button.classList.add("disabled");
    if (rec) button.classList.add("suggested");
    button.setAttribute("role", "img");
    button.title = locked ? champ.name + " is already on the board" : scoreTooltip(champ, score);
    const img = document.createElement("img");
    img.src = portrait(champ.id);
    img.alt = champ.name;
    img.width = 80;
    img.height = 80;
    img.draggable = false;
    const label = document.createElement("span");
    label.className = "label";
    label.textContent = champ.name;
    button.append(img, label);
    button.addEventListener("mouseenter", function () {
      els.splash.style.backgroundImage = 'url("' + splash(champ.id) + '")';
      els.splash.classList.add("on");
    });
    button.addEventListener("mouseleave", function () {
      els.splash.classList.remove("on");
    });
    if (!locked) {
      button.addEventListener("dragstart", function (event) {
        beginDrag(event, { id: champ.id, source: "pool" });
      });
      button.addEventListener("dragend", endDrag);
    }
    els.grid.append(button);
  }
}

function renderRecs() {
  const recs = recommendedPicks();
  const enemies = enemyIds();
  const allies = allyIds();
  els.recsBlue.classList.toggle("active", recSide === "blue");
  els.recsRed.classList.toggle("active", recSide === "red");
  const hasPower = !!(winrates.lanes && Object.keys(winrates.lanes).length);
  if (!enemies.length && !allies.length && !hasPower) {
    els.recs.hidden = true;
    els.recsList.innerHTML = "";
    return;
  }
  els.recs.hidden = false;
  const ourName = recSide === "blue" ? state.blue.name : state.red.name;
  const otherName = recSide === "blue" ? state.red.name : state.blue.name;
  const roleBit = recRole === "All" ? "" : recRole + " ";
  if (enemies.length && allies.length) {
    els.recsLabel.textContent = "Best " + roleBit + "with " + ourName + " into " + otherName;
  } else if (enemies.length) {
    els.recsLabel.textContent = "Best " + roleBit + "into " + otherName;
  } else if (allies.length) {
    els.recsLabel.textContent = "Best " + roleBit + "with " + ourName;
  } else {
    els.recsLabel.textContent = recRole === "All" ? "Blind picks" : "Blind " + recRole;
  }
  els.recsList.innerHTML = "";
  const top = recs.slice(0, 8);
  if (!top.length) {
    const empty = document.createElement("p");
    empty.className = "pick-empty";
    empty.textContent = "No matchup data for the current filters.";
    els.recsList.append(empty);
    return;
  }
  for (let i = 0; i < top.length; i += 1) {
    const rec = top[i];
    const card = document.createElement("div");
    card.className = "rec-card";
    card.draggable = true;
    card.title = scoreTooltip(rec.champ, rec);
    const img = document.createElement("img");
    img.src = portrait(rec.champ.id);
    img.alt = rec.champ.name;
    img.draggable = false;
    const meta = document.createElement("div");
    meta.className = "rec-meta";
    const name = document.createElement("strong");
    name.textContent = rec.champ.name;
    const delta = document.createElement("span");
    delta.className = rec.avg >= 0 ? "up" : "down";
    delta.textContent = formatDelta(rec.avg);
    meta.append(name, delta);
    const sample = document.createElement("em");
    if (rec.power) {
      sample.textContent =
        rec.power.wr.toFixed(1) + "% " + roleLabel(rec.power.role);
    } else if (rec.parts && rec.parts.length === 1 && rec.parts[0].games) {
      sample.textContent = rec.parts[0].games.toLocaleString() + " games";
    }
    if (sample.textContent) meta.append(sample);
    card.append(img, meta);
    card.addEventListener("dragstart", function (event) {
      beginDrag(event, { id: rec.champ.id, source: "pool" });
    });
    card.addEventListener("dragend", endDrag);
    els.recsList.append(card);
  }
}

function renderUsed() {
  const show = state.fearless && state.usedPicks.length > 0;
  els.usedBar.hidden = !show;
  els.usedChamps.innerHTML = "";
  if (!show) return;
  for (const id of state.usedPicks) {
    const img = document.createElement("img");
    img.src = portrait(id);
    img.alt = champName(id);
    img.title = champName(id);
    els.usedChamps.append(img);
  }
}

function render() {
  els.blueName.value = state.blue.name;
  els.redName.value = state.red.name;
  els.fearless.checked = state.fearless;
  els.series.value = String(state.seriesLength);
  els.gameLabel.textContent = "Game " + (state.gameIndex + 1) + " / " + state.seriesLength;
  renderBans("blue", els.blueBans);
  renderBans("red", els.redBans);
  renderPicks("blue", els.bluePicks);
  renderPicks("red", els.redPicks);
  renderRecs();
  renderGrid();
  renderUsed();
  renderExpect();
}

function renderRecRoles() {
  if (!els.recsRoles) return;
  els.recsRoles.innerHTML = "";
  for (const name of ROLE_FILTERS) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = name;
    button.classList.toggle("active", recRole === name);
    button.addEventListener("click", function () {
      recRole = name;
      renderRecRoles();
      renderRecs();
      renderGrid();
    });
    els.recsRoles.append(button);
  }
}

function renderTags() {
  els.tags.innerHTML = "";
  for (const name of TAGS) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = name;
    button.classList.toggle("active", tag === name);
    button.addEventListener("click", function () {
      tag = name;
      renderTags();
      renderRecs();
      renderGrid();
    });
    els.tags.append(button);
  }
}

function clampWeight(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(3, n));
}

function loadWeights() {
  weights = Object.assign({}, WEIGHT_DEFAULTS);
  try {
    const saved = JSON.parse(localStorage.getItem(WEIGHT_STORAGE) || "null");
    if (saved && typeof saved === "object") {
      weights.wr = clampWeight(saved.wr, WEIGHT_DEFAULTS.wr);
      weights.pop = clampWeight(saved.pop, WEIGHT_DEFAULTS.pop);
      weights.safety = clampWeight(saved.safety, WEIGHT_DEFAULTS.safety);
      weights.counter = clampWeight(saved.counter, WEIGHT_DEFAULTS.counter);
      weights.pairing = clampWeight(saved.pairing, WEIGHT_DEFAULTS.pairing);
      weights.unique = clampWeight(saved.unique, WEIGHT_DEFAULTS.unique);
    }
  } catch (err) {}
  if (els.wWr) els.wWr.value = String(weights.wr);
  if (els.wPop) els.wPop.value = String(weights.pop);
  if (els.wSafety) els.wSafety.value = String(weights.safety);
  if (els.wCounter) els.wCounter.value = String(weights.counter);
  if (els.wPairing) els.wPairing.value = String(weights.pairing);
  if (els.wUnique) els.wUnique.value = String(weights.unique);
  syncWeightLabels();
}

function saveWeights() {
  try {
    localStorage.setItem(WEIGHT_STORAGE, JSON.stringify(weights));
  } catch (err) {}
}

function syncWeightLabels() {
  if (els.wWrVal) els.wWrVal.textContent = weights.wr.toFixed(2);
  if (els.wPopVal) els.wPopVal.textContent = weights.pop.toFixed(2);
  if (els.wSafetyVal) els.wSafetyVal.textContent = weights.safety.toFixed(2);
  if (els.wCounterVal) els.wCounterVal.textContent = weights.counter.toFixed(2);
  if (els.wPairingVal) els.wPairingVal.textContent = weights.pairing.toFixed(2);
  if (els.wUniqueVal) els.wUniqueVal.textContent = weights.unique.toFixed(2);
}

function readWeightSliders() {
  weights.wr = clampWeight(els.wWr && els.wWr.value, WEIGHT_DEFAULTS.wr);
  weights.pop = clampWeight(els.wPop && els.wPop.value, WEIGHT_DEFAULTS.pop);
  weights.safety = clampWeight(els.wSafety && els.wSafety.value, WEIGHT_DEFAULTS.safety);
  weights.counter = clampWeight(els.wCounter && els.wCounter.value, WEIGHT_DEFAULTS.counter);
  weights.pairing = clampWeight(els.wPairing && els.wPairing.value, WEIGHT_DEFAULTS.pairing);
  weights.unique = clampWeight(els.wUnique && els.wUnique.value, WEIGHT_DEFAULTS.unique);
  syncWeightLabels();
  saveWeights();
  renderRecs();
  renderGrid();
}

function bindWeights() {
  loadWeights();
  ["wWr", "wPop", "wSafety", "wCounter", "wPairing", "wUnique"].forEach(function (key) {
    if (!els[key]) return;
    els[key].addEventListener("input", readWeightSliders);
  });
}

function bind() {
  bindWeights();
  els.search.addEventListener("input", function () {
    search = els.search.value;
    renderGrid();
  });
  els.blueName.addEventListener("input", function () {
    state.blue.name = els.blueName.value;
  });
  els.redName.addEventListener("input", function () {
    state.red.name = els.redName.value;
  });
  els.fearless.addEventListener("change", function () {
    state.fearless = els.fearless.checked;
    renderUsed();
  });
  els.series.addEventListener("change", function () {
    state.seriesLength = Number(els.series.value);
    if (state.gameIndex >= state.seriesLength) state.gameIndex = state.seriesLength - 1;
    render();
  });
  els.undo.addEventListener("click", undo);
  els.reset.addEventListener("click", resetGame);
  els.next.addEventListener("click", nextGame);
  els.swap.addEventListener("click", swapSides);
  els.recsBlue.addEventListener("click", function () {
    recSide = "blue";
    renderRecs();
    renderGrid();
  });
  els.recsRed.addEventListener("click", function () {
    recSide = "red";
    renderRecs();
    renderGrid();
  });

  els.grid.addEventListener("dragover", function (event) {
    if (!drag || drag.source === "pool") return;
    allowDrop(event);
    els.grid.classList.add("drop-hover");
  });
  els.grid.addEventListener("dragleave", function (event) {
    if (!els.grid.contains(event.relatedTarget)) els.grid.classList.remove("drop-hover");
  });
  els.grid.addEventListener("drop", function (event) {
    event.preventDefault();
    els.grid.classList.remove("drop-hover");
    if (drag && drag.source !== "pool") returnToPool(drag.id);
    drag = null;
  });

  document.addEventListener("keydown", function (event) {
    if (event.key === "/" && document.activeElement !== els.search) {
      event.preventDefault();
      els.search.focus();
    }
    if (event.key === "Escape") {
      els.search.value = "";
      search = "";
      renderGrid();
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      undo();
    }
  });
}

function applyOracles(data) {
  if (!data || !data.matchups) return;
  oracles = data;
  if (!oracles.positions) oracles.positions = {};
  window.RIFT_ORACLES = data;
  rebuildRoleRates();
  rebuildOePop();
}

function loadOracles() {
  applyOracles(window.RIFT_ORACLES);
  if (location.protocol === "file:") return Promise.resolve();
  return fetch("oracles.json", { cache: "no-store" })
    .then(function (res) {
      if (!res.ok) return null;
      return res.json();
    })
    .then(function (data) {
      applyOracles(data);
    })
    .catch(function () {});
}

function showApp() {
  els.boot.classList.add("is-hidden");
  els.boot.hidden = true;
  els.app.hidden = false;
  els.boot.remove();
}

function boot() {
  try {
    const data = window.RIFT_DRAFT_DATA;
    if (!data || !data.champions || !data.champions.length) {
      throw new Error("Missing bundled champion data");
    }
    patch = data.patch;
    champions = data.champions;
    champMap = new Map(
      champions.map(function (champ) {
        return [champ.id, champ];
      })
    );
    counters = (window.RIFT_COUNTERS && window.RIFT_COUNTERS.matchups) || {};
    synergies = (window.RIFT_SYNERGIES && window.RIFT_SYNERGIES.synergies) || {};
    winrates = window.RIFT_WINRATES || { lanes: {} };
    if (!winrates.lanes) winrates.lanes = {};
    rebuildChampGames();
    if (els.bootStatus) els.bootStatus.textContent = "Loading match data…";
    loadOracles()
      .then(function () {
        bind();
        renderTags();
        renderRecRoles();
        render();
        showApp();
        els.search.focus();
      })
      .catch(function (error) {
        if (els.bootStatus) {
          els.bootStatus.textContent = "Could not start the draft board: " + error.message;
        }
        console.error(error);
      });
  } catch (error) {
    if (els.bootStatus) {
      els.bootStatus.textContent = "Could not start the draft board: " + error.message;
    }
    console.error(error);
  }
}

boot();
