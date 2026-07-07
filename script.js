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

  const scrollTick = () => {
    currentScrollY += (targetScrollY - currentScrollY) * 0.25;
    if (Math.abs(targetScrollY - currentScrollY) < 0.05) currentScrollY = targetScrollY;

    nav.classList.toggle('scrolled', currentScrollY > 40);

    const scrollable = root.scrollHeight - window.innerHeight;
    const progress = scrollable > 0 ? currentScrollY / scrollable : 0;
    root.style.setProperty('--glow-y', `${progress * 100}%`);
    root.style.setProperty('--scroll-bg', lerpBackground(progress));

    requestAnimationFrame(scrollTick);
  };
  requestAnimationFrame(scrollTick);

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


  /* ---------- Hero title: split into per-character spans ----------
     Runs once, before the reveal observer below attaches, so each line's
     existing data-reveal/data-delay still gates *when* it animates — only
     *what* animates changes, from the whole line to each individual
     letter (see .hero-title .char in styles.css for the blur-to-focus
     transition itself; this is purely a one-time DOM write, not a
     per-frame loop). Each word is wrapped in its own inline-block span —
     line-wrapping can only happen between those word boxes, never between
     two character spans inside one — so the browser still wraps at word
     boundaries exactly like plain text, instead of mid-word. */
  document.querySelectorAll('.hero-title .reveal').forEach((line) => {
    const text = line.textContent;
    line.setAttribute('aria-label', text);
    line.setAttribute('role', 'text');
    line.innerHTML = '';
    let i = 0;
    const words = text.split(' ');
    words.forEach((word, wi) => {
      const wordSpan = document.createElement('span');
      wordSpan.className = 'word';
      word.split('').forEach((ch) => {
        const span = document.createElement('span');
        span.className = 'char';
        span.setAttribute('aria-hidden', 'true');
        span.style.setProperty('--i', i++);
        span.textContent = ch;
        wordSpan.appendChild(span);
      });
      line.appendChild(wordSpan);
      if (wi < words.length - 1) line.appendChild(document.createTextNode(' '));
    });
  });

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

  /* ---------- "Reels-style" gallery: pure-CSS infinite marquee ----------
     The loop itself is just the gallery-marquee CSS animation in
     styles.css (translate3d, GPU-composited, no JS in the motion path).
     This block only toggles one pause class — on pointerenter/leave for
     mouse, and touchstart/touchend for touch, never a CSS :hover rule:
     a touch tap can leave a lingering :hover with nothing to clear it,
     which would wedge the marquee paused forever with no way back. */
  const galleryTrack = document.getElementById('galleryTrack');
  if (galleryTrack && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const pause = () => galleryTrack.classList.add('is-paused');
    const resume = () => galleryTrack.classList.remove('is-paused');

    galleryTrack.addEventListener('pointerenter', (e) => { if (e.pointerType !== 'touch') pause(); });
    galleryTrack.addEventListener('pointerleave', (e) => { if (e.pointerType !== 'touch') resume(); });

    let touchResumeTimer = null;
    galleryTrack.addEventListener('touchstart', () => {
      clearTimeout(touchResumeTimer);
      pause();
    }, { passive: true });
    galleryTrack.addEventListener('touchend', () => {
      clearTimeout(touchResumeTimer);
      touchResumeTimer = setTimeout(resume, 1800);
    }, { passive: true });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') resume();
      else pause();
    });
  }

  /* ---------- Instant quote calculator ---------- */
  const estimateArea = document.getElementById('estimateArea');
  const estimateOutput = document.getElementById('estimateOutput');
  const estimateCta = document.getElementById('estimateCta');
  const RATE_PER_SQM = 5;

  if (estimateArea && estimateOutput) {
    const fmt = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
    let displayed = 0;
    let target = 0;
    let animating = false;

    const renderOutput = () => {
      displayed += (target - displayed) * 0.18;
      if (Math.abs(target - displayed) < 1) displayed = target;
      estimateOutput.innerHTML = `${fmt.format(Math.round(displayed))}&nbsp;€`;
      if (displayed !== target) {
        requestAnimationFrame(renderOutput);
      } else {
        animating = false;
      }
    };

    const updateEstimate = () => {
      const area = Math.max(0, parseFloat(estimateArea.value) || 0);
      target = area * RATE_PER_SQM;
      if (!animating) { animating = true; requestAnimationFrame(renderOutput); }
    };

    estimateArea.addEventListener('input', updateEstimate);

    if (estimateCta) {
      estimateCta.addEventListener('click', (e) => {
        e.preventDefault();
        const area = Math.max(0, parseFloat(estimateArea.value) || 0);
        const price = area * RATE_PER_SQM;
        const params = area > 0 ? `?area=${Math.round(area)}&budget=${Math.round(price)}` : '';
        window.location.href = `/contact${params}`;
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
    const budget = parseFloat(params.get('budget'));
    if (area > 0) {
      const fmt = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
      const message = document.querySelector('#briefForm textarea[name="message"]');
      if (message) {
        message.value = `Surface estimée : ${fmt.format(area)} m² — Budget estimé : ${fmt.format(budget)} €. Merci de m'envoyer une proposition PDF détaillée.`;
      }
      prefillNote.textContent = `Pré-rempli à partir de votre estimation instantanée : ${fmt.format(area)} m² · ${fmt.format(budget)} €`;
      prefillNote.classList.add('is-visible');
    }
  }

});
