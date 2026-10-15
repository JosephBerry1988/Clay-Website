/*!
 * customers-ui.js — all non-Odyn page JS for /customers, one deferred file.
 * Load AFTER gsap (+ ScrollTrigger). Every feature checks its own DOM first,
 * so a missing section never throws and never blocks the others.
 * Not tested in a browser: diff against the old inline scripts before shipping.
 */
(() => {
  "use strict";

  const ready = (fn) =>
    document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", fn, { once: true }) : fn();
  const onLoad = (fn) =>
    document.readyState === "complete" ? fn() : window.addEventListener("load", fn, { once: true });
  const reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const hasGsap = () => typeof gsap !== "undefined";

  /* 1. Filter tab "active" class (legacy; Odyn also toggles is--active). Remove once CSS uses is--active. */
  function initFilterTabClass() {
    document.addEventListener("click", (e) => {
      const tab = e.target.closest(".filter-tab_parent");
      if (tab) tab.classList.toggle("active");
    });
  }

  /* 2. Re-init Webflow IX3 after load-more adds cards (delegated: survives the button being re-rendered) */
  function initLoadMoreIX() {
    const refresh = () => {
      if (!window.Webflow) return;
      window.Webflow.destroy();
      window.Webflow.ready();
      const ix3 = window.Webflow.require && window.Webflow.require("ix3");
      if (ix3 && ix3.init) ix3.init();
    };
    document.addEventListener("click", (e) => {
      if (e.target.closest(".cl-load-more-main")) setTimeout(refresh, 800);
    });
  }

  /* 3. Lazy <video class="lazy"> */
  function initLazyVideos() {
    const videos = [].slice.call(document.querySelectorAll("video.lazy"));
    if (!videos.length || !("IntersectionObserver" in window)) return;
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const video = entry.target;
        [].slice.call(video.children).forEach((child) => {
          if (child.tagName === "SOURCE") child.src = child.dataset.src;
        });
        video.load();
        video.classList.remove("lazy");
        io.unobserve(video);
      });
    });
    videos.forEach((v) => io.observe(v));
  }

  /* 4. Hero "GTM in Action" letter animation */
  function initFancyText() {
    const el = document.querySelector(".cl-fancy-text");
    if (!el || !hasGsap()) return;
    gsap.set(el, { visibility: "hidden" });
    el.innerHTML = "GTM in Action"
      .split("")
      .map((l) => (l === " " ? '<span class="letter space" style="width:0.2em;display:inline-block;">&nbsp;</span>' : `<span class="letter">${l}</span>`))
      .join("");
    const letters = el.querySelectorAll(".letter");
    gsap.set(el, { visibility: "visible" });
    if (reduceMotion) return;
    gsap.set(letters, { opacity: 0, scale: 0.8, rotation: () => (Math.random() - 0.5) * 60 });
    const tl = gsap.timeline();
    letters.forEach((letter) => {
      tl.to(letter, { scale: 1, opacity: 1, rotation: 0, duration: 0.6, ease: "back.out(1.7)" }, "<0.05");
    });
  }

  /* 5. Cascading slider (diagnostic console.table removed) */
  function initCascadingSlider() {
    const duration = 0.35;
    const ease = 'power2.out';

    const breakpoints = [
      { maxWidth: 479, activeWidth: 0.72, siblingWidth: 0.07 },
      { maxWidth: 767, activeWidth: 0.7, siblingWidth: 0.1 },
      { maxWidth: 991, activeWidth: 0.6, siblingWidth: 0.1 },
      { maxWidth: Infinity, activeWidth: 0.6, siblingWidth: 0.13 },
    ];

    const wrappers = document.querySelectorAll('[data-cascading-slider-wrap]');
    wrappers.forEach(setupInstance);

    function setupInstance(wrapper) {
      const viewport = wrapper.querySelector('[data-cascading-viewport]');
      if (!viewport) return;

      const logoButtons = Array.from(wrapper.querySelectorAll('[data-cascading-slider-logo]'));
      const logoTrack = wrapper.querySelector('.cascading-slider__logo-track');
      const marker = wrapper.querySelector('.cascading-slider__logo-marker');
      const slides = Array.from(viewport.querySelectorAll('[data-cascading-slide]'));

      let totalSlides = slides.length;
      if (totalSlides === 0) return;

      const realSlidesCount = totalSlides;

      if (totalSlides < 9) {
        const originalSlides = slides.slice();

        while (slides.length < 9) {
          originalSlides.forEach(function (original) {
            // ✅ FIX: The link (.cl-link-card_parent) is an ANCESTOR of the slide,
            // not a descendant — so we walk UP the tree with closest().
            const originalLink = original.closest('.cl-link-card_parent') || original.closest('a[href]');
            const linkUrl = originalLink ? originalLink.getAttribute('href') : null;

            const clone = original.cloneNode(true);
            clone.setAttribute('data-clone', '');

            // Store the resolved URL on the clone so the click handler can use it
            if (linkUrl) {
              clone.setAttribute('data-link-url', linkUrl);
            }

            viewport.appendChild(clone);
            slides.push(clone);
          });
        }

        totalSlides = slides.length;
      }

      let activeIndex = 0;
      let isAnimating = false;
      let slideWidth = 0;
      let slotCenters = {};
      let slotWidths = {};

      function readGap() {
        const raw = getComputedStyle(viewport).getPropertyValue('--gap').trim();
        if (!raw) return 0;

        const temp = document.createElement('div');
        temp.style.width = raw;
        temp.style.position = 'absolute';
        temp.style.visibility = 'hidden';

        viewport.appendChild(temp);
        const px = temp.offsetWidth;
        viewport.removeChild(temp);

        return px;
      }

      function getSettings() {
        const windowWidth = window.innerWidth;

        for (let i = 0; i < breakpoints.length; i++) {
          if (windowWidth <= breakpoints[i].maxWidth) return breakpoints[i];
        }

        return breakpoints[breakpoints.length - 1];
      }

      function getOffset(slideIndex, fromIndex) {
        if (fromIndex === undefined) fromIndex = activeIndex;

        let distance = slideIndex - fromIndex;
        const half = totalSlides / 2;

        if (distance > half) distance -= totalSlides;
        if (distance < -half) distance += totalSlides;

        return distance;
      }

      function getRealIndex(index) {
        return ((index % realSlidesCount) + realSlidesCount) % realSlidesCount;
      }

      function getClosestSlideIndex(realIndex) {
        let closestIndex = realIndex;
        let closestDistance = Infinity;

        slides.forEach(function (_, index) {
          if (getRealIndex(index) !== realIndex) return;

          const distance = Math.abs(getOffset(index, activeIndex));

          if (distance < closestDistance) {
            closestDistance = distance;
            closestIndex = index;
          }
        });

        return closestIndex;
      }

      function measure() {
        const settings = getSettings();
        const viewportWidth = viewport.offsetWidth;
        const gap = readGap();

        const activeSlideWidth = viewportWidth * settings.activeWidth;
        const siblingSlideWidth = viewportWidth * settings.siblingWidth;

        const farSlideWidth = Math.max(0, (viewportWidth - activeSlideWidth - 2 * siblingSlideWidth - 4 * gap) / 2);

        slideWidth = activeSlideWidth;

        slotCenters = {};
        slotWidths = {};

        const visibleSlots = [
          { slot: -2, width: farSlideWidth },
          { slot: -1, width: siblingSlideWidth },
          { slot: 0, width: activeSlideWidth },
          { slot: 1, width: siblingSlideWidth },
          { slot: 2, width: farSlideWidth },
        ];

        let x = 0;

        visibleSlots.forEach(function (def, i) {
          slotCenters[String(def.slot)] = x + def.width / 2;
          slotWidths[String(def.slot)] = def.width;

          if (i < visibleSlots.length - 1) {
            x += def.width + gap;
          }
        });

        slotCenters['-3'] = slotCenters['-2'] - farSlideWidth - gap;
        slotWidths['-3'] = farSlideWidth;

        slotCenters['3'] = slotCenters['2'] + farSlideWidth + gap;
        slotWidths['3'] = farSlideWidth;

        slides.forEach(function (slide) {
          slide.style.width = slideWidth + 'px';
        });
      }

      function getSlideProps(offset) {
        const clamped = Math.max(-3, Math.min(3, offset));
        const slotWidth = slotWidths[String(clamped)];
        const clipAmount = Math.max(0, (slideWidth - slotWidth) / 2);
        const translateX = slotCenters[String(clamped)] - slideWidth / 2;

        return {
          x: translateX,
          '--clip': clipAmount,
          zIndex: 10 - Math.abs(clamped),
        };
      }

      // ✅ NEW: Apply links to active slides (original and cloned)
      function updateActiveSlideLink() {
        slides.forEach(function (slide) {
          const isActive = slide.getAttribute('data-status') === 'active';

          if (isActive) {
            slide.classList.add('is-linked');
            slide.setAttribute('data-linked', 'true');
            slide.style.cursor = 'pointer';
          } else {
            slide.classList.remove('is-linked');
            slide.removeAttribute('data-linked');
            slide.style.cursor = 'default';
          }
        });
      }

      function updateLogoNav() {
        if (!logoButtons.length) return;

        const realIndex = getRealIndex(activeIndex);
        const activeButton = logoButtons[realIndex];

        logoButtons.forEach(function (button, index) {
          const isActive = index === realIndex;

          button.classList.toggle('is-active', isActive);
          button.setAttribute('aria-current', isActive ? 'true' : 'false');
        });

        function updateMarkerPosition() {
          if (!marker || !activeButton) return;

          const navRect = marker.parentElement.getBoundingClientRect();
          const buttonRect = activeButton.getBoundingClientRect();

          const markerLeft = buttonRect.left - navRect.left + buttonRect.width / 2;

          gsap.set(marker, {
            left: markerLeft,
          });
        }

        if (logoTrack && window.innerWidth <= 479) {
          const visibleCount = 3;
          const maxOffset = Math.max(0, logoButtons.length - visibleCount);
          const offset = Math.max(0, Math.min(realIndex - 1, maxOffset));

          const logoWidth = logoButtons[0].offsetWidth;
          const targetX = -offset * logoWidth;

          gsap.to(logoTrack, {
            x: targetX,
            duration,
            ease,
            overwrite: true,
            onUpdate: updateMarkerPosition,
            onComplete: updateMarkerPosition,
          });
        } else if (logoTrack) {
          gsap.to(logoTrack, {
            x: 0,
            duration,
            ease,
            overwrite: true,
            onUpdate: updateMarkerPosition,
            onComplete: updateMarkerPosition,
          });
        } else {
          updateMarkerPosition();
        }
      }

      function layout(animate) {
        slides.forEach(function (slide, index) {
          const offset = getOffset(index);

          if (offset < -3 || offset > 3) {
            const parkSlot = offset < 0 ? -3 : 3;
            gsap.set(slide, getSlideProps(parkSlot));
            slide.setAttribute('data-status', 'inactive');
            return;
          }

          const props = getSlideProps(offset);

          slide.setAttribute('data-status', offset === 0 ? 'active' : 'inactive');

          slide.setAttribute('data-offset', offset);

          if (animate) {
            gsap.to(slide, {
              ...props,
              duration,
              ease,
              overwrite: true,
            });
          } else {
            gsap.set(slide, props);
          }
        });

        // ✅ NEW: Update active slide link (works for cloned items too)
        updateActiveSlideLink();
        updateLogoNav();
      }

      function goTo(targetIndex) {
        if (isAnimating) return;

        targetIndex = ((targetIndex % totalSlides) + totalSlides) % totalSlides;

        if (targetIndex === activeIndex) return;

        isAnimating = true;

        activeIndex = targetIndex;
        layout(true);

        gsap.delayedCall(duration + 0.05, function () {
          isAnimating = false;
        });
      }

      // ✅ Resolve the destination URL for any slide (original OR clone).
      // Originals: the link (.cl-link-card_parent) is an ANCESTOR, so walk up.
      // Clones: the URL was baked onto the clone as data-link-url at clone time.
      function resolveSlideUrl(slide) {
        // Clones carry the URL directly
        const stored = slide.getAttribute('data-link-url');
        if (stored) return stored;

        // Originals: walk UP to the wrapping <a>
        const ancestorLink = slide.closest('.cl-link-card_parent') || slide.closest('a[href]');
        if (ancestorLink && ancestorLink.getAttribute('href')) {
          return ancestorLink.getAttribute('href');
        }

        // Last-resort: a nested link inside the slide
        const nested = slide.querySelector('.cl-link-card_parent') || slide.querySelector('a[href]');
        if (nested && nested.getAttribute('href')) {
          return nested.getAttribute('href');
        }

        return null;
      }

      logoButtons.forEach(function (button, index) {
        button.addEventListener('click', function () {
          const closestIndex = getClosestSlideIndex(index);
          goTo(closestIndex);
        });
      });

      slides.forEach(function (slide, index) {
        slide.addEventListener('click', function (event) {
          const offset = getOffset(index);

          if (offset === 0) {
            // ✅ Handle click on active slide (center focused item)
            const url = resolveSlideUrl(slide);
            if (url) {
              window.location.href = url;
            }
            return;
          }

          event.preventDefault();
          event.stopPropagation();

          goTo(index);
        });
      });

      document.addEventListener('keydown', function (event) {
        if (event.key === 'ArrowLeft') goTo(activeIndex - 1);
        if (event.key === 'ArrowRight') goTo(activeIndex + 1);
      });

      let resizeTimer;

      window.addEventListener('resize', function () {
        clearTimeout(resizeTimer);

        resizeTimer = setTimeout(function () {
          measure();
          layout(false);
          updateLogoNav();
        }, 100);
      });

      measure();
      layout(false);
      updateLogoNav();

    }
  }

  /* 6. Image trail (desktop only) */
    function initImageTrail(config = {}) {
      const options = {
        minWidth: config.minWidth ?? 992,
        moveDistance: config.moveDistance ?? 15,
        stopDuration: config.stopDuration ?? 300,
        trailLength: config.trailLength ?? 5,
        rotationAmount: config.rotationAmount ?? 8,
      };

      const wrapper = document.querySelector('[data-trail="wrapper"]');

      if (!wrapper || window.innerWidth < options.minWidth) return;

      const state = {
        trailInterval: null,
        globalIndex: 0,
        last: { x: 0, y: 0 },
        trailImageTimestamps: new Map(),
        trailImages: Array.from(document.querySelectorAll('[data-trail="item"]')),
        isActive: false,
      };

      const MathUtils = {
        distance: (x1, y1, x2, y2) => Math.hypot(x2 - x1, y2 - y1),
      };

      function getRelativeCoordinates(e, rect) {
        return {
          x: e.clientX - rect.left,
          y: e.clientY - rect.top,
        };
      }

      function activate(trailImage, x, y) {
        if (!trailImage) return;

        const rect = trailImage.getBoundingClientRect();

        const direction = state.globalIndex % 2 === 0 ? -1 : 1;
        const rotation = options.rotationAmount * direction;

        Object.assign(trailImage.style, {
          left: `${x - rect.width / 2}px`,
          top: `${y - rect.height / 2}px`,
          zIndex: state.globalIndex,
          display: 'block',
          transformOrigin: '50% 80%',
        });

        state.trailImageTimestamps.set(trailImage, Date.now());

        gsap.fromTo(
          trailImage,
          {
            autoAlpha: 0,
            scale: 0.35,
            rotation: rotation * 3,
            y: 18,
          },
          {
            autoAlpha: 1,
            scale: 1,
            rotation: rotation,
            y: 0,
            duration: 0.6,
            ease: 'back.out(1.7)',
            overwrite: true,
          },
        );

        state.last = { x, y };
      }

      function fadeOutTrailImage(trailImage) {
        if (!trailImage) return;

        const currentRotation = gsap.getProperty(trailImage, 'rotation');

        gsap.to(trailImage, {
          autoAlpha: 0,
          scale: 0.2,
          rotation: currentRotation > 0 ? currentRotation + 22 : currentRotation - 22,
          y: -12,
          duration: 0.8,
          ease: 'expo.out',
          overwrite: true,
          onComplete: () => {
            gsap.set(trailImage, { autoAlpha: 0 });
          },
        });
      }

      function handleOnMove(e) {
        if (!state.isActive) return;

        const rectWrapper = wrapper.getBoundingClientRect();
        const { x: relativeX, y: relativeY } = getRelativeCoordinates(e, rectWrapper);

        const distanceFromLast = MathUtils.distance(relativeX, relativeY, state.last.x, state.last.y);

        if (distanceFromLast > window.innerWidth / options.moveDistance) {
          const lead = state.trailImages[state.globalIndex % state.trailImages.length];

          const tail = state.trailImages[(((state.globalIndex - options.trailLength) % state.trailImages.length) + state.trailImages.length) % state.trailImages.length];

          activate(lead, relativeX, relativeY);
          fadeOutTrailImage(tail);

          state.globalIndex++;
        }
      }

      function cleanupTrailImages() {
        const currentTime = Date.now();

        for (const [trailImage, timestamp] of state.trailImageTimestamps.entries()) {
          if (currentTime - timestamp > options.stopDuration) {
            fadeOutTrailImage(trailImage);
            state.trailImageTimestamps.delete(trailImage);
          }
        }
      }

      function startTrail() {
        if (state.isActive) return;

        state.isActive = true;
        wrapper.addEventListener('mousemove', handleOnMove);
        state.trailInterval = setInterval(cleanupTrailImages, 100);
      }

      function stopTrail() {
        if (!state.isActive) return;

        state.isActive = false;
        wrapper.removeEventListener('mousemove', handleOnMove);
        clearInterval(state.trailInterval);
        state.trailInterval = null;

        state.trailImages.forEach(fadeOutTrailImage);
        state.trailImageTimestamps.clear();
      }

      ScrollTrigger.create({
        trigger: wrapper,
        start: 'top bottom',
        end: 'bottom top',
        onEnter: startTrail,
        onEnterBack: startTrail,
        onLeave: stopTrail,
        onLeaveBack: stopTrail,
      });

      const handleResize = () => {
        if (window.innerWidth < options.minWidth && state.isActive) {
          stopTrail();
        } else if (window.innerWidth >= options.minWidth && !state.isActive) {
          startTrail();
        }
      };

      window.addEventListener('resize', handleResize);

      return () => {
        stopTrail();
        window.removeEventListener('resize', handleResize);
      };
    }

  /* 7. Intro video: Vimeo player.js is fetched on first click, not on page load */
  function initIntroVideo() {
    const iframe = document.getElementById("introVideo");
    const playButton = document.getElementById("infoCard");
    const closeButton = document.getElementById("closeButton");
    if (!iframe || !playButton) return;
    let player = null;
    let started = false;
    const loadVimeo = () =>
      window.Vimeo
        ? Promise.resolve()
        : new Promise((resolve, reject) => {
            const s = document.createElement("script");
            s.src = "https://player.vimeo.com/api/player.js";
            s.onload = resolve;
            s.onerror = reject;
            document.head.appendChild(s);
          });
    playButton.addEventListener("click", () => {
      if (player) return player.play();
      if (started) return;
      started = true;
      loadVimeo().then(() => {
        iframe.onload = () => {
          player = new Vimeo.Player(iframe);
          player.ready().then(() => player.play());
        };
        iframe.src = iframe.dataset.src;
      });
    });
    if (closeButton) {
      closeButton.addEventListener("click", () => {
        if (!player) return;
        player.pause();
        player.setCurrentTime(0);
      });
    }
  }

  /* 8. Mobile filter accordions */
  function initMobileFilters() {
    const breakpoint = 767;
    const children = document.querySelectorAll(".cl-filter_child");
    if (!children.length) return;
    const parts = (child) => ({ wrap: child.querySelector(".cl-filter_wrap"), icon: child.querySelector(".cl-plus_icon") });
    const close = (child) => {
      const { wrap, icon } = parts(child);
      child.classList.remove("is-active");
      if (wrap) wrap.style.display = "none";
      if (icon) icon.style.transform = "rotate(0deg)";
    };
    const setup = () => {
      children.forEach((child) => {
        const { wrap, icon } = parts(child);
        if (window.innerWidth <= breakpoint) {
          if (!child.classList.contains("is-active")) {
            if (wrap) wrap.style.display = "none";
            if (icon) icon.style.transform = "rotate(0deg)";
          }
        } else {
          if (wrap) wrap.style.display = "";
          if (icon) icon.style.transform = "";
          child.classList.remove("is-active");
        }
      });
    };
    children.forEach((child) => {
      child.addEventListener("click", (event) => {
        if (window.innerWidth > breakpoint) return;
        const { wrap, icon } = parts(child);
        if (!wrap) return;
        const wasOpen = child.classList.contains("is-active");
        children.forEach((c) => c !== child && close(c));
        if (wasOpen) {
          close(child);
        } else {
          child.classList.add("is-active");
          wrap.style.display = "flex";
          if (icon) icon.style.transform = "rotate(45deg)";
        }
        event.stopPropagation();
      });
    });
    setup();
    window.addEventListener("resize", setup);
  }

  /* 9. Swap loops (stat cards + logo garden) */
  function initSwapLoop(parentSelector, childSelector, opts = {}) {
    const effect = opts.effect || "slide";
    const hold = opts.hold ?? 4;
    const duration = opts.duration ?? 0.8;
    const ease = opts.ease || "power3.inOut";
    const stagger = opts.stagger ?? 0.35;
    gsap.utils.toArray(parentSelector).forEach((parent, index) => {
      const items = gsap.utils.toArray(childSelector, parent);
      if (items.length < 2) return;
      if (effect === "fade") {
        gsap.set(items, { opacity: 0 });
        gsap.set(items[0], { opacity: 1 });
      } else {
        gsap.set(items, { yPercent: 100 });
        gsap.set(items[0], { yPercent: 0 });
      }
      if (reduceMotion) return;
      let current = 0;
      const advance = () => {
        const next = (current + 1) % items.length;
        const tl = gsap.timeline({
          delay: hold,
          defaults: { duration, ease },
          onComplete: () => { current = next; advance(); },
        });
        if (effect === "fade") {
          gsap.set(items[next], { opacity: 0 });
          tl.to(items[current], { opacity: 0 }, 0).to(items[next], { opacity: 1 }, 0);
        } else {
          gsap.set(items[next], { yPercent: 100 });
          tl.to(items[current], { yPercent: -100 }, 0).to(items[next], { yPercent: 0 }, 0);
        }
      };
      gsap.delayedCall(index * stagger, advance);
    });
  }
  function initSwapLoops() {
    initSwapLoop(".cl-data_parent", ".cl-data_child", { effect: "slide", hold: 4, duration: 0.8, stagger: 0.35 });
    initSwapLoop(".cl-logo_parent", ".cl-logo_child", { effect: "fade", hold: 2, duration: 0.6, stagger: 0 });
  }

  /* ---------- boot ---------- */
  initFilterTabClass();
  initLoadMoreIX();
  ready(() => {
    initLazyVideos();
    initMobileFilters();
    initIntroVideo();
    if (hasGsap()) {
      initCascadingSlider();
      initSwapLoops();
      if (typeof ScrollTrigger !== "undefined") gsap.registerPlugin(ScrollTrigger);
      // non-critical, pointer-only effect: wait until the browser is idle
      const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 200));
      idle(() => initImageTrail({ minWidth: 992, moveDistance: 15, stopDuration: 350, trailLength: 8, rotationAmount: 8 }));
    }
  });
  onLoad(initFancyText);
})();
