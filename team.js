const LAST_GAMES = 15;

const teamEls = {
  boot: document.getElementById("boot"),
  bootStatus: document.getElementById("boot-status"),
  app: document.getElementById("app"),
  title: document.getElementById("team-title"),
  range: document.getElementById("team-range"),
  search: document.getElementById("team-search"),
  leagues: document.getElementById("team-leagues"),
  windows: document.getElementById("team-windows"),
  patches: document.getElementById("team-patches"),
  summary: document.getElementById("team-summary"),
  boardTitle: document.getElementById("team-board-title"),
  head: document.getElementById("team-head"),
  body: document.getElementById("team-body"),
  side: document.getElementById("team-side"),
  gamesSub: document.getElementById("team-games-sub"),
  gamesBody: document.getElementById("team-games-body"),
  layout: document.querySelector(".player-layout"),
};

let team = params.get("team") || "";
let rosterSort = "role";
let rosterDir = 1;

function windowParam() {
  return RIFT_WINDOW.param();
}

function teamSyncUrl() {
  const url = new URL(location.href);
  if (team) url.searchParams.set("team", team);
  else url.searchParams.delete("team");
  url.searchParams.set("league", formatSel(leagues));
  url.searchParams.set("window", windowParam());
  url.searchParams.set("patch", formatSel(patches));
  history.replaceState({}, "", url);
}

function teamWindowRow() {
  RIFT_WINDOW.mount(teamEls.windows, function () {
    windowKey = RIFT_WINDOW.key;
    teamSyncUrl();
    renderTeam();
  });
}

function teamChips() {
  const leagueOpts = LEAGUES.slice(1);
  chipRowMulti(teamEls.leagues, LEAGUES, leagues, function (name) {
    leagues = toggleSel(leagues, name, leagueOpts);
    teamSyncUrl();
    renderTeam();
  });
  teamWindowRow();
  const available = listPatches(windowGames());
  patches = patches.filter(function (name) {
    return available.indexOf(name) !== -1;
  });
  chipRowMulti(teamEls.patches, ["All"].concat(available), patches, function (name) {
    patches = toggleSel(patches, name, available);
    teamSyncUrl();
    renderTeam();
  });
}

function sideOf(game, name) {
  if (game.bt === name) return "b";
  if (game.rt === name) return "r";
  return "";
}

function firstFor(x, key, side) {
  const val = x && x[key];
  if (val !== 0 && val !== 1) return null;
  return side === "b" ? val === 1 : val === 0;
}

function tallyFirst(rec, x, key, side) {
  const hit = firstFor(x, key, side);
  if (hit == null) return;
  rec[key + "N"] += 1;
  if (hit) rec[key] += 1;
}

function firstRate(hits, n) {
  return n ? hits / n : null;
}

function collectTeams() {
  const games = filteredGames();
  const map = {};
  for (let i = 0; i < games.length; i += 1) {
    const game = games[i];
    const sides = [
      { key: "b", team: game.bt, names: game.bp, champs: game.b, kdas: game.bk, win: game.w === 1 },
      { key: "r", team: game.rt, names: game.rp, champs: game.r, kdas: game.rk, win: game.w === 0 },
    ];
    for (let s = 0; s < 2; s += 1) {
      const side = sides[s];
      if (!side.team) continue;
      const rec = map[side.team] || (map[side.team] = {
        name: side.team,
        leagues: {},
        games: [],
        wins: 0,
        k: 0,
        d: 0,
        a: 0,
        gd: 0,
        gdN: 0,
        champs: {},
        players: {},
        fb: 0,
        fbN: 0,
        ft: 0,
        ftN: 0,
        fd: 0,
        fdN: 0,
      });
      rec.games.push(game);
      rec.leagues[game.l] = (rec.leagues[game.l] || 0) + 1;
      rec.wins += side.win ? 1 : 0;
      const x = game.x || {};
      tallyFirst(rec, x, "fb", side.key);
      tallyFirst(rec, x, "ft", side.key);
      tallyFirst(rec, x, "fd", side.key);
      for (let r = 0; r < 5; r += 1) {
        const pname = side.names[r];
        if (!pname) continue;
        rec.k += side.kdas[r][0];
        rec.d += side.kdas[r][1];
        rec.a += side.kdas[r][2];
        rec.champs[side.champs[r]] = (rec.champs[side.champs[r]] || 0) + 1;
        const key = playerKey(pname);
        const player = rec.players[key] || (rec.players[key] = {
          name: pname,
          roles: {},
          champs: {},
          games: 0,
          wins: 0,
          k: 0,
          d: 0,
          a: 0,
        });
        player.name = pname;
        player.games += 1;
        player.wins += side.win ? 1 : 0;
        player.k += side.kdas[r][0];
        player.d += side.kdas[r][1];
        player.a += side.kdas[r][2];
        player.roles[ROLE_KEYS[r]] = (player.roles[ROLE_KEYS[r]] || 0) + 1;
        player.champs[side.champs[r]] = (player.champs[side.champs[r]] || 0) + 1;
        if (x.g15 && x.g15[r] != null) {
          rec.gd += side.key === "b" ? x.g15[r] : -x.g15[r];
          rec.gdN += 1;
        }
      }
    }
  }
  return map;
}

