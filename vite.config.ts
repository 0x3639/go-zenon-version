import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  // Colima bind mounts do not reliably forward macOS file-watch events.
  server: { watch: { usePolling: true, interval: 700 } },
});
