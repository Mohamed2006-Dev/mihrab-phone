const NoticePolicy=require('../engines/notification-settings');
/**
 * مدير إشعارات الهاتف (Mobile Notifications Manager).
 *
 * يدير جدولة وإلغاء إشعارات الصلوات والأوراد والدروس محلياً عبر:
 * 1. إضافة @capacitor/local-notifications في البيئة الأصلية (Android / iOS).
 * 2. معيار Web Notifications كبديل في المتصفح.
 * 3. معرفات إشعارات رقمية ثابتة ومحددة لمنع التكرار وسهولة الإلغاء والتحديث.
 */

class MobileNotifications {
  constructor(options = {}) {
    this.storage = options.storage || null;
    this.audio = options.audio || null;
    this.events = options.events || null;
    this.scheduledIds = new Set();
    this.plugin = null;

    this._initPlugin();
  }

  _initPlugin() {
    if (typeof window !== 'undefined' && window.Capacitor && window.MihrabNative?.LocalNotifications) {
      this.plugin = window.MihrabNative.LocalNotifications;
      this._registerActionListeners();
    }
  }

  _registerActionListeners() {
    if (!this.plugin) return;
    try {
      this.plugin.addListener('localNotificationActionPerformed', (action) => {
        const extra = action.notification?.extra;
        if (extra && this.events) {
          const target = extra.type === 'lesson'
            ? { tabId: 'tab-youtube', lesson: true, videoId: extra.videoId }
            : extra.tabId ? { tabId: extra.tabId } : null;
          if (!target) return;
          if (this.navigationListener) this.navigationListener(target);
          else this.pendingNavigation = target;
        }
      });
    } catch (e) {
      console.warn('[MobileNotifications] Listener registration error:', e);
    }
  }

  async requestPermission() {
    if (this.plugin) {
      try {
        const status = await this.plugin.requestPermissions();
        return status.display === 'granted';
      } catch (err) {
        console.warn('[MobileNotifications] Plugin permission error:', err);
      }
    }
    if (typeof Notification !== 'undefined' && Notification.requestPermission) {
      try {
        const res = await Notification.requestPermission();
        return res === 'granted';
      } catch (_) {}
    }
    return false;
  }

  async checkPermission() {
    if (this.plugin) {
      try {
        const status = await this.plugin.checkPermissions();
        return status.display === 'granted';
      } catch (_) {}
    }
    if (typeof Notification !== 'undefined') {
      return Notification.permission === 'granted';
    }
    return false;
  }

  /**
   * توليد معرف رقمي فريد ومستقر للإشعار (مطلوب لـ Capacitor على Android/iOS).
   */
  hashNotificationId(tag) {
    let hash = 0;
    const str = String(tag);
    for (let i = 0; i < str.length; i++) {
      hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
    }
    return Math.abs(hash);
  }

  async snoozeLesson(video) {
    const locale = typeof window !== 'undefined' ? window.mihrabLocale : null;
    await locale?.ready;
    if (!this.plugin || !(await this.checkPermission())) throw new Error('إذن الإشعارات غير متاح.');
    await this.plugin.schedule({ notifications: [{
      id: 17010101,
      title: locale?.localize('تذكير بالدرس') ?? 'تذكير بالدرس',
      body: video.title,
      channelId: 'mihrab-visible-v2',
      schedule: { at: new Date(Date.now() + 5 * 60000) },
      extra: { type: 'lesson', tabId: 'tab-youtube', videoId: video.videoId, channelId: video.channelId, snoozed: true },
    }] });
    return { scheduled: true };
  }

  async cancelAll({ keepLessonSnooze = false } = {}) {
    if (this.plugin) {
      try {
        const pending = await this.plugin.getPending();
        if (pending?.notifications?.length > 0) {
          const notifications = pending.notifications.filter(notice => !keepLessonSnooze || notice.id !== 17010101);
          if (notifications.length) await this.plugin.cancel({ notifications });
        }
      } catch (e) {
        console.warn('[MobileNotifications] Cancel pending error:', e);
      }
    }
    this.scheduledIds.clear();
  }

