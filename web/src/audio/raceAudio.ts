/**
 * Synthesized race sounds (Web Audio API, no audio files): an engine that follows
 * RPM and load, F1-style start beeps, GO and a checkered-flag fanfare.
 */
type Engine = {
  oscs: OscillatorNode[];
  lfo: OscillatorNode;
  noise: AudioBufferSourceNode;
  whine: OscillatorNode;
  filter: BiquadFilterNode;
  noiseFilter: BiquadFilterNode;
  noiseGain: GainNode;
  whineGain: GainNode;
  out: GainNode;
};

export class RaceAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private engine: Engine | null = null;
  private muted = false;

  /** Creates the audio graph on first use and resumes it if the browser paused it. */
  private context() {
    if (!this.ctx) {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return null;
      this.ctx = new Ctx();
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 4;
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.8;
      this.master.connect(comp).connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") void this.ctx.resume().catch(() => {});
    return this.ctx;
  }

  unlock() {
    this.context();
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    if (this.ctx && this.master)
      this.master.gain.setTargetAtTime(muted ? 0 : 0.8, this.ctx.currentTime, 0.05);
  }

  // ---------- engine ----------

  private buildEngine(ctx: AudioContext): Engine {
    const out = ctx.createGain();
    out.gain.value = 0;
    out.connect(this.master!);

    // Saturation gives the exhaust its grit.
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1;
      curve[i] = Math.tanh(2.6 * x);
    }
    shaper.curve = curve;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.Q.value = 3;
    shaper.connect(filter).connect(out);

    // Firing pulses: the mix is amplitude-modulated at half the base frequency.
    const firing = ctx.createGain();
    firing.gain.value = 0.7;
    firing.connect(shaper);
    const lfo = ctx.createOscillator();
    lfo.type = "square";
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 0.3;
    lfo.connect(lfoDepth).connect(firing.gain);

    const voices: [OscillatorType, number][] = [
      ["sawtooth", 0.5],
      ["square", 0.35],
      ["sawtooth", 0.12],
    ];
    const oscs = voices.map(([type, level]) => {
      const osc = ctx.createOscillator();
      osc.type = type;
      const gain = ctx.createGain();
      gain.gain.value = level;
      osc.connect(gain).connect(firing);
      return osc;
    });

    // Intake/exhaust roar: band-passed noise that grows with load.
    const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    noise.loop = true;
    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = "bandpass";
    noiseFilter.Q.value = 0.9;
    const noiseGain = ctx.createGain();
    noiseGain.gain.value = 0;
    noise.connect(noiseFilter).connect(noiseGain).connect(out);

    // Gearbox / electric motor whine, like an RC car.
    const whine = ctx.createOscillator();
    whine.type = "sine";
    const whineGain = ctx.createGain();
    whineGain.gain.value = 0;
    whine.connect(whineGain).connect(out);

    [...oscs, lfo, noise, whine].forEach((node) => node.start());
    return { oscs, lfo, noise, whine, filter, noiseFilter, noiseGain, whineGain, out };
  }

  /** rpm and load in 0..1; on=false fades the engine out. */
  engineUpdate(on: boolean, rpm: number, load: number) {
    if (!on && !this.engine) return;
    const ctx = this.context();
    if (!ctx) return;
    this.engine ??= this.buildEngine(ctx);
    const e = this.engine;
    const t = ctx.currentTime;
    const base = 34 + rpm * 150; // ~2000 to ~11000 "rpm" for a 4-cylinder feel
    const k = 0.04;
    e.oscs[0].frequency.setTargetAtTime(base, t, k);
    e.oscs[1].frequency.setTargetAtTime(base * 0.5, t, k);
    e.oscs[2].frequency.setTargetAtTime(base * 2.02, t, k);
    e.lfo.frequency.setTargetAtTime(base * 0.5, t, k);
    e.filter.frequency.setTargetAtTime(260 + rpm * 1400 + load * 1600, t, k);
    e.noiseFilter.frequency.setTargetAtTime(500 + rpm * 1800, t, k);
    e.noiseGain.gain.setTargetAtTime(on ? 0.03 + load * 0.16 : 0, t, 0.08);
    e.whine.frequency.setTargetAtTime(380 + rpm * 2200, t, k);
    e.whineGain.gain.setTargetAtTime(on ? 0.012 + rpm * 0.03 : 0, t, 0.08);
    e.out.gain.setTargetAtTime(on ? 0.22 + load * 0.22 + rpm * 0.08 : 0, t, on ? 0.06 : 0.35);
  }

  // ---------- effects ----------

  private tone(freq: number, start: number, length: number, type: OscillatorType, level: number) {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(level, start + 0.01);
    gain.gain.setValueAtTime(level, start + length * 0.7);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
    const lowpass = ctx.createBiquadFilter();
    lowpass.frequency.value = 3200;
    osc.connect(gain).connect(lowpass).connect(this.master!);
    osc.start(start);
    osc.stop(start + length + 0.05);
  }

  /** One countdown light: 3, 2, 1. */
  countdownBeep() {
    const ctx = this.context();
    if (!ctx) return;
    this.tone(440, ctx.currentTime, 0.22, "square", 0.22);
  }

  go() {
    const ctx = this.context();
    if (!ctx) return;
    const t = ctx.currentTime;
    this.tone(880, t, 0.7, "square", 0.24);
    this.tone(1320, t, 0.7, "sine", 0.12);
  }

  /** Checkered flag: rising arpeggio and a held chord. */
  finish() {
    const ctx = this.context();
    if (!ctx) return;
    const t = ctx.currentTime;
    [523.25, 659.25, 783.99].forEach((f, i) => this.tone(f, t + i * 0.13, 0.16, "triangle", 0.26));
    [1046.5, 783.99, 659.25].forEach((f) => this.tone(f, t + 0.42, 0.9, "triangle", 0.16));
  }

  cancel() {
    const ctx = this.context();
    if (!ctx) return;
    const t = ctx.currentTime;
    this.tone(330, t, 0.14, "square", 0.16);
    this.tone(220, t + 0.15, 0.22, "square", 0.16);
  }
}
