import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import vm from 'node:vm';

const JS_FILES = [
  'apps/browser-extension/i18n.js',
  'apps/browser-extension/passkey-inject.js',
  'apps/browser-extension/content.js',
  'apps/browser-extension/background.js',
  'apps/browser-extension/popup.js',
];

for (const file of JS_FILES) {
  execFileSync(process.execPath, ['--check', file], { stdio: 'inherit' });
}

// 1. Verify Chrome fixed extension ID & Firefox manifest parity
const chromeManifest = JSON.parse(fs.readFileSync('apps/browser-extension/manifest.json', 'utf8'));
const digest = crypto.createHash('sha256').update(Buffer.from(chromeManifest.key, 'base64')).digest();
const nibbleMap = 'abcdefghijklmnop';
let computedId = '';
for (let i = 0; i < 16; i += 1) {
  computedId += nibbleMap[digest[i] >> 4] + nibbleMap[digest[i] & 15];
}
assert.equal(computedId, 'ianpdijhflnmmhbmjdhiombdghhpfkmg', 'Chrome Extension ID mismatch');

const firefoxManifest = JSON.parse(fs.readFileSync('apps/browser-extension/manifest.firefox.json', 'utf8'));
assert.equal(firefoxManifest.version, chromeManifest.version);
assert.equal(firefoxManifest.manifest_version, 3);
assert.ok(firefoxManifest.browser_specific_settings?.gecko?.id);
assert.ok(firefoxManifest.permissions.includes('privacy'));

// 2. Verify all 8 locales in i18n.js and _locales/*/messages.json
const i18nCode = fs.readFileSync('apps/browser-extension/i18n.js', 'utf8');
const i18nSandbox = { chrome: {}, navigator: { language: 'en' } };
i18nSandbox.globalThis = i18nSandbox;
vm.runInNewContext(i18nCode, i18nSandbox);

const locales = ['en', 'zh-CN', 'zh-TW', 'ja', 'ko', 'de', 'fr', 'es'];
const localeFolders = ['en', 'zh_CN', 'zh_TW', 'ja', 'ko', 'de', 'fr', 'es'];
const testKeys = [
  'extIdPrefix',
  'repromptBiometricBtn',
  'btnEdit',
  'btnDelete',
  'confirmDeleteItem',
  'ddCardsTitle',
  'pkConditionalTitle',
  'pkLockedWaiting',
  'modeMaskedEmail',
  'genMaskedBadge',
  'ddGenMaskedTitle',
  'ddCopiedFilledAlias',
  'ssoBadgePrefix',
  'bannerSsoSaveTitle',
  'bannerSsoAttachTitle',
  'bannerSsoBtnSave',
  'bannerSsoToastSaved',
  'ddSsoTriggered',
  'errNoSsoButton',
];
await i18nSandbox.KeysmithI18n.ready();
for (const loc of locales) {
  await i18nSandbox.KeysmithI18n.setLanguageMode(loc);
  for (const key of testKeys) {
    const val = i18nSandbox.KeysmithI18n.t(key, { rpId: 'paypal.com', title: 'Demo' });
    assert.ok(val && val !== key, `Missing or untranslated key ${loc}.${key}`);
  }
}

const baseLocaleJson = JSON.parse(
  fs.readFileSync('apps/browser-extension/_locales/en/messages.json', 'utf8'),
);
for (const folder of localeFolders) {
  const data = JSON.parse(
    fs.readFileSync(`apps/browser-extension/_locales/${folder}/messages.json`, 'utf8'),
  );
  assert.deepEqual(
    Object.keys(data).sort(),
    Object.keys(baseLocaleJson).sort(),
    `_locales/${folder}/messages.json keys mismatch`,
  );
}

