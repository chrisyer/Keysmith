(() => {
  if (window.__KEYSMITH_CONTENT_LOADED__) {
    return;
  }
  window.__KEYSMITH_CONTENT_LOADED__ = true;

  const t = (key, vars) =>
    globalThis.KeysmithI18n ? globalThis.KeysmithI18n.t(key, vars) : key;
  if (globalThis.KeysmithI18n && typeof globalThis.KeysmithI18n.onChange === 'function') {
    globalThis.KeysmithI18n.onChange(() => {
      try {
        scheduleIconRender();
      } catch {
        // ignore if not ready yet
      }
    });
  }

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

  function isVisibleControl(el, minWidth = 48) {
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
    return rect.width >= minWidth && rect.height >= 18;
  }

  function isVisible(el) {
    return isVisibleControl(el, 48);
  }

  function isSingleCharOtpInput(el) {
    if (!(el instanceof HTMLInputElement)) return false;
    const type = (el.type || 'text').toLowerCase();
    if (!['text', 'tel', 'number', 'password'].includes(type)) return false;
    if (!isVisibleControl(el, 18)) return false;
    if (el.maxLength === 1 || el.getAttribute('maxlength') === '1') {
      return true;
    }
    const inputMode = (el.getAttribute('inputmode') || '').toLowerCase();
    const pattern = el.getAttribute('pattern') || '';
    if (
      el.size === 1 &&
      (inputMode === 'numeric' || pattern.includes('[0-9]') || pattern.includes('\\d'))
    ) {
      return true;
    }
    return false;
  }

  function findSegmentedOtpGroupFromInput(el) {
    if (!isSingleCharOtpInput(el)) return null;
    let node = el.parentElement;
    for (let depth = 0; depth < 3 && node; depth += 1) {
      const candidates = Array.from(node.querySelectorAll('input')).filter(isSingleCharOtpInput);
      if (candidates.length >= 4 && candidates.length <= 8 && candidates.includes(el)) {
        return candidates;
      }
      node = node.parentElement;
    }
    return null;
  }

  function findAnySegmentedOtpGroup(scope) {
    const root = scope || document;
    const singles = Array.from(root.querySelectorAll('input')).filter(isSingleCharOtpInput);
    for (const candidate of singles) {
      const grp = findSegmentedOtpGroupFromInput(candidate);
      if (grp && grp.length >= 4) {
        return grp;
      }
    }
    return null;
  }

  function fillSegmentedOtpGroup(boxes, code) {
    const clean = String(code || '').replace(/[\s-]+/g, '');
    if (!clean || !Array.isArray(boxes) || boxes.length === 0) return 0;
    const limit = Math.min(boxes.length, clean.length);
    for (let i = 0; i < limit; i += 1) {
      const box = boxes[i];
      markProgrammaticFill(box);
      setNativeValue(box, clean[i]);
      try {
        box.dispatchEvent(new KeyboardEvent('keyup', { key: clean[i], bubbles: true }));
      } catch {
        // Ignore synthetic KeyboardEvent restrictions
      }
    }
    return limit;
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
    const acTokens = ac.split(/\s+/).filter(Boolean);
    const hasAc = (token) => acTokens.includes(token);
    const hints = fieldHints(el);

    if (type === 'password') {
      const isNew =
        hasAc('new-password') ||
        /(new.?pass|confirm|repeat|retype|verify|signup|register|create.?pass|新密码|确认密码)/.test(
          hints
        );
      return isNew ? 'new-password' : 'password';
    }

    if (
      ['text', 'tel', 'number'].includes(type) &&
      (hasAc('one-time-code') ||
        /(totp|2fa|mfa|otp|auth.?code|verif.?code|验证码|动态口令|安全码)/.test(hints)) &&
      !/(card|cvv|csc|zip|postal)/.test(hints)
    ) {
      return 'totp';
    }

    if (['email', 'text', 'tel'].includes(type)) {
      if (
        hasAc('username') ||
        hasAc('email') ||
        hasAc('webauthn') ||
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

    if (
      ['text', 'tel', 'number', 'password'].includes(type) &&
      (hasAc('cc-number') ||
        hasAc('cc-name') ||
        hasAc('cc-exp') ||
        hasAc('cc-exp-month') ||
        hasAc('cc-exp-year') ||
        hasAc('cc-csc') ||
        /(card.?num|cc.?num|card.?holder|cc.?name|cvv|cvc|csc|expir|valid thru|卡号|持卡人|安全码)/.test(
          hints
        ))
    ) {
      return 'card';
    }

    if (
      ['text', 'email', 'tel'].includes(type) &&
      (hasAc('given-name') ||
        hasAc('family-name') ||
        hasAc('street-address') ||
        hasAc('address-line1') ||
        hasAc('postal-code') ||
        hasAc('country') ||
        /(first.?name|last.?name|street|address.?line|postal|zip.?code|收货地址|邮政编码)/.test(
          hints
        ))
    ) {
      return 'identity';
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

  // ==================== Third-Party SSO Detection & Button Matcher ====================

  const SSO_PROVIDERS = [
    {
      name: 'Google',
      ownHosts: ['google.com', 'youtube.com', 'gmail.com'],
      oauthRe: /accounts\.google\.com\/o\/oauth2|\/auth\/google\b|\/oauth2?\/google\b|provider=google\b/i,
      attrRe: /\bgoogle\b/i,
      labelRe: /\bgoogle\b|谷歌/i
    },
    {
      name: 'Apple',
      ownHosts: ['apple.com', 'icloud.com'],
      oauthRe: /appleid\.apple\.com\/auth\/authorize|\/auth\/apple\b|\/oauth2?\/apple\b|provider=apple\b/i,
      attrRe: /\bapple\b/i,
      labelRe: /\bapple\b/i
    },
    {
      name: 'GitHub',
      ownHosts: ['github.com'],
      oauthRe: /github\.com\/login\/oauth|\/auth\/github\b|\/oauth2?\/github\b|provider=github\b/i,
      attrRe: /\bgithub\b/i,
      labelRe: /\bgithub\b/i
    },
    {
      name: 'Microsoft',
      ownHosts: ['microsoft.com', 'live.com', 'office.com', 'azure.com', 'microsoftonline.com'],
      oauthRe: /login\.microsoftonline\.com|login\.live\.com\/oauth|\/auth\/(microsoft|azure|entra)\b|provider=(microsoft|azuread)\b/i,
      attrRe: /\b(microsoft|azure[-_]?ad|entra)\b/i,
      labelRe: /\b(microsoft|azure ad|entra id)\b|微软/i
    },
    {
      name: 'GitLab',
      ownHosts: ['gitlab.com'],
      oauthRe: /gitlab\.com\/oauth\/authorize|\/auth\/gitlab\b|\/oauth2?\/gitlab\b|provider=gitlab\b/i,
      attrRe: /\bgitlab\b/i,
      labelRe: /\bgitlab\b/i
    },
    {
      name: 'Okta',
      ownHosts: ['okta.com'],
      oauthRe: /\.okta\.com\/oauth2|\/auth\/okta\b|\/oauth2?\/okta\b|provider=okta\b/i,
      attrRe: /\bokta\b/i,
      labelRe: /\bokta\b/i
    },
    {
      name: 'Discord',
      ownHosts: ['discord.com'],
      oauthRe: /discord\.com\/(api\/)?oauth2\/authorize|\/auth\/discord\b|provider=discord\b/i,
      attrRe: /\bdiscord\b/i,
      labelRe: /\bdiscord\b/i
    },
    {
      name: 'Slack',
      ownHosts: ['slack.com'],
      oauthRe: /slack\.com\/(oauth|openid\/connect)\/authorize|\/auth\/slack\b|provider=slack\b/i,
      attrRe: /\bslack\b/i,
      labelRe: /\bslack\b/i
    },
    {
      name: 'Feishu',
      ownHosts: ['feishu.cn', 'larksuite.com'],
      oauthRe: /open\.(feishu\.cn|larksuite\.com)\/open-apis\/authen|passport\.feishu\.cn|\/auth\/(feishu|lark)\b/i,
      attrRe: /\b(feishu|lark)\b/i,
      labelRe: /\b(feishu|lark)\b|飞书|飛書/i
    },
    {
      name: 'WeChat',
      ownHosts: ['qq.com', 'wechat.com', 'weixin.qq.com'],
      oauthRe: /open\.weixin\.qq\.com\/connect\/qrconnect|\/auth\/(wechat|weixin)\b/i,
      attrRe: /\b(wechat|weixin)\b/i,
      labelRe: /\b(wechat|weixin)\b|微信/i
    },
    {
      name: 'X',
      ownHosts: ['x.com', 'twitter.com'],
      oauthRe: /(twitter|x)\.com\/i\/oauth2\/authorize|api\.twitter\.com\/oauth\/authenticate|\/auth\/twitter\b/i,
      attrRe: /\btwitter\b/i,
      labelRe: /\b(twitter)\b|(?:with|via|使用|透過|で)\s*x\b/i
    }
  ];

  const SSO_AUTH_VERB_RE =
    /\b(sign\s*in|log\s*in|login|signin|continue|sign\s*up|connect|auth|sso|with|via)\b|登录|登入|继续|繼續|注册|註冊|授权|授權|ログイン|サインイン|続行|로그인|계속|anmelden|weiter|connexion|continuer|iniciar\s*sesión|continuar/i;
  const SSO_EXCLUDE_RE =
    /\b(share|tweet|post\s+to|follow\s+us|google\s+play|app\s+store|youtube|google\s+maps|google\s+docs|star\s+on\s+github|fork\s+on\s+github|join\s+discord|view\s+source)\b|分享|关注我们|下载应用/i;

  let lastProgrammaticSsoClickAt = 0;

  function isOwnProviderHost(host, ownHosts) {
    const h = String(host || '').toLowerCase();
    if (!h) return false;
    return ownHosts.some((d) => h === d || h.endsWith('.' + d));
  }

  function extractSsoElementSignals(el) {
    if (!el || typeof el.getAttribute !== 'function') return null;
    const text = String(el.textContent || el.value || '')
      .replace(/\s+/g, ' ')
      .trim();
    if (text.length > 96) return null;
    const aria = String(el.getAttribute('aria-label') || el.getAttribute('title') || '').trim();
    let imgAlt = '';
    if (typeof el.querySelectorAll === 'function') {
      imgAlt = Array.from(el.querySelectorAll('img[alt], svg[aria-label]'))
        .map((n) => n.getAttribute('alt') || n.getAttribute('aria-label') || '')
        .join(' ');
    }
    const href = String(
      el.getAttribute('href') ||
        el.getAttribute('formaction') ||
        el.closest?.('form')?.getAttribute?.('action') ||
        ''
    );
    const dataProvider = String(
      el.getAttribute('data-provider') ||
        el.getAttribute('data-idp') ||
        el.getAttribute('data-oauth') ||
        el.getAttribute('data-social') ||
        el.getAttribute('data-testid') ||
        ''
    );
    return {
      combinedLabel: `${text} ${aria} ${imgAlt}`.trim(),
      href,
      dataProvider
    };
  }

  function detectSsoButtonProvider(el) {
    const sig = extractSsoElementSignals(el);
    if (!sig) return null;
    if (SSO_EXCLUDE_RE.test(sig.combinedLabel)) return null;

    const host = window.location.hostname;
    const onAuthPath =
      /\/(log[-_]?in|sign[-_]?in|sign[-_]?up|register|auth|sso|session|oauth)\b/i.test(
        window.location.pathname || ''
      ) ||
      Boolean(
        typeof document.querySelector === 'function' &&
          document.querySelector('input[type="password"], input[type="email"]')
      );

    for (const def of SSO_PROVIDERS) {
      if (isOwnProviderHost(host, def.ownHosts)) continue;
      if (sig.href && def.oauthRe.test(sig.href)) {
        return def.name;
      }
      if (sig.dataProvider && def.attrRe.test(sig.dataProvider)) {
        if (SSO_AUTH_VERB_RE.test(sig.combinedLabel) || onAuthPath) {
          return def.name;
        }
      }
      if (
        sig.combinedLabel &&
        def.labelRe.test(sig.combinedLabel) &&
        (SSO_AUTH_VERB_RE.test(sig.combinedLabel) ||
          (onAuthPath && sig.combinedLabel.length <= 28))
      ) {
        return def.name;
      }
    }
    return null;
  }

  function findSsoButtonOnPage(provider) {
    const target = String(provider || '').trim();
    if (!target) return null;
    const targetLower = target.toLowerCase();
    const candidates = Array.from(
      document.querySelectorAll(
        'button, a[href], [role="button"], input[type="button"], input[type="submit"]'
      )
    ).filter((el) => isVisibleControl(el, 28));

    for (const el of candidates) {
      const detected = detectSsoButtonProvider(el);
      if (detected && detected.toLowerCase() === targetLower) {
        return el;
      }
    }

    // Fallback for custom enterprise SSO names (e.g. "CorpSSO", "Azure AD", "Keycloak")
    for (const el of candidates) {
      const sig = extractSsoElementSignals(el);
      if (!sig || SSO_EXCLUDE_RE.test(sig.combinedLabel)) continue;
      if (
        sig.combinedLabel.toLowerCase().includes(targetLower) &&
        (SSO_AUTH_VERB_RE.test(sig.combinedLabel) || sig.combinedLabel.length <= 36)
      ) {
        return el;
      }
    }
    return null;
  }

  function autofillLogin(username, password, totp, anchorInput, ssoProvider) {
    const cleanSso = String(ssoProvider || '').trim();
    const allVisible = Array.from(document.querySelectorAll('input')).filter(isVisible);
    const segmentedOtp =
      (anchorInput && findSegmentedOtpGroupFromInput(anchorInput)) ||
      findAnySegmentedOtpGroup(anchorInput?.form || document);
    if (allVisible.length === 0 && (!segmentedOtp || segmentedOtp.length === 0)) {
      if (cleanSso && !password) {
        const ssoBtn = findSsoButtonOnPage(cleanSso);
        if (ssoBtn) {
          lastProgrammaticSsoClickAt = Date.now();
          ssoBtn.click();
          return { ok: true, filled: 1, ssoClicked: true, ssoProvider: cleanSso };
        }
        return { ok: false, error: t('errNoSsoButton', { provider: cleanSso }) };
      }
      return { ok: false, error: t('errNoVisibleInputs') };
    }

    const scoped = findFormInputs(anchorInput);
    const targetPw =
      (anchorInput?.type === 'password' && !isSingleCharOtpInput(anchorInput)
        ? anchorInput
        : null) ||
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
    if (totp) {
      if (segmentedOtp && segmentedOtp.length >= 4) {
        filled += fillSegmentedOtpGroup(segmentedOtp, totp);
      } else if (targetTotp) {
        markProgrammaticFill(targetTotp);
        setNativeValue(targetTotp, totp);
        filled += 1;
      }
    }

    if (cleanSso && !password) {
      const ssoBtn = findSsoButtonOnPage(cleanSso);
      if (ssoBtn) {
        lastProgrammaticSsoClickAt = Date.now();
        ssoBtn.click();
        return { ok: true, filled: filled + 1, ssoClicked: true, ssoProvider: cleanSso };
      }
      if (filled === 0) {
        return { ok: false, error: t('errNoSsoButton', { provider: cleanSso }) };
      }
    }

    if (filled === 0) {
      return { ok: false, error: t('errNoMatchedAuth') };
    }
    return { ok: true, filled };
  }

  function autofillGeneratedUsername(username, anchorInput) {
    if (!username) return { ok: false, error: t('errNoMatchedAuth') };
    const allVisible = Array.from(document.querySelectorAll('input')).filter(isVisible);
    const scoped = findFormInputs(anchorInput);
    const target =
      (anchorInput && classifyAuthField(anchorInput, allVisible) === 'username'
        ? anchorInput
        : null) ||
      scoped.usernames[0] ||
      allVisible.find((el) => classifyAuthField(el, allVisible) === 'username') ||
      allVisible.find((el) => el.type === 'email');
    if (!target) {
      return { ok: false, error: t('errNoMatchedAuth') };
    }
    markProgrammaticFill(target);
    setNativeValue(target, username);
    return { ok: true, filled: 1 };
  }

  function autofillGeneratedPassword(password, anchorInput) {
    if (!password) return { ok: false, error: t('errMissingPassword') };
    const allVisible = Array.from(document.querySelectorAll('input')).filter(isVisible);
    const scoped = findFormInputs(anchorInput);
    const candidates =
      scoped.passwords.length > 0
        ? scoped.passwords
        : allVisible.filter((el) => el.type === 'password');
    if (candidates.length === 0) {
      return { ok: false, error: t('errNoPasswordInput') };
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
      : { ok: false, error: t('errNoCardInputs') };
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
      : { ok: false, error: t('errNoIdentInputs') };
  }

  // ==================== Shadow DOM Overlay UI ====================

  let shadowRoot = null;
  let overlayHost = null;
  let iconLayer = null;
  let dropdownContainer = null;
  let bannerContainer = null;
  let modalContainer = null;
  let activeModalDialog = null;
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
    .ks-modal-dialog {
      border: none;
      padding: 16px;
      margin: auto;
      background: transparent;
      max-width: 100vw;
      max-height: 100vh;
      width: 100%;
      height: 100%;
      overflow: visible;
      pointer-events: auto;
    }
    .ks-modal-dialog[open] {
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .ks-modal-dialog::backdrop {
      background: rgba(10, 14, 20, 0.45);
      backdrop-filter: blur(3px);
    }
    .ks-modal-err {
      margin-top: 8px;
      padding: 7px 10px;
      border-radius: 7px;
      border: 1px solid rgba(217, 119, 6, 0.35);
      background: rgba(217, 119, 6, 0.12);
      color: var(--ks-warn);
      font-size: 12px;
      line-height: 1.4;
      display: none;
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
      max-width: min(400px, calc(100vw - 24px));
      max-height: calc(100vh - 24px);
      overflow-y: auto;
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
    const parent = document.documentElement || document.body;
    if (shadowRoot && overlayHost) {
      if (!overlayHost.isConnected && parent) {
        parent.appendChild(overlayHost);
      }
      return shadowRoot;
    }
    if (!parent) return null;

    const host = document.createElement('keysmith-overlay');
    overlayHost = host;
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

  let cachedPageData = {
    connected: false,
    status: 'Disconnected',
    matches: [],
    autoCopyTotp: true,
    siteAutofillDisabled: false,
    fetchedAt: 0
  };
  let activeDropdownInput = null;
  let activeDropdownKind = null;
  let activeConditionalPasskey = null;
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
      autoCopyTotp: resp.autoCopyTotp !== false,
      siteAutofillDisabled: Boolean(resp.siteAutofillDisabled),
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

    const relevantMatches =
      kind === 'totp'
        ? (data.matches || []).filter((m) => Boolean(m.hasTotp || m.totp))
        : data.matches || [];

    const head = document.createElement('div');
    head.className = 'ks-dd-header';
    const hostSpan = document.createElement('span');
    hostSpan.textContent = `Keysmith · ${window.location.hostname}`;
    const stSpan = document.createElement('span');
    stSpan.textContent =
      data.status === 'Unlocked'
        ? t('ddMatchCount', { count: relevantMatches.length })
        : data.connected
          ? t('statusLocked')
          : t('statusDisconnected');
    head.append(hostSpan, stSpan);
    dd.appendChild(head);

    if (
      kind !== 'new-password' &&
      kind !== 'totp' &&
      activeConditionalPasskey &&
      Array.isArray(activeConditionalPasskey.passkeys) &&
      activeConditionalPasskey.passkeys.length > 0
    ) {
      for (const pk of activeConditionalPasskey.passkeys) {
        const pkBtn = document.createElement('button');
        pkBtn.type = 'button';
        pkBtn.className = 'ks-dd-row';

        const meta = document.createElement('div');
        meta.className = 'ks-dd-meta';
        const tEl = document.createElement('div');
        tEl.className = 'ks-dd-title';
        tEl.textContent = pk.itemTitle || pk.rpName || pk.rpId;
        const s = document.createElement('div');
        s.className = 'ks-dd-sub';
        s.textContent = pk.userName || pk.userDisplayName || pk.rpId;
        meta.append(tEl, s);
        pkBtn.appendChild(meta);

        const pill = document.createElement('span');
        pill.className = 'ks-pill';
        pill.textContent = pk.reprompt ? t('repromptBadge') : `Passkey · ${t('pkDropdownAction')}`;
        pkBtn.appendChild(pill);

        pkBtn.addEventListener('mousedown', (e) => e.preventDefault());
        pkBtn.addEventListener('click', async () => {
          pill.textContent = t('pkPillSigning');
          const ok = await assertConditionalPasskey(pk);
          if (!ok) {
            pill.textContent = pk.reprompt ? t('repromptBadge') : `Passkey · ${t('pkDropdownAction')}`;
          }
        });
        dd.appendChild(pkBtn);
      }
    }

    if (kind === 'username' && data.connected && data.status === 'Unlocked') {
      const aliasBtn = document.createElement('button');
      aliasBtn.type = 'button';
      aliasBtn.className = 'ks-dd-row ks-dd-gen';
      const meta = document.createElement('div');
      meta.className = 'ks-dd-meta';
      const tEl = document.createElement('div');
      tEl.className = 'ks-dd-title';
      tEl.textContent = t('ddGenMaskedTitle');
      meta.appendChild(tEl);
      aliasBtn.appendChild(meta);
      aliasBtn.addEventListener('mousedown', (e) => e.preventDefault());
      aliasBtn.addEventListener('click', async () => {
        const mRes = await sendMsg({
          type: 'GENERATE_MASKED_EMAIL',
          domain: window.location.hostname,
          url: window.location.href
        });
        const emailVal = mRes.result?.email || mRes.result?.value;
        if (mRes.ok && emailVal) {
          await sendMsg({
            type: 'COPY_SECRET',
            value: emailVal,
            label: t('modeMaskedEmail'),
            sensitive: false
          });
          autofillGeneratedUsername(emailVal, input);
          showToast(t('ddCopiedFilledAlias'), 'success');
          closeDropdown();
        } else {
          showToast(mRes.error || t('genFailed'), 'warn');
        }
      });
      dd.appendChild(aliasBtn);
    }

    if (kind === 'new-password' || kind === 'password') {
      const genBtn = document.createElement('button');
      genBtn.type = 'button';
      genBtn.className = 'ks-dd-row ks-dd-gen';
      const meta = document.createElement('div');
      meta.className = 'ks-dd-meta';
      const tEl = document.createElement('div');
      tEl.className = 'ks-dd-title';
      tEl.textContent = t('ddGenTitle');
      const s = document.createElement('div');
      s.className = 'ks-dd-sub';
      s.textContent = t('ddGenSub');
      meta.append(tEl, s);
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
            label: t('newGenPasswordLabel')
          });
          autofillGeneratedPassword(gRes.result.value, input);
          showToast(t('ddCopiedFilledPw'), 'success');
          closeDropdown();
        } else {
          showToast(gRes.error || t('ddOpenDesktopPrompt'), 'warn');
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

    if (kind === 'card' || kind === 'identity') {
      if (!data.connected || data.status !== 'Unlocked') {
        const unlockBtn = document.createElement('button');
        unlockBtn.type = 'button';
        unlockBtn.className = 'ks-dd-row';
        const meta = document.createElement('div');
        meta.className = 'ks-dd-meta';
        const tEl = document.createElement('div');
        tEl.className = 'ks-dd-title';
        tEl.textContent = data.connected ? t('ddLockedTitle') : t('ddDisconnectedTitle');
        const s = document.createElement('div');
        s.className = 'ks-dd-sub';
        s.textContent = data.connected ? t('ddClickOpenDesktop') : t('ddStartDesktopApp');
        meta.append(tEl, s);
        unlockBtn.appendChild(meta);
        unlockBtn.addEventListener('mousedown', (e) => e.preventDefault());
        unlockBtn.addEventListener('click', async () => {
          await sendMsg({ type: 'OPEN_DESKTOP' });
          closeDropdown();
        });
        dd.appendChild(unlockBtn);
      } else {
        const extraRes = await sendMsg({ type: 'CARDS_AND_IDENTITIES' });
        const entries =
          kind === 'card'
            ? extraRes.result?.cards || []
            : extraRes.result?.identities || [];
        if (entries.length === 0) {
          const empty = document.createElement('div');
          empty.className = 'ks-dd-empty';
          empty.textContent = t('ddNoSavedCreds');
          dd.appendChild(empty);
        } else {
          for (const entry of entries.slice(0, 6)) {
            const row = document.createElement('button');
            row.type = 'button';
            row.className = 'ks-dd-row';
            const meta = document.createElement('div');
            meta.className = 'ks-dd-meta';
            const titleEl = document.createElement('div');
            titleEl.className = 'ks-dd-title';
            titleEl.textContent =
              entry.title || (kind === 'card' ? t('creditCardDefault') : t('profileDefault'));
            const subEl = document.createElement('div');
            subEl.className = 'ks-dd-sub';
            subEl.textContent =
              kind === 'card'
                ? entry.maskedNumber || entry.holder || ''
                : entry.fullName || entry.email || entry.phone || '';
            meta.append(titleEl, subEl);
            row.appendChild(meta);
            const pill = document.createElement('span');
            pill.className = 'ks-pill';
            pill.textContent = entry.reprompt
              ? t('repromptBadge')
              : kind === 'card'
                ? t('cardLabel')
                : t('identityLabel');
            row.appendChild(pill);
            row.addEventListener('mousedown', (e) => e.preventDefault());
            row.addEventListener('click', async () => {
              let fillPayload = entry;
              if (entry.reprompt) {
                const bio = await sendMsg({
                  type: 'ITEM_GET',
                  itemId: entry.id,
                  verifyBiometric: true
                });
                if (!bio.ok || !bio.result) {
                  showToast(t('ddItemRepromptDesktop', { title: entry.title || t('ddUnnamed') }), 'warn');
                  await sendMsg({ type: 'OPEN_DESKTOP' });
                  closeDropdown();
                  return;
                }
                if (kind === 'card') {
                  const fields = (bio.result.sections || []).flatMap((sec) => sec.fields || []);
                  const findF = (p, hint) =>
                    fields.find((f) => f.purpose === p || (f.label || '').toLowerCase().includes(hint))?.value || '';
                  fillPayload = {
                    ...entry,
                    number: findF('card_number', 'number') || findF('card_number', '卡号') || entry.number,
                    cvv: findF('card_cvv', 'cvv') || entry.cvv,
                  };
                }
              }
              const res =
                kind === 'card'
                  ? autofillCreditCard(fillPayload)
                  : autofillIdentity(fillPayload);
              showToast(
                res.ok
                  ? t(kind === 'card' ? 'ddCardFilled' : 'ddIdentFilled', {
                      title: entry.title || t('ddUnnamed')
                    })
                  : res.error || t('ddCouldNotFill'),
                res.ok ? 'success' : 'warn'
              );
              closeDropdown();
            });
            dd.appendChild(row);
          }
        }
      }

      dropdownContainer.appendChild(dd);
      const ddHeight = dd.getBoundingClientRect().height || 200;
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
      const tEl = document.createElement('div');
      tEl.className = 'ks-dd-title';
      tEl.textContent = data.connected ? t('ddLockedTitle') : t('ddDisconnectedTitle');
      const s = document.createElement('div');
      s.className = 'ks-dd-sub';
      s.textContent = data.connected ? t('ddClickOpenDesktop') : t('ddStartDesktopApp');
      meta.append(tEl, s);
      unlockBtn.appendChild(meta);
      unlockBtn.addEventListener('mousedown', (e) => e.preventDefault());
      unlockBtn.addEventListener('click', async () => {
        await sendMsg({ type: 'OPEN_DESKTOP' });
        closeDropdown();
      });
      dd.appendChild(unlockBtn);
    } else if (relevantMatches.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'ks-dd-empty';
      empty.textContent = t('ddNoSavedCreds');
      dd.appendChild(empty);
    } else {
      for (const item of relevantMatches) {
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'ks-dd-row';

        const meta = document.createElement('div');
        meta.className = 'ks-dd-meta';
        const title = document.createElement('div');
        title.className = 'ks-dd-title';
        title.textContent = item.title || t('ddUnnamed');
        const sub = document.createElement('div');
        sub.className = 'ks-dd-sub';
        sub.textContent = item.username || t('ddNoUsername');
        meta.append(title, sub);
        row.appendChild(meta);

        if (item.ssoProvider) {
          const pill = document.createElement('span');
          pill.className = 'ks-pill';
          pill.textContent = t('ssoBadgePrefix', { provider: item.ssoProvider });
          row.appendChild(pill);
        }
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
          let fillItem = item;
          let verifyBiometric = false;
          if (item.reprompt) {
            const gRes = await sendMsg({
              type: 'ITEM_GET',
              itemId: item.id,
              verifyBiometric: true
            });
            if (!gRes.ok || !gRes.result) {
              showToast(t('ddItemRepromptDesktop', { title: item.title || t('ddUnnamed') }), 'warn');
              await sendMsg({ type: 'OPEN_DESKTOP' });
              closeDropdown();
              return;
            }
            fillItem = gRes.result;
            verifyBiometric = true;
          }
          let totp = fillItem.totp || '';
          if (!totp && (fillItem.hasTotp || item.hasTotp)) {
            const tRes = await sendMsg({ type: 'TOTP', itemId: item.id, verifyBiometric });
            if (tRes.ok && tRes.result?.code) {
              totp = tRes.result.code;
            }
          }
          const itemSso =
            fillItem.ssoProvider || fillItem.payload?.ssoProvider || item.ssoProvider || '';
          const res = autofillLogin(
            fillItem.username || '',
            fillItem.password || '',
            totp,
            input,
            itemSso
          );
          const shouldCopyTotp = Boolean(totp) && data.autoCopyTotp !== false;
          if (shouldCopyTotp) {
            await sendMsg({
              type: 'COPY_SECRET',
              value: totp,
              label: `${fillItem.title || item.title} 2FA`
            });
          }
          if (res.ok) {
            showToast(
              res.ssoClicked && itemSso
                ? t('ddSsoTriggered', { provider: itemSso })
                : shouldCopyTotp
                  ? t('ddFilledWithTotp', { code: totp })
                  : t('ddFilledItem', { title: fillItem.title || item.title || t('ddUnnamed') }),
              'success'
            );
          } else {
            showToast(res.error || t('ddCouldNotFill'), 'warn');
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
    if (cachedPageData.siteAutofillDisabled) {
      iconLayer.textContent = '';
      return;
    }

    const totpMatches =
      cachedPageData.status === 'Unlocked' && Array.isArray(cachedPageData.matches)
        ? cachedPageData.matches.filter((m) => Boolean(m.hasTotp || m.totp))
        : [];
    const hasTotpMatch = totpMatches.length > 0;

    const allInputs = Array.from(document.querySelectorAll('input'));
    const visibleAuth = [];
    const seenOtpGroups = new Set();
    for (const inp of allInputs) {
      if (isSingleCharOtpInput(inp)) {
        const grp = findSegmentedOtpGroupFromInput(inp);
        if (grp && grp[0] === inp && !seenOtpGroups.has(grp[0])) {
          seenOtpGroups.add(grp[0]);
          if (!trackedInputs.has(inp)) {
            trackedInputs.add(inp);
            inp.addEventListener('focus', () => {
              if (cachedPageData.siteAutofillDisabled) return;
              const siteHasTotp =
                cachedPageData.status === 'Unlocked' &&
                Array.isArray(cachedPageData.matches) &&
                cachedPageData.matches.some((m) => Boolean(m.hasTotp || m.totp));
              if (siteHasTotp) {
                openDropdownForInput(inp, 'totp');
              }
            });
          }
          if (hasTotpMatch) {
            const lastBox = grp[grp.length - 1];
            visibleAuth.push({ input: grp[0], anchorEl: lastBox, kind: 'totp', outsideRight: true });
          }
        }
      } else if (isVisible(inp)) {
        const kind = classifyAuthField(inp, allInputs);
        if (kind) {
          if (!trackedInputs.has(inp)) {
            trackedInputs.add(inp);
            inp.addEventListener('input', () => recordTypedCredential(inp));
            inp.addEventListener('keydown', (ev) => {
              if (ev.key === 'Enter' && !ev.isComposing && ev.keyCode !== 229 && inp.type === 'password') {
                handleFormSubmitTrigger(inp.form || inp);
              }
            });
            inp.addEventListener('focus', () => {
              if (cachedPageData.siteAutofillDisabled) return;
              if (kind === 'totp') {
                const siteHasTotp =
                  cachedPageData.status === 'Unlocked' &&
                  Array.isArray(cachedPageData.matches) &&
                  cachedPageData.matches.some((m) => Boolean(m.hasTotp || m.totp));
                if (siteHasTotp) {
                  openDropdownForInput(inp, kind);
                }
                return;
              }
              const hasConditionalPk = Boolean(activeConditionalPasskey?.passkeys?.length);
              if (
                (cachedPageData.status === 'Unlocked' && cachedPageData.matches.length > 0) ||
                hasConditionalPk ||
                (cachedPageData.status === 'Unlocked' && (kind === 'card' || kind === 'identity'))
              ) {
                openDropdownForInput(inp, kind);
              }
            });
          }
          if (kind !== 'totp' || hasTotpMatch) {
            visibleAuth.push({ input: inp, anchorEl: inp, kind });
          }
        }
      }
    }

    iconLayer.textContent = '';
    for (const { input, anchorEl, kind, outsideRight } of visibleAuth) {
      const rect = (anchorEl || input).getBoundingClientRect();
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
      btn.title = t('iconTitle');
      btn.setAttribute('aria-label', t('iconAria'));
      const leftPos = outsideRight
        ? Math.min(window.innerWidth - 26, rect.right + 6)
        : Math.max(4, rect.right - 28);
      btn.style.left = `${leftPos}px`;
      btn.style.top = `${Math.round(rect.top + (rect.height - 22) / 2)}px`;
      btn.appendChild(createKeySvg(13));

      const badgeCount = kind === 'totp' ? totpMatches.length : cachedPageData.matches.length;
      if (cachedPageData.status === 'Unlocked' && badgeCount > 0 && kind !== 'new-password') {
        const badge = document.createElement('span');
        badge.className = 'ks-icon-count';
        badge.textContent = String(badgeCount);
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
  let lastStepUser = null;

  function rememberStepUsername(username) {
    const clean = (username || '').trim();
    if (!clean) return;
    const entry = { origin: window.location.origin, username: clean, ts: Date.now() };
    lastStepUser = entry;
    try {
      sessionStorage.setItem('__ks_step_user', JSON.stringify(entry));
    } catch {
      // Ignore storage access restriction
    }
  }

  function recallStepUsername() {
    const now = Date.now();
    if (lastStepUser && lastStepUser.origin === window.location.origin && now - lastStepUser.ts < 120000) {
      return lastStepUser.username;
    }
    try {
      const raw = sessionStorage.getItem('__ks_step_user');
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.origin === window.location.origin && now - (parsed.ts || 0) < 120000) {
          return parsed.username || '';
        }
      }
    } catch {
      // Ignore storage parse/access errors
    }
    return '';
  }

  function pickCapturedPasswordInput(inputs) {
    const pwInputs = inputs.filter(
      (el) => el.type === 'password' && el.value.length > 0 && !wasJustAutofilled(el)
    );
    if (pwInputs.length === 0) return null;
    if (pwInputs.length === 1) return pwInputs[0];
    // Multi-password form (registration or change-password): prefer explicit new-password or last distinct password
    const newPw = pwInputs.find((el) => classifyAuthField(el, inputs) === 'new-password');
    return newPw || pwInputs[pwInputs.length - 1];
  }

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
    const userEl = inputs.find(
      (el) => classifyAuthField(el, inputs) === 'username' && el.value.trim().length > 0
    );
    if (userEl && !wasJustAutofilled(userEl)) {
      rememberStepUsername(userEl.value);
    }
    const pw = pickCapturedPasswordInput(inputs);
    if (!pw) return;
    lastSubmittedCapture = {
      url: window.location.href,
      origin: window.location.origin,
      title: document.title || window.location.hostname,
      username: (userEl ? userEl.value.trim() : '') || recallStepUsername(),
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
        ? t('bannerUpdateTitle', { title: info.title || '' })
        : t('bannerSaveTitle');
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
    titleLabel.textContent = t('bannerLabelTitle');
    const titleInput = document.createElement('input');
    titleInput.className = 'ks-input';
    titleInput.value = info.title || info.suggestedTitle || window.location.hostname;
    titleFieldWrap.append(titleLabel, titleInput);
    card.appendChild(titleFieldWrap);

    const userFieldWrap = document.createElement('div');
    userFieldWrap.className = 'ks-field';
    const userLabel = document.createElement('label');
    userLabel.textContent = t('bannerLabelUsername');
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
    saveBtn.textContent = info.mode === 'update' ? t('bannerBtnUpdate') : t('bannerBtnSave');
    saveBtn.addEventListener('click', async () => {
      saveBtn.disabled = true;
      saveBtn.textContent = t('bannerBtnSaving');
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
          info.mode === 'update' ? t('bannerToastUpdated') : t('bannerToastSaved'),
          'success'
        );
        fetchAutofillData(true);
      } else {
        showToast(resp.error || t('toastSaveFailed'), 'warn');
      }
    });
    actions.appendChild(saveBtn);

    if (info.mode !== 'update') {
      const neverBtn = document.createElement('button');
      neverBtn.type = 'button';
      neverBtn.className = 'ks-btn ks-btn-sec';
      neverBtn.textContent = t('bannerNeverBtn');
      neverBtn.addEventListener('click', async () => {
        await sendMsg({ type: 'NEVER_SAVE_ORIGIN', origin: window.location.origin });
        bannerContainer.textContent = '';
      });
      actions.appendChild(neverBtn);
    }

    card.appendChild(actions);
    bannerContainer.appendChild(card);
  }

  function showSaveSsoBanner(info, entry) {
    if (!ensureOverlay() || !bannerContainer) return;
    if (bannerContainer.firstChild && bannerContainer.dataset.mode !== 'conditional') {
      return;
    }
    bannerContainer.textContent = '';
    bannerContainer.dataset.mode = 'sso';

    const provider = info.provider || entry.provider || 'SSO';
    const card = document.createElement('div');
    card.className = 'ks-banner';

    const head = document.createElement('div');
    head.className = 'ks-banner-head';
    const titleSpan = document.createElement('span');
    titleSpan.textContent =
      info.mode === 'attach'
        ? t('bannerSsoAttachTitle', { title: info.title || window.location.hostname, provider })
        : t('bannerSsoSaveTitle', { provider });
    const closeX = document.createElement('button');
    closeX.type = 'button';
    closeX.className = 'ks-btn ks-btn-ghost';
    closeX.textContent = '✕';
    closeX.addEventListener('click', () => {
      bannerContainer.textContent = '';
      delete bannerContainer.dataset.mode;
      sendMsg({ type: 'CLEAR_PENDING_SSO', origin: entry.origin || window.location.origin });
    });
    head.append(titleSpan, closeX);
    card.appendChild(head);

    const titleFieldWrap = document.createElement('div');
    titleFieldWrap.className = 'ks-field';
    const titleLabel = document.createElement('label');
    titleLabel.textContent = t('bannerLabelTitle');
    const titleInput = document.createElement('input');
    titleInput.className = 'ks-input';
    titleInput.value = info.title || info.suggestedTitle || window.location.hostname;
    titleFieldWrap.append(titleLabel, titleInput);
    card.appendChild(titleFieldWrap);

    const userFieldWrap = document.createElement('div');
    userFieldWrap.className = 'ks-field';
    const userLabel = document.createElement('label');
    userLabel.textContent = t('bannerLabelUsername');
    const userInput = document.createElement('input');
    userInput.className = 'ks-input';
    userInput.value = entry.username || info.existingUsername || '';
    userFieldWrap.append(userLabel, userInput);
    card.appendChild(userFieldWrap);

    const actions = document.createElement('div');
    actions.className = 'ks-btn-row';

    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'ks-btn ks-btn-primary';
    saveBtn.textContent = t('bannerSsoBtnSave');
    saveBtn.addEventListener('click', async () => {
      saveBtn.disabled = true;
      saveBtn.textContent = t('bannerBtnSaving');
      const resp = await sendMsg({
        type: 'SAVE_SSO_LOGIN',
        url: entry.url || window.location.href,
        origin: entry.origin || window.location.origin,
        provider,
        title: titleInput.value.trim() || window.location.hostname,
        username: userInput.value.trim(),
        itemId: info.mode === 'attach' ? info.itemId : undefined
      });
      bannerContainer.textContent = '';
      delete bannerContainer.dataset.mode;
      if (resp.ok) {
        showToast(t('bannerSsoToastSaved', { provider }), 'success');
        fetchAutofillData(true);
      } else {
        showToast(resp.error || t('toastSaveFailed'), 'warn');
      }
    });
    actions.appendChild(saveBtn);

    const neverBtn = document.createElement('button');
    neverBtn.type = 'button';
    neverBtn.className = 'ks-btn ks-btn-sec';
    neverBtn.textContent = t('bannerNeverBtn');
    neverBtn.addEventListener('click', async () => {
      await sendMsg({ type: 'NEVER_SAVE_ORIGIN', origin: window.location.origin });
      bannerContainer.textContent = '';
      delete bannerContainer.dataset.mode;
    });
    actions.appendChild(neverBtn);

    card.appendChild(actions);
    bannerContainer.appendChild(card);
  }

  async function checkPendingSsoBanner() {
    if (!isWeb) return;
    if (/[?&]error=/i.test(window.location.search || '') || /error=/i.test(window.location.hash || '')) {
      return;
    }
    const pendingSso = await sendMsg({
      type: 'CHECK_PENDING_SSO',
      origin: window.location.origin
    });
    if (!pendingSso?.shouldPrompt || !pendingSso.info || !pendingSso.entry) {
      return;
    }
    const sameLoginPath =
      window.location.pathname === (pendingSso.entry.loginPath || '') &&
      Boolean(findSsoButtonOnPage(pendingSso.entry.provider));
    if (sameLoginPath) {
      return;
    }
    showSaveSsoBanner(pendingSso.info, pendingSso.entry);
  }

  async function handleFormSubmitTrigger(targetNode) {
    if (!isWeb) return;
    const scope =
      (targetNode && targetNode.tagName === 'FORM' ? targetNode : targetNode?.closest?.('form')) ||
      targetNode?.closest?.('div, section, main') ||
      document;
    const inputs = Array.from(scope.querySelectorAll('input'));
    const userEl = inputs.find(
      (el) =>
        ['text', 'email', 'tel'].includes((el.type || 'text').toLowerCase()) &&
        classifyAuthField(el, inputs) === 'username' &&
        el.value.trim().length > 0
    );
    if (userEl && !wasJustAutofilled(userEl)) {
      rememberStepUsername(userEl.value);
    }
    const pw = pickCapturedPasswordInput(inputs);

    const creds =
      pw && pw.value
        ? {
            url: window.location.href,
            origin: window.location.origin,
            title: document.title || window.location.hostname,
            username: (userEl ? userEl.value.trim() : '') || recallStepUsername(),
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

  function postToPage(payload) {
    const targetOrigin =
      window.location.origin && window.location.origin !== 'null'
        ? window.location.origin
        : '*';
    window.postMessage(
      {
        source: 'keysmith-content',
        ...payload
      },
      targetOrigin
    );
  }

  function closeModal() {
    if (activeModalDialog) {
      try {
        if (activeModalDialog.open) {
          activeModalDialog.close();
        }
      } catch {
        // Ignore dialog close errors
      }
      activeModalDialog = null;
    }
    if (modalContainer) {
      modalContainer.textContent = '';
    }
  }

  function mountModalElement(modalEl, onCancel) {
    closeModal();
    if (!modalContainer) return false;
    if (
      typeof HTMLDialogElement !== 'undefined' &&
      typeof document.createElement('dialog').showModal === 'function'
    ) {
      try {
        const dialog = document.createElement('dialog');
        dialog.className = 'ks-modal-dialog';
        dialog.addEventListener('cancel', (e) => {
          e.preventDefault();
          if (typeof onCancel === 'function') onCancel();
        });
        dialog.appendChild(modalEl);
        modalContainer.appendChild(dialog);
        dialog.showModal();
        activeModalDialog = dialog;
        return true;
      } catch {
        modalContainer.textContent = '';
        activeModalDialog = null;
      }
    }
    const backdrop = document.createElement('div');
    backdrop.className = 'ks-modal-backdrop';
    backdrop.appendChild(modalEl);
    modalContainer.appendChild(backdrop);
    return true;
  }

  function resolveDisplayRpId(explicitRpId, origin) {
    if (explicitRpId && String(explicitRpId).trim()) {
      return String(explicitRpId).trim();
    }
    if (origin) {
      try {
        const host = new URL(origin).hostname;
        if (host) return host;
      } catch {
        // Ignore invalid origin URL
      }
    }
    return window.location.hostname;
  }

  function clearConditionalBanner() {
    if (bannerContainer && bannerContainer.dataset.mode === 'conditional') {
      bannerContainer.textContent = '';
      delete bannerContainer.dataset.mode;
    }
  }

  async function assertConditionalPasskey(pk) {
    if (!activeConditionalPasskey) return false;
    const req = activeConditionalPasskey;
    const res = await sendMsg({
      type: 'PASSKEY_ASSERT',
      itemId: pk.itemId,
      credentialId: pk.credentialId,
      verifyBiometric: Boolean(pk.reprompt),
      options: req.options
    });
    if (res.ok && res.result?.handled && res.result?.credential) {
      clearConditionalBanner();
      closeDropdown();
      activeConditionalPasskey = null;
      showToast(t('pkToastSignedIn', { rpId: pk.rpId }), 'success');
      postToPage({
        type: 'PASSKEY_CONDITIONAL_RESOLVE',
        nonce: req.nonce,
        handled: true,
        credential: res.result.credential
      });
      return true;
    }
    showToast(res.error || t('pkErrSign'), 'warn');
    return false;
  }

  function showConditionalPasskeyBanner(passkeys, options) {
    if (!ensureOverlay() || !bannerContainer || !Array.isArray(passkeys) || passkeys.length === 0) {
      return;
    }
    if (bannerContainer.firstChild && bannerContainer.dataset.mode !== 'conditional') {
      return;
    }
    bannerContainer.textContent = '';
    bannerContainer.dataset.mode = 'conditional';

    const card = document.createElement('div');
    card.className = 'ks-banner';

    const head = document.createElement('div');
    head.className = 'ks-banner-head';
    const titleWrap = document.createElement('span');
    titleWrap.style.display = 'inline-flex';
    titleWrap.style.alignItems = 'center';
    titleWrap.style.gap = '6px';
    titleWrap.appendChild(createKeySvg(15));
    const titleSpan = document.createElement('span');
    titleSpan.textContent = t('pkConditionalTitle');
    titleWrap.appendChild(titleSpan);

    const closeX = document.createElement('button');
    closeX.type = 'button';
    closeX.className = 'ks-btn ks-btn-ghost';
    closeX.textContent = '✕';
    closeX.addEventListener('click', () => {
      clearConditionalBanner();
    });
    head.append(titleWrap, closeX);
    card.appendChild(head);

    const rpId = passkeys[0]?.rpId || options?.rpId || window.location.hostname;
    const sub = document.createElement('div');
    sub.className = 'ks-modal-sub';
    sub.style.marginBottom = '8px';
    sub.textContent = t('pkConditionalSub', { rpId });
    card.appendChild(sub);

    const listEl = document.createElement('div');
    listEl.className = 'ks-pk-list';
    listEl.style.marginBottom = '0';

    for (const pk of passkeys.slice(0, 4)) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'ks-pk-item';

      const meta = document.createElement('div');
      meta.className = 'ks-dd-meta';
      const tEl = document.createElement('div');
      tEl.className = 'ks-dd-title';
      tEl.textContent = pk.itemTitle || pk.rpName || pk.rpId;
      const s = document.createElement('div');
      s.className = 'ks-dd-sub';
      s.textContent = pk.userName || pk.userDisplayName || pk.rpId;
      meta.append(tEl, s);
      btn.appendChild(meta);

      const pill = document.createElement('span');
      pill.className = 'ks-pill';
      pill.textContent = pk.reprompt ? t('repromptBadge') : t('pkDropdownAction');
      btn.appendChild(pill);

      btn.addEventListener('click', async () => {
        btn.disabled = true;
        pill.textContent = t('pkPillSigning');
        const ok = await assertConditionalPasskey(pk);
        if (!ok) {
          btn.disabled = false;
          pill.textContent = pk.reprompt ? t('repromptBadge') : t('pkDropdownAction');
        }
      });
      listEl.appendChild(btn);
    }

    card.appendChild(listEl);
    bannerContainer.appendChild(card);
  }

  function showPasskeyLockedModal(
    modalKind,
    options,
    origin,
    listPayload,
    biometricEnabled,
    relayToken = null,
    tabUrl = ''
  ) {
    return new Promise((resolve) => {
      if (!ensureOverlay() || !modalContainer) {
        resolve({ handled: false, fallback: true });
        return;
      }

      let done = false;
      let pollTimer = null;
      const finish = (result) => {
        if (done) return;
        done = true;
        if (pollTimer) clearInterval(pollTimer);
        closeModal();
        resolve(result);
      };

      const checkUnlocked = async () => {
        if (done) return;
        const res = await sendMsg({
          type: 'PASSKEY_LIST_FOR_RP',
          ...listPayload,
          ...(relayToken ? { relayToken } : {})
        });
        if (!done && res && res.connected && res.ok && res.result && !res.result.locked) {
          finish({ unlocked: true, info: res.result });
        }
      };

      const modal = document.createElement('div');
      modal.className = 'ks-modal';

      const title = document.createElement('div');
      title.className = 'ks-modal-title';
      title.appendChild(createKeySvg(18));
      const titleText = document.createElement('span');
      titleText.textContent =
        modalKind === 'create-locked' ? t('pkSaveModalTitle') : t('pkSelectModalTitle');
      title.appendChild(titleText);

      const rpId = resolveDisplayRpId(options?.rpId || options?.rp?.id, origin);
      const sourceHost = formatTabDisplaySource(tabUrl, origin, rpId);
      const sub = document.createElement('div');
      sub.className = 'ks-modal-sub';
      sub.textContent =
        modalKind === 'create-locked'
          ? t('pkModalSubSiteAccount', { rpId: sourceHost, user: options?.user?.name || 'Passkey User' })
          : t('pkSelectModalSub', { rpId: sourceHost });
      modal.append(title, sub);

      const lockNote = document.createElement('div');
      lockNote.className = 'ks-dd-empty';
      lockNote.textContent = t('pkLockedWaiting');
      modal.appendChild(lockNote);

      const row = document.createElement('div');
      row.className = 'ks-btn-row';

      if (biometricEnabled) {
        const bioBtn = document.createElement('button');
        bioBtn.type = 'button';
        bioBtn.className = 'ks-btn ks-btn-primary';
        bioBtn.textContent = t('btnUnlockTouchId');
        bioBtn.addEventListener('click', async () => {
          bioBtn.disabled = true;
          bioBtn.textContent = t('btnUnlockingTouchId');
          const res = await sendMsg({ type: 'UNLOCK_BIOMETRIC' });
          if (res && res.ok && res.result?.unlocked) {
            await checkUnlocked();
            if (!done) {
              bioBtn.disabled = false;
              bioBtn.textContent = t('btnUnlockTouchId');
            }
          } else {
            showToast(res?.error || t('toastTouchIdFailed'), 'warn');
            bioBtn.disabled = false;
            bioBtn.textContent = t('btnUnlockTouchId');
          }
        });
        row.appendChild(bioBtn);
      }

      const unlockBtn = document.createElement('button');
      unlockBtn.type = 'button';
      unlockBtn.className = biometricEnabled ? 'ks-btn ks-btn-sec' : 'ks-btn ks-btn-primary';
      unlockBtn.textContent = t('pkBtnUnlockDesktop');
      unlockBtn.addEventListener('click', async () => {
        await sendMsg({ type: 'OPEN_DESKTOP' });
        setTimeout(checkUnlocked, 500);
      });

      const retryBtn = document.createElement('button');
      retryBtn.type = 'button';
      retryBtn.className = 'ks-btn ks-btn-sec';
      retryBtn.textContent = t('pkBtnRetry');
      retryBtn.addEventListener('click', checkUnlocked);

      const fbBtn = document.createElement('button');
      fbBtn.type = 'button';
      fbBtn.className = 'ks-btn ks-btn-sec';
      fbBtn.textContent = t('pkBtnBrowserDevice');
      fbBtn.addEventListener('click', () => finish({ handled: false, fallback: true }));

      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'ks-btn ks-btn-ghost';
      cancelBtn.textContent = t('btnCancel');
      cancelBtn.addEventListener('click', () =>
        finish({ handled: false, cancelled: true, errorName: 'NotAllowedError' })
      );

      row.append(unlockBtn, retryBtn, fbBtn, cancelBtn);
      modal.appendChild(row);
      mountModalElement(modal, () =>
        finish({ handled: false, cancelled: true, errorName: 'NotAllowedError' })
      );

      pollTimer = setInterval(checkUnlocked, 1200);
    });
  }

  function formatTabDisplaySource(tabUrl, origin, rpId) {
    let tabOrigin = '';
    try {
      if (tabUrl) tabOrigin = new URL(tabUrl).origin;
    } catch {
      tabOrigin = '';
    }
    const base = tabOrigin || origin || rpId;
    if (origin && tabOrigin && origin !== tabOrigin) {
      return `${base} (iframe: ${origin} · RP: ${rpId})`;
    }
    return rpId && !base.includes(rpId) ? `${base} (RP: ${rpId})` : base;
  }

  async function presentPasskeyModal(modalKind, payload) {
    if (window !== window.top && !payload.relayToken) {
      const relayReply = await sendMsg({
        type: 'PASSKEY_SHOW_TOP_MODAL',
        modalKind,
        ...payload
      });
      const relaySucceeded =
        relayReply &&
        !relayReply._relayFailed &&
        !(relayReply.ok === false && relayReply.connected === false);
      if (relaySucceeded) {
        return relayReply;
      }
    }
    if (modalKind === 'create-locked' || modalKind === 'get-locked') {
      return showPasskeyLockedModal(
        modalKind,
        payload.options,
        payload.origin,
        payload.listPayload,
        Boolean(payload.info?.biometricEnabled),
        payload.relayToken || null,
        payload.tabUrl || ''
      );
    }
    if (modalKind === 'create') {
      return showPasskeyCreateModal(
        payload.options,
        payload.origin,
        payload.info,
        payload.relayToken || null,
        payload.tabUrl || ''
      );
    }
    return showPasskeySelectModal(
      payload.options,
      payload.origin,
      payload.passkeys,
      payload.relayToken || null,
      payload.tabUrl || ''
    );
  }

  function showPasskeyCreateModal(options, origin, listInfo, relayToken = null, tabUrl = '') {
    return new Promise((resolve) => {
      if (!ensureOverlay() || !modalContainer) {
        resolve({ handled: false, fallback: true });
        return;
      }

      const modal = document.createElement('div');
      modal.className = 'ks-modal';

      const title = document.createElement('div');
      title.className = 'ks-modal-title';
      title.appendChild(createKeySvg(18));
      const titleText = document.createElement('span');
      titleText.textContent = t('pkSaveModalTitle');
      title.appendChild(titleText);

      const rpId = resolveDisplayRpId(options?.rp?.id, origin);
      const sourceHost = formatTabDisplaySource(tabUrl, origin, rpId);
      const userName = options?.user?.name || options?.user?.displayName || 'Passkey User';

      const sub = document.createElement('div');
      sub.className = 'ks-modal-sub';
      sub.textContent = t('pkModalSubSiteAccount', { rpId: sourceHost, user: userName });
      modal.append(title, sub);

      if (listInfo.locked) {
        const lockNote = document.createElement('div');
        lockNote.className = 'ks-dd-empty';
        lockNote.textContent = t('pkLockedNote');
        modal.appendChild(lockNote);

        const row = document.createElement('div');
        row.className = 'ks-btn-row';
        const unlockBtn = document.createElement('button');
        unlockBtn.type = 'button';
        unlockBtn.className = 'ks-btn ks-btn-primary';
        unlockBtn.textContent = t('pkBtnUnlockDesktop');
        unlockBtn.addEventListener('click', async () => {
          await sendMsg({ type: 'OPEN_DESKTOP' });
          closeModal();
          resolve({ handled: false, fallback: true });
        });
        const fbBtn = document.createElement('button');
        fbBtn.type = 'button';
        fbBtn.className = 'ks-btn ks-btn-sec';
        fbBtn.textContent = t('pkBtnBrowserDevice');
        fbBtn.addEventListener('click', () => {
          closeModal();
          resolve({ handled: false, fallback: true });
        });
        const cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.className = 'ks-btn ks-btn-ghost';
        cancelBtn.textContent = t('btnCancel');
        cancelBtn.addEventListener('click', () => {
          closeModal();
          resolve({ handled: false, cancelled: true, errorName: 'NotAllowedError' });
        });
        row.append(unlockBtn, fbBtn, cancelBtn);
        modal.appendChild(row);
        mountModalElement(modal, () => {
          closeModal();
          resolve({ handled: false, cancelled: true, errorName: 'NotAllowedError' });
        });
        return;
      }

      const candidates = Array.isArray(listInfo.candidates) ? listInfo.candidates : [];
      const targetWrap = document.createElement('div');
      targetWrap.className = 'ks-field';
      const targetLbl = document.createElement('label');
      targetLbl.textContent = t('pkLabelSaveTo');
      const select = document.createElement('select');
      select.className = 'ks-select';
      const newOpt = document.createElement('option');
      newOpt.value = '';
      newOpt.textContent = t('pkNewLoginOpt', { name: options?.rp?.name || rpId });
      select.appendChild(newOpt);
      for (const cand of candidates) {
        const opt = document.createElement('option');
        opt.value = cand.itemId;
        opt.textContent = t('pkBindOpt', {
          title: cand.title || t('unnamedItem'),
          userPart: cand.username ? ` (${cand.username})` : ''
        });
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
      titleLbl.textContent = t('pkLabelNewTitle');
      const itemTitleInput = document.createElement('input');
      itemTitleInput.className = 'ks-input';
      itemTitleInput.value = options?.rp?.name || rpId;
      titleFieldWrap.append(titleLbl, itemTitleInput);
      titleFieldWrap.style.display = select.value ? 'none' : 'block';
      select.addEventListener('change', () => {
        titleFieldWrap.style.display = select.value ? 'none' : 'block';
      });
      modal.appendChild(titleFieldWrap);

      const errBox = document.createElement('div');
      errBox.className = 'ks-modal-err';
      modal.appendChild(errBox);

      const btnRow = document.createElement('div');
      btnRow.className = 'ks-btn-row';

      const saveBtn = document.createElement('button');
      saveBtn.type = 'button';
      saveBtn.className = 'ks-btn ks-btn-primary';
      saveBtn.textContent = t('pkBtnSavePasskey');
      saveBtn.addEventListener('click', async () => {
        saveBtn.disabled = true;
        saveBtn.textContent = t('pkBtnCreating');
        errBox.style.display = 'none';
        errBox.textContent = '';
        const res = await sendMsg({
          type: 'PASSKEY_CREATE',
          ...(relayToken ? { relayToken } : {}),
          itemId: select.value || undefined,
          title: itemTitleInput.value.trim() || undefined,
          options
        });
        if (res.ok && res.result?.handled && res.result?.credential) {
          closeModal();
          showToast(t('pkToastSaved'), 'success');
          resolve({ handled: true, credential: res.result.credential });
        } else if (res.ok && res.result?.errorName) {
          closeModal();
          resolve({
            handled: false,
            errorName: res.result.errorName,
            error: res.result.error
          });
        } else {
          const errText = res.error || res.result?.error || t('pkErrCreate');
          saveBtn.disabled = false;
          saveBtn.textContent = t('pkBtnSavePasskey');
          errBox.textContent = errText;
          errBox.style.display = 'block';
          showToast(errText, 'warn');
        }
      });

      const fbBtn = document.createElement('button');
      fbBtn.type = 'button';
      fbBtn.className = 'ks-btn ks-btn-sec';
      fbBtn.textContent = t('pkBtnBrowserDevice');
      fbBtn.addEventListener('click', () => {
        closeModal();
        resolve({ handled: false, fallback: true });
      });

      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'ks-btn ks-btn-ghost';
      cancelBtn.textContent = t('btnCancel');
      cancelBtn.addEventListener('click', () => {
        closeModal();
        resolve({ handled: false, cancelled: true, errorName: 'NotAllowedError' });
      });

      btnRow.append(saveBtn, fbBtn, cancelBtn);
      modal.appendChild(btnRow);
      mountModalElement(modal, () => {
        closeModal();
        resolve({ handled: false, cancelled: true, errorName: 'NotAllowedError' });
      });
    });
  }

  function showPasskeySelectModal(options, origin, passkeys, relayToken = null, tabUrl = '') {
    return new Promise((resolve) => {
      if (!ensureOverlay() || !modalContainer) {
        resolve({ handled: false, fallback: true });
        return;
      }

      const modal = document.createElement('div');
      modal.className = 'ks-modal';

      const title = document.createElement('div');
      title.className = 'ks-modal-title';
      title.appendChild(createKeySvg(18));
      const titleText = document.createElement('span');
      titleText.textContent = t('pkSelectModalTitle');
      title.appendChild(titleText);

      const rpId = resolveDisplayRpId(options?.rpId, origin);
      const sourceHost = formatTabDisplaySource(tabUrl, origin, rpId);
      const sub = document.createElement('div');
      sub.className = 'ks-modal-sub';
      sub.textContent = t('pkSelectModalSub', { rpId: sourceHost });
      modal.append(title, sub);

      const listEl = document.createElement('div');
      listEl.className = 'ks-pk-list';

      for (const pk of passkeys) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'ks-pk-item';

        const meta = document.createElement('div');
        meta.className = 'ks-dd-meta';
        const tEl = document.createElement('div');
        tEl.className = 'ks-dd-title';
        tEl.textContent = pk.itemTitle || pk.rpName || pk.rpId;
        const s = document.createElement('div');
        s.className = 'ks-dd-sub';
        s.textContent = pk.userName || pk.userDisplayName || pk.rpId;
        meta.append(tEl, s);
        btn.appendChild(meta);

        const pill = document.createElement('span');
        pill.className = 'ks-pill';
        pill.textContent = pk.reprompt ? t('repromptBadge') : 'Passkey';
        btn.appendChild(pill);

        btn.addEventListener('click', async () => {
          btn.disabled = true;
          pill.textContent = t('pkPillSigning');
          const res = await sendMsg({
            type: 'PASSKEY_ASSERT',
            ...(relayToken ? { relayToken } : {}),
            itemId: pk.itemId,
            credentialId: pk.credentialId,
            verifyBiometric: Boolean(pk.reprompt),
            options
          });
          closeModal();
          if (res.ok && res.result?.handled && res.result?.credential) {
            showToast(t('pkToastSignedIn', { rpId: pk.rpId }), 'success');
            resolve({ handled: true, credential: res.result.credential });
          } else {
            showToast(res.error || t('pkErrSign'), 'warn');
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
      fbBtn.textContent = t('pkBtnBrowserDevice');
      fbBtn.addEventListener('click', () => {
        closeModal();
        resolve({ handled: false, fallback: true });
      });

      const cancelBtn = document.createElement('button');
      cancelBtn.type = 'button';
      cancelBtn.className = 'ks-btn ks-btn-ghost';
      cancelBtn.textContent = t('btnCancel');
      cancelBtn.addEventListener('click', () => {
        closeModal();
        resolve({ handled: false, cancelled: true, errorName: 'NotAllowedError' });
      });

      btnRow.append(fbBtn, cancelBtn);
      modal.appendChild(btnRow);
      mountModalElement(modal, () => {
        closeModal();
        resolve({ handled: false, cancelled: true, errorName: 'NotAllowedError' });
      });
    });
  }

  // ==================== Listeners & Bridges ====================

  window.addEventListener('message', async (event) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== 'keysmith-page') return;

    if (data.type === 'PASSKEY_CONDITIONAL_CANCEL') {
      if (activeConditionalPasskey && (!data.nonce || activeConditionalPasskey.nonce === data.nonce)) {
        activeConditionalPasskey = null;
        clearConditionalBanner();
      }
      return;
    }

    if (data.type === 'PASSKEY_CONDITIONAL_START') {
      const listPayload = {
        rpId: data.options?.rpId || window.location.hostname,
        rpIdExplicit: data.options?.rpIdExplicit !== false,
        allowCredentials: (data.options?.allowCredentials || []).map((c) => c.id),
        excludeCredentials: []
      };
      try {
        const listRes = await sendMsg({ type: 'PASSKEY_LIST_FOR_RP', ...listPayload });
        if (!listRes || !listRes.connected || !listRes.ok) {
          postToPage({
            type: 'PASSKEY_CONDITIONAL_STATUS',
            nonce: data.nonce,
            available: false
          });
          return;
        }
        const info = listRes.result || {};
        const passkeys = Array.isArray(info.passkeys) ? info.passkeys : [];
        if (info.locked || passkeys.length === 0) {
          postToPage({
            type: 'PASSKEY_CONDITIONAL_STATUS',
            nonce: data.nonce,
            available: false
          });
          return;
        }
        activeConditionalPasskey = {
          nonce: data.nonce,
          origin: window.location.origin,
          options: data.options,
          passkeys
        };
        postToPage({
          type: 'PASSKEY_CONDITIONAL_STATUS',
          nonce: data.nonce,
          available: true
        });
        showConditionalPasskeyBanner(passkeys, data.options);
        if (activeDropdownInput) {
          openDropdownForInput(activeDropdownInput, activeDropdownKind || 'username');
        }
      } catch {
        postToPage({
          type: 'PASSKEY_CONDITIONAL_STATUS',
          nonce: data.nonce,
          available: false
        });
      }
      return;
    }

    if (data.type !== 'PASSKEY_CREATE_REQUEST' && data.type !== 'PASSKEY_GET_REQUEST') {
      return;
    }

    const reply = (payload) => {
      postToPage({
        nonce: data.nonce,
        ...payload
      });
    };

    try {
      const rpId =
        data.type === 'PASSKEY_CREATE_REQUEST'
          ? data.options?.rp?.id || window.location.hostname
          : data.options?.rpId || window.location.hostname;
      const listPayload = {
        rpId,
        rpIdExplicit:
          data.type === 'PASSKEY_CREATE_REQUEST' ? true : data.options?.rpIdExplicit !== false,
        allowCredentials: (data.options?.allowCredentials || []).map((c) => c.id),
        excludeCredentials: (data.options?.excludeCredentials || []).map((c) => c.id)
      };

      const listRes = await sendMsg({
        type: 'PASSKEY_LIST_FOR_RP',
        ...listPayload
      });

      if (!listRes || !listRes.connected || !listRes.ok) {
        if (data.type === 'PASSKEY_CREATE_REQUEST') {
          showToast(listRes?.error || t('toastConnectDesktopFirst'), 'warn');
        }
        reply({ handled: false, fallback: true });
        return;
      }

      let info = listRes.result || {};
      const trustedOrigin = info.origin || window.location.origin;
      if (data.type === 'PASSKEY_CREATE_REQUEST') {
        if (info.excluded) {
          reply({
            handled: false,
            errorName: 'InvalidStateError',
            error: t('pkErrDuplicate')
          });
          return;
        }
        if (info.locked && !info.signedOut) {
          const lockReply = await presentPasskeyModal('create-locked', {
            options: data.options,
            origin: trustedOrigin,
            tabUrl: info.tabUrl || '',
            listPayload,
            info
          });
          if (!lockReply?.unlocked) {
            reply(lockReply || { handled: false, fallback: true });
            return;
          }
          info = lockReply.info || {};
          if (info.excluded) {
            reply({
              handled: false,
              errorName: 'InvalidStateError',
              error: t('pkErrDuplicate')
            });
            return;
          }
        }
        const modalReply = await presentPasskeyModal('create', {
          options: data.options,
          origin: info.origin || trustedOrigin,
          tabUrl: info.tabUrl || '',
          info
        });
        reply(modalReply);
        return;
      }

      // PASSKEY_GET_REQUEST
      if (info.locked && !info.signedOut) {
        const lockReply = await presentPasskeyModal('get-locked', {
          options: data.options,
          origin: trustedOrigin,
          tabUrl: info.tabUrl || '',
          listPayload,
          info
        });
        if (!lockReply?.unlocked) {
          reply(lockReply || { handled: false, fallback: true });
          return;
        }
        info = lockReply.info || {};
      }

      const passkeys = Array.isArray(info.passkeys) ? info.passkeys : [];
      if (info.locked || passkeys.length === 0) {
        reply({ handled: false, fallback: true });
        return;
      }

      const modalReply = await presentPasskeyModal('get-select', {
        options: data.options,
        origin: info.origin || trustedOrigin,
        tabUrl: info.tabUrl || '',
        passkeys
      });
      reply(modalReply);
    } catch {
      reply({ handled: false, fallback: true });
    }
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'PASSKEY_RENDER_MODAL') {
      presentPasskeyModal(message.modalKind, message)
        .then((res) => sendResponse(res))
        .catch(() => sendResponse({ handled: false, fallback: true }));
      return true;
    }
    if (message?.type === 'FILL_CREDENTIALS') {
      sendResponse(
        autofillLogin(
          message.username || '',
          message.password || '',
          message.totp || '',
          activeDropdownInput,
          message.ssoProvider || ''
        )
      );
      return true;
    }
    if (message?.type === 'FILL_GENERATED_PASSWORD') {
      sendResponse(autofillGeneratedPassword(message.password || '', activeDropdownInput));
      return true;
    }
    if (message?.type === 'FILL_GENERATED_USERNAME') {
      sendResponse(autofillGeneratedUsername(message.username || '', activeDropdownInput));
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
        const ssoControl = e.target?.closest?.(
          'button, a[href], [role="button"], input[type="button"], input[type="submit"]'
        );
        if (ssoControl && Date.now() - lastProgrammaticSsoClickAt > 2500) {
          const ssoProvider = detectSsoButtonProvider(ssoControl);
          if (ssoProvider) {
            const visibleInputs = Array.from(document.querySelectorAll('input')).filter(isVisible);
            const userInput = visibleInputs.find(
              (el) => classifyAuthField(el, visibleInputs) === 'username' && el.value.trim().length > 0
            );
            const usernameHint = (userInput ? userInput.value.trim() : '') || recallStepUsername();
            void sendMsg({
              type: 'RECORD_PENDING_SSO',
              origin: window.location.origin,
              url: window.location.href,
              loginPath: window.location.pathname,
              provider: ssoProvider,
              username: usernameHint
            });
            const onFocusReturn = () => {
              setTimeout(() => void checkPendingSsoBanner(), 900);
            };
            window.addEventListener('focus', onFocusReturn, { once: true });
            setTimeout(() => void checkPendingSsoBanner(), 3500);
            setTimeout(() => void checkPendingSsoBanner(), 8500);
          }
        }

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
          return;
        }
        await checkPendingSsoBanner();
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
