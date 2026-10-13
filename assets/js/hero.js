/*
 * Hero scene: an isometric voxel world where a little bot runs Baritone's loop —
 * A* explores (blue), the path appears (red, Baritone's double line), the goal box
 * animates (green), and the player walks, jumps and drops along the path. Then a new
 * #goto is typed in the chat bar and it starts again.
 */
(() => {
  "use strict";

  const canvas = document.getElementById("hero-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const typed = document.getElementById("hero-typed");
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ------------------------------------------------------------------ world
  const N = 22;            // world is N x N columns
  const WATER = 2;         // water surface height
  const AIR = 0, GRASS = 1, DIRT = 2, STONE = 3, SAND = 4, WATER_B = 5, LOG = 6, LEAVES = 7;
  const blocks = new Map();
  const heights = [];      // top solid height per column (standing y = h + 1)
  const solidColumn = [];  // trees block the path
  let rng = mulberry32(7);

  function mulberry32(a) {
    return () => {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const key = (x, y, z) => (x * 64 + y) * 64 + z;
  const get = (x, y, z) => blocks.get(key(x, y, z)) || AIR;
  const set = (x, y, z, t) => blocks.set(key(x, y, z), t);

  function valueNoise(seedRng, size, cells) {
    const g = [];
    for (let i = 0; i <= cells; i++) { g.push([]); for (let j = 0; j <= cells; j++) g[i].push(seedRng()); }
    const smooth = (t) => t * t * (3 - 2 * t);
    return (x, z) => {
      const fx = (x / size) * cells, fz = (z / size) * cells;
      const ix = Math.floor(fx), iz = Math.floor(fz);
      const tx = smooth(fx - ix), tz = smooth(fz - iz);
      const a = g[ix][iz], b = g[ix + 1][iz], c = g[ix][iz + 1], d = g[ix + 1][iz + 1];
      return (a * (1 - tx) + b * tx) * (1 - tz) + (c * (1 - tx) + d * tx) * tz;
    };
  }

  function generate() {
    blocks.clear();
    rng = mulberry32(42);
    const n1 = valueNoise(rng, N, 3), n2 = valueNoise(rng, N, 7);
    for (let x = 0; x < N; x++) {
      heights[x] = []; solidColumn[x] = [];
      for (let z = 0; z < N; z++) {
        const v = n1(x, z) * 0.8 + n2(x, z) * 0.35;
        let h = Math.max(0, Math.min(7, Math.round(v * 8 - 1.4)));
        heights[x][z] = h;
        solidColumn[x][z] = false;
      }
    }
    for (let x = 0; x < N; x++) {
      for (let z = 0; z < N; z++) {
        const h = heights[x][z];
        for (let y = 0; y <= h; y++) {
          let t = y < h - 2 ? STONE : DIRT;
          if (y === h) t = h <= WATER ? SAND : h >= 6 ? STONE : GRASS;
          set(x, y, z, t);
        }
        for (let y = h + 1; y <= WATER; y++) set(x, y, z, WATER_B);
      }
    }
    // a few trees on grass, away from the edges
    let trees = 0;
    for (let i = 0; i < 400 && trees < 5; i++) {
      const x = 2 + Math.floor(rng() * (N - 4)), z = 2 + Math.floor(rng() * (N - 4));
      const h = heights[x][z];
      if (get(x, h, z) !== GRASS || solidColumn[x][z]) continue;
      let near = false;
      for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) if (solidColumn[x + dx]?.[z + dz]) near = true;
      if (near) continue;
      for (let y = h + 1; y <= h + 3; y++) set(x, y, z, LOG);
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        for (let y = h + 3; y <= h + 4; y++) if (get(x + dx, y, z + dz) === AIR) set(x + dx, y, z + dz, LEAVES);
      }
      set(x, h + 5, z, LEAVES);
      solidColumn[x][z] = true;
      trees++;
    }
  }

  // ------------------------------------------------------------------ colors
  const PALETTE = {
    [GRASS]: { top: [95, 168, 58], side: [138, 90, 53], strip: [95, 168, 58] },
    [DIRT]: { top: [138, 90, 53], side: [124, 80, 47] },
    [STONE]: { top: [128, 133, 140], side: [112, 117, 124] },
    [SAND]: { top: [222, 207, 150], side: [205, 190, 135] },
    [WATER_B]: { top: [52, 110, 220], side: [44, 92, 190] },
    [LOG]: { top: [168, 128, 76], side: [104, 78, 46] },
    [LEAVES]: { top: [60, 128, 40], side: [50, 108, 34] },
  };
  const shade = (c, f, j = 0) => `rgb(${clamp(c[0] * f + j)},${clamp(c[1] * f + j)},${clamp(c[2] * f + j)})`;
  const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));

  // ------------------------------------------------------------------ projection
  let W = 0, H = 0, dpr = 1, hw = 16, hh = 8, bh = 18, ox = 0, oy = 0;
  let terrain = null; // pre-rendered terrain
  const P = (x, y, z) => [ox + (x - z) * hw, oy + (x + z) * hh - y * bh];

  function layout() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = canvas.clientWidth; H = canvas.clientHeight;
    if (!W || !H) return false;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    const wide = W >= 900;
    const targetW = wide ? W * 0.54 : W * 1.15;
    hw = Math.max(9, Math.min(34, targetW / (2 * N)));
    hh = hw / 2;
    bh = hw * 1.05;
    const worldH = 2 * N * hh + 8 * bh;
    if (worldH > H * 0.95) { const s = (H * 0.95) / worldH; hw *= s; hh *= s; bh *= s; }
    ox = wide ? W * 0.71 : W * 0.5;
    oy = (wide ? H * 0.5 : H * 0.58) - N * hh + 3 * bh;
    renderTerrain();
    return true;
  }

  function quad(g, pts, fill) {
    g.beginPath();
    g.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
    g.closePath();
    g.fillStyle = fill;
    g.fill();
  }
  // subdivide a face into 4x4 "pixels" with a little color noise: a Minecraft texture feel
  function texturedFace(g, a, b, c, d, base, factor, jitter, stripTop) {
    const S = 4;
    const lerp = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t];
    for (let i = 0; i < S; i++) {
      for (let j = 0; j < S; j++) {
        const u0 = i / S, u1 = (i + 1) / S, v0 = j / S, v1 = (j + 1) / S;
        const pt = (u, v) => lerp(lerp(a, b, u), lerp(d, c, u), v);
        let col = base;
        if (stripTop && j === 0) col = stripTop;
        const n = (rng() - 0.5) * jitter;
        quad(g, [pt(u0, v0), pt(u1, v0), pt(u1, v1), pt(u0, v1)], shade(col, factor, n));
      }
    }
  }

  function renderTerrain() {
    terrain = document.createElement("canvas");
    terrain.width = canvas.width; terrain.height = canvas.height;
    const g = terrain.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    rng = mulberry32(99);
    const list = [];
    for (const [k, t] of blocks) {
      const z = k % 64, y = Math.floor(k / 64) % 64, x = Math.floor(k / 4096);
      list.push([x, y, z, t]);
    }
    list.sort((p, q) => (p[0] + p[2]) - (q[0] + q[2]) || p[1] - q[1] || p[0] - q[0]);
    // soft shadow under the island
    const [cx, cy] = P(N / 2, -1, N / 2);
    const grd = g.createRadialGradient(cx, cy + hh * 2, 0, cx, cy + hh * 2, N * hw);
    grd.addColorStop(0, "rgba(0,0,0,0.35)"); grd.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = grd; g.fillRect(cx - N * hw * 1.3, cy - N * hh, N * hw * 2.6, N * hh * 3);

    for (const [x, y, z, t] of list) {
      const pal = PALETTE[t];
      const water = t === WATER_B;
      const above = get(x, y + 1, z);
      const openTop = above === AIR || (above === WATER_B && !water) || (above === LEAVES && t !== LEAVES);
      const openX = x === N - 1 || get(x + 1, y, z) === AIR || (get(x + 1, y, z) === WATER_B && !water) || get(x + 1, y, z) === LEAVES;
      const openZ = z === N - 1 || get(x, y, z + 1) === AIR || (get(x, y, z + 1) === WATER_B && !water) || get(x, y, z + 1) === LEAVES;
      if (water) g.globalAlpha = 0.82;
      if (openZ) {
        texturedFace(g, P(x, y + 1, z + 1), P(x + 1, y + 1, z + 1), P(x + 1, y, z + 1), P(x, y, z + 1),
          pal.side, 0.78, 14, t === GRASS ? pal.strip : null);
      }
      if (openX) {
        texturedFace(g, P(x + 1, y + 1, z + 1), P(x + 1, y + 1, z), P(x + 1, y, z), P(x + 1, y, z + 1),
          pal.side, 0.62, 14, t === GRASS ? pal.strip : null);
      }
      if (openTop) {
        texturedFace(g, P(x, y + 1, z), P(x + 1, y + 1, z), P(x + 1, y + 1, z + 1), P(x, y + 1, z + 1),
          pal.top, water ? 1.0 : 1.0, t === LEAVES ? 26 : 16, null);
      }
      g.globalAlpha = 1;
    }
  }

  // ------------------------------------------------------------------ pathfinding (Baritone-flavoured A*)
  const standY = (x, z) => Math.max(heights[x][z], WATER) + 1;
  const walkable = (x, z) => x >= 0 && z >= 0 && x < N && z < N && !solidColumn[x][z];
  const isWater = (x, z) => heights[x][z] < WATER;
  const WALK = 4.633, SPRINT = 3.564, JUMP = 2.5, WATER_COST = 9.091; // ticks (ActionCosts)

  function moveCost(ax, az, bx, bz, diag) {
    if (!walkable(bx, bz)) return Infinity;
    const dy = standY(bx, bz) - standY(ax, az);
    if (dy > 1 || dy < -3) return Infinity;
    if (diag) {
      // like MovementDiagonal: both corners must be passable at our height
      if (!walkable(ax, bz) || !walkable(bx, az)) return Infinity;
      if (standY(ax, bz) > Math.max(standY(ax, az), standY(bx, bz)) || standY(bx, az) > Math.max(standY(ax, az), standY(bx, bz))) return Infinity;
      if (dy !== 0) return Infinity;
    }
    let c = isWater(bx, bz) ? WATER_COST : dy === 0 ? SPRINT : WALK;
    if (dy > 0) c += JUMP;
    if (dy < 0) c += 1.0 * -dy;
    return diag ? c * Math.SQRT2 : c;
  }

  function* astar(sx, sz, gx, gz) {
    const id = (x, z) => x * N + z;
    const g = new Map([[id(sx, sz), 0]]);
    const came = new Map();
    const h = (x, z) => { const dx = Math.abs(x - gx), dz = Math.abs(z - gz); return (Math.max(dx, dz) + (Math.SQRT2 - 1) * Math.min(dx, dz)) * SPRINT; };
    const open = [[h(sx, sz), sx, sz]];
    const closed = new Set();
    while (open.length) {
      let bi = 0;
      for (let i = 1; i < open.length; i++) if (open[i][0] < open[bi][0]) bi = i;
      const [, x, z] = open.splice(bi, 1)[0];
      const k = id(x, z);
      if (closed.has(k)) continue;
      closed.add(k);
      yield { type: "visit", x, z, best: rebuild(came, k, id) };
      if (x === gx && z === gz) return { type: "done", path: rebuild(came, k, id) };
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        if (!dx && !dz) continue;
        const nx = x + dx, nz = z + dz;
        if (nx < 0 || nz < 0 || nx >= N || nz >= N) continue;
        const c = moveCost(x, z, nx, nz, dx && dz);
        if (!isFinite(c)) continue;
        const nk = id(nx, nz), ng = g.get(k) + c;
        if (ng < (g.get(nk) ?? Infinity)) {
          g.set(nk, ng); came.set(nk, k);
          open.push([ng + h(nx, nz), nx, nz]);
        }
      }
    }
    return { type: "fail" };
  }
  function rebuild(came, k, id) {
    const out = [];
    let cur = k;
    while (cur !== undefined) { out.push([Math.floor(cur / N), cur % N]); cur = came.get(cur); }
    return out.reverse();
  }

  // ------------------------------------------------------------------ state machine
  const state = {
    phase: "idle", t: 0,
    player: { x: 3, z: 4, fx: 3.5, fz: 4.5, fy: 0 },
    goal: null, search: null, visited: [], best: [], path: [], drawn: 0, walkIdx: 0, walkT: 0,
  };

  function pickGoal() {
    for (let i = 0; i < 200; i++) {
      const x = Math.floor(rng() * N), z = Math.floor(rng() * N);
      if (!walkable(x, z) || isWater(x, z)) continue;
      const d = Math.abs(x - state.player.x) + Math.abs(z - state.player.z);
      if (d < 10 || d > 26) continue;
      return { x, z };
    }
    return { x: N - 3, z: N - 3 };
  }

  let typingTimer = null;
  function typeCommand(text, done) {
    if (!typed) { done(); return; }
    clearInterval(typingTimer);
    let i = 0;
    typed.textContent = "";
    typingTimer = setInterval(() => {
      typed.textContent = text.slice(0, ++i);
      if (i >= text.length) { clearInterval(typingTimer); setTimeout(done, 350); }
    }, 45);
  }

  function nextGoal() {
    rng = mulberry32((Date.now() & 0xffff) ^ 0x5bd1);
    const goal = pickGoal();
    state.goal = goal;
    state.phase = "typing";
    const gy = standY(goal.x, goal.z);
    const cmd = `#goto ${1024 + goal.x} ${62 + gy} ${-260 + goal.z}`;
    typeCommand(cmd, () => {
      state.search = astar(state.player.x, state.player.z, goal.x, goal.z);
      state.visited = []; state.best = []; state.path = []; state.drawn = 0;
      state.phase = "search";
    });
  }

  function stepSearch() {
    for (let i = 0; i < 4; i++) {
      const r = state.search.next();
      if (r.done) {
        if (r.value && r.value.type === "done") {
          state.path = r.value.path; state.phase = "reveal"; state.t = 0;
        } else {
          state.phase = "pause"; state.t = 0;
        }
        return;
      }
      state.visited.push({ x: r.value.x, z: r.value.z, age: 0 });
      state.best = r.value.best;
    }
  }

  // ------------------------------------------------------------------ drawing helpers
  const center = (x, z, lift = 0.5) => P(x + 0.5, standY(x, z) + lift - 1 + 1, z + 0.5);

  function polyline(points, color, width, alpha = 1, glow = 0) {
    if (points.length < 2) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineJoin = "round"; ctx.lineCap = "round";
    if (glow) { ctx.shadowColor = color; ctx.shadowBlur = glow; }
    ctx.beginPath();
    ctx.moveTo(points[0][0], points[0][1]);
    for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1]);
    ctx.stroke();
    ctx.restore();
  }

  function tileTop(x, z, fill, alpha) {
    const y = standY(x, z);
    ctx.save();
    ctx.globalAlpha = alpha;
    quad(ctx, [P(x + 0.08, y, z + 0.08), P(x + 0.92, y, z + 0.08), P(x + 0.92, y, z + 0.92), P(x + 0.08, y, z + 0.92)], fill);
    ctx.restore();
  }

  function boxEdges(x0, y0, z0, x1, y1, z1, color, alpha, width = 2) {
    const c = [
      P(x0, y0, z0), P(x1, y0, z0), P(x1, y0, z1), P(x0, y0, z1),
      P(x0, y1, z0), P(x1, y1, z0), P(x1, y1, z1), P(x0, y1, z1),
    ];
    const e = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
    ctx.save();
    ctx.globalAlpha = alpha; ctx.strokeStyle = color; ctx.lineWidth = width;
    ctx.shadowColor = color; ctx.shadowBlur = 8;
    ctx.beginPath();
    for (const [a, b] of e) { ctx.moveTo(c[a][0], c[a][1]); ctx.lineTo(c[b][0], c[b][1]); }
    ctx.stroke();
    ctx.restore();
  }

  // Baritone's animated goal box: vertical edges and two horizontal squares moving with cos()
  function goalBox(goal, time) {
    const x = goal.x, z = goal.z, y = standY(x, z);
    const s = Math.cos(time * Math.PI * 2 / 2.0);
    const e = 0.04;
    ctx.save();
    ctx.strokeStyle = "#45e07a"; ctx.lineWidth = 2.2; ctx.shadowColor = "#45e07a"; ctx.shadowBlur = 12;
    const sq = (yy) => {
      const a = P(x + e, yy, z + e), b = P(x + 1 - e, yy, z + e), c = P(x + 1 - e, yy, z + 1 - e), d = P(x + e, yy, z + 1 - e);
      ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...b); ctx.lineTo(...c); ctx.lineTo(...d); ctx.closePath(); ctx.stroke();
    };
    ctx.beginPath();
    for (const [vx, vz] of [[x + e, z + e], [x + 1 - e, z + e], [x + 1 - e, z + 1 - e], [x + e, z + 1 - e]]) {
      ctx.moveTo(...P(vx, y, vz)); ctx.lineTo(...P(vx, y + 2, vz));
    }
    ctx.stroke();
    sq(y + 1 + s); sq(y + 1 - s);
    // a beam to find it from far away
    const top = P(x + 0.5, y + 2, z + 0.5), sky = P(x + 0.5, y + 9, z + 0.5);
    const grd = ctx.createLinearGradient(top[0], top[1], sky[0], sky[1]);
    grd.addColorStop(0, "rgba(69,224,122,0.55)"); grd.addColorStop(1, "rgba(69,224,122,0)");
    ctx.shadowBlur = 0; ctx.strokeStyle = grd; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(...top); ctx.lineTo(...sky); ctx.stroke();
    ctx.restore();
  }

  function cuboid(x0, y0, z0, x1, y1, z1, top, sideZ, sideX) {
    quad(ctx, [P(x0, y0, z1), P(x1, y0, z1), P(x1, y1, z1), P(x0, y1, z1)], sideZ);
    quad(ctx, [P(x1, y0, z1), P(x1, y0, z0), P(x1, y1, z0), P(x1, y1, z1)], sideX);
    quad(ctx, [P(x0, y1, z0), P(x1, y1, z0), P(x1, y1, z1), P(x0, y1, z1)], top);
  }

  function drawPlayer(px, py, pz, bob) {
    const w = 0.3;
    const y = py + bob;
    // shadow
    ctx.save();
    ctx.globalAlpha = 0.35;
    const g0 = Math.floor(px), g1 = Math.floor(pz);
    const gy = walkable(g0, g1) ? standY(Math.min(N - 1, Math.max(0, g0)), Math.min(N - 1, Math.max(0, g1))) : py;
    quad(ctx, [P(px - w, gy, pz - w), P(px + w, gy, pz - w), P(px + w, gy, pz + w), P(px - w, gy, pz + w)], "#000");
    ctx.restore();
    cuboid(px - w, y, pz - w * 0.6, px + w, y + 0.75, pz + w * 0.6, "#2b3a8f", "#28368a", "#1e2a6e");         // legs
    cuboid(px - w, y + 0.75, pz - w * 0.6, px + w, y + 1.4, pz + w * 0.6, "#2fb8c8", "#25a4b3", "#1b8592"); // shirt
    cuboid(px - w * 0.85, y + 1.4, pz - w * 0.85, px + w * 0.85, y + 1.9, pz + w * 0.85, "#4a2f1d", "#c99a72", "#ad8160"); // head
  }

  // ------------------------------------------------------------------ frame
  let last = 0, mx = 0, my = 0, tmx = 0, tmy = 0, running = true, time = 0;

  function frame(now) {
    if (!running) return;
    const dt = Math.min(0.05, (now - last) / 1000 || 0);
    last = now; time += dt; state.t += dt;
    mx += (tmx - mx) * 0.05; my += (tmy - my) * 0.05;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, mx * dpr, my * dpr);
    if (!terrain || !terrain.width) { requestAnimationFrame(frame); return; }
    ctx.drawImage(terrain, 0, 0, canvas.width / dpr, canvas.height / dpr);

    // phases
    if (state.phase === "search") stepSearch();

    // explored nodes (fading blue tiles)
    for (const v of state.visited) {
      v.age += dt;
      const a = state.phase === "search" ? Math.max(0.12, 0.55 - v.age * 0.25) : Math.max(0, 0.3 - state.t * 0.5);
      if (a > 0) tileTop(v.x, v.z, "#4d7dff", a);
    }
    // best path so far (blue)
    if (state.phase === "search" && state.best.length > 1) {
      polyline(state.best.map(([x, z]) => center(x, z, 0.35)), "#6f96ff", 2.4, 0.95, 8);
    }
    // the path: red, drawn on, with Baritone's second line slightly above
    if (["reveal", "walk", "arrived"].includes(state.phase) && state.path.length > 1) {
      if (state.phase === "reveal") {
        state.drawn = Math.min(state.path.length, state.drawn + dt * 40);
        if (state.drawn >= state.path.length) { state.phase = "walk"; state.walkIdx = 0; state.walkT = 0; }
      }
      const from = state.phase === "walk" ? Math.max(0, state.walkIdx - 3) : 0;
      const upto = Math.floor(state.drawn);
      const pts = state.path.slice(from, upto + 1);
      const fade = state.phase === "arrived" ? Math.max(0, 1 - state.t * 1.5) : 1;
      polyline(pts.map(([x, z]) => center(x, z, 0.32)), "#ff4d57", 2.6, fade, 10);
      polyline(pts.map(([x, z]) => center(x, z, 0.42)), "#ff4d57", 1.4, 0.75 * fade, 0);
    }
    if (state.goal && state.phase !== "idle") goalBox(state.goal, time);

    // player
    const p = state.player;
    let bob = 0;
    if (state.phase === "walk") {
      const a = state.path[state.walkIdx], b = state.path[state.walkIdx + 1];
      if (!b) { state.phase = "arrived"; state.t = 0; p.x = a[0]; p.z = a[1]; }
      else {
        const ya = standY(a[0], a[1]), yb = standY(b[0], b[1]);
        const dist = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const speed = isWater(b[0], b[1]) ? 2.2 : 5.6; // blocks per second (demo speed)
        state.walkT += (dt * speed) / dist;
        const t = Math.min(1, state.walkT);
        p.fx = a[0] + 0.5 + (b[0] - a[0]) * t;
        p.fz = a[1] + 0.5 + (b[1] - a[1]) * t;
        if (yb > ya) p.fy = ya + (yb - ya) * Math.min(1, t * 1.6) + Math.sin(Math.PI * Math.min(1, t * 1.25)) * 0.35; // jump
        else if (yb < ya) p.fy = t < 0.45 ? ya : ya + (yb - ya) * Math.min(1, ((t - 0.45) / 0.55) ** 2);  // walk off, fall
        else p.fy = ya;
        bob = Math.abs(Math.sin(t * Math.PI)) * 0.05;
        if (state.walkT >= 1) { state.walkIdx++; state.walkT = 0; p.x = b[0]; p.z = b[1]; }
      }
    } else {
      p.fy = standY(p.x, p.z);
      bob = Math.sin(time * 2) * 0.02;
    }
    drawPlayer(p.fx, p.fy, p.fz, bob);

    if (state.phase === "arrived" && state.t > 1.4) nextGoal();
    if (state.phase === "pause" && state.t > 0.8) nextGoal();

    requestAnimationFrame(frame);
  }

  // ------------------------------------------------------------------ setup
  function placePlayer() {
    for (let i = 0; i < N * N; i++) {
      const x = 2 + (i % 6), z = 3 + Math.floor(i / 6);
      if (walkable(x, z) && !isWater(x, z)) { Object.assign(state.player, { x, z, fx: x + 0.5, fz: z + 0.5, fy: standY(x, z) }); return; }
    }
  }

  generate();
  placePlayer();
  layout();

  let resizeTimer;
  new ResizeObserver(() => { clearTimeout(resizeTimer); resizeTimer = setTimeout(layout, 80); }).observe(canvas);
  window.addEventListener("pointermove", (e) => {
    if (e.pointerType !== "mouse") return;
    tmx = (e.clientX / window.innerWidth - 0.5) * -14;
    tmy = (e.clientY / window.innerHeight - 0.5) * -10;
  }, { passive: true });

  if (reduceMotion) {
    // one still frame with a path drawn
    rng = mulberry32(3);
    const goal = pickGoal();
    state.goal = goal;
    const it = astar(state.player.x, state.player.z, goal.x, goal.z);
    let r; do { r = it.next(); } while (!r.done);
    if (r.value?.path) { state.path = r.value.path; state.drawn = state.path.length; state.phase = "walk"; state.walkIdx = 0; }
    running = false;
    const draw = () => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.drawImage(terrain, 0, 0, W, H);
      polyline(state.path.map(([x, z]) => center(x, z, 0.32)), "#ff4d57", 2.6, 1, 10);
      goalBox(goal, 0.3);
      drawPlayer(state.player.fx, standY(state.player.x, state.player.z), state.player.fz, 0);
    };
    draw();
    window.addEventListener("resize", () => setTimeout(draw, 160));
    return;
  }

  // pause when the hero is off screen
  new IntersectionObserver(([entry]) => {
    const was = running;
    running = entry.isIntersecting;
    if (running && !was) { last = performance.now(); requestAnimationFrame(frame); }
  }).observe(canvas);

  setTimeout(nextGoal, 700);
  requestAnimationFrame((t) => { last = t; frame(t); });
})();
