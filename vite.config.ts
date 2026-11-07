import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  plugins: [{
    name: 'static-guide-directory',
    configureServer(server) {
      // Match Pages' directory-index behavior for our generated static guide.
      server.middlewares.use((request, _response, next) => {
        if (request.url?.split('?')[0] === '/guide/') request.url = request.url.replace('/guide/', '/guide/index.html');
        next();
      });
    },
  }],
  // Colima bind mounts do not reliably forward macOS file-watch events.
  server: { watch: { usePolling: true, interval: 700 } },
});
