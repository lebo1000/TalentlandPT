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
socket.on('voting-started', ({ answers, players }) => {
  currentAnswers = answers;
  selectedVote = null;

  // Show all answers and ask player to guess who said each one
  // Simplified: show all answers, player picks one person they think said the FIRST answer
  // For a richer UX we show all answers and let them pick a name for each
  // Here: show all answers on screen, player picks a name (one vote total)

  // Display the first answer that isn't theirs (or just all of them)
  // We'll show all answers and ask them to pick who said them collectively
  // Simplest fun approach: show all answers, pick one name you think said the most interesting one

  // Actually let's show all answers and have them vote on who said answer #1
  // (the server tracks one vote per player)

  const firstAnswer = answers[0];
  if (!firstAnswer) {
    showScreen('screen-vote-sent');
    return;
  }

  document.getElementById('vote-answer-text').textContent = `"${firstAnswer.text}"`;

  const optionsContainer = document.getElementById('vote-options');
  optionsContainer.innerHTML = players
    .filter(p => p.name !== myName) // can't vote for yourself
    .map(p => `
      <button class="vote-option" data-id="${p.id}" onclick="selectVote(this, '${p.id}')">
        ${escHtml(p.name)}
      </button>
    `).join('');

  document.getElementById('btn-submit-vote').disabled = true;
  showScreen('screen-vote');
});

function selectVote(el, id) {
  selectedVote = id;
  document.querySelectorAll('.vote-option').forEach(b => b.classList.remove('selected'));
  el.classList.add('selected');
  document.getElementById('btn-submit-vote').disabled = false;
}
window.selectVote = selectVote;

document.getElementById('btn-submit-vote').addEventListener('click', () => {
  if (!selectedVote) return;
  socket.emit('submit-vote', selectedVote);
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
