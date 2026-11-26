const statusBadge = document.getElementById('status-badge');
const domainLabel = document.getElementById('domain-label');
const tabsBar = document.getElementById('tabs-bar');
const lockedPanel = document.getElementById('locked-panel');
const lockedTitle = document.getElementById('locked-title');
const lockedDesc = document.getElementById('locked-desc');
const advancedNmh = document.getElementById('advanced-nmh');
const installCmdEl = document.getElementById('install-cmd');
const extIdTextEl = document.getElementById('ext-id-text');
const toastEl = document.getElementById('toast');

const tabPanels = {
  current: document.getElementById('tab-current'),
  vault: document.getElementById('tab-vault'),
  generator: document.getElementById('tab-generator')
};
const detailViewEl = document.getElementById('detail-view');
const detailCatBadgeEl = document.getElementById('detail-cat-badge');
const detailTitleEl = document.getElementById('detail-title');
const detailSubtitleEl = document.getElementById('detail-subtitle');
const detailFillBtn = document.getElementById('detail-fill-btn');
const detailEditBtn = document.getElementById('detail-edit-btn');
const detailDeleteBtn = document.getElementById('detail-delete-btn');
const detailBodyEl = document.getElementById('detail-body');

const settingsViewEl = document.getElementById('settings-view');
const takeoverToggleEl = document.getElementById('takeover-toggle');
const takeoverStatusEl = document.getElementById('takeover-status');
const reloadExtBtn = document.getElementById('reload-ext-btn');
const neverSaveListEl = document.getElementById('never-save-list');
const neverSaveEmptyEl = document.getElementById('never-save-empty');
const settingsExtIdEl = document.getElementById('settings-ext-id');

const currentListEl = document.getElementById('current-list');
const currentEmptyEl = document.getElementById('current-empty');

const quickAddForm = document.getElementById('quick-add-form');
const addTitleInput = document.getElementById('add-title');
const addUserInput = document.getElementById('add-username');
const addPwInput = document.getElementById('add-password');

const searchInput = document.getElementById('search-input');
const vaultListEl = document.getElementById('vault-list');
const vaultEmptyEl = document.getElementById('vault-empty');

const genOutputEl = document.getElementById('gen-output');
const genStrengthEl = document.getElementById('gen-strength');
const genLenRange = document.getElementById('gen-len-range');
const genLenLabel = document.getElementById('gen-len-label');
const genDigitsEl = document.getElementById('gen-digits');
const genSymbolsEl = document.getElementById('gen-symbols');
const genAmbigEl = document.getElementById('gen-ambiguous');
const optDigitsWrap = document.getElementById('opt-digits-wrap');
const optSymbolsWrap = document.getElementById('opt-symbols-wrap');
const optAmbigWrap = document.getElementById('opt-ambig-wrap');

let activeTab = null;
let currentTabName = 'current';
let activeVaultCategory = 'all';
let genMode = 'password';
let currentGeneratedValue = '';
let isVaultUnlocked = false;
let currentDetailItem = null;
let totpInterval = null;
let toastTimer = null;

const langSelectEl = document.getElementById('lang-select');
const i18n = globalThis.KeysmithI18n;

function t(key, vars) {
  return i18n ? i18n.t(key, vars) : key;
}

function getCategoryLabel(category) {
  return i18n ? i18n.categoryLabel(category) : t('itemLabel');
}

function showToast(text) {
  toastEl.textContent = text;
  toastEl.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toastEl.classList.add('hidden');
  }, 2000);
}

async function copyText(text, label) {
  if (!text) {
    showToast(t('toastNothingToCopy'));
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // Desktop clipboard_copy still writes to system clipboard
  }
  await sendBg({ type: 'COPY_SECRET', value: text, label, sensitive: true });
  showToast(t('toastCopied', { label }));
}

function sendBg(msg) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(msg, (resp) => {
      if (chrome.runtime.lastError) {
        resolve({ connected: false, ok: false, error: chrome.runtime.lastError.message });
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
      return parsed.hostname || t('domainCurrentPage');
    }
    return t('domainNonWeb');
  } catch {
    return t('domainCurrentPage');
  }
}

function stopTotpTimer() {
  if (totpInterval) {
    clearInterval(totpInterval);
    totpInterval = null;
  }
}

function hideAllMainViews() {
  stopTotpTimer();
  lockedPanel.classList.add('hidden');
  detailViewEl.classList.add('hidden');
  settingsViewEl.classList.add('hidden');
  tabsBar.classList.add('hidden');
  for (const panel of Object.values(tabPanels)) {
    panel.classList.add('hidden');
  }
}

function renderStatus(connected, status) {
  statusBadge.className = 'status-badge';
  if (!connected) {
    statusBadge.classList.add('status-disconnected');
    statusBadge.textContent = t('statusDisconnected');
    return;
  }
  if (status === 'Unlocked') {
    statusBadge.classList.add('status-unlocked');
    statusBadge.textContent = t('statusUnlocked');
  } else if (status === 'Locked') {
    statusBadge.classList.add('status-locked');
    statusBadge.textContent = t('statusLocked');
  } else {
    statusBadge.classList.add('status-disconnected');
    statusBadge.textContent = t('statusSignedOut');
  }
}

function switchTab(name) {
  currentTabName = name;
  hideAllMainViews();
  if (!isVaultUnlocked) {
    lockedPanel.classList.remove('hidden');
    return;
  }
  tabsBar.classList.remove('hidden');
  for (const btn of document.querySelectorAll('.tab-btn')) {
    btn.classList.toggle('active', btn.dataset.tab === name);
  }
  for (const [key, panel] of Object.entries(tabPanels)) {
    panel.classList.toggle('hidden', key !== name);
  }
  if (name === 'vault') {
    void loadVaultSearch();
  } else if (name === 'generator' && !currentGeneratedValue) {
    void runGenerator();
  }
}

