import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

// Spotify requires loopback redirect URIs to use 127.0.0.1 (not localhost),
// and the port must match the Redirect URI registered in the Spotify dashboard.
//
// `npm run dev:lan` serves the app to other devices on the network. Off loopback,
// Spotify only accepts HTTPS redirect URIs and the PKCE login needs crypto.subtle
// (secure contexts only), so that mode uses a self-signed certificate on port 5174.
export default defineConfig(({ mode }) =>
  mode === 'lan'
    ? {
        plugins: [basicSsl()],
        server: { host: '0.0.0.0', port: 5174, strictPort: true },
      }
    : {
        server: { host: '127.0.0.1', port: 5173, strictPort: true },
        preview: { host: '127.0.0.1', port: 5173, strictPort: true },
      },
);
