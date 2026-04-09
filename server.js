const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const QRCode = require('qrcode');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'public')));

// ── Game state ──────────────────────────────────────────────────────────────
const QUESTIONS = [
  '¿Cuál es tu comida favorita?',
  '¿A qué lugar del mundo quisieras viajar?',
  '¿Cuál es tu talento oculto?',
  '¿Qué harías si ganaras la lotería?',
  '¿Cuál es tu película o serie favorita?',
  '¿Qué superpoder elegirías?',
  '¿Cuál es tu mayor miedo?',
  '¿Qué canción no puedes dejar de escuchar?',
  '¿Cuál es tu hobby favorito?',
  '¿Qué animal serías y por qué?',
];

let game = createFreshGame();

function createFreshGame() {
  return {
    phase: 'lobby',       // lobby | answering | voting | results | scoreboard
    players: {},          // socketId -> { name, score, answered }
    currentQuestion: 0,
    answers: {},          // socketId -> answer text
    votes: {},            // voterSocketId -> guessedSocketId
    roundScores: {},      // socketId -> points this round
  };
}

function getPublicPlayers() {
  return Object.entries(game.players).map(([id, p]) => ({
    id,
    name: p.name,
    score: p.score,
    answered: p.answered,
  }));
}

// ── Socket events ────────────────────────────────────────────────────────────
io.on('connection', (socket) => {

  // Host requests QR code for the room URL
  socket.on('get-qr', async (baseUrl) => {
    try {
      const url = `${baseUrl}/player.html`;
      const qr = await QRCode.toDataURL(url, { width: 300, margin: 1 });
      socket.emit('qr-ready', { qr, url });
    } catch (e) {
      console.error('QR error', e);
    }
  });

  // Player joins
  socket.on('join', (name) => {
    if (game.phase !== 'lobby') {
      socket.emit('join-error', 'El juego ya comenzó, espera la siguiente ronda.');
      return;
    }
    const trimmed = name.trim().slice(0, 24);
    if (!trimmed) return;
    game.players[socket.id] = { name: trimmed, score: 0, answered: false };
    socket.emit('joined', { name: trimmed });
    io.emit('players-update', getPublicPlayers());
  });

  // Host starts the answering phase
  socket.on('start-round', () => {
    if (Object.keys(game.players).length < 2) return;
    game.phase = 'answering';
    game.answers = {};
    game.votes = {};
    game.roundScores = {};
    Object.values(game.players).forEach(p => p.answered = false);

    const question = QUESTIONS[game.currentQuestion % QUESTIONS.length];
    io.emit('round-started', { question, questionIndex: game.currentQuestion });
    io.emit('players-update', getPublicPlayers());
  });

  // Player submits answer
  socket.on('submit-answer', (answer) => {
    if (game.phase !== 'answering') return;
    if (!game.players[socket.id]) return;
    const trimmed = answer.trim().slice(0, 120);
    if (!trimmed) return;

    game.answers[socket.id] = trimmed;
    game.players[socket.id].answered = true;
    io.emit('players-update', getPublicPlayers());

    // Auto-advance when everyone answered
    const total = Object.keys(game.players).length;
    const done = Object.keys(game.answers).length;
    if (done >= total) startVoting();
  });

  // Host manually advances to voting (in case someone didn't answer)
  socket.on('force-voting', () => {
    if (game.phase === 'answering') startVoting();
  });

  // Player submits vote
  socket.on('submit-vote', (guessedId) => {
    if (game.phase !== 'voting') return;
    if (!game.players[socket.id]) return;
    if (socket.id === guessedId) return; // can't vote for yourself
    game.votes[socket.id] = guessedId;

    const voters = Object.keys(game.players).filter(id => game.answers[id] !== undefined
      ? true  // only players who answered can vote
      : false
    );
    // Actually all players vote
    const totalVoters = Object.keys(game.players).length;
    const totalVotes = Object.keys(game.votes).length;
    if (totalVotes >= totalVoters) revealResults();
  });

  // Host manually advances to results
  socket.on('force-results', () => {
    if (game.phase === 'voting') revealResults();
  });

  // Host goes to next round
  socket.on('next-round', () => {
    game.currentQuestion++;
    game.phase = 'lobby';
    Object.values(game.players).forEach(p => p.answered = false);
    io.emit('back-to-lobby', { scores: getPublicPlayers() });
  });

  // Host resets the whole game
  socket.on('reset-game', () => {
    game = createFreshGame();
    io.emit('game-reset');
  });

  // Sync new host connection with current state
  socket.on('sync-state', () => {
    socket.emit('state-sync', {
      phase: game.phase,
      players: getPublicPlayers(),
      question: game.phase !== 'lobby' ? QUESTIONS[game.currentQuestion % QUESTIONS.length] : null,
      questionIndex: game.currentQuestion,
    });
  });

  socket.on('disconnect', () => {
    if (game.players[socket.id]) {
      delete game.players[socket.id];
      io.emit('players-update', getPublicPlayers());
    }
  });
});

function startVoting() {
  game.phase = 'voting';
  // Send answers shuffled, without revealing who said what
  const shuffled = Object.entries(game.answers)
    .map(([id, text]) => ({ id, text }))
    .sort(() => Math.random() - 0.5);
  io.emit('voting-started', {
    answers: shuffled,
    players: getPublicPlayers(),
  });
}

function revealResults() {
  game.phase = 'results';

  // Calculate scores: 1 point per correct guess
  Object.entries(game.votes).forEach(([voterId, guessedId]) => {
    if (game.answers[guessedId] !== undefined) {
      // Check if the guess was correct (guessedId actually said that answer)
      // The voter guessed that guessedId said their answer — correct if guessedId is in answers
      // We need to check: did voter guess the right person for ANY answer?
      // Simpler: voter picks a name for a specific answer shown. We track per-answer voting.
      // Current model: voter submits ONE guessedId (the person they think said the current answer)
      // For multi-answer rounds we'd need a different model.
      // Here: each player votes on WHO they think said the highlighted answer.
      // Score: correct guess = 1 point for voter, 1 point for the person who "fooled" nobody
    }
  });

  // Revised scoring: for each answer, count how many people correctly identified the author
  // Correct guesser gets 1 point; if nobody guessed you, you get a "mystery" bonus
  const correctGuesses = {}; // answerId -> count of correct guesses
  Object.entries(game.votes).forEach(([voterId, guessedId]) => {
    if (!correctGuesses[guessedId]) correctGuesses[guessedId] = 0;
    correctGuesses[guessedId]++;
  });

  // Points: 1 per correct vote you received (others knew you), 
  //         2 bonus if nobody guessed you (you're mysterious!)
  Object.keys(game.answers).forEach(id => {
    const guessCount = correctGuesses[id] || 0;
    let pts = guessCount; // 1 pt per person who correctly identified you
    if (guessCount === 0) pts += 2; // mystery bonus
    game.roundScores[id] = pts;
    game.players[id].score += pts;
  });

  const resultsPayload = {
    answers: Object.entries(game.answers).map(([id, text]) => ({
      id,
      name: game.players[id]?.name || '?',
      text,
      points: game.roundScores[id] || 0,
      votes: Object.entries(game.votes)
        .filter(([, guessed]) => guessed === id)
        .map(([voterId]) => game.players[voterId]?.name || '?'),
    })),
    scores: getPublicPlayers(),
  };

  io.emit('results-ready', resultsPayload);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🎉 Juego iniciado en http://localhost:${PORT}`);
  console.log(`   Pantalla principal: http://localhost:${PORT}/index.html`);
  console.log(`   Vista jugador:      http://localhost:${PORT}/player.html\n`);
});
