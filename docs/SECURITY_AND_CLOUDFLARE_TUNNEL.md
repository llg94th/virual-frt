# 🛡️ Phân Tích Rủi Ro Bảo Mật & Kiến Trúc Cloudflare Tunnel (`Virtual FRT Office 2D`)

Tài liệu này phân tích chi tiết các rủi ro bảo mật khi public ứng dụng **Virtual FRT Office 2D** qua **Cloudflare Tunnel** và cách hệ thống Backend Proxy (`server/proxyServer.mjs`) đã được thiết kế để khóa chặt từng rủi ro đó.

---

## 1. Tổng Quan Kiến Trúc Zero-Trust Proxy & 2-Layer Deduplication

```
[Mạng Nội Bộ FRT / VPN]                     [Máy Chủ Triển Khai (Port 8787)]                      [Internet / Cloudflare Tunnel]
┌─────────────────────────┐                 ┌────────────────────────────────────────────────┐    ┌──────────────────────────────┐
│ https://reqs.frt.vn     │◄──Basic/Cookie──┤ server/proxyServer.mjs                         │    │ https://office.domain.com    │
│ /activity?maxResults=10 │                 │  ├─ Vault: AES-256-GCM (.credentials.enc.json) │    │                              │
├─────────────────────────┤                 │  ├─ Tầng 1: RAM Cache Deduplicator (2000 keys) │◄───┼─ GET /api/public/office-stream│
│ https://jenkins-osp...  │◄──Basic/Token───┤  ├─ Monotonic Cursor: currentSeq / afterSeq    │    │  (API Public DUY NHẤT)       │
│ /oneclickv4.../rssAll   │                 │  ├─ Privacy Sanitizer (Ẩn email/token/link)    │    │                              │
└─────────────────────────┘                 │  └─ Admin UI: http://127.0.0.1:8787/admin      │    │ ❌ /admin* ➔ HTTP 403 BLOCK  │
                                            └────────────────────────────────────────────────┘    └──────────────────────────────┘
```

---

## 2. Ma Trận 7 Rủi Ro Bảo Mật Khi Dùng Cloudflare Tunnel & Biện Pháp Khắc Phục

### 🔴 Rủi ro 1: Lộ trang `/admin` (Set Credential) ra ngoài Internet qua Cloudflare Tunnel
- **Mô tả nguy cơ**: Nếu cấu hình Cloudflare Tunnel trỏ toàn bộ domain `https://office.domain.com/*` về `http://127.0.0.1:8787`, người lạ trên Internet có thể truy cập `https://office.domain.com/admin` để thay đổi URL hoặc đọc cấu hình.
- **Giải pháp đã áp dụng (Defense-in-Depth 3 lớp)**:
  1. **Lớp 1 — Chặn ngay tại biên Cloudflare (`deploy/cloudflared-config.example.yml`)**: Cấu hình Ingress Rule trả về `http_status:403` cho mọi đường dẫn `^/admin.*` và `^/api/admin.*`. Request bị từ chối ngay trên hạ tầng Cloudflare trước khi chạm tới máy chủ của bạn.
  2. **Lớp 2 — Middleware phát hiện Cloudflare Header trong `server/proxyServer.mjs`**: Hàm `verifyAdminAccess(req)` kiểm tra sự tồn tại của các header đặc trưng từ Cloudflare (`cf-connecting-ip`, `cf-ray`, `cf-visitor`, `cf-ipcountry`, `x-forwarded-for`). Nếu phát hiện request đi qua Tunnel, server lập tức trả về `HTTP 403 Forbidden`.
  3. **Lớp 3 — Ràng buộc Socket Loopback (`127.0.0.1` / `::1`) + Khóa chủ `ADMIN_MASTER_KEY`**: Chỉ cho phép truy cập `/admin` trực tiếp trên máy chủ (`http://127.0.0.1:8787/admin`) hoặc qua SSH Local Port Forwarding, kèm giới hạn chống dò mật khẩu (Anti-Brute-Force lockout 5 phút nếu sai quá 8 lần).

### 🔴 Rủi ro 2: Lộ thông tin tài khoản FRT (Basic Auth Password / Cookie / Token) ở phía Trình duyệt (Client)
- **Mô tả nguy cơ**: Nếu trình duyệt người xem gọi trực tiếp API và truyền header `Authorization: Basic ...`, bất kỳ ai mở F12 (DevTools -> Network) đều sẽ thấy mật khẩu FRT của bạn.
- **Giải pháp đã áp dụng**:
  - Người dùng cuối trên web **KHÔNG BAO GIỜ** chạm vào hoặc nhìn thấy Credential.
  - Credential chỉ được nhập 1 lần tại `http://127.0.0.1:8787/admin` và được `server/proxyServer.mjs` mã hóa **AES-256-GCM** (với IV ngẫu nhiên 96-bit và AuthTag 128-bit) lưu xuống file `server/.credentials.enc.json` (quyền đọc `0600`, đã thêm vào `.gitignore`).
  - API Public `/api/public/office-stream` hoàn toàn không chứa bất kỳ header xác thực, mật khẩu, token hay cookie nào.

