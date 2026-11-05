/**
 * Danh sách chuẩn 30 nhân sự điều phối trong Khoang NHÀ THUỐC (`FT3.III2A.1.*` - Virtual FRT Office 2D)
 * Sử dụng chính xác SeatCode (`FT3.III2A.1.xxx`) và Account thật từ sơ đồ Excel Seat Map:
 *
 * Cơ cấu 30 thành viên chủ lực trong 9 Cụm đảo bàn (3x3 Islands):
 * - 01 Project Manager (PM): EMP-01 (`DongNQ6` tại `FT3.III2A.1.289` - Bàn Đỏ đặc biệt Cụm 3.2)
 * - 02 Business Analysts (BA): EMP-02 (`ThoaPTN1` - `1.096`), EMP-03 (`HieuNT181 (KH)` - `1.285/286`)
 * - 03 Tech Leads (TECH_LEAD): EMP-04 (`ThanhDQ13` - `1.194/195` [Ô Vàng]), EMP-05 (`LuuTV6` - `1.197`), EMP-06 (`ManhPT13` - `1.210`)
 * - 08 Backend Engineers (BACKEND): EMP-07 (`ChienND22` - `1.191`), EMP-08 (`CuongTN2` - `1.190`), EMP-09 (`CuongDNQ2` - `1.196`),
 *   EMP-10 (`ToanNLV` - `1.192`), EMP-11 (`QuyenNVC` - `1.193`), EMP-12 (`TrungTM7` - `1.105`), EMP-13 (`KhiemHT` - `1.100`), EMP-14 (`LanTTP` - `1.106`)
 * - 06 Frontend Engineers (FRONTEND): EMP-15 (`BaoNAT` - `1.198`), EMP-16 (`ThuanHM12` - `1.201/202`), EMP-17 (`LongBK2` - `1.199`),
 *   EMP-18 (`TriPHC` - `1.205`), EMP-19 (`KienNT178` - `1.208/209`), EMP-20 (`ThieuNV5` - `1.207`)
 * - 04 Mobile Engineers (MOBILE): EMP-21 (`KhoaLNT` - `1.294`), EMP-22 (`HuyNT83` - `1.296`), EMP-23 (`LyNH16` - `1.292/293`), EMP-24 (`ThienTM2` - `1.297`)
 * - 04 QA / QC Engineers (QA): EMP-25 (`TranTNN` - `1.287`), EMP-26 (`TrucNN4` - `1.288`), EMP-27 (`ThanhNX7` - `1.290`), EMP-28 (`PhongNT84` - `1.284`)
 * - 02 DevOps / SRE Engineers (DEVOPS): EMP-29 (`TienHK` - `1.281`), EMP-30 (`SonNA2` - `1.278/279`)
 */

import { Employee, Role } from '../types/office';
import { DESK_BY_ID } from './officeLayout';

/** Bảng màu & nhãn hiển thị chuẩn cho từng Role trong văn phòng */
export const ROLE_METADATA: Record<
  Role,
  {
    label: string;
    shortLabel: string;
    primaryColor: string;
    badgeColor: string;
    description: string;
  }
> = {
  PM: {
    label: 'Project Manager',
    shortLabel: 'PM',
    primaryColor: '#dc2626', // Red Highlight (khớp ô đỏ DongNQ6 - FT3.III2A.1.289)
    badgeColor: '#fee2e2',
    description: 'Quản lý dự án (DongNQ6 - FT3.III2A.1.289), điều phối Sprint & nghiệm thu tài liệu khi Ticket DONE',
  },
  BA: {
    label: 'Business Analyst',
    shortLabel: 'BA',
    primaryColor: '#eab308', // Yellow
    badgeColor: '#fef9c3',
    description: 'Phân tích nghiệp vụ Nhà Thuốc, viết SRS/User Story và bàn giao cho Tech Lead/Dev',
  },
  TECH_LEAD: {
    label: 'Tech Lead',
    shortLabel: 'LEAD',
    primaryColor: '#a855f7', // Purple
    badgeColor: '#f3e8ff',
    description: 'Thiết kế kiến trúc, phân rã task kỹ thuật và thực hiện Code Review',
  },
  BACKEND: {
    label: 'Backend Engineer',
    shortLabel: 'BE',
    primaryColor: '#3b82f6', // Blue
    badgeColor: '#dbeafe',
    description: 'Phát triển Core Microservices Nhà Thuốc, REST/gRPC API & Database',
  },
  FRONTEND: {
    label: 'Frontend Engineer',
    shortLabel: 'FE',
    primaryColor: '#10b981', // Emerald Green
    badgeColor: '#d1fae5',
    description: 'Phát triển giao diện Web POS Nhà Thuốc, Omni-Channel & UI Components',
  },
  MOBILE: {
    label: 'Mobile Engineer',
    shortLabel: 'MOB',
    primaryColor: '#ec4899', // Pink
    badgeColor: '#fce7f3',
    description: 'Phát triển ứng dụng Long Châu Super App (iOS, Android, Flutter & React Native)',
  },
  QA: {
    label: 'QA / QC Engineer',
    shortLabel: 'QA',
    primaryColor: '#f97316', // Orange
    badgeColor: '#ffedd5',
    description: 'Kiểm thử phần mềm, Automation Test & xác nhận chất lượng trước khi báo DONE về DongNQ6',
  },
  DEVOPS: {
    label: 'DevOps / SRE',
    shortLabel: 'OPS',
    primaryColor: '#06b6d4', // Cyan
    badgeColor: '#cffafe',
    description: 'Quản lý CI/CD Pipeline, Kubernetes, Cloud Infrastructure & Release',
  },
};

