import { defineConfig } from "vitest/config";
import { optilotusVersionFromCargo } from "./version.js";

export default defineConfig({
  define: {
    __OPTILOTUS_VERSION__: JSON.stringify(optilotusVersionFromCargo()),
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
  },
});
