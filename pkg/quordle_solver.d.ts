/* tslint:disable */
/* eslint-disable */

export class QuordleSolver {
    free(): void;
    [Symbol.dispose](): void;
    computePattern(guess: string, answer: string): Uint8Array;
    /**
     * Filter words by pattern, with fallback from restricted to all words
     */
    filterByPattern(words: string[], guess: string, pattern: Uint8Array): string[];
    /**
     * Filter with fallback: if restricted yields 0, try all words
     */
    filterWithFallback(restricted_words: string[], all_words: string[], guess: string, pattern: Uint8Array): string[];
    getBestGuessesWithMode(board_possibles: any, guesses_made: number, top_n: number, word_bank_mode: string): any;
    getFirstGuess(_mode: string): string;
    /**
     * Get best guesses with word bank mode
     * word_bank: "restricted" = only answer list, "complete" = all allowed words
     * Falls back to complete if restricted yields nothing
     */
    getQuickBestGuesses(board_possibles: any, guesses_made: number, top_n: number): any;
    constructor(answer_list: string[], allowed_list: string[]);
}

export function get_pattern_string(guess: string, answer: string): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly __wbg_quordlesolver_free: (a: number, b: number) => void;
    readonly get_pattern_string: (a: number, b: number, c: number, d: number) => [number, number];
    readonly quordlesolver_computePattern: (a: number, b: number, c: number, d: number, e: number) => [number, number];
    readonly quordlesolver_filterByPattern: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number];
    readonly quordlesolver_filterWithFallback: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => [number, number];
    readonly quordlesolver_getBestGuessesWithMode: (a: number, b: any, c: number, d: number, e: number, f: number) => any;
    readonly quordlesolver_getFirstGuess: (a: number, b: number, c: number) => [number, number];
    readonly quordlesolver_getQuickBestGuesses: (a: number, b: any, c: number, d: number) => any;
    readonly quordlesolver_new: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __externref_drop_slice: (a: number, b: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
