import { GLRenderer } from './glRenderer.js';
import { renderContent, EFFECTS, EFFECT_KEYS } from './effects.js';
import { SyncChannel } from './channel.js';
import { dist, pointInQuad } from './math.js';
import { idbSet, idbGet } from './idb.js';

// ── State ────────────────────────────────────────────────────────────────────

let state = {
  surfaces: [],
  nextId: 1,
  selectedId: null,
  selectedIds: new Set(),
  output: { width: 1920, height: 1080, background: '#000000' },
  showGrid: false,
  snap: false,
  projectName: null,
};

let glRenderer = null;
let overlayCtx = null;
let channel = null;
let animFrame = null;
const startEpoch = Date.now(); // absolute epoch shared with output

let clipboard = null; // copied surface data
const undoStack = [];
const MAX_UNDO = 50;

// Drag state
let drag = null;
let hoveredCorner = null; // { surfaceId, cornerIdx }
let hoveredEdge = null;   // { surfaceId, edgeIdx }

// Preview canvas scaling
let previewScale = 1;
let previewOffX = 0;
let previewOffY = 0;

// ── Init ─────────────────────────────────────────────────────────────────────

async function init() {
  channel = new SyncChannel('editor');

  const glCanvas = document.getElementById('preview-gl');
  const overlay = document.getElementById('preview-overlay');
  overlayCtx = overlay.getContext('2d');

  glRenderer = new GLRenderer(glCanvas);
  setupCanvasSize(glCanvas, overlay);
  window.addEventListener('resize', () => setupCanvasSize(glCanvas, overlay));

  bindOverlayEvents(overlay);
  bindToolbar();
  bindLayerPanel();

  // Restore autosave, or start with a default surface
  const restored = await loadAutosave();
  if (!restored) addSurface();
  else { renderLayers(); renderProperties(); }

  // Listen for output pings (output requesting state)
  channel.on((msg) => {
    if (msg.type === 'request-state') broadcastState();
  });

  loop();
}

function setupCanvasSize(glCanvas, overlay) {
  const area = document.getElementById('canvas-area');
  const areaW = area.clientWidth - 40;
  const areaH = area.clientHeight - 60;
  const aspect = state.output.width / state.output.height;

  let cw, ch;
  if (areaW / areaH > aspect) { ch = areaH; cw = ch * aspect; }
  else { cw = areaW; ch = cw / aspect; }

  cw = Math.floor(cw); ch = Math.floor(ch);
  glCanvas.width = cw; glCanvas.height = ch;
  glCanvas.style.width = cw + 'px'; glCanvas.style.height = ch + 'px';
  overlay.width = cw; overlay.height = ch;
  overlay.style.width = cw + 'px'; overlay.style.height = ch + 'px';

  const wrapper = document.getElementById('canvas-wrapper');
  wrapper.style.width = cw + 'px'; wrapper.style.height = ch + 'px';

  previewScale = cw / state.output.width;
}

// ── Render Loop ───────────────────────────────────────────────────────────────

function loop() {
  const t = (Date.now() - startEpoch) / 1000;

  // Upload textures for all surfaces
  for (const surface of state.surfaces) {
    if (!surface.enabled) continue;
    const contentCanvas = renderContent(surface, t, state.output.width, state.output.height);
    glRenderer.uploadTexture(surface.id, contentCanvas);
  }

  // Render WebGL
  glRenderer.render(state, state.output.background);

  // Draw overlay (handles, outlines)
  drawOverlay(t);

  animFrame = requestAnimationFrame(loop);
}

// ── Overlay Drawing ───────────────────────────────────────────────────────────

function drawOverlay(t) {
  const ctx = overlayCtx;
  const W = ctx.canvas.width, H = ctx.canvas.height;
  ctx.clearRect(0, 0, W, H);

  if (state.showGrid) drawGrid(ctx, W, H);

  for (const surface of state.surfaces) {
    if (!surface.enabled) continue;
    const isSelected = surface.id === state.selectedId;
    const isInSelection = state.selectedIds.has(surface.id);
    const corners = surface.corners.map(c => ({ x: c.x * W, y: c.y * H }));

    // Quad edges
    for (let i = 0; i < 4; i++) {
      const a = corners[i], b = corners[(i + 1) % 4];
      const isHoveredEdge = isSelected && hoveredEdge?.surfaceId === surface.id && hoveredEdge?.edgeIdx === i;
      const isDraggingEdge = isSelected && drag?.type === 'edge' && drag?.surfaceId === surface.id && drag?.edgeIdx === i;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
      ctx.strokeStyle = isDraggingEdge ? '#ff6b9d' : isHoveredEdge ? '#a89dff' :
        isSelected ? 'rgba(108,99,255,0.9)' : isInSelection ? 'rgba(108,99,255,0.6)' : 'rgba(108,99,255,0.3)';
      ctx.lineWidth = (isDraggingEdge || isHoveredEdge) ? 3 : (isSelected || isInSelection) ? 1.5 : 1;
      ctx.stroke();
    }

    // Corner handles (only for primary selected surface)
    if (isSelected) {
      corners.forEach((c, i) => {
        const isHovered = hoveredCorner?.surfaceId === surface.id && hoveredCorner?.cornerIdx === i;
        const isDragging = drag?.surfaceId === surface.id && drag?.cornerIdx === i;
        ctx.beginPath();
        ctx.arc(c.x, c.y, isDragging ? 7 : isHovered ? 6 : 5, 0, Math.PI * 2);
        ctx.fillStyle = isDragging ? '#ff6b9d' : isHovered ? '#a89dff' : '#6c63ff';
        ctx.fill();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5; ctx.stroke();
        const labels = ['TL', 'TR', 'BR', 'BL'];
        ctx.fillStyle = 'rgba(255,255,255,0.6)';
        ctx.font = '9px monospace';
        ctx.fillText(labels[i], c.x + 8, c.y - 5);
      });

      const cx = corners.reduce((s, c) => s + c.x, 0) / 4;
      const cy = corners.reduce((s, c) => s + c.y, 0) / 4;
      ctx.fillStyle = 'rgba(108,99,255,0.9)';
      ctx.font = 'bold 11px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText(surface.name, cx, cy);
      ctx.textAlign = 'left';
    }
  }

  // Marquee selection rectangle
  if (drag?.type === 'marquee') {
    const x0 = Math.min(drag.startX, drag.endX) * W, x1 = Math.max(drag.startX, drag.endX) * W;
    const y0 = Math.min(drag.startY, drag.endY) * H, y1 = Math.max(drag.startY, drag.endY) * H;
    ctx.save();
    ctx.strokeStyle = 'rgba(108,99,255,0.85)';
    ctx.fillStyle = 'rgba(108,99,255,0.07)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    ctx.restore();
  }
}

