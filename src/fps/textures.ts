import * as THREE from 'three';

export type SkinToneId = 'light' | 'medium' | 'deep';
export type GloveStyleId = 'black_leather' | 'coyote' | 'charcoal' | 'olive' | 'bare';

interface SkinPalette {
  base: [number, number, number];
  knuckleRed: [number, number, number];
  creaseDark: [number, number, number];
  veinTint: [number, number, number];
  hairColor: string;
  nailBase: number;
  sheenHex: number;
}

export const SKIN_PALETTES: Record<SkinToneId, SkinPalette> = {
  light: {
    base: [224, 178, 150],
    knuckleRed: [204, 134, 114],
    creaseDark: [168, 122, 98],
    veinTint: [152, 166, 176],
    hairColor: 'rgba(112, 82, 58, 0.24)',
    nailBase: 0xe6c3b6,
    sheenHex: 0xffdfd0,
  },
  medium: {
    base: [192, 140, 108],
    knuckleRed: [174, 108, 84],
    creaseDark: [132, 88, 66],
    veinTint: [122, 128, 132],
    hairColor: 'rgba(54, 38, 28, 0.30)',
    nailBase: 0xd9b0a1,
    sheenHex: 0xeec1a6,
  },
  deep: {
    base: [116, 76, 54],
    knuckleRed: [104, 62, 46],
    creaseDark: [72, 44, 30],
    veinTint: [78, 68, 66],
    hairColor: 'rgba(28, 18, 12, 0.36)',
    nailBase: 0xc59a8d,
    sheenHex: 0xb98569,
  },
};

function seededRandom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * Converts a scalar height canvas (red channel) into a crisp tangent-space
 * RGB Normal Map DataTexture using Sobel gradient filtering.
 */
function heightCanvasToNormalTexture(
  canvas: HTMLCanvasElement,
  strength: number,
  maxAnisotropy: number,
  repeatX = 1,
  repeatY = 1,
): THREE.DataTexture {
  const w = canvas.width;
  const h = canvas.height;
  const ctx = canvas.getContext('2d')!;
  const src = ctx.getImageData(0, 0, w, h).data;
  const dst = new Uint8Array(w * h * 4);

  const sample = (x: number, y: number): number => {
    const wx = ((x % w) + w) % w;
    const wy = ((y % h) + h) % h;
    return src[(wy * w + wx) * 4] / 255;
  };

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const tl = sample(x - 1, y - 1);
      const t = sample(x, y - 1);
      const tr = sample(x + 1, y - 1);
      const l = sample(x - 1, y);
      const r = sample(x + 1, y);
      const bl = sample(x - 1, y + 1);
      const b = sample(x, y + 1);
      const br = sample(x + 1, y + 1);

      const dX = (tr + 2 * r + br - (tl + 2 * l + bl)) * strength;
      const dY = (bl + 2 * b + br - (tl + 2 * t + tr)) * strength;
      const nx = -dX;
      const ny = -dY;
      const nz = 1.0;
      const invLen = 1 / Math.sqrt(nx * nx + ny * ny + nz * nz);

      const idx = (y * w + x) * 4;
      dst[idx] = Math.round((nx * invLen * 0.5 + 0.5) * 255);
      dst[idx + 1] = Math.round((ny * invLen * 0.5 + 0.5) * 255);
      dst[idx + 2] = Math.round((nz * invLen * 0.5 + 0.5) * 255);
      dst[idx + 3] = 255;
    }
  }

  const tex = new THREE.DataTexture(dst, w, h, THREE.RGBAFormat);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.anisotropy = maxAnisotropy;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}

export interface SkinTextureSet {
  map: THREE.CanvasTexture;
  normalMap: THREE.DataTexture;
  roughnessMap: THREE.CanvasTexture;
  dispose: () => void;
}

/**
 * Generates high-detail exposed wrist/forearm skin albedo, micro-pore tangent normal map,
 * and natural oil/matte roughness map.
 */
export function createSkinTextures(
  tone: SkinToneId,
  maxAnisotropy: number,
): SkinTextureSet {
  const palette = SKIN_PALETTES[tone];
  const size = 512;
  const rand = seededRandom(4219);

  const colorCanvas = document.createElement('canvas');
  colorCanvas.width = size;
  colorCanvas.height = size;
  const cCtx = colorCanvas.getContext('2d')!;

  const [br, bg, bb] = palette.base;
  cCtx.fillStyle = `rgb(${br}, ${bg}, ${bb})`;
  cCtx.fillRect(0, 0, size, size);

  for (let i = 0; i < 460; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = 10 + rand() * 38;
    const isWarm = rand() > 0.45;
    const grad = cCtx.createRadialGradient(x, y, 0, x, y, r);
    const [cr, cg, cb] = isWarm ? palette.knuckleRed : palette.creaseDark;
    const alpha = isWarm ? 0.085 : 0.06;
    grad.addColorStop(0, `rgba(${cr}, ${cg}, ${cb}, ${alpha})`);
    grad.addColorStop(1, `rgba(${cr}, ${cg}, ${cb}, 0)`);
    cCtx.fillStyle = grad;
    cCtx.beginPath();
    cCtx.arc(x, y, r, 0, Math.PI * 2);
    cCtx.fill();
  }

  const [vr, vg, vb] = palette.veinTint;
  cCtx.strokeStyle = `rgba(${vr}, ${vg}, ${vb}, 0.12)`;
  cCtx.lineCap = 'round';
  for (let v = 0; v < 10; v++) {
    cCtx.lineWidth = 3 + rand() * 5;
    cCtx.beginPath();
    let vx = rand() * size;
    let vy = 0;
    cCtx.moveTo(vx, vy);
    for (let step = 0; step < 6; step++) {
      vx += (rand() - 0.5) * 44;
      vy += size / 6;
      cCtx.lineTo(vx, vy);
    }
    cCtx.stroke();
  }

  const [cr, cg, cb] = palette.creaseDark;
  for (let i = 0; i < 4800; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const radius = 0.45 + rand() * 0.9;
    cCtx.fillStyle =
      rand() > 0.35
        ? `rgba(${cr}, ${cg}, ${cb}, ${0.065 + rand() * 0.095})`
        : `rgba(255, 238, 224, ${0.03 + rand() * 0.05})`;
    cCtx.beginPath();
    cCtx.arc(x, y, radius, 0, Math.PI * 2);
    cCtx.fill();
  }

  cCtx.strokeStyle = palette.hairColor;
  cCtx.lineWidth = 0.75;
  for (let i = 0; i < 540; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const len = 5 + rand() * 11;
    const ang = -Math.PI * 0.5 + (rand() - 0.5) * 0.35;
    cCtx.beginPath();
    cCtx.moveTo(x, y);
    cCtx.quadraticCurveTo(
      x + Math.cos(ang + 0.15) * len * 0.5,
      y + Math.sin(ang + 0.15) * len * 0.5,
      x + Math.cos(ang) * len,
      y + Math.sin(ang) * len,
    );
    cCtx.stroke();
  }

  const heightCanvas = document.createElement('canvas');
  heightCanvas.width = size;
  heightCanvas.height = size;
  const hCtx = heightCanvas.getContext('2d')!;
  hCtx.fillStyle = '#808080';
  hCtx.fillRect(0, 0, size, size);

  hCtx.lineWidth = 0.85;
  for (let i = 0; i < 640; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const len = 8 + rand() * 26;
    const ang = (rand() > 0.5 ? 0.38 : -0.38) + (rand() - 0.5) * 0.2;
    hCtx.strokeStyle = `rgba(88, 88, 88, ${0.2 + rand() * 0.22})`;
    hCtx.beginPath();
    hCtx.moveTo(x, y);
    hCtx.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
    hCtx.stroke();
  }
  for (let i = 0; i < 7200; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const shade = rand() > 0.45 ? 88 : 160;
    hCtx.fillStyle = `rgba(${shade}, ${shade}, ${shade}, 0.34)`;
    hCtx.fillRect(x, y, 1.4, 1.4);
  }

  const roughCanvas = document.createElement('canvas');
  roughCanvas.width = size;
  roughCanvas.height = size;
  const rCtx = roughCanvas.getContext('2d')!;
  rCtx.fillStyle = 'rgb(142, 142, 142)';
  rCtx.fillRect(0, 0, size, size);
  for (let i = 0; i < 380; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = 12 + rand() * 34;
    const val = Math.floor(110 + rand() * 62);
    const grad = rCtx.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, `rgba(${val}, ${val}, ${val}, 0.24)`);
    grad.addColorStop(1, `rgba(${val}, ${val}, ${val}, 0)`);
    rCtx.fillStyle = grad;
    rCtx.beginPath();
    rCtx.arc(x, y, r, 0, Math.PI * 2);
    rCtx.fill();
  }

  const map = new THREE.CanvasTexture(colorCanvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.anisotropy = maxAnisotropy;

  const normalMap = heightCanvasToNormalTexture(
    heightCanvas,
    2.1,
    maxAnisotropy,
  );

  const roughnessMap = new THREE.CanvasTexture(roughCanvas);
  roughnessMap.wrapS = THREE.RepeatWrapping;
  roughnessMap.wrapT = THREE.RepeatWrapping;
  roughnessMap.anisotropy = maxAnisotropy;

  return {
    map,
    normalMap,
    roughnessMap,
    dispose: () => {
      map.dispose();
      normalMap.dispose();
      roughnessMap.dispose();
    },
  };
}

export interface LeatherGloveTextureSet {
  map: THREE.CanvasTexture;
  normalMap: THREE.DataTexture;
  roughnessMap: THREE.CanvasTexture;
  armorMap: THREE.CanvasTexture;
  armorNormalMap: THREE.DataTexture;
  armorRoughnessMap: THREE.CanvasTexture;
  dispose: () => void;
}

/**
 * Generates ultra-detailed 1024×1024 full-grain pebbled BLACK TACTICAL LEATHER maps:
 * - Dual-scale organic leather grain + secondary micro-pores
 * - Crisp tangent-space normal map with flexed skin-fold creases & raised double-stitching
 * - Realistic dry range chalk/concrete dust settled into pebble valleys & seam edges
 * - 512×512 2×2 diagonal carbon-fiber twill hard-knuckle armor albedo, normal & roughness maps
 */
