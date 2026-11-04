/**
 * محمل موارد وبيانات الهاتف المرفقة (Mobile Assets Loader).
 *
 * يقوم بتحميل ملفات البيانات المرجعية المرفقة بالتطبيق (المدن، الأحاديث، تفاسير الشرح،
 * حدود القرآن الكريم، القوالب، ومعلومات المشروع العامة) دون الاعتماد على Node fs عند التشغيل داخل WebView.
 */

const path = typeof require !== 'undefined' ? require('path') : null;
const fs = typeof require !== 'undefined' ? require('fs') : null;

class MobileAssets {
  constructor(options = {}) {
    this.baseDir = options.baseDir || (typeof __dirname !== 'undefined' ? path.resolve(__dirname, '..', '..') : '.');
    this.cache = new Map();
  }

  async loadJson(relativePath) {
    const cleanPath = relativePath.replace(/\\/g, '/');
    if (this.cache.has(cleanPath)) {
      return this.cache.get(cleanPath);
    }

    // 1. In Node.js environment
    if (fs && this.baseDir) {
      try {
        const fullPath = path.resolve(this.baseDir, cleanPath);
        if (fs.existsSync(fullPath)) {
          const content = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
          this.cache.set(cleanPath, content);
          return content;
        }
      } catch (err) {
        console.warn(`[MobileAssets] Node load error for ${cleanPath}:`, err.message);
      }
    }

    // 2. In Browser / Capacitor WebView environment
    if (typeof fetch === 'function') {
      try {
        const url = (cleanPath.startsWith('/') ? '' : '/') + cleanPath;
        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json();
          this.cache.set(cleanPath, data);
          return data;
        }
      } catch (err) {
        console.warn(`[MobileAssets] Fetch error for ${cleanPath}:`, err.message);
      }
    }

    // 3. Fallback to pre-bundled cache if available
    if (typeof window !== 'undefined' && window.__MIHRAB_BUNDLED_ASSETS__?.[cleanPath]) {
      return window.__MIHRAB_BUNDLED_ASSETS__[cleanPath];
    }

    return null;
  }

  loadJsonSync(relativePath) {
    const cleanPath = relativePath.replace(/\\/g, '/');
    if (this.cache.has(cleanPath)) {
      return this.cache.get(cleanPath);
    }
    if (fs && this.baseDir) {
      try {
        const fullPath = path.resolve(this.baseDir, cleanPath);
        if (fs.existsSync(fullPath)) {
          const content = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
          this.cache.set(cleanPath, content);
          return content;
        }
      } catch (_) {}
    }
    if (typeof window !== 'undefined' && window.__MIHRAB_BUNDLED_ASSETS__?.[cleanPath]) {
      return window.__MIHRAB_BUNDLED_ASSETS__[cleanPath];
    }
    return null;
  }

  async getCities() {
    return (await this.loadJson('data/cities.json')) || [];
  }

  async getSeedHadiths() {
    return (await this.loadJson('data/seed-hadiths.json')) || [];
  }

  async getHadithSharh() {
    return (await this.loadJson('data/local-hadith-sharh.json')) || {};
  }

  async getQuranMetadata() {
    return (await this.loadJson('data/quran-metadata.json')) || {};
  }

  async getQuranMeta(riwaya = 'hafs') {
    const file = riwaya === 'warsh' ? 'data/quran-meta-warsh.json' : 'data/quran-meta-hafs.json';
    return (await this.loadJson(file)) || [];
  }

  async getYoutubeContexts() {
    return (await this.loadJson('data/youtube-contexts.json')) || { contexts: [], defaultChannels: [] };
  }

  async getPublicProjectInfo() {
    return (await this.loadJson('data/project-public-info.json')) || {};
  }

  async getTheme(themeId) {
    return await this.loadJson(`themes/${themeId}.json`);
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = MobileAssets;
}
if (typeof window !== 'undefined') {
  window.MobileAssets = MobileAssets;
}
