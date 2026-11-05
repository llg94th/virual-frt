import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import {
  ActiveJenkinsBuildTask,
  DeskPosition,
  DocumentTransferTask,
  Employee,
  IslandHeatmapStat,
  JenkinsBuildJobItem,
  JiraTicket,
  MvpLeaderboardEntry,
  NhaThuocSeatSlot,
  OfficeZone,
  Point2D,
  Role,
  SimulationConfig,
  TicketPriority,
  TicketStatus,
  Waypoint,
} from '../types/office';
import {
  BOSS_ROTATION_IDS,
  EMPLOYEES,
  EMPLOYEE_BY_ID,
  FEMALE_MANAGER_ID,
  MANAGER_DOANNT19_ID,
  MANAGER_TOANLBK_ID,
  MANAGER_VANLTB8_ID,
  ROLE_METADATA,
} from '../data/employees';
import {
  ALL_JOINED_DESK_ISLANDS,
  ALL_OFFICE_SEAT_SLOTS,
  DEFAULT_SIMULATION_CONFIG,
  DESK_BY_EMPLOYEE_ID,
  DESK_BY_ID,
  DESK_POSITIONS,
  JENKINS_SERVER_CLUSTERS,
  JENKINS_SERVER_STATION,
  JENKINS_UAT_SERVER_STATION,
  JenkinsServerStationMeta,
  NHA_THUOC_BAY_BOUNDS,
  NHA_THUOC_ISLANDS,
  NHA_THUOC_SEAT_SLOTS,
  NhaThuocIslandMeta,
  OFFICE_CANVAS_HEIGHT,
  OFFICE_CANVAS_WIDTH,
  OFFICE_WAYPOINTS,
  OFFICE_ZONES,
  PM_DESK,
  computeCorridorPathBetweenDesks,
} from '../data/officeLayout';
import { DEFAULT_JENKINS_RECENT_BUILDS } from '../adapters/RealJiraWebhookAdapter';
import {
  CAMPUS_STREET_PROPS,
  CAMPUS_TREES,
  EVENT_FOCUS_ZOOM,
  FLEZI_ISO_ZONES,
  ISO_ORIGIN_X,
  ISO_ORIGIN_Y,
  IsoDirection,
  MANAGER_FOCUS_ZOOM,
  OVERVIEW_ZOOM,
  PRIORITY_COLORS,
  classifyIsoDirection,
  directionToIso,
  drawCampusRoadNetwork,
  drawCampusStreetProp,
  drawCutawayIsoZone,
  drawDetailedIsoCharacter,
  drawDetailedIsoDesk,
  drawFlezimercuriaZoneCallouts,
  drawIsoBox,
  drawIsoLowPolyTree,
  drawJenkinsServerHologramOverlay,
  drawJenkinsServerStation3D,
  drawJoinedDeskIsland,
  drawNhaThuocExtraSlot3D,
  drawNhaThuocSeatedColleague3D,
  drawNonOverlappingWinaEventPills,
  drawRoundedRect,
  drawVectorHeart,
  isoToWorld,
  ScreenLabelRect,
  WinaEventPillItem,
  worldToIso,
  worldVecToIsoVec,
} from './isometricRenderer';

const EXTRA_NHA_THUOC_SLOTS: NhaThuocSeatSlot[] = ALL_OFFICE_SEAT_SLOTS.filter(
  (s) => !s.deskId
);
const OCCUPIED_EXTRA_NHA_THUOC_SLOTS: NhaThuocSeatSlot[] = EXTRA_NHA_THUOC_SLOTS.filter(
  (s) => s.kind === 'OCCUPIED'
);
const ISLAND_BY_ID: Record<string, NhaThuocIslandMeta> = Object.fromEntries(
  ALL_JOINED_DESK_ISLANDS.map((isl) => [isl.id, isl])
);
const ISLAND_DESK_ID_SET = new Set<string>(
  ALL_OFFICE_SEAT_SLOTS.flatMap((slot) => (slot.deskId ? [slot.deskId] : []))
);
const BOSS_ID_SET = new Set<string>(BOSS_ROTATION_IDS as readonly string[]);

export interface OfficeCanvas2DProps {
  /** Danh sách 30 nhân viên (runtime state) */
  employees?: Employee[];
  /** Danh sách 30 bàn làm việc */
  desks?: DeskPosition[];
  /** Danh sách các phân khu (Zones) */
  zones?: OfficeZone[];
  /** Danh sách các nút giao thông hành lang (Waypoints) */
  waypoints?: Waypoint[];
  /** Danh sách Jira Tickets hiện có */
  tickets?: JiraTicket[];
  /** Danh sách các tác vụ bê chồng tài liệu đang diễn ra */
  activeTransfers?: DocumentTransferTask[];
  /** Alias tương thích cho activeTransfers */
  transfers?: DocumentTransferTask[];
  /** Tác vụ kỹ sư đang đi bộ lại Trạm Máy Tính Server chạy Build Jenkins (`oneclickv4-build-ci`) */
  activeJenkinsBuild?: ActiveJenkinsBuildTask | null;
  /** Danh sách các Jobs gần nhất từ `https://jenkins-osp.frt.vn/job/oneclickv4-build-ci/rssAll` */
  jenkinsBuilds?: JenkinsBuildJobItem[];
  /** Thời điểm vừa hoàn tất bản build Jenkins gần nhất */
  jenkinsLastCompletedAt?: number | null;
  /** Cờ cảnh báo đỏ khi Jenkins Build bị FAILURE / broken */
  isJenkinsBrokenAlert?: boolean;
  /** Số hiệu bản build Jenkins đang bị broken (VD: #2843) */
  brokenBuildNumber?: number | null;
  /** Thời điểm hoàn tất Hotfix cứu bản build Jenkins để nổ pháo hoa xanh lá ăn mừng */
  jenkinsHotfixCelebrationAt?: number | null;
  /** Callback kích hoạt kỹ sư đi bộ lại Trạm Server chạy Build Jenkins (`oneclickv4-build-ci`) */
  onTriggerJenkinsBuild?: () => void;
  /** Callback kích hoạt kỹ sư đi bộ lại Trạm Server UAT chạy Build Jenkins (`oneclickv4-build-uat`) */
  onTriggerUatBuild?: () => void;
  /** Callback giả lập sự kiện Jenkins Build Broken & Hotfix Rescue (`⚡ HOTFIX SPRINT`) */
  onTriggerJenkinsBrokenHotfix?: () => void;
  /** Callback Reset Ngày Mới — làm trống 100% bàn làm việc */
  onResetNewDay?: () => void;
  /** Callback Test nhanh Kịch bản Full Chỗ -> Ra Giếng Trời Hút Thuốc (`🚬 💨`) */
  onTriggerTestFullSeatsSmoking?: () => void;
  /** Callback Test nhanh Quy tắc 2h Không Có Event Mới -> Nhân viên đứng dậy đi ra `🚪 CỬA RA VÀO` về nhà (`🏠`) */
  onTriggerTestInactivityCheckout?: () => void;
  /** Số nhân viên đã Check-in chiếm chỗ ngồi trong ngày */
  checkedInCount?: number;
  /** Số nhân viên đến muộn hết chỗ đang tụ tập ở Giếng trời hút thuốc */
  smokingCount?: number;
  /** Top 3 Chiến Thần Giao Việc & Build CI (MVP Podium) */
  mvpLeaderboard?: MvpLeaderboardEntry[];
  /** Bản đồ nhiệt 9 Cụm bàn Khoang Nhà Thuốc */
  islandHeatmap?: Record<string, IslandHeatmapStat>;
  /** Cấu hình hiển thị & tốc độ mô phỏng */
  config?: Partial<SimulationConfig>;
  /** Cờ bật chế độ cao điểm Sprint Demo Rush */
  sprintRush?: boolean;
  /** Alias cho sprintRush */
  isSprintRush?: boolean;
  /** ID nhân viên đang được chọn */
  selectedEmployeeId?: string | null;
  /** Callback khi người dùng click chọn nhân viên */
  onSelectEmployee?: (employee: Employee | null) => void;
  /** Callback tương thích khi click nhân viên */
  onEmployeeClick?: (employee: Employee) => void;
  /** ID ticket đang được chọn */
  selectedTicketId?: string | null;
  /** Callback khi chọn ticket */
  onSelectTicket?: (ticket: JiraTicket | null) => void;
  /** Callback kích hoạt bước tiếp theo của Ticket */
  onAdvanceTicket?: (ticketId: string) => void;
  /** Callback giao việc thủ công từ A sang B */
  onManualTransfer?: (
    ticketId: string,
    fromEmployeeId: string,
    toEmployeeId: string,
    nextStatus?: TicketStatus
  ) => void;
  /** Callback hoàn thành Ticket và mang báo cáo về bàn PM */
  onReturnToPM?: (ticketId: string) => void;
  /** Callback thay đổi cấu hình hiển thị từ thanh công cụ trên Canvas */
  onUpdateConfig?: (patch: Partial<SimulationConfig>) => void;
  /** Tín hiệu từ thanh Top Bar để zoom thẳng vào Khoang NHÀ THUỐC (FT3.III2A.1) */
  focusBaySignal?: number;
  /** Tín hiệu từ thanh Top Bar để bay thẳng tới Sếp Nữ ThuNDM */
  focusManagerSignal?: number;
  /** Tín hiệu từ thanh Top Bar để zoom thẳng vào Trạm Máy Tính Server Jenkins */
  focusJenkinsSignal?: number;
  /** Trạng thái ẩn toàn bộ HUD (chỉ hiện Mini Floating Pill ở góc trên phải) */
  isHudHidden?: boolean;
  /** Callback bật/tắt chế độ Ẩn HUD (Phím tắt H) */
  onToggleHud?: () => void;
  /** Trạng thái toàn màn hình Fullscreen */
  isFullscreen?: boolean;
  /** Callback bật/tắt Fullscreen (Phím tắt F) */
  onToggleFullscreen?: () => void;
  /** Chế độ nguồn dữ liệu hiện tại: LIVE_FRT (Thật) hoặc MOCK_PILOT (Demo) */
  dataSourceMode?: 'LIVE_FRT' | 'MOCK_PILOT';
  /** Chuyển trực tiếp giữa 2 chế độ: LIVE_FRT (Thật) và MOCK_PILOT (Mock) — Không cho user tự set credential */
  onSetDataSourceMode?: (mode: 'LIVE_FRT' | 'MOCK_PILOT') => void;
  /** Class CSS tùy chỉnh */
  className?: string;
}

interface HeartParticle {
  wx: number;
  wy: number;
  wz: number;
  vx: number;
  vy: number;
  vz: number;
  size: number;
  color: string;
  alpha: number;
  symbol?: string;
}

interface ConfettiParticle {
  wx: number;
  wy: number;
  wz: number;
  vx: number;
  vy: number;
  vz: number;
  color: string;
  size: number;
  alpha: number;
  rotation: number;
}

interface SpeechBubbleItem {
  id: string;
  wx: number;
  wy: number;
  text: string;
  subText?: string;
  variant: 'handoff' | 'done' | 'review' | 'bug';
  createdAt: number;
}

interface CameraState {
  x: number;
  y: number;
  zoom: number;
  targetX: number;
  targetY: number;
  targetZoom: number;
}

const STATUS_LABELS: Record<TicketStatus, string> = {
  BACKLOG: 'Backlog',
  TODO: 'To Do',
  IN_PROGRESS: 'In Progress',
  CODE_REVIEW: 'Code Review',
  QA_TESTING: 'QA Testing',
  READY_FOR_DEPLOY: 'Ready Deploy',
  DONE: 'DONE',
};

/** Nội suy tọa độ và vector hướng đi trên chuỗi điểm Point2D theo progress (0..1) */
function interpolateAlongPath(
  path: Point2D[],
  progress: number
): { point: Point2D; angle: number; dx: number; dy: number } {
  if (!path || path.length === 0) {
    return { point: { x: 0, y: 0 }, angle: 0, dx: 0, dy: 1 };
  }
  if (path.length === 1) {
    return { point: path[0], angle: 0, dx: 0, dy: 1 };
  }

  const clamped = Math.max(0, Math.min(1, progress));
  const segmentLengths: number[] = [];
  let totalLength = 0;

  for (let i = 0; i < path.length - 1; i++) {
    const len = Math.hypot(path[i + 1].x - path[i].x, path[i + 1].y - path[i].y);
    segmentLengths.push(len);
    totalLength += len;
  }

  if (totalLength <= 0.001) {
    const p0 = path[0];
    const p1 = path[path.length - 1];
    return { point: p1, angle: 0, dx: p1.x - p0.x, dy: p1.y - p0.y };
  }

  let targetDist = clamped * totalLength;
  for (let i = 0; i < segmentLengths.length; i++) {
    const segLen = segmentLengths[i];
    if (targetDist <= segLen || i === segmentLengths.length - 1) {
      const t = segLen > 0 ? targetDist / segLen : 0;
      const p0 = path[i];
      const p1 = path[i + 1];
      const dx = p1.x - p0.x;
      const dy = p1.y - p0.y;
      return {
        point: {
          x: p0.x + dx * t,
          y: p0.y + dy * t,
        },
        angle: Math.atan2(dy, dx),
        dx,
        dy,
      };
    }
    targetDist -= segLen;
  }

  const last = path[path.length - 1];
  const prev = path[Math.max(0, path.length - 2)];
  return {
    point: last,
    angle: Math.atan2(last.y - prev.y, last.x - prev.x),
    dx: last.x - prev.x,
    dy: last.y - prev.y,
  };
}

/** Sinh câu thoại tự nhiên khi nhân viên A giao tài liệu cho nhân viên B */
function getHandoffSpeechText(task: DocumentTransferTask, toEmployee?: Employee): string {
  if (task.isReturnToPM || task.targetStatus === 'DONE') {
    return `Báo cáo PM: ${task.ticketKey} DONE! 🎉`;
  }
  if (task.targetStatus === 'CODE_REVIEW') {
    return `Review giúp mình ${task.ticketKey} nhé!`;
  }
  if (task.targetStatus === 'QA_TESTING') {
    return `Nhờ QA test bản build ${task.ticketKey} nhé!`;
  }
  if (task.targetStatus === 'READY_FOR_DEPLOY') {
    return `Nhờ DevOps release ${task.ticketKey} lên Prod!`;
  }
  if (task.targetStatus === 'IN_PROGRESS') {
    return `Bàn giao hồ sơ ${task.ticketKey} cho ${toEmployee?.displayName ?? 'bạn'}!`;
  }
  return `Chuyển hồ sơ ${task.ticketKey} (${STATUS_LABELS[task.targetStatus]})`;
}

/**
 * Tính toán vị trí thực tế trên thế giới (wx, wy) VÀ hướng xoay Isometric 4 hướng (SE, SW, NE, NW)
 * của 1 nhân viên (bao gồm khi đi dọc hành lang, khi đứng trao đổi tài liệu đối diện nhau, và khi ngồi nhìn màn hình)
 */