// 3. Verify passkey-inject.js WebAuthn hooks, conditional mediation, abort, cross-realm ArrayBuffer
const injectCode = fs.readFileSync('apps/browser-extension/passkey-inject.js', 'utf8');
function makeMockWebAuthnEnv() {
  const listeners = new Map();
  class CredentialsContainer {}
  CredentialsContainer.prototype.get = function () {
    return new Promise((_res, rej) => {
      setTimeout(() => rej(new DOMException('native fallback', 'NotAllowedError')), 5);
    });
  };
  CredentialsContainer.prototype.create = function () {
    return Promise.resolve({ nativeCreated: true });
  };
  const creds = new CredentialsContainer();
  function PublicKeyCredential() {}
  PublicKeyCredential.getClientCapabilities = async () => ({ existingFlag: true });
  function AuthenticatorAssertionResponse() {}
  function AuthenticatorAttestationResponse() {}
  class CustomEvent {
    constructor(name) {
      this.type = name;
    }
  }
  const sandbox = {
    window: null,
    self: null,
    document: { dispatchEvent: () => {} },
    navigator: { credentials: creds },
    CredentialsContainer,
    PublicKeyCredential,
    AuthenticatorAssertionResponse,
    AuthenticatorAttestationResponse,
    CustomEvent,
    DOMException,
    crypto: crypto.webcrypto,
    ArrayBuffer,
    Uint8Array,
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    setTimeout,
    clearTimeout,
    addEventListener: (ev, fn) => {
      if (!listeners.has(ev)) listeners.set(ev, new Set());
      listeners.get(ev).add(fn);
    },
    removeEventListener: (ev, fn) => {
      if (listeners.has(ev)) listeners.get(ev).delete(fn);
    },
    postMessage: (msg, target) => {
      if (sandbox.__onPost) sandbox.__onPost(msg, target);
    },
    location: { origin: 'https://www.paypal.com', hostname: 'www.paypal.com' },
    top: null,
  };
  sandbox.window = sandbox;
  sandbox.top = sandbox;
  const ctx = vm.createContext(sandbox);
  const vmWindow = vm.runInContext('window', ctx);
  vm.runInContext(injectCode, ctx);
  return {
    sandbox: ctx,
    emitMessage: (data) => {
      for (const fn of listeners.get('message') || []) {
        fn({ source: vmWindow, data });
      }
    },
  };
}

const env = makeMockWebAuthnEnv();
assert.equal(await env.sandbox.PublicKeyCredential.isConditionalMediationAvailable(), true);
assert.equal(
  await env.sandbox.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable(),
  true,
);
const caps = await env.sandbox.PublicKeyCredential.getClientCapabilities();
assert.equal(caps.conditionalGet, true);
assert.equal(caps.relatedOrigins, true);
assert.equal(caps.existingFlag, true);

env.sandbox.__onPost = (msg, target) => {
  assert.equal(target, 'https://www.paypal.com');
  if (msg.type === 'PASSKEY_CONDITIONAL_START') {
    assert.equal(msg.options.rpIdExplicit, false);
    assert.equal(msg.options.rpId, 'www.paypal.com');
    assert.equal(msg.options.allowCredentials[0].id, 'ab-cd_e');
    setTimeout(() => {
      env.emitMessage({
        source: 'keysmith-content',
        type: 'PASSKEY_CONDITIONAL_STATUS',
        nonce: msg.nonce,
        available: true,
      });
      setTimeout(() => {
        env.emitMessage({
          source: 'keysmith-content',
          type: 'PASSKEY_CONDITIONAL_RESOLVE',
          nonce: msg.nonce,
          handled: true,
          credential: {
            id: 'AAAA',
            rawId: 'AAAA',
            type: 'public-key',
            response: {
              clientDataJSON: Buffer.from('{}').toString('base64url'),
              authenticatorData: Buffer.alloc(37).toString('base64url'),
              signature: Buffer.alloc(64).toString('base64url'),
              userHandle: null,
            },
          },
        });
      }, 15);
    }, 2);
  }
};

const challengeOtherRealm = vm.runInNewContext('new Uint8Array([1,2,3,4]).buffer');
const conditionalRes = await env.sandbox.CredentialsContainer.prototype.get.call(
  env.sandbox.navigator.credentials,
  {
    mediation: 'conditional',
    publicKey: {
      challenge: challengeOtherRealm,
      allowCredentials: [{ type: 'public-key', id: 'ab+cd/e=' }],
    },
  },
);
assert.equal(conditionalRes.id, 'AAAA');
assert.ok(conditionalRes instanceof env.sandbox.PublicKeyCredential);
assert.equal(conditionalRes.toJSON().id, 'AAAA');