async function autofillSummaryItem(item, isVaultSummary = false) {
  if (!activeTab?.id || !isHttpUrl(activeTab?.url || '')) {
    showToast(t('toastTabUnsupported'));
    return;
  }

  let detail = item;
  let verifyBiometric = false;
  if (item.reprompt) {
    const bioRes = await sendBg({
      type: 'ITEM_GET',
      itemId: item.id,
      verifyBiometric: true
    });
    if (!bioRes.ok || !bioRes.result) {
      showToast(t('toastRepromptDesktop'));
      await sendBg({ type: 'FOCUS_DESKTOP_ITEM', itemId: item.id });
      return;
    }
    detail = bioRes.result;
    verifyBiometric = true;
  } else if (isVaultSummary || (!item.password && item.hasPassword)) {
    const g = await sendBg({ type: 'ITEM_GET', itemId: item.id });
    if (!g.ok || !g.result) {
      showToast(g.error || t('toastReadCredError'));
      return;
    }
    detail = g.result;
  }

  let totp = detail.totp || '';
  if (!totp && (detail.hasTotp || item.hasTotp)) {
    const tRes = await sendBg({ type: 'TOTP', itemId: item.id, verifyBiometric });
    if (tRes.ok && tRes.result?.code) {
      totp = tRes.result.code;
    }
  }

  const res = await sendBg({
    type: 'FILL_ACTIVE_TAB',
    tabId: activeTab.id,
    username: detail.username || '',
    password: detail.password || '',
    totp
  });
  if (res.ok) {
    showToast(t('toastAutofilled'));
    setTimeout(() => window.close(), 420);
  } else {
    showToast(res.error || t('toastNoLoginFields'));
  }
}

// ==================== Item Detail View ====================