interface EmployeeSeed {
  id: string;
  code: string;
  account: string;
  seatCode: string;
  islandId: string;
  name: string;
  displayName: string;
  initials: string;
  role: Role;
  title: string;
  squad: string;
  deskId: string;
  skills: string[];
  isProjectManager?: boolean;
  isFemaleManager?: boolean;
  isManager?: boolean;
  managerMood?: 'loving' | 'angry' | 'happy' | 'worried';
  speedMultiplier?: number;
  patrolWing?: 'EAST' | 'NORTH' | 'WEST_CENTRAL' | 'SOUTH';
  gender?: 'male' | 'female';
  customAvatarColor?: string;
  customBadgeColor?: string;
  baseSpeed?: number;
  deskDocumentCount?: number;
  defaultSpeechText?: string;
}

export const FEMALE_MANAGER_ID = 'EMP-MANAGER-THUNDM';
export const MANAGER_TOANLBK_ID = 'EMP-MANAGER-TOANLBK';
export const MANAGER_DOANNT19_ID = 'EMP-MANAGER-DOANNT19';
export const MANAGER_VANLTB8_ID = 'EMP-MANAGER-VANLTB8';
export const BOSS_ROTATION_IDS = [
  'EMP-MANAGER-THUNDM',
  'EMP-MANAGER-TOANLBK',
  'EMP-MANAGER-DOANNT19',
  'EMP-MANAGER-VANLTB8',
] as const;

