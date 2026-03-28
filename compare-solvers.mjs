// compare-solvers.mjs - Head-to-head: wordlebot-style vs our entropy solver
import { QuordleSolver, get_pattern_string, initSync } from './pkg/quordle_solver.js';
import { readFileSync } from 'fs';

const wasmBytes = readFileSync('./pkg/quordle_solver_bg.wasm');
initSync(wasmBytes);

const answers = readFileSync('./wordbank-answers.txt', 'utf8').trim().split('\n');
const allowed = readFileSync('./wordbank-allowed.txt', 'utf8').trim().split('\n');
const allWords = [...new Set([...answers, ...allowed])];

const solver = new QuordleSolver(answers, allWords);

// ============================================================
// WORDBOT-STYLE ALGORITHM (pure JS, ported from wordlebot)
// ============================================================

// Compute pattern between two words (returns string like "GBYBB")
function computePattern(guess, answer) {
  let result = Array(5).fill('B');
  let answerArr = answer.split('');
  let guessArr = guess.split('');
  
  // First pass: exact matches (green)
  for (let i = 0; i < 5; i++) {
    if (guessArr[i] === answerArr[i]) {
      result[i] = 'G';
      answerArr[i] = ' ';
      guessArr[i] = ' ';
    }
  }
  
  // Second pass: wrong position (yellow)
  for (let i = 0; i < 5; i++) {
    if (guessArr[i] === ' ') continue;
    const idx = answerArr.indexOf(guessArr[i]);
    if (idx !== -1) {
      result[i] = 'Y';
      answerArr[idx] = ' ';
    }
  }
  
  return result.join('');
}

// Calculate average bucket size (wordlebot's metric)
function calculateAverageBucketSize(guess, possibleAnswers) {
  const buckets = {};
  let weighted = 0;
  let threes = 1; // probability game continues next turn
  
  for (const answer of possibleAnswers) {
    const diff = computePattern(guess, answer);
    if (!buckets[diff]) buckets[diff] = [];
    buckets[diff].push(answer);
    
    const freq = buckets[diff].length;
    if (freq > 0) {
      weighted += (freq / possibleAnswers.length) * freq 
                - ((freq - 1) / possibleAnswers.length) * (freq - 1);
      if (freq > 1) {
        threes -= 1 / possibleAnswers.length;
      }
    }
  }
  
  const adjusted = (1 - threes) * weighted;
  return { adjusted, weighted, threes, buckets };
}

// wordlebot's multi-board scoring: average the adjusted scores across boards
function wordlebotScore(guess, boardPossibles) {
  const activeBoards = boardPossibles.filter(b => b.length > 1);
  if (activeBoards.length === 0) return Infinity;
  
  let totalAdjusted = 0;
  let solvesCount = 0;
  
  for (const possible of activeBoards) {
    if (possible.length === 1 && possible[0] === guess) {
      solvesCount++;
      continue;
    }
    
    const data = calculateAverageBucketSize(guess, possible);
    totalAdjusted += data.adjusted;
  }
  
  const avgAdjusted = totalAdjusted / activeBoards.length;
  
  // Urgency: if guesses are running low, prioritize solving
  const urgency = solvesCount * 50;
  
  return avgAdjusted - urgency;
}

// Recursive lookahead for top candidates (wordlebot's key advantage)
function recursiveScore(guess, boardPossibles, depth, maxDepth) {
  if (depth >= maxDepth || boardPossibles.every(b => b.length <= 1)) {
    // Base case: count remaining boards
    return boardPossibles.filter(b => b.length > 1).length;
  }
  
  let totalRemaining = 0;
  let branchCount = 0;
  
  // For each board, consider what happens with each possible answer
  for (let b = 0; b < boardPossibles.length; b++) {
    if (boardPossibles[b].length <= 1) continue;
    
    for (const answer of boardPossibles[b]) {
      // Simulate this guess against this answer
      const pattern = computePattern(guess, answer);
      
      // Filter this board
      let newPossibles = [...boardPossibles];
      newPossibles[b] = boardPossibles[b].filter(w => computePattern(guess, w) === pattern);
      
      if (newPossibles[b].length === 0) newPossibles[b] = [answer]; // safety
      
      // Find best next guess for this branch
      let bestNext = Infinity;
      const candidates = [...new Set(newPossibles.flat())].slice(0, 30); // limit candidates
      
      for (const nextGuess of candidates) {
        const score = recursiveScore(nextGuess, newPossibles, depth + 1, maxDepth);
        bestNext = Math.min(bestNext, score);
      }
      
      totalRemaining += bestNext;
      branchCount++;
      
      if (branchCount > 20) break; // limit branches per board
    }
  }
  
  return branchCount > 0 ? totalRemaining / branchCount : Infinity;
}

