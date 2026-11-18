(() => {
  'use strict';
  const {metro, patcher} = vendetta;
  const RN = metro.common.ReactNative, React = metro.common.React;
  const offs = [], samples = new Set(), focused = new Set(), hooks = [];
  let active = false, interval, timeout;
  const fn = x => typeof x === 'function';
  const name = t => typeof t === 'string' ? t : (t?.displayName || t?.name || t?.render?.displayName || t?.render?.name || t?.type?.displayName || t?.type?.name || '?');
  const safeName = t => String(name(t)).replace(/[^\w.$-]/g,'?').slice(0,70);
  function shape(p) {
    if (!p || typeof p !== 'object') return '';
    return Object.keys(p).filter(k => /^(on|.*(?:keyboard|submit|return|text|send|input|focus|multiline|placeholder|editable|value|selection|accessibility|testid))/i.test(k)).sort().slice(0,30).join(',');
  }
  function see(t,p) {
    if (!p || p.secureTextEntry || samples.size >= 18) return;
    if (t === RN.TextInput || /text.?input|text.?view|composer|chat.?input|message.?input/i.test(name(t)) || (p.multiline && (fn(p.onChange) || fn(p.onChangeText) || fn(p.onTextChange)))) samples.add(safeName(t)+' ['+shape(p)+']');
  }
  function patch(o,k,cb) {
    if (!o || !fn(o[k])) return;
    try { const off = patcher.before(k,o,args => { if(active) try { cb(args); } catch (_) {} }); if(fn(off)) offs.push(off); hooks.push(k); } catch (_) {}
  }
  function fiberOf(o) {
    if (!o || typeof o !== 'object') return null;
    if ('memoizedProps' in o && 'return' in o) return o;
    for (const k of ['_internalInstanceHandle','_internalFiberInstanceHandleDEV','_reactInternals','__internalInstanceHandle','_internalFiberInstanceHandle', ...Object.keys(o).filter(k => /^__reactFiber\$/.test(k))]) {
      const f = o[k]; if(f && typeof f === 'object' && 'memoizedProps' in f) return f;
    }
    return null;
  }
  function poll() {
    try {
      const host = RN.TextInput?.State?.currentlyFocusedInput?.();
      if (!host || focused.size >= 3) return;
      const f = fiberOf(host);
      if (!f) { focused.add('Focused host exists; no exposed fiber.'); return; }
      const chain = [];
      let parent=f;
      for(let i=0; parent && i<12; i++,parent=parent.return) chain.push(safeName(parent.type)+' ['+shape(parent.memoizedProps)+']');
      // Only metadata about possible send controls; no labels, text, IDs or props values.
      let send = [], count=0;
      const seen=new Set();
      function walk(n) {
        if(!n || seen.has(n) || count++>=220 || send.length>=8) return;
        seen.add(n); const p=n.memoizedProps;
        if(p && fn(p.onPress) && (/send/i.test(name(n.type)) || /^(send|send message)$/i.test(typeof p.accessibilityLabel==='string'?p.accessibilityLabel:'') || /send/i.test(name(p.IconComponent)))) send.push(safeName(n.type)+' ['+shape(p)+']');
        for(let c=n.child;c&&count<220;c=c.sibling) walk(c);
      }
      parent=f; for(let i=0;parent&&i<8;i++,parent=parent.return) { walk(parent); if(send.length) break; }
      focused.add(chain.join('\n')+'\nNearby send controls: '+(send.join('; ')||'none found'));
    } catch (_) {}
  }
  function report() {
    if(!active)return; poll(); clearInterval(interval);
    const result = ['Return Probe 1','Hooks: '+(hooks.join(', ')||'none'),'Focused input: '+(Array.from(focused).join('\n---\n')||'none exposed'),'Observed inputs:\n'+(Array.from(samples).join('\n')||'none')].join('\n\n');
    const copy=()=>{try{const c=RN.Clipboard; if(fn(c?.setString)){c.setString(result);return;} const m=metro.findByProps('setString','getString'); if(fn(m?.setString)){m.setString(result);return;}}catch(_){} try{RN.Alert.alert('Copy unavailable',result.slice(0,3500));}catch(_){} };
    RN.Alert.alert('Return Probe results',result.slice(0,2600),[{text:'Copy full report',onPress:copy},{text:'Close',style:'cancel'}]);
  }
  return {onLoad(){ if(active)return; if(RN.Platform.OS!=='ios')return; active=true; samples.clear();focused.clear();hooks.length=0;
    patch(React,'createElement',a=>see(a[0],a[1]));
    let rt;try{rt=metro.findByProps('jsx','jsxs');}catch(_){}
    for(const k of ['jsx','jsxs','jsxDEV']) patch(rt,k,a=>see(a[0],a[1]));
    patch(RN.TextInput,'render',a=>see(RN.TextInput,a[0]));
    interval=setInterval(poll,350);timeout=setTimeout(report,20000);
  },onUnload(){active=false;clearInterval(interval);clearTimeout(timeout);for(const off of offs.splice(0)){try{off();}catch(_){}}}};
})()
