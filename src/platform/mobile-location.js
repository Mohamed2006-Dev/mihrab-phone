const radians=value=>value*Math.PI/180;
function nearestCity(rows,lat,lng){
 let best=null,distance=Infinity;
 for(const row of rows){const [code,name,y,x,zone]=row,dy=radians(y-lat),dx=radians(x-lng);const a=Math.sin(dy/2)**2+Math.cos(radians(lat))*Math.cos(radians(y))*Math.sin(dx/2)**2;const km=6371*2*Math.atan2(Math.sqrt(a),Math.sqrt(Math.max(0,1-a)));if(km<distance){distance=km;best={countryCode:code,city:name,timeZone:zone,distanceKm:km};}}
 if(!best)throw Error('قاعدة المدن المحلية غير متاحة.');return best;
}
class MobileLocation{
 constructor(options={}){this.plugin=options.plugin;this.index=options.index;}
 async detect({requestPermission=true}={}){
  try{
   const plugin=this.plugin||(typeof window!=='undefined'?window.MihrabNative?.Geolocation:null);
   let position;
   if(plugin){let permission=await plugin.checkPermissions();if(!['granted'].includes(permission.location)&&permission.coarseLocation!=='granted'){if(!requestPermission)throw Error('إذن الموقع غير متاح.');permission=await plugin.requestPermissions({permissions:['coarseLocation']});}if(permission.location!=='granted'&&permission.coarseLocation!=='granted')throw Error('اسمح بالوصول إلى الموقع أثناء استخدام التطبيق، أو اختر مدينتك يدوياً.');position=await plugin.getCurrentPosition({enableHighAccuracy:false,timeout:20000,maximumAge:0});}
   else if(typeof navigator!=='undefined'&&navigator.geolocation)position=await new Promise((resolve,reject)=>navigator.geolocation.getCurrentPosition(resolve,reject,{enableHighAccuracy:false,timeout:20000,maximumAge:0}));
   else throw Error('تحديد الموقع غير متاح؛ اختر المدينة يدوياً.');
   const {latitude:lat,longitude:lng,accuracy}=position.coords||{};
   if(!Number.isFinite(lat)||!Number.isFinite(lng)||Math.abs(lat)>90||Math.abs(lng)>180)throw Error('لم يصل موقع صالح من الجهاز.');
   const rows=this.index||(typeof window!=='undefined'?window.__MIHRAB_LOCATION_INDEX__:[]);
   return {success:true,source:'device',lat,lng,accuracy,...nearestCity(rows,lat,lng)};
  }catch(error){const denied=['OS-PLUG-GLOC-0003',1].includes(error.code);return {success:false,error:denied?'إذن الموقع مرفوض. يمكنك السماح به من إعدادات الهاتف أو اختيار المدينة يدوياً.':`تعذر قراءة موقع الجهاز. تأكد من تشغيل الموقع ثم أعد المحاولة. ${error.message||''}`};}
 }
}
module.exports={MobileLocation,nearestCity};
