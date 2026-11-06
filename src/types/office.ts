/**
 * Core Type Definitions for Virtual FRT Office 2D - Jira Simulation Demo
 * Defines data models for the 30-person engineering office, 2D spatial layout,
 * Jira ticket lifecycle, document transfer animations, and the Jira Adapter contract.
 */

// ============================================================================
// 1. SPATIAL & 2D GRID TYPES
// ============================================================================

/** Tọa độ thực (pixel) trên Canvas 2D */
export interface Point2D {
  x: number;
  y: number;
}

/** Tọa độ ô lưới (Grid tile) dùng cho thuật toán A* Pathfinding */
export interface GridCoord {
  col: number;
  row: number;
}

/** Hướng quay mặt của bàn làm việc hoặc nhân vật trên bản đồ 2D */
export type Direction = 'UP' | 'DOWN' | 'LEFT' | 'RIGHT';

/** Hướng nhìn 3/4 chuẩn trên mặt phẳng Isometric 2.5D (Đông-Nam, Tây-Nam, Đông-Bắc, Tây-Bắc) */
export type IsoDirection = 'SE' | 'SW' | 'NE' | 'NW';

/** Điểm nút hành lang (Corridor Waypoint) hỗ trợ định tuyến mượt quanh các dãy bàn */
export interface Waypoint {
  id: string;
  label: string;
  position: Point2D;
  grid: GridCoord;
  /** Danh sách ID các Waypoint lân cận có kết nối trực tiếp */
  connectedTo: string[];
  isMainCorridor?: boolean;
}

/** Phân khu chức năng trong văn phòng 30 người */
export type ZoneId =
  | 'ZONE-PM'
  | 'ZONE-LEAD'
  | 'ZONE-BE'
  | 'ZONE-FE'
  | 'ZONE-MOBILE'
  | 'ZONE-QA'
  | 'ZONE-DEVOPS'
  | 'ZONE-COMMON';

/** Khu vực hiển thị nền (Zone/Department Cluster) trên mặt bằng văn phòng */
export interface OfficeZone {
  id: ZoneId;
  name: string;
  shortName: string;
  description: string;
  /** Tọa độ & kích thước vùng (pixel) */
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  /** Màu nền và viền khu vực */
  backgroundColor: string;
  borderColor: string;
  accentColor: string;
}

/** Vị trí và cấu hình của 1 bàn làm việc (Desk) trong văn phòng */
export interface DeskPosition {
  /** Mã bàn: DESK-01 .. DESK-30 */
  id: string;
  /** Nhãn hiển thị ngắn trên mặt bàn */
  label: string;
  /** Khu vực (Zone) chứa bàn này */
  zoneId: ZoneId;
  /** ID nhân viên ngồi tại bàn này (EMP-01 .. EMP-30) */
  assignedEmployeeId: string;
  /** Tọa độ tâm hoặc góc trái-trên trên Canvas (pixel) */
  position: Point2D;
  /** Tọa độ pixel trực tiếp để truy cập nhanh (x, y) */
  x: number;
  y: number;
  /** Tọa độ ô lưới chính của bàn */
  grid: GridCoord;
  /** Kích thước mặt bàn (pixel) */
  width: number;
  height: number;
  /** Hướng ngồi của nhân viên tại bàn */
  orientation: Direction;
  /** Vị trí ghế ngồi của nhân viên (pixel) */
  seatPosition: Point2D;
  /**
   * Điểm đứng giao/nhận tài liệu ngay lối đi cạnh bàn (pixel & grid).
   * Đảm bảo luôn nằm trên ô lối đi (walkable = true).
   */
  handoffPoint: Point2D;
  handoffGrid: GridCoord;
  /** ID của Waypoint hành lang gần nhất để kết nối nhanh vào mạng lưới đường đi */
  nearestWaypointId: string;
  /** Mã chỗ ngồi thực tế theo sơ đồ Excel (VD: 'FT3.III2A.1.289') */
  seatCode?: string;
  /** Tên tài khoản nhân viên thực tế trên sơ đồ (VD: 'DongNQ6', 'ChienND22') */
  account?: string;
  /** Mã cụm đảo bàn trong khoang NHÀ THUỐC (VD: 'ISLAND-1.1' .. 'ISLAND-3.3') */
  islandId?: string;
  /** Chỉ số hàng trong cụm 6 bàn ghép (0 = Hàng trên, 1 = Hàng giữa, 2 = Hàng dưới) */
  rowIndex?: 0 | 1 | 2;
  /** Chỉ số dãy/cột trong cụm 6 bàn ghép (0 = Dãy Trái nhìn SE, 1 = Dãy Phải nhìn NW) */
  colIndex?: 0 | 1;
  /** Kiểu tô màu đặc biệt trên sơ đồ Excel ('red' cho DongNQ6, 'yellow' cho ThanhDQ13, 'vacant' cho bàn Trống) */
  highlightVariant?: 'normal' | 'red' | 'yellow' | 'vacant';
  /** Ghi chú phụ cạnh ô bàn (VD: 'Thoa' cạnh bàn trống FT3.III2A.1.101/102) */
  sideNote?: string;
}

