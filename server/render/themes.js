// Every color is named for its job. Contrast between text and bg is checked in tests.
export const THEMES = {
  daylight: { name: 'Daylight', bg: '#F7F8FB', panel: '#E8ECF7', ink: '#151A33', muted: '#4B5275', accent: '#3A55F2', accent2: '#F5A300', onAccent: '#FFFFFF', dark: '#151A33', onDark: '#F4F6FF', line: '#C9D0EA' },
  midnight: { name: 'Midnight', bg: '#10132B', panel: '#1B2045', ink: '#F1F3FF', muted: '#B3B9DE', accent: '#8C9CFF', accent2: '#FFC93C', onAccent: '#10132B', dark: '#070918', onDark: '#F1F3FF', line: '#343B70' },
  moss: { name: 'Moss', bg: '#EEF3EC', panel: '#DCE8D8', ink: '#142A1D', muted: '#40574A', accent: '#166A40', accent2: '#D98A1F', onAccent: '#FFFFFF', dark: '#142A1D', onDark: '#EEF6EA', line: '#B5CBB0' },
  coral: { name: 'Coral', bg: '#FFF1EE', panel: '#FFDDD6', ink: '#3A1220', muted: '#7A4350', accent: '#B81F55', accent2: '#2457C5', onAccent: '#FFFFFF', dark: '#3A1220', onDark: '#FFF1EE', line: '#F0BDB4' },
};

export function themeOf(name) {
  return THEMES[name] || THEMES.daylight;
}

function lum(hex) {
  const c = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a, b) {
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}
