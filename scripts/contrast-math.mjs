export function hslToRgb(h, s, l) {
  const sat = s / 100;
  const lum = l / 100;
  const k = (n) => (n + h / 30) % 12;
  const a = sat * Math.min(lum, 1 - lum);
  const f = (n) => lum - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

function sRgbToLinear(c) {
  const channel = c / 255;
  return channel <= 0.04045
    ? channel / 12.92
    : Math.pow((channel + 0.055) / 1.055, 2.4);
}

function relativeLuminance([r, g, b]) {
  return (
    0.2126 * sRgbToLinear(r) +
    0.7152 * sRgbToLinear(g) +
    0.0722 * sRgbToLinear(b)
  );
}

export function contrastRatio(rgb1, rgb2) {
  const l1 = relativeLuminance(rgb1);
  const l2 = relativeLuminance(rgb2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

export function compositeOver(tintRgb, backdropRgb, alpha) {
  return tintRgb.map((channel, index) => channel * alpha + backdropRgb[index] * (1 - alpha));
}

/**
 * The ratio of a pair in one theme, or null when a token is missing. A pair
 * with `opacity` is a whole control toned down over `page`: its text and its
 * fill are both blended with the page before they are compared.
 */
export function pairRatio({ token, background, tint, opacity, page }, tokens, theme) {
  const fill = tint?.[theme];
  if (!tokens[token] || !tokens[background] || (fill && !tokens[fill.token])) return null;
  const backdrop = hslToRgb(...tokens[background]);
  const surface = fill
    ? compositeOver(hslToRgb(...tokens[fill.token]), backdrop, fill.alpha)
    : backdrop;
  const text = hslToRgb(...tokens[token]);
  if (opacity === undefined) return contrastRatio(text, surface);
  if (!tokens[page]) return null;
  const behind = hslToRgb(...tokens[page]);
  return contrastRatio(compositeOver(text, behind, opacity), compositeOver(surface, behind, opacity));
}
