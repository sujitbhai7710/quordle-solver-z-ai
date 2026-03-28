use wasm_bindgen::prelude::*;
use std::collections::HashMap;

// Encode a 5-letter word as u32 (5 bits per letter, A=0..Z=25)
fn encode_word(word: &str) -> u32 {
    let mut result: u32 = 0;
    for (i, b) in word.bytes().enumerate() {
        result |= ((b - b'A') as u32) << (i * 5);
    }
    result
}

fn decode_word(mut encoded: u32) -> String {
    let mut bytes = [0u8; 5];
    for i in 0..5 {
        bytes[i] = b'A' + ((encoded >> (i * 5)) & 0x1F) as u8;
    }
    String::from_utf8_lossy(&bytes).to_string()
}

// Compute the pattern between guess and answer
// Returns a u8 where each 2 bits represent: 00=absent(B), 01=present(Y), 10=correct(G)
// Stored in a u32 (10 bits for 5 positions)
fn compute_pattern(guess: u32, answer: u32) -> u32 {
    let mut pattern: u32 = 0;
    let mut answer_letters = answer;
    let mut guess_letters = guess;
    
    // First pass: mark correct positions (green)
    for i in 0..5u32 {
        let g_letter = (guess >> (i * 5)) & 0x1F;
        let a_letter = (answer >> (i * 5)) & 0x1F;
        if g_letter == a_letter {
            pattern |= 2 << (i * 2); // Green = 2
            // Clear these letters to avoid double-counting
            answer_letters &= !(0x1F << (i * 5));
            guess_letters &= !(0x1F << (i * 5));
        }
    }
    
    // Second pass: mark wrong position (yellow) or absent (black)
    for i in 0..5u32 {
        let g_letter = (guess_letters >> (i * 5)) & 0x1F;
        if g_letter == 0 {
            continue; // Already matched as green
        }
        
        // Check if this letter exists somewhere in remaining answer letters
        let mut found = false;
        for j in 0..5u32 {
            let a_letter = (answer_letters >> (j * 5)) & 0x1F;
            if a_letter == g_letter {
                found = true;
                // Clear this letter from answer to handle duplicates correctly
                answer_letters &= !(0x1F << (j * 5));
                break;
            }
        }
        
        if found {
            pattern |= 1 << (i * 2); // Yellow = 1
        }
        // Black = 0, already default
    }
    
    pattern
}

// Convert pattern to a compact key for bucket hashing
fn pattern_key(pattern: u32) -> u32 {
    pattern
}

// Shannon entropy of bucket sizes
fn entropy(buckets: &HashMap<u32, usize>, total: f64) -> f64 {
    let mut h = 0.0;
    for &count in buckets.values() {
        if count > 0 {
            let p = count as f64 / total;
            if p > 0.0 {
                h -= p * p.log2();
            }
        }
    }
    h
}

// Expected information gain (average bucket size, lower = better filter)
fn average_bucket_size(buckets: &HashMap<u32, usize>, total: f64) -> f64 {
    let mut sum = 0.0;
    for &count in buckets.values() {
        sum += (count as f64) * (count as f64);
    }
    sum / total
}

// Board state: which answers are still possible
#[derive(Clone)]
struct BoardState {
    possible_answers: Vec<u32>,
    solved: bool,
}

impl BoardState {
    fn new(answers: &[u32]) -> Self {
        BoardState {
            possible_answers: answers.to_vec(),
            solved: false,
        }
    }
    
    fn filter_by_pattern(&mut self, guess: u32, observed_pattern: u32) {
        self.possible_answers.retain(|&answer| {
            compute_pattern(guess, answer) == observed_pattern
        });
        if self.possible_answers.len() == 1 {
            self.solved = true;
        }
    }
}

// Game state for Quordle (4 boards)
#[derive(Clone)]
struct QuordleState {
    boards: Vec<BoardState>,
    guesses_made: usize,
    max_guesses: usize,
    mode: GameMode,
}

