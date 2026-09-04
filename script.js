// DOM Elements
const videoElement = document.getElementById('input_video');
const cameraCanvas = document.getElementById('camera_canvas');
const cameraCtx = cameraCanvas.getContext('2d');
const gameCanvas = document.getElementById('game_canvas');
const gameCtx = gameCanvas.getContext('2d');
const gridCanvas = document.createElement('canvas');
const GRID_SIZE = 40;
gridCanvas.width = gameCanvas.width;
gridCanvas.height = gameCanvas.height;
const gridCtx = gridCanvas.getContext('2d');
gridCtx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
gridCtx.lineWidth = 1;
for (let gridX = 0; gridX < gridCanvas.width; gridX += GRID_SIZE) {
  gridCtx.beginPath();
  gridCtx.moveTo(gridX, 0);
  gridCtx.lineTo(gridX, gridCanvas.height);
  gridCtx.stroke();
}
for (let gridY = 0; gridY < gridCanvas.height; gridY += GRID_SIZE) {
  gridCtx.beginPath();
  gridCtx.moveTo(0, gridY);
  gridCtx.lineTo(gridCanvas.width, gridY);
  gridCtx.stroke();
}

const triggerStateEl = document.getElementById('trigger_state');
const scoreDisplayEl = document.getElementById('score_display');
const timeDisplayEl = document.getElementById('time_display');
const statusText = document.getElementById('status');
const gameOverActionsEl = document.getElementById('game_over_actions');
const replayButton = document.getElementById('replay_button');
const menuButton = document.getElementById('menu_button');
const closeButton = document.querySelector('.close-button');
const missionBadgeEl = document.querySelector('.mission-badge');
const missionTextEl = document.querySelector('.mission-text');

const handWorker = new Worker('handWorker.js');

const fruitImages = {
  POMEGRANATE: new Image(),
  BANANA: new Image(),
  APPLE: new Image(),
  ORANGE: new Image(),
  BOMB: new Image(),
  DURIAN: new Image()
};

fruitImages.POMEGRANATE.src = 'assets/pomegranate.png';
fruitImages.BANANA.src = 'assets/banana.png';
fruitImages.APPLE.src = 'assets/apple.png';
fruitImages.ORANGE.src = 'assets/orange.png';
fruitImages.BOMB.src = 'assets/bomb.png';
fruitImages.DURIAN.src = 'assets/durian.png';

const fruitTypes = ['POMEGRANATE', 'BANANA', 'APPLE', 'ORANGE', 'BOMB'];
const playableFruitTypes = ['POMEGRANATE', 'BANANA', 'APPLE', 'ORANGE'];
const splashPalettes = {
  POMEGRANATE: { juice: '#ef4444', rind: '#22c55e' },
  BANANA: { juice: '#facc15', rind: '#ca8a04' },
  BOMB: { juice: '#f97316', rind: '#ef4444' }
};
fruitTypes.forEach(type => {
  const img = new Image();
  img.src = `assets/${type.toLowerCase()}.png`;
  fruitImages[type] = img;
});

const workerTriggerState = {
  isFiring: false,
  isHolding: false,
  activeFinger: 'None',
};
const inputState = {
  image: null,
  cameraX: 0.5,
  normX: 0.5,
  normY: 0.5,
  isShotFired: false,
  isHolding: false,
  activeFinger: 'None'
};

// Listen for calculation results from the Web Worker thread
handWorker.onmessage = function (e) {
  workerTriggerState.isFiring = e.data.isFiring;
  workerTriggerState.isHolding = e.data.isHolding;
  workerTriggerState.activeFinger = e.data.activeFinger;
};

// ==========================================
// GAME STATE & TIMER VARIABLES
// ==========================================
let isFiringState = false;
let score = 0;
let flashTimer = 0;
const MAX_TARGETS = 32;
const MAX_PARTICLES = 360;
const MAX_STAINS = 32;
const targets = [];
const targetPool = [];
const particles = [];
const particlePool = [];
const juiceStains = [];
const stainPool = [];
let targetCount = 0;
let particleCount = 0;
let stainCount = 0;

let lastInferenceTime = 0;
const INFERENCE_INTERVAL = 1000 / 30; // ~33ms

const GAME_DURATION = 120; // 2 minutes in seconds
let timeRemaining = GAME_DURATION;
let isGameOver = false;
let gameTimerInterval = null;
let finalMatchActive = false;
let finalMatchResult = null;
let bossHealth = 100;
let playerHealth = 100;
let bossSpawnTimer = 0;
let bossPulse = 0;
const bossHazards = [];
const bossSmoke = [];
const BOSS_MAX_HEALTH = 100;
const PLAYER_MAX_HEALTH = 100;
const FINAL_MATCH_SCORE = 2000;

