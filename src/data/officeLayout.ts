/**
 * 2D & 2.5D Spatial Layout for Virtual FRT Office (30 Active Staff + Full 54-Slot "NHÀ THUỐC" Excel Seat Map)
 *
 * Modeled 1:1 after:
 * 1) The real FRT 3-Courtyard Interlocking Building Floorplan (North Loop, Central-East Loop, South Loop)
 * 2) The real "NHÀ THUỐC (FT3.III2A.1.*)" Excel Seat Map placed inside the flagship East Grand Wing bay:
 *    - North Entrance: `🚪 CỬA RA VÀO` opening to the building's Ring Corridor
 *    - Floor Carpet: Sage / Mint Green (`#689f38` / `#dcedc8`) with bold `NHÀ THUỐC` floor title between Row 1 & Row 2
 *    - 3 Rows x 3 Columns = 9 Desk Islands (`ISLAND-1.1` .. `ISLAND-3.3`), each 2 cols (Left/Right) x 3 rows = 54 slots:
 *      + 51 real FRT seats (`FT3.III2A.1.087` .. `FT3.III2A.1.297`) with real accounts (`DongNQ6`, `ChienND22`, `ThoaPTN1`, etc.)
 *      + 2 yellow vacant desks (`FT3.III2A.1.101/102 - Trống [Thoa]` and `FT3.III2A.1.204 - Trống`)
 *      + 1 structural pillar (`CỘT NHÀ`) at Island 1.3 Row 3 Right (next to `FT3.III2A.1.092 - hoNT3`)
 *      + 1 special RED highlight desk (`FT3.III2A.1.289 - DongNQ6`) at Island 3.2 Row 2 Left (PM/Lead Command Desk)
 *      + 1 special YELLOW highlight desk (`FT3.III2A.1.194/195 - ThanhDQ13`) at Island 2.1 Row 2 Right
 *
 * Walkable Grid Aisles inside Khoang NHÀ THUỐC:
 * - 4 Vertical Aisles:   col = 27 (x=825), col = 30 (x=915), col = 34 (x=1035), col = 38 (x=1155)
 * - 4 Horizontal Aisles: row = 8  (y=255, Cửa Ra Vào), row = 12 (y=375, chữ NHÀ THUỐC), row = 16 (y=495), row = 19 (y=585)
 */

import {
  DeskPosition,
  Direction,
  GridCoord,
  JenkinsServerStation,
  NhaThuocSeatSlot,
  OfficeZone,
  Point2D,
  SimulationConfig,
  Waypoint,
  ZoneId,
} from '../types/office';

// ============================================================================
// 1. CANVAS & GRID CONSTANTS
// ============================================================================

export const OFFICE_CANVAS_WIDTH = 1680;
export const OFFICE_CANVAS_HEIGHT = 1050;
export const OFFICE_TILE_SIZE = 30;
export const OFFICE_GRID_COLS = OFFICE_CANVAS_WIDTH / OFFICE_TILE_SIZE; // 56
export const OFFICE_GRID_ROWS = OFFICE_CANVAS_HEIGHT / OFFICE_TILE_SIZE; // 35

export const DEFAULT_SIMULATION_CONFIG: SimulationConfig = {
  isRunning: true,
  speedMultiplier: 1,
  autoSimulate: true,
  autoStepIntervalMs: 3500,
  maxConcurrentActiveTickets: 6,
  showGrid: false,
  showWaypoints: false,
  showActivePaths: false,
  showPaths: false,
  showEmployeeLabels: true,
  tileSize: OFFICE_TILE_SIZE,
  canvasWidth: OFFICE_CANVAS_WIDTH,
  canvasHeight: OFFICE_CANVAS_HEIGHT,
  pmEmployeeId: 'EMP-01',
  autoCycleBosses: true,
  maxOpenSeats: 'FULL',
};

/** Chuyển đổi tọa độ ô lưới (col, row) sang tâm pixel (x, y) trên Canvas */
export function gridToPixel(col: number, row: number): Point2D {
  return {
    x: col * OFFICE_TILE_SIZE + OFFICE_TILE_SIZE / 2,
    y: row * OFFICE_TILE_SIZE + OFFICE_TILE_SIZE / 2,
  };
}

/** Chuyển đổi tọa độ pixel (x, y) sang ô lưới (col, row) */
export function pixelToGrid(x: number, y: number): GridCoord {
  return {
    col: Math.max(0, Math.min(OFFICE_GRID_COLS - 1, Math.floor(x / OFFICE_TILE_SIZE))),
    row: Math.max(0, Math.min(OFFICE_GRID_ROWS - 1, Math.floor(y / OFFICE_TILE_SIZE))),
  };
}

// ============================================================================
// 2. 3-COURTYARD INTERLOCKING BUILDING GEOMETRY (REAL CAD FLOORPLAN)
// ============================================================================

/** Đường bao 12 đỉnh của khối tòa nhà 3 giếng trời (Interlocking 3-Loop Footprint - Nới rộng Cánh Đông cho Khoang NHÀ THUỐC) */
export const BUILDING_FOOTPRINT_POLYGON: Point2D[] = [
  { x: 240, y: 36 },   // 1. Top-Left of North Loop
  { x: 720, y: 36 },   // 2. Top-Right of North Loop
  { x: 720, y: 168 },  // 3. Inner step North -> East Grand Wing
  { x: 1560, y: 168 }, // 4. Top-Right of East Wing (Khoang NHÀ THUỐC FT3.III2A.1 rộng rãi)
  { x: 1560, y: 816 }, // 5. Bottom-Right of East Wing
  { x: 825, y: 816 },  // 6. Inner step East Wing -> South Loop
  { x: 825, y: 930 },  // 7. Bottom-Right of South Loop
  { x: 330, y: 930 },  // 8. Bottom-Left of South Loop
  { x: 330, y: 516 },  // 9. Top-Left of South Loop
  { x: 450, y: 516 },  // 10. Inner step South Loop -> Central Spine
  { x: 450, y: 336 },  // 11. Inner step Central Spine -> North Loop
  { x: 240, y: 336 },  // 12. Bottom-Left of North Loop
];

export interface CourtyardAtrium {
  id: 'ATRIUM-NORTH' | 'ATRIUM-CENTRAL' | 'ATRIUM-SOUTH';
  name: string;
  code: string;
  wx: number;
  wy: number;
  ww: number;
  wh: number;
}

/** 3 Giếng trời / Sân trong (Open Void Atriums) đúng theo bản vẽ kiến trúc */
export const COURTYARD_ATRIUMS: CourtyardAtrium[] = [
  {
    id: 'ATRIUM-NORTH',
    name: 'North Sky Atrium',
    code: 'VOID • NORTH COURTYARD',
    wx: 385,
    wy: 138,
    ww: 200,
    wh: 108,
  },
  {
    id: 'ATRIUM-CENTRAL',
    name: 'Central Grand Atrium',
    code: 'VOID • CENTRAL PLAZA',
    wx: 585,
    wy: 368,
    ww: 195,
    wh: 144,
  },
  {
    id: 'ATRIUM-SOUTH',
    name: 'South Garden Atrium',
    code: 'VOID • SOUTH COURTYARD',
    wx: 475,
    wy: 630,
    ww: 200,
    wh: 150,
  },
];

export interface BuildingServiceCore {
  id: string;
  label: string;
  wx: number;
  wy: number;
  ww: number;
  wh: number;
  hasElevator: boolean;
  hasStairs: boolean;
  hasRestroom: boolean;
}

/** 8 Cụm Lõi Thang máy / Thang bộ / WC / Kỹ thuật */
export const BUILDING_SERVICE_CORES: BuildingServiceCore[] = [
  {
    id: 'CORE-NW',
    label: 'LIFT & WC NW',
    wx: 244,
    wy: 138,
    ww: 100,
    wh: 48,
    hasElevator: true,
    hasStairs: true,
    hasRestroom: true,
  },
  {
    id: 'CORE-NE',
    label: 'LIFT & WC NE',
    wx: 630,
    wy: 138,
    ww: 86,
    wh: 48,
    hasElevator: true,
    hasStairs: true,
    hasRestroom: true,
  },
  {
    id: 'CORE-NC',
    label: 'STAIR CORE NC',
    wx: 505,
    wy: 276,
    ww: 65,
    wh: 60,
    hasElevator: false,
    hasStairs: true,
    hasRestroom: true,
  },
  {
    id: 'CORE-CNE',
    label: 'LIFT CORE CNE',
    wx: 738,
    wy: 250,
    ww: 60,
    wh: 82,
    hasElevator: true,
    hasStairs: true,
    hasRestroom: true,
  },
  {
    id: 'CORE-CSW',
    label: 'CENTRAL CORE',
    wx: 505,
    wy: 516,
    ww: 70,
    wh: 80,
    hasElevator: true,
    hasStairs: true,
    hasRestroom: true,
  },
  {
    id: 'CORE-CSE',
    label: 'LIFT CORE CSE',
    wx: 738,
    wy: 552,
    ww: 60,
    wh: 50,
    hasElevator: true,
    hasStairs: true,
    hasRestroom: true,
  },
  {
    id: 'CORE-SW',
    label: 'LIFT & WC SW',
    wx: 334,
    wy: 736,
    ww: 100,
    wh: 44,
    hasElevator: true,
    hasStairs: true,
    hasRestroom: true,
  },
  {
    id: 'CORE-SE',
    label: 'LIFT & WC SE',
    wx: 720,
    wy: 736,
    ww: 101,
    wh: 44,
    hasElevator: true,
    hasStairs: true,
    hasRestroom: true,
  },
];

// ============================================================================
// 3. KHOANG "NHÀ THUỐC (FT3.III2A.1.*)" - 3x3 DESK ISLANDS (54 SLOTS)
// ============================================================================

/** Tọa độ khoang NHÀ THUỐC (FT3.III2A.1) nằm tại Cánh Chính Phía Đông (East Grand Wing) rộng thoáng của tòa nhà 3 giếng trời */
export const NHA_THUOC_BAY_BOUNDS = {
  id: 'BAY-NHA-THUOC',
  title: 'KHOANG NHÀ THUỐC (FT3.III2A.1)',
  code: 'FT3.III2A.1 • 9 DESK ISLANDS (54 SLOTS)',
  wx: 810,
  wy: 180,
  ww: 735,
  wh: 625,
  /** Cửa ra vào chính ở phía Bắc khoang (mở thông ra hành lang vòng) */
  entranceDoor: {
    wx: 1115,
    wy: 180,
    ww: 124,
    label: '🚪 CỬA RA VÀO',
  },
  /** Chữ NHÀ THUỐC lớn trên thảm xanh giữa Hàng 1 và Hàng 2 */
  floorBanner: {
    wx: 1177,
    wy: 418,
    text: 'NHÀ THUỐC',
  },
  /** Tâm camera focus khi nhấn nút "🏥 Focus Khoang NHÀ THUỐC (FT3.III2A.1)" */
  cameraFocusWorld: {
    x: 1177,
    y: 495,
    zoom: 1.18,
  },
};

export interface NhaThuocIslandMeta {
  id: string;
  label: string;
  islandRow: 1 | 2 | 3;
  islandCol: 1 | 2 | 3;
  /** Vùng thảm/đế bao quanh cụm bàn 6 chỗ (gồm cả phần ghế xoay 2 bên Trái - Phải) */
  wx: number;
  wy: number;
  ww: number;
  wh: number;
  /** Tọa độ khối mặt bàn ghép liền 2x3 (Contiguous 6-Desk Face-to-Face Bench Tabletop: 2 cột x 3 hàng) */
  tableWx: number;
  tableWy: number;
  tableWw: number;
  tableWh: number;
  /** Kích thước 1 khoang mặt bàn đơn lẻ trong cụm bàn ghép (deskW = 34, deskH = 32) */
  deskW: number;
  deskH: number;
  /** Tọa độ trục sống lưng giữa 2 dãy bàn đối diện (nơi đặt vách ngăn trung tâm 3D) */
  partitionWx: number;
  /** Tâm X của dãy bàn Trái (colIndex = 0) và dãy bàn Phải (colIndex = 1) ghép sát nhau tại partitionWx */
  leftSeatX: number;
  rightSeatX: number;
  /** Tâm Y của 3 hàng bàn liền kề (rowIndex = 0, 1, 2) ghép sát cạnh bên vào nhau */
  rowYs: [number, number, number];
  leftHandoffCol: number;
  rightHandoffCol: number;
  rowHandoffRows: [number, number, number];
}

/** Kích thước chuẩn của mỗi khoang bàn trong Cụm 6 bàn ghép liền khối (2 cột x 3 hàng = 68 x 96 px) */
export const JOINED_DESK_LEAF_W = 34;
export const JOINED_DESK_LEAF_H = 32;

const ISLAND_COL_COORDS: Record<
  1 | 2 | 3,
  {
    wx: number;
    ww: number;
    tableWx: number;
    tableWw: number;
    partitionWx: number;
    leftSeatX: number;
    rightSeatX: number;
    leftHandoffCol: number;
    rightHandoffCol: number;
  }
