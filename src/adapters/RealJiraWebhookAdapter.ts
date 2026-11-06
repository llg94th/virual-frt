/**
 * Post-Pilot Production Adapter (`RealJiraWebhookAdapter`) & Real FRT Atom/RSS XML Parsers
 *
 * Supports:
 * 1) Real Jira Cloud / Data Center Webhooks & REST API v3
 * 2) Real FRT Jira Activity Stream Atom XML:
 *    `https://reqs.frt.vn/activity?maxResults=10&providers=issues&os_authType=basic&title=undefined`
 *    (proxied via Vite `/api/frt-jira-activity`)
 * 3) Real FRT Jenkins CI Build RSS/Atom XML:
 *    `https://jenkins-osp.frt.vn/job/oneclickv4-build-ci/rssAll`
 *    (proxied via Vite `/api/frt-jenkins-rss`)
 * 4) Case-insensitive account mapping (`dongnq6` -> `DongNQ6`, `sonna2` -> `SonNA2`, `tienhk` -> `TienHK`...)
 *    to trigger characters walking to hand over documents or walking to the Jenkins Server Station to build!
 */

import {
  CreateTicketInput,
  IJiraAdapter,
  JenkinsBuildJobItem,
  JiraTicket,
  JiraWebhookEvent,
  RamDedupStats,
  TicketPriority,
  TicketStatus,
} from '../types/office';
import { EMPLOYEES, EMPLOYEE_BY_ID, PROJECT_MANAGER } from '../data/employees';
import { NHA_THUOC_SEAT_SLOTS } from '../data/officeLayout';

/** API Public duy nhất đi qua Cloudflare Tunnel & Backend RAM Cache Deduplicator */
export const PUBLIC_OFFICE_STREAM_API_URL = '/api/public/office-stream';

export const FRT_JIRA_ACTIVITY_TARGET_URL =
  'https://reqs.frt.vn/activity?maxResults=10&providers=issues&os_authType=basic&title=undefined';
export const FRT_JIRA_ACTIVITY_PROXY_URL =
  '/api/frt-jira-activity?maxResults=10&providers=issues&os_authType=basic&title=undefined';

export const FRT_JENKINS_RSS_TARGET_URL =
  'https://jenkins-osp.frt.vn/job/oneclickv4-build-ci/rssAll';
export const FRT_JENKINS_RSS_PROXY_URL = '/api/frt-jenkins-rss';

export const FRT_JENKINS_UAT_RSS_TARGET_URL =
  'https://jenkins-osp.frt.vn/job/oneclickv4-build-uat/rssAll';
export const FRT_JENKINS_UAT_RSS_PROXY_URL = '/api/frt-jenkins-uat-rss';

/**
 * Tạo khóa định danh chuẩn (Canonical Fingerprint) cho Jira Activity `<entry>`:
 * Kết hợp `entryId` + `ticketKey` + `fromAccount` + `toAccount` + `toStatus` + `updatedTimestamp`
 */
export function computeJiraActivityFingerprint(params: {
  entryId: string;
  ticketKey: string;
  fromAccount: string;
  toAccount: string;
  toStatus: string;
  updatedTimestamp: string;
}): string {
  return [
    'jira',
    String(params.entryId || '').trim(),
    String(params.ticketKey || '').trim().toUpperCase(),
    normalizeFrtAccountKey(params.fromAccount),
    normalizeFrtAccountKey(params.toAccount),
    String(params.toStatus || '').trim().toUpperCase(),
    String(params.updatedTimestamp || '').trim(),
  ].join(':');
}

/**
 * Tạo khóa định danh chuẩn (Canonical Fingerprint) cho Jenkins Build `<entry>`:
 * `jenkins:${jobName}:#${buildNumber}:${statusNormalized}`
 * Ví dụ: `jenkins:oneclickv4-build-ci:#2846:SUCCESS`
 */
export function computeJenkinsBuildFingerprint(
  jobName: string,
  buildNumber: number,
  statusNormalized: string
): string {
  return `jenkins:${String(jobName || 'oneclickv4-build-ci').trim()}:#${Number(
    buildNumber
  )}:${String(statusNormalized || 'SUCCESS').trim().toUpperCase()}`;
}

export interface PublicOfficeStreamEvent {
  seq: number;
  fingerprint: string;
  kind: 'JIRA_ACTIVITY' | 'JENKINS_BUILD';
  id: string;
  ticketKey: string;
  summary?: string;
  rawTitle?: string;
  authorAccount?: string;
  fromAccount?: string;
  toAccount?: string;
  fromEmployeeId?: string;
  toEmployeeId?: string;
  toStatus?: TicketStatus;
  isReturnToPM?: boolean;
  updatedAt?: string;
  jobName?: string;
  buildNumber?: number;
  status?: 'SUCCESS' | 'FAILURE' | 'UNSTABLE' | 'BUILDING';
  statusText?: string;
  triggeredByAccount?: string;
  employeeId?: string;
  publishedAt?: string;
  timeAgo?: string;
  emittedAt: string;
}

export interface PublicOfficeStreamResponse {
  ok: boolean;
  afterSeq: number;
  latestSeq: number;
  eventsCount: number;
  events: PublicOfficeStreamEvent[];
  newBuildEvents: PublicOfficeStreamEvent[];
  jenkinsSnapshot: JenkinsBuildJobItem[];
  dedupStats: RamDedupStats;
  pollSummary?: {
    sourceUsed: string;
    newEventsInPoll: number;
    droppedInPoll: number;
    message: string;
  };
}

/** Danh sách Jobs mặc định từ `https://jenkins-osp.frt.vn/job/oneclickv4-build-ci/rssAll` */
export const DEFAULT_JENKINS_RECENT_BUILDS: JenkinsBuildJobItem[] = [
  {
    id: 'tag:hudson.dev.java.net,2026:oneclickv4-build-ci:2845',
    buildNumber: 2845,
    jobName: 'oneclickv4-build-ci',
    statusText: 'stable',
    status: 'SUCCESS',
    result: 'SUCCESS',
    timeAgo: '2m ago',
    relativeTime: '2m ago',
    publishedAt: new Date(Date.now() - 2 * 60_000).toISOString(),
    triggeredByAccount: 'TienHK',
    triggeredBy: 'TienHK',
    ticketKey: 'FRT-104',
    link: 'https://jenkins-osp.frt.vn/job/oneclickv4-build-ci/2845/',
  },
  {
    id: 'tag:hudson.dev.java.net,2026:oneclickv4-build-uat:1420',
    buildNumber: 1420,
    jobName: 'oneclickv4-build-uat',
    clusterId: 'UAT',
    statusText: 'stable',
    status: 'SUCCESS',
    result: 'SUCCESS',
    timeAgo: '5m ago',
    relativeTime: '5m ago',
    publishedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
    triggeredByAccount: 'SonNA2',
    triggeredBy: 'SonNA2',
    ticketKey: 'FRT-104',
    link: 'https://jenkins-osp.frt.vn/job/oneclickv4-build-uat/1420/',
  },
  {
    id: 'tag:hudson.dev.java.net,2026:oneclickv4-build-ci:2844',
    buildNumber: 2844,
    jobName: 'oneclickv4-build-ci',
    clusterId: 'CI',
    statusText: 'back to normal',
    status: 'SUCCESS',
    result: 'SUCCESS',
    timeAgo: '11m ago',
    relativeTime: '11m ago',
    publishedAt: new Date(Date.now() - 11 * 60_000).toISOString(),
    triggeredByAccount: 'SonNA2',
    triggeredBy: 'SonNA2',
    ticketKey: 'FRT-103',
    link: 'https://jenkins-osp.frt.vn/job/oneclickv4-build-ci/2844/',
  },
  {
    id: 'tag:hudson.dev.java.net,2026:oneclickv4-build-ci/2843',
    buildNumber: 2843,
    jobName: 'oneclickv4-build-ci',
    statusText: 'broken',
    status: 'FAILURE',
    result: 'FAILURE',
    timeAgo: '28m ago',
    relativeTime: '28m ago',
    publishedAt: new Date(Date.now() - 28 * 60_000).toISOString(),
    triggeredByAccount: 'ChienND22',
    triggeredBy: 'ChienND22',
    ticketKey: 'FRT-102',
    link: 'https://jenkins-osp.frt.vn/job/oneclickv4-build-ci/2843/',
  },
];