function updateTimerDisplay() {
  const minutes = Math.floor(timeRemaining / 60);
  const seconds = (timeRemaining % 60).toString().padStart(2, '0');
  const formatted = `${minutes.toString().padStart(2, '0')}:${seconds}`;

  if (timeDisplayEl) {
    timeDisplayEl.textContent = formatted;
  }
}

// Reticle Smoothing & Anti-Jitter Variables
let smoothedX = 0.5;
let smoothedY = 0.5;
const SMOOTHING_FACTOR = 0.42; // Higher = faster response, Lower = smoother
const JITTER_THRESHOLD = 0.0025; // Ignore microscopic camera noise (< 0.25% movement)

// ==========================================
// AUDIO MANAGER (Web Audio API for Low Latency & Overlap)
// ==========================================
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

// Sound Buffers
let sndSingleShot = null;
let sndMultiShot = null;
let sndSplash = null;

// Loop State
let multiShotSource = null;
let isLoopingMulti = false;

let shotHoldCounter = 0; // Tracks hold time in frames (~60fps)
const AUTO_FIRE_THRESHOLD = 12; // Frames before switching from single tap to auto-fire (~0.2 seconds)

// Load audio files asynchronously
async function loadSound(url) {
  const response = await fetch(url);
  const arrayBuffer = await response.arrayBuffer();
  return await audioCtx.decodeAudioData(arrayBuffer);
}

// Load sound files
Promise.all([
  loadSound('oneshot_AK47.mp3').then(buf => sndSingleShot = buf),
  loadSound('ak47_multipleshot.mp3').then(buf => sndMultiShot = buf),
  loadSound('fruit_splash_CV.mp3').then(buf => sndSplash = buf)
]).catch(err => console.error("Audio loading error:", err));
// Successful target analytics for the current round
const targetStats = {
  POMEGRANATE: 0,
  BANANA: 0,
  APPLE: 0,
  ORANGE: 0,
  BOMB: 0
};


// Resume AudioContext on user interaction (browsers block autoplay)
function ensureAudioContext() {
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
}

// Play overlapping sounds (Parallel Playback)
function playParallelSound(buffer) {
  if (!buffer) return;
  ensureAudioContext();
  const source = audioCtx.createBufferSource();
  source.buffer = buffer;
  source.connect(audioCtx.destination);
  source.start(0);
}

// Start continuous automatic loop
function startMultiShotLoop() {
  if (isLoopingMulti || !sndMultiShot) return;
  ensureAudioContext();
  
  multiShotSource = audioCtx.createBufferSource();
  multiShotSource.buffer = sndMultiShot;
  multiShotSource.loop = true; // Auto-repeat while pinch is held
  multiShotSource.connect(audioCtx.destination);
  multiShotSource.start(0);
  isLoopingMulti = true;
}

// Stop continuous automatic loop
function stopMultiShotLoop() {
  if (!isLoopingMulti || !multiShotSource) return;
  try {
    multiShotSource.stop(0);
    multiShotSource.disconnect();
  } catch (e) {}
  multiShotSource = null;
  isLoopingMulti = false;
}

// Start the 1-second countdown timer
function resetGameState() {
  for (let i = 0; i < targetCount; i++) {
    targetPool[targetPool.length] = targets[i];
  }
  targetCount = 0;
  particleCount = 0;
  stainCount = 0;
  spawnTimer = 0;
  score = 0;
  flashTimer = 0;
  shotHoldCounter = 0;
  isFiringState = false;
  isGameOver = false;
  finalMatchActive = false;
  finalMatchResult = null;
  bossHealth = BOSS_MAX_HEALTH;
  playerHealth = PLAYER_MAX_HEALTH;
  bossSpawnTimer = 0;
  bossPulse = 0;
  bossHazards.length = 0;
  bossSmoke.length = 0;
  Object.keys(targetStats).forEach(type => targetStats[type] = 0);
  if (scoreDisplayEl) scoreDisplayEl.textContent = String(score);
  if (gameOverActionsEl) gameOverActionsEl.classList.add('hidden');
  if (triggerStateEl) {
    triggerStateEl.innerText = 'AIMING';
    triggerStateEl.style.color = '#38bdf8';
  }
  if (missionBadgeEl) missionBadgeEl.textContent = 'READY';
  if (missionTextEl) missionTextEl.textContent = 'Use your hand to slice the targets';
  stopMultiShotLoop();
}

