/* Runtime APIs are independent of the JavaScript syntax supported by WebView. */
(() => {
  function provide(target, name, value) {
    if (!(name in target)) Object.defineProperty(target, name, { value, configurable: true, writable: true });
  }
  provide(window, 'globalThis', window);
  provide(Element.prototype, 'toggleAttribute', function (name, force) {
    const enabled = arguments.length > 1 ? Boolean(force) : !this.hasAttribute(name);
    if (enabled) this.setAttribute(name, '');
    else this.removeAttribute(name);
    return enabled;
  });
  if (window.crypto && window.crypto.getRandomValues) provide(window.crypto, 'randomUUID', () => {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 15) | 64;
    bytes[8] = (bytes[8] & 63) | 128;
    const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
    return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-');
  });
  provide(Object, 'hasOwn', (object, key) => Object.prototype.hasOwnProperty.call(object, key));
  provide(Object, 'fromEntries', entries => {
    const result = {};
    for (const [key, value] of entries)
      Object.defineProperty(result, key, { value, enumerable: true, configurable: true, writable: true });
    return result;
  });
  provide(Array.prototype, 'flatMap', function (fn, receiver) {
    const result = [];
    this.forEach((value, index) => {
      const mapped = fn.call(receiver, value, index, this);
      if (Array.isArray(mapped)) mapped.forEach(item => result.push(item));
      else result.push(mapped);
    });
    return result;
  });
  provide(Array.prototype, 'at', function (index) {
    index = Math.trunc(Number(index)) || 0;
    return this[index < 0 ? this.length + index : index];
  });
  provide(String.prototype, 'matchAll', function* (pattern) {
    if (pattern instanceof RegExp && !pattern.global) throw new TypeError('Expected a global regular expression');
    const regex = pattern instanceof RegExp ? new RegExp(pattern.source, pattern.flags) : new RegExp(pattern, 'g');
    regex.lastIndex = pattern instanceof RegExp ? pattern.lastIndex : 0;
    const value = String(this);
    let match;
    while ((match = regex.exec(value))) {
      yield match;
      if (!match[0]) regex.lastIndex += regex.unicode && value.codePointAt(regex.lastIndex) > 0xffff ? 2 : 1;
    }
  });
  provide(String.prototype, 'replaceAll', function (search, replacement) {
    return this.replace(new RegExp(String(search).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), replacement);
  });
  provide(window, 'queueMicrotask', fn => Promise.resolve().then(fn));
  provide(Element.prototype, 'replaceChildren', function (...nodes) {
    while (this.firstChild) this.removeChild(this.firstChild);
    this.append(...nodes);
  });
  provide(Element.prototype, 'getAnimations', () => []);
  provide(Element.prototype, 'checkVisibility', function () {
    return this.getClientRects().length !== 0 && getComputedStyle(this).visibility !== 'hidden';
  });
  if (!window.ResizeObserver) {
    window.ResizeObserver = class {
      constructor(callback) { this.callback = callback; this.nodes = new Set(); this.listener = () => this.flush(); }
      flush() { this.callback(Array.from(this.nodes, target => ({ target, contentRect: target.getBoundingClientRect() }))); }
      observe(target) { this.nodes.add(target); window.addEventListener('resize', this.listener); this.flush(); }
      unobserve(target) { this.nodes.delete(target); if (!this.nodes.size) this.disconnect(); }
      disconnect() { this.nodes.clear(); window.removeEventListener('resize', this.listener); }
    };
  }
  if (!HTMLElement.prototype.showPopover) {
    const matches = Element.prototype.matches;
    Element.prototype.matches = function (selector) {
      return matches.call(this, selector.replace(/:popover-open/g, '[data-legacy-popover-open]'));
    };
    let active;
    HTMLElement.prototype.hidePopover = function () {
      this.removeAttribute('data-legacy-popover-open');
      if (active === this) active = null;
      this.dispatchEvent(new Event('toggle'));
    };
    HTMLElement.prototype.showPopover = function () {
      if (active && active !== this) active.hidePopover();
      active = this;
      this.setAttribute('data-legacy-popover-open', '');
      this.dispatchEvent(new Event('toggle'));
    };
    document.documentElement.setAttribute('data-legacy-popover', '');
    document.addEventListener('pointerdown', event => {
      if (active && !active.contains(event.target) && !active.parentElement.contains(event.target)) active.hidePopover();
    });
    document.addEventListener('keydown', event => { if (event.key === 'Escape' && active) active.hidePopover(); });
  }
})();