/** Mẫu XML thực tế từ `https://reqs.frt.vn/activity?maxResults=10&providers=issues&os_authType=basic&title=undefined` */
export const SAMPLE_FRT_JIRA_ACTIVITY_XML = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:atlassian="http://streams.atlassian.com/syndication/general/1.0" xmlns:usr="http://streams.atlassian.com/syndication/username/1.0" xmlns:activity="http://activitystrea.ms/spec/1.0/">
  <id>https://reqs.frt.vn/activity?maxResults=10&amp;providers=issues&amp;os_authType=basic&amp;title=undefined</id>
  <title type="text">FPT Retail IS - Jira - Activity Stream</title>
  <updated>2026-11-06T00:58:35.285Z</updated>
  <entry>
    <id>urn:uuid:36de079a-97e1-3388-b671-7a3e0e9a0318</id>
    <title type="html">&lt;a href="https://reqs.frt.vn/secure/ViewProfile.jspa?name=106123" class="activity-item-user activity-item-author"&gt;Nguyễn Ngọc Ngân&lt;/a&gt; changed the Assignee to '&lt;a href="https://reqs.frt.vn/secure/ViewProfile.jspa?name=106123" class="activity-item-user"&gt;Nguyễn Ngọc Ngân&lt;/a&gt;' on &lt;a href="https://reqs.frt.vn/browse/TADS-66493"&gt;TADS-66493 - [82735] Kiểm tra shop xem lại ảnh toa thuốc trong đơn nhưng không hiển thị ảnh&lt;/a&gt;</title>
    <author>
      <name>Nguyễn Ngọc Ngân</name>
      <email>ngannn10@fpt.com</email>
      <usr:username>106123</usr:username>
    </author>
    <link rel="alternate" href="https://reqs.frt.vn/browse/TADS-66493" />
    <activity:object>
      <title type="text">TADS-66493</title>
      <summary type="text">[82735] Kiểm tra shop xem lại ảnh toa thuốc trong đơn nhưng không hiển thị ảnh</summary>
    </activity:object>
    <updated>2026-11-06T00:58:35.285Z</updated>
  </entry>
  <entry>
    <id>urn:uuid:33656d62-6d0f-3e5b-9f36-70c3cfed61b2</id>
    <title type="html">&lt;a href="https://reqs.frt.vn/secure/ViewProfile.jspa?name=100442" class="activity-item-user activity-item-author"&gt;Phạm Thanh Sang&lt;/a&gt; attached one file to &lt;a href="https://reqs.frt.vn/browse/TADS-66493"&gt;TADS-66493 - [82735] Kiểm tra shop xem lại ảnh toa thuốc trong đơn nhưng không hiển thị ảnh&lt;/a&gt;</title>
    <author>
      <name>Phạm Thanh Sang</name>
      <email>sangpt19@fpt.com</email>
      <usr:username>100442</usr:username>
    </author>
    <link rel="alternate" href="https://reqs.frt.vn/browse/TADS-66493" />
    <activity:object>
      <title type="text">TADS-66493</title>
      <summary type="text">[82735] Kiểm tra shop xem lại ảnh toa thuốc trong đơn nhưng không hiển thị ảnh</summary>
    </activity:object>
    <updated>2026-11-06T00:57:40.483Z</updated>
  </entry>
  <entry>
    <id>urn:uuid:06b3f36d-022d-3ff8-874f-631b1a61e80e</id>
    <title type="html">&lt;a href="https://reqs.frt.vn/secure/ViewProfile.jspa?name=haind27" class="activity-item-user activity-item-author"&gt;haind27&lt;/a&gt; commented on &lt;a href="https://reqs.frt.vn/browse/FI-35314"&gt;FI-35314 - [LC] Điều chỉnh xuất kho theo FEFO&lt;/a&gt;</title>
    <author>
      <name>haind27</name>
      <email>haind27@fpt.com.vn</email>
      <usr:username>haind27</usr:username>
    </author>
    <link rel="alternate" href="https://reqs.frt.vn/browse/FI-35314" />
    <activity:object>
      <title type="text">FI-35314</title>
      <summary type="text">[LC] Điều chỉnh xuất kho theo FEFO</summary>
    </activity:object>
    <updated>2026-11-06T00:54:51.997Z</updated>
  </entry>
  <entry>
    <id>urn:uuid:12fa1530-9f88-3f86-98dc-3c76152988bf</id>
    <title type="html">&lt;a href="https://reqs.frt.vn/secure/ViewProfile.jspa?name=70480" class="activity-item-user activity-item-author"&gt;Phạm Thị Thanh Thúy&lt;/a&gt; changed the Assignee to '&lt;a href="https://reqs.frt.vn/secure/ViewProfile.jspa?name=01833" class="activity-item-user"&gt;Lê Nguyễn Tấn Lộc&lt;/a&gt;' on &lt;a href="https://reqs.frt.vn/browse/TADS-66024"&gt;TADS-66024 - [80312] [RSA] Đơn hàng hoàn tất nhưng vào đơn lại ở trạng thái Hủy&lt;/a&gt;</title>
    <author>
      <name>Phạm Thị Thanh Thúy</name>
      <email>ThuyPTT45@fpt.com</email>
      <usr:username>70480</usr:username>
    </author>
    <link rel="alternate" href="https://reqs.frt.vn/browse/TADS-66024" />
    <activity:object>
      <title type="text">TADS-66024</title>
      <summary type="text">[80312] [RSA] Đơn hàng hoàn tất nhưng vào đơn lại ở trạng thái Hủy</summary>
    </activity:object>
    <updated>2026-11-06T00:51:37.386Z</updated>
  </entry>
  <entry>
    <id>urn:uuid:e6c4598c-1f28-3c87-a030-9897636c77be</id>
    <title type="html">&lt;a href="https://reqs.frt.vn/secure/ViewProfile.jspa?name=35826" class="activity-item-user activity-item-author"&gt;Đoàn Thị Thúy Duyên&lt;/a&gt; commented on &lt;a href="https://reqs.frt.vn/browse/TADS-66110"&gt;TADS-66110 - [81002] [APP LC] Khách hàng thao tác bình chọn nhưng báo lỗi&lt;/a&gt;</title>
    <content type="html">&lt;p&gt;Chị &lt;a class="user-hover" rel="48891" href="https://reqs.frt.vn/secure/ViewProfile.jspa?name=48891"&gt;Bùi Thị Huyền Trân&lt;/a&gt; kiểm tra giúp em nhé&lt;/p&gt;</content>
    <author>
      <name>Đoàn Thị Thúy Duyên</name>
      <email>DuyenDTT3@fpt.com</email>
      <usr:username>35826</usr:username>
    </author>
    <link rel="alternate" href="https://reqs.frt.vn/browse/TADS-66110" />
    <activity:object>
      <title type="text">TADS-66110</title>
      <summary type="text">[81002] [APP LC] Khách hàng thao tác bình chọn nhưng báo lỗi</summary>
    </activity:object>
    <updated>2026-11-06T00:49:10.354Z</updated>
  </entry>
