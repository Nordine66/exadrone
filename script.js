/* Exadrone — interactions */

document.addEventListener('DOMContentLoaded', () => {

  /* ---------- Nav scroll state ---------- */
  // The actual scroll->DOM wiring lives further down (see "Decoupled scroll
  // loop"), once `root`/`lerpBackground` exist — this just grabs the
  // element reference, used here and by the mobile nav toggle below.
  const nav = document.getElementById('siteNav');

  /* ---------- Mobile nav toggle ---------- */
  const navToggle = document.getElementById('navToggle');
  const navLinks = document.getElementById('navLinks');
  navToggle.addEventListener('click', () => {
    const open = navLinks.classList.toggle('open');
    navToggle.setAttribute('aria-expanded', String(open));
    // Lets CSS fade the wordmark only while the off-canvas drawer is open
    // and actually overlapping it — the rest of the time "EXADRONE" stays
    // fully visible on mobile too.
    nav.classList.toggle('menu-open', open);
  });
  navLinks.querySelectorAll('a').forEach(a =>
    a.addEventListener('click', () => {
      navLinks.classList.remove('open');
      nav.classList.remove('menu-open');
    })
  );

  /* ---------- Ambient droplet particles (canvas, sprite-cached) ----------
     The look (gradient body + glint + rim shadow, per depth) used to be
     redrawn from scratch for every droplet on every frame — a gradient
     allocation, a filter:blur toggle, and 3 fill/arc calls each, ~9 canvas
     ops x 26 droplets x 60fps. Identical output is pre-rendered once per
     depth bucket into an offscreen canvas (the blur is baked into the
     pixels), so the per-frame loop is just a drawImage blit per droplet —
     a texture copy instead of a software gradient+blur rasterize. */
  const ambientCanvas = document.getElementById('ambientCanvas');
  if (ambientCanvas && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const actx = ambientCanvas.getContext('2d');
    const adpr = Math.min(window.devicePixelRatio || 1, 2);
    const DROPLET_COUNT = 26;
    const DROPLET_BUCKETS = 10;
    let aw = 0, ah = 0, droplets = [];

    const makeDropletSprite = (depth) => {
      const r = 1.3 + depth * 3.6 + 0.55;
      const alpha = 0.22 + depth * 0.3 + 0.04;
      const blur = (1 - depth) * 1.4;
      const pad = Math.ceil(blur * 3 + 4);
      const size = Math.ceil(r * 2 + pad * 2);
      const sprite = document.createElement('canvas');
      sprite.width = size;
      sprite.height = size;
      const sctx = sprite.getContext('2d');
      const cx = size / 2, cy = size / 2;

      sctx.filter = blur > 0.15 ? `blur(${blur.toFixed(2)}px)` : 'none';
      const grad = sctx.createRadialGradient(cx - r * 0.3, cy - r * 0.32, 0, cx, cy, r);
      grad.addColorStop(0, `rgba(214,226,240,${alpha})`);
      grad.addColorStop(0.5, `rgba(72,98,134,${alpha * 0.9})`);
      grad.addColorStop(1, 'rgba(30,46,72,0)');
      sctx.fillStyle = grad;
      sctx.beginPath();
      sctx.arc(cx, cy, r, 0, Math.PI * 2);
      sctx.fill();

      sctx.filter = 'none';
      sctx.fillStyle = `rgba(255,255,255,${Math.min(0.8, alpha * 2)})`;
      sctx.beginPath();
      sctx.arc(cx - r * 0.34, cy - r * 0.34, Math.max(0.45, r * 0.24), 0, Math.PI * 2);
      sctx.fill();

      sctx.fillStyle = `rgba(28,42,66,${alpha * 0.35})`;
      sctx.beginPath();
      sctx.arc(cx + r * 0.3, cy + r * 0.34, r * 0.5, 0, Math.PI * 2);
      sctx.fill();

      return { canvas: sprite, half: size / 2, r };
    };
    const dropletSprites = Array.from({ length: DROPLET_BUCKETS }, (_, i) =>
      makeDropletSprite(i / (DROPLET_BUCKETS - 1))
    );

    const makeDroplet = () => {
      const depth = Math.random();
      const bucket = Math.min(DROPLET_BUCKETS - 1, Math.floor(depth * DROPLET_BUCKETS));
      return {
        x: Math.random() * aw,
        y: Math.random() * ah,
        bucket,
        r: dropletSprites[bucket].r,
        speedY: 0.045 + depth * 0.12 + Math.random() * 0.05,
        drift: (Math.random() - 0.5) * 0.04,
        phase: Math.random() * Math.PI * 2
      };
    };

    const resizeAmbient = () => {
      aw = window.innerWidth;
      ah = window.innerHeight;
      ambientCanvas.width = Math.max(1, Math.round(aw * adpr));
      ambientCanvas.height = Math.max(1, Math.round(ah * adpr));
      actx.setTransform(adpr, 0, 0, adpr, 0, 0);
    };
    resizeAmbient();
    droplets = Array.from({ length: DROPLET_COUNT }, makeDroplet);
    window.addEventListener('resize', resizeAmbient);

    let ambientFrame = 0;
    let ambientPaused = document.visibilityState !== 'visible';
    document.addEventListener('visibilitychange', () => {
      const wasPaused = ambientPaused;
      ambientPaused = document.visibilityState !== 'visible';
      if (wasPaused && !ambientPaused) requestAnimationFrame(drawAmbient);
    });

    const drawAmbient = () => {
      if (ambientPaused) return;
      ambientFrame++;
      actx.clearRect(0, 0, aw, ah);
      droplets.forEach((d) => {
        d.y += d.speedY;
        d.x += d.drift + Math.sin(ambientFrame * 0.01 + d.phase) * 0.06;
        if (d.y > ah + d.r) { d.y = -d.r; d.x = Math.random() * aw; }
        if (d.x < -d.r) d.x = aw + d.r;
        if (d.x > aw + d.r) d.x = -d.r;

        const sprite = dropletSprites[d.bucket];
        actx.drawImage(sprite.canvas, d.x - sprite.half, d.y - sprite.half);
      });
      requestAnimationFrame(drawAmbient);
    };
    requestAnimationFrame(drawAmbient);
  }

  /* ---------- Scroll-driven lighting glow + dynamic background color ---------- */
  const root = document.documentElement;

  // Light-palette stops the page background eases through as the user scrolls
  // from top to bottom — same tokens as --obsidian/--obsidian-2/--slate/--slate-2.
  const BG_STOPS = ['#f6f7f9', '#eef0f3', '#e7eaee', '#dde1e7'].map((hex) => {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  });
  const lerpBackground = (progress) => {
    const segments = BG_STOPS.length - 1;
    const scaled = Math.min(Math.max(progress, 0), 1) * segments;
    const i = Math.min(Math.floor(scaled), segments - 1);
    const t = scaled - i;
    const [r1, g1, b1] = BG_STOPS[i];
    const [r2, g2, b2] = BG_STOPS[i + 1];
    const r = Math.round(r1 + (r2 - r1) * t);
    const g = Math.round(g1 + (g2 - g1) * t);
    const b = Math.round(b1 + (b2 - b1) * t);
    return `rgb(${r}, ${g}, ${b})`;
  };

  /* ---------- Decoupled scroll loop ----------
     The passive listener below does nothing but record the raw scrollY —
     no DOM reads, no DOM writes, no canvas work happens inside a scroll
     event. A single continuously-running rAF loop lerps that raw value
     into a smoothed one and is the only place that ever touches the DOM
     (the nav class here, the --glow-y/--scroll-bg custom properties
     below). This is deliberately NOT applied to the hero canvas scrub
     further down — GSAP ScrollTrigger already runs its own internal rAF
     ticker, and the tween's scrub:0.15 already lerps scroll position into
     frame position, so duplicating a second competing loop there would
     just add overhead without changing the result. */
  let targetScrollY = window.scrollY;
  let currentScrollY = targetScrollY;
  window.addEventListener('scroll', () => { targetScrollY = window.scrollY; }, { passive: true });

  // Hide-on-scroll-down / show-on-scroll-up: tracked off the raw target
  // (not the lerped currentScrollY) so direction flips register immediately
  // instead of through the smoothing lag. Distance is accumulated rather
  // than toggled on every frame delta, so small trackpad jitter right at a
  // scroll reversal doesn't flicker the nav in and out.
  let lastRawScrollY = targetScrollY;
  let navHideAccum = 0;

  // Assigned further down (see "Cinematic hero scrub") once the drone3D
  // canvas exists — reading it here rather than adding a second rAF loop,
  // per the note above about not duplicating the pinned-canvas scrub's own
  // ticker. Safe to reference before assignment: this function's *body*
  // only runs on the next animation frame, by which point the whole
  // synchronous DOMContentLoaded callback (including the assignment below)
  // has run.
  let cineScrubTick = null;

  const scrollTick = () => {
    currentScrollY += (targetScrollY - currentScrollY) * 0.25;
    if (Math.abs(targetScrollY - currentScrollY) < 0.05) currentScrollY = targetScrollY;

    if (cineScrubTick) cineScrubTick();

    nav.classList.toggle('scrolled', currentScrollY > 40);

    if (!nav.classList.contains('menu-open')) {
      const rawDelta = targetScrollY - lastRawScrollY;
      navHideAccum += rawDelta;
      if (targetScrollY < 120) {
        nav.classList.remove('nav-hidden');
        navHideAccum = 0;
      } else if (navHideAccum > 14) {
        nav.classList.add('nav-hidden');
        navHideAccum = 0;
      } else if (navHideAccum < -14) {
        nav.classList.remove('nav-hidden');
        navHideAccum = 0;
      }
    }
    lastRawScrollY = targetScrollY;

    const scrollable = root.scrollHeight - window.innerHeight;
    const progress = scrollable > 0 ? currentScrollY / scrollable : 0;
    root.style.setProperty('--glow-y', `${progress * 100}%`);
    root.style.setProperty('--scroll-bg', lerpBackground(progress));

    requestAnimationFrame(scrollTick);
  };
  requestAnimationFrame(scrollTick);

  /* ---------- Cinematic hero scrub (drone3D flip-book + camera HUD) ----------
     49 pre-rendered frames stand in for a real <video> because scroll-
     scrubbing needs frame-accurate random access a <video> element can't
     give (seeking is async and throttled). The section is pinned
     (position: sticky, see .cine-hero/.cine-stage in styles.css) on every
     viewport size, and the frame shown tracks scroll progress through
     that pinned 400vh track — computed in cineScrubTick, called from the
     shared scrollTick loop above rather than a second listener/rAF.
     Unlike the old boxed portrait clip, the canvas here is full-bleed
     (100vw x 100vh) and each frame is drawn in "cover" mode (cropped to
     the viewport's aspect ratio) — see drawCover. All 49 frames are
     preloaded into memory behind the #cineLoading screen before the
     scene is revealed at all; there's no progressive/partial reveal this
     time, per the brief. */
  const cineCanvas = document.getElementById('cineCanvas');
  const cineHero = document.querySelector('.cine-hero');
  if (cineCanvas && cineHero) {
    const CINE_TOTAL_FRAMES = 49;
    const cineCtx = cineCanvas.getContext('2d');
    const cineImages = [];
    let cineLastDrawn = -1;

    const isReady = (img) => img && img.complete && img.naturalWidth;

    // Emulates CSS object-fit:cover via the 9-arg drawImage form: crops
    // the source frame to the canvas's own aspect ratio instead of
    // stretching it, so the (portrait) source footage always fills the
    // (usually landscape, on desktop) viewport with no distortion.
    const drawCover = (img) => {
      const cw = cineCanvas.width, ch = cineCanvas.height;
      const ir = img.naturalWidth / img.naturalHeight;
      const cr = cw / ch;
      let sx, sy, sw, sh;
      if (ir > cr) {
        sh = img.naturalHeight;
        sw = sh * cr;
        sy = 0;
        sx = (img.naturalWidth - sw) / 2;
      } else {
        sw = img.naturalWidth;
        sh = sw / cr;
        sx = 0;
        sy = (img.naturalHeight - sh) / 2;
      }
      cineCtx.drawImage(img, sx, sy, sw, sh, 0, 0, cw, ch);
    };

    const drawCineFrame = (index, force) => {
      let target = index;
      if (!isReady(cineImages[target])) {
        // Shouldn't normally happen (the whole point of the preload gate
        // below is that every frame is already in memory before the scene
        // is shown) — kept as a defensive fallback for a single dropped
        // frame (e.g. one flaky request) rather than freezing on nothing.
        let lo = target - 1, hi = target + 1;
        while (lo >= 0 || hi < CINE_TOTAL_FRAMES) {
          if (lo >= 0 && isReady(cineImages[lo])) { target = lo; break; }
          if (hi < CINE_TOTAL_FRAMES && isReady(cineImages[hi])) { target = hi; break; }
          lo--; hi++;
        }
      }
      const img = cineImages[target];
      if (!isReady(img)) return;
      if (!force && target === cineLastDrawn) return;
      cineLastDrawn = target;
      drawCover(img);
    };

    const sizeCineCanvas = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      cineCanvas.width = Math.round(window.innerWidth * dpr);
      cineCanvas.height = Math.round(window.innerHeight * dpr);
      drawCineFrame(Math.max(cineLastDrawn, 0), true);
    };
    window.addEventListener('resize', sizeCineCanvas);
    sizeCineCanvas();

    for (let i = 0; i < CINE_TOTAL_FRAMES; i++) {
      const img = new Image();
      img.decoding = 'async';
      cineImages.push(img);
    }

    // Fetch in bisected order (0, last, midpoint, quarter-points, ...)
    // rather than strict 1→49 — gets *some* frame loaded across the whole
    // range within the first handful of requests, so the nearest-loaded-
    // frame fallback in drawCineFrame has something close by even before
    // every frame is confirmed in (and so the loading bar doesn't look
    // like it's stalled on one end of the sequence).
    const loadOrder = [];
    const queued = new Set();
    const enqueue = (i) => { if (!queued.has(i)) { queued.add(i); loadOrder.push(i); } };
    enqueue(0);
    enqueue(CINE_TOTAL_FRAMES - 1);
    let ranges = [[0, CINE_TOTAL_FRAMES - 1]];
    while (ranges.length) {
      const next = [];
      for (const [lo, hi] of ranges) {
        if (hi - lo <= 1) continue;
        const mid = Math.floor((lo + hi) / 2);
        enqueue(mid);
        next.push([lo, mid], [mid, hi]);
      }
      ranges = next;
    }
    for (let i = 0; i < CINE_TOTAL_FRAMES; i++) enqueue(i);

    /* ---------- Full preload gate + loading screen ----------
       The brief wants every frame decoded in memory *before* the scene is
       shown at all, instead of the old progressive reveal — still fetched
       with limited concurrency (a throttled connection doesn't finish any
       sooner by splitting its bandwidth 49 ways at once) so time-to-first-
       frame on the loading bar stays reasonable. */
    const cineLoading = document.getElementById('cineLoading');
    const cineLoadingFill = document.getElementById('cineLoadingFill');
    const cineLoadingLabel = document.getElementById('cineLoadingLabel');
    const CINE_LOAD_CONCURRENCY = 6;
    let cineLoadedCount = 0;
    let cineRevealed = false;

    const revealCineHero = () => {
      if (cineRevealed) return;
      cineRevealed = true;
      drawCineFrame(0, true);
      cineLoading && cineLoading.classList.add('is-done');
    };
    // Safety net — a stuck request (dead connection, a bad 404) must never
    // leave a visitor staring at a loading screen forever.
    const cineRevealTimeout = setTimeout(revealCineHero, 12000);

    const onCineFrameSettled = () => {
      cineLoadedCount++;
      const pct = Math.round((cineLoadedCount / CINE_TOTAL_FRAMES) * 100);
      if (cineLoadingFill) cineLoadingFill.style.width = `${pct}%`;
      if (cineLoadingLabel) cineLoadingLabel.textContent = `Chargement ${pct}%`;
      if (cineLoadedCount >= CINE_TOTAL_FRAMES) {
        clearTimeout(cineRevealTimeout);
        revealCineHero();
      }
    };

    let cineLoadCursor = 0;
    const startNextCineLoad = () => {
      if (cineLoadCursor >= loadOrder.length) return;
      const i = loadOrder[cineLoadCursor++];
      const img = cineImages[i];
      img.addEventListener('load', () => { onCineFrameSettled(); startNextCineLoad(); }, { once: true });
      img.addEventListener('error', () => { onCineFrameSettled(); startNextCineLoad(); }, { once: true });
      img.src = `/images/hero-frames/drone3d/drone3D_${String(i + 1).padStart(4, '0')}.jpg`;
    };
    for (let c = 0; c < CINE_LOAD_CONCURRENCY; c++) startNextCineLoad();

    /* ---------- HUD (timecode / section label / frame counter / scrub bar) ---------- */
    const hudTimecode = document.getElementById('hudTimecode');
    const hudSectionLabel = document.getElementById('hudSectionLabel');
    const hudSectionCount = document.getElementById('hudSectionCount');
    const hudFrameCounter = document.getElementById('hudFrameCounter');
    const hudTicksActive = document.getElementById('hudTicksActive');
    const hudScrubFillBg = document.getElementById('hudScrubFillBg');
    const hudAudioBars = document.getElementById('hudAudioBars');
    const hudMuteBtn = document.getElementById('hudMuteBtn');

    // Five acts, sharing their boundaries exactly with the sequential
    // word-cycle below (Façade → Toiture → Photovoltaïque → Bardage → the
    // drone touching down) rather than an even split — one coherent
    // timeline instead of two that drift out of sync with each other.
    const CINE_PHASES = [
      { label: 'Façade', from: 0 },
      { label: 'Toiture', from: 0.20 },
      { label: 'Photovoltaïque', from: 0.45 },
      { label: 'Bardage', from: 0.70 },
      { label: 'Atterrissage', from: 0.95 },
    ];
    const getPhaseIndex = (progress) => {
      let idx = 0;
      for (let i = 0; i < CINE_PHASES.length; i++) {
        if (progress >= CINE_PHASES[i].from) idx = i;
      }
      return idx;
    };
    const CINE_VIRTUAL_DURATION_S = 118; // purely cosmetic — just gives the HUD timecode somewhere to count up to
    const CINE_VIRTUAL_FPS = 24;
    let cineLastSectionIdx = -1;
    let cineLastProgress = 0;

    const formatTimecode = (totalSeconds) => {
      const totalFrames = Math.max(0, Math.round(totalSeconds * CINE_VIRTUAL_FPS));
      const ff = totalFrames % CINE_VIRTUAL_FPS;
      const wholeSeconds = Math.floor(totalFrames / CINE_VIRTUAL_FPS);
      const ss = wholeSeconds % 60;
      const mm = Math.floor(wholeSeconds / 60) % 60;
      const hh = Math.floor(wholeSeconds / 3600);
      const pad = (n) => String(n).padStart(2, '0');
      return `${pad(hh)}:${pad(mm)}:${pad(ss)}:${pad(ff)}`;
    };

    /* ---------- Word cycle (Façade → Toiture → Photovoltaïque → Bardage) ----------
       One word at a time, all stacked in the exact same spot below the
       title (see .cine-word-row in styles.css) — each rises out of a soft
       mist into place, holds, then continues rising as it dissolves back
       into the mist above, and only then does the next word begin
       materializing. The windows below never overlap (each exitEnd <=
       the next entry's enterStart), so there is no instant with two words
       at non-zero opacity. Driven continuously by scroll progress —
       inline styles set every frame, not a CSS transition — so stopping
       mid-scroll shows a partially-formed word, never an all-or-nothing
       snap. Blur + opacity + a touch of scale/vertical drift, entirely
       transform/opacity/filter so it stays compositor-friendly at 60fps. */
    const cineSideWords = [
      { el: document.getElementById('wordFacade'), enterStart: 0, enterEnd: 0.035, exitStart: 0.165, exitEnd: 0.20 },
      { el: document.getElementById('wordToiture'), enterStart: 0.20, enterEnd: 0.235, exitStart: 0.415, exitEnd: 0.45 },
      { el: document.getElementById('wordPhotovoltaique'), enterStart: 0.45, enterEnd: 0.485, exitStart: 0.665, exitEnd: 0.70 },
      { el: document.getElementById('wordBardage'), enterStart: 0.70, enterEnd: 0.735, exitStart: 0.915, exitEnd: 0.95 },
    ].filter((w) => w.el);
    const SIDE_WORD_BLUR_PX = 14;
    const SIDE_WORD_DRIFT_PX = 18;
    let cineSideWordsEverActive = false;

    const updateSideWords = (progress) => {
      let anyActive = false;
      cineSideWords.forEach(({ el, enterStart, enterEnd, exitStart, exitEnd }) => {
        let eased, driftPx;
        if (progress <= enterStart) {
          eased = 0; driftPx = SIDE_WORD_DRIFT_PX;
        } else if (progress < enterEnd) {
          // easeOutCubic rising in from below — condenses out of the mist
          // quickly then settles into place.
          const t = (progress - enterStart) / (enterEnd - enterStart);
          eased = 1 - Math.pow(1 - t, 3);
          driftPx = (1 - eased) * SIDE_WORD_DRIFT_PX;
        } else if (progress < exitStart) {
          eased = 1; driftPx = 0;
        } else if (progress < exitEnd) {
          // easeInCubic dissolving back out, continuing the same upward
          // drift rather than reversing it — one continuous motion.
          const t = (progress - exitStart) / (exitEnd - exitStart);
          eased = Math.pow(1 - t, 3);
          driftPx = -t * SIDE_WORD_DRIFT_PX;
        } else {
          eased = 0; driftPx = -SIDE_WORD_DRIFT_PX;
        }
        if (eased > 0) anyActive = true;
        el.style.opacity = eased.toFixed(3);
        el.style.filter = `blur(${((1 - eased) * SIDE_WORD_BLUR_PX).toFixed(2)}px)`;
        el.style.transform = `translateY(${driftPx.toFixed(2)}px) scale(${(0.94 + eased * 0.06).toFixed(3)}) translateZ(0)`;
      });
      if (!cineSideWordsEverActive && anyActive) {
        cineSideWordsEverActive = true;
        cineSideWords.forEach(({ el }) => { el.style.willChange = 'opacity, filter, transform'; });
      }
    };

    /* ---------- Synthesized drone sound (Web Audio, no audio file) ----------
       Three close-detuned sawtooth oscillators (engine "beat"/chorus)
       summed through a fast ~48Hz gain-modulated LFO (rotor-blade thrum),
       plus a thin bed of filtered white noise (air rush). Pitch and volume
       both track scroll progress: a quick rev-up in the first 6%, then a
       long descent toward near-silence as the drone reaches the ground by
       the last frame — matches the footage (already airborne at frame 1,
       touching down at frame 49). Everything is built lazily on first use
       so a visitor who never touches sound never pays for an AudioContext
       at all. Browsers block audible output before any interaction — ANY
       click/tap on the page warms the context up (see the pointerdown/
       keydown listeners below) so there's no first-click lag once sound
       IS requested, but actual volume stays at 0 until the HUD button is
       explicitly switched on: going audible the instant a context unlocks
       would be a surprise, not a feature. */
    const DRONE_DETUNE = [1, 1.012, 0.986];
    let audioCtx = null;
    let droneNodes = null;
    let soundEnabled = false;

    const buildDroneGraph = () => {
      if (droneNodes) return;
      const ctx = audioCtx;
      const now = ctx.currentTime;

      const masterGain = ctx.createGain();
      masterGain.gain.setValueAtTime(0, now);
      masterGain.connect(ctx.destination);

      const droneGain = ctx.createGain();
      droneGain.gain.setValueAtTime(0.001, now);
      droneGain.connect(masterGain);
      const oscillators = DRONE_DETUNE.map((mult) => {
        const osc = ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(90 * mult, now);
        osc.connect(droneGain);
        osc.start();
        return osc;
      });

      // Rotor-blade thrum — an audio-rate LFO modulating the drone gain's
      // own AudioParam (the standard Web Audio "connect an oscillator into
      // a gain param" modulation trick), not an audible tone on its own.
      const lfo = ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.setValueAtTime(48, now);
      const lfoDepth = ctx.createGain();
      lfoDepth.gain.setValueAtTime(0.05, now);
      lfo.connect(lfoDepth);
      lfoDepth.connect(droneGain.gain);
      lfo.start();

      // Filtered white noise — a soft "air rush" bed under the tonal drone.
      const noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const noiseData = noiseBuffer.getChannelData(0);
      for (let i = 0; i < noiseData.length; i++) noiseData[i] = Math.random() * 2 - 1;
      const noiseSource = ctx.createBufferSource();
      noiseSource.buffer = noiseBuffer;
      noiseSource.loop = true;
      const noiseFilter = ctx.createBiquadFilter();
      noiseFilter.type = 'lowpass';
      noiseFilter.frequency.setValueAtTime(1100, now);
      const noiseGain = ctx.createGain();
      noiseGain.gain.setValueAtTime(0.001, now);
      noiseSource.connect(noiseFilter);
      noiseFilter.connect(noiseGain);
      noiseGain.connect(masterGain);
      noiseSource.start();

      droneNodes = { masterGain, droneGain, oscillators, noiseGain };
    };

    const ensureAudioContext = () => {
      if (!audioCtx) {
        const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextCtor) return;
        try {
          audioCtx = new AudioContextCtor();
          buildDroneGraph();
        } catch (e) { audioCtx = null; }
      }
      if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
    };
    ['pointerdown', 'keydown'].forEach((evt) => {
      window.addEventListener(evt, ensureAudioContext, { once: true, passive: true });
    });

    const setSoundEnabled = (on) => {
      soundEnabled = on;
      if (!audioCtx || !droneNodes) return;
      const now = audioCtx.currentTime;
      droneNodes.masterGain.gain.cancelScheduledValues(now);
      droneNodes.masterGain.gain.setTargetAtTime(on ? 1 : 0, now, 0.2);
    };

    // A one-shot synthesized "touchdown" thump — a sine burst that drops in
    // pitch and decays fast, layered on top of the engine drone right as it
    // fades out. Built fresh each time (oscillators can only ever be
    // started once, unlike the persistent engine graph above) and routed
    // through the same masterGain so it respects the mute state/overall
    // volume rather than bypassing it.
    const playLandingThud = () => {
      if (!audioCtx || !droneNodes) return;
      const now = audioCtx.currentTime;
      const thudOsc = audioCtx.createOscillator();
      thudOsc.type = 'sine';
      thudOsc.frequency.setValueAtTime(130, now);
      thudOsc.frequency.exponentialRampToValueAtTime(34, now + 0.22);
      const thudGain = audioCtx.createGain();
      thudGain.gain.setValueAtTime(0.0001, now);
      thudGain.gain.exponentialRampToValueAtTime(0.32, now + 0.012);
      thudGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.55);
      thudOsc.connect(thudGain);
      thudGain.connect(droneNodes.masterGain);
      thudOsc.start(now);
      thudOsc.stop(now + 0.6);
    };
    let landingThudArmed = true;
    const LANDING_THUD_AT = 0.95;

    const updateDroneAudio = (progress) => {
      if (!audioCtx || !droneNodes) return;
      const now = audioCtx.currentTime;
      // Quick rev-up in the first 6%, then a straight-line descent all the
      // way to true silence (not a floor above zero) by progress 1 — the
      // drone is on the ground by the last frame, so there must be nothing
      // left playing under the landing thump below.
      const REV_UP_END = 0.06;
      const intensity = progress < REV_UP_END
        ? 0.7 + (progress / REV_UP_END) * 0.3
        : Math.max(0, 1 - (progress - REV_UP_END) / (1 - REV_UP_END));
      const baseFreq = 55 + intensity * 55;
      droneNodes.oscillators.forEach((osc, i) => {
        osc.frequency.setTargetAtTime(baseFreq * DRONE_DETUNE[i], now, 0.1);
      });
      // Cut roughly in half from the first pass — three summed detuned
      // sawtooths build up more perceived loudness/harshness than each
      // individual gain value suggests.
      droneNodes.droneGain.gain.setTargetAtTime(intensity * 0.09, now, 0.12);
      droneNodes.noiseGain.gain.setTargetAtTime(intensity * 0.025, now, 0.12);

      if (progress >= LANDING_THUD_AT) {
        if (landingThudArmed && soundEnabled) {
          landingThudArmed = false;
          playLandingThud();
        }
      } else if (progress < LANDING_THUD_AT - 0.03) {
        landingThudArmed = true;
      }
    };

    hudMuteBtn && hudMuteBtn.addEventListener('click', () => {
      ensureAudioContext(); // covers this click also being the first interaction
      setSoundEnabled(!soundEnabled);
      hudMuteBtn.setAttribute('aria-pressed', String(soundEnabled));
      hudMuteBtn.textContent = soundEnabled ? 'Coupez le son' : 'Activer le son';
      hudAudioBars && hudAudioBars.classList.toggle('is-muted', !soundEnabled);
      if (soundEnabled) updateDroneAudio(cineLastProgress);
    });

    // Water-spray hook — fires once as the scrub crosses into the Façade/
    // Toiture window, and re-arms if the visitor scrolls back above the
    // threshold so it can play again on a second pass through. A clean,
    // optional slot for a real recording later (see /audio/hero-water-
    // spray.mp3) rather than a requirement — every entry point into it is
    // wrapped so a missing file can never throw, and it only ever plays
    // once sound is actually switched on.
    let cineWaterAudio;
    try { cineWaterAudio = new Audio('/audio/hero-water-spray.mp3'); cineWaterAudio.preload = 'auto'; } catch (e) { cineWaterAudio = null; }
    let waterSoundArmed = true;
    const WATER_SOUND_THRESHOLD = 0.05;

    const updateHud = (progress, frameIndex) => {
      const sectionIdx = getPhaseIndex(progress);
      if (sectionIdx !== cineLastSectionIdx) {
        cineLastSectionIdx = sectionIdx;
        if (hudSectionLabel) hudSectionLabel.textContent = `${String(sectionIdx + 1).padStart(2, '0')} · ${CINE_PHASES[sectionIdx].label.toUpperCase()}`;
        if (hudSectionCount) hudSectionCount.textContent = `SECTION ${String(sectionIdx + 1).padStart(2, '0')} / ${String(CINE_PHASES.length).padStart(2, '0')}`;
      }
      if (hudTimecode) hudTimecode.textContent = formatTimecode(progress * CINE_VIRTUAL_DURATION_S);
      if (hudFrameCounter) hudFrameCounter.textContent = `CADRE ${String(frameIndex + 1).padStart(3, '0')} / ${String(CINE_TOTAL_FRAMES).padStart(3, '0')}`;
      const pct = `${(progress * 100).toFixed(2)}%`;
      if (hudTicksActive) hudTicksActive.style.width = pct;
      if (hudScrubFillBg) hudScrubFillBg.style.width = pct;

      if (cineWaterAudio) {
        if (progress >= WATER_SOUND_THRESHOLD) {
          if (waterSoundArmed && soundEnabled) {
            waterSoundArmed = false;
            try { cineWaterAudio.currentTime = 0; } catch (e) { /* not seekable yet, fine */ }
            cineWaterAudio.play().catch(() => {});
          }
        } else if (progress < WATER_SOUND_THRESHOLD - 0.03) {
          waterSoundArmed = true;
        }
      }
    };

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      // No scrub — land on one representative frame with the HUD and side
      // words reflecting that same static point, instead of ticking off
      // scroll.
      const stillIndex = Math.floor(CINE_TOTAL_FRAMES * 0.3);
      const stillProgress = stillIndex / (CINE_TOTAL_FRAMES - 1);
      cineLastProgress = stillProgress;
      updateHud(stillProgress, stillIndex);
      updateSideWords(stillProgress);
      cineImages[stillIndex].addEventListener('load', () => drawCineFrame(stillIndex, true));
    } else {
      cineScrubTick = () => {
        const rect = cineHero.getBoundingClientRect();
        // Once the whole hero (sticky stage included) has scrolled out
        // above the viewport there's nothing left to draw — and,
        // critically, cut the engine sound immediately rather than let it
        // coast on whatever gain it last held. Web Audio nodes don't stop
        // themselves just because nobody's looking at the canvas anymore;
        // hearing the drone hum on into later sections read as a bug, not
        // ambience, so this is a hard, instant cut (setValueAtTime), not
        // the usual gentle setTargetAtTime decay. Scrolling back up into
        // the hero resumes normally next frame — only droneGain/noiseGain
        // are touched here, not the mute button's own masterGain.
        if (rect.bottom <= 0) {
          if (audioCtx && droneNodes) {
            const now = audioCtx.currentTime;
            droneNodes.droneGain.gain.cancelScheduledValues(now);
            droneNodes.droneGain.gain.setValueAtTime(0, now);
            droneNodes.noiseGain.gain.cancelScheduledValues(now);
            droneNodes.noiseGain.gain.setValueAtTime(0, now);
          }
          return;
        }
        const scrollable = rect.height - window.innerHeight;
        const progress = scrollable > 0 ? Math.min(1, Math.max(0, -rect.top / scrollable)) : 0;
        const frameIndex = Math.round(progress * (CINE_TOTAL_FRAMES - 1));
        cineLastProgress = progress;
        drawCineFrame(frameIndex);
        updateHud(progress, frameIndex);
        updateSideWords(progress);
        updateDroneAudio(progress);
      };
    }
  }

  /* ---------- Pointer-tracked spotlight on bento/glass surfaces ---------- */
  const spotlightEls = document.querySelectorAll('.stat, .cap-card, .timeline-item, .estimate-card, .reliability-list li, .glow-surface');
  if (window.matchMedia('(hover: hover) and (pointer: fine)').matches) {
    spotlightEls.forEach(el => {
      // getBoundingClientRect() is a layout read; doing it on every
      // pointermove (which can fire well past 60Hz) was redundant work for
      // a box that isn't moving during the gesture. Read it once per hover
      // and coalesce the style writes to one per animation frame.
      let rect = null;
      let raf = 0;
      let lastX = 0, lastY = 0;
      el.addEventListener('pointerenter', () => { rect = el.getBoundingClientRect(); });
      el.addEventListener('pointermove', (e) => {
        lastX = e.clientX;
        lastY = e.clientY;
        if (raf) return;
        raf = requestAnimationFrame(() => {
          raf = 0;
          if (!rect) rect = el.getBoundingClientRect();
          el.style.setProperty('--mx', `${((lastX - rect.left) / rect.width) * 100}%`);
          el.style.setProperty('--my', `${((lastY - rect.top) / rect.height) * 100}%`);
        });
      });
    });
  }


  /* ---------- Reveal on scroll ---------- */
  // will-change is applied here in JS, only for the duration of the actual
  // transition, instead of sitting permanently on every [data-reveal]
  // element in CSS (which was promoting 30-50+ elements to their own GPU
  // layer at all times — a real contributor to the mobile OOM crashes).
  // Cleared on transitionend so each element drops back to a normal,
  // non-promoted layer once it's done animating.
  const revealEls = document.querySelectorAll('[data-reveal]');
  const revealObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const el = entry.target;
        el.style.willChange = 'opacity, transform';
        el.addEventListener('transitionend', () => { el.style.willChange = 'auto'; }, { once: true });
        el.classList.add('is-visible');
        revealObserver.unobserve(el);
      }
    });
  }, { threshold: 0.15, rootMargin: '0px 0px -40px 0px' });
  revealEls.forEach(el => revealObserver.observe(el));

  /* ---------- Animated stat counters ---------- */
  const counters = document.querySelectorAll('.stat-value[data-count]');
  const animateCount = (el) => {
    const target = parseFloat(el.dataset.count);
    const prefix = el.dataset.prefix || '';
    const suffix = el.dataset.suffix || '';
    const duration = 1200;
    const start = performance.now();
    const tick = (now) => {
      const progress = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      const value = Math.round(target * eased);
      el.textContent = `${prefix}${value}${suffix}`;
      if (progress < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };
  const counterObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        animateCount(entry.target);
        counterObserver.unobserve(entry.target);
      }
    });
  }, { threshold: 0.6 });
  counters.forEach(el => counterObserver.observe(el));

  /* ---------- Showcase video plays only while in view ---------- */
  const showcaseVideo = document.getElementById('showcaseVideo');
  if (showcaseVideo) {
    const videoObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          showcaseVideo.play().catch(() => {});
        } else {
          showcaseVideo.pause();
        }
      });
    }, { threshold: 0.3 });
    videoObserver.observe(showcaseVideo);
  }

  /* ---------- Custom cursor ---------- */
  const ring = document.getElementById('cursorRing');
  const canHover = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  if (canHover) {
    let x = window.innerWidth / 2, y = window.innerHeight / 2;
    let rx = x, ry = y;
    window.addEventListener('mousemove', (e) => { x = e.clientX; y = e.clientY; });
    const loop = () => {
      rx += (x - rx) * 0.18;
      ry += (y - ry) * 0.18;
      ring.style.transform = `translate(${rx}px, ${ry}px) translate(-50%, -50%)`;
      requestAnimationFrame(loop);
    };
    loop();

    document.querySelectorAll('[data-cursor="link"], a, button, input, select, textarea').forEach(el => {
      el.addEventListener('mouseenter', () => ring.classList.add('hover-link'));
      el.addEventListener('mouseleave', () => ring.classList.remove('hover-link'));
    });
  } else {
    ring.style.display = 'none';
  }

  /* ---------- Before / After slider (native pointer events) ---------- */
  const baFrame = document.getElementById('baFrame');
  const baBeforeImg = document.getElementById('baBeforeImg');
  const baHandle = document.getElementById('baHandle');
  const baGrip = document.getElementById('baGrip');

  if (baFrame && baBeforeImg && baHandle && baGrip) {
    let dragging = false;

    const setPosition = (pct) => {
      pct = Math.min(Math.max(pct, 0), 100);
      baBeforeImg.style.clipPath = `inset(0 ${100 - pct}% 0 0)`;
      baHandle.style.left = `${pct}%`;
      baGrip.setAttribute('aria-valuenow', String(Math.round(pct)));
    };

    const pctFromClientX = (clientX) => {
      const rect = baFrame.getBoundingClientRect();
      return ((clientX - rect.left) / rect.width) * 100;
    };

    const onPointerDown = (e) => {
      dragging = true;
      baFrame.classList.add('dragging');
      setPosition(pctFromClientX(e.clientX));
    };
    const onPointerMove = (e) => {
      if (!dragging) return;
      setPosition(pctFromClientX(e.clientX));
    };
    const onPointerUp = () => {
      dragging = false;
      baFrame.classList.remove('dragging');
    };

    baFrame.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);

    baGrip.addEventListener('keydown', (e) => {
      const current = parseFloat(baHandle.style.left) || 50;
      if (e.key === 'ArrowLeft') { setPosition(current - 4); e.preventDefault(); }
      if (e.key === 'ArrowRight') { setPosition(current + 4); e.preventDefault(); }
      if (e.key === 'Home') { setPosition(0); e.preventDefault(); }
      if (e.key === 'End') { setPosition(100); e.preventDefault(); }
    });
  }

  /* ---------- Action cards horizontal scroll ("Le drone, sur le terrain") ----------
     Merges the old gallery marquee + capabilities grid into one GSAP
     ScrollTrigger horizontal pin — the whole point being that the page
     holds still and the cards do the scrolling for you, on every device:
     the section pins near the top of the viewport — start:'top 90px', not
     'top top', leaves clearance for the fixed nav bar (the same nav-
     collision lesson learned the hard way on the cine-hero's HUD, see
     "Cinematic hero scrub" above) — and .action-track translates left by
     exactly its own overflow width while the user scrolls vertically
     through the pin's scroll distance; once the track is fully scrolled,
     the pin releases and normal vertical scroll carries straight on into
     "Solutions par secteur". Only under prefers-reduced-motion (or if
     GSAP fails to load off the CDN) does it fall back to .action-pin's
     own native overflow-x:auto from styles.css — plain touch/trackpad
     swipe, no JS at all. pinType:'transform' rather than the default
     'fixed' keeps this stable on mobile browsers whose address bar
     resizes the viewport mid-scroll. */
  const actionPin = document.querySelector('.action-pin');
  const actionTrack = document.getElementById('actionTrack');
  if (actionPin && actionTrack && window.gsap && window.ScrollTrigger) {
    gsap.registerPlugin(ScrollTrigger);
    ScrollTrigger.matchMedia({
      '(prefers-reduced-motion: no-preference)': function () {
        actionPin.classList.add('is-pinned-scroll');
        const getScrollDistance = () => Math.max(0, actionTrack.scrollWidth - actionPin.offsetWidth);
        const tween = gsap.to(actionTrack, {
          x: () => -getScrollDistance(),
          ease: 'none',
          scrollTrigger: {
            trigger: actionPin,
            start: 'top 90px',
            end: () => `+=${getScrollDistance()}`,
            scrub: 0.5,
            pin: true,
            pinType: 'transform',
            anticipatePin: 1,
            invalidateOnRefresh: true,
          },
        });
        // GSAP calls this automatically once the query above stops
        // matching (resize down to mobile, reduced-motion toggled mid-
        // session) — tears down exactly what the query set up.
        return () => {
          tween.scrollTrigger && tween.scrollTrigger.kill();
          tween.kill();
          gsap.set(actionTrack, { clearProps: 'transform' });
          actionPin.classList.remove('is-pinned-scroll');
        };
      },
    });
  }

  /* ---------- Industries tag row: pure-CSS infinite marquee ----------
     Same pause pattern as the gallery marquee above — pointerenter/leave
     for mouse, touchstart/touchend for touch, never :hover, for the same
     reason (a touch tap's lingering :hover would wedge it paused). */
  const industriesTrack = document.getElementById('industriesTrack');
  if (industriesTrack && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const pause = () => industriesTrack.classList.add('is-paused');
    const resume = () => industriesTrack.classList.remove('is-paused');

    industriesTrack.addEventListener('pointerenter', (e) => { if (e.pointerType !== 'touch') pause(); });
    industriesTrack.addEventListener('pointerleave', (e) => { if (e.pointerType !== 'touch') resume(); });

    let industriesTouchResumeTimer = null;
    industriesTrack.addEventListener('touchstart', () => {
      clearTimeout(industriesTouchResumeTimer);
      pause();
    }, { passive: true });
    industriesTrack.addEventListener('touchend', () => {
      clearTimeout(industriesTouchResumeTimer);
      industriesTouchResumeTimer = setTimeout(resume, 1800);
    }, { passive: true });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') resume();
      else pause();
    });
  }

  /* ---------- Instant quote calculator ---------- */
  const estimateArea = document.getElementById('estimateArea');
  const estimateService = document.getElementById('estimateService');
  const estimateOutput = document.getElementById('estimateOutput');
  const estimateHT = document.getElementById('estimateHT');
  const estimateVAT = document.getElementById('estimateVAT');
  const estimateCta = document.getElementById('estimateCta');
  const estimatePdfBtn = document.getElementById('estimatePdfBtn');
  const estimateClientName = document.getElementById('estimateClientName');
  const RATE_PER_SQM_HT = 6;
  const VAT_RATE = 0.20;

  if (estimateArea && estimateOutput) {
    const fmt = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
    let displayedTTC = 0;
    let targetHT = 0, targetVAT = 0, targetTTC = 0;
    let animating = false;

    // Auto-shrink-to-fit for the big TTC figure — a fixed clamp() alone
    // can't guarantee it always fits: the formatted price (thousand
    // separator included) is one unbreakable string, so on a large surface
    // typed into a narrow phone the row can't wrap or shrink it on its
    // own, and it was overflowing right past the card's edge (clipped by
    // .estimate-card's overflow:hidden — invisible, not just tight).
    // Resets to the CSS clamp() size first, then steps the font down in
    // 1px increments only if it's still wider than the space actually
    // left next to the "Prix TTC" label, so normal-sized totals keep
    // their full designed size untouched.
    const fitEstimateOutput = () => {
      const row = estimateOutput.closest('.estimate-breakdown-total');
      const label = row && row.querySelector('span:first-child');
      if (!row || !label) return;
      estimateOutput.style.fontSize = '';
      const available = row.clientWidth - label.getBoundingClientRect().width - 16;
      let size = parseFloat(getComputedStyle(estimateOutput).fontSize);
      let guard = 0;
      while (estimateOutput.scrollWidth > available && size > 15 && guard < 40) {
        size -= 1;
        estimateOutput.style.fontSize = `${size}px`;
        guard++;
      }
    };

    // Only the big TTC figure gets the lerp-in animation (matches the
    // original single-number treatment) — HT/TVA are secondary line items,
    // updated in lockstep with it on every input so nothing ever looks stale.
    const renderOutput = () => {
      displayedTTC += (targetTTC - displayedTTC) * 0.18;
      if (Math.abs(targetTTC - displayedTTC) < 1) displayedTTC = targetTTC;
      estimateOutput.innerHTML = `${fmt.format(Math.round(displayedTTC))}&nbsp;€`;
      fitEstimateOutput();
      if (displayedTTC !== targetTTC) {
        requestAnimationFrame(renderOutput);
      } else {
        animating = false;
      }
    };

    const updateEstimate = () => {
      const area = Math.max(0, parseFloat(estimateArea.value) || 0);
      targetHT = area * RATE_PER_SQM_HT;
      targetVAT = targetHT * VAT_RATE;
      targetTTC = targetHT + targetVAT;
      if (estimateHT) estimateHT.innerHTML = `${fmt.format(Math.round(targetHT))}&nbsp;€`;
      if (estimateVAT) estimateVAT.innerHTML = `${fmt.format(Math.round(targetVAT))}&nbsp;€`;
      if (!animating) { animating = true; requestAnimationFrame(renderOutput); }
    };

    estimateArea.addEventListener('input', updateEstimate);
    estimateService?.addEventListener('change', updateEstimate);
    // Available width next to the label changes with orientation/resize —
    // re-fit (never re-animate) so a phone rotated mid-session doesn't get
    // stuck with a stale font size sized for the old width.
    window.addEventListener('resize', fitEstimateOutput, { passive: true });

    if (estimateCta) {
      estimateCta.addEventListener('click', (e) => {
        e.preventDefault();
        const area = Math.max(0, parseFloat(estimateArea.value) || 0);
        const service = estimateService ? estimateService.value : '';
        const ht = area * RATE_PER_SQM_HT;
        const ttc = ht * (1 + VAT_RATE);
        const params = area > 0
          ? `?area=${Math.round(area)}&ttc=${Math.round(ttc)}&service=${encodeURIComponent(service)}`
          : '';
        window.location.href = `/contact${params}`;
      });
    }

    /* ---------- PDF quote (jsPDF, loaded lazily) ----------
       The library is only fetched on the visitor's first click of
       "Télécharger le PDF" — nobody pays for it on page load, and most
       visitors never click it at all. Same lazy-injection pattern as the
       chat widget below, just gated on a click instead of window load. */
    let jsPdfLoadPromise = null;
    const loadJsPdf = () => {
      if (window.jspdf?.jsPDF) return Promise.resolve();
      if (!jsPdfLoadPromise) {
        jsPdfLoadPromise = new Promise((resolve, reject) => {
          const s = document.createElement('script');
          s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
          s.onload = resolve;
          s.onerror = () => reject(new Error('jsPDF failed to load'));
          document.body.appendChild(s);
        });
      }
      return jsPdfLoadPromise;
    };

    let cachedLogoDataUrl = null;
    const loadLogoDataUrl = () => {
      if (cachedLogoDataUrl) return Promise.resolve(cachedLogoDataUrl);
      return fetch('/images/pdf/logo-pdf.png')
        .then(r => r.blob())
        .then(blob => new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => { cachedLogoDataUrl = reader.result; resolve(cachedLogoDataUrl); };
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        }))
        .catch(() => null); // missing logo shouldn't block the quote itself
    };

    const slugifyForFilename = (str) => {
      const cleaned = (str || '')
        .normalize('NFD').replace(/[̀-ͯ]/g, '')
        .replace(/[^a-zA-Z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');
      return cleaned || 'Client';
    };

    if (estimatePdfBtn) {
      estimatePdfBtn.addEventListener('click', async () => {
        const area = Math.max(0, parseFloat(estimateArea.value) || 0);
        if (area <= 0) { estimateArea.focus(); return; }

        const originalLabel = estimatePdfBtn.textContent;
        estimatePdfBtn.disabled = true;
        estimatePdfBtn.textContent = 'Génération…';

        try {
          await loadJsPdf();
          const { jsPDF } = window.jspdf;
          const logoDataUrl = await loadLogoDataUrl();

          const service = estimateService ? estimateService.value : 'Nettoyage par drone';
          const ht = area * RATE_PER_SQM_HT;
          const vat = ht * VAT_RATE;
          const ttc = ht + vat;
          const clientName = (estimateClientName?.value || '').trim();
          const dateFmt = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
          const dateStr = dateFmt.format(new Date());
          const validUntil = dateFmt.format(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000));
          // jsPDF's standard fonts only cover WinAnsi — Intl.NumberFormat('fr-FR')
          // groups thousands with a narrow no-break space (U+202F), which isn't in
          // that encoding and renders as a stray "/" glyph. Swap it for a plain
          // space so the PDF (this function only — the on-page display is HTML
          // and renders U+202F correctly) shows "4 000" instead of "4/000".
          const pdfSafe = (str) => str.replace(/[  ]/g, ' ');
          const fmtArea = (n) => pdfSafe(new Intl.NumberFormat('fr-FR').format(n));
          const fmt2 = (n) => pdfSafe(`${new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)} €`);

          const doc = new jsPDF({ unit: 'mm', format: 'a4' });
          const pageWidth = doc.internal.pageSize.getWidth();
          const marginX = 20;
          let y = 20;

          if (logoDataUrl) {
            const logoW = 40, logoH = logoW * (270 / 480);
            doc.addImage(logoDataUrl, 'PNG', (pageWidth - logoW) / 2, y, logoW, logoH);
            y += logoH + 8;
          }

          doc.setFont('helvetica', 'bold');
          doc.setFontSize(18);
          doc.setTextColor(20, 22, 27);
          doc.text('Devis — Exadrone Enterprise', pageWidth / 2, y, { align: 'center' });

          y += 9;
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(10);
          doc.setTextColor(90, 96, 105);
          ['Exadrone Enterprise', '31 rue du Saint Gothard, 75014 Paris, France', 'contact@exadrone-enterprise.com · 07 70 02 21 72']
            .forEach((line) => { doc.text(line, pageWidth / 2, y, { align: 'center' }); y += 5; });

          y += 8;
          doc.setDrawColor(220, 222, 227);
          doc.line(marginX, y, pageWidth - marginX, y);
          y += 12;

          doc.setFont('helvetica', 'bold');
          doc.setFontSize(11);
          doc.setTextColor(20, 22, 27);
          doc.text('Détails du devis', marginX, y);
          y += 9;

          const rows = [
            ['Date', dateStr],
            ...(clientName ? [['Client', clientName]] : []),
            ['Service', service],
            ['Surface', `${fmtArea(area)} m²`],
            ['Prix unitaire', `${RATE_PER_SQM_HT.toFixed(2)} € HT / m²`]
          ];
          doc.setFontSize(10.5);
          rows.forEach(([label, value]) => {
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(60, 64, 70);
            doc.text(`${label} :`, marginX, y);
            doc.setFont('helvetica', 'normal');
            doc.text(String(value), marginX + 45, y);
            y += 7;
          });

          y += 5;
          doc.setDrawColor(220, 222, 227);
          doc.line(marginX, y, pageWidth - marginX, y);
          y += 12;

          doc.setFont('helvetica', 'normal');
          doc.setFontSize(11);
          doc.setTextColor(60, 64, 70);
          doc.text('Prix Hors Taxe (HT)', marginX, y);
          doc.text(fmt2(ht), pageWidth - marginX, y, { align: 'right' });
          y += 8;
          doc.text('TVA 20%', marginX, y);
          doc.text(fmt2(vat), pageWidth - marginX, y, { align: 'right' });
          y += 10;

          doc.setDrawColor(31, 111, 235);
          doc.setLineWidth(0.6);
          doc.line(marginX, y - 5, pageWidth - marginX, y - 5);
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(14);
          doc.setTextColor(31, 111, 235);
          doc.text('PRIX TTC', marginX, y + 2);
          doc.text(fmt2(ttc), pageWidth - marginX, y + 2, { align: 'right' });
          doc.setLineWidth(0.2);

          y += 20;
          doc.setFont('helvetica', 'italic');
          doc.setFontSize(9);
          doc.setTextColor(120, 126, 134);
          doc.text(`Devis valable 30 jours, jusqu'au ${validUntil}. Tarif indicatif — devis ferme après étude du site.`, marginX, y, { maxWidth: pageWidth - marginX * 2 });

          y += 22;
          doc.setDrawColor(220, 222, 227);
          doc.line(marginX, y, marginX + 60, y);
          y += 6;
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(10);
          doc.setTextColor(60, 64, 70);
          doc.text('Responsable : Chloé', marginX, y);
          y += 5;
          doc.setFontSize(9);
          doc.setTextColor(120, 126, 134);
          doc.text('Exadrone Enterprise', marginX, y);

          const filename = `Devis_Exadrone_${slugifyForFilename(clientName)}_${new Date().toISOString().slice(0, 10)}.pdf`;
          doc.save(filename);
        } catch (err) {
          console.error('PDF generation failed:', err);
          alert('La génération du PDF a échoué — réessayez ou contactez-nous directement.');
        } finally {
          estimatePdfBtn.disabled = false;
          estimatePdfBtn.textContent = originalLabel;
        }
      });
    }
  }

  /* ---------- Fiabilité accordions ----------
     Single property animates (grid-template-rows, in styles.css) — no
     scrollHeight measurement, no layout thrashing. JS only flips
     aria-expanded; CSS sibling selectors do the rest. One open at a time. */
  const reliabilityToggles = document.querySelectorAll('.reliability-toggle');
  reliabilityToggles.forEach((btn) => {
    btn.addEventListener('click', () => {
      const willOpen = btn.getAttribute('aria-expanded') !== 'true';
      reliabilityToggles.forEach((b) => b.setAttribute('aria-expanded', 'false'));
      btn.setAttribute('aria-expanded', String(willOpen));
    });
  });

  /* ---------- Cookie consent (CNIL-style: accept / reject / customize) ---------- */
  const CONSENT_KEY = 'exadrone_cookie_consent';
  const banner = document.getElementById('cookieBanner');
  const prefsBtn = document.getElementById('cookiePrefsBtn');

  const readConsent = () => {
    try { return JSON.parse(localStorage.getItem(CONSENT_KEY)); } catch { return null; }
  };
  const writeConsent = (value) => {
    localStorage.setItem(CONSENT_KEY, JSON.stringify({ ...value, date: new Date().toISOString() }));
    banner?.classList.remove('is-visible');
  };

  if (banner) {
    const acceptBtn = document.getElementById('cookieAccept');
    const rejectBtn = document.getElementById('cookieReject');
    const customizeBtn = document.getElementById('cookieCustomize');

    if (!readConsent()) {
      requestAnimationFrame(() => banner.classList.add('is-visible'));
    }

    acceptBtn?.addEventListener('click', () => writeConsent({ essential: true, analytics: true }));
    rejectBtn?.addEventListener('click', () => writeConsent({ essential: true, analytics: false }));
    customizeBtn?.addEventListener('click', () => {
      window.location.href = 'politique-de-cookies.html';
    });
  }

  prefsBtn?.addEventListener('click', () => banner?.classList.add('is-visible'));
  document.getElementById('reopenBannerBtn')?.addEventListener('click', () => banner?.classList.add('is-visible'));

  /* ---------- Contact page: prefill from instant-estimate handoff ---------- */
  const prefillNote = document.getElementById('prefillNote');
  if (prefillNote) {
    const params = new URLSearchParams(window.location.search);
    const area = parseFloat(params.get('area'));
    // 'ttc' is the current param (post-VAT total); 'budget' kept as a fallback
    // so any already-shared/bookmarked links from before the pricing update
    // still prefill correctly instead of silently showing "undefined €".
    const ttc = parseFloat(params.get('ttc') ?? params.get('budget'));
    const service = params.get('service') || '';
    if (area > 0) {
      const fmt = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
      const serviceLine = service ? `Service : ${service} — ` : '';
      const message = document.querySelector('#briefForm textarea[name="message"]');
      if (message) {
        message.value = `${serviceLine}Surface estimée : ${fmt.format(area)} m² — Prix TTC estimé : ${fmt.format(ttc)} €. Merci de m'envoyer une proposition PDF détaillée.`;
      }
      prefillNote.textContent = `Pré-rempli à partir de votre estimation instantanée : ${service ? service + ' · ' : ''}${fmt.format(area)} m² · ${fmt.format(ttc)} € TTC`;
      prefillNote.classList.add('is-visible');
    }
  }

});
