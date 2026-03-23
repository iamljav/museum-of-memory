/**
 * corruption.js
 * The Museum of Memory — organic image decay engine
 * All randomness driven by a single seed for full reproducibility.
 */

function seededRng(seed) {
  let s = seed >>> 0;
  return function () {
    s = Math.imul(s ^ (s >>> 16), 0x45d9f3b);
    s = Math.imul(s ^ (s >>> 16), 0x45d9f3b);
    s ^= s >>> 16;
    return (s >>> 0) / 0xffffffff;
  };
}

function buildPermutation(rng) {
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [p[i], p[j]] = [p[j], p[i]];
  }
  return p;
}

function makeNoise(rng) {
  const perm = buildPermutation(rng);
  const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
  const lerp = (a, b, t) => a + t * (b - a);
  const grad = (h, x, y) => {
    const angle = h * 2.3998315928905;
    return Math.cos(angle) * x + Math.sin(angle) * y;
  };
  return function noise(x, y) {
    const xi = Math.floor(x) & 255, yi = Math.floor(y) & 255;
    const xf = x - Math.floor(x), yf = y - Math.floor(y);
    const u = fade(xf), v = fade(yf);
    const aa = perm[(perm[xi] + yi) & 255];
    const ab = perm[(perm[xi] + yi + 1) & 255];
    const ba = perm[(perm[xi + 1] + yi) & 255];
    const bb = perm[(perm[xi + 1] + yi + 1) & 255];
    return lerp(
      lerp(grad(aa, xf, yf), grad(ba, xf - 1, yf), u),
      lerp(grad(ab, xf, yf - 1), grad(bb, xf - 1, yf - 1), u),
      v
    );
  };
}

function fbm(noise, x, y, octaves, lacunarity, rng) {
  let val = 0, amp = 0.5, freq = 1, max = 0;
  const offsets = Array.from({ length: octaves }, () => [rng() * 100, rng() * 100]);
  for (let i = 0; i < octaves; i++) {
    val += noise(x * freq + offsets[i][0], y * freq + offsets[i][1]) * amp;
    max += amp;
    amp *= 0.5;
    freq *= lacunarity;
  }
  return val / max;
}

function toSepia(r, g, b, amount) {
  const sr = r * 0.393 + g * 0.769 + b * 0.189;
  const sg = r * 0.349 + g * 0.686 + b * 0.168;
  const sb = r * 0.272 + g * 0.534 + b * 0.131;
  return [
    r + (sr - r) * amount,
    g + (sg - g) * amount,
    b + (sb - b) * amount
  ];
}

/**
 * Main entry point.
 * @param {ImageData} imageData - raw pixel data to corrupt in-place
 * @param {number} w - image width
 * @param {number} h - image height
 * @param {object} opts - { decay: 0–100, mode: string, sepia: 0–100, seed: number }
 */