</feed>`;

/** Mẫu XML thực tế từ `https://jenkins-osp.frt.vn/job/oneclickv4-build-uat/rssAll` */
export const SAMPLE_FRT_JENKINS_UAT_RSS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>oneclickv4-build-uat all builds</title>
  <link type="text/html" href="https://jenkins-osp.frt.vn/job/oneclickv4-build-uat/" rel="alternate"/>
  <updated>2026-11-05T09:35:00Z</updated>
  <author><name>Jenkins UAT Server</name></author>
  <id>urn:uuid:jenkins-oneclickv4-build-uat</id>
  <entry>
    <title>oneclickv4-build-uat #1421 (stable)</title>
    <link type="text/html" href="https://jenkins-osp.frt.vn/job/oneclickv4-build-uat/1421/" rel="alternate"/>
    <id>tag:hudson.dev.java.net,2026:oneclickv4-build-uat:1421</id>
    <published>2026-11-05T09:35:00Z</published>
    <updated>2026-11-05T09:35:00Z</updated>
    <author><name>sonna2</name></author>
    <content type="html">Started by user sonna2 for UAT deployment FRT-104 (oneclickv4-build-uat pipeline)</content>
  </entry>
  <entry>
    <title>oneclickv4-build-uat #1420 (stable)</title>
    <link type="text/html" href="https://jenkins-osp.frt.vn/job/oneclickv4-build-uat/1420/" rel="alternate"/>
    <id>tag:hudson.dev.java.net,2026:oneclickv4-build-uat:1420</id>
    <published>2026-11-05T09:20:00Z</published>
    <updated>2026-11-05T09:20:00Z</updated>
    <author><name>trantnn</name></author>
    <content type="html">Started by user trantnn for UAT verification FRT-103</content>
  </entry>
</feed>`;

/** Mẫu XML thực tế từ `https://jenkins-osp.frt.vn/job/oneclickv4-build-ci/rssAll` */
export const SAMPLE_FRT_JENKINS_RSS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>oneclickv4-build-ci all builds</title>
  <link type="text/html" href="https://jenkins-osp.frt.vn/job/oneclickv4-build-ci/" rel="alternate"/>
  <updated>2026-11-05T09:34:00Z</updated>
  <author><name>Jenkins Server</name></author>
  <id>urn:uuid:jenkins-oneclickv4-build-ci</id>
  <entry>
    <title>oneclickv4-build-ci #2846 (stable)</title>
    <link type="text/html" href="https://jenkins-osp.frt.vn/job/oneclickv4-build-ci/2846/" rel="alternate"/>
    <id>tag:hudson.dev.java.net,2026:oneclickv4-build-ci:2846</id>
    <published>2026-11-05T09:34:00Z</published>
    <updated>2026-11-05T09:34:00Z</updated>
    <author><name>tienhk</name></author>
    <content type="html">Started by user tienhk for issue FRT-104 (oneclickv4-build-ci pipeline)</content>
  </entry>
  <entry>
    <title>oneclickv4-build-ci #2845 (stable)</title>
    <link type="text/html" href="https://jenkins-osp.frt.vn/job/oneclickv4-build-ci/2845/" rel="alternate"/>
    <id>tag:hudson.dev.java.net,2026:oneclickv4-build-ci:2845</id>
    <published>2026-11-05T09:31:00Z</published>
    <updated>2026-11-05T09:31:00Z</updated>
    <author><name>sonna2</name></author>
    <content type="html">Started by user sonna2 for issue FRT-103</content>
  </entry>
  <entry>
    <title>oneclickv4-build-ci #2844 (back to normal)</title>
    <link type="text/html" href="https://jenkins-osp.frt.vn/job/oneclickv4-build-ci/2844/" rel="alternate"/>
    <id>tag:hudson.dev.java.net,2026:oneclickv4-build-ci:2844</id>
    <published>2026-11-05T09:22:00Z</published>
    <updated>2026-11-05T09:22:00Z</updated>
    <author><name>chiennd22</name></author>
    <content type="html">Started by user chiennd22 for issue FRT-101</content>
  </entry>
  <entry>
    <title>oneclickv4-build-ci #2843 (broken)</title>
    <link type="text/html" href="https://jenkins-osp.frt.vn/job/oneclickv4-build-ci/2843/" rel="alternate"/>
    <id>tag:hudson.dev.java.net,2026:oneclickv4-build-ci:2843</id>
    <published>2026-11-05T09:05:00Z</published>
    <updated>2026-11-05T09:05:00Z</updated>
    <author><name>manhpt13</name></author>
    <content type="html">Started by user manhpt13 for issue FRT-102</content>
  </entry>
