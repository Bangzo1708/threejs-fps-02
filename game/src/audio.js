// Synthesised sound effects — WebAudio only, no audio files, no network. Every sound is
// built from oscillators and a shared noise buffer, so the game stays silent until the
// first user gesture creates the context (browsers require that) and stays cheap after.
export function createSfx() {
  let ctx = null;
  let noiseBuf = null;
  let master = null;

  function ensure() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return true;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);
      const len = ctx.sampleRate * 0.5;
      noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i += 1) data[i] = Math.random() * 2 - 1;
    } catch {
      ctx = null;
      return false;
    }
    return true;
  }

  function noise(dur, filterFreq, gain, type = 'lowpass', when = 0) {
    if (!ensure()) return;
    const t = ctx.currentTime + when;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = filterFreq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filter);
    filter.connect(g);
    g.connect(master);
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  function tone(freq, dur, gain, type = 'square', slideTo = null, when = 0) {
    if (!ensure()) return;
    const t = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo !== null) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g);
    g.connect(master);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  return {
    unlock() {
      ensure();
    },
    shot(kind) {
      // kind: 'rifle' | 'smg' | 'sniper' | 'pistol' | 'enemy'
      if (kind === 'sniper') {
        noise(0.22, 900, 0.5);
        tone(160, 0.16, 0.35, 'sawtooth', 45);
      } else if (kind === 'smg') {
        noise(0.08, 2400, 0.32);
        tone(220, 0.06, 0.16, 'square', 90);
      } else if (kind === 'pistol') {
        noise(0.11, 1800, 0.4);
        tone(190, 0.08, 0.2, 'square', 70);
      } else if (kind === 'enemy') {
        noise(0.13, 1100, 0.22);
        tone(150, 0.09, 0.12, 'sawtooth', 60);
      } else {
        noise(0.14, 1500, 0.45);
        tone(170, 0.1, 0.24, 'sawtooth', 55);
      }
    },
    dry() {
      tone(1400, 0.03, 0.12, 'square');
    },
    reload() {
      tone(900, 0.04, 0.14, 'square');
      tone(600, 0.04, 0.14, 'square', null, 0.18);
      tone(1100, 0.05, 0.16, 'square', null, 0.55);
    },
    hit() {
      tone(2400, 0.05, 0.18, 'sine');
    },
    kill() {
      tone(2400, 0.05, 0.2, 'sine');
      tone(3200, 0.07, 0.2, 'sine', null, 0.06);
    },
    hurt() {
      tone(110, 0.14, 0.3, 'sawtooth', 60);
      noise(0.1, 500, 0.2);
    },
    click() {
      tone(1800, 0.03, 0.12, 'square');
    },
    buy() {
      tone(880, 0.06, 0.16, 'sine');
      tone(1320, 0.09, 0.16, 'sine', null, 0.07);
    },
    denied() {
      tone(220, 0.12, 0.18, 'square', 160);
    },
    plantBeep() {
      tone(1560, 0.09, 0.2, 'sine');
    },
    defuseTick() {
      tone(1200, 0.04, 0.14, 'sine');
    },
    explosion() {
      noise(1.1, 320, 0.9);
      tone(70, 0.9, 0.5, 'sine', 28);
      noise(0.4, 3000, 0.3, 'highpass');
    },
    grenadePin() {
      tone(2000, 0.03, 0.1, 'square');
    },
    roundWin() {
      tone(523, 0.14, 0.2, 'triangle');
      tone(659, 0.14, 0.2, 'triangle', null, 0.13);
      tone(784, 0.26, 0.22, 'triangle', null, 0.26);
    },
    roundLose() {
      tone(392, 0.16, 0.2, 'triangle');
      tone(330, 0.16, 0.2, 'triangle', null, 0.15);
      tone(262, 0.3, 0.22, 'triangle', null, 0.3);
    },
    step() {
      noise(0.05, 700, 0.05);
    },
  };
}
