let audioCtx = null;
let currentAudio = null;

function ensureAudioContext() {
  if (!audioCtx) {
    // WebAudio for generated tones
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === "suspended") {
    // try resume (autoplay-policy is set in main)
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

function beepTone({ freq = 880, durationMs = 120, gain = 0.08 }) {
  const ctx = ensureAudioContext();
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = "sine";
  o.frequency.value = freq;
  g.gain.value = gain;
  o.connect(g);
  g.connect(ctx.destination);
  o.start();
  o.stop(ctx.currentTime + durationMs / 1000);
}

async function playSequence(steps) {
  for (const s of steps) {
    if (s.type === "tone") {
      beepTone(s);
    }
    await new Promise((r) => setTimeout(r, s.waitMs || 0));
  }
}

function toFileUrl(p) {
  const path = String(p || "").trim();
  if (!path) return "";
  if (path.startsWith("file://")) return path;
  // Windows path -> file:///C:/...
  const normalized = path.replace(/\\/g, "/");
  return `file:///${encodeURI(normalized)}`;
}

async function playCustomFile(path) {
  const url = toFileUrl(path);
  if (!url) return;
  if (currentAudio) {
    try {
      currentAudio.pause();
    } catch {
      // ignore
    }
    currentAudio = null;
  }
  const a = new Audio(url);
  a.volume = 1.0;
  currentAudio = a;
  try {
    await a.play();
  } catch {
    // ignore (file missing / blocked)
  }
}

async function playSound(payload) {
  const type = String(payload?.type || "");
  if (type === "chime") {
    await playSequence([
      { type: "tone", freq: 880, durationMs: 110, gain: 0.08, waitMs: 0 },
      { type: "tone", freq: 660, durationMs: 140, gain: 0.08, waitMs: 150 }
    ]);
    return;
  }
  if (type === "alert") {
    await playSequence([
      { type: "tone", freq: 660, durationMs: 120, gain: 0.09, waitMs: 0 },
      { type: "tone", freq: 660, durationMs: 120, gain: 0.09, waitMs: 180 },
      { type: "tone", freq: 660, durationMs: 120, gain: 0.09, waitMs: 180 }
    ]);
    return;
  }
  if (type === "custom") {
    await playCustomFile(payload?.customPath || "");
  }
}

window.soundApi?.onPlay((payload) => {
  playSound(payload);
});

