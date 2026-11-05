/**
 * Office Simulation Engine & Reactive Store (`simulationStore.ts`)
 *
 * Manages the entire 30-employee Virtual FRT Office 2D state:
 * - 30 Employees (`EMP-01` .. `EMP-30`): sitting/typing at desk, picking up documents,
 *   walking along corridors carrying document stacks (`A -> B`), handing over at target desk,
 *   returning to their own desk, and delivering `DONE` tickets back to the PM (`EMP-01`).
 * - Jira Tickets lifecycle & workflow transitions via `IJiraAdapter` (`MockJiraAdapter` by default).
 * - Document Transfer Queue (`activeTransfers` & `queuedTransfers`) so each employee executes
 *   transfers sequentially without cloning/teleporting.
 * - Simulation controls: Speed (`1x`, `2x`, `4x`, `Pause`), `Auto-Pilot`, and `Sprint Rush` mode.
 * - Real-time `ActivityLogEntry` feed, floating Speech Bubbles, and PM Desk DONE celebration counter.
 */

import React, { createContext, useContext, useSyncExternalStore } from 'react';
import {
  ActiveJenkinsBuildTask,
  ActivityLogEntry,
  CreateTicketInput,
  DocumentTransferPhase,
  DocumentTransferTask,
  Employee,
  EmployeeStatus,
  IJiraAdapter,
  IslandHeatmapStat,
  JenkinsBuildJobItem,
  JiraTicket,
  JiraWebhookEvent,
  MvpLeaderboardEntry,
  Point2D,
  RamDedupStats,
  SimulationConfig,
  TicketPriority,
  TicketStatus,
} from '../types/office';
import {
  BOSS_ROTATION_IDS,
  EMPLOYEES,
  EMPLOYEE_BY_ID,
  FEMALE_MANAGER_ID,
  MANAGER_DOANNT19_ID,
  MANAGER_TOANLBK_ID,
  MANAGER_VANLTB8_ID,
  PROJECT_MANAGER,
} from '../data/employees';
import {
  ALL_JOINED_DESK_ISLANDS,
  ATRIUM_SMOKING_SPOTS,
  BOSS_WING_PATROL_LOOPS,
  DEFAULT_SIMULATION_CONFIG,
  DESK_BY_EMPLOYEE_ID,
  DESK_BY_ID,
  ENTRANCE_DOOR_SPAWN_POINT,
  JENKINS_RELEASE_SERVER_STATION,
  JENKINS_SERVER_CLUSTERS,
  JENKINS_SERVER_STATION,
  JENKINS_UAT_SERVER_STATION,
  NHA_THUOC_ISLANDS,
  PM_DESK,
} from '../data/officeLayout';
import {
  directionToIsoDirection,
  findDeskToDeskPath,
  findGridPathAStar,
  getDirectionBetweenPoints,
  getIsoDirectionBetweenPoints,
  getIsoFacingAngleBetweenPoints,
  gridToPixel,
  isoDirectionToAngle,
  pixelToGrid,
  simplifyOrthogonalPath,
  stepAlongPath,
} from './pathfinding';
import {
  getSpeechBubblesForTransition,
  MockJiraAdapter,
  mockJiraAdapter,
} from './mockJiraAdapter';
import {
  DEFAULT_JENKINS_RECENT_BUILDS,
  FRT_JENKINS_RSS_PROXY_URL,
  FRT_JENKINS_UAT_RSS_PROXY_URL,
  FRT_JIRA_ACTIVITY_PROXY_URL,
  PUBLIC_OFFICE_STREAM_API_URL,
  PublicOfficeStreamResponse,
  SAMPLE_FRT_JENKINS_RSS_XML,
  SAMPLE_FRT_JENKINS_UAT_RSS_XML,
  SAMPLE_FRT_JIRA_ACTIVITY_XML,
  computeJenkinsBuildFingerprint,
  parseJenkinsRssXml,
  parseJiraActivityAtomXml,
  resolveEmployeeByAccountCaseInsensitive,
} from '../adapters/RealJiraWebhookAdapter';

// ============================================================================
// 1. EXTENDED RUNTIME TYPES (SPEECH BUBBLES, CELEBRATIONS, STATS)
// ============================================================================

export interface SpeechBubbleItem {
  id: string;
  employeeId: string;
  text: string;
  variant: 'info' | 'handoff' | 'bug' | 'done';
  createdAt: number;
  expiresAt: number;
}

export interface PmCelebrationEffect {
  id: string;
  ticketKey: string;
  fromEmployeeName: string;
  position: Point2D;
  createdAt: number;
  expiresAt: number;
}

export interface OfficeSimulationStats {
  totalEmployees: number;
  idleEmployeesCount: number;
  workingEmployeesCount: number;
  walkingEmployeesCount: number;
  totalTickets: number;
  todoCount: number;
  inProgressCount: number;
  codeReviewCount: number;
  qaTestingCount: number;
  doneCount: number;
  activeTransfersCount: number;
  queuedTransfersCount: number;
  pmDeliveredStackCount: number;
}

export type DataSourceMode = 'LIVE_FRT' | 'MOCK_PILOT';

export type LiveAuthType = 'NONE' | 'BASIC' | 'BEARER' | 'COOKIE';

export type LiveSyncStatus = 'IDLE' | 'SYNCING' | 'OK' | 'ERROR';

export interface LiveFrtConfig {
  jiraUrl: string;
  jenkinsUrl: string;
  authType: LiveAuthType;
  username: string;
  passwordOrToken: string;
  pollIntervalSec: number;
  clearMockOnLive: boolean;
  lastSyncAt: string | null;
  lastSyncStatus: LiveSyncStatus;
  lastSyncError: string | null;
  liveEventsProcessed: number;
  lastJiraEntryCount?: number;
  lastJenkinsBuildCount?: number;
  /** Con trỏ Monotonic Cursor (`afterSeq`) đồng bộ với Backend Proxy `/api/public/office-stream` */
  lastServerSeq?: number;
  /** Số sự kiện trùng lặp vừa bị chặn trong lần Poll/Ingest gần nhất */
  lastDuplicatesDroppedInBatch?: number;
  /** Thống kê 2-Layer RAM Cache Deduplication (Server + Client Idempotency Guard) */
  dedupStats?: RamDedupStats;
}

export const DEFAULT_LIVE_FRT_CONFIG: LiveFrtConfig = {
  jiraUrl:
    'https://reqs.frt.vn/activity?maxResults=10&providers=issues&os_authType=basic&title=undefined',
  jenkinsUrl: 'https://jenkins-osp.frt.vn/job/oneclickv4-build-ci/rssAll',
  authType: 'BASIC',
  username: '',
  passwordOrToken: '',
  pollIntervalSec: 10,
  clearMockOnLive: true,
  lastSyncAt: null,
  lastSyncStatus: 'IDLE',
  lastSyncError: null,
  liveEventsProcessed: 0,
  lastJiraEntryCount: 0,
  lastJenkinsBuildCount: 0,
  lastServerSeq: 0,
  lastDuplicatesDroppedInBatch: 0,
  dedupStats: {
    totalPolls: 0,
    totalRawEntriesRead: 0,
    uniqueEventsEmitted: 0,
    duplicatesDropped: 0,
    cacheSize: 0,
    maxCacheSize: 2000,
  },
};

const STORAGE_KEY_DATA_SOURCE_MODE = 'frt_office_data_source_mode_v1';
const STORAGE_KEY_LIVE_CONFIG = 'frt_office_live_config_v1';

function loadPersistedDataSourceMode(): DataSourceMode {
  if (typeof window === 'undefined') return 'MOCK_PILOT';
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY_DATA_SOURCE_MODE);
    if (raw === 'LIVE_FRT' || raw === 'MOCK_PILOT') return raw;
  } catch {
    // ignore storage errors
  }
  return 'MOCK_PILOT';
}

function savePersistedDataSourceMode(mode: DataSourceMode): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY_DATA_SOURCE_MODE, mode);
  } catch {
    // ignore storage errors
  }
}

function loadPersistedLiveConfig(): LiveFrtConfig {
  if (typeof window === 'undefined') return { ...DEFAULT_LIVE_FRT_CONFIG };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY_LIVE_CONFIG);
    if (!raw) return { ...DEFAULT_LIVE_FRT_CONFIG };
    const parsed = JSON.parse(raw) as Partial<LiveFrtConfig>;
    return {
      ...DEFAULT_LIVE_FRT_CONFIG,
      ...parsed,
      lastSyncStatus:
        parsed.lastSyncStatus === 'SYNCING'
          ? 'IDLE'
          : parsed.lastSyncStatus ?? 'IDLE',
    };
  } catch {
    return { ...DEFAULT_LIVE_FRT_CONFIG };
  }
}

function savePersistedLiveConfig(cfg: LiveFrtConfig): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY_LIVE_CONFIG, JSON.stringify(cfg));
  } catch {
    // ignore storage errors
  }
}

function encodeBasicAuthBase64(username: string, passwordOrToken: string): string {
  const raw = `${username}:${passwordOrToken}`;
  try {
    return btoa(unescape(encodeURIComponent(raw)));
  } catch {
    return btoa(raw);
  }
}

export interface OfficeSimulationState {
  employees: Employee[];
  employeeById: Record<string, Employee>;
  tickets: JiraTicket[];
  activeTransfers: DocumentTransferTask[];
  queuedTransfers: DocumentTransferTask[];
  /** Tác vụ Kỹ sư đi bộ lại Trạm Máy Tính Server để chạy Build Jenkins (`oneclickv4-build-ci`) */
  activeJenkinsBuild: ActiveJenkinsBuildTask | null;
  /** Danh sách các Jobs gần nhất từ `https://jenkins-osp.frt.vn/job/oneclickv4-build-ci/rssAll` */
  jenkinsBuilds: JenkinsBuildJobItem[];
  /** Thời điểm vừa hoàn tất bản build Jenkins gần nhất (để giữ bảng Hologram sáng thêm vài giây) */
  jenkinsLastCompletedAt: number | null;
  /** Cờ cảnh báo Trạm Server Jenkins đang bị Build Broken (`FAILURE / broken`) phát đèn đỏ chớp nháy */
  isJenkinsBrokenAlert: boolean;
  /** Số hiệu bản Build đang bị Broken cần Hotfix (VD: #2843) */
  brokenBuildNumber: number | null;
  /** Thời điểm vừa cứu xong Build Broken (`Back to normal ✅`) để nổ pháo hoa xanh lá ăn mừng tại Trạm Server */
  jenkinsHotfixCelebrationAt: number | null;
  /** Bảng xếp hạng Top 3 MVP ("Chiến Thần Giao Việc & Build CI") tính từ Jira Activity & Jenkins RSS */
  mvpLeaderboard: MvpLeaderboardEntry[];
  /** Bản đồ nhiệt mật độ hoạt động của 9 Cụm bàn (`ISLAND-1.1` .. `ISLAND-3.3`) */
  islandHeatmap: Record<string, IslandHeatmapStat>;
  activityLogs: ActivityLogEntry[];
  speechBubbles: SpeechBubbleItem[];
  pmCelebrations: PmCelebrationEffect[];
  config: SimulationConfig;
  /** Chế độ nguồn dữ liệu: 'LIVE_FRT' (reqs.frt.vn & jenkins-osp.frt.vn thật, tắt Mock) hoặc 'MOCK_PILOT' */
  dataSourceMode: DataSourceMode;
  /** Cấu hình kết nối trực tiếp Jira & Jenkins FRT */
  liveConfig: LiveFrtConfig;
  isSprintRush: boolean;
  sprintRushEndsAt: number | null;
  selectedEmployeeId: string | null;
  selectedTicketId: string | null;
  selectedDeskId: string | null;
  /** Số lượng ghế làm việc đã được nhân viên Check-In trong ngày */
  checkedInCount: number;
  /** Số lượng nhân viên đến muộn khi đã hết bàn -> đang đứng hút thuốc quanh 3 Giếng trời */
  smokingCount: number;
  /** Ngày hiện tại (`YYYY-MM-DD`) để tự động reset toàn bộ bàn làm việc khi qua ngày mới */
  currentDayKey: string;
  stats: OfficeSimulationStats;
  tickCount: number;
}

export interface OfficeSimulationActions {
  /** Advance simulation physics by deltaTimeMs (milliseconds) */
  tick: (deltaTimeMs: number) => void;
  /** Play / Pause toggle */
  toggleRunning: () => void;
  setRunning: (isRunning: boolean) => void;
  /** Set simulation speed multiplier (1, 2, 4, or 0.5) */
  setSpeedMultiplier: (speed: number) => void;
  /** Toggle automatic background ticket progression */
  toggleAutoSimulate: () => void;
  setAutoSimulate: (enabled: boolean) => void;
  /** Chuyển đổi giữa Chế độ Dữ liệu Thật ('LIVE_FRT' — tắt Mock) và Chế độ Giả lập ('MOCK_PILOT') */
  setDataSourceMode: (mode: DataSourceMode) => void;
  /** Cập nhật thông số cấu hình Live Jira & Jenkins (URL, Basic Auth, Polling interval...) */
  updateLiveConfig: (patch: Partial<LiveFrtConfig>) => void;
  /** 1-Click xóa sạch toàn bộ dữ liệu Mock (tickets giả, lượt đi bộ giả, logs giả) trên màn hình */
  clearMockData: () => void;
  /** 🌅 Reset Ngày Mới: Giải phóng 100% bàn làm việc về trạng thái trống hoàn toàn */
  resetNewDayEmptyDesks: () => void;
  /** 🚬 Test Full Chỗ -> Ra Giếng Trời Hút Thuốc: Lấp đầy ghế và cử các thành viên còn lại ra hành lang Giếng trời hút thuốc */
  triggerTestFullSeatsSmoking: () => void;
  /** Thay đổi giới hạn số ghế mở trong ngày (12 ghế để dễ test full, 30 ghế, hoặc FULL 96 ghế) */
  setMaxOpenSeats: (limit: 12 | 30 | 'FULL') => void;
  /** Trigger or toggle high-intensity Sprint Rush mode */
  triggerSprintRush: (durationMs?: number) => Promise<void>;
  stopSprintRush: () => void;
  toggleSprintRush: () => Promise<void>;
  /** Update partial simulation config (grid, waypoints, active paths, labels) */
  updateConfig: (partial: Partial<SimulationConfig>) => void;
  /** Create a custom Jira ticket starting from PM */
  createTicket: (input: CreateTicketInput) => Promise<JiraTicket>;
  /** 1-Click generate a realistic FRT engineering ticket */
  createRandomTicket: (
    category?: 'BACKEND' | 'FRONTEND' | 'MOBILE' | 'DEVOPS'
  ) => Promise<JiraTicket>;
  /** Transition ticket to a specific status and trigger physical document walk */
  transitionTicket: (
    ticketIdOrKey: string,
    nextStatus: TicketStatus,
    nextAssigneeId?: string,
    comment?: string
  ) => Promise<JiraTicket | null>;
  /** Advance ticket to its next logical workflow step (TODO -> IN_PROGRESS -> CODE_REVIEW -> QA_TESTING -> DONE) */
  advanceTicket: (ticketIdOrKey?: string) => Promise<JiraWebhookEvent | null>;
  /** QA/Lead rejects ticket with bug -> walks red bug stack back to Developer */
  rejectTicketWithBug: (
    ticketIdOrKey: string,
    reason?: string
  ) => Promise<JiraWebhookEvent | null>;
  /** Immediately mark ticket DONE -> current holder carries green DONE stack to PM desk (EMP-01) */
  completeTicketToPM: (ticketIdOrKey: string) => Promise<JiraTicket | null>;
  /** Direct manual transfer of a ticket from Employee A to Employee B (matches JiraControlPanel & OfficeCanvas2D signature) */
  manualTransfer: (
    ticketIdOrKey: string,
    fromEmployeeId: string,
    toEmployeeId: string,
    nextStatus?: TicketStatus,
    comment?: string
  ) => Promise<JiraTicket | null>;
  /** Manually trigger a document transfer walk from Employee A to Employee B */
  dispatchManualTransfer: (params: {
    fromEmployeeId: string;
    toEmployeeId: string;
    ticketKey?: string;
    ticketSummary?: string;
    priority?: TicketPriority;
    targetStatus?: TicketStatus;
    isReturnToPM?: boolean;
  }) => DocumentTransferTask | null;
  /** Kích hoạt Kỹ sư đứng dậy đi bộ tới Trạm Máy Tính Server chạy Build Jenkins (`oneclickv4-build-ci` / `oneclickv4-build-uat` / `oneclickv4-build-release`) */
  triggerJenkinsBuild: (params?: {
    employeeId?: string;
    account?: string;
    ticketKey?: string;
    buildNumber?: number;
    statusText?: string;
    jobName?: string;
  }) => ActiveJenkinsBuildTask | null;
  /** 🚨 Kích hoạt sự kiện Jenkins Build Broken Alert & cử Kỹ sư chạy nhanh (`⚡ HOTFIX SPRINT`) ra cứu build -> Back to normal ✅ */
  triggerJenkinsBrokenHotfix: (params?: {
    employeeId?: string;
    account?: string;
    ticketKey?: string;
    brokenBuildNumber?: number;
    jobName?: string;
  }) => ActiveJenkinsBuildTask | null;
  /** Đọc Atom XML từ `https://reqs.frt.vn/activity` và kích hoạt nhân vật di chuyển giao tài liệu */
  ingestJiraActivityXml: (xmlText: string) => number;
  /** Đọc Atom/RSS XML từ `https://jenkins-osp.frt.vn/job/oneclickv4-build-ci/rssAll` và kích hoạt nhân vật đi build */
  ingestJenkinsRssXml: (xmlText: string) => number;
  /** Gọi trực tiếp Backend Proxy `/api/public/office-stream?afterSeq=...` hoặc Vite Proxy */
  fetchLiveFrtFeeds: (basicAuthHeader?: string) => Promise<{
    jiraCount: number;
    jenkinsCount: number;
    duplicatesDropped?: number;
    latestSeq?: number;
    source: 'live-proxy' | 'sample-fallback' | 'live-error';
    message: string;
    jiraError?: string | null;
    jenkinsError?: string | null;
    httpStatus?: number | null;
  }>;
  /** Reset bộ nhớ đệm chống trùng lặp 2 tầng (Client `processedEventFingerprints` & Server RAM Cache) */
  resetDedupCache: () => Promise<void>;
  /** Clear activity log entries */
  clearActivityLogs: () => void;
  /** Selection helpers for Inspector panels */
  selectEmployee: (employeeId: string | null) => void;
  selectTicket: (ticketId: string | null) => void;
  selectDesk: (deskId: string | null) => void;
  /** Swap Jira Adapter (e.g. from MockJiraAdapter to RealJiraWebhookAdapter) */
  setJiraAdapter: (adapter: IJiraAdapter) => Promise<void>;
  /** Reset entire office simulation to clean initial state */
  resetSimulation: () => void;
}

export type OfficeSimulationStoreValue = OfficeSimulationState &
  OfficeSimulationActions & {
    /** Direct reference to mutable high-frequency state for 60fps Canvas renderers */
    getMutableState: () => OfficeSimulationState;
  };

// ============================================================================
// 2. PHASE DURATION CONSTANTS (AT 1X SPEED)
// ============================================================================

const PICKUP_DURATION_MS = 380;
const HANDOVER_DURATION_MS = 620;
const SPEECH_BUBBLE_DURATION_MS = 3200;
const PM_CELEBRATION_DURATION_MS = 2800;
const MAX_ACTIVITY_LOGS = 80;

/**
 * Danh sách các nhân viên quanh 9 cụm đảo bàn của Khoang NHÀ THUỐC (`FT3.III2A.1`)
 * mà Sếp nữ `ThuNDM` lần lượt đi bộ tuần tra ghé thăm & thả tim khích lệ (`❤️ 💖 ✨`).
 */
const MANAGER_PATROL_EMPLOYEE_IDS: string[] = [
  'EMP-01', // DongNQ6 (PM - Cụm 3.2 - Bàn Đỏ)
  'EMP-04', // ThanhDQ13 (Tech Lead - Cụm 2.1 - Ô Vàng)
  'EMP-07', // ChienND22 (Backend - Cụm 2.1)
  'EMP-12', // TrungTM7 (Backend - Cụm 1.1)
  'EMP-02', // ThoaPTN1 (BA - Cụm 1.2)
  'EMP-05', // LuuTV6 (FE Lead - Cụm 2.2)
  'EMP-15', // BaoNAT (Frontend - Cụm 2.2)
  'EMP-16', // ThuanHM12 (Frontend - Cụm 2.2)
  'EMP-06', // ManhPT13 (Mobile Lead - Cụm 2.3)
  'EMP-18', // TriPHC (Frontend - Cụm 2.3)
  'EMP-19', // KienNT178 (Frontend - Cụm 2.3)
  'EMP-30', // SonNA2 (DevOps - Cụm 3.3)
  'EMP-29', // TienHK (DevOps - Cụm 3.3)
  'EMP-25', // TranTNN (QA Lead - Cụm 3.2)
  'EMP-03', // HieuNT181 (KH) (BA - Cụm 3.2)
  'EMP-26', // TrucNN4 (QA - Cụm 3.2)
  'EMP-21', // KhoaLNT (Mobile - Cụm 3.1)
  'EMP-23', // LyNH16 (Mobile - Cụm 3.1)
  'EMP-22', // HuyNT83 (Mobile - Cụm 3.1)
  'EMP-08', // CuongTN2 (Backend - Cụm 2.1)
  'EMP-14', // LanTTP (Backend - Cụm 1.1)
];

