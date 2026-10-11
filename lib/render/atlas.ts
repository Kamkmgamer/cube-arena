// The observation a model sees: one 1400x800 image with the cube as a
// cross-shaped net (every sticker, straight on) plus two 3D corner views and a
// colour legend. Built as SVG from the exact state; nothing in it but pixels
// and public labels.

import { FACES, FACE_FRAME, type CubeState, type Face, type Vec, stickers } from '../cube/engine';

export const ATLAS_WIDTH = 1400;
export const ATLAS_HEIGHT = 800;

/** Sticker colours, by the face that colour belongs to when solved. */
export const COLOURS: Record<Face, { hex: string; name: string }> = {
  U: { hex: '#F4F4F0', name: 'white' },
  R: { hex: '#C8102E', name: 'red' },
  F: { hex: '#00A04A', name: 'green' },
  D: { hex: '#FFD200', name: 'yellow' },
  L: { hex: '#FF7A00', name: 'orange' },
  B: { hex: '#1C4FC4', name: 'blue' },
};

const BG = '#3A3D45';
const BODY = '#0E0E10';
const INK = '#F2F2F2';
const MUTED = '#B9BCC6';

/** Where each face sits in the cross: column, row. */
const NET_POS: Record<Face, [number, number]> = { U: [1, 0], L: [0, 1], F: [1, 1], R: [2, 1], B: [3, 1], D: [1, 2] };

const r1 = (v: number) => Math.round(v * 10) / 10;

function netSvg(state: CubeState, n: number, x0: number, y0: number, tile: number, gap: number): string {
  const out: string[] = [];
  const cell = tile / n;
  const pad = Math.max(2, cell * 0.07);
  const rad = cell * 0.13;
  FACES.forEach((face, f) => {
    const [cx, cy] = NET_POS[face];
    const fx = x0 + cx * (tile + gap);
    const fy = y0 + cy * (tile + gap);
    out.push(`<text x="${fx}" y="${fy - 9}" font-size="22" fill="${INK}">${face}</text>`);
    out.push(`<rect x="${fx - 3}" y="${fy - 3}" width="${tile + 6}" height="${tile + 6}" rx="10" fill="${BODY}"/>`);
    for (let row = 0; row < n; row++) {
      for (let col = 0; col < n; col++) {
        const c = FACES[state[f * n * n + row * n + col]];
        out.push(
          `<rect x="${r1(fx + col * cell + pad)}" y="${r1(fy + row * cell + pad)}" width="${r1(cell - 2 * pad)}" height="${r1(cell - 2 * pad)}" rx="${r1(rad)}" fill="${COLOURS[c].hex}"/>`,
        );
      }
    }
  });
  return out.join('');
}

const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const add = (a: Vec, b: Vec, k = 1): Vec => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];

/** Isometric view from a corner. `toCamera` points from the cube to the eye. */
function isoSvg(state: CubeState, n: number, toCamera: Vec, box: { x: number; y: number; w: number; h: number }): string {
  const right: Vec = toCamera[0] > 0 ? [1, 0, -1] : [-1, 0, 1];
  const up: Vec = [-1, 2, -1];
  const rl = Math.SQRT2;
  const ul = Math.sqrt(6);
  const proj = (p: Vec): [number, number] => [dot(p, right) / rl, -dot(p, up) / ul];
  // Cube spans -n..n in doubled coordinates; its silhouette is a hexagon of radius 2n*sqrt(2/3).
  const radius = 2 * n * Math.sqrt(2 / 3);
  const scale = (Math.min(box.w, box.h) / 2 - 6) / radius;
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  const P = (p: Vec) => {
    const [sx, sy] = proj(p);
    return `${r1(cx + sx * scale)},${r1(cy + sy * scale)}`;
  };
  const out: string[] = [];
  const all = stickers(n);
  for (const face of FACES) {
    const { n: nrm, r, d } = FACE_FRAME[face];
    if (dot(nrm, toCamera) <= 0) continue;
    const c = add([0, 0, 0], nrm, n);
    const body = [add(add(c, r, -n), d, -n), add(add(c, r, n), d, -n), add(add(c, r, n), d, n), add(add(c, r, -n), d, n)];
    out.push(`<polygon points="${body.map(P).join(' ')}" fill="${BODY}" stroke="${BODY}" stroke-width="4" stroke-linejoin="round"/>`);
  }
  all.forEach((s, i) => {
    if (dot(s.normal, toCamera) <= 0) return;
    const { r, d } = FACE_FRAME[s.face];
    const c = add(s.pos, s.normal, 1);
    const k = 0.84;
    const quad = [add(add(c, r, -k), d, -k), add(add(c, r, k), d, -k), add(add(c, r, k), d, k), add(add(c, r, -k), d, k)];
    out.push(`<polygon points="${quad.map(P).join(' ')}" fill="${COLOURS[FACES[state[i]]].hex}" stroke-linejoin="round"/>`);
  });
  return out.join('');
}

export interface AtlasInfo {
  /** Moves counted so far in this attempt. */
  moves?: number;
  /** Short caption, e.g. "Level 4" or "Full scramble". */
  caption?: string;
}

export function atlasSvg(state: CubeState, n: number, info: AtlasInfo = {}): string {
  const tile = 216;
  const gap = 34;
  const x0 = 40;
  const y0 = 50;
  const px = 1040;
  const pw = 330;
  const parts: string[] = [];
  parts.push(`<rect width="${ATLAS_WIDTH}" height="${ATLAS_HEIGHT}" fill="${BG}"/>`);
  parts.push(netSvg(state, n, x0, y0, tile, gap));

  parts.push(`<text x="${px}" y="58" font-size="30" fill="${INK}">${n}×${n} cube</text>`);
  const sub = [info.caption, info.moves !== undefined ? `moves so far: ${info.moves}` : undefined].filter(Boolean).join(' · ');
  if (sub) parts.push(`<text x="${px}" y="88" font-size="18" fill="${MUTED}">${sub}</text>`);

  const mid = px + pw / 2;
  const caption = (y: number, a: string, b: string) =>
    `<text x="${mid}" y="${y}" font-size="16" fill="${INK}" text-anchor="middle">${a}</text>` +
    `<text x="${mid}" y="${y + 20}" font-size="15" fill="${MUTED}" text-anchor="middle">${b}</text>`;
  parts.push(isoSvg(state, n, [1, 1, 1], { x: px, y: 102, w: pw, h: 226 }));
  parts.push(caption(346, 'view from top-front-right', 'U top · F left · R right'));
  parts.push(isoSvg(state, n, [-1, -1, -1], { x: px, y: 384, w: pw, h: 226 }));
  parts.push(caption(628, 'view from bottom-back-left', 'D bottom · B left · L right'));

  FACES.forEach((face, i) => {
    const lx = px + 6 + (i % 2) * 165;
    const ly = 674 + Math.floor(i / 2) * 38;
    parts.push(`<rect x="${lx}" y="${ly}" width="26" height="26" rx="5" fill="${COLOURS[face].hex}" stroke="${BODY}" stroke-width="2"/>`);
    parts.push(`<text x="${lx + 36}" y="${ly + 20}" font-size="17" fill="${INK}">${face} = ${COLOURS[face].name}</text>`);
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${ATLAS_WIDTH}" height="${ATLAS_HEIGHT}" viewBox="0 0 ${ATLAS_WIDTH} ${ATLAS_HEIGHT}" font-family="DejaVu Sans" font-weight="bold">${parts.join('')}</svg>`;
}
