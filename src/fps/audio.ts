/**
 * Procedural Web Audio synthesizer for realistic indoor 9mm handgun shots,
 * concrete room reverb reflections, brass shell clinks, and mechanical reload foley.
 */
export class FirearmAudio {
  private ctx: AudioContext | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private reverbBuffer: AudioBuffer | null = null;
  private convolver: ConvolverNode | null = null;
  private masterGain: GainNode | null = null;
  private muted = false;

  private ensureContext(): AudioContext | null {
    if (this.muted) return null;
    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      if (!AudioCtx) return null;
      this.ctx = new AudioCtx();

      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 0.85;
      this.masterGain.connect(this.ctx.destination);

      // Shared white-noise buffer (1.5 seconds)
      const sr = this.ctx.sampleRate;
      this.noiseBuffer = this.ctx.createBuffer(1, Math.floor(sr * 1.5), sr);
      const data = this.noiseBuffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) {
        data[i] = Math.random() * 2 - 1;
      }

      // Synthetic blank concrete room impulse response (~0.65s crisp indoor slapback)
      const irLen = Math.floor(sr * 0.65);
      this.reverbBuffer = this.ctx.createBuffer(2, irLen, sr);
      for (let ch = 0; ch < 2; ch++) {
        const chData = this.reverbBuffer.getChannelData(ch);
        for (let i = 0; i < irLen; i++) {
          const t = i / sr;
          const decay = Math.exp(-t * 6.8);
          // Early slapback wall echoes
          const early =
            (i === Math.floor(sr * 0.018) || i === Math.floor(sr * 0.036))
              ? 0.65
              : 0;
          chData[i] = ((Math.random() * 2 - 1) * decay * 0.42 + early) * (1 - t / 0.7);
        }
      }

