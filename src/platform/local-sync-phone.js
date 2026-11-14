'use strict';
const Contract=require('../engines/local-sync-contract');
const id=()=>Array.from(crypto.getRandomValues(new Uint8Array(24)),byte=>byte.toString(16).padStart(2,'0')).join('');

function protocolMismatch(){
  const error=Error('أُوقفت المزامنة بسبب عدم توافق إصدار البروتوكول. حدّث محراب على الهاتف والحاسوب ثم أعد المحاولة.');
  error.code='protocol_version';
  error.status=409;
  return error;
}

class MobileLocalSync {
  constructor(api, native){this.api=api;this.native=native;this.running=false;this.incompatiblePeers=new Set();this.ready=this.load();}
  async load(){
    const result=await this.native.loadState();
    this.state=result.state?JSON.parse(result.state):{phoneId:id(),links:[]};
    await this.persist();
    this.recoveredStore=result.recovered===true;
  }
  persist(){return this.native.saveState({state:JSON.stringify(this.state)});}
  async status(){await this.ready;return {recoveredStore:this.recoveredStore===true,autoSync:this.state.autoSync!==false,links:this.state.links.map(({host,link,last,conflicts,details})=>({host,link:{...link,token:undefined},last,conflicts,details,protocolMismatch:this.incompatiblePeers.has(link.desktopId)})),candidate:this.candidate?.code};}
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
      route,body:JSON.stringify({...body,version:Contract.LINK_VERSION,protocolVersion:Contract.PROTOCOL_VERSION})});
    let reply;
    try{reply=JSON.parse(result.body);}catch{ /* Unreadable replies cannot establish compatibility. */ }
    if(reply?.error==='protocol_version'||
      (route==='/exchange'||route==='/status'&&result.status===200)&&reply?.protocolVersion!==Contract.PROTOCOL_VERSION)
      throw protocolMismatch();
    if(result.status!==200){
      const error=Error(result.status===403?'انتهى الرمز أو أُلغي الربط.':'رفض الحاسوب طلب المزامنة.');
      error.status=result.status;
      error.code=reply?.error;
      throw error;
    }
    return reply;
  }
  async pair(raw,direction,groups){
    await this.ready;
    if(this.candidate&&this.candidate.until>Date.now())throw Error('أكمل طلب الربط الحالي أو ألغِه.');
    const offer=JSON.parse(raw);
    if(offer.version!==Contract.LINK_VERSION||offer.port!==17777||!Contract.ID.test(offer.desktopId||'')||
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
    if(!offer)throw Error('انتهت مهلة الاقتران.');
    let response;
    try{
      response=await this.request(offer,'/pair-status',{invitation:offer.invitation,phoneId:this.state.phoneId});
    }catch(error){
      error.retryable=!error.status||error.status>=500;
      throw error;
    }
    if(this.candidate!==offer)throw Error("أُلغيت دعوة الربط.");
    if(response.waiting)return {waiting:true};
    const link=Contract.validateLink(response.link);
    if(link.desktopId!==offer.desktopId||link.phoneId!==this.state.phoneId||
      link.direction!==offer.direction||!Contract.same(link.groups,offer.groups)||!/^[\w-]{43}$/.test(link.token||''))
      throw Error('تغيّرت صلاحيات الدعوة.');
    const peer={host:offer.host,pin:offer.pin,link,sequence:0};
    this.state.links.push(peer);
    try{await this.persist();}
    catch(error){
      this.state.links=this.state.links.filter(item=>item!==peer);
      error.retryable=true;
      throw error;
    }
    this.candidate=null;
    this.tick({statusOnly:true}).finally(()=>this.tick({automatic:true})).catch(()=>{});
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
      delete peer.outbox;
      delete peer.applied;
      delete peer.details;
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
      const previous=this.state;
      this.state={...previous,links:previous.links.filter(item=>item!==peer),
        pendingUnlinks:[...(previous.pendingUnlinks||[]),{host:peer.host,pin:peer.pin,link:peer.link}]};
      try{await this.persist();}
      catch(error){this.state=previous;throw error;}
      this.incompatiblePeers.delete(desktopId);
      await this.flushUnlinks();
      return this.status();
    }finally{this.running=false;}
  }
  async flushUnlinks(){
    for(const peer of this.state.pendingUnlinks||[]){
      try{await this.request(peer,'/unlink',{});}
      catch(error){if(error.status!==403||error.code!=='unpaired')continue;}
      const previous=this.state.pendingUnlinks;
      this.state.pendingUnlinks=previous.filter(item=>item!==peer);
      try{await this.persist();}
      catch{this.state.pendingUnlinks=previous;}
    }
  }
  configForSync(){
    const config=this.api.storage.getConfig();
    return this.api.sharedSettings ? {...config,sharedSettings:this.api.sharedSettings()} : config;
  }
  async tick({automatic=false,statusOnly=false,desktopId,resolution}={}){
    await this.ready;
    if(resolution){
      const peer=this.state.links.find(item=>item.link.desktopId===desktopId);
      if(peer){peer.resolution=resolution;await this.persist();}
    }
    if(this.running||(!this.state.links.length&&!this.state.pendingUnlinks?.length))return this.status();
    this.running=true;
    try{
      if(!statusOnly)await this.flushUnlinks();
      const revoked=[];
      let compatibilityChanged=false;
      for(const peer of this.state.links){
        if(desktopId&&peer.link.desktopId!==desktopId)continue;
        try{
          // Verify the pinned peer before sending an outbox or reading local data.
          await this.request(peer,'/status',{});
          compatibilityChanged=this.incompatiblePeers.delete(peer.link.desktopId)||compatibilityChanged;
          if(statusOnly)continue;
          const config=this.configForSync();
          const shareLocation=Contract.locationAllowed(peer.link);
          const scope=!peer.resolution&&automatic&&this.state.autoSync===false?'location':'all';
          const selected=scope==='location'?(shareLocation?['location']:[]):
            peer.link.groups.filter(group=>group!=='location'||shareLocation);
          if(!selected.length)continue;
          const system=shareLocation?await window.MihrabNative.DeviceInfo.getPermissionStates():null;
          const groups={};
          for(const group of selected)
            groups[group]=group==='location'?Contract.phoneLocation({...config,location:{...this.api.prayerEngine.getLocation(),source:config.location?.source||(config.location?.autoDetect===false?'manual':null)}},Boolean(system?.location)):Contract.project(config,group);
          if(scope==='location'&&!groups.location)continue;
          if(peer.outbox&&(peer.outbox.protocolVersion!==Contract.PROTOCOL_VERSION||
            peer.outbox.groups.location&&!shareLocation))delete peer.outbox;
          if(!peer.outbox){
            peer.outbox={protocolVersion:Contract.PROTOCOL_VERSION,sequence:++peer.sequence,scope,groups,clocks:Object.fromEntries(selected.filter(group=>config.syncClocks?.[group]).map(group=>[group,config.syncClocks[group]])),applied:peer.applied||{},...(peer.resolution?{resolution:peer.resolution}:{})};
            try{await this.persist();}
            catch(error){delete peer.outbox;throw error;}
          }
          const sent=peer.outbox;
          const sequence=sent.sequence;
          const result=await this.request(peer,'/exchange',sent);
          if(result.ack!==sequence)throw Error('wrong_ack');
          const patch={};
          for(const [group,value] of Object.entries(result.changes||{})){
            if(sent.scope==='location'||!Object.hasOwn(sent.groups,group)||!peer.link.groups.includes(group)||group==='location')throw Error('unauthorized_change');
            const current=Contract.project(this.configForSync(),group);
            if(Contract.same(current,value)){
              (peer.applied||={})[group]=sequence;
              continue;
            }
            if(!Contract.same(current,sent.groups[group])){
              (result.conflicts||=[]).push(group);continue;
            }
            Object.assign(patch,Contract.patch(group,value));
          }
          if(Object.keys(patch).length){
            await this.api.saveSettings(patch,true);
            for(const [group,value] of Object.entries(result.changes||{})){
              if(Contract.same(Contract.project(this.configForSync(),group),value))
                (peer.applied||={})[group]=sequence;
            }
          }
          delete peer.outbox;
          if(sent.resolution&&Contract.same(peer.resolution,sent.resolution))delete peer.resolution;
          peer.last=Date.now();
          if(sent.scope==='all'){
            peer.conflicts=[...new Set(result.conflicts||[])];
            peer.details=result.details||[];
          }
        }catch(error){
          if(error.status===403&&error.code==='unpaired')revoked.push(peer);
          else if(error.code==='protocol_version'){
            if(!this.incompatiblePeers.has(peer.link.desktopId)){
              this.incompatiblePeers.add(peer.link.desktopId);
              compatibilityChanged=true;
            }
          }else peer.last=null;
        }
      }
      if(compatibilityChanged)this.api.events.emit('app:sync-compatibility-changed',await this.status());
      const previous=this.state.links;
      if(statusOnly&&!revoked.length)return this.status();
      if(revoked.length)this.state.links=previous.filter(peer=>!revoked.includes(peer));
      try{await this.persist();}
      catch(error){this.state.links=previous;throw error;}
      if(revoked.length)this.api.events.emit('app:sync-link-revoked');
    }finally{this.running=false;}
    const state=await this.status();
    if(!statusOnly)this.api.events.emit('app:sync-conflicts',state);
    return state;
  }
}
module.exports=MobileLocalSync;
