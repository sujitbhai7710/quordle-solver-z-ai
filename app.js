import init, { QuordleSolver, get_pattern_string } from './quordle-wasm/pkg/quordle_solver.js';

let solver = null;
let wordBankRestricted = [];
let wordBankAll = [];
let wordBankMode = 'restricted';
let guesses = [];
let gameMode = 'daily';
let maxGuesses = { daily: 9, daily_chill: 12, daily_extreme: 8, practice: 9, sequence: 10, weekly: 9, rescue: 9 };
const boardCount = 4;
let boardSolved = [false, false, false, false];
let boardPossibleWords = [[], [], [], []];
let selectedGuessIdx = -1;

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

function getAnswerList() {
  return wordBankMode === 'complete' ? wordBankAll : wordBankRestricted;
}

function getBoardWords(b) {
  if (boardPossibleWords[b].length > 0) return boardPossibleWords[b];
  if (wordBankMode === 'restricted') return [...wordBankAll];
  return [];
}

async function main() {
  await init();
  const [a, b] = await Promise.all([fetch('./wordbank-answers.txt'), fetch('./wordbank-allowed.txt')]);
  wordBankRestricted = (await a.text()).trim().split('\n').filter(w => w.length === 5);
  wordBankAll = [...new Set([...wordBankRestricted, ...(await b.text()).trim().split('\n').filter(w => w.length === 5)])];
  solver = new QuordleSolver(wordBankRestricted, wordBankAll);
  resetBoards();
  bindEvents();
}

function resetBoards() {
  boardSolved = [false, false, false, false];
  guesses = [];
  selectedGuessIdx = -1;
  const list = getAnswerList();
  for (let i = 0; i < boardCount; i++) boardPossibleWords[i] = [...list];
  hidePattern();
  render();
}

function bindEvents() {
  $('#mode-select').addEventListener('change', e => {
    gameMode = e.target.value;
    resetBoards();
  });

  $('#wordbank-select').addEventListener('change', e => {
    wordBankMode = e.target.value;
    resetBoards();
  });

  $('#clear-btn').addEventListener('click', resetBoards);

  const input = $('#guess-input');
  input.addEventListener('input', e => {
    e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, '');
  });
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') addGuess();
  });

  $('#add-guess-btn').addEventListener('click', addGuess);
  $('#apply-pattern-btn').addEventListener('click', applyPatterns);
}

function addGuess() {
  const input = $('#guess-input');
  const word = input.value.toUpperCase().trim();
  if (word.length !== 5) { input.classList.add('shake'); setTimeout(() => input.classList.remove('shake'), 400); return; }
  guesses.push({ word, patterns: null });
  input.value = '';
  selectedGuessIdx = guesses.length - 1;
  render();
  showPattern();
}

function removeGuess(idx) {
  guesses.splice(idx, 1);
  recalcBoards();
  if (selectedGuessIdx >= guesses.length) selectedGuessIdx = guesses.length - 1;
  if (guesses.length === 0) hidePattern();
  render();
}

function recalcBoards() {
  boardSolved = [false, false, false, false];
  const list = getAnswerList();
  for (let i = 0; i < boardCount; i++) boardPossibleWords[i] = [...list];
  for (const g of guesses) {
    if (!g.patterns) continue;
    for (let b = 0; b < boardCount; b++) {
      if (boardSolved[b] || !g.patterns[b]) continue;
      const ps = g.patterns[b].join('');
      let filtered = boardPossibleWords[b].filter(w => get_pattern_string(g.word, w) === ps);
      if (filtered.length === 0 && wordBankMode === 'restricted') {
        filtered = wordBankAll.filter(w => get_pattern_string(g.word, w) === ps);
      }
      boardPossibleWords[b] = filtered;
      if (boardPossibleWords[b].length <= 1) boardSolved[b] = true;
    }
  }
}

function solve() {
  if (!solver) return;
  const loading = $('#loading');
  loading.classList.remove('hidden');

  setTimeout(() => {
    try {
      const boards = [];
      for (let b = 0; b < boardCount; b++) boards.push(getBoardWords(b).slice(0, 5000));
      const results = solver.getBestGuessesWithMode(boards, guesses.length, 20, wordBankMode);
      renderResults(results);
    } catch (err) {
      $('#best-guesses-list').innerHTML = `<p style="color:var(--red);padding:12px">Error: ${err.message}</p>`;
    }
    loading.classList.add('hidden');
  }, 30);
}

