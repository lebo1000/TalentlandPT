const socket = io();

// ── State ────────────────────────────────────────────────────────────────────
let players = [];
let currentQuestion = '';
let totalAnswers = 0;

// ── Screen helper ─────────────────────────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.add('hidden'));
  document.getElementById(id).classList.remove('hidden');
}

// ── Lobby ─────────────────────────────────────────────────────────────────────
const baseUrl = location.port
  ? `${location.protocol}//${location.hostname}:${location.port}`
  : `${location.protocol}//${location.hostname}`;
socket.emit('get-qr', baseUrl);

socket.on('qr-ready', ({ qr, url }) => {
  document.getElementById('qr-img').src = qr;
  document.getElementById('join-url').textContent = url;
});

socket.emit('sync-state');

socket.on('state-sync', ({ phase, players: p, question, questionIndex }) => {
  players = p;
  if (phase === 'lobby') {
    showScreen('screen-lobby');
    renderLobbyPlayers(p);
  }
  // Other phases handled by their own events on reconnect
});

socket.on('players-update', (p) => {
  players = p;
  renderLobbyPlayers(p);
  updateAnswerProgress(p);

  const btn = document.getElementById('btn-start');
  btn.disabled = p.length < 2;
  document.getElementById('min-players-hint').classList.toggle('hidden', p.length >= 2);
});

function renderLobbyPlayers(p) {
  const grid = document.getElementById('player-grid');
  grid.innerHTML = p.map(pl => `
    <div class="player-chip ${pl.answered ? 'answered' : ''}">
      <span class="dot"></span>${pl.name}
    </div>
  `).join('');
}

// ── Start round ───────────────────────────────────────────────────────────────
document.getElementById('btn-start').addEventListener('click', () => {
  socket.emit('start-round');
});

socket.on('round-started', ({ question, questionIndex }) => {
  currentQuestion = question;
  totalAnswers = 0;
  document.getElementById('round-label').textContent = `Ronda ${questionIndex + 1}`;
  document.getElementById('question-display').textContent = question;
  document.getElementById('answer-count').textContent = `0 / ${players.length} respuestas recibidas`;
  document.getElementById('answer-progress').style.width = '0%';
  document.getElementById('answering-player-grid').innerHTML = '';
  showScreen('screen-answering');
});

function updateAnswerProgress(p) {
  const answered = p.filter(pl => pl.answered).length;
  const total = p.length;
  if (total === 0) return;
  const pct = Math.round((answered / total) * 100);
  document.getElementById('answer-progress').style.width = pct + '%';
  document.getElementById('answer-count').textContent = `${answered} / ${total} respuestas recibidas`;

  const grid = document.getElementById('answering-player-grid');
  if (grid) {
    grid.innerHTML = p.map(pl => `
      <div class="player-chip ${pl.answered ? 'answered' : ''}">
        <span class="dot"></span>${pl.name}
      </div>
    `).join('');
  }
}

document.getElementById('btn-force-voting').addEventListener('click', () => {
  socket.emit('force-voting');
});

// ── Voting ────────────────────────────────────────────────────────────────────
socket.on('voting-started', ({ answers, players: p }) => {
  players = p;
  document.getElementById('voting-question').textContent = currentQuestion;

  const grid = document.getElementById('voting-answers-grid');
  grid.innerHTML = answers.map(a => `
    <div class="answer-card">
      <div class="answer-text">"${escHtml(a.text)}"</div>
    </div>
  `).join('');

  showScreen('screen-voting');
});

document.getElementById('btn-force-results').addEventListener('click', () => {
  socket.emit('force-results');
});

// ── Results ───────────────────────────────────────────────────────────────────
socket.on('results-ready', ({ answers, scores }) => {
  const grid = document.getElementById('results-answers-grid');
  grid.innerHTML = answers.map(a => `
    <div class="answer-card correct">
      <div class="points-badge">+${a.points} pts</div>
      <div class="answer-text">"${escHtml(a.text)}"</div>
      <div class="answer-author">— <strong>${escHtml(a.name)}</strong></div>
      <div class="answer-votes">
        ${a.votes.length > 0
          ? `Adivinado por: ${a.votes.map(v => escHtml(v)).join(', ')}`
          : '¡Nadie te adivinó! +2 pts misterio 🕵️'}
      </div>
    </div>
  `).join('');

  const sorted = [...scores].sort((a, b) => b.score - a.score);
  const medals = ['🥇', '🥈', '🥉'];
  document.getElementById('results-scores').innerHTML = sorted.map((p, i) => `
    <div class="score-row">
      <div class="score-rank">${medals[i] || (i + 1)}</div>
      <div class="score-name">${escHtml(p.name)}</div>
      <div class="score-pts">${p.score} pts</div>
    </div>
  `).join('');

  showScreen('screen-results');
});

document.getElementById('btn-next-round').addEventListener('click', () => {
  socket.emit('next-round');
});

socket.on('back-to-lobby', ({ scores }) => {
  players = scores;
  renderLobbyPlayers(scores);
  document.getElementById('btn-start').disabled = scores.length < 2;
  showScreen('screen-lobby');
});

// ── Reset ─────────────────────────────────────────────────────────────────────
function resetGame() {
  socket.emit('reset-game');
}
document.getElementById('btn-reset').addEventListener('click', resetGame);
document.getElementById('btn-reset-2').addEventListener('click', resetGame);

socket.on('game-reset', () => {
  players = [];
  renderLobbyPlayers([]);
  document.getElementById('btn-start').disabled = true;
  showScreen('screen-lobby');
});

// ── Utils ─────────────────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