> = {
  // Cụm cột 1 (giữa hành lang dọc col=28 [x=855] và col=35 [x=1065], tâm sống lưng tại x=955)
  1: {
    wx: 905,
    ww: 100,
    tableWx: 955 - JOINED_DESK_LEAF_W, // 921
    tableWw: JOINED_DESK_LEAF_W * 2,   // 68 (921..989)
    partitionWx: 955,
    leftSeatX: 955 - JOINED_DESK_LEAF_W / 2,  // 938 (mặt bàn Trái: 921..955)
    rightSeatX: 955 + JOINED_DESK_LEAF_W / 2, // 972 (mặt bàn Phải: 955..989)
    leftHandoffCol: 28,
    rightHandoffCol: 35,
  },
  // Cụm cột 2 (giữa hành lang dọc col=35 [x=1065] và col=43 [x=1305], tâm sống lưng tại x=1185)
  2: {
    wx: 1135,
    ww: 100,
    tableWx: 1185 - JOINED_DESK_LEAF_W, // 1151
    tableWw: JOINED_DESK_LEAF_W * 2,    // 68 (1151..1219)
    partitionWx: 1185,
    leftSeatX: 1185 - JOINED_DESK_LEAF_W / 2,  // 1168 (mặt bàn Trái: 1151..1185)
    rightSeatX: 1185 + JOINED_DESK_LEAF_W / 2, // 1202 (mặt bàn Phải: 1185..1219)
    leftHandoffCol: 35,
    rightHandoffCol: 43,
  },
  // Cụm cột 3 (giữa hành lang dọc col=43 [x=1305] và col=50 [x=1515], tâm sống lưng tại x=1410)
  3: {
    wx: 1360,
    ww: 100,
    tableWx: 1410 - JOINED_DESK_LEAF_W, // 1376
    tableWw: JOINED_DESK_LEAF_W * 2,    // 68 (1376..1444)
    partitionWx: 1410,
    leftSeatX: 1410 - JOINED_DESK_LEAF_W / 2,  // 1393 (mặt bàn Trái: 1376..1410)
    rightSeatX: 1410 + JOINED_DESK_LEAF_W / 2, // 1427 (mặt bàn Phải: 1410..1444)
    leftHandoffCol: 43,
    rightHandoffCol: 50,
  },
};

const ISLAND_ROW_COORDS: Record<
  1 | 2 | 3,
  {
    wy: number;
    wh: number;
    tableWy: number;
    tableWh: number;
    rowYs: [number, number, number];
    rowHandoffRows: [number, number, number];
  }
> = {
  // Hàng 1 (giữa hành lang ngang Bắc row=7 [y=225] và chữ NHÀ THUỐC row=14 [y=435])
  1: {
    wy: 260,
    wh: 104,
    tableWy: 264,
    tableWh: JOINED_DESK_LEAF_H * 3, // 96 (264..360)
    rowYs: [
      264 + JOINED_DESK_LEAF_H * 0.5, // 280 (Hàng bàn 1: 264..296)
      264 + JOINED_DESK_LEAF_H * 1.5, // 312 (Hàng bàn 2: 296..328)
      264 + JOINED_DESK_LEAF_H * 2.5, // 344 (Hàng bàn 3: 328..360)
    ],
    rowHandoffRows: [9, 10, 11],
  },
  // Hàng 2 (giữa chữ NHÀ THUỐC row=14 [y=435] và hành lang ngang row=20 [y=615])
  2: {
    wy: 464,
    wh: 104,
    tableWy: 468,
    tableWh: JOINED_DESK_LEAF_H * 3, // 96 (468..564)
    rowYs: [
      468 + JOINED_DESK_LEAF_H * 0.5, // 484 (Hàng bàn 1: 468..500)
      468 + JOINED_DESK_LEAF_H * 1.5, // 516 (Hàng bàn 2: 500..532)
      468 + JOINED_DESK_LEAF_H * 2.5, // 548 (Hàng bàn 3: 532..564)
    ],
    rowHandoffRows: [16, 17, 18],
  },
  // Hàng 3 (giữa hành lang ngang row=20 [y=615] và hành lang đáy row=26 [y=795])
  3: {
    wy: 652,
    wh: 104,
    tableWy: 656,
    tableWh: JOINED_DESK_LEAF_H * 3, // 96 (656..752)
    rowYs: [
      656 + JOINED_DESK_LEAF_H * 0.5, // 672 (Hàng bàn 1: 656..688)
      656 + JOINED_DESK_LEAF_H * 1.5, // 704 (Hàng bàn 2: 688..720)
      656 + JOINED_DESK_LEAF_H * 2.5, // 736 (Hàng bàn 3: 720..752)
    ],
    rowHandoffRows: [22, 23, 24],
  },
};

/** 9 Cụm Bàn Ghép 6 Chỗ (2 dãy đối diện x 3 bàn liền kề) rộng thoáng trong Khoang NHÀ THUỐC (FT3.III2A.1) */
export const NHA_THUOC_ISLANDS: NhaThuocIslandMeta[] = [];
for (const r of [1, 2, 3] as const) {
  for (const c of [1, 2, 3] as const) {
    const colCfg = ISLAND_COL_COORDS[c];
    const rowCfg = ISLAND_ROW_COORDS[r];
    NHA_THUOC_ISLANDS.push({
      id: `ISLAND-${r}.${c}`,
      label: `Cụm ${r}.${c}`,
      islandRow: r,
      islandCol: c,
      wx: colCfg.wx,
      wy: rowCfg.wy,
      ww: colCfg.ww,
      wh: rowCfg.wh,
      tableWx: colCfg.tableWx,
      tableWy: rowCfg.tableWy,
      tableWw: colCfg.tableWw,
      tableWh: rowCfg.tableWh,
      deskW: JOINED_DESK_LEAF_W,
      deskH: JOINED_DESK_LEAF_H,
      partitionWx: colCfg.partitionWx,
      leftSeatX: colCfg.leftSeatX,
      rightSeatX: colCfg.rightSeatX,
      rowYs: rowCfg.rowYs,
      leftHandoffCol: colCfg.leftHandoffCol,
      rightHandoffCol: colCfg.rightHandoffCol,
      rowHandoffRows: rowCfg.rowHandoffRows,
    });
  }
}

interface RawNhaThuocSlotDef {
  islandRow: 1 | 2 | 3;
  islandCol: 1 | 2 | 3;
  subRow: 1 | 2 | 3;
  side: 'LEFT' | 'RIGHT';
  seatCode: string;
  account: string;
  kind: 'OCCUPIED' | 'VACANT' | 'PILLAR';
  highlight?: 'normal' | 'red' | 'yellow';
  sideNote?: string;
  deskId?: string;
  assignedEmployeeId?: string;
  zoneId?: ZoneId;
  nearestWaypointId: string;
}

/**
 * Dữ liệu chính xác 100% từng ô trong 9 cụm đảo bàn (54 ô) từ ảnh Excel Seat Map
 * `/Users/llg94th/.gemini/antigravity-cli/brain/dcfc59b2-6329-40bd-8276-1b2838effca5/.user_uploaded/uploaded_media_1793865831121.png`
 */
