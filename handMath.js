// Inside handMath.js

export class HandMathEngine {
  constructor() {
    this.isPinching = false; // Add state flag to track pinches
  }

  getDistance(p1, p2) {
    const dx = p1.x - p2.x;
    const dy = p1.y - p2.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  checkMultiFingerPinch(landmarks) {
    const PINCH_THRESHOLD = 0.22; // Ratio threshold relative to palm size
    const thumbTip = landmarks[4];

    const palmSize = this.getDistance(landmarks[0], landmarks[9]);
    if (palmSize === 0) {
      this.isPinching = false;
      return { isFiring: false, activeFinger: 'None' };
    }

    const fingerIndices = [
      { name: 'Index', idx: 8 },
      { name: 'Middle', idx: 12 },
      { name: 'Ring', idx: 16 },
      { name: 'Pinky', idx: 20 }
    ];

    let detectedFinger = null;
    let minRatio = Infinity;

    // Check closest touching finger
    for (const finger of fingerIndices) {
      const tip = landmarks[finger.idx];
      const rawDist = this.getDistance(thumbTip, tip);
      const ratio = rawDist / palmSize;

      if (ratio < minRatio) {
        minRatio = ratio;
        if (ratio < PINCH_THRESHOLD) {
          detectedFinger = finger.name;
        }
      }
    }

    // --- YOUR FAST RESET LOGIC HERE ---
    if (detectedFinger) {
      if (!this.isPinching) {
        this.isPinching = true; // Lock pinch so it fires ONCE
        return { isFiring: true, activeFinger: detectedFinger };
      }
    } else {
      this.isPinching = false; // Instant reset as soon as fingers separate!
    }

    return { isFiring: false, activeFinger: detectedFinger || 'None' };
  }
}