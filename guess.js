const DDRAGON = "https://ddragon.leagueoflegends.com";
const ROLES = ["All", "TOP", "JNG", "MID", "ADC", "SUP"];
const ROLE_KEYS = ["TOP", "JNG", "MID", "ADC", "SUP"];
const ROLE_LANES = ["top", "jng", "mid", "adc", "sup"];
const MODES = [
  { id: "pick", label: "Guess the pick" },
  { id: "winner", label: "Guess the winner" },
];
const PICK_TRIES = 3;

const els = {
  boot: document.getElementById("boot"),
  bootStatus: document.getElementById("boot-status"),
  app: document.getElementById("app"),
  title: document.getElementById("guess-title"),
  score: document.getElementById("guess-score"),
  skip: document.getElementById("guess-skip"),
  modes: document.getElementById("guess-modes"),
  fearless: document.getElementById("guess-fearless"),
  fearlessRow: document.getElementById("guess-fearless-row"),
  blueName: document.getElementById("guess-blue-name"),
  redName: document.getElementById("guess-red-name"),
  blueBans: document.getElementById("guess-blue-bans"),
  redBans: document.getElementById("guess-red-bans"),
  bluePicks: document.getElementById("guess-blue-picks"),
  redPicks: document.getElementById("guess-red-picks"),
  meta: document.getElementById("guess-meta"),
  time: document.getElementById("guess-time"),
  hint: document.getElementById("guess-hint"),
  feedback: document.getElementById("guess-feedback"),
  winnerActions: document.getElementById("guess-winner-actions"),
  blueBtn: document.getElementById("guess-blue"),
  redBtn: document.getElementById("guess-red"),
  namesToggle: document.getElementById("guess-names-toggle"),
  showNames: document.getElementById("guess-show-names"),
  timeToggle: document.getElementById("guess-time-toggle"),
  showTime: document.getElementById("guess-show-time"),
  pool: document.getElementById("guess-pool"),
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
let mode = "pick";
let puzzle = null;
let guessed = {};
let misses = 0;
let solved = false;
let showTime = false;
let showNames = false;
let stats = { pick: { correct: 0, rounds: 0 }, winner: { correct: 0, rounds: 0 } };
let seen = { pick: {}, winner: {} };

function portrait(id) {
  return DDRAGON + "/cdn/" + patch + "/img/champion/" + id + ".png";
}

function loadingArt(id) {
  return DDRAGON + "/cdn/img/champion/loading/" + id + "_0.jpg";
}

function champName(id) {
  return (champMap.get(id) && champMap.get(id).name) || id || "";
}

function playerKey(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "");
}

function fmtScore(value) {
  if (value == null || !isFinite(value)) return "—";
  if (!value) return "0.0";
  return (value > 0 ? "+" : "−") + Math.abs(value).toFixed(1);
}

function fmtLength(sec) {
  const n = Number(sec) || 0;
  if (!n) return "—";
  const m = Math.floor(n / 60);
  const s = n % 60;
  return m + ":" + String(s).padStart(2, "0");
}

function playerScore(name, roleName) {
  const key = playerKey(name);
  const roles = (window.RIFT_PLAYER_RATINGS && window.RIFT_PLAYER_RATINGS.roles) || {};
  const rec = roles[roleName.toLowerCase()] && roles[roleName.toLowerCase()][key];
  return rec && rec.s != null ? rec.s : null;
}

function champScore(id, roleName) {
  const statsMap = (window.RIFT_ORACLES && window.RIFT_ORACLES.stats) || {};
  const rec = statsMap[id] && statsMap[id][roleName.toLowerCase()];
  if (!rec || !rec.picks) return null;
  return (rec.wins / rec.picks - 0.5) * 100;
}

function usedChampIds() {
  const used = {};
  if (!puzzle || !puzzle.game) return used;
  const lists = [puzzle.game.b, puzzle.game.r, puzzle.game.bb, puzzle.game.rb, puzzle.fearless];
  for (let i = 0; i < lists.length; i += 1) {
    const ids = lists[i] || [];
    for (let j = 0; j < ids.length; j += 1) {
      if (ids[j]) used[ids[j]] = true;
    }
  }
  if (puzzle.id) delete used[puzzle.id];
  return used;
}

