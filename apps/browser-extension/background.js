const NMH_HOST = 'dev.keysmith.desktop';
const RPC_TIMEOUT_MS = 18000;
const NEVER_SAVE_KEY = 'neverSaveOrigins';
const TAKEOVER_BROWSER_PM_KEY = 'takeoverBrowserPasswordManager';

let nextRpcId = 1;

function rpcRaw(method, params = {}, timeoutMs = RPC_TIMEOUT_MS) {
  return new Promise((resolve) => {
    const id = nextRpcId;
    nextRpcId += 1;

    let port;
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        try {
          port?.disconnect();
        } catch {
          // Ignore disconnect errors
        }
        resolve({ connected: false, ok: false, error: '连接 Keysmith 桌面端超时' });
      }
    }, timeoutMs);

    try {
      port = chrome.runtime.connectNative(NMH_HOST);
    } catch (err) {
      clearTimeout(timer);
      resolve({
        connected: false,
        ok: false,
        error: err?.message || '无法连接 Keysmith Native Messaging 主机'
      });
      return;
    }

    port.onMessage.addListener((msg) => {
      if (settled) return;
      if (!msg || (msg.id !== id && msg.id !== 0)) return;
      settled = true;
      clearTimeout(timer);
      try {
        port.disconnect();
      } catch {
        // Ignore disconnect errors
      }
      resolve({
        connected: true,
        ok: Boolean(msg.ok),
        result: msg.result,
        error: msg.error
      });
    });

    port.onDisconnect.addListener(() => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const lastErr = chrome.runtime.lastError?.message;
      resolve({
        connected: false,
        ok: false,
        error: lastErr || 'Keysmith 桌面端未运行或 Native Messaging Host 未配置'
      });
    });

    try {
      port.postMessage({ id, method, params });
    } catch (err) {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve({
          connected: false,
          ok: false,
          error: err?.message || '发送 Native Messaging 请求失败'
        });
      }
    }
  });
}

function isWebUrl(url) {
  return typeof url === 'string' && (url.startsWith('http://') || url.startsWith('https://'));
}

async function setBadgeForTab(tabId, text, color) {
  if (!tabId || tabId < 0) return;
  try {
    await chrome.action.setBadgeText({ tabId, text: text || '' });
    if (text && color) {
      await chrome.action.setBadgeBackgroundColor({ tabId, color });
    }
  } catch {
    // Tab might be closed
  }
}

async function refreshTabBadge(tabId, url) {
  if (!tabId || tabId < 0) return;
  if (!isWebUrl(url)) {
    await setBadgeForTab(tabId, '', null);
    try {
      await chrome.storage.session.remove(`tab:${tabId}`);
    } catch {
      // Ignore storage errors
    }
    return;
  }

  const st = await rpcRaw('status', {});
  if (!st.connected) {
    await setBadgeForTab(tabId, '!', '#6B7280');
    await chrome.storage.session.set({
      [`tab:${tabId}`]: { url, connected: false, status: 'Disconnected', count: 0 }
    });
    return;
  }

  const sessionStatus = st.result?.status || 'Locked';
  if (!st.ok || sessionStatus !== 'Unlocked') {
    await setBadgeForTab(tabId, '🔒', '#D97706');
    await chrome.storage.session.set({
      [`tab:${tabId}`]: { url, connected: true, status: sessionStatus, count: 0 }
    });
    return;
  }

  const matched = await rpcRaw('url_match', { url });
  const list = matched.ok && Array.isArray(matched.result) ? matched.result : [];
  const badgeText = list.length > 0 ? String(list.length > 99 ? '99+' : list.length) : '';
  await setBadgeForTab(tabId, badgeText, '#0572EC');
  try {
    await chrome.storage.session.set({
      [`tab:${tabId}`]: {
        url,
        connected: true,
        status: 'Unlocked',
        count: list.length,
        updatedAt: Date.now()
      }
    });
  } catch {
    // Ignore storage quota errors
  }
}

async function refreshActiveTabBadge() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id && tab.url) {
      await refreshTabBadge(tab.id, tab.url);
    }
  } catch {
    // Ignore query failures
  }
}

async function getNeverSaveOrigins() {
  try {
    const data = await chrome.storage.local.get(NEVER_SAVE_KEY);
    return Array.isArray(data[NEVER_SAVE_KEY]) ? data[NEVER_SAVE_KEY] : [];
  } catch {
    return [];
  }
}

