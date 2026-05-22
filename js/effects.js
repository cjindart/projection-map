import { hslToRgb } from './math.js';

// Each effect: render(ctx, w, h, params, t) where t = elapsed seconds

export const EFFECTS = {
  plasma: {
    label: 'Plasma',
    params: { speed: { label: 'Speed', min: 0.1, max: 5, step: 0.1, default: 1 }, scale: { label: 'Scale', min: 1, max: 20, step: 0.5, default: 6 }, global: { label: 'Global', min: 0, max: 1, step: 1, default: 0 } },
    render(ctx, w, h, params, t, surfaceId, corners) {
      const res = 128;
      const img = ctx.createImageData(res, res);
      const d = img.data;
      const isGlobal = (params.global ?? 0) > 0.5;
      const GS = 512; // global coordinate space size
      const sc = (params.scale ?? 6) / (isGlobal ? GS : res);
      const sp = params.speed ?? 1;
      const cx = isGlobal ? GS / 2 : res / 2;
      const cy = isGlobal ? GS / 2 : res / 2;
      for (let py = 0; py < res; py++) {
        for (let px = 0; px < res; px++) {
          let x, y;
          if (isGlobal && corners) {
            // Map local canvas pixel to output-space via bilinear interpolation across the quad
            const u = px / res, v = py / res;
            x = (corners[0].x*(1-u)*(1-v) + corners[1].x*u*(1-v) + corners[3].x*(1-u)*v + corners[2].x*u*v) * GS;
            y = (corners[0].y*(1-u)*(1-v) + corners[1].y*u*(1-v) + corners[3].y*(1-u)*v + corners[2].y*u*v) * GS;
          } else {
            x = px; y = py;
          }
          const val = Math.sin(x * sc + t * sp)
            + Math.sin(y * sc + t * sp * 0.7)
            + Math.sin((x + y) * sc * 0.7 + t * sp * 1.3)
            + Math.sin(Math.sqrt(((x - cx)**2 + (y - cy)**2)) * sc + t * sp);
          const hue = ((val * 90 + t * 40 * sp) % 360 + 360) % 360;
          const [r, g, b] = hslToRgb(hue / 360, 0.9, 0.45 + val * 0.12);
          const i = (py * res + px) * 4;
          d[i] = r * 255; d[i+1] = g * 255; d[i+2] = b * 255; d[i+3] = 255;
        }
      }
      const tmp = document.createElement('canvas');
      tmp.width = res; tmp.height = res;
      tmp.getContext('2d').putImageData(img, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(tmp, 0, 0, w, h);
    }
  },

  wave: {
    label: 'Color Wave',
    params: { speed: { label: 'Speed', min: 0.1, max: 5, step: 0.1, default: 1.5 }, bands: { label: 'Bands', min: 1, max: 10, step: 1, default: 4 }, hue: { label: 'Hue', min: 0, max: 360, step: 1, default: 200 } },
    render(ctx, w, h, params, t) {
      const bands = Math.round(params.bands ?? 4);
      const sp = params.speed ?? 1.5;
      const baseHue = params.hue ?? 200;
      for (let i = 0; i < bands; i++) {
        const phase = (i / bands) * Math.PI * 2;
        const v = (Math.sin(t * sp + phase) + 1) / 2;
        const hue = (baseHue + i * (360 / bands) + t * 20 * sp) % 360;
        ctx.fillStyle = `hsl(${hue}, 90%, ${35 + v * 30}%)`;
        const y0 = (i / bands) * h;
        const y1 = ((i + 1) / bands) * h;
        ctx.fillRect(0, y0, w, y1 - y0);
      }
      // Add wave overlay
      ctx.save();
      ctx.globalAlpha = 0.4;
      for (let i = 0; i < bands; i++) {
        const phase = (i / bands) * Math.PI * 2;
        const hue = (baseHue + i * (360 / bands) + t * 20 * sp + 30) % 360;
        ctx.strokeStyle = `hsl(${hue}, 100%, 75%)`;
        ctx.lineWidth = 3;
        ctx.beginPath();
        for (let x = 0; x <= w; x += 4) {
          const y = (h / (bands * 2)) * (Math.sin(x / w * Math.PI * 4 + t * sp * 2 + phase) + 1) + (i / bands) * h;
          x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
      ctx.restore();
    }
  },

  particles: {
    label: 'Particles',
    params: { count: { label: 'Count', min: 10, max: 300, step: 10, default: 80 }, speed: { label: 'Speed', min: 0.1, max: 3, step: 0.1, default: 1 }, hue: { label: 'Hue', min: 0, max: 360, step: 1, default: 260 } },
    _pool: new Map(),
    _getParticles(id, count) {
      if (!this._pool.has(id)) this._pool.set(id, []);
      const arr = this._pool.get(id);
      while (arr.length < count) {
        arr.push({ x: Math.random(), y: Math.random(), vx: (Math.random()-0.5)*0.002, vy: (Math.random()-0.5)*0.002, r: Math.random()*3+1, hue: Math.random()*60, life: Math.random() });
      }
      if (arr.length > count) arr.length = count;
      return arr;
    },
    render(ctx, w, h, params, t, surfaceId) {
      const count = Math.round(params.count ?? 80);
      const sp = params.speed ?? 1;
      const baseHue = params.hue ?? 260;
      const particles = this._getParticles(surfaceId ?? 'default', count);

      ctx.fillStyle = `rgba(0,0,0,0.18)`;
      ctx.fillRect(0, 0, w, h);

      for (const p of particles) {
        p.x += p.vx * sp; p.y += p.vy * sp; p.life += 0.005 * sp;
        if (p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1 || p.life > 1) {
          p.x = Math.random(); p.y = Math.random();
          p.vx = (Math.random()-0.5)*0.002; p.vy = (Math.random()-0.5)*0.002;
          p.r = Math.random()*3+1; p.life = 0; p.hue = Math.random()*60;
        }
        const opacity = Math.sin(p.life * Math.PI);
        const hue = (baseHue + p.hue + t * 20) % 360;
        ctx.beginPath();
        ctx.arc(p.x * w, p.y * h, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `hsla(${hue}, 90%, 70%, ${opacity})`;
        ctx.fill();
      }

      // connecting lines
      ctx.save();
      ctx.globalAlpha = 0.15;
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = (particles[i].x - particles[j].x) * w;
          const dy = (particles[i].y - particles[j].y) * h;
          const d = Math.hypot(dx, dy);
          if (d < 60) {
            ctx.strokeStyle = `hsl(${baseHue}, 80%, 70%)`;
            ctx.lineWidth = 1 - d / 60;
            ctx.beginPath();
            ctx.moveTo(particles[i].x * w, particles[i].y * h);
            ctx.lineTo(particles[j].x * w, particles[j].y * h);
            ctx.stroke();
          }
        }
      }
      ctx.restore();
    }
  },

  fire: {
    label: 'Fire',
    params: { intensity: { label: 'Intensity', min: 0.1, max: 1, step: 0.05, default: 0.8 }, speed: { label: 'Speed', min: 0.5, max: 5, step: 0.1, default: 2 } },
    _bufs: new Map(),
    _getBuf(id, cols, rows) {
      const key = `${id}_${cols}_${rows}`;
      if (!this._bufs.has(key)) this._bufs.set(key, new Float32Array(cols * rows).fill(0));
      return this._bufs.get(key);
    },
    render(ctx, w, h, params, t, surfaceId) {
      const cols = 80, rows = 60;
      const buf = this._getBuf(surfaceId ?? 'f', cols, rows);
      const intensity = params.intensity ?? 0.8;
      const sp = params.speed ?? 2;
      // seed bottom row
      for (let x = 0; x < cols; x++) {
        buf[(rows-1)*cols + x] = Math.random() > (1 - intensity) ? 1 : buf[(rows-1)*cols + x] * 0.9;
      }
      // propagate upward
      for (let y = rows - 2; y >= 0; y--) {
        for (let x = 0; x < cols; x++) {
          const cooling = 0.98 - Math.random() * 0.04 * sp;
          const below = buf[(y+1)*cols + x];
          const bl = buf[(y+1)*cols + Math.max(0, x-1)];
          const br = buf[(y+1)*cols + Math.min(cols-1, x+1)];
          buf[y*cols + x] = ((below + bl + br) / 3) * cooling;
        }
      }
      // draw
      const img = ctx.createImageData(cols, rows);
      const d = img.data;
      for (let i = 0; i < cols * rows; i++) {
        const v = Math.min(1, buf[i]);
        const r = Math.min(255, v * 3 * 255);
        const g = Math.min(255, Math.max(0, (v - 0.33) * 3 * 255));
        const b = Math.min(255, Math.max(0, (v - 0.66) * 3 * 255));
        d[i*4] = r; d[i*4+1] = g; d[i*4+2] = b; d[i*4+3] = 255;
      }
      const tmp = document.createElement('canvas');
      tmp.width = cols; tmp.height = rows;
      tmp.getContext('2d').putImageData(img, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(tmp, 0, 0, w, h);
    }
  },

  noise: {
    label: 'Noise',
    params: { speed: { label: 'Speed', min: 0.1, max: 5, step: 0.1, default: 0.8 }, scale: { label: 'Scale', min: 1, max: 20, step: 0.5, default: 8 }, hue: { label: 'Hue', min: 0, max: 360, step: 1, default: 0 }, rainbow: { label: 'Rainbow', min: 0, max: 1, step: 1, default: 1 }, global: { label: 'Global', min: 0, max: 1, step: 1, default: 0 } },
    render(ctx, w, h, params, t, surfaceId, corners) {
      const res = 96;
      const img = ctx.createImageData(res, res);
      const d = img.data;
      const isGlobal = (params.global ?? 0) > 0.5;
      const GS = 512;
      const sc = (params.scale ?? 8) / (isGlobal ? GS : res);
      const sp = params.speed ?? 0.8;
      const baseHue = params.hue ?? 0;
      const rainbow = (params.rainbow ?? 1) > 0.5;
      for (let py = 0; py < res; py++) {
        for (let px = 0; px < res; px++) {
          let x, y;
          if (isGlobal && corners) {
            const u = px / res, v = py / res;
            x = (corners[0].x*(1-u)*(1-v) + corners[1].x*u*(1-v) + corners[3].x*(1-u)*v + corners[2].x*u*v) * GS;
            y = (corners[0].y*(1-u)*(1-v) + corners[1].y*u*(1-v) + corners[3].y*(1-u)*v + corners[2].y*u*v) * GS;
          } else {
            x = px; y = py;
          }
          const n = Math.sin(x*sc*3.7 + t*sp) * Math.cos(y*sc*2.9 + t*sp*0.6) +
                    Math.sin((x+y)*sc*1.5 + t*sp*1.4) * 0.5;
          const val = (n + 1.5) / 3;
          const hue = rainbow ? ((baseHue + val * 360 + t * 30 * sp) % 360) : baseHue;
          const [r, g, b] = hslToRgb(hue/360, 0.85, 0.3 + val * 0.45);
          const i = (py * res + px) * 4;
          d[i] = r*255; d[i+1] = g*255; d[i+2] = b*255; d[i+3] = 255;
        }
      }
      const tmp = document.createElement('canvas');
      tmp.width = res; tmp.height = res;
      tmp.getContext('2d').putImageData(img, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(tmp, 0, 0, w, h);
    }
  },

  grid: {
    label: 'Grid',
    params: {
      cols:      { label: 'Columns',   min: 1, max: 32, step: 1,   default: 8 },
      rows:      { label: 'Rows',      min: 1, max: 32, step: 1,   default: 8 },
      lineWidth: { label: 'Line Width', min: 1, max: 10, step: 0.5, default: 3 },
      opacity:   { label: 'Opacity',   min: 0.1, max: 1, step: 0.05, default: 1 },
    },
    render(ctx, w, h, params) {
      const cols = Math.round(params.cols ?? 8);
      const rows = Math.round(params.rows ?? 8);
      const lw   = params.lineWidth ?? 2;
      const op   = params.opacity ?? 1;

      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, w, h);

      ctx.strokeStyle = `rgba(255,255,255,${op})`;
      ctx.lineWidth = lw;
      ctx.lineCap = 'square';

      for (let i = 0; i <= cols; i++) {
        const x = (i / cols) * w;
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
      }
      for (let i = 0; i <= rows; i++) {
        const y = (i / rows) * h;
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
      }


    }
  },

  checkerboard: {
    label: 'Checkerboard',
    params: { cols: { label: 'Columns', min: 2, max: 32, step: 1, default: 8 }, rows: { label: 'Rows', min: 2, max: 32, step: 1, default: 8 }, speed: { label: 'Speed', min: 0, max: 5, step: 0.1, default: 1 } },
    render(ctx, w, h, params, t) {
      const cols = Math.round(params.cols ?? 8);
      const rows = Math.round(params.rows ?? 8);
      const sp = params.speed ?? 1;
      const cw = w / cols, ch = h / rows;
      const phase = Math.floor(t * sp) % 2;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const isWhite = (r + c + phase) % 2 === 0;
          ctx.fillStyle = isWhite ? '#ffffff' : '#000000';
          ctx.fillRect(c * cw, r * ch, cw, ch);
        }
      }
    }
  },

  // ── Optical-illusion / VJ effects ────────────────────────────────────────────

  tunnel: {
    label: 'Tunnel',
    params: {
      speed:  { label: 'Speed',       min: 0.1, max: 8,   step: 0.1,  default: 2 },
      count:  { label: 'Rings',       min: 4,   max: 30,  step: 1,    default: 12 },
      shape:  { label: 'Sq / Circle', min: 0,   max: 1,   step: 1,    default: 0 },
      rotate: { label: 'Rotation',    min: 0,   max: 3,   step: 0.05, default: 0 },
      cx:     { label: 'Center X',    min: 0,   max: 1,   step: 0.01, default: 0.5 },
      cy:     { label: 'Center Y',    min: 0,   max: 1,   step: 0.01, default: 0.5 },
    },
    render(ctx, w, h, params, t) {
      const N    = Math.round(params.count ?? 12);
      const sp   = params.speed  ?? 2;
      const circ = (params.shape  ?? 0) > 0.5;
      const rot  = params.rotate ?? 0;
      const cx   = (params.cx ?? 0.5) * w;
      const cy   = (params.cy ?? 0.5) * h;
      const phase = (t * sp) % 1;
      const slot  = Math.floor(t * sp);

      // Max extents from center to the furthest canvas edge/corner
      const maxHW = Math.max(cx, w - cx);
      const maxHH = Math.max(cy, h - cy);
      const maxR  = Math.sqrt(maxHW * maxHW + maxHH * maxHH);

      // Background = colour of the ring that would be size > 1
      ctx.fillStyle = (N + slot) % 2 === 0 ? '#fff' : '#000';
      ctx.fillRect(0, 0, w, h);

      for (let i = N - 1; i >= 0; i--) {
        const size = (i + phase) / N;
        if (size <= 0) continue;
        ctx.fillStyle = (i + slot) % 2 === 0 ? '#fff' : '#000';
        if (circ) {
          ctx.beginPath();
          ctx.arc(cx, cy, maxR * size, 0, 2 * Math.PI);
          ctx.fill();
        } else if (rot > 0) {
          ctx.save();
          ctx.translate(cx, cy);
          ctx.rotate(t * rot + i * 0.05);
          ctx.fillRect(-maxHW * size, -maxHH * size, maxHW * size * 2, maxHH * size * 2);
          ctx.restore();
        } else {
          ctx.fillRect(cx - maxHW * size, cy - maxHH * size, maxHW * size * 2, maxHH * size * 2);
        }
      }
    }
  },

  spiral: {
    label: 'Spiral',
    params: {
      speed: { label: 'Speed', min: 0.1, max: 5,   step: 0.1, default: 1 },
      arms:  { label: 'Arms',  min: 1,   max: 8,   step: 1,   default: 2 },
      zoom:  { label: 'Zoom',  min: 1,   max: 12,  step: 0.5, default: 3 },
      color: { label: 'Color', min: 0,   max: 1,   step: 1,   default: 0 },
    },
    render(ctx, w, h, params, t) {
      const arms     = Math.round(params.arms ?? 2);
      const sp       = params.speed ?? 1;
      const zoom     = params.zoom  ?? 3;
      const useColor = (params.color ?? 0) > 0.5;
      const res      = 192;
      const img      = ctx.createImageData(res, res);
      const d        = img.data;
      for (let py = 0; py < res; py++) {
        for (let px = 0; px < res; px++) {
          const dx = (px - res/2) / (res/2), dy = (py - res/2) / (res/2);
          const r  = Math.sqrt(dx*dx + dy*dy);
          const th = Math.atan2(dy, dx);
          const val  = ((th / (2*Math.PI)) * arms + r * zoom - t * sp * arms + 200) % 1;
          const band = Math.floor(val * 2) % 2;
          let ri, gi, bi;
          if (useColor) {
            const hf = (th / (2*Math.PI) + r * 0.3 + t * 0.05 * sp + 1) % 1;
            const [hr, hg, hb] = hslToRgb(hf, 1, band ? 0.55 : 0.15);
            ri = hr*255; gi = hg*255; bi = hb*255;
          } else {
            ri = gi = bi = band ? 255 : 0;
          }
          const i = (py*res+px)*4;
          d[i]=ri; d[i+1]=gi; d[i+2]=bi; d[i+3]=255;
        }
      }
      const tmp = document.createElement('canvas');
      tmp.width = tmp.height = res;
      tmp.getContext('2d').putImageData(img, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(tmp, 0, 0, w, h);
    }
  },

  rays: {
    label: 'Rays',
    params: {
      speed: { label: 'Speed', min: 0.1, max: 5,   step: 0.1,  default: 1 },
      count: { label: 'Rays',  min: 3,   max: 32,  step: 1,    default: 12 },
      hue:   { label: 'Hue',   min: 0,   max: 360, step: 1,    default: 40 },
      width: { label: 'Width', min: 0.1, max: 1,   step: 0.05, default: 0.5 },
    },
    render(ctx, w, h, params, t) {
      const count = Math.round(params.count ?? 12);
      const sp    = params.speed ?? 1;
      const hue   = params.hue   ?? 40;
      const width = params.width ?? 0.5;
      const R     = Math.sqrt(w*w + h*h) / 2 + 2;
      const step  = (Math.PI * 2) / count;
      const rot   = t * sp;

      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, w, h);

      for (let i = 0; i < count; i++) {
        const a1 = rot + i * step;
        const a2 = a1 + step * width;
        const rayHue = (hue + i * (360/count)) % 360;
        const grad = ctx.createRadialGradient(w/2, h/2, 0, w/2, h/2, R);
        grad.addColorStop(0,   `hsla(${rayHue},100%,95%,0.9)`);
        grad.addColorStop(0.35,`hsla(${rayHue},100%,60%,0.7)`);
        grad.addColorStop(1,   `hsla(${rayHue},100%,30%,0)`);
        ctx.beginPath();
        ctx.moveTo(w/2, h/2);
        ctx.arc(w/2, h/2, R, a1, a2);
        ctx.closePath();
        ctx.fillStyle = grad;
        ctx.fill();
      }
    }
  },

  moire: {
    label: 'Moiré',
    params: {
      speed:   { label: 'Speed',   min: 0.1, max: 5,  step: 0.1, default: 0.4 },
      density: { label: 'Density', min: 4,   max: 40, step: 1,   default: 14 },
      angle:   { label: 'Angle °', min: 0,   max: 45, step: 1,   default: 7 },
      color:   { label: 'Color',   min: 0,   max: 1,  step: 1,   default: 0 },
    },
    render(ctx, w, h, params, t) {
      const sp      = params.speed   ?? 0.4;
      const density = params.density ?? 14;
      const angle   = (params.angle  ?? 7) * Math.PI / 180;
      const useColor = (params.color ?? 0) > 0.5;
      const res = 160;
      const img = ctx.createImageData(res, res);
      const d   = img.data;
      const shift = t * sp;
      const cos = Math.cos(angle), sin = Math.sin(angle);
      for (let py = 0; py < res; py++) {
        for (let px = 0; px < res; px++) {
          const nx = px/res, ny = py/res;
          const v1 = Math.sin((ny + shift*0.31) * density * Math.PI * 2);
          const rx = nx*cos - ny*sin;
          const v2 = Math.sin((rx - shift*0.19) * density * Math.PI * 2);
          const v  = (v1*v2 + 1) * 0.5;
          let ri, gi, bi;
          if (useColor) {
            const [hr, hg, hb] = hslToRgb(((v*300 + t*30*sp) % 360) / 360, 0.9, 0.15 + v*0.65);
            ri=hr*255; gi=hg*255; bi=hb*255;
          } else {
            ri=gi=bi=Math.round(v*255);
          }
          const i=(py*res+px)*4;
          d[i]=ri; d[i+1]=gi; d[i+2]=bi; d[i+3]=255;
        }
      }
      const tmp = document.createElement('canvas');
      tmp.width = tmp.height = res;
      tmp.getContext('2d').putImageData(img, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(tmp, 0, 0, w, h);
    }
  },

  ripple: {
    label: 'Ripple',
    params: {
      speed: { label: 'Speed',     min: 0.1, max: 5,   step: 0.1,  default: 1.5 },
      count: { label: 'Rings',     min: 2,   max: 12,  step: 1,    default: 5 },
      hue:   { label: 'Hue',       min: 0,   max: 360, step: 1,    default: 200 },
      thick: { label: 'Thickness', min: 0.01,max: 0.5, step: 0.01, default: 0.12 },
    },
    render(ctx, w, h, params, t) {
      const N     = Math.round(params.count ?? 5);
      const sp    = params.speed ?? 1.5;
      const hue   = params.hue   ?? 200;
      const thick = params.thick ?? 0.12;
      const maxR  = Math.min(w, h) * 0.5;
      const phase = (t * sp) % 1;

      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, w, h);

      for (let i = 0; i < N; i++) {
        const p       = (i/N + phase) % 1;
        const r       = maxR * p;
        const alpha   = (1 - p) * 0.9;
        const lineW   = thick * maxR * (1 - p * 0.5);
        const ringHue = (hue + i*(360/N) + t*20*sp) % 360;
        ctx.beginPath();
        ctx.arc(w/2, h/2, r, 0, 2*Math.PI);
        ctx.strokeStyle = `hsla(${ringHue},100%,65%,${alpha})`;
        ctx.lineWidth = lineW;
        ctx.stroke();
      }
    }
  },

  starfield: {
    label: 'Starfield',
    params: {
      speed: { label: 'Speed',  min: 0.5, max: 12,  step: 0.5, default: 4 },
      count: { label: 'Stars',  min: 50,  max: 400, step: 10,  default: 150 },
      hue:   { label: 'Hue',    min: 0,   max: 360, step: 1,   default: 210 },
      trail: { label: 'Trails', min: 0,   max: 1,   step: 1,   default: 1 },
    },
    render(ctx, w, h, params, t) {
      const count  = Math.round(params.count ?? 150);
      const sp     = params.speed ?? 4;
      const hue    = params.hue   ?? 210;
      const trails = (params.trail ?? 1) > 0.5;
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);
      const persp = 0.6;
      for (let i = 0; i < count; i++) {
        // Deterministic per-star hash
        const h1 = Math.sin(i*127.1)*43758.5; const sx = h1 - Math.floor(h1);
        const h2 = Math.sin(i*311.7)*43758.5; const sy = h2 - Math.floor(h2);
        const h3 = Math.sin(i*74.31)*43758.5; const sz = h3 - Math.floor(h3);
        const rate = sz*0.5 + 0.5;
        const z  = 1 - ((t*sp*rate*0.15 + sz) % 1);
        if (z <= 0.01) continue;
        const screenX = (sx-0.5)/(z*persp)*w + w/2;
        const screenY = (sy-0.5)/(z*persp)*h + h/2;
        if (screenX < -w || screenX > 2*w || screenY < -h || screenY > 2*h) continue;
        const brightness = Math.min(1, (1-z)*1.5);
        const size = (1-z)*2.5 + 0.3;
        const starHue = (hue + sx*60) % 360;
        if (trails && sp > 2) {
          const z2 = z + 0.04;
          const ox = (sx-0.5)/(z2*persp)*w + w/2;
          const oy = (sy-0.5)/(z2*persp)*h + h/2;
          ctx.beginPath(); ctx.moveTo(screenX, screenY); ctx.lineTo(ox, oy);
          ctx.strokeStyle = `hsla(${starHue},70%,90%,${brightness*0.6})`;
          ctx.lineWidth = size*0.6; ctx.stroke();
        }
        ctx.beginPath(); ctx.arc(screenX, screenY, size, 0, 2*Math.PI);
        ctx.fillStyle = `hsla(${starHue},80%,${70+brightness*30}%,${brightness})`;
        ctx.fill();
      }
    }
  },

  glitch: {
    label: 'Glitch',
    params: {
      speed:     { label: 'Speed',     min: 1,   max: 20,  step: 1,    default: 6 },
      intensity: { label: 'Intensity', min: 0.1, max: 1,   step: 0.05, default: 0.65 },
      hue:       { label: 'Hue',       min: 0,   max: 360, step: 1,    default: 200 },
      bands:     { label: 'Bands',     min: 4,   max: 30,  step: 1,    default: 14 },
    },
    render(ctx, w, h, params, t) {
      const sp        = params.speed     ?? 6;
      const intensity = params.intensity ?? 0.65;
      const hue       = params.hue       ?? 200;
      const bands     = Math.round(params.bands ?? 14);
      const bh        = h / bands;
      const frame     = Math.floor(t * sp);

      ctx.fillStyle = '#04050e';
      ctx.fillRect(0, 0, w, h);

      for (let i = 0; i < bands; i++) {
        // Deterministic hash per band per frame
        const n1 = (Math.sin(i*127.1 + frame*311.7)*43758.5 + 1e5) % 1;
        const n2 = (Math.sin(i*269.5 + frame*74.31)*43758.5 + 1e5) % 1;
        const n3 = (Math.sin(i*419.2 + frame*183.3)*43758.5 + 1e5) % 1;
        const active   = n1 < intensity;
        const xShift   = active ? (n2-0.5)*w*0.4 : 0;
        const bandHue  = (hue + n3*120 - 60 + 360) % 360;
        const bright   = 20 + n2*50;
        const y        = i * bh;

        ctx.fillStyle = active ? `hsl(${bandHue},90%,${bright}%)` : `hsl(${hue},20%,6%)`;
        ctx.fillRect(xShift, y, w, bh);

        // Chromatic aberration on heavy glitch bands
        if (active && n1 > intensity * 0.65) {
          ctx.save();
          ctx.globalCompositeOperation = 'screen';
          ctx.globalAlpha = 0.65;
          ctx.fillStyle = 'rgba(255,0,60,1)';
          ctx.fillRect(xShift-4, y, w, bh*0.5);
          ctx.fillStyle = 'rgba(0,200,255,1)';
          ctx.fillRect(xShift+4, y+bh*0.5, w, bh*0.5);
          ctx.restore();
        }
      }

      // Sparse bright horizontal noise lines
      const lineCount = Math.ceil(intensity * 4);
      for (let l = 0; l < lineCount; l++) {
        const nl = (Math.sin(l*31.1 + frame*7.3)*43758.5 + 1e5) % 1;
        ctx.fillStyle = `rgba(255,255,255,0.55)`;
        ctx.fillRect(0, Math.floor(nl*h), w, 1);
      }

      // CRT scanlines
      ctx.save(); ctx.globalAlpha = 0.1;
      for (let y = 0; y < h; y += 2) { ctx.fillStyle='#000'; ctx.fillRect(0,y,w,1); }
      ctx.restore();
    }
  },

  mandala: {
    label: 'Mandala',
    params: {
      speed:    { label: 'Speed',    min: 0.05, max: 3,   step: 0.05, default: 0.4 },
      layers:   { label: 'Layers',   min: 2,    max: 8,   step: 1,    default: 4 },
      symmetry: { label: 'Symmetry', min: 3,    max: 12,  step: 1,    default: 6 },
      hue:      { label: 'Hue',      min: 0,    max: 360, step: 1,    default: 280 },
    },
    render(ctx, w, h, params, t) {
      const sp   = params.speed    ?? 0.4;
      const layers = Math.round(params.layers   ?? 4);
      const sym  = Math.round(params.symmetry ?? 6);
      const hue  = params.hue      ?? 280;
      const maxR = Math.min(w, h) * 0.46;

      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);
      ctx.save(); ctx.translate(w/2, h/2);

      for (let layer = 0; layer < layers; layer++) {
        const r     = maxR * (layer+1) / layers;
        const dir   = layer % 2 === 0 ? 1 : -1;
        const rot   = t * sp * dir * (0.6 + layer*0.25);
        const sides = sym + layer;
        const lHue  = (hue + layer*(360/layers)) % 360;
        const alpha = 0.85 - layer*0.12;

        ctx.save(); ctx.rotate(rot);

        // Polygon outline
        ctx.beginPath();
        for (let s = 0; s < sides; s++) {
          const a = s*(2*Math.PI/sides);
          s === 0 ? ctx.moveTo(Math.cos(a)*r, Math.sin(a)*r) : ctx.lineTo(Math.cos(a)*r, Math.sin(a)*r);
        }
        ctx.closePath();
        ctx.strokeStyle = `hsla(${lHue},90%,65%,${alpha})`;
        ctx.lineWidth = 1.5; ctx.stroke();

        // Spoke lines
        for (let s = 0; s < sides; s++) {
          const a = s*(2*Math.PI/sides);
          ctx.beginPath(); ctx.moveTo(0,0);
          ctx.lineTo(Math.cos(a)*r, Math.sin(a)*r);
          ctx.strokeStyle = `hsla(${(lHue+30)%360},80%,50%,${alpha*0.35})`;
          ctx.lineWidth = 0.8; ctx.stroke();
        }

        // Vertex dots
        for (let s = 0; s < sides; s++) {
          const a  = s*(2*Math.PI/sides);
          const vr = r * 0.07;
          ctx.beginPath(); ctx.arc(Math.cos(a)*r, Math.sin(a)*r, vr, 0, 2*Math.PI);
          ctx.fillStyle = `hsla(${lHue},100%,80%,${alpha})`; ctx.fill();
        }

        ctx.restore();
      }

      // Centre jewel
      ctx.beginPath(); ctx.arc(0, 0, maxR*0.04, 0, 2*Math.PI);
      ctx.fillStyle = `hsl(${hue},100%,92%)`; ctx.fill();
      ctx.restore();
    }
  },

  scanner: {
    label: 'Scanner',
    params: {
      speed:  { label: 'Speed',     min: 0.1, max: 5,   step: 0.1,  default: 1 },
      dir:    { label: 'H / V',     min: 0,   max: 1,   step: 1,    default: 0 },
      width:  { label: 'Beam',      min: 0.05,max: 0.5, step: 0.01, default: 0.15 },
      hue:    { label: 'Hue',       min: 0,   max: 360, step: 1,    default: 120 },
    },
    render(ctx, w, h, params, t) {
      const sp    = params.speed ?? 1;
      const horiz = (params.dir ?? 0) < 0.5;
      const bw    = params.width ?? 0.15;
      const hue   = params.hue   ?? 120;

      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);

      // Ping-pong 0→1→0
      const cycle = (t * sp) % 2;
      const pos   = cycle <= 1 ? cycle : 2 - cycle;

      if (horiz) {
        const y   = pos * h;
        const bh2 = bw * h;
        const g   = ctx.createLinearGradient(0, y-bh2, 0, y+bh2);
        g.addColorStop(0,   `hsla(${hue},100%,60%,0)`);
        g.addColorStop(0.35,`hsla(${hue},100%,70%,0.55)`);
        g.addColorStop(0.5, `hsla(${hue},100%,95%,1)`);
        g.addColorStop(0.65,`hsla(${hue},100%,70%,0.55)`);
        g.addColorStop(1,   `hsla(${hue},100%,60%,0)`);
        ctx.fillStyle = g; ctx.fillRect(0, y-bh2, w, bh2*2);
        // Trail
        for (let k = 1; k <= 10; k++) {
          const tp = pos - k*0.018*sp;
          if (tp < 0 || tp > 1) continue;
          ctx.fillStyle = `hsla(${hue},90%,70%,${(1-k/10)*0.18})`;
          ctx.fillRect(0, tp*h-1, w, 2);
        }
      } else {
        const x   = pos * w;
        const bw2 = bw * w;
        const g   = ctx.createLinearGradient(x-bw2, 0, x+bw2, 0);
        g.addColorStop(0,   `hsla(${hue},100%,60%,0)`);
        g.addColorStop(0.35,`hsla(${hue},100%,70%,0.55)`);
        g.addColorStop(0.5, `hsla(${hue},100%,95%,1)`);
        g.addColorStop(0.65,`hsla(${hue},100%,70%,0.55)`);
        g.addColorStop(1,   `hsla(${hue},100%,60%,0)`);
        ctx.fillStyle = g; ctx.fillRect(x-bw2, 0, bw2*2, h);
        // Trail
        for (let k = 1; k <= 10; k++) {
          const tp = pos - k*0.018*sp;
          if (tp < 0 || tp > 1) continue;
          ctx.fillStyle = `hsla(${hue},90%,70%,${(1-k/10)*0.18})`;
          ctx.fillRect(tp*w-1, 0, 2, h);
        }
      }
    }
  },
};

