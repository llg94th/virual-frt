/**
 * 2D Office Pathfinding & Spatial Navigation Engine
 *
 * Implements:
 * 1. Corridor-weighted A* (A-Star) pathfinding on the 48x30 office tile grid
 * 2. Waypoint graph routing (BFS/Dijkstra) along main office aisles
 * 3. Desk-to-Desk & Employee-to-Employee path builders (with right-hand lane offset
 *    so characters walking in opposite directions don't overlap)
 * 4. Smooth 60fps polyline interpolation & step-by-distance movement helpers
 */

import {
  DeskPosition,
  Direction,
  GridCoord,
  IsoDirection,
  Point2D,
  Waypoint,
} from '../types/office';
import {
  computeCorridorPathBetweenDesks,
  createWalkableGrid,
  DESK_BY_EMPLOYEE_ID,
  DESK_BY_ID,
  gridToPixel,
  HORIZONTAL_CORRIDOR_ROWS,
  OFFICE_GRID_COLS,
  OFFICE_GRID_ROWS,
  OFFICE_WAYPOINTS,
  pixelToGrid,
  PM_DESK,
  VERTICAL_CORRIDOR_COLS,
} from '../data/officeLayout';

export {
  computeCorridorPathBetweenDesks,
  createWalkableGrid,
  gridToPixel,
  pixelToGrid,
};

// Cached walkable matrix for fast A* queries
const WALKABLE_GRID: boolean[][] = createWalkableGrid();

const HORIZONTAL_ROW_SET = new Set<number>(HORIZONTAL_CORRIDOR_ROWS);
const VERTICAL_COL_SET = new Set<number>(VERTICAL_CORRIDOR_COLS);
const WAYPOINT_BY_ID: Record<string, Waypoint> = Object.fromEntries(
  OFFICE_WAYPOINTS.map((wp) => [wp.id, wp])
);

export interface PathResult {
  outboundPath: Point2D[];
  returnPath: Point2D[];
  totalDistance: number;
}

export interface StepAlongPathResult {
  position: Point2D;
  segmentIndex: number;
  facing: Direction;
  isoDirection: IsoDirection;
  facingAngle: number;
  reachedEnd: boolean;
  progress: number;
}

/**
 * Map 2D grid cardinal Direction ('RIGHT' | 'DOWN' | 'UP' | 'LEFT')
 * to 2.5D Isometric screen direction ('SE' | 'SW' | 'NE' | 'NW').
 * - RIGHT (+wx) -> SE (Down-Right / Front-Right 3/4 view)
 * - DOWN  (+wy) -> SW (Down-Left  / Front-Left 3/4 view)
 * - UP    (-wy) -> NE (Up-Right   / Back-Right 3/4 view)
 * - LEFT  (-wx) -> NW (Up-Left    / Back-Left 3/4 view)
 */
export function directionToIsoDirection(dir: Direction): IsoDirection {
  switch (dir) {
    case 'RIGHT':
      return 'SE';
    case 'DOWN':
      return 'SW';
    case 'UP':
      return 'NE';
    case 'LEFT':
      return 'NW';
    default:
      return 'SW';
  }
}

/**
 * Determine 2.5D Isometric screen direction ('SE' | 'SW' | 'NE' | 'NW')
 * from world point A to world point B.
 */
export function getIsoDirectionBetweenPoints(
  from: Point2D,
  to: Point2D,
  fallback: IsoDirection = 'SW'
): IsoDirection {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) < 0.35 && Math.abs(dy) < 0.35) {
    return fallback;
  }
  const dux = dx * 0.96;
  const duy = dy * 1.36;
  const dIsoX = (dux - duy) * 0.86;
  const dIsoY = (dux + duy) * 0.45;
  if (dIsoY >= 0) {
    return dIsoX >= 0 ? 'SE' : 'SW';
  }
  return dIsoX >= 0 ? 'NE' : 'NW';
}

/**
 * Compute continuous Isometric screen-space facing angle (in radians) from world point A to B.
 */