</feed>`;

/**
 * Chuẩn hóa chuỗi account (không phân biệt hoa thường, bỏ `@frt.vn`, `(KH)`, `Fresher `)
 * Ví dụ: `"dongnq6@frt.vn"` -> `"dongnq6"`, `"HieuNT181 (KH)"` -> `"hieunt181"`
 */
export function normalizeFrtAccountKey(raw?: string | null): string {
  if (!raw) return '';
  return raw
    .trim()
    .toLowerCase()
    .replace(/@.*$/, '')
    .replace(/\s*\(kh\)/gi, '')
    .replace(/^fresher\s+/i, '')
    .replace(/^jira-frt-/, '')
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Bảng ánh xạ không phân biệt hoa thường từ mọi tài khoản FRT (gồm 30 nhân sự chính + toàn bộ 51 ghế trong sơ đồ Excel NHÀ THUỐC)
 * sang `employeeId` (`EMP-01` .. `EMP-30`) và tên `account` chuẩn (`DongNQ6`, `SonNA2`, `TienHK`...).
 */
const ACCOUNT_TO_EMPLOYEE_MAP: Map<string, { employeeId: string; canonicalAccount: string }> =
  (() => {
    const map = new Map<string, { employeeId: string; canonicalAccount: string }>();

    for (const emp of EMPLOYEES) {
      const cleanAcc = (emp.account || emp.displayName).replace(/\s*\(KH\)/i, '').trim();
      const key = normalizeFrtAccountKey(cleanAcc);
      if (key) {
        map.set(key, { employeeId: emp.id, canonicalAccount: cleanAcc });
      }
      const emailKey = normalizeFrtAccountKey(emp.email);
      if (emailKey) {
        map.set(emailKey, { employeeId: emp.id, canonicalAccount: cleanAcc });
      }
      const jiraKey = normalizeFrtAccountKey(emp.jiraAccountId);
      if (jiraKey) {
        map.set(jiraKey, { employeeId: emp.id, canonicalAccount: cleanAcc });
      }
    }

    // Ánh xạ thêm các ghế phụ trên sơ đồ Excel NHÀ THUỐC về nhân sự đại diện cùng Cụm đảo bàn
    const islandFallbackEmp: Record<string, string> = {
      'ISLAND-1.1': 'EMP-12', // TrungTM7
      'ISLAND-1.2': 'EMP-02', // ThoaPTN1
      'ISLAND-1.3': 'EMP-06', // ManhPT13
      'ISLAND-2.1': 'EMP-07', // ChienND22
      'ISLAND-2.2': 'EMP-15', // BaoNAT
      'ISLAND-2.3': 'EMP-18', // TriPHC
      'ISLAND-3.1': 'EMP-21', // KhoaLNT
      'ISLAND-3.2': 'EMP-25', // TranTNN
      'ISLAND-3.3': 'EMP-29', // TienHK
    };

    for (const slot of NHA_THUOC_SEAT_SLOTS) {
      if (slot.kind !== 'OCCUPIED') continue;
      const cleanSlotAcc = slot.account.replace(/\s*\(KH\)/i, '').replace(/^Fresher\s+/i, '').trim();
      const key = normalizeFrtAccountKey(cleanSlotAcc);
      if (key && !map.has(key)) {
        const empId =
          slot.assignedEmployeeId || islandFallbackEmp[slot.islandId] || PROJECT_MANAGER.id;
        map.set(key, { employeeId: empId, canonicalAccount: cleanSlotAcc });
      }
    }

    return map;
  })();

/**
 * Tra cứu nhân viên theo `account` không phân biệt hoa thường (`dongnq6` -> `DongNQ6` / `EMP-01`, `sonna2` -> `SonNA2` / `EMP-30`)
 */
export function resolveEmployeeByAccountCaseInsensitive(rawAccount?: string | null): {
  employeeId: string;
  canonicalAccount: string;
} | null {
  if (!rawAccount) return null;
  const key = normalizeFrtAccountKey(rawAccount);
  if (!key) return null;

  const direct = ACCOUNT_TO_EMPLOYEE_MAP.get(key);
  if (direct) return direct;

  // Tìm kiếm chuỗi con nếu rawAccount nằm trong câu dài (VD: "Started by user sonna2")
  for (const [accKey, val] of ACCOUNT_TO_EMPLOYEE_MAP.entries()) {
    if (accKey.length >= 4 && rawAccount.toLowerCase().includes(accKey)) {
      return val;
    }
  }
  return null;
}

/** Tìm tất cả các account FRT xuất hiện trong một đoạn văn bản (title/summary/content của XML) */
export function extractMentionedFrtAccounts(text: string): {
  employeeId: string;
  canonicalAccount: string;
}[] {
  if (!text) return [];
  const lower = text.toLowerCase();
  const found: { employeeId: string; canonicalAccount: string; index: number }[] = [];
  const seenEmpIds = new Set<string>();

  for (const [accKey, val] of ACCOUNT_TO_EMPLOYEE_MAP.entries()) {
    if (accKey.length < 4) continue;
    const regex = new RegExp(`\\b${accKey}\\b`, 'i');
    const match = regex.exec(lower);
    if (match && !seenEmpIds.has(val.employeeId)) {
      seenEmpIds.add(val.employeeId);
      found.push({ ...val, index: match.index });
    }
  }

  return found.sort((a, b) => a.index - b.index);
}

function decodeHtmlEntities(str: string): string {
  if (!str) return '';
  const entityMap: Record<string, string> = {
    '&nbsp;': ' ',
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&apos;': "'",
    '&aacute;': 'á',
    '&agrave;': 'à',
    '&atilde;': 'ã',
    '&acirc;': 'â',
    '&eacute;': 'é',
    '&egrave;': 'è',
    '&etilde;': 'ẽ',
    '&ecirc;': 'ê',
    '&iacute;': 'í',
    '&igrave;': 'ì',
    '&itilde;': 'ĩ',
    '&oacute;': 'ó',
    '&ograve;': 'ò',
    '&otilde;': 'õ',
    '&ocirc;': 'ô',
    '&uacute;': 'ú',
    '&ugrave;': 'ù',
    '&utilde;': 'ũ',
    '&yacute;': 'ý',
  };
  let out = String(str);
  for (let pass = 0; pass < 2; pass++) {
    out = out.replace(
      /&(?:nbsp|amp|lt|gt|quot|#39|apos|[a-z]+);/gi,
      (match) => entityMap[match.toLowerCase()] ?? match
    );
  }
  return out;
}

function stripHtmlTags(html: string): string {
  if (!html) return '';
  // Giải mã `&lt;a href="..."&gt;` thành `<a href="...">` TRƯỚC khi xóa thẻ `<...>`
  return decodeHtmlEntities(html)
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hashAccountToEmployeeIndex(str: string, mod: number): number {
  let h = 2166136261;
  const s = String(str || '');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % Math.max(1, mod);
}

const lastClientActorByTicketKey = new Map<string, string>();
const knownClientUserAccountLookup = new Map<string, string>();

export function vietnameseNameToFrtAccount(rawName?: string | null): string {
  if (!rawName) return '';
  const cleaned = stripHtmlTags(rawName)
    .replace(/[^\p{L}\p{N}\s._-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return '';
  const ascii = cleaned
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .trim();
  const words = ascii.split(/\s+/).filter(Boolean);
  if (words.length === 0) return '';
  if (words.length === 1) return words[0];
  const given = words[words.length - 1];
  const givenFormatted =
    given.charAt(0).toUpperCase() + given.slice(1).toLowerCase();
  const initials = words
    .slice(0, -1)
    .map((w) => w.charAt(0).toUpperCase())
    .join('');
  return `${givenFormatted}${initials}`;
}

function extractMentionedUsersFromJiraHtml(rawHtml?: string | null): Array<{
  ldapOrUser: string;
  displayText: string;
  isAuthorLink: boolean;
}> {
  if (!rawHtml) return [];
  const decoded = decodeHtmlEntities(rawHtml);
  const results: Array<{
    ldapOrUser: string;
    displayText: string;
    isAuthorLink: boolean;
  }> = [];
  const linkRegex =
    /<a\b([^>]*ViewProfile\.jspa\?name=([^"&'\s>]+)[^>]*)>([\s\S]*?)<\/a>/gi;
  let m: RegExpExecArray | null;
  while ((m = linkRegex.exec(decoded)) !== null) {
    const attrs = m[1] || '';
    const ldapOrUser = (m[2] || '').trim();
    const displayText = stripHtmlTags(m[3] || '').trim();
    const isAuthorLink = /\bactivity-item-author\b/i.test(attrs);
    if (ldapOrUser || displayText) {
      results.push({
        ldapOrUser,
        displayText,
        isAuthorLink,
      });
    }
  }
  return results;
}

function formatRelativeTimeFromIso(isoStr?: string): string {
  if (!isoStr) return 'vừa xong';
  const parsed = Date.parse(isoStr);
  if (Number.isNaN(parsed)) return 'vừa xong';
  const diffMin = Math.max(1, Math.round((Date.now() - parsed) / 60_000));
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.round(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${Math.round(diffHours / 24)}d ago`;
}

