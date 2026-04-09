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

  // Player submits votes (map of answerId -> guessedPlayerId)
  socket.on('submit-votes', (votesMap) => {
    if (game.phase !== 'voting') return;
    if (!game.players[socket.id]) return;
    // Store each vote: { voterId, answerId, guessedId }
    Object.entries(votesMap).forEach(([answerId, guessedId]) => {
      if (!game.votes[answerId]) game.votes[answerId] = {};
      game.votes[answerId][socket.id] = guessedId;
    });

    // Check if all players who answered have voted
    const answerers = Object.keys(game.answers);
    const allVoted = answerers.every(id => {
      // This player needs to have voted on all answers except their own
      const othersAnswers = answerers.filter(a => a !== id);
      return othersAnswers.every(answerId =>
        game.votes[answerId] && game.votes[answerId][id] !== undefined
      );
    });
    if (allVoted) revealResults();
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
  game.votes = {}; // answerId -> { voterId: guessedId }
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

  // game.votes structure: { answerId: { voterId: guessedId } }
  // For each answer, count how many voters correctly identified the author
  Object.keys(game.answers).forEach(answerId => {
    const votesForThisAnswer = game.votes[answerId] || {};
    let correctCount = 0;
    Object.entries(votesForThisAnswer).forEach(([voterId, guessedId]) => {
      if (guessedId === answerId) {
        // Correct guess — voter gets 1 point
        if (game.players[voterId]) game.players[voterId].score += 1;
        correctCount++;
      }
    });
    // Author scoring: mystery bonus if nobody guessed them
    const authorPts = correctCount === 0 ? 2 : 0;
    game.roundScores[answerId] = authorPts;
    if (game.players[answerId]) game.players[answerId].score += authorPts;
  });

  const resultsPayload = {
    answers: Object.entries(game.answers).map(([id, text]) => {
      const votesForAnswer = game.votes[id] || {};
      const correctVoters = Object.entries(votesForAnswer)
        .filter(([, guessedId]) => guessedId === id)
        .map(([voterId]) => game.players[voterId]?.name || '?');
      return {
        id,
        name: game.players[id]?.name || '?',
        text,
        points: game.roundScores[id] || 0,
        votes: correctVoters,
      };
    }),
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
