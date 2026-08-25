import { HandMathEngine } from './handMath.js';

// DOM Elements
const videoElement = document.getElementById('input_video');
const cameraCanvas = document.getElementById('camera_canvas');
const cameraCtx = cameraCanvas.getContext('2d');
const gameCanvas = document.getElementById('game_canvas');
const gameCtx = gameCanvas.getContext('2d');

const triggerStateEl = document.getElementById('trigger_state');
const scoreDisplayEl = document.getElementById('score_display');
const statusText = document.getElementById('status');

const mathEngine = new HandMathEngine();

// ==========================================
// GAME STATE & TIMER VARIABLES
// ==========================================
let isFiringState = false;
let score = 0;
let flashTimer = 0;
let particles = [];
let juiceStains = [];

const GAME_DURATION = 120; // 2 minutes in seconds
let timeRemaining = GAME_DURATION;
let isGameOver = false;
let gameTimerInterval = null;

// Reticle Smoothing & Anti-Jitter Variables
let smoothedX = 0.5;
let smoothedY = 0.5;
const SMOOTHING_FACTOR = 0.35; // Higher = faster response, Lower = smoother
const JITTER_THRESHOLD = 0.003; // Ignore microscopic camera noise (< 0.3% movement)

// Finger Usage Analytics
const fingerStats = {
  INDEX: 0,
  MIDDLE: 0,
  RING: 0,
  PINKY: 0,
  UNKNOWN: 0
};

// Start the 1-second countdown timer
function startTimer() {
  if (gameTimerInterval) clearInterval(gameTimerInterval);
  timeRemaining = GAME_DURATION;
  isGameOver = false;

  gameTimerInterval = setInterval(() => {
    if (timeRemaining > 0) {
      timeRemaining--;
    } else {
      timeRemaining = 0;
      isGameOver = true;
      clearInterval(gameTimerInterval);
    }
  }, 1000);
}

// Start timer upon initialization
startTimer();

// ==========================================
// 1. 2D PHYSICS ENGINE (Fruits & Bombs)
// ==========================================
let targets = [];
let spawnTimer = 0;

// Helper function to render a pixel block on canvas
function drawPixelBlock(ctx, centerX, centerY, px, py, pSize, color) {
  ctx.fillStyle = color;
  ctx.fillRect(centerX + px * pSize, centerY + py * pSize, pSize, pSize);
}

class PhysicsTarget {
  constructor(canvasWidth, canvasHeight) {
    this.canvasWidth = canvasWidth;
    this.canvasHeight = canvasHeight;

    this.type = Math.random() < 0.20 ? 'BOMB' : ['WATERMELON', 'BANANA', 'APPLE', 'ORANGE'][Math.floor(Math.random() * 4)];
    this.radius = 24; // Hitbox radius

    this.x = 30 + Math.random() * (canvasWidth * 0.3);
    this.y = canvasHeight - 10;

    this.vx = 3.5 + Math.random() * 3.5;
    this.vy = -(12.5 + Math.random() * 4.5);
    this.gravity = 0.38;
  }

  update() {
    this.x += this.vx;
    this.y += this.vy;
    this.vy += this.gravity;
  }

