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
  },
});