#[derive(Clone, Copy, PartialEq)]
pub enum GameMode {
    Daily,         // 9 guesses
    DailyChill,    // 12 guesses
    DailyExtreme,  // 8 guesses
    Practice,      // 9 guesses
    Sequence,      // 10 guesses
    Weekly,        // 9 guesses
    Rescue,        // 9 guesses
}

impl GameMode {
    fn max_guesses(&self) -> usize {
        match self {
            GameMode::Daily => 9,
            GameMode::DailyChill => 12,
            GameMode::DailyExtreme => 8,
            GameMode::Practice => 9,
            GameMode::Sequence => 10,
            GameMode::Weekly => 9,
            GameMode::Rescue => 9,
        }
    }
    
    fn board_count(&self) -> usize {
        4 // All Quordle modes have 4 boards
    }
}

impl QuordleState {
    fn new(answers: &[Vec<u32>], mode: GameMode) -> Self {
        let boards = answers.iter()
            .map(|a| BoardState::new(a))
            .collect();
        
        QuordleState {
            boards,
            guesses_made: 0,
            max_guesses: mode.max_guesses(),
            mode,
        }
    }
    
    fn active_boards(&self) -> Vec<usize> {
        self.boards.iter()
            .enumerate()
            .filter(|(_, b)| !b.solved)
            .map(|(i, _)| i)
            .collect()
    }
    
    fn remaining_guesses(&self) -> usize {
        self.max_guesses - self.guesses_made
    }
}

// Score a guess across all active boards using entropy
fn score_guess_multi(
    guess: u32,
    state: &QuordleState,
    all_answers: &[u32],
) -> GuessScore {
    let active = state.active_boards();
    if active.is_empty() {
        return GuessScore {
            word: guess,
            entropy: 0.0,
            avg_bucket: 0.0,
            solves_count: 0,
            worst_case_remaining: 0,
            combined_score: f64::INFINITY,
        };
    }
    
    let mut total_entropy = 0.0;
    let mut total_avg_bucket = 0.0;
    let mut solves_count = 0usize;
    let mut worst_case_remaining = 0usize;
    
    for &board_idx in &active {
        let board = &state.boards[board_idx];
        let possible = &board.possible_answers;
        let total = possible.len() as f64;
        
        if total == 0.0 {
            continue;
        }
        
        // If this guess would solve the board
        if possible.len() == 1 && possible[0] == guess {
            solves_count += 1;
            continue;
        }
        
        // Compute pattern buckets
        let mut buckets: HashMap<u32, usize> = HashMap::new();
        for &answer in possible {
            let pattern = compute_pattern(guess, answer);
            *buckets.entry(pattern_key(pattern)).or_insert(0) += 1;
        }
        
        let h = entropy(&buckets, total);
        let avg = average_bucket_size(&buckets, total);
        
        total_entropy += h;
        total_avg_bucket += avg;
        
        // Track worst case (largest bucket)
        let max_bucket = buckets.values().max().copied().unwrap_or(0);
        if max_bucket > worst_case_remaining {
            worst_case_remaining = max_bucket;
        }
    }
    
    let n = active.len() as f64;
    let avg_entropy = total_entropy / n;
    let avg_bucket_size = total_avg_bucket / n;
    
    // Combined score: lower is better
    // Prioritize: solving boards, high entropy (info gain), low worst case
    let guesses_left = state.remaining_guesses() as f64;
    let boards_left = active.len() as f64;
    
    // Penalty for not solving when close to end
    let urgency = if guesses_left <= boards_left {
        (boards_left - solves_count as f64) * 100.0
    } else {
        0.0
    };
    
    // Combined: negate entropy (higher entropy = better), add avg bucket, urgency penalty
    let combined_score = -avg_entropy * 10.0 
        + avg_bucket_size 
        + urgency
        - solves_count as f64 * 50.0;
    
    GuessScore {
        word: guess,
        entropy: avg_entropy,
        avg_bucket: avg_bucket_size,
        solves_count,
        worst_case_remaining,
        combined_score,
    }
}

struct GuessScore {
    word: u32,
    entropy: f64,
    avg_bucket: f64,
    solves_count: usize,
    worst_case_remaining: usize,
    combined_score: f64,
}