function enterFinalMatch() {
  if (finalMatchActive || isGameOver) return;

  finalMatchActive = true;
  bossHealth = BOSS_MAX_HEALTH;
  playerHealth = PLAYER_MAX_HEALTH;
  bossSpawnTimer = 0;
  bossPulse = 0;
  bossHazards.length = 0;
  bossSmoke.length = 0;
  for (let i = 0; i < targetCount; i++) targetPool.push(targets[i]);
  targetCount = 0;
  if (gameTimerInterval) clearInterval(gameTimerInterval);
  stopMultiShotLoop();
  if (missionBadgeEl) missionBadgeEl.textContent = 'FINAL MATCH';
  if (missionTextEl) missionTextEl.textContent = 'Defeat the Durian Boss';
  if (timeDisplayEl) timeDisplayEl.textContent = 'BOSS';
  if (triggerStateEl) {
    triggerStateEl.textContent = 'BOSS BATTLE';
    triggerStateEl.style.color = '#facc15';
  }
}

function startTimer() {
  if (gameTimerInterval) clearInterval(gameTimerInterval);
  timeRemaining = GAME_DURATION;
  isGameOver = false;
  updateTimerDisplay();

  gameTimerInterval = setInterval(() => {
    if (!isGameOver && timeRemaining > 0) {
      timeRemaining--;
      updateTimerDisplay();
    }

    if (timeRemaining <= 0) {
      timeRemaining = 0;
      isGameOver = true;
      updateTimerDisplay();
      clearInterval(gameTimerInterval);
      if (gameOverActionsEl) gameOverActionsEl.classList.remove('hidden');
    }
  }, 1000);
}

if (replayButton) {
  replayButton.addEventListener('click', () => {
    resetGameState();
    startTimer();
  });
}

if (menuButton) {
  menuButton.addEventListener('click', () => {
    window.location.href = 'index.html';
  });
}

if (closeButton) {
  closeButton.addEventListener('click', () => {
    window.location.href = 'index.html';
  });
}

// ==========================================
// 1. 2D PHYSICS ENGINE (Fruits & Bombs)
// ==========================================
let spawnTimer = 0;

function getRandomTargetType() {
  const elapsedRatio = (GAME_DURATION - timeRemaining) / GAME_DURATION;
  const bombChance = 0.2 + elapsedRatio * 0.2;

  return Math.random() < bombChance
    ? 'BOMB'
    : playableFruitTypes[Math.floor(Math.random() * playableFruitTypes.length)];
}

// Start timer upon initialization
resetGameState();
startTimer();

// Helper function to render a pixel block on canvas
function drawPixelBlock(ctx, centerX, centerY, px, py, pSize, color) {
  ctx.fillStyle = color;
  ctx.fillRect(centerX + px * pSize, centerY + py * pSize, pSize, pSize);
}

class PhysicsTarget {
  constructor(canvasWidth, canvasHeight) {
    this.canvasWidth = canvasWidth;
    this.canvasHeight = canvasHeight;

    this.type = getRandomTargetType();
      
    this.radius = 26;
    
    // Smaller, cleaner fruit size for a more precise and polished gameplay feel
    this.width = this.radius * 2;
    this.height = this.radius * 2;

    // --- Dynamic Spawn Position Across Full Canvas Width ---
    const sideMargin = 80;
    this.x = sideMargin + Math.random() * (canvasWidth - sideMargin * 2);
    this.y = canvasHeight + 20;

    // --- Dynamic Velocity ---
    const targetCenterX = canvasWidth / 2 + (Math.random() - 0.5) * 200;
    const distanceX = targetCenterX - this.x;
    
    const speedBoost = Math.min(score * 0.02, 2);

    this.vx = (distanceX / 90) + (Math.random() - 0.5) * 1.2;
    this.vy = -(10.5 + Math.random() * 2.5 + speedBoost);
    this.gravity = 0.22;

    // --- Rotation / Spin Mechanics ---
    this.angle = Math.random() * Math.PI * 2;
    this.rotationSpeed = (Math.random() - 0.5) * 0.14;

    
  }

  reset(canvasWidth, canvasHeight) {
    this.canvasWidth = canvasWidth;
    this.canvasHeight = canvasHeight;
    this.type = getRandomTargetType();
    this.x = 80 + Math.random() * (canvasWidth - 160);
    this.y = canvasHeight + 20;
    const targetCenterX = canvasWidth / 2 + (Math.random() - 0.5) * 200;
    const speedBoost = Math.min(score * 0.02, 2);
    this.vx = (targetCenterX - this.x) / 90 + (Math.random() - 0.5) * 1.2;
    this.vy = -(10.5 + Math.random() * 2.5 + speedBoost);
    this.gravity = 0.22;
    this.angle = Math.random() * Math.PI * 2;
    this.rotationSpeed = (Math.random() - 0.5) * 0.14;
  }
  update() {
    // 1. Move target horizontally & vertically
    this.x += this.vx;
    this.y += this.vy;

    // 2. Apply gravity acceleration to downward velocity
    this.vy += this.gravity;

    // 3. Spin target
    this.angle += this.rotationSpeed;
  };

