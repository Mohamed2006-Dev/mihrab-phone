const {MobileNetworkMeter}=require('./mobile-network-meter');
const {MobileLocation}=require('./mobile-location');
/**
 * واجهة محراب للهواتف الذكية (Mihrab Mobile API Bridge).
 *
 * تنفيذ متكامل لكائن `window.mihrabApi` في بيئة الهواتف الذكية (Capacitor / WebView).
 * يربط بين عناصر الواجهة (Renderer) والمحركات والخدمات المشتركة:
 * - التخزين المحلي السريع عبر MobileStorage.
 * - إدارة الإشعارات المحلية عبر MobileNotifications.
 * - مشغل الصوتيات عبر MobileAudio.
 * - ناقل الأحداث الموحد عبر MobileEvents.
 * - احترام ميزات وقدرات المنصة عبر Capabilities.
 */

const path = typeof require !== 'undefined' ? require('path') : null;

// استيراد الخدمات والمنصات
const MobileStorage = typeof require !== 'undefined' ? require('./mobile-storage') : window.MobileStorage;
const MobileEvents = typeof require !== 'undefined' ? require('./mobile-events') : window.MobileEvents;
const MobileAudio = typeof require !== 'undefined' ? require('./mobile-audio') : window.MobileAudio;
const MobileNotifications = typeof require !== 'undefined' ? require('./mobile-notifications') : window.MobileNotifications;
const { CAPABILITIES } = typeof require !== 'undefined' ? require('./capabilities') : window.MihrabCapabilities;
const { policy: networkPolicy, allowed: networkAllowed, categoryFor } = typeof require !== 'undefined' ? require('./mobile-network') : window.MihrabNetwork;

// استيراد المحركات المشتركة
const PrayerEngine = typeof require !== 'undefined' ? require('../engines/prayer-engine') : null;
const HadithEngine = typeof require !== 'undefined' ? require('../engines/hadith-engine') : null;
const { buildHadithImageHtml, renderHadithImage, renderHadithSvg } = typeof require !== 'undefined' ? require('../engines/hadith-image') : {};
const QuranWirdEngine = typeof require !== 'undefined' ? require('../engines/quran-wird-engine') : null;
const YouTubeRssEngine = typeof require !== 'undefined' ? require('../engines/youtube-rss-engine') : null;
const ThemeEngine = typeof require !== 'undefined' ? require('../engines/theme-engine') : null;
const PerformanceEngine = typeof require !== 'undefined' ? require('../engines/performance-engine') : null;
const NoticePolicy = typeof require !== 'undefined' ? require('../engines/notification-settings') : null;
const { ProjectInfoEngine } = typeof require !== 'undefined' ? require('../engines/project-info-engine') : {};
const { buildReport } = typeof require !== 'undefined' ? require('../engines/bug-report-engine') : {};

class MihrabMobileApi {
  constructor(options = {}) {
    this.baseDir =
      options.baseDir ||
      (path && typeof __dirname !== 'undefined' && typeof path.resolve === 'function'
        ? path.resolve(__dirname, '..', '..')
        : '');
    this.storage = options.storage || new MobileStorage({ baseDir: this.baseDir });
    this.events = options.events || new MobileEvents();
    this.audio = options.audio || new MobileAudio();
    this.notifications =
      options.notifications ||
      new MobileNotifications({
        storage: this.storage,
        audio: this.audio,
        events: this.events,
      });

    // تهيئة المحركات
    this.themeEngine = new ThemeEngine(this.baseDir, this.storage);
    this.prayerEngine = new PrayerEngine(this.storage);
    this.hadithEngine = new HadithEngine(this.storage, this.baseDir);
    this.quranEngine = new QuranWirdEngine(this.storage, this.baseDir);
    this.youtubeEngine = new YouTubeRssEngine(this.storage, this.baseDir);
    this.projectInfoEngine = new ProjectInfoEngine(
      this.baseDir,
      this.storage.dataDir || this.baseDir,
      true,
    );
    this.locationService=options.locationService||new MobileLocation();
    this.networkMeter = new MobileNetworkMeter(this.storage, async () => {
      const plugin = typeof window !== 'undefined' && window.MihrabNative?.DeviceInfo;
      return plugin?.getNetworkStats ? plugin.getNetworkStats() : {supported:false};
    });
    this.prayerAutomation = new (require('../engines/prayer-automation'))({
      storage:this.storage,prayerEngine:this.prayerEngine,
      online:()=>typeof navigator==='undefined'||navigator.onLine!==false,
      onUpdated:async()=>{
        const prayerData=this.prayerEngine.calculateLocalPrayerTimes(this.getAppNow());
        await this.rescheduleNotifications(prayerData);
        this.events.emit('app:automation-status',{message:'تم تحديث مواقيت اليوم وحفظها لمنطقتك.'});
        this.events.emit('app:prayer-schedule',prayerData);
      },
      onError:error=>this.events.emit('app:automation-status',{error:true,message:'تعذر التحقق التلقائي من المواقيت: '+error.message}),
    });
    if(typeof window!=='undefined')window.addEventListener('online',()=>this.prayerAutomation.tick(this.getAppNow(),{retry:true}));
    // جدولة تلقائية مبدئية
    this._initScheduler();
  }