const EMPLOYEE_SEEDS: EmployeeSeed[] = [
  // ==========================================================================
  // 0. 4 VỊ SẾP ĐI TUẦN TRA 4 PHÒNG KHÁC NHAU (`ThuNDM`, `ToanLBK`, `doannt19`, `vanltb8`)
  // ==========================================================================
  // Sếp 1: ThuNDM (Nữ — Khoang Đông / Khoang Nhà Thuốc FT3.III2A.1, thả tim ❤️ 💖 ✨)
  {
    id: 'EMP-MANAGER-THUNDM',
    code: 'FT3.III2A.1.VIP',
    account: 'ThuNDM',
    seatCode: 'FT3.III2A.1.VIP',
    islandId: 'FT3.III2A.1 • SẾP NỮ',
    name: 'ThuNDM (Sếp Nữ — Khoang Đông)',
    displayName: 'ThuNDM',
    initials: 'TN',
    role: 'PM',
    title: 'Sếp Nữ / Director — Khoang Đông / Nhà Thuốc (Đi thả tim khích lệ anh em ❤️)',
    squad: 'Khoang Đông (Nhà Thuốc FT3.III2A.1) • 👑 ThuNDM ❤️',
    deskId: 'DESK-MANAGER-THUNDM',
    skills: ['Executive Leadership', 'Team Motivation ❤️', 'Pharmacy Strategy', 'People Care 💖'],
    isFemaleManager: true,
    isManager: true,
    managerMood: 'loving',
    speedMultiplier: 1.0,
    patrolWing: 'EAST',
    gender: 'female',
    customAvatarColor: '#e11d48', // Ruby Rose / Rose Gold
    customBadgeColor: '#ffe4e6',
    baseSpeed: 98,
    deskDocumentCount: 0,
    defaultSpeechText: 'Team Nhà Thuốc làm tốt lắm! Sếp ThuNDM thả tim nè ❤️✨',
  },
  // Sếp 2: ToanLBK (Nam — Tốc độ 1.5x người thường, Trạng thái LUÔN GIẬN DỮ 💢😡 — Khoang Bắc North Wing)
  {
    id: 'EMP-MANAGER-TOANLBK',
    code: 'FT3.NORTH.VIP',
    account: 'ToanLBK',
    seatCode: 'FT3.NORTH.VIP',
    islandId: 'NORTH WING • SẾP TOANLBK',
    name: 'ToanLBK (Sếp Nam — Khoang Bắc)',
    displayName: 'ToanLBK',
    initials: 'TL',
    role: 'TECH_LEAD',
    title: 'Sếp Nam / Director — Khoang Bắc (Tốc độ 1.5x • Luôn giận dữ thúc tiến độ 💢😡)',
    squad: 'Khoang Bắc (North Wing) • 👑 ToanLBK 💢 (1.5x Speed)',
    deskId: 'DESK-MANAGER-TOANLBK',
    skills: ['High-Speed Patrol 1.5x', 'Strict Deadline 💢', 'Architecture Review 🔥', 'Zero Bug Tolerance ⚡'],
    isManager: true,
    managerMood: 'angry',
    speedMultiplier: 1.5,
    patrolWing: 'NORTH',
    gender: 'male',
    customAvatarColor: '#991b1b', // Đỏ Đô - Đen
    customBadgeColor: '#fee2e2',
    baseSpeed: 165, // Nhân với speedMultiplier 1.5 = 247.5 px/s (1.5x người thường!)
    deskDocumentCount: 0,
    defaultSpeechText: '💢 Sao ticket này chưa xong hả?! Tăng tốc lên ngay cho tôi!! 🔥😡',
  },
  // Sếp 3: doannt19 (Nữ — Trạng thái LUÔN VUI VẺ CƯỜI TƯƠI 😄🌸 — Khoang Tây-Trung West/Central Wing)
  {
    id: 'EMP-MANAGER-DOANNT19',
    code: 'FT3.CENTRAL.VIP',
    account: 'doannt19',
    seatCode: 'FT3.CENTRAL.VIP',
    islandId: 'WEST-CENTRAL • SẾP DOANNT19',
    name: 'doannt19 (Sếp Nữ — Khoang Tây-Trung)',
    displayName: 'doannt19',
    initials: 'DN',
    role: 'BA',
    title: 'Sếp Nữ / Director — Khoang Tây-Trung (Luôn vui vẻ cười tươi rạng rỡ 😄🌸)',
    squad: 'Khoang Tây-Trung (West-Central Wing) • 👑 doannt19 😄',
    deskId: 'DESK-MANAGER-DOANNT19',
    skills: ['Positive Energy 😄', 'Product Vision 🌸', 'Happy Culture ✨', 'Agile Coaching 🎵'],
    isManager: true,
    managerMood: 'happy',
    speedMultiplier: 1.05,
    patrolWing: 'WEST_CENTRAL',
    gender: 'female',
    customAvatarColor: '#f59e0b', // Vàng Nắng / Cam Đào
    customBadgeColor: '#fef3c7',
    baseSpeed: 110,
    deskDocumentCount: 0,
    defaultSpeechText: '😄 Hôm nay trời đẹp quá, cố lên nhé cả nhà ơi! Cười tươi lên nào 🌸✨🎵',
  },
  // Sếp 4: vanltb8 (Nữ — Trạng thái LUÔN LO LẮNG 😰💧 — Khoang Nam South Wing)
  {
    id: 'EMP-MANAGER-VANLTB8',
    code: 'FT3.SOUTH.VIP',
    account: 'vanltb8',
    seatCode: 'FT3.SOUTH.VIP',
    islandId: 'SOUTH WING • SẾP VANLTB8',
    name: 'vanltb8 (Sếp Nữ — Khoang Nam)',
    displayName: 'vanltb8',
    initials: 'VL',
    role: 'QA',
    title: 'Sếp Nữ / Director — Khoang Nam (Luôn lo lắng rủi ro & tiến độ UAT 😰💧)',
    squad: 'Khoang Nam (South Wing) • 👑 vanltb8 😰',
    deskId: 'DESK-MANAGER-VANLTB8',
    skills: ['Risk Monitoring 😰', 'UAT Verification 💧', 'Release Safety ⚠️', 'Quality Guard 💦'],
    isManager: true,
    managerMood: 'worried',
    speedMultiplier: 1.15,
    patrolWing: 'SOUTH',
    gender: 'female',
    customAvatarColor: '#4f46e5', // Xanh Tím / Indigo
    customBadgeColor: '#e0e7ff',
    baseSpeed: 115,
    deskDocumentCount: 0,
    defaultSpeechText: '😰 Ôi trời ơi kịp giờ golive UAT không đây... Lo quá đi mất!! 💧💦⚠️',
  },

  // ==========================================================================
  // 1. PROJECT MANAGER (01) - Bàn Đỏ đặc biệt FT3.III2A.1.289 (DongNQ6) ở Cụm 3.2
  // ==========================================================================
  {
    id: 'EMP-01',
    code: 'FT3.III2A.1.289',
    account: 'DongNQ6',
    seatCode: 'FT3.III2A.1.289',
    islandId: 'ISLAND-3.2',
    name: 'DongNQ6 (Nguyễn Quốc Đông)',
    displayName: 'DongNQ6',
    initials: 'DN',
    role: 'PM',
    title: 'Project Manager / Unit Lead — Khoang NHÀ THUỐC',
    squad: 'Cụm 3.2 • FT3.III2A.1.289 (Bàn Đỏ)',
    deskId: 'DESK-01',
    skills: ['Agile/Scrum', 'Jira Workflow', 'Release Sign-off', 'Pharmacy Core'],
    isProjectManager: true,
    deskDocumentCount: 4,
  },

  // ==========================================================================
  // 2. BUSINESS ANALYSTS (02) - ThoaPTN1 & HieuNT181 (KH)
  // ==========================================================================
  {
    id: 'EMP-02',
    code: 'FT3.III2A.1.096',
    account: 'ThoaPTN1',
    seatCode: 'FT3.III2A.1.096',
    islandId: 'ISLAND-1.2',
    name: 'ThoaPTN1 (Phạm Thị Ngọc Thoa)',
    displayName: 'ThoaPTN1',
    initials: 'TP',
    role: 'BA',
    title: 'Lead Business Analyst (NHÀ THUỐC)',
    squad: 'Cụm 1.2 • FT3.III2A.1.096',
    deskId: 'DESK-02',
    skills: ['SRS Documentation', 'Pharmacy Domain', 'BPMN 2.0', 'User Stories'],
    deskDocumentCount: 2,
  },
  {
    id: 'EMP-03',
    code: 'FT3.III2A.1.285/286',
    account: 'HieuNT181 (KH)',
    seatCode: 'FT3.III2A.1.285/286',
    islandId: 'ISLAND-3.2',
    name: 'HieuNT181 (KH) (Nguyễn Trung Hiếu)',
    displayName: 'HieuNT181 (KH)',
    initials: 'HN',
    role: 'BA',
    title: 'Product Business Analyst (KH)',
    squad: 'Cụm 3.2 • FT3.III2A.1.285/286',
    deskId: 'DESK-03',
    skills: ['API Spec Analysis', 'Acceptance Criteria', 'POS Workflow', 'SQL'],
    deskDocumentCount: 2,
  },

  // ==========================================================================
  // 3. TECH LEADS (03) - ThanhDQ13 (Ô vàng), LuuTV6, ManhPT13
  // ==========================================================================
  {
    id: 'EMP-04',
    code: 'FT3.III2A.1.194/195',
    account: 'ThanhDQ13',
    seatCode: 'FT3.III2A.1.194/195',
    islandId: 'ISLAND-2.1',
    name: 'ThanhDQ13 (Đỗ Quang Thanh)',
    displayName: 'ThanhDQ13',
    initials: 'TD',
    role: 'TECH_LEAD',
    title: 'Backend Tech Lead (Ô Vàng Nổi Bật)',
    squad: 'Cụm 2.1 • FT3.III2A.1.194/195',
    deskId: 'DESK-04',
    skills: ['System Architecture', 'Golang', 'Microservices', 'Kafka', 'PostgreSQL'],
    deskDocumentCount: 2,
  },
  {
    id: 'EMP-05',
    code: 'FT3.III2A.1.197',
    account: 'LuuTV6',
    seatCode: 'FT3.III2A.1.197',
    islandId: 'ISLAND-2.2',
    name: 'LuuTV6 (Trần Văn Lưu)',
    displayName: 'LuuTV6',
    initials: 'LT',
    role: 'TECH_LEAD',
    title: 'Frontend Tech Lead',
    squad: 'Cụm 2.2 • FT3.III2A.1.197',
    deskId: 'DESK-05',
    skills: ['React 18', 'TypeScript', 'Micro-Frontends', 'Code Review'],
    deskDocumentCount: 1,
  },
  {
    id: 'EMP-06',
    code: 'FT3.III2A.1.210',
    account: 'ManhPT13',
    seatCode: 'FT3.III2A.1.210',
    islandId: 'ISLAND-2.3',
    name: 'ManhPT13 (Phạm Thế Mạnh)',
    displayName: 'ManhPT13',
    initials: 'MP',
    role: 'TECH_LEAD',
    title: 'Mobile & Integration Tech Lead',
    squad: 'Cụm 2.3 • FT3.III2A.1.210',
    deskId: 'DESK-06',
    skills: ['Flutter', 'iOS/Android Native', 'System Integration', 'GraphQL'],
    deskDocumentCount: 1,
  },

  // ==========================================================================
  // 4. BACKEND ENGINEERS (08) - Cụm 2.1 & Cụm 1.1
  // ==========================================================================
  {
    id: 'EMP-07',
    code: 'FT3.III2A.1.191',
    account: 'ChienND22',
    seatCode: 'FT3.III2A.1.191',
    islandId: 'ISLAND-2.1',
    name: 'ChienND22 (Nguyễn Đức Chiến)',
    displayName: 'ChienND22',
    initials: 'CN',
    role: 'BACKEND',
    title: 'Senior Backend Engineer',
    squad: 'Cụm 2.1 • FT3.III2A.1.191',
    deskId: 'DESK-07',
    skills: ['Golang', 'gRPC', 'Redis', 'PostgreSQL'],
  },
  {
    id: 'EMP-08',
    code: 'FT3.III2A.1.190',
    account: 'CuongTN2',
    seatCode: 'FT3.III2A.1.190',
    islandId: 'ISLAND-2.1',
    name: 'CuongTN2 (Trần Ngọc Cường)',
    displayName: 'CuongTN2',
    initials: 'CT',
    role: 'BACKEND',
    title: 'Senior Backend Engineer',
    squad: 'Cụm 2.1 • FT3.III2A.1.190',
    deskId: 'DESK-08',
    skills: ['Java Spring Boot', 'Kafka', 'Oracle DB', 'OAuth2'],
  },
  {
    id: 'EMP-09',
    code: 'FT3.III2A.1.196',
    account: 'CuongDNQ2',
    seatCode: 'FT3.III2A.1.196',
    islandId: 'ISLAND-2.1',
    name: 'CuongDNQ2 (Đặng Ngọc Quốc Cường)',
    displayName: 'CuongDNQ2',
    initials: 'CĐ',
    role: 'BACKEND',
    title: 'Backend Software Engineer',
    squad: 'Cụm 2.1 • FT3.III2A.1.196',
    deskId: 'DESK-09',
    skills: ['NestJS', 'TypeScript', 'MongoDB', 'RabbitMQ'],
  },
  {
    id: 'EMP-10',
    code: 'FT3.III2A.1.192',
    account: 'ToanNLV',
    seatCode: 'FT3.III2A.1.192',
    islandId: 'ISLAND-2.1',
    name: 'ToanNLV (Nguyễn Lê Văn Toàn)',
    displayName: 'ToanNLV',
    initials: 'TN',
    role: 'BACKEND',
    title: 'Backend Software Engineer',
    squad: 'Cụm 2.1 • FT3.III2A.1.192',
    deskId: 'DESK-10',
    skills: ['Golang', 'Elasticsearch', 'Redis', 'Docker'],
  },
  {
    id: 'EMP-11',
    code: 'FT3.III2A.1.193',
    account: 'QuyenNVC',
    seatCode: 'FT3.III2A.1.193',
    islandId: 'ISLAND-2.1',
    name: 'QuyenNVC (Nguyễn Văn Công Quyền)',
    displayName: 'QuyenNVC',
    initials: 'QN',
    role: 'BACKEND',
    title: 'Backend Software Engineer',
    squad: 'Cụm 2.1 • FT3.III2A.1.193',
    deskId: 'DESK-11',
    skills: ['Node.js', 'PostgreSQL', 'GraphQL', 'BullMQ'],
  },
  {
    id: 'EMP-12',
    code: 'FT3.III2A.1.105',
    account: 'TrungTM7',
    seatCode: 'FT3.III2A.1.105',
    islandId: 'ISLAND-1.1',
    name: 'TrungTM7 (Trần Minh Trung)',
    displayName: 'TrungTM7',
    initials: 'TT',
    role: 'BACKEND',
    title: 'Backend Software Engineer',
    squad: 'Cụm 1.1 • FT3.III2A.1.105',
    deskId: 'DESK-12',
    skills: ['Python FastAPI', 'PostgreSQL', 'Celery', 'Redis'],
  },
  {
    id: 'EMP-13',
    code: 'FT3.III2A.1.100',
    account: 'KhiemHT',
    seatCode: 'FT3.III2A.1.100',
    islandId: 'ISLAND-1.1',
    name: 'KhiemHT (Hoàng Trọng Khiêm)',
    displayName: 'KhiemHT',
    initials: 'KH',
    role: 'BACKEND',
    title: 'Backend Engineer',
    squad: 'Cụm 1.1 • FT3.III2A.1.100',
    deskId: 'DESK-13',
    skills: ['Golang', 'MySQL', 'Kafka', 'gRPC'],
  },
  {
    id: 'EMP-14',
    code: 'FT3.III2A.1.106',
    account: 'LanTTP',
    seatCode: 'FT3.III2A.1.106',
    islandId: 'ISLAND-1.1',
    name: 'LanTTP (Trần Thị Phương Lan)',
    displayName: 'LanTTP',
    initials: 'LT',
    role: 'BACKEND',
    title: 'Backend Engineer',
    squad: 'Cụm 1.1 • FT3.III2A.1.106',
    deskId: 'DESK-14',
    skills: ['.NET Core', 'SQL Server', 'REST API', 'Azure Bus'],
  },

  // ==========================================================================
  // 5. FRONTEND ENGINEERS (06) - Cụm 2.2 & Cụm 2.3
  // ==========================================================================
  {
    id: 'EMP-15',
    code: 'FT3.III2A.1.198',
    account: 'BaoNAT',
    seatCode: 'FT3.III2A.1.198',
    islandId: 'ISLAND-2.2',
    name: 'BaoNAT (Nguyễn Anh Thiên Bảo)',
    displayName: 'BaoNAT',
    initials: 'BN',
    role: 'FRONTEND',
    title: 'Senior Frontend Engineer',
    squad: 'Cụm 2.2 • FT3.III2A.1.198',
    deskId: 'DESK-15',
    skills: ['Next.js', 'React', 'TypeScript', 'TailwindCSS'],
  },
  {
    id: 'EMP-16',
    code: 'FT3.III2A.1.201/202',
    account: 'ThuanHM12',
    seatCode: 'FT3.III2A.1.201/202',
    islandId: 'ISLAND-2.2',
    name: 'ThuanHM12 (Hoàng Minh Thuận)',
    displayName: 'ThuanHM12',
    initials: 'TH',
    role: 'FRONTEND',
    title: 'Senior Frontend Engineer',
    squad: 'Cụm 2.2 • FT3.III2A.1.201/202',
    deskId: 'DESK-16',
    skills: ['React', 'Zustand', 'TanStack Query', 'Vite'],
  },
  {
    id: 'EMP-17',
    code: 'FT3.III2A.1.199',
    account: 'LongBK2',
    seatCode: 'FT3.III2A.1.199',
    islandId: 'ISLAND-2.2',
    name: 'LongBK2 (Bùi Khánh Long)',
    displayName: 'LongBK2',
    initials: 'LB',
    role: 'FRONTEND',
    title: 'Frontend Engineer',
    squad: 'Cụm 2.2 • FT3.III2A.1.199',
    deskId: 'DESK-17',
    skills: ['React', 'TypeScript', 'Ant Design', 'Chart.js'],
  },
  {
    id: 'EMP-18',
    code: 'FT3.III2A.1.205',
    account: 'TriPHC',
    seatCode: 'FT3.III2A.1.205',
    islandId: 'ISLAND-2.3',
    name: 'TriPHC (Phan Hoàng Cao Trí)',
    displayName: 'TriPHC',
    initials: 'TP',
    role: 'FRONTEND',
    title: 'Frontend Engineer',
    squad: 'Cụm 2.3 • FT3.III2A.1.205',
    deskId: 'DESK-18',
    skills: ['Next.js', 'GraphQL', 'SCSS', 'Playwright'],
  },
  {
    id: 'EMP-19',
    code: 'FT3.III2A.1.208/209',
    account: 'KienNT178',
    seatCode: 'FT3.III2A.1.208/209',
    islandId: 'ISLAND-2.3',
    name: 'KienNT178 (Nguyễn Trung Kiên)',
    displayName: 'KienNT178',
    initials: 'KN',
    role: 'FRONTEND',
    title: 'Frontend UI/UX Engineer',
    squad: 'Cụm 2.3 • FT3.III2A.1.208/209',
    deskId: 'DESK-19',
    skills: ['React', 'Radix UI', 'Framer Motion', 'Storybook'],
  },
  {
    id: 'EMP-20',
    code: 'FT3.III2A.1.207',
    account: 'ThieuNV5',
    seatCode: 'FT3.III2A.1.207',
    islandId: 'ISLAND-2.3',
    name: 'ThieuNV5 (Nguyễn Văn Thiệu)',
    displayName: 'ThieuNV5',
    initials: 'TN',
    role: 'FRONTEND',
    title: 'Frontend Engineer',
    squad: 'Cụm 2.3 • FT3.III2A.1.207',
    deskId: 'DESK-20',
    skills: ['React', 'HTML5 Canvas', 'WebSockets', 'D3.js'],
  },

  // ==========================================================================
  // 6. MOBILE ENGINEERS (04) - Cụm 3.1
  // ==========================================================================
  {
    id: 'EMP-21',
    code: 'FT3.III2A.1.294',
    account: 'KhoaLNT',
    seatCode: 'FT3.III2A.1.294',
    islandId: 'ISLAND-3.1',
    name: 'KhoaLNT (Lê Nguyễn Trọng Khoa)',
    displayName: 'KhoaLNT',
    initials: 'KL',
    role: 'MOBILE',
    title: 'Senior iOS Engineer',
    squad: 'Cụm 3.1 • FT3.III2A.1.294',
    deskId: 'DESK-21',
    skills: ['Swift', 'SwiftUI', 'Combine', 'Xcode Cloud'],
  },
  {
    id: 'EMP-22',
    code: 'FT3.III2A.1.296',
    account: 'HuyNT83',
    seatCode: 'FT3.III2A.1.296',
    islandId: 'ISLAND-3.1',
    name: 'HuyNT83 (Nguyễn Quang Huy)',
    displayName: 'HuyNT83',
    initials: 'HN',
    role: 'MOBILE',
    title: 'Senior Android Engineer',
    squad: 'Cụm 3.1 • FT3.III2A.1.296',
    deskId: 'DESK-22',
    skills: ['Kotlin', 'Jetpack Compose', 'Coroutines', 'Gradle'],
  },
  {
    id: 'EMP-23',
    code: 'FT3.III2A.1.292/293',
    account: 'LyNH16',
    seatCode: 'FT3.III2A.1.292/293',
    islandId: 'ISLAND-3.1',
    name: 'LyNH16 (Nguyễn Hương Ly)',
    displayName: 'LyNH16',
    initials: 'LN',
    role: 'MOBILE',
    title: 'Flutter Mobile Engineer',
    squad: 'Cụm 3.1 • FT3.III2A.1.292/293',
    deskId: 'DESK-23',
    skills: ['Flutter', 'Dart', 'BLoC', 'Firebase'],
  },
  {
    id: 'EMP-24',
    code: 'FT3.III2A.1.297',
    account: 'ThienTM2',
    seatCode: 'FT3.III2A.1.297',
    islandId: 'ISLAND-3.1',
    name: 'ThienTM2 (Trần Minh Thiện)',
    displayName: 'ThienTM2',
    initials: 'TT',
    role: 'MOBILE',
    title: 'React Native Engineer',
    squad: 'Cụm 3.1 • FT3.III2A.1.297',
    deskId: 'DESK-24',
    skills: ['React Native', 'TypeScript', 'Reanimated', 'OTA Updates'],
  },

  // ==========================================================================
  // 7. QA / QC ENGINEERS (04) - Cụm 3.2
  // ==========================================================================
  {
    id: 'EMP-25',
    code: 'FT3.III2A.1.287',
    account: 'TranTNN',
    seatCode: 'FT3.III2A.1.287',
    islandId: 'ISLAND-3.2',
    name: 'TranTNN (Trần Thị Ngọc Trân)',
    displayName: 'TranTNN',
    initials: 'TT',
    role: 'QA',
    title: 'QA Team Lead (NHÀ THUỐC)',
    squad: 'Cụm 3.2 • FT3.III2A.1.287',
    deskId: 'DESK-25',
    skills: ['Test Strategy', 'Release Sign-off', 'Jira Xray', 'API Testing'],
    deskDocumentCount: 1,
  },
  {
    id: 'EMP-26',
    code: 'FT3.III2A.1.288',
    account: 'TrucNN4',
    seatCode: 'FT3.III2A.1.288',
    islandId: 'ISLAND-3.2',
    name: 'TrucNN4 (Nguyễn Ngọc Trúc)',
    displayName: 'TrucNN4',
    initials: 'TN',
    role: 'QA',
    title: 'Senior Manual & API QC',
    squad: 'Cụm 3.2 • FT3.III2A.1.288',
    deskId: 'DESK-26',
    skills: ['Postman', 'SIT/UAT Testing', 'SQL Verification', 'Bug Triage'],
  },
  {
    id: 'EMP-27',
    code: 'FT3.III2A.1.290',
    account: 'ThanhNX7',
    seatCode: 'FT3.III2A.1.290',
    islandId: 'ISLAND-3.2',
    name: 'ThanhNX7 (Nguyễn Xuân Thành)',
    displayName: 'ThanhNX7',
    initials: 'TN',
    role: 'QA',
    title: 'QA Automation Engineer',
    squad: 'Cụm 3.2 • FT3.III2A.1.290',
    deskId: 'DESK-27',
    skills: ['Playwright', 'Cypress', 'TypeScript', 'GitHub Actions'],
  },
  {
    id: 'EMP-28',
    code: 'FT3.III2A.1.284',
    account: 'PhongNT84',
    seatCode: 'FT3.III2A.1.284',
    islandId: 'ISLAND-3.2',
    name: 'PhongNT84 (Nguyễn Thanh Phong)',
    displayName: 'PhongNT84',
    initials: 'PN',
    role: 'QA',
    title: 'Mobile & Performance QA',
    squad: 'Cụm 3.2 • FT3.III2A.1.284',
    deskId: 'DESK-28',
    skills: ['Appium', 'k6 Load Test', 'JMeter', 'Charles Proxy'],
  },

  // ==========================================================================
  // 8. DEVOPS / SRE ENGINEERS (02) - Cụm 3.3
  // ==========================================================================
  {
    id: 'EMP-29',
    code: 'FT3.III2A.1.281',
    account: 'TienHK',
    seatCode: 'FT3.III2A.1.281',
    islandId: 'ISLAND-3.3',
    name: 'TienHK (Hoàng Kim Tiến)',
    displayName: 'TienHK',
    initials: 'TH',
    role: 'DEVOPS',
    title: 'Lead DevOps / SRE Engineer',
    squad: 'Cụm 3.3 • FT3.III2A.1.281',
    deskId: 'DESK-29',
    skills: ['Kubernetes', 'Terraform', 'AWS/GCP', 'Prometheus & Grafana'],
  },
  {
    id: 'EMP-30',
    code: 'FT3.III2A.1.278/279',
    account: 'SonNA2',
    seatCode: 'FT3.III2A.1.278/279',
    islandId: 'ISLAND-3.3',
    name: 'SonNA2 (Nguyễn Anh Sơn)',
    displayName: 'SonNA2',
    initials: 'SN',
    role: 'DEVOPS',
    title: 'CI/CD & SecOps Engineer',
    squad: 'Cụm 3.3 • FT3.III2A.1.278/279',
    deskId: 'DESK-30',
    skills: ['GitLab CI', 'ArgoCD', 'Docker', 'Vault & SonarQube'],
  },
];

