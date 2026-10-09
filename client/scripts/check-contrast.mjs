// Contrast guard for both themes (Node 20+, no dependencies). Run: npm run check:contrast
// 1. Parses the custom properties of :root and :root[data-theme='dark'] in src/index.css, resolves
//    var() references (dark inherits unset tokens from :root) and checks WCAG contrast for PAIRS.
// 2. Scans src/**/*.tsx for raw colours in style props and SVG attributes. A line containing
//    "theme-exempt: <reason>" is skipped (only for components that need literal colours, e.g. a QR canvas).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const CSS_PATH = path.join(ROOT, 'src', 'index.css');

/** [foreground, background, minimum ratio]. Later wishes append their own pairs here. */
const PAIRS = [];
for (const fg of ['--text', '--text-muted', '--link', '--danger', '--success', '--warning']) {
  for (const bg of ['--bg', '--surface', '--surface-alt', '--input-bg']) PAIRS.push([fg, bg, 4.5]);
}
PAIRS.push(
  ['--button-text', '--button-bg', 4.5],
  ['--button-text', '--button-bg-hover', 4.5],
  ['--button-disabled-text', '--button-disabled-bg', 4.5],
  ['--selected-text', '--selected-bg', 4.5],
  ['--text', '--surface-hover', 4.5],
  ['--nav-answered-text', '--nav-answered-bg', 4.5],
  ['--nav-answered-bg', '--bg', 3],
  ['--nav-answered-bg', '--surface', 3],
  ['--nav-unanswered-border', '--bg', 3],
  ['--nav-unanswered-border', '--surface', 3],
  ['--nav-current-ring', '--bg', 3],
  ['--nav-current-ring', '--surface', 3],
  ['--nav-flag', '--bg', 3],
  ['--nav-flag', '--surface', 3],
  ['--nav-flag-on-answered', '--nav-answered-bg', 3],
  ['--nav-flag-on-answered', '--bg', 3],
  ['--nav-flag-on-answered', '--surface', 3],
  ['--nav-focus-ring', '--nav-focus-gap', 3],
  ['--nav-focus-gap', '--nav-answered-bg', 3],
  ['--nav-focus-ring', '--surface', 3],
  ...[1, 2, 3, 4, 5, 6].flatMap((n) => [
    [`--section-${n}`, '--bg', 3],
    [`--section-${n}`, '--surface', 3],
  ]),
  // Rubric names are written in their rubric's colour (S11): strip labels and editor badges on --bg,
  // the card's rubric badge and the editor's rubric list on --surface.
  ...[1, 2, 3, 4, 5, 6].flatMap((n) => [
    [`--section-${n}`, '--bg', 4.5],
    [`--section-${n}`, '--surface', 4.5],
  ]),
  ['--text-muted', '--surface-hover', 4.5],
  ['--on-success-bg', '--success-bg', 4.5],
  ['--on-danger-bg', '--danger-bg', 4.5],
  ['--on-warning-bg', '--warning-bg', 4.5],
  ['--input-border', '--input-bg', 3],
  ['--input-border', '--bg', 3],
  ['--input-border', '--surface-alt', 3],
  ['--focus-ring', '--bg', 3],
  ['--focus-ring', '--surface-alt', 3],
  ['--selected-bg', '--button-bg', 3],
);

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

/** Returns the declarations of the first rule whose selector matches `selectorRe`. */
function readBlock(css, selectorRe) {
  const m = selectorRe.exec(css);
  if (!m) throw new Error(`selector not found: ${selectorRe}`);
  const open = css.indexOf('{', m.index);
  const close = css.indexOf('}', open);
  const vars = {};
  for (const decl of css.slice(open + 1, close).split(';')) {
    const d = /^\s*(--[\w-]+)\s*:\s*([\s\S]+?)\s*$/.exec(decl);
    if (d) vars[d[1]] = d[2];
  }
  return vars;
}

function resolve(name, vars, seen = new Set()) {
  if (seen.has(name)) throw new Error(`var() cycle at ${name}`);
  seen.add(name);
  const value = vars[name];
  if (value === undefined) throw new Error(`undefined token ${name}`);
  const ref = /^var\(\s*(--[\w-]+)\s*\)$/.exec(value);
  return ref ? resolve(ref[1], vars, seen) : value;
}

