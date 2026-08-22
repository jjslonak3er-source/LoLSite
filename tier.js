const DDRAGON = "https://ddragon.leagueoflegends.com";
const STORE = "rift-tier-list";
const ROLES = ["All", "TOP", "JNG", "MID", "ADC", "SUP"];
const ROLE_KEYS = ["top", "jng", "mid", "adc", "sup"];
const DEFAULT_COLORS = ["#ef5b6e", "#e08a4a", "#d4c05a", "#5aaa6a", "#5aa8ff", "#8b6bb8", "#c5d0d8"];
const DEFAULT_TIERS = [
  { id: "s", name: "S", color: "#ef5b6e" },
  { id: "a", name: "A", color: "#e08a4a" },
  { id: "b", name: "B", color: "#d4c05a" },
  { id: "c", name: "C", color: "#5aaa6a" },
  { id: "d", name: "D", color: "#5aa8ff" },
  { id: "f", name: "F", color: "#8b6bb8" },
];

const els = {
  boot: document.getElementById("boot"),
  bootStatus: document.getElementById("boot-status"),
  app: document.getElementById("app"),
  title: document.getElementById("tier-title"),
  rows: document.getElementById("tier-rows"),
  search: document.getElementById("tier-search"),
  roles: document.getElementById("tier-roles"),
  grid: document.getElementById("tier-grid"),
  add: document.getElementById("tier-add"),
  reset: document.getElementById("tier-reset"),
  modal: document.getElementById("tier-modal"),
  modalBackdrop: document.getElementById("tier-modal-backdrop"),
  modalHeading: document.getElementById("tier-modal-heading"),
  modalName: document.getElementById("tier-modal-name"),
  modalColor: document.getElementById("tier-modal-color"),
  modalAbove: document.getElementById("tier-modal-above"),
  modalBelow: document.getElementById("tier-modal-below"),
  modalDelete: document.getElementById("tier-modal-delete"),
  modalDone: document.getElementById("tier-modal-done"),
};

let patch = "";
let champions = [];
let champMap = new Map();
let search = "";
let role = "All";
let drag = null;
let nextId = 1;
let editIndex = -1;
let state = blankState();

function blankState() {
  return {
    title: "My tier list",
    tiers: DEFAULT_TIERS.map(function (tier) {
      return { id: tier.id, name: tier.name, color: tier.color, champs: [] };
    }),
  };
}