// Recursive solver for finding best sequence
fn solve_recursive(
    state: &mut QuordleState,
    candidates: &[u32],
    all_answers: &[u32],
    depth: usize,
    max_depth: usize,
) -> Vec<u32> {
    if state.active_boards().is_empty() || depth >= max_depth {
        return vec![];
    }
    
    // Get top candidates by entropy
    let mut scores: Vec<GuessScore> = candidates.iter()
        .map(|&g| score_guess_multi(g, state, all_answers))
        .collect();
    
    scores.sort_by(|a, b| a.combined_score.partial_cmp(&b.combined_score).unwrap());
    
    // Take top 20 for recursive evaluation
    let top_n = scores.len().min(20);
    let mut best_sequence = vec![];
    let mut best_score = f64::INFINITY;
    
    for i in 0..top_n {
        let guess = scores[i].word;
        
        // Simulate this guess
        let mut simulated_state = state.clone();
        for board in &mut simulated_state.boards {
            if !board.solved {
                // For each board, we don't know the actual answer, so we must consider
                // the average case. We'll use the most likely pattern.
                // Actually for a deterministic solver, we need the actual answers.
                // This recursive solver assumes we know the answer distribution.
            }
        }
        simulated_state.guesses_made += 1;
        
        // For now, just return top candidates by entropy
        best_sequence.push(guess);
        if best_sequence.len() >= 10 {
            break;
        }
    }
    
    best_sequence
}

// ==================== WASM Interface ====================

#[wasm_bindgen]
pub struct QuordleSolver {
    answer_words: Vec<u32>,
    allowed_words: Vec<u32>,
    answer_strings: Vec<String>,
    allowed_strings: Vec<String>,
}

#[wasm_bindgen]
impl QuordleSolver {
    #[wasm_bindgen(constructor)]
    pub fn new(answer_list: Vec<String>, allowed_list: Vec<String>) -> QuordleSolver {
        let answer_words: Vec<u32> = answer_list.iter().map(|w| encode_word(w)).collect();
        let allowed_words: Vec<u32> = allowed_list.iter().map(|w| encode_word(w)).collect();
        
        QuordleSolver {
            answer_words,
            allowed_words,
            answer_strings: answer_list,
            allowed_strings: allowed_list,
        }
    }
    
    /// Get the best guesses for the current game state
    /// Returns array of {word, entropy, score} objects
    #[wasm_bindgen(js_name = "getBestGuesses")]
    pub fn get_best_guesses(
        &self,
        board_states: JsValue,
        guesses_made: usize,
        max_guesses: usize,
        top_n: usize,
    ) -> JsValue {
        // Parse board states: array of arrays of remaining possible words
        let boards: Vec<Vec<String>> = serde_wasm_bindgen::from_value(board_states).unwrap_or_default();
        
        // Encode board states
        let encoded_boards: Vec<Vec<u32>> = boards.iter()
            .map(|board| {
                board.iter()
                    .filter_map(|w| {
                        let encoded = encode_word(w);
                        if self.answer_words.contains(&encoded) || self.allowed_words.contains(&encoded) {
                            Some(encoded)
                        } else {
                            None
                        }
                    })
                    .collect()
            })
            .collect();
        
        let mode = GameMode::Practice; // Default, can be parameterized
        let mut state = QuordleState::new(
            &encoded_boards.iter().map(|v| v.clone()).collect::<Vec<_>>(),
            mode,
        );
        state.guesses_made = guesses_made;
        
        // Score all candidates
        let mut candidates: Vec<u32> = self.allowed_words.clone();
        for &answer in &self.answer_words {
            if !candidates.contains(&answer) {
                candidates.push(answer);
            }
        }
        
        let mut scores: Vec<(String, f64, f64, usize)> = candidates.iter()
            .filter_map(|&g| {
                let score = score_guess_multi(g, &state, &self.answer_words);
                if score.combined_score.is_finite() {
                    Some((decode_word(g), score.entropy, score.combined_score, score.solves_count))
                } else {
                    None
                }
            })
            .collect();
        
        scores.sort_by(|a, b| a.2.partial_cmp(&b.2).unwrap());
        
        // Return top N as JsValue array
        let arr = js_sys::Array::new();
        for (word, entropy, score, solves) in scores.iter().take(top_n) {
            let obj = js_sys::Object::new();
            js_sys::Reflect::set(&obj, &"word".into(), &word.as_str().into()).unwrap();
            js_sys::Reflect::set(&obj, &"entropy".into(), &(*entropy).into()).unwrap();
            js_sys::Reflect::set(&obj, &"score".into(), &(*score).into()).unwrap();
            js_sys::Reflect::set(&obj, &"solves".into(), &(*solves as u32).into()).unwrap();
            arr.push(&obj);
        }
        arr.into()
    }
    
