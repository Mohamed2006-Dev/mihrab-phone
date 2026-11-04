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
          if (extra.type === 'lesson' && extra.videoId) {
            this.events.emit('app:navigate', {
              tabId: 'tab-youtube',
              videoId: extra.videoId,
              channelId: extra.channelId,
            });
          } else if (extra.tabId) {
            this.events.emit('app:navigate', { tabId: extra.tabId });
          }
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

  async cancelAll() {
    if (this.plugin) {
      try {
        const pending = await this.plugin.getPending();
        if (pending?.notifications?.length > 0) {
          await this.plugin.cancel({ notifications: pending.notifications });
        }
      } catch (e) {
        console.warn('[MobileNotifications] Cancel pending error:', e);
      }
    }
    this.scheduledIds.clear();
  }

  async schedulePrayerAlarms(prayerData, config, quranState, recommendation = null) {
    if (!prayerData || (!prayerData.prayers && !prayerData.schedule)) return { scheduledCount: 0 };
    if(this.plugin){
      let permission=await this.plugin.checkPermissions();
      if(permission.display==='prompt')permission=await this.plugin.requestPermissions();
      if(permission.display!=='granted')throw Error('إشعارات الهاتف معطلة من النظام. اسمح بها من إعدادات التطبيق على الهاتف.');
      if(this.plugin.createChannel){
        await this.plugin.createChannel({id:'mihrab-adhan-v1',name:'الأذان',importance:4,sound:'adhan.wav'});
        await this.plugin.createChannel({id:'mihrab-quiet-v1',name:'التذكيرات الهادئة',importance:2});
      }
    }
    await this.cancelAll();

    const notificationsToSchedule = [];
    const now = Date.now();
    const isFriday = Boolean(prayerData.isFriday);
    const notificationsConfig = config?.notifications || {};
    const prayersList = prayerData.prayers || [];

    const prayers = [
      { id: 'fajr', name: 'الفجر' },
      { id: 'dhuhr', name: isFriday ? 'الجمعة' : 'الظهر' },
      { id: 'asr', name: 'العصر' },
      { id: 'maghrib', name: 'المغرب' },
      { id: 'isha', name: 'العشاء' },
    ];

    for (const prayer of prayers) {
      let prayerTime = prayerData.schedule?.[prayer.id];
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
          schedule: { at: prayerDate },
          channelId: notificationsConfig.playAdhanAudio!==false?'mihrab-adhan-v1':'mihrab-quiet-v1',
          sound: notificationsConfig.playAdhanAudio!==false ? 'adhan.wav' : undefined,
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
            channelId:'mihrab-quiet-v1',
            title: `اقترب موعد صلاة ${prayer.name}`,
            body: `بقي ${preMinutes} دقيقة على موعد أذان ${prayer.name}.`,
            schedule: { at: preDate },
            extra: { type: 'pre_prayer', prayerId: prayer.id, tabId: 'tab-prayers' },
          });
          this.scheduledIds.add(preId);
        }
      }
    }

    const zone=prayerData.location?.timeZone||config.location?.timeZone||Intl.DateTimeFormat().resolvedOptions().timeZone;
    const Geography=require('../engines/prayer-times-engine');
    const fixedEpoch=clock=>{
      if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(clock||''))return NaN;
      const parts=Geography.dateParts(new Date(now),zone),[hour,minute]=clock.split(':').map(Number);
      const wall=Date.UTC(Number(parts.year),Number(parts.month)-1,Number(parts.day),hour,minute);let guess=wall;
      for(let i=0;i<3;i++){const p=Geography.dateParts(new Date(guess),zone);guess+=wall-Date.UTC(Number(p.year),Number(p.month)-1,Number(p.day),Number(p.hour)%24,Number(p.minute),Number(p.second)||0);}return guess;
    };
    const reminder=(type,title,block,defaultPrayer,offset)=>{
      const prayer=prayersList.find(p=>p.id===(block.afterPrayer||block.prayer||defaultPrayer));
      const fixed=block.timingMode==='fixed'||(block.timingMode==null&&block.customTimeEnabled);
      const due=fixed?fixedEpoch(block.customTime):prayer?.time?Math.floor(new Date(prayer.time).getTime()/60000)*60000+Number(block.afterPrayerMinutes??block.minutesAfter??offset)*60000:NaN;
      if(due>now)notificationsToSchedule.push({id:this.hashNotificationId(type+'_'+due),title,body:type==='lesson'?'افتح محراب لمشاهدة الدروس المرشحة.':type==='quran_hifz'?'حان موعد ورد الحفظ والمراجعة. افتح محراب لمتابعة وردك.':'حان موعد القراءة والتلاوة. افتح محراب لمتابعة وردك.',channelId:'mihrab-quiet-v1',schedule:{at:new Date(due)},extra:{type,tabId:type==='lesson'?'tab-youtube':'tab-quran'}});
    };
    const qw=config.quranWird||{},mode=qw.notificationMode||'both';
    if(['both','reading_only'].includes(mode))reminder('quran_reading','موعد ورد القراءة',qw.reading||{},'isha',qw.reading?.afterIshaMinutes??30);
    if(['both','hifz_only'].includes(mode))reminder('quran_hifz','موعد الحفظ والمراجعة',qw.hifz||{},'fajr',qw.hifz?.afterFajrMinutes??30);
    const lesson=NoticePolicy.normalizeConfig(config).notifications.lessons;
    if(lesson.enabled && /^[A-Za-z0-9_-]{11}$/.test(recommendation?.videoId||'') && config.youtube?.channels?.some(channel=>channel.channelId===recommendation.channelId))reminder('lesson','موعد الدرس اليومي',lesson,'isha',45);

    if (this.plugin && notificationsToSchedule.length > 0) {
      try {
        await this.plugin.schedule({ notifications: notificationsToSchedule });
      } catch (err) {
        throw new Error('تعذرت جدولة إشعارات الهاتف: '+err.message);
      }
    }

    return { scheduledCount: this.plugin?notificationsToSchedule.length:0, plannedCount: notificationsToSchedule.length, native:Boolean(this.plugin) };
  }

  async triggerImmediate(title, body, extra = {}) {
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