export function getIsoFacingAngleBetweenPoints(
  from: Point2D,
  to: Point2D,
  fallbackAngle = Math.PI * 0.75
): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) < 0.35 && Math.abs(dy) < 0.35) {
    return fallbackAngle;
  }
  const dux = dx * 0.96;
  const duy = dy * 1.36;
  const dIsoX = (dux - duy) * 0.86;
  const dIsoY = (dux + duy) * 0.45;
  return Math.atan2(dIsoY, dIsoX);
}

/**
 * Get canonical Isometric screen angle (radians) for an IsoDirection
 */
export function isoDirectionToAngle(isoDir: IsoDirection): number {
  switch (isoDir) {
    case 'SE':
      return Math.atan2(0.45, 0.86); // ~ +27.6 deg (Down-Right)
    case 'SW':
      return Math.atan2(0.45, -0.86); // ~ +152.4 deg (Down-Left)
    case 'NE':
      return Math.atan2(-0.45, 0.86); // ~ -27.6 deg (Up-Right)
    case 'NW':
      return Math.atan2(-0.45, -0.86); // ~ -152.4 deg (Up-Left)
  }
}

/**
 * Determine cardinal direction from point A to point B
 */
export function getDirectionBetweenPoints(
  from: Point2D,
  to: Point2D,
  fallback: Direction = 'DOWN'
): Direction {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) {
    return fallback;
  }
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? 'RIGHT' : 'LEFT';
  }
  return dy >= 0 ? 'DOWN' : 'UP';
}

/**
 * Calculate total Euclidean length of a polyline path in pixels
 */
export function calculatePathLength(path: Point2D[]): number {
  if (path.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < path.length; i++) {
    total += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y);
  }
  return total;
}

/**
 * Remove consecutive duplicate points and collinear intermediate points
 * so the character moves in clean straight corridor segments.
 */
export function simplifyOrthogonalPath(points: Point2D[]): Point2D[] {
  if (points.length <= 2) return points.map((p) => ({ ...p }));

  const deduped: Point2D[] = [];
  for (const pt of points) {
    const prev = deduped[deduped.length - 1];
    if (!prev || Math.hypot(pt.x - prev.x, pt.y - prev.y) > 1.5) {
      deduped.push({ ...pt });
    }
  }

  if (deduped.length <= 2) return deduped;

  const simplified: Point2D[] = [deduped[0]];
  for (let i = 1; i < deduped.length - 1; i++) {
    const prev = simplified[simplified.length - 1];
    const curr = deduped[i];
    const next = deduped[i + 1];

    const dx1 = curr.x - prev.x;
    const dy1 = curr.y - prev.y;
    const dx2 = next.x - curr.x;
    const dy2 = next.y - curr.y;

    const len1 = Math.hypot(dx1, dy1);
    const len2 = Math.hypot(dx2, dy2);
    if (len1 > 0 && len2 > 0) {
      const cross = Math.abs((dx1 * dy2 - dy1 * dx2) / (len1 * len2));
      const dot = (dx1 * dx2 + dy1 * dy2) / (len1 * len2);
      // Collinear in the same direction -> skip middle point
      if (cross < 0.02 && dot > 0.98) {
        continue;
      }
    }
    simplified.push(curr);
  }
  simplified.push(deduped[deduped.length - 1]);
  return simplified;
}

/**
 * Apply right-hand traffic lane offset to corridor segments so two employees
 * walking in opposite directions on the same corridor don't overlap visually.
 * Keeps start and end seat/handoff points exact.
 */
export function applyRightHandLaneOffset(
  path: Point2D[],
  laneOffsetPx = 5
): Point2D[] {
  if (path.length <= 2 || laneOffsetPx === 0) {
    return path.map((p) => ({ ...p }));
  }

  return path.map((pt, idx) => {
    // Keep seat positions (first and last point) anchored
    if (idx === 0 || idx === path.length - 1) {
      return { ...pt };
    }

    const prev = path[idx - 1];
    const next = path[Math.min(path.length - 1, idx + 1)];
    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    const len = Math.hypot(dx, dy);

    if (len < 1) return { ...pt };

    // Right-hand normal vector in screen coordinates (x right, y down):
    // Forward = (dx/len, dy/len) => Right-hand normal = (-dy/len, dx/len)
    const nx = (-dy / len) * laneOffsetPx;
    const ny = (dx / len) * laneOffsetPx;

    return {
      x: Math.round((pt.x + nx) * 10) / 10,
      y: Math.round((pt.y + ny) * 10) / 10,
    };
  });
}