const ac = new AbortController();
let sawCancel = false;
env.sandbox.__onPost = (msg) => {
  if (msg.type === 'PASSKEY_CONDITIONAL_START') {
    setTimeout(() => ac.abort(), 5);
  }
  if (msg.type === 'PASSKEY_CONDITIONAL_CANCEL') {
    sawCancel = true;
  }
};
await assert.rejects(
  env.sandbox.navigator.credentials.get({
    mediation: 'conditional',
    signal: ac.signal,
    publicKey: { challenge: new Uint8Array([5, 6]).buffer, rpId: 'paypal.com' },
  }),
  (err) => err && err.name === 'AbortError',
);
assert.equal(sawCancel, true);

// 4. Verify passkey-inject.js create() handles Proxy-wrapped options, Set excludeCredentials, cross-realm ArrayBuffers, and AttestationResponse methods
const userIdOtherRealm = vm.runInNewContext('new Uint8Array([9, 8, 7, 6]).buffer');
const createChalOtherRealm = vm.runInNewContext('new Uint8Array([11, 22, 33, 44]).buffer');
const proxyCredParams = new Proxy([{ type: 'public-key', alg: -7 }], {});
const proxyAuthSelection = new Proxy(
  { authenticatorAttachment: 'platform', residentKey: 'required', requireResidentKey: true, userVerification: 'preferred' },
  {},
);
const proxyExtensions = new Proxy(
  {
    credProps: true,
    prf: { eval: { first: new Uint8Array([1, 2, 3]) } },
    fnIgnored: () => 'should-be-stripped',
  },
  {},
);

let capturedCreatePost = null;
env.sandbox.__onPost = (msg, target) => {
  assert.equal(target, 'https://www.paypal.com');
  if (msg.type === 'PASSKEY_CREATE_REQUEST') {
    capturedCreatePost = JSON.parse(JSON.stringify(msg));
    setTimeout(() => {
      env.emitMessage({
        source: 'keysmith-content',
        nonce: msg.nonce,
        handled: true,
        credential: {
          id: 'NEWCRED',
          rawId: 'NEWCRED',
          type: 'public-key',
          authenticatorAttachment: 'platform',
          response: {
            clientDataJSON: Buffer.from('{}').toString('base64url'),
            attestationObject: Buffer.from([0xa0]).toString('base64url'),
            authenticatorData: Buffer.alloc(37).toString('base64url'),
            publicKey: Buffer.from([1, 2, 3, 4]).toString('base64url'),
            publicKeyAlgorithm: -7,
            transports: ['internal', 'hybrid'],
          },
          clientExtensionResults: { credProps: { rk: true } },
        },
      });
    }, 5);
  }
};

const createdRes = await env.sandbox.navigator.credentials.create({
  publicKey: {
    rp: { id: 'paypal.com', name: 'PayPal' },
    user: { id: userIdOtherRealm, name: 'buyer@paypal.com', displayName: 'Buyer' },
    challenge: createChalOtherRealm,
    pubKeyCredParams: proxyCredParams,
    excludeCredentials: new Set([{ type: 'public-key', id: 'existing-id', transports: ['internal'] }]),
    authenticatorSelection: proxyAuthSelection,
    extensions: proxyExtensions,
  },
});
assert.ok(capturedCreatePost, 'Expected PASSKEY_CREATE_REQUEST message');
assert.equal(capturedCreatePost.options.rp.id, 'paypal.com');
assert.equal(capturedCreatePost.options.rpIdExplicit, true);
assert.equal(capturedCreatePost.options.user.id, Buffer.from([9, 8, 7, 6]).toString('base64url'));
assert.equal(capturedCreatePost.options.challenge, Buffer.from([11, 22, 33, 44]).toString('base64url'));
assert.deepEqual(capturedCreatePost.options.pubKeyCredParams, [{ type: 'public-key', alg: -7 }]);
assert.equal(capturedCreatePost.options.excludeCredentials.length, 1);
assert.equal(capturedCreatePost.options.excludeCredentials[0].id, 'existing-id');
assert.deepEqual(capturedCreatePost.options.authenticatorSelection, {
  authenticatorAttachment: 'platform',
  residentKey: 'required',
  requireResidentKey: true,
  userVerification: 'preferred',
});
assert.equal(capturedCreatePost.options.extensions.credProps, true);
assert.equal(
  capturedCreatePost.options.extensions.prf.eval.first,
  Buffer.from([1, 2, 3]).toString('base64url'),
);
assert.equal('fnIgnored' in capturedCreatePost.options.extensions, false);

