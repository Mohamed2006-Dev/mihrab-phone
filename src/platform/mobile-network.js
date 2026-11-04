/**
 * سياسة الشبكة للهاتف المحمول (Mobile Network Policy).
 *
 * التحقق من إذن الاتصال بالإنترنت العام ولكل فئة (مواقيت، أحاديث، يوتيوب، موقع، أخرى)
 * قبل إرسال أي طلب شبكي.
 */

const CATEGORIES = ['youtube', 'hadith', 'prayer', 'location', 'other'];

function policy(config = {}) {
  const n = config.network || {};
  return {
    enabled: n.enabled !== false,
    showChart: n.showChart !== false,
    categories: Object.fromEntries(
      CATEGORIES.map((k) => [k, n.categories?.[k] !== false])
    ),
  };
}

function allowed(config, category) {
  const p = policy(config);
  return p.enabled && p.categories[category] !== false;
}

function categoryFor(url) {
  try {
    const h = new URL(url).hostname.toLowerCase();
    if (
      /(^|\.)(youtube\.com|youtu\.be|ytimg\.com|googlevideo\.com|youtube-nocookie\.com|ggpht\.com)$/.test(
        h
      )
    ) {
      return 'youtube';
    }
    if (h === 'hadeethenc.com' || h.endsWith('.hadeethenc.com')) return 'hadith';
    if (h === 'habous.gov.ma' || h.endsWith('.habous.gov.ma') || h === 'api.aladhan.com') {
      return 'prayer';
    }
    if (['ipwho.is', 'ip-api.com', 'freeipapi.com', 'ipapi.co'].includes(h)) return 'location';
    return 'other';
  } catch {
    return 'other';
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    CATEGORIES,
    policy,
    allowed,
    categoryFor,
  };
}
if (typeof window !== 'undefined') {
  window.MihrabNetwork = { CATEGORIES, policy, allowed, categoryFor };
}