function drawGrid(ctx, W, H) {
  const cols = 16, rows = 9;
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 0.5;
  for (let i = 0; i <= cols; i++) {
    const x = (i / cols) * W;
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
  }
  for (let i = 0; i <= rows; i++) {
    const y = (i / rows) * H;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
  }
  // Center cross
  ctx.strokeStyle = 'rgba(255,255,255,0.2)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(W/2, 0); ctx.lineTo(W/2, H); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, H/2); ctx.lineTo(W, H/2); ctx.stroke();
}

// ── Canvas Interaction ────────────────────────────────────────────────────────

function bindOverlayEvents(overlay) {
  overlay.addEventListener('mousedown', onMouseDown);
  overlay.addEventListener('mousemove', onMouseMove);
  overlay.addEventListener('mouseup', onMouseUp);
  overlay.addEventListener('mouseleave', () => { hoveredCorner = null; hoveredEdge = null; });
  overlay.addEventListener('dblclick', onDblClick);
}

function canvasPos(e) {
  const rect = e.currentTarget.getBoundingClientRect();
  const W = e.currentTarget.width, H = e.currentTarget.height;
  return { x: (e.clientX - rect.left) / W, y: (e.clientY - rect.top) / H };
}

const HANDLE_RADIUS = 12; // px hit radius for corners
const EDGE_RADIUS = 8;   // px hit radius for edges

function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const lenSq = dx*dx + dy*dy;
  if (lenSq === 0) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px-ax)*dx + (py-ay)*dy) / lenSq));
  return Math.hypot(px - (ax + t*dx), py - (ay + t*dy));
}

function findCornerHit(normX, normY, W, H) {
  const px = normX * W, py = normY * H;
  const selected = state.surfaces.find(s => s.id === state.selectedId);
  if (!selected) return null;
  for (let i = 0; i < 4; i++) {
    const c = selected.corners[i];
    if (Math.hypot(c.x * W - px, c.y * H - py) <= HANDLE_RADIUS) {
      return { surfaceId: selected.id, cornerIdx: i };
    }
  }
  return null;
}

function findEdgeHit(normX, normY, W, H) {
  const selected = state.surfaces.find(s => s.id === state.selectedId);
  if (!selected) return null;
  const px = normX * W, py = normY * H;
  for (let i = 0; i < 4; i++) {
    const a = selected.corners[i];
    const b = selected.corners[(i + 1) % 4];
    if (distToSegment(px, py, a.x*W, a.y*H, b.x*W, b.y*H) <= EDGE_RADIUS) {
      return { surfaceId: selected.id, edgeIdx: i };
    }
  }
  return null;
}

function findSurfaceHit(normX, normY) {
  // Iterate in reverse to hit top-most first
  for (let i = state.surfaces.length - 1; i >= 0; i--) {
    const s = state.surfaces[i];
    if (!s.enabled) continue;
    if (pointInQuad(normX, normY, s.corners)) return s.id;
  }
  return null;
}

function snapToGrid(v) {
  if (!state.snap) return v;
  const gridSize = 1 / 16;
  return Math.round(v / gridSize) * gridSize;
}

// Snap a dragged corner (nx, ny in 0-1 space) to the nearest corner on any
// other surface if within CORNER_SNAP_DIST pixels. Returns {x, y} (normalised).
const CORNER_SNAP_DIST = 14; // px
function snapToCorner(nx, ny, excludeSurfaceId) {
  const overlay = document.getElementById('preview-overlay');
  const W = overlay.width, H = overlay.height;
  let bestDist = CORNER_SNAP_DIST;
  let snapX = nx, snapY = ny;
  for (const s of state.surfaces) {
    if (s.id === excludeSurfaceId || !s.enabled) continue;
    for (const c of s.corners) {
      const dx = (c.x - nx) * W;
      const dy = (c.y - ny) * H;
      const dist = Math.sqrt(dx*dx + dy*dy);
      if (dist < bestDist) { bestDist = dist; snapX = c.x; snapY = c.y; }
    }
  }
  return { x: snapX, y: snapY };
}

function onMouseDown(e) {
  const { x, y } = canvasPos(e);
  const W = e.currentTarget.width, H = e.currentTarget.height;

  const cornerHit = findCornerHit(x, y, W, H);
  if (cornerHit) {
    pushHistory();
    drag = { type: 'corner', ...cornerHit, startNormX: x, startNormY: y };
    return;
  }

  const edgeHit = findEdgeHit(x, y, W, H);
  if (edgeHit) {
    pushHistory();
    const surface = state.surfaces.find(s => s.id === edgeHit.surfaceId);
    drag = {
      type: 'edge',
      surfaceId: edgeHit.surfaceId,
      edgeIdx: edgeHit.edgeIdx,
      startNormX: x,
      startNormY: y,
      startCorners: surface.corners.map(c => ({ ...c })),
    };
    return;
  }

  const hitId = findSurfaceHit(x, y);
  if (hitId !== null) {
    if (!state.selectedIds.has(hitId)) {
      selectSurface(hitId);
    } else {
      // Drag all currently selected surfaces together
      pushHistory();
      const startCornersMap = {};
      for (const id of state.selectedIds) {
        const s = state.surfaces.find(s => s.id === id);
        if (s) startCornersMap[id] = s.corners.map(c => ({ ...c }));
      }
      drag = {
        type: 'surface',
        surfaceIds: [...state.selectedIds],
        startNormX: x,
        startNormY: y,
        startCornersMap,
      };
    }
  } else {
    // Start marquee selection on empty canvas
    drag = { type: 'marquee', startX: x, startY: y, endX: x, endY: y };
  }
}

