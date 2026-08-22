const DDRAGON = "https://ddragon.leagueoflegends.com";
const LEAGUES = ["All", "LPL", "LCK", "LEC", "LCS"];
const RECENT_DAYS = 60;
const ROLE_KEYS = ["TOP", "JNG", "MID", "ADC", "SUP"];

const els = {
  boot: document.getElementById("boot"),
  bootStatus: document.getElementById("boot-status"),
  app: document.getElementById("app"),
  title: document.getElementById("matches-title"),
  range: document.getElementById("matches-range"),
  search: document.getElementById("matches-search"),
  champs: document.getElementById("matches-champs"),
  champMenu: document.getElementById("matches-champ-menu"),
  champChips: document.getElementById("matches-champ-chips"),
  leagues: document.getElementById("matches-leagues"),
  windows: document.getElementById("matches-windows"),
  patches: document.getElementById("matches-patches"),
  acc: document.getElementById("matches-acc"),
  body: document.getElementById("matches-body"),
};

let bundle = { games: [] };
let search = "";
let league = "All";
let windowKey = "recent";
let gamePatch = "All";
let champFilters = [];
let patch = "";
let champMap = new Map();
const predictCache = {};

function portrait(id) {
  return DDRAGON + "/cdn/" + patch + "/img/champion/" + id + ".png";
}

function champName(id) {
  return (champMap.get(id) && champMap.get(id).name) || id || "";
}

