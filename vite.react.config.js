const { defineConfig } = require("vite");
const react = require("@vitejs/plugin-react");
const path = require("path");

module.exports = defineConfig({
  root: path.join(__dirname, "src", "react-ui"),
  base: "./",
  plugins: [react()],
  build: {
    outDir: path.join(__dirname, "src", "react-ui", "dist"),
    emptyOutDir: true
  }
});

