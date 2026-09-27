/* tslint:disable */
/* eslint-disable */

/**
 * JS: `optilotus_add(a, b) -> number`
 */
export function optilotus_add(a: bigint, b: bigint): bigint;

/**
 * JS: `optilotus_empty_program() -> string` (JSON)
 */
export function optilotus_empty_program(): string;

/**
 * JS: `optilotus_health() -> string` ("ok")
 */
export function optilotus_health(): string;

/**
 * JS: `optilotus_run_empty() -> string` (JSON result)
 */
export function optilotus_run_empty(): string;

/**
 * JS: `optilotus_version() -> string`
 */
export function optilotus_version(): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly optilotus_add: (a: bigint, b: bigint) => bigint;
    readonly optilotus_empty_program: () => [number, number];
    readonly optilotus_health: () => [number, number];
    readonly optilotus_run_empty: () => [number, number];
    readonly optilotus_version: () => [number, number];
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
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