export const EFFECT_KEYS = Object.keys(EFFECTS);

// Content canvas pool — one offscreen canvas per surface
const contentCanvases = new Map();

export function getContentCanvas(surfaceId, w = 512, h = 512) {
  if (!contentCanvases.has(surfaceId)) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    contentCanvases.set(surfaceId, c);
  }
  const c = contentCanvases.get(surfaceId);
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  return c;
}

// Draw an image/video element onto a canvas respecting fitMode + crop offsets
function drawMediaToCanvas(ctx, source, W, H, content) {
  const fitMode = content.fitMode ?? 'fill';
  const srcW = source.naturalWidth ?? source.videoWidth ?? W;
  const srcH = source.naturalHeight ?? source.videoHeight ?? H;

  if (fitMode === 'fill' || !srcW || !srcH) {
    ctx.drawImage(source, 0, 0, W, H);
    return;
  }

  // cover: scale to fill canvas, then offset to crop
  const scale = Math.max(W / srcW, H / srcH);
  const dw = srcW * scale;
  const dh = srcH * scale;
  // cropX/cropY are 0-1 anchors: 0 = left/top edge, 1 = right/bottom edge
  const cropX = content.cropX ?? 0.5;
  const cropY = content.cropY ?? 0.5;
  const ox = -(dw - W) * cropX;
  const oy = -(dh - H) * cropY;

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, W, H);
  ctx.clip();
  ctx.drawImage(source, ox, oy, dw, dh);
  ctx.restore();
}

