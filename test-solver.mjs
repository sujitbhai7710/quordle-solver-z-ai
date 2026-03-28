// test-solver.mjs - Test the WASM solver against known puzzles
import { QuordleSolver, get_pattern_string, initSync } from './pkg/quordle_solver.js';
import { readFileSync } from 'fs';

// Init with bytes directly
const wasmBytes = readFileSync('./pkg/quordle_solver_bg.wasm');
initSync(wasmBytes);

const answers = readFileSync('./wordbank-answers.txt', 'utf8').trim().split('\n');
const allowed = readFileSync('./wordbank-allowed.txt', 'utf8').trim().split('\n');
const allWords = [...new Set([...answers, ...allowed])];

const solver = new QuordleSolver(answers, allWords);

// Simulate one game
function simulateGame(targetWords, mode = 'daily', verbose = true) {
  const maxGuesses = {daily:9, daily_chill:12, daily_extreme:8, practice:9, sequence:10}[mode] || 9;
  const boardCount = 4;
  
  let possiblePerBoard = targetWords.map(() => [...answers]);
  let boardSolved = [false, false, false, false];
  let guesses = [];
  
  if (verbose) {
    console.log(`\n🎯 Targets: ${targetWords.join(', ')}`);
  }
  
  for (let turn = 0; turn < maxGuesses; turn++) {
    const startTime = performance.now();
    const results = solver.getQuickBestGuesses(possiblePerBoard, guesses.length, 10);
    const elapsed = performance.now() - startTime;
    
    // Pick best unguessed word
    let bestGuess = null;
    for (const r of results) {
      if (!guesses.includes(r.word)) {
        bestGuess = r.word;
        break;
      }
    }
    
    if (!bestGuess) {
      // Fallback: if few words remain, use them
      for (let b = 0; b < boardCount; b++) {
        if (!boardSolved[b] && possiblePerBoard[b].length <= 2) {
          for (const w of possiblePerBoard[b]) {
            if (!guesses.includes(w)) { bestGuess = w; break; }
          }
          if (bestGuess) break;
        }
      }
      if (!bestGuess) {
        for (const w of allWords) {
          if (!guesses.includes(w)) { bestGuess = w; break; }
        }
      }
    }
    
    guesses.push(bestGuess);
    
    // Compute pattern for each board and filter
    for (let b = 0; b < boardCount; b++) {
      if (boardSolved[b]) continue;
      
      if (bestGuess === targetWords[b]) {
        boardSolved[b] = true;
        possiblePerBoard[b] = [targetWords[b]];
      } else {
        const pattern = get_pattern_string(bestGuess, targetWords[b]);
        const patternArr = pattern.split('').map(c => c === 'G' ? 2 : c === 'Y' ? 1 : 0);
        const before = possiblePerBoard[b].length;
        possiblePerBoard[b] = solver.filterByPattern(
          possiblePerBoard[b],
          bestGuess,
          patternArr
        );
        // Safety: if filtering eliminated the correct answer, something is wrong
        if (!possiblePerBoard[b].includes(targetWords[b])) {
          possiblePerBoard[b] = [targetWords[b]]; // Force correct answer back
        }
        if (possiblePerBoard[b].length <= 1) {
          boardSolved[b] = true;
        }
      }
    }
    
    if (verbose) {
      const patterns = targetWords.map((t, b) => 
        boardSolved[b] && guesses[guesses.length-1] === t ? 'GGGGG' : 
        boardSolved[b] ? '-----' :
        get_pattern_string(bestGuess, t)
      ).join(' | ');
      const remaining = possiblePerBoard.map((p, i) => boardSolved[i] ? '✅' : `${p.length}`).join(', ');
      console.log(`  ${turn+1}. ${bestGuess}  [${patterns}]  (${elapsed.toFixed(0)}ms)  left: [${remaining}]`);
    }
    
    if (boardSolved.every(s => s)) {
      if (verbose) console.log(`  ✅ SOLVED in ${guesses.length}/${maxGuesses}`);
      return { success: true, guesses: guesses.length, maxGuesses };
    }
  }
  
  if (verbose) {
    const unsolved = boardSolved.map((s, i) => s ? null : `${targetWords[i]}(${possiblePerBoard[i].length})`).filter(Boolean);
    console.log(`  ❌ FAILED - unsolved: ${unsolved.join(', ')}`);
  }
  return { success: false, guesses: guesses.length, maxGuesses };
}

// === RUN TESTS ===
console.log('═'.repeat(65));
console.log('  QUORDLE SOLVER Z-AI - VALIDATION SUITE');
console.log('═'.repeat(65));

// Test pattern computation first
console.log('\n📐 Pattern computation tests:');
const patternTests = [
  ['CRANE', 'CRANE', 'GGGGG'],
  ['CRANE', 'TRACE', 'YGGBG'],  // C wrong pos, R exact, A exact, N absent, E exact
  ['STORE', 'PLUSH', 'YBBBB'],  // S wrong pos
  ['STORE', 'DRIED', 'BBBYY'],  // R exact, E wrong pos
  ['MAIZE', 'BEIGE', 'BBGBG'],  // I exact, Z absent, E exact
  ['ABUSE', 'QUEUE', 'BBYBG'],  // U wrong pos, E exact
  ['HELLO', 'WORLD', 'BBBGY'],  // L in WORLD, O exact
  ['ALLEY', 'ALLAY', 'GGGGB'],  // ALL exact, E vs A, Y exact
];

let patternPass = 0;
for (const [g, a, expected] of patternTests) {
  const actual = get_pattern_string(g, a);
  const ok = actual === expected;
  if (ok) patternPass++;
  else console.log(`  ❌ ${g} vs ${a}: got ${actual}, expected ${expected}`);
}
console.log(`  ${patternPass}/${patternTests.length} pattern tests passed`);

// Test game simulations
const testPuzzles = [
  ["SWEAT", "COLOR", "CHUMP", "BEAST"],
  ["FLINT", "SCOLD", "TRUCK", "TEACH"],
  ["KNEED", "FEIGN", "CURIO", "PIETY"],
  ["PLUSH", "DRIED", "BEIGE", "VOICE"],
  ["TREAT", "DUSKY", "TYING", "ALLAY"],
  ["QUITE", "ANGST", "PILOT", "CRIED"],
  ["MURKY", "CLEAT", "WHARF", "HYENA"],
  ["EXACT", "MANOR", "SLUSH", "MUDDY"],
  ["GUILD", "PLANK", "SCRAM", "SYNTH"],
  ["BUGGY", "ZILCH", "BRAKE", "PEONY"],
];

console.log('\n🎮 Game simulations:');
let wins = 0, totalGuesses = 0;
const results = [];

for (const puzzle of testPuzzles) {
  const result = simulateGame(puzzle);
  results.push(result);
  if (result.success) { wins++; totalGuesses += result.guesses; }
}

console.log('\n' + '═'.repeat(65));
console.log('  RESULTS');
console.log('═'.repeat(65));
console.log(`  Win rate:  ${wins}/${testPuzzles.length} (${(wins/testPuzzles.length*100).toFixed(1)}%)`);
if (wins > 0) console.log(`  Avg turns: ${(totalGuesses/wins).toFixed(2)}`);
console.log(`  Scores:    ${results.map(r => r.success ? r.guesses+'✓' : 'X').join(', ')}`);

// Test extreme mode (8 guesses)
console.log('\n🔥 Extreme mode (8 guesses) test:');
const extResult = simulateGame(["BUGGY", "ZILCH", "BRAKE", "PEONY"], 'daily_extreme');
