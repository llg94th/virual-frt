import {
  ActiveJenkinsBuildTask,
  DeskPosition,
  Direction,
  DocumentTransferTask,
  Employee,
  IslandHeatmapStat,
  IsoDirection,
  JenkinsBuildJobItem,
  JenkinsServerStation,
  NhaThuocSeatSlot,
  Point2D,
  TicketPriority,
} from '../types/office';
import { EMPLOYEE_BY_ID, ROLE_METADATA } from '../data/employees';
import {
  ALL_JOINED_DESK_ISLANDS,
  ALL_OFFICE_SEAT_SLOTS,
  BUILDING_FOOTPRINT_POLYGON,
  BUILDING_SERVICE_CORES,
  COURTYARD_ATRIUMS,
  CourtyardAtrium,
  DESK_BY_EMPLOYEE_ID,
  DESK_BY_ID,
  EXTRA_WING_ISLANDS,
  NHA_THUOC_BAY_BOUNDS,
  NHA_THUOC_ISLANDS,
  NHA_THUOC_SEAT_SLOTS,
  NhaThuocIslandMeta,
} from '../data/officeLayout';

export type { IsoDirection };

// ============================================================================
// 1. ISOMETRIC 2.5D PROJECTION CONSTANTS & MATH
// ============================================================================

export const WORLD_CENTER_X = 820;
export const WORLD_CENTER_Y = 490;
export const ISO_ORIGIN_X = 820;
export const ISO_ORIGIN_Y = 485;
export const WORLD_SCALE_X = 0.96;
export const WORLD_SCALE_Y = 1.36;
export const ISO_COS = 0.86;
export const ISO_SIN = 0.45;

export const OVERVIEW_ZOOM = 0.65;
export const EVENT_FOCUS_ZOOM = 1.48;
/** Mức Zoom mặc định (~152%) khi Camera tự động đi theo Sếp nữ ThuNDM lúc không có Event bàn giao hồ sơ */
export const MANAGER_FOCUS_ZOOM = 1.52;

export interface IsoSubRect {
  wx: number;
  wy: number;
  ww: number;
  wh: number;
}

export interface IsoArchitecturalZone {
  id: string;
  num: string;
  title: string;
  code: string;
  subtitle: string;
  wx: number;
  wy: number;
  ww: number;
  wh: number;
  /** Nếu khoang phòng có hình chữ L hoặc gồm nhiều khoang trắng ghép lại (như trong bản vẽ CAD) */
  subBays?: IsoSubRect[];
  rimColor: string;
  wallAccent: string;
  floorTileA: string;
  floorTileB: string;
  badgeColor: string;
  pinAnchor?: { wx: number; wy: number; height: number };
}

export const PRIORITY_COLORS: Record<TicketPriority, { cover: string; edge: string; glow: string }> = {
  LOW: { cover: '#0284c7', edge: '#bae6fd', glow: 'rgba(2, 132, 199, 0.35)' },
  MEDIUM: { cover: '#2563eb', edge: '#bfdbfe', glow: 'rgba(37, 99, 235, 0.45)' },
  HIGH: { cover: '#ea580c', edge: '#fed7aa', glow: 'rgba(234, 88, 12, 0.55)' },
  CRITICAL: { cover: '#dc2626', edge: '#fecaca', glow: 'rgba(220, 38, 38, 0.7)' },
};

/** Chuyển đổi tọa độ mặt bằng 2D (wx, wy, wz) sang tọa độ màn hình Isometric 2.5D */
export function worldToIso(wx: number, wy: number, wz = 0): Point2D {
  const ux = (wx - WORLD_CENTER_X) * WORLD_SCALE_X;
  const uy = (wy - WORLD_CENTER_Y) * WORLD_SCALE_Y;
  return {
    x: ISO_ORIGIN_X + (ux - uy) * ISO_COS,
    y: ISO_ORIGIN_Y + (ux + uy) * ISO_SIN - wz,
  };
}

/** Chuyển đổi ngược từ tọa độ Isometric 2.5D (ở mặt sàn wz = 0) về tọa độ thế giới (wx, wy) */
export function isoToWorld(isoX: number, isoY: number): Point2D {
  const dx = (isoX - ISO_ORIGIN_X) / ISO_COS;
  const dy = (isoY - ISO_ORIGIN_Y) / ISO_SIN;
  const ux = 0.5 * (dx + dy);
  const uy = 0.5 * (dy - dx);
  return {
    x: WORLD_CENTER_X + ux / WORLD_SCALE_X,
    y: WORLD_CENTER_Y + uy / WORLD_SCALE_Y,
  };
}

/** Chuyển đổi vector vận tốc/độ dời từ tọa độ thế giới (dwx, dwy) sang mặt phẳng màn hình Isometric (dIsoX, dIsoY) */
export function worldVecToIsoVec(dwx: number, dwy: number): Point2D {
  const dux = dwx * WORLD_SCALE_X;
  const duy = dwy * WORLD_SCALE_Y;
  return {
    x: (dux - duy) * ISO_COS,
    y: (dux + duy) * ISO_SIN,
  };
}

/** Quy đổi hướng 2D ('RIGHT' | 'DOWN' | 'UP' | 'LEFT') sang hướng Isometric 3/4 ('SE' | 'SW' | 'NE' | 'NW') */
export function directionToIso(dir: Direction): IsoDirection {
  switch (dir) {
    case 'RIGHT':
      return 'SE'; // Đi xuống-phải trên màn hình (Front-Right 3/4)
    case 'DOWN':
      return 'SW'; // Đi xuống-trái trên màn hình (Front-Left 3/4)
    case 'UP':
      return 'NE'; // Đi lên-phải trên màn hình (Back-Right 3/4)
    case 'LEFT':
      return 'NW'; // Đi lên-trái trên màn hình (Back-Left 3/4)
    default:
      return 'SW';
  }
}

/** Phân loại vector độ dời thế giới (dwx, dwy) thành hướng Isometric chuẩn ('SE' | 'SW' | 'NE' | 'NW') */
export function classifyIsoDirection(
  dwx: number,
  dwy: number,
  fallback: IsoDirection = 'SW'
): IsoDirection {
  if (Math.hypot(dwx, dwy) < 0.25) return fallback;
  const isoV = worldVecToIsoVec(dwx, dwy);
  if (isoV.y >= 0) {
    return isoV.x >= 0 ? 'SE' : 'SW';
  }
  return isoV.x >= 0 ? 'NE' : 'NW';
}

// ============================================================================
// 2. 9 FLEZIMERCURIA ARCHITECTURAL ZONES MAPPED TO THE 12 WHITE OFFICE BAYS
// ============================================================================

export const FLEZI_ISO_ZONES: IsoArchitecturalZone[] = [
  {
    id: 'ISO-ZONE-01',
    num: '01',
    title: 'PM Command Center',
    code: 'PMC • CENTRAL SPINE',
    subtitle: 'Nghiệm thu Ticket DONE',
    wx: 390,
    wy: 368,
    ww: 168,
    wh: 146,
    rimColor: '#ea580c',
    wallAccent: '#c2410c',
    floorTileA: '#ffffff',
    floorTileB: '#fffbeb',
    badgeColor: '#c2410c',
    pinAnchor: { wx: 472, wy: 435, height: 96 },
  },
  {
    id: 'ISO-ZONE-02',
    num: '02',
    title: 'BA & Design Studio',
    code: 'BAD • SOUTH-CENTER LOUNGE',
    subtitle: 'Phân tích SRS & Espresso Bar',
    wx: 446,
    wy: 818,
    ww: 154,
    wh: 124,
    rimColor: '#eab308',
    wallAccent: '#a16207',
    floorTileA: '#ffffff',
    floorTileB: '#fefce8',
    badgeColor: '#b45309',
    pinAnchor: { wx: 523, wy: 876, height: 84 },
  },
  {
    id: 'ISO-ZONE-03',
    num: '03',
    title: 'Tech Lead Hub',
    code: 'TLH • NORTH-EAST SPINE',
    subtitle: 'System Design & Code Review',
    wx: 634,
    wy: 238,
    ww: 132,
    wh: 118,
    rimColor: '#7c3aed',
    wallAccent: '#5b21b6',
    floorTileA: '#ffffff',
    floorTileB: '#faf5ff',
    badgeColor: '#6d28d9',
    pinAnchor: { wx: 690, wy: 295, height: 90 },
  },
  {
    id: 'ISO-ZONE-04',
    num: '04',
    title: 'North Loop Bays',
    code: 'NORTH WING • ATRIUM NORTH',
    subtitle: 'Cánh Bắc Mở Rộng Quanh Giếng Trời Bắc',
    wx: 195,
    wy: 18,
    ww: 552,
    wh: 244,
    subBays: [
      { wx: 195, wy: 18, ww: 552, wh: 104 },
      { wx: 195, wy: 148, ww: 155, wh: 114 },
    ],
    rimColor: '#2563eb',
    wallAccent: '#1e40af',
    floorTileA: '#ffffff',
    floorTileB: '#f8fafc',
    badgeColor: '#1d4ed8',
    pinAnchor: { wx: 485, wy: 68, height: 92 },
  },
  {
    id: 'ISO-ZONE-05',
    num: 'NT',
    title: 'KHOANG NHÀ THUỐC',
    code: 'FT3.III2A.1 • 9 CỤM BÀN (54 Ô)',
    subtitle: 'Sơ đồ chỗ ngồi thực tế (DongNQ6 • 1.289)',
    wx: 810,
    wy: 180,
    ww: 735,
    wh: 625,
    rimColor: '#15803d',
    wallAccent: '#166534',
    floorTileA: '#689f38',
    floorTileB: '#7cb342',
    badgeColor: '#15803d',
    pinAnchor: { wx: 1177, wy: 192, height: 68 },
  },
  {
    id: 'ISO-ZONE-06',
    num: '06',
    title: 'Mobile Lab',
    code: 'MOB • SOUTH-WEST L-WING',
    subtitle: 'Cánh Tây-Nam Mở Rộng Quanh Giếng Trời Nam',
    wx: 268,
    wy: 636,
    ww: 158,
    wh: 136,
    rimColor: '#db2777',
    wallAccent: '#9d174d',
    floorTileA: '#ffffff',
    floorTileB: '#fdf2f8',
    badgeColor: '#be185d',
    pinAnchor: { wx: 345, wy: 702, height: 92 },
  },
  {
    id: 'ISO-ZONE-07',
    num: '07',
    title: 'QA Testing Center',
    code: 'QA • SOUTH-EAST BAYS',
    subtitle: 'Cánh Đông-Nam Mở Rộng Quanh Giếng Trời Nam',
    wx: 620,
    wy: 818,
    ww: 196,
    wh: 124,
    rimColor: '#ea580c',
    wallAccent: '#9a3412',
    floorTileA: '#ffffff',
    floorTileB: '#fff7ed',
    badgeColor: '#c2410c',
    pinAnchor: { wx: 718, wy: 880, height: 90 },
  },
  {
    id: 'ISO-ZONE-09',
    num: '09',
    title: 'South-West Squad Bay',
    code: 'SWB • SOUTH-WEST BAY',
    subtitle: 'Không gian làm việc Cánh Nam',
    wx: 268,
    wy: 818,
    ww: 158,
    wh: 124,
    rimColor: '#4f46e5',
    wallAccent: '#3730a3',
    floorTileA: '#ffffff',
    floorTileB: '#f5f3ff',
    badgeColor: '#4338ca',
    pinAnchor: { wx: 345, wy: 880, height: 84 },
  },
];

// Cây xanh 3D Low-Poly trồng TRONG lòng 3 Giếng trời (Atriums), Vườn tiểu cảnh SE & Khuôn viên ngoài tòa nhà
export const CAMPUS_TREES: { wx: number; wy: number; scale: number; variant: 'pine' | 'round' | 'cypress' }[] = [
  // --- Cây xanh tiểu cảnh dưới lòng Giếng trời Bắc (ATRIUM-NORTH: wx 408..582, wy 158..232) ---
  { wx: 452, wy: 194, scale: 0.94, variant: 'round' },
  { wx: 538, wy: 196, scale: 0.88, variant: 'cypress' },

  // --- Cây xanh tiểu cảnh dưới lòng Giếng trời Trung tâm lớn (ATRIUM-CENTRAL: wx 616..762, wy 398..496) ---
  { wx: 656, wy: 446, scale: 1.0, variant: 'round' },
  { wx: 724, wy: 448, scale: 1.04, variant: 'pine' },

  // --- Cây xanh tiểu cảnh dưới lòng Giếng trời Nam (ATRIUM-SOUTH: wx 504..666, wy 668..766) ---
  { wx: 548, wy: 716, scale: 0.96, variant: 'round' },
  { wx: 622, wy: 718, scale: 0.92, variant: 'cypress' },

  // --- 2 Cây tròn tại Góc Vườn treo Đông-Nam (PATIO-SE) ---
  { wx: 752, wy: 624, scale: 0.82, variant: 'round' },
  { wx: 792, wy: 624, scale: 0.85, variant: 'round' },

  // --- Cây xanh cảnh quan bao quanh mặt ngoài tòa nhà & Bãi xe mềm mại ---
  { wx: 138, wy: 65, scale: 1.12, variant: 'round' },
  { wx: 138, wy: 245, scale: 0.98, variant: 'pine' },
  { wx: 785, wy: 105, scale: 1.06, variant: 'round' },
  { wx: 1605, wy: 235, scale: 1.05, variant: 'cypress' },
  { wx: 1610, wy: 450, scale: 1.14, variant: 'round' },
  { wx: 1605, wy: 680, scale: 1.02, variant: 'pine' },
  { wx: 315, wy: 425, scale: 0.96, variant: 'round' }, // Ở hốc chữ C bên trái Central Spine
  { wx: 205, wy: 610, scale: 1.08, variant: 'round' },
  { wx: 205, wy: 790, scale: 0.96, variant: 'pine' },
  { wx: 960, wy: 875, scale: 1.08, variant: 'round' },
  { wx: 1260, wy: 875, scale: 0.96, variant: 'cypress' },
];

export const CAMPUS_STREET_PROPS: {
  wx: number;
  wy: number;
  kind: 'lamp' | 'bench' | 'containers';
}[] = [
  // Đèn cảnh quan & cụm module trang trí ngoài tòa nhà (Hành lang nội bộ để thông thoáng 100% cho các Sếp tuần tra)
  { wx: 158, wy: 365, kind: 'lamp' },
  { wx: 775, wy: 145, kind: 'lamp' },
  { wx: 1590, wy: 350, kind: 'lamp' },
  { wx: 1120, wy: 865, kind: 'lamp' },
  { wx: 135, wy: 425, kind: 'containers' },
  { wx: 1595, wy: 580, kind: 'containers' },
];

// Danh sách nhân viên nữ để render kiểu tóc búi / tóc dài điệu đà
const FEMALE_EMPLOYEE_IDS = new Set([
  'EMP-02', // BA Thu Hà
  'EMP-05', // Lead Hoàng Yến
  'EMP-15', // FE Lan Anh
  'EMP-17', // FE Minh Châu
  'EMP-19', // FE Thảo Vy
  'EMP-23', // Mob Bích Ngọc
  'EMP-25', // QA Thanh Tâm
  'EMP-26', // QA Phương Thảo
  'EMP-28', // QA Kim Ngân
  'EMP-MANAGER-THUNDM', // Sếp Nữ ThuNDM
]);

// Màu tóc đa dạng cho 30 nhân sự
const HAIR_PALETTES = [
  { top: '#1e293b', side: '#0f172a' }, // Jet Black
  { top: '#451a03', side: '#270e02' }, // Espresso Brown
  { top: '#78350f', side: '#451a03' }, // Chestnut Brown
  { top: '#312e81', side: '#1e1b4b' }, // Midnight Indigo
  { top: '#3f3f46', side: '#18181b' }, // Charcoal Ash
];

// ============================================================================
// 3. CORE 2.5D GEOMETRY & SHADING HELPERS
// ============================================================================

/** Vẽ hình chữ nhật bo góc tương thích mọi trình duyệt */
export function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

/** Vẽ đa giác khép kín có bo tròn góc mượt (dùng cho đường bao tòa nhà chữ S / 3-Loop) */
function traceRoundedPolygon(
  ctx: CanvasRenderingContext2D,
  pts: Point2D[],
  radius: number
) {
  if (pts.length < 3) return;
  ctx.beginPath();
  for (let i = 0; i < pts.length; i++) {
    const prev = pts[(i - 1 + pts.length) % pts.length];
    const curr = pts[i];
    const next = pts[(i + 1) % pts.length];

    const v1x = prev.x - curr.x;
    const v1y = prev.y - curr.y;
    const len1 = Math.hypot(v1x, v1y);

    const v2x = next.x - curr.x;
    const v2y = next.y - curr.y;
    const len2 = Math.hypot(v2x, v2y);

    const r = Math.min(radius, len1 * 0.4, len2 * 0.4);
    const startX = curr.x + (v1x / len1) * r;
    const startY = curr.y + (v1y / len1) * r;
    const endX = curr.x + (v2x / len2) * r;
    const endY = curr.y + (v2y / len2) * r;

    if (i === 0) {
      ctx.moveTo(startX, startY);
    } else {
      ctx.lineTo(startX, startY);
    }
    ctx.quadraticCurveTo(curr.x, curr.y, endX, endY);
  }
  ctx.closePath();
}

/** Vẽ khối hộp 3D Isometric (Prism) từ tọa độ thế giới (wx, wy, ww, wh, z0 -> z1) */
export function drawIsoBox(
  ctx: CanvasRenderingContext2D,
  wx: number,
  wy: number,
  ww: number,
  wh: number,
  z0: number,
  z1: number,
  topColor: string,
  leftColor: string,
  rightColor: string,
  strokeColor?: string,
  lineWidth = 0.75
) {
  const pNW0 = worldToIso(wx, wy, z0);
  const pNE0 = worldToIso(wx + ww, wy, z0);
  const pSE0 = worldToIso(wx + ww, wy + wh, z0);
  const pSW0 = worldToIso(wx, wy + wh, z0);

  const pNW1 = worldToIso(wx, wy, z1);
  const pNE1 = worldToIso(wx + ww, wy, z1);
  const pSE1 = worldToIso(wx + ww, wy + wh, z1);
  const pSW1 = worldToIso(wx, wy + wh, z1);

  // Left-Front Face (SW -> SE)
  ctx.beginPath();
  ctx.moveTo(pSW1.x, pSW1.y);
  ctx.lineTo(pSE1.x, pSE1.y);
  ctx.lineTo(pSE0.x, pSE0.y);
  ctx.lineTo(pSW0.x, pSW0.y);
  ctx.closePath();
  ctx.fillStyle = leftColor;
  ctx.fill();
  if (strokeColor) {
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }

  // Right-Front Face (SE -> NE)
  ctx.beginPath();
  ctx.moveTo(pSE1.x, pSE1.y);
  ctx.lineTo(pNE1.x, pNE1.y);
  ctx.lineTo(pNE0.x, pNE0.y);
  ctx.lineTo(pSE0.x, pSE0.y);
  ctx.closePath();
  ctx.fillStyle = rightColor;
  ctx.fill();
  if (strokeColor) {
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }

  // Top Face
  ctx.beginPath();
  ctx.moveTo(pNW1.x, pNW1.y);
  ctx.lineTo(pNE1.x, pNE1.y);
  ctx.lineTo(pSE1.x, pSE1.y);
  ctx.lineTo(pSW1.x, pSW1.y);
  ctx.closePath();
  ctx.fillStyle = topColor;
  ctx.fill();
  if (strokeColor) {
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }
}