function lastTeamGames(games) {
  return (games || []).slice(0, LAST_GAMES);
}

function recentShares(teamName, games) {
  const recent = lastTeamGames(games);
  const n = recent.length;
  const shares = {};
  for (let i = 0; i < recent.length; i += 1) {
    const game = recent[i];
    const side = sideOf(game, teamName);
    const names = side === "b" ? game.bp : game.rp;
    for (let r = 0; r < 5; r += 1) {
      const name = names[r];
      if (!name) continue;
      const key = playerKey(name);
      const rec = shares[key] || (shares[key] = { name: name, n: 0, roles: {} });
      rec.n += 1;
      rec.roles[ROLE_KEYS[r]] = (rec.roles[ROLE_KEYS[r]] || 0) + 1;
    }
  }
  return { n: n, shares: shares };
}

function teamScore(teamName, games) {
  const recent = recentShares(teamName, games);
  if (!recent.n) return null;
  let num = 0;
  let den = 0;
  const keys = Object.keys(recent.shares);
  for (let i = 0; i < keys.length; i += 1) {
    const rec = recent.shares[keys[i]];
    const role = mostCommon(rec.roles);
    const score = ratingScore(rec.name, role);
    if (score == null || !isFinite(score)) continue;
    const w = rec.n / recent.n;
    num += score * w;
    den += w;
  }
  if (!den) return null;
  return num / den;
}

function sideLineup(game, side) {
  const champs = side === "b" ? game.b : game.r;
  const names = side === "b" ? game.bp : game.rp;
  const rows = [];
  for (let i = 0; i < 5; i += 1) {
    if (!champs || !champs[i]) continue;
    rows.push({ id: champs[i], name: (names && names[i]) || "", role: ROLE_KEYS[i] });
  }
  return rows;
}

function sideBans(game, side) {
  return side === "b" ? game.bb || [] : game.rb || [];
}

function teamDraftScore(teamName, games) {
  const predict = window.RIFT_PREDICT;
  if (!predict || !predict.draftQuality) return null;
  let num = 0;
  let den = 0;
  const parts = {
    wr: 0,
    pop: 0,
    safety: 0,
    counter: 0,
    pairing: 0,
    ban: 0,
    banThreat: 0,
    banDeny: 0,
    banMastery: 0,
  };
  let weights = null;
  for (let i = 0; i < (games || []).length; i += 1) {
    const game = games[i];
    const mine = sideOf(game, teamName);
    if (!mine) continue;
    const rec = predict.draftQuality(
      sideLineup(game, mine),
      sideLineup(game, mine === "b" ? "r" : "b"),
      sideBans(game, mine)
    );
    if (!rec || rec.score == null || !isFinite(rec.score)) continue;
    num += rec.score;
    den += 1;
    parts.wr += rec.wr;
    parts.pop += rec.pop;
    parts.safety += rec.safety;
    parts.counter += rec.counter;
    parts.pairing += rec.pairing;
    parts.ban += rec.ban;
    parts.banThreat += rec.banThreat;
    parts.banDeny += rec.banDeny;
    parts.banMastery += rec.banMastery;
    weights = rec.weights;
  }
  if (!den) return null;
  return {
    score: num / den,
    wr: parts.wr / den,
    pop: parts.pop / den,
    safety: parts.safety / den,
    counter: parts.counter / den,
    pairing: parts.pairing / den,
    ban: parts.ban / den,
    banThreat: parts.banThreat / den,
    banDeny: parts.banDeny / den,
    banMastery: parts.banMastery / den,
    n: den,
    weights: weights,
  };
}