function buildManagerPatrolPath(
  fromPos: Point2D,
  targetEmployeeId: string
): Point2D[] {
  const targetDesk =
    DESK_BY_EMPLOYEE_ID[targetEmployeeId] ??
    DESK_BY_ID[EMPLOYEE_BY_ID[targetEmployeeId]?.deskId ?? 'DESK-01'] ??
    PM_DESK;
  const startGrid = pixelToGrid(fromPos.x, fromPos.y);
  const gridSteps = findGridPathAStar(startGrid, targetDesk.handoffGrid);
  const corridorPixels = gridSteps.map((g) => gridToPixel(g.col, g.row));
  const simplified = simplifyOrthogonalPath([
    { ...fromPos },
    ...corridorPixels,
    { ...targetDesk.handoffPoint },
  ]);
  return simplified.length >= 2
    ? simplified
    : [{ ...fromPos }, { ...targetDesk.handoffPoint }];
}

function getManagerCheerSpeech(targetEmp?: Employee, index = 0): string {
  const acc = (targetEmp?.account || targetEmp?.displayName || 'các bạn').replace(' (KH)', '');
  const templates = [
    `Thả tim khích lệ ${acc} nhé! ❤️`,
    `Team Nhà Thuốc làm tốt lắm! Tặng tim cho ${acc} nè 💖`,
    `Cố lên nhé ${acc} ơi! Sếp ThuNDM thả ngàn tim ❤️✨`,
    `Code & xử lý task mượt quá ${acc} ơi! Thả tim nè 💖✨`,
    `Tuyệt vời lắm ${acc}! Cố lên nhé các bạn ơi! ❤️💕`,
  ];
  return templates[index % templates.length];
}

function buildPointToPointPatrolPath(fromPos: Point2D, targetPos: Point2D): Point2D[] {
  const startGrid = pixelToGrid(fromPos.x, fromPos.y);
  const endGrid = pixelToGrid(targetPos.x, targetPos.y);
  const gridSteps = findGridPathAStar(startGrid, endGrid);
  const corridorPixels = gridSteps.map((g) => gridToPixel(g.col, g.row));
  const simplified = simplifyOrthogonalPath([
    { ...fromPos },
    ...corridorPixels,
    { ...targetPos },
  ]);
  return simplified.length >= 2 ? simplified : [{ ...fromPos }, { ...targetPos }];
}

function getBossSpeechByMood(emp: Employee, index = 0): string {
  if (emp.managerMood === 'angry' || emp.id === MANAGER_TOANLBK_ID) {
    const angryTemplates = [
      '💢 Khẩn trương lên! Sao PR này còn chưa merge?!',
      '😡 Tập trung code đi! Trễ tiến độ Sprint bây giờ!',
      '⚡ Nhanh tay lên! UAT đang chờ bản build mới kìa!',
      '💢 Ai làm gãy build đây?! Fix ngay lập tức cho tôi!',
    ];
    return angryTemplates[index % angryTemplates.length];
  }
  if (emp.managerMood === 'happy' || emp.id === MANAGER_DOANNT19_ID) {
    const happyTemplates = [
      '😄 Chào buổi sáng cả nhà! Hôm nay code vui vẻ nhé! 🌸',
      '😊 Tuyệt vời lắm mọi người ơi! Cười tươi lên nào! ✨',
      '🌸 Cố lên nhé các tình yêu! Chiều nay có trà sữa nha! 😄',
      '✨ Team mình làm việc siêu đỉnh luôn! Yêu cả nhà! 😊',
    ];
    return happyTemplates[index % happyTemplates.length];
  }
  if (emp.managerMood === 'worried' || emp.id === MANAGER_VANLTB8_ID) {
    const worriedTemplates = [
      '😰 Ôi trời ơi không biết kịp UAT chiều nay không nữa... 💧',
      '😟 Lo quá đi mất, nhớ kiểm tra kỹ regression test nhé mọi người...',
      '💧 Hu hu còn nhiều ticket quá, anh em cố gắng giúp chị với nhé... 😰',
      '😥 Cẩn thận kẻo lỗi production nha mọi người ơi... lo quá!',
    ];
    return worriedTemplates[index % worriedTemplates.length];
  }
  return getManagerCheerSpeech(undefined, index);
}

function formatTimeHHMMSS(date = new Date()): string {
  return date.toTimeString().split(' ')[0];
}

function getCurrentDayKey(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

function cloneInitialEmployees(tickets: JiraTicket[]): Employee[] {
  const assignedMap: Record<string, string[]> = {};
  for (const t of tickets) {
    if (t.status !== 'DONE') {
      if (!assignedMap[t.assigneeId]) {
        assignedMap[t.assigneeId] = [];
      }
      assignedMap[t.assigneeId].push(t.id);
    }
  }

  return EMPLOYEES.map((emp) => {
    // 1. Sếp 1: ThuNDM (Nữ — Khoang Đông / Nhà Thuốc)
    if (emp.id === FEMALE_MANAGER_ID) {
      const startPos = gridToPixel(35, 14);
      const firstTargetId = MANAGER_PATROL_EMPLOYEE_IDS[0];
      const initialPatrolPath = buildManagerPatrolPath(startPos, firstTargetId);
      const p0 = initialPatrolPath[0];
      const p1 = initialPatrolPath[1] ?? p0;
      const initialFacing = getDirectionBetweenPoints(p0, p1, 'DOWN');
      const initialIso = getIsoDirectionBetweenPoints(p0, p1, 'SW');
      const initialAngle = getIsoFacingAngleBetweenPoints(p0, p1, isoDirectionToAngle(initialIso));

      return {
        ...emp,
        status: 'WALKING_BACK',
        currentPosition: startPos,
        targetPosition: initialPatrolPath[initialPatrolPath.length - 1] ?? startPos,
        currentPath: initialPatrolPath,
        currentSegmentIndex: 0,
        facing: initialFacing,
        isoDirection: initialIso,
        facingAngle: initialAngle,
        carryingTicketId: null,
        assignedTicketIds: [],
        deskDocumentCount: 0,
        completedTransfersCount: 0,
        roamingTargetEmployeeId: firstTargetId,
        roamingPhase: 'WALKING',
        roamingSpeechText: 'Thả tim khích lệ DongNQ6 & Team Nhà Thuốc nhé! ❤️✨',
        isCheckedIn: true,
        isSmokingAtAtrium: false,
      };
    }

    // 2. Sếp 2, 3, 4: ToanLBK (North), doannt19 (West-Central), vanltb8 (South)
    if (emp.isManager) {
      const wingKey = emp.patrolWing || 'NORTH';
      const loopWaypoints =
        BOSS_WING_PATROL_LOOPS[wingKey] ?? BOSS_WING_PATROL_LOOPS.NORTH;
      const startPos = { ...(loopWaypoints[0] ?? emp.currentPosition) };
      const nextTargetPos = loopWaypoints[1] ?? startPos;
      const initialPatrolPath = buildPointToPointPatrolPath(startPos, nextTargetPos);
      const p0 = initialPatrolPath[0];
      const p1 = initialPatrolPath[1] ?? p0;
      const initialFacing = getDirectionBetweenPoints(p0, p1, 'DOWN');
      const initialIso = getIsoDirectionBetweenPoints(p0, p1, 'SW');
      const initialAngle = getIsoFacingAngleBetweenPoints(p0, p1, isoDirectionToAngle(initialIso));

      return {
        ...emp,
        status: 'WALKING_BACK',
        currentPosition: startPos,
        targetPosition: nextTargetPos,
        currentPath: initialPatrolPath,
        currentSegmentIndex: 0,
        facing: initialFacing,
        isoDirection: initialIso,
        facingAngle: initialAngle,
        carryingTicketId: null,
        assignedTicketIds: [],
        deskDocumentCount: 0,
        completedTransfersCount: 0,
        roamingTargetEmployeeId: 'WP-1',
        roamingPhase: 'WALKING',
        roamingSpeechText: getBossSpeechByMood(emp, 0),
        isCheckedIn: true,
        isSmokingAtAtrium: false,
      };
    }

    const desk = DESK_BY_ID[emp.deskId];
    const assignedIds = assignedMap[emp.id] ?? [];
    const hasActiveWork = assignedIds.length > 0;
    let initialStatus: EmployeeStatus = 'IDLE';
    if (hasActiveWork) {
      initialStatus =
        emp.role === 'TECH_LEAD' || emp.role === 'QA' ? 'REVIEWING' : 'WORKING';
    }

    const initialFacing = desk ? desk.orientation : emp.facing;
    const initialIso = directionToIsoDirection(initialFacing);
    const seedTransfers =
      tickets.length > 0
        ? emp.account === 'SonNA2'
          ? 2
          : emp.account === 'ThanhDQ13'
            ? 2
            : emp.account === 'TienHK'
              ? 1
              : emp.account === 'DongNQ6' || emp.account === 'ChienND22' || emp.account === 'BaoNAT'
                ? 1
                : 0
        : 0;
    const seedBuilds =
      tickets.length > 0
        ? emp.account === 'SonNA2'
          ? 2
          : emp.account === 'TienHK'
            ? 2
            : emp.account === 'ThanhDQ13' || emp.account === 'ChienND22'
              ? 1
              : 0
        : 0;

    return {
      ...emp,
      status: initialStatus,
      currentPosition: desk ? { ...desk.seatPosition } : { ...emp.currentPosition },
      targetPosition: null,
      currentPath: [],
      currentSegmentIndex: 0,
      facing: initialFacing,
      isoDirection: initialIso,
      facingAngle: isoDirectionToAngle(initialIso),
      carryingTicketId: null,
      assignedTicketIds: assignedIds,
      deskDocumentCount: Math.max(emp.deskDocumentCount, assignedIds.length),
      completedTransfersCount: seedTransfers,
      jenkinsBuildsCount: seedBuilds,
      codingStreak: seedTransfers + seedBuilds,
      activityScore: 0,
      mvpRank: null,
      isHotfixSprinter: false,
      // Đầu ngày 100% bàn làm việc trống, ai có event trước mới vào công ty chiếm chỗ ngồi!
      isCheckedIn: false,
      checkedInDeskId: null,
      isSmokingAtAtrium: false,
      isWalkingFromEntrance: false,
    };
  });
}

/**
 * Tự động tính toán:
 * 1) Điểm năng suất (`activityScore`), Chuỗi Combo (`codingStreak`: `🔥 xN`) & Top 3 MVP (`⭐ MVP` / `👑 Top 1..3`)
 * 2) Bản đồ nhiệt mật độ hoạt động của 9 Cụm bàn (`ISLAND-1.1` .. `ISLAND-3.3`) trong Khoang NHÀ THUỐC
 */
function recomputeMvpAndIslandHeatmap(
  employees: Employee[],
  tickets: JiraTicket[],
  activeTransfers: DocumentTransferTask[],
  jenkinsBuilds: JenkinsBuildJobItem[],
  activeJenkinsBuild: ActiveJenkinsBuildTask | null
): {
  mvpLeaderboard: MvpLeaderboardEntry[];
  islandHeatmap: Record<string, IslandHeatmapStat>;
} {
  // Đếm số bản build Jenkins theo account từ feed rssAll
  const rssBuildCountByAcc: Record<string, number> = {};
  for (const jb of jenkinsBuilds) {
    if (jb.triggeredByAccount) {
      const key = jb.triggeredByAccount.trim().toLowerCase();
      rssBuildCountByAcc[key] = (rssBuildCountByAcc[key] ?? 0) + 1;
    }
  }

  // Tính điểm cho từng nhân sự (trừ Sếp nữ ThuNDM đi tuần tra)
  const scoredCandidates: {
    emp: Employee;
    transfersCount: number;
    buildsCount: number;
    activeTicketsCount: number;
    streak: number;
    score: number;
  }[] = [];

  for (const emp of employees) {
    if (emp.isFemaleManager || emp.isManager || emp.id === FEMALE_MANAGER_ID) {
      emp.mvpRank = null;
      continue;
    }

    const accKey = (emp.account || emp.displayName).replace(' (KH)', '').trim().toLowerCase();
    const rssCount = rssBuildCountByAcc[accKey] ?? 0;
    const buildsCount = Math.max(emp.jenkinsBuildsCount ?? 0, rssCount);
    emp.jenkinsBuildsCount = buildsCount;

    const activeXferBonus = activeTransfers.some(
      (t) => t.fromEmployeeId === emp.id || t.toEmployeeId === emp.id
    )
      ? 1
      : 0;
    const activeBuildBonus =
      activeJenkinsBuild && activeJenkinsBuild.employeeId === emp.id ? 1 : 0;

    const transfersCount = emp.completedTransfersCount;
    const activeTicketsCount = tickets.filter(
      (t) => t.status !== 'DONE' && t.assigneeId === emp.id
    ).length;

    const streak = transfersCount + buildsCount + activeXferBonus + activeBuildBonus;
    const score =
      transfersCount * 12 +
      buildsCount * 15 +
      activeTicketsCount * 6 +
      activeXferBonus * 8 +
      activeBuildBonus * 10 +
      Math.min(4, emp.deskDocumentCount) * 2;

    emp.codingStreak = streak;
    emp.activityScore = score;
    emp.mvpRank = null;

    if (score > 0 || streak > 0) {
      scoredCandidates.push({
        emp,
        transfersCount,
        buildsCount,
        activeTicketsCount,
        streak,
        score,
      });
    }
  }

  // Sắp xếp giảm dần theo điểm năng suất (ưu tiên Streak & Builds khi bằng điểm)
  scoredCandidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.streak !== a.streak) return b.streak - a.streak;
    return b.buildsCount - a.buildsCount;
  });

  const mvpLeaderboard: MvpLeaderboardEntry[] = [];
  for (let i = 0; i < Math.min(3, scoredCandidates.length); i++) {
    const item = scoredCandidates[i];
    const rank = (i + 1) as 1 | 2 | 3;
    item.emp.mvpRank = rank;
    mvpLeaderboard.push({
      rank,
      employeeId: item.emp.id,
      account: (item.emp.account || item.emp.displayName).replace(' (KH)', ''),
      displayName: item.emp.displayName,
      role: item.emp.role,
      seatCode: item.emp.seatCode?.replace('FT3.III2A.', '') || item.emp.deskId,
      islandId: item.emp.islandId || 'ISLAND-3.2',
      avatarColor: item.emp.avatarColor,
      transfersCount: item.transfersCount,
      jenkinsBuildsCount: item.buildsCount,
      activeTicketsCount: item.activeTicketsCount,
      streak: Math.max(1, item.streak),
      score: item.score,
    });
  }

  // Tính Bản Đồ Nhiệt cho 9 Cụm Bàn (ISLAND-1.1 .. ISLAND-3.3)
  const islandHeatmap: Record<string, IslandHeatmapStat> = {};
  for (const isl of NHA_THUOC_ISLANDS) {
    const islEmps = employees.filter((e) => e.islandId === isl.id);
    let activeTicketsCount = 0;
    let transfersCount = 0;
    let buildsCount = 0;

    for (const e of islEmps) {
      activeTicketsCount += tickets.filter(
        (t) => t.status !== 'DONE' && t.assigneeId === e.id
      ).length;
      transfersCount +=
        e.completedTransfersCount +
        activeTransfers.filter(
          (t) => t.fromEmployeeId === e.id || t.toEmployeeId === e.id
        ).length;
      buildsCount +=
        (e.jenkinsBuildsCount ?? 0) +
        (activeJenkinsBuild && activeJenkinsBuild.employeeId === e.id ? 1 : 0);
    }

    const heatScore = activeTicketsCount * 3 + transfersCount * 4 + buildsCount * 5;
    const heatLevel: IslandHeatmapStat['heatLevel'] =
      heatScore >= 24
        ? 'HOT'
        : heatScore >= 14
          ? 'WARM'
          : heatScore >= 6
            ? 'ACTIVE'
            : 'CALM';

    islandHeatmap[isl.id] = {
      islandId: isl.id,
      label: `CỤM ${isl.islandRow}.${isl.islandCol}`,
      activeTicketsCount,
      transfersCount,
      buildsCount,
      heatScore,
      heatLevel,
    };
  }

  return { mvpLeaderboard, islandHeatmap };
}

function computeStats(
  employees: Employee[],
  tickets: JiraTicket[],
  activeTransfers: DocumentTransferTask[],
  queuedTransfers: DocumentTransferTask[]
): OfficeSimulationStats {
  let idleEmployeesCount = 0;
  let workingEmployeesCount = 0;
  let walkingEmployeesCount = 0;

  for (const emp of employees) {
    if (
      emp.status === 'CARRYING_DOCS' ||
      emp.status === 'WALKING_BACK' ||
      emp.status === 'HANDOFF'
    ) {
      walkingEmployeesCount += 1;
    } else if (emp.status === 'WORKING' || emp.status === 'REVIEWING') {
      workingEmployeesCount += 1;
    } else {
      idleEmployeesCount += 1;
    }
  }

  let todoCount = 0;
  let inProgressCount = 0;
  let codeReviewCount = 0;
  let qaTestingCount = 0;
  let doneCount = 0;

  for (const t of tickets) {
    if (t.status === 'BACKLOG' || t.status === 'TODO') todoCount += 1;
    else if (t.status === 'IN_PROGRESS') inProgressCount += 1;
    else if (t.status === 'CODE_REVIEW') codeReviewCount += 1;
    else if (t.status === 'QA_TESTING' || t.status === 'READY_FOR_DEPLOY')
      qaTestingCount += 1;
    else if (t.status === 'DONE') doneCount += 1;
  }

  const pmEmp = employees.find((e) => e.id === PROJECT_MANAGER.id);

  return {
    totalEmployees: employees.length,
    idleEmployeesCount,
    workingEmployeesCount,
    walkingEmployeesCount,
    totalTickets: tickets.length,
    todoCount,
    inProgressCount,
    codeReviewCount,
    qaTestingCount,
    doneCount,
    activeTransfersCount: activeTransfers.length,
    queuedTransfersCount: queuedTransfers.length,
    pmDeliveredStackCount: pmEmp ? pmEmp.deskDocumentCount : 4,
  };
}

// ============================================================================
// 3. CORE SIMULATION ENGINE CLASS
// ============================================================================

export class OfficeSimulationEngine {
  private adapter: IJiraAdapter;
  private unsubscribeAdapter: (() => void) | null = null;
  private state: OfficeSimulationState;
  private subscribers: Set<() => void> = new Set();

  // Internal timing state for phase dwell times and auto-pilot
  private phaseElapsedMs: Map<string, number> = new Map();
  private autoStepAccumulatorMs = 0;
  private lastRafTimestamp = 0;
  private lastManualTickTimestamp = 0;
  private lastUiNotifyTimestamp = 0;
  private rafHandle: number | null = null;
  private laneFlipCounter = 0;

  // Sếp Nữ ThuNDM roaming & heart-cheering state + 3 Sếp mới (ToanLBK, doannt19, vanltb8)
  private managerPatrolIndex = 0;
  private managerCheerElapsedMs = 0;
  private managerCheerDurationMs = 2000;
  private bossWaypointIndex: Map<string, number> = new Map([
    [MANAGER_TOANLBK_ID, 1],
    [MANAGER_DOANNT19_ID, 1],
    [MANAGER_VANLTB8_ID, 1],
  ]);
  private bossDwellElapsedMs: Map<string, number> = new Map();
  private smokingSpotCursor = 0;

  // Jenkins CI/UAT Server (`oneclickv4-build-ci` / `oneclickv4-build-uat`) build counter & periodic timer
  private nextJenkinsBuildNumber = 2846;
  private jenkinsCandidateIndex = 0;
  private jenkinsAutoBuildAccumulatorMs = 0;
  private jenkinsClusterToggle = 0;

  // Live FRT Polling timer & Layer-2 Client-Side Idempotency Guard
  private livePollTimer: ReturnType<typeof setInterval> | null = null;
  private seenLiveJiraEntryIds: Set<string> = new Set();
  private seenLiveJenkinsBuildIds: Set<string> = new Set();
  /** Con trỏ Monotonic Sequence (`afterSeq`) nhận từ Backend Proxy `server/proxyServer.mjs` */
  private lastServerSeq = 0;
  /** Tầng 2 Client-Side Idempotency Guard: Đảm bảo 100% không có event nào kích hoạt nhân vật đi bộ lần thứ 2 */
  private processedEventFingerprints: Set<string> = new Set();
  private clientDedupStats: RamDedupStats = {
    totalPolls: 0,
    totalRawEntriesRead: 0,
    uniqueEventsEmitted: 0,
    duplicatesDropped: 0,
    cacheSize: 0,
    maxCacheSize: 2000,
  };

  /**
   * Kiểm tra xem `fingerprint` đã từng được xử lý ở Client chưa.
   * Nếu chưa -> ghi nhận vào `processedEventFingerprints` (giới hạn LRU 2,000 keys) và trả về `false`.
   * Nếu rồi -> trả về `true` để chặn ngay lập tức!
   */
  private checkOrRecordClientFingerprint(fingerprint: string): boolean {
    if (!fingerprint) return false;
    if (this.processedEventFingerprints.has(fingerprint)) {
      return true;
    }
    if (this.processedEventFingerprints.size >= 2000) {
      const oldest = this.processedEventFingerprints.values().next().value;
      if (oldest !== undefined) {
        this.processedEventFingerprints.delete(oldest);
      }
    }
    this.processedEventFingerprints.add(fingerprint);
    this.clientDedupStats.cacheSize = this.processedEventFingerprints.size;
    return false;
  }