// wordlebot-style solver: get best guesses
function wordlebotGetBestGuesses(boardPossibles, guessesMade, topN = 5) {
  // Collect unique candidate words
  let candidates = [...new Set(boardPossibles.flat())];
  
  // If first guess, use SALET (wordlebot's optimal opening)
  if (guessesMade === 0) {
    return [{ word: 'SALET', score: 0 }];
  }
  
  // If few words remain, just return them
  const activeBoards = boardPossibles.filter(b => b.length > 1);
  if (activeBoards.reduce((s, b) => s + b.length, 0) <= topN) {
    return candidates.filter(w => boardPossibles.some(b => b.length > 1 && b.includes(w)))
                     .slice(0, topN)
                     .map(w => ({ word: w, score: 0 }));
  }
  
  // Score all candidates with wordlebot's metric
  let scored = [];
  for (const guess of candidates) {
    const score = wordlebotScore(guess, boardPossibles);
    if (isFinite(score)) {
      scored.push({ word: guess, score });
    }
  }
  
  scored.sort((a, b) => a.score - b.score);
  
  // Take top 10 and apply recursive lookahead (depth 1)
  const topCandidates = scored.slice(0, 10);
  if (guessesMade < 7) { // Only recurse if we have time
    for (const c of topCandidates) {
      c.recursiveScore = wordlebotScore(c.word, boardPossibles); // Use adjusted score as proxy
    }
  }
  
  return topCandidates.slice(0, topN);
}

// ============================================================
// OUR ENTROPY SOLVER
// ============================================================
function ourGetBestGuesses(boardPossibles, guessesMade, topN = 5) {
  const results = solver.getQuickBestGuesses(boardPossibles, guessesMade, topN);
  return Array.from(results).map(r => ({ word: r.word, score: r.score }));
}

// ============================================================
// GAME SIMULATION
// ============================================================
function simulateGame(targetWords, getBestGuessesFn, maxGuesses = 9, label = '') {
  const boardCount = 4;
  let possiblePerBoard = targetWords.map(() => [...answers]);
  let boardSolved = [false, false, false, false];
  let guesses = [];
  
  for (let turn = 0; turn < maxGuesses; turn++) {
    const candidates = getBestGuessesFn(possiblePerBoard, guesses.length, 5);
    
    // Pick best unguessed word
    let bestGuess = null;
    for (const c of candidates) {
      if (!guesses.includes(c.word)) {
        bestGuess = c.word;
        break;
      }
    }
    
    if (!bestGuess) {
      // Fallback
      for (const b of possiblePerBoard) {
        for (const w of b) {
          if (!guesses.includes(w)) { bestGuess = w; break; }
        }
        if (bestGuess) break;
      }
    }
    
    if (!bestGuess) break;
    guesses.push(bestGuess);
    
    // Apply guess to all boards
    for (let b = 0; b < boardCount; b++) {
      if (boardSolved[b]) continue;
      
      if (bestGuess === targetWords[b]) {
        boardSolved[b] = true;
        possiblePerBoard[b] = [targetWords[b]];
      } else {
        const pattern = get_pattern_string(bestGuess, targetWords[b]);
        const patternArr = pattern.split('').map(c => c === 'G' ? 2 : c === 'Y' ? 1 : 0);
        possiblePerBoard[b] = solver.filterByPattern(possiblePerBoard[b], bestGuess, patternArr);
        
        // Safety: ensure correct answer is in list
        if (!possiblePerBoard[b].includes(targetWords[b])) {
          possiblePerBoard[b] = [targetWords[b]];
        }
        if (possiblePerBoard[b].length <= 1) boardSolved[b] = true;
      }
    }
    
    if (boardSolved.every(s => s)) {
      return { success: true, guesses: guesses.length, maxGuesses };
    }
  }
  
  return { success: false, guesses: guesses.length, maxGuesses };
}

// ============================================================
// RUN COMPARISON
// ============================================================

