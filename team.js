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
  views: document.getElementById("team-views"),
  sides: document.getElementById("team-sides"),
  summary: document.getElementById("team-summary"),
  boardTitle: document.getElementById("team-board-title"),
  rosterView: document.getElementById("team-roster-view"),
  identityView: document.getElementById("team-identity-view"),
  identityBody: document.getElementById("team-identity-body"),
  head: document.getElementById("team-head"),
  body: document.getElementById("team-body"),
  side: document.getElementById("team-side"),
  gamesSub: document.getElementById("team-games-sub"),
  gamesBody: document.getElementById("team-games-body"),
  layout: document.querySelector(".player-layout"),
};

let team = params.get("team") || "";
let teamView = params.get("view") === "identity" ? "identity" : "roster";
let teamPick = (params.get("pick") || "").toLowerCase();
if (teamPick !== "first" && teamPick !== "second") teamPick = "all";
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
  if (teamPick === "first" || teamPick === "second") url.searchParams.set("pick", teamPick);
  else url.searchParams.delete("pick");
  url.searchParams.delete("side");
  if (team && teamView === "identity") url.searchParams.set("view", "identity");
  else url.searchParams.delete("view");
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
  if (teamEls.sides) {
    const pickLabel = teamPick === "first" ? "First pick" : teamPick === "second" ? "Second pick" : "All";
    chipRow(teamEls.sides, ["All", "First pick", "Second pick"], pickLabel, function (name) {
      teamPick = name === "First pick" ? "first" : name === "Second pick" ? "second" : "all";
      teamSyncUrl();
      renderTeam();
    });
  }
  if (teamEls.views) {
    teamEls.views.hidden = !team;
    if (team) {
      chipRow(teamEls.views, ["Roster", "Team identity"], teamView === "identity" ? "Team identity" : "Roster", function (name) {
        teamView = name === "Team identity" ? "identity" : "roster";
        teamSyncUrl();
        renderTeam();
      });
    }
  }
}