function champLocked(id) {
  if (!id || guessed[id]) return true;
  return !!usedChampIds()[id];
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

function completeRows() {
  return (bundle.games || []).filter(completeGame);
}

function pickHiddenPuzzle() {
  const rows = completeRows();
  if (!rows.length) return null;
  const bag = seen.pick;
  for (let tries = 0; tries < 40; tries += 1) {
    const game = rows[Math.floor(Math.random() * rows.length)];
    const side = Math.random() < 0.5 ? "b" : "r";
    const index = Math.floor(Math.random() * 5);
    const id = (side === "b" ? game.b : game.r)[index];
    const key = game.g + ":" + side + ":" + index;
    if (!id || bag[key]) continue;
    bag[key] = true;
    return { game: game, side: side, index: index, id: id, role: ROLE_KEYS[index], fearless: priorPicks(game) };
  }
  seen.pick = {};
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

function pickWinnerPuzzle() {
  const rows = completeRows();
  if (!rows.length) return null;
  const bag = seen.winner;
  for (let tries = 0; tries < 40; tries += 1) {
    const game = rows[Math.floor(Math.random() * rows.length)];
    if (bag[game.g]) continue;
    bag[game.g] = true;
    return { game: game, winner: game.w === 1 ? "b" : "r" };
  }
  seen.winner = {};
  const game = rows[Math.floor(Math.random() * rows.length)];
  return { game: game, winner: game.w === 1 ? "b" : "r" };
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

function scoreLine(player, champ) {
  const line = document.createElement("div");
  line.className = "guess-scores";
  const p = document.createElement("span");
  p.className = player > 0 ? "wr-up" : player < 0 ? "wr-down" : "";
  p.textContent = "Player " + fmtScore(player);
  const c = document.createElement("span");
  c.className = champ > 0 ? "wr-up" : champ < 0 ? "wr-down" : "";
  c.textContent = "Champ " + fmtScore(champ);
  line.append(p, c);
  return line;
}

function pickNode(id, roleName, hidden, revealed, playerName) {
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
  meta.append(name);
  if (mode === "winner" && id) {
    meta.append(scoreLine(playerScore(playerName, roleName), champScore(id, roleName)));
  }
  meta.append(roleBtn);
  node.append(meta);
  return node;
}

function renderBans(root, ids) {
  root.innerHTML = "";
  for (let i = 0; i < 5; i += 1) root.append(banNode(ids && ids[i]));
}

function renderPicks(root, ids, names, side) {
  root.innerHTML = "";
  for (let i = 0; i < 5; i += 1) {
    const hidden = mode === "pick" && puzzle && puzzle.side === side && puzzle.index === i;
    root.append(pickNode(ids[i], ROLE_KEYS[i], hidden, solved, names && names[i]));
  }
}

function renderFearless() {
  const ids = mode === "pick" && puzzle ? puzzle.fearless || [] : [];
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

function matchupText() {
  const game = puzzle && puzzle.game;
  if (!game) return "";
  return (game.bt || "Blue") + " vs " + (game.rt || "Red");
}

function namesVisible() {
  return solved || showNames;
}

function sideLabel(side) {
  const game = puzzle && puzzle.game;
  if (namesVisible() && game) return side === "b" ? game.bt || "Blue" : game.rt || "Red";
  return side === "b" ? "Blue" : "Red";
}

function renderDraft() {
  const game = puzzle.game;
  const info = seriesMeta[game.g] || {};
  els.blueName.textContent = sideLabel("b");
  els.redName.textContent = sideLabel("r");
  renderBans(els.blueBans, game.bb);
  renderBans(els.redBans, game.rb);
  renderPicks(els.bluePicks, game.b, game.bp, "b");
  renderPicks(els.redPicks, game.r, game.rp, "r");
  renderFearless();
  const gameBit = info.n ? "Game " + info.n + (info.of > 1 ? " of " + info.of : "") : "Game";
  const bits = [game.l || "", game.p || "", gameBit];
  if (mode === "pick") bits.unshift(game.d || "");
  els.meta.textContent = bits.filter(Boolean).join(" · ");
  if (els.time) {
    els.time.hidden = !(mode === "winner" && showTime);
    els.time.textContent = mode === "winner" && showTime ? fmtLength(game.gl) : "";
  }
  if (mode === "winner") {
    els.hint.textContent = solved
      ? (puzzle.winner === "b" ? "Blue" : "Red") + " won"
      : "Guess which side won. Team names are hidden.";
  } else {
    els.hint.textContent = solved
      ? [champName(puzzle.id), puzzle.role, matchupText()].filter(Boolean).join(" · ")
      : "One " + puzzle.role + " pick is hidden. Three guesses.";
  }
}

function setFeedback(text, tone) {
  els.feedback.textContent = text;
  els.feedback.className = "guess-feedback" + (tone ? " " + tone : "");
}

function renderScore() {
  const rec = stats[mode];
  els.score.textContent = rec.correct + " / " + rec.rounds + " correct";
}

function renderModes() {
  els.modes.innerHTML = "";
  for (let i = 0; i < MODES.length; i += 1) {
    const item = MODES[i];
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = item.label;
    if (item.id === mode) button.className = "active";
    button.addEventListener("click", function () {
      if (mode === item.id) return;
      mode = item.id;
      const url = new URL(location.href);
      url.searchParams.set("mode", mode);
      history.replaceState({}, "", url);
      nextPuzzle(false);
    });
    els.modes.append(button);
  }
}

function setModeChrome() {
  const winner = mode === "winner";
  if (els.pool) els.pool.hidden = winner;
  if (els.winnerActions) els.winnerActions.hidden = !winner || solved;
  if (els.timeToggle) els.timeToggle.hidden = !winner;
  if (els.blueBtn) els.blueBtn.disabled = solved;
  if (els.redBtn) els.redBtn.disabled = solved;
}

function nextPuzzle(countRound) {
  if (countRound) stats[mode].rounds += 1;
  puzzle = mode === "winner" ? pickWinnerPuzzle() : pickHiddenPuzzle();
  guessed = {};
  misses = 0;
  solved = false;
  search = "";
  if (els.search) els.search.value = "";
  els.title.textContent = mode === "winner" ? "Who won?" : "Who is missing?";
  els.skip.textContent = "Skip";
  setFeedback("");
  renderModes();
  setModeChrome();
  if (!puzzle) {
    els.hint.textContent = "No complete drafts to guess from.";
    return;
  }
  renderDraft();
  if (mode === "pick") {
    renderRoles();
    renderGrid();
  }
  renderScore();
}

function resolveRound(ok, message, tone) {
  solved = true;
  if (ok) stats[mode].correct += 1;
  stats[mode].rounds += 1;
  els.skip.textContent = "Next";
  setFeedback(message, tone);
  setModeChrome();
  renderDraft();
  if (mode === "pick") renderGrid();
  renderScore();
}

function guessChamp(id) {
  if (mode !== "pick" || !puzzle || solved || !id) return;
  if (champLocked(id) && id !== puzzle.id) return;
  if (guessed[id]) return;
  guessed[id] = true;
  if (id === puzzle.id) {
    els.title.textContent = champName(id);
    resolveRound(true, "Correct — " + champName(id) + " · " + matchupText(), "up");
    return;
  }
  misses += 1;
  if (misses >= PICK_TRIES) {
    els.title.textContent = champName(puzzle.id);
    resolveRound(false, "Out of guesses — " + champName(puzzle.id) + " · " + matchupText(), "down");
    return;
  }
  const left = PICK_TRIES - misses;
  setFeedback("Not " + champName(id) + " · " + left + (left === 1 ? " try" : " tries") + " left", "down");
  renderGrid();
}

function guessWinner(side) {
  if (mode !== "winner" || !puzzle || solved) return;
  const win = puzzle.winner === side;
  const label = side === "b" ? "Blue" : "Red";
  const actual = puzzle.winner === "b" ? "Blue" : "Red";
  const names = (puzzle.game.bt || "Blue") + " vs " + (puzzle.game.rt || "Red");
  els.title.textContent = actual + " won";
  resolveRound(
    win,
    (win ? "Correct — " : "Wrong — ") + actual + " won · " + names,
    win ? "up" : "down"
  );
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
  const used = usedChampIds();
  for (let i = 0; i < visible.length; i += 1) {
    const champ = visible[i];
    const wrap = document.createElement("div");
    wrap.className = "champ";
    const locked = guessed[champ.id] || !!used[champ.id];
    if (locked) {
      wrap.classList.add("disabled");
      wrap.draggable = false;
    }
    if (solved && puzzle && champ.id === puzzle.id) wrap.classList.add("suggested");
    wrap.title = locked ? champ.name + " is already drafted or banned" : champ.name;
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
    const params = new URLSearchParams(location.search);
    if (params.get("mode") === "winner") mode = "winner";
    els.skip.addEventListener("click", function () {
      nextPuzzle(!solved);
    });
    if (els.search) {
      els.search.addEventListener("input", function () {
        search = els.search.value;
        renderGrid();
      });
    }
    if (els.blueBtn) els.blueBtn.addEventListener("click", function () { guessWinner("b"); });
    if (els.redBtn) els.redBtn.addEventListener("click", function () { guessWinner("r"); });
    if (els.showNames) {
      els.showNames.addEventListener("change", function () {
        showNames = els.showNames.checked;
        if (puzzle) renderDraft();
      });
    }
    if (els.showTime) {
      els.showTime.addEventListener("change", function () {
        showTime = els.showTime.checked;
        if (puzzle) renderDraft();
      });
    }
    nextPuzzle(false);
    showApp();
    if (mode === "pick" && els.search) els.search.focus();
  } catch (error) {
    if (els.bootStatus) els.bootStatus.textContent = error.message;
  }
}

boot();