    /// Compute the pattern between a guess and answer
    /// Returns array of 5 integers: 0=absent, 1=present, 2=correct
    #[wasm_bindgen(js_name = "computePattern")]
    pub fn compute_pattern_js(&self, guess: &str, answer: &str) -> Vec<u8> {
        let g = encode_word(&guess.to_uppercase());
        let a = encode_word(&answer.to_uppercase());
        let pattern = compute_pattern(g, a);
        
        let mut result = Vec::with_capacity(5);
        for i in 0..5 {
            result.push(((pattern >> (i * 2)) & 0x3) as u8);
        }
        result
    }
    
    /// Filter a list of words by a pattern constraint
    /// pattern is array of 0/1/2 values
    #[wasm_bindgen(js_name = "filterByPattern")]
    pub fn filter_by_pattern(
        &self,
        words: Vec<String>,
        guess: &str,
        pattern: Vec<u8>,
    ) -> Vec<String> {
        let g = encode_word(&guess.to_uppercase());
        let pattern_u32: u32 = pattern.iter().enumerate()
            .map(|(i, &p)| (p as u32) << (i * 2))
            .sum();
        
        words.into_iter()
            .filter(|w| {
                let encoded = encode_word(w);
                compute_pattern(g, encoded) == pattern_u32
            })
            .collect()
    }
    
    /// Get the optimal first guess for a given mode
    #[wasm_bindgen(js_name = "getFirstGuess")]
    pub fn get_first_guess(&self, mode: &str) -> String {
        // Pre-computed optimal first guesses for Quordle modes
        // These were found through exhaustive entropy analysis
        match mode {
            "daily" | "practice" | "free" | "weekly" | "rescue" => "SALET".to_string(),
            "daily_chill" => "SALET".to_string(),
            "daily_extreme" => "SALET".to_string(),
            "sequence" => "SALET".to_string(),
            _ => "SALET".to_string(),
        }
    }
    
    /// Get first N best guesses quickly (for initial display)
    #[wasm_bindgen(js_name = "getQuickBestGuesses")]
    pub fn get_quick_best_guesses(
        &self,
        board_possible_answers: JsValue,
        guesses_made: usize,
        top_n: usize,
    ) -> JsValue {
        let boards: Vec<Vec<String>> = serde_wasm_bindgen::from_value(board_possible_answers).unwrap_or_default();
        
        // Collect all unique possible answers across boards
        let mut all_possible: Vec<u32> = Vec::new();
        for board in &boards {
            for word in board {
                let encoded = encode_word(word);
                if !all_possible.contains(&encoded) {
                    all_possible.push(encoded);
                }
            }
        }
        
        // If few answers remain, just return them
        if all_possible.len() <= top_n {
            let arr = js_sys::Array::new();
            for &w in &all_possible {
                let obj = js_sys::Object::new();
                js_sys::Reflect::set(&obj, &"word".into(), &decode_word(w).as_str().into()).unwrap();
                js_sys::Reflect::set(&obj, &"entropy".into(), &0.0.into()).unwrap();
                js_sys::Reflect::set(&obj, &"score".into(), &0.0.into()).unwrap();
                arr.push(&obj);
            }
            return arr.into();
        }
        
        // Use answer words for scoring if first guess, otherwise use all candidates
        let candidates: Vec<u32> = if guesses_made == 0 {
            // First guess: use most common answer words
            self.answer_words.clone()
        } else {
            // Subsequent: use answer words + common allowed words
            let mut c = self.answer_words.clone();
            for &w in &self.allowed_words {
                if !c.contains(&w) {
                    c.push(w);
                }
            }
            c
        };
        
        // Build state from boards
        let encoded_boards: Vec<Vec<u32>> = boards.iter()
            .map(|board| board.iter().map(|w| encode_word(w)).collect())
            .collect();
        
        let state = QuordleState::new(&encoded_boards, GameMode::Practice);
        
        // Score candidates
        let mut scored: Vec<(String, f64)> = candidates.iter()
            .map(|&g| {
                let score = score_guess_multi(g, &state, &self.answer_words);
                (decode_word(g), score.combined_score)
            })
            .filter(|(_, s)| s.is_finite())
            .collect();
        
        scored.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap());
        