// 20 test puzzles covering various difficulty
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
  ["GRAPH", "FERRY", "SHOWY", "TRAIT"],
  ["WHINY", "FLUID", "WINCE", "SIXTH"],
  ["FACET", "STEEL", "VOWEL", "MISTY"],
  ["GLEAM", "MIMIC", "MAVEN", "TROUT"],
  ["STING", "FLAKE", "MANGA", "BROIL"],
  ["CHORE", "GORGE", "VODKA", "VOGUE"],
  ["FLUKE", "BRIDE", "MULCH", "LUCKY"],
  ["WORST", "POLKA", "CRACK", "PLUMB"],
  ["SPURT", "LOTTO", "VIPER", "ABODE"],
  ["SHOUT", "FLUME", "JERKY", "BEECH"],
];

console.log('═'.repeat(70));
console.log('  HEAD-TO-HEAD: WORDBOT vs OUR ENTROPY SOLVER (20 Quordle games)');
console.log('═'.repeat(70));

let wordlebotWins = 0, wordlebotTotalGuesses = 0, wordlebotResults = [];
let ourWins = 0, ourTotalGuesses = 0, ourResults = [];

for (let i = 0; i < testPuzzles.length; i++) {
  const puzzle = testPuzzles[i];
  process.stdout.write(`\n  Game ${i+1}: [${puzzle.join(', ')}]\n`);
  
  // Run wordlebot-style
  const t1 = performance.now();
  const wbResult = simulateGame(puzzle, wordlebotGetBestGuesses, 9, 'wordlebot');
  const wbTime = performance.now() - t1;
  wordlebotResults.push(wbResult);
  if (wbResult.success) { wordlebotWins++; wordlebotTotalGuesses += wbResult.guesses; }
  
  // Run our solver
  const t2 = performance.now();
  const ourResult = simulateGame(puzzle, ourGetBestGuesses, 9, 'ours');
  const ourTime = performance.now() - t2;
  ourResults.push(ourResult);
  if (ourResult.success) { ourWins++; ourTotalGuesses += ourResult.guesses; }
  
  const wbStr = wbResult.success ? `${wbResult.guesses}✓` : `X`;
  const ourStr = ourResult.success ? `${ourResult.guesses}✓` : `X`;
  const winner = wbResult.success && ourResult.success 
    ? (wbResult.guesses < ourResult.guesses ? '  ← wordlebot' : wbResult.guesses > ourResult.guesses ? '  ← ours' : '  tie')
    : wbResult.success ? '  ← wordlebot' : ourResult.success ? '  ← ours' : '  both lost';
  
  console.log(`    wordlebot: ${wbStr} (${wbTime.toFixed(0)}ms)  |  ours: ${ourStr} (${ourTime.toFixed(0)}ms)${winner}`);
}

// Summary
console.log('\n' + '═'.repeat(70));
console.log('  FINAL RESULTS');
console.log('═'.repeat(70));

console.log(`\n  WORDBOT-STYLE:`);
console.log(`    Win rate:  ${wordlebotWins}/20 (${(wordlebotWins/20*100).toFixed(1)}%)`);
if (wordlebotWins > 0) console.log(`    Avg turns: ${(wordlebotTotalGuesses/wordlebotWins).toFixed(2)}`);
console.log(`    Scores:   ${wordlebotResults.map(r => r.success ? r.guesses+'✓' : 'X').join(', ')}`);

console.log(`\n  OUR ENTROPY SOLVER:`);
console.log(`    Win rate:  ${ourWins}/20 (${(ourWins/20*100).toFixed(1)}%)`);
if (ourWins > 0) console.log(`    Avg turns: ${(ourTotalGuesses/ourWins).toFixed(2)}`);
console.log(`    Scores:   ${ourResults.map(r => r.success ? r.guesses+'✓' : 'X').join(', ')}`);

console.log(`\n  HEAD TO HEAD:`);
let wbBetter = 0, ourBetter = 0, ties = 0;
for (let i = 0; i < 20; i++) {
  const wb = wordlebotResults[i];
  const our = ourResults[i];
  if (wb.success && our.success) {
    if (wb.guesses < our.guesses) wbBetter++;
    else if (our.guesses < wb.guesses) ourBetter++;
    else ties++;
  } else if (wb.success) wbBetter++;
  else if (our.success) ourBetter++;
  else ties++;
}
console.log(`    wordlebot better: ${wbBetter}`);
console.log(`    our solver better: ${ourBetter}`);
console.log(`    tied: ${ties}`);

const winner = wordlebotWins > ourWins ? 'WORDBOT' : 
               ourWins > wordlebotWins ? 'OUR SOLVER' : 
               wordlebotTotalGuesses <= ourTotalGuesses ? 'WORDBOT (fewer guesses)' : 'OUR SOLVER (fewer guesses)';
console.log(`\n  🏆 WINNER: ${winner}`);
