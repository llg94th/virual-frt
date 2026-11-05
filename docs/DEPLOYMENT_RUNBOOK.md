# 🚀 Runbook Triển Khai Trên Máy Khác (`Virtual FRT Office 2D` + Hardened Proxy + Cloudflare Tunnel)

Hướng dẫn từng bước (Step-by-Step Runbook) để triển khai trọn gói cả **Giao diện Web 2D (`dist/`)**, **Backend Proxy bảo mật (`server/proxyServer.mjs`)** và **Cloudflare Tunnel** trên một máy chủ/máy tính mới (macOS, Ubuntu/Debian Linux, hoặc Windows/WSL2).

---

## 1. Yêu Cầu Hệ Thống Trên Máy Triển Khai Mới

1. **Node.js**: Phiên bản `>= 18.x` (khuyến nghị **Node.js 20 LTS**).
2. **Kết nối mạng nội bộ FRT / VPN**: Máy triển khai cần truy cập được `https://reqs.frt.vn` và `https://jenkins-osp.frt.vn`.
3. **Cloudflared CLI**: Công cụ tạo đường hầm của Cloudflare (`cloudflared`).

---

## 2. Các Bước Cài Đặt & Khởi Chạy Nhanh (Bare-Metal / PM2)

### Bước 1: Sao chép mã nguồn & Cài đặt thư viện
```bash
git clone <repo-url> virtual-frt-office-2d
cd virtual-frt-office-2d

# Cài đặt dependencies
npm ci

# Build bản Production tối ưu vào thư mục dist/
npm run build
```

### Bước 2: Khởi chạy Backend Proxy + Web Server trên cổng `8787`

#### Cách A: Chạy trực tiếp để kiểm tra nhanh
```bash
# Đặt khóa chủ bảo vệ Admin (tùy chọn nhưng khuyến nghị)
export ADMIN_MASTER_KEY="mat-khau-admin-noi-bo-cua-ban"

# Chạy server tại cổng 8787 (phục vụ cả web dist/ và API /api/public/office-stream)
npm run server
```

#### Cách B: Chạy ngầm bền vững bằng PM2 (Khuyến nghị trên máy chủ chạy 24/7)
```bash
npm install -g pm2

# Build giao diện và khởi chạy qua PM2 (chế độ 1 instance để giữ RAM Cache Deduplicator)
npm run build
pm2 start deploy/ecosystem.config.cjs
pm2 save
pm2 startup
```

---

## 3. Cấu Hình Credential Tại Trang Admin Nội Bộ (`/admin`)

> ⚠️ **Lưu ý bảo mật**: Trang `/admin` **CHỈ** mở được từ chính máy chủ (`127.0.0.1`) và bị chặn hoàn toàn khi đi qua Cloudflare Tunnel!

### Trường hợp 1: Bạn đang ngồi trực tiếp trên máy triển khai
1. Mở trình duyệt truy cập: **`http://127.0.0.1:8787/admin`**
2. Nhập thông tin kết nối:
   - **Jira Activity Feed URL**: `https://reqs.frt.vn/activity?maxResults=10&providers=issues&os_authType=basic&title=undefined`
   - **Kiểu xác thực Jira**: `BASIC`
   - **FRT Account / Username**: tên tài khoản FRT của bạn (VD: `dongnq6`)
   - **Password / Token**: mật khẩu đăng nhập `reqs.frt.vn`
   - **Jenkins RSS All URL**: `https://jenkins-osp.frt.vn/job/oneclickv4-build-ci/rssAll`
   - Bật **Privacy Sanitization** (ẩn thông tin nhạy cảm trên API public).
   - Nếu đang chạy thật với VPN FRT, bạn có thể tắt mục *"Dùng Seed XML mẫu khi chưa nối VPN"*.
3. Bấm **💾 Mã hóa AES-256-GCM & Lưu Cấu Hình**.
   - Hệ thống sẽ mã hóa toàn bộ thông tin bằng chuẩn **AES-256-GCM** và lưu vào `server/.credentials.enc.json` (quyền `0600`).
