import React, { useEffect, useRef, useState } from 'react';
import { BLOCK_SIZE, FLOOR_DEPARTMENTS, PITCH, ROAD_LINES, ROAD_W, TOWER_FOOTPRINT, cityStore, live, useCity } from '../shared';
import type { CameraMode, Quality, Weather } from '../shared';
import { heroCar, setDriving, trafficView } from '../vehicles';

const FONT = "'Oswald','Barlow Condensed','Bebas Neue','Arial Narrow',Impact,sans-serif";
const PANEL = 'pointer-events-auto bg-black/60 backdrop-blur-sm border border-white/10 rounded-lg shadow-[0_0_18px_rgba(255,170,0,0.15)]';
const LABEL = 'text-[10px] font-bold uppercase tracking-[0.15em] text-amber-400/90';

const WEATHERS: [Weather, string][] = [['clear', 'Quang đãng'], ['cloudy', 'Nhiều mây'], ['rain', 'Mưa'], ['storm', 'Bão']];
const QUALITIES: [Quality, string][] = [['low', 'Thấp'], ['medium', 'Vừa'], ['high', 'Cao']];
const CAMERAS: [CameraMode, string][] = [['orbit', 'Quỹ đạo'], ['follow', 'Bám theo'], ['cutaway', 'Cắt lớp'], ['cinematic', 'Điện ảnh'], ['drive', 'Lái xe']];
const MISSIONS = [
  'giao tài liệu lên F2 (Khoang NHÀ THUỐC)',
  'lái xe một vòng quanh thành phố',
  'đi bộ vào sảnh F-Town 3',
  'ngắm hoàng hôn từ sân thượng',
];
const DISTRICTS = ['Quận Trung Tâm', 'Khu Công Nghệ', 'Phố Đi Bộ', 'Khu Thương Mại', 'Khu Dân Cư', 'Bến Cảng', 'Khu Sáng Tạo', 'Phố Ẩm Thực'];

function Btn({ active, onClick, children, className = '', title }: { active?: boolean; onClick: () => void; children: React.ReactNode; className?: string; title?: string }) {
  return (
    <button
      type="button" title={title} onMouseDown={(e) => e.preventDefault()} onClick={onClick}
      className={`pointer-events-auto px-2 py-1 rounded text-[11px] font-bold uppercase tracking-wider border transition ${active ? 'bg-amber-400 text-black border-amber-300 shadow-[0_0_10px_rgba(251,191,36,0.6)]' : 'bg-white/5 text-white/80 border-white/10 hover:bg-white/15'} ${className}`}
    >{children}</button>
  );
}

