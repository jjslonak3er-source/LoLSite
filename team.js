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

const DEFAULT_DAYS = 60;
let team = params.get("team") || "";
let rosterSort = "role";
let rosterDir = 1;
let recentDays = DEFAULT_DAYS;
let daysTimer = 0;

function windowParam() {
  return windowKey === "season" ? "season" : String(recentDays);
}

function applyWindowParam(raw) {
  if (raw === "season") {
    windowKey = "season";
    return;
  }
  const n = parseInt(raw, 10);
  if (n > 0) {
    windowKey = "recent";
    recentDays = Math.min(365, n);
    return;
  }
  windowKey = "recent";
  recentDays = DEFAULT_DAYS;
}

applyWindowParam(params.get("window"));

function cutoffDate() {
  if (windowKey !== "recent" || !bundle.to) return "";
  return addDays(bundle.to, -recentDays);
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

function setDaysWindow(raw) {
  const n = parseInt(raw, 10);
  if (!n || n < 1) return;
  recentDays = Math.min(365, n);
  windowKey = "recent";
  teamSyncUrl();
  renderTeam();
}

function syncWindowControls() {
  const wrap = teamEls.windows.querySelector(".window-days");
  const input = wrap && wrap.querySelector("input");
  const season = teamEls.windows.querySelector("[data-window='season']");
  if (wrap) wrap.classList.toggle("active", windowKey === "recent");
  if (season) season.classList.toggle("active", windowKey === "season");
  if (input && document.activeElement !== input) input.value = String(recentDays);
}

function teamWindowRow() {
  if (teamEls.windows.dataset.ready === "1") {
    syncWindowControls();
    return;
  }
  teamEls.windows.innerHTML = "";
  const wrap = document.createElement("label");
  wrap.className = "window-days";
  wrap.append("Last");
  const input = document.createElement("input");
  input.type = "number";
  input.min = "1";
  input.max = "365";
  input.step = "1";
  input.value = String(recentDays);
  input.setAttribute("aria-label", "Last days");
  input.addEventListener("focus", function () {
    windowKey = "recent";
    syncWindowControls();
  });
  input.addEventListener("input", function () {
    windowKey = "recent";
    syncWindowControls();
    clearTimeout(daysTimer);
    daysTimer = setTimeout(function () {
      setDaysWindow(input.value);
    }, 350);
  });
  input.addEventListener("change", function () {
    clearTimeout(daysTimer);
    setDaysWindow(input.value);
  });
  wrap.append(input, "days");
  const season = document.createElement("button");
  season.type = "button";
  season.dataset.window = "season";
  season.textContent = "Full season";
  season.addEventListener("click", function () {
    clearTimeout(daysTimer);
    windowKey = "season";
    teamSyncUrl();
    renderTeam();
  });
  teamEls.windows.append(wrap, season);
  teamEls.windows.dataset.ready = "1";
  syncWindowControls();
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

function teamDirectory() {
  const q = (search || "").trim().toLowerCase();
  const map = collectTeams();
  const out = [];
  const names = Object.keys(map);
  for (let i = 0; i < names.length; i += 1) {
    const rec = map[names[i]];
    if (q && rec.name.toLowerCase().indexOf(q) === -1) continue;
    const n = rec.games.length;
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
      rec: rec,
    });
  }
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
    });
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
  teamEls.summary.hidden = true;
  teamEls.side.hidden = true;
  teamEls.boardTitle.textContent = "Teams";
  teamEls.title.textContent = !leagues.length ? "Teams" : leagues.join(" · ");
  document.title = "Teams — Whisper Draft";
  const rows = teamDirectory();
  teamEls.range.textContent = rows.length.toLocaleString() + " teams";
  setHead(
    teamEls.head,
    [
      { key: "name", label: "Team" },
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
    emptyRow(teamEls.body, 11, "No teams match that filter.");
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
    tr.append(name, score, leagueCell, pool, games, wr, gd, fb, ft, fd, kda);
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
  const n = rec.games.length;
  const score = teamScore(rec.name, rec.games);
  const wr = n ? rec.wins / n : 0;
  teamEls.title.textContent = rec.name;
  document.title = rec.name + " — Team stats";
  teamEls.range.textContent = n.toLocaleString() + " games";
  teamEls.summary.hidden = false;
  teamEls.summary.innerHTML = "";
  teamEls.summary.append(tile("League", mostCommon(rec.leagues) || "—"));
  teamEls.summary.append(tile("Score", fmtScore(score), scoreTone(score)));
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

  const roster = rosterRows(rec);
  teamEls.boardTitle.textContent = "Roster";
  setHead(
    teamEls.head,
    [
      { key: "name", label: "Player" },
      { key: "role", label: "Role" },
      { key: "score", label: "Score", num: true },
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
    emptyRow(teamEls.body, 7, "No players in this window.");
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
      tr.append(name, roleCell, scoreCell, games, wrCell, kda, pool);
      teamEls.body.append(tr);
    }
  }

  const shown = rec.games.slice(0, 40);
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
