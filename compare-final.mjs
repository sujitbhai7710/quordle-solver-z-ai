// compare-final.mjs - 30-game comparison with word bank modes
import { QuordleSolver, get_pattern_string, initSync } from './pkg/quordle_solver.js';
import { readFileSync } from 'fs';

const wasmBytes = readFileSync('./pkg/quordle_solver_bg.wasm');
initSync(wasmBytes);

const answers = readFileSync('./wordbank-answers.txt', 'utf8').trim().split('\n');
const allowed = [...new Set([...answers, ...readFileSync('./wordbank-allowed.txt', 'utf8').trim().split('\n')])];
const solver = new QuordleSolver(answers, allowed);

// ============================================================
// JS WORDBOT (with recursive lookahead, same algorithm)
// ============================================================
function cp(g, a) {
  let r = Array(5).fill('B'), av = a.split(''), gv = g.split('');
  for (let i = 0; i < 5; i++) { if (gv[i] === av[i]) { r[i] = 'G'; av[i] = ' '; gv[i] = ' '; } }
  for (let i = 0; i < 5; i++) { if (gv[i] === ' ') continue; const j = av.indexOf(gv[i]); if (j !== -1) { r[i] = 'Y'; av[j] = ' '; } }
  return r.join('');
}

function bucketAdj(guess, possible) {
  const n = possible.length;
  if (n <= 1) return { adj: 0, solves: (n === 1 && possible[0] === guess) ? 1 : 0 };
  const buckets = {};
  for (const a of possible) { const p = cp(guess, a); buckets[p] = (buckets[p] || 0) + 1; }
  let w = 0, t3 = 1;
  for (const f of Object.values(buckets)) { w += (f / n) * f - ((f - 1) / n) * (f - 1); if (f > 1) t3 -= 1 / n; }
  return { adj: (1 - t3) * w, solves: possible.includes(guess) ? 1 : 0 };
}

function wbScoreInit(guess, boards) {
  const active = boards.filter(b => b.length > 1);
  if (!active.length) return -999;
  let ta = 0, ts = 0;
  for (const b of active) { const { adj, solves } = bucketAdj(guess, b); ta += adj; ts += solves; }
  return -ta / active.length + ts * 20;
}

function wbScoreDeep(guess, boards, samplePerBoard = 12) {
  const active = boards.filter(b => b.length > 1);
  if (!active.length) return -999;
  let worstRem = 0, totalRem = 0, branches = 0;
  for (const possible of active) {
    const step = Math.max(1, Math.floor(possible.length / samplePerBoard));
    for (let i = 0; i < possible.length && branches < samplePerBoard * active.length; i += step) {
      const simAnswer = possible[i];
      const pattern = cp(guess, simAnswer);
      let filtered = guess === simAnswer ? [guess] : possible.filter(w => cp(guess, w) === pattern);
      if (!filtered.includes(simAnswer)) filtered = [simAnswer];
      if (filtered.length > 1) {
        let bestFollow = filtered.length;
        const cands = filtered.length <= 20 ? filtered : filtered.slice(0, 10);
        for (const fc of cands) { const { adj } = bucketAdj(fc, filtered); bestFollow = Math.min(bestFollow, Math.ceil(adj) || 1); }
        totalRem += bestFollow;
        worstRem = Math.max(worstRem, bestFollow);
      }
      branches++;
    }
  }
  if (!branches) return -999;
  return -(totalRem / branches + worstRem * 0.5);
}

function wbGetBest(boards, guessesMade, topN = 5) {
  if (guessesMade === 0) return [{ word: 'SALET', score: 0 }];
  const active = boards.filter(b => b.length > 1);
  const total = active.reduce((s, b) => s + b.length, 0);
  if (total <= topN) {
    const seen = [];
    for (const b of active) for (const w of b) if (!seen.includes(w)) seen.push(w);
    return seen.slice(0, topN).map(w => ({ word: w, score: 0 }));
  }
  const candidates = [...new Set(boards.flat())];
  let scored = candidates.map(w => ({ word: w, score: wbScoreInit(w, boards) }))
    .filter(x => isFinite(x.score)).sort((a, b) => b.score - a.score);
  const lookAhead = scored.slice(0, 30);
  const deep = lookAhead.map(c => ({ word: c.word, score: wbScoreDeep(c.word, boards, 12) }))
    .sort((a, b) => b.score - a.score);
  const seen = new Set(); const final = [];
  for (const c of deep) { if (!seen.has(c.word)) { seen.add(c.word); final.push(c); } }
  for (const c of scored) { if (!seen.has(c.word) && final.length < topN * 3) { seen.add(c.word); final.push(c); } }
  return final.slice(0, topN);
}

