/* ==========================================================================
   Clay Community — Interactive Map
   Vanilla JS, no dependencies. Drop in before </body>.

   Expects markup produced by Webflow:

   <div class="cmap" data-cmap>
     <div class="cmap__scaler">
       <div class="cmap__stage">
         <div class="cmap__border"></div>
         <div class="cmap__panel" data-cmap-panel>
           <div class="cmap__world" data-cmap-world>
             <img class="cmap__img" src="..." alt="">
             <div class="cmap__dots" data-cmap-dots>
               <!-- Collection Item, one per city -->
               <a class="cmap-dot"
                  data-city="New York" data-country="USA" data-region="North America"
                  data-x="32.72" data-y="38.58"
                  data-event="GTM x Clay Meetup" data-date="11 Jul 2026"
                  data-url="https://lu.ma/..." data-slug="new-york"></a>
             </div>
           </div>
           ... controls ...
         </div>
       </div>
     </div>
   </div>

   Public API: window.ClayMap.init() / instance.selectBySlug(slug)
   Events: 'cmap:select' fires on the root with { detail: item } when a dot
           or list row is clicked — hook your popup onto this.
   ========================================================================== */

(function () {
  "use strict";

  /* ---------------------------------------------------------------------
     Breakpoint modes. Every number is taken straight from the Figma boards:
     "Map" (1736 wide) and "Map Mobile" (478 wide).

     stage      the design canvas, scaled uniformly to the container width
     panel      the map viewport: size and its offset within the stage
     dot        dot diameter
     fit        share of the panel width the world occupies at zoom 1
     --------------------------------------------------------------------- */
  var MODES = {
    desktop: {
      stage: { w: 1736, h: 945 },
      panel: { x: 57, y: 78, w: 1600, h: 867, radius: 48 },
      dot: 13,
      fit: 0.92
    },
    mobile: {
      stage: { w: 478, h: 771 },  /* filter top to card bottom: 435 + 335.795 */
      panel: { x: 20, y: 52, w: 438, h: 365, radius: 24 },
      dot: 4.921,
      fit: 0.96,
      /* Stacked layout is fluid (1:1, never scaled). Without this flag fit()
         fell through to the desktop branch and scaled the stage by w / 478. */
      fluid: true,
      margin: 20,            /* matches .cmap__stage padding 0 20px */
      panelAspect: 438 / 365 /* board panel ratio */
    }
  };

  /* Below this width the stacked board applies — search under the map.
     991 is Webflow's tablet breakpoint, so it lines up with the Designer. */
  var MOBILE_MAX = 991;

  /* Discrete zoom stops rather than a continuous range. */
  var ZOOM_LEVELS = [1, 2, 3.2, 4.8];
  var MIN_ZOOM = ZOOM_LEVELS[0];
  var MAX_ZOOM = ZOOM_LEVELS[ZOOM_LEVELS.length - 1];
  var ZOOM_MS = 460;

  /* The lat/lng span the artwork covers. Overridden by
     window.ClayMapWorld.bounds when the world file supplies them, so the
     two can never drift apart. */
  var GEO = { lngMin: -180, lngMax: 180, latMax: 83, latMin: -58 };

  var ALL = "All Clubs";
  /* Region display order. Anything not listed is appended alphabetically. */
  var REGION_ORDER = ["North America", "Europe", "Asia", "Latam & Oceania"];

  function num(v, fallback) {
    var n = parseFloat(v);
    return isFinite(n) ? n : fallback;
  }

  function clamp(v, lo, hi) {
    return v < lo ? lo : v > hi ? hi : v;
  }

  function norm(s) {
    return (s || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim();
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  /* ---------------------------------------------------------------------- */

  function ClayMap(root) {
    this.root = root;
    this.panel = root.querySelector("[data-cmap-panel]");
    this.world = root.querySelector("[data-cmap-world]");
    this.scaler = root.querySelector(".cmap__scaler");
    this.stage = root.querySelector(".cmap__stage");
    this.tip = root.querySelector("[data-cmap-tip]");
    this.input = root.querySelector("[data-cmap-input]");
    this.results = root.querySelector("[data-cmap-results]");
    this.countEl = root.querySelector("[data-cmap-count]");
    this.filtersEl = root.querySelector("[data-cmap-filters]");

    if (!this.panel || !this.world) return;

    this.z = 1;
    this.zi = 0;
    this.tx = 0;
    this.ty = 0;
    this.region = ALL;
    this.query = "";
    this.active = null;

    this.applyMode(this.currentMode());
    this.injectWorld();
    this.hydrateFromSource();
    this.detachDots();
    this.detachSearch();
    this.readItems();
    this.placeDots();
    this.buildFilters();
    this.bindZoom();
    this.bindDrag();
    this.bindSearch();
    this.bindDots();
    this.render();
    this.applyTransform();
    this.bindResize();
    this.maybeCalibrate();
  }

  /* --- Breakpoint --------------------------------------------------------- */

  ClayMap.prototype.currentMode = function () {
    return window.innerWidth <= MOBILE_MAX ? "mobile" : "desktop";
  };

  /* Applies a board's geometry to the instance and writes it out as CSS
     custom properties, so the stylesheet and the JS can never disagree
     about the panel size. */
  ClayMap.prototype.applyMode = function (name) {
    var m = MODES[name] || MODES.desktop;
    this.mode = name;
    this.SW = m.stage.w;
    this.SH = m.stage.h;
    this.PW = m.panel.w;
    this.PH = m.panel.h;

    /* The world box, derived rather than hardcoded: fit a share of the panel
       width, keep true proportions, centre it. */
    var w = m.panel.w * m.fit;
    var h = w * ((GEO.latMax - GEO.latMin) / (GEO.lngMax - GEO.lngMin));
    this.WB = { x: (m.panel.w - w) / 2, y: (m.panel.h - h) / 2, w: w, h: h };

    var st = this.root.style;
    st.setProperty("--cmap-stage-w", m.stage.w + "px");
    st.setProperty("--cmap-stage-h", m.stage.h + "px");
    st.setProperty("--cmap-panel-x", m.panel.x + "px");
    st.setProperty("--cmap-panel-y", m.panel.y + "px");
    st.setProperty("--cmap-panel-w", m.panel.w + "px");
    st.setProperty("--cmap-panel-h", m.panel.h + "px");
    st.setProperty("--cmap-panel-r", m.panel.radius + "px");
    st.setProperty("--cmap-dot", m.dot + "px");

    this.root.setAttribute("data-cmap-mode", name);

    /* Published as variables rather than inline styles: the stylesheet then
       sizes the world layer whenever it appears, so it cannot end up
       full-bleed if injection and sizing happen in the wrong order. That
       mismatch is what threw the dot positions off. */
    st.setProperty("--cmap-world-x", this.WB.x + "px");
    st.setProperty("--cmap-world-y", this.WB.y + "px");
    st.setProperty("--cmap-world-w", this.WB.w + "px");
    st.setProperty("--cmap-world-h", this.WB.h + "px");
  };

  ClayMap.prototype.checkMode = function () {
    var next = this.currentMode();
    if (next === this.mode) return;
    this.applyMode(next);
    this.reset();
    this.placeDots();
    this.hideTip();
    this.applyTransform();
    this.fit();
  };

  /* --- World layer ------------------------------------------------------ */

  /* Webflow HTML embeds cap at 10,000 characters and the vector world is far
     larger, so it ships as a hosted file (clay-map-world.js) loaded before
     this one. Inject it only when the markup has not already supplied a world
     layer of its own, so a raster <img class="cmap__img"> in the embed still
     wins if that is what the page uses. */
  ClayMap.prototype.injectWorld = function () {
    if (!this.world) return;
    if (this.world.querySelector(".cmap__img")) return;

    var src = window.ClayMapWorld;
    if (!src || !src.svg) return;

    /* The artwork declares the lat/lng span it covers; trust it over the
       default so the two can never drift apart. */
    if (src.bounds) {
      GEO = src.bounds;
      this.applyMode(this.mode);
    }

    this.world.insertAdjacentHTML("afterbegin", src.svg);
  };

  /* The search card sits in the stage, not the panel. The panel clips to its
     own rounded bounds, and on the mobile board the card sits below it — so
     inside the panel it would simply be invisible. Older markup nests it in
     the panel, so move it out if we find it there. */
  ClayMap.prototype.detachSearch = function () {
    var card = this.root.querySelector(".cmap__search");
    if (!card || !this.stage) return;
    if (card.parentNode !== this.stage) this.stage.appendChild(card);
  };

  /* --- Data ------------------------------------------------------------- */

  /* Webflow can't put a Collection List inside an HTML Embed, so the static
     shell is one embed and the CMS emits a flat list of .cmap-src nodes from
     a Collection List elsewhere on the page. This copies those across into
     real dots inside the embed. If the dots were authored directly in the
     Designer instead, there is nothing to hydrate and this is a no-op. */
  ClayMap.prototype.hydrateFromSource = function () {
    var host = this.root.querySelector("[data-cmap-dots]");
    if (!host) return;

    var source =
      this.root.querySelector("[data-cmap-source]") ||
      document.querySelector("[data-cmap-source]");
    if (!source) return;

    /* Accept any descendant carrying data-city, not just .cmap-src. In
       Webflow the class only renders if a matching style exists, and the
       data node is identified by its bound attributes anyway. */
    var rows = source.querySelectorAll(".cmap-src, [data-city]");
    Array.prototype.forEach.call(rows, function (row) {
      var d = row.dataset;
      var hasXY = d.x !== undefined && d.x !== "" && d.y !== undefined && d.y !== "";
      var hasLL = d.lat !== undefined && d.lat !== "" && d.lng !== undefined && d.lng !== "";
      if (!hasXY && !hasLL) return;

      var dot = document.createElement("a");
      dot.className = "cmap-dot";
      Object.keys(row.dataset).forEach(function (k) {
        dot.dataset[k] = row.dataset[k];
      });
      if (row.dataset.url) dot.href = row.dataset.url;
      host.appendChild(dot);
    });

    /* The source list has done its job; keep it out of the layout and out
       of the accessibility tree. */
    source.setAttribute("hidden", "");
    source.style.display = "none";
  };


  ClayMap.prototype.readItems = function () {
    var self = this;
    var nodes = this.root.querySelectorAll(".cmap-dot");
    this.items = Array.prototype.map.call(nodes, function (node, i) {
      var d = node.dataset;
      var pos = self.resolvePosition(d);
      var item = {
        i: i,
        node: node,
        city: d.city || node.getAttribute("aria-label") || "",
        country: d.country || "",
        region: d.region || "",
        event: d.event || "",
        date: d.date || "",
        url: d.url || "",
        slug: d.slug || "",
        x: pos.x,
        y: pos.y
      };
      item.haystack = norm(item.city + " " + item.country + " " + item.region);
      node.cmapItem = item;
      return item;
    });

    /* Cities first, then country — matches the Figma list order. */
    this.items.sort(function (a, b) {
      return a.city.localeCompare(b.city);
    });
  };

  /* X/Y percentages win. Falls back to lat/lng if the CMS item only has
     coordinates — useful for bulk imports, then fine-tune with X/Y. */
  ClayMap.prototype.resolvePosition = function (d) {
    var x = num(d.x, null);
    var y = num(d.y, null);
    if (x !== null && y !== null) return { x: x, y: y };

    var lat = num(d.lat, null);
    var lng = num(d.lng, null);
    if (lat === null || lng === null) return { x: 50, y: 50 };

    /* Percentages of the panel, so they are interchangeable with hand-set
       Map X / Map Y values. */
    var fx = (lng - GEO.lngMin) / (GEO.lngMax - GEO.lngMin);
    var fy = (GEO.latMax - lat) / (GEO.latMax - GEO.latMin);
    return {
      x: ((this.WB.x + fx * this.WB.w) / this.PW) * 100,
      y: ((this.WB.y + fy * this.WB.h) / this.PH) * 100
    };
  };

  /* Dots are moved OUT of .cmap__world and into the panel. Anything inside a
     transformed, rasterised layer gets scaled as pixels when you zoom, which
     is what made them look soft. Sitting outside it, they are laid out by the
     browser at every zoom level and stay crisp. */
  ClayMap.prototype.detachDots = function () {
    var host = this.root.querySelector("[data-cmap-dots]");
    if (!host || !this.panel) return;
    if (host.parentNode !== this.panel) this.panel.appendChild(host);
    this.dotHost = host;
  };

  /* Position is recomputed from the current pan/zoom, in panel space. */
  ClayMap.prototype.placeDots = function () {
    var pw = this.PW;
    var ph = this.PH;
    this.items.forEach(function (it) {
      it.px = (it.x / 100) * pw;
      it.py = (it.y / 100) * ph;
      it.node.style.left = "0px";
      it.node.style.top = "0px";
    });
    this.positionDots();
  };

  ClayMap.prototype.positionDots = function () {
    var z = this.z;
    var tx = this.tx;
    var ty = this.ty;
    var half = 6.5; /* half of the 13px dot */
    this.items.forEach(function (it) {
      var x = tx + it.px * z - half;
      var y = ty + it.py * z - half;
      it.node.style.transform = "translate(" + x + "px," + y + "px)";
    });
  };

  /* --- Filters ---------------------------------------------------------- */

  ClayMap.prototype.regions = function () {
    var seen = {};
    this.items.forEach(function (it) {
      if (it.region) seen[it.region] = (seen[it.region] || 0) + 1;
    });
    var keys = Object.keys(seen);
    keys.sort(function (a, b) {
      var ia = REGION_ORDER.indexOf(a);
      var ib = REGION_ORDER.indexOf(b);
      if (ia === -1 && ib === -1) return a.localeCompare(b);
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    });
    return { keys: keys, counts: seen };
  };

  ClayMap.prototype.buildFilters = function () {
    if (!this.filtersEl) return;
    var self = this;
    var r = this.regions();
    var defs = [{ label: ALL, count: this.items.length }];
    r.keys.forEach(function (k) {
      defs.push({ label: k, count: r.counts[k] });
    });

    this.filtersEl.innerHTML = "";
    this.tagEls = defs.map(function (def) {
      var b = el("button", "cmap-tag");
      b.type = "button";
      b.appendChild(document.createTextNode(def.label + " "));
      b.appendChild(el("span", "cmap-tag__count", String(def.count)));
      b.dataset.region = def.label;
      b.addEventListener("click", function () {
        self.region = def.label;
        self.hideTip();
        self.render();
        if (self.region !== ALL) self.frameRegion();
        else self.reset();
      });
      self.filtersEl.appendChild(b);
      return b;
    });
  };

  /* --- Rendering -------------------------------------------------------- */

  ClayMap.prototype.matches = function (it) {
    if (this.region !== ALL && it.region !== this.region) return false;
    if (this.query && it.haystack.indexOf(this.query) === -1) return false;
    return true;
  };

  ClayMap.prototype.render = function () {
    var self = this;
    var visible = [];

    this.items.forEach(function (it) {
      var ok = self.matches(it);
      it.visible = ok;
      it.node.classList.toggle("is-muted", !ok);
      if (ok) visible.push(it);
    });

    if (this.tagEls) {
      this.tagEls.forEach(function (b) {
        b.classList.toggle("is-active", b.dataset.region === self.region);
      });
    }

    if (this.countEl) {
      this.countEl.textContent =
        "Showing " + visible.length + (visible.length === 1 ? " city" : " cities");
    }

    if (this.results) {
      this.results.innerHTML = "";
      if (!visible.length) {
        /* Clear the row template, or the leftover value from the previous
           render pushes the empty message into a second column. */
        this.results.style.gridTemplateRows = "";
        this.results.appendChild(el("p", "cmap__empty", "No cities found"));
      } else {
        /* Two balanced columns, filled top-to-bottom like the design. */
        var rows = Math.max(1, Math.ceil(visible.length / 2));
        this.results.style.gridTemplateRows = "repeat(" + rows + ", auto)";
        visible.forEach(function (it) {
          var b = el("button", "cmap-item");
          b.type = "button";
          b.appendChild(el("span", "cmap-item__city", it.city));
          b.appendChild(el("span", "cmap-item__country", it.country));
          if (self.active === it) b.classList.add("is-active");
          b.addEventListener("click", function () {
            self.select(it);
            /* Same two-step as the dots on mobile: reveal, then follow. */
            if (self.mode === "mobile" && !self.isShowing(it)) {
              self.showTip(it);
              return;
            }
            self.navigate(it);
          });
          b.addEventListener("mouseenter", function () {
            self.showTip(it);
          });
          b.addEventListener("mouseleave", function () {
            self.scheduleHide();
          });
          it.row = b;
          self.results.appendChild(b);
        });
      }
    }

    this.visible = visible;
  };

  /* --- Zoom & pan ------------------------------------------------------- */

  ClayMap.prototype.clampPan = function () {
    var minX = this.PW * (1 - this.z);
    var minY = this.PH * (1 - this.z);
    this.tx = clamp(this.tx, minX, 0);
    this.ty = clamp(this.ty, minY, 0);
  };

  ClayMap.prototype.applyTransform = function () {
    this.clampPan();
    this.world.style.transform =
      "translate(" + this.tx + "px," + this.ty + "px) scale(" + this.z + ")";
    if (this.items) this.positionDots();
    this.positionTip();
    if (this.zoomInBtn) this.zoomInBtn.disabled = this.zi >= ZOOM_LEVELS.length - 1;
    if (this.zoomOutBtn) this.zoomOutBtn.disabled = this.zi <= 0;
    this.syncTouchAction();
  };

  /* Fully zoomed out there is nothing to pan, so the panel hands every touch
     gesture back to the browser and the section scrolls like any other. Once
     zoomed in, pan-y keeps vertical scrolling while the map takes horizontal
     drags. Class-based, so the stylesheet stays the single source of truth. */
  ClayMap.prototype.syncTouchAction = function () {
    if (!this.panel) return;
    this.panel.classList.toggle("is-pannable", this.z > 1);
  };

  /* The world scales while the dots translate, so a CSS transition on each
     would drift apart mid-flight. One rAF loop drives both from the same
     eased value, which keeps them locked together. */
  ClayMap.prototype.animateTo = function (z, tx, ty) {
    var self = this;
    if (this.raf) cancelAnimationFrame(this.raf);

    var z0 = this.z;
    var x0 = this.tx;
    var y0 = this.ty;
    var t0 = performance.now();

    var reduced =
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (reduced) {
      this.z = z;
      this.tx = tx;
      this.ty = ty;
      this.applyTransform();
      return;
    }

    function ease(t) {
      return 1 - Math.pow(1 - t, 3);
    }

    function frame(now) {
      var t = Math.min((now - t0) / ZOOM_MS, 1);
      var e = ease(t);
      self.z = z0 + (z - z0) * e;
      self.tx = x0 + (tx - x0) * e;
      self.ty = y0 + (ty - y0) * e;
      self.applyTransform();
      if (t < 1) self.raf = requestAnimationFrame(frame);
      else self.raf = null;
    }

    this.raf = requestAnimationFrame(frame);
  };

  /* Step to a zoom stop, keeping the centre of the panel fixed. */
  ClayMap.prototype.zoomToIndex = function (index) {
    var i = clamp(index, 0, ZOOM_LEVELS.length - 1);
    if (i === this.zi) return;
    var z2 = ZOOM_LEVELS[i];
    var ratio = z2 / this.z;
    var cx = this.PW / 2;
    var cy = this.PH / 2;
    var tx = cx - (cx - this.tx) * ratio;
    var ty = cy - (cy - this.ty) * ratio;

    /* Clamp the destination now, so the animation lands where it will rest
       rather than overshooting and snapping back on the final frame. */
    tx = clamp(tx, this.PW * (1 - z2), 0);
    ty = clamp(ty, this.PH * (1 - z2), 0);

    this.zi = i;
    this.animateTo(z2, tx, ty);
  };

  ClayMap.prototype.reset = function () {
    this.zi = 0;
    this.animateTo(ZOOM_LEVELS[0], 0, 0);
  };

  ClayMap.prototype.bindZoom = function () {
    var self = this;
    this.zoomInBtn = this.root.querySelector("[data-cmap-zoom-in]");
    this.zoomOutBtn = this.root.querySelector("[data-cmap-zoom-out]");

    if (this.zoomInBtn) {
      this.zoomInBtn.addEventListener("click", function () {
        self.zoomToIndex(self.zi + 1);
      });
    }
    if (this.zoomOutBtn) {
      this.zoomOutBtn.addEventListener("click", function () {
        self.zoomToIndex(self.zi - 1);
      });
    }

    /* Zoom is deliberately button-only. No wheel or pinch handler is bound,
       so scrolling over the map scrolls the page as normal. */
  };

  /* Screen → panel coordinates, accounting for the stage scale. */
  ClayMap.prototype.toPanel = function (clientX, clientY) {
    var r = this.panel.getBoundingClientRect();
    var s = r.width / this.PW;
    return { x: (clientX - r.left) / s, y: (clientY - r.top) / s };
  };

  ClayMap.prototype.bindDrag = function () {
    var self = this;
    var dragging = false;
    var moved = false;
    var captured = false;
    var touchPointer = false;
    var startX = 0;
    var startY = 0;
    var originTx = 0;
    var originTy = 0;
    var scale = 1;
    var DRAG_THRESHOLD = 4;

    /* Anything in the control layer is not a drag surface. */
    function inControls(target) {
      return !!(
        target &&
        target.closest &&
        target.closest(".cmap__zoom, .cmap__search, .cmap__tip, .cmap__cal")
      );
    }

    this.panel.addEventListener("pointerdown", function (e) {
      if (e.button !== 0) return;
      /* Reset before the controls check — otherwise a click on a button
         straight after a map drag would still be treated as a drag end. */
      moved = false;
      captured = false;
      if (inControls(e.target)) return;
      /* Touch, fully zoomed out: the gesture belongs to the page. */
      if ((e.pointerType === "touch" || e.pointerType === "pen") && self.z <= 1) return;
      if (self.raf) {
        cancelAnimationFrame(self.raf);
        self.raf = null;
      }
      dragging = true;
      touchPointer = e.pointerType === "touch" || e.pointerType === "pen";
      var r = self.panel.getBoundingClientRect();
      scale = r.width / self.PW;
      startX = e.clientX;
      startY = e.clientY;
      originTx = self.tx;
      originTy = self.ty;
      /* Deliberately NOT capturing the pointer yet. Capturing here would
         retarget the pointerup to the panel and stop buttons and dots from
         ever producing a click. Capture happens on the first real move. */
    });

    this.panel.addEventListener("pointermove", function (e) {
      if (!dragging) return;
      var dx = (e.clientX - startX) / scale;
      var dy = (e.clientY - startY) / scale;

      if (!moved) {
        if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
        /* A touch that sets off mostly downward is the user scrolling the
           page, not panning the map. Bow out and let the browser have it. */
        if (touchPointer && Math.abs(dy) > Math.abs(dx)) {
          dragging = false;
          return;
        }
        moved = true;
        self.panel.classList.add("is-dragging");
        try {
          self.panel.setPointerCapture(e.pointerId);
          captured = true;
        } catch (err) {}
      }

      self.tx = originTx + dx;
      self.ty = originTy + dy;
      self.applyTransform();
    });

    function end(e) {
      if (!dragging) return;
      dragging = false;
      self.panel.classList.remove("is-dragging");
      if (captured) {
        try {
          self.panel.releasePointerCapture(e.pointerId);
        } catch (err) {}
        captured = false;
      }
      if (moved) self.hideTip();
    }

    this.panel.addEventListener("pointerup", end);
    this.panel.addEventListener("pointercancel", end);

    this.panel.addEventListener(
      "click",
      function (e) {
        if (moved) {
          e.stopPropagation();
          e.preventDefault();
          moved = false;
        }
      },
      true
    );
  };

  ClayMap.prototype.frameRegion = function () {
    var vis = this.items.filter(function (it) {
      return it.visible;
    });
    if (!vis.length) return;

    var pw = this.PW;
    var ph = this.PH;
    var xs = vis.map(function (i) { return (i.x / 100) * pw; });
    var ys = vis.map(function (i) { return (i.y / 100) * ph; });
    var minX = Math.min.apply(null, xs);
    var maxX = Math.max.apply(null, xs);
    var minY = Math.min.apply(null, ys);
    var maxY = Math.max.apply(null, ys);

    var pad = 140;
    var w = Math.max(maxX - minX + pad * 2, 200);
    var h = Math.max(maxY - minY + pad * 2, 200);
    var fit = Math.min(this.PW / w, this.PH / h);

    /* Snap to the largest stop that still fits, so framing never lands on an
       off-stop zoom the buttons couldn't then step away from. */
    var i = 0;
    for (var n = 0; n < ZOOM_LEVELS.length; n++) {
      if (ZOOM_LEVELS[n] <= fit) i = n;
    }
    var z = ZOOM_LEVELS[i];

    var cx = (minX + maxX) / 2;
    var cy = (minY + maxY) / 2;
    var tx = clamp(this.PW / 2 - cx * z, this.PW * (1 - z), 0);
    var ty = clamp(this.PH / 2 - cy * z, this.PH * (1 - z), 0);

    this.zi = i;
    this.animateTo(z, tx, ty);
  };

  ClayMap.prototype.flyTo = function (it, index) {
    var i = clamp(index == null ? ZOOM_LEVELS.length - 1 : index, 0, ZOOM_LEVELS.length - 1);
    var z = ZOOM_LEVELS[i];
    var tx = clamp(this.PW / 2 - (it.x / 100) * this.PW * z, this.PW * (1 - z), 0);
    var ty = clamp(this.PH / 2 - (it.y / 100) * this.PH * z, this.PH * (1 - z), 0);
    this.zi = i;
    this.animateTo(z, tx, ty);
  };

  /* --- Tooltip ---------------------------------------------------------- */

  ClayMap.prototype.fillTip = function (it) {
    if (!this.tip) return;
    var set = function (sel, value, host) {
      var n = host.querySelector(sel);
      if (n) n.textContent = value || "";
    };
    set("[data-cmap-tip-city]", it.city, this.tip);
    set("[data-cmap-tip-country]", it.country, this.tip);
    set("[data-cmap-tip-event]", it.event, this.tip);
    set("[data-cmap-tip-date]", it.date, this.tip);

    var link = this.tip.querySelector("[data-cmap-tip-link]");
    if (link) {
      link.href = it.url || "#";
      link.style.display = it.url ? "" : "none";
    }
  };

  /* The tooltip is a pure hover state. It has no pinned or sticky mode —
     that is what used to leave it stranded after a search selection. */
  ClayMap.prototype.showTip = function (it) {
    if (!this.tip || !it) return;
    this.cancelHide();
    this.tipItem = it;
    this.fillTip(it);
    this.tip.classList.add("is-visible");
    this.positionTip();
  };

  ClayMap.prototype.hideTip = function () {
    if (!this.tip) return;
    this.cancelHide();
    this.tipItem = null;
    this.tip.classList.remove("is-visible");
  };

  /* A short grace period so the pointer can cross the gap between a dot and
     the card without the card vanishing underneath it. */
  ClayMap.prototype.scheduleHide = function () {
    var self = this;
    this.cancelHide();
    this.hideTimer = setTimeout(function () {
      self.hideTip();
    }, 160);
  };

  ClayMap.prototype.cancelHide = function () {
    if (this.hideTimer) {
      clearTimeout(this.hideTimer);
      this.hideTimer = null;
    }
  };

  ClayMap.prototype.navigate = function (it) {
    if (!it || !it.url) return false;
    window.open(it.url, "_blank", "noopener");
    return true;
  };

  ClayMap.prototype.isShowing = function (it) {
    return this.tipItem === it && this.tip &&
      this.tip.classList.contains("is-visible");
  };

  /* The card sits outside the transformed world so it never scales.
     Offset matches Figma: card top-left is (-7, +10) from the dot centre. */
  ClayMap.prototype.positionTip = function () {
    if (!this.tip || !this.tipItem) return;
    var it = this.tipItem;
    var px = this.tx + (it.x / 100) * this.PW * this.z;
    var py = this.ty + (it.y / 100) * this.PH * this.z;

    var w = this.tip.offsetWidth || 259;
    var h = this.tip.offsetHeight || 119;

    var left = px - 7;
    var top = py + 10;

    if (left + w > this.PW - 16) left = px + 7 - w;
    if (top + h > this.PH - 16) top = py - 10 - h;
    left = clamp(left, 16, this.PW - w - 16);
    top = clamp(top, 16, this.PH - h - 16);

    this.tip.style.transform = "translate(" + left + "px," + top + "px)";
  };

  /* --- Interaction ------------------------------------------------------ */

  ClayMap.prototype.bindDots = function () {
    var self = this;

    this.items.forEach(function (it) {
      it.node.addEventListener("mouseenter", function () {
        self.showTip(it);
      });
      it.node.addEventListener("mouseleave", function () {
        self.scheduleHide();
      });
      it.node.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        self.select(it);

        /* Mobile has no hover, so the first tap reveals the card and the
           second (on the card itself) follows the link. Desktop has already
           shown the card on hover, so the dot links straight through. */
        if (self.mode === "mobile" && !self.isShowing(it)) {
          self.showTip(it);
          return;
        }
        self.navigate(it);
      });
    });

    if (this.tip) {
      this.tip.addEventListener("mouseenter", function () {
        self.cancelHide();
      });
      this.tip.addEventListener("mouseleave", function () {
        self.scheduleHide();
      });
      this.tip.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        self.navigate(self.tipItem);
      });
    }

    /* A tap anywhere else dismisses the card on touch. */
    document.addEventListener("pointerdown", function (e) {
      if (self.mode !== "mobile") return;
      if (!self.tipItem) return;
      if (e.target.closest && e.target.closest(".cmap__tip, .cmap-dot, .cmap-item")) return;
      self.hideTip();
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") self.hideTip();
    });
  };

  /* Selecting marks the city and fires the event for the popup. It does not
     zoom and does not open the tooltip — the tooltip is hover-only. */
  ClayMap.prototype.select = function (it) {
    this.active = it;

    if (this.results) {
      Array.prototype.forEach.call(
        this.results.querySelectorAll(".cmap-item"),
        function (n) {
          n.classList.remove("is-active");
        }
      );
      if (it.row) it.row.classList.add("is-active");
    }

    this.items.forEach(function (o) {
      o.node.classList.toggle("is-active", o === it);
    });

    /* Hook your popup here — see the setup notes. */
    this.root.dispatchEvent(
      new CustomEvent("cmap:select", {
        bubbles: true,
        detail: {
          city: it.city,
          country: it.country,
          region: it.region,
          event: it.event,
          date: it.date,
          url: it.url,
          slug: it.slug,
          node: it.node
        }
      })
    );
  };

  ClayMap.prototype.selectBySlug = function (slug) {
    var found = this.items.filter(function (i) {
      return i.slug === slug;
    })[0];
    if (found) this.select(found);
    return !!found;
  };

  /* --- Search ----------------------------------------------------------- */

  ClayMap.prototype.bindSearch = function () {
    if (!this.input) return;
    var self = this;
    var t;

    this.input.addEventListener("input", function () {
      clearTimeout(t);
      t = setTimeout(function () {
        self.query = norm(self.input.value);
        self.render();
      }, 60);
    });

    this.input.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && self.visible && self.visible.length) {
        e.preventDefault();
        self.select(self.visible[0]);
      }
      if (e.key === "Escape") {
        self.input.value = "";
        self.query = "";
        self.render();
      }
    });
  };

  /* --- Responsive scaling ---------------------------------------------- */

  /* The stage is a fixed 1736 x 945 design canvas scaled uniformly to the
     width of whatever container it sits in. That is what keeps every Figma
     measurement exact at any size. It scales UP as well as down, so the
     component always fills its container rather than stopping at the design
     width and leaving a gap on wide screens.
     Cap it if you ever need to: --cmap-max-scale on .cmap. */
  ClayMap.prototype.fit = function () {
    if (!this.stage || !this.scaler) return;

    var w = this.root.clientWidth || this.SW;
    if (!w) return;

    var m = MODES[this.mode] || MODES.desktop;

    if (m.fluid) {
      this.fitFluid(w, m);
      return;
    }

    var s = w / this.SW;
    var max = parseFloat(
      getComputedStyle(this.root).getPropertyValue("--cmap-max-scale")
    );
    if (isFinite(max) && max > 0) s = Math.min(s, max);

    this.scale = s;
    this.stage.style.transform = "scale(" + s + ")";
    this.scaler.style.height = this.SH * s + "px";

    /* The filter row and the search card counter-scale by this, so they hold
       their true size while the map shrinks with the board. */
    this.root.style.setProperty("--cmap-inv-scale", 1 / s);
  };

  /* Fluid layout: nothing is scaled, so type and controls keep their true
     sizes at every width. The panel takes the container minus the board's
     margins and holds the board's aspect ratio; the world box and every dot
     are re-derived from the new panel size. */
  ClayMap.prototype.fitFluid = function (w, m) {
    /* The stacked layout lays itself out in normal flow, so all this needs
       to do is give the panel its height and re-derive anything measured in
       panel pixels. No tops are computed, so nothing can overlap. */
    var panelW = Math.max(w - m.margin * 2, 200);
    var panelH = panelW / m.panelAspect;

    this.scale = 1;
    this.SW = w;
    this.PW = panelW;
    this.PH = panelH;

    var ww = panelW * m.fit;
    var wh = ww * ((GEO.latMax - GEO.latMin) / (GEO.lngMax - GEO.lngMin));
    this.WB = { x: (panelW - ww) / 2, y: (panelH - wh) / 2, w: ww, h: wh };

    var st = this.root.style;
    st.setProperty("--cmap-panel-w", panelW + "px");
    st.setProperty("--cmap-panel-h", panelH + "px");
    st.setProperty("--cmap-inv-scale", 1);
    st.setProperty("--cmap-world-x", this.WB.x + "px");
    st.setProperty("--cmap-world-y", this.WB.y + "px");
    st.setProperty("--cmap-world-w", this.WB.w + "px");
    st.setProperty("--cmap-world-h", this.WB.h + "px");

    /* The board draws 4.921px dots on a 438px panel, which is too small to
       hit with a finger. Scale with the panel, then enlarge and clamp: the
       ::after in the stylesheet extends the hit area further still. */
    var dot = m.dot * (panelW / m.panel.w) * 1.8;
    st.setProperty("--cmap-dot", Math.max(11, Math.min(18, dot)) + "px");

    this.stage.style.transform = "none";
    this.scaler.style.height = "";

    if (this.items) {
      this.clampPan();
      this.placeDots();
      this.applyTransform();
    }
  };

  ClayMap.prototype.bindResize = function () {
    var self = this;
    this.fit();

    window.addEventListener("resize", function () {
      self.checkMode();
      self.fit();
    });
    if (window.ResizeObserver) {
      new ResizeObserver(function () {
        self.fit();
      }).observe(this.root);
    } else {
      window.addEventListener("resize", function () {
        self.fit();
      });
    }
  };

  /* --- Calibration helper (?cmapcal=1) ---------------------------------- */

  ClayMap.prototype.maybeCalibrate = function () {
    if (!/[?&]cmapcal=1/.test(window.location.search)) return;
    var self = this;
    var box = el("div", "cmap__cal", "Click the map to copy X / Y");
    this.panel.appendChild(box);

    this.panel.addEventListener("click", function (e) {
      var p = self.toPanel(e.clientX, e.clientY);
      var wx = (p.x - self.tx) / self.z;
      var wy = (p.y - self.ty) / self.z;
      var x = ((wx / self.PW) * 100).toFixed(2);
      var y = ((wy / self.PH) * 100).toFixed(2);
      box.textContent = "X: " + x + "\nY: " + y + "\n(copied)";
      if (navigator.clipboard) navigator.clipboard.writeText(x + "\t" + y);
    });
  };

  /* ---------------------------------------------------------------------- */

  var api = {
    instances: [],
    init: function (scope) {
      var roots = (scope || document).querySelectorAll("[data-cmap]");
      Array.prototype.forEach.call(roots, function (r) {
        if (r.cmapReady) return;
        r.cmapReady = true;
        api.instances.push(new ClayMap(r));
      });
      return api.instances;
    }
  };

  window.ClayMap = api;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      api.init();
    });
  } else {
    api.init();
  }
})();