async function openDetailView(itemId, fallbackSummary = null, cardOrIdent = null, verifyBiometric = false) {
  hideAllMainViews();
  detailViewEl.classList.remove('hidden');
  detailBodyEl.textContent = '';
  if (detailEditBtn) detailEditBtn.classList.add('hidden');
  if (detailDeleteBtn) detailDeleteBtn.classList.add('hidden');

  const fallbackTitle = fallbackSummary?.title || cardOrIdent?.data?.title || t('detailLoadingTitle');
  detailTitleEl.textContent = fallbackTitle;
  detailSubtitleEl.textContent =
    fallbackSummary?.username ||
    fallbackSummary?.subtitle ||
    cardOrIdent?.data?.maskedNumber ||
    cardOrIdent?.data?.fullName ||
    '';
  detailCatBadgeEl.textContent =
    (fallbackSummary?.category ? getCategoryLabel(fallbackSummary.category) : null) ||
    (cardOrIdent?.kind === 'card'
      ? t('cardLabel')
      : cardOrIdent?.kind === 'identity'
        ? t('identityLabel')
        : t('itemLabel'));

  if (!verifyBiometric && (fallbackSummary?.reprompt || cardOrIdent?.data?.reprompt)) {
    currentDetailItem = { id: itemId, reprompt: true };
    detailFillBtn.classList.add('hidden');
    renderRepromptDetailCard(itemId, fallbackSummary, cardOrIdent);
    return;
  }

  const loadingCard = document.createElement('div');
  loadingCard.className = 'card empty-state';
  loadingCard.textContent = t('detailLoadingCard');
  detailBodyEl.appendChild(loadingCard);

  const resp = await sendBg({ type: 'ITEM_GET', itemId, verifyBiometric });
  detailBodyEl.textContent = '';

  if (!resp.ok || !resp.result) {
    currentDetailItem = { id: itemId, reprompt: true };
    if ((resp.error || '').includes('重验证') || (resp.error || '').toLowerCase().includes('reprompt')) {
      detailFillBtn.classList.add('hidden');
      renderRepromptDetailCard(itemId, fallbackSummary, cardOrIdent);
    } else {
      const errCard = document.createElement('div');
      errCard.className = 'card empty-state';
      errCard.textContent = resp.error || t('detailLoadError');
      detailBodyEl.appendChild(errCard);
    }
    return;
  }

  const detail = resp.result;
  detail.reprompt = Boolean(detail.reprompt || detail.payload?.reprompt);
  currentDetailItem = { ...detail, _verifiedBiometric: verifyBiometric };
  detailTitleEl.textContent = detail.title || t('unnamedItem');
  detailSubtitleEl.textContent = detail.username || detail.subtitle || fallbackSummary?.subtitle || '';
  detailCatBadgeEl.textContent = getCategoryLabel(detail.category || detail.payload?.category);

  if (detailEditBtn) {
    detailEditBtn.classList.remove('hidden');
    detailEditBtn.onclick = () => renderDetailEditForm(detail, fallbackSummary, cardOrIdent, verifyBiometric);
  }
  if (detailDeleteBtn) {
    detailDeleteBtn.classList.remove('hidden');
    detailDeleteBtn.onclick = async () => {
      if (!globalThis.confirm(t('confirmDeleteItem', { title: detail.title || t('unnamedItem') }))) {
        return;
      }
      const delRes = await sendBg({
        type: 'ITEM_TRASH',
        itemId: detail.id,
        verifyBiometric: verifyBiometric || Boolean(detail.reprompt)
      });
      if (delRes.ok) {
        showToast(t('toastItemDeleted'));
        switchTab(currentTabName);
        await loadCurrentSite();
        if (currentTabName === 'vault') {
          await loadVaultSearch();
        }
      } else {
        showToast(delRes.error || t('toastSaveFailed'));
      }
    };
  }

  const canFillLogin = Boolean(detail.username || detail.password || detail.hasTotp);
  const canFillCard = detail.category === 'credit_card' || cardOrIdent?.kind === 'card';
  const canFillIdent = detail.category === 'identity' || cardOrIdent?.kind === 'identity';
  detailFillBtn.classList.toggle('hidden', !canFillLogin && !canFillCard && !canFillIdent);
  detailFillBtn.onclick = async () => {
    if (!activeTab?.id || !isHttpUrl(activeTab?.url || '')) {
      showToast(t('toastTabUnsupported'));
      return;
    }
    if (cardOrIdent?.kind === 'card') {
      const res = await sendBg({
        type: 'FILL_CARD_ACTIVE_TAB',
        tabId: activeTab.id,
        card: cardOrIdent.data
      });
      showToast(res.ok ? t('toastCardFilled') : res.error || t('toastNoCardFields'));
      return;
    }
    if (cardOrIdent?.kind === 'identity') {
      const res = await sendBg({
        type: 'FILL_IDENTITY_ACTIVE_TAB',
        tabId: activeTab.id,
        identity: cardOrIdent.data
      });
      showToast(res.ok ? t('toastIdentFilled') : res.error || t('toastNoIdentFields'));
      return;
    }
    await autofillSummaryItem(detail, false);
  };

  // 1. Live 2FA TOTP Card (if configured)
  if (detail.hasTotp || detail.totp) {
    renderLiveTotpCard(detail.id, verifyBiometric);
  }

  // 2. Sections & Fields
  const sections = Array.isArray(detail.sections) ? detail.sections : [];
  for (const sec of sections) {
    const fields = Array.isArray(sec.fields) ? sec.fields.filter((f) => f.value) : [];
    if (fields.length === 0) continue;

    const card = document.createElement('div');
    card.className = 'card';
    if (sec.title) {
      const st = document.createElement('div');
      st.className = 'detail-section-title';
      st.textContent = sec.title;
      card.appendChild(st);
    }

    for (const field of fields) {
      const row = document.createElement('div');
      row.className = 'detail-field-row';

      const head = document.createElement('div');
      head.className = 'detail-field-head';
      const lbl = document.createElement('span');
      lbl.className = 'detail-field-label';
      lbl.textContent = field.label || t('fieldDefault');

      const actions = document.createElement('div');
      actions.className = 'detail-field-actions';

      const isSensitive = Boolean(
        field.sensitive ||
          field.fieldType === 'password' ||
          field.fieldType === 'totp' ||
          field.purpose === 'password' ||
          field.purpose === 'card_cvv'
      );

      let revealed = !isSensitive;
      const valEl = document.createElement('div');
      valEl.className = 'detail-field-value' + (isSensitive ? ' mono' : '');
      valEl.textContent = revealed ? field.value : '••••••••••••';

      if (isSensitive) {
        const toggleBtn = document.createElement('button');
        toggleBtn.type = 'button';
        toggleBtn.className = 'btn btn-secondary btn-sm';
        toggleBtn.textContent = t('btnShow');
        toggleBtn.addEventListener('click', () => {
          revealed = !revealed;
          toggleBtn.textContent = revealed ? t('btnHide') : t('btnShow');
          valEl.textContent = revealed ? field.value : '••••••••••••';
        });
        actions.appendChild(toggleBtn);
      }

      const copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.className = 'btn btn-secondary btn-sm';
      copyBtn.textContent = t('btnCopy');
      copyBtn.addEventListener('click', () => void copyText(field.value, field.label || t('fieldDefault')));
      actions.appendChild(copyBtn);

      head.append(lbl, actions);
      row.append(head, valEl);
      card.appendChild(row);
    }
    detailBodyEl.appendChild(card);
  }

  // 3. Passkeys Section
  const passkeys = Array.isArray(detail.passkeys) ? detail.passkeys : [];
  if (passkeys.length > 0) {
    const card = document.createElement('div');
    card.className = 'card';
    const st = document.createElement('div');
    st.className = 'detail-section-title';
    st.textContent = t('passkeysSectionTitle', { count: passkeys.length });
    card.appendChild(st);

    for (const pk of passkeys) {
      const row = document.createElement('div');
      row.className = 'detail-field-row';
      const head = document.createElement('div');
      head.className = 'detail-field-head';
      const lbl = document.createElement('span');
      lbl.className = 'detail-field-label';
      lbl.textContent = pk.rpId || 'Passkey';
      const pill = document.createElement('span');
      pill.className = 'mini-badge';
      pill.textContent = t('passkeySignCount', { count: pk.signCount || 0 });
      head.append(lbl, pill);
      const val = document.createElement('div');
      val.className = 'detail-field-value';
      val.textContent = t('passkeyUserCreated', {
        user: pk.userName || pk.userDisplayName || t('userDefault'),
        date: (pk.createdAt || '').slice(0, 10)
      });
      row.append(head, val);
      card.appendChild(row);
    }
    detailBodyEl.appendChild(card);
  }

  // 4. URLs Section
  const urls = Array.isArray(detail.urls) ? detail.urls.filter((u) => u.uri) : [];
  if (urls.length > 0) {
    const card = document.createElement('div');
    card.className = 'card';
    const st = document.createElement('div');
    st.className = 'detail-section-title';
    st.textContent = t('urlsSectionTitle');
    card.appendChild(st);

    for (const u of urls) {
      const row = document.createElement('div');
      row.className = 'detail-field-row';
      const head = document.createElement('div');
      head.className = 'detail-field-head';
      const lbl = document.createElement('span');
      lbl.className = 'detail-field-label';
      lbl.textContent = u.label || t('urlDefaultLabel');
      const actions = document.createElement('div');
      actions.className = 'detail-field-actions';
      if (isHttpUrl(u.uri)) {
        const openBtn = document.createElement('button');
        openBtn.type = 'button';
        openBtn.className = 'btn btn-secondary btn-sm';
        openBtn.textContent = t('btnOpen');
        openBtn.addEventListener('click', () => {
          chrome.tabs.create({ url: u.uri });
        });
        actions.appendChild(openBtn);
      }
      const copyBtn = document.createElement('button');
      copyBtn.type = 'button';
      copyBtn.className = 'btn btn-secondary btn-sm';
      copyBtn.textContent = t('btnCopy');
      copyBtn.addEventListener('click', () => void copyText(u.uri, t('labelUrl')));
      actions.appendChild(copyBtn);
      head.append(lbl, actions);
      const val = document.createElement('div');
      val.className = 'detail-field-value';
      val.textContent = u.uri;
      row.append(head, val);
      card.appendChild(row);
    }
    detailBodyEl.appendChild(card);
  }

  // 5. Notes Section
  if (detail.notes && detail.notes.trim()) {
    const card = document.createElement('div');
    card.className = 'card';
    const head = document.createElement('div');
    head.className = 'detail-field-head';
    const st = document.createElement('div');
    st.className = 'detail-section-title';
    st.textContent = t('notesSectionTitle');
    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'btn btn-secondary btn-sm';
    copyBtn.textContent = t('btnCopy');
    copyBtn.addEventListener('click', () => void copyText(detail.notes, t('labelNotes')));
    head.append(st, copyBtn);
    const body = document.createElement('div');
    body.className = 'detail-field-value';
    body.textContent = detail.notes;
    card.append(head, body);
    detailBodyEl.appendChild(card);
  }
}