function pickWanted(game, sideKey) {
  if (teamPick === "all") return true;
  const first = hadFirstPick(game, sideKey);
  if (first == null) return false;
  return teamPick === "first" ? first : !first;
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

function showTeamView(which) {
  const identity = which === "identity";
  if (teamEls.rosterView) teamEls.rosterView.hidden = identity;
  if (teamEls.identityView) teamEls.identityView.hidden = !identity;
}

function hadFirstPick(game, side) {
  const fp = game.x && game.x.fp;
  if (fp !== 0 && fp !== 1) return null;
  return (side === "b") === (fp === 1);
}

function teamIdentity(teamName, games) {
  const roles = [{}, {}, {}, {}, {}];
  const roleWins = [{}, {}, {}, {}, {}];
  const order = [{}, {}, {}, {}, {}];
  const orderWins = [{}, {}, {}, {}, {}];
  const orderRoles = [{}, {}, {}, {}, {}];
  const orderChampRoles = [{}, {}, {}, {}, {}];
  const bans = {};
  const enemyBans = {};
  let orderN = 0;
  let n = 0;
  for (let i = 0; i < (games || []).length; i += 1) {
    const game = games[i];
    const side = sideOf(game, teamName);
    if (!side) continue;
    n += 1;
    const win = side === "b" ? game.w === 1 : game.w === 0;
    const champs = side === "b" ? game.b : game.r;
    for (let r = 0; r < 5; r += 1) {
      const id = champs && champs[r];
      if (!id) continue;
      roles[r][id] = (roles[r][id] || 0) + 1;
      if (win) roleWins[r][id] = (roleWins[r][id] || 0) + 1;
    }
    const draft = side === "b" ? game.bpk : game.rpk;
    if (draft && draft.length) {
      let used = false;
      for (let s = 0; s < 5; s += 1) {
        const id = draft[s];
        if (!id) continue;
        used = true;
        order[s][id] = (order[s][id] || 0) + 1;
        if (win) orderWins[s][id] = (orderWins[s][id] || 0) + 1;
        const ri = champs ? champs.indexOf(id) : -1;
        if (ri >= 0) {
          const role = ROLE_KEYS[ri];
          orderRoles[s][role] = (orderRoles[s][role] || 0) + 1;
          const byChamp = orderChampRoles[s][id] || (orderChampRoles[s][id] = {});
          byChamp[role] = (byChamp[role] || 0) + 1;
        }
      }
      if (used) orderN += 1;
    }
    const mine = sideBans(game, side);
    for (let b = 0; b < mine.length; b += 1) {
      if (!mine[b]) continue;
      bans[mine[b]] = (bans[mine[b]] || 0) + 1;
    }
    const theirs = sideBans(game, side === "b" ? "r" : "b");
    for (let b = 0; b < theirs.length; b += 1) {
      if (!theirs[b]) continue;
      enemyBans[theirs[b]] = (enemyBans[theirs[b]] || 0) + 1;
    }
  }
  return {
    roles: roles,
    roleWins: roleWins,
    order: order,
    orderWins: orderWins,
    orderRoles: orderRoles,
    orderChampRoles: orderChampRoles,
    orderN: orderN,
    n: n,
    bans: bans,
    enemyBans: enemyBans,
  };
}

function identityTable(title, headers, rows) {
  const sig = document.createElement("div");
  sig.className = "team-identity-block";
  const sigHead = document.createElement("h5");
  sigHead.textContent = title;
  const wrap = document.createElement("div");
  wrap.className = "pro-table-wrap";
  const table = document.createElement("table");
  table.className = "pro-table";
  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  for (let i = 0; i < headers.length; i += 1) {
    const th = document.createElement("th");
    th.textContent = headers[i].label;
    if (headers[i].num) th.className = "sort-num";
    headRow.append(th);
  }
  thead.append(headRow);
  const tbody = document.createElement("tbody");
  for (let i = 0; i < rows.length; i += 1) tbody.append(rows[i]);
  table.append(thead, tbody);
  wrap.append(table);
  sig.append(sigHead, wrap);
  return sig;
}

function identityChampRow(label, counts, wins, extra) {
  const ids = topKeys(counts, 5);
  const top = ids[0];
  const games = top ? counts[top] : 0;
  const winsN = top ? wins[top] || 0 : 0;
  const wr = games ? winsN / games : null;
  const tr = document.createElement("tr");
  const labelCell = document.createElement("td");
  labelCell.className = "pro-role";
  const lab = document.createElement("span");
  lab.className = "identity-row-label";
  lab.textContent = label;
  labelCell.append(lab);
  const pool = document.createElement("td");
  pool.append(simpleStrip(ids));
  const topCell = document.createElement("td");
  topCell.textContent = top ? champName(top) : "—";
  tr.append(labelCell, pool, topCell);
  if (extra) tr.append(extra);
  const gamesCell = document.createElement("td");
  gamesCell.className = "num";
  gamesCell.textContent = top ? String(games) : "—";
  const wrCell = document.createElement("td");
  wrCell.className = "num " + (wr >= 0.5 ? "wr-up" : wr != null ? "wr-down" : "");
  wrCell.textContent = fmtPct(wr);
  tr.append(gamesCell, wrCell);
  return tr;
}

function countTotal(counts) {
  const ids = Object.keys(counts || {});
  let n = 0;
  for (let i = 0; i < ids.length; i += 1) n += counts[ids[i]] || 0;
  return n;
}

function identityDetailTable(counts, wins, rolesByChamp, available) {
  counts = counts || {};
  wins = wins || {};
  available = available || {};
  const total = countTotal(counts);
  const rows = [];
  const ids = Object.keys(counts);
  for (let i = 0; i < ids.length; i += 1) {
    const id = ids[i];
    const games = counts[id] || 0;
    if (!games) continue;
    const open = available[id] || 0;
    const role = rolesByChamp ? mostCommon(rolesByChamp[id] || {}) || "" : "";
    rows.push({
      id: id,
      name: champName(id),
      role: role ? role.toUpperCase() : "—",
      roleOrd: role ? roleOrder(role) : 99,
      games: games,
      wr: (wins[id] || 0) / games,
      share: total ? games / total : null,
      presence: open ? games / open : null,
      open: open,
    });
  }

  const table = document.createElement("table");
  table.className = "pro-table identity-nested";
  const thead = document.createElement("thead");
  const tbody = document.createElement("tbody");
  table.append(thead, tbody);
  table.addEventListener("click", function (event) {
    event.stopPropagation();
  });
  const cols = rolesByChamp
    ? [
        { key: "name", label: "Champ" },
        { key: "roleOrd", label: "Role" },
        { key: "games", label: "Games", num: true },
        { key: "wr", label: "WR", num: true },
        { key: "share", label: "Share", num: true },
        { key: "presence", label: "Presence", num: true },
      ]
    : [
        { key: "name", label: "Champ" },
        { key: "games", label: "Games", num: true },
        { key: "wr", label: "WR", num: true },
        { key: "share", label: "Share", num: true },
        { key: "presence", label: "Presence", num: true },
      ];
  let sortKey = "games";
  let sortDir = -1;

  function paint() {
    setHead(thead, cols, sortKey, sortDir, function (key) {
      if (sortKey === key) sortDir *= -1;
      else {
        sortKey = key;
        sortDir = key === "name" || key === "roleOrd" ? 1 : -1;
      }
      paint();
    });
    tbody.innerHTML = "";
    if (!rows.length) {
      emptyRow(tbody, cols.length, "No picks in this slice.");
      return;
    }
    const shown = sortRows(rows.slice(), sortKey, sortDir);
    for (let i = 0; i < shown.length; i += 1) {
      const row = shown[i];
      const tr = document.createElement("tr");
      const champ = document.createElement("td");
      champ.append(champCell(row.id));
      tr.append(champ);
      if (rolesByChamp) {
        const roleCell = document.createElement("td");
        roleCell.className = "pro-role";
        roleCell.textContent = row.role;
        tr.append(roleCell);
      }
      const gamesCell = document.createElement("td");
      gamesCell.className = "num";
      gamesCell.textContent = String(row.games);
      const wrCell = document.createElement("td");
      wrCell.className = "num " + (row.wr >= 0.5 ? "wr-up" : "wr-down");
      wrCell.textContent = fmtPct(row.wr);
      const shareCell = document.createElement("td");
      shareCell.className = "num";
      shareCell.textContent = fmtPct(row.share);
      const presCell = document.createElement("td");
      presCell.className = "num";
      presCell.textContent = fmtPct(row.presence);
      presCell.title =
        "Picked in " +
        row.games +
        " of " +
        row.open +
        " games where it was still available (not banned by either team before this pick)";
      tr.append(gamesCell, wrCell, shareCell, presCell);
      tbody.append(tr);
    }
  }

  paint();
  return table;
}

function champAvailableAtSlot(game, champId, slot) {
  const n = slot < 3 ? 3 : 5;
  const bb = game.bb || [];
  const rb = game.rb || [];
  for (let i = 0; i < n; i += 1) {
    if (bb[i] === champId || rb[i] === champId) return false;
  }
  return true;
}

function roleDraftSlot(game, side, roleIndex) {
  const champs = side === "b" ? game.b : game.r;
  const draft = side === "b" ? game.bpk : game.rpk;
  const id = champs && champs[roleIndex];
  if (!id || !draft) return 4;
  const s = draft.indexOf(id);
  return s >= 0 ? s : 4;
}

function identityAvailable(games, teamName, champIds, slots, roleIndex) {
  const avail = {};
  for (let i = 0; i < champIds.length; i += 1) avail[champIds[i]] = 0;
  if (!champIds.length) return avail;
  for (let g = 0; g < (games || []).length; g += 1) {
    const game = games[g];
    const side = sideOf(game, teamName);
    if (!side) continue;
    const slot = slots ? Math.min.apply(null, slots) : roleDraftSlot(game, side, roleIndex);
    for (let i = 0; i < champIds.length; i += 1) {
      const id = champIds[i];
      if (champAvailableAtSlot(game, id, slot)) avail[id] += 1;
    }
  }
  return avail;
}

function addCountMap(into, from) {
  const keys = Object.keys(from || {});
  for (let i = 0; i < keys.length; i += 1) {
    const key = keys[i];
    into[key] = (into[key] || 0) + (from[key] || 0);
  }
}

function mergeSlotStats(stats, slots) {
  const counts = {};
  const wins = {};
  const roles = {};
  const champRoles = {};
  for (let i = 0; i < slots.length; i += 1) {
    const s = slots[i];
    addCountMap(counts, stats.order[s]);
    addCountMap(wins, stats.orderWins[s]);
    addCountMap(roles, stats.orderRoles[s]);
    const byChamp = stats.orderChampRoles[s] || {};
    const ids = Object.keys(byChamp);
    for (let j = 0; j < ids.length; j += 1) {
      const id = ids[j];
      champRoles[id] = champRoles[id] || {};
      addCountMap(champRoles[id], byChamp[id]);
    }
  }
  return { counts: counts, wins: wins, roles: roles, champRoles: champRoles };
}

function pickOrderGroups() {
  if (teamPick === "first") {
    return [
      { label: "Pick 1", slots: [0] },
      { label: "Picks 2–3", slots: [1, 2] },
      { label: "Picks 4–5", slots: [3, 4] },
    ];
  }
  if (teamPick === "second") {
    return [
      { label: "Picks 1–2", slots: [0, 1] },
      { label: "Pick 3", slots: [2] },
      { label: "Pick 4", slots: [3] },
      { label: "Pick 5", slots: [4] },
    ];
  }
  return [
    { label: "Pick 1", slots: [0] },
    { label: "Pick 2", slots: [1] },
    { label: "Pick 3", slots: [2] },
    { label: "Pick 4", slots: [3] },
    { label: "Pick 5", slots: [4] },
  ];
}

function identityExpandable(label, counts, wins, extra, colSpan, rolesByChamp, available) {
  const frag = document.createDocumentFragment();
  const summary = identityChampRow(label, counts, wins, extra);
  const ids = Object.keys(counts || {});
  if (!ids.length) {
    frag.append(summary);
    return frag;
  }
  summary.classList.add("identity-toggle");
  const caret = document.createElement("button");
  caret.type = "button";
  caret.className = "identity-caret";
  caret.textContent = "▸";
  caret.setAttribute("aria-label", "Show " + label + " picks");
  summary.firstChild.insertBefore(caret, summary.firstChild.firstChild);
  summary.setAttribute("aria-expanded", "false");
  const detail = document.createElement("tr");
  detail.className = "identity-detail";
  detail.hidden = true;
  const td = document.createElement("td");
  td.colSpan = colSpan;
  td.append(identityDetailTable(counts, wins, rolesByChamp, available));
  detail.append(td);
  function toggle(event) {
    event.preventDefault();
    event.stopPropagation();
    const open = detail.hidden;
    detail.hidden = !open;
    summary.classList.toggle("is-open", open);
    summary.setAttribute("aria-expanded", open ? "true" : "false");
    caret.setAttribute("aria-label", (open ? "Hide " : "Show ") + label + " picks");
  }
  summary.addEventListener("click", toggle);
  caret.addEventListener("click", toggle);
  frag.append(summary, detail);
  return frag;
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
      if (!pickWanted(game, side.key)) continue;
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
    forced: 0,
    forcedThreat: 0,
    forcedDeny: 0,
    forcedMastery: 0,
  };
  let weights = null;
  for (let i = 0; i < (games || []).length; i += 1) {
    const game = games[i];
    const mine = sideOf(game, teamName);
    if (!mine) continue;
    const rec = predict.draftQuality(
      sideLineup(game, mine),
      sideLineup(game, mine === "b" ? "r" : "b"),
      sideBans(game, mine),
      sideBans(game, mine === "b" ? "r" : "b")
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
    parts.forced += rec.forced;
    parts.forcedThreat += rec.forcedThreat;
    parts.forcedDeny += rec.forcedDeny;
    parts.forcedMastery += rec.forcedMastery;
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
    forced: parts.forced / den,
    forcedThreat: parts.forcedThreat / den,
    forcedDeny: parts.forcedDeny / den,
    forcedMastery: parts.forcedMastery / den,
    n: den,
    weights: weights,
  };
}

function draftTip(rec) {
  if (!rec) {
    return "How well this team drafts vs other teams in this filter. Counters and pairings ×2. Bans score denied threats, enemy pairings, and enemy mastery. Forced bans score when opponents take away this team's threats, pairings, and mastery.";
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
    ") · forced " +
    fmtScore(rec.forced) +
    " ×" +
    Number(w.forced || 1).toFixed(2) +
    " (threat " +
    fmtScore(rec.forcedThreat) +
    " · deny " +
    fmtScore(rec.forcedDeny) +
    " · mastery " +
    fmtScore(rec.forcedMastery) +
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
    "forced",
    "forcedThreat",
    "forcedDeny",
    "forcedMastery",
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
      vs: ratingVsTeam(player.name, role, rec.name),
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
  showTeamView("roster");
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

  if (teamView === "identity") renderTeamIdentity(rec);
  else renderTeamRoster(rec, roster);

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
            encodeURIComponent(formatSel(patches)) +
            (teamPick === "first" || teamPick === "second" ? "&pick=" + teamPick : "") +
            (teamView === "identity" ? "&view=identity" : "")
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

function renderTeamRoster(rec, roster) {
  showTeamView("roster");
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
    return;
  }
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

function renderTeamIdentity(rec) {
  showTeamView("identity");
  const stats = teamIdentity(rec.name, rec.games);
  const body = teamEls.identityBody;
  body.innerHTML = "";
  if (!rec.games.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "No games in this window.";
    body.append(empty);
    return;
  }

  if (stats.orderN) {
    const orderRows = [];
    const groups = pickOrderGroups();
    for (let i = 0; i < groups.length; i += 1) {
      const group = groups[i];
      const merged = mergeSlotStats(stats, group.slots);
      const roleCell = document.createElement("td");
      roleCell.className = "pro-role";
      roleCell.textContent = (mostCommon(merged.roles) || "—").toUpperCase();
      orderRows.push(
        identityExpandable(
          group.label,
          merged.counts,
          merged.wins,
          roleCell,
          6,
          merged.champRoles,
          identityAvailable(rec.games, rec.name, Object.keys(merged.counts), group.slots)
        )
      );
    }
    body.append(
      identityTable(
        "Pick order",
        [
          { label: "Pick" },
          { label: "Pool" },
          { label: "Top pick" },
          { label: "Role" },
          { label: "Games", num: true },
          { label: "WR", num: true },
        ],
        orderRows
      )
    );
  }

  const sigRows = [];
  for (let r = 0; r < ROLE_KEYS.length; r += 1) {
    sigRows.push(
      identityExpandable(
        ROLE_KEYS[r].toUpperCase(),
        stats.roles[r],
        stats.roleWins[r],
        null,
        5,
        null,
        identityAvailable(rec.games, rec.name, Object.keys(stats.roles[r]), null, r)
      )
    );
  }
  body.append(
    identityTable(
      "Signature picks",
      [
        { label: "Role" },
        { label: "Pool" },
        { label: "Top pick" },
        { label: "Games", num: true },
        { label: "WR", num: true },
      ],
      sigRows
    )
  );

  const banBlock = document.createElement("div");
  banBlock.className = "team-identity-block";
  const banHead = document.createElement("h5");
  banHead.textContent = "Ban identity";
  const weBan = document.createElement("p");
  weBan.className = "muted identity-ban-label";
  weBan.textContent = rec.name + " ban";
  const vsBan = document.createElement("p");
  vsBan.className = "muted identity-ban-label";
  vsBan.textContent = "Banned against " + rec.name;
  banBlock.append(banHead, weBan, simpleStrip(topKeys(stats.bans, 8)), vsBan, simpleStrip(topKeys(stats.enemyBans, 8)));
  body.append(banBlock);
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
