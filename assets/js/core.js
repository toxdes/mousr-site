// Browser port of Mousr's grid, motion, and overlay rendering.
// Sources: src/grid.rs, src/motion.rs, src/mode.rs, src/animation.rs, src/render.rs.
(function (global) {
  "use strict";

  const DEFAULTS = {
    grid: {
      root_min_tile_width: 96,
      root_min_tile_height: 54,
      min_tile_width: 16,
      min_tile_height: 16,
      refinement_zoom: 1.0,
      max_label_length: 3,
      max_depth: 4,
      max_cells: 4096,
      auto_descend: false,
      exit_on_scroll: false,
      unmatched: "dim",
      unmatched_opacity: 0.18,
    },
    motion: { initial_speed: 60, acceleration: 1400, max_speed: 1800, tick_hz: 120, curve: "ease-in-out" },
    scroll: { vertical_step: 15, horizontal_step: 15 },
    // DOM `KeyboardEvent.key` names stand in for XKB keysyms.
    bindings: {
      grid: {
        left_click: "s", middle_click: "d", right_click: "f", double_click: "c",
        scroll_up: "u", scroll_down: "e", scroll_left: "y", scroll_right: "o",
        enter_mouse: "g", move_only: " ", descend: "Enter", back: "Backspace", cancel: "Escape",
      },
      mouse: {
        left: "h", down: "j", up: "k", right: "l",
        left_button: "s", middle_button: "d", right_button: "f",
        double_click: "c", button_lock: "v",
        scroll_up: "u", scroll_down: "e", scroll_left: "y", scroll_right: "o", cancel: "Escape",
      },
    },
    ui: {
      font_size: 14,
      overlay_background: "#02061759",
      lens_scrim_opacity: 0.72,
      lens_border: "#f59e0bff",
      lens_border_width: 3,
      lens_animation_ms: 120,
      lens_cell_opacity: 0.4,
      cell_background: "#1e293b26",
      grid_border: "#cbd5e199",
      grid_border_width: 1,
      label_background: "#0f172a80",
      label_foreground: "#f8fafcff",
      matched_background: "#f59e0bcc",
      matched_foreground: "#1c1917ff",
      selected_background: "#22c55e38",
      selected_border: "#86efacff",
      selected_border_width: 2,
      badge_background: "#0f172ad9",
      badge_foreground: "#f8fafcff",
      badge_border: "#f59e0bff",
      badge_border_width: 1,
      target_ring: "#f59e0bff",
      target_ring_width: 2.5,
      target_ring_radius: 16,
      show_badge: true,
      show_target_ring: true,
      show_action_hints: true,
    },
  };

  const FONT_STACK = '"Geist Mono", ui-monospace, "JetBrains Mono", "Iosevka", "SF Mono", Menlo, Consolas, monospace';

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  // ---- grid.rs ---------------------------------------------------------

  function center(rect) {
    return { x: rect.x + Math.floor(rect.width / 2), y: rect.y + Math.floor(rect.height / 2) };
  }

  function encodeLabel(index, length) {
    const chars = new Array(length).fill(0);
    for (let i = length - 1; i >= 0; i--) {
      chars[i] = 97 + (index % 26);
      index = Math.floor(index / 26);
    }
    return String.fromCharCode(...chars);
  }

  function labelLength(count, maximum) {
    for (let length = 1; length <= maximum; length++) {
      if (26 ** length >= count) return length;
    }
    throw new Error("grid label overflow");
  }

  function dimensions(bounds, minWidth, minHeight, scale) {
    return {
      columns: Math.max(1, Math.floor(bounds.width / (minWidth * scale))),
      rows: Math.max(1, Math.floor(bounds.height / (minHeight * scale))),
    };
  }

  function cellCount(regions, minWidth, minHeight, scale) {
    return regions.reduce((total, region) => {
      const { columns, rows } = dimensions(region.bounds, minWidth, minHeight, scale);
      return total + columns * rows;
    }, 0);
  }

  function coarseningScale(regions, minWidth, minHeight, capacity) {
    if (cellCount(regions, minWidth, minHeight, 1) <= capacity) return 1;
    let low = 1;
    let high = 2;
    while (cellCount(regions, minWidth, minHeight, high) > capacity) {
      low = high;
      high *= 2;
    }
    for (let i = 0; i < 64; i++) {
      const middle = (low + high) / 2;
      if (cellCount(regions, minWidth, minHeight, middle) > capacity) low = middle;
      else high = middle;
    }
    return high;
  }

  function partition(origin, length, index, count) {
    return origin + Math.floor((length * index) / count);
  }

  // Returns null where Rust returns GridError::RegionTooSmall.
  function buildGrid(regions, grid, minWidth, minHeight) {
    if (regions.some((r) => r.bounds.width < minWidth || r.bounds.height < minHeight)) return null;
    const capacity = Math.min(grid.max_cells, 26 ** grid.max_label_length);
    const scale = coarseningScale(regions, minWidth, minHeight, capacity);
    const dims = regions.map((region) => dimensions(region.bounds, minWidth, minHeight, scale));
    const total = dims.reduce((sum, d) => sum + d.columns * d.rows, 0);
    const length = labelLength(total, grid.max_label_length);
    const tiles = [];
    regions.forEach((region, r) => {
      const { columns, rows } = dims[r];
      const b = region.bounds;
      for (let row = 0; row < rows; row++) {
        for (let column = 0; column < columns; column++) {
          const x0 = partition(b.x, b.width, column, columns);
          const x1 = partition(b.x, b.width, column + 1, columns);
          const y0 = partition(b.y, b.height, row, rows);
          const y1 = partition(b.y, b.height, row + 1, rows);
          tiles.push({
            output: region.output,
            bounds: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 },
            label: encodeLabel(tiles.length, length),
          });
        }
      }
    });
    return { tiles, labelLength: length };
  }

  function descendGrid(tile, grid, minWidth, minHeight) {
    const layout = buildGrid([{ output: tile.output, bounds: tile.bounds }], grid, minWidth, minHeight);
    return layout && layout.tiles.length >= 2 ? layout : null;
  }

  function project(offset, sourceLength, destination, length) {
    return destination + Math.floor((Math.max(0, offset) * length) / Math.max(1, sourceLength));
  }

  function mapRect(view, rect) {
    const s = view.source;
    const d = view.destination;
    const x0 = project(rect.x - s.x, s.width, d.x, d.width);
    const x1 = project(rect.x + rect.width - s.x, s.width, d.x, d.width);
    const y0 = project(rect.y - s.y, s.height, d.y, d.height);
    const y1 = project(rect.y + rect.height - s.y, s.height, d.y, d.height);
    return { x: x0, y: y0, width: Math.max(0, x1 - x0), height: Math.max(0, y1 - y0) };
  }

  // ---- mode.rs: grid session ------------------------------------------

  function sourceMinimum(displayMinimum, sourceLength, displayLength) {
    return Math.max(1, Math.ceil((displayMinimum * sourceLength) / Math.max(1, displayLength)));
  }

  function placeAround(anchor, output, width, height) {
    const cx = anchor.x + Math.floor(anchor.width / 2) - Math.floor(width / 2);
    const cy = anchor.y + Math.floor(anchor.height / 2) - Math.floor(height / 2);
    const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);
    return {
      x: clamp(cx, output.x, output.x + output.width - width),
      y: clamp(cy, output.y, output.y + output.height - height),
      width,
      height,
    };
  }

  // Grid session state machine. Effects are returned as plain objects so
  // the host (demo or hero) decides how to perform them.
  class GridSession {
    constructor(output, config) {
      this.output = output;
      this.config = config;
      const g = config.grid;
      const root = buildGrid([{ output: "demo", bounds: output }], g, g.root_min_tile_width, g.root_min_tile_height);
      this.levels = [root];
      this.views = [null];
      this.prefix = "";
      this.selected = null;
    }

    get layout() { return this.levels[this.levels.length - 1]; }
    get view() { return this.views[this.views.length - 1]; }
    get depth() { return this.levels.length; }
    selectedTile() { return this.selected == null ? null : this.layout.tiles[this.selected]; }

    refinementMinimum() {
      const g = this.config.grid;
      const divisor = 2 ** this.depth;
      return {
        width: Math.max(Math.floor(g.root_min_tile_width / divisor), g.min_tile_width),
        height: Math.max(Math.floor(g.root_min_tile_height / divisor), g.min_tile_height),
      };
    }

    refinementView(tile) {
      const zoom = this.config.grid.refinement_zoom;
      if (zoom <= 1) return null;
      const displayed = this.view ? mapRect(this.view, tile.bounds) : tile.bounds;
      const out = this.output;
      const scale = Math.min(zoom, out.width / Math.max(1, displayed.width), out.height / Math.max(1, displayed.height));
      const width = Math.min(Math.max(Math.round(displayed.width * scale), 1), out.width);
      const height = Math.min(Math.max(Math.round(displayed.height * scale), 1), out.height);
      return { source: tile.bounds, destination: placeAround(displayed, out, width, height) };
    }

    descendant(tile) {
      const display = this.refinementMinimum();
      const view = this.refinementView(tile);
      const minWidth = view ? sourceMinimum(display.width, view.source.width, view.destination.width) : display.width;
      const minHeight = view ? sourceMinimum(display.height, view.source.height, view.destination.height) : display.height;
      const layout = descendGrid(tile, this.config.grid, minWidth, minHeight);
      return layout ? { layout, view } : null;
    }

    canDescend() {
      const tile = this.selectedTile();
      return !!tile && this.depth < this.config.grid.max_depth && !!this.descendant(tile);
    }

    descend() {
      const tile = this.selectedTile();
      if (!tile || this.depth >= this.config.grid.max_depth) return null;
      const next = this.descendant(tile);
      if (!next) return null;
      const previousView = this.view;
      this.levels.push(next.layout);
      this.views.push(next.view);
      this.prefix = "";
      this.selected = null;
      return { kind: "descend", previousView, view: next.view };
    }

    back() {
      if (this.selected != null) {
        this.selected = null;
        this.prefix = this.prefix.slice(0, -1);
        return { kind: "redraw" };
      }
      if (this.prefix) {
        this.prefix = this.prefix.slice(0, -1);
        return { kind: "redraw" };
      }
      if (this.levels.length > 1) {
        const previousView = this.view;
        this.levels.pop();
        this.views.pop();
        return { kind: "ascend", previousView, view: this.view };
      }
      return null;
    }

    // Returns { effects: [...] , transition? }.
    key(key) {
      const b = this.config.bindings.grid;
      if (key === b.cancel) return { effects: [{ type: "exit" }] };
      if (key === b.back) {
        const t = this.back();
        return { effects: [], transition: t && t.kind !== "redraw" ? t : null };
      }
      const tile = this.selectedTile();
      if (tile) {
        const target = center(tile.bounds);
        const warp = { type: "warp", x: target.x, y: target.y };
        const exitOnScroll = this.config.grid.exit_on_scroll ? [{ type: "exit" }] : [];
        const actions = {
          [b.left_click]: () => [warp, { type: "click", button: "left" }, { type: "exit" }],
          [b.middle_click]: () => [warp, { type: "click", button: "middle" }, { type: "exit" }],
          [b.right_click]: () => [warp, { type: "click", button: "right" }, { type: "exit" }],
          [b.double_click]: () => [warp, { type: "doubleclick", button: "left" }, { type: "exit" }],
          [b.move_only]: () => [warp, { type: "exit" }],
          [b.enter_mouse]: () => [warp, { type: "mouse" }],
          [b.scroll_up]: () => [warp, { type: "scroll", direction: "up" }, ...exitOnScroll],
          [b.scroll_down]: () => [warp, { type: "scroll", direction: "down" }, ...exitOnScroll],
          [b.scroll_left]: () => [warp, { type: "scroll", direction: "left" }, ...exitOnScroll],
          [b.scroll_right]: () => [warp, { type: "scroll", direction: "right" }, ...exitOnScroll],
          q: () => [{ type: "exit" }],
        };
        if (key === b.descend) return { effects: [], transition: this.descend() };
        const action = actions[key];
        return { effects: action ? action() : [] };
      }
      if (!/^[a-z]$/.test(key)) return { effects: [] };
      const candidate = this.prefix + key;
      if (!this.layout.tiles.some((t) => t.label.startsWith(candidate))) return { effects: [] };
      this.prefix = candidate;
      const exact = this.layout.tiles.findIndex((t) => t.label === candidate);
      if (exact >= 0) {
        this.selected = exact;
        if (this.config.grid.auto_descend && this.canDescend()) {
          return { effects: [], transition: this.descend() };
        }
      }
      return { effects: [] };
    }

    hints() {
      if (!this.config.ui.show_action_hints || this.selected == null) return [];
      const b = this.config.bindings.grid;
      const k = keyName;
      const hints = [
        [k(b.left_click), "Left click"], [k(b.middle_click), "Middle click"],
        [k(b.right_click), "Right click"], [k(b.double_click), "Double click"],
        [k(b.move_only), "Move pointer"], [k(b.enter_mouse), "Mouse mode"],
        [k(b.scroll_up), "Scroll up"], [k(b.scroll_down), "Scroll down"],
        [k(b.scroll_left), "Scroll left"], [k(b.scroll_right), "Scroll right"],
      ];
      if (this.canDescend()) hints.push([k(b.descend), "Refine grid"]);
      hints.push([k(b.back), "Back"], [k(b.cancel), "Cancel"], ["q", "Quit"]);
      return hints;
    }
  }

  function keyName(key) {
    return { " ": "space", Enter: "Return", Backspace: "BackSpace" }[key] || key;
  }

  function mouseHints(b, lockPending, lockedButton) {
    const hints = [[`${b.left} ${b.down} ${b.up} ${b.right}`, "Move pointer"]];
    if (lockedButton) {
      hints.push([b.button_lock, `Release ${lockedButton} drag`]);
    } else if (lockPending) {
      hints.push([b.left_button, "Lock left"], [b.middle_button, "Lock middle"], [b.right_button, "Lock right"]);
    } else {
      hints.push(
        [`${b.left_button} / ${b.button_lock} ${b.left_button}`, "Left / lock"],
        [`${b.middle_button} / ${b.button_lock} ${b.middle_button}`, "Middle / lock"],
        [`${b.right_button} / ${b.button_lock} ${b.right_button}`, "Right / lock"]
      );
    }
    hints.push(
      [b.double_click, "Double click"], [b.scroll_up, "Scroll up"], [b.scroll_down, "Scroll down"],
      [b.scroll_left, "Scroll left"], [b.scroll_right, "Scroll right"], [b.cancel, "Exit"], ["q", "Quit"]
    );
    return hints;
  }

  // ---- motion.rs --------------------------------------------------------

  function motionSpeed(motion, heldSeconds) {
    const range = motion.max_speed - motion.initial_speed;
    if (range <= 0 || motion.acceleration === 0) return motion.initial_speed;
    const p = Math.min(Math.max((motion.acceleration * heldSeconds) / range, 0), 1);
    const eased = {
      linear: p,
      "ease-in": p * p,
      "ease-out": 1 - (1 - p) ** 2,
      "ease-in-out": p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2,
    }[motion.curve];
    return motion.initial_speed + range * eased;
  }

  // ---- animation.rs -----------------------------------------------------

  function interpolateRect(from, to, t) {
    const lerp = (a, b) => Math.round(a + (b - a) * t);
    return {
      x: lerp(from.x, to.x),
      y: lerp(from.y, to.y),
      width: Math.max(1, lerp(from.width, to.width)),
      height: Math.max(1, lerp(from.height, to.height)),
    };
  }

  // Animates the lens from its previous on-screen rect to its new destination.
  function lensAnimation(transition, durationMs, now) {
    const target = transition.view;
    if (!target || durationMs <= 0) return null;
    const from =
      transition.kind === "descend"
        ? transition.previousView ? mapRect(transition.previousView, target.source) : target.source
        : transition.previousView ? transition.previousView.destination : target.source;
    if (from.x === target.destination.x && from.y === target.destination.y &&
        from.width === target.destination.width && from.height === target.destination.height) return null;
    return { from, target, started: now, duration: durationMs };
  }

  function lensFrame(animation, now) {
    const linear = Math.min(Math.max((now - animation.started) / Math.max(animation.duration, 1e-3), 0), 1);
    const progress = 1 - (1 - linear) ** 3;
    return {
      view: { source: animation.target.source, destination: interpolateRect(animation.from, animation.target.destination, progress) },
      progress,
      done: linear >= 1,
    };
  }

  // ---- render.rs --------------------------------------------------------

  const colorCache = new Map();
  function rgba(hex, opacity = 1) {
    let parsed = colorCache.get(hex);
    if (!parsed) {
      let h = hex.replace("#", "");
      if (h.length <= 4) h = [...h].map((c) => c + c).join("");
      if (h.length === 6) h += "ff";
      parsed = [0, 2, 4, 6].map((i) => parseInt(h.slice(i, i + 2), 16));
      colorCache.set(hex, parsed);
    }
    const [r, g, b, a] = parsed;
    return `rgba(${r},${g},${b},${((a / 255) * opacity).toFixed(4)})`;
  }
  function alphaOf(hex) {
    rgba(hex);
    return colorCache.get(hex)[3] / 255;
  }
  function withOpacity(hex, opacity) {
    rgba(hex);
    const [r, g, b] = colorCache.get(hex);
    return `rgba(${r},${g},${b},${opacity})`;
  }

  function font(size, weight = 600) {
    return `${weight} ${size}px ${FONT_STACK}`;
  }

  function strokeRect(ctx, r, color, width) {
    if (width <= 0) return;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.strokeRect(r.x + width / 2, r.y + width / 2, r.width - width, r.height - width);
  }

  function drawLabel(ctx, bounds, label, prefix, matches, opacity, ui) {
    const size = ui.font_size;
    ctx.font = font(size);
    const advances = [...label].map((c) => ctx.measureText(c).width);
    const textWidth = advances.reduce((a, b) => a + b, 0);
    const padding = Math.max(size * 0.65, 6);
    const pillWidth = textWidth + padding * 2;
    const pillHeight = size * 1.3;
    const left = bounds.x + (bounds.width - pillWidth) / 2;
    const top = bounds.y + (bounds.height - pillHeight) / 2;
    ctx.fillStyle = rgba(ui.label_background, opacity);
    ctx.fillRect(left, top, pillWidth, pillHeight);
    let x = left + padding;
    const baseline = top + size;
    [...label].forEach((c, i) => {
      const matched = matches && i < prefix.length;
      if (matched) {
        ctx.fillStyle = rgba(ui.matched_background, opacity);
        ctx.fillRect(x, top, advances[i], pillHeight);
      }
      ctx.fillStyle = rgba(matched ? ui.matched_foreground : ui.label_foreground, opacity);
      ctx.fillText(c, x, baseline);
      x += advances[i];
    });
  }

  function largestFreeArea(width, height, s) {
    const right = Math.min(s.x + s.width, width);
    const bottom = Math.min(s.y + s.height, height);
    const areas = [
      { x: 0, y: 0, width: Math.min(s.x, width), height },
      { x: right, y: 0, width: Math.max(0, width - right), height },
      { x: 0, y: 0, width, height: Math.min(s.y, height) },
      { x: 0, y: bottom, width, height: Math.max(0, height - bottom) },
    ];
    return areas.reduce((best, a) => (a.width * a.height > best.width * best.height ? a : best));
  }

  function drawActionHints(ctx, hints, area, ui, placement) {
    if (!hints.length) return;
    const size = Math.max(ui.font_size, 11);
    ctx.font = font(size);
    const keyWidth = Math.max(...hints.map(([k]) => ctx.measureText(k).width));
    const actionWidth = Math.max(...hints.map(([, a]) => ctx.measureText(a).width));
    const padding = 14, keyGap = 10, columnGap = 28;
    const entryWidth = keyWidth + keyGap + actionWidth;
    const twoColumnWidth = padding * 2 + entryWidth * 2 + columnGap;
    const columns = hints.length > 5 && twoColumnWidth <= area.width ? 2 : 1;
    const rows = Math.ceil(hints.length / columns);
    const width = padding * 2 + entryWidth * columns + columnGap * (columns - 1);
    const rowHeight = size * 1.55;
    const height = padding * 2 + rowHeight * rows;
    if (width > area.width || height > area.height) return;
    const left = placement === "center" ? area.x + (area.width - width) / 2 : area.x + 18;
    const top = placement === "center" ? area.y + (area.height - height) / 2 : area.y + area.height - height - 18;
    ctx.fillStyle = rgba(ui.badge_background);
    ctx.fillRect(left, top, width, height);
    strokeRect(ctx, { x: left, y: top, width, height }, rgba(ui.badge_border), ui.badge_border_width);
    hints.forEach(([key, action], i) => {
      const column = Math.floor(i / rows);
      const row = i % rows;
      const x = left + padding + column * (entryWidth + columnGap);
      const baseline = top + padding + rowHeight * row + size;
      ctx.fillStyle = rgba(ui.matched_background);
      ctx.fillText(key, x, baseline);
      ctx.fillStyle = rgba(ui.badge_foreground);
      ctx.fillText(action, x + keyWidth + keyGap, baseline);
    });
  }

  // frame: { width, height, layout, prefix, selected, view, screenshot, transition, hints }
  function renderGrid(ctx, frame, config) {
    const ui = config.ui;
    const grid = config.grid;
    const transition = Math.min(Math.max(frame.transition, 0), 1);
    const view = frame.view;
    const contentOpacity = view ? Math.min(Math.max((transition - 0.25) / 0.75, 0), 1) : 1;
    const initial = alphaOf(ui.overlay_background);
    ctx.fillStyle = view
      ? withOpacity(ui.overlay_background, initial + (ui.lens_scrim_opacity - initial) * transition)
      : rgba(ui.overlay_background);
    ctx.fillRect(0, 0, frame.width, frame.height);
    if (view && frame.screenshot) {
      const s = view.source, d = view.destination;
      const k = frame.screenshot.width / frame.width;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(frame.screenshot, s.x * k, s.y * k, s.width * k, s.height * k, d.x, d.y, d.width, d.height);
    }

    const vertical = new Set();
    const horizontal = new Set();
    let selectedBounds = null;
    frame.layout.tiles.forEach((tile, index) => {
      const matches = tile.label.startsWith(frame.prefix);
      const bounds = view ? mapRect(view, tile.bounds) : tile.bounds;
      const visibility = matches || grid.unmatched === "keep" ? 1 : grid.unmatched === "dim" ? grid.unmatched_opacity : 0;
      if (visibility > 0) {
        const cellOpacity = view ? ui.lens_cell_opacity : 1;
        ctx.fillStyle = rgba(ui.cell_background, visibility * cellOpacity * contentOpacity);
        ctx.fillRect(bounds.x, bounds.y, bounds.width, bounds.height);
        drawLabel(ctx, bounds, tile.label, frame.prefix, matches, visibility * contentOpacity, ui);
        vertical.add(bounds.x).add(bounds.x + bounds.width);
        horizontal.add(bounds.y).add(bounds.y + bounds.height);
      }
      if (frame.selected === index) selectedBounds = bounds;
    });

    const area = view ? view.destination : { x: 0, y: 0, width: frame.width, height: frame.height };
    const lineWidth = ui.grid_border_width;
    ctx.fillStyle = rgba(ui.grid_border, contentOpacity);
    vertical.forEach((x) => ctx.fillRect(Math.min(x, area.x + area.width - lineWidth), area.y, lineWidth, area.height));
    horizontal.forEach((y) => ctx.fillRect(area.x, Math.min(y, area.y + area.height - lineWidth), area.width, lineWidth));

    if (selectedBounds) {
      ctx.fillStyle = rgba(ui.selected_background, contentOpacity);
      ctx.fillRect(selectedBounds.x, selectedBounds.y, selectedBounds.width, selectedBounds.height);
      strokeRect(ctx, selectedBounds, rgba(ui.selected_border, contentOpacity), ui.selected_border_width);
    }
    if (view) {
      strokeRect(ctx, view.destination, `rgba(0,0,0,${(220 / 255) * transition})`, ui.lens_border_width + 4);
      strokeRect(ctx, view.destination, rgba(ui.lens_border, transition), ui.lens_border_width);
    }
    if (selectedBounds && frame.hints.length) {
      drawActionHints(ctx, frame.hints, largestFreeArea(frame.width, frame.height, selectedBounds), ui, "center");
    }
  }

  // frame: { width, height, badge, point, hints }
  function renderMode(ctx, frame, config) {
    const ui = config.ui;
    if (ui.show_badge) {
      ctx.font = font(ui.font_size);
      const w = Math.ceil(ctx.measureText(frame.badge).width + 24);
      const h = Math.ceil(ui.font_size * 1.8);
      ctx.fillStyle = rgba(ui.badge_background);
      ctx.fillRect(12, 12, w, h);
      strokeRect(ctx, { x: 12, y: 12, width: w, height: h }, rgba(ui.badge_border), ui.badge_border_width);
      ctx.fillStyle = rgba(ui.badge_foreground);
      ctx.fillText(frame.badge, 24, 12 + h * 0.68);
    }
    if (ui.show_target_ring && frame.point) {
      ctx.beginPath();
      ctx.arc(frame.point.x, frame.point.y, ui.target_ring_radius, 0, Math.PI * 2);
      ctx.strokeStyle = rgba(ui.target_ring);
      ctx.lineWidth = ui.target_ring_width;
      ctx.stroke();
    }
    drawActionHints(ctx, frame.hints, { x: 0, y: 0, width: frame.width, height: frame.height }, ui, "bottom-left");
  }

  function drawCursor(ctx, x, y, scale = 1) {
    ctx.save();
    ctx.translate(Math.round(x), Math.round(y));
    ctx.scale(scale, scale);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, 17);
    ctx.lineTo(4.2, 13);
    ctx.lineTo(7, 19.4);
    ctx.lineTo(9.8, 18.2);
    ctx.lineTo(7, 12);
    ctx.lineTo(12.6, 12);
    ctx.closePath();
    ctx.fillStyle = "#f8fafc";
    ctx.strokeStyle = "#020617";
    ctx.lineWidth = 1.2;
    ctx.lineJoin = "round";
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  global.Mousr = {
    DEFAULTS,
    clone,
    center,
    encodeLabel,
    buildGrid,
    mapRect,
    GridSession,
    mouseHints,
    motionSpeed,
    lensAnimation,
    lensFrame,
    renderGrid,
    renderMode,
    drawCursor,
    rgba,
    font,
  };
})(window);
