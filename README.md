# ⚡ Quordle Solver Z-AI

An entropy-based Quordle solver powered by **Rust WebAssembly**, supporting all game modes.

## Features

- **Rust WASM Core**: Ultra-fast pattern matching and entropy computation compiled to WebAssembly
- **All Game Modes**: Daily, Daily Chill, Daily Extreme, Practice, Sequence, Weekly, Rescue
- **Entropy Algorithm**: Shannon entropy-based information gain optimization
- **Real Word Lists**: Extracted directly from Merriam-Webster's Quordle (~2,315 answers, ~10,657 allowed guesses)
- **No Dependencies**: Pure vanilla JS + WASM, no framework overhead

## How It Works

### Algorithm
The solver uses **Shannon entropy** to find the guess that maximizes expected information gain:

1. For each candidate guess, compute the pattern (G/Y/B) against all remaining possible answers
2. Group answers into buckets by pattern
3. Calculate entropy: `H = -Σ p(x) * log₂(p(x))`
4. Select the guess with highest entropy (most evenly distributed buckets = most information)

For Quordle's 4 boards, the algorithm scores each guess across **all active boards simultaneously**, prioritizing:
- High combined entropy across boards
- Solving boards when guesses are running low
- Minimizing worst-case remaining possibilities

### Pattern Computation
Words are encoded as `u32` (5 bits per letter) and patterns computed with bit operations for maximum speed. Pattern buckets use a `HashMap<u32, usize>` keyed by 2-bit-per-position encoded patterns.

## Game Modes

| Mode | Guesses | Description |
|------|---------|-------------|
| Daily | 9 | Standard daily Quordle |
| Daily Chill | 12 | More guesses, larger word bank |
| Daily Extreme | 8 | Fewer guesses, challenging words |
| Practice | 9 | Free play, random puzzles |
| Sequence | 10 | Letter clues revealed sequentially |
| Weekly | 9 | Weekly challenge puzzle |
| Rescue | 9 | Rescue mode |

## Setup

```bash
# Install Rust and wasm-pack
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
cargo install wasm-pack

# Build WASM
npm run build

# Start dev server
npm run dev
```

## Project Structure

```
quordle-solver-z-ai/
├── index.html          # Main UI
├── app.js              # Frontend logic
├── style.css           # Styling
├── quordle-wasm/       # Rust WASM solver
│   ├── src/lib.rs      # Core entropy algorithm
│   └── Cargo.toml
├── pkg/                # Compiled WASM output
├── wordbank-answers.txt    # ~2,315 answer words
├── wordbank-allowed.txt    # ~10,657 allowed guesses
├── wordbank-chill.txt      # Chill mode words
├── wordbank-extreme.txt    # Extreme mode words
└── quordle-source/     # Crawled Quordle source (reference)
```

## Algorithm Credits

Inspired by [wordlebot](https://github.com/ybenhayun/wordlebot) by ybenhayun, reimplemented in Rust with multi-board optimization for Quordle.

## License

MIT