function renderRepromptDetailCard(itemId, fallbackSummary = null, cardOrIdent = null) {
  const card = document.createElement('div');
  card.className = 'card';
  const title = document.createElement('div');
  title.className = 'card-title';
  title.textContent = t('repromptCardTitle');
  const desc = document.createElement('p');
  desc.className = 'card-desc';
  desc.textContent = t('repromptCardDesc');
  const btnRow = document.createElement('div');
  btnRow.className = 'btn-row';

  const bioBtn = document.createElement('button');
  bioBtn.type = 'button';
  bioBtn.className = 'btn btn-primary btn-sm btn-flex';
  bioBtn.textContent = t('repromptBiometricBtn');
  bioBtn.addEventListener('click', async () => {
    bioBtn.disabled = true;
    bioBtn.textContent = t('repromptVerifying');
    const resp = await sendBg({ type: 'ITEM_GET', itemId, verifyBiometric: true });
    if (resp.ok && resp.result) {
      await openDetailView(itemId, fallbackSummary, cardOrIdent, true);
    } else {
      bioBtn.disabled = false;
      bioBtn.textContent = t('repromptBiometricBtn');
      showToast(resp.error || t('repromptFailed'));
    }
  });

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn btn-secondary btn-sm';
  btn.textContent = t('repromptCardBtn');
  btn.addEventListener('click', () => void sendBg({ type: 'FOCUS_DESKTOP_ITEM', itemId }));
  btnRow.append(bioBtn, btn);
  card.append(title, desc, btnRow);
  detailBodyEl.appendChild(card);
}

function renderDetailEditForm(detail, fallbackSummary, cardOrIdent, verifyBiometric) {
  stopTotpTimer();
  detailBodyEl.textContent = '';
  const form = document.createElement('form');
  form.className = 'card';

  const mkField = (labelText, value, type = 'text') => {
    const grp = document.createElement('div');
    grp.className = 'field-group';
    const lbl = document.createElement('label');
    lbl.textContent = labelText;
    const inp = document.createElement('input');
    inp.type = type;
    inp.className = 'text-input';
    inp.value = value || '';
    grp.append(lbl, inp);
    form.appendChild(grp);
    return inp;
  };

  const titleInput = mkField(t('labelName'), detail.title || '');
  const userInput = mkField(t('labelUsernameEmail'), detail.username || '');

  const pwGroup = document.createElement('div');
  pwGroup.className = 'field-group';
  const pwLbl = document.createElement('label');
  pwLbl.textContent = t('labelPassword');
  const pwRow = document.createElement('div');
  pwRow.className = 'inline-input-row';
  const pwInput = document.createElement('input');
  pwInput.type = 'text';
  pwInput.className = 'text-input mono';
  pwInput.value = detail.password || '';
  const genBtn = document.createElement('button');
  genBtn.type = 'button';
  genBtn.className = 'btn btn-secondary btn-sm';
  genBtn.textContent = t('btnGenerate');
  genBtn.addEventListener('click', async () => {
    const gRes = await sendBg({
      type: 'GENERATE',
      options: { mode: 'password', length: 20, includeDigits: true, includeSymbols: true, excludeAmbiguous: true }
    });
    if (gRes.ok && gRes.result?.value) {
      pwInput.value = gRes.result.value;
    }
  });
  pwRow.append(pwInput, genBtn);
  pwGroup.append(pwLbl, pwRow);
  form.appendChild(pwGroup);

  const firstUrl = detail.payload?.urls?.[0]?.uri || detail.urls?.[0]?.uri || '';
  const urlInput = mkField(t('labelWebsiteUrl'), firstUrl, 'url');

  const notesGrp = document.createElement('div');
  notesGrp.className = 'field-group';
  const notesLbl = document.createElement('label');
  notesLbl.textContent = t('labelNotes');
  const notesArea = document.createElement('textarea');
  notesArea.className = 'textarea-input';
  notesArea.value = detail.payload?.notes ?? detail.notes ?? '';
  notesGrp.append(notesLbl, notesArea);
  form.appendChild(notesGrp);

  const btnRow = document.createElement('div');
  btnRow.className = 'btn-row';
  const saveBtn = document.createElement('button');
  saveBtn.type = 'submit';
  saveBtn.className = 'btn btn-primary btn-sm btn-flex';
  saveBtn.textContent = t('btnSaveChanges');
  const cancelBtn = document.createElement('button');
  cancelBtn.type = 'button';
  cancelBtn.className = 'btn btn-secondary btn-sm';
  cancelBtn.textContent = t('btnCancel');
  cancelBtn.addEventListener('click', () => {
    void openDetailView(detail.id, fallbackSummary, cardOrIdent, verifyBiometric);
  });
  btnRow.append(saveBtn, cancelBtn);
  form.appendChild(btnRow);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    saveBtn.disabled = true;
    const res = await sendBg({
      type: 'ITEM_UPDATE_QUICK',
      itemId: detail.id,
      title: titleInput.value.trim(),
      username: userInput.value,
      password: pwInput.value,
      url: urlInput.value.trim(),
      notes: notesArea.value,
      verifyBiometric: verifyBiometric || Boolean(detail.reprompt)
    });
    saveBtn.disabled = false;
    if (res.ok) {
      showToast(t('toastItemUpdated'));
      await openDetailView(detail.id, fallbackSummary, cardOrIdent, verifyBiometric);
      await loadCurrentSite();
    } else {
      showToast(res.error || t('toastSaveFailed'));
    }
  });

  detailBodyEl.appendChild(form);
}