async function addNeverSaveOrigin(origin) {
  if (!origin) return;
  const current = await getNeverSaveOrigins();
  if (!current.includes(origin)) {
    current.push(origin);
    await chrome.storage.local.set({ [NEVER_SAVE_KEY]: current });
  }
}

async function removeNeverSaveOrigin(origin) {
  if (!origin) return;
  const current = await getNeverSaveOrigins();
  const next = current.filter((item) => item !== origin);
  await chrome.storage.local.set({ [NEVER_SAVE_KEY]: next });
}

async function getSavedTakeoverPreference() {
  try {
    const data = await chrome.storage.local.get(TAKEOVER_BROWSER_PM_KEY);
    return data[TAKEOVER_BROWSER_PM_KEY] !== false;
  } catch {
    return true;
  }
}

function privacyGet(setting) {
  return new Promise((resolve) => {
    if (!setting) {
      resolve(null);
      return;
    }
    try {
      setting.get({}, (details) => {
        if (chrome.runtime.lastError) {
          resolve(null);
          return;
        }
        resolve(details || null);
      });
    } catch {
      resolve(null);
    }
  });
}

function privacySet(setting, value) {
  return new Promise((resolve) => {
    if (!setting) {
      resolve(false);
      return;
    }
    try {
      setting.set({ value }, () => {
        resolve(!chrome.runtime.lastError);
      });
    } catch {
      resolve(false);
    }
  });
}

function privacyClear(setting) {
  return new Promise((resolve) => {
    if (!setting) {
      resolve(false);
      return;
    }
    try {
      setting.clear({}, () => {
        resolve(!chrome.runtime.lastError);
      });
    } catch {
      resolve(false);
    }
  });
}

async function applyBrowserPasswordManagerControl(enabled) {
  const pwSetting = chrome.privacy?.services?.passwordSavingEnabled;
  const cardSetting = chrome.privacy?.services?.autofillCreditCardEnabled;
  if (!pwSetting) return;

  if (enabled) {
    await privacySet(pwSetting, false);
    if (cardSetting) {
      await privacySet(cardSetting, false);
    }
  } else {
    await privacyClear(pwSetting);
    if (cardSetting) {
      await privacyClear(cardSetting);
    }
  }
}

async function getBrowserPasswordManagerControlStatus() {
  const prefEnabled = await getSavedTakeoverPreference();
  const pwSetting = chrome.privacy?.services?.passwordSavingEnabled;
  if (!pwSetting) {
    return {
      supported: false,
      enabled: prefEnabled,
      value: null,
      levelOfControl: 'not_controllable'
    };
  }
  const details = await privacyGet(pwSetting);
  return {
    supported: true,
    enabled: prefEnabled,
    value: details?.value ?? null,
    levelOfControl: details?.levelOfControl || 'controllable_by_this_extension'
  };
}

async function syncSavedPrivacyControl() {
  const enabled = await getSavedTakeoverPreference();
  await applyBrowserPasswordManagerControl(enabled);
}

async function sendToTab(tabId, payload) {
  try {
    return await chrome.tabs.sendMessage(tabId, payload);
  } catch (err) {
    return { ok: false, error: err?.message || '页面暂不支持注入填充' };
  }
}

async function showToastInTab(tabId, message, kind = 'info') {
  if (!tabId) return;
  await sendToTab(tabId, { type: 'SHOW_TOAST', message, kind });
}

async function autofillBestMatchOnTab(tab) {
  if (!tab?.id || !isWebUrl(tab.url)) {
    return { ok: false, error: '当前标签页不支持自动填充' };
  }
  const st = await rpcRaw('status', {});
  if (!st.connected) {
    await showToastInTab(tab.id, 'Keysmith 桌面端未连接，请先打开 Keysmith', 'warn');
    return { ok: false, error: st.error };
  }
  if (!st.ok || st.result?.status !== 'Unlocked') {
    await showToastInTab(tab.id, 'Keysmith 已锁定，请先在桌面端解锁', 'warn');
    return { ok: false, error: 'Keysmith 已锁定' };
  }

  const matched = await rpcRaw('url_match', { url: tab.url });
  const list = matched.ok && Array.isArray(matched.result) ? matched.result : [];
  if (list.length === 0) {
    await showToastInTab(tab.id, '未找到当前网站的已保存登录信息', 'info');
    return { ok: false, error: '无匹配条目' };
  }

  const item = list[0];
  if (item.reprompt) {
    await showToastInTab(tab.id, `「${item.title}」已启用主密码重验证，请在桌面端查看`, 'warn');
    return { ok: false, error: 'Reprompt protected' };
  }

  let totp = item.totp || '';
  if (!totp && item.hasTotp) {
    const tRes = await rpcRaw('totp', { idOrTitle: item.id });
    if (tRes.ok && tRes.result?.code) {
      totp = tRes.result.code;
    }
  }

  const fillRes = await sendToTab(tab.id, {
    type: 'FILL_CREDENTIALS',
    username: item.username || '',
    password: item.password || '',
    totp
  });
  if (fillRes?.ok) {
    await showToastInTab(tab.id, `已填充：${item.title}`, 'success');
  } else {
    await showToastInTab(tab.id, fillRes?.error || '未找到可填充的输入框', 'warn');
  }
  return fillRes;
}

