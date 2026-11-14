import {registerPlugin} from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';
import { Preferences } from '@capacitor/preferences';
import { LocalNotifications } from '@capacitor/local-notifications';
import { App } from '@capacitor/app';
import locationIndex from '../../data/geography/location-index.json';
/**
 * نقطة انطلاق المتصفح والهاتف الموحدة (Browser & Mobile Bundle Entry Point).
 *
 * يدمج جميع الموارد المرجعية والمحركات في حزمة JavaScript موحدة تعمل في:
 * 1. بيئة متصفح الويب (Chrome / Edge / Firefox / Safari).
 * 2. تطبيق الهاتف عبر Capacitor WebView على Android و iOS.
 */

import countriesData from '../../data/geography/countries.json';
import saCitiesData from '../../data/geography/SA.json';
import maCitiesData from '../../data/geography/MA.json';
import egCitiesData from '../../data/geography/EG.json';
import aeCitiesData from '../../data/geography/AE.json';
import citiesData from '../../data/cities.json';
import quranMetaHafs from '../../data/quran-meta-hafs.json';
import quranMetaWarsh from '../../data/quran-meta-warsh.json';
import quranMetadata from '../../data/quran-metadata.json';
import seedHadithsData from '../../data/seed-hadiths.json';
import hadithSharhData from '../../data/local-hadith-sharh.json';
import youtubeContextsData from '../../data/youtube-contexts.json';
import projectPublicInfoData from '../../data/personal-data.json';

import themeEmerald from '../../themes/emerald-sanctuary.json';
import themeSapphire from '../../themes/royal-sapphire.json';
import themeSand from '../../themes/andalusian-sand.json';
import themeCopper from '../../themes/copper-courtyard.json';
import themeDusk from '../../themes/dusk-atelier.json';
import themeClassic from '../../themes/classic-monochrome.json';
import themeAmber from '../../themes/amber-gold.json';

import { registerMemoryFile } from './browser-shims.js';
import { CAPABILITIES } from './capabilities.js';
import { policy, allowed, categoryFor, CATEGORIES } from './mobile-network.js';
import MobileStorage from './mobile-storage.js';
import MobileAudio from './mobile-audio.js';
import MobileNotifications from './mobile-notifications.js';
import MobileEvents from './mobile-events.js';
import MobileLocalSync from './local-sync-phone.js';
import { MihrabMobileApi, setupMihrabMobileApi } from './mobile-api.js';

// تسجيل الملفات المرجعية في نظام الملفات الافتراضي بالذاكرة
registerMemoryFile('data/geography/countries.json', countriesData);
registerMemoryFile('data/geography/SA.json', saCitiesData);
registerMemoryFile('data/geography/MA.json', maCitiesData);
registerMemoryFile('data/geography/EG.json', egCitiesData);
registerMemoryFile('data/geography/AE.json', aeCitiesData);
registerMemoryFile('data/cities.json', citiesData);
registerMemoryFile('data/quran-meta-hafs.json', quranMetaHafs);
registerMemoryFile('data/quran-meta-warsh.json', quranMetaWarsh);
registerMemoryFile('data/quran-metadata.json', quranMetadata);
registerMemoryFile('data/seed-hadiths.json', seedHadithsData);
registerMemoryFile('data/local-hadith-sharh.json', hadithSharhData);
registerMemoryFile('data/youtube-contexts.json', youtubeContextsData);
registerMemoryFile('data/personal-data.json', projectPublicInfoData);

registerMemoryFile('themes/emerald-sanctuary.json', themeEmerald);
registerMemoryFile('themes/royal-sapphire.json', themeSapphire);
registerMemoryFile('themes/andalusian-sand.json', themeSand);