export interface ParsedJiraActivityEntry {
  id: string;
  fingerprint: string;
  ticketKey: string;
  summary: string;
  rawTitle: string;
  authorAccount: string;
  authorDisplayName?: string;
  fromAccount: string;
  toAccount: string;
  fromEmployeeId: string;
  toEmployeeId: string;
  toStatus: TicketStatus;
  isReturnToPM: boolean;
  updatedAt: string;
}

/**
 * Bộ đọc Atom XML thực tế cho `https://reqs.frt.vn/activity?maxResults=10&providers=issues&os_authType=basic&title=undefined`
 * Giữ nguyên 100% tên account thực tế từ `<author><email>` (`ngannn10`, `sangpt19`, `haind27`, `ThuyPTT45`, `DuyenDTT3`...)
 * hoặc `<usr:username>`, không bắt buộc phải nằm trong danh sách cố định!
 */
export function parseJiraActivityAtomXml(xmlText: string): ParsedJiraActivityEntry[] {
  if (!xmlText || !xmlText.trim()) return [];
  const results: ParsedJiraActivityEntry[] = [];

  try {
    if (typeof DOMParser !== 'undefined') {
      const parser = new DOMParser();
      const doc = parser.parseFromString(xmlText, 'text/xml');
      const entries = Array.from(doc.querySelectorAll('entry, item'));

      const rawItems = entries.map((entry, idx) => {
        const id =
          entry.querySelector('id, guid')?.textContent?.trim() ||
          `FRT-ACT-${Date.now()}-${idx}`;
        const rawTitleHtml = entry.querySelector('title')?.textContent || '';
        const rawSummaryHtml =
          entry.querySelector('summary, content, description')?.textContent || '';
        const cleanTitle = stripHtmlTags(rawTitleHtml);
        const cleanSummary = stripHtmlTags(rawSummaryHtml);

        const objEl =
          entry.getElementsByTagName('activity:object')[0] ||
          entry.querySelector('object');
        const objectTicketTitle = stripHtmlTags(
          objEl?.querySelector('title')?.textContent || ''
        );
        const objectIssueSummary = stripHtmlTags(
          objEl?.querySelector('summary')?.textContent || ''
        );

        // Extract author email prefix (`ngannn10@fpt.com` -> `ngannn10`, `sangpt19@fpt.com` -> `sangpt19`), non-numeric `usr:username`, and `<name>`
        const authorEl = entry.querySelector('author') || entry;
        const authorEmail =
          authorEl.querySelector('email')?.textContent?.trim() || '';
        const emailPrefix = authorEmail.includes('@')
          ? authorEmail.split('@')[0].trim()
          : '';
        const rawUsrUsername =
          authorEl.getElementsByTagName('usr:username')[0]?.textContent?.trim() ||
          entry.getElementsByTagName('usr:username')[0]?.textContent?.trim() ||
          '';
        const nonNumericUsrUsername =
          rawUsrUsername && !/^\d+$/.test(rawUsrUsername) ? rawUsrUsername : '';
        const authorDisplayName = stripHtmlTags(
          authorEl.querySelector('name, creator')?.textContent || ''
        );

        const realAuthorAccount =
          emailPrefix ||
          nonNumericUsrUsername ||
          vietnameseNameToFrtAccount(authorDisplayName) ||
          authorDisplayName ||
          rawUsrUsername ||
          'jira-user';

        if (realAuthorAccount && realAuthorAccount !== 'jira-user') {
          if (rawUsrUsername) {
            knownClientUserAccountLookup.set(
              rawUsrUsername.toLowerCase(),
              realAuthorAccount
            );
          }
          if (authorDisplayName) {
            knownClientUserAccountLookup.set(
              authorDisplayName.toLowerCase(),
              realAuthorAccount
            );
          }
        }

        const allEmailsInBlock = Array.from(entry.querySelectorAll('email'))
          .map((el) => el.textContent?.trim() || '')
          .map((e) => (e.includes('@') ? e.split('@')[0].trim() : ''))
          .filter(Boolean);
        const allUsrInBlock = Array.from(entry.getElementsByTagName('usr:username'))
          .map((el) => el.textContent?.trim() || '')
          .filter((u) => u && !/^\d+$/.test(u));
        const profileMentions = [
          ...extractMentionedUsersFromJiraHtml(rawTitleHtml),
          ...extractMentionedUsersFromJiraHtml(rawSummaryHtml),
        ];

        const linkHref =
          entry.querySelector('link')?.getAttribute('href') ||
          entry.querySelector('link')?.textContent ||
          '';

        const keyMatch =
          objectTicketTitle.match(/^([A-Z][A-Z0-9_]{1,9}-\d+)$/i) ||
          cleanTitle.match(/\b([A-Z][A-Z0-9_]{1,9}-\d+)\b/) ||
          linkHref.match(/\b([A-Z][A-Z0-9_]{1,9}-\d+)\b/);
        const ticketKey = keyMatch ? keyMatch[1].toUpperCase() : `JIRA-${idx + 1}`;

        const categoryTerm =
          entry.querySelector('category')?.getAttribute('term') || '';
        const verbText =
          entry.getElementsByTagName('activity:verb')[0]?.textContent || '';
        const isCreatedVerb =
          /created/i.test(categoryTerm) ||
          /schema\/1\.0\/post/i.test(verbText) ||
          /\bcreated\b/i.test(cleanTitle);

        // Classify status strictly using cleanTitle (never match substring 'PR' inside 'ViewProfile'!)
        const toStatus: TicketStatus =
          /\b(done|resolved|closed|hoàn thành)\b/i.test(cleanTitle)
            ? 'DONE'
            : /\b(qa|testing|kiểm thử|uat)\b/i.test(cleanTitle)
            ? 'QA_TESTING'
            : /\b(code review|in review|pull request|merge request|review)\b/i.test(
                cleanTitle
              )
            ? 'CODE_REVIEW'
            : /\b(fix version|release\/|deploy|ready for deploy)\b/i.test(cleanTitle)
            ? 'READY_FOR_DEPLOY'
            : isCreatedVerb
            ? 'TODO'
            : 'IN_PROGRESS';

        const updatedAt =
          entry.querySelector('updated, published, pubDate')?.textContent?.trim() ||
          new Date().toISOString();

        const displaySummary = objectIssueSummary
          ? `[${ticketKey}] ${objectIssueSummary} — ${cleanTitle}`
          : cleanTitle || cleanSummary || `Cập nhật Jira ${ticketKey}`;

        return {
          id,
          ticketKey,
          cleanTitle,
          displaySummary,
          realAuthorAccount,
          authorDisplayName,
          allEmailsInBlock,
          allUsrInBlock,
          profileMentions,
          toStatus,
          updatedAt,
        };
      });

      // Process chronologically (oldest -> newest) so collaborators on the same ticket link naturally
      const chronological = [...rawItems].reverse();
      const byId = new Map<string, ParsedJiraActivityEntry>();

      for (const item of chronological) {
        const resolvedAuthor = resolveEmployeeByAccountCaseInsensitive(
          item.realAuthorAccount
        );
        const fromAccount = item.realAuthorAccount;
        const fallbackEmpNum = (
          (hashAccountToEmployeeIndex(fromAccount, 29) % 29) + 2
        )
          .toString()
          .padStart(2, '0');
        const fromEmpId = resolvedAuthor?.employeeId || `EMP-${fallbackEmpNum}`;

        const isReturnToPM = item.toStatus === 'DONE';

        const resolvedMentionAccounts: string[] = [];
        for (const m of item.profileMentions) {
          const byLdap =
            m.ldapOrUser &&
            knownClientUserAccountLookup.get(m.ldapOrUser.toLowerCase());
          const byName =
            m.displayText &&
            knownClientUserAccountLookup.get(m.displayText.toLowerCase());
          const nonNumericLdap =
            m.ldapOrUser && !/^\d+$/.test(m.ldapOrUser) ? m.ldapOrUser : '';
          const acc =
            byLdap ||
            byName ||
            nonNumericLdap ||
            vietnameseNameToFrtAccount(m.displayText);
          if (acc) {
            resolvedMentionAccounts.push(acc);
          }
        }

        const candidateTargetUsers = [
          ...new Set([
            ...item.allEmailsInBlock,
            ...item.allUsrInBlock,
            ...resolvedMentionAccounts,
          ]),
        ];

        const explicitSecondUser = candidateTargetUsers.find(
          (u) => normalizeFrtAccountKey(u) !== normalizeFrtAccountKey(fromAccount)
        );
        const prevCollaborator = lastClientActorByTicketKey.get(item.ticketKey);
        const targetUserAccount =
          explicitSecondUser ||
          (prevCollaborator &&
          normalizeFrtAccountKey(prevCollaborator) !==
            normalizeFrtAccountKey(fromAccount)
            ? prevCollaborator
            : '');

        lastClientActorByTicketKey.set(item.ticketKey, fromAccount);

        const defaultCoordinatorAccount =
          normalizeFrtAccountKey(fromAccount) === 'dongnq6'
            ? 'ThanhDQ13'
            : 'DongNQ6';
        const toAccount =
          targetUserAccount ||
          (isReturnToPM ? 'DongNQ6' : defaultCoordinatorAccount);
        const resolvedTarget = resolveEmployeeByAccountCaseInsensitive(toAccount);

        let toEmpId =
          resolvedTarget?.employeeId ||
          (isReturnToPM
            ? PROJECT_MANAGER.id
            : `EMP-${(
                (hashAccountToEmployeeIndex(toAccount, 29) % 29) +
                2
              )
                .toString()
                .padStart(2, '0')}`);
        if (toEmpId === fromEmpId) {
          toEmpId = fromEmpId === 'EMP-01' ? 'EMP-04' : 'EMP-01';
        }

        const fingerprint = computeJiraActivityFingerprint({
          entryId: item.id,
          ticketKey: item.ticketKey,
          fromAccount,
          toAccount,
          toStatus: item.toStatus,
          updatedTimestamp: item.updatedAt,
        });

        byId.set(item.id, {
          id: item.id,
          fingerprint,
          ticketKey: item.ticketKey,
          summary: item.displaySummary,
          rawTitle: item.cleanTitle || `Activity on ${item.ticketKey}`,
          authorAccount: fromAccount,
          authorDisplayName: item.authorDisplayName || fromAccount,
          fromAccount,
          toAccount,
          fromEmployeeId: fromEmpId,
          toEmployeeId: toEmpId,
          toStatus: item.toStatus,
          isReturnToPM,
          updatedAt: item.updatedAt,
        });
      }

      for (const it of rawItems) {
        const parsed = byId.get(it.id);
        if (parsed) results.push(parsed);
      }
    }
  } catch (err) {
    console.warn('[parseJiraActivityAtomXml] XML parse warning:', err);
  }

  return results;
}