/** Ô chỗ ngồi hoặc cột kiến trúc trong sơ đồ 3x3 cụm bàn ghép 6 chỗ (54 ô) của Khoang NHÀ THUỐC (FT3.III2A.1) */
export interface NhaThuocSeatSlot {
  id: string;
  islandId: string;
  islandRow: 1 | 2 | 3;
  islandCol: 1 | 2 | 3;
  subRow: 1 | 2 | 3;
  /** Chỉ số hàng 0-based trong cụm 6 bàn ghép (0, 1, 2) */
  rowIndex: 0 | 1 | 2;
  /** Chỉ số dãy 0-based trong cụm 6 bàn ghép (0 = Dãy Trái, 1 = Dãy Phải) */
  colIndex: 0 | 1;
  side: 'LEFT' | 'RIGHT';
  seatCode: string;
  account: string;
  kind: 'OCCUPIED' | 'VACANT' | 'PILLAR';
  highlight: 'normal' | 'red' | 'yellow';
  sideNote?: string;
  /** Nếu ô này gắn với 1 trong 30 nhân viên điều phối chính (DESK-01..DESK-30) */
  deskId?: string;
  assignedEmployeeId?: string;
  /** Tọa độ thế giới (pixel) của tâm ô bàn trong cụm bàn ghép 2x3 */
  wx: number;
  wy: number;
  width: number;
  height: number;
  /** Vị trí ghế xoay của ô bàn này (nằm ở mép ngoài bên Trái hoặc bên Phải cụm bàn ghép) */
  seatPosition: Point2D;
  orientation: Direction;
}

// ============================================================================
// 2. EMPLOYEE & ROLE TYPES (30 ENGINEERING STAFF)
// ============================================================================

/** Vai trò chuyên môn trong phòng lập trình */
export type Role =
  | 'PM'
  | 'BA'
  | 'TECH_LEAD'
  | 'BACKEND'
  | 'FRONTEND'
  | 'MOBILE'
  | 'QA'
  | 'DEVOPS';

/** Alias tương thích cho Role */
export type EmployeeRole = Role;


/** Trạng thái hoạt động tức thời của nhân viên trong mô phỏng */
export type EmployeeStatus =
  | 'IDLE'           // Ngồi tại bàn, sẵn sàng nhận việc
  | 'WORKING'        // Đang xử lý ticket tại bàn
  | 'WALKING'        // Đang đi bộ vào nhận bàn hoặc đi bộ ra Cửa Ra Vào tan ca về nhà
  | 'CARRYING_DOCS'  // Đang bê chồng tài liệu đi sang bàn khác hoặc về bàn PM
  | 'HANDOFF'        // Đang trao/đặt tài liệu tại bàn đích
  | 'WALKING_BACK'   // Đang đi bộ quay về bàn của mình sau khi giao tài liệu
  | 'REVIEWING';     // Đang review code / kiểm thử tài liệu vừa nhận

