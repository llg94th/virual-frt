import React, { useState, useMemo } from 'react';
import {
  ActivityLogEntry,
  DocumentTransferTask,
  Employee,
} from '../types/office';
import { EMPLOYEE_BY_ID } from '../data/employees';

export interface LiveActivityFeedProps {
  /** Danh sách bản ghi nhật ký bàn giao tài liệu */
  logs?: ActivityLogEntry[];
  /** Alias tương thích cho logs */
  activityLogs?: ActivityLogEntry[];
  /** Danh sách các tác vụ bê chồng tài liệu đang di chuyển trên sàn */
  activeTransfers?: DocumentTransferTask[];
  /** Callback khi người dùng click vào nhân viên trong dòng sự kiện để highlight trên Canvas */
  onSelectEmployee?: (employee: Employee) => void;
  /** Callback khi click vào mã Ticket */
  onSelectTicketKey?: (ticketKey: string) => void;
  /** Callback xóa nhật ký (tuỳ chọn) */
  onClearLogs?: () => void;
  /** Callback thu gọn ngăn kéo nổi (Floating Drawer) */
  onCollapse?: () => void;
  className?: string;
}

type FeedFilter = 'ALL' | 'HANDOFF' | 'PM_DONE';

function formatTimeShort(isoOrTime: string): string {
  if (!isoOrTime) return '';
  if (/^\d{2}:\d{2}:\d{2}$/.test(isoOrTime)) return isoOrTime;
  try {
    const d = new Date(isoOrTime);
    if (Number.isNaN(d.getTime())) return isoOrTime;
    return d.toLocaleTimeString('vi-VN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return isoOrTime;
  }
}

export const LiveActivityFeed: React.FC<LiveActivityFeedProps> = ({
  logs,
  activityLogs,
  activeTransfers = [],
  onSelectEmployee,
  onSelectTicketKey,
  onClearLogs,
  onCollapse,
  className = '',
}) => {
  const [filter, setFilter] = useState<FeedFilter>('ALL');

  const entries = useMemo(() => logs ?? activityLogs ?? [], [logs, activityLogs]);

  const filteredEntries = useMemo(() => {
    if (filter === 'ALL') return entries;
    if (filter === 'PM_DONE') {
      return entries.filter(
        (e) =>
          e.isReturnToPM ||
          e.type === 'RETURN_TO_PM' ||
          e.ticketStatus === 'DONE'
      );
    }
    return entries.filter(
      (e) => !e.isReturnToPM && e.type !== 'RETURN_TO_PM'
    );
  }, [entries, filter]);

  const pmReturnCount = useMemo(
    () =>
      entries.filter(
        (e) =>
          e.isReturnToPM ||
          e.type === 'RETURN_TO_PM' ||
          e.ticketStatus === 'DONE'
      ).length,
    [entries]
  );

  const handleEmpClick = (empId: string) => {
    const emp = EMPLOYEE_BY_ID[empId];
    if (emp && onSelectEmployee) {
      onSelectEmployee(emp);
    }
  };

  return (
    <div
      className={`flex flex-col bg-slate-900/90 backdrop-blur-xl border border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden text-slate-100 ${className}`}
    >
      {/* Header & Filter Pills */}
      <div className="px-3.5 py-2.5 bg-slate-950/80 border-b border-slate-800/90 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-orange-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-orange-500" />
          </span>
          <h3 className="font-mono font-bold text-[11px] uppercase tracking-widest text-slate-100">
            LIVE ACTIVITY FEED
          </h3>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setFilter('ALL')}
            className={`px-2 py-0.5 rounded-full text-[10px] font-bold transition ${
              filter === 'ALL'
                ? 'bg-orange-500 text-white'
                : 'bg-slate-800 text-slate-400 hover:text-slate-200'
            }`}
          >
            Tất cả ({entries.length})
          </button>
          <button
            type="button"
            onClick={() => setFilter('HANDOFF')}
            className={`px-2 py-0.5 rounded-full text-[10px] font-bold transition ${
              filter === 'HANDOFF'
                ? 'bg-indigo-500 text-white'
                : 'bg-slate-800 text-slate-400 hover:text-slate-200'
            }`}
          >
            A➔B
          </button>
          <button
            type="button"
            onClick={() => setFilter('PM_DONE')}
            className={`px-2 py-0.5 rounded-full text-[10px] font-bold transition ${
              filter === 'PM_DONE'
                ? 'bg-emerald-500 text-slate-950'
                : 'bg-slate-800 text-emerald-400 hover:bg-slate-700'
            }`}
          >
            Về PM ({pmReturnCount})
          </button>
          {onClearLogs && entries.length > 0 && (
            <button
              type="button"
              onClick={onClearLogs}
              className="px-1.5 py-0.5 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-400 text-[10px]"
              title="Xóa nhật ký"
            >
              Xoá
            </button>
          )}
          {onCollapse && (
            <button
              type="button"
              onClick={onCollapse}
              className="px-2 py-0.5 rounded-full bg-slate-800/90 hover:bg-slate-700 text-slate-300 hover:text-white text-[10px] font-bold border border-slate-700 transition"
              title="Thu gọn nhật ký"
            >
              ✕
            </button>
          )}
        </div>
      </div>

      {/* Live Active Document Transfers in Progress */}
      {activeTransfers.length > 0 && (
        <div className="px-3 py-2 bg-amber-500/10 border-b border-amber-500/30 space-y-1.5">
          <div className="text-[10px] font-extrabold uppercase tracking-wider text-amber-300 flex items-center justify-between">
            <span>🚶 Đang di chuyển trên hành lang ({activeTransfers.length})</span>
            <span>Tiến độ</span>
          </div>
          <div className="space-y-1 max-h-24 overflow-y-auto">
            {activeTransfers.map((task) => {
              const fromEmp = EMPLOYEE_BY_ID[task.fromEmployeeId];
              const toEmp = EMPLOYEE_BY_ID[task.toEmployeeId];
              const isPMReturn = task.isReturnToPM || task.targetStatus === 'DONE';

              return (
                <div
                  key={task.id}
                  className="p-1.5 rounded-lg bg-slate-950/90 border border-slate-800 text-xs"
                >
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <div className="truncate flex items-center gap-1">
                      <span
                        className={`font-mono font-bold ${
                          isPMReturn ? 'text-emerald-400' : 'text-sky-400'
                        }`}
                      >
                        [{task.ticketKey}]
                      </span>
                      <button
                        type="button"
                        onClick={() => handleEmpClick(task.fromEmployeeId)}
                        className="font-semibold text-slate-200 hover:text-sky-300"
                      >
                        {fromEmp?.displayName ?? task.fromEmployeeId}
                      </button>
                      <span className="text-slate-500">
                        bê {task.documentStackSize} tập hồ sơ ➔
                      </span>
                      <button
                        type="button"
                        onClick={() => handleEmpClick(task.toEmployeeId)}
                        className={`font-bold ${
                          isPMReturn ? 'text-amber-300' : 'text-emerald-300'
                        }`}
                      >
                        {isPMReturn
                          ? '👑 PM Quân (DONE!)'
                          : toEmp?.displayName ?? task.toEmployeeId}
                      </button>
                    </div>
                    <span className="text-[10px] font-mono text-amber-300 shrink-0">
                      {Math.round(task.progress * 100)}%
                    </span>
                  </div>
                  <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className={`h-full transition-all duration-150 ${
                        isPMReturn
                          ? 'bg-gradient-to-r from-emerald-500 to-amber-400'
                          : 'bg-sky-500'
                      }`}
                      style={{ width: `${Math.max(6, Math.round(task.progress * 100))}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Event Stream List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {filteredEntries.length === 0 ? (
          <div className="text-center py-6 text-xs text-slate-500 italic">
            Chưa có sự kiện bàn giao tài liệu nào. Hãy bấm &ldquo;Tạo Ticket mới&rdquo; hoặc
            &ldquo;Chuyển bước tiếp&rdquo; để bắt đầu!
          </div>
        ) : (
          filteredEntries.map((entry) => {
            const fromEmp = EMPLOYEE_BY_ID[entry.fromEmployeeId];
            const toEmp = EMPLOYEE_BY_ID[entry.toEmployeeId];
            const isDonePM =
              entry.isReturnToPM ||
              entry.type === 'RETURN_TO_PM' ||
              entry.ticketStatus === 'DONE';

            return (
              <div
                key={entry.id}
                className={`p-2.5 rounded-xl border text-xs transition ${
                  isDonePM
                    ? 'bg-emerald-950/25 border-emerald-500/40 hover:border-emerald-400/60'
                    : 'bg-slate-950/85 border-slate-800/90 hover:border-slate-700'
                }`}
              >
                <div className="flex items-center justify-between gap-2 mb-1">
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => onSelectTicketKey?.(entry.ticketKey)}
                      className={`font-mono font-extrabold px-1.5 py-0.5 rounded text-[11px] ${
                        isDonePM
                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                          : 'bg-sky-500/15 text-sky-300 border border-sky-500/30'
                      }`}
                    >
                      {entry.ticketKey}
                    </button>

                    <span
                      className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                        isDonePM
                          ? 'bg-amber-500/20 text-amber-300'
                          : 'bg-slate-800 text-slate-300'
                      }`}
                    >
                      {isDonePM ? '🎉 BÁO CÁO DONE VỀ PM' : entry.ticketStatus.replace(/_/g, ' ')}
                    </span>
                  </div>

                  <span className="text-[10px] font-mono text-slate-500">
                    {formatTimeShort(entry.timestamp)}
                  </span>
                </div>

                {/* Sender A -> Receiver B visual row */}
                <div className="flex items-center flex-wrap gap-1.5 my-1.5 text-[11px]">
                  <button
                    type="button"
                    onClick={() => handleEmpClick(entry.fromEmployeeId)}
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-slate-900 border border-slate-800 hover:border-sky-500/50 text-slate-200 font-semibold"
                  >
                    {fromEmp && (
                      <span
                        className="w-3.5 h-3.5 rounded-full inline-flex items-center justify-center text-[8px] text-white font-bold"
                        style={{ backgroundColor: fromEmp.avatarColor }}
                      >
                        {fromEmp.initials}
                      </span>
                    )}
                    <span>{entry.fromEmployeeName || fromEmp?.displayName}</span>
                  </button>

                  <span className="text-slate-400 font-bold">
                    {isDonePM ? '📦 mang báo cáo nghiệm thu ➔' : '📄 trao hồ sơ ➔'}
                  </span>

                  <button
                    type="button"
                    onClick={() => handleEmpClick(entry.toEmployeeId)}
                    className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border font-bold ${
                      isDonePM
                        ? 'bg-amber-500/15 border-amber-500/50 text-amber-300'
                        : 'bg-slate-900 border-slate-800 hover:border-emerald-500/50 text-emerald-300'
                    }`}
                  >
                    {toEmp && (
                      <span
                        className="w-3.5 h-3.5 rounded-full inline-flex items-center justify-center text-[8px] text-white font-bold"
                        style={{ backgroundColor: toEmp.avatarColor }}
                      >
                        {toEmp.initials}
                      </span>
                    )}
                    <span>
                      {isDonePM
                        ? `👑 ${entry.toEmployeeName || toEmp?.displayName || 'PM Quân'}`
                        : entry.toEmployeeName || toEmp?.displayName}
                    </span>
                  </button>
                </div>

                <p className="text-slate-300 leading-snug text-[11.5px]">{entry.message}</p>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export default LiveActivityFeed;