  constructor(adapter: IJiraAdapter = mockJiraAdapter) {
    this.adapter = adapter;

    const initialMode = loadPersistedDataSourceMode();
    const initialLiveConfig = loadPersistedLiveConfig();
    const isLiveClean =
      initialMode === 'LIVE_FRT' && initialLiveConfig.clearMockOnLive;

    const initialTickets = isLiveClean
      ? []
      : adapter instanceof MockJiraAdapter
        ? adapter.getTicketsSnapshot()
        : [];
    const initialEmployees = cloneInitialEmployees(initialTickets);
    const employeeById = Object.fromEntries(
      initialEmployees.map((e) => [e.id, e])
    );

    const initialLogs: ActivityLogEntry[] = isLiveClean
      ? []
      : [
          {
            id: 'LOG-INIT-1',
            timestamp: formatTimeHHMMSS(new Date(Date.now() - 45_000)),
            ticketKey: 'FRT-101',
            ticketStatus: 'IN_PROGRESS',
            fromEmployeeId: 'EMP-01',
            fromEmployeeName: 'DongNQ6 (PM • 1.289)',
            toEmployeeId: 'EMP-07',
            toEmployeeName: 'ChienND22 (1.191)',
            isReturnToPM: false,
            message:
              'PM DongNQ6 (FT3.III2A.1.289) bàn giao hồ sơ FRT-101 sang bàn ChienND22 (FT3.III2A.1.191 - Cụm 2.1).',
            type: 'HANDOFF',
          },
          {
            id: 'LOG-INIT-2',
            timestamp: formatTimeHHMMSS(new Date(Date.now() - 25_000)),
            ticketKey: 'FRT-103',
            ticketStatus: 'CODE_REVIEW',
            fromEmployeeId: 'EMP-15',
            fromEmployeeName: 'BaoNAT (1.198)',
            toEmployeeId: 'EMP-05',
            toEmployeeName: 'LuuTV6 (1.197)',
            isReturnToPM: false,
            message:
              'BaoNAT (FT3.III2A.1.198) mang hồ sơ PR FRT-103 sang bàn Lead LuuTV6 (FT3.III2A.1.197 - Cụm 2.2) để Code Review.',
            type: 'HANDOFF',
          },
          {
            id: 'LOG-INIT-3',
            timestamp: formatTimeHHMMSS(new Date(Date.now() - 10_000)),
            ticketKey: 'FRT-104',
            ticketStatus: 'QA_TESTING',
            fromEmployeeId: 'EMP-04',
            fromEmployeeName: 'ThanhDQ13 (1.194/195)',
            toEmployeeId: 'EMP-25',
            toEmployeeName: 'TranTNN (1.287)',
            isReturnToPM: false,
            message:
              'Lead ThanhDQ13 (FT3.III2A.1.194/195) bàn giao bản build FRT-104 sang bàn QA TranTNN (FT3.III2A.1.287 - Cụm 3.2).',
            type: 'HANDOFF',
          },
        ];

    const initialJenkinsBuilds = isLiveClean ? [] : [...DEFAULT_JENKINS_RECENT_BUILDS];
    const initialMvpAndHeat = recomputeMvpAndIslandHeatmap(
      initialEmployees,
      initialTickets,
      [],
      initialJenkinsBuilds,
      null
    );

    this.state = {
      employees: initialEmployees,
      employeeById,
      tickets: initialTickets,
      activeTransfers: [],
      queuedTransfers: [],
      activeJenkinsBuild: null,
      jenkinsBuilds: initialJenkinsBuilds,
      jenkinsLastCompletedAt: null,
      isJenkinsBrokenAlert: false,
      brokenBuildNumber: null,
      jenkinsHotfixCelebrationAt: null,
      mvpLeaderboard: initialMvpAndHeat.mvpLeaderboard,
      islandHeatmap: initialMvpAndHeat.islandHeatmap,
      activityLogs: initialLogs,
      speechBubbles: [],
      pmCelebrations: [],
      config: {
        ...DEFAULT_SIMULATION_CONFIG,
        autoSimulate: initialMode === 'MOCK_PILOT',
        showActivePaths: false,
        showPaths: false,
        showIslandHeatmap: false,
        showMvpPodium: true,
      },
      dataSourceMode: initialMode,
      liveConfig: initialLiveConfig,
      isSprintRush: false,
      sprintRushEndsAt: null,
      selectedEmployeeId: null,
      selectedTicketId: null,
      selectedDeskId: null,
      checkedInCount: 0,
      smokingCount: 0,
      currentDayKey: getCurrentDayKey(),
      stats: computeStats(initialEmployees, initialTickets, [], []),
      tickCount: 0,
    };

    this.bindAdapter(adapter);
    this.startInternalLoop();

    if (initialMode === 'LIVE_FRT') {
      this.syncLivePollingLoop(true);
    } else {
      // Allow 4.2s of Default Manager Focus on Sếp ThuNDM throwing hearts before the first Jira transfer event kicks off
      setTimeout(() => {
        if (
          this.state.dataSourceMode === 'MOCK_PILOT' &&
          this.state.config.isRunning &&
          this.state.activeTransfers.length === 0 &&
          this.adapter instanceof MockJiraAdapter
        ) {
          void this.advanceTicket('FRT-104');
        }
      }, 4200);

      // Kick off an automatic Jenkins build walk shortly after startup so the user sees an engineer walking to the Server
      setTimeout(() => {
        if (
          this.state.dataSourceMode === 'MOCK_PILOT' &&
          this.state.config.isRunning &&
          !this.state.activeJenkinsBuild
        ) {
          this.triggerJenkinsBuild({
            employeeId: 'EMP-29', // TienHK
            ticketKey: 'FRT-104',
          });
        }
      }, 6800);
    }
  }

  private bindAdapter(adapter: IJiraAdapter): void {
    if (this.unsubscribeAdapter) {
      this.unsubscribeAdapter();
    }
    this.adapter = adapter;
    void this.adapter.connect();
    this.unsubscribeAdapter = this.adapter.onTicketEvent((event) => {
      this.handleJiraWebhookEvent(event);
    });
  }

  // ==========================================================================
  // SUBSCRIPTION & STATE ACCESS
  // ==========================================================================

  public subscribe = (listener: () => void): (() => void) => {
    this.subscribers.add(listener);
    return () => {
      this.subscribers.delete(listener);
    };
  };

  public getSnapshot = (): OfficeSimulationState => {
    return this.state;
  };

  public getMutableState = (): OfficeSimulationState => {
    return this.state;
  };

  private emitChange(forceNewRef = true): void {
    if (forceNewRef) {
      const { mvpLeaderboard, islandHeatmap } = recomputeMvpAndIslandHeatmap(
        this.state.employees,
        this.state.tickets,
        this.state.activeTransfers,
        this.state.jenkinsBuilds,
        this.state.activeJenkinsBuild
      );
      const checkedInCount = this.state.employees.filter(
        (e) => !e.isManager && !e.isFemaleManager && e.isCheckedIn
      ).length;
      const smokingCount = this.state.employees.filter(
        (e) => !e.isManager && !e.isFemaleManager && e.isSmokingAtAtrium
      ).length;
      this.state = {
        ...this.state,
        employees: [...this.state.employees],
        activeTransfers: [...this.state.activeTransfers],
        queuedTransfers: [...this.state.queuedTransfers],
        activeJenkinsBuild: this.state.activeJenkinsBuild
          ? { ...this.state.activeJenkinsBuild }
          : null,
        jenkinsBuilds: [...this.state.jenkinsBuilds],
        mvpLeaderboard,
        islandHeatmap,
        checkedInCount,
        smokingCount,
        stats: computeStats(
          this.state.employees,
          this.state.tickets,
          this.state.activeTransfers,
          this.state.queuedTransfers
        ),
      };
    }
    for (const listener of this.subscribers) {
      listener();
    }
  }

  // ==========================================================================
  // INTERNAL 60FPS ANIMATION LOOP
  // ==========================================================================

  private startInternalLoop(): void {
    if (typeof window === 'undefined' || this.rafHandle !== null) return;

    const loop = (timestamp: number) => {
      if (this.lastRafTimestamp === 0) {
        this.lastRafTimestamp = timestamp;
      }
      const dt = Math.min(100, Math.max(0, timestamp - this.lastRafTimestamp));
      this.lastRafTimestamp = timestamp;

      // Only step from internal RAF if an external Canvas loop hasn't called tick() in the last 50ms
      if (timestamp - this.lastManualTickTimestamp > 50) {
        this.stepInternal(dt, timestamp);
      }

      this.rafHandle = window.requestAnimationFrame(loop);
    };

    this.rafHandle = window.requestAnimationFrame(loop);
  }

  /**
   * Public tick method that can be called from a Canvas `requestAnimationFrame` loop
   * or tests.
   */
  public tick = (deltaTimeMs: number): void => {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    this.lastManualTickTimestamp = now;
    this.stepInternal(Math.min(100, Math.max(0, deltaTimeMs)), now);
  };

  // ==========================================================================
  // CORE PHYSICS & TRANSFER QUEUE UPDATE STEP
  // ==========================================================================

  private stepInternal(deltaTimeMs: number, nowPerf: number): void {
    if (!this.state.config.isRunning || deltaTimeMs <= 0) {
      return;
    }

    const nowWall = Date.now();

    // 0. Tự động kiểm tra qua ngày mới (YYYY-MM-DD) -> Reset toàn bộ bàn làm việc về trống 100%
    const todayKey = getCurrentDayKey(new Date(nowWall));
    if (todayKey !== this.state.currentDayKey) {
      this.state.currentDayKey = todayKey;
      this.resetNewDayEmptyDesks();
    }

    // 1. Check if Sprint Rush timer expired
    if (
      this.state.isSprintRush &&
      this.state.sprintRushEndsAt &&
      nowWall >= this.state.sprintRushEndsAt
    ) {
      this.state.isSprintRush = false;
      this.state.sprintRushEndsAt = null;
      this.emitChange();
    }

    const rushSpeedBoost = this.state.isSprintRush ? 1.55 : 1.0;
    const effectiveSpeed =
      this.state.config.speedMultiplier * rushSpeedBoost;
    const scaledDeltaMs = deltaTimeMs * effectiveSpeed;

    let semanticChangeOccurred = false;

    // 2. Clean up expired speech bubbles and PM celebrations
    if (this.state.speechBubbles.length > 0) {
      const remainingBubbles = this.state.speechBubbles.filter(
        (b) => b.expiresAt > nowWall
      );
      if (remainingBubbles.length !== this.state.speechBubbles.length) {
        this.state.speechBubbles = remainingBubbles;
        semanticChangeOccurred = true;
      }
    }

    if (this.state.pmCelebrations.length > 0) {
      const remainingCelebrations = this.state.pmCelebrations.filter(
        (c) => c.expiresAt > nowWall
      );
      if (remainingCelebrations.length !== this.state.pmCelebrations.length) {
        this.state.pmCelebrations = remainingCelebrations;
        semanticChangeOccurred = true;
      }
    }

    // 3. Promote queued transfers whose source employee is now back at their desk
    if (this.state.queuedTransfers.length > 0) {
      const busySenders = new Set(
        this.state.activeTransfers.map((t) => t.fromEmployeeId)
      );
      const remainingQueue: DocumentTransferTask[] = [];

      for (const queued of this.state.queuedTransfers) {
        if (!busySenders.has(queued.fromEmployeeId)) {
          busySenders.add(queued.fromEmployeeId);
          this.beginTransferTask(queued);
          this.state.activeTransfers.push(queued);
          semanticChangeOccurred = true;
        } else {
          remainingQueue.push(queued);
        }
      }
      if (remainingQueue.length !== this.state.queuedTransfers.length) {
        this.state.queuedTransfers = remainingQueue;
      }
    }

    // 4. Advance all active DocumentTransferTasks
    if (this.state.activeTransfers.length > 0) {
      const stillActive: DocumentTransferTask[] = [];

      for (const task of this.state.activeTransfers) {
        const sender = this.state.employeeById[task.fromEmployeeId];
        const receiver = this.state.employeeById[task.toEmployeeId];

        if (!sender || !receiver) {
          continue;
        }

        const elapsed = (this.phaseElapsedMs.get(task.id) ?? 0) + scaledDeltaMs;
        this.phaseElapsedMs.set(task.id, elapsed);

        if (task.phase === 'PICKING_UP') {
          sender.status = 'CARRYING_DOCS';
          sender.carryingTicketId = task.ticketId;
          if (task.outboundPath.length > 1) {
            sender.facing = getDirectionBetweenPoints(
              task.outboundPath[0],
              task.outboundPath[1],
              sender.facing
            );
            sender.isoDirection = getIsoDirectionBetweenPoints(
              task.outboundPath[0],
              task.outboundPath[1],
              sender.isoDirection ?? directionToIsoDirection(sender.facing)
            );
            sender.facingAngle = getIsoFacingAngleBetweenPoints(
              task.outboundPath[0],
              task.outboundPath[1],
              sender.facingAngle
            );
          }

          if (elapsed >= PICKUP_DURATION_MS) {
            task.phase = 'WALKING_TO_TARGET';
            task.currentSegmentIndex = 0;
            this.phaseElapsedMs.set(task.id, 0);
            sender.currentPath = task.outboundPath;
            sender.targetPosition =
              task.outboundPath[task.outboundPath.length - 1] ?? null;
            semanticChangeOccurred = true;
          }
          stillActive.push(task);
        } else if (task.phase === 'WALKING_TO_TARGET') {
          sender.status = 'CARRYING_DOCS';
          sender.carryingTicketId = task.ticketId;

          const stepPx =
            (sender.baseSpeed * (sender.speedMultiplier ?? 1.0) * scaledDeltaMs) /
            1000;
          const stepRes = stepAlongPath(
            sender.currentPosition,
            task.outboundPath,
            task.currentSegmentIndex,
            stepPx,
            sender.facing
          );

          sender.currentPosition = stepRes.position;
          sender.facing = stepRes.facing;
          sender.isoDirection = stepRes.isoDirection;
          sender.facingAngle = stepRes.facingAngle;
          task.currentSegmentIndex = stepRes.segmentIndex;
          task.progress = stepRes.progress * 0.55; // Outbound is 0..0.55 of total cycle

          if (stepRes.reachedEnd) {
            task.phase = 'HANDING_OVER';
            task.progress = 0.6;
            this.phaseElapsedMs.set(task.id, 0);
            sender.status = 'HANDOFF';

            // Face the receiver's desk (and receiver faces sender directly!)
            const receiverDesk = DESK_BY_ID[task.toDeskId];
            if (receiverDesk) {
              sender.facing = getDirectionBetweenPoints(
                sender.currentPosition,
                receiverDesk.seatPosition,
                sender.facing
              );
              sender.isoDirection = getIsoDirectionBetweenPoints(
                sender.currentPosition,
                receiverDesk.seatPosition,
                sender.isoDirection ?? 'SW'
              );
              sender.facingAngle = getIsoFacingAngleBetweenPoints(
                sender.currentPosition,
                receiverDesk.seatPosition,
                sender.facingAngle
              );
              if (
                receiver.status !== 'CARRYING_DOCS' &&
                receiver.status !== 'WALKING_BACK'
              ) {
                receiver.facing = getDirectionBetweenPoints(
                  receiverDesk.seatPosition,
                  sender.currentPosition,
                  receiver.facing
                );
                receiver.isoDirection = getIsoDirectionBetweenPoints(
                  receiverDesk.seatPosition,
                  sender.currentPosition,
                  receiver.isoDirection ?? 'SW'
                );
                receiver.facingAngle = getIsoFacingAngleBetweenPoints(
                  receiverDesk.seatPosition,
                  sender.currentPosition,
                  receiver.facingAngle
                );
              }
            }

            // Receiver receives the document stack on their desk!
            receiver.deskDocumentCount += 1;
            if (! task.isReturnToPM) {
              if (!receiver.assignedTicketIds.includes(task.ticketId)) {
                receiver.assignedTicketIds = [
                  ...receiver.assignedTicketIds,
                  task.ticketId,
                ];
              }
              if (receiver.status === 'IDLE') {
                receiver.status =
                  receiver.role === 'TECH_LEAD' || receiver.role === 'QA'
                    ? 'REVIEWING'
                    : 'WORKING';
              }
            } else {
              // Ticket was returned to PM as DONE!
              if (this.adapter instanceof MockJiraAdapter) {
                this.adapter.markTicketDeliveredToPM(task.ticketId);
              }
              this.state.tickets = this.state.tickets.map((t) =>
                t.id === task.ticketId || t.key === task.ticketKey
                  ? { ...t, deliveredToPM: true }
                  : t
              );

              // Trigger celebration effect at PM desk
              this.state.pmCelebrations = [
                ...this.state.pmCelebrations,
                {
                  id: `CEL-${task.id}`,
                  ticketKey: task.ticketKey,
                  fromEmployeeName: sender.displayName,
                  position: { ...PM_DESK.position },
                  createdAt: nowWall,
                  expiresAt: nowWall + PM_CELEBRATION_DURATION_MS,
                },
              ];

              // Record PM receipt log
              this.prependActivityLog({
                id: `LOG-DONE-${task.id}`,
                timestamp: formatTimeHHMMSS(),
                ticketKey: task.ticketKey,
                ticketStatus: 'DONE',
                fromEmployeeId: sender.id,
                fromEmployeeName: sender.displayName,
                toEmployeeId: receiver.id,
                toEmployeeName: receiver.displayName,
                isReturnToPM: true,
                message: `✅ ${sender.displayName} đã đặt chồng hồ sơ hoàn thành ${task.ticketKey} lên bàn ${receiver.displayName} (Nghiệm thu DONE!).`,
                type: 'COMPLETED',
              });
            }

            // Show receiver speech bubble
            const dialogues = getSpeechBubblesForTransition(
              task.targetStatus,
              task.ticketKey
            );
            this.addSpeechBubble(
              receiver.id,
              dialogues.receiverSpeech,
              task.isReturnToPM ? 'done' : 'handoff'
            );

            semanticChangeOccurred = true;
          }
          stillActive.push(task);
        } else if (task.phase === 'HANDING_OVER') {
          sender.status = 'HANDOFF';
          if (elapsed >= HANDOVER_DURATION_MS) {
            // Handoff finished -> receiver turns back to their monitor, sender walks back to their own desk
            const receiverDesk = DESK_BY_ID[task.toDeskId];
            if (
              receiverDesk &&
              receiver.status !== 'CARRYING_DOCS' &&
              receiver.status !== 'WALKING_BACK'
            ) {
              receiver.facing = receiverDesk.orientation;
              receiver.isoDirection = directionToIsoDirection(receiverDesk.orientation);
              receiver.facingAngle = isoDirectionToAngle(receiver.isoDirection);
            }

            task.phase = 'RETURNING_TO_DESK';
            task.currentSegmentIndex = 0;
            this.phaseElapsedMs.set(task.id, 0);

            sender.carryingTicketId = null;
            sender.status = 'WALKING_BACK';
            sender.currentPath = task.returnPath;
            sender.targetPosition =
              task.returnPath[task.returnPath.length - 1] ?? null;
            if (task.returnPath.length > 1) {
              sender.facing = getDirectionBetweenPoints(
                task.returnPath[0],
                task.returnPath[1],
                sender.facing
              );
              sender.isoDirection = getIsoDirectionBetweenPoints(
                task.returnPath[0],
                task.returnPath[1],
                sender.isoDirection ?? 'SW'
              );
              sender.facingAngle = getIsoFacingAngleBetweenPoints(
                task.returnPath[0],
                task.returnPath[1],
                sender.facingAngle
              );
            }
            semanticChangeOccurred = true;
          }
          stillActive.push(task);
        } else if (task.phase === 'RETURNING_TO_DESK') {
          sender.status = 'WALKING_BACK';
          sender.carryingTicketId = null;

          const stepPx =
            (sender.baseSpeed *
              (sender.speedMultiplier ?? 1.0) *
              1.08 *
              scaledDeltaMs) /
            1000;
          const stepRes = stepAlongPath(
            sender.currentPosition,
            task.returnPath,
            task.currentSegmentIndex,
            stepPx,
            sender.facing
          );

          sender.currentPosition = stepRes.position;
          sender.facing = stepRes.facing;
          sender.isoDirection = stepRes.isoDirection;
          sender.facingAngle = stepRes.facingAngle;
          task.currentSegmentIndex = stepRes.segmentIndex;
          task.progress = 0.6 + stepRes.progress * 0.4;

          if (stepRes.reachedEnd) {
            // Completed full round trip!
            task.phase = 'COMPLETED';
            task.progress = 1;
            task.completedAt = nowWall;
            this.phaseElapsedMs.delete(task.id);

            const senderDesk = DESK_BY_ID[sender.deskId];
            if (senderDesk) {
              sender.currentPosition = { ...senderDesk.seatPosition };
              sender.facing = senderDesk.orientation;
              sender.isoDirection = directionToIsoDirection(senderDesk.orientation);
              sender.facingAngle = isoDirectionToAngle(sender.isoDirection);
            }
            sender.currentPath = [];
            sender.targetPosition = null;
            sender.completedTransfersCount += 1;
            sender.isWalkingFromEntrance = false;

            // Check if sender still has active tickets assigned on their desk
            const hasRemainingTickets = this.state.tickets.some(
              (t) => t.status !== 'DONE' && t.assigneeId === sender.id
            );
            sender.status = hasRemainingTickets
              ? sender.role === 'TECH_LEAD' || sender.role === 'QA'
                ? 'REVIEWING'
                : 'WORKING'
              : 'IDLE';

            semanticChangeOccurred = true;
          } else {
            stillActive.push(task);
          }
        }
      }

      this.state.activeTransfers = stillActive;
    }

    // 4b. Advance all 4 Bosses (`ThuNDM`, `ToanLBK` 1.5x, `doannt19`, `vanltb8`) + Atrium Smokers walking
    const managerChanged = this.stepFemaleManagerPatrol(scaledDeltaMs);
    if (managerChanged) {
      semanticChangeOccurred = true;
    }

    // 4c. Advance Engineer walking to Jenkins CI/UAT/RELEASE Server & typing to run build
    const jenkinsChanged = this.stepJenkinsBuild(scaledDeltaMs, nowWall);
    if (jenkinsChanged) {
      semanticChangeOccurred = true;
    }

    // 5. Auto-Pilot & Sprint Rush periodic ticket progression + periodic Jenkins build (ONLY in MOCK_PILOT mode)
    if (
      this.state.dataSourceMode === 'MOCK_PILOT' &&
      (this.state.config.autoSimulate || this.state.isSprintRush)
    ) {
      this.autoStepAccumulatorMs += deltaTimeMs * this.state.config.speedMultiplier;
      this.jenkinsAutoBuildAccumulatorMs +=
        deltaTimeMs * this.state.config.speedMultiplier;

      const targetIntervalMs = this.state.isSprintRush
        ? 1100
        : this.state.config.autoStepIntervalMs;

      if (this.autoStepAccumulatorMs >= targetIntervalMs) {
        this.autoStepAccumulatorMs = 0;
        const maxConcurrent = this.state.isSprintRush
          ? 10
          : this.state.config.maxConcurrentActiveTickets;

        if (this.state.activeTransfers.length < maxConcurrent) {
          const busyIds = new Set<string>();
          for (const t of this.state.activeTransfers) {
            busyIds.add(t.fromEmployeeId);
          }
          if (this.state.activeJenkinsBuild) {
            busyIds.add(this.state.activeJenkinsBuild.employeeId);
          }
          if (this.adapter instanceof MockJiraAdapter) {
            void this.adapter.advanceTicketWorkflow(undefined, busyIds);
          } else if (this.adapter.advanceTicketWorkflow) {
            void this.adapter.advanceTicketWorkflow();
          }
        }
      }

      // Periodically send an engineer to a Jenkins Server Cluster (alternating CI & UAT)
      const jenkinsIntervalMs = this.state.isSprintRush ? 11_500 : 19_000;
      if (
        this.jenkinsAutoBuildAccumulatorMs >= jenkinsIntervalMs &&
        !this.state.activeJenkinsBuild
      ) {
        this.jenkinsAutoBuildAccumulatorMs = 0;
        this.jenkinsClusterToggle = (this.jenkinsClusterToggle + 1) % 2;
        this.triggerJenkinsBuild({
          jobName:
            this.jenkinsClusterToggle === 1
              ? JENKINS_UAT_SERVER_STATION.jobName
              : JENKINS_SERVER_STATION.jobName,
        });
      }
    }

    this.state.tickCount += 1;

    // Notify React UI subscribers immediately on semantic changes, or throttled (~16fps) while characters/manager are walking
    if (
      semanticChangeOccurred ||
      nowPerf - this.lastUiNotifyTimestamp >= 60
    ) {
      this.lastUiNotifyTimestamp = nowPerf;
      this.emitChange(true);
    }
  }

