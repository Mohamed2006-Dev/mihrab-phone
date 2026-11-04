/**
 * مشغل صوتيات الهاتف (Mobile Audio Manager).
 *
 * مسؤول عن تشغيل صوت الأذان والتكبيرات داخل الواجهة، وإدارة دورة حياة الصوت
 * والتحكم في الصوتيات وتجاوز قيود التشغيل التلقائي على الهواتف.
 */

class MobileAudio {
  constructor(options = {}) {
    this.audioElements = new Map();
    this.currentTrack = null;
    this.unlocked = false;
    this.volume = options.volume ?? 1.0;
    this.audioPaths = {
      adhan: options.adhanPath || 'assets/audio/adhan.flac',
      takbeer: options.takbeerPath || 'assets/audio/ALLAHO_AKBAR_audio.flac',
    };

    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      this._setupUnlockListener();
    }
  }

  _setupUnlockListener() {
    const unlock = () => {
      this.unlocked = true;
      // Pre-warm audio context / elements if needed
      window.removeEventListener('click', unlock);
      window.removeEventListener('touchstart', unlock);
    };
    window.addEventListener('click', unlock, { once: true });
    window.addEventListener('touchstart', unlock, { once: true });
  }

  getAudioElement(kind = 'adhan') {
    if (typeof Audio === 'undefined') return null;
    if (!this.audioElements.has(kind)) {
      const src = this.audioPaths[kind] || this.audioPaths.adhan;
      const audio = new Audio(src);
      audio.preload = 'auto';
      audio.volume = this.volume;
      this.audioElements.set(kind, audio);
    }
    return this.audioElements.get(kind);
  }

  async play(kind = 'adhan') {
    const audio = this.getAudioElement(kind);
    if (!audio) return { played: false, error: 'Audio not supported' };

    try {
      this.stopAll();
      audio.currentTime = 0;
      this.currentTrack = audio;
      await audio.play();
      return { played: true, kind };
    } catch (err) {
      console.warn(`[MobileAudio] Playback failed for ${kind}:`, err.message);
      return { played: false, error: err.message };
    }
  }

  stopAll() {
    for (const audio of this.audioElements.values()) {
      try {
        audio.pause();
        audio.currentTime = 0;
      } catch (_) {}
    }
    this.currentTrack = null;
  }

  pause() {
    if (this.currentTrack) {
      try {
        this.currentTrack.pause();
      } catch (_) {}
    }
  }

  setVolume(vol) {
    this.volume = Math.max(0, Math.min(1, Number(vol) || 1));
    for (const audio of this.audioElements.values()) {
      audio.volume = this.volume;
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = MobileAudio;
}
if (typeof window !== 'undefined') {
  window.MobileAudio = MobileAudio;
}