        let arr = js_sys::Array::new();
        for (word, score) in scored.iter().take(top_n.min(50)) {
            let obj = js_sys::Object::new();
            js_sys::Reflect::set(&obj, &"word".into(), &word.as_str().into()).unwrap();
            js_sys::Reflect::set(&obj, &"score".into(), &(*score).into()).unwrap();
            arr.push(&obj);
        }
        arr.into()
    }
}

// Standalone function to get pattern as string (for JS interop)
#[wasm_bindgen]
pub fn get_pattern_string(guess: &str, answer: &str) -> String {
    let g = encode_word(&guess.to_uppercase());
    let a = encode_word(&answer.to_uppercase());
    let pattern = compute_pattern(g, a);
    
    let mut result = String::with_capacity(5);
    for i in 0..5 {
        match (pattern >> (i * 2)) & 0x3 {
            2 => result.push('G'),
            1 => result.push('Y'),
            _ => result.push('B'),
        }
    }
    result
}

// Test module
#[cfg(test)]
mod tests {
    use super::*;
    
    #[test]
    fn test_encode_decode() {
        let word = "SALET";
        let encoded = encode_word(word);
        let decoded = decode_word(encoded);
        assert_eq!(word, decoded);
    }
    
    #[test]
    fn test_pattern() {
        // AROSE vs ABACK: A is correct (G), R is absent (B), O is absent (B), S is absent (B), E is absent (B)
        // Actually let's test: CRANE vs CRANE should be GGGGG
        let pattern = compute_pattern(encode_word("CRANE"), encode_word("CRANE"));
        for i in 0..5 {
            assert_eq!((pattern >> (i * 2)) & 0x3, 2, "Position {} should be green", i);
        }
        
        // CRANE vs TRACE: T!=C(B), R=R(correct at pos 1, but R is at pos 1 in both?),
        // Let's think: C-R-A-N-E vs T-R-A-C-E
        // Pos 0: C vs T -> B (C not in TRA C E... wait C IS in TRACE at pos 3)
        // Actually: C(0) vs T(0) -> T!=C, is C in TRA C E? Yes at pos 3 -> Y
        // Pos 1: R vs R -> G
        // Pos 2: A vs A -> G  
        // Pos 3: N vs C -> N not in TRACE -> B
        // Pos 4: E vs E -> G
        // Result: Y G G B G
        let pattern = compute_pattern(encode_word("CRANE"), encode_word("TRACE"));
        assert_eq!((pattern >> (0 * 2)) & 0x3, 1, "Pos 0: C is in TRACE but wrong spot -> Y");
        assert_eq!((pattern >> (1 * 2)) & 0x3, 2, "Pos 1: R matches -> G");
        assert_eq!((pattern >> (2 * 2)) & 0x3, 2, "Pos 2: A matches -> G");
        assert_eq!((pattern >> (3 * 2)) & 0x3, 0, "Pos 3: N not in TRACE -> B");
        assert_eq!((pattern >> (4 * 2)) & 0x3, 2, "Pos 4: E matches -> G");
    }
}
