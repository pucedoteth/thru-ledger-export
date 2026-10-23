import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';

const SRC = new URL('../src/', import.meta.url);
const WEB = new URL('../web/', import.meta.url);

describe('web app', () => {
  it('only loads library modules that run in a browser', () => {
    // The page imports lib/index.js, compiled from src/. Only the CLI may use Node.
    for (const file of readdirSync(SRC).filter((name) => name.endsWith('.ts') && name !== 'cli.ts')) {
      expect(readFileSync(new URL(file, SRC), 'utf8'), file).not.toMatch(/from ['"]node:/);
    }
  });

  it('imports names the library actually exports', async () => {
    const app = readFileSync(new URL('app.js', WEB), 'utf8');
    const names = /import \{([^}]+)\} from '\.\/lib\/index\.js'/.exec(app)?.[1]?.split(',').map((name) => name.trim()) ?? [];
    expect(names.length).toBeGreaterThan(0);
    const lib = await import('../src/index.js');
    for (const name of names) expect(lib, name).toHaveProperty(name);
  });

  it('references the files the Pages workflow publishes', () => {
    const html = readFileSync(new URL('index.html', WEB), 'utf8');
    expect(html).toContain('href="style.css"');
    expect(html).toContain('src="app.js"');
    const workflow = readFileSync(new URL('../.github/workflows/pages.yml', import.meta.url), 'utf8');
    expect(workflow).toContain('cp web/index.html web/style.css web/app.js _site/');
  });
});