/** Thông tin chi tiết của 1 nhân viên trong văn phòng ảo */
export interface Employee {
  /** Mã định danh: EMP-01 .. EMP-30 */
  id: string;
  /** Mã nhân viên hiển thị (VD: FRT-PM01, FRT-BE01...) */
  code: string;
  /** Họ và tên đầy đủ */
  name: string;
  /** Tên gọi ngắn hiển thị trên đầu nhân vật */
  displayName: string;
  /** Vai trò chuyên môn */
  role: Role;
  /** Chức danh chi tiết (VD: Senior Backend Engineer, Project Manager) */
  title: string;
  /** Tên nhóm/Squad (VD: Core Platform, Omni-Channel, App Mobile, Quality Assurance) */
  squad: string;
  /** Bàn làm việc được phân công (DESK-01 .. DESK-30) */
  deskId: string;
  /** Màu áo/avatar chính của nhân vật trên Canvas */
  avatarColor: string;
  /** Màu phụ/viền nhận diện theo Role */
  badgeColor: string;
  /** Chữ viết tắt hiển thị trên avatar (VD: "AN", "BH") */
  initials: string;
  /** Tài khoản Jira tương ứng để map khi cắm RealJiraWebhookAdapter */
  jiraAccountId: string;
  /** Email công ty */
  email: string;
  /** Kỹ năng chính */
  skills: string[];
  /** Có phải là PM nhận kết quả cuối cùng khi Ticket Done hay không */
  isProjectManager?: boolean;
  /** Giới tính của nhân vật ('male' | 'female') để hiển thị kiểu tóc & trang phục phù hợp */
  gender?: 'male' | 'female';
  /** Cờ đánh dấu Sếp nữ ThuNDM đi tuần tra thả tim khích lệ nhân viên toàn khoang NHÀ THUỐC */
  isFemaleManager?: boolean;
  /** Cờ đánh dấu là 1 trong 4 vị Sếp đi tuần tra 4 phòng (`ThuNDM`, `ToanLBK`, `doannt19`, `vanltb8`) */
  isManager?: boolean;
  /** Trạng thái biểu cảm đặc trưng của Sếp (`loving` = ❤️, `angry` = 💢😡, `happy` = 😄🌸, `worried` = 😰💧) */
  managerMood?: 'loving' | 'angry' | 'happy' | 'worried';
  /** Hệ số nhân tốc độ đi bộ riêng của nhân vật (VD: Sếp ToanLBK = 1.5x người thường) */
  speedMultiplier?: number;
  /** Phòng / Khoang mà Sếp phụ trách đi tuần tra */
  patrolWing?: 'EAST' | 'NORTH' | 'WEST_CENTRAL' | 'SOUTH';
  /** Đã vào công ty nhận chỗ ngồi trong ngày hay chưa (Đầu ngày = false cho toàn bộ nhân viên trừ 4 Sếp) */
  isCheckedIn?: boolean;
  /** Alias đồng bộ với quy tắc `checkedInToday`: nhân viên đang có mặt trong công ty hôm nay */
  checkedInToday?: boolean;
  /** Thời điểm gần nhất (epoch ms `Date.now()`) nhân viên phát sinh event mới (Check-in, Jira, Jenkins). Quá 2h không có event mới -> tự động đi về! */
  lastEventAt?: number;
  /** Cờ đánh dấu nhân viên đang đứng dậy đi bộ ra `🚪 CỬA RA VÀO` để tan ca về nhà sau 2h không có event */
  isCheckingOut?: boolean;
  /** Mã bàn làm việc thực tế mà nhân viên đã chiếm chỗ khi có Event (Check-in) */
  checkedInDeskId?: string | null;
  /** Alias đồng bộ với `checkedInDeskId`: Mã bàn đang ngồi (undefined khi đi về để giải phóng bàn trống ngay lập tức) */
  assignedDeskId?: string | null;
  /** Khi hết chỗ ngồi, nhân viên đi ra hành lang đá xám quanh Giếng trời để tụ tập hút thuốc (`🚬 💨`) */
  isSmokingAtAtrium?: boolean;
  /** Alias đồng bộ với `isSmokingAtAtrium`: Đang phải đứng hút thuốc ở Giếng trời do hết bàn */
  isSmokingOverflow?: boolean;
  /** Mã Giếng trời nơi nhân viên đang đứng hút thuốc (`ATRIUM-NORTH` | `ATRIUM-CENTRAL` | `ATRIUM-SOUTH`) */
  smokingAtriumId?: 'ATRIUM-NORTH' | 'ATRIUM-CENTRAL' | 'ATRIUM-SOUTH' | null;
  /** Tọa độ đứng hút thuốc trên hành lang đá xám quanh Giếng trời */
  smokingSpot?: Point2D | null;
  /** Đang đi bộ từ Cửa Ra Vào (`🚪 CỬA RA VÀO`) hoặc từ Giếng trời vào bàn làm việc */
  isWalkingFromEntrance?: boolean;
  /** Câu thoại nổi trên đầu khi nhân viên tan ca đi về sau 2h không có event hoặc từ Giếng trời vào nhận bàn trống */
  checkoutSpeechText?: string | null;
  /** Mã chỗ ngồi thực tế theo sơ đồ Excel (VD: 'FT3.III2A.1.289') */
  seatCode?: string;
  /** Tên Account thực tế trong đơn vị (VD: 'DongNQ6', 'ChienND22', 'ThuNDM') */
  account?: string;
  /** Cụm bàn (Island 1.1 .. 3.3) trong khoang NHÀ THUỐC */
  islandId?: string;

