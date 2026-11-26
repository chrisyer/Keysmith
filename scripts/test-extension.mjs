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
console.log('Extension test suite passed successfully.');
