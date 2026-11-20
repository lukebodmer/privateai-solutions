/** @type {import('tailwindcss').Config} */

// The site wears Neuman's Nord palette (neuman-client/web/src/palette.css,
// `[data-palette="nord"]`), so the product and the site that shows it read as
// one thing. The anchors below are Neuman's values; the steps between them
// fill out the 50–950 ladder Tailwind classes expect.
//
// `nord` is the neutral ladder, Polar Night up to Snow Storm. Like Neuman's,
// the darks sit a step below the published Polar Night: 950 is Neuman's window
// (`--bg`), 900 its card (`--panel`), 800 between its raised control and its
// line. 400 is Neuman's `--dim`, 50 its `--text`.
const nord = {
  50: '#eceff4',
  100: '#e5e9f0',
  200: '#d8dee9',
  300: '#c0c8d6',
  400: '#9aa8bc',
  500: '#7b88a1',
  600: '#616e88',
  700: '#4c566a',
  800: '#383f4c',
  900: '#272c36',
  950: '#1e232b',
};

// `frost` is the accent: Nord's frost blue (nord8, Neuman's `--accent`) at 400.
const frost = {
  50: '#f0f8fa',
  100: '#e0f0f4',
  200: '#c5e2ea',
  300: '#a9d3de',
  400: '#88c0d0',
  500: '#6fa9bb',
  600: '#5a95a8',
  700: '#487a8a',
  800: '#3a6270',
  900: '#2f505b',
  950: '#1f363e',
};

// The status hues keep their Tailwind names (red still means red) but take
// Nord's Aurora values at 400, so a warning or an error sits in the palette
// rather than on top of it. Each ladder runs from Snow Storm through the hue
// to Polar Night.
function ladder(hue) {
  const ends = { 50: '#eceff4', 950: '#1e232b' };
  const mix = (a, b, t) => {
    const p = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
    const [x, y] = [p(a), p(b)];
    return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('');
  };
  const out = {};
  for (const [step, t] of [[50, 0], [100, 0.15], [200, 0.35], [300, 0.65], [400, 1]]) out[step] = mix(ends[50], hue, t);
  for (const [step, t] of [[500, 0.15], [600, 0.3], [700, 0.48], [800, 0.64], [900, 0.78], [950, 0.88]]) out[step] = mix(hue, ends[950], t);
  return out;
}

export default {
  content: ['./src/**/*.{astro,html,js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        nord,
        frost,
        red: ladder('#dc9099'),    // Neuman's --bad (nord11, lightened to be legible)
        rose: ladder('#dc9099'),
        amber: ladder('#ebcb8b'),  // nord13, Neuman's --warn
        sky: ladder('#81a1c1'),    // nord9
        teal: ladder('#8fbcbb'),   // nord7
        violet: ladder('#c4a3c5'), // Neuman's --violet (nord15, lightened)
      },
      fontFamily: {
        // Self-hosted (@fontsource-variable/inter, imported in Base.astro):
        // the same face on every visitor's machine, and no third-party request.
        sans: ['"Inter Variable"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
    },
  },
};