/**
 * Bộ đọc Atom / RSS XML thực tế cho `https://jenkins-osp.frt.vn/job/oneclickv4-build-ci/rssAll`
 * và `https://jenkins-osp.frt.vn/job/oneclickv4-build-uat/rssAll`.
 * Hỗ trợ chuẩn cấu trúc `<title>oneclickv4-build-ci bo-ci-agentos-worker:ci-41475 (stable)</title>`.
 */
export function parseJenkinsRssXml(xmlText: string): JenkinsBuildJobItem[] {
  if (!xmlText || !xmlText.trim()) return [];
  const builds: JenkinsBuildJobItem[] = [];

  try {
    if (typeof DOMParser !== 'undefined') {
      const parser = new DOMParser();
      const doc = parser.parseFromString(xmlText, 'text/xml');
      const entries = Array.from(doc.querySelectorAll('entry, item'));

      entries.forEach((entry, idx) => {
        const rawTitle = stripHtmlTags(
          entry.querySelector('title')?.textContent || ''
        );
        const rawId =
          entry.querySelector('id, guid')?.textContent?.trim() ||
          `jenkins-build-${Date.now()}-${idx}`;
        const link =
          entry.querySelector('link')?.getAttribute('href') ||
          entry.querySelector('link')?.textContent?.trim() ||
          'https://jenkins-osp.frt.vn/job/oneclickv4-build-ci/';
        const publishedAt =
          entry.querySelector('published, updated, pubDate')?.textContent?.trim() ||
          new Date().toISOString();
        const authorText = stripHtmlTags(
          entry.querySelector('author > name, creator')?.textContent || ''
        );
        const contentText = stripHtmlTags(
          entry.querySelector('content, summary, description')?.textContent || ''
        );

        const parenMatch = rawTitle.match(/\(([^)]+)\)\s*$/);
        const statusText = parenMatch ? parenMatch[1].trim() : 'stable';
        const lowerStatus = statusText.toLowerCase();

        const result: JenkinsBuildJobItem['status'] =
          lowerStatus.includes('broken') ||
          lowerStatus.includes('fail') ||
          lowerStatus.includes('aborted') ||
          lowerStatus.includes('regression')
            ? 'FAILURE'
            : lowerStatus.includes('unstable')
            ? 'UNSTABLE'
            : lowerStatus.includes('building') || lowerStatus.includes('progress')
            ? 'BUILDING'
            : 'SUCCESS';

        // Parse `<jobName> <serviceName>:<buildTag>` from `<title>`
        const titleWithoutStatus = rawTitle.replace(/\s*\([^)]+\)\s*$/, '').trim();
        const titleTokens = titleWithoutStatus.split(/\s+/).filter(Boolean);
        const firstToken = titleTokens[0] || '';
        const secondToken = titleTokens.slice(1).join(' ').trim();

        let serviceName = '';
        let buildTag = '';
        if (secondToken.includes(':')) {
          const colonIdx = secondToken.indexOf(':');
          serviceName = secondToken.slice(0, colonIdx).trim();
          buildTag = secondToken.slice(colonIdx + 1).trim();
        } else if (secondToken.startsWith('#')) {
          buildTag = secondToken;
        } else if (secondToken) {
          serviceName = secondToken;
        }

        const numMatch =
          link.match(/\/(\d+)\/?$/) ||
          rawId.match(/:(\d+)$/) ||
          buildTag.match(/(\d+)$/) ||
          rawTitle.match(/#(\d+)/);
        const buildNumber = numMatch ? parseInt(numMatch[1], 10) : idx + 1;

        const isUatJob = /oneclickv4-build-uat|\buat\b/i.test(
          `${firstToken} ${link} ${rawId}`
        );
        const isReleaseJob = /oneclickv4-build-release|\brelease\b/i.test(
          `${firstToken} ${link} ${rawId}`
        );
        const jobName =
          firstToken && !firstToken.includes(':')
            ? firstToken
            : isUatJob
            ? 'oneclickv4-build-uat'
            : isReleaseJob
            ? 'oneclickv4-build-release'
            : 'oneclickv4-build-ci';
        const clusterId = isUatJob ? 'UAT' : isReleaseJob ? 'RELEASE' : 'CI';

        const combinedMeta = `${authorText} ${contentText}`;
        const startedByMatch =
          combinedMeta.match(/Started by user\s+([a-zA-Z0-9._-]+)/i) ||
          combinedMeta.match(/by\s+([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+)/i);
        const rawUserFromJenkins =
          (startedByMatch ? startedByMatch[1].replace(/@.*$/, '') : '') ||
          (authorText && !/jenkins|hudson|anonymous|system/i.test(authorText)
            ? authorText
            : '');

        const triggeredBy = rawUserFromJenkins || serviceName || jobName;
        const jiraKeyMatch = combinedMeta.match(/\b([A-Z]{2,8}-\d+)\b/);
        const ticketKey =
          (jiraKeyMatch ? jiraKeyMatch[1].toUpperCase() : '') ||
          buildTag ||
          serviceName ||
          `#${buildNumber}`;
        const timeAgo = formatRelativeTimeFromIso(publishedAt);

        const fingerprint = computeJenkinsBuildFingerprint(
          jobName,
          buildNumber,
          result
        );

        builds.push({
          id: rawId,
          fingerprint,
          buildNumber,
          jobName,
          clusterId,
          statusText,
          status: result,
          result,
          timeAgo,
          relativeTime: timeAgo,
          publishedAt,
          triggeredByAccount: triggeredBy,
          triggeredBy,
          ticketKey,
          link,
          url: link,
        });
      });
    }
  } catch (err) {
    console.warn('[parseJenkinsRssXml] Failed to parse Jenkins RSS XML:', err);
  }

  return builds.sort((a, b) => b.buildNumber - a.buildNumber);
}

