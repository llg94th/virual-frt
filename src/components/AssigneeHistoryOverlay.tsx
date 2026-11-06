import React, { useCallback, useEffect, useState } from 'react';

/** API public: tối đa 10 lần đổi assignee gần nhất (chỉ đọc từ cache RAM của server) */
const ASSIGNEE_HISTORY_API_URL = '/api/public/assignee-history';
const REFRESH_MS = 15_000;
const MAX_ITEMS = 10;

interface AssigneeHistoryItem {
  id: string;
  ticketKey: string;
  summary: string;
  byAccount: string;
  byDisplayName: string;
  kind?: 'ASSIGNEE' | 'STATUS';
  targetLabel?: string;
  assigneeAccount?: string;
  assigneeDisplayName?: string;
  at: string;
}

function timeAgo(iso: string, nowMs: number): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '';
  const sec = Math.max(0, Math.round((nowMs - t) / 1000));
  if (sec < 60) return 'vừa xong';
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} phút trước`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} giờ trước`;
  return `${Math.round(hr / 24)} ngày trước`;
}

/**
 * Overlay nền mờ (glass) hiển thị lịch sử Jira gần nhất, tối đa 10 dòng:
 * - ĐỔI ASSIGNEE (🚶): nhân vật đi bộ mang hồ sơ sang người nhận
 * - ĐỔI TRẠNG THÁI (📌): chỉ là log, không có chuyến đi
 * Dữ liệu lấy từ `/api/public/assignee-history` (cache server, không gọi Jira trực tiếp).
 */
export const AssigneeHistoryOverlay: React.FC = () => {
  const [items, setItems] = useState<AssigneeHistoryItem[]>([]);
  const [collapsed, setCollapsed] = useState(false);
  const [nowMs, setNowMs] = useState(() => Date.now());

  const load = useCallback(async () => {
    try {
      const res = await fetch(ASSIGNEE_HISTORY_API_URL, {
        headers: { Accept: 'application/json' },
        cache: 'no-store',
      });
      if (!res.ok) return;
      const json = (await res.json()) as { ok?: boolean; items?: AssigneeHistoryItem[] };
      if (json?.ok && Array.isArray(json.items)) {
        setItems(json.items.slice(0, MAX_ITEMS));
      }
      setNowMs(Date.now());
    } catch {
      // mất kết nối: giữ nguyên danh sách hiện tại
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  return (
    <aside
      className="fixed left-3 bottom-3 z-30 w-[min(360px,calc(100vw-1.5rem))] rounded-2xl border border-white/40 bg-slate-900/45 text-slate-50 shadow-2xl backdrop-blur-md"
      aria-label="Lịch sử đổi assignee Jira"
    >
      <button
        type="button"
        onClick={() => setCollapsed((v) => !v)}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-[12px] font-extrabold tracking-wide"
        aria-expanded={!collapsed}
      >
        <span>🕘 Lịch sử Jira ({items.length}/{MAX_ITEMS})</span>
        <span className="opacity-70">{collapsed ? '▲' : '▼'}</span>
      </button>

      {!collapsed && (
        <ul className="max-h-[42vh] overflow-y-auto px-3 pb-3 text-[11px] leading-snug">
          {items.length === 0 && (
            <li className="py-2 opacity-70">Chưa có hoạt động Jira nào gần đây.</li>
          )}
          {items.map((it) => (
            <li key={it.id} className="border-t border-white/15 py-1.5 first:border-t-0">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-extrabold text-sky-200">{it.ticketKey}</span>
                <span className="shrink-0 opacity-70">{timeAgo(it.at, nowMs)}</span>
              </div>
              <div className="truncate opacity-85" title={it.summary}>
                {it.summary || '—'}
              </div>
              {it.kind === 'STATUS' ? (
                <div>
                  <span className="opacity-60">📌 </span>
                  <span className="opacity-80">{it.byAccount || '?'}</span>
                  <span className="mx-1 opacity-60">chuyển sang</span>
                  <span className="font-bold text-amber-200">{it.targetLabel || '—'}</span>
                </div>
              ) : (
                <div>
                  <span className="opacity-60">🚶 </span>
                  <span className="opacity-80">{it.byAccount || '?'}</span>
                  <span className="mx-1 opacity-60">giao cho</span>
                  <span className="font-bold text-emerald-200">
                    {it.targetLabel || it.assigneeDisplayName || it.assigneeAccount}
                  </span>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
};

export default AssigneeHistoryOverlay;
