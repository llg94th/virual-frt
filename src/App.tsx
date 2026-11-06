import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
  OfficeSimulationProvider,
  useOfficeSimulation,
} from './engine/simulationStore';
import { OfficeCanvas2D } from './components/OfficeCanvas2D';
import { JiraControlPanel } from './components/JiraControlPanel';
import { LiveActivityFeed } from './components/LiveActivityFeed';
import { AssigneeHistoryOverlay } from './components/AssigneeHistoryOverlay';
import { EMPLOYEE_BY_ID, ROLE_METADATA } from './data/employees';
import { Role } from './types/office';

interface FleziZoneFilterItem {
  num: string;
  code: string;
  label: string;
  role: Role;
  badgeBg: string;
  activeBorder: string;
}

const FLEZI_ZONE_FILTERS: FleziZoneFilterItem[] = [
  {
    num: '01',
    code: 'PM',
    label: '01 PM',
    role: 'PM',
    badgeBg: '#c2410c',
    activeBorder: 'border-orange-600 ring-2 ring-orange-500/30',
  },
  {
    num: '02',
    code: 'BA',
    label: '02 BA',
    role: 'BA',
    badgeBg: '#b45309',
    activeBorder: 'border-amber-600 ring-2 ring-amber-500/30',
  },
  {
    num: '03',
    code: 'LEAD',
    label: '03 LEAD',
    role: 'TECH_LEAD',
    badgeBg: '#6d28d9',
    activeBorder: 'border-purple-600 ring-2 ring-purple-500/30',
  },
  {
    num: '04',
    code: 'BE',
    label: '04 BE',
    role: 'BACKEND',
    badgeBg: '#1d4ed8',
    activeBorder: 'border-blue-600 ring-2 ring-blue-500/30',
  },
  {
    num: '05',
    code: 'FE',
    label: '05 FE',
    role: 'FRONTEND',
    badgeBg: '#15803d',
    activeBorder: 'border-emerald-600 ring-2 ring-emerald-500/30',
  },
  {
    num: '06',
    code: 'MOBILE',
    label: '06 MOBILE',
    role: 'MOBILE',
    badgeBg: '#be185d',
    activeBorder: 'border-pink-600 ring-2 ring-pink-500/30',
  },
  {
    num: '07',
    code: 'QA',
    label: '07 QA',
    role: 'QA',
    badgeBg: '#ea580c',
    activeBorder: 'border-orange-600 ring-2 ring-orange-500/30',
  },
  {
    num: '08',
    code: 'DEVOPS',
    label: '08 DEVOPS',
    role: 'DEVOPS',
    badgeBg: '#0e7490',
    activeBorder: 'border-cyan-600 ring-2 ring-cyan-500/30',
  },
];

