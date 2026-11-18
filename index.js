(() => {
  'use strict';
  // EnterToSend 0.2.0 - Endcord/Vendetta compatibility plugin, iOS only.
  // Uses local composer callbacks only. No API requests or credential access.
  const { metro, patcher, logger } = vendetta;
  const React = metro.common.React;
  const RN = metro.common.ReactNative;
  const undo = [];
  const wrapped = new WeakSet();
  let active = false, channels, timer, matched = false, warned = false;
  const tag = '[EnterToSend] ';
  const log = (s) => { try { logger?.log?.(tag + s); } catch (_) {} };
  const toast = (s) => {
    log(s);
    try { vendetta.ui?.toasts?.showToast?.(tag + s); } catch (_) {}
  };
  const warn = (s) => {
    log(s);
    if (warned) return;
    warned = true;
    try { RN.Alert.alert('EnterToSend', s); } catch (_) {}
  };
  const currentChannel = () => { try { return channels?.getChannelId?.(); } catch (_) {} };
  const fn = (v) => typeof v === 'function';
  const name = (t) => typeof t === 'string' ? t : [t?.displayName,t?.name,t?.render?.displayName,t?.render?.name,t?.type?.displayName,t?.type?.name].filter(Boolean).join(' ');
  const strings = (p) => [p?.placeholder,p?.accessibilityLabel,p?.testID,p?.nativeID].filter(v => typeof v === 'string').join(' ');
  const inputName = /text.?input|text.?view|text.?area|text.?box|native.?input|chat.?input|message.?input|composer/i;
  const chatName = /(?:chat|message).?(?:input|composer|textbox|textarea)|chatbar|channeltextinput/i;
  const chatLabel = /^(?:message(?:\s|$|…|\.)|send (?:a )?message|type (?:a |your )?message|write (?:a |your )?message)/i;
  const rejected = /search|password|email|username|nickname|edit.?message|edit.?profile|bio|topic/i;
  function isComposer(t,p,forceInput) {
    if (!p || p.editable === false || p.secureTextEntry || p.multiline === false) return false;
    if (!(fn(p.onChangeText) || fn(p.onChange) || fn(p.onTextChange))) return false;
    const n = name(t), labels = strings(p);
    if (rejected.test(n) || rejected.test(p.testID || '') || rejected.test(p.accessibilityLabel || '')) return false;
    const textLike = forceInput || t === RN.TextInput || inputName.test(n) || p.multiline === true;
    return textLike && (chatName.test(n) || chatName.test(p.testID || '') || chatName.test(p.nativeID || '') || [p.placeholder,p.accessibilityLabel].some(v => typeof v === 'string' && chatLabel.test(v.trim())));
  }
  function fiberOf(o) {
    if (!o || typeof o !== 'object') return null;
    if (o.memoizedProps && ('return' in o || 'child' in o)) return o;
    for (const k of ['_targetInst','_internalInstanceHandle','_internalFiberInstanceHandleDEV','_reactInternals','__internalInstanceHandle','_internalFiberInstanceHandle']) {
      const x = o[k];
      if (x && typeof x === 'object' && 'memoizedProps' in x) return x;
    }
    for (const k of Object.keys(o)) {
      if (/^__reactFiber\$/.test(k) && o[k]?.memoizedProps) return o[k];
    }
    return null;
  }
  function mounted(f) {
    if (!f) return null;
    let root = f, hops = 0;
    while (root.return && hops++ < 100) root = root.return;
    const current = root.stateNode?.current;
    if (!current || root === current) return f;
    if (root.alternate === current && f.alternate) return f.alternate;
    return null;
  }
  function focused(event, saved) {
    let host;
    try { host = RN.TextInput?.State?.currentlyFocusedInput?.(); } catch (_) {}
    return mounted(fiberOf(host) || fiberOf(event?._targetInst) || fiberOf(event?.currentTarget) || fiberOf(event?.target) || saved);
  }
  function sendButton(f) {
    const p = f?.memoizedProps;
    if (!p || !fn(p.onPress) || p.disabled || p.accessibilityState?.disabled) return null;
    const labels = [p.accessibilityLabel,p['aria-label'],p.testID,p.nativeID];
    const named = /^(?:ChatInputActionButtonSend|ChatInputSendButton|SendMessageButton|MessageSendButton|ComposerSendButton)$/i;
    const icon = /^(?:SendMessageIcon|SendIcon|PaperPlaneIcon)$/i;
    if (labels.some(v => typeof v === 'string' && /^(?:send|send message|send_message|send-message|chat[-_]?input[-_]?send(?:[-_]?button)?)$/i.test(v.trim())) || name(f.type).split(' ').some(v => named.test(v)) || name(p.IconComponent || p.icon?.type || p.icon).split(' ').some(v => icon.test(v))) return p.onPress;
    return null;
  }
  function nearbySend(fiber) {
    // Only use nearest common subtree. Never search the entire app or reuse a callback from another chat.
    for (let parent = fiber?.return, level = 0; parent && level < 14; parent = parent.return, level++) {
      let visited = 0, overflow = false;
      const found = new Set(), seen = new Set();
      function walk(node) {
        if (!node || seen.has(node) || overflow) return;
        if (++visited > 220) { overflow = true; return; }
        seen.add(node);
        const handler = sendButton(node);
        if (handler) { found.add(handler); return; }
        for (let child = node.child; child && !overflow; child = child.sibling) walk(child);
      }
      walk(parent);
      if (overflow || found.size > 1) return null;
      if (found.size === 1) return [...found][0];
    }
    return null;
  }
  function modify(type,p,forceInput = false) {
    if (!active || !isComposer(type,p,forceInput) || wrapped.has(p.onSubmitEditing)) return null;
    const origSubmit = p.onSubmitEditing, origKey = p.onKeyPress, origFocus = p.onFocus;
    const renderChannel = currentChannel();
    let savedFiber, last = 0;
    const isEnter = e => ['Enter','Return','\n'].includes(e?.nativeEvent?.key ?? e?.key);
    function send(event, fromKey) {
      if (!active) return fromKey ? origKey?.(event) : origSubmit?.(event);
      const id = currentChannel();
      if (!id || (renderChannel && id !== renderChannel)) { log('Skipped: channel changed or unavailable.'); return; }
      const text = event?.nativeEvent?.text ?? (typeof p.value === 'string' ? p.value : undefined);
      if (typeof text === 'string' && !text.trim()) return;
      const now = Date.now();
      if (now - last < 500) return;
      last = now;
      try {
        const button = nearbySend(focused(event,savedFiber));
        if (button) {
          log('Invoking active composer Send button.');
          return Promise.resolve(button()).catch(e => warn('Send callback failed. Use the regular Send button. ' + String(e)));
        }
        // If Discord exposes its own hardware handler, route the Return press through it.
        if (fn(origKey)) {
          log('Using composer hardware Enter handler.');
          const nativeEvent = { ...(event?.nativeEvent || {}), key: 'Enter' };
          const keyEvent = { ...event, nativeEvent, key: 'Enter', preventDefault: () => event?.preventDefault?.(), stopPropagation: () => event?.stopPropagation?.() };
          return origKey(fromKey ? event : keyEvent);
        }
        if (fn(origSubmit)) { log('Using original composer submit handler.'); return origSubmit(event); }
        warn('The keyboard hook works, but this Discord build did not expose a Send callback. Your draft was not sent. Use the normal Send button.');
      } catch (e) { warn('Send hook failed. Use the normal Send button. ' + String(e)); }
    }
    const submit = e => send(e,false);
    wrapped.add(submit);
    if (!matched) { matched = true; toast('Chat keyboard detected.'); }
    const out = { ...p, returnKeyType:'send', enterKeyHint:'send', submitBehavior:'submit', blurOnSubmit:true,
      onSubmitEditing: submit,
      onFocus(e) {
        savedFiber = focused(e,null);
        return origFocus?.(e);
      }
    };
    // An existing native/hardware key handler may fire before submit. Route it once.
    if (fn(origKey)) out.onKeyPress = e => {
      if (!active || !isEnter(e)) return origKey(e);
      return send(e,true);
    };
    return out;
  }
  function attach(obj,key,callback) {
    if (!obj || !fn(obj[key])) return false;
    try {
      const off = patcher.before(key,obj,args => {
        if (!active) return;
        try { callback(args); } catch (e) { log(key + ' hook: ' + String(e)); }
      });
      if (fn(off)) undo.push(off);
      return true;
    } catch (e) { log('Cannot patch ' + key + ': ' + String(e)); return false; }
  }
  function factory(obj,key) { return attach(obj,key,args => { const next = modify(args[0],args[1]); if (next) args[1] = next; }); }
  function load() {
    if (active) return;
    if (RN.Platform.OS !== 'ios') return;
    active = true; matched = false; warned = false;
    try { channels = metro.findByStoreName?.('SelectedChannelStore') || metro.findByProps('getChannelId','getLastSelectedChannelId'); } catch (_) {}
    if (!fn(channels?.getChannelId)) { active = false; throw new Error('SelectedChannelStore unavailable on this build'); }
    let n = 0;
    if (factory(React,'createElement')) n++;
    let runtime, devRuntime;
    try { runtime = metro.findByProps('jsx','jsxs'); } catch (_) {}
    try { devRuntime = metro.findByProps('jsxDEV'); } catch (_) {}
    for (const key of ['jsx','jsxs','jsxDEV']) if (factory(runtime,key)) n++;
    if (devRuntime !== runtime && factory(devRuntime,'jsxDEV')) n++;
    // React Native forwardRef render catches cached JSX factory paths too.
    if (attach(RN.TextInput,'render',args => { const next = modify(RN.TextInput,args[0],true); if (next) args[0] = next; })) n++;
    if (!n) { active = false; throw new Error('No patchable React keyboard hooks'); }
    log('Loaded with ' + n + ' hooks. Open a chat and focus its input.');
    timer = setTimeout(() => { if (active && !matched) toast('No chat input detected yet. Switch chats or reopen Discord.'); },18000);
  }
  function unload() {
    active = false;
    clearTimeout(timer);
    for (const off of undo.splice(0)) { try { off(); } catch (_) {} }
  }
  return { onLoad:load, onUnload:unload };
})()
