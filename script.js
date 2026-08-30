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
     no DOM reads, no DOM writes happen inside a scroll event. A single
     continuously-running rAF loop lerps that raw value into a smoothed
     one and is the only place that ever touches the DOM (the nav class
     here, the --glow-y/--scroll-bg custom properties below) — and also
     calls cineScrubTick/droneScrubTick each frame (see further down),
     since the hero's own scroll-scrub is a manual position:sticky +
     getBoundingClientRect calc, not a GSAP ScrollTrigger, so there's no
     second internal ticker of its own to avoid duplicating. */
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

  // Assigned further down (see "Cinematic hero HUD + cylinder scrub")
  // once the hero exists — reading it here rather than adding a second
  // rAF loop, per the note above. Safe to reference before assignment:
  // this function's *body* only runs on the next animation frame, by
  // which point the whole synchronous DOMContentLoaded callback
  // (including the assignment below) has run.
  let cineScrubTick = null;
  // Same "read further down, called from this shared ticker" pattern as
  // cineScrubTick above — see "Drone showcase scrub".
  let droneScrubTick = null;

  const scrollTick = () => {
    currentScrollY += (targetScrollY - currentScrollY) * 0.25;
    if (Math.abs(targetScrollY - currentScrollY) < 0.05) currentScrollY = targetScrollY;

    if (cineScrubTick) cineScrubTick();
    if (droneScrubTick) droneScrubTick();

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

  /* ---------- Camera shutter click (synthesized, no audio file) ----------
     A previous version of the hero had a continuous drone-engine hum and
     it was cut for good after it wouldn't loop cleanly (see git history)
     — this is a deliberately different kind of sound: a single ~70ms
     two-click shutter fired at most 4 times total (once per hero
     keyword), synthesized from noise bursts rather than shipping an
     audio file, so there's nothing to download and nothing to loop.
     Browsers block audio before any user gesture, so playback is a
     no-op until the visitor's first click/tap/keypress unlocks the
     AudioContext — after that it plays; before that it silently does
     nothing (the flash/frame still fire regardless, so the transition
     always reads even when the click can't play yet). */
  let shutterAudioCtx = null;
  const unlockShutterAudio = () => {
    if (shutterAudioCtx) return;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    try { shutterAudioCtx = new Ctx(); } catch { /* unsupported — stays silent */ }
  };
  ['pointerdown', 'keydown', 'touchstart'].forEach((evt) => {
    window.addEventListener(evt, unlockShutterAudio, { once: true, passive: true });
  });

  const playCameraShutter = () => {
    const ctx = shutterAudioCtx;
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const t0 = ctx.currentTime;
    // Two short filtered-noise bursts (first + second curtain) rather
    // than a tone — a real shutter is a broadband click, not a pitch.
    const click = (time, duration, freq, peakGain) => {
      const frames = Math.max(1, Math.round(ctx.sampleRate * duration));
      const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < frames; i++) data[i] = Math.random() * 2 - 1;
      const noise = ctx.createBufferSource();
      noise.buffer = buffer;
      const bandpass = ctx.createBiquadFilter();
      bandpass.type = 'bandpass';
      bandpass.frequency.value = freq;
      bandpass.Q.value = 1.1;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, time);
      gain.gain.exponentialRampToValueAtTime(peakGain, time + 0.002);
      gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
      noise.connect(bandpass);
      bandpass.connect(gain);
      gain.connect(ctx.destination);
      noise.start(time);
      noise.stop(time + duration + 0.01);
    };
    click(t0, 0.018, 2600, 0.22);
    click(t0 + 0.05, 0.014, 1800, 0.15);
  };

  /* ---------- Hero background video ----------
     Looping background video, fully independent of scroll — it autoplays
     and loops on its own (attributes on the <video> element itself), no
     seeking, no per-scroll-frame work. play() can legitimately reject
     (no user gesture yet on some mobile browsers, asset not in yet) —
     caught and dropped silently; the poster stays up as an acceptable
     degraded state, never surfaced as an error. Paused via
     IntersectionObserver once the hero scrolls off-screen and resumed on
     re-entry — the only JS that ever touches playback. Placeholder
     source paths: drop the real Matrice 4E footage in at
     /assets/video/ before deploying. */
  const exaHeroVideo = document.getElementById('exaHeroVideo');
  const cineHero = document.querySelector('.cine-hero');
  const heroReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (exaHeroVideo && cineHero) {
    if (heroReducedMotion) {
      // Poster only — never autoplay under reduced motion (the HTML
      // autoplay attribute may already have kicked in before this ran).
      exaHeroVideo.pause();
      exaHeroVideo.removeAttribute('autoplay');
    } else {
      const attemptPlay = () => { const p = exaHeroVideo.play(); if (p && p.catch) p.catch(() => {}); };
      attemptPlay();
      const heroVideoObserver = new IntersectionObserver(([entry]) => {
        if (entry.isIntersecting) attemptPlay();
        else exaHeroVideo.pause();
      }, { threshold: 0 });
      heroVideoObserver.observe(cineHero);
    }
  }


  /* ---------- Cinematic hero HUD + cylinder scrub ----------
     The section is pinned (position: sticky, see .cine-hero/.cine-stage
     in styles.css) on every viewport size; scroll progress through that
     pinned 400vh track is computed in cineScrubTick, called from the
     shared scrollTick loop above rather than a second listener/rAF, and
     drives both the HUD readouts and the 3D keyword cylinder below —
     nothing here is GSAP-pinned (no ScrollTrigger involved), so there's
     no double-pin risk to manage. */
  if (cineHero) {
    /* ---------- HUD (timecode / section label / frame counter / scrub bar) ---------- */
    const hudTimecode = document.getElementById('hudTimecode');
    const hudSectionLabel = document.getElementById('hudSectionLabel');
    const hudSectionCount = document.getElementById('hudSectionCount');
    const hudFrameCounter = document.getElementById('hudFrameCounter');
    const hudTicksActive = document.getElementById('hudTicksActive');
    const hudScrubFillBg = document.getElementById('hudScrubFillBg');

    // Purely cosmetic — the HUD frame counter is kept (see "KEEP EXACTLY
    // AS-IS: the camera HUD overlay") but it no longer indexes into a
    // real frame array (there isn't one any more): this just reproduces
    // the same 1-049 readout the counter always showed, derived straight
    // from progress, with nothing behind it to preload/decode/draw.
    const HUD_COSMETIC_FRAME_COUNT = 49;

    // Six acts, sharing their boundaries exactly with the coverflow's
    // turn/dwell timeline below (Photovoltaïque → Bardage → Toiture →
    // Façade → Vitrage → the drone touching down) rather than an even
    // split — one coherent timeline instead of two that drift out of
    // sync. Thresholds below are the exact end-of-turn points for
    // CYL_DWELL=0.12 (each turn takes (1 - CYL_DWELL*5)/4 of total
    // progress) — see "Cylinder rotation" further down, which builds the
    // actual timeline off the same CYL_DWELL constant so the two can't
    // drift apart.
    const CYL_DWELL = 0.12;
    const CYL_TURN = (1 - CYL_DWELL * 5) / 4;
    const CINE_PHASES = [
      { label: 'Photovoltaïque', from: 0 },
      { label: 'Bardage', from: CYL_DWELL + CYL_TURN },
      { label: 'Toiture', from: 2 * (CYL_DWELL + CYL_TURN) },
      { label: 'Façade', from: 3 * (CYL_DWELL + CYL_TURN) },
      { label: 'Vitrage', from: 4 * (CYL_DWELL + CYL_TURN) },
      { label: 'Atterrissage', from: 0.97 },
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
    // No-op default: nothing currently consumes hero active/inactive state,
    // but cineScrubTick and the reduced-motion branch below call this
    // unconditionally every frame, so it stays a safe, cheap default rather
    // than adding a conditional at every call site.
    let setHeroActive = () => {};

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

    /* ---------- Cylinder rotation (Photovoltaïque → Bardage → Toiture →
       Façade → Vitrage) ----------
       Replaces the old single-face drum with a 3D liquid-glass coverflow
       (see .exa-cylinder-stage in styles.css). Every face is centred in
       the stage by CSS (top/left 50% + negative margins); this is the
       only code that ever moves them, via a full inline `transform`
       written per face, per frame — no CSS placement rules to keep in
       sync with it. For a face at index i, offset = i - pos (pos being
       the live fractional "active index", 0..4): the active face
       (offset 0) sits dead-centre, faces the viewer flat and is full
       opacity/scale; its immediate neighbours tilt in via rotateY up to
       ±45° (capped there — offset 2 sits at the same 45° as offset 1,
       just further back/smaller/fainter) while translateX/translateZ/
       scale/opacity all keep changing continuously with distance, which
       is what makes scrolling read as one fluid horizontal glide instead
       of a hard swap. A paused GSAP timeline (5 dwell segments + 4 eased
       turns, power2.inOut) is scrubbed via .progress(heroProgress)
       rather than played over time, so it's always in lockstep with
       scroll in both directions — reverse scroll runs it backwards for
       free. */
    const exaCylinder = document.getElementById('exaCylinder');
    const exaCylinderFaces = exaCylinder ? Array.from(exaCylinder.querySelectorAll('.exa-cylinder__face')) : [];
    const exaCylinderLabels = exaCylinderFaces.map((f) => f.querySelector('.exa-cylinder__label'));
    let updateCylinder = () => {};

    if (exaCylinder && exaCylinderFaces.length === 5) {
      const GREY_LIGHT_RGB = [0xD9, 0xDE, 0xE5]; // --exa-grey-light, for the active->off-axis label color shift
      const COVERFLOW_ANGLE = 46; // deg — matches the brief's "45° left / 135° (=180-45) right" framing
      const COVERFLOW_SPACING = 172; // px between card centers, desktop
      const COVERFLOW_DEPTH = 92; // px pushed back per step
      const COVERFLOW_SCALE_STEP = 0.15;
      const applyCoverflowPosition = (pos) => {
        exaCylinder.style.setProperty('--cyl-pos', pos.toFixed(3));
        const spacing = window.innerWidth <= 768 ? COVERFLOW_SPACING * 0.62 : COVERFLOW_SPACING;
        exaCylinderFaces.forEach((face, i) => {
          const offset = i - pos;
          const absOffset = Math.abs(offset);
          const sign = offset === 0 ? 0 : Math.sign(offset);
          const rotateY = -sign * COVERFLOW_ANGLE * Math.min(absOffset, 1);
          const depthOffset = Math.min(absOffset, 2.2);
          const translateX = offset * spacing;
          const translateZ = -depthOffset * COVERFLOW_DEPTH;
          const scale = Math.max(0.6, 1 - depthOffset * COVERFLOW_SCALE_STEP);
          face.style.transform = `translateX(${translateX.toFixed(1)}px) translateZ(${translateZ.toFixed(1)}px) rotateY(${rotateY.toFixed(2)}deg) scale(${scale.toFixed(3)})`;
          face.classList.toggle('is-front', absOffset < 0.06);
          // active 1.0 / ±1 step 0.5 / ±2 steps 0.14, piecewise-linear,
          // fully hidden past that so far-off faces never ghost through.
          let opacity;
          if (absOffset <= 1) opacity = 1 - absOffset * 0.5;
          else if (absOffset <= 2) opacity = 0.5 - (absOffset - 1) * 0.36;
          else opacity = Math.max(0, 0.14 - (absOffset - 2) * 0.14);
          face.style.opacity = opacity.toFixed(3);
          face.style.zIndex = String(Math.round(100 - absOffset * 10));
          const label = exaCylinderLabels[i];
          if (label) {
            const mix = Math.min(1, absOffset / 1.4);
            const r = Math.round(255 + (GREY_LIGHT_RGB[0] - 255) * mix);
            const g = Math.round(255 + (GREY_LIGHT_RGB[1] - 255) * mix);
            const b = Math.round(255 + (GREY_LIGHT_RGB[2] - 255) * mix);
            label.style.color = `rgb(${r}, ${g}, ${b})`;
          }
        });
      };

      if (window.gsap) {
        // ~60% dwell / ~40% turning across the 5 keywords — CYL_DWELL/
        // CYL_TURN declared above alongside CINE_PHASES, so the HUD's
        // section-change points and the coverflow's own turns can't
        // drift apart from each other.
        const cylTimeline = gsap.timeline({ paused: true });
        const cylState = { pos: 0 };
        let t = CYL_DWELL;
        for (let i = 0; i < 4; i++) {
          cylTimeline.to(cylState, { pos: i + 1, duration: CYL_TURN, ease: 'power2.inOut' }, t);
          t += CYL_TURN + CYL_DWELL;
        }
        // The last tween added ends four DWELL+TURN steps short of the
        // trailing final dwell, so the timeline's own natural duration
        // would land there, not at 1 — this zero-effect marker at t=1
        // extends it to exactly 1 so .progress(heroProgress) below maps
        // 1:1 onto the absolute positions above, instead of a compressed
        // range.
        cylTimeline.set(cylState, {}, 1);
        updateCylinder = (progress) => {
          cylTimeline.progress(progress);
          applyCoverflowPosition(cylState.pos);
        };
      } else {
        // GSAP failed to load off the CDN — plain linear fallback, no
        // dwell/ease, still fully scroll-scrubbed and reversible.
        updateCylinder = (progress) => applyCoverflowPosition(progress * 4);
      }
    }

    /* ---------- Hero direct navigation + "Devis instantané" CTA ----------
       An additional path to a service on top of scroll — scroll stays the
       single source of truth. A click never touches the cylinder's own
       transform: it moves the real scroll position to the exact point that
       already maps to that service (targetProgress = targetIndex /
       (faceCount - 1)), and the coverflow turns as a pure consequence,
       through the exact same cineScrubTick -> updateCylinder path a manual
       scroll takes — including the HUD's phase-change shutter click, which
       already fires off a progress threshold each rAF frame regardless of
       what moved scrollY, so control-triggered service changes get it for
       free.
       This hero was never GSAP ScrollTrigger-pinned to begin with (see
       "Cinematic hero HUD + cylinder scrub" below — manual position:sticky
       + a live getBoundingClientRect() scrub), so there's no
       trigger.start/trigger.end to read; getHeroScrollTarget derives the
       equivalent live, every call, rather than caching pixel values: docTop
       is the absolute document-space top of .cine-hero (scrollY + rect.top
       cancels out the current scroll position, so it's constant no matter
       where the page is currently scrolled), and the scrollable range is
       the 400vh pin's height minus one viewport — exactly what
       cineScrubTick's own progress calc divides by. */
    const exaHeroNav = document.getElementById('exaHeroNav');
    const exaHeroNavPrev = document.getElementById('exaHeroNavPrev');
    const exaHeroNavNext = document.getElementById('exaHeroNavNext');
    const exaHeroNavLabels = exaHeroNav ? Array.from(exaHeroNav.querySelectorAll('.exa-hero-nav__label')) : [];
    const exaHeroNavDots = exaHeroNav ? Array.from(exaHeroNav.querySelectorAll('.exa-hero-nav__dot')) : [];
    const exaHeroNavUnderline = document.getElementById('exaHeroNavUnderline');
    const exaHeroNavAnnounce = document.getElementById('exaHeroNavAnnounce');
    const exaHeroCta = document.getElementById('exaHeroCta');
    // Repurposed from a passive "keep scrolling" nudge into a real
    // shortcut: jumps straight past the whole pinned hero to the next
    // section, for a visitor who came for the rest of the site rather
    // than the cinematic intro (see index.html "Skip-hero arrow").
    const exaSkipHero = document.getElementById('cineScrollHint');
    const HERO_SERVICE_LABELS = ['Photovoltaïque', 'Bardage', 'Toiture', 'Façade', 'Vitrage'];
    const HERO_FACE_COUNT = exaCylinderFaces.length || HERO_SERVICE_LABELS.length;

    // Reassigned below if the nav row exists — called every frame from
    // cineScrubTick (and once, statically, from the reduced-motion branch)
    // further down, kept a no-op default so both call sites can always
    // call it unconditionally regardless of whether the row is in the DOM
    // or GSAP/ScrollToPlugin loaded off the CDN.
    let updateNavRow = () => {};

    if (window.gsap && window.ScrollToPlugin && (exaHeroNav || exaHeroCta || exaSkipHero)) {
      gsap.registerPlugin(ScrollToPlugin);

      // Shared by both the nav row and the CTA below — only one
      // control-triggered scroll ever runs at a time. autoKill is left off
      // on every tween that uses this; the wheel/touchstart listeners
      // right below do that job explicitly instead, per the brief.
      let heroScrollTween = null;
      // The sitewide `html { scroll-behavior: smooth }` (see styles.css
      // "html") fights ScrollToPlugin: every scrollTop it writes each tick
      // would itself kick off a second, overlapping native smooth-scroll
      // animation, and the two fighting over the same scrollTop is exactly
      // what produced the overshoot-then-stuck scrolling this had before
      // this guard was added. Switched to 'auto' only for the lifetime of
      // a control-triggered tween, then handed back — every other bare
      // href="#..." on the page (nav links, footer, etc.) still gets the
      // native smooth scroll as before.
      const setNativeSmoothScroll = (enabled) => {
        document.documentElement.style.scrollBehavior = enabled ? '' : 'auto';
      };
      const killHeroScrollTween = () => {
        if (!heroScrollTween) return;
        heroScrollTween.kill();
        heroScrollTween = null;
        setNativeSmoothScroll(true);
      };
      window.addEventListener('wheel', killHeroScrollTween, { passive: true });
      window.addEventListener('touchstart', killHeroScrollTween, { passive: true });

      if (exaHeroNav) {
        let navActiveIndex = 0;
        let navUnderlineReady = false;

        const getHeroScrollTarget = (targetIndex) => {
          const rect = cineHero.getBoundingClientRect();
          const docTop = window.scrollY + rect.top;
          const scrollableRange = cineHero.offsetHeight - window.innerHeight;
          const targetProgress = targetIndex / (HERO_FACE_COUNT - 1);
          return docTop + scrollableRange * targetProgress;
        };

        // Duration scales with distance so a Photovoltaïque -> Vitrage
        // jump doesn't feel abrupt while an adjacent step (including every
        // chevron press, which is always exactly one step) stays snappy.
        const scrollToServiceIndex = (targetIndex) => {
          const clamped = Math.min(HERO_FACE_COUNT - 1, Math.max(0, targetIndex));
          if (clamped === navActiveIndex) return;
          const distance = Math.abs(clamped - navActiveIndex);
          killHeroScrollTween();
          setNativeSmoothScroll(false);
          heroScrollTween = gsap.to(window, {
            duration: heroReducedMotion ? 0.01 : (distance <= 1 ? 0.5 : 0.8),
            ease: 'power2.inOut',
            scrollTo: { y: () => getHeroScrollTarget(clamped), autoKill: false },
            onComplete: () => { heroScrollTween = null; setNativeSmoothScroll(true); },
          });
        };

        exaHeroNavPrev.addEventListener('click', () => scrollToServiceIndex(navActiveIndex - 1));
        exaHeroNavNext.addEventListener('click', () => scrollToServiceIndex(navActiveIndex + 1));
        [...exaHeroNavLabels, ...exaHeroNavDots].forEach((btn) => {
          btn.addEventListener('click', () => scrollToServiceIndex(Number(btn.dataset.index)));
        });
        // ArrowLeft/ArrowRight step through services while focus is
        // anywhere inside the row (event delegation off the <nav> itself).
        exaHeroNav.addEventListener('keydown', (e) => {
          if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
          e.preventDefault();
          scrollToServiceIndex(navActiveIndex + (e.key === 'ArrowLeft' ? -1 : 1));
        });

        const updateNavUnderline = (immediate) => {
          const activeLabel = exaHeroNavLabels[navActiveIndex];
          if (!activeLabel || !exaHeroNavUnderline) return;
          const bounds = { x: activeLabel.offsetLeft, width: activeLabel.offsetWidth };
          if (immediate || heroReducedMotion) gsap.set(exaHeroNavUnderline, bounds);
          else gsap.to(exaHeroNavUnderline, { ...bounds, duration: 0.4, ease: 'power2.out' });
        };
        // Keeps the underline glued to its label across layout reflows
        // (e.g. a phone rotated mid-session), not just on index change.
        window.addEventListener('resize', () => updateNavUnderline(true));

        updateNavRow = (progress) => {
          const index = Math.round(progress * (HERO_FACE_COUNT - 1));
          if (index === navActiveIndex && navUnderlineReady) return;
          const firstRun = !navUnderlineReady;
          navActiveIndex = index;
          navUnderlineReady = true;

          exaHeroNavLabels.forEach((btn, i) => {
            if (i === index) btn.setAttribute('aria-current', 'true');
            else btn.removeAttribute('aria-current');
          });
          exaHeroNavDots.forEach((btn, i) => {
            if (i === index) btn.setAttribute('aria-current', 'true');
            else btn.removeAttribute('aria-current');
          });
          // No wrapping — a bound reached disables that end's chevron
          // rather than looping to the other end of the row.
          exaHeroNavPrev.disabled = index === 0;
          exaHeroNavPrev.setAttribute('aria-disabled', String(index === 0));
          exaHeroNavNext.disabled = index === HERO_FACE_COUNT - 1;
          exaHeroNavNext.setAttribute('aria-disabled', String(index === HERO_FACE_COUNT - 1));
          if (exaHeroNavAnnounce) exaHeroNavAnnounce.textContent = HERO_SERVICE_LABELS[index] || '';
          updateNavUnderline(firstRun);
        };
      }

      if (exaHeroCta) {
        const estimateSection = document.getElementById('estimate');
        // A bare href relies on the sitewide `scroll-behavior: smooth`
        // (see styles.css "html"), which fights this hero's own pinned
        // scroll track and stalls partway through it — handled fully in JS
        // instead; the href stays in the markup as a working no-JS
        // fallback (see index.html "Devis instantané").
        if (estimateSection) {
          exaHeroCta.addEventListener('click', (e) => {
            e.preventDefault();
            killHeroScrollTween();
            setNativeSmoothScroll(false);
            heroScrollTween = gsap.to(window, {
              duration: heroReducedMotion ? 0.01 : 1.0,
              ease: 'power2.inOut',
              // offsetY clears the fixed .site-nav (~91px tall, see
              // .site-nav) so the section's heading lands visible under it
              // instead of hidden beneath it.
              scrollTo: { y: estimateSection, offsetY: 100, autoKill: false },
              onComplete: () => { heroScrollTween = null; setNativeSmoothScroll(true); },
            });
          });
        }
      }

      if (exaSkipHero) {
        // Same "no bare href, own JS tween" reasoning as the CTA above.
        // Targets whichever section immediately follows .cine-hero in the
        // DOM (currently .hero-lede) rather than a hardcoded id, so it
        // keeps working if that section is ever renamed.
        const afterHero = cineHero.nextElementSibling;
        if (afterHero) {
          exaSkipHero.addEventListener('click', () => {
            killHeroScrollTween();
            setNativeSmoothScroll(false);
            heroScrollTween = gsap.to(window, {
              duration: heroReducedMotion ? 0.01 : 1.0,
              ease: 'power2.inOut',
              scrollTo: { y: afterHero, offsetY: 100, autoKill: false },
              onComplete: () => { heroScrollTween = null; setNativeSmoothScroll(true); },
            });
          });
        }
      }
    }

    const updateHud = (progress) => {
      const sectionIdx = getPhaseIndex(progress);
      if (sectionIdx !== cineLastSectionIdx) {
        cineLastSectionIdx = sectionIdx;
        if (hudSectionLabel) hudSectionLabel.textContent = `${String(sectionIdx + 1).padStart(2, '0')} · ${CINE_PHASES[sectionIdx].label.toUpperCase()}`;
        if (hudSectionCount) hudSectionCount.textContent = `SECTION ${String(sectionIdx + 1).padStart(2, '0')} / ${String(CINE_PHASES.length).padStart(2, '0')}`;
        // Only the first 5 phases have a matching keyword face — the 6th
        // ("Atterrissage") is HUD-only, nothing to click for.
        if (sectionIdx < 5) playCameraShutter();
      }
      if (hudTimecode) hudTimecode.textContent = formatTimecode(progress * CINE_VIRTUAL_DURATION_S);
      if (hudFrameCounter) hudFrameCounter.textContent = `CADRE ${String(Math.round(progress * (HUD_COSMETIC_FRAME_COUNT - 1)) + 1).padStart(3, '0')} / ${String(HUD_COSMETIC_FRAME_COUNT).padStart(3, '0')}`;
      const pct = `${(progress * 100).toFixed(2)}%`;
      if (hudTicksActive) hudTicksActive.style.width = pct;
      if (hudScrubFillBg) hudScrubFillBg.style.width = pct;
    };

    if (heroReducedMotion) {
      // No scrub — land on one representative point (same ~30%-through
      // convention as before) with the HUD and cylinder reflecting that
      // static state, instead of ticking off scroll. The cylinder still
      // fades its one resulting face in (see the reduced-motion rule on
      // .exa-cylinder__face in styles.css — "still driven by hero
      // progress", just not continuously). Hero "active" here just
      // tracks whether the section is still on screen at all, via
      // IntersectionObserver, since there's no per-frame progress being
      // computed to key off instead.
      const stillProgress = 0.3;
      cineLastProgress = stillProgress;
      updateHud(stillProgress);
      updateCylinder(stillProgress);
      updateNavRow(stillProgress);
      const cineHeroObserver = new IntersectionObserver(
        ([entry]) => setHeroActive(entry.isIntersecting),
        { threshold: 0 }
      );
      cineHeroObserver.observe(cineHero);
    } else {
      cineScrubTick = () => {
        const rect = cineHero.getBoundingClientRect();
        // Pure perf floor: once the whole 400vh block — sticky stage AND
        // the dead-space runway below it that exists purely to build
        // scroll distance — has scrolled out above the viewport, there is
        // nothing left to compute, ever again, for the rest of the page.
        if (rect.bottom <= 0) { setHeroActive(false); return; }

        const scrollable = rect.height - window.innerHeight;
        const progress = scrollable > 0 ? Math.min(1, Math.max(0, -rect.top / scrollable)) : 0;
        cineLastProgress = progress;
        updateHud(progress);
        updateCylinder(progress);
        updateNavRow(progress);
        // progress reaching 1 is the moment the sticky stage un-sticks and
        // the hero visually ends (see the comment on rect.bottom above —
        // that's a much later boundary, only reached ~1 extra viewport of
        // scroll after this).
        setHeroActive(progress < 1);
      };
    }
  }

  /* ---------- Pointer-tracked spotlight on bento/glass surfaces ----------
     .glow-surface is applied directly in the markup to any card that
     should join this effect (action-card, plus whatever already had it)
     rather than listing every host class here — one shared switch
     instead of two places to keep in sync. sector-card used to be part
     of this group; it moved to the .exa-glow system below (see
     index.html) since a single element can't carry two different
     ::before definitions. */
  const spotlightEls = document.querySelectorAll('.stat, .timeline-item, .estimate-card, .reliability-list li, .glow-surface');
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

  /* ---------- Spotlight glow cards (blog + pricing/quote) ----------
     Originally written to a single --ptr-x/--ptr-y pair on :root, read by
     every .exa-glow card via background-attachment:fixed — that's the
     textbook way to avoid a per-card getBoundingClientRect. It doesn't
     work here: background-attachment:fixed is only viewport-relative when
     nothing in the ancestor chain establishes its own containing block,
     and both .blog-card and .sector-card already use backdrop-filter
     (their glassmorphism look) plus a transform on :hover — either one
     silently rebinds "fixed" to that card's own box instead of the
     viewport. Confirmed by pixel-sampling actual rendered card edges:
     the gradient's computed background-image position updated correctly
     on every move, but the painted pixels never changed, because the
     gradient was being centered relative to the (invisible, far below
     the fold) card box rather than the cursor's real screen position.
     Fix: still exactly one document-level pointermove listener (below),
     but each rAF tick it hit-tests which .exa-glow card (if any) the
     pointer is currently over via elementFromPoint, and writes that one
     card's own LOCAL offset (--ptr-x/--ptr-y relative to its own
     top-left, not the viewport) onto its inline style — one
     getBoundingClientRect per frame at most, only while actively over a
     card, never one per card. The CSS gradients use the default
     (non-fixed) background-attachment to match. */
  if (document.querySelector('.exa-glow') &&
      !window.matchMedia('(prefers-reduced-motion: reduce)').matches &&
      !window.matchMedia('(hover: none)').matches) {
    let ptrX = 0, ptrY = 0, ptrQueued = false;
    let activeGlowCard = null;
    const flushPtr = () => {
      ptrQueued = false;
      const hit = document.elementFromPoint(ptrX, ptrY);
      const card = hit && hit.closest('.exa-glow');
      if (activeGlowCard && activeGlowCard !== card) {
        activeGlowCard.style.removeProperty('--ptr-x');
        activeGlowCard.style.removeProperty('--ptr-y');
      }
      if (card) {
        const rect = card.getBoundingClientRect();
        card.style.setProperty('--ptr-x', ptrX - rect.left);
        card.style.setProperty('--ptr-y', ptrY - rect.top);
      }
      activeGlowCard = card;
    };
    document.addEventListener('pointermove', (e) => {
      ptrX = e.clientX;
      ptrY = e.clientY;
      if (!ptrQueued) {
        ptrQueued = true;
        requestAnimationFrame(flushPtr);
      }
    }, { passive: true });
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

  /* ---------- Drone showcase scrub (150-frame flip-book, "Le Drone") ----------
     Same technique as the hero's cine scrub (see above) — a pinned stage
     redrawn per scroll-frame from pre-sliced JPEGs, because scrubbing
     needs frame-accurate random access a <video> element's async/
     throttled seeking can't give — just section-scoped (its own 220vh
     track, not the full page) and without the camera-HUD chrome, since
     this is a supporting beat rather than the flagship one. Unlike the
     hero, there's no full-preload gate blocking reveal: this section
     sits well below the fold, so a visitor could in principle jump
     straight to it via anchor link, and blocking scroll on 150 images
     (3x the hero's count) would be a worse trade here than it is for
     the very first thing every visitor sees. Preloading instead starts
     as the section nears the viewport, drawing whatever frame is
     nearest-loaded in the meantime (same fallback as the hero). */
  const droneCanvas = document.getElementById('droneShowcaseCanvas');
  const droneShowcase = document.querySelector('.drone-showcase');
  if (droneCanvas && droneShowcase) {
    const DRONE_TOTAL_FRAMES = 150;
    const droneCtx = droneCanvas.getContext('2d');
    const droneImages = [];
    let droneLastDrawn = -1;
    let droneStarted = false;

    const isDroneReady = (img) => img && img.complete && img.naturalWidth;

    // object-fit:contain emulation — the frame used to be cropped to fill
    // the stage edge-to-edge (drawDroneCover); this instead letterboxes so
    // the full, uncropped frame is always visible, at the cost of the
    // backdrop no longer reaching every edge of the pinned stage.
    const drawDroneContain = (img) => {
      const cw = droneCanvas.width, ch = droneCanvas.height;
      const ir = img.naturalWidth / img.naturalHeight;
      const cr = cw / ch;
      let dw, dh, dx, dy;
      if (ir > cr) {
        dw = cw;
        dh = cw / ir;
        dx = 0;
        dy = (ch - dh) / 2;
      } else {
        dh = ch;
        dw = ch * ir;
        dy = 0;
        dx = (cw - dw) / 2;
      }
      droneCtx.clearRect(0, 0, cw, ch);
      droneCtx.drawImage(img, 0, 0, img.naturalWidth, img.naturalHeight, dx, dy, dw, dh);
    };

    const drawDroneFrame = (index, force) => {
      let target = index;
      if (!isDroneReady(droneImages[target])) {
        let lo = target - 1, hi = target + 1;
        while (lo >= 0 || hi < DRONE_TOTAL_FRAMES) {
          if (lo >= 0 && isDroneReady(droneImages[lo])) { target = lo; break; }
          if (hi < DRONE_TOTAL_FRAMES && isDroneReady(droneImages[hi])) { target = hi; break; }
          lo--; hi++;
        }
      }
      const img = droneImages[target];
      if (!isDroneReady(img)) return;
      if (!force && target === droneLastDrawn) return;
      droneLastDrawn = target;
      drawDroneContain(img);
    };

    const sizeDroneCanvas = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const rect = droneCanvas.getBoundingClientRect();
      droneCanvas.width = Math.round(rect.width * dpr);
      droneCanvas.height = Math.round(rect.height * dpr);
      drawDroneFrame(Math.max(droneLastDrawn, 0), true);
    };
    window.addEventListener('resize', sizeDroneCanvas);

    for (let i = 0; i < DRONE_TOTAL_FRAMES; i++) {
      const img = new Image();
      img.decoding = 'async';
      droneImages.push(img);
    }

    // Bisected load order, same rationale as the hero: some frame lands
    // across the whole range within the first handful of requests, so the
    // nearest-loaded fallback always has something close by.
    const droneLoadOrder = [];
    const droneQueued = new Set();
    const droneEnqueue = (i) => { if (!droneQueued.has(i)) { droneQueued.add(i); droneLoadOrder.push(i); } };
    droneEnqueue(0);
    droneEnqueue(DRONE_TOTAL_FRAMES - 1);
    let droneRanges = [[0, DRONE_TOTAL_FRAMES - 1]];
    while (droneRanges.length) {
      const next = [];
      for (const [lo, hi] of droneRanges) {
        if (hi - lo <= 1) continue;
        const mid = Math.floor((lo + hi) / 2);
        droneEnqueue(mid);
        next.push([lo, mid], [mid, hi]);
      }
      droneRanges = next;
    }
    for (let i = 0; i < DRONE_TOTAL_FRAMES; i++) droneEnqueue(i);

    const DRONE_LOAD_CONCURRENCY = 5;
    let droneLoadCursor = 0;
    const startNextDroneLoad = () => {
      if (droneLoadCursor >= droneLoadOrder.length) return;
      const i = droneLoadOrder[droneLoadCursor++];
      const img = droneImages[i];
      img.addEventListener('load', () => { drawDroneFrame(droneLastProgressFrame(), false); startNextDroneLoad(); }, { once: true });
      img.addEventListener('error', () => startNextDroneLoad(), { once: true });
      img.src = `/images/hero-frames/drone4k/drone4k_${String(i + 1).padStart(4, '0')}.jpg`;
    };
    // Resolves to whatever frame the current scroll progress points at, so
    // a frame that finishes loading late still gets painted immediately if
    // it's the one currently needed, instead of waiting for the next tick.
    let droneLastProgress = 0;
    const droneLastProgressFrame = () => Math.round(droneLastProgress * (DRONE_TOTAL_FRAMES - 1));

    const startDroneLoad = () => {
      if (droneStarted) return;
      droneStarted = true;
      sizeDroneCanvas();
      for (let c = 0; c < DRONE_LOAD_CONCURRENCY; c++) startNextDroneLoad();
    };
    // Starts well before the section is actually on screen (600px
    // margin) so the first frames are already in by the time scrubbing
    // begins, without paying for it on initial page load.
    const droneStartObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          startDroneLoad();
          droneStartObserver.disconnect();
        }
      });
    }, { rootMargin: '600px 0px 600px 0px' });
    droneStartObserver.observe(droneShowcase);

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const stillIndex = Math.floor(DRONE_TOTAL_FRAMES * 0.3);
      droneLastProgress = stillIndex / (DRONE_TOTAL_FRAMES - 1);
      startDroneLoad();
      droneImages[stillIndex].addEventListener('load', () => drawDroneFrame(stillIndex, true));
    } else {
      droneScrubTick = () => {
        const rect = droneShowcase.getBoundingClientRect();
        if (rect.bottom <= 0 || rect.top >= window.innerHeight) return;
        const scrollable = rect.height - window.innerHeight;
        const progress = scrollable > 0 ? Math.min(1, Math.max(0, -rect.top / scrollable)) : 0;
        droneLastProgress = progress;
        drawDroneFrame(droneLastProgressFrame());
      };
    }
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
     GSAP fails to load off the CDN) does it fall back to
     .action-track-viewport's own native overflow-x:auto from styles.css
     — plain touch/trackpad swipe, no JS at all. Deliberately NOT setting
     pinType:'transform': that was tried as a mobile-stability measure
     and did the opposite — it's meant for pinning inside a proxy/virtual
     scroller (Locomotive Scroll, ScrollSmoother), and forcing it on a
     page whose scroller is the plain <body> is a documented cause of
     visible vertical jitter while pinned. GSAP already auto-selects
     'fixed' for a <body> scroller (the jitter-free option here), so the
     fix is to just not override it. .action-pin itself (title +
     .action-track-viewport together) is what gets pinned, so the title
     stays on screen the whole time the cards scroll — see .action-pin
     in styles.css for why it's sized identically whether pinned or not. */
  const actionPin = document.querySelector('.action-pin');
  const actionTrackViewport = document.querySelector('.action-track-viewport');
  const actionTrack = document.getElementById('actionTrack');
  if (actionPin && actionTrackViewport && actionTrack && window.gsap && window.ScrollTrigger) {
    gsap.registerPlugin(ScrollTrigger);
    ScrollTrigger.matchMedia({
      '(prefers-reduced-motion: no-preference)': function () {
        actionPin.classList.add('is-pinned-scroll');
        const getScrollDistance = () => Math.max(0, actionTrack.scrollWidth - actionTrackViewport.offsetWidth);
        const tween = gsap.to(actionTrack, {
          x: () => -getScrollDistance(),
          ease: 'none',
          scrollTrigger: {
            trigger: actionPin,
            start: 'top 90px',
            end: () => `+=${getScrollDistance()}`,
            scrub: 0.5,
            pin: true,
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

  /* ---------- Trust strip auto-scroll (Embla + auto-scroll plugin) ----------
     Equipment/certifications strip, see .exa-trust. Under
     prefers-reduced-motion, Embla still initializes (loop + drag stay
     available) but without the auto-scroll plugin, so nothing moves on
     its own. */
  const exaTrustViewport = document.getElementById('exaTrustViewport');
  if (exaTrustViewport && window.EmblaCarousel) {
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const exaTrustPlugins = reduceMotion || !window.EmblaCarouselAutoScroll
      ? []
      : [EmblaCarouselAutoScroll({
          playOnInit: true,
          speed: 1,
          stopOnInteraction: false,
          stopOnMouseEnter: true,
        })];
    EmblaCarousel(exaTrustViewport, { loop: true, align: 'start', dragFree: true }, exaTrustPlugins);
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