  // --- Runtime Simulation State (khởi tạo mặc định từ vị trí bàn) ---
  /** Trạng thái hiện tại của nhân viên */
  status: EmployeeStatus;
  /** Alias đồng bộ trạng thái (`'WALKING' | 'WORKING' | 'IDLE' ...`) */
  state?: EmployeeStatus;
  /** Vị trí hiện tại trên Canvas (pixel) */
  currentPosition: Point2D;
  /** Điểm đích đang hướng tới (nếu đang di chuyển) */
  targetPosition: Point2D | null;
  /** Lộ trình các điểm cần đi qua */
  currentPath: Point2D[];
  /** Chỉ số đoạn đường hiện tại trên currentPath (dùng cho nhân vật tuần tra như Sếp ThuNDM) */
  currentSegmentIndex?: number;
  /** Hướng nhìn hiện tại */
  facing: Direction;
  /** Hướng nhìn Isometric 2.5D (SE, SW, NE, NW) xoay theo vector di chuyển hoặc hướng ngồi */
  isoDirection?: IsoDirection;
  /** Góc hướng nhìn mượt trên mặt phẳng (radians) */
  facingAngle?: number;
  /** Tốc độ di chuyển cơ bản (pixels/second) */
  baseSpeed: number;
  /** ID của Ticket mà nhân viên đang cầm trên tay khi di chuyển */
  carryingTicketId: string | null;
  /** Số lượng tập tài liệu đang đặt trên mặt bàn của nhân viên */
  deskDocumentCount: number;
  /** Danh sách ID các Ticket đang được giao cho nhân viên này */
  assignedTicketIds: string[];
  /** Tổng số lượt bàn giao tài liệu đã thực hiện */
  completedTransfersCount: number;
  /** ID nhân viên mà Sếp ThuNDM đang đi tới thăm hỏi hoặc đứng thả tim cạnh bàn */
  roamingTargetEmployeeId?: string | null;
  /** Pha đi tuần tra thả tim của Sếp ThuNDM ('WALKING' = đang bước đi sang bàn tiếp theo, 'CHEERING' = đang dừng cạnh bàn vẫy tay thả tim) */
  roamingPhase?: 'WALKING' | 'CHEERING';
  /** Câu khen ngợi / thả tim hiện tại của Sếp ThuNDM */
  roamingSpeechText?: string | null;
  /** Tổng số lần chạy Build Jenkins CI của nhân sự này */
  jenkinsBuildsCount?: number;
  /** Chuỗi Combo / Coding Streak hiện tại (🔥 xN) từ Jira Activity & Jenkins Build */
  codingStreak?: number;
  /** Điểm năng suất tổng hợp (Transfers + Builds + Active Tickets) */
  activityScore?: number;
  /** Thứ hạng MVP trong ca làm việc (Top 1, 2, 3) */
  mvpRank?: 1 | 2 | 3 | null;
  /** Đang chạy nhanh khẩn cấp ra Trạm Server cứu bản Build bị Broken (⚡ HOTFIX SPRINT) */
  isHotfixSprinter?: boolean;
}

// ============================================================================
// 3. JIRA TICKET & WORKFLOW TYPES
// ============================================================================

/**
 * Các trạng thái của Jira Ticket trong luồng phát triển phần mềm.
 * Khi chuyển sang 'DONE', nhân viên cuối cùng sẽ mang chồng tài liệu về bàn PM.
 */
export type TicketStatus =
  | 'BACKLOG'
  | 'TODO'
  | 'IN_PROGRESS'
  | 'CODE_REVIEW'
  | 'QA_TESTING'
  | 'READY_FOR_DEPLOY'
  | 'DONE';

/** Độ ưu tiên của Ticket (quyết định màu sắc chồng tài liệu) */
export type TicketPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

/** Loại Ticket Jira */
export type TicketType = 'STORY' | 'TASK' | 'BUG' | 'HOTFIX' | 'EPIC';

/** Lịch sử luân chuyển một bước của Ticket */
export interface TicketTransitionHistory {
  id: string;
  timestamp: string;
  fromStatus: TicketStatus | null;
  toStatus: TicketStatus;
  fromEmployeeId: string | null;
  toEmployeeId: string;
  comment: string;
}