function applyCorruption(imageData, w, h, opts) {
  const { decay, mode, sepia, seed } = opts;
  const rng = seededRng(seed);
  const noise = makeNoise(rng);

  const d = decay / 100;
  const sepiaStrength = sepia / 100;

  // Per-seed constants — each seed produces a unique decay landscape
  const scaleX = 2.5 + rng() * 2.5;
  const scaleY = 2.5 + rng() * 2.5;
  const lacunarity = 1.8 + rng() * 0.6;
  const vigCx = 0.35 + rng() * 0.3;
  const vigCy = 0.35 + rng() * 0.3;
  const vigPower = 1.2 + rng() * 1.2;
  const vigStrength = 0.4 + rng() * 0.7;

  // Paper / bleach-out colour (warm antique paper tone)
  const paperR = 210, paperG = 198, paperB = 180;

  // Emulsion patch constellation
  const numPatches = 5 + Math.floor(rng() * 16);
  const patches = Array.from({ length: numPatches }, () => ({
    cx: rng(),
    cy: rng(),
    rx: 0.03 + rng() * 0.22,
    ry: 0.02 + rng() * 0.14,
    angle: rng() * Math.PI,
    strength: 0.4 + rng() * 0.6,
    invert: rng() > 0.8  // occasionally a patch preserves rather than decays
  }));

  // Warp vectors — subtle local distortion in the noise sampling
  const warpScale = 0.4 + rng() * 0.8;
  const warpAmp = 0.05 + rng() * 0.1;

  const data = imageData.data;

  for (let py = 0; py < h; py++) {
    const ny = py / h;
    for (let px = 0; px < w; px++) {
      const nx = px / w;
      const idx = (py * w + px) * 4;

      let r = data[idx], g = data[idx + 1], b = data[idx + 2];

      // --- Noise field with domain warping ---
      const wx = fbm(noise, nx * warpScale + 3.7, ny * warpScale + 9.2, 3, lacunarity, rng);
      const wy = fbm(noise, nx * warpScale + 1.3, ny * warpScale + 6.8, 3, lacunarity, rng);
      const warpedX = nx * scaleX + wx * warpAmp * scaleX;
      const warpedY = ny * scaleY + wy * warpAmp * scaleY;
      const n1 = (fbm(noise, warpedX, warpedY, 6, lacunarity, rng) + 1) / 2;
      const n2 = (fbm(noise, warpedX * 1.7 + 41, warpedY * 1.7 + 17, 4, lacunarity, rng) + 1) / 2;
      let noiseMask = n1 * 0.65 + n2 * 0.35;

      // --- Radial edge decay ---
      const dx = (nx - vigCx) * 1.5, dy = (ny - vigCy) * 1.5;
      const radial = Math.sqrt(dx * dx + dy * dy);
      const edgeMask = Math.min(1, Math.pow(Math.max(0, radial - 0.28), vigPower) * vigStrength);

      // --- Emulsion patches ---
      let patchMask = 0;
      for (const p of patches) {
        const cos = Math.cos(p.angle), sin = Math.sin(p.angle);
        const rdx = (nx - p.cx) * cos - (ny - p.cy) * sin;
        const rdy = (nx - p.cx) * sin + (ny - p.cy) * cos;
        const dist = Math.sqrt((rdx / p.rx) ** 2 + (rdy / p.ry) ** 2);
        if (dist < 1) {
          const pn = (noise(px * 0.07 + p.cx * 30, py * 0.07 + p.cy * 30) + 1) / 2;
          const v = (1 - dist * dist) * p.strength * (0.5 + pn * 0.5);
          patchMask = Math.max(patchMask, p.invert ? -v * 0.3 : v);
        }
      }

      // --- Compose mask by mode ---
      let decayAmount;
      switch (mode) {
        case 'organic':
          decayAmount = noiseMask * 0.75 + edgeMask * 0.25 + patchMask * 0.1;
          break;
        case 'bleed':
          decayAmount = edgeMask * 0.7 + noiseMask * 0.25 + patchMask * 0.05;
          break;
        case 'lifting':
          decayAmount = patchMask * 0.65 + noiseMask * 0.25 + edgeMask * 0.1;
          break;
        case 'bleach':
          decayAmount = noiseMask * 0.4 + patchMask * 0.4 + edgeMask * 0.2;
          break;
        case 'mixed':
        default:
          decayAmount = noiseMask * 0.33 + edgeMask * 0.34 + patchMask * 0.33;
          break;
      }

      // Scale by global decay and clamp
      decayAmount = Math.min(1, Math.max(0, decayAmount * d * 1.35));

      // --- Apply sepia drift proportional to decay ---
      const localSepia = Math.min(1, sepiaStrength * (0.4 + decayAmount * 0.9));
      [r, g, b] = toSepia(r, g, b, localSepia);

      // --- Fade toward paper colour in heavily decayed areas ---
      const fadeStart = 0.45;
      if (decayAmount > fadeStart) {
        const t = (decayAmount - fadeStart) / (1 - fadeStart);
        const soft = t * t * (3 - 2 * t); // smoothstep
        r = r + (paperR - r) * soft;
        g = g + (paperG - g) * soft;
        b = b + (paperB - b) * soft;
      }

      // --- Organic grain concentrated in decay zones ---
      const grainScale = 28 * decayAmount;
      // Use noise for grain coherence (not pure random) for a more silver-halide feel
      const gn = (noise(px * 0.4 + seed % 100, py * 0.4) + 1) / 2;
      const grain = (gn - 0.5) * grainScale;
      r = Math.min(255, Math.max(0, r + grain));
      g = Math.min(255, Math.max(0, g + grain * 0.88));
      b = Math.min(255, Math.max(0, b + grain * 0.76));

      data[idx]     = r;
      data[idx + 1] = g;
      data[idx + 2] = b;
      // alpha untouched
    }
  }

  return imageData;
}

window.applyCorruption = applyCorruption;
