let quranTextPixels=19;
function setMobileTextZoom(element,scale){
 if(!element)return;
 let inner=element.querySelector(':scope > .mobile-text-content');
 if(!inner){const height=element.getBoundingClientRect().height||parseFloat(getComputedStyle(element).height)||200,base=parseFloat(getComputedStyle(element).fontSize);inner=document.createElement('span');inner.className='mobile-text-content';inner.dataset.baseFont=String(base);inner.textContent=element.textContent;element.replaceChildren(inner);element.style.height=height+'px';element.style.flex='none';element.classList.add('mobile-text-viewport');}
 const isQuran=element.matches('.quran-boundary p'),isHadith=element.id==='main-hadith-text',base=Number(inner.dataset.baseFont);
 const value=isHadith?Math.max(14/base,Math.min(32/base,scale)):isQuran?Math.max(16/base,Math.min(30/base,scale)):Math.max(1,Math.min(2.3,scale));inner.style.fontSize=(Number(inner.dataset.baseFont)*value)+'px';element.dataset.textZoom=String(value);if(isHadith)syncHadithFontControls();if(isQuran){quranTextPixels=base*value;syncQuranFontControls();}
}
function syncHadithFontControls(){
 const quote=document.getElementById('main-hadith-text');
 const base=Number(quote?.querySelector('.mobile-text-content')?.dataset.baseFont)||parseFloat(getComputedStyle(quote).fontSize);
 const pixels=base*(Number(quote.dataset.textZoom)||1);
 document.getElementById('btn-hadith-font-increase').disabled=pixels>=31.99;
 document.getElementById('btn-hadith-font-decrease').disabled=pixels<=14.01;
 document.getElementById('hadith-font-size').textContent='حجم الخط '+Math.round(pixels);
}
function syncQuranFontControls(){
 for(const button of document.querySelectorAll('[data-quran-font-step]'))button.disabled=Number(button.dataset.quranFontStep)>0?quranTextPixels>=29.99:quranTextPixels<=16.01;
}
function applyQuranTextSize(){
 for(const element of document.querySelectorAll('.quran-book-spread>.quran-boundary p')){
  const base=Number(element.querySelector('.mobile-text-content')?.dataset.baseFont)||parseFloat(getComputedStyle(element).fontSize);
  setMobileTextZoom(element,quranTextPixels/base);
 }
 syncQuranFontControls();
}
function initializeMobileInteractions(){
 for(const button of document.querySelectorAll('[data-quran-font-step]'))button.addEventListener('click',()=>{quranTextPixels=Math.min(30,Math.max(16,quranTextPixels+Number(button.dataset.quranFontStep)));applyQuranTextSize();});
 syncQuranFontControls();
 for(const [id,step] of [['btn-hadith-font-increase',2],['btn-hadith-font-decrease',-2]])document.getElementById(id).addEventListener('click',()=>{
   const quote=document.getElementById('main-hadith-text');
   const base=Number(quote.querySelector('.mobile-text-content')?.dataset.baseFont)||parseFloat(getComputedStyle(quote).fontSize);
   setMobileTextZoom(quote,((Number(quote.dataset.textZoom)||1)*base+step)/base);
 });
 syncHadithFontControls();
 let gesture=null;
 const distance=touches=>Math.hypot(touches[0].clientX-touches[1].clientX,touches[0].clientY-touches[1].clientY);
 document.addEventListener('touchstart',event=>{if(event.touches.length!==2)return;const element=event.target.closest('.quran-boundary p,#main-hadith-text,.hadith-sharh-explanation,.lesson-title');if(element)gesture={element,start:distance(event.touches),scale:Number(element.dataset.textZoom)||1};},{passive:true});
 document.addEventListener('touchmove',event=>{if(!gesture||event.touches.length!==2)return;event.preventDefault();setMobileTextZoom(gesture.element,gesture.scale*distance(event.touches)/Math.max(1,gesture.start));},{passive:false});
 document.addEventListener('touchend',event=>{if(event.touches.length<2)gesture=null;},{passive:true});
}

