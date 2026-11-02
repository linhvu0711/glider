import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

// Vitest runs from the repo root; happy-dom's URL cannot build a file: address.
function read(path: string): string {
  return readFileSync(join(process.cwd(), path), 'utf8');
}

const DARK_QUERY = '@media (prefers-color-scheme: dark)';

// The body of the first `{ ... }` block that starts at `from`, braces counted.
function blockAt(css: string, from: number): { body: string; end: number } {
  const open = css.indexOf('{', from);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    if (css[i] === '}' && --depth === 0) return { body: css.slice(open + 1, i), end: i + 1 };
  }
  throw new Error(`no closing brace after ${from}`);
}

function colors(body: string): Record<string, string> {
  const found: Record<string, string> = {};
  for (const [, name = '', value = ''] of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    found[name] = value.trim();
  }
  return found;
}

const base = read('components/base.css');

function lightBlock(): string {
  return blockAt(base, base.indexOf(':root')).body;
}

const LIGHT = {
  '--bg': '#f7f8fa',
  '--card': '#fff',
  '--surface': '#fff',
  '--control': '#fff',
  '--fill': '#f3f4f6',
  '--fill-hover': '#f9fafb',
  '--border': '#e5e7eb',
  '--border-control': '#e5e7eb',
  '--text': '#111827',
  '--text-2': '#4b5563',
  '--text-3': '#6b7280',
  '--accent': '#2563eb',
  '--accent-hover': '#1d4ed8',
  '--accent-text': '#2563eb',
  '--accent-text-hover': '#1d4ed8',
  '--accent-soft': '#eff6ff',
  '--red': '#dc2626',
  '--red-hover': '#dc2626',
  '--red-text': '#dc2626',
  '--green': '#16a34a',
  '--green-text': '#16a34a',
  '--done-text': '#16a34a',
  '--done-bg': '#f0fdf4',
  '--on-fill': '#fff',
  '--backdrop': 'rgb(17 24 39 / 40%)',
};

describe('light', () => {
  test("keeps today's light colors", () => {
    // Given: the first :root block of components/base.css
    // When
    const light = colors(lightBlock());
    // Then
    expect(Object.fromEntries(Object.keys(LIGHT).map((name) => [name, light[name]]))).toEqual(
      LIGHT,
    );
  });

  test('page styles use only named colors', () => {
    // Given: every style sheet the two pages load, with the blocks that define the names cut out
    let rules = base;
    for (const start of [base.indexOf(DARK_QUERY), base.indexOf(':root')].filter((i) => i >= 0)) {
      const { end } = blockAt(base, start);
      rules = rules.replace(base.slice(start, end), '');
    }
    const sheets = [
      rules,
      read('entrypoints/popup/style.css'),
      read('entrypoints/options/style.css'),
    ];
    // When
    const literals = sheets.flatMap((css) => css.match(/#[0-9a-fA-F]{3,8}\b|rgba?\(/g) ?? []);
    // Then
    expect(literals).toEqual([]);
  });
});

const DARK = {
  '--bg': '#131417',
  '--card': '#1a1b1f',
  '--surface': '#1e1f24',
  '--control': '#232429',
  '--fill': '#26272c',
  '--fill-hover': '#2c2e34',
  '--border': '#2a2c31',
  '--border-control': '#3b3e45',
  '--text': '#ececef',
  '--text-2': '#a4a7af',
  '--text-3': '#8d9098',
  '--accent': '#2563eb',
  '--accent-hover': '#3b82f6',
  '--accent-text': '#60a5fa',
  '--accent-text-hover': '#93c5fd',
  '--accent-soft': 'rgba(59,130,246,.14)',
  '--red': '#dc2626',
  '--red-hover': '#ef4444',
  '--red-text': '#f87171',
  '--green': '#16a34a',
  '--green-text': '#4ade80',
  '--done-text': '#86efac',
  '--done-bg': 'rgba(34,197,94,.13)',
  '--on-fill': '#fff',
  '--backdrop': 'rgba(0,0,0,.55)',
};

function darkColors(): Record<string, string> {
  const query = base.indexOf(DARK_QUERY);
  if (query < 0) return {};
  const media = blockAt(base, query).body;
  return colors(blockAt(media, media.indexOf(':root')).body);
}

type Rgb = [number, number, number];

function rgb(value: string): { color: Rgb; alpha: number } {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value)?.[1];
  if (hex) {
    const full = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex;
    const color = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as Rgb;
    return { color, alpha: 1 };
  }
  const parts = /^rgba\(([^)]+)\)$/.exec(value)?.[1]?.split(',').map(Number);
  if (!parts || parts.length !== 4) throw new Error(`not a color: ${value}`);
  return { color: parts.slice(0, 3) as Rgb, alpha: parts[3]! };
}