  /**
   * Vòng lặp 60fps điều khiển đồng thời cả 4 vị Sếp đi tuần tra 4 phòng khác nhau:
   * 1. Sếp nữ `ThuNDM` (`EMP-MANAGER-THUNDM` — Khoang Đông / Nhà Thuốc, vẫy tay thả tim `❤️ 💖 ✨`)
   * 2. Sếp nam `ToanLBK` (`EMP-MANAGER-TOANLBK` — Khoang Bắc, tốc độ 1.5x người thường, trạng thái luôn giận dữ `💢 😡`)
   * 3. Sếp nữ `doannt19` (`EMP-MANAGER-DOANNT19` — Khoang Tây-Trung, luôn vui vẻ cười tươi `😄 🌸`)
   * 4. Sếp nữ `vanltb8` (`EMP-MANAGER-VANLTB8` — Khoang Nam, luôn lo lắng `😰 💧`)
   * Đồng thời cập nhật bước đi của các nhân viên đi ra Giếng trời hút thuốc (`isSmokingAtAtrium`).
   */
  private stepFemaleManagerPatrol(scaledDeltaMs: number): boolean {
    let anySemanticChange = false;

    // ------------------------------------------------------------------------
    // A. Sếp 1: `ThuNDM` tuần tra qua từng bàn của Khoang Đông (Nhà Thuốc)
    // ------------------------------------------------------------------------
    const manager = this.state.employeeById[FEMALE_MANAGER_ID];
    if (manager) {
      const currentTargetId =
        manager.roamingTargetEmployeeId ||
        MANAGER_PATROL_EMPLOYEE_IDS[this.managerPatrolIndex] ||
        'EMP-01';
      const targetEmp = this.state.employeeById[currentTargetId];
      const targetDesk =
        DESK_BY_EMPLOYEE_ID[currentTargetId] ??
        (targetEmp ? DESK_BY_ID[targetEmp.deskId] : undefined) ??
        PM_DESK;

      if (manager.roamingPhase === 'CHEERING') {
        manager.status = 'HANDOFF';
        this.managerCheerElapsedMs += scaledDeltaMs;

        if (targetDesk) {
          manager.facing = getDirectionBetweenPoints(
            manager.currentPosition,
            targetDesk.seatPosition,
            manager.facing
          );
          manager.isoDirection = getIsoDirectionBetweenPoints(
            manager.currentPosition,
            targetDesk.seatPosition,
            manager.isoDirection ?? 'SW'
          );
          manager.facingAngle = getIsoFacingAngleBetweenPoints(
            manager.currentPosition,
            targetDesk.seatPosition,
            manager.facingAngle
          );
        }

        if (this.managerCheerElapsedMs >= this.managerCheerDurationMs) {
          this.managerCheerElapsedMs = 0;
          this.managerPatrolIndex =
            (this.managerPatrolIndex + 1) % MANAGER_PATROL_EMPLOYEE_IDS.length;
          const nextTargetId = MANAGER_PATROL_EMPLOYEE_IDS[this.managerPatrolIndex];
          const nextTargetEmp = this.state.employeeById[nextTargetId];
          const nextPath = buildManagerPatrolPath(
            manager.currentPosition,
            nextTargetId
          );

          manager.roamingTargetEmployeeId = nextTargetId;
          manager.roamingPhase = 'WALKING';
          manager.status = 'WALKING_BACK';
          manager.currentPath = nextPath;
          manager.currentSegmentIndex = 0;
          manager.targetPosition = nextPath[nextPath.length - 1] ?? null;
          manager.roamingSpeechText = getManagerCheerSpeech(
            nextTargetEmp,
            this.managerPatrolIndex
          );

          if (nextPath.length > 1) {
            manager.facing = getDirectionBetweenPoints(
              nextPath[0],
              nextPath[1],
              manager.facing
            );
            manager.isoDirection = getIsoDirectionBetweenPoints(
              nextPath[0],
              nextPath[1],
              manager.isoDirection ?? 'SW'
            );
            manager.facingAngle = getIsoFacingAngleBetweenPoints(
              nextPath[0],
              nextPath[1],
              manager.facingAngle
            );
          }
          anySemanticChange = true;
        }
      } else {
        manager.roamingPhase = 'WALKING';
        manager.status = 'WALKING_BACK';

        if (!manager.currentPath || manager.currentPath.length < 2) {
          manager.currentPath = buildManagerPatrolPath(
            manager.currentPosition,
            currentTargetId
          );
          manager.currentSegmentIndex = 0;
          manager.targetPosition =
            manager.currentPath[manager.currentPath.length - 1] ?? null;
        }

        const stepPx =
          (manager.baseSpeed * (manager.speedMultiplier ?? 1.0) * scaledDeltaMs) /
          1000;
        const stepRes = stepAlongPath(
          manager.currentPosition,
          manager.currentPath,
          manager.currentSegmentIndex ?? 0,
          stepPx,
          manager.facing
        );

        manager.currentPosition = stepRes.position;
        manager.facing = stepRes.facing;
        manager.isoDirection = stepRes.isoDirection;
        manager.facingAngle = stepRes.facingAngle;
        manager.currentSegmentIndex = stepRes.segmentIndex;

        if (stepRes.reachedEnd) {
          manager.roamingPhase = 'CHEERING';
          manager.status = 'HANDOFF';
          this.managerCheerElapsedMs = 0;
          this.managerCheerDurationMs = 1750 + (this.managerPatrolIndex % 4) * 200;

          if (targetDesk) {
            manager.facing = getDirectionBetweenPoints(
              manager.currentPosition,
              targetDesk.seatPosition,
              manager.facing
            );
            manager.isoDirection = getIsoDirectionBetweenPoints(
              manager.currentPosition,
              targetDesk.seatPosition,
              manager.isoDirection ?? 'SW'
            );
            manager.facingAngle = getIsoFacingAngleBetweenPoints(
              manager.currentPosition,
              targetDesk.seatPosition,
              manager.facingAngle
            );
          }

          const cheerMsg = getManagerCheerSpeech(
            targetEmp,
            this.managerPatrolIndex
          );
          manager.roamingSpeechText = cheerMsg;
          this.addSpeechBubble(manager.id, cheerMsg, 'done');
          anySemanticChange = true;
        }
      }
    }

    // ------------------------------------------------------------------------
    // B. Sếp 2, 3, 4: `ToanLBK` (North, 1.5x, angry), `doannt19` (West, happy), `vanltb8` (South, worried)
    // ------------------------------------------------------------------------
    const wingBossIds = [
      MANAGER_TOANLBK_ID,
      MANAGER_DOANNT19_ID,
      MANAGER_VANLTB8_ID,
    ];
    for (const bossId of wingBossIds) {
      const boss = this.state.employeeById[bossId];
      if (!boss) continue;

      const wingKey = boss.patrolWing || 'NORTH';
      const loopPoints =
        BOSS_WING_PATROL_LOOPS[wingKey] ?? BOSS_WING_PATROL_LOOPS.NORTH;
      if (!loopPoints || loopPoints.length === 0) continue;

      const curWpIdx = this.bossWaypointIndex.get(boss.id) ?? 0;

      if (boss.roamingPhase === 'CHEERING') {
        boss.status = 'HANDOFF';
        const dwellElapsed =
          (this.bossDwellElapsedMs.get(boss.id) ?? 0) + scaledDeltaMs;
        this.bossDwellElapsedMs.set(boss.id, dwellElapsed);

        const dwellDuration = boss.managerMood === 'angry' ? 1250 : 1850;
        if (dwellElapsed >= dwellDuration) {
          this.bossDwellElapsedMs.set(boss.id, 0);
          const nextWpIdx = (curWpIdx + 1) % loopPoints.length;
          this.bossWaypointIndex.set(boss.id, nextWpIdx);
          const nextTargetPos = loopPoints[nextWpIdx];
          const nextPath = buildPointToPointPatrolPath(
            boss.currentPosition,
            nextTargetPos
          );

          boss.roamingPhase = 'WALKING';
          boss.status = 'WALKING_BACK';
          boss.currentPath = nextPath;
          boss.currentSegmentIndex = 0;
          boss.targetPosition = nextTargetPos;
          boss.roamingSpeechText = getBossSpeechByMood(boss, nextWpIdx);

          if (nextPath.length > 1) {
            boss.facing = getDirectionBetweenPoints(
              nextPath[0],
              nextPath[1],
              boss.facing
            );
            boss.isoDirection = getIsoDirectionBetweenPoints(
              nextPath[0],
              nextPath[1],
              boss.isoDirection ?? 'SW'
            );
            boss.facingAngle = getIsoFacingAngleBetweenPoints(
              nextPath[0],
              nextPath[1],
              boss.facingAngle
            );
          }
          anySemanticChange = true;
        }
      } else {
        boss.roamingPhase = 'WALKING';
        boss.status = 'WALKING_BACK';

        if (!boss.currentPath || boss.currentPath.length < 2) {
          const targetPos = loopPoints[curWpIdx % loopPoints.length];
          boss.currentPath = buildPointToPointPatrolPath(
            boss.currentPosition,
            targetPos
          );
          boss.currentSegmentIndex = 0;
          boss.targetPosition = targetPos;
        }

        // Nhân tốc độ bước đi với `boss.speedMultiplier ?? 1.0` (ToanLBK = 1.5x!)
        const stepPx =
          (boss.baseSpeed * (boss.speedMultiplier ?? 1.0) * scaledDeltaMs) /
          1000;
        const stepRes = stepAlongPath(
          boss.currentPosition,
          boss.currentPath,
          boss.currentSegmentIndex ?? 0,
          stepPx,
          boss.facing
        );

        boss.currentPosition = stepRes.position;
        boss.facing = stepRes.facing;
        boss.isoDirection = stepRes.isoDirection;
        boss.facingAngle = stepRes.facingAngle;
        boss.currentSegmentIndex = stepRes.segmentIndex;

        if (stepRes.reachedEnd) {
          boss.roamingPhase = 'CHEERING';
          boss.status = 'HANDOFF';
          this.bossDwellElapsedMs.set(boss.id, 0);
          const speechMsg = getBossSpeechByMood(boss, curWpIdx);
          boss.roamingSpeechText = speechMsg;
          this.addSpeechBubble(
            boss.id,
            speechMsg,
            boss.managerMood === 'angry'
              ? 'bug'
              : boss.managerMood === 'happy'
                ? 'done'
                : 'info'
          );
          anySemanticChange = true;
        }
      }
    }

    // ------------------------------------------------------------------------
    // C. Nhân viên hết bàn ngồi -> đi bộ ra hành lang Giếng trời hút thuốc (`🚬 💨`)
    // ------------------------------------------------------------------------
    for (const emp of this.state.employees) {
      if (
        emp.isSmokingAtAtrium &&
        emp.currentPath &&
        emp.currentPath.length >= 2
      ) {
        const stepPx =
          (emp.baseSpeed * (emp.speedMultiplier ?? 1.0) * scaledDeltaMs) / 1000;
        const stepRes = stepAlongPath(
          emp.currentPosition,
          emp.currentPath,
          emp.currentSegmentIndex ?? 0,
          stepPx,
          emp.facing
        );
        emp.currentPosition = stepRes.position;
        emp.facing = stepRes.facing;
        emp.isoDirection = stepRes.isoDirection;
        emp.facingAngle = stepRes.facingAngle;
        emp.currentSegmentIndex = stepRes.segmentIndex;

        if (stepRes.reachedEnd) {
          emp.currentPath = [];
          emp.targetPosition = null;
          emp.status = 'IDLE';
          emp.isWalkingFromEntrance = false;
          anySemanticChange = true;
        }
      }
    }

    return anySemanticChange;
  }

  /**
   * Vòng lặp 60fps điều khiển Kỹ sư (như `TienHK`, `SonNA2`, `ChienND22`, `ManhPT13`, `BaoNAT`, `ThanhDQ13`)
   * đứng dậy đi bộ theo đường A* tới Cụm Máy Tính Server Jenkins (`CI`, `UAT`, hoặc `RELEASE`),
   * đứng trước bàn điều khiển 3 màn hình gõ bàn phím 4.8 giây chạy bản build từ 0% -> 100%,
   * rồi quay về bàn làm việc.
   */
  private stepJenkinsBuild(scaledDeltaMs: number, nowWall: number): boolean {
    const task = this.state.activeJenkinsBuild;
    if (!task) return false;

    const builder = this.state.employeeById[task.employeeId];
    if (!builder) {
      this.state.activeJenkinsBuild = null;
      return true;
    }

    const targetStation =
      JENKINS_SERVER_CLUSTERS.find(
        (c) =>
          c.deskId === task.serverDeskId ||
          c.id === task.clusterId ||
          c.jobName.toLowerCase() === task.jobName.toLowerCase()
      ) ?? JENKINS_SERVER_STATION;

    if (task.phase === 'WALKING_TO_SERVER') {
      builder.status = 'WALKING_BACK';
      builder.carryingTicketId = null;
      builder.isHotfixSprinter = Boolean(task.isHotfixRescue);

      // Khi ở chế độ Hotfix Rescue (`⚡ HOTFIX SPRINT`), kỹ sư chạy nước rút nhanh gấp 1.65 lần!
      const sprintBoost = task.isHotfixRescue ? 1.68 : 1.08;
      const stepPx =
        (builder.baseSpeed *
          (builder.speedMultiplier ?? 1.0) *
          sprintBoost *
          scaledDeltaMs) /
        1000;
      const stepRes = stepAlongPath(
        builder.currentPosition,
        task.outboundPath,
        task.currentSegmentIndex,
        stepPx,
        builder.facing
      );

      builder.currentPosition = stepRes.position;
      builder.facing = stepRes.facing;
      builder.isoDirection = stepRes.isoDirection;
      builder.facingAngle = stepRes.facingAngle;
      task.currentSegmentIndex = stepRes.segmentIndex;

      if (stepRes.reachedEnd) {
        task.phase = 'BUILDING_AT_SERVER';
        task.buildProgress = 4;
        this.phaseElapsedMs.set(task.id, 0);

        // Xoay người hướng thẳng vào Bàn điều khiển 3 màn hình của Cụm Server Jenkins (hướng UP / NE)
        builder.currentPosition = { ...targetStation.operatorPosition };
        builder.facing = 'UP';
        builder.isoDirection = 'NE';
        builder.facingAngle = isoDirectionToAngle('NE');
        builder.status = 'WORKING';

        this.addSpeechBubble(
          builder.id,
          task.isHotfixRescue
            ? `🚨 HOTFIX SPRINT: Đang cứu Build #${task.brokenBuildNumber ?? task.buildNumber} (${task.jobName}) ➔ Back to normal!`
            : `⚙️ Đang chạy Jenkins #${task.buildNumber} (${task.jobName}) cho [${task.ticketKey}]...`,
          task.isHotfixRescue ? 'bug' : 'info'
        );
        return true;
      }
      return false;
    }

    if (task.phase === 'BUILDING_AT_SERVER') {
      const elapsed = (this.phaseElapsedMs.get(task.id) ?? 0) + scaledDeltaMs;
      this.phaseElapsedMs.set(task.id, elapsed);

      const buildDurationMs = task.isHotfixRescue ? 4200 : 4800;
      task.buildProgress = Math.min(
        100,
        Math.max(4, Math.round((elapsed / buildDurationMs) * 100))
      );

      builder.currentPosition = { ...targetStation.operatorPosition };
      builder.facing = 'UP';
      builder.isoDirection = 'NE';
      builder.facingAngle = isoDirectionToAngle('NE');
      builder.status = 'WORKING';
      builder.isHotfixSprinter = Boolean(task.isHotfixRescue);

      if (elapsed >= buildDurationMs) {
        const isRescue = Boolean(task.isHotfixRescue);
        builder.isHotfixSprinter = false;
        builder.jenkinsBuildsCount = (builder.jenkinsBuildsCount ?? 0) + 1;
        if (isRescue) {
          builder.completedTransfersCount += 1;
          this.state.isJenkinsBrokenAlert = false;
          this.state.brokenBuildNumber = null;
          this.state.jenkinsHotfixCelebrationAt = nowWall;
        }

        // Hoàn tất bản build Jenkins 100% -> Ghi nhận vào danh sách `jenkinsBuilds`
        const completedJob: JenkinsBuildJobItem = {
          id: `JENKINS-JOB-${task.buildNumber}-${nowWall}`,
          buildNumber: task.buildNumber,
          jobName: task.jobName,
          clusterId: targetStation.id as 'CI' | 'UAT' | 'RELEASE',
          status: 'SUCCESS',
          statusText: isRescue ? 'back to normal' : 'stable',
          timeAgo: 'just now',
          triggeredByAccount: task.employeeAccount,
          ticketKey: task.ticketKey,
          url: `${targetStation.rssUrl.replace('/rssAll', '')}/${task.buildNumber}/`,
        };

        // Cập nhật lại timeAgo của các job trước đó và thêm job vừa build xong lên đầu
        const updatedPrev = this.state.jenkinsBuilds.map((j, idx) => ({
          ...j,
          timeAgo:
            j.timeAgo === 'just now'
              ? '1m ago'
              : idx === 0 && j.timeAgo === '2m ago'
                ? '3m ago'
                : j.timeAgo,
        }));
        this.state.jenkinsBuilds = [completedJob, ...updatedPrev].slice(0, 8);
        this.state.jenkinsLastCompletedAt = nowWall;

        this.prependActivityLog({
          id: `LOG-JENKINS-DONE-${task.id}`,
          timestamp: formatTimeHHMMSS(),
          ticketKey: task.ticketKey,
          ticketStatus: 'READY_FOR_DEPLOY',
          fromEmployeeId: builder.id,
          fromEmployeeName: `${task.employeeAccount} (${task.employeeSeatCode})`,
          toEmployeeId: builder.id,
          toEmployeeName: `${targetStation.shortTitle} • ${task.jobName}`,
          isReturnToPM: false,
          message: isRescue
            ? `🎉 HOTFIX RESCUE THÀNH CÔNG! ${task.employeeAccount} đã sửa xong Build Broken #${task.brokenBuildNumber ?? task.buildNumber - 1} ➔ Build #${task.buildNumber} (${task.jobName} • back to normal ✅ • 100%) [${task.ticketKey}]!`
            : `✅ ${task.employeeAccount} vừa chạy xong bản build #${task.buildNumber} ${task.jobName} (stable • 100%) tại ${targetStation.title} [${task.ticketKey}]!`,
          type: 'COMPLETED',
        });

        this.addSpeechBubble(
          builder.id,
          isRescue
            ? `🎉 Cứu Build #${task.buildNumber} (${task.jobName}) thành công: Back to normal ✅!`
            : `✅ Build #${task.buildNumber} ${task.jobName} (stable) hoàn tất 100%!`,
          'done'
        );

        task.phase = 'RETURNING_TO_DESK';
        task.currentSegmentIndex = 0;
        this.phaseElapsedMs.set(task.id, 0);
        builder.status = 'WALKING_BACK';
        builder.currentPath = task.returnPath;
        builder.targetPosition =
          task.returnPath[task.returnPath.length - 1] ?? null;

        if (task.returnPath.length > 1) {
          builder.facing = getDirectionBetweenPoints(
            task.returnPath[0],
            task.returnPath[1],
            builder.facing
          );
          builder.isoDirection = getIsoDirectionBetweenPoints(
            task.returnPath[0],
            task.returnPath[1],
            builder.isoDirection ?? 'SW'
          );
          builder.facingAngle = getIsoFacingAngleBetweenPoints(
            task.returnPath[0],
            task.returnPath[1],
            builder.facingAngle
          );
        }
        return true;
      }
      return true;
    }

    if (task.phase === 'RETURNING_TO_DESK') {
      builder.status = 'WALKING_BACK';

      const stepPx =
        (builder.baseSpeed *
          (builder.speedMultiplier ?? 1.0) *
          1.1 *
          scaledDeltaMs) /
        1000;
      const stepRes = stepAlongPath(
        builder.currentPosition,
        task.returnPath,
        task.currentSegmentIndex,
        stepPx,
        builder.facing
      );

      builder.currentPosition = stepRes.position;
      builder.facing = stepRes.facing;
      builder.isoDirection = stepRes.isoDirection;
      builder.facingAngle = stepRes.facingAngle;
      task.currentSegmentIndex = stepRes.segmentIndex;

      if (stepRes.reachedEnd) {
        const homeDesk = DESK_BY_ID[builder.deskId];
        if (homeDesk) {
          builder.currentPosition = { ...homeDesk.seatPosition };
          builder.facing = homeDesk.orientation;
          builder.isoDirection = directionToIsoDirection(homeDesk.orientation);
          builder.facingAngle = isoDirectionToAngle(builder.isoDirection);
        }
        builder.currentPath = [];
        builder.targetPosition = null;

        const hasRemainingTickets = this.state.tickets.some(
          (t) => t.status !== 'DONE' && t.assigneeId === builder.id
        );
        builder.status = hasRemainingTickets
          ? builder.role === 'TECH_LEAD' || builder.role === 'QA'
            ? 'REVIEWING'
            : 'WORKING'
          : 'IDLE';

        this.phaseElapsedMs.delete(task.id);
        this.state.activeJenkinsBuild = null;
        return true;
      }
      return false;
    }

    this.state.activeJenkinsBuild = null;
    return true;
  }

