import { defineConfig, type Plugin } from "vitest/config";
import react from "@vitejs/plugin-react";

/**
 * The shipped app runs under a strict Content-Security-Policy declared in
 * index.html. The dev server cannot: React Fast Refresh injects an inline
 * preamble script and HMR needs a WebSocket back to localhost.
 *
 * Rather than weakening the production policy to keep `npm run dev` working,
 * this rewrites the policy for dev serving only. The built output in dist/
 * always carries the strict version.
 */
function relaxCspForDevServer(): Plugin {
  return {
    name: "casefoundry:relax-csp-for-dev",
    apply: "serve",
    transformIndexHtml(html) {
      return html.replace(
        /(<meta\s+http-equiv="Content-Security-Policy"\s+content=")[^"]*(")/,
        "$1default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'; " +
          "style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; " +
          "font-src 'self' data:; connect-src 'self' ws: wss: data: blob:; " +
          "worker-src 'self' blob:; object-src 'none'$2",
      );
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [react(), relaxCspForDevServer()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false,
    target: "es2022",
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
