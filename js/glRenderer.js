import { computeHomogeneousUVs, toClip } from './math.js';

const VERT_SRC = `
  attribute vec2 a_pos;
  attribute vec3 a_uv;
  varying vec3 v_uv;
  void main() {
    gl_Position = vec4(a_pos, 0.0, 1.0);
    v_uv = a_uv;
  }
`;

const FRAG_SRC = `
  precision mediump float;
  varying vec3 v_uv;
  uniform sampler2D u_tex;
  uniform float u_opacity;
  void main() {
    vec2 uv = v_uv.xy / v_uv.z;
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) discard;
    vec4 c = texture2D(u_tex, uv);
    gl_FragColor = vec4(c.rgb, c.a * u_opacity);
  }
`;

function createShader(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    console.error('Shader error:', gl.getShaderInfoLog(s));
    gl.deleteShader(s);
    return null;
  }
  return s;
}

function createProgram(gl, vertSrc, fragSrc) {
  const prog = gl.createProgram();
  gl.attachShader(prog, createShader(gl, gl.VERTEX_SHADER, vertSrc));
  gl.attachShader(prog, createShader(gl, gl.FRAGMENT_SHADER, fragSrc));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    console.error('Program error:', gl.getProgramInfoLog(prog));
    return null;
  }
  return prog;
}

export class GLRenderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = canvas.getContext('webgl', { alpha: true, premultipliedAlpha: false });
    if (!this.gl) { console.error('WebGL not available'); return; }
    this._init();
    this._textures = new Map(); // surfaceId -> WebGLTexture
  }

  _init() {
    const gl = this.gl;
    this.prog = createProgram(gl, VERT_SRC, FRAG_SRC);
    this.a_pos = gl.getAttribLocation(this.prog, 'a_pos');
    this.a_uv = gl.getAttribLocation(this.prog, 'a_uv');
    this.u_tex = gl.getUniformLocation(this.prog, 'u_tex');
    this.u_opacity = gl.getUniformLocation(this.prog, 'u_opacity');
    this.buf = gl.createBuffer();
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }

  _getOrCreateTexture(surfaceId) {
    const gl = this.gl;
    if (!this._textures.has(surfaceId)) {
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      this._textures.set(surfaceId, tex);
    }
    return this._textures.get(surfaceId);
  }

  deleteTexture(surfaceId) {
    if (this._textures.has(surfaceId)) {
      this.gl.deleteTexture(this._textures.get(surfaceId));
      this._textures.delete(surfaceId);
    }
  }

  uploadTexture(surfaceId, source) {
    const gl = this.gl;
    const tex = this._getOrCreateTexture(surfaceId);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  }

  render(state, background = '#000000') {
    const gl = this.gl;
    if (!gl) return;

    const w = this.canvas.width, h = this.canvas.height;
    gl.viewport(0, 0, w, h);

    // Parse background color
    const bg = hexToRgb(background);
    gl.clearColor(bg[0]/255, bg[1]/255, bg[2]/255, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(this.prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(this.u_tex, 0);

    for (const surface of state.surfaces) {
      if (!surface.enabled) continue;

      const tex = this._textures.get(surface.id);
      if (!tex) continue;

      gl.bindTexture(gl.TEXTURE_2D, tex);

      // Set blend mode
      setBlendMode(gl, surface.blendMode ?? 'normal');

      // Compute clip-space positions and homogeneous UVs
      const corners = surface.corners; // [{x,y}] TL,TR,BR,BL
      const clipCorners = corners.map(c => toClip(c.x, c.y));
      const uvs = computeHomogeneousUVs(corners);

      // Build vertex data: [clipX, clipY, uvU*q, uvV*q, uvQ] * 4 vertices
      // Two triangles: (0,1,2), (0,2,3)
      const indices = [0, 1, 2, 0, 2, 3];
      const verts = [];
      for (const i of indices) {
        verts.push(clipCorners[i][0], clipCorners[i][1], uvs[i][0], uvs[i][1], uvs[i][2]);
      }

      gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.DYNAMIC_DRAW);

      const stride = 5 * 4;
      gl.enableVertexAttribArray(this.a_pos);
      gl.vertexAttribPointer(this.a_pos, 2, gl.FLOAT, false, stride, 0);
      gl.enableVertexAttribArray(this.a_uv);
      gl.vertexAttribPointer(this.a_uv, 3, gl.FLOAT, false, stride, 2 * 4);

      gl.uniform1f(this.u_opacity, surface.opacity ?? 1.0);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
  }
}

function hexToRgb(hex) {
  const r = parseInt(hex.slice(1,3),16) || 0;
  const g = parseInt(hex.slice(3,5),16) || 0;
  const b = parseInt(hex.slice(5,7),16) || 0;
  return [r, g, b];
}

function setBlendMode(gl, mode) {
  switch (mode) {
    case 'add':
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
      break;
    case 'multiply':
      gl.blendFunc(gl.DST_COLOR, gl.ONE_MINUS_SRC_ALPHA);
      break;
    case 'screen':
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_COLOR);
      break;
    default:
      gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }
}
