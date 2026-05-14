// Homography math for perspective-correct quad warping

// Solve 8x8 linear system via Gaussian elimination with partial pivoting
function gaussElim(A, b) {
  const n = 8;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let maxRow = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[maxRow][col])) maxRow = r;
    }
    [M[col], M[maxRow]] = [M[maxRow], M[col]];
    if (Math.abs(M[col][col]) < 1e-12) continue;
    for (let r = col + 1; r < n; r++) {
      const f = M[r][col] / M[col][col];
      for (let k = col; k <= n; k++) M[r][k] -= f * M[col][k];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    if (Math.abs(M[r][r]) < 1e-12) continue;
    x[r] = M[r][n] / M[r][r];
    for (let k = r - 1; k >= 0; k--) M[k][n] -= M[k][r] * x[r];
  }
  return x;
}

// Compute 3x3 homography mapping 4 src points to 4 dst points
// src/dst: [[x,y], ...]
export function computeHomography(src, dst) {
  const A = [];
  const b = [];
  for (let i = 0; i < 4; i++) {
    const [sx, sy] = src[i];
    const [dx, dy] = dst[i];
    A.push([sx, sy, 1, 0, 0, 0, -dx * sx, -dx * sy]);
    b.push(dx);
    A.push([0, 0, 0, sx, sy, 1, -dy * sx, -dy * sy]);
    b.push(dy);
  }
  const h = gaussElim(A, b);
  return [[h[0], h[1], h[2]], [h[3], h[4], h[5]], [h[6], h[7], 1]];
}

// Invert a 3x3 matrix
export function invertMat3(m) {
  const [[a,b,c],[d,e,f],[g,h,k]] = m;
  const det = a*(e*k - f*h) - b*(d*k - f*g) + c*(d*h - e*g);
  if (Math.abs(det) < 1e-12) return null;
  const inv = 1 / det;
  return [
    [(e*k - f*h)*inv, (c*h - b*k)*inv, (b*f - c*e)*inv],
    [(f*g - d*k)*inv, (a*k - c*g)*inv, (c*d - a*f)*inv],
    [(d*h - e*g)*inv, (b*g - a*h)*inv, (a*e - b*d)*inv],
  ];
}

// Apply 3x3 homogeneous matrix to a 2D point, returns [x, y]
export function applyMat3(m, x, y) {
  const [[a,b,c],[d,e,f],[g,h,k]] = m;
  const w = g*x + h*y + k;
  return [(a*x + b*y + c) / w, (d*x + e*y + f) / w];
}

// Compute perspective-correct homogeneous UV attributes for quad vertices.
// corners: [{x,y}, {x,y}, {x,y}, {x,y}] normalized (0-1), order: TL,TR,BR,BL
// Returns [[u*q, v*q, q], ...] per vertex (for WebGL attribute)
export function computeHomogeneousUVs(corners) {
  const uvSrc = [[0,0],[1,0],[1,1],[0,1]];
  const pxDst = corners.map(c => [c.x, c.y]);
  const H = computeHomography(uvSrc, pxDst);
  const Hinv = invertMat3(H);
  if (!Hinv) return corners.map(() => [0, 0, 1]);
  return corners.map(({ x, y }) => {
    const [[a,b,c],[d,e,f],[g,h,k]] = Hinv;
    const q = g*x + h*y + k;
    return [a*x + b*y + c, d*x + e*y + f, q];
  });
}

// Convert normalized screen coord to WebGL clip space
export function toClip(x, y) {
  return [x * 2 - 1, -(y * 2 - 1)];
}

// HSL to RGB (all values 0-1)
export function hslToRgb(h, s, l) {
  let r, g, b;
  if (s === 0) { r = g = b = l; }
  else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1; if (t > 1) t -= 1;
      if (t < 1/6) return p + (q-p)*6*t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q-p)*(2/3-t)*6;
      return p;
    };
    r = hue2rgb(p, q, h + 1/3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1/3);
  }
  return [r, g, b];
}

// Test if point (px,py) is inside a quad defined by 4 corners [{x,y}]
export function pointInQuad(px, py, corners) {
  function cross(ax, ay, bx, by) { return ax*by - ay*bx; }
  for (let i = 0; i < 4; i++) {
    const a = corners[i], b = corners[(i+1)%4];
    if (cross(b.x-a.x, b.y-a.y, px-a.x, py-a.y) < 0) return false;
  }
  return true;
}

// Distance between two points
export function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
