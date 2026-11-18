(() => {
  'use strict';
  // ReturnToSend v3: native DCDChatInput path, observed on Discord 344.1 (110861).
  // No network, account credentials, or message-content logging.
  const {metro, patcher, logger} = vendetta;
  const RN = metro.common.ReactNative, React = metro.common.React;
  const fn = x => typeof x === 'function';
  const names = t => typeof t === 'string' ? [t] : [t?.displayName,t?.name,t?.render?.displayName,t?.render?.name,t?.type?.displayName,t?.type?.name].filter(Boolean);
  const offs = [], wrapped = new WeakSet(), shapes = new Set();
  let active = false, session = null, pending = null, reportTimer, channels, hooks = 0, seen = 0, changes = 0, recognized = 0, candidates = 0, requests = 0, attempts = 0, failures = 0, suppressed = 0;
  const log = s => { try { logger?.log?.('[ReturnToSend v3] '+s); } catch (_) {} };
  const toast = s => {log(s); try{vendetta.ui?.toasts?.showToast?.(s);}catch(_){} };
  const channel = () => { try{return channels?.getChannelId?.() ?? null;}catch(_){return null;} };
  const sameChannel = s => { const c=channel(); return s.channel == null || c === s.channel; };
  const clearPending = () => { if(pending) clearTimeout(pending.timer); pending=null; };
  const reset = () => {clearPending(); session=null;};
  function eventTarget(args) {
    for (const a of args) {
      for (const v of [a?.nativeEvent?.target,a?.target,a?.nativeEvent?.reactTag,a?.reactTag]) {
        if(typeof v==='number' || typeof v==='string') return v;
      }
    }
    return null;
  }
  function recordShape(args) {
    if(shapes.size >= 12) return;
    const keys = o => Object.keys(o).filter(k=>/^[a-zA-Z_][a-zA-Z_0-9]{0,44}$/.test(k)).sort().slice(0,25).join(',');
    shapes.add(args.map(a => typeof a==='object' && a ? '{'+keys(a)+(a.nativeEvent && typeof a.nativeEvent==='object'?' | nativeEvent: '+keys(a.nativeEvent):'')+'}' : typeof a).join(' / '));
  }
  function snapshot(args) {
    const textKeys=['text','plainText','newText','textValue','textContent','value','content','string','rawText'];
    for(const a of args) {
      const objects=[a?.nativeEvent,a,a?.nativeEvent?.data,a?.data,a?.nativeEvent?.text,a?.text].filter(x=>x && typeof x==='object');
      for(const o of objects) {
        const k=textKeys.find(k=>typeof o[k]==='string');
        if(!k) continue;
        const sel=o.selection ?? o.selectedRange ?? a?.nativeEvent?.selection ?? a?.selection;
        const start=sel?.start ?? sel?.location ?? o.selectionStart ?? o.start;
        const end=sel?.end ?? (typeof sel?.location==='number' && typeof sel?.length==='number'?sel.location+sel.length:undefined) ?? o.selectionEnd ?? o.end;
        const composition=o.isComposing===true || o.composing===true || o.markedTextRange!=null;
        return {text:o[k],start:typeof start==='number'?start:null,end:typeof end==='number'?end:null,composition};
      }
      if(typeof a==='string') {
        const sel=args[1];
        return {text:a,start:typeof sel?.start==='number'?sel.start:null,end:typeof sel?.end==='number'?sel.end:null,composition:false};
      }
    }
    return null;
  }
  function matchTarget(s,args) {
    const t=eventTarget(args);
    if(t!==null && s.target!==null && t!==s.target) return false;
    if(s.target===null && t!==null) s.target=t;
    return true;
  }
  function status() {
    return ['ReturnToSend v3','Hooks: '+hooks,'Native composer renders: '+seen,'Focus: '+(session?'yes':'no'),'Text events: '+changes,'Recognized text events: '+recognized,'Return candidates: '+candidates,'Native send requests: '+requests,'Fallback attempts: '+attempts,'Suppressed: '+suppressed,'Callback failures: '+failures,'Event shapes (keys only):',...shapes].join('\n');
  }
  function report() {
    if(!active) return;
    const s=status();
    try { RN.Alert.alert('ReturnToSend v3 diagnostics',s,[{text:'Copy report',onPress:()=>{try{const c=RN.Clipboard??metro.findByProps('setString','getString');c?.setString?.(s);}catch(_){}}},{text:'Close',style:'cancel'}]); }catch(_) {log(s);}
  }
  function modify(t,p) {
    if(!active || !p || !names(t).includes('DCDChatInput') || !fn(p.onSelectionOrTextChange) || !fn(p.onRequestSend) || wrapped.has(p.onSelectionOrTextChange)) return null;
    seen++;
    const change=p.onSelectionOrTextChange, send=p.onRequestSend, focus=p.onBeginFocus, blur=p.onEndBlur, paste=p.onPasteCommand, image=p.onPasteImage;
    const wrapChange=function(...args) {
      if(!active) return change.apply(this,args);
      changes++; recordShape(args);
      const snap=snapshot(args);
      if(snap) recognized++;
      let s=session;
      if(!s || !sameChannel(s) || !matchTarget(s,args) || p.editable===false) return change.apply(this,args);
      if(!snap) { clearPending(); s.previous=null; return change.apply(this,args); }
      const old=s.previous; s.previous=snap.text;
      if(old!==snap.text) clearPending();
      const isReturn=old!==null && old.trim().length>0 && snap.text===old+'\n' && !snap.composition && (snap.start===null||snap.start===snap.text.length) && (snap.end===null||snap.end===snap.text.length);
      if(isReturn) candidates++;
      const canSend=isReturn && Date.now()>=s.pasteUntil && Date.now()>=s.blockUntil && !/^\s*\//.test(old);
      if(isReturn&&!canSend) suppressed++;
      const requestBefore=requests;
      // Preserve Discord's normal draft synchronization before invoking its own native send handler.
      const result=change.apply(this,args);
      if(!canSend || !active || session!==s || requests!==requestBefore) return result;
      // Do not retain a pooled React synthetic event across turns.
      // Supply only native metadata; native send handlers normally don't require a text-change event.
      const target=eventTarget(args);
      const event={nativeEvent:target===null?{}:{target},target,currentTarget:target,preventDefault(){},stopPropagation(){}};
      const ctx=this;
      const job={timer:null};
      job.timer=setTimeout(()=>{
        if(pending!==job) return; pending=null;
        if(!active || session!==s || !sameChannel(s) || s.previous!==snap.text || requests!==requestBefore || Date.now()<s.pasteUntil || Date.now()<s.blockUntil) return;
        s.blockUntil=Date.now()+600; attempts++;
        try {
          const ret=send.call(ctx,event);
          if(ret && fn(ret.catch)) ret.catch(()=>{failures++;toast('Return send failed; use Discord Send.');});
          log('Invoked DCDChatInput.onRequestSend');
        } catch(_) {failures++;toast('Return send failed; use Discord Send.');}
      },0);
      pending=job;
      return result;
    };
    wrapped.add(wrapChange);
    return {...p,
      onSelectionOrTextChange:wrapChange,
      onRequestSend:function(...args){if(active){requests++;clearPending();if(session){session.blockUntil=Date.now()+600;}}return send.apply(this,args);},
      onBeginFocus:function(...args){if(active){reset();session={target:eventTarget(args),channel:channel(),previous:null,pasteUntil:0,blockUntil:0};}return focus?.apply(this,args);},
      onEndBlur:function(...args){if(active && session && matchTarget(session,args)) reset();return blur?.apply(this,args);},
      ...(fn(paste)?{onPasteCommand:function(...args){if(active&&session){session.pasteUntil=Date.now()+900;clearPending();}return paste.apply(this,args);}}:{}),
      ...(fn(image)?{onPasteImage:function(...args){if(active&&session){session.pasteUntil=Date.now()+900;clearPending();}return image.apply(this,args);}}:{})
    };
  }
  function attach(obj,key) {
    if(!obj||!fn(obj[key]))return;
    try{const off=patcher.before(key,obj,args=>{if(!active)return;try{const next=modify(args[0],args[1]);if(next)args[1]=next;}catch(_){log('Composer hook failed');}});if(fn(off))offs.push(off);hooks++;}catch(_){}
  }
  return {onLoad(){
    if(active||RN.Platform.OS!=='ios')return;
    active=true; hooks=seen=changes=recognized=candidates=requests=attempts=failures=suppressed=0;shapes.clear();reset();
    try{channels=metro.findByStoreName?.('SelectedChannelStore') ?? metro.findByProps('getChannelId','getLastSelectedChannelId');}catch(_){}
    attach(React,'createElement');
    let rt;try{rt=metro.findByProps('jsx','jsxs');}catch(_){}
    for(const k of ['jsx','jsxs','jsxDEV'])attach(rt,k);
    if(!hooks){active=false;throw new Error('No React creation hooks available');}
    toast('ReturnToSend v3 enabled. Reopen a chat and focus keyboard.');
    reportTimer=setTimeout(()=>{if(active && (attempts===0 || failures>0))report();},30000);
  },onUnload(){active=false;reset();clearTimeout(reportTimer);for(const off of offs.splice(0)){try{off();}catch(_){}}}};
})()