const RAW_NHA_THUOC_SLOTS: RawNhaThuocSlotDef[] = [
  // ==========================================================================
  // HÀNG TRÊN (Row 1 - Gần CỬA RA VÀO)
  // ==========================================================================
  // --- Cụm 1.1 (Top-Left Island) ---
  {
    islandRow: 1,
    islandCol: 1,
    subRow: 1,
    side: 'LEFT',
    seatCode: 'FT3.III2A.1.104',
    account: 'Fresher KienNT178',
    kind: 'OCCUPIED',
    nearestWaypointId: 'WP-NT-N1',
  },
  {
    islandRow: 1,
    islandCol: 1,
    subRow: 1,
    side: 'RIGHT',
    seatCode: 'FT3.III2A.1.103',
    account: 'TinNDP (KH)',
    kind: 'OCCUPIED',
    nearestWaypointId: 'WP-NT-N2',
  },
  {
    islandRow: 1,
    islandCol: 1,
    subRow: 2,
    side: 'LEFT',
    seatCode: 'FT3.III2A.1.105',
    account: 'TrungTM7',
    kind: 'OCCUPIED',
    deskId: 'DESK-12',
    assignedEmployeeId: 'EMP-12',
    zoneId: 'ZONE-BE',
    nearestWaypointId: 'WP-NT-N1',
  },
  {
    islandRow: 1,
    islandCol: 1,
    subRow: 2,
    side: 'RIGHT',
    seatCode: 'FT3.III2A.1.101/102',
    account: 'Trống',
    kind: 'VACANT',
    highlight: 'yellow',
    sideNote: 'Thoa',
    nearestWaypointId: 'WP-NT-N2',
  },
  {
    islandRow: 1,
    islandCol: 1,
    subRow: 3,
    side: 'LEFT',
    seatCode: 'FT3.III2A.1.106',
    account: 'LanTTP',
    kind: 'OCCUPIED',
    deskId: 'DESK-14',
    assignedEmployeeId: 'EMP-14',
    zoneId: 'ZONE-BE',
    nearestWaypointId: 'WP-NT-M1',
  },
  {
    islandRow: 1,
    islandCol: 1,
    subRow: 3,
    side: 'RIGHT',
    seatCode: 'FT3.III2A.1.100',
    account: 'KhiemHT',
    kind: 'OCCUPIED',
    deskId: 'DESK-13',
    assignedEmployeeId: 'EMP-13',
    zoneId: 'ZONE-BE',
    nearestWaypointId: 'WP-NT-M2',
  },

  // --- Cụm 1.2 (Top-Center Island - Phía trên chữ NHÀ THUỐC) ---
  {
    islandRow: 1,
    islandCol: 2,
    subRow: 1,
    side: 'LEFT',
    seatCode: 'FT3.III2A.1.097',
    account: 'KieuNTD (KH)',
    kind: 'OCCUPIED',
    nearestWaypointId: 'WP-NT-N2',
  },
  {
    islandRow: 1,
    islandCol: 2,
    subRow: 1,
    side: 'RIGHT',
    seatCode: 'FT3.III2A.1.096',
    account: 'ThoaPTN1',
    kind: 'OCCUPIED',
    deskId: 'DESK-02',
    assignedEmployeeId: 'EMP-02',
    zoneId: 'ZONE-PM',
    nearestWaypointId: 'WP-NT-N3',
  },
  {
    islandRow: 1,
    islandCol: 2,
    subRow: 2,
    side: 'LEFT',
    seatCode: 'FT3.III2A.1.098',
    account: 'QuyenNT94 (KH)',
    kind: 'OCCUPIED',
    nearestWaypointId: 'WP-NT-N2',
  },
  {
    islandRow: 1,
    islandCol: 2,
    subRow: 2,
    side: 'RIGHT',
    seatCode: 'FT3.III2A.1.094/095',
    account: 'LoiNP5 (KH)',
    kind: 'OCCUPIED',
    nearestWaypointId: 'WP-NT-N3',
  },
  {
    islandRow: 1,
    islandCol: 2,
    subRow: 3,
    side: 'LEFT',
    seatCode: 'FT3.III2A.1.099',
    account: 'HuynhLC2 (KH)',
    kind: 'OCCUPIED',
    nearestWaypointId: 'WP-NT-M2',
  },
  {
    islandRow: 1,
    islandCol: 2,
    subRow: 3,
    side: 'RIGHT',
    seatCode: 'FT3.III2A.1.093',
    account: 'anhtk7',
    kind: 'OCCUPIED',
    nearestWaypointId: 'WP-NT-M3',
  },

  // --- Cụm 1.3 (Top-Right Island - Có CỘT NHÀ) ---
  {
    islandRow: 1,
    islandCol: 3,
    subRow: 1,
    side: 'LEFT',
    seatCode: 'FT3.III2A.1.090',
    account: 'HaiBT10',
    kind: 'OCCUPIED',
    nearestWaypointId: 'WP-NT-N3',
  },
  {
    islandRow: 1,
    islandCol: 3,
    subRow: 1,
    side: 'RIGHT',
    seatCode: 'FT3.III2A.1.089',
    account: 'DaoLT9',
    kind: 'OCCUPIED',
    nearestWaypointId: 'WP-NT-N4',
  },
  {
    islandRow: 1,
    islandCol: 3,
    subRow: 2,
    side: 'LEFT',
    seatCode: 'FT3.III2A.1.091',
    account: 'Tamnt167',
    kind: 'OCCUPIED',
    nearestWaypointId: 'WP-NT-N3',
  },
  {
    islandRow: 1,
    islandCol: 3,
    subRow: 2,
    side: 'RIGHT',
    seatCode: 'FT3.III2A.1.087/088',
    account: 'HangNT60',
    kind: 'OCCUPIED',
    nearestWaypointId: 'WP-NT-N4',
  },
  {
    islandRow: 1,
    islandCol: 3,
    subRow: 3,
    side: 'LEFT',
    seatCode: 'FT3.III2A.1.092',
    account: 'hoNT3 (KH)',
    kind: 'OCCUPIED',
    nearestWaypointId: 'WP-NT-M3',
  },
  {
    islandRow: 1,
    islandCol: 3,
    subRow: 3,
    side: 'RIGHT',
    seatCode: 'CỘT NHÀ',
    account: 'CỘT NHÀ',
    kind: 'PILLAR',
    nearestWaypointId: 'WP-NT-M4',
  },

  // ==========================================================================
  // HÀNG GIỮA (Row 2 - Ngay dưới chữ NHÀ THUỐC)
  // ==========================================================================
  // --- Cụm 2.1 (Middle-Left Island) ---
  {
    islandRow: 2,
    islandCol: 1,
    subRow: 1,
    side: 'LEFT',
    seatCode: 'FT3.III2A.1.190',
    account: 'CuongTN2',
    kind: 'OCCUPIED',
    deskId: 'DESK-08',
    assignedEmployeeId: 'EMP-08',
    zoneId: 'ZONE-BE',
    nearestWaypointId: 'WP-NT-M1',
  },
  {
    islandRow: 2,
    islandCol: 1,
    subRow: 1,
    side: 'RIGHT',
    seatCode: 'FT3.III2A.1.196',
    account: 'CuongDNQ2',
    kind: 'OCCUPIED',
    deskId: 'DESK-09',
    assignedEmployeeId: 'EMP-09',
    zoneId: 'ZONE-BE',
    nearestWaypointId: 'WP-NT-M2',
  },
  {
    islandRow: 2,
    islandCol: 1,
    subRow: 2,
    side: 'LEFT',
    seatCode: 'FT3.III2A.1.191',
    account: 'ChienND22',
    kind: 'OCCUPIED',
    deskId: 'DESK-07',
    assignedEmployeeId: 'EMP-07',
    zoneId: 'ZONE-BE',
    nearestWaypointId: 'WP-NT-M1',
  },
  {
    islandRow: 2,
    islandCol: 1,
    subRow: 2,
    side: 'RIGHT',
    seatCode: 'FT3.III2A.1.194/195',
    account: 'ThanhDQ13',
    kind: 'OCCUPIED',
    highlight: 'yellow',
    deskId: 'DESK-04',
    assignedEmployeeId: 'EMP-04',
    zoneId: 'ZONE-LEAD',
    nearestWaypointId: 'WP-NT-M2',
  },
  {
    islandRow: 2,
    islandCol: 1,
    subRow: 3,
    side: 'LEFT',
    seatCode: 'FT3.III2A.1.192',
    account: 'ToanNLV',
    kind: 'OCCUPIED',
    deskId: 'DESK-10',
    assignedEmployeeId: 'EMP-10',
    zoneId: 'ZONE-BE',
    nearestWaypointId: 'WP-NT-S1',
  },
  {
    islandRow: 2,
    islandCol: 1,
    subRow: 3,
    side: 'RIGHT',
    seatCode: 'FT3.III2A.1.193',
    account: 'QuyenNVC',
    kind: 'OCCUPIED',
    deskId: 'DESK-11',
    assignedEmployeeId: 'EMP-11',
    zoneId: 'ZONE-BE',
    nearestWaypointId: 'WP-NT-S2',
  },

  // --- Cụm 2.2 (Middle-Center Island) ---
  {
    islandRow: 2,
    islandCol: 2,
    subRow: 1,
    side: 'LEFT',
    seatCode: 'FT3.III2A.1.197',
    account: 'LuuTV6',
    kind: 'OCCUPIED',
    deskId: 'DESK-05',
    assignedEmployeeId: 'EMP-05',
    zoneId: 'ZONE-LEAD',
    nearestWaypointId: 'WP-NT-M2',
  },
  {
    islandRow: 2,
    islandCol: 2,
    subRow: 1,
    side: 'RIGHT',
    seatCode: 'FT3.III2A.1.203',
    account: 'KienDT53 (KH)',
    kind: 'OCCUPIED',
    nearestWaypointId: 'WP-NT-M3',
  },
  {
    islandRow: 2,
    islandCol: 2,
    subRow: 2,
    side: 'LEFT',
    seatCode: 'FT3.III2A.1.198',
    account: 'BaoNAT',
    kind: 'OCCUPIED',
    deskId: 'DESK-15',
    assignedEmployeeId: 'EMP-15',
    zoneId: 'ZONE-FE',
    nearestWaypointId: 'WP-NT-M2',
  },
  {
    islandRow: 2,
    islandCol: 2,
    subRow: 2,
    side: 'RIGHT',
    seatCode: 'FT3.III2A.1.201/202',
    account: 'ThuanHM12',
    kind: 'OCCUPIED',
    deskId: 'DESK-16',
    assignedEmployeeId: 'EMP-16',
    zoneId: 'ZONE-FE',
    nearestWaypointId: 'WP-NT-M3',
  },
  {
    islandRow: 2,
    islandCol: 2,
    subRow: 3,
    side: 'LEFT',
    seatCode: 'FT3.III2A.1.199',
    account: 'LongBK2',
    kind: 'OCCUPIED',
    deskId: 'DESK-17',
    assignedEmployeeId: 'EMP-17',
    zoneId: 'ZONE-FE',
    nearestWaypointId: 'WP-NT-S2',
  },
  {
    islandRow: 2,
    islandCol: 2,
    subRow: 3,
    side: 'RIGHT',
    seatCode: 'FT3.III2A.1.200',
    account: 'LuongTQ2 (KH)',
    kind: 'OCCUPIED',
    nearestWaypointId: 'WP-NT-S3',
  },

  // --- Cụm 2.3 (Middle-Right Island) ---
  {
    islandRow: 2,
    islandCol: 3,
    subRow: 1,
    side: 'LEFT',
    seatCode: 'FT3.III2A.1.204',
    account: 'Trống',
    kind: 'VACANT',
    highlight: 'yellow',
    nearestWaypointId: 'WP-NT-M3',
  },
  {
    islandRow: 2,
    islandCol: 3,
    subRow: 1,
    side: 'RIGHT',
    seatCode: 'FT3.III2A.1.210',
    account: 'ManhPT13',
    kind: 'OCCUPIED',
    deskId: 'DESK-06',
    assignedEmployeeId: 'EMP-06',
    zoneId: 'ZONE-LEAD',
    nearestWaypointId: 'WP-NT-M4',
  },
  {
    islandRow: 2,
    islandCol: 3,
    subRow: 2,
    side: 'LEFT',
    seatCode: 'FT3.III2A.1.205',
    account: 'TriPHC',
    kind: 'OCCUPIED',
    deskId: 'DESK-18',
    assignedEmployeeId: 'EMP-18',
    zoneId: 'ZONE-FE',
    nearestWaypointId: 'WP-NT-M3',
  },
  {
    islandRow: 2,
    islandCol: 3,
    subRow: 2,
    side: 'RIGHT',
    seatCode: 'FT3.III2A.1.208/209',
    account: 'KienNT178',
    kind: 'OCCUPIED',
    deskId: 'DESK-19',
    assignedEmployeeId: 'EMP-19',
    zoneId: 'ZONE-FE',
    nearestWaypointId: 'WP-NT-M4',
  },
  {
    islandRow: 2,
    islandCol: 3,
    subRow: 3,
    side: 'LEFT',
    seatCode: 'FT3.III2A.1.206',
    account: 'KhanhLB3 (KH)',
    kind: 'OCCUPIED',
    nearestWaypointId: 'WP-NT-S3',
  },
  {
    islandRow: 2,
    islandCol: 3,
    subRow: 3,
    side: 'RIGHT',
    seatCode: 'FT3.III2A.1.207',
    account: 'ThieuNV5',
    kind: 'OCCUPIED',
    deskId: 'DESK-20',
    assignedEmployeeId: 'EMP-20',
    zoneId: 'ZONE-FE',
    nearestWaypointId: 'WP-NT-S4',
  },

  // ==========================================================================
  // HÀNG DƯỚI (Row 3 - Bottom Islands)
  // ==========================================================================
  // --- Cụm 3.1 (Bottom-Left Island) ---
  {
    islandRow: 3,
    islandCol: 1,
    subRow: 1,
    side: 'LEFT',
    seatCode: 'FT3.III2A.1.295',
    account: 'Fresher BaoNAT',
    kind: 'OCCUPIED',
    nearestWaypointId: 'WP-NT-S1',
  },
  {
    islandRow: 3,
    islandCol: 1,
    subRow: 1,
    side: 'RIGHT',
    seatCode: 'FT3.III2A.1.294',
    account: 'KhoaLNT',
    kind: 'OCCUPIED',
    deskId: 'DESK-21',
    assignedEmployeeId: 'EMP-21',
    zoneId: 'ZONE-MOBILE',
    nearestWaypointId: 'WP-NT-S2',
  },
  {
    islandRow: 3,
    islandCol: 1,
    subRow: 2,
    side: 'LEFT',
    seatCode: 'FT3.III2A.1.296',
    account: 'HuyNT83',
    kind: 'OCCUPIED',
    deskId: 'DESK-22',
    assignedEmployeeId: 'EMP-22',
    zoneId: 'ZONE-MOBILE',
    nearestWaypointId: 'WP-NT-S1',
  },
  {
    islandRow: 3,
    islandCol: 1,
    subRow: 2,
    side: 'RIGHT',
    seatCode: 'FT3.III2A.1.292/293',
    account: 'LyNH16',
    kind: 'OCCUPIED',
    deskId: 'DESK-23',
    assignedEmployeeId: 'EMP-23',
    zoneId: 'ZONE-MOBILE',
    nearestWaypointId: 'WP-NT-S2',
  },
  {
    islandRow: 3,
    islandCol: 1,
    subRow: 3,
    side: 'LEFT',
    seatCode: 'FT3.III2A.1.297',
    account: 'ThienTM2',
    kind: 'OCCUPIED',
    deskId: 'DESK-24',
    assignedEmployeeId: 'EMP-24',
    zoneId: 'ZONE-MOBILE',
    nearestWaypointId: 'WP-NT-B1',
  },
  {
    islandRow: 3,
    islandCol: 1,
    subRow: 3,
    side: 'RIGHT',
    seatCode: 'FT3.III2A.1.291',
    account: 'LanNT33',
    kind: 'OCCUPIED',
    nearestWaypointId: 'WP-NT-B2',
  },

  // --- Cụm 3.2 (Bottom-Center Island - Có Bàn Đỏ đặc biệt DongNQ6) ---
  {
    islandRow: 3,
    islandCol: 2,
    subRow: 1,
    side: 'LEFT',
    seatCode: 'FT3.III2A.1.288',
    account: 'TrucNN4',
    kind: 'OCCUPIED',
    deskId: 'DESK-26',
    assignedEmployeeId: 'EMP-26',
    zoneId: 'ZONE-QA',
    nearestWaypointId: 'WP-NT-S2',
  },
  {
    islandRow: 3,
    islandCol: 2,
    subRow: 1,
    side: 'RIGHT',
    seatCode: 'FT3.III2A.1.287',
    account: 'TranTNN',
    kind: 'OCCUPIED',
    deskId: 'DESK-25',
    assignedEmployeeId: 'EMP-25',
    zoneId: 'ZONE-QA',
    nearestWaypointId: 'WP-NT-S3',
  },
  {
    islandRow: 3,
    islandCol: 2,
    subRow: 2,
    side: 'LEFT',
    seatCode: 'FT3.III2A.1.289',
    account: 'DongNQ6',
    kind: 'OCCUPIED',
    highlight: 'red',
    deskId: 'DESK-01',
    assignedEmployeeId: 'EMP-01',
    zoneId: 'ZONE-PM',
    nearestWaypointId: 'WP-NT-S2',
  },
  {
    islandRow: 3,
    islandCol: 2,
    subRow: 2,
    side: 'RIGHT',
    seatCode: 'FT3.III2A.1.285/286',
    account: 'HieuNT181 (KH)',
    kind: 'OCCUPIED',
    deskId: 'DESK-03',
    assignedEmployeeId: 'EMP-03',
    zoneId: 'ZONE-PM',
    nearestWaypointId: 'WP-NT-S3',
  },
  {
    islandRow: 3,
    islandCol: 2,
    subRow: 3,
    side: 'LEFT',
    seatCode: 'FT3.III2A.1.290',
    account: 'ThanhNX7',
    kind: 'OCCUPIED',
    deskId: 'DESK-27',
    assignedEmployeeId: 'EMP-27',
    zoneId: 'ZONE-QA',
    nearestWaypointId: 'WP-NT-B2',
  },
  {
    islandRow: 3,
    islandCol: 2,
    subRow: 3,
    side: 'RIGHT',
    seatCode: 'FT3.III2A.1.284',
    account: 'PhongNT84',
    kind: 'OCCUPIED',
    deskId: 'DESK-28',
    assignedEmployeeId: 'EMP-28',
    zoneId: 'ZONE-QA',
    nearestWaypointId: 'WP-NT-B3',
  },

  // --- Cụm 3.3 (Bottom-Right Island) ---
  {
    islandRow: 3,
    islandCol: 3,
    subRow: 1,
    side: 'LEFT',
    seatCode: 'FT3.III2A.1.281',
    account: 'TienHK',
    kind: 'OCCUPIED',
    deskId: 'DESK-29',
    assignedEmployeeId: 'EMP-29',
    zoneId: 'ZONE-DEVOPS',
    nearestWaypointId: 'WP-NT-S3',
  },
  {
    islandRow: 3,
    islandCol: 3,
    subRow: 1,
    side: 'RIGHT',
    seatCode: 'FT3.III2A.1.280',
    account: 'HauVV7',
    kind: 'OCCUPIED',
    nearestWaypointId: 'WP-NT-S4',
  },
  {
    islandRow: 3,
    islandCol: 3,
    subRow: 2,
    side: 'LEFT',
    seatCode: 'FT3.III2A.1.282',
    account: 'NgocTB15',
    kind: 'OCCUPIED',
    nearestWaypointId: 'WP-NT-S3',
  },
  {
    islandRow: 3,
    islandCol: 3,
    subRow: 2,
    side: 'RIGHT',
    seatCode: 'FT3.III2A.1.278/279',
    account: 'SonNA2',
    kind: 'OCCUPIED',
    deskId: 'DESK-30',
    assignedEmployeeId: 'EMP-30',
    zoneId: 'ZONE-DEVOPS',
    nearestWaypointId: 'WP-NT-S4',
  },
  {
    islandRow: 3,
    islandCol: 3,
    subRow: 3,
    side: 'LEFT',
    seatCode: 'FT3.III2A.1.283',
    account: 'TaiMT3',
    kind: 'OCCUPIED',
    nearestWaypointId: 'WP-NT-B3',
  },
  {
    islandRow: 3,
    islandCol: 3,
    subRow: 3,
    side: 'RIGHT',
    seatCode: 'FT3.III2A.1.277',
    account: 'SangNN1',
    kind: 'OCCUPIED',
    nearestWaypointId: 'WP-NT-B4',
  },
];