export interface RealJiraAdapterOptions {
  /** WebSocket or SSE relay URL receiving Jira Webhooks (`jira:issue_updated`, `jira:issue_created`) */
  webhookStreamUrl: string;
  /** Optional REST API proxy endpoint for fetching initial sprint issues */
  restApiBaseUrl?: string;
  /** Jira Project Key (default: 'FRT') */
  projectKey?: string;
  /** Jira Activity Atom XML URL (default: `/api/frt-jira-activity?...`) */
  jiraActivityXmlUrl?: string;
  /** Jenkins CI RSS All URL (default: `/api/frt-jenkins-rss`) */
  jenkinsRssUrl?: string;
  /** Optional Basic Auth username & password for `os_authType=basic` */
  basicAuthUsername?: string;
  basicAuthPassword?: string;
}

export class RealJiraWebhookAdapter implements IJiraAdapter {
  public readonly providerName =
    'FRT Jira Activity XML & Jenkins CI RSS Adapter (Production)';
  public readonly mode = 'real-webhook' as const;

  private connected = false;
  private eventSource: EventSource | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private seenActivityEntryIds: Set<string> = new Set();
  private listeners: Set<(event: JiraWebhookEvent) => void> = new Set();
  private options: RealJiraAdapterOptions;

  constructor(options: RealJiraAdapterOptions) {
    this.options = options;
  }

  public async connect(): Promise<void> {
    if (
      typeof window !== 'undefined' &&
      'EventSource' in window &&
      this.options.webhookStreamUrl
    ) {
      this.eventSource = new EventSource(this.options.webhookStreamUrl);
      this.eventSource.onmessage = (msg) => {
        try {
          const rawPayload = JSON.parse(msg.data);
          const normalized = this.normalizeJiraWebhookPayload(rawPayload);
          if (normalized) {
            this.listeners.forEach((cb) => cb(normalized));
          }
        } catch (err) {
          console.warn('[RealJiraWebhookAdapter] Failed to parse webhook event:', err);
        }
      };
    }
    this.connected = true;
  }

  public disconnect(): void {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    this.connected = false;
  }

  public isConnected(): boolean {
    return this.connected;
  }

  public async getInitialTickets(): Promise<JiraTicket[]> {
    if (!this.options.restApiBaseUrl) {
      return [];
    }
    const res = await fetch(
      `${this.options.restApiBaseUrl}/issues?project=${this.options.projectKey ?? 'FRT'}`
    );
    if (!res.ok) return [];
    return res.json();
  }

