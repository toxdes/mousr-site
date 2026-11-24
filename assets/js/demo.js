// Emulated Sway desktop driven by the Mousr port in core.js.
(function () {
  "use strict";
  const M = window.Mousr;

  const BUTTONS = {
    left: { color: "#38bdf8", key: "s", name: "left" },
    middle: { color: "#a78bfa", key: "d", name: "middle" },
    right: { color: "#f472b6", key: "f", name: "right" },
    double: { color: "#34d399", key: "c", name: "double" },
  };
  const SANS = '"Inter", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  const THEME = {
    wallpaper: ["#0b1020", "#0a0c12"],
    surface: "#0f1115",
    surfaceRaised: "#15181e",
    line: "#22262e",
    text: "#e6e8ec",
    textMuted: "#8a909c",
    focus: "#3b82f6",
    focusSoft: "rgba(59,130,246,0.16)",
  };
  const DOUBLE_CLICK_MS = 400;
  const NOTCH_PX = 48;

  const contains = (r, x, y) => x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;
  const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

  function wrap(ctx, text, width) {
    const lines = [];
    let line = "";
    for (const word of text.split(" ")) {
      const next = line ? `${line} ${word}` : word;
      if (ctx.measureText(next).width > width && line) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    if (line) lines.push(line);
    return lines;
  }

  // ---- Apps ---------------------------------------------------------------

  class TargetsApp {
    constructor(desktop) {
      this.desktop = desktop;
      this.tiny = 6;
      this.sizes = desktop.compact ? [6, 9, 12] : [6, 8, 11, 15, 19];
      this.reset();
    }
    get rect() { return this.desktop.contentOf("targets"); }
    get field() {
      const r = this.rect;
      return { x: r.x + 12, y: r.y + 34, w: r.w - 24, h: r.h - 34 - 30 };
    }
    get resetButton() {
      const r = this.rect;
      return { x: r.x + r.w - 62, y: r.y + 7, w: 52, h: 20 };
    }
    reset() {
      const now = performance.now();
      this.hits = 0;
      this.misses = 0;
      this.times = [];
      this.targets = [];
      this.pops = [];
      this.flash = null;
      this.lastHitAt = now;
      this.lastHit = null;
      const count = this.desktop.compact ? 2 : 3;
      for (let i = 0; i < count; i++) this.spawn(now);
    }
    spawn(now, avoid) {
      const f = this.field;
      const roll = Math.random();
      const kind = roll < 0.5 ? "left" : roll < 0.68 ? "double" : roll < 0.85 ? "right" : "middle";
      const r = this.sizes[Math.floor(Math.random() * this.sizes.length)];
      let best = null;
      for (let attempt = 0; attempt < 40; attempt++) {
        const x = f.x + r + 6 + Math.random() * (f.w - 2 * r - 12);
        const y = f.y + r + 6 + Math.random() * (f.h - 2 * r - 12);
        const others = avoid ? [...this.targets, avoid] : this.targets;
        const gap = Math.min(...others.map((t) => Math.hypot(t.x - x, t.y - y) - t.r - r), 1e9);
        if (!best || gap > best.gap) best = { x, y, gap };
        if (gap > 60) break;
      }
      this.targets.push({ x: best.x, y: best.y, r, kind, born: now });
    }
    hitAt(x, y) {
      return this.targets.findIndex((t) => Math.hypot(t.x - x, t.y - y) <= t.r + 2);
    }
    press(button, x, y, now) {
      if (contains(this.resetButton, x, y)) {
        if (button === "left") this.reset();
        return;
      }
      const index = this.hitAt(x, y);
      if (index < 0) {
        const recent = this.lastHit && now - this.lastHit.at < DOUBLE_CLICK_MS && Math.hypot(this.lastHit.x - x, this.lastHit.y - y) < 8;
        if (!recent && contains(this.field, x, y)) {
          this.misses++;
          this.desktop.emit("target-miss", { x, y });
        }
        return;
      }
      const target = this.targets[index];
      if (target.kind === button) this.hit(index, now);
      else if (!(target.kind === "double" && button === "left")) {
        this.flash = { at: now, text: `Requires ${target.kind === "double" ? "a double-click" : `a ${target.kind} click`}, key ${BUTTONS[target.kind].key}`, x: target.x, y: target.y };
      }
    }
    doubleClick(x, y, now) {
      const index = this.hitAt(x, y);
      if (index >= 0 && this.targets[index].kind === "double") this.hit(index, now);
    }
    hit(index, now) {
      const [target] = this.targets.splice(index, 1);
      const elapsed = (now - Math.max(this.lastHitAt, target.born)) / 1000;
      this.times.push(elapsed);
      this.hits++;
      this.lastHitAt = now;
      this.lastHit = { at: now, x: target.x, y: target.y };
      this.pops.push({ ...target, at: now });
      this.spawn(now, target);
      this.desktop.emit("target-hit", { kind: target.kind, r: target.r, tiny: target.r <= this.tiny, seconds: elapsed });
    }
    draw(ctx, now) {
      const r = this.rect;
      const compact = this.desktop.compact;
      ctx.fillStyle = THEME.surface;
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.fillStyle = "rgba(148,163,184,0.10)";
      for (let x = r.x + 16; x < r.x + r.w; x += 24) {
        for (let y = r.y + 40; y < r.y + r.h - 28; y += 24) ctx.fillRect(x, y, 1.5, 1.5);
      }
      // HUD
      ctx.font = `600 12px ${SANS}`;
      ctx.fillStyle = "#e2e8f0";
      const avg = this.times.length ? this.times.reduce((a, b) => a + b, 0) / this.times.length : 0;
      const best = this.times.length ? Math.min(...this.times) : 0;
      const hud = compact
        ? `Hits ${this.hits}`
        : `Hits ${this.hits}    Misses ${this.misses}    Average ${avg ? avg.toFixed(2) + " s" : "none"}    Best ${best ? best.toFixed(2) + " s" : "none"}`;
      ctx.fillText(hud, r.x + 12, r.y + 21);
      if (!compact) {
        const b = this.resetButton;
        const hover = contains(b, this.desktop.pointer.x, this.desktop.pointer.y);
        ctx.fillStyle = hover ? "#2a2e36" : THEME.line;
        ctx.fillRect(b.x, b.y, b.w, b.h);
        ctx.fillStyle = "#cbd5e1";
        ctx.font = `500 11px ${SANS}`;
        ctx.fillText("Reset", b.x + 12, b.y + 14);
      }
      ctx.fillStyle = "rgba(148,163,184,0.18)";
      ctx.fillRect(r.x, r.y + 33, r.w, 1);

      for (const t of this.targets) {
        const age = Math.min((now - t.born) / 180, 1);
        const radius = t.r * (0.6 + 0.4 * age);
        const color = BUTTONS[t.kind].color;
        ctx.beginPath();
        ctx.arc(t.x, t.y, radius, 0, Math.PI * 2);
        ctx.fillStyle = color + "33";
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = color;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(t.x, t.y, Math.max(radius * 0.32, 1.5), 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        if (t.kind === "double") {
          ctx.beginPath();
          ctx.arc(t.x, t.y, radius + 3.5, 0, Math.PI * 2);
          ctx.lineWidth = 1;
          ctx.stroke();
        }
      }
      this.pops = this.pops.filter((p) => now - p.at < 360);
      for (const p of this.pops) {
        const k = (now - p.at) / 360;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r + k * 22, 0, Math.PI * 2);
        ctx.strokeStyle = BUTTONS[p.kind].color + Math.round((1 - k) * 255).toString(16).padStart(2, "0");
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      if (this.flash && now - this.flash.at < 1100) {
        ctx.font = `500 11px ${SANS}`;
        const w = ctx.measureText(this.flash.text).width + 14;
        const x = clamp(this.flash.x - w / 2, r.x + 4, r.x + r.w - w - 4);
        const y = clamp(this.flash.y - 34, r.y + 38, r.y + r.h - 50);
        ctx.fillStyle = "rgba(2,6,23,0.9)";
        ctx.fillRect(x, y, w, 20);
        ctx.fillStyle = "#93c5fd";
        ctx.fillText(this.flash.text, x + 7, y + 14);
      }
      if (!compact) {
        // Legend
        let x = r.x + 12;
        const y = r.y + r.h - 14;
        ctx.font = `500 11px ${SANS}`;
        for (const [kind, b] of Object.entries(BUTTONS)) {
          ctx.beginPath();
          ctx.arc(x + 5, y - 4, 5, 0, Math.PI * 2);
          ctx.strokeStyle = b.color;
          ctx.lineWidth = 2;
          ctx.stroke();
          ctx.fillStyle = "#94a3b8";
          const label = `${kind === "double" ? "double-click" : kind} · ${b.key}`;
          ctx.fillText(label, x + 15, y);
          x += ctx.measureText(label).width + 32;
        }
      }
    }
  }

  const FILES = [
    ["notes.md", "#38bdf8"], ["photo.png", "#f472b6"], ["budget.ods", "#34d399"], ["talk.pdf", "#f87171"],
    ["song.flac", "#a78bfa"], ["build.log", "#94a3b8"], ["todo.txt", "#fbbf24"], ["font.ttf", "#2dd4bf"],
  ];

  class FilesApp {
    constructor(desktop) {
      this.desktop = desktop;
      this.reset();
    }
    get rect() { return this.desktop.contentOf("files"); }
    get archive() {
      const r = this.rect;
      const w = Math.min(124, r.w * 0.3);
      return { x: r.x + r.w - w - 12, y: r.y + 30, w, h: Math.min(120, r.h - 42) };
    }
    reset() {
      const r = this.rect;
      const cellW = 84, cellH = 74;
      const columns = Math.max(1, Math.floor((r.w - this.archive.w - 36) / cellW));
      const rows = Math.max(1, Math.floor((r.h - 34) / cellH));
      this.files = FILES.slice(0, columns * rows).map(([name, color], i) => ({
        name, color, archived: false,
        x: r.x + 14 + (i % columns) * cellW,
        y: r.y + 30 + Math.floor(i / columns) * cellH,
      }));
      this.archived = 0;
      this.drag = null;
    }
    fileAt(x, y) {
      for (let i = this.files.length - 1; i >= 0; i--) {
        const f = this.files[i];
        if (!f.archived && contains({ x: f.x, y: f.y, w: 72, h: 64 }, x, y)) return f;
      }
      return null;
    }
    press(button, x, y) {
      if (button !== "left") return;
      if (contains(this.resetLink, x, y)) return this.reset();
      const file = this.fileAt(x, y);
      if (!file) return;
      this.files.splice(this.files.indexOf(file), 1);
      this.files.push(file);
      this.drag = { file, dx: x - file.x, dy: y - file.y, moved: false };
      this.desktop.emit("drag-start", { name: file.name });
    }
    move(x, y) {
      if (!this.drag) return;
      const r = this.rect;
      const f = this.drag.file;
      f.x = clamp(x - this.drag.dx, r.x, r.x + r.w - 72);
      f.y = clamp(y - this.drag.dy, r.y + 26, r.y + r.h - 64);
      this.drag.moved = true;
    }
    release(button) {
      if (button !== "left" || !this.drag) return;
      const f = this.drag.file;
      if (contains(this.archive, f.x + 36, f.y + 28)) {
        f.archived = true;
        this.archived++;
        this.desktop.toast(`Moved ${f.name} to Archive`);
        this.desktop.emit("file-archived", { name: f.name });
      }
      this.drag = null;
    }
    doubleClick(x, y) {
      const file = this.fileAt(x, y);
      if (!file) return;
      this.desktop.toast(`Opened ${file.name}`);
      this.desktop.emit("file-opened", { name: file.name });
    }
    get resetLink() {
      const r = this.rect;
      return { x: r.x + r.w - 52, y: r.y + 4, w: 44, h: 18 };
    }
    draw(ctx) {
      const r = this.rect;
      ctx.fillStyle = THEME.surface;
      ctx.fillRect(r.x, r.y, r.w, r.h);
      ctx.fillStyle = THEME.surfaceRaised;
      ctx.fillRect(r.x, r.y, r.w, 24);
      ctx.font = `500 11px ${SANS}`;
      ctx.fillStyle = "#9ca3af";
      ctx.fillText("~/Downloads", r.x + 10, r.y + 16);
      ctx.fillStyle = contains(this.resetLink, this.desktop.pointer.x, this.desktop.pointer.y) ? "#e5e7eb" : "#6b7280";
      ctx.fillText("Reset", this.resetLink.x + 8, r.y + 16);

      const a = this.archive;
      const hot = this.drag && contains(a, this.drag.file.x + 36, this.drag.file.y + 28);
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = hot ? THEME.focus : "#363b45";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(a.x + 0.5, a.y + 0.5, a.w - 1, a.h - 1);
      ctx.setLineDash([]);
      if (hot) {
        ctx.fillStyle = THEME.focusSoft;
        ctx.fillRect(a.x, a.y, a.w, a.h);
      }
      const fx = a.x + a.w / 2 - 22, fy = a.y + a.h / 2 - 26;
      ctx.fillStyle = "#2563eb";
      ctx.fillRect(fx, fy, 18, 6);
      ctx.fillStyle = "#3b82f6";
      ctx.fillRect(fx, fy + 4, 44, 30);
      ctx.fillStyle = "#e5e7eb";
      ctx.font = `500 11px ${SANS}`;
      ctx.textAlign = "center";
      ctx.fillText(`Archive (${this.archived})`, a.x + a.w / 2, fy + 50);

      for (const f of this.files) {
        if (f.archived) continue;
        const dragging = this.drag && this.drag.file === f;
        const hover = !this.drag && this.fileAt(this.desktop.pointer.x, this.desktop.pointer.y) === f;
        if (dragging || hover) {
          ctx.fillStyle = dragging ? "rgba(56,189,248,0.18)" : "rgba(148,163,184,0.10)";
          ctx.fillRect(f.x, f.y, 72, 64);
        }
        const ix = f.x + 24, iy = f.y + 6;
        ctx.fillStyle = "#e5e7eb";
        ctx.beginPath();
        ctx.moveTo(ix, iy);
        ctx.lineTo(ix + 17, iy);
        ctx.lineTo(ix + 24, iy + 7);
        ctx.lineTo(ix + 24, iy + 32);
        ctx.lineTo(ix, iy + 32);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = f.color;
        ctx.fillRect(ix, iy + 20, 24, 12);
        ctx.fillStyle = "#d1d5db";
        ctx.fillText(f.name, f.x + 36, f.y + 54);
      }
      ctx.textAlign = "left";
    }
  }

  const ARTICLE = [
    ["h", "Grid mode"],
    ["p", "Type a cell label to select the cell. Then press an action key. s, d, and f click. c double-clicks. Space moves the pointer. Return refines the selection."],
    ["h", "Mouse mode"],
    ["p", "Hold h, j, k, or l to move the pointer. Speed increases from 60 to 1800 logical pixels per second. Hold s, d, or f to press a button."],
    ["h", "Scrolling"],
    ["p", "u, e, y, and o scroll up, down, left, and right. One step is 15 units, which equals one wheel notch. This document scrolls in both directions because the code below is wider than the window."],
    ["code", "bindsym Mod1+space exec mousr grid                           # Alt+Space opens the grid on the focused output"],
    ["code", "bindsym Mod1+Shift+space exec mousr mouse                     # Alt+Shift+Space starts mouse mode"],
    ["code", "mousr --log-level debug --log-file ~/.local/state/mousr/logs/debug.json daemon"],
    ["h", "Refinement"],
    ["p", "Each refinement level halves the target cell size until min_tile_width and min_tile_height are reached. When refinement_zoom is above 1.0, Mousr captures a screenshot and draws the selected cell inside a magnified lens."],
    ["p", "BackSpace erases a label character or returns one level. Escape cancels. Mousr releases held buttons on exit."],
    ["h", "Multiple outputs"],
    ["p", "With --scope all, one grid covers every output and each label is unique. Mouse motion uses the global logical coordinate space of the compositor and crosses outputs according to the Sway layout."],
  ];

  class ReaderApp {
    constructor(desktop) {
      this.desktop = desktop;
      this.scroll = { x: 0, y: 0 };
      this.target = { x: 0, y: 0 };
      this.lines = null;
      document.fonts?.ready.then(() => (this.lines = null)); // re-wrap once web fonts load
    }
    get rect() { return this.desktop.contentOf("reader"); }
    layout(ctx) {
      const r = this.rect;
      const width = r.w - 44;
      const lines = [];
      let y = 26;
      let contentWidth = width;
      ARTICLE.forEach(([kind, text], index) => {
        if (kind === "h") {
          y += 10;
          lines.push({ kind, text, y });
          y += 24;
        } else if (kind === "p") {
          ctx.font = `400 13px ${SANS}`;
          for (const line of wrap(ctx, text, width)) {
            lines.push({ kind, text: line, y });
            y += 19;
          }
          y += 9;
        } else {
          ctx.font = M.font(12, 500);
          contentWidth = Math.max(contentWidth, ctx.measureText(text).width + 24);
          lines.push({ kind, text, y });
          y += 22;
          if (ARTICLE[index + 1]?.[0] !== "code") y += 12;
        }
      });
      this.lines = lines;
      this.size = { w: contentWidth + 44, h: y + 20 };
    }
    maxScroll() {
      const r = this.rect;
      return { x: Math.max(0, this.size.w - r.w), y: Math.max(0, this.size.h - r.h) };
    }
    scrollBy(direction, amount) {
      const px = (amount / 15) * NOTCH_PX;
      const max = this.maxScroll();
      const t = this.target;
      if (direction === "up") t.y -= px;
      if (direction === "down") t.y += px;
      if (direction === "left") t.x -= px;
      if (direction === "right") t.x += px;
      t.x = clamp(t.x, 0, max.x);
      t.y = clamp(t.y, 0, max.y);
    }
    draw(ctx, dt) {
      if (!this.lines) this.layout(ctx);
      const r = this.rect;
      const k = 1 - Math.exp(-dt / 55);
      this.scroll.x += (this.target.x - this.scroll.x) * k;
      this.scroll.y += (this.target.y - this.scroll.y) * k;
      ctx.save();
      ctx.beginPath();
      ctx.rect(r.x, r.y, r.w, r.h);
      ctx.clip();
      ctx.fillStyle = "#f8fafc";
      ctx.fillRect(r.x, r.y, r.w, r.h);
      const ox = r.x + 22 - this.scroll.x;
      const oy = r.y - this.scroll.y;
      const mono = M.font(12, 500);
      for (const line of this.lines) {
        const y = oy + line.y;
        if (y < r.y - 30 || y > r.y + r.h + 30) continue;
        if (line.kind === "h") {
          ctx.font = `700 16px ${SANS}`;
          ctx.fillStyle = "#0f172a";
          ctx.fillText(line.text, ox, y + 16);
        } else if (line.kind === "p") {
          ctx.font = `400 13px ${SANS}`;
          ctx.fillStyle = "#334155";
          ctx.fillText(line.text, ox, y + 13);
        } else {
          ctx.fillStyle = "#0f172a";
          ctx.fillRect(ox - 8, y - 4, this.size.w - 28, 22);
          ctx.font = mono;
          ctx.fillStyle = "#e2e8f0";
          ctx.fillText(line.text, ox, y + 12);
        }
      }
      // Scrollbars
      const max = this.maxScroll();
      ctx.fillStyle = "rgba(15,23,42,0.35)";
      if (max.y > 0) {
        const h = Math.max(24, (r.h * r.h) / this.size.h);
        ctx.fillRect(r.x + r.w - 6, r.y + (this.scroll.y / max.y) * (r.h - h), 4, h);
      }
      if (max.x > 0) {
        const w = Math.max(24, (r.w * r.w) / this.size.w);
        ctx.fillRect(r.x + (this.scroll.x / max.x) * (r.w - w), r.y + r.h - 6, w, 4);
      }
      ctx.restore();
    }
  }

  // ---- Desktop ------------------------------------------------------------

  class Desktop {
    constructor(width, height, emit) {
      this.width = width;
      this.height = height;
      this.compact = width < 1000;
      this.emit = emit;
      this.pointer = { x: width / 2, y: height / 2 };
      this.focused = "targets";
      this.menu = null;
      this.toasts = [];
      this.ripples = [];
      this.grabs = {};
      this.lastLeft = null;
      this.mode = "idle";
      this.layoutWindows();
      this.apps = { targets: new TargetsApp(this), files: new FilesApp(this), reader: new ReaderApp(this) };
    }
    layoutWindows() {
      const bar = 26, gap = this.compact ? 6 : 10;
      const top = bar + gap;
      const usable = this.height - top - gap;
      const leftW = Math.round((this.width - gap * 3) * 0.52);
      const rightW = this.width - gap * 3 - leftW;
      const filesH = Math.round((usable - gap) * 0.5);
      this.bar = bar;
      this.windows = [
        { id: "targets", x: gap, y: top, w: leftW, h: usable },
        { id: "files", x: gap * 2 + leftW, y: top, w: rightW, h: filesH },
        { id: "reader", x: gap * 2 + leftW, y: top + filesH + gap, w: rightW, h: usable - filesH - gap },
      ];
    }
    contentOf(id) {
      const w = this.windows.find((win) => win.id === id);
      return { x: w.x + 2, y: w.y + 2, w: w.w - 4, h: w.h - 4 };
    }
    windowAt(x, y) {
      return this.windows.find((w) => contains(w, x, y)) || null;
    }
    toast(text) {
      this.toasts.push({ text, at: performance.now() });
      if (this.toasts.length > 3) this.toasts.shift();
    }

    move(x, y) {
      this.pointer = { x, y };
      const win = this.windowAt(x, y);
      if (win && !Object.keys(this.grabs).length) this.focused = win.id; // focus_follows_mouse
      if (this.menu) this.menu.hover = this.menuItemAt(x, y);
      this.apps.files.move(x, y);
    }
    button(button, pressed, now = performance.now()) {
      const { x, y } = this.pointer;
      if (!pressed) {
        const app = this.grabs[button];
        delete this.grabs[button];
        if (app) app.release?.(button, x, y);
        return;
      }
      this.ripples.push({ x, y, button, at: now });
      if (this.menu) {
        const item = this.menuItemAt(x, y);
        this.menu = null;
        if (item != null && button === "left") {
          this.toast(`${MENU_ITEMS[item]}`);
          this.emit("menu-item", { item: MENU_ITEMS[item] });
          return;
        }
      }
      const win = this.windowAt(x, y);
      if (!win) return;
      this.focused = win.id;
      const app = this.apps[win.id];
      const content = this.contentOf(win.id);
      if (!contains(content, x, y)) return;
      this.grabs[button] = app;
      if (button === "right" && win.id !== "targets") {
        this.menu = { x: Math.min(x, this.width - 150), y: Math.min(y, this.height - MENU_ITEMS.length * 24 - 10), hover: null };
        return;
      }
      app.press?.(button, x, y, now);
      if (button === "left") {
        const last = this.lastLeft;
        if (last && now - last.at < DOUBLE_CLICK_MS && Math.hypot(last.x - x, last.y - y) < 6) {
          this.lastLeft = null;
          app.doubleClick?.(x, y, now);
        } else this.lastLeft = { at: now, x, y };
      }
    }
    scroll(direction, amount) {
      const win = this.windowAt(this.pointer.x, this.pointer.y);
      if (!win) return false;
      if (win.id === "reader") {
        this.apps.reader.scrollBy(direction, amount);
        this.emit("reader-scrolled", { direction });
      }
      return win.id;
    }
    menuItemAt(x, y) {
      if (!this.menu) return null;
      const i = Math.floor((y - this.menu.y - 4) / 24);
      return x >= this.menu.x && x < this.menu.x + 140 && i >= 0 && i < MENU_ITEMS.length ? i : null;
    }

    draw(ctx, now, dt) {
      const wall = ctx.createLinearGradient(0, 0, this.width, this.height);
      wall.addColorStop(0, THEME.wallpaper[0]);
      wall.addColorStop(1, THEME.wallpaper[1]);
      ctx.fillStyle = wall;
      ctx.fillRect(0, 0, this.width, this.height);
      this.drawBar(ctx);
      for (const win of this.windows) {
        const focused = win.id === this.focused;
        ctx.fillStyle = focused ? THEME.focus : THEME.line;
        ctx.fillRect(win.x, win.y, win.w, win.h);
        const c = this.contentOf(win.id);
        ctx.save();
        ctx.beginPath();
        ctx.rect(c.x, c.y, c.w, c.h);
        ctx.clip();
        this.apps[win.id].draw(ctx, now, dt);
        ctx.restore();
      }
      this.ripples = this.ripples.filter((r) => now - r.at < 420);
      for (const r of this.ripples) {
        const k = (now - r.at) / 420;
        ctx.beginPath();
        ctx.arc(r.x, r.y, 6 + k * 20, 0, Math.PI * 2);
        ctx.strokeStyle = BUTTONS[r.button].color;
        ctx.globalAlpha = 1 - k;
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
      if (this.menu) this.drawMenu(ctx);
      this.drawToasts(ctx, now);
    }
    drawBar(ctx) {
      ctx.fillStyle = "rgba(8,10,15,0.85)";
      ctx.fillRect(0, 0, this.width, this.bar);
      ctx.font = M.font(12, 500);
      ["1", "2", "3"].forEach((ws, i) => {
        const x = 8 + i * 26;
        if (i === 0) {
          ctx.fillStyle = THEME.focusSoft;
          ctx.fillRect(x, 4, 22, this.bar - 8);
        }
        ctx.fillStyle = i === 0 ? "#93c5fd" : THEME.textMuted;
        ctx.fillText(ws, x + 7.5, 17);
      });
      const d = new Date();
      const clock = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
      ctx.textAlign = "right";
      ctx.fillStyle = THEME.text;
      ctx.fillText(clock, this.width - 12, 17);
      if (this.mode !== "idle") {
        ctx.fillStyle = "#93c5fd";
        ctx.fillText(`mousr · ${this.mode}    `, this.width - 12 - ctx.measureText(clock).width, 17);
      }
      ctx.textAlign = "left";
    }
    drawMenu(ctx) {
      const m = this.menu;
      const h = MENU_ITEMS.length * 24 + 8;
      ctx.fillStyle = "rgba(0,0,0,0.4)";
      ctx.fillRect(m.x + 2, m.y + 6, 140, h);
      ctx.fillStyle = THEME.surfaceRaised;
      ctx.fillRect(m.x, m.y, 140, h);
      ctx.strokeStyle = THEME.line;
      ctx.strokeRect(m.x + 0.5, m.y + 0.5, 139, h - 1);
      ctx.font = `400 12px ${SANS}`;
      MENU_ITEMS.forEach((item, i) => {
        if (m.hover === i) {
          ctx.fillStyle = THEME.focusSoft;
          ctx.fillRect(m.x + 4, m.y + 4 + i * 24, 132, 24);
        }
        ctx.fillStyle = THEME.text;
        ctx.fillText(item, m.x + 14, m.y + 20 + i * 24);
      });
    }
    drawToasts(ctx, now) {
      this.toasts = this.toasts.filter((t) => now - t.at < 2400);
      ctx.font = `500 12px ${SANS}`;
      this.toasts.forEach((t, i) => {
        const w = Math.max(200, ctx.measureText(t.text).width + 32);
        const x = this.width - w - 14;
        const y = this.bar + 14 + i * 44;
        ctx.globalAlpha = Math.min(1, (2400 - (now - t.at)) / 300);
        ctx.fillStyle = THEME.surfaceRaised;
        ctx.fillRect(x, y, w, 36);
        ctx.strokeStyle = THEME.line;
        ctx.strokeRect(x + 0.5, y + 0.5, w - 1, 35);
        ctx.fillStyle = THEME.focus;
        ctx.fillRect(x, y, 3, 36);
        ctx.fillStyle = THEME.text;
        ctx.fillText(t.text, x + 16, y + 22);
        ctx.globalAlpha = 1;
      });
    }
  }
  const MENU_ITEMS = ["Open", "Copy path", "Rename…", "Move to trash"];

  // ---- Emulator -----------------------------------------------------------

  class Emulator {
    constructor(canvas, options = {}) {
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d");
      this.width = options.width || 1280;
      this.height = options.height || 720;
      this.config = M.clone(M.DEFAULTS);
      if (options.config) this.applyConfig(options.config);
      this.on = options.on || {};
      this.interactive = options.interactive !== false;
      // Rendering budget: backing-store density cap and frame-rate cap.
      this.maxDpr = options.maxDpr || 2;
      this.frameMs = 1000 / (options.fps || 60);
      this.lastRender = 0;
      this.activeUntil = 0;
      this.desktop = new Desktop(this.width, this.height, (type, data) => this.handleDesktopEvent(type, data));
      this.session = null;
      this.directions = new Map();
      this.buttonKeys = new Map();
      this.lockPending = false;
      this.lockedButton = null;
      this.motion = { started: null, accumulator: 0, distance: 0, speed: 0 };
      this.last = performance.now();
      this.resize();
      if (this.interactive) this.bindInput();
      if ("ResizeObserver" in window) new ResizeObserver(() => this.resize()).observe(canvas);
      this.running = options.paused !== true;
      if (this.running) requestAnimationFrame((t) => this.frame(t));
      else this.render(this.last, 0);
    }

    applyConfig(patch) {
      for (const [section, values] of Object.entries(patch)) Object.assign(this.config[section], values);
    }
    setConfig(patch) {
      this.wake();
      if (this.session) this.endSession("config reloaded");
      this.applyConfig(patch);
    }

    log(level, message) { this.on.log?.(level, message); }
    handleDesktopEvent(type, data) {
      this.wake();
      if (type === "target-hit") this.log("INF", `target hit: ${data.kind}, r=${data.r}px, ${data.seconds.toFixed(2)} s`);
      if (type === "target-miss") this.log("WRN", `missed at ${Math.round(data.x)},${Math.round(data.y)}`);
      if (type === "file-archived") this.log("INF", `dropped ${data.name} on Archive`);
      this.on.event?.(type, data);
    }

    resize() {
      const rect = this.canvas.getBoundingClientRect();
      if (!rect.width) return;
      const dpr = Math.min(window.devicePixelRatio || 1, this.maxDpr);
      this.scale = rect.width / this.width;
      this.canvas.width = Math.round(rect.width * dpr);
      this.canvas.height = Math.round(rect.width * (this.height / this.width) * dpr);
      this.pixelScale = this.scale * dpr;
      this.wake();
      if (!this.running) this.render(performance.now(), 0);
    }

    // Keeps rendering for a while after any change; covers toasts (2.4 s) and other short effects.
    wake() {
      this.activeUntil = performance.now() + 2600;
    }
    needsRender(now) {
      if (now < this.activeUntil || this.directions.size || this.motion.speed > 0 || this.session?.animation) return true;
      const minute = Math.floor(Date.now() / 60000);
      if (minute === this.renderedMinute) return false;
      this.renderedMinute = minute;
      return true;
    }

    // -- pointer primitives (what the daemon emits) --
    moveTo(x, y) {
      this.wake();
      const px = clamp(x, 0, this.width - 1);
      const py = clamp(y, 0, this.height - 1);
      this.desktop.move(px, py);
    }
    get pointer() { return this.desktop.pointer; }
    pressButton(button, pressed) {
      this.log("DBG", `pointer button ${button} ${pressed ? "pressed" : "released"}`);
      this.desktop.button(button, pressed);
      this.on.event?.(pressed ? "button-down" : "button-up", { button });
    }
    click(button) {
      this.pressButton(button, true);
      this.pressButton(button, false);
    }
    scroll(direction) {
      const amount = direction === "up" || direction === "down" ? this.config.scroll.vertical_step : this.config.scroll.horizontal_step;
      const target = this.desktop.scroll(direction, amount);
      this.log("DBG", `scroll ${direction} ${amount.toFixed(1)} (${Math.max(1, Math.round(amount / 15))} notch) at ${target || "desktop"}`);
    }

    // -- sessions --
    launch(kind, untilRelease = null) {
      this.wake();
      if (this.session) this.endSession();
      this.desktop.menu = null;
      if (kind === "grid") {
        const grid = new M.GridSession({ x: 0, y: 0, width: this.width, height: this.height }, this.config);
        this.session = { kind: "grid", grid, shots: [null], animation: null };
        const columns = new Set(grid.layout.tiles.map((t) => t.bounds.x)).size;
        this.log("INF", `grid: ${grid.layout.tiles.length} cells (${columns}×${grid.layout.tiles.length / columns}), ${grid.layout.labelLength}-char labels`);
      } else {
        this.session = { kind: "mouse", untilRelease };
        this.log("INF", untilRelease ? "mouse mode until M is released" : "mouse mode");
      }
      this.desktop.mode = kind;
      this.on.event?.("session", { kind });
    }
    endSession(reason) {
      this.wake();
      if (!this.session) return;
      if (this.session.kind === "mouse") this.releaseAll();
      this.session = null;
      this.desktop.mode = "idle";
      this.log("INF", reason ? `session cancelled: ${reason}` : "session ended");
      this.on.event?.("session", { kind: "idle" });
    }
    releaseAll() {
      const held = new Set(this.buttonKeys.values());
      if (this.lockedButton) held.add(this.lockedButton);
      held.forEach((button) => this.pressButton(button, false));
      this.buttonKeys.clear();
      this.directions.clear();
      this.lockPending = false;
      this.lockedButton = null;
    }
    buttonIsDown(button) {
      return this.lockedButton === button || [...this.buttonKeys.values()].includes(button);
    }

    // -- keyboard --
    keyDown(event) {
      this.wake();
      const { key, code, repeat } = event;
      if (!this.session) {
        if (key === " " && !event.ctrlKey && !event.metaKey) {
          this.on.key?.(`${event.altKey ? "Alt+" : ""}${event.shiftKey ? "Shift+" : ""}Space`);
          this.launch(event.shiftKey ? "mouse" : "grid");
          return true;
        }
        if (code === HOLD_CODE && !repeat && !event.altKey && !event.shiftKey) {
          this.on.key?.("M (hold)");
          this.launch("mouse", code);
          return true;
        }
        if (key === "Escape" && this.desktop.menu) {
          this.desktop.menu = null;
          return true;
        }
        return false;
      }
      if (code === this.session.untilRelease) return true; // reserved for the session lifetime
      if (!repeat) this.on.key?.(keyLabel(key));
      if (this.session.kind === "grid") return this.gridKey(key, repeat), true;
      this.mouseKeyDown(key, code, repeat);
      return true;
    }
    keyUp(event) {
      this.wake();
      if (!this.session || this.session.kind !== "mouse") return false;
      const { code } = event;
      if (code === this.session.untilRelease) {
        this.endSession("M released");
        return true;
      }
      this.directions.delete(code);
      if (this.buttonKeys.has(code)) {
        const button = this.buttonKeys.get(code);
        this.buttonKeys.delete(code);
        if (!this.buttonIsDown(button)) this.pressButton(button, false);
      }
      return true;
    }

    gridKey(key, repeat) {
      if (repeat && key !== "Backspace") return;
      const s = this.session;
      if (s.animation) s.animation = null; // input interrupts the lens transition
      const grid = s.grid;
      const before = grid.prefix;
      const result = grid.key(key);
      if (grid.prefix !== before && grid.selected != null) {
        const c = M.center(grid.selectedTile().bounds);
        this.log("DBG", `selected "${grid.prefix}" at ${c.x},${c.y}`);
      }
      const t = result.transition;
      if (t) {
        if (t.kind === "descend") {
          s.shots.push(t.view ? this.capture() : null);
          const columns = new Set(grid.layout.tiles.map((tile) => tile.bounds.x)).size;
          this.log("INF", `refine: depth ${grid.depth}, ${grid.layout.tiles.length} cells (${columns}×${grid.layout.tiles.length / columns})${t.view ? `, lens ${t.view.destination.width}×${t.view.destination.height}` : ""}`);
          this.on.event?.("refined", { depth: grid.depth });
        } else {
          s.shots.pop();
        }
        s.animation = M.lensAnimation(t, this.config.ui.lens_animation_ms, performance.now());
      }
      for (const effect of result.effects) {
        if (!this.session) break;
        switch (effect.type) {
          case "warp":
            this.log("DBG", `pointer warp ${effect.x},${effect.y}`);
            this.moveTo(effect.x, effect.y);
            break;
          case "click": this.click(effect.button); break;
          case "doubleclick": this.click("left"); this.click("left"); break;
          case "scroll": this.scroll(effect.direction); break;
          case "mouse": this.session = null; this.launch("mouse"); break;
          case "exit": this.endSession(); break;
        }
      }
    }

    mouseKeyDown(key, code, repeat) {
      const b = this.config.bindings.mouse;
      if (key === b.cancel || key === "q") return this.endSession();
      if (key === b.double_click) {
        if (!repeat) { this.click("left"); this.click("left"); }
        return;
      }
      const buttonFor = { [b.left_button]: "left", [b.middle_button]: "middle", [b.right_button]: "right" };
      if (key === b.button_lock) {
        if (repeat) return;
        if (this.lockedButton) {
          const button = this.lockedButton;
          this.lockedButton = null;
          if (!this.buttonIsDown(button)) this.pressButton(button, false);
        } else this.lockPending = !this.lockPending;
        return;
      }
      if (this.lockPending) {
        this.lockPending = false;
        const button = buttonFor[key];
        if (button) {
          const wasDown = this.buttonIsDown(button);
          this.lockedButton = button;
          if (!wasDown) this.pressButton(button, true);
          return;
        }
      }
      const direction = { [b.left]: [-1, 0], [b.right]: [1, 0], [b.up]: [0, -1], [b.down]: [0, 1] }[key];
      if (direction) {
        this.directions.set(code, direction);
        return;
      }
      const button = buttonFor[key];
      if (button) {
        if (repeat) return;
        const alreadyHeld = this.buttonIsDown(button);
        if (!this.buttonKeys.has(code)) {
          this.buttonKeys.set(code, button);
          if (!alreadyHeld) this.pressButton(button, true);
        }
        return;
      }
      const scroll = { [b.scroll_up]: "up", [b.scroll_down]: "down", [b.scroll_left]: "left", [b.scroll_right]: "right" }[key];
      if (scroll) this.scroll(scroll);
    }

    vector() {
      let x = 0, y = 0;
      const dirs = [...this.directions.values()];
      if (dirs.some((d) => d[0] > 0)) x += 1;
      if (dirs.some((d) => d[0] < 0)) x -= 1;
      if (dirs.some((d) => d[1] > 0)) y += 1;
      if (dirs.some((d) => d[1] < 0)) y -= 1;
      return [x, y];
    }

    // Fixed-rate motion ticks mirror App::motion_tick at motion.tick_hz.
    stepMotion(now, dt) {
      const m = this.motion;
      const [x, y] = this.session && this.session.kind === "mouse" ? this.vector() : [0, 0];
      if (!x && !y) {
        if (m.started != null) this.log("DBG", `motion stop: ${((now - m.started) / 1000).toFixed(2)} s, ${Math.round(m.distance)} px, peak ${Math.round(m.peak)} px/s`);
        m.started = null;
        m.accumulator = 0;
        m.speed = 0;
        return;
      }
      if (m.started == null) {
        m.started = now;
        m.distance = 0;
        m.peak = 0;
        m.accumulator = 1000 / this.config.motion.tick_hz; // first tick fires immediately
      }
      const interval = 1000 / this.config.motion.tick_hz;
      m.accumulator += Math.min(dt, 50);
      let tickTime = now - m.accumulator;
      while (m.accumulator >= interval) {
        m.accumulator -= interval;
        tickTime += interval;
        m.speed = M.motionSpeed(this.config.motion, Math.max(0, tickTime - m.started) / 1000);
        m.peak = Math.max(m.peak, m.speed);
        const distance = m.speed * (interval / 1000);
        m.distance += distance * Math.hypot(x, y);
        this.moveTo(this.pointer.x + x * distance, this.pointer.y + y * distance);
      }
    }

    capture() {
      const k = 2;
      const shot = document.createElement("canvas");
      shot.width = this.width * k;
      shot.height = this.height * k;
      const ctx = shot.getContext("2d");
      ctx.scale(k, k);
      this.desktop.draw(ctx, performance.now(), 0);
      return shot;
    }

    pause() {
      this.running = false;
    }
    resume() {
      if (this.running) return;
      this.running = true;
      this.last = performance.now();
      this.wake();
      requestAnimationFrame((t) => this.frame(t));
    }

    frame(now) {
      if (!this.running) return;
      const dt = Math.min(now - this.last, 100);
      this.last = now;
      this.stepMotion(now, dt);
      this.on.tick?.(now);
      if (now - this.lastRender >= this.frameMs - 2 && this.needsRender(now)) {
        this.render(now, Math.min(now - this.lastRender, 100));
        this.lastRender = now;
        this.on.state?.(this.state());
      }
      requestAnimationFrame((t) => this.frame(t));
    }

    state() {
      const held = new Set(this.buttonKeys.values());
      if (this.lockedButton) held.add(this.lockedButton);
      return {
        mode: this.session ? this.session.kind : "idle",
        x: Math.round(this.pointer.x),
        y: Math.round(this.pointer.y),
        speed: Math.round(this.motion.speed),
        buttons: [...held],
        locked: this.lockedButton,
        lockPending: this.lockPending,
        prefix: this.session?.kind === "grid" ? this.session.grid.prefix : "",
        depth: this.session?.kind === "grid" ? this.session.grid.depth : 0,
      };
    }

    render(now, dt) {
      const ctx = this.ctx;
      ctx.setTransform(this.pixelScale, 0, 0, this.pixelScale, 0, 0);
      ctx.textBaseline = "alphabetic";
      this.desktop.draw(ctx, now, dt);
      const s = this.session;
      if (s && s.kind === "grid") {
        const grid = s.grid;
        let view = grid.view;
        let transition = 1;
        if (s.animation) {
          const f = M.lensFrame(s.animation, now);
          view = f.view;
          transition = f.progress;
          if (f.done) s.animation = null;
        }
        M.renderGrid(ctx, {
          width: this.width,
          height: this.height,
          layout: grid.layout,
          prefix: grid.prefix,
          selected: grid.selected,
          view,
          screenshot: s.shots[s.shots.length - 1],
          transition,
          hints: grid.hints(),
        }, this.config);
      } else if (s && s.kind === "mouse") {
        const hints = this.config.ui.show_action_hints ? M.mouseHints(this.config.bindings.mouse, this.lockPending, this.lockedButton) : [];
        M.renderMode(ctx, { width: this.width, height: this.height, badge: "MOUSE", point: this.pointer, hints }, this.config);
      }
      M.drawCursor(ctx, this.pointer.x, this.pointer.y);
    }

    bindInput() {
      const c = this.canvas;
      for (const type of ["pointermove", "pointerdown", "pointerup", "wheel", "focus", "blur"]) c.addEventListener(type, () => this.wake(), { passive: true });
      const toLogical = (e) => {
        const r = c.getBoundingClientRect();
        return { x: (e.clientX - r.left) / this.scale, y: (e.clientY - r.top) / this.scale };
      };
      const names = ["left", "middle", "right"];
      c.addEventListener("pointermove", (e) => {
        const p = toLogical(e);
        this.moveTo(p.x, p.y);
      });
      c.addEventListener("pointerdown", (e) => {
        c.focus({ preventScroll: true });
        const p = toLogical(e);
        this.moveTo(p.x, p.y);
        if (this.session && this.session.kind === "grid") this.endSession("pointer input");
        if (names[e.button]) this.pressButton(names[e.button], true);
        c.setPointerCapture(e.pointerId);
        e.preventDefault();
      });
      c.addEventListener("pointerup", (e) => {
        if (names[e.button]) this.pressButton(names[e.button], false);
      });
      c.addEventListener("contextmenu", (e) => e.preventDefault());
      c.addEventListener("auxclick", (e) => e.preventDefault());
      c.addEventListener("wheel", (e) => {
        e.preventDefault();
        const amount = Math.abs(e.deltaY || e.deltaX) * (15 / NOTCH_PX);
        const horizontal = Math.abs(e.deltaX) > Math.abs(e.deltaY) || e.shiftKey;
        const direction = horizontal ? ((e.deltaX || e.deltaY) > 0 ? "right" : "left") : e.deltaY > 0 ? "down" : "up";
        this.desktop.scroll(direction, amount);
      }, { passive: false });
      c.addEventListener("keydown", (e) => {
        if (e.ctrlKey || e.metaKey || e.key === "Tab") return;
        if (this.keyDown(e)) e.preventDefault();
      });
      c.addEventListener("keyup", (e) => {
        if (this.keyUp(e)) e.preventDefault();
      });
      c.addEventListener("blur", () => {
        if (this.session) this.endSession("keyboard focus lost");
      });
    }
  }

  // Stands in for a dedicated key bound to `mousr mouse --until-release KEY`.
  // M is unused by Mousr's default mouse bindings and has no unmodified browser shortcut.
  const HOLD_CODE = "KeyM";

  function keyLabel(key) {
    return { " ": "Space", Enter: "Return", Backspace: "BackSpace", Escape: "Esc" }[key] || key;
  }

  // ---- Autoplay (landing-page feature clips) ---------------------------------------

  // Feeds scripted key events through the same Emulator input path.
  class Autoplay {
    // scene: "grid", "refine", or "mouse".
    constructor(emulator, scene) {
      this.emu = emulator;
      this.scene = scene;
      this.queue = [];
      this.waitUntil = 0;
      emulator.on.tick = (now) => this.tick(now);
    }
    press(key, extra = {}) {
      const code = extra.code || (key.length === 1 ? `Key${key.toUpperCase()}` : key);
      this.emu.keyDown({ key, code, repeat: false, ...extra });
      this.emu.keyUp({ key, code });
    }
    labelFor(point) {
      const grid = this.emu.session?.grid;
      if (!grid) return "";
      const tile = grid.layout.tiles.find((t) => contains({ x: t.bounds.x, y: t.bounds.y, w: t.bounds.width, h: t.bounds.height }, point.x, point.y));
      return tile ? tile.label : "";
    }
    script() {
      const targets = this.emu.desktop.apps.targets;
      const pick = () => targets.targets.find((t) => t.kind === "left") || targets.targets[0];
      let aim = null;
      const steps = [];
      const wait = (ms) => steps.push({ wait: ms });
      const run = (fn) => steps.push({ run: fn });
      const typeLabel = () => {
        steps.push({
          expand: () => {
            const label = this.labelFor(aim);
            return [...label].flatMap((ch) => [{ run: () => this.press(ch) }, { wait: 260 }]);
          },
        });
      };
      const hold = (key, ms) => {
        const code = `Key${key.toUpperCase()}`;
        run(() => this.emu.keyDown({ key, code, repeat: false }));
        wait(ms);
        run(() => this.emu.keyUp({ key, code }));
      };
      const openGrid = () => run(() => this.press(" ", { code: "Space", altKey: true }));
      run(() => { aim = pick(); aim.kind = "left"; });
      if (this.scene === "grid") {
        wait(600); openGrid(); wait(1100);
        typeLabel(); wait(900);
        run(() => this.press("s")); wait(1400);
        return steps;
      }
      if (this.scene === "refine") {
        wait(600); openGrid(); wait(900);
        typeLabel(); wait(600);
        run(() => this.press("Enter")); wait(1300);
        typeLabel(); wait(900);
        run(() => this.press("s")); wait(1400);
        return steps;
      }
      // mouse
      wait(500);
      run(() => this.press(" ", { code: "Space", altKey: true, shiftKey: true }));
      wait(400);
      hold("l", 700); wait(200);
      hold("j", 450); wait(200);
      hold("h", 700); wait(200);
      hold("k", 450); wait(500);
      run(() => this.press("Escape")); wait(900);
      return steps;
    }
    tick(now) {
      if (now < this.waitUntil) return;
      if (!this.queue.length) this.queue = this.script();
      while (this.queue.length && now >= this.waitUntil) {
        const step = this.queue.shift();
        if (step.wait) this.waitUntil = now + step.wait;
        else if (step.expand) this.queue.unshift(...step.expand());
        else step.run();
      }
    }
  }

  window.MousrDemo = { Emulator, Autoplay, BUTTONS };
})();
