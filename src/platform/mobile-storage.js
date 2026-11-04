/**
 * مخزن بيانات الهاتف (Mobile Storage Engine).
 *
 * يوفر طبقة تخزين هجينة تعمل بكفاءة في بيئة المتصفح / Capacitor WebView وكذلك في Node.js للاختبارات:
 * - يحتفظ بذاكرة كاش متزامنة (In-Memory Cache) للوصول الفوري السريع المتوافق مع واجهات المحركات القديمة.
 * - يدعم الاستمرارية عبر Capacitor Preferences أو LocalStorage أو نظام الملفات (في Node.js).
 * - يعالج الإعدادات، تقدم الأوراد، الكاش المؤقت لليوتيوب، والحديث النبوي.
 */

let NotificationSettings;
try {
  NotificationSettings = require('../engines/notification-settings');
} catch {
  if (typeof window !== 'undefined' && window.MihrabNotificationSettings) {
    NotificationSettings = window.MihrabNotificationSettings;
  }
}

class MobileStorage {
  constructor(options = {}) {
    this.storagePrefix = options.prefix || 'mihrab_mobile_';
    this.memoryStore = new Map();
    this.baseDir = options.baseDir || '';
    this.dataDir = options.dataDir || '';
    this.memoryOnly = options.memoryOnly || false;
    this.driver = options.driver || this._detectDriver();
    this.isNode = typeof process !== 'undefined' && process.versions && process.versions.node && !process.versions.electron;

    // تهيئة المخزن الافتراضي
    this._initStorage();
  }

  _detectDriver() {
    if (typeof window !== 'undefined' && window.Capacitor && window.Capacitor.isPluginAvailable && window.Capacitor.isPluginAvailable('Preferences')) {
      return 'capacitor';
    }
    if (typeof localStorage !== 'undefined') {
      return 'localstorage';
    }
    return 'memory';
  }