function parseColor(value) {
  const v = value.trim().toLowerCase();
  let m = /^#([0-9a-f]{3})$/.exec(v);
  if (m) return m[1].split('').map((c) => parseInt(c + c, 16));
  m = /^#([0-9a-f]{6})$/.exec(v);
  if (m) return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(v);
  if (m) {
    const alpha = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    // A translucent colour depends on what is behind it; refuse instead of scoring it as opaque.
    if (alpha < 1) throw new Error(`translucent colour "${value}" cannot be checked; use an opaque token`);
    return [m[1], m[2], m[3]].map(Number);
  }
  if (v === 'white') return [255, 255, 255];
  if (v === 'black') return [0, 0, 0];
  throw new Error(`cannot parse colour "${value}"`);
}

function luminance([r, g, b]) {
  const lin = (c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrast(a, b) {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

const css = stripComments(fs.readFileSync(CSS_PATH, 'utf-8'));
const light = readBlock(css, /:root\s*\{/);
const dark = { ...light, ...readBlock(css, /:root\[data-theme=(['"]?)dark\1\]\s*\{/) };

let failures = 0;
for (const [themeName, vars] of [
  ['light', light],
  ['dark', dark],
]) {
  for (const [fg, bg, min] of PAIRS) {
    const ratio = contrast(parseColor(resolve(fg, vars)), parseColor(resolve(bg, vars)));
    const ok = ratio >= min;
    if (!ok) failures += 1;
    if (!ok || process.argv.includes('--verbose')) {
      console.log(`${ok ? 'ok  ' : 'FAIL'} ${themeName.padEnd(5)} ${fg} on ${bg}: ${ratio.toFixed(2)} (min ${min})`);
    }
  }
}

// Raw colours in TSX
const NAMED = [
  'aliceblue', 'aqua', 'aquamarine', 'azure', 'beige', 'black', 'blue', 'brown', 'coral', 'crimson', 'cyan',
  'darkblue', 'darkgray', 'darkgreen', 'darkgrey', 'darkred', 'dimgray', 'dimgrey', 'gold', 'gray', 'green',
  'grey', 'indigo', 'ivory', 'lightblue', 'lightgray', 'lightgreen', 'lightgrey', 'lime', 'magenta', 'maroon',
  'navy', 'olive', 'orange', 'orangered', 'pink', 'purple', 'red', 'salmon', 'silver', 'teal', 'tomato',
  'violet', 'white', 'whitesmoke', 'yellow',
];
// A style key that takes a colour (color, backgroundColor, borderTopColor, boxShadow, fill, …).
const COLOR_KEY = /\b([a-z]*color|background\w*|border\w*|outline\w*|\w*shadow|fill|stroke)\s*:/i;
const NAMED_RE = new RegExp(`\\b(?:${NAMED.join('|')})\\b`, 'i');
const LITERAL_RE = /#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i;
const QUOTED = /(['"`])((?:\\.|(?!\1).)*)\1/g;
// SVG/HTML colour attributes with a literal value (currentColor and none are fine).
const RAW_ATTR = new RegExp(
  `\\b(?:fill|stroke|color|stopColor|stop-color)=["'{]\\s*['"]?(?:#[0-9a-f]{3,8}\\b|rgba?\\(|hsla?\\(|(?:${NAMED.join('|')})\\b)`,
  'i',
);

/** True when a quoted string after a colour key holds a literal colour (also in ternaries and gradients). */
function hasRawStyleColour(text) {
  const key = COLOR_KEY.exec(text);
  if (!key) return false;
  for (const [, , body] of text.slice(key.index).matchAll(QUOTED)) {
    if (LITERAL_RE.test(body) || NAMED_RE.test(body)) return true;
  }
  return false;
}

function* walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (entry.name.endsWith('.tsx')) yield full;
  }
}

for (const file of walk(path.join(ROOT, 'src'))) {
  const lines = fs.readFileSync(file, 'utf-8').split('\n');
  lines.forEach((line, i) => {
      if (line.includes('theme-exempt:')) return;
      // A key whose value starts on the next line ("color:\n  ok ? … : …") is checked with that line.
      const text = /:\s*$/.test(line) ? `${line} ${lines[i + 1] ?? ''}` : line;
      if (hasRawStyleColour(text) || RAW_ATTR.test(line)) {
        failures += 1;
        console.log(`FAIL raw colour ${path.relative(ROOT, file)}:${i + 1}: ${line.trim()}`);
      }
    });
}

if (failures > 0) {
  console.error(`check-contrast: ${failures} problem(s)`);
  process.exit(1);
}
console.log(`check-contrast: ${PAIRS.length * 2} pairs pass in light and dark; no raw colours in TSX`);