function draftTip(rec) {
  if (!rec) {
    return "How well this team drafts vs other teams in this filter. Counters and pairings ×2. Bans score denied threats, enemy pairings, and enemy mastery.";
  }
  const w = rec.weights || {};
  return (
    "Vs other teams in this filter · " +
    rec.n +
    " drafts · wr " +
    fmtScore(rec.wr) +
    " ×" +
    Number(w.wr || 1).toFixed(2) +
    " · pop " +
    fmtScore(rec.pop) +
    " ×" +
    Number(w.pop || 1).toFixed(2) +
    " · safety " +
    fmtScore(rec.safety) +
    " ×" +
    Number(w.safety || 1).toFixed(2) +
    " · counters " +
    fmtScore(rec.counter) +
    " ×" +
    Number(w.counter || 1).toFixed(2) +
    " · pairing " +
    fmtScore(rec.pairing) +
    " ×" +
    Number(w.pairing || 1).toFixed(2) +
    " · bans " +
    fmtScore(rec.ban) +
    " ×" +
    Number(w.ban || 1).toFixed(2) +
    " (threat " +
    fmtScore(rec.banThreat) +
    " · deny " +
    fmtScore(rec.banDeny) +
    " · mastery " +
    fmtScore(rec.banMastery) +
    ")"
  );
}

function centerDraftScores(rows) {
  const keys = [
    "score",
    "wr",
    "pop",
    "safety",
    "counter",
    "pairing",
    "ban",
    "banThreat",
    "banDeny",
    "banMastery",
  ];
  const means = {};
  for (let k = 0; k < keys.length; k += 1) {
    const key = keys[k];
    let sum = 0;
    let n = 0;
    for (let i = 0; i < rows.length; i += 1) {
      const rec = rows[i].draftRec;
      if (!rec || rec[key] == null || !isFinite(rec[key])) continue;
      sum += rec[key];
      n += 1;
    }
    means[key] = n ? sum / n : 0;
  }
  for (let i = 0; i < rows.length; i += 1) {
    const rec = rows[i].draftRec;
    if (!rec) {
      rows[i].draft = null;
      continue;
    }
    for (let k = 0; k < keys.length; k += 1) {
      rec[keys[k]] -= means[keys[k]];
    }
    rows[i].draft = rec.score;
  }
}

function teamDirectory() {
  const q = (search || "").trim().toLowerCase();
  const map = collectTeams();
  const out = [];
  const names = Object.keys(map);
  for (let i = 0; i < names.length; i += 1) {
    const rec = map[names[i]];
    if (q && rec.name.toLowerCase().indexOf(q) === -1) continue;
    const n = rec.games.length;
    const draftRec = teamDraftScore(rec.name, rec.games);
    out.push({
      name: rec.name,
      league: mostCommon(rec.leagues),
      games: n,
      wins: rec.wins,
      winRate: n ? rec.wins / n : 0,
      gd15: rec.gdN ? rec.gd / rec.gdN : null,
      kda: kdaRatio(rec.k, rec.d, rec.a),
      fb: firstRate(rec.fb, rec.fbN),
      ft: firstRate(rec.ft, rec.ftN),
      fd: firstRate(rec.fd, rec.fdN),
      champs: topKeys(rec.champs, 5),
      score: teamScore(rec.name, rec.games),
      vs: rosterTrueScore(rosterRows(rec)),
      draft: draftRec ? draftRec.score : null,
      draftRec: draftRec,
      rec: rec,
    });
  }
  centerDraftScores(out);
  return sortRows(out, dirSort, dirDir);
}

function roleOrder(role) {
  const i = ROLE_KEYS.indexOf((role || "").toLowerCase());
  return i < 0 ? 99 : i;
}

function rosterRows(rec) {
  const recent = recentShares(rec.name, rec.games);
  const keys = Object.keys(rec.players);
  const out = [];
  for (let i = 0; i < keys.length; i += 1) {
    const player = rec.players[keys[i]];
    const share = recent.shares[keys[i]];
    const role = mostCommon(share ? share.roles : player.roles);
    out.push({
      name: player.name,
      role: role,
      roleOrd: roleOrder(role),
      games: player.games,
      wins: player.wins,
      winRate: player.games ? player.wins / player.games : 0,
      kda: kdaRatio(player.k, player.d, player.a),
      champs: topKeys(player.champs, 5),
      recent: share ? share.n : 0,
      share: recent.n ? (share ? share.n / recent.n : 0) : 0,
      score: ratingScore(player.name, role),
      rel: ratingRel(player.name, role),
    });
  }
  let teamAvg = 0;
  let teamN = 0;
  for (let i = 0; i < out.length; i += 1) {
    const base = ratingBlend(out[i].score, out[i].rel);
    out[i].vsBase = base;
    if (base == null) continue;
    teamAvg += base;
    teamN += 1;
  }
  teamAvg = teamN ? teamAvg / teamN : null;
  for (let i = 0; i < out.length; i += 1) {
    out[i].vs = vsTeamScore(out[i].vsBase, teamAvg);
  }
  if (rosterSort === "role") {
    out.sort(function (a, b) {
      const diff = (a.roleOrd - b.roleOrd) * rosterDir;
      if (diff) return diff;
      return (b.recent - a.recent) || (b.games - a.games);
    });
    return out;
  }
  return sortRows(out, rosterSort, rosterDir);
}