  // ==========================================================================
  // JIRA EVENT HANDLER -> DOCUMENT TRANSFER TASK CREATION
  // ==========================================================================

  private handleJiraWebhookEvent(event: JiraWebhookEvent): void {
    // 1. Update tickets list
    const existingIdx = this.state.tickets.findIndex(
      (t) => t.id === event.ticket.id || t.key === event.ticket.key
    );
    if (existingIdx >= 0) {
      const nextTickets = [...this.state.tickets];
      nextTickets[existingIdx] = event.ticket;
      this.state.tickets = nextTickets;
    } else {
      this.state.tickets = [event.ticket, ...this.state.tickets];
    }

    // 2. Enqueue physical DocumentTransferTask from `fromEmployeeId` -> `toEmployeeId`
    const fromId = event.fromEmployeeId || PROJECT_MANAGER.id;
    const toId = event.isReturnToPM
      ? PROJECT_MANAGER.id
      : event.toEmployeeId || PROJECT_MANAGER.id;

    this.enqueueDocumentTransfer({
      ticketId: event.ticket.id,
      ticketKey: event.ticket.key,
      ticketSummary: event.ticket.summary,
      ticketPriority: event.ticket.priority,
      targetStatus: event.toStatus,
      fromEmployeeId: fromId,
      toEmployeeId: toId,
      isReturnToPM: event.isReturnToPM,
      documentStackSize: event.ticket.documentStackSize,
      description: event.summaryMessage,
    });

    // 3. Nếu Ticket chuyển sang CODE_REVIEW, QA_TESTING hoặc READY_FOR_DEPLOY và Trạm Server đang rảnh -> cử kỹ sư đi chạy Build Jenkins!
    if (
      (event.toStatus === 'CODE_REVIEW' ||
        event.toStatus === 'QA_TESTING' ||
        event.toStatus === 'READY_FOR_DEPLOY') &&
      !this.state.activeJenkinsBuild
    ) {
      this.triggerJenkinsBuild({
        ticketKey: event.ticket.key,
      });
    }
  }

  /**
   * Kiểm tra & thực thi cơ chế Check-In Ghế Làm Việc Đầu Ngày hoặc Tụ Tập Hút Thuốc Ở Giếng Trời (`🚬 💨`):
   * - Đầu mỗi ngày (`00:00` hoặc khi mới mở app), 100% bàn làm việc sẽ trống (`isCheckedIn = false`).
   * - Khi 1 nhân viên phát sinh Event đầu tiên trong ngày (Jira Activity hoặc Jenkins Build):
   *   + Nếu công ty còn chỗ ngồi trống (`checkedInCount < maxSeats`): Nhân viên Check-in từ `🚪 CỬA RA VÀO`,
   *     chiếm ghế làm việc của mình (`isCheckedIn = true`).
   *   + Nếu công ty ĐÃ FULL CHỖ NGỒI (`checkedInCount >= maxSeats`): Nhân viên đi bộ từ `🚪 CỬA RA VÀO`
   *     ra hành lang đá xám bao quanh 1 trong 3 Giếng trời (`ATRIUM_SMOKING_SPOTS`) đứng tụ tập hút thuốc (`🚬 💨`)!
   */
  private ensureEmployeeCheckedInOrSmoking(
    emp: Employee,
    eventLabel: string
  ): 'CHECKED_IN' | 'SMOKING' {
    if (emp.isManager || emp.isFemaleManager) {
      emp.isCheckedIn = true;
      emp.isSmokingAtAtrium = false;
      return 'CHECKED_IN';
    }
    if (emp.isCheckedIn) {
      return 'CHECKED_IN';
    }
    if (emp.isSmokingAtAtrium) {
      return 'SMOKING';
    }

    const maxSeatsCfg = this.state.config.maxOpenSeats;
    const maxSeats =
      maxSeatsCfg === 12 ? 12 : maxSeatsCfg === 30 ? 30 : 30;
    const currentCheckedIn = this.state.employees.filter(
      (e) => !e.isManager && !e.isFemaleManager && e.isCheckedIn
    ).length;

    if (currentCheckedIn < maxSeats) {
      emp.isCheckedIn = true;
      emp.checkedInDeskId = emp.deskId;
      emp.isSmokingAtAtrium = false;
      emp.isWalkingFromEntrance = true;

      const cleanAcc = (emp.account || emp.displayName).replace(' (KH)', '');
      this.prependActivityLog({
        id: `LOG-CHECKIN-${emp.id}-${Date.now()}`,
        timestamp: formatTimeHHMMSS(),
        ticketKey: eventLabel,
        ticketStatus: 'IN_PROGRESS',
        fromEmployeeId: emp.id,
        fromEmployeeName: `${cleanAcc} (${emp.seatCode?.replace('FT3.III2A.', '') || emp.deskId})`,
        toEmployeeId: emp.id,
        toEmployeeName: `Chỗ ngồi ${emp.seatCode || emp.deskId}`,
        isReturnToPM: false,
        message: `🌅 CHECK-IN ĐẦU NGÀY (${currentCheckedIn + 1}/${maxSeats} ghế): ${cleanAcc} có event [${eventLabel}] -> từ 🚪 CỬA RA VÀO vào chiếm bàn ${emp.seatCode || emp.deskId}!`,
        type: 'CREATED',
      });
      return 'CHECKED_IN';
    }

    // ĐÃ FULL CHỖ NGỒI! Cử nhân viên đi từ Cửa Ra Vào ra hành lang Giếng Trời tụ tập hút thuốc (`🚬 💨`)
    const spot =
      ATRIUM_SMOKING_SPOTS[
        this.smokingSpotCursor % ATRIUM_SMOKING_SPOTS.length
      ];
    this.smokingSpotCursor += 1;

    emp.isCheckedIn = false;
    emp.checkedInDeskId = null;
    emp.isSmokingAtAtrium = true;
    emp.isWalkingFromEntrance = true;
    emp.smokingSpot = { ...spot.position };
    emp.currentPosition = { ...ENTRANCE_DOOR_SPAWN_POINT };

    const walkPath = buildPointToPointPatrolPath(
      ENTRANCE_DOOR_SPAWN_POINT,
      spot.position
    );
    emp.currentPath = walkPath;
    emp.currentSegmentIndex = 0;
    emp.targetPosition = { ...spot.position };
    emp.status = 'WALKING_BACK';

    const cleanAcc = (emp.account || emp.displayName).replace(' (KH)', '');
    this.addSpeechBubble(
      emp.id,
      `🚬 Full ${maxSeats}/${maxSeats} bàn rồi! Ra ${spot.atriumName} hút thuốc hóng gió anh em ơi! 💨`,
      'info'
    );

    this.prependActivityLog({
      id: `LOG-SMOKE-${emp.id}-${Date.now()}`,
      timestamp: formatTimeHHMMSS(),
      ticketKey: eventLabel,
      ticketStatus: 'TODO',
      fromEmployeeId: emp.id,
      fromEmployeeName: cleanAcc,
      toEmployeeId: emp.id,
      toEmployeeName: `🚬 ${spot.atriumName}`,
      isReturnToPM: false,
      message: `🚬 FULL CHỖ NGỒI (${maxSeats}/${maxSeats})! ${cleanAcc} vào công ty sau khi đã hết bàn trống -> đi ra hành lang ${spot.atriumName} tụ tập hút thuốc 🚬 💨!`,
      type: 'HANDOFF',
    });

    return 'SMOKING';
  }

  private enqueueDocumentTransfer(params: {
    ticketId: string;
    ticketKey: string;
    ticketSummary: string;
    ticketPriority: TicketPriority;
    targetStatus: TicketStatus;
    fromEmployeeId: string;
    toEmployeeId: string;
    isReturnToPM: boolean;
    documentStackSize: number;
    description: string;
  }): DocumentTransferTask | null {
    const sender = this.state.employeeById[params.fromEmployeeId];
    const receiver =
      this.state.employeeById[params.toEmployeeId] ??
      this.state.employeeById[PROJECT_MANAGER.id];

    if (!sender || !receiver) return null;

    // Đảm bảo cả người gửi & người nhận được Check-in ghế làm việc đầu ngày (hoặc ra Giếng trời hút thuốc nếu đã full chỗ)
    const senderCheckIn = this.ensureEmployeeCheckedInOrSmoking(
      sender,
      params.ticketKey
    );
    this.ensureEmployeeCheckedInOrSmoking(receiver, params.ticketKey);

    if (senderCheckIn === 'SMOKING') {
      // Nếu người gửi vừa bị đẩy ra Giếng trời hút thuốc vì hết bàn, họ đứng hút thuốc thay vì đi giao tài liệu từ bàn
      this.emitChange(true);
      return null;
    }

    const fromDesk = DESK_BY_EMPLOYEE_ID[sender.id] ?? DESK_BY_ID[sender.deskId];
    const toDesk =
      DESK_BY_EMPLOYEE_ID[receiver.id] ??
      DESK_BY_ID[receiver.deskId] ??
      PM_DESK;

    if (!fromDesk || !toDesk) return null;

    // Alternate slight lane offsets (+4px / -4px) so multiple concurrent walkers look distinct
    this.laneFlipCounter += 1;
    const laneOffset = this.laneFlipCounter % 2 === 0 ? 4 : -4;
    const { outboundPath, returnPath } = findDeskToDeskPath(
      fromDesk.id,
      toDesk.id,
      { laneOffset }
    );

    const task: DocumentTransferTask = {
      id: `XFER-${params.ticketKey}-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 6)}`,
      ticketId: params.ticketId,
      ticketKey: params.ticketKey,
      ticketSummary: params.ticketSummary,
      ticketPriority: params.ticketPriority,
      targetStatus: params.targetStatus,
      fromEmployeeId: sender.id,
      toEmployeeId: receiver.id,
      fromDeskId: fromDesk.id,
      toDeskId: toDesk.id,
      isReturnToPM: params.isReturnToPM,
      documentStackSize: params.documentStackSize,
      phase: 'QUEUED',
      outboundPath,
      returnPath,
      currentSegmentIndex: 0,
      progress: 0,
      startedAt: Date.now(),
      description: params.description,
    };

    // Remove ticket from sender's assigned list & desk pile (unless sender is PM creating a new ticket)
    sender.assignedTicketIds = sender.assignedTicketIds.filter(
      (id) => id !== params.ticketId
    );
    if (!sender.isProjectManager && sender.deskDocumentCount > 0) {
      sender.deskDocumentCount = Math.max(0, sender.deskDocumentCount - 1);
    }

    // Add ActivityLogEntry
    this.prependActivityLog({
      id: `LOG-${task.id}`,
      timestamp: formatTimeHHMMSS(),
      ticketKey: params.ticketKey,
      ticketStatus: params.targetStatus,
      fromEmployeeId: sender.id,
      fromEmployeeName: sender.displayName,
      toEmployeeId: receiver.id,
      toEmployeeName: receiver.displayName,
      isReturnToPM: params.isReturnToPM,
      message: params.description,
      type: params.isReturnToPM ? 'RETURN_TO_PM' : 'HANDOFF',
    });

    const isSenderAlreadyWalking = this.state.activeTransfers.some(
      (t) => t.fromEmployeeId === sender.id
    );

    if (isSenderAlreadyWalking) {
      this.state.queuedTransfers = [...this.state.queuedTransfers, task];
    } else {
      this.beginTransferTask(task);
      this.state.activeTransfers = [...this.state.activeTransfers, task];
    }

    this.emitChange(true);
    return task;
  }

  private beginTransferTask(task: DocumentTransferTask): void {
    const sender = this.state.employeeById[task.fromEmployeeId];
    if (!sender) return;

    const senderDesk = DESK_BY_ID[sender.deskId];
    if (senderDesk) {
      sender.currentPosition = { ...senderDesk.seatPosition };
    }

    task.phase = 'PICKING_UP';
    task.startedAt = Date.now();
    task.currentSegmentIndex = 0;
    task.progress = 0.02;
    this.phaseElapsedMs.set(task.id, 0);

    sender.status = 'CARRYING_DOCS';
    sender.carryingTicketId = task.ticketId;
    sender.currentPath = task.outboundPath;
    sender.targetPosition =
      task.outboundPath[task.outboundPath.length - 1] ?? null;

    const isBugReturn =
      task.targetStatus === 'IN_PROGRESS' &&
      task.description.toLowerCase().includes('bug');
    const speech = getSpeechBubblesForTransition(
      task.targetStatus,
      task.ticketKey,
      isBugReturn
    );
    this.addSpeechBubble(
      sender.id,
      speech.senderSpeech,
      task.isReturnToPM ? 'done' : isBugReturn ? 'bug' : 'handoff'
    );
  }

  private addSpeechBubble(
    employeeId: string,
    text: string,
    variant: SpeechBubbleItem['variant'] = 'info'
  ): void {
    const now = Date.now();
    const filtered = this.state.speechBubbles.filter(
      (b) => b.employeeId !== employeeId
    );
    this.state.speechBubbles = [
      ...filtered,
      {
        id: `BUBBLE-${employeeId}-${now}`,
        employeeId,
        text,
        variant,
        createdAt: now,
        expiresAt: now + SPEECH_BUBBLE_DURATION_MS,
      },
    ];
  }

  private prependActivityLog(entry: ActivityLogEntry): void {
    this.state.activityLogs = [
      entry,
      ...this.state.activityLogs.slice(0, MAX_ACTIVITY_LOGS - 1),
    ];
  }

  // ==========================================================================
  // PUBLIC SIMULATION ACTIONS
  // ==========================================================================

  public toggleRunning = (): void => {
    this.state.config = {
      ...this.state.config,
      isRunning: !this.state.config.isRunning,
    };
    this.emitChange(true);
  };

  public setRunning = (isRunning: boolean): void => {
    this.state.config = {
      ...this.state.config,
      isRunning,
    };
    this.emitChange(true);
  };

  public setSpeedMultiplier = (speed: number): void => {
    const clamped = Math.max(0.25, Math.min(8, speed));
    this.state.config = {
      ...this.state.config,
      speedMultiplier: clamped,
      isRunning: true,
    };
    this.emitChange(true);
  };

  public toggleAutoSimulate = (): void => {
    this.state.config = {
      ...this.state.config,
      autoSimulate: !this.state.config.autoSimulate,
    };
    this.emitChange(true);
  };

  public setAutoSimulate = (enabled: boolean): void => {
    this.state.config = {
      ...this.state.config,
      autoSimulate: enabled,
    };
    this.emitChange(true);
  };

  /**
   * 1-Click xóa sạch toàn bộ dữ liệu Mock (`FRT-101`..`FRT-107`, các lượt đi bộ giả, lịch sử log giả)
   * để văn phòng sạch 100%, chỉ giữ lại Sếp nữ `ThuNDM` đi tuần tra thả tim.
   */
  public clearMockData = (): void => {
    this.clearMockDataInternal(true);
  };

  /**
   * 🌅 Reset Ngày Mới (`resetNewDayEmptyDesks`):
   * - Đưa 100% bàn làm việc trên bản đồ về trạng thái trống hoàn toàn (`isCheckedIn = false`).
   * - Chỉ giữ lại 4 vị Sếp (`ThuNDM`, `ToanLBK`, `doannt19`, `vanltb8`) đi tuần tra 4 phòng.
   * - Ai có Event trước trong ngày mới sẽ từ `🚪 CỬA RA VÀO` bước vào công ty chiếm 1 chỗ ngồi!
   */
  public resetNewDayEmptyDesks = (): void => {
    this.phaseElapsedMs.clear();
    this.smokingSpotCursor = 0;

    for (const emp of this.state.employees) {
      if (emp.isManager || emp.isFemaleManager) {
        emp.isCheckedIn = true;
        emp.isSmokingAtAtrium = false;
        continue;
      }
      const homeDesk = DESK_BY_ID[emp.deskId];
      emp.isCheckedIn = false;
      emp.checkedInDeskId = null;
      emp.isSmokingAtAtrium = false;
      emp.smokingSpot = undefined;
      emp.isWalkingFromEntrance = false;
      emp.carryingTicketId = null;
      emp.currentPath = [];
      emp.targetPosition = null;
      emp.status = 'IDLE';
      if (homeDesk) {
        emp.currentPosition = { ...homeDesk.seatPosition };
        emp.facing = homeDesk.orientation;
        emp.isoDirection = directionToIsoDirection(homeDesk.orientation);
        emp.facingAngle = isoDirectionToAngle(emp.isoDirection);
      }
    }

    this.state.activeTransfers = [];
    this.state.queuedTransfers = [];
    this.state.activeJenkinsBuild = null;

    this.prependActivityLog({
      id: `LOG-NEW-DAY-${Date.now()}`,
      timestamp: formatTimeHHMMSS(),
      ticketKey: 'NEW-DAY',
      ticketStatus: 'TODO',
      fromEmployeeId: FEMALE_MANAGER_ID,
      fromEmployeeName: 'Hệ Thống Văn Phòng FRT',
      toEmployeeId: FEMALE_MANAGER_ID,
      toEmployeeName: 'Toàn bộ 16 Đảo Bàn (96 Ghế)',
      isReturnToPM: false,
      message:
        '🌅 RESET NGÀY MỚI! Toàn bộ bàn làm việc trên bản đồ đã trống 100%. Ai có Event trước sẽ vào công ty chiếm chỗ ngồi trước; khi full ghế, các thành viên sau sẽ ra Giếng trời hút thuốc 🚬 💨!',
      type: 'CREATED',
    });

    this.emitChange(true);
  };