  public async createTicket(input: CreateTicketInput): Promise<JiraTicket> {
    if (!this.options.restApiBaseUrl) {
      throw new Error('REST API Base URL is not configured for RealJiraWebhookAdapter');
    }
    const res = await fetch(`${this.options.restApiBaseUrl}/issues`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    return res.json();
  }

  public async transitionTicket(
    ticketId: string,
    nextStatus: TicketStatus,
    nextAssigneeId: string,
    comment?: string
  ): Promise<JiraTicket> {
    if (!this.options.restApiBaseUrl) {
      throw new Error('REST API Base URL is not configured for RealJiraWebhookAdapter');
    }
    const res = await fetch(
      `${this.options.restApiBaseUrl}/issues/${ticketId}/transitions`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nextStatus, nextAssigneeId, comment }),
      }
    );
    return res.json();
  }

  public onTicketEvent(listener: (event: JiraWebhookEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Map Jira accountId / username / email (case-insensitive) to our 30 FRT Office Employee IDs (`EMP-01` .. `EMP-30`)
   */
  public resolveEmployeeIdFromJiraUser(jiraUser?: {
    accountId?: string;
    name?: string;
    emailAddress?: string;
    displayName?: string;
  }): string {
    if (!jiraUser) return PROJECT_MANAGER.id;

    const byCaseInsensitive =
      resolveEmployeeByAccountCaseInsensitive(jiraUser.name) ||
      resolveEmployeeByAccountCaseInsensitive(jiraUser.accountId) ||
      resolveEmployeeByAccountCaseInsensitive(jiraUser.emailAddress) ||
      resolveEmployeeByAccountCaseInsensitive(jiraUser.displayName);

    if (byCaseInsensitive) {
      return byCaseInsensitive.employeeId;
    }

    const found = EMPLOYEES.find(
      (emp) =>
        emp.jiraAccountId.toLowerCase() === (jiraUser.accountId ?? '').toLowerCase() ||
        (jiraUser.emailAddress &&
          emp.email.toLowerCase() === jiraUser.emailAddress.toLowerCase())
    );
    return found ? found.id : PROJECT_MANAGER.id;
  }

  /**
   * Chuyển đổi 1 bản ghi `ParsedJiraActivityEntry` (từ `reqs.frt.vn/activity`) sang `JiraWebhookEvent`
   */
  public activityEntryToWebhookEvent(entry: ParsedJiraActivityEntry): JiraWebhookEvent {
    const nowIso = entry.updatedAt || new Date().toISOString();
    const ticket: JiraTicket = {
      id: `ACT-${entry.ticketKey}`,
      key: entry.ticketKey,
      summary: entry.summary,
      description: entry.rawTitle,
      type: 'STORY',
      priority: 'HIGH',
      status: entry.toStatus,
      reporterId: PROJECT_MANAGER.id,
      assigneeId: entry.toEmployeeId,
      previousAssigneeId: entry.fromEmployeeId,
      storyPoints: 5,
      documentStackSize: 4,
      workflowChain: [],
      currentStepIndex: 0,
      deliveredToPM: entry.isReturnToPM,
      createdAt: nowIso,
      updatedAt: nowIso,
      history: [],
    };

    return {
      eventId: `JIRA-ACT-${entry.id}-${Date.now()}`,
      fingerprint: entry.fingerprint,
      eventType: entry.isReturnToPM ? 'TICKET_DONE' : 'TICKET_TRANSITIONED',
      timestamp: nowIso,
      ticket,
      fromEmployeeId: entry.fromEmployeeId,
      toEmployeeId: entry.toEmployeeId,
      fromStatus: null,
      toStatus: entry.toStatus,
      isReturnToPM: entry.isReturnToPM,
      summaryMessage: `[reqs.frt.vn] ${entry.authorAccount}: ${entry.rawTitle}`,
    };
  }

  /**
   * Gọi API Public duy nhất `/api/public/office-stream?afterSeq=<number>`
   * có tích hợp 2-Layer RAM Cache Deduplicator trên Backend Proxy.
   */
  public async fetchPublicOfficeStream(
    afterSeq = 0
  ): Promise<PublicOfficeStreamResponse> {
    const res = await fetch(
      `${PUBLIC_OFFICE_STREAM_API_URL}?afterSeq=${Math.max(0, afterSeq)}`
    );
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} from ${PUBLIC_OFFICE_STREAM_API_URL}`);
    }
    return res.json();
  }

  /**
   * Fetch và parse trực tiếp từ Vite Proxy `/api/frt-jira-activity` & `/api/frt-jenkins-rss`
   */
  public async fetchAndParseActivityXml(customAuthHeader?: string): Promise<ParsedJiraActivityEntry[]> {
    const url = this.options.jiraActivityXmlUrl || FRT_JIRA_ACTIVITY_PROXY_URL;
    const headers: Record<string, string> = {
      Accept: 'application/atom+xml, application/xml, text/xml, */*',
    };
    if (customAuthHeader) {
      headers.Authorization = customAuthHeader;
    } else if (this.options.basicAuthUsername && this.options.basicAuthPassword) {
      headers.Authorization = `Basic ${btoa(
        `${this.options.basicAuthUsername}:${this.options.basicAuthPassword}`
      )}`;
    }
    const res = await fetch(url, { headers });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} from ${url}`);
    }
    const xmlText = await res.text();
    const parsed = parseJiraActivityAtomXml(xmlText);
    for (const item of parsed) {
      if (!this.seenActivityEntryIds.has(item.id)) {
        this.seenActivityEntryIds.add(item.id);
        const ev = this.activityEntryToWebhookEvent(item);
        this.listeners.forEach((cb) => cb(ev));
      }
    }
    return parsed;
  }

  private normalizeJiraWebhookPayload(raw: Record<string, any>): JiraWebhookEvent | null {
    const issue = raw.issue;
    if (!issue) return null;

    const fields = issue.fields ?? {};
    const statusName = String(fields.status?.name ?? 'TODO').toUpperCase();
    const mappedStatus: TicketStatus =
      statusName.includes('DONE') || statusName.includes('CLOSED')
        ? 'DONE'
        : statusName.includes('REVIEW')
        ? 'CODE_REVIEW'
        : statusName.includes('TEST') || statusName.includes('QA')
        ? 'QA_TESTING'
        : statusName.includes('PROGRESS')
        ? 'IN_PROGRESS'
        : 'TODO';

    const isReturnToPM = mappedStatus === 'DONE';
    const currentAssigneeId = this.resolveEmployeeIdFromJiraUser(fields.assignee);
    const toEmployeeId = isReturnToPM ? PROJECT_MANAGER.id : currentAssigneeId;
    const fromEmployeeId =
      this.resolveEmployeeIdFromJiraUser(raw.user) || currentAssigneeId;

    const priorityName = String(fields.priority?.name ?? 'HIGH').toUpperCase();
    const priority: TicketPriority =
      priorityName.includes('CRIT') || priorityName.includes('HIGHEST')
        ? 'CRITICAL'
        : priorityName.includes('HIGH')
        ? 'HIGH'
        : priorityName.includes('LOW')
        ? 'LOW'
        : 'MEDIUM';

    const nowIso = new Date().toISOString();
    const ticket: JiraTicket = {
      id: String(issue.id ?? issue.key),
      key: String(issue.key ?? 'FRT-999'),
      summary: String(fields.summary ?? 'Jira Issue Update'),
      description: String(fields.description ?? ''),
      type: 'STORY',
      priority,
      status: mappedStatus,
      reporterId: PROJECT_MANAGER.id,
      assigneeId: toEmployeeId,
      previousAssigneeId: fromEmployeeId,
      storyPoints: Number(fields.customfield_10016 ?? 3),
      documentStackSize: 3,
      workflowChain: [],
      currentStepIndex: 0,
      deliveredToPM: false,
      createdAt: nowIso,
      updatedAt: nowIso,
      history: [],
    };

    return {
      eventId: `JIRA-WH-${Date.now()}`,
      eventType: isReturnToPM ? 'TICKET_DONE' : 'TICKET_TRANSITIONED',
      timestamp: nowIso,
      ticket,
      fromEmployeeId,
      toEmployeeId,
      fromStatus: null,
      toStatus: mappedStatus,
      isReturnToPM,
      summaryMessage: `${ticket.key}: ${ticket.summary} (${mappedStatus})`,
    };
  }
}
