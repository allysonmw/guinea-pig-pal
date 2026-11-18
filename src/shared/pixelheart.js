// A little pixel-art heart (drawn on a grid, so it stays crisp at any size).
// O = outline, F = fill, L = light, W = shine, S = shadow, . = empty
const GRID = [
  '.OOO...OOO.',
  'OLWLO.OFFFO',
  'OWLFFOFFFSO',
  'OLFFFFFFFSO',
  'OFFFFFFFFSO',
  '.OFFFFFFSO.',
  '..OFFFFSO..',
  '...OFFSO...',
  '....OSO....',
  '.....O.....',
];
const PALETTES = {
  pink: { O: '#f0609e', F: '#ffb3d6', L: '#ffd6ea', W: '#ffffff', S: '#ff86bd' },
  rose: { O: '#e8467f', F: '#ff9ac4', L: '#ffc7de', W: '#ffffff', S: '#ff6fa6' },
  blush: { O: '#f47aaf', F: '#ffc8e1', L: '#ffe2ef', W: '#ffffff', S: '#ffa3cc' },
};

function svg(palette) {
  const p = PALETTES[palette] || PALETTES.pink;
  let rects = '';
  GRID.forEach((row, y) => [...row].forEach((ch, x) => {
    if (p[ch]) rects += `<rect x="${x}" y="${y}" width="1.02" height="1.02" fill="${p[ch]}"/>`;
  }));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 11 10" shape-rendering="crispEdges">${rects}</svg>`;
}

export const HEART_URLS = Object.keys(PALETTES).map((k) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg(k))}`);
export const heartUrl = () => HEART_URLS[Math.floor(Math.random() * HEART_URLS.length)];

// Ready-to-draw images for canvas use
export const HEART_IMAGES = HEART_URLS.map((u) => { const im = new Image(); im.src = u; return im; });
