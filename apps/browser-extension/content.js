(() => {
  if (window.__KEYSMITH_CONTENT_LOADED__) {
    return;
  }
  window.__KEYSMITH_CONTENT_LOADED__ = true;

  const isWeb =
    window.location.protocol === 'https:' || window.location.protocol === 'http:';

  function sendMsg(msg) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (resp) => {
          if (chrome.runtime.lastError) {
            resolve({ ok: false, connected: false, error: chrome.runtime.lastError.message });
            return;
          }
          resolve(resp || {});
        });
      } catch (err) {
        resolve({ ok: false, connected: false, error: err?.message });
      }
    });
  }

  // ==================== Framework-safe DOM Input Setter ====================

  function setNativeValue(el, value) {
    if (!el || value == null) return;
    try {
      const proto =
        el instanceof HTMLSelectElement
          ? HTMLSelectElement.prototype
          : el instanceof HTMLTextAreaElement
            ? HTMLTextAreaElement.prototype
            : HTMLInputElement.prototype;
      const descriptor = Object.getOwnPropertyDescriptor(proto, 'value');
      if (descriptor && typeof descriptor.set === 'function') {
        descriptor.set.call(el, value);
      } else {
        el.value = value;
      }
      el.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
      el.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
      el.dispatchEvent(new Event('blur', { bubbles: true }));
    } catch {
      el.value = value;
    }
  }

  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    if (el.disabled || el.readOnly) return false;
    const style = window.getComputedStyle(el);
    if (
      style.display === 'none' ||
      style.visibility === 'hidden' ||
      parseFloat(style.opacity || '1') === 0
    ) {
      return false;
    }
    const rect = el.getBoundingClientRect();
    return rect.width >= 48 && rect.height >= 18;
  }

  function fieldHints(el) {
    const labelText = el.labels
      ? Array.from(el.labels)
          .map((l) => l.textContent || '')
          .join(' ')
      : '';
    return [
      el.name || '',
      el.id || '',
      el.placeholder || '',
      el.getAttribute('aria-label') || '',
      el.getAttribute('autocomplete') || '',
      labelText
    ]
      .join(' ')
      .toLowerCase();
  }

  function classifyAuthField(el, allInputs) {
    if (!(el instanceof HTMLInputElement)) return null;
    const type = (el.type || 'text').toLowerCase();
    const ac = (el.getAttribute('autocomplete') || '').toLowerCase();
    const hints = fieldHints(el);

    if (type === 'password') {
      const isNew =
        ac.includes('new-password') ||
        /(new.?pass|confirm|repeat|retype|verify|signup|register|create.?pass|新密码|确认密码)/.test(
          hints
        );
      return isNew ? 'new-password' : 'password';
    }

    if (
      ['text', 'tel', 'number'].includes(type) &&
      (ac === 'one-time-code' ||
        /(totp|2fa|mfa|otp|auth.?code|verif.?code|验证码|动态口令|安全码)/.test(hints)) &&
      !/(card|cvv|csc|zip|postal)/.test(hints)
    ) {
      return 'totp';
    }

    if (['email', 'text', 'tel'].includes(type)) {
      if (
        ac === 'username' ||
        ac === 'email' ||
        type === 'email' ||
        /(user|username|email|e-mail|login|account|member|uid|phone|mobile|手机|邮箱|账号|用户名)/.test(
          hints
        )
      ) {
        if (!/(search|filter|query|coupon|promo|card|cvv|zip|postal)/.test(hints)) {
          return 'username';
        }
      }
      // Heuristic: visible text input immediately preceding a password field in the same form/container
      const scope = el.form || el.closest('div, section, main') || document;
      const hasSiblingPw = Array.from(scope.querySelectorAll('input[type="password"]')).some(
        (pw) => isVisible(pw)
      );
      if (hasSiblingPw && !/(search|filter|captcha|code|otp)/.test(hints)) {
        const idxSelf = allInputs.indexOf(el);
        const nextPw = allInputs.findIndex(
          (inp, idx) => idx > idxSelf && inp.type === 'password'
        );
        if (nextPw !== -1 && nextPw - idxSelf <= 2) {
          return 'username';
        }
      }
    }

    return null;
  }

  function findFormInputs(anchorInput) {
    const scope =
      anchorInput?.form ||
      anchorInput?.closest('form, [role="dialog"], main, section') ||
      document;
    const visible = Array.from(scope.querySelectorAll('input')).filter(isVisible);
    const passwords = visible.filter((el) => el.type === 'password');
    const newPasswords = visible.filter(
      (el) => classifyAuthField(el, visible) === 'new-password'
    );
    const totps = visible.filter((el) => classifyAuthField(el, visible) === 'totp');
    const usernames = visible.filter((el) => classifyAuthField(el, visible) === 'username');
    return { visible, passwords, newPasswords, totps, usernames };
  }

  function autofillLogin(username, password, totp, anchorInput) {
    const allVisible = Array.from(document.querySelectorAll('input')).filter(isVisible);
    if (allVisible.length === 0) {
      return { ok: false, error: '当前页面没有可见的登录输入框' };
    }

    const scoped = findFormInputs(anchorInput);
    const targetPw =
      (anchorInput?.type === 'password' ? anchorInput : null) ||
      scoped.passwords[0] ||
      allVisible.find((el) => el.type === 'password');
    const targetUser =
      (anchorInput && classifyAuthField(anchorInput, allVisible) === 'username'
        ? anchorInput
        : null) ||
      scoped.usernames[0] ||
      allVisible.find((el) => classifyAuthField(el, allVisible) === 'username') ||
      (targetPw
        ? allVisible
            .slice(0, allVisible.indexOf(targetPw))
            .reverse()
            .find((el) => ['text', 'email', 'tel'].includes((el.type || 'text').toLowerCase()))
        : null);
    const targetTotp =
      scoped.totps[0] ||
      allVisible.find((el) => classifyAuthField(el, allVisible) === 'totp');

    let filled = 0;
    if (username && targetUser) {
      markProgrammaticFill(targetUser);
      setNativeValue(targetUser, username);
      filled += 1;
    }
    if (password && targetPw) {
      markProgrammaticFill(targetPw);
      setNativeValue(targetPw, password);
      filled += 1;
    }
    if (totp && targetTotp) {
      markProgrammaticFill(targetTotp);
      setNativeValue(targetTotp, totp);
      filled += 1;
    }

    if (filled === 0) {
      return { ok: false, error: '未匹配到可填充的用户名、密码或验证码输入框' };
    }
    return { ok: true, filled };
  }

  function autofillGeneratedPassword(password, anchorInput) {
    if (!password) return { ok: false, error: '缺少密码' };
    const allVisible = Array.from(document.querySelectorAll('input')).filter(isVisible);
    const scoped = findFormInputs(anchorInput);
    const candidates =
      scoped.passwords.length > 0
        ? scoped.passwords
        : allVisible.filter((el) => el.type === 'password');
    if (candidates.length === 0) {
      return { ok: false, error: '当前页面未找到密码输入框' };
    }
    for (const pwInput of candidates) {
      markProgrammaticFill(pwInput);
      setNativeValue(pwInput, password);
    }
    return { ok: true, filled: candidates.length };
  }

  function autofillCreditCard(card) {
    const controls = Array.from(document.querySelectorAll('input, select')).filter(isVisible);
    let filled = 0;
    for (const el of controls) {
      const ac = (el.getAttribute('autocomplete') || '').toLowerCase();
      const hints = fieldHints(el);
      if (
        card.number &&
        (ac === 'cc-number' || /(card.?num|cc.?num|卡号|pan)/.test(hints))
      ) {
        setNativeValue(el, card.number);
        filled += 1;
      } else if (
        card.holder &&
        (ac === 'cc-name' || /(card.?holder|cc.?name|持卡人|name on card)/.test(hints))
      ) {
        setNativeValue(el, card.holder);
        filled += 1;
      } else if (card.cvv && (ac === 'cc-csc' || /(cvv|cvc|csc|安全码|security code)/.test(hints))) {
        setNativeValue(el, card.cvv);
        filled += 1;
      } else if (
        (card.expMonth || card.expiry) &&
        (ac === 'cc-exp' || /(expir|valid thru|有效期|mm.?yy)/.test(hints)) &&
        !ac.includes('month') &&
        !ac.includes('year')
      ) {
        const mmYY =
          card.expMonth && card.expYear
            ? `${card.expMonth.padStart(2, '0')}/${card.expYear.slice(-2)}`
            : card.expiry;
        setNativeValue(el, mmYY);
        filled += 1;
      } else if (card.expMonth && (ac === 'cc-exp-month' || /(exp.?month|月)/.test(hints))) {
        setNativeValue(el, card.expMonth);
        filled += 1;
      } else if (card.expYear && (ac === 'cc-exp-year' || /(exp.?year|年)/.test(hints))) {
        setNativeValue(el, card.expYear);
        filled += 1;
      }
    }
    return filled > 0
      ? { ok: true, filled }
      : { ok: false, error: '当前页面未找到银行卡输入框' };
  }

  function autofillIdentity(ident) {
    const controls = Array.from(
      document.querySelectorAll('input, select, textarea')
    ).filter(isVisible);
    let filled = 0;
    for (const el of controls) {
      const ac = (el.getAttribute('autocomplete') || '').toLowerCase();
      const hints = fieldHints(el);
      if (ident.email && (ac === 'email' || el.type === 'email' || /(email|邮箱)/.test(hints))) {
        setNativeValue(el, ident.email);
        filled += 1;
      } else if (ident.phone && (ac === 'tel' || el.type === 'tel' || /(phone|mobile|电话|手机)/.test(hints))) {
        setNativeValue(el, ident.phone);
        filled += 1;
      } else if (ident.firstName && (ac === 'given-name' || /(first.?name|名)/.test(hints))) {
        setNativeValue(el, ident.firstName);
        filled += 1;
      } else if (ident.lastName && (ac === 'family-name' || /(last.?name|姓)/.test(hints))) {
        setNativeValue(el, ident.lastName);
        filled += 1;
      } else if (ident.fullName && (ac === 'name' || /(full.?name|姓名)/.test(hints))) {
        setNativeValue(el, ident.fullName);
        filled += 1;
      } else if (ident.company && (ac === 'organization' || /(company|org|公司)/.test(hints))) {
        setNativeValue(el, ident.company);
        filled += 1;
      } else if (ident.address && (ac === 'street-address' || /(address|street|地址)/.test(hints))) {
        setNativeValue(el, ident.address);
        filled += 1;
      }
    }
    return filled > 0
      ? { ok: true, filled }
      : { ok: false, error: '当前页面未找到身份信息输入框' };
  }

  // ==================== Shadow DOM Overlay UI ====================

  let shadowRoot = null;
  let iconLayer = null;
  let dropdownContainer = null;
  let bannerContainer = null;
  let modalContainer = null;
  let toastContainer = null;

  const OVERLAY_CSS = `
    :host {
      all: initial;
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "PingFang SC", "Segoe UI", sans-serif;
    }
    * {
      box-sizing: border-box;
    }
    .ks-vars {
      --ks-bg: #ffffff;
      --ks-bg-subtle: #f3f5f8;
      --ks-bg-hover: rgba(5, 114, 236, 0.08);
      --ks-border: rgba(15, 23, 42, 0.12);
      --ks-text: #181a1f;
      --ks-text-sec: #5c6470;
      --ks-accent: #0572ec;
      --ks-accent-hover: #0461ca;
      --ks-accent-soft: rgba(5, 114, 236, 0.12);
      --ks-success: #16a34a;
      --ks-warn: #d97706;
      --ks-shadow: 0 12px 36px rgba(15, 23, 42, 0.18), 0 2px 8px rgba(15, 23, 42, 0.08);
    }
    @media (prefers-color-scheme: dark) {
      .ks-vars {
        --ks-bg: #22262c;
        --ks-bg-subtle: #2b3038;
        --ks-bg-hover: rgba(59, 147, 255, 0.14);
        --ks-border: rgba(255, 255, 255, 0.14);
        --ks-text: #f1f3f5;
        --ks-text-sec: #9ba3b0;
        --ks-accent: #3b93ff;
        --ks-accent-hover: #58a4ff;
        --ks-accent-soft: rgba(59, 147, 255, 0.2);
        --ks-success: #4ade80;
        --ks-warn: #fbbf24;
        --ks-shadow: 0 14px 40px rgba(0, 0, 0, 0.5), 0 2px 8px rgba(0, 0, 0, 0.3);
      }
    }
    .ks-icon-btn {
      position: fixed;
      width: 22px;
      height: 22px;
      padding: 0;
      border-radius: 6px;
      border: 1px solid var(--ks-border);
      background: var(--ks-bg);
      color: var(--ks-accent);
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      pointer-events: auto;
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.12);
      transition: transform 0.1s ease, background-color 0.12s ease;
    }
    .ks-icon-btn:hover {
      transform: scale(1.06);
      background: var(--ks-accent-soft);
    }
    .ks-icon-count {
      position: absolute;
      top: -5px;
      right: -5px;
      min-width: 14px;
      height: 14px;
      padding: 0 3px;
      border-radius: 999px;
      background: var(--ks-accent);
      color: #fff;
      font-size: 9.5px;
      font-weight: 700;
      line-height: 14px;
      text-align: center;
    }
    .ks-dropdown {
      position: fixed;
      width: 296px;
      max-height: 320px;
      overflow-y: auto;
      background: var(--ks-bg);
      color: var(--ks-text);
      border: 1px solid var(--ks-border);
      border-radius: 11px;
      box-shadow: var(--ks-shadow);
      padding: 6px;
      pointer-events: auto;
      font-size: 13px;
    }
    .ks-dd-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 5px 8px 6px;
      font-size: 11px;
      font-weight: 600;
      color: var(--ks-text-sec);
      border-bottom: 1px solid var(--ks-border);
      margin-bottom: 4px;
    }
    .ks-dd-row {
      width: 100%;
      border: none;
      background: transparent;
      color: var(--ks-text);
      text-align: left;
      padding: 7px 8px;
      border-radius: 8px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      font-family: inherit;
    }
    .ks-dd-row:hover {
      background: var(--ks-bg-hover);
    }
    .ks-dd-gen {
      background: var(--ks-accent-soft);
      color: var(--ks-accent);
      margin-bottom: 4px;
    }
    .ks-dd-meta {
      min-width: 0;
      flex: 1;
    }
    .ks-dd-title {
      font-size: 13px;
      font-weight: 600;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .ks-dd-sub {
      font-size: 11.5px;
      color: var(--ks-text-sec);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .ks-pill {
      font-size: 10px;
      font-weight: 600;
      padding: 1px 6px;
      border-radius: 5px;
      background: var(--ks-accent-soft);
      color: var(--ks-accent);
      flex-shrink: 0;
    }
    .ks-dd-empty {
      padding: 10px 8px;
      font-size: 12px;
      color: var(--ks-text-sec);
      text-align: center;
    }
    .ks-banner {
      position: fixed;
      top: 16px;
      right: 16px;
      width: 344px;
      background: var(--ks-bg);
      color: var(--ks-text);
      border: 1px solid var(--ks-border);
      border-radius: 13px;
      box-shadow: var(--ks-shadow);
      padding: 14px;
      pointer-events: auto;
      font-size: 13px;
    }
    .ks-banner-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 10px;
      font-weight: 600;
      font-size: 13.5px;
    }
    .ks-field {
      margin-bottom: 8px;
    }
    .ks-field label {
      display: block;
      font-size: 11px;
      color: var(--ks-text-sec);
      margin-bottom: 3px;
    }
    .ks-input, .ks-select {
      width: 100%;
      padding: 6px 9px;
      border-radius: 7px;
      border: 1px solid var(--ks-border);
      background: var(--ks-bg-subtle);
      color: var(--ks-text);
      font-size: 12.5px;
      font-family: inherit;
      outline: none;
    }
    .ks-input:focus, .ks-select:focus {
      border-color: var(--ks-accent);
    }
    .ks-btn-row {
      display: flex;
      gap: 7px;
      margin-top: 10px;
      flex-wrap: wrap;
    }
    .ks-btn {
      border: none;
      border-radius: 8px;
      padding: 7px 12px;
      font-size: 12.5px;
      font-weight: 500;
      cursor: pointer;
      font-family: inherit;
    }
    .ks-btn-primary {
      background: var(--ks-accent);
      color: #ffffff;
      flex: 1;
    }
    .ks-btn-primary:hover {
      background: var(--ks-accent-hover);
    }
    .ks-btn-sec {
      background: var(--ks-bg-subtle);
      color: var(--ks-text);
      border: 1px solid var(--ks-border);
    }
    .ks-btn-ghost {
      background: transparent;
      color: var(--ks-text-sec);
      padding: 7px 8px;
    }
    .ks-modal-backdrop {
      position: fixed;
      inset: 0;
      background: rgba(10, 14, 20, 0.45);
      backdrop-filter: blur(3px);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 16px;
      pointer-events: auto;
    }
    .ks-modal {
      width: 100%;
      max-width: 400px;
      background: var(--ks-bg);
      color: var(--ks-text);
      border: 1px solid var(--ks-border);
      border-radius: 14px;
      box-shadow: var(--ks-shadow);
      padding: 18px;
      font-size: 13px;
    }
    .ks-modal-title {
      font-size: 15.5px;
      font-weight: 600;
      margin-bottom: 4px;
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .ks-modal-sub {
      font-size: 12.5px;
      color: var(--ks-text-sec);
      margin-bottom: 12px;
    }
    .ks-pk-list {
      display: flex;
      flex-direction: column;
      gap: 7px;
      max-height: 220px;
      overflow-y: auto;
      margin-bottom: 12px;
    }
    .ks-pk-item {
      width: 100%;
      text-align: left;
      padding: 10px 12px;
      border-radius: 10px;
      border: 1px solid var(--ks-border);
      background: var(--ks-bg-subtle);
      color: var(--ks-text);
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      font-family: inherit;
    }
    .ks-pk-item:hover {
      border-color: var(--ks-accent);
      background: var(--ks-accent-soft);
    }
    .ks-toast {
      position: fixed;
      bottom: 18px;
      right: 18px;
      background: var(--ks-bg);
      color: var(--ks-text);
      border: 1px solid var(--ks-border);
      border-left: 4px solid var(--ks-accent);
      border-radius: 10px;
      box-shadow: var(--ks-shadow);
      padding: 9px 14px;
      font-size: 12.5px;
      font-weight: 500;
      pointer-events: auto;
      max-width: 340px;
    }
    .ks-toast.success { border-left-color: var(--ks-success); }
    .ks-toast.warn { border-left-color: var(--ks-warn); }
  `;

  function ensureOverlay() {
    if (shadowRoot) return shadowRoot;
    const parent = document.documentElement || document.body;
    if (!parent) return null;

    const host = document.createElement('keysmith-overlay');
    host.id = 'keysmith-ext-root';
    host.setAttribute(
      'style',
      'all: initial; position: fixed; inset: 0; pointer-events: none; z-index: 2147483647;'
    );
    shadowRoot = host.attachShadow({ mode: 'closed' });

    const style = document.createElement('style');
    style.textContent = OVERLAY_CSS;

    const wrap = document.createElement('div');
    wrap.className = 'ks-vars';

    iconLayer = document.createElement('div');
    dropdownContainer = document.createElement('div');
    bannerContainer = document.createElement('div');
    modalContainer = document.createElement('div');
    toastContainer = document.createElement('div');

    wrap.append(iconLayer, dropdownContainer, bannerContainer, modalContainer, toastContainer);
    shadowRoot.append(style, wrap);
    parent.appendChild(host);
    return shadowRoot;
  }

  let toastTimer = null;
  function showToast(message, kind = 'info') {
    if (!ensureOverlay()) return;
    clearTimeout(toastTimer);
    toastContainer.textContent = '';
    const el = document.createElement('div');
    el.className = `ks-toast ${kind}`;
    el.textContent = message;
    toastContainer.appendChild(el);
    toastTimer = setTimeout(() => {
      toastContainer.textContent = '';
    }, 2800);
  }

  function createKeySvg(size = 14) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('width', String(size));
    svg.setAttribute('height', String(size));
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2.2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    const circle = document.createElementNS(ns, 'circle');
    circle.setAttribute('cx', '7.5');
    circle.setAttribute('cy', '15.5');
    circle.setAttribute('r', '4.5');
    const path1 = document.createElementNS(ns, 'path');
    path1.setAttribute('d', 'm21 2-9.6 9.6');
    const path2 = document.createElementNS(ns, 'path');
    path2.setAttribute('d', 'm15.5 7.5 3 3L22 7l-3-3');
    svg.append(circle, path1, path2);
    return svg;
  }

  // ==================== Inline Autofill Icons & Dropdown ====================

  let cachedPageData = { connected: false, status: 'Disconnected', matches: [], fetchedAt: 0 };
  let activeDropdownInput = null;
  let activeDropdownKind = null;
  const trackedInputs = new Set();
  let rafScheduled = false;

  async function fetchAutofillData(force = false) {
    if (!isWeb) return cachedPageData;
    const now = Date.now();
    if (!force && now - cachedPageData.fetchedAt < 4000) {
      return cachedPageData;
    }
    const resp = await sendMsg({
      type: 'GET_PAGE_AUTOFILL_DATA',
      url: window.location.href
    });
    cachedPageData = {
      connected: Boolean(resp.connected),
      status: resp.status || 'Disconnected',
      matches: Array.isArray(resp.matches) ? resp.matches : [],
      fetchedAt: Date.now()
    };
    scheduleIconRender();
    return cachedPageData;
  }

  function closeDropdown() {
    activeDropdownInput = null;
    activeDropdownKind = null;
    if (dropdownContainer) {
      dropdownContainer.textContent = '';
    }
  }

  async function openDropdownForInput(input, kind) {
    if (!ensureOverlay()) return;
    activeDropdownInput = input;
    activeDropdownKind = kind;

    const data = await fetchAutofillData(true);
    if (!activeDropdownInput) return;

    dropdownContainer.textContent = '';
    const dd = document.createElement('div');
    dd.className = 'ks-dropdown';

    const rect = input.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - 306));
    dd.style.left = `${left}px`;
    dd.style.top = `${rect.bottom + 6}px`;

    const head = document.createElement('div');
    head.className = 'ks-dd-header';
    const hostSpan = document.createElement('span');
    hostSpan.textContent = `Keysmith · ${window.location.hostname}`;
    const stSpan = document.createElement('span');
    stSpan.textContent =
      data.status === 'Unlocked'
        ? `${data.matches.length} 匹配`
        : data.connected
          ? '已锁定'
          : '未连接';
    head.append(hostSpan, stSpan);
    dd.appendChild(head);

    if (kind === 'new-password' || kind === 'password') {
      const genBtn = document.createElement('button');
      genBtn.type = 'button';
      genBtn.className = 'ks-dd-row ks-dd-gen';
      const meta = document.createElement('div');
      meta.className = 'ks-dd-meta';
      const t = document.createElement('div');
      t.className = 'ks-dd-title';
      t.textContent = '生成高强度密码并填充';
      const s = document.createElement('div');
      s.className = 'ks-dd-sub';
      s.textContent = '20 位随机强密码，自动复制到剪贴板';
      meta.append(t, s);
      genBtn.appendChild(meta);
      genBtn.addEventListener('mousedown', (e) => e.preventDefault());
      genBtn.addEventListener('click', async () => {
        const gRes = await sendMsg({
          type: 'GENERATE',
          options: {
            mode: 'password',
            length: 20,
            includeDigits: true,
            includeSymbols: true,
            excludeAmbiguous: true
          }
        });
        if (gRes.ok && gRes.result?.value) {
          await sendMsg({
            type: 'COPY_SECRET',
            value: gRes.result.value,
            label: '新生成密码'
          });
          autofillGeneratedPassword(gRes.result.value, input);
          showToast('已填充强密码并复制到剪贴板', 'success');
          closeDropdown();
        } else {
          showToast(gRes.error || '请先打开 Keysmith 桌面端', 'warn');
        }
      });
      dd.appendChild(genBtn);
    }

    if (kind === 'new-password') {
      dropdownContainer.appendChild(dd);
      const ddHeight = dd.getBoundingClientRect().height || 120;
      if (spaceBelow < ddHeight + 10 && rect.top > ddHeight + 12) {
        dd.style.top = '';
        dd.style.bottom = `${window.innerHeight - rect.top + 6}px`;
      }
      return;
    }

    if (!data.connected || data.status !== 'Unlocked') {
      const unlockBtn = document.createElement('button');
      unlockBtn.type = 'button';
      unlockBtn.className = 'ks-dd-row';
      const meta = document.createElement('div');
      meta.className = 'ks-dd-meta';
      const t = document.createElement('div');
      t.className = 'ks-dd-title';
      t.textContent = data.connected ? 'Keysmith 已锁定' : '未连接到 Keysmith 桌面端';
      const s = document.createElement('div');
      s.className = 'ks-dd-sub';
      s.textContent = data.connected ? '点击打开 Keysmith 桌面端解锁' : '请启动 Keysmith 桌面应用';
      meta.append(t, s);
      unlockBtn.appendChild(meta);
      unlockBtn.addEventListener('mousedown', (e) => e.preventDefault());
      unlockBtn.addEventListener('click', async () => {
        await sendMsg({ type: 'OPEN_DESKTOP' });
        closeDropdown();
      });
      dd.appendChild(unlockBtn);
    } else if (data.matches.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'ks-dd-empty';
      empty.textContent = '当前网站暂无已保存登录凭据';
      dd.appendChild(empty);
    } else {
      for (const item of data.matches) {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'ks-dd-row';

        const meta = document.createElement('div');
        meta.className = 'ks-dd-meta';
        const title = document.createElement('div');
        title.className = 'ks-dd-title';
        title.textContent = item.title || '未命名';
        const sub = document.createElement('div');
        sub.className = 'ks-dd-sub';
        sub.textContent = item.username || '无用户名';
        meta.append(title, sub);
        row.appendChild(meta);

        if (item.hasPasskey) {
          const pill = document.createElement('span');
          pill.className = 'ks-pill';
          pill.textContent = 'Passkey';
          row.appendChild(pill);
        }
        if (item.hasTotp) {
          const pill = document.createElement('span');
          pill.className = 'ks-pill';
          pill.textContent = '2FA';
          row.appendChild(pill);
        }

        row.addEventListener('mousedown', (e) => e.preventDefault());
        row.addEventListener('click', async () => {
          if (item.reprompt) {
            showToast(`「${item.title}」已启用主密码重验证，请在桌面端查看`, 'warn');
            await sendMsg({ type: 'OPEN_DESKTOP' });
            closeDropdown();
            return;
          }
          let totp = item.totp || '';
          if (!totp && item.hasTotp) {
            const tRes = await sendMsg({ type: 'TOTP', itemId: item.id });
            if (tRes.ok && tRes.result?.code) {
              totp = tRes.result.code;
            }
          }
          const res = autofillLogin(item.username || '', item.password || '', totp, input);
          if (totp) {
            await sendMsg({
              type: 'COPY_SECRET',
              value: totp,
              label: `${item.title} 2FA`
            });
          }
          if (res.ok) {
            showToast(
              totp ? `已填充凭据并复制 2FA：${totp}` : `已填充：${item.title}`,
              'success'
            );
          } else {
            showToast(res.error || '未能填充输入框', 'warn');
          }
          closeDropdown();
        });
        dd.appendChild(row);
      }
    }

    dropdownContainer.appendChild(dd);
    const ddHeight = dd.getBoundingClientRect().height || 220;
    if (spaceBelow < ddHeight + 10 && rect.top > ddHeight + 12) {
      dd.style.top = '';
      dd.style.bottom = `${window.innerHeight - rect.top + 6}px`;
    }
  }

  function renderInlineIcons() {
    rafScheduled = false;
    if (!isWeb || !ensureOverlay() || !iconLayer) return;

    const allInputs = Array.from(document.querySelectorAll('input'));
    const visibleAuth = [];
    for (const inp of allInputs) {
      if (!isVisible(inp)) continue;
      const kind = classifyAuthField(inp, allInputs);
      if (kind) {
        visibleAuth.push({ input: inp, kind });
        if (!trackedInputs.has(inp)) {
          trackedInputs.add(inp);
          inp.addEventListener('input', () => recordTypedCredential(inp));
          inp.addEventListener('keydown', (ev) => {
            if (ev.key === 'Enter' && inp.type === 'password') {
              handleFormSubmitTrigger(inp.form || inp);
            }
          });
          inp.addEventListener('focus', () => {
            if (cachedPageData.status === 'Unlocked' && cachedPageData.matches.length > 0) {
              openDropdownForInput(inp, kind);
            }
          });
        }
      }
    }

    iconLayer.textContent = '';
    for (const { input, kind } of visibleAuth) {
      const rect = input.getBoundingClientRect();
      if (
        rect.bottom < 0 ||
        rect.top > window.innerHeight ||
        rect.right < 0 ||
        rect.left > window.innerWidth
      ) {
        continue;
      }

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ks-icon-btn';
      btn.title = '使用 Keysmith 填充';
      btn.setAttribute('aria-label', 'Keysmith 自动填充');
      btn.style.left = `${Math.max(4, rect.right - 28)}px`;
      btn.style.top = `${Math.round(rect.top + (rect.height - 22) / 2)}px`;
      btn.appendChild(createKeySvg(13));

      if (cachedPageData.status === 'Unlocked' && cachedPageData.matches.length > 0 && kind !== 'new-password') {
        const badge = document.createElement('span');
        badge.className = 'ks-icon-count';
        badge.textContent = String(cachedPageData.matches.length);
        btn.appendChild(badge);
      }

      btn.addEventListener('mousedown', (e) => e.preventDefault());
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (activeDropdownInput === input) {
          closeDropdown();
        } else {
          openDropdownForInput(input, kind);
        }
      });
      iconLayer.appendChild(btn);
    }
  }

  function scheduleIconRender() {
    if (rafScheduled) return;
    rafScheduled = true;
    window.requestAnimationFrame(renderInlineIcons);
  }

  // ==================== Auto-Capture Login / Password Save Banner ====================

  const programmaticFills = new WeakMap();
  let lastSubmittedCapture = null;

  function markProgrammaticFill(input) {
    programmaticFills.set(input, Date.now());
  }

  function wasJustAutofilled(input) {
    const ts = programmaticFills.get(input);
    return typeof ts === 'number' && Date.now() - ts < 3000;
  }

  function recordTypedCredential(input) {
    if (!input || wasJustAutofilled(input)) return;
    const scope = input.form || input.closest('div, section, main') || document;
    const inputs = Array.from(scope.querySelectorAll('input')).filter(isVisible);
    const pw = inputs.find((el) => el.type === 'password' && el.value.length > 0);
    if (!pw || wasJustAutofilled(pw)) return;
    const userEl = inputs.find(
      (el) => classifyAuthField(el, inputs) === 'username' && el.value.trim().length > 0
    );
    lastSubmittedCapture = {
      url: window.location.href,
      origin: window.location.origin,
      title: document.title || window.location.hostname,
      username: userEl ? userEl.value.trim() : '',
      password: pw.value
    };
  }

  function showSaveLoginBanner(info, creds) {
    if (!ensureOverlay() || !bannerContainer) return;
    bannerContainer.textContent = '';

    const card = document.createElement('div');
    card.className = 'ks-banner';

    const head = document.createElement('div');
    head.className = 'ks-banner-head';
    const titleSpan = document.createElement('span');
    titleSpan.textContent =
      info.mode === 'update'
        ? `更新「${info.title}」的密码？`
        : '保存登录信息到 Keysmith？';
    const closeX = document.createElement('button');
    closeX.type = 'button';
    closeX.className = 'ks-btn ks-btn-ghost';
    closeX.textContent = '✕';
    closeX.addEventListener('click', () => {
      bannerContainer.textContent = '';
      sendMsg({ type: 'PENDING_SAVE_CLEAR', origin: creds.origin });
    });
    head.append(titleSpan, closeX);
    card.appendChild(head);

    const titleFieldWrap = document.createElement('div');
    titleFieldWrap.className = 'ks-field';
    const titleLabel = document.createElement('label');
    titleLabel.textContent = '条目名称';
    const titleInput = document.createElement('input');
    titleInput.className = 'ks-input';
    titleInput.value = info.title || info.suggestedTitle || window.location.hostname;
    titleFieldWrap.append(titleLabel, titleInput);
    card.appendChild(titleFieldWrap);

    const userFieldWrap = document.createElement('div');
    userFieldWrap.className = 'ks-field';
    const userLabel = document.createElement('label');
    userLabel.textContent = '用户名 / 邮箱';
    const userInput = document.createElement('input');
    userInput.className = 'ks-input';
    userInput.value = creds.username || info.existingUsername || '';
    userFieldWrap.append(userLabel, userInput);
    card.appendChild(userFieldWrap);

    const actions = document.createElement('div');
    actions.className = 'ks-btn-row';

    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'ks-btn ks-btn-primary';
    saveBtn.textContent = info.mode === 'update' ? '更新密码' : '保存到 Keysmith';
    saveBtn.addEventListener('click', async () => {
      saveBtn.disabled = true;
      saveBtn.textContent = '保存中…';
      const resp = await sendMsg({
        type: 'SAVE_LOGIN',
        url: creds.url || window.location.href,
        origin: creds.origin || window.location.origin,
        title: titleInput.value.trim() || window.location.hostname,
        username: userInput.value.trim(),
        password: creds.password,
        itemId: info.mode === 'update' ? info.itemId : undefined
      });
      bannerContainer.textContent = '';
      if (resp.ok) {
        showToast(
          info.mode === 'update' ? '已更新密码并保存历史记录' : '已保存到 Keysmith 保险库',
          'success'
        );
        fetchAutofillData(true);
      } else {
        showToast(resp.error || '保存失败', 'warn');
      }
    });
    actions.appendChild(saveBtn);

    if (info.mode !== 'update') {
      const neverBtn = document.createElement('button');
      neverBtn.type = 'button';
      neverBtn.className = 'ks-btn ks-btn-sec';
      neverBtn.textContent = '此网站永不提示';
      neverBtn.addEventListener('click', async () => {
        await sendMsg({ type: 'NEVER_SAVE_ORIGIN', origin: window.location.origin });
        bannerContainer.textContent = '';
      });
      actions.appendChild(neverBtn);
    }

    card.appendChild(actions);
    bannerContainer.appendChild(card);
  }

  async function handleFormSubmitTrigger(targetNode) {
    if (!isWeb) return;
    const scope =
      (targetNode && targetNode.tagName === 'FORM' ? targetNode : targetNode?.closest?.('form')) ||
      targetNode?.closest?.('div, section, main') ||
      document;
    const inputs = Array.from(scope.querySelectorAll('input'));
    const pw = inputs.find((el) => el.type === 'password' && el.value.length > 0);
    if (pw && wasJustAutofilled(pw)) {
      return;
    }
    const userEl = inputs.find(
      (el) =>
        ['text', 'email', 'tel'].includes((el.type || 'text').toLowerCase()) &&
        classifyAuthField(el, inputs) === 'username' &&
        el.value.trim().length > 0
    );

    const creds =
      pw && pw.value
        ? {
            url: window.location.href,
            origin: window.location.origin,
            title: document.title || window.location.hostname,
            username: userEl ? userEl.value.trim() : '',
            password: pw.value
          }
        : lastSubmittedCapture;

    if (!creds || !creds.password) return;
    lastSubmittedCapture = null;

    const check = await sendMsg({
      type: 'CHECK_LOGIN_SAVE',
      url: creds.url,
      origin: creds.origin,
      username: creds.username,
      password: creds.password
    });

    if (check?.ok && check.result?.shouldPrompt) {
      await sendMsg({
        type: 'PENDING_SAVE_SET',
        origin: creds.origin,
        payload: { info: check.result, creds }
      });
      showSaveLoginBanner(check.result, creds);
    }
  }

  // ==================== In-Page WebAuthn Passkey Modals ====================

  function closeModal() {
    if (modalContainer) {
      modalContainer.textContent = '';
    }
  }

  function showPasskeyCreateModal(options, origin, listInfo) {
    return new Promise((resolve) => {
      if (!ensureOverlay() || !modalContainer) {
        resolve({ handled: false, fallback: true });
        return;
      }
      modalContainer.textContent = '';

      const backdrop = document.createElement('div');
      backdrop.className = 'ks-modal-backdrop';

      const modal = document.createElement('div');
      modal.className = 'ks-modal';

      const title = document.createElement('div');
      title.className = 'ks-modal-title';
      title.appendChild(createKeySvg(18));
      const titleText = document.createElement('span');
      titleText.textContent = '保存通行密钥 (Passkey) 到 Keysmith';
      title.appendChild(titleText);

      const rpId = options?.rp?.id || window.location.hostname;
      const userName = options?.user?.name || 'Passkey User';

      const sub = document.createElement('div');
      sub.className = 'ks-modal-sub';
      sub.textContent = `网站：${rpId} · 账号：${userName}`;
      modal.append(title, sub);

      if (listInfo.locked) {
        const lockNote = document.createElement('div');
        lockNote.className = 'ks-dd-empty';
        lockNote.textContent = 'Keysmith 保险库当前已锁定，请先解锁或改用设备通行密钥。';
        modal.appendChild(lockNote);

        const row = document.createElement('div');
        row.className = 'ks-btn-row';
        const unlockBtn = document.createElement('button');
        unlockBtn.type = 'button';
        unlockBtn.className = 'ks-btn ks-btn-primary';
        unlockBtn.textContent = '打开 Keysmith 解锁';
        unlockBtn.addEventListener('click', async () => {
          await sendMsg({ type: 'OPEN_DESKTOP' });
          closeModal();
          resolve({ handled: false, fallback: true });
        });
        const fbBtn = document.createElement('button');
        fbBtn.type = 'button';
        fbBtn.className = 'ks-btn ks-btn-sec';
        fbBtn.textContent = '改用浏览器/设备 Passkey';
        fbBtn.addEventListener('click', () => {
          closeModal();
          resolve({ handled: false, fallback: true });
        });
        const cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.className = 'ks-btn ks-btn-ghost';
        cancelBtn.textContent = '取消';
        cancelBtn.addEventListener('click', () => {
          closeModal();
          resolve({ handled: false, cancelled: true, errorName: 'NotAllowedError' });
        });
        row.append(unlockBtn, fbBtn, cancelBtn);
        modal.appendChild(row);
        backdrop.appendChild(modal);
        modalContainer.appendChild(backdrop);
        return;
      }

      const candidates = Array.isArray(listInfo.candidates) ? listInfo.candidates : [];
      const targetWrap = document.createElement('div');
      targetWrap.className = 'ks-field';
      const targetLbl = document.createElement('label');
      targetLbl.textContent = '保存位置';
      const select = document.createElement('select');
      select.className = 'ks-select';
      const newOpt = document.createElement('option');
      newOpt.value = '';
      newOpt.textContent = `新建登录条目 (${options?.rp?.name || rpId})`;
      select.appendChild(newOpt);
      for (const cand of candidates) {
        const opt = document.createElement('option');
        opt.value = cand.itemId;
        opt.textContent = `绑定到：${cand.title}${cand.username ? ` (${cand.username})` : ''}`;
        select.appendChild(opt);
      }
      if (candidates.length > 0) {
        const sameUser = candidates.find(
          (c) => c.username && c.username.toLowerCase() === userName.toLowerCase()
        );
        if (sameUser) select.value = sameUser.itemId;
      }
      targetWrap.append(targetLbl, select);
      modal.appendChild(targetWrap);

      const titleFieldWrap = document.createElement('div');
      titleFieldWrap.className = 'ks-field';
      const titleLbl = document.createElement('label');
      titleLbl.textContent = '新条目名称';
      const itemTitleInput = document.createElement('input');
      itemTitleInput.className = 'ks-input';
      itemTitleInput.value = options?.rp?.name || rpId;
      titleFieldWrap.append(titleLbl, itemTitleInput);
      titleFieldWrap.style.display = select.value ? 'none' : 'block';
      select.addEventListener('change', () => {
        titleFieldWrap.style.display = select.value ? 'none' : 'block';
      });
      modal.appendChild(titleFieldWrap);

      const btnRow = document.createElement('div');
      btnRow.className = 'ks-btn-row';

      const saveBtn = document.createElement('button');
      saveBtn.type = 'button';
      saveBtn.className = 'ks-btn ks-btn-primary';
      saveBtn.textContent = '保存通行密钥';
      saveBtn.addEventListener('click', async () => {
        saveBtn.disabled = true;
        saveBtn.textContent = '生成密钥中…';
        const res = await sendMsg({
          type: 'PASSKEY_CREATE',
          origin,
          itemId: select.value || undefined,
          title: itemTitleInput.value.trim() || undefined,
          options
        });
        closeModal();
        if (res.ok && res.result?.handled && res.result?.credential) {
          showToast('通行密钥已保存到 Keysmith', 'success');
          resolve({ handled: true, credential: res.result.credential });
        } else if (res.ok && res.result?.errorName) {
          resolve({
            handled: false,
            errorName: res.result.errorName,
            error: res.result.error
          });
        } else {
          showToast(res.error || res.result?.error || '创建通行密钥失败', 'warn');
          resolve({ handled: false, fallback: true });
        }
      });

      const fbBtn = document.createElement('button');
      fbBtn.type = 'button';
      fbBtn.className = 'ks-btn ks-btn-sec';
      fbBtn.textContent = '改用设备通行密钥';
      fbBtn.addEventListener('click', () => {
        closeModal();
        resolve({ handled: false, fallback: true });
      });

      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'ks-btn ks-btn-ghost';
      cancelBtn.textContent = '取消';
      cancelBtn.addEventListener('click', () => {
        closeModal();
        resolve({ handled: false, cancelled: true, errorName: 'NotAllowedError' });
      });

      btnRow.append(saveBtn, fbBtn, cancelBtn);
      modal.appendChild(btnRow);
      backdrop.appendChild(modal);
      modalContainer.appendChild(backdrop);
    });
  }

  function showPasskeySelectModal(options, origin, passkeys) {
    return new Promise((resolve) => {
      if (!ensureOverlay() || !modalContainer) {
        resolve({ handled: false, fallback: true });
        return;
      }
      modalContainer.textContent = '';

      const backdrop = document.createElement('div');
      backdrop.className = 'ks-modal-backdrop';

      const modal = document.createElement('div');
      modal.className = 'ks-modal';

      const title = document.createElement('div');
      title.className = 'ks-modal-title';
      title.appendChild(createKeySvg(18));
      const titleText = document.createElement('span');
      titleText.textContent = '使用 Keysmith 通行密钥登录';
      title.appendChild(titleText);

      const rpId = options?.rpId || window.location.hostname;
      const sub = document.createElement('div');
      sub.className = 'ks-modal-sub';
      sub.textContent = `选择要用于验证 ${rpId} 的 Passkey 凭据`;
      modal.append(title, sub);

      const listEl = document.createElement('div');
      listEl.className = 'ks-pk-list';

      for (const pk of passkeys) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'ks-pk-item';

        const meta = document.createElement('div');
        meta.className = 'ks-dd-meta';
        const t = document.createElement('div');
        t.className = 'ks-dd-title';
        t.textContent = pk.itemTitle || pk.rpName || pk.rpId;
        const s = document.createElement('div');
        s.className = 'ks-dd-sub';
        s.textContent = pk.userName || pk.userDisplayName || pk.rpId;
        meta.append(t, s);
        btn.appendChild(meta);

        const pill = document.createElement('span');
        pill.className = 'ks-pill';
        pill.textContent = pk.reprompt ? '🔒 重验证' : 'Passkey';
        btn.appendChild(pill);

        btn.addEventListener('click', async () => {
          if (pk.reprompt) {
            showToast('该 Passkey 启用了主密码重验证，请改用其他凭据或桌面端确认', 'warn');
            return;
          }
          btn.disabled = true;
          pill.textContent = '签名中…';
          const res = await sendMsg({
            type: 'PASSKEY_ASSERT',
            origin,
            itemId: pk.itemId,
            credentialId: pk.credentialId,
            options
          });
          closeModal();
          if (res.ok && res.result?.handled && res.result?.credential) {
            showToast(`已通过 Passkey 登录 ${pk.rpId}`, 'success');
            resolve({ handled: true, credential: res.result.credential });
          } else {
            showToast(res.error || 'Passkey 签名失败', 'warn');
            resolve({ handled: false, fallback: true });
          }
        });
        listEl.appendChild(btn);
      }

      modal.appendChild(listEl);

      const btnRow = document.createElement('div');
      btnRow.className = 'ks-btn-row';

      const fbBtn = document.createElement('button');
      fbBtn.type = 'button';
      fbBtn.className = 'ks-btn ks-btn-sec';
      fbBtn.textContent = '使用浏览器/设备 Passkey';
      fbBtn.addEventListener('click', () => {
        closeModal();
        resolve({ handled: false, fallback: true });
      });

      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'ks-btn ks-btn-ghost';
      cancelBtn.textContent = '取消';
      cancelBtn.addEventListener('click', () => {
        closeModal();
        resolve({ handled: false, cancelled: true, errorName: 'NotAllowedError' });
      });

      btnRow.append(fbBtn, cancelBtn);
      modal.appendChild(btnRow);
      backdrop.appendChild(modal);
      modalContainer.appendChild(backdrop);
    });
  }

  // ==================== Listeners & Bridges ====================

  window.addEventListener('message', async (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== 'keysmith-page') return;
    if (data.type !== 'PASSKEY_CREATE_REQUEST' && data.type !== 'PASSKEY_GET_REQUEST') {
      return;
    }

    const reply = (payload) => {
      window.postMessage(
        {
          source: 'keysmith-content',
          nonce: data.nonce,
          ...payload
        },
        window.location.origin
      );
    };

    try {
      const rpId =
        data.type === 'PASSKEY_CREATE_REQUEST'
          ? data.options?.rp?.id || window.location.hostname
          : data.options?.rpId || window.location.hostname;

      const listRes = await sendMsg({
        type: 'PASSKEY_LIST_FOR_RP',
        rpId,
        origin: data.origin || window.location.origin,
        allowCredentials: (data.options?.allowCredentials || []).map((c) => c.id),
        excludeCredentials: (data.options?.excludeCredentials || []).map((c) => c.id)
      });

      if (!listRes || !listRes.connected || !listRes.ok) {
        reply({ handled: false, fallback: true });
        return;
      }

      const info = listRes.result || {};
      if (data.type === 'PASSKEY_CREATE_REQUEST') {
        if (info.excluded) {
          reply({
            handled: false,
            errorName: 'InvalidStateError',
            error: '此账号已在 Keysmith 中注册过通行密钥'
          });
          return;
        }
        const modalReply = await showPasskeyCreateModal(
          data.options,
          data.origin || window.location.origin,
          info
        );
        reply(modalReply);
        return;
      }

      // PASSKEY_GET_REQUEST
      const passkeys = Array.isArray(info.passkeys) ? info.passkeys : [];
      if (info.locked || passkeys.length === 0) {
        reply({ handled: false, fallback: true });
        return;
      }

      const modalReply = await showPasskeySelectModal(
        data.options,
        data.origin || window.location.origin,
        passkeys
      );
      reply(modalReply);
    } catch {
      reply({ handled: false, fallback: true });
    }
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'FILL_CREDENTIALS') {
      sendResponse(
        autofillLogin(
          message.username || '',
          message.password || '',
          message.totp || '',
          activeDropdownInput
        )
      );
      return true;
    }
    if (message?.type === 'FILL_GENERATED_PASSWORD') {
      sendResponse(autofillGeneratedPassword(message.password || '', activeDropdownInput));
      return true;
    }
    if (message?.type === 'FILL_CARD') {
      sendResponse(autofillCreditCard(message.card || {}));
      return true;
    }
    if (message?.type === 'FILL_IDENTITY') {
      sendResponse(autofillIdentity(message.identity || {}));
      return true;
    }
    if (message?.type === 'SHOW_TOAST') {
      showToast(message.message || '', message.kind || 'info');
      sendResponse({ ok: true });
      return true;
    }
    return false;
  });

  if (isWeb) {
    document.addEventListener(
      'submit',
      (e) => {
        handleFormSubmitTrigger(e.target);
      },
      true
    );

    document.addEventListener(
      'click',
      (e) => {
        const btn = e.target?.closest?.(
          'button[type="submit"], input[type="submit"], button:not([type])'
        );
        if (btn && (btn.form || /log.?in|sign.?in|submit|继续|登录|注册|提交/i.test(btn.textContent || btn.value || ''))) {
          setTimeout(() => handleFormSubmitTrigger(btn), 40);
        }
        if (
          activeDropdownInput &&
          e.target !== activeDropdownInput &&
          !e.target?.closest?.('#keysmith-ext-root')
        ) {
          closeDropdown();
        }
      },
      true
    );

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && activeDropdownInput) {
        closeDropdown();
      }
    });

    document.addEventListener(
      'focusin',
      (e) => {
        if (
          activeDropdownInput &&
          e.target !== activeDropdownInput &&
          !e.target?.closest?.('#keysmith-ext-root')
        ) {
          closeDropdown();
        }
      },
      true
    );

    window.addEventListener('scroll', scheduleIconRender, { passive: true, capture: true });
    window.addEventListener('resize', scheduleIconRender, { passive: true });

    const startObservers = () => {
      fetchAutofillData(true);
      scheduleIconRender();

      setTimeout(async () => {
        const pending = await sendMsg({
          type: 'PENDING_SAVE_GET',
          origin: window.location.origin
        });
        if (pending?.payload?.info?.shouldPrompt && pending?.payload?.creds) {
          showSaveLoginBanner(pending.payload.info, pending.payload.creds);
        }
      }, 450);

      if (document.body) {
        const observer = new MutationObserver(() => {
          scheduleIconRender();
        });
        observer.observe(document.body, { childList: true, subtree: true });
      }
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', startObservers, { once: true });
    } else {
      startObservers();
    }
  }
})();
