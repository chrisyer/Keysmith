(() => {
  if (window.__KEYSMITH_PASSKEY_INJECTED__) {
    return;
  }
  window.__KEYSMITH_PASSKEY_INJECTED__ = true;

  try {
    document.dispatchEvent(new CustomEvent('keysmith:passkey-ready'));
  } catch {
    // Ignore if document is not ready for CustomEvent
  }

  const credsObj = navigator.credentials;
  const proto =
    typeof CredentialsContainer !== 'undefined' && CredentialsContainer.prototype
      ? CredentialsContainer.prototype
      : null;

  const nativeCreate =
    (proto && typeof proto.create === 'function' ? proto.create : null) ||
    (credsObj && typeof credsObj.create === 'function' ? credsObj.create : null);
  const nativeGet =
    (proto && typeof proto.get === 'function' ? proto.get : null) ||
    (credsObj && typeof credsObj.get === 'function' ? credsObj.get : null);

  if (typeof nativeCreate !== 'function' || typeof nativeGet !== 'function') {
    return;
  }

  const BRIDGE_TIMEOUT_MS = 120000;
  const HOOKED_FLAG = '__keysmithWrappedWebAuthn';

  function callNativeCreate(ctx, options) {
    return nativeCreate.call(ctx || navigator.credentials, options);
  }

  function callNativeGet(ctx, options) {
    return nativeGet.call(ctx || navigator.credentials, options);
  }

  function postTargetOrigin() {
    const orig = window.location.origin;
    return orig && orig !== 'null' ? orig : '*';
  }

  function detectCrossOrigin() {
    if (window === window.top) {
      return false;
    }
    try {
      return window.top.location.origin !== window.location.origin;
    } catch {
      return true;
    }
  }

  if (typeof PublicKeyCredential !== 'undefined') {
    try {
      PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable = async () => true;
    } catch {
      // Ignore if non-writable
    }
    try {
      PublicKeyCredential.isConditionalMediationAvailable = async () => true;
    } catch {
      // Ignore if non-writable
    }
    if (typeof PublicKeyCredential.getClientCapabilities === 'function') {
      const nativeGetCaps = PublicKeyCredential.getClientCapabilities.bind(PublicKeyCredential);
      try {
        PublicKeyCredential.getClientCapabilities = async () => {
          let base = {};
          try {
            base = (await nativeGetCaps()) || {};
          } catch {
            base = {};
          }
          return {
            ...base,
            conditionalGet: true,
            userVerifyingPlatformAuthenticator: true,
            passkeyPlatformAuthenticator: true,
            hybridTransport: true
          };
        };
      } catch {
        // Ignore if non-writable
      }
    }
  }

  function randomNonce() {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }

  function bufferToBase64Url(input) {
    if (!input) return null;
    let bytes;
    const tag = Object.prototype.toString.call(input);
    if (input instanceof ArrayBuffer || tag === '[object ArrayBuffer]') {
      bytes = new Uint8Array(input);
    } else if (ArrayBuffer.isView(input)) {
      bytes = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    } else if (typeof input === 'string') {
      return input.trim().replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    } else {
      return null;
    }
    let binary = '';
    for (let i = 0; i < bytes.length; i += 1) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function base64UrlToArrayBuffer(str) {
    if (!str || typeof str !== 'string') return null;
    try {
      const padLen = (4 - (str.length % 4)) % 4;
      const base64 = str.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(padLen);
      const binary = atob(base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) {
        bytes[i] = binary.charCodeAt(i);
      }
      return bytes.buffer;
    } catch {
      return null;
    }
  }

  function serializeDescriptorList(list) {
    if (!Array.isArray(list)) return [];
    return list
      .filter((item) => item && item.id)
      .map((item) => ({
        type: item.type || 'public-key',
        id: bufferToBase64Url(item.id),
        transports: Array.isArray(item.transports) ? item.transports : undefined
      }));
  }

  function serializeCreateOptions(pk) {
    const rawRpId = pk.rp?.id && String(pk.rp.id).trim() ? String(pk.rp.id).trim() : '';
    return {
      rp: pk.rp
        ? { id: rawRpId || window.location.hostname, name: pk.rp.name || '' }
        : { id: window.location.hostname, name: '' },
      user: pk.user
        ? {
            id: bufferToBase64Url(pk.user.id),
            name: pk.user.name || '',
            displayName: pk.user.displayName || pk.user.name || ''
          }
        : null,
      challenge: bufferToBase64Url(pk.challenge),
      pubKeyCredParams: Array.isArray(pk.pubKeyCredParams) ? pk.pubKeyCredParams : [],
      timeout: pk.timeout,
      excludeCredentials: serializeDescriptorList(pk.excludeCredentials),
      authenticatorSelection: pk.authenticatorSelection || undefined,
      attestation: pk.attestation || 'none',
      crossOrigin: detectCrossOrigin(),
      extensions: pk.extensions || undefined
    };
  }

  function serializeGetOptions(pk, mediation) {
    const rawRpId = pk.rpId && String(pk.rpId).trim() ? String(pk.rpId).trim() : '';
    return {
      challenge: bufferToBase64Url(pk.challenge),
      rpId: rawRpId || window.location.hostname,
      rpIdExplicit: Boolean(rawRpId),
      crossOrigin: detectCrossOrigin(),
      timeout: pk.timeout,
      allowCredentials: serializeDescriptorList(pk.allowCredentials),
      userVerification: pk.userVerification || 'preferred',
      mediation: mediation || 'optional',
      extensions: pk.extensions || undefined
    };
  }

  function buildCredentialObject(rawCred, isCreate) {
    const rawIdBuf = base64UrlToArrayBuffer(rawCred.rawId || rawCred.id);
    const clientDataBuf = base64UrlToArrayBuffer(rawCred.response?.clientDataJSON);
    if (!rawIdBuf || !clientDataBuf) {
      return null;
    }
    const extResults = rawCred.clientExtensionResults || {};

    let responseObj;
    if (isCreate) {
      const attestationBuf = base64UrlToArrayBuffer(rawCred.response?.attestationObject);
      if (!attestationBuf) {
        return null;
      }
      const authDataBuf = base64UrlToArrayBuffer(rawCred.response?.authenticatorData);
      const pubKeyBuf = base64UrlToArrayBuffer(rawCred.response?.publicKey);
      const transports = Array.isArray(rawCred.response?.transports)
        ? rawCred.response.transports
        : ['internal', 'hybrid'];
      const pubKeyAlg =
        typeof rawCred.response?.publicKeyAlgorithm === 'number'
          ? rawCred.response.publicKeyAlgorithm
          : -7;

      responseObj = {
        clientDataJSON: clientDataBuf,
        attestationObject: attestationBuf,
        getTransports: () => transports.slice(),
        getAuthenticatorData: () => authDataBuf,
        getPublicKey: () => pubKeyBuf,
        getPublicKeyAlgorithm: () => pubKeyAlg
      };
      if (typeof AuthenticatorAttestationResponse !== 'undefined') {
        try {
          Object.setPrototypeOf(responseObj, AuthenticatorAttestationResponse.prototype);
        } catch {
          // Prototype reassignment may be restricted in some environments
        }
      }
    } else {
      const authDataBuf = base64UrlToArrayBuffer(rawCred.response?.authenticatorData);
      const sigBuf = base64UrlToArrayBuffer(rawCred.response?.signature);
      if (!authDataBuf || !sigBuf) {
        return null;
      }
      const rawUserHandle = rawCred.response?.userHandle;
      const userHandleBuf =
        typeof rawUserHandle === 'string' && rawUserHandle.length > 0
          ? base64UrlToArrayBuffer(rawUserHandle)
          : null;

      responseObj = {
        clientDataJSON: clientDataBuf,
        authenticatorData: authDataBuf,
        signature: sigBuf,
        userHandle: userHandleBuf
      };
      if (typeof AuthenticatorAssertionResponse !== 'undefined') {
        try {
          Object.setPrototypeOf(responseObj, AuthenticatorAssertionResponse.prototype);
        } catch {
          // Prototype reassignment may be restricted in some environments
        }
      }
    }

    const cred = {
      id: rawCred.id,
      rawId: rawIdBuf,
      type: rawCred.type || 'public-key',
      authenticatorAttachment: rawCred.authenticatorAttachment || 'platform',
      response: responseObj,
      getClientExtensionResults: () => extResults,
      toJSON: () => JSON.parse(JSON.stringify(rawCred))
    };

    if (typeof PublicKeyCredential !== 'undefined') {
      try {
        Object.setPrototypeOf(cred, PublicKeyCredential.prototype);
      } catch {
        // Ignore if strict prototype check blocks setPrototypeOf
      }
    }
    return cred;
  }

  function postToContent(payload) {
    window.postMessage(
      {
        source: 'keysmith-page',
        ...payload
      },
      postTargetOrigin()
    );
  }

  function requestBridge(type, serializedOptions, signal) {
    if (signal?.aborted) {
      return Promise.resolve({ handled: false, fallback: true, aborted: true });
    }
    const nonce = randomNonce();
    return new Promise((resolve) => {
      let settled = false;
      function cleanup() {
        clearTimeout(timer);
        window.removeEventListener('message', onMessage);
        if (signal) {
          signal.removeEventListener('abort', onAbort);
        }
      }

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          cleanup();
          resolve({ handled: false, fallback: true });
        }
      }, BRIDGE_TIMEOUT_MS);

      function onAbort() {
        if (!settled) {
          settled = true;
          cleanup();
          resolve({ handled: false, fallback: true, aborted: true });
        }
      }

      function onMessage(event) {
        if (event.source !== window) return;
        const data = event.data;
        if (!data || data.source !== 'keysmith-content' || data.nonce !== nonce) {
          return;
        }
        settled = true;
        cleanup();
        resolve(data);
      }

      if (signal) {
        signal.addEventListener('abort', onAbort, { once: true });
      }
      window.addEventListener('message', onMessage);
      postToContent({
        type,
        nonce,
        origin: window.location.origin,
        options: serializedOptions
      });
    });
  }

  function handleConditionalGet(ctx, options) {
    const signal = options.signal;
    if (signal?.aborted) {
      return Promise.reject(
        signal.reason || new DOMException('The operation was aborted.', 'AbortError')
      );
    }

    const nonce = randomNonce();
    const serialized = serializeGetOptions(options.publicKey, 'conditional');

    return new Promise((resolve, reject) => {
      let settled = false;
      let keysmithAvailable = null;
      let nativeSettledError = null;

      function cleanup() {
        window.removeEventListener('message', onMessage);
        if (signal) {
          signal.removeEventListener('abort', onAbort);
        }
      }

      function onAbort() {
        if (settled) return;
        settled = true;
        cleanup();
        postToContent({
          type: 'PASSKEY_CONDITIONAL_CANCEL',
          nonce,
          origin: window.location.origin
        });
        reject(signal?.reason || new DOMException('The operation was aborted.', 'AbortError'));
      }

      function onMessage(event) {
        if (settled || event.source !== window) return;
        const data = event.data;
        if (!data || data.source !== 'keysmith-content' || data.nonce !== nonce) {
          return;
        }
        if (data.type === 'PASSKEY_CONDITIONAL_STATUS') {
          keysmithAvailable = Boolean(data.available);
          if (!keysmithAvailable && nativeSettledError !== null && !settled) {
            settled = true;
            cleanup();
            reject(nativeSettledError);
          }
          return;
        }
        if (data.type === 'PASSKEY_CONDITIONAL_RESOLVE') {
          if (data.handled && data.credential) {
            const cred = buildCredentialObject(data.credential, false);
            if (cred) {
              settled = true;
              cleanup();
              resolve(cred);
            }
          } else if (data.errorName) {
            settled = true;
            cleanup();
            reject(
              new DOMException(
                data.error || 'The operation either timed out or was not allowed.',
                data.errorName
              )
            );
          }
        }
      }

      if (signal) {
        signal.addEventListener('abort', onAbort, { once: true });
      }
      window.addEventListener('message', onMessage);
      postToContent({
        type: 'PASSKEY_CONDITIONAL_START',
        nonce,
        origin: window.location.origin,
        options: serialized
      });

      Promise.resolve()
        .then(() => callNativeGet(ctx, options))
        .then(
          (cred) => {
            if (settled) return;
            settled = true;
            cleanup();
            postToContent({
              type: 'PASSKEY_CONDITIONAL_CANCEL',
              nonce,
              origin: window.location.origin
            });
            resolve(cred);
          },
          (err) => {
            if (settled) return;
            nativeSettledError = err;
            if (signal?.aborted) {
              onAbort();
              return;
            }
            if (keysmithAvailable === false) {
              settled = true;
              cleanup();
              reject(err);
            }
          }
        );
    });
  }

  async function keysmithCredentialsCreate(options) {
    if (!options || !options.publicKey) {
      return callNativeCreate(this, options);
    }

    try {
      const reply = await requestBridge(
        'PASSKEY_CREATE_REQUEST',
        serializeCreateOptions(options.publicKey),
        options.signal
      );
      if (reply && reply.aborted) {
        return callNativeCreate(this, options);
      }
      if (reply && reply.handled && reply.credential) {
        const cred = buildCredentialObject(reply.credential, true);
        if (cred) {
          return cred;
        }
      }
      if (reply && reply.errorName) {
        throw new DOMException(
          reply.error || 'The operation either timed out or was not allowed.',
          reply.errorName
        );
      }
      if (reply && reply.cancelled) {
        throw new DOMException(
          'The operation either timed out or was not allowed.',
          'NotAllowedError'
        );
      }
    } catch (err) {
      if (err instanceof DOMException) {
        throw err;
      }
    }
    return callNativeCreate(this, options);
  }
  keysmithCredentialsCreate[HOOKED_FLAG] = true;

  async function keysmithCredentialsGet(options) {
    if (!options || !options.publicKey) {
      return callNativeGet(this, options);
    }

    const mediation = options.mediation || 'optional';
    if (mediation === 'silent') {
      return callNativeGet(this, options);
    }
    if (mediation === 'conditional') {
      return handleConditionalGet(this, options);
    }

    try {
      const reply = await requestBridge(
        'PASSKEY_GET_REQUEST',
        serializeGetOptions(options.publicKey, mediation),
        options.signal
      );
      if (reply && reply.aborted) {
        return callNativeGet(this, options);
      }
      if (reply && reply.handled && reply.credential) {
        const cred = buildCredentialObject(reply.credential, false);
        if (cred) {
          return cred;
        }
      }
      if (reply && reply.errorName) {
        throw new DOMException(
          reply.error || 'The operation either timed out or was not allowed.',
          reply.errorName
        );
      }
      if (reply && reply.cancelled) {
        throw new DOMException(
          'The operation either timed out or was not allowed.',
          'NotAllowedError'
        );
      }
    } catch (err) {
      if (err instanceof DOMException) {
        throw err;
      }
    }
    return callNativeGet(this, options);
  }
  keysmithCredentialsGet[HOOKED_FLAG] = true;

  function installMethod(target, prop, fn) {
    if (!target) return false;
    try {
      if (target[prop] && target[prop][HOOKED_FLAG]) {
        return true;
      }
    } catch {
      // Ignore read failures
    }
    try {
      const desc = Object.getOwnPropertyDescriptor(target, prop);
      if (!desc || desc.writable) {
        target[prop] = fn;
        if (target[prop] === fn) return true;
      }
      if (!desc || desc.configurable) {
        Object.defineProperty(target, prop, {
          value: fn,
          configurable: true,
          writable: true
        });
        return true;
      }
    } catch {
      // Ignore if non-configurable
    }
    return false;
  }

  if (proto) {
    installMethod(proto, 'create', keysmithCredentialsCreate);
    installMethod(proto, 'get', keysmithCredentialsGet);
  }
  if (credsObj) {
    if (Object.prototype.hasOwnProperty.call(credsObj, 'create') || credsObj.create !== keysmithCredentialsCreate) {
      installMethod(credsObj, 'create', keysmithCredentialsCreate);
    }
    if (Object.prototype.hasOwnProperty.call(credsObj, 'get') || credsObj.get !== keysmithCredentialsGet) {
      installMethod(credsObj, 'get', keysmithCredentialsGet);
    }
  }
})();