function showPattern() {
  const section = $('#pattern-section');
  section.classList.remove('hidden');
  const container = $('#pattern-inputs');
  container.innerHTML = '';

  if (selectedGuessIdx < 0 || !guesses[selectedGuessIdx]) return;
  const guess = guesses[selectedGuessIdx];

  for (let b = 0; b < boardCount; b++) {
    if (boardSolved[b]) continue;
    const row = document.createElement('div');
    row.className = 'pattern-row';

    const label = document.createElement('span');
    label.className = 'pattern-label';
    label.textContent = `Board ${b + 1}`;
    row.appendChild(label);

    const tiles = document.createElement('div');
    tiles.className = 'pattern-tiles';
    tiles.dataset.board = b;

    for (let i = 0; i < 5; i++) {
      const tile = document.createElement('div');
      tile.className = 'pattern-tile';
      tile.dataset.state = guess.patterns?.[b]?.[i] ?? 0;
      tile.textContent = guess.word[i];
      styleTile(tile);
      tile.addEventListener('click', () => {
        tile.dataset.state = (parseInt(tile.dataset.state) + 1) % 3;
        styleTile(tile);
      });
      tiles.appendChild(tile);
    }
    row.appendChild(tiles);
    container.appendChild(row);
  }
}

function hidePattern() {
  $('#pattern-section').classList.add('hidden');
}

function styleTile(tile) {
  const s = tile.dataset.state;
  tile.style.background = s === '2' ? 'var(--green)' : s === '1' ? 'var(--yellow)' : 'var(--gray)';
  tile.style.borderColor = s === '2' ? '#16a34a' : s === '1' ? '#d4a008' : '#4a4a5c';
  tile.style.color = s === '2' ? '#001a00' : s === '1' ? '#1a1a00' : 'rgba(255,255,255,0.7)';
}

function applyPatterns() {
  if (selectedGuessIdx < 0) return;
  const guess = guesses[selectedGuessIdx];
  guess.patterns = [];

  for (let b = 0; b < boardCount; b++) {
    const tilesDiv = $(`.pattern-tiles[data-board="${b}"]`);
    if (!tilesDiv) { guess.patterns.push(null); continue; }
    const pattern = Array.from(tilesDiv.querySelectorAll('.pattern-tile')).map(t => parseInt(t.dataset.state));
    guess.patterns.push(pattern);

    if (!boardSolved[b]) {
      let filtered = solver.filterByPattern(boardPossibleWords[b], guess.word, pattern);
      if (filtered.length === 0 && wordBankMode === 'restricted') {
        filtered = solver.filterByPattern(wordBankAll, guess.word, pattern);
      }
      boardPossibleWords[b] = filtered;
      if (boardPossibleWords[b].length <= 1) boardSolved[b] = true;
    }
  }
  render();
  solve();
}

function render() {
  // Counter
  $('#guess-count').textContent = guesses.length;
  $('#max-guesses').textContent = maxGuesses[gameMode];

  // Badge
  const badge = $('#guess-badge');
  badge.textContent = guesses.length === 0 ? 'none yet' : `${guesses.length} guess${guesses.length > 1 ? 'es' : ''}`;

  // Guesses list
  const list = $('#guesses-list');
  if (guesses.length === 0) {
    list.innerHTML = '<div class="empty-state">Enter a guess below to start solving</div>';
  } else {
    list.innerHTML = '';
    guesses.forEach((g, i) => {
      const chip = document.createElement('div');
      chip.className = 'guess-chip' + (i === selectedGuessIdx ? ' active' : '');
      chip.innerHTML = `<span>${g.word}</span><span class="remove" title="Remove">&times;</span>`;
      chip.querySelector('.remove').addEventListener('click', e => { e.stopPropagation(); removeGuess(i); });
      chip.addEventListener('click', () => { selectedGuessIdx = i; showPattern(); render(); });
      list.appendChild(chip);
    });
  }

  // Boards
  for (let b = 0; b < boardCount; b++) {
    const board = $(`.board[data-board="${b}"]`);
    const status = $(`#status-${b}`);
    const body = $(`#words-${b}`);
    const words = getBoardWords(b);

    if (boardSolved[b]) {
      board.classList.add('solved');
      status.textContent = boardPossibleWords[b][0] || '✓ Solved';
      status.classList.add('solved-status');
    } else {
      board.classList.remove('solved');
      status.textContent = `${words.length} left`;
      status.classList.remove('solved-status');
    }

    const preview = words.slice(0, 15).join(', ');
    body.textContent = preview || '—';
  }
}

function renderResults(results) {
  const container = $('#best-guesses-list');
  container.innerHTML = '';
  if (!results || results.length === 0) {
    container.innerHTML = '<div class="empty-state">No results</div>';
    return;
  }
  results.forEach((r, i) => {
    const card = document.createElement('div');
    card.className = 'result-card';
    card.style.animationDelay = `${i * 30}ms`;
    const inRestricted = wordBankRestricted.includes(r.word);
    const badge = !inRestricted && wordBankMode === 'restricted' ? '<span class="result-badge">all</span>' : '';
    card.innerHTML = `
      <span class="result-rank">#${i + 1}</span>
      <span class="result-word">${r.word}${badge}</span>
      <span class="result-score">${r.score ? r.score.toFixed(2) : '—'}</span>
    `;
    card.addEventListener('click', () => { $('#guess-input').value = r.word; });
    container.appendChild(card);
  });
}

main().catch(console.error);
