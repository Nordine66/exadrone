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
     calls droneScrubTick each frame (see further down, "Drone showcase
     scrub"), since that section's own scroll-scrub is a manual
     getBoundingClientRect calc, not a GSAP ScrollTrigger, so there's no
     second internal ticker of its own to avoid duplicating. The hero
     used to have an equivalent cineScrubTick here too — removed along
     with the rest of the scroll-scrubbed hero (see "Hero swipe slider"
     further down), it's now interaction-driven, not scroll-driven. */
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

  // Assigned further down (see "Drone showcase scrub") once that section
  // exists — reading it here rather than adding a second rAF loop, per
  // the note above. Safe to reference before assignment: this function's
  // *body* only runs on the next animation frame, by which point the
  // whole synchronous DOMContentLoaded callback (including the
  // assignment below) has run.
  let droneScrubTick = null;

  const scrollTick = () => {
    currentScrollY += (targetScrollY - currentScrollY) * 0.25;
    if (Math.abs(targetScrollY - currentScrollY) < 0.05) currentScrollY = targetScrollY;

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

  /* ---------- Hero background video ----------
     Looping background video, fully independent of interaction — it
     autoplays and loops on its own (attributes on the <video> element
     itself), no seeking, no per-frame work. play() can legitimately
     reject (no user gesture yet on some mobile browsers, asset not in
     yet) — caught and dropped silently; the poster stays up as an
     acceptable degraded state, never surfaced as an error. Paused via
     IntersectionObserver once the hero scrolls off-screen and resumed on
     re-entry — same observer also drives the HUD timecode's pause/resume
     and the keyboard-arrow "hero in view" gate below, so there's only
     one visibility check for the whole hero rather than three. */
  const exaHeroVideo = document.getElementById('exaHeroVideo');
  const cineHero = document.querySelector('.cine-hero');
  const heroReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let heroInView = true;
  // Assigned below (see "HUD timecode") once the hero exists — same
  // "declare a no-op default, reassign further down, safe because
  // observer callbacks only ever fire after the synchronous
  // DOMContentLoaded body has finished" pattern used throughout this
  // file (droneScrubTick, cineScrubTick formerly, etc).
  let setTimecodeActive = () => {};
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
        heroInView = entry.isIntersecting;
        if (entry.isIntersecting) { attemptPlay(); setTimecodeActive(true); }
        else { exaHeroVideo.pause(); setTimecodeActive(false); }
      }, { threshold: 0 });
      heroVideoObserver.observe(cineHero);
    }
  }

  /* ---------- Hero HUD + swipe slider ----------
     Used to be a 400vh scroll-scrubbed pinned track (position:sticky +
     a manual per-frame progress calc) driving a 3D coverflow and every
     HUD readout. Now the hero is exactly one viewport tall, vertical
     scroll is 100% native, and the 5 service cards are a plain
     interaction-driven slider (Embla — already loaded sitewide for the
     trust strip, see "Trust strip auto-scroll" further down) — nothing
     here is tied to scroll position any more. */
  if (cineHero) {
    const hudTimecode = document.getElementById('hudTimecode');
    const hudSectionLabel = document.getElementById('hudSectionLabel');
    const hudSectionCount = document.getElementById('hudSectionCount');
    const hudTicksActive = document.getElementById('hudTicksActive');
    const hudScrubFillBg = document.getElementById('hudScrubFillBg');

    /* ---------- HUD timecode ----------
       Was `progress * 118s` (purely cosmetic even then — see git
       history, it never indexed into a real frame array). With no more
       scroll progress to key off, it's now a real elapsed-time counter:
       counts up for as long as the hero is on screen, pauses/resumes via
       setTimecodeActive (called from the video's IntersectionObserver
       above) rather than resetting, so stepping away and back doesn't
       jump the readout. */
    const CINE_VIRTUAL_FPS = 24;
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
    if (hudTimecode) {
      if (heroReducedMotion) {
        hudTimecode.textContent = formatTimecode(0);
      } else {
        let accumulatedMs = 0;
        let runStartTs = null;
        let timecodeRAF = null;
        const tick = () => {
          const elapsedMs = accumulatedMs + (runStartTs !== null ? performance.now() - runStartTs : 0);
          hudTimecode.textContent = formatTimecode(elapsedMs / 1000);
          timecodeRAF = requestAnimationFrame(tick);
        };
        setTimecodeActive = (active) => {
          if (active && runStartTs === null) {
            runStartTs = performance.now();
            if (!timecodeRAF) timecodeRAF = requestAnimationFrame(tick);
          } else if (!active && runStartTs !== null) {
            accumulatedMs += performance.now() - runStartTs;
            runStartTs = null;
            if (timecodeRAF) { cancelAnimationFrame(timecodeRAF); timecodeRAF = null; }
          }
        };
      }
    }

    /* ---------- Swipe slider ---------- */
    const HERO_SERVICE_LABELS = ['Photovoltaïque', 'Toiture', 'Bardage', 'Façade', 'Vitrage'];
    const heroSliderViewport = document.getElementById('exaHeroSliderViewport');
    const heroSlides = heroSliderViewport ? Array.from(heroSliderViewport.querySelectorAll('.exa-hero-slider__slide')) : [];
    const heroPrevBtn = document.getElementById('exaHeroPrev');
    const heroNextBtn = document.getElementById('exaHeroNext');
    const heroHint = document.getElementById('exaHeroHint');
    const heroPagination = document.getElementById('exaHeroPagination');
    const heroPaginationSegs = heroPagination ? Array.from(heroPagination.querySelectorAll('.exa-hero-pagination__seg')) : [];
    const heroAnnounce = document.getElementById('exaHeroSliderAnnounce');

    if (heroSliderViewport && heroSlides.length && window.EmblaCarousel) {
      const emblaApi = EmblaCarousel(heroSliderViewport, {
        loop: true,
        align: 'center',
        // Near-instant under reduced motion — Embla always positions via
        // transform, so "no translate" isn't achievable while staying
        // draggable; this is the closest honest equivalent (an instant
        // reposition instead of an animated slide).
        duration: heroReducedMotion ? 1 : 25,
      });

      const isTouch = window.matchMedia('(hover: none), (pointer: coarse)').matches;
      if (heroHint) heroHint.textContent = isTouch ? 'Glissez pour découvrir' : '← →';

      let hintDismissed = false;
      const dismissHint = () => {
        if (hintDismissed || !heroHint) return;
        hintDismissed = true;
        heroHint.classList.add('is-dismissed');
      };

      const updateSliderUI = () => {
        const index = emblaApi.selectedScrollSnap();
        const total = heroSlides.length;

        heroSlides.forEach((slide, i) => slide.classList.toggle('is-selected', i === index));

        heroPaginationSegs.forEach((seg, i) => {
          const active = i === index;
          seg.classList.toggle('is-active', active);
          seg.setAttribute('aria-current', active ? 'true' : 'false');
        });

        if (hudSectionLabel) hudSectionLabel.textContent = `${String(index + 1).padStart(2, '0')} · ${HERO_SERVICE_LABELS[index].toUpperCase()}`;
        if (hudSectionCount) hudSectionCount.textContent = `${String(index + 1).padStart(2, '0')} / ${String(total).padStart(2, '0')}`;
        const pct = `${((index + 1) / total * 100).toFixed(2)}%`;
        if (hudTicksActive) hudTicksActive.style.width = pct;
        if (hudScrubFillBg) hudScrubFillBg.style.width = pct;

        if (heroAnnounce) heroAnnounce.textContent = `${HERO_SERVICE_LABELS[index]}, ${index + 1} sur ${total}`;

        // Incoming-slide entrance (fade + 12px rise, 60ms stagger via CSS
        // transition-delay on the label/rule/desc, see styles.css) —
        // skipped under reduced motion, where that CSS is neutralized
        // anyway; toggling the class is harmless either way but there's
        // no reason to force a reflow for nothing.
        if (!heroReducedMotion) {
          const slide = heroSlides[index];
          slide.classList.remove('is-entering');
          void slide.offsetWidth; // restart the transition from a clean state
          slide.classList.add('is-entering');
          requestAnimationFrame(() => requestAnimationFrame(() => slide.classList.remove('is-entering')));
        }
      };

      emblaApi.on('select', updateSliderUI);
      emblaApi.on('init', updateSliderUI);
      emblaApi.on('pointerDown', dismissHint);

      /* ---- 3D coverflow tween ----
         Ported from Embla's own official "tween" recipe (scrollProgress +
         scrollSnapList + slideLooper.loopPoints for a seamless value
         across the loop boundary — internalEngine() is Embla's documented
         escape hatch for exactly this kind of per-slide effect). Runs on
         every 'scroll' event, which Embla fires continuously during a
         drag and during the settle animation, so the tilt follows the
         finger 1:1 in real time exactly like the old scroll-scrubbed
         version did — just driven by Embla's position instead of the
         page's. Skipped entirely under reduced motion (see styles.css —
         that query flattens the stage and hard-hides every non-selected
         slide instead). */
      if (!heroReducedMotion) {
        const COVERFLOW_ANGLE = 50; // deg
        const COVERFLOW_DEPTH = 100; // px pushed back per step
        const COVERFLOW_SCALE_STEP = 0.15;
        const total = heroSlides.length;

        const tweenCoverflow = () => {
          const engine = emblaApi.internalEngine();
          const scrollProgress = emblaApi.scrollProgress();
          // Slide width == viewport width by construction (one full slide
          // per view, see styles.css --slide-w) — read live so a resize
          // (or the short-viewport clamp() tiers) is always honored. Bails
          // out on a zero-width read (element not yet laid out — e.g. the
          // very first call before fonts/layout settle) rather than
          // writing wrapShiftPx values computed against a bogus 0px
          // width: that used to plant a wrong translateX on the wrapped
          // neighbours until the next 'scroll' frame corrected it, which
          // read as a neighbouring card ("fenêtre") popping in from the
          // wrong spot for a frame — the resize/orientation sync below
          // re-runs this as soon as a real width is available instead.
          const slideWidthPx = heroSliderViewport.getBoundingClientRect().width;
          if (!slideWidthPx) return;

          emblaApi.scrollSnapList().forEach((scrollSnap, snapIndex) => {
            let diffToTarget = scrollSnap - scrollProgress;

            engine.slideLooper.loopPoints.forEach((loopItem) => {
              const target = loopItem.target();
              if (snapIndex === loopItem.index && target !== 0) {
                const sign = Math.sign(target);
                if (sign === -1) diffToTarget = scrollSnap - (1 + scrollProgress);
                if (sign === 1) diffToTarget = scrollSnap + (1 - scrollProgress);
              }
            });

            // scrollSnapList steps by 1/total between adjacent slides —
            // multiplying by total converts "progress units" into "slide
            // units" (the same offset = i - pos the old coverflow used).
            // Embla's own diffToTarget is the "long way around" distance
            // (always 0..total-1, same sign for every later slide) — for
            // a symmetric coverflow the slides on the far side of the
            // loop need to read as being just behind on the OTHER side
            // instead, so this folds anything past half the loop back to
            // a negative, shorter distance the same way a clock face
            // reads "11" as "-1 hour", not "+11". rawOffset (before the
            // fold) is kept to work out how far this slide's own natural
            // flex position is from where it needs to *look* like it is —
            // Embla only repositions its own loop clones lazily once
            // scrolling actually approaches them, so at rest (or freshly
            // loaded) a wrapped neighbour like the last slide sitting
            // "just behind" the first one hasn't been shifted there yet;
            // translateX below does that relocation directly instead of
            // depending on Embla's own lazy shift, so both neighbours are
            // visible on both sides immediately, not just after a drag.
            let offset = diffToTarget * total;
            const rawOffset = offset;
            if (offset > total / 2) offset -= total;
            else if (offset < -total / 2) offset += total;
            const wrapShiftPx = (offset - rawOffset) * slideWidthPx;

            const absOffset = Math.abs(offset);
            const sign = offset === 0 ? 0 : Math.sign(offset);
            const rotateY = -sign * COVERFLOW_ANGLE * Math.min(absOffset, 1);
            const depthOffset = Math.min(absOffset, 2.2);
            const translateZ = -depthOffset * COVERFLOW_DEPTH;
            const scale = Math.max(0.6, 1 - depthOffset * COVERFLOW_SCALE_STEP);
            let opacity;
            if (absOffset <= 1) opacity = 1 - absOffset * 0.5;
            else if (absOffset <= 2) opacity = 0.5 - (absOffset - 1) * 0.36;
            else opacity = Math.max(0, 0.14 - (absOffset - 2) * 0.14);
            // Depth shading — a real coverflow card doesn't just fade out
            // as it recedes, it also visually dims (less light reaches
            // it), which sells the illusion of physical depth far better
            // than opacity alone against a moving video background.
            const brightness = Math.max(0.45, 1 - depthOffset * 0.22);

            const slide = heroSlides[snapIndex];
            if (!slide) return;
            slide.style.transform = `translateX(${wrapShiftPx.toFixed(1)}px) translateZ(${translateZ.toFixed(1)}px) rotateY(${rotateY.toFixed(2)}deg) scale(${scale.toFixed(3)})`;
            // Hinge the rotation at the slide's inner edge (the edge
            // nearest the centered card) instead of its own center — the
            // signature look of a "real" coverflow, where each neighbour
            // reads as a panel swinging away around a shared axis rather
            // than a flat card tilting in place. Only meaningfully
            // different from center once a slide has actually left dead
            // center, so the switch at sign===0 lines up with rotateY
            // already being 0deg there — no visible seam.
            slide.style.transformOrigin = sign > 0 ? '0% 50%' : sign < 0 ? '100% 50%' : '50% 50%';
            slide.style.opacity = opacity.toFixed(3);
            slide.style.filter = `brightness(${brightness.toFixed(3)})`;
            slide.style.zIndex = String(Math.round(100 - absOffset * 10));
          });
        };

        emblaApi.on('scroll', tweenCoverflow);
        emblaApi.on('reInit', tweenCoverflow);
        tweenCoverflow();

        // Keep the per-slide transform in sync with the slider's own box
        // size whenever it changes outside of an Embla 'scroll' event —
        // most importantly the mobile browser-chrome collapse/expand that
        // happens as the page is scrolled (which live-resizes the
        // --slide-w/h clamp() tiers via 100vh) and orientation changes.
        // Without this, the JS-applied translateZ/scale/wrapShiftPx stay
        // pinned to whatever width was last measured on a drag while the
        // CSS box silently resizes underneath them, so a neighbouring
        // card can end up mis-scaled/mis-positioned relative to its own
        // box for a few frames — exactly the "window" popping in/out
        // effect this was reported as. ResizeObserver catches the box
        // itself resizing; the window 'resize' listener is the fallback
        // for engines where that alone isn't enough (older WebKit).
        let coverflowResizeRAF = null;
        const scheduleCoverflowResync = () => {
          if (coverflowResizeRAF) return;
          coverflowResizeRAF = requestAnimationFrame(() => {
            coverflowResizeRAF = null;
            tweenCoverflow();
          });
        };
        if (window.ResizeObserver) {
          new ResizeObserver(scheduleCoverflowResync).observe(heroSliderViewport);
        }
        window.addEventListener('resize', scheduleCoverflowResync, { passive: true });
        window.addEventListener('orientationchange', scheduleCoverflowResync);
      }

      if (heroPrevBtn) heroPrevBtn.addEventListener('click', () => { dismissHint(); emblaApi.scrollPrev(); });
      if (heroNextBtn) heroNextBtn.addEventListener('click', () => { dismissHint(); emblaApi.scrollNext(); });
      heroPaginationSegs.forEach((seg, i) => {
        seg.addEventListener('click', () => { dismissHint(); emblaApi.scrollTo(i); });
      });

      // Keyboard arrows — active whenever the hero is in view (the video
      // observer above keeps heroInView current), or whenever focus is
      // actually inside the hero (a slide, an arrow, a pagination
      // segment), matching "when the hero is in view or focused".
      window.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        const heroFocused = cineHero.contains(document.activeElement);
        if (!heroInView && !heroFocused) return;
        e.preventDefault();
        dismissHint();
        if (e.key === 'ArrowLeft') emblaApi.scrollPrev(); else emblaApi.scrollNext();
      });

      // Desktop horizontal trackpad swipe — deltaX only. Vertical wheel
      // is NEVER intercepted: preventDefault only fires once deltaX
      // genuinely dominates the gesture, so a plain vertical scroll over
      // the hero always scrolls the page natively. A short cooldown
      // stops one continuous trackpad swipe (which fires dozens of wheel
      // events) from paging through several slides at once.
      let wheelCooldown = false;
      heroSliderViewport.addEventListener('wheel', (e) => {
        if (Math.abs(e.deltaX) <= Math.abs(e.deltaY) || Math.abs(e.deltaX) < 12) return;
        e.preventDefault();
        if (wheelCooldown) return;
        wheelCooldown = true;
        dismissHint();
        if (e.deltaX > 0) emblaApi.scrollNext(); else emblaApi.scrollPrev();
        setTimeout(() => { wheelCooldown = false; }, 500);
      }, { passive: false });
    } else if (heroHint) {
      heroHint.style.display = 'none';
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

  /* ---------- Hero price hook: count-up ----------
     Target is read from window.ExadronePricing (lib/pricing.js, loaded
     before this script) rather than hard-coded, so the hero always shows
     the real cheapest per-m² rate even if the pricing config changes. */
  const heroPriceValue = document.getElementById('exaHeroPriceValue');
  if (heroPriceValue && window.ExadronePricing) {
    const target = window.ExadronePricing.getCheapestService().priceHT;
    const eurFmt = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const setPriceText = (v) => { heroPriceValue.innerHTML = `${eurFmt.format(v)}&nbsp;€`; };
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (prefersReducedMotion) {
      setPriceText(target);
    } else {
      const duration = 900;
      const runCountUp = () => {
        const start = performance.now();
        const tick = (now) => {
          const progress = Math.min((now - start) / duration, 1);
          const eased = 1 - Math.pow(1 - progress, 3);
          setPriceText(target * eased);
          if (progress < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      };
      const priceObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            runCountUp();
            priceObserver.unobserve(entry.target);
          }
        });
      }, { threshold: 0.3 });
      priceObserver.observe(heroPriceValue);
    }
  }

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
    // The hero shrank from a 400vh scroll-scrubbed track to a single
    // viewport (see "Hero HUD + swipe slider" above) — every trigger
    // position below it in the document shifts up as a result. GSAP
    // measures live at ScrollTrigger.create() time, so this trigger
    // already gets the right numbers on first paint; 'load' is a safety
    // net for anything that still shifts layout after that (web fonts
    // swapping in, the hero video's poster settling to its real
    // dimensions) — invalidateOnRefresh:true above makes sure
    // getScrollDistance() is recomputed fresh, not just repositioned.
    window.addEventListener('load', () => ScrollTrigger.refresh());
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

  /* ---------- Instant quote flow (3 steps: prestation → surface →
     coordonnées) ----------
     State lives in this closure, not the DOM — the masked preview in step
     3 never gets real HT/TVA/TTC numbers written into it; those only
     exist after requestQuote() resolves. requestQuote() is a single,
     isolated call site (mocked with the shared pricing.calculateQuote()
     for now) so swapping in the real POST /api/quote later is a one-
     function change. */
  (function initDevisFlow() {
    const section = document.getElementById('estimate');
    const pricing = window.ExadronePricing;
    if (!section || !pricing) return;

    // A page can scope this whole widget to one prestation (e.g. solaire.html's
    // solar-only devis) via data-only-service="<pricing service id>" on
    // #estimate — skips the "Prestation" panel/step entirely and pre-selects
    // that service. Absent (the homepage default), behavior is unchanged.
    const onlyServiceId = section.dataset.onlyService || null;

    const stepsList = document.getElementById('devisSteps');
    const panels = Array.from(section.querySelectorAll('.devis-panel'));
    const servicesWrap = document.getElementById('devisServices');
    const surfaceInput = document.getElementById('devisSurface');
    const surfaceServiceEl = document.getElementById('devisSurfaceService');
    const surfaceUnitPriceEl = document.getElementById('devisSurfaceUnitPrice');
    const surfaceContinueBtn = document.getElementById('devisSurfaceContinue');
    const quotePreview = document.getElementById('devisQuotePreview');
    const form = document.getElementById('devisForm');
    const formError = document.getElementById('devisFormError');
    const renderedAtInput = document.getElementById('devisRenderedAt');
    const submitBtn = document.getElementById('devisSubmitBtn');
    const resultEl = document.getElementById('devisResult');
    if (!stepsList || !surfaceInput || !form || !resultEl) return;
    if (!onlyServiceId && !servicesWrap) return;

    const fmtEur = (n) => pricing.formatCurrency(n);
    const fmtRate = (n) => `${n.toFixed(2).replace('.', ',')} €`;
    const fmtSurfaceNum = (n) => new Intl.NumberFormat('fr-FR').format(n);
    const escapeHtml = (str) => String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    const state = { step: 1, serviceId: null, surface: null, contact: { name: '', company: '', email: '', phone: '', postalCode: '' } };

    /* ---- Step 1: service cards, generated from lib/pricing.js — skipped
       entirely when the section scopes to a single service. ---- */
    if (servicesWrap) {
      const cheapest = pricing.getCheapestService();
      servicesWrap.innerHTML = pricing.config.services.map((s) => `
        <button type="button" class="devis-service" role="radio" aria-checked="false" data-service="${s.id}">
          ${s.id === cheapest.id ? '<span class="devis-service__badge">Meilleur prix</span>' : ''}
          <span class="devis-service__label">${escapeHtml(s.label)}</span>
          <span class="devis-service__detail">${escapeHtml(s.detail)}</span>
          <span class="devis-service__price"><strong>${fmtRate(s.priceHT)}</strong> HT/m²</span>
        </button>
      `).join('');
      servicesWrap.querySelectorAll('.devis-service').forEach((btn) => {
        btn.addEventListener('click', () => selectService(btn.dataset.service));
      });
    }

    function selectService(id) {
      state.serviceId = id;
      servicesWrap.querySelectorAll('.devis-service').forEach((btn) => {
        const active = btn.dataset.service === id;
        btn.classList.toggle('is-selected', active);
        btn.setAttribute('aria-checked', String(active));
      });
      goToStep(2);
    }

    /* ---- Step 2: surface ---- */
    function updateSurfaceRateDisplay() {
      const service = pricing.getService(state.serviceId);
      if (!service) return;
      surfaceServiceEl.textContent = service.label;
      surfaceUnitPriceEl.textContent = `${fmtRate(service.priceHT)} HT/m²`;
    }
    function validateSurface() {
      const parsed = pricing.parseSurface(surfaceInput.value);
      const valid = parsed !== null && pricing.isValidSurface(parsed);
      surfaceContinueBtn.disabled = !valid;
      if (valid) state.surface = parsed;
      return valid;
    }
    surfaceInput.addEventListener('input', validateSurface);
    section.querySelectorAll('.devis-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        surfaceInput.value = chip.dataset.value;
        validateSurface();
        surfaceInput.focus();
      });
    });
    surfaceContinueBtn.addEventListener('click', () => { if (validateSurface()) goToStep(3); });

    /* ---- Step 3: gated preview — labels only, amounts stay masked ---- */
    function renderMaskedPreview() {
      const service = pricing.getService(state.serviceId);
      if (!service || state.surface === null) return;
      quotePreview.innerHTML = `
        <div class="devis-quote-row"><span>Prestation</span><span>${escapeHtml(service.label)}</span></div>
        <div class="devis-quote-row"><span>Surface</span><span>${fmtSurfaceNum(state.surface)}&nbsp;m²</span></div>
        <div class="devis-quote-row"><span>Prix unitaire</span><span>${fmtRate(service.priceHT)}&nbsp;HT/m²</span></div>
        <div class="devis-quote-row"><span>Total HT</span><span class="devis-mask">••••&nbsp;€</span></div>
        <div class="devis-quote-row"><span>TVA 20&nbsp;%</span><span class="devis-mask">••••&nbsp;€</span></div>
        <div class="devis-quote-row devis-quote-row--total"><span>Total TTC</span><span class="devis-mask">••••&nbsp;€</span></div>
        <div class="devis-quote-lock">🎉 Votre devis chiffré est prêt ! Indiquez où l'envoyer pour le débloquer instantanément.</div>
      `;
    }

    /* ---- Step navigation — earlier steps stay clickable to go back ---- */
    function goToStep(n) {
      state.step = n;
      panels.forEach((p) => { p.hidden = Number(p.dataset.panel) !== n; });
      stepsList.querySelectorAll('.devis-step').forEach((li) => {
        const num = Number(li.dataset.step);
        li.classList.toggle('is-active', num === n);
        li.classList.toggle('is-done', num < n);
        li.querySelector('.devis-step__btn').disabled = num >= n;
      });
      if (n === 2) updateSurfaceRateDisplay();
      if (n === 3) { renderedAtInput.value = String(Date.now()); renderMaskedPreview(); }
    }
    stepsList.querySelectorAll('.devis-step__btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const target = Number(btn.dataset.goto);
        if (target < state.step) goToStep(target);
      });
    });
    section.querySelectorAll('[data-back]').forEach((btn) => {
      btn.addEventListener('click', () => goToStep(Number(btn.dataset.back)));
    });

    /* ---- Step 3: contact form validation ---- */
    const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    // Accepts "06 12 34 56 78", "0612345678", "+33 6 12 34 56 78" — a
    // leading 0 or +33 then a 9-digit French number, optional separators.
    const PHONE_RE = /^(?:\+33|0)\s*[1-9](?:[\s.-]?\d{2}){4}$/;
    const normalizePhone = (raw) => {
      const digits = raw.trim().replace(/[^\d+]/g, '');
      if (digits.startsWith('+33')) return digits;
      if (digits.startsWith('0')) return `+33${digits.slice(1)}`;
      return digits;
    };
    const setFormError = (msg) => {
      formError.hidden = !msg;
      formError.textContent = msg || '';
    };
    function validateContactForm(data) {
      // Name/company/postal code are deliberately optional — the only hard
      // requirements are a way to reach the prospect (email or phone) and
      // consent, so step 3 stays as low-friction as possible.
      if (!data.email.trim() && !data.phone.trim()) return { msg: "Merci d'indiquer un e-mail ou un numéro de téléphone.", field: 'email' };
      if (data.email.trim() && !EMAIL_RE.test(data.email.trim())) return { msg: 'Adresse e-mail invalide.', field: 'email' };
      if (data.phone.trim() && !PHONE_RE.test(data.phone.trim())) return { msg: 'Numéro de téléphone invalide (format français attendu).', field: 'phone' };
      if (!data.consent) return { msg: "Merci d'accepter l'utilisation de vos données pour continuer.", field: 'consent' };
      return null;
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const data = {
        name: form.name.value,
        company: form.company.value,
        email: form.email.value,
        phone: form.phone.value,
        postalCode: form.postalCode.value,
        consent: form.consent.checked,
        honeypot: form.website.value,
        renderedAt: renderedAtInput.value
      };

      ['email', 'phone'].forEach((f) => form[f].removeAttribute('aria-invalid'));
      const invalid = validateContactForm(data);
      if (invalid) {
        setFormError(invalid.msg);
        if (invalid.field === 'email') { form.email.setAttribute('aria-invalid', 'true'); form.phone.setAttribute('aria-invalid', 'true'); }
        else if (form[invalid.field]) form[invalid.field].setAttribute('aria-invalid', 'true');
        return;
      }
      setFormError(null);

      const normalizedPhone = data.phone.trim() ? normalizePhone(data.phone) : '';
      state.contact = { name: data.name.trim(), company: data.company.trim(), email: data.email.trim(), phone: normalizedPhone, postalCode: data.postalCode.trim() };

      const originalLabel = submitBtn.textContent;
      submitBtn.disabled = true;
      submitBtn.textContent = 'Génération du devis…';

      try {
        const payload = {
          serviceId: state.serviceId,
          surface: state.surface,
          name: data.name.trim(),
          company: data.company.trim(),
          email: data.email.trim(),
          phone: normalizedPhone,
          postalCode: data.postalCode.trim(),
          consent: data.consent,
          honeypot: data.honeypot,
          renderedAt: data.renderedAt
        };
        const response = await requestQuote(payload);
        if (!response.ok) throw new Error(response.error || 'quote_failed');
        renderResult(response);
      } catch (err) {
        console.error('Quote request failed:', err);
        setFormError('Une erreur est survenue — merci de réessayer ou de nous contacter directement.');
        submitBtn.disabled = false;
        submitBtn.textContent = originalLabel;
      }
    });

    /* ---- requestQuote(): isolated call site, now wired to the real
       serverless endpoint (api/quote.js) ----
       That endpoint recomputes the quote server-side with the same
       shared pricing.calculateQuote() (never trusts client numbers),
       sends the devis email itself (from Victoria — the persona that
       "génère des devis instantanés" per lib/agent-personas.js), and
       returns the exact { ok, quote, emailSent } shape this used to
       fabricate locally — nothing else in this file needed to change. */
    async function requestQuote(payload) {
      try {
        const res = await fetch('/api/quote', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        return await res.json();
      } catch (err) {
        console.error('Quote request network error:', err);
        return { ok: false, error: 'network' };
      }
    }

    /* ---- Unlocked quote ---- */
    function renderResult(response) {
      // Google Ads conversion — fires once per successful quote request,
      // right where the lead is actually captured (not on page load, not
      // on every step transition).
      if (typeof window !== 'undefined' && window.gtag) {
        window.gtag('event', 'conversion', {
          'send_to': 'AW-767047996/0M-XCOu3pfQcELzy4O0C'
        });
      }

      const q = response.quote;
      form.hidden = true;
      quotePreview.hidden = true;
      const dateFmt = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
      const statusHtml = response.emailSent
        ? `✅ Devis envoyé à <strong>${escapeHtml(state.contact.email)}</strong> — pensez à vérifier vos spams.`
        : `✅ Votre devis est prêt. Un conseiller vous rappelle au <strong>${escapeHtml(state.contact.phone)}</strong> sous 24&nbsp;h ouvrées.`;
      const waText = encodeURIComponent(`Bonjour, je viens de recevoir mon devis ${q.number}.`);

      resultEl.innerHTML = `
        <div class="devis-result-card" id="devisResultCard">
          <p class="devis-result-meta">Devis n° <strong>${q.number}</strong> · ${dateFmt.format(new Date(q.date))} · valable <strong>${pricing.config.quoteValidityDays}&nbsp;jours</strong></p>
          <div class="devis-result-rows">
            <div class="devis-result-row"><span>Prestation</span><strong>${escapeHtml(q.serviceLabel)}</strong></div>
            <div class="devis-result-row"><span>Surface</span><strong>${fmtSurfaceNum(q.surface)}&nbsp;m²</strong></div>
            <div class="devis-result-row"><span>Prix unitaire</span><strong>${fmtRate(q.unitPriceHT)}&nbsp;HT/m²</strong></div>
          </div>
          <div class="devis-result-total">
            <span>Total HT</span>
            <strong>${fmtEur(q.totalHT)}</strong>
          </div>
          <div class="devis-result-rows">
            <div class="devis-result-row"><span>TVA 20&nbsp;%</span><span>${fmtEur(q.vat)}</span></div>
            <div class="devis-result-row devis-result-row--ttc"><span>Total TTC</span><strong>${fmtEur(q.totalTTC)}</strong></div>
          </div>
          ${q.minimumApplied ? `<p class="devis-result-note">Forfait minimum d'intervention appliqué : <strong>${fmtEur(pricing.config.minimumOrderHT)}</strong></p>` : ''}
          <p class="devis-result-included">Inclus : intervention par télépilote certifié, rapport photo avant/après.</p>
          <p class="devis-result-status">${statusHtml}</p>
          <div class="devis-result-actions">
            <button type="button" class="btn btn-primary" id="devisDownloadPdf">Télécharger le PDF</button>
            <a class="btn btn-ghost" href="tel:+33671312706">Appeler le 06&nbsp;71&nbsp;31&nbsp;27&nbsp;06</a>
            <a class="btn btn-ghost" href="https://wa.me/33671312706?text=${waText}" target="_blank" rel="noopener">WhatsApp</a>
            <button type="button" class="devis-btn-secondary" id="devisReset">Nouveau devis</button>
          </div>
          <p class="devis-result-fineprint">Estimation établie sur la surface déclarée. Montant confirmé après validation technique du site.</p>
        </div>
      `;
      resultEl.hidden = false;

      document.getElementById('devisReset').addEventListener('click', resetFlow);
      document.getElementById('devisDownloadPdf').addEventListener('click', () => downloadQuotePdf(q, state.contact));

      const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const card = document.getElementById('devisResultCard');
      if (prefersReducedMotion) card.classList.add('is-visible');
      else requestAnimationFrame(() => requestAnimationFrame(() => card.classList.add('is-visible')));

      stepsList.querySelectorAll('.devis-step').forEach((li) => {
        li.classList.add('is-done');
        li.classList.remove('is-active');
      });
    }

    function resetFlow() {
      state.step = 1; state.serviceId = onlyServiceId; state.surface = null; state.contact = { name: '', company: '', email: '', phone: '', postalCode: '' };
      surfaceInput.value = '';
      surfaceContinueBtn.disabled = true;
      form.reset();
      form.hidden = false;
      quotePreview.hidden = false;
      setFormError(null);
      resultEl.hidden = true;
      resultEl.innerHTML = '';
      if (servicesWrap) {
        servicesWrap.querySelectorAll('.devis-service').forEach((btn) => {
          btn.classList.remove('is-selected');
          btn.setAttribute('aria-checked', 'false');
        });
      }
      goToStep(onlyServiceId ? 2 : 1);
      section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    /* ---- PDF (jsPDF, loaded lazily on first click — same pattern the old
       single-field estimator used, rebuilt for the new quote fields). ---- */
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
        .then((r) => r.blob())
        .then((blob) => new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => { cachedLogoDataUrl = reader.result; resolve(cachedLogoDataUrl); };
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        }))
        .catch(() => null);
    };

    // Brand palette — same tokens as the server-side PDF (lib/quote-pdf.js)
    // and the site's own blue accent (--exa-blue-accent / .cine-title
    // .accent), so the downloaded PDF, the emailed PDF, and the site look
    // like one document family instead of three different tools' defaults.
    const PDF_BLUE = [0, 103, 204];
    const PDF_DARK = [15, 23, 42];
    const PDF_GRAY = [100, 116, 139];
    const PDF_BORDER = [226, 232, 240];
    const PDF_PANEL = [248, 250, 252];

    async function downloadQuotePdf(q, contact) {
      const btn = document.getElementById('devisDownloadPdf');
      const originalLabel = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Génération…';
      try {
        await loadJsPdf();
        const { jsPDF } = window.jspdf;
        const logoDataUrl = await loadLogoDataUrl();
        const dateFmt = new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
        // jsPDF's standard fonts only cover WinAnsi — Intl.NumberFormat('fr-FR')
        // groups thousands with a narrow no-break space (U+202F) and pads the
        // currency symbol with a no-break space (U+00A0), neither in that
        // encoding, which rendered as a stray "/" glyph. The previous version
        // of this fix used a character class with two literal ASCII spaces
        // (typed in an editor instead of the two real characters), so it
        // silently matched nothing.
        const pdfSafe = (str) => str.replace(/[  ]/g, ' ');
        const fmtNum = (n) => pdfSafe(new Intl.NumberFormat('fr-FR').format(n));
        const fmtMoney = (n) => pdfSafe(pricing.formatCurrency(n));
        const service = pricing.getService(state.serviceId);

        const doc = new jsPDF({ unit: 'mm', format: 'a4' });
        const pageWidth = doc.internal.pageSize.getWidth();
        const marginX = 20;
        const contentW = pageWidth - marginX * 2;

        /* ---- Header: DEVIS + meta (left) / logo (right) ---- */
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(26);
        doc.setTextColor(...PDF_BLUE);
        doc.text('DEVIS', marginX, 26);

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(10);
        doc.setTextColor(...PDF_DARK);
        doc.text(`N° ${q.number}`, marginX, 34);
        doc.setTextColor(...PDF_GRAY);
        doc.text(`Émis le ${dateFmt.format(new Date(q.date))}`, marginX, 39.5);
        doc.text(`Valable jusqu'au ${dateFmt.format(new Date(q.validUntil))}`, marginX, 45);

        if (logoDataUrl) {
          const logoW = 32, logoH = logoW * (270 / 480);
          doc.addImage(logoDataUrl, 'PNG', pageWidth - marginX - logoW, 14, logoW, logoH);
        }

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.setTextColor(...PDF_GRAY);
        ;['Nordine Berkane — Exadrone Enterprise (nom commercial)', 'Entrepreneur individuel — 31 rue du Saint-Gothard, 75014 Paris', 'SIREN 878 531 607 · TVA FR73 878 531 607 · contact@exadrone-enterprise.com']
          .forEach((line, i) => doc.text(line, pageWidth - marginX, 34 + i * 4, { align: 'right' }));

        doc.setDrawColor(...PDF_BORDER);
        doc.setLineWidth(0.3);
        doc.line(marginX, 54, pageWidth - marginX, 54);

        /* ---- "Adressé à" — label/value form rows, underlined ---- */
        let y = 64;
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8);
        doc.setTextColor(...PDF_GRAY);
        doc.text('ADRESSÉ À', marginX, y);
        y += 7;

        const addrRow = (label, value) => {
          if (!value) return;
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(8.5);
          doc.setTextColor(...PDF_GRAY);
          doc.text(label, marginX, y);
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(10.5);
          doc.setTextColor(...PDF_DARK);
          doc.text(String(value), marginX + 42, y);
          doc.setDrawColor(...PDF_BORDER);
          doc.line(marginX, y + 2, pageWidth - marginX, y + 2);
          y += 9;
        };
        addrRow('NOM / SOCIÉTÉ', [contact?.name, contact?.company].filter(Boolean).join(' — ') || 'Client');
        addrRow('EMAIL', contact?.email);
        addrRow('TÉLÉPHONE', contact?.phone);
        addrRow('CODE POSTAL', contact?.postalCode);

        /* ---- Line-item table ---- */
        const tableY = y + 6;
        const colSurfaceX = pageWidth - marginX - 90;
        const colUnitX = pageWidth - marginX - 60;
        const colTotalRight = pageWidth - marginX;

        doc.setFillColor(...PDF_BLUE);
        doc.rect(marginX, tableY, contentW, 8, 'F');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8);
        doc.setTextColor(255, 255, 255);
        doc.text('PRESTATION', marginX + 3, tableY + 5.5);
        doc.text('SURFACE', colSurfaceX, tableY + 5.5, { align: 'right' });
        doc.text('PRIX UNIT. HT', colUnitX, tableY + 5.5, { align: 'right' });
        doc.text('MONTANT', colTotalRight - 3, tableY + 5.5, { align: 'right' });

        const rowH = 16;
        const rowY = tableY + 8;
        doc.setFillColor(...PDF_PANEL);
        doc.rect(marginX, rowY, contentW, rowH, 'F');
        doc.setDrawColor(...PDF_BORDER);
        doc.rect(marginX, tableY, contentW, 8 + rowH);

        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10);
        doc.setTextColor(...PDF_DARK);
        doc.text(service?.label || q.serviceLabel, marginX + 3, rowY + 6);
        if (service?.detail) {
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(8);
          doc.setTextColor(...PDF_GRAY);
          doc.text(service.detail, marginX + 3, rowY + 11);
        }
        const rawSubtotal = Math.round(q.surface * q.unitPriceHT * 100) / 100;
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9.5);
        doc.setTextColor(...PDF_DARK);
        doc.text(`${fmtNum(q.surface)} m²`, colSurfaceX, rowY + 9, { align: 'right' });
        doc.text(`${fmtMoney(q.unitPriceHT)}/m²`, colUnitX, rowY + 9, { align: 'right' });
        doc.setFont('helvetica', 'bold');
        doc.text(fmtMoney(rawSubtotal), colTotalRight - 3, rowY + 9, { align: 'right' });

        y = rowY + rowH + 6;
        if (q.minimumApplied) {
          doc.setFont('helvetica', 'italic');
          doc.setFontSize(8);
          doc.setTextColor(...PDF_GRAY);
          doc.text(`Un forfait minimum de commande de ${fmtMoney(q.totalHT)} HT s'applique à cette prestation.`, marginX, y, { maxWidth: contentW });
          y += 7;
        }

        /* ---- Totals summary (right-aligned) ---- */
        const sumLabelX = pageWidth - marginX - 55;
        y += 4;
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9.5);
        doc.setTextColor(...PDF_GRAY);
        doc.text('Total HT', sumLabelX, y);
        doc.setTextColor(...PDF_DARK);
        doc.text(fmtMoney(q.totalHT), colTotalRight, y, { align: 'right' });
        y += 6;
        doc.setTextColor(...PDF_GRAY);
        doc.text('TVA (20 %)', sumLabelX, y);
        doc.setTextColor(...PDF_DARK);
        doc.text(fmtMoney(q.vat), colTotalRight, y, { align: 'right' });
        y += 3;
        doc.setDrawColor(...PDF_BORDER);
        doc.line(sumLabelX, y, colTotalRight, y);
        y += 7;
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(13);
        doc.setTextColor(...PDF_BLUE);
        doc.text('Total TTC', sumLabelX, y);
        doc.text(fmtMoney(q.totalTTC), colTotalRight, y, { align: 'right' });

        /* ---- Payment terms (blue box, left) / signature (right) ---- */
        const boxY = y + 12;
        const boxH = 30;
        const boxW = contentW * 0.56;
        doc.setFillColor(...PDF_BLUE);
        doc.rect(marginX, boxY, boxW, boxH, 'F');
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8.5);
        doc.setTextColor(255, 255, 255);
        doc.text('CONDITIONS DE PAIEMENT', marginX + 5, boxY + 8);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.text('Acompte de 30 % à la commande, solde facturé', marginX + 5, boxY + 15, { maxWidth: boxW - 10 });
        doc.text("après exécution de la prestation.", marginX + 5, boxY + 20);
        doc.text('CGV : exadrone-enterprise.com/cgv.html', marginX + 5, boxY + 26);

        const sigX = marginX + boxW + 12;
        const sigW = contentW - boxW - 12;
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8.5);
        doc.setTextColor(...PDF_GRAY);
        doc.text('BON POUR ACCORD', sigX, boxY + 8);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7.5);
        doc.text('Date, signature et cachet', sigX, boxY + 15, { maxWidth: sigW });
        doc.setDrawColor(...PDF_BORDER);
        doc.line(sigX, boxY + boxH - 2, sigX + sigW, boxY + boxH - 2);

        /* ---- Footer legal strip ---- */
        const pageH = doc.internal.pageSize.getHeight();
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7);
        doc.setTextColor(...PDF_GRAY);
        doc.text(
          'Exadrone Enterprise — Nordine Berkane, entrepreneur individuel — SIREN 878 531 607 — TVA FR73 878 531 607 — 31 rue du Saint-Gothard, 75014 Paris',
          pageWidth / 2, pageH - 12, { align: 'center', maxWidth: contentW }
        );

        doc.save(`Devis_Exadrone_${q.number}.pdf`);
      } catch (err) {
        console.error('PDF generation failed:', err);
        alert('La génération du PDF a échoué — réessayez ou contactez-nous directement.');
      } finally {
        btn.disabled = false;
        btn.textContent = originalLabel;
      }
    }

    if (onlyServiceId) { state.serviceId = onlyServiceId; goToStep(2); }
    else { goToStep(1); }
  })();

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