      this.convolver = this.ctx.createConvolver();
      this.convolver.buffer = this.reverbBuffer;
      const wetGain = this.ctx.createGain();
      wetGain.gain.value = 0.42;
      this.convolver.connect(wetGain);
      wetGain.connect(this.masterGain);
    }

    if (this.ctx.state === 'suspended') {
      void this.ctx.resume();
    }
    return this.ctx;
  }

  public setMuted(muted: boolean) {
    this.muted = muted;
  }

  public playGunshot(futuristic = false) {
    const ctx = this.ensureContext();
    if (!ctx || !this.noiseBuffer || !this.masterGain || !this.convolver) return;
    const now = ctx.currentTime;

    // 1. High-pressure muzzle crack (bandpass-filtered transient burst)
    const crackSrc = ctx.createBufferSource();
    crackSrc.buffer = this.noiseBuffer;
    const crackFilter = ctx.createBiquadFilter();
    crackFilter.type = 'bandpass';
    crackFilter.frequency.setValueAtTime(
      (futuristic ? 2450 : 1950) + (Math.random() - 0.5) * 260,
      now,
    );
    crackFilter.Q.value = futuristic ? 0.85 : 0.65;

    const crackGain = ctx.createGain();
    crackGain.gain.setValueAtTime(futuristic ? 1.05 : 1.15, now);
    crackGain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);

    crackSrc.connect(crackFilter);
    crackFilter.connect(crackGain);
    crackGain.connect(this.masterGain);
    crackGain.connect(this.convolver);
    crackSrc.start(now);
    crackSrc.stop(now + 0.16);

    // 2. Concussive sub-bass chamber punch
    const thumpOsc = ctx.createOscillator();
    thumpOsc.type = futuristic ? 'sawtooth' : 'triangle';
    thumpOsc.frequency.setValueAtTime(futuristic ? 240 : 175, now);
    thumpOsc.frequency.exponentialRampToValueAtTime(futuristic ? 46 : 38, now + 0.085);

    const thumpGain = ctx.createGain();
    thumpGain.gain.setValueAtTime(futuristic ? 0.68 : 0.95, now);
    thumpGain.gain.exponentialRampToValueAtTime(0.001, now + 0.11);

    thumpOsc.connect(thumpGain);
    thumpGain.connect(this.masterGain);
    thumpOsc.start(now);
    thumpOsc.stop(now + 0.12);

    // Optional futuristic rail/capacitor chirp layer
    if (futuristic) {
      const pulseOsc = ctx.createOscillator();
      pulseOsc.type = 'sine';
      pulseOsc.frequency.setValueAtTime(1480 + Math.random() * 140, now);
      pulseOsc.frequency.exponentialRampToValueAtTime(220, now + 0.075);

      const pulseGain = ctx.createGain();
      pulseGain.gain.setValueAtTime(0.24, now);
      pulseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

      pulseOsc.connect(pulseGain);
      pulseGain.connect(this.masterGain);
      pulseGain.connect(this.convolver);
      pulseOsc.start(now);
      pulseOsc.stop(now + 0.085);
    }

    // 3. Sharp mechanical slide snap (delayed 22ms)
    const slideSrc = ctx.createBufferSource();
    slideSrc.buffer = this.noiseBuffer;
    const slideFilter = ctx.createBiquadFilter();
    slideFilter.type = 'highpass';
    slideFilter.frequency.setValueAtTime(futuristic ? 3600 : 3200, now + 0.022);

    const slideGain = ctx.createGain();
    slideGain.gain.setValueAtTime(0.001, now);
    slideGain.gain.setValueAtTime(0.34, now + 0.022);
    slideGain.gain.exponentialRampToValueAtTime(0.001, now + 0.07);

    slideSrc.connect(slideFilter);
    slideFilter.connect(slideGain);
    slideGain.connect(this.masterGain);
    slideSrc.start(now + 0.02);
    slideSrc.stop(now + 0.08);
  }

  public playDryFire() {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(2400, now);
    osc.frequency.exponentialRampToValueAtTime(680, now + 0.018);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.18, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.022);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.025);
  }

  public playShellBounce(volume = 0.12) {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;
    const now = ctx.currentTime;

    const baseFreq = 5100 + Math.random() * 1400;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(baseFreq, now);
    osc.frequency.exponentialRampToValueAtTime(baseFreq * 0.86, now + 0.045);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.0008, now + 0.05);

    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.055);
  }

  public playReloadStep(
    step: 'magOut' | 'magIn' | 'slideRack',
    futuristic = false,
  ) {
    const ctx = this.ensureContext();
    if (!ctx || !this.noiseBuffer || !this.masterGain) return;
    const now = ctx.currentTime;

    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';

    const gain = ctx.createGain();

    if (step === 'magOut') {
      filter.frequency.setValueAtTime(1400, now);
      filter.frequency.exponentialRampToValueAtTime(750, now + 0.09);
      filter.Q.value = 2.2;
      gain.gain.setValueAtTime(0.24, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.11);
      src.start(now);
      src.stop(now + 0.12);
    } else if (step === 'magIn') {
      filter.frequency.setValueAtTime(980, now);
      filter.frequency.exponentialRampToValueAtTime(2100, now + 0.05);
      filter.Q.value = 1.8;
      gain.gain.setValueAtTime(0.35, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.07);
      src.start(now);
      src.stop(now + 0.08);
    } else {
      // Crisp metallic two-click slide release / rack
      filter.frequency.setValueAtTime(2600, now);
      filter.Q.value = 1.6;
      gain.gain.setValueAtTime(0.32, now);
      gain.gain.exponentialRampToValueAtTime(0.04, now + 0.045);
      gain.gain.setValueAtTime(0.38, now + 0.075);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
      src.start(now);
      src.stop(now + 0.15);
    }

    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);

    // Subtle futuristic power-cell / capacitor chime on VX-9 reload steps
    if (futuristic) {
      const tone = ctx.createOscillator();
      tone.type = 'triangle';
      const tGain = ctx.createGain();
      if (step === 'magOut') {
        tone.frequency.setValueAtTime(620, now);
        tone.frequency.exponentialRampToValueAtTime(290, now + 0.09);
        tGain.gain.setValueAtTime(0.09, now);
        tGain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
      } else if (step === 'magIn') {
        tone.frequency.setValueAtTime(420, now);
        tone.frequency.exponentialRampToValueAtTime(980, now + 0.08);
        tGain.gain.setValueAtTime(0.11, now);
        tGain.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
      } else {
        tone.frequency.setValueAtTime(760, now);
        tone.frequency.exponentialRampToValueAtTime(1320, now + 0.11);
        tGain.gain.setValueAtTime(0.10, now);
        tGain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
      }
      tone.connect(tGain);
      tGain.connect(this.masterGain);
      tone.start(now);
      tone.stop(now + 0.13);
    }
  }

  public playShotgunBlast() {
    const ctx = this.ensureContext();
    if (!ctx || !this.noiseBuffer || !this.masterGain || !this.convolver) return;
    const now = ctx.currentTime;

    // 1. Massive wide-band 12-gauge boom
    const blastSrc = ctx.createBufferSource();
    blastSrc.buffer = this.noiseBuffer;
    const blastFilter = ctx.createBiquadFilter();
    blastFilter.type = 'lowpass';
    blastFilter.frequency.setValueAtTime(2900, now);
    blastFilter.frequency.exponentialRampToValueAtTime(320, now + 0.28);

    const blastGain = ctx.createGain();
    blastGain.gain.setValueAtTime(1.45, now);
    blastGain.gain.exponentialRampToValueAtTime(0.001, now + 0.30);

    blastSrc.connect(blastFilter);
    blastFilter.connect(blastGain);
    blastGain.connect(this.masterGain);
    blastGain.connect(this.convolver);
    blastSrc.start(now);
    blastSrc.stop(now + 0.32);

    // 2. Chest-thumping sub-bass cannon punch
    const subOsc = ctx.createOscillator();
    subOsc.type = 'sawtooth';
    subOsc.frequency.setValueAtTime(138, now);
    subOsc.frequency.exponentialRampToValueAtTime(28, now + 0.19);
    const subGain = ctx.createGain();
    subGain.gain.setValueAtTime(1.05, now);
    subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.21);
    subOsc.connect(subGain);
    subGain.connect(this.masterGain);
    subOsc.start(now);
    subOsc.stop(now + 0.22);

    // 3. Futuristic thermal discharge hiss/pulse overtone
    const pulseOsc = ctx.createOscillator();
    pulseOsc.type = 'sine';
    pulseOsc.frequency.setValueAtTime(1180, now);
    pulseOsc.frequency.exponentialRampToValueAtTime(160, now + 0.14);
    const pulseGain = ctx.createGain();
    pulseGain.gain.setValueAtTime(0.22, now);
    pulseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    pulseOsc.connect(pulseGain);
    pulseGain.connect(this.masterGain);
    pulseGain.connect(this.convolver);
    pulseOsc.start(now);
    pulseOsc.stop(now + 0.16);
  }

  public playShotgunPump() {
    const ctx = this.ensureContext();
    if (!ctx || !this.noiseBuffer || !this.masterGain) return;
    const now = ctx.currentTime;

    // Signature crisp mechanical "CH-CHK" dual pump rack!
    for (const [delay, freq, peak] of [
      [0.0, 1900, 0.36],
      [0.12, 2450, 0.42],
    ]) {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(freq, now + delay);
      filter.Q.value = 1.9;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.setValueAtTime(peak, now + delay);
      gain.gain.exponentialRampToValueAtTime(0.001, now + delay + 0.085);
      src.connect(filter);
      filter.connect(gain);
      gain.connect(this.masterGain);
      src.start(now + delay);
      src.stop(now + delay + 0.095);
    }
  }

  public playShellInsert() {
    const ctx = this.ensureContext();
    if (!ctx || !this.noiseBuffer || !this.masterGain) return;
    const now = ctx.currentTime;

    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1350, now);
    filter.frequency.exponentialRampToValueAtTime(2200, now + 0.055);
    filter.Q.value = 2.4;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.32, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.075);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    src.start(now);
    src.stop(now + 0.085);
  }

  public playSwordDraw() {
    const ctx = this.ensureContext();
    if (!ctx || !this.noiseBuffer || !this.masterGain || !this.convolver) return;
    const now = ctx.currentTime;

    // Metallic katana unsheathe ring + glide
    const ring = ctx.createOscillator();
    ring.type = 'sine';
    ring.frequency.setValueAtTime(2850, now);
    ring.frequency.exponentialRampToValueAtTime(3420, now + 0.24);
    const rGain = ctx.createGain();
    rGain.gain.setValueAtTime(0.08, now);
    rGain.gain.exponentialRampToValueAtTime(0.0008, now + 0.32);
    ring.connect(rGain);
    rGain.connect(this.masterGain);
    rGain.connect(this.convolver);
    ring.start(now);
    ring.stop(now + 0.34);

    const scrape = ctx.createBufferSource();
    scrape.buffer = this.noiseBuffer;
    const sf = ctx.createBiquadFilter();
    sf.type = 'bandpass';
    sf.frequency.setValueAtTime(3600, now);
    sf.Q.value = 3.2;
    const sg = ctx.createGain();
    sg.gain.setValueAtTime(0.14, now);
    sg.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    scrape.connect(sf);
    sf.connect(sg);
    sg.connect(this.masterGain);
    scrape.start(now);
    scrape.stop(now + 0.2);
  }

  public playSwordSwing(comboStep: number) {
    const ctx = this.ensureContext();
    if (!ctx || !this.noiseBuffer || !this.masterGain || !this.convolver) return;
    const now = ctx.currentTime;

    // Layered razor air-slice whoosh (pitch shifts dynamically across combo 1 / 2 / 3)
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    const startFreq = comboStep === 2 ? 780 : comboStep === 1 ? 1150 : 960;
    const peakFreq = comboStep === 2 ? 420 : comboStep === 1 ? 560 : 480;
    filter.frequency.setValueAtTime(startFreq, now);
    filter.frequency.exponentialRampToValueAtTime(peakFreq, now + 0.21);
    filter.Q.value = 1.7;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(comboStep === 2 ? 0.56 : 0.44, now + 0.055);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.24);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    gain.connect(this.convolver);
    src.start(now);
    src.stop(now + 0.26);

    // Subtle steel whistling edge harmonic
    const steel = ctx.createOscillator();
    steel.type = 'sine';
    steel.frequency.setValueAtTime(2150 + comboStep * 280, now + 0.03);
    steel.frequency.exponentialRampToValueAtTime(1240, now + 0.18);
    const sGain = ctx.createGain();
    sGain.gain.setValueAtTime(0.045, now + 0.03);
    sGain.gain.exponentialRampToValueAtTime(0.0008, now + 0.20);
    steel.connect(sGain);
    sGain.connect(this.masterGain);
    steel.start(now + 0.03);
    steel.stop(now + 0.21);
  }

  public playSwordClang() {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain || !this.convolver) return;
    const now = ctx.currentTime;

    for (const freq of [1680, 2940, 4420]) {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq + (Math.random() - 0.5) * 90, now);
      osc.frequency.exponentialRampToValueAtTime(freq * 0.94, now + 0.26);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.11, now);
      gain.gain.exponentialRampToValueAtTime(0.0008, now + 0.28);
      osc.connect(gain);
      gain.connect(this.masterGain);
      gain.connect(this.convolver);
      osc.start(now);
      osc.stop(now + 0.30);
    }
  }

  public playSmgShot(heavy = false) {
    const ctx = this.ensureContext();
    if (!ctx || !this.noiseBuffer || !this.masterGain || !this.convolver) return;
    const now = ctx.currentTime;

    // Snappy open-bolt stamped-steel Soviet SMG report
    const crack = ctx.createBufferSource();
    crack.buffer = this.noiseBuffer;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(heavy ? 1450 : 2150, now);
    bp.frequency.exponentialRampToValueAtTime(heavy ? 480 : 680, now + 0.085);
    bp.Q.value = 0.85;

    const cGain = ctx.createGain();
    cGain.gain.setValueAtTime(heavy ? 1.05 : 0.92, now);
    cGain.gain.exponentialRampToValueAtTime(0.001, now + 0.095);

    crack.connect(bp);
    bp.connect(cGain);
    cGain.connect(this.masterGain);
    cGain.connect(this.convolver);
    crack.start(now);
    crack.stop(now + 0.105);

    // Metallic bolt clack & sub-punch
    const body = ctx.createOscillator();
    body.type = 'triangle';
    body.frequency.setValueAtTime(heavy ? 185 : 230, now);
    body.frequency.exponentialRampToValueAtTime(48, now + 0.075);
    const bGain = ctx.createGain();
    bGain.gain.setValueAtTime(heavy ? 0.72 : 0.56, now);
    bGain.gain.exponentialRampToValueAtTime(0.001, now + 0.085);
    body.connect(bGain);
    bGain.connect(this.masterGain);
    body.start(now);
    body.stop(now + 0.09);

    // Subtle retrofuturist vacuum-tube capacitor hum-tick
    const tube = ctx.createOscillator();
    tube.type = 'sine';
    tube.frequency.setValueAtTime(heavy ? 920 : 1480, now);
    tube.frequency.exponentialRampToValueAtTime(heavy ? 310 : 540, now + 0.055);
    const tGain = ctx.createGain();
    tGain.gain.setValueAtTime(0.085, now);
    tGain.gain.exponentialRampToValueAtTime(0.001, now + 0.065);
    tube.connect(tGain);
    tGain.connect(this.masterGain);
    tube.start(now);
    tube.stop(now + 0.07);
  }

  public playRustShotgunBlast() {
    const ctx = this.ensureContext();
    if (!ctx || !this.noiseBuffer || !this.masterGain || !this.convolver) return;
    const now = ctx.currentTime;

    // Raw brutalist KS-23 industrial cannon boom
    const boom = ctx.createBufferSource();
    boom.buffer = this.noiseBuffer;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(2400, now);
    lp.frequency.exponentialRampToValueAtTime(240, now + 0.34);

    const bGain = ctx.createGain();
    bGain.gain.setValueAtTime(1.55, now);
    bGain.gain.exponentialRampToValueAtTime(0.001, now + 0.36);

    boom.connect(lp);
    lp.connect(bGain);
    bGain.connect(this.masterGain);
    bGain.connect(this.convolver);
    boom.start(now);
    boom.stop(now + 0.38);

    const sub = ctx.createOscillator();
    sub.type = 'sawtooth';
    sub.frequency.setValueAtTime(118, now);
    sub.frequency.exponentialRampToValueAtTime(24, now + 0.24);
    const sGain = ctx.createGain();
    sGain.gain.setValueAtTime(1.18, now);
    sGain.gain.exponentialRampToValueAtTime(0.001, now + 0.26);
    sub.connect(sGain);
    sGain.connect(this.masterGain);
    sub.start(now);
    sub.stop(now + 0.27);

    // Retrofuturist Nixie/vacuum-tube discharge crackle ping
    const ping = ctx.createOscillator();
    ping.type = 'triangle';
    ping.frequency.setValueAtTime(1640, now);
    ping.frequency.exponentialRampToValueAtTime(280, now + 0.16);
    const pGain = ctx.createGain();
    pGain.gain.setValueAtTime(0.16, now);
    pGain.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    ping.connect(pGain);
    pGain.connect(this.masterGain);
    pGain.connect(this.convolver);
    ping.start(now);
    ping.stop(now + 0.19);
  }

  public playFlashlightClick() {
    const ctx = this.ensureContext();
    if (!ctx || !this.noiseBuffer || !this.masterGain) return;
    const now = ctx.currentTime;

    // Crisp dual-stage mechanical rubber tailcap micro-switch click
    for (const [delay, freq, peak] of [
      [0.0, 3200, 0.28],
      [0.026, 4600, 0.34],
    ]) {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(freq, now + delay);
      bp.Q.value = 3.6;

      const g = ctx.createGain();
      g.gain.setValueAtTime(0.001, now);
      g.gain.setValueAtTime(peak, now + delay);
      g.gain.exponentialRampToValueAtTime(0.001, now + delay + 0.022);

      src.connect(bp);
      bp.connect(g);
      g.connect(this.masterGain);
      src.start(now + delay);
      src.stop(now + delay + 0.028);
    }
  }

  public playPickup(isWeapon = false) {
    const ctx = this.ensureContext();
    if (!ctx || !this.noiseBuffer || !this.masterGain) return;
    const now = ctx.currentTime;

    // Tactile leather glove rustle + metal/gear clunk
    const rustle = ctx.createBufferSource();
    rustle.buffer = this.noiseBuffer;
    const lp = ctx.createBiquadFilter();
    lp.type = 'bandpass';
    lp.frequency.setValueAtTime(isWeapon ? 1150 : 1650, now);
    lp.frequency.exponentialRampToValueAtTime(520, now + 0.14);
    lp.Q.value = 1.4;

    const rGain = ctx.createGain();
    rGain.gain.setValueAtTime(0.28, now);
    rGain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    rustle.connect(lp);
    lp.connect(rGain);
    rGain.connect(this.masterGain);
    rustle.start(now);
    rustle.stop(now + 0.16);

    const clunk = ctx.createOscillator();
    clunk.type = 'triangle';
    clunk.frequency.setValueAtTime(isWeapon ? 310 : 480, now + 0.04);
    clunk.frequency.exponentialRampToValueAtTime(isWeapon ? 110 : 190, now + 0.12);
    const cGain = ctx.createGain();
    cGain.gain.setValueAtTime(0.001, now);
    cGain.gain.setValueAtTime(0.22, now + 0.04);
    cGain.gain.exponentialRampToValueAtTime(0.001, now + 0.13);
    clunk.connect(cGain);
    cGain.connect(this.masterGain);
    clunk.start(now + 0.04);
    clunk.stop(now + 0.14);
  }

  public playDrinkCrack() {
    const ctx = this.ensureContext();
    if (!ctx || !this.noiseBuffer || !this.masterGain) return;
    const now = ctx.currentTime;

    // 1. Crisp metallic aluminum pull-tab snap
    const tab = ctx.createOscillator();
    tab.type = 'triangle';
    tab.frequency.setValueAtTime(3400, now);
    tab.frequency.exponentialRampToValueAtTime(1120, now + 0.032);
    const tabGain = ctx.createGain();
    tabGain.gain.setValueAtTime(0.24, now);
    tabGain.gain.exponentialRampToValueAtTime(0.001, now + 0.036);
    tab.connect(tabGain);
    tabGain.connect(this.masterGain);
    tab.start(now);
    tab.stop(now + 0.04);

    // 2. Carbonation "psssht" pressurized fizz burst
    const fizz = ctx.createBufferSource();
    fizz.buffer = this.noiseBuffer;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.setValueAtTime(4200, now + 0.025);
    const fGain = ctx.createGain();
    fGain.gain.setValueAtTime(0.001, now);
    fGain.gain.linearRampToValueAtTime(0.26, now + 0.055);
    fGain.gain.exponentialRampToValueAtTime(0.001, now + 0.34);
    fizz.connect(hp);
    hp.connect(fGain);
    fGain.connect(this.masterGain);
    fizz.start(now + 0.02);
    fizz.stop(now + 0.36);
  }

  public playDrinkGulp() {
    const ctx = this.ensureContext();
    if (!ctx || !this.noiseBuffer || !this.masterGain) return;
    const now = ctx.currentTime;

    // Two deep energized gulps right as the can curls up behind the camera
    for (const [offset, startF] of [
      [0.0, 235],
      [0.21, 215],
    ]) {
      const gulp = ctx.createOscillator();
      gulp.type = 'sine';
      gulp.frequency.setValueAtTime(startF, now + offset);
      gulp.frequency.exponentialRampToValueAtTime(98, now + offset + 0.13);
      const gGain = ctx.createGain();
      gGain.gain.setValueAtTime(0.001, now);
      gGain.gain.setValueAtTime(0.20, now + offset);
      gGain.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.14);
      gulp.connect(gGain);
      gGain.connect(this.masterGain);
      gulp.start(now + offset);
      gulp.stop(now + offset + 0.15);
    }

    // Subtle refreshing exhale after chugging
    const exhale = ctx.createBufferSource();
    exhale.buffer = this.noiseBuffer;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(920, now + 0.36);
    bp.Q.value = 1.2;
    const eGain = ctx.createGain();
    eGain.gain.setValueAtTime(0.001, now);
    eGain.gain.linearRampToValueAtTime(0.11, now + 0.42);
    eGain.gain.exponentialRampToValueAtTime(0.001, now + 0.56);
    exhale.connect(bp);
    bp.connect(eGain);
    eGain.connect(this.masterGain);
    exhale.start(now + 0.35);
    exhale.stop(now + 0.58);
  }

  public playCanToss() {
    const ctx = this.ensureContext();
    if (!ctx || !this.noiseBuffer || !this.masterGain) return;
    const now = ctx.currentTime;

    // Carefree wrist-flick air whoosh
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(620, now);
    bp.frequency.exponentialRampToValueAtTime(1450, now + 0.08);
    bp.frequency.exponentialRampToValueAtTime(420, now + 0.18);
    bp.Q.value = 1.6;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.24, now + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.19);

    src.connect(bp);
    bp.connect(gain);
    gain.connect(this.masterGain);
    src.start(now);
    src.stop(now + 0.21);
  }

  public playCanBounce(intensity = 0.7) {
    const ctx = this.ensureContext();
    if (!ctx || !this.noiseBuffer || !this.masterGain) return;
    const now = ctx.currentTime;
    const amp = Math.min(1, Math.max(0.08, intensity));

    // Hollow empty aluminum can dual metallic ring + crisp concrete clatter!
    const freqs = [1680 + Math.random() * 260, 2940 + Math.random() * 420];
    for (let i = 0; i < freqs.length; i++) {
      const osc = ctx.createOscillator();
      osc.type = i === 0 ? 'triangle' : 'sine';
      osc.frequency.setValueAtTime(freqs[i], now);
      osc.frequency.exponentialRampToValueAtTime(freqs[i] * 0.88, now + 0.09);

      const g = ctx.createGain();
      g.gain.setValueAtTime(amp * (i === 0 ? 0.19 : 0.12), now);
      g.gain.exponentialRampToValueAtTime(0.0008, now + (i === 0 ? 0.11 : 0.075));

      osc.connect(g);
      g.connect(this.masterGain);
      if (this.convolver) g.connect(this.convolver);
      osc.start(now);
      osc.stop(now + 0.12);
    }

    const clat = ctx.createBufferSource();
    clat.buffer = this.noiseBuffer;
    const hp = ctx.createBiquadFilter();
    hp.type = 'bandpass';
    hp.frequency.setValueAtTime(3400, now);
    hp.Q.value = 2.6;
    const cg = ctx.createGain();
    cg.gain.setValueAtTime(amp * 0.22, now);
    cg.gain.exponentialRampToValueAtTime(0.001, now + 0.055);
    clat.connect(hp);
    hp.connect(cg);
    cg.connect(this.masterGain);
    clat.start(now);
    clat.stop(now + 0.065);
  }

  public dispose() {
    if (this.ctx) {
      void this.ctx.close();
      this.ctx = null;
    }
  }
}
