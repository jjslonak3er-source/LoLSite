(function (root) {
  const ELO_SCALE = 400;
  const ELO_MULT = 10;
  const PAIR_PRIOR = 400;
  const TEAM_SCORE_ELO = 25;
  const ROLE_KEYS = ["top", "jng", "mid", "adc", "sup"];

  function matchups() {
    return (root.RIFT_COUNTERS && root.RIFT_COUNTERS.matchups) || {};
  }

  function synergies() {
    return (root.RIFT_SYNERGIES && root.RIFT_SYNERGIES.synergies) || {};
  }

  function ratings() {
    return (root.RIFT_PLAYER_RATINGS && root.RIFT_PLAYER_RATINGS.roles) || {};
  }

  function playerKey(name) {
    return String(name || "")
      .toLowerCase()
      .replace(/\s+/g, "");
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

  function matchupRec(us, them) {
    const map = matchups();
    const direct = map[us] && map[us][them];
    if (direct && typeof direct.delta === "number") {
      return { delta: direct.delta, games: direct.games || 0 };
    }
    const inverse = map[them] && map[them][us];
    if (inverse && typeof inverse.delta === "number") {
      return { delta: -inverse.delta, games: inverse.games || 0 };
    }
    return null;
  }

  function synergyRec(us, them) {
    const map = synergies();
    const direct = map[us] && map[us][them];
    if (direct && typeof direct.delta === "number") return direct;
    const inverse = map[them] && map[them][us];
    if (inverse && typeof inverse.delta === "number") return inverse;
    return null;
  }

  function laneWeight(usRole, themRole) {
    if (usRole && themRole) {
      return String(usRole).toLowerCase() === String(themRole).toLowerCase() ? 1 : 0.2;
    }
    return 0.35;
  }

  function pairingOf(rows) {
    let eloNum = 0;
    let deltaNum = 0;
    let den = 0;
    for (let i = 0; i < rows.length; i += 1) {
      for (let j = i + 1; j < rows.length; j += 1) {
        const entry = synergyRec(rows[i].id, rows[j].id);
        if (!entry) continue;
        const games = entry.games || 0;
        const conf = games / (games + PAIR_PRIOR);
        eloNum += eloFromDelta(entry.delta) * conf;
        deltaNum += entry.delta * conf;
        den += conf;
      }
    }
    return { elo: den ? eloNum / den : 0, delta: den ? deltaNum / den : 0 };
  }

  function counterOf(usRows, themRows) {
    let eloNum = 0;
    let deltaNum = 0;
    let den = 0;
    for (let i = 0; i < usRows.length; i += 1) {
      for (let j = 0; j < themRows.length; j += 1) {
        const us = usRows[i];
        const them = themRows[j];
        const rec = matchupRec(us.id, them.id);
        if (!rec) continue;
        const conf = rec.games / (rec.games + PAIR_PRIOR);
        const weight = laneWeight(us.role, them.role) * Math.max(conf, 0.15);
        eloNum += eloFromDelta(rec.delta) * weight;
        deltaNum += rec.delta * weight;
        den += weight;
      }
    }
    return { elo: den ? eloNum / den : 0, delta: den ? deltaNum / den : 0 };
  }

  function lineupExpect(blue, red) {
    const counter = counterOf(blue || [], red || []);
    const pairBlue = pairingOf(blue || []);
    const pairRed = pairingOf(red || []);
    const elo = (counter.elo + pairBlue.elo - pairRed.elo) * ELO_MULT;
    return {
      elo: elo,
      counter: counter.delta,
      pairing: pairBlue.delta - pairRed.delta,
    };
  }

  function playerScore(name, role) {
    const key = playerKey(name);
    if (!key) return null;
    const roles = ratings();
    const roleName = String(role || "").toLowerCase();
    if (roleName && roles[roleName] && roles[roleName][key] && roles[roleName][key].s != null) {
      return roles[roleName][key].s;
    }
    let best = null;
    for (let i = 0; i < ROLE_KEYS.length; i += 1) {
      const rec = roles[ROLE_KEYS[i]] && roles[ROLE_KEYS[i]][key];
      if (!rec || rec.s == null) continue;
      if (best == null || rec.s > best) best = rec.s;
    }
    return best;
  }

  function rosterScore(rows) {
    let num = 0;
    let den = 0;
    for (let i = 0; i < (rows || []).length; i += 1) {
      const score = playerScore(rows[i].name, rows[i].role);
      if (score == null || !isFinite(score)) continue;
      num += score;
      den += 1;
    }
    if (!den) return null;
    return num / den;
  }

  function matchPredict(blue, red) {
    const draft = lineupExpect(blue, red);
    const blueScore = rosterScore(blue);
    const redScore = rosterScore(red);
    const teamElo =
      blueScore != null && redScore != null ? (blueScore - redScore) * TEAM_SCORE_ELO : 0;
    const elo = (draft.elo || 0) + teamElo;
    const p = expectedFromElo(elo);
    return {
      blue: p * 100,
      red: (1 - p) * 100,
      elo: elo,
      draft: draft.elo,
      team: teamElo,
      counter: draft.counter,
      pairing: draft.pairing,
      blueScore: blueScore,
      redScore: redScore,
    };
  }

  root.RIFT_PREDICT = {
    eloFromDelta: eloFromDelta,
    expectedFromElo: expectedFromElo,
    lineupExpect: lineupExpect,
    rosterScore: rosterScore,
    playerScore: playerScore,
    matchPredict: matchPredict,
  };
})(window);