  async schedulePrayerAlarms(prayerData, config, quranState, recommendation = null, customDays = [], appNow = new Date()) {
    const locale = typeof window !== 'undefined' ? window.mihrabLocale : null;
    await locale?.ready;
    const localize = locale?.localize ?? (text => text);
    if (!prayerData || (!prayerData.prayers && !prayerData.schedule)) return { scheduledCount: 0 };
    if(this.plugin){
      let permission=await this.plugin.checkPermissions();
      
      if(permission.display!=='granted'){await this.cancelAll();return {scheduledCount:0,permissionDenied:true};}
      if(this.plugin.createChannel){
        await this.plugin.createChannel({id:'mihrab-adhan-v2',name:localize('الأذان'),importance:4,sound:'adhan.flac'});
        await this.plugin.createChannel({id:'mihrab-visible-v2',name:localize('تذكيرات محراب'),importance:4,vibration:true});
      }
    }
    await this.cancelAll({ keepLessonSnooze: config?.notifications?.lessons?.enabled !== false });

    const notificationsToSchedule = [];
    const notificationsConfig = config?.notifications || {};
    const now = Date.now();
    const exact = this.plugin?.checkExactNotificationSetting
      ? (await this.plugin.checkExactNotificationSetting()).exact_alarm === 'granted' : true;
    const days = customDays.length ? customDays.slice(1, 4) : [{ date: appNow, data: prayerData }];
    for (const { date, data: day } of days) {
      const isFriday = Boolean(day.isFriday);
      const notificationsConfig = config?.notifications || {};
      const prayersList = day.prayers || [];

      const prayers = [
        { id: 'fajr', name: 'الفجر' },
        { id: 'dhuhr', name: isFriday ? 'الجمعة' : 'الظهر' },
        { id: 'asr', name: 'العصر' },
        { id: 'maghrib', name: 'المغرب' },
        { id: 'isha', name: 'العشاء' },
      ];

      for (const prayer of prayers) {
        let prayerTime = day.schedule?.[prayer.id];
        if (!prayerTime) {
          const item = prayersList.find((p) => p.id === prayer.id);
          prayerTime = item?.time;
        }
        if (!prayerTime) continue;
        const prayerDate = new Date(prayerTime);
        const prayerEpoch = prayerDate.getTime();

        if (prayerEpoch > now && NoticePolicy.prayerAllowed(config,prayer.id,isFriday)) {
          const notifId = this.hashNotificationId(`prayer_${prayer.id}_${prayerDate.toISOString().slice(0, 10)}`);
          notificationsToSchedule.push({
            id: notifId,
            title: `حان موعد صلاة ${prayer.name}`,
            body: `حان الآن موعد أذان ${prayer.name} حسب توقيت مدينتك.`,
            schedule: { at: prayerDate, allowWhileIdle: true },
            isExactNotification: exact,
            channelId: notificationsConfig.playAdhanAudio!==false?'mihrab-adhan-v2':'mihrab-visible-v2',
            sound: notificationsConfig.playAdhanAudio!==false ? 'adhan.flac' : undefined,
            extra: { type: 'prayer', prayerId: prayer.id, tabId: 'tab-prayers' },
          });
          this.scheduledIds.add(notifId);
        }

        // إشعار ما قبل الأذان
        const preference=NoticePolicy.prePrayer(config,prayer.id,isFriday),preMinutes=preference.minutes;
        if (preference.enabled) {
          const preDate = new Date(prayerEpoch - preMinutes * 60000);
          if (preDate.getTime() > now) {
            const preId = this.hashNotificationId(`pre_${prayer.id}_${prayerDate.toISOString().slice(0, 10)}`);
            notificationsToSchedule.push({
              id: preId,
              channelId:'mihrab-visible-v2',
              title: `اقترب موعد صلاة ${prayer.name}`,
              body: `بقي ${preMinutes} دقيقة على موعد أذان ${prayer.name}.`,
              schedule: { at: preDate },
              isExactNotification: false,
              extra: { type: 'pre_prayer', prayerId: prayer.id, tabId: 'tab-prayers' },
            });
            this.scheduledIds.add(preId);
          }
        }
      }

      const zone=day.location?.timeZone||config.location?.timeZone||Intl.DateTimeFormat().resolvedOptions().timeZone;
      const Geography=require('../engines/prayer-times-engine');
      const fixedEpoch=clock=>{
        if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(clock||''))return NaN;
        const parts=Geography.dateParts(date,zone),[hour,minute]=clock.split(':').map(Number);
        const wall=Date.UTC(Number(parts.year),Number(parts.month)-1,Number(parts.day),hour,minute);let guess=wall;
        for(let i=0;i<3;i++){const p=Geography.dateParts(new Date(guess),zone);guess+=wall-Date.UTC(Number(p.year),Number(p.month)-1,Number(p.day),Number(p.hour)%24,Number(p.minute),Number(p.second)||0);}return guess;
      };
      const reminder=(type,title,block,defaultPrayer,offset)=>{
        const prayer=prayersList.find(p=>p.id===(block.afterPrayer||block.prayer||defaultPrayer));
        const fixed=block.timingMode==='fixed'||(block.timingMode==null&&block.customTimeEnabled);
        const due=fixed?fixedEpoch(block.customTime):prayer?.time?Math.floor(new Date(prayer.time).getTime()/60000)*60000+Number(block.afterPrayerMinutes??block.minutesAfter??offset)*60000:NaN;
        if(due>now)notificationsToSchedule.push({id:this.hashNotificationId(type+'_'+due),title,body:type==='lesson'?recommendation.title:type==='quran_hifz'?'حان موعد ورد الحفظ والمراجعة. افتح محراب لمتابعة وردك.':'حان موعد القراءة والتلاوة. افتح محراب لمتابعة وردك.',channelId:'mihrab-visible-v2',schedule:{at:new Date(due)},isExactNotification:false,extra: type === 'lesson' ? { type, tabId: 'tab-youtube', videoId: recommendation.videoId, channelId: recommendation.channelId } : { type, tabId: 'tab-quran' }});
      };
      const qw=config.quranWird||{},mode=qw.notificationMode||'both';
      if(['both','reading_only'].includes(mode))reminder('quran_reading','موعد ورد القراءة',qw.reading||{},'isha',qw.reading?.afterIshaMinutes??30);
      if(['both','hifz_only'].includes(mode))reminder('quran_hifz','موعد الحفظ والمراجعة',qw.hifz||{},'fajr',qw.hifz?.afterFajrMinutes??30);
      const lesson=NoticePolicy.normalizeConfig(config).notifications.lessons;
      if(lesson.enabled && /^[A-Za-z0-9_-]{11}$/.test(recommendation?.videoId||'') && config.youtube?.channels?.some(channel=>channel.channelId===recommendation.channelId))reminder('lesson','موعد الدرس اليومي',lesson,'isha',45);

    }
    const custom = require('../engines/custom-reminders');
    const hasVideo = /^[A-Za-z0-9_-]{11}$/.test(recommendation?.videoId || '') &&
      config.youtube?.channels?.some(channel => channel.channelId === recommendation.channelId);
    for (const item of custom.plan(notificationsConfig.customReminders, config, customDays,
      +appNow + 1000, +appNow + 7 * 86400000, hasVideo)) {
      notificationsToSchedule.push({
        id: this.hashNotificationId('custom_' + item.id + '_' + item.time),
        title: item.title,
        body: item.type === 'video' ? recommendation.title : item.body,
        schedule: { at: new Date(item.time) },
        isExactNotification: false,
        channelId: 'mihrab-visible-v2',
        extra: item.type === 'video'
          ? { type: 'lesson', tabId: item.tabId, videoId: recommendation.videoId } : { tabId: item.tabId },
      });
    }
    const unique = [...new Map(notificationsToSchedule.map(item => [item.id, item])).values()];
    if (this.plugin && unique.length > 0) {
      try {
        await this.plugin.schedule({ notifications: unique.map(item => ({
          ...item,
          title: localize(item.title),
          body: item.extra?.type === 'lesson' ? item.body : localize(item.body),
        })) });
      } catch (err) {
        throw new Error('تعذرت جدولة إشعارات الهاتف: '+err.message);
      }
    }

    return { scheduledCount: this.plugin?unique.length:0, plannedCount: unique.length, native:Boolean(this.plugin) };
  }

  async triggerImmediate(title, body, extra = {}) {
    const locale = typeof window !== 'undefined' ? window.mihrabLocale : null;
    await locale?.ready;
    title = locale?.localize(title) ?? title;
    if (extra.type !== 'lesson') body = locale?.localize(body) ?? body;
    if (this.plugin) {
      try {
        const id = Math.floor(Math.random() * 1000000);
        await this.plugin.schedule({
          notifications: [
            {
              id,
              title,
              body,
              schedule: { at: new Date(Date.now() + 500) },
              extra,
            },
          ],
        });
        return { success: true, id };
      } catch (e) {
        console.warn('[MobileNotifications] Immediate schedule failed:', e);
      }
    }
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      try {
        new Notification(title, { body, icon: 'assets/app-icon.png' });
        return { success: true };
      } catch (_) {}
    }
    return { success: false };
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = MobileNotifications;
}
if (typeof window !== 'undefined') {
  window.MobileNotifications = MobileNotifications;
}