/** Danh sách đầy đủ 54 ô trong 9 Cụm Bàn Ghép 6 Chỗ (2 dãy đối diện x 3 bàn liền kề) của Khoang NHÀ THUỐC (FT3.III2A.1) */
export const NHA_THUOC_SEAT_SLOTS: NhaThuocSeatSlot[] = RAW_NHA_THUOC_SLOTS.map((raw, idx) => {
  const colCfg = ISLAND_COL_COORDS[raw.islandCol];
  const rowCfg = ISLAND_ROW_COORDS[raw.islandRow];
  const wx = raw.side === 'LEFT' ? colCfg.leftSeatX : colCfg.rightSeatX;
  const wy = rowCfg.rowYs[raw.subRow - 1];
  const rowIndex = (raw.subRow - 1) as 0 | 1 | 2;
  const colIndex: 0 | 1 = raw.side === 'LEFT' ? 0 : 1;
  // Dãy Trái (colIndex = 0) ngồi ở mép ngoài bên trái nhìn hướng RIGHT (SE) vào màn hình;
  // Dãy Phải (colIndex = 1) ngồi ở mép ngoài bên phải nhìn hướng LEFT (NW) vào màn hình
  const orientation: Direction = raw.side === 'LEFT' ? 'RIGHT' : 'LEFT';
  const seatOffsetX = raw.side === 'LEFT' ? -(JOINED_DESK_LEAF_W / 2 + 2) : JOINED_DESK_LEAF_W / 2 + 2;

  return {
    id: `NT-SLOT-${String(idx + 1).padStart(2, '0')}`,
    islandId: `ISLAND-${raw.islandRow}.${raw.islandCol}`,
    islandRow: raw.islandRow,
    islandCol: raw.islandCol,
    subRow: raw.subRow,
    rowIndex,
    colIndex,
    side: raw.side,
    seatCode: raw.seatCode,
    account: raw.account,
    kind: raw.kind,
    highlight: raw.highlight ?? 'normal',
    sideNote: raw.sideNote,
    deskId: raw.deskId,
    assignedEmployeeId: raw.assignedEmployeeId,
    wx,
    wy,
    width: JOINED_DESK_LEAF_W,
    height: JOINED_DESK_LEAF_H,
    seatPosition: {
      x: wx + seatOffsetX,
      y: wy,
    },
    orientation,
  };
});

// ============================================================================
// 4. OFFICE ZONES (FUNCTIONAL CLUSTERS MAPPED TO BUILDING BAYS)
// ============================================================================

export const OFFICE_ZONES: OfficeZone[] = [
  {
    id: 'ZONE-PM',
    name: 'Khoang NHÀ THUỐC — PM & BA Hub (DongNQ6 • FT3.III2A.1.289)',
    shortName: 'PM & BA (FT3.III2A.1)',
    description:
      'Cụm bàn ghép 6 chỗ trung tâm trong Khoang NHÀ THUỐC — nơi PM DongNQ6 (FT3.III2A.1.289 - Bàn Đỏ) nghiệm thu Ticket DONE',
    bounds: { x: 1135, y: 260, width: 100, height: 496 },
    backgroundColor: 'rgba(245, 158, 11, 0.10)',
    borderColor: 'rgba(245, 158, 11, 0.45)',
    accentColor: '#f59e0b',
  },
  {
    id: 'ZONE-LEAD',
    name: 'Architecture & Tech Leads (ThanhDQ13 • LuuTV6 • ManhPT13)',
    shortName: 'Tech Leads',
    description: 'Các vị trí Tech Lead chủ chốt tại Cụm 2.1, 2.2, 2.3 trong Khoang NHÀ THUỐC',
    bounds: { x: 905, y: 464, width: 555, height: 104 },
    backgroundColor: 'rgba(168, 85, 247, 0.10)',
    borderColor: 'rgba(168, 85, 247, 0.45)',
    accentColor: '#a855f7',
  },
  {
    id: 'ZONE-BE',
    name: 'Backend Squad — Cụm 1.1 & Cụm 2.1 (FT3.III2A.1.100..196)',
    shortName: 'Backend Team',
    description: 'Cụm bàn ghép 1.1 & 2.1 phía Tây Khoang NHÀ THUỐC (ChienND22, CuongTN2, TrungTM7...)',
    bounds: { x: 905, y: 260, width: 100, height: 308 },
    backgroundColor: 'rgba(59, 130, 246, 0.09)',
    borderColor: 'rgba(59, 130, 246, 0.40)',
    accentColor: '#3b82f6',
  },
  {
    id: 'ZONE-FE',
    name: 'Frontend Squad — Cụm 2.2 & Cụm 2.3 (FT3.III2A.1.198..209)',
    shortName: 'Frontend Team',
    description: 'Cụm bàn ghép 2.2 & 2.3 giữa Khoang NHÀ THUỐC (BaoNAT, ThuanHM12, TriPHC, KienNT178...)',
    bounds: { x: 1135, y: 464, width: 325, height: 104 },
    backgroundColor: 'rgba(16, 185, 129, 0.09)',
    borderColor: 'rgba(16, 185, 129, 0.40)',
    accentColor: '#10b981',
  },
  {
    id: 'ZONE-MOBILE',
    name: 'Mobile Squad — Cụm 3.1 (FT3.III2A.1.291..297)',
    shortName: 'Mobile Squad',
    description: 'Cụm bàn ghép 3.1 góc Tây-Nam Khoang NHÀ THUỐC (KhoaLNT, HuyNT83, LyNH16, ThienTM2)',
    bounds: { x: 905, y: 652, width: 100, height: 104 },
    backgroundColor: 'rgba(236, 72, 153, 0.09)',
    borderColor: 'rgba(236, 72, 153, 0.40)',
    accentColor: '#ec4899',
  },
  {
    id: 'ZONE-QA',
    name: 'QA / QC Squad — Cụm 3.2 (FT3.III2A.1.284..290)',
    shortName: 'QA / QC Lab',
    description: 'Cụm bàn ghép 3.2 phía Nam Khoang NHÀ THUỐC (TranTNN, TrucNN4, ThanhNX7, PhongNT84)',
    bounds: { x: 1135, y: 652, width: 100, height: 104 },
    backgroundColor: 'rgba(249, 115, 22, 0.09)',
    borderColor: 'rgba(249, 115, 22, 0.40)',
    accentColor: '#f97316',
  },
  {
    id: 'ZONE-DEVOPS',
    name: 'DevOps & Cloud — Cụm 3.3 (FT3.III2A.1.277..283)',
    shortName: 'DevOps / SRE',
    description: 'Cụm bàn ghép 3.3 góc Đông-Nam Khoang NHÀ THUỐC (TienHK, SonNA2, HauVV7, SangNN1)',
    bounds: { x: 1360, y: 652, width: 100, height: 104 },
    backgroundColor: 'rgba(6, 182, 212, 0.10)',
    borderColor: 'rgba(6, 182, 212, 0.45)',
    accentColor: '#06b6d4',
  },
];

// ============================================================================
// 5. CORRIDOR & AISLE WAYPOINTS (3 ATRIUM LOOPS + SPACIOUS 3x3 ISLAND AISLE GRID)
// ============================================================================