function renderLiveTotpCard(itemId, verifyBiometric = false) {
  const card = document.createElement('div');
  card.className = 'card';
  const st = document.createElement('div');
  st.className = 'detail-section-title';
  st.textContent = t('totpSectionTitle');

  const row = document.createElement('div');
  row.className = 'totp-row';
  const codeEl = document.createElement('div');
  codeEl.className = 'totp-code-text';
  codeEl.textContent = '------';
  const right = document.createElement('div');
  right.className = 'detail-field-actions';
  const timerEl = document.createElement('span');
  timerEl.className = 'totp-timer-pill';
  timerEl.textContent = '--s';
  const copyBtn = document.createElement('button');
  copyBtn.type = 'button';
  copyBtn.className = 'btn btn-secondary btn-sm';
  copyBtn.textContent = t('btnCopy');
  let latestCode = '';
  copyBtn.addEventListener('click', () => void copyText(latestCode, `2FA (${latestCode})`));

  right.append(timerEl, copyBtn);
  row.append(codeEl, right);
  card.append(st, row);
  detailBodyEl.appendChild(card);

  let remaining = 0;
  async function refreshTotp() {
    const res = await sendBg({ type: 'TOTP', itemId, verifyBiometric });
    if (res.ok && res.result?.code) {
      latestCode = res.result.code;
      codeEl.textContent = res.result.formattedCode || res.result.code;
      remaining = Number(res.result.remainingSeconds || 30);
      timerEl.textContent = `${remaining}s`;
    }
  }
  void refreshTotp();
  stopTotpTimer();
  totpInterval = setInterval(() => {
    if (remaining > 1) {
      remaining -= 1;
      timerEl.textContent = `${remaining}s`;
    } else {
      void refreshTotp();
    }
  }, 1000);
}

// ==================== Settings View ====================

function getLocalPrivacyServicesApi() {
  if (typeof browser !== 'undefined' && browser.privacy?.services) {
    return browser.privacy.services;
  }
  return chrome.privacy?.services || null;
}

function getLocalPrivacySettingApi() {
  return getLocalPrivacyServicesApi()?.passwordSavingEnabled || null;
}