function onMouseMove(e) {
  const { x, y } = canvasPos(e);
  const W = e.currentTarget.width, H = e.currentTarget.height;

  document.getElementById('status-pos').textContent = `x: ${x.toFixed(3)}  y: ${y.toFixed(3)}`;

  if (drag) {
    if (drag.type === 'marquee') {
      drag.endX = x; drag.endY = y;
      return;
    }

    if (drag.type === 'corner') {
      const surface = state.surfaces.find(s => s.id === drag.surfaceId);
      if (surface) {
        const gx = snapToGrid(x), gy = snapToGrid(y);
        const snapped = snapToCorner(gx, gy, drag.surfaceId);
        surface.corners[drag.cornerIdx] = {
          x: Math.max(0, Math.min(1, snapped.x)),
          y: Math.max(0, Math.min(1, snapped.y)),
        };
        updateCornerDisplay(surface);
        broadcastState();
      }
    } else if (drag.type === 'edge') {
      const surface = state.surfaces.find(s => s.id === drag.surfaceId);
      if (surface) {
        const dx = x - drag.startNormX, dy = y - drag.startNormY;
        const i0 = drag.edgeIdx, i1 = (drag.edgeIdx + 1) % 4;
        surface.corners[i0] = { x: Math.max(0, Math.min(1, drag.startCorners[i0].x + dx)), y: Math.max(0, Math.min(1, drag.startCorners[i0].y + dy)) };
        surface.corners[i1] = { x: Math.max(0, Math.min(1, drag.startCorners[i1].x + dx)), y: Math.max(0, Math.min(1, drag.startCorners[i1].y + dy)) };
        updateCornerDisplay(surface);
        broadcastState();
      }
    } else if (drag.type === 'surface') {
      const dx = x - drag.startNormX, dy = y - drag.startNormY;
      for (const id of drag.surfaceIds) {
        const s = state.surfaces.find(s => s.id === id);
        if (!s) continue;
        s.corners = drag.startCornersMap[id].map(c => ({
          x: Math.max(0, Math.min(1, c.x + dx)),
          y: Math.max(0, Math.min(1, c.y + dy)),
        }));
      }
      updateCornerDisplay(state.surfaces.find(s => s.id === state.selectedId));
      broadcastState();
    }
    return;
  }

  const cornerHit = findCornerHit(x, y, W, H);
  if (cornerHit) {
    hoveredCorner = cornerHit; hoveredEdge = null;
    e.currentTarget.style.cursor = 'grab'; return;
  }
  hoveredCorner = null;

  const edgeHit = findEdgeHit(x, y, W, H);
  if (edgeHit) {
    hoveredEdge = edgeHit;
    e.currentTarget.style.cursor = 'grab'; return;
  }
  hoveredEdge = null;

  const hitId = findSurfaceHit(x, y);
  if (hitId !== null && state.selectedIds.has(hitId)) {
    e.currentTarget.style.cursor = 'move';
  } else {
    e.currentTarget.style.cursor = hitId !== null ? 'pointer' : 'crosshair';
  }
}

function onMouseUp() {
  if (!drag) return;
  if (drag.type === 'marquee') {
    const x0 = Math.min(drag.startX, drag.endX), x1 = Math.max(drag.startX, drag.endX);
    const y0 = Math.min(drag.startY, drag.endY), y1 = Math.max(drag.startY, drag.endY);
    if (x1 - x0 > 0.005 || y1 - y0 > 0.005) {
      const hitIds = state.surfaces
        .filter(s => s.enabled)
        .filter(s => {
          const cx = s.corners.reduce((a, c) => a + c.x, 0) / 4;
          const cy = s.corners.reduce((a, c) => a + c.y, 0) / 4;
          return cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1;
        })
        .map(s => s.id);
      if (hitIds.length > 0) selectSurfaces(hitIds); else selectSurface(null);
    } else {
      selectSurface(null);
    }
  } else {
    broadcastState();
  }
  drag = null;
}

function onDblClick(e) {
  const { x, y } = canvasPos(e);
  const hitId = findSurfaceHit(x, y);
  if (hitId) {
    const s = state.surfaces.find(s => s.id === hitId);
    const name = prompt('Surface name:', s.name);
    if (name !== null) { s.name = name; renderLayers(); }
  }
}

// ── State Management ──────────────────────────────────────────────────────────

function addSurface() {
  pushHistory();
  const id = state.nextId++;
  const hues = ['#3a86ff','#ff006e','#8338ec','#fb5607','#06d6a0','#ffbe0b'];
  const color = hues[(id - 1) % hues.length];
  const offset = 0.05 * ((state.surfaces.length) % 5);
  const surface = {
    id,
    name: `Surface ${id}`,
    enabled: true,
    corners: [
      { x: 0.15 + offset, y: 0.15 + offset },
      { x: 0.85 - offset, y: 0.15 + offset },
      { x: 0.85 - offset, y: 0.85 - offset },
      { x: 0.15 + offset, y: 0.85 - offset },
    ],
    content: { type: 'effect', effect: 'grid', params: { cols: 8, rows: 8, lineWidth: 2, opacity: 1 } },
    opacity: 1.0,
    blendMode: 'normal',
  };
  state.surfaces.push(surface);
  selectSurface(id);
  // Enable grid to help with alignment
  state.showGrid = true;
  const gridToggle = document.getElementById('toggle-grid');
  if (gridToggle) gridToggle.checked = true;
  renderLayers();
  broadcastState();
}

function removeSurface(id) {
  pushHistory();
  glRenderer.deleteTexture(id);
  state.surfaces = state.surfaces.filter(s => s.id !== id);
  if (state.selectedId === id) selectSurface(state.surfaces.length ? state.surfaces[state.surfaces.length - 1].id : null);
  renderLayers();
  broadcastState();
}

