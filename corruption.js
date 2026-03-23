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
  const rng = seededRng(seed);
  const nfn = makeNoise(rng);

  // ── Global parameters ──────────────────────────────────────────────────
  const globalDecay   = 0.78 + rng() * 0.22;
  const scaleX        = 1.0 + rng() * 5.0;
  const scaleY        = 1.0 + rng() * 5.0;
  const lacunarity    = 1.6 + rng() * 0.8;
  const paperR        = 218 + rng() * 12;
  const paperG        = 202 + rng() * 12;
  const paperB        = 178 + rng() * 12;
  const vigCx         = 0.2 + rng() * 0.6;
  const vigCy         = 0.2 + rng() * 0.6;
  const vigPow        = 0.7 + rng() * 3.0;
  const vigStr        = 0.9 + rng() * 1.6;
  const warpS         = 0.4 + rng() * 2.0;
  const warpA         = 0.1 + rng() * 0.22;
  const eraseThresh   = 0.22 + rng() * 0.28;
  const edgeSharpness = 8 + rng() * 22;

  // ── Emulsion patches ───────────────────────────────────────────────────
  const numP   = 14 + Math.floor(rng() * 28);
  const patches = Array.from({length: numP}, () => ({
    cx: rng(), cy: rng(),
    rx: 0.05 + rng() * 0.42, ry: 0.04 + rng() * 0.32,
    angle: rng() * Math.PI, str: 0.65 + rng() * 0.35
  }));
  const w0 = 0.25 + rng() * 0.5, w1 = 0.15 + rng() * 0.5, w2 = 0.15 + rng() * 0.5;
  const wSum = w0 + w1 + w2;

  // ── Heavy grain field ──────────────────────────────────────────────────
  const grainAmp     = 40 + rng() * 80;    // much heavier
  const grainScale   = 0.25 + rng() * 0.6; // spatial frequency of grain
  const grainTint    = rng() > 0.5;        // sometimes grain has a warm tint

  // ── Silver dots / halide clumping ──────────────────────────────────────
  // Pre-generate dot field: sparse bright specks scattered across survived areas
  const numDots      = Math.floor(w * h * (0.0008 + rng() * 0.003));
  const dots         = Array.from({length: numDots}, () => ({
    x: Math.floor(rng() * w),
    y: Math.floor(rng() * h),
    r: 0.5 + rng() * 3.5,   // radius in pixels
    v: 180 + rng() * 75      // brightness
  }));
  // Rasterise dot field into a lookup map for O(1) per pixel
  const dotMap = new Float32Array(w * h);
  for (const d of dots) {
    const x0 = Math.max(0, Math.floor(d.x - d.r - 1));
    const x1 = Math.min(w - 1, Math.ceil(d.x + d.r + 1));
    const y0 = Math.max(0, Math.floor(d.y - d.r - 1));
    const y1 = Math.min(h - 1, Math.ceil(d.y + d.r + 1));
    for (let dy = y0; dy <= y1; dy++) {
      for (let dx = x0; dx <= x1; dx++) {
        const dist = Math.sqrt((dx - d.x) ** 2 + (dy - d.y) ** 2);
        if (dist <= d.r) {
          const t = 1 - dist / d.r;
          dotMap[dy * w + dx] = Math.max(dotMap[dy * w + dx], t * (d.v / 255));
        }
      }
    }
  }

  // ── Scratches ──────────────────────────────────────────────────────────
  // Line scratches: long thin trajectories, can be straight or slightly curved
  const numScratches = 2 + Math.floor(rng() * 14);
  const scratches    = Array.from({length: numScratches}, () => {
    const vertical = rng() > 0.4;  // mostly vertical, like film scratches
    return {
      pos:      vertical ? rng() * w : rng() * h,   // x for vertical, y for horizontal
      vertical,
      width:    0.5 + rng() * 2.5,
      bright:   rng() > 0.5,   // bright (overexposed) or dark (underexposed) scratch
      strength: 0.5 + rng() * 0.5,
      waver:    rng() * 0.015,  // how much the scratch wavers along its length
      wavFreq:  2 + rng() * 8,  // frequency of waver
      start:    rng() * 0.3,    // scratch doesn't always run full length
      end:      0.7 + rng() * 0.3,
    };
  });

  // Rasterise scratches into a map: positive = bright, negative = dark
  const scratchMap = new Float32Array(w * h);
  for (const s of scratches) {
    for (let i = 0; i < (s.vertical ? h : w); i++) {
      const t = i / (s.vertical ? h : w);
      if (t < s.start || t > s.end) continue;
      const waver = Math.sin(t * s.wavFreq * Math.PI * 2) * s.waver * (s.vertical ? w : h);
      const pos = s.pos + waver;
      const lo = Math.floor(pos - s.width), hi = Math.ceil(pos + s.width);
      for (let j = lo; j <= hi; j++) {
        if (j < 0) continue;
        const dist = Math.abs(j - pos) / s.width;
        if (dist > 1) continue;
        const alpha = (1 - dist * dist) * s.strength;
        const idx = s.vertical
          ? clamp(i, 0, h - 1) * w + clamp(j, 0, w - 1)
          : clamp(j, 0, h - 1) * w + clamp(i, 0, w - 1);
        scratchMap[idx] = s.bright
          ? Math.max(scratchMap[idx],  alpha)
          : Math.min(scratchMap[idx], -alpha);
      }
    }
  }

  // ── Dust / micro-spots ─────────────────────────────────────────────────
  // Fine black or dark dust specks sitting on the paper surface
  const numDust  = Math.floor(w * h * (0.001 + rng() * 0.005));
  const dustMap  = new Float32Array(w * h);
  const dustSeeds = Array.from({length: numDust}, () => ({
    x: Math.floor(rng() * w), y: Math.floor(rng() * h),
    r: 0.3 + rng() * 1.8
  }));
  for (const d of dustSeeds) {
    const x0 = Math.max(0, Math.floor(d.x - d.r - 1));
    const x1 = Math.min(w - 1, Math.ceil(d.x + d.r + 1));
    const y0 = Math.max(0, Math.floor(d.y - d.r - 1));
    const y1 = Math.min(h - 1, Math.ceil(d.y + d.r + 1));
    for (let dy = y0; dy <= y1; dy++) {
      for (let dx = x0; dx <= x1; dx++) {
        const dist = Math.sqrt((dx - d.x) ** 2 + (dy - d.y) ** 2);
        if (dist <= d.r) dustMap[dy * w + dx] = Math.max(dustMap[dy * w + dx], 1 - dist / d.r);
      }
    }
  }

  // ── Halation bleed ─────────────────────────────────────────────────────
  // Bright halos around highlight regions — light bleeds through the base
  // Approximate by boosting bright pixels toward warm overexposed tone

  // ── Pixel loop ─────────────────────────────────────────────────────────
  const data = imgData.data;

  for (let py = 0; py < h; py++) {
    const ny = py / h;
    for (let px = 0; px < w; px++) {
      const nx  = px / w;
      const idx = (py * w + px) * 4;
      let r = data[idx], g = data[idx+1], b = data[idx+2];

      // Erasure mask ────────────────────────────────────────────────────
      const wx = fbm(nfn, nx*warpS+3.7, ny*warpS+9.2, 3, lacunarity, rng);
      const wy = fbm(nfn, nx*warpS+1.3, ny*warpS+6.8, 3, lacunarity, rng);
      const n1 = (fbm(nfn, nx*scaleX+wx*warpA*scaleX, ny*scaleY+wy*warpA*scaleY, 7, lacunarity, rng)+1)/2;
      const n2 = (fbm(nfn, nx*scaleX*1.8+41, ny*scaleY*1.8+17, 4, lacunarity, rng)+1)/2;
      const noiseMask = n1*0.6 + n2*0.4;

      const dxv = (nx-vigCx)*1.6, dyv = (ny-vigCy)*1.6;
      const vigMask = clamp(Math.pow(Math.max(0, Math.sqrt(dxv*dxv+dyv*dyv)-0.18), vigPow)*vigStr, 0, 1);

      let patchMask = 0;
      for (const p of patches) {
        const ca = Math.cos(p.angle), sa = Math.sin(p.angle);
        const rdx = (nx-p.cx)*ca - (ny-p.cy)*sa;
        const rdy = (nx-p.cx)*sa + (ny-p.cy)*ca;
        const dist = Math.sqrt((rdx/p.rx)**2 + (rdy/p.ry)**2);
        if (dist < 1) {
          const pn = (nfn(px*0.09+p.cx*30, py*0.09+p.cy*30)+1)/2;
          patchMask = Math.max(patchMask, (1 - dist*(0.7+pn*0.3)) * p.str);
        }
      }

      const raw      = (noiseMask*w0 + vigMask*w1 + patchMask*w2) / wSum * globalDecay;
      const norm     = (raw - eraseThresh) * edgeSharpness;
      const eraseAmt = clamp(1 / (1 + Math.exp(-norm)), 0, 1);
      const survived = 1 - eraseAmt;
      const surviveDecay = clamp(raw / eraseThresh, 0, 1);

      // Erase to paper ──────────────────────────────────────────────────
      r = r + (paperR - r) * eraseAmt;
      g = g + (paperG - g) * eraseAmt;
      b = b + (paperB - b) * eraseAmt;

      // Heavy grain ─────────────────────────────────────────────────────
      const gn = (nfn(px*grainScale+(seed&0xff), py*grainScale)+1)/2;
      const boundaryZone = eraseAmt * (1 - eraseAmt) * 4;
      const grainWeight  = 0.04 + surviveDecay*0.25 + boundaryZone*1.2;
      const grain = (gn - 0.5) * grainAmp * grainWeight;
      if (grainTint) {
        r = clamp(r + grain * 1.1, 0, 255);
        g = clamp(g + grain * 0.85, 0, 255);
        b = clamp(b + grain * 0.6,  0, 255);
      } else {
        r = clamp(r + grain, 0, 255);
        g = clamp(g + grain, 0, 255);
        b = clamp(b + grain, 0, 255);
      }

      // Silver dots / halide clumping ───────────────────────────────────
      const dotVal = dotMap[py * w + px];
      if (dotVal > 0) {
        // Dots appear more on survived + transitional areas
        const dotVisibility = survived * 0.5 + boundaryZone * 0.8;
        const dv = dotVal * dotVisibility;
        r = clamp(r + (paperR + 20 - r) * dv, 0, 255);
        g = clamp(g + (paperG + 10 - g) * dv, 0, 255);
        b = clamp(b + (paperB - 5  - b) * dv, 0, 255);
      }

      // Scratches ───────────────────────────────────────────────────────
      const sv = scratchMap[py * w + px];
      if (sv > 0) {
        // Bright scratch — overexposed line
        r = clamp(r + (255 - r) * sv * 0.85, 0, 255);
        g = clamp(g + (240 - g) * sv * 0.75, 0, 255);
        b = clamp(b + (200 - b) * sv * 0.6,  0, 255);
      } else if (sv < 0) {
        // Dark scratch — mechanical damage
        const da = -sv;
        r = clamp(r * (1 - da * 0.9), 0, 255);
        g = clamp(g * (1 - da * 0.9), 0, 255);
        b = clamp(b * (1 - da * 0.85), 0, 255);
      }

      // Dust specks ─────────────────────────────────────────────────────
      const dv2 = dustMap[py * w + px];
      if (dv2 > 0) {
        r = clamp(r * (1 - dv2 * 0.85), 0, 255);
        g = clamp(g * (1 - dv2 * 0.85), 0, 255);
        b = clamp(b * (1 - dv2 * 0.80), 0, 255);
      }

      data[idx]   = r;
      data[idx+1] = g;
      data[idx+2] = b;
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
