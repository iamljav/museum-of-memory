/**
 * corruption.js — The Museum of Memory
 * Organic decay engine + double exposure compositing.
 * Everything is seed-driven. Nothing is exposed as a parameter.
 */

// ── Noise utilities ──────────────────────────────────────────────────────────

function seededRng(seed) {
  let s = seed >>> 0;
  return function () {
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    return (s >>> 0) / 0xffffffff;
  };
}

function buildPerm(rng) {
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  return p;
}

function makeNoise(rng) {
  const perm = buildPerm(rng);
  const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
  const lerp = (a, b, t) => a + t * (b - a);
  const grad = (h, x, y) => { const a = h * 2.3998; return Math.cos(a) * x + Math.sin(a) * y; };
  return function (x, y) {
    const xi = Math.floor(x) & 255, yi = Math.floor(y) & 255;
    const xf = x - Math.floor(x), yf = y - Math.floor(y);
    const u = fade(xf), v = fade(yf);
    const aa = perm[(perm[xi] + yi) & 255], ab = perm[(perm[xi] + yi + 1) & 255];
    const ba = perm[(perm[xi + 1] + yi) & 255], bb = perm[(perm[xi + 1] + yi + 1) & 255];
    return lerp(lerp(grad(aa,xf,yf), grad(ba,xf-1,yf), u), lerp(grad(ab,xf,yf-1), grad(bb,xf-1,yf-1), u), v);
  };
}

function fbm(nfn, x, y, oct, lac, rng) {
  let v = 0, a = 0.5, f = 1, m = 0;
  const ox = Array.from({length: oct}, () => rng() * 80 - 40);
  const oy = Array.from({length: oct}, () => rng() * 80 - 40);
  for (let i = 0; i < oct; i++) { v += nfn(x*f+ox[i], y*f+oy[i])*a; m+=a; a*=0.5; f*=lac; }
  return v / m;
}

function toSepia(r, g, b, t) {
  return [
    r + (r*0.393 + g*0.769 + b*0.189 - r) * t,
    g + (r*0.349 + g*0.686 + b*0.168 - g) * t,
    b + (r*0.272 + g*0.534 + b*0.131 - b) * t
  ];
}

function smoothstep(t) { return t * t * (3 - 2 * t); }
function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

// ── Single image corruption ──────────────────────────────────────────────────

