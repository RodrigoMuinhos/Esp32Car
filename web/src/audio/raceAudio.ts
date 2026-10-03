/**
 * Synthesized race sounds (Web Audio API, no audio files): a NASCAR-style V8
 * that follows RPM and load, tire squeal under braking, starter/ignition,
 * F1-style start beeps, GO and a checkered-flag fanfare. The countdown is also
 * called by a recorded voice (public/voice, en-US neural voice "Guy").
 */
export type VoiceClip = "3" | "2" | "1" | "go";
const VOICE_CLIPS: VoiceClip[] = ["3", "2", "1", "go"];
const VOICE_LEVEL = 2.2;
type Engine = {
  banks: OscillatorNode[];
  lope: OscillatorNode;
  lopeDepth: GainNode;
  filter: BiquadFilterNode;
  noiseFilter: BiquadFilterNode;
  noiseGain: GainNode;
  /** Rev limiter: the ignition cuts in and out ~14 times a second. */
  cut: GainNode;
  cutDepth: GainNode;
  bounceDepth: GainNode;
  out: GainNode;
};
type Squeal = { filter: BiquadFilterNode; gain: GainNode };

const MASTER_LEVEL = 0.42;
const IDLE_RPM = 950;
const MAX_RPM = 9000;

export class RaceAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private engine: Engine | null = null;
  private squeal: Squeal | null = null;
  private voices = new Map<VoiceClip, { buffer: AudioBuffer; offset: number }>();
  private muted = false;

  /** Creates the audio graph on first use and resumes it if the browser paused it. */
  private context() {
    if (!this.ctx) {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return null;
      this.ctx = new Ctx();
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -18;
      comp.ratio.value = 5;
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : MASTER_LEVEL;
      this.master.connect(comp).connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") void this.ctx.resume().catch(() => {});
    return this.ctx;
  }

  unlock() {
    this.context();
  }

  /** Decodes the countdown voice once; playback skips the clip's leading silence. */
  async loadVoices() {
    const ctx = this.context();
    if (!ctx || this.voices.size) return;
    await Promise.all(
      VOICE_CLIPS.map(async (clip) => {
        try {
          const response = await fetch(`/voice/${clip}.mp3`);
          const buffer = await ctx.decodeAudioData(await response.arrayBuffer());
          const data = buffer.getChannelData(0);
          let first = 0;
          while (first < data.length && Math.abs(data[first]) < 0.01) first++;
          this.voices.set(clip, { buffer, offset: Math.max(0, first / buffer.sampleRate - 0.01) });
        } catch {
          /* without the clip the beeps still mark the countdown */
        }
      }),
    );
  }

  voice(clip: VoiceClip) {
    const ctx = this.context();
    const entry = this.voices.get(clip);
    if (!ctx || !entry) return;
    const source = ctx.createBufferSource();
    source.buffer = entry.buffer;
    const gain = ctx.createGain();
    gain.gain.value = VOICE_LEVEL;
    source.connect(gain).connect(this.master!);
    source.start(ctx.currentTime, entry.offset);
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    if (this.ctx && this.master)
      this.master.gain.setTargetAtTime(muted ? 0 : MASTER_LEVEL, this.ctx.currentTime, 0.05);
  }

  private noiseSource(ctx: AudioContext) {
    if (!this.noise) {
      this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    const source = ctx.createBufferSource();
    source.buffer = this.noise;
    source.loop = true;
    return source;
  }

  // ---------- V8 engine ----------

  /**
   * One oscillator per bank runs at camshaft speed (rpm / 120). Its harmonics put
   * the firing order (8th) on top, with uneven half orders around it: that
   * imbalance is the cross-plane V8 "burble".
   */
  private v8Wave(ctx: AudioContext) {
    const n = 40;
    const real = new Float32Array(n);
    const imag = new Float32Array(n);
    const shape: Record<number, number> = { 1: 0.35, 2: 0.55, 3: 0.3, 4: 0.8, 5: 0.25, 6: 0.45, 7: 0.3, 8: 1, 9: 0.28, 10: 0.4, 12: 0.5, 16: 0.55, 24: 0.25, 32: 0.15 };
    for (let h = 1; h < n; h++) imag[h] = shape[h] ?? 0.06 / Math.sqrt(h);
    return ctx.createPeriodicWave(real, imag);
  }

  private buildEngine(ctx: AudioContext): Engine {
    const out = ctx.createGain();
    out.gain.value = 0;
    out.connect(this.master!);

    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length - 1)) * 2 - 1;
      curve[i] = Math.tanh(3 * x);
    }
    shaper.curve = curve;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.Q.value = 1.2;
    // Everything passes through `cut`, which the limiter LFO chops on and off.
    const cut = ctx.createGain();
    cut.connect(out);
    const limiter = ctx.createOscillator();
    limiter.type = "square";
    limiter.frequency.value = 14;
    const cutDepth = ctx.createGain();
    cutDepth.gain.value = 0;
    limiter.connect(cutDepth).connect(cut.gain);
    shaper.connect(filter).connect(cut);

    const wave = this.v8Wave(ctx);
    const banks = [0, 1].map((bank) => {
      const osc = ctx.createOscillator();
      osc.setPeriodicWave(wave);
      osc.detune.value = bank ? 7 : -7; // two exhausts never quite in phase
      const gain = ctx.createGain();
      gain.gain.value = 0.5;
      osc.connect(gain).connect(shaper);
      return osc;
    });

    // Lumpy cam: a slow wobble of the idle speed that fades out as revs rise.
    const lope = ctx.createOscillator();
    lope.frequency.value = 2.3;
    const lopeDepth = ctx.createGain();
    lope.connect(lopeDepth);
    banks.forEach((osc) => lopeDepth.connect(osc.frequency));

    // Exhaust roar: low band-passed noise that grows with load.
    const noise = this.noiseSource(ctx);
    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = "bandpass";
    noiseFilter.Q.value = 0.7;
    const noiseGain = ctx.createGain();
    noiseGain.gain.value = 0;
    noise.connect(noiseFilter).connect(noiseGain).connect(cut);

    // The revs bounce against the limit in step with the cuts.
    const bounceDepth = ctx.createGain();
    bounceDepth.gain.value = 0;
    limiter.connect(bounceDepth);
    banks.forEach((osc) => bounceDepth.connect(osc.frequency));

    [...banks, lope, noise, limiter].forEach((node) => node.start());
    return { banks, lope, lopeDepth, filter, noiseFilter, noiseGain, cut, cutDepth, bounceDepth, out };
  }

  /** rpm and load in 0..1; on=false fades the engine out. */
  engineUpdate(on: boolean, rpm: number, load: number, limiting = false) {
    if (!on && !this.engine) return;
    const ctx = this.context();
    if (!ctx) return;
    this.engine ??= this.buildEngine(ctx);
    const e = this.engine;
    const t = ctx.currentTime;
    const k = 0.05;
    const cam = (IDLE_RPM + rpm * (MAX_RPM - IDLE_RPM)) / 120;
    e.banks.forEach((osc) => osc.frequency.setTargetAtTime(cam, t, k));
    e.lopeDepth.gain.setTargetAtTime(cam * 0.06 * Math.max(0, 1 - rpm * 3), t, 0.1);
    // Deep and muffled at idle, opening into the high-rpm scream under load.
    e.filter.frequency.setTargetAtTime(180 + rpm * 2200 + load * 900, t, k);
    e.noiseFilter.frequency.setTargetAtTime(160 + rpm * 900, t, k);
    e.noiseGain.gain.setTargetAtTime(on ? 0.02 + load * 0.08 : 0, t, 0.08);
    e.out.gain.setTargetAtTime(on ? 0.16 + load * 0.12 + rpm * 0.05 : 0, t, on ? 0.06 : 0.4);
    // Limiter: gain swings between ~0.1 and 1 ("brap-brap-brap"), revs bounce ±3%.
    const cutting = on && limiting;
    e.cut.gain.setTargetAtTime(cutting ? 0.55 : 1, t, 0.02);
    e.cutDepth.gain.setTargetAtTime(cutting ? 0.45 : 0, t, 0.02);
    e.bounceDepth.gain.setTargetAtTime(cutting ? cam * 0.03 : 0, t, 0.02);
  }

  // ---------- brakes ----------

  /** Tire squeal; level 0..1 (brake pressure times speed). */
  brakeUpdate(level: number) {
    if (level <= 0 && !this.squeal) return;
    const ctx = this.context();
    if (!ctx) return;
    if (!this.squeal) {
      const noise = this.noiseSource(ctx);
      const filter = ctx.createBiquadFilter();
      filter.type = "bandpass";
      filter.Q.value = 14;
      filter.frequency.value = 2700;
      const wobble = ctx.createOscillator();
      wobble.frequency.value = 9;
      const wobbleDepth = ctx.createGain();
      wobbleDepth.gain.value = 180;
      wobble.connect(wobbleDepth).connect(filter.frequency);
      const gain = ctx.createGain();
      gain.gain.value = 0;
      noise.connect(filter).connect(gain).connect(this.master!);
      noise.start();
      wobble.start();
      this.squeal = { filter, gain };
    }
    const t = ctx.currentTime;
    this.squeal.filter.Q.setTargetAtTime(10 + level * 10, t, 0.05);
    this.squeal.gain.gain.setTargetAtTime(level * 1.4, t, level > 0 ? 0.04 : 0.12);
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

  /** Starter motor cranking for `length` seconds (the engine catches afterwards). */
  ignition(length = 1) {
    const ctx = this.context();
    if (!ctx) return;
    const t = ctx.currentTime;
    // Ignition click.
    this.tone(1800, t, 0.03, "square", 0.12);
    // Starter whirr, chugging as each cylinder compresses.
    const whirr = ctx.createOscillator();
    whirr.type = "sawtooth";
    whirr.frequency.setValueAtTime(95, t + 0.05);
    whirr.frequency.linearRampToValueAtTime(140, t + length);
    const chug = ctx.createOscillator();
    chug.type = "square";
    chug.frequency.setValueAtTime(7, t + 0.05);
    chug.frequency.linearRampToValueAtTime(11, t + length);
    const chugDepth = ctx.createGain();
    chugDepth.gain.value = 0.5;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(0.18, t + 0.08);
    gain.gain.setValueAtTime(0.18, t + length - 0.1);
    gain.gain.linearRampToValueAtTime(0, t + length);
    chug.connect(chugDepth).connect(gain.gain);
    const lowpass = ctx.createBiquadFilter();
    lowpass.frequency.value = 900;
    whirr.connect(lowpass).connect(gain).connect(this.master!);
    [whirr, chug].forEach((node) => {
      node.start(t + 0.05);
      node.stop(t + length + 0.05);
    });
  }

  /** One countdown light: 3, 2, 1. */
  countdownBeep() {
    const ctx = this.context();
    if (!ctx) return;
    this.tone(440, ctx.currentTime, 0.22, "square", 0.16);
  }

  go() {
    const ctx = this.context();
    if (!ctx) return;
    const t = ctx.currentTime;
    this.tone(880, t, 0.7, "square", 0.17);
    this.tone(1320, t, 0.7, "sine", 0.09);
  }

  /** Checkered flag: rising arpeggio and a held chord. */
  finish() {
    const ctx = this.context();
    if (!ctx) return;
    const t = ctx.currentTime;
    [523.25, 659.25, 783.99].forEach((f, i) => this.tone(f, t + i * 0.13, 0.16, "triangle", 0.2));
    [1046.5, 783.99, 659.25].forEach((f) => this.tone(f, t + 0.42, 0.9, "triangle", 0.12));
  }

  cancel() {
    const ctx = this.context();
    if (!ctx) return;
    const t = ctx.currentTime;
    this.tone(330, t, 0.14, "square", 0.12);
    this.tone(220, t + 0.15, 0.22, "square", 0.12);
  }
}
