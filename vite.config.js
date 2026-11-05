import { defineConfig } from 'vite';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createHash } from 'node:crypto';

function listFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...listFiles(p));
    else out.push(p);
  }
  return out;
}

const buildTime = new Date().toISOString();

/** Generates dist/sw.js with a precache list and a unique version per build. */
function serviceWorkerPlugin() {
  return {
    name: 'generate-service-worker',
    apply: 'build',
    generateBundle(_opts, bundle) {
      const publicDir = join(process.cwd(), 'public');
      const publicFiles = listFiles(publicDir).map((f) => relative(publicDir, f).split('\\').join('/'));
      const files = [...Object.keys(bundle), ...publicFiles].filter((f) => !f.endsWith('.map') && f !== 'sw.js' && !f.startsWith('.'));
      const assets = [...new Set(['./', './index.html', ...files.map((f) => `./${f}`)])];
      const hash = createHash('sha256');
      for (const f of Object.keys(bundle).sort()) {
        const item = bundle[f];
        hash.update(f);
        hash.update(item.type === 'chunk' ? item.code : item.source);
      }
      for (const f of publicFiles.sort()) hash.update(readFileSync(join(publicDir, f)));
      const version = `${hash.digest('hex').slice(0, 12)}`;
      const src = readFileSync(join(process.cwd(), 'sw/sw.js'), 'utf8')
        .replace('__VERSION__', version)
        .replace('__ASSETS__', JSON.stringify(assets, null, 0));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: src });
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ version, buildTime }) });
    },
  };
}

export default defineConfig({
  base: './',
  define: {
    __BUILD_TIME__: JSON.stringify(buildTime),
  },
  plugins: [serviceWorkerPlugin()],
  build: { target: 'es2020', chunkSizeWarningLimit: 1000 },
  test: {
    include: ['tests/unit/**/*.test.js'],
  },
});
