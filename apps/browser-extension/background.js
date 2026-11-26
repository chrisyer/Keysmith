const NMH_HOST_NAME = 'dev.keysmith.desktop';
const RPC_TIMEOUT_MS = 10000;

let nativePort = null;
let nextRpcId = 1;
const pendingRequests = new Map();

let cachedState = {
  connected: false,
  nmhInstalled: true,
  status: 'Disconnected', // 'Unlocked' | 'Locked' | 'Unauthenticated' | 'Disconnected'
  email: '',
  lastError: null,
  updatedAt: 0
};

function isNmhMissingError(message) {
  if (!message) return false;
  const lower = String(message).toLowerCase();
  return (
    lower.includes('native messaging host not found') ||
    lower.includes('specified native messaging host not found') ||
    lower.includes('forbidden') ||
    lower.includes('access to the specified native messaging host is forbidden')
  );
}

function rejectAllPending(reason) {
  for (const [id, entry] of pendingRequests.entries()) {
    clearTimeout(entry.timer);
    entry.reject(new Error(reason));
    pendingRequests.delete(id);
  }
}

function ensureNativePort() {
  if (nativePort) {
    return nativePort;
  }

  const port = chrome.runtime.connectNative(NMH_HOST_NAME);

  port.onMessage.addListener((msg) => {
    if (!msg || typeof msg.id !== 'number') return;
    const entry = pendingRequests.get(msg.id);
    if (!entry) return;
    clearTimeout(entry.timer);
    pendingRequests.delete(msg.id);
    if (msg.ok) {
      entry.resolve(msg.result ?? null);
    } else {
      entry.reject(new Error(msg.error || 'Keysmith RPC error'));
    }
  });

  port.onDisconnect.addListener(() => {
    const errMsg = chrome.runtime.lastError?.message || 'Native host disconnected';
    nativePort = null;
    cachedState.connected = false;
    cachedState.status = 'Disconnected';
    cachedState.lastError = errMsg;
    if (isNmhMissingError(errMsg)) {
      cachedState.nmhInstalled = false;
    }
    rejectAllPending(errMsg);
  });

  nativePort = port;
  return port;
}

async function rpcCall(method, params = {}) {
  const id = nextRpcId++;
  const payload = { id, method, params };

  try {
    const port = ensureNativePort();
    const result = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingRequests.delete(id);
        reject(new Error(`RPC timeout (${method})`));
      }, RPC_TIMEOUT_MS);

      pendingRequests.set(id, { resolve, reject, timer });
      try {
        port.postMessage(payload);
      } catch (postErr) {
        clearTimeout(timer);
        pendingRequests.delete(id);
        reject(postErr);
      }
    });

    cachedState.connected = true;
    cachedState.nmhInstalled = true;
    cachedState.lastError = null;
    cachedState.updatedAt = Date.now();
    return result;
  } catch (err) {
    const msg = err?.message || String(err);
    if (isNmhMissingError(msg)) {
      cachedState.nmhInstalled = false;
      cachedState.connected = false;
      cachedState.status = 'Disconnected';
      cachedState.lastError = msg;
      throw err;
    }

    // Fallback one-shot native message if persistent port dropped mid-call
    if (!nativePort) {
      return await new Promise((resolve, reject) => {
        chrome.runtime.sendNativeMessage(NMH_HOST_NAME, payload, (resp) => {
          const lastErr = chrome.runtime.lastError?.message;
          if (lastErr) {
            if (isNmhMissingError(lastErr)) {
              cachedState.nmhInstalled = false;
            }
            cachedState.connected = false;
            cachedState.status = 'Disconnected';
            cachedState.lastError = lastErr;
            reject(new Error(lastErr));
            return;
          }
          if (!resp) {
            reject(new Error('Empty response from Native Messaging host'));
            return;
          }
          if (resp.ok) {
            cachedState.connected = true;
            cachedState.nmhInstalled = true;
            cachedState.lastError = null;
            cachedState.updatedAt = Date.now();
            resolve(resp.result ?? null);
          } else {
            reject(new Error(resp.error || 'Keysmith RPC error'));
          }
        });
      });
    }
    throw err;
  }
}

async function refreshStatus() {
  try {
    const res = await rpcCall('status', {});
    cachedState = {
      connected: true,
      nmhInstalled: true,
      status: res?.status || 'Unknown',
      email: res?.email || '',
      lastError: null,
      updatedAt: Date.now()
    };
  } catch (err) {
    const msg = err?.message || String(err);
    cachedState = {
      ...cachedState,
      connected: false,
      status: 'Disconnected',
      lastError: msg,
      updatedAt: Date.now()
    };
  }
  updateBadge();
  return cachedState;
}

function updateBadge() {
  if (!cachedState.nmhInstalled || !cachedState.connected) {
    chrome.action.setBadgeText({ text: '!' });
    chrome.action.setBadgeBackgroundColor({ color: '#6f7785' });
    return;
  }
  if (cachedState.status === 'Unlocked') {
    chrome.action.setBadgeText({ text: '' });
  } else {
    chrome.action.setBadgeText({ text: '🔒' });
    chrome.action.setBadgeBackgroundColor({ color: '#d97706' });
  }
}

