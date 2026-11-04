import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const webDir = path.join(rootDir, 'web');
const publicInfoPath = path.join(rootDir,'data/personal-data.json');
if(!fs.existsSync(publicInfoPath))fs.copyFileSync(path.join(rootDir,'data/personal-data.example.json'),publicInfoPath);

console.log('[prepare-web-assets] Preparing Capacitor web output at:', webDir);

// 1. تنظيف أو إنشاء مجلد web
if (fs.existsSync(webDir)) {
  fs.rmSync(webDir, { recursive: true, force: true });
}
fs.mkdirSync(webDir, { recursive: true });

function copyRecursive(src, dest) {
  if (!fs.existsSync(src)) return;
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const item of fs.readdirSync(src)) {
      copyRecursive(path.join(src, item), path.join(dest, item));
    }
  } else {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
}

// 2. نسخ ملفات الواجهة الأساسية
copyRecursive(path.join(rootDir, 'src', 'ui'), webDir);

// 3. نسخ ملفات طبقة المنصة
copyRecursive(path.join(rootDir, 'src', 'platform'), path.join(webDir, 'platform'));

// 4. نسخ ملفات المحركات
copyRecursive(path.join(rootDir, 'src', 'engines'), path.join(webDir, 'engines'));

// 5. نسخ البيانات المرجعية المسموحة صراحة
const allowedDataFiles = [
  'cities.json',
  'local-hadith-sharh.json',
  'personal-data.json',
  'quran-meta-hafs.json',
  'quran-meta-warsh.json',
  'quran-metadata.json',
  'quran-partitions-LICENSE.txt',
  'quran-sources.md',
  'seed-hadiths.json',
  'youtube-contexts.json',
];

const webDataDir = path.join(webDir, 'data');
fs.mkdirSync(webDataDir, { recursive: true });

for (const file of allowedDataFiles) {
  const src = path.join(rootDir, 'data', file);
  const dest = path.join(webDataDir, file);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
  }
}

// نسخ مجلد geography
copyRecursive(path.join(rootDir, 'data', 'geography'), path.join(webDataDir, 'geography'));

// 6. نسخ القوالب المسموحة صراحة
const allowedThemes = ['emerald-sanctuary.json', 'royal-sapphire.json', 'andalusian-sand.json'];
const webThemesDir = path.join(webDir, 'themes');
fs.mkdirSync(webThemesDir, { recursive: true });

for (const theme of allowedThemes) {
  const src = path.join(rootDir, 'themes', theme);
  const dest = path.join(webThemesDir, theme);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
  }
}

// 7. التأكد التام من استبعاد أي ملفات شخصية أو كاش
const excludedFiles = [
  'personal-data(do_not_read_this_throw_network).json',
  'bank-acc-qr.jpg',
  'active-theme.json',
  'user-config.json',
  'hadith-cache.json',
  'youtube-cache.json',
  'network-usage.json',
  'city-prayer-cache.json',
];

for (const ex of excludedFiles) {
  const p1 = path.join(webDataDir, ex);
  const p2 = path.join(webThemesDir, ex);
  if (fs.existsSync(p1)) fs.rmSync(p1, { force: true });
  if (fs.existsSync(p2)) fs.rmSync(p2, { force: true });
}

// 8. بناء حزمة الجسر البرمجي للواجهة (Bundle mobile platform bridge)
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
  outfile: path.resolve(webDir, 'mobile-bundle.js'),
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

console.log('✅ [prepare-web-assets] Mobile web assets and mobile-bundle.js prepared successfully in:', webDir);
