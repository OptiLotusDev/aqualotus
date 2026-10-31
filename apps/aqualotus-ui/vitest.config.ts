import { defineConfig } from "vitest/config";
import { aqualotusVersionFromPackage, optilotusVersionFromCargo } from "./version.js";

export default defineConfig({
  define: {
    __OPTILOTUS_VERSION__: JSON.stringify(optilotusVersionFromCargo()),
    __AQUALOTUS_VERSION__: JSON.stringify(aqualotusVersionFromPackage()),
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    // The real-WASM engine tests render the whole app and drive the
    // bridge; under a full parallel run that legitimately exceeds the
    // 5 s default. A generous cap keeps them from failing on a busy
    // machine while still catching a hung test.
    testTimeout: 15_000,
    hookTimeout: 15_000,
  },
});