  // --- DRAW METHOD WITH ROTATION & SPRITES ---
  draw(ctx) {
    const img = fruitImages[this.type];

    ctx.save();
    // Translate origin to target center for smooth rotation
    ctx.translate(this.x, this.y);
    ctx.rotate(this.angle);

    if (img && img.complete && img.naturalWidth !== 0) {
      // Draw centered image
      ctx.drawImage(img, -this.width / 2, -this.height / 2, this.width, this.height);
    } else {
      // Temporary fallback shape while image loads
      ctx.fillStyle = this.type === 'BOMB' ? 'black' : 'red';
      ctx.beginPath();
      ctx.arc(0, 0, this.radius, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();
  }

  checkCollision(aimX, aimY) {
    const dx = this.x - aimX;
    const dy = this.y - aimY;
    return Math.sqrt(dx * dx + dy * dy) < (this.radius + 12);
  }}



// Call this function when a fruit is hit
function createFruitSplash(x, y, fruitType) {
  const palette = splashPalettes[fruitType] || splashPalettes.POMEGRANATE;

  // 1. Spawn Juice Droplets & Seeds
  for (let i = 0; i < 20 && particleCount < MAX_PARTICLES; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 3 + Math.random() * 8;
    const particle = particlePool[particleCount] || (particlePool[particleCount] = {});
    particle.x = x;
    particle.y = y;
    particle.vx = Math.cos(angle) * speed;
    particle.vy = Math.sin(angle) * speed;
    particle.size = Math.random() > 0.5 ? 4 : 6;
    particle.color = Math.random() > 0.3 ? palette.juice : palette.rind;
    particle.gravity = 0.25;
    particle.life = 25 + Math.random() * 15;
    particles[particleCount++] = particle;
  }

  // 2. Spawn Expanding Juice Splatter Stamp
  if (stainCount < MAX_STAINS) {
    const stain = stainPool[stainCount] || (stainPool[stainCount] = {});
    stain.x = x;
    stain.y = y;
    stain.radius = 12;
    stain.maxRadius = 35 + Math.random() * 15;
    stain.color = palette.juice;
    stain.alpha = 0.6;
    juiceStains[stainCount++] = stain;
  }
}

// Render and update splashes inside renderGameSpace()

// Particle Explosions
function createExplosion(x, y, color) {
  for (let i = 0; i < 12 && particleCount < MAX_PARTICLES; i++) {
    const particle = particlePool[particleCount] || (particlePool[particleCount] = {});
    particle.x = x;
    particle.y = y;
    particle.vx = (Math.random() - 0.5) * 8;
    particle.vy = (Math.random() - 0.5) * 8;
    particle.radius = Math.random() * 4 + 2;
    particle.color = color;
    particle.life = 20;
    particle.size = 0;
    particle.gravity = 0;
    particles[particleCount++] = particle;
  }
}

function updateAndDrawParticles(ctx) {
  for (let i = particleCount - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx;
    p.y += p.vy;
    p.life--;

    ctx.beginPath();
    ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
    ctx.fillStyle = p.color;
    ctx.fill();

    if (p.life <= 0) {
      particleCount--;
      particles[i] = particles[particleCount];
      particles[particleCount] = p;
    }
  }
}

// ==========================================
// 2. MEDIAPIPE TRACKING & MAIN LOOP
// ==========================================
const hands = new Hands({
  locateFile: (file) => 
    {
    return `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`;
  }
});

hands.setOptions({
  maxNumHands: 1,
  modelComplexity: 0,           // 0 = Lightest/fastest model (removes ~10-15ms latency)
  minDetectionConfidence: 0.6,
  minTrackingConfidence: 0.6
});

hands.onResults(onResults);

function onResults(results) {
  if (statusText && statusText.innerText.includes("Initializing")) {
    statusText.innerText = "Status: Tracking Active ⚡";
    statusText.style.color = "#22c55e";
  }

  inputState.image = results.image;
  if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
    const landmarks = results.multiHandLandmarks[0];
    const indexTip = landmarks[8];
    
    const rawX = indexTip.x;
    const targetMirroredX = 1 - rawX;
    const targetY = indexTip.y;

    // --- ANTI-JITTER & SMOOTHING MATH ---
    const deltaX = targetMirroredX - smoothedX;
    const deltaY = targetY - smoothedY;
    const distance = Math.hypot(deltaX, deltaY);
    handWorker.postMessage({ landmarks: landmarks });

    // Ignore tiny microscopic camera jitter
    if (distance > JITTER_THRESHOLD) {
      smoothedX += deltaX * SMOOTHING_FACTOR;
      smoothedY += deltaY * SMOOTHING_FACTOR;
    }

    inputState.normX = smoothedX;
    inputState.normY = smoothedY;
    inputState.cameraX = rawX;
  }
}

function updateAndDrawEffects(ctx) {
  // A. Render Juice Stains in the background
  for (let i = stainCount - 1; i >= 0; i--) {
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

    if (s.alpha <= 0) {
      stainCount--;
      juiceStains[i] = juiceStains[stainCount];
      juiceStains[stainCount] = s;
    }
  }

  // B. Render Flying Pixel Particles
  for (let i = particleCount - 1; i >= 0; i--) {
    const p = particles[i];
    p.x += p.vx;
    p.y += p.vy;
    p.vy += p.gravity; // Gravity arc
    p.life--;

    // Render as sharp pixel blocks
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x, p.y, p.size, p.size);

    if (p.life <= 0) {
      particleCount--;
      particles[i] = particles[particleCount];
      particles[particleCount] = p;
    }
  }
}

