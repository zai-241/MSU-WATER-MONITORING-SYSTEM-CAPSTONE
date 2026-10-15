/**
 * @file alertSound.ts
 * @description Web Audio API sound synthesizer for unacknowledged critical and warning alerts.
 * Plays a pulsing audio chime when unacknowledged alerts are active, and silences immediately
 * when acknowledged or resolved across all open dashboard tabs.
 */

class AlertSoundManager {
  private audioCtx: AudioContext | null = null;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private isPlaying = false;

  private getContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return null;

    if (!this.audioCtx) {
      try {
        this.audioCtx = new AudioContextClass();
      } catch {
        return null;
      }
    }

    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume().catch(() => {});
    }

    return this.audioCtx;
  }

  private playTone(frequency: number, duration: number, delay = 0, type: OscillatorType = 'triangle') {
    try {
      const ctx = this.getContext();
      if (!ctx || ctx.state !== 'running') return;

      const startTime = ctx.currentTime + delay;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = type;
      osc.frequency.setValueAtTime(frequency, startTime);

      // Volume envelope to prevent popping sounds
      gain.gain.setValueAtTime(0.001, startTime);
      gain.gain.exponentialRampToValueAtTime(0.12, startTime + 0.05);
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(startTime);
      osc.stop(startTime + duration);
    } catch {
      // Audio autoplay policy or browser restriction handled silently
    }
  }

  private triggerChime() {
    // Two-tone warning chime (880Hz -> 1046Hz)
    this.playTone(880, 0.18, 0, 'triangle');
    this.playTone(1046.5, 0.22, 0.2, 'triangle');
  }

  public startAlert() {
    if (this.isPlaying) return;
    this.isPlaying = true;
    this.triggerChime();

    // Pulse chime every 4 seconds until acknowledged
    this.intervalId = setInterval(() => {
      if (this.isPlaying) {
        this.triggerChime();
      }
    }, 4000);
  }

  public stopAlert() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isPlaying = false;
  }

  public isAlerting(): boolean {
    return this.isPlaying;
  }
}

export const alertSound = new AlertSoundManager();
