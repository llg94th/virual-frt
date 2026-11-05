/**
 * PM2 Process Manager Configuration (`deploy/ecosystem.config.cjs`)
 * Chạy tiến trình đơn (Single-Instance `instances: 1`) để giữ bộ nhớ RAM Cache Deduplicator
 * (`seenFingerprints` + `currentSeq`) nhất quán 100% trong RAM.
 *
 * Khởi chạy:
 *   npm run build
 *   pm2 start deploy/ecosystem.config.cjs
 *   pm2 save
 */

module.exports = {
  apps: [
    {
      name: 'virtual-frt-office-2d',
      script: 'server/proxyServer.mjs',
      instances: 1, // Bắt buộc 1 instance để RAM Cache Deduplicator giữ nguyên con trỏ currentSeq
      exec_mode: 'fork',
      autorestart: true,
      watch: false,
      max_memory_restart: '350M',
      env: {
        NODE_ENV: 'production',
        PORT: 8787,
        BIND_HOST: '0.0.0.0',
        // Khuyến nghị đặt khóa chủ để mã hóa AES-256-GCM và bảo vệ lớp 2 cho /admin:
        // ADMIN_MASTER_KEY: 'change-me-to-a-strong-32-char-random-secret',
        ALLOWED_UPSTREAM_HOSTS: 'reqs.frt.vn,jenkins-osp.frt.vn',
      },
    },
  ],
};
