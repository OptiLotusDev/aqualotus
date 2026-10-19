/* tslint:disable */
/* eslint-disable */

/**
 * JS: `optilotus_assign(fid, name, expr) -> string` (JSON)
 */
export function optilotus_assign(fid: number, name: string, expr: string): string;

/**
 * JS: `optilotus_cast(fid, name, to, expr) -> string` (JSON)
 */
export function optilotus_cast(fid: number, name: string, to: string, expr: string): string;

/**
 * JS: `optilotus_clearPackage() -> string` (JSON)
 */
export function optilotus_clearPackage(): string;

/**
 * JS: `optilotus_createFunction(name) -> string` (JSON)
 */
export function optilotus_createFunction(name: string): string;

/**
 * Enable or disable debug mode (adds extra introspection fields to status JSON).
 */
export function optilotus_debugMode(enable: boolean): void;

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
 * JS: `optilotus_getFunction(id) -> string` (JSON)
 */
export function optilotus_getFunction(id: number): string;

/**
 * JS: `optilotus_health() -> string` ("ok")
 */
export function optilotus_health(): string;

/**
 * `if(fid, cond_expr, then_specs, else_specs?)` -> Result<u32, JsValue>.
 *
 * Creates an `Op::If` in one call: the condition expression is evaluated
 * into a hidden ValueId appended to the main chain, and each body spec
 * is expanded into raw commands linked in order. Body specs cross as
 * native JS objects (no JSON strings); the Ok value is the new
 * if-command's user id, the Err value is the error message.
 */
export function optilotus_if(fid: number, cond_expr: string, then_specs: any[], else_specs?: any[] | null): number;

/**
 * JS: `optilotus_input(fid, ty) -> string` (JSON)
 */
export function optilotus_input(fid: number, ty: string): string;

/**
 * Query the last recorded error. Returns `{"status":"idle"}` if none.
 */
export function optilotus_lastError(): string;

/**
 * JS: `optilotus_listCommands(fid) -> string` (JSON)
 */
export function optilotus_listCommands(fid: number): string;

/**
 * JS: `optilotus_listFunctions() -> string` (JSON)
 */
export function optilotus_listFunctions(): string;

/**
 * JS: `optilotus_print(fid, template) -> string` (JSON)
 */
export function optilotus_print(fid: number, template: string): string;

/**
 * JS: `optilotus_renameFunction(id, name) -> string` (JSON)
 */
export function optilotus_renameFunction(id: number, name: string): string;

/**
 * JS: `optilotus_return(fid, expr) -> string` (JSON)
 */
export function optilotus_return(fid: number, expr: string): string;

/**
 * JS: `opilotus_runProgram() -> string` (JSON report, no JSON input)
 */
export function optilotus_runProgram(): string;

/**
 * JS: `optilotus_runProgramCancel() -> void`
 */
export function optilotus_runProgramCancel(): void;

/**
 * Peek at pending input without consuming it.
 * Returns `{"status":"waiting_input","command":...,"ty":...}` or `{"status":"idle"}` / error.
 */
export function optilotus_runProgramPeekPending(): string;

/**
 * JS: `optilotus_runProgramProvideInput(value) -> string`
 */
export function optilotus_runProgramProvideInput(value: string): string;

/**
 * Provide a single typed input value (JSON-encoded).
 * The library parses the JSON value according to the pending command's type.
 */
export function optilotus_runProgramProvideInputTyped(value_json: string): string;

/**
 * Batch provide multiple input lines sequentially.
 * Stops at the first `waiting_input` or completion.
 */
export function optilotus_runProgramProvideInputs(inputs_json: string): string;

/**
 * Reset / clear the active run session. Returns `{"status":"idle"}`.
 */
export function optilotus_runProgramReset(): string;

/**
 * JS: `optilotus_runProgramStart() -> string`
 */
export function optilotus_runProgramStart(): string;

/**
 * JS: `optilotus_runProgramStatus() -> string`
 */
export function optilotus_runProgramStatus(): string;

/**
 * JS: `optilotus_runProgramWithInputs(inputs_json) -> string` (JSON)
 */
export function optilotus_runProgramWithInputs(inputs_json: string): string;

/**
 * JS: `optilotus_setEntry(fid, cmd?) -> string` (JSON, `null` clears)
 */
export function optilotus_setEntry(fid: number, cmd?: number | null): string;

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
    readonly optilotus_cast: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number];
    readonly optilotus_clearPackage: () => [number, number];
    readonly optilotus_createFunction: (a: number, b: number) => [number, number];
    readonly optilotus_debugMode: (a: number) => void;
    readonly optilotus_declare: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number];
    readonly optilotus_deleteCommand: (a: number, b: number) => [number, number];
    readonly optilotus_deleteFunction: (a: number) => [number, number];
    readonly optilotus_getFunction: (a: number) => [number, number];
    readonly optilotus_health: () => [number, number];
    readonly optilotus_if: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number, number];
    readonly optilotus_input: (a: number, b: number, c: number) => [number, number];
    readonly optilotus_lastError: () => [number, number];
    readonly optilotus_listCommands: (a: number) => [number, number];
    readonly optilotus_listFunctions: () => [number, number];
    readonly optilotus_print: (a: number, b: number, c: number) => [number, number];
    readonly optilotus_renameFunction: (a: number, b: number, c: number) => [number, number];
    readonly optilotus_return: (a: number, b: number, c: number) => [number, number];
    readonly optilotus_runProgram: () => [number, number];
    readonly optilotus_runProgramCancel: () => void;
    readonly optilotus_runProgramPeekPending: () => [number, number];
    readonly optilotus_runProgramProvideInput: (a: number, b: number) => [number, number];
    readonly optilotus_runProgramProvideInputTyped: (a: number, b: number) => [number, number];
    readonly optilotus_runProgramProvideInputs: (a: number, b: number) => [number, number];
    readonly optilotus_runProgramReset: () => [number, number];
    readonly optilotus_runProgramStart: () => [number, number];
    readonly optilotus_runProgramStatus: () => [number, number];
    readonly optilotus_runProgramWithInputs: (a: number, b: number) => [number, number];
    readonly optilotus_setEntry: (a: number, b: number) => [number, number];
    readonly optilotus_setNext: (a: number, b: number, c: number) => [number, number];
    readonly optilotus_version: () => [number, number];
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __externref_table_alloc: () => number;
    readonly __externref_table_dealloc: (a: number) => void;
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
