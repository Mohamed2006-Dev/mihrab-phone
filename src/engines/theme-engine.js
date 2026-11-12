const fs = typeof require !== 'undefined' ? require('fs') : null;
const path = typeof require !== 'undefined' ? require('path') : null;

/** Load bundled theme definitions independently of application behavior. */
class ThemeEngine {
  constructor(baseDir, storage = null) {
    this.baseDir = baseDir || '';
    this.storage = storage;
    this.themesDir = path && this.baseDir ? path.join(this.baseDir, 'themes') : 'themes';
    this.activeConfigPath =
      path && this.baseDir ? path.join(this.themesDir, 'active-theme.json') : null;
    this.bundledThemes = new Map();
    this._loadBundledThemes();
  }

  _loadBundledThemes() {
    if (typeof window !== 'undefined' && window.__MIHRAB_THEMES__) {
      for (const [id, data] of Object.entries(window.__MIHRAB_THEMES__)) {
        if (data && typeof data === 'object') {
          this.bundledThemes.set(id, data);
        }
      }
    }
    const knownThemes = ['emerald-sanctuary', 'royal-sapphire', 'andalusian-sand',
      'copper-courtyard', 'dusk-atelier', 'classic-monochrome', 'amber-gold'];
    for (const id of knownThemes) {
      if (this.bundledThemes.has(id)) continue;
      try {
        if (fs && this.themesDir) {
          const fullPath = path ? path.join(this.themesDir, `${id}.json`) : `themes/${id}.json`;
          if (fs.existsSync(fullPath)) {
            const raw = fs.readFileSync(fullPath, 'utf8');
            if (raw) {
              const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
              this.bundledThemes.set(id, data);
            }
          }
        }
      } catch (_) {}
    }
  }

  getActiveThemeState() {
    try {
      let themeId = 'emerald-sanctuary';
      let mode = 'dark';

      if (this.storage && typeof this.storage.readJsonSafe === 'function') {
        const saved = this.storage.readJsonSafe('active-theme', {
          activeTheme: 'emerald-sanctuary',
          activeMode: 'dark',
        });
        themeId = saved.activeTheme || themeId;
        mode = saved.activeMode || mode;
      } else if (fs && this.activeConfigPath && fs.existsSync(this.activeConfigPath)) {
        const config = JSON.parse(fs.readFileSync(this.activeConfigPath, 'utf8'));
        themeId = config.activeTheme || themeId;
        mode = config.activeMode || mode;
      }

      const themeData = this.loadThemeById(themeId);
      const discoveredThemes = this.discoverAllThemes();

      return {
        activeTheme: themeData?.id || themeId,
        activeMode: mode,
        availableThemes: discoveredThemes,
        themeData,
        cssVariables: this.compileCssVariables(themeData, mode),
      };
    } catch (err) {
      console.error('[ThemeEngine] Failed to load active theme state:', err.message);
      return null;
    }
  }

  discoverAllThemes() {
    this._loadBundledThemes();
    if (this.bundledThemes.size > 0) {
      return [...this.bundledThemes.entries()].map(([id, content]) => ({
        id: content.id || id,
        name: content.name || id,
        family: content.family === 'classic' ? 'classic' : 'modern',
        author: content.author || 'Mihrab Theme',
        fileName: `${id}.json`,
      }));
    }

    try {
      if (fs && this.themesDir && fs.existsSync(this.themesDir)) {
        const files = fs
          .readdirSync(this.themesDir)
          .filter((file) => file.endsWith('.json') && file !== 'active-theme.json');
        return files.map((file) => {
          const fullPath = path.join(this.themesDir, file);
          const content = JSON.parse(fs.readFileSync(fullPath, 'utf8'));
          return {
            id: content.id || path.basename(file, '.json'),
            name: content.name || path.basename(file, '.json'),
            family: content.family === 'classic' ? 'classic' : 'modern',
            author: content.author || 'User Custom',
            fileName: file,
          };
        });
      }
    } catch (err) {
      console.error('[ThemeEngine] Error discovering themes:', err.message);
    }
    return [];
  }

  loadThemeById(themeId) {
    this._loadBundledThemes();
    if (this.bundledThemes.has(themeId)) {
      return this.bundledThemes.get(themeId);
    }
    if (fs && this.themesDir) {
      const targetPath = path ? path.join(this.themesDir, `${themeId}.json`) : `themes/${themeId}.json`;
      if (fs.existsSync(targetPath)) {
        const content = JSON.parse(fs.readFileSync(targetPath, 'utf8'));
        this.bundledThemes.set(themeId, content);
        return content;
      }
      const fallbackPath = path
        ? path.join(this.themesDir, 'emerald-sanctuary.json')
        : 'themes/emerald-sanctuary.json';
      if (fs.existsSync(fallbackPath)) {
        return JSON.parse(fs.readFileSync(fallbackPath, 'utf8'));
      }
    }
    return this.bundledThemes.get('emerald-sanctuary') || null;
  }

  compileCssVariables(themeData, mode = 'dark') {
    if (!themeData) return {};
    const selectedModeVars =
      (themeData.modes && (themeData.modes[mode] || themeData.modes.dark)) || {};
    return {
      ...(themeData.typography || {}),
      ...(themeData.layout || {}),
      ...selectedModeVars,
    };
  }

  setTheme(themeId, mode) {
    try {
      let current = { activeTheme: 'emerald-sanctuary', activeMode: 'dark' };
      if (this.storage && typeof this.storage.readJsonSafe === 'function') {
        current = this.storage.readJsonSafe('active-theme', current);
        if (themeId) current.activeTheme = themeId;
        if (mode) current.activeMode = mode;
        this.storage.writeJsonSafe('active-theme', current);
      } else if (fs && this.activeConfigPath) {
        if (fs.existsSync(this.activeConfigPath)) {
          current = JSON.parse(fs.readFileSync(this.activeConfigPath, 'utf8'));
        }
        if (themeId) current.activeTheme = themeId;
        if (mode) current.activeMode = mode;
        fs.writeFileSync(this.activeConfigPath, JSON.stringify(current, null, 2), 'utf8');
      }
      return this.getActiveThemeState();
    } catch (err) {
      console.error('[ThemeEngine] Error saving active theme:', err.message);
      return this.getActiveThemeState();
    }
  }
}

module.exports = ThemeEngine;