  /**
   * 🚬 Test Full Chỗ -> Ra Giếng Trời Hút Thuốc (`triggerTestFullSeatsSmoking`):
   * - Lấp đầy số ghế mở trong ngày (`maxOpenSeats`: mặc định 12 ghế đầu tiên để dễ quan sát, hoặc 30 ghế).
   * - Cử ngay 8 thành viên tiếp theo đi bộ ra 3 Giếng trời (`North Sky Atrium`, `Central Grand Atrium`, `South Garden Atrium`)
   *   đứng dọc hành lang đá xám cạnh cột trắng, cầm điếu thuốc lá đỏ rực và nhả khói `🚬 💨`!
   */
  public triggerTestFullSeatsSmoking = (): void => {
    const maxSeatsCfg = this.state.config.maxOpenSeats;
    const seatCap = maxSeatsCfg === 12 ? 12 : 22;

    const regularEmps = this.state.employees.filter(
      (e) => !e.isManager && !e.isFemaleManager
    );

    regularEmps.forEach((emp, idx) => {
      const homeDesk = DESK_BY_ID[emp.deskId];
      if (idx < seatCap) {
        emp.isCheckedIn = true;
        emp.checkedInDeskId = emp.deskId;
        emp.isSmokingAtAtrium = false;
        emp.smokingSpot = undefined;
        emp.isWalkingFromEntrance = false;
        if (
          emp.status !== 'CARRYING_DOCS' &&
          emp.status !== 'WALKING_BACK' &&
          homeDesk
        ) {
          emp.currentPosition = { ...homeDesk.seatPosition };
          emp.currentPath = [];
          emp.targetPosition = null;
          emp.status = 'WORKING';
        }
      } else {
        const spot =
          ATRIUM_SMOKING_SPOTS[
            (idx - seatCap) % ATRIUM_SMOKING_SPOTS.length
          ];
        emp.isCheckedIn = false;
        emp.checkedInDeskId = null;
        emp.isSmokingAtAtrium = true;
        emp.smokingSpot = { ...spot.position };
        emp.carryingTicketId = null;

        // Cho một nửa đi bộ từ Cửa Ra Vào tới Giếng trời, một nửa đã đứng sẵn tại Giếng trời nhả khói
        if (idx < seatCap + 4) {
          emp.currentPosition = { ...ENTRANCE_DOOR_SPAWN_POINT };
          const walkPath = buildPointToPointPatrolPath(
            ENTRANCE_DOOR_SPAWN_POINT,
            spot.position
          );
          emp.currentPath = walkPath;
          emp.currentSegmentIndex = 0;
          emp.targetPosition = { ...spot.position };
          emp.status = 'WALKING_BACK';
          emp.isWalkingFromEntrance = true;
        } else {
          emp.currentPosition = { ...spot.position };
          emp.currentPath = [];
          emp.targetPosition = null;
          emp.status = 'IDLE';
          emp.isWalkingFromEntrance = false;
        }

        if (idx === seatCap || idx === seatCap + 1 || idx === seatCap + 4) {
          this.addSpeechBubble(
            emp.id,
            `🚬 Hết sạch ${seatCap} bàn ngồi rồi anh em ơi! Ra ${spot.atriumName} hút thuốc chém gió thôi! 💨`,
            'info'
          );
        }
      }
    });

    this.prependActivityLog({
      id: `LOG-TEST-SMOKE-${Date.now()}`,
      timestamp: formatTimeHHMMSS(),
      ticketKey: 'FULL-SEATS',
      ticketStatus: 'IN_PROGRESS',
      fromEmployeeId: regularEmps[seatCap]?.id || 'EMP-20',
      fromEmployeeName: `${regularEmps.length - seatCap} Thành viên đến sau`,
      toEmployeeId: FEMALE_MANAGER_ID,
      toEmployeeName: '🚬 3 Giếng Trời FRT (Atrium Promenade)',
      isReturnToPM: false,
      message: `🚬 ĐÃ FULL ${seatCap}/${seatCap} CHỖ NGỒI! ${
        regularEmps.length - seatCap
      } thành viên có event sau cùng đã kéo nhau ra hành lang 3 Giếng Trời tụ tập hút thuốc 🚬 💨!`,
      type: 'HANDOFF',
    });

    this.emitChange(true);
  };

  public setMaxOpenSeats = (limit: 12 | 30 | 'FULL'): void => {
    this.state.config = {
      ...this.state.config,
      maxOpenSeats: limit,
    };
    this.emitChange(true);
  };

  private clearMockDataInternal(emit = true): void {
    this.phaseElapsedMs.clear();
    this.autoStepAccumulatorMs = 0;
    this.jenkinsAutoBuildAccumulatorMs = 0;
    this.seenLiveJiraEntryIds.clear();
    this.seenLiveJenkinsBuildIds.clear();

    const cleanEmployees = cloneInitialEmployees([]).map((emp) => {
      if (emp.isFemaleManager || emp.isManager) {
        const existingBoss = this.state.employeeById[emp.id];
        return existingBoss ? { ...existingBoss } : emp;
      }
      return {
        ...emp,
        status: 'IDLE' as EmployeeStatus,
        carryingTicketId: null,
        assignedTicketIds: [],
        deskDocumentCount: 0,
        completedTransfersCount: 0,
        isCheckedIn: false,
        checkedInDeskId: null,
        isSmokingAtAtrium: false,
      };
    });

    this.state.employees = cleanEmployees;
    this.state.employeeById = Object.fromEntries(
      cleanEmployees.map((e) => [e.id, e])
    );
    this.state.tickets = [];
    this.state.activeTransfers = [];
    this.state.queuedTransfers = [];
    this.state.activeJenkinsBuild = null;
    this.state.jenkinsBuilds = [];
    this.state.jenkinsLastCompletedAt = null;
    this.state.isJenkinsBrokenAlert = false;
    this.state.brokenBuildNumber = null;
    this.state.jenkinsHotfixCelebrationAt = null;
    this.state.activityLogs = [];
    this.state.speechBubbles = [];
    this.state.pmCelebrations = [];
    this.state.isSprintRush = false;
    this.state.sprintRushEndsAt = null;
    this.state.selectedTicketId = null;

    if (emit) {
      this.emitChange(true);
    }
  }

  /**
   * Chuyển đổi giữa Chế độ Dữ liệu Thật (`'LIVE_FRT'` — Tắt toàn bộ Mock)
   * và Chế độ Giả lập Demo (`'MOCK_PILOT'`).
   */
  public setDataSourceMode = (mode: DataSourceMode): void => {
    this.state.dataSourceMode = mode;
    savePersistedDataSourceMode(mode);

    if (mode === 'LIVE_FRT') {
      // Tắt ngay bộ tự sinh ticket Mock ngẫu nhiên
      this.state.config = {
        ...this.state.config,
        autoSimulate: false,
        isRunning: true,
      };
      this.state.isSprintRush = false;
      this.state.sprintRushEndsAt = null;

      if (this.state.liveConfig.clearMockOnLive) {
        this.clearMockDataInternal(false);
      }

      this.syncLivePollingLoop(true);
    } else {
      // Dừng vòng lặp Polling Live, bật lại chế độ Demo Mock
      this.syncLivePollingLoop(false);
      this.state.config = {
        ...this.state.config,
        autoSimulate: true,
        isRunning: true,
      };

      if (
        this.state.tickets.length === 0 &&
        this.adapter instanceof MockJiraAdapter
      ) {
        const mockTickets = this.adapter.reset();
        const currentManager = this.state.employeeById[FEMALE_MANAGER_ID];
        const mockEmployees = cloneInitialEmployees(mockTickets).map((emp) =>
          (emp.isFemaleManager || emp.id === FEMALE_MANAGER_ID) && currentManager
            ? { ...currentManager }
            : emp
        );
        this.state.tickets = mockTickets;
        this.state.employees = mockEmployees;
        this.state.employeeById = Object.fromEntries(
          mockEmployees.map((e) => [e.id, e])
        );
        this.state.jenkinsBuilds = [...DEFAULT_JENKINS_RECENT_BUILDS];
      }
    }

    this.emitChange(true);
  };

  /**
   * Cập nhật thông số `liveConfig` và lưu vào `localStorage` để F5 vẫn giữ nguyên.
   */
  public updateLiveConfig = (patch: Partial<LiveFrtConfig>): void => {
    const prevInterval = this.state.liveConfig.pollIntervalSec;
    const prevClearMock = this.state.liveConfig.clearMockOnLive;

    this.state.liveConfig = {
      ...this.state.liveConfig,
      ...patch,
    };
    savePersistedLiveConfig(this.state.liveConfig);

    if (this.state.dataSourceMode === 'LIVE_FRT') {
      if (patch.clearMockOnLive && !prevClearMock) {
        this.clearMockDataInternal(false);
      }
      if (
        patch.pollIntervalSec !== undefined &&
        patch.pollIntervalSec !== prevInterval
      ) {
        this.syncLivePollingLoop(false);
      }
    }

    this.emitChange(true);
  };

  /**
   * Quản lý vòng lặp Polling định kỳ gọi `/api/frt-jira-activity` và `/api/frt-jenkins-rss`
   * khi ở chế độ `LIVE_FRT`.
   */
  private syncLivePollingLoop(triggerImmediateFetch: boolean): void {
    if (this.livePollTimer) {
      clearInterval(this.livePollTimer);
      this.livePollTimer = null;
    }

    if (
      typeof window === 'undefined' ||
      this.state.dataSourceMode !== 'LIVE_FRT'
    ) {
      return;
    }

    if (triggerImmediateFetch) {
      void this.fetchLiveFrtFeeds();
    }

    const intervalMs =
      Math.max(3, Number(this.state.liveConfig.pollIntervalSec) || 10) * 1000;
    this.livePollTimer = setInterval(() => {
      if (this.state.dataSourceMode === 'LIVE_FRT') {
        void this.fetchLiveFrtFeeds();
      }
    }, intervalMs);
  }

  public updateConfig = (partial: Partial<SimulationConfig>): void => {
    const nextShowPaths =
      partial.showPaths !== undefined
        ? partial.showPaths
        : partial.showActivePaths !== undefined
          ? partial.showActivePaths
          : this.state.config.showActivePaths;

    this.state.config = {
      ...this.state.config,
      ...partial,
      showActivePaths: nextShowPaths,
      showPaths: nextShowPaths,
    };
    this.emitChange(true);
  };

  public createTicket = async (input: CreateTicketInput): Promise<JiraTicket> => {
    return this.adapter.createTicket(input);
  };

  public createRandomTicket = async (
    category?: 'BACKEND' | 'FRONTEND' | 'MOBILE' | 'DEVOPS'
  ): Promise<JiraTicket> => {
    if (this.adapter instanceof MockJiraAdapter) {
      return this.adapter.createRandomTicket(category);
    }
    return this.adapter.createTicket({
      summary: 'FRT Feature Task mới từ PM',
      priority: 'HIGH',
      storyPoints: 5,
    });
  };

  public transitionTicket = async (
    ticketIdOrKey: string,
    nextStatus: TicketStatus,
    nextAssigneeId?: string,
    comment?: string
  ): Promise<JiraTicket | null> => {
    const existing = this.state.tickets.find(
      (t) => t.id === ticketIdOrKey || t.key === ticketIdOrKey
    );
    if (!existing) return null;

    let targetEmpId = nextAssigneeId;
    if (!targetEmpId) {
      if (nextStatus === 'DONE') {
        targetEmpId = PROJECT_MANAGER.id;
      } else if (this.adapter instanceof MockJiraAdapter) {
        targetEmpId = this.adapter.resolveDefaultAssigneeForStatus(
          existing,
          nextStatus
        );
      } else {
        targetEmpId = PROJECT_MANAGER.id;
      }
    }

    return this.adapter.transitionTicket(
      existing.id,
      nextStatus,
      targetEmpId,
      comment
    );
  };

  public advanceTicket = async (
    ticketIdOrKey?: string
  ): Promise<JiraWebhookEvent | null> => {
    if (this.adapter instanceof MockJiraAdapter) {
      const busyIds = new Set(
        this.state.activeTransfers.map((t) => t.fromEmployeeId)
      );
      return this.adapter.advanceTicketWorkflow(ticketIdOrKey, busyIds);
    }
    if (this.adapter.advanceTicketWorkflow) {
      return this.adapter.advanceTicketWorkflow(ticketIdOrKey);
    }
    return null;
  };

  public rejectTicketWithBug = async (
    ticketIdOrKey: string,
    reason?: string
  ): Promise<JiraWebhookEvent | null> => {
    if (this.adapter instanceof MockJiraAdapter) {
      return this.adapter.rejectTicketWithBug(ticketIdOrKey, reason);
    }
    const existing = this.state.tickets.find(
      (t) => t.id === ticketIdOrKey || t.key === ticketIdOrKey
    );
    if (!existing) return null;
    await this.transitionTicket(
      existing.id,
      'IN_PROGRESS',
      existing.previousAssigneeId ?? 'EMP-07',
      reason ?? '🐞 Phát hiện lỗi khi kiểm thử, trả hồ sơ về Dev sửa!'
    );
    return null;
  };

  public completeTicketToPM = async (
    ticketIdOrKey: string
  ): Promise<JiraTicket | null> => {
    return this.transitionTicket(
      ticketIdOrKey,
      'DONE',
      PROJECT_MANAGER.id,
      `🎉 Hoàn tất 100%! Mang chồng tài liệu nghiệm thu về bàn ${PROJECT_MANAGER.displayName}!`
    );
  };

  public manualTransfer = async (
    ticketIdOrKey: string,
    fromEmployeeId: string,
    toEmployeeId: string,
    nextStatus: TicketStatus = 'IN_PROGRESS',
    comment?: string
  ): Promise<JiraTicket | null> => {
    const existing = this.state.tickets.find(
      (t) => t.id === ticketIdOrKey || t.key === ticketIdOrKey
    );
    const resolvedTarget =
      nextStatus === 'DONE' ? PROJECT_MANAGER.id : toEmployeeId;

    if (existing && this.adapter instanceof MockJiraAdapter) {
      return this.adapter.transitionTicket(
        existing.id,
        nextStatus,
        resolvedTarget,
        comment,
        fromEmployeeId
      );
    }

    this.dispatchManualTransfer({
      fromEmployeeId,
      toEmployeeId: resolvedTarget,
      ticketKey: ticketIdOrKey,
      targetStatus: nextStatus,
      isReturnToPM: nextStatus === 'DONE',
    });
    return existing ?? null;
  };

  public clearActivityLogs = (): void => {
    this.state.activityLogs = [];
    this.emitChange(true);
  };

  public dispatchManualTransfer = (params: {
    fromEmployeeId: string;
    toEmployeeId: string;
    ticketKey?: string;
    ticketSummary?: string;
    priority?: TicketPriority;
    targetStatus?: TicketStatus;
    isReturnToPM?: boolean;
  }): DocumentTransferTask | null => {
    const isReturnToPM =
      params.isReturnToPM ??
      (params.targetStatus === 'DONE' ||
        params.toEmployeeId === PROJECT_MANAGER.id);
    const fromEmp = this.state.employeeById[params.fromEmployeeId];
    const toEmp = this.state.employeeById[params.toEmployeeId];
    if (!fromEmp || !toEmp) return null;

    const ticketKey = params.ticketKey ?? `FRT-${Math.floor(110 + Math.random() * 80)}`;
    const summary = params.ticketSummary ?? 'Bàn giao tài liệu kỹ thuật Sprint';
    const status = params.targetStatus ?? (isReturnToPM ? 'DONE' : 'IN_PROGRESS');

    return this.enqueueDocumentTransfer({
      ticketId: `MANUAL-${ticketKey}`,
      ticketKey,
      ticketSummary: summary,
      ticketPriority: params.priority ?? 'HIGH',
      targetStatus: status,
      fromEmployeeId: fromEmp.id,
      toEmployeeId: toEmp.id,
      isReturnToPM,
      documentStackSize: 3,
      description: isReturnToPM
        ? `🎉 ${fromEmp.displayName} mang chồng hồ sơ nghiệm thu ${ticketKey} về bàn ${toEmp.displayName}!`
        : `${fromEmp.displayName} cầm chồng tài liệu ${ticketKey} sang bàn ${toEmp.displayName}`,
    });
  };

  /**
   * Cử một kỹ sư (`TienHK`, `SonNA2`, `ChienND22`, `ManhPT13`, `BaoNAT`, `ThanhDQ13`...)
   * đứng dậy từ bàn làm việc, đi bộ theo đường A* tới Trạm Máy Tính Server Jenkins (`oneclickv4-build-ci`)
   * và đứng gõ bàn phím chạy bản build.
   */
  public triggerJenkinsBuild = (params?: {
    employeeId?: string;
    account?: string;
    ticketKey?: string;
    buildNumber?: number;
    statusText?: string;
  }): ActiveJenkinsBuildTask | null => {
    const busyTransferIds = new Set(
      this.state.activeTransfers.map((t) => t.fromEmployeeId)
    );

    const candidateIds = [
      'EMP-29', // TienHK (DevOps - Cụm 3.3)
      'EMP-30', // SonNA2 (DevOps - Cụm 3.3)
      'EMP-07', // ChienND22 (Backend - Cụm 2.1)
      'EMP-06', // ManhPT13 (Mobile Lead - Cụm 2.3)
      'EMP-15', // BaoNAT (Frontend - Cụm 2.2)
      'EMP-04', // ThanhDQ13 (Tech Lead - Cụm 2.1)
    ];

    let chosenEmp: Employee | undefined;

    if (params?.account) {
      const resolved = resolveEmployeeByAccountCaseInsensitive(params.account);
      if (resolved) {
        chosenEmp = this.state.employeeById[resolved.employeeId];
      }
    }
    if (!chosenEmp && params?.employeeId) {
      chosenEmp = this.state.employeeById[params.employeeId];
    }
    if (!chosenEmp) {
      for (let i = 0; i < candidateIds.length; i++) {
        const idx = (this.jenkinsCandidateIndex + i) % candidateIds.length;
        const cid = candidateIds[idx];
        if (!busyTransferIds.has(cid)) {
          chosenEmp = this.state.employeeById[cid];
          this.jenkinsCandidateIndex = idx + 1;
          break;
        }
      }
    }
    if (!chosenEmp) {
      chosenEmp = this.state.employeeById['EMP-29'] ?? this.state.employees[0];
    }
    if (!chosenEmp) return null;

    // Nếu đang có người khác đứng build dở, đưa người cũ về lại bàn trước khi bắt đầu lượt build mới
    if (
      this.state.activeJenkinsBuild &&
      this.state.activeJenkinsBuild.employeeId !== chosenEmp.id
    ) {
      const prevBuilder =
        this.state.employeeById[this.state.activeJenkinsBuild.employeeId];
      if (prevBuilder) {
        const prevDesk = DESK_BY_ID[prevBuilder.deskId];
        if (prevDesk) {
          prevBuilder.currentPosition = { ...prevDesk.seatPosition };
          prevBuilder.facing = prevDesk.orientation;
          prevBuilder.isoDirection = directionToIsoDirection(
            prevDesk.orientation
          );
          prevBuilder.facingAngle = isoDirectionToAngle(
            prevBuilder.isoDirection
          );
        }
        prevBuilder.status = 'WORKING';
      }
    }

    const fromDesk =
      DESK_BY_EMPLOYEE_ID[chosenEmp.id] ?? DESK_BY_ID[chosenEmp.deskId] ?? PM_DESK;
    const { outboundPath: rawOutbound, returnPath } = findDeskToDeskPath(
      fromDesk.id,
      'DESK-JENKINS-SERVER'
    );

    // Cho phép đi tiếp từ vị trí hiện tại của kỹ sư nếu họ đang trên hành lang
    const outboundPath =
      rawOutbound.length >= 2
        ? [{ ...chosenEmp.currentPosition }, ...rawOutbound.slice(1)]
        : [
            { ...chosenEmp.currentPosition },
            { ...JENKINS_SERVER_STATION.operatorPosition },
          ];

    const buildNum = params?.buildNumber ?? this.nextJenkinsBuildNumber++;
    if (buildNum >= this.nextJenkinsBuildNumber) {
      this.nextJenkinsBuildNumber = buildNum + 1;
    }

    const activeTicket =
      this.state.tickets.find((t) => t.key === params?.ticketKey) ??
      this.state.tickets.find((t) => t.assigneeId === chosenEmp?.id && t.status !== 'DONE') ??
      this.state.tickets.find((t) => t.status === 'CODE_REVIEW' || t.status === 'QA_TESTING') ??
      this.state.tickets[0];
    const ticketKey = params?.ticketKey || activeTicket?.key || 'FRT-104';

    const buildTask: ActiveJenkinsBuildTask = {
      id: `JENKINS-BUILD-${buildNum}-${Date.now()}`,
      employeeId: chosenEmp.id,
      employeeAccount: chosenEmp.account || chosenEmp.displayName,
      employeeSeatCode: chosenEmp.seatCode || '1.318',
      jobName: JENKINS_SERVER_STATION.jobName,
      buildNumber: buildNum,
      ticketKey,
      phase: 'WALKING_TO_SERVER',
      outboundPath,
      returnPath,
      currentSegmentIndex: 0,
      buildProgress: 0,
      startedAt: Date.now(),
    };

    this.state.activeJenkinsBuild = buildTask;
    this.phaseElapsedMs.set(buildTask.id, 0);

    chosenEmp.status = 'WALKING_BACK';
    chosenEmp.currentPath = outboundPath;
    chosenEmp.currentSegmentIndex = 0;
    chosenEmp.targetPosition =
      outboundPath[outboundPath.length - 1] ?? null;

    if (outboundPath.length > 1) {
      chosenEmp.facing = getDirectionBetweenPoints(
        outboundPath[0],
        outboundPath[1],
        chosenEmp.facing
      );
      chosenEmp.isoDirection = getIsoDirectionBetweenPoints(
        outboundPath[0],
        outboundPath[1],
        chosenEmp.isoDirection ?? 'NE'
      );
      chosenEmp.facingAngle = getIsoFacingAngleBetweenPoints(
        outboundPath[0],
        outboundPath[1],
        chosenEmp.facingAngle
      );
    }

    this.prependActivityLog({
      id: `LOG-JENKINS-START-${buildTask.id}`,
      timestamp: formatTimeHHMMSS(),
      ticketKey,
      ticketStatus: 'CODE_REVIEW',
      fromEmployeeId: chosenEmp.id,
      fromEmployeeName: `${buildTask.employeeAccount} (${buildTask.employeeSeatCode})`,
      toEmployeeId: chosenEmp.id,
      toEmployeeName: 'JENKINS CI • oneclickv4-build-ci',
      isReturnToPM: false,
      message: `⚙️ ${buildTask.employeeAccount} (${buildTask.employeeSeatCode}) đi bộ tới Trạm Máy Tính Server chạy Build Jenkins #${buildNum} (${buildTask.jobName}) cho [${ticketKey}]!`,
      type: 'HANDOFF',
    });

    this.addSpeechBubble(
      chosenEmp.id,
      `🚀 Ra Trạm Server chạy Jenkins CI #${buildNum} (${buildTask.jobName}) cho ${ticketKey}!`,
      'info'
    );

    this.emitChange(true);
    return buildTask;
  };