function privacyApiGet(setting) {
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

function privacyApiSet(setting, value) {
  return new Promise((resolve) => {
    if (!setting) {
      resolve(false);
      return;
    }
    try {
      setting.set({ value, scope: 'regular' }, () => {
        resolve(!chrome.runtime.lastError);
      });
    } catch {
      resolve(false);
    }
  });
}

function privacyApiClear(setting) {
  return new Promise((resolve) => {
    if (!setting) {
      resolve(false);
      return;
    }
    try {
      setting.clear({ scope: 'regular' }, () => {
        resolve(!chrome.runtime.lastError);
      });
    } catch {
      resolve(false);
    }
  });
}

async function getPrivacyStatusUnified() {
  const pwSetting = getLocalPrivacySettingApi();
  if (pwSetting) {
    const details = await privacyApiGet(pwSetting);
    const level = details?.levelOfControl || 'controllable_by_this_extension';
    return {
      ok: true,
      supported: true,
      reason: null,
      enabled: level === 'controlled_by_this_extension' && details?.value === false,
      value: details?.value ?? null,
      levelOfControl: level
    };
  }

  const bgResp = await sendBg({ type: 'GET_PRIVACY_CONTROL' });
  if (bgResp && bgResp.supported) {
    return bgResp;
  }

  const hasManifestPrivacy = Boolean(
    chrome.runtime?.getManifest?.()?.permissions?.includes('privacy')
  );
  const needsReload =
    !hasManifestPrivacy || bgResp?.error === 'Unknown message type';
  return {
    ok: Boolean(bgResp?.ok),
    supported: false,
    reason: bgResp?.reason || (needsReload ? 'manifest_needs_reload' : 'api_unavailable'),
    enabled: false,
    value: null,
    levelOfControl: bgResp?.levelOfControl || 'not_controllable'
  };
}

async function setPrivacyControlUnified(enabled) {
  const services = getLocalPrivacyServicesApi();
  const pwSetting = services?.passwordSavingEnabled || null;
  const cardSetting = services?.autofillCreditCardEnabled || null;
  if (pwSetting) {
    try {
      await chrome.storage.local.set({ takeoverBrowserPasswordManager: Boolean(enabled) });
    } catch {
      // ignore storage failure
    }
    if (enabled) {
      await privacyApiSet(pwSetting, false);
      if (cardSetting) {
        await privacyApiSet(cardSetting, false);
      }
    } else {
      await privacyApiClear(pwSetting);
      if (cardSetting) {
        await privacyApiClear(cardSetting);
      }
    }
    return getPrivacyStatusUnified();
  }

  const bgResp = await sendBg({ type: 'SET_PRIVACY_CONTROL', enabled: Boolean(enabled) });
  if (bgResp && bgResp.supported) {
    return bgResp;
  }
  return getPrivacyStatusUnified();
}

function renderPrivacyStatus(resp) {
  takeoverStatusEl.className = 'takeover-status';
  if (!resp || !resp.supported) {
    takeoverToggleEl.checked = false;
    takeoverToggleEl.disabled = true;
    takeoverStatusEl.classList.add('warn');
    const needsReload = resp?.reason === 'manifest_needs_reload';
    takeoverStatusEl.textContent = needsReload
      ? t('takeoverNeedsReload')
      : t('takeoverUnsupported');
    if (reloadExtBtn) {
      reloadExtBtn.classList.toggle('hidden', !needsReload);
    }
    return;
  }
  if (reloadExtBtn) {
    reloadExtBtn.classList.add('hidden');
  }
  takeoverToggleEl.disabled = resp.levelOfControl === 'not_controllable';
  takeoverToggleEl.checked = Boolean(resp.enabled);
  const level = resp.levelOfControl;
  if (level === 'not_controllable') {
    takeoverStatusEl.classList.add('warn');
    takeoverStatusEl.textContent = t('takeoverNotControllable');
  } else if (level === 'controlled_by_this_extension') {
    takeoverStatusEl.classList.add('ok');
    takeoverStatusEl.textContent = t('takeoverControlledSelf');
  } else if (level === 'controlled_by_other_extensions') {
    takeoverStatusEl.classList.add('warn');
    takeoverStatusEl.textContent = t('takeoverControlledOther');
  } else {
    takeoverStatusEl.classList.add('muted');
    takeoverStatusEl.textContent = t('takeoverOff');
  }
}

function renderNeverSaveOrigins(origins) {
  const list = Array.isArray(origins) ? origins : [];
  neverSaveListEl.textContent = '';
  neverSaveEmptyEl.classList.toggle('hidden', list.length > 0);

  for (const orig of list) {
    const row = document.createElement('div');
    row.className = 'never-save-row';
    const label = document.createElement('span');
    label.textContent = orig;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-secondary btn-sm';
    btn.textContent = t('btnRemove');
    btn.addEventListener('click', async () => {
      const rem = await sendBg({ type: 'NEVER_SAVE_REMOVE', origin: orig });
      if (Array.isArray(rem.origins)) {
        renderNeverSaveOrigins(rem.origins);
      } else {
        await refreshNeverSaveList();
      }
    });
    row.append(label, btn);
    neverSaveListEl.appendChild(row);
  }
}

async function refreshNeverSaveList() {
  const res = await sendBg({ type: 'NEVER_SAVE_LIST' });
  renderNeverSaveOrigins(res.origins);
}

async function openSettingsView() {
  hideAllMainViews();
  settingsViewEl.classList.remove('hidden');
  settingsExtIdEl.textContent = chrome.runtime.id;
  if (langSelectEl && i18n) {
    langSelectEl.value = i18n.getLanguageMode();
  }
  const pRes = await getPrivacyStatusUnified();
  renderPrivacyStatus(pRes);
  await refreshNeverSaveList();
}

// ==================== Cards & Lists ====================

function createItemCard(item, isVaultSummary = false) {
  const card = document.createElement('div');
  card.className = 'item-card';

  const top = document.createElement('div');
  top.className = 'item-top';
  top.title = t('clickViewDetails');
  top.addEventListener('click', () => {
    void openDetailView(item.id, item, null);
  });

  const meta = document.createElement('div');
  meta.className = 'item-meta';

  const titleEl = document.createElement('div');
  titleEl.className = 'item-title';
  titleEl.textContent = item.title || t('unnamedItem');

  const userEl = document.createElement('div');
  userEl.className = 'item-username';
  userEl.textContent = item.username || item.subtitle || t('clickViewDetails');

  meta.append(titleEl, userEl);
  top.appendChild(meta);

  const badges = document.createElement('div');
  badges.className = 'item-badges';
  if (item.reprompt) {
    const b = document.createElement('span');
    b.className = 'mini-badge';
    b.textContent = t('repromptBadge');
    badges.appendChild(b);
  }
  if (item.ssoProvider) {
    const b = document.createElement('span');
    b.className = 'mini-badge';
    b.textContent = t('ssoBadgePrefix', { provider: item.ssoProvider });
    badges.appendChild(b);
  }
  if (item.hasPasskey) {
    const b = document.createElement('span');
    b.className = 'mini-badge';
    b.textContent = 'Passkey';
    badges.appendChild(b);
  }
  if (item.hasTotp || item.totp) {
    const b = document.createElement('span');
    b.className = 'mini-badge';
    b.textContent = '2FA';
    badges.appendChild(b);
  }
  const chev = document.createElement('span');
  chev.className = 'chevron';
  chev.textContent = '›';
  badges.appendChild(chev);

  top.appendChild(badges);
  card.appendChild(top);

  const actions = document.createElement('div');
  actions.className = 'item-actions';

  const fillBtn = document.createElement('button');
  fillBtn.className = 'btn btn-primary btn-sm';
  fillBtn.textContent = t('btnAutofill');
  fillBtn.addEventListener('click', () => void autofillSummaryItem(item, isVaultSummary));
  actions.appendChild(fillBtn);

  const detailBtn = document.createElement('button');
  detailBtn.className = 'btn btn-secondary btn-sm';
  detailBtn.textContent = t('btnDetails');
  detailBtn.addEventListener('click', () => void openDetailView(item.id, item, null));
  actions.appendChild(detailBtn);

  const copyPwBtn = document.createElement('button');
  copyPwBtn.className = 'btn btn-secondary btn-sm';
  copyPwBtn.textContent = t('btnCopyPassword');
  copyPwBtn.addEventListener('click', async () => {
    if (item.reprompt) {
      showToast(t('toastRepromptDesktop'));
      return;
    }
    let pw = item.password || '';
    if (!pw) {
      const g = await sendBg({ type: 'ITEM_GET', itemId: item.id });
      pw = g.result?.password || '';
    }
    await copyText(pw, t('labelPassword'));
  });
  actions.appendChild(copyPwBtn);

  if (item.hasTotp || item.totp) {
    const copyTotpBtn = document.createElement('button');
    copyTotpBtn.className = 'btn btn-secondary btn-sm';
    copyTotpBtn.textContent = '2FA';
    copyTotpBtn.addEventListener('click', async () => {
      if (item.reprompt) {
        showToast(t('toastRepromptDesktop'));
        return;
      }
      const res = await sendBg({ type: 'TOTP', itemId: item.id });
      const code = res.ok ? res.result?.code : item.totp;
      await copyText(code || '', `2FA (${code || ''})`);
    });
    actions.appendChild(copyTotpBtn);
  }

  card.appendChild(actions);
  return card;
}

async function loadCurrentSite() {
  currentListEl.textContent = '';
  const url = activeTab?.url || '';
  if (!isHttpUrl(url)) {
    currentEmptyEl.classList.remove('hidden');
    return;
  }
  const matched = await sendBg({ type: 'URL_MATCH', url });
  const items = matched.ok && Array.isArray(matched.result) ? matched.result : [];
  if (items.length === 0) {
    currentEmptyEl.classList.remove('hidden');
  } else {
    currentEmptyEl.classList.add('hidden');
    for (const item of items) {
      currentListEl.appendChild(createItemCard(item, false));
    }
  }
}

async function loadVaultSearch() {
  const res = await sendBg({ type: 'SEARCH', query: searchInput.value || '' });
  const rawItems = res.ok && Array.isArray(res.result) ? res.result : [];
  const filtered = rawItems.filter((item) => {
    if (activeVaultCategory === 'all') return true;
    if (activeVaultCategory === 'passkey') return Boolean(item.hasPasskey || item.category === 'passkey');
    return item.category === activeVaultCategory;
  });

  vaultListEl.textContent = '';
  if (filtered.length === 0) {
    vaultEmptyEl.classList.remove('hidden');
    return;
  }
  vaultEmptyEl.classList.add('hidden');
  for (const item of filtered.slice(0, 40)) {
    vaultListEl.appendChild(createItemCard(item, true));
  }
}

async function runGenerator() {
  if (genMode === 'masked_email') {
    genOutputEl.textContent = t('genGenerating');
    const url = activeTab?.url || '';
    const domain = isHttpUrl(url) ? extractHostname(url) : '';
    const res = await sendBg({
      type: 'GENERATE_MASKED_EMAIL',
      domain,
      url: isHttpUrl(url) ? url : ''
    });
    const emailVal = res.result?.email || res.result?.value;
    if (res.ok && emailVal) {
      currentGeneratedValue = emailVal;
      genOutputEl.textContent = currentGeneratedValue;
      genStrengthEl.textContent = t('genMaskedBadge');
    } else {
      genOutputEl.textContent = res.error || t('genFailed');
    }
    return;
  }

  const len = Number(genLenRange.value || 20);
  const res = await sendBg({
    type: 'GENERATE',
    options: {
      mode: genMode,
      length: len,
      wordCount: len,
      pinLength: len,
      includeDigits: genDigitsEl.checked,
      includeSymbols: genSymbolsEl.checked,
      excludeAmbiguous: genAmbigEl.checked
    }
  });
  if (res.ok && res.result?.value) {
    currentGeneratedValue = res.result.value;
    genOutputEl.textContent = currentGeneratedValue;
    const score = res.result.strength?.score;
    const strengthText =
      typeof score === 'number' && score >= 0 && score <= 4
        ? t(`genStrength${score}`)
        : t('genStrength3');
    genStrengthEl.textContent = `${strengthText} (${res.result.strength?.entropyBits || 0}b)`;
  } else {
    genOutputEl.textContent = res.error || t('genFailed');
  }
}

function updateGeneratorControlsForMode() {
  const isPw = genMode === 'password';
  const isPhrase = genMode === 'passphrase';
  const isMasked = genMode === 'masked_email';
  const lenRow = genLenRange.closest('.control-row');
  if (lenRow) {
    lenRow.classList.toggle('hidden', isMasked);
  }
  optDigitsWrap.classList.toggle('hidden', !isPw);
  optSymbolsWrap.classList.toggle('hidden', !isPw);
  optAmbigWrap.classList.toggle('hidden', !isPw);

  if (isMasked) {
    return;
  }

  genLenLabel.textContent = isPhrase
    ? t('genWordsLabel')
    : genMode === 'pin'
      ? t('genDigitsLabel')
      : t('genLenLabel');
  const strong = document.createElement('strong');
  strong.id = 'gen-len-val';
  strong.textContent = isPhrase ? '5' : genMode === 'pin' ? '6' : '20';
  genLenLabel.appendChild(strong);

  if (isPhrase) {
    genLenRange.min = '3';
    genLenRange.max = '10';
    genLenRange.value = '5';
  } else if (genMode === 'pin') {
    genLenRange.min = '4';
    genLenRange.max = '12';
    genLenRange.value = '6';
  } else {
    genLenRange.min = '8';
    genLenRange.max = '48';
    genLenRange.value = '20';
  }
}

async function init() {
  if (i18n) {
    await i18n.ready();
    i18n.applyDom(document);
  }
  updateGeneratorControlsForMode();

  const extId = chrome.runtime.id;
  extIdTextEl.textContent = extId;
  installCmdEl.textContent = `ks install-nmh --chrome ${extId}`;

  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTab = tabs[0] || null;
  domainLabel.textContent = activeTab?.url ? extractHostname(activeTab.url) : t('domainCurrentPage');
  addTitleInput.value = activeTab?.url ? extractHostname(activeTab.url) : '';

  const st = await sendBg({ type: 'STATUS' });
  if (st.ok && st.result?.language && i18n?.syncFromDesktop) {
    await i18n.syncFromDesktop(st.result.language);
    i18n.applyDom(document);
    updateGeneratorControlsForMode();
  }
  const connected = Boolean(st.connected);
  const sessionStatus = st.result?.status || 'Disconnected';
  renderStatus(connected, sessionStatus);

  isVaultUnlocked = Boolean(connected && st.ok && sessionStatus === 'Unlocked');
  hideAllMainViews();

  const unlockBiometricBtn = document.getElementById('unlock-biometric-btn');
  const unlockOpenBtn = document.getElementById('unlock-open-btn');
  const showBiometricUnlock = Boolean(connected && sessionStatus === 'Locked' && st.result?.biometricEnabled);
  if (unlockBiometricBtn && unlockOpenBtn) {
    unlockBiometricBtn.classList.toggle('hidden', !showBiometricUnlock);
    unlockBiometricBtn.disabled = false;
    unlockBiometricBtn.textContent = t('btnUnlockTouchId');
    unlockOpenBtn.classList.toggle('btn-primary', !showBiometricUnlock);
    unlockOpenBtn.classList.toggle('btn-secondary', showBiometricUnlock);
  }

  if (!connected) {
    lockedTitle.textContent = t('disconnectedTitle');
    lockedDesc.textContent = t('disconnectedDesc');
    advancedNmh.classList.remove('hidden');
    lockedPanel.classList.remove('hidden');
    return;
  }

  if (!isVaultUnlocked) {
    lockedTitle.textContent =
      sessionStatus === 'Locked' ? t('lockedTitleDesktop') : t('lockedTitleSignedOut');
    lockedDesc.textContent = t('lockedDescDesktop');
    advancedNmh.classList.add('hidden');
    lockedPanel.classList.remove('hidden');
    return;
  }

  switchTab(currentTabName);
  await loadCurrentSite();
}

// Header & Navigation Events
document.getElementById('refresh-btn').addEventListener('click', () => void init());
document.getElementById('retry-connect-btn').addEventListener('click', () => void init());
document.getElementById('open-app-btn').addEventListener('click', () => void sendBg({ type: 'OPEN_DESKTOP' }));
document.getElementById('unlock-open-btn').addEventListener('click', () => void sendBg({ type: 'OPEN_DESKTOP' }));
const unlockBioBtnEl = document.getElementById('unlock-biometric-btn');
if (unlockBioBtnEl) {
  unlockBioBtnEl.addEventListener('click', async () => {
    unlockBioBtnEl.disabled = true;
    unlockBioBtnEl.textContent = t('btnUnlockingTouchId');
    const res = await sendBg({ type: 'UNLOCK_BIOMETRIC' });
    if (res && res.ok) {
      await init();
      return;
    }
    unlockBioBtnEl.disabled = false;
    unlockBioBtnEl.textContent = t('btnUnlockTouchId');
    showToast(res?.error || t('toastTouchIdFailed'));
  });
}
document.getElementById('copy-cmd-btn').addEventListener('click', () =>
  void copyText(installCmdEl.textContent, t('labelTroubleshootCmd'))
);

if (langSelectEl && i18n) {
  langSelectEl.addEventListener('change', async () => {
    await i18n.setLanguageMode(langSelectEl.value);
    i18n.applyDom(document);
    updateGeneratorControlsForMode();
    if (currentGeneratedValue) {
      await runGenerator();
    }
    const pRes = await getPrivacyStatusUnified();
    renderPrivacyStatus(pRes);
    showToast(t('langSaved'));
  });
}

document.getElementById('settings-btn').addEventListener('click', () => {
  if (!settingsViewEl.classList.contains('hidden')) {
    switchTab(currentTabName);
  } else {
    void openSettingsView();
  }
});
document.getElementById('settings-back-btn').addEventListener('click', () => switchTab(currentTabName));
document.getElementById('detail-back-btn').addEventListener('click', () => switchTab(currentTabName));
document.getElementById('detail-desktop-btn').addEventListener('click', () => {
  if (currentDetailItem?.id) {
    void sendBg({ type: 'FOCUS_DESKTOP_ITEM', itemId: currentDetailItem.id });
  } else {
    void sendBg({ type: 'OPEN_DESKTOP' });
  }
});

takeoverToggleEl.addEventListener('change', async () => {
  const res = await setPrivacyControlUnified(takeoverToggleEl.checked);
  renderPrivacyStatus(res);
});

if (reloadExtBtn) {
  reloadExtBtn.addEventListener('click', () => {
    try {
      chrome.runtime.reload();
    } catch {
      window.close();
    }
  });
}

for (const btn of document.querySelectorAll('.tab-btn')) {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
}

// Quick Add Current Site Login
document.getElementById('toggle-add-btn').addEventListener('click', () => {
  quickAddForm.classList.toggle('hidden');
});
document.getElementById('cancel-add-btn').addEventListener('click', () => {
  quickAddForm.classList.add('hidden');
});
document.getElementById('add-gen-pw-btn').addEventListener('click', async () => {
  const g = await sendBg({
    type: 'GENERATE',
    options: { mode: 'password', length: 20, includeDigits: true, includeSymbols: true, excludeAmbiguous: true }
  });
  if (g.ok && g.result?.value) {
    addPwInput.type = 'text';
    addPwInput.value = g.result.value;
    showToast(t('toastGeneratedStrong'));
  }
});

quickAddForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const url = activeTab?.url || '';
  if (!isHttpUrl(url)) {
    showToast(t('toastHttpOnlyAdd'));
    return;
  }
  const res = await sendBg({
    type: 'SAVE_LOGIN',
    url,
    origin: new URL(url).origin,
    title: addTitleInput.value.trim() || extractHostname(url),
    username: addUserInput.value.trim(),
    password: addPwInput.value
  });
  if (res.ok) {
    addPwInput.value = '';
    quickAddForm.classList.add('hidden');
    showToast(t('toastSavedKeysmith'));
    await loadCurrentSite();
  } else {
    showToast(res.error || t('toastSaveFailed'));
  }
});

