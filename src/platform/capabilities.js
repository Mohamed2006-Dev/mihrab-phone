/**
 * إمكانات وقدرات المنصة (Platform Capabilities).
 *
 * تحدد هذه الوحدة الميزات المتاحة والميزات المحجوبة على الهاتف الذكي مقارنة بسطح المكتب،
 * لتمكين الواجهة المشتركة من إخفاء أو تكييف عناصر التحكم تلقائياً دون إظهار أزرار وهمية.
 */

function detectPlatform() {
  if (typeof window !== 'undefined' && window.Capacitor) {
    return window.Capacitor.getPlatform() || 'mobile';
  }
  if (typeof process !== 'undefined' && process.versions && process.versions.electron) {
    return 'desktop';
  }
  if (typeof navigator !== 'undefined') {
    const ua = navigator.userAgent || '';
    if (/android/i.test(ua)) return 'android';
    if (/iphone|ipad|ipod/i.test(ua)) return 'ios';
  }
  return 'web';
}

const PLATFORM = detectPlatform();
const IS_MOBILE = PLATFORM === 'android' || PLATFORM === 'ios' || PLATFORM === 'mobile' || PLATFORM === 'web';

const CAPABILITIES = Object.freeze({
  platform: PLATFORM,
  isMobile: IS_MOBILE,

  // ميزات سطح المكتب المحجوبة على الهاتف
  miniPrayerWindow: false,
  desktopPowerLock: false,
  systemAudioOverride: false,
  desktopAutoUpdater: false,
  keyboardShortcutsTray: false,

  // ميزات الهاتف المتاحة
  inAppPrayerPreparation: false,
  mobileShare: true,
  hapticFeedback: true,
  localNotifications: true,
  touchGestures: true,
  safeAreaInsets: true,
  bottomNavigationDock: true,
});

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    CAPABILITIES,
    detectPlatform,
  };
}
if (typeof window !== 'undefined') {
  window.MihrabCapabilities = CAPABILITIES;
}
