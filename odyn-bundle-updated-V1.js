(function(){
if(window.__ODYN_LR__)return;
window.__ODYN_LR__=true;
var wsUrl="wss://cdn.odyn.dev/p/mg7j/live";
var retryDelay=1000;
var failures=0;
var MAX_FAILURES=50;
function connect(){
var ws=new WebSocket(wsUrl);
ws.onmessage=function(e){
var data;
try{data=JSON.parse(e.data)}catch(err){return}
if(data.type!=="change")return;
if(data.cssOnly){
var links=document.querySelectorAll('link[href*="https://cdn.odyn.dev/staging/"]');
if(links.length===0){location.reload();return}
var bust="?t="+Date.now();
for(var i=0;i<links.length;i++){
(function(link){
try{
var next=link.cloneNode(true);
next.href=link.href.split("?")[0]+bust;
next.onload=function(){link.remove()};
link.parentNode.insertBefore(next,link.nextSibling);
}catch(e){}
})(links[i]);
}
return;
}
location.reload();
};
ws.onclose=function(e){
if(e&&e.code===4001)return;
failures++;
if(failures>=MAX_FAILURES)return;
setTimeout(connect,retryDelay);
retryDelay=Math.min(retryDelay*2,30000);
};
ws.onopen=function(){
retryDelay=1000;
failures=0;
};
}
connect();
})();
var OdynCode = (() => {
  // odyn:/config.js
  var SELECTORS = {
    // Shared CMS list primitives (filter + load more)
    list: '[fs-list-element="list"]',
    listWrap: ".w-dyn-list",
    item: ".w-dyn-item",
    // Load more
    loadMoreButton: ".cl-load-more-main",
    paginationNext: ".w-pagination-next",
    // Filter
    filterRoot: '[data-c="cl-filter"]',
    filterButton: ".filter-tab_parent",
    filterField: "[fs-list-field]",
    // Card hover
    card: ".cl-card-parent",
    cardBg: ".cl-card-bg",
    // List hover
    listTrigger: '[hover="list-view"]',
    listWipe: ".cl-list_wipe",
    listImage: ".cl-list_image-child"
  };
  var ATTR = {
    loading: "data-loading",
    filterHidden: "data-filter-hidden",
    hoverBound: "data-hover-bound"
  };
  var ACTIVE_CLASS = "is--active";

  // odyn:/cl-filter.js
  var normalize = (value) => (value || "").trim().toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  function initClFilter() {
    const root = document.querySelector(SELECTORS.filterRoot);
    if (!root) return null;
    const buttons = Array.from(root.querySelectorAll(SELECTORS.filterButton));
    const active = {};
    const collect = () => Array.from(root.querySelectorAll(SELECTORS.list)).flatMap(
      (list) => Array.from(list.querySelectorAll(`:scope > ${SELECTORS.item}`)).map((item) => {
        const fields = {};
        item.querySelectorAll(SELECTORS.filterField).forEach((el) => {
          const field = el.getAttribute("fs-list-field");
          const value = normalize(el.textContent);
          if (!field || !value) return;
          (fields[field] || (fields[field] = /* @__PURE__ */ new Set())).add(value);
        });
        return { item, fields };
      })
    );
    let itemData = collect();
    const activeCount = () => Object.values(active).reduce((sum, set) => sum + set.size, 0);
    const matches = ({ fields }) => Object.entries(active).every(([field, values]) => {
      if (values.size === 0) return true;
      const itemValues = fields[field];
      if (!itemValues) return false;
      for (const value of values) if (itemValues.has(value)) return true;
      return false;
    });
    const setVisible = (item, visible) => {
      item.style.display = visible ? "" : "none";
      item.toggleAttribute(ATTR.filterHidden, !visible);
    };
    // Stable sizes + row packing for the grid. Pattern by original DOM index:
    // small, medium, medium, small (3 + 5 columns = one full 8-col row).
    const SIZE_SPAN = { small: 3, medium: 5 };
    const layoutGrid = () => {
      const lists = new Set(itemData.map((d) => d.item.parentElement));
      lists.forEach((list) => {
        const cards = Array.from(list.querySelectorAll(`:scope > ${SELECTORS.card}`));
        if (!cards.length) return;
        // 1. size is set from the ORIGINAL position and never recomputed
        cards.forEach((card, i) => {
          if (!card.dataset.size) card.dataset.size = i % 4 === 1 || i % 4 === 2 ? "medium" : "small";
        });
        // 2. pack the visible cards into full rows, keeping original order where possible
        const pool = cards.filter((c) => !c.hasAttribute(ATTR.filterHidden));
        const used = new Set();
        const rows = [];
        pool.forEach((card) => {
          if (used.has(card)) return;
          used.add(card);
          const need = 8 - SIZE_SPAN[card.dataset.size];
          const mate = pool.find((c) => !used.has(c) && SIZE_SPAN[c.dataset.size] === need);
          if (mate) {
            used.add(mate);
            rows.push([card, mate]);
          } else {
            rows.push([card]);
          }
        });
        // full rows first (in original order), unpairable leftovers last
        const full = rows.filter((r) => r.length === 2);
        const rest = rows.filter((r) => r.length === 1);
        let n = 0;
        [...full, ...rest].forEach((r) => r.forEach((c) => { c.style.order = String(n++); }));
        cards.filter((c) => c.hasAttribute(ATTR.filterHidden)).forEach((c) => { c.style.order = ""; });
      });
    };
    const apply = () => {
      const showAll = activeCount() === 0;
      itemData.forEach((data) => setVisible(data.item, showAll || matches(data)));
      layoutGrid();
    };
    buttons.forEach((button) => {
      const field = button.getAttribute("fs-cmsfilter-field");
      const value = normalize(button.getAttribute("fs-cmsfilter-value"));
      if (!field || !value) return;
      button.addEventListener("click", (event) => {
        event.preventDefault();
        const set = active[field] || (active[field] = /* @__PURE__ */ new Set());
        if (button.classList.toggle(ACTIVE_CLASS)) set.add(value);
        else set.delete(value);
        apply();
      });
    });
    apply();
    return {
      refresh() {
        itemData = collect();
        apply();
      }
    };
  }

  // odyn:/lib/webflow-pagination.js
  async function fetchDoc(url) {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const html = await response.text();
    return new DOMParser().parseFromString(html, "text/html");
  }
  function readPage(doc, index) {
    const list = Array.from(doc.querySelectorAll(SELECTORS.list))[index];
    if (!list) return { items: [], nextHref: null };
    const items = Array.from(
      list.querySelectorAll(`:scope > ${SELECTORS.item}`)
    ).map((node) => document.importNode(node, true));
    const next = list.closest(SELECTORS.listWrap)?.querySelector(SELECTORS.paginationNext);
    return { items, nextHref: next ? next.getAttribute("href") : null };
  }

  // odyn:/cl-load-more.js
  function initClLoadMore({ onAppend } = {}) {
    const liveLists = Array.from(document.querySelectorAll(SELECTORS.list));
    document.querySelectorAll(SELECTORS.loadMoreButton).forEach((button) => {
      const list = button.closest(SELECTORS.listWrap)?.querySelector(SELECTORS.list);
      if (!list) return;
      bindButton(button, list, liveLists.indexOf(list), onAppend);
    });
  }
  function bindButton(button, list, index, onAppend) {
    button.addEventListener("click", async (event) => {
      event.preventDefault();
      if (button.hasAttribute(ATTR.loading)) return;
      const url = button.getAttribute("href");
      if (!url) return;
      button.setAttribute(ATTR.loading, "");
      try {
        const doc = await fetchDoc(url);
        const { items, nextHref } = readPage(doc, index);
        gsap.set(items, { autoAlpha: 0, y: 16 });
        items.forEach((node) => list.appendChild(node));
        if (nextHref) button.setAttribute("href", nextHref);
        else button.style.display = "none";
        onAppend?.(items, list);
        // onAppend refreshes the filter, so items the filter hides now carry
        // data-filter-hidden. Snap those to visible (so they show correctly if a
        // filter later reveals them) and only stagger the ones on screen.
        const hiddenItems = items.filter((item) => item.hasAttribute(ATTR.filterHidden));
        const shownItems = items.filter((item) => !item.hasAttribute(ATTR.filterHidden));
        gsap.set(hiddenItems, { autoAlpha: 1, y: 0 });
        gsap.to(shownItems, {
          autoAlpha: 1,
          y: 0,
          duration: 0.3,
          ease: "power2.out",
          // total stagger is capped at 0.25s however many items are appended
          stagger: { amount: 0.25 }
        });
        items.forEach((item) => {
          item.querySelectorAll("img").forEach((img) => {
            const isHidden = window.getComputedStyle(img.parentElement).transform.includes("matrix(0");
            if (!isHidden) img.decode?.().catch(() => {
            });
          });
        });
      } catch (error) {
        console.error("[cl-load-more] failed to load next page", error);
      } finally {
        button.removeAttribute(ATTR.loading);
      }
    });
  }

  // odyn:/animations/card-hover.js
  function bindCardHover(card) {
    const bg = card.querySelector(SELECTORS.cardBg);
    if (!bg) return;
    gsap.set(bg, { y: 0, force3D: true });
    const opts = { duration: 0.2, ease: "power1.inOut", force3D: true };
    let active;
    const hoverIn = () => {
      active?.kill();
      gsap.set(bg, { willChange: "transform" });
      active = gsap.timeline({ defaults: opts }).to(bg, { y: "1.2rem" });
    };
    const hoverOut = () => {
      active?.kill();
      active = gsap.timeline({ defaults: opts }).to(bg, { y: 0 }).call(() => gsap.set(bg, { clearProps: "willChange" }));
    };
    card.addEventListener("mouseenter", hoverIn);
    card.addEventListener("mouseleave", hoverOut);
  }
  function initCardHover(scope = document) {
    scope.querySelectorAll(`${SELECTORS.card}:not([${ATTR.hoverBound}])`).forEach((card) => {
      card.setAttribute(ATTR.hoverBound, "");
      bindCardHover(card);
    });
  }

  // odyn:/animations/list-hover.js
  var OVERSHOOT = "back.out(1.7)";
  function bindListHover(trigger) {
    if (trigger.hasAttribute(ATTR.hoverBound)) return () => {
    };
    trigger.setAttribute(ATTR.hoverBound, "");
    const wipe = trigger.querySelector(SELECTORS.listWipe);
    const image = trigger.querySelector(SELECTORS.listImage);
    const bg = trigger.querySelector(SELECTORS.cardBg);
    if (!wipe || !image || !bg) {
      trigger.removeAttribute(ATTR.hoverBound);
      return () => {
      };
    }
    gsap.set(image, { scale: 0, rotate: -10, transformOrigin: "50% 50%", force3D: true });
    gsap.set(bg, { rotate: 0, transformOrigin: "50% 50%", force3D: true });
    gsap.set(wipe, { height: "0%" });
    let active;
    const hoverIn = () => {
      active?.kill();
      gsap.set([image, bg], { willChange: "transform" });
      active = gsap.timeline().to(wipe, { height: "100%", duration: 0.3, ease: "power1.out" }, 0).to(image, { scale: 1, rotate: 0, duration: 0.3, ease: OVERSHOOT, force3D: true }, 0).to(bg, { rotate: 5, duration: 0.3, ease: OVERSHOOT, force3D: true }, 0.2);
    };
    const hoverOut = () => {
      active?.kill();
      active = gsap.timeline({ defaults: { duration: 0.3, ease: "power1.out", force3D: true } }).to(bg, { rotate: 0 }, 0).to(image, { scale: 0, rotate: -10 }, 0).to(wipe, { height: "0%" }, 0).call(() => gsap.set([image, bg], { clearProps: "willChange" }));
    };
    trigger.addEventListener("mouseenter", hoverIn);
    trigger.addEventListener("mouseleave", hoverOut);
    return () => {
      active?.kill();
      trigger.removeEventListener("mouseenter", hoverIn);
      trigger.removeEventListener("mouseleave", hoverOut);
      trigger.removeAttribute(ATTR.hoverBound);
    };
  }
  function initListHover(scope = document) {
    gsap.matchMedia().add("(min-width: 992px)", () => {
      const cleanups = [];
      scope.querySelectorAll(`${SELECTORS.listTrigger}:not([${ATTR.hoverBound}])`).forEach((trigger) => {
        cleanups.push(bindListHover(trigger));
      });
      return () => cleanups.forEach((fn) => fn());
    });
  }

  // odyn:/animations/view-toggle.js
  var VIEWS = ["grid", "list"];
  function initViewToggle({ initial = "grid" } = {}) {
    const stage = document.querySelector('[data-c="view-stage"]');
    const triggers = /* @__PURE__ */ new Map();
    const views = /* @__PURE__ */ new Map();
    VIEWS.forEach((key) => {
      const trigger = document.querySelector(`[data-c="${key}-trigger"]`);
      const view = document.querySelector(`[data-c="${key}-view"]`);
      if (trigger) triggers.set(key, trigger);
      if (view) views.set(key, view);
    });
    if (!stage || views.size < 2 || triggers.size < 2) {
      console.warn("[view-toggle] Missing required elements. Need stage, 2 views, and 2 triggers.");
      return null;
    }
    let current = initial;
    let busy = false;
    const setActive = (key) => triggers.forEach((el, name) => el.classList.toggle(ACTIVE_CLASS, name === key));
    const displayValues = /* @__PURE__ */ new Map();
    views.forEach((el, name) => {
      const computed = window.getComputedStyle(el);
      const display = computed.display !== "none" ? computed.display : "grid";
      displayValues.set(name, display);
    });
    views.forEach(
      (el, name) => gsap.set(el, name === current ? { autoAlpha: 1 } : { autoAlpha: 0, display: "none" })
    );
    setActive(current);
    const switchTo = (target) => {
      if (busy || target === current || !views.has(target)) return;
      busy = true;
      const from = views.get(current);
      const to = views.get(target);
      const toDisplay = displayValues.get(target) || "grid";
      // Skip items the filter has hidden so they don't pad out the stagger
      const items = to.querySelectorAll(`${SELECTORS.item}:not([${ATTR.filterHidden}])`);
      const tl = gsap.timeline({
        onComplete: () => {
          gsap.set(stage, { clearProps: "height" });
          busy = false;
        }
      });
      tl.set(stage, { height: stage.offsetHeight });
      tl.to(from, { autoAlpha: 0, y: 12, duration: 0.2, ease: "power2.in" });
      tl.set(from, { display: "none" });
      tl.set(to, { display: toDisplay, autoAlpha: 0, y: 0 });
      tl.set(items, { autoAlpha: 0, y: 12 });
      tl.to(stage, { height: () => to.offsetHeight, duration: 0.4, ease: "power3.inOut" });
      tl.to(to, { autoAlpha: 1, duration: 0.2 }, "<");
      // total stagger is capped at 0.25s however many items there are
      tl.to(items, { autoAlpha: 1, y: 0, duration: 0.3, ease: "power2.out", stagger: { amount: 0.25 } }, "<");
      current = target;
      setActive(target);
    };
    triggers.forEach((trigger, key) => {
      trigger.addEventListener("click", (event) => {
        event.preventDefault();
        switchTo(key);
      });
    });
    return {
      switchTo,
      get current() {
        return current;
      }
    };
  }

  // odyn:/index.js
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
  function init() {
    const clFilter = initClFilter();
    initCardHover();
    initListHover();
    initClLoadMore({
      onAppend: (newItems, list) => {
        clFilter?.refresh();
        initCardHover(list);
        initListHover(list);
      }
    });
    initViewToggle({ initial: "grid" });
    if (clFilter) window.clFilterController = clFilter;
  }
})();