// ============================================================================
// 1. CORRIDOR-WEIGHTED A* (A-STAR) GRID PATHFINDING
// ============================================================================

interface AStarNode {
  col: number;
  row: number;
  g: number;
  f: number;
  parent: AStarNode | null;
}

function gridKey(col: number, row: number): number {
  return row * OFFICE_GRID_COLS + col;
}

function isCorridorTile(col: number, row: number): boolean {
  return HORIZONTAL_ROW_SET.has(row) || VERTICAL_COL_SET.has(col);
}

/**
 * Find shortest walkable grid path from startGrid to endGrid using A* algorithm.
 * Strongly prefers official horizontal and vertical office corridors so characters
 * never cut across desks.
 */
export function findGridPathAStar(
  startGrid: GridCoord,
  endGrid: GridCoord,
  walkableGrid: boolean[][] = WALKABLE_GRID
): GridCoord[] {
  const sc = Math.max(0, Math.min(OFFICE_GRID_COLS - 1, startGrid.col));
  const sr = Math.max(0, Math.min(OFFICE_GRID_ROWS - 1, startGrid.row));
  const ec = Math.max(0, Math.min(OFFICE_GRID_COLS - 1, endGrid.col));
  const er = Math.max(0, Math.min(OFFICE_GRID_ROWS - 1, endGrid.row));

  if (sc === ec && sr === er) {
    return [{ col: sc, row: sr }];
  }

  const openList: AStarNode[] = [];
  const bestG = new Map<number, number>();
  const closed = new Set<number>();

  const heuristic = (c: number, r: number): number =>
    (Math.abs(c - ec) + Math.abs(r - er)) * 0.85;

  const startNode: AStarNode = {
    col: sc,
    row: sr,
    g: 0,
    f: heuristic(sc, sr),
    parent: null,
  };

  openList.push(startNode);
  bestG.set(gridKey(sc, sr), 0);

  const dirs = [
    { dc: 1, dr: 0 },
    { dc: -1, dr: 0 },
    { dc: 0, dr: 1 },
    { dc: 0, dr: -1 },
  ];

  while (openList.length > 0) {
    // Pop node with lowest f score
    let bestIdx = 0;
    for (let i = 1; i < openList.length; i++) {
      if (openList[i].f < openList[bestIdx].f) {
        bestIdx = i;
      }
    }
    const current = openList.splice(bestIdx, 1)[0];
    const currentKey = gridKey(current.col, current.row);

    if (current.col === ec && current.row === er) {
      const result: GridCoord[] = [];
      let curr: AStarNode | null = current;
      while (curr) {
        result.push({ col: curr.col, row: curr.row });
        curr = curr.parent;
      }
      return result.reverse();
    }

    if (closed.has(currentKey)) continue;
    closed.add(currentKey);

    for (const { dc, dr } of dirs) {
      const nc = current.col + dc;
      const nr = current.row + dr;

      if (nc < 0 || nc >= OFFICE_GRID_COLS || nr < 0 || nr >= OFFICE_GRID_ROWS) {
        continue;
      }

      const nKey = gridKey(nc, nr);
      if (closed.has(nKey)) continue;

      const isGoal = nc === ec && nr === er;
      const isStart = nc === sc && nr === sr;
      const walkable = walkableGrid[nr]?.[nc] ?? false;

      if (!walkable && !isGoal && !isStart) {
        continue;
      }

      // Prefer main corridors (cost 0.85) over non-corridor tiles (cost 2.2)
      let stepCost = isCorridorTile(nc, nr) ? 0.85 : 2.2;

      // Small turn penalty to keep paths straight and clean
      if (current.parent) {
        const prevDc = current.col - current.parent.col;
        const prevDr = current.row - current.parent.row;
        if (prevDc !== dc || prevDr !== dr) {
          stepCost += 0.25;
        }
      }

      const tentativeG = current.g + stepCost;
      const existingG = bestG.get(nKey);

      if (existingG === undefined || tentativeG < existingG) {
        bestG.set(nKey, tentativeG);
        openList.push({
          col: nc,
          row: nr,
          g: tentativeG,
          f: tentativeG + heuristic(nc, nr),
          parent: current,
        });
      }
    }
  }

  // Fallback to simple L-shaped corridor if unreachable
  return [
    { col: sc, row: sr },
    { col: ec, row: er },
  ];
}