const VirtualFrtOfficeWorkspace: React.FC = () => {
  const sim = useOfficeSimulation();
  const [showIntegrationSettings, setShowIntegrationSettings] = useState(false);

  // Floating Collapsible Drawers state
  const [isJiraDrawerOpen, setIsJiraDrawerOpen] = useState(false);
  const [isFeedDrawerOpen, setIsFeedDrawerOpen] = useState(false);

  // Selected Flezimercuria Zone Filter (01 PM .. 08 DEVOPS)
  const [activeZoneRole, setActiveZoneRole] = useState<Role | 'ALL'>('ALL');
  const [zoneCycleIndex, setZoneCycleIndex] = useState<number>(0);
  const [focusBaySignal, setFocusBaySignal] = useState<number>(0);
  const [focusManagerSignal, setFocusManagerSignal] = useState<number>(0);
  const [focusJenkinsSignal, setFocusJenkinsSignal] = useState<number>(0);

  // Clean HUD Toggle (`isHudHidden`, shortcut `H`) & Fullscreen (`F`)
  // Mặc định ẩn chế độ Advance nhiều hub tùy chỉnh (`isHudHidden = true`)
  const [isHudHidden, setIsHudHidden] = useState<boolean>(true);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);

  const toggleHud = useCallback(() => {
    setIsHudHidden((prev) => !prev);
  }, []);

  const toggleFullscreen = useCallback(async () => {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
        setIsFullscreen(true);
      } else {
        await document.exitFullscreen();
        setIsFullscreen(false);
      }
    } catch {
      // Fallback state toggle if browser blocks fullscreen API
      setIsFullscreen((prev) => !prev);
    }
  }, []);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }
      if (e.key === 'h' || e.key === 'H') {
        e.preventDefault();
        toggleHud();
      } else if (e.key === 'f' || e.key === 'F') {
        e.preventDefault();
        void toggleFullscreen();
      }
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [toggleHud, toggleFullscreen]);

  const employeesInActiveZone = useMemo(() => {
    if (activeZoneRole === 'ALL') return [];
    return sim.employees.filter((emp) => emp.role === activeZoneRole);
  }, [sim.employees, activeZoneRole]);

  const handleSelectZoneFilter = (role: Role | 'ALL') => {
    if (role === 'ALL') {
      setActiveZoneRole('ALL');
      setZoneCycleIndex(0);
      sim.selectEmployee(null);
      return;
    }

    const zoneStaff = sim.employees.filter((emp) => emp.role === role);
    if (zoneStaff.length === 0) return;

    if (activeZoneRole === role) {
      const nextIdx = (zoneCycleIndex + 1) % zoneStaff.length;
      setZoneCycleIndex(nextIdx);
      sim.selectEmployee(zoneStaff[nextIdx].id);
    } else {
      setActiveZoneRole(role);
      setZoneCycleIndex(0);
      // Prefer an employee in this zone who is currently walking/carrying docs, else the first employee
      const activeWalker = zoneStaff.find(
        (e) =>
          e.status === 'CARRYING_DOCS' ||
          e.status === 'HANDOFF' ||
          e.status === 'WALKING_BACK'
      );
      sim.selectEmployee((activeWalker ?? zoneStaff[0]).id);
    }
  };

  const latestLog = sim.activityLogs[0] ?? null;
  const primaryTransfer = sim.activeTransfers[0] ?? null;

  return (
    <div className="relative w-screen h-screen bg-[#f4f6fa] text-slate-900 overflow-hidden select-none">
      <AssigneeHistoryOverlay />
      {/* ====================================================================
          1. FULL-BLEED 2.5D ISOMETRIC OFFICE CANVAS STAGE (100VW x 100VH)
      ==================================================================== */}
      <main className="flezi-fullbleed-stage absolute inset-0 w-full h-full z-0">
        <OfficeCanvas2D
          className="w-full h-full"
          employees={sim.employees}
          tickets={sim.tickets}
          activeTransfers={sim.activeTransfers}
          config={sim.config}
          isSprintRush={sim.isSprintRush}
          selectedEmployeeId={sim.selectedEmployeeId}
          selectedTicketId={sim.selectedTicketId}
          onSelectEmployee={(emp) => {
            sim.selectEmployee(emp ? emp.id : null);
            if (!emp) setActiveZoneRole('ALL');
          }}
          onSelectTicket={(ticket) => sim.selectTicket(ticket ? ticket.id : null)}
          onAdvanceTicket={(ticketId) => {
            void sim.advanceTicket(ticketId);
          }}
          onManualTransfer={(ticketId, fromId, toId, nextStatus) => {
            void sim.manualTransfer(ticketId, fromId, toId, nextStatus);
          }}
          onReturnToPM={(ticketId) => {
            void sim.completeTicketToPM(ticketId);
          }}
          onUpdateConfig={(patch) => sim.updateConfig(patch)}
          focusBaySignal={focusBaySignal}
          focusManagerSignal={focusManagerSignal}
          focusJenkinsSignal={focusJenkinsSignal}
          activeJenkinsBuild={sim.activeJenkinsBuild}
          jenkinsBuilds={sim.jenkinsBuilds}
          jenkinsLastCompletedAt={sim.jenkinsLastCompletedAt}
          isJenkinsBrokenAlert={sim.isJenkinsBrokenAlert}
          brokenBuildNumber={sim.brokenBuildNumber}
          jenkinsHotfixCelebrationAt={sim.jenkinsHotfixCelebrationAt}
          onTriggerJenkinsBuild={() => sim.triggerJenkinsBuild()}
          onTriggerUatBuild={() => sim.triggerJenkinsBuild({ jobName: 'oneclickv4-build-uat' })}
          onTriggerJenkinsBrokenHotfix={() => sim.triggerJenkinsBrokenHotfix()}
          onResetNewDay={() => sim.resetNewDayEmptyDesks()}
          onTriggerTestFullSeatsSmoking={() => sim.triggerTestFullSeatsSmoking()}
          checkedInCount={sim.checkedInCount}
          smokingCount={sim.smokingCount}
          mvpLeaderboard={sim.mvpLeaderboard}
          islandHeatmap={sim.islandHeatmap}
          isHudHidden={isHudHidden}
          onToggleHud={toggleHud}
          isFullscreen={isFullscreen}
          onToggleFullscreen={() => {
            void toggleFullscreen();
          }}
          dataSourceMode={sim.dataSourceMode}
          onSetDataSourceMode={(mode) => sim.setDataSourceMode(mode)}
        />
      </main>

      {/* ====================================================================
          2. TOP FLOATING PILL BAR (FLEZIMERCURIA STYLE OVERLAY HUD)
             Anchored top-left so Top-Right Camera Director HUD stays clear.
             Hidden when `isHudHidden` is true (OfficeCanvas2D renders the Mini Floating Pill).
      ==================================================================== */}
      {!isHudHidden && (
      <header className="fixed top-3 left-3 z-30 flex flex-col items-start gap-2 max-w-[calc(100vw-24px)] lg:max-w-[calc(100vw-455px)] pointer-events-none">
        {/* Row 1: 2-Mode Switch (Thật vs Mock) + Status Pill + Quick Simulation Controls */}
        <div className="flex flex-wrap items-center gap-2 pointer-events-auto">
          {/* Công tắc 2 Chế Độ: Thật (LIVE) vs Mock (Không cho user tự set credential) */}
          <div className="flezi-glass-dark rounded-full p-1 flex items-center gap-1 border border-slate-700/80 shadow-lg">
            <button
              type="button"
              onClick={() => sim.setDataSourceMode('LIVE_FRT')}
              className={`px-3 py-1 rounded-full text-xs font-extrabold transition flex items-center gap-1.5 ${
                sim.dataSourceMode === 'LIVE_FRT'
                  ? 'bg-emerald-500 text-slate-950 shadow-sm shadow-emerald-500/40'
                  : 'text-slate-300 hover:text-white'
              }`}
              title="Chế độ Dữ liệu Thật từ Server Proxy (Jira & Jenkins)"
            >
              <span>🟢 Chế độ Thật (LIVE)</span>
            </button>
            <button
              type="button"
              onClick={() => sim.setDataSourceMode('MOCK_PILOT')}
              className={`px-3 py-1 rounded-full text-xs font-extrabold transition flex items-center gap-1.5 ${
                sim.dataSourceMode === 'MOCK_PILOT'
                  ? 'bg-amber-500 text-slate-950 shadow-sm shadow-amber-500/40'
                  : 'text-slate-300 hover:text-white'
              }`}
              title="Chế độ Giả lập (Mock Pilot)"
            >
              <span>🧪 Chế độ Mock</span>
            </button>
          </div>

          {/* Signature Flezimercuria Status Pill */}
          <div className="flezi-glass-dark rounded-full px-3.5 py-1.5 flex items-center gap-2.5 text-slate-100">
            <div
              className={`w-6 h-6 rounded-full flex items-center justify-center font-black text-[10px] text-white shadow-sm shrink-0 ${
                sim.dataSourceMode === 'LIVE_FRT'
                  ? 'bg-gradient-to-br from-emerald-500 to-teal-600'
                  : 'bg-gradient-to-br from-orange-500 to-amber-600'
              }`}
            >
              FRT
            </div>

            <div className="flex items-center gap-2 font-mono text-[11px] tracking-widest uppercase">
              <span className="relative flex h-2.5 w-2.5 shrink-0">
                <span
                  className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                    sim.dataSourceMode === 'LIVE_FRT' ? 'bg-emerald-400' : 'bg-orange-400'
                  }`}
                />
                <span
                  className={`relative inline-flex rounded-full h-2.5 w-2.5 ${
                    sim.dataSourceMode === 'LIVE_FRT' ? 'bg-emerald-500' : 'bg-orange-500'
                  }`}
                />
              </span>
              <span className="font-extrabold text-white">
                {sim.dataSourceMode === 'LIVE_FRT' ? '🟢 LIVE REAL' : '🟠 MOCK PILOT'}
              </span>
              <span className="text-slate-500">·</span>
              <span className="text-slate-200 font-semibold hidden sm:inline">
                {sim.dataSourceMode === 'LIVE_FRT'
                  ? 'REQS.FRT.VN & JENKINS'
                  : 'DEMO SIMULATION'}
              </span>
              <span className="text-slate-500 hidden sm:inline">·</span>
              <span className="text-amber-300 font-bold">30 ENGINEERING STAFF</span>
            </div>

            <div className="hidden xl:flex items-center gap-1.5 pl-2 border-l border-slate-700/80 text-[11px] font-mono">
              <span
                className="px-2 py-0.5 rounded-full bg-orange-500/20 text-orange-300 border border-orange-500/30 font-bold"
                title="Số nhân viên đang đi bộ giao chồng tài liệu"
              >
                🚶 {sim.stats.walkingEmployeesCount} BÀN GIAO
              </span>
              <span
                className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-bold"
                title="Số Ticket đã hoàn thành và mang hồ sơ về bàn PM Quân"
              >
                👑 {sim.stats.doneCount} DONE VỀ PM
              </span>
            </div>
          </div>

          {/* Floating Quick Action Controls Pill (Speed 1x/2x/4x, Sprint Rush, Create Ticket, Jira Webhook) */}
          <div className="flezi-glass-dark rounded-full px-2.5 py-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-100">
            {/* Play / Pause */}
            <button
              type="button"
              onClick={sim.toggleRunning}
              className={`px-2.5 py-1 rounded-full text-[11px] font-bold transition flex items-center gap-1 ${
                sim.config.isRunning
                  ? 'bg-slate-800/90 text-amber-300 hover:bg-slate-700 border border-slate-700'
                  : 'bg-emerald-600 text-white hover:bg-emerald-500'
              }`}
              title={sim.config.isRunning ? 'Tạm dừng mô phỏng' : 'Tiếp tục mô phỏng'}
            >
              {sim.config.isRunning ? '⏸ Pause' : '▶ Play'}
            </button>

            {/* Auto-Pilot Toggle */}
            <button
              type="button"
              onClick={sim.toggleAutoSimulate}
              className={`px-2.5 py-1 rounded-full text-[11px] font-bold border transition ${
                sim.config.autoSimulate && sim.dataSourceMode === 'MOCK_PILOT'
                  ? 'bg-emerald-500/20 border-emerald-400/50 text-emerald-300'
                  : 'bg-slate-800/80 border-slate-700 text-slate-400 hover:text-slate-200'
              }`}
              title="Bật/Tắt chế độ tự động luân chuyển Jira Ticket Mock"
            >
              🤖 Auto Mock {sim.config.autoSimulate && sim.dataSourceMode === 'MOCK_PILOT' ? 'ON' : 'OFF'}
            </button>

            {/* Quick Clear Mock Data */}
            <button
              type="button"
              onClick={() => sim.clearMockData()}
              className="px-2.5 py-1 rounded-full bg-rose-500/20 hover:bg-rose-500/30 text-rose-200 border border-rose-400/40 text-[11px] font-bold transition flex items-center gap-1"
              title="Xóa sạch toàn bộ dữ liệu Ticket/Log Mock hiện tại trên màn hình"
            >
              <span>🧹 Xóa Mock</span>
            </button>

            {/* Speed 1x / 2x / 4x */}
            <div className="flex items-center bg-slate-950/90 p-0.5 rounded-full border border-slate-800">
              {[1, 2, 4].map((spd) => {
                const active = sim.config.speedMultiplier === spd;
                return (
                  <button
                    key={spd}
                    type="button"
                    onClick={() => sim.setSpeedMultiplier(spd)}
                    className={`px-2 py-0.5 rounded-full text-[11px] font-mono font-extrabold transition ${
                      active
                        ? 'bg-orange-500 text-white shadow-sm'
                        : 'text-slate-400 hover:text-white'
                    }`}
                    title={`Tốc độ mô phỏng ${spd}x`}
                  >
                    {spd}x
                  </button>
                );
              })}
            </div>

            {/* Sprint Rush */}
            <button
              type="button"
              onClick={() => {
                void sim.toggleSprintRush();
              }}
              className={`px-2.5 py-1 rounded-full text-[11px] font-extrabold tracking-wide transition shadow-sm ${
                sim.isSprintRush
                  ? 'bg-gradient-to-r from-red-600 to-orange-500 text-white ring-2 ring-amber-300 animate-pulse'
                  : 'bg-gradient-to-r from-orange-600 to-amber-600 hover:from-orange-500 hover:to-amber-500 text-white'
              }`}
              title="Kích hoạt cao điểm Sprint Demo Rush"
            >
              🔥 Sprint Rush
            </button>

            {/* Quick Create Ticket */}
            <button
              type="button"
              onClick={() => {
                void sim.createRandomTicket();
              }}
              className="px-2.5 py-1 rounded-full bg-sky-600 hover:bg-sky-500 text-white text-[11px] font-bold transition shadow-sm flex items-center gap-1"
              title="Tạo nhanh 1 Jira Ticket mới từ Bàn PM Quân"
            >
              <span>＋ Tạo Ticket</span>
            </button>

            {/* Advance Next Step */}
            <button
              type="button"
              onClick={() => {
                void sim.advanceTicket();
              }}
              className="px-2.5 py-1 rounded-full bg-indigo-600 hover:bg-indigo-500 text-white text-[11px] font-bold transition shadow-sm hidden sm:inline-flex items-center gap-1"
              title="Đẩy nhanh bước bàn giao tài liệu tiếp theo"
            >
              <span>Bước tiếp ➔</span>
            </button>

            {/* Trigger Jenkins Build CI */}
            <button
              type="button"
              onClick={() => sim.triggerJenkinsBuild()}
              className="px-2.5 py-1 rounded-full bg-cyan-600 hover:bg-cyan-500 text-white text-[11px] font-bold transition shadow-sm flex items-center gap-1"
              title="Cử kỹ sư đi bộ tới Trạm Server Jenkins chạy build oneclickv4-build-ci"
            >
              <span>🚀 Build CI</span>
            </button>

            {/* Trigger Jenkins Build UAT (oneclickv4-build-uat) */}
            <button
              type="button"
              onClick={() => sim.triggerJenkinsBuild({ jobName: 'oneclickv4-build-uat' })}
              className="px-2.5 py-1 rounded-full bg-purple-600 hover:bg-purple-500 text-white text-[11px] font-bold transition shadow-sm flex items-center gap-1"
              title="Cử kỹ sư đi bộ tới Trạm Server UAT chạy build oneclickv4-build-uat"
            >
              <span>🟣 Build UAT</span>
            </button>

            {/* Reset New Day (100% Empty Desks) */}
            <button
              type="button"
              onClick={() => sim.resetNewDayEmptyDesks()}
              className="px-2.5 py-1 rounded-full bg-teal-600 hover:bg-teal-500 text-white text-[11px] font-bold transition shadow-sm flex items-center gap-1"
              title="Reset Ngày Mới — Toàn bộ bàn làm việc trống 100%, ai có event trước sẽ vào chiếm 1 chỗ ngồi"
            >
              <span>🌅 Reset Ngày Mới ({sim.checkedInCount} ngồi)</span>
            </button>

            {/* Test Full Seats -> Atrium Smoking */}
            <button
              type="button"
              onClick={() => sim.triggerTestFullSeatsSmoking()}
              className="px-2.5 py-1 rounded-full bg-amber-600 hover:bg-amber-500 text-white text-[11px] font-extrabold transition shadow-sm flex items-center gap-1"
              title="Giả lập Kịch bản Full Chỗ Ngồi — Thành viên có event sau sẽ tụ tập ở Giếng trời hút thuốc (🚬 💨)"
            >
              <span>🚬 Test Full Chỗ ({sim.smokingCount} hút thuốc)</span>
            </button>

            {/* Simulate Jenkins Build Broken / Hotfix Rescue */}
            <button
              type="button"
              onClick={() => sim.triggerJenkinsBrokenHotfix()}
              className={`px-2.5 py-1 rounded-full text-[11px] font-extrabold transition shadow-sm flex items-center gap-1 border ${
                sim.isJenkinsBrokenAlert
                  ? 'bg-red-600 text-yellow-200 border-yellow-300 animate-pulse'
                  : 'bg-red-700 hover:bg-red-600 text-white border-red-400'
              }`}
              title="Giả lập sự kiện Jenkins Build Broken #2843 & cử kỹ sư chạy nhanh (⚡ HOTFIX SPRINT) ra Trạm Server cứu build"
            >
              <span>🚨 Giả lập Build Broken / Hotfix</span>
            </button>

            {/* Island Activity Heatmap Toggle */}
            <button
              type="button"
              onClick={() =>
                sim.updateConfig({ showIslandHeatmap: !sim.config.showIslandHeatmap })
              }
              className={`px-2.5 py-1 rounded-full text-[11px] font-extrabold transition shadow-sm flex items-center gap-1 border ${
                sim.config.showIslandHeatmap
                  ? 'bg-amber-500 text-slate-950 border-amber-300'
                  : 'bg-slate-800/90 hover:bg-slate-700 text-amber-300 border-amber-500/40'
              }`}
              title="Bật/Tắt Bản Đồ Nhiệt 9 Cụm Bàn (Island Activity Heatmap) ngay trên mặt sàn Khoang Nhà Thuốc"
            >
              <span>🔥 Heatmap Cụm Bàn</span>
            </button>

            {/* Top MVP Podium Toggle */}
            <button
              type="button"
              onClick={() =>
                sim.updateConfig({ showMvpPodium: !sim.config.showMvpPodium })
              }
              className={`px-2.5 py-1 rounded-full text-[11px] font-extrabold transition shadow-sm flex items-center gap-1 border ${
                sim.config.showMvpPodium
                  ? 'bg-yellow-500 text-slate-950 border-yellow-300'
                  : 'bg-slate-800/90 hover:bg-slate-700 text-yellow-300 border-yellow-500/40'
              }`}
              title="Bật/Tắt Bảng Vinh Danh Top 3 Chiến Thần Giao Việc & Build CI"
            >
              <span>🏆 Top MVP</span>
            </button>

            {/* Hide HUD (`isHudHidden`, shortcut `H`) */}
            <button
              type="button"
              onClick={toggleHud}
              className="px-2.5 py-1 rounded-full bg-slate-800/90 hover:bg-slate-700 text-amber-300 border border-amber-500/40 text-[11px] font-bold transition flex items-center gap-1"
              title="Ẩn toàn bộ HUD, chỉ chừa Mini Floating Pill (Phím tắt: H)"
            >
              <span>👁️ Ẩn HUD (H)</span>
            </button>

            {/* Fullscreen Toggle (`F`) */}
            <button
              type="button"
              onClick={() => {
                void toggleFullscreen();
              }}
              className="px-2.5 py-1 rounded-full bg-slate-800/90 hover:bg-slate-700 text-sky-300 border border-sky-500/40 text-[11px] font-bold transition flex items-center gap-1"
              title="Bật/Tắt Toàn màn hình Fullscreen (Phím tắt: F)"
            >
              <span>⛶ {isFullscreen ? 'Thoát Full (F)' : 'Fullscreen (F)'}</span>
            </button>

            {/* Reset Simulation */}
            <button
              type="button"
              onClick={() => {
                setActiveZoneRole('ALL');
                sim.resetSimulation();
              }}
              className="px-2 py-1 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-semibold border border-slate-700 transition"
              title="Khởi tạo lại trạng thái mô phỏng ban đầu"
            >
              ↺
            </button>
          </div>
        </div>

        {/* Row 2: Flezimercuria Numbered Zone Filter Pills (01 PM .. 08 DEVOPS) + Focus NHÀ THUỐC + Layer Toggles */}
        <div className="flex flex-wrap items-center gap-1.5 pointer-events-auto">
          {/* 1-Click Focus Sếp Nữ ThuNDM */}
          <button
            type="button"
            onClick={() => setFocusManagerSignal((n) => n + 1)}
            className="rounded-xl px-3 py-1 flex items-center gap-1.5 text-[11px] font-extrabold bg-rose-600 hover:bg-rose-500 text-white border border-rose-400 shadow-md shadow-rose-600/30 transition-all hover:-translate-y-0.5"
            title="Bay thẳng tới Sếp Nữ ThuNDM đang đi vòng vòng thả tim khích lệ anh em"
          >
            <span>💖 Focus Sếp ThuNDM</span>
          </button>

          {/* 1-Click Focus Jenkins Server Station */}
          <button
            type="button"
            onClick={() => setFocusJenkinsSignal((n) => n + 1)}
            className="rounded-xl px-3 py-1 flex items-center gap-1.5 text-[11px] font-extrabold bg-cyan-600 hover:bg-cyan-500 text-white border border-cyan-400 shadow-md shadow-cyan-600/30 transition-all hover:-translate-y-0.5"
            title="1-Click Zoom Camera tới Trạm Máy Tính Server Jenkins CI (oneclickv4-build-ci)"
          >
            <span>🖥️ Focus Jenkins Server</span>
          </button>

          {/* 1-Click Focus Khoang NHÀ THUỐC (FT3.III2A.1) */}
          <button
            type="button"
            onClick={() => setFocusBaySignal((n) => n + 1)}
            className="rounded-xl px-3 py-1 flex items-center gap-1.5 text-[11px] font-extrabold bg-emerald-600 hover:bg-emerald-500 text-white border border-emerald-400 shadow-md shadow-emerald-600/30 transition-all hover:-translate-y-0.5"
            title="1-Click Zoom Camera thẳng vào Khoang NHÀ THUỐC (FT3.III2A.1 • 9 Cụm bàn • 54 Ô)"
          >
            <span>🏥 Focus Khoang NHÀ THUỐC (FT3.III2A.1)</span>
          </button>

          {/* All Zones (Overview) Pill */}
          <button
            type="button"
            onClick={() => handleSelectZoneFilter('ALL')}
            className={`flezi-glass-light rounded-xl px-2.5 py-1 flex items-center gap-1.5 text-[11px] font-extrabold transition-all ${
              activeZoneRole === 'ALL'
                ? 'border-orange-500 ring-2 ring-orange-500/25 text-slate-950 bg-white'
                : 'text-slate-700 hover:text-slate-950 hover:bg-white'
            }`}
            title="Xem toàn bộ 30 nhân sự & tự động bám theo sự kiện bàn giao"
          >
            <span className="px-1.5 py-0.5 rounded-md bg-slate-900 text-white font-mono text-[10px] font-black">
              ALL
            </span>
            <span>30 STAFF</span>
          </button>

          {/* 01 PM .. 08 DEVOPS Zone Callout Pills */}
          {FLEZI_ZONE_FILTERS.map((zf) => {
            const active = activeZoneRole === zf.role;
            const zoneEmps = sim.employees.filter((e) => e.role === zf.role);
            const walkingInZone = zoneEmps.filter(
              (e) =>
                e.status === 'CARRYING_DOCS' ||
                e.status === 'HANDOFF' ||
                e.status === 'WALKING_BACK'
            ).length;

            return (
              <button
                key={zf.num}
                type="button"
                onClick={() => handleSelectZoneFilter(zf.role)}
                className={`flezi-glass-light rounded-xl px-2 py-1 flex items-center gap-1.5 text-[11px] transition-all hover:-translate-y-0.5 ${
                  active
                    ? `${zf.activeBorder} bg-white text-slate-950 shadow-md`
                    : 'text-slate-800 hover:bg-white'
                }`}
                title={`Focus Camera vào phân khu ${zf.label} (${ROLE_METADATA[zf.role].label} — ${zoneEmps.length} nhân sự)`}
              >
                <span
                  className="w-5 h-5 rounded-md flex items-center justify-center font-mono text-[10px] font-black text-white shrink-0 shadow-sm"
                  style={{ backgroundColor: zf.badgeBg }}
                >
                  {zf.num}
                </span>
                <span className="font-extrabold tracking-tight text-slate-900">
                  {zf.code}
                </span>
                <span className="text-[10px] font-mono font-bold text-slate-500">
                  ({zoneEmps.length})
                </span>
                {walkingInZone > 0 && (
                  <span
                    className="w-2 h-2 rounded-full bg-orange-500 animate-ping"
                    title={`${walkingInZone} nhân sự đang di chuyển`}
                  />
                )}
              </button>
            );
          })}

          {/* Subtle Isometric Layer Toggles Pill */}
          <div className="flezi-glass-light rounded-xl px-1.5 py-1 hidden md:flex items-center gap-1 text-[10px] font-bold text-slate-700">
            <button
              type="button"
              onClick={() =>
                sim.updateConfig({ showActivePaths: !sim.config.showActivePaths })
              }
              className={`px-2 py-0.5 rounded-lg transition ${
                sim.config.showActivePaths
                  ? 'bg-orange-500 text-white'
                  : 'hover:bg-slate-200/80 text-slate-600'
              }`}
              title="Hiện/Ẩn đường đi A ➔ B trên sàn Isometric"
            >
              Đường đi
            </button>
            <button
              type="button"
              onClick={() => sim.updateConfig({ showGrid: !sim.config.showGrid })}
              className={`px-2 py-0.5 rounded-lg transition ${
                sim.config.showGrid
                  ? 'bg-slate-900 text-white'
                  : 'hover:bg-slate-200/80 text-slate-600'
              }`}
              title="Hiện/Ẩn lưới ô vuông Isometric"
            >
              Lưới Iso
            </button>
            <button
              type="button"
              onClick={() =>
                sim.updateConfig({
                  showEmployeeLabels: !sim.config.showEmployeeLabels,
                })
              }
              className={`px-2 py-0.5 rounded-lg transition ${
                sim.config.showEmployeeLabels
                  ? 'bg-indigo-600 text-white'
                  : 'hover:bg-slate-200/80 text-slate-600'
              }`}
              title="Hiện/Ẩn nhãn tên 30 nhân viên"
            >
              Tên NV
            </button>
          </div>
        </div>

        {/* Row 3 (Conditional): Active Zone Staff Quick-Focus Sub-bar */}
        {activeZoneRole !== 'ALL' && employeesInActiveZone.length > 0 && (
          <div className="flezi-glass-light rounded-2xl px-3 py-1.5 flex flex-wrap items-center gap-1.5 text-xs pointer-events-auto animate-fadeIn">
            <span className="font-mono text-[10px] font-extrabold uppercase tracking-wider text-slate-500 mr-1">
              🎯 Phân khu {ROLE_METADATA[activeZoneRole].shortLabel}:
            </span>
            {employeesInActiveZone.map((emp) => {
              const isSelected = sim.selectedEmployeeId === emp.id;
              const isMoving =
                emp.status === 'CARRYING_DOCS' ||
                emp.status === 'HANDOFF' ||
                emp.status === 'WALKING_BACK';
              return (
                <button
                  key={emp.id}
                  type="button"
                  onClick={() => sim.selectEmployee(emp.id)}
                  className={`px-2 py-0.5 rounded-full text-[11px] font-bold flex items-center gap-1.5 border transition ${
                    isSelected
                      ? 'bg-slate-900 text-white border-slate-900 shadow-sm'
                      : 'bg-white/90 text-slate-700 border-slate-300 hover:border-slate-500'
                  }`}
                >
                  <span
                    className="w-2 h-2 rounded-full shrink-0"
                    style={{ backgroundColor: emp.avatarColor }}
                  />
                  {emp.seatCode && (
                    <span className="font-mono text-[10px] text-orange-500 font-extrabold">
                      [{emp.seatCode.replace('FT3.III2A.', '')}]
                    </span>
                  )}
                  <span>{emp.account || emp.displayName}</span>
                  {isMoving && <span className="text-[10px]">🚶</span>}
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => handleSelectZoneFilter('ALL')}
              className="ml-1 px-2 py-0.5 rounded-full bg-slate-200 hover:bg-slate-300 text-slate-700 text-[10px] font-bold transition"
            >
              ✕ Bỏ lọc
            </button>
          </div>
        )}
      </header>
      )}

      {/* ====================================================================
          3. BOTTOM-LEFT FLOATING COLLAPSIBLE DRAWER: LIVE ACTIVITY FEED
             Hidden when `isHudHidden` is true
      ==================================================================== */}
      {!isHudHidden && (
      <aside className="fixed bottom-3 left-3 z-30 flex flex-col items-start max-w-[calc(100vw-24px)] pointer-events-none">
        {/* Expanded Floating Drawer Container */}
        <div
          className={`w-[360px] sm:w-[410px] max-w-[calc(100vw-24px)] transition-all duration-300 ease-out origin-bottom-left ${
            isFeedDrawerOpen
              ? 'h-[430px] max-h-[calc(100vh-190px)] opacity-100 translate-y-0 mb-2 pointer-events-auto'
              : 'h-0 max-h-0 opacity-0 translate-y-4 overflow-hidden pointer-events-none'
          }`}
        >
          <LiveActivityFeed
            className="h-full"
            logs={sim.activityLogs}
            activeTransfers={sim.activeTransfers}
            onSelectEmployee={(emp) => sim.selectEmployee(emp.id)}
            onSelectTicketKey={(ticketKey) => {
              const found = sim.tickets.find((t) => t.key === ticketKey);
              if (found) {
                sim.selectTicket(found.id);
                sim.selectEmployee(found.assigneeId);
              }
            }}
            onClearLogs={sim.clearActivityLogs}
            onCollapse={() => setIsFeedDrawerOpen(false)}
          />
        </div>

        {/* Floating Bottom-Left Launcher / Live Ticker Pill */}
        <div className="flezi-glass-dark rounded-2xl px-3 py-2 flex items-center justify-between gap-3 w-[360px] sm:w-[410px] max-w-[calc(100vw-24px)] text-slate-100 pointer-events-auto">
          <button
            type="button"
            onClick={() => setIsFeedDrawerOpen((v) => !v)}
            className="flex-1 min-w-0 flex items-center gap-2.5 text-left group"
          >
            <span className="relative flex h-2.5 w-2.5 shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-orange-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-orange-500" />
            </span>

            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="font-mono font-extrabold text-[11px] uppercase tracking-wider text-white group-hover:text-orange-300 transition">
                  ⚡ LIVE ACTIVITY FEED
                </span>
                <span className="px-1.5 py-0.2 rounded-full bg-orange-500/20 text-orange-300 font-mono text-[10px] font-bold border border-orange-500/30">
                  {sim.activeTransfers.length} đang đi
                </span>
                <span className="px-1.5 py-0.2 rounded-full bg-emerald-500/20 text-emerald-300 font-mono text-[10px] font-bold border border-emerald-500/30">
                  {sim.activityLogs.length} logs
                </span>
              </div>

              <p className="text-[11px] text-slate-300 truncate mt-0.5">
                {primaryTransfer
                  ? `🚶 [${primaryTransfer.ticketKey}] ${
                      EMPLOYEE_BY_ID[primaryTransfer.fromEmployeeId]?.account ||
                      primaryTransfer.fromEmployeeId
                    } (${
                      EMPLOYEE_BY_ID[primaryTransfer.fromEmployeeId]?.seatCode?.replace(
                        'FT3.III2A.',
                        ''
                      ) ?? ''
                    }) ➔ ${
                      EMPLOYEE_BY_ID[primaryTransfer.toEmployeeId]?.account ||
                      primaryTransfer.toEmployeeId
                    } (${
                      EMPLOYEE_BY_ID[primaryTransfer.toEmployeeId]?.seatCode?.replace(
                        'FT3.III2A.',
                        ''
                      ) ?? ''
                    }${primaryTransfer.isReturnToPM ? ' • DONE!' : ''}) (${Math.round(primaryTransfer.progress * 100)}%)`
                  : latestLog
                  ? `[${latestLog.ticketKey}] ${latestLog.message}`
                  : 'Sẵn sàng ghi nhận luồng bàn giao tài liệu A ➔ B...'}
              </p>
            </div>
          </button>

          <button
            type="button"
            onClick={() => setIsFeedDrawerOpen((v) => !v)}
            className={`px-2.5 py-1 rounded-xl text-[11px] font-bold border transition shrink-0 ${
              isFeedDrawerOpen
                ? 'bg-slate-800 text-slate-200 border-slate-600 hover:bg-slate-700'
                : 'bg-orange-500 hover:bg-orange-400 text-white border-orange-400 shadow-sm'
            }`}
          >
            {isFeedDrawerOpen ? '▼ Thu gọn' : '▲ Nhật ký'}
          </button>
        </div>
      </aside>
      )}

      {/* ====================================================================
          4. BOTTOM-RIGHT FLOATING COLLAPSIBLE DRAWER: JIRA KANBAN & HANDOFF
             Dock hidden when `isHudHidden` is true, modal portals to document.body
      ==================================================================== */}
      {(!isHudHidden || showIntegrationSettings) && (
      <aside className="fixed bottom-3 right-3 z-30 flex flex-col items-end max-w-[calc(100vw-24px)] pointer-events-none">
        {/* Expanded Floating Drawer Container (Kept mounted so Portal Modal & state always work) */}
        <div
          className={`w-[390px] sm:w-[445px] max-w-[calc(100vw-24px)] transition-all duration-300 ease-out origin-bottom-right ${
            !isHudHidden && isJiraDrawerOpen
              ? 'h-[560px] max-h-[calc(100vh-175px)] opacity-100 mb-2 pointer-events-auto'
              : 'h-0 max-h-0 opacity-0 overflow-hidden pointer-events-none'
          }`}
        >
          <JiraControlPanel
            className="h-full"
            tickets={sim.tickets}
            employees={sim.employees}
            activeTransfers={sim.activeTransfers}
            config={sim.config}
            isSprintRush={sim.isSprintRush}
            dataSourceMode={sim.dataSourceMode}
            liveConfig={sim.liveConfig}
            onSetDataSourceMode={(mode) => sim.setDataSourceMode(mode)}
            onUpdateLiveConfig={(patch) => sim.updateLiveConfig(patch)}
            onClearMockData={() => sim.clearMockData()}
            onCreateTicket={(input) => sim.createTicket(input)}
            onAdvanceTicket={(ticketId) => sim.advanceTicket(ticketId)}
            onManualTransfer={(ticketId, fromId, toId, nextStatus, comment) =>
              sim.manualTransfer(ticketId, fromId, toId, nextStatus, comment)
            }
            onTransitionTicket={(ticketId, nextStatus, nextAssigneeId, comment) =>
              sim.transitionTicket(ticketId, nextStatus, nextAssigneeId, comment)
            }
            onRejectBug={(ticketId) => sim.rejectTicketWithBug(ticketId)}
            onCompleteTicketToPM={(ticketId) => sim.completeTicketToPM(ticketId)}
            onUpdateConfig={(patch) => sim.updateConfig(patch)}
            onSpeedChange={(spd) => sim.setSpeedMultiplier(spd)}
            onToggleAutoPilot={(enabled) => sim.setAutoSimulate(enabled)}
            onTogglePlayPause={(running) => sim.setRunning(running)}
            onTriggerSprintRush={() => {
              void sim.toggleSprintRush();
            }}
            onTriggerJenkinsBuild={() => sim.triggerJenkinsBuild()}
            onIngestJiraXml={(xml) => sim.ingestJiraActivityXml(xml)}
            onIngestJenkinsXml={(xml) => sim.ingestJenkinsRssXml(xml)}
            onFetchLiveFrtFeeds={() => sim.fetchLiveFrtFeeds()}
            onSelectTicket={(ticket) => {
              sim.selectTicket(ticket.id);
              sim.selectEmployee(ticket.assigneeId);
            }}
            onSelectEmployee={(emp) => sim.selectEmployee(emp.id)}
            showIntegrationSettings={showIntegrationSettings}
            onToggleIntegrationSettings={(open) => setShowIntegrationSettings(open)}
            onCollapse={() => setIsJiraDrawerOpen(false)}
          />
        </div>

        {/* Floating Bottom-Right Jira Kanban & Handoff Dock Bar */}
        {!isHudHidden && (
        <div className="flezi-glass-dark rounded-2xl px-3.5 py-2 flex flex-wrap items-center justify-between gap-2.5 w-[390px] sm:w-[445px] max-w-[calc(100vw-24px)] text-slate-100 pointer-events-auto">
          <button
            type="button"
            onClick={() => setIsJiraDrawerOpen((v) => !v)}
            className="flex-1 min-w-0 text-left group"
          >
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-sky-400" />
              <span className="font-mono font-extrabold text-[11px] uppercase tracking-wider text-white group-hover:text-sky-300 transition">
                📋 JIRA KANBAN &amp; GIAO VIỆC (A ➔ B)
              </span>
            </div>

            {/* Live Compact Kanban Stage Counters */}
            <div className="flex items-center gap-2 mt-1 text-[10px] font-mono">
              <span className="text-slate-300">
                TODO <strong className="text-white">{sim.stats.todoCount}</strong>
              </span>
              <span className="text-slate-600">·</span>
              <span className="text-sky-300">
                CODE <strong>{sim.stats.inProgressCount}</strong>
              </span>
              <span className="text-slate-600">·</span>
              <span className="text-amber-300">
                REV/QA{' '}
                <strong>
                  {sim.stats.codeReviewCount + sim.stats.qaTestingCount}
                </strong>
              </span>
              <span className="text-slate-600">·</span>
              <span className="text-emerald-400 font-bold">
                DONE (PM) <strong>{sim.stats.doneCount}</strong>
              </span>
            </div>
          </button>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => {
                void sim.createRandomTicket();
              }}
              className="px-2 py-1 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-[11px] font-bold transition shadow-sm"
              title="Tạo nhanh 1 Jira Ticket mới từ Bàn PM"
            >
              ＋ Ticket
            </button>

            <button
              type="button"
              onClick={() => setIsJiraDrawerOpen((v) => !v)}
              className={`px-2.5 py-1 rounded-xl text-[11px] font-bold border transition ${
                isJiraDrawerOpen
                  ? 'bg-slate-800 text-slate-200 border-slate-600 hover:bg-slate-700'
                  : 'bg-indigo-600 hover:bg-indigo-500 text-white border-indigo-400 shadow-sm'
              }`}
            >
              {isJiraDrawerOpen ? '▼ Thu gọn' : '▲ Mở Kanban'}
            </button>
          </div>
        </div>
        )}
      </aside>
      )}
    </div>
  );
};

export function App() {
  return (
    <OfficeSimulationProvider>
      <VirtualFrtOfficeWorkspace />
    </OfficeSimulationProvider>
  );
}

export default App;
