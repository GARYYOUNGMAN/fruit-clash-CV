const STORAGE_KEY = 'fruitClashLeaderboard';
const PENDING_SCORE_KEY = 'fruitClashPendingScore';
const PENDING_TIME_KEY = 'fruitClashPendingTime';
const PENDING_BOSS_RESULT_KEY = 'fruitClashPendingBossResult';
const form = document.getElementById('score-form');
const nameInput = document.getElementById('player-name');
const scoreInput = document.getElementById('player-score');
const timeInput = document.getElementById('player-time');
const bossResultInput = document.getElementById('player-boss-result');
const status = document.getElementById('leaderboard-status');
const count = document.getElementById('leaderboard-count');
const list = document.getElementById('leaderboard-list');
const emptyState = document.getElementById('leaderboard-empty');
const resetButton = document.getElementById('reset-leaderboard');
const podiumEntries = [...document.querySelectorAll('.podium-entry')];

function loadScores() {
  try {
    const scores = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(scores)
      ? scores.filter(entry => entry && typeof entry.name === 'string' && Number.isSafeInteger(entry.score) && entry.score >= 0 && (entry.timeSeconds === undefined || (Number.isSafeInteger(entry.timeSeconds) && entry.timeSeconds >= 0)))
      : [];
  } catch {
    return [];
  }
}

function compareScores(first, second) {
  const resultRank = { WON: 0, LOST: 1, NOT_REACHED: 2 };
  const firstResultRank = resultRank[first.bossResult] ?? 3;
  const secondResultRank = resultRank[second.bossResult] ?? 3;
  if (firstResultRank !== secondResultRank) return firstResultRank - secondResultRank;
  if (first.score !== second.score) return second.score - first.score;
  const firstTime = Number.isSafeInteger(first.timeSeconds) ? first.timeSeconds : null;
  const secondTime = Number.isSafeInteger(second.timeSeconds) ? second.timeSeconds : null;
  if (firstTime !== secondTime) {
    if (firstTime === null) return 1;
    if (secondTime === null) return -1;
    return firstTime - secondTime;
  }
  return (first.savedAt || 0) - (second.savedAt || 0);
}

function formatElapsedTime(totalSeconds) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return hours > 0
    ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function formatBossResult(result) {
  if (result === 'WON') return 'Boss defeated';
  if (result === 'LOST') return 'Lost to boss';
  if (result === 'NOT_REACHED') return 'Boss not reached';
  return 'Not recorded';
}

function createElement(tag, className, text) {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = text;
  return element;
}

function renderScores() {
  const scores = loadScores().sort(compareScores);
  count.textContent = `${scores.length} ${scores.length === 1 ? 'record' : 'records'}`;

  podiumEntries.forEach(entry => {
    const place = Number(entry.dataset.place);
    const score = scores[place - 1];
    entry.querySelector('.podium-name').textContent = score?.name || 'Waiting for a player';
    entry.querySelector('.podium-score').textContent = score ? score.score.toLocaleString() : '--';
    entry.querySelector('.podium-time').textContent = !score
      ? '--'
      : Number.isSafeInteger(score.timeSeconds) ? formatElapsedTime(score.timeSeconds) : 'Time unavailable';
    const resultElement = entry.querySelector('.podium-result');
    resultElement.textContent = score ? formatBossResult(score.bossResult) : '';
    resultElement.dataset.result = score?.bossResult || '';
  });

  list.replaceChildren();
  scores.slice(3).forEach((score, index) => {
    const row = document.createElement('div');
    row.className = 'leaderboard-row';
    row.append(
      createElement('span', 'leaderboard-row-rank', `#${index + 4}`),
      createElement('span', 'leaderboard-row-name', score.name),
      createElement('span', 'leaderboard-row-score', score.score.toLocaleString()),
      createElement('span', 'leaderboard-row-time', Number.isSafeInteger(score.timeSeconds) ? formatElapsedTime(score.timeSeconds) : 'Time unavailable'),
      createElement('span', `leaderboard-row-result result-${score.bossResult || 'UNKNOWN'}`, formatBossResult(score.bossResult))
    );
    list.append(row);
  });

  emptyState.hidden = scores.length > 0;
}

const pendingScore = sessionStorage.getItem(PENDING_SCORE_KEY);
const pendingTime = sessionStorage.getItem(PENDING_TIME_KEY);
const pendingBossResult = sessionStorage.getItem(PENDING_BOSS_RESULT_KEY);
if (pendingScore !== null && /^\d+$/.test(pendingScore)) {
  scoreInput.value = pendingScore;
  if (['WON', 'LOST', 'NOT_REACHED'].includes(pendingBossResult)) {
    bossResultInput.value = pendingBossResult;
  }
  if (pendingTime !== null && /^\d+$/.test(pendingTime)) {
    timeInput.value = pendingTime;
    status.textContent = `Run score ${Number(pendingScore).toLocaleString()} and finish time ${formatElapsedTime(Number(pendingTime))} are ready to save.`;
  } else {
    status.textContent = `Run score ${Number(pendingScore).toLocaleString()} is ready to save.`;
  }
}

form.addEventListener('submit', event => {
  event.preventDefault();
  const name = nameInput.value.trim();
  const score = Number(scoreInput.value);
  const timeSeconds = Number(timeInput.value);
  if (!name || !Number.isSafeInteger(score) || score < 0 || score > 999999999 || !Number.isSafeInteger(timeSeconds) || timeSeconds < 0 || timeSeconds > 999999999) {
    status.textContent = 'Enter a player name, whole-number score, and finish time.';
    return;
  }

  const scores = loadScores();
  scores.push({ name, score, timeSeconds, bossResult: bossResultInput.value, savedAt: Date.now() });
  scores.sort(compareScores);

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(scores.slice(0, 100)));
    sessionStorage.removeItem(PENDING_SCORE_KEY);
    sessionStorage.removeItem(PENDING_TIME_KEY);
    sessionStorage.removeItem(PENDING_BOSS_RESULT_KEY);
    status.textContent = `Score, finish time, and boss result saved for ${name}.`;
    nameInput.value = '';
    scoreInput.value = '';
    timeInput.value = '';
    bossResultInput.value = 'NOT_REACHED';
    renderScores();
  } catch {
    status.textContent = 'Could not save this score in browser storage.';
  }
});

resetButton.addEventListener('click', () => {
  if (!loadScores().length) {
    status.textContent = 'The leaderboard is already empty.';
    return;
  }
  if (!window.confirm('Reset the leaderboard and delete all saved player records?')) return;

  try {
    localStorage.removeItem(STORAGE_KEY);
    renderScores();
    status.textContent = 'Leaderboard reset. All saved player records were deleted.';
  } catch {
    status.textContent = 'Could not reset the leaderboard in browser storage.';
  }
});

renderScores();
