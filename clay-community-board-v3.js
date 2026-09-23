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
    revealMargin: 0
  };

  var TEXTURE_URL = 'https://cdn.prod.website-files.com/61477f2c24a826836f969afe/6ab4207d84f7757cd95ed6d1_Community%20Hero.avif';

  // ---- Style every item from its CMS-bound data attributes ----
  // Rotation goes through a CSS variable (--item-rotation) rather than
  // being written directly into el.style.transform, because the reveal
  // system below also needs to animate a scale on the same element -
  // this lets CSS compose "rotate(var(--item-rotation)) scale(...)" in
  // one place instead of two different bits of JS fighting over one
  // transform string.
  function styleItem(el) {
    if (el.__styled) return;
    el.__styled = true;

    var left = el.getAttribute('data-position-left');
    var top = el.getAttribute('data-position-top');
    var right = el.getAttribute('data-position-right');
    var bottom = el.getAttribute('data-position-bottom');
    var width = el.getAttribute('data-width');
    var height = el.getAttribute('data-height');
    var rotation = el.getAttribute('data-rotation');
    var zIndex = el.getAttribute('data-z-index');
    var borderColor = el.getAttribute('data-border-color');

    el.style.left = left || 'auto';
    el.style.top = top || 'auto';
    el.style.right = right || 'auto';
    el.style.bottom = bottom || 'auto';
    if (width) el.style.width = width;
    if (height) el.style.height = height;
    el.style.setProperty('--item-rotation', rotation || '0deg');
    if (zIndex) el.style.zIndex = zIndex;
    if (borderColor) {
      el.style.setProperty('--board-border-color', borderColor);
      el.style.setProperty('--board-border-width', '20px');
    }

    var mediaType = (el.getAttribute('data-media-type') || '').toLowerCase();
    var imageEl = el.querySelector('.board-media-image');
    var videoEl = el.querySelector('.board-media-video');
    var quoteEl = el.querySelector('.board-media-quote');

    if (imageEl) {
      imageEl.style.display = (mediaType === 'image' || mediaType === 'icon') ? '' : 'none';
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
  styleAllItems(originalContent);

  // The repeat unit is the container's own rendered size, since every
  // item's position is a percentage/vw value resolved against it - so
  // offsetting the whole set by exactly one container-width makes the
  // pattern repeat with no seam, no separate mobile-scale hack needed
  // (percentages already scale with the viewport on their own).
  var CELL_W = root.clientWidth;
  var CELL_H = root.clientHeight;

  var track = document.createElement('div');
  track.setAttribute('data-drag-canvas-track', '');
  track.style.cssText = 'position:absolute; inset:0; width:100%; height:100%;';
  root.insertBefore(track, originalContent);

  var currentRingsX = 0, currentRingsY = 0;
  var slots = [];

  function ringsNeeded() {
    return {
      x: Math.max(1, Math.ceil(window.innerWidth / CELL_W) + 1),
      y: Math.max(1, Math.ceil(window.innerHeight / CELL_H) + 1)
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
    var items = track.querySelectorAll('[data-board-reveal]');
    var rootRect = root.getBoundingClientRect();
    var m = config.revealMargin;
    var left = rootRect.left - m, right = rootRect.right + m;
    var top = rootRect.top - m, bottom = rootRect.bottom + m;
    for (var i = 0; i < items.length; i++) {
      var el = items[i];
      var r = el.getBoundingClientRect();
      var visible = r.right > left && r.left < right && r.bottom > top && r.top < bottom;
      el.classList.toggle('is-revealed', visible);
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
        var maxSpeed = config.maxThrowSpeed;
        if (speed > maxSpeed && speed > 0) {
          var scale = maxSpeed / speed;
          vx *= scale; vy *= scale;
        }
        throwTween = gsap.to(proxy, {
          inertia: { x: vx, y: vy, resistance: config.throwResistance },
          onUpdate: syncTrack,
          onComplete: updateReveal
        });
      }
    })[0];
  }

  var initialRings = ringsNeeded();
  buildGrid(initialRings.x, initialRings.y);
  createDraggable();

  var initialX = (window.innerWidth - CELL_W) / 2;
  var initialY = (window.innerHeight - CELL_H) / 2;
  gsap.set(track, { x: initialX, y: initialY });
  gsap.set(proxy, { x: initialX, y: initialY });
  repositionSlots(initialX, initialY);
  updateReveal();
  playVideosIn(root);

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