export const OFFICE_WAYPOINTS: Waypoint[] = [
  // --- VÒNG HÀNH LANG TÒA NHÀ 3 GIẾNG TRỜI ---
  {
    id: 'WP-N-NW',
    label: 'North Ring NW Corner',
    grid: { col: 12, row: 4 },
    position: gridToPixel(12, 4),
    connectedTo: ['WP-N-NE', 'WP-N-SW'],
    isMainCorridor: true,
  },
  {
    id: 'WP-N-NE',
    label: 'North Ring NE Corner',
    grid: { col: 20, row: 4 },
    position: gridToPixel(20, 4),
    connectedTo: ['WP-N-NW', 'WP-N-SE'],
    isMainCorridor: true,
  },
  {
    id: 'WP-N-SW',
    label: 'North Ring SW Corner',
    grid: { col: 12, row: 7 },
    position: gridToPixel(12, 7),
    connectedTo: ['WP-N-NW', 'WP-N-SE'],
    isMainCorridor: true,
  },
  {
    id: 'WP-N-SE',
    label: 'North Ring SE Spine Junction',
    grid: { col: 20, row: 7 },
    position: gridToPixel(20, 7),
    connectedTo: ['WP-N-NE', 'WP-N-SW', 'WP-NT-N1', 'WP-C-SW'],
    isMainCorridor: true,
  },
  {
    id: 'WP-C-SW',
    label: 'Central Ring SW Spine',
    grid: { col: 20, row: 20 },
    position: gridToPixel(20, 20),
    connectedTo: ['WP-N-SE', 'WP-NT-S1', 'WP-S-MID'],
    isMainCorridor: true,
  },
  {
    id: 'WP-S-MID',
    label: 'South Ring Spine Connector',
    grid: { col: 20, row: 26 },
    position: gridToPixel(20, 26),
    connectedTo: ['WP-C-SW', 'WP-NT-B1', 'WP-S-NW', 'WP-S-NE'],
    isMainCorridor: true,
  },
  {
    id: 'WP-S-NW',
    label: 'South Ring NW Corner',
    grid: { col: 15, row: 26 },
    position: gridToPixel(15, 26),
    connectedTo: ['WP-S-MID', 'WP-S-SW'],
    isMainCorridor: true,
  },
  {
    id: 'WP-S-NE',
    label: 'South Ring NE Corner',
    grid: { col: 23, row: 26 },
    position: gridToPixel(23, 26),
    connectedTo: ['WP-S-MID', 'WP-S-SE'],
    isMainCorridor: true,
  },
  {
    id: 'WP-S-SW',
    label: 'South Ring SW Corner',
    grid: { col: 15, row: 29 },
    position: gridToPixel(15, 29),
    connectedTo: ['WP-S-NW', 'WP-S-SE'],
    isMainCorridor: true,
  },
  {
    id: 'WP-S-SE',
    label: 'South Ring SE Corner',
    grid: { col: 23, row: 29 },
    position: gridToPixel(23, 29),
    connectedTo: ['WP-S-NE', 'WP-S-SW'],
    isMainCorridor: true,
  },

  // --- LỐI ĐI RỘNG THOÁNG GIỮA 9 CỤM BÀN TRONG KHOANG NHÀ THUỐC (FT3.III2A.1) ---
  // Hàng lối đi Bắc (Row 7 - CỬA RA VÀO)
  {
    id: 'WP-NT-N1',
    label: 'Nhà Thuốc — Lối đi Bắc 1 (Cụm 1.1)',
    grid: { col: 28, row: 7 },
    position: gridToPixel(28, 7),
    connectedTo: ['WP-N-SE', 'WP-NT-N2', 'WP-NT-M1'],
    isMainCorridor: true,
  },
  {
    id: 'WP-NT-N2',
    label: 'Nhà Thuốc — CỬA RA VÀO Trái (Cụm 1.1 / 1.2)',
    grid: { col: 35, row: 7 },
    position: gridToPixel(35, 7),
    connectedTo: ['WP-NT-N1', 'WP-NT-N3', 'WP-NT-M2'],
    isMainCorridor: true,
  },
  {
    id: 'WP-NT-N3',
    label: 'Nhà Thuốc — CỬA RA VÀO Phải (Cụm 1.2 / 1.3)',
    grid: { col: 43, row: 7 },
    position: gridToPixel(43, 7),
    connectedTo: ['WP-NT-N2', 'WP-NT-N4', 'WP-NT-M3'],
    isMainCorridor: true,
  },
  {
    id: 'WP-NT-N4',
    label: 'Nhà Thuốc — Lối đi Bắc 4 (Cụm 1.3)',
    grid: { col: 50, row: 7 },
    position: gridToPixel(50, 7),
    connectedTo: ['WP-NT-N3', 'WP-NT-M4'],
    isMainCorridor: true,
  },

  // Hàng lối đi Giữa-Trên (Row 14 - Chữ NHÀ THUỐC)
  {
    id: 'WP-NT-M1',
    label: 'Nhà Thuốc — Lối đi Giữa 1 (Cụm 1.1 / 2.1)',
    grid: { col: 28, row: 14 },
    position: gridToPixel(28, 14),
    connectedTo: ['WP-NT-N1', 'WP-NT-M2', 'WP-NT-S1'],
    isMainCorridor: true,
  },
  {
    id: 'WP-NT-M2',
    label: 'Nhà Thuốc — Tâm chữ NHÀ THUỐC Trái',
    grid: { col: 35, row: 14 },
    position: gridToPixel(35, 14),
    connectedTo: ['WP-NT-N2', 'WP-NT-M1', 'WP-NT-M3', 'WP-NT-S2'],
    isMainCorridor: true,
  },
  {
    id: 'WP-NT-M3',
    label: 'Nhà Thuốc — Tâm chữ NHÀ THUỐC Phải',
    grid: { col: 43, row: 14 },
    position: gridToPixel(43, 14),
    connectedTo: ['WP-NT-N3', 'WP-NT-M2', 'WP-NT-M4', 'WP-NT-S3'],
    isMainCorridor: true,
  },
  {
    id: 'WP-NT-M4',
    label: 'Nhà Thuốc — Lối đi Giữa 4 (Cạnh CỘT NHÀ)',
    grid: { col: 50, row: 14 },
    position: gridToPixel(50, 14),
    connectedTo: ['WP-NT-N4', 'WP-NT-M3', 'WP-NT-S4'],
    isMainCorridor: true,
  },

  // Hàng lối đi Giữa-Dưới (Row 20 - Giữa Hàng 2 và Hàng 3)
  {
    id: 'WP-NT-S1',
    label: 'Nhà Thuốc — Lối đi Nam 1 (Cụm 2.1 / 3.1)',
    grid: { col: 28, row: 20 },
    position: gridToPixel(28, 20),
    connectedTo: ['WP-C-SW', 'WP-NT-M1', 'WP-NT-S2', 'WP-NT-B1'],
    isMainCorridor: true,
  },
  {
    id: 'WP-NT-S2',
    label: 'Nhà Thuốc — Lối đi Bàn PM DongNQ6 (FT3.III2A.1.289)',
    grid: { col: 35, row: 20 },
    position: gridToPixel(35, 20),
    connectedTo: ['WP-NT-M2', 'WP-NT-S1', 'WP-NT-S3', 'WP-NT-B2'],
    isMainCorridor: true,
  },
  {
    id: 'WP-NT-S3',
    label: 'Nhà Thuốc — Lối đi Nam 3 (Cụm 2.2 / 3.2 / 3.3)',
    grid: { col: 43, row: 20 },
    position: gridToPixel(43, 20),
    connectedTo: ['WP-NT-M3', 'WP-NT-S2', 'WP-NT-S4', 'WP-NT-B3'],
    isMainCorridor: true,
  },
  {
    id: 'WP-NT-S4',
    label: 'Nhà Thuốc — Lối đi Nam 4 (Cụm 2.3 / 3.3)',
    grid: { col: 50, row: 20 },
    position: gridToPixel(50, 20),
    connectedTo: ['WP-NT-M4', 'WP-NT-S3', 'WP-NT-B4'],
    isMainCorridor: true,
  },

  // Hàng lối đi Đáy (Row 26 - Đáy Cụm 3.1, 3.2, 3.3)
  {
    id: 'WP-NT-B1',
    label: 'Nhà Thuốc — Lối đi Đáy 1 (Cụm 3.1)',
    grid: { col: 28, row: 26 },
    position: gridToPixel(28, 26),
    connectedTo: ['WP-S-MID', 'WP-NT-S1', 'WP-NT-B2'],
    isMainCorridor: true,
  },
  {
    id: 'WP-NT-B2',
    label: 'Nhà Thuốc — Lối đi Đáy 2 (Cụm 3.1 / 3.2)',
    grid: { col: 35, row: 26 },
    position: gridToPixel(35, 26),
    connectedTo: ['WP-NT-S2', 'WP-NT-B1', 'WP-NT-B3'],
    isMainCorridor: true,
  },
  {
    id: 'WP-NT-B3',
    label: 'Nhà Thuốc — Lối đi Đáy 3 (Cụm 3.2 / 3.3)',
    grid: { col: 43, row: 26 },
    position: gridToPixel(43, 26),
    connectedTo: ['WP-NT-S3', 'WP-NT-B2', 'WP-NT-B4'],
    isMainCorridor: true,
  },
  {
    id: 'WP-NT-B4',
    label: 'Nhà Thuốc — Lối đi Đáy 4 (Cụm 3.3)',
    grid: { col: 50, row: 26 },
    position: gridToPixel(50, 26),
    connectedTo: ['WP-NT-S4', 'WP-NT-B3'],
    isMainCorridor: true,
  },
];

// ============================================================================
// 6. 30 ACTIVE SIMULATION DESKS (DESK-01 .. DESK-30 MAPPED TO EXACT REAL SEATS)
// ============================================================================

/**
 * Xây dựng 30 bàn điều phối chính (`DESK-01` .. `DESK-30`) trực tiếp từ các vị trí ghế thật
 * trong Khoang NHÀ THUỐC (`FT3.III2A.1.*`), sắp xếp đúng thứ tự `DESK-01` .. `DESK-30`.
 */
export const DESK_POSITIONS: DeskPosition[] = RAW_NHA_THUOC_SLOTS.filter(
  (slot): slot is RawNhaThuocSlotDef & { deskId: string; assignedEmployeeId: string; zoneId: ZoneId } =>
    Boolean(slot.deskId && slot.assignedEmployeeId && slot.zoneId)
)
  .sort((a, b) => {
    const numA = parseInt(a.deskId.replace(/\D/g, ''), 10);
    const numB = parseInt(b.deskId.replace(/\D/g, ''), 10);
    return numA - numB;
  })
  .map((slot) => {
    const colCfg = ISLAND_COL_COORDS[slot.islandCol];
    const rowCfg = ISLAND_ROW_COORDS[slot.islandRow];
    const centerX = slot.side === 'LEFT' ? colCfg.leftSeatX : colCfg.rightSeatX;
    const centerY = rowCfg.rowYs[slot.subRow - 1];
    const rowIndex = (slot.subRow - 1) as 0 | 1 | 2;
    const colIndex: 0 | 1 = slot.side === 'LEFT' ? 0 : 1;
    const handoffCol = slot.side === 'LEFT' ? colCfg.leftHandoffCol : colCfg.rightHandoffCol;
    const handoffRow = rowCfg.rowHandoffRows[slot.subRow - 1];
    // Dãy Trái (colIndex = 0) ngồi ở mép ngoài bên trái nhìn hướng RIGHT (SE) vào màn hình;
    // Dãy Phải (colIndex = 1) ngồi ở mép ngoài bên phải nhìn hướng LEFT (NW) vào màn hình
    const orientation: Direction = slot.side === 'LEFT' ? 'RIGHT' : 'LEFT';
    const seatOffsetX =
      slot.side === 'LEFT' ? -(JOINED_DESK_LEAF_W / 2 + 2) : JOINED_DESK_LEAF_W / 2 + 2;
    const seatOffsetY = 0;
    const shortSeatCode = slot.seatCode.replace('FT3.III2A.', '');

    return {
      id: slot.deskId,
      label: `${shortSeatCode} • ${slot.account}`,
      zoneId: slot.zoneId,
      assignedEmployeeId: slot.assignedEmployeeId,
      position: { x: centerX, y: centerY },
      x: centerX,
      y: centerY,
      grid: pixelToGrid(centerX, centerY),
      width: JOINED_DESK_LEAF_W,
      height: JOINED_DESK_LEAF_H,
      orientation,
      seatPosition: {
        x: centerX + seatOffsetX,
        y: centerY + seatOffsetY,
      },
      handoffGrid: {
        col: handoffCol,
        row: handoffRow,
      },
      handoffPoint: gridToPixel(handoffCol, handoffRow),
      nearestWaypointId: slot.nearestWaypointId,
      seatCode: slot.seatCode,
      account: slot.account,
      islandId: `ISLAND-${slot.islandRow}.${slot.islandCol}`,
      rowIndex,
      colIndex,
      highlightVariant: slot.highlight ?? 'normal',
      sideNote: slot.sideNote,
    };
  });

/** Vị trí khởi hành trung tâm của Sếp nữ ThuNDM (`EMP-MANAGER-THUNDM`) tại trục hành lang chính Khoang NHÀ THUỐC (`FT3.III2A.1`) */
export const MANAGER_THUNDM_STATION: DeskPosition = {
  id: 'DESK-MANAGER-THUNDM',
  label: 'FT3.III2A.1.VIP • ThuNDM (Sếp Nữ - Khoang Đông)',
  zoneId: 'ZONE-PM',
  assignedEmployeeId: 'EMP-MANAGER-THUNDM',
  position: gridToPixel(35, 14),
  x: gridToPixel(35, 14).x,
  y: gridToPixel(35, 14).y,
  grid: { col: 35, row: 14 },
  width: 32,
  height: 24,
  orientation: 'DOWN',
  seatPosition: gridToPixel(35, 14),
  handoffGrid: { col: 35, row: 14 },
  handoffPoint: gridToPixel(35, 14),
  nearestWaypointId: 'WP-NT-M2',
  seatCode: 'FT3.III2A.1.VIP',
  account: 'ThuNDM',
  islandId: 'FT3.III2A.1 • SẾP THUNDM',
  highlightVariant: 'red',
};

/** Vị trí tuần tra của Sếp Nam ToanLBK (`EMP-MANAGER-TOANLBK`) - Tốc độ 1.5x, luôn giận dữ 💢 tại Khoang Bắc (North Wing) */
export const MANAGER_TOANLBK_STATION: DeskPosition = {
  id: 'DESK-MANAGER-TOANLBK',
  label: 'NORTH.VIP • ToanLBK (Sếp Nam 1.5x 💢 - Khoang Bắc)',
  zoneId: 'ZONE-LEAD',
  assignedEmployeeId: 'EMP-MANAGER-TOANLBK',
  position: gridToPixel(16, 4),
  x: gridToPixel(16, 4).x,
  y: gridToPixel(16, 4).y,
  grid: { col: 16, row: 4 },
  width: 32,
  height: 24,
  orientation: 'RIGHT',
  seatPosition: gridToPixel(16, 4),
  handoffGrid: { col: 16, row: 4 },
  handoffPoint: gridToPixel(16, 4),
  nearestWaypointId: 'WP-N-NW',
  seatCode: 'FT3.NORTH.VIP',
  account: 'ToanLBK',
  islandId: 'NORTH WING • SẾP TOANLBK',
  highlightVariant: 'red',
};

/** Vị trí tuần tra của Sếp Nữ doannt19 (`EMP-MANAGER-DOANNT19`) - Luôn vui vẻ cười tươi 😄 tại Khoang Tây-Trung (West-Central Wing) */
export const MANAGER_DOANNT19_STATION: DeskPosition = {
  id: 'DESK-MANAGER-DOANNT19',
  label: 'CENTRAL.VIP • doannt19 (Sếp Nữ 😄 - Khoang Tây-Trung)',
  zoneId: 'ZONE-PM',
  assignedEmployeeId: 'EMP-MANAGER-DOANNT19',
  position: gridToPixel(20, 14),
  x: gridToPixel(20, 14).x,
  y: gridToPixel(20, 14).y,
  grid: { col: 20, row: 14 },
  width: 32,
  height: 24,
  orientation: 'DOWN',
  seatPosition: gridToPixel(20, 14),
  handoffGrid: { col: 20, row: 14 },
  handoffPoint: gridToPixel(20, 14),
  nearestWaypointId: 'WP-C-SW',
  seatCode: 'FT3.CENTRAL.VIP',
  account: 'doannt19',
  islandId: 'WEST-CENTRAL • SẾP DOANNT19',
  highlightVariant: 'yellow',
};