function selectSurface(id) {
  const alreadySelected = state.selectedId === id && state.selectedIds.size === (id ? 1 : 0);
  state.selectedId = id;
  state.selectedIds = id ? new Set([id]) : new Set();
  if (!alreadySelected) {
    renderLayers();
    renderProperties();
  }
  const s = id ? state.surfaces.find(s => s.id === id) : null;
  document.getElementById('status-surface').textContent = s ? `Selected: ${s.name}` : '';
}

const AUTOSAVE_KEY = 'proj-map-autosave';

function broadcastState() {
  // Strip video src from broadcast — output reads blob from IDB by videoKey instead
  const serializable = serializeState(true);
  serializable._epoch = startEpoch;
  channel.send('state-update', serializable);
  // Debounced autosave — include full state (with video src) for reload portability
  clearTimeout(broadcastState._saveTimer);
  broadcastState._saveTimer = setTimeout(() => autosave(serializeState(false)), 300);
}

function autosave(data) {
  idbSet(AUTOSAVE_KEY, { ...data, nextId: state.nextId }).catch(() => {});
}

async function loadAutosave() {
  try {
    const saved = await idbGet(AUTOSAVE_KEY);
    if (!saved) return false;
    state.surfaces = saved.surfaces ?? [];
    state.output = saved.output ?? state.output;
    state.projectName = saved.projectName ?? null;
    state.nextId = saved.nextId ?? (Math.max(0, ...state.surfaces.map(s => s.id)) + 1);
    for (const s of state.surfaces) {
      if (s.content.type === 'video') {
        await restoreVideo(s.content);
      } else if (s.content.type === 'image' && s.content.src) {
        const img = new Image();
        img.onload = () => { s.content._img = img; };
        img.src = s.content.src;
      }
    }
    return true;
  } catch (e) {
    return false;
  }
}

// Restore a video content object: prefer IDB blob (videoKey), fall back to data URL (src)
async function restoreVideo(content) {
  if (content.videoKey) {
    const blob = await idbGet(content.videoKey).catch(() => null);
    if (blob) { loadVideo(content, URL.createObjectURL(blob)); return; }
  }
  if (content.src) loadVideo(content); // legacy data-URL fallback
}

// stripVideo = true when broadcasting (omit large video src); false when saving to file
function serializeState(stripVideo = false) {
  return {
    surfaces: state.surfaces.map(s => ({
      ...s,
      content: {
        ...s.content,
        _img: undefined,
        _video: undefined,
        ...(stripVideo && s.content.type === 'video' ? { src: undefined } : {}),
      },
    })),
    output: state.output,
    projectName: state.projectName,
  };
}

function pushHistory() {
  // Strip video src — video blobs live in IDB keyed by videoKey
  const snap = JSON.parse(JSON.stringify(serializeState(true)));
  snap._nextId = state.nextId;
  undoStack.push(snap);
  if (undoStack.length > MAX_UNDO) undoStack.shift();
}

async function undo() {
  if (!undoStack.length) { showToast('Nothing to undo'); return; }
  const snap = undoStack.pop();
  for (const s of state.surfaces) glRenderer.deleteTexture(s.id);
  state.surfaces = snap.surfaces ?? [];
  state.output = snap.output ?? state.output;
  state.nextId = snap._nextId ?? (Math.max(0, ...state.surfaces.map(s => s.id)) + 1);
  state.selectedId = null;
  state.selectedIds = new Set();
  for (const s of state.surfaces) {
    if (s.content.type === 'video') {
      await restoreVideo(s.content);
    } else if (s.content.type === 'image' && s.content.src) {
      const img = new Image();
      img.onload = () => { s.content._img = img; };
      img.src = s.content.src;
    }
  }
  renderLayers(); renderProperties(); broadcastState();
  showToast('Undo');
}

function makeCopyName(name) {
  const base = name.replace(/ copy( \d+)?$/, '').trim();
  const esc = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const existing = state.surfaces.filter(s =>
    s.name === `${base} copy` || new RegExp(`^${esc} copy \\d+$`).test(s.name)
  );
  return existing.length === 0 ? `${base} copy` : `${base} copy ${existing.length + 1}`;
}

function selectSurfaces(ids) {
  const valid = ids.filter(id => state.surfaces.find(s => s.id === id));
  state.selectedIds = new Set(valid);
  state.selectedId = valid[valid.length - 1] ?? null;
  renderLayers();
  renderProperties();
  const n = valid.length;
  document.getElementById('status-surface').textContent =
    n === 1 ? `Selected: ${state.surfaces.find(s => s.id === state.selectedId)?.name ?? ''}` :
    n > 1   ? `${n} surfaces selected` : '';
}

// ── Layer Panel ───────────────────────────────────────────────────────────────

function bindLayerPanel() {
  document.getElementById('btn-add-surface').addEventListener('click', addSurface);
  document.getElementById('btn-add-surface-2').addEventListener('click', addSurface);

  // Delegated dblclick — use elementFromPoint because click handlers rebuild the DOM
  // before dblclick fires, making e.target point to a detached element
  document.getElementById('layers-list').addEventListener('dblclick', (e) => {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const nameSpan = el?.closest('.layer-name');
    if (!nameSpan) return;
    e.stopPropagation();
    const item = nameSpan.closest('[data-surface-id]');
    if (!item) return;
    const s = state.surfaces.find(s => s.id === +item.dataset.surfaceId);
    if (!s) return;
    const input = document.createElement('input');
    input.className = 'layer-rename-input';
    input.value = s.name;
    nameSpan.replaceWith(input);
    input.focus(); input.select();
    const commit = () => {
      s.name = input.value.trim() || s.name;
      renderLayers();
      renderProperties();
      broadcastState();
    };
    input.addEventListener('blur', commit);
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') { ev.preventDefault(); input.blur(); }
      if (ev.key === 'Escape') { input.value = s.name; input.blur(); }
    });
  });
}