async function generateAndFillOnTab(tab) {
  if (!tab?.id || !isWebUrl(tab.url)) return;
  const gen = await rpcRaw('generate', {
    mode: 'password',
    length: 20,
    includeDigits: true,
    includeSymbols: true,
    excludeAmbiguous: true
  });
  if (!gen.connected || !gen.ok || !gen.result?.value) {
    await showToastInTab(tab.id, gen.error || '生成密码失败，请打开 Keysmith 桌面端', 'warn');
    return;
  }
  const password = gen.result.value;
  await rpcRaw('clipboard_copy', { value: password, label: '新生成密码', sensitive: true });
  const res = await sendToTab(tab.id, { type: 'FILL_GENERATED_PASSWORD', password });
  if (res?.ok) {
    await showToastInTab(tab.id, '已生成强密码并填充（已复制到剪贴板）', 'success');
  } else {
    await showToastInTab(tab.id, '已生成强密码并复制到剪贴板', 'info');
  }
}

async function copyTotpForTab(tab) {
  if (!tab?.id || !isWebUrl(tab.url)) return;
  const matched = await rpcRaw('url_match', { url: tab.url });
  const list = matched.ok && Array.isArray(matched.result) ? matched.result : [];
  const totpItem = list.find((item) => item.hasTotp && !item.reprompt);
  if (!totpItem) {
    await showToastInTab(tab.id, '当前网站未配置可用 2FA 验证码', 'info');
    return;
  }
  const tRes = await rpcRaw('totp', { idOrTitle: totpItem.id });
  if (!tRes.ok || !tRes.result?.code) {
    await showToastInTab(tab.id, tRes.error || '获取 2FA 验证码失败', 'warn');
    return;
  }
  await rpcRaw('clipboard_copy', {
    value: tRes.result.code,
    label: `${totpItem.title} 2FA`,
    sensitive: true
  });
  await showToastInTab(tab.id, `已复制 2FA 验证码：${tRes.result.formattedCode || tRes.result.code}`, 'success');
}

function registerContextMenus() {
  if (!chrome.contextMenus) return;
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'ks-root',
      title: 'Keysmith',
      contexts: ['page', 'editable']
    });
    chrome.contextMenus.create({
      id: 'ks-fill-login',
      parentId: 'ks-root',
      title: '自动填充最佳匹配登录信息',
      contexts: ['page', 'editable']
    });
    chrome.contextMenus.create({
      id: 'ks-gen-fill',
      parentId: 'ks-root',
      title: '生成并填充高强度密码',
      contexts: ['editable', 'page']
    });
    chrome.contextMenus.create({
      id: 'ks-copy-totp',
      parentId: 'ks-root',
      title: '复制当前网站 2FA 验证码',
      contexts: ['page', 'editable']
    });
    chrome.contextMenus.create({
      id: 'ks-sep',
      parentId: 'ks-root',
      type: 'separator',
      contexts: ['page', 'editable']
    });
    chrome.contextMenus.create({
      id: 'ks-open-app',
      parentId: 'ks-root',
      title: '打开 Keysmith 桌面端',
      contexts: ['page', 'editable']
    });
  });
}

chrome.runtime.onInstalled.addListener(() => {
  registerContextMenus();
  syncSavedPrivacyControl();
  refreshActiveTabBadge();
});

chrome.runtime.onStartup.addListener(() => {
  registerContextMenus();
  syncSavedPrivacyControl();
  refreshActiveTabBadge();
});

