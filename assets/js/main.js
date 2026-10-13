/* Page behavior: reveal on scroll, counters, nav, card glow, chat demo, gallery. */
(() => {
  "use strict";
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ------------------------------------------------------------------ gallery content
  // type: "video" | "image". poster is used for videos before they play.
  const MEDIA = window.BARITONE_MEDIA || [];

  // ------------------------------------------------------------------ reveal + counters
  const reveals = document.querySelectorAll(".reveal");
  // stagger siblings
  document.querySelectorAll(".features, .pipeline, .steps, .stats__grid, .faq, .gallery").forEach((group) => {
    [...group.querySelectorAll(":scope > .reveal")].forEach((el, i) => el.style.setProperty("--d", `${Math.min(i, 8) * 70}ms`));
  });
  const counted = new WeakSet();
  function count(el) {
    if (counted.has(el)) return;
    counted.add(el);
    const target = Number(el.dataset.count);
    if (reduceMotion) { el.textContent = target; return; }
    const t0 = performance.now(), dur = 1400;
    const step = (now) => {
      const p = Math.min(1, (now - t0) / dur);
      el.textContent = Math.round(target * (1 - Math.pow(1 - p, 3)));
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      e.target.classList.add("is-in");
      e.target.querySelectorAll?.("[data-count]").forEach(count);
      io.unobserve(e.target);
    }
  }, { threshold: 0.15, rootMargin: "0px 0px -40px 0px" });
  reveals.forEach((el) => io.observe(el));
  // the hero is visible at load
  requestAnimationFrame(() => document.querySelectorAll(".hero .reveal").forEach((el, i) => {
    el.style.setProperty("--d", `${120 + i * 110}ms`);
    el.classList.add("is-in");
  }));

  // ------------------------------------------------------------------ nav
  const nav = document.getElementById("nav");
  const onScroll = () => nav.classList.toggle("is-scrolled", window.scrollY > 20);
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();
  const toggle = nav.querySelector(".nav__toggle");
  toggle.addEventListener("click", () => {
    const open = nav.classList.toggle("is-open");
    toggle.setAttribute("aria-expanded", String(open));
  });
  nav.querySelectorAll(".nav__links a").forEach((a) => a.addEventListener("click", () => {
    nav.classList.remove("is-open");
    toggle.setAttribute("aria-expanded", "false");
  }));

  // ------------------------------------------------------------------ card glow follows the mouse
  document.querySelectorAll(".card").forEach((card) => {
    card.addEventListener("pointermove", (e) => {
      const r = card.getBoundingClientRect();
      card.style.setProperty("--mx", `${e.clientX - r.left}px`);
      card.style.setProperty("--my", `${e.clientY - r.top}px`);
    });
  });

  // ------------------------------------------------------------------ Minecraft chat demo
  const log = document.getElementById("chat-log");
  const input = document.getElementById("chat-input");
  const SCRIPT = [
    { cmd: "#goto crafting_table", out: ['<span class="p">[Baritone]</span> Goal: GoalGetToBlock{x=118,y=64,z=-42}'] },
    { cmd: "#mine 16 diamond", out: ['<span class="p">[Baritone]</span> Mining <span class="y">diamond_ore</span>, <span class="y">deepslate_diamond_ore</span>', '<span class="p">[Baritone]</span> <span class="gray">No ore known: branch mining at Y=-59</span>'] },
    { cmd: "#sel pos1", out: ['<span class="p">[Baritone]</span> Position 1: 120 64 -40'] },
    { cmd: "#sel pos2 132 76 -28", out: ['<span class="p">[Baritone]</span> Position 2: 132 76 -28'] },
    { cmd: "#sel hsphere glass", out: ['<span class="p">[Baritone]</span> Building <span class="y">hollow sphere</span> of glass'] },
    { cmd: "#elytra 5000 -2000", out: ['<span class="p">[Baritone]</span> Elytra to 5000 -2000 <span class="gray">(64 fireworks)</span>'] },
    { cmd: "#follow player Alex", out: ['<span class="p">[Baritone]</span> Following <span class="g">Alex</span>'] },
    { cmd: "#set allowParkour true", out: ['<span class="p">[Baritone]</span> allowParkour = true'] },
    { cmd: "#farm", out: ['<span class="p">[Baritone]</span> Farming <span class="gray">(radius 32)</span>'] },
  ];
  function addLine(html) {
    const d = document.createElement("div");
    d.className = "mc-line";
    d.innerHTML = html;
    log.appendChild(d);
    while (log.children.length > 9) log.removeChild(log.firstChild);
  }
  if (log && input) {
    if (reduceMotion) {
      SCRIPT.slice(0, 4).forEach((s) => { addLine(`<span class="p">[Baritone]</span> &gt; ${s.cmd.slice(1)}`); s.out.forEach(addLine); });
    } else {
      let i = 0, running = false;
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      async function play() {
        if (running) return;
        running = true;
        for (;;) {
          const s = SCRIPT[i++ % SCRIPT.length];
          for (let c = 1; c <= s.cmd.length; c++) { input.textContent = s.cmd.slice(0, c); await wait(55 + Math.random() * 45); }
          await wait(380);
          input.textContent = "";
          addLine(`<span class="p">[Baritone]</span> &gt; ${s.cmd.slice(1)}`);
          for (const o of s.out) { await wait(420); addLine(o); }
          await wait(1500);
        }
      }
      new IntersectionObserver(([e], obs) => { if (e.isIntersecting) { play(); obs.disconnect(); } }, { threshold: 0.3 }).observe(log.parentElement);
    }
  }

  // ------------------------------------------------------------------ gallery + lightbox
  const grid = document.getElementById("gallery-grid");
  const lightbox = document.getElementById("lightbox");
  const body = lightbox.querySelector(".lightbox__body");
  function openLightbox(m) {
    body.innerHTML = "";
    let el;
    if (m.type === "video") {
      el = document.createElement("video");
      el.src = m.src; el.controls = true; el.autoplay = true; el.loop = true; el.playsInline = true;
      if (m.poster) el.poster = m.poster;
    } else {
      el = document.createElement("img");
      el.src = m.full || m.src; el.alt = m.title;
    }
    body.appendChild(el);
    const cap = document.createElement("p");
    cap.textContent = m.title + (m.text ? ` — ${m.text}` : "");
    body.appendChild(cap);
    lightbox.hidden = false;
    document.body.style.overflow = "hidden";
    lightbox.querySelector(".lightbox__close").focus();
  }
  function closeLightbox() {
    lightbox.hidden = true;
    body.innerHTML = "";
    document.body.style.overflow = "";
  }
  lightbox.addEventListener("click", (e) => { if (e.target === lightbox || e.target.closest(".lightbox__close")) closeLightbox(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !lightbox.hidden) closeLightbox(); });

  if (grid) {
    if (!MEDIA.length) {
      grid.innerHTML = '<p class="gallery__empty">Screenshots and videos are coming soon.</p>';
    }
    MEDIA.forEach((m, i) => {
      const b = document.createElement("button");
      b.className = "shot reveal" + (m.wide ? " shot--wide" : "");
      b.style.setProperty("--d", `${Math.min(i, 6) * 80}ms`);
      b.setAttribute("aria-label", `${m.title} — open`);
      if (m.type === "video") {
        const v = document.createElement("video");
        v.muted = true; v.loop = true; v.playsInline = true; v.preload = "metadata";
        v.src = m.src; if (m.poster) v.poster = m.poster;
        b.appendChild(v);
        const badge = document.createElement("span");
        badge.className = "shot__badge"; badge.textContent = "VIDEO";
        b.appendChild(badge);
        if (!reduceMotion) {
          new IntersectionObserver(([e]) => { if (e.isIntersecting) v.play().catch(() => {}); else v.pause(); }, { threshold: 0.35 }).observe(b);
        }
      } else {
        const img = document.createElement("img");
        img.src = m.src; img.alt = m.title; img.loading = "lazy"; img.decoding = "async";
        b.appendChild(img);
      }
      const cap = document.createElement("span");
      cap.className = "shot__cap";
      cap.innerHTML = `<b>${m.title}</b>${m.cmd ? `<code>${m.cmd}</code> · ` : ""}${m.text || ""}`;
      b.appendChild(cap);
      b.addEventListener("click", () => openLightbox(m));
      grid.appendChild(b);
      io.observe(b);
    });
  }
})();