/** Cấu trúc dữ liệu chuẩn của một Jira Ticket trong mô phỏng */
export interface JiraTicket {
  /** ID nội bộ (VD: TICKET-001) */
  id: string;
  /** Jira Key hiển thị (VD: FRT-101, FRT-102) */
  key: string;
  /** Tiêu đề ngắn của Ticket */
  summary: string;
  /** Mô tả chi tiết */
  description?: string;
  /** Phân loại Ticket */
  type: TicketType;
  /** Mức độ ưu tiên */
  priority: TicketPriority;
  /** Trạng thái hiện tại trên bảng Jira */
  status: TicketStatus;
  /** Người tạo / Quản lý dự án (Mặc định là PM: EMP-01) */
  reporterId: string;
  /** Nhân viên đang chịu trách nhiệm hiện tại (EMP-01 .. EMP-30) */
  assigneeId: string;
  /** Nhân viên xử lý ở bước liền trước (để xác định ai bê tài liệu sang cho ai) */
  previousAssigneeId: string | null;
  /** Điểm độ khó (1 - 8), dùng để tính độ dày chồng tài liệu (documentStackSize) */
  storyPoints: number;
  /** Số lượng tập hồ sơ hiển thị trực quan khi nhân viên bê trên tay (1 - 5 quyển) */
  documentStackSize: number;
  /** Chuỗi lộ trình nhân sự dự kiến xử lý Ticket này (dùng cho Mock Simulation) */
  workflowChain: {
    status: TicketStatus;
    employeeId: string;
    roleNote: string;
  }[];
  /** Bước hiện tại trong chuỗi workflowChain */
  currentStepIndex: number;
  /** Đánh dấu tài liệu của Ticket Done đã được mang về đặt lên bàn PM hay chưa */
  deliveredToPM: boolean;
  /** Thời điểm tạo (ISO string hoặc timestamp) */
  createdAt: string;
  /** Thời điểm cập nhật gần nhất */
  updatedAt: string;
  /** Lịch sử các lần bàn giao tài liệu của Ticket này */
  history: TicketTransitionHistory[];
}

// ============================================================================
// 4. DOCUMENT TRANSFER & ANIMATION QUEUE TYPES
// ============================================================================

/** Các pha của một tác vụ bê chồng tài liệu từ bàn A sang bàn B (hoặc về bàn PM) */
export type DocumentTransferPhase =
  | 'QUEUED'            // Đang chờ trong hàng đợi (nhân viên đang bận chuyến trước)
  | 'PICKING_UP'        // Nhân viên đứng dậy và nhấc chồng tài liệu khỏi mặt bàn
  | 'WALKING_TO_TARGET' // Đang đi dọc hành lang cầm theo chồng tài liệu
  | 'HANDING_OVER'      // Đang đặt chồng tài liệu lên bàn người nhận / bàn PM
  | 'RETURNING_TO_DESK' // Đã giao xong, đang đi bộ tay không về lại bàn của mình
  | 'COMPLETED';        // Đã về tới ghế ngồi, hoàn tất 1 chu trình bàn giao

/**
 * Tác vụ mô phỏng hành động Nhân viên A bê chồng tài liệu sang Nhân viên B
 * hoặc mang về bàn PM khi Ticket chuyển sang trạng thái DONE.
 */
export interface DocumentTransferTask {
  /** Mã tác vụ duy nhất */
  id: string;
  /** ID của Jira Ticket gắn với chồng tài liệu */
  ticketId: string;
  /** Mã Jira Key hiển thị trên chồng tài liệu (VD: FRT-108) */
  ticketKey: string;
  /** Tiêu đề ngắn của Ticket */
  ticketSummary: string;
  /** Độ ưu tiên (để tô màu tập hồ sơ trên tay nhân viên) */
  ticketPriority: TicketPriority;
  /** Trạng thái mới của Ticket trong lần di chuyển này */
  targetStatus: TicketStatus;
  /** Nhân viên đứng dậy mang tài liệu đi (Source Employee) */
  fromEmployeeId: string;
  /** Nhân viên nhận tài liệu (Target Employee; nếu Ticket DONE thì chính là PM EMP-01) */
  toEmployeeId: string;
  /** Bàn xuất phát */
  fromDeskId: string;
  /** Bàn đích đến */
  toDeskId: string;
  /**
   * Cờ đánh dấu đây là chuyến bàn giao cuối cùng về cho PM khi Ticket = DONE.
   * Khi true, giao diện sẽ hiển thị hiệu ứng đặc biệt (dấu tích xanh DONE về bàn PM).
   */
  isReturnToPM: boolean;
  /** Số lượng tài liệu trong chồng hồ sơ (1..5) */
  documentStackSize: number;
  /** Pha thực thi hiện tại */
  phase: DocumentTransferPhase;
  /** Danh sách tọa độ điểm (A* path) lượt đi từ bàn A sang bàn B */
  outboundPath: Point2D[];
  /** Danh sách tọa độ điểm (A* path) lượt quay về từ bàn B về lại bàn A */
  returnPath: Point2D[];
  /** Chỉ số đoạn đường hiện tại trên path */
  currentSegmentIndex: number;
  /** Tiến độ tổng thể của chuyến đi (0.0 -> 1.0) */
  progress: number;
  /** Thời gian bắt đầu tác vụ (ms) */
  startedAt: number;
  /** Thời gian hoàn tất tác vụ (ms) */
  completedAt?: number;
  /** Mô tả ngắn hiển thị trên Activity Feed (VD: "Dev Hùng mang tài liệu FRT-102 sang QA Lan") */
  description: string;
}