// ============================================================================
// 2. WAYPOINT GRAPH BFS ROUTING
// ============================================================================

/**
 * Find shortest sequence of connected corridor Waypoints between two Waypoint IDs.
 */
export function findWaypointRoute(
  startWaypointId: string,
  endWaypointId: string
): Waypoint[] {
  const startWp = WAYPOINT_BY_ID[startWaypointId];
  const endWp = WAYPOINT_BY_ID[endWaypointId];
  if (!startWp || !endWp) return [];
  if (startWaypointId === endWaypointId) return [startWp];

  const queue: string[][] = [[startWaypointId]];
  const visited = new Set<string>([startWaypointId]);

  while (queue.length > 0) {
    const pathIds = queue.shift()!;
    const lastId = pathIds[pathIds.length - 1];
    if (lastId === endWaypointId) {
      return pathIds.map((id) => WAYPOINT_BY_ID[id]).filter(Boolean);
    }

    const wp = WAYPOINT_BY_ID[lastId];
    if (!wp) continue;

    for (const neighborId of wp.connectedTo) {
      if (!visited.has(neighborId)) {
        visited.add(neighborId);
        queue.push([...pathIds, neighborId]);
      }
    }
  }

  return [startWp, endWp];
}

// ============================================================================
// 3. HIGH-LEVEL DESK-TO-DESK & EMPLOYEE-TO-EMPLOYEE PATH BUILDERS
// ============================================================================

/**
 * Compute complete outbound and return paths between two desks (`fromDeskId` -> `toDeskId`).
 * - Outbound starts at `fromDesk.seatPosition`, steps out to `fromDesk.handoffPoint`,
 *   travels along the optimal office corridors via A* / Corridor Routing to `toDesk.handoffPoint`.
 * - Return path starts at `toDesk.handoffPoint`, travels back along corridors to
 *   `fromDesk.handoffPoint`, and steps back into `fromDesk.seatPosition`.
 */
export function findDeskToDeskPath(
  fromDeskId: string,
  toDeskId: string,
  options?: {
    laneOffset?: number;
    useAStar?: boolean;
  }
): PathResult {
  const fromDesk: DeskPosition | undefined = DESK_BY_ID[fromDeskId];
  const toDesk: DeskPosition | undefined = DESK_BY_ID[toDeskId];

  if (!fromDesk || !toDesk) {
    return { outboundPath: [], returnPath: [], totalDistance: 0 };
  }

  if (fromDeskId === toDeskId) {
    const miniOut = [{ ...fromDesk.seatPosition }, { ...fromDesk.handoffPoint }];
    const miniRet = [{ ...fromDesk.handoffPoint }, { ...fromDesk.seatPosition }];
    return {
      outboundPath: miniOut,
      returnPath: miniRet,
      totalDistance: calculatePathLength(miniOut),
    };
  }

  let baseOutbound: Point2D[];

  if (options?.useAStar) {
    const gridSteps = findGridPathAStar(fromDesk.handoffGrid, toDesk.handoffGrid);
    const corridorPixels = gridSteps.map((g) => gridToPixel(g.col, g.row));
    baseOutbound = simplifyOrthogonalPath([
      { ...fromDesk.seatPosition },
      ...corridorPixels,
    ]);
  } else {
    // Corridor routing is super clean and guaranteed orthogonal along main aisles
    const rawCorridor = computeCorridorPathBetweenDesks(fromDeskId, toDeskId);
    baseOutbound = simplifyOrthogonalPath(rawCorridor);
  }

  const baseReturn = simplifyOrthogonalPath([...baseOutbound].reverse());

  const laneOffset = options?.laneOffset ?? 4;
  const outboundPath = applyRightHandLaneOffset(baseOutbound, laneOffset);
  const returnPath = applyRightHandLaneOffset(baseReturn, laneOffset);

  return {
    outboundPath,
    returnPath,
    totalDistance: calculatePathLength(outboundPath),
  };
}

