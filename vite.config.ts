import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Tauri сам запускает этот сервер, порт фиксированный.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      // папка сборки Rust лежит внутри проекта — не следить за ней
      ignored: ["**/src-tauri/**", "**/.cargo-target/**"],
    },
  },
});
