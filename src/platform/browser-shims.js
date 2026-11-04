/**
 * بدائل بيئة المتصفح الخفيفة (Browser Shims for Mobile WebView).
 *
 * يوفر دعماً للواجهات الأساسية (path, crypto, os, fs, fs/promises) لتعمل المحركات
 * بسلاسة داخل WebView باستخدام خدمات المتصفح.
 */

if (typeof window !== 'undefined') {
  window.__MIHRAB_DEFER_AUTO_INIT__ = true;
}

// 1. بديل path
export const path = {
  sep: '/',
  join(...args) {
    const raw = args
      .filter((part) => part !== undefined && part !== null && part !== '')
      .map((part) => String(part))
      .join('/')
      .replace(/\\/g, '/')
      .replace(/\/+/g, '/');
    const isAbs = raw.startsWith('/');
    const segments = [];
    for (const seg of raw.split('/')) {
      if (!seg || seg === '.') continue;
      if (seg === '..') {
        segments.pop();
      } else {
        segments.push(seg);
      }
    }
    const joined = segments.join('/');
    return isAbs ? '/' + joined : joined || '.';
  },
  resolve(...args) {
    return this.join(...args) || '.';
  },
  basename(p, ext = '') {
    const clean = String(p || '').replace(/\\/g, '/').replace(/\/+$/, '');
    const base = clean.split('/').pop() || '';
    if (ext && base.endsWith(ext)) {
      return base.slice(0, -ext.length);
    }
    return base;
  },
  dirname(p) {
    const clean = String(p || '').replace(/\\/g, '/').replace(/\/+$/, '');
    const parts = clean.split('/');
    parts.pop();
    return parts.join('/') || '.';
  },
  extname(p) {
    const base = this.basename(p);
    const idx = base.lastIndexOf('.');
    return idx > 0 ? base.slice(idx) : '';
  },
  isAbsolute(p) {
    return /^(\/|[a-zA-Z]:)/.test(String(p || ''));
  },
};

// 2. بديل crypto (تشفير SHA-256 متوافق مع UTF-8 والنصوص العربية 100%)
function sha256Sync(input) {
  function rightRotate(value, amount) {
    return (value >>> amount) | (value << (32 - amount));
  }
  // تحويل النص (بما فيه العربية) إلى تمثيل بايتات UTF-8
  let ascii = unescape(encodeURIComponent(String(input ?? '')));

  const mathPow = Math.pow;
  const maxWord = mathPow(2, 32);
  const lengthProperty = 'length';
  let i, j, i2;
  let result = '';

  const words = [];
  const asciiBitLength = ascii[lengthProperty] * 8;
  let hash = [];
  const k = [];
  let primeCounter = 0;

  const isComposite = {};
  for (let candidate = 2; primeCounter < 64; candidate++) {
    if (!isComposite[candidate]) {
      for (i = 0; i < 313; i += candidate) {
        isComposite[i] = candidate;
      }
      hash[primeCounter] = (mathPow(candidate, 0.5) * maxWord) | 0;
      k[primeCounter++] = (mathPow(candidate, 1 / 3) * maxWord) | 0;
    }
  }

  ascii += '\x80';
  while ((ascii[lengthProperty] % 64) - 56) ascii += '\x00';
  for (i = 0; i < ascii[lengthProperty]; i++) {
    j = ascii.charCodeAt(i) & 0xff;
    words[i >> 2] |= j << (((3 - i) % 4) * 8);
  }
  words[words[lengthProperty]] = (asciiBitLength / maxWord) | 0;
  words[words[lengthProperty]] = asciiBitLength;

  for (j = 0; j < words[lengthProperty]; ) {
    const w = words.slice(j, (j += 16));
    const oldHash = hash;
    hash = hash.slice(0, 8);

    for (i = 0; i < 64; i++) {
      const w15 = w[i - 15],
        w2 = w[i - 2];
      const s0 = rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3);
      const s1 = rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10);
      w[i] = i < 16 ? w[i] : (w[i - 16] + s0 + w[i - 7] + s1) | 0;

      const s1h = rightRotate(hash[4], 6) ^ rightRotate(hash[4], 11) ^ rightRotate(hash[4], 25);
      const ch = (hash[4] & hash[5]) ^ (~hash[4] & hash[6]);
      const temp1 = (hash[7] + s1h + ch + k[i] + w[i]) | 0;
      const s0h = rightRotate(hash[0], 2) ^ rightRotate(hash[0], 13) ^ rightRotate(hash[0], 22);
      const maj = (hash[0] & hash[1]) ^ (hash[0] & hash[2]) ^ (hash[1] & hash[2]);
      const temp2 = (s0h + maj) | 0;

      hash = [(temp1 + temp2) | 0].concat(hash);
      hash[4] = (hash[4] + temp1) | 0;
      hash.length = 8;
    }

    for (i = 0; i < 8; i++) {
      hash[i] = (hash[i] + oldHash[i]) | 0;
    }
  }

  for (i = 0; i < 8; i++) {
    for (i2 = 3; i2 >= 0; i2--) {
      const b = (hash[i] >> (i2 * 8)) & 255;
      result += (b < 16 ? '0' : '') + b.toString(16);
    }
  }
  return result;
}

