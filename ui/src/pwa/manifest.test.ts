import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = resolve(__dirname, '..', '..', 'public');
const INDEX_HTML = resolve(__dirname, '..', '..', 'index.html');

interface ManifestIcon {
  src: string;
  sizes: string;
  type: string;
  purpose?: string;
}

interface Manifest {
  name: string;
  short_name: string;
  start_url: string;
  scope: string;
  display: string;
  theme_color: string;
  background_color: string;
  icons: ManifestIcon[];
  [k: string]: unknown;
}

function loadManifest(): Manifest {
  const path = resolve(PUBLIC_DIR, 'manifest.webmanifest');
  if (!existsSync(path)) {
    throw new Error(`manifest not found at ${path}`);
  }
  return JSON.parse(readFileSync(path, 'utf-8')) as Manifest;
}

function loadIndexHtml(): string {
  return readFileSync(INDEX_HTML, 'utf-8');
}

describe('pwa manifest', () => {
  let manifest: Manifest;

  beforeAll(() => {
    manifest = loadManifest();
  });

  it('parses as valid JSON with required fields', () => {
    expect(manifest.name).toBe('wavecode');
    expect(manifest.short_name).toBe('wavecode');
    expect(manifest.start_url).toBe('/');
    expect(manifest.display).toBe('standalone');
    expect(manifest.theme_color).toBe('#0c0d0e');
    expect(manifest.background_color).toBe('#0c0d0e');
  });

  it('declares 192 and 512 icons', () => {
    const sizes = manifest.icons.map((i) => i.sizes).sort();
    expect(sizes).toEqual(['192x192', '512x512', '512x512']);
    const types = new Set(manifest.icons.map((i) => i.type));
    expect(types).toEqual(new Set(['image/png']));
  });

  it('icon files exist on disk', () => {
    for (const icon of manifest.icons) {
      const rel = icon.src.replace(/^\//, '');
      const path = resolve(PUBLIC_DIR, rel);
      expect(existsSync(path), `icon file missing: ${path}`).toBe(true);
    }
  });

  it('192 and 512 PNGs have the declared dimensions', () => {
    for (const [expected, file] of [
      [192, 'icon-192.png'],
      [512, 'icon-512.png'],
      [180, 'apple-touch-icon-180.png'],
    ] as const) {
      const buf = readFileSync(resolve(PUBLIC_DIR, file));
      // PNG IHDR: signature(8) + length(4) + 'IHDR'(4) + width(4) + height(4) ...
      const width = buf.readUInt32BE(16);
      const height = buf.readUInt32BE(20);
      expect(width).toBe(expected);
      expect(height).toBe(expected);
    }
  });
});

describe('pwa index.html wiring', () => {
  it('declares manifest link and apple-touch-icon', () => {
    const html = loadIndexHtml();
    expect(html).toMatch(/<link[^>]+rel="manifest"[^>]+href="\/manifest\.webmanifest"/);
    expect(html).toMatch(/<link[^>]+rel="apple-touch-icon"[^>]+href="\/apple-touch-icon-180\.png"/);
  });

  it('declares iOS PWA meta tags', () => {
    const html = loadIndexHtml();
    expect(html).toMatch(/name="apple-mobile-web-app-capable"\s+content="yes"/);
    expect(html).toMatch(/name="mobile-web-app-capable"\s+content="yes"/);
    expect(html).toMatch(/name="viewport"[^>]+viewport-fit=cover/);
    expect(html).toMatch(/name="theme-color"\s+content="#0c0d0e"/);
  });
});