  draw(ctx) {
    ctx.save();
    const p = 3; // Pixel scale size

    switch (this.type) {
      case 'WATERMELON':
        // Green Rind
        [[-3,1],[-2,2],[-1,3],[0,3],[1,3],[2,2],[3,1],[-3,0],[-3,-1],[3,0],[3,-1]].forEach(([px,py]) => drawPixelBlock(ctx, this.x, this.y, px, py, p, '#15803d'));
        // White Rim
        [[-2,1],[-1,2],[0,2],[1,2],[2,1]].forEach(([px,py]) => drawPixelBlock(ctx, this.x, this.y, px, py, p, '#f1f5f9'));
        // Red Flesh
        [[-2,0],[-1,0],[0,0],[1,0],[2,0],[-2,-1],[-1,-1],[0,-1],[1,-1],[2,-1],[-1,-2],[0,-2],[1,-2]].forEach(([px,py]) => drawPixelBlock(ctx, this.x, this.y, px, py, p, '#ef4444'));
        // Seeds
        drawPixelBlock(ctx, this.x, this.y, -1, -1, p, '#0f172a');
        drawPixelBlock(ctx, this.x, this.y, 1, 0, p, '#0f172a');
        break;

      case 'BANANA':
        // Yellow Body
        [[-2,-2],[-1,-1],[0,0],[1,1],[2,1],[2,0],[1,-1],[0,-2]].forEach(([px,py]) => drawPixelBlock(ctx, this.x, this.y, px, py, p, '#facc15'));
        // Brown Tips
        [[-3,-3],[3,2]].forEach(([px,py]) => drawPixelBlock(ctx, this.x, this.y, px, py, p, '#78350f'));
        break;

      case 'APPLE':
        // Red Body
        [[-2,-1],[-1,-2],[0,-2],[1,-2],[2,-1],[-2,0],[-1,0],[0,0],[1,0],[2,0],[-1,1],[0,1],[1,1]].forEach(([px,py]) => drawPixelBlock(ctx, this.x, this.y, px, py, p, '#dc2626'));
        // Stem & Leaf
        drawPixelBlock(ctx, this.x, this.y, 0, -3, p, '#78350f');
        drawPixelBlock(ctx, this.x, this.y, 1, -3, p, '#16a34a');
        break;

      case 'ORANGE':
        // Orange Body
        [[-2,-1],[-1,-2],[0,-2],[1,-2],[2,-1],[-2,0],[-1,0],[0,0],[1,0],[2,0],[-2,1],[-1,1],[0,1],[1,1],[2,1],[-1,2],[0,2],[1,2]].forEach(([px,py]) => drawPixelBlock(ctx, this.x, this.y, px, py, p, '#f97316'));
        // Leaf
        drawPixelBlock(ctx, this.x, this.y, 0, -3, p, '#16a34a');
        break;

      case 'BOMB':
        // Dark Shell
        [[-2,-1],[-1,-2],[0,-2],[1,-2],[2,-1],[-2,0],[-1,0],[0,0],[1,0],[2,0],[-2,1],[-1,1],[0,1],[1,1],[2,1],[-1,2],[0,2],[1,2]].forEach(([px,py]) => drawPixelBlock(ctx, this.x, this.y, px, py, p, '#1e293b'));
        // Fuse & Spark
        drawPixelBlock(ctx, this.x, this.y, 1, -3, p, '#f59e0b');
        drawPixelBlock(ctx, this.x, this.y, 2, -4, p, '#ef4444');
        break;
    }

    ctx.restore();
  }

  checkCollision(aimX, aimY) {
    const dx = this.x - aimX;
    const dy = this.y - aimY;
    return Math.sqrt(dx * dx + dy * dy) < (this.radius + 16);
  }
}



// Call this function when a fruit is hit
function createFruitSplash(x, y, fruitType) {
  const colors = {
    WATERMELON: { juice: '#ef4444', rind: '#22c55e' },
    BANANA:     { juice: '#facc15', rind: '#ca8a04' },
    BOMB:       { juice: '#f97316', rind: '#ef4444' }
  };

  const palette = colors[fruitType] || colors.WATERMELON;

  // 1. Spawn Juice Droplets & Seeds
  for (let i = 0; i < 20; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 3 + Math.random() * 8;
    
    particles.push({
      x: x,
      y: y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      size: Math.random() > 0.5 ? 4 : 6, // Square pixel particles
      color: Math.random() > 0.3 ? palette.juice : palette.rind,
      gravity: 0.25,
      life: 25 + Math.random() * 15
    });
  }

  // 2. Spawn Expanding Juice Splatter Stamp
  juiceStains.push({
    x: x,
    y: y,
    radius: 12,
    maxRadius: 35 + Math.random() * 15,
    color: palette.juice,
    alpha: 0.6
  });
}

// Render and update splashes inside renderGameSpace()