// ---------------- Minimap ----------------
const MM = 184;
const RANGE = 230; // metres shown from centre to edge
const Minimap: React.FC = () => {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current; if (!cv) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = MM * dpr; cv.height = MM * dpr;
    const ctx = cv.getContext('2d'); if (!ctx) return;
    let raf = 0; let lastT = 0;
    const draw = (t: number) => {
      raf = requestAnimationFrame(draw);
      if (t - lastT < 50) return;
      lastT = t;
      const sc = (MM / 2) / RANGE;
      const p = live.player;
      const mode = cityStore.get().playerMode;
      const px = mode === 'none' ? 0 : p.x, pz = mode === 'none' ? 0 : p.z;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, MM, MM);
      ctx.save();
      ctx.beginPath(); ctx.arc(MM / 2, MM / 2, MM / 2 - 2, 0, Math.PI * 2); ctx.clip();
      ctx.fillStyle = '#1b2430'; ctx.fillRect(0, 0, MM, MM);
      ctx.translate(MM / 2 - px * sc, MM / 2 - pz * sc);
      // blocks
      ctx.fillStyle = '#2a3646';
      for (let i = -3; i <= 3; i++) for (let j = -3; j <= 3; j++) {
        if (i === 0 && j === 0) continue;
        const s = BLOCK_SIZE * sc; ctx.fillRect(i * PITCH * sc - s / 2, j * PITCH * sc - s / 2, s, s);
      }
      // roads
      ctx.strokeStyle = '#586272'; ctx.lineWidth = ROAD_W * sc * 0.8; ctx.lineCap = 'butt';
      const ext = ROAD_LINES[ROAD_LINES.length - 1] * sc;
      ctx.beginPath();
      for (const L of ROAD_LINES) { ctx.moveTo(L * sc, -ext); ctx.lineTo(L * sc, ext); ctx.moveTo(-ext, L * sc); ctx.lineTo(ext, L * sc); }
      ctx.stroke();
      // tower
      ctx.fillStyle = '#f59e0b';
      ctx.fillRect(-TOWER_FOOTPRINT.w * sc / 2, -TOWER_FOOTPRINT.d * sc / 2, TOWER_FOOTPRINT.w * sc, TOWER_FOOTPRINT.d * sc);
      ctx.fillStyle = '#000'; ctx.font = 'bold 7px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('FRT', 0, 2.5);
      // traffic
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      for (let i = 0; i < trafficView.count; i++) ctx.fillRect(trafficView.pos[i * 2] * sc - 0.7, trafficView.pos[i * 2 + 1] * sc - 0.7, 1.4, 1.4);
      // parked hero car
      if (mode !== 'drive') { ctx.fillStyle = '#ef4444'; ctx.fillRect(heroCar.x * sc - 2.5, heroCar.z * sc - 2.5, 5, 5); }
      // mission marker
      ctx.strokeStyle = '#fbbf24'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(0, 0, 14 + Math.sin(t / 250) * 2, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
      // player arrow
      ctx.save();
      ctx.translate(MM / 2, MM / 2);
      const hd = mode === 'drive' ? heroCar.heading : p.heading;
      ctx.rotate(Math.atan2(Math.cos(hd), Math.sin(hd)));
      ctx.fillStyle = '#38bdf8'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(8, 0); ctx.lineTo(-5, 5); ctx.lineTo(-2.5, 0); ctx.lineTo(-5, -5); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.restore();
      ctx.strokeStyle = 'rgba(251,191,36,0.8)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(MM / 2, MM / 2, MM / 2 - 2, 0, Math.PI * 2); ctx.stroke();
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);
  return <canvas ref={ref} style={{ width: MM, height: MM }} className="rounded-full shadow-[0_0_20px_rgba(0,0,0,0.7)]" />;
};

const fmtTime = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