/** Bản ghi nhật ký hoạt động hiển thị trên bảng Activity Feed */
export interface ActivityLogEntry {
  id: string;
  timestamp: string;
  ticketKey: string;
  ticketStatus: TicketStatus;
  fromEmployeeId: string;
  fromEmployeeName: string;
  toEmployeeId: string;
  toEmployeeName: string;
  isReturnToPM: boolean;
  message: string;
  type: 'CREATED' | 'HANDOFF' | 'RETURN_TO_PM' | 'COMPLETED';
}

// ============================================================================
// 5. SIMULATION CONFIGURATION & ENGINE STATE
// ============================================================================

/** Cấu hình điều khiển Simulation Loop và hiển thị Canvas */
export interface SimulationConfig {
  /** Đang chạy hay tạm dừng */
  isRunning: boolean;
  /** Hệ số tốc độ di chuyển và sinh sự kiện (0.5x, 1x, 2x, 4x) */
  speedMultiplier: number;
  /** Tự động phát sinh và luân chuyển Ticket định kỳ trong chế độ Demo Pilot */
  autoSimulate: boolean;
  /** Chu kỳ tự động kích hoạt bước chuyển Ticket tiếp theo (ms) ở tốc độ 1x */
  autoStepIntervalMs: number;
  /** Số lượng Ticket hoạt động đồng thời tối đa trong chế độ tự động */
  maxConcurrentActiveTickets: number;
  /** Hiển thị lưới ô vuông (Grid 30x30px) trên sàn văn phòng */
  showGrid: boolean;
  /** Hiển thị các điểm nút hành lang (Waypoints) và đường nối */
  showWaypoints: boolean;
  /** Hiển thị đường đi dự kiến (Path line) khi nhân viên đang bê tài liệu (mặc định: false để sàn sạch bong) */
  showActivePaths: boolean;
  /** Alias tương thích cho showActivePaths (mặc định: false) */
  showPaths?: boolean;
  /** Hiển thị tên và Role của toàn bộ 30 nhân viên trên Canvas */
  showEmployeeLabels: boolean;
  /** Kích thước 1 ô lưới chuẩn (px) */
  tileSize: number;
  /** Chiều rộng Canvas chuẩn (px) */
  canvasWidth: number;
  /** Chiều cao Canvas chuẩn (px) */
  canvasHeight: number;
  /** Mã nhân viên của Project Manager nhận tài liệu khi Ticket Done (mặc định: 'EMP-01') */
  pmEmployeeId: string;
  /** Bật/Tắt chế độ Bản đồ nhiệt 9 Cụm bàn (Island Activity Heatmap) trên mặt sàn */
  showIslandHeatmap?: boolean;
  /** Bật/Tắt bảng xếp hạng Top 3 Chiến Thần Giao Việc & Build CI (Mini MVP Podium) */
  showMvpPodium?: boolean;
  /** Bật/Tắt chế độ Smart Camera tự động xoay vòng 30s/Sếp qua 4 vị Sếp khi không có Event */
  autoCycleBosses?: boolean;
  /** Giới hạn số ghế mở trên bản đồ (12 ghế / 30 ghế / FULL) để test luồng hết chỗ ra Giếng trời hút thuốc */
  maxOpenSeats?: 12 | 30 | 'FULL';
}

// ============================================================================
// 5B. JENKINS CI/UAT/RELEASE SERVER CLUSTERS & BUILD JOB TYPES
// ============================================================================

export type JenkinsClusterId = 'CI' | 'UAT' | 'RELEASE';

/** Cấu hình không gian của Cụm Máy Chủ Build 3D (`JENKINS SERVER CLUSTERS`) trên Bản đồ */
export interface JenkinsServerStation {
  id: string;
  deskId: string;
  clusterId?: JenkinsClusterId;
  ledColor?: string;
  wingLabel?: string;
  title: string;
  shortTitle: string;
  jobName: string;
  rssUrl: string;
  proxyRssUrl: string;
  wx: number;
  wy: number;
  ww: number;
  wh: number;
  /** Vị trí bàn điều khiển 3 màn hình ghép (Triple-Monitor Server Console) */
  consolePosition: Point2D;
  /** Vị trí nhân viên đứng gõ bàn phím chạy build trước Trạm Server */
  operatorPosition: Point2D;
  /** Ô lưới walkable trên hành lang để định tuyến A* tới Trạm Server */
  operatorGrid: GridCoord;
  /** Hướng quay mặt của kỹ sư khi đứng thao tác trên bàn phím Server */
  operatorFacing: Direction;
  /** Tọa độ focus Camera Isometric khi bấm nút "🖥️ Focus Jenkins Server" */
  cameraFocusWorld: {
    x: number;
    y: number;
    zoom: number;
  };
}