/** Vị trí tuần tra của Sếp Nữ vanltb8 (`EMP-MANAGER-VANLTB8`) - Luôn lo lắng 😰 tại Khoang Nam (South Wing) */
export const MANAGER_VANLTB8_STATION: DeskPosition = {
  id: 'DESK-MANAGER-VANLTB8',
  label: 'SOUTH.VIP • vanltb8 (Sếp Nữ 😰 - Khoang Nam)',
  zoneId: 'ZONE-QA',
  assignedEmployeeId: 'EMP-MANAGER-VANLTB8',
  position: gridToPixel(18, 26),
  x: gridToPixel(18, 26).x,
  y: gridToPixel(18, 26).y,
  grid: { col: 18, row: 26 },
  width: 32,
  height: 24,
  orientation: 'RIGHT',
  seatPosition: gridToPixel(18, 26),
  handoffGrid: { col: 18, row: 26 },
  handoffPoint: gridToPixel(18, 26),
  nearestWaypointId: 'WP-S-MID',
  seatCode: 'FT3.SOUTH.VIP',
  account: 'vanltb8',
  islandId: 'SOUTH WING • SẾP VANLTB8',
  highlightVariant: 'normal',
};

/** Lộ trình tuần tra vòng quanh phòng riêng của 3 vị Sếp mới (Khoang Bắc, Khoang Tây-Trung, Khoang Nam) */
export const BOSS_WING_PATROL_LOOPS: Record<string, Point2D[]> = {
  'EMP-MANAGER-TOANLBK': [
    gridToPixel(12, 4),
    gridToPixel(20, 4),
    gridToPixel(20, 9),
    gridToPixel(12, 9),
    gridToPixel(11, 7),
    gridToPixel(12, 4),
  ],
  'EMP-MANAGER-DOANNT19': [
    gridToPixel(19, 11),
    gridToPixel(26, 11),
    gridToPixel(26, 18),
    gridToPixel(19, 18),
    gridToPixel(19, 14),
    gridToPixel(19, 11),
  ],
  'EMP-MANAGER-VANLTB8': [
    gridToPixel(15, 20),
    gridToPixel(23, 20),
    gridToPixel(23, 28),
    gridToPixel(15, 28),
    gridToPixel(15, 26),
    gridToPixel(15, 20),
  ],
};

// ============================================================================
// 6B. FULL-MAP 6-DESK JOINED ISLANDS ACROSS ALL 4 WINGS (NORTH, WEST-CENTRAL, SOUTH + EAST)
// ============================================================================

function buildExtraWingIsland(params: {
  id: string;
  label: string;
  partitionWx: number;
  tableWy: number;
  leftHandoffCol: number;
  rightHandoffCol: number;
  rowHandoffRows: [number, number, number];
}): NhaThuocIslandMeta {
  const tableWx = params.partitionWx - JOINED_DESK_LEAF_W;
  const tableWw = JOINED_DESK_LEAF_W * 2;
  const tableWh = JOINED_DESK_LEAF_H * 3;
  return {
    id: params.id,
    label: params.label,
    islandRow: 1,
    islandCol: 1,
    wx: params.partitionWx - 50,
    wy: params.tableWy - 4,
    ww: 100,
    wh: tableWh + 8,
    tableWx,
    tableWy: params.tableWy,
    tableWw,
    tableWh,
    deskW: JOINED_DESK_LEAF_W,
    deskH: JOINED_DESK_LEAF_H,
    partitionWx: params.partitionWx,
    leftSeatX: params.partitionWx - JOINED_DESK_LEAF_W / 2,
    rightSeatX: params.partitionWx + JOINED_DESK_LEAF_W / 2,
    rowYs: [
      params.tableWy + JOINED_DESK_LEAF_H * 0.5,
      params.tableWy + JOINED_DESK_LEAF_H * 1.5,
      params.tableWy + JOINED_DESK_LEAF_H * 2.5,
    ],
    leftHandoffCol: params.leftHandoffCol,
    rightHandoffCol: params.rightHandoffCol,
    rowHandoffRows: params.rowHandoffRows,
  };
}

/** Các cụm 6 bàn ghép (2x3 Joined Bench Islands) phủ khắp 3 phòng còn lại (Khoang Bắc, Khoang Tây-Trung, Khoang Nam) */
export const EXTRA_WING_ISLANDS: NhaThuocIslandMeta[] = [
  // --- KHOANG BẮC (North Wing - Sếp ToanLBK tuần tra) ---
  buildExtraWingIsland({
    id: 'ISLAND-N.1',
    label: 'Cụm Bắc 1 (North-West)',
    partitionWx: 300,
    tableWy: 42,
    leftHandoffCol: 10,
    rightHandoffCol: 12,
    rowHandoffRows: [4, 4, 4],
  }),
  buildExtraWingIsland({
    id: 'ISLAND-N.2',
    label: 'Cụm Bắc 2 (North-East)',
    partitionWx: 560,
    tableWy: 42,
    leftHandoffCol: 18,
    rightHandoffCol: 20,
    rowHandoffRows: [4, 4, 4],
  }),
  buildExtraWingIsland({
    id: 'ISLAND-N.3',
    label: 'Cụm Bắc 3 (North-South)',
    partitionWx: 300,
    tableWy: 192,
    leftHandoffCol: 10,
    rightHandoffCol: 12,
    rowHandoffRows: [7, 7, 7],
  }),

  // --- KHOANG TÂY-TRUNG (West-Central Wing - Sếp doannt19 tuần tra) ---
  buildExtraWingIsland({
    id: 'ISLAND-WC.1',
    label: 'Cụm Tây-Trung 1 (Central Spine)',
    partitionWx: 512,
    tableWy: 366,
    leftHandoffCol: 17,
    rightHandoffCol: 20,
    rowHandoffRows: [12, 14, 15],
  }),
  buildExtraWingIsland({
    id: 'ISLAND-WC.2',
    label: 'Cụm Tây-Trung 2 (Tech Lead Hub)',
    partitionWx: 682,
    tableWy: 218,
    leftHandoffCol: 20,
    rightHandoffCol: 24,
    rowHandoffRows: [7, 8, 9],
  }),

  // --- KHOANG NAM (South Wing - Sếp vanltb8 tuần tra) ---
  buildExtraWingIsland({
    id: 'ISLAND-S.1',
    label: 'Cụm Nam 1 (South-West Lab)',
    partitionWx: 384,
    tableWy: 604,
    leftHandoffCol: 13,
    rightHandoffCol: 15,
    rowHandoffRows: [20, 21, 22],
  }),
  buildExtraWingIsland({
    id: 'ISLAND-S.2',
    label: 'Cụm Nam 2 (South-East QA)',
    partitionWx: 662,
    tableWy: 792,
    leftHandoffCol: 20,
    rightHandoffCol: 23,
    rowHandoffRows: [26, 27, 28],
  }),
];

/** Toàn bộ 16 Cụm 6 Bàn Ghép (96 chỗ ngồi) phủ kín 4 phòng của Tòa nhà FRT */
export const ALL_JOINED_DESK_ISLANDS: NhaThuocIslandMeta[] = [
  ...NHA_THUOC_ISLANDS,
  ...EXTRA_WING_ISLANDS,
];

/** Sinh các ô bàn làm việc cho 7 Cụm Bàn Ghép ở Khoang Bắc, Khoang Tây-Trung, Khoang Nam */
export const EXTRA_WING_SEAT_SLOTS: NhaThuocSeatSlot[] = EXTRA_WING_ISLANDS.flatMap(
  (isl, islIdx) => {
    const slots: NhaThuocSeatSlot[] = [];
    for (const subRow of [1, 2, 3] as const) {
      for (const side of ['LEFT', 'RIGHT'] as const) {
        const wx = side === 'LEFT' ? isl.leftSeatX : isl.rightSeatX;
        const wy = isl.rowYs[subRow - 1];
        const rowIndex = (subRow - 1) as 0 | 1 | 2;
        const colIndex: 0 | 1 = side === 'LEFT' ? 0 : 1;
        const orientation: Direction = side === 'LEFT' ? 'RIGHT' : 'LEFT';
        const seatOffsetX =
          side === 'LEFT' ? -(JOINED_DESK_LEAF_W / 2 + 2) : JOINED_DESK_LEAF_W / 2 + 2;
        const slotNum = islIdx * 6 + (subRow - 1) * 2 + (side === 'LEFT' ? 1 : 2);
        slots.push({
          id: `EXTRA-SLOT-${String(slotNum).padStart(2, '0')}`,
          islandId: isl.id,
          islandRow: 1,
          islandCol: 1,
          subRow,
          rowIndex,
          colIndex,
          side,
          seatCode: `${isl.id.replace('ISLAND-', 'FT3.')}.${subRow}${side === 'LEFT' ? 'A' : 'B'}`,
          account: `Desk ${isl.id.replace('ISLAND-', '')}-${subRow}${side === 'LEFT' ? 'L' : 'R'}`,
          kind: 'OCCUPIED',
          highlight: 'normal',
          wx,
          wy,
          width: JOINED_DESK_LEAF_W,
          height: JOINED_DESK_LEAF_H,
          seatPosition: {
            x: wx + seatOffsetX,
            y: wy,
          },
          orientation,
        });
      }
    }
    return slots;
  }
);

/** Toàn bộ 96 ô bàn trên khắp bản đồ (54 ô Khoang Đông + 42 ô ở 3 Khoang Bắc / Tây-Trung / Nam) */
export const ALL_OFFICE_SEAT_SLOTS: NhaThuocSeatSlot[] = [
  ...NHA_THUOC_SEAT_SLOTS,
  ...EXTRA_WING_SEAT_SLOTS,
];

// ============================================================================
// 6C. 3 CỤM SERVER BUILD 3D (`JENKINS_SERVER_CLUSTERS`: CI + UAT + RELEASE)
// ============================================================================

export type JenkinsServerStationMeta = JenkinsServerStation;

/**
 * Cluster #1 — `🖥️ JENKINS CI CLUSTER (oneclickv4-build-ci)` (Đèn LED Cyan `#38bdf8`)
 * Đặt tại Khoang Đông / Khoang NHÀ THUỐC (`FT3.III2A.1`).
 */
export const JENKINS_SERVER_STATION: JenkinsServerStation = {
  id: 'JENKINS-CI-STATION',
  deskId: 'DESK-JENKINS-SERVER',
  clusterId: 'CI',
  ledColor: '#38bdf8',
  wingLabel: 'CLUSTER #1 • CI PIPELINE',
  title: '🖥️ JENKINS CI CLUSTER (oneclickv4-build-ci)',
  shortTitle: '🖥️ JENKINS CI • oneclickv4-build-ci',
  jobName: 'oneclickv4-build-ci',
  rssUrl: 'https://jenkins-osp.frt.vn/job/oneclickv4-build-ci/rssAll',
  proxyRssUrl: '/api/frt-jenkins-rss',
  wx: 1352,
  wy: 586,
  ww: 108,
  wh: 32,
  consolePosition: { x: 1398, y: 604 },
  operatorPosition: gridToPixel(46, 20), // { x: 1395, y: 615 }
  operatorGrid: { col: 46, row: 20 },
  operatorFacing: 'UP',
  cameraFocusWorld: {
    x: 1404,
    y: 602,
    zoom: 1.62,
  },
};

/**
 * Cluster #2 — `🖥️ JENKINS UAT CLUSTER (oneclickv4-build-uat)` (Đèn LED Purple `#a855f7`)
 * Đặt tại Giao lộ Trung tâm - Bắc (`gx: 14.2..28, gy: 12.2`) kết nối trực tiếp hành lang chính.
 */
export const JENKINS_UAT_SERVER_STATION: JenkinsServerStation = {
  id: 'JENKINS-UAT-STATION',
  deskId: 'DESK-JENKINS-UAT',
  clusterId: 'UAT',
  ledColor: '#a855f7',
  wingLabel: 'CLUSTER #2 • UAT PIPELINE',
  title: '🖥️ JENKINS UAT CLUSTER (oneclickv4-build-uat)',
  shortTitle: '🖥️ JENKINS UAT • oneclickv4-build-uat',
  jobName: 'oneclickv4-build-uat',
  rssUrl: 'https://jenkins-osp.frt.vn/job/oneclickv4-build-uat/rssAll',
  proxyRssUrl: '/api/frt-jenkins-uat-rss',
  wx: 760,
  wy: 382,
  ww: 96,
  wh: 30,
  consolePosition: { x: 804, y: 398 },
  operatorPosition: gridToPixel(28, 14), // { x: 855, y: 435 } ngay trên hành lang walkable col=28, row=14
  operatorGrid: { col: 28, row: 14 },
  operatorFacing: 'LEFT',
  cameraFocusWorld: {
    x: 808,
    y: 398,
    zoom: 1.62,
  },
};

/**
 * Cluster #3 — `🖥️ JENKINS RELEASE / PROD CLUSTER` (Đèn LED Emerald `#10b981`)
 * Đặt tại Giao lộ Trung tâm - Nam (`gx: 14.2..28, gy: 24.5`) kết nối trực tiếp hành lang chính.
 */