function rosterTrueScore(roster) {
  let num = 0;
  let den = 0;
  for (let i = 0; i < roster.length; i += 1) {
    if (roster[i].vs == null || !isFinite(roster[i].vs)) continue;
    const w = roster[i].games || 0;
    if (w <= 0) continue;
    num += roster[i].vs * w;
    den += w;
  }
  if (!den) return null;
  return num / den;
}

function simpleStrip(ids) {
  const wrap = document.createElement("div");
  wrap.className = "champ-strip";
  for (let i = 0; i < ids.length; i += 1) {
    const img = document.createElement("img");
    img.src = portrait(ids[i]);
    img.alt = champName(ids[i]);
    img.title = champName(ids[i]);
    wrap.append(img);
  }
  if (!ids.length) wrap.textContent = "—";
  return wrap;
}

function openPlayer(name) {
  location.href =
    "player.html?player=" +
    encodeURIComponent(name) +
    "&league=" +
    encodeURIComponent(formatSel(leagues)) +
    "&window=" +
    encodeURIComponent(windowParam()) +
    "&patch=" +
    encodeURIComponent(formatSel(patches));
}

function renderTeamDirectory() {
  teamEls.layout.classList.add("is-directory");
  teamEls.layout.classList.remove("is-team");
  teamEls.summary.hidden = true;
  teamEls.side.hidden = true;
  teamEls.boardTitle.textContent = "Teams";
  teamEls.title.textContent = !leagues.length ? "Teams" : leagues.join(" · ");
  document.title = "Teams — Whisper Draft";
  const rows = teamDirectory();
  teamEls.range.textContent = rows.length.toLocaleString() + " teams";
  if (dirSort === "draft") {
    dirSort = "vs";
    dirDir = -1;
  }
  setHead(
    teamEls.head,
    [
      { key: "name", label: "Team" },
      { key: "vs", label: "True score", num: true },
      { key: "score", label: "Score", num: true },
      { key: "league", label: "League" },
      { key: "champ", label: "Pool" },
      { key: "games", label: "Games", num: true },
      { key: "winRate", label: "WR", num: true },
      { key: "gd15", label: "GD@15", num: true },
      { key: "fb", label: "First blood", num: true },
      { key: "ft", label: "First tower", num: true },
      { key: "fd", label: "First dragon", num: true },
      { key: "kda", label: "KDA", num: true },
    ],
    dirSort,
    dirDir,
    function (key) {
      if (dirSort === key) dirDir *= -1;
      else {
        dirSort = key;
        dirDir = key === "name" || key === "league" ? 1 : -1;
      }
      renderTeam();
    }
  );
  if (!rows.length) {
    emptyRow(teamEls.body, 12, "No teams match that filter.");
    return;
  }
  teamEls.body.innerHTML = "";
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    const tr = document.createElement("tr");
    tr.addEventListener("click", function () {
      team = row.name;
      search = "";
      if (teamEls.search) teamEls.search.value = "";
      teamSyncUrl();
      renderTeam();
    });
    const name = document.createElement("td");
    name.textContent = row.name;
    const vs = document.createElement("td");
    vs.className = "num " + scoreTone(row.vs);
    vs.textContent = fmtScore(row.vs);
    vs.title = "Games-weighted roster True score";
    const score = document.createElement("td");
    score.className = "num " + scoreTone(row.score);
    score.textContent = fmtScore(row.score);
    const leagueCell = document.createElement("td");
    leagueCell.textContent = row.league || "—";
    const pool = document.createElement("td");
    pool.append(simpleStrip(row.champs));
    const games = document.createElement("td");
    games.className = "num";
    games.textContent = row.games.toLocaleString();
    const wr = document.createElement("td");
    wr.className = "num " + (row.winRate >= 0.5 ? "wr-up" : "wr-down");
    wr.textContent = fmtPct(row.winRate);
    const gd = document.createElement("td");
    gd.className = "num " + (row.gd15 > 0 ? "wr-up" : row.gd15 < 0 ? "wr-down" : "");
    gd.textContent = row.gd15 == null ? "—" : fmtDiff(row.gd15);
    const fb = document.createElement("td");
    fb.className = "num " + (row.fb >= 0.5 ? "wr-up" : row.fb != null ? "wr-down" : "");
    fb.textContent = fmtPct(row.fb);
    const ft = document.createElement("td");
    ft.className = "num " + (row.ft >= 0.5 ? "wr-up" : row.ft != null ? "wr-down" : "");
    ft.textContent = fmtPct(row.ft);
    const fd = document.createElement("td");
    fd.className = "num " + (row.fd >= 0.5 ? "wr-up" : row.fd != null ? "wr-down" : "");
    fd.textContent = fmtPct(row.fd);
    const kda = document.createElement("td");
    kda.className = "num";
    kda.textContent = fmtRate(row.kda);
    tr.append(name, vs, score, leagueCell, pool, games, wr, gd, fb, ft, fd, kda);
    teamEls.body.append(tr);
  }
}