function spawnBossHazard(type) {
  const angle = Math.random() * Math.PI * 2;
  const distance = 70 + Math.random() * 55;
  const bossPosition = getBossPosition();
  const originX = bossPosition.x + Math.cos(angle) * distance;
  const originY = bossPosition.y + Math.sin(angle) * distance * 0.55;
  const targetX = gameCanvas.width / 2 + (Math.random() - 0.5) * 180;
  const targetY = gameCanvas.height + 40;
  const travel = 70 + Math.random() * 30;

  bossHazards.push({
    type,
    x: originX,
    y: originY,
    vx: (targetX - originX) / travel,
    vy: type === 'BOMB' ? -(4 + Math.random() * 3) : -(5 + Math.random() * 2),
    gravity: 0.16,
    bounceCount: 0,
    radius: type === 'BOMB' ? 31 : 24,
    angle: Math.random() * Math.PI * 2,
    rotationSpeed: (Math.random() - 0.5) * 0.15
  });
}

function getBossPosition() {
  return {
    x: gameCanvas.width / 2 + Math.sin(bossPulse * 0.42) * 145,
    y: 145 + Math.sin(bossPulse * 0.67) * 35
  };
}

function updateBossSmoke() {
  const bossPosition = getBossPosition();
  if (bossSmoke.length < 18 && Math.random() < 0.16) {
    bossSmoke.push({
      x: bossPosition.x + (Math.random() - 0.5) * 90,
      y: bossPosition.y - 40 + Math.random() * 35,
      radius: 4 + Math.random() * 7,
      life: 80 + Math.random() * 50,
      vx: (Math.random() - 0.5) * 0.35,
      vy: -(0.35 + Math.random() * 0.45)
    });
  }

  for (let i = bossSmoke.length - 1; i >= 0; i--) {
    const smoke = bossSmoke[i];
    smoke.x += smoke.vx;
    smoke.y += smoke.vy;
    smoke.radius += 0.08;
    smoke.life--;
    if (smoke.life <= 0) bossSmoke.splice(i, 1);
  }
}