  getAppNow() {
    return new Date();
  }

  currentPerformance() {
    const config = this.storage.getConfig();
    return PerformanceEngine.resolve(config,this.hardware);
  }

  trimFeedForPerformance(feed) {
    if (!feed) return feed;
    const profile = this.currentPerformance().profile;
    if (!profile.paged) return feed;
    return { ...feed, videos: [], filteredVideos: [], paged: true };
  }

  async _ensureCountryCitiesLoaded(countryCodeOrName) {
    if (typeof window === 'undefined' || typeof fetch !== 'function') return;
    try {
      const country = this.prayerEngine.geography.country(countryCodeOrName || '');
      const code = country?.code;
      if (!code) return;
      window.__MIHRAB_GEOGRAPHY_CITIES__ ||= {};
      if (Array.isArray(window.__MIHRAB_GEOGRAPHY_CITIES__[code])) return;
      const res = await fetch(`./data/geography/${encodeURIComponent(code)}.json`);
      if (res && res.ok) {
        const json = await res.json();
        if (Array.isArray(json)) {
          window.__MIHRAB_GEOGRAPHY_CITIES__[code] = json;
        }
      }
    } catch (_) {}
  }

  _initScheduler() {
    // التحقق الدوري كل دقيقة لمزامنة وقت الصلاة والأذان
    this.tickTimer = setInterval(() => {
      this._checkPrayerTick();
    }, 60000);
    if (this.tickTimer?.unref) {
      this.tickTimer.unref();
    }
  }

  _checkPrayerTick() {
    this.refreshDeviceLocation().catch(error=>console.warn(error.message));
    const now = this.getAppNow();
    this.prayerAutomation.tick(now);
    const prayerData = this.prayerEngine.calculateLocalPrayerTimes(now);
    if (!prayerData) return;

    if(this.lastNotificationDay!==prayerData.dateKey){this.lastNotificationDay=prayerData.dateKey;this.rescheduleNotifications(prayerData).catch(error=>this.events.emit('app:notification-error',{message:error.message}));}
    this.events.emit('app:prayer-schedule', prayerData);

    // Native notifications own sound, including when the WebView is suspended.
    this.reachedPrayers ||= new Set();
    for(const prayer of prayerData.prayers||[]){
      const at=Math.floor(new Date(prayer.time).getTime()/60000)*60000,key=prayer.id+'_'+at;
      if(prayer.id!=='sunrise'&&now.getTime()>=at&&now.getTime()<at+60000&&!this.reachedPrayers.has(key)){
        this.reachedPrayers.add(key);if(this.reachedPrayers.size>30)this.reachedPrayers=new Set([key]);
        this.events.emit('app:prayer-reached',{hadithState:this.hadithEngine.getHadithForPrayer(key,false),prayerData});
      }
    }
  }

  // ==========================================================================
  // 1. الواجهة والتهيئة الأولية (Bootstrap)
  // ==========================================================================
  async getBootstrapData() {
    await this.networkMeter.sample();
    if (!this.networkTimer && typeof document !== 'undefined') {
      this.networkTimer = setInterval(() => {
        if (!document.hidden) this.networkMeter.sample().catch(error=>console.warn('Network measurement failed',error));
      },15000);
      document.addEventListener('visibilitychange',()=>{
        if (!document.hidden) this.networkMeter.sample().catch(error=>console.warn('Network measurement failed',error));
      });
    }
    if(typeof window!=='undefined'&&window.MihrabNative?.DeviceInfo){try{this.hardware=await window.MihrabNative.DeviceInfo.getInfo();document.documentElement.style.setProperty('--safe-top',(this.hardware.safeTop||0)+'px');document.documentElement.style.setProperty('--safe-bottom',(this.hardware.safeBottom||0)+'px');}catch(error){console.warn('Device info unavailable',error);}}

    await this.syncSystemPermissions();
    const config = this.storage.getConfig();
    const now = this.getAppNow();
    await this._ensureCountryCitiesLoaded(config.location?.countryCode || config.location?.country || 'SA');
    const prayerData = this.prayerEngine.calculateLocalPrayerTimes(now);
    const currentPrayerKey = `${prayerData.nextPrayer?.id || 'fajr'}_${now.toISOString().slice(0, 10)}`;
    const hadithState = this.hadithEngine.getHadithForPrayer(currentPrayerKey, false);
    const quranState = this.quranEngine.getFullStatus(prayerData);
    const youtubeState = this.trimFeedForPerformance(this.youtubeEngine.getFeedState('all'));
    const countries = this.prayerEngine.getCountries();
    const currentLocation = this.prayerEngine.getLocation();
    await this._ensureCountryCitiesLoaded(currentLocation.countryCode);
    const cities = currentLocation.countryCode
      ? this.prayerEngine.getCities(currentLocation.countryCode)
      : [];
    const themeState = this.themeEngine.getActiveThemeState();

    // جدولة إشعارات الصلوات للأيام القادمة
    this.rescheduleNotifications(prayerData).catch((e) => {
      this.events.emit('app:notification-error',{message:e.message});
    });

    setTimeout(()=>this.prayerAutomation.tick(this.getAppNow()),0);
    return {
      config: { ...config, location: currentLocation },
      countries,
      themeState,
      performanceProfile: this.currentPerformance(),
      prayerData,
      hadithState,
      quranState,
      youtubeState,
      cities,
      effectiveNowIso: now.toISOString(),
      capabilities: CAPABILITIES,
    };
  }

