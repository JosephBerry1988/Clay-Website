(function () {
  var root = document.querySelector('.grid-board-parent');
  if (!root || root.__boardInit) return;
  root.__boardInit = true;
  if (!window.gsap || !window.Draggable) return;
  gsap.registerPlugin(Draggable, InertiaPlugin);

  var config = {
    smoothDuration: 1.2,
    throwResistance: 4400,
    maxThrowSpeed: 2500,
    revealMargin: 40,
    driftSpeed: 30,
    boardScale: 1.15,
    mobileWidthFloor: 8.6 // multiplier: on phones only, each tile's minimum px width = its vw number x this. Only ever applied below 767px, so desktop is never touched.
    // Border radius (24px desktop, 12px on phones) lives in Webflow's
    // own breakpoint styles, not here - see .board-media-image /
    // .board-media-video in Designer.
  };

  var IS_MOBILE = window.innerWidth <= 767; // captured once at load, matches Webflow's own "small" breakpoint

  var TEXTURE_URL = 'https://cdn.prod.website-files.com/61477f2c24a826836f969afe/6ab4207d84f7757cd95ed6d1_Community%20Hero.avif';

  // ---- Style every item from its CMS-bound data attributes ----
  // Rotation goes through a CSS variable (--item-rotation) rather than
  // being written directly into el.style.transform, because the reveal
  // system below also needs to animate a scale on the same element -
  // this lets CSS compose "rotate(var(--item-rotation)) scale(...)" in
  // one place instead of two different bits of JS fighting over one
  // transform string.
  var MOBILE_FALLBACK_SLUG = 'mobile-board-image';
  var TABLET_FALLBACK_SLUG = 'tablet-board-image';

  // Reveal is applied inline (as well as via the is-revealed class) so it never
  // depends on the combo-class CSS being published in Webflow. The base
  // .board-media-item transition (opacity/transform) still animates it.
  function setRevealed(el, on) {
    el.classList.toggle('is-revealed', on);
    el.style.opacity = on ? '1' : '0';
    el.style.transform = 'rotate(var(--item-rotation,0deg)) scale(' + (on ? 1 : 0.8) + ')';
  }

  function styleItem(el) {
    if (el.__styled) return;
    el.__styled = true;

    // This one item is a data carrier for the tablet/mobile fallback
    // image, not a real tile - it never renders as part of the
    // normal grid on any breakpoint, desktop included. See the
    // tablet-down branch below for where its image actually gets
    // used.
    if (el.getAttribute('data-slug') === MOBILE_FALLBACK_SLUG || el.getAttribute('data-slug') === TABLET_FALLBACK_SLUG) {
      el.style.display = 'none';
      return;
    }

    var left = el.getAttribute('data-position-left');
    var top = el.getAttribute('data-position-top');
    var right = el.getAttribute('data-position-right');
    var bottom = el.getAttribute('data-position-bottom');
    var width = el.getAttribute('data-width');
    var height = el.getAttribute('data-height');
    var rotation = el.getAttribute('data-rotation');
    var zIndex = el.getAttribute('data-z-index');
    var borderColor = el.getAttribute('data-border-color');
    var hideOnMobile = el.getAttribute('data-hide-mobile') === 'true';

    el.style.left = left || 'auto';
    el.style.top = top || 'auto';
    el.style.right = right || 'auto';
    el.style.bottom = bottom || 'auto';
    // Only touches sizing on phones (IS_MOBILE) - desktop always gets
    // the plain vw value untouched, so this can't conflict with or
    // change anything about the desktop layout. On phones, each tile
    // gets a floor proportional to its own original size (smaller
    // tiles get a smaller floor, bigger ones a bigger one) so the
    // design's size hierarchy survives instead of collapsing.
    if (width && IS_MOBILE) {
      var vwMatch = /^([\d.]+)vw$/.exec(width.trim());
      if (vwMatch) {
        var vwNum = parseFloat(vwMatch[1]);
        el.style.width = 'clamp(' + (vwNum * config.mobileWidthFloor) + 'px, ' + vwNum + 'vw, 9999px)';
      } else {
        el.style.width = width;
      }
    } else if (width) {
      el.style.width = width;
    }
    if (height) el.style.height = height;
    el.style.setProperty('--item-rotation', rotation || '0deg');
    if (zIndex) el.style.zIndex = zIndex;
    if (borderColor) {
      el.style.setProperty('--board-border-color', borderColor);
      el.style.setProperty('--board-border-width', '6px');
    }
    if (hideOnMobile) el.classList.add('board-hide-mobile');

    var mediaType = (el.getAttribute('data-media-type') || '').toLowerCase();
    var imageEl = el.querySelector('.board-media-image');
    var videoEl = el.querySelector('.board-media-video');
    var quoteEl = el.querySelector('.board-media-quote');

    if (imageEl) {
      imageEl.style.display = (mediaType === 'image' || mediaType === 'icon') ? '' : 'none';
      // Not settable via Webflow's style API (vendor-prefixed
      // properties are rejected there), so applied directly here
      // instead - without this, touching an image on iOS briefly
      // triggers the native long-press/save gesture before the
      // browser realizes it's actually a scroll, which is what was
      // causing the stuck-scroll feeling specifically over images.
      imageEl.style.setProperty('-webkit-touch-callout', 'none');
      imageEl.style.setProperty('-webkit-user-drag', 'none');
      if (mediaType === 'icon') {
        imageEl.style.objectFit = 'contain';
        imageEl.style.border = 'none';
      }
    }
    if (videoEl) videoEl.style.display = (mediaType === 'video') ? '' : 'none';
    if (quoteEl) quoteEl.style.display = (mediaType === 'quote') ? '' : 'none';

    el.setAttribute('data-board-reveal', '');
  }

  function styleAllItems(scopeEl) {
    scopeEl.querySelectorAll('.board-media-item').forEach(styleItem);
  }

  function playVideosIn(scopeEl) {
    scopeEl.querySelectorAll('.board-media-video video').forEach(function (v) {
      v.loop = true;
      v.muted = true;
      v.setAttribute('playsinline', '');
      v.setAttribute('muted', '');
      var p = v.play();
      if (p && p.catch) p.catch(function () {});
    });
  }

  // ---- Capture the real, CMS-rendered content before touching structure ----
  var originalContent = root.firstElementChild;
  if (!originalContent) return;

  // Checked before any tile styling/positioning work happens at all -
  // if a fallback image exists for this breakpoint, none of that
  // work is needed and skipping it entirely (not just hiding the
  // result afterwards) is the actual performance win. This reads the
  // image's src straight off the raw DOM, since Webflow's own CMS
  // binding already puts it there regardless of whether styleItem()
  // has touched this item yet.
  if (window.innerWidth <= 991) {
    var targetSlug = (window.innerWidth <= 767) ? MOBILE_FALLBACK_SLUG : TABLET_FALLBACK_SLUG;
    var fallbackItem = originalContent.querySelector('[data-slug="' + targetSlug + '"]');
    var fallbackImg = fallbackItem ? fallbackItem.querySelector('.board-media-image') : null;
    if (fallbackImg && fallbackImg.getAttribute('src')) {
      originalContent.querySelectorAll('.board-media-item').forEach(function (el) {
        el.style.display = 'none';
      });
      fallbackImg.style.display = '';
      fallbackImg.style.objectFit = 'cover';
      fallbackImg.style.setProperty('-webkit-touch-callout', 'none');
      fallbackImg.style.setProperty('-webkit-user-drag', 'none');
      fallbackImg.style.setProperty('user-select', 'none');
      fallbackImg.style.width = '100%';
      fallbackImg.style.height = '100%';
      fallbackItem.style.display = 'block';
      fallbackItem.style.position = 'absolute';
      fallbackItem.style.inset = '0';
      fallbackItem.style.width = '100%';
      fallbackItem.style.height = '100%';
      fallbackItem.style.opacity = '1'; // no styleItem()/reveal pass has run on this item, so set directly rather than via the is-revealed class
      fallbackItem.style.transform = 'none'; // same reason - overriding the base CSS's default scale(0.8), which styleItem() would normally counteract via the is-revealed class
      return;
    }
  }

  // The repeat unit is the container's own rendered size, since every
  // item's position is a percentage/vw value resolved against it - so
  // offsetting the whole set by exactly one container-width makes the
  // pattern repeat with no seam. This is independent of boardScale,
  // which is a purely visual transform applied on top afterwards.
  // Defined before the first styleAllItems() call below, since
  // styleItem()'s spread calculation needs these already set.
  var CELL_W = root.clientWidth;
  var CELL_H = root.clientHeight;

  styleAllItems(originalContent);

  // Tablet and below, no fallback image yet for this breakpoint:
  // skip the whole animated system (no drag, no infinite tiling, no
  // continuous ambient movement) and just show the correctly
  // positioned static tiles instead. The animated version has
  // repeatedly crashed mobile Safari even after several rounds of
  // optimization, so rather than keep chasing performance on it,
  // tablet-down gets a guaranteed-stable fixed layout as its
  // fallback-of-the-fallback. Desktop is completely unaffected -
  // this returns before any of the drag/tiling code below ever runs.
  if (window.innerWidth <= 991) {
    originalContent.querySelectorAll('[data-board-reveal]').forEach(function (el) {
      setRevealed(el, true); // one-time reveal, not the continuous visibility polling the animated version uses
    });
    playVideosIn(originalContent);
    return;
  }

  var track = document.createElement('div');
  track.setAttribute('data-drag-canvas-track', '');
  track.style.cssText = 'position:absolute; inset:0; width:100%; height:100%; transform-origin:50% 50%;';
  root.insertBefore(track, originalContent);

  var currentRingsX = 0, currentRingsY = 0;
  var revealItems = null; // cached in buildGrid(), see updateReveal()
  var slots = [];

  function ringsNeeded() {
    // window sizes are divided by boardScale here because a scaled-up
    // track covers more on-screen area per cell, so fewer rings are
    // needed to fill the same viewport - matches how the initial
    // centering math below accounts for scale too.
    var s = config.boardScale;
    // Capped at MAX_RINGS regardless of viewport shape - on a narrow,
    // tall phone screen the uncapped math can call for enough ring
    // copies (each a full clone of all 13 items, video included) to
    // cause real memory pressure and crash mobile Safari. A lower
    // cap means the tiling may not perfectly cover an extreme aspect
    // ratio at the very edges, which is a much better trade than
    // crashing.
    var MAX_RINGS = 2;
    return {
      x: Math.min(MAX_RINGS, Math.max(1, Math.ceil((window.innerWidth / s) / CELL_W) + 1)),
      y: Math.min(MAX_RINGS, Math.max(1, Math.ceil((window.innerHeight / s) / CELL_H) + 1))
    };
  }

  function makeSlot(useOriginal) {
    var slotEl = document.createElement('div');
    slotEl.className = 'board-slot';
    slotEl.style.cssText = 'position:absolute; left:0; top:0; width:' + CELL_W + 'px; height:' + CELL_H + 'px; background-image:url(' + TEXTURE_URL + '); background-size:100% 100%;';
    var content = useOriginal ? originalContent : originalContent.cloneNode(true);
    if (!useOriginal) {
      styleAllItems(content);
      playVideosIn(content);
    }
    slotEl.appendChild(content);
    return slotEl;
  }

  function buildGrid(ringsX, ringsY) {
    currentRingsX = ringsX;
    currentRingsY = ringsY;
    track.innerHTML = '';
    slots = [];
    var spanX = (2 * ringsX + 1) * CELL_W;
    var spanY = (2 * ringsY + 1) * CELL_H;
    var usedOriginal = false;
    for (var ky = -ringsY; ky <= ringsY; ky++) {
      for (var kx = -ringsX; kx <= ringsX; kx++) {
        var isCenter = kx === 0 && ky === 0;
        var slotEl = makeSlot(isCenter && !usedOriginal);
        if (isCenter && !usedOriginal) usedOriginal = true;
        track.appendChild(slotEl);
        slots.push({ el: slotEl, offsetX: kx * CELL_W, offsetY: ky * CELL_H, spanX: spanX, spanY: spanY });
      }
    }
    // Cached once here instead of re-querying the DOM on every single
    // call to updateReveal() - with up to 25 cloned slots that query
    // would otherwise run 60 times a second, forever, while the
    // ambient drift is active.
    revealItems = track.querySelectorAll('[data-board-reveal]');
  }

  function repositionSlots(trackX, trackY) {
    for (var i = 0; i < slots.length; i++) {
      var s = slots[i];
      var screenX = trackX + s.offsetX;
      var bufferX = s.spanX / 2 + CELL_W;
      if (screenX < -bufferX) s.offsetX += s.spanX;
      else if (screenX > bufferX) s.offsetX -= s.spanX;

      var screenY = trackY + s.offsetY;
      var bufferY = s.spanY / 2 + CELL_H;
      if (screenY < -bufferY) s.offsetY += s.spanY;
      else if (screenY > bufferY) s.offsetY -= s.spanY;

      s.el.style.transform = 'translate3d(' + s.offsetX + 'px,' + s.offsetY + 'px,0)';
    }
  }

  function updateReveal() {
    var items = revealItems || [];
    var rootRect = root.getBoundingClientRect();
    var m = config.revealMargin;
    var left = rootRect.left - m, right = rootRect.right + m;
    var top = rootRect.top - m, bottom = rootRect.bottom + m;
    for (var i = 0; i < items.length; i++) {
      var el = items[i];
      var r = el.getBoundingClientRect();
      var visible = r.right > left && r.left < right && r.bottom > top && r.top < bottom;
      setRevealed(el, visible);
      if (visible) {
        var v = el.querySelector('.board-media-video video');
        if (v && v.paused) v.play().catch(function () {});
      }
    }
  }

  // ---- Proxy-smoothed drag (matches the prototype's tuned feel exactly) ----
  var draggable = null, throwTween = null, xTo, yTo;
  var proxy = document.createElement('div');
  proxy.style.cssText = 'position:absolute; top:0; left:0; width:1px; height:1px; visibility:hidden; pointer-events:none;';
  root.appendChild(proxy);
  InertiaPlugin.track(proxy, 'x,y');

  function forceEndDrag() {
    if (draggable && draggable.isDragging) draggable.endDrag();
  }
  window.addEventListener('pointerup', forceEndDrag);
  window.addEventListener('pointercancel', forceEndDrag);
  window.addEventListener('blur', forceEndDrag);
  document.addEventListener('visibilitychange', function () { if (document.hidden) forceEndDrag(); });

  function syncTrack() {
    var px = gsap.getProperty(proxy, 'x');
    var py = gsap.getProperty(proxy, 'y');
    xTo(px);
    yTo(py);
    var currentX = gsap.getProperty(track, 'x');
    var currentY = gsap.getProperty(track, 'y');
    repositionSlots(currentX, currentY);
    updateReveal();
  }

  function killThrowTween() {
    if (throwTween) { throwTween.kill(); throwTween = null; }
  }

  // Ambient drift direction - starts up-left, updates to match the
  // last drag's release direction (see onDragEnd) so it continues on
  // rather than resetting after every interaction.
  var driftDirX = -0.9, driftDirY = -0.45;
  (function normalizeDrift() {
    var len = Math.sqrt(driftDirX * driftDirX + driftDirY * driftDirY);
    driftDirX /= len; driftDirY /= len;
  })();

  function createDraggable() {
    if (draggable) draggable.kill();
    killThrowTween();
    xTo = gsap.quickTo(track, 'x', { duration: config.smoothDuration, ease: 'power3' });
    yTo = gsap.quickTo(track, 'y', { duration: config.smoothDuration, ease: 'power3' });

    draggable = Draggable.create(proxy, {
      trigger: root,
      type: 'x,y',
      inertia: false,
      cursor: 'grab',
      activeCursor: 'grabbing',
      dragClickables: false,
      onDragStart: function () { killThrowTween(); root.classList.add('is-dragging'); },
      onDrag: syncTrack,
      onDragEnd: function () {
        root.classList.remove('is-dragging');
        var vx = InertiaPlugin.getVelocity(proxy, 'x');
        var vy = InertiaPlugin.getVelocity(proxy, 'y');
        var speed = Math.sqrt(vx * vx + vy * vy);

        if (speed > 5) {
          driftDirX = vx / speed;
          driftDirY = vy / speed;
        }

        var maxSpeed = config.maxThrowSpeed;
        if (speed > maxSpeed && speed > 0) {
          var s = maxSpeed / speed;
          vx *= s; vy *= s;
        }
        throwTween = gsap.to(proxy, {
          inertia: { x: vx, y: vy, resistance: config.throwResistance },
          onUpdate: syncTrack,
          onComplete: function () { throwTween = null; updateReveal(); }
        });
      }
    })[0];
  }

  var initialRings = ringsNeeded();
  buildGrid(initialRings.x, initialRings.y);
  createDraggable();

  function applyScale() {
    gsap.set(track, { scale: config.boardScale });
  }
  applyScale();

  // Divided by boardScale for the same reason as ringsNeeded() above -
  // translate happens in track-local (pre-scale) units, and scale
  // multiplies the already-translated result, so centering math needs
  // to account for it or the board opens off-center.
  var initialX = (window.innerWidth / config.boardScale - CELL_W) / 2;
  var initialY = (window.innerHeight / config.boardScale - CELL_H) / 2;
  gsap.set(track, { x: initialX, y: initialY });
  gsap.set(proxy, { x: initialX, y: initialY });
  repositionSlots(initialX, initialY);
  updateReveal();
  playVideosIn(root);

  // Ambient auto-drift while nothing is being dragged or still
  // settling from a throw. Runs through the exact same proxy ->
  // syncTrack pipeline as manual dragging, so it stays in lockstep
  // with the tiling/reveal system for free.
  var driftFrameCount = 0;
  gsap.ticker.add(function () {
    if ((draggable && draggable.isDragging) || throwTween) return;
    var dt = gsap.ticker.deltaRatio(60) / 60;
    var px = gsap.getProperty(proxy, 'x');
    var py = gsap.getProperty(proxy, 'y');
    gsap.set(proxy, {
      x: px + driftDirX * config.driftSpeed * dt,
      y: py + driftDirY * config.driftSpeed * dt
    });
    xTo(px);
    yTo(py);
    var currentX = gsap.getProperty(track, 'x');
    var currentY = gsap.getProperty(track, 'y');
    repositionSlots(currentX, currentY); // every frame - needed for smooth visual movement
    // The reveal check involves a getBoundingClientRect() per tile
    // across every duplicated copy - up to a few hundred layout
    // reads. Doesn't need 60fps precision for a slow ambient drift,
    // so it only actually runs every 6th frame (~10fps) here,
    // instead of running forever at full frame rate.
    driftFrameCount++;
    if (driftFrameCount % 6 === 0) updateReveal();
  });

  window.addEventListener('resize', function () {
    CELL_W = root.clientWidth;
    CELL_H = root.clientHeight;
    var needed = ringsNeeded();
    if (needed.x > currentRingsX || needed.y > currentRingsY) {
      buildGrid(Math.max(needed.x, currentRingsX), Math.max(needed.y, currentRingsY));
      var currentX = gsap.getProperty(track, 'x');
      var currentY = gsap.getProperty(track, 'y');
      repositionSlots(currentX, currentY);
    }
    updateReveal();
  });
})();
