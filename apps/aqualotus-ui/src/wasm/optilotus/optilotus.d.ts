/* tslint:disable */
/* eslint-disable */

/**
 * JS: `optilotus_assign(fid, name, expr) -> string` (JSON)
 */
export function optilotus_assign(fid: number, name: string, expr: string): string;

/**
 * JS: `optilotus_clear() -> string` (JSON)
 */
export function optilotus_clear(): string;

/**
 * JS: `optilotus_clearPackage() -> string` (JSON)
 */
export function optilotus_clearPackage(): string;

/**
 * JS: `optilotus_createFunction(name) -> string` (JSON)
 */
export function optilotus_createFunction(name: string): string;

/**
 * JS: `optilotus_declare(fid, name, ty, init?) -> string` (JSON)
 */
export function optilotus_declare(fid: number, name: string, ty: string, init?: string | null): string;

/**
 * JS: `optilotus_deleteCommand(fid, cmd) -> string` (JSON)
 */
export function optilotus_deleteCommand(fid: number, cmd: number): string;

/**
 * JS: `optilotus_deleteFunction(id) -> string` (JSON)
 */
export function optilotus_deleteFunction(id: number): string;

/**
 * JS: `optilotus_execMath(expr) -> string` (JSON)
 */
export function optilotus_execMath(expr: string): string;

/**
 * JS: `optilotus_get(name) -> string` (JSON)
 */
export function optilotus_get(name: string): string;

/**
 * JS: `optilotus_getFunction(id) -> string` (JSON)
 */
export function optilotus_getFunction(id: number): string;

/**
 * JS: `optilotus_health() -> string` ("ok")
 */
export function optilotus_health(): string;

/**
 * JS: `optilotus_listCommands(fid) -> string` (JSON)
 */
export function optilotus_listCommands(fid: number): string;

/**
 * JS: `optilotus_listFunctions() -> string` (JSON)
 */
export function optilotus_listFunctions(): string;

/**
 * JS: `optilotus_print(template) -> string` (JSON)
 */
export function optilotus_print(template: string): string;

/**
 * JS: `optilotus_printCommand(fid, template) -> string` (JSON)
 * Named `printCommand` to avoid clashing with session `optilotus_print`.
 */
export function optilotus_printCommand(fid: number, template: string): string;

/**
 * JS: `optilotus_return(fid, expr) -> string` (JSON)
 */
export function optilotus_return(fid: number, expr: string): string;

/**
 * JS: `optilotus_runFunction(functionJson) -> string` (JSON report)
 */
export function optilotus_runFunction(input: string): string;

/**
 * JS: `optilotus_runProgram() -> string` (JSON report, no JSON input)
 */
export function optilotus_runProgram(): string;

/**
 * JS: `optilotus_set(name, ty, value) -> string` (JSON)
 */
export function optilotus_set(name: string, ty: string, text: string): string;

/**
 * JS: `optilotus_setEntry(fid, cmd) -> string` (JSON)
 */
export function optilotus_setEntry(fid: number, cmd: number): string;

/**
 * JS: `optilotus_setNext(fid, cmd, next?) -> string` (JSON)
 */
export function optilotus_setNext(fid: number, cmd: number, next?: number | null): string;

/**
 * JS: `optilotus_version() -> string`
 */
export function optilotus_version(): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly optilotus_assign: (a: number, b: number, c: number, d: number, e: number) => [number, number];
    readonly optilotus_clear: () => [number, number];
    readonly optilotus_clearPackage: () => [number, number];
    readonly optilotus_createFunction: (a: number, b: number) => [number, number];
    readonly optilotus_declare: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number];
    readonly optilotus_deleteCommand: (a: number, b: number) => [number, number];
    readonly optilotus_deleteFunction: (a: number) => [number, number];
    readonly optilotus_execMath: (a: number, b: number) => [number, number];
    readonly optilotus_get: (a: number, b: number) => [number, number];
    readonly optilotus_getFunction: (a: number) => [number, number];
    readonly optilotus_health: () => [number, number];
    readonly optilotus_listCommands: (a: number) => [number, number];
    readonly optilotus_listFunctions: () => [number, number];
    readonly optilotus_print: (a: number, b: number) => [number, number];
    readonly optilotus_printCommand: (a: number, b: number, c: number) => [number, number];
    readonly optilotus_return: (a: number, b: number, c: number) => [number, number];
    readonly optilotus_runFunction: (a: number, b: number) => [number, number];
    readonly optilotus_runProgram: () => [number, number];
    readonly optilotus_set: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
    readonly optilotus_setEntry: (a: number, b: number) => [number, number];
    readonly optilotus_setNext: (a: number, b: number, c: number) => [number, number];
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