export const crypto = {
  createHash() {
    let buffer = '';
    return {
      update(str) {
        buffer += String(str ?? '');
        return this;
      },
      digest() {
        return sha256Sync(buffer) || '';
      },
    };
  },
  randomUUID() {
    if (typeof globalThis !== 'undefined' && globalThis.crypto?.randomUUID) {
      return globalThis.crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  },
};

// 3. بديل os
export const os = {
  cpus(){const count=typeof navigator!=='undefined'?Number(navigator.hardwareConcurrency)||0:0;return Array.from({length:count},()=>({model:'غير متاح من المتصفح',speed:0}));},
  totalmem(){return (typeof navigator!=='undefined'?Number(navigator.deviceMemory)||0:0)*1073741824;},
  platform() {
    return 'android';
  },
};

// 4. مخزن الملفات الافتراضي في الذاكرة
export const memoryFiles = new Map();

function normalizeKey(p) {
  return String(p || '')
    .replace(/\\/g, '/')
    .replace(/^(\.\/|\/)+/, '')
    .replace(/\/+/g, '/');
}

export function registerMemoryFile(relPath, data) {
  const serialized = typeof data === 'string' ? data : JSON.stringify(data);
  const norm = normalizeKey(relPath);
  memoryFiles.set(norm, serialized);
  const base = norm.split('/').pop();
  if (base && !memoryFiles.has(base)) {
    memoryFiles.set(base, serialized);
  }
}

function findMemoryFile(p) {
  const norm = normalizeKey(p);
  if (memoryFiles.has(norm)) return memoryFiles.get(norm);
  for (const [key, val] of memoryFiles.entries()) {
    if (norm.endsWith('/' + key) || key.endsWith('/' + norm)) {
      return val;
    }
  }
  const base = norm.split('/').pop();
  if (base && memoryFiles.has(base)) return memoryFiles.get(base);
  return undefined;
}

export const fsPromises = {
  async mkdir() {},
  async writeFile(p, data) {
    registerMemoryFile(p, data);
  },
  async readFile(p) {
    const content = findMemoryFile(p);
    if (content !== undefined) return content;
    throw Object.assign(new Error(`ENOENT: no such file or directory, open '${p}'`), {
      code: 'ENOENT',
    });
  },
  async rename(oldPath, newPath) {
    const val = findMemoryFile(oldPath);
    if (val !== undefined) {
      registerMemoryFile(newPath, val);
      memoryFiles.delete(normalizeKey(oldPath));
    }
  },
  async unlink(p) {
    memoryFiles.delete(normalizeKey(p));
  },
  async rm(p) {
    memoryFiles.delete(normalizeKey(p));
  },
  async readdir(dir, options = {}) {
    const prefix = normalizeKey(dir);
    const results = [];
    for (const key of memoryFiles.keys()) {
      if (prefix && key.startsWith(prefix + '/')) {
        const rest = key.slice(prefix.length + 1);
        if (!rest.includes('/')) {
          results.push(
            options.withFileTypes
              ? { name: rest, isDirectory: () => false, isSymbolicLink: () => false }
              : rest,
          );
        }
      }
    }
    return results;
  },
  async stat(p) {
    const val = findMemoryFile(p);
    return { size: val ? val.length : 0, mtimeMs: Date.now() };
  },
};

export const fs = {
  promises: fsPromises,
  existsSync(p) {
    const norm = normalizeKey(p);
    if (norm === 'themes' || norm.endsWith('/themes') || norm === 'data' || norm.endsWith('/data')) {
      return true;
    }
    return findMemoryFile(p) !== undefined;
  },
  readFileSync(p) {
    const content = findMemoryFile(p);
    if (content !== undefined) {
      return typeof content === 'string' ? content : JSON.stringify(content);
    }
    return '';
  },
  writeFileSync(p, data) {
    registerMemoryFile(p, data);
  },
  readdirSync(dir) {
    const prefix = normalizeKey(dir);
    const files = new Set();
    for (const key of memoryFiles.keys()) {
      if (prefix && (key.startsWith(prefix + '/') || key.endsWith('/' + prefix))) {
        const name = key.split('/').pop();
        if (name) files.add(name);
      } else if ((prefix === 'themes' || prefix.endsWith('/themes')) && key.startsWith('themes/')) {
        files.add(key.slice('themes/'.length));
      }
    }
    return [...files];
  },
  statSync(p) {
    const val = findMemoryFile(p);
    return { size: val ? val.length : 1024, mtimeMs: Date.now() };
  },
  mkdirSync() {},
  rmSync(p) {
    memoryFiles.delete(normalizeKey(p));
  },
  unlinkSync(p) {
    memoryFiles.delete(normalizeKey(p));
  },
};

export default { path, crypto, os, fs, fsPromises, memoryFiles, registerMemoryFile };