// ============================================================
// GAME SIMULATION
// ============================================================
function simulate(targets, getBestFn, wordList, maxGuesses = 9) {
  let possible = targets.map(() => [...wordList]);
  let solved = [false, false, false, false];
  let guesses = [];

  for (let turn = 0; turn < maxGuesses; turn++) {
    const cands = getBestFn(possible, guesses.length, 5);
    let pick = null;
    for (const c of cands) { if (!guesses.includes(c.word)) { pick = c.word; break; } }
    if (!pick) {
      for (const b of possible) for (const w of b) if (!guesses.includes(w)) { pick = w; break; }
      if (!pick) break;
    }
    guesses.push(pick);

    for (let b = 0; b < 4; b++) {
      if (solved[b]) continue;
      if (pick === targets[b]) { solved[b] = true; possible[b] = [targets[b]]; continue; }
      const p = get_pattern_string(pick, targets[b]);
      const pa = p.split('').map(c => c === 'G' ? 2 : c === 'Y' ? 1 : 0);
      possible[b] = solver.filterByPattern(possible[b], pick, pa);
      // Fallback if restricted gives 0
      if (possible[b].length === 0 && wordList === answers) {
        possible[b] = solver.filterByPattern(allowed, pick, pa);
      }
      if (!possible[b].includes(targets[b])) possible[b] = [targets[b]];
      if (possible[b].length <= 1) solved[b] = true;
    }
    if (solved.every(s => s)) return { success: true, guesses: guesses.length };
  }
  return { success: false, guesses: guesses.length };
}

// ============================================================
// 30 PUZZLES
// ============================================================
const puzzles = [
  ["SWEAT","COLOR","CHUMP","BEAST"],["FLINT","SCOLD","TRUCK","TEACH"],
  ["KNEED","FEIGN","CURIO","PIETY"],["PLUSH","DRIED","BEIGE","VOICE"],
  ["TREAT","DUSKY","TYING","ALLAY"],["QUITE","ANGST","PILOT","CRIED"],
  ["MURKY","CLEAT","WHARF","HYENA"],["EXACT","MANOR","SLUSH","MUDDY"],
  ["GUILD","PLANK","SCRAM","SYNTH"],["BUGGY","ZILCH","BRAKE","PEONY"],
  ["GRAPH","FERRY","SHOWY","TRAIT"],["WHINY","FLUID","WINCE","SIXTH"],
  ["FACET","STEEL","VOWEL","MISTY"],["GLEAM","MIMIC","MAVEN","TROUT"],
  ["STING","FLAKE","MANGA","BROIL"],["CHORE","GORGE","VODKA","VOGUE"],
  ["FLUKE","BRIDE","MULCH","LUCKY"],["WORST","POLKA","CRACK","PLUMB"],
  ["SPURT","LOTTO","VIPER","ABODE"],["SHOUT","FLUME","JERKY","BEECH"],
  ["CIDER","BUDGE","STEEP","ADORE"],["SWUNG","WIELD","THIEF","TREAT"],
  ["FLASH","GORGE","CONIC","TAMER"],["SONIC","FUNGI","CORAL","PLUCK"],
  ["DIMLY","BUILT","FLUTE","GLORY"],["GHOUL","CURVE","TENTH","CHOMP"],
  ["FLOAT","CRICK","PICKY","BULKY"],["TIDAL","EXULT","MEATY","BRUNG"],
  ["AGLOW","PLUMP","FIEND","BLOKE"],["CUPID","QUILL","SCUBA","EBONY"],
];