function portrait(id) {
  return DDRAGON + "/cdn/" + patch + "/img/champion/" + id + ".png";
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
  for (let i = 0; i < ROLE_KEYS.length; i += 1) {
    const rec = winrateEntry(id, ROLE_KEYS[i]);
    const games = rec && rec.games ? rec.games : 0;
    if (games > n) {
      n = games;
      best = ROLE_KEYS[i];
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

function placedSet() {
  const seen = {};
  for (let i = 0; i < state.tiers.length; i += 1) {
    const champs = state.tiers[i].champs || [];
    for (let j = 0; j < champs.length; j += 1) seen[champs[j]] = true;
  }
  return seen;
}

function findChamp(id) {
  for (let i = 0; i < state.tiers.length; i += 1) {
    const idx = state.tiers[i].champs.indexOf(id);
    if (idx !== -1) return { tier: i, index: idx };
  }
  return null;
}

function removeChamp(id) {
  const hit = findChamp(id);
  if (!hit) return;
  state.tiers[hit.tier].champs.splice(hit.index, 1);
}

function insertChamp(id, tierIndex, at) {
  if (!id || !champMap.has(id)) return;
  const hit = findChamp(id);
  let index = at == null ? (state.tiers[tierIndex] && state.tiers[tierIndex].champs.length) || 0 : at;
  if (hit && hit.tier === tierIndex && hit.index < index) index -= 1;
  removeChamp(id);
  const row = state.tiers[tierIndex];
  if (!row) return;
  const list = row.champs;
  if (index < 0) index = 0;
  if (index > list.length) index = list.length;
  list.splice(index, 0, id);
}

function save() {
  try {
    localStorage.setItem(STORE, JSON.stringify(state));
  } catch (error) {}
}

function load() {
  try {
    const raw = localStorage.getItem(STORE);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (!data || !data.tiers || !data.tiers.length) return;
    state.title = data.title || state.title;
    state.tiers = data.tiers.map(function (tier, i) {
      nextId = Math.max(nextId, i + 2);
      return {
        id: String(tier.id || "t" + (i + 1)),
        name: String(tier.name || "T").slice(0, 12),
        color: String(tier.color || DEFAULT_COLORS[i % DEFAULT_COLORS.length]),
        champs: (tier.champs || []).filter(function (id) {
          return champMap.has(id);
        }),
      };
    });
  } catch (error) {}
}

function visiblePool() {
  const taken = placedSet();
  const q = search.trim().toLowerCase().replace(/['.\s]/g, "");
  return champions.filter(function (champ) {
    if (taken[champ.id]) return false;
    if (!champFitsRole(champ.id, role)) return false;
    if (!q) return true;
    const hay = (champ.name + champ.id + champ.key).toLowerCase().replace(/['.\s]/g, "");
    return hay.indexOf(q) !== -1;
  });
}

function beginDrag(event, payload) {
  drag = payload;
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", payload.id || "champ");
}

function endDrag() {
  drag = null;
  document.querySelectorAll(".drop-hover").forEach(function (node) {
    node.classList.remove("drop-hover");
  });
}

function bindDrop(node, onDrop, capture) {
  node.addEventListener(
    "dragover",
    function (event) {
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      node.classList.add("drop-hover");
    },
    capture
  );
  node.addEventListener("dragleave", function (event) {
    if (!node.contains(event.relatedTarget)) node.classList.remove("drop-hover");
  });
  node.addEventListener(
    "drop",
    function (event) {
      event.preventDefault();
      event.stopPropagation();
      node.classList.remove("drop-hover");
      if (!drag) return;
      onDrop(drag);
      drag = null;
      save();
      render();
    },
    capture
  );
}

function champNode(id, fromTier, fromIndex) {
  const wrap = document.createElement("div");
  wrap.className = "champ";
  wrap.draggable = true;
  wrap.title = champName(id) + " — drag to move, double-click to unrank";
  wrap.setAttribute("role", "img");
  const img = document.createElement("img");
  img.src = portrait(id);
  img.alt = champName(id);
  img.draggable = false;
  const label = document.createElement("span");
  label.className = "label";
  label.textContent = champName(id);
  wrap.append(img, label);
  wrap.addEventListener("dragstart", function (event) {
    beginDrag(event, { id: id, tier: fromTier, index: fromIndex });
  });
  wrap.addEventListener("dragend", endDrag);
  wrap.addEventListener("dblclick", function () {
    removeChamp(id);
    save();
    render();
  });
  return wrap;
}

function renderRows() {
  els.rows.innerHTML = "";
  for (let i = 0; i < state.tiers.length; i += 1) {
    const tier = state.tiers[i];
    const row = document.createElement("div");
    row.className = "tier-row";
    const label = document.createElement("button");
    label.type = "button";
    label.className = "tier-label";
    label.style.background = tier.color;
    label.title = "Edit " + tier.name + " tier";
    const name = document.createElement("span");
    name.className = "tier-name";
    name.textContent = tier.name || " ";
    name.style.color = contrastText(tier.color);
    label.append(name);
    label.addEventListener("click", function () {
      openEditor(i);
    });

    const tray = document.createElement("div");
    tray.className = "tier-tray";
    for (let j = 0; j < tier.champs.length; j += 1) {
      const node = champNode(tier.champs[j], i, j);
      bindDrop(node, function (payload) {
        insertChamp(payload.id, i, j);
      });
      tray.append(node);
    }
    bindDrop(tray, function (payload) {
      insertChamp(payload.id, i, tier.champs.length);
    });

    row.append(label, tray);
    els.rows.append(row);
  }
}

function makeTier() {
  const n = state.tiers.length;
  const tier = {
    id: "t" + nextId,
    name: "T" + (n + 1),
    color: DEFAULT_COLORS[n % DEFAULT_COLORS.length],
    champs: [],
  };
  nextId += 1;
  return tier;
}

function openEditor(index) {
  const tier = state.tiers[index];
  if (!tier || !els.modal) return;
  editIndex = index;
  els.modalHeading.textContent = tier.name || "Tier";
  els.modalName.value = tier.name;
  els.modalColor.value = toHex(tier.color);
  els.modalDelete.disabled = state.tiers.length <= 1;
  els.modal.hidden = false;
  document.body.classList.add("tier-modal-open");
  els.modalName.focus();
  els.modalName.select();
}

function closeEditor() {
  editIndex = -1;
  if (els.modal) els.modal.hidden = true;
  document.body.classList.remove("tier-modal-open");
}

function currentEditTier() {
  return editIndex >= 0 ? state.tiers[editIndex] : null;
}

function labelNameAt(index) {
  const row = els.rows && els.rows.children[index];
  return row ? row.querySelector(".tier-name") : null;
}

function toHex(color) {
  const value = String(color || "#888888");
  if (/^#[0-9a-fA-F]{6}$/.test(value)) return value;
  return "#888888";
}

function contrastText(color) {
  const hex = toHex(color).slice(1);
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? "#101114" : "#f4f6f8";
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
      render();
    });
    els.roles.append(button);
  }
}

function renderGrid() {
  const visible = visiblePool();
  els.grid.innerHTML = "";
  if (!visible.length) {
    const empty = document.createElement("p");
    empty.className = "pick-empty";
    empty.textContent = "No champions match that filter.";
    els.grid.append(empty);
    return;
  }
  for (let i = 0; i < visible.length; i += 1) {
    els.grid.append(champNode(visible[i].id, -1, -1));
  }
}

function render() {
  if (els.title && document.activeElement !== els.title) els.title.value = state.title;
  renderRows();
  renderRoles();
  renderGrid();
}

function addTier(at) {
  const index = at == null ? state.tiers.length : at;
  state.tiers.splice(index, 0, makeTier());
  save();
  render();
}

function resetList() {
  if (!confirm("Reset tiers and unrank every champion?")) return;
  closeEditor();
  state = blankState();
  nextId = 7;
  save();
  render();
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
    load();
    if (els.title) {
      els.title.value = state.title;
      els.title.addEventListener("input", function () {
        state.title = els.title.value.slice(0, 40);
        save();
      });
    }
    els.search.addEventListener("input", function () {
      search = els.search.value;
      renderGrid();
    });
    els.add.addEventListener("click", function () {
      addTier();
    });
    els.reset.addEventListener("click", resetList);
    els.modalName.addEventListener("input", function () {
      const tier = currentEditTier();
      if (!tier) return;
      tier.name = els.modalName.value.slice(0, 12);
      els.modalHeading.textContent = tier.name || "Tier";
      const name = labelNameAt(editIndex);
      if (name) name.textContent = tier.name || " ";
      save();
    });
    els.modalColor.addEventListener("input", function () {
      const tier = currentEditTier();
      if (!tier) return;
      tier.color = els.modalColor.value;
      const row = els.rows.children[editIndex];
      const label = row && row.querySelector(".tier-label");
      const name = label && label.querySelector(".tier-name");
      if (label) label.style.background = tier.color;
      if (name) name.style.color = contrastText(tier.color);
      save();
    });
    els.modalAbove.addEventListener("click", function () {
      if (editIndex < 0) return;
      addTier(editIndex);
      closeEditor();
    });
    els.modalBelow.addEventListener("click", function () {
      if (editIndex < 0) return;
      addTier(editIndex + 1);
      closeEditor();
    });
    els.modalDelete.addEventListener("click", function () {
      if (editIndex < 0 || state.tiers.length <= 1) return;
      state.tiers.splice(editIndex, 1);
      save();
      closeEditor();
      render();
    });
    els.modalDone.addEventListener("click", closeEditor);
    els.modalBackdrop.addEventListener("click", closeEditor);
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && els.modal && !els.modal.hidden) closeEditor();
    });
    bindDrop(
      els.grid,
      function (payload) {
        removeChamp(payload.id);
      },
      true
    );
    render();
    showApp();
    els.search.focus();
  } catch (error) {
    if (els.bootStatus) els.bootStatus.textContent = error.message;
  }
}

boot();