function drawBossSmoke(ctx) {
  for (const smoke of bossSmoke) {
    ctx.save();
    ctx.globalAlpha = Math.min(0.28, smoke.life / 300);
    ctx.fillStyle = '#cbd5e1';
    ctx.beginPath();
    ctx.arc(smoke.x, smoke.y, smoke.radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

function drawHealthBar(ctx, x, y, width, value, max, label, color) {
  ctx.fillStyle = 'rgba(2, 6, 23, 0.8)';
  ctx.fillRect(x, y, width, 24);
  ctx.fillStyle = color;
  ctx.fillRect(x + 3, y + 3, (width - 6) * Math.max(0, value / max), 18);
  ctx.font = 'bold 13px monospace';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(`${label}: ${Math.ceil(value)}/${max}`, x + width / 2, y + 17);
}

function drawBoss(ctx) {
  const image = fruitImages.DURIAN;
  const bossPosition = getBossPosition();
  const bossX = bossPosition.x;
  const bossY = bossPosition.y;
  const size = 130 + Math.sin(bossPulse) * 4;

  ctx.save();
  ctx.shadowColor = finalMatchResult === 'DEFEAT' ? '#ef4444' : '#facc15';
  ctx.shadowBlur = 20 + Math.sin(bossPulse) * 8;
  if (image.complete && image.naturalWidth !== 0) {
    ctx.drawImage(image, bossX - size / 2, bossY - size / 2, size, size);
  } else {
    ctx.fillStyle = '#84cc16';
    ctx.beginPath();
    ctx.arc(bossX, bossY, size / 2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawVictoryEffect(ctx) {
  const bossPosition = getBossPosition();
  const centerX = bossPosition.x;
  const centerY = bossPosition.y;
  for (let i = 0; i < 18; i++) {
    const angle = (Math.PI * 2 * i) / 18 + bossPulse * 0.3;
    const length = 75 + Math.sin(bossPulse * 2 + i) * 18;
    ctx.strokeStyle = `rgba(250, 204, 21, ${0.45 + Math.random() * 0.3})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(centerX + Math.cos(angle) * 65, centerY + Math.sin(angle) * 65);
    ctx.lineTo(centerX + Math.cos(angle) * length, centerY + Math.sin(angle) * length);
    ctx.stroke();
  }
}

function drawDefeatLightning(ctx) {
  const bossPosition = getBossPosition();
  ctx.strokeStyle = '#ef4444';
  ctx.lineWidth = 5;
  for (let branch = 0; branch < 5; branch++) {
    const startX = bossPosition.x - 100 + branch * 50;
    ctx.beginPath();
    ctx.moveTo(startX, bossPosition.y - 100);
    ctx.lineTo(startX - 15, bossPosition.y - 65);
    ctx.lineTo(startX + 8, bossPosition.y - 60);
    ctx.lineTo(startX - 12, bossPosition.y - 15);
    ctx.stroke();
  }
}

function drawFinalMatch(ctx, canvasX, canvasY, isShotFired) {
  bossPulse += 0.04;
  bossSpawnTimer++;
  updateBossSmoke();
  drawBossSmoke(ctx);

  if (finalMatchResult === null) {
    if (bossSpawnTimer >= 22) {
      bossSpawnTimer = 0;
      const bombCount = Math.random() < 0.35 ? 2 : 1;
      for (let i = 0; i < bombCount; i++) spawnBossHazard('BOMB');
      if (Math.random() < 0.2) spawnBossHazard('FRUIT');
    }

    drawBoss(ctx);
    drawHealthBar(ctx, 30, 24, 260, playerHealth, PLAYER_MAX_HEALTH, 'PLAYER', '#22c55e');
    drawHealthBar(ctx, gameCanvas.width - 290, 24, 260, bossHealth, BOSS_MAX_HEALTH, 'DURIAN', '#ef4444');

    for (let i = bossHazards.length - 1; i >= 0; i--) {
      const hazard = bossHazards[i];
      hazard.x += hazard.vx;
      hazard.y += hazard.vy;
      hazard.vy += hazard.gravity;
      hazard.angle += hazard.rotationSpeed;
      ctx.save();
      ctx.translate(hazard.x, hazard.y);
      ctx.rotate(hazard.angle);
      const image = fruitImages[hazard.type === 'FRUIT' ? 'APPLE' : 'BOMB'];
      if (image.complete && image.naturalWidth !== 0) {
        ctx.drawImage(image, -hazard.radius, -hazard.radius, hazard.radius * 2, hazard.radius * 2);
      } else {
        ctx.fillStyle = hazard.type === 'FRUIT' ? '#22c55e' : '#111827';
        ctx.beginPath();
        ctx.arc(0, 0, hazard.radius, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      if (isShotFired && Math.hypot(hazard.x - canvasX, hazard.y - canvasY) < hazard.radius + 12) {
        if (hazard.type === 'BOMB') playerHealth = Math.max(0, playerHealth - 12);
        else playerHealth = Math.min(PLAYER_MAX_HEALTH, playerHealth + 15);
        createExplosion(hazard.x, hazard.y, hazard.type === 'BOMB' ? '#f97316' : '#22c55e');
        bossHazards.splice(i, 1);
        continue;
      }
      if (hazard.type === 'BOMB' && hazard.y + hazard.radius >= gameCanvas.height - 8 && hazard.vy > 0) {
        hazard.y = gameCanvas.height - hazard.radius - 8;
        hazard.vy = -(Math.abs(hazard.vy) * 0.82 + 2.5);
        hazard.vx *= 0.98;
        hazard.bounceCount++;
      }
      if (hazard.y > gameCanvas.height + 60) bossHazards.splice(i, 1);
    }

    const bossPosition = getBossPosition();
    if (isShotFired && Math.hypot(bossPosition.x - canvasX, bossPosition.y - canvasY) < 78) {
      bossHealth = Math.max(0, bossHealth - 5);
      createExplosion(bossPosition.x, bossPosition.y, '#facc15');
    }
    if (bossHealth <= 0) finalMatchResult = 'VICTORY';
    if (playerHealth <= 0) finalMatchResult = 'DEFEAT';
    drawReticle(canvasX, canvasY, isFiringState);
  } else {
    drawBoss(ctx);
    if (finalMatchResult === 'VICTORY') drawVictoryEffect(ctx);
    else drawDefeatLightning(ctx);
    ctx.fillStyle = finalMatchResult === 'VICTORY' ? '#facc15' : '#ef4444';
    ctx.font = 'bold 48px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(finalMatchResult, gameCanvas.width / 2, 290);
    ctx.font = 'bold 18px monospace';
    ctx.fillStyle = '#f8fafc';
    ctx.fillText(finalMatchResult === 'VICTORY' ? 'THE DURIAN HAS FALLEN' : 'THE DURIAN HAS WON', gameCanvas.width / 2, 325);
  }
}


function handleTargetSpawning() {
  spawnTimer++;

  // 1. Calculate spawn interval based on current score (Faster as score rises)
  // Starts at 60 frames (~1 sec), decreases down to 22 frames (~0.36 sec)
  const countdownBoost = Math.floor((GAME_DURATION - timeRemaining) / 10);
  const spawnInterval = Math.max(18, 60 - Math.floor(score / 30) * 5 - countdownBoost);

  if (spawnTimer >= spawnInterval) {
    spawnTimer = 0;

    // 2. Determine wave size (burst amount) based on score
    let waveSize = 1;
    if (score >= 100 || timeRemaining <= 60) {
      waveSize = Math.random() < 0.6 ? 3 : 2; // Up to 3 fruits at once
    } else if (score >= 40) {
      waveSize = Math.random() < 0.5 ? 2 : 1; // 1 or 2 fruits
    }

    // 3. Spawn targets in wave
    for (let i = 0; i < waveSize && targetCount < MAX_TARGETS; i++) {
      const target = targetPool.pop() || new PhysicsTarget(gameCanvas.width, gameCanvas.height);
      target.reset(gameCanvas.width, gameCanvas.height);
      targets[targetCount++] = target;
    }
  }
}

function recycleTarget(index) {
  const target = targets[index];
  targetCount--;
  targets[index] = targets[targetCount];
  targets[targetCount] = target;
  targetPool.push(target);
}

// -------------------------------------------------------------
// RENDER RIGHT PANE & GAME OVER OVERLAY
// -------------------------------------------------------------
function renderGameSpace(normX, normY, isShotFired, isHoldingThisFrame, activeFinger) {
  gameCtx.clearRect(0, 0, gameCanvas.width, gameCanvas.height);
  drawBackgroundGrid(gameCtx);
  updateAndDrawEffects(gameCtx);

  if (isHoldingThisFrame) {
    shotHoldCounter++;

    if (shotHoldCounter === 1) {
      playParallelSound(sndSingleShot);
    } else if (shotHoldCounter >= AUTO_FIRE_THRESHOLD && !isLoopingMulti) {
      startMultiShotLoop();
    }
  } else {
    if (isLoopingMulti) {
      stopMultiShotLoop();
    }
    shotHoldCounter = 0;
  }

  const canvasX = normX * gameCanvas.width;
  const canvasY = normY * gameCanvas.height;

  if (finalMatchActive) {
    drawFinalMatch(gameCtx, canvasX, canvasY, isShotFired);
    if (finalMatchResult) {
      isGameOver = true;
      if (gameOverActionsEl) gameOverActionsEl.classList.remove('hidden');
    }
  } else if (!isGameOver) {
    handleTargetSpawning();

    for (let i = targetCount - 1; i >= 0; i--) {
      const t = targets[i];

      t.update();
      if (t.y - t.radius > gameCanvas.height) {
        recycleTarget(i);
        continue;
      }
      t.draw(gameCtx);

      if (isShotFired && t.checkCollision(canvasX, canvasY)) {
        createFruitSplash(t.x, t.y, t.type);
        playParallelSound(sndSplash);

        if (t.type === 'BOMB') {
          targetStats.BOMB++;
          score -=15;
        } else {
          targetStats[t.type]++;
          switch (t.type) {
            case 'POMEGRANATE':
            case 'BANANA':
              score += 20;
              break;
            case 'APPLE':
            case 'ORANGE':
              score += 10;
              break;
          }
        }

        if (scoreDisplayEl) scoreDisplayEl.textContent = score;
        recycleTarget(i);
        if (score >= FINAL_MATCH_SCORE) enterFinalMatch();
      }
    }

    drawReticle(canvasX, canvasY, isFiringState);
    drawTimerHUD(gameCtx);
  } else {
    drawGameOverScreen(gameCtx);
  }
}

// Draw Timer HUD in Top Right
function drawTimerHUD(ctx) {
  const mins = Math.floor(timeRemaining / 60);
  const secs = (timeRemaining % 60).toString().padStart(2, '0');
  const timerText = `${mins.toString().padStart(2, '0')}:${secs}`;

  ctx.font = "bold 18px monospace";
  ctx.fillStyle = timeRemaining <= 10 ? "#ef4444" : "#ffffff";
  ctx.textAlign = "right";
  ctx.fillText(`TIME: ${timerText}`, gameCanvas.width - 20, 30);
}

// Render Game Over Summary Card
function toggleGameOverActions() {
  if (!gameOverActionsEl) return;
  const shouldHide = !isGameOver;
  if (gameOverActionsEl.classList.contains('hidden') === shouldHide) return;
  gameOverActionsEl.classList.toggle('hidden', shouldHide);
}

function drawGameOverScreen(ctx) {
  toggleGameOverActions();

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

  // Target Stats Header
  ctx.font = "bold 18px sans-serif";
  ctx.fillStyle = "#f8fafc";
  ctx.fillText("TARGET BREAKDOWN", gameCanvas.width / 2, 170);

  // Stats List
  ctx.font = "16px monospace";
  ctx.textAlign = "left";
  
  const startX = gameCanvas.width / 2 - 150;
  let startY = 210;
  const lineSpacing = 32;

  const targetNames = [
    ['POMEGRANATE', 'Pomegranates'],
    ['BANANA', 'Bananas'],
    ['APPLE', 'Apples'],
    ['ORANGE', 'Oranges'],
    ['BOMB', 'Bombs encountered']
  ];
  for (let i = 0; i < targetNames.length; i++) {
    const [type, label] = targetNames[i];

    ctx.fillStyle = "#94a3b8";
    ctx.fillText(`${label}:`, startX, startY);
    
    ctx.fillStyle = type === 'BOMB' ? "#f97316" : "#22c55e";
    ctx.fillText(String(targetStats[type]), startX + 290, startY);

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
  const ringColor = isFiring ? '#f87171' : '#7dd3fc';
  const innerColor = isFiring ? '#f87171' : '#38bdf8';

  gameCtx.beginPath();
  gameCtx.arc(x, y, 12, 0, Math.PI * 2);
  gameCtx.strokeStyle = ringColor;
  gameCtx.lineWidth = 2.8;
  gameCtx.stroke();

  gameCtx.beginPath();
  gameCtx.arc(x, y, 3.5, 0, Math.PI * 2);
  gameCtx.fillStyle = innerColor;
  gameCtx.fill();

  gameCtx.beginPath();
  gameCtx.arc(x, y, 18, 0, Math.PI * 2);
  gameCtx.strokeStyle = 'rgba(125, 211, 252, 0.22)';
  gameCtx.lineWidth = 1;
  gameCtx.stroke();

  gameCtx.strokeStyle = 'rgba(125, 211, 252, 0.12)';
  gameCtx.beginPath();
  gameCtx.moveTo(x, 0); gameCtx.lineTo(x, gameCanvas.height);
  gameCtx.moveTo(0, y); gameCtx.lineTo(gameCanvas.width, y);
  gameCtx.stroke();

  if (flashTimer > 0) {
    gameCtx.beginPath();
    gameCtx.arc(x, y, 26, 0, 2 * Math.PI);
    gameCtx.fillStyle = 'rgba(239, 68, 68, 0.24)';
    gameCtx.fill();
    flashTimer--;
  }
}

function drawBackgroundGrid(ctx) {
  ctx.drawImage(gridCanvas, 0, 0);
}

function renderFrame() {
  if (inputState.image) {
    cameraCtx.save();
    cameraCtx.clearRect(0, 0, cameraCanvas.width, cameraCanvas.height);
    cameraCtx.drawImage(inputState.image, 0, 0, cameraCanvas.width, cameraCanvas.height);
    drawLeftPivotCircle(cameraCtx, inputState.cameraX, inputState.normY, isFiringState);
    cameraCtx.restore();
  }

  inputState.isShotFired = workerTriggerState.isFiring;
  inputState.isHolding = workerTriggerState.isHolding;
  inputState.activeFinger = workerTriggerState.activeFinger;
  if (!isGameOver && inputState.isShotFired) {
    isFiringState = true;
    flashTimer = 5;
    if (triggerStateEl) {
      triggerStateEl.textContent = `BANG! (${inputState.activeFinger}) 💥`;
      triggerStateEl.style.color = '#ef4444';
    }
    workerTriggerState.isFiring = false;
  } else {
    isFiringState = false;
    if (triggerStateEl && !isGameOver) {
      triggerStateEl.textContent = 'AIMING';
      triggerStateEl.style.color = '#38bdf8';
    }
  }

  renderGameSpace(
    inputState.normX,
    inputState.normY,
    inputState.isShotFired,
    inputState.isHolding,
    inputState.activeFinger
  );
  requestAnimationFrame(renderFrame);
}

requestAnimationFrame(renderFrame);

// Start Camera
const camera = new Camera(videoElement, {
  onFrame: async () => {
    const now = performance.now();
    if (now - lastInferenceTime >= INFERENCE_INTERVAL) {
      lastInferenceTime = now;
      await hands.send({ image: videoElement });
    }
  },
  width: 320,
  height: 240
});

camera.start().catch((err) => {
  if (statusText) {
    statusText.innerText = `Camera Error: ${err.message}`;
    statusText.style.color = "#ef4444";
  }
});