export const JENKINS_RELEASE_SERVER_STATION: JenkinsServerStation = {
  id: 'JENKINS-RELEASE-STATION',
  deskId: 'DESK-JENKINS-RELEASE',
  clusterId: 'RELEASE',
  ledColor: '#10b981',
  wingLabel: 'CLUSTER #3 • PROD RELEASE',
  title: '🖥️ JENKINS RELEASE / PROD CLUSTER',
  shortTitle: '🖥️ JENKINS RELEASE / PROD',
  jobName: 'oneclickv4-build-release',
  rssUrl: 'https://jenkins-osp.frt.vn/job/oneclickv4-build-uat/rssAll',
  proxyRssUrl: '/api/frt-jenkins-uat-rss',
  wx: 760,
  wy: 742,
  ww: 96,
  wh: 30,
  consolePosition: { x: 804, y: 758 },
  operatorPosition: gridToPixel(28, 26), // { x: 855, y: 795 } ngay trên hành lang walkable col=28, row=26
  operatorGrid: { col: 28, row: 26 },
  operatorFacing: 'UP',
  cameraFocusWorld: {
    x: 808,
    y: 758,
    zoom: 1.62,
  },
};

/** Danh sách 3 Cụm Máy Chủ Build 3D trên Bản đồ (CI + UAT + RELEASE) */
export const JENKINS_SERVER_CLUSTERS: JenkinsServerStation[] = [
  JENKINS_SERVER_STATION,
  JENKINS_UAT_SERVER_STATION,
  JENKINS_RELEASE_SERVER_STATION,
];

/** Bàn điều khiển ảo đại diện cho Trạm Server Jenkins CI (Cluster #1) */
export const JENKINS_SERVER_DESK: DeskPosition = {
  id: 'DESK-JENKINS-SERVER',
  label: '🖥️ JENKINS CI CLUSTER • oneclickv4-build-ci',
  zoneId: 'ZONE-DEVOPS',
  assignedEmployeeId: 'EMP-29',
  position: { ...JENKINS_SERVER_STATION.consolePosition },
  x: JENKINS_SERVER_STATION.consolePosition.x,
  y: JENKINS_SERVER_STATION.consolePosition.y,
  grid: { ...JENKINS_SERVER_STATION.operatorGrid },
  width: 48,
  height: 26,
  orientation: 'UP',
  seatPosition: { ...JENKINS_SERVER_STATION.operatorPosition },
  handoffGrid: { ...JENKINS_SERVER_STATION.operatorGrid },
  handoffPoint: { ...JENKINS_SERVER_STATION.operatorPosition },
  nearestWaypointId: 'WP-NT-S3',
  seatCode: 'JENKINS-CI',
  account: 'oneclickv4-build-ci',
  islandId: 'CLUSTER-1 • JENKINS CI',
  highlightVariant: 'normal',
};

/** Bàn điều khiển ảo đại diện cho Trạm Server Jenkins UAT (Cluster #2) */
export const JENKINS_UAT_SERVER_DESK: DeskPosition = {
  id: 'DESK-JENKINS-UAT',
  label: '🖥️ JENKINS UAT CLUSTER • oneclickv4-build-uat',
  zoneId: 'ZONE-DEVOPS',
  assignedEmployeeId: 'EMP-30',
  position: { ...JENKINS_UAT_SERVER_STATION.consolePosition },
  x: JENKINS_UAT_SERVER_STATION.consolePosition.x,
  y: JENKINS_UAT_SERVER_STATION.consolePosition.y,
  grid: { ...JENKINS_UAT_SERVER_STATION.operatorGrid },
  width: 48,
  height: 26,
  orientation: 'LEFT',
  seatPosition: { ...JENKINS_UAT_SERVER_STATION.operatorPosition },
  handoffGrid: { ...JENKINS_UAT_SERVER_STATION.operatorGrid },
  handoffPoint: { ...JENKINS_UAT_SERVER_STATION.operatorPosition },
  nearestWaypointId: 'WP-NT-M1',
  seatCode: 'JENKINS-UAT',
  account: 'oneclickv4-build-uat',
  islandId: 'CLUSTER-2 • JENKINS UAT',
  highlightVariant: 'normal',
};

/** Bàn điều khiển ảo đại diện cho Trạm Server Jenkins RELEASE (Cluster #3) */
export const JENKINS_RELEASE_SERVER_DESK: DeskPosition = {
  id: 'DESK-JENKINS-RELEASE',
  label: '🖥️ JENKINS RELEASE / PROD CLUSTER',
  zoneId: 'ZONE-DEVOPS',
  assignedEmployeeId: 'EMP-29',
  position: { ...JENKINS_RELEASE_SERVER_STATION.consolePosition },
  x: JENKINS_RELEASE_SERVER_STATION.consolePosition.x,
  y: JENKINS_RELEASE_SERVER_STATION.consolePosition.y,
  grid: { ...JENKINS_RELEASE_SERVER_STATION.operatorGrid },
  width: 48,
  height: 26,
  orientation: 'UP',
  seatPosition: { ...JENKINS_RELEASE_SERVER_STATION.operatorPosition },
  handoffGrid: { ...JENKINS_RELEASE_SERVER_STATION.operatorGrid },
  handoffPoint: { ...JENKINS_RELEASE_SERVER_STATION.operatorPosition },
  nearestWaypointId: 'WP-NT-B1',
  seatCode: 'JENKINS-PROD',
  account: 'oneclickv4-build-release',
  islandId: 'CLUSTER-3 • JENKINS RELEASE',
  highlightVariant: 'normal',
};

// ============================================================================
// 6D. CỬA RA VÀO (`🚪 CỬA RA VÀO`) & KHU VỰC HÚT THUỐC QUANH 3 GIẾNG TRỜI (`🚬 💨`)
// ============================================================================

/** Điểm xuất phát tại `🚪 CỬA RA VÀO` khi nhân viên có Event đầu ngày đi vào công ty chiếm bàn */
export const ENTRANCE_DOOR_SPAWN_GRID: GridCoord = { col: 39, row: 7 };
export const ENTRANCE_DOOR_SPAWN_POINT: Point2D = gridToPixel(39, 7); // { x: 1185, y: 225 }

export const ENTRANCE_DOOR_DESK: DeskPosition = {
  id: 'DESK-ENTRANCE-DOOR',
  label: '🚪 CỬA RA VÀO CHÍNH',
  zoneId: 'ZONE-PM',
  assignedEmployeeId: 'EMP-01',
  position: { ...ENTRANCE_DOOR_SPAWN_POINT },
  x: ENTRANCE_DOOR_SPAWN_POINT.x,
  y: ENTRANCE_DOOR_SPAWN_POINT.y,
  grid: { ...ENTRANCE_DOOR_SPAWN_GRID },
  width: 40,
  height: 20,
  orientation: 'DOWN',
  seatPosition: { ...ENTRANCE_DOOR_SPAWN_POINT },
  handoffGrid: { ...ENTRANCE_DOOR_SPAWN_GRID },
  handoffPoint: { ...ENTRANCE_DOOR_SPAWN_POINT },
  nearestWaypointId: 'WP-NT-N2',
  seatCode: 'ENTRANCE',
  account: 'CỬA RA VÀO',
  islandId: 'ENTRANCE',
};

/** Danh sách các vị trí đứng tụ tập hút thuốc (`🚬 💨`) trên hành lang đá xám quanh Hồ Hoa Súng của 3 Giếng Trời */
export const ATRIUM_SMOKING_SPOTS: {
  atriumId: 'ATRIUM-NORTH' | 'ATRIUM-CENTRAL' | 'ATRIUM-SOUTH';
  atriumName: string;
  spot: Point2D;
  position: Point2D;
  grid: GridCoord;
  facing: Direction;
}[] = [
  // Quanh Giếng Trời Trung Tâm (Central Grand Atrium: wx 585..780, wy 368..512)
  { atriumId: 'ATRIUM-CENTRAL', atriumName: 'Giếng Trời Trung Tâm', spot: { x: 598, y: 356 }, position: { x: 598, y: 356 }, grid: { col: 20, row: 12 }, facing: 'DOWN' },
  { atriumId: 'ATRIUM-CENTRAL', atriumName: 'Giếng Trời Trung Tâm', spot: { x: 648, y: 356 }, position: { x: 648, y: 356 }, grid: { col: 20, row: 12 }, facing: 'DOWN' },
  { atriumId: 'ATRIUM-CENTRAL', atriumName: 'Giếng Trời Trung Tâm', spot: { x: 705, y: 356 }, position: { x: 705, y: 356 }, grid: { col: 20, row: 12 }, facing: 'DOWN' },
  { atriumId: 'ATRIUM-CENTRAL', atriumName: 'Giếng Trời Trung Tâm', spot: { x: 572, y: 405 }, position: { x: 572, y: 405 }, grid: { col: 20, row: 14 }, facing: 'RIGHT' },
  { atriumId: 'ATRIUM-CENTRAL', atriumName: 'Giếng Trời Trung Tâm', spot: { x: 572, y: 455 }, position: { x: 572, y: 455 }, grid: { col: 20, row: 15 }, facing: 'RIGHT' },
  { atriumId: 'ATRIUM-CENTRAL', atriumName: 'Giếng Trời Trung Tâm', spot: { x: 572, y: 498 }, position: { x: 572, y: 498 }, grid: { col: 20, row: 17 }, facing: 'RIGHT' },
  { atriumId: 'ATRIUM-CENTRAL', atriumName: 'Giếng Trời Trung Tâm', spot: { x: 635, y: 524 }, position: { x: 635, y: 524 }, grid: { col: 20, row: 18 }, facing: 'UP' },
  { atriumId: 'ATRIUM-CENTRAL', atriumName: 'Giếng Trời Trung Tâm', spot: { x: 715, y: 524 }, position: { x: 715, y: 524 }, grid: { col: 20, row: 18 }, facing: 'UP' },

  // Quanh Giếng Trời Bắc (North Sky Atrium: wx 385..585, wy 138..246)
  { atriumId: 'ATRIUM-NORTH', atriumName: 'Giếng Trời Bắc', spot: { x: 425, y: 126 }, position: { x: 425, y: 126 }, grid: { col: 14, row: 4 }, facing: 'DOWN' },
  { atriumId: 'ATRIUM-NORTH', atriumName: 'Giếng Trời Bắc', spot: { x: 495, y: 126 }, position: { x: 495, y: 126 }, grid: { col: 16, row: 4 }, facing: 'DOWN' },
  { atriumId: 'ATRIUM-NORTH', atriumName: 'Giếng Trời Bắc', spot: { x: 555, y: 126 }, position: { x: 555, y: 126 }, grid: { col: 18, row: 4 }, facing: 'DOWN' },
  { atriumId: 'ATRIUM-NORTH', atriumName: 'Giếng Trời Bắc', spot: { x: 374, y: 185 }, position: { x: 374, y: 185 }, grid: { col: 12, row: 6 }, facing: 'RIGHT' },
  { atriumId: 'ATRIUM-NORTH', atriumName: 'Giếng Trời Bắc', spot: { x: 455, y: 256 }, position: { x: 455, y: 256 }, grid: { col: 15, row: 7 }, facing: 'UP' },
  { atriumId: 'ATRIUM-NORTH', atriumName: 'Giếng Trời Bắc', spot: { x: 535, y: 256 }, position: { x: 535, y: 256 }, grid: { col: 18, row: 7 }, facing: 'UP' },

  // Quanh Giếng Trời Nam (South Garden Atrium: wx 475..675, wy 630..780)
  { atriumId: 'ATRIUM-SOUTH', atriumName: 'Giếng Trời Nam', spot: { x: 515, y: 618 }, position: { x: 515, y: 618 }, grid: { col: 17, row: 20 }, facing: 'DOWN' },
  { atriumId: 'ATRIUM-SOUTH', atriumName: 'Giếng Trời Nam', spot: { x: 585, y: 618 }, position: { x: 585, y: 618 }, grid: { col: 19, row: 20 }, facing: 'DOWN' },
  { atriumId: 'ATRIUM-SOUTH', atriumName: 'Giếng Trời Nam', spot: { x: 645, y: 618 }, position: { x: 645, y: 618 }, grid: { col: 21, row: 20 }, facing: 'DOWN' },
  { atriumId: 'ATRIUM-SOUTH', atriumName: 'Giếng Trời Nam', spot: { x: 462, y: 685 }, position: { x: 462, y: 685 }, grid: { col: 15, row: 23 }, facing: 'RIGHT' },
  { atriumId: 'ATRIUM-SOUTH', atriumName: 'Giếng Trời Nam', spot: { x: 535, y: 790 }, position: { x: 535, y: 790 }, grid: { col: 18, row: 26 }, facing: 'UP' },
  { atriumId: 'ATRIUM-SOUTH', atriumName: 'Giếng Trời Nam', spot: { x: 615, y: 790 }, position: { x: 615, y: 790 }, grid: { col: 20, row: 26 }, facing: 'UP' },
];