function safeOriginHostname(origin) {
  try {
    return new URL(origin).hostname || '';
  } catch {
    return '';
  }
}

function extractTotpString(totpField) {
  if (!totpField) return '';
  if (typeof totpField === 'string') return totpField;
  if (typeof totpField.code === 'string') return totpField.code;
  return '';
}

function extractItemCredentials(itemDetail) {
  if (!itemDetail) return { username: '', password: '', totpSecret: '', totpCode: '' };
  let username = itemDetail.username || '';
  let password = itemDetail.password || '';
  let totpSecret = typeof itemDetail.totp === 'string' ? itemDetail.totp : '';
  const totpCode = typeof itemDetail.totp === 'object' ? (itemDetail.totp?.code || '') : '';

  const sections = Array.isArray(itemDetail.sections) ? itemDetail.sections : [];
  for (const sec of sections) {
    const fields = Array.isArray(sec.fields) ? sec.fields : [];
    for (const f of fields) {
      if (!username && (f.purpose === 'username' || f.fieldType === 'email')) {
        username = f.value || '';
      }
      if (!password && (f.purpose === 'password' || f.fieldType === 'password')) {
        password = f.value || '';
      }
      if (!totpSecret && (f.purpose === 'totp' || f.fieldType === 'totp')) {
        totpSecret = f.value || '';
      }
    }
  }
  return { username, password, totpSecret, totpCode };
}

chrome.runtime.onInstalled.addListener(() => {
  void refreshStatus();
});

chrome.tabs.onActivated.addListener(() => {
  void refreshStatus();
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || !message.type) return false;

  (async () => {
    try {
      switch (message.type) {
        case 'GET_STATUS': {
          const state = await refreshStatus();
          sendResponse({ ok: true, state });
          break;
        }
        case 'URL_MATCH': {
          const items = await rpcCall('url_match', { url: message.url || '' });
          sendResponse({ ok: true, items: Array.isArray(items) ? items : items?.items || [] });
          break;
        }
        case 'LIST_ITEMS': {
          const items = await rpcCall('list', { query: message.query || '' });
          sendResponse({ ok: true, items: Array.isArray(items) ? items : items?.items || [] });
          break;
        }
        case 'GET_ITEM': {
          const item = await rpcCall('get', {
            idOrTitle: message.idOrTitle,
            field: message.field || null
          });
          sendResponse({ ok: true, item });
          break;
        }
        case 'GET_TOTP': {
          const totp = await rpcCall('totp', { idOrTitle: message.idOrTitle });
          sendResponse({ ok: true, totp });
          break;
        }
        case 'AUTOFILL_ITEM': {
          const item = await rpcCall('get', { idOrTitle: message.idOrTitle, field: null });
          const creds = extractItemCredentials(item);
          const fallbackCreds = extractItemCredentials(message.fallbackItem);
          const username = creds.username || fallbackCreds.username;
          const password = creds.password || fallbackCreds.password;
          let totpCode = creds.totpCode || extractTotpString(message.fallbackItem?.totp);
          if (!totpCode && (item?.hasTotp || creds.totpSecret || message.fallbackItem?.hasTotp)) {
            try {
              const totpRes = await rpcCall('totp', { idOrTitle: message.idOrTitle });
              totpCode = totpRes?.code || '';
            } catch {
              // TOTP optional during autofill
            }
          }
          const fillResult = await chrome.tabs.sendMessage(message.tabId, {
            type: 'KEYSMITH_AUTOFILL',
            username,
            password,
            totp: totpCode
          });
          sendResponse({ ok: true, fillResult });
          break;
        }
        case 'PASSKEY_BRIDGE': {
          try {
            const opts = message.options || {};
            const rpId = opts.rpId || opts.rp?.id || safeOriginHostname(message.origin);
            const userName = opts.user?.name || '';
            const res = await rpcCall('passkey_match', {
              action: message.action,
              rpId,
              userName,
              origin: message.origin,
              options: opts
            });
            if (
              res &&
              res.handled === true &&
              res.credential &&
              res.credential.id &&
              res.credential.response?.clientDataJSON
            ) {
              sendResponse({
                handled: true,
                credential: res.credential,
                fallback: false
              });
            } else {
              sendResponse({
                handled: false,
                fallback: res?.fallback !== false,
                cancelled: Boolean(res?.cancelled)
              });
            }
          } catch {
            // Locked, disconnected, or NMH missing -> fallback cleanly to browser native WebAuthn
            sendResponse({ handled: false, fallback: true });
          }
          break;
        }
        default:
          sendResponse({ ok: false, error: `Unknown message type: ${message.type}` });
      }
    } catch (err) {
      sendResponse({ ok: false, error: err?.message || String(err), state: cachedState });
    }
  })();

  return true;
});