assert.equal(createdRes.id, 'NEWCRED');
assert.ok(createdRes instanceof env.sandbox.PublicKeyCredential);
assert.ok(createdRes.response instanceof env.sandbox.AuthenticatorAttestationResponse);
assert.deepEqual(Array.from(createdRes.response.getTransports()), ['internal', 'hybrid']);
assert.equal(createdRes.response.getAuthenticatorData().byteLength, 37);
assert.equal(createdRes.response.getPublicKey().byteLength, 4);
assert.equal(createdRes.response.getPublicKeyAlgorithm(), -7);
assert.deepEqual(JSON.parse(JSON.stringify(createdRes.toJSON().clientExtensionResults)), {
  credProps: { rk: true },
});

// 5. Verify WebAuthn PRF getClientExtensionResults() hydrates Base64URL into ArrayBuffer while toJSON() stays JSON-safe
const prfSecretBytes = Buffer.alloc(32, 0x5a);
const prfSecretB64u = prfSecretBytes.toString('base64url');
env.sandbox.__onPost = (msg) => {
  if (msg.type === 'PASSKEY_GET_REQUEST') {
    setTimeout(() => {
      env.emitMessage({
        source: 'keysmith-content',
        nonce: msg.nonce,
        handled: true,
        credential: {
          id: 'PRFCRED',
          rawId: 'PRFCRED',
          type: 'public-key',
          authenticatorAttachment: 'platform',
          response: {
            clientDataJSON: Buffer.from('{}').toString('base64url'),
            authenticatorData: Buffer.alloc(37).toString('base64url'),
            signature: Buffer.alloc(64).toString('base64url'),
            userHandle: null,
          },
          clientExtensionResults: {
            prf: {
              results: {
                first: prfSecretB64u,
              },
            },
          },
        },
      });
    }, 2);
  }
};

const prfAssertRes = await env.sandbox.navigator.credentials.get({
  publicKey: {
    challenge: new Uint8Array([7, 7, 7, 7]).buffer,
    rpId: 'paypal.com',
    extensions: { prf: { eval: { first: new Uint8Array([1, 2, 3, 4]) } } },
  },
});
const prfExt = prfAssertRes.getClientExtensionResults();
assert.ok(prfExt.prf?.results?.first instanceof env.sandbox.ArrayBuffer, 'PRF first output must be ArrayBuffer');
assert.equal(prfExt.prf.results.first.byteLength, 32);
assert.equal(prfAssertRes.toJSON().clientExtensionResults.prf.results.first, prfSecretB64u);