/** Map tra cứu nhanh bàn làm việc theo deskId */
export const DESK_BY_ID: Record<string, DeskPosition> = {
  ...Object.fromEntries(DESK_POSITIONS.map((desk) => [desk.id, desk])),
  'DESK-MANAGER-THUNDM': MANAGER_THUNDM_STATION,
  'DESK-MANAGER-TOANLBK': MANAGER_TOANLBK_STATION,
  'DESK-MANAGER-DOANNT19': MANAGER_DOANNT19_STATION,
  'DESK-MANAGER-VANLTB8': MANAGER_VANLTB8_STATION,
  'DESK-JENKINS-SERVER': JENKINS_SERVER_DESK,
  'DESK-JENKINS-UAT': JENKINS_UAT_SERVER_DESK,
  'DESK-JENKINS-RELEASE': JENKINS_RELEASE_SERVER_DESK,
  'DESK-ENTRANCE-DOOR': ENTRANCE_DOOR_DESK,
};

/** Map tra cứu nhanh bàn làm việc theo employeeId */
export const DESK_BY_EMPLOYEE_ID: Record<string, DeskPosition> = {
  ...Object.fromEntries(DESK_POSITIONS.map((desk) => [desk.assignedEmployeeId, desk])),
  'EMP-MANAGER-THUNDM': MANAGER_THUNDM_STATION,
  'EMP-MANAGER-TOANLBK': MANAGER_TOANLBK_STATION,
  'EMP-MANAGER-DOANNT19': MANAGER_DOANNT19_STATION,
  'EMP-MANAGER-VANLTB8': MANAGER_VANLTB8_STATION,
  'emp-thundm': MANAGER_THUNDM_STATION,
  'emp-toanlbk': MANAGER_TOANLBK_STATION,
  'emp-doannt19': MANAGER_DOANNT19_STATION,
  'emp-vanltb8': MANAGER_VANLTB8_STATION,
};

/** Bàn của Project Manager / Lead (`DongNQ6` tại `FT3.III2A.1.289` - Ô màu ĐỎ đặc biệt ở Cụm 3.2) */
export const PM_DESK: DeskPosition = DESK_BY_ID['DESK-01'];

// ============================================================================
// 7. WALKABLE CORRIDOR & 3x3 ISLAND AISLE GRID + A* / BFS PATHFINDING
// ============================================================================

/** Các cột hành lang dọc chính (bao gồm 4 lối đi dọc rộng rãi giữa 3 cột đảo bàn trong Khoang NHÀ THUỐC: 28, 35, 43, 50) */
export const VERTICAL_CORRIDOR_COLS = [12, 15, 20, 23, 28, 35, 43, 50];

/** Các hàng hành lang ngang chính (bao gồm 4 lối đi ngang rộng rãi giữa 3 hàng đảo bàn trong Khoang NHÀ THUỐC: 7, 14, 20, 26) */
export const HORIZONTAL_CORRIDOR_ROWS = [4, 7, 14, 20, 26, 29];

/**
 * Khởi tạo ma trận lưới 2D (35 hàng x 56 cột):
 * - Kết hợp Hệ thống Hành lang vòng ôm quanh 3 Giếng trời VÀ
 * - Hệ thống 4 lối đi dọc (col 28, 35, 43, 50) x 4 lối đi ngang (row 7, 14, 20, 26) xen giữa 9 cụm đảo bàn
 *   rộng thoáng trong Khoang NHÀ THUỐC (`FT3.III2A.1`).
 */
export function createWalkableGrid(): boolean[][] {
  const grid: boolean[][] = Array.from({ length: OFFICE_GRID_ROWS }, () =>
    Array.from({ length: OFFICE_GRID_COLS }, () => false)
  );

  const markSegmentWalkable = (c0: number, r0: number, c1: number, r1: number) => {
    const minC = Math.max(0, Math.min(c0, c1));
    const maxC = Math.min(OFFICE_GRID_COLS - 1, Math.max(c0, c1));
    const minR = Math.max(0, Math.min(r0, r1));
    const maxR = Math.min(OFFICE_GRID_ROWS - 1, Math.max(r0, r1));
    for (let r = minR; r <= maxR; r++) {
      for (let c = minC; c <= maxC; c++) {
        grid[r][c] = true;
      }
    }
  };

  // 1. North Atrium Ring Corridor & Boss ToanLBK Patrol Loop
  markSegmentWalkable(10, 4, 21, 4);
  markSegmentWalkable(12, 7, 28, 7); // Connects North Ring through CỬA RA VÀO into Khoang NHÀ THUỐC
  markSegmentWalkable(12, 9, 20, 9);
  markSegmentWalkable(10, 4, 12, 9);
  markSegmentWalkable(20, 4, 20, 28); // Main Central Spine Corridor

  // 1B. West-Central Atrium Ring Corridor & Boss doannt19 Patrol Loop
  markSegmentWalkable(18, 11, 28, 11);
  markSegmentWalkable(18, 18, 28, 18);
  markSegmentWalkable(18, 11, 20, 20);
  markSegmentWalkable(26, 11, 26, 18);

  // 2. Khoang NHÀ THUỐC (FT3.III2A.1) — 4 Vertical Aisles (28, 35, 43, 50) & 4 Horizontal Aisles (7, 14, 20, 26)
  markSegmentWalkable(28, 7, 50, 7);   // Lối đi ngang Bắc (CỬA RA VÀO)
  markSegmentWalkable(20, 14, 50, 14); // Lối đi ngang Giữa-Trên (Chữ NHÀ THUỐC)
  markSegmentWalkable(20, 20, 50, 20); // Lối đi ngang Giữa-Dưới (Giữa Hàng 2 & Hàng 3)
  markSegmentWalkable(20, 26, 50, 26); // Lối đi ngang Đáy (Dưới Hàng 3)

  markSegmentWalkable(28, 7, 28, 26);  // Lối đi dọc 1 (Biên Trái Cụm 1.1, 2.1, 3.1)
  markSegmentWalkable(35, 7, 35, 26);  // Lối đi dọc 2 (Giữa Cụm X.1 và Cụm X.2 — Cạnh bàn Đỏ DongNQ6)
  markSegmentWalkable(43, 7, 43, 26);  // Lối đi dọc 3 (Giữa Cụm X.2 và Cụm X.3)
  markSegmentWalkable(50, 7, 50, 26);  // Lối đi dọc 4 (Biên Phải Cụm 1.3, 2.3, 3.3 — Cạnh CỘT NHÀ)

  // 3. South Atrium Ring Corridor & Boss vanltb8 Patrol Loop
  markSegmentWalkable(15, 20, 24, 20);
  markSegmentWalkable(15, 26, 24, 26);
  markSegmentWalkable(15, 28, 24, 28);
  markSegmentWalkable(12, 29, 25, 29);
  markSegmentWalkable(15, 20, 15, 29);
  markSegmentWalkable(23, 20, 23, 29);

  // 4. Đánh dấu toàn bộ diện tích mặt bàn ghép 2x3 của cả 9 cụm bàn là vật cản (false)
  //    để không nhân vật nào đi xuyên qua giữa cụm 6 bàn
  for (const isl of NHA_THUOC_ISLANDS) {
    const minC = Math.max(0, Math.floor(isl.wx / OFFICE_TILE_SIZE));
    const maxC = Math.min(
      OFFICE_GRID_COLS - 1,
      Math.floor((isl.wx + isl.ww - 1) / OFFICE_TILE_SIZE)
    );
    const minR = Math.max(0, Math.floor(isl.wy / OFFICE_TILE_SIZE));
    const maxR = Math.min(
      OFFICE_GRID_ROWS - 1,
      Math.floor((isl.wy + isl.wh - 1) / OFFICE_TILE_SIZE)
    );
    for (let r = minR; r <= maxR; r++) {
      for (let c = minC; c <= maxC; c++) {
        grid[r][c] = false;
      }
    }
  }

  // 5. Đảm bảo tất cả điểm đứng giao nhận tài liệu (handoffGrid) ở hành lang sát hai bên cụm bàn luôn walkable
  for (const desk of DESK_POSITIONS) {
    grid[desk.handoffGrid.row][desk.handoffGrid.col] = true;
  }

  return grid;
}

const CACHED_RING_GRID = createWalkableGrid();

/**
 * Tìm lộ trình di chuyển ngắn nhất dọc theo các lối đi dọc & ngang giữa 9 cụm đảo bàn
 * trong Khoang NHÀ THUỐC (`FT3.III2A.1`) từ bàn A (`fromDeskId`) sang bàn B (`toDeskId`).
 */
export function computeCorridorPathBetweenDesks(
  fromDeskId: string,
  toDeskId: string
): Point2D[] {
  const fromDesk = DESK_BY_ID[fromDeskId];
  const toDesk = DESK_BY_ID[toDeskId];

  if (!fromDesk || !toDesk) {
    return [];
  }

  if (fromDeskId === toDeskId) {
    return [fromDesk.seatPosition, fromDesk.handoffPoint];
  }

  const start = fromDesk.handoffGrid;
  const goal = toDesk.handoffGrid;

  if (start.col === goal.col && start.row === goal.row) {
    return deduplicateConsecutivePoints([
      { ...fromDesk.seatPosition },
      { ...fromDesk.handoffPoint },
      { ...toDesk.seatPosition },
    ]);
  }

  // BFS trên lưới lối đi giữa 9 cụm đảo bàn (3x3 islands)
  const queue: GridCoord[] = [start];
  const parentMap = new Map<string, GridCoord | null>();
  const key = (c: number, r: number) => `${c},${r}`;
  parentMap.set(key(start.col, start.row), null);

  const dirs = [
    { dc: 1, dr: 0 },
    { dc: -1, dr: 0 },
    { dc: 0, dr: 1 },
    { dc: 0, dr: -1 },
  ];

  let found = false;
  while (queue.length > 0) {
    const curr = queue.shift()!;
    if (curr.col === goal.col && curr.row === goal.row) {
      found = true;
      break;
    }

    for (const { dc, dr } of dirs) {
      const nc = curr.col + dc;
      const nr = curr.row + dr;
      if (nc < 0 || nc >= OFFICE_GRID_COLS || nr < 0 || nr >= OFFICE_GRID_ROWS) {
        continue;
      }
      const nKey = key(nc, nr);
      if (parentMap.has(nKey)) continue;

      if (CACHED_RING_GRID[nr]?.[nc] || (nc === goal.col && nr === goal.row)) {
        parentMap.set(nKey, curr);
        queue.push({ col: nc, row: nr });
      }
    }
  }

  const waypoints: Point2D[] = [{ ...fromDesk.seatPosition }];

  if (found) {
    const gridChain: GridCoord[] = [];
    let curr: GridCoord | null | undefined = goal;
    while (curr) {
      gridChain.push(curr);
      curr = parentMap.get(key(curr.col, curr.row));
    }
    gridChain.reverse();

    // Chỉ giữ các điểm ngoặt góc (corner turns) để đường đi giữa các đảo bàn mượt tuyệt đối
    for (let i = 0; i < gridChain.length; i++) {
      if (i === 0 || i === gridChain.length - 1) {
        waypoints.push(gridToPixel(gridChain[i].col, gridChain[i].row));
      } else {
        const prev = gridChain[i - 1];
        const currPt = gridChain[i];
        const next = gridChain[i + 1];
        const d1c = currPt.col - prev.col;
        const d1r = currPt.row - prev.row;
        const d2c = next.col - currPt.col;
        const d2r = next.row - currPt.row;
        if (d1c !== d2c || d1r !== d2r) {
          waypoints.push(gridToPixel(currPt.col, currPt.row));
        }
      }
    }
  } else {
    // Fallback qua lối đi dọc col = 35 và lối đi ngang row = 14
    waypoints.push({ ...fromDesk.handoffPoint });
    waypoints.push(gridToPixel(start.col, 14));
    waypoints.push(gridToPixel(goal.col, 14));
    waypoints.push({ ...toDesk.handoffPoint });
  }

  return deduplicateConsecutivePoints(waypoints);
}

/** Loại bỏ các điểm trùng nhau liên tiếp trên đường đi */
function deduplicateConsecutivePoints(points: Point2D[]): Point2D[] {
  const result: Point2D[] = [];
  for (const pt of points) {
    const prev = result[result.length - 1];
    if (!prev || Math.hypot(pt.x - prev.x, pt.y - prev.y) > 2) {
      result.push(pt);
    }
  }
  return result;
}

/** Cấu trúc tổng hợp toàn bộ Layout văn phòng để dễ dàng import một lần */
export const OFFICE_LAYOUT = {
  canvasWidth: OFFICE_CANVAS_WIDTH,
  canvasHeight: OFFICE_CANVAS_HEIGHT,
  tileSize: OFFICE_TILE_SIZE,
  cols: OFFICE_GRID_COLS,
  rows: OFFICE_GRID_ROWS,
  zones: OFFICE_ZONES,
  waypoints: OFFICE_WAYPOINTS,
  desks: DESK_POSITIONS,
  pmDesk: PM_DESK,
  buildingFootprint: BUILDING_FOOTPRINT_POLYGON,
  courtyards: COURTYARD_ATRIUMS,
  serviceCores: BUILDING_SERVICE_CORES,
  nhaThuocBay: NHA_THUOC_BAY_BOUNDS,
  nhaThuocIslands: NHA_THUOC_ISLANDS,
  nhaThuocSlots: NHA_THUOC_SEAT_SLOTS,
};
