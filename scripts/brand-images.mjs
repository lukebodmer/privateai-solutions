// Builds the raster images that carry the mark outside the site's own pages:
//
// - The social card that link previews show (Slack, LinkedIn, X, iMessage):
//   public/og-image.svg, the source, and public/og-image.png, what Base.astro's
//   og:image and twitter:image point at. Most of those services will not
//   render an SVG, so the PNG is the one they fetch. Its copy is the home
//   page's hero (src/pages/index.astro); change it there first. The SVG embeds
//   Inter from @fontsource-variable/inter so it renders the same anywhere.
// - public/apple-touch-icon.png, the 180×180 icon iOS uses for "Add to Home
//   Screen" (Safari ignores SVG favicons). Full-bleed square: iOS rounds the
//   corners itself.
//
// Headless Chromium rasterises both.
//
//   pnpm brand     # needs `chromium` on PATH
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const W = 1200, H = 630;
const C = {
  bg: '#1e232b', cell: '#262b35', line: '#383f4c',
  snow: '#eceff4', text: '#d8dee9', muted: '#9aa8bc', dim: '#7b88a1',
  frost300: '#a9d3de', frost400: '#88c0d0', frost500: '#6fa9bb', frost950: '#1f363e',
};

const inter = fs.readFileSync(path.join(root, 'node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2')).toString('base64');
const font = `font-family="Inter, sans-serif"`;
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

// ---- The mark: the glider at generation 0, as in GliderMark.astro ----
const GLIDER = [[1, 0], [2, 1], [0, 2], [1, 2], [2, 2]];
function mark(x, y, size) {
  const cell = size / 3, s = cell * 5 / 6, rx = s * 0.24, out = [];
  for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) {
    const live = GLIDER.some(([a, b]) => a === i && b === j);
    out.push(`<rect x="${x + i * cell}" y="${y + j * cell}" width="${s}" height="${s}" rx="${rx}" fill="${live ? C.frost400 : C.line}"${live ? '' : ' opacity="0.7"'}/>`);
  }
  return out.join('');
}

// ---- The field: one glider seen every 16 generations ----
// A glider repeats its shape every 4 generations, one cell further along the
// diagonal, so after 16 it is the same shape 4 cells on. Drawing it at
// generations 0, 16, 32 and 48 shows its real path, oldest faintest.
const F = { x: 724, y: 68, cell: 30, cols: 15, rows: 17 };
function field() {
  const s = F.cell - 6, rx = 5, out = [];
  const at = (i, j) => [F.x + i * F.cell, F.y + j * F.cell];
  for (let j = 0; j < F.rows; j++) for (let i = 0; i < F.cols; i++) {
    const [x, y] = at(i, j);
    out.push(`<rect x="${x}" y="${y}" width="${s}" height="${s}" rx="${rx}" fill="${C.cell}"/>`);
  }
  const start = [0, 1];
  [0.14, 0.28, 0.55, 1].forEach((opacity, k) => {
    for (const [a, b] of GLIDER) {
      const [x, y] = at(start[0] + a + 4 * k, start[1] + b + 4 * k);
      out.push(`<rect x="${x}" y="${y}" width="${s}" height="${s}" rx="${rx}" fill="${C.frost400}" opacity="${opacity}"/>`);
    }
  });
  return out.join('');
}

// ---- Copy (from the home page hero) ----
const eyebrow = 'Neuman · open source · released';
const headline = ['Free your AI', 'from the cloud.'];
const lede = 'The future of AI is local and open source.';
const points = ['On machines you own.', 'Open to inspect and adapt.', 'Your data stays yours.'];

const L = 88; // left margin of the text column
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <style>@font-face { font-family: Inter; font-weight: 100 900; src: url(data:font/woff2;base64,${inter}) format("woff2"); }</style>
    <linearGradient id="wash" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${C.frost950}" stop-opacity="0.55"/>
      <stop offset="0.55" stop-color="${C.bg}" stop-opacity="0"/>
    </linearGradient>
    <linearGradient id="frost" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${C.frost300}"/>
      <stop offset="1" stop-color="${C.frost500}"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="${C.bg}"/>
  <rect width="${W}" height="${H}" fill="url(#wash)"/>
  ${field()}

  <!-- Wordmark, as in the nav -->
  ${mark(L, 64, 42)}
  <text x="${L + 60}" y="95" ${font} font-size="27" letter-spacing="-0.6"><tspan font-weight="500" fill="${C.snow}">Private AI</tspan> <tspan font-weight="300" fill="url(#frost)">Solutions</tspan></text>

  <!-- Hero -->
  <text x="${L}" y="212" ${font} font-size="15" font-weight="600" letter-spacing="1.6" fill="${C.frost400}">${esc(eyebrow.toUpperCase())}</text>
  <text ${font} font-size="70" font-weight="300" letter-spacing="-2.1">
    <tspan x="${L - 3}" y="292" fill="${C.snow}">${esc(headline[0])}</tspan>
    <tspan x="${L - 3}" y="368" fill="url(#frost)">${esc(headline[1])}</tspan>
  </text>
  <text x="${L}" y="426" ${font} font-size="25" font-weight="300" fill="${C.text}">${esc(lede)}</text>
  ${points.map((p, k) => `<rect x="${L}" y="${472 + k * 36 - 6}" width="22" height="1.5" fill="${C.frost400}"/><text x="${L + 38}" y="${472 + k * 36}" ${font} font-size="19" font-weight="400" fill="${C.muted}">${esc(p)}</text>`).join('\n  ')}

  <text x="${W - 40}" y="${H - 28}" ${font} font-size="15" font-weight="500" fill="${C.dim}" text-anchor="end">privateai.solutions</text>
</svg>
`;

const svgPath = path.join(root, 'public/og-image.svg');
const pngPath = path.join(root, 'public/og-image.png');
fs.writeFileSync(svgPath, svg);

// Rasterise through a page that waits for the embedded font before the shot.
function rasterise(svgFile, pngFile, w, h) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'brand-'));
  fs.writeFileSync(path.join(tmp, 'page.html'), `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:${C.bg}}img{display:block}</style><img src="file://${svgFile}" width="${w}" height="${h}">`);
  execFileSync('chromium', [
    '--headless', '--disable-gpu', '--hide-scrollbars', '--allow-file-access-from-files',
    `--window-size=${w},${h}`, '--virtual-time-budget=3000', '--force-device-scale-factor=1',
    `--screenshot=${pngFile}`, `file://${path.join(tmp, 'page.html')}`,
  ], { stdio: 'ignore' });
  fs.rmSync(tmp, { recursive: true, force: true });
}
rasterise(svgPath, pngPath, W, H);

// ---- Home-screen icon: the glider centred on a full-bleed square ----
const ICON = 180, iconSize = 108;
const iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${ICON}" height="${ICON}" viewBox="0 0 ${ICON} ${ICON}"><rect width="${ICON}" height="${ICON}" fill="${C.bg}"/>${mark((ICON - iconSize) / 2 + iconSize / 36, (ICON - iconSize) / 2 + iconSize / 36, iconSize)}</svg>`;
const iconTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'brand-icon-'));
const iconSvgPath = path.join(iconTmp, 'icon.svg');
fs.writeFileSync(iconSvgPath, iconSvg);
const iconPath = path.join(root, 'public/apple-touch-icon.png');
rasterise(iconSvgPath, iconPath, ICON, ICON);
fs.rmSync(iconTmp, { recursive: true, force: true });

for (const p of [svgPath, pngPath, iconPath]) console.log('wrote', path.relative(root, p));