// Compute the quad's approximate pixel width/height given output dimensions,
// so cover mode can use a canvas that matches the quad's screen aspect ratio.
function quadPixelDims(corners, outW, outH) {
  if (!corners) return { w: 512, h: 512 };
  const c = corners.map(p => ({ x: p.x * outW, y: p.y * outH }));
  const avgW = (Math.hypot(c[1].x-c[0].x, c[1].y-c[0].y) + Math.hypot(c[2].x-c[3].x, c[2].y-c[3].y)) / 2;
  const avgH = (Math.hypot(c[3].x-c[0].x, c[3].y-c[0].y) + Math.hypot(c[2].x-c[1].x, c[2].y-c[1].y)) / 2;
  if (!avgW || !avgH) return { w: 512, h: 512 };
  const BASE = 512;
  const aspect = avgW / avgH;
  return aspect >= 1
    ? { w: BASE, h: Math.max(32, Math.round(BASE / aspect)) }
    : { w: Math.max(32, Math.round(BASE * aspect)), h: BASE };
}

// Render any content type to an offscreen canvas and return it
// outW/outH: the configured output resolution, used to compute correct canvas size for cover mode
// groupOverride: if set, use the group's effect+params (with global mode forced on)
export function renderContent(surface, t, outW = 1920, outH = 1080, groupOverride = null) {
  const { id, corners } = surface;
  const content = (groupOverride && surface.content.type === 'effect')
    ? { ...surface.content, effect: groupOverride.effect, params: { ...groupOverride.params, global: 1 } }
    : surface.content;

  // For cover mode, size the canvas to match the quad's screen aspect ratio
  // so the image is never double-distorted (once to fill the canvas, once to fill the quad)
  let W = 512, H = 512;
  if ((content.type === 'image' || content.type === 'video') && content.fitMode === 'cover') {
    ({ w: W, h: H } = quadPixelDims(corners, outW, outH));
  }

  const canvas = getContentCanvas(id, W, H);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, W, H);

  switch (content.type) {
    case 'color': {
      ctx.fillStyle = content.color ?? '#3a86ff';
      ctx.fillRect(0, 0, W, H);
      break;
    }
    case 'gradient': {
      let grad;
      const stops = content.stops ?? [{ color: '#3a86ff', pos: 0 }, { color: '#ff006e', pos: 1 }];
      if (content.gradientType === 'radial') {
        grad = ctx.createRadialGradient(W/2, H/2, 0, W/2, H/2, Math.sqrt(W*W+H*H)/2);
      } else {
        const angle = ((content.angle ?? 90) * Math.PI) / 180;
        const cx = W/2, cy = H/2, len = Math.sqrt(W*W+H*H)/2;
        grad = ctx.createLinearGradient(cx - Math.cos(angle)*len, cy - Math.sin(angle)*len, cx + Math.cos(angle)*len, cy + Math.sin(angle)*len);
      }
      for (const s of stops) grad.addColorStop(Math.max(0,Math.min(1,s.pos)), s.color);
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, H);
      break;
    }
    case 'image': {
      if (content._img) {
        drawMediaToCanvas(ctx, content._img, W, H, content);
      } else if (content.src) {
        const img = new Image();
        img.onload = () => { content._img = img; };
        img.src = content.src;
        ctx.fillStyle = '#222'; ctx.fillRect(0, 0, W, H);
      }
      break;
    }
    case 'video': {
      if (content._video && content._video.readyState >= 2) {
        drawMediaToCanvas(ctx, content._video, W, H, content);
      } else {
        ctx.fillStyle = '#111'; ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = '#555'; ctx.font = '24px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('▶ Video', W/2, H/2);
      }
      break;
    }
    case 'text': {
      ctx.fillStyle = content.background ?? '#000000';
      ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = content.color ?? '#ffffff';
      const sz = content.size ?? 72;
      ctx.font = `${content.bold ? 'bold ' : ''}${sz}px ${content.font ?? 'sans-serif'}`;
      ctx.textAlign = content.align ?? 'center';
      ctx.textBaseline = 'middle';
      const lines = (content.text ?? 'Text').split('\n');
      const lh = sz * 1.3;
      const startY = H/2 - (lines.length - 1) * lh / 2;
      const ax = content.align === 'left' ? 24 : content.align === 'right' ? W - 24 : W/2;
      lines.forEach((line, i) => ctx.fillText(line, ax, startY + i * lh));
      break;
    }
    case 'effect': {
      const effectKey = content.effect ?? 'plasma';
      const effect = EFFECTS[effectKey];
      if (effect) {
        effect.render(ctx, W, H, content.params ?? {}, t, id, surface.corners);
      }
      break;
    }
  }
  return canvas;
}