function champSlug(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function parseChamps(raw) {
  if (!raw) return [];
  return raw.split(",").map(function (part) {
    return part.trim();
  }).filter(function (id) {
    return champMap.has(id);
  });
}

function gameHasChamps(game) {
  if (!champFilters.length) return true;
  const pool = (game.b || []).concat(game.r || []);
  for (let i = 0; i < champFilters.length; i += 1) {
    if (pool.indexOf(champFilters[i]) === -1) return false;
  }
  return true;
}

function toggleChamp(id) {
  if (!id || !champMap.has(id)) return;
  const next = [];
  let found = false;
  for (let i = 0; i < champFilters.length; i += 1) {
    if (champFilters[i] === id) found = true;
    else next.push(champFilters[i]);
  }
  if (!found) next.push(id);
  champFilters = next;
}

function searchChamps(q) {
  const slug = champSlug(q);
  if (!slug) return [];
  const out = [];
  champMap.forEach(function (champ, id) {
    if (champFilters.indexOf(id) !== -1) return;
    if (champSlug(id).indexOf(slug) === -1 && champSlug(champ.name).indexOf(slug) === -1) return;
    out.push(id);
  });
  out.sort(function (a, b) {
    const an = champSlug(champName(a));
    const bn = champSlug(champName(b));
    const as = an.indexOf(slug) === 0 ? 0 : 1;
    const bs = bn.indexOf(slug) === 0 ? 0 : 1;
    if (as !== bs) return as - bs;
    return champName(a).localeCompare(champName(b));
  });
  return out.slice(0, 8);
}

function addDays(iso, days) {
  const date = new Date(iso + "T00:00:00");
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function cutoffDate() {
  if (windowKey !== "recent" || !bundle.to) return "";
  return addDays(bundle.to, -RECENT_DAYS);
}

function comparePatch(a, b) {
  const as = String(a).split(".");
  const bs = String(b).split(".");
  const n = Math.max(as.length, bs.length);
  for (let i = 0; i < n; i += 1) {
    const av = Number(as[i] || 0);
    const bv = Number(bs[i] || 0);
    if (av !== bv) return av - bv;
  }
  return 0;
}

function listPatches(games) {
  const seen = {};
  for (let i = 0; i < games.length; i += 1) {
    const value = games[i].p;
    if (value) seen[value] = true;
  }
  return Object.keys(seen).sort(comparePatch).reverse();
}

function chipRow(root, items, current, onPick) {
  root.innerHTML = "";
  for (let i = 0; i < items.length; i += 1) {
    const name = items[i];
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = name;
    if (name === current) button.className = "active";
    button.addEventListener("click", function () {
      onPick(name);
    });
    root.append(button);
  }
}

function windowMatches() {
  const cutoff = cutoffDate();
  const rows = bundle.games || [];
  const out = [];
  for (let i = 0; i < rows.length; i += 1) {
    const game = rows[i];
    if (league !== "All" && game.l !== league) continue;
    if (cutoff && game.d < cutoff) continue;
    out.push(game);
  }
  return out;
}

function listMatches() {
  const q = search.trim().toLowerCase();
  const rows = windowMatches();
  const out = [];
  for (let i = 0; i < rows.length; i += 1) {
    const game = rows[i];
    if (gamePatch !== "All" && game.p !== gamePatch) continue;
    if (
      q &&
      (game.bt || "").toLowerCase().indexOf(q) === -1 &&
      (game.rt || "").toLowerCase().indexOf(q) === -1
    ) {
      continue;
    }
    if (!gameHasChamps(game)) continue;
    out.push(game);
  }
  return out;
}

function lineupOf(game, side) {
  const champs = side === "blue" ? game.b : game.r;
  const names = side === "blue" ? game.bp : game.rp;
  const rows = [];
  for (let i = 0; i < 5; i += 1) {
    if (!champs || !champs[i]) continue;
    rows.push({ id: champs[i], name: (names && names[i]) || "", role: ROLE_KEYS[i] });
  }
  return rows;
}

function predictGame(game) {
  const predict = window.RIFT_PREDICT;
  if (!predict || !predict.matchPredict || !game || !game.g) return null;
  if (predictCache[game.g]) return predictCache[game.g];
  const rec = predict.matchPredict(lineupOf(game, "blue"), lineupOf(game, "red"));
  predictCache[game.g] = rec;
  return rec;
}

function predictedWinner(game, rec) {
  if (!rec || rec.blue === rec.red) return "";
  return rec.blue > rec.red ? "blue" : "red";
}

function renderAcc(rows) {
  if (!els.acc) return;
  let hits = 0;
  let n = 0;
  for (let i = 0; i < rows.length; i += 1) {
    const rec = predictGame(rows[i]);
    const pick = predictedWinner(rows[i], rec);
    if (!pick) continue;
    n += 1;
    if (pick === (rows[i].w === 1 ? "blue" : "red")) hits += 1;
  }
  if (!n) {
    els.acc.hidden = true;
    els.acc.innerHTML = "";
    return;
  }
  const pct = (hits / n) * 100;
  els.acc.hidden = false;
  els.acc.innerHTML = "<b>" + pct.toFixed(1) + "%</b><span>pred acc</span>";
  els.acc.title = hits.toLocaleString() + " / " + n.toLocaleString() + " predicted correctly";
  els.acc.className = "matches-acc " + (pct >= 50 ? "wr-up" : "wr-down");
}

function champCell(ids, team, win) {
  const td = document.createElement("td");
  const wrap = document.createElement("div");
  wrap.className = "match-side" + (win ? " win" : "");
  const name = document.createElement("span");
  name.className = "match-side-name";
  name.textContent = team || "—";
  const icons = document.createElement("div");
  icons.className = "match-icons";
  for (let i = 0; i < 5; i += 1) {
    const id = ids && ids[i];
    if (!id) continue;
    const img = document.createElement("img");
    img.src = portrait(id);
    img.alt = champName(id);
    img.title = champName(id);
    if (champFilters.indexOf(id) !== -1) img.className = "active";
    img.addEventListener("click", function (event) {
      event.stopPropagation();
      toggleChamp(id);
      render();
    });
    icons.append(img);
  }
  wrap.append(name, icons);
  td.append(wrap);
  return td;
}

function render() {
  els.title.textContent = league === "All" ? (bundle.leagues || LEAGUES.slice(1)).join(" · ") : league;
  chipRow(els.leagues, LEAGUES, league, function (name) {
    league = name;
    render();
  });
  els.windows.innerHTML = "";
  const windows = [
    { id: "recent", label: "Last 60 days" },
    { id: "season", label: "Full season" },
  ];
  for (let i = 0; i < windows.length; i += 1) {
    const item = windows[i];
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = item.label;
    if (item.id === windowKey) button.className = "active";
    button.addEventListener("click", function () {
      windowKey = item.id;
      render();
    });
    els.windows.append(button);
  }
  const patches = listPatches(windowMatches());
  if (gamePatch !== "All" && patches.indexOf(gamePatch) === -1) gamePatch = "All";
  chipRow(els.patches, ["All"].concat(patches), gamePatch, function (name) {
    gamePatch = name;
    render();
  });
  renderChampChips();
  const rows = listMatches();
  els.range.textContent = rows.length.toLocaleString() + " matches";
  renderAcc(rows);
  els.body.innerHTML = "";
  if (!rows.length) {
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 6;
    td.className = "pick-empty";
    td.textContent = "No matches match that filter.";
    tr.append(td);
    els.body.append(tr);
    return;
  }
  for (let i = 0; i < rows.length; i += 1) {
    const game = rows[i];
    const tr = document.createElement("tr");
    tr.addEventListener("click", function () {
      location.href = "match.html?g=" + encodeURIComponent(game.g);
    });
    const date = document.createElement("td");
    date.textContent = game.d || "—";
    const leagueCell = document.createElement("td");
    leagueCell.textContent = game.l || "—";
    const patchCell = document.createElement("td");
    patchCell.textContent = game.p || "—";
    const winner = document.createElement("td");
    winner.className = game.w === 1 ? "side-blue" : "side-red";
    winner.textContent = (game.w === 1 ? game.bt : game.rt) || "—";
    const rec = predictGame(game);
    const pick = predictedWinner(game, rec);
    if (rec && pick) {
      winner.title =
        "Predicted " +
        (pick === "blue" ? game.bt : game.rt) +
        " " +
        Math.max(rec.blue, rec.red).toFixed(1) +
        "%";
    }
    tr.append(
      date,
      leagueCell,
      patchCell,
      champCell(game.b, game.bt, game.w === 1),
      champCell(game.r, game.rt, game.w === 0),
      winner
    );
    els.body.append(tr);
  }
}

function renderChampChips() {
  if (!els.champChips) return;
  els.champChips.innerHTML = "";
  els.champChips.hidden = !champFilters.length;
  for (let i = 0; i < champFilters.length; i += 1) {
    const id = champFilters[i];
    const button = document.createElement("button");
    button.type = "button";
    button.className = "active";
    const img = document.createElement("img");
    img.src = portrait(id);
    img.alt = "";
    button.append(img, document.createTextNode(champName(id)));
    button.addEventListener("click", function () {
      toggleChamp(id);
      render();
    });
    els.champChips.append(button);
  }
}

function hideChampMenu() {
  if (!els.champMenu) return;
  els.champMenu.hidden = true;
  els.champMenu.innerHTML = "";
}

function renderChampMenu() {
  if (!els.champMenu || !els.champs) return;
  const hits = searchChamps(els.champs.value);
  els.champMenu.innerHTML = "";
  if (!hits.length) {
    els.champMenu.hidden = true;
    return;
  }
  for (let i = 0; i < hits.length; i += 1) {
    const id = hits[i];
    const button = document.createElement("button");
    button.type = "button";
    const img = document.createElement("img");
    img.src = portrait(id);
    img.alt = "";
    button.append(img, document.createTextNode(champName(id)));
    button.addEventListener("mousedown", function (event) {
      event.preventDefault();
    });
    button.addEventListener("click", function () {
      toggleChamp(id);
      els.champs.value = "";
      hideChampMenu();
      render();
    });
    els.champMenu.append(button);
  }
  els.champMenu.hidden = false;
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
    if (!data || !data.champions) throw new Error("Missing champion data");
    patch = data.patch;
    champMap = new Map(
      data.champions.map(function (champ) {
        return [champ.id, champ];
      })
    );
    bundle = window.RIFT_PRO_GAMES || bundle;
    if (!bundle.games || !bundle.games.length) throw new Error("Missing pro game logs");
    const params = new URLSearchParams(location.search);
    if (params.get("league")) league = params.get("league");
    if (params.get("window")) windowKey = params.get("window");
    if (params.get("patch")) gamePatch = params.get("patch");
    champFilters = parseChamps(params.get("champ"));
    els.search.addEventListener("input", function () {
      search = els.search.value;
      render();
    });
    if (els.champs) {
      els.champs.addEventListener("input", renderChampMenu);
      els.champs.addEventListener("focus", renderChampMenu);
      els.champs.addEventListener("blur", function () {
        setTimeout(hideChampMenu, 120);
      });
      els.champs.addEventListener("keydown", function (event) {
        if (event.key === "Escape") {
          els.champs.value = "";
          hideChampMenu();
          return;
        }
        if (event.key !== "Enter") return;
        const hits = searchChamps(els.champs.value);
        if (!hits.length) return;
        event.preventDefault();
        toggleChamp(hits[0]);
        els.champs.value = "";
        hideChampMenu();
        render();
      });
    }
    render();
    showApp();
    els.search.focus();
  } catch (error) {
    if (els.bootStatus) els.bootStatus.textContent = error.message;
  }
}

boot();
