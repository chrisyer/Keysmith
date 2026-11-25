let popoverPolyfillLoaded = false;

export function ensurePopoverPolyfill(): void {
  if (popoverPolyfillLoaded) return;
  if (typeof HTMLElement !== 'undefined' && !Object.hasOwn(HTMLElement.prototype, 'popover')) {
    popoverPolyfillLoaded = true;
    void import('@oddbird/popover-polyfill');
  }
}

let supportsDisplayTransition: boolean | undefined;

export function canTransitionDisplay(): boolean {
  if (supportsDisplayTransition !== undefined) return supportsDisplayTransition;
  if (typeof window === 'undefined' || !window.CSS?.supports?.('transition-behavior', 'allow-discrete') || !document.body) {
    return false;
  }
  const probe = document.createElement('div');
  probe.style.cssText = 'transition: display 1s allow-discrete !important; display: block; position: fixed; pointer-events: none; opacity: 0;';
  document.body.appendChild(probe);
  getComputedStyle(probe).display;
  probe.style.display = 'none';
  supportsDisplayTransition = getComputedStyle(probe).display === 'block';
  probe.remove();
  return supportsDisplayTransition;
}

export function supportsTopLayerExit(): boolean {
  return Boolean(window.CSS?.supports?.('overlay', 'auto')) && canTransitionDisplay();
}

export async function closeTopLayer(element: HTMLDialogElement | null): Promise<void> {
  if (!element || !element.open) return;

  if (!supportsTopLayerExit()) {
    element.setAttribute('data-closing', '');
    const animations = element.getAnimations({ subtree: true });
    if (animations.length > 0) {
      await Promise.race([
        Promise.allSettled(animations.map((a) => a.finished)),
        new Promise<void>((resolve) => setTimeout(resolve, 260)),
      ]);
    }
    if (!element.hasAttribute('data-closing')) return;
    element.removeAttribute('data-closing');
  }

  if (element.open) {
    element.close();
  }
}

export function attachClosedByFallback(dialog: HTMLDialogElement, onRequestClose: () => void): () => void {
  if ('closedBy' in HTMLDialogElement.prototype) {
    return () => {};
  }

  let pressedOutside = false;

  const isOutside = (e: PointerEvent) => {
    const r = dialog.getBoundingClientRect();
    return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
  };

  const onPointerDown = (e: PointerEvent) => {
    pressedOutside = isOutside(e);
  };

  const onPointerUp = (e: PointerEvent) => {
    if (pressedOutside && isOutside(e)) {
      onRequestClose();
    }
    pressedOutside = false;
  };

  dialog.addEventListener('pointerdown', onPointerDown);
  dialog.addEventListener('pointerup', onPointerUp);

  return () => {
    dialog.removeEventListener('pointerdown', onPointerDown);
    dialog.removeEventListener('pointerup', onPointerUp);
  };
}

export function announceAria(message: string): void {
  const doc = document as Document & { ariaNotify?: (msg: string) => void };
  if (typeof doc.ariaNotify === 'function') {
    doc.ariaNotify(message);
    return;
  }
  const live = document.getElementById('ks-live-region');
  if (live) {
    live.textContent = '';
    requestAnimationFrame(() => {
      live.textContent = message;
    });
  }
}