function renderLayers() {
  const list = document.getElementById('layers-list');
  list.innerHTML = '';
  const typeIcons = { color: '■', gradient: '▣', image: '🖼', video: '▶', text: 'T', effect: '✦' };
  // Render in reverse so top surface is visually on top in the list
  for (let i = state.surfaces.length - 1; i >= 0; i--) {
    const s = state.surfaces[i];
    const item = document.createElement('div');
    item.className = 'layer-item' + (state.selectedIds.has(s.id) ? ' selected' : '') + (!s.enabled ? ' disabled' : '');
    item.dataset.surfaceId = s.id;
    item.innerHTML = `
      <span class="layer-vis" title="Toggle visibility">${s.enabled ? '👁' : '○'}</span>
      <span class="layer-type">${typeIcons[s.content.type] ?? '■'}</span>
      <span class="layer-name" title="Double-click to rename">${s.name}</span>
      <button class="btn-danger layer-delete" title="Delete">✕</button>
    `;
    item.querySelector('.layer-vis').addEventListener('click', (e) => {
      e.stopPropagation();
      s.enabled = !s.enabled;
      renderLayers();
      broadcastState();
    });
    item.querySelector('.layer-delete').addEventListener('click', (e) => {
      e.stopPropagation();
      removeSurface(s.id);
    });
    item.addEventListener('click', () => selectSurface(s.id));
    list.appendChild(item);
  }
}

// ── Properties Panel ──────────────────────────────────────────────────────────

function renderProperties() {
  const panel = document.getElementById('properties-content');
  const s = state.surfaces.find(s => s.id === state.selectedId);
  if (!s) { panel.innerHTML = '<div class="empty-state">Select a surface to edit its properties</div>'; return; }

  panel.innerHTML = `
    <!-- Name & Basic -->
    <div class="prop-section">
      <div class="prop-section-title">Surface</div>
      <div class="prop-row"><label>Name</label><input type="text" id="p-name" value="${escHtml(s.name)}"></div>
      <div class="prop-row"><label>Opacity</label><input type="range" id="p-opacity" min="0" max="1" step="0.01" value="${s.opacity}"><span id="p-opacity-val">${Math.round(s.opacity*100)}%</span></div>
      <div class="prop-row"><label>Blend</label>
        <select id="p-blend">
          ${['normal','add','screen','multiply'].map(m => `<option value="${m}" ${s.blendMode===m?'selected':''}>${m}</option>`).join('')}
        </select>
      </div>
    </div>

    <!-- Content Type -->
    <div class="prop-section">
      <div class="prop-section-title">Content</div>
      <div class="content-type-tabs" id="content-type-tabs">
        ${['color','gradient','image','video','text','effect'].map(t =>
          `<div class="content-type-tab${s.content.type===t?' active':''}" data-type="${t}">${t}</div>`
        ).join('')}
      </div>
      <div id="content-settings"></div>
    </div>

    <!-- Corners -->
    <div class="prop-section">
      <div class="prop-section-title">Corners (normalized)</div>
      <div class="corner-coords" id="corner-coords">
        ${s.corners.map((c,i) => `
          <div class="corner-coord-item">
            <span class="corner-label">${['TL','TR','BR','BL'][i]}</span>
            <span class="corner-val" id="cv-${i}">${c.x.toFixed(3)}, ${c.y.toFixed(3)}</span>
          </div>
        `).join('')}
      </div>
      <div style="margin-top:8px">
        <button class="btn-full" id="p-reset-corners">Reset to Rectangle</button>
      </div>
    </div>
  `;

  document.getElementById('p-name').addEventListener('change', (e) => {
    s.name = e.target.value; renderLayers(); broadcastState();
  });
  document.getElementById('p-opacity').addEventListener('input', (e) => {
    s.opacity = parseFloat(e.target.value);
    document.getElementById('p-opacity-val').textContent = Math.round(s.opacity*100) + '%';
    broadcastState();
  });
  document.getElementById('p-blend').addEventListener('change', (e) => {
    s.blendMode = e.target.value; broadcastState();
  });
  document.getElementById('p-reset-corners').addEventListener('click', () => {
    s.corners = [
      { x: 0.1, y: 0.1 }, { x: 0.9, y: 0.1 },
      { x: 0.9, y: 0.9 }, { x: 0.1, y: 0.9 },
    ];
    updateCornerDisplay(s); broadcastState();
  });

  // Content type tabs
  document.querySelectorAll('.content-type-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      s.content = { type: tab.dataset.type };
      applyContentDefaults(s.content);
      renderProperties();
      broadcastState();
    });
  });

  renderContentSettings(s);
}

function applyContentDefaults(content) {
  switch (content.type) {
    case 'color': content.color = '#3a86ff'; break;
    case 'gradient': content.gradientType = 'linear'; content.angle = 90; content.stops = [{color:'#3a86ff',pos:0},{color:'#ff006e',pos:1}]; break;
    case 'image': break;
    case 'video': content.loop = true; break;
    case 'text': content.text = 'Hello World'; content.color = '#ffffff'; content.background = '#000000'; content.size = 72; content.font = 'sans-serif'; content.align = 'center'; break;
    case 'effect': content.effect = 'plasma'; content.params = {}; break;
  }
}