// ---------------- HUD ----------------
export const CityHud: React.FC<{ onExit: () => void }> = ({ onExit }) => {
  const minute = useCity((s) => Math.floor(s.timeOfDay * 60) % 1440);
  const autoTime = useCity((s) => s.autoTime);
  const weather = useCity((s) => s.weather);
  const quality = useCity((s) => s.quality);
  const camera = useCity((s) => s.cameraMode);
  const floor = useCity((s) => s.selectedFloor);
  const mode = useCity((s) => s.playerMode);
  const muted = useCity((s) => s.muted);
  const [help, setHelp] = useState(true);
  const [panelOpen, setPanelOpen] = useState(false);
  const [kmh, setKmh] = useState(0);
  const [nearCar, setNearCar] = useState(false);
  const [district, setDistrict] = useState(DISTRICTS[0]);
  const [mission, setMission] = useState<string | null>(null);

  useEffect(() => {
    const id = setInterval(() => {
      const p = live.player;
      setKmh(Math.round(Math.abs(p.speed) * 3.6));
      setNearCar(cityStore.get().playerMode === 'walk' && Math.hypot(p.x - heroCar.x, p.z - heroCar.z) < 6);
      const i = Math.round(p.x / PITCH), j = Math.round(p.z / PITCH);
      setDistrict(i === 0 && j === 0 ? 'Quảng trường FRT' : DISTRICTS[Math.abs(i * 7 + j * 3) % DISTRICTS.length]);
    }, 100);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    let idx = 0; let hide: ReturnType<typeof setTimeout>;
    const show = () => { setMission(MISSIONS[idx++ % MISSIONS.length]); clearTimeout(hide); hide = setTimeout(() => setMission(null), 6500); };
    const first = setTimeout(show, 2500);
    const iv = setInterval(show, 30000);
    return () => { clearTimeout(first); clearInterval(iv); clearTimeout(hide); };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || (t.tagName === 'INPUT' && !['range', 'checkbox', 'radio', 'button'].includes((t as HTMLInputElement).type)))) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.code === 'KeyH') { setHelp((h) => !h); e.preventDefault(); }
      else if (e.code === 'KeyM') { cityStore.set({ muted: !cityStore.get().muted }); e.preventDefault(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const fd = floor !== null ? FLOOR_DEPARTMENTS.find((f) => f.floor === floor) : undefined;
  const banner = fd ? `F-TOWN 3 – ${fd.label}: ${fd.name}` : district;
  const date = new Date().toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
  const weatherLabel = WEATHERS.find((w) => w[0] === weather)?.[1] ?? '';

  const setCamera = (c: CameraMode) => {
    if (c === 'drive') { setDriving(true); return; }
    if (c === 'follow' && cityStore.get().playerMode === 'none') cityStore.set({ cameraMode: c, playerMode: 'walk' });
    else cityStore.set({ cameraMode: c });
  };
  const walk = () => {
    if (cityStore.get().playerMode === 'drive') setDriving(false);
    else cityStore.set({ playerMode: 'walk', cameraMode: 'follow' });
  };

  return (
    <div className="pointer-events-none absolute inset-0 z-10 select-none text-white" style={{ fontFamily: FONT }}>
      {/* Letterbox */}
      <div className="absolute left-0 right-0 top-0 bg-black transition-all duration-700" style={{ height: camera === 'cinematic' ? '12vh' : 0 }} />
      <div className="absolute left-0 right-0 bottom-0 bg-black transition-all duration-700" style={{ height: camera === 'cinematic' ? '12vh' : 0 }} />

      {/* Mission toast */}
      <div className={`absolute top-6 left-1/2 -translate-x-1/2 transition-all duration-500 ${mission ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-3'}`}>
        <div className="bg-black/70 border-l-4 border-amber-400 px-5 py-2 rounded shadow-[0_0_20px_rgba(251,191,36,0.3)]">
          <div className={LABEL}>Nhiệm vụ mới</div>
          <div className="text-lg font-bold uppercase tracking-wide">Nhiệm vụ: {mission}</div>
        </div>
      </div>

      {/* Top-left: help */}
      <div className="absolute top-4 left-4 flex flex-col gap-2 items-start">
        <div className="flex gap-2">
          <Btn onClick={onExit} className="!bg-red-600/80 !border-red-400 !text-white">Thoát về 2D</Btn>
          <Btn active={help} onClick={() => setHelp((h) => !h)} title="Phím H">Điều khiển [H]</Btn>
        </div>
        {help && (
          <div className={`${PANEL} p-3 text-xs w-60`}>
            <div className={`${LABEL} mb-1`}>Điều khiển</div>
            <ul className="space-y-0.5 text-white/85 uppercase tracking-wide font-medium">
              <li><b className="text-amber-300">W A S D</b> – di chuyển / lái</li>
              <li><b className="text-amber-300">Shift</b> – chạy nhanh / tăng tốc</li>
              <li><b className="text-amber-300">Space</b> – nhảy / phanh tay (drift)</li>
              <li><b className="text-amber-300">F</b> – lên / xuống xe</li>
              <li><b className="text-amber-300">Chuột</b> – xoay camera</li>
              <li><b className="text-amber-300">M</b> – bật / tắt âm</li>
              <li><b className="text-amber-300">H</b> – ẩn / hiện bảng này</li>
            </ul>
          </div>
        )}
      </div>

      {/* Top-right: clock + control panel */}
      <div className="absolute top-4 right-4 w-64 flex flex-col gap-2 items-end max-h-[calc(100vh-2rem)]">
        <div className="text-right drop-shadow-[0_2px_6px_rgba(0,0,0,0.9)]">
          <div className="text-5xl font-bold tracking-wider text-white leading-none">{fmtTime(minute)}</div>
          <div className="text-sm uppercase tracking-widest text-amber-300">{weatherLabel}</div>
          <div className="text-[11px] uppercase tracking-widest text-white/70">{date}</div>
        </div>
        <Btn active={panelOpen} onClick={() => setPanelOpen((o) => !o)}>{panelOpen ? 'Ẩn bảng điều khiển' : 'Bảng điều khiển'}</Btn>
        {panelOpen && (
          <div className={`${PANEL} p-3 w-full overflow-y-auto space-y-3`}>
            <div>
              <div className={LABEL}>Thời gian</div>
              <input
                type="range" min={0} max={1439} value={minute} className="w-full accent-amber-400"
                onChange={(e) => cityStore.set({ timeOfDay: Number(e.target.value) / 60, autoTime: false })}
                onPointerUp={(e) => (e.target as HTMLElement).blur()}
              />
              <Btn active={autoTime} onClick={() => cityStore.set({ autoTime: !autoTime })}>Tự động {autoTime ? 'bật' : 'tắt'}</Btn>
            </div>
            <div>
              <div className={LABEL}>Thời tiết</div>
              <div className="flex flex-wrap gap-1">{WEATHERS.map(([k, l]) => <Btn key={k} active={weather === k} onClick={() => cityStore.set({ weather: k })}>{l}</Btn>)}</div>
            </div>
            <div>
              <div className={LABEL}>Chất lượng</div>
              <div className="flex gap-1">{QUALITIES.map(([k, l]) => <Btn key={k} active={quality === k} onClick={() => cityStore.set({ quality: k })}>{l}</Btn>)}</div>
            </div>
            <div>
              <div className={LABEL}>Camera</div>
              <div className="flex flex-wrap gap-1">{CAMERAS.map(([k, l]) => <Btn key={k} active={camera === k} onClick={() => setCamera(k)}>{l}</Btn>)}</div>
            </div>
            <div>
              <div className={LABEL}>Thang máy – chọn tầng</div>
              <div className="grid grid-cols-4 gap-1">
                {FLOOR_DEPARTMENTS.map((f) => (
                  <Btn key={f.floor} active={floor === f.floor} title={f.name} onClick={() => cityStore.set({ selectedFloor: f.floor, cameraMode: 'cutaway' })}>{f.label}</Btn>
                ))}
                <Btn active={floor === null} onClick={() => cityStore.set({ selectedFloor: null, cameraMode: 'orbit' })} className="col-span-4">Toàn bộ</Btn>
              </div>
            </div>
            <div className="flex flex-wrap gap-1">
              <Btn active={mode === 'walk'} onClick={walk}>Đi bộ</Btn>
              <Btn active={mode === 'drive'} onClick={() => setDriving(true)}>Lái xe</Btn>
              <Btn active={!muted} onClick={() => cityStore.set({ muted: !muted })}>{muted ? 'Âm thanh: tắt' : 'Âm thanh: bật'}</Btn>
            </div>
          </div>
        )}
      </div>

      {/* Bottom-left: minimap + banner */}
      <div className="absolute bottom-5 left-5 flex flex-col gap-2 items-start" style={{ marginBottom: camera === 'cinematic' ? '12vh' : 0 }}>
        <div className="bg-black/65 border-l-4 border-amber-400 px-3 py-1 rounded max-w-[22rem]">
          <div className="text-base font-bold uppercase tracking-wider">{banner}</div>
        </div>
        <div className="p-1 rounded-full bg-black/50"><Minimap /></div>
      </div>

      {/* Interaction prompt */}
      {nearCar && (
        <div className="absolute bottom-28 left-1/2 -translate-x-1/2 bg-black/70 border border-amber-400/60 rounded px-4 py-1.5 text-sm font-bold uppercase tracking-widest">
          Nhấn <span className="px-1.5 py-0.5 bg-amber-400 text-black rounded mx-1">F</span> để lên xe
        </div>
      )}
      {mode === 'drive' && (
        <div className="absolute bottom-28 left-1/2 -translate-x-1/2 text-[11px] uppercase tracking-widest text-white/70">Nhấn F để xuống xe</div>
      )}

      {/* Speedometer */}
      {mode === 'drive' && (
        <div className={`${PANEL} absolute bottom-6 right-6 px-5 py-3 text-right`} style={{ marginBottom: camera === 'cinematic' ? '12vh' : 0 }}>
          <div className="text-6xl font-bold leading-none tabular-nums text-white drop-shadow-[0_0_10px_rgba(251,191,36,0.6)]">{kmh}</div>
          <div className={LABEL}>km/h</div>
          <div className="mt-2 h-1.5 w-40 bg-white/10 rounded overflow-hidden">
            <div className="h-full bg-gradient-to-r from-amber-300 to-red-500 transition-all" style={{ width: `${Math.min(100, (kmh / 190) * 100)}%` }} />
          </div>
        </div>
      )}
    </div>
  );
};