/** Một bản ghi Job Build từ `oneclickv4-build-ci` hoặc `oneclickv4-build-uat` */
export interface JenkinsBuildJobItem {
  id: string;
  /** Khóa định danh chống trùng lặp chuẩn: `jenkins:${jobName}:#${buildNumber}:${status}` */
  fingerprint?: string;
  /** Số thứ tự sự kiện đơn điệu trên Server (Monotonic Cursor `seq`) */
  seq?: number;
  buildNumber: number;
  jobName: string;
  clusterId?: JenkinsClusterId;
  /** Trạng thái gốc từ RSS title: 'stable' | 'back to normal' | 'broken' | 'aborted' | 'Building' */
  statusText: string;
  /** Mã kết quả chuẩn hóa */
  status: 'SUCCESS' | 'FAILURE' | 'UNSTABLE' | 'BUILDING';
  result?: 'SUCCESS' | 'FAILURE' | 'UNSTABLE' | 'BUILDING';
  /** Thời gian hiển thị tương đối (VD: '2m ago', '11m ago', '28m ago') */
  timeAgo: string;
  relativeTime?: string;
  publishedAt?: string;
  triggeredByAccount?: string;
  triggeredBy?: string;
  ticketKey?: string;
  url?: string;
  link?: string;
}

/** Thống kê bộ lọc chống trùng lặp 2 tầng (RAM Cache Deduplication & Monotonic Cursor `afterSeq`) */
export interface RamDedupStats {
  totalPolls: number;
  totalRawEntriesRead: number;
  uniqueEventsEmitted: number;
  duplicatesDropped: number;
  jiraEntriesRead?: number;
  jenkinsEntriesRead?: number;
  jiraDuplicatesDropped?: number;
  jenkinsDuplicatesDropped?: number;
  cacheSize?: number;
  maxCacheSize?: number;
  ringBufferSize?: number;
  lastPollAt?: string | null;
  lastPollSource?: string;
}

/** Các pha của luồng Kỹ sư đi bộ lại Trạm Máy Tính Server để chạy Build Jenkins (`oneclickv4-build-ci`) */
export type JenkinsBuildWalkPhase =
  | 'WALKING_TO_SERVER'
  | 'BUILDING_AT_SERVER'
  | 'RETURNING_TO_DESK'
  | 'COMPLETED';

/** Tác vụ Kỹ sư đi bộ từ bàn làm việc theo đường A* tới Trạm Server Jenkins để gõ lệnh chạy build */
export interface ActiveJenkinsBuildTask {
  id: string;
  buildNumber: number;
  jobName: string;
  clusterId?: JenkinsClusterId;
  stationId?: string;
  serverDeskId?: string;
  employeeId: string;
  employeeAccount: string;
  employeeSeatCode: string;
  seatCode?: string;
  ticketKey: string;
  phase: JenkinsBuildWalkPhase;
  outboundPath: Point2D[];
  returnPath: Point2D[];
  currentSegmentIndex: number;
  /** Tiến độ chạy bản build từ 0 -> 100 (%) khi nhân viên đang đứng tại Trạm Server */
  buildProgress: number;
  /** Thời gian đứng gõ phím build tại Trạm Server (4000 - 6000ms ở tốc độ 1x) */
  buildDurationMs?: number;
  buildElapsedMs?: number;
  startedAt: number;
  completedAt?: number;
  statusText?: string;
  /** Cờ đánh dấu đây là chuyến chạy khẩn cấp cứu bản Build bị Broken (⚡ HOTFIX SPRINT -> Back to normal ✅) */
  isHotfixRescue?: boolean;
  /** Số hiệu bản build bị Broken đang được khắc phục (VD: #2843) */
  brokenBuildNumber?: number;
}

/** Thông tin xếp hạng Top 3 MVP ("Chiến Thần Giao Việc & Build CI") */
export interface MvpLeaderboardEntry {
  rank: 1 | 2 | 3;
  employeeId: string;
  account: string;
  displayName: string;
  role: Role;
  seatCode: string;
  islandId: string;
  avatarColor: string;
  transfersCount: number;
  jenkinsBuildsCount: number;
  activeTicketsCount: number;
  streak: number;
  score: number;
}

