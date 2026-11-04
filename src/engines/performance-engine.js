const os = typeof require !== 'undefined' ? (function () { try { return require('os'); } catch { return null; } })() : null;

const PROFILES = {
  full: {
    id: 'full',
    title: 'كامل',
    batchSize: 8,
    images: true,
    paged: false,
    animations: true,
    requestAttempts: 3,
  },
  balanced: {
    id: 'balanced',
    title: 'متوازن',
    batchSize: 6,
    images: true,
    paged: true,
    animations: false,
    requestAttempts: 2,
  },
  eco: {
    id: 'eco',
    title: 'اقتصادي',
    batchSize: 6,
    images: false,
    paged: true,
    animations: false,
    requestAttempts: 1,
  },
};

function detectHardware(source = os) {
  if (source && typeof source.cpus === 'function' && typeof source.totalmem === 'function') {
    const cpus = source.cpus() || [],
      speeds = cpus.map((c) => c.speed).filter((n) => n > 0);
    return {
      memoryGB: Math.round((source.totalmem() / 1073741824) * 10) / 10,
      logicalCores: cpus.length || 1,
      cpuMHz: speeds.length ? Math.round(speeds.reduce((a, b) => a + b, 0) / speeds.length) : 0,
      processor: cpus[0]?.model || 'غير معروف',
    };
  }

  // Mobile / Browser environment
  const logicalCores =
    typeof navigator !== 'undefined' && navigator.hardwareConcurrency >= 8
      ? navigator.hardwareConcurrency
      : 8;
  const memoryGB =
    typeof navigator !== 'undefined' && navigator.deviceMemory >= 12
      ? navigator.deviceMemory
      : 12;
  return {
    memoryGB,
    logicalCores,
    cpuMHz: 2800,
    processor: 'الهاتف الذكي',
  };
}

function recommend(hw) {
  if (
    hw.memoryGB <= 4.5 ||
    hw.logicalCores <= 2 ||
    (hw.logicalCores <= 4 && hw.cpuMHz > 0 && hw.cpuMHz < 1700)
  )
    return 'eco';
  if (hw.memoryGB <= 8.5 || hw.logicalCores <= 4 || (hw.cpuMHz > 0 && hw.cpuMHz < 2200))
    return 'balanced';
  return 'full';
}

function resolve(config = {}, hw = detectHardware()) {
  const selection = ['auto', 'full', 'balanced', 'eco'].includes(config.performance?.level)
      ? config.performance.level
      : 'auto',
    recommended = recommend(hw);
  return {
    selection,
    recommended,
    hardware: hw,
    profile: PROFILES[selection === 'auto' ? recommended : selection],
  };
}

module.exports = { PROFILES, detectHardware, recommend, resolve };
