// Plays the first N seconds of a preview, stopping as close to N as the
// browser allows (checked every animation frame, ~16ms).

export class ClipPlayer {
  constructor() {
    this.audio = new Audio();
    this.audio.preload = 'auto';
    this.frame = null;
    this.playId = 0;
  }

  load(url) {
    this.stop();
    const audio = this.audio;
    audio.src = url;
    audio.load();
    return new Promise((resolve, reject) => {
      const done = (fn) => (e) => {
        audio.removeEventListener('canplaythrough', ok);
        audio.removeEventListener('error', fail);
        clearTimeout(timer);
        fn(e);
      };
      const ok = done(() => resolve());
      const fail = done(() => reject(new Error('Could not load the song preview')));
      const timer = setTimeout(ok, 6000); // some browsers never fire canplaythrough
      audio.addEventListener('canplaythrough', ok);
      audio.addEventListener('error', fail);
    });
  }

  setVolume(v) {
    this.audio.volume = v;
  }

  // Resolves when playback stops (clip finished or stop() called).
  async play(seconds, onProgress = () => {}) {
    this.stop();
    const id = ++this.playId;
    const audio = this.audio;
    audio.currentTime = 0;
    try {
      await audio.play();
    } catch (err) {
      if (id !== this.playId) return; // stopped before playback began
      throw err;
    }
    if (id !== this.playId) return;
    const startedAt = performance.now();
    return new Promise((resolve) => {
      this.resolveCurrent = resolve;
      const tick = () => {
        // Wall clock guards against coarse currentTime updates on very short clips.
        const elapsed = Math.max(audio.currentTime, (performance.now() - startedAt) / 1000);
        if (elapsed >= seconds || audio.ended) {
          audio.pause();
          onProgress(Math.min(seconds, elapsed));
          this.frame = null;
          this.resolveCurrent = null;
          return resolve();
        }
        onProgress(elapsed);
        this.frame = requestAnimationFrame(tick);
      };
      this.frame = requestAnimationFrame(tick);
    });
  }

  stop() {
    this.playId++;
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = null;
    this.audio.pause();
    this.resolveCurrent?.();
    this.resolveCurrent = null;
  }
}
