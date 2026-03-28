use wasm_bindgen::prelude::*;
use std::collections::HashMap;

fn encode_word(word: &str) -> u32 {
    let mut result: u32 = 0;
    for (i, b) in word.bytes().enumerate() {
        result |= ((b - b'A') as u32) << (i * 5);
    }
    result
}

fn decode_word(encoded: u32) -> String {
    (0..5u32)
        .map(|i| (b'A' + ((encoded >> (i * 5)) & 0x1F) as u8) as char)
        .collect()
}

fn compute_pattern(guess: u32, answer: u32) -> u32 {
    let mut pattern: u32 = 0;
    let mut answer_rem = answer;
    let mut guess_rem = guess;

    for i in 0..5u32 {
        let g = (guess >> (i * 5)) & 0x1F;
        let a = (answer >> (i * 5)) & 0x1F;
        if g == a {
            pattern |= 2 << (i * 2);
            answer_rem &= !(0x1F << (i * 5));
            guess_rem &= !(0x1F << (i * 5));
        }
    }
    for i in 0..5u32 {
        let g = (guess_rem >> (i * 5)) & 0x1F;
        if g == 0 { continue; }
        for j in 0..5u32 {
            let a = (answer_rem >> (j * 5)) & 0x1F;
            if a == g {
                pattern |= 1 << (i * 2);
                answer_rem &= !(0x1F << (j * 5));
                break;
            }
        }
    }
    pattern
}

fn bucket_adjusted(guess: u32, possible: &[u32]) -> (f64, usize) {
    let n = possible.len() as f64;
    if n <= 1.0 {
        return (0.0, if n == 1.0 && possible[0] == guess { 1 } else { 0 });
    }
    let mut buckets: HashMap<u32, usize> = HashMap::new();
    for &a in possible {
        *buckets.entry(compute_pattern(guess, a)).or_insert(0) += 1;
    }
    let mut weighted: f64 = 0.0;
    let mut threes: f64 = 1.0;
    for &freq in buckets.values() {
        let f = freq as f64;
        weighted += (f / n) * f - ((f - 1.0) / n) * (f - 1.0);
        if freq > 1 { threes -= 1.0 / n; }
    }
    ((1.0 - threes) * weighted, if possible.contains(&guess) { 1 } else { 0 })
}

fn score_initial(guess: u32, boards: &[Vec<u32>]) -> f64 {
    let active: Vec<&Vec<u32>> = boards.iter().filter(|b| b.len() > 1).collect();
    if active.is_empty() { return -999.0; }
    let n = active.len() as f64;
    let mut total_adj = 0.0;
    let mut total_solves = 0usize;
    for &b in &active {
        let (adj, solves) = bucket_adjusted(guess, b);
        total_adj += adj;
        total_solves += solves;
    }
    -total_adj / n + (total_solves as f64) * 20.0
}

fn score_recursive(guess: u32, boards: &[Vec<u32>], answer_pool: &[u32], max_samples: usize) -> f64 {
    let active: Vec<(usize, &Vec<u32>)> = boards.iter()
        .enumerate()
        .filter(|(_, b)| b.len() > 1)
        .collect();
    if active.is_empty() { return -999.0; }

    let mut worst_remaining: usize = 0;
    let mut total_remaining: f64 = 0.0;
    let mut branch_count: usize = 0;

    for &(_, possible) in &active {
        let step = if possible.len() > max_samples { possible.len() / max_samples } else { 1 };
        for i in (0..possible.len()).step_by(step).take(max_samples) {
            let sim_answer = possible[i];
            let pattern = compute_pattern(guess, sim_answer);

            let mut filtered: Vec<u32> = if guess == sim_answer {
                vec![guess]
            } else {
                possible.iter().filter(|&&w| compute_pattern(guess, w) == pattern).copied().collect()
            };
            if !filtered.contains(&sim_answer) { filtered = vec![sim_answer]; }

            if filtered.len() > 1 {
                let mut best_follow = filtered.len();
                let cands: Vec<u32> = if filtered.len() <= 20 {
                    filtered.clone()
                } else {
                    filtered.iter().take(10).copied().collect()
                };
                for &fc in &cands {
                    let (adj, _) = bucket_adjusted(fc, &filtered);
                    best_follow = best_follow.min((adj.ceil() as usize).max(1));
                }
                total_remaining += best_follow as f64;
                worst_remaining = worst_remaining.max(best_follow);
            }
            branch_count += 1;
        }
    }
    if branch_count == 0 { return -999.0; }
    -(total_remaining / branch_count as f64 + worst_remaining as f64 * 0.5)
}