function computeEmployeeWorldPosition(
  emp: Employee,
  activeTasks: DocumentTransferTask[],
  allEmployees?: Employee[],
  activeJenkinsBuild?: ActiveJenkinsBuildTask | null
): {
  pos: Point2D;
  activeTask?: DocumentTransferTask;
  isWalking: boolean;
  isCarryingDocs: boolean;
  isoDirection: IsoDirection;
  facingAngle: number;
  moveVec: Point2D;
} {
  const desk =
    DESK_BY_ID[emp.assignedDeskId || emp.checkedInDeskId || emp.deskId] ||
    DESK_BY_EMPLOYEE_ID[emp.id];
  const isPatrolManager = Boolean(
    emp.isFemaleManager || emp.isManager || emp.id === FEMALE_MANAGER_ID
  );
  const isStandalonePathWalker =
    Boolean(emp.isCheckingOut) ||
    Boolean(
      emp.isWalkingFromEntrance &&
        emp.currentPath &&
        emp.currentPath.length >= 2 &&
        !activeTasks.some((t) => t.fromEmployeeId === emp.id && t.phase !== 'COMPLETED')
    );

  // Xử lý riêng cho 4 vị Sếp đi tuần tra, nhân viên hút thuốc ở Giếng trời, hoặc nhân viên đi về sau 2h không có event / đi vào nhận bàn trống
  if (isPatrolManager || emp.isSmokingAtAtrium || isStandalonePathWalker) {
    const drawPos: Point2D = emp.currentPosition || desk?.seatPosition || { x: 1065, y: 435 };
    const isWalking = isPatrolManager
      ? emp.roamingPhase !== 'CHEERING'
      : Boolean(
          emp.isCheckingOut ||
            emp.isWalkingFromEntrance ||
            (emp.currentPath && emp.currentPath.length >= 2)
        );
    let isoDirection: IsoDirection = emp.isoDirection ?? 'SW';
    let moveVec: Point2D = { x: 0, y: 0 };

    if (isWalking && emp.currentPath && emp.currentPath.length >= 2) {
      const segIdx = Math.max(
        0,
        Math.min(emp.currentPath.length - 2, emp.currentSegmentIndex ?? 0)
      );
      const p0 = emp.currentPath[segIdx];
      const p1 = emp.currentPath[segIdx + 1];
      const dx = p1.x - p0.x;
      const dy = p1.y - p0.y;
      if (Math.hypot(dx, dy) > 0.25) {
        isoDirection = classifyIsoDirection(dx, dy, isoDirection);
        const isoV = worldVecToIsoVec(dx, dy);
        const vLen = Math.hypot(isoV.x, isoV.y) || 1;
        moveVec = { x: isoV.x / vLen, y: isoV.y / vLen };
      }
    } else if (!isWalking && emp.roamingTargetEmployeeId) {
      const targetDesk = DESK_BY_EMPLOYEE_ID[emp.roamingTargetEmployeeId];
      if (targetDesk) {
        const dx = targetDesk.seatPosition.x - drawPos.x;
        const dy = targetDesk.seatPosition.y - drawPos.y;
        if (Math.hypot(dx, dy) > 0.5) {
          isoDirection = classifyIsoDirection(dx, dy, isoDirection);
        }
      }
    }

    const facingAngle =
      emp.facingAngle ??
      Math.atan2(
        isoDirection === 'NE' || isoDirection === 'NW' ? -0.45 : 0.45,
        isoDirection === 'SE' || isoDirection === 'NE' ? 0.86 : -0.86
      );

    return {
      pos: drawPos,
      activeTask: undefined,
      isWalking,
      isCarryingDocs: false,
      isoDirection,
      facingAngle,
      moveVec,
    };
  }

  // Xử lý riêng cho Kỹ sư đang đi bộ tới hoặc đứng gõ bàn phím tại 1 trong 3 Cụm Server Build Jenkins (CI / UAT / RELEASE)
  if (
    activeJenkinsBuild &&
    activeJenkinsBuild.employeeId === emp.id &&
    activeJenkinsBuild.phase !== 'COMPLETED'
  ) {
    const targetCluster =
      JENKINS_SERVER_CLUSTERS.find(
        (c) =>
          c.deskId === activeJenkinsBuild.serverDeskId ||
          c.id === activeJenkinsBuild.clusterId
      ) ?? JENKINS_SERVER_STATION;
    if (activeJenkinsBuild.phase === 'BUILDING_AT_SERVER') {
      const opPos = { ...targetCluster.operatorPosition };
      return {
        pos: opPos,
        activeTask: undefined,
        isWalking: false,
        isCarryingDocs: false,
        isoDirection: 'NE',
        facingAngle: Math.atan2(-0.45, 0.86),
        moveVec: { x: 0, y: 0 },
      };
    }

    const drawPos: Point2D =
      emp.currentPosition || desk?.seatPosition || { ...targetCluster.operatorPosition };
    const pathToUse =
      activeJenkinsBuild.phase === 'RETURNING_TO_DESK'
        ? activeJenkinsBuild.returnPath
        : activeJenkinsBuild.outboundPath;
    let isoDirection: IsoDirection = emp.isoDirection ?? 'NE';
    let moveVec: Point2D = { x: 0, y: 0 };

    if (pathToUse && pathToUse.length >= 2) {
      const segIdx = Math.max(
        0,
        Math.min(pathToUse.length - 2, activeJenkinsBuild.currentSegmentIndex ?? 0)
      );
      const p0 = pathToUse[segIdx];
      const p1 = pathToUse[segIdx + 1];
      const dx = p1.x - p0.x;
      const dy = p1.y - p0.y;
      if (Math.hypot(dx, dy) > 0.25) {
        isoDirection = classifyIsoDirection(dx, dy, isoDirection);
        const isoV = worldVecToIsoVec(dx, dy);
        const vLen = Math.hypot(isoV.x, isoV.y) || 1;
        moveVec = { x: isoV.x / vLen, y: isoV.y / vLen };
      }
    }

    const facingAngle =
      emp.facingAngle ??
      Math.atan2(
        isoDirection === 'NE' || isoDirection === 'NW' ? -0.45 : 0.45,
        isoDirection === 'SE' || isoDirection === 'NE' ? 0.86 : -0.86
      );

    return {
      pos: drawPos,
      activeTask: undefined,
      isWalking: true,
      isCarryingDocs: false,
      isoDirection,
      facingAngle,
      moveVec,
    };
  }

  const activeTask = activeTasks.find(
    (t) => t.fromEmployeeId === emp.id && t.phase !== 'COMPLETED'
  );

  let drawPos: Point2D = emp.currentPosition || desk?.seatPosition || { x: 165, y: 135 };
  const isWalking =
    Boolean(emp.isWalkingFromEntrance) ||
    emp.status === 'CARRYING_DOCS' ||
    emp.status === 'WALKING_BACK' ||
    Boolean(
      activeTask &&
        activeTask.phase !== 'HANDING_OVER' &&
        activeTask.phase !== 'COMPLETED'
    );
  const isCarryingDocs =
    emp.status === 'CARRYING_DOCS' ||
    emp.status === 'HANDOFF' ||
    Boolean(
      activeTask &&
        activeTask.phase !== 'RETURNING_TO_DESK' &&
        activeTask.phase !== 'COMPLETED'
    );

  // Mặc định khi ngồi tại bàn: nhìn thẳng vào màn hình máy tính trên bàn (DOWN -> SW, UP -> NE)
  let isoDirection: IsoDirection =
    emp.isoDirection ?? directionToIso(desk?.orientation ?? emp.facing ?? 'DOWN');
  let moveVec: Point2D = { x: 0, y: 0 };

  if (activeTask) {
    const fallbackPath =
      activeTask.outboundPath?.length >= 2
        ? activeTask.outboundPath
        : computeCorridorPathBetweenDesks(activeTask.fromDeskId, activeTask.toDeskId);
    const pathToUse =
      activeTask.phase === 'RETURNING_TO_DESK' && activeTask.returnPath?.length >= 2
        ? activeTask.returnPath
        : fallbackPath;

    const distFromSeat = desk
      ? Math.hypot(
          emp.currentPosition.x - desk.seatPosition.x,
          emp.currentPosition.y - desk.seatPosition.y
        )
      : 0;

    if (distFromSeat < 2 && activeTask.progress > 0) {
      const normalizedSegProg =
        activeTask.phase === 'RETURNING_TO_DESK'
          ? Math.max(0, Math.min(1, (activeTask.progress - 0.6) / 0.4))
          : Math.max(0, Math.min(1, activeTask.progress / 0.55));
      const interp = interpolateAlongPath(pathToUse, normalizedSegProg);
      drawPos = interp.point;
      if (Math.hypot(interp.dx, interp.dy) > 0.25) {
        isoDirection = classifyIsoDirection(interp.dx, interp.dy, isoDirection);
        const isoV = worldVecToIsoVec(interp.dx, interp.dy);
        const vLen = Math.hypot(isoV.x, isoV.y) || 1;
        moveVec = { x: isoV.x / vLen, y: isoV.y / vLen };
      }
    } else if (
      activeTask.phase === 'HANDING_OVER' ||
      emp.status === 'HANDOFF'
    ) {
      // Người giao (Sender A) xoay mặt nhìn thẳng về phía người nhận (Receiver B)!
      const targetDesk =
        DESK_BY_ID[activeTask.toDeskId] ||
        DESK_BY_EMPLOYEE_ID[activeTask.toEmployeeId];
      if (targetDesk) {
        const dx = targetDesk.seatPosition.x - drawPos.x;
        const dy = targetDesk.seatPosition.y - drawPos.y;
        isoDirection = classifyIsoDirection(dx, dy, isoDirection);
      }
    } else if (pathToUse.length >= 2) {
      // Đang bước đi trên đoạn hành lang hiện tại: lấy vector hướng của đoạn (p0 -> p1)
      const segIdx = Math.max(
        0,
        Math.min(pathToUse.length - 2, activeTask.currentSegmentIndex ?? 0)
      );
      const p0 = pathToUse[segIdx];
      const p1 = pathToUse[segIdx + 1];
      const dx = p1.x - p0.x;
      const dy = p1.y - p0.y;
      if (Math.hypot(dx, dy) > 0.25) {
        isoDirection = classifyIsoDirection(dx, dy, isoDirection);
        const isoV = worldVecToIsoVec(dx, dy);
        const vLen = Math.hypot(isoV.x, isoV.y) || 1;
        moveVec = { x: isoV.x / vLen, y: isoV.y / vLen };
      }
    }
  } else {
    // Kiểm tra nếu nhân viên này là NGƯỜI NHẬN (Receiver B) đang có người đứng trao đổi tại bàn (HANDING_OVER)
    const incomingHandoff = activeTasks.find(
      (t) =>
        t.toEmployeeId === emp.id &&
        (t.phase === 'HANDING_OVER' ||
          (t.phase === 'WALKING_TO_TARGET' && t.progress >= 0.48))
    );
    if (incomingHandoff && !isWalking) {
      const senderEmp =
        allEmployees?.find((e) => e.id === incomingHandoff.fromEmployeeId) ||
        EMPLOYEE_BY_ID[incomingHandoff.fromEmployeeId];
      const targetDesk = DESK_BY_ID[incomingHandoff.toDeskId] || desk;
      const senderPos =
        senderEmp?.currentPosition || targetDesk?.handoffPoint || drawPos;
      const dx = senderPos.x - drawPos.x;
      const dy = senderPos.y - drawPos.y;
      if (Math.hypot(dx, dy) > 0.5) {
        isoDirection = classifyIsoDirection(dx, dy, isoDirection);
      }
    } else if (!isWalking && desk) {
      // Nếu Sếp Nữ ThuNDM đang đứng ngay cạnh bàn thả tim khích lệ mình -> quay mặt hướng về phía Sếp ThuNDM đón nhận tim!
      const femaleMgr = allEmployees?.find(
        (e) => e.isFemaleManager || e.id === FEMALE_MANAGER_ID
      );
      if (
        femaleMgr &&
        femaleMgr.roamingPhase === 'CHEERING' &&
        femaleMgr.roamingTargetEmployeeId === emp.id
      ) {
        const dx = femaleMgr.currentPosition.x - drawPos.x;
        const dy = femaleMgr.currentPosition.y - drawPos.y;
        if (Math.hypot(dx, dy) > 0.5) {
          isoDirection = classifyIsoDirection(dx, dy, isoDirection);
        }
      } else {
        // Ngồi tại bàn: luôn hướng mặt về phía màn hình máy tính của bàn mình!
        isoDirection = directionToIso(desk.orientation);
      }
    }
  }

  const facingAngle =
    emp.facingAngle ??
    Math.atan2(
      isoDirection === 'NE' || isoDirection === 'NW' ? -0.45 : 0.45,
      isoDirection === 'SE' || isoDirection === 'NE' ? 0.86 : -0.86
    );

  return {
    pos: drawPos,
    activeTask,
    isWalking,
    isCarryingDocs,
    isoDirection,
    facingAngle,
    moveVec,
  };
}

