const DDRAGON = "https://ddragon.leagueoflegends.com";
const ROLES = ["All", "TOP", "JNG", "MID", "ADC", "SUP"];
const ROLE_KEYS = ["TOP", "JNG", "MID", "ADC", "SUP"];
const ROLE_LANES = ["top", "jng", "mid", "adc", "sup"];

const els = {
  boot: document.getElementById("boot"),
  bootStatus: document.getElementById("boot-status"),
  app: document.getElementById("app"),
  title: document.getElementById("guess-title"),
  score: document.getElementById("guess-score"),
  skip: document.getElementById("guess-skip"),
  fearless: document.getElementById("guess-fearless"),
  fearlessRow: document.getElementById("guess-fearless-row"),
  blueName: document.getElementById("guess-blue-name"),
  redName: document.getElementById("guess-red-name"),
  blueBans: document.getElementById("guess-blue-bans"),
  redBans: document.getElementById("guess-red-bans"),
  bluePicks: document.getElementById("guess-blue-picks"),
  redPicks: document.getElementById("guess-red-picks"),
  meta: document.getElementById("guess-meta"),
  hint: document.getElementById("guess-hint"),
  feedback: document.getElementById("guess-feedback"),
  search: document.getElementById("guess-search"),
  roles: document.getElementById("guess-roles"),
  grid: document.getElementById("guess-grid"),
};

let patch = "";
let champions = [];
let champMap = new Map();
let bundle = { games: [] };
let seriesMeta = {};
let seriesGames = {};
let search = "";
let role = "All";
let puzzle = null;
let guessed = {};
let solved = false;
let correct = 0;
let rounds = 0;
let seen = {};

function portrait(id) {
  return DDRAGON + "/cdn/" + patch + "/img/champion/" + id + ".png";
}

function loadingArt(id) {
  return DDRAGON + "/cdn/img/champion/loading/" + id + "_0.jpg";
}

function champName(id) {
  return (champMap.get(id) && champMap.get(id).name) || id || "";
}

function winrateEntry(id, roleKey) {
  const lanes = (window.RIFT_WINRATES && window.RIFT_WINRATES.lanes) || {};
  const lane = lanes[roleKey];
  return (lane && lane.champs && lane.champs[id]) || null;
}

function primaryRole(id) {
  let best = "";
  let n = -1;
  for (let i = 0; i < ROLE_LANES.length; i += 1) {
    const rec = winrateEntry(id, ROLE_LANES[i]);
    const games = rec && rec.games ? rec.games : 0;
    if (games > n) {
      n = games;
      best = ROLE_LANES[i];
    }
  }
  return best;
}

function champFitsRole(id, roleName) {
  if (!roleName || roleName === "All") return true;
  const key = roleName.toLowerCase();
  const rec = winrateEntry(id, key);
  if (rec && ((rec.lane_pct || 0) >= 10 || primaryRole(id) === key)) return true;
  return false;
}

function seriesKey(game) {
  const teams = [game.bt || "", game.rt || ""].sort();
  return (game.d || "") + "|" + (game.l || "") + "|" + teams.join("|");
}

function parseGameNo(id) {
  const match = String(id || "").match(/_game_(\d+)$/i);
  return match ? Number(match[1]) : 0;
}

function buildSeries(games) {
  const groups = {};
  const meta = {};
  for (let i = 0; i < games.length; i += 1) {
    const game = games[i];
    const key = seriesKey(game);
    (groups[key] || (groups[key] = [])).push(game);
  }
  const keys = Object.keys(groups);
  for (let g = 0; g < keys.length; g += 1) {
    const list = groups[keys[g]];
    list.sort(function (a, b) {
      const na = parseGameNo(a.g);
      const nb = parseGameNo(b.g);
      if (na && nb && na !== nb) return na - nb;
      return String(a.g || "").localeCompare(String(b.g || ""), undefined, { numeric: true });
    });
    for (let i = 0; i < list.length; i += 1) {
      meta[list[i].g] = { n: parseGameNo(list[i].g) || i + 1, of: list.length, key: keys[g] };
    }
  }
  return { meta: meta, groups: groups };
}

function completeGame(game) {
  if (!game || !game.b || !game.r) return false;
  for (let i = 0; i < 5; i += 1) {
    if (!game.b[i] || !game.r[i]) return false;
  }
  return true;
}

