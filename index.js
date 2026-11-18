(() => {
  // EnterToSend 0.1.0 — experimental Endcord/Vendetta plugin.
  // Only calls an existing local send button; never sends through HTTP.
  const {metro, patcher, logger} = vendetta;
  const React = metro.common.React;
  const RN = metro.common.ReactNative;
  let enabled = false, removers = [], last = 0, warned = false;
  const log = message => logger?.log?.('[EnterToSend] ' + message);
  const alert = message => { if (!warned) { warned = true; RN.Alert.alert('EnterToSend', message); } };
  const getChannel = () => metro.findByStoreName?.('SelectedChannelStore') || metro.findByProps('getChannelId', 'getLastSelectedChannelId');
  let channels;
  const channel = () => channels?.getChannelId?.();
  const inputName = t => typeof t === 'string' ? t : t?.displayName || t?.name || t?.render?.displayName || t?.render?.name || t?.type?.displayName || t?.type?.name || '';
  const isComposer = (type,p) => {
    if (!p || p.editable === false || p.secureTextEntry || (typeof p.onChangeText !== 'function' && typeof p.onChange !== 'function')) return false;
    const name = inputName(type);
    const placeholder = p.placeholder;
    const identified = typeof placeholder === 'string' && /^message\s+(?:[#@].+|.+)$/i.test(placeholder.trim()) || /^(?:chatinput|messageinput)(?:textinput|textview|textbox|nativeinput)$/i.test(name);
    return identified && (type === RN.TextInput || /textinput|textview|textbox|nativeinput/i.test(name)) && p.multiline !== false;
  };
  const isSend = (p,t) => {
    if (!p || typeof p.onPress !== 'function') return false;
    return /^(send|send message)$/i.test(p.accessibilityLabel || '') || /^(ChatInputActionButtonSend|ChatInputSendButton|SendMessageButton)$/.test(inputName(t)) || /^(SendMessageIcon|SendIcon)$/.test(inputName(p.IconComponent));
  };
  function focusedFiber() {
    const f = RN.TextInput?.State?.currentlyFocusedInput?.();
    return f?._internalInstanceHandle || f?._internalFiberInstanceHandleDEV || f?._reactInternals || f?.__internalInstanceHandle;
  }
  function matchSend(fiber) {
    for (let parent = fiber?.return, depth = 0; parent && depth < 12; parent = parent.return, depth++) {
      const candidates = new Set(), seen = new Set();
      let count = 0;
      const walk = node => {
        if (!node || seen.has(node) || ++count > 400) return;
        seen.add(node);
        const p = node.memoizedProps;
        if (isSend(p,node.type) && !p.disabled && !p.accessibilityState?.disabled) { candidates.add(p.onPress); return; }
        for (let c = node.child; c && count <= 400; c = c.sibling) walk(c);
      };
      walk(parent);
      if (count > 400 || candidates.size > 1) return null;
      if (candidates.size === 1) return [...candidates][0];
    }
    return null;
  }
  function patchElement(args) {
    if (!enabled) return;
    const [type,p] = args;
    if (!isComposer(type,p)) return;
    const id = channel();
    if (!id) return;
    const original = p.onSubmitEditing;
    // Preserve the original event handler when the plugin is disabled or cannot find a safe target.
    args[1] = {...p, returnKeyType:'send', enterKeyHint:'send', submitBehavior:'submit', blurOnSubmit:false,
      onSubmitEditing(event) {
        if (!enabled || channel() !== id) return original?.(event);
        const text = event?.nativeEvent?.text;
        if (typeof text !== 'string' || !text.trim()) return;
        if (Date.now() - last < 400) return;
        let send;
        try { send = matchSend(focusedFiber()); } catch (_) {}
        if (!send) {
          // Don't call a guessed API or a stale button from another channel.
          alert('Could not find the active chat Send button on this build. Your draft was not sent. Use the normal Send button or disable the plugin.');
          return;
        }
        last = Date.now();
        try { Promise.resolve(send()).catch(() => alert('Discord rejected the Send action. Check your draft.')); }
        catch (_) { alert('The Send action failed. Check your draft.'); }
      }
    };
  }
  function attach(obj,key) {
    if (!obj || typeof obj[key] !== 'function') return false;
    try { removers.push(patcher.before(key,obj,args => { try { patchElement(args); } catch (_) {} })); return true; }
    catch (_) { return false; }
  }
  return {
    onLoad() {
      if (RN.Platform.OS !== 'ios') throw Error('This prototype is for iOS.');
      channels = getChannel();
      if (!channels?.getChannelId) throw Error('SelectedChannelStore not found');
      enabled = true;
      warned = false;
      const runtime = metro.findByProps('jsx','jsxs');
      const installed = [attach(React,'createElement'),attach(runtime,'jsx'),attach(runtime,'jsxs')].some(Boolean);
      if (!installed) { enabled = false; throw Error('No compatible React element factory found'); }
      log('Loaded. Reopen the chat.');
    },
    onUnload() { enabled = false; for (const remove of removers.splice(0)) { try { remove(); } catch (_) {} } }
  };
})()