function corruptImageData(imgData, w, h, seed) {
  const rng  = seededRng(seed);
  const nfn  = makeNoise(rng);

  const globalDecay = 0.55 + rng() * 0.45;
  const scaleX      = 1.8 + rng() * 3.6;
  const scaleY      = 1.8 + rng() * 3.6;
  const lacunarity  = 1.7 + rng() * 0.7;
  const sepiaBase   = 0.55 + rng() * 0.45;
  const paperR      = 200 + rng() * 18;
  const paperG      = 188 + rng() * 16;
  const paperB      = 168 + rng() * 16;
  const vigCx       = 0.3 + rng() * 0.4;
  const vigCy       = 0.3 + rng() * 0.4;
  const vigPow      = 1.0 + rng() * 2.2;
  const vigStr      = 0.5 + rng() * 0.9;
  const warpS       = 0.3 + rng() * 1.2;
  const warpA       = 0.06 + rng() * 0.14;
  const numP        = 8 + Math.floor(rng() * 20);
  const patches     = Array.from({length: numP}, () => ({
    cx: rng(), cy: rng(),
    rx: 0.02 + rng() * 0.28, ry: 0.015 + rng() * 0.18,
    angle: rng() * Math.PI, str: 0.4 + rng() * 0.6
  }));
  const w0       = 0.2 + rng() * 0.6;
  const w1       = 0.1 + rng() * 0.5;
  const w2       = 0.1 + rng() * 0.5;
  const wSum     = w0 + w1 + w2;
  const grainAmp = 18 + rng() * 40;

  const data = imgData.data;

  for (let py = 0; py < h; py++) {
    const ny = py / h;
    for (let px = 0; px < w; px++) {
      const nx = px / w;
      const idx = (py * w + px) * 4;
      let r = data[idx], g = data[idx+1], b = data[idx+2];

      const wx = fbm(nfn, nx*warpS+3.7, ny*warpS+9.2, 3, lacunarity, rng);
      const wy = fbm(nfn, nx*warpS+1.3, ny*warpS+6.8, 3, lacunarity, rng);
      const n1 = (fbm(nfn, nx*scaleX+wx*warpA*scaleX, ny*scaleY+wy*warpA*scaleY, 7, lacunarity, rng)+1)/2;
      const n2 = (fbm(nfn, nx*scaleX*1.8+41, ny*scaleY*1.8+17, 4, lacunarity, rng)+1)/2;
      const noiseMask = n1*0.6 + n2*0.4;

      const dx = (nx-vigCx)*1.6, dy = (ny-vigCy)*1.6;
      const vigMask = clamp(Math.pow(Math.max(0, Math.sqrt(dx*dx+dy*dy)-0.22), vigPow)*vigStr, 0, 1);

      let patchMask = 0;
      for (const p of patches) {
        const ca = Math.cos(p.angle), sa = Math.sin(p.angle);
        const rdx = (nx-p.cx)*ca - (ny-p.cy)*sa;
        const rdy = (nx-p.cx)*sa + (ny-p.cy)*ca;
        const dist = Math.sqrt((rdx/p.rx)**2 + (rdy/p.ry)**2);
        if (dist < 1) {
          const pn = (nfn(px*0.06+p.cx*25, py*0.06+p.cy*25)+1)/2;
          patchMask = Math.max(patchMask, (1-dist*dist)*p.str*(0.4+pn*0.6));
        }
      }

      const raw = (noiseMask*w0 + vigMask*w1 + patchMask*w2) / wSum;
      const decayAmt = clamp(raw * globalDecay * 1.5, 0, 1);

      const localSepia = clamp(sepiaBase*(0.3 + decayAmt*1.1), 0, 1);
      [r, g, b] = toSepia(r, g, b, localSepia);

      const fadeThresh = 0.38;
      if (decayAmt > fadeThresh) {
        const t = smoothstep((decayAmt - fadeThresh) / (1 - fadeThresh));
        r = r + (paperR - r) * t;
        g = g + (paperG - g) * t;
        b = b + (paperB - b) * t;
      }

      const gn = (nfn(px*0.35+(seed&0xff), py*0.35)+1)/2;
      const grain = (gn-0.5) * grainAmp * (0.1 + decayAmt*0.9);
      data[idx]   = clamp(r + grain, 0, 255);
      data[idx+1] = clamp(g + grain*0.86, 0, 255);
      data[idx+2] = clamp(b + grain*0.72, 0, 255);
    }
  }
  return imgData;
}

// ── Double exposure compositing ──────────────────────────────────────────────

/**
 * Available Canvas composite operations that produce interesting double exposures.
 * Excludes destructive/invisible modes.
 */
const BLEND_MODES = [
  'multiply',
  'screen',
  'overlay',
  'soft-light',
  'hard-light',
  'color-dodge',
  'color-burn',
  'difference',
  'exclusion',
  'luminosity',
  'color',
];

/**
 * Composite two already-corrupted canvases into a final ImageData.
 * @param {HTMLCanvasElement} canvasA - corrupted image A (reference size)
 * @param {HTMLCanvasElement} canvasB - corrupted image B (will be scaled/shifted)
 * @param {number} seed               - compositing seed
 * @returns {ImageData}
 */
