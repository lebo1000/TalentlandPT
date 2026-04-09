const socket = io();

// ── State ─────────────────────────────────────────────────────────────────────
let myName = '';
let selectedVote = null;
let currentAnswers = [];
let myScore = 0;

// ── Screen helper ─────────────────────────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.mobile-screen').forEach(s => s.classList.add('hidden'));
  document.getElementById(id).classList.remove('hidden');
}

// ── Join ──────────────────────────────────────────────────────────────────────
const nameInput = document.getElementById('name-input');
const btnJoin   = document.getElementById('btn-join');

btnJoin.addEventListener('click', joinGame);
nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') joinGame(); });

function joinGame() {
  const name = nameInput.value.trim();
  if (!name) return;
  btnJoin.disabled = true;
  socket.emit('join', name);
}

socket.on('joined', ({ name }) => {
  myName = name;
  document.getElementById('welcome-name').textContent = `¡Hola, ${name}! 👋`;
  showScreen('screen-waiting');
});

socket.on('join-error', (msg) => {
  document.getElementById('join-error').textContent = msg;
  btnJoin.disabled = false;
});

// ── Players update (show in waiting room) ─────────────────────────────────────
socket.on('players-update', (players) => {
  const container = document.getElementById('waiting-players');
  if (!container) return;
  container.innerHTML = `
    <div class="player-grid" style="justify-content:center;">
      ${players.map(p => `
        <div class="player-chip">
          <span class="dot"></span>${escHtml(p.name)}
        </div>
      `).join('')}
    </div>
  `;
});

// ── Round started ─────────────────────────────────────────────────────────────
socket.on('round-started', ({ question, questionIndex }) => {
  document.getElementById('player-round-label').textContent = `Ronda ${questionIndex + 1}`;
  document.getElementById('player-question').textContent = question;
  document.getElementById('answer-input').value = '';
  document.getElementById('btn-submit-answer').disabled = false;
  showScreen('screen-answer');
});

// ── Submit answer ─────────────────────────────────────────────────────────────
document.getElementById('btn-submit-answer').addEventListener('click', () => {
  const answer = document.getElementById('answer-input').value.trim();
  if (!answer) return;
  socket.emit('submit-answer', answer);
  document.getElementById('btn-submit-answer').disabled = true;
  showScreen('screen-answer-sent');
});

// ── Voting ────────────────────────────────────────────────────────────────────
// votes map: answerId -> selectedPlayerId
let myVotes = {};
let votablePlayers = [];
let answersToVote = [];

socket.on('voting-started', ({ answers, players }) => {
  myVotes = {};
  votablePlayers = players;
  // Only show answers that aren't mine (server sends all, we filter by id)
  // Server sends answers as [{ id: socketId, text }] — filter out my own
  answersToVote = answers.filter(a => a.id !== socket.id);

  if (answersToVote.length === 0) {
    // I'm the only one who answered, skip straight to waiting
    socket.emit('submit-votes', {});
    showScreen('screen-vote-sent');
    return;
  }

  renderVoteCards();
  document.getElementById('btn-submit-vote').disabled = true;
  showScreen('screen-vote');
});

function renderVoteCards() {
  const otherPlayers = votablePlayers.filter(p => p.id !== socket.id);
  const container = document.getElementById('vote-cards');

  container.innerHTML = answersToVote.map((a, i) => `
    <div class="card" style="padding:16px;">
      <p style="font-size:0.95rem; font-weight:700; margin-bottom:12px; color:var(--accent2);">
        Respuesta ${i + 1}:
      </p>
      <p style="font-size:1rem; margin-bottom:14px; line-height:1.4;">"${escHtml(a.text)}"</p>
      <div style="display:flex; flex-direction:column; gap:8px;">
        ${otherPlayers.map(p => `
          <button
            class="vote-option"
            data-answer="${a.id}"
            data-player="${p.id}"
            onclick="selectVoteFor('${a.id}', '${p.id}', this)"
          >${escHtml(p.name)}</button>
        `).join('')}
      </div>
    </div>
  `).join('');

  checkAllVoted();
}

function selectVoteFor(answerId, playerId, el) {
  // Deselect other buttons for this answer
  document.querySelectorAll(`[data-answer="${answerId}"]`)
    .forEach(b => b.classList.remove('selected'));
  el.classList.add('selected');
  myVotes[answerId] = playerId;
  checkAllVoted();
}
window.selectVoteFor = selectVoteFor;

function checkAllVoted() {
  const allVoted = answersToVote.every(a => myVotes[a.id]);
  document.getElementById('btn-submit-vote').disabled = !allVoted;
}

document.getElementById('btn-submit-vote').addEventListener('click', () => {
  socket.emit('submit-votes', myVotes);
  document.getElementById('btn-submit-vote').disabled = true;
  showScreen('screen-vote-sent');
});

// ── Results ───────────────────────────────────────────────────────────────────
socket.on('results-ready', ({ answers, scores }) => {
  // Find my result
  const myResult = answers.find(a => a.name === myName);
  const myEntry  = scores.find(p => p.name === myName);
  myScore = myEntry?.score || 0;

  if (myResult) {
    const guessedMe = myResult.votes.length;
    if (guessedMe === 0) {
      document.getElementById('result-emoji').textContent = '🕵️';
      document.getElementById('result-title').textContent = '¡Eres un misterio!';
      document.getElementById('result-points').textContent = `+${myResult.points} puntos esta ronda · ${myScore} total`;
    } else {
      document.getElementById('result-emoji').textContent = '😄';
      document.getElementById('result-title').textContent = `${guessedMe} persona${guessedMe > 1 ? 's' : ''} te adivinó`;
      document.getElementById('result-points').textContent = `+${myResult.points} puntos esta ronda · ${myScore} total`;
    }
  } else {
    document.getElementById('result-emoji').textContent = '👀';
    document.getElementById('result-title').textContent = 'Resultados';
    document.getElementById('result-points').textContent = `${myScore} puntos totales`;
  }

  const sorted = [...scores].sort((a, b) => b.score - a.score);
  const medals = ['🥇', '🥈', '🥉'];
  document.getElementById('player-score-list').innerHTML = sorted.map((p, i) => `
    <div class="score-row" style="${p.name === myName ? 'border-color:var(--accent2)' : ''}">
      <div class="score-rank">${medals[i] || (i + 1)}</div>
      <div class="score-name">${escHtml(p.name)}</div>
      <div class="score-pts">${p.score} pts</div>
    </div>
  `).join('');

  showScreen('screen-player-results');
});

// ── Back to lobby ─────────────────────────────────────────────────────────────
socket.on('back-to-lobby', () => {
  showScreen('screen-waiting');
});

// ── Game reset ────────────────────────────────────────────────────────────────
socket.on('game-reset', () => {
  showScreen('screen-reset');
});

// ── Utils ─────────────────────────────────────────────────────────────────────
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
