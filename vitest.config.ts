import { defineConfig } from 'vite';
import { spawn } from 'child_process';

export default defineConfig({
  plugins: [
    {
      name: 'watch-custom-files',
      configureServer(server) {
        server.watcher.add('**/*.es');
        server.watcher.on('change', (path) => {
          if (path.endsWith('.es')) {
            console.log(`.es file changed: ${path}`);
            const vitest = spawn('npx', ['vitest', 'run'], { stdio: 'inherit' });
            vitest.on('close', (code) => {
              if (code !== 0) {
                console.error(`Vitest process exited with code ${code}`);
              }
            });
          }
        });
      }
    }
  ],
  test: {
    environment: 'node',
    include: ['**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    setupFiles: ['./setup-vitest.ts'],
    watchExclude: ['**/node_modules/**', '**/dist/**']
  }
});