// 6. Verify content.js split-fills 6-box segmented OTP inputs (`maxlength="1"`)
const contentCode = fs.readFileSync('apps/browser-extension/content.js', 'utf8');
{
  let runtimeMessageListener = null;
  class FakeHTMLInputElement {
    constructor(idx) {
      this.tagName = 'INPUT';
      this.type = 'text';
      this.maxLength = 1;
      this.size = 1;
      this.value = '';
      this.disabled = false;
      this.readOnly = false;
      this.isConnected = true;
      this.parentElement = null;
      this.form = null;
      this.events = [];
      this._idx = idx;
    }
    getAttribute(attr) {
      if (attr === 'maxlength') return '1';
      if (attr === 'inputmode') return 'numeric';
      return '';
    }
    getBoundingClientRect() {
      return {
        left: 20 + this._idx * 38,
        right: 20 + this._idx * 38 + 32,
        top: 100,
        bottom: 140,
        width: 32,
        height: 40,
      };
    }
    dispatchEvent(ev) {
      this.events.push(ev.type);
      return true;
    }
    addEventListener() {}
  }

  const otpContainer = {
    parentElement: null,
    boxes: Array.from({ length: 6 }, (_, idx) => new FakeHTMLInputElement(idx)),
    querySelectorAll(sel) {
      return sel.includes('input') ? this.boxes : [];
    },
  };
  for (const box of otpContainer.boxes) {
    box.parentElement = otpContainer;
  }

  const contentSandbox = {
    window: null,
    globalThis: null,
    KeysmithI18n: i18nSandbox.KeysmithI18n,
    HTMLInputElement: FakeHTMLInputElement,
    HTMLSelectElement: class {},
    HTMLTextAreaElement: class {},
    Event: class {
      constructor(type) {
        this.type = type;
      }
    },
    KeyboardEvent: class {
      constructor(type, opts) {
        this.type = type;
        this.key = opts?.key;
      }
    },
    MutationObserver: class {
      observe() {}
    },
    WeakMap,
    Set,
    Array,
    URL,
    setTimeout,
    clearTimeout,
    addEventListener: () => {},
    removeEventListener: () => {},
    postMessage: () => {},
    requestAnimationFrame: () => {},
    getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
    innerWidth: 1024,
    innerHeight: 768,
    location: {
      protocol: 'https:',
      href: 'https://github.com/sessions/two-factor',
      origin: 'https://github.com',
      hostname: 'github.com',
    },
    document: {
      readyState: 'complete',
      title: 'Two-Factor',
      documentElement: null,
      body: {},
      addEventListener: () => {},
      querySelectorAll: (sel) => (sel.includes('input') ? otpContainer.boxes : []),
    },
    chrome: {
      runtime: {
        lastError: null,
        sendMessage: (_msg, cb) => cb && cb({ connected: false, status: 'Disconnected', matches: [] }),
        onMessage: {
          addListener: (fn) => {
            runtimeMessageListener = fn;
          },
        },
      },
    },
  };
  contentSandbox.window = contentSandbox;
  contentSandbox.globalThis = contentSandbox;
  vm.runInNewContext(contentCode, contentSandbox);
  assert.ok(runtimeMessageListener, 'Expected content.js runtime.onMessage listener');

  let fillResponse = null;
  runtimeMessageListener(
    { type: 'FILL_CREDENTIALS', username: '', password: '', totp: '482 917' },
    {},
    (resp) => {
      fillResponse = resp;
    },
  );
  assert.deepEqual(JSON.parse(JSON.stringify(fillResponse)), { ok: true, filled: 6 });
  assert.deepEqual(
    otpContainer.boxes.map((b) => b.value),
    ['4', '8', '2', '9', '1', '7'],
  );
}

