const statusBadge = document.getElementById('status-badge');
const domainLabel = document.getElementById('domain-label');
const setupPanel = document.getElementById('setup-panel');
const lockedPanel = document.getElementById('locked-panel');
const lockedTitle = document.getElementById('locked-title');
const lockedDesc = document.getElementById('locked-desc');
const vaultPanel = document.getElementById('vault-panel');
const searchInput = document.getElementById('search-input');
const sectionHeader = document.getElementById('section-header');
const itemsList = document.getElementById('items-list');
const emptyState = document.getElementById('empty-state');
const installCmdEl = document.getElementById('install-cmd');
const extIdTextEl = document.getElementById('ext-id-text');
const toastEl = document.getElementById('toast');

let activeTab = null;
let manualSetupVisible = false;
let toastTimer = null;

function showToast(text) {
  toastEl.textContent = text;
  toastEl.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl.classList.add('hidden');
  }, 1800);
}

async function copyText(text, label) {
  if (!text) {
    showToast('没有可复制的内容');
    return;
  }
  await navigator.clipboard.writeText(text);
  showToast(`已复制${label}`);
}

function sendBg(msg) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (resp) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      resolve(resp || { ok: false, error: 'No response' });
    });
  });
}

function isHttpUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

function extractHostname(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.hostname || '当前标签页';
    }
    return '非网页标签';
  } catch {
    return '当前标签页';
  }
}

function extractFieldFromDetail(detail, purposeOrType) {
  if (!detail) return '';
  if (purposeOrType === 'username' && detail.username) return detail.username;
  if (purposeOrType === 'password' && detail.password) return detail.password;
  if (purposeOrType === 'totp' && detail.totp) return detail.totp;

  const sections = Array.isArray(detail.sections) ? detail.sections : [];
  for (const sec of sections) {
    const fields = Array.isArray(sec.fields) ? sec.fields : [];
    for (const f of fields) {
      if (f.purpose === purposeOrType || f.fieldType === purposeOrType) {
        return f.value || '';
      }
    }
  }
  return '';
}

function renderStatus(state) {
  statusBadge.className = 'status-badge';
  if (!state?.nmhInstalled) {
    statusBadge.classList.add('status-disconnected');
    statusBadge.textContent = '未安装主机';
    return;
  }
  if (!state.connected) {
    statusBadge.classList.add('status-disconnected');
    statusBadge.textContent = '未连接';
    return;
  }
  if (state.status === 'Unlocked') {
    statusBadge.classList.add('status-unlocked');
    statusBadge.textContent = '已解锁';
  } else if (state.status === 'Locked') {
    statusBadge.classList.add('status-locked');
    statusBadge.textContent = '已锁定';
  } else {
    statusBadge.classList.add('status-disconnected');
    statusBadge.textContent = state.status || '未登录';
  }
}

function renderItems(items) {
  itemsList.innerHTML = '';
  if (!items || items.length === 0) {
    emptyState.classList.remove('hidden');
    return;
  }
  emptyState.classList.add('hidden');

  for (const item of items) {
    const card = document.createElement('div');
    card.className = 'item-card';

    const top = document.createElement('div');
    top.className = 'item-top';

    const meta = document.createElement('div');
    meta.className = 'item-meta';

    const titleEl = document.createElement('div');
    titleEl.className = 'item-title';
    titleEl.textContent = item.title || '未命名条目';

    const userEl = document.createElement('div');
    userEl.className = 'item-username';
    userEl.textContent = item.username || item.subtitle || '无用户名';

    meta.appendChild(titleEl);
    meta.appendChild(userEl);
    top.appendChild(meta);

    const hasTotp = Boolean(item.hasTotp || item.totp);
    const hasPasskey = Boolean(item.hasPasskey || (Array.isArray(item.passkeys) && item.passkeys.length > 0));

    const badges = document.createElement('div');
    badges.className = 'item-badges';
    if (hasTotp) {
      const b = document.createElement('span');
      b.className = 'mini-badge';
      b.textContent = '2FA';
      badges.appendChild(b);
    }
    if (hasPasskey) {
      const b = document.createElement('span');
      b.className = 'mini-badge';
      b.textContent = 'Passkey';
      badges.appendChild(b);
    }
    top.appendChild(badges);
    card.appendChild(top);

    const actions = document.createElement('div');
    actions.className = 'item-actions';

    const autofillBtn = document.createElement('button');
    autofillBtn.className = 'btn btn-primary btn-sm';
    autofillBtn.textContent = '自动填充';
    autofillBtn.addEventListener('click', async () => {
      if (!activeTab?.id || !isHttpUrl(activeTab?.url || '')) {
        showToast('当前标签页不支持网页自动填充');
        return;
      }
      const res = await sendBg({
        type: 'AUTOFILL_ITEM',
        tabId: activeTab.id,
        idOrTitle: item.id,
        fallbackItem: item
      });
      if (res.ok && res.fillResult?.ok) {
        showToast('已填充到页面');
        setTimeout(() => window.close(), 450);
      } else {
        showToast(res.error ? '请刷新页面后重试或直接复制' : '当前页面未检测到可填充输入框');
      }
    });
    actions.appendChild(autofillBtn);

    const copyPwBtn = document.createElement('button');
    copyPwBtn.className = 'btn btn-secondary btn-sm';
    copyPwBtn.textContent = '复制密码';
    copyPwBtn.addEventListener('click', async () => {
      const res = await sendBg({ type: 'GET_ITEM', idOrTitle: item.id, field: 'password' });
      const pw = (res.ok && (res.item?.value || extractFieldFromDetail(res.item, 'password'))) || item.password || '';
      if (!pw && !res.ok) {
        showToast(res.error || '获取密码失败');
        return;
      }
      await copyText(pw, '密码');
    });
    actions.appendChild(copyPwBtn);

    const copyUserBtn = document.createElement('button');
    copyUserBtn.className = 'btn btn-secondary btn-sm';
    copyUserBtn.textContent = '复制用户名';
    copyUserBtn.addEventListener('click', async () => {
      if (item.username) {
        await copyText(item.username, '用户名');
        return;
      }
      const res = await sendBg({ type: 'GET_ITEM', idOrTitle: item.id, field: 'username' });
      const uname = res.item?.value || extractFieldFromDetail(res.item, 'username');
      await copyText(uname, '用户名');
    });
    actions.appendChild(copyUserBtn);

    if (hasTotp) {
      const copyTotpBtn = document.createElement('button');
      copyTotpBtn.className = 'btn btn-secondary btn-sm';
      copyTotpBtn.textContent = '复制 TOTP';
      copyTotpBtn.addEventListener('click', async () => {
        const res = await sendBg({ type: 'GET_TOTP', idOrTitle: item.id });
        const fallbackCode = typeof item.totp === 'string' ? item.totp : item.totp?.code;
        const code = (res.ok && res.totp?.code) || fallbackCode || '';
        if (!code) {
          showToast(res.error || '获取验证码失败');
          return;
        }
        await copyText(code, `验证码 (${code})`);
      });
      actions.appendChild(copyTotpBtn);
    }

    card.appendChild(actions);
    itemsList.appendChild(card);
  }
}

