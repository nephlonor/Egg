const stage = document.getElementById("stage");
const hint = document.getElementById("hint");

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
const COOLDOWN_MS = 700;

const setLevel = (level) => {
  const clamped = Math.max(0, Math.min(STATE.maxLevel, level));
  if (clamped === STATE.level) return;
  STATE.level = clamped;
  stage.dataset.level = String(clamped);
  saveLevel(clamped);
  if (clamped > 0 && clamped < STATE.maxLevel) {
    stage.classList.remove("shake");
    void stage.offsetWidth;
    stage.classList.add("shake");
  }
  if (navigator.vibrate) {
    const patterns = [[], [12], [22], [40], [60, 30, 80]];
    try {
      navigator.vibrate(patterns[clamped] || 0);
    } catch (_) {}
  }
};

const resetEgg = () => {
  STATE.level = 0;
  stage.dataset.level = "0";
  saveLevel(0);
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
  handleTap();
});

document.addEventListener(
  "click",
  () => {
    if (!STATE.motionEnabled) enableMotion();
  },
  { passive: true }
);

document.addEventListener(
  "touchend",
  () => {
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
  }
});

if (
  new URLSearchParams(location.search).has("debug") ||
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