// 7. Verify content.js detects third-party SSO buttons (click -> RECORD_PENDING_SSO) and one-click SSO autofill on OAuth-only pages
{
  let runtimeMessageListener = null;
  let docClickListener = null;
  const sentMessages = [];

  class FakeSsoButton {
    constructor(text, attrs = {}) {
      this.tagName = 'BUTTON';
      this.textContent = text;
      this.disabled = false;
      this.readOnly = false;
      this.isConnected = true;
      this.clicked = 0;
      this._attrs = attrs;
    }
    getAttribute(attr) {
      return this._attrs[attr] || '';
    }
    querySelectorAll() {
      return [];
    }
    closest() {
      return this;
    }
    getBoundingClientRect() {
      return { left: 40, right: 260, top: 200, bottom: 242, width: 220, height: 42 };
    }
    click() {
      this.clicked += 1;
    }
  }

  const googleBtn = new FakeSsoButton('Continue with Google');
  const githubBtn = new FakeSsoButton('使用 GitHub 登录');
  const shareBtn = new FakeSsoButton('Share to Twitter');

  const ssoSandbox = {
    window: null,
    globalThis: null,
    KeysmithI18n: i18nSandbox.KeysmithI18n,
    HTMLInputElement: class {},
    HTMLSelectElement: class {},
    HTMLTextAreaElement: class {},
    Event: class {
      constructor(type) {
        this.type = type;
      }
    },
    KeyboardEvent: class {},
    MutationObserver: class {
      observe() {}
    },
    WeakMap,
    Set,
    Array,
    URL,
    setTimeout,
    clearTimeout,
    addEventListener: () => {},
    removeEventListener: () => {},
    postMessage: () => {},
    requestAnimationFrame: () => {},
    getComputedStyle: () => ({ display: 'flex', visibility: 'visible', opacity: '1' }),
    innerWidth: 1200,
    innerHeight: 800,
    location: {
      protocol: 'https:',
      href: 'https://vercel.com/login',
      origin: 'https://vercel.com',
      hostname: 'vercel.com',
      pathname: '/login',
      search: '',
      hash: '',
    },
    document: {
      readyState: 'complete',
      title: 'Login - Vercel',
      documentElement: null,
      body: {},
      addEventListener: (ev, fn) => {
        if (ev === 'click') docClickListener = fn;
      },
      querySelector: () => null,
      querySelectorAll: (sel) => {
        if (sel.includes('button')) return [shareBtn, googleBtn, githubBtn];
        return [];
      },
    },
    chrome: {
      runtime: {
        lastError: null,
        sendMessage: (msg, cb) => {
          sentMessages.push(JSON.parse(JSON.stringify(msg)));
          if (cb) cb({ ok: true, connected: false, status: 'Disconnected', matches: [] });
        },
        onMessage: {
          addListener: (fn) => {
            runtimeMessageListener = fn;
          },
        },
      },
    },
  };
  ssoSandbox.window = ssoSandbox;
  ssoSandbox.globalThis = ssoSandbox;
  vm.runInNewContext(contentCode, ssoSandbox);

  assert.ok(docClickListener, 'Expected click capture listener in content.js');
  // Clicking "Share to Twitter" must NOT record SSO
  docClickListener({ target: shareBtn });
  assert.equal(
    sentMessages.some((m) => m.type === 'RECORD_PENDING_SSO'),
    false,
    'Share button must not trigger SSO capture',
  );

  // Clicking "使用 GitHub 登录" MUST record pending GitHub SSO
  docClickListener({ target: githubBtn });
  const recorded = sentMessages.find((m) => m.type === 'RECORD_PENDING_SSO');
  assert.ok(recorded, 'Expected RECORD_PENDING_SSO message');
  assert.equal(recorded.provider, 'GitHub');
  assert.equal(recorded.origin, 'https://vercel.com');
  assert.equal(recorded.loginPath, '/login');

  // Autofilling an SSO item on an OAuth-only page (0 inputs) clicks the matching provider button
  let ssoFillResp = null;
  runtimeMessageListener(
    { type: 'FILL_CREDENTIALS', username: '', password: '', totp: '', ssoProvider: 'Google' },
    {},
    (resp) => {
      ssoFillResp = resp;
    },
  );
  assert.deepEqual(JSON.parse(JSON.stringify(ssoFillResp)), {
    ok: true,
    filled: 1,
    ssoClicked: true,
    ssoProvider: 'Google',
  });
  assert.equal(googleBtn.clicked, 1);
}

