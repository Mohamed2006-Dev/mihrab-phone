import esbuild from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const shimsPath = path.resolve(rootDir, 'src/platform/browser-shims.js');

const nodeShimsPlugin = {
  name: 'node-shims',
  setup(build) {
    build.onResolve({ filter: /^(node:)?(fs|path|crypto|os|fs\/promises)$/ }, (args) => ({
      path: args.path.replace(/^node:/, ''),
      namespace: 'node-shim',
    }));
    build.onLoad({ filter: /.*/, namespace: 'node-shim' }, (args) => {
      const modKey = args.path === 'fs/promises' ? 'fsPromises' : args.path;
      return {
        contents: `const shims = require(${JSON.stringify(shimsPath)}); module.exports = shims[${JSON.stringify(modKey)}];`,
        resolveDir: rootDir,
      };
    });
  },
};

await esbuild.build({
  entryPoints: [path.resolve(rootDir, 'src/platform/browser-entry.js')],
  outfile: path.resolve(rootDir, 'web/mobile-bundle.js'),
  bundle: true,
  format: 'iife',
  globalName: 'MihrabBundle',
  platform: 'browser',
  target: ['esnext'],
  define: {
    __dirname: '"/app/src/engines"',
    __filename: '"/app/src/engines/index.js"',
    'process.pid': '1',
    'process.platform': '"android"',
  },
  plugins: [nodeShimsPlugin],
  minify: false,
});

console.log('✅ [build-bundle] mobile-bundle.js built successfully');