#[wasm_bindgen]
pub struct QuordleSolver {
    answer_words: Vec<u32>,
    allowed_words: Vec<u32>,
}

#[wasm_bindgen]
impl QuordleSolver {
    #[wasm_bindgen(constructor)]
    pub fn new(answer_list: Vec<String>, allowed_list: Vec<String>) -> QuordleSolver {
        QuordleSolver {
            answer_words: answer_list.iter().map(|w| encode_word(&w.to_uppercase())).collect(),
            allowed_words: allowed_list.iter().map(|w| encode_word(&w.to_uppercase())).collect(),
        }
    }

    /// Get best guesses with word bank mode
    /// word_bank: "restricted" = only answer list, "complete" = all allowed words
    /// Falls back to complete if restricted yields nothing
    #[wasm_bindgen(js_name = "getQuickBestGuesses")]
    pub fn get_quick_best_guesses(
        &self,
        board_possibles: JsValue,
        guesses_made: usize,
        top_n: usize,
    ) -> JsValue {
        self.get_best_with_mode(board_possibles, guesses_made, top_n, "restricted")
    }

    #[wasm_bindgen(js_name = "getBestGuessesWithMode")]
    pub fn get_best_with_mode(
        &self,
        board_possibles: JsValue,
        guesses_made: usize,
        top_n: usize,
        word_bank_mode: &str,
    ) -> JsValue {
        let boards_str: Vec<Vec<String>> = serde_wasm_bindgen::from_value(board_possibles).unwrap_or_default();
        let encoded: Vec<Vec<u32>> = boards_str.iter()
            .map(|b| b.iter().map(|w| encode_word(w)).collect())
            .collect();

        if guesses_made == 0 {
            return self.make_result_array(&["SALET", "CRANE", "SLATE", "TRACE", "AROSE"][..top_n.min(5)]);
        }

        let active: Vec<&Vec<u32>> = encoded.iter().filter(|b| b.len() > 1).collect();
        let total_remaining: usize = active.iter().map(|b| b.len()).sum();

        if total_remaining <= top_n {
            let arr = js_sys::Array::new();
            let mut seen = Vec::new();
            for b in &active {
                for &w in *b {
                    if !seen.contains(&w) {
                        seen.push(w);
                        let obj = js_sys::Object::new();
                        js_sys::Reflect::set(&obj, &"word".into(), &decode_word(w).as_str().into()).unwrap();
                        js_sys::Reflect::set(&obj, &"score".into(), &0.0.into()).unwrap();
                        arr.push(&obj);
                    }
                }
            }
            return arr.into();
        }

        // Build candidates based on word bank mode
        let restricted_candidates: Vec<u32> = self.answer_words.clone();
        let mut all_candidates: Vec<u32> = self.answer_words.clone();
        for &w in &self.allowed_words {
            if !all_candidates.contains(&w) { all_candidates.push(w); }
        }

        // Determine which candidate list to use
        // If mode is "restricted", try restricted first; if results are poor, fall back to all
        let use_restricted = word_bank_mode == "restricted";

        // Score with restricted list first
        let candidates = if use_restricted {
            &restricted_candidates
        } else {
            &all_candidates
        };

        let mut scored: Vec<(u32, f64)> = candidates.iter()
            .map(|&g| (g, score_initial(g, &encoded)))
            .filter(|(_, s)| s.is_finite())
            .collect();
        scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap());

