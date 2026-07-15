const stage = document.getElementById("stage");
const hint = document.getElementById("hint");
const video = document.getElementById("eggvideo");

/*
 * Renderer mode.
 * "video"  — the cracking video plays to a checkpoint on every shock.
 * "photos" — the original still-photo cross-fade.
 * Switch temporarily with ?photos / ?video in the URL, or permanently by
 * changing DEFAULT_MODE.
 */
const DEFAULT_MODE = "video";
const query = new URLSearchParams(location.search);
const MODE = query.has("photos")
  ? "photos"
  : query.has("video")
    ? "video"
    : DEFAULT_MODE;
document.body.classList.add(MODE === "video" ? "mode-video" : "mode-photos");

/* Video timestamps (seconds) where each damage level rests. */
const CHECKPOINTS = [0, 1.5, 3.8, 6.2, 9.9];

const STORAGE_KEY = "egg.level.v1";

const loadLevel = () => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === null) return 0;
    const parsed = parseInt(stored, 10);
    if (Number.isNaN(parsed) || parsed < 0 || parsed > 4) return 0;
    return parsed;
  } catch (_) {
    return 0;
  }
};

const saveLevel = (level) => {
  try {
    localStorage.setItem(STORAGE_KEY, String(level));
  } catch (_) {}
};

const STATE = {
  level: loadLevel(),
  maxLevel: 4,
  motionEnabled: false,
  motionReceived: false,
  permissionAttempts: 0,
  permissionAvailable:
    typeof DeviceMotionEvent !== "undefined" &&
    typeof DeviceMotionEvent.requestPermission === "function",
  cooldownUntil: 0,
};

stage.dataset.level = String(STATE.level);

const THRESHOLDS = [14, 22, 30, 40];
const COOLDOWN_MS = 900;

/* ---------- audio (Web Audio so gain ramps work on iOS too) ---------- */

let audioCtx = null;
let segGain = null;

const unlockAudio = () => {
  if (MODE !== "video") return;
  try {
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) {
        audioCtx = new AC();
        const src = audioCtx.createMediaElementSource(video);
        segGain = audioCtx.createGain();
        segGain.gain.value = 0;
        src.connect(segGain);
        segGain.connect(audioCtx.destination);
      }
    }
    if (audioCtx && audioCtx.state === "suspended") {
      audioCtx.resume();
    }
    video.muted = false;
  } catch (_) {}
};

const setSegGain = (v) => {
  if (segGain) {
    segGain.gain.value = v;
  } else {
    /* fallback for browsers without Web Audio (no-op on iOS) */
    try {
      video.volume = v;
    } catch (_) {}
  }
};

/* ---------- video checkpoint engine ---------- */

const FADE_OUT_S = 0.45;
const FADE_IN_S = 0.12;

let playWatcher = null;

const stopWatcher = () => {
  if (playWatcher !== null) {
    cancelAnimationFrame(playWatcher);
    playWatcher = null;
  }
};

const playToCheckpoint = (level) => {
  const target = CHECKPOINTS[level];
  const start = video.currentTime;
  stopWatcher();
  const watch = () => {
    const t = video.currentTime;
    /* ramp in quickly, fade out into the pause so the stop isn't abrupt */
    setSegGain(
      Math.max(
        0,
        Math.min(1, (t - start) / FADE_IN_S, (target - t) / FADE_OUT_S)
      )
    );
    if (t >= target || video.ended) {
      setSegGain(0);
      video.pause();
      if (!video.ended && t > target + 0.25) {
        video.currentTime = target;
      }
      playWatcher = null;
      return;
    }
    playWatcher = requestAnimationFrame(watch);
  };
  const p = video.play();
  if (p && p.catch) {
    p.catch(() => {
      /* sound blocked: retry muted rather than skipping the animation */
      video.muted = true;
      const retry = video.play();
      if (retry && retry.catch) {
        retry.catch(() => {
          video.currentTime = target;
        });
      }
    });
  }
  playWatcher = requestAnimationFrame(watch);
};

const seekToCheckpoint = (level) => {
  stopWatcher();
  setSegGain(0);
  video.pause();
  const target = CHECKPOINTS[level];
  if (video.readyState >= 1) {
    video.currentTime = target;
  } else {
    video.addEventListener(
      "loadedmetadata",
      () => {
        video.currentTime = target;
      },
      { once: true }
    );
  }
};