  /**
   * 🚨 Sự kiện Game "Jenkins Build Broken Alert & Hotfix Rescue" (Khai thác trạng thái `broken` / `regression` trong `rssAll`):
   * - Đặt Trạm Server Jenkins vào trạng thái Đèn Cảnh Báo Đỏ Chớp Nháy (`🚨 BUILD BROKEN #2843`)
   * - Cử Kỹ sư phụ trách (`TienHK`, `SonNA2` hoặc người vừa commit) chạy nước rút (`⚡ HOTFIX SPRINT`)
   *   ra Trạm Server để cứu build (`Fixing broken build -> Back to normal ✅`) kèm pháo hoa ăn mừng!
   */
  public triggerJenkinsBrokenHotfix = (params?: {
    employeeId?: string;
    account?: string;
    ticketKey?: string;
    brokenBuildNumber?: number;
  }): ActiveJenkinsBuildTask | null => {
    const brokenNum = params?.brokenBuildNumber ?? this.nextJenkinsBuildNumber++;
    const rescueNum =
      brokenNum >= this.nextJenkinsBuildNumber
        ? brokenNum + 1
        : this.nextJenkinsBuildNumber++;
    if (rescueNum >= this.nextJenkinsBuildNumber) {
      this.nextJenkinsBuildNumber = rescueNum + 1;
    }

    const activeTicket =
      this.state.tickets.find((t) => t.key === params?.ticketKey) ??
      this.state.tickets.find((t) => t.status !== 'DONE') ??
      this.state.tickets[0];
    const ticketKey = params?.ticketKey || activeTicket?.key || 'FI-35471';

    // Chọn kỹ sư cứu hoả ưu tiên DevOps (SonNA2, TienHK) hoặc người được truyền vào
    const rescueCandidates = ['EMP-30', 'EMP-29', 'EMP-04', 'EMP-07'];
    let rescuer =
      (params?.account
        ? this.state.employeeById[
            resolveEmployeeByAccountCaseInsensitive(params.account)?.employeeId ?? ''
          ]
        : undefined) ??
      (params?.employeeId ? this.state.employeeById[params.employeeId] : undefined);

    if (!rescuer) {
      const idx = this.jenkinsCandidateIndex % rescueCandidates.length;
      rescuer =
        this.state.employeeById[rescueCandidates[idx]] ??
        this.state.employeeById['EMP-30'] ??
        this.state.employeeById['EMP-29'];
      this.jenkinsCandidateIndex += 1;
    }
    if (!rescuer) return null;

    // Ghi nhận bản build FAILURE (broken) vào đầu danh sách `jenkinsBuilds`
    const brokenJob: JenkinsBuildJobItem = {
      id: `JENKINS-BROKEN-${brokenNum}-${Date.now()}`,
      buildNumber: brokenNum,
      jobName: JENKINS_SERVER_STATION.jobName,
      status: 'FAILURE',
      statusText: 'broken',
      timeAgo: 'just now',
      triggeredByAccount: rescuer.account || rescuer.displayName,
      ticketKey,
      url: `${JENKINS_SERVER_STATION.rssUrl.replace('/rssAll', '')}/${brokenNum}/`,
    };

    const existingWithoutSame = this.state.jenkinsBuilds.filter(
      (b) => b.buildNumber !== brokenNum
    );
    this.state.jenkinsBuilds = [brokenJob, ...existingWithoutSame].slice(0, 6);
    this.state.isJenkinsBrokenAlert = true;
    this.state.brokenBuildNumber = brokenNum;

    // Kích hoạt chuyến đi bộ tới Server và nâng cấp thành `⚡ HOTFIX SPRINT`
    const task = this.triggerJenkinsBuild({
      employeeId: rescuer.id,
      ticketKey,
      buildNumber: rescueNum,
      statusText: 'broken -> hotfix',
    });

    if (task) {
      task.isHotfixRescue = true;
      task.brokenBuildNumber = brokenNum;
      rescuer.isHotfixSprinter = true;

      this.prependActivityLog({
        id: `LOG-JENKINS-BROKEN-${brokenNum}-${Date.now()}`,
        timestamp: formatTimeHHMMSS(),
        ticketKey,
        ticketStatus: 'IN_PROGRESS',
        fromEmployeeId: rescuer.id,
        fromEmployeeName: `${task.employeeAccount} (${task.employeeSeatCode})`,
        toEmployeeId: rescuer.id,
        toEmployeeName: '🚨 JENKINS CI BROKEN ALERT',
        isReturnToPM: false,
        message: `🚨 CẢNH BÁO BUILD BROKEN #${brokenNum} (${task.jobName})! Kỹ sư ${task.employeeAccount} bật chế độ ⚡ HOTFIX SPRINT chạy khẩn cấp ra Trạm Server cứu build #${rescueNum} [${ticketKey}]!`,
        type: 'HANDOFF',
      });

      this.addSpeechBubble(
        rescuer.id,
        `🚨 Build #${brokenNum} BROKEN! ⚡ Chạy Hotfix Sprint cứu CI #${rescueNum} ngay!`,
        'bug'
      );
      this.emitChange(true);
    }

    return task;
  };

  /**
   * Parse Atom XML từ `https://reqs.frt.vn/activity?maxResults=10&providers=issues&os_authType=basic&title=undefined`
   * và kích hoạt nhân vật di chuyển giao tài liệu tương ứng.
   * Tích hợp Tầng 2 Client-Side Idempotency Guard (`processedEventFingerprints`) mặc định (`deduplicate = true`)
   * để đảm bảo 100% không có event nào đến lần thứ 2 ngay cả khi người dùng dán lại cùng 1 đoạn XML!
   */
  public ingestJiraActivityXml = (
    xmlText: string,
    deduplicate = true
  ): number => {
    const entries = parseJiraActivityAtomXml(xmlText);
    if (entries.length === 0) return 0;

    let triggeredCount = 0;
    let droppedCount = 0;

    // Duyệt từ cũ tới mới để giữ đúng thứ tự thời gian
    const chronological = [...entries].reverse();

    for (const entry of chronological) {
      this.clientDedupStats.totalRawEntriesRead += 1;
      const fp =
        entry.fingerprint ||
        `jira:${entry.id}:${entry.ticketKey}:${entry.fromAccount}:${entry.toAccount}:${entry.toStatus}:${entry.updatedAt}`;

      if (
        deduplicate &&
        (this.processedEventFingerprints.has(fp) || this.seenLiveJiraEntryIds.has(fp))
      ) {
        droppedCount += 1;
        this.clientDedupStats.duplicatesDropped += 1;
        continue; // BỎ QUA NGAY LẬP TỨC, tuyệt đối không sinh event lần 2!
      }

      this.checkOrRecordClientFingerprint(fp);
      this.seenLiveJiraEntryIds.add(fp);
      triggeredCount += 1;
      this.clientDedupStats.uniqueEventsEmitted += 1;

      const nowIso = entry.updatedAt || new Date().toISOString();
      const webhookEvent: JiraWebhookEvent = {
        eventId: `JIRA-ACT-${entry.id}-${Date.now()}`,
        fingerprint: fp,
        eventType: entry.isReturnToPM ? 'TICKET_DONE' : 'TICKET_TRANSITIONED',
        timestamp: nowIso,
        ticket: {
          id: `ACT-${entry.ticketKey}`,
          key: entry.ticketKey,
          summary: entry.summary,
          description: entry.rawTitle,
          type: 'STORY',
          priority: 'HIGH',
          status: entry.toStatus,
          reporterId: this.state.config.pmEmployeeId,
          assigneeId: entry.toEmployeeId,
          previousAssigneeId: entry.fromEmployeeId,
          storyPoints: 5,
          documentStackSize: 4,
          workflowChain: [],
          currentStepIndex: 0,
          deliveredToPM: entry.isReturnToPM,
          createdAt: nowIso,
          updatedAt: nowIso,
          history: [],
        },
        fromEmployeeId: entry.fromEmployeeId,
        toEmployeeId: entry.toEmployeeId,
        fromStatus: null,
        toStatus: entry.toStatus,
        isReturnToPM: entry.isReturnToPM,
        summaryMessage: `[reqs.frt.vn] ${entry.authorAccount}: ${entry.rawTitle}`,
      };
      this.handleJiraWebhookEvent(webhookEvent);
    }

    this.state.liveConfig = {
      ...this.state.liveConfig,
      lastSyncAt: formatTimeHHMMSS(),
      lastSyncStatus: 'OK',
      lastSyncError: null,
      liveEventsProcessed:
        this.state.liveConfig.liveEventsProcessed + triggeredCount,
      lastJiraEntryCount: triggeredCount,
      lastDuplicatesDroppedInBatch: droppedCount,
      dedupStats: {
        ...this.clientDedupStats,
        cacheSize: this.processedEventFingerprints.size,
      },
    };
    savePersistedLiveConfig(this.state.liveConfig);
    this.emitChange(true);

    return triggeredCount;
  };

  /**
   * Parse Atom/RSS XML từ `https://jenkins-osp.frt.vn/job/oneclickv4-build-ci/rssAll`,
   * cập nhật danh sách Jobs trên Trạm Server Jenkins và cử kỹ sư ra Trạm Server chạy build.
   * Tích hợp Tầng 2 Client-Side Idempotency Guard (`processedEventFingerprints`) mặc định (`deduplicate = true`)
   * theo khóa `jenkins:${jobName}:#${buildNumber}:${statusNormalized}`!
   */
  public ingestJenkinsRssXml = (
    xmlText: string,
    deduplicate = true
  ): number => {
    const parsedJobs = parseJenkinsRssXml(xmlText);
    if (parsedJobs.length === 0) return 0;

    // Merge into state.jenkinsBuilds (static snapshot table by buildNumber)
    const byNum = new Map<number, JenkinsBuildJobItem>();
    for (const j of [...parsedJobs, ...this.state.jenkinsBuilds]) {
      if (!byNum.has(j.buildNumber)) {
        byNum.set(j.buildNumber, j);
      }
    }
    const merged = Array.from(byNum.values())
      .sort((a, b) => b.buildNumber - a.buildNumber)
      .slice(0, 6);
    this.state.jenkinsBuilds = merged;

    let triggeredCount = 0;
    let droppedCount = 0;

    const newest = parsedJobs[0];
    const newestFp =
      newest.fingerprint ||
      computeJenkinsBuildFingerprint(
        newest.jobName,
        newest.buildNumber,
        newest.status
      );

    // Đếm tổng số entries đọc từ RSS và lưu các bản build lịch sử vào cache chống trùng
    for (const job of parsedJobs) {
      this.clientDedupStats.totalRawEntriesRead += 1;
      const jobFp =
        job.fingerprint ||
        computeJenkinsBuildFingerprint(job.jobName, job.buildNumber, job.status);
      if (job.buildNumber !== newest.buildNumber) {
        if (this.processedEventFingerprints.has(jobFp)) {
          droppedCount += 1;
          this.clientDedupStats.duplicatesDropped += 1;
        } else {
          this.checkOrRecordClientFingerprint(jobFp);
          this.seenLiveJenkinsBuildIds.add(jobFp);
        }
      }
    }

    const isAlreadySeen =
      deduplicate &&
      (this.processedEventFingerprints.has(newestFp) ||
        this.seenLiveJenkinsBuildIds.has(newestFp));

    if (isAlreadySeen) {
      droppedCount += 1;
      this.clientDedupStats.duplicatesDropped += 1;
    } else {
      this.checkOrRecordClientFingerprint(newestFp);
      this.seenLiveJenkinsBuildIds.add(newestFp);
      triggeredCount = 1;
      this.clientDedupStats.uniqueEventsEmitted += 1;

      if (newest.buildNumber >= this.nextJenkinsBuildNumber) {
        this.nextJenkinsBuildNumber = newest.buildNumber + 1;
      }

      const lowerStatus = (newest.statusText || '').toLowerCase();
      if (
        newest.status === 'FAILURE' ||
        lowerStatus.includes('broken') ||
        lowerStatus.includes('regression') ||
        lowerStatus.includes('aborted')
      ) {
        this.triggerJenkinsBrokenHotfix({
          account: newest.triggeredByAccount,
          ticketKey: newest.ticketKey,
          brokenBuildNumber: newest.buildNumber,
        });
      } else {
        this.triggerJenkinsBuild({
          account: newest.triggeredByAccount,
          ticketKey: newest.ticketKey,
          buildNumber: newest.buildNumber,
          statusText: newest.statusText,
        });
      }
    }

    this.state.liveConfig = {
      ...this.state.liveConfig,
      lastSyncAt: formatTimeHHMMSS(),
      lastSyncStatus: 'OK',
      lastSyncError: null,
      liveEventsProcessed:
        this.state.liveConfig.liveEventsProcessed + triggeredCount,
      lastJenkinsBuildCount: triggeredCount,
      lastDuplicatesDroppedInBatch: droppedCount,
      dedupStats: {
        ...this.clientDedupStats,
        cacheSize: this.processedEventFingerprints.size,
      },
    };
    savePersistedLiveConfig(this.state.liveConfig);

    this.emitChange(true);
    return triggeredCount;
  };

  /**
   * Reset toàn bộ RAM Cache Deduplicator (Cả Tầng 2 Client-Side `processedEventFingerprints`
   * lẫn Tầng 1 Server `POST /api/admin/reset-cache` nếu đang chạy trên localhost).
   */
  public resetDedupCache = async (): Promise<void> => {
    this.processedEventFingerprints.clear();
    this.seenLiveJiraEntryIds.clear();
    this.seenLiveJenkinsBuildIds.clear();
    this.lastServerSeq = 0;
    this.clientDedupStats = {
      totalPolls: 0,
      totalRawEntriesRead: 0,
      uniqueEventsEmitted: 0,
      duplicatesDropped: 0,
      cacheSize: 0,
      maxCacheSize: 2000,
    };

    try {
      await fetch('/api/admin/reset-cache', { method: 'POST' });
    } catch {
      // Ignore if running standalone without backend proxy
    }

    this.state.liveConfig = {
      ...this.state.liveConfig,
      lastServerSeq: 0,
      lastDuplicatesDroppedInBatch: 0,
      dedupStats: { ...this.clientDedupStats },
    };
    savePersistedLiveConfig(this.state.liveConfig);
    this.emitChange(true);
  };