/**
 * Compute outbound & return paths between two Employees (`EMP-01` .. `EMP-30`).
 */
export function findEmployeeToEmployeePath(
  fromEmployeeId: string,
  toEmployeeId: string,
  options?: { laneOffset?: number; useAStar?: boolean }
): PathResult {
  const fromDesk = DESK_BY_EMPLOYEE_ID[fromEmployeeId];
  const toDesk = DESK_BY_EMPLOYEE_ID[toEmployeeId] ?? PM_DESK;

  if (!fromDesk || !toDesk) {
    return { outboundPath: [], returnPath: [], totalDistance: 0 };
  }

  return findDeskToDeskPath(fromDesk.id, toDesk.id, options);
}

/**
 * Compute path from an employee's current arbitrary position on the canvas back to their own desk seat.
 */
export function findPathBackToSeat(
  currentPosition: Point2D,
  employeeId: string
): Point2D[] {
  const desk = DESK_BY_EMPLOYEE_ID[employeeId];
  if (!desk) return [{ ...currentPosition }];

  const distToSeat = Math.hypot(
    currentPosition.x - desk.seatPosition.x,
    currentPosition.y - desk.seatPosition.y
  );
  if (distToSeat <= 6) {
    return [{ ...desk.seatPosition }];
  }

  const startGrid = pixelToGrid(currentPosition.x, currentPosition.y);
  const gridSteps = findGridPathAStar(startGrid, desk.handoffGrid);
  const corridorPixels = gridSteps.map((g) => gridToPixel(g.col, g.row));

  return simplifyOrthogonalPath([
    { ...currentPosition },
    ...corridorPixels,
    { ...desk.handoffPoint },
    { ...desk.seatPosition },
  ]);
}

// ============================================================================
// 4. 60FPS PATH INTERPOLATION & STEP MOVEMENT HELPERS
// ============================================================================

/**
 * Sample a point, facing direction, and active segment index along a polyline path
 * at normalized progress `t` in `[0, 1]`.
 */
export function interpolateAlongPath(
  path: Point2D[],
  progress: number,
  defaultFacing: Direction = 'DOWN'
): { position: Point2D; facing: Direction; segmentIndex: number } {
  if (path.length === 0) {
    return { position: { x: 0, y: 0 }, facing: defaultFacing, segmentIndex: 0 };
  }
  if (path.length === 1 || progress <= 0) {
    const facing =
      path.length > 1
        ? getDirectionBetweenPoints(path[0], path[1], defaultFacing)
        : defaultFacing;
    return { position: { ...path[0] }, facing, segmentIndex: 0 };
  }

  const clamped = Math.max(0, Math.min(1, progress));
  const segmentLengths: number[] = [];
  let totalLength = 0;

  for (let i = 0; i < path.length - 1; i++) {
    const segLen = Math.hypot(
      path[i + 1].x - path[i].x,
      path[i + 1].y - path[i].y
    );
    segmentLengths.push(segLen);
    totalLength += segLen;
  }

  if (totalLength <= 0.001 || clamped >= 1) {
    const lastIdx = path.length - 1;
    const facing = getDirectionBetweenPoints(
      path[lastIdx - 1],
      path[lastIdx],
      defaultFacing
    );
    return {
      position: { ...path[lastIdx] },
      facing,
      segmentIndex: Math.max(0, lastIdx - 1),
    };
  }

  const targetDist = clamped * totalLength;
  let accumulated = 0;

  for (let i = 0; i < segmentLengths.length; i++) {
    const segLen = segmentLengths[i];
    if (accumulated + segLen >= targetDist || i === segmentLengths.length - 1) {
      const localT = segLen > 0 ? (targetDist - accumulated) / segLen : 1;
      const p0 = path[i];
      const p1 = path[i + 1];
      return {
        position: {
          x: p0.x + (p1.x - p0.x) * localT,
          y: p0.y + (p1.y - p0.y) * localT,
        },
        facing: getDirectionBetweenPoints(p0, p1, defaultFacing),
        segmentIndex: i,
      };
    }
    accumulated += segLen;
  }

  const last = path[path.length - 1];
  return {
    position: { ...last },
    facing: defaultFacing,
    segmentIndex: Math.max(0, path.length - 2),
  };
}