// Particle Explosions
function createExplosion(x, y, color) {
  for (let i = 0; i < 12; i++) {
    particles.push({
      x: x, y: y,
      vx: (Math.random() - 0.5) * 8,
      vy: (Math.random() - 0.5) * 8,
      radius: Math.random() * 4 + 2,
      color: color,
      life: 20
    });
  }
}

function updateAndDrawParticles(ctx) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx;
    p.y += p.vy;
    p.life--;

    ctx.beginPath();
    ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
    ctx.fillStyle = p.color;
    ctx.fill();

    if (p.life <= 0) particles.splice(i, 1);
  }
}

// ==========================================
// 2. MEDIAPIPE TRACKING & MAIN LOOP
// ==========================================
const hands = new Hands({
  locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
});

hands.setOptions({
  maxNumHands: 1,
  modelComplexity: 0,           // 0 = Lightest/fastest model (removes ~10-15ms latency)
  minDetectionConfidence: 0.5,
  minTrackingConfidence: 0.5
});

hands.onResults(onResults);

function onResults(results) {
  if (statusText && statusText.innerText.includes("Initializing")) {
    statusText.innerText = "Status: Tracking Active ⚡";
    statusText.style.color = "#22c55e";
  }

  // 1. RENDER LEFT PANE (Camera Feed & Skeleton)
  cameraCtx.save();
  cameraCtx.clearRect(0, 0, cameraCanvas.width, cameraCanvas.height);
  cameraCtx.drawImage(results.image, 0, 0, cameraCanvas.width, cameraCanvas.height);

  let mirroredX = 0.5;
  let currentY = 0.5;
  let isFiringThisFrame = false;
  let activeFinger = null;

  if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
    const landmarks = results.multiHandLandmarks[0];
    const indexTip = landmarks[8];

    const rawX = indexTip.x;
    const targetMirroredX = 1 - rawX;
    const targetY = indexTip.y;

    // --- ANTI-JITTER & SMOOTHING MATH ---
    const deltaX = Math.abs(targetMirroredX - smoothedX);
    const deltaY = Math.abs(targetY - smoothedY);

    // Only update position if movement exceeds camera noise threshold
    if (deltaX > JITTER_THRESHOLD) {
      smoothedX += (targetMirroredX - smoothedX) * SMOOTHING_FACTOR;
    }
    if (deltaY > JITTER_THRESHOLD) {
      smoothedY += (targetY - smoothedY) * SMOOTHING_FACTOR;
    }

    // Overlay skeleton & left raw pivot marker
    drawConnectors(cameraCtx, landmarks, HAND_CONNECTIONS, { color: '#00FF00', lineWidth: 2 });
    drawLandmarks(cameraCtx, landmarks, { color: '#FF0000', lineWidth: 1, radius: 2 });
    drawLeftPivotCircle(cameraCtx, rawX, targetY, isFiringState);

    // Pinch Trigger Detection
    const triggerData = mathEngine.checkMultiFingerPinch(landmarks);
    activeFinger = triggerData.activeFinger;

    if (!isGameOver && triggerData.isFiring) {
      if (!isFiringState) {
        isFiringState = true;
        isFiringThisFrame = true;
        flashTimer = 5;

        const fingerKey = (activeFinger || 'UNKNOWN').toUpperCase();
        if (fingerStats.hasOwnProperty(fingerKey)) {
          fingerStats[fingerKey]++;
        } else {
          fingerStats.UNKNOWN++;
        }

        if (triggerStateEl) {
          triggerStateEl.innerText = `BANG! (${activeFinger}) 💥`;
          triggerStateEl.style.color = "#ef4444";
        }
      }
    } else {
      isFiringState = false;
      if (triggerStateEl && !isGameOver) {
        triggerStateEl.innerText = "AIMING";
        triggerStateEl.style.color = "#38bdf8";
      }
    }
  }

  cameraCtx.restore();

  // Pass the smoothed, steady coordinates to the right canvas
  renderGameSpace(smoothedX, smoothedY, isFiringThisFrame, activeFinger);
}

