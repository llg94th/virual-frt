# Virtual FRT Office 2D — Jira Workflow Simulation Demo

Bản Demo trực quan hóa hoạt động phát triển phần mềm của **Phòng Lập Trình FRT (30 nhân sự)** trên mặt bằng văn phòng 2D Top-Down kết hợp hệ thống **Jira Workflow Simulation** thời gian thực.

---

## 1. Tính năng cốt lõi (Core Demo Highlights)

1. **Mặt bằng Văn phòng 2D (30 Nhân sự & 7 Phân khu chuyên môn)**:
   - Hiển thị đầy đủ **30 kỹ sư & quản lý** ngồi tại **30 bàn làm việc (`DESK-01` .. `DESK-30`)** chia theo 7 phân khu rõ ràng:
     - **01 Project Manager (`EMP-01` - PM Quân)**: Ngồi tại `DESK-01` (PM Command Center), nơi phát hành Ticket đầu tiên và **nhận báo cáo nghiệm thu cuối cùng khi Ticket chuyển sang `DONE`**.
     - **02 Business Analysts (`EMP-02`..`EMP-03`)**: Phân tích nghiệp vụ và viết SRS/User Stories.
     - **03 Tech Leads (`EMP-04`..`EMP-06`)**: Kiến trúc hệ thống & Code Review (BE Lead, FE Lead, Mobile Lead).
     - **08 Backend Engineers (`EMP-07`..`EMP-14`)**: Phát triển Core Microservices, API & Database.
     - **06 Frontend Engineers (`EMP-15`..`EMP-20`)**: Phát triển Web E-Commerce, POS & Dashboard UI.
     - **04 Mobile Engineers (`EMP-21`..`EMP-24`)**: Phát triển iOS, Android, Flutter & React Native.
     - **04 QA / QC Engineers (`EMP-25`..`EMP-28`)**: Kiểm thử SIT/UAT, Automation Test & ký duyệt chất lượng.
     - **02 DevOps / SRE Engineers (`EMP-29`..`EMP-30`)**: Quản lý CI/CD Pipeline, Kubernetes & Cloud Infrastructure.
   - Tích hợp khu vực **Phòng họp Sprint War Room**, **Sảnh đón tiếp** và **Khu vực Pantry & Espresso Lounge** sống động.

2. **Mô phỏng Luồng Bàn giao Chồng Tài liệu (`A ➔ B` & `DONE ➔ Bàn PM`)**:
   - **Bàn giao giữa các bước (`TODO ➔ IN_PROGRESS ➔ CODE_REVIEW ➔ QA_TESTING`)**: Khi Jira Ticket đổi người phụ trách từ **Nhân viên A** sang **Nhân viên B**, nhân vật A đứng dậy cầm **chồng tài liệu (Document Stack)** hiển thị số tập hồ sơ (theo Story Points), màu sắc theo độ ưu tiên (`LOW`, `MEDIUM`, `HIGH`, `CRITICAL`) kèm nhãn mã Ticket đi bộ dọc theo các hành lang chuẩn sang bàn nhân viên B để trao hồ sơ, sau đó đi bộ tay không về lại bàn của mình.
   - **Quy tắc Nghiệm thu về Bàn PM khi Ticket `DONE`**: Khi bất kỳ Ticket nào chuyển sang trạng thái **`DONE`**, nhân viên xử lý cuối cùng sẽ cầm chồng hồ sơ hoàn thành (màu xanh ngọc kèm biểu tượng cúp/nghiệm thu) đi bộ dọc hành lang về **Bàn PM (`DESK-01` - PM Quân)**. Bàn PM lập tức nổ pháo giấy chúc mừng (Confetti), hiển thị bong bóng thoại nghiệm thu và tăng bộ đếm hồ sơ `DONE` trên bàn PM.

3. **Bảng Điều khiển Jira Simulation & Kanban Thời gian thực**:
   - **Auto-Pilot bật sẵn mặc định** ngay khi mở trang để người xem quan sát ngay hoạt động bàn giao sôi nổi.
   - **Điều khiển tốc độ**: `⏸ Tạm dừng / ▶ Tiếp tục`, tốc độ `1x`, `2x`, `4x` và chế độ cao điểm **`🔥 Sprint Demo Rush`**.
   - **Tương tác thủ công**:
     - `＋ Tạo Ticket mới`: Phát hành Ticket từ bàn PM giao xuống cho BA/Lead/Dev.
     - `Chuyển bước tiếp ➔`: Đẩy tiến độ Ticket sang bước tiếp theo trong quy trình.
     - `Giao việc (A ➔ B)`: Chọn bất kỳ Ticket nào, chỉ định trực tiếp **Nhân viên A** bê chồng tài liệu sang **Nhân viên B** hoặc chọn trạng thái `DONE` để mang thẳng về bàn PM.
     - `🐞 Trả Bug` & `DONE ➔ PM` ngay trên từng thẻ Kanban hoặc trong cửa sổ chi tiết nhân viên khi click trên Canvas 2D.