// 8. Verify 6-box OTP inline icon is ONLY rendered when the site has a saved item with 2FA (hasTotp)
{
  function makeMockNode(tag) {
    return {
      tagName: String(tag).toUpperCase(),
      className: '',
      title: '',
      type: '',
      textContent: '',
      style: {},
      dataset: {},
      children: [],
      appendChild(child) {
        this.children.push(child);
        return child;
      },
      append(...nodes) {
        this.children.push(...nodes);
      },
      setAttribute() {},
      addEventListener() {},
      attachShadow() {
        const sr = makeMockNode('shadow');
        this.shadowRoot = sr;
        return sr;
      },
    };
  }

  async function runOtpIconScenario(matches) {
    class OtpBoxInput {
      constructor(idx) {
        this.tagName = 'INPUT';
        this.type = 'text';
        this.maxLength = 1;
        this.size = 1;
        this.value = '';
        this.disabled = false;
        this.readOnly = false;
        this.isConnected = true;
        this.parentElement = null;
        this._idx = idx;
      }
      getAttribute(attr) {
        if (attr === 'maxlength') return '1';
        if (attr === 'inputmode') return 'numeric';
        if (attr === 'autocomplete') return 'one-time-code';
        return '';
      }
      getBoundingClientRect() {
        // Even with 52px width (>= 48px), must be treated as segmented OTP group!
        return {
          left: 20 + this._idx * 58,
          right: 20 + this._idx * 58 + 52,
          top: 120,
          bottom: 172,
          width: 52,
          height: 52,
        };
      }
      addEventListener() {}
    }

    const container = {
      parentElement: null,
      boxes: Array.from({ length: 6 }, (_, i) => new OtpBoxInput(i)),
      querySelectorAll(sel) {
        return sel.includes('input') ? this.boxes : [];
      },
    };
    for (const b of container.boxes) b.parentElement = container;

    const docEl = makeMockNode('html');
    let overlayHost = null;
    const rafQueue = [];

    const sb = {
      window: null,
      globalThis: null,
      KeysmithI18n: i18nSandbox.KeysmithI18n,
      HTMLInputElement: OtpBoxInput,
      HTMLSelectElement: class {},
      HTMLTextAreaElement: class {},
      Event: class {},
      KeyboardEvent: class {},
      MutationObserver: class {
        observe() {}
      },
      WeakMap,
      Set,
      Array,
      URL,
      setTimeout,
      clearTimeout,
      addEventListener: () => {},
      removeEventListener: () => {},
      postMessage: () => {},
      requestAnimationFrame: (cb) => {
        rafQueue.push(cb);
      },
      getComputedStyle: () => ({ display: 'block', visibility: 'visible', opacity: '1' }),
      innerWidth: 1024,
      innerHeight: 768,
      location: {
        protocol: 'https:',
        href: 'https://example.com/verify-code',
        origin: 'https://example.com',
        hostname: 'example.com',
        pathname: '/verify-code',
        search: '',
        hash: '',
      },
      document: {
        readyState: 'complete',
        title: 'Verify',
        documentElement: docEl,
        body: makeMockNode('body'),
        createElement: (tag) => makeMockNode(tag),
        createElementNS: (_ns, tag) => makeMockNode(tag),
        getElementById: (id) => (id === 'keysmith-ext-root' ? overlayHost : null),
        addEventListener: () => {},
        querySelector: () => null,
        querySelectorAll: (sel) => (sel.includes('input') ? container.boxes : []),
      },
      chrome: {
        runtime: {
          lastError: null,
          sendMessage: (msg, cb) => {
            if (msg.type === 'GET_PAGE_AUTOFILL_DATA') {
              cb({
                connected: true,
                status: 'Unlocked',
                matches,
                autoCopyTotp: true,
                siteAutofillDisabled: false,
              });
              return;
            }
            if (cb) cb({ ok: true });
          },
          onMessage: { addListener: () => {} },
        },
      },
    };
    docEl.appendChild = (node) => {
      overlayHost = node;
      docEl.children.push(node);
      return node;
    };
    sb.window = sb;
    sb.globalThis = sb;
    vm.runInNewContext(contentCode, sb);
    await new Promise((r) => setTimeout(r, 15));
    while (rafQueue.length > 0) {
      const fn = rafQueue.shift();
      fn();
    }
    const varsRoot = overlayHost?.shadowRoot?.children?.find((c) => c.className === 'ks-vars');
    const iconLayer = varsRoot?.children?.[0];
    return iconLayer ? iconLayer.children.length : 0;
  }

  // Case A: Login saved for site WITHOUT 2FA -> 0 inline icons on 6-box code page
  assert.equal(
    await runOtpIconScenario([{ id: '1', title: 'Example', username: 'u@example.com', hasTotp: false }]),
    0,
    'Must NOT render OTP inline icon when site has no saved 2FA',
  );
  // Case B: No login saved at all -> 0 inline icons on 6-box code page
  assert.equal(await runOtpIconScenario([]), 0);
  // Case C: Login saved WITH 2FA -> renders exactly 1 inline icon next to the 6th box
  assert.equal(
    await runOtpIconScenario([{ id: '1', title: 'Example', username: 'u@example.com', hasTotp: true }]),
    1,
    'Must render exactly 1 OTP inline icon when site has saved 2FA',
  );
}

console.log('Extension test suite passed successfully.');
