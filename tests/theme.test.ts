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