function updateAndDrawEffects(ctx) {
  // A. Render Juice Stains in the background
  for (let i = juiceStains.length - 1; i >= 0; i--) {
    const s = juiceStains[i];
    
    if (s.radius < s.maxRadius) {
      s.radius += 2; // Expand stain outwards
    } else {
      s.alpha -= 0.01; // Fade out slowly
    }

    ctx.save();
    ctx.globalAlpha = Math.max(0, s.alpha);
    ctx.fillStyle = s.color;
    
    // Draw splotchy juice ring
    ctx.beginPath();
    ctx.arc(s.x, s.y, s.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    if (s.alpha <= 0) juiceStains.splice(i, 1);
  }

  // B. Render Flying Pixel Particles
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx;
    p.y += p.vy;
    p.vy += p.gravity; // Gravity arc
    p.life--;

    // Render as sharp pixel blocks
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x, p.y, p.size, p.size);

    if (p.life <= 0) particles.splice(i, 1);
  }
}


// -------------------------------------------------------------
// RENDER RIGHT PANE & GAME OVER OVERLAY
// -------------------------------------------------------------
function renderGameSpace(normX, normY, isShotFired, activeFinger) {
  gameCtx.clearRect(0, 0, gameCanvas.width, gameCanvas.height);
  drawBackgroundGrid(gameCtx);
  updateAndDrawEffects(gameCtx) 

  const canvasX = normX * gameCanvas.width;
  const canvasY = normY * gameCanvas.height;

  if (!isGameOver) {
    // --- GAME ACTIVE LOOP ---
    spawnTimer++;
    if (spawnTimer > 50) {
      targets.push(new PhysicsTarget(gameCanvas.width, gameCanvas.height));
      spawnTimer = 0;
    }

    // Target Updates
    for (let i = targets.length - 1; i >= 0; i--) {
      const t = targets[i];
      t.update();
      t.draw(gameCtx);

      // NEW CODE (Replaces createExplosion with createFruitSplash(t.x, t.y, t.type))
      if (isShotFired && t.checkCollision(canvasX, canvasY)) {

        // 1. Pass the position AND target type (t.type) to trigger custom juice colors
        createFruitSplash(t.x, t.y, t.type);
      
        // 2. Score update
        if (t.type === 'BOMB') {
          score = Math.max(0, score - 10);
        } else {
          score += 10;
        }
      
        if (scoreDisplayEl) scoreDisplayEl.innerText = score;

        // 3. Remove target from screen
        targets.splice(i, 1);
        continue;
      }
    }

    updateAndDrawParticles(gameCtx);
    drawReticle(canvasX, canvasY, isFiringState);

    // Render In-Game HUD (Timer)
    drawTimerHUD(gameCtx);

  } else {
    // --- GAME OVER SUMMARY SCREEN ---
    drawGameOverScreen(gameCtx);
  }
}

// Draw Timer HUD in Top Right
function drawTimerHUD(ctx) {
  const mins = Math.floor(timeRemaining / 60);
  const secs = (timeRemaining % 60).toString().padStart(2, '0');
  
  ctx.font = "bold 18px monospace";
  ctx.fillStyle = timeRemaining <= 10 ? "#ef4444" : "#ffffff";
  ctx.textAlign = "right";
  ctx.fillText(`TIME: ${mins}:${secs}`, gameCanvas.width - 20, 30);
}