export function createBlackLeatherGloveTextures(
  maxAnisotropy: number,
): LeatherGloveTextureSet {
  const size = 1024;
  const rand = seededRandom(9041);

  const colorCanvas = document.createElement('canvas');
  colorCanvas.width = size;
  colorCanvas.height = size;
  const cCtx = colorCanvas.getContext('2d')!;

  const heightCanvas = document.createElement('canvas');
  heightCanvas.width = size;
  heightCanvas.height = size;
  const hCtx = heightCanvas.getContext('2d')!;

  const roughCanvas = document.createElement('canvas');
  roughCanvas.width = size;
  roughCanvas.height = size;
  const rCtx = roughCanvas.getContext('2d')!;

  // Rich charcoal-black aniline leather base with dusty grey-brown crevice undertones
  cCtx.fillStyle = '#181a1e';
  cCtx.fillRect(0, 0, size, size);

  hCtx.fillStyle = '#262626';
  hCtx.fillRect(0, 0, size, size);

  rCtx.fillStyle = 'rgb(208, 208, 208)';
  rCtx.fillRect(0, 0, size, size);

  // 1. Primary Full-Grain Pebbled Leather Cells (62×62 seamless organic cells)
  const cellGrid = 62;
  const cellStep = size / cellGrid;
  for (let gy = 0; gy < cellGrid; gy++) {
    for (let gx = 0; gx < cellGrid; gx++) {
      const cx = (gx + 0.16 + rand() * 0.68) * cellStep;
      const cy = (gy + 0.16 + rand() * 0.68) * cellStep;
      const rx = cellStep * (0.43 + rand() * 0.24);
      const ry = cellStep * (0.39 + rand() * 0.25);
      const rot = rand() * Math.PI;
      const peakLum = Math.floor(28 + rand() * 17); // 28..45 nuanced black leather value range
      const peakHeight = Math.floor(182 + rand() * 64);
      const peakRough = Math.floor(96 + rand() * 38); // 0.37..0.52 burnished supple leather crown

      for (const ox of [-size, 0, size]) {
        for (const oy of [-size, 0, size]) {
          const px = cx + ox;
          const py = cy + oy;
          if (
            px < -cellStep ||
            px > size + cellStep ||
            py < -cellStep ||
            py > size + cellStep
          ) {
            continue;
          }

          hCtx.save();
          hCtx.translate(px, py);
          hCtx.rotate(rot);
          hCtx.scale(rx, ry);
          const hGrad = hCtx.createRadialGradient(0, 0, 0.08, 0, 0, 1);
          hGrad.addColorStop(0, `rgb(${peakHeight},${peakHeight},${peakHeight})`);
          hGrad.addColorStop(
            0.66,
            `rgb(${Math.floor(peakHeight * 0.76)},${Math.floor(peakHeight * 0.76)},${Math.floor(peakHeight * 0.76)})`,
          );
          hGrad.addColorStop(1, 'rgba(30,30,30,0)');
          hCtx.fillStyle = hGrad;
          hCtx.beginPath();
          hCtx.arc(0, 0, 1, 0, Math.PI * 2);
          hCtx.fill();
          hCtx.restore();

          cCtx.save();
          cCtx.translate(px, py);
          cCtx.rotate(rot);
          cCtx.scale(rx, ry);
          const cGrad = cCtx.createRadialGradient(0, 0, 0.1, 0, 0, 1);
          cGrad.addColorStop(
            0,
            `rgba(${peakLum + 4}, ${peakLum + 5}, ${peakLum + 8}, 0.94)`,
          );
          cGrad.addColorStop(
            0.74,
            `rgba(${peakLum - 4}, ${peakLum - 3}, ${peakLum}, 0.65)`,
          );
          cGrad.addColorStop(1, 'rgba(18, 20, 24, 0)');
          cCtx.fillStyle = cGrad;
          cCtx.beginPath();
          cCtx.arc(0, 0, 1, 0, Math.PI * 2);
          cCtx.fill();
          cCtx.restore();

          rCtx.save();
          rCtx.translate(px, py);
          rCtx.rotate(rot);
          rCtx.scale(rx, ry);
          const rGrad = rCtx.createRadialGradient(0, 0, 0.05, 0, 0, 1);
          rGrad.addColorStop(0, `rgba(${peakRough},${peakRough},${peakRough},0.88)`);
          rGrad.addColorStop(1, 'rgba(205,205,205,0)');
          rCtx.fillStyle = rGrad;
          rCtx.beginPath();
          rCtx.arc(0, 0, 1, 0, Math.PI * 2);
          rCtx.fill();
          rCtx.restore();
        }
      }
    }
  }

  // 2. Secondary Fine Leather Hide Micro-Pores & Hair Follicle Dimples
  for (let i = 0; i < 14000; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const s = 0.8 + rand() * 1.4;
    hCtx.fillStyle = rand() > 0.35 ? 'rgba(24,24,24,0.34)' : 'rgba(235,235,235,0.2)';
    hCtx.fillRect(x, y, s, s);
  }

  // 3. Natural Flexion Wrinkles & Knuckle Fold Creases (with settled range dust inside!)
  for (let i = 0; i < 120; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const len = 46 + rand() * 180;
    const ang = (rand() - 0.5) * 0.42;
    const x2 = x + Math.cos(ang) * len;
    const y2 = y + Math.sin(ang) * len;
    const mx = (x + x2) * 0.5 + (rand() - 0.5) * 16;
    const my = (y + y2) * 0.5 + (rand() - 0.5) * 16;

    hCtx.strokeStyle = 'rgba(18, 18, 18, 0.62)';
    hCtx.lineWidth = 2.0 + rand() * 2.4;
    hCtx.beginPath();
    hCtx.moveTo(x, y);
    hCtx.quadraticCurveTo(mx, my, x2, y2);
    hCtx.stroke();

    // Subtle matte chalk dust settled in leather creases
    cCtx.strokeStyle = `rgba(154, 151, 144, ${0.14 + rand() * 0.16})`;
    cCtx.lineWidth = 1.4 + rand() * 1.8;
    cCtx.beginPath();
    cCtx.moveTo(x, y);
    cCtx.quadraticCurveTo(mx, my, x2, y2);
    cCtx.stroke();

    rCtx.strokeStyle = 'rgba(238, 238, 238, 0.55)';
    rCtx.lineWidth = 3.0;
    rCtx.beginPath();
    rCtx.moveTo(x, y);
    rCtx.quadraticCurveTo(mx, my, x2, y2);
    rCtx.stroke();
  }

  // 4. Dry Concrete / Sand Range Dust Patina & Worn Leather Abrasion Scuffs
  for (let i = 0; i < 320; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = 14 + rand() * 72;
    const alpha = 0.045 + rand() * 0.105;
    const grad = cCtx.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, `rgba(174, 170, 162, ${alpha})`);
    grad.addColorStop(1, 'rgba(174, 170, 162, 0)');
    cCtx.fillStyle = grad;
    cCtx.beginPath();
    cCtx.arc(x, y, r, 0, Math.PI * 2);
    cCtx.fill();

    const rg = rCtx.createRadialGradient(x, y, 0, x, y, r);
    rg.addColorStop(0, `rgba(232, 232, 232, ${alpha * 2.4})`);
    rg.addColorStop(1, 'rgba(232, 232, 232, 0)');
    rCtx.fillStyle = rg;
    rCtx.beginPath();
    rCtx.arc(x, y, r, 0, Math.PI * 2);
    rCtx.fill();
  }

  // Oil-burnished dark glossy handling spots (authentic leather wear contrast!)
  for (let i = 0; i < 75; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = 22 + rand() * 68;
    const rg = rCtx.createRadialGradient(x, y, 0, x, y, r);
    rg.addColorStop(0, 'rgba(72, 72, 72, 0.42)');
    rg.addColorStop(1, 'rgba(72, 72, 72, 0)');
    rCtx.fillStyle = rg;
    rCtx.beginPath();
    rCtx.arc(x, y, r, 0, Math.PI * 2);
    rCtx.fill();
  }

  // Fine granular concrete dust specks & scuff streaks
  for (let i = 0; i < 200; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const len = 14 + rand() * 58;
    const ang = (rand() - 0.5) * Math.PI;
    cCtx.strokeStyle = `rgba(162, 160, 152, ${0.12 + rand() * 0.16})`;
    cCtx.lineWidth = 1.0 + rand() * 2.5;
    cCtx.beginPath();
    cCtx.moveTo(x, y);
    cCtx.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
    cCtx.stroke();
  }

  // 5. Heavy Tactical Double-Stitched Leather Panel Seams (individual raised stitch ridges!)
  for (const seamY of [248, 520, 792]) {
    hCtx.strokeStyle = '#121212';
    hCtx.lineWidth = 5;
    hCtx.beginPath();
    hCtx.moveTo(0, seamY);
    hCtx.lineTo(size, seamY);
    hCtx.stroke();

    // Subtle pale dust trapped in seam fold
    cCtx.strokeStyle = 'rgba(136, 134, 128, 0.25)';
    cCtx.lineWidth = 3;
    cCtx.beginPath();
    cCtx.moveTo(0, seamY);
    cCtx.lineTo(size, seamY);
    cCtx.stroke();

    for (const offset of [-9, 9]) {
      for (let sx = 4; sx < size; sx += 16) {
        // Needle puncture hole
        hCtx.fillStyle = '#0e0e0e';
        hCtx.fillRect(sx - 1, seamY + offset - 1.5, 2.5, 3);
        // Raised braided thread dash
        hCtx.fillStyle = '#f2f2f2';
        hCtx.fillRect(sx + 1, seamY + offset - 1.2, 9.5, 2.4);

        cCtx.fillStyle = 'rgba(112, 116, 124, 0.72)';
        cCtx.fillRect(sx + 1, seamY + offset - 1.2, 9.5, 2.2);
      }
    }
  }

  // 6. 512×512 Crisp 2×2 Carbon-Kevlar Twill Hard-Knuckle Armor Set
  const aSize = 512;
  const armorCanvas = document.createElement('canvas');
  armorCanvas.width = aSize;
  armorCanvas.height = aSize;
  const aCtx = armorCanvas.getContext('2d')!;

  const armorHeight = document.createElement('canvas');
  armorHeight.width = aSize;
  armorHeight.height = aSize;
  const ahCtx = armorHeight.getContext('2d')!;

  const armorRough = document.createElement('canvas');
  armorRough.width = aSize;
  armorRough.height = aSize;
  const arCtx = armorRough.getContext('2d')!;

  aCtx.fillStyle = '#1a1d22';
  aCtx.fillRect(0, 0, aSize, aSize);
  ahCtx.fillStyle = '#707070';
  ahCtx.fillRect(0, 0, aSize, aSize);
  arCtx.fillStyle = 'rgb(112, 112, 112)';
  arCtx.fillRect(0, 0, aSize, aSize);

  // Authentic 2×2 diagonal carbon-fiber weave pattern
  const pitch = 8;
  for (let y = 0; y < aSize; y += pitch) {
    for (let x = 0; x < aSize; x += pitch) {
      const phase = ((x / pitch) + (y / pitch)) % 4;
      const warp = phase < 2;
      aCtx.fillStyle = warp ? '#2b3038' : '#16191e';
      aCtx.fillRect(x, y, pitch - 1, pitch - 1);

      ahCtx.fillStyle = warp ? '#b8b8b8' : '#4a4a4a';
      ahCtx.fillRect(x, y, pitch - 1, pitch - 1);

      arCtx.fillStyle = warp ? 'rgb(84,84,84)' : 'rgb(138,138,138)';
      arCtx.fillRect(x, y, pitch - 1, pitch - 1);
    }
  }

  // Scratches & chalky combat dust scuffs across knuckle shell
  for (let i = 0; i < 180; i++) {
    const x = rand() * aSize;
    const y = rand() * aSize;
    const len = 10 + rand() * 52;
    const ang = (rand() - 0.5) * Math.PI;
    aCtx.strokeStyle = `rgba(176, 174, 168, ${0.14 + rand() * 0.24})`;
    aCtx.lineWidth = 1.0 + rand() * 2.2;
    aCtx.beginPath();
    aCtx.moveTo(x, y);
    aCtx.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
    aCtx.stroke();

    ahCtx.strokeStyle = 'rgba(24, 24, 24, 0.58)';
    ahCtx.lineWidth = 1.5;
    ahCtx.beginPath();
    ahCtx.moveTo(x, y);
    ahCtx.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
    ahCtx.stroke();

    arCtx.strokeStyle = 'rgba(225, 225, 225, 0.65)';
    arCtx.lineWidth = 2.4;
    arCtx.beginPath();
    arCtx.moveTo(x, y);
    arCtx.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
    arCtx.stroke();
  }
  for (let i = 0; i < 85; i++) {
    const x = rand() * aSize;
    const y = rand() * aSize;
    const r = 10 + rand() * 38;
    const grad = aCtx.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgba(162, 160, 154, 0.2)');
    grad.addColorStop(1, 'rgba(162, 160, 154, 0)');
    aCtx.fillStyle = grad;
    aCtx.beginPath();
    aCtx.arc(x, y, r, 0, Math.PI * 2);
    aCtx.fill();
  }

  const map = new THREE.CanvasTexture(colorCanvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.anisotropy = maxAnisotropy;

  const normalMap = heightCanvasToNormalTexture(
    heightCanvas,
    3.6,
    maxAnisotropy,
  );

  const roughnessMap = new THREE.CanvasTexture(roughCanvas);
  roughnessMap.wrapS = THREE.RepeatWrapping;
  roughnessMap.wrapT = THREE.RepeatWrapping;
  roughnessMap.anisotropy = maxAnisotropy;

  const armorMap = new THREE.CanvasTexture(armorCanvas);
  armorMap.colorSpace = THREE.SRGBColorSpace;
  armorMap.wrapS = THREE.RepeatWrapping;
  armorMap.wrapT = THREE.RepeatWrapping;
  armorMap.anisotropy = maxAnisotropy;

  const armorNormalMap = heightCanvasToNormalTexture(
    armorHeight,
    2.8,
    maxAnisotropy,
  );

  const armorRoughnessMap = new THREE.CanvasTexture(armorRough);
  armorRoughnessMap.wrapS = THREE.RepeatWrapping;
  armorRoughnessMap.wrapT = THREE.RepeatWrapping;
  armorRoughnessMap.anisotropy = maxAnisotropy;

  return {
    map,
    normalMap,
    roughnessMap,
    armorMap,
    armorNormalMap,
    armorRoughnessMap,
    dispose: () => {
      map.dispose();
      normalMap.dispose();
      roughnessMap.dispose();
      armorMap.dispose();
      armorNormalMap.dispose();
      armorRoughnessMap.dispose();
    },
  };
}

