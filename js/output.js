import { GLRenderer } from './glRenderer.js';
import { renderContent } from './effects.js';
import { SyncChannel } from './channel.js';
import { idbGet } from './idb.js';

let glRenderer = null;
let channel = null;
let state = { surfaces: [], output: { width: 1920, height: 1080, background: '#000000' } };
let epoch = Date.now();

function init() {
  const canvas = document.getElementById('output-canvas');
  glRenderer = new GLRenderer(canvas);
  channel = new SyncChannel('output');

  fitCanvas(canvas);
  window.addEventListener('resize', () => fitCanvas(canvas));

  channel.on((msg) => {
    if (msg.type === 'state-update') {
      applyState(msg.payload);
      fitCanvas(canvas);
    }
  });

  channel.send('request-state', null);

  canvas.addEventListener('click', toggleFullscreen);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.fullscreenElement) document.exitFullscreen();
  });

  setTimeout(() => {
    const hint = document.getElementById('hint');
    if (hint) hint.classList.add('hidden');
  }, 4000);

  loop();
}

function fitCanvas(canvas) {
  const outW = state.output?.width  ?? 1920;
  const outH = state.output?.height ?? 1080;
  const aspect = outW / outH;
  const winW = window.innerWidth;
  const winH = window.innerHeight;
  let cw, ch;
  if (winW / winH > aspect) { ch = winH; cw = Math.round(ch * aspect); }
  else { cw = winW; ch = Math.round(cw / aspect); }
  canvas.width = cw; canvas.height = ch;
  canvas.style.width = cw + 'px'; canvas.style.height = ch + 'px';
}

function applyState(newState) {
  if (newState._epoch) epoch = newState._epoch;

  for (const s of newState.surfaces) {
    const prev = state.surfaces.find(p => p.id === s.id);
    const pc = prev?.content;

    // Carry over cached image
    if (pc?._img) s.content._img = pc._img;

    if (s.content.type === 'image' && s.content.src && !s.content._img) {
      const img = new Image();
      img.onload = () => { s.content._img = img; };
      img.src = s.content.src;
    }

    if (s.content.type === 'video') {
      const newVKey = s.content.videoKey ?? null;
      const prevVKey = pc?._videoKey ?? null;

      if (newVKey) {
        // Blob-based video (new format) — compare by videoKey
        if (pc?._video && prevVKey === newVKey) {
          s.content._video  = pc._video;
          s.content._videoKey = prevVKey;
          pc._video.loop  = s.content.loop  !== false;
          pc._video.muted = s.content.muted !== false;
        } else {
          if (pc?._video) { pc._video.pause(); pc._video.src = ''; }
          s.content._videoKey = newVKey;
          idbGet(newVKey).then(blob => {
            if (blob) loadVideo(s.content, URL.createObjectURL(blob));
          }).catch(() => {});
        }
      } else if (s.content.src) {
        // Legacy data-URL format — compare by first 120 chars
        const srcKey = s.content.src.slice(0, 120);
        if (pc?._video && pc._srcKey === srcKey) {
          s.content._video  = pc._video;
          s.content._srcKey = srcKey;
          pc._video.loop  = s.content.loop  !== false;
          pc._video.muted = s.content.muted !== false;
        } else {
          if (pc?._video) { pc._video.pause(); pc._video.src = ''; }
          s.content._srcKey = srcKey;
          loadVideo(s.content, s.content.src);
        }
      } else {
        // No video data yet
        if (pc?._video) { pc._video.pause(); pc._video.src = ''; }
      }
    }
  }

  state = newState;
}

function loadVideo(content, src) {
  if (!src) return;
  if (content._video) { content._video.pause(); content._video.src = ''; }
  const vid = document.createElement('video');
  vid.loop = content.loop !== false;
  vid.muted = content.muted !== false;
  vid.playsInline = true;
  vid.preload = 'auto';
  content._video = vid;
  vid.addEventListener('canplay', () => vid.play().catch(() => {}));
  vid.src = src;
  vid.load();
}

function loop() {
  const t = (Date.now() - epoch) / 1000;
  for (const surface of state.surfaces) {
    if (!surface.enabled) continue;
    glRenderer.uploadTexture(surface.id, renderContent(surface, t, state.output?.width ?? 1920, state.output?.height ?? 1080));
  }
  glRenderer.render(state, state.output?.background ?? '#000000');
  requestAnimationFrame(loop);
}

function toggleFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(() => {});
  } else {
    document.exitFullscreen();
  }
}

init();