function renderContentSettings(s) {
  const el = document.getElementById('content-settings');
  if (!el) return;
  const c = s.content;

  switch (c.type) {
    case 'color':
      el.innerHTML = `<div class="prop-row"><label>Color</label><input type="color" id="p-color" value="${c.color??'#3a86ff'}"></div>`;
      el.querySelector('#p-color').addEventListener('input', (e) => { c.color = e.target.value; broadcastState(); });
      break;

    case 'gradient':
      el.innerHTML = `
        <div class="prop-row"><label>Type</label>
          <select id="p-grad-type">
            <option value="linear" ${c.gradientType==='linear'?'selected':''}>Linear</option>
            <option value="radial" ${c.gradientType==='radial'?'selected':''}>Radial</option>
          </select>
        </div>
        <div class="prop-row" id="p-angle-row"><label>Angle</label><input type="range" id="p-angle" min="0" max="360" step="1" value="${c.angle??90}"><span id="p-angle-val">${c.angle??90}°</span></div>
        <div class="prop-section-title" style="margin-top:6px">Color Stops</div>
        <div class="gradient-stops" id="p-stops"></div>
        <button class="btn-secondary" id="p-add-stop" style="width:100%;margin-top:4px;font-size:11px">+ Add Stop</button>
      `;
      renderGradientStops(s);
      el.querySelector('#p-grad-type').addEventListener('change', (e) => {
        c.gradientType = e.target.value;
        document.getElementById('p-angle-row').style.display = e.target.value === 'radial' ? 'none' : '';
        broadcastState();
      });
      el.querySelector('#p-angle').addEventListener('input', (e) => {
        c.angle = parseInt(e.target.value);
        document.getElementById('p-angle-val').textContent = c.angle + '°';
        broadcastState();
      });
      el.querySelector('#p-add-stop').addEventListener('click', () => {
        c.stops = c.stops ?? [];
        c.stops.push({ color: '#ffffff', pos: 0.5 });
        renderGradientStops(s); broadcastState();
      });
      if (c.gradientType === 'radial') document.getElementById('p-angle-row').style.display = 'none';
      break;

    case 'image': {
      const fitMode = c.fitMode ?? 'fill';
      el.innerHTML = `
        <button class="upload-btn" id="p-upload-image">📁 Choose Image</button>
        ${c.src ? `<img class="media-preview" src="${c.src}">` : ''}
        <input type="file" id="p-img-file" accept="image/*" style="display:none">
        <div class="prop-section-title" style="margin-top:10px">Fit</div>
        <div class="fit-mode-row">
          <button class="fit-btn${fitMode==='fill'?' active':''}" data-fit="fill" title="Stretch to fill — may distort">Fill</button>
          <button class="fit-btn${fitMode==='cover'?' active':''}" data-fit="cover" title="Crop to fill — no distortion">Crop</button>
        </div>
        <div id="p-crop-controls" style="display:${fitMode==='cover'?'block':'none'}">
          <div class="prop-row" style="margin-top:8px"><label>Left ↔ Right</label><input type="range" id="p-crop-x" min="0" max="1" step="0.01" value="${c.cropX??0.5}"></div>
          <div class="prop-row"><label>Top ↔ Bottom</label><input type="range" id="p-crop-y" min="0" max="1" step="0.01" value="${c.cropY??0.5}"></div>
        </div>
      `;
      el.querySelector('#p-upload-image').addEventListener('click', () => el.querySelector('#p-img-file').click());
      el.querySelector('#p-img-file').addEventListener('change', (e) => {
        const file = e.target.files[0]; if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => { c.src = ev.target.result; c._img = null; renderProperties(); broadcastState(); };
        reader.readAsDataURL(file);
      });
      el.querySelectorAll('.fit-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          c.fitMode = btn.dataset.fit;
          el.querySelectorAll('.fit-btn').forEach(b => b.classList.toggle('active', b === btn));
          document.getElementById('p-crop-controls').style.display = c.fitMode === 'cover' ? 'block' : 'none';
          broadcastState();
        });
      });
      el.querySelector('#p-crop-x')?.addEventListener('input', (e) => { c.cropX = parseFloat(e.target.value); broadcastState(); });
      el.querySelector('#p-crop-y')?.addEventListener('input', (e) => { c.cropY = parseFloat(e.target.value); broadcastState(); });
      break;
    }

    case 'video': {
      const fitMode = c.fitMode ?? 'fill';
      el.innerHTML = `
        <button class="upload-btn" id="p-upload-video">📁 Choose Video</button>
        <div class="prop-row" style="margin-top:8px"><label>Loop</label><input type="checkbox" id="p-loop" ${c.loop?'checked':''}></div>
        <div class="prop-row"><label>Muted</label><input type="checkbox" id="p-muted" ${c.muted!==false?'checked':''}></div>
        <input type="file" id="p-vid-file" accept="video/*" style="display:none">
        <div class="prop-section-title" style="margin-top:10px">Fit</div>
        <div class="fit-mode-row">
          <button class="fit-btn${fitMode==='fill'?' active':''}" data-fit="fill">Fill</button>
          <button class="fit-btn${fitMode==='cover'?' active':''}" data-fit="cover">Crop</button>
        </div>
        <div id="p-crop-controls" style="display:${fitMode==='cover'?'block':'none'}">
          <div class="prop-row" style="margin-top:8px"><label>Left ↔ Right</label><input type="range" id="p-crop-x" min="0" max="1" step="0.01" value="${c.cropX??0.5}"></div>
          <div class="prop-row"><label>Top ↔ Bottom</label><input type="range" id="p-crop-y" min="0" max="1" step="0.01" value="${c.cropY??0.5}"></div>
        </div>
      `;
      el.querySelector('#p-upload-video').addEventListener('click', () => el.querySelector('#p-vid-file').click());
      el.querySelector('#p-vid-file').addEventListener('change', async (e) => {
        const file = e.target.files[0]; if (!file) return;

        // Give this video a stable key so output can fetch it from IDB
        const videoKey = `video-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        c.videoKey = videoKey;
        c.src = null; // will be set by FileReader below

        // Store the raw blob in IDB — output window reads it from here
        await idbSet(videoKey, file).catch(() => {});

        // Immediate editor playback via object URL (no base64 overhead)
        loadVideo(c, URL.createObjectURL(file));

        // Broadcast now (output uses videoKey → IDB blob)
        broadcastState();

        // Read as data URL in background so project Save includes the video
        const reader = new FileReader();
        reader.onload = (ev) => { c.src = ev.target.result; };
        reader.readAsDataURL(file);
      });
      el.querySelector('#p-loop').addEventListener('change', (e) => { c.loop = e.target.checked; if (c._video) c._video.loop = c.loop; broadcastState(); });
      el.querySelector('#p-muted').addEventListener('change', (e) => { c.muted = e.target.checked; if (c._video) c._video.muted = c.muted; broadcastState(); });
      el.querySelectorAll('.fit-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          c.fitMode = btn.dataset.fit;
          el.querySelectorAll('.fit-btn').forEach(b => b.classList.toggle('active', b === btn));
          document.getElementById('p-crop-controls').style.display = c.fitMode === 'cover' ? 'block' : 'none';
          broadcastState();
        });
      });
      el.querySelector('#p-crop-x')?.addEventListener('input', (e) => { c.cropX = parseFloat(e.target.value); broadcastState(); });
      el.querySelector('#p-crop-y')?.addEventListener('input', (e) => { c.cropY = parseFloat(e.target.value); broadcastState(); });
      if (!c._video) restoreVideo(c).catch(() => {});
      break;
    }

    case 'text':
      el.innerHTML = `
        <div class="prop-row"><label>Text</label><textarea id="p-text" rows="3">${escHtml(c.text??'')}</textarea></div>
        <div class="prop-row"><label>Color</label><input type="color" id="p-text-color" value="${c.color??'#ffffff'}"></div>
        <div class="prop-row"><label>BG</label><input type="color" id="p-text-bg" value="${c.background??'#000000'}"></div>
        <div class="prop-row"><label>Size</label><input type="number" id="p-text-size" value="${c.size??72}" min="8" max="500" style="width:70px"></div>
        <div class="prop-row"><label>Font</label>
          <select id="p-text-font">
            ${['sans-serif','serif','monospace','Impact','Georgia'].map(f => `<option value="${f}" ${c.font===f?'selected':''}>${f}</option>`).join('')}
          </select>
        </div>
        <div class="prop-row"><label>Align</label>
          <select id="p-text-align">
            ${['left','center','right'].map(a => `<option value="${a}" ${c.align===a?'selected':''}>${a}</option>`).join('')}
          </select>
        </div>
        <div class="prop-row"><label>Bold</label><input type="checkbox" id="p-text-bold" ${c.bold?'checked':''}></div>
      `;
      el.querySelector('#p-text').addEventListener('input', (e) => { c.text = e.target.value; broadcastState(); });
      el.querySelector('#p-text-color').addEventListener('input', (e) => { c.color = e.target.value; broadcastState(); });
      el.querySelector('#p-text-bg').addEventListener('input', (e) => { c.background = e.target.value; broadcastState(); });
      el.querySelector('#p-text-size').addEventListener('input', (e) => { c.size = parseInt(e.target.value); broadcastState(); });
      el.querySelector('#p-text-font').addEventListener('change', (e) => { c.font = e.target.value; broadcastState(); });
      el.querySelector('#p-text-align').addEventListener('change', (e) => { c.align = e.target.value; broadcastState(); });
      el.querySelector('#p-text-bold').addEventListener('change', (e) => { c.bold = e.target.checked; broadcastState(); });
      break;

    case 'effect':
      el.innerHTML = `
        <div class="prop-row"><label>Effect</label>
          <select id="p-effect-type">
            ${EFFECT_KEYS.map(k => `<option value="${k}" ${c.effect===k?'selected':''}>${EFFECTS[k].label}</option>`).join('')}
          </select>
        </div>
        <div class="effect-params" id="p-effect-params"></div>
      `;
      renderEffectParams(s);
      el.querySelector('#p-effect-type').addEventListener('change', (e) => {
        c.effect = e.target.value; c.params = {};
        renderEffectParams(s); broadcastState();
      });
      break;
  }
}

function renderGradientStops(s) {
  const c = s.content;
  const stops = c.stops ?? [];
  const el = document.getElementById('p-stops');
  if (!el) return;
  el.innerHTML = '';
  stops.forEach((stop, i) => {
    const row = document.createElement('div');
    row.className = 'gradient-stop-row';
    row.innerHTML = `
      <input type="color" value="${stop.color}">
      <input type="number" value="${Math.round(stop.pos*100)}" min="0" max="100" step="1"> %
      ${stops.length > 2 ? `<button class="btn-secondary" data-del="${i}">✕</button>` : ''}
    `;
    row.querySelector('input[type="color"]').addEventListener('input', (e) => { stop.color = e.target.value; broadcastState(); });
    row.querySelector('input[type="number"]').addEventListener('input', (e) => { stop.pos = parseInt(e.target.value)/100; broadcastState(); });
    if (stops.length > 2) {
      row.querySelector('[data-del]').addEventListener('click', () => { c.stops.splice(i, 1); renderGradientStops(s); broadcastState(); });
    }
    el.appendChild(row);
  });
}

function renderEffectParams(s) {
  const c = s.content;
  const effect = EFFECTS[c.effect];
  if (!effect) return;
  const el = document.getElementById('p-effect-params');
  if (!el) return;
  el.innerHTML = '';
  c.params = c.params ?? {};
  for (const [key, def] of Object.entries(effect.params)) {
    const val = c.params[key] ?? def.default;
    const row = document.createElement('div');
    row.className = 'prop-row';
    if (def.min === 0 && def.max === 1 && def.step === 1) {
      // Boolean toggle
      row.innerHTML = `<label>${def.label}</label><input type="checkbox" id="ep-${key}" ${val>0.5?'checked':''}>`;
      row.querySelector('input').addEventListener('change', (e) => { c.params[key] = e.target.checked ? 1 : 0; broadcastState(); });
    } else {
      row.innerHTML = `<label>${def.label}</label><input type="range" id="ep-${key}" min="${def.min}" max="${def.max}" step="${def.step}" value="${val}"><span id="ep-${key}-val">${val}</span>`;
      row.querySelector('input').addEventListener('input', (e) => {
        c.params[key] = parseFloat(e.target.value);
        document.getElementById(`ep-${key}-val`).textContent = c.params[key];
        broadcastState();
      });
    }
    el.appendChild(row);
  }
}

function updateCornerDisplay(s) {
  if (!s) return;
  s.corners.forEach((c, i) => {
    const el = document.getElementById(`cv-${i}`);
    if (el) el.textContent = `${c.x.toFixed(3)}, ${c.y.toFixed(3)}`;
  });
}

function loadVideo(content, src) {
  const url = src ?? content.src;
  if (!url) return;
  if (content._video) { content._video.pause(); content._video.src = ''; }
  const vid = document.createElement('video');
  vid.loop = content.loop !== false;
  vid.muted = content.muted !== false;
  vid.playsInline = true;
  vid.preload = 'auto';
  content._video = vid;
  // Wait for data before playing — calling play() before canplay fires silently fails
  vid.addEventListener('canplay', () => vid.play().catch(() => {}));
  vid.src = url;
  vid.load();
}

// ── Copy / Paste ──────────────────────────────────────────────────────────────

function copySurface() {
  const s = state.surfaces.find(s => s.id === state.selectedId);
  if (!s) return;
  clipboard = JSON.parse(JSON.stringify({ ...s, content: { ...s.content, _img: undefined, _video: undefined } }));
  showToast('Copied');
}

function pasteSurface() {
  if (!clipboard) return;
  pushHistory();
  const id = state.nextId++;
  const OFFSET = 0.03;
  const pasted = {
    ...JSON.parse(JSON.stringify(clipboard)),
    id,
    name: makeCopyName(clipboard.name),
    corners: clipboard.corners.map(c => ({
      x: Math.min(1, c.x + OFFSET),
      y: Math.min(1, c.y + OFFSET),
    })),
  };
  if (pasted.content.type === 'video') restoreVideo(pasted.content).catch(() => {});
  state.surfaces.push(pasted);
  selectSurface(id);
  renderLayers();
  broadcastState();
  showToast('Pasted');
}

function duplicateSurface() {
  copySurface();
  pasteSurface();
}

function showToast(msg) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.style.cssText = 'position:fixed;bottom:48px;left:50%;transform:translateX(-50%);background:rgba(108,99,255,0.9);color:#fff;padding:5px 16px;border-radius:20px;font-size:12px;pointer-events:none;transition:opacity 0.3s;z-index:999;';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.style.opacity = '1';
  clearTimeout(el._timer);
  el._timer = setTimeout(() => { el.style.opacity = '0'; }, 1200);
}

// ── Toolbar ───────────────────────────────────────────────────────────────────

let outputWindow = null;

function openOutput() {
  if (outputWindow && !outputWindow.closed) {
    outputWindow.location.href = 'output.html'; // force reload with fresh JS
  } else {
    outputWindow = window.open('output.html', 'proj-map-output', 'width=1280,height=720');
  }
  // Wait for the output window to finish loading before sending state
  const send = () => { broadcastState(); };
  setTimeout(send, 800);
}

function bindToolbar() {
  document.getElementById('btn-output').addEventListener('click', openOutput);

  document.getElementById('btn-save').addEventListener('click', saveProject);
  document.getElementById('btn-load').addEventListener('click', () => document.getElementById('file-input').click());
  document.getElementById('file-input').addEventListener('change', loadProject);

  document.getElementById('toggle-grid').addEventListener('change', (e) => {
    state.showGrid = e.target.checked;
  });
  document.getElementById('toggle-snap').addEventListener('change', (e) => {
    state.snap = e.target.checked;
  });

  document.addEventListener('keydown', (e) => {
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key === 'z') { e.preventDefault(); undo().catch(() => {}); }
    if (mod && e.key === 'c') { e.preventDefault(); copySurface(); }
    if (mod && e.key === 'v') { e.preventDefault(); pasteSurface(); }
    if (mod && e.key === 'd') { e.preventDefault(); duplicateSurface(); }
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (state.selectedId !== null) { e.preventDefault(); removeSurface(state.selectedId); }
    }
  });
}

async function saveProject() {
  const suggested = state.projectName ?? 'my-project';
  const name = prompt('Save project as:', suggested);
  if (name === null) return;
  state.projectName = name.replace(/\.json$/i, '').trim() || suggested;

  // Build save state: embed video as data URL for portability
  const saveState = serializeState(false);
  for (const s of saveState.surfaces) {
    if (s.content.type === 'video' && !s.content.src && s.content.videoKey) {
      const idbBlob = await idbGet(s.content.videoKey).catch(() => null);
      if (idbBlob) {
        s.content.src = await new Promise(resolve => {
          const r = new FileReader(); r.onload = e => resolve(e.target.result); r.readAsDataURL(idbBlob);
        });
      }
    }
  }

  const data = JSON.stringify(saveState, null, 2);
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = state.projectName + '.json';
  a.click(); URL.revokeObjectURL(url);
}

function loadProject(e) {
  const file = e.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = async (ev) => {
    try {
      const loaded = JSON.parse(ev.target.result);
      for (const s of state.surfaces) glRenderer.deleteTexture(s.id);
      state.surfaces = loaded.surfaces ?? [];
      state.output = loaded.output ?? state.output;
      state.projectName = loaded.projectName ?? null;
      state.nextId = Math.max(...state.surfaces.map(s => s.id), 0) + 1;
      state.selectedId = null;
      state.selectedIds = new Set();
      for (const s of state.surfaces) {
        if (s.content.type === 'video') {
          // If the project file has a data URL, store it as a blob in IDB so the output can use it
          if (!s.content.videoKey && s.content.src) {
            const key = `video-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
            s.content.videoKey = key;
            const res = await fetch(s.content.src);
            const blob = await res.blob();
            await idbSet(key, blob).catch(() => {});
          }
          await restoreVideo(s.content);
        } else if (s.content.type === 'image' && s.content.src) {
          const img = new Image();
          img.onload = () => { s.content._img = img; };
          img.src = s.content.src;
        }
      }
      renderLayers(); renderProperties(); broadcastState();
    } catch (err) {
      alert('Failed to load project: ' + err.message);
    }
  };
  reader.readAsText(file);
  e.target.value = '';
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function escHtml(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Boot ──────────────────────────────────────────────────────────────────────

init();