/**
 * Advance a character along `path` from `currentPos` (at `currentSegmentIndex`)
 * by `stepDistance` pixels. Handles multi-segment corners smoothly within a single frame.
 */
export function stepAlongPath(
  currentPos: Point2D,
  path: Point2D[],
  currentSegmentIndex: number,
  stepDistance: number,
  defaultFacing: Direction = 'DOWN'
): StepAlongPathResult {
  const defaultIso = directionToIsoDirection(defaultFacing);
  const defaultAngle = isoDirectionToAngle(defaultIso);

  if (path.length === 0) {
    return {
      position: { ...currentPos },
      segmentIndex: 0,
      facing: defaultFacing,
      isoDirection: defaultIso,
      facingAngle: defaultAngle,
      reachedEnd: true,
      progress: 1,
    };
  }

  if (path.length === 1) {
    return {
      position: { ...path[0] },
      segmentIndex: 0,
      facing: defaultFacing,
      isoDirection: defaultIso,
      facingAngle: defaultAngle,
      reachedEnd: true,
      progress: 1,
    };
  }

  let segIdx = Math.max(0, Math.min(path.length - 2, currentSegmentIndex));
  let pos = { ...currentPos };
  let remainingStep = Math.max(0, stepDistance);
  let facing = defaultFacing;
  let isoDirection: IsoDirection = defaultIso;
  let facingAngle = defaultAngle;

  while (remainingStep > 0 && segIdx < path.length - 1) {
    const segStart = path[segIdx];
    const target = path[segIdx + 1];
    const dx = target.x - pos.x;
    const dy = target.y - pos.y;
    const distToTarget = Math.hypot(dx, dy);

    if (distToTarget > 0.05) {
      facing = getDirectionBetweenPoints(pos, target, facing);
      isoDirection = getIsoDirectionBetweenPoints(segStart, target, isoDirection);
      facingAngle = getIsoFacingAngleBetweenPoints(segStart, target, facingAngle);
    }

    if (distToTarget <= remainingStep) {
      pos = { ...target };
      remainingStep -= distToTarget;
      if (segIdx < path.length - 2) {
        segIdx += 1;
      } else {
        // Reached the final point on the path
        remainingStep = 0;
        break;
      }
    } else {
      const ratio = remainingStep / distToTarget;
      pos = {
        x: pos.x + dx * ratio,
        y: pos.y + dy * ratio,
      };
      remainingStep = 0;
    }
  }

  // Compute overall progress along the path (0..1)
  const totalLen = calculatePathLength(path);
  let traveledLen = 0;
  for (let i = 0; i < segIdx; i++) {
    traveledLen += Math.hypot(
      path[i + 1].x - path[i].x,
      path[i + 1].y - path[i].y
    );
  }
  traveledLen += Math.hypot(pos.x - path[segIdx].x, pos.y - path[segIdx].y);

  const progress =
    totalLen > 0 ? Math.max(0, Math.min(1, traveledLen / totalLen)) : 1;
  const finalTarget = path[path.length - 1];
  const reachedEnd =
    segIdx >= path.length - 2 &&
    Math.hypot(pos.x - finalTarget.x, pos.y - finalTarget.y) <= 1.5;

  return {
    position: reachedEnd ? { ...finalTarget } : pos,
    segmentIndex: segIdx,
    facing,
    isoDirection,
    facingAngle,
    reachedEnd,
    progress: reachedEnd ? 1 : progress,
  };
}