4. Bấm **🔄 Poll & Test Deduplication Ngay** 2 lần liên tiếp để kiểm tra:
   - **Lần 1**: Bộ đếm `Unique Events Emitted` tăng lên, `latestSeq` tăng lên.
   - **Lần 2**: Hệ thống báo **`0 sự kiện mới`**, bộ đếm **`Trùng Lặp Đã Chặn (Dropped)`** tăng lên — chứng minh RAM Cache hoạt động chính xác 100%!

### Trường hợp 2: Máy triển khai là Server Linux từ xa (Headless SSH)
Dùng **SSH Local Port Forwarding** từ máy cá nhân của bạn để mở trang `/admin` an toàn mà không cần mở port ra ngoài:
```bash
ssh -L 8787:127.0.0.1:8787 user@ip-may-trien-khai
```
Sau đó mở `http://127.0.0.1:8787/admin` ngay trên trình duyệt máy cá nhân của bạn.

---

## 4. Triển Khai Bằng Docker Compose (Tùy Chọn)

Nếu máy mới đã cài sẵn Docker:
```bash
# Khởi chạy container tại 127.0.0.1:8787 kèm Volume lưu bền vững Credential AES-256-GCM
docker compose up -d --build

# Xem log
docker compose logs -f
```

---

## 5. Cấu Hình Cloudflare Tunnel Để Public Ra Domain

### Cách 1: Dùng Cloudflare Zero Trust Dashboard (Nhanh nhất)
1. Truy cập **Cloudflare Zero Trust Dashboard** ➔ **Networks** ➔ **Tunnels** ➔ **Create a tunnel**.
2. Cài `cloudflared` lên máy triển khai và chạy lệnh kết nối token theo hướng dẫn trên màn hình.
3. Trong tab **Public Hostname**, tạo **2 quy tắc theo đúng thứ tự ưu tiên từ trên xuống dưới**:
   - **Hostname Rule 1 (Chặn `/admin` từ Internet)**:
     - Subdomain: `office` | Domain: `yourdomain.com` | Path: `admin*`
     - Service Type: `HTTP_STATUS` ➔ `403`
   - **Hostname Rule 2 (Chặn `/api/admin` từ Internet)**:
     - Subdomain: `office` | Domain: `yourdomain.com` | Path: `api/admin*`
     - Service Type: `HTTP_STATUS` ➔ `403`
   - **Hostname Rule 3 (Public Web & `/api/public/office-stream`)**:
     - Subdomain: `office` | Domain: `yourdomain.com` | Path: *(để trống)*
     - Service: `http://127.0.0.1:8787`

### Cách 2: Dùng File Cấu Hình `cloudflared` CLI (`deploy/cloudflared-config.example.yml`)
1. Sao chép file mẫu:
   ```bash
   cp deploy/cloudflared-config.example.yml ~/.cloudflared/config.yml
   ```
2. Thay `<YOUR_CLOUDFLARE_TUNNEL_UUID>` và `office.yourdomain.com` bằng thông tin thật của bạn.
3. Chạy Tunnel:
   ```bash
   cloudflared tunnel --config ~/.cloudflared/config.yml run
   ```

---

## 6. Checklist Kiểm Tra Nghiệm Thu (Verification Commands)

Chạy các lệnh sau trên máy triển khai để xác nhận mọi thành phần hoạt động chuẩn xác:

```bash
# 1. Kiểm tra lần gọi đầu tiên (afterSeq=0): Khởi tạo màn hình và trả về latestSeq
curl -s "http://127.0.0.1:8787/api/public/office-stream?afterSeq=0" | jq '{latestSeq, eventsCount, dedupStats}'

# 2. Kiểm tra lần gọi thứ 2 liên tiếp với afterSeq=<latestSeq vừa nhận>:
#    BẮT BUỘC trả về eventsCount: 0 và duplicatesDropped tăng lên!
curl -s "http://127.0.0.1:8787/api/public/office-stream?afterSeq=4" | jq '{latestSeq, eventsCount, dedupStats, pollSummary}'

# 3. Kiểm tra bảo mật chặn Cloudflare Tunnel vào /admin (Giả lập header cf-connecting-ip):
#    BẮT BUỘC trả về HTTP 403 Forbidden!
curl -i -H "cf-connecting-ip: 203.0.113.50" "http://127.0.0.1:8787/admin"
```