// Test with third-party words (not in official Quordle bank)
const thirdPartyPuzzles = [
  ["JAZZY","FROZE","VEXED","QUICK"],
  ["WALTZ","JUMPY","BLIMP","CRWTH"],
  ["SPUNK","BLURB","FLUFF","SCRAM"],
];

console.log('═'.repeat(72));
console.log('  30-GAME TEST — RUST WASM (restricted+fallback) vs JS WORDBOT');
console.log('═'.repeat(72));

let wbW = 0, wbG = 0;
let ourW = 0, ourG = 0;
let wbRes = [], ourRes = [];

for (let i = 0; i < puzzles.length; i++) {
  const p = puzzles[i];
  process.stdout.write(`  ${String(i+1).padStart(2)}. [${p.join(',')}]  `);

  const t1 = performance.now();
  const wb = simulate(p, wbGetBest, answers, 9);
  const wbMs = performance.now() - t1;

  const t2 = performance.now();
  const our = simulate(p, (boards, gm, tn) => {
    const r = solver.getBestGuessesWithMode(boards, gm, tn, 'restricted');
    return Array.from(r).map(x => ({ word: x.word, score: x.score }));
  }, answers, 9);
  const ourMs = performance.now() - t2;

  wbRes.push(wb); ourRes.push(our);
  if (wb.success) { wbW++; wbG += wb.guesses; }
  if (our.success) { ourW++; ourG += our.guesses; }

  const w = wb.success && our.success
    ? (wb.guesses < our.guesses ? '← wb' : our.guesses < wb.guesses ? '← OURS' : 'tie')
    : wb.success ? '← wb' : our.success ? '← OURS' : 'X';
  console.log(`wb:${wb.success?wb.guesses+'✓':'X'}(${wbMs.toFixed(0)}ms) | our:${our.success?our.guesses+'✓':'X'}(${ourMs.toFixed(0)}ms) ${w}`);
}

console.log('\n' + '═'.repeat(72));
console.log('  OFFICIAL QUORDLE WORDS (30 games)');
console.log('═'.repeat(72));
const wbAvg = wbW > 0 ? (wbG / wbW).toFixed(2) : 'N/A';
const ourAvg = ourW > 0 ? (ourG / ourW).toFixed(2) : 'N/A';
console.log(`  JS Wordlebot: ${wbW}/30 wins | avg ${wbAvg}`);
console.log(`  Rust WASM:    ${ourW}/30 wins | avg ${ourAvg}`);

let better = 0, worse = 0, tie = 0;
for (let i = 0; i < 30; i++) {
  const w = wbRes[i], o = ourRes[i];
  if (w.success && o.success) { if (w.guesses < o.guesses) worse++; else if (o.guesses < w.guesses) better++; else tie++; }
  else if (w.success) worse++; else if (o.success) better++; else tie++;
}
console.log(`  H2H: wb:${worse} | our:${better} | tie:${tie}`);

// Test third-party words with fallback
console.log('\n' + '═'.repeat(72));
console.log('  THIRD-PARTY WORDS (fallback test)');
console.log('═'.repeat(72));

for (const p of thirdPartyPuzzles) {
  // Verify these words are NOT in the restricted list
  const inRestricted = p.every(w => answers.includes(w));
  console.log(`\n  [${p.join(', ')}] (in restricted: ${inRestricted})`);

  const our = simulate(p, (boards, gm, tn) => {
    const r = solver.getBestGuessesWithMode(boards, gm, tn, 'restricted');
    return Array.from(r).map(x => ({ word: x.word, score: x.score }));
  }, answers, 9);

  console.log(`    Rust WASM (restricted+fallback): ${our.success ? our.guesses + '✓' : 'X'}`);
}

console.log('\n' + '═'.repeat(72));
const champ = parseFloat(ourAvg) < parseFloat(wbAvg) ? '🏆 OUR RUST WASM SOLVER' :
              parseFloat(wbAvg) < parseFloat(ourAvg) ? '🏆 JS WORDBOT' : '🏆 TIE';
console.log(`  ${champ} (${ourAvg} vs ${wbAvg} avg on official words)`);
