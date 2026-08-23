(function (global) {
  const DEFAULT_DAYS = 60;
  const state = { key: "recent", days: DEFAULT_DAYS, timer: 0 };

  function clampDays(n) {
    n = parseInt(n, 10);
    if (!n || n < 1) return 0;
    return Math.min(365, n);
  }

  function init(raw) {
    if (raw === "season") {
      state.key = "season";
      return state;
    }
    const n = clampDays(raw);
    state.key = "recent";
    state.days = n || DEFAULT_DAYS;
    return state;
  }

  function param() {
    return state.key === "season" ? "season" : String(state.days);
  }

  function cutoff(newest, addDaysFn) {
    if (state.key !== "recent" || !newest) return "";
    return addDaysFn(newest, -state.days);
  }

  function sync(root) {
    if (!root) return;
    const wrap = root.querySelector(".window-days");
    const input = wrap && wrap.querySelector("input");
    const season = root.querySelector("[data-window='season']");
    if (wrap) wrap.classList.toggle("active", state.key === "recent");
    if (season) season.classList.toggle("active", state.key === "season");
    if (input && document.activeElement !== input) input.value = String(state.days);
  }

  function mount(root, onChange) {
    if (!root) return;
    if (root.dataset.ready === "1") {
      sync(root);
      return;
    }
    root.innerHTML = "";
    const wrap = document.createElement("label");
    wrap.className = "window-days";
    wrap.append("Last");
    const input = document.createElement("input");
    input.type = "number";
    input.min = "1";
    input.max = "365";
    input.step = "1";
    input.value = String(state.days);
    input.setAttribute("aria-label", "Last days");
    function goRecent() {
      state.key = "recent";
      sync(root);
    }
    input.addEventListener("focus", goRecent);
    input.addEventListener("input", function () {
      goRecent();
      clearTimeout(state.timer);
      state.timer = setTimeout(function () {
        const n = clampDays(input.value);
        if (!n) return;
        state.days = n;
        state.key = "recent";
        onChange();
      }, 350);
    });
    input.addEventListener("change", function () {
      clearTimeout(state.timer);
      const n = clampDays(input.value);
      if (!n) return;
      state.days = n;
      state.key = "recent";
      onChange();
    });
    wrap.append(input, "days");
    const season = document.createElement("button");
    season.type = "button";
    season.dataset.window = "season";
    season.textContent = "Full season";
    season.addEventListener("click", function () {
      clearTimeout(state.timer);
      state.key = "season";
      onChange();
    });
    root.append(wrap, season);
    root.dataset.ready = "1";
    sync(root);
  }

  global.RIFT_WINDOW = {
    DEFAULT_DAYS: DEFAULT_DAYS,
    init: init,
    param: param,
    cutoff: cutoff,
    mount: mount,
    sync: sync,
    get key() {
      return state.key;
    },
    get days() {
      return state.days;
    },
    isRecent: function () {
      return state.key === "recent";
    },
  };
})(window);