/** Thống kê mật độ hoạt động của từng Cụm bàn (Island 1.1 .. 3.3) cho chế độ Bản Đồ Nhiệt (Heatmap) */
export interface IslandHeatmapStat {
  islandId: string;
  label: string;
  activeTicketsCount: number;
  transfersCount: number;
  buildsCount: number;
  heatScore: number;
  heatLevel: 'HOT' | 'WARM' | 'ACTIVE' | 'CALM';
}

// ============================================================================
// 6. JIRA PROVIDER ADAPTER INTERFACE (MOCK & REAL WEBHOOK READY)
// ============================================================================

/** Loại sự kiện phát ra từ Jira Adapter */
export type JiraEventType =
  | 'TICKET_CREATED'
  | 'TICKET_ASSIGNED'
  | 'TICKET_TRANSITIONED'
  | 'TICKET_DONE';

/** Payload sự kiện chuẩn hóa từ IJiraAdapter gửi vào Simulation Engine */
export interface JiraWebhookEvent {
  eventId: string;
  /** Khóa định danh chống trùng lặp 2 tầng (Fingerprint) */
  fingerprint?: string;
  /** Số thứ tự sự kiện đơn điệu từ Backend Proxy (`seq`) */
  seq?: number;
  eventType: JiraEventType;
  timestamp: string;
  ticket: JiraTicket;
  /** Nhân viên giữ ticket trước khi sự kiện xảy ra */
  fromEmployeeId: string;
  /** Nhân viên nhận ticket (Nếu eventType === 'TICKET_DONE' thì luôn là PM 'EMP-01') */
  toEmployeeId: string;
  fromStatus: TicketStatus | null;
  toStatus: TicketStatus;
  /** Cờ báo hiệu đây là bước hoàn tất ticket để mang tài liệu về bàn PM */
  isReturnToPM: boolean;
  /** Đổi Assignee thật trên Jira: duy nhất loại sự kiện LIVE làm nhân vật đi bộ mang hồ sơ sang người nhận */
  isAssigneeChange?: boolean;
  summaryMessage: string;
}

/** Tham số đầu vào khi tạo nhanh một Ticket mới */
export interface CreateTicketInput {
  summary: string;
  description?: string;
  type?: TicketType;
  priority?: TicketPriority;
  storyPoints?: number;
  /** Nhân viên đầu tiên nhận việc từ PM (nếu bỏ trống sẽ tự chọn BA hoặc Tech Lead) */
  initialAssigneeId?: string;
}

/**
 * Hợp đồng chuẩn cho Jira Provider Adapter (Adapter Pattern).
 * - Giai đoạn Demo Pilot: dùng `MockJiraAdapter`
 * - Giai đoạn Production: cắm `RealJiraWebhookAdapter` kết nối Jira Webhook / REST API
 */
export interface IJiraAdapter {
  /** Tên định danh của Adapter */
  readonly providerName: string;
  /** Chế độ hoạt động: 'mock' cho Demo Pilot, 'real-webhook' cho kết nối Jira thật */
  readonly mode: 'mock' | 'real-webhook' | 'rest-api';

  /** Khởi tạo kết nối (mở timer giả lập hoặc mở WebSocket/SSE tới Jira Webhook Relay) */
  connect(): Promise<void>;

  /** Ngắt kết nối và giải phóng tài nguyên */
  disconnect(): void;

  /** Kiểm tra trạng thái kết nối hiện tại */
  isConnected(): boolean;

  /** Lấy danh sách Jira Tickets khởi tạo ban đầu cho văn phòng */
  getInitialTickets(): Promise<JiraTicket[]>;

  /** Tạo mới một Jira Ticket (khởi phát từ bàn PM) */
  createTicket(input: CreateTicketInput): Promise<JiraTicket>;

  /**
   * Chuyển trạng thái và bàn giao Ticket sang nhân viên tiếp theo.
   * Nếu `nextStatus === 'DONE'`, hệ thống sẽ tự động kích hoạt luồng mang tài liệu về bàn PM.
   */
  transitionTicket(
    ticketId: string,
    nextStatus: TicketStatus,
    nextAssigneeId: string,
    comment?: string
  ): Promise<JiraTicket>;

  /**
   * Kích hoạt bước tiếp theo trong kịch bản tự động của một Ticket (dành cho Demo Pilot).
   * Nếu không truyền `ticketId`, Adapter sẽ chọn ngẫu nhiên một Ticket đang active để đẩy tiến độ.
   */
  advanceTicketWorkflow?(ticketId?: string): Promise<JiraWebhookEvent | null>;

  /**
   * Đăng ký lắng nghe luồng sự kiện Jira thời gian thực.
   * @returns Hàm hủy đăng ký (unsubscribe)
   */
  onTicketEvent(listener: (event: JiraWebhookEvent) => void): () => void;
}
