import React, { useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
  CreateTicketInput,
  DocumentTransferTask,
  Employee,
  JiraTicket,
  SimulationConfig,
  TicketPriority,
  TicketStatus,
  TicketType,
} from '../types/office';
import {
  EMPLOYEES,
  EMPLOYEE_BY_ID,
  ROLE_METADATA,
} from '../data/employees';
import { DEFAULT_SIMULATION_CONFIG } from '../data/officeLayout';
import {
  FRT_JENKINS_RSS_PROXY_URL,
  FRT_JIRA_ACTIVITY_PROXY_URL,
  SAMPLE_FRT_JENKINS_RSS_XML,
  SAMPLE_FRT_JIRA_ACTIVITY_XML,
} from '../adapters/RealJiraWebhookAdapter';
import {
  DataSourceMode,
  LiveAuthType,
  LiveFrtConfig,
  useOfficeSimulation,
} from '../engine/simulationStore';

export interface JiraControlPanelProps {
  /** Danh sách Jira Tickets hiện tại */
  tickets?: JiraTicket[];
  /** Danh sách 30 nhân viên */
  employees?: Employee[];
  /** Danh sách các lượt bê tài liệu đang diễn ra */
  activeTransfers?: DocumentTransferTask[];
  /** Cấu hình Simulation hiện tại */
  config?: Partial<SimulationConfig>;
  /** Chế độ nguồn dữ liệu: 'LIVE_FRT' (Dữ liệu thật — Tắt Mock) hoặc 'MOCK_PILOT' */
  dataSourceMode?: DataSourceMode;
  /** Cấu hình kết nối trực tiếp Jira & Jenkins thật */
  liveConfig?: LiveFrtConfig;
  /** Callback đổi chế độ nguồn dữ liệu ('LIVE_FRT' | 'MOCK_PILOT') */
  onSetDataSourceMode?: (mode: DataSourceMode) => void;
  /** Callback cập nhật cấu hình kết nối thật */
  onUpdateLiveConfig?: (patch: Partial<LiveFrtConfig>) => void;
  /** Callback 1-Click xóa sạch toàn bộ dữ liệu Mock hiện tại */
  onClearMockData?: () => void;
  /** Trạng thái chế độ Sprint Demo Rush */
  sprintRush?: boolean;
  /** Alias cho sprintRush */
  isSprintRush?: boolean;
  /** Chế độ Adapter hiện tại */
  adapterMode?: 'mock' | 'real-webhook' | 'rest-api';
  /** Callback tạo Ticket mới */
  onCreateTicket?: (input: CreateTicketInput) => void | Promise<unknown>;
  /** Callback chuyển Ticket sang bước tiếp theo trong quy trình */
  onAdvanceTicket?: (ticketId?: string) => void | Promise<unknown>;
  /** Callback giao việc / chuyển trạng thái thủ công từ nhân viên A sang nhân viên B */
  onManualTransfer?: (
    ticketId: string,
    fromEmployeeId: string,
    toEmployeeId: string,
    nextStatus: TicketStatus,
    comment?: string
  ) => void | Promise<unknown>;
  /** Alias tương thích cho transitionTicket */
  onTransitionTicket?: (
    ticketId: string,
    nextStatus: TicketStatus,
    nextAssigneeId: string,
    comment?: string
  ) => void | Promise<unknown>;
  /** Callback trả Bug về cho Dev */
  onRejectBug?: (ticketId: string) => void | Promise<unknown>;
  /** Callback hoàn tất Ticket (DONE) và mang tài liệu về bàn PM */
  onCompleteTicketToPM?: (ticketId: string) => void | Promise<unknown>;
  /** Callback cập nhật cấu hình Simulation (Play/Pause, Auto-Pilot, Speed 1x/2x/4x) */
  onUpdateConfig?: (patch: Partial<SimulationConfig>) => void;
  /** Callback riêng khi đổi tốc độ */
  onSpeedChange?: (speed: number) => void;
  /** Callback riêng khi bật/tắt Auto-Pilot */
  onToggleAutoPilot?: (enabled: boolean) => void;
  /** Callback riêng khi Play/Pause */
  onTogglePlayPause?: (isRunning: boolean) => void;
  /** Callback kích hoạt Sprint Demo Rush */
  onTriggerSprintRush?: () => void;
  /** Callback kích hoạt kỹ sư đi bộ lại Trạm Máy Tính Server chạy Build Jenkins */
  onTriggerJenkinsBuild?: () => void;
  /** Callback đọc Atom XML từ `https://reqs.frt.vn/activity` */
  onIngestJiraXml?: (xmlText: string) => number;
  /** Callback đọc Atom/RSS XML từ `https://jenkins-osp.frt.vn/job/oneclickv4-build-ci/rssAll` */
  onIngestJenkinsXml?: (xmlText: string) => number;
  /** Callback gọi trực tiếp Vite Proxy lấy cả 2 nguồn XML thực tế */
  onFetchLiveFrtFeeds?: (basicAuthHeader?: string) => Promise<{
    jiraCount: number;
    jenkinsCount: number;
    source: 'live-proxy' | 'sample-fallback' | 'live-error';
    message: string;
    jiraError?: string | null;
    jenkinsError?: string | null;
    httpStatus?: number | null;
  }>;
  /** Callback click chọn ticket hoặc nhân viên */
  onSelectTicket?: (ticket: JiraTicket) => void;
  onSelectEmployee?: (employee: Employee) => void;
  /** Điều khiển mở/đóng hộp thoại Jira Integration Settings (Post-Pilot) từ bên ngoài */
  showIntegrationSettings?: boolean;
  onToggleIntegrationSettings?: (open: boolean) => void;
  /** Callback thu gọn ngăn kéo nổi (Floating Drawer) */
  onCollapse?: () => void;
  className?: string;
}

interface KanbanColumnGroup {
  id: 'TODO' | 'IN_PROGRESS' | 'REVIEW_QA' | 'DONE';
  title: string;
  shortTitle: string;
  statuses: TicketStatus[];
  accentColor: string;
  badgeBg: string;
}

const KANBAN_COLUMNS: KanbanColumnGroup[] = [
  {
    id: 'TODO',
    title: 'TODO',
    shortTitle: 'TODO',
    statuses: ['BACKLOG', 'TODO'],
    accentColor: 'border-slate-500/60 text-slate-200',
    badgeBg: 'bg-slate-800 text-slate-300',
  },
  {
    id: 'IN_PROGRESS',
    title: 'IN PROGRESS',
    shortTitle: 'IN PROG',
    statuses: ['IN_PROGRESS'],
    accentColor: 'border-sky-500/60 text-sky-300',
    badgeBg: 'bg-sky-500/20 text-sky-300',
  },
  {
    id: 'REVIEW_QA',
    title: 'REVIEW & QA',
    shortTitle: 'REV & QA',
    statuses: ['CODE_REVIEW', 'QA_TESTING', 'READY_FOR_DEPLOY'],
    accentColor: 'border-amber-500/60 text-amber-300',
    badgeBg: 'bg-amber-500/20 text-amber-300',
  },
  {
    id: 'DONE',
    title: 'DONE (Về PM)',
    shortTitle: 'DONE',
    statuses: ['DONE'],
    accentColor: 'border-emerald-500/60 text-emerald-300',
    badgeBg: 'bg-emerald-500/20 text-emerald-300',
  },
];

const SAMPLE_FRT_TICKETS: {
  summary: string;
  type: TicketType;
  priority: TicketPriority;
  storyPoints: number;
  initialAssigneeId: string;
}[] = [
  {
    summary: 'Tối ưu API tra cứu tồn kho chuỗi nhà thuốc Long Châu',
    type: 'STORY',
    priority: 'HIGH',
    storyPoints: 5,
    initialAssigneeId: 'EMP-07',
  },
  {
    summary: 'Tích hợp cổng thanh toán VietQR & đối soát tự động',
    type: 'STORY',
    priority: 'CRITICAL',
    storyPoints: 8,
    initialAssigneeId: 'EMP-08',
  },
  {
    summary: 'Thiết kế giao diện Flash Sale Omni-Channel Web',
    type: 'TASK',
    priority: 'HIGH',
    storyPoints: 3,
    initialAssigneeId: 'EMP-15',
  },
  {
    summary: 'Fix lỗi đồng bộ giỏ hàng trên Super App Mobile',
    type: 'BUG',
    priority: 'CRITICAL',
    storyPoints: 5,
    initialAssigneeId: 'EMP-21',
  },
  {
    summary: 'Cấu hình Auto-Scaling Kubernetes dịp cao điểm',
    type: 'TASK',
    priority: 'MEDIUM',
    storyPoints: 3,
    initialAssigneeId: 'EMP-29',
  },
];

const PRIORITY_BADGE: Record<TicketPriority, string> = {
  LOW: 'bg-slate-800 text-sky-300 border-sky-500/30',
  MEDIUM: 'bg-blue-500/15 text-blue-300 border-blue-500/30',
  HIGH: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
  CRITICAL: 'bg-red-500/20 text-red-300 border-red-500/50 animate-pulse',
};

