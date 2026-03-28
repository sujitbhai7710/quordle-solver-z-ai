import init, { QuordleSolver, get_pattern_string } from './quordle-wasm/pkg/quordle_solver.js';

let solver = null;
let wordBank = [];
let allowedWords = [];
let guesses = []; // Array of {word: string, patterns: number[][]} for each board
let gameMode = 'daily';
let maxGuesses = {daily:9, daily_chill:12, daily_extreme:8, practice:9, sequence:10, weekly:9, rescue:9};
let boardCount = 4;
let boardSolved = [false, false, false, false];
let boardPossibleWords = [[], [], [], []]; // Remaining possible words per board
let selectedGuessIdx = -1;

// Initialize
async function main() {
  await init();
  
  // Load word banks
  const [answersResp, allowedResp] = await Promise.all([
    fetch('./wordbank-answers.txt'),
    fetch('./wordbank-allowed.txt')
  ]);
  
  const answersText = await answersResp.text();
  const allowedText = await allowedResp.text();
  
  wordBank = answersText.trim().split('\n').filter(w => w.length === 5);
  allowedWords = [...new Set([...wordBank, ...allowedText.trim().split('\n').filter(w => w.length === 5)])];
  
  // Create solver
  solver = new QuordleSolver(wordBank, allowedWords);
  
  // Initialize board possible words
  resetBoards();
  
  // Setup event listeners
  setupUI();
  
  console.log(`Loaded ${wordBank.length} answer words, ${allowedWords.length} allowed words`);
}

function resetBoards() {
  boardSolved = [false, false, false, false];
  guesses = [];
  selectedGuessIdx = -1;
  for (let i = 0; i < boardCount; i++) {
    boardPossibleWords[i] = [...wordBank];
  }
  updateUI();
}

function setupUI() {
  document.getElementById('mode-select').addEventListener('change', (e) => {
    gameMode = e.target.value;
    document.getElementById('max-guesses').textContent = maxGuesses[gameMode];
    resetBoards();
  });
  
  document.getElementById('guess-input').addEventListener('input', (e) => {
    e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, '');
  });
  
  document.getElementById('guess-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addGuess();
  });
  
  document.getElementById('add-guess-btn').addEventListener('click', addGuess);
  document.getElementById('clear-btn').addEventListener('click', resetBoards);
  document.getElementById('solve-btn').addEventListener('click', solve);
  document.getElementById('apply-pattern-btn').addEventListener('click', applyPatternsAndSolve);
}

function addGuess() {
  const input = document.getElementById('guess-input');
  const word = input.value.toUpperCase().trim();
  
  if (word.length !== 5) {
    shakeElement(input);
    return;
  }
  
  if (!allowedWords.includes(word) && !wordBank.includes(word)) {
    // Still allow it but warn
    console.warn(`${word} not in word list, but allowing anyway`);
  }
  
  guesses.push({ word, patterns: null }); // patterns will be set by user
  input.value = '';
  
  selectedGuessIdx = guesses.length - 1;
  updateUI();
  showPatternInput();
}

function removeGuess(idx) {
  // Need to recalculate board states from scratch
  guesses.splice(idx, 1);
  recalculateBoardStates();
  updateUI();
}

function recalculateBoardStates() {
  boardSolved = [false, false, false, false];
  for (let i = 0; i < boardCount; i++) {
    boardPossibleWords[i] = [...wordBank];
  }
  
  // Re-apply all known patterns
  for (const guess of guesses) {
    if (guess.patterns) {
      for (let b = 0; b < boardCount; b++) {
        if (!boardSolved[b] && guess.patterns[b]) {
          const patternStr = guess.patterns[b].join('');
          boardPossibleWords[b] = boardPossibleWords[b].filter(answer => {
            const p = get_pattern_string(guess.word, answer);
            return p === patternStr;
          });
          if (boardPossibleWords[b].length <= 1) {
            boardSolved[b] = true;
          }
        }
      }
    }
  }
}

function solve() {
  if (!solver || guesses.length === 0) return;
  
  const loading = document.getElementById('loading');
  loading.classList.remove('hidden');
  
  setTimeout(() => {
    try {
      // Convert board possible words to arrays for WASM
      const boardArrays = boardPossibleWords.map(b => b.slice(0, 5000)); // Limit for perf
      
      const results = solver.getQuickBestGuesses(
        boardArrays,
        guesses.length,
        20
      );
      
      displayResults(results);
    } catch (err) {
      console.error('Solver error:', err);
      document.getElementById('best-guesses-list').innerHTML = 
        `<p style="color: var(--accent)">Error: ${err.message}</p>`;
    }
    
    loading.classList.add('hidden');
  }, 50);
}

function displayResults(results) {
  const container = document.getElementById('best-guesses-list');
  container.innerHTML = '';
  
  if (!results || results.length === 0) {
    container.innerHTML = '<p>No results found</p>';
    return;
  }
  
  results.forEach((r, i) => {
    const div = document.createElement('div');
    div.className = 'guess-result';
    div.innerHTML = `
      <span class="rank">#${i + 1}</span>
      <span class="word">${r.word}</span>
      <span class="info">${r.score ? r.score.toFixed(2) : '—'}</span>
    `;
    div.addEventListener('click', () => {
      document.getElementById('guess-input').value = r.word;
    });
    container.appendChild(div);
  });
}