  // ==========================================================================
  // 2. السمات والمظهر (Themes)
  // ==========================================================================
  async getThemeState() {
    return this.themeEngine.getActiveThemeState();
  }

  async setTheme(themeId, mode) {
    const newState = this.themeEngine.setTheme(themeId, mode);
    this.events.emit('theme:live-reloaded', newState);
    return newState;
  }

  onThemeLiveReloaded(callback) {
    return this.events.on('theme:live-reloaded', callback);
  }

  // ==========================================================================
  // 3. مواقيت الصلاة والموقع (Prayer Times & Location)
  // ==========================================================================
  rescheduleNotifications(prayerData){
    this.notificationQueue=(this.notificationQueue||Promise.resolve()).catch(()=>{}).then(async()=>{
      if(typeof window!=='undefined')await window.MihrabBoot?.whenReady;
      const data=this.prayerEngine.calculateLocalPrayerTimes(this.getAppNow());
      await this.publishPrayerWidget();
      const recommendation=this.youtubeEngine.getFeedState('all').dailyRecommendation;
      const config = this.storage.getConfig();
      const now = this.getAppNow();
      const zone = data.location?.effectiveTimeZone || data.location?.timeZone;
      const horizon = config.notifications?.customReminders?.length ? 9 : 4;
      const days = Array.from({ length: horizon }, (_, index) => {
            const date = require('../engines/prayer-times-engine').shiftDay(now, index - 1, zone);
            return { date, data: index === 1 ? data : this.prayerEngine.calculateLocalPrayerTimes(date) };
          });
      return this.notifications.schedulePrayerAlarms(data, config, null, recommendation, days, now);
    });
    return this.notificationQueue;
  }
  async setAutomaticLocation(enabled){
    if(this.automaticLocationBusy)throw Error('انتظر اكتمال طلب الموقع.');
    this.automaticLocationBusy=true;
    try{
      let patch={location:{autoUpdate:false}};
      if(enabled){
        const result=await this.locationService.detect({requestPermission:true});
        if(!result.success){
          const native=typeof window!=='undefined'?window.MihrabNative?.DeviceInfo:null;
          const system=native?.getPermissionStates?await native.getPermissionStates():null;
          const allowed=system?.location===true;
          const config=this.storage.saveConfig({location:{autoUpdate:allowed},locationPermissionAsked:true,locationPermissionDenied:!allowed});
          return {success:false,error:result.error,config};
        }
        const previous=this.storage.getConfig().location||{},geo=this.prayerEngine.geography,country=geo.country(result.countryCode);
        const location=geo.normalizeLocation({...previous,lat:result.lat,lng:result.lng,city:result.distanceKm<150?result.city:'موقعي الحالي',countryCode:result.countryCode,country:country?.name||result.countryCode,timeZone:result.timeZone,accuracy:result.accuracy,source:'device',autoDetect:true,autoUpdate:true,calculationMethod:previous.calculationMethodSelection==='manual'?previous.calculationMethod:geo.methodForCountry(result.countryCode)});
        patch={location,locationPermissionAsked:true,locationPermissionDenied:false};
        this.lastLocationAttempt=Date.now();
      }
      const config=this.storage.saveConfig(patch),prayerData=this.prayerEngine.calculateLocalPrayerTimes(this.getAppNow());
      this.events.emit('app:region-updated',config);
      this.events.emit('app:prayer-schedule',prayerData);
      this.rescheduleNotifications().catch(error=>this.events.emit('app:notification-error',{message:error.message}));
      this.prayerAutomation.tick(this.getAppNow()).catch(error=>this.events.emit('app:automation-status',{error:true,message:error.message}));
      return {success:true,config,prayerData,quranState:this.quranEngine.getFullStatus(prayerData)};
    }finally{this.automaticLocationBusy=false;}
  }

