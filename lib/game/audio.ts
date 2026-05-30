// Chiptune-style audio synthesized with the Web Audio API. No external files to
// download or license - SFX are short oscillator blips and the background music
// is a looping square-wave melody + bass scheduled ahead of the playhead.

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private muted = false;
  private musicTimer: number | null = null;
  private nextNoteTime = 0;
  private step = 0;
  private started = false;
  private gamePaused = false;

  /** Must be called from a user gesture (click) to satisfy autoplay policies. */
  ensure() {
    if (this.ctx) {
      // don't fight the pause state if input arrives while paused
      if (this.ctx.state === "suspended" && !this.gamePaused)
        void this.ctx.resume();
      return;
    }
    const Ctor =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.5;
    this.master.connect(this.ctx.destination);
    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = 0.18;
    this.musicGain.connect(this.master);
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.5;
  }

  /** Pause/resume ALL audio (music + sfx) by suspending the audio clock. */
  setPaused(p: boolean) {
    this.gamePaused = p;
    if (!this.ctx) return;
    if (p) void this.ctx.suspend();
    else void this.ctx.resume();
  }

  isMuted() {
    return this.muted;
  }

  private blip(
    freq: number,
    dur: number,
    type: OscillatorType,
    vol: number,
    slideTo?: number,
  ) {
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(this.master);
    osc.start(t);
    osc.stop(t + dur);
  }

  jump() {
    this.blip(420, 0.16, "square", 0.32, 720);
  }

  coin() {
    this.blip(988, 0.06, "square", 0.28);
    window.setTimeout(() => this.blip(1319, 0.12, "square", 0.28), 60);
  }

  stomp() {
    this.blip(300, 0.12, "square", 0.32, 90);
    this.blip(180, 0.14, "triangle", 0.2, 60);
  }

  hurt() {
    this.blip(330, 0.3, "sawtooth", 0.3, 110);
  }

  gem() {
    this.blip(740, 0.05, "square", 0.26);
    window.setTimeout(() => this.blip(988, 0.05, "square", 0.26), 50);
    window.setTimeout(() => this.blip(1319, 0.16, "square", 0.26), 100);
  }

  power() {
    // bright ascending arpeggio + a sparkly high tail = "power up!"
    const notes = [523, 659, 784, 1047, 1319];
    notes.forEach((f, i) =>
      window.setTimeout(() => this.blip(f, 0.1, "square", 0.3), i * 55),
    );
    window.setTimeout(() => this.blip(1568, 0.22, "square", 0.26, 2093), 300);
  }

  win() {
    const notes = [523, 659, 784, 1047];
    notes.forEach((f, i) =>
      window.setTimeout(() => this.blip(f, 0.2, "square", 0.3), i * 130),
    );
  }

  lose() {
    const notes = [392, 330, 262, 196];
    notes.forEach((f, i) =>
      window.setTimeout(() => this.blip(f, 0.25, "triangle", 0.3, notes[i] * 0.9), i * 160),
    );
  }

  // --- looping background chiptune ---------------------------------------

  private melody = [
    523, 0, 659, 523, 587, 0, 659, 698, 784, 0, 698, 659, 587, 0, 523, 0,
    523, 0, 659, 784, 880, 0, 784, 698, 659, 0, 587, 659, 523, 0, 0, 0,
  ];
  private bass = [
    131, 131, 165, 165, 175, 175, 165, 131, 196, 196, 175, 175, 147, 147, 131, 131,
  ];

  startMusic() {
    this.ensure();
    if (!this.ctx || this.started) return;
    this.started = true;
    this.step = 0;
    this.nextNoteTime = this.ctx.currentTime + 0.1;
    const tick = () => {
      if (!this.ctx || !this.musicGain) return;
      const stepDur = 0.16;
      while (this.nextNoteTime < this.ctx.currentTime + 0.2) {
        const m = this.melody[this.step % this.melody.length];
        if (m > 0) this.scheduleNote(m, this.nextNoteTime, stepDur * 0.9, "square", 0.5);
        if (this.step % 2 === 0) {
          const b = this.bass[(this.step / 2) % this.bass.length];
          this.scheduleNote(b, this.nextNoteTime, stepDur * 1.8, "triangle", 0.7);
        }
        this.nextNoteTime += stepDur;
        this.step++;
      }
      this.musicTimer = window.setTimeout(tick, 60);
    };
    tick();
  }

  private scheduleNote(
    freq: number,
    when: number,
    dur: number,
    type: OscillatorType,
    vol: number,
  ) {
    if (!this.ctx || !this.musicGain) return;
    const osc = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, when);
    g.gain.setValueAtTime(0.0001, when);
    g.gain.linearRampToValueAtTime(vol, when + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    osc.connect(g);
    g.connect(this.musicGain);
    osc.start(when);
    osc.stop(when + dur + 0.02);
  }

  stopMusic() {
    if (this.musicTimer !== null) {
      window.clearTimeout(this.musicTimer);
      this.musicTimer = null;
    }
    this.started = false;
  }
}