export const OfficeCanvas2D: React.FC<OfficeCanvas2DProps> = ({
  employees = EMPLOYEES,
  desks = DESK_POSITIONS,
  zones = OFFICE_ZONES,
  waypoints = OFFICE_WAYPOINTS,
  tickets = [],
  activeTransfers,
  transfers,
  activeJenkinsBuild = null,
  jenkinsBuilds = DEFAULT_JENKINS_RECENT_BUILDS,
  jenkinsLastCompletedAt = null,
  isJenkinsBrokenAlert = false,
  brokenBuildNumber = null,
  jenkinsHotfixCelebrationAt = null,
  onTriggerJenkinsBuild,
  onTriggerUatBuild,
  onTriggerJenkinsBrokenHotfix,
  onResetNewDay,
  onTriggerTestFullSeatsSmoking,
  onTriggerTestInactivityCheckout,
  checkedInCount,
  smokingCount,
  mvpLeaderboard = [],
  islandHeatmap = {},
  config: configProp,
  sprintRush = false,
  isSprintRush = false,
  selectedEmployeeId: controlledSelectedEmpId,
  onSelectEmployee,
  onEmployeeClick,
  onAdvanceTicket,
  onManualTransfer,
  onReturnToPM,
  onUpdateConfig,
  focusBaySignal,
  focusManagerSignal,
  focusJenkinsSignal,
  isHudHidden = false,
  onToggleHud,
  isFullscreen = false,
  onToggleFullscreen,
  dataSourceMode = 'MOCK_PILOT',
  onSetDataSourceMode,
  className = '',
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const rushActive = Boolean(sprintRush || isSprintRush);
  const currentTransfers = useMemo(
    () => (activeTransfers ?? transfers ?? []).filter((t) => t.phase !== 'COMPLETED'),
    [activeTransfers, transfers]
  );

  // Local toggles synced with props (Mặc định TẮT hoàn toàn việc vẽ đường kẻ nét đứt dưới chân nhân vật: showPaths = false)
  const [localShowGrid, setLocalShowGrid] = useState<boolean>(
    configProp?.showGrid ?? DEFAULT_SIMULATION_CONFIG.showGrid
  );
  const [localShowWaypoints, setLocalShowWaypoints] = useState<boolean>(
    configProp?.showWaypoints ?? DEFAULT_SIMULATION_CONFIG.showWaypoints
  );
  const [localShowActivePaths, setLocalShowActivePaths] = useState<boolean>(
    Boolean(configProp?.showActivePaths ?? configProp?.showPaths ?? false)
  );
  const [localShowLabels, setLocalShowLabels] = useState<boolean>(
    configProp?.showEmployeeLabels ?? DEFAULT_SIMULATION_CONFIG.showEmployeeLabels
  );
  const [localShowIslandHeatmap, setLocalShowIslandHeatmap] = useState<boolean>(
    configProp?.showIslandHeatmap ?? DEFAULT_SIMULATION_CONFIG.showIslandHeatmap ?? false
  );
  const [localShowMvpPodium, setLocalShowMvpPodium] = useState<boolean>(
    configProp?.showMvpPodium ?? DEFAULT_SIMULATION_CONFIG.showMvpPodium ?? true
  );
  const [roleFilter, setRoleFilter] = useState<Role | 'ALL'>('ALL');

  // ============================================================================
  // SMART EVENT-FOLLOW CAMERA DIRECTOR STATE (AUTO-FOCUS ON ACTIVE TRANSFER & 30S BOSS ROTATION)
  // ============================================================================
  const [autoFollowEvent, setAutoFollowEvent] = useState<boolean>(true);
  const [isFreeCamera, setIsFreeCamera] = useState<boolean>(false);
  const [focusedTransferId, setFocusedTransferId] = useState<string | null>(null);
  const [hudZoomPercent, setHudZoomPercent] = useState<number>(Math.round(EVENT_FOCUS_ZOOM * 100));
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const [bossCycleNow, setBossCycleNow] = useState<number>(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => {
      setBossCycleNow(Date.now());
    }, 1000);
    return () => window.clearInterval(timer);
  }, []);

  const cameraRef = useRef<CameraState>({
    x: ISO_ORIGIN_X,
    y: ISO_ORIGIN_Y,
    zoom: 1.38,
    targetX: ISO_ORIGIN_X,
    targetY: ISO_ORIGIN_Y,
    targetZoom: EVENT_FOCUS_ZOOM,
  });
  const dragLastClientRef = useRef<Point2D>({ x: 0, y: 0 });
  const didDragMoveRef = useRef<boolean>(false);

  // Selection & Hover state
  const [internalSelectedEmpId, setInternalSelectedEmpId] = useState<string | null>(null);
  const [hoveredEmployeeId, setHoveredEmployeeId] = useState<string | null>(null);
  const [hoveredJenkinsServer, setHoveredJenkinsServer] = useState<boolean>(false);
  const [manualTargetEmpId, setManualTargetEmpId] = useState<string>('EMP-04');

  const selectedEmpId =
    controlledSelectedEmpId !== undefined ? controlledSelectedEmpId : internalSelectedEmpId;

  useEffect(() => {
    if (configProp?.showGrid !== undefined) setLocalShowGrid(configProp.showGrid);
    if (configProp?.showWaypoints !== undefined) setLocalShowWaypoints(configProp.showWaypoints);
    if (configProp?.showActivePaths !== undefined || configProp?.showPaths !== undefined) {
      setLocalShowActivePaths(Boolean(configProp.showActivePaths ?? configProp.showPaths));
    }
    if (configProp?.showEmployeeLabels !== undefined)
      setLocalShowLabels(configProp.showEmployeeLabels);
    if (configProp?.showIslandHeatmap !== undefined)
      setLocalShowIslandHeatmap(configProp.showIslandHeatmap);
    if (configProp?.showMvpPodium !== undefined)
      setLocalShowMvpPodium(configProp.showMvpPodium);
  }, [
    configProp?.showGrid,
    configProp?.showWaypoints,
    configProp?.showActivePaths,
    configProp?.showPaths,
    configProp?.showEmployeeLabels,
    configProp?.showIslandHeatmap,
    configProp?.showMvpPodium,
  ]);

  const effectiveConfig: SimulationConfig = useMemo(
    () => ({
      ...DEFAULT_SIMULATION_CONFIG,
      ...configProp,
      showGrid: localShowGrid,
      showWaypoints: localShowWaypoints,
      showActivePaths: localShowActivePaths,
      showPaths: localShowActivePaths,
      showEmployeeLabels: localShowLabels,
      showIslandHeatmap: localShowIslandHeatmap,
      showMvpPodium: localShowMvpPodium,
    }),
    [
      configProp,
      localShowGrid,
      localShowWaypoints,
      localShowActivePaths,
      localShowLabels,
      localShowIslandHeatmap,
      localShowMvpPodium,
    ]
  );

  // Chọn sự kiện ưu tiên nhất để Camera Director bám theo
  const primaryActiveTransfer = useMemo((): DocumentTransferTask | null => {
    if (currentTransfers.length === 0) return null;
    if (focusedTransferId) {
      const explicit = currentTransfers.find((t) => t.id === focusedTransferId);
      if (explicit) return explicit;
    }
    const carryingTasks = currentTransfers.filter((t) => t.phase !== 'RETURNING_TO_DESK');
    const pool = carryingTasks.length > 0 ? carryingTasks : currentTransfers;

    const doneTask = pool.find((t) => t.isReturnToPM || t.targetStatus === 'DONE');
    if (doneTask) return doneTask;

    return [...pool].sort((a, b) => b.startedAt - a.startedAt)[0] ?? pool[0];
  }, [currentTransfers, focusedTransferId]);

  // Keep latest data in refs so the 60fps requestAnimationFrame loop never stutters
  const employeesRef = useRef<Employee[]>(employees);
  const desksRef = useRef<DeskPosition[]>(desks);
  const zonesRef = useRef<OfficeZone[]>(zones);
  const waypointsRef = useRef<Waypoint[]>(waypoints);
  const ticketsRef = useRef<JiraTicket[]>(tickets);
  const transfersRef = useRef<DocumentTransferTask[]>(currentTransfers);
  const primaryTransferRef = useRef<DocumentTransferTask | null>(primaryActiveTransfer);
  const activeJenkinsBuildRef = useRef<ActiveJenkinsBuildTask | null>(activeJenkinsBuild);
  const jenkinsBuildsRef = useRef<JenkinsBuildJobItem[]>(jenkinsBuilds);
  const jenkinsLastCompletedAtRef = useRef<number | null>(jenkinsLastCompletedAt);
  const isJenkinsBrokenAlertRef = useRef<boolean>(isJenkinsBrokenAlert);
  const brokenBuildNumberRef = useRef<number | null>(brokenBuildNumber);
  const islandHeatmapRef = useRef<Record<string, IslandHeatmapStat>>(islandHeatmap);
  const hoveredJenkinsServerRef = useRef<boolean>(hoveredJenkinsServer);
  const autoFollowRef = useRef<boolean>(autoFollowEvent);
  const isFreeCameraRef = useRef<boolean>(isFreeCamera);
  const configRef = useRef<SimulationConfig>(effectiveConfig);
  const rushRef = useRef<boolean>(rushActive);
  const selectedEmpIdRef = useRef<string | null>(selectedEmpId);
  const hoveredEmpIdRef = useRef<string | null>(hoveredEmployeeId);
  const roleFilterRef = useRef<Role | 'ALL'>(roleFilter);
  const confettiRef = useRef<ConfettiParticle[]>([]);
  const heartParticlesRef = useRef<HeartParticle[]>([]);
  const lastHeartSpawnRef = useRef<number>(0);
  const speechBubblesRef = useRef<SpeechBubbleItem[]>([]);
  const celebratedTaskIdsRef = useRef<Set<string>>(new Set());

  employeesRef.current = employees;
  desksRef.current = desks;
  zonesRef.current = zones;
  waypointsRef.current = waypoints;
  ticketsRef.current = tickets;
  transfersRef.current = currentTransfers;
  primaryTransferRef.current = primaryActiveTransfer;
  activeJenkinsBuildRef.current = activeJenkinsBuild;
  jenkinsBuildsRef.current = jenkinsBuilds;
  jenkinsLastCompletedAtRef.current = jenkinsLastCompletedAt;
  isJenkinsBrokenAlertRef.current = isJenkinsBrokenAlert;
  brokenBuildNumberRef.current = brokenBuildNumber;
  islandHeatmapRef.current = islandHeatmap;
  hoveredJenkinsServerRef.current = hoveredJenkinsServer;
  autoFollowRef.current = autoFollowEvent;
  isFreeCameraRef.current = isFreeCamera;
  configRef.current = effectiveConfig;
  rushRef.current = rushActive;
  selectedEmpIdRef.current = selectedEmpId;
  hoveredEmpIdRef.current = hoveredEmployeeId;
  roleFilterRef.current = roleFilter;

  // Trigger celebratory green fireworks/confetti at Jenkins Server Station when a Broken Build is rescued!
  useEffect(() => {
    if (!jenkinsHotfixCelebrationAt) return;
    const now = performance.now();
    const srvPos = JENKINS_SERVER_STATION.operatorPosition;
    const colors = ['#10b981', '#34d399', '#22c55e', '#a7f3d0', '#facc15', '#38bdf8'];
    for (let i = 0; i < 42; i++) {
      const angle = (Math.PI * 2 * i) / 42 + (Math.random() - 0.5) * 0.25;
      const speed = 1.8 + Math.random() * 3.8;
      confettiRef.current.push({
        wx: srvPos.x + (Math.random() - 0.5) * 28,
        wy: srvPos.y + (Math.random() - 0.5) * 24,
        wz: 32 + Math.random() * 18,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        vz: 2.8 + Math.random() * 3.2,
        color: colors[i % colors.length],
        size: 5.5 + Math.random() * 4,
        alpha: 1,
        rotation: Math.random() * Math.PI * 2,
      });
    }
    speechBubblesRef.current.push({
      id: `hotfix-done-${jenkinsHotfixCelebrationAt}`,
      wx: srvPos.x,
      wy: srvPos.y,
      text: `🎉 HOTFIX THÀNH CÔNG • BUILD BACK TO NORMAL ✅!`,
      subText: 'Jenkins CI oneclickv4-build-ci đã xanh trở lại',
      variant: 'done',
      createdAt: now,
    });
  }, [jenkinsHotfixCelebrationAt]);

  // Trigger celebratory confetti at PM desk when a DONE transfer arrives
  useEffect(() => {
    const now = performance.now();
    for (const task of currentTransfers) {
      if (
        (task.isReturnToPM || task.targetStatus === 'DONE') &&
        (task.phase === 'HANDING_OVER' || task.progress >= 0.82) &&
        !celebratedTaskIdsRef.current.has(task.id)
      ) {
        celebratedTaskIdsRef.current.add(task.id);
        const pmPos = PM_DESK.position;
        const colors = ['#10b981', '#f59e0b', '#0284c7', '#7c3aed', '#ea580c', '#eab308'];
        for (let i = 0; i < 34; i++) {
          const angle = (Math.PI * 2 * i) / 34 + (Math.random() - 0.5) * 0.3;
          const speed = 1.6 + Math.random() * 3.4;
          confettiRef.current.push({
            wx: pmPos.x + (Math.random() - 0.5) * 24,
            wy: pmPos.y + (Math.random() - 0.5) * 24,
            wz: 28 + Math.random() * 14,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            vz: 2.5 + Math.random() * 3.0,
            color: colors[i % colors.length],
            size: 5 + Math.random() * 4,
            alpha: 1,
            rotation: Math.random() * Math.PI * 2,
          });
        }
        speechBubblesRef.current.push({
          id: `done-${task.id}`,
          wx: pmPos.x,
          wy: pmPos.y,
          text: `🎉 Đã nghiệm thu ${task.ticketKey}: DONE!`,
          subText: 'Hồ sơ đã lưu vào Khay PM',
          variant: 'done',
          createdAt: now,
        });
      }
    }
  }, [currentTransfers]);

  // Chuyển đổi tọa độ chuột (clientX, clientY) sang tọa độ thế giới (wx, wy) qua Camera & Isometric Inverse
  const getWorldCoordsFromClient = useCallback(
    (clientX: number, clientY: number): { world: Point2D; iso: Point2D } | null => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return null;

      const localX = clientX - rect.left;
      const localY = clientY - rect.top;
      const viewScale = Math.max(
        rect.width / OFFICE_CANVAS_WIDTH,
        rect.height / OFFICE_CANVAS_HEIGHT
      );
      const cam = cameraRef.current;
      const effectiveZoom = cam.zoom * viewScale;

      const isoX = (localX - rect.width / 2) / effectiveZoom + cam.x;
      const isoY = (localY - rect.height / 2) / effectiveZoom + cam.y;

      return {
        iso: { x: isoX, y: isoY },
        world: isoToWorld(isoX, isoY),
      };
    },
    []
  );

  // Kiểm tra chuột có đang trỏ vào Trạm Máy Tính Server Jenkins (`JENKINS_SERVER_STATION`) không
  const isClientPointOnJenkinsServer = useCallback(
    (clientX: number, clientY: number): boolean => {
      const coords = getWorldCoordsFromClient(clientX, clientY);
      if (!coords) return false;
      const { world, iso } = coords;
      if (
        world.x >= JENKINS_SERVER_STATION.wx - 12 &&
        world.x <= JENKINS_SERVER_STATION.wx + JENKINS_SERVER_STATION.ww + 12 &&
        world.y >= JENKINS_SERVER_STATION.wy - 14 &&
        world.y <= JENKINS_SERVER_STATION.wy + JENKINS_SERVER_STATION.wh + 18
      ) {
        return true;
      }
      const centerIso = worldToIso(
        JENKINS_SERVER_STATION.wx + JENKINS_SERVER_STATION.ww * 0.5,
        JENKINS_SERVER_STATION.wy + JENKINS_SERVER_STATION.wh * 0.5,
        32
      );
      return Math.hypot(iso.x - centerIso.x, iso.y - centerIso.y) <= 46;
    },
    [getWorldCoordsFromClient]
  );

  // Tìm nhân viên hoặc bàn làm việc dưới trỏ chuột trong không gian Isometric
  const findEmployeeAtClientPoint = useCallback(
    (clientX: number, clientY: number): Employee | null => {
      const coords = getWorldCoordsFromClient(clientX, clientY);
      if (!coords) return null;
      const { iso, world } = coords;
      const emps = employeesRef.current;
      const activeTasks = transfersRef.current;

      // 1. Kiểm tra khoảng cách trực tiếp tới hình mẫu 3D của nhân viên trên mặt phẳng Isometric
      for (const emp of emps) {
        const { pos } = computeEmployeeWorldPosition(
          emp,
          activeTasks,
          emps,
          activeJenkinsBuildRef.current
        );
        const empIso = worldToIso(pos.x, pos.y, 18);
        if (Math.hypot(iso.x - empIso.x, iso.y - empIso.y) <= 22) {
          return emp;
        }
      }

      // 2. Kiểm tra vùng bàn làm việc trong tọa độ thế giới (gọn cho bàn cụm đảo 2x3 liền khối)
      for (const desk of desksRef.current) {
        const halfW = (desk.width || 34) * 0.5;
        const halfH = (desk.height || 32) * 0.5;
        if (
          world.x >= desk.x - halfW &&
          world.x <= desk.x + halfW &&
          world.y >= desk.y - halfH &&
          world.y <= desk.y + halfH
        ) {
          const emp = emps.find((e) => e.id === desk.assignedEmployeeId);
          if (emp) return emp;
        }
      }

      return null;
    },
    [getWorldCoordsFromClient]
  );

  const handleSelectEmployee = useCallback(
    (emp: Employee | null) => {
      setInternalSelectedEmpId(emp ? emp.id : null);
      onSelectEmployee?.(emp);
      if (emp) {
        onEmployeeClick?.(emp);
        const { pos } = computeEmployeeWorldPosition(
          emp,
          transfersRef.current,
          employeesRef.current,
          activeJenkinsBuildRef.current
        );
        const targetIso = worldToIso(pos.x, pos.y, 20);
        cameraRef.current.targetX = targetIso.x;
        cameraRef.current.targetY = targetIso.y;
        cameraRef.current.targetZoom = Math.max(cameraRef.current.targetZoom, 1.7);
      }
    },
    [onSelectEmployee, onEmployeeClick]
  );

  /** 1-Click Zoom Camera thẳng vào Trạm Máy Tính Server Jenkins (`JENKINS_SERVER_STATION`) */
  const focusJenkinsServerCamera = useCallback(() => {
    setAutoFollowEvent(false);
    setIsFreeCamera(true);
    setHoveredJenkinsServer(true);
    hoveredJenkinsServerRef.current = true;
    const srvIso = worldToIso(
      JENKINS_SERVER_STATION.cameraFocusWorld.x,
      JENKINS_SERVER_STATION.cameraFocusWorld.y,
      28
    );
    cameraRef.current.targetX = srvIso.x;
    cameraRef.current.targetY = srvIso.y - 12;
    cameraRef.current.targetZoom = JENKINS_SERVER_STATION.cameraFocusWorld.zoom;
    setHudZoomPercent(Math.round(JENKINS_SERVER_STATION.cameraFocusWorld.zoom * 100));
  }, []);

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (isDragging) {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;

      const dxClient = e.clientX - dragLastClientRef.current.x;
      const dyClient = e.clientY - dragLastClientRef.current.y;
      if (Math.hypot(dxClient, dyClient) > 3) {
        didDragMoveRef.current = true;
        if (!isFreeCameraRef.current) {
          setIsFreeCamera(true);
        }
      }

      dragLastClientRef.current = { x: e.clientX, y: e.clientY };

      const cam = cameraRef.current;
      const viewScale = Math.max(
        rect.width / OFFICE_CANVAS_WIDTH,
        rect.height / OFFICE_CANVAS_HEIGHT
      );
      const effectiveZoom = cam.zoom * viewScale;
      cam.targetX -= dxClient / effectiveZoom;
      cam.targetY -= dyClient / effectiveZoom;
      cam.x = cam.targetX;
      cam.y = cam.targetY;
      return;
    }

    const onServer = isClientPointOnJenkinsServer(e.clientX, e.clientY);
    if (onServer !== hoveredJenkinsServerRef.current) {
      setHoveredJenkinsServer(onServer);
      hoveredJenkinsServerRef.current = onServer;
    }

    const emp = findEmployeeAtClientPoint(e.clientX, e.clientY);
    setHoveredEmployeeId(emp ? emp.id : null);
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    didDragMoveRef.current = false;
    dragLastClientRef.current = { x: e.clientX, y: e.clientY };
    setIsDragging(true);
  };

  const handleMouseUp = (e: React.MouseEvent<HTMLDivElement>) => {
    if (isDragging && !didDragMoveRef.current) {
      if (isClientPointOnJenkinsServer(e.clientX, e.clientY)) {
        focusJenkinsServerCamera();
        setIsDragging(false);
        return;
      }
      const clickedEmp = findEmployeeAtClientPoint(e.clientX, e.clientY);
      if (clickedEmp) {
        handleSelectEmployee(clickedEmp);
      }
    }
    setIsDragging(false);
  };

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault();
    const delta = e.deltaY < 0 ? 0.14 : -0.14;
    const cam = cameraRef.current;
    const nextZoom = Math.max(0.55, Math.min(2.6, Number((cam.targetZoom + delta).toFixed(2))));
    cam.targetZoom = nextZoom;
    setHudZoomPercent(Math.round(nextZoom * 100));
  };

  // Các chế độ điều khiển Camera Director
  const activateAutoFocusEventCamera = useCallback((transferId?: string) => {
    if (transferId) {
      setFocusedTransferId(transferId);
    }
    setAutoFollowEvent(true);
    setIsFreeCamera(false);
    cameraRef.current.targetZoom = EVENT_FOCUS_ZOOM;
    setHudZoomPercent(Math.round(EVENT_FOCUS_ZOOM * 100));
  }, []);

  const switchToOverviewCamera = useCallback(() => {
    setAutoFollowEvent(false);
    setIsFreeCamera(true);
    cameraRef.current.targetX = ISO_ORIGIN_X;
    cameraRef.current.targetY = ISO_ORIGIN_Y + 8;
    cameraRef.current.targetZoom = OVERVIEW_ZOOM;
    setHudZoomPercent(Math.round(OVERVIEW_ZOOM * 100));
  }, []);

  /** 1-Click Zoom Camera thẳng vào Khoang NHÀ THUỐC (FT3.III2A.1 • 9 cụm bàn • 54 ô) */
  const focusNhaThuocBayCamera = useCallback(() => {
    setAutoFollowEvent(false);
    setIsFreeCamera(true);
    const centerWx = NHA_THUOC_BAY_BOUNDS.cameraFocusWorld.x;
    const centerWy = NHA_THUOC_BAY_BOUNDS.cameraFocusWorld.y;
    const bayIso = worldToIso(centerWx, centerWy, 16);
    cameraRef.current.targetX = bayIso.x;
    cameraRef.current.targetY = bayIso.y;
    cameraRef.current.targetZoom = NHA_THUOC_BAY_BOUNDS.cameraFocusWorld.zoom;
    setHudZoomPercent(Math.round(NHA_THUOC_BAY_BOUNDS.cameraFocusWorld.zoom * 100));
  }, []);

  /** 1-Click Bay thẳng tới Sếp đang đi tuần tra (hoặc Sếp hiện tại trong chu kỳ 30s) */
  const focusManagerCamera = useCallback(
    (bossId?: string) => {
      setFocusedTransferId(null);
      const activeCycleBossId =
        bossId ??
        BOSS_ROTATION_IDS[Math.floor(Date.now() / 30000) % BOSS_ROTATION_IDS.length];
      setInternalSelectedEmpId(activeCycleBossId);
      const mgr =
        employeesRef.current.find((e) => e.id === activeCycleBossId) ||
        EMPLOYEE_BY_ID[activeCycleBossId];
      if (mgr) {
        onSelectEmployee?.(mgr);
        const { pos } = computeEmployeeWorldPosition(
          mgr,
          transfersRef.current,
          employeesRef.current,
          activeJenkinsBuildRef.current
        );
        const focusIso = worldToIso(pos.x, pos.y, 24);
        cameraRef.current.targetX = focusIso.x;
        cameraRef.current.targetY = focusIso.y - 10;
      }
      setAutoFollowEvent(true);
      setIsFreeCamera(false);
      cameraRef.current.targetZoom = MANAGER_FOCUS_ZOOM;
      setHudZoomPercent(Math.round(MANAGER_FOCUS_ZOOM * 100));
    },
    [onSelectEmployee]
  );

  useEffect(() => {
    if (focusBaySignal && focusBaySignal > 0) {
      focusNhaThuocBayCamera();
    }
  }, [focusBaySignal, focusNhaThuocBayCamera]);

  useEffect(() => {
    if (focusManagerSignal && focusManagerSignal > 0) {
      focusManagerCamera();
    }
  }, [focusManagerSignal, focusManagerCamera]);

  useEffect(() => {
    if (focusJenkinsSignal && focusJenkinsSignal > 0) {
      focusJenkinsServerCamera();
    }
  }, [focusJenkinsSignal, focusJenkinsServerCamera]);

  const toggleAutoFollowCamera = useCallback(() => {
    if (autoFollowEvent && !isFreeCamera) {
      switchToOverviewCamera();
    } else {
      activateAutoFocusEventCamera();
    }
  }, [autoFollowEvent, isFreeCamera, switchToOverviewCamera, activateAutoFocusEventCamera]);

  // ============================================================================
  // MAIN 60FPS ISOMETRIC 2.5D RENDER & CAMERA DIRECTOR LOOP (HiDPI SUPPORTED)
  // ============================================================================
  useEffect(() => {
    let animationFrameId: number;
    let lastZoomHudSync = 0;

    const renderFrame = (time: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // Khung hình game luôn tự động giãn tối đa 100% màn hình (Full Viewport WxH) với độ nét HiDPI 2.5x
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      const viewW = Math.max(
        320,
        canvas.clientWidth || window.innerWidth || OFFICE_CANVAS_WIDTH
      );
      const viewH = Math.max(
        240,
        canvas.clientHeight || window.innerHeight || OFFICE_CANVAS_HEIGHT
      );
      const targetW = Math.round(viewW * dpr);
      const targetH = Math.round(viewH * dpr);
      if (canvas.width !== targetW || canvas.height !== targetH) {
        canvas.width = targetW;
        canvas.height = targetH;
      }
      const viewScale = Math.max(
        viewW / OFFICE_CANVAS_WIDTH,
        viewH / OFFICE_CANVAS_HEIGHT
      );

      const cfg = configRef.current;
      const emps = employeesRef.current;
      const allDesks = desksRef.current;
      const allWaypoints = waypointsRef.current;
      const allTickets = ticketsRef.current;
      const activeTasks = transfersRef.current;
      const primaryTask = primaryTransferRef.current;
      const selEmpId = selectedEmpIdRef.current;
      const hovEmpId = hoveredEmpIdRef.current;
      const activeRoleFilter = roleFilterRef.current;
      const activeBuild = activeJenkinsBuildRef.current;
      const recentBuilds = jenkinsBuildsRef.current;
      const lastBuildDoneAt = jenkinsLastCompletedAtRef.current;
      const isBrokenAlert = isJenkinsBrokenAlertRef.current;
      const brokenBuildNum = brokenBuildNumberRef.current;
      const heatmapMap = islandHeatmapRef.current;
      const isHoveredServer = hoveredJenkinsServerRef.current;
      const isRecentlyCompletedBuild = Boolean(
        lastBuildDoneAt && Date.now() - lastBuildDoneAt < 6500
      );
      const cam = cameraRef.current;

      // ------------------------------------------------------------------------
      // 0. SMART EVENT-FOLLOW CAMERA DIRECTOR UPDATE (SMOOTH LERP + ZOOM)
      // ------------------------------------------------------------------------
      if (autoFollowRef.current && !isFreeCameraRef.current) {
        if (
          activeBuild?.isHotfixRescue &&
          (activeBuild.phase === 'WALKING_TO_SERVER' ||
            activeBuild.phase === 'BUILDING_AT_SERVER')
        ) {
          // ƯU TIÊN KHẨN CẤP (P0): Sự kiện Jenkins Build Broken & Hotfix Rescue (`⚡ HOTFIX SPRINT`)
          const rescuerEmp =
            emps.find((e) => e.id === activeBuild.employeeId) ||
            EMPLOYEE_BY_ID[activeBuild.employeeId];
          if (rescuerEmp) {
            const { pos } = computeEmployeeWorldPosition(
              rescuerEmp,
              activeTasks,
              emps,
              activeBuild
            );
            const focusIso = worldToIso(
              activeBuild.phase === 'BUILDING_AT_SERVER'
                ? JENKINS_SERVER_STATION.cameraFocusWorld.x
                : pos.x,
              activeBuild.phase === 'BUILDING_AT_SERVER'
                ? JENKINS_SERVER_STATION.cameraFocusWorld.y
                : pos.y,
              28
            );
            cam.targetX = focusIso.x;
            cam.targetY = focusIso.y - 12;
            cam.targetZoom = 1.54;
          }
        } else if (primaryTask) {
          // ƯU TIÊN 1: Có Event bàn giao chồng tài liệu (A ➔ B hoặc DONE về PM)
          const carrierEmp =
            emps.find((e) => e.id === primaryTask.fromEmployeeId) ||
            EMPLOYEE_BY_ID[primaryTask.fromEmployeeId];
          if (carrierEmp) {
            const { pos } = computeEmployeeWorldPosition(
              carrierEmp,
              activeTasks,
              emps,
              activeBuild
            );
            const focusIso = worldToIso(pos.x, pos.y, 26);
            cam.targetX = focusIso.x;
            cam.targetY = focusIso.y - 12;
            cam.targetZoom = EVENT_FOCUS_ZOOM;
          }
        } else if (
          activeBuild &&
          (activeBuild.phase === 'WALKING_TO_SERVER' ||
            activeBuild.phase === 'BUILDING_AT_SERVER')
        ) {
          // ƯU TIÊN 1B: Có kỹ sư đang đi bộ lại hoặc đứng chạy Build tại 1 trong 3 Cụm Server Jenkins (CI / UAT / RELEASE)
          const builderEmp =
            emps.find((e) => e.id === activeBuild.employeeId) ||
            EMPLOYEE_BY_ID[activeBuild.employeeId];
          const buildCluster =
            JENKINS_SERVER_CLUSTERS.find(
              (c) =>
                c.deskId === activeBuild.serverDeskId || c.id === activeBuild.clusterId
            ) ?? JENKINS_SERVER_STATION;
          if (builderEmp) {
            const { pos } = computeEmployeeWorldPosition(
              builderEmp,
              activeTasks,
              emps,
              activeBuild
            );
            const focusIso = worldToIso(
              activeBuild.phase === 'BUILDING_AT_SERVER'
                ? buildCluster.cameraFocusWorld.x
                : pos.x,
              activeBuild.phase === 'BUILDING_AT_SERVER'
                ? buildCluster.cameraFocusWorld.y
                : pos.y,
              28
            );
            cam.targetX = focusIso.x;
            cam.targetY = focusIso.y - 14;
            cam.targetZoom = 1.56;
          }
        } else if (selEmpId && !BOSS_ID_SET.has(selEmpId)) {
          const selEmp = emps.find((e) => e.id === selEmpId) || EMPLOYEE_BY_ID[selEmpId];
          if (selEmp) {
            const { pos } = computeEmployeeWorldPosition(
              selEmp,
              activeTasks,
              emps,
              activeBuild
            );
            const focusIso = worldToIso(pos.x, pos.y, 22);
            cam.targetX = focusIso.x;
            cam.targetY = focusIso.y;
            cam.targetZoom = 1.6;
          }
        } else {
          // ƯU TIÊN 2 (MẶC ĐỊNH KHI KHÔNG CÓ EVENT BÀN GIAO HỒ SƠ):
          // Lần lượt xoay tua Focus 4 Sếp (mỗi Sếp 30 giây): ThuNDM (30s) -> ToanLBK (30s) -> doannt19 (30s) -> vanltb8 (30s)!
          const bossIdx = Math.floor(Date.now() / 30000) % BOSS_ROTATION_IDS.length;
          const activeBossId = BOSS_ROTATION_IDS[bossIdx];
          const currentBoss =
            emps.find((e) => e.id === activeBossId) || EMPLOYEE_BY_ID[activeBossId];
          if (currentBoss) {
            const { pos } = computeEmployeeWorldPosition(
              currentBoss,
              activeTasks,
              emps,
              activeBuild
            );
            const focusIso = worldToIso(pos.x, pos.y, 25);
            cam.targetX = focusIso.x;
            cam.targetY = focusIso.y - 10;
            cam.targetZoom = MANAGER_FOCUS_ZOOM;
          } else {
            cam.targetX = ISO_ORIGIN_X;
            cam.targetY = ISO_ORIGIN_Y + 6;
            cam.targetZoom = 0.84;
          }
        }
      }

      // Smooth spring-like interpolation
      cam.x += (cam.targetX - cam.x) * 0.085;
      cam.y += (cam.targetY - cam.y) * 0.085;
      cam.zoom += (cam.targetZoom - cam.zoom) * 0.075;

      if (time - lastZoomHudSync > 240) {
        lastZoomHudSync = time;
        setHudZoomPercent(Math.round(cam.zoom * 100));
      }

      ctx.save();
      ctx.scale(dpr, dpr);

      // ------------------------------------------------------------------------
      // 1. BRIGHT CLEAN ARCHITECTURAL WORLD BACKGROUND (#F4F6FA -> #FFFFFF)
      // ------------------------------------------------------------------------
      const bgGrad = ctx.createRadialGradient(
        viewW * 0.5,
        viewH * 0.45,
        80,
        viewW * 0.5,
        viewH * 0.5,
        Math.max(viewW, viewH) * 0.85
      );
      bgGrad.addColorStop(0, '#ffffff');
      bgGrad.addColorStop(0.55, '#f6f8fc');
      bgGrad.addColorStop(1, '#eaeff7');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, viewW, viewH);

      // Apply Isometric Camera Transform stretched across 100% viewport
      const effectiveZoom = cam.zoom * viewScale;
      ctx.save();
      ctx.translate(viewW / 2, viewH / 2);
      ctx.scale(effectiveZoom, effectiveZoom);
      ctx.translate(-cam.x, -cam.y);

      // ------------------------------------------------------------------------
      // 2. ISOMETRIC CAMPUS BASEBOARD & SUBTLE WORLD GRID
      // ------------------------------------------------------------------------
      drawIsoBox(
        ctx,
        15,
        15,
        OFFICE_CANVAS_WIDTH - 30,
        OFFICE_CANVAS_HEIGHT - 10,
        -12,
        0,
        '#f1f5f9',
        '#cbd5e1',
        '#94a3b8',
        '#cbd5e1',
        1
      );

      const gridStep = cfg.showGrid ? 30 : 60;
      ctx.strokeStyle = cfg.showGrid
        ? 'rgba(100, 116, 139, 0.22)'
        : 'rgba(148, 163, 184, 0.14)';
      ctx.lineWidth = 0.75;
      for (let gx = 30; gx <= OFFICE_CANVAS_WIDTH - 30; gx += gridStep) {
        const p0 = worldToIso(gx, 20, 0);
        const p1 = worldToIso(gx, OFFICE_CANVAS_HEIGHT - 10, 0);
        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        ctx.lineTo(p1.x, p1.y);
        ctx.stroke();
      }
      for (let gy = 30; gy <= OFFICE_CANVAS_HEIGHT - 10; gy += gridStep) {
        const p0 = worldToIso(20, gy, 0);
        const p1 = worldToIso(OFFICE_CANVAS_WIDTH - 20, gy, 0);
        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        ctx.lineTo(p1.x, p1.y);
        ctx.stroke();
      }

      // ------------------------------------------------------------------------
      // 3. 3-COURTYARD INTERLOCKING BUILDING SLAB, RING CORRIDORS, ATRIUMS & CORES
      // ------------------------------------------------------------------------
      drawCampusRoadNetwork(ctx, time);

      // ------------------------------------------------------------------------
      // 4. 12 CUTAWAY 3D WHITE OFFICE BAYS & SQUAD-SPECIFIC INTERIOR EQUIPMENT
      // ------------------------------------------------------------------------
      for (const z of FLEZI_ISO_ZONES) {
        drawCutawayIsoZone(ctx, z, time);
      }

      // ------------------------------------------------------------------------
      // 5. OPTIONAL WAYPOINTS GRAPH OVERLAY (ISOMETRIC)
      // ------------------------------------------------------------------------
      if (cfg.showWaypoints) {
        ctx.save();
        ctx.strokeStyle = 'rgba(2, 132, 199, 0.45)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 4]);
        for (const wp of allWaypoints) {
          const p1 = worldToIso(wp.position.x, wp.position.y, 10.5);
          for (const targetId of wp.connectedTo) {
            const targetWp = allWaypoints.find((w) => w.id === targetId);
            if (targetWp) {
              const p2 = worldToIso(targetWp.position.x, targetWp.position.y, 10.5);
              ctx.beginPath();
              ctx.moveTo(p1.x, p1.y);
              ctx.lineTo(p2.x, p2.y);
              ctx.stroke();
            }
          }
        }
        ctx.setLineDash([]);
        for (const wp of allWaypoints) {
          const p = worldToIso(wp.position.x, wp.position.y, 10.5);
          ctx.fillStyle = '#0284c7';
          ctx.beginPath();
          ctx.arc(p.x, p.y, 4.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.font = '700 8px monospace';
          ctx.fillStyle = '#0f172a';
          ctx.fillText(wp.id, p.x + 6, p.y + 3);
        }
        ctx.restore();
      }

      // ------------------------------------------------------------------------
      // 6. ACTIVE DOCUMENT TRANSFER PATHS ON ISOMETRIC CORRIDORS (DEFAULT OFF)
      // ------------------------------------------------------------------------
      if (cfg.showActivePaths) {
        for (const task of activeTasks) {
          if (task.phase === 'COMPLETED') continue;

          const rawPath =
            task.outboundPath && task.outboundPath.length >= 2
              ? task.outboundPath
              : computeCorridorPathBetweenDesks(task.fromDeskId, task.toDeskId);

          if (rawPath.length < 2) continue;

          const isDoneReturn = task.isReturnToPM || task.targetStatus === 'DONE';
          const isPrimary = primaryTask?.id === task.id;
          const pathColor = isDoneReturn
            ? '#059669'
            : PRIORITY_COLORS[task.ticketPriority]?.cover || '#ea580c';

          const isoPts = rawPath.map((pt) => worldToIso(pt.x, pt.y, 10.2));

          ctx.save();
          // Glowing ribbon on floor
          ctx.strokeStyle = isDoneReturn
            ? 'rgba(16, 185, 129, 0.32)'
            : 'rgba(234, 88, 12, 0.28)';
          ctx.lineWidth = isPrimary ? 9 : 6;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.beginPath();
          ctx.moveTo(isoPts[0].x, isoPts[0].y);
          for (let i = 1; i < isoPts.length; i++) {
            ctx.lineTo(isoPts[i].x, isoPts[i].y);
          }
          ctx.stroke();

          // Animated marching-ants path line
          ctx.strokeStyle = pathColor;
          ctx.lineWidth = isPrimary ? 3 : 2.2;
          ctx.setLineDash([8, 6]);
          ctx.lineDashOffset = -(time * 0.05);
          ctx.beginPath();
          ctx.moveTo(isoPts[0].x, isoPts[0].y);
          for (let i = 1; i < isoPts.length; i++) {
            ctx.lineTo(isoPts[i].x, isoPts[i].y);
          }
          ctx.stroke();
          ctx.setLineDash([]);

          // Target Pulsing Isometric Beacon at destination Handoff Point
          const destPt = isoPts[isoPts.length - 1];
          const pulseRadius = 9 + 4.5 * Math.sin(time * 0.009);
          ctx.strokeStyle = pathColor;
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.ellipse(
            destPt.x,
            destPt.y,
            pulseRadius * 1.3,
            pulseRadius * 0.7,
            0,
            0,
            Math.PI * 2
          );
          ctx.stroke();

          ctx.restore();
        }
      }

      // ------------------------------------------------------------------------
      // 7. DEPTH-SORTED 3D RENDER QUEUE (TREES, PROPS, JENKINS SERVER, 30 DESKS, 30 CHARACTERS)
      // ------------------------------------------------------------------------
      const doneTicketsCount = allTickets.filter((t) => t.status === 'DONE').length;

      type RenderablesItem =
        | { kind: 'tree'; depthY: number; tree: (typeof CAMPUS_TREES)[number] }
        | { kind: 'prop'; depthY: number; prop: (typeof CAMPUS_STREET_PROPS)[number] }
        | { kind: 'jenkinsServer'; depthY: number; station: JenkinsServerStationMeta }
        | { kind: 'deskIsland'; depthY: number; island: NhaThuocIslandMeta }
        | { kind: 'desk'; depthY: number; desk: DeskPosition }
        | { kind: 'extraSlot'; depthY: number; slot: NhaThuocSeatSlot }
        | {
            kind: 'employee';
            depthY: number;
            emp: Employee;
            pos: Point2D;
            activeTask?: DocumentTransferTask;
            isWalking: boolean;
            isCarryingDocs: boolean;
            isoDirection: IsoDirection;
            facingAngle: number;
            moveVec: Point2D;
          };

      const renderQueue: RenderablesItem[] = [];

      for (const tree of CAMPUS_TREES) {
        const iso = worldToIso(tree.wx, tree.wy, 0);
        renderQueue.push({ kind: 'tree', depthY: iso.y, tree });
      }

      for (const prop of CAMPUS_STREET_PROPS) {
        const iso = worldToIso(prop.wx, prop.wy, 0);
        renderQueue.push({ kind: 'prop', depthY: iso.y, prop });
      }

      // 3 Cụm Server Build Jenkins (`CI` oneclickv4-build-ci, `UAT` oneclickv4-build-uat, `RELEASE` oneclickv4-build-release)
      for (const station of JENKINS_SERVER_CLUSTERS) {
        const srvIso = worldToIso(
          station.wx + station.ww * 0.5,
          station.wy + station.wh * 0.5,
          0
        );
        renderQueue.push({
          kind: 'jenkinsServer',
          depthY: srvIso.y - 6,
          station,
        });
      }

      // 16 Cụm Bàn Ghép 6 Chỗ phủ kín 4 Khoang (`ALL_JOINED_DESK_ISLANDS` = 96 chỗ ngồi)
      for (const island of ALL_JOINED_DESK_ISLANDS) {
        const islandCenterIso = worldToIso(
          island.partitionWx,
          island.tableWy + island.tableWh * 0.5,
          0
        );
        renderQueue.push({
          kind: 'deskIsland',
          depthY: islandCenterIso.y,
          island,
        });
      }

      // Các bàn đơn lẻ nằm ngoài 16 cụm đảo (VD: Bàn PM DongNQ6 hoặc bàn Sếp)
      for (const desk of allDesks) {
        if (ISLAND_DESK_ID_SET.has(desk.id)) continue;
        const iso = worldToIso(desk.x, desk.y, 0);
        renderQueue.push({ kind: 'desk', depthY: iso.y, desk });
      }

      // Chỉ vẽ đồng nghiệp phụ tĩnh khi đã có đông nhân viên check-in (>= 18 người), để đầu ngày 100% bàn làm việc trống trơn!
      const currentCheckedInCount = emps.filter(
        (e) => !e.isManager && !e.isFemaleManager && e.isCheckedIn
      ).length;
      if (cfg.maxOpenSeats === 'FULL' && currentCheckedInCount >= 18) {
        for (const slot of OCCUPIED_EXTRA_NHA_THUOC_SLOTS) {
          const island = ISLAND_BY_ID[slot.islandId];
          const islandDepthY = island
            ? worldToIso(island.partitionWx, island.tableWy + island.tableWh * 0.5, 0).y
            : worldToIso(slot.wx, slot.wy, 0).y;
          const slotDepthY =
            slot.side === 'LEFT'
              ? islandDepthY - 18 + slot.subRow * 2
              : islandDepthY + 12 + slot.subRow * 2;
          renderQueue.push({ kind: 'extraSlot', depthY: slotDepthY, slot });
        }
      }

      for (const emp of emps) {
        const state = computeEmployeeWorldPosition(emp, activeTasks, emps, activeBuild);
        const isBoss = Boolean(emp.isManager || emp.isFemaleManager || emp.id === FEMALE_MANAGER_ID);
        // Đầu ngày toàn bộ bàn trống: chỉ vẽ 4 vị Sếp tuần tra HOẶC nhân viên đã có Event (đã check-in ngồi bàn / đang đi từ cổng vào / đang hút thuốc ở giếng trời / đang đi bộ ra cửa về nhà)
        if (
          !isBoss &&
          !emp.isCheckedIn &&
          !emp.isSmokingAtAtrium &&
          !emp.isWalkingFromEntrance &&
          !emp.isCheckingOut &&
          !state.isWalking
        ) {
          continue;
        }
        const desk =
          DESK_BY_ID[emp.assignedDeskId || emp.checkedInDeskId || emp.deskId] ||
          DESK_BY_EMPLOYEE_ID[emp.id];
        const iso = worldToIso(state.pos.x, state.pos.y, 0);
        const deskIsoY = desk ? worldToIso(desk.x, desk.y, 0).y : iso.y;
        const island = desk?.islandId ? ISLAND_BY_ID[desk.islandId] : undefined;
        const islandDepthY = island
          ? worldToIso(island.partitionWx, island.tableWy + island.tableWh * 0.5, 0).y
          : deskIsoY;
        const subRowOrder = (desk?.rowIndex ?? 1) + 1;
        const activeBuildCluster =
          activeBuild &&
          activeBuild.employeeId === emp.id &&
          activeBuild.phase === 'BUILDING_AT_SERVER'
            ? JENKINS_SERVER_CLUSTERS.find(
                (c) =>
                  c.deskId === activeBuild.serverDeskId || c.id === activeBuild.clusterId
              ) ?? JENKINS_SERVER_STATION
            : null;
        const activeSrvIsoY = activeBuildCluster
          ? worldToIso(
              activeBuildCluster.wx + activeBuildCluster.ww * 0.5,
              activeBuildCluster.wy + activeBuildCluster.wh * 0.5,
              0
            ).y
          : iso.y;
        // Painter's Algorithm khi ngồi tại Cụm Bàn Ghép 2x3:
        // - Dãy Trái (`colIndex = 0`, `isoDirection === 'SE'`): vẽ TRƯỚC khối bàn ghép (`islandDepthY - 18 + subRowOrder * 2`) để mặt bàn che phần đùi/chân dưới gầm bàn
        // - Dãy Phải (`colIndex = 1`, `isoDirection === 'NW'`): vẽ SAU khối bàn ghép (`islandDepthY + 12 + subRowOrder * 2`) để nhân vật quay lưng 3/4 hướng NW nhìn vào màn hình dãy Phải
        const seatedDepthY = activeBuildCluster
          ? activeSrvIsoY + 12
          : island
            ? state.isoDirection === 'NW' || state.isoDirection === 'NE' || desk?.colIndex === 1
              ? islandDepthY + 12 + subRowOrder * 2
              : islandDepthY - 18 + subRowOrder * 2
            : state.isoDirection === 'NW' || state.isoDirection === 'NE'
              ? deskIsoY + 8
              : deskIsoY - 8;
        renderQueue.push({
          kind: 'employee',
          depthY:
            state.isWalking || emp.isSmokingAtAtrium || emp.isCheckingOut || isBoss
              ? iso.y + 6
              : seatedDepthY,
          emp,
          ...state,
        });
      }

      renderQueue.sort((a, b) => a.depthY - b.depthY);

      // Keep track of active walking employees to draw their prominent `● WINA` badges on the top layer
      const activeEventOverlays: WinaEventPillItem[] = [];

      for (const item of renderQueue) {
        if (item.kind === 'tree') {
          drawIsoLowPolyTree(
            ctx,
            item.tree.wx,
            item.tree.wy,
            item.tree.scale,
            item.tree.variant,
            time
          );
          continue;
        }

        if (item.kind === 'prop') {
          drawCampusStreetProp(ctx, item.prop);
          continue;
        }

        if (item.kind === 'jenkinsServer') {
          const isThisClusterBuilding =
            activeBuild &&
            (activeBuild.serverDeskId === item.station.deskId ||
              activeBuild.clusterId === item.station.id)
              ? activeBuild
              : null;
          drawJenkinsServerStation3D(ctx, item.station, {
            time,
            activeBuild: isThisClusterBuilding,
            isHovered: isHoveredServer,
            isRecentlyCompleted: isRecentlyCompletedBuild,
            isBrokenAlert: item.station.id === JENKINS_SERVER_STATION.id ? isBrokenAlert : false,
            brokenBuildNumber: brokenBuildNum,
          });
          continue;
        }

        if (item.kind === 'deskIsland') {
          drawJoinedDeskIsland(ctx, item.island, {
            employees: emps,
            activeTasks,
            selectedEmployeeId: selEmpId,
            hoveredEmployeeId: hovEmpId,
            activeRoleFilter,
            doneTicketsCount,
            time,
            showIslandHeatmap: cfg.showIslandHeatmap,
            islandHeatStat: heatmapMap[item.island.id],
          });
          continue;
        }

        if (item.kind === 'extraSlot') {
          drawNhaThuocSeatedColleague3D(ctx, item.slot, time);
          continue;
        }

        if (item.kind === 'desk') {
          const desk = item.desk;
          const emp =
            emps.find((e) => e.id === desk.assignedEmployeeId) ||
            EMPLOYEE_BY_ID[desk.assignedEmployeeId];
          const isSelected = Boolean(emp && emp.id === selEmpId);
          const isHovered = Boolean(emp && emp.id === hovEmpId);
          const isTargetOfTransfer = activeTasks.some(
            (t) => t.toDeskId === desk.id && t.phase !== 'COMPLETED'
          );
          const isFilteredOut = Boolean(
            activeRoleFilter !== 'ALL' && emp && emp.role !== activeRoleFilter
          );

          drawDetailedIsoDesk(ctx, desk, emp, {
            isSelected,
            isHovered,
            isTargetOfTransfer,
            isFilteredOut,
            doneTicketsCount,
            time,
          });
          continue;
        }

        if (item.kind === 'employee') {
          const {
            emp,
            pos,
            activeTask,
            isWalking,
            isCarryingDocs,
            isoDirection,
            facingAngle,
            moveVec,
          } = item;
          const isFilteredOut =
            activeRoleFilter !== 'ALL' && emp.role !== activeRoleFilter;
          const isFocusedEventEmp = Boolean(
            (primaryTask && primaryTask.fromEmployeeId === emp.id) ||
              (activeBuild && activeBuild.employeeId === emp.id)
          );

          const carriedTicket = allTickets.find(
            (t) => t.id === (activeTask?.ticketId ?? emp.carryingTicketId)
          );
          const ticketKey =
            activeTask?.ticketKey || carriedTicket?.key || emp.carryingTicketId || 'FRT-DOC';
          const stackSize = Math.max(
            3,
            Math.min(6, activeTask?.documentStackSize ?? carriedTicket?.documentStackSize ?? 4)
          );
          const isDoneDoc =
            Boolean(activeTask?.isReturnToPM) ||
            activeTask?.targetStatus === 'DONE' ||
            carriedTicket?.status === 'DONE';
          const priority: TicketPriority =
            activeTask?.ticketPriority ?? carriedTicket?.priority ?? 'HIGH';

          drawDetailedIsoCharacter(ctx, emp, pos, {
            activeTask,
            isWalking,
            isCarryingDocs,
            isSelected: emp.id === selEmpId,
            isHovered: emp.id === hovEmpId,
            isFocusedEventEmp,
            isFilteredOut,
            showLabel: cfg.showEmployeeLabels,
            carriedTicketKey: ticketKey,
            stackSize,
            isDoneDoc,
            priority,
            time,
            isoDirection,
            facingAngle,
            moveVec,
          });

          const isEmpSelectedOrHovered = emp.id === selEmpId || emp.id === hovEmpId;
          const isHotfixRunner = Boolean(
            activeBuild?.isHotfixRescue &&
              activeBuild.employeeId === emp.id &&
              (activeBuild.phase === 'WALKING_TO_SERVER' ||
                activeBuild.phase === 'BUILDING_AT_SERVER')
          );

          if (isHotfixRunner && activeBuild) {
            activeEventOverlays.push({
              emp,
              pos,
              activeTask,
              isDoneDoc: false,
              ticketKey: activeBuild.ticketKey,
              speechText:
                activeBuild.phase === 'BUILDING_AT_SERVER'
                  ? '🛠 Fixing broken build -> Back to normal ✅'
                  : '🚨 Chạy gấp ra Trạm Server cứu Build Broken!',
              showSpeechBubble: true,
              isPrimaryFocus: true,
              isHotfixSprint: true,
              hotfixBuildNumber: activeBuild.buildNumber,
            });
          } else if (isCarryingDocs) {
            const toEmp = activeTask ? EMPLOYEE_BY_ID[activeTask.toEmployeeId] : undefined;
            activeEventOverlays.push({
              emp,
              pos,
              activeTask,
              isDoneDoc,
              ticketKey,
              speechText: activeTask ? getHandoffSpeechText(activeTask, toEmp) : undefined,
              // Chỉ hiển thị Speech Bubble cho nhân vật đang được Camera Focus (primary active event) hoặc nhân vật đang hover/click
              showSpeechBubble: Boolean(isFocusedEventEmp || isEmpSelectedOrHovered),
              isPrimaryFocus: isFocusedEventEmp,
            });
          }
        }
      }

      // ------------------------------------------------------------------------
      // 8. FLOATING ZONE CALLOUT BADGES KIỂU FLEZIMERCURIA (01..09 + BULLSEYE PIN)
      // ------------------------------------------------------------------------
      drawFlezimercuriaZoneCallouts(ctx);

      // ------------------------------------------------------------------------
      // 8B. HOLOGRAM JOBS BOARD FOR ALL 3 JENKINS SERVER CLUSTERS (`CI`, `UAT`, `RELEASE`)
      // ------------------------------------------------------------------------
      for (const station of JENKINS_SERVER_CLUSTERS) {
        const isThisClusterBuilding =
          activeBuild &&
          (activeBuild.serverDeskId === station.deskId || activeBuild.clusterId === station.id)
            ? activeBuild
            : null;
        const clusterRecentBuilds = recentBuilds.filter(
          (b) => !b.jobName || b.jobName === station.jobName
        );
        drawJenkinsServerHologramOverlay(ctx, station, {
          time,
          activeBuild: isThisClusterBuilding,
          recentBuilds: clusterRecentBuilds.length > 0 ? clusterRecentBuilds : recentBuilds,
          isHovered: isHoveredServer,
          isRecentlyCompleted: isRecentlyCompletedBuild,
          isBrokenAlert: station.id === JENKINS_SERVER_STATION.id ? isBrokenAlert : false,
          brokenBuildNumber: brokenBuildNum,
        });
      }

      // ------------------------------------------------------------------------
      // 9. SMART ANTI-OVERLAP `● WINA` DARK NAVY PILL BADGES OVER ACTIVE CHARACTERS
      // ------------------------------------------------------------------------
      const femaleMgr = emps.find((e) => e.id === FEMALE_MANAGER_ID || e.isFemaleManager);
      const labelObstacles: ScreenLabelRect[] = [];
      if (femaleMgr?.roamingSpeechText) {
        const mgrHeadIso = worldToIso(
          femaleMgr.currentPosition.x,
          femaleMgr.currentPosition.y,
          50.4
        );
        ctx.font = '700 7.6px Inter, system-ui, sans-serif';
        const sw = ctx.measureText(femaleMgr.roamingSpeechText).width + 18;
        labelObstacles.push({
          x: mgrHeadIso.x - sw / 2,
          y: mgrHeadIso.y - 30,
          w: sw,
          h: 36,
        });
      }
      drawNonOverlappingWinaEventPills(ctx, activeEventOverlays, labelObstacles);

      // ------------------------------------------------------------------------
      // 10. CELEBRATORY 3D CONFETTI, FLOATING HEARTS (THUNDM) & DONE BUBBLES
      // ------------------------------------------------------------------------
      if (femaleMgr && time - lastHeartSpawnRef.current > (femaleMgr.roamingPhase === 'CHEERING' ? 140 : 240)) {
        lastHeartSpawnRef.current = time;
        const mgrPos = femaleMgr.currentPosition;
        const targetDesk = femaleMgr.roamingTargetEmployeeId
          ? DESK_BY_EMPLOYEE_ID[femaleMgr.roamingTargetEmployeeId]
          : undefined;
        const heartColors = ['#e11d48', '#f43f5e', '#fb7185', '#ec4899'];
        const symbols = ['❤️', '💖', '💕', '✨'];

        // Tạo 1-2 trái tim bay từ Sếp ThuNDM về phía bàn nhân viên gần đó hoặc tỏa ra xung quanh
        const spawnCount = femaleMgr.roamingPhase === 'CHEERING' ? 2 : 1;
        for (let s = 0; s < spawnCount; s++) {
          let vx = (Math.random() - 0.5) * 0.7;
          let vy = (Math.random() - 0.5) * 0.7;
          if (targetDesk && s === 0) {
            const dx = targetDesk.seatPosition.x - mgrPos.x;
            const dy = targetDesk.seatPosition.y - mgrPos.y;
            const dist = Math.hypot(dx, dy) || 1;
            vx = (dx / dist) * 0.85 + (Math.random() - 0.5) * 0.25;
            vy = (dy / dist) * 0.85 + (Math.random() - 0.5) * 0.25;
          }
          heartParticlesRef.current.push({
            wx: mgrPos.x + (Math.random() - 0.5) * 10,
            wy: mgrPos.y + (Math.random() - 0.5) * 10,
            wz: 24 + Math.random() * 8,
            vx,
            vy,
            vz: 0.42 + Math.random() * 0.35,
            size: 3.4 + Math.random() * 1.8,
            color: heartColors[Math.floor(Math.random() * heartColors.length)],
            alpha: 1,
            symbol: symbols[Math.floor(Math.random() * symbols.length)],
          });
        }
      }

      const hearts = heartParticlesRef.current;
      for (let i = hearts.length - 1; i >= 0; i--) {
        const hp = hearts[i];
        hp.wx += hp.vx;
        hp.wy += hp.vy;
        hp.wz += hp.vz;
        hp.alpha -= 0.014;
        if (hp.alpha <= 0) {
          hearts.splice(i, 1);
          continue;
        }
        const hIso = worldToIso(hp.wx, hp.wy, hp.wz);
        ctx.save();
        ctx.globalAlpha = Math.max(0, hp.alpha);
        drawVectorHeart(ctx, hIso.x, hIso.y, hp.size, hp.color, '#fff1f2');
        if (hp.symbol === '✨') {
          ctx.font = '700 8px sans-serif';
          ctx.fillText('✨', hIso.x + 4, hIso.y - 2);
        }
        ctx.restore();
      }

      const confetti = confettiRef.current;
      for (let i = confetti.length - 1; i >= 0; i--) {
        const c = confetti[i];
        c.wx += c.vx;
        c.wy += c.vy;
        c.wz += c.vz;
        c.vz -= 0.18;
        c.alpha -= 0.015;
        c.rotation += 0.12;

        if (c.alpha <= 0 || c.wz < 0) {
          confetti.splice(i, 1);
          continue;
        }

        const cIso = worldToIso(c.wx, c.wy, c.wz);
        ctx.save();
        ctx.globalAlpha = Math.max(0, c.alpha);
        ctx.translate(cIso.x, cIso.y);
        ctx.rotate(c.rotation);
        ctx.fillStyle = c.color;
        ctx.fillRect(-c.size / 2, -c.size / 2, c.size, c.size * 0.65);
        ctx.restore();
      }

      const now = performance.now();
      const bubbles = speechBubblesRef.current;
      for (let i = bubbles.length - 1; i >= 0; i--) {
        const b = bubbles[i];
        const age = now - b.createdAt;
        if (age > 3400) {
          bubbles.splice(i, 1);
          continue;
        }
        const alpha = age > 2500 ? (3400 - age) / 900 : 1;
        const floatZ = 58 + (age / 3400) * 28;
        const bIso = worldToIso(b.wx, b.wy, floatZ);

        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.font = '800 10.5px Inter, system-ui, sans-serif';
        const bw = ctx.measureText(b.text).width + 24;
        drawRoundedRect(ctx, bIso.x - bw / 2, bIso.y - 13, bw, 26, 13);
        ctx.fillStyle = '#065f46';
        ctx.fill();
        ctx.strokeStyle = '#fde047';
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.fillStyle = '#fef08a';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(b.text, bIso.x, bIso.y);
        ctx.restore();
      }

      ctx.restore(); // End Isometric Camera Transform
      ctx.restore(); // End DPR Scale

      animationFrameId = requestAnimationFrame(renderFrame);
    };

    animationFrameId = requestAnimationFrame(renderFrame);
    return () => cancelAnimationFrame(animationFrameId);
  }, []);

  // Selected or Hovered Employee details for Inspector Panel
  const inspectedEmployee = useMemo(() => {
    const targetId = selectedEmpId ?? hoveredEmployeeId;
    if (!targetId) return null;
    return employees.find((e) => e.id === targetId) ?? EMPLOYEE_BY_ID[targetId] ?? null;
  }, [employees, selectedEmpId, hoveredEmployeeId]);

  const inspectedTickets = useMemo(() => {
    if (!inspectedEmployee) return [];
    return tickets.filter(
      (t) =>
        t.assigneeId === inspectedEmployee.id ||
        inspectedEmployee.assignedTicketIds.includes(t.id)
    );
  }, [tickets, inspectedEmployee]);

  const inspectedActiveTransfer = useMemo(() => {
    if (!inspectedEmployee) return null;
    return (
      currentTransfers.find(
        (t) =>
          (t.fromEmployeeId === inspectedEmployee.id ||
            t.toEmployeeId === inspectedEmployee.id) &&
          t.phase !== 'COMPLETED'
      ) ?? null
    );
  }, [currentTransfers, inspectedEmployee]);

  // Thông tin hiển thị trên thanh Flezimercuria LIVE Camera HUD & Mini Floating Pill
  // Xoay vòng 30 giây / Sếp khi không có Event: ThuNDM (30s) -> ToanLBK (30s) -> doannt19 (30s) -> vanltb8 (30s)
  const activeIdleBossIndex = Math.floor(bossCycleNow / 30000) % BOSS_ROTATION_IDS.length;
  const activeIdleBossId = BOSS_ROTATION_IDS[activeIdleBossIndex];
  const remainingBossSec = 30 - (Math.floor(bossCycleNow / 1000) % 30);

  const currentIdleBossEmp = useMemo(
    () =>
      employees.find((e) => e.id === activeIdleBossId) ??
      EMPLOYEE_BY_ID[activeIdleBossId] ??
      EMPLOYEE_BY_ID[FEMALE_MANAGER_ID],
    [employees, activeIdleBossId]
  );

  const focusedEventSummary = useMemo(() => {
    if (activeJenkinsBuild?.isHotfixRescue || isJenkinsBrokenAlert) {
      const bNum = brokenBuildNumber ?? activeJenkinsBuild?.buildNumber ?? 2843;
      const rescuer = activeJenkinsBuild?.employeeAccount ?? 'TienHK';
      if (activeJenkinsBuild?.phase === 'BUILDING_AT_SERVER') {
        return `🚨 HOTFIX RESCUE #${bNum} (${Math.round(activeJenkinsBuild.buildProgress)}%) — ${rescuer} đang sửa lỗi build tại Trạm Server!`;
      }
      return `🚨 BUILD BROKEN #${bNum}! ⚡ ${rescuer} đang chạy khẩn cấp (HOTFIX SPRINT) ra Trạm Server...`;
    }
    if (primaryActiveTransfer) {
      const fromEmp = EMPLOYEE_BY_ID[primaryActiveTransfer.fromEmployeeId];
      const toEmp = EMPLOYEE_BY_ID[primaryActiveTransfer.toEmployeeId];
      const fromSeat = fromEmp?.seatCode?.replace('FT3.III2A.', '') ?? '';
      const toSeat = toEmp?.seatCode?.replace('FT3.III2A.', '') ?? '';
      const isDone =
        primaryActiveTransfer.isReturnToPM || primaryActiveTransfer.targetStatus === 'DONE';
      return isDone
        ? `${fromEmp?.account ?? primaryActiveTransfer.fromEmployeeId} (${fromSeat}) ➔ 👑 DongNQ6 (1.289) [${primaryActiveTransfer.ticketKey} DONE]`
        : `${fromEmp?.account ?? primaryActiveTransfer.fromEmployeeId} (${fromSeat}) ➔ ${toEmp?.account ?? primaryActiveTransfer.toEmployeeId} (${toSeat}) [${primaryActiveTransfer.ticketKey}]`;
    }
    if (activeJenkinsBuild) {
      if (activeJenkinsBuild.phase === 'BUILDING_AT_SERVER') {
        return `⚙️ Build Jenkins #${activeJenkinsBuild.buildNumber} ${activeJenkinsBuild.jobName} (${Math.round(activeJenkinsBuild.buildProgress)}%) — by ${activeJenkinsBuild.employeeAccount} [${activeJenkinsBuild.ticketKey}]`;
      }
      return `⚙️ ${activeJenkinsBuild.employeeAccount} đang đi tới Trạm Server chạy Build Jenkins #${activeJenkinsBuild.buildNumber} ${activeJenkinsBuild.jobName} [${activeJenkinsBuild.ticketKey}]`;
    }
    const moodEmoji =
      currentIdleBossEmp?.managerMood === 'angry'
        ? '💢😡 (1.5x)'
        : currentIdleBossEmp?.managerMood === 'happy'
          ? '😄✨'
          : currentIdleBossEmp?.managerMood === 'worried'
            ? '😰💧'
            : '❤️💖';
    return `🎥 Auto-Focus Sếp (còn ${remainingBossSec}s): 👑 ${currentIdleBossEmp?.account ?? 'ThuNDM'} ${moodEmoji} — ${currentIdleBossEmp?.roamingSpeechText ?? 'Đang đi tuần tra phòng'}`;
  }, [
    primaryActiveTransfer,
    activeJenkinsBuild,
    currentIdleBossEmp,
    remainingBossSec,
    isJenkinsBrokenAlert,
    brokenBuildNumber,
  ]);

  const toggleGrid = () => {
    const next = !localShowGrid;
    setLocalShowGrid(next);
    onUpdateConfig?.({ showGrid: next });
  };

  const toggleWaypoints = () => {
    const next = !localShowWaypoints;
    setLocalShowWaypoints(next);
    onUpdateConfig?.({ showWaypoints: next });
  };

  const togglePaths = () => {
    const next = !localShowActivePaths;
    setLocalShowActivePaths(next);
    onUpdateConfig?.({ showActivePaths: next, showPaths: next });
  };

  const toggleLabels = () => {
    const next = !localShowLabels;
    setLocalShowLabels(next);
    onUpdateConfig?.({ showEmployeeLabels: next });
  };

  const toggleIslandHeatmap = () => {
    const next = !localShowIslandHeatmap;
    setLocalShowIslandHeatmap(next);
    onUpdateConfig?.({ showIslandHeatmap: next });
  };

  const toggleMvpPodium = () => {
    const next = !localShowMvpPodium;
    setLocalShowMvpPodium(next);
    onUpdateConfig?.({ showMvpPodium: next });
  };

  return (
    <div
      ref={containerRef}
      className={`relative flex flex-col w-full h-full bg-[#f4f6fa] overflow-hidden select-none ${className}`}
    >
      {/* Sprint Rush Banner */}
      {rushActive && !isHudHidden && (
        <div className="z-20 bg-gradient-to-r from-orange-600/95 via-red-600/95 to-amber-600/95 text-white text-xs font-bold py-1.5 px-4 text-center tracking-wider uppercase shadow-lg animate-pulse">
          🔥 SPRINT DEMO RUSH ĐANG BẬT — TOÀN BỘ 30 KỸ SƯ TĂNG TỐC BÀN GIAO HỒ SƠ VỀ BÀN PM! ⚡
        </div>
      )}

      {/* Interactive Isometric 2.5D Canvas Viewport — 100% Full Screen Edge-to-Edge */}
      <div
        className={`relative flex-1 w-full h-full overflow-hidden bg-[#f4f6fa] ${
          isDragging
            ? 'cursor-grabbing'
            : hoveredEmployeeId || hoveredJenkinsServer
              ? 'cursor-pointer'
              : 'cursor-grab'
        }`}
        onMouseMove={handleMouseMove}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
      >
        <canvas
          ref={canvasRef}
          className="block w-full h-full"
        />

        {/* ====================================================================
            CHẾ ĐỘ MẶC ĐỊNH ẨN ADVANCE HUD (`isHudHidden === true`):
            HIỂN THỊ MINI FLOATING PILL GỌN GÀNG Ở GÓC TRÊN PHẢI:
            - Công tắc 2 Chế Độ: 🟢 Thật (LIVE) | 🧪 Mock (Không cho user tự set credential)
            - Nút ⛶ Toàn màn hình (Fullscreen)
            - Nút 🎛️ Tùy chỉnh (Advance HUD)
        ==================================================================== */}
        {isHudHidden ? (
          <div className="absolute top-3 right-3 z-30 flex items-center gap-2 bg-slate-950/90 border border-slate-700/80 rounded-full px-3 py-1.5 backdrop-blur-md shadow-2xl text-slate-100 pointer-events-auto">
            {/* 2-Mode Switch: Thật (LIVE) vs Mock */}
            <div className="flex items-center bg-slate-900 p-0.5 rounded-full border border-slate-700/90 shrink-0">
              <button
                type="button"
                onClick={() => onSetDataSourceMode?.('LIVE_FRT')}
                className={`px-2.5 py-0.5 rounded-full text-[11px] font-extrabold transition flex items-center gap-1 ${
                  dataSourceMode === 'LIVE_FRT'
                    ? 'bg-emerald-500 text-slate-950 shadow-sm shadow-emerald-500/40'
                    : 'text-slate-400 hover:text-white'
                }`}
                title="Chế độ Dữ liệu Thật từ Server Proxy (Jira & Jenkins)"
              >
                <span>🟢 Thật</span>
              </button>
              <button
                type="button"
                onClick={() => onSetDataSourceMode?.('MOCK_PILOT')}
                className={`px-2.5 py-0.5 rounded-full text-[11px] font-extrabold transition flex items-center gap-1 ${
                  dataSourceMode === 'MOCK_PILOT'
                    ? 'bg-amber-500 text-slate-950 shadow-sm shadow-amber-500/40'
                    : 'text-slate-400 hover:text-white'
                }`}
                title="Chế độ Giả lập (Mock Pilot)"
              >
                <span>🧪 Mock</span>
              </button>
            </div>

            <span className="text-xs font-semibold text-white truncate max-w-[280px] hidden sm:inline">
              {focusedEventSummary}
            </span>

            <div className="h-3.5 w-px bg-slate-700 mx-0.5" />

            {onToggleFullscreen && (
              <button
                type="button"
                onClick={onToggleFullscreen}
                className="px-2.5 py-1 rounded-full text-[11px] font-extrabold bg-sky-500/20 hover:bg-sky-500/30 text-sky-300 border border-sky-400/50 transition shrink-0 flex items-center gap-1"
                title="Bật/Tắt Toàn màn hình Fullscreen (Phím tắt F)"
              >
                <span>⛶ {isFullscreen ? 'Thoát Full' : 'Toàn màn hình'}</span>
              </button>
            )}

            {onToggleHud && (
              <button
                type="button"
                onClick={onToggleHud}
                className="px-2.5 py-1 rounded-full text-[11px] font-extrabold bg-slate-800 hover:bg-slate-700 text-amber-300 border border-amber-400/40 transition shrink-0 flex items-center gap-1"
                title="Mở bảng Tùy chỉnh Advance HUD (Phím tắt H)"
              >
                <span>🎛️ Tùy chỉnh</span>
              </button>
            )}
          </div>
        ) : (
          /* ====================================================================
              CHẾ ĐỘ ADVANCE HUD (KHI NGƯỜI DÙNG BẤM 🎛️ TÙY CHỈNH / PHÍM H)
          ==================================================================== */
          <div className="absolute top-3 right-3 z-20 flex flex-col items-end gap-2 max-w-md pointer-events-auto">
            <div className="bg-slate-900/90 border border-slate-700/80 rounded-xl px-3.5 py-2.5 backdrop-blur-md shadow-xl text-slate-100">
              <div className="flex items-center justify-between gap-3 text-[11px] font-mono tracking-wider uppercase text-slate-300">
                <div className="flex items-center gap-2">
                  <span
                    className={`inline-block w-2.5 h-2.5 rounded-full animate-ping ${
                      primaryActiveTransfer
                        ? 'bg-orange-500'
                        : activeJenkinsBuild
                          ? 'bg-sky-400'
                          : 'bg-rose-500'
                    }`}
                  />
                  <span
                    className={`inline-block w-2.5 h-2.5 rounded-full -ml-4 ${
                      primaryActiveTransfer
                        ? 'bg-orange-500'
                        : activeJenkinsBuild
                          ? 'bg-sky-400'
                          : 'bg-rose-500'
                    }`}
                  />
                  <span className="font-bold text-white">LIVE</span>
                  <span className="text-slate-500">·</span>
                  {primaryActiveTransfer ? (
                    <span className="text-orange-300 font-semibold">
                      AUTO-FOCUS EVENT CAMERA
                    </span>
                  ) : activeJenkinsBuild ? (
                    <span className="text-sky-300 font-semibold normal-case tracking-normal">
                      ⚙️ JENKINS BUILD · #{activeJenkinsBuild.buildNumber} {activeJenkinsBuild.jobName}
                    </span>
                  ) : (
                    <span className="text-rose-300 font-semibold normal-case tracking-normal">
                      🎥 Auto-Focus Sếp (còn {remainingBossSec}s): 👑 {currentIdleBossEmp?.account ?? 'ThuNDM'}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <span className="px-1.5 py-0.5 rounded bg-slate-800 text-[10px] text-sky-300 font-bold">
                    ISO 2.5D · {hudZoomPercent}%
                  </span>
                </div>
              </div>

              <div className="mt-1.5 text-xs font-semibold text-white truncate max-w-[410px]">
                {focusedEventSummary}
              </div>

              {/* Camera & Jenkins Server Action Buttons */}
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                {/* 2-Mode Switch: Thật vs Mock */}
                <div className="flex items-center bg-slate-950 p-0.5 rounded-lg border border-slate-700">
                  <button
                    type="button"
                    onClick={() => onSetDataSourceMode?.('LIVE_FRT')}
                    className={`px-2.5 py-0.5 rounded-md text-xs font-extrabold transition ${
                      dataSourceMode === 'LIVE_FRT'
                        ? 'bg-emerald-500 text-slate-950 shadow-sm'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    🟢 Thật
                  </button>
                  <button
                    type="button"
                    onClick={() => onSetDataSourceMode?.('MOCK_PILOT')}
                    className={`px-2.5 py-0.5 rounded-md text-xs font-extrabold transition ${
                      dataSourceMode === 'MOCK_PILOT'
                        ? 'bg-amber-500 text-slate-950 shadow-sm'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    🧪 Mock
                  </button>
                </div>

                <button
                  type="button"
                  onClick={focusJenkinsServerCamera}
                  className="px-2.5 py-1 rounded-lg text-xs font-extrabold transition flex items-center gap-1 border bg-sky-600 hover:bg-sky-500 text-white border-sky-400 shadow-sm shadow-sky-500/30"
                  title="Zoom thẳng tới Trạm Máy Tính Server Jenkins (oneclickv4-build-ci)"
                >
                  <span>🖥️ Focus Jenkins Server</span>
                </button>

                {onTriggerJenkinsBuild && (
                  <button
                    type="button"
                    onClick={onTriggerJenkinsBuild}
                    className="px-2.5 py-1 rounded-lg text-xs font-extrabold transition flex items-center gap-1 border bg-indigo-600 hover:bg-indigo-500 text-white border-indigo-400 shadow-sm shadow-indigo-500/30"
                    title="Cử kỹ sư đi bộ lại Trạm Máy Tính Server để chạy Build Jenkins (oneclickv4-build-ci)"
                  >
                    <span>🚀 Build CI</span>
                  </button>
                )}

                {onTriggerUatBuild && (
                  <button
                    type="button"
                    onClick={onTriggerUatBuild}
                    className="px-2.5 py-1 rounded-lg text-xs font-extrabold transition flex items-center gap-1 border bg-purple-600 hover:bg-purple-500 text-white border-purple-400 shadow-sm shadow-purple-500/30"
                    title="Cử kỹ sư đi bộ lại Trạm Server UAT để chạy Build Jenkins (oneclickv4-build-uat)"
                  >
                    <span>🟣 Build UAT</span>
                  </button>
                )}

                {onResetNewDay && (
                  <button
                    type="button"
                    onClick={onResetNewDay}
                    className="px-2.5 py-1 rounded-lg text-xs font-extrabold transition flex items-center gap-1 border bg-teal-600 hover:bg-teal-500 text-white border-teal-400 shadow-sm"
                    title="Reset Ngày Mới — Làm trống 100% bàn làm việc"
                  >
                    <span>🌅 Reset Ngày Mới ({checkedInCount ?? 0} ngồi)</span>
                  </button>
                )}

                {onTriggerTestFullSeatsSmoking && (
                  <button
                    type="button"
                    onClick={onTriggerTestFullSeatsSmoking}
                    className="px-2.5 py-1 rounded-lg text-xs font-extrabold transition flex items-center gap-1 border bg-amber-600 hover:bg-amber-500 text-white border-amber-400 shadow-sm"
                    title="Test Kịch bản Full Chỗ Ngồi — Thành viên đến sau ra Giếng trời hút thuốc (🚬 💨)"
                  >
                    <span>🚬 Test Full Chỗ ({smokingCount ?? 0} hút thuốc)</span>
                  </button>
                )}

                {onTriggerTestInactivityCheckout && (
                  <button
                    type="button"
                    onClick={onTriggerTestInactivityCheckout}
                    className="px-2.5 py-1 rounded-lg text-xs font-extrabold transition flex items-center gap-1 border bg-orange-600 hover:bg-orange-500 text-white border-orange-400 shadow-sm"
                    title="Test nhanh Quy tắc 2h Không Có Event Mới — 1–2 nhân viên đứng dậy rời bàn, đi ra 🚪 CỬA RA VÀO về nhà và nhường lại ghế trống!"
                  >
                    <span>🏠 Test 2h Không Event (Đi Về)</span>
                  </button>
                )}

                {onTriggerJenkinsBrokenHotfix && (
                  <button
                    type="button"
                    onClick={() => {
                      onTriggerJenkinsBrokenHotfix();
                      setAutoFollowEvent(true);
                      setIsFreeCamera(false);
                    }}
                    className={`px-2.5 py-1 rounded-lg text-xs font-extrabold transition flex items-center gap-1 border shadow-sm ${
                      isJenkinsBrokenAlert
                        ? 'bg-red-600 text-yellow-200 border-yellow-300 shadow-red-500/40 animate-pulse'
                        : 'bg-red-700/90 hover:bg-red-600 text-white border-red-400 shadow-red-600/30'
                    }`}
                    title="Giả lập sự kiện Jenkins Build Broken #2843 & cử kỹ sư chạy nhanh (⚡ HOTFIX SPRINT) ra Trạm Server cứu build"
                  >
                    <span>🚨 Giả lập Build Broken / Hotfix</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={toggleIslandHeatmap}
                  className={`px-2.5 py-1 rounded-lg text-xs font-extrabold transition flex items-center gap-1 border ${
                    localShowIslandHeatmap
                      ? 'bg-amber-500 text-slate-950 border-amber-300 shadow-sm shadow-amber-500/30'
                      : 'bg-slate-800 hover:bg-slate-700 text-amber-300 border-amber-500/40'
                  }`}
                  title="Bật/Tắt Bản Đồ Nhiệt 9 Cụm Bàn (Island Activity Heatmap)"
                >
                  <span>🔥 Heatmap Cụm Bàn</span>
                </button>

                <button
                  type="button"
                  onClick={toggleMvpPodium}
                  className={`px-2.5 py-1 rounded-lg text-xs font-extrabold transition flex items-center gap-1 border ${
                    localShowMvpPodium
                      ? 'bg-yellow-500 text-slate-950 border-yellow-300 shadow-sm shadow-yellow-500/30'
                      : 'bg-slate-800 hover:bg-slate-700 text-yellow-300 border-yellow-500/40'
                  }`}
                  title="Bật/Tắt Bảng Vinh Danh Top 3 Chiến Thần Giao Việc & Build CI"
                >
                  <span>🏆 Top MVP</span>
                </button>

                <button
                  type="button"
                  onClick={() => focusManagerCamera()}
                  className="px-2.5 py-1 rounded-lg text-xs font-extrabold transition flex items-center gap-1 border bg-rose-600 hover:bg-rose-500 text-white border-rose-400 shadow-sm shadow-rose-500/30"
                  title="Bay thẳng tới Sếp đang trong chu kỳ Auto-Focus 30s"
                >
                  <span>👑 Focus Sếp ({currentIdleBossEmp?.account ?? 'ThuNDM'})</span>
                </button>

                <button
                  type="button"
                  onClick={focusNhaThuocBayCamera}
                  className="px-2.5 py-1 rounded-lg text-xs font-extrabold transition flex items-center gap-1 border bg-emerald-600 hover:bg-emerald-500 text-white border-emerald-400 shadow-sm shadow-emerald-500/30"
                  title="Zoom thẳng vào Khoang NHÀ THUỐC (FT3.III2A.1)"
                >
                  <span>🏥 Khoang NHÀ THUỐC</span>
                </button>

                <button
                  type="button"
                  onClick={toggleAutoFollowCamera}
                  className={`px-2.5 py-1 rounded-lg text-xs font-bold transition flex items-center gap-1 border ${
                    autoFollowEvent && !isFreeCamera
                      ? 'bg-orange-500 text-white border-orange-400 shadow-sm shadow-orange-500/30'
                      : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
                  }`}
                >
                  <span>🎥 Auto-Focus ({autoFollowEvent && !isFreeCamera ? 'ON' : 'OFF'})</span>
                </button>

                <button
                  type="button"
                  onClick={switchToOverviewCamera}
                  className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition border ${
                    !autoFollowEvent || (isFreeCamera && hudZoomPercent <= 95)
                      ? 'bg-sky-500/20 text-sky-300 border-sky-500/50'
                      : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
                  }`}
                >
                  🗺️ Toàn cảnh
                </button>

                {onToggleHud && (
                  <button
                    type="button"
                    onClick={onToggleHud}
                    className="px-2.5 py-1 rounded-lg text-xs font-bold transition border bg-slate-800 hover:bg-slate-700 text-amber-300 border-amber-500/40"
                    title="Ẩn toàn bộ HUD, chỉ hiện Mini Floating Pill (Phím tắt H)"
                  >
                    👁️ Ẩn HUD (H)
                  </button>
                )}

                {onToggleFullscreen && (
                  <button
                    type="button"
                    onClick={onToggleFullscreen}
                    className="px-2.5 py-1 rounded-lg text-xs font-bold transition border bg-slate-800 hover:bg-slate-700 text-sky-300 border-sky-500/40"
                    title="Chế độ Toàn màn hình Fullscreen (Phím tắt F)"
                  >
                    ⛶ Fullscreen (F)
                  </button>
                )}

                {isFreeCamera && (
                  <button
                    type="button"
                    onClick={() => activateAutoFocusEventCamera()}
                    className="px-2.5 py-1 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-extrabold transition shadow-md shadow-emerald-500/30 animate-bounce"
                  >
                    🎯 Quay lại Focus sự kiện
                  </button>
                )}
              </div>

              {/* Active Event Chips (Click to fly camera directly to that character) */}
              {currentTransfers.length > 0 && (
                <div className="mt-2 pt-2 border-t border-slate-800/90 flex flex-wrap gap-1.5">
                  {currentTransfers.slice(0, 4).map((t) => {
                    const fromEmp = EMPLOYEE_BY_ID[t.fromEmployeeId];
                    const toEmp = EMPLOYEE_BY_ID[t.toEmployeeId];
                    const fromSeat = fromEmp?.seatCode?.replace('FT3.III2A.', '') ?? '';
                    const toSeat = toEmp?.seatCode?.replace('FT3.III2A.', '') ?? '';
                    const isDone = t.isReturnToPM || t.targetStatus === 'DONE';
                    const isFocused = primaryActiveTransfer?.id === t.id && !isFreeCamera;
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => activateAutoFocusEventCamera(t.id)}
                        className={`px-2 py-1 rounded-full text-[11px] font-bold transition flex items-center gap-1.5 border ${
                          isFocused
                            ? isDone
                              ? 'bg-emerald-950/95 text-emerald-200 border-emerald-400 ring-2 ring-emerald-500/30'
                              : 'bg-slate-950 text-white border-orange-400 ring-2 ring-orange-500/30'
                            : 'bg-slate-950/80 text-slate-300 border-slate-700 hover:border-slate-500'
                        }`}
                      >
                        <span
                          className={`w-2 h-2 rounded-full ${
                            isDone ? 'bg-emerald-400' : 'bg-orange-400'
                          }`}
                        />
                        <span>
                          {fromEmp?.account ?? t.fromEmployeeId}
                          {fromSeat ? ` (${fromSeat})` : ''} ➔{' '}
                          {isDone
                            ? 'DongNQ6 (1.289)'
                            : `${toEmp?.account ?? t.toEmployeeId}${toSeat ? ` (${toSeat})` : ''}`}
                        </span>
                        <span className="font-mono text-[10px] text-amber-300">[{t.ticketKey}]</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* MINI MVP PODIUM: Bảng Vinh Danh Top 3 Chiến Thần Giao Việc & Build CI */}
            {localShowMvpPodium && mvpLeaderboard.length > 0 && (
              <div className="w-full max-w-md bg-slate-950/92 border border-amber-500/45 rounded-xl px-3 py-2 shadow-xl backdrop-blur-md text-slate-100">
                <div className="flex items-center justify-between gap-2 pb-1.5 border-b border-slate-800">
                  <div className="flex items-center gap-1.5 text-[11px] font-extrabold text-amber-300 tracking-wide uppercase">
                    <span>🏆 Top 3 Chiến Thần Giao Việc & Build CI</span>
                  </div>
                  <span className="text-[10px] font-mono text-slate-400">
                    Click để Focus Camera
                  </span>
                </div>
                <div className="mt-1.5 grid grid-cols-3 gap-1.5">
                  {mvpLeaderboard.slice(0, 3).map((mvp) => {
                    const rankBadge =
                      mvp.rank === 1 ? '🥇 #1' : mvp.rank === 2 ? '🥈 #2' : '🥉 #3';
                    const cardStyle =
                      mvp.rank === 1
                        ? 'bg-amber-950/60 border-yellow-400/70 hover:border-yellow-300'
                        : mvp.rank === 2
                        ? 'bg-sky-950/50 border-sky-400/60 hover:border-sky-300'
                        : 'bg-emerald-950/50 border-emerald-400/60 hover:border-emerald-300';
                    const targetEmp =
                      employees.find((e) => e.id === mvp.employeeId) ||
                      EMPLOYEE_BY_ID[mvp.employeeId];
                    return (
                      <button
                        key={mvp.employeeId}
                        type="button"
                        onClick={() => {
                          if (targetEmp) {
                            handleSelectEmployee(targetEmp);
                          }
                        }}
                        className={`flex flex-col items-start p-2 rounded-lg border transition text-left ${cardStyle}`}
                        title={`Click để bay Camera tới bàn ${mvp.account} (${mvp.seatCode})`}
                      >
                        <div className="flex items-center justify-between w-full gap-1">
                          <span className="text-[10px] font-extrabold text-amber-300">
                            {rankBadge}
                          </span>
                          <span className="text-[10px] font-mono font-bold text-orange-300">
                            🔥x{mvp.streak}
                          </span>
                        </div>
                        <div className="mt-0.5 text-xs font-extrabold text-white truncate w-full">
                          {mvp.account} ⭐
                        </div>
                        <div className="text-[10px] text-slate-400 font-mono truncate w-full">
                          {mvp.islandId?.replace('ISLAND-', 'Cụm ') ?? 'Nhà Thuốc'} ·{' '}
                          {mvp.transfersCount}Giao · {mvp.jenkinsBuildsCount}CI
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Employee & Desk Inspector Card (Below Camera HUD when an employee is clicked or hovered) */}
            {inspectedEmployee && (
              <div className="w-80 bg-slate-900/95 border border-slate-700 rounded-xl p-3.5 shadow-2xl backdrop-blur-md text-slate-100">
                <div className="flex items-start justify-between gap-2 pb-2.5 border-b border-slate-800">
                  <div className="flex items-center gap-2.5">
                    <div
                      className="w-10 h-10 rounded-full flex items-center justify-center font-extrabold text-sm text-white shadow-md shrink-0 border-2"
                      style={{
                        backgroundColor: inspectedEmployee.avatarColor,
                        borderColor: inspectedEmployee.isProjectManager ? '#fde047' : '#1e293b',
                      }}
                    >
                      {inspectedEmployee.initials}
                    </div>
                    <div>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <h4 className="font-bold text-sm text-white leading-tight">
                          {inspectedEmployee.account || inspectedEmployee.name}
                        </h4>
                        {inspectedEmployee.seatCode && (
                          <span className="text-[10px] font-mono font-extrabold px-1.5 py-0.5 rounded bg-red-950/90 text-orange-300 border border-red-500/60">
                            {inspectedEmployee.seatCode}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {inspectedEmployee.title} • {inspectedEmployee.islandId || 'NHÀ THUỐC'}
                      </p>
                    </div>
                  </div>
                  {selectedEmpId && (
                    <button
                      type="button"
                      onClick={() => handleSelectEmployee(null)}
                      className="text-slate-400 hover:text-white text-xs px-1.5 py-0.5 rounded bg-slate-800"
                    >
                      ✕
                    </button>
                  )}
                </div>

                {/* SeatCode & Account Highlight Banner */}
                <div className="grid grid-cols-2 gap-2 my-2.5 text-xs">
                  <div className="bg-slate-950/90 p-2 rounded-lg border border-red-500/40">
                    <span className="text-[10px] text-slate-400 block">Mã chỗ ngồi (SeatCode)</span>
                    <span className="font-mono font-extrabold text-orange-400 truncate block">
                      {inspectedEmployee.seatCode ?? 'FT3.III2A.1.xxx'}
                    </span>
                  </div>
                  <div className="bg-slate-950/90 p-2 rounded-lg border border-emerald-500/40">
                    <span className="text-[10px] text-slate-400 block">Account / Trạng thái</span>
                    <span className="font-bold text-emerald-400 truncate block">
                      {inspectedEmployee.account ?? inspectedEmployee.code} •{' '}
                      {inspectedActiveTransfer
                        ? `Bê ${inspectedActiveTransfer.ticketKey}`
                        : inspectedEmployee.status === 'WORKING'
                        ? 'Working'
                        : 'Ready'}
                    </span>
                  </div>
                </div>

                <div className="flex items-center justify-between text-xs text-slate-300 bg-slate-950/60 px-2.5 py-1.5 rounded-lg border border-slate-800/70 mb-2.5">
                  <span>
                    📚 Hồ sơ trên bàn: <strong>{inspectedEmployee.deskDocumentCount}</strong>
                  </span>
                  <span>
                    🤝 Đã giao: <strong>{inspectedEmployee.completedTransfersCount}</strong> lượt
                  </span>
                </div>

                {/* Active Tickets held by this employee */}
                <div className="space-y-1.5">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                    Jira Tickets đang phụ trách ({inspectedTickets.length})
                  </div>
                  {inspectedTickets.length === 0 ? (
                    <p className="text-xs text-slate-500 italic py-1">
                      Hiện không giữ ticket nào trên bàn.
                    </p>
                  ) : (
                    <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                      {inspectedTickets.map((ticket) => (
                        <div
                          key={ticket.id}
                          className="p-2 rounded-lg bg-slate-950 border border-slate-800 text-xs space-y-1.5"
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-mono font-bold text-sky-400">{ticket.key}</span>
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-amber-300 font-semibold">
                              {STATUS_LABELS[ticket.status]}
                            </span>
                          </div>
                          <p className="text-slate-200 line-clamp-1 font-medium">{ticket.summary}</p>
                          {ticket.status !== 'DONE' && (
                            <div className="flex items-center gap-1.5 pt-1">
                              {onAdvanceTicket && (
                                <button
                                  type="button"
                                  onClick={() => onAdvanceTicket(ticket.id)}
                                  className="flex-1 py-1 px-2 rounded bg-sky-600 hover:bg-sky-500 text-white font-semibold text-[11px] transition"
                                >
                                  Bước tiếp ➔
                                </button>
                              )}
                              {onReturnToPM && (
                                <button
                                  type="button"
                                  onClick={() => onReturnToPM(ticket.id)}
                                  className="py-1 px-2 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-[11px] transition"
                                  title="Hoàn thành ngay và mang hồ sơ về bàn PM DongNQ6 (FT3.III2A.1.289)"
                                >
                                  Báo DONE về PM 🎉
                                </button>
                              )}
                            </div>
                          )}
                          {onManualTransfer && ticket.status !== 'DONE' && (
                            <div className="flex items-center gap-1 pt-1 border-t border-slate-800/80">
                              <select
                                value={manualTargetEmpId}
                                onChange={(e) => setManualTargetEmpId(e.target.value)}
                                className="flex-1 bg-slate-900 border border-slate-700 rounded px-1.5 py-0.5 text-[11px] text-slate-200"
                              >
                                {employees
                                  .filter((e) => e.id !== inspectedEmployee.id)
                                  .map((e) => (
                                    <option key={e.id} value={e.id}>
                                      [{e.seatCode?.replace('FT3.III2A.', '') ?? e.deskId}] {e.account ?? e.displayName} ({ROLE_METADATA[e.role].shortLabel})
                                    </option>
                                  ))}
                              </select>
                              <button
                                type="button"
                                onClick={() =>
                                  onManualTransfer(
                                    ticket.id,
                                    inspectedEmployee.id,
                                    manualTargetEmpId,
                                    ticket.status
                                  )
                                }
                                className="px-2 py-0.5 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-semibold"
                              >
                                Giao
                              </button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default OfficeCanvas2D;