const FEMALE_IDS = new Set([
  'EMP-MANAGER-THUNDM',
  'EMP-MANAGER-DOANNT19',
  'EMP-MANAGER-VANLTB8',
  'EMP-02',
  'EMP-14',
  'EMP-23',
  'EMP-25',
  'EMP-26',
]);

/**
 * Danh sách nhân sự hoàn chỉnh (4 vị Sếp tuần tra 4 phòng + 30 nhân viên điều phối) với tọa độ khởi tạo khớp 1-1
 * với bàn làm việc tại `src/data/officeLayout.ts`.
 * Đầu ngày: 4 vị Sếp có mặt ngay để đi tuần tra; 30 nhân viên bắt đầu với trạng thái chưa vào bàn (`isCheckedIn = false`),
 * ai có Event trước sẽ đi từ `🚪 CỬA RA VÀO` vào công ty chiếm 1 chỗ ngồi!
 */
export const EMPLOYEES: Employee[] = EMPLOYEE_SEEDS.map((seed) => {
  const desk = DESK_BY_ID[seed.deskId];
  const roleMeta = ROLE_METADATA[seed.role];
  const initialSeat = desk ? { ...desk.seatPosition } : { x: 1065, y: 435 };
  const isFemale = seed.gender === 'female' || FEMALE_IDS.has(seed.id);
  const isBoss = Boolean(seed.isManager || seed.isFemaleManager);

  return {
    id: seed.id,
    code: seed.code,
    account: seed.account,
    seatCode: seed.seatCode,
    islandId: seed.islandId,
    name: seed.name,
    displayName: seed.displayName,
    initials: seed.initials,
    role: seed.role,
    title: seed.title,
    squad: seed.squad,
    deskId: seed.deskId,
    avatarColor: seed.customAvatarColor ?? roleMeta.primaryColor,
    badgeColor: seed.customBadgeColor ?? roleMeta.badgeColor,
    jiraAccountId: `jira-frt-${seed.account.toLowerCase().replace(/[^a-z0-9]/g, '')}`,
    email: `${seed.account.toLowerCase().split(' ')[0]}@frt.vn`,
    skills: seed.skills,
    isProjectManager: Boolean(seed.isProjectManager),
    isFemaleManager: Boolean(seed.isFemaleManager),
    isManager: isBoss,
    managerMood: seed.managerMood,
    speedMultiplier: seed.speedMultiplier ?? 1.0,
    patrolWing: seed.patrolWing,
    isCheckedIn: isBoss, // Đầu ngày 100% bàn trống (chỉ 4 Sếp đang đi tuần tra)
    checkedInDeskId: isBoss ? seed.deskId : null,
    isSmokingAtAtrium: false,
    smokingAtriumId: null,
    smokingSpot: null,
    isWalkingFromEntrance: false,
    gender: isFemale ? 'female' : 'male',
    status: isBoss ? 'WALKING_BACK' : 'IDLE',
    currentPosition: initialSeat,
    targetPosition: null,
    currentPath: [],
    currentSegmentIndex: 0,
    facing: desk ? desk.orientation : 'DOWN',
    baseSpeed: seed.baseSpeed ?? 165, // 165 pixels/giây ở tốc độ 1x (nhân thêm speedMultiplier riêng của từng nhân vật)
    carryingTicketId: null,
    deskDocumentCount: 0,
    assignedTicketIds: [],
    completedTransfersCount: 0,
    roamingTargetEmployeeId: seed.isFemaleManager ? 'EMP-01' : null,
    roamingPhase: isBoss ? 'WALKING' : undefined,
    roamingSpeechText: seed.defaultSpeechText ?? null,
  };
});