function renderTeamDetail() {
  const map = collectTeams();
  const rec = map[team];
  if (!rec) {
    team = "";
    teamSyncUrl();
    renderTeamDirectory();
    return;
  }
  teamEls.layout.classList.remove("is-directory");
  teamEls.layout.classList.add("is-team");
  const n = rec.games.length;
  const roster = rosterRows(rec);
  const score = teamScore(rec.name, rec.games);
  const trueScore = rosterTrueScore(roster);
  const dir = teamDirectory();
  let draftRec = null;
  let draftScore = null;
  for (let i = 0; i < dir.length; i += 1) {
    if (dir[i].name !== rec.name) continue;
    draftRec = dir[i].draftRec;
    draftScore = dir[i].draft;
    break;
  }
  const wr = n ? rec.wins / n : 0;
  teamEls.title.textContent = rec.name;
  document.title = rec.name + " — Team stats";
  teamEls.range.textContent = n.toLocaleString() + " games";
  teamEls.summary.hidden = false;
  teamEls.summary.innerHTML = "";
  teamEls.summary.append(tile("League", mostCommon(rec.leagues) || "—"));
  teamEls.summary.append(tile("True score", fmtScore(trueScore), scoreTone(trueScore)));
  teamEls.summary.append(tile("Score", fmtScore(score), scoreTone(score)));
  const draftTile = tile("Drafting score", fmtScore(draftScore), scoreTone(draftScore));
  draftTile.title = draftTip(draftRec);
  teamEls.summary.append(draftTile);
  teamEls.summary.append(tile("Games", n.toLocaleString()));
  teamEls.summary.append(tile("WR", fmtPct(wr), wr >= 0.5 ? "up" : "down"));
  teamEls.summary.append(tile("KDA", fmtRate(kdaRatio(rec.k, rec.d, rec.a))));
  teamEls.summary.append(tile("GD@15", fmtDiff(rec.gdN ? rec.gd / rec.gdN : 0), rec.gd > 0 ? "up" : rec.gd < 0 ? "down" : ""));
  const fb = firstRate(rec.fb, rec.fbN);
  const ft = firstRate(rec.ft, rec.ftN);
  const fd = firstRate(rec.fd, rec.fdN);
  teamEls.summary.append(tile("First blood", fmtPct(fb), fb >= 0.5 ? "up" : fb != null ? "down" : ""));
  teamEls.summary.append(tile("First tower", fmtPct(ft), ft >= 0.5 ? "up" : ft != null ? "down" : ""));
  teamEls.summary.append(tile("First dragon", fmtPct(fd), fd >= 0.5 ? "up" : fd != null ? "down" : ""));

  teamEls.boardTitle.textContent = "Roster";
  setHead(
    teamEls.head,
    [
      { key: "name", label: "Player" },
      { key: "role", label: "Role" },
      { key: "vs", label: "True score", num: true },
      { key: "score", label: "Score", num: true },
      { key: "rel", label: "Mastery", num: true },
      { key: "games", label: "Games", num: true },
      { key: "winRate", label: "WR", num: true },
      { key: "kda", label: "KDA", num: true },
      { key: "champ", label: "Pool" },
    ],
    rosterSort,
    rosterDir,
    function (key) {
      if (rosterSort === key) rosterDir *= -1;
      else {
        rosterSort = key;
        rosterDir = key === "name" || key === "role" ? 1 : -1;
      }
      renderTeam();
    }
  );
  teamEls.body.innerHTML = "";
  if (!roster.length) {
    emptyRow(teamEls.body, 9, "No players in this window.");
  } else {
    for (let i = 0; i < roster.length; i += 1) {
      const row = roster[i];
      const tr = document.createElement("tr");
      tr.addEventListener("click", function () {
        openPlayer(row.name);
      });
      const name = document.createElement("td");
      name.textContent = row.name;
      const roleCell = document.createElement("td");
      roleCell.className = "pro-role";
      roleCell.textContent = (row.role || "").toUpperCase();
      const scoreCell = document.createElement("td");
      scoreCell.className = "num " + scoreTone(row.score);
      scoreCell.textContent = fmtScore(row.score);
      scoreCell.title = "Current player score";
      const relCell = document.createElement("td");
      relCell.className = "num " + scoreTone(row.rel);
      relCell.textContent = fmtScore(row.rel);
      relCell.title = "Games-weighted average of champion-relative scores";
      const vsCell = document.createElement("td");
      vsCell.className = "num " + scoreTone(row.vs);
      vsCell.textContent = fmtScore(row.vs);
      vsCell.title = "Average of Score and Mastery vs team average — above teammates inflates, below deflates";
      const games = document.createElement("td");
      games.className = "num";
      games.textContent = String(row.games);
      const wrCell = document.createElement("td");
      wrCell.className = "num " + (row.winRate >= 0.5 ? "wr-up" : "wr-down");
      wrCell.textContent = fmtPct(row.winRate);
      const kda = document.createElement("td");
      kda.className = "num";
      kda.textContent = fmtRate(row.kda);
      const pool = document.createElement("td");
      pool.append(simpleStrip(row.champs));
      tr.append(name, roleCell, vsCell, scoreCell, relCell, games, wrCell, kda, pool);
      teamEls.body.append(tr);
    }
  }

  const shown = rec.games || [];
  teamEls.side.hidden = false;
  teamEls.gamesSub.textContent = shown.length + " games";
  teamEls.gamesBody.innerHTML = "";
  for (let i = 0; i < shown.length; i += 1) {
    const game = shown[i];
    const mine = sideOf(game, rec.name);
    const win = mine === "b" ? game.w === 1 : game.w === 0;
    const vs = mine === "b" ? game.rt : game.bt;
    const picks = mine === "b" ? game.b : game.r;
    const tr = document.createElement("tr");
    tr.addEventListener("click", function () {
      location.href =
        "match.html?g=" +
        encodeURIComponent(game.g) +
        "&from=" +
        encodeURIComponent(
          "team.html?team=" +
            encodeURIComponent(rec.name) +
            "&league=" +
            encodeURIComponent(formatSel(leagues)) +
            "&window=" +
            encodeURIComponent(windowParam()) +
            "&patch=" +
            encodeURIComponent(formatSel(patches))
        );
    });
    const date = document.createElement("td");
    date.textContent = (game.d || "").slice(5);
    const vsCell = document.createElement("td");
    vsCell.textContent = vs || "—";
    const pickCell = document.createElement("td");
    pickCell.append(simpleStrip(picks || []));
    const result = document.createElement("td");
    result.className = "num " + (win ? "wr-up" : "wr-down");
    result.textContent = win ? "W" : "L";
    tr.append(date, vsCell, pickCell, result);
    teamEls.gamesBody.append(tr);
  }
}

function renderTeam() {
  teamChips();
  if (!team) {
    renderTeamDirectory();
    return;
  }
  renderTeamDetail();
}

function bootTeam() {
  try {
    initData();
    if (teamEls.search) {
      teamEls.search.addEventListener("input", function () {
        search = teamEls.search.value;
        if (team && search) {
          team = "";
          teamSyncUrl();
        }
        renderTeam();
      });
    }
    renderTeam();
    teamEls.boot.classList.add("is-hidden");
    teamEls.boot.hidden = true;
    teamEls.app.hidden = false;
    teamEls.boot.remove();
    teamEls.search.focus();
  } catch (error) {
    if (teamEls.bootStatus) teamEls.bootStatus.textContent = error.message;
  }
}

bootTeam();