export interface LeatherJacketTextureSet {
  map: THREE.CanvasTexture;
  normalMap: THREE.DataTexture;
  roughnessMap: THREE.CanvasTexture;
  dispose: () => void;
}

/**
 * Generates a high-detail 1024×1024 heavy full-grain BLACK LEATHER JACKET texture set:
 * - Supple milled/tumbled cowhide grain with organic tonal patina
 * - Deep stacked sleeve-bend leather creases & burnished oil-sheen fold crowns
 * - Longitudinal moto jacket panel seams with rolled piping welts & heavy twin topstitching
 * - Contrasting roughness map (glossy worn fold crests vs matte tumbled grain valleys)
 */
export function createBlackLeatherJacketTextures(
  maxAnisotropy: number,
): LeatherJacketTextureSet {
  const size = 1024;
  const rand = seededRandom(7331);

  const colorCanvas = document.createElement('canvas');
  colorCanvas.width = size;
  colorCanvas.height = size;
  const cCtx = colorCanvas.getContext('2d')!;

  const heightCanvas = document.createElement('canvas');
  heightCanvas.width = size;
  heightCanvas.height = size;
  const hCtx = heightCanvas.getContext('2d')!;

  const roughCanvas = document.createElement('canvas');
  roughCanvas.width = size;
  roughCanvas.height = size;
  const rCtx = roughCanvas.getContext('2d')!;

  // Rich jet-black aniline moto leather base
  cCtx.fillStyle = '#111317';
  cCtx.fillRect(0, 0, size, size);

  hCtx.fillStyle = '#6c6c6c';
  hCtx.fillRect(0, 0, size, size);

  // Mid-matte natural leather base roughness (0.58)
  rCtx.fillStyle = 'rgb(154, 154, 154)';
  rCtx.fillRect(0, 0, size, size);

  // 1. Broad supple hide tonal & oil-sheen patches (natural full-grain cowhide variation)
  for (let i = 0; i < 160; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = 34 + rand() * 110;
    const bright = rand() > 0.48;
    const grad = cCtx.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(
      0,
      bright ? 'rgba(34, 38, 45, 0.28)' : 'rgba(8, 9, 12, 0.34)',
    );
    grad.addColorStop(1, 'rgba(16, 18, 22, 0)');
    cCtx.fillStyle = grad;
    cCtx.beginPath();
    cCtx.arc(x, y, r, 0, Math.PI * 2);
    cCtx.fill();

    const rGrad = rCtx.createRadialGradient(x, y, 0, x, y, r);
    rGrad.addColorStop(
      0,
      bright ? 'rgba(86, 86, 86, 0.34)' : 'rgba(202, 202, 202, 0.28)',
    );
    rGrad.addColorStop(1, 'rgba(154, 154, 154, 0)');
    rCtx.fillStyle = rGrad;
    rCtx.beginPath();
    rCtx.arc(x, y, r, 0, Math.PI * 2);
    rCtx.fill();
  }

  // 2. Authentic Milled Cowhide Grain Cells (softer & slightly broader than glove pebble)
  const grainGrid = 54;
  const grainStep = size / grainGrid;
  for (let gy = 0; gy < grainGrid; gy++) {
    for (let gx = 0; gx < grainGrid; gx++) {
      const cx = (gx + 0.15 + rand() * 0.7) * grainStep;
      const cy = (gy + 0.15 + rand() * 0.7) * grainStep;
      const rx = grainStep * (0.48 + rand() * 0.32);
      const ry = grainStep * (0.42 + rand() * 0.3);
      const rot = rand() * Math.PI;
      const hPeak = Math.floor(148 + rand() * 64);
      const cLum = Math.floor(20 + rand() * 16);
      const rPeak = Math.floor(88 + rand() * 44);

      for (const ox of [-size, 0, size]) {
        for (const oy of [-size, 0, size]) {
          const px = cx + ox;
          const py = cy + oy;
          if (
            px < -grainStep ||
            px > size + grainStep ||
            py < -grainStep ||
            py > size + grainStep
          ) {
            continue;
          }

          hCtx.save();
          hCtx.translate(px, py);
          hCtx.rotate(rot);
          hCtx.scale(rx, ry);
          const hg = hCtx.createRadialGradient(0, 0, 0.12, 0, 0, 1);
          hg.addColorStop(0, `rgba(${hPeak},${hPeak},${hPeak},0.85)`);
          hg.addColorStop(0.75, 'rgba(98,98,98,0.45)');
          hg.addColorStop(1, 'rgba(42,42,42,0)');
          hCtx.fillStyle = hg;
          hCtx.beginPath();
          hCtx.arc(0, 0, 1, 0, Math.PI * 2);
          hCtx.fill();
          hCtx.restore();

          cCtx.save();
          cCtx.translate(px, py);
          cCtx.rotate(rot);
          cCtx.scale(rx, ry);
          const cg = cCtx.createRadialGradient(0, 0, 0.1, 0, 0, 1);
          cg.addColorStop(0, `rgba(${cLum + 3},${cLum + 4},${cLum + 7},0.55)`);
          cg.addColorStop(1, 'rgba(14,16,20,0)');
          cCtx.fillStyle = cg;
          cCtx.beginPath();
          cCtx.arc(0, 0, 1, 0, Math.PI * 2);
          cCtx.fill();
          cCtx.restore();

          rCtx.save();
          rCtx.translate(px, py);
          rCtx.rotate(rot);
          rCtx.scale(rx, ry);
          const rg = rCtx.createRadialGradient(0, 0, 0.1, 0, 0, 1);
          rg.addColorStop(0, `rgba(${rPeak},${rPeak},${rPeak},0.58)`);
          rg.addColorStop(1, 'rgba(154,154,154,0)');
          rCtx.fillStyle = rg;
          rCtx.beginPath();
          rCtx.arc(0, 0, 1, 0, Math.PI * 2);
          rCtx.fill();
          rCtx.restore();
        }
      }
    }
  }

  // 3. Fine leather skin pores & micro-grain stipple
  for (let i = 0; i < 12000; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const s = 0.8 + rand() * 1.4;
    hCtx.fillStyle =
      rand() > 0.35 ? 'rgba(28,28,28,0.34)' : 'rgba(220,220,220,0.16)';
    hCtx.fillRect(x, y, s, s);
  }

  // 4. Deep Supple Jacket Sleeve Stacking Creases (circumferential + diagonal folds!)
  // These catch dynamic light beautifully as the vertex wind ripples move across the sleeve.
  for (let i = 0; i < 68; i++) {
    const yBase = rand() * size;
    const xStart = rand() * size;
    const span = 140 + rand() * 340;
    const tilt = (rand() - 0.5) * 0.38;
    const bend = (rand() - 0.5) * 34;
    const width = 4.5 + rand() * 8.0;

    const drawCrease = (offsetX: number) => {
      const x1 = xStart + offsetX;
      const y1 = yBase;
      const x2 = x1 + Math.cos(tilt) * span;
      const y2 = y1 + Math.sin(tilt) * span;
      const mx = (x1 + x2) * 0.5;
      const my = (y1 + y2) * 0.5 + bend;

      // Raised soft burnished ridge alongside crease
      hCtx.strokeStyle = 'rgba(218, 218, 218, 0.36)';
      hCtx.lineWidth = width * 1.45;
      hCtx.lineCap = 'round';
      hCtx.beginPath();
      hCtx.moveTo(x1, y1 - width * 0.45);
      hCtx.quadraticCurveTo(mx, my - width * 0.45, x2, y2 - width * 0.45);
      hCtx.stroke();

      // Recessed dark leather crease valley
      hCtx.strokeStyle = 'rgba(18, 18, 18, 0.72)';
      hCtx.lineWidth = width * 0.65;
      hCtx.beginPath();
      hCtx.moveTo(x1, y1);
      hCtx.quadraticCurveTo(mx, my, x2, y2);
      hCtx.stroke();

      // Burnished sheen on ridge crest + deeper black inside fold valley
      cCtx.strokeStyle = 'rgba(42, 46, 54, 0.24)';
      cCtx.lineWidth = width * 1.25;
      cCtx.beginPath();
      cCtx.moveTo(x1, y1 - width * 0.45);
      cCtx.quadraticCurveTo(mx, my - width * 0.45, x2, y2 - width * 0.45);
      cCtx.stroke();

      cCtx.strokeStyle = 'rgba(6, 7, 10, 0.52)';
      cCtx.lineWidth = width * 0.55;
      cCtx.beginPath();
      cCtx.moveTo(x1, y1);
      cCtx.quadraticCurveTo(mx, my, x2, y2);
      cCtx.stroke();

      // Glossy oil-rubbed fold crown vs matte crease valley
      rCtx.strokeStyle = 'rgba(74, 74, 74, 0.48)';
      rCtx.lineWidth = width * 1.3;
      rCtx.beginPath();
      rCtx.moveTo(x1, y1 - width * 0.45);
      rCtx.quadraticCurveTo(mx, my - width * 0.45, x2, y2 - width * 0.45);
      rCtx.stroke();

      rCtx.strokeStyle = 'rgba(222, 222, 222, 0.48)';
      rCtx.lineWidth = width * 0.65;
      rCtx.beginPath();
      rCtx.moveTo(x1, y1);
      rCtx.quadraticCurveTo(mx, my, x2, y2);
      rCtx.stroke();
    };

    drawCrease(0);
    if (xStart + span > size) drawCrease(-size);
    if (xStart < span * 0.4) drawCrease(size);
  }

  // 5. Longitudinal Moto Jacket Tailored Panel Seams with Rolled Welts & Heavy Twin Topstitching
  for (const seamX of [196, 708]) {
    // Raised leather piping welt either side of the seam
    for (const sideOff of [-10, 10]) {
      const hg = hCtx.createLinearGradient(
        seamX + sideOff - 9,
        0,
        seamX + sideOff + 9,
        0,
      );
      hg.addColorStop(0, 'rgba(120,120,120,0)');
      hg.addColorStop(0.5, 'rgba(224,224,224,0.58)');
      hg.addColorStop(1, 'rgba(120,120,120,0)');
      hCtx.fillStyle = hg;
      hCtx.fillRect(seamX + sideOff - 9, 0, 18, size);

      // Subtle worn charcoal-silver edge buffing along raised leather seam ridge
      cCtx.fillStyle = 'rgba(54, 58, 66, 0.24)';
      cCtx.fillRect(seamX + sideOff - 4, 0, 8, size);

      rCtx.fillStyle = 'rgba(84, 84, 84, 0.42)';
      rCtx.fillRect(seamX + sideOff - 5, 0, 10, size);
    }

    // Center seam trench
    hCtx.fillStyle = '#121212';
    hCtx.fillRect(seamX - 2.5, 0, 5, size);
    cCtx.fillStyle = '#07080a';
    cCtx.fillRect(seamX - 2, 0, 4, size);

    // Heavy waxed charcoal-slate double topstitching running cleanly down the sleeve
    for (const stitchOff of [-11, 11]) {
      for (let sy = 4; sy < size; sy += 18) {
        hCtx.fillStyle = '#0d0d0d';
        hCtx.fillRect(seamX + stitchOff - 1.4, sy - 1.5, 2.8, 2.5);
        hCtx.fillStyle = '#ececec';
        hCtx.fillRect(seamX + stitchOff - 1.2, sy + 1.5, 2.4, 10.5);

        cCtx.fillStyle = 'rgba(96, 102, 112, 0.68)';
        cCtx.fillRect(seamX + stitchOff - 1.1, sy + 1.5, 2.2, 10.5);
      }
    }
  }

  // 6. Subtle broken-in edge scuffs & dry archive dust specks
  for (let i = 0; i < 140; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const len = 12 + rand() * 44;
    const ang = (rand() - 0.5) * Math.PI;
    cCtx.strokeStyle = `rgba(98, 102, 108, ${0.07 + rand() * 0.11})`;
    cCtx.lineWidth = 0.9 + rand() * 1.6;
    cCtx.beginPath();
    cCtx.moveTo(x, y);
    cCtx.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
    cCtx.stroke();
  }

  const map = new THREE.CanvasTexture(colorCanvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.anisotropy = maxAnisotropy;

  const normalMap = heightCanvasToNormalTexture(
    heightCanvas,
    3.2,
    maxAnisotropy,
  );

  const roughnessMap = new THREE.CanvasTexture(roughCanvas);
  roughnessMap.wrapS = THREE.RepeatWrapping;
  roughnessMap.wrapT = THREE.RepeatWrapping;
  roughnessMap.anisotropy = maxAnisotropy;

  return {
    map,
    normalMap,
    roughnessMap,
    dispose: () => {
      map.dispose();
      normalMap.dispose();
      roughnessMap.dispose();
    },
  };
}

/**
 * Generates ultra-crisp 1024×1024 aggressive laser-stippled pistol polymer maps.
 */
export function createPolymerStippleTextures(maxAnisotropy: number) {
  const size = 1024;
  const rand = seededRandom(8831);

  const heightCanvas = document.createElement('canvas');
  heightCanvas.width = size;
  heightCanvas.height = size;
  const hCtx = heightCanvas.getContext('2d')!;
  hCtx.fillStyle = '#363636';
  hCtx.fillRect(0, 0, size, size);

  const colorCanvas = document.createElement('canvas');
  colorCanvas.width = size;
  colorCanvas.height = size;
  const cCtx = colorCanvas.getContext('2d')!;
  cCtx.fillStyle = '#181a1e';
  cCtx.fillRect(0, 0, size, size);

  const roughCanvas = document.createElement('canvas');
  roughCanvas.width = size;
  roughCanvas.height = size;
  const rCtx = roughCanvas.getContext('2d')!;
  rCtx.fillStyle = 'rgb(218, 218, 218)';
  rCtx.fillRect(0, 0, size, size);

  // High-density stippled polymer grip pyramids
  const step = 9;
  for (let y = 0; y < size; y += step) {
    for (let x = 0; x < size; x += step) {
      const jx = (rand() - 0.5) * 3.4;
      const jy = (rand() - 0.5) * 3.4;
      const rad = 3.2 + rand() * 1.6;

      const hGrad = hCtx.createRadialGradient(
        x + jx,
        y + jy,
        0.3,
        x + jx,
        y + jy,
        rad,
      );
      hGrad.addColorStop(0, '#f4f4f4');
      hGrad.addColorStop(0.62, '#9a9a9a');
      hGrad.addColorStop(1, '#262626');
      hCtx.fillStyle = hGrad;
      hCtx.beginPath();
      hCtx.arc(x + jx, y + jy, rad, 0, Math.PI * 2);
      hCtx.fill();

      const tone = Math.floor(26 + rand() * 16);
      cCtx.fillStyle = `rgb(${tone}, ${tone + 1}, ${tone + 3})`;
      cCtx.beginPath();
      cCtx.arc(x + jx, y + jy, rad * 0.72, 0, Math.PI * 2);
      cCtx.fill();

      const rVal = Math.floor(172 + rand() * 44);
      rCtx.fillStyle = `rgb(${rVal},${rVal},${rVal})`;
      rCtx.beginPath();
      rCtx.arc(x + jx, y + jy, rad * 0.55, 0, Math.PI * 2);
      rCtx.fill();
    }
  }

  // Subtle chalky range dust & handling wear inside stipple pockets
  for (let i = 0; i < 160; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = 16 + rand() * 54;
    const grad = cCtx.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgba(138, 136, 130, 0.09)');
    grad.addColorStop(1, 'rgba(138, 136, 130, 0)');
    cCtx.fillStyle = grad;
    cCtx.beginPath();
    cCtx.arc(x, y, r, 0, Math.PI * 2);
    cCtx.fill();
  }

  const map = new THREE.CanvasTexture(colorCanvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(2.4, 2.4);
  map.anisotropy = maxAnisotropy;

  const normalMap = heightCanvasToNormalTexture(
    heightCanvas,
    4.0,
    maxAnisotropy,
    2.4,
    2.4,
  );

  const roughnessMap = new THREE.CanvasTexture(roughCanvas);
  roughnessMap.wrapS = THREE.RepeatWrapping;
  roughnessMap.wrapT = THREE.RepeatWrapping;
  roughnessMap.repeat.set(2.4, 2.4);
  roughnessMap.anisotropy = maxAnisotropy;

  return {
    map,
    normalMap,
    roughnessMap,
    dispose: () => {
      map.dispose();
      normalMap.dispose();
      roughnessMap.dispose();
    },
  };
}

/**
 * Generates ultra-detailed 1024×1024 CNC brushed DLC/Tenifer nitride gunmetal
 * and 512×512 lathe-turned stainless barrel steel PBR texture sets.
 */
export function createGunmetalTexture(maxAnisotropy: number) {
  const size = 1024;
  const rand = seededRandom(5102);

  const colorCanvas = document.createElement('canvas');
  colorCanvas.width = size;
  colorCanvas.height = size;
  const cCtx = colorCanvas.getContext('2d')!;
  cCtx.fillStyle = '#242830';
  cCtx.fillRect(0, 0, size, size);

  const heightCanvas = document.createElement('canvas');
  heightCanvas.width = size;
  heightCanvas.height = size;
  const hCtx = heightCanvas.getContext('2d')!;
  hCtx.fillStyle = '#808080';
  hCtx.fillRect(0, 0, size, size);

  const roughCanvas = document.createElement('canvas');
  roughCanvas.width = size;
  roughCanvas.height = size;
  const rCtx = roughCanvas.getContext('2d')!;
  rCtx.fillStyle = 'rgb(88, 88, 88)';
  rCtx.fillRect(0, 0, size, size);

  // Ultra-fine CNC horizontal milling striations & steel grain
  for (let i = 0; i < 4200; i++) {
    const y = rand() * size;
    const x = rand() * size;
    const w = 36 + rand() * 240;
    const lum = Math.floor(32 + rand() * 22);
    cCtx.fillStyle = `rgba(${lum}, ${lum + 3}, ${lum + 8}, 0.26)`;
    cCtx.fillRect(x, y, w, 1.2);

    const hVal = Math.floor(104 + rand() * 48);
    hCtx.fillStyle = `rgba(${hVal}, ${hVal}, ${hVal}, 0.38)`;
    hCtx.fillRect(x, y, w, 1.1);

    const rVal = Math.floor(60 + rand() * 58);
    rCtx.fillStyle = `rgba(${rVal}, ${rVal}, ${rVal}, 0.30)`;
    rCtx.fillRect(x, y, w, 1.3);
  }

  // Subtle phosphate / bead-blasted micro-pitting (authentic Glock Tenifer / nDLC texture!)
  for (let i = 0; i < 16000; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const shade = rand() > 0.5 ? 148 : 108;
    hCtx.fillStyle = `rgba(${shade},${shade},${shade},0.22)`;
    hCtx.fillRect(x, y, 1.5, 1.5);
  }

  // Realistic gun-oil rainbow/slate film smudges + dry rack-handling spots
  for (let i = 0; i < 130; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = 24 + rand() * 110;
    const isOily = rand() > 0.45;
    const rGrad = rCtx.createRadialGradient(x, y, 0, x, y, r);
    const rv = isOily ? 48 : 146;
    rGrad.addColorStop(0, `rgba(${rv}, ${rv}, ${rv}, 0.42)`);
    rGrad.addColorStop(1, `rgba(${rv}, ${rv}, ${rv}, 0)`);
    rCtx.fillStyle = rGrad;
    rCtx.beginPath();
    rCtx.arc(x, y, r, 0, Math.PI * 2);
    rCtx.fill();

    const cGrad = cCtx.createRadialGradient(x, y, 0, x, y, r);
    cGrad.addColorStop(
      0,
      isOily ? 'rgba(56, 66, 80, 0.16)' : 'rgba(26, 28, 32, 0.14)',
    );
    cGrad.addColorStop(1, 'rgba(38, 42, 48, 0)');
    cCtx.fillStyle = cGrad;
    cCtx.beginPath();
    cCtx.arc(x, y, r, 0, Math.PI * 2);
    cCtx.fill();
  }

  // Crisp metallic holster wear scratches & fine silvering marks
  for (let i = 0; i < 140; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const len = 14 + rand() * 78;
    const ang = (rand() - 0.5) * 0.28;
    cCtx.strokeStyle = `rgba(132, 140, 152, ${0.15 + rand() * 0.22})`;
    cCtx.lineWidth = 0.8 + rand() * 0.8;
    cCtx.beginPath();
    cCtx.moveTo(x, y);
    cCtx.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
    cCtx.stroke();

    hCtx.strokeStyle = 'rgba(42, 42, 42, 0.5)';
    hCtx.lineWidth = 1.1;
    hCtx.beginPath();
    hCtx.moveTo(x, y);
    hCtx.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
    hCtx.stroke();

    rCtx.strokeStyle = 'rgba(40, 40, 40, 0.6)';
    rCtx.lineWidth = 1.2;
    rCtx.beginPath();
    rCtx.moveTo(x, y);
    rCtx.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
    rCtx.stroke();
  }

  // Dedicated 512×512 Turned Stainless Barrel & Chamber Hood Maps (with breech wear streaks!)
  const bSize = 512;
  const barrelColor = document.createElement('canvas');
  barrelColor.width = bSize;
  barrelColor.height = bSize;
  const bcCtx = barrelColor.getContext('2d')!;
  bcCtx.fillStyle = '#aeb6c2';
  bcCtx.fillRect(0, 0, bSize, bSize);

  const barrelHeight = document.createElement('canvas');
  barrelHeight.width = bSize;
  barrelHeight.height = bSize;
  const bhCtx = barrelHeight.getContext('2d')!;
  bhCtx.fillStyle = '#808080';
  bhCtx.fillRect(0, 0, bSize, bSize);

  for (let y = 0; y < bSize; y += 2) {
    const v = Math.floor(154 + rand() * 44);
    bcCtx.fillStyle = `rgba(${v}, ${v + 4}, ${v + 10}, 0.45)`;
    bcCtx.fillRect(0, y, bSize, 1.4);

    const hv = Math.floor(108 + rand() * 42);
    bhCtx.fillStyle = `rgb(${hv},${hv},${hv})`;
    bhCtx.fillRect(0, y, bSize, 1.4);
  }
  // Subtle cycling smiley-wear & heat-carbon tint on chamber hood
  for (let i = 0; i < 45; i++) {
    const x = rand() * bSize;
    const y = rand() * bSize;
    const r = 14 + rand() * 42;
    const grad = bcCtx.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgba(92, 86, 76, 0.16)');
    grad.addColorStop(1, 'rgba(92, 86, 76, 0)');
    bcCtx.fillStyle = grad;
    bcCtx.beginPath();
    bcCtx.arc(x, y, r, 0, Math.PI * 2);
    bcCtx.fill();
  }

  const map = new THREE.CanvasTexture(colorCanvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.anisotropy = maxAnisotropy;

  const normalMap = heightCanvasToNormalTexture(
    heightCanvas,
    2.2,
    maxAnisotropy,
  );

  const roughnessMap = new THREE.CanvasTexture(roughCanvas);
  roughnessMap.wrapS = THREE.RepeatWrapping;
  roughnessMap.wrapT = THREE.RepeatWrapping;
  roughnessMap.anisotropy = maxAnisotropy;

  const barrelMap = new THREE.CanvasTexture(barrelColor);
  barrelMap.colorSpace = THREE.SRGBColorSpace;
  barrelMap.wrapS = THREE.RepeatWrapping;
  barrelMap.wrapT = THREE.RepeatWrapping;
  barrelMap.anisotropy = maxAnisotropy;

  const barrelNormalMap = heightCanvasToNormalTexture(
    barrelHeight,
    1.9,
    maxAnisotropy,
  );

  return {
    map,
    normalMap,
    roughnessMap,
    barrelMap,
    barrelNormalMap,
    dispose: () => {
      map.dispose();
      normalMap.dispose();
      roughnessMap.dispose();
      barrelMap.dispose();
      barrelNormalMap.dispose();
    },
  };
}

/**
 * Clean blank architectural concrete/plaster textures for the empty firing room.
 */
export function createBlankRoomTextures(maxAnisotropy: number) {
  const size = 512;
  const rand = seededRandom(1920);

  const wallCanvas = document.createElement('canvas');
  wallCanvas.width = size;
  wallCanvas.height = size;
  const wCtx = wallCanvas.getContext('2d')!;
  wCtx.fillStyle = '#d8dce0';
  wCtx.fillRect(0, 0, size, size);

  for (let i = 0; i < 320; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = 18 + rand() * 72;
    const shade = Math.floor(204 + rand() * 24);
    const grad = wCtx.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, `rgba(${shade},${shade + 1},${shade + 2},0.12)`);
    grad.addColorStop(1, `rgba(${shade},${shade + 1},${shade + 2},0)`);
    wCtx.fillStyle = grad;
    wCtx.beginPath();
    wCtx.arc(x, y, r, 0, Math.PI * 2);
    wCtx.fill();
  }

  wCtx.strokeStyle = 'rgba(130, 138, 148, 0.22)';
  wCtx.lineWidth = 2;
  wCtx.strokeRect(1, 1, size - 2, size - 2);

  wCtx.fillStyle = 'rgba(128, 134, 142, 0.24)';
  const offsets = [64, size - 64];
  for (const ox of offsets) {
    for (const oy of offsets) {
      wCtx.beginPath();
      wCtx.arc(ox, oy, 3, 0, Math.PI * 2);
      wCtx.fill();
    }
  }

  const wallMap = new THREE.CanvasTexture(wallCanvas);
  wallMap.colorSpace = THREE.SRGBColorSpace;
  wallMap.wrapS = THREE.RepeatWrapping;
  wallMap.wrapT = THREE.RepeatWrapping;
  wallMap.repeat.set(6, 2.2);
  wallMap.anisotropy = maxAnisotropy;

  const floorCanvas = document.createElement('canvas');
  floorCanvas.width = size;
  floorCanvas.height = size;
  const fCtx = floorCanvas.getContext('2d')!;
  fCtx.fillStyle = '#aeb4bc';
  fCtx.fillRect(0, 0, size, size);

  for (let i = 0; i < 400; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = 12 + rand() * 56;
    const shade = Math.floor(156 + rand() * 34);
    const grad = fCtx.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, `rgba(${shade},${shade + 2},${shade + 5},0.14)`);
    grad.addColorStop(1, `rgba(${shade},${shade + 2},${shade + 5},0)`);
    fCtx.fillStyle = grad;
    fCtx.beginPath();
    fCtx.arc(x, y, r, 0, Math.PI * 2);
    fCtx.fill();
  }

  fCtx.strokeStyle = 'rgba(82, 88, 96, 0.34)';
  fCtx.lineWidth = 2.5;
  fCtx.strokeRect(1, 1, size - 2, size - 2);

  const floorMap = new THREE.CanvasTexture(floorCanvas);
  floorMap.colorSpace = THREE.SRGBColorSpace;
  floorMap.wrapS = THREE.RepeatWrapping;
  floorMap.wrapT = THREE.RepeatWrapping;
  floorMap.repeat.set(9, 11);
  floorMap.anisotropy = maxAnisotropy;

  return {
    wallMap,
    floorMap,
    dispose: () => {
      wallMap.dispose();
      floorMap.dispose();
    },
  };
}

/**
 * Generates radial bullet impact hole decal texture for blank concrete walls.
 */
export function createBulletHoleTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const c = size / 2;

  ctx.clearRect(0, 0, size, size);

  const dust = ctx.createRadialGradient(c, c, 8, c, c, 54);
  dust.addColorStop(0, 'rgba(28, 28, 30, 0.85)');
  dust.addColorStop(0.35, 'rgba(90, 90, 94, 0.52)');
  dust.addColorStop(0.68, 'rgba(175, 178, 182, 0.25)');
  dust.addColorStop(1, 'rgba(175, 178, 182, 0)');
  ctx.fillStyle = dust;
  ctx.beginPath();
  ctx.arc(c, c, 54, 0, Math.PI * 2);
  ctx.fill();

  const rand = seededRandom(774);
  ctx.strokeStyle = 'rgba(32, 34, 38, 0.65)';
  for (let i = 0; i < 9; i++) {
    const ang = (i / 9) * Math.PI * 2 + (rand() - 0.5) * 0.4;
    const len = 18 + rand() * 32;
    ctx.lineWidth = 0.8 + rand() * 1.1;
    ctx.beginPath();
    ctx.moveTo(c + Math.cos(ang) * 7, c + Math.sin(ang) * 7);
    ctx.lineTo(
      c + Math.cos(ang + 0.08) * (len * 0.55),
      c + Math.sin(ang + 0.08) * (len * 0.55),
    );
    ctx.lineTo(c + Math.cos(ang) * len, c + Math.sin(ang) * len);
    ctx.stroke();
  }

  const hole = ctx.createRadialGradient(c, c, 0, c, c, 13);
  hole.addColorStop(0, 'rgba(8, 8, 10, 1)');
  hole.addColorStop(0.65, 'rgba(18, 18, 20, 0.96)');
  hole.addColorStop(1, 'rgba(54, 54, 58, 0)');
  ctx.fillStyle = hole;
  ctx.beginPath();
  ctx.arc(c, c, 13, 0, Math.PI * 2);
  ctx.fill();

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = maxAnisotropy;
  return tex;
}

