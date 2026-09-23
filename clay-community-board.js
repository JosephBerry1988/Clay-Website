(function () {
  var root = document.querySelector('.grid-board-parent');
  if (!root) return;

  function applyItemStyles() {
    var items = root.querySelectorAll('.board-media-item');
    items.forEach(function (el) {
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
      if (rotation) el.style.transform = 'rotate(' + rotation + ')';
      if (zIndex) el.style.zIndex = zIndex;
      if (borderColor) {
        el.style.setProperty('--board-border-color', borderColor);
        el.style.setProperty('--board-border-width', '20px');
      }

      var mediaType = (el.getAttribute('data-media-type') || '').toLowerCase();
      var subEls = {
        image: el.querySelector('.board-media-image'),
        icon: el.querySelector('.board-media-image'),
        video: el.querySelector('.board-media-video'),
        quote: el.querySelector('.board-media-quote')
      };
      Object.keys(subEls).forEach(function (key) {
        var node = subEls[key];
        if (!node) return;
        var show = key === mediaType;
        node.style.display = show ? '' : 'none';
      });

      if (mediaType === 'icon' && subEls.image) {
        subEls.image.style.objectFit = 'contain';
        subEls.image.style.border = 'none';
      }

      if (mediaType === 'video' && subEls.video) {
        var videoEl = subEls.video.tagName === 'VIDEO' ? subEls.video : subEls.video.querySelector('video');
        if (videoEl) {
          videoEl.loop = true;
          videoEl.muted = true;
          videoEl.setAttribute('playsinline', '');
          videoEl.setAttribute('muted', '');
          var p = videoEl.play();
          if (p && p.catch) p.catch(function () {});
        }
      }
    });
  }

  applyItemStyles();

  if (window.gsap && window.Draggable) {
    gsap.registerPlugin(Draggable, InertiaPlugin);
    root.style.cursor = 'grab';

    var track = document.createElement('div');
    track.setAttribute('data-drag-canvas-track', '');
    while (root.firstChild) track.appendChild(root.firstChild);
    root.appendChild(track);

    Draggable.create(track, {
      type: 'x,y',
      inertia: true,
      allowNativeTouchScrolling: false,
      onPress: function () { root.style.cursor = 'grabbing'; },
      onRelease: function () { root.style.cursor = 'grab'; }
    });
  }
})();