4. **Sẵn sàng Tích hợp Jira Thực tế (`Jira Integration Settings - Post-Pilot`)**:
   - Thiết kế theo **Adapter Pattern (`IJiraAdapter`)** tách biệt hoàn toàn tầng mô phỏng 2D với nguồn dữ liệu Jira.
   - Giao diện **`⚙ Jira Integration Settings (Post-Pilot)`** cho phép xem cấu hình kết nối `RealJiraWebhookAdapter` (Webhook SSE/WebSocket URL, Jira Cloud REST API v3, quy tắc ánh xạ `accountId ➔ EMP-01..EMP-30`), xem cấu trúc JSON của Jira Webhook Payload và bắn thử sự kiện Webhook trực tiếp vào văn phòng 2D.

---

## 2. Hướng dẫn Cài đặt & Khởi chạy

### Yêu cầu hệ thống
- **Node.js**: `>= 18.x`
- **npm**: `>= 9.x`

### Các bước chạy ứng dụng ở môi trường Development
```bash
# 1. Cài đặt dependencies
npm install

# 2. Khởi chạy máy chủ phát triển (Vite Dev Server)
npm run dev
```
Sau khi chạy lệnh `npm run dev`, mở trình duyệt tại địa chỉ hiển thị trên terminal (mặc định là `http://localhost:5173`).

### Kiểm tra TypeScript & Đóng gói Production Build
```bash
# Kiểm tra kiểu dữ liệu TypeScript
npm run typecheck

# Build bản Production vào thư mục dist/
npm run build

# Xem thử bản Production Build
npm run preview
```

---

## 3. Cấu trúc Thư mục Dự án

```text
├── docs/
│   ├── ARCHITECTURE.md               # Tài liệu kiến trúc hệ thống, tọa độ 30 bàn & IJiraAdapter
│   └── GAME_DESIGN.md                # Thiết kế trải nghiệm hình ảnh 2D & kịch bản Demo
├── src/
│   ├── types/
│   │   └── office.ts                 # Toàn bộ TypeScript interfaces (Employee, Desk, JiraTicket, IJiraAdapter...)
│   ├── data/
│   │   ├── officeLayout.ts           # Tọa độ 30 bàn (DESK-01..30), 7 Zones, 15 Waypoints & hàm tìm đường hành lang
│   │   └── employees.ts              # Danh sách 30 nhân sự phòng lập trình FRT (EMP-01..30)
│   ├── adapters/
│   │   ├── IJiraAdapter.ts           # Hợp đồng chuẩn kết nối Jira
│   │   ├── MockJiraAdapter.ts        # Bộ giả lập Jira cho giai đoạn Demo Pilot
│   │   └── RealJiraWebhookAdapter.ts # Adapter sẵn sàng kết nối Jira Webhook & REST API v3 thật
│   ├── engine/
│   │   ├── pathfinding.ts            # Thuật toán tìm đường A* & định tuyến dọc hành lang văn phòng
│   │   ├── mockJiraAdapter.ts        # Kịch bản Jira mẫu, dữ liệu Sprint & hội thoại nhân vật
│   │   └── simulationStore.ts        # Core 60fps Simulation Engine, hàng đợi di chuyển & React Hook
│   ├── components/
│   │   ├── OfficeCanvas2D.tsx        # Bộ dựng 2D Top-Down Office Canvas (30 nhân viên, bàn, chồng tài liệu, pháo giấy)
│   │   ├── JiraControlPanel.tsx      # Bảng điều khiển Jira Kanban, giao việc A -> B & Jira Integration Settings
│   │   └── LiveActivityFeed.tsx      # Nhật ký sự kiện bàn giao tài liệu thời gian thực
│   ├── App.tsx                       # Giao diện Workspace chính tích hợp toàn bộ hệ thống
│   ├── main.tsx                      # Điểm khởi chạy ứng dụng React
│   └── index.css                     # Cấu hình Tailwind CSS & giao diện Dark Mode
└── package.json
```