function priorPicks(game) {
  const info = seriesMeta[game.g];
  if (!info || info.n <= 1) return [];
  const list = seriesGames[info.key] || [];
  const seenIds = {};
  const out = [];
  for (let i = 0; i < list.length; i += 1) {
    const other = list[i];
    const otherNo = (seriesMeta[other.g] && seriesMeta[other.g].n) || 0;
    if (other.g === game.g || otherNo >= info.n) continue;
    const champs = (other.b || []).concat(other.r || []);
    for (let c = 0; c < champs.length; c += 1) {
      const id = champs[c];
      if (!id || seenIds[id]) continue;
      seenIds[id] = true;
      out.push(id);
    }
  }
  return out;
}

function pickPuzzle() {
  const rows = (bundle.games || []).filter(completeGame);
  if (!rows.length) return null;
  for (let tries = 0; tries < 40; tries += 1) {
    const game = rows[Math.floor(Math.random() * rows.length)];
    const side = Math.random() < 0.5 ? "b" : "r";
    const index = Math.floor(Math.random() * 5);
    const id = (side === "b" ? game.b : game.r)[index];
    const key = game.g + ":" + side + ":" + index;
    if (!id || seen[key]) continue;
    seen[key] = true;
    return {
      game: game,
      side: side,
      index: index,
      id: id,
      role: ROLE_KEYS[index],
      fearless: priorPicks(game),
    };
  }
  seen = {};
  const game = rows[Math.floor(Math.random() * rows.length)];
  const side = Math.random() < 0.5 ? "b" : "r";
  const index = Math.floor(Math.random() * 5);
  return {
    game: game,
    side: side,
    index: index,
    id: (side === "b" ? game.b : game.r)[index],
    role: ROLE_KEYS[index],
    fearless: priorPicks(game),
  };
}

function banNode(id) {
  const node = document.createElement("div");
  node.className = "ban" + (id ? " filled" : "");
  if (id) {
    const img = document.createElement("img");
    img.src = portrait(id);
    img.alt = champName(id);
    node.append(img);
    node.title = champName(id);
  }
  return node;
}

function pickNode(id, roleName, hidden, revealed) {
  const node = document.createElement("div");
  node.className = "pick";
  if (hidden && !revealed) {
    node.classList.add("guess-hidden");
    const mark = document.createElement("span");
    mark.className = "guess-mark";
    mark.textContent = "?";
    node.append(mark);
  } else if (id) {
    const art = document.createElement("img");
    art.className = "pick-art";
    art.src = loadingArt(id);
    art.alt = champName(id);
    node.append(art);
  }
  const meta = document.createElement("div");
  meta.className = "pick-meta";
  const name = document.createElement("span");
  name.className = "pick-name";
  name.textContent = hidden && !revealed ? "Hidden" : champName(id);
  const roleBtn = document.createElement("span");
  roleBtn.className = "role-btn";
  roleBtn.textContent = roleName;
  meta.append(name, roleBtn);
  node.append(meta);
  return node;
}

function renderBans(root, ids) {
  root.innerHTML = "";
  for (let i = 0; i < 5; i += 1) root.append(banNode(ids && ids[i]));
}

function renderPicks(root, ids, side) {
  root.innerHTML = "";
  for (let i = 0; i < 5; i += 1) {
    const hidden = puzzle && puzzle.side === side && puzzle.index === i;
    root.append(pickNode(ids[i], ROLE_KEYS[i], hidden, solved));
  }
}

function renderFearless() {
  const ids = (puzzle && puzzle.fearless) || [];
  if (!ids.length) {
    els.fearless.hidden = true;
    els.fearlessRow.innerHTML = "";
    return;
  }
  els.fearless.hidden = false;
  els.fearlessRow.innerHTML = "";
  for (let i = 0; i < ids.length; i += 1) {
    const img = document.createElement("img");
    img.src = portrait(ids[i]);
    img.alt = champName(ids[i]);
    img.title = champName(ids[i]);
    els.fearlessRow.append(img);
  }
}