/**
 * Generates radial muzzle flash and soft cordite smoke textures.
 */
export function createFxTextures() {
  const fSize = 256;
  const fCanvas = document.createElement('canvas');
  fCanvas.width = fSize;
  fCanvas.height = fSize;
  const fCtx = fCanvas.getContext('2d')!;
  const fc = fSize / 2;

  const core = fCtx.createRadialGradient(fc, fc, 2, fc, fc, fc);
  core.addColorStop(0, 'rgba(255, 255, 240, 1)');
  core.addColorStop(0.18, 'rgba(255, 224, 132, 0.96)');
  core.addColorStop(0.45, 'rgba(255, 136, 36, 0.55)');
  core.addColorStop(0.8, 'rgba(220, 70, 12, 0.12)');
  core.addColorStop(1, 'rgba(220, 70, 12, 0)');
  fCtx.fillStyle = core;
  fCtx.fillRect(0, 0, fSize, fSize);

  for (let i = 0; i < 6; i++) {
    const ang = (i / 6) * Math.PI * 2 + 0.25;
    fCtx.save();
    fCtx.translate(fc, fc);
    fCtx.rotate(ang);
    const jet = fCtx.createLinearGradient(0, 0, fc * 0.95, 0);
    jet.addColorStop(0, 'rgba(255, 246, 200, 0.95)');
    jet.addColorStop(0.45, 'rgba(255, 160, 48, 0.52)');
    jet.addColorStop(1, 'rgba(255, 96, 20, 0)');
    fCtx.fillStyle = jet;
    fCtx.beginPath();
    fCtx.moveTo(0, -10);
    fCtx.lineTo(fc * 0.95, 0);
    fCtx.lineTo(0, 10);
    fCtx.closePath();
    fCtx.fill();
    fCtx.restore();
  }

  const flashTex = new THREE.CanvasTexture(fCanvas);
  flashTex.colorSpace = THREE.SRGBColorSpace;

  const sSize = 128;
  const sCanvas = document.createElement('canvas');
  sCanvas.width = sSize;
  sCanvas.height = sSize;
  const sCtx = sCanvas.getContext('2d')!;
  const sc = sSize / 2;
  const smoke = sCtx.createRadialGradient(sc, sc, 4, sc, sc, sc);
  smoke.addColorStop(0, 'rgba(218, 222, 228, 0.45)');
  smoke.addColorStop(0.5, 'rgba(184, 190, 198, 0.18)');
  smoke.addColorStop(1, 'rgba(160, 166, 174, 0)');
  sCtx.fillStyle = smoke;
  sCtx.fillRect(0, 0, sSize, sSize);

  const smokeTex = new THREE.CanvasTexture(sCanvas);
  smokeTex.colorSpace = THREE.SRGBColorSpace;

  return {
    flashTex,
    smokeTex,
    dispose: () => {
      flashTex.dispose();
      smokeTex.dispose();
    },
  };
}