function composeDouble(canvasA, canvasB, seed) {
  const rng = seededRng(seed ^ 0xdeadbeef);

  const W = canvasA.width;
  const H = canvasA.height;

  // Pick blend mode randomly
  const blendMode = BLEND_MODES[Math.floor(rng() * BLEND_MODES.length)];

  // Opacity weights — never fully transparent, always interesting
  const opacityA = 0.5 + rng() * 0.45;   // dominant layer
  const opacityB = 0.35 + rng() * 0.55;  // second layer

  // Positional drift — slight misalignment like a double-exposed frame
  // Max ±6% offset in each axis, seeded
  const driftX = (rng() - 0.5) * W * 0.12;
  const driftY = (rng() - 0.5) * H * 0.12;

  // Scale of second image — can be slightly zoomed in or out
  const scaleB = 0.88 + rng() * 0.26;

  // Optional horizontal flip of B (like winding the film backwards)
  const flipB = rng() > 0.6;

  // Compose on an offscreen canvas
  const out = document.createElement('canvas');
  out.width = W; out.height = H;
  const ctx = out.getContext('2d');

  // Layer A
  ctx.globalAlpha = opacityA;
  ctx.globalCompositeOperation = 'source-over';
  ctx.drawImage(canvasA, 0, 0, W, H);

  // Layer B — transformed
  ctx.save();
  ctx.globalAlpha = opacityB;
  ctx.globalCompositeOperation = blendMode;
  ctx.translate(W/2 + driftX, H/2 + driftY);
  ctx.scale(flipB ? -scaleB : scaleB, scaleB);
  ctx.drawImage(canvasB, -W/2, -H/2, W, H);
  ctx.restore();

  // Subtle unified tone pass — reinforce the sense of a single surface
  ctx.globalAlpha = 0.08 + rng() * 0.12;
  ctx.globalCompositeOperation = 'multiply';
  ctx.fillStyle = `rgb(${Math.floor(180 + rng()*30)},${Math.floor(160 + rng()*25)},${Math.floor(130 + rng()*25)})`;
  ctx.fillRect(0, 0, W, H);

  return out;
}

// ── Public API ───────────────────────────────────────────────────────────────

window.MemoryCorruption = {
  /**
   * Corrupt a single image. Returns a canvas element.
   * @param {HTMLImageElement} img
   * @param {number} seed
   */
  single(img, seed) {
    const MAX = 1400;
    let sw = img.naturalWidth, sh = img.naturalHeight;
    if (sw > MAX) { sh = Math.round(sh * MAX / sw); sw = MAX; }

    const cv = document.createElement('canvas');
    cv.width = sw; cv.height = sh;
    const ctx = cv.getContext('2d');
    ctx.drawImage(img, 0, 0, sw, sh);
    const id = ctx.getImageData(0, 0, sw, sh);
    corruptImageData(id, sw, sh, seed);
    ctx.putImageData(id, 0, 0);
    return cv;
  },

  /**
   * Create a double exposure from two images.
   * Each is independently corrupted, then composited.
   * @param {HTMLImageElement} imgA
   * @param {HTMLImageElement} imgB
   * @param {number} seedA  - corruption seed for image A
   * @param {number} seedB  - corruption seed for image B
   * @param {number} seedC  - compositing seed
   * @returns {HTMLCanvasElement}
   */
  double(imgA, imgB, seedA, seedB, seedC) {
    // Normalise both images to the same dimensions (A drives the frame)
    const MAX = 1400;
    let W = imgA.naturalWidth, H = imgA.naturalHeight;
    if (W > MAX) { H = Math.round(H * MAX / W); W = MAX; }

    // Corrupt A
    const cvA = document.createElement('canvas');
    cvA.width = W; cvA.height = H;
    const ctxA = cvA.getContext('2d');
    ctxA.drawImage(imgA, 0, 0, W, H);
    const idA = ctxA.getImageData(0, 0, W, H);
    corruptImageData(idA, W, H, seedA);
    ctxA.putImageData(idA, 0, 0);

    // Corrupt B (scaled to match A's frame)
    const cvB = document.createElement('canvas');
    cvB.width = W; cvB.height = H;
    const ctxB = cvB.getContext('2d');
    // Fit B into A's frame, preserving B's aspect ratio (cover)
    const ratioB = imgB.naturalWidth / imgB.naturalHeight;
    const ratioA = W / H;
    let bw, bh, bx, by;
    if (ratioB > ratioA) { bh = H; bw = bh * ratioB; bx = (W-bw)/2; by = 0; }
    else                 { bw = W; bh = bw / ratioB; bx = 0; by = (H-bh)/2; }
    ctxB.drawImage(imgB, bx, by, bw, bh);
    const idB = ctxB.getImageData(0, 0, W, H);
    corruptImageData(idB, W, H, seedB);
    ctxB.putImageData(idB, 0, 0);

    // Composite
    return composeDouble(cvA, cvB, seedC);
  }
};
