/**
 * Types for `version.js`, which `vite.config.ts` and `vitest.config.ts`
 * import to inject the build-time Optilotus and AquaLotus versions. The
 * implementation stays plain `.js` so the configs can load it before any
 * TS transform is available; this declaration gives it a checked
 * signature.
 */
export function optilotusVersionFromCargo(): string;
export function aqualotusVersionFromPackage(): string;
