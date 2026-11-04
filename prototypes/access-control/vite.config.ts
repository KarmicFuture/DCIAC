import { defineConfig } from "vite";

// GitHub Pages serves the site at /DCIAC/.
// serve.py maps that prefix onto dist so local tests can still open /.
export default defineConfig({
  base: "/DCIAC/",
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
