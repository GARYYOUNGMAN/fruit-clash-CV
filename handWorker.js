// handWorker.js

function getDistance(p1, p2) {
  return Math.hypot(p1.x - p2.x, p1.y - p2.y);
}

let activeFinger = null;
let lastFireTime = 0;
let isPinching = false;
const FIRE_COOLDOWN = 130; // Milliseconds between auto-fire shots
const PINCH_THRESHOLD = 0.18;
const FINGER_NAMES = ['Index', 'Middle', 'Ring', 'Pinky'];
const FINGER_INDICES = [8, 12, 16, 20];

self.onmessage = function (e) {
  const landmarks = e.data.landmarks;

  if (!landmarks || landmarks.length === 0) {
    self.postMessage({ isFiring: false, isHolding: false, activeFinger: 'None' });
    return;
  }

  const thumbTip = landmarks[4];
  const palmSize = getDistance(landmarks[0], landmarks[9]);

  if (palmSize === 0) {
    self.postMessage({ isFiring: false, isHolding: false, activeFinger: 'None' });
    return;
  }

  let detectedFinger = null;
  let minRatio = Infinity;

  for (let i = 0; i < FINGER_INDICES.length; i++) {
    const ratio = getDistance(thumbTip, landmarks[FINGER_INDICES[i]]) / palmSize;
    if (ratio < minRatio) {
      minRatio = ratio;
      if (ratio < PINCH_THRESHOLD) detectedFinger = FINGER_NAMES[i];
    }
  }

  const currentTime = Date.now();

  if (detectedFinger) {
    const isHolding = true;
    let isFiring = false;

    const isNewFinger = detectedFinger !== activeFinger;
    const isCooldownPassed = currentTime - lastFireTime > FIRE_COOLDOWN;

    if (isNewFinger || isCooldownPassed) {
      activeFinger = detectedFinger;
      lastFireTime = currentTime;
      isFiring = true;
    }

    self.postMessage({ isFiring, isHolding, activeFinger: detectedFinger });
  } else {
    activeFinger = null;
    isPinching = false;
    self.postMessage({ isFiring: false, isHolding: false, activeFinger: 'None' });
  }
};