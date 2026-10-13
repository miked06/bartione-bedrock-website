/*
 * Interactive pathfinder: a top-down slice of the world and Baritone-style A* with
 * costs in game ticks (ActionCosts). Drag the player and the goal, paint terrain,
 * toggle allowBreak / diagonals. The search is animated like Baritone's renderer:
 * open set, explored nodes, best path so far (blue), then the path (red).
 */
(() => {
  "use strict";

  const canvas = document.getElementById("demo-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const $ = (id) => document.getElementById(id);

  const GRASS = 0, STONE = 1, WATER = 2, LAVA = 3, LOG = 4;
  // ActionCosts (ticks)
  const SPRINT = 3.564, WATER_COST = 9.091;
  const BREAK = { [STONE]: 24, [LOG]: 60 }; // extra ticks to break with a pickaxe / by hand

  let cols = 48, rows = 24, cell = 20, dpr = 1;
  let grid = [];
  let start = { x: 3, y: 12 }, goal = { x: 44, y: 11 };
  let brush = STONE, allowBreak = true, diagonals = true;
  let result = null;           // { path, closed, open, cost, broken }
  let anim = null;             // generator of search steps
  let animState = null;        // live view while animating
  let tiles = {};

  // ------------------------------------------------------------------ terrain
  function rand(seed) {
    let a = seed >>> 0;
    return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  }
  function noise2(r, cellsX, cellsY) {
    const g = Array.from({ length: cellsX + 2 }, () => Array.from({ length: cellsY + 2 }, r));
    const s = (t) => t * t * (3 - 2 * t);
    return (x, y) => {
      const fx = (x / cols) * cellsX, fy = (y / rows) * cellsY, ix = Math.floor(fx), iy = Math.floor(fy);
      const tx = s(fx - ix), ty = s(fy - iy);
      return (g[ix][iy] * (1 - tx) + g[ix + 1][iy] * tx) * (1 - ty) + (g[ix][iy + 1] * (1 - tx) + g[ix + 1][iy + 1] * tx) * ty;
    };
  }
  function randomTerrain(seed = (Math.random() * 1e9) | 0) {
    const r = rand(seed);
    const wet = noise2(r, 5, 3), rock = noise2(r, 7, 4), heat = noise2(r, 4, 2);
    grid = [];
    for (let x = 0; x < cols; x++) {
      grid.push([]);
      for (let y = 0; y < rows; y++) {
        let t = GRASS;
        const w = wet(x, y), k = rock(x, y), h = heat(x, y);
        if (k > 0.72) t = STONE;
        else if (w > 0.7) t = WATER;
        if (h > 0.8 && k > 0.5 && k <= 0.72) t = LAVA;
        if (t === GRASS && r() < 0.022) t = LOG;
        grid[x].push(t);
      }
    }
    // a stone wall with a gap across the middle: the classic "go around or dig through"
    const wx = Math.floor(cols * 0.55);
    const gap = 2 + Math.floor(r() * (rows - 5));
    for (let y = 0; y < rows; y++) if (Math.abs(y - gap) > 1) grid[wx][y] = STONE;
    clearAround(start); clearAround(goal);
  }
  function clearAround(p) {
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      const x = p.x + dx, y = p.y + dy;
      if (inside(x, y) && (grid[x][y] === LAVA || grid[x][y] === STONE || grid[x][y] === LOG)) grid[x][y] = GRASS;
    }
  }
  const inside = (x, y) => x >= 0 && y >= 0 && x < cols && y < rows;

  // ------------------------------------------------------------------ costs + A*
  function enterCost(x, y) {
    const t = grid[x][y];
    if (t === LAVA) return Infinity;              // never through lava
    if (t === WATER) return WATER_COST;
    if (t === STONE || t === LOG) return allowBreak ? SPRINT + BREAK[t] : Infinity;
    return SPRINT;
  }
  const passableNoBreak = (x, y) => inside(x, y) && (grid[x][y] === GRASS || grid[x][y] === WATER);

  function* search() {
    const id = (x, y) => x * rows + y;
    const g = new Float64Array(cols * rows).fill(Infinity);
    const came = new Int32Array(cols * rows).fill(-1);
    const closed = new Uint8Array(cols * rows);
    const inOpen = new Uint8Array(cols * rows);
    const h = (x, y) => {
      const dx = Math.abs(x - goal.x), dy = Math.abs(y - goal.y);
      return diagonals ? (Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy)) * SPRINT : (dx + dy) * SPRINT;
    };
    // binary heap open set (like Baritone's BinaryHeapOpenSet)
    const heap = [];
    const push = (f, k) => { heap.push([f, k]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
    const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };

    const s = id(start.x, start.y), gk = id(goal.x, goal.y);
    g[s] = 0; push(h(start.x, start.y), s); inOpen[s] = 1;
    let explored = 0;
    while (heap.length) {
      const [, k] = pop();
      if (closed[k]) continue;
      closed[k] = 1; inOpen[k] = 0; explored++;
      const x = Math.floor(k / rows), y = k % rows;
      yield { type: "step", k, closed, inOpen, came, explored };
      if (k === gk) return finish(came, k, g[k], closed, inOpen, explored);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        if (!dx && !dy) continue;
        const diag = dx && dy;
        if (diag && !diagonals) continue;
        const nx = x + dx, ny = y + dy;
        if (!inside(nx, ny)) continue;
        if (diag && (!passableNoBreak(x + dx, y) || !passableNoBreak(x, y + dy))) continue; // no corner cutting
        let c = enterCost(nx, ny);
        if (!isFinite(c)) continue;
        if (diag) c *= Math.SQRT2;
        const nk = id(nx, ny), ng = g[k] + c;
        if (ng < g[nk]) { g[nk] = ng; came[nk] = k; push(ng + h(nx, ny), nk); inOpen[nk] = 1; }
      }
    }
    return { path: null, closed, inOpen, explored };
  }
  function finish(came, k, cost, closed, inOpen, explored) {
    const path = [];
    for (let c = k; c !== -1; c = came[c]) path.push(c);
    path.reverse();
    const broken = path.filter((c) => { const t = grid[Math.floor(c / rows)][c % rows]; return t === STONE || t === LOG; });
    return { path, cost, closed, inOpen, explored, broken };
  }
  function pathTo(came, k) {
    const out = [];
    for (let c = k; c !== -1 && out.length < 4000; c = came[c]) out.push(c);
    return out.reverse();
  }

  function runInstant() {
    if (!grid.length) return;
    anim = null; animState = null;
    const it = search();
    let r;
    do { r = it.next(); } while (!r.done);
    result = r.value;
    updateStats(result);
    draw();
  }
  function runAnimated() {
    if (!grid.length) return;
    if (reduceMotion) return runInstant();
    result = null;
    anim = search();
    animState = null;
    updateStats(null);
    if (!raf) raf = requestAnimationFrame(tick);
  }
  let raf = 0;
  function tick() {
    raf = 0;
    if (!anim) return;
    const perFrame = Math.max(6, Math.round((cols * rows) / 140));
    for (let i = 0; i < perFrame; i++) {
      const r = anim.next();
      if (r.done) { result = r.value; anim = null; animState = null; updateStats(result); break; }
      animState = r.value;
    }
    draw();
    if (anim) raf = requestAnimationFrame(tick);
  }

  function updateStats(r) {
    const set = (id, v) => { const el = $(id); if (el) el.textContent = v; };
    if (!r) { set("st-nodes", "…"); set("st-length", "…"); set("st-time", "…"); set("st-break", "…"); return; }
    set("st-nodes", r.explored.toLocaleString("en"));
    if (!r.path) { set("st-length", "no path"); set("st-time", "—"); set("st-break", "—"); return; }
    set("st-length", `${r.path.length - 1} blocks`);
    set("st-time", `${(r.cost / 20).toFixed(1)} s`);
    set("st-break", String(r.broken.length));
  }

  // ------------------------------------------------------------------ drawing
  function makeTiles() {
    const base = {
      [GRASS]: [[95, 168, 58], 18], [STONE]: [[125, 130, 138], 22], [WATER]: [[52, 108, 214], 14],
      [LAVA]: [[230, 104, 26], 30], [LOG]: [[95, 168, 58], 18],
    };
    const r = rand(11);
    for (const t of [GRASS, STONE, WATER, LAVA, LOG]) {
      const c = document.createElement("canvas");
      const px = 8, size = Math.max(8, Math.round(cell * dpr));
      c.width = c.height = size;
      const g = c.getContext("2d");
      const [col, j] = base[t];
      const step = size / px;
      for (let i = 0; i < px; i++) for (let k = 0; k < px; k++) {
        const n = (r() - 0.5) * j;
        g.fillStyle = `rgb(${col[0] + n},${col[1] + n},${col[2] + n})`;
        g.fillRect(Math.floor(i * step), Math.floor(k * step), Math.ceil(step), Math.ceil(step));
      }
      if (t === LOG) {
        // a tree seen from above: leaves blob with a trunk
        g.fillStyle = "rgba(38,92,26,0.95)";
        g.fillRect(step, step, size - 2 * step, size - 2 * step);
        for (let i = 0; i < 14; i++) { g.fillStyle = `rgba(${60 + r() * 30},${120 + r() * 40},${40},0.9)`; g.fillRect(Math.floor((1 + r() * 5) * step), Math.floor((1 + r() * 5) * step), step, step); }
      }
      if (t === STONE) {
        g.fillStyle = "rgba(0,0,0,0.18)";
        for (let i = 0; i < 6; i++) g.fillRect(Math.floor(r() * px) * step, Math.floor(r() * px) * step, step, step);
      }
      tiles[t] = c;
    }
  }

  function layout() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    const aspect = w / h;
    const oldCols = cols, oldRows = rows;
    rows = w < 600 ? 18 : 24;
    cols = Math.max(16, Math.round(rows * aspect));
    cell = Math.min(w / cols, h / rows);
    canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
    if (cols !== oldCols || rows !== oldRows || !grid.length) {
      start = { x: Math.max(1, Math.round(cols * 0.08)), y: Math.round(rows * 0.5) };
      goal = { x: cols - 1 - Math.max(1, Math.round(cols * 0.08)), y: Math.round(rows * 0.45) };
      randomTerrain(1234);
    }
    makeTiles();
    runInstant();
  }

  const cx = (k) => (Math.floor(k / rows) + 0.5) * cell;
  const cy = (k) => ((k % rows) + 0.5) * cell;

  function draw(time = performance.now() / 1000) {
    if (!grid.length || !tiles[GRASS]) return;
    const w = cols * cell, h = rows * cell;
    const offX = (canvas.width / dpr - w) / 2, offY = (canvas.height / dpr - h) / 2;
    ctx.setTransform(dpr, 0, 0, dpr, offX * dpr, offY * dpr);
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(-offX, -offY, canvas.width, canvas.height);
    for (let x = 0; x < cols; x++) for (let y = 0; y < rows; y++) {
      ctx.drawImage(tiles[grid[x][y]], x * cell, y * cell, cell + 0.5, cell + 0.5);
    }
    // subtle grid
    ctx.strokeStyle = "rgba(0,0,0,0.12)"; ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= cols; x++) { ctx.moveTo(x * cell + 0.5, 0); ctx.lineTo(x * cell + 0.5, h); }
    for (let y = 0; y <= rows; y++) { ctx.moveTo(0, y * cell + 0.5); ctx.lineTo(w, y * cell + 0.5); }
    ctx.stroke();

    const view = animState || result;
    if (view) {
      const n = cols * rows;
      for (let k = 0; k < n; k++) {
        if (view.closed[k]) { ctx.fillStyle = "rgba(77,125,255,0.22)"; ctx.fillRect(Math.floor(k / rows) * cell, (k % rows) * cell, cell, cell); }
        else if (view.inOpen[k]) { ctx.fillStyle = animState ? "rgba(77,125,255,0.55)" : "rgba(77,125,255,0.22)"; ctx.fillRect(Math.floor(k / rows) * cell + cell * 0.2, (k % rows) * cell + cell * 0.2, cell * 0.6, cell * 0.6); }
      }
    }
    if (animState) line(pathTo(animState.came, animState.k), "#6f96ff", Math.max(2, cell * 0.16), 10);
    if (result && result.path) {
      for (const k of result.broken) {
        ctx.strokeStyle = "#ff4d57"; ctx.lineWidth = Math.max(1.5, cell * 0.1);
        ctx.strokeRect(Math.floor(k / rows) * cell + 2, (k % rows) * cell + 2, cell - 4, cell - 4);
      }
      line(result.path, "#ff4d57", Math.max(2.5, cell * 0.2), 14);
      line(result.path, "rgba(255,255,255,0.55)", Math.max(1, cell * 0.05), 0);
    }

    // goal: Baritone's green box, pulsing
    const pulse = reduceMotion ? 0 : (Math.sin(time * 3) + 1) / 2;
    ctx.save();
    ctx.strokeStyle = "#45e07a"; ctx.shadowColor = "#45e07a"; ctx.shadowBlur = 12; ctx.lineWidth = Math.max(2, cell * 0.12);
    const gi = cell * (0.12 + pulse * 0.1);
    ctx.strokeRect(goal.x * cell + gi, goal.y * cell + gi, cell - 2 * gi, cell - 2 * gi);
    ctx.restore();
    // player: a little head
    drawHead(start.x * cell, start.y * cell, cell);

    if (result && !result.path && !animState) {
      ctx.fillStyle = "rgba(10,15,21,0.75)";
      ctx.fillRect(w / 2 - 120, h / 2 - 22, 240, 44);
      ctx.fillStyle = "#ff8a8f"; ctx.font = `600 ${Math.max(13, cell * 0.7)}px Inter, sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillText("No path — try allowBreak", w / 2, h / 2);
    }
  }
  function line(path, color, width, glow) {
    if (!path || path.length < 2) return;
    ctx.save();
    ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineJoin = "round"; ctx.lineCap = "round";
    if (glow) { ctx.shadowColor = color; ctx.shadowBlur = glow; }
    ctx.beginPath(); ctx.moveTo(cx(path[0]), cy(path[0]));
    for (let i = 1; i < path.length; i++) ctx.lineTo(cx(path[i]), cy(path[i]));
    ctx.stroke(); ctx.restore();
  }
  function drawHead(x, y, s) {
    const p = s / 8, m = s * 0.1;
    const px = (i, j, c) => { ctx.fillStyle = c; ctx.fillRect(x + m + i * p * 0.8, y + m + j * p * 0.8, p * 0.8 + 0.5, p * 0.8 + 0.5); };
    ctx.save();
    ctx.shadowColor = "#2fd8e8"; ctx.shadowBlur = 12;
    ctx.fillStyle = "#c99a72"; ctx.fillRect(x + m, y + m, s - 2 * m, s - 2 * m);
    ctx.restore();
    for (let i = 0; i < 8; i++) { px(i, 0, "#4a2f1d"); px(i, 1, "#4a2f1d"); }
    px(0, 2, "#4a2f1d"); px(7, 2, "#4a2f1d");
    px(1, 4, "#fff"); px(2, 4, "#3b4fb8"); px(5, 4, "#3b4fb8"); px(6, 4, "#fff");
    px(3, 6, "#8a5a3c"); px(4, 6, "#8a5a3c");
  }

  // ------------------------------------------------------------------ input
  let dragging = null, painting = false, lastCell = null;
  function cellAt(e) {
    const rect = canvas.getBoundingClientRect();
    const w = cols * cell, h = rows * cell;
    const offX = (rect.width - w) / 2, offY = (rect.height - h) / 2;
    const x = Math.floor((e.clientX - rect.left - offX) / cell), y = Math.floor((e.clientY - rect.top - offY) / cell);
    return inside(x, y) ? { x, y } : null;
  }
  canvas.addEventListener("pointerdown", (e) => {
    const c = cellAt(e);
    if (!c) return;
    canvas.setPointerCapture(e.pointerId);
    if (c.x === start.x && c.y === start.y) dragging = start;
    else if (c.x === goal.x && c.y === goal.y) dragging = goal;
    else { painting = true; paint(c); }
    lastCell = c;
  });
  canvas.addEventListener("pointermove", (e) => {
    const c = cellAt(e);
    if (!c) { canvas.style.cursor = "crosshair"; return; }
    const over = (c.x === start.x && c.y === start.y) || (c.x === goal.x && c.y === goal.y);
    canvas.style.cursor = dragging ? "grabbing" : over ? "grab" : "crosshair";
    if (lastCell && c.x === lastCell.x && c.y === lastCell.y) return;
    lastCell = c;
    if (dragging) {
      if (grid[c.x][c.y] === LAVA) return;
      if ((dragging === start && c.x === goal.x && c.y === goal.y) || (dragging === goal && c.x === start.x && c.y === start.y)) return;
      dragging.x = c.x; dragging.y = c.y;
      runInstant();
    } else if (painting) paint(c);
  });
  const end = () => { if (painting) runAnimated(); dragging = null; painting = false; lastCell = null; };
  canvas.addEventListener("pointerup", end);
  canvas.addEventListener("pointercancel", end);
  function paint(c) {
    if ((c.x === start.x && c.y === start.y) || (c.x === goal.x && c.y === goal.y)) return;
    grid[c.x][c.y] = brush;
    runInstant();
  }

  document.querySelectorAll("[data-brush]").forEach((b) => b.addEventListener("click", () => {
    document.querySelectorAll("[data-brush]").forEach((o) => { o.classList.toggle("is-active", o === b); o.setAttribute("aria-pressed", String(o === b)); });
    brush = { stone: STONE, water: WATER, lava: LAVA, grass: GRASS }[b.dataset.brush];
  }));
  $("opt-break")?.addEventListener("change", (e) => { allowBreak = e.target.checked; runAnimated(); });
  $("opt-diag")?.addEventListener("change", (e) => { diagonals = e.target.checked; runAnimated(); });
  $("demo-random")?.addEventListener("click", () => { randomTerrain(); runAnimated(); });
  $("demo-run")?.addEventListener("click", runAnimated);

  // the goal box pulses; redraw slowly when idle
  if (!reduceMotion) {
    let visible = false;
    new IntersectionObserver(([en]) => { visible = en.isIntersecting; }).observe(canvas);
    setInterval(() => { if (visible && !anim) draw(); }, 50);
  }

  let resizeTimer;
  new ResizeObserver(() => { clearTimeout(resizeTimer); resizeTimer = setTimeout(layout, 100); }).observe(canvas);
  layout();

  // first time the demo scrolls into view: animate the search
  let shown = false;
  new IntersectionObserver(([en], obs) => {
    if (en.isIntersecting && !shown) { shown = true; obs.disconnect(); setTimeout(runAnimated, 300); }
  }, { threshold: 0.4 }).observe(canvas);
})();