  /**
   * Đồng bộ sự kiện qua cơ chế **2-Layer Exactly-Once Deduplication**:
   * - Tầng 1: Ưu tiên gọi API duy nhất của Backend Proxy `GET /api/public/office-stream?afterSeq=${this.lastServerSeq}`
   *   (lọc trùng trên RAM Server + chỉ trả về các sự kiện có `seq > afterSeq`).
   * - Tầng 2: Kiểm tra `processedEventFingerprints.has(event.fingerprint)` tại Client Store trước khi
   *   cho nhân vật đi bộ giao tài liệu hoặc ra Server Jenkins chạy build!
   * - Ngay cả khi người dùng bấm "Đồng bộ ngay" liên tục 10 lần, hệ thống sẽ báo:
   *   `"0 sự kiện mới (Đã lọc bỏ X sự kiện trùng lặp trong RAM Cache)"` và ĐẢM BẢO 100% KHÔNG CÓ EVENT NÀO ĐẾN LẦN 2!
   */
  public fetchLiveFrtFeeds = async (
    basicAuthHeader?: string
  ): Promise<{
    jiraCount: number;
    jenkinsCount: number;
    duplicatesDropped?: number;
    latestSeq?: number;
    source: 'live-proxy' | 'sample-fallback' | 'live-error';
    message: string;
    jiraError?: string | null;
    jenkinsError?: string | null;
    httpStatus?: number | null;
  }> => {
    const cfg = this.state.liveConfig;
    const isLiveMode = this.state.dataSourceMode === 'LIVE_FRT';

    this.state.liveConfig = {
      ...cfg,
      lastSyncStatus: 'SYNCING',
      lastSyncError: null,
    };
    this.emitChange(true);

    this.clientDedupStats.totalPolls += 1;

    // ========================================================================
    // BƯỚC 1: ƯU TIÊN GỌI BACKEND PROXY `/api/public/office-stream?afterSeq=`
    // ========================================================================
    try {
      const streamRes = await fetch(
        `${PUBLIC_OFFICE_STREAM_API_URL}?afterSeq=${this.lastServerSeq}`,
        {
          headers: { Accept: 'application/json' },
        }
      );

      if (
        streamRes.ok &&
        (streamRes.headers.get('content-type') || '').includes('application/json')
      ) {
        const streamData = (await streamRes.json()) as PublicOfficeStreamResponse;
        if (streamData && streamData.ok) {
          const prevSeq = this.lastServerSeq;
          this.lastServerSeq = Math.max(this.lastServerSeq, streamData.latestSeq ?? 0);

          // Cập nhật bảng lịch sử 5 bản build Jenkins tĩnh mà không làm nhân vật chạy lại
          if (
            Array.isArray(streamData.jenkinsSnapshot) &&
            streamData.jenkinsSnapshot.length > 0
          ) {
            const byNum = new Map<number, JenkinsBuildJobItem>();
            for (const j of [
              ...streamData.jenkinsSnapshot,
              ...this.state.jenkinsBuilds,
            ]) {
              if (!byNum.has(j.buildNumber)) {
                byNum.set(j.buildNumber, j);
              }
              // Đánh dấu luôn fingerprint của snapshot vào Client Idempotency Guard
              if (j.fingerprint) {
                this.seenLiveJenkinsBuildIds.add(j.fingerprint);
              }
            }
            this.state.jenkinsBuilds = Array.from(byNum.values())
              .sort((a, b) => b.buildNumber - a.buildNumber)
              .slice(0, 6);
          }

          let emittedJiraCount = 0;
          let emittedJenkinsCount = 0;
          let clientIdempotencyDropped = 0;

          const incomingEvents = Array.isArray(streamData.events)
            ? streamData.events
            : [];

          for (const ev of incomingEvents) {
            // TẦNG 2: Client-Side Idempotency Guard (`processedEventFingerprints`)
            if (this.checkOrRecordClientFingerprint(ev.fingerprint)) {
              clientIdempotencyDropped += 1;
              continue; // BỎ QUA NGAY LẬP TỨC NẾU ĐÃ XỬ LÝ!
            }

            if (ev.kind === 'JIRA_ACTIVITY') {
              this.seenLiveJiraEntryIds.add(ev.fingerprint);
              emittedJiraCount += 1;
              const nowIso = ev.updatedAt || ev.emittedAt || new Date().toISOString();
              const toStatus: TicketStatus = ev.toStatus || 'IN_PROGRESS';
              const isReturnToPM = Boolean(ev.isReturnToPM || toStatus === 'DONE');
              const fromEmpId = ev.fromEmployeeId || 'EMP-04';
              const toEmpId = isReturnToPM
                ? PROJECT_MANAGER.id
                : ev.toEmployeeId || PROJECT_MANAGER.id;

              const webhookEvent: JiraWebhookEvent = {
                eventId: `STREAM-JIRA-${ev.seq}-${Date.now()}`,
                fingerprint: ev.fingerprint,
                seq: ev.seq,
                eventType: isReturnToPM ? 'TICKET_DONE' : 'TICKET_TRANSITIONED',
                timestamp: nowIso,
                ticket: {
                  id: `ACT-${ev.ticketKey}`,
                  key: ev.ticketKey,
                  summary: ev.summary || `Cập nhật Jira ${ev.ticketKey}`,
                  description: ev.rawTitle || ev.summary || '',
                  type: 'STORY',
                  priority: 'HIGH',
                  status: toStatus,
                  reporterId: this.state.config.pmEmployeeId,
                  assigneeId: toEmpId,
                  previousAssigneeId: fromEmpId,
                  storyPoints: 5,
                  documentStackSize: 4,
                  workflowChain: [],
                  currentStepIndex: 0,
                  deliveredToPM: isReturnToPM,
                  createdAt: nowIso,
                  updatedAt: nowIso,
                  history: [],
                },
                fromEmployeeId: fromEmpId,
                toEmployeeId: toEmpId,
                fromStatus: null,
                toStatus,
                isReturnToPM,
                summaryMessage: `[reqs.frt.vn #${ev.seq}] ${
                  ev.authorAccount || ev.fromAccount || 'FRT'
                }: ${ev.rawTitle || ev.summary}`,
              };
              this.handleJiraWebhookEvent(webhookEvent);
            } else if (ev.kind === 'JENKINS_BUILD') {
              this.seenLiveJenkinsBuildIds.add(ev.fingerprint);
              emittedJenkinsCount += 1;
              const buildNum = ev.buildNumber ?? this.nextJenkinsBuildNumber++;
              const lowerStatus = (ev.statusText || ev.status || '').toLowerCase();
              if (
                ev.status === 'FAILURE' ||
                lowerStatus.includes('broken') ||
                lowerStatus.includes('fail')
              ) {
                this.triggerJenkinsBrokenHotfix({
                  account: ev.triggeredByAccount,
                  ticketKey: ev.ticketKey,
                  brokenBuildNumber: buildNum,
                });
              } else {
                this.triggerJenkinsBuild({
                  account: ev.triggeredByAccount,
                  ticketKey: ev.ticketKey,
                  buildNumber: buildNum,
                  statusText: ev.statusText || ev.status,
                });
              }
            }
          }

          const serverStats = streamData.dedupStats;
          const totalDropped =
            (serverStats?.duplicatesDropped ?? 0) + clientIdempotencyDropped;
          const batchDropped =
            (streamData.pollSummary?.droppedInPoll ?? 0) + clientIdempotencyDropped;

          this.clientDedupStats = {
            totalPolls: serverStats?.totalPolls ?? this.clientDedupStats.totalPolls,
            totalRawEntriesRead:
              serverStats?.totalRawEntriesRead ??
              this.clientDedupStats.totalRawEntriesRead,
            uniqueEventsEmitted:
              serverStats?.uniqueEventsEmitted ??
              this.clientDedupStats.uniqueEventsEmitted,
            duplicatesDropped: totalDropped,
            jiraEntriesRead: serverStats?.jiraEntriesRead,
            jenkinsEntriesRead: serverStats?.jenkinsEntriesRead,
            cacheSize: Math.max(
              serverStats?.cacheSize ?? 0,
              this.processedEventFingerprints.size
            ),
            maxCacheSize: serverStats?.maxCacheSize ?? 2000,
            ringBufferSize: serverStats?.ringBufferSize ?? 0,
            lastPollAt: serverStats?.lastPollAt ?? new Date().toISOString(),
            lastPollSource: serverStats?.lastPollSource ?? 'office-stream',
          };

          const totalNewEmitted = emittedJiraCount + emittedJenkinsCount;
          this.state.liveConfig = {
            ...this.state.liveConfig,
            lastSyncAt: formatTimeHHMMSS(),
            lastSyncStatus: 'OK',
            lastSyncError: null,
            liveEventsProcessed:
              this.state.liveConfig.liveEventsProcessed + totalNewEmitted,
            lastJiraEntryCount: emittedJiraCount,
            lastJenkinsBuildCount: emittedJenkinsCount,
            lastServerSeq: this.lastServerSeq,
            lastDuplicatesDroppedInBatch: batchDropped,
            dedupStats: { ...this.clientDedupStats },
          };
          savePersistedLiveConfig(this.state.liveConfig);
          this.emitChange(true);

          const feedbackMessage =
            totalNewEmitted > 0
              ? `🟢 Đồng bộ ${totalNewEmitted} sự kiện mới (${emittedJiraCount} Jira + ${emittedJenkinsCount} Jenkins • Cursor afterSeq: ${prevSeq} ➔ ${this.lastServerSeq}, Đã chặn trùng: ${totalDropped})`
              : `🛡️ 0 sự kiện mới (Đã lọc bỏ ${
                  batchDropped > 0 ? batchDropped : totalDropped
                } sự kiện trùng lặp trong RAM Cache • Cursor afterSeq=${this.lastServerSeq})`;

          return {
            jiraCount: emittedJiraCount,
            jenkinsCount: emittedJenkinsCount,
            duplicatesDropped: totalDropped,
            latestSeq: this.lastServerSeq,
            source: 'live-proxy',
            message: feedbackMessage,
            jiraError: null,
            jenkinsError: null,
            httpStatus: 200,
          };
        }
      }
    } catch {
      // Nếu chưa bật `node server/proxyServer.mjs`, chuyển tiếp xuống cơ chế gọi Vite Proxy + Tầng 2 Client Dedup
    }

    // ========================================================================
    // BƯỚC 2: FALLBACK GỌI TRỰC TIẾP VITE PROXY + CLIENT RAM CACHE DEDUP
    // ========================================================================
    const headers: Record<string, string> = {
      Accept:
        'application/atom+xml, application/rss+xml, application/xml, text/xml, */*',
    };

    let resolvedAuth = '';
    if (basicAuthHeader && basicAuthHeader.trim().length > 0) {
      const trimmed = basicAuthHeader.trim();
      resolvedAuth =
        trimmed.startsWith('Basic ') || trimmed.startsWith('Bearer ')
          ? trimmed
          : `Basic ${trimmed}`;
    } else if (
      cfg.authType === 'BASIC' &&
      (cfg.username.trim().length > 0 || cfg.passwordOrToken.trim().length > 0)
    ) {
      resolvedAuth = `Basic ${encodeBasicAuthBase64(
        cfg.username.trim(),
        cfg.passwordOrToken
      )}`;
    } else if (cfg.authType === 'BEARER' && cfg.passwordOrToken.trim().length > 0) {
      resolvedAuth = `Bearer ${cfg.passwordOrToken.trim()}`;
    } else if (cfg.authType === 'COOKIE' && cfg.passwordOrToken.trim().length > 0) {
      headers['X-FRT-Cookie'] = cfg.passwordOrToken.trim();
    }

    if (resolvedAuth) {
      headers.Authorization = resolvedAuth;
      headers['X-FRT-Authorization'] = resolvedAuth;
    }

    let jiraProxyUrl = FRT_JIRA_ACTIVITY_PROXY_URL;
    if (cfg.jiraUrl && cfg.jiraUrl.trim().length > 0) {
      const rawJira = cfg.jiraUrl.trim();
      if (rawJira.startsWith('/api/')) {
        jiraProxyUrl = rawJira;
      } else {
        const qIndex = rawJira.indexOf('?');
        const queryPart =
          qIndex >= 0
            ? rawJira.slice(qIndex)
            : '?maxResults=10&providers=issues&os_authType=basic&title=undefined';
        jiraProxyUrl = `/api/frt-jira-activity${queryPart}`;
      }
    }

    let jenkinsProxyUrl = FRT_JENKINS_RSS_PROXY_URL;
    if (cfg.jenkinsUrl && cfg.jenkinsUrl.trim().length > 0) {
      const rawJenkins = cfg.jenkinsUrl.trim();
      if (rawJenkins.startsWith('/api/')) {
        jenkinsProxyUrl = rawJenkins;
      } else {
        jenkinsProxyUrl = FRT_JENKINS_RSS_PROXY_URL;
      }
    }

    let jiraXml = '';
    let jenkinsXml = '';
    let jiraOk = false;
    let jenkinsOk = false;
    let jiraError: string | null = null;
    let jenkinsError: string | null = null;
    let httpStatus: number | null = null;

    try {
      const [jiraResp, jenkinsResp] = await Promise.allSettled([
        fetch(jiraProxyUrl, { headers }),
        fetch(jenkinsProxyUrl, { headers }),
      ]);

      if (jiraResp.status === 'fulfilled') {
        httpStatus = jiraResp.value.status;
        if (jiraResp.value.ok) {
          const text = await jiraResp.value.text();
          if (
            text.includes('<entry') ||
            text.includes('<feed') ||
            text.includes('<item')
          ) {
            jiraXml = text;
            jiraOk = true;
          } else {
            jiraError = `reqs.frt.vn trả về trang đăng nhập HTML (HTTP ${jiraResp.value.status}) thay vì Atom XML. Hãy cấu hình Credential tại http://127.0.0.1:8787/admin hoặc nhập Basic Auth!`;
          }
        } else if (
          jiraResp.value.status === 401 ||
          jiraResp.value.status === 403
        ) {
          jiraError = `HTTP ${jiraResp.value.status} (${
            jiraResp.value.statusText || 'Unauthorized'
          }) từ reqs.frt.vn — Yêu cầu xác thực Basic Auth!`;
        } else {
          jiraError = `HTTP ${jiraResp.value.status} khi gọi /api/frt-jira-activity (reqs.frt.vn).`;
        }
      } else {
        jiraError = `Không thể kết nối tới /api/frt-jira-activity (reqs.frt.vn).`;
      }

      if (jenkinsResp.status === 'fulfilled') {
        if (!httpStatus) {
          httpStatus = jenkinsResp.value.status;
        }
        if (jenkinsResp.value.ok) {
          const text = await jenkinsResp.value.text();
          if (
            text.includes('<entry') ||
            text.includes('<feed') ||
            text.includes('<item') ||
            text.includes('<rss')
          ) {
            jenkinsXml = text;
            jenkinsOk = true;
          } else {
            jenkinsError = `jenkins-osp.frt.vn trả về HTML thay vì RSS/Atom XML.`;
          }
        } else {
          jenkinsError = `HTTP ${jenkinsResp.value.status} từ jenkins-osp.frt.vn/job/oneclickv4-build-ci/rssAll`;
        }
      } else {
        jenkinsError = `Không kết nối được /api/frt-jenkins-rss (jenkins-osp.frt.vn).`;
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      jiraError = `Lỗi ngoại lệ khi gọi Proxy FRT: ${msg}`;
    }

    const usedLive = jiraOk || jenkinsOk;
    const prevDropped = this.clientDedupStats.duplicatesDropped;

    if (isLiveMode) {
      const jiraCount = jiraOk && jiraXml ? this.ingestJiraActivityXml(jiraXml, true) : 0;
      const jenkinsCount =
        jenkinsOk && jenkinsXml ? this.ingestJenkinsRssXml(jenkinsXml, true) : 0;
      const droppedNow = this.clientDedupStats.duplicatesDropped - prevDropped;

      const combinedError =
        !jiraOk || !jenkinsOk
          ? [jiraError, jenkinsError].filter(Boolean).join(' • ')
          : null;

      this.state.liveConfig = {
        ...this.state.liveConfig,
        lastSyncAt: formatTimeHHMMSS(),
        lastSyncStatus: usedLive ? 'OK' : 'ERROR',
        lastSyncError: combinedError,
        lastJiraEntryCount: jiraCount,
        lastJenkinsBuildCount: jenkinsCount,
        lastDuplicatesDroppedInBatch: droppedNow,
        dedupStats: {
          ...this.clientDedupStats,
          cacheSize: this.processedEventFingerprints.size,
        },
      };
      savePersistedLiveConfig(this.state.liveConfig);
      this.emitChange(true);

      if (usedLive) {
        const totalNew = jiraCount + jenkinsCount;
        return {
          jiraCount,
          jenkinsCount,
          duplicatesDropped: this.clientDedupStats.duplicatesDropped,
          latestSeq: this.lastServerSeq,
          source: 'live-proxy',
          message:
            totalNew > 0
              ? `🟢 Đồng bộ DỮ LIỆU THẬT: Phát ${jiraCount} sự kiện Jira mới & ${jenkinsCount} Jenkins build mới (Đã lọc bỏ ${droppedNow} sự kiện trùng lặp trong RAM Cache)!`
              : `🛡️ 0 sự kiện mới (Đã lọc bỏ ${droppedNow} sự kiện trùng lặp trong RAM Cache)`,
          jiraError,
          jenkinsError,
          httpStatus,
        };
      }

      return {
        jiraCount: 0,
        jenkinsCount: 0,
        duplicatesDropped: this.clientDedupStats.duplicatesDropped,
        latestSeq: this.lastServerSeq,
        source: 'live-error',
        message:
          combinedError ||
          'Không đọc được XML thật từ reqs.frt.vn & jenkins-osp.frt.vn. Hãy chạy `npm run server` và cài Credential tại http://127.0.0.1:8787/admin!',
        jiraError,
        jenkinsError,
        httpStatus,
      };
    }

    // CHẾ ĐỘ MOCK_PILOT: Cho phép fallback mẫu nếu chưa có VPN nhưng VẪN BẬT `deduplicate = true`
    // để đảm bảo bấm "Đồng bộ ngay" 10 lần liên tiếp không bao giờ phát lặp lại cùng 1 sự kiện!
    if (!jiraXml) {
      jiraXml = SAMPLE_FRT_JIRA_ACTIVITY_XML;
    }
    if (!jenkinsXml) {
      jenkinsXml = SAMPLE_FRT_JENKINS_RSS_XML;
    }

    const jiraCount = this.ingestJiraActivityXml(jiraXml, true);
    const jenkinsCount = this.ingestJenkinsRssXml(jenkinsXml, true);
    const droppedNow = this.clientDedupStats.duplicatesDropped - prevDropped;
    const totalNew = jiraCount + jenkinsCount;

    this.state.liveConfig = {
      ...this.state.liveConfig,
      lastSyncAt: formatTimeHHMMSS(),
      lastSyncStatus: 'OK',
      lastSyncError: null,
      lastJiraEntryCount: jiraCount,
      lastJenkinsBuildCount: jenkinsCount,
      lastDuplicatesDroppedInBatch: droppedNow,
      dedupStats: {
        ...this.clientDedupStats,
        cacheSize: this.processedEventFingerprints.size,
      },
    };
    savePersistedLiveConfig(this.state.liveConfig);
    this.emitChange(true);

    return {
      jiraCount,
      jenkinsCount,
      duplicatesDropped: this.clientDedupStats.duplicatesDropped,
      latestSeq: this.lastServerSeq,
      source: usedLive ? 'live-proxy' : 'sample-fallback',
      message:
        totalNew > 0
          ? `✅ Đã phát ${totalNew} sự kiện mới (${jiraCount} Jira Activity + ${jenkinsCount} Jenkins Build • Đã lọc bỏ ${droppedNow} bản ghi trùng lặp)!`
          : `🛡️ 0 sự kiện mới (Đã lọc bỏ ${droppedNow} sự kiện trùng lặp trong RAM Cache)`,
      jiraError,
      jenkinsError,
      httpStatus,
    };
  };

  /**
   * Trigger '🔥 Sprint Rush' mode:
   * - Boosts walking and processing speed
   * - Rapidly fires a wave of document transfers across all squads (BE, FE, Mobile, QA, PM)
   */
  public triggerSprintRush = async (durationMs = 25_000): Promise<void> => {
    const now = Date.now();
    this.state.isSprintRush = true;
    this.state.sprintRushEndsAt = now + durationMs;
    this.state.config = {
      ...this.state.config,
      isRunning: true,
      autoSimulate: this.state.dataSourceMode === 'MOCK_PILOT',
    };

    this.prependActivityLog({
      id: `LOG-RUSH-${now}`,
      timestamp: formatTimeHHMMSS(),
      ticketKey: 'SPRINT-RUSH',
      ticketStatus: 'IN_PROGRESS',
      fromEmployeeId: PROJECT_MANAGER.id,
      fromEmployeeName: PROJECT_MANAGER.displayName,
      toEmployeeId: PROJECT_MANAGER.id,
      toEmployeeName: 'Toàn bộ 30 Nhân sự FRT',
      isReturnToPM: false,
      message:
        '🔥 KÍCH HOẠT SPRINT RUSH! Toàn bộ 30 thành viên tăng tốc bàn giao tài liệu & chốt sổ Sprint về bàn PM!',
      type: 'CREATED',
    });

    this.addSpeechBubble(
      PROJECT_MANAGER.id,
      '🔥 SPRINT DEADLINE RUSH! Tăng tốc hoàn thành & bàn giao hồ sơ về bàn PM nhé anh em!',
      'done'
    );

    if (this.state.dataSourceMode === 'MOCK_PILOT') {
      if (!this.state.activeJenkinsBuild) {
        this.triggerJenkinsBuild({
          employeeId: 'EMP-29',
          ticketKey: 'FRT-104',
        });
      }

      // Advance up to 4 existing tickets immediately + create 2 new tickets across different squads
      const nonDoneTickets = this.state.tickets.filter((t) => t.status !== 'DONE');
      const toAdvance = nonDoneTickets.slice(0, 4);
      for (const t of toAdvance) {
        await this.advanceTicket(t.id);
      }

      await this.createRandomTicket('FRONTEND');
      await this.createRandomTicket('MOBILE');
    }

    this.emitChange(true);
  };

  public stopSprintRush = (): void => {
    this.state.isSprintRush = false;
    this.state.sprintRushEndsAt = null;
    this.emitChange(true);
  };

  public toggleSprintRush = async (): Promise<void> => {
    if (this.state.isSprintRush) {
      this.stopSprintRush();
    } else {
      await this.triggerSprintRush();
    }
  };

  public selectEmployee = (employeeId: string | null): void => {
    this.state.selectedEmployeeId = employeeId;
    if (employeeId) {
      const emp = this.state.employeeById[employeeId];
      if (emp) {
        this.state.selectedDeskId = emp.deskId;
      }
    }
    this.emitChange(true);
  };

  public selectTicket = (ticketId: string | null): void => {
    this.state.selectedTicketId = ticketId;
    this.emitChange(true);
  };

  public selectDesk = (deskId: string | null): void => {
    this.state.selectedDeskId = deskId;
    if (deskId) {
      const desk = DESK_BY_ID[deskId];
      if (desk) {
        this.state.selectedEmployeeId = desk.assignedEmployeeId;
      }
    } else {
      this.state.selectedEmployeeId = null;
    }
    this.emitChange(true);
  };

  public setJiraAdapter = async (adapter: IJiraAdapter): Promise<void> => {
    this.bindAdapter(adapter);
    const initial = await adapter.getInitialTickets();
    if (initial.length > 0) {
      this.state.tickets = initial;
    }
    this.emitChange(true);
  };

  public resetSimulation = (): void => {
    if (this.state.dataSourceMode === 'LIVE_FRT') {
      this.clearMockDataInternal(true);
      return;
    }

    this.phaseElapsedMs.clear();
    this.autoStepAccumulatorMs = 0;
    this.jenkinsAutoBuildAccumulatorMs = 0;
    this.managerPatrolIndex = 0;
    this.managerCheerElapsedMs = 0;

    const resetTickets =
      this.adapter instanceof MockJiraAdapter
        ? this.adapter.reset()
        : this.state.tickets;
    const resetEmployees = cloneInitialEmployees(resetTickets);

    this.state = {
      ...this.state,
      employees: resetEmployees,
      employeeById: Object.fromEntries(resetEmployees.map((e) => [e.id, e])),
      tickets: resetTickets,
      activeTransfers: [],
      queuedTransfers: [],
      activeJenkinsBuild: null,
      jenkinsBuilds: [...DEFAULT_JENKINS_RECENT_BUILDS],
      jenkinsLastCompletedAt: null,
      isJenkinsBrokenAlert: false,
      brokenBuildNumber: null,
      jenkinsHotfixCelebrationAt: null,
      speechBubbles: [],
      pmCelebrations: [],
      isSprintRush: false,
      sprintRushEndsAt: null,
      selectedEmployeeId: null,
      selectedTicketId: null,
      selectedDeskId: null,
      stats: computeStats(resetEmployees, resetTickets, [], []),
    };

    this.emitChange(true);
  };
}

// ============================================================================
// 4. SINGLETON ENGINE INSTANCE & REACT HOOKS / PROVIDER
// ============================================================================

export const officeSimulationEngine = new OfficeSimulationEngine(mockJiraAdapter);

const OfficeSimulationContext = createContext<OfficeSimulationEngine>(
  officeSimulationEngine
);

export const OfficeSimulationProvider: React.FC<{
  children: React.ReactNode;
  engine?: OfficeSimulationEngine;
}> = ({ children, engine = officeSimulationEngine }) => {
  return React.createElement(
    OfficeSimulationContext.Provider,
    { value: engine },
    children
  );
};

/**
 * Primary React Hook (`useOfficeSimulation` / `useSimulationStore`)
 * Works both inside `<OfficeSimulationProvider>` and standalone without a provider!
 */
export function useOfficeSimulation(): OfficeSimulationStoreValue {
  const engine = useContext(OfficeSimulationContext) ?? officeSimulationEngine;
  const snapshot = useSyncExternalStore(
    engine.subscribe,
    engine.getSnapshot,
    engine.getSnapshot
  );

  return {
    ...snapshot,
    tick: engine.tick,
    toggleRunning: engine.toggleRunning,
    setRunning: engine.setRunning,
    setSpeedMultiplier: engine.setSpeedMultiplier,
    toggleAutoSimulate: engine.toggleAutoSimulate,
    setAutoSimulate: engine.setAutoSimulate,
    setDataSourceMode: engine.setDataSourceMode,
    updateLiveConfig: engine.updateLiveConfig,
    clearMockData: engine.clearMockData,
    triggerSprintRush: engine.triggerSprintRush,
    stopSprintRush: engine.stopSprintRush,
    toggleSprintRush: engine.toggleSprintRush,
    updateConfig: engine.updateConfig,
    createTicket: engine.createTicket,
    createRandomTicket: engine.createRandomTicket,
    transitionTicket: engine.transitionTicket,
    advanceTicket: engine.advanceTicket,
    rejectTicketWithBug: engine.rejectTicketWithBug,
    completeTicketToPM: engine.completeTicketToPM,
    manualTransfer: engine.manualTransfer,
    dispatchManualTransfer: engine.dispatchManualTransfer,
    triggerJenkinsBuild: engine.triggerJenkinsBuild,
    triggerJenkinsBrokenHotfix: engine.triggerJenkinsBrokenHotfix,
    ingestJiraActivityXml: engine.ingestJiraActivityXml,
    ingestJenkinsRssXml: engine.ingestJenkinsRssXml,
    fetchLiveFrtFeeds: engine.fetchLiveFrtFeeds,
    resetDedupCache: engine.resetDedupCache,
    clearActivityLogs: engine.clearActivityLogs,
    selectEmployee: engine.selectEmployee,
    selectTicket: engine.selectTicket,
    selectDesk: engine.selectDesk,
    setJiraAdapter: engine.setJiraAdapter,
    resetSimulation: engine.resetSimulation,
    getMutableState: engine.getMutableState,
  };
}

/** Alias hook for convenience */
export const useSimulationStore = useOfficeSimulation;