// Reconcile permission controls after the renderer has refreshed the saved settings.
function reflectSystemPermissions(){
 const native=window.MihrabNative;if(!native)return;
 const config=typeof state!=='undefined'?state.config:null;
 const granted=config?.systemPermissions?.notifications===true;
 const panel=document.getElementById('notification-settings');if(!panel)return;
 let button=document.getElementById('request-native-notifications');
 if(!button){button=document.createElement('button');button.id='request-native-notifications';button.type='button';button.className='btn btn-secondary';button.textContent='السماح بإشعارات التطبيق';panel.querySelector('header').after(button);button.addEventListener('click',async()=>{button.disabled=true;try{const ok=await window.mihrabApi.notifications.requestPermission();await window.mihrabApi.syncSystemPermissions();if(!ok)await native.DeviceInfo.openNotificationSettings();}finally{button.disabled=false;}});}
 button.hidden=granted;
 if(typeof renderQuranNotificationShortcuts==='function')renderQuranNotificationShortcuts();
 for(const input of panel.querySelectorAll('input,select')){
  if(!granted){if(input.dataset.permissionDisabled!=='true')input.dataset.wasDisabled=String(input.disabled);input.dataset.permissionDisabled='true';input.disabled=true;}
  else if(input.dataset.permissionDisabled==='true'){input.disabled=input.dataset.wasDisabled==='true';delete input.dataset.permissionDisabled;delete input.dataset.wasDisabled;}
 }
}
if(window.mihrabApi?.onConfigUpdated)window.mihrabApi.onConfigUpdated(()=>queueMicrotask(reflectSystemPermissions));
window.MihrabBoot?.whenReady?.then(reflectSystemPermissions);
window.addEventListener('online',()=>{
 const network=/تعذر الاتصال|الشبكة غير متاحة|غير متصل|انقطاع|عدم (?:توفر|وجود) (?:الشبكة|الإنترنت)|لا يوجد اتصال|دون اتصال|offline|failed to fetch|network|ERR_INTERNET_DISCONNECTED/i;
 for(const node of document.querySelectorAll('[role="status"],.settings-status'))if(network.test(node.textContent)){node.textContent='';}
 for(const dialog of document.querySelectorAll('dialog[open]'))if(network.test(dialog.textContent)&&/تعذر|فشل|خطأ|error/i.test(dialog.textContent))dialog.close();
});

function fitPrayerCards(){
 const name=document.querySelector('.prayer-item-card .prayer-name');if(!name)return;
 // Computed size already includes WebView text scaling; never apply it twice.
 const font=parseFloat(getComputedStyle(name).fontSize)||17;
 document.documentElement.style.setProperty('--prayer-card-min',Math.max(100,Math.ceil(100*font/17))+'px');
}
window.addEventListener('resize',fitPrayerCards);window.MihrabBoot.whenReady.then(fitPrayerCards);

window.addEventListener('online',async()=>{
 const modal=document.getElementById('modal-operation-result');
 if(modal?.dataset.networkError==='true'){modal.classList.remove('open');delete modal.dataset.networkError;}
 const status=document.getElementById('yt-feed-status');
 if(status&&/تعذر|فشل|offline|network/i.test(status.textContent)){
   status.textContent='';status.hidden=true;
   if(state.config?.network?.enabled!==false&&state.config?.network?.categories?.youtube!==false){
    try{renderYoutubeState(await window.mihrabApi.refreshYoutubeFeeds('all'));}catch(error){if(typeof showYoutubeError==='function')showYoutubeError(error);else{status.hidden=false;status.textContent='تعذر تحديث الخلاصات: '+error.message;}}
   }
 }
});

window.mihrabApi.events.on('app:permission-sync-completed',()=>queueMicrotask(()=>{
 settingsDraftBaselines.set('notifications',settingsGroupSnapshot('notifications'));
 updateDirtyBadges();
}));