// A see-through color painted over another, rounded to whole channels as the screen paints it.
function over(value: string, under: Rgb): Rgb {
  const { color, alpha } = rgb(value);
  return color.map((c, i) => Math.round(c * alpha + under[i]! * (1 - alpha))) as Rgb;
}

// WCAG 2 relative luminance and contrast ratio.
function luminance(color: Rgb): number {
  const [r, g, b] = color.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: Rgb, b: Rgb): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

describe('dark', () => {
  test('gives each color its dark value in Dark mode', () => {
    // Given: the :root block inside the Dark mode query of components/base.css
    const dark = darkColors();
    // When: every name the light block holds is looked up
    const found = Object.fromEntries(Object.keys(LIGHT).map((name) => [name, dark[name]]));
    // Then
    expect(found).toEqual(DARK);
  });

  test('asks for dark built-in controls', () => {
    // Given: components/base.css
    // When
    const light = lightBlock();
    // Then
    expect(light).toContain('color-scheme: light dark;');
  });

  test('asks for the look before the style sheet loads', () => {
    // Given: both page shells
    const pages = ['entrypoints/options/index.html', 'entrypoints/popup/index.html'];
    // When
    const heads = pages.map((page) => read(page).split('</head>')[0]);
    // Then
    for (const head of heads) {
      expect(head).toContain('<meta name="color-scheme" content="light dark" />');
    }
  });

  test('small text meets 4.5:1 on each dark surface', () => {
    // Given: the dark colors, and each surface text sits on
    const dark = darkColors();
    const color = (name: string) => {
      const value = dark[name];
      if (!value) throw new Error(`no dark ${name}`);
      return value;
    };
    const card = over(color('--card'), [0, 0, 0]);
    const surfaces: Record<string, Rgb> = {
      '--bg': over(color('--bg'), [0, 0, 0]),
      '--card': card,
      '--surface': over(color('--surface'), [0, 0, 0]),
      '--control': over(color('--control'), [0, 0, 0]),
      '--fill': over(color('--fill'), [0, 0, 0]),
      '--accent-soft over --card': over(color('--accent-soft'), card),
    };
    const texts = [
      '--text',
      '--text-2',
      '--text-3',
      '--accent-text',
      '--red-text',
      '--green-text',
      '--done-text',
    ];
    // When
    const ratios = texts.flatMap((text) =>
      Object.entries(surfaces).map(([surface, under]) => ({
        pair: `${text} on ${surface}`,
        ratio: contrast(over(color(text), [0, 0, 0]), under),
      })),
    );
    ratios.push({
      pair: '--done-text on --done-bg over --card',
      ratio: contrast(over(color('--done-text'), [0, 0, 0]), over(color('--done-bg'), card)),
    });
    const lowest = ratios.reduce((low, next) => (next.ratio < low.ratio ? next : low));
    // Then
    expect({ pair: lowest.pair, ratio: Number(lowest.ratio.toFixed(2)) }).toEqual({
      pair: '--text-3 on --accent-soft over --card',
      ratio: 4.56,
    });
  });
});
