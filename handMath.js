export class HandMathEngine {
  constructor() {
    this.isPinching = false;
    this.lastFireTime = 0;
    this.FIRE_COOLDOWN = 200; // Milliseconds between "Rapid Fire" shots
  }

  getDistance(p1, p2) {
    return Math.hypot(p1.x - p2.x, p1.y - p2.y);
  }

  checkMultiFingerPinch(landmarks) {
    const PINCH_THRESHOLD = 0.20; 
    const thumbTip = landmarks[4];
    const palmSize = this.getDistance(landmarks[0], landmarks[9]);

    if (palmSize === 0) return { isFiring: false, activeFinger: 'None' };

    const fingerIndices = [
      { name: 'Index', idx: 8 },
      { name: 'Middle', idx: 12 },
      { name: 'Ring', idx: 16 },
      { name: 'Pinky', idx: 20 }
    ];

    let detectedFinger = null;
    let minRatio = Infinity;

    for (const finger of fingerIndices) {
      const ratio = this.getDistance(thumbTip, landmarks[finger.idx]) / palmSize;
      if (ratio < minRatio) {
        minRatio = ratio;
        if (ratio < PINCH_THRESHOLD) detectedFinger = finger.name;
      }
    }

    const currentTime = Date.now();
    
    if (detectedFinger) {
      // Logic: Fire if it's a NEW pinch OR if holding down and cooldown passed
      if (!this.isPinching || (currentTime - this.lastFireTime > this.FIRE_COOLDOWN)) {
        this.isPinching = true;
        this.lastFireTime = currentTime;
        return { isFiring: true, activeFinger: detectedFinger };
      }
    } else {
      this.isPinching = false;
    }

    return { isFiring: false, activeFinger: detectedFinger || 'None' };
  }
}