  async syncSystemPermissions(requestNotifications=false){
    if(typeof window==='undefined'||!window.MihrabNative?.Geolocation||this.permissionSyncBusy)return;
    this.permissionSyncBusy=true;
    try{
      const c=this.storage.getConfig(),native=window.MihrabNative.DeviceInfo;
      const system=native?.getPermissionStates?await native.getPermissionStates():null;
      const geo=system?null:await window.MihrabNative.Geolocation.checkPermissions();
      const location=system?system.location:geo.location==='granted'||geo.coarseLocation==='granted';
      let notices=system?system.notifications:await this.notifications.checkPermission();
      if(requestNotifications&&!c.notificationPermissionAsked){
        this.storage.saveConfig({notificationPermissionAsked:true});
        notices=await this.notifications.requestPermission();
      }
      let patch={systemPermissions:{location,notifications:notices}};
      if(!notices){
        if(!c.notificationPermissionSnapshot)patch.notificationPermissionSnapshot={notifications:c.notifications||{},mode:c.quranWird?.notificationMode||'both'};
        patch.notifications={...c.notifications,prayerEnabled:false,prePrayerEnabled:false,fridayPrePrayerEnabled:false,lessons:{...c.notifications?.lessons,enabled:false}};
        patch.quranWird={notificationMode:'none'};
        await this.notifications.cancelAll();
      }else if(c.notificationPermissionSnapshot){
        patch.notifications=c.notificationPermissionSnapshot.notifications;patch.quranWird={notificationMode:c.notificationPermissionSnapshot.mode};patch.notificationPermissionSnapshot=null;
      }
      if(!location){patch.location={autoUpdate:false};patch.locationPermissionDenied=true;}
      this.storage.saveConfig(patch);
      if(location&&(c.systemPermissions?.location!==true||c.locationPermissionDenied===true)){await this.setAutomaticLocation(true);}
      this.events.emit('app:config-updated',this.storage.getConfig());
      if(notices!==c.systemPermissions?.notifications)this.events.emit('app:permission-sync-completed');
      if(notices!==c.systemPermissions?.notifications)this.rescheduleNotifications().catch(error=>this.events.emit('app:notification-error',{message:error.message}));
    }finally{this.permissionSyncBusy=false;}
  }
  async refreshDeviceLocation(){
    const location=this.storage.getConfig().location;
    if(location?.autoUpdate!==true||this.locationRefreshing||Date.now()-(this.lastLocationAttempt||0)<1800000)return;
    this.lastLocationAttempt=Date.now();this.locationRefreshing=true;
    try{const result=await this.locationService.detect({requestPermission:false});if(!result.success){const native=window.MihrabNative?.DeviceInfo;const system=native?.getPermissionStates?await native.getPermissionStates():null;if(system?.location===false)this.storage.saveConfig({location:{autoUpdate:false},locationPermissionDenied:true});this.events.emit('app:config-updated',this.storage.getConfig());return;}
      const country=this.prayerEngine.geography.country(result.countryCode);
      const res=await this.saveSettings({location:{...location,source:'device',autoDetect:true,lat:result.lat,lng:result.lng,city:result.distanceKm<150?result.city:'موقعي الحالي',countryCode:result.countryCode,country:country?.name||result.countryCode,timeZone:result.timeZone,accuracy:result.accuracy,calculationMethod:location.calculationMethodSelection==='manual'?location.calculationMethod:this.prayerEngine.geography.methodForCountry(result.countryCode)}});
      this.events.emit('app:region-updated',res.config);return res;
    }finally{this.locationRefreshing=false;}
  }
  async getPrayerTimes() {
    return this.prayerEngine.calculateLocalPrayerTimes(this.getAppNow());
  }

  async getCountryCities(countryCode) {
    await this._ensureCountryCitiesLoaded(countryCode);
    return this.prayerEngine.getCities(countryCode);
  }

  async detectLocation() {
    const res=await this.locationService.detect();
    this.storage.saveConfig({locationPermissionAsked:true,locationPermissionDenied:!res.success,...(!res.success?{location:{autoUpdate:false}}:{})});
    if(!res.success)return res;
    const geography=this.prayerEngine.geography,country=geography.country(res.countryCode);
    const location=geography.normalizeLocation({...this.storage.getConfig().location,city:res.distanceKm<150?res.city:'موقعي الحالي',countryCode:res.countryCode,country:country?.name||res.countryCode,lat:res.lat,lng:res.lng,timeZone:res.timeZone,calculationMethod:geography.methodForCountry(res.countryCode),calculationMethodSelection:'auto',source:'device',accuracy:res.accuracy});
    return {...res,location,prayerData:this.prayerEngine.calculateLocalPrayerTimes(this.getAppNow()),config:this.storage.getConfig()};
  }

  async verifyOfficialTimings() {
    const report = await this.prayerEngine.verifyWithOfficialAwqafApi({
      throwOnError: false,
      date: this.getAppNow(),
    });
    const prayerData = this.prayerEngine.calculateLocalPrayerTimes(this.getAppNow());
    return { report, prayerData, config: this.storage.getConfig() };
  }

  // ==========================================================================
  // 4. الأحاديث النبوية والشروح والمكتبة (Hadith & Sharh)
  // ==========================================================================
  async getNextHadith() {
    return this.hadithEngine.getHadithForPrayer(`manual_${Date.now()}`, true);
  }

  async getHadithLibrary(options = {}) {
    return this.hadithEngine.getHadithLibrary(options);
  }

  async selectStoredHadith(key) {
    return this.hadithEngine.selectStoredHadith(key);
  }

  async getHadithDetails(key, force = false) {
    return this.hadithEngine.enrichStoredHadith(key, { force: force === true });
  }

  async syncHadeethEncHadiths(topic) {
    const syncResult = await this.hadithEngine.syncFromHadeethEncApi(topic);
    const hadithState = this.hadithEngine.buildState(this.hadithEngine.getDatabase());
    return { syncResult, hadithState };
  }

  async openHadithSource(key) {
    const url = this.hadithEngine.getHadithSourceUrl(key);
    return this.openExternalUrl(url);
  }