/** Alias tương thích cho mảng nhân viên */
export const INITIAL_EMPLOYEES: Employee[] = EMPLOYEES;

/** Map tra cứu nhanh nhân viên theo ID (hỗ trợ cả mã chuẩn `EMP-MANAGER-*` và alias `emp-*`) */
export const EMPLOYEE_BY_ID: Record<string, Employee> = {
  ...Object.fromEntries(EMPLOYEES.map((emp) => [emp.id, emp])),
  'emp-thundm': EMPLOYEES.find((e) => e.id === 'EMP-MANAGER-THUNDM')!,
  'emp-toanlbk': EMPLOYEES.find((e) => e.id === 'EMP-MANAGER-TOANLBK')!,
  'emp-doannt19': EMPLOYEES.find((e) => e.id === 'EMP-MANAGER-DOANNT19')!,
  'emp-vanltb8': EMPLOYEES.find((e) => e.id === 'EMP-MANAGER-VANLTB8')!,
};

/** Danh sách 4 vị Sếp theo đúng thứ tự xoay vòng Smart Camera 30s/Sếp */
export const BOSS_EMPLOYEES: Employee[] = BOSS_ROTATION_IDS.map(
  (id) => EMPLOYEE_BY_ID[id]
).filter(Boolean);

/** Nhân viên Project Manager (`EMP-01` - `DongNQ6` tại `FT3.III2A.1.289`) - người nhận tài liệu khi Ticket = DONE */
export const PROJECT_MANAGER: Employee = EMPLOYEE_BY_ID['EMP-01'];

/** Nhân vật Sếp Nữ (`EMP-MANAGER-THUNDM` - `ThuNDM`) - đi vòng vòng thả tim khích lệ các bạn nhân viên */
export const FEMALE_MANAGER: Employee = EMPLOYEE_BY_ID['EMP-MANAGER-THUNDM'];

/** Hàm lấy thông tin nhân viên theo ID */
export function getEmployeeById(employeeId: string): Employee | undefined {
  return EMPLOYEE_BY_ID[employeeId];
}

/** Hàm lọc danh sách nhân viên theo Role */
export function getEmployeesByRole(role: Role): Employee[] {
  return EMPLOYEES.filter((emp) => emp.role === role);
}

/** Hàm lấy Project Manager của phòng (EMP-01 - DongNQ6) */
export function getProjectManager(): Employee {
  return PROJECT_MANAGER;
}