async function loadMatchedOrSearch(query) {
  const trimmed = (query || '').trim();
  if (trimmed) {
    sectionHeader.textContent = '搜索结果';
    const res = await sendBg({ type: 'LIST_ITEMS', query: trimmed });
    renderItems(res.ok ? res.items : []);
  } else {
    sectionHeader.textContent = '匹配当前网站的登录项';
    const url = activeTab?.url || '';
    if (!isHttpUrl(url)) {
      renderItems([]);
      return;
    }
    const res = await sendBg({ type: 'URL_MATCH', url });
    renderItems(res.ok ? res.items : []);
  }
}

async function init() {
  const extId = chrome.runtime.id;
  extIdTextEl.textContent = extId;
  installCmdEl.textContent = `ks install-nmh ${extId}`;

  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTab = tabs[0] || null;
  domainLabel.textContent = activeTab?.url ? extractHostname(activeTab.url) : '当前页面';

  const statusResp = await sendBg({ type: 'GET_STATUS' });
  const state = statusResp.state || { connected: false, nmhInstalled: false, status: 'Disconnected' };
  renderStatus(state);

  setupPanel.classList.add('hidden');
  lockedPanel.classList.add('hidden');
  vaultPanel.classList.add('hidden');

  if (!state.nmhInstalled || manualSetupVisible) {
    setupPanel.classList.remove('hidden');
  }

  if (!state.nmhInstalled) {
    return;
  }

  if (!state.connected) {
    lockedTitle.textContent = '无法连接到 Keysmith 桌面端';
    lockedDesc.textContent = '请确认 Keysmith 桌面应用已启动，并检查本地 Socket 服务是否运行。';
    lockedPanel.classList.remove('hidden');
    return;
  }

  if (state.status !== 'Unlocked') {
    lockedTitle.textContent = state.status === 'Locked' ? 'Keysmith 保险库已锁定' : '尚未登录 Keysmith 账户';
    lockedDesc.textContent = '请在 Keysmith 桌面应用中完成登录或解锁，然后点击刷新。';
    lockedPanel.classList.remove('hidden');
    return;
  }

  vaultPanel.classList.remove('hidden');
  await loadMatchedOrSearch(searchInput.value);
}

document.getElementById('refresh-btn').addEventListener('click', () => void init());
document.getElementById('retry-connect-btn').addEventListener('click', () => void init());

document.getElementById('copy-cmd-btn').addEventListener('click', () => {
  void copyText(installCmdEl.textContent, '安装命令');
});

document.getElementById('copy-ext-id-btn').addEventListener('click', () => {
  void copyText(chrome.runtime.id, '扩展 ID');
});

document.getElementById('toggle-setup-btn').addEventListener('click', () => {
  manualSetupVisible = !manualSetupVisible;
  setupPanel.classList.toggle('hidden', !manualSetupVisible);
});

let searchTimer = null;
searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    void loadMatchedOrSearch(searchInput.value);
  }, 150);
});

void init();
