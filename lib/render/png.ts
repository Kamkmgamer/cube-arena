// SVG -> PNG with resvg and a bundled font, so the same state always gives
// the same bytes on any machine.

import { join } from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import type { CubeState } from '../cube/engine';
import { type AtlasInfo, atlasSvg } from './atlas';

const FONT = join(process.cwd(), 'lib/render/fonts/DejaVuSans-Bold.ttf');

export function svgToPng(svg: string): Buffer {
  const r = new Resvg(svg, {
    font: { fontFiles: [FONT], loadSystemFonts: false, defaultFontFamily: 'DejaVu Sans' },
    fitTo: { mode: 'original' },
  });
  return r.render().asPng();
}

export const atlasPng = (state: CubeState, n: number, info?: AtlasInfo) => svgToPng(atlasSvg(state, n, info));
