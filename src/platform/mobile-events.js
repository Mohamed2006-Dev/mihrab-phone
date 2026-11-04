/**
 * ناقل أحداث الهاتف (Mobile Event Bus).
 *
 * يتيح إرسال واستقبال الأحداث بين طبقة خدمات الهاتف (المواقيت، الإشعارات، استئناف التطبيق)
 * ومكونات الواجهة (Renderer) المشتركة بصورة موحدة.
 */

class MobileEvents {
  constructor() {
    this.listeners = new Map();
  }

  on(eventName, callback) {
    if (typeof callback !== 'function') return () => {};
    if (!this.listeners.has(eventName)) {
      this.listeners.set(eventName, new Set());
    }
    const handlers = this.listeners.get(eventName);
    handlers.add(callback);

    // Return unbind function
    return () => {
      handlers.delete(callback);
      if (handlers.size === 0) {
        this.listeners.delete(eventName);
      }
    };
  }

  emit(eventName, data) {
    const handlers = this.listeners.get(eventName);
    if (!handlers || handlers.size === 0) return;
    for (const handler of handlers) {
      try {
        handler(data);
      } catch (err) {
        console.error(`[MobileEvents] Error in handler for event "${eventName}":`, err);
      }
    }
  }

  removeAllListeners(eventName) {
    if (eventName) {
      this.listeners.delete(eventName);
    } else {
      this.listeners.clear();
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = MobileEvents;
}
if (typeof window !== 'undefined') {
  window.MobileEvents = MobileEvents;
}
