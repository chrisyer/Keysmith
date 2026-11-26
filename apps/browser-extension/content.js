(() => {
  let mainWorldReady = false;

  document.addEventListener(
    'keysmith:passkey-ready',
    () => {
      mainWorldReady = true;
    },
    { once: true }
  );

  // Fallback script injection if the browser ignored manifest "world": "MAIN"
  function ensureMainWorldFallback() {
    if (mainWorldReady) return;
    try {
      const target = document.head || document.documentElement;
      if (!target) return;
      const script = document.createElement('script');
      script.src = chrome.runtime.getURL('passkey-inject.js');
      script.async = false;
      script.onload = () => script.remove();
      script.onerror = () => script.remove();
      target.appendChild(script);
    } catch {
      // Ignore fallback injection failures under strict CSP
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ensureMainWorldFallback, { once: true });
  } else {
    ensureMainWorldFallback();
  }

  // Relay Passkey create/get requests from MAIN world to background service worker
  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (event.origin !== window.location.origin) return;
    const data = event.data;
    if (!data || data.source !== 'keysmith-page') return;
    if (data.type !== 'PASSKEY_CREATE_REQUEST' && data.type !== 'PASSKEY_GET_REQUEST') return;

    const action = data.type === 'PASSKEY_CREATE_REQUEST' ? 'create' : 'get';

    chrome.runtime.sendMessage(
      {
        type: 'PASSKEY_BRIDGE',
        action,
        origin: event.origin,
        options: data.options
      },
      (response) => {
        const lastError = chrome.runtime.lastError;
        if (lastError || !response) {
          window.postMessage(
            {
              source: 'keysmith-content',
              nonce: data.nonce,
              handled: false,
              fallback: true
            },
            window.location.origin
          );
          return;
        }

        window.postMessage(
          {
            source: 'keysmith-content',
            nonce: data.nonce,
            handled: Boolean(response.handled),
            credential: response.credential || null,
            fallback: response.fallback !== false,
            cancelled: Boolean(response.cancelled)
          },
          window.location.origin
        );
      }
    );
  });

  function isElementVisible(el) {
    if (!el || el.disabled || el.readOnly) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
      return false;
    }
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function findUsernameField(passwordInput) {
    const scope = passwordInput?.form || document;
    const candidates = Array.from(
      scope.querySelectorAll(
        'input[autocomplete="username"], input[autocomplete="email"], input[type="email"], input[type="text"], input:not([type])'
      )
    ).filter(isElementVisible);

    if (candidates.length === 0) return null;

    // Prefer explicit autocomplete or email/user naming heuristics
    const scored = candidates.map((el) => {
      let score = 0;
      const ac = (el.getAttribute('autocomplete') || '').toLowerCase();
      const type = (el.getAttribute('type') || '').toLowerCase();
      const role = (el.getAttribute('role') || '').toLowerCase();
      const attrs = `${el.name || ''} ${el.id || ''} ${el.placeholder || ''} ${el.getAttribute('aria-label') || ''}`.toLowerCase();

      if (role === 'searchbox' || ac === 'off' && /search/.test(attrs)) score -= 80;
      if (ac === 'username' || ac === 'email') score += 50;
      if (type === 'email') score += 40;
      if (/user|email|mail|account|login|phone|identifier/.test(attrs)) score += 30;
      if (/search|query|captcha|otp|code|token/.test(attrs)) score -= 50;

      // Prefer fields appearing before the password input in DOM order
      if (passwordInput && (el.compareDocumentPosition(passwordInput) & Node.DOCUMENT_POSITION_FOLLOWING)) {
        score += 15;
      }
      return { el, score };
    });

    scored.sort((a, b) => b.score - a.score);
    // When there is no password field yet (multi-step login), require positive username/email signal
    const threshold = passwordInput ? 0 : 20;
    return scored[0].score >= threshold ? scored[0].el : null;
  }

  function findTotpField() {
    const candidates = Array.from(
      document.querySelectorAll(
        'input[autocomplete="one-time-code"], input[inputmode="numeric"], input[name*="otp" i], input[name*="totp" i], input[name*="2fa" i], input[id*="otp" i], input[id*="totp" i]'
      )
    ).filter(isElementVisible);
    return candidates[0] || null;
  }

  function detectLoginForms() {
    const passwords = Array.from(document.querySelectorAll('input[type="password"]')).filter(isElementVisible);
    const passwordInput = passwords[0] || null;
    const usernameInput = findUsernameField(passwordInput);
    const totpInput = findTotpField();
    return {
      hasLoginForm: Boolean(passwordInput || usernameInput || totpInput),
      hasPasswordField: Boolean(passwordInput),
      hasUsernameField: Boolean(usernameInput),
      hasTotpField: Boolean(totpInput),
      passwordInput,
      usernameInput,
      totpInput
    };
  }

  function setNativeInputValue(input, value) {
    if (!input || value === undefined || value === null) return false;
    input.focus({ preventScroll: true });
    const proto = window.HTMLInputElement?.prototype;
    const setter = proto ? Object.getOwnPropertyDescriptor(proto, 'value')?.set : null;
    if (setter) {
      setter.call(input, value);
    } else {
      input.value = value;
    }
    input.dispatchEvent(new Event('input', { bubbles: true, cancelable: true }));
    input.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
    return true;
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (!message || !message.type) return;

    if (message.type === 'KEYSMITH_DETECT_FORMS') {
      const detected = detectLoginForms();
      sendResponse({
        hasLoginForm: detected.hasLoginForm,
        hasPasswordField: detected.hasPasswordField,
        hasUsernameField: detected.hasUsernameField,
        hasTotpField: detected.hasTotpField
      });
      return;
    }

    if (message.type === 'KEYSMITH_AUTOFILL') {
      const detected = detectLoginForms();
      let filledUsername = false;
      let filledPassword = false;
      let filledTotp = false;

      if (message.username && detected.usernameInput) {
        filledUsername = setNativeInputValue(detected.usernameInput, message.username);
      }
      if (message.password && detected.passwordInput) {
        filledPassword = setNativeInputValue(detected.passwordInput, message.password);
      }
      if (message.totp && detected.totpInput) {
        filledTotp = setNativeInputValue(detected.totpInput, message.totp);
      }

      sendResponse({
        ok: filledUsername || filledPassword || filledTotp,
        filledUsername,
        filledPassword,
        filledTotp
      });
    }
  });
})();