### 🔴 Rủi ro 3: Tấn công SSRF (Server-Side Request Forgery) qua ô nhập URL
- **Mô tả nguy cơ**: Nếu kẻ tấn công chiếm được quyền sửa `jiraUrl` / `jenkinsUrl` thành `http://169.254.169.254/latest/meta-data` hoặc dịch vụ nội bộ trong LAN (`http://192.168.1.1`), proxy server có thể bị lợi dụng để quét mạng nội bộ.
- **Giải pháp đã áp dụng**:
  - Hàm `validateUpstreamUrl()` trong `server/proxyServer.mjs` áp dụng **Strict Hostname Allowlist**: chỉ cho phép kết nối tới `reqs.frt.vn`, `jenkins-osp.frt.vn`, các tên miền `*.frt.vn` hoặc danh sách chỉ định trong biến môi trường `ALLOWED_UPSTREAM_HOSTS`.
  - Chặn cứng mọi địa chỉ IP metadata (`169.254.169.254`), loopback (`127.0.0.1`, `localhost`, `0.0.0.0`) và các giao thức phi HTTP (`file://`, `gopher://`).

### 🔴 Rủi ro 4: Rò rỉ dữ liệu nhạy cảm nội bộ trong nội dung Jira Ticket / Email nhân sự
- **Mô tả nguy cơ**: Luồng XML gốc từ `reqs.frt.vn/activity` có thể chứa email cá nhân, đường dẫn nội bộ hoặc mô tả nhạy cảm trong thẻ `<summary>` / `<title>`.
- **Giải pháp đã áp dụng**:
  - Chế độ **Privacy Sanitization** (mặc định bật `true` trong Admin UI): Tự động lọc bỏ toàn bộ thẻ HTML, ẩn địa chỉ email (`[redacted-email]`), ẩn token/link nội bộ và chỉ xuất ra các trường tối thiểu cần thiết để điều khiển hoạt cảnh 2D (`ticketKey`, `fromAccount`, `toAccount`, `toStatus`, `buildNumber`, `status`).

### 🔴 Rủi ro 5: DDoS / Làm quá tải Jira & Jenkins nội bộ khi có nhiều người cùng mở Web
- **Mô tả nguy cơ**: Nếu 100 người cùng mở trang web qua Cloudflare Tunnel và mỗi trình duyệt poll mỗi 5 giây, nếu proxy chuyển tiếp thẳng toàn bộ request vào `reqs.frt.vn` thì tài khoản của bạn sẽ bị khóa hoặc gây nghẽn Jira nội bộ.
- **Giải pháp đã áp dụng**:
  - **Upstream Poll Coalescing (`inFlightPollPromise`) & RAM Ring Buffer**: Dù có 1 hay 500 người dùng cùng gọi `GET /api/public/office-stream`, toàn bộ client đều đọc từ **RAM Ring Buffer** siêu nhẹ của `server/proxyServer.mjs`, còn việc lấy dữ liệu từ `reqs.frt.vn` và `jenkins-osp.frt.vn` được gộp (coalesce) và điều tiết theo chu kỳ cố định (`pollIntervalSec`).
  - Áp dụng **Rate Limiting theo IP** (`checkPublicRateLimit`: tối đa 180 req/phút/IP) để chống spam.

---

## 3. Cơ Chế 2-Layer Exactly-Once Deduplication (`afterSeq`) — Đảm Bảo Event Không Bao Giờ Đến 2 Lần

Vì `reqs.frt.vn/activity?maxResults=10` và `jenkins-osp.frt.vn/job/oneclickv4-build-ci/rssAll` luôn trả về 10–20 bản ghi gần nhất ở mỗi lần poll, hệ thống áp dụng **2 tầng lọc trùng lặp độc lập**:

1. **Tầng 1 — Server RAM Cache Deduplicator (`server/proxyServer.mjs`)**:
   - Duy trì `seenFingerprints` (`Map` giới hạn LRU **2,000 keys** trên RAM) và bộ đếm đơn điệu `currentSeq`.
   - Khóa chuẩn cho Jira Activity: `jira:${entryId}:${ticketKey}:${fromAccount}:${toAccount}:${toStatus}:${updatedTimestamp}`.
   - Khóa chuẩn cho Jenkins Build: `jenkins:${jobName}:#${buildNumber}:${statusNormalized}` (VD: `jenkins:oneclickv4-build-ci:#2846:SUCCESS`).
   - Khi đọc XML: Nếu `fingerprint` đã tồn tại trong `seenFingerprints` ➔ **BỎ QUA NGAY LẬP TỨC**, tăng `dedupStats.duplicatesDropped++`, tuyệt đối không sinh event mới và không tăng `currentSeq`.
   - Khi client gọi `GET /api/public/office-stream?afterSeq=N`: Server **chỉ trả về các sự kiện có `seq > N`**. Nếu không có sự kiện mới, trả về `events: []`.

2. **Tầng 2 — Client-Side Idempotency Guard (`src/engine/simulationStore.ts`)**:
   - Lưu `lastServerSeq` và tập khóa `processedEventFingerprints: Set<string>` ngay trong Store.
   - Trước khi cho nhân vật đi bộ giao tài liệu hay chạy ra Server Jenkins build, luôn kiểm tra `processedEventFingerprints.has(event.fingerprint)`.
   - Nhờ đó, dù người dùng bấm nút **"Đồng bộ ngay"** 10 lần liên tiếp hoặc dán lại cùng 1 đoạn XML vào ô test, hệ thống sẽ báo `"🛡️ 0 sự kiện mới (Đã lọc bỏ X sự kiện trùng lặp trong RAM Cache)"` và nhân vật không bao giờ đi lặp lại lần 2.

---

## 4. Khuyến Nghị Bảo Mật Bổ Sung Trên Cloudflare Dashboard
1. **Bật Cloudflare Access (Zero Trust Application)** cho domain `office.yourdomain.com` nếu bạn chỉ muốn đồng nghiệp có email `@frt.vn` hoặc danh sách email được phép mới mở được trang web.
2. **Đặt biến môi trường `ADMIN_MASTER_KEY`** khi khởi chạy server trên máy chủ triển khai để tăng cường bảo vệ lớp 2 cho `/admin`.
