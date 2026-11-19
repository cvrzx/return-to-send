(() => {
  'use strict';
  // ReturnToSend v7: native DCDChatInput path, observed on Discord 344.1 (110861).
  // No network, account credentials, or message-content logging.
  const {metro, patcher} = vendetta;
  const RN = metro.common.ReactNative, React = metro.common.React;
  const fn = x => typeof x === 'function';
  const names = t => typeof t === 'string' ? [t] : [t?.displayName,t?.name,t?.render?.displayName,t?.render?.name,t?.type?.displayName,t?.type?.name].filter(Boolean);
  const offs = [], wrapped = new WeakSet(), shapes = new Set();
  let active = false, session = null, pending = null, channels, hooks = 0, seen = 0, changes = 0, recognized = 0, candidates = 0, requests = 0, diagnosticRequests = 0, attempts = 0, failures = 0, suppressed = 0, cancelled = 0, batched = 0, flushed = 0, middle = 0;
  const storage = vendetta.plugin?.storage;
  let diagnostics = false, hookFailures = 0;
  try { diagnostics = storage?.diagnosticsEnabled === true; } catch (_) {}
  function resetDiagnostics() {
    seen=changes=recognized=candidates=diagnosticRequests=attempts=failures=suppressed=cancelled=batched=flushed=middle=hookFailures=0;
    shapes.clear();
  }
  function setDiagnostics(value) {
    diagnostics = value === true;
    resetDiagnostics();
    try { if(storage) storage.diagnosticsEnabled=diagnostics; } catch (_) {}
  }
  const channel = () => { try{return channels?.getChannelId?.() ?? null;}catch(_){return null;} };
  const sameChannel = s => { const c=channel(); return s.channel == null || c === s.channel; };
  // A microtask cannot be cancelled, so its job token is invalidated instead.
  const clearPending = () => { if(pending){if(diagnostics)cancelled++; if(pending.timer!=null)clearTimeout(pending.timer);} pending=null; };
  const dispatch = (job, run) => {
    if(typeof queueMicrotask==='function') queueMicrotask(run);
    else if(typeof Promise==='function') Promise.resolve().then(run);
    else job.timer=setTimeout(run,0);
  };
  // Preserve normal microtask timing, but flush an already recognized Return
  // before the next distinct edit reaches Discord's draft synchronizer.
  const flushPending = () => {
    const job=pending;
    if(!job) return;
    if(job.timer!=null) clearTimeout(job.timer);
    if(diagnostics)flushed++;
    job.run();
  };
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
    if(!diagnostics || shapes.size >= 12) return;
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
    return ['ReturnToSend v7','Hooks: '+hooks,'Native composer renders: '+seen,'Focus: '+(session?'yes':'no'),'Text events: '+changes,'Recognized text events: '+recognized,'Return candidates: '+candidates,'Native send requests: '+diagnosticRequests,'Fallback attempts: '+attempts,'Suppressed: '+suppressed,'Cancelled pending sends: '+cancelled,'Batched Return edits: '+batched,'Early send flushes: '+flushed,'Return inside draft: '+middle,'Callback failures: '+failures,'Composer hook failures: '+hookFailures,'Event shapes (keys only):',...shapes].join('\n');
  }
  // Native React Native settings UI; no automatic alerts, toasts, or log output.
  function Settings() {
    const [enabled, updateEnabled] = React.useState(diagnostics);
    const [report, updateReport] = React.useState(()=>diagnostics?status():'');
    const [notice, updateNotice] = React.useState('');
    const h=React.createElement;
    const txt=(value,style={})=>h(RN.Text,{style:{color:'#f2f3f5',fontSize:15,...style}},value);
    const button=(label,action)=>h(RN.TouchableOpacity,{accessibilityRole:'button',onPress:action,style:{backgroundColor:'#404249',borderRadius:8,padding:14,marginTop:10}},txt(label,{fontWeight:'600',textAlign:'center'}));
    const refresh=()=>{updateReport(diagnostics?status():'');updateNotice('');};
    const toggle=value=>{setDiagnostics(value);updateEnabled(diagnostics);refresh();};
    const copy=()=>{
      if(!diagnostics)return;
      const current=status();updateReport(current);
      try {
        const c=RN.Clipboard??metro.common.clipboard??metro.findByProps('setString','getString');
        if(!fn(c?.setString))throw new Error('Clipboard not available');
        c.setString(current);updateNotice('Report copied.');
      }catch(_){updateNotice('Clipboard unavailable. Select the report text to copy manually.');}
    };
    return h(RN.ScrollView,{style:{flex:1},contentContainerStyle:{padding:16,paddingBottom:40}},
      h(RN.View,{style:{backgroundColor:'#242529',borderRadius:12,padding:16}},
        txt('ReturnToSend v7',{fontSize:20,fontWeight:'bold'}),
        txt('Native iOS Return-to-send · no artificial cooldown',{color:'#b5bac1',marginTop:6}),
        txt('Diagnostics',{fontSize:17,fontWeight:'600',marginTop:24}),
        h(RN.View,{style:{flexDirection:'row',alignItems:'center',marginTop:12}},
          h(RN.View,{style:{flex:1,paddingRight:12}},txt('Enable diagnostics',{fontWeight:'600'}),txt('Collect event counts and event key names only. No message contents.',{color:'#b5bac1',fontSize:13,marginTop:5})),
          h(RN.Switch,{accessibilityLabel:'Enable diagnostics',value:enabled,onValueChange:toggle,trackColor:{true:'#5865f2'}})),
        txt(enabled?'Diagnostics enabled. Reproduce the issue, then return here and refresh.':'Diagnostics disabled. Return-to-send remains active.',{color:'#b5bac1',fontSize:13,marginTop:14}),
        ...(enabled?[button('Refresh report',refresh),button('Copy report',copy),button('Reset report',()=>{resetDiagnostics();refresh();updateNotice('Report reset.');}),txt('Diagnostic report',{fontWeight:'600',marginTop:20}),h(RN.Text,{selectable:true,style:{color:'#dbdee1',backgroundColor:'#17181b',borderRadius:8,padding:12,marginTop:8,fontSize:12,fontFamily:RN.Platform.OS==='ios'?'Menlo':'monospace'}},report),notice?txt(notice,{color:'#b5bac1',marginTop:10}):null]:[]),
        txt('Reports stay on your device unless you copy and share them. No automatic popups.',{color:'#b5bac1',fontSize:13,marginTop:20})
      ));
  }
  function modify(t,p) {
    if(!active || !p || !names(t).includes('DCDChatInput') || !fn(p.onSelectionOrTextChange) || !fn(p.onRequestSend) || wrapped.has(p.onSelectionOrTextChange)) return null;
    if(diagnostics)seen++;
    const change=p.onSelectionOrTextChange, send=p.onRequestSend, focus=p.onBeginFocus, blur=p.onEndBlur, paste=p.onPasteCommand, image=p.onPasteImage;
    const wrapChange=function(...args) {
      if(!active) return change.apply(this,args);
      if(diagnostics)changes++; recordShape(args);
      const snap=snapshot(args);
      if(snap) if(diagnostics)recognized++;
      let s=session;
      if(!s || !sameChannel(s) || !matchTarget(s,args) || p.editable===false) return change.apply(this,args);
      if(!snap) { clearPending(); s.previous=null; return change.apply(this,args); }
      // A selection-only event must not cancel the pending request. A new
      // nonempty edit must be processed AFTER the preceding send request.
      // Empty/unknown edits, paste, blur, channel changes and real native sends
      // still invalidate stale work rather than accidentally sending a draft.
      if(pending && snap.text!==s.previous) {
        if(snap.text.length===0 || snap.composition || Date.now()<s.pasteUntil) clearPending();
        else flushPending();
      }
      if(!active || session!==s || !sameChannel(s)) return change.apply(this,args);
      const old=s.previous; s.previous=snap.text;
      const changed=old!==snap.text;
      const fromPaste=Date.now()<s.pasteUntil;
      if(changed) s.pasteUntil=0;
      if(s.sentText!==null && !snap.text.startsWith(s.sentText)) s.sentText=null;
      const sameSentDraft=s.sentText!==null && /^\n*$/.test(snap.text.slice(s.sentText.length));
      // Detect a single appended Return, including coalesced typed characters.
      let draft=snap.text.endsWith('\n')?snap.text.slice(0,-1):null;
      let appended=old!==null && draft!==null && draft.startsWith(old) ? draft.slice(old.length) : null;
      let isReturn=changed && appended!==null && !appended.includes('\n') && !appended.includes('\r') && draft.trim().length>0 && !snap.composition;
      // Also recognize exactly one inserted newline inside an existing draft.
      // Use the reported cursor only when the event provides one; otherwise
      // find the first mismatch. Do not treat multi-character pastes as Return.
      if(!isReturn && changed && old!==null && !snap.composition && snap.text.length===old.length+1 && old.trim().length>0) {
        let pos=0;
        while(pos<old.length && old[pos]===snap.text[pos]) pos++;
        if(snap.text[pos]==='\n' && snap.text.slice(0,pos)+snap.text.slice(pos+1)===old) {
          draft=old; appended=''; isReturn=true; if(diagnostics)middle++;
        }
      }
      if(isReturn){if(diagnostics)candidates++;if(appended.length)if(diagnostics)batched++;}
      const canSend=isReturn && !fromPaste && !sameSentDraft && !/^\s*\//.test(draft);
      if(isReturn&&!canSend) if(diagnostics)suppressed++;
      const requestBefore=requests;
      // Preserve Discord's normal draft synchronization before invoking its own native send handler.
      const result=change.apply(this,args);
      if(!canSend || !active || session!==s || requests!==requestBefore) return result;
      // Dispatch as a microtask, after the normal draft update, before queued timers.
      // Never send an outdated draft if the composer changed or lost focus.
      // Do not retain a pooled React synthetic event across turns.
      // Supply only native metadata; native send handlers normally don't require a text-change event.
      const target=eventTarget(args);
      const event={nativeEvent:target===null?{}:{target},target,currentTarget:target,preventDefault(){},stopPropagation(){}};
      const ctx=this;
      const job={timer:null,run:null};
      pending=job;
      job.run=()=>{
        if(pending!==job) return; pending=null;
        if(!active || session!==s || !sameChannel(s) || s.previous!==snap.text || requests!==requestBefore || Date.now()<s.pasteUntil) return;
        s.sentText=snap.text; if(diagnostics)attempts++;
        try {
          const ret=send.call(ctx,event);
          if(ret && fn(ret.catch)) ret.catch(()=>{if(session===s && s.sentText===snap.text)s.sentText=null;if(diagnostics)failures++;});
        } catch(_) {if(session===s && s.sentText===snap.text)s.sentText=null;if(diagnostics)failures++;}
      };
      dispatch(job,job.run);
      return result;
    };
    wrapped.add(wrapChange);
    return {...p,
      onSelectionOrTextChange:wrapChange,
      onRequestSend:function(...args){if(active){requests++;if(diagnostics)diagnosticRequests++;clearPending();}return send.apply(this,args);},
      onBeginFocus:function(...args){if(active){reset();session={target:eventTarget(args),channel:channel(),previous:null,pasteUntil:0,sentText:null};}return focus?.apply(this,args);},
      onEndBlur:function(...args){if(active && session && matchTarget(session,args)) reset();return blur?.apply(this,args);},
      ...(fn(paste)?{onPasteCommand:function(...args){if(active&&session){session.pasteUntil=Date.now()+900;clearPending();}return paste.apply(this,args);}}:{}),
      ...(fn(image)?{onPasteImage:function(...args){if(active&&session){session.pasteUntil=Date.now()+900;clearPending();}return image.apply(this,args);}}:{})
    };
  }
  function attach(obj,key) {
    if(!obj||!fn(obj[key]))return;
    try{const off=patcher.before(key,obj,args=>{if(!active)return;try{const next=modify(args[0],args[1]);if(next)args[1]=next;}catch(_){if(diagnostics)hookFailures++;}});if(fn(off))offs.push(off);hooks++;}catch(_){}
  }
  return {settings:Settings,onLoad(){
    if(active||RN.Platform.OS!=='ios')return;
    active=true; hooks=requests=0;reset();resetDiagnostics();
    try{channels=metro.findByStoreName?.('SelectedChannelStore') ?? metro.findByProps('getChannelId','getLastSelectedChannelId');}catch(_){}
    attach(React,'createElement');
    let rt;try{rt=metro.findByProps('jsx','jsxs');}catch(_){}
    for(const k of ['jsx','jsxs','jsxDEV'])attach(rt,k);
    if(!hooks){active=false;throw new Error('No React creation hooks available');}
  },onUnload(){active=false;reset();for(const off of offs.splice(0)){try{off();}catch(_){}}}};
})()
