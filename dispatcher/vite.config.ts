import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// GitHub Pages project sites need a base path like /WaukeeTalkee/
const base = process.env.VITE_BASE_PATH || "/";

export default defineConfig({
  plugins: [react()],
  base,
});
