// SPDX-License-Identifier: AGPL-3.0-or-later
import { defineConfig } from "tsdown";

export default defineConfig({
  entry: { index: "src/index.ts", three: "src/three/index.ts", react: "src/react/index.tsx" },
  format: ["esm"],
  dts: true,
  clean: true,
  platform: "neutral",
  external: ["three", "react", "react/jsx-runtime"],
});