/*
 * iOS Safari refuses to paint a video frame until playback has started
 * once. Prime it with a muted play → pause, then land on the current
 * checkpoint. Tried on load (muted autoplay is normally allowed) and
 * retried on the first user gesture if the browser blocked it.
 */
let videoPrimed = false;

const primeVideo = () => {
  if (MODE !== "video" || videoPrimed) return;
  videoPrimed = true;
  const p = video.play();
  if (p && p.then) {
    p.then(() => {
      /* leave it alone if a real segment is already playing */
      if (playWatcher !== null) return;
      video.pause();
      video.currentTime = CHECKPOINTS[STATE.level];
    }).catch(() => {
      videoPrimed = false;
    });
  } else {
    video.pause();
    video.currentTime = CHECKPOINTS[STATE.level];
  }
};

if (MODE === "video") {
  if (STATE.level > 0) seekToCheckpoint(STATE.level);
  if (video.readyState >= 1) {
    primeVideo();
  } else {
    video.addEventListener("loadedmetadata", primeVideo, { once: true });
  }
  video.addEventListener("ended", () => {
    stopWatcher();
  });
}

/* ---------- level state ---------- */

const setLevel = (level, { animateVideo = true } = {}) => {
  const clamped = Math.max(0, Math.min(STATE.maxLevel, level));
  if (clamped === STATE.level) return;
  const goingUp = clamped > STATE.level;
  STATE.level = clamped;
  stage.dataset.level = String(clamped);
  saveLevel(clamped);

  if (MODE === "video") {
    if (goingUp && animateVideo) {
      playToCheckpoint(clamped);
    } else {
      seekToCheckpoint(clamped);
    }
  }

  if (clamped > 0 && clamped < STATE.maxLevel) {
    stage.classList.remove("shake");
    void stage.offsetWidth;
    stage.classList.add("shake");
  }
};

const resetEgg = () => {
  STATE.level = 0;
  stage.dataset.level = "0";
  saveLevel(0);
  if (MODE === "video") seekToCheckpoint(0);
  stage.classList.remove("shake");
  stage.classList.remove("reset");
  void stage.offsetWidth;
  stage.classList.add("reset");
  if (navigator.vibrate) {
    try {
      navigator.vibrate([8, 40, 8]);
    } catch (_) {}
  }
};

/* ---------- motion ---------- */

const handleMotion = (event) => {
  const acc = event.acceleration;
  const accG = event.accelerationIncludingGravity;
  let x = 0,
    y = 0,
    z = 0,
    haveData = false;

  if (acc && (acc.x !== null || acc.y !== null || acc.z !== null)) {
    x = acc.x || 0;
    y = acc.y || 0;
    z = acc.z || 0;
    haveData = true;
  } else if (accG && (accG.x !== null || accG.y !== null || accG.z !== null)) {
    x = accG.x || 0;
    y = accG.y || 0;
    z = (accG.z || 0) - 9.81;
    haveData = true;
  }

  if (!haveData) return;
  STATE.motionReceived = true;

  const now = performance.now();
  if (now < STATE.cooldownUntil) return;

  const magnitude = Math.sqrt(x * x + y * y + z * z);
  const nextThreshold = THRESHOLDS[STATE.level];

  if (STATE.level < STATE.maxLevel && magnitude >= nextThreshold) {
    setLevel(STATE.level + 1);
    STATE.cooldownUntil = now + COOLDOWN_MS;
  }
};

let hintTimer;
const showHint = (text) => {
  clearTimeout(hintTimer);
  hint.firstElementChild.textContent = text;
  hint.classList.remove("fade");
  hint.classList.add("show");
};
const fadeHint = () => {
  clearTimeout(hintTimer);
  hint.classList.remove("show");
  hint.classList.add("fade");
};
const flashHint = (text, duration = 2400) => {
  showHint(text);
  hintTimer = setTimeout(fadeHint, duration);
};