// Vault Search & Filter
let searchTimer = null;
searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => void loadVaultSearch(), 140);
});
for (const pill of document.querySelectorAll('.filter-pills .pill-btn')) {
  pill.addEventListener('click', () => {
    for (const p of document.querySelectorAll('.filter-pills .pill-btn')) {
      p.classList.remove('active');
    }
    pill.classList.add('active');
    activeVaultCategory = pill.dataset.cat || 'all';
    void loadVaultSearch();
  });
}

// Generator Events
for (const modeBtn of document.querySelectorAll('.gen-mode-row .pill-btn')) {
  modeBtn.addEventListener('click', () => {
    for (const b of document.querySelectorAll('.gen-mode-row .pill-btn')) {
      b.classList.remove('active');
    }
    modeBtn.classList.add('active');
    genMode = modeBtn.dataset.mode || 'password';
    updateGeneratorControlsForMode();
    void runGenerator();
  });
}
genLenRange.addEventListener('input', () => {
  const valEl = document.getElementById('gen-len-val');
  if (valEl) valEl.textContent = genLenRange.value;
  void runGenerator();
});
for (const chk of [genDigitsEl, genSymbolsEl, genAmbigEl]) {
  chk.addEventListener('change', () => void runGenerator());
}
document.getElementById('gen-regen-btn').addEventListener('click', () => void runGenerator());
document.getElementById('gen-copy-btn').addEventListener('click', () =>
  void copyText(
    currentGeneratedValue,
    genMode === 'masked_email' ? t('modeMaskedEmail') : t('labelPassword')
  )
);
document.getElementById('gen-fill-btn').addEventListener('click', async () => {
  if (!currentGeneratedValue) return;
  await copyText(
    currentGeneratedValue,
    genMode === 'masked_email' ? t('modeMaskedEmail') : t('labelPassword')
  );
  if (activeTab?.id && isHttpUrl(activeTab?.url || '')) {
    const res =
      genMode === 'masked_email'
        ? await sendBg({
            type: 'FILL_USERNAME_ACTIVE_TAB',
            tabId: activeTab.id,
            username: currentGeneratedValue
          })
        : await sendBg({
            type: 'FILL_GENERATED_ACTIVE_TAB',
            tabId: activeTab.id,
            password: currentGeneratedValue
          });
    if (res.ok) {
      showToast(t('toastGenAndFilled'));
      setTimeout(() => window.close(), 380);
    }
  }
});

void init();
