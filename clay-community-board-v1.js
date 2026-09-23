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

      // Image and Icon share the same physical <img> element (icons are
      // just images rendered with object-fit:contain), so this is ONE
      // element with ONE combined check - not two separate keys fighting
      // over the same node's display value.
      var imageEl = el.querySelector('.board-media-image');
      var videoEl = el.querySelector('.board-media-video');
      var quoteEl = el.querySelector('.board-media-quote');

      if (imageEl) {
        imageEl.style.display = (mediaType === 'image' || mediaType === 'icon') ? '' : 'none';
        if (mediaType === 'icon') {
          imageEl.style.objectFit = 'contain';
          imageEl.style.border = 'none';
        } else {
          imageEl.style.objectFit = '';
        }
      }
      if (videoEl) {
        videoEl.style.display = (mediaType === 'video') ? '' : 'none';
      }
      if (quoteEl) {
        quoteEl.style.display = (mediaType === 'quote') ? '' : 'none';
      }

      if (mediaType === 'video' && videoEl) {
        var videoTag = videoEl.tagName === 'VIDEO' ? videoEl : videoEl.querySelector('video');
        if (videoTag) {
          videoTag.loop = true;
          videoTag.muted = true;
          videoTag.setAttribute('playsinline', '');
          videoTag.setAttribute('muted', '');
          var p = videoTag.play();
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
