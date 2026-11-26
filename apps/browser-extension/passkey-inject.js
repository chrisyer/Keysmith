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

  if (!navigator.credentials || typeof navigator.credentials.create !== 'function' || typeof navigator.credentials.get !== 'function') {
    return;
  }

  const nativeCreate = navigator.credentials.create.bind(navigator.credentials);
  const nativeGet = navigator.credentials.get.bind(navigator.credentials);
  const BRIDGE_TIMEOUT_MS = 120000;

  if (typeof PublicKeyCredential !== 'undefined') {
    try {
      PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable = async () => true;
    } catch {
      // Ignore if non-writable
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
    if (input instanceof ArrayBuffer) {
      bytes = new Uint8Array(input);
    } else if (ArrayBuffer.isView(input)) {
      bytes = new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    } else if (typeof input === 'string') {
      return input;
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
    return {
      rp: pk.rp
        ? { id: pk.rp.id || window.location.hostname, name: pk.rp.name || '' }
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
      extensions: pk.extensions || undefined
    };
  }

  function serializeGetOptions(pk, mediation) {
    return {
      challenge: bufferToBase64Url(pk.challenge),
      rpId: pk.rpId || window.location.hostname,
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
      toJSON: () => rawCred
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
      window.postMessage(
        {
          source: 'keysmith-page',
          type,
          nonce,
          origin: window.location.origin,
          options: serializedOptions
        },
        window.location.origin
      );
    });
  }

  navigator.credentials.create = async function keysmithCredentialsCreate(options) {
    if (!options || !options.publicKey) {
      return nativeCreate(options);
    }

    try {
      const reply = await requestBridge(
        'PASSKEY_CREATE_REQUEST',
        serializeCreateOptions(options.publicKey),
        options.signal
      );
      if (reply && reply.aborted) {
        return nativeCreate(options);
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
    return nativeCreate(options);
  };

  navigator.credentials.get = async function keysmithCredentialsGet(options) {
    if (!options || !options.publicKey) {
      return nativeGet(options);
    }

    const mediation = options.mediation || 'optional';
    if (mediation === 'conditional' || mediation === 'silent') {
      return nativeGet(options);
    }

    try {
      const reply = await requestBridge(
        'PASSKEY_GET_REQUEST',
        serializeGetOptions(options.publicKey, mediation),
        options.signal
      );
      if (reply && reply.aborted) {
        return nativeGet(options);
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
    return nativeGet(options);
  };
})();