// Render Game Over Summary Card
function drawGameOverScreen(ctx) {
  // Dark Backdrop Overlay
  ctx.fillStyle = 'rgba(2, 6, 23, 0.90)';
  ctx.fillRect(0, 0, gameCanvas.width, gameCanvas.height);

  // Title
  ctx.textAlign = "center";
  ctx.font = "bold 32px sans-serif";
  ctx.fillStyle = "#ef4444";
  ctx.fillText("🎮 GAME OVER", gameCanvas.width / 2, 70);

  // Final Score Card
  ctx.font = "bold 22px monospace";
  ctx.fillStyle = "#38bdf8";
  ctx.fillText(`FINAL SCORE: ${score}`, gameCanvas.width / 2, 115);

  // Divider Line
  ctx.strokeStyle = "#334155";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(80, 135);
  ctx.lineTo(gameCanvas.width - 80, 135);
  ctx.stroke();

  // Finger Stats Header
  ctx.font = "bold 18px sans-serif";
  ctx.fillStyle = "#f8fafc";
  ctx.fillText("🖐️ FINGER USAGE BREAKDOWN", gameCanvas.width / 2, 170);

  // Stats List
  ctx.font = "16px monospace";
  ctx.textAlign = "left";
  
  const startX = gameCanvas.width / 2 - 110;
  let startY = 210;
  const lineSpacing = 32;

  const displayNames = {
    INDEX: "👉 Index Finger",
    MIDDLE: "🖕 Middle Finger",
    RING: "💍 Ring Finger",
    PINKY: "🤙 Pinky Finger"
  };

  for (const [finger, count] of Object.entries(fingerStats)) {
    if (finger === 'UNKNOWN') continue;

    ctx.fillStyle = "#94a3b8";
    ctx.fillText(`${displayNames[finger] || finger}:`, startX, startY);
    
    ctx.fillStyle = "#22c55e";
    ctx.fillText(`${count} shots`, startX + 180, startY);

    startY += lineSpacing;
  }
}

// -------------------------------------------------------------
// HELPER FUNCTIONS
// -------------------------------------------------------------
function drawLeftPivotCircle(ctx, normX, normY, isFiring) {
  const canvasX = normX * cameraCanvas.width;
  const canvasY = normY * cameraCanvas.height;

  ctx.save();
  ctx.beginPath();
  ctx.arc(canvasX, canvasY, 18, 0, Math.PI * 2);
  ctx.fillStyle = isFiring ? 'rgba(239, 68, 68, 0.4)' : 'rgba(56, 189, 248, 0.3)';
  ctx.fill();

  ctx.beginPath();
  ctx.arc(canvasX, canvasY, 8, 0, Math.PI * 2);
  ctx.fillStyle = isFiring ? '#ef4444' : '#0284c7';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();
  ctx.restore();
}

function drawReticle(x, y, isFiring) {
  gameCtx.beginPath();
  gameCtx.arc(x, y, 14, 0, 2 * Math.PI);
  gameCtx.strokeStyle = isFiring ? '#ef4444' : '#38bdf8';
  gameCtx.lineWidth = 3;
  gameCtx.stroke();

  gameCtx.beginPath();
  gameCtx.arc(x, y, 4, 0, 2 * Math.PI);
  gameCtx.fillStyle = isFiring ? '#ef4444' : '#38bdf8';
  gameCtx.fill();

  gameCtx.strokeStyle = 'rgba(56, 189, 248, 0.15)';
  gameCtx.lineWidth = 1;
  gameCtx.beginPath();
  gameCtx.moveTo(x, 0); gameCtx.lineTo(x, gameCanvas.height);
  gameCtx.moveTo(0, y); gameCtx.lineTo(gameCanvas.width, y);
  gameCtx.stroke();

  if (flashTimer > 0) {
    gameCtx.beginPath();
    gameCtx.arc(x, y, 32, 0, 2 * Math.PI);
    gameCtx.fillStyle = 'rgba(239, 68, 68, 0.35)';
    gameCtx.fill();
    flashTimer--;
  }
}

function drawBackgroundGrid(ctx) {
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
  ctx.lineWidth = 1;
  const gridSize = 40;

  for (let x = 0; x < gameCanvas.width; x += gridSize) {
    ctx.beginPath();
    ctx.moveTo(x, 0); ctx.lineTo(x, gameCanvas.height);
    ctx.stroke();
  }
  for (let y = 0; y < gameCanvas.height; y += gridSize) {
    ctx.beginPath();
    ctx.moveTo(0, y); ctx.lineTo(gameCanvas.width, y);
    ctx.stroke();
  }
}

// Start Camera
const camera = new Camera(videoElement, {
  onFrame: async () => {
    await hands.send({ image: videoElement });
  },
  width: 480,
  height: 360
});

camera.start().catch((err) => {
  if (statusText) {
    statusText.innerText = `Camera Error: ${err.message}`;
    statusText.style.color = "#ef4444";
  }
});