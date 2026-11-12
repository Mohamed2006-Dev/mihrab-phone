/**
 * عقد واجهة برمجة تطبيقات محراب (Mihrab API Contract).
 *
 * يحدد هذا الملف العقد الموحد الذي تتوقعه واجهة المستخدم (Renderer) عبر كائن `window.mihrabApi`،
 * في تطبيق Android عبر Capacitor وWebView.
 *
 * يشمل العقد:
 * 1. تهيئة التطبيق (Bootstrap).
 * 2. القوالب والمظهر (Themes).
 * 3. مواقيت الصلاة والموقع (Prayer Times & Geolocation).
 * 4. الأحاديث النبوية والشروح والمكتبة (Hadith & Sharh).
 * 5. أوراد القرآن الكريم (Quran Wird & Progress).
 * 6. الدروس وقنوات اليوتيوب وخلاصات RSS (YouTube Feeds).
 * 7. الإعدادات والقدرات وإمكانية الوصول (Settings, Capabilities & Accessibility).
 * 8. شاشة التهيؤ للصلاة (Preparation Screen).
 * 9. معلومات المشروع والاتصال (Project Info & Bank Support).
 * 10. اشتراكات الأحداث الحية (Live Event Subscriptions).
 */

const API_METHODS = Object.freeze([
  // تهيئة الواجهة
  'getBootstrapData',

  // السمات والقوالب
  'getThemeState',
  'setTheme',
  'onThemeLiveReloaded',

  // مواقيت الصلاة والموقع
  'detectLocation',
  'setAutomaticLocation',
  'verifyOfficialTimings',
  'getPrayerTimes',
  'getCountryCities',

  // الأحاديث الشريفة
  'getNextHadith',
  'syncHadeethEncHadiths',
  'getHadithLibrary',
  'selectStoredHadith',
  'openHadithSource',
  'copyHadith',
  'exportHadithImage',
  'getHadithDetails',
  'previewHadithImage',
  'copyHadithImage',

  // القرآن الكريم والأوراد
  'getQuranStatus',
  'advanceQuranProgress',
  'saveQuranBookmark',
  'setQuranPosition',
  'rollRandomQuranReading',
  'toggleQuranNotification',

  // الدروس وقنوات يوتيوب
  'getYoutubeState',
  'refreshYoutubeFeeds',
  'addYoutubeChannel',
  'removeYoutubeChannel',
  'openExternalUrl',
  'getYoutubePage',
  'getChannelAvatar',

  // الإعدادات والموارد والأداء
  'saveSettings',
  'setPerformanceLevel',
  'getResourceStats',
  'clearResourceCache',
  'deleteResourceData',

  // تقارير الأخطاء ومعلومات المشروع
  'openBugReport',
  'getProjectInfo',
  'getBankSupport',
  'copyBankField',
  'openProjectContact',

  // شاشة التهيؤ للصلاة

  // واجهات غير مفعلة في التطبيق
  'toggleMiniPrayer',
  'getMiniPrayer',
  'hideMiniPrayer',
  'resizeMiniPrayer',
  'openMiniMain',
  'saveMiniRegion',

  // واجهات تحديث غير مفعلة
  'getUpdateStatus',
  'checkForUpdate',
  'downloadUpdate',
  'installUpdate',

  // أحداث الإشعارات والنوافذ المنبثقة
  'notificationPopupAction',
  'reportNotificationAudioStatus',
  'closeNotificationPopup',
]);

const API_EVENTS = Object.freeze([
  'onThemeLiveReloaded',
  'onPrayerScheduleChanged',
  'onPrayerReached',
  'onConfigUpdated',
  'onNavigateTo',
  'onNotification',
  'onNotificationError',
  'onUpdateStatus',
  'onRegionUpdated',
  'onMiniPrayer',
]);

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    API_METHODS,
    API_EVENTS,
  };
}