function showPatternInput() {
  const section = document.getElementById('pattern-section');
  section.classList.remove('hidden');
  
  const container = document.getElementById('pattern-inputs');
  container.innerHTML = '';
  
  if (selectedGuessIdx < 0 || !guesses[selectedGuessIdx]) return;
  
  const guess = guesses[selectedGuessIdx];
  
  for (let b = 0; b < boardCount; b++) {
    if (boardSolved[b]) continue;
    
    const div = document.createElement('div');
    div.className = 'pattern-input';
    
    const label = document.createElement('span');
    label.className = 'board-label';
    label.textContent = `Board ${b + 1}`;
    div.appendChild(label);
    
    const tilesDiv = document.createElement('div');
    tilesDiv.className = 'pattern-tiles';
    tilesDiv.dataset.board = b;
    
    for (let i = 0; i < 5; i++) {
      const tile = document.createElement('div');
      tile.className = 'pattern-tile';
      tile.dataset.state = guess.patterns?.[b]?.[i] ?? 0;
      tile.dataset.pos = i;
      tile.textContent = guess.word[i];
      
      updateTileVisual(tile);
      
      tile.addEventListener('click', () => {
        let state = parseInt(tile.dataset.state);
        state = (state + 1) % 3;
        tile.dataset.state = state;
        updateTileVisual(tile);
      });
      
      tilesDiv.appendChild(tile);
    }
    
    div.appendChild(tilesDiv);
    container.appendChild(div);
  }
}

function updateTileVisual(tile) {
  const state = tile.dataset.state;
  tile.style.background = state === '2' ? 'var(--green)' : state === '1' ? 'var(--yellow)' : 'var(--gray)';
}

function applyPatternsAndSolve() {
  if (selectedGuessIdx < 0) return;
  
  const guess = guesses[selectedGuessIdx];
  guess.patterns = [];
  
  for (let b = 0; b < boardCount; b++) {
    const tilesDiv = document.querySelector(`.pattern-tiles[data-board="${b}"]`);
    if (!tilesDiv) {
      guess.patterns.push(null);
      continue;
    }
    
    const tiles = tilesDiv.querySelectorAll('.pattern-tile');
    const pattern = Array.from(tiles).map(t => parseInt(t.dataset.state));
    guess.patterns.push(pattern);
    
    // Apply pattern to filter possible words
    if (!boardSolved[b]) {
      boardPossibleWords[b] = solver.filterByPattern(
        boardPossibleWords[b],
        guess.word,
        pattern
      );
      
      if (boardPossibleWords[b].length <= 1) {
        boardSolved[b] = true;
      }
    }
  }
  
  updateUI();
  solve();
}

function updateUI() {
  // Update guess count
  document.getElementById('guess-count').textContent = guesses.length;
  document.getElementById('max-guesses').textContent = maxGuesses[gameMode];
  
  // Update guesses list
  const list = document.getElementById('guesses-list');
  list.innerHTML = '';
  guesses.forEach((g, i) => {
    const chip = document.createElement('div');
    chip.className = 'guess-chip';
    if (i === selectedGuessIdx) chip.style.borderLeft = '3px solid var(--accent)';
    
    chip.innerHTML = `
      <span>${g.word}</span>
      <span class="remove" data-idx="${i}">&times;</span>
    `;
    chip.querySelector('.remove').addEventListener('click', () => removeGuess(i));
    chip.addEventListener('click', () => {
      selectedGuessIdx = i;
      showPatternInput();
      updateUI();
    });
    list.appendChild(chip);
  });
  
  // Update boards
  for (let b = 0; b < boardCount; b++) {
    const board = document.querySelector(`.board[data-board="${b}"]`);
    const status = document.getElementById(`status-${b}`);
    const wordsDiv = document.getElementById(`words-${b}`);
    
    if (boardSolved[b]) {
      board.classList.add('solved');
      status.textContent = boardPossibleWords[b][0] || 'Solved ✓';
      status.classList.add('solved');
    } else {
      board.classList.remove('solved');
      status.textContent = `${boardPossibleWords[b].length} possible`;
      status.classList.remove('solved');
    }
    
    // Show first few possible words
    const preview = boardPossibleWords[b].slice(0, 10).join(', ');
    wordsDiv.textContent = preview + (boardPossibleWords[b].length > 10 ? ` ... (+${boardPossibleWords[b].length - 10} more)` : '');
  }
  
  // Show/hide pattern section
  const patternSection = document.getElementById('pattern-section');
  if (guesses.length > 0 && !guesses.every(g => g.patterns)) {
    patternSection.classList.remove('hidden');
    if (selectedGuessIdx < 0) {
      selectedGuessIdx = guesses.findIndex(g => !g.patterns);
    }
    showPatternInput();
  } else if (guesses.length === 0) {
    patternSection.classList.add('hidden');
  }
}

function shakeElement(el) {
  el.style.animation = 'none';
  el.offsetHeight; // Trigger reflow
  el.style.animation = 'shake 0.3s ease';
}

// Add shake animation
const style = document.createElement('style');
style.textContent = `
  @keyframes shake {
    0%, 100% { transform: translateX(0); }
    25% { transform: translateX(-8px); }
    75% { transform: translateX(8px); }
  }
`;
document.head.appendChild(style);

// Boot
main().catch(console.error);