        // If restricted list gave too few results, supplement with all words
        if use_restricted && scored.len() < top_n * 2 {
            let mut extra: Vec<(u32, f64)> = all_candidates.iter()
                .filter(|w| !scored.iter().any(|(s, _)| s == *w))
                .map(|&g| (g, score_initial(g, &encoded)))
                .filter(|(_, s)| s.is_finite())
                .collect();
            extra.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap());
            scored.extend(extra);
        }

        // Recursive lookahead on top candidates
        let look_ahead = 30.min(scored.len());
        let sample_per_board = 12;

        let mut deep_scored: Vec<(u32, f64)> = scored[..look_ahead].iter()
            .map(|&(g, _)| (g, score_recursive(g, &encoded, &self.answer_words, sample_per_board)))
            .collect();
        deep_scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap());

        // Merge
        let mut final_list: Vec<(u32, f64)> = Vec::new();
        let mut seen: Vec<u32> = Vec::new();
        for &(w, s) in &deep_scored {
            if !seen.contains(&w) { seen.push(w); final_list.push((w, s)); }
        }
        for &(w, s) in &scored {
            if !seen.contains(&w) && final_list.len() < top_n * 3 {
                seen.push(w);
                final_list.push((w, s));
            }
        }

        let arr = js_sys::Array::new();
        for (word, score) in final_list.iter().take(top_n.min(20)) {
            let obj = js_sys::Object::new();
            js_sys::Reflect::set(&obj, &"word".into(), &decode_word(*word).as_str().into()).unwrap();
            js_sys::Reflect::set(&obj, &"score".into(), &(*score).into()).unwrap();
            arr.push(&obj);
        }
        arr.into()
    }

    /// Filter words by pattern, with fallback from restricted to all words
    #[wasm_bindgen(js_name = "filterByPattern")]
    pub fn filter_by_pattern(&self, words: Vec<String>, guess: &str, pattern: Vec<u8>) -> Vec<String> {
        let g = encode_word(&guess.to_uppercase());
        let pk: u32 = pattern.iter().enumerate().map(|(i, &p)| (p as u32) << (i * 2)).sum();
        words.into_iter().filter(|w| compute_pattern(g, encode_word(w)) == pk).collect()
    }

    /// Filter with fallback: if restricted yields 0, try all words
    #[wasm_bindgen(js_name = "filterWithFallback")]
    pub fn filter_with_fallback(
        &self,
        restricted_words: Vec<String>,
        all_words: Vec<String>,
        guess: &str,
        pattern: Vec<u8>,
    ) -> Vec<String> {
        let g = encode_word(&guess.to_uppercase());
        let pk: u32 = pattern.iter().enumerate().map(|(i, &p)| (p as u32) << (i * 2)).sum();

        // Try restricted first
        let filtered: Vec<String> = restricted_words.into_iter()
            .filter(|w| compute_pattern(g, encode_word(w)) == pk)
            .collect();

        // If restricted gave results, return them
        if !filtered.is_empty() {
            return filtered;
        }

        // Fallback to all words
        all_words.into_iter()
            .filter(|w| compute_pattern(g, encode_word(w)) == pk)
            .collect()
    }

    #[wasm_bindgen(js_name = "computePattern")]
    pub fn compute_pattern_js(&self, guess: &str, answer: &str) -> Vec<u8> {
        let p = compute_pattern(encode_word(&guess.to_uppercase()), encode_word(&answer.to_uppercase()));
        (0..5).map(|i| ((p >> (i * 2)) & 0x3) as u8).collect()
    }

    #[wasm_bindgen(js_name = "getFirstGuess")]
    pub fn get_first_guess(&self, _mode: &str) -> String { "SALET".to_string() }
}

impl QuordleSolver {
    fn make_result_array(&self, words: &[&str]) -> JsValue {
        let arr = js_sys::Array::new();
        for &w in words {
            let obj = js_sys::Object::new();
            js_sys::Reflect::set(&obj, &"word".into(), &w.to_string().into()).unwrap();
            js_sys::Reflect::set(&obj, &"score".into(), &0.0.into()).unwrap();
            arr.push(&obj);
        }
        arr.into()
    }
}

#[wasm_bindgen]
pub fn get_pattern_string(guess: &str, answer: &str) -> String {
    let p = compute_pattern(encode_word(&guess.to_uppercase()), encode_word(&answer.to_uppercase()));
    (0..5).map(|i| match (p >> (i * 2)) & 0x3 { 2 => 'G', 1 => 'Y', _ => 'B' }).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn test_roundtrip() {
        assert_eq!(decode_word(encode_word("SALET")), "SALET");
    }
    #[test]
    fn test_pattern() {
        let p = compute_pattern(encode_word("CRANE"), encode_word("TRACE"));
        assert_eq!((p >> 0) & 3, 1);
        assert_eq!((p >> 2) & 3, 2);
        assert_eq!((p >> 4) & 3, 2);
        assert_eq!((p >> 6) & 3, 0);
        assert_eq!((p >> 8) & 3, 2);
    }
}