export interface RustedSteelTextureSet {
  map: THREE.CanvasTexture;
  normalMap: THREE.DataTexture;
  roughnessMap: THREE.CanvasTexture;
  metalnessMap: THREE.CanvasTexture;
  dispose: () => void;
}

/**
 * Generates museum-grade 1024×1024 PBR maps for weathered, corroded Soviet stamped steel:
 * - Albedo (sRGB): dark parkerized/blued Russian steel overlaid with layered flaking iron-oxide rust
 *   (deep ferric brown -> burnt sienna -> dusty orange-ochre crusts), oil stains & silver edge scratches
 * - Normal Map (Linear): deep corrosion pitting, rolled sheet-metal grain, weld spatter & scratch grooves
 * - Roughness Map (Linear): glossy oiled bare steel (0.28) contrasting sharply with crusty dry rust (0.95)
 * - Metalness Map (Linear): pure metallic bare steel (0.92) vs non-metallic dielectric rust patches (0.06)
 */
export function createRustedRussianSteelTextures(
  maxAnisotropy: number,
  seedOffset = 0,
): RustedSteelTextureSet {
  const size = 1024;
  const rand = seededRandom(7331 + seedOffset * 197);

  const colorCanvas = document.createElement('canvas');
  colorCanvas.width = size;
  colorCanvas.height = size;
  const cCtx = colorCanvas.getContext('2d')!;

  const heightCanvas = document.createElement('canvas');
  heightCanvas.width = size;
  heightCanvas.height = size;
  const hCtx = heightCanvas.getContext('2d')!;

  const roughCanvas = document.createElement('canvas');
  roughCanvas.width = size;
  roughCanvas.height = size;
  const rCtx = roughCanvas.getContext('2d')!;

  const metalCanvas = document.createElement('canvas');
  metalCanvas.width = size;
  metalCanvas.height = size;
  const mCtx = metalCanvas.getContext('2d')!;

  // 1. Base cold-rolled dark Soviet blued/parkerized stamped steel
  cCtx.fillStyle = '#2d3138';
  cCtx.fillRect(0, 0, size, size);

  hCtx.fillStyle = '#8e8e8e';
  hCtx.fillRect(0, 0, size, size);

  rCtx.fillStyle = 'rgb(112, 112, 112)';
  rCtx.fillRect(0, 0, size, size);

  mCtx.fillStyle = 'rgb(228, 228, 228)';
  mCtx.fillRect(0, 0, size, size);

  // 2. Rolled sheet-steel brush striations & uneven Soviet factory bluing mottling
  for (let i = 0; i < 3600; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const w = 32 + rand() * 210;
    const lum = Math.floor(34 + rand() * 30);
    cCtx.fillStyle = `rgba(${lum}, ${lum + 3}, ${lum + 6}, 0.24)`;
    cCtx.fillRect(x, y, w, 1.3);

    const hv = Math.floor(124 + rand() * 34);
    hCtx.fillStyle = `rgba(${hv},${hv},${hv},0.3)`;
    hCtx.fillRect(x, y, w, 1.2);
  }

  for (let i = 0; i < 120; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const r = 30 + rand() * 140;
    const oily = rand() > 0.45;
    const cg = cCtx.createRadialGradient(x, y, 0, x, y, r);
    cg.addColorStop(
      0,
      oily ? 'rgba(20, 24, 30, 0.35)' : 'rgba(66, 70, 76, 0.22)',
    );
    cg.addColorStop(1, 'rgba(40, 44, 50, 0)');
    cCtx.fillStyle = cg;
    cCtx.beginPath();
    cCtx.arc(x, y, r, 0, Math.PI * 2);
    cCtx.fill();

    const rg = rCtx.createRadialGradient(x, y, 0, x, y, r);
    const rv = oily ? 62 : 148;
    rg.addColorStop(0, `rgba(${rv},${rv},${rv},0.48)`);
    rg.addColorStop(1, `rgba(${rv},${rv},${rv},0)`);
    rCtx.fillStyle = rg;
    rCtx.beginPath();
    rCtx.arc(x, y, r, 0, Math.PI * 2);
    rCtx.fill();
  }

  // 3. Organic Multi-Scale Ferric Oxide Rust Blooms & Deep Pitted Corrosion Clusters
  const drawRustPatch = (
    cx: number,
    cy: number,
    rad: number,
    intensity: number,
    brightOxide: boolean,
  ) => {
    for (const ox of [-size, 0, size]) {
      for (const oy of [-size, 0, size]) {
        const px = cx + ox;
        const py = cy + oy;
        if (px < -rad || px > size + rad || py < -rad || py > size + rad) continue;

        // Multi-tone iron oxide core (deep mahogany -> burnt rust -> powdery orange-ochre rim)
        const cg = cCtx.createRadialGradient(px, py, rad * 0.08, px, py, rad);
        if (brightOxide) {
          cg.addColorStop(0, `rgba(148, 56, 20, ${0.82 * intensity})`);
          cg.addColorStop(0.48, `rgba(116, 40, 14, ${0.74 * intensity})`);
          cg.addColorStop(0.80, `rgba(74, 28, 12, ${0.42 * intensity})`);
          cg.addColorStop(1, 'rgba(60, 24, 12, 0)');
        } else {
          cg.addColorStop(0, `rgba(72, 26, 12, ${0.86 * intensity})`);
          cg.addColorStop(0.55, `rgba(104, 38, 16, ${0.65 * intensity})`);
          cg.addColorStop(1, 'rgba(64, 24, 12, 0)');
        }
        cCtx.fillStyle = cg;
        cCtx.beginPath();
        cCtx.arc(px, py, rad, 0, Math.PI * 2);
        cCtx.fill();

        // Rust eats & crusts the surface (lower pitted core with crusty rough bump rim!)
        const hg = hCtx.createRadialGradient(px, py, rad * 0.1, px, py, rad);
        hg.addColorStop(0, `rgba(38, 38, 38, ${0.62 * intensity})`);
        hg.addColorStop(0.62, `rgba(196, 196, 196, ${0.42 * intensity})`);
        hg.addColorStop(1, 'rgba(128, 128, 128, 0)');
        hCtx.fillStyle = hg;
        hCtx.beginPath();
        hCtx.arc(px, py, rad, 0, Math.PI * 2);
        hCtx.fill();

        // Rust is very matte (roughness ~0.92) & dielectric (metalness ~0.06)
        const rg = rCtx.createRadialGradient(px, py, rad * 0.1, px, py, rad);
        rg.addColorStop(0, `rgba(244, 244, 244, ${0.92 * intensity})`);
        rg.addColorStop(0.75, `rgba(222, 222, 222, ${0.68 * intensity})`);
        rg.addColorStop(1, 'rgba(220, 220, 220, 0)');
        rCtx.fillStyle = rg;
        rCtx.beginPath();
        rCtx.arc(px, py, rad, 0, Math.PI * 2);
        rCtx.fill();

        const mg = mCtx.createRadialGradient(px, py, rad * 0.1, px, py, rad);
        mg.addColorStop(0, `rgba(16, 16, 16, ${0.94 * intensity})`);
        mg.addColorStop(0.75, `rgba(34, 34, 34, ${0.72 * intensity})`);
        mg.addColorStop(1, 'rgba(34, 34, 34, 0)');
        mCtx.fillStyle = mg;
        mCtx.beginPath();
        mCtx.arc(px, py, rad, 0, Math.PI * 2);
        mCtx.fill();
      }
    }
  };

  // Large spreading corrosion patches
  for (let i = 0; i < 62; i++) {
    const cx = rand() * size;
    const cy = rand() * size;
    const baseR = 26 + rand() * 88;
    drawRustPatch(cx, cy, baseR, 0.72 + rand() * 0.28, rand() > 0.42);
    // Irregular clustered satellite flakes around each rust patch
    const satellites = 4 + Math.floor(rand() * 6);
    for (let s = 0; s < satellites; s++) {
      const ang = rand() * Math.PI * 2;
      const dist = baseR * (0.45 + rand() * 0.75);
      drawRustPatch(
        cx + Math.cos(ang) * dist,
        cy + Math.sin(ang) * dist,
        baseR * (0.22 + rand() * 0.36),
        0.65 + rand() * 0.35,
        rand() > 0.32,
      );
    }
  }

  // 4. Vertical Rain / Condensation Rust Drip Streaks (iconic Soviet weathered steel look!)
  for (let i = 0; i < 140; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const len = 35 + rand() * 165;
    const w = 1.4 + rand() * 5.2;
    const grad = cCtx.createLinearGradient(x, y, x, y + len);
    grad.addColorStop(0, `rgba(128, 44, 15, ${0.32 + rand() * 0.32})`);
    grad.addColorStop(0.65, `rgba(88, 32, 12, ${0.18 + rand() * 0.18})`);
    grad.addColorStop(1, 'rgba(72, 28, 12, 0)');
    cCtx.fillStyle = grad;
    cCtx.fillRect(x - w * 0.5, y, w, len);

    rCtx.fillStyle = 'rgba(232, 232, 232, 0.38)';
    rCtx.fillRect(x - w * 0.5, y, w, len * 0.75);
    mCtx.fillStyle = 'rgba(38, 38, 38, 0.45)';
    mCtx.fillRect(x - w * 0.5, y, w, len * 0.75);
  }

  // 5. Fine Granular Corrosion Pitting & Flaking Oxide Specks (18,000 micro-pits!)
  for (let i = 0; i < 18000; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const ps = 0.9 + rand() * 2.1;
    const isPit = rand() > 0.36;
    hCtx.fillStyle = isPit ? 'rgba(22,22,22,0.44)' : 'rgba(224,224,224,0.34)';
    hCtx.fillRect(x, y, ps, ps);
    if (rand() > 0.62) {
      cCtx.fillStyle =
        rand() > 0.48
          ? 'rgba(156, 62, 22, 0.28)'
          : 'rgba(54, 20, 10, 0.32)';
      cCtx.fillRect(x, y, ps * 1.2, ps * 1.2);
    }
  }

  // 6. Exposed Bare Silver Steel Battle Scratches & Handling Edge-Wear (high metalness, low roughness!)
  for (let i = 0; i < 210; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const len = 14 + rand() * 94;
    const ang = (rand() - 0.5) * 0.65;
    const x2 = x + Math.cos(ang) * len;
    const y2 = y + Math.sin(ang) * len;

    cCtx.strokeStyle = `rgba(176, 184, 194, ${0.24 + rand() * 0.38})`;
    cCtx.lineWidth = 0.8 + rand() * 1.3;
    cCtx.beginPath();
    cCtx.moveTo(x, y);
    cCtx.lineTo(x2, y2);
    cCtx.stroke();

    hCtx.strokeStyle = 'rgba(32, 32, 32, 0.65)';
    hCtx.lineWidth = 1.4;
    hCtx.beginPath();
    hCtx.moveTo(x, y);
    hCtx.lineTo(x2, y2);
    hCtx.stroke();

    rCtx.strokeStyle = 'rgba(42, 42, 42, 0.8)';
    rCtx.lineWidth = 1.8;
    rCtx.beginPath();
    rCtx.moveTo(x, y);
    rCtx.lineTo(x2, y2);
    rCtx.stroke();

    mCtx.strokeStyle = 'rgba(250, 250, 250, 0.9)';
    mCtx.lineWidth = 1.8;
    mCtx.beginPath();
    mCtx.moveTo(x, y);
    mCtx.lineTo(x2, y2);
    mCtx.stroke();
  }

  const map = new THREE.CanvasTexture(colorCanvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.anisotropy = maxAnisotropy;

  const normalMap = heightCanvasToNormalTexture(
    heightCanvas,
    3.4,
    maxAnisotropy,
  );

  const roughnessMap = new THREE.CanvasTexture(roughCanvas);
  roughnessMap.wrapS = THREE.RepeatWrapping;
  roughnessMap.wrapT = THREE.RepeatWrapping;
  roughnessMap.anisotropy = maxAnisotropy;

  const metalnessMap = new THREE.CanvasTexture(metalCanvas);
  metalnessMap.wrapS = THREE.RepeatWrapping;
  metalnessMap.wrapT = THREE.RepeatWrapping;
  metalnessMap.anisotropy = maxAnisotropy;

  return {
    map,
    normalMap,
    roughnessMap,
    metalnessMap,
    dispose: () => {
      map.dispose();
      normalMap.dispose();
      roughnessMap.dispose();
      metalnessMap.dispose();
    },
  };
}

export interface WoodTextureSet {
  map: THREE.CanvasTexture;
  normalMap: THREE.DataTexture;
  roughnessMap: THREE.CanvasTexture;
  dispose: () => void;
}

/**
 * Generates 1024×1024 aged Soviet amber-shellac Russian birchwood textures with
 * longitudinal grain fibers, battle dings, oil darkening & worn raw-wood patches.
 */
export function createRussianWoodTextures(
  maxAnisotropy: number,
): WoodTextureSet {
  const size = 1024;
  const rand = seededRandom(4409);

  const colorCanvas = document.createElement('canvas');
  colorCanvas.width = size;
  colorCanvas.height = size;
  const cCtx = colorCanvas.getContext('2d')!;

  const heightCanvas = document.createElement('canvas');
  heightCanvas.width = size;
  heightCanvas.height = size;
  const hCtx = heightCanvas.getContext('2d')!;

  const roughCanvas = document.createElement('canvas');
  roughCanvas.width = size;
  roughCanvas.height = size;
  const rCtx = roughCanvas.getContext('2d')!;

  // Classic aged Soviet amber-chestnut birch shellac base
  cCtx.fillStyle = '#5a2c16';
  cCtx.fillRect(0, 0, size, size);
  hCtx.fillStyle = '#808080';
  hCtx.fillRect(0, 0, size, size);
  rCtx.fillStyle = 'rgb(122, 122, 122)';
  rCtx.fillRect(0, 0, size, size);

  // Flowing longitudinal wood grain bands
  for (let y = 0; y < size; y += 2) {
    const wave =
      Math.sin(y * 0.032) * 0.5 +
      Math.sin(y * 0.11 + 1.4) * 0.3 +
      Math.sin(y * 0.27) * 0.2;
    const dark = wave > 0;
    const alpha = 0.08 + Math.abs(wave) * 0.22;
    cCtx.fillStyle = dark
      ? `rgba(42, 18, 8, ${alpha})`
      : `rgba(134, 68, 28, ${alpha * 0.9})`;
    cCtx.fillRect(0, y, size, 2.2);

    const hv = Math.floor(128 + wave * 34);
    hCtx.fillStyle = `rgb(${hv},${hv},${hv})`;
    hCtx.fillRect(0, y, size, 2);
  }

  // Fine organic wood pores & fibrous grain streaks
  for (let i = 0; i < 4200; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const len = 18 + rand() * 140;
    cCtx.fillStyle =
      rand() > 0.45
        ? `rgba(28, 12, 6, ${0.18 + rand() * 0.26})`
        : `rgba(156, 86, 38, ${0.14 + rand() * 0.18})`;
    cCtx.fillRect(x, y, len, 1.0 + rand() * 1.2);

    hCtx.fillStyle = rand() > 0.5 ? 'rgba(54,54,54,0.34)' : 'rgba(176,176,176,0.22)';
    hCtx.fillRect(x, y, len, 1.1);
  }

  // Chipped shellac exposing dry pale raw wood + dark grease-soaked grip grime
  for (let i = 0; i < 95; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const rx = 18 + rand() * 74;
    const ry = 8 + rand() * 28;
    const isRawChip = rand() > 0.54;
    cCtx.save();
    cCtx.translate(x, y);
    cCtx.scale(rx, ry);
    const cg = cCtx.createRadialGradient(0, 0, 0.1, 0, 0, 1);
    cg.addColorStop(
      0,
      isRawChip ? 'rgba(164, 114, 68, 0.45)' : 'rgba(20, 12, 8, 0.46)',
    );
    cg.addColorStop(1, 'rgba(60, 30, 14, 0)');
    cCtx.fillStyle = cg;
    cCtx.beginPath();
    cCtx.arc(0, 0, 1, 0, Math.PI * 2);
    cCtx.fill();
    cCtx.restore();

    rCtx.save();
    rCtx.translate(x, y);
    rCtx.scale(rx, ry);
    const rg = rCtx.createRadialGradient(0, 0, 0.1, 0, 0, 1);
    const rv = isRawChip ? 228 : 88;
    rg.addColorStop(0, `rgba(${rv},${rv},${rv},0.65)`);
    rg.addColorStop(1, `rgba(${rv},${rv},${rv},0)`);
    rCtx.fillStyle = rg;
    rCtx.beginPath();
    rCtx.arc(0, 0, 1, 0, Math.PI * 2);
    rCtx.fill();
    rCtx.restore();
  }

  // Deep field gouges & battle dents across stock/handguard
  for (let i = 0; i < 110; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const len = 10 + rand() * 48;
    const ang = (rand() - 0.5) * 1.4;
    cCtx.strokeStyle = 'rgba(30, 14, 8, 0.55)';
    cCtx.lineWidth = 1.4 + rand() * 1.8;
    cCtx.beginPath();
    cCtx.moveTo(x, y);
    cCtx.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
    cCtx.stroke();

    hCtx.strokeStyle = 'rgba(20, 20, 20, 0.72)';
    hCtx.lineWidth = 2.0;
    hCtx.beginPath();
    hCtx.moveTo(x, y);
    hCtx.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
    hCtx.stroke();
  }

  const map = new THREE.CanvasTexture(colorCanvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.anisotropy = maxAnisotropy;

  const normalMap = heightCanvasToNormalTexture(
    heightCanvas,
    2.6,
    maxAnisotropy,
  );

  const roughnessMap = new THREE.CanvasTexture(roughCanvas);
  roughnessMap.wrapS = THREE.RepeatWrapping;
  roughnessMap.wrapT = THREE.RepeatWrapping;
  roughnessMap.anisotropy = maxAnisotropy;

  return {
    map,
    normalMap,
    roughnessMap,
    dispose: () => {
      map.dispose();
      normalMap.dispose();
      roughnessMap.dispose();
    },
  };
}

/**
 * Generates 512×512 iconic Soviet AG-4S mottled burnt-orange / oxblood fiberglass Bakelite
 * texture set (used on authentic Russian SMG/carbine magazines and grips).
 */
export function createSovietBakeliteTextures(
  maxAnisotropy: number,
): WoodTextureSet {
  const size = 512;
  const rand = seededRandom(6147);

  const colorCanvas = document.createElement('canvas');
  colorCanvas.width = size;
  colorCanvas.height = size;
  const cCtx = colorCanvas.getContext('2d')!;

  const heightCanvas = document.createElement('canvas');
  heightCanvas.width = size;
  heightCanvas.height = size;
  const hCtx = heightCanvas.getContext('2d')!;

  const roughCanvas = document.createElement('canvas');
  roughCanvas.width = size;
  roughCanvas.height = size;
  const rCtx = roughCanvas.getContext('2d')!;

  // Classic Soviet russet-orange phenolic resin base
  cCtx.fillStyle = '#8b3516';
  cCtx.fillRect(0, 0, size, size);
  hCtx.fillStyle = '#808080';
  hCtx.fillRect(0, 0, size, size);
  rCtx.fillStyle = 'rgb(96, 96, 96)';
  rCtx.fillRect(0, 0, size, size);

  // Iconic swirled marbled resin mottling
  for (let i = 0; i < 180; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const rx = 18 + rand() * 82;
    const ry = 6 + rand() * 24;
    const rot = (rand() - 0.5) * 0.9;
    const tone = rand();
    cCtx.save();
    cCtx.translate(x, y);
    cCtx.rotate(rot);
    cCtx.scale(rx, ry);
    const g = cCtx.createRadialGradient(0, 0, 0.05, 0, 0, 1);
    if (tone < 0.38) {
      g.addColorStop(0, 'rgba(176, 74, 24, 0.55)');
      g.addColorStop(1, 'rgba(176, 74, 24, 0)');
    } else if (tone < 0.72) {
      g.addColorStop(0, 'rgba(66, 20, 10, 0.62)');
      g.addColorStop(1, 'rgba(66, 20, 10, 0)');
    } else {
      g.addColorStop(0, 'rgba(128, 38, 16, 0.48)');
      g.addColorStop(1, 'rgba(128, 38, 16, 0)');
    }
    cCtx.fillStyle = g;
    cCtx.beginPath();
    cCtx.arc(0, 0, 1, 0, Math.PI * 2);
    cCtx.fill();
    cCtx.restore();
  }

  // Embedded fiberglass resin flecks & magazine insertion scuff scratches
  for (let i = 0; i < 2200; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const len = 4 + rand() * 16;
    const ang = rand() * Math.PI;
    cCtx.strokeStyle =
      rand() > 0.5 ? 'rgba(202, 102, 42, 0.25)' : 'rgba(48, 16, 8, 0.28)';
    cCtx.lineWidth = 0.8;
    cCtx.beginPath();
    cCtx.moveTo(x, y);
    cCtx.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
    cCtx.stroke();

    hCtx.strokeStyle = rand() > 0.5 ? 'rgba(155,155,155,0.28)' : 'rgba(95,95,95,0.28)';
    hCtx.lineWidth = 0.8;
    hCtx.beginPath();
    hCtx.moveTo(x, y);
    hCtx.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
    hCtx.stroke();
  }

  for (let i = 0; i < 90; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const len = 16 + rand() * 64;
    const ang = (rand() - 0.5) * 0.4;
    cCtx.strokeStyle = 'rgba(196, 134, 88, 0.24)';
    cCtx.lineWidth = 1.1;
    cCtx.beginPath();
    cCtx.moveTo(x, y);
    cCtx.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
    cCtx.stroke();
    rCtx.strokeStyle = 'rgba(198, 198, 198, 0.55)';
    rCtx.lineWidth = 1.8;
    rCtx.beginPath();
    rCtx.moveTo(x, y);
    rCtx.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len);
    rCtx.stroke();
  }

  const map = new THREE.CanvasTexture(colorCanvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.anisotropy = maxAnisotropy;

  const normalMap = heightCanvasToNormalTexture(
    heightCanvas,
    1.8,
    maxAnisotropy,
  );

  const roughnessMap = new THREE.CanvasTexture(roughCanvas);
  roughnessMap.wrapS = THREE.RepeatWrapping;
  roughnessMap.wrapT = THREE.RepeatWrapping;
  roughnessMap.anisotropy = maxAnisotropy;

  return {
    map,
    normalMap,
    roughnessMap,
    dispose: () => {
      map.dispose();
      normalMap.dispose();
      roughnessMap.dispose();
    },
  };
}