if (chrome.contextMenus) {
  chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (!tab) return;
    if (info.menuItemId === 'ks-fill-login') {
      autofillBestMatchOnTab(tab);
    } else if (info.menuItemId === 'ks-gen-fill') {
      generateAndFillOnTab(tab);
    } else if (info.menuItemId === 'ks-copy-totp') {
      copyTotpForTab(tab);
    } else if (info.menuItemId === 'ks-open-app') {
      rpcRaw('open_desktop', {});
    }
  });
}

if (chrome.commands) {
  chrome.commands.onCommand.addListener(async (command) => {
    if (command === 'autofill-login') {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab) {
        await autofillBestMatchOnTab(tab);
      }
    }
  });
}

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    await refreshTabBadge(tabId, tab.url);
  } catch {
    // Ignore tab lookup failure
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' || changeInfo.url) {
    refreshTabBadge(tabId, changeInfo.url || tab.url);
  }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  try {
    await chrome.storage.session.remove(`tab:${tabId}`);
  } catch {
    // Ignore errors
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    switch (message?.type) {
      case 'STATUS': {
        sendResponse(await rpcRaw('status', {}));
        break;
      }
      case 'URL_MATCH': {
        sendResponse(await rpcRaw('url_match', { url: message.url || '' }));
        break;
      }
      case 'GET_PAGE_AUTOFILL_DATA': {
        const targetUrl = message.url || sender?.tab?.url || '';
        const st = await rpcRaw('status', {});
        if (!st.connected) {
          sendResponse({ connected: false, status: 'Disconnected', matches: [] });
          break;
        }
        const status = st.result?.status || 'Locked';
        if (!st.ok || status !== 'Unlocked') {
          sendResponse({ connected: true, status, matches: [] });
          break;
        }
        const m = await rpcRaw('url_match', { url: targetUrl });
        sendResponse({
          connected: true,
          status: 'Unlocked',
          matches: m.ok && Array.isArray(m.result) ? m.result : []
        });
        break;
      }
      case 'CARDS_AND_IDENTITIES': {
        sendResponse(await rpcRaw('cards_and_identities', {}));
        break;
      }
      case 'SEARCH': {
        sendResponse(await rpcRaw('list', { query: message.query || '' }));
        break;
      }
      case 'ITEM_GET': {
        sendResponse(await rpcRaw('get', { idOrTitle: message.itemId }));
        break;
      }
      case 'TOTP': {
        sendResponse(await rpcRaw('totp', { idOrTitle: message.itemId }));
        break;
      }
      case 'GENERATE': {
        sendResponse(await rpcRaw('generate', message.options || {}));
        break;
      }
      case 'COPY_SECRET': {
        sendResponse(
          await rpcRaw('clipboard_copy', {
            value: message.value || '',
            label: message.label || '浏览器扩展',
            sensitive: message.sensitive !== false
          })
        );
        break;
      }
      case 'OPEN_DESKTOP': {
        sendResponse(await rpcRaw('open_desktop', {}));
        break;
      }
      case 'FOCUS_DESKTOP_ITEM': {
        sendResponse(await rpcRaw('focus_item', { itemId: message.itemId || '' }));
        break;
      }
      case 'GET_PRIVACY_CONTROL': {
        sendResponse({ ok: true, ...(await getBrowserPasswordManagerControlStatus()) });
        break;
      }
      case 'SET_PRIVACY_CONTROL': {
        const enabled = Boolean(message.enabled);
        await chrome.storage.local.set({ [TAKEOVER_BROWSER_PM_KEY]: enabled });
        await applyBrowserPasswordManagerControl(enabled);
        sendResponse({ ok: true, ...(await getBrowserPasswordManagerControlStatus()) });
        break;
      }
      case 'NEVER_SAVE_LIST': {
        sendResponse({ ok: true, origins: await getNeverSaveOrigins() });
        break;
      }
      case 'NEVER_SAVE_REMOVE': {
        await removeNeverSaveOrigin(message.origin || '');
        sendResponse({ ok: true, origins: await getNeverSaveOrigins() });
        break;
      }
      case 'CHECK_LOGIN_SAVE': {
        const origin = message.origin || '';
        const neverList = await getNeverSaveOrigins();
        if (origin && neverList.includes(origin)) {
          sendResponse({ connected: true, ok: true, result: { shouldPrompt: false, reason: 'never_save' } });
          break;
        }
        sendResponse(
          await rpcRaw('check_login_save', {
            url: message.url || '',
            username: message.username || '',
            password: message.password || ''
          })
        );
        break;
      }
      case 'SAVE_LOGIN': {
        const res = await rpcRaw('save_or_update_login', {
          url: message.url || '',
          title: message.title || '',
          username: message.username || '',
          password: message.password || '',
          itemId: message.itemId || undefined
        });
        if (res.ok && message.origin) {
          try {
            await chrome.storage.session.remove(`pendingSave:${message.origin}`);
          } catch {
            // Ignore
          }
        }
        await refreshActiveTabBadge();
        sendResponse(res);
        break;
      }
      case 'NEVER_SAVE_ORIGIN': {
        await addNeverSaveOrigin(message.origin || '');
        if (message.origin) {
          try {
            await chrome.storage.session.remove(`pendingSave:${message.origin}`);
          } catch {
            // Ignore
          }
        }
        sendResponse({ ok: true });
        break;
      }
      case 'PENDING_SAVE_SET': {
        if (message.origin && message.payload) {
          await chrome.storage.session.set({
            [`pendingSave:${message.origin}`]: {
              ...message.payload,
              savedAt: Date.now()
            }
          });
        }
        sendResponse({ ok: true });
        break;
      }
      case 'PENDING_SAVE_GET': {
        if (!message.origin) {
          sendResponse({ payload: null });
          break;
        }
        const key = `pendingSave:${message.origin}`;
        const data = await chrome.storage.session.get(key);
        const entry = data[key];
        if (!entry || Date.now() - (entry.savedAt || 0) > 30000) {
          await chrome.storage.session.remove(key);
          sendResponse({ payload: null });
          break;
        }
        sendResponse({ payload: entry });
        break;
      }
      case 'PENDING_SAVE_CLEAR': {
        if (message.origin) {
          await chrome.storage.session.remove(`pendingSave:${message.origin}`);
        }
        sendResponse({ ok: true });
        break;
      }
      case 'PASSKEY_LIST_FOR_RP': {
        sendResponse(
          await rpcRaw('passkey_list_for_rp', {
            rpId: message.rpId || '',
            origin: message.origin || '',
            allowCredentials: message.allowCredentials || [],
            excludeCredentials: message.excludeCredentials || []
          })
        );
        break;
      }
      case 'PASSKEY_CREATE': {
        const res = await rpcRaw('passkey_create', {
          origin: message.origin || '',
          itemId: message.itemId || undefined,
          title: message.title || undefined,
          options: message.options || {}
        });
        await refreshActiveTabBadge();
        sendResponse(res);
        break;
      }
      case 'PASSKEY_ASSERT': {
        sendResponse(
          await rpcRaw('passkey_assert', {
            origin: message.origin || '',
            itemId: message.itemId || '',
            credentialId: message.credentialId || '',
            options: message.options || {}
          })
        );
        break;
      }
      case 'FILL_ACTIVE_TAB': {
        if (!message.tabId) {
          sendResponse({ ok: false, error: '未找到目标标签页' });
          break;
        }
        sendResponse(
          await sendToTab(message.tabId, {
            type: 'FILL_CREDENTIALS',
            username: message.username || '',
            password: message.password || '',
            totp: message.totp || ''
          })
        );
        break;
      }
      case 'FILL_GENERATED_ACTIVE_TAB': {
        if (!message.tabId) {
          sendResponse({ ok: false, error: '未找到目标标签页' });
          break;
        }
        sendResponse(
          await sendToTab(message.tabId, {
            type: 'FILL_GENERATED_PASSWORD',
            password: message.password || ''
          })
        );
        break;
      }
      case 'FILL_CARD_ACTIVE_TAB': {
        if (!message.tabId) {
          sendResponse({ ok: false, error: '未找到目标标签页' });
          break;
        }
        sendResponse(
          await sendToTab(message.tabId, {
            type: 'FILL_CARD',
            card: message.card || {}
          })
        );
        break;
      }
      case 'FILL_IDENTITY_ACTIVE_TAB': {
        if (!message.tabId) {
          sendResponse({ ok: false, error: '未找到目标标签页' });
          break;
        }
        sendResponse(
          await sendToTab(message.tabId, {
            type: 'FILL_IDENTITY',
            identity: message.identity || {}
          })
        );
        break;
      }
      case 'REFRESH_TAB_BADGE': {
        await refreshActiveTabBadge();
        sendResponse({ ok: true });
        break;
      }
      default:
        sendResponse({ ok: false, error: 'Unknown message type' });
    }
  })();
  return true;
});
