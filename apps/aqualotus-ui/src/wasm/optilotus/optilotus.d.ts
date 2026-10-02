/* tslint:disable */
/* eslint-disable */

/**
 * JS: `optilotus_add(a, b) -> bigint`
 */
export function optilotus_add(a: bigint, b: bigint): bigint;

/**
 * JS: `optilotus_clear() -> string` (JSON)
 */
export function optilotus_clear(): string;

/**
 * JS: `optilotus_emptyProgram() -> string` (JSON)
 */
export function optilotus_emptyProgram(): string;

/**
 * JS: `optilotus_execMath(expr) -> string` (JSON)
 */
export function optilotus_execMath(expr: string): string;

/**
 * JS: `optilotus_get(name) -> string` (JSON)
 */
export function optilotus_get(name: string): string;

/**
 * JS: `optilotus_health() -> string` ("ok")
 */
export function optilotus_health(): string;

/**
 * JS: `optilotus_print(template) -> string` (JSON)
 */
export function optilotus_print(template: string): string;

/**
 * JS: `optilotus_runEmpty() -> string` (JSON result)
 */
export function optilotus_runEmpty(): string;

/**
 * JS: `optilotus_runFunction(functionJson) -> string` (JSON report)
 */
export function optilotus_runFunction(input: string): string;

/**
 * JS: `optilotus_set(name, ty, value) -> string` (JSON)
 */
export function optilotus_set(name: string, ty: string, text: string): string;

/**
 * JS: `optilotus_version() -> string`
 */
export function optilotus_version(): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly optilotus_add: (a: bigint, b: bigint) => bigint;
    readonly optilotus_clear: () => [number, number];
    readonly optilotus_emptyProgram: () => [number, number];
    readonly optilotus_execMath: (a: number, b: number) => [number, number];
    readonly optilotus_get: (a: number, b: number) => [number, number];
    readonly optilotus_health: () => [number, number];
    readonly optilotus_print: (a: number, b: number) => [number, number];
    readonly optilotus_runEmpty: () => [number, number];
    readonly optilotus_runFunction: (a: number, b: number) => [number, number];
    readonly optilotus_set: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
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
