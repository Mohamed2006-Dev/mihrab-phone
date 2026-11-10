'use strict';
const Contract=require('../engines/local-sync-contract');
const id=()=>Array.from(crypto.getRandomValues(new Uint8Array(24)),byte=>byte.toString(16).padStart(2,'0')).join('');

class MobileLocalSync {
  constructor(api, native){this.api=api;this.native=native;this.running=false;this.ready=this.load();}
  async load(){
    const result=await this.native.loadState();
    this.state=result.state?JSON.parse(result.state):{phoneId:id(),links:[]};
    await this.persist();
  }
  persist(){return this.native.saveState({state:JSON.stringify(this.state)});}
  async status(){await this.ready;return {autoSync:this.state.autoSync!==false,links:this.state.links.map(({host,link,last,conflicts})=>({host,link:{...link,token:undefined},last,conflicts})),candidate:this.candidate?.code};}
  async setAutoSync(enabled){
    await this.ready;
    if(typeof enabled!=='boolean')throw Error('قيمة المزامنة التلقائية غير صالحة.');
    const previous=this.state.autoSync;
    this.state.autoSync=enabled;
    try{await this.persist();}
    catch(error){this.state.autoSync=previous;throw error;}
    if(enabled)this.tick({automatic:true}).catch(()=>{});
    return this.status();
  }
  async request(peer,route,body){
    const result=await this.native.exchange({host:peer.host,pin:peer.pin,token:peer.link?.token,
      route,body:JSON.stringify({version:1,...body})});
    if(result.status!==200){
      const error=Error(result.status===403?'انتهى الرمز أو أُلغي الربط.':'رفض الحاسوب طلب المزامنة.');
      error.status=result.status;throw error;
    }
    return JSON.parse(result.body);
  }
  async pair(raw,direction,groups){
    await this.ready;
    if(this.candidate&&this.candidate.until>Date.now())throw Error('أكمل طلب الربط الحالي أو ألغِه.');
    const offer=JSON.parse(raw);
    if(offer.version!==1||offer.port!==17777||!Contract.ID.test(offer.desktopId||'')||
      !/^[0-9a-f]{64}$/.test(offer.pin||'')||!/^[\w-]{43}$/.test(offer.invitation||''))
      throw Error('هذا الرمز ليس دعوة ربط من محراب.');
    Contract.validateLink({phoneId:this.state.phoneId,desktopId:offer.desktopId,direction,groups});
    if(this.state.links.some(peer=>peer.link.desktopId===offer.desktopId))throw Error('هذا الحاسوب مرتبط بالفعل.');
    if(this.state.links.length>=4||this.state.links.length>0&&
      (direction!=='phone-to-desktop'||this.state.links.some(peer=>peer.link.direction!=='phone-to-desktop')))
      throw Error('يمكن ربط عدة حواسيب فقط عند الإرسال من الهاتف.');
    const response=await this.request(offer,'/pair',{invitation:offer.invitation,phoneId:this.state.phoneId,direction,groups});
    this.candidate={...offer,code:response.code,until:Date.now()+120000,direction,groups};
    return this.status();
  }
  async finish(){
    await this.ready;
    const offer=this.candidate;
    if(!offer||offer.until<Date.now())throw Error('انتهت مهلة الاقتران.');
    const response=await this.request(offer,'/pair-status',{invitation:offer.invitation,phoneId:this.state.phoneId});
    if(this.candidate!==offer)throw Error("أُلغيت دعوة الربط.");
    if(response.waiting)return {waiting:true};
    const link=Contract.validateLink(response.link);
    if(link.desktopId!==offer.desktopId||link.phoneId!==this.state.phoneId||
      link.direction!==offer.direction||!Contract.same(link.groups,offer.groups)||!/^[\w-]{43}$/.test(link.token||''))
      throw Error('تغيّرت صلاحيات الدعوة.');
    this.state.links.push({host:offer.host,pin:offer.pin,link,sequence:0});
    await this.persist();
    this.candidate=null;
    this.tick({automatic:true}).catch(()=>{});
    return this.status();
  }
  cancel(){this.candidate=null;return this.status();}
  async configure(desktopId,direction,groups){
    await this.ready;
    if(this.running)throw Error('انتظر انتهاء النقل الجاري.');
    const peer=this.state.links.find(item=>item.link.desktopId===desktopId);
    if(!peer)throw Error('الحاسوب غير مرتبط.');
    if(this.state.links.length>1&&direction!=='phone-to-desktop')throw Error('مع عدة حواسيب، الاتجاه المتاح من الهاتف فقط.');
    Contract.validateLink({...peer.link,direction,groups});
    const previous={direction:peer.link.direction,groups:peer.link.groups};
    this.running=true;
    try {
      const result=await this.request(peer,'/configure',{previous,direction,groups});
      if(!Contract.same(result,{direction,groups}))throw Error('رد إعدادات غير صالح.');
      peer.link={...peer.link,...result};
      await this.persist();
    } finally {this.running=false;}
    return this.tick({automatic:true});
  }
  async dropLocation(desktopId){
    await this.ready;
    if(this.running)throw Error('انتظر انتهاء النقل الجاري.');
    const peer=this.state.links.find(item=>item.link.desktopId===desktopId);
    if(!peer?.link.groups.includes('location')||peer.link.groups.length<=1)throw Error('افصل الربط لإيقاف مشاركة الموقع.');
    this.running=true;
    try{
      const result=await this.request(peer,'/drop-location',{});
      const expected=peer.link.groups.filter(group=>group!=='location');
      if(!Contract.same(expected,result.groups))throw Error('رد صلاحيات غير صالح.');
      peer.link.groups=expected;
      await this.persist();
      return this.status();
    }finally{this.running=false;}
  }
  async unlink(desktopId){
    await this.ready;
    if(this.running)throw Error('انتظر انتهاء النقل الجاري.');
    const peer=this.state.links.find(item=>item.link.desktopId===desktopId);
    if(!peer)return this.status();
    this.running=true;
    try{
      try{await this.request(peer,'/unlink',{});}catch(error){if(error.status!==403)throw Error('أعد الاتصال بالحاسوب لفك الربط من الهاتف، أو افصله أولاً على الحاسوب.');}
      this.state.links=this.state.links.filter(item=>item!==peer);
      await this.persist();
      return this.status();
    }finally{this.running=false;}
  }
  async tick({automatic=false}={}){
    await this.ready;
    if(this.running||!this.state.links.length)return this.status();
    this.running=true;
    try{
      for(const peer of this.state.links){
        try{
          const config=this.api.storage.getConfig();
          const shareLocation=Contract.locationAllowed(peer.link);
          const scope=automatic&&this.state.autoSync===false?'location':'all';
          const selected=scope==='location'?(shareLocation?['location']:[]):
            peer.link.groups.filter(group=>group!=='location'||shareLocation);
          if(!selected.length)continue;
          const system=shareLocation?await window.MihrabNative.DeviceInfo.getPermissionStates():null;
          const groups={};
          for(const group of selected)
            groups[group]=group==='location'?Contract.phoneLocation({...config,location:{...this.api.prayerEngine.getLocation(),source:config.location?.source||(config.location?.autoDetect===false?'manual':null)}},Boolean(system?.location)):Contract.project(config,group);
          if(scope==='location'&&!groups.location)continue;
          const sequence=++peer.sequence;
          await this.persist();
          const result=await this.request(peer,'/exchange',{sequence,scope,groups});
          if(result.ack!==sequence)throw Error('wrong_ack');
          const patch={};
          for(const [group,value] of Object.entries(result.changes||{})){
            if(scope==='location'||!selected.includes(group)||group==='location')throw Error('unauthorized_change');
            if(!Contract.same(Contract.project(this.api.storage.getConfig(),group),groups[group])){
              (result.conflicts||=[]).push(group);continue;
            }
            Object.assign(patch,Contract.patch(group,value));
          }
          if(Object.keys(patch).length)await this.api.saveSettings(patch,true);
          peer.last=Date.now();
          if(scope==='all')peer.conflicts=result.conflicts||[];
        }catch(error){
          peer.last=null;
        }
      }
      await this.persist();
    }finally{this.running=false;}
    return this.status();
  }
}
module.exports=MobileLocalSync;