const attachMotionListener = () => {
  window.addEventListener("devicemotion", handleMotion, { passive: true });
  STATE.motionEnabled = true;
  fadeHint();
  setTimeout(() => {
    if (!STATE.motionReceived) {
      flashHint("no motion data — move the device");
    }
  }, 2200);
};

const enableMotion = async () => {
  if (STATE.motionEnabled) return;

  if (!STATE.permissionAvailable) {
    attachMotionListener();
    return;
  }

  STATE.permissionAttempts++;
  let result;
  try {
    result = await DeviceMotionEvent.requestPermission();
  } catch (err) {
    if (STATE.permissionAttempts < 4) {
      flashHint("tap again to allow motion");
    } else {
      flashHint("motion blocked");
    }
    return;
  }

  if (result === "granted") {
    attachMotionListener();
  } else if (result === "denied") {
    flashHint("motion denied — enable in safari settings");
  } else {
    flashHint("tap again to allow motion");
  }
};

if (typeof DeviceMotionEvent !== "undefined" || "ondevicemotion" in window) {
  setTimeout(() => {
    if (!STATE.motionEnabled) showHint("tap to enable motion");
  }, 600);
} else {
  setTimeout(() => showHint("no motion sensor"), 600);
}

/* ---------- hidden 9-tap reset ---------- */

const tapState = {
  times: [],
  pendingReset: false,
  resetTimer: null,
  failed: false,
};

const TAP_WINDOW = 3000;
const TARGET_TAPS = 9;

const handleTap = () => {
  const now = performance.now();
  tapState.times.push(now);
  tapState.times = tapState.times.filter((t) => now - t <= TAP_WINDOW);

  if (tapState.failed) {
    if (tapState.times.length <= 1) {
      tapState.failed = false;
    } else {
      return;
    }
  }

  if (tapState.times.length > TARGET_TAPS) {
    if (tapState.resetTimer !== null) {
      clearTimeout(tapState.resetTimer);
      tapState.resetTimer = null;
    }
    tapState.pendingReset = false;
    tapState.failed = true;
    return;
  }

  if (tapState.times.length === TARGET_TAPS) {
    if (tapState.resetTimer !== null) clearTimeout(tapState.resetTimer);
    tapState.pendingReset = true;
    const firstOfNine = tapState.times[0];
    const remaining = TAP_WINDOW - (now - firstOfNine);
    tapState.resetTimer = setTimeout(() => {
      if (!tapState.pendingReset) return;
      tapState.pendingReset = false;
      tapState.resetTimer = null;
      tapState.times = [];
      resetEgg();
    }, Math.max(remaining, 0) + 20);
  }
};

stage.addEventListener("pointerdown", (e) => {
  if (e.pointerType === "mouse" && e.button !== 0) return;
  primeVideo();
  handleTap();
});

document.addEventListener(
  "click",
  () => {
    unlockAudio();
    if (!STATE.motionEnabled) enableMotion();
  },
  { passive: true }
);

document.addEventListener(
  "touchend",
  () => {
    unlockAudio();
    if (!STATE.motionEnabled) enableMotion();
  },
  { passive: true }
);

document.addEventListener(
  "touchmove",
  (e) => {
    e.preventDefault();
  },
  { passive: false }
);

document.addEventListener("gesturestart", (e) => e.preventDefault());

document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    tapState.times = [];
    tapState.pendingReset = false;
    if (tapState.resetTimer) {
      clearTimeout(tapState.resetTimer);
      tapState.resetTimer = null;
    }
    if (MODE === "video") {
      /* if the tab is hidden mid-segment, land on the checkpoint */
      stopWatcher();
      setSegGain(0);
      video.pause();
      video.currentTime = CHECKPOINTS[STATE.level];
    }
  }
});

/* ---------- debug (desktop / ?debug) ---------- */

if (
  query.has("debug") ||
  location.hostname === "localhost" ||
  location.hostname === "127.0.0.1"
) {
  window.addEventListener("keydown", (e) => {
    if (e.key === " " || e.key === "ArrowUp") {
      setLevel(Math.min(STATE.maxLevel, STATE.level + 1));
    } else if (e.key === "ArrowDown") {
      setLevel(Math.max(0, STATE.level - 1));
    } else if (e.key.toLowerCase() === "r") {
      resetEgg();
    }
  });
}
