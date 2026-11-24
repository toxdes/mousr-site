// Wires the demo page controls to the emulator.
(function () {
  "use strict";
  const M = window.Mousr;
  const $ = (id) => document.getElementById(id);
  const canvas = $("demo-canvas");
  const overlay = $("focus-overlay");
  const logBox = $("log");
  const keycast = $("keycast");
  const form = $("settings");

  function log(level, message) {
    const line = document.createElement("div");
    line.className = level.toLowerCase();
    const time = document.createElement("span");
    time.className = "t";
    time.textContent = new Date().toISOString().slice(11, 23);
    const tag = document.createElement("span");
    tag.className = "l";
    tag.textContent = level;
    line.append(time, " ", tag, " ", message);
    const pinned = logBox.scrollTop + logBox.clientHeight >= logBox.scrollHeight - 4;
    logBox.append(line);
    while (logBox.childElementCount > 200) logBox.firstElementChild.remove();
    if (pinned) logBox.scrollTop = logBox.scrollHeight;
  }

  function cast(label) {
    const key = document.createElement("kbd");
    key.textContent = label;
    keycast.append(key);
    while (keycast.childElementCount > 14) keycast.firstElementChild.remove();
    setTimeout(() => key.classList.add("fade"), 1600);
    setTimeout(() => key.remove(), 2200);
  }

  // ---- challenges ----
  const items = [...document.querySelectorAll("#challenges li")];
  const hitKinds = new Set();
  function complete(id) {
    const item = items.find((li) => li.dataset.id === id);
    if (!item || item.classList.contains("done")) return;
    item.classList.add("done");
    const done = items.filter((li) => li.classList.contains("done")).length;
    $("progress").style.width = `${(done / items.length) * 100}%`;
    log("INF", `exercise complete: ${item.textContent.trim()}`);
  }
  function onEvent(type, data) {
    const mode = emulator.state().mode;
    if (type === "target-hit" && mode !== "idle") {
      if (data.kind === "left" && mode === "grid") complete("hit");
      if (data.tiny) complete("tiny");
      hitKinds.add(data.kind);
      if (hitKinds.has("right") && hitKinds.has("double")) complete("buttons");
    }
    if (type === "refined") complete("refine");
    if (type === "file-archived" && mode === "mouse") complete("drag");
    if (type === "reader-scrolled" && mode !== "idle") complete("scroll");
  }

  // ---- status ----
  const status = { mode: $("st-mode"), pointer: $("st-pointer"), speed: $("st-speed"), buttons: $("st-buttons") };
  let previous = {};
  function onState(state) {
    const next = {
      mode: state.mode === "grid" ? `grid ${state.depth}${state.prefix ? ` "${state.prefix}"` : ""}` : state.mode,
      pointer: `${state.x}, ${state.y}`,
      speed: String(state.speed),
      buttons: state.lockPending ? "lock…" : state.buttons.length ? state.buttons.join("+") + (state.locked ? " (locked)" : "") : "none",
    };
    for (const key in next) if (next[key] !== previous[key]) status[key].textContent = next[key];
    previous = next;
  }

  // ---- settings ----
  function readSettings() {
    const patch = {};
    for (const el of form.elements) {
      if (!el.name) continue;
      const [section, key] = el.name.split(".");
      const numeric = el.type === "range" || el.type === "hidden" || key === "refinement_zoom";
      (patch[section] ||= {})[key] = el.type === "checkbox" ? el.checked : numeric ? Number(el.value) : el.value;
      const out = el.closest("label")?.querySelector("output");
      if (out) out.textContent = el.value;
    }
    return patch;
  }

  function toml(patch) {
    const blocks = [];
    for (const [section, values] of Object.entries(patch)) {
      const changed = Object.entries(values).filter(([key, value]) => M.DEFAULTS[section][key] !== value);
      if (!changed.length) continue;
      const lines = changed.map(([key, value]) => {
        const float = typeof value === "number" && Number.isInteger(value) && /speed|acceleration|zoom/.test(key);
        const literal = typeof value === "string" ? `"${value}"` : float ? value.toFixed(1) : String(value);
        return `${key} = ${literal}`;
      });
      blocks.push(`[${section}]\n${lines.join("\n")}`);
    }
    return blocks.length ? blocks.join("\n\n") : "# Everything matches the built-in defaults.";
  }

  function drawCurve(motion) {
    const c = $("curve");
    const dpr = devicePixelRatio || 1;
    const w = c.clientWidth, h = c.clientHeight;
    c.width = w * dpr;
    c.height = h * dpr;
    const ctx = c.getContext("2d");
    ctx.scale(dpr, dpr);
    const css = getComputedStyle(document.documentElement);
    const v = (name) => css.getPropertyValue(name).trim();
    const pad = { l: 10, r: 10, t: 24, b: 20 };
    const seconds = 1.6;
    const top = Math.max(motion.max_speed, motion.initial_speed) * 1.08;
    const x = (t) => pad.l + (t / seconds) * (w - pad.l - pad.r);
    const y = (s) => h - pad.b - (s / top) * (h - pad.t - pad.b);
    const path = new Path2D();
    for (let i = 0; i <= 120; i++) {
      const t = (i / 120) * seconds;
      i ? path.lineTo(x(t), y(M.motionSpeed(motion, t))) : path.moveTo(x(t), y(M.motionSpeed(motion, t)));
    }
    const fill = new Path2D(path);
    fill.lineTo(x(seconds), h - pad.b);
    fill.lineTo(x(0), h - pad.b);
    ctx.fillStyle = v("--accent-soft");
    ctx.fill(fill);
    ctx.strokeStyle = v("--accent");
    ctx.lineWidth = 2;
    ctx.stroke(path);
    ctx.fillStyle = v("--text-3");
    ctx.font = `11px ${v("--font-sans")}`;
    ctx.fillText("speed while a direction is held", pad.l, 15);
    ctx.textAlign = "right";
    ctx.fillText(`${motion.max_speed} px/s`, w - pad.r, 15);
    ctx.fillText(`${seconds} s`, w - pad.r, h - 6);
    ctx.textAlign = "left";
    ctx.fillText("0 s", pad.l, h - 6);
  }

  function applySettings(initial) {
    const patch = readSettings();
    if (initial) emulator.applyConfig(patch);
    else {
      if (emulator.state().mode !== "idle") log("WRN", "configuration reloaded; active session cancelled");
      emulator.setConfig(patch);
    }
    $("toml").textContent = toml(patch);
    drawCurve(emulator.config.motion);
  }

  // ---- emulator ----
  const emulator = new MousrDemo.Emulator(canvas, {
    width: 1280,
    height: 720,
    on: { log, key: cast, event: onEvent, state: onState },
  });
  window.__mousrEmulator = emulator; // console access for tinkering
  applySettings(true);
  log("INF", "mousr-demo daemon ready on emulated output DEMO-1 (1280×720)");

  form.addEventListener("input", () => applySettings(false));
  form.addEventListener("reset", () => setTimeout(() => applySettings(false)));
  addEventListener("resize", () => drawCurve(emulator.config.motion));
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => drawCurve(emulator.config.motion));
  addEventListener("themechange", () => drawCurve(emulator.config.motion));
  document.fonts?.ready.then(() => drawCurve(emulator.config.motion));

  document.querySelectorAll("[data-launch]").forEach((button) => {
    button.addEventListener("click", () => {
      canvas.focus({ preventScroll: true });
      if (button.dataset.launch === "cancel") emulator.endSession();
      else emulator.launch(button.dataset.launch);
    });
  });

  const syncFocus = () => overlay.classList.toggle("hidden", document.activeElement === canvas);
  canvas.addEventListener("focus", syncFocus);
  canvas.addEventListener("blur", syncFocus);
  overlay.addEventListener("click", () => canvas.focus({ preventScroll: true }));
  // Space focuses the visible demo instead of scrolling the page; controls keep their own Space.
  document.addEventListener("keydown", (e) => {
    if (e.key !== " " || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.repeat) return;
    if (overlay.classList.contains("hidden") || e.target.closest?.("input, textarea, select, button, a, [contenteditable]")) return;
    const r = canvas.getBoundingClientRect();
    if (r.bottom <= 0 || r.top >= innerHeight) return;
    e.preventDefault();
    canvas.focus({ preventScroll: true });
  });
  syncFocus();
})();
