import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api/public/office-stream': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: false,
      },
      '/api/public': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: false,
      },
      '/api/admin': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: false,
      },
      '/admin': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: false,
      },
      '/api/frt-jira-activity': {
        target: 'https://reqs.frt.vn',
        changeOrigin: true,
        secure: false,
        rewrite: (path) =>
          path.replace(/^\/api\/frt-jira-activity/, '/activity'),
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq, req) => {
            const customAuth = req.headers['x-frt-authorization'] || req.headers['authorization'];
            if (customAuth) {
              proxyReq.setHeader('Authorization', customAuth);
            }
            const customCookie = req.headers['x-frt-cookie'];
            if (customCookie) {
              proxyReq.setHeader('Cookie', customCookie);
            }
          });
          proxy.on('proxyRes', (proxyRes) => {
            // Suppress browser native Basic Auth popup so React Modal can display friendly HTTP 401/403 status
            delete proxyRes.headers['www-authenticate'];
          });
        },
      },
      '/api/frt-jenkins-rss': {
        target: 'https://jenkins-osp.frt.vn',
        changeOrigin: true,
        secure: false,
        rewrite: (path) =>
          path.replace(
            /^\/api\/frt-jenkins-rss/,
            '/job/oneclickv4-build-ci/rssAll'
          ),
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq, req) => {
            const customAuth = req.headers['x-frt-authorization'] || req.headers['authorization'];
            if (customAuth) {
              proxyReq.setHeader('Authorization', customAuth);
            }
            const customCookie = req.headers['x-frt-cookie'];
            if (customCookie) {
              proxyReq.setHeader('Cookie', customCookie);
            }
          });
          proxy.on('proxyRes', (proxyRes) => {
            delete proxyRes.headers['www-authenticate'];
          });
        },
      },
      '/api/frt-jenkins-uat-rss': {
        target: 'https://jenkins-osp.frt.vn',
        changeOrigin: true,
        secure: false,
        rewrite: (path) =>
          path.replace(
            /^\/api\/frt-jenkins-uat-rss/,
            '/job/oneclickv4-build-uat/rssAll'
          ),
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq, req) => {
            const customAuth = req.headers['x-frt-authorization'] || req.headers['authorization'];
            if (customAuth) {
              proxyReq.setHeader('Authorization', customAuth);
            }
            const customCookie = req.headers['x-frt-cookie'];
            if (customCookie) {
              proxyReq.setHeader('Cookie', customCookie);
            }
          });
          proxy.on('proxyRes', (proxyRes) => {
            delete proxyRes.headers['www-authenticate'];
          });
        },
      },
    },
  },
});