function renderDraft() {
  const game = puzzle.game;
  const info = seriesMeta[game.g] || {};
  els.blueName.textContent = game.bt || "Blue";
  els.redName.textContent = game.rt || "Red";
  renderBans(els.blueBans, game.bb);
  renderBans(els.redBans, game.rb);
  renderPicks(els.bluePicks, game.b, "b");
  renderPicks(els.redPicks, game.r, "r");
  renderFearless();
  const gameBit = info.n ? "Game " + info.n + (info.of > 1 ? " of " + info.of : "") : "Game";
  els.meta.textContent = (game.l || "") + " · " + (game.d || "") + " · " + (game.p || "") + " · " + gameBit;
  els.hint.textContent = solved
    ? champName(puzzle.id) + " · " + puzzle.role
    : "One " + puzzle.role + " pick is hidden. Click a champion to guess.";
}

function setFeedback(text, tone) {
  els.feedback.textContent = text;
  els.feedback.className = "guess-feedback" + (tone ? " " + tone : "");
}

function renderScore() {
  els.score.textContent = correct + " / " + rounds + " correct";
}

function nextPuzzle(countRound) {
  if (countRound) rounds += 1;
  puzzle = pickPuzzle();
  guessed = {};
  solved = false;
  search = "";
  if (els.search) els.search.value = "";
  els.title.textContent = "Who is missing?";
  els.skip.textContent = "Skip";
  setFeedback("");
  if (!puzzle) {
    els.hint.textContent = "No complete drafts to guess from.";
    return;
  }
  renderDraft();
  renderRoles();
  renderGrid();
  renderScore();
}

function guessChamp(id) {
  if (!puzzle || solved || !id) return;
  if (guessed[id]) return;
  guessed[id] = true;
  if (id === puzzle.id) {
    solved = true;
    correct += 1;
    rounds += 1;
    els.title.textContent = champName(id);
    els.skip.textContent = "Next";
    setFeedback("Correct — " + champName(id), "up");
    renderDraft();
    renderGrid();
    renderScore();
    return;
  }
  setFeedback("Not " + champName(id), "down");
  renderGrid();
}

function renderRoles() {
  els.roles.innerHTML = "";
  for (let i = 0; i < ROLES.length; i += 1) {
    const name = ROLES[i];
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = name;
    if (name === role) button.className = "active";
    button.addEventListener("click", function () {
      role = name;
      renderRoles();
      renderGrid();
    });
    els.roles.append(button);
  }
}

function renderGrid() {
  const q = search.trim().toLowerCase().replace(/['.\s]/g, "");
  const visible = champions.filter(function (champ) {
    if (!champFitsRole(champ.id, role)) return false;
    if (!q) return true;
    const hay = (champ.name + champ.id + champ.key).toLowerCase().replace(/['.\s]/g, "");
    return hay.indexOf(q) !== -1;
  });
  els.grid.innerHTML = "";
  if (!visible.length) {
    const empty = document.createElement("p");
    empty.className = "pick-empty";
    empty.textContent = "No champions match that filter.";
    els.grid.append(empty);
    return;
  }
  for (let i = 0; i < visible.length; i += 1) {
    const champ = visible[i];
    const wrap = document.createElement("div");
    wrap.className = "champ";
    if (guessed[champ.id]) wrap.classList.add("disabled");
    if (solved && champ.id === puzzle.id) wrap.classList.add("suggested");
    wrap.title = champ.name;
    const img = document.createElement("img");
    img.src = portrait(champ.id);
    img.alt = champ.name;
    img.draggable = false;
    const label = document.createElement("span");
    label.className = "label";
    label.textContent = champ.name;
    wrap.append(img, label);
    wrap.addEventListener("click", function () {
      guessChamp(champ.id);
    });
    els.grid.append(wrap);
  }
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
    champions = data.champions;
    champMap = new Map(
      champions.map(function (champ) {
        return [champ.id, champ];
      })
    );
    bundle = window.RIFT_PRO_GAMES || bundle;
    if (!bundle.games || !bundle.games.length) throw new Error("Missing pro game logs");
    const built = buildSeries(bundle.games);
    seriesMeta = built.meta;
    seriesGames = built.groups;
    els.skip.addEventListener("click", function () {
      nextPuzzle(!solved);
    });
    els.search.addEventListener("input", function () {
      search = els.search.value;
      renderGrid();
    });
    nextPuzzle(false);
    showApp();
    els.search.focus();
  } catch (error) {
    if (els.bootStatus) els.bootStatus.textContent = error.message;
  }
}

boot();