  _initStorage() {
    if (typeof localStorage !== 'undefined') {
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && key.startsWith(this.storagePrefix)) {
            const cleanKey = key.slice(this.storagePrefix.length);
            const val = localStorage.getItem(key);
            try {
              this.memoryStore.set(cleanKey, JSON.parse(val));
            } catch {
              this.memoryStore.set(cleanKey, val);
            }
          }
        }
      } catch (e) {
        console.warn('[MobileStorage] Error loading from localStorage:', e);
      }
    }
  }

  getDefaultConfig() {
    return {
      location: {
        autoDetect: true,
        city: 'مكة المكرمة',
        country: 'المملكة العربية السعودية',
        lat: 21.4225,
        lng: 39.8262,
        calculationMethod: 'UmmAlQura',
      },
      prayerAdjustments: {
        fajr: 0,
        sunrise: 0,
        dhuhr: 0,
        asr: 0,
        maghrib: 0,
        isha: 0,
      },
      officialSync: {
        enabled: true,
        autoApplyDiscrepancy: true,
        lastSyncTime: null,
        lastDiscrepancyReport: null,
      },
      notifications: {
        prePrayerMinutes: 15,
        fridayPrePrayerMinutes: 60,
        dailyVideoAfterIshaMinutes: 45,
        playAdhanAudio: true,
      },
      quranWird: {
        riwaya: 'hafs',
        notificationMode: 'both',
        reading: {
          mode: 'sequential',
          unit: 'juz',
          amount: 1,
          currentPosition: {
            juzNumber: 1,
            surahNumber: 1,
            hizbNumber: 1,
            rubNumber: 1,
            pageNumber: 1,
          },
          randomDailyWird: null,
          afterIshaMinutes: 30,
          customTimeEnabled: false,
          customTime: '20:30',
        },
        hifz: {
          unit: 'juz',
          amount: 1,
          rangeStart: 29,
          rangeEnd: 30,
          currentPosition: {
            juzNumber: 29,
            surahNumber: 78,
            hizbNumber: 58,
            rubNumber: 231,
            pageNumber: 582,
          },
          afterFajrMinutes: 30,
          customTimeEnabled: false,
          customTime: '05:45',
        },
      },
      youtube: {
        channels: [
          {
            channelId: 'UC6vT9L5A1pD0vA-ZfOaQG6w',
            channelTitle: 'قناة الدروس الإسلامية المختارة',
            sourceType: 'channel_id',
          },
        ],
        preferredContextIds: ['ctx_01', 'ctx_02', 'ctx_03', 'ctx_04', 'ctx_05', 'ctx_10'],
      },
      performance: {
        level: 'auto',
      },
      network: {
        enabled: true,
        showChart: true,
        categories: {
          youtube: true,
          hadith: true,
          prayer: true,
          location: true,
          other: true,
        },
      },
    };
  }

  readJsonSafe(filePathOrKey, fallback = {}) {
    const key = this._normalizeKey(filePathOrKey);
    if (this.memoryStore.has(key)) {
      return this.memoryStore.get(key);
    }
    // Fallback to localStorage if in browser
    if (typeof localStorage !== 'undefined') {
      try {
        const item = localStorage.getItem(this.storagePrefix + key);
        if (item !== null) {
          const parsed = JSON.parse(item);
          this.memoryStore.set(key, parsed);
          return parsed;
        }
      } catch (_) {}
    }
    // If in Node, check absolute file path or relative to dataDir / baseDir
    if (this.isNode && !this.memoryOnly) {
      try {
        const fs = require('fs');
        const path = require('path');
        let targetPath = null;
        if (path.isAbsolute(filePathOrKey) && fs.existsSync(filePathOrKey)) {
          targetPath = filePathOrKey;
        } else if (this.dataDir) {
          const candidate = path.join(this.dataDir, filePathOrKey.endsWith('.json') ? filePathOrKey : `${filePathOrKey}.json`);
          if (fs.existsSync(candidate)) targetPath = candidate;
        } else if (this.baseDir) {
          const candidate = path.join(this.baseDir, 'data', filePathOrKey.endsWith('.json') ? filePathOrKey : `${filePathOrKey}.json`);
          if (fs.existsSync(candidate)) targetPath = candidate;
        }
        if (targetPath && fs.existsSync(targetPath)) {
          const content = JSON.parse(fs.readFileSync(targetPath, 'utf8'));
          this.memoryStore.set(key, content);
          return content;
        }
      } catch (_) {}
    }
    return fallback;
  }

  writeJsonSafe(filePathOrKey, data) {
    const key = this._normalizeKey(filePathOrKey);
    this.memoryStore.set(key, data);

    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(this.storagePrefix + key, JSON.stringify(data));
      } catch (err) {
        console.warn(`[MobileStorage] localStorage write error:`, err);
      }
    }

    if (this.isNode && !this.memoryOnly && this.dataDir) {
      try {
        const fs = require('fs');
        const path = require('path');
        const targetPath = path.isAbsolute(filePathOrKey)
          ? filePathOrKey
          : path.join(this.dataDir, filePathOrKey.endsWith('.json') ? filePathOrKey : `${filePathOrKey}.json`);
        const dir = path.dirname(targetPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(targetPath, JSON.stringify(data, null, 2), 'utf8');
      } catch (err) {
        // Ignored in purely test/memory modes
      }
    }

    // Async sync with Capacitor Preferences if available
    this._persistCapacitor(key, data);
    return true;
  }

  async _persistCapacitor(key, data) {
    if (typeof window !== 'undefined' && window.Capacitor && window.MihrabNative?.Preferences) {
      try {
        await window.MihrabNative.Preferences.set({
          key: this.storagePrefix + key,
          value: JSON.stringify(data),
        });
      } catch (_) {}
    }
  }

  _normalizeKey(filePathOrKey) {
    if (!filePathOrKey) return 'data';
    const str = String(filePathOrKey).replace(/\\/g, '/');
    const parts = str.split('/');
    return parts[parts.length - 1].replace(/\.json$/i, '');
  }

  getConfig() {
    const defaults = this.getDefaultConfig();
    const saved = this.readJsonSafe('user-config', {});
    const merged = this.deepMerge(defaults, saved);
    if (NotificationSettings?.normalizeConfig) {
      const normalized=NotificationSettings.normalizeConfig(merged);delete normalized.screenLock;delete normalized.accessibility;return normalized;
    }
    return merged;
  }

  saveConfig(partialOrFullConfig) {
    const current = this.getConfig();
    const updated = this.deepMerge(current, partialOrFullConfig);
    if (updated.screenLock) {
      delete updated.screenLock.lockDurationMinutes;
    }
    if (NotificationSettings?.validateConfig) {
      NotificationSettings.validateConfig(updated);
    }
    delete updated.screenLock;delete updated.accessibility;
    this.writeJsonSafe('user-config', updated);
    return updated;
  }

  deepMerge(target, source) {
    if (typeof target !== 'object' || target === null) return source;
    if (typeof source !== 'object' || source === null) return target;
    const output = Array.isArray(target) ? [...target] : { ...target };
    for (const key of Object.keys(source)) {
      if (Array.isArray(source[key])) {
        output[key] = [...source[key]];
      } else if (typeof source[key] === 'object' && source[key] !== null && key in target) {
        output[key] = this.deepMerge(target[key], source[key]);
      } else {
        output[key] = source[key];
      }
    }
    return output;
  }

  clear() {
    this.memoryStore.clear();
    if (typeof localStorage !== 'undefined') {
      try {
        const keysToRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && key.startsWith(this.storagePrefix)) {
            keysToRemove.push(key);
          }
        }
        keysToRemove.forEach((k) => localStorage.removeItem(k));
      } catch (_) {}
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = MobileStorage;
}
if (typeof window !== 'undefined') {
  window.MobileStorage = MobileStorage;
}