// تثبيت البيانات المرجعية في النطاق العالمي
if (typeof window !== 'undefined') {
  window.__MIHRAB_GEOGRAPHY_COUNTRIES__ = countriesData;
  window.__MIHRAB_GEOGRAPHY_CITIES__ = {
    SA: saCitiesData,
    MA: maCitiesData,
    EG: egCitiesData,
    AE: aeCitiesData,
  };
  window.__MIHRAB_CITIES__ = citiesData;
  window.__MIHRAB_QURAN_META__ = {
    hafs: quranMetaHafs,
    warsh: quranMetaWarsh,
  };
  window.__MIHRAB_QURAN_METADATA__ = quranMetadata;
  window.__MIHRAB_SEED_HADITHS__ = seedHadithsData;
  window.__MIHRAB_HADITH_SHARH__ = hadithSharhData;
  window.__MIHRAB_YOUTUBE_CONTEXTS__ = youtubeContextsData;
  window.__MIHRAB_PROJECT_INFO__ = projectPublicInfoData;
  window.__MIHRAB_THEMES__ = {
    'emerald-sanctuary': themeEmerald,
    'royal-sapphire': themeSapphire,
    'andalusian-sand': themeSand,
    'copper-courtyard': themeCopper,
    'dusk-atelier': themeDusk,
    'classic-monochrome': themeClassic,
    'amber-gold': themeAmber,
  };

  window.__MIHRAB_LOCATION_INDEX__=locationIndex;
  window.MihrabNative={Geolocation,Preferences,LocalNotifications,App,DeviceInfo:registerPlugin('MihrabDevice')};
  window.MihrabCapabilities = CAPABILITIES;
  window.MihrabNetwork = { policy, allowed, categoryFor, CATEGORIES };
  window.MobileStorage = MobileStorage;
  window.MobileAudio = MobileAudio;
  window.MobileNotifications = MobileNotifications;
  window.MobileEvents = MobileEvents;

  // تهيئة وتثبيت واجهة mihrabApi فوراً
  const api = setupMihrabMobileApi();
  window.mihrabApi = api;

  if(window.Capacitor?.isNativePlatform()){
    const syncNative=registerPlugin('MihrabLocalSync');
    const sync=new MobileLocalSync(api,syncNative);
    const tick=()=>sync.tick({automatic:true}).catch(error=>console.warn('[Mihrab local sync]',error.name));
    window.MihrabLocalSync={
      syncStatus:()=>sync.status(),syncPair:(raw,direction,groups)=>sync.pair(raw,direction,groups),
      syncFinish:()=>sync.finish(),syncCancel:()=>sync.cancel(),syncUnlink:id=>sync.unlink(id),syncDropLocation:id=>sync.dropLocation(id),
      onSyncConflicts:callback=>api.events.on("app:sync-conflicts",callback),
      onSyncCompatibilityChanged:callback=>api.events.on("app:sync-compatibility-changed",callback),
      onSyncLinkRevoked:callback=>api.events.on("app:sync-link-revoked",callback),
      syncNow:(options)=>sync.tick(options),syncConfigure:(id,direction,groups)=>sync.configure(id,direction,groups),syncSetAutomatic:enabled=>sync.setAutoSync(enabled),syncCameraPermission:()=>syncNative.cameraPermission(),
    };
    window.MihrabBoot?.whenReady.then(tick);
    App.addListener('resume',tick);
    window.addEventListener('online',tick);
    setInterval(()=>{if(!document.hidden)tick();},30000);
    setInterval(()=>{
      const panel=document.getElementById('data-settings-section-panel-sync');
      if(!document.hidden && panel && !panel.hidden && document.getElementById('tab-settings')?.classList.contains('active'))
        sync.tick({statusOnly:true}).catch(error=>console.warn('[Mihrab local sync]',error.name));
    },4000);
    window.MihrabNative.DeviceInfo.addListener('networkStatus',value=>window.dispatchEvent(new Event(value.connected?'online':'offline')));
    App.addListener('resume',()=>api.syncSystemPermissions().then(()=>api.refreshDeviceLocation()).then(()=>api.prayerAutomation.tick(api.getAppNow(),{retry:true})).then(()=>api.rescheduleNotifications()).catch(error=>api.events.emit('app:notification-error',{message:error.message})));
    App.addListener('appUrlOpen',({url})=>{if(url==='mihrab://prayers')document.querySelector('.mobile-bottom-nav [data-tab="tab-prayers"]')?.click();});
    App.addListener('backButton',()=>{
      const readerConfirmation = document.getElementById('quran-reader-exit-confirmation');
      if (readerConfirmation?.open) { readerConfirmation.close(); return; }
      const quranReader = document.getElementById('quran-reader-dialog');
      if (quranReader?.open) {
        document.getElementById('quran-reader-exit').click();
        return;
      }
      const overlay=document.querySelector('dialog[open],:popover-open');
      if(overlay){if(overlay.matches('dialog'))overlay.close();else overlay.hidePopover();return;}
      const adhkarBack = document.getElementById('adhkar-back');
      if (document.getElementById('tab-adhkar')?.classList.contains('active') && adhkarBack && !adhkarBack.hidden) {
        adhkarBack.click();
        return;
      }
      if(!document.getElementById('tab-prayers')?.classList.contains('active'))document.querySelector('.mobile-bottom-nav [data-tab="tab-prayers"]')?.click();
      else App.minimizeApp();
    });
  }
  console.log('✅ [MihrabMobile] Platform bridge window.mihrabApi initialized successfully.');
}

export { MihrabMobileApi, setupMihrabMobileApi };