export const JiraControlPanel: React.FC<JiraControlPanelProps> = ({
  tickets = [],
  employees = EMPLOYEES,
  activeTransfers = [],
  config: configProp,
  dataSourceMode: dataSourceModeProp,
  liveConfig: liveConfigProp,
  onSetDataSourceMode,
  onUpdateLiveConfig,
  onClearMockData,
  sprintRush = false,
  isSprintRush = false,
  onCreateTicket,
  onAdvanceTicket,
  onManualTransfer,
  onTransitionTicket,
  onRejectBug,
  onCompleteTicketToPM,
  onUpdateConfig,
  onSpeedChange,
  onToggleAutoPilot,
  onTogglePlayPause,
  onTriggerSprintRush,
  onTriggerJenkinsBuild,
  onIngestJiraXml,
  onIngestJenkinsXml,
  onFetchLiveFrtFeeds,
  onSelectTicket,
  onSelectEmployee,
  showIntegrationSettings,
  onToggleIntegrationSettings,
  onCollapse,
  className = '',
}) => {
  const simStore = useOfficeSimulation();
  const dataSourceMode: DataSourceMode =
    dataSourceModeProp ?? simStore.dataSourceMode;
  const liveConfig: LiveFrtConfig = liveConfigProp ?? simStore.liveConfig;
  const isLiveMode = dataSourceMode === 'LIVE_FRT';

  const handleSetMode = (mode: DataSourceMode) => {
    if (onSetDataSourceMode) {
      onSetDataSourceMode(mode);
    } else {
      simStore.setDataSourceMode(mode);
    }
  };

  const handlePatchLiveConfig = (patch: Partial<LiveFrtConfig>) => {
    if (onUpdateLiveConfig) {
      onUpdateLiveConfig(patch);
    } else {
      simStore.updateLiveConfig(patch);
    }
  };

  const handleClearMock = () => {
    if (onClearMockData) {
      onClearMockData();
    } else {
      simStore.clearMockData();
    }
  };

  const cfg: SimulationConfig = {
    ...DEFAULT_SIMULATION_CONFIG,
    ...configProp,
  };
  const rushActive = Boolean(sprintRush || isSprintRush);

  // UI Modal / Drawer states
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showManualModal, setShowManualModal] = useState(false);
  const [internalWebhookModal, setInternalWebhookModal] = useState(false);
  const [webhookTab, setWebhookTab] = useState<'XML_FEEDS' | 'CONFIG' | 'PAYLOAD'>('XML_FEEDS');
  const [payloadPreviewType, setPayloadPreviewType] = useState<'HANDOFF' | 'DONE'>('HANDOFF');
  const [xmlSourceTab, setXmlSourceTab] = useState<'JIRA_ATOM' | 'JENKINS_RSS'>('JIRA_ATOM');
  const [jiraXmlInput, setJiraXmlInput] = useState<string>(SAMPLE_FRT_JIRA_ACTIVITY_XML);
  const [jenkinsXmlInput, setJenkinsXmlInput] = useState<string>(SAMPLE_FRT_JENKINS_RSS_XML);
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [xmlStatusMessage, setXmlStatusMessage] = useState<string>('');
  const [xmlStatusVariant, setXmlStatusVariant] = useState<'success' | 'error' | 'info'>('info');
  const [activeColumnFilter, setActiveColumnFilter] = useState<
    'ALL' | KanbanColumnGroup['id']
  >('ALL');

  const showWebhookModal =
    showIntegrationSettings !== undefined ? showIntegrationSettings : internalWebhookModal;
  const setShowWebhookModal = (open: boolean) => {
    setInternalWebhookModal(open);
    onToggleIntegrationSettings?.(open);
  };

  // Create Ticket Form State
  const [newSummary, setNewSummary] = useState('');
  const [newType, setNewType] = useState<TicketType>('STORY');
  const [newPriority, setNewPriority] = useState<TicketPriority>('HIGH');
  const [newPoints, setNewPoints] = useState<number>(3);
  const [newAssigneeId, setNewAssigneeId] = useState<string>('EMP-02');

  // Manual Handoff (A -> B) Form State
  const [selectedTicketId, setSelectedTicketId] = useState<string>('');
  const [fromEmpId, setFromEmpId] = useState<string>('EMP-01');
  const [toEmpId, setToEmpId] = useState<string>('EMP-07');
  const [targetStatus, setTargetStatus] = useState<TicketStatus>('IN_PROGRESS');

  const sampleIndexRef = React.useRef(0);

  // Sync default selectedTicketId when tickets load
  const activeNonDoneTickets = useMemo(
    () => tickets.filter((t) => t.status !== 'DONE'),
    [tickets]
  );

  React.useEffect(() => {
    if (!selectedTicketId && activeNonDoneTickets.length > 0) {
      const first = activeNonDoneTickets[0];
      setSelectedTicketId(first.id);
      setFromEmpId(first.assigneeId || 'EMP-01');
    }
  }, [activeNonDoneTickets, selectedTicketId]);

  const handleQuickCreateTicket = () => {
    const sample =
      SAMPLE_FRT_TICKETS[sampleIndexRef.current % SAMPLE_FRT_TICKETS.length];
    sampleIndexRef.current += 1;
    onCreateTicket?.({
      summary: sample.summary,
      type: sample.type,
      priority: sample.priority,
      storyPoints: sample.storyPoints,
      initialAssigneeId: sample.initialAssigneeId,
    });
  };

  const handleCreateCustomTicket = (e: React.FormEvent) => {
    e.preventDefault();
    const summaryText =
      newSummary.trim() ||
      SAMPLE_FRT_TICKETS[sampleIndexRef.current % SAMPLE_FRT_TICKETS.length].summary;
    sampleIndexRef.current += 1;

    onCreateTicket?.({
      summary: summaryText,
      type: newType,
      priority: newPriority,
      storyPoints: newPoints,
      initialAssigneeId: newAssigneeId,
    });
    setNewSummary('');
    setShowCreateModal(false);
  };

  const handleExecuteManualTransfer = (e: React.FormEvent) => {
    e.preventDefault();
    const ticketToMove =
      tickets.find((t) => t.id === selectedTicketId) || activeNonDoneTickets[0];
    if (!ticketToMove) return;

    const finalToEmp = targetStatus === 'DONE' ? 'EMP-01' : toEmpId;
    if (onManualTransfer) {
      onManualTransfer(
        ticketToMove.id,
        fromEmpId,
        finalToEmp,
        targetStatus,
        `Giao việc thủ công: ${fromEmpId} -> ${finalToEmp}`
      );
    } else if (onTransitionTicket) {
      onTransitionTicket(
        ticketToMove.id,
        targetStatus,
        finalToEmp,
        `Giao việc thủ công: ${fromEmpId} -> ${finalToEmp}`
      );
    }
    setShowManualModal(false);
  };

  const handleSpeedSelect = (speed: number) => {
    onUpdateConfig?.({ speedMultiplier: speed });
    onSpeedChange?.(speed);
  };

  const handleAutoPilotToggle = () => {
    const next = !cfg.autoSimulate;
    onUpdateConfig?.({ autoSimulate: next, isRunning: true });
    onToggleAutoPilot?.(next);
  };

  const handlePlayPauseToggle = () => {
    const next = !cfg.isRunning;
    onUpdateConfig?.({ isRunning: next });
    onTogglePlayPause?.(next);
  };

  const handleCompleteTicket = (ticket: JiraTicket) => {
    if (onCompleteTicketToPM) {
      onCompleteTicketToPM(ticket.id);
    } else if (onManualTransfer) {
      onManualTransfer(
        ticket.id,
        ticket.assigneeId,
        'EMP-01',
        'DONE',
        `Báo cáo PM: ${ticket.key} DONE! 🎉`
      );
    } else if (onTransitionTicket) {
      onTransitionTicket(
        ticket.id,
        'DONE',
        'EMP-01',
        `Báo cáo PM: ${ticket.key} DONE! 🎉`
      );
    }
  };

  return (
    <div
      className={`flex flex-col bg-slate-900/90 backdrop-blur-xl border border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden text-slate-100 ${className}`}
    >
      {/* 1. Header & Mode: Live FRT vs Pilot Mock Jira Badge */}
      <div className="px-3.5 py-2.5 bg-slate-950/80 border-b border-slate-800/90 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div
            className={`w-2 h-2 rounded-full animate-ping ${
              isLiveMode ? 'bg-emerald-400' : 'bg-orange-500'
            }`}
          />
          <div
            className={`w-2 h-2 rounded-full -ml-4 ${
              isLiveMode ? 'bg-emerald-400' : 'bg-orange-500'
            }`}
          />
          <span className="font-mono font-bold text-[11px] tracking-widest uppercase text-slate-100">
            JIRA KANBAN &amp; HANDOFF (A ➔ B)
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <div className="flex items-center bg-slate-950 p-0.5 rounded-full border border-slate-700">
            <button
              type="button"
              onClick={() => handleSetMode('LIVE_FRT')}
              className={`px-2.5 py-0.5 rounded-full text-[10.5px] font-extrabold transition ${
                isLiveMode
                  ? 'bg-emerald-500 text-slate-950 shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
              title="Chế độ Dữ liệu Thật từ Server Proxy"
            >
              🟢 Thật
            </button>
            <button
              type="button"
              onClick={() => handleSetMode('MOCK_PILOT')}
              className={`px-2.5 py-0.5 rounded-full text-[10.5px] font-extrabold transition ${
                !isLiveMode
                  ? 'bg-amber-500 text-slate-950 shadow-sm'
                  : 'text-slate-400 hover:text-white'
              }`}
              title="Chế độ Giả lập (Mock Pilot)"
            >
              🧪 Mock
            </button>
          </div>

          {onCollapse && (
            <button
              type="button"
              onClick={onCollapse}
              className="px-2 py-0.5 rounded-full bg-slate-800/90 hover:bg-slate-700 text-slate-300 hover:text-white text-[10px] font-bold border border-slate-700 transition flex items-center gap-1"
              title="Thu gọn ngăn kéo Jira Kanban để mở rộng tầm nhìn bản đồ Isometric"
            >
              <span>Thu gọn ✕</span>
            </button>
          )}
        </div>
      </div>

      {/* 2. Primary Action & Simulation Speed Toolbar */}
      <div className="p-3 bg-slate-900/80 border-b border-slate-800/80 space-y-2.5">
        {/* Row 1: Simulation Playback, Speed (1x, 2x, 4x), Auto-Pilot & Sprint Demo Rush */}
        <div className="flex flex-wrap items-center justify-between gap-1.5">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={handlePlayPauseToggle}
              className={`px-2.5 py-1 rounded-lg text-xs font-bold transition flex items-center gap-1 ${
                cfg.isRunning
                  ? 'bg-slate-800 text-amber-300 hover:bg-slate-700 border border-slate-700'
                  : 'bg-emerald-600 text-white hover:bg-emerald-500'
              }`}
            >
              {cfg.isRunning ? '⏸ Tạm dừng' : '▶ Tiếp tục'}
            </button>

            <button
              type="button"
              onClick={handleAutoPilotToggle}
              className={`px-2.5 py-1 rounded-lg text-xs font-semibold border transition ${
                cfg.autoSimulate
                  ? 'bg-emerald-500/20 border-emerald-500/50 text-emerald-300'
                  : 'bg-slate-800 border-slate-700 text-slate-400'
              }`}
              title="Tự động luân chuyển Jira Ticket và điều phối nhân viên đi giao tài liệu"
            >
              🤖 Auto-Pilot: {cfg.autoSimulate ? 'ON' : 'OFF'}
            </button>
          </div>

          {/* Speed Multiplier Selector: 1x, 2x, 4x */}
          <div className="flex items-center bg-slate-950 p-0.5 rounded-lg border border-slate-800">
            {[1, 2, 4].map((spd) => {
              const active = cfg.speedMultiplier === spd;
              return (
                <button
                  key={spd}
                  type="button"
                  onClick={() => handleSpeedSelect(spd)}
                  className={`px-2 py-0.5 rounded-md text-xs font-bold transition ${
                    active
                      ? 'bg-sky-500 text-slate-950 shadow'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {spd}x
                </button>
              );
            })}
          </div>

          {/* Sprint Demo Rush Highlight Button */}
          <button
            type="button"
            onClick={onTriggerSprintRush}
            className={`px-2.5 py-1 rounded-lg text-xs font-extrabold tracking-wide transition shadow-md ${
              rushActive
                ? 'bg-gradient-to-r from-red-600 to-amber-500 text-white ring-2 ring-amber-400 animate-pulse'
                : 'bg-gradient-to-r from-orange-600/90 to-amber-600/90 hover:from-orange-500 hover:to-amber-500 text-white'
            }`}
          >
            🔥 Sprint Demo Rush
          </button>
        </div>

        {/* Row 2: Direct Ticket Actions (Create Ticket, Advance Step, Manual Handoff A -> B) */}
        <div className="grid grid-cols-3 gap-1.5">
          <div className="flex">
            <button
              type="button"
              onClick={handleQuickCreateTicket}
              className="flex-1 py-1.5 px-2 rounded-l-lg bg-sky-600 hover:bg-sky-500 text-white font-bold text-xs transition flex items-center justify-center gap-1 shadow-sm"
              title="Tạo nhanh 1 Jira Ticket mẫu từ bàn PM"
            >
              <span>＋ Tạo Ticket mới</span>
            </button>
            <button
              type="button"
              onClick={() => setShowCreateModal((v) => !v)}
              className="px-1.5 rounded-r-lg bg-sky-700 hover:bg-sky-600 text-white text-xs border-l border-sky-500/40"
              title="Tuỳ chỉnh thông tin Ticket mới"
            >
              ⚙
            </button>
          </div>

          <button
            type="button"
            onClick={() => onAdvanceTicket?.()}
            className="py-1.5 px-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs transition flex items-center justify-center gap-1 shadow-sm"
            title="Kích hoạt bước tiếp theo cho Ticket đang xử lý (nhân viên đứng dậy bê tài liệu)"
          >
            <span>Chuyển bước tiếp ➔</span>
          </button>

          <button
            type="button"
            onClick={() => setShowManualModal((v) => !v)}
            className="py-1.5 px-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-slate-950 font-extrabold text-xs transition flex items-center justify-center gap-1 shadow-sm"
            title="Chỉ định trực tiếp nhân viên A cầm chồng tài liệu sang bàn nhân viên B"
          >
            <span>Giao việc (A ➔ B)</span>
          </button>
        </div>

        {/* Collapsible Custom Create Ticket Form */}
        {showCreateModal && (
          <form
            onSubmit={handleCreateCustomTicket}
            className="p-2.5 rounded-lg bg-slate-950 border border-sky-500/40 space-y-2 text-xs"
          >
            <div className="flex items-center justify-between font-bold text-sky-400">
              <span>✨ Tạo Jira Ticket Mới (Khởi phát từ Bàn PM)</span>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>
            <input
              type="text"
              value={newSummary}
              onChange={(e) => setNewSummary(e.target.value)}
              placeholder="Nhập tiêu đề Ticket (VD: Tích hợp cổng thanh toán QR...)"
              className="w-full px-2.5 py-1.5 rounded bg-slate-900 border border-slate-700 text-slate-100 placeholder-slate-500 focus:outline-none focus:border-sky-400"
            />
            <div className="grid grid-cols-3 gap-1.5">
              <select
                value={newType}
                onChange={(e) => setNewType(e.target.value as TicketType)}
                className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-slate-200"
              >
                <option value="STORY">STORY</option>
                <option value="TASK">TASK</option>
                <option value="BUG">BUG</option>
                <option value="HOTFIX">HOTFIX</option>
              </select>
              <select
                value={newPriority}
                onChange={(e) => setNewPriority(e.target.value as TicketPriority)}
                className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-slate-200"
              >
                <option value="LOW">LOW (1 tập)</option>
                <option value="MEDIUM">MEDIUM (2 tập)</option>
                <option value="HIGH">HIGH (4 tập)</option>
                <option value="CRITICAL">CRITICAL (5 tập)</option>
              </select>
              <select
                value={newPoints}
                onChange={(e) => setNewPoints(Number(e.target.value))}
                className="bg-slate-900 border border-slate-700 rounded px-2 py-1 text-slate-200"
              >
                {[1, 2, 3, 5, 8].map((pts) => (
                  <option key={pts} value={pts}>
                    {pts} Story Pts
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-slate-400 shrink-0">Người nhận đầu:</span>
              <select
                value={newAssigneeId}
                onChange={(e) => setNewAssigneeId(e.target.value)}
                className="flex-1 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-slate-200"
              >
                {employees
                  .filter((e) => e.id !== 'EMP-01')
                  .map((emp) => (
                    <option key={emp.id} value={emp.id}>
                      [{emp.seatCode ?? emp.deskId}] {emp.account ?? emp.displayName} — {emp.title}
                    </option>
                  ))}
              </select>
              <button
                type="submit"
                className="px-3 py-1 rounded bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold"
              >
                Phát hành
              </button>
            </div>
          </form>
        )}

        {/* Collapsible Manual Handoff (A -> B) Form */}
        {showManualModal && (
          <form
            onSubmit={handleExecuteManualTransfer}
            className="p-2.5 rounded-lg bg-slate-950 border border-amber-500/40 space-y-2 text-xs"
          >
            <div className="flex items-center justify-between font-bold text-amber-400">
              <span>🚶 Giao việc Thủ công: Nhân viên A bê hồ sơ sang Bàn B</span>
              <button
                type="button"
                onClick={() => setShowManualModal(false)}
                className="text-slate-400 hover:text-white"
              >
                ✕
              </button>
            </div>

            <div className="space-y-1">
              <label className="text-[11px] text-slate-400 block">Chọn Ticket cần chuyển:</label>
              <select
                value={selectedTicketId}
                onChange={(e) => {
                  const id = e.target.value;
                  setSelectedTicketId(id);
                  const found = tickets.find((t) => t.id === id);
                  if (found) setFromEmpId(found.assigneeId);
                }}
                className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-slate-100"
              >
                {tickets.map((t) => (
                  <option key={t.id} value={t.id}>
                    [{t.key}] {t.summary} ({t.status})
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[11px] text-slate-400 block">Từ Nhân viên (A):</label>
                <select
                  value={fromEmpId}
                  onChange={(e) => setFromEmpId(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-slate-200"
                >
                  {employees.map((e) => (
                    <option key={e.id} value={e.id}>
                      [{e.seatCode?.replace('FT3.III2A.', '') ?? e.deskId}] {e.account ?? e.displayName} ({ROLE_METADATA[e.role].shortLabel})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-[11px] text-slate-400 block">Sang Nhân viên (B):</label>
                <select
                  value={targetStatus === 'DONE' ? 'EMP-01' : toEmpId}
                  disabled={targetStatus === 'DONE'}
                  onChange={(e) => setToEmpId(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-700 rounded px-2 py-1 text-slate-200 disabled:opacity-60"
                >
                  {employees.map((e) => (
                    <option key={e.id} value={e.id}>
                      [{e.seatCode?.replace('FT3.III2A.', '') ?? e.deskId}] {e.account ?? e.displayName} ({ROLE_METADATA[e.role].shortLabel})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex items-center justify-between gap-2 pt-1">
              <select
                value={targetStatus}
                onChange={(e) => {
                  const st = e.target.value as TicketStatus;
                  setTargetStatus(st);
                  if (st === 'DONE') setToEmpId('EMP-01');
                }}
                className="flex-1 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-slate-200"
              >
                <option value="IN_PROGRESS">Trạng thái: IN PROGRESS (Code)</option>
                <option value="CODE_REVIEW">Trạng thái: CODE REVIEW (Lead duyệt)</option>
                <option value="QA_TESTING">Trạng thái: QA TESTING (Kiểm thử)</option>
                <option value="READY_FOR_DEPLOY">Trạng thái: READY FOR DEPLOY (DevOps)</option>
                <option value="DONE">Trạng thái: DONE (Mang báo cáo về PM 🎉)</option>
              </select>
              <button
                type="submit"
                className="px-3 py-1 rounded bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold"
              >
                Bắt đầu đi bộ ➔
              </button>
            </div>
          </form>
        )}
      </div>

      {/* 3. Compact 4-Stage Kanban Filter Tabs (TODO | IN PROGRESS | REVIEW & QA | DONE) */}
      <div className="px-3 pt-2.5 pb-2 border-b border-slate-800 bg-slate-950/50">
        <div className="grid grid-cols-5 gap-1">
          <button
            type="button"
            onClick={() => setActiveColumnFilter('ALL')}
            className={`py-1.5 px-1.5 rounded-lg text-[11px] font-bold text-center border transition ${
              activeColumnFilter === 'ALL'
                ? 'bg-slate-800 border-sky-400 text-white'
                : 'bg-slate-900/70 border-slate-800 text-slate-400 hover:text-slate-200'
            }`}
          >
            TẤT CẢ ({tickets.length})
          </button>
          {KANBAN_COLUMNS.map((col) => {
            const count = tickets.filter((t) => col.statuses.includes(t.status)).length;
            const active = activeColumnFilter === col.id;
            return (
              <button
                key={col.id}
                type="button"
                onClick={() =>
                  setActiveColumnFilter(active ? 'ALL' : col.id)
                }
                className={`py-1.5 px-1.5 rounded-lg text-[11px] font-bold text-center border transition ${
                  active
                    ? 'bg-slate-800 border-sky-400 text-white shadow'
                    : 'bg-slate-900/70 border-slate-800 text-slate-400 hover:text-slate-200'
                }`}
              >
                <span>{col.shortTitle}</span>{' '}
                <span className="px-1 py-0.2 rounded bg-slate-950 text-[10px]">
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* 4. Kanban Board Ticket Cards List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {KANBAN_COLUMNS.filter(
          (col) => activeColumnFilter === 'ALL' || activeColumnFilter === col.id
        ).map((col) => {
          const colTickets = tickets.filter((t) => col.statuses.includes(t.status));
          return (
            <div key={col.id} className="space-y-2">
              <div className="flex items-center justify-between px-1">
                <div className="flex items-center gap-1.5">
                  <span
                    className={`text-xs font-extrabold tracking-wider uppercase ${col.accentColor}`}
                  >
                    {col.title}
                  </span>
                </div>
                <span
                  className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded-full ${col.badgeBg}`}
                >
                  {colTickets.length} tickets
                </span>
              </div>

              {colTickets.length === 0 ? (
                <div className="text-center py-3 rounded-lg border border-dashed border-slate-800 text-xs text-slate-500">
                  Không có ticket nào ở cột {col.shortTitle}
                </div>
              ) : (
                <div className="space-y-2">
                  {colTickets.map((ticket) => {
                    const assignee =
                      employees.find((e) => e.id === ticket.assigneeId) ??
                      EMPLOYEE_BY_ID[ticket.assigneeId];
                    const activeTransfer = activeTransfers.find(
                      (tr) => tr.ticketId === ticket.id && tr.phase !== 'COMPLETED'
                    );
                    const isDone = ticket.status === 'DONE';

                    return (
                      <div
                        key={ticket.id}
                        onClick={() => onSelectTicket?.(ticket)}
                        className={`p-2.5 rounded-xl border transition cursor-pointer ${
                          activeTransfer
                            ? 'bg-slate-900/95 border-amber-500/70 shadow-md shadow-amber-500/10'
                            : isDone
                            ? 'bg-emerald-950/20 border-emerald-500/40'
                            : 'bg-slate-950/90 border-slate-800 hover:border-slate-700'
                        }`}
                      >
                        {/* Top row: Key, Priority, Stack Size & Status Pill */}
                        <div className="flex items-center justify-between gap-1.5 mb-1">
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono font-extrabold text-xs text-sky-400">
                              {ticket.key}
                            </span>
                            <span
                              className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${
                                PRIORITY_BADGE[ticket.priority]
                              }`}
                            >
                              {ticket.priority}
                            </span>
                            <span
                              className="text-[10px] text-slate-400 bg-slate-900 px-1.5 py-0.5 rounded border border-slate-800"
                              title="Số tập hồ sơ trong chồng tài liệu"
                            >
                              📚 {ticket.documentStackSize} tập
                            </span>
                          </div>

                          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-slate-900 text-slate-300 border border-slate-800">
                            {ticket.status.replace(/_/g, ' ')}
                          </span>
                        </div>

                        {/* Ticket Summary */}
                        <p className="text-xs font-semibold text-slate-100 leading-snug mb-2">
                          {ticket.summary}
                        </p>

                        {/* Transfer Banner if someone is currently walking with this ticket */}
                        {activeTransfer && (
                          <div className="mb-2 px-2 py-1 rounded-lg bg-amber-500/15 border border-amber-500/40 text-[11px] text-amber-200 flex items-center justify-between">
                            <span className="truncate">
                              🚶{' '}
                              <strong>
                                {EMPLOYEE_BY_ID[activeTransfer.fromEmployeeId]?.account ??
                                  EMPLOYEE_BY_ID[activeTransfer.fromEmployeeId]?.displayName}{' '}
                                ({EMPLOYEE_BY_ID[activeTransfer.fromEmployeeId]?.seatCode?.replace('FT3.III2A.', '')})
                              </strong>{' '}
                              ➔{' '}
                              <strong>
                                {activeTransfer.isReturnToPM
                                  ? 'Bàn Đỏ PM DongNQ6 (1.289) 🎉'
                                  : `${
                                      EMPLOYEE_BY_ID[activeTransfer.toEmployeeId]?.account ??
                                      EMPLOYEE_BY_ID[activeTransfer.toEmployeeId]?.displayName
                                    } (${EMPLOYEE_BY_ID[activeTransfer.toEmployeeId]?.seatCode?.replace(
                                      'FT3.III2A.',
                                      ''
                                    )})`}
                              </strong>
                            </span>
                            <span className="font-mono font-bold ml-1">
                              {Math.round(activeTransfer.progress * 100)}%
                            </span>
                          </div>
                        )}

                        {/* Bottom row: Assignee (SeatCode + Account) + Action Buttons */}
                        <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-slate-800/80">
                          {assignee ? (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onSelectEmployee?.(assignee);
                              }}
                              className="flex items-center gap-1.5 text-left group min-w-0"
                              title={`Click để zoom vào ghế ${assignee.seatCode} (${assignee.account})`}
                            >
                              <span
                                className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-extrabold text-white shrink-0"
                                style={{ backgroundColor: assignee.avatarColor }}
                              >
                                {assignee.initials}
                              </span>
                              {assignee.seatCode && (
                                <span className="px-1.5 py-0.5 rounded bg-red-950/90 border border-red-500/50 font-mono text-[10px] font-extrabold text-orange-300 shrink-0">
                                  {assignee.seatCode.replace('FT3.III2A.', '')}
                                </span>
                              )}
                              <span className="text-xs font-bold text-slate-200 group-hover:text-sky-300 truncate max-w-[115px]">
                                {assignee.account || assignee.displayName}
                              </span>
                            </button>
                          ) : (
                            <span className="text-xs text-slate-500">Chưa giao</span>
                          )}

                          {/* Action Buttons */}
                          {!isDone ? (
                            <div className="flex items-center gap-1">
                              {(ticket.status === 'QA_TESTING' ||
                                ticket.status === 'CODE_REVIEW') &&
                                onRejectBug && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onRejectBug(ticket.id);
                                    }}
                                    className="px-1.5 py-0.5 rounded bg-red-500/20 hover:bg-red-500/30 border border-red-500/40 text-red-300 text-[10px] font-bold transition"
                                    title="Báo Bug và mang trả hồ sơ về bàn Dev"
                                  >
                                    🐞 Trả Bug
                                  </button>
                                )}

                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onAdvanceTicket?.(ticket.id);
                                }}
                                className="px-2 py-0.5 rounded bg-sky-600 hover:bg-sky-500 text-white text-[10px] font-bold transition"
                                title="Chuyển sang bước tiếp theo (nhân viên bê chồng tài liệu đi giao)"
                              >
                                Bước tiếp ➔
                              </button>

                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleCompleteTicket(ticket);
                                }}
                                className="px-2 py-0.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-bold transition"
                                title="Đánh dấu DONE và mang hồ sơ nghiệm thu về bàn PM"
                              >
                                DONE ➔ PM
                              </button>
                            </div>
                          ) : (
                            <span className="text-[11px] font-bold text-emerald-400 flex items-center gap-1">
                              {ticket.deliveredToPM
                                ? '👑 Đã nộp tại Bàn PM'
                                : '🚶 Đang mang về Bàn PM...'}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* 5. FULL-SCREEN CENTERED MODAL (`createPortal` to `document.body` so it is NEVER trapped in the bottom-right drawer):
             🔌 CẤU HÌNH KẾT NỐI JIRA (reqs.frt.vn) & JENKINS (jenkins-osp.frt.vn) THẬT */}
      {showWebhookModal &&
        (() => {
          const modalNode = (
            <div
              className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/75 backdrop-blur-md p-3 sm:p-6 pointer-events-auto"
              onClick={() => setShowWebhookModal(false)}
            >
              <div
                className="w-full max-w-4xl max-h-[92vh] flex flex-col bg-slate-900 border-2 border-teal-400/70 rounded-2xl shadow-[0_0_60px_rgba(16,185,129,0.28)] overflow-hidden text-slate-100"
                onClick={(e) => e.stopPropagation()}
              >
                {/* Header */}
                <div className="px-5 py-3.5 bg-gradient-to-r from-slate-950 via-slate-900 to-slate-950 border-b border-slate-800 flex flex-wrap items-center justify-between gap-3 shrink-0">
                  <div className="flex items-center gap-3">
                    <div
                      className={`w-9 h-9 rounded-xl flex items-center justify-center text-lg shadow-md border ${
                        isLiveMode
                          ? 'bg-emerald-500/20 border-emerald-400 text-emerald-300'
                          : 'bg-amber-500/20 border-amber-400 text-amber-300'
                      }`}
                    >
                      🔌
                    </div>
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-extrabold text-sm sm:text-base text-white tracking-wide">
                          🔌 CẤU HÌNH KẾT NỐI JIRA (reqs.frt.vn) &amp; JENKINS (jenkins-osp.frt.vn) THẬT
                        </h3>
                        <span
                          className={`px-2.5 py-0.5 rounded-full font-mono text-[10px] font-black border ${
                            isLiveMode
                              ? 'bg-emerald-500/25 text-emerald-300 border-emerald-400 animate-pulse'
                              : 'bg-amber-500/25 text-amber-300 border-amber-400'
                          }`}
                        >
                          {isLiveMode ? '🟢 LIVE REAL (TẮT MOCK)' : '🟠 MOCK PILOT (DEMO)'}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-300 mt-0.5">
                        Đồng bộ trực tiếp Atom/RSS XML từ <code className="text-amber-300">reqs.frt.vn/activity</code> &amp;{' '}
                        <code className="text-sky-300">jenkins-osp.frt.vn/job/oneclickv4-build-ci/rssAll</code> • Tự động lưu cấu hình vào trình duyệt (LocalStorage)
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowWebhookModal(false)}
                    className="text-slate-300 hover:text-white text-xs font-bold px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 transition"
                  >
                    ✕ Đóng
                  </button>
                </div>

                {/* ==============================================================
                    TOP MASTER SWITCH: LIVE FRT REAL MODE vs DEMO MOCK MODE
                ============================================================== */}
                <div className="px-5 py-3.5 bg-slate-950/90 border-b border-slate-800 space-y-2.5 shrink-0">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                    {/* Option 1: LIVE REAL MODE */}
                    <button
                      type="button"
                      onClick={() => {
                        handleSetMode('LIVE_FRT');
                        setXmlStatusVariant('success');
                        setXmlStatusMessage(
                          '🟢 Đã bật CHẾ ĐỘ LIVE THẬT (reqs.frt.vn & jenkins-osp.frt.vn) — Đã tắt toàn bộ bộ sinh dữ liệu Mock!'
                        );
                      }}
                      className={`p-3 rounded-xl border-2 text-left transition-all flex items-start gap-3 ${
                        isLiveMode
                          ? 'bg-emerald-950/50 border-emerald-400 ring-2 ring-emerald-500/30 shadow-lg shadow-emerald-500/10'
                          : 'bg-slate-900/80 border-slate-800 hover:border-emerald-500/50 text-slate-300'
                      }`}
                    >
                      <span
                        className={`mt-0.5 w-4 h-4 rounded-full flex items-center justify-center border shrink-0 ${
                          isLiveMode
                            ? 'border-emerald-300 bg-emerald-500 text-slate-950 font-black text-[10px]'
                            : 'border-slate-600 bg-slate-950'
                        }`}
                      >
                        {isLiveMode ? '✓' : ''}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="font-extrabold text-xs sm:text-sm text-emerald-300">
                          🟢 CHẾ ĐỘ LIVE THẬT (reqs.frt.vn &amp; jenkins-osp.frt.vn) — Tắt toàn bộ dữ liệu Mock
                        </div>
                        <p className="text-[11px] text-slate-300 mt-0.5 leading-snug">
                          Ngắt ngay bộ sinh ticket giả, dọn sạch văn phòng và chỉ điều khiển nhân vật khi có sự kiện thật từ Jira &amp; Jenkins FRT!
                        </p>
                      </div>
                    </button>

                    {/* Option 2: DEMO MOCK MODE */}
                    <button
                      type="button"
                      onClick={() => {
                        handleSetMode('MOCK_PILOT');
                        setXmlStatusVariant('info');
                        setXmlStatusMessage(
                          '🟠 Đã chuyển sang CHẾ ĐỘ DEMO MOCK (Tự động giả lập luồng mẫu cho 30 nhân sự).'
                        );
                      }}
                      className={`p-3 rounded-xl border-2 text-left transition-all flex items-start gap-3 ${
                        !isLiveMode
                          ? 'bg-amber-950/40 border-amber-400 ring-2 ring-amber-500/30 shadow-lg shadow-amber-500/10'
                          : 'bg-slate-900/80 border-slate-800 hover:border-amber-500/50 text-slate-300'
                      }`}
                    >
                      <span
                        className={`mt-0.5 w-4 h-4 rounded-full flex items-center justify-center border shrink-0 ${
                          !isLiveMode
                            ? 'border-amber-300 bg-amber-500 text-slate-950 font-black text-[10px]'
                            : 'border-slate-600 bg-slate-950'
                        }`}
                      >
                        {!isLiveMode ? '✓' : ''}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="font-extrabold text-xs sm:text-sm text-amber-300">
                          🟠 CHẾ ĐỘ DEMO MOCK (Tự động giả lập luồng mẫu)
                        </div>
                        <p className="text-[11px] text-slate-300 mt-0.5 leading-snug">
                          Tự động sinh luồng công việc mẫu (FRT-101..107) để trình chiếu khi không kết nối mạng nội bộ FRT.
                        </p>
                      </div>
                    </button>
                  </div>

                  {/* Quick Clean Mock Button & Auto-Clear Checkbox */}
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                    <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={liveConfig.clearMockOnLive}
                        onChange={(e) =>
                          handlePatchLiveConfig({ clearMockOnLive: e.target.checked })
                        }
                        className="rounded border-slate-600 bg-slate-900 text-emerald-500 focus:ring-emerald-500"
                      />
                      <span>
                        Tự động xóa sạch ticket/log giả khi bật sang <strong>CHẾ ĐỘ LIVE THẬT</strong>
                      </span>
                    </label>

                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[11px] font-mono text-slate-400">
                        Đang hiển thị: <strong className="text-white">{tickets.length}</strong> tickets •{' '}
                        <strong className="text-emerald-300">{liveConfig.liveEventsProcessed}</strong> sự kiện thật đã xử lý
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          handleClearMock();
                          setXmlStatusVariant('success');
                          setXmlStatusMessage(
                            '🧹 Đã xóa sạch 100% ticket giả, lượt đi bộ giả và nhật ký giả! Văn phòng hiện hoàn toàn sạch để đón dữ liệu thật.'
                          );
                        }}
                        className="px-3 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-extrabold text-xs border border-rose-400 shadow-sm transition flex items-center gap-1.5"
                      >
                        <span>🧹 Xóa sạch dữ liệu Mock hiện tại</span>
                      </button>
                    </div>
                  </div>
                </div>

                {/* Sub-navigation Tabs inside Settings Modal */}
                <div className="px-5 pt-2.5 bg-slate-950/60 border-b border-slate-800 flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => setWebhookTab('XML_FEEDS')}
                    className={`px-3.5 py-2 rounded-t-xl text-xs font-extrabold border-b-2 transition ${
                      webhookTab === 'XML_FEEDS'
                        ? 'border-teal-400 text-teal-300 bg-teal-500/15'
                        : 'border-transparent text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    🔌 1. Kết nối Live FRT (URL, Basic Auth &amp; Dán XML Thật)
                  </button>
                  <button
                    type="button"
                    onClick={() => setWebhookTab('CONFIG')}
                    className={`px-3.5 py-2 rounded-t-xl text-xs font-bold border-b-2 transition ${
                      webhookTab === 'CONFIG'
                        ? 'border-indigo-400 text-indigo-300 bg-indigo-500/10'
                        : 'border-transparent text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    ⚙️ 2. Kiến trúc Adapter &amp; Ánh xạ 30 Ghế FRT
                  </button>
                  <button
                    type="button"
                    onClick={() => setWebhookTab('PAYLOAD')}
                    className={`px-3.5 py-2 rounded-t-xl text-xs font-bold border-b-2 transition ${
                      webhookTab === 'PAYLOAD'
                        ? 'border-emerald-400 text-emerald-300 bg-emerald-500/10'
                        : 'border-transparent text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    📡 3. Mẫu Jira Webhook JSON
                  </button>
                </div>

                {/* Scrollable Body */}
                <div className="p-5 space-y-4 text-xs leading-relaxed overflow-y-auto flex-1">
                  {webhookTab === 'XML_FEEDS' ? (
                    <div className="space-y-4">
                      {/* ==========================================================
                          KHU VỰC 1: CẤU HÌNH URL & TÀI KHOẢN BASIC AUTH (os_authType=basic)
                      ========================================================== */}
                      <div className="p-4 rounded-2xl bg-slate-950 border border-teal-500/40 space-y-3.5 shadow-inner">
                        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2.5">
                          <div>
                            <h4 className="font-extrabold text-sm text-teal-300 flex items-center gap-2">
                              <span>🌐 KHU VỰC 1: Cấu hình URL &amp; Tài khoản Basic Auth (os_authType=basic)</span>
                            </h4>
                            <p className="text-[11px] text-slate-400 mt-0.5">
                              Tự động mã hóa <code className="text-amber-300">Basic base64(user:pass)</code> gửi qua Vite Proxy tới{' '}
                              <code className="text-amber-300">reqs.frt.vn</code> &amp;{' '}
                              <code className="text-sky-300">jenkins-osp.frt.vn</code> định kỳ mỗi {liveConfig.pollIntervalSec}s.
                            </p>
                          </div>

                          {/* Live Sync Status Pill */}
                          <div className="flex items-center gap-2">
                            <span
                              className={`px-2.5 py-1 rounded-full font-mono text-[11px] font-bold border ${
                                liveConfig.lastSyncStatus === 'OK'
                                  ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                                  : liveConfig.lastSyncStatus === 'SYNCING'
                                    ? 'bg-sky-500/20 text-sky-300 border-sky-500/40 animate-pulse'
                                    : liveConfig.lastSyncStatus === 'ERROR'
                                      ? 'bg-rose-500/20 text-rose-300 border-rose-500/40'
                                      : 'bg-slate-900 text-slate-400 border-slate-700'
                              }`}
                            >
                              {liveConfig.lastSyncStatus === 'OK'
                                ? `🟢 KẾT NỐI OK (${liveConfig.lastSyncAt ?? 'vừa xong'})`
                                : liveConfig.lastSyncStatus === 'SYNCING'
                                  ? '🔄 ĐANG ĐỒNG BỘ...'
                                  : liveConfig.lastSyncStatus === 'ERROR'
                                    ? `🔴 LỖI KẾT NỐI (${liveConfig.lastSyncAt ?? ''})`
                                    : '⚪ CHƯA ĐỒNG BỘ'}
                            </span>
                          </div>
                        </div>

                        {/* URL Inputs */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <div>
                            <div className="flex items-center justify-between mb-1">
                              <label className="text-[11px] font-bold text-amber-300">
                                1. Jira Activity Feed URL (reqs.frt.vn):
                              </label>
                              <a
                                href={liveConfig.jiraUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="text-[10px] text-sky-400 hover:underline font-semibold"
                              >
                                Mở tab thật ↗
                              </a>
                            </div>
                            <input
                              type="text"
                              value={liveConfig.jiraUrl}
                              onChange={(e) =>
                                handlePatchLiveConfig({ jiraUrl: e.target.value })
                              }
                              placeholder="https://reqs.frt.vn/activity?maxResults=10&providers=issues&os_authType=basic&title=undefined"
                              className="w-full px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-amber-200 font-mono text-[11px] focus:outline-none focus:border-amber-400"
                            />
                            <div className="text-[10px] text-slate-500 mt-0.5 font-mono">
                              Proxy: {FRT_JIRA_ACTIVITY_PROXY_URL}
                            </div>
                          </div>

                          <div>
                            <div className="flex items-center justify-between mb-1">
                              <label className="text-[11px] font-bold text-sky-300">
                                2. Jenkins CI RSS All URL (jenkins-osp.frt.vn):
                              </label>
                              <a
                                href={liveConfig.jenkinsUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="text-[10px] text-sky-400 hover:underline font-semibold"
                              >
                                Mở tab thật ↗
                              </a>
                            </div>
                            <input
                              type="text"
                              value={liveConfig.jenkinsUrl}
                              onChange={(e) =>
                                handlePatchLiveConfig({ jenkinsUrl: e.target.value })
                              }
                              placeholder="https://jenkins-osp.frt.vn/job/oneclickv4-build-ci/rssAll"
                              className="w-full px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-sky-200 font-mono text-[11px] focus:outline-none focus:border-sky-400"
                            />
                            <div className="text-[10px] text-slate-500 mt-0.5 font-mono">
                              Proxy: {FRT_JENKINS_RSS_PROXY_URL}
                            </div>
                          </div>
                        </div>

                        {/* Basic Auth Credentials & Polling Interval */}
                        <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 pt-1">
                          <div className="sm:col-span-3">
                            <label className="text-[11px] font-bold text-slate-300 block mb-1">
                              Kiểu xác thực:
                            </label>
                            <select
                              value={liveConfig.authType}
                              onChange={(e) =>
                                handlePatchLiveConfig({
                                  authType: e.target.value as LiveAuthType,
                                })
                              }
                              className="w-full px-2.5 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-slate-100 font-semibold text-xs focus:outline-none focus:border-teal-400"
                            >
                              <option value="BASIC">BASIC (os_authType=basic)</option>
                              <option value="BEARER">BEARER (PAT Token)</option>
                              <option value="COOKIE">COOKIE (JSESSIONID)</option>
                              <option value="NONE">NONE (Không gửi Auth)</option>
                            </select>
                          </div>

                          <div className="sm:col-span-3">
                            <label className="text-[11px] font-bold text-slate-300 block mb-1">
                              FRT Account / Username:
                            </label>
                            <input
                              type="text"
                              value={liveConfig.username}
                              onChange={(e) =>
                                handlePatchLiveConfig({ username: e.target.value })
                              }
                              placeholder="VD: dongnq6"
                              className="w-full px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-white font-mono text-xs focus:outline-none focus:border-teal-400"
                            />
                          </div>

                          <div className="sm:col-span-4">
                            <label className="text-[11px] font-bold text-slate-300 block mb-1">
                              Password / API Token (reqs.frt.vn):
                            </label>
                            <div className="relative flex items-center">
                              <input
                                type={showPassword ? 'text' : 'password'}
                                value={liveConfig.passwordOrToken}
                                onChange={(e) =>
                                  handlePatchLiveConfig({
                                    passwordOrToken: e.target.value,
                                  })
                                }
                                placeholder="Nhập mật khẩu hoặc Token FRT..."
                                className="w-full pl-3 pr-8 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-white font-mono text-xs focus:outline-none focus:border-teal-400"
                              />
                              <button
                                type="button"
                                onClick={() => setShowPassword((v) => !v)}
                                className="absolute right-2 text-slate-400 hover:text-white text-[11px]"
                                title={showPassword ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                              >
                                {showPassword ? '🙈' : '👁️'}
                              </button>
                            </div>
                          </div>

                          <div className="sm:col-span-2">
                            <label className="text-[11px] font-bold text-slate-300 block mb-1">
                              Chu kỳ Polling:
                            </label>
                            <div className="grid grid-cols-4 gap-1 bg-slate-900 p-1 rounded-lg border border-slate-700">
                              {[5, 10, 15, 30].map((sec) => {
                                const active = liveConfig.pollIntervalSec === sec;
                                return (
                                  <button
                                    key={sec}
                                    type="button"
                                    onClick={() =>
                                      handlePatchLiveConfig({ pollIntervalSec: sec })
                                    }
                                    className={`py-1 rounded text-[10px] font-mono font-extrabold transition ${
                                      active
                                        ? 'bg-teal-500 text-slate-950 shadow'
                                        : 'text-slate-400 hover:text-white'
                                    }`}
                                  >
                                    {sec}s
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        </div>

                        {/* RAM Cache Deduplication & Monotonic Cursor (afterSeq) Telemetry Bar */}
                        <div className="p-3 rounded-xl bg-slate-900/90 border border-indigo-500/40 flex flex-wrap items-center justify-between gap-2">
                          <div className="space-y-0.5">
                            <div className="text-[11px] font-extrabold text-indigo-300 flex items-center gap-1.5">
                              <span>🛡️ 2-Layer Exactly-Once RAM Cache Deduplicator (Monotonic Cursor afterSeq)</span>
                              <span className="px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-200 font-mono text-[10px]">
                                afterSeq={liveConfig.lastServerSeq ?? 0}
                              </span>
                            </div>
                            <p className="text-[10.5px] text-slate-400">
                              API Public duy nhất qua Cloudflare Tunnel:{' '}
                              <code className="text-emerald-300">/api/public/office-stream?afterSeq={liveConfig.lastServerSeq ?? 0}</code>{' '}
                              • Giao diện Admin mã hóa AES-256-GCM (chỉ mở tại localhost):{' '}
                              <a
                                href="http://127.0.0.1:8787/admin"
                                target="_blank"
                                rel="noreferrer"
                                className="text-amber-300 underline hover:text-amber-200 font-bold"
                              >
                                http://127.0.0.1:8787/admin ↗
                              </a>
                            </p>
                          </div>

                          <div className="flex flex-wrap items-center gap-1.5 text-[10.5px] font-mono">
                            <span className="px-2 py-1 rounded-lg bg-slate-950 border border-emerald-500/40 text-emerald-300">
                              Unique phát ra:{' '}
                              <strong className="text-white">
                                {liveConfig.dedupStats?.uniqueEventsEmitted ?? liveConfig.liveEventsProcessed}
                              </strong>
                            </span>
                            <span className="px-2 py-1 rounded-lg bg-slate-950 border border-amber-500/40 text-amber-300">
                              Trùng lặp đã chặn:{' '}
                              <strong className="text-white">
                                {liveConfig.dedupStats?.duplicatesDropped ?? 0}
                              </strong>
                            </span>
                            <span className="px-2 py-1 rounded-lg bg-slate-950 border border-slate-700 text-slate-300">
                              RAM Keys:{' '}
                              <strong className="text-sky-300">
                                {liveConfig.dedupStats?.cacheSize ?? 0}/2000
                              </strong>
                            </span>
                            <button
                              type="button"
                              onClick={async () => {
                                await simStore.resetDedupCache();
                                setXmlStatusVariant('info');
                                setXmlStatusMessage(
                                  '♻️ Đã xóa bộ nhớ đệm RAM Cache Deduplicator (afterSeq = 0, seenFingerprints = 0). Bạn có thể test đồng bộ lại từ đầu!'
                                );
                              }}
                              className="px-2.5 py-1 rounded-lg bg-rose-950/80 hover:bg-rose-900 text-rose-200 border border-rose-500/50 font-sans font-bold text-[10.5px] transition"
                              title="Xóa bộ nhớ đệm chống trùng lặp để test phát lại các sự kiện XML"
                            >
                              ♻️ Reset Dedup Cache
                            </button>
                          </div>
                        </div>

                        {/* Test Connection & Sync Now Action Row */}
                        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-800/90">
                          <div className="flex flex-wrap items-center gap-3 text-[11px] font-mono">
                            <span className="px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 text-amber-300">
                              📄 Jira sự kiện mới:{' '}
                              <strong className="text-white">
                                {liveConfig.lastJiraEntryCount ?? 0}
                              </strong>
                            </span>
                            <span className="px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 text-sky-300">
                              🖥️ Jenkins Build mới:{' '}
                              <strong className="text-white">
                                {liveConfig.lastJenkinsBuildCount ?? 0}
                              </strong>
                            </span>
                            <span className="px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-800 text-emerald-300">
                              🛡️ Lọc trùng mẻ vừa rồi:{' '}
                              <strong className="text-white">
                                {liveConfig.lastDuplicatesDroppedInBatch ?? 0}
                              </strong>
                            </span>
                          </div>

                          <button
                            type="button"
                            onClick={async () => {
                              const fetchFn =
                                onFetchLiveFrtFeeds ?? simStore.fetchLiveFrtFeeds;
                              const res = await fetchFn();
                              setXmlStatusVariant(
                                res.source === 'live-error' ? 'error' : 'success'
                              );
                              setXmlStatusMessage(res.message);
                            }}
                            disabled={liveConfig.lastSyncStatus === 'SYNCING'}
                            className="px-4 py-2 rounded-xl bg-gradient-to-r from-teal-500 to-emerald-500 hover:from-teal-400 hover:to-emerald-400 disabled:opacity-60 text-slate-950 font-extrabold text-xs transition shadow-lg shadow-teal-500/20 flex items-center gap-2"
                          >
                            <span>🔄 Test Kết Nối &amp; Đồng Bộ Ngay</span>
                          </button>
                        </div>

                        {/* Error / Status Feedback Banner */}
                        {(liveConfig.lastSyncError || xmlStatusMessage) && (
                          <div
                            className={`p-3 rounded-xl border text-xs space-y-1 ${
                              liveConfig.lastSyncError || xmlStatusVariant === 'error'
                                ? 'bg-rose-950/60 border-rose-500/60 text-rose-200'
                                : 'bg-emerald-950/50 border-emerald-500/50 text-emerald-200'
                            }`}
                          >
                            <div className="font-extrabold flex items-center gap-1.5">
                              <span>
                                {liveConfig.lastSyncError || xmlStatusVariant === 'error'
                                  ? '⚠️ Trạng thái Kết nối / Cảnh báo xác thực:'
                                  : '✅ Kết quả Đồng bộ:'}
                              </span>
                            </div>
                            <p className="text-[11px] leading-relaxed">
                              {liveConfig.lastSyncError || xmlStatusMessage}
                            </p>
                            {(liveConfig.lastSyncError || xmlStatusVariant === 'error') && (
                              <div className="text-[11px] text-amber-300 pt-1 border-t border-rose-800/60">
                                💡 <strong>Hướng dẫn khắc phục nhanh:</strong> Hãy nhập{' '}
                                <code>FRT Account / Username</code> (VD: <code>dongnq6</code>) +{' '}
                                <code>Password</code> của <code>reqs.frt.vn</code> ở trên rồi bấm{' '}
                                <strong>🔄 Test Kết Nối &amp; Đồng Bộ Ngay</strong>, HOẶC mở link{' '}
                                <code>reqs.frt.vn/activity</code> trên trình duyệt đã đăng nhập sẵn và
                                dán XML vào <strong>Khu vực 2</strong> bên dưới!
                              </div>
                            )}
                          </div>
                        )}
                      </div>

                      {/* ==========================================================
                          KHU VỰC 2: NẠP / DÁN TRỰC TIẾP XML TỪ TRÌNH DUYỆT
                      ========================================================== */}
                      <div className="p-4 rounded-2xl bg-slate-950 border border-amber-500/40 space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div>
                            <h4 className="font-extrabold text-sm text-amber-300">
                              📋 KHU VỰC 2: Nạp / Dán trực tiếp XML từ Trình duyệt (Chạy 100% Dữ liệu Thật không cần cấu hình Proxy Auth)
                            </h4>
                            <p className="text-[11px] text-slate-400 mt-0.5">
                              Nếu trình duyệt của bạn đã đăng nhập sẵn{' '}
                              <a
                                href="https://reqs.frt.vn/activity?maxResults=10&providers=issues&os_authType=basic&title=undefined"
                                target="_blank"
                                rel="noreferrer"
                                className="text-amber-300 underline hover:text-amber-200"
                              >
                                reqs.frt.vn/activity
                              </a>{' '}
                              hoặc{' '}
                              <a
                                href="https://jenkins-osp.frt.vn/job/oneclickv4-build-ci/rssAll"
                                target="_blank"
                                rel="noreferrer"
                                className="text-sky-300 underline hover:text-sky-200"
                              >
                                jenkins-osp.frt.vn/.../rssAll
                              </a>
                              , chỉ cần Copy XML từ tab đó dán vào ô dưới đây rồi bấm Nạp!
                            </p>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => setXmlSourceTab('JIRA_ATOM')}
                              className={`px-3 py-1.5 rounded-lg text-xs font-extrabold transition ${
                                xmlSourceTab === 'JIRA_ATOM'
                                  ? 'bg-amber-500 text-slate-950 shadow'
                                  : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                              }`}
                            >
                              📄 Nguồn 1: Jira Activity XML (reqs.frt.vn)
                            </button>
                            <button
                              type="button"
                              onClick={() => setXmlSourceTab('JENKINS_RSS')}
                              className={`px-3 py-1.5 rounded-lg text-xs font-extrabold transition ${
                                xmlSourceTab === 'JENKINS_RSS'
                                  ? 'bg-sky-500 text-slate-950 shadow'
                                  : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                              }`}
                            >
                              🖥️ Nguồn 2: Jenkins CI RSS XML (jenkins-osp.frt.vn)
                            </button>
                          </div>

                          <div className="flex flex-wrap items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => {
                                if (xmlSourceTab === 'JIRA_ATOM') {
                                  setJiraXmlInput('');
                                } else {
                                  setJenkinsXmlInput('');
                                }
                              }}
                              className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-semibold border border-slate-700 transition"
                            >
                              🧹 Xóa ô để dán XML mới
                            </button>

                            {xmlSourceTab === 'JIRA_ATOM' ? (
                              <button
                                type="button"
                                onClick={() => {
                                  const hasEntryTag =
                                    jiraXmlInput.includes('<entry') ||
                                    jiraXmlInput.includes('<item');
                                  if (!hasEntryTag) {
                                    setXmlStatusVariant('error');
                                    setXmlStatusMessage(
                                      '⚠️ Không tìm thấy thẻ <entry> hợp lệ trong chuỗi XML vừa dán!'
                                    );
                                    return;
                                  }
                                  const ingestFn =
                                    onIngestJiraXml ?? simStore.ingestJiraActivityXml;
                                  const count = ingestFn(jiraXmlInput);
                                  const dropped =
                                    simStore.getMutableState().liveConfig
                                      .lastDuplicatesDroppedInBatch ?? 0;
                                  setXmlStatusVariant('success');
                                  setXmlStatusMessage(
                                    count > 0
                                      ? `✅ Đã phát ${count} sự kiện MỚI từ Jira Activity XML & kích hoạt nhân vật đi bộ bàn giao hồ sơ (Đã lọc bỏ ${dropped} bản ghi trùng lặp)!`
                                      : `🛡️ 0 sự kiện mới (Đã lọc bỏ ${dropped} sự kiện trùng lặp trong RAM Cache — Đảm bảo event không đến 2 lần!)`
                                  );
                                }}
                                className="px-3.5 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-extrabold text-xs transition shadow-md"
                              >
                                🚶 Nạp Jira XML ➔ Giao tài liệu ngay
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => {
                                  const hasEntryTag =
                                    jenkinsXmlInput.includes('<entry') ||
                                    jenkinsXmlInput.includes('<item');
                                  if (!hasEntryTag) {
                                    setXmlStatusVariant('error');
                                    setXmlStatusMessage(
                                      '⚠️ Không tìm thấy thẻ <entry>/<item> hợp lệ trong chuỗi Jenkins XML!'
                                    );
                                    return;
                                  }
                                  const ingestFn =
                                    onIngestJenkinsXml ?? simStore.ingestJenkinsRssXml;
                                  const count = ingestFn(jenkinsXmlInput);
                                  const dropped =
                                    simStore.getMutableState().liveConfig
                                      .lastDuplicatesDroppedInBatch ?? 0;
                                  setXmlStatusVariant('success');
                                  setXmlStatusMessage(
                                    count > 0
                                      ? `✅ Đã phát ${count} sự kiện build MỚI từ Jenkins rssAll XML & cử kỹ sư ra Trạm Server chạy build (Đã lọc bỏ ${dropped} build cũ trùng lặp)!`
                                      : `🛡️ 0 sự kiện mới (Đã lọc bỏ ${dropped} sự kiện trùng lặp trong RAM Cache — Đảm bảo cùng 1 build không chạy lại lần 2!)`
                                  );
                                }}
                                className="px-3.5 py-1.5 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-extrabold text-xs transition shadow-md"
                              >
                                🚀 Nạp Jenkins XML ➔ Ra Server Build ngay
                              </button>
                            )}
                          </div>
                        </div>

                        <textarea
                          rows={6}
                          value={
                            xmlSourceTab === 'JIRA_ATOM' ? jiraXmlInput : jenkinsXmlInput
                          }
                          onChange={(e) => {
                            if (xmlSourceTab === 'JIRA_ATOM') {
                              setJiraXmlInput(e.target.value);
                            } else {
                              setJenkinsXmlInput(e.target.value);
                            }
                          }}
                          placeholder={
                            xmlSourceTab === 'JIRA_ATOM'
                              ? 'Dán toàn bộ nội dung Atom XML (<feed>...<entry>...</entry></feed>) từ https://reqs.frt.vn/activity vào đây...'
                              : 'Dán toàn bộ nội dung RSS/Atom XML từ https://jenkins-osp.frt.vn/job/oneclickv4-build-ci/rssAll vào đây...'
                          }
                          className="w-full p-3 rounded-xl bg-slate-900 border border-slate-700 font-mono text-[11px] text-emerald-300 focus:outline-none focus:border-amber-400"
                        />
                      </div>
                    </div>
                  ) : webhookTab === 'CONFIG' ? (
                    <>
                      <div className="p-3.5 rounded-xl bg-indigo-500/10 border border-indigo-500/30 text-indigo-200">
                        <div className="font-bold text-indigo-300 mb-1">
                          Kiến trúc Tách biệt (Decoupled IJiraAdapter) &amp; Ánh xạ Không phân biệt Hoa/Thường
                        </div>
                        <p className="text-slate-300">
                          Hỗ trợ chuyển đổi tức thì giữa <code className="text-emerald-300">LIVE_FRT</code> (đọc trực tiếp{' '}
                          <code className="text-amber-300">reqs.frt.vn/activity</code> &amp;{' '}
                          <code className="text-sky-300">jenkins-osp.frt.vn</code>, tắt toàn bộ dữ liệu giả) và{' '}
                          <code className="text-amber-300">MOCK_PILOT</code>. Tự động ánh xạ tài khoản{' '}
                          <code>dongnq6</code> ➔ <strong>DongNQ6</strong>, <code>thanhdq13</code> ➔{' '}
                          <strong>ThanhDQ13</strong>, <code>tienhk</code> ➔ <strong>TienHK</strong>,{' '}
                          <code>sonna2</code> ➔ <strong>SonNA2</strong>...
                        </p>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div
                          className={`p-3 rounded-xl bg-slate-950 border ${
                            isLiveMode ? 'border-emerald-400' : 'border-slate-800'
                          }`}
                        >
                          <div className="flex items-center justify-between mb-1">
                            <span className="font-bold text-emerald-300">
                              ● RealJiraWebhookAdapter (LIVE_FRT)
                            </span>
                            <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-bold">
                              {isLiveMode ? 'ACTIVE (LIVE REAL)' : 'STANDBY'}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-400">
                            Đọc trực tiếp luồng XML/Webhook từ reqs.frt.vn &amp; jenkins-osp.frt.vn, tắt hoàn toàn bộ sinh ticket giả.
                          </p>
                        </div>

                        <div
                          className={`p-3 rounded-xl bg-slate-950 border ${
                            !isLiveMode ? 'border-amber-400' : 'border-slate-800'
                          }`}
                        >
                          <div className="flex items-center justify-between mb-1">
                            <span className="font-bold text-amber-300">
                              ● MockJiraAdapter (MOCK_PILOT)
                            </span>
                            <span className="text-[10px] px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 font-bold">
                              {!isLiveMode ? 'ACTIVE (DEMO MOCK)' : 'DISABLED'}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-400">
                            Giả lập tự động luồng Sprint, nút điều khiển thủ công A ➔ B và kịch bản Sprint Rush cho 30 nhân sự.
                          </p>
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="space-y-2.5">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-slate-200">
                          Chọn kịch bản Webhook Payload mẫu từ Jira:
                        </span>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => setPayloadPreviewType('HANDOFF')}
                            className={`px-2.5 py-1 rounded text-[11px] font-bold transition ${
                              payloadPreviewType === 'HANDOFF'
                                ? 'bg-sky-500 text-slate-950'
                                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                            }`}
                          >
                            Chuyển giao A ➔ B (QA Testing)
                          </button>
                          <button
                            type="button"
                            onClick={() => setPayloadPreviewType('DONE')}
                            className={`px-2.5 py-1 rounded text-[11px] font-bold transition ${
                              payloadPreviewType === 'DONE'
                                ? 'bg-emerald-500 text-slate-950'
                                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                            }`}
                          >
                            Ticket DONE ➔ Về Bàn PM 🎉
                          </button>
                        </div>
                      </div>

                      <pre className="p-3 rounded-xl bg-slate-950 border border-slate-800 font-mono text-[11px] text-emerald-300 overflow-x-auto leading-snug">
                        {payloadPreviewType === 'HANDOFF'
                          ? `{
  "timestamp": 1762325400000,
  "webhookEvent": "jira:issue_updated",
  "user": {
    "accountId": "thanhdq13",
    "displayName": "ThanhDQ13 (Tech Lead)"
  },
  "issue": {
    "id": "10104",
    "key": "FRT-104",
    "fields": {
      "summary": "Tối ưu API tra cứu tồn kho chuỗi Long Châu",
      "priority": { "name": "High" },
      "status": { "name": "QA Testing" },
      "assignee": {
        "accountId": "trantnn",
        "emailAddress": "trantnn@frt.vn",
        "displayName": "TranTNN (QA Team Lead)"
      }
    }
  }
}`
                          : `{
  "timestamp": 1762325900000,
  "webhookEvent": "jira:issue_updated",
  "user": {
    "accountId": "trantnn",
    "displayName": "TranTNN (QA Team Lead)"
  },
  "issue": {
    "id": "10105",
    "key": "FRT-105",
    "fields": {
      "summary": "Nghiệm thu UAT đặt thuốc Online Long Châu",
      "priority": { "name": "Critical" },
      "status": { "name": "Done" },
      "assignee": {
        "accountId": "dongnq6",
        "emailAddress": "dongnq6@frt.vn",
        "displayName": "DongNQ6 (Project Manager)"
      }
    }
  }
}`}
                      </pre>
                    </div>
                  )}
                </div>

                {/* Footer */}
                <div className="px-5 py-3 bg-slate-950 border-t border-slate-800 flex flex-wrap items-center justify-between gap-2 shrink-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={async () => {
                        const fetchFn =
                          onFetchLiveFrtFeeds ?? simStore.fetchLiveFrtFeeds;
                        const res = await fetchFn();
                        setXmlStatusVariant(
                          res.source === 'live-error' ? 'error' : 'success'
                        );
                        setXmlStatusMessage(res.message);
                      }}
                      className="px-3.5 py-1.5 rounded-xl bg-teal-600 hover:bg-teal-500 text-white font-extrabold text-xs transition"
                    >
                      🔄 Đồng bộ Live Jira &amp; Jenkins Ngay
                    </button>

                    {onTriggerJenkinsBuild && (
                      <button
                        type="button"
                        onClick={() => {
                          onTriggerJenkinsBuild();
                          setShowWebhookModal(false);
                        }}
                        className="px-3.5 py-1.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white font-bold text-xs transition"
                      >
                        🚀 Trigger Build Jenkins (oneclickv4-build-ci)
                      </button>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => setShowWebhookModal(false)}
                    className="px-5 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-extrabold text-xs shadow"
                  >
                    Lưu &amp; Đóng cửa sổ
                  </button>
                </div>
              </div>
            </div>
          );

          return typeof document !== 'undefined'
            ? createPortal(modalNode, document.body)
            : modalNode;
        })()}
    </div>
  );
};

export default JiraControlPanel;