  async copyHadith(key) {
    const text = this.hadithEngine.formatHadithMarkdown(key, false);
    if (typeof navigator !== 'undefined') {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      }

    }
    return { copied: true };
  }

  async previewHadithImage(key) {
    return 'data:image/png;base64,'+await this.hadithPng(key);
  }

  async hadithPng(key){
    const native=window.MihrabNative?.DeviceInfo;if(!native?.renderHadithCard)throw Error('إنشاء الصورة يتطلب نسخة Android المحدثة.');
    const font=async weight=>{const response=await fetch('./assets/fonts/amiri-arabic-'+weight+'-normal.woff2');if(!response.ok)throw Error('تعذر قراءة خط بطاقة الحديث المحلي.');const bytes=new Uint8Array(await response.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i++)binary+=String.fromCharCode(bytes[i]);return btoa(binary);};
    const [regular,bold]=await Promise.all([font(400),font(700)]);
    const html=buildHadithImageHtml(this.hadithEngine.getExportHadith(key),'',regular,bold);
    const result=await native.renderHadithCard({html});return result.data;
  }
  async copyHadithImage(key){
    const data=await this.hadithPng(key),native=window.MihrabNative?.DeviceInfo;
    if(native?.copyImage)return native.copyImage({data});
    if(!navigator.clipboard?.write||typeof ClipboardItem==='undefined')throw Error('نسخ الصور غير متاح في هذه البيئة.');
    const blob=await(await fetch('data:image/png;base64,'+data)).blob();await navigator.clipboard.write([new ClipboardItem({'image/png':blob})]);return {copied:true};
  }
  async exportHadithImage(key){
    const data=await this.hadithPng(key),native=window.MihrabNative?.DeviceInfo;
    if(native?.saveImage)return native.saveImage({data});
    throw Error('حفظ الصورة يتطلب تطبيق Android.');
  }

  // ==========================================================================
  // 5. القرآن الكريم والأوراد (Quran Wird & Progress)
  // ==========================================================================
  async getQuranStatus() {
    const prayerData = this.prayerEngine.calculateLocalPrayerTimes(this.getAppNow());
    return this.quranEngine.getFullStatus(prayerData);
  }

  async advanceQuranProgress(type) {
    this.quranEngine.advanceWirdProgress(type);
    const prayerData = this.prayerEngine.calculateLocalPrayerTimes(this.getAppNow());
    return this.quranEngine.getFullStatus(prayerData);
  }

  async rollRandomQuranReading() {
    this.quranEngine.rollRandomReadingWird();
    const prayerData = this.prayerEngine.calculateLocalPrayerTimes(this.getAppNow());
    return this.quranEngine.getFullStatus(prayerData);
  }

  async toggleQuranNotification(kind) {
    if(this.notifications.plugin&&!(await this.notifications.checkPermission()))throw Error('اسمح بإشعارات التطبيق من إعدادات الإشعارات أولاً.');
    if (!['reading', 'hifz'].includes(kind)) throw Error('نوع ورد غير صالح.');
    const current = this.storage.getConfig().quranWird?.notificationMode || 'both';
    let reading = ['both', 'reading_only'].includes(current);
    let hifz = ['both', 'hifz_only'].includes(current);
    if (kind === 'reading') reading = !reading;
    else hifz = !hifz;
    const notificationMode = reading ? (hifz ? 'both' : 'reading_only') : hifz ? 'hifz_only' : 'none';
    const config = this.storage.saveConfig({ quranWird: { notificationMode } });
    const prayerData = this.prayerEngine.calculateLocalPrayerTimes(this.getAppNow());
    return { config, quranState: this.quranEngine.getFullStatus(prayerData) };
  }

  // ==========================================================================
  // 6. الدروس وقنوات يوتيوب (YouTube Feeds)
  // ==========================================================================
  async getYoutubeState() {
    return this.trimFeedForPerformance(this.youtubeEngine.getFeedState('all'));
  }

  async refreshYoutubeFeeds(contextId) {
    const feeds = await this.youtubeEngine.refreshFeeds(contextId || 'all');
    await this.rescheduleNotifications();
    return this.trimFeedForPerformance(feeds);
  }

  async addYoutubeChannel(payload) {
    const res = await this.youtubeEngine.addChannel(payload);
    const feeds = this.trimFeedForPerformance(this.youtubeEngine.getFeedState('all'));
    await this.rescheduleNotifications();
    return { ...res, feeds };
  }

  async removeYoutubeChannel(channelId) {
    const res = this.youtubeEngine.removeChannel(channelId);
    const feeds = this.trimFeedForPerformance(this.youtubeEngine.getFeedState('all'));
    await this.rescheduleNotifications();
    return { ...res, feeds };
  }

  async openExternalUrl(url) {
    let target;try{target=new URL(url);}catch{throw Error('رابط غير صالح.');}
    if(!['https:','http:','mailto:'].includes(target.protocol)||target.username||target.password)throw Error('نوع الرابط غير مسموح.');
    if(typeof window!=='undefined'){
      if(window.MihrabNative?.DeviceInfo?.openExternal)return window.MihrabNative.DeviceInfo.openExternal({url:target.href});
      const opened=window.open(target.href,'_blank','noopener');
      if(!opened)throw Error('تعذر فتح الرابط؛ تحقق من التطبيقات المتاحة.');
      return {opened:true};
    }
    return {opened:false};
  }

  async getLessonById(id) { return this.youtubeEngine.getLessonById(id); }
  async getAnotherLesson(excluded) { return this.youtubeEngine.getAnotherLesson(excluded); }
  async snoozeLesson(id) {
    const video = this.youtubeEngine.getLessonById(id);
    if (!video) throw new Error('هذا الدرس غير متاح.');
    if (this.storage.getConfig().notifications?.lessons?.enabled === false)
      throw new Error('تنبيهات الدروس متوقفة.');
    return this.notifications.snoozeLesson(video);
  }

  async getYoutubePage(options = {}) {
    const profile = this.currentPerformance().profile;
    const limit = profile.paged ? profile.batchSize : 8;
    const offset = Number.isFinite(Number(options.offset))
      ? Math.max(0, Math.floor(Number(options.offset) / limit) * limit)
      : 0;
    const channelIds = Array.isArray(options.channelIds) ? options.channelIds : [];
    const contextIds = Array.isArray(options.contextIds) ? options.contextIds : [];
    const recommendedVideoId = options.recommendedVideoId;

    const feed = this.youtubeEngine.getFeedState('all');
    const allVideos = Array.isArray(feed?.videos) ? feed.videos : [];
    const filtered = allVideos
      .filter(
        (v) =>
          (!channelIds.length || channelIds.includes(v.channelId)) &&
          (!contextIds.length || contextIds.includes(v.contextId)),
      )
      .sort(
        (a, b) =>
          new Date(b.pubDate || b.published || 0) - new Date(a.pubDate || a.published || 0) ||
          String(a.videoId || '').localeCompare(String(b.videoId || '')),
      );
    const queues = new Map();
    for (const video of filtered) {
      if (!queues.has(video.channelId)) queues.set(video.channelId, []);
      queues.get(video.channelId).push(video);
    }
    const videos = [];
    for (let i = 0; videos.length < filtered.length; i++) {
      for (const queue of queues.values()) if (queue[i]) videos.push(queue[i]);
    }
    const pinned = videos.findIndex((v) => v.videoId === recommendedVideoId);
    if (pinned > 0) videos.unshift(...videos.splice(pinned, 1));
    const start = Math.min(
      Math.max(0, offset),
      Math.max(0, Math.floor((videos.length - 1) / limit) * limit),
    );
    const page = videos.slice(start, start + limit).map(({ description, ...video }) => video);
    return {
      videos: page,
      items: page,
      total: videos.length,
      offset: start,
      limit,
      hasMore: start + limit < videos.length,
    };
  }

  async getChannelAvatar(id) {
    if(!networkAllowed(this.storage.getConfig(),'youtube'))return null;
    this.avatarRequests ||= new Map();
    if(!this.avatarRequests.has(id))this.avatarRequests.set(id,this.youtubeEngine.getChannelPage('https://www.youtube.com/channel/'+encodeURIComponent(id)).then(page=>page.avatarUrl).catch(error=>{this.avatarRequests.delete(id);console.warn('Channel avatar unavailable',id,error.message);return null;}));
    return this.avatarRequests.get(id);
  }

  // ==========================================================================
  // 7. الإعدادات، إمكانية الوصول والأداء (Settings & Accessibility)
  // ==========================================================================
  async saveCustomReminders(rows) {
    const reminders = require('../engines/custom-reminders');
    reminders.validate(rows);
    const saved = this.storage.saveConfig({ notifications: { customReminders: reminders.unique(rows) } });
    this.rescheduleNotifications().catch(error => this.events.emit('app:notification-error', { message: error.message }));
    return saved.notifications.customReminders;
  }

  async saveSettings(newConfig, fromSync = false) {
    const previous = this.storage.getConfig();
    if(newConfig.location?.autoUpdate===true && newConfig.location?.source!=='device'){
      const detected=await this.detectLocation();
      if(!detected.success)throw Error(detected.error);
      const manual=previous.location?.calculationMethodSelection==='manual';
      newConfig={...newConfig,location:{...detected.location,...newConfig.location,...(manual?{calculationMethod:previous.location.calculationMethod,calculationMethodSelection:'manual'}:{}),source:'device'}};
    }
    let patch = newConfig;

    if (newConfig.location) {
      await this._ensureCountryCitiesLoaded(
        newConfig.location.countryCode || newConfig.location.country || previous.location?.countryCode,
      );
      const location = this.prayerEngine.geography.normalizeLocation({
        ...previous.location,
        ...newConfig.location,
        source:newConfig.location.source||(newConfig.location.autoDetect===false?'manual':previous.location?.source),
        ...(newConfig.location.autoDetect===false?{autoUpdate:false}:{}),
      });
      if (!String(location.city || '').trim()) throw new Error('يرجى إدخال اسم المدينة.');
      patch = { ...newConfig, location };
    }

    if (newConfig.quranWird) {
      patch = {
        ...patch,
        quranWird: this.quranEngine.validateSettings(
          this.storage.deepMerge(previous.quranWird || {}, newConfig.quranWird),
        ),
      };
    }

    if (
      newConfig.performance &&
      !['auto', 'eco', 'balanced', 'full'].includes(newConfig.performance.level)
    ) {
      throw Error('مستوى الأداء غير صالح.');
    }

    if (patch.notifications?.customReminders !== undefined)
      require('../engines/custom-reminders').validate(patch.notifications.customReminders);
    const saved = this.storage.saveConfig(patch);
    if(newConfig.location||newConfig.automation||newConfig.network)setTimeout(()=>this.prayerAutomation.tick(this.getAppNow()),0);
    const prayerData = this.prayerEngine.calculateLocalPrayerTimes(this.getAppNow());
    const quranState = this.quranEngine.getFullStatus(prayerData);

    // إعادة جدولة الإشعارات وفق الإعدادات الجديدة
    this.rescheduleNotifications(prayerData).catch(error=>this.events.emit('app:notification-error',{message:error.message}));

    if (fromSync) {
      this.events.emit('app:sync-applied', {
        config: saved,
        prayerData: patch.location ? prayerData : undefined,
        quranState: patch.quranWird || patch.location ? quranState : undefined,
        youtubeState: patch.youtube ? this.youtubeEngine.getFeedState() : undefined,
      });
    } else {
      this.events.emit('app:config-updated', saved);
      this.events.emit('app:prayer-schedule', prayerData);
    }

    return {
      config: saved,
      prayerData,
      quranState,
      performanceProfile: newConfig.performance ? this.currentPerformance() : undefined,
    };
  }

  async setPerformanceLevel(level) {
    if (!['auto', 'full', 'balanced', 'eco'].includes(level)) throw Error('مستوى الأداء غير صالح.');
    this.storage.saveConfig({ performance: { level } });
    return this.currentPerformance();
  }

  async getResourceStats() {
    const usage=await this.networkMeter.sample();
    let measured;
    if(typeof window!=='undefined'&&window.MihrabNative?.DeviceInfo?.getStorageStats)measured=await window.MihrabNative.DeviceInfo.getStorageStats();
    const bytes=value=>new TextEncoder().encode(JSON.stringify(value||{})).length;
    const localBytes=bytes(this.storage.getConfig())+bytes(this.hadithEngine.getDatabase())+bytes(this.youtubeEngine.getFeedState('all'));
    return {disk:measured?.disk||{application:0,data:localBytes,profile:0,total:localBytes},memory:measured?.memory||0,measurement:measured?'حجم APK والملفات الخاصة بالتطبيق؛ لا يشمل محرك Android WebView المشترك.':'قياس جزئي للبيانات المحلية فقط؛ حجم التطبيق غير متاح في المتصفح.',since:usage.since,hourlySince:usage.since,days:usage.days,hours:usage.hours,networkAvailable:usage.available,networkMeasurement:usage.available?'قياس Android للرفع والتنزيل الخاصين بالتطبيق على الشبكات الخلوية وWi-Fi؛ لا يشمل التطبيقات الخارجية ولا يفصل الاستهلاك حسب الخدمة. يبدأ السجل من تفعيل القياس؛ تُنسب الفروق إلى فترة أخذ العينة.':'قياس استهلاك الشبكة غير متاح في هذه البيئة؛ لا تعتبر الأصفار قياساً فعلياً.',unknownResponses:0,network:networkPolicy(this.storage.getConfig())};
  }

  async clearResourceCache() {
    return { success: true };
  }

  async deleteResourceData(kind) {
    if (kind === 'hadith') {
      this.hadithEngine.initializeLocalDatabase();
    }
    return {
      success: true,
      hadithState: kind === 'hadith' ? this.hadithEngine.getHadithForPrayer('reset') : null,
      feeds: kind === 'youtube' ? this.youtubeEngine.getFeedState('all') : null,
    };
  }

  // ==========================================================================
  // 8. معلومات المشروع والاتصال (Project Info & Bug Report)
  // ==========================================================================
  async getProjectInfo() {
    return this.projectInfoEngine.publicInfo();
  }

  async getBankSupport() {
    return this.projectInfoEngine.bankInfo();
  }

  async copyBankField(key) {
    const val = this.projectInfoEngine.bankField(key);
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      await navigator.clipboard.writeText(val);
    }
    return { success: true };
  }

  async openProjectContact(kind) {
    const url = this.projectInfoEngine.contactUrl(kind);
    return this.openExternalUrl(url);
  }

  async openBugReport(payload) {
    const issues =
      payload?.channel === 'github' ? this.projectInfoEngine.readSource()?.['git-issues'] : undefined;
    const contact=this.projectInfoEngine.readSource()?.['report-email'];
    const draft = buildReport(payload, issues, contact?.replace(/^mailto:/i,''));
    const native=typeof window!=='undefined'&&window.MihrabNative?.DeviceInfo;
    if(payload.channel==='gmail'&&native?.openExternal){
      const result=await native.openExternal({url:'mailto:'+draft.email.to,subject:draft.email.subject,body:draft.email.body});
      if(!result?.opened)throw Error('تعذر فتح تطبيق البريد.');
      return {...result,copyRequired:false,copied:false};
    }
    let copied=false,copyError=null;
    if(draft.copyRequired){
      try{if(!navigator.clipboard?.writeText)throw Error('الحافظة غير متاحة');await navigator.clipboard.writeText(draft.text);copied=true;}
      catch(error){copyError=error.message;}
    }
    const result=await this.openExternalUrl(draft.url);
    if(!result?.opened)throw Error('تعذر فتح وجهة البلاغ.');
    return {...result,copyRequired:draft.copyRequired,copied,copyError};
  }

  // ==========================================================================
  // 9. شاشة التهيؤ للصلاة (In-App Prayer Preparation Screen)
  // ==========================================================================

  async publishPrayerWidget(){
    const plugin=typeof window!=='undefined'&&window.MihrabNative?.DeviceInfo;
    if(!plugin?.updatePrayerWidget)return {supported:false};
    const now=this.getAppNow(),G=require('../engines/prayer-times-engine'),config=this.storage.getConfig(),loc=this.prayerEngine.getLocation();
    const key=JSON.stringify([G.dateKey(now,loc.timeZone),loc,config.prayerAdjustments,config.officialSync?.lastSuccessfulReport]);
    if(this.lastWidgetKey===key)return {unchanged:true};
    const prayers=[];
    for(let i=-1;i<8;i++)for(const prayer of this.prayerEngine.calculateLocalPrayerTimes(G.shiftDay(now,i,loc.timeZone)).prayers){
      if(prayer.id!=='sunrise'&&prayer.time)prayers.push({id:prayer.id,name:prayer.name,at:new Date(prayer.time).getTime(),time24:prayer.time24});
    }
    await plugin.updatePrayerWidget({payload:JSON.stringify({city:loc.city,timeZone:loc.timeZone,graceMs:require('../ui/prayer-display').GRACE_MS,prayers})});
    this.lastWidgetKey=key;return {updated:true};
  }
  async requestPrayerWidget(){
    const plugin=typeof window!=='undefined'&&window.MihrabNative?.DeviceInfo;
    if(!plugin?.requestPrayerWidget)return {supported:false,requested:false};
    this.lastWidgetKey=null;await this.publishPrayerWidget();
    return plugin.requestPrayerWidget();
  }

  async toggleMiniPrayer() { return { supported: false }; }
  async getMiniPrayer() { return { supported: false }; }
  async hideMiniPrayer() { return { supported: false }; }
  async resizeMiniPrayer() { return { supported: false }; }
  async openMiniMain() { return { supported: false }; }
  async saveMiniRegion() { return { supported: false }; }
  async getUpdateStatus() {
    return {
      phase: 'unsupported',
      version: '1.0.1',
      nextVersion: null,
      percent: 0,
      lastChecked: null,
      message: 'تُدار التحديثات عبر متجر التطبيقات.',
      supported: false,
    };
  }
  async checkForUpdate() { return { hasUpdate: false, supported: false }; }
  async downloadUpdate() { return { supported: false }; }
  async installUpdate() { return { supported: false }; }
  async notificationPopupAction() { return { supported: false }; }
  async reportNotificationAudioStatus() { return { supported: false }; }
  async closeNotificationPopup() { return { supported: false }; }

  // ==========================================================================
  // 11. تسجيل مستمعي الأحداث (Event Listeners)
  // ==========================================================================
  onPrayerScheduleChanged(cb) { return this.events.on('app:prayer-schedule', cb); }
  onPrayerReached(cb) { return this.events.on('app:prayer-reached', cb); }
  onSyncApplied(cb) { return this.events.on('app:sync-applied', cb); }
  onConfigUpdated(cb) { return this.events.on('app:config-updated', cb); }
  onNavigateTo(cb) {
    const unsubscribe = this.events.on('app:navigate', cb);
    this.notifications.navigationListener = cb;
    const pending = this.notifications.pendingNavigation;
    this.notifications.pendingNavigation = null;
    if (pending) queueMicrotask(() => cb(pending));
    return () => {
      unsubscribe();
      if (this.notifications.navigationListener === cb) this.notifications.navigationListener = null;
    };
  }
  onNotification(cb) { return this.events.on('app:notification', cb); }
  onAutomationStatus(cb) { return this.events.on('app:automation-status',cb); }
  onNotificationError(cb) { return this.events.on('app:notification-error', cb); }
  onUpdateStatus(cb) { return this.events.on('updates:status', cb); }
  onRegionUpdated(cb) { return this.events.on('app:region-updated', cb); }
  onMiniPrayer(cb) { return this.events.on('mini:state', cb); }
}

// دالة لتثبيت الكائن في النافذة العالمية
function setupMihrabMobileApi(options = {}) {
  const api = new MihrabMobileApi(options);
  if (typeof window !== 'undefined') {
    window.mihrabApi = api;
    window.MihrabMobileApi = api;
  }
  return api;
}

// Browser entry owns initialization; a second API instance would duplicate timers.

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    MihrabMobileApi,
    setupMihrabMobileApi,
  };
}
