import type { PNG } from "pngjs";

export interface Bbox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * Average CIEDE2000 between gold and actual over a bounding box
 * (typically the diff bbox, so color error is not diluted by matching chrome).
 */
export function avgDeltaE2000(gold: PNG, actual: PNG, bbox: Bbox): number {
  const { x0, y0, x1, y1 } = bbox;
  let sum = 0;
  let count = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (gold.width * y + x) << 2;
      const lab1 = rgbToLab(
        gold.data[i] as number,
        gold.data[i + 1] as number,
        gold.data[i + 2] as number,
      );
      const lab2 = rgbToLab(
        actual.data[i] as number,
        actual.data[i + 1] as number,
        actual.data[i + 2] as number,
      );
      sum += ciede2000(lab1, lab2);
      count += 1;
    }
  }
  return count === 0 ? 0 : sum / count;
}

type Lab = [number, number, number];

function rgbToLab(r: number, g: number, b: number): Lab {
  // sRGB -> linear
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const rl = lin(r);
  const gl = lin(g);
  const bl = lin(b);
  // linear RGB -> XYZ (D65)
  const x = rl * 0.4124564 + gl * 0.3575761 + bl * 0.1804375;
  const y = rl * 0.2126729 + gl * 0.7151522 + bl * 0.072175;
  const z = rl * 0.0193339 + gl * 0.119192 + bl * 0.9503041;
  // XYZ -> Lab (D65 white)
  const xn = 0.95047;
  const yn = 1.0;
  const zn = 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(x / xn);
  const fy = f(y / yn);
  const fz = f(z / zn);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** CIEDE2000 color difference. Reference: Sharma, Wu, Dalal (2005). */
function ciede2000([L1, a1, b1]: Lab, [L2, a2, b2]: Lab): number {
  const deg2rad = Math.PI / 180;
  const rad2deg = 180 / Math.PI;

  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const Cbar = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Math.pow(Cbar, 7) / (Math.pow(Cbar, 7) + Math.pow(25, 7))));
  const a1p = (1 + G) * a1;
  const a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1);
  const C2p = Math.hypot(a2p, b2);
  const h1p = C1p === 0 ? 0 : (Math.atan2(b1, a1p) * rad2deg + 360) % 360;
  const h2p = C2p === 0 ? 0 : (Math.atan2(b2, a2p) * rad2deg + 360) % 360;

  const dLp = L2 - L1;
  const dCp = C2p - C1p;

  let dhp = 0;
  if (C1p * C2p !== 0) {
    const dh = h2p - h1p;
    if (Math.abs(dh) <= 180) dhp = dh;
    else if (dh > 180) dhp = dh - 360;
    else dhp = dh + 360;
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp / 2) * deg2rad);

  const Lbarp = (L1 + L2) / 2;
  const Cbarp = (C1p + C2p) / 2;

  let hbarp = h1p + h2p;
  if (C1p * C2p !== 0) {
    const diff = Math.abs(h1p - h2p);
    if (diff > 180) {
      hbarp = h1p + h2p < 360 ? (h1p + h2p + 360) / 2 : (h1p + h2p - 360) / 2;
    } else {
      hbarp = (h1p + h2p) / 2;
    }
  }

  const T =
    1 -
    0.17 * Math.cos((hbarp - 30) * deg2rad) +
    0.24 * Math.cos(2 * hbarp * deg2rad) +
    0.32 * Math.cos((3 * hbarp + 6) * deg2rad) -
    0.2 * Math.cos((4 * hbarp - 63) * deg2rad);
  const dTheta = 30 * Math.exp(-Math.pow((hbarp - 275) / 25, 2));
  const Rc = 2 * Math.sqrt(Math.pow(Cbarp, 7) / (Math.pow(Cbarp, 7) + Math.pow(25, 7)));
  const Sl = 1 + (0.015 * Math.pow(Lbarp - 50, 2)) / Math.sqrt(20 + Math.pow(Lbarp - 50, 2));
  const Sc = 1 + 0.045 * Cbarp;
  const Sh = 1 + 0.015 * Cbarp * T;
  const Rt = -Math.sin(2 * dTheta * deg2rad) * Rc;

  return Math.sqrt(
    Math.pow(dLp / Sl, 2) +
      Math.pow(dCp / Sc, 2) +
      Math.pow(dHp / Sh, 2) +
      Rt * (dCp / Sc) * (dHp / Sh),
  );
}