/** Điều chỉnh độ sáng mã màu Hex (-100..100) để tạo mặt sáng/mặt tối 3D tự động */
export function shadeHexColor(hex: string, percent: number): string {
  const cleaned = hex.replace('#', '');
  if (cleaned.length !== 6) return hex;
  const num = parseInt(cleaned, 16);
  const r = Math.min(255, Math.max(0, ((num >> 16) & 0xff) + Math.round(2.55 * percent)));
  const g = Math.min(255, Math.max(0, ((num >> 8) & 0xff) + Math.round(2.55 * percent)));
  const b = Math.min(255, Math.max(0, (num & 0xff) + Math.round(2.55 * percent)));
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

// ============================================================================
// 4. 3-COURTYARD INTERLOCKING BUILDING ENVELOPE, RING CORRIDORS, ATRIUMS & CORES
// ============================================================================

export type ParkedVehicleKind = 'sedan' | 'suv' | 'hatchback' | 'shuttle' | 'pickup';

/**
 * Helper vẽ khối 3D bo tròn góc mềm mại (Soft Rounded Stadium Extrusion)
 * dùng cho thân xe ô tô, mui xe vát nghiêng, bồn cỏ cảnh quan và ghế sofa nghỉ chân.
 */
function drawSoftRoundedExtrusion(
  ctx: CanvasRenderingContext2D,
  wx: number,
  wy: number,
  ww: number,
  wh: number,
  cornerRadius: number,
  z0: number,
  z1: number,
  topColor: string,
  sideColorA: string,
  sideColorB: string,
  strokeColor?: string,
  lineWidth = 0.7
) {
  const botPts = buildIsoStadiumPoints(wx, wy, ww, wh, cornerRadius, z0);
  const topPts = buildIsoStadiumPoints(wx, wy, ww, wh, cornerRadius, z1);

  // Vẽ các mặt bên bo tròn chuyển sắc mượt mà
  const half = Math.floor(botPts.length * 0.55);
  for (let i = 0; i < botPts.length; i++) {
    const next = (i + 1) % botPts.length;
    const b0 = botPts[i];
    const b1 = botPts[next];
    const t1 = topPts[next];
    const t0 = topPts[i];
    ctx.beginPath();
    ctx.moveTo(t0.x, t0.y);
    ctx.lineTo(t1.x, t1.y);
    ctx.lineTo(b1.x, b1.y);
    ctx.lineTo(b0.x, b0.y);
    ctx.closePath();
    ctx.fillStyle = i < half ? sideColorA : sideColorB;
    ctx.fill();
  }

  // Vẽ mặt trên bo tròn
  tracePolygonPath(ctx, topPts);
  const grad = ctx.createLinearGradient(
    topPts[0].x,
    topPts[0].y,
    topPts[Math.floor(topPts.length / 2)].x,
    topPts[Math.floor(topPts.length / 2)].y
  );
  grad.addColorStop(0, shadeHexColor(topColor, 10));
  grad.addColorStop(1, shadeHexColor(topColor, -6));
  ctx.fillStyle = grad;
  ctx.fill();

  if (strokeColor) {
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }
}

/**
 * Vẽ đa dạng các loại Xe 2.5D Isometric mềm mại, bo tròn khí động học (`drawIsometricParkedCar`):
 * - Hỗ trợ 5 dòng xe: `'sedan'`, `'suv'`, `'hatchback'` (xe điện mini bo tròn), `'shuttle'` (xe van 16 chỗ FRT), `'pickup'` (bán tải thể thao)
 * - Thân xe & cabin bo góc mượt (`drawSoftRoundedExtrusion`), bóng đổ đa lớp êm dịu, kính chắn gió màu xanh băng, đèn pha ấm & đèn hậu LED mềm mại.
 */
export function drawIsometricParkedCar(
  ctx: CanvasRenderingContext2D,
  wx: number,
  wy: number,
  axis: 'gx' | 'gy',
  bodyColor: string,
  facingPositive = true,
  kind: ParkedVehicleKind = 'sedan'
) {
  ctx.save();

  // Kích thước từng dòng xe
  const baseLen =
    kind === 'shuttle'
      ? 50
      : kind === 'suv' || kind === 'pickup'
        ? 41
        : kind === 'hatchback'
          ? 31
          : 38;
  const baseWid =
    kind === 'shuttle'
      ? 21
      : kind === 'suv'
        ? 20
        : kind === 'hatchback'
          ? 17.5
          : 18.8;

  const carLen = axis === 'gx' ? baseLen : baseWid;
  const carWid = axis === 'gx' ? baseWid : baseLen;
  const x0 = wx - carLen / 2;
  const y0 = wy - carWid / 2;

  // 1. Bóng đổ 2 lớp siêu mềm (Soft Multi-Layer Ambient Drop Shadow)
  const shCenter = worldToIso(wx + 2.0, wy + 2.2, -1.75);
  ctx.fillStyle = 'rgba(15, 23, 42, 0.16)';
  ctx.beginPath();
  ctx.ellipse(
    shCenter.x,
    shCenter.y,
    (axis === 'gx' ? baseLen * 0.66 : baseWid * 0.98) + 3,
    (axis === 'gx' ? baseWid * 0.64 : baseLen * 0.36) + 2,
    axis === 'gx' ? 0.35 : -0.35,
    0,
    Math.PI * 2
  );
  ctx.fill();

  ctx.fillStyle = 'rgba(15, 23, 42, 0.26)';
  ctx.beginPath();
  ctx.ellipse(
    shCenter.x,
    shCenter.y,
    axis === 'gx' ? baseLen * 0.58 : baseWid * 0.86,
    axis === 'gx' ? baseWid * 0.56 : baseLen * 0.31,
    axis === 'gx' ? 0.35 : -0.35,
    0,
    Math.PI * 2
  );
  ctx.fill();

  // 2. Bánh xe tròn 3D có mâm hợp kim bạc (Soft Rounded Tires & Alloy Rims)
  const wheelInsetL = baseLen * 0.21;
  const wheelPositions: [number, number][] =
    axis === 'gx'
      ? [
          [x0 + wheelInsetL, y0 + 0.6],
          [x0 + carLen - wheelInsetL, y0 + 0.6],
          [x0 + wheelInsetL, y0 + carWid - 0.6],
          [x0 + carLen - wheelInsetL, y0 + carWid - 0.6],
        ]
      : [
          [x0 + 0.6, y0 + wheelInsetL],
          [x0 + 0.6, y0 + carWid - wheelInsetL],
          [x0 + carLen - 0.6, y0 + wheelInsetL],
          [x0 + carLen - 0.6, y0 + carWid - wheelInsetL],
        ];

  for (const [whX, whY] of wheelPositions) {
    const wIso = worldToIso(whX, whY, 0.8);
    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.ellipse(wIso.x, wIso.y, 4.1, 3.1, 0.25, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#cbd5e1';
    ctx.beginPath();
    ctx.ellipse(wIso.x, wIso.y, 2.0, 1.5, 0.25, 0, Math.PI * 2);
    ctx.fill();
  }

  // 3. Thân dưới xe bo tròn khí động học (Aerodynamic Rounded Lower Body)
  const chassisZ1 = kind === 'suv' || kind === 'pickup' ? 8.8 : kind === 'shuttle' ? 9.5 : 7.6;
  const cornerRad = kind === 'hatchback' || kind === 'shuttle' ? 7.5 : 6.5;
  const topCol = shadeHexColor(bodyColor, 16);
  const leftCol = bodyColor;
  const rightCol = shadeHexColor(bodyColor, -18);

  drawSoftRoundedExtrusion(
    ctx,
    x0,
    y0,
    carLen,
    carWid,
    cornerRad,
    1.2,
    chassisZ1,
    topCol,
    leftCol,
    rightCol,
    'rgba(15, 23, 42, 0.38)',
    0.7
  );

  // 4. Cabin kính & Mui xe bo tròn theo từng dòng xe
  let cabX = x0;
  let cabY = y0;
  let cabW = carLen;
  let cabH = carWid;
  const cabTopZ =
    kind === 'shuttle'
      ? 16.5
      : kind === 'suv'
        ? 15.2
        : kind === 'pickup'
          ? 14.5
          : kind === 'hatchback'
            ? 13.6
            : 13.4;

  if (axis === 'gx') {
    if (kind === 'shuttle') {
      cabX = x0 + 3.2;
      cabW = carLen - 6.4;
    } else if (kind === 'suv') {
      cabX = facingPositive ? x0 + 3.5 : x0 + 8.5;
      cabW = carLen - 12.0;
    } else if (kind === 'pickup') {
      cabX = facingPositive ? x0 + carLen * 0.42 : x0 + 5.5;
      cabW = carLen * 0.44;
    } else if (kind === 'hatchback') {
      cabX = facingPositive ? x0 + 3.2 : x0 + 6.8;
      cabW = carLen - 10.0;
    } else {
      cabX = x0 + 7.8;
      cabW = carLen - 15.6;
    }
    cabY = y0 + 2.1;
    cabH = carWid - 4.2;
  } else {
    if (kind === 'shuttle') {
      cabY = y0 + 3.2;
      cabH = carWid - 6.4;
    } else if (kind === 'suv') {
      cabY = facingPositive ? y0 + 3.5 : y0 + 8.5;
      cabH = carWid - 12.0;
    } else if (kind === 'pickup') {
      cabY = facingPositive ? y0 + carWid * 0.42 : y0 + 5.5;
      cabH = carWid * 0.44;
    } else if (kind === 'hatchback') {
      cabY = facingPositive ? y0 + 3.2 : y0 + 6.8;
      cabH = carWid - 10.0;
    } else {
      cabY = y0 + 7.8;
      cabH = carWid - 15.6;
    }
    cabX = x0 + 2.1;
    cabW = carLen - 4.2;
  }

  // Vẽ khối kính cabin xanh đá đậm mềm mại
  drawSoftRoundedExtrusion(
    ctx,
    cabX,
    cabY,
    cabW,
    cabH,
    5.5,
    chassisZ1 - 0.3,
    cabTopZ,
    topCol,
    '#1e293b',
    '#0f172a',
    'rgba(125, 211, 252, 0.55)',
    0.65
  );

  // Nếu là dòng Pickup: vẽ lòng thùng xe phía sau (Cargo Bed)
  if (kind === 'pickup') {
    const bedX =
      axis === 'gx'
        ? facingPositive
          ? x0 + 2.5
          : x0 + carLen * 0.52
        : x0 + 2.4;
    const bedY =
      axis === 'gy'
        ? facingPositive
          ? y0 + 2.5
          : y0 + carWid * 0.52
        : y0 + 2.4;
    const bedW = axis === 'gx' ? carLen * 0.38 : carLen - 4.8;
    const bedH = axis === 'gy' ? carWid * 0.38 : carWid - 4.8;
    const bedPts = buildIsoStadiumPoints(bedX, bedY, bedW, bedH, 3.5, chassisZ1 + 0.25);
    tracePolygonPath(ctx, bedPts);
    ctx.fillStyle = '#1e293b';
    ctx.fill();
    ctx.strokeStyle = '#64748b';
    ctx.lineWidth = 0.8;
    ctx.stroke();
  }

  // Nếu là SUV hoặc Shuttle: vẽ thanh giá nóc thể thao hoặc cửa sổ trời панорама bo tròn
  if (kind === 'suv') {
    const r0 = worldToIso(cabX + 3, cabY + 2, cabTopZ + 0.5);
    const r1 = worldToIso(
      axis === 'gx' ? cabX + cabW - 3 : cabX + 3,
      axis === 'gy' ? cabY + cabH - 3 : cabY + 2,
      cabTopZ + 0.5
    );
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(r0.x, r0.y);
    ctx.lineTo(r1.x, r1.y);
    ctx.stroke();
  } else if (kind === 'shuttle') {
    // Sọc thương hiệu cam-xanh FRT trên nóc xe Shuttle Bus đưa đón nhân viên
    const roofStripePts = buildIsoStadiumPoints(
      cabX + 4,
      cabY + 3,
      Math.max(4, cabW - 8),
      Math.max(4, cabH - 6),
      4,
      cabTopZ + 0.25
    );
    tracePolygonPath(ctx, roofStripePts);
    ctx.fillStyle = '#f97316';
    ctx.fill();
  } else {
    // Cửa sổ trời панорама bo tròn mềm mại
    const sunPts = buildIsoStadiumPoints(
      cabX + 2.8,
      cabY + 2.4,
      Math.max(3.5, cabW - 5.6),
      Math.max(3.5, cabH - 4.8),
      3.5,
      cabTopZ + 0.2
    );
    tracePolygonPath(ctx, sunPts);
    ctx.fillStyle = 'rgba(15, 23, 42, 0.78)';
    ctx.fill();
  }

  // 5. Đèn pha LED bo tròn ấm áp & Đèn hậu dải LED mềm mại
  if (axis === 'gx') {
    const frontX = facingPositive ? x0 + carLen - 0.6 : x0 + 0.6;
    const rearX = facingPositive ? x0 + 0.6 : x0 + carLen - 0.6;
    for (const ly of [y0 + 3.4, y0 + carWid - 3.4]) {
      const fIso = worldToIso(frontX, ly, 4.6);
      const rIso = worldToIso(rearX, ly, 4.8);
      ctx.fillStyle = '#fef08a';
      ctx.beginPath();
      ctx.ellipse(fIso.x, fIso.y, 2.2, 1.5, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#fb7185';
      ctx.beginPath();
      ctx.ellipse(rIso.x, rIso.y, 2.2, 1.4, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    const frontY = facingPositive ? y0 + carWid - 0.6 : y0 + 0.6;
    const rearY = facingPositive ? y0 + 0.6 : y0 + carWid - 0.6;
    for (const lx of [x0 + 3.4, x0 + carLen - 3.4]) {
      const fIso = worldToIso(lx, frontY, 4.6);
      const rIso = worldToIso(lx, rearY, 4.8);
      ctx.fillStyle = '#fef08a';
      ctx.beginPath();
      ctx.ellipse(fIso.x, fIso.y, 2.2, 1.5, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#fb7185';
      ctx.beginPath();
      ctx.ellipse(rIso.x, rIso.y, 2.2, 1.4, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.restore();
}

/**
 * Vẽ Khu Nhà Để Xe Máy Tay Ga Mái Vòm Cong Mềm Mại (`drawScooterParkingCanopy`):
 * - Có dàn xe tay ga Vespa / SH / Vision nhiều màu pastel & rực rỡ đỗ ngay ngắn
 * - Có mái vòm polycarbonate cong trong suốt dịu mắt che nắng phía trên.
 */
function drawScooterParkingCanopy(
  ctx: CanvasRenderingContext2D,
  wx: number,
  wy: number,
  ww: number,
  wh: number,
  axis: 'gx' | 'gy'
) {
  ctx.save();

  // 1. Nền khu đỗ xe máy bo góc mềm
  const padPts = buildIsoStadiumPoints(wx, wy, ww, wh, 8, -1.65);
  tracePolygonPath(ctx, padPts);
  ctx.fillStyle = 'rgba(30, 41, 59, 0.72)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(148, 163, 184, 0.55)';
  ctx.lineWidth = 1.0;
  ctx.stroke();

  // 2. Dàn xe tay ga (Vespa / SH / Scooter) đỗ thành hàng
  const scooterColors = [
    '#38bdf8',
    '#f43f5e',
    '#facc15',
    '#4ade80',
    '#f8fafc',
    '#a855f7',
    '#fb923c',
    '#2dd4bf',
    '#e879f9',
    '#60a5fa',
  ];
  const count = axis === 'gx' ? Math.floor((ww - 14) / 13) : Math.floor((wh - 14) / 13);
  for (let i = 0; i < count; i++) {
    const sx = axis === 'gx' ? wx + 11 + i * 13 : wx + ww * 0.5;
    const sy = axis === 'gy' ? wy + 11 + i * 13 : wy + wh * 0.5;
    const sCol = scooterColors[i % scooterColors.length];

    // Bóng xe máy
    const shIso = worldToIso(sx + 1, sy + 1, -1.5);
    ctx.fillStyle = 'rgba(15, 23, 42, 0.25)';
    ctx.beginPath();
    ctx.ellipse(shIso.x, shIso.y, 5.5, 3.2, axis === 'gx' ? -0.3 : 0.3, 0, Math.PI * 2);
    ctx.fill();

    // Thân xe tay ga bo tròn
    const bW = axis === 'gx' ? 6.5 : 13;
    const bH = axis === 'gx' ? 13 : 6.5;
    drawSoftRoundedExtrusion(
      ctx,
      sx - bW / 2,
      sy - bH / 2,
      bW,
      bH,
      3.2,
      0.2,
      4.8,
      shadeHexColor(sCol, 12),
      sCol,
      shadeHexColor(sCol, -18)
    );

    // Yên xe màu nâu/đen mềm
    const seatIso = worldToIso(sx, sy, 5.3);
    ctx.fillStyle = i % 2 === 0 ? '#1e293b' : '#78350f';
    ctx.beginPath();
    ctx.ellipse(seatIso.x, seatIso.y, 2.8, 1.8, 0, 0, Math.PI * 2);
    ctx.fill();

    // Đầu xe + Gương & Đèn pha
    const hx = axis === 'gx' ? sx : sx - 3.5;
    const hy = axis === 'gx' ? sy - 3.5 : sy;
    const hIso = worldToIso(hx, hy, 7.2);
    ctx.fillStyle = sCol;
    ctx.beginPath();
    ctx.arc(hIso.x, hIso.y, 2.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fef08a';
    ctx.beginPath();
    ctx.arc(hIso.x, hIso.y - 0.5, 1.0, 0, Math.PI * 2);
    ctx.fill();
  }

  // 3. Cột đỡ & Mái vòm cong polycarbonate trong suốt mềm mại phía trên
  const pillarCoords: [number, number][] = [
    [wx + 6, wy + 5],
    [wx + ww - 6, wy + 5],
    [wx + 6, wy + wh - 5],
    [wx + ww - 6, wy + wh - 5],
  ];
  for (const [px, py] of pillarCoords) {
    const p0 = worldToIso(px, py, -1.2);
    const p1 = worldToIso(px, py, 14.5);
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(p0.x, p0.y);
    ctx.lineTo(p1.x, p1.y);
    ctx.stroke();
  }

  const canopyPts = buildIsoStadiumPoints(wx - 2, wy - 2, ww + 4, wh + 4, 10, 15.0);
  tracePolygonPath(ctx, canopyPts);
  const canGrad = ctx.createLinearGradient(
    canopyPts[0].x,
    canopyPts[0].y,
    canopyPts[10].x,
    canopyPts[10].y
  );
  canGrad.addColorStop(0, 'rgba(224, 242, 254, 0.52)');
  canGrad.addColorStop(0.5, 'rgba(186, 230, 253, 0.38)');
  canGrad.addColorStop(1, 'rgba(125, 211, 252, 0.48)');
  ctx.fillStyle = canGrad;
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.75)';
  ctx.lineWidth = 1.2;
  ctx.stroke();

  ctx.restore();
}

/**
 * Hệ thống Đường Nhựa Bo Tròn Mềm Mại, Đảo Cỏ Cảnh Quan, Bãi Xe Máy Mái Vòm & Đa Dạng Xe 2.5D Bao Quanh Tòa Nhà FRT
 */
function drawPerimeterStreetAndSidewalk(ctx: CanvasRenderingContext2D, _time: number) {
  ctx.save();

  // Tọa độ bao ngoài chu vi toàn khu đất (Outer Street Loop mở rộng: wx = 86..1668, wy = -64..1006)
  const outMinX = 86;
  const outMaxX = 1668;
  const outMinY = -64;
  const outMaxY = 1006;
  const roadW = 68;

  // 1. Nền mặt đường nhựa tổng thể bo tròn góc ngoài mềm mại (Soft Rounded Outer Asphalt Ring)
  const outerRoadPts = buildIsoStadiumPoints(
    outMinX,
    outMinY,
    outMaxX - outMinX,
    outMaxY - outMinY,
    38,
    -1.85
  );
  tracePolygonPath(ctx, outerRoadPts);
  const roadGrad = ctx.createLinearGradient(
    outerRoadPts[0].x,
    outerRoadPts[0].y,
    outerRoadPts[10].x,
    outerRoadPts[10].y
  );
  roadGrad.addColorStop(0, '#334155');
  roadGrad.addColorStop(0.5, '#1e293b');
  roadGrad.addColorStop(1, '#334155');
  ctx.fillStyle = roadGrad;
  ctx.fill();
  ctx.strokeStyle = '#64748b';
  ctx.lineWidth = 1.4;
  ctx.stroke();

  // 2. Vỉa hè lát đá sáng bo tròn góc mềm mại (`Soft Rounded Sidewalk Island`) lót dưới chân tòa nhà
  const swPts = buildIsoStadiumPoints(
    outMinX + roadW - 4,
    outMinY + roadW - 4,
    outMaxX - outMinX - (roadW - 4) * 2,
    outMaxY - outMinY - (roadW - 4) * 2,
    28,
    -1.6
  );
  tracePolygonPath(ctx, swPts);
  ctx.fillStyle = '#e2e8f0';
  ctx.fill();
  ctx.strokeStyle = '#94a3b8';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Nhánh đường bo góc mềm đón khách trước sảnh `🚪 CỬA RA VÀO` phía Bắc Khoang Nhà Thuốc
  const drivePts = buildIsoStadiumPoints(755, 96, 825, 64, 18, -1.75);
  tracePolygonPath(ctx, drivePts);
  ctx.fillStyle = '#334155';
  ctx.fill();
  ctx.strokeStyle = '#64748b';
  ctx.lineWidth = 1.1;
  ctx.stroke();

  // Vạch kẻ phân làn nét đứt mềm mại ở tim đường 4 phía
  const laneSegments: { x0: number; y0: number; x1: number; y1: number }[] = [
    { x0: outMinX + 45, y0: outMinY + roadW * 0.5, x1: outMaxX - 45, y1: outMinY + roadW * 0.5 },
    { x0: outMinX + 45, y0: outMaxY - roadW * 0.5, x1: outMaxX - 45, y1: outMaxY - roadW * 0.5 },
    { x0: outMinX + roadW * 0.5, y0: outMinY + 45, x1: outMinX + roadW * 0.5, y1: outMaxY - 45 },
    { x0: outMaxX - roadW * 0.5, y0: outMinY + 45, x1: outMaxX - roadW * 0.5, y1: outMaxY - 45 },
    { x0: 780, y0: 128, x1: 1555, y1: 128 },
  ];
  ctx.save();
  ctx.strokeStyle = 'rgba(250, 204, 21, 0.58)';
  ctx.lineWidth = 1.3;
  ctx.setLineDash([10, 9]);
  for (const seg of laneSegments) {
    const a = worldToIso(seg.x0, seg.y0, -1.65);
    const b = worldToIso(seg.x1, seg.y1, -1.65);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.restore();

  // 3. Các bồn cỏ & hoa cảnh quan bo tròn (`Landscaped Green Curb Islands`) xen giữa các khu vực đỗ xe
  const greenCurbIslands: { wx: number; wy: number; ww: number; wh: number }[] = [
    { wx: 705, wy: -28, ww: 48, wh: 22 },
    { wx: 1068, wy: 132, ww: 38, wh: 20 },
    { wx: 1248, wy: 132, ww: 38, wh: 20 },
    { wx: 855, wy: 954, ww: 52, wh: 22 },
    { wx: 118, wy: 390, ww: 22, wh: 54 },
  ];
  for (const isl of greenCurbIslands) {
    drawSoftRoundedExtrusion(
      ctx,
      isl.wx,
      isl.wy,
      isl.ww,
      isl.wh,
      8,
      -1.6,
      1.6,
      '#22c55e',
      '#16a34a',
      '#15803d',
      '#bbf7d0',
      0.8
    );
  }

  // 4. Vạch kẻ sang đường đi bộ (Zebra Crosswalk) bo tròn góc trước `🚪 CỬA RA VÀO`
  const zebraStartWx = 1122;
  const zebraEndWx = 1232;
  for (let sy = 104; sy <= 154; sy += 8.5) {
    const zPts = buildIsoStadiumPoints(zebraStartWx, sy, zebraEndWx - zebraStartWx, 4.5, 2, -1.55);
    tracePolygonPath(ctx, zPts);
    ctx.fillStyle = 'rgba(248, 250, 252, 0.92)';
    ctx.fill();
  }

  // 5. 2 Khu Nhà Để Xe Máy Tay Ga Mái Vòm Cong Mềm Mại (Scooter Canopies)
  drawScooterParkingCanopy(ctx, 835, -32, 165, 28, 'gx');
  drawScooterParkingCanopy(ctx, 118, 465, 28, 145, 'gy');

  // 6. Bãi đỗ xe đa dạng chủng loại (Sedan, SUV 7 chỗ, Hatchback/EV Mini, Shuttle Bus 16 chỗ FRT, Bán tải Pickup)
  const parkedVehicles: {
    wx: number;
    wy: number;
    axis: 'gx' | 'gy';
    color: string;
    facingPositive: boolean;
    kind: ParkedVehicleKind;
  }[] = [
    // Dọc đường phía Bắc (North Street)
    { wx: 225, wy: -18, axis: 'gx', color: '#38bdf8', facingPositive: true, kind: 'hatchback' },
    { wx: 305, wy: -18, axis: 'gx', color: '#f43f5e', facingPositive: true, kind: 'sedan' },
    { wx: 395, wy: -18, axis: 'gx', color: '#f8fafc', facingPositive: true, kind: 'suv' },
    { wx: 490, wy: -18, axis: 'gx', color: '#f59e0b', facingPositive: true, kind: 'pickup' },
    { wx: 585, wy: -18, axis: 'gx', color: '#10b981', facingPositive: true, kind: 'sedan' },
    { wx: 665, wy: -18, axis: 'gx', color: '#a855f7', facingPositive: true, kind: 'hatchback' },
    { wx: 1065, wy: -18, axis: 'gx', color: '#f8fafc', facingPositive: false, kind: 'shuttle' },
    { wx: 1185, wy: -18, axis: 'gx', color: '#0ea5e9', facingPositive: false, kind: 'suv' },
    { wx: 1285, wy: -18, axis: 'gx', color: '#facc15', facingPositive: false, kind: 'hatchback' },
    { wx: 1385, wy: -18, axis: 'gx', color: '#fb7185', facingPositive: false, kind: 'sedan' },

    // Dọc đường nhánh trước Khoang Nhà Thuốc (chừa trống Zebra Crosswalk 1115..1239 trước Cửa Ra Vào)
    { wx: 825, wy: 142, axis: 'gx', color: '#f8fafc', facingPositive: true, kind: 'shuttle' },
    { wx: 930, wy: 142, axis: 'gx', color: '#38bdf8', facingPositive: true, kind: 'suv' },
    { wx: 1020, wy: 142, axis: 'gx', color: '#34d399', facingPositive: true, kind: 'hatchback' },
    { wx: 1325, wy: 142, axis: 'gx', color: '#a78bfa', facingPositive: false, kind: 'sedan' },
    { wx: 1415, wy: 142, axis: 'gx', color: '#fbbf24', facingPositive: false, kind: 'SUV' as ParkedVehicleKind },
    { wx: 1505, wy: 142, axis: 'gx', color: '#2dd4bf', facingPositive: false, kind: 'hatchback' },

    // Dọc đại lộ phía Đông (East Avenue)
    { wx: 1622, wy: 215, axis: 'gy', color: '#38bdf8', facingPositive: true, kind: 'sedan' },
    { wx: 1622, wy: 315, axis: 'gy', color: '#fb923c', facingPositive: true, kind: 'suv' },
    { wx: 1622, wy: 425, axis: 'gy', color: '#f8fafc', facingPositive: true, kind: 'shuttle' },
    { wx: 1622, wy: 540, axis: 'gy', color: '#f472b6', facingPositive: true, kind: 'hatchback' },
    { wx: 1622, wy: 645, axis: 'gy', color: '#4ade80', facingPositive: true, kind: 'pickup' },
    { wx: 1622, wy: 755, axis: 'gy', color: '#818cf8', facingPositive: true, kind: 'sedan' },

    // Dọc đại lộ phía Nam (South Boulevard)
    { wx: 325, wy: 964, axis: 'gx', color: '#fb7185', facingPositive: false, kind: 'hatchback' },
    { wx: 425, wy: 964, axis: 'gx', color: '#38bdf8', facingPositive: false, kind: 'suv' },
    { wx: 535, wy: 964, axis: 'gx', color: '#fde047', facingPositive: false, kind: 'sedan' },
    { wx: 645, wy: 964, axis: 'gx', color: '#c084fc', facingPositive: false, kind: 'pickup' },
    { wx: 765, wy: 964, axis: 'gx', color: '#f8fafc', facingPositive: false, kind: 'sedan' },
    { wx: 965, wy: 964, axis: 'gx', color: '#f8fafc', facingPositive: false, kind: 'shuttle' },
    { wx: 1095, wy: 964, axis: 'gx', color: '#34d399', facingPositive: false, kind: 'suv' },
    { wx: 1215, wy: 964, axis: 'gx', color: '#60a5fa', facingPositive: false, kind: 'hatchback' },
    { wx: 1335, wy: 964, axis: 'gx', color: '#f97316', facingPositive: false, kind: 'sedan' },

    // Dọc đường phía Tây (West Avenue)
    { wx: 130, wy: 145, axis: 'gy', color: '#fbbf24', facingPositive: false, kind: 'suv' },
    { wx: 130, wy: 245, axis: 'gy', color: '#34d399', facingPositive: false, kind: 'hatchback' },
    { wx: 130, wy: 335, axis: 'gy', color: '#60a5fa', facingPositive: false, kind: 'sedan' },
    { wx: 130, wy: 665, axis: 'gy', color: '#f43f5e', facingPositive: false, kind: 'pickup' },
    { wx: 130, wy: 775, axis: 'gy', color: '#f8fafc', facingPositive: false, kind: 'suv' },
    { wx: 130, wy: 875, axis: 'gy', color: '#a78bfa', facingPositive: false, kind: 'hatchback' },
  ];

  // Vẽ ô đỗ xe bo góc mềm dưới mỗi chiếc xe, sau đó vẽ xe 2.5D mềm mại
  for (const v of parkedVehicles) {
    const vKind: ParkedVehicleKind =
      (v.kind.toLowerCase() as ParkedVehicleKind) || 'sedan';
    const bayLen = vKind === 'shuttle' ? 56 : 46;
    const bayW = v.axis === 'gx' ? bayLen : 24;
    const bayH = v.axis === 'gx' ? 24 : bayLen;
    const bayPts = buildIsoStadiumPoints(
      v.wx - bayW / 2,
      v.wy - bayH / 2,
      bayW,
      bayH,
      5,
      -1.65
    );
    tracePolygonPath(ctx, bayPts);
    ctx.strokeStyle = 'rgba(248, 250, 252, 0.36)';
    ctx.lineWidth = 0.9;
    ctx.stroke();

    drawIsometricParkedCar(
      ctx,
      v.wx,
      v.wy,
      v.axis,
      v.color,
      v.facingPositive,
      vKind
    );
  }

  ctx.restore();
}

/**
 * Vẽ toàn bộ khối Đế Tòa Nhà 3 Giếng Trời (12-Vertex Interlocking Footprint),
 * Hệ thống Đường Nhựa Bao Quanh & Đa Dạng Xe Đỗ Mềm Mại,
 * Hệ thống Hành lang vòng Mở Rộng (Wide Ring Corridors) quanh 3 Giếng trời thực tế FRT (North, Central, South Atriums)
 * và 8 Lõi Thang máy / Kỹ thuật / WC.
 */
export function drawCampusRoadNetwork(ctx: CanvasRenderingContext2D, time = 0) {
  ctx.save();

  // --------------------------------------------------------------------------
  // 0. PERIMETER STREET, TILED SIDEWALK, ZEBRA CROSSWALK & DIVERSE 2.5D VEHICLES
  // --------------------------------------------------------------------------
  drawPerimeterStreetAndSidewalk(ctx, time);

  // --------------------------------------------------------------------------
  // 1. MULTI-LAYERED SOFT GLOBAL ILLUMINATION DROP SHADOW OF THE BUILDING
  // --------------------------------------------------------------------------
  const outerAmbientPts = BUILDING_FOOTPRINT_POLYGON.map((p) =>
    worldToIso(p.x + 20, p.y + 22, -2)
  );
  traceRoundedPolygon(ctx, outerAmbientPts, 18);
  ctx.fillStyle = 'rgba(15, 23, 42, 0.07)';
  ctx.fill();

  const shadowPts = BUILDING_FOOTPRINT_POLYGON.map((p) =>
    worldToIso(p.x + 11, p.y + 13, -1)
  );
  traceRoundedPolygon(ctx, shadowPts, 14);
  ctx.fillStyle = 'rgba(15, 23, 42, 0.15)';
  ctx.fill();

  // --------------------------------------------------------------------------
  // 2. EXTRUDED 3D BUILDING BASE SLAB (z = 0 -> 8.5) FOR THE 3 EXPANDED INTERLOCKING LOOPS
  // --------------------------------------------------------------------------
  const slabBlocks: IsoSubRect[] = [
    { wx: 185, wy: 18, ww: 570, wh: 324 },   // Expanded North Loop Slab
    { wx: 375, wy: 168, ww: 1185, wh: 648 }, // Expanded Central-East Grand Wing & Spine Slab
    { wx: 255, wy: 516, ww: 580, wh: 436 },  // Expanded South Loop Slab
  ];

  for (const b of slabBlocks) {
    drawIsoBox(
      ctx,
      b.wx,
      b.wy,
      b.ww,
      b.wh,
      0,
      8.5,
      '#93c5fd',
      '#64748b',
      '#475569'
    );
  }

  // --------------------------------------------------------------------------
  // 3. UNIFIED ROUNDED BUILDING ENVELOPE & CONTINUOUS RING CORRIDOR FLOOR (z = 8.6)
  // --------------------------------------------------------------------------
  const outerEnvelopeIso = BUILDING_FOOTPRINT_POLYGON.map((p) =>
    worldToIso(p.x, p.y, 8.6)
  );
  traceRoundedPolygon(ctx, outerEnvelopeIso, 14);
  const envTopLeft = worldToIso(200, 40, 8.6);
  const envBotRight = worldToIso(1180, 860, 8.6);
  const envGrad = ctx.createLinearGradient(
    envTopLeft.x,
    envTopLeft.y,
    envBotRight.x,
    envBotRight.y
  );
  envGrad.addColorStop(0, '#dbeafe');
  envGrad.addColorStop(0.5, '#bfdbfe');
  envGrad.addColorStop(1, '#93c5fd');
  ctx.fillStyle = envGrad;
  ctx.fill();
  ctx.strokeStyle = '#1e3a8a';
  ctx.lineWidth = 2.6;
  ctx.stroke();

  // Đường viền kính bao ngoài thứ 2 (Double-line glass facade mullion rim)
  ctx.strokeStyle = '#eff6ff';
  ctx.lineWidth = 1.1;
  ctx.stroke();

  // --------------------------------------------------------------------------
  // 4. WIDENED RING CORRIDORS AROUND ALL 3 ATRIUMS (RỘNG RÃI, CHUẨN TRỤC TUẦN TRA 3 SẾP)
  // --------------------------------------------------------------------------
  const corridorBands: IsoSubRect[] = [
    // North Atrium Wide Ring Corridor (col 12..20 [x=375..615], row 4..8 [y=135..255] — Lộ trình Sếp ToanLBK)
    { wx: 195, wy: 122, ww: 552, wh: 28 }, // North Top Wide Corridor (row 4)
    { wx: 356, wy: 122, ww: 40, wh: 150 }, // North West Wide Corridor (col 12)
    { wx: 356, wy: 244, ww: 276, wh: 28 }, // North Bottom Wide Corridor (row 8)
    { wx: 594, wy: 122, ww: 40, wh: 256 }, // North East Wide Corridor (col 20)
    { wx: 594, wy: 208, ww: 220, wh: 30 }, // North-East Connector to 🚪 CỬA RA VÀO (row 7)

    // Central Grand Atrium Wide Ring Corridor (col 19..26 [x=585..795], row 12..17 [y=375..525] — Lộ trình Sếp doannt19)
    { wx: 564, wy: 360, ww: 248, wh: 28 }, // Central Top Wide Corridor (row 12)
    { wx: 564, wy: 360, ww: 40, wh: 285 }, // Central West Spine Wide Corridor (col 19)
    { wx: 564, wy: 510, ww: 248, wh: 28 }, // Central Bottom Wide Corridor (row 17)
    { wx: 774, wy: 208, ww: 38, wh: 450 }, // Central East Wide Corridor bordering Khoang NHÀ THUỐC (col 26)

    // South Atrium Wide Ring Corridor (col 15..23 [x=465..705], row 21..26 [y=645..795] — Lộ trình Sếp vanltb8)
    { wx: 444, wy: 630, ww: 368, wh: 28 }, // South Top Wide Corridor (row 21)
    { wx: 444, wy: 630, ww: 44, wh: 182 }, // South West Wide Corridor (col 15)
    { wx: 684, wy: 630, ww: 44, wh: 182 }, // South East Wide Corridor (col 23)
    { wx: 268, wy: 780, ww: 548, wh: 32 }, // South Bottom Wide Corridor (row 26)
  ];

  for (const cb of corridorBands) {
    const bandPts = buildIsoStadiumPoints(cb.wx, cb.wy, cb.ww, cb.wh, 10, 8.8);
    tracePolygonPath(ctx, bandPts);
    const cbGrad = ctx.createLinearGradient(
      bandPts[0].x,
      bandPts[0].y,
      bandPts[Math.floor(bandPts.length / 2)].x,
      bandPts[Math.floor(bandPts.length / 2)].y
    );
    cbGrad.addColorStop(0, '#eff6ff');
    cbGrad.addColorStop(0.55, '#dbeafe');
    cbGrad.addColorStop(1, '#bfdbfe');
    ctx.fillStyle = cbGrad;
    ctx.fill();
  }

  // Stippled CAD grid dots on Ring Corridors
  ctx.fillStyle = 'rgba(30, 64, 175, 0.20)';
  for (const cb of corridorBands) {
    for (let gx = cb.wx + 12; gx < cb.wx + cb.ww - 6; gx += 18) {
      for (let gy = cb.wy + 12; gy < cb.wy + cb.wh - 6; gy += 18) {
        const pt = worldToIso(gx, gy, 8.9);
        ctx.fillRect(pt.x - 0.8, pt.y - 0.8, 1.6, 1.6);
      }
    }
  }

  // --------------------------------------------------------------------------
  // 5. THE 3 RECESSED OPEN COURTYARD ATRIUMS (NORTH, CENTRAL GRAND, SOUTH)
  // --------------------------------------------------------------------------
  for (const atrium of COURTYARD_ATRIUMS) {
    drawRecessedCourtyardAtrium(ctx, atrium, time);
  }

  // --------------------------------------------------------------------------
  // 6. THE 8 ARCHITECTURAL SERVICE / ELEVATOR / STAIR / WC CORES + SE PATIO
  // --------------------------------------------------------------------------
  drawBuildingServiceCores(ctx);

  // Vườn treo góc Đông-Nam (PATIO-SE)
  drawIsoBox(
    ctx,
    724,
    604,
    102,
    42,
    8.5,
    9.5,
    '#dcfce7',
    '#86efac',
    '#4ade80',
    '#16a34a',
    0.8
  );

  ctx.restore();
}

/**
 * Helper tạo danh sách điểm đa giác hình chữ nhật bo góc (Stadium / Pill-shaped Concentric Ring)
 * trong không gian thế giới (wx, wy) rồi chiếu sang Isometric (wz)
 */
function buildIsoStadiumPoints(
  wx: number,
  wy: number,
  ww: number,
  wh: number,
  cornerRadius: number,
  wz: number
): Point2D[] {
  const r = Math.min(cornerRadius, ww * 0.46, wh * 0.46);
  const stepsPerCorner = 5;
  const pts: Point2D[] = [];
  const corners = [
    { cx: wx + ww - r, cy: wy + r, a0: -Math.PI / 2, a1: 0 },
    { cx: wx + ww - r, cy: wy + wh - r, a0: 0, a1: Math.PI / 2 },
    { cx: wx + r, cy: wy + wh - r, a0: Math.PI / 2, a1: Math.PI },
    { cx: wx + r, cy: wy + r, a0: Math.PI, a1: (Math.PI * 3) / 2 },
  ];
  for (const c of corners) {
    for (let s = 0; s <= stepsPerCorner; s++) {
      const ang = c.a0 + ((c.a1 - c.a0) * s) / stepsPerCorner;
      const px = c.cx + Math.cos(ang) * r;
      const py = c.cy + Math.sin(ang) * r;
      pts.push(worldToIso(px, py, wz));
    }
  }
  return pts;
}

function tracePolygonPath(ctx: CanvasRenderingContext2D, pts: Point2D[]) {
  if (pts.length === 0) return;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) {
    ctx.lineTo(pts[i].x, pts[i].y);
  }
  ctx.closePath();
}

/**
 * PHẦN A — VẼ LẠI 3 GIẾNG TRỜI (`drawCourtyardAtrium`) VỚI HÀNH LANG ĐÁ XÁM MỞ RỘNG & GHẾ SOFA NGHỈ CHÂN:
 */
export function drawCourtyardAtrium(
  ctx: CanvasRenderingContext2D,
  atrium: CourtyardAtrium,
  time: number
) {
  const { wx, wy, ww, wh, name } = atrium;
  const zPromenade = 8.95; // Mặt sân đi bộ lát đá xám mở rộng nơi anh em đứng hút thuốc & ngồi nghỉ

  ctx.save();

  // ==========================================================================
  // 0. NỀN SÂN ĐÁ XÁM KẺ SỌC DÀI MỞ RỘNG (`Wide Grey Stone Promenade & Lounge Benches`)
  // ==========================================================================
  const promPad = 14; // Nới rộng hành lang sân đá xám bao quanh giếng trời thêm thoáng đãng
  const promPts = buildIsoStadiumPoints(
    wx - promPad,
    wy - promPad,
    ww + promPad * 2,
    wh + promPad * 2,
    22,
    zPromenade
  );
  tracePolygonPath(ctx, promPts);
  const promGrad = ctx.createLinearGradient(promPts[0].x, promPts[0].y, promPts[10].x, promPts[10].y);
  promGrad.addColorStop(0, '#cbd5e1');
  promGrad.addColorStop(0.5, '#e2e8f0');
  promGrad.addColorStop(1, '#94a3b8');
  ctx.fillStyle = promGrad;
  ctx.fill();
  ctx.strokeStyle = '#64748b';
  ctx.lineWidth = 1.3;
  ctx.stroke();

  // Sọc đá lát dài (`#94a3b8` / `#cbd5e1`) trên sân đi bộ mở rộng bao quanh giếng trời
  ctx.strokeStyle = 'rgba(100, 116, 139, 0.36)';
  ctx.lineWidth = 0.85;
  for (let stripeY = wy - promPad + 6; stripeY <= wy + wh + promPad - 6; stripeY += 12) {
    const s0 = worldToIso(wx - promPad + 4, stripeY, zPromenade + 0.05);
    const s1 = worldToIso(wx + ww + promPad - 4, stripeY, zPromenade + 0.05);
    ctx.beginPath();
    ctx.moveTo(s0.x, s0.y);
    ctx.lineTo(s1.x, s1.y);
    ctx.stroke();
  }
  for (let stripeX = wx - promPad + 6; stripeX <= wx + ww + promPad - 6; stripeX += 16) {
    const s0 = worldToIso(stripeX, wy - promPad + 4, zPromenade + 0.05);
    const s1 = worldToIso(stripeX, wy + wh + promPad - 4, zPromenade + 0.05);
    ctx.beginPath();
    ctx.moveTo(s0.x, s0.y);
    ctx.lineTo(s1.x, s1.y);
    ctx.stroke();
  }

  // Cụm ghế băng gỗ có đệm mềm mại dọc theo hành lang mở rộng quanh Giếng trời
  const loungeSeats: { bx: number; by: number; bw: number; bh: number; cushion: string }[] = [
    { bx: wx + 18, by: wy - promPad + 2, bw: 26, bh: 8, cushion: '#38bdf8' },
    { bx: wx + ww - 44, by: wy - promPad + 2, bw: 26, bh: 8, cushion: '#34d399' },
    { bx: wx + 18, by: wy + wh + promPad - 10, bw: 26, bh: 8, cushion: '#fbbf24' },
    { bx: wx + ww - 44, by: wy + wh + promPad - 10, bw: 26, bh: 8, cushion: '#f472b6' },
  ];
  for (const seat of loungeSeats) {
    drawSoftRoundedExtrusion(
      ctx,
      seat.bx,
      seat.by,
      seat.bw,
      seat.bh,
      3.5,
      zPromenade + 0.1,
      zPromenade + 4.2,
      seat.cushion,
      '#d97706',
      '#b45309'
    );
  }

  // Viền gạch đỏ nâu (`Terracotta trim #9a3412`) bao quanh chân bồn cây trung tâm
  const pad1 = 13;
  const terraPts = buildIsoStadiumPoints(
    wx + pad1 - 3.5,
    wy + pad1 - 3.5,
    ww - (pad1 - 3.5) * 2,
    wh - (pad1 - 3.5) * 2,
    24,
    zPromenade + 0.25
  );
  tracePolygonPath(ctx, terraPts);
  ctx.fillStyle = '#9a3412';
  ctx.fill();
  ctx.strokeStyle = '#7c2d12';
  ctx.lineWidth = 1.2;
  ctx.stroke();

  // ==========================================================================
  // 1. LỚP ĐỒNG TÂM #1 (VÒNG NGOÀI) — BỒN CÂY NHIỆT ĐỚI XANH MƯỚT & GỜ BÊ TÔNG TRẮNG BO TRÒN
  // ==========================================================================
  const zPlanterCurb = zPromenade + 2.2;
  const outerCurbPts = buildIsoStadiumPoints(
    wx + pad1,
    wy + pad1,
    ww - pad1 * 2,
    wh - pad1 * 2,
    22,
    zPlanterCurb
  );
  tracePolygonPath(ctx, outerCurbPts);
  ctx.fillStyle = '#f1f5f9';
  ctx.fill();
  ctx.strokeStyle = '#cbd5e1';
  ctx.lineWidth = 1.6;
  ctx.stroke();

  // Lòng bồn cây nhiệt đới xanh đậm/xanh non (`#15803d`, `#16a34a`, `#22c55e`)
  const padPlantInner = pad1 + 3.5;
  const foliageOuterPts = buildIsoStadiumPoints(
    wx + padPlantInner,
    wy + padPlantInner,
    ww - padPlantInner * 2,
    wh - padPlantInner * 2,
    20,
    zPlanterCurb + 0.5
  );
  tracePolygonPath(ctx, foliageOuterPts);
  ctx.fillStyle = '#15803d';
  ctx.fill();

  // Vẽ các bụi cây lá bản to nhiệt đới dày đặc quanh vòng ngoài + hoa vàng cam ở 4 góc bo
  const ring1Rx = (ww - padPlantInner * 2) * 0.44;
  const ring1Ry = (wh - padPlantInner * 2) * 0.42;
  const centerWx = wx + ww * 0.5;
  const centerWy = wy + wh * 0.5;
  const bushCount = 28;
  for (let i = 0; i < bushCount; i++) {
    const ang = (i / bushCount) * Math.PI * 2;
    // Biến điệu bán kính để bám theo hình chữ nhật bo góc (superellipse / stadium)
    const cosA = Math.cos(ang);
    const sinA = Math.sin(ang);
    const stretch = 1 / Math.pow(Math.pow(Math.abs(cosA), 2.6) + Math.pow(Math.abs(sinA), 2.6), 1 / 2.6);
    const bx = centerWx + cosA * ring1Rx * stretch;
    const by = centerWy + sinA * ring1Ry * stretch;
    const bIso = worldToIso(bx, by, zPlanterCurb + 1.8);
    const colors = ['#15803d', '#16a34a', '#22c55e'];
    ctx.fillStyle = colors[i % colors.length];
    ctx.beginPath();
    ctx.arc(bIso.x, bIso.y, i % 2 === 0 ? 5.2 : 4.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#4ade80';
    ctx.beginPath();
    ctx.arc(bIso.x - 1.2, bIso.y - 1.2, 2.1, 0, Math.PI * 2);
    ctx.fill();

    // Điểm xuyết hoa nhỏ màu vàng cam ở các góc bo tròn
    if (i % 7 === 3 || i % 7 === 4) {
      ctx.fillStyle = i % 2 === 0 ? '#f59e0b' : '#fb923c';
      ctx.beginPath();
      ctx.arc(bIso.x + 1.8, bIso.y - 0.8, 1.65, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // ==========================================================================
  // 2. LỚP ĐỒNG TÂM #2 (VÒNG GIỮA) — HỒ NƯỚC RÃNH BO TRÒN TRỒNG HOA SÚNG / LÁ SEN (`Curved Lotus Water Moat`)
  // ==========================================================================
  const padMoatOuter = 27;
  const zMoatCurb = zPromenade + 2.4;
  const moatOuterCurbPts = buildIsoStadiumPoints(
    wx + padMoatOuter,
    wy + padMoatOuter,
    ww - padMoatOuter * 2,
    wh - padMoatOuter * 2,
    18,
    zMoatCurb
  );
  tracePolygonPath(ctx, moatOuterCurbPts);
  ctx.fillStyle = '#ffffff'; // Thành hồ sơn trắng nổi bật
  ctx.fill();
  ctx.strokeStyle = '#94a3b8';
  ctx.lineWidth = 1.2;
  ctx.stroke();

  // Mặt nước hồ súng màu xanh ngọc trầm/rêu (`#134e4a` / `#115e59` / `#0f766e`)
  const padWater = padMoatOuter + 3.0;
  const zWater = zPromenade + 1.1;
  const waterPts = buildIsoStadiumPoints(
    wx + padWater,
    wy + padWater,
    ww - padWater * 2,
    wh - padWater * 2,
    16,
    zWater
  );
  tracePolygonPath(ctx, waterPts);
  const waterGrad = ctx.createLinearGradient(waterPts[0].x, waterPts[0].y, waterPts[10].x, waterPts[10].y);
  waterGrad.addColorStop(0, '#134e4a');
  waterGrad.addColorStop(0.5, '#0f766e');
  waterGrad.addColorStop(1, '#115e59');
  ctx.fillStyle = waterGrad;
  ctx.fill();

  // Cụm lá súng / lá sen tròn màu xanh (`#22c55e`, `#4ade80`) & bông hoa súng hồng/trắng nổi trên mặt hồ rãnh bo tròn
  const moatMidRx = (ww - (padWater + 8) * 2) * 0.46;
  const moatMidRy = (wh - (padWater + 8) * 2) * 0.44;
  const lotusCount = 18;
  for (let l = 0; l < lotusCount; l++) {
    const ang = (l / lotusCount) * Math.PI * 2 + Math.sin(time * 0.0015 + l) * 0.03;
    const cosA = Math.cos(ang);
    const sinA = Math.sin(ang);
    const stretch = 1 / Math.pow(Math.pow(Math.abs(cosA), 2.5) + Math.pow(Math.abs(sinA), 2.5), 1 / 2.5);
    const lx = centerWx + cosA * moatMidRx * stretch;
    const ly = centerWy + sinA * moatMidRy * stretch;
    const lIso = worldToIso(lx, ly, zWater + 0.3);

    // Lá sen / lá súng tròn
    ctx.fillStyle = l % 2 === 0 ? '#22c55e' : '#4ade80';
    ctx.beginPath();
    ctx.ellipse(lIso.x, lIso.y, 3.8, 2.2, 0, 0.2, Math.PI * 1.92);
    ctx.fill();

    // Bông hoa súng hồng / trắng nhỏ xinh
    if (l % 3 === 0) {
      ctx.fillStyle = l % 6 === 0 ? '#f472b6' : '#fdf2f8';
      ctx.beginPath();
      ctx.arc(lIso.x + 1.1, lIso.y - 0.8, 1.55, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#facc15';
      ctx.beginPath();
      ctx.arc(lIso.x + 1.1, lIso.y - 0.8, 0.65, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Thành hồ trắng bên trong (`Inner White Moat Curb #ffffff`)
  const padInnerCurb = 42;
  const moatInnerCurbPts = buildIsoStadiumPoints(
    wx + padInnerCurb,
    wy + padInnerCurb,
    ww - padInnerCurb * 2,
    wh - padInnerCurb * 2,
    14,
    zMoatCurb
  );
  tracePolygonPath(ctx, moatInnerCurbPts);
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.strokeStyle = '#cbd5e1';
  ctx.lineWidth = 1.1;
  ctx.stroke();

  // ==========================================================================
  // 3. LỚP ĐỒNG TÂM #3 (VÒNG TRONG) — BỜ CÂY RỦ & GIẾNG SÂU TƯỜNG ĐỎ ĐÔ THÔNG TẦNG HẦM (`Deep Crimson/Terracotta Sunken Pit`)
  // ==========================================================================
  const padPit = 46;
  const pitWx = wx + padPit;
  const pitWy = wy + padPit;
  const pitWw = Math.max(44, ww - padPit * 2);
  const pitWh = Math.max(32, wh - padPit * 2);
  const zPitTop = zPromenade + 1.8;
  const zPitBottom = -11.5; // Khoét sâu xuống tầng hầm bên dưới

  // Vành cỏ xanh dày bao quanh miệng giếng sâu
  const turfRingPts = buildIsoStadiumPoints(
    pitWx - 2.5,
    pitWy - 2.5,
    pitWw + 5,
    pitWh + 5,
    13,
    zPitTop + 0.4
  );
  tracePolygonPath(ctx, turfRingPts);
  ctx.fillStyle = '#16a34a';
  ctx.fill();

  const pitTopPts = buildIsoStadiumPoints(pitWx, pitWy, pitWw, pitWh, 12, zPitTop);
  const pitBotPts = buildIsoStadiumPoints(pitWx, pitWy, pitWw, pitWh, 12, zPitBottom);

  // Vẽ bức tường vách đứng màu Đỏ Đô / Đỏ Gạch Nung (`#991b1b` / `#b91c1c` / `#7f1d1d`) thông xuống tầng hầm
  for (let i = 0; i < pitTopPts.length; i++) {
    const next = (i + 1) % pitTopPts.length;
    const t0 = pitTopPts[i];
    const t1 = pitTopPts[next];
    const b1 = pitBotPts[next];
    const b0 = pitBotPts[i];
    ctx.beginPath();
    ctx.moveTo(t0.x, t0.y);
    ctx.lineTo(t1.x, t1.y);
    ctx.lineTo(b1.x, b1.y);
    ctx.lineTo(b0.x, b0.y);
    ctx.closePath();
    ctx.fillStyle = i < pitTopPts.length * 0.45 ? '#b91c1c' : i < pitTopPts.length * 0.75 ? '#991b1b' : '#7f1d1d';
    ctx.fill();
  }

  // Các cây cột tròn trắng chống đỡ dưới khoảng thông tầng màu đỏ đô (Basement White Support Columns)
  const pitColumns: [number, number][] = [
    [pitWx + 6, pitWy + 5],
    [pitWx + pitWw * 0.5, pitWy + 4],
    [pitWx + pitWw - 6, pitWy + 5],
    [pitWx + 5, pitWy + pitWh * 0.5],
    [pitWx + pitWw - 5, pitWy + pitWh * 0.5],
  ];
  for (const [colX, colY] of pitColumns) {
    const cTop = worldToIso(colX, colY, zPitTop - 1.5);
    const cBot = worldToIso(colX, colY, zPitBottom + 1.0);
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 3.6;
    ctx.beginPath();
    ctx.moveTo(cTop.x, cTop.y);
    ctx.lineTo(cBot.x, cBot.y);
    ctx.stroke();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(cTop.x - 0.6, cTop.y);
    ctx.lineTo(cBot.x - 0.6, cBot.y);
    ctx.stroke();
  }

  // Dây leo xanh rủ xuống (`Hanging Green Vines`) phủ trên bức tường Đỏ Đô thông tầng hầm
  for (let i = 0; i < pitTopPts.length; i++) {
    const pt = pitTopPts[i];
    const vineLen = 4.5 + ((i * 7) % 6) * 1.35;
    ctx.strokeStyle = i % 2 === 0 ? '#22c55e' : '#15803d';
    ctx.lineWidth = 2.1;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(pt.x, pt.y);
    ctx.lineTo(pt.x, pt.y + vineLen);
    ctx.stroke();
  }

  // ==========================================================================
  // 4. LỚP ĐỒNG TÂM #4 (TÂM GIẾNG TRỜI) — ĐẢO SỎI OVAL & 2 CÂY CỌ / DỪA CẢNH CAO VÚT (`Central Oval Pebble Island & Twin Palm Trees`)
  // ==========================================================================
  // Mặt sân trải sỏi xám (`#64748b`) dưới đáy giếng thông tầng
  tracePolygonPath(ctx, pitBotPts);
  ctx.fillStyle = '#64748b';
  ctx.fill();
  ctx.strokeStyle = '#475569';
  ctx.lineWidth = 1.2;
  ctx.stroke();

  // Hạt sỏi nhỏ lấm tấm trên mặt đáy giếng
  ctx.fillStyle = '#94a3b8';
  for (let px = pitWx + 8; px < pitWx + pitWw - 8; px += 10) {
    for (let py = pitWy + 6; py < pitWy + pitWh - 6; py += 9) {
      const pIso = worldToIso(px, py, zPitBottom + 0.3);
      ctx.fillRect(pIso.x - 0.8, pIso.y - 0.8, 1.6, 1.2);
    }
  }

  // Bồn cây hình Oval viền trắng đôi (`#f8fafc`) ở chính giữa đáy giếng
  const ovalCenterIso = worldToIso(centerWx, centerWy, zPitBottom + 1.4);
  const ovalRx = Math.max(14, pitWw * 0.28);
  const ovalRy = Math.max(8, pitWh * 0.22);

  // Viền trắng ngoài của bồn Oval
  ctx.fillStyle = '#f8fafc';
  ctx.strokeStyle = '#cbd5e1';
  ctx.lineWidth = 1.3;
  ctx.beginPath();
  ctx.ellipse(ovalCenterIso.x, ovalCenterIso.y, ovalRx + 3.5, ovalRy + 2.2, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // Viền trắng trong thứ 2 & thảm cỏ xanh trong lòng bồn Oval
  ctx.fillStyle = '#15803d';
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.ellipse(ovalCenterIso.x, ovalCenterIso.y, ovalRx, ovalRy, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  // 2 Cây Cọ / Dừa cảnh cao vút (`Twin Fan Palms`) thân nâu có đốt, tán lá cọ xòe tròn xanh mướt vươn cao lên giữa lòng giếng trời!
  const palmOffsets = [-pitWw * 0.12, pitWw * 0.12];
  for (let pIdx = 0; pIdx < palmOffsets.length; pIdx++) {
    const palmWx = centerWx + palmOffsets[pIdx];
    const palmWy = centerWy + (pIdx === 0 ? -1.5 : 1.5);
    const trunkBaseZ = zPitBottom + 2.0;
    const trunkTopZ = zPromenade + (pIdx === 0 ? 18.5 : 15.0);
    const sway = Math.sin(time * 0.0024 + pIdx * 2.1) * 1.4;

    // Vẽ thân cây cọ màu nâu có đốt tròn (`Segmented Brown Palm Trunk`)
    const segments = 7;
    for (let s = 0; s < segments; s++) {
      const z0 = trunkBaseZ + ((trunkTopZ - trunkBaseZ) * s) / segments;
      const z1 = trunkBaseZ + ((trunkTopZ - trunkBaseZ) * (s + 1)) / segments;
      const segP0 = worldToIso(palmWx, palmWy, z0);
      const segP1 = worldToIso(palmWx, palmWy, z1);
      const curveX = (s / segments) * (pIdx === 0 ? -2.2 : 2.2) + sway * (s / segments);

      ctx.strokeStyle = s % 2 === 0 ? '#78350f' : '#92400e';
      ctx.lineWidth = 3.8 - (s / segments) * 1.0;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(segP0.x + curveX * 0.7, segP0.y);
      ctx.lineTo(segP1.x + curveX, segP1.y);
      ctx.stroke();

      // Vòng đốt trắng/nâu nhạt trên thân cọ
      ctx.strokeStyle = '#b45309';
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.moveTo(segP1.x + curveX - 1.8, segP1.y);
      ctx.lineTo(segP1.x + curveX + 1.8, segP1.y);
      ctx.stroke();
    }

    // Tán lá Cọ / Dừa cảnh xòe tròn 10 tàu lá xanh mướt (`Lush Fan Palm Fronds`)
    const crownIso = worldToIso(palmWx, palmWy, trunkTopZ);
    const crownX = crownIso.x + (pIdx === 0 ? -2.2 : 2.2) + sway;
    const crownY = crownIso.y;
    const frondCount = 10;
    for (let f = 0; f < frondCount; f++) {
      const fAng = (f / frondCount) * Math.PI * 2 + sway * 0.04;
      const frondLen = f % 2 === 0 ? 14.5 : 11.5;
      const tipX = crownX + Math.cos(fAng) * frondLen;
      const tipY = crownY + Math.sin(fAng) * (frondLen * 0.62) + 1.8;
      const ctrlX = crownX + Math.cos(fAng) * (frondLen * 0.55);
      const ctrlY = crownY + Math.sin(fAng) * (frondLen * 0.32) - 3.2;

      ctx.strokeStyle = f % 3 === 0 ? '#15803d' : f % 3 === 1 ? '#16a34a' : '#22c55e';
      ctx.lineWidth = f % 2 === 0 ? 3.0 : 2.3;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(crownX, crownY);
      ctx.quadraticCurveTo(ctrlX, ctrlY, tipX, tipY);
      ctx.stroke();

      // Highlight tàu lá cọ non bắt nắng
      ctx.strokeStyle = '#4ade80';
      ctx.lineWidth = 1.0;
      ctx.beginPath();
      ctx.moveTo(crownX, crownY - 0.5);
      ctx.quadraticCurveTo(ctrlX, ctrlY - 0.8, tipX, tipY - 0.5);
      ctx.stroke();
    }

    // Tâm đọt cọ xanh non
    ctx.fillStyle = '#86efac';
    ctx.beginPath();
    ctx.arc(crownX, crownY, 2.6, 0, Math.PI * 2);
    ctx.fill();
  }

  // ==========================================================================
  // 5. HÀNG CỘT TRỤ TRÒN MÀU TRẮNG (`#f8fafc`) & DẢI LAN CAN BAN CÔNG TRẮNG CHẤM BI BAO QUANH GIẾNG TRỜI
  // ==========================================================================
  const balconyBandPts = buildIsoStadiumPoints(wx - 1, wy - 1, ww + 2, wh + 2, 15, zPromenade + 13.5);
  const balconyBandTopPts = buildIsoStadiumPoints(wx - 1, wy - 1, ww + 2, wh + 2, 15, zPromenade + 17.5);

  // Vẽ dải lan can ban công trắng uốn cong bao quanh miệng giếng trời
  for (let i = 0; i < balconyBandPts.length; i++) {
    const next = (i + 1) % balconyBandPts.length;
    ctx.beginPath();
    ctx.moveTo(balconyBandPts[i].x, balconyBandPts[i].y);
    ctx.lineTo(balconyBandPts[next].x, balconyBandPts[next].y);
    ctx.lineTo(balconyBandTopPts[next].x, balconyBandTopPts[next].y);
    ctx.lineTo(balconyBandTopPts[i].x, balconyBandTopPts[i].y);
    ctx.closePath();
    ctx.fillStyle = 'rgba(248, 250, 252, 0.88)';
    ctx.fill();
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 0.7;
    ctx.stroke();

    // Hoa văn chấm bi trang trí đặc trưng trên dải ban công trắng tòa nhà FRT
    const midDotX = (balconyBandPts[i].x + balconyBandTopPts[next].x) * 0.5;
    const midDotY = (balconyBandPts[i].y + balconyBandTopPts[next].y) * 0.5;
    ctx.fillStyle = '#64748b';
    ctx.beginPath();
    ctx.arc(midDotX, midDotY, 0.85, 0, Math.PI * 2);
    ctx.fill();
  }

  // Hàng cột trụ tròn màu trắng (`#f8fafc` có bóng đổ 3D) dọc theo 4 cạnh hành lang bao quanh giếng trời
  const perimeterPillarCoords: [number, number][] = [
    [wx + 12, wy - 1],
    [wx + ww * 0.36, wy - 1],
    [wx + ww * 0.64, wy - 1],
    [wx + ww - 12, wy - 1],
    [wx + 12, wy + wh + 1],
    [wx + ww * 0.36, wy + wh + 1],
    [wx + ww * 0.64, wy + wh + 1],
    [wx + ww - 12, wy + wh + 1],
    [wx - 1, wy + wh * 0.28],
    [wx - 1, wy + wh * 0.72],
    [wx + ww + 1, wy + wh * 0.28],
    [wx + ww + 1, wy + wh * 0.72],
  ];

  for (const [px, py] of perimeterPillarCoords) {
    const pBase = worldToIso(px, py, zPromenade);
    const pTop = worldToIso(px, py, zPromenade + 17.5);
    // Bóng đổ chân cột tròn
    ctx.fillStyle = 'rgba(15, 23, 42, 0.18)';
    ctx.beginPath();
    ctx.ellipse(pBase.x + 2.2, pBase.y + 1.0, 4.2, 2.2, 0, 0, Math.PI * 2);
    ctx.fill();

    // Thân cột trụ tròn màu trắng 3D
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 4.6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(pBase.x, pBase.y);
    ctx.lineTo(pTop.x, pTop.y);
    ctx.stroke();

    ctx.strokeStyle = '#f8fafc';
    ctx.lineWidth = 2.8;
    ctx.beginPath();
    ctx.moveTo(pBase.x - 0.7, pBase.y);
    ctx.lineTo(pTop.x - 0.7, pTop.y);
    ctx.stroke();
  }

  // Nhãn tên Giếng trời FRT tinh tế
  const labelIso = worldToIso(wx + ww * 0.5, wy + 7, zPromenade + 3.5);
  ctx.font = '800 8px Inter, system-ui, sans-serif';
  const atriumTitle = `🌴 ${name.toUpperCase()} • KHU HÚT THUỐC`;
  const lw = ctx.measureText(atriumTitle).width + 14;
  drawRoundedRect(ctx, labelIso.x - lw / 2, labelIso.y - 7, lw, 14, 4.5);
  ctx.fillStyle = 'rgba(15, 23, 42, 0.82)';
  ctx.fill();
  ctx.strokeStyle = '#4ade80';
  ctx.lineWidth = 1.0;
  ctx.stroke();
  ctx.fillStyle = '#f8fafc';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(atriumTitle, labelIso.x, labelIso.y + 0.3);

  ctx.restore();
}

/**
 * Vẽ 1 Giếng trời / Sân vườn mở (Recessed Open Courtyard Atrium) theo đúng kiến trúc 4 lớp đồng tâm FRT
 */
function drawRecessedCourtyardAtrium(
  ctx: CanvasRenderingContext2D,
  atrium: CourtyardAtrium,
  time: number
) {
  drawCourtyardAtrium(ctx, atrium, time);
}

/**
 * Vẽ 8 Cụm Lõi Thang máy / Cầu thang bộ / WC kỹ thuật (Service Cores)
 * ở đúng vị trí giao giữa các khoang phòng như trong sơ đồ CAD
 */
function drawBuildingServiceCores(ctx: CanvasRenderingContext2D) {
  for (const core of BUILDING_SERVICE_CORES) {
    const { wx, wy, ww, wh, label, hasElevator, hasStairs } = core;

    // 1. Nền khu vực kỹ thuật/thang máy màu xanh lam nhạt đúng như sơ đồ mặt bằng
    drawIsoBox(
      ctx,
      wx,
      wy,
      ww,
      wh,
      8.5,
      11.5,
      '#93c5fd',
      '#60a5fa',
      '#3b82f6',
      '#1d4ed8',
      0.9
    );

    // 2. Tường vách ngăn kỹ thuật 3D dạng Cutaway (z = 11.5 -> 22)
    drawIsoBox(
      ctx,
      wx,
      wy,
      ww,
      3.5,
      11.5,
      22,
      '#1e3a8a',
      '#dbeafe',
      '#93c5fd',
      '#1e40af',
      0.65
    );
    drawIsoBox(
      ctx,
      wx,
      wy,
      3.5,
      wh,
      11.5,
      22,
      '#1e3a8a',
      '#93c5fd',
      '#bfdbfe',
      '#1e40af',
      0.65
    );

    // 3. Khối Lõi Thang máy 3D (Elevator Shaft with metallic doors)
    if (hasElevator) {
      drawIsoBox(
        ctx,
        wx + 6,
        wy + 6,
        Math.min(24, ww * 0.36),
        Math.min(20, wh * 0.48),
        11.5,
        26,
        '#334155',
        '#475569',
        '#1e293b',
        '#0f172a',
        0.7
      );
    }

    // 4. Cầu thang bộ 3D nhiều bậc (Stepped Staircase Treads như ký hiệu thang bộ CAD)
    if (hasStairs) {
      const stairX = wx + ww * 0.52;
      const stairW = Math.min(26, ww * 0.38);
      for (let step = 0; step < 4; step++) {
        drawIsoBox(
          ctx,
          stairX,
          wy + 7 + step * 5.5,
          stairW,
          5,
          11.5,
          13.5 + step * 2.4,
          '#e2e8f0',
          '#94a3b8',
          '#64748b',
          '#334155',
          0.45
        );
      }
    }

    // Nhãn ký hiệu kỹ thuật nhỏ gọn
    const lblIso = worldToIso(wx + ww * 0.5, wy + wh * 0.78, 16);
    ctx.save();
    ctx.font = '700 6.5px monospace';
    ctx.fillStyle = '#1e3a8a';
    ctx.textAlign = 'center';
    ctx.fillText(label, lblIso.x, lblIso.y);
    ctx.restore();
  }
}

/** Vẽ cây xanh 3D Low-Poly 3 tầng bóng đổ chuẩn Flezimercuria */
export function drawIsoLowPolyTree(
  ctx: CanvasRenderingContext2D,
  wx: number,
  wy: number,
  scale: number,
  variant: 'pine' | 'round' | 'cypress',
  time: number
) {
  const base = worldToIso(wx, wy, 0);
  const sway = Math.sin(time * 0.002 + wx * 0.1) * 1.1;

  ctx.save();
  // Soft ground shadow
  ctx.fillStyle = 'rgba(15, 23, 42, 0.14)';
  ctx.beginPath();
  ctx.ellipse(base.x + 5, base.y + 2, 14 * scale, 7 * scale, 0, 0, Math.PI * 2);
  ctx.fill();

  // Planter box / soil base
  drawIsoBox(
    ctx,
    wx - 5.5 * scale,
    wy - 5.5 * scale,
    11 * scale,
    11 * scale,
    0,
    3.5 * scale,
    '#d6d3d1',
    '#a8a29e',
    '#78716c',
    '#57534e',
    0.6
  );

  // 3D Tree Trunk
  drawIsoBox(
    ctx,
    wx - 2.6 * scale,
    wy - 2.6 * scale,
    5.2 * scale,
    5.2 * scale,
    3 * scale,
    13 * scale,
    '#92400e',
    '#78350f',
    '#451a03'
  );

  if (variant === 'round') {
    const lobes = [
      { dx: -4, dy: 2, dz: 18, r: 9.5, col: '#16a34a', hi: '#4ade80' },
      { dx: 5, dy: 2, dz: 17, r: 9.0, col: '#15803d', hi: '#22c55e' },
      { dx: 0, dy: -3, dz: 25, r: 10.5, col: '#22c55e', hi: '#86efac' },
    ];
    for (const l of lobes) {
      const p = worldToIso(wx + l.dx * scale, wy + l.dy * scale, l.dz * scale);
      const lx = p.x + sway;
      const ly = p.y;
      ctx.fillStyle = l.col;
      ctx.beginPath();
      ctx.arc(lx, ly, l.r * scale, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = l.hi;
      ctx.beginPath();
      ctx.arc(lx - 2.2 * scale, ly - 2.4 * scale, l.r * 0.58 * scale, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (variant === 'cypress') {
    drawIsoBox(
      ctx,
      wx - 6 * scale,
      wy - 6 * scale,
      12 * scale,
      12 * scale,
      11 * scale,
      23 * scale,
      '#4ade80',
      '#22c55e',
      '#15803d',
      '#166534',
      0.5
    );
    drawIsoBox(
      ctx,
      wx - 4.2 * scale,
      wy - 4.2 * scale,
      8.4 * scale,
      8.4 * scale,
      23 * scale,
      33 * scale,
      '#86efac',
      '#4ade80',
      '#16a34a',
      '#15803d',
      0.5
    );
  } else {
    const tiers = [
      { z: 12 * scale, r: 13.5 * scale, h: 14 * scale, cLeft: '#22c55e', cRight: '#15803d' },
      { z: 21 * scale, r: 10.5 * scale, h: 13 * scale, cLeft: '#4ade80', cRight: '#16a34a' },
      { z: 29 * scale, r: 7.5 * scale, h: 11 * scale, cLeft: '#86efac', cRight: '#22c55e' },
    ];
    for (const t of tiers) {
      const pBase = worldToIso(wx, wy, t.z);
      const bx = pBase.x + sway * 0.6;
      const by = pBase.y;
      ctx.beginPath();
      ctx.moveTo(bx, by - t.h);
      ctx.lineTo(bx - t.r, by + 3);
      ctx.lineTo(bx, by + 7);
      ctx.closePath();
      ctx.fillStyle = t.cLeft;
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(bx, by - t.h);
      ctx.lineTo(bx + t.r, by + 3);
      ctx.lineTo(bx, by + 7);
      ctx.closePath();
      ctx.fillStyle = t.cRight;
      ctx.fill();
    }
  }
  ctx.restore();
}

/** Vẽ đèn đường Isometric, ghế gỗ nghỉ chân và cụm container màu kiểu Flezimercuria */
export function drawCampusStreetProp(
  ctx: CanvasRenderingContext2D,
  prop: (typeof CAMPUS_STREET_PROPS)[number]
) {
  const { wx, wy, kind } = prop;
  if (kind === 'lamp') {
    const base = worldToIso(wx, wy, 2);
    const top = worldToIso(wx, wy, 36);
    const arm = worldToIso(wx + 8, wy + 4, 35);
    ctx.save();
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(base.x, base.y);
    ctx.lineTo(top.x, top.y);
    ctx.lineTo(arm.x, arm.y);
    ctx.stroke();

    ctx.fillStyle = '#fef08a';
    ctx.beginPath();
    ctx.arc(arm.x, arm.y + 1, 2.8, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  } else if (kind === 'bench') {
    drawIsoBox(
      ctx,
      wx - 12,
      wy - 5,
      24,
      10,
      2,
      8,
      '#f59e0b',
      '#d97706',
      '#b45309',
      '#78350f',
      0.6
    );
  } else if (kind === 'containers') {
    drawIsoBox(ctx, wx - 14, wy - 18, 24, 14, 0, 14, '#f97316', '#ea580c', '#c2410c', '#7c2d12', 0.7);
    drawIsoBox(ctx, wx - 14, wy - 2, 24, 14, 0, 14, '#3b82f6', '#2563eb', '#1d4ed8', '#1e3a8a', 0.7);
    drawIsoBox(ctx, wx - 14, wy - 10, 24, 14, 14, 28, '#eab308', '#ca8a04', '#a16207', '#713f12', 0.7);
  }
}

// ============================================================================
// 5. CUTAWAY 3D WHITE OFFICE BAYS & SQUAD-SPECIFIC INTERIOR ARCHITECTURE
// ============================================================================

export function drawCutawayIsoZone(
  ctx: CanvasRenderingContext2D,
  z: IsoArchitecturalZone,
  time: number
) {
  const isNhaThuocBay = z.id === 'ISO-ZONE-05';
  const bays: IsoSubRect[] =
    z.subBays && z.subBays.length > 0
      ? z.subBays
      : [{ wx: z.wx, wy: z.wy, ww: z.ww, wh: z.wh }];

  for (let bIdx = 0; bIdx < bays.length; bIdx++) {
    const bay = bays[bIdx];

    // 1. Room Floor Slab (z: 8.5 -> 10.2)
    // Khoang NHÀ THUỐC (ISO-ZONE-05) dùng thảm xanh lá Sage/Mint Green (#7cb342 / #689f38) đúng như Excel Seat Map!
    drawIsoBox(
      ctx,
      bay.wx,
      bay.wy,
      bay.ww,
      bay.wh,
      8.5,
      10.2,
      isNhaThuocBay ? '#7cb342' : '#ffffff',
      isNhaThuocBay ? '#689f38' : '#e2e8f0',
      isNhaThuocBay ? '#558b2f' : '#cbd5e1',
      z.rimColor,
      isNhaThuocBay ? 1.55 : 1.15
    );

    // 2. Subtle Checkerboard & Architectural Tile Pattern on Bay Floor
    ctx.save();
    const tileW = 32;
    const tileH = 32;
    for (let tx = bay.wx + 4; tx < bay.wx + bay.ww - 6; tx += tileW) {
      for (let ty = bay.wy + 4; ty < bay.wy + bay.wh - 6; ty += tileH) {
        const colIdx = Math.round((tx - bay.wx) / tileW);
        const rowIdx = Math.round((ty - bay.wy) / tileH);
        if ((colIdx + rowIdx) % 2 === 1) {
          const w = Math.min(tileW, bay.wx + bay.ww - 4 - tx);
          const h = Math.min(tileH, bay.wy + bay.wh - 4 - ty);
          const p0 = worldToIso(tx, ty, 10.3);
          const p1 = worldToIso(tx + w, ty, 10.3);
          const p2 = worldToIso(tx + w, ty + h, 10.3);
          const p3 = worldToIso(tx, ty + h, 10.3);
          ctx.beginPath();
          ctx.moveTo(p0.x, p0.y);
          ctx.lineTo(p1.x, p1.y);
          ctx.lineTo(p2.x, p2.y);
          ctx.lineTo(p3.x, p3.y);
          ctx.closePath();
          ctx.fillStyle = isNhaThuocBay ? 'rgba(139, 195, 74, 0.42)' : z.floorTileB;
          ctx.fill();
        }
      }
    }
    ctx.restore();

    // 3. Structural Perimeter Columns (● 3D White Architectural Pillars như chấm cột trong bản vẽ CAD)
    const colPositions: [number, number][] = [
      [bay.wx + 5, bay.wy + 5],
      [bay.wx + bay.ww - 5, bay.wy + 5],
      [bay.wx + 5, bay.wy + bay.wh - 5],
      [bay.wx + bay.ww - 5, bay.wy + bay.wh - 5],
    ];
    if (bay.ww > 160 && !isNhaThuocBay) {
      colPositions.push([bay.wx + bay.ww * 0.5, bay.wy + 5]);
      colPositions.push([bay.wx + bay.ww * 0.5, bay.wy + bay.wh - 5]);
    }
    for (const [cx, cy] of colPositions) {
      drawIsoBox(
        ctx,
        cx - 2.2,
        cy - 2.2,
        4.4,
        4.4,
        10.2,
        18.5,
        '#ffffff',
        '#cbd5e1',
        '#94a3b8',
        '#475569',
        0.55
      );
    }

    // 4. Cutaway 3D Back Walls & Colored Cornice Cap on Primary Bay Segment
    const wallH = 26;
    if (isNhaThuocBay) {
      // Khoang NHÀ THUỐC: Tường Bắc tách làm 2 bên để chừa cổng kính mở `🚪 CỬA RA VÀO` ở giữa!
      const doorX = NHA_THUOC_BAY_BOUNDS.entranceDoor.wx;
      const doorW = NHA_THUOC_BAY_BOUNDS.entranceDoor.ww;
      const leftWallW = Math.max(12, doorX - bay.wx);
      const rightWallX = doorX + doorW;
      const rightWallW = Math.max(12, bay.wx + bay.ww - rightWallX);

      drawIsoBox(
        ctx,
        bay.wx,
        bay.wy,
        leftWallW,
        4.5,
        10.2,
        10.2 + wallH,
        '#15803d',
        '#f0fdf4',
        '#dcfce7',
        '#166534',
        0.85
      );
      drawIsoBox(
        ctx,
        rightWallX,
        bay.wy,
        rightWallW,
        4.5,
        10.2,
        10.2 + wallH,
        '#15803d',
        '#f0fdf4',
        '#dcfce7',
        '#166534',
        0.85
      );

      // Cổng kính trượt mở & Thảm đón khách tại `🚪 CỬA RA VÀO` (Phía Bắc Khoang NHÀ THUỐC)
      drawIsoBox(
        ctx,
        doorX + 2,
        bay.wy - 4,
        doorW - 4,
        14,
        10.25,
        10.9,
        '#fef08a',
        '#facc15',
        '#eab308',
        '#854d0e',
        0.85
      );
      // 2 Cánh cửa kính mở sang 2 bên
      drawIsoBox(
        ctx,
        doorX - 2,
        bay.wy + 0.5,
        14,
        3.2,
        10.5,
        32,
        '#38bdf8',
        'rgba(186, 230, 253, 0.65)',
        'rgba(125, 211, 252, 0.55)',
        '#0284c7',
        0.9
      );
      drawIsoBox(
        ctx,
        doorX + doorW - 12,
        bay.wy + 0.5,
        14,
        3.2,
        10.5,
        32,
        '#38bdf8',
        'rgba(186, 230, 253, 0.65)',
        'rgba(125, 211, 252, 0.55)',
        '#0284c7',
        0.9
      );

      // Thanh đà cổng (Header Arch) và Biển `🚪 CỬA RA VÀO` đúng vị trí phía Bắc sơ đồ Excel
      drawIsoBox(
        ctx,
        doorX - 2,
        bay.wy,
        doorW + 4,
        4.8,
        31.5,
        36.5,
        '#14532d',
        '#166534',
        '#15803d',
        '#fef08a',
        1.1
      );

      const doorSignIso = worldToIso(doorX + doorW * 0.5, bay.wy + 2, 43);
      ctx.save();
      ctx.font = '800 9px Inter, system-ui, sans-serif';
      const doorText = '🚪 CỬA RA VÀO';
      const dw = ctx.measureText(doorText).width + 16;
      drawRoundedRect(ctx, doorSignIso.x - dw / 2, doorSignIso.y - 8.5, dw, 17, 5);
      ctx.fillStyle = '#fef9c3';
      ctx.fill();
      ctx.strokeStyle = '#15803d';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = '#14532d';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(doorText, doorSignIso.x, doorSignIso.y);
      ctx.restore();
    } else if (bIdx === 0 || (z.id === 'ISO-ZONE-04' && bIdx === 1)) {
      drawIsoBox(
        ctx,
        bay.wx,
        bay.wy,
        bay.ww,
        4.5,
        10.2,
        10.2 + wallH,
        z.wallAccent,
        '#f8fafc',
        '#e2e8f0',
        '#94a3b8',
        0.75
      );

      // Wall-Mounted 3D Glass Kanban / Architecture Screen
      const boardW = Math.min(76, bay.ww * 0.46);
      const boardX = bay.wx + (bay.ww - boardW) * 0.5;
      const bNW = worldToIso(boardX, bay.wy + 5, 10.2 + wallH - 4);
      const bNE = worldToIso(boardX + boardW, bay.wy + 5, 10.2 + wallH - 4);
      const bSE = worldToIso(boardX + boardW, bay.wy + 5, 15);
      const bSW = worldToIso(boardX, bay.wy + 5, 15);

      ctx.beginPath();
      ctx.moveTo(bNW.x, bNW.y);
      ctx.lineTo(bNE.x, bNE.y);
      ctx.lineTo(bSE.x, bSE.y);
      ctx.lineTo(bSW.x, bSW.y);
      ctx.closePath();
      ctx.fillStyle = '#0f172a';
      ctx.fill();
      ctx.strokeStyle = z.rimColor;
      ctx.lineWidth = 1.1;
      ctx.stroke();

      for (let col = 0; col < 3; col++) {
        const cx0 = boardX + 6 + col * ((boardW - 12) / 3);
        const cw = (boardW - 18) / 3;
        const cNW = worldToIso(cx0, bay.wy + 5.2, 10.2 + wallH - 7);
        const cNE = worldToIso(cx0 + cw, bay.wy + 5.2, 10.2 + wallH - 7);
        const cSE = worldToIso(cx0 + cw, bay.wy + 5.2, 18);
        const cSW = worldToIso(cx0, bay.wy + 5.2, 18);
        ctx.beginPath();
        ctx.moveTo(cNW.x, cNW.y);
        ctx.lineTo(cNE.x, cNE.y);
        ctx.lineTo(cSE.x, cSE.y);
        ctx.lineTo(cSW.x, cSW.y);
        ctx.closePath();
        ctx.fillStyle = col === 0 ? '#38bdf8' : col === 1 ? '#f59e0b' : '#10b981';
        ctx.globalAlpha = 0.78;
        ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
  }

  // 5. Squad-Specific 3D Interior Architecture & Khoang NHÀ THUỐC (3x3 Desk Islands + Aisles + Title)
  if (isNhaThuocBay) {
    ctx.save();

    // 5A. Mặt sàn lối đi nội bộ (Walkable Aisles) giữa 9 cụm bàn để sạch tự nhiên, không vẽ đường kẻ nét đứt dưới chân nhân vật

    // 5B. Vẽ thảm lót nền dưới chân 9 Cụm Bàn Ghép 6 Chỗ (2 dãy đối diện × 3 bàn liền kề)
    for (const isl of NHA_THUOC_ISLANDS) {
      const iNW = worldToIso(isl.wx, isl.wy, 10.32);
      const iNE = worldToIso(isl.wx + isl.ww, isl.wy, 10.32);
      const iSE = worldToIso(isl.wx + isl.ww, isl.wy + isl.wh, 10.32);
      const iSW = worldToIso(isl.wx, isl.wy + isl.wh, 10.32);

      ctx.beginPath();
      ctx.moveTo(iNW.x, iNW.y);
      ctx.lineTo(iNE.x, iNE.y);
      ctx.lineTo(iSE.x, iSE.y);
      ctx.lineTo(iSW.x, iSW.y);
      ctx.closePath();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.16)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(20, 83, 45, 0.42)';
      ctx.lineWidth = 1.0;
      ctx.stroke();
    }

    ctx.restore();
  } else if (z.id === 'ISO-ZONE-02') {
    // 02 BA & Design Lounge (South-Center Bay, không có cụm bàn 6 chỗ nên đặt Quầy Espresso & Bàn Họp gọn gàng)
    drawIsoBox(
      ctx,
      z.wx + 18,
      z.wy + 20,
      72,
      24,
      10.2,
      24,
      '#fef3c7',
      '#d97706',
      '#b45309',
      '#78350f',
      0.85
    );
    drawIsoBox(
      ctx,
      z.wx + 48,
      z.wy + 22,
      24,
      18,
      24,
      38,
      '#e2e8f0',
      '#dc2626',
      '#991b1b',
      '#0f172a',
      0.7
    );
    const steamIso = worldToIso(z.wx + 60, z.wy + 30, 41);
    const wave = Math.sin(time * 0.006) * 2.8;
    ctx.save();
    ctx.strokeStyle = 'rgba(100, 116, 139, 0.58)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(steamIso.x, steamIso.y);
    ctx.quadraticCurveTo(steamIso.x + wave, steamIso.y - 8, steamIso.x - wave, steamIso.y - 15);
    ctx.stroke();
    ctx.restore();
  }
}

// ============================================================================
// 6. ULTRA-DETAILED 3D ISOMETRIC DESK & WORKSTATION RENDERER
// ============================================================================

export function drawDetailedIsoDesk(
  ctx: CanvasRenderingContext2D,
  desk: DeskPosition,
  emp: Employee | undefined,
  options: {
    isSelected: boolean;
    isHovered: boolean;
    isTargetOfTransfer: boolean;
    isFilteredOut: boolean;
    doneTicketsCount: number;
    time: number;
  }
) {
  const { isSelected, isHovered, isTargetOfTransfer, isFilteredOut, doneTicketsCount, time } =
    options;
  const roleMeta = emp ? ROLE_METADATA[emp.role] : ROLE_METADATA.BACKEND;
  const isPMDesk = desk.id === 'DESK-01';
  const isRedDesk = desk.highlightVariant === 'red';
  const isYellowDesk = desk.highlightVariant === 'yellow';
  const isCompactIslandDesk = Boolean(desk.seatCode);

  const isEmployeeSeated = Boolean(
    emp &&
      emp.status !== 'CARRYING_DOCS' &&
      emp.status !== 'WALKING_BACK' &&
      emp.status !== 'HANDOFF' &&
      Math.hypot(
        (emp.currentPosition?.x ?? desk.seatPosition.x) - desk.seatPosition.x,
        (emp.currentPosition?.y ?? desk.seatPosition.y) - desk.seatPosition.y
      ) < 6
  );

  ctx.save();
  if (isFilteredOut) ctx.globalAlpha = 0.28;

  // 0. Soft Ambient Drop Shadow under Desk on Bay Floor
  // Trong Khoang NHÀ THUỐC (9 cụm bàn 2x3), kích thước bàn mô-đun gọn (28x18) để xếp khít 6 bàn/cụm
  const deskW = isCompactIslandDesk ? 28 : isPMDesk ? 62 : 48;
  const deskH = isCompactIslandDesk ? 18 : isPMDesk ? 34 : 26;
  const dx = desk.x - deskW / 2;
  const dy = desk.y - deskH / 2;

  const shNW = worldToIso(dx + 1.5, dy + 1.5, 10.35);
  const shNE = worldToIso(dx + deskW + 3, dy + 1.5, 10.35);
  const shSE = worldToIso(dx + deskW + 3, dy + deskH + 3.5, 10.35);
  const shSW = worldToIso(dx + 1.5, dy + deskH + 3.5, 10.35);
  ctx.beginPath();
  ctx.moveTo(shNW.x, shNW.y);
  ctx.lineTo(shNE.x, shNE.y);
  ctx.lineTo(shSE.x, shSE.y);
  ctx.lineTo(shSW.x, shSW.y);
  ctx.closePath();
  ctx.fillStyle = isRedDesk ? 'rgba(185, 28, 28, 0.28)' : 'rgba(15, 23, 42, 0.14)';
  ctx.fill();

  // 1. Highlight Halo on Isometric Floor if selected, hovered, or receiving transfer
  if (isSelected || isHovered || isTargetOfTransfer || isRedDesk) {
    const cIso = worldToIso(desk.x, desk.y, 10.4);
    ctx.strokeStyle = isTargetOfTransfer
      ? '#ea580c'
      : isSelected
      ? '#0284c7'
      : isRedDesk
      ? '#dc2626'
      : '#64748b';
    ctx.lineWidth = isTargetOfTransfer || isRedDesk ? 2.4 : 1.8;
    ctx.beginPath();
    ctx.ellipse(
      cIso.x,
      cIso.y,
      isCompactIslandDesk ? 22 : 38,
      isCompactIslandDesk ? 12 : 20,
      0,
      0,
      Math.PI * 2
    );
    ctx.stroke();
  }

  // Helper to draw the unoccupied 3D Ergonomic Swivel Chair when employee is walking away
  const drawUnoccupiedChair = () => {
    const sx = desk.seatPosition.x;
    const sy = desk.seatPosition.y;
    const chairBaseIso = worldToIso(sx, sy, 10.5);
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(chairBaseIso.x - 5, chairBaseIso.y + 1.5);
    ctx.lineTo(chairBaseIso.x + 5, chairBaseIso.y + 1.5);
    ctx.moveTo(chairBaseIso.x, chairBaseIso.y - 1.5);
    ctx.lineTo(chairBaseIso.x, chairBaseIso.y + 4);
    ctx.stroke();

    if (desk.orientation === 'DOWN') {
      drawIsoBox(
        ctx,
        sx - 5.5,
        sy - 6,
        11,
        3,
        16,
        25.5,
        roleMeta.primaryColor,
        shadeHexColor(roleMeta.primaryColor, -15),
        shadeHexColor(roleMeta.primaryColor, -30),
        '#0f172a',
        0.65
      );
    }

    drawIsoBox(
      ctx,
      sx - 6,
      sy - 6,
      12,
      12,
      12.5,
      16,
      '#334155',
      '#1e293b',
      '#0f172a',
      '#0f172a',
      0.6
    );

    if (desk.orientation !== 'DOWN') {
      drawIsoBox(
        ctx,
        sx - 5.5,
        sy + 4,
        11,
        3,
        16,
        25.5,
        roleMeta.primaryColor,
        shadeHexColor(roleMeta.primaryColor, -15),
        shadeHexColor(roleMeta.primaryColor, -30),
        '#0f172a',
        0.65
      );
    }
  };

  if (!isEmployeeSeated && desk.orientation === 'DOWN') {
    drawUnoccupiedChair();
  }

  // 2. 3D Isometric Desk Structure (Side Legs + Modesty Panel + Beveled Tabletop)
  drawIsoBox(ctx, dx + 1.5, dy + 2, 3.5, deskH - 4, 10.2, 20.5, '#94a3b8', '#64748b', '#475569');
  drawIsoBox(
    ctx,
    dx + deskW - 5,
    dy + 2,
    3.5,
    deskH - 4,
    10.2,
    20.5,
    '#94a3b8',
    '#64748b',
    '#475569'
  );

  // Front Accent Modesty Panel
  const panelColor = isRedDesk
    ? '#dc2626'
    : isYellowDesk
    ? '#eab308'
    : roleMeta.primaryColor;
  drawIsoBox(
    ctx,
    dx + 3.5,
    dy + deskH - 4.5,
    deskW - 7,
    2.8,
    12.5,
    20.5,
    panelColor,
    shadeHexColor(panelColor, -12),
    '#334155'
  );

  // Main Beveled Tabletop Slab
  // - Bàn Đỏ đặc biệt (FT3.III2A.1.289 - DongNQ6): Mặt bàn Đỏ tươi viền Vàng đúng như file Excel!
  // - Bàn Vàng highlight (FT3.III2A.1.194/195 - ThanhDQ13): Mặt bàn Vàng sáng!
  const topColor = isRedDesk
    ? '#ef4444'
    : isYellowDesk
    ? '#fef08a'
    : isPMDesk
    ? '#fef3c7'
    : '#ffffff';
  const leftEdgeColor = isRedDesk
    ? '#dc2626'
    : isYellowDesk
    ? '#facc15'
    : isPMDesk
    ? '#f59e0b'
    : '#e2e8f0';
  const rightEdgeColor = isRedDesk
    ? '#b91c1c'
    : isYellowDesk
    ? '#eab308'
    : isPMDesk
    ? '#d97706'
    : '#cbd5e1';
  const rimStrokeColor = isRedDesk
    ? '#fde047'
    : isYellowDesk
    ? '#ca8a04'
    : isPMDesk
    ? '#b45309'
    : '#64748b';

  drawIsoBox(
    ctx,
    dx,
    dy,
    deskW,
    deskH,
    20.5,
    24.2,
    topColor,
    leftEdgeColor,
    rightEdgeColor,
    rimStrokeColor,
    isRedDesk || isYellowDesk ? 1.35 : 0.9
  );

  // 3. 3D Isometric Computer Monitor(s) with Ambient Screen Glow & Active Code Lines
  const isWorking = Boolean(
    emp &&
      (isEmployeeSeated ||
        emp.status === 'WORKING' ||
        emp.status === 'REVIEWING' ||
        emp.assignedTicketIds.length > 0)
  );
  const monitorColor = isRedDesk
    ? '#fde047'
    : isPMDesk
    ? '#f59e0b'
    : isWorking
    ? roleMeta.primaryColor
    : '#64748b';

  const empSeedNum = emp ? parseInt(emp.id.replace(/\D/g, ''), 10) || 1 : 1;

  if (desk.orientation === 'RIGHT' || desk.orientation === 'LEFT') {
    // Bàn đối diện Trái - Phải trong 9 Cụm Đảo Bàn (Khoang NHÀ THUỐC)
    const isLeftCol = desk.orientation === 'RIGHT'; // Ngồi bên Trái nhìn sang Phải (SE)
    const monWx = isLeftCol ? desk.x + 3.8 : desk.x - 7.2;
    const monWy = desk.y - 5.2;

    // Chân đế màn hình
    drawIsoBox(
      ctx,
      monWx + 0.5,
      monWy + 3.6,
      2.4,
      3.0,
      24.2,
      26.8,
      '#475569',
      '#334155',
      '#1e293b'
    );
    // Màn hình máy tính đặt dọc theo vách ngăn giữa cụm đảo bàn
    drawIsoBox(
      ctx,
      monWx,
      monWy,
      3.2,
      10.4,
      26.5,
      34.0,
      monitorColor,
      isLeftCol ? '#0f172a' : '#1e293b',
      isLeftCol ? '#1e293b' : '#0f172a',
      monitorColor,
      0.85
    );

    // Các dòng code phát sáng nhấp nháy trên màn hình khi nhân viên ngồi gõ máy
    if (isWorking) {
      const codeGlowX = isLeftCol ? monWx - 0.2 : monWx + 3.4;
      for (let lineIdx = 0; lineIdx < 3; lineIdx++) {
        const lineZ = 32.2 - lineIdx * 1.8;
        const lineLen = 4.5 + ((empSeedNum + lineIdx + Math.floor(time * 0.006)) % 4);
        const c0 = worldToIso(codeGlowX, monWy + 1.5, lineZ);
        const c1 = worldToIso(codeGlowX, monWy + 1.5 + lineLen, lineZ);
        ctx.strokeStyle =
          lineIdx === 0 ? '#38bdf8' : lineIdx === 1 ? '#4ade80' : '#fde047';
        ctx.lineWidth = 1.15;
        ctx.beginPath();
        ctx.moveTo(c0.x, c0.y);
        ctx.lineTo(c1.x, c1.y);
        ctx.stroke();
      }
    }

    // 4. Bàn phím cơ (Mechanical Keyboard) đặt phía người ngồi
    const kbWx = isLeftCol ? desk.x - 5.2 : desk.x + 1.6;
    const kbWy = desk.y - 3.6;
    drawIsoBox(
      ctx,
      kbWx,
      kbWy,
      3.8,
      7.4,
      24.2,
      25.3,
      '#334155',
      '#1e293b',
      '#0f172a'
    );

    // Nếu nhân viên cột Trái (orientation === 'RIGHT') đang ngồi tại bàn:
    // Vì nhân viên cột Trái được vẽ TRƯỚC bàn để mặt bàn che chân dưới gầm bàn,
    // ta vẽ 2 bàn tay đang gõ phím liên tục ngay trên mặt bàn phím để thấy rõ tay gõ máy tính!
    if (isEmployeeSeated && isLeftCol) {
      const tapL = Math.sin(time * 0.052 + empSeedNum * 1.7) * 1.4;
      const tapR = Math.cos(time * 0.052 + empSeedNum * 1.7) * 1.4;
      const handL = worldToIso(kbWx + 1.2, kbWy + 2.0, 25.8 + Math.max(0, tapL));
      const handR = worldToIso(kbWx + 1.2, kbWy + 5.2, 25.8 + Math.max(0, tapR));
      ctx.fillStyle = '#fcd34d';
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 0.75;
      ctx.beginPath();
      ctx.arc(handL.x, handL.y, 2.0, 0, Math.PI * 2);
      ctx.arc(handR.x, handR.y, 2.0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  } else {
    const monY = desk.orientation === 'DOWN' ? desk.y + 1.5 : desk.y - 3.5;
    const monitorOffsets = isCompactIslandDesk ? [-3] : [-12, 3];

    for (const offsetX of monitorOffsets) {
      drawIsoBox(
        ctx,
        desk.x + offsetX + 1.5,
        monY,
        2.6,
        2.2,
        24.2,
        26.8,
        '#475569',
        '#334155',
        '#1e293b'
      );
      drawIsoBox(
        ctx,
        desk.x + offsetX - 2,
        monY - 0.8,
        isCompactIslandDesk ? 9.5 : 11.5,
        2.4,
        26.5,
        33.2,
        monitorColor,
        '#0f172a',
        '#1e293b',
        monitorColor,
        0.75
      );
    }

    // 4. Mechanical Keyboard on Desk
    const kbY = desk.orientation === 'DOWN' ? desk.y - 3.8 : desk.y + 1.5;
    drawIsoBox(
      ctx,
      desk.x - 4.5,
      kbY,
      9,
      3.2,
      24.2,
      25.4,
      '#334155',
      '#1e293b',
      '#0f172a'
    );
  }

  // 5. 3D Accumulated Document Stack on Corner of Desk
  const docCount = isPMDesk
    ? Math.max(emp?.deskDocumentCount ?? 4, doneTicketsCount + 2)
    : Math.max(emp?.deskDocumentCount ?? 0, emp?.assignedTicketIds?.length ?? 0);

  if (docCount > 0) {
    const layers = Math.min(4, docCount);
    const stackWx =
      desk.orientation === 'LEFT' ? dx + 2.0 : dx + deskW - 8.5;
    const stackWy = dy + 1.8;
    for (let s = 0; s < layers; s++) {
      const zBase = 24.2 + s * 2.0;
      const topCol = isPMDesk
        ? s === layers - 1
          ? '#10b981'
          : '#fde68a'
        : s === layers - 1
        ? roleMeta.primaryColor
        : '#ffffff';
      drawIsoBox(
        ctx,
        stackWx,
        stackWy,
        6.8,
        5.2,
        zBase,
        zBase + 1.7,
        topCol,
        '#f1f5f9',
        '#cbd5e1',
        '#334155',
        0.5
      );
    }
  }

  if (!isEmployeeSeated && desk.orientation !== 'DOWN') {
    drawUnoccupiedChair();
  }

  // 6. Chỉ hiện mã ghế nhỏ (SeatCode) khi đang Hover hoặc Select bàn đó để không che bàn phím & không rối mắt
  const seatCodeStr = desk.seatCode || emp?.seatCode;
  if (seatCodeStr && (isSelected || isHovered || isRedDesk)) {
    const shortSeat =
      isSelected || isHovered
        ? seatCodeStr
        : seatCodeStr.replace('FT3.III2A.', '');
    const plateIso = worldToIso(desk.x, desk.y + 6, 25.5);

    ctx.save();
    ctx.font = '800 6.2px monospace';
    const pw = ctx.measureText(shortSeat).width + 7;
    const ph = 9.5;
    const px = plateIso.x - pw / 2;
    const py = plateIso.y - ph / 2;

    drawRoundedRect(ctx, px, py, pw, ph, 3);
    ctx.fillStyle = isRedDesk ? '#991b1b' : 'rgba(15, 23, 42, 0.88)';
    ctx.fill();
    ctx.strokeStyle = isRedDesk ? '#fde047' : '#38bdf8';
    ctx.lineWidth = 0.9;
    ctx.stroke();

    ctx.fillStyle = '#fde047';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(shortSeat, plateIso.x, py + ph / 2);
    ctx.restore();
  }

  ctx.restore();
}

/**
 * Vẽ Trụ cột bê tông 3D `🏛️ CỘT NHÀ` ốp ngay vào góc thứ 6 (rowIndex = 2, colIndex = 1) của Cụm 1.3
 */
export function drawNhaThuocStructuralPillar3D(
  ctx: CanvasRenderingContext2D,
  slot: NhaThuocSeatSlot
) {
  ctx.save();
  const pw = slot.width - 4;
  const ph = slot.height - 4;
  const px = slot.wx - pw / 2;
  const py = slot.wy - ph / 2;

  // Chân đế cột bê tông (Plinth Base ốp khít vào cạnh bàn Cụm 1.3)
  drawIsoBox(
    ctx,
    slot.wx - slot.width / 2,
    slot.wy - slot.height / 2,
    slot.width,
    slot.height,
    10.2,
    24.2,
    '#fde68a',
    '#f59e0b',
    '#d97706',
    '#78350f',
    1.05
  );

  // Thân trụ cột bê tông cốt thép 3D cao vút (z: 24.2 -> 54)
  drawIsoBox(
    ctx,
    px,
    py,
    pw,
    ph,
    24.2,
    54,
    '#fffbeb',
    '#f8fafc',
    '#cbd5e1',
    '#475569',
    1.15
  );

  // Đai cảnh báo kiến trúc quanh thân cột (Architectural Stripe Band)
  drawIsoBox(
    ctx,
    px - 0.5,
    py - 0.5,
    pw + 1,
    ph + 1,
    33,
    38,
    '#fef08a',
    '#ef4444',
    '#dc2626',
    '#991b1b',
    0.9
  );

  // Đầu cột (Column Capital)
  drawIsoBox(
    ctx,
    px - 2,
    py - 2,
    pw + 4,
    ph + 4,
    54,
    58,
    '#ffffff',
    '#e2e8f0',
    '#94a3b8',
    '#334155',
    1.0
  );

  // Biển nổi `🏛️ CỘT NHÀ` trên đỉnh trụ cột
  const topIso = worldToIso(slot.wx, slot.wy, 64);
  ctx.font = '900 8px Inter, system-ui, sans-serif';
  const label = '🏛️ CỘT NHÀ';
  const lw = ctx.measureText(label).width + 12;
  drawRoundedRect(ctx, topIso.x - lw / 2, topIso.y - 8, lw, 16, 4.5);
  ctx.fillStyle = '#fef9c3';
  ctx.fill();
  ctx.strokeStyle = '#b45309';
  ctx.lineWidth = 1.4;
  ctx.stroke();
  ctx.fillStyle = '#78350f';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, topIso.x, topIso.y);

  ctx.restore();
}

/**
 * Vẽ ghế xoay văn phòng 3D khi nhân viên đang rời bàn đi bộ (hoặc tại 2 bàn Trống màu vàng)
 */
function drawBenchSwivelChairUnoccupied(
  ctx: CanvasRenderingContext2D,
  seatX: number,
  seatY: number,
  side: 'LEFT' | 'RIGHT',
  accentColor: string
) {
  const chairBaseIso = worldToIso(seatX, seatY, 10.5);
  ctx.strokeStyle = '#334155';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(chairBaseIso.x - 5.5, chairBaseIso.y + 1.5);
  ctx.lineTo(chairBaseIso.x + 5.5, chairBaseIso.y + 1.5);
  ctx.moveTo(chairBaseIso.x, chairBaseIso.y - 1.5);
  ctx.lineTo(chairBaseIso.x, chairBaseIso.y + 4.2);
  ctx.stroke();

  if (side === 'LEFT') {
    // Dãy Trái: Lưng ghế nằm ở mép ngoài bên trái (Tây-Bắc)
    drawIsoBox(
      ctx,
      seatX - 6.6,
      seatY - 5.2,
      3.2,
      10.4,
      15.5,
      25.8,
      accentColor,
      shadeHexColor(accentColor, -15),
      shadeHexColor(accentColor, -30),
      '#0f172a',
      0.6
    );
  }

  // Đệm ngồi ghế xoay
  drawIsoBox(
    ctx,
    seatX - 5.8,
    seatY - 5.8,
    11.6,
    11.6,
    12.2,
    15.5,
    '#334155',
    '#1e293b',
    '#0f172a',
    '#0f172a',
    0.58
  );

  if (side === 'RIGHT') {
    // Dãy Phải: Lưng ghế nằm ở mép ngoài bên phải (Đông-Nam)
    drawIsoBox(
      ctx,
      seatX + 3.4,
      seatY - 5.2,
      3.2,
      10.4,
      15.5,
      25.8,
      accentColor,
      shadeHexColor(accentColor, -15),
      shadeHexColor(accentColor, -30),
      '#0f172a',
      0.6
    );
  }
}

/**
 * Vẽ Khối Cụm 6 Bàn Ghép Liền Khối (`2 dãy đối diện x 3 bàn liền kề` - Contiguous Face-to-Face Bench Workstation Island):
 * - Mặt bàn 2x3 liền mạch không khe hở (giữ nguyên màu nổi bật cho Ô Đỏ `1.289 - DongNQ6`, Ô Vàng `1.194/195 - ThanhDQ13` và 2 Ô Trống `1.101/102`, `1.204`).
 * - Vách ngăn trung tâm 3D Isometric (Center Privacy Partition / Frosted Acrylic & Acoustic Fabric Divider) chạy dọc suốt chiều dài 3 bàn ở chính giữa 2 dãy.
 * - Hai hàng màn hình máy tính đặt quay lưng vào nhau dọc hai bên vách ngăn trung tâm.
 * - Bàn phím cơ, chuột, chồng hồ sơ tài liệu và hai bàn tay gõ phím liên tục của các nhân sự dãy Trái.
 * - Riêng Cụm `1.3` tích hợp trụ cột bê tông 3D `🏛️ CỘT NHÀ` ốp khít vào ô thứ 6 (`rowIndex = 2, colIndex = 1`).
 */
export function drawJoinedDeskIsland(
  ctx: CanvasRenderingContext2D,
  island: NhaThuocIslandMeta,
  options: {
    employees: Employee[];
    activeTasks: DocumentTransferTask[];
    selectedEmployeeId: string | null;
    hoveredEmployeeId: string | null;
    activeRoleFilter: string;
    doneTicketsCount: number;
    time: number;
    showIslandHeatmap?: boolean;
    islandHeatStat?: IslandHeatmapStat;
  }
) {
  const {
    employees,
    activeTasks,
    selectedEmployeeId,
    hoveredEmployeeId,
    activeRoleFilter,
    doneTicketsCount,
    time,
    showIslandHeatmap,
    islandHeatStat,
  } = options;

  const islandSlots = ALL_OFFICE_SEAT_SLOTS.filter((s) => s.islandId === island.id);
  const { tableWx, tableWy, tableWw, tableWh, deskW, deskH, partitionWx: midX } = island;
  const pillarSlot = islandSlots.find((s) => s.kind === 'PILLAR');

  ctx.save();

  // --------------------------------------------------------------------------
  // 1. BÓNG ĐỔ AMBIENT LIỀN KHỐI DƯỚI GẦM CỤM 6 BÀN GHÉP (z = 10.35)
  // --------------------------------------------------------------------------
  const shNW = worldToIso(tableWx + 1.5, tableWy + 1.5, 10.35);
  const shNE = worldToIso(tableWx + tableWw + 3.5, tableWy + 1.5, 10.35);
  const shSE = worldToIso(tableWx + tableWw + 3.5, tableWy + tableWh + 4.0, 10.35);
  const shSW = worldToIso(tableWx + 1.5, tableWy + tableWh + 4.0, 10.35);
  ctx.beginPath();
  ctx.moveTo(shNW.x, shNW.y);
  ctx.lineTo(shNE.x, shNE.y);
  ctx.lineTo(shSE.x, shSE.y);
  ctx.lineTo(shSW.x, shSW.y);
  ctx.closePath();
  ctx.fillStyle = 'rgba(15, 23, 42, 0.16)';
  ctx.fill();

  // 1B. BẢN ĐỒ NHIỆT 9 CỤM BÀN (ISLAND ACTIVITY HEATMAP GLOW TRÊN MẶT SÀN)
  if (showIslandHeatmap && islandHeatStat) {
    const pad = 7.5;
    const hmNW = worldToIso(tableWx - pad, tableWy - pad, 10.38);
    const hmNE = worldToIso(tableWx + tableWw + pad, tableWy - pad, 10.38);
    const hmSE = worldToIso(tableWx + tableWw + pad, tableWy + tableWh + pad, 10.38);
    const hmSW = worldToIso(tableWx - pad, tableWy + tableWh + pad, 10.38);

    const heatColors =
      islandHeatStat.heatLevel === 'HOT'
        ? { fill: 'rgba(239, 68, 68, 0.22)', stroke: '#ef4444' }
        : islandHeatStat.heatLevel === 'WARM'
        ? { fill: 'rgba(245, 158, 11, 0.18)', stroke: '#f59e0b' }
        : islandHeatStat.heatLevel === 'ACTIVE'
        ? { fill: 'rgba(16, 185, 129, 0.16)', stroke: '#10b981' }
        : { fill: 'rgba(56, 189, 248, 0.12)', stroke: '#38bdf8' };

    ctx.beginPath();
    ctx.moveTo(hmNW.x, hmNW.y);
    ctx.lineTo(hmNE.x, hmNE.y);
    ctx.lineTo(hmSE.x, hmSE.y);
    ctx.lineTo(hmSW.x, hmSW.y);
    ctx.closePath();
    ctx.fillStyle = heatColors.fill;
    ctx.fill();
    ctx.strokeStyle = heatColors.stroke;
    ctx.lineWidth = islandHeatStat.heatLevel === 'HOT' ? 2.4 : 1.7;
    ctx.stroke();
  }

  // Helper tìm nhân viên đang chiếm chỗ ngồi tại ô bàn (hỗ trợ cả nhân viên từ Giếng trời vào nhận bàn vừa trống!)
  const getSlotOccupantEmp = (slot: NhaThuocSeatSlot): Employee | undefined => {
    if (slot.deskId) {
      const dynamicOccupant = employees.find(
        (e) =>
          !e.isManager &&
          !e.isFemaleManager &&
          e.isCheckedIn &&
          !e.isCheckingOut &&
          (e.assignedDeskId === slot.deskId || e.checkedInDeskId === slot.deskId)
      );
      if (dynamicOccupant) return dynamicOccupant;
    }
    if (slot.assignedEmployeeId) {
      return (
        employees.find((e) => e.id === slot.assignedEmployeeId) ||
        EMPLOYEE_BY_ID[slot.assignedEmployeeId]
      );
    }
    return undefined;
  };

  // Helper kiểm tra nhân viên tại 1 ô bàn có đang ngồi tại ghế hay không
  // Yêu cầu Phần F: Mỗi ngày toàn bộ bàn làm việc sẽ trống (isCheckedIn = false), ai có event trước thì vào công ty chiếm 1 chỗ ngồi!
  const isSlotPersonSeated = (slot: NhaThuocSeatSlot): boolean => {
    if (slot.kind !== 'OCCUPIED') return false;
    if (!slot.deskId) {
      return false; // Đầu ngày toàn bộ bàn chưa có người Check-In đều để ghế trống
    }
    const desk = DESK_BY_ID[slot.deskId];
    const emp = getSlotOccupantEmp(slot);
    if (!desk || !emp) return false;
    const empDeskId = emp.assignedDeskId || emp.checkedInDeskId || emp.deskId;
    if (
      !emp.isCheckedIn ||
      emp.isCheckingOut ||
      emp.isSmokingAtAtrium ||
      emp.isWalkingFromEntrance ||
      empDeskId !== slot.deskId
    ) {
      return false;
    }
    return (
      emp.status !== 'CARRYING_DOCS' &&
      emp.status !== 'WALKING_BACK' &&
      emp.status !== 'HANDOFF' &&
      Math.hypot(
        (emp.currentPosition?.x ?? desk.seatPosition.x) - desk.seatPosition.x,
        (emp.currentPosition?.y ?? desk.seatPosition.y) - desk.seatPosition.y
      ) < 6
    );
  };

  // --------------------------------------------------------------------------
  // 2. VÒNG SÁNG HIGHLIGHT TRÊN SÀN CHO Ô BÀN ĐANG CHỌN / NHẬN TÀI LIỆU / BÀN ĐỎ PM / MVP ENERGY AURA
  // --------------------------------------------------------------------------
  for (const slot of islandSlots) {
    if (!slot.deskId) continue;
    const desk = DESK_BY_ID[slot.deskId];
    const emp = getSlotOccupantEmp(slot);
    const isSelected = Boolean(emp && emp.id === selectedEmployeeId);
    const isHovered = Boolean(emp && emp.id === hoveredEmployeeId);
    const isTargetOfTransfer = Boolean(
      desk && activeTasks.some((t) => t.toDeskId === desk.id && t.phase !== 'COMPLETED')
    );
    const isRedDesk = slot.highlight === 'red';
    const mvpRank = emp?.mvpRank ?? null;

    if (mvpRank) {
      const mvpIso = worldToIso(slot.wx, slot.wy, 10.42);
      const mvpPulse = 20 + Math.sin(time * 0.008 + mvpRank) * 2.2;
      const mvpColor =
        mvpRank === 1 ? '#facc15' : mvpRank === 2 ? '#38bdf8' : '#34d399';
      ctx.save();
      ctx.fillStyle =
        mvpRank === 1
          ? 'rgba(250, 204, 21, 0.16)'
          : mvpRank === 2
          ? 'rgba(56, 189, 248, 0.14)'
          : 'rgba(52, 211, 153, 0.13)';
      ctx.beginPath();
      ctx.ellipse(mvpIso.x, mvpIso.y, mvpPulse * 1.12, mvpPulse * 0.62, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = mvpColor;
      ctx.lineWidth = mvpRank === 1 ? 2.1 : 1.6;
      ctx.setLineDash([5, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    if (isSelected || isHovered || isTargetOfTransfer || isRedDesk) {
      const cIso = worldToIso(slot.wx, slot.wy, 10.45);
      ctx.strokeStyle = isTargetOfTransfer
        ? '#ea580c'
        : isSelected
        ? '#0284c7'
        : isRedDesk
        ? '#dc2626'
        : '#64748b';
      ctx.lineWidth = isTargetOfTransfer || isRedDesk ? 2.4 : 1.8;
      ctx.beginPath();
      ctx.ellipse(cIso.x, cIso.y, 22, 13, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // --------------------------------------------------------------------------
  // 3. GHẾ XOAY TRỐNG CỦA DÃY TRÁI (NẾU NHÂN VIÊN ĐANG ĐI BỘ HOẶC Ô BÀN TRỐNG 1.204)
  //    (Vẽ TRƯỚC mặt bàn để mặt bàn che nhẹ mép trước đệm ghế đúng luật phối cảnh)
  // --------------------------------------------------------------------------
  for (const slot of islandSlots) {
    if (slot.side !== 'LEFT' || slot.kind === 'PILLAR') continue;
    if (!isSlotPersonSeated(slot)) {
      const emp = getSlotOccupantEmp(slot);
      const chairColor =
        slot.kind === 'VACANT'
          ? '#ca8a04'
          : emp
          ? ROLE_METADATA[emp.role].primaryColor
          : '#3b82f6';
      drawBenchSwivelChairUnoccupied(
        ctx,
        slot.seatPosition.x,
        slot.seatPosition.y,
        'LEFT',
        chairColor
      );
    }
  }

  // --------------------------------------------------------------------------
  // 4. KHUNG CHÂN BÀN THÉP CHỊU LỰC CHUNG CHO CẢ CỤM 6 BÀN GHÉP (z = 10.2 -> 20.5)
  // --------------------------------------------------------------------------
  const frameYPositions = [
    tableWy + 2.5,
    tableWy + deskH - 1.8,
    tableWy + deskH * 2 - 1.8,
    tableWy + tableWh - 5.5,
  ];
  for (let idx = 0; idx < frameYPositions.length; idx++) {
    const fy = frameYPositions[idx];
    // Chân thép bên dãy Trái
    drawIsoBox(ctx, tableWx + 2.5, fy, 3.8, 3.6, 10.2, 20.5, '#94a3b8', '#64748b', '#475569');
    // Chân thép bên dãy Phải (trừ góc CỘT NHÀ ở cuối Cụm 1.3)
    if (!(pillarSlot && idx === frameYPositions.length - 1)) {
      drawIsoBox(
        ctx,
        tableWx + tableWw - 6.3,
        fy,
        3.8,
        3.6,
        10.2,
        20.5,
        '#94a3b8',
        '#64748b',
        '#475569'
      );
    }
  }
  // Dầm thép máng cáp chạy dọc sống lưng chính giữa dưới gầm cụm bàn
  drawIsoBox(
    ctx,
    midX - 2.4,
    tableWy + 3,
    4.8,
    tableWh - 6,
    13.8,
    20.5,
    '#64748b',
    '#475569',
    '#334155'
  );

  // --------------------------------------------------------------------------
  // 5. MẶT BÀN GHÉP LIỀN KHỐI 2x3 (6 KHOANG BÀN ỐP SÁT NHAU KHÔNG KHE HỞ, z = 20.5 -> 24.2)
  // --------------------------------------------------------------------------
  for (const subRow of [1, 2, 3] as const) {
    for (const side of ['LEFT', 'RIGHT'] as const) {
      const slot = islandSlots.find((s) => s.subRow === subRow && s.side === side);
      if (!slot || slot.kind === 'PILLAR') continue;

      const emp = slot.assignedEmployeeId
        ? employees.find((e) => e.id === slot.assignedEmployeeId) ||
          EMPLOYEE_BY_ID[slot.assignedEmployeeId]
        : undefined;
      const isFilteredOut = Boolean(
        activeRoleFilter !== 'ALL' && emp && emp.role !== activeRoleFilter
      );

      const leafWx = side === 'LEFT' ? midX - deskW : midX;
      const leafWy = tableWy + (subRow - 1) * deskH;
      const isRedDesk = slot.highlight === 'red';
      const isYellowDesk = slot.highlight === 'yellow' || slot.kind === 'VACANT';
      const isPMDesk = slot.deskId === 'DESK-01';

      const topColor = isRedDesk
        ? '#ef4444'
        : isYellowDesk
        ? '#fef08a'
        : isPMDesk
        ? '#fef3c7'
        : '#ffffff';
      const leftEdgeColor = isRedDesk
        ? '#dc2626'
        : isYellowDesk
        ? '#facc15'
        : isPMDesk
        ? '#f59e0b'
        : '#e2e8f0';
      const rightEdgeColor = isRedDesk
        ? '#b91c1c'
        : isYellowDesk
        ? '#eab308'
        : isPMDesk
        ? '#d97706'
        : '#cbd5e1';
      const seamColor = isRedDesk
        ? '#fde047'
        : isYellowDesk
        ? '#ca8a04'
        : '#94a3b8';

      ctx.save();
      if (isFilteredOut) ctx.globalAlpha = 0.35;

      drawIsoBox(
        ctx,
        leafWx,
        leafWy,
        deskW,
        deskH,
        20.5,
        24.2,
        topColor,
        leftEdgeColor,
        rightEdgeColor,
        seamColor,
        isRedDesk || isYellowDesk ? 1.25 : 0.7
      );

      // Lỗ luồn dây điện tròn tinh tế trên mỗi mặt bàn sát vách ngăn giữa
      const grommetWx = side === 'LEFT' ? midX - 3.6 : midX + 3.6;
      const grommetIso = worldToIso(grommetWx, leafWy + deskH - 4.5, 24.25);
      ctx.fillStyle = isRedDesk ? '#7f1d1d' : '#64748b';
      ctx.beginPath();
      ctx.ellipse(grommetIso.x, grommetIso.y, 1.8, 1.0, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
    }
  }

  // Đường kẻ chia mép bàn tinh tế giữa 3 hàng bàn liền kề (Row 1 | Row 2 | Row 3)
  for (const rIdx of [1, 2]) {
    const seamY = tableWy + rIdx * deskH;
    const rightLimitX = pillarSlot && rIdx === 2 ? midX : tableWx + tableWw;
    const sL = worldToIso(tableWx, seamY, 24.28);
    const sR = worldToIso(rightLimitX, seamY, 24.28);
    ctx.strokeStyle = 'rgba(71, 85, 105, 0.55)';
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(sL.x, sL.y);
    ctx.lineTo(sR.x, sR.y);
    ctx.stroke();
  }

  // --------------------------------------------------------------------------
  // 6. THIẾT BỊ TRÊN DÃY BÀN TRÁI (`colIndex = 0`): BÀN PHÍM, TAY GÕ PHÍM, HỒ SƠ & MÀN HÌNH DÃY TRÁI
  //    (Vẽ TRƯỚC vách ngăn trung tâm để vách ngăn trung tâm chắn phía sau lưng màn hình dãy Trái)
  // --------------------------------------------------------------------------
  for (const subRow of [1, 2, 3] as const) {
    const slot = islandSlots.find((s) => s.subRow === subRow && s.side === 'LEFT');
    if (!slot || slot.kind === 'PILLAR') continue;

    const isVacant = slot.kind === 'VACANT';
    const emp = getSlotOccupantEmp(slot);
    const roleMeta = emp ? ROLE_METADATA[emp.role] : ROLE_METADATA.BACKEND;
    const isFilteredOut = Boolean(
      activeRoleFilter !== 'ALL' && emp && emp.role !== activeRoleFilter
    );
    const isSeated = isSlotPersonSeated(slot);
    const isRedDesk = slot.highlight === 'red';
    const isPMDesk = slot.deskId === 'DESK-01';
    const leafWy = tableWy + (subRow - 1) * deskH;

    ctx.save();
    if (isFilteredOut) ctx.globalAlpha = 0.3;

    // 6A. Bàn phím cơ & Chuột đặt gần mép ngoài bên trái (nơi người ngồi dãy Trái đặt tay)
    const kbWx = midX - 26.5;
    const kbWy = slot.wy - 4.2;
    drawIsoBox(
      ctx,
      kbWx,
      kbWy,
      4.2,
      8.4,
      24.2,
      25.3,
      '#334155',
      '#1e293b',
      '#0f172a'
    );
    // Chuột không dây cạnh bàn phím
    drawIsoBox(
      ctx,
      kbWx + 0.6,
      kbWy + 9.6,
      2.6,
      2.0,
      24.2,
      25.1,
      '#475569',
      '#334155',
      '#1e293b'
    );

    // 6B. Hai cẳng tay & bàn tay của nhân viên dãy Trái đặt lên bàn phím gõ liên tục!
    // (Vì phần thân & chân nhân viên dãy Trái được vẽ TRƯỚC mặt bàn để chân đút dưới gầm bàn,
    //  ta vẽ 2 cẳng tay & bàn tay vươn qua mép bàn đặt lên bàn phím ở z = 25.8)
    if (isSeated && !isVacant) {
      const seed = slot.wx + slot.wy * 1.7;
      const tapL = Math.sin(time * 0.052 + seed) * 1.4;
      const tapR = Math.cos(time * 0.052 + seed) * 1.4;
      const sleeveColor = emp
        ? emp.avatarColor || roleMeta.primaryColor
        : slot.account.includes('(KH)')
        ? '#0d9488'
        : '#3b82f6';
      const armStartL = worldToIso(midX - deskW - 1.2, slot.wy - 2.6, 25.4);
      const armStartR = worldToIso(midX - deskW - 1.2, slot.wy + 2.6, 25.4);
      const handL = worldToIso(kbWx + 1.6, kbWy + 2.2, 25.8 + Math.max(0, tapL));
      const handR = worldToIso(kbWx + 1.6, kbWy + 6.2, 25.8 + Math.max(0, tapR));

      drawStylizedLimbSegment(
        ctx,
        armStartL.x,
        armStartL.y,
        handL.x,
        handL.y,
        3.2,
        shadeHexColor(sleeveColor, -12),
        sleeveColor
      );
      drawStylizedLimbSegment(
        ctx,
        armStartR.x,
        armStartR.y,
        handR.x,
        handR.y,
        3.2,
        sleeveColor,
        shadeHexColor(sleeveColor, 15)
      );
      ctx.fillStyle = '#fcd34d';
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 0.75;
      ctx.beginPath();
      ctx.arc(handL.x, handL.y, 2.0, 0, Math.PI * 2);
      ctx.arc(handR.x, handR.y, 2.0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }

    // 6C. Chồng tài liệu 3D ở góc khoang bàn Trái
    const docCount = isPMDesk
      ? Math.max(emp?.deskDocumentCount ?? 4, doneTicketsCount + 2)
      : Math.max(emp?.deskDocumentCount ?? (isVacant ? 0 : 1), emp?.assignedTicketIds?.length ?? 0);
    if (docCount > 0) {
      const layers = Math.min(4, docCount);
      const stackWx = midX - 15.5;
      const stackWy = leafWy + 2.0;
      for (let s = 0; s < layers; s++) {
        const zBase = 24.2 + s * 1.9;
        const topCol = isPMDesk
          ? s === layers - 1
            ? '#10b981'
            : '#fde68a'
          : s === layers - 1
          ? roleMeta.primaryColor
          : '#ffffff';
        drawIsoBox(
          ctx,
          stackWx,
          stackWy,
          6.8,
          5.2,
          zBase,
          zBase + 1.6,
          topCol,
          '#f1f5f9',
          '#cbd5e1',
          '#334155',
          0.5
        );
      }
    }

    // 6D. Màn hình máy tính dãy Trái (quay mặt về phía Tây-Bắc cho người ngồi dãy Trái nhìn theo hướng SE)
    const monColor = isVacant
      ? '#94a3b8'
      : isRedDesk
      ? '#fde047'
      : emp
      ? roleMeta.primaryColor
      : '#0284c7';
    const monWx = midX - 6.4;
    const monWy = slot.wy - 5.8;

    // Chân đế màn hình dãy Trái
    drawIsoBox(
      ctx,
      monWx + 1.2,
      monWy + 4.2,
      2.4,
      3.2,
      24.2,
      26.8,
      '#475569',
      '#334155',
      '#1e293b'
    );
    // Thân màn hình dãy Trái (mặt lưng ốp sát vách ngăn giữa)
    drawIsoBox(
      ctx,
      monWx,
      monWy,
      3.0,
      11.6,
      26.4,
      34.2,
      monColor,
      '#0f172a',
      '#1e293b',
      monColor,
      0.85
    );

    // Dòng code phát sáng trên mặt màn hình dãy Trái
    if (!isVacant) {
      const codeGlowX = monWx - 0.2;
      for (let lineIdx = 0; lineIdx < 3; lineIdx++) {
        const lineZ = 32.4 - lineIdx * 1.8;
        const lineLen = 5.0 + (((subRow + lineIdx + Math.floor(time * 0.006)) % 4));
        const c0 = worldToIso(codeGlowX, monWy + 1.6, lineZ);
        const c1 = worldToIso(codeGlowX, monWy + 1.6 + lineLen, lineZ);
        ctx.strokeStyle =
          lineIdx === 0 ? '#38bdf8' : lineIdx === 1 ? '#4ade80' : '#fde047';
        ctx.lineWidth = 1.15;
        ctx.beginPath();
        ctx.moveTo(c0.x, c0.y);
        ctx.lineTo(c1.x, c1.y);
        ctx.stroke();
      }
    }

    ctx.restore();
  }

  // --------------------------------------------------------------------------
  // 7. VÁCH NGĂN TRUNG TÂM 3D ISOMETRIC (CENTER PRIVACY PARTITION / FROSTED ACRYLIC DIVIDER)
  //    Chạy dọc suốt chiều dài 3 bàn ở chính giữa 2 dãy bàn đối diện (wx = midX)
  // --------------------------------------------------------------------------
  const partWx = midX - 1.4;
  const partWw = 2.8;
  const partWy = tableWy + 1.0;
  const partWh = tableWh - 2.0;

  // Tầng dưới vách ngăn: Vách nỉ tiêu âm văn phòng màu Xanh Ngọc Lục Bảo (z = 24.2 -> 27.8)
  drawIsoBox(
    ctx,
    partWx,
    partWy,
    partWw,
    partWh,
    24.2,
    27.8,
    '#166534',
    '#15803d',
    '#14532d',
    '#0f172a',
    0.75
  );

  // Tầng trên vách ngăn: Kính mờ Acrylic khung nhôm Anodized (z = 27.8 -> 32.6)
  drawIsoBox(
    ctx,
    partWx + 0.2,
    partWy,
    partWw - 0.4,
    partWh,
    27.8,
    32.6,
    '#e0f2fe',
    'rgba(186, 230, 253, 0.92)',
    'rgba(125, 211, 252, 0.88)',
    '#0284c7',
    0.85
  );

  // 4 Trụ kẹp nhôm định hình dọc theo vách ngăn trung tâm (ở đầu bàn, giữa 3 khoang, và cuối bàn)
  for (const postY of [
    tableWy + 0.8,
    tableWy + deskH - 0.9,
    tableWy + deskH * 2 - 0.9,
    tableWy + tableWh - 2.6,
  ]) {
    drawIsoBox(
      ctx,
      midX - 1.7,
      postY,
      3.4,
      1.8,
      24.2,
      33.0,
      '#e2e8f0',
      '#94a3b8',
      '#475569',
      '#1e293b',
      0.6
    );
  }

  // Biển tên Cụm bàn (`CỤM 1.1` .. `CỤM 3.3` hoặc `CỤM N.1` .. `CỤM S.2`) gắn gọn trên trụ Bắc của Vách ngăn trung tâm
  const tagIso = worldToIso(midX, tableWy - 2, 36.5);
  const shortIsl =
    island.islandRow >= 4
      ? island.label.split('•')[0].trim()
      : `CỤM ${island.islandRow}.${island.islandCol}`;
  if (showIslandHeatmap && islandHeatStat) {
    const heatIcon =
      islandHeatStat.heatLevel === 'HOT'
        ? '🔥'
        : islandHeatStat.heatLevel === 'WARM'
        ? '⚡'
        : islandHeatStat.heatLevel === 'ACTIVE'
        ? '🟢'
        : '💠';
    const heatText = `${heatIcon} ${shortIsl} • ${islandHeatStat.activeTicketsCount}Tkt · ${islandHeatStat.transfersCount}Giao · ${islandHeatStat.buildsCount}CI`;
    ctx.font = '800 7.1px Inter, system-ui, sans-serif';
    const tw = ctx.measureText(heatText).width + 11;
    drawRoundedRect(ctx, tagIso.x - tw / 2, tagIso.y - 6.5, tw, 13, 4);
    ctx.fillStyle =
      islandHeatStat.heatLevel === 'HOT'
        ? 'rgba(127, 29, 29, 0.96)'
        : islandHeatStat.heatLevel === 'WARM'
        ? 'rgba(120, 53, 15, 0.96)'
        : 'rgba(15, 23, 42, 0.95)';
    ctx.fill();
    ctx.strokeStyle =
      islandHeatStat.heatLevel === 'HOT'
        ? '#f87171'
        : islandHeatStat.heatLevel === 'WARM'
        ? '#fbbf24'
        : islandHeatStat.heatLevel === 'ACTIVE'
        ? '#34d399'
        : '#38bdf8';
    ctx.lineWidth = 1.25;
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(heatText, tagIso.x, tagIso.y);
  } else {
    ctx.font = '800 6.8px Inter, system-ui, sans-serif';
    const tw = ctx.measureText(shortIsl).width + 9;
    drawRoundedRect(ctx, tagIso.x - tw / 2, tagIso.y - 5.5, tw, 11, 3.2);
    ctx.fillStyle = 'rgba(20, 83, 45, 0.92)';
    ctx.fill();
    ctx.strokeStyle = '#86efac';
    ctx.lineWidth = 0.9;
    ctx.stroke();
    ctx.fillStyle = '#dcfce7';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(shortIsl, tagIso.x, tagIso.y);
  }

  // --------------------------------------------------------------------------
  // 8. THIẾT BỊ TRÊN DÃY BÀN PHẢI (`colIndex = 1`): MÀN HÌNH DÃY PHẢI, BÀN PHÍM & HỒ SƠ
  //    (Đặt ngay phía Đông-Nam của vách ngăn trung tâm; màn hình quay mặt hướng SE cho người ngồi dãy Phải nhìn hướng NW)
  // --------------------------------------------------------------------------
  for (const subRow of [1, 2, 3] as const) {
    const slot = islandSlots.find((s) => s.subRow === subRow && s.side === 'RIGHT');
    if (!slot || slot.kind === 'PILLAR') continue;

    const isVacant = slot.kind === 'VACANT';
    const emp = getSlotOccupantEmp(slot);
    const roleMeta = emp ? ROLE_METADATA[emp.role] : ROLE_METADATA.BACKEND;
    const isFilteredOut = Boolean(
      activeRoleFilter !== 'ALL' && emp && emp.role !== activeRoleFilter
    );
    const leafWy = tableWy + (subRow - 1) * deskH;

    ctx.save();
    if (isFilteredOut) ctx.globalAlpha = 0.3;

    // 8A. Màn hình máy tính dãy Phải (ốp lưng vào vách ngăn giữa, mặt màn hình quay về phía SE)
    const monColor = isVacant
      ? '#94a3b8'
      : slot.highlight === 'yellow'
      ? '#eab308'
      : emp
      ? roleMeta.primaryColor
      : '#0284c7';
    const monWx = midX + 3.4;
    const monWy = slot.wy - 5.8;

    // Chân đế màn hình dãy Phải
    drawIsoBox(
      ctx,
      monWx - 0.6,
      monWy + 4.2,
      2.4,
      3.2,
      24.2,
      26.8,
      '#475569',
      '#334155',
      '#1e293b'
    );
    // Thân màn hình dãy Phải (mặt phải-trước SE là màn hình hiển thị code)
    drawIsoBox(
      ctx,
      monWx,
      monWy,
      3.0,
      11.6,
      26.4,
      34.2,
      monColor,
      '#1e293b',
      '#0f172a',
      monColor,
      0.85
    );

    // Các dòng code phát sáng trên mặt màn hình dãy Phải (quay về phía người ngồi dãy Phải)
    if (!isVacant) {
      const codeGlowX = monWx + 3.1;
      for (let lineIdx = 0; lineIdx < 3; lineIdx++) {
        const lineZ = 32.4 - lineIdx * 1.8;
        const lineLen = 5.0 + (((subRow + lineIdx + Math.floor(time * 0.006)) % 4));
        const c0 = worldToIso(codeGlowX, monWy + 1.6, lineZ);
        const c1 = worldToIso(codeGlowX, monWy + 1.6 + lineLen, lineZ);
        ctx.strokeStyle =
          lineIdx === 0 ? '#38bdf8' : lineIdx === 1 ? '#4ade80' : '#fde047';
        ctx.lineWidth = 1.15;
        ctx.beginPath();
        ctx.moveTo(c0.x, c0.y);
        ctx.lineTo(c1.x, c1.y);
        ctx.stroke();
      }
    }

    // 8B. Bàn phím cơ & Chuột đặt gần mép ngoài bên phải (nơi người ngồi dãy Phải vươn tay hướng NW gõ phím)
    const kbWx = midX + 22.0;
    const kbWy = slot.wy - 4.2;
    drawIsoBox(
      ctx,
      kbWx,
      kbWy,
      4.2,
      8.4,
      24.2,
      25.3,
      '#334155',
      '#1e293b',
      '#0f172a'
    );
    // Chuột không dây
    drawIsoBox(
      ctx,
      kbWx + 0.8,
      kbWy - 3.2,
      2.6,
      2.0,
      24.2,
      25.1,
      '#475569',
      '#334155',
      '#1e293b'
    );

    // 8C. Chồng tài liệu 3D ở góc khoang bàn Phải
    const docCount = Math.max(
      emp?.deskDocumentCount ?? (isVacant ? 0 : 1),
      emp?.assignedTicketIds?.length ?? 0
    );
    if (docCount > 0) {
      const layers = Math.min(4, docCount);
      const stackWx = midX + 9.0;
      const stackWy = leafWy + 2.0;
      for (let s = 0; s < layers; s++) {
        const zBase = 24.2 + s * 1.9;
        const topCol = s === layers - 1 ? roleMeta.primaryColor : '#ffffff';
        drawIsoBox(
          ctx,
          stackWx,
          stackWy,
          6.8,
          5.2,
          zBase,
          zBase + 1.6,
          topCol,
          '#f1f5f9',
          '#cbd5e1',
          '#334155',
          0.5
        );
      }
    }

    ctx.restore();
  }

  // --------------------------------------------------------------------------
  // 9. GHẾ XOAY TRỐNG CỦA DÃY PHẢI & NHÃN Ô ĐẶC BIỆT (TRỐNG / BÀN ĐỎ PM / HOVER)
  // --------------------------------------------------------------------------
  for (const slot of islandSlots) {
    if (slot.kind === 'PILLAR') continue;

    if (slot.side === 'RIGHT' && !isSlotPersonSeated(slot)) {
      const emp = getSlotOccupantEmp(slot);
      const chairColor =
        slot.kind === 'VACANT'
          ? '#ca8a04'
          : emp
          ? ROLE_METADATA[emp.role].primaryColor
          : '#3b82f6';
      drawBenchSwivelChairUnoccupied(
        ctx,
        slot.seatPosition.x,
        slot.seatPosition.y,
        'RIGHT',
        chairColor
      );
    }

    // Nhãn cho 2 Ô Bàn TRỐNG màu vàng (`1.101/102` kèm ghi chú `Thoa`, và `1.204`)
    if (slot.kind === 'VACANT') {
      const shortSeat = slot.seatCode.replace('FT3.III2A.', '');
      const plateIso = worldToIso(slot.wx, slot.wy, 36);
      const vacText = `${shortSeat} • TRỐNG`;
      ctx.font = '800 6.5px Inter, system-ui, sans-serif';
      const pw = ctx.measureText(vacText).width + 10;
      drawRoundedRect(ctx, plateIso.x - pw / 2, plateIso.y - 6, pw, 12, 3.5);
      ctx.fillStyle = '#fef08a';
      ctx.fill();
      ctx.strokeStyle = '#ca8a04';
      ctx.lineWidth = 1.1;
      ctx.stroke();
      ctx.fillStyle = '#854d0e';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(vacText, plateIso.x, plateIso.y);

      if (slot.sideNote) {
        const noteIso = worldToIso(slot.wx + 19, slot.wy, 36);
        const nw = ctx.measureText(slot.sideNote).width + 8;
        drawRoundedRect(ctx, noteIso.x - nw / 2, noteIso.y - 5.5, nw, 11, 3);
        ctx.fillStyle = '#fdf4ff';
        ctx.fill();
        ctx.strokeStyle = '#c026d3';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.fillStyle = '#a21caf';
        ctx.fillText(slot.sideNote, noteIso.x, noteIso.y);
      }
    } else if (slot.deskId) {
      // Nhãn mã ghế (`FT3.III2A.1.289`...) khi Hover/Select hoặc tại Bàn Đỏ PM DongNQ6
      const isSelected = Boolean(
        slot.assignedEmployeeId && slot.assignedEmployeeId === selectedEmployeeId
      );
      const isHovered = Boolean(
        slot.assignedEmployeeId && slot.assignedEmployeeId === hoveredEmployeeId
      );
      const isRedDesk = slot.highlight === 'red';
      if (isSelected || isHovered || isRedDesk) {
        const shortSeat =
          isSelected || isHovered
            ? slot.seatCode
            : slot.seatCode.replace('FT3.III2A.', '');
        const plateIso = worldToIso(slot.wx, slot.wy + 7, 26.2);
        ctx.font = '800 6.2px monospace';
        const pw = ctx.measureText(shortSeat).width + 7;
        const ph = 9.5;
        drawRoundedRect(ctx, plateIso.x - pw / 2, plateIso.y - ph / 2, pw, ph, 3);
        ctx.fillStyle = isRedDesk ? '#991b1b' : 'rgba(15, 23, 42, 0.88)';
        ctx.fill();
        ctx.strokeStyle = isRedDesk ? '#fde047' : '#38bdf8';
        ctx.lineWidth = 0.9;
        ctx.stroke();
        ctx.fillStyle = '#fde047';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(shortSeat, plateIso.x, plateIso.y);
      }
    }
  }

  // --------------------------------------------------------------------------
  // 10. TRỤ CỘT BÊ TÔNG 3D `🏛️ CỘT NHÀ` ỐP KHÍT GÓC DƯỚI-PHẢI CỦA CỤM 1.3
  // --------------------------------------------------------------------------
  if (pillarSlot) {
    drawNhaThuocStructuralPillar3D(ctx, pillarSlot);
  }

  ctx.restore();
}

/**
 * Vẽ đồng nghiệp cố định trong Khoang NHÀ THUỐC (21 ô `OCCUPIED` không thuộc 30 nhân sự chạy việc):
 * - Dãy Trái (`side === 'LEFT'`, `colIndex = 0`): Ngồi ở mép ngoài bên trái cụm bàn, quay mặt hướng `SE` nhìn vào màn hình,
 *   được vẽ TRƯỚC khối mặt bàn cụm 6 chỗ để mặt bàn tự nhiên che phần bụng dưới/chân đút dưới gầm bàn.
 * - Dãy Phải (`side === 'RIGHT'`, `colIndex = 1`): Ngồi ở mép ngoài bên phải cụm bàn, quay lưng 3/4 hướng `NW` nhìn vào màn hình,
 *   được vẽ SAU khối mặt bàn cụm 6 chỗ, 2 tay đặt lên bàn phím gõ liên tục, lưng ghế xoay nằm ở phía ngoài cùng.
 */
export function drawNhaThuocSeatedColleague3D(
  ctx: CanvasRenderingContext2D,
  slot: NhaThuocSeatSlot,
  time: number
) {
  if (slot.kind !== 'OCCUPIED') return;

  ctx.save();
  const isLeftCol = slot.side === 'LEFT';
  const seatX = slot.seatPosition.x;
  const seatY = slot.seatPosition.y;
  const shirtColor = slot.account.includes('(KH)') ? '#0d9488' : '#3b82f6';
  const bob = Math.sin(time * 0.005 + slot.wx) * 0.45;
  const seatIso = worldToIso(seatX, seatY, 14.2 + bob);

  // Chân sao 5 cánh của ghế xoay dưới sàn
  const chairBaseIso = worldToIso(seatX, seatY, 10.5);
  ctx.strokeStyle = '#334155';
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(chairBaseIso.x - 5.5, chairBaseIso.y + 1.5);
  ctx.lineTo(chairBaseIso.x + 5.5, chairBaseIso.y + 1.5);
  ctx.moveTo(chairBaseIso.x, chairBaseIso.y - 1.5);
  ctx.lineTo(chairBaseIso.x, chairBaseIso.y + 4.2);
  ctx.stroke();

  if (isLeftCol) {
    // === DÃY TRÁI (`colIndex = 0`, quay mặt hướng SE vào màn hình, vẽ TRƯỚC mặt bàn) ===
    // 1. Lưng ghế xoay ở mép ngoài bên trái (Tây-Bắc)
    drawIsoBox(
      ctx,
      seatX - 6.6,
      seatY - 5.0,
      3.2,
      10.0,
      15.5,
      25.8,
      shirtColor,
      shadeHexColor(shirtColor, -15),
      shadeHexColor(shirtColor, -30),
      '#0f172a',
      0.6
    );
    // 2. Đệm ngồi ghế xoay
    drawIsoBox(
      ctx,
      seatX - 5.6,
      seatY - 5.6,
      11.2,
      11.2,
      12.0,
      15.5,
      '#334155',
      '#1e293b',
      '#0f172a',
      '#0f172a',
      0.55
    );
    // 3. Đùi & chân đút về phía Đông-Nam dưới gầm bàn (sẽ được mặt bàn vẽ đè lên che tự nhiên)
    const kneeIso = worldToIso(seatX + 6.5, seatY, 13.5);
    drawStylizedLimbSegment(
      ctx,
      seatIso.x,
      seatIso.y - 2,
      kneeIso.x,
      kneeIso.y,
      4.2,
      '#1e293b',
      '#475569'
    );

    // 4. Thân áo đồng nghiệp (Góc nhìn 3/4 trước SE)
    drawRoundedRect(ctx, seatIso.x - 6.0, seatIso.y - 13.0, 12.0, 11.5, 4.2);
    ctx.fillStyle = shirtColor;
    ctx.fill();
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 0.95;
    ctx.stroke();

    // Cổ áo sơ mi trắng & Thẻ nhân viên
    ctx.fillStyle = '#f8fafc';
    ctx.beginPath();
    ctx.moveTo(seatIso.x - 1.2, seatIso.y - 12.6);
    ctx.lineTo(seatIso.x + 3.2, seatIso.y - 12.6);
    ctx.lineTo(seatIso.x + 1.2, seatIso.y - 8.2);
    ctx.closePath();
    ctx.fill();

    // 5. Đầu, Mặt & Mắt nhìn vào màn hình (SE)
    ctx.beginPath();
    ctx.arc(seatIso.x + 0.6, seatIso.y - 18.2, 5.6, 0, Math.PI * 2);
    ctx.fillStyle = '#fde68a';
    ctx.fill();
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 0.9;
    ctx.stroke();

    // Hai mắt nhìn hướng SE vào màn hình
    ctx.fillStyle = '#0f172a';
    ctx.beginPath();
    ctx.arc(seatIso.x + 0.8, seatIso.y - 17.6, 0.9, 0, Math.PI * 2);
    ctx.arc(seatIso.x + 3.6, seatIso.y - 18.0, 0.85, 0, Math.PI * 2);
    ctx.fill();

    // Mái tóc gọn gàng
    ctx.beginPath();
    ctx.arc(seatIso.x + 0.2, seatIso.y - 19.5, 5.5, Math.PI * 0.92, Math.PI * 2.08);
    ctx.fillStyle = '#1e293b';
    ctx.fill();
  } else {
    // === DÃY PHẢI (`colIndex = 1`, quay lưng 3/4 hướng NW vào màn hình, vẽ SAU mặt bàn) ===
    // 1. Đệm ghế dưới hông (chân đút sâu dưới gầm bàn, không vẽ chân đè lên mặt bàn)
    drawIsoBox(
      ctx,
      seatX - 5.6,
      seatY - 5.6,
      11.2,
      11.2,
      12.0,
      15.5,
      '#334155',
      '#1e293b',
      '#0f172a',
      '#0f172a',
      0.55
    );

    // 2. Hai cánh tay vươn về hướng Tây-Bắc (NW) đặt trực tiếp lên bàn phím cơ gõ liên tục
    const tapL = Math.sin(time * 0.052 + slot.wx) * 1.4;
    const tapR = Math.cos(time * 0.052 + slot.wx) * 1.4;
    const kbHandL = worldToIso(slot.wx + 6.5, slot.wy - 2.2, 25.8 + Math.max(0, tapL));
    const kbHandR = worldToIso(slot.wx + 6.5, slot.wy + 2.2, 25.8 + Math.max(0, tapR));
    drawStylizedLimbSegment(
      ctx,
      seatIso.x - 4.8,
      seatIso.y - 9.8,
      kbHandL.x,
      kbHandL.y,
      3.3,
      shadeHexColor(shirtColor, -15),
      shirtColor
    );
    drawStylizedLimbSegment(
      ctx,
      seatIso.x + 3.8,
      seatIso.y - 8.2,
      kbHandR.x,
      kbHandR.y,
      3.3,
      shirtColor,
      shadeHexColor(shirtColor, 15)
    );
    ctx.fillStyle = '#fcd34d';
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.arc(kbHandL.x, kbHandL.y, 1.95, 0, Math.PI * 2);
    ctx.arc(kbHandR.x, kbHandR.y, 1.95, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // 3. Thân áo đồng nghiệp (Góc nhìn 3/4 sau lưng NW)
    drawRoundedRect(ctx, seatIso.x - 6.0, seatIso.y - 13.0, 12.0, 11.5, 4.2);
    ctx.fillStyle = shirtColor;
    ctx.fill();
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 0.95;
    ctx.stroke();

    // Cổ áo sau gáy
    drawRoundedRect(ctx, seatIso.x - 3.6, seatIso.y - 12.8, 7.2, 3.2, 1.5);
    ctx.fillStyle = shadeHexColor(shirtColor, -16);
    ctx.fill();

    // 4. Đầu & Tóc sau gáy (NW Back 3/4 view)
    ctx.beginPath();
    ctx.arc(seatIso.x - 0.4, seatIso.y - 18.2, 5.6, 0, Math.PI * 2);
    ctx.fillStyle = '#fde68a';
    ctx.fill();
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 0.9;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(seatIso.x, seatIso.y - 18.5, 5.6, Math.PI * 0.72, Math.PI * 2.28);
    ctx.fillStyle = '#1e293b';
    ctx.fill();

    // 5. Lưng ghế xoay nằm ở mép ngoài cùng bên phải (Đông-Nam) đỡ sau lưng người ngồi
    drawIsoBox(
      ctx,
      seatX + 3.4,
      seatY - 5.0,
      3.2,
      10.0,
      15.5,
      25.8,
      shirtColor,
      shadeHexColor(shirtColor, -15),
      shadeHexColor(shirtColor, -30),
      '#0f172a',
      0.6
    );
  }

  // Nhãn tên Account gọn gàng trên đầu đồng nghiệp
  const cleanAccount = slot.account.replace(' (KH)', '').replace(/^Fresher\s+/i, '');
  const labelIso = worldToIso(seatX, seatY, 45);
  ctx.font = '800 6.8px Inter, system-ui, sans-serif';
  const lw = ctx.measureText(cleanAccount).width + 8;
  drawRoundedRect(ctx, labelIso.x - lw / 2, labelIso.y - 5.8, lw, 11.6, 3.8);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.94)';
  ctx.fill();
  ctx.strokeStyle = shirtColor;
  ctx.lineWidth = 0.95;
  ctx.stroke();
  ctx.fillStyle = '#0f172a';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(cleanAccount, labelIso.x, labelIso.y);

  ctx.restore();
}

/**
 * Tương thích ngược nếu gọi lẻ từng extraSlot (CỘT NHÀ hoặc đồng nghiệp ngồi tại bàn)
 */
export function drawNhaThuocExtraSlot3D(
  ctx: CanvasRenderingContext2D,
  slot: NhaThuocSeatSlot,
  time: number
) {
  if (slot.kind === 'PILLAR') {
    drawNhaThuocStructuralPillar3D(ctx, slot);
    return;
  }
  if (slot.kind === 'OCCUPIED') {
    drawNhaThuocSeatedColleague3D(ctx, slot, time);
  }
}

// ============================================================================
// 7. ARTICULATED 2.5D CHARACTER RIG ("HIGH-CRAFT STYLIZED 3D TOY / HABBO-HD")
//    WITH TRUE 4-WAY ISOMETRIC ROTATION (SE, SW, NE, NW) & KINEMATICS
// ============================================================================

/** Vẽ viên nang 3D có khớp nối (Articulated Capsule Limb) dùng cho đùi, cẳng chân, cánh tay */
function drawStylizedLimbSegment(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  thickness: number,
  baseColor: string,
  highlightColor: string,
  outlineColor = '#0f172a'
) {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Outer dark contour for crisp Habbo-HD / Stylized 3D Toy definition
  ctx.strokeStyle = outlineColor;
  ctx.lineWidth = thickness + 1.5;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();

  // Main 3D limb fill
  ctx.strokeStyle = baseColor;
  ctx.lineWidth = thickness;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();

  // Specular cylindrical rim highlight shifted slightly toward top-left sun
  ctx.strokeStyle = highlightColor;
  ctx.lineWidth = Math.max(1.1, thickness * 0.34);
  ctx.beginPath();
  ctx.moveTo(x0 - 0.5, y0 - 0.5);
  ctx.lineTo(x1 - 0.5, y1 - 0.5);
  ctx.stroke();
  ctx.restore();
}

/** Vẽ giày Sneaker 2 màu đế trắng xoay đúng theo trục bước đi Isometric (SE, SW, NE, NW) */
function drawStylizedSneaker(
  ctx: CanvasRenderingContext2D,
  ankleX: number,
  ankleY: number,
  fwdX: number,
  fwdY: number,
  isBackView: boolean,
  accentColor: string
) {
  ctx.save();
  const toeX = ankleX + fwdX * (isBackView ? 2.6 : 4.2);
  const toeY = ankleY + fwdY * (isBackView ? 1.8 : 2.6) + 0.8;
  const heelX = ankleX - fwdX * 1.8;
  const heelY = ankleY - fwdY * 0.9 + 0.8;

  // 1. Thick white rubber sneaker sole
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#0f172a';
  ctx.lineWidth = 5.4;
  ctx.beginPath();
  ctx.moveTo(heelX, heelY + 1.1);
  ctx.lineTo(toeX, toeY + 1.1);
  ctx.stroke();

  ctx.strokeStyle = '#f8fafc';
  ctx.lineWidth = 4.0;
  ctx.beginPath();
  ctx.moveTo(heelX, heelY + 1.0);
  ctx.lineTo(toeX, toeY + 1.0);
  ctx.stroke();

  // 2. Colored Sneaker Upper / Vamp
  ctx.strokeStyle = '#0f172a';
  ctx.lineWidth = 4.6;
  ctx.beginPath();
  ctx.moveTo(heelX, heelY - 0.4);
  ctx.lineTo(toeX - fwdX * 0.5, toeY - 0.3);
  ctx.stroke();

  ctx.strokeStyle = accentColor;
  ctx.lineWidth = 3.3;
  ctx.beginPath();
  ctx.moveTo(heelX, heelY - 0.4);
  ctx.lineTo(toeX - fwdX * 0.5, toeY - 0.3);
  ctx.stroke();

  // 3. White toe-cap (Front view SE/SW) or White heel tab (Back view NE/NW)
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  if (isBackView) {
    ctx.arc(heelX, heelY - 0.3, 1.4, 0, Math.PI * 2);
  } else {
    ctx.arc(toeX - fwdX * 0.3, toeY - 0.1, 1.5, 0, Math.PI * 2);
  }
  ctx.fill();
  ctx.restore();
}

/**
 * Vẽ chồng hồ sơ 3D (Isometric Document Stack) xoay trục theo đúng hướng người bê (SE, SW, NE, NW)
 */
function drawRotatedDocumentStack3D(
  ctx: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  isoDir: IsoDirection,
  layers: number,
  coverColor: string,
  carriedTicketKey: string,
  isDoneDoc: boolean
) {
  ctx.save();
  const flipX = isoDir === 'SE' || isoDir === 'NE' ? 1 : -1;
  // Hai trục bán kính của tập tài liệu Isometric xoay theo hướng người cầm
  const axX = flipX * 7.4;
  const axY = 3.7;
  const bxX = -flipX * 5.4;
  const bxY = 2.9;

  // Soft Ambient Shadow under the document stack
  ctx.fillStyle = 'rgba(15, 23, 42, 0.24)';
  ctx.beginPath();
  ctx.ellipse(centerX, centerY + 3.5, 9.5, 5.2, 0, 0, Math.PI * 2);
  ctx.fill();

  const layerThickness = 2.6;
  for (let i = 0; i < layers; i++) {
    const yBase = centerY - i * 3.0;
    const yTop = yBase - layerThickness;
    const isTop = i === layers - 1;
    const jitter = i % 2 === 1 ? flipX * 0.55 : 0;
    const cx = centerX + jitter;

    const pN = { x: cx - axX - bxX, y: yTop - axY - bxY };
    const pE = { x: cx + axX - bxX, y: yTop + axY - bxY };
    const pS = { x: cx + axX + bxX, y: yTop + axY + bxY };
    const pW = { x: cx - axX + bxX, y: yTop - axY + bxY };

    // Left visible paper ream edge
    const leftEdgePt = flipX > 0 ? pW : pE;
    ctx.beginPath();
    ctx.moveTo(leftEdgePt.x, leftEdgePt.y);
    ctx.lineTo(pS.x, pS.y);
    ctx.lineTo(pS.x, pS.y + layerThickness);
    ctx.lineTo(leftEdgePt.x, leftEdgePt.y + layerThickness);
    ctx.closePath();
    ctx.fillStyle = '#f8fafc';
    ctx.fill();
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 0.65;
    ctx.stroke();

    // Right visible paper ream edge
    const rightEdgePt = flipX > 0 ? pE : pW;
    ctx.beginPath();
    ctx.moveTo(pS.x, pS.y);
    ctx.lineTo(rightEdgePt.x, rightEdgePt.y);
    ctx.lineTo(rightEdgePt.x, rightEdgePt.y + layerThickness);
    ctx.lineTo(pS.x, pS.y + layerThickness);
    ctx.closePath();
    ctx.fillStyle = '#cbd5e1';
    ctx.fill();
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 0.65;
    ctx.stroke();

    // Top folder cover
    ctx.beginPath();
    ctx.moveTo(pN.x, pN.y);
    ctx.lineTo(pE.x, pE.y);
    ctx.lineTo(pS.x, pS.y);
    ctx.lineTo(pW.x, pW.y);
    ctx.closePath();
    if (isTop) {
      const covGrad = ctx.createLinearGradient(pN.x, pN.y, pS.x, pS.y);
      covGrad.addColorStop(0, shadeHexColor(coverColor, 18));
      covGrad.addColorStop(1, shadeHexColor(coverColor, -10));
      ctx.fillStyle = covGrad;
    } else {
      ctx.fillStyle = i % 2 === 0 ? '#ffffff' : '#fef9c3';
    }
    ctx.fill();
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = isTop ? 0.9 : 0.6;
    ctx.stroke();
  }

  // Golden bookmark / sticky note & mini ticket badge on top of stack
  const topY = centerY - (layers - 1) * 3.0 - layerThickness;
  ctx.fillStyle = '#fde047';
  ctx.strokeStyle = '#b45309';
  ctx.lineWidth = 0.6;
  ctx.beginPath();
  ctx.ellipse(centerX + flipX * 1.5, topY, 3.6, 2.0, flipX * 0.25, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  if (carriedTicketKey) {
    ctx.font = '800 6.5px monospace';
    const kw = ctx.measureText(carriedTicketKey).width + 6;
    drawRoundedRect(ctx, centerX - kw / 2, topY - 11, kw, 9.5, 3);
    ctx.fillStyle = isDoneDoc ? '#065f46' : '#0f172a';
    ctx.fill();
    ctx.strokeStyle = isDoneDoc ? '#34d399' : '#fde047';
    ctx.lineWidth = 0.8;
    ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(carriedTicketKey, centerX, topY - 6.2);
  }

  ctx.restore();
}

/** Vẽ trái tim Vector 3D bóng bẩy sắc nét (dùng cho Sếp Nữ ThuNDM thả tim) */
export function drawVectorHeart(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  fillColor = '#f43f5e',
  strokeColor = '#881337'
) {
  ctx.save();
  ctx.beginPath();
  const topCurveHeight = size * 0.32;
  ctx.moveTo(cx, cy + topCurveHeight);
  // Nửa trái trái tim
  ctx.bezierCurveTo(
    cx,
    cy,
    cx - size,
    cy,
    cx - size,
    cy + topCurveHeight
  );
  ctx.bezierCurveTo(
    cx - size,
    cy + (size + topCurveHeight) * 0.52,
    cx,
    cy + (size + topCurveHeight) * 0.78,
    cx,
    cy + size * 1.15
  );
  // Nửa phải trái tim
  ctx.bezierCurveTo(
    cx,
    cy + (size + topCurveHeight) * 0.78,
    cx + size,
    cy + (size + topCurveHeight) * 0.52,
    cx + size,
    cy + topCurveHeight
  );
  ctx.bezierCurveTo(
    cx + size,
    cy,
    cx,
    cy,
    cx,
    cy + topCurveHeight
  );
  ctx.closePath();
  ctx.fillStyle = fillColor;
  ctx.fill();
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = Math.max(0.7, size * 0.16);
  ctx.stroke();

  // Điểm phản sáng trắng bóng (Specular Highlight) trên trái tim 3D
  ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
  ctx.beginPath();
  ctx.arc(cx - size * 0.38, cy + size * 0.28, Math.max(0.6, size * 0.18), 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export function drawDetailedIsoCharacter(
  ctx: CanvasRenderingContext2D,
  emp: Employee,
  pos: Point2D,
  options: {
    activeTask?: DocumentTransferTask;
    isWalking: boolean;
    isCarryingDocs: boolean;
    isSelected: boolean;
    isHovered: boolean;
    isFocusedEventEmp: boolean;
    isFilteredOut: boolean;
    showLabel: boolean;
    carriedTicketKey: string;
    stackSize: number;
    isDoneDoc: boolean;
    priority: TicketPriority;
    time: number;
    isoDirection?: IsoDirection;
    facingAngle?: number;
    moveVec?: Point2D;
    deskOrientation?: Direction;
  }
) {
  const {
    isWalking,
    isCarryingDocs,
    isSelected,
    isHovered,
    isFocusedEventEmp,
    isFilteredOut,
    showLabel,
    carriedTicketKey,
    stackSize,
    isDoneDoc,
    priority,
    time,
    isoDirection: optIsoDir,
    moveVec,
  } = options;

  const roleMeta = ROLE_METADATA[emp.role];
  const empNum = parseInt(emp.id.replace(/\D/g, ''), 10) || 1;
  const isManager = Boolean(emp.isManager || emp.isFemaleManager);
  const managerMood = emp.managerMood ?? (emp.isFemaleManager ? 'loving' : undefined);
  const isFemaleManager = Boolean(
    emp.isFemaleManager ||
      emp.id === 'EMP-MANAGER-THUNDM' ||
      emp.id === 'EMP-MANAGER-DOANNT19' ||
      emp.id === 'EMP-MANAGER-VANLTB8'
  );
  const isFemale = isFemaleManager || emp.gender === 'female' || FEMALE_EMPLOYEE_IDS.has(emp.id);

  // Deterministic One Piece Character Model Archetype (6 Iconic Grand Line Crew & Boss Models)
  const onePieceModel:
    | 'STRAW_HAT_LUFFY'
    | 'SWORDSMAN_ZORO'
    | 'PIRATE_EMPRESS'
    | 'CYBORG_FRANKY'
    | 'BLACK_LEG_SANJI'
    | 'SURGEON_CHOPPER_LAW' = isFemaleManager
    ? 'PIRATE_EMPRESS'
    : emp.id === 'EMP-MANAGER-TOANLBK' || emp.role === 'DEVOPS'
    ? 'CYBORG_FRANKY'
    : emp.isProjectManager || emp.role === 'PM'
    ? 'STRAW_HAT_LUFFY'
    : emp.role === 'TECH_LEAD' || emp.role === 'BACKEND'
    ? 'SWORDSMAN_ZORO'
    : emp.role === 'FRONTEND' || emp.role === 'MOBILE'
    ? 'BLACK_LEG_SANJI'
    : emp.role === 'QA' || emp.role === 'BA'
    ? 'SURGEON_CHOPPER_LAW'
    : empNum % 6 === 1
    ? 'STRAW_HAT_LUFFY'
    : empNum % 6 === 2
    ? 'SWORDSMAN_ZORO'
    : empNum % 6 === 3
    ? 'PIRATE_EMPRESS'
    : empNum % 6 === 4
    ? 'CYBORG_FRANKY'
    : empNum % 6 === 5
    ? 'BLACK_LEG_SANJI'
    : 'SURGEON_CHOPPER_LAW';
  const isChopperVariant = onePieceModel === 'SURGEON_CHOPPER_LAW' && (emp.role === 'BA' || empNum % 2 === 1);

  const hairPalette =
    emp.id === 'EMP-MANAGER-THUNDM'
      ? { top: '#1e1b4b', side: '#0f172a' } // Tóc đen ánh tím Boa Hancock sang trọng cho Sếp nữ ThuNDM
      : emp.id === 'EMP-MANAGER-TOANLBK' || onePieceModel === 'CYBORG_FRANKY'
      ? { top: '#06b6d4', side: '#0891b2' } // Tóc Pompadour Xanh Cyan SUPER Franky cho Sếp ToanLBK & DevOps
      : emp.id === 'EMP-MANAGER-DOANNT19'
      ? { top: '#ea580c', side: '#c2410c' } // Tóc cam Hoa Tiêu Nami tươi tắn cho Sếp nữ doannt19
      : emp.id === 'EMP-MANAGER-VANLTB8'
      ? { top: '#312e81', side: '#1e1b4b' } // Tóc tím than Nico Robin cho Sếp nữ vanltb8
      : onePieceModel === 'SWORDSMAN_ZORO'
      ? { top: '#10b981', side: '#047857' } // Tóc xanh rêu Marimo (Roronoa Zoro)
      : onePieceModel === 'BLACK_LEG_SANJI'
      ? { top: '#fde047', side: '#ca8a04' } // Tóc vàng lãng tử (Vinsmoke Sanji)
      : onePieceModel === 'STRAW_HAT_LUFFY'
      ? { top: '#0f172a', side: '#020617' } // Tóc đen nhánh thuyền trưởng Mũ Rơm (Monkey D. Luffy)
      : HAIR_PALETTES[empNum % HAIR_PALETTES.length];
  const desk = DESK_BY_ID[emp.deskId] || DESK_BY_EMPLOYEE_ID[emp.id];

  // 1. Resolve exact 4-way Isometric Direction ('SE' | 'SW' | 'NE' | 'NW')
  const isoDir: IsoDirection =
    optIsoDir ??
    emp.isoDirection ??
    directionToIso(emp.facing ?? desk?.orientation ?? 'DOWN');

  // SE & NE look toward the right (+1); SW & NW look toward the left (-1)
  const flipX = isoDir === 'SE' || isoDir === 'NE' ? 1 : -1;
  // NE & NW are Back 3/4 views (walking/facing up away from camera); SE & SW are Front 3/4 views
  const isBackView = isoDir === 'NE' || isoDir === 'NW';

  // Canonical screen-space forward unit vector for this Isometric direction
  const canonFwdX = flipX * 0.86;
  const canonFwdY = isBackView ? -0.45 : 0.45;
  const fwdX =
    isWalking && moveVec && Math.hypot(moveVec.x, moveVec.y) > 0.1
      ? canonFwdX * 0.65 + moveVec.x * 0.35
      : canonFwdX;
  const fwdY =
    isWalking && moveVec && Math.hypot(moveVec.x, moveVec.y) > 0.1
      ? canonFwdY * 0.65 + moveVec.y * 0.35
      : canonFwdY;

  const isSitting =
    !isManager &&
    !emp.isSmokingAtAtrium &&
    !isWalking &&
    emp.status !== 'HANDOFF' &&
    Boolean(
      desk &&
        Math.hypot(pos.x - desk.seatPosition.x, pos.y - desk.seatPosition.y) < 6
    );
  // Khi nhân viên ngồi tại bàn làm việc (không đi bộ, không hút thuốc), luôn ở trạng thái gõ máy tính liên tục!
  const isBusy = !isManager && !emp.isSmokingAtAtrium && !isWalking && emp.status !== 'HANDOFF';

  // 2. Full-Body Kinematic Cycle (Walk Bobbing, Forward Lean, Stride along (fwdX, fwdY))
  const speedMult = emp.speedMultiplier ?? 1.0;
  const walkPhase = time * 0.019 * speedMult + empNum * 1.15;
  const walkBob = isWalking
    ? Math.abs(Math.sin(walkPhase)) * 3.8
    : Math.sin(time * 0.005 + empNum) * 0.45;
  const legSwing = isWalking ? Math.sin(walkPhase) : 0;

  // Hạ thấp độ cao khi ngồi ghế (baseZ = 8.2) để nhân vật ngồi lọt vừa vặn trong ghế xoay, không bị bay cao trên mặt bàn
  const baseZ = isSitting ? 8.2 : 9.4;
  const groundIso = worldToIso(pos.x, pos.y, 9.4);
  const rootIso = worldToIso(pos.x, pos.y, baseZ + walkBob);

  // Forward torso lean into the movement direction (Sếp ToanLBK đi 1.5x nghiêng người mạnh mẽ hơn)
  const leanX = isWalking ? fwdX * (emp.id === 'EMP-MANAGER-TOANLBK' ? 2.6 : 1.8) : isSitting ? fwdX * 1.1 : 0;
  const leanY = isWalking ? fwdY * (emp.id === 'EMP-MANAGER-TOANLBK' ? 1.3 : 0.9) : isSitting ? fwdY * 0.55 : 0;

  ctx.save();
  if (isFilteredOut) ctx.globalAlpha = 0.25;

  // --------------------------------------------------------------------------
  // LAYER 0: SELECTION HALO, 4 BOSSES MOOD AURA & GROUND SHADOW
  // --------------------------------------------------------------------------
  if (isManager) {
    const auraPulse = 19.5 + Math.sin(time * 0.006 * speedMult) * 2.5;
    const auraColors =
      managerMood === 'angry'
        ? { c0: 'rgba(220, 38, 38, 0.42)', c1: 'rgba(239, 68, 68, 0.22)', ring1: '#ef4444', ring2: '#facc15' }
        : managerMood === 'happy'
        ? { c0: 'rgba(245, 158, 11, 0.38)', c1: 'rgba(251, 191, 36, 0.20)', ring1: '#f59e0b', ring2: '#fef08a' }
        : managerMood === 'worried'
        ? { c0: 'rgba(99, 102, 241, 0.38)', c1: 'rgba(129, 140, 248, 0.20)', ring1: '#6366f1', ring2: '#bae6fd' }
        : { c0: 'rgba(244, 63, 94, 0.36)', c1: 'rgba(251, 113, 133, 0.20)', ring1: '#fb7185', ring2: '#fde047' };

    const auraGrad = ctx.createRadialGradient(
      groundIso.x,
      groundIso.y + 1,
      2,
      groundIso.x,
      groundIso.y + 1,
      auraPulse * 1.25
    );
    auraGrad.addColorStop(0, auraColors.c0);
    auraGrad.addColorStop(0.55, auraColors.c1);
    auraGrad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = auraGrad;
    ctx.beginPath();
    ctx.ellipse(groundIso.x, groundIso.y + 1, auraPulse * 1.3, auraPulse * 0.72, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = auraColors.ring1;
    ctx.lineWidth = 1.9;
    ctx.beginPath();
    ctx.ellipse(groundIso.x, groundIso.y + 1, auraPulse * 1.08, auraPulse * 0.58, 0, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = auraColors.ring2;
    ctx.lineWidth = 1.1;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.ellipse(groundIso.x, groundIso.y + 1, auraPulse * 0.82, auraPulse * 0.44, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  if (emp.isHotfixSprinter) {
    // Vòng hào quang khẩn cấp Đỏ/Cam Chớp Nháy khi kỹ sư đang chạy `⚡ HOTFIX SPRINT` ra cứu Jenkins Server
    const sprintPulse = 20 + Math.sin(time * 0.025) * 3.5;
    ctx.fillStyle = 'rgba(239, 68, 68, 0.24)';
    ctx.beginPath();
    ctx.ellipse(groundIso.x, groundIso.y, sprintPulse * 1.25, sprintPulse * 0.68, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = Math.sin(time * 0.03) > 0 ? '#ef4444' : '#facc15';
    ctx.lineWidth = 2.4;
    ctx.stroke();
  } else if (emp.mvpRank && !isFemaleManager) {
    // Vòng Hào Quang Năng Lượng cho Top 3 MVP của ca làm việc (`⭐ MVP` / `🔥 xN Streak`)
    const mvpPulse = 17.5 + Math.sin(time * 0.008 + emp.mvpRank) * 2.0;
    const auraStroke =
      emp.mvpRank === 1 ? '#facc15' : emp.mvpRank === 2 ? '#38bdf8' : '#34d399';
    ctx.strokeStyle = auraStroke;
    ctx.lineWidth = emp.mvpRank === 1 ? 2.0 : 1.5;
    ctx.beginPath();
    ctx.ellipse(groundIso.x, groundIso.y + 0.5, mvpPulse * 1.12, mvpPulse * 0.6, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  if (isSelected || isHovered || isFocusedEventEmp) {
    const pulse = 18 + Math.sin(time * 0.01) * 2.5;
    ctx.strokeStyle = isFemaleManager
      ? '#e11d48'
      : isFocusedEventEmp
      ? '#ea580c'
      : isSelected
      ? '#0284c7'
      : '#eab308';
    ctx.lineWidth = isFocusedEventEmp || isFemaleManager ? 2.4 : 1.8;
    ctx.beginPath();
    ctx.ellipse(groundIso.x, groundIso.y, pulse * 1.15, pulse * 0.62, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Multi-layered Soft Ambient Occlusion Ground Shadow
  const shadowScale = isWalking ? 1 - walkBob * 0.035 : 0.95;
  ctx.fillStyle = 'rgba(15, 23, 42, 0.10)';
  ctx.beginPath();
  ctx.ellipse(
    groundIso.x,
    groundIso.y + 1.5,
    14.5 * shadowScale,
    7.4 * shadowScale,
    0,
    0,
    Math.PI * 2
  );
  ctx.fill();

  ctx.fillStyle = 'rgba(15, 23, 42, 0.24)';
  ctx.beginPath();
  ctx.ellipse(
    groundIso.x,
    groundIso.y + 1.5,
    10.2 * shadowScale,
    5.0 * shadowScale,
    0,
    0,
    Math.PI * 2
  );
  ctx.fill();

  // If sitting at desk: draw chair star-base, and for Front 3/4 view (SE/SW), draw chair backrest BEHIND character!
  if (isSitting && desk) {
    const sx = desk.seatPosition.x;
    const sy = desk.seatPosition.y;
    const chairBaseIso = worldToIso(sx, sy, 10.5);
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(chairBaseIso.x - 6.5, chairBaseIso.y + 2);
    ctx.lineTo(chairBaseIso.x + 6.5, chairBaseIso.y + 2);
    ctx.moveTo(chairBaseIso.x, chairBaseIso.y - 2);
    ctx.lineTo(chairBaseIso.x, chairBaseIso.y + 4.5);
    ctx.stroke();

    if (!isBackView) {
      if (isoDir === 'SE') {
        // Cột Trái (facing SE): Lưng ghế nằm ở phía Tây (sx - 6.8) sau lưng nhân vật
        drawIsoBox(
          ctx,
          sx - 6.8,
          sy - 5.2,
          3.4,
          10.4,
          15.5,
          26.5,
          roleMeta.primaryColor,
          shadeHexColor(roleMeta.primaryColor, -15),
          shadeHexColor(roleMeta.primaryColor, -30),
          '#0f172a',
          0.65
        );
      } else {
        // Facing SW (DOWN): Lưng ghế nằm ở phía Bắc (sy - 7.2)
        drawIsoBox(
          ctx,
          sx - 6.2,
          sy - 7.2,
          12.4,
          3.4,
          15.5,
          26.5,
          roleMeta.primaryColor,
          shadeHexColor(roleMeta.primaryColor, -15),
          shadeHexColor(roleMeta.primaryColor, -30),
          '#0f172a',
          0.65
        );
      }
    }

    // Ergonomic Seat Cushion
    drawIsoBox(
      ctx,
      sx - 6.2,
      sy - 6.2,
      12.4,
      12.4,
      12.2,
      15.6,
      '#334155',
      '#1e293b',
      '#0f172a',
      '#0f172a',
      0.6
    );
  }

  // Body Anchor Coordinates in Screen Space
  const pelvisX = rootIso.x + leanX * 0.4;
  const pelvisY = rootIso.y - 9.0 + leanY * 0.4;
  const chestX = rootIso.x + leanX;
  const chestY = rootIso.y - 18.5 + leanY;
  const headCenterX = chestX + flipX * 0.6;
  const headCenterY = chestY - 12.2;

  const suitBase =
    emp.id === 'EMP-MANAGER-THUNDM'
      ? '#e11d48'
      : managerMood === 'angry'
      ? '#b91c1c'
      : managerMood === 'happy'
      ? '#f59e0b'
      : managerMood === 'worried'
      ? '#6366f1'
      : isFemaleManager
      ? '#e11d48'
      : onePieceModel === 'STRAW_HAT_LUFFY'
      ? '#dc2626' // Áo ghi-lê Đỏ Thuyền Trưởng Mũ Rơm Luffy
      : onePieceModel === 'SWORDSMAN_ZORO'
      ? '#065f46' // Áo choàng kiếm khách Xanh Lục Đậm Roronoa Zoro
      : onePieceModel === 'BLACK_LEG_SANJI'
      ? '#0f172a' // Vest Đen Lịch Lãm Hắc Cước Sanji
      : onePieceModel === 'CYBORG_FRANKY'
      ? '#dc2626' // Áo Hawaii Đỏ Rực SUPER Franky
      : onePieceModel === 'SURGEON_CHOPPER_LAW' && !isChopperVariant
      ? '#1e293b' // Hoodie Đen-Vàng Bác Sĩ Tử Thần Trafalgar Law
      : emp.avatarColor || roleMeta.primaryColor;
  const suitHi =
    emp.id === 'EMP-MANAGER-THUNDM'
      ? '#fb7185'
      : shadeHexColor(suitBase, 22);
  const suitMid =
    emp.id === 'EMP-MANAGER-THUNDM'
      ? '#f43f5e'
      : suitBase;
  const suitDark =
    emp.id === 'EMP-MANAGER-THUNDM'
      ? '#9f1239'
      : shadeHexColor(suitBase, -26);

  const docColors = isDoneDoc
    ? { cover: '#10b981', edge: '#d1fae5', glow: 'rgba(16, 185, 129, 0.7)' }
    : PRIORITY_COLORS[priority];
  const stackLayers = Math.max(3, Math.min(6, stackSize));
  const stackBob = Math.sin(time * 0.024 + empNum) * 1.2;

  // Shoulder sockets in 3/4 Isometric perspective
  const farShoulderX = chestX + flipX * 5.2;
  const farShoulderY = chestY + (isBackView ? 1.8 : -1.4);
  const nearShoulderX = chestX - flipX * 5.4;
  const nearShoulderY = chestY + (isBackView ? -1.4 : 1.8);

  // --------------------------------------------------------------------------
  // LAYER 1 (BACK VIEW NE/NW ONLY): CARRIED DOCUMENT STACK & FORWARD FOREARMS
  //          (Drawn FIRST so the character's back & shoulders naturally occlude it!)
  // --------------------------------------------------------------------------
  if (isBackView && isCarryingDocs) {
    const stackX = chestX + fwdX * 8.8;
    const stackY = chestY + fwdY * 6.2 + 1.5 + stackBob;

    // Hands & forearms reaching forward into NE/NW holding the stack
    drawStylizedLimbSegment(
      ctx,
      nearShoulderX,
      nearShoulderY + 1,
      stackX - flipX * 3.5,
      stackY + 2,
      3.8,
      suitDark,
      suitMid
    );
    drawStylizedLimbSegment(
      ctx,
      farShoulderX,
      farShoulderY + 1,
      stackX + flipX * 3.8,
      stackY + 2,
      3.8,
      suitMid,
      suitHi
    );

    drawRotatedDocumentStack3D(
      ctx,
      stackX,
      stackY,
      isoDir,
      stackLayers,
      docColors.cover,
      carriedTicketKey,
      isDoneDoc
    );
  } else if (isBackView && !isCarryingDocs) {
    // Back view empty-handed or typing at desk (e.g. SonNA2 facing NW into keyboard):
    const typingTap = Math.sin(time * 0.052 + empNum * 1.7) * 2.2;
    const armSwing = isWalking ? -legSwing * 4.5 : isBusy ? typingTap : 0;
    const kbFarTarget =
      isSitting && desk && isoDir === 'NW'
        ? worldToIso(desk.x + 6.5, desk.y - 2.2, 25.8)
        : null;
    const handX = kbFarTarget
      ? kbFarTarget.x + typingTap * 0.35
      : nearShoulderX + fwdX * (isSitting ? 7.8 : 2.5 + armSwing);
    const handY = kbFarTarget
      ? kbFarTarget.y - Math.abs(typingTap) * 0.55
      : nearShoulderY +
        (isSitting ? 3.2 - Math.abs(typingTap) * 0.65 : 6.5 + fwdY * (armSwing * 0.6));
    drawStylizedLimbSegment(
      ctx,
      nearShoulderX,
      nearShoulderY + 1,
      handX,
      handY,
      3.8,
      suitDark,
      suitMid
    );
    ctx.fillStyle = '#fcd34d';
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 0.75;
    ctx.beginPath();
    ctx.arc(handX, handY, 2.0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  } else if (!isBackView && !isCarryingDocs) {
    // Front 3/4 view (SE/SW): Far arm (+flipX side) drawn behind torso, typing on keyboard when seated
    const typingTap = Math.sin(time * 0.052 + empNum * 1.7) * 2.2;
    const armSwing = isWalking ? -legSwing * 4.6 : isBusy ? typingTap : 0;
    const elbowX = farShoulderX + flipX * 1.6 + fwdX * (armSwing * 0.35);
    const elbowY = farShoulderY + 3.8 + fwdY * (armSwing * 0.25);
    const handX = elbowX + fwdX * (isSitting ? 6.2 : 1.8 + armSwing * 0.6);
    const handY =
      elbowY + (isSitting ? 2.2 - Math.abs(typingTap) * 0.6 : 3.2 + fwdY * (armSwing * 0.4));
    drawStylizedLimbSegment(ctx, farShoulderX, farShoulderY + 1, elbowX, elbowY, 3.8, suitDark, suitMid);
    drawStylizedLimbSegment(ctx, elbowX, elbowY, handX, handY, 3.5, suitMid, suitHi);
    ctx.fillStyle = '#fcd34d';
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 0.75;
    ctx.beginPath();
    ctx.arc(handX, handY, 2.0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  // --------------------------------------------------------------------------
  // LAYER 2: FULL-BODY KINEMATIC LEGS & 2-TONE SNEAKERS (SORTED BACK-TO-FRONT)
  // --------------------------------------------------------------------------
  const hipSepX = 3.1;
  const hipSepY = isBackView ? -flipX * 1.1 : flipX * 1.1;

  if (isSitting && isBackView) {
    // Khi ngồi ở cột Phải quay mặt hướng NW/NE vào bàn (như SonNA2):
    // Cẳng chân & giày đút sâu dưới gầm bàn (bị bàn & đệm ghế che khuất), chỉ vẽ phần đùi ngồi trên đệm ghế!
    for (const side of [-1, 1]) {
      const hipX = pelvisX + side * hipSepX;
      const hipY = pelvisY + side * hipSepY;
      const kneeX = hipX + fwdX * 2.8;
      const kneeY = hipY + fwdY * 1.4 + 2.2;
      drawStylizedLimbSegment(ctx, hipX, hipY, kneeX, kneeY, 4.4, '#1e293b', '#475569');
    }
  } else {
    const legs = [
      { side: -1, swing: legSwing },
      { side: 1, swing: -legSwing },
    ].map((l) => {
      const hipX = pelvisX + l.side * hipSepX;
      const hipY = pelvisY + l.side * hipSepY;
      const lift = isWalking ? Math.max(0, l.swing) * 3.4 : 0;
      const strideX = isWalking
        ? fwdX * l.swing * 5.8
        : isSitting
        ? fwdX * 3.2
        : 0;
      const strideY = isWalking
        ? fwdY * l.swing * 4.0
        : isSitting
        ? fwdY * 1.8
        : 0;

      const ankleX = hipX + strideX;
      const ankleY = rootIso.y - 1.8 + l.side * hipSepY + strideY - lift;
      const kneeBend = isWalking ? 1.6 + Math.max(0, l.swing) * 1.8 : isSitting ? 2.6 : 0.6;
      const kneeX = (hipX + ankleX) * 0.5 + fwdX * kneeBend;
      const kneeY = (hipY + ankleY) * 0.5 + fwdY * (kneeBend * 0.5) - lift * 0.4;

      return { hipX, hipY, kneeX, kneeY, ankleX, ankleY };
    });

    // Sort legs by ankleY so the further leg is drawn before the nearer leg
    legs.sort((a, b) => a.ankleY - b.ankleY);

    for (const leg of legs) {
      drawStylizedSneaker(
        ctx,
        leg.ankleX,
        leg.ankleY,
        fwdX,
        fwdY,
        isBackView,
        isFemaleManager ? suitBase : roleMeta.primaryColor
      );
      drawStylizedLimbSegment(
        ctx,
        leg.hipX,
        leg.hipY,
        leg.kneeX,
        leg.kneeY,
        isFemaleManager ? 3.8 : 4.5,
        isFemaleManager ? suitDark : '#1e293b',
        isFemaleManager ? suitMid : '#475569'
      );
      drawStylizedLimbSegment(
        ctx,
        leg.kneeX,
        leg.kneeY,
        leg.ankleX,
        leg.ankleY,
        isFemaleManager ? 3.3 : 4.1,
        isFemaleManager ? '#d97706' : '#0f172a',
        isFemaleManager ? '#fde68a' : '#334155'
      );
    }

    // VÁY XÒE CHỮ A XẾP LY (PLEATED A-LINE FLARED SKIRT) CHO CẢ 3 SẾP NỮ: ThuNDM, doannt19 & vanltb8
    if (isFemaleManager) {
      const skirtSway = isWalking ? legSwing * 1.6 : 0;
      const skirtTopY = pelvisY - 2.4;
      const skirtBotY = pelvisY + 4.8;
      const topHalfW = 6.8;
      const botHalfW = 9.8;

      const skirtGrad = ctx.createLinearGradient(
        pelvisX - botHalfW,
        skirtTopY,
        pelvisX + botHalfW,
        skirtBotY
      );
      skirtGrad.addColorStop(0, suitHi);
      skirtGrad.addColorStop(0.5, suitMid);
      skirtGrad.addColorStop(1, suitDark);

      ctx.fillStyle = skirtGrad;
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 1.05;
      ctx.beginPath();
      ctx.moveTo(pelvisX - topHalfW, skirtTopY);
      ctx.lineTo(pelvisX + topHalfW, skirtTopY);
      ctx.quadraticCurveTo(
        pelvisX + botHalfW + 0.8 + skirtSway,
        (skirtTopY + skirtBotY) * 0.5,
        pelvisX + botHalfW + skirtSway,
        skirtBotY
      );
      // Gấu váy lượn sóng xếp ly mềm mại
      ctx.quadraticCurveTo(
        pelvisX + botHalfW * 0.35 + skirtSway,
        skirtBotY + 1.8,
        pelvisX + skirtSway * 0.6,
        skirtBotY + 1.1
      );
      ctx.quadraticCurveTo(
        pelvisX - botHalfW * 0.35 + skirtSway,
        skirtBotY + 1.8,
        pelvisX - botHalfW + skirtSway,
        skirtBotY
      );
      ctx.quadraticCurveTo(
        pelvisX - botHalfW - 0.8 + skirtSway,
        (skirtTopY + skirtBotY) * 0.5,
        pelvisX - topHalfW,
        skirtTopY
      );
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Đường xếp ly dọc chân váy (Pleat folds)
      ctx.strokeStyle = suitDark;
      ctx.lineWidth = 0.75;
      ctx.beginPath();
      ctx.moveTo(pelvisX - 2.6, skirtTopY + 1.0);
      ctx.lineTo(pelvisX - 4.0 + skirtSway * 0.7, skirtBotY + 0.6);
      ctx.moveTo(pelvisX + 2.6, skirtTopY + 1.0);
      ctx.lineTo(pelvisX + 4.0 + skirtSway * 0.7, skirtBotY + 0.6);
      ctx.stroke();

      // Viền gấu váy ánh kim & Thắt lưng eo vàng sang trọng
      ctx.strokeStyle = '#fde047';
      ctx.lineWidth = 1.15;
      ctx.beginPath();
      ctx.moveTo(pelvisX - topHalfW + 0.4, skirtTopY + 0.5);
      ctx.lineTo(pelvisX + topHalfW - 0.4, skirtTopY + 0.5);
      ctx.stroke();
    }
  }

  // Soft Ambient Occlusion shadow between Torso hem and Upper Thighs
  ctx.fillStyle = 'rgba(15, 23, 42, 0.32)';
  ctx.beginPath();
  ctx.ellipse(pelvisX, pelvisY + 1.5, 6.8, 2.8, 0, 0, Math.PI * 2);
  ctx.fill();

  // --------------------------------------------------------------------------
  // LAYER 3: 3D SCULPTED TORSO & ONE PIECE COSTUME DETAILS (FRONT SE/SW vs BACK NE/NW)
  // --------------------------------------------------------------------------
  ctx.save();
  const torsoW = 14.4;
  const torsoH = 14.2;
  const torsoLeft = chestX - torsoW / 2;
  const torsoTop = chestY - 3.2;

  // Pirate Empress / Female Boss Draped White-and-Gold Justice Coat (`正義`) Behind Torso in Front View
  if (onePieceModel === 'PIRATE_EMPRESS' && !isBackView) {
    const capeSway = Math.sin(walkPhase) * 1.4;
    ctx.fillStyle = '#f8fafc';
    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(torsoLeft - 1.4, torsoTop + 1.0);
    ctx.lineTo(torsoLeft + torsoW + 1.4, torsoTop + 1.0);
    ctx.lineTo(torsoLeft + torsoW + 3.2 + capeSway, torsoTop + torsoH + 2.4);
    ctx.lineTo(torsoLeft - 3.2 + capeSway, torsoTop + torsoH + 2.4);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Gold trim along draped Justice Coat hem
    ctx.strokeStyle = '#eab308';
    ctx.lineWidth = 1.1;
    ctx.beginPath();
    ctx.moveTo(torsoLeft - 3.0 + capeSway, torsoTop + torsoH + 1.8);
    ctx.lineTo(torsoLeft + torsoW + 3.0 + capeSway, torsoTop + torsoH + 1.8);
    ctx.stroke();
  }

  // Sculpted 3D Rounded Jacket / Hoodie Torso with 3-Stop Cylindrical Gradient
  drawRoundedRect(ctx, torsoLeft, torsoTop, torsoW, torsoH, 4.8);
  const torsoGrad = ctx.createLinearGradient(
    torsoLeft,
    torsoTop,
    torsoLeft + torsoW,
    torsoTop + torsoH
  );
  torsoGrad.addColorStop(0, suitHi);
  torsoGrad.addColorStop(0.5, suitMid);
  torsoGrad.addColorStop(1, suitDark);
  ctx.fillStyle = torsoGrad;
  ctx.fill();

  // Crisp Rim-Light on Top-Left Shoulder Edge
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.38)';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(torsoLeft + 2, torsoTop + 4);
  ctx.quadraticCurveTo(torsoLeft + 2, torsoTop + 1, torsoLeft + 6, torsoTop + 1);
  ctx.stroke();

  // Outer Dark Outline
  drawRoundedRect(ctx, torsoLeft, torsoTop, torsoW, torsoH, 4.8);
  ctx.strokeStyle = '#0f172a';
  ctx.lineWidth = 1.1;
  ctx.stroke();

  // One Piece Waist Sash: Luffy Yellow Captain Sash (`#facc15`) OR Zoro Green Haramaki Belly Band (`#10b981`)
  if (onePieceModel === 'STRAW_HAT_LUFFY' || onePieceModel === 'SWORDSMAN_ZORO') {
    ctx.fillStyle = onePieceModel === 'STRAW_HAT_LUFFY' ? '#facc15' : '#10b981';
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 0.75;
    drawRoundedRect(ctx, torsoLeft + 0.5, torsoTop + torsoH - 3.6, torsoW - 1.0, 3.0, 1.2);
    ctx.fill();
    ctx.stroke();
  }

  // Golden Epaulets on Both Shoulders for Pirate Empress (`PIRATE_EMPRESS`)
  if (onePieceModel === 'PIRATE_EMPRESS') {
    ctx.fillStyle = '#facc15';
    ctx.strokeStyle = '#854d0e';
    ctx.lineWidth = 0.75;
    drawRoundedRect(ctx, torsoLeft - 1.6, torsoTop - 0.3, 4.0, 2.3, 1.0);
    ctx.fill();
    ctx.stroke();
    drawRoundedRect(ctx, torsoLeft + torsoW - 2.4, torsoTop - 0.3, 4.0, 2.3, 1.0);
    ctx.fill();
    ctx.stroke();
  }

  if (!isBackView) {
    // === FRONT 3/4 TORSO DETAILS (SE & SW: Collar, Lapels, One Piece Costume Emblems) ===
    const frontCenterX = chestX + flipX * 2.1;

    // Inner shirt / chest V-neck triangle (Golden shirt for Sanji, warm skin/scar for Luffy, yellow panel for Law)
    ctx.fillStyle =
      isFemaleManager
        ? '#fff1f2'
        : onePieceModel === 'BLACK_LEG_SANJI'
        ? '#fde047'
        : onePieceModel === 'STRAW_HAT_LUFFY'
        ? '#fde68a'
        : onePieceModel === 'SURGEON_CHOPPER_LAW' && !isChopperVariant
        ? '#facc15'
        : '#f8fafc';
    ctx.beginPath();
    ctx.moveTo(frontCenterX - 3.2, torsoTop + 0.6);
    ctx.lineTo(frontCenterX + 3.2, torsoTop + 0.6);
    ctx.lineTo(frontCenterX, torsoTop + 6.2);
    ctx.closePath();
    ctx.fill();

    // Jacket center zipper / lapel line
    ctx.strokeStyle = isFemaleManager || onePieceModel === 'BLACK_LEG_SANJI' ? '#fde047' : suitDark;
    ctx.lineWidth = 1.05;
    ctx.beginPath();
    ctx.moveTo(frontCenterX, torsoTop + 5.8);
    ctx.lineTo(frontCenterX, torsoTop + torsoH - 0.8);
    ctx.stroke();

    // Lanyard strap or Golden Heart Necklace around neck
    ctx.strokeStyle =
      isFemaleManager || emp.isProjectManager || onePieceModel === 'STRAW_HAT_LUFFY'
        ? '#fde047'
        : '#e2e8f0';
    ctx.lineWidth = 1.15;
    ctx.beginPath();
    ctx.moveTo(frontCenterX - 3.2, torsoTop + 1.0);
    ctx.lineTo(frontCenterX, torsoTop + (isFemaleManager ? 5.6 : 7.2));
    ctx.lineTo(frontCenterX + 3.2, torsoTop + 1.0);
    ctx.stroke();

    if (isFemaleManager) {
      // Sếp Nữ ThuNDM: Dây chuyền mặt trái tim Ruby Vàng + Ghim cài áo Vương miện trên ngực áo Blazer Hồng Ruby
      drawVectorHeart(ctx, frontCenterX, torsoTop + 5.0, 2.2, '#fde047', '#881337');
      // Nút vàng đính áo Blazer nữ sang trọng
      ctx.fillStyle = '#fde047';
      ctx.beginPath();
      ctx.arc(frontCenterX, torsoTop + 9.2, 1.15, 0, Math.PI * 2);
      ctx.fill();
    } else if (onePieceModel === 'STRAW_HAT_LUFFY') {
      // Thuyền trưởng Mũ Rơm Luffy: Hàng cúc áo vàng nổi bật trên Ghi-lê Đỏ + vết sẹo chữ X trên ngực
      ctx.strokeStyle = '#b45309';
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.moveTo(frontCenterX - 1.3, torsoTop + 2.4);
      ctx.lineTo(frontCenterX + 1.3, torsoTop + 4.8);
      ctx.moveTo(frontCenterX + 1.3, torsoTop + 2.4);
      ctx.lineTo(frontCenterX - 1.3, torsoTop + 4.8);
      ctx.stroke();

      ctx.fillStyle = '#fde047';
      ctx.beginPath();
      ctx.arc(frontCenterX - flipX * 2.4, torsoTop + 5.8, 1.05, 0, Math.PI * 2);
      ctx.arc(frontCenterX - flipX * 2.4, torsoTop + 8.6, 1.05, 0, Math.PI * 2);
      ctx.fill();
    } else if (onePieceModel === 'BLACK_LEG_SANJI') {
      // Hắc Cước Sanji: Vest Đen 2 hàng cúc vàng + Cà vạt Hoàng Kim lịch lãm
      ctx.fillStyle = '#eab308';
      ctx.beginPath();
      ctx.moveTo(frontCenterX, torsoTop + 3.0);
      ctx.lineTo(frontCenterX - 1.5, torsoTop + 8.4);
      ctx.lineTo(frontCenterX, torsoTop + 10.4);
      ctx.lineTo(frontCenterX + 1.5, torsoTop + 8.4);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle = '#fde047';
      ctx.beginPath();
      ctx.arc(frontCenterX - 2.3, torsoTop + 7.2, 0.85, 0, Math.PI * 2);
      ctx.arc(frontCenterX + 2.3, torsoTop + 7.2, 0.85, 0, Math.PI * 2);
      ctx.fill();
    } else if (onePieceModel === 'SURGEON_CHOPPER_LAW' && !isChopperVariant) {
      // Bác sĩ Tử Thần Trafalgar Law: Biểu tượng Hải Tặc Trái Tim (Heart Pirates Smiley) vàng-đen trước ngực
      ctx.fillStyle = '#facc15';
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.arc(frontCenterX, torsoTop + 8.2, 2.7, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else {
      // 3D ID Badge Card on Chest
      const bx = frontCenterX - 2.6;
      const by = torsoTop + 6.6;
      drawRoundedRect(ctx, bx, by, 5.2, 4.2, 1.0);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 0.65;
      ctx.stroke();
      ctx.fillStyle = roleMeta.primaryColor;
      ctx.fillRect(bx + 0.6, by + 0.6, 4.0, 1.2);
    }
  } else {
    // === BACK 3/4 TORSO DETAILS (NE & NW: Draped Justice Coat `正義` / Hoodie Hood & Dorsal Seam) ===
    const backCenterX = chestX - flipX * 1.4;

    if (onePieceModel === 'PIRATE_EMPRESS') {
      // Áo Choàng Chính Nghĩa / Nữ Hoàng Hải Tặc (`正義`) khoác hờ trên vai bay phấp phới từ góc nhìn sau lưng!
      const capeSway = Math.sin(walkPhase) * 1.5;
      ctx.fillStyle = '#f8fafc';
      ctx.strokeStyle = '#94a3b8';
      ctx.lineWidth = 0.95;
      ctx.beginPath();
      ctx.moveTo(torsoLeft - 1.2, torsoTop + 0.6);
      ctx.lineTo(torsoLeft + torsoW + 1.2, torsoTop + 0.6);
      ctx.lineTo(torsoLeft + torsoW + 3.0 + capeSway, torsoTop + torsoH + 2.2);
      ctx.lineTo(torsoLeft - 3.0 + capeSway, torsoTop + torsoH + 2.2);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Viền vàng Hoàng Gia dưới gấu áo khoác + Chữ `正義` (Chính Nghĩa) sau lưng áo!
      ctx.strokeStyle = '#eab308';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(torsoLeft - 2.8 + capeSway, torsoTop + torsoH + 1.4);
      ctx.lineTo(torsoLeft + torsoW + 2.8 + capeSway, torsoTop + torsoH + 1.4);
      ctx.stroke();

      ctx.fillStyle = '#1e293b';
      ctx.font = '900 5.5px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('正義', backCenterX + capeSway * 0.4, torsoTop + 9.6);
    } else {
      // Dorsal seam line down the spine
      ctx.strokeStyle = suitDark;
      ctx.lineWidth = 1.0;
      ctx.beginPath();
      ctx.moveTo(backCenterX, torsoTop + 4.5);
      ctx.lineTo(backCenterX, torsoTop + torsoH - 1.0);
      ctx.stroke();

      // Lanyard strap wrapping behind neck
      ctx.strokeStyle = isFemaleManager || emp.isProjectManager ? '#fde047' : '#cbd5e1';
      ctx.lineWidth = 1.1;
      ctx.beginPath();
      ctx.arc(chestX, torsoTop + 1.2, 4.2, 0.15 * Math.PI, 0.85 * Math.PI);
      ctx.stroke();

      // Sculpted 3D Hoodie Hood / Back Blazer Collar resting on upper back
      const hoodW = 10.4;
      const hoodH = isFemaleManager ? 4.0 : 5.2;
      drawRoundedRect(ctx, backCenterX - hoodW / 2, torsoTop + 0.5, hoodW, hoodH, 2.4);
      ctx.fillStyle = isFemaleManager ? '#be123c' : shadeHexColor(suitBase, -14);
      ctx.fill();
      ctx.strokeStyle = isFemaleManager ? '#fde047' : '#0f172a';
      ctx.lineWidth = 0.85;
      ctx.stroke();

      // Inner hood fold shadow
      ctx.strokeStyle = suitHi;
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(backCenterX - 3.2, torsoTop + 2.0);
      ctx.quadraticCurveTo(backCenterX, torsoTop + 4.2, backCenterX + 3.2, torsoTop + 2.0);
      ctx.stroke();
    }
  }

  // RORONOA ZORO THREE-SWORD STYLE (`SANTORYU` — 3 Thanh Danh Kiếm: Wado Ichimonji, Enma, Sandai Kitetsu bên hông!)
  if (onePieceModel === 'SWORDSMAN_ZORO') {
    const hipSwordX = chestX - flipX * 6.4;
    const hipSwordY = torsoTop + torsoH - 2.2;
    const hiltColors = ['#f8fafc', '#a855f7', '#dc2626']; // Wado Ichimonji (Trắng), Enma (Tím), Sandai Kitetsu (Đỏ)
    for (let k = 0; k < 3; k++) {
      const ky = hipSwordY - k * 2.1;
      const kx = hipSwordX - flipX * (k * 0.7);
      // Bao kiếm đen vát chéo ra phía sau hông
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 1.8;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(kx, ky);
      ctx.lineTo(kx - flipX * 5.6, ky + 3.6);
      ctx.stroke();

      // Chuôi kiếm (Tsuka) 3 màu đặc trưng nhô ra phía trước hông
      ctx.strokeStyle = hiltColors[k];
      ctx.lineWidth = 2.0;
      ctx.beginPath();
      ctx.moveTo(kx, ky);
      ctx.lineTo(kx + flipX * 4.2, ky - 2.2);
      ctx.stroke();

      // Chắn kiếm tròn bằng vàng (Golden Tsuba)
      ctx.fillStyle = '#facc15';
      ctx.beginPath();
      ctx.arc(kx + flipX * 0.6, ky - 0.3, 1.25, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();

  // --------------------------------------------------------------------------
  // LAYER 4 (BACK VIEW NE/NW): NEAR ARM & SEATED CHAIR BACKREST
  // --------------------------------------------------------------------------
  if (isBackView) {
    const isCheering = isFemaleManager && emp.roamingPhase === 'CHEERING';
    const waveOffset = isFemaleManager ? Math.sin(time * 0.016) * 2.8 : 0;
    const typingTap = Math.cos(time * 0.052 + empNum * 1.7) * 2.2;
    const armSwing = isWalking ? legSwing * 4.5 : isBusy ? typingTap : 0;
    const kbNearTarget =
      isSitting && desk && isoDir === 'NW' && !isCarryingDocs && !isCheering
        ? worldToIso(desk.x + 6.5, desk.y + 2.2, 25.8)
        : null;
    const elbowX = kbNearTarget
      ? (farShoulderX + kbNearTarget.x) * 0.5 + 2.2
      : farShoulderX +
        flipX * (isCheering ? 3.8 : 1.6) +
        fwdX * (isCarryingDocs ? 2.5 : armSwing * 0.35);
    const elbowY = kbNearTarget
      ? (farShoulderY + kbNearTarget.y) * 0.5 + 2.0
      : farShoulderY +
        (isCheering ? -1.8 : 3.8) +
        fwdY * (isCarryingDocs ? 1.8 : armSwing * 0.25);
    const handX = isCarryingDocs
      ? chestX + fwdX * 6.5 + flipX * 3.2
      : isCheering
      ? elbowX + flipX * 2.8 + waveOffset
      : kbNearTarget
      ? kbNearTarget.x - typingTap * 0.35
      : elbowX + fwdX * (isSitting ? 6.2 : 1.5 + armSwing * 0.5);
    const handY = isCarryingDocs
      ? chestY + fwdY * 4.2 + 2.0 + stackBob
      : isCheering
      ? elbowY - 5.2 + Math.cos(time * 0.016) * 1.4
      : kbNearTarget
      ? kbNearTarget.y - Math.abs(typingTap) * 0.55
      : elbowY + (isSitting ? 1.8 - Math.abs(typingTap) * 0.65 : 3.0 + fwdY * (armSwing * 0.3));

    drawStylizedLimbSegment(ctx, farShoulderX, farShoulderY + 1, elbowX, elbowY, 4.0, suitMid, suitHi);
    drawStylizedLimbSegment(
      ctx,
      elbowX,
      elbowY,
      handX,
      handY,
      onePieceModel === 'CYBORG_FRANKY' ? 5.2 : 3.6,
      suitMid,
      suitHi
    );
    if (onePieceModel === 'CYBORG_FRANKY') {
      // Ngôi sao Xanh Cyan (`★`) đặc trưng trên cánh tay Cyborg SUPER Franky!
      ctx.fillStyle = '#06b6d4';
      ctx.font = '900 5.5px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('★', (elbowX + handX) * 0.5, (elbowY + handY) * 0.5 + 1.8);
    }
    if (!isCarryingDocs) {
      ctx.fillStyle = '#fcd34d';
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 0.75;
      ctx.beginPath();
      ctx.arc(handX, handY, 2.0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      if (isFemaleManager) {
        drawVectorHeart(ctx, handX + flipX * 3.2, handY - 4.8, 3.1, '#f43f5e', '#fde047');
      }
    }

    // Khi ngồi ở cột Phải (isoDir === 'NW', như SonNA2) hoặc hướng NE:
    // Vẽ lưng ghế xoay nằm ngay phía sau lưng nhân vật (phía Đông/Nam) để đỡ lưng tự nhiên!
    if (isSitting && desk) {
      if (isoDir === 'NW') {
        drawIsoBox(
          ctx,
          desk.seatPosition.x + 3.6,
          desk.seatPosition.y - 5.2,
          3.4,
          10.4,
          15.5,
          26.5,
          roleMeta.primaryColor,
          shadeHexColor(roleMeta.primaryColor, -15),
          shadeHexColor(roleMeta.primaryColor, -30),
          '#0f172a',
          0.65
        );
      } else {
        drawIsoBox(
          ctx,
          desk.seatPosition.x - 6.2,
          desk.seatPosition.y + 4.2,
          12.4,
          3.4,
          15.5,
          26.5,
          roleMeta.primaryColor,
          shadeHexColor(roleMeta.primaryColor, -15),
          shadeHexColor(roleMeta.primaryColor, -30),
          '#0f172a',
          0.65
        );
      }
    }
  }

  // --------------------------------------------------------------------------
  // LAYER 5: ROUNDED STYLIZED 3D HEAD, EXPRESSIVE FACE (SE/SW) & SCULPTED HAIR (NE/NW)
  // --------------------------------------------------------------------------
  ctx.save();
  // Head-to-Torso Ambient Occlusion Shadow & Warm Neck Cylinder
  ctx.fillStyle = 'rgba(15, 23, 42, 0.32)';
  ctx.beginPath();
  ctx.ellipse(chestX, chestY - 2.6, 5.2, 2.1, 0, 0, Math.PI * 2);
  ctx.fill();

  // Nếu là Sếp Nữ ThuNDM ở góc nhìn mặt trước (SE/SW), vẽ suối tóc dài uốn bồng bềnh buông sau vai trước khi vẽ mặt!
  if (isFemaleManager && !isBackView) {
    const hairSway = Math.sin(walkPhase) * 1.1;
    ctx.fillStyle = hairPalette.side;
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 0.9;
    // Lọn tóc dài bồng bềnh phía sau 2 bên vai
    ctx.beginPath();
    ctx.ellipse(
      headCenterX - flipX * 6.8 + hairSway * 0.5,
      headCenterY + 7.2,
      3.8,
      7.4,
      flipX * 0.16,
      0,
      Math.PI * 2
    );
    ctx.ellipse(
      headCenterX + flipX * 5.8 + hairSway * 0.5,
      headCenterY + 6.8,
      3.4,
      6.8,
      -flipX * 0.16,
      0,
      Math.PI * 2
    );
    ctx.fill();
    ctx.stroke();
  }

  drawRoundedRect(ctx, headCenterX - 2.6, chestY - 5.8, 5.2, 4.2, 2.0);
  ctx.fillStyle = '#f59e0b';
  ctx.fill();

  const headW = 15.2;
  const headH = 13.4;
  const headLeft = headCenterX - headW / 2;
  const headTop = headCenterY - headH / 2;

  // 3D Ear on the visible side of the head (-flipX for Front 3/4, +flipX for Back 3/4)
  const earX = isBackView ? headCenterX + flipX * 7.2 : headCenterX - flipX * 7.2;
  const earY = headCenterY + 0.8;
  ctx.fillStyle = '#fcd34d';
  ctx.strokeStyle = '#0f172a';
  ctx.lineWidth = 0.85;
  ctx.beginPath();
  ctx.ellipse(earX, earY, 2.2, 2.8, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  if (isFemaleManager || onePieceModel === 'PIRATE_EMPRESS') {
    // Hoa tai vàng Rắn Kuja / Ngọc trai lấp lánh của Nữ Hoàng Hải Tặc (Boa Hancock / Nami)
    ctx.fillStyle = '#fef08a';
    ctx.strokeStyle = '#b45309';
    ctx.lineWidth = 0.65;
    ctx.beginPath();
    ctx.arc(earX, earY + 2.4, 1.45, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  } else if (onePieceModel === 'SWORDSMAN_ZORO') {
    // 3 khuyên tai vàng giọt nước (Mitsudomoe) đặc trưng của Kiếm豪 Roronoa Zoro!
    ctx.fillStyle = '#facc15';
    ctx.strokeStyle = '#854d0e';
    ctx.lineWidth = 0.45;
    for (let e = -1; e <= 1; e++) {
      ctx.beginPath();
      ctx.ellipse(earX + e * 0.9, earY + 2.5, 0.5, 1.2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  // Main Rounded Stylized 3D Head with Warm Radial Skin Gradient
  drawRoundedRect(ctx, headLeft, headTop, headW, headH, 6.2);
  const skinGrad = ctx.createRadialGradient(
    headCenterX - 2.2,
    headCenterY - 2.8,
    1.5,
    headCenterX,
    headCenterY,
    10.5
  );
  skinGrad.addColorStop(0, '#fff7ed');
  skinGrad.addColorStop(0.45, '#fde68a');
  skinGrad.addColorStop(0.82, '#fcd34d');
  skinGrad.addColorStop(1, '#d97706');
  ctx.fillStyle = skinGrad;
  ctx.fill();
  ctx.strokeStyle = '#0f172a';
  ctx.lineWidth = 1.05;
  ctx.stroke();

  if (!isBackView) {
    // === FRONT 3/4 FACE & SCULPTED HAIR (SE & SW) ===
    const faceX = headCenterX + flipX * 2.2;
    const eyeY = headCenterY + 0.8;
    const nearEyeX = faceX - flipX * 2.7;
    const farEyeX = faceX + flipX * 2.6;
    const nearEyeY = eyeY + 0.25;
    const farEyeY = eyeY - 0.25;

    // Warm Rosy Cheek Blush (đậm đà rạng rỡ hơn cho Sếp Nữ ThuNDM)
    ctx.fillStyle = isFemaleManager ? 'rgba(244, 63, 94, 0.45)' : 'rgba(244, 63, 94, 0.28)';
    ctx.beginPath();
    ctx.ellipse(nearEyeX - flipX * 1.1, nearEyeY + 2.5, isFemaleManager ? 2.6 : 2.2, 1.3, 0, 0, Math.PI * 2);
    ctx.ellipse(farEyeX + flipX * 0.7, farEyeY + 2.4, isFemaleManager ? 2.1 : 1.8, 1.15, 0, 0, Math.PI * 2);
    ctx.fill();

    // Expressive Blinking & Glossy Eyes with Dual Catchlights + Mood-Specific Eyes for 4 Bosses
    const isBlinking = Math.sin(time * 0.0045 + empNum * 3.1) > 0.96;
    if (managerMood === 'happy') {
      // Sếp nữ doannt19: Mắt cười tít hình vầng trăng khuyết `^ ^` luôn rạng rỡ vui vẻ!
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 1.5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(nearEyeX, nearEyeY + 0.8, 1.9, Math.PI * 1.12, Math.PI * 1.88);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(farEyeX, farEyeY + 0.8, 1.7, Math.PI * 1.12, Math.PI * 1.88);
      ctx.stroke();
    } else if (isBlinking) {
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 1.35;
      ctx.beginPath();
      ctx.moveTo(nearEyeX - 1.6, nearEyeY);
      ctx.quadraticCurveTo(nearEyeX, nearEyeY + 1.0, nearEyeX + 1.6, nearEyeY);
      ctx.moveTo(farEyeX - 1.4, farEyeY);
      ctx.quadraticCurveTo(farEyeX, farEyeY + 1.0, farEyeX + 1.4, farEyeY);
      ctx.stroke();
    } else {
      const eyes = [
        { x: nearEyeX, y: nearEyeY, rx: 1.85, ry: 2.15 },
        { x: farEyeX, y: farEyeY, rx: 1.6, ry: 2.05 },
      ];
      for (const eye of eyes) {
        // White sclera rim
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.ellipse(eye.x, eye.y, eye.rx + 0.35, eye.ry + 0.3, 0, 0, Math.PI * 2);
        ctx.fill();

        // Dark expressive iris (Sếp ToanLBK ánh mắt sắc lạnh đỏ rực)
        ctx.fillStyle = managerMood === 'angry' ? '#450a0a' : '#0f172a';
        ctx.beginPath();
        ctx.ellipse(eye.x + flipX * 0.25, eye.y, eye.rx, eye.ry, 0, 0, Math.PI * 2);
        ctx.fill();

        // Primary top-left catchlight dot
        ctx.fillStyle = managerMood === 'angry' ? '#fca5a5' : '#ffffff';
        ctx.beginPath();
        ctx.arc(eye.x - 0.45, eye.y - 0.65, 0.72, 0, Math.PI * 2);
        ctx.fill();

        // Secondary bottom-right micro catchlight
        ctx.beginPath();
        ctx.arc(eye.x + 0.55, eye.y + 0.65, 0.35, 0, Math.PI * 2);
        ctx.fill();
      }

      if (isFemaleManager || managerMood === 'worried') {
        // Hàng lông mi cong duyên dáng cho Sếp Nữ
        ctx.strokeStyle = '#0f172a';
        ctx.lineWidth = 1.0;
        ctx.beginPath();
        ctx.moveTo(nearEyeX - flipX * 1.6, nearEyeY - 1.2);
        ctx.lineTo(nearEyeX - flipX * 2.5, nearEyeY - 2.1);
        ctx.moveTo(farEyeX + flipX * 1.4, farEyeY - 1.1);
        ctx.lineTo(farEyeX + flipX * 2.2, farEyeY - 1.9);
        ctx.stroke();
      }
    }

    // Eyebrows (Tuỳ chỉnh theo cảm xúc của 4 Sếp + Lông mày xoắn ốc Hắc Cước Sanji!)
    ctx.strokeStyle =
      managerMood === 'angry' || onePieceModel === 'BLACK_LEG_SANJI' ? '#0f172a' : hairPalette.side;
    ctx.lineWidth = managerMood === 'angry' ? 1.55 : 1.15;
    ctx.lineCap = 'round';
    ctx.beginPath();
    if (managerMood === 'angry') {
      // Sếp ToanLBK: Lông mày nhíu chặt chữ V sắc lẹm giận dữ!
      ctx.moveTo(nearEyeX - 2.0, nearEyeY - 3.3);
      ctx.lineTo(nearEyeX + 1.6, nearEyeY - 1.8);
      ctx.moveTo(farEyeX + 1.8, farEyeY - 3.3);
      ctx.lineTo(farEyeX - 1.5, farEyeY - 1.8);
    } else if (managerMood === 'worried') {
      // Sếp nữ vanltb8: Lông mày nhíu cụp hai bên đầy lo âu!
      ctx.moveTo(nearEyeX - 1.8, nearEyeY - 2.0);
      ctx.lineTo(nearEyeX + 1.5, nearEyeY - 3.2);
      ctx.moveTo(farEyeX + 1.6, farEyeY - 2.0);
      ctx.lineTo(farEyeX - 1.4, farEyeY - 3.2);
    } else {
      ctx.moveTo(nearEyeX - 1.7, nearEyeY - 2.6);
      ctx.lineTo(nearEyeX + 1.5, nearEyeY - 2.8);
      ctx.moveTo(farEyeX - 1.4, farEyeY - 2.7);
      ctx.lineTo(farEyeX + 1.4, farEyeY - 2.5);
    }
    ctx.stroke();

    // Hắc Cước Sanji (`BLACK_LEG_SANJI`): Đuôi lông mày xoắn ốc (`@` Curly Swirl Eyebrow) trứ danh!
    if (onePieceModel === 'BLACK_LEG_SANJI') {
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 1.0;
      ctx.beginPath();
      ctx.arc(nearEyeX + flipX * 1.6, nearEyeY - 2.9, 1.15, 0, Math.PI * 1.75);
      ctx.stroke();
    }

    // One Piece Iconic Facial Scars: Luffy's Stitched Scar Under Eye & Zoro's Vertical Sword Scar
    if (onePieceModel === 'STRAW_HAT_LUFFY') {
      // Vết sẹo khâu 2 mũi dưới mắt của Monkey D. Luffy
      ctx.strokeStyle = '#78350f';
      ctx.lineWidth = 0.85;
      ctx.beginPath();
      ctx.moveTo(farEyeX - 1.5, farEyeY + 2.4);
      ctx.lineTo(farEyeX + 1.5, farEyeY + 2.6);
      ctx.moveTo(farEyeX - 0.6, farEyeY + 1.9);
      ctx.lineTo(farEyeX - 0.6, farEyeY + 3.0);
      ctx.moveTo(farEyeX + 0.6, farEyeY + 2.0);
      ctx.lineTo(farEyeX + 0.6, farEyeY + 3.1);
      ctx.stroke();
    } else if (onePieceModel === 'SWORDSMAN_ZORO') {
      // Vết sẹo dọc qua mắt trái của Kiếm khách Roronoa Zoro
      ctx.strokeStyle = '#78350f';
      ctx.lineWidth = 0.85;
      ctx.beginPath();
      ctx.moveTo(farEyeX + 0.2, farEyeY - 3.2);
      ctx.lineTo(farEyeX - 0.2, farEyeY + 3.0);
      ctx.stroke();
    }

    // Mouth / Smile / Angry Clenched Teeth / Worried Tense Mouth
    if (managerMood === 'angry') {
      // Sếp ToanLBK: Miệng nghiến răng giận dữ
      drawRoundedRect(ctx, faceX - 2.0, eyeY + 2.5, 4.2, 2.2, 0.8);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.strokeStyle = '#7f1d1d';
      ctx.lineWidth = 0.85;
      ctx.stroke();
    } else if (managerMood === 'happy' || onePieceModel === 'STRAW_HAT_LUFFY') {
      // Sếp nữ doannt19 & Thuyền trưởng Luffy: Nụ cười tươi rạng rỡ hết cỡ đặc trưng!
      ctx.fillStyle = isFemaleManager ? '#e11d48' : '#ffffff';
      ctx.strokeStyle = isFemaleManager ? '#881337' : '#0f172a';
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.arc(faceX + flipX * 0.3, eyeY + 2.6, 2.1, 0, Math.PI);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else if (managerMood === 'worried') {
      // Sếp nữ vanltb8: Khuôn miệng gợn sóng căng thẳng lo âu + giọt mồ hôi lạnh `💧` bên thái dương
      ctx.strokeStyle = '#312e81';
      ctx.lineWidth = 1.15;
      ctx.beginPath();
      ctx.arc(faceX + flipX * 0.3, eyeY + 4.3, 1.65, 1.15 * Math.PI, 1.85 * Math.PI);
      ctx.stroke();

      // Giọt mồ hôi lạnh màu xanh băng (`💧`) chảy bên thái dương Sếp vanltb8
      const sweatX = headCenterX - flipX * 5.2;
      const sweatY = headCenterY - 1.2 + Math.sin(time * 0.008) * 1.1;
      ctx.fillStyle = '#38bdf8';
      ctx.strokeStyle = '#0284c7';
      ctx.lineWidth = 0.65;
      ctx.beginPath();
      ctx.moveTo(sweatX, sweatY - 2.4);
      ctx.quadraticCurveTo(sweatX + 1.8, sweatY + 0.6, sweatX, sweatY + 2.0);
      ctx.quadraticCurveTo(sweatX - 1.8, sweatY + 0.6, sweatX, sweatY - 2.4);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else {
      ctx.strokeStyle = isFemaleManager ? '#e11d48' : '#78350f';
      ctx.lineWidth = isFemaleManager ? 1.35 : 1.05;
      ctx.beginPath();
      ctx.arc(faceX + flipX * 0.3, eyeY + 2.9, isFemaleManager ? 1.75 : 1.5, 0.12 * Math.PI, 0.88 * Math.PI);
      ctx.stroke();
    }

    // SUPER Cyborg Franky (`CYBORG_FRANKY`): Kính râm chữ V đen bóng + Mũi sắt Cyborg!
    if (onePieceModel === 'CYBORG_FRANKY') {
      ctx.fillStyle = '#020617';
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.moveTo(nearEyeX - 3.2, nearEyeY - 1.8);
      ctx.lineTo(faceX, nearEyeY - 0.5);
      ctx.lineTo(farEyeX + 3.0, farEyeY - 1.8);
      ctx.lineTo(farEyeX + 2.2, farEyeY + 1.4);
      ctx.lineTo(faceX, nearEyeY + 0.8);
      ctx.lineTo(nearEyeX - 2.4, nearEyeY + 1.4);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Mũi sắt Cyborg màu bạc ánh kim của Franky
      ctx.fillStyle = '#94a3b8';
      ctx.fillRect(faceX - 0.8, eyeY + 0.4, 1.6, 1.8);
    } else if (emp.role === 'TECH_LEAD' || emp.role === 'BA') {
      // 3/4 Perspective Glasses for TECH_LEAD & BA
      ctx.strokeStyle = emp.role === 'TECH_LEAD' ? '#0284c7' : '#0f172a';
      ctx.lineWidth = 1.1;
      drawRoundedRect(ctx, nearEyeX - 2.5, nearEyeY - 2.2, 4.9, 4.1, 1.2);
      ctx.stroke();
      drawRoundedRect(ctx, farEyeX - 2.2, farEyeY - 2.2, 4.5, 4.0, 1.2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(nearEyeX + flipX * 2.2, nearEyeY - 0.3);
      ctx.lineTo(farEyeX - flipX * 2.0, farEyeY - 0.3);
      ctx.stroke();
    }

    // Sculpted Multi-Layered 3D Front Hair & Sideburns
    ctx.fillStyle = hairPalette.top;
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 0.95;
    ctx.beginPath();
    ctx.moveTo(headLeft - 0.6, headCenterY - 0.5);
    ctx.quadraticCurveTo(headLeft - 0.8, headTop - 2.5, headCenterX, headTop - 2.4);
    ctx.quadraticCurveTo(headLeft + headW + 0.8, headTop - 2.5, headLeft + headW + 0.6, headCenterY - 1.2);
    // Swept 3/4 Fringe / Bangs across forehead (Sanji's blonde hair sweeps further down over one side)
    ctx.quadraticCurveTo(
      headCenterX + flipX * 3.5,
      headTop + (onePieceModel === 'BLACK_LEG_SANJI' ? 5.2 : 3.4),
      headCenterX - flipX * 1.5,
      headTop + 4.2
    );
    ctx.quadraticCurveTo(
      headCenterX - flipX * 5.5,
      headTop + 3.2,
      headLeft - 0.6,
      headCenterY - 0.5
    );
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Sideburn / Wavy Front Locks on the near temple (-flipX side)
    ctx.fillStyle = hairPalette.side;
    ctx.beginPath();
    ctx.ellipse(
      headCenterX - flipX * 6.4,
      headCenterY + (isFemaleManager ? 2.4 : -0.2),
      isFemaleManager ? 2.3 : 1.6,
      isFemaleManager ? 6.5 : 3.6,
      flipX * 0.14,
      0,
      Math.PI * 2
    );
    ctx.fill();

    // Glossy Specular Hair Highlight Arc
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.28)';
    ctx.lineWidth = 1.6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(headCenterX - flipX * 1.0, headTop + 1.8, 4.8, 1.15 * Math.PI, 1.82 * Math.PI);
    ctx.stroke();

    // Female High Bun / Ponytail with Colored Scrunchie
    if (isFemale && !isFemaleManager) {
      const bunX = headCenterX - flipX * 4.2;
      const bunY = headTop - 2.2;
      ctx.fillStyle = hairPalette.top;
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 0.9;
      ctx.beginPath();
      ctx.arc(bunX, bunY, 3.8, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.strokeStyle = roleMeta.primaryColor;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.arc(bunX + flipX * 1.0, bunY + 1.4, 2.8, 0.1 * Math.PI, 0.9 * Math.PI);
      ctx.stroke();
    }
  } else {
    // === BACK 3/4 HEAD & FULL SCULPTED BACK HAIR (NE & NW — Sau gáy & Mái tóc phía sau) ===
    const hairBackX = headCenterX - flipX * 0.8;

    // Full Sculpted Back Hair Volume covering the cranium down to the nape
    const backHairGrad = ctx.createLinearGradient(
      headLeft,
      headTop - 2.5,
      headLeft + headW,
      headTop + headH
    );
    backHairGrad.addColorStop(0, shadeHexColor(hairPalette.top, 16));
    backHairGrad.addColorStop(0.55, hairPalette.top);
    backHairGrad.addColorStop(1, hairPalette.side);

    ctx.fillStyle = backHairGrad;
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 1.0;
    ctx.beginPath();
    ctx.moveTo(headLeft - 0.6, headCenterY + 2.8);
    ctx.quadraticCurveTo(headLeft - 1.2, headTop - 2.8, headCenterX, headTop - 2.6);
    ctx.quadraticCurveTo(
      headLeft + headW + 1.2,
      headTop - 2.6,
      headLeft + headW - flipX * 0.4,
      headCenterY + 1.8
    );
    // Tapered nape contour leaving a hint of the forward cheek/ear on +flipX side
    ctx.quadraticCurveTo(
      hairBackX,
      headTop + headH + 1.2,
      headLeft - 0.6,
      headCenterY + 2.8
    );
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Sculpted hair strand flow lines on the back of the head
    ctx.strokeStyle = hairPalette.side;
    ctx.lineWidth = 0.85;
    ctx.beginPath();
    ctx.moveTo(hairBackX - 2.5, headTop + 1.5);
    ctx.quadraticCurveTo(hairBackX - 3.0, headCenterY + 1.0, hairBackX - 2.0, headCenterY + 4.5);
    ctx.moveTo(hairBackX + 2.0, headTop + 1.5);
    ctx.quadraticCurveTo(hairBackX + 2.5, headCenterY + 1.0, hairBackX + 1.5, headCenterY + 4.5);
    ctx.stroke();

    // Glossy Specular Crown Halo Highlight on Back Hair
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.28)';
    ctx.lineWidth = 1.7;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(hairBackX, headTop + 2.2, 5.2, 1.12 * Math.PI, 1.88 * Math.PI);
    ctx.stroke();

    if (isFemaleManager) {
      // Sếp Nữ ThuNDM khi nhìn từ sau lưng (NE / NW): Suối tóc dài uốn sóng bồng bềnh phủ xuống lưng áo Blazer Hồng Ruby!
      const swayX = Math.sin(walkPhase) * 1.6;
      ctx.fillStyle = backHairGrad;
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 0.95;
      ctx.beginPath();
      ctx.moveTo(headLeft + 0.5, headCenterY + 2.0);
      ctx.bezierCurveTo(
        headLeft - 2.2 + swayX * 0.5,
        headCenterY + 7.5,
        hairBackX - 6.8 + swayX,
        chestY + 8.5,
        hairBackX + swayX,
        chestY + 10.2
      );
      ctx.bezierCurveTo(
        hairBackX + 6.8 + swayX,
        chestY + 8.5,
        headLeft + headW + 1.8 + swayX * 0.5,
        headCenterY + 7.5,
        headLeft + headW - 0.8,
        headCenterY + 2.0
      );
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Đường gợn sóng tóc óng ả và kẹp tóc nơ vàng Rose-Gold sau lưng
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.24)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(hairBackX - 3.2 + swayX * 0.4, headCenterY + 5.2);
      ctx.quadraticCurveTo(
        hairBackX + swayX * 0.7,
        headCenterY + 7.2,
        hairBackX + 3.2 + swayX * 0.4,
        headCenterY + 5.2
      );
      ctx.stroke();

      drawVectorHeart(ctx, hairBackX + swayX * 0.3, headCenterY + 2.2, 2.5, '#fde047', '#be123c');
    } else if (isFemale) {
      // Female Sculpted 3D Back Ponytail / Bun with Colored Ribbon swaying with walk
      const swayX = Math.sin(walkPhase) * 1.4;
      const ponyX = hairBackX - flipX * 2.2 + swayX;
      const ponyY = headCenterY - 1.2;

      // Colored hairband / scrunchie at back of head
      ctx.fillStyle = roleMeta.primaryColor;
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.ellipse(hairBackX - flipX * 1.5, ponyY - 1.2, 3.2, 2.0, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Sculpted 3D ponytail volume
      ctx.fillStyle = hairPalette.top;
      ctx.beginPath();
      ctx.ellipse(ponyX, ponyY + 2.2, 3.8, 4.8, -flipX * 0.25, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  // --------------------------------------------------------------------------
  // ONE PIECE SIGNATURE HEADGEAR & CROWN ACCESSORIES (6 GRAND LINE CREW MODELS)
  // --------------------------------------------------------------------------
  if (onePieceModel === 'STRAW_HAT_LUFFY') {
    // 1. MŨ RƠM HUYỀN THOẠI (`MUGIWARA` — Golden Straw Hat with Bright Red Ribbon Band `#dc2626`)
    const hatX = headCenterX;
    const hatY = headTop - 0.8;
    // Vành mũ rơm vàng rộng (Wide Golden Straw Brim)
    ctx.fillStyle = '#eab308';
    ctx.strokeStyle = '#713f12';
    ctx.lineWidth = 1.05;
    ctx.beginPath();
    ctx.ellipse(hatX, hatY + 1.4, 11.4, 3.8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Chóp mũ rơm tròn (Rounded Golden Straw Dome)
    ctx.fillStyle = '#facc15';
    ctx.beginPath();
    ctx.arc(hatX, hatY + 0.8, 6.8, Math.PI, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Dải ruy-băng Đỏ Rực (`#dc2626`) đặc trưng của Shanks & Luffy ôm quanh chóp mũ!
    ctx.fillStyle = '#dc2626';
    ctx.strokeStyle = '#7f1d1d';
    ctx.lineWidth = 0.8;
    drawRoundedRect(ctx, hatX - 6.6, hatY - 1.3, 13.2, 2.3, 1.0);
    ctx.fill();
    ctx.stroke();
  } else if (onePieceModel === 'SWORDSMAN_ZORO') {
    // 2. TÓC GAI XANH RÊU MARIMO & KHĂN ĐẦU ĐEN KIẾM KHÁCH (`RORONOA ZORO`)
    const zoroTopY = headTop - 1.6;
    if (emp.isHotfixSprinter || emp.role === 'TECH_LEAD') {
      // Khăn trùm đầu đen (Black Swordsman Bandana) khi bật chế độ nghiêm túc chém Bug!
      ctx.fillStyle = '#0f172a';
      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 0.9;
      drawRoundedRect(ctx, headLeft - 0.4, headTop - 1.2, headW + 0.8, 3.6, 1.4);
      ctx.fill();
      ctx.stroke();
      // Đuôi khăn buộc sau gáy bay theo chiều gió
      ctx.beginPath();
      ctx.moveTo(headCenterX - flipX * 6.8, headTop + 0.5);
      ctx.lineTo(headCenterX - flipX * 10.5, headTop + 2.2);
      ctx.lineTo(headCenterX - flipX * 9.2, headTop + 3.8);
      ctx.closePath();
      ctx.fill();
    } else {
      // Chỏm tóc gai xanh rêu Marimo đặc trưng trên đỉnh đầu
      ctx.fillStyle = '#10b981';
      ctx.strokeStyle = '#064e3b';
      ctx.lineWidth = 0.85;
      ctx.beginPath();
      ctx.moveTo(headCenterX - 4.8, zoroTopY + 1.5);
      ctx.lineTo(headCenterX - 3.2, zoroTopY - 2.6);
      ctx.lineTo(headCenterX - 0.8, zoroTopY + 0.4);
      ctx.lineTo(headCenterX + 0.6, zoroTopY - 3.2);
      ctx.lineTo(headCenterX + 2.4, zoroTopY + 0.4);
      ctx.lineTo(headCenterX + 4.5, zoroTopY - 2.2);
      ctx.lineTo(headCenterX + 5.0, zoroTopY + 1.5);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  } else if (onePieceModel === 'CYBORG_FRANKY') {
    // 4. TÓC POMPADOUR XANH CYAN SUPER FRANKY (`CYBORG DEVOPS` & Sếp `ToanLBK`)
    const pompX = headCenterX + flipX * 1.4;
    const pompY = headTop - 2.8;
    ctx.fillStyle = '#06b6d4';
    ctx.strokeStyle = '#0e7490';
    ctx.lineWidth = 0.95;
    ctx.beginPath();
    ctx.moveTo(headCenterX - 4.8, headTop + 0.5);
    ctx.quadraticCurveTo(pompX - 4.5, pompY - 3.8, pompX + flipX * 3.8, pompY - 2.4);
    ctx.quadraticCurveTo(pompX + flipX * 6.5, pompY + 1.2, headCenterX + 4.8, headTop + 0.8);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    if (managerMood === 'angry') {
      // Sếp nam ToanLBK: Biểu tượng gân giận dữ `💢` đỏ rực ngay bên thái dương/trán
      ctx.font = '800 8px sans-serif';
      ctx.fillText('💢', headCenterX + flipX * 5.8, headTop + 2.5);
    }
  } else if (onePieceModel === 'SURGEON_CHOPPER_LAW') {
    // 6. MŨ BÁC SĨ CHOPPER CHỮ THẬP (`✚`) CÓ SỪNG TUẦN LỘC HOẶC MŨ LÔNG TRẮNG ĐỐM ĐEN TRAFALGAR LAW!
    const hatX = headCenterX;
    const hatY = headTop - 1.6;
    if (isChopperVariant) {
      // Sừng tuần lộc nâu hai bên mũ bác sĩ Tony Tony Chopper
      ctx.strokeStyle = '#78350f';
      ctx.lineWidth = 1.7;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(hatX - 6.2, hatY + 1.2);
      ctx.lineTo(hatX - 9.4, hatY - 2.4);
      ctx.moveTo(hatX + 6.2, hatY + 1.2);
      ctx.lineTo(hatX + 9.4, hatY - 2.4);
      ctx.stroke();

      // Vành & thân mũ Hồng Rose-Pink của Chopper
      ctx.fillStyle = '#f43f5e';
      ctx.strokeStyle = '#881337';
      ctx.lineWidth = 0.95;
      ctx.beginPath();
      ctx.ellipse(hatX, hatY + 2.0, 9.2, 2.8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      drawRoundedRect(ctx, hatX - 6.2, hatY - 4.2, 12.4, 6.2, 2.8);
      ctx.fillStyle = '#fb7185';
      ctx.fill();
      ctx.stroke();

      // Dấu Chữ Thập Y Tế Trắng (`✚`) nổi bật chính giữa mũ Chopper
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(hatX, hatY - 2.8);
      ctx.lineTo(hatX, hatY + 0.6);
      ctx.moveTo(hatX - 1.7, hatY - 1.1);
      ctx.lineTo(hatX + 1.7, hatY - 1.1);
      ctx.stroke();
    } else {
      // Mũ lông trắng đốm báo đen Bắc Cực của Bác Sĩ Tử Thần Trafalgar D. Water Law
      drawRoundedRect(ctx, hatX - 7.4, hatY - 3.6, 14.8, 6.8, 3.6);
      ctx.fillStyle = '#f8fafc';
      ctx.strokeStyle = '#0f172a';
      ctx.lineWidth = 0.95;
      ctx.fill();
      ctx.stroke();

      // Hàng đốm đen đặc trưng quanh vành mũ Trafalgar Law
      ctx.fillStyle = '#0f172a';
      for (const dx of [-4.4, -1.5, 1.5, 4.4]) {
        ctx.beginPath();
        ctx.ellipse(hatX + dx, hatY + 1.2, 1.1, 0.85, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  } else if (isManager || onePieceModel === 'PIRATE_EMPRESS') {
    // 3. VƯƠNG MIỆN VÀNG NỮ HOÀNG HẢI TẶC (`PIRATE_EMPRESS` — Boa Hancock / Nami / Robin)
    const crX = headCenterX;
    const crY = headTop - (isManager ? 2.2 : 1.8);
    ctx.fillStyle = '#fde047';
    ctx.strokeStyle = '#78350f';
    ctx.lineWidth = 0.95;
    ctx.beginPath();
    ctx.moveTo(crX - 5.0, crY + 2.2);
    ctx.lineTo(crX - 5.4, crY - 2.8);
    ctx.lineTo(crX - 2.2, crY - 0.5);
    ctx.lineTo(crX, crY - 4.2);
    ctx.lineTo(crX + 2.2, crY - 0.5);
    ctx.lineTo(crX + 5.4, crY - 2.8);
    ctx.lineTo(crX + 5.0, crY + 2.2);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    if (isFemaleManager || onePieceModel === 'PIRATE_EMPRESS') {
      // Đính viên ngọc Trái Tim Hồng Ruby ở chính giữa Vương miện Nữ Hoàng Hải Tặc
      drawVectorHeart(ctx, crX, crY - 1.4, 2.0, '#e11d48', '#ffffff');
    }
  }
  ctx.restore();

  // --------------------------------------------------------------------------
  // LAYER 6 (FRONT VIEW SE/SW): CARRIED 3D DOCUMENT STACK & CRADLING ARMS
  //          (Drawn IN FRONT OF Torso in SE/SW so hands visibly hug the stack!)
  // --------------------------------------------------------------------------
  if (!isBackView && isCarryingDocs) {
    const stackX = chestX + fwdX * 8.2;
    const stackY = chestY + fwdY * 5.8 + 2.5 + stackBob;

    // Far arm wrapping around the far side of the stack
    drawStylizedLimbSegment(
      ctx,
      farShoulderX,
      farShoulderY + 1.5,
      stackX + flipX * 4.5,
      stackY + 1.0,
      3.8,
      suitMid,
      suitHi
    );

    // 3D Isometric Document Stack rotated to match SE/SW
    drawRotatedDocumentStack3D(
      ctx,
      stackX,
      stackY,
      isoDir,
      stackLayers,
      docColors.cover,
      carriedTicketKey,
      isDoneDoc
    );

    // Near articulated arm (Shoulder -> Elbow -> Hand) cradling the front of the stack
    const elbowX = nearShoulderX - flipX * 1.2;
    const elbowY = nearShoulderY + 5.2;
    const handX = stackX - flipX * 2.8;
    const handY = stackY + 2.6;
    drawStylizedLimbSegment(ctx, nearShoulderX, nearShoulderY + 1, elbowX, elbowY, 4.0, suitMid, suitHi);
    drawStylizedLimbSegment(
      ctx,
      elbowX,
      elbowY,
      handX,
      handY,
      onePieceModel === 'CYBORG_FRANKY' ? 5.2 : 3.6,
      suitMid,
      suitHi
    );
    if (onePieceModel === 'CYBORG_FRANKY') {
      ctx.fillStyle = '#06b6d4';
      ctx.font = '900 5.5px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('★', (elbowX + handX) * 0.5, (elbowY + handY) * 0.5 + 1.8);
    }

    // Both hands gripping the stack
    ctx.fillStyle = '#fcd34d';
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 0.75;
    ctx.beginPath();
    ctx.arc(handX, handY, 2.1, 0, Math.PI * 2);
    ctx.arc(stackX + flipX * 4.8, stackY + 1.6, 2.0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  } else if (!isBackView && !isCarryingDocs) {
    // Front 3/4 view (SE/SW) Near Arm swinging or waving hearts (for ThuNDM) or typing on keyboard when seated
    const isCheering = isFemaleManager && emp.roamingPhase === 'CHEERING';
    const waveMotion = isFemaleManager ? Math.sin(time * 0.016) * 2.8 : 0;
    const typingTap = Math.cos(time * 0.052 + empNum * 1.7) * 2.2;
    const armSwing = isWalking ? legSwing * 4.8 : isBusy ? typingTap : 0;
    const elbowX = nearShoulderX - flipX * (isCheering ? 3.2 : 1.5) + fwdX * (armSwing * 0.35);
    const elbowY = nearShoulderY + (isCheering ? -1.4 : 4.0) + fwdY * (armSwing * 0.25);
    const handX = isCheering
      ? elbowX - flipX * 2.4 + waveMotion
      : elbowX + fwdX * (isSitting ? 6.5 : 1.8 + armSwing * 0.65);
    const handY = isCheering
      ? elbowY - 5.4 + Math.cos(time * 0.016) * 1.4
      : elbowY + (isSitting ? 2.2 - Math.abs(typingTap) * 0.65 : 3.2 + fwdY * (armSwing * 0.45));

    drawStylizedLimbSegment(ctx, nearShoulderX, nearShoulderY + 1, elbowX, elbowY, 4.0, suitMid, suitHi);
    drawStylizedLimbSegment(
      ctx,
      elbowX,
      elbowY,
      handX,
      handY,
      onePieceModel === 'CYBORG_FRANKY' ? 5.2 : 3.6,
      suitMid,
      suitHi
    );
    if (onePieceModel === 'CYBORG_FRANKY') {
      // Ngôi sao Xanh Cyan (`★`) đặc trưng trên cánh tay Cyborg SUPER Franky!
      ctx.fillStyle = '#06b6d4';
      ctx.font = '900 5.5px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('★', (elbowX + handX) * 0.5, (elbowY + handY) * 0.5 + 1.8);
    } else if (onePieceModel === 'PIRATE_EMPRESS') {
      // La bàn vĩnh cửu Log Pose bằng pha lê xanh lấp lánh trên cổ tay Hoa Tiêu / Nữ Hoàng Hải Tặc!
      ctx.fillStyle = '#38bdf8';
      ctx.strokeStyle = '#fde047';
      ctx.lineWidth = 0.7;
      ctx.beginPath();
      ctx.arc((elbowX + handX) * 0.5, (elbowY + handY) * 0.5, 1.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.fillStyle = '#fcd34d';
    ctx.strokeStyle = '#0f172a';
    ctx.lineWidth = 0.75;
    ctx.beginPath();
    ctx.arc(handX, handY, 2.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    if (isFemaleManager) {
      // Trái tim 3D đỏ hồng trên tay Sếp Nữ ThuNDM đang vẫy tay thả tim cho anh em
      drawVectorHeart(ctx, handX - flipX * 2.8, handY - 5.2, 3.3, '#f43f5e', '#fde047');
    } else if (emp.isSmokingAtAtrium) {
      // Nhân viên đang đứng ở hành lang Giếng trời hút thuốc (`🚬 💨`):
      // Tay cầm điếu thuốc lá trắng có đầu lọc vàng và đốm lửa đỏ cam ở đầu điếu thuốc!
      const cigBaseX = handX + flipX * 1.2;
      const cigBaseY = handY - 2.2;
      const cigTipX = cigBaseX + flipX * 5.2;
      const cigTipY = cigBaseY - 2.4;

      // Thân điếu thuốc trắng
      ctx.strokeStyle = '#f8fafc';
      ctx.lineWidth = 1.9;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(cigBaseX, cigBaseY);
      ctx.lineTo(cigTipX, cigTipY);
      ctx.stroke();

      // Đầu lọc màu vàng cam sát ngón tay
      ctx.strokeStyle = '#f59e0b';
      ctx.lineWidth = 1.9;
      ctx.beginPath();
      ctx.moveTo(cigBaseX, cigBaseY);
      ctx.lineTo(cigBaseX + flipX * 1.8, cigBaseY - 0.8);
      ctx.stroke();

      // Đốm lửa đỏ/cam rực cháy ở đầu điếu thuốc
      const emberPulse = 1.4 + Math.sin(time * 0.015 + empNum) * 0.4;
      ctx.fillStyle = Math.sin(time * 0.02 + empNum) > 0 ? '#ef4444' : '#f97316';
      ctx.beginPath();
      ctx.arc(cigTipX, cigTipY, emberPulse, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // --------------------------------------------------------------------------
  // LAYER 7: FLOATING MOOD PARTICLES (4 BOSSES), ATRIUM SMOKE PUFFS (`🚬 💨`), WORK SYMBOLS & CLEAN NAME PILL
  // --------------------------------------------------------------------------
  if (isFemaleManager) {
    // Hiệu ứng thả tim liên tục (Floating 3D Vector Hearts ❤️ 💖 💕 ✨) bay bổng tỏa ra xung quanh Sếp ThuNDM!
    const heartColors = ['#e11d48', '#f43f5e', '#fb7185', '#ec4899'];
    for (let h = 0; h < 5; h++) {
      const cycle = (time * 0.00095 + h * 0.2) % 1;
      const angle = time * 0.0022 + h * ((Math.PI * 2) / 5);
      const radius = 9 + cycle * 19;
      const hx = rootIso.x + Math.cos(angle) * radius;
      const hy = rootIso.y - 16 - cycle * 32 + Math.sin(angle * 2) * 2.5;
      const hSize = (1 - cycle * 0.45) * (h % 2 === 0 ? 3.8 : 3.0);
      ctx.save();
      ctx.globalAlpha = (isFilteredOut ? 0.25 : 0.95) * Math.sin(cycle * Math.PI);
      drawVectorHeart(
        ctx,
        hx,
        hy,
        hSize,
        heartColors[h % heartColors.length],
        '#fff1f2'
      );
      ctx.restore();
    }
  } else if (isManager && managerMood) {
    // Hiệu ứng icon cảm xúc bay quanh 3 Sếp mới (`ToanLBK`: 💢 😡 🔥 ⚡, `doannt19`: 😄 🌸 ✨ 🎵, `vanltb8`: 😰 💧 💦 ⚠️)
    const moodParticles =
      managerMood === 'angry'
        ? ['💢', '😡', '🔥', '⚡']
        : managerMood === 'happy'
        ? ['😄', '🌸', '✨', '🎵']
        : ['😰', '💧', '💦', '⚠️'];
    for (let p = 0; p < 4; p++) {
      const cycle = (time * 0.0011 * speedMult + p * 0.25) % 1;
      const angle = time * 0.0024 + p * (Math.PI / 2);
      const radius = 10 + cycle * 17;
      const px = rootIso.x + Math.cos(angle) * radius;
      const py = rootIso.y - 18 - cycle * 28;
      ctx.save();
      ctx.globalAlpha = (isFilteredOut ? 0.25 : 0.92) * Math.sin(cycle * Math.PI);
      ctx.font = '800 8.5px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(moodParticles[p % moodParticles.length], px, py);
      ctx.restore();
    }
  }

  // Hiệu ứng khói thuốc trắng xám (`🚬 💨`) bay lơ lửng lên trời khi nhân viên đứng tụ tập hút thuốc quanh Giếng trời
  if (emp.isSmokingAtAtrium && !isWalking) {
    for (let s = 0; s < 4; s++) {
      const puffCycle = (time * 0.00085 + empNum * 0.31 + s * 0.25) % 1;
      const puffX =
        headCenterX +
        flipX * (5.5 + puffCycle * 7.5) +
        Math.sin(time * 0.004 + s * 1.8) * 3.2;
      const puffY = headCenterY - 2.0 - puffCycle * 28;
      const puffRadius = 2.4 + puffCycle * 5.2;

      ctx.save();
      ctx.globalAlpha = (isFilteredOut ? 0.2 : 0.68) * Math.sin(puffCycle * Math.PI);
      ctx.fillStyle = s % 2 === 0 ? '#e2e8f0' : '#cbd5e1';
      ctx.beginPath();
      ctx.arc(puffX, puffY, puffRadius, 0, Math.PI * 2);
      ctx.fill();
      if (s === 0 && puffCycle > 0.25 && puffCycle < 0.85) {
        ctx.font = '700 7.5px sans-serif';
        ctx.fillText('💨', puffX + flipX * 3, puffY - 2);
      }
      ctx.restore();
    }
  }

  if (!isCarryingDocs) {
    if (isBusy) {
      const floatPhase = (time * 0.0018 + empNum * 0.27) % 1;
      const symbolIso = worldToIso(pos.x + flipX * 7, pos.y - 3, baseZ + 43 + floatPhase * 12);
      ctx.font = '800 7.5px monospace';
      ctx.fillStyle = roleMeta.primaryColor;
      ctx.globalAlpha = (isFilteredOut ? 0.25 : 0.88) * (1 - floatPhase);
      const symbol =
        emp.role === 'QA'
          ? '✓ PASS'
          : emp.role === 'TECH_LEAD'
          ? '🔎 PR'
          : emp.role === 'PM'
          ? '📋 SPEC'
          : emp.role === 'DEVOPS'
          ? '⚡ K8S'
          : '</>';
      ctx.fillText(symbol, symbolIso.x, symbolIso.y);
      ctx.globalAlpha = isFilteredOut ? 0.25 : 1;
    }

    // Tên nhân vật: 4 Sếp hiện rõ `👑 ThuNDM ❤️`, `👑 ToanLBK 💢`, `👑 doannt19 😄`, `👑 vanltb8 😰`
    // Nhân viên hút thuốc ở Giếng trời hiện `🚬 Account 💨`
    if (showLabel || isManager || emp.isSmokingAtAtrium) {
      const headIso = worldToIso(pos.x, pos.y, baseZ + (isManager ? 41 : 38));
      const cleanAcc = (emp.account || emp.displayName)
        .replace(' (KH)', '')
        .replace(/\s*\(PM\)/i, '')
        .replace(/^(PM|BA|Lead|BE|FE|Mob|QA|Ops)\s+/i, '');
      const streak = emp.codingStreak ?? 0;
      const mvpRank = emp.mvpRank ?? null;
      const bossSuffix =
        managerMood === 'angry'
          ? '💢'
          : managerMood === 'happy'
          ? '😄'
          : managerMood === 'worried'
          ? '😰'
          : '❤️';
      const labelText = isManager
        ? `👑 ${cleanAcc} ${bossSuffix}`
        : emp.isCheckingOut
        ? `🏠 ${cleanAcc} 👋`
        : emp.isSmokingAtAtrium
        ? `🚬 ${cleanAcc} 💨`
        : emp.isHotfixSprinter
        ? `⚡ ${cleanAcc} 🚨`
        : mvpRank === 1
        ? `${cleanAcc} ⭐🔥${Math.max(2, streak)}`
        : mvpRank === 2 || mvpRank === 3
        ? `${cleanAcc} ⭐${streak >= 2 ? `🔥${streak}` : ''}`
        : streak >= 2
        ? `${cleanAcc} 🔥${streak}`
        : cleanAcc;
      ctx.font = isManager
        ? '800 7.8px Inter, system-ui, sans-serif'
        : mvpRank || emp.isSmokingAtAtrium || emp.isCheckingOut
        ? '800 7.2px Inter, system-ui, sans-serif'
        : '800 7.0px Inter, system-ui, sans-serif';
      const lw = ctx.measureText(labelText).width + (isManager ? 13 : mvpRank ? 10 : 9);
      const lh = isManager ? 14 : 12.5;

      drawRoundedRect(ctx, headIso.x - lw / 2, headIso.y - lh / 2, lw, lh, isManager ? 7 : 4);
      ctx.fillStyle = isFemaleManager
        ? '#be123c'
        : managerMood === 'angry'
        ? '#7f1d1d'
        : managerMood === 'happy'
        ? '#b45309'
        : managerMood === 'worried'
        ? '#312e81'
        : emp.isCheckingOut
        ? '#9a3412'
        : emp.isSmokingAtAtrium
        ? '#334155'
        : emp.isHotfixSprinter
        ? '#dc2626'
        : emp.isProjectManager
        ? '#991b1b'
        : isSelected || isHovered
        ? '#0f172a'
        : mvpRank === 1
        ? 'rgba(15, 23, 42, 0.96)'
        : 'rgba(255, 255, 255, 0.94)';
      ctx.fill();
      ctx.strokeStyle = isManager
        ? '#fde047'
        : emp.isCheckingOut
        ? '#fb923c'
        : emp.isSmokingAtAtrium
        ? '#f97316'
        : emp.isHotfixSprinter
        ? '#fef08a'
        : emp.isProjectManager
        ? '#fde047'
        : mvpRank === 1
        ? '#facc15'
        : mvpRank === 2
        ? '#38bdf8'
        : mvpRank === 3
        ? '#10b981'
        : isSelected
        ? '#38bdf8'
        : roleMeta.primaryColor;
      ctx.lineWidth =
        isManager || emp.isHotfixSprinter || emp.isSmokingAtAtrium || emp.isCheckingOut
          ? 1.45
          : emp.isProjectManager || isSelected || mvpRank
          ? 1.3
          : 0.95;
      ctx.stroke();

      ctx.fillStyle = isManager
        ? '#fff1f2'
        : emp.isCheckingOut
        ? '#fef08a'
        : emp.isSmokingAtAtrium
        ? '#fef08a'
        : emp.isHotfixSprinter
        ? '#fef08a'
        : emp.isProjectManager
        ? '#fef08a'
        : mvpRank === 1
        ? '#fef08a'
        : isSelected || isHovered
        ? '#ffffff'
        : '#0f172a';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(labelText, headIso.x, headIso.y + 0.3);

      // Bong bóng thoại của 4 Sếp đi tuần tra HOẶC nhân viên đi về sau 2h không có event / nhận bàn trống từ Giếng trời!
      const floatingCharSpeech = isManager
        ? emp.roamingSpeechText
        : (emp.isCheckingOut || emp.isWalkingFromEntrance) && emp.checkoutSpeechText
        ? emp.checkoutSpeechText
        : null;
      if (floatingCharSpeech) {
        const speech = floatingCharSpeech;
        ctx.font = '700 7.6px Inter, system-ui, sans-serif';
        const sw = ctx.measureText(speech).width + 14;
        const sh = 15;
        const floatY = Math.sin(time * 0.008) * 1.5;
        const sx = headIso.x - sw / 2;
        const sy = headIso.y - lh / 2 - sh - 5 + floatY;

        const bubbleColors = !isManager
          ? emp.isCheckingOut
            ? { bg: 'rgba(255, 247, 237, 0.98)', border: '#ea580c', text: '#7c2d12' }
            : { bg: 'rgba(240, 253, 244, 0.98)', border: '#16a34a', text: '#14532d' }
          : managerMood === 'angry'
            ? { bg: 'rgba(254, 242, 242, 0.98)', border: '#dc2626', text: '#7f1d1d' }
            : managerMood === 'happy'
            ? { bg: 'rgba(254, 252, 232, 0.98)', border: '#f59e0b', text: '#78350f' }
            : managerMood === 'worried'
            ? { bg: 'rgba(238, 242, 255, 0.98)', border: '#6366f1', text: '#1e1b4b' }
            : { bg: 'rgba(255, 241, 242, 0.97)', border: '#f43f5e', text: '#9f1239' };

        ctx.save();
        ctx.shadowColor = 'rgba(15, 23, 42, 0.25)';
        ctx.shadowBlur = 8;
        drawRoundedRect(ctx, sx, sy, sw, sh, 7.5);
        ctx.fillStyle = bubbleColors.bg;
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = bubbleColors.border;
        ctx.lineWidth = 1.25;
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(headIso.x - 3.5, sy + sh);
        ctx.lineTo(headIso.x, sy + sh + 4);
        ctx.lineTo(headIso.x + 3.5, sy + sh);
        ctx.closePath();
        ctx.fillStyle = bubbleColors.bg;
        ctx.fill();
        ctx.strokeStyle = bubbleColors.border;
        ctx.lineWidth = 1.1;
        ctx.stroke();

        ctx.fillStyle = bubbleColors.text;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(speech, headIso.x, sy + sh / 2 + 0.4);
        ctx.restore();
      }
    }
  }

  ctx.restore();
}

// ============================================================================
// 8. FLEZIMERCURIA FLOATING CALLOUT BADGES & `● WINA` EVENT PILLS
// ============================================================================

export function formatFlezimercuriaName(emp?: Employee, fallbackId?: string): string {
  if (!emp) return (fallbackId || 'STAFF').toUpperCase();
  return (emp.account || emp.displayName)
    .replace(' (KH)', '')
    .replace(/\s*\(PM\)/i, '');
}

/** Đã tắt vẽ biển hiệu phân khu nổi 01..09 (Mobile Lab, PM Command, v.v.) theo yêu cầu để mặt bằng sạch thoáng 100% */
export function drawFlezimercuriaZoneCallouts(_ctx: CanvasRenderingContext2D) {
  // No-op: removed floating zone callout signboards & bullseye pins
}

export interface ScreenLabelRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface WinaEventPillItem {
  emp: Employee;
  pos: Point2D;
  activeTask?: DocumentTransferTask;
  isDoneDoc: boolean;
  ticketKey: string;
  speechText?: string;
  /** Chỉ hiển thị Speech Bubble cho nhân vật đang được Camera Focus (primary active event) hoặc nhân vật đang hover/click */
  showSpeechBubble?: boolean;
  isPrimaryFocus?: boolean;
  isHotfixSprint?: boolean;
  hotfixBuildNumber?: number;
  screenOffsetY?: number;
}

/** Vẽ thẻ `● WINA` Dark Navy Pill Badge gọn gàng trên đầu nhân vật đang mang tài liệu hoặc chạy Hotfix */
export function drawWinaEventPillBadge(
  ctx: CanvasRenderingContext2D,
  item: WinaEventPillItem
) {
  const {
    emp,
    pos,
    activeTask,
    isDoneDoc,
    ticketKey,
    speechText,
    showSpeechBubble = false,
    isHotfixSprint = false,
    hotfixBuildNumber,
    screenOffsetY = 0,
  } = item;
  const toEmp = activeTask ? EMPLOYEE_BY_ID[activeTask.toEmployeeId] : undefined;
  const fromShort = formatFlezimercuriaName(emp);
  const toShort = formatFlezimercuriaName(toEmp, activeTask?.toEmployeeId);

  const pillText = isHotfixSprint
    ? `⚡ HOTFIX SPRINT • ${fromShort} ➔ SERVER [#${hotfixBuildNumber ?? 2843}]`
    : isDoneDoc
    ? `★ ${toShort || fromShort} [${ticketKey} DONE]`
    : `${fromShort} ➔ ${toShort} [${ticketKey}]`;

  const rawBadgeIso = worldToIso(pos.x, pos.y, 56);
  const badgeIso = { x: rawBadgeIso.x, y: rawBadgeIso.y + screenOffsetY };
  const headIso = worldToIso(pos.x, pos.y, 43);

  ctx.save();

  const accentColor = isHotfixSprint
    ? '#ef4444'
    : isDoneDoc
    ? '#10b981'
    : '#f97316';

  ctx.strokeStyle = accentColor;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(headIso.x, headIso.y);
  ctx.lineTo(badgeIso.x, badgeIso.y + 8.5);
  ctx.stroke();

  ctx.font = '800 8.1px Inter, system-ui, sans-serif';
  const textW = ctx.measureText(pillText).width;
  const pillW = textW + 23;
  const pillH = 18.5;
  const px = badgeIso.x - pillW / 2;
  const py = badgeIso.y - pillH / 2;

  ctx.shadowColor = isHotfixSprint
    ? 'rgba(239, 68, 68, 0.55)'
    : isDoneDoc
    ? 'rgba(16, 185, 129, 0.42)'
    : 'rgba(249, 115, 22, 0.42)';
  ctx.shadowBlur = 8;

  drawRoundedRect(ctx, px - 2, py - 2, pillW + 4, pillH + 4, (pillH + 4) / 2);
  ctx.fillStyle = isHotfixSprint
    ? 'rgba(239, 68, 68, 0.25)'
    : isDoneDoc
    ? 'rgba(16, 185, 129, 0.20)'
    : 'rgba(249, 115, 22, 0.20)';
  ctx.fill();
  ctx.strokeStyle = accentColor;
  ctx.lineWidth = 1.55;
  ctx.stroke();

  drawRoundedRect(ctx, px, py, pillW, pillH, pillH / 2);
  ctx.fillStyle = isHotfixSprint ? '#450a0a' : '#0f172a';
  ctx.fill();
  ctx.shadowBlur = 0;

  const dotX = px + 8.8;
  const dotY = py + pillH / 2;
  ctx.fillStyle = isHotfixSprint
    ? '#facc15'
    : isDoneDoc
    ? '#34d399'
    : '#38bdf8';
  ctx.beginPath();
  ctx.arc(dotX, dotY, 3.1, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = isHotfixSprint ? '#fef08a' : '#ffffff';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(pillText, px + 15.5, dotY + 0.4);

  // Chỉ hiển thị Speech Bubble câu thoại cho nhân vật đang được Camera Focus (primary active event) hoặc được hover/click
  if (speechText && showSpeechBubble) {
    ctx.font = '600 7.6px Inter, system-ui, sans-serif';
    const bw = ctx.measureText(speechText).width + 13;
    const bh = 14.5;
    const bx = badgeIso.x - bw / 2;
    const by = py - bh - 3.5;

    drawRoundedRect(ctx, bx, by, bw, bh, 7.2);
    ctx.fillStyle = isHotfixSprint
      ? '#fef2f2'
      : isDoneDoc
      ? '#ecfdf5'
      : '#ffffff';
    ctx.fill();
    ctx.strokeStyle = isHotfixSprint
      ? '#ef4444'
      : isDoneDoc
      ? '#10b981'
      : '#0284c7';
    ctx.lineWidth = 1.05;
    ctx.stroke();

    ctx.fillStyle = isHotfixSprint ? '#991b1b' : '#0f172a';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(speechText, badgeIso.x, by + bh / 2 + 0.3);
  }

  ctx.restore();
}

/**
 * Thuật toán Screen-Space Label Collision Avoidance:
 * Trước khi vẽ các thẻ Pill nổi trên canvas, kiểm tra toạ độ `(screenX, screenY)` của các thẻ
 * (và các obstacle như bong bóng thoại của Sếp nữ `ThuNDM`). Nếu 2 thẻ gần nhau theo chiều ngang/dọc,
 * tự động đẩy lệch `screenOffsetY` lên/xuống để KHÔNG BAO GIỜ có 2 bảng chữ đè lên nhau!
 */
export function drawNonOverlappingWinaEventPills(
  ctx: CanvasRenderingContext2D,
  items: WinaEventPillItem[],
  initialObstacles: ScreenLabelRect[] = []
) {
  if (items.length === 0) return;

  const placedRects: ScreenLabelRect[] = [...initialObstacles];

  // Ưu tiên định vị nhân vật đang được Camera Focus / Hotfix Sprint trước, sau đó sắp xếp theo toạ độ Y
  const ordered = [...items].sort((a, b) => {
    const prioA = (a.isPrimaryFocus ? 2 : 0) + (a.isHotfixSprint ? 2 : 0) + (a.showSpeechBubble ? 1 : 0);
    const prioB = (b.isPrimaryFocus ? 2 : 0) + (b.isHotfixSprint ? 2 : 0) + (b.showSpeechBubble ? 1 : 0);
    if (prioA !== prioB) return prioB - prioA;
    const isoA = worldToIso(a.pos.x, a.pos.y, 56);
    const isoB = worldToIso(b.pos.x, b.pos.y, 56);
    return isoA.y - isoB.y;
  });

  const resolvedItems: WinaEventPillItem[] = [];

  for (const item of ordered) {
    const toEmp = item.activeTask ? EMPLOYEE_BY_ID[item.activeTask.toEmployeeId] : undefined;
    const fromShort = formatFlezimercuriaName(item.emp);
    const toShort = formatFlezimercuriaName(toEmp, item.activeTask?.toEmployeeId);
    const pillText = item.isHotfixSprint
      ? `⚡ HOTFIX SPRINT • ${fromShort} ➔ SERVER [#${item.hotfixBuildNumber ?? 2843}]`
      : item.isDoneDoc
      ? `★ ${toShort || fromShort} [${item.ticketKey} DONE]`
      : `${fromShort} ➔ ${toShort} [${item.ticketKey}]`;

    ctx.font = '800 8.1px Inter, system-ui, sans-serif';
    const pillW = ctx.measureText(pillText).width + 27;
    const pillH = 22.5;

    let speechW = 0;
    let extraTop = 0;
    if (item.speechText && item.showSpeechBubble) {
      ctx.font = '600 7.6px Inter, system-ui, sans-serif';
      speechW = ctx.measureText(item.speechText).width + 15;
      extraTop = 18;
    }

    const boxW = Math.max(pillW, speechW) + 6;
    const boxH = pillH + extraTop + 4;
    const baseIso = worldToIso(item.pos.x, item.pos.y, 56);

    const candidateOffsets = [0, -23, 21, -45, 42, -67, 63, -89];
    let chosenOffsetY = 0;

    for (const cand of candidateOffsets) {
      const rx = baseIso.x - boxW / 2;
      const ry = baseIso.y + cand - pillH / 2 - extraTop - 2;
      const collides = placedRects.some(
        (r) =>
          rx < r.x + r.w &&
          rx + boxW > r.x &&
          ry < r.y + r.h &&
          ry + boxH > r.y
      );
      if (!collides) {
        chosenOffsetY = cand;
        break;
      }
    }

    const finalRect: ScreenLabelRect = {
      x: baseIso.x - boxW / 2,
      y: baseIso.y + chosenOffsetY - pillH / 2 - extraTop - 2,
      w: boxW,
      h: boxH,
    };
    placedRects.push(finalRect);
    resolvedItems.push({ ...item, screenOffsetY: chosenOffsetY });
  }

  // Vẽ các thẻ phụ trước, thẻ Primary Focus trên cùng để luôn sắc nét
  resolvedItems
    .sort((a, b) => (a.isPrimaryFocus ? 1 : 0) - (b.isPrimaryFocus ? 1 : 0))
    .forEach((resolved) => {
      drawWinaEventPillBadge(ctx, resolved);
    });
}

// ============================================================================
// 11. 3D ISOMETRIC JENKINS CI SERVER STATION & HOLOGRAM JOBS BOARD
// ============================================================================

/**
 * Vẽ Trạm Máy Tính Server Jenkins CI (`🖥️ JENKINS CI SERVER • oneclickv4-build-ci`)
 * gồm 4 cỗ máy tính Server Tower / Tủ Rack 3D Isometric có đèn LED nhấp nháy
 * + Bàn điều khiển 3 màn hình ghép (Triple-Monitor Server Console) tại Khoang NHÀ THUỐC (`FT3.III2A.1`).
 * Hỗ trợ trạng thái `🚨 BUILD BROKEN #2843` phát đèn cảnh báo đỏ chớp nháy khẩn cấp!
 */
export function drawJenkinsServerStation3D(
  ctx: CanvasRenderingContext2D,
  station: JenkinsServerStation,
  options: {
    time: number;
    activeBuild: ActiveJenkinsBuildTask | null;
    isHovered: boolean;
    isRecentlyCompleted: boolean;
    isBrokenAlert?: boolean;
    brokenBuildNumber?: number | null;
  }
) {
  const {
    time,
    activeBuild,
    isHovered,
    isRecentlyCompleted,
    isBrokenAlert = false,
    brokenBuildNumber,
  } = options;
  const isBuildingHere = activeBuild?.phase === 'BUILDING_AT_SERVER';
  const isHotfixActive = Boolean(activeBuild?.isHotfixRescue || isBrokenAlert);
  const isActiveOrHover =
    isBuildingHere || isRecentlyCompleted || isHovered || Boolean(activeBuild) || isBrokenAlert;
  const redPulse = Math.sin(time * 0.022) > 0;

  ctx.save();

  // 1. Thảm tĩnh điện & Bệ đỡ khu vực Server Rack (Anti-Static Raised Server Floor)
  drawIsoBox(
    ctx,
    station.wx - 4,
    station.wy - 4,
    station.ww + 8,
    station.wh + 16,
    10.35,
    11.8,
    isBrokenAlert && redPulse ? '#450a0a' : '#0f172a',
    '#020617',
    '#1e293b',
    isBrokenAlert
      ? redPulse
        ? '#ef4444'
        : '#f97316'
      : isBuildingHere
      ? '#38bdf8'
      : isActiveOrHover
      ? '#f97316'
      : '#334155',
    isBrokenAlert ? 2.1 : isBuildingHere ? 1.5 : 0.9
  );

  // Vòng sáng cảnh báo đỏ khẩn cấp lan tỏa dưới sàn Server khi Build Broken
  if (isBrokenAlert) {
    const centerIso = worldToIso(
      station.wx + station.ww * 0.5,
      station.wy + station.wh * 0.5,
      10.4
    );
    const alarmRadius = 56 + Math.sin(time * 0.018) * 7;
    ctx.fillStyle = redPulse
      ? 'rgba(239, 68, 68, 0.24)'
      : 'rgba(249, 115, 22, 0.14)';
    ctx.beginPath();
    ctx.ellipse(centerIso.x, centerIso.y, alarmRadius, alarmRadius * 0.52, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = redPulse ? '#ef4444' : '#facc15';
    ctx.lineWidth = 2.0;
    ctx.setLineDash([6, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Viền cảnh báo an toàn kỹ thuật vàng/xanh/đỏ quanh mép thảm Server
  const matSW = worldToIso(station.wx - 2, station.wy + station.wh + 10, 11.9);
  const matSE = worldToIso(
    station.wx + station.ww + 2,
    station.wy + station.wh + 10,
    11.9
  );
  ctx.strokeStyle = isBrokenAlert
    ? '#ef4444'
    : isBuildingHere
    ? '#38bdf8'
    : '#f59e0b';
  ctx.lineWidth = isBrokenAlert ? 2.0 : 1.4;
  ctx.beginPath();
  ctx.moveTo(matSW.x, matSW.y);
  ctx.lineTo(matSE.x, matSE.y);
  ctx.stroke();

  // 2. 4 Cỗ Máy Tính Server Tower / Tủ Rack 3D Isometric (Đèn LED nhấp nháy)
  const rackConfigs = [
    { offsetX: 2, width: 22, heightZ: 49, label: 'NODE-01' },
    { offsetX: 28, width: 22, heightZ: 52, label: 'CI-MASTER' },
    { offsetX: 54, width: 22, heightZ: 52, label: 'BUILDER-01' },
    { offsetX: 80, width: 22, heightZ: 49, label: 'ARTIFACT' },
  ];

  const blinkFast = isBrokenAlert ? 0.028 : isBuildingHere ? 0.016 : 0.005;

  for (let rIdx = 0; rIdx < rackConfigs.length; rIdx++) {
    const rc = rackConfigs[rIdx];
    const rx = station.wx + rc.offsetX;
    const ry = station.wy;
    const rw = rc.width;
    const rh = 15;
    const z0 = 11.8;
    const z1 = rc.heightZ;

    // Khối tủ Server Rack 3D
    drawIsoBox(
      ctx,
      rx,
      ry,
      rw,
      rh,
      z0,
      z1,
      isBrokenAlert && redPulse ? '#3f1d24' : '#1e293b',
      '#0f172a',
      '#020617',
      isBrokenAlert
        ? '#ef4444'
        : isBuildingHere
        ? '#0284c7'
        : '#334155',
      isBrokenAlert ? 1.2 : 0.85
    );

    // Mặt kính lưới tản nhiệt phía trước tủ Rack (Front Blade Slots + Blinking LEDs)
    for (let slot = 0; slot < 5; slot++) {
      const slotZ = z0 + 5 + slot * 6.8;
      const pL = worldToIso(rx + 2.5, ry + rh + 0.1, slotZ);
      const pR = worldToIso(rx + rw - 2.5, ry + rh + 0.1, slotZ);

      // Thanh khay Blade Server
      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 2.0;
      ctx.beginPath();
      ctx.moveTo(pL.x, pL.y);
      ctx.lineTo(pR.x, pR.y);
      ctx.stroke();

      // Đèn LED trạng thái nhấp nháy trên từng khay Server
      const phase = Math.sin(time * blinkFast + rIdx * 1.7 + slot * 2.3);
      const led1Color = isBrokenAlert
        ? phase > 0
          ? '#ef4444'
          : '#facc15'
        : isBuildingHere
        ? phase > -0.2
          ? '#38bdf8'
          : '#22c55e'
        : phase > 0.65
          ? '#f59e0b'
          : '#22c55e';
      const led2Color = isBrokenAlert
        ? '#ef4444'
        : Math.cos(time * blinkFast * 1.3 + slot + rIdx) > 0
        ? '#38bdf8'
        : '#f97316';

      const led1Pt = worldToIso(rx + 4.5, ry + rh + 0.2, slotZ + 0.8);
      const led2Pt = worldToIso(rx + 8.5, ry + rh + 0.2, slotZ + 0.8);

      ctx.fillStyle = led1Color;
      ctx.beginPath();
      ctx.arc(led1Pt.x, led1Pt.y, isBrokenAlert ? 1.65 : 1.35, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = led2Color;
      ctx.beginPath();
      ctx.arc(led2Pt.x, led2Pt.y, isBrokenAlert ? 1.5 : 1.2, 0, Math.PI * 2);
      ctx.fill();
    }

    // Dải đèn LED đỉnh tủ Server (Top Status Strip — Cyan cho CI, Tím cho UAT, Lục bảo cho Release)
    const clusterLed = station.ledColor ?? '#38bdf8';
    drawIsoBox(
      ctx,
      rx + 2,
      ry + 2,
      rw - 4,
      rh - 4,
      z1,
      z1 + 1.4,
      isBrokenAlert
        ? redPulse
          ? '#ef4444'
          : '#f59e0b'
        : isBuildingHere
        ? clusterLed
        : shadeHexColor(clusterLed, -12),
      isBrokenAlert ? '#dc2626' : shadeHexColor(clusterLed, -25),
      isBrokenAlert ? '#991b1b' : shadeHexColor(clusterLed, -38)
    );
  }

  // 3. Bàn Điều Khiển 3 Màn Hình Ghép (Triple-Monitor Server Console Desk)
  const deskX = station.wx + 22;
  const deskY = station.wy + 17;
  const deskW = 62;
  const deskH = 13;

  // Chân bàn Console
  drawIsoBox(
    ctx,
    deskX + 2,
    deskY + 1,
    4,
    deskH - 2,
    11.8,
    24.0,
    '#334155',
    '#1e293b',
    '#0f172a'
  );
  drawIsoBox(
    ctx,
    deskX + deskW - 6,
    deskY + 1,
    4,
    deskH - 2,
    11.8,
    24.0,
    '#334155',
    '#1e293b',
    '#0f172a'
  );

  // Mặt bàn Console Carbon-Dark
  drawIsoBox(
    ctx,
    deskX,
    deskY,
    deskW,
    deskH,
    24.0,
    26.0,
    '#1e293b',
    '#0f172a',
    '#020617',
    isBrokenAlert ? '#ef4444' : isBuildingHere ? '#38bdf8' : '#475569',
    0.9
  );

  // 3 Màn Hình Server Console (Triple Monitors)
  const monConfigs = [
    { ox: 4, w: 16 },
    { ox: 23, w: 16 },
    { ox: 42, w: 16 },
  ];
  for (let mIdx = 0; mIdx < monConfigs.length; mIdx++) {
    const mc = monConfigs[mIdx];
    const mx = deskX + mc.ox;
    const my = deskY + 2;
    drawIsoBox(
      ctx,
      mx + 6,
      my,
      4,
      2,
      26.0,
      28.5,
      '#475569',
      '#334155',
      '#1e293b'
    );
    const screenColor = isBrokenAlert
      ? redPulse
        ? '#dc2626'
        : '#7f1d1d'
      : isBuildingHere
      ? mIdx === 1
        ? '#0284c7'
        : '#0f172a'
      : '#0f172a';
    drawIsoBox(
      ctx,
      mx,
      my,
      mc.w,
      2.4,
      28.5,
      36.8,
      '#334155',
      screenColor,
      '#1e293b',
      isBrokenAlert ? '#ef4444' : isBuildingHere ? '#38bdf8' : '#475569',
      0.75
    );

    const logLine1L = worldToIso(mx + 2, my + 2.5, 34.2);
    const logLine1R = worldToIso(mx + mc.w - 3, my + 2.5, 34.2);
    const logLine2L = worldToIso(mx + 2, my + 2.5, 31.6);
    const logLine2R = worldToIso(
      mx + (isBuildingHere || isBrokenAlert ? mc.w - 2 : mc.w - 6),
      my + 2.5,
      31.6
    );

    ctx.strokeStyle = isBrokenAlert
      ? '#fef08a'
      : isBuildingHere
      ? '#38bdf8'
      : '#22c55e';
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(logLine1L.x, logLine1L.y);
    ctx.lineTo(logLine1R.x, logLine1R.y);
    ctx.stroke();

    ctx.strokeStyle = isBrokenAlert
      ? '#fca5a5'
      : isBuildingHere
      ? '#f97316'
      : '#38bdf8';
    ctx.beginPath();
    ctx.moveTo(logLine2L.x, logLine2L.y);
    ctx.lineTo(logLine2R.x, logLine2R.y);
    ctx.stroke();
  }

  // Bàn phím cơ Server
  drawIsoBox(
    ctx,
    deskX + 19,
    deskY + 7.2,
    22,
    4.2,
    26.0,
    26.9,
    isBrokenAlert ? '#ef4444' : isBuildingHere ? '#38bdf8' : '#cbd5e1',
    '#475569',
    '#334155'
  );

  // Vòng tròn vị trí đứng thao tác của Kỹ sư Build (`operatorPosition`) dưới sàn trước bàn Console
  const opIso = worldToIso(
    station.operatorPosition.x,
    station.operatorPosition.y,
    12.0
  );
  ctx.beginPath();
  ctx.ellipse(
    opIso.x,
    opIso.y,
    isBuildingHere || isHotfixActive ? 15 : 9,
    isBuildingHere || isHotfixActive ? 7.5 : 4.5,
    0,
    0,
    Math.PI * 2
  );
  ctx.fillStyle = isBrokenAlert
    ? 'rgba(239, 68, 68, 0.34)'
    : isBuildingHere
    ? 'rgba(56, 189, 248, 0.28)'
    : 'rgba(148, 163, 184, 0.16)';
  ctx.fill();
  ctx.strokeStyle = isBrokenAlert
    ? '#ef4444'
    : isBuildingHere
    ? '#38bdf8'
    : 'rgba(148, 163, 184, 0.45)';
  ctx.lineWidth = isBuildingHere || isBrokenAlert ? 1.8 : 0.9;
  ctx.stroke();

  // Còi báo động Đỏ Chớp Nháy `🚨 BUILD BROKEN #2843` ngay trên đỉnh tủ Rack khi gặp sự cố
  if (isBrokenAlert) {
    const sirenIso = worldToIso(
      station.wx + station.ww * 0.5,
      station.wy + 6,
      62 + Math.sin(time * 0.015) * 2
    );
    const alertText = `🚨 BUILD BROKEN #${brokenBuildNumber ?? activeBuild?.buildNumber ?? 2843} • HOTFIX RESCUE!`;
    ctx.font = '900 8.5px Inter, system-ui, sans-serif';
    const aw = ctx.measureText(alertText).width + 20;
    const ah = 19;
    drawRoundedRect(ctx, sirenIso.x - aw / 2, sirenIso.y - ah / 2, aw, ah, ah / 2);
    ctx.fillStyle = redPulse ? '#dc2626' : '#991b1b';
    ctx.fill();
    ctx.strokeStyle = '#fef08a';
    ctx.lineWidth = 1.6;
    ctx.stroke();
    ctx.fillStyle = '#fef08a';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(alertText, sirenIso.x, sirenIso.y + 0.5);
  }

  ctx.restore();
}

/**
 * Vẽ Biển Tên & Bảng Hologram Jobs (`⚙️ JENKINS CI: oneclickv4-build-ci`) đặt thông minh lệch về phía Đông-Nam
 * của Trạm Máy Tính Server (phía ngoài mép thảm xanh lá) để KHÔNG BAO GIỜ đè lên nhân viên ngồi ở Cụm 2.2 và Cụm 2.3!
 */
export function drawJenkinsServerHologramOverlay(
  ctx: CanvasRenderingContext2D,
  station: JenkinsServerStation,
  options: {
    time: number;
    activeBuild: ActiveJenkinsBuildTask | null;
    recentBuilds: JenkinsBuildJobItem[];
    isHovered: boolean;
    isRecentlyCompleted: boolean;
    isBrokenAlert?: boolean;
    brokenBuildNumber?: number | null;
  }
) {
  const {
    time,
    activeBuild,
    recentBuilds,
    isHovered,
    isRecentlyCompleted,
    isBrokenAlert = false,
    brokenBuildNumber,
  } = options;

  const isStandingBuilding = activeBuild?.phase === 'BUILDING_AT_SERVER';
  const showFullJobsBoard =
    isStandingBuilding || isRecentlyCompleted || isHovered || isBrokenAlert;

  // Điểm neo phát tia Hologram ở góc Đông-Nam của dàn Server Rack (không vươn lên hướng Bắc để tránh Cụm 2.2 & 2.3)
  const rackEastIso = worldToIso(
    station.wx + station.ww,
    station.wy + station.wh * 0.68,
    38
  );
  const floatOffset = Math.sin(time * 0.004) * 2.0;

  ctx.save();

  // 1. Khi KHÔNG có người đứng build tại Server -> hiện thẻ Pill gọn nhẹ phía Đông-Nam Trạm Server
  const clusterAccent = station.ledColor ?? '#38bdf8';
  const clusterHeader = station.shortTitle ?? '🖥️ JENKINS CI';
  if (!showFullJobsBoard) {
    const label = activeBuild
      ? `${activeBuild.isHotfixRescue ? '🚨 HOTFIX' : clusterHeader} • ${station.jobName} (${activeBuild.employeeAccount} ➔ #${activeBuild.buildNumber})`
      : `${clusterHeader} • ${station.jobName}`;

    ctx.font = '800 8px Inter, system-ui, sans-serif';
    const textW = ctx.measureText(label).width;
    const pillW = textW + 20;
    const pillH = 18;
    const px = rackEastIso.x + 18;
    const py = rackEastIso.y + 4 + floatOffset;

    ctx.strokeStyle = activeBuild ? clusterAccent : shadeHexColor(clusterAccent, -10);
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(rackEastIso.x, rackEastIso.y);
    ctx.lineTo(px, py + pillH / 2);
    ctx.stroke();

    drawRoundedRect(ctx, px, py, pillW, pillH, pillH / 2);
    ctx.fillStyle = 'rgba(15, 23, 42, 0.93)';
    ctx.fill();
    ctx.strokeStyle = activeBuild ? clusterAccent : shadeHexColor(clusterAccent, -15);
    ctx.lineWidth = 1.25;
    ctx.stroke();

    ctx.fillStyle = '#f8fafc';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, px + pillW / 2, py + pillH / 2 + 0.5);

    ctx.restore();
    return;
  }

  // 2. Khi CÓ người đứng build / vừa xong / hover / Build Broken -> Đặt Bảng Hologram lệch sang phía Đông-Nam ngoài mép thảm!
  const boardW = 248;
  const boardH = isStandingBuilding || isBrokenAlert ? 108 : 94;
  const bx = rackEastIso.x + 26;
  const by = rackEastIso.y - 6 + floatOffset;

  // Chùm tia chiếu Hologram xiên sang Đông-Nam từ hông phải dàn Server Rack tới bảng Hologram
  const beamGrad = ctx.createLinearGradient(
    rackEastIso.x,
    rackEastIso.y,
    bx,
    by + boardH * 0.5
  );
  beamGrad.addColorStop(
    0,
    isBrokenAlert ? 'rgba(239, 68, 68, 0.58)' : 'rgba(56, 189, 248, 0.52)'
  );
  beamGrad.addColorStop(
    1,
    isBrokenAlert ? 'rgba(239, 68, 68, 0.05)' : 'rgba(56, 189, 248, 0.04)'
  );
  ctx.fillStyle = beamGrad;
  ctx.beginPath();
  ctx.moveTo(rackEastIso.x, rackEastIso.y - 8);
  ctx.lineTo(rackEastIso.x, rackEastIso.y + 8);
  ctx.lineTo(bx, by + boardH - 12);
  ctx.lineTo(bx, by + 12);
  ctx.closePath();
  ctx.fill();

  ctx.shadowColor = isBrokenAlert
    ? 'rgba(239, 68, 68, 0.55)'
    : isStandingBuilding
    ? 'rgba(56, 189, 248, 0.5)'
    : 'rgba(16, 185, 129, 0.42)';
  ctx.shadowBlur = 12;

  drawRoundedRect(ctx, bx, by, boardW, boardH, 8);
  ctx.fillStyle = 'rgba(9, 14, 28, 0.95)';
  ctx.fill();
  ctx.strokeStyle = isBrokenAlert
    ? '#ef4444'
    : isStandingBuilding
    ? '#38bdf8'
    : '#10b981';
  ctx.lineWidth = 1.65;
  ctx.stroke();
  ctx.shadowBlur = 0;

  // Thanh tiêu đề trên cùng: `⚙️ JENKINS CI: oneclickv4-build-ci`
  drawRoundedRect(ctx, bx + 2, by + 2, boardW - 4, 19, 6);
  ctx.fillStyle = isBrokenAlert
    ? 'rgba(220, 38, 38, 0.42)'
    : isStandingBuilding
    ? 'rgba(2, 132, 199, 0.35)'
    : 'rgba(16, 185, 129, 0.28)';
  ctx.fill();

  ctx.font = '900 8px Inter, system-ui, sans-serif';
  ctx.fillStyle = isBrokenAlert ? '#fecaca' : clusterAccent;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(
    `${isBrokenAlert ? '🚨' : '⚙️'} ${clusterHeader}: ${station.jobName}`,
    bx + 8,
    by + 11.5
  );

  ctx.font = '700 6.9px Inter, system-ui, sans-serif';
  ctx.fillStyle = isBrokenAlert
    ? '#fef08a'
    : isStandingBuilding
    ? '#fde047'
    : '#34d399';
  ctx.textAlign = 'right';
  ctx.fillText(
    isBrokenAlert
      ? `BROKEN #${brokenBuildNumber ?? activeBuild?.buildNumber ?? 2843}`
      : isStandingBuilding
      ? `BUILDING • ${activeBuild.employeeAccount}`
      : 'RSS ALL • LIVE',
    bx + boardW - 8,
    by + 11.5
  );

  let cursorY = by + 29;

  // Dòng Job đang được nhân viên đứng build / Hotfix + Thanh Progress Bar 0% -> 100%
  if ((isStandingBuilding || isBrokenAlert) && activeBuild) {
    const pct = Math.min(100, Math.max(0, Math.round(activeBuild.buildProgress)));
    const activeLine = activeBuild.isHotfixRescue
      ? `⚡ Hotfix #${activeBuild.buildNumber} (${pct}%) — ${activeBuild.employeeAccount} [${activeBuild.ticketKey}]`
      : `🔄 #${activeBuild.buildNumber} Building (${pct}%) — ${activeBuild.employeeAccount} [${activeBuild.ticketKey}]`;

    ctx.font = '800 7.4px Inter, system-ui, sans-serif';
    ctx.fillStyle = activeBuild.isHotfixRescue ? '#fca5a5' : '#fef08a';
    ctx.textAlign = 'left';
    ctx.fillText(activeLine, bx + 8, cursorY);

    const barX = bx + 8;
    const barY = cursorY + 6;
    const barW = boardW - 16;
    const barH = 5.5;

    drawRoundedRect(ctx, barX, barY, barW, barH, 2.8);
    ctx.fillStyle = '#1e293b';
    ctx.fill();

    const fillW = Math.max(8, (barW * pct) / 100);
    drawRoundedRect(ctx, barX, barY, fillW, barH, 2.8);
    const barGrad = ctx.createLinearGradient(barX, barY, barX + barW, barY);
    if (activeBuild.isHotfixRescue) {
      barGrad.addColorStop(0, '#ef4444');
      barGrad.addColorStop(0.5, '#f59e0b');
      barGrad.addColorStop(1, '#22c55e');
    } else {
      barGrad.addColorStop(0, '#0284c7');
      barGrad.addColorStop(0.5, '#38bdf8');
      barGrad.addColorStop(1, '#22c55e');
    }
    ctx.fillStyle = barGrad;
    ctx.fill();

    cursorY += 20;
  }

  // Danh sách 3 Jobs gần nhất từ `https://jenkins-osp.frt.vn/job/oneclickv4-build-ci/rssAll`
  const jobsToShow = recentBuilds.slice(0, 3);
  for (const job of jobsToShow) {
    const icon =
      job.status === 'SUCCESS'
        ? '✅'
        : job.status === 'FAILURE'
          ? '🚨'
          : '🔄';
    const rowColor =
      job.status === 'SUCCESS'
        ? '#d1fae5'
        : job.status === 'FAILURE'
          ? '#fecaca'
          : '#bae6fd';

    const jobLine = `${icon} #${job.buildNumber} (${job.statusText}) — ${job.timeAgo}`;
    ctx.font = '700 7.3px JetBrains Mono, monospace';
    ctx.fillStyle = rowColor;
    ctx.textAlign = 'left';
    ctx.fillText(jobLine, bx + 8, cursorY);

    if (job.triggeredByAccount) {
      ctx.font = '600 6.8px Inter, system-ui, sans-serif';
      ctx.fillStyle = '#94a3b8';
      ctx.textAlign = 'right';
      ctx.fillText(
        `${job.triggeredByAccount}${job.ticketKey ? ` • ${job.ticketKey}` : ''}`,
        bx + boardW - 8,
        cursorY
      );
    }

    cursorY += 14.5;
  }

  // Footer URL nhỏ của RSS feed
  ctx.font = '600 6.3px JetBrains Mono, monospace';
  ctx.fillStyle = '#64748b';
  ctx.textAlign = 'left';
  ctx.fillText(
    `jenkins-osp.frt.vn/job/${station.jobName}/rssAll`,
    bx + 8,
    by + boardH - 6
  );

  ctx.restore();
}
