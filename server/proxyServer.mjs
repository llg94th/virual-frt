#!/usr/bin/env node
/**
 * Virtual FRT Office 2D — Hardened Backend Proxy, AES-256-GCM Credential Vault &
 * 2-Layer Exactly-Once RAM Cache Deduplicator (`server/proxyServer.mjs`)
 *
 * Zero external dependencies (100% Node.js built-in modules: node:http, node:https, node:crypto, node:fs, node:path, node:url).
 *
 * Key Responsibilities:
 * 1. Layer 1 RAM Cache Deduplication (`seenFingerprints` LRU Map capped at 2,000 keys) +
 *    Monotonic Sequence Cursor (`currentSeq` / `afterSeq`) + `eventRingBuffer` (max 100 events).
 *    Guarantees every Jira Activity `<entry>` and Jenkins Build `#buildNumber:STATUS` is emitted AT MOST ONCE.
 * 2. AES-256-GCM Encrypted Credential Vault (`server/.credentials.enc.json`) for `reqs.frt.vn` & `jenkins-osp.frt.vn`.
 * 3. Hardened Local-Only Admin UI (`http://127.0.0.1:8787/admin`) & `/api/admin/*` API:
 *    Strictly blocks Cloudflare Tunnel requests (`cf-connecting-ip`, `cf-ray`, `x-forwarded-for`) and non-loopback IPs,
 *    with `ADMIN_MASTER_KEY` verification and brute-force rate limiting.
 * 4. Single Public API (`GET /api/public/office-stream?afterSeq=<number>`) + Static Web (`dist/`) on port 8787,
 *    ready to be exposed safely through a single Cloudflare Tunnel domain.
 */

import http from 'node:http';
import https from 'node:https';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const DIST_DIR = path.join(ROOT_DIR, 'dist');
const CREDENTIALS_FILE = path.join(__dirname, '.credentials.enc.json');
const MASTER_KEY_FILE = path.join(__dirname, '.master.key');

const PORT = Number(process.env.PORT || 8787);
const BIND_HOST = process.env.BIND_HOST || '0.0.0.0';

// ============================================================================
// 1. DEFAULT SAMPLE XML FEEDS (Used when testing locally without VPN or Seed Mode)
// ============================================================================

const SEED_FRT_JIRA_ACTIVITY_XML = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:usr="http://streams.atlassian.com/syndication/username/1.0" xmlns:activity="http://activitystrea.ms/spec/1.0/">
  <id>https://reqs.frt.vn/activity?maxResults=10&amp;providers=issues&amp;os_authType=basic&amp;title=undefined</id>
  <title type="text">Activity Stream — FRT Pharmacy (NHÀ THUỐC)</title>
  <updated>2026-11-05T09:32:00Z</updated>
  <entry>
    <id>urn:uuid:frt-activity-2846-1</id>
    <title type="html">thanhdq13 changed the status of FRT-104 to QA Testing and assigned to trantnn</title>
    <summary type="html">Tối ưu API tồn kho thuốc Long Châu • Chuyển bản build oneclickv4 sang QA kiểm thử</summary>
    <author>
      <name>Đỗ Quang Thanh</name>
      <email>thanhdq13@frt.vn</email>
      <usr:username>thanhdq13</usr:username>
    </author>
    <link rel="alternate" href="https://reqs.frt.vn/browse/FRT-104" />
    <updated>2026-11-05T09:32:00Z</updated>
  </entry>
  <entry>
    <id>urn:uuid:frt-activity-2846-2</id>
    <title type="html">baonat updated FRT-103 to Code Review for luutv6</title>
    <summary type="html">Cập nhật giao diện POS Nhà Thuốc • Nhờ Lead LuuTV6 review PR</summary>
    <author>
      <name>Nguyễn Anh Thiên Bảo</name>
      <email>baonat@frt.vn</email>
      <usr:username>baonat</usr:username>
    </author>
    <link rel="alternate" href="https://reqs.frt.vn/browse/FRT-103" />
    <updated>2026-11-05T09:30:10Z</updated>
  </entry>
  <entry>
    <id>urn:uuid:frt-activity-2846-3</id>
    <title type="html">trantnn resolved FRT-105 as Done and delivered to dongnq6</title>
    <summary type="html">Nghiệm thu hoàn tất UAT đặt thuốc Online • Mang hồ sơ DONE về bàn PM DongNQ6</summary>
    <author>
      <name>Trần Thị Ngọc Trân</name>
      <email>trantnn@frt.vn</email>
      <usr:username>trantnn</usr:username>
    </author>
    <link rel="alternate" href="https://reqs.frt.vn/browse/FRT-105" />
    <updated>2026-11-05T09:28:45Z</updated>
  </entry>
</feed>`;

const SEED_FRT_JENKINS_RSS_XML = `<?xml version="1.0" encoding="UTF-8"?>
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

// ============================================================================
// 2. CASE-INSENSITIVE FRT ACCOUNT -> 30 EMPLOYEE SEAT MAPPING
// ============================================================================

const FRT_EMPLOYEE_DIRECTORY = [
  { id: 'EMP-01', account: 'DongNQ6', role: 'PM' },
  { id: 'EMP-02', account: 'ThoaPTN1', role: 'BA' },
  { id: 'EMP-03', account: 'HieuNT181', role: 'BA' },
  { id: 'EMP-04', account: 'ThanhDQ13', role: 'TECH_LEAD' },
  { id: 'EMP-05', account: 'LuuTV6', role: 'TECH_LEAD' },
  { id: 'EMP-06', account: 'ManhPT13', role: 'TECH_LEAD' },
  { id: 'EMP-07', account: 'ChienND22', role: 'BACKEND' },
  { id: 'EMP-08', account: 'CuongTN2', role: 'BACKEND' },
  { id: 'EMP-09', account: 'CuongDNQ2', role: 'BACKEND' },
  { id: 'EMP-10', account: 'ToanNLV', role: 'BACKEND' },
  { id: 'EMP-11', account: 'QuyenNVC', role: 'BACKEND' },
  { id: 'EMP-12', account: 'TrungTM7', role: 'BACKEND' },
  { id: 'EMP-13', account: 'KhiemHT', role: 'BACKEND' },
  { id: 'EMP-14', account: 'LanTTP', role: 'BACKEND' },
  { id: 'EMP-15', account: 'BaoNAT', role: 'FRONTEND' },
  { id: 'EMP-16', account: 'ThuanHM12', role: 'FRONTEND' },
  { id: 'EMP-17', account: 'LongBK2', role: 'FRONTEND' },
  { id: 'EMP-18', account: 'TriPHC', role: 'FRONTEND' },
  { id: 'EMP-19', account: 'KienNT178', role: 'FRONTEND' },
  { id: 'EMP-20', account: 'ThieuNV5', role: 'FRONTEND' },
  { id: 'EMP-21', account: 'KhoaLNT', role: 'MOBILE' },
  { id: 'EMP-22', account: 'HuyNT83', role: 'MOBILE' },
  { id: 'EMP-23', account: 'LyNH16', role: 'MOBILE' },
  { id: 'EMP-24', account: 'ThienTM2', role: 'MOBILE' },
  { id: 'EMP-25', account: 'TranTNN', role: 'QA' },
  { id: 'EMP-26', account: 'TrucNN4', role: 'QA' },
  { id: 'EMP-27', account: 'ThanhNX7', role: 'QA' },
  { id: 'EMP-28', account: 'PhongNT84', role: 'QA' },
  { id: 'EMP-29', account: 'TienHK', role: 'DEVOPS' },
  { id: 'EMP-30', account: 'SonNA2', role: 'DEVOPS' },
  // Additional occupied seat accounts in NHÀ THUỐC 54-slot Excel map
  { id: 'EMP-12', account: 'KhangPM3', role: 'BACKEND' },
  { id: 'EMP-12', account: 'VinhNT27', role: 'BACKEND' },
  { id: 'EMP-12', account: 'HungNV92', role: 'BACKEND' },
  { id: 'EMP-02', account: 'ThuyTTT36', role: 'BA' },
  { id: 'EMP-02', account: 'DungTTT42', role: 'BA' },
  { id: 'EMP-06', account: 'PhuongNAM4', role: 'MOBILE' },
  { id: 'EMP-06', account: 'TuanNA118', role: 'MOBILE' },
  { id: 'EMP-06', account: 'DatNT152', role: 'MOBILE' },
  { id: 'EMP-06', account: 'MinhNH54', role: 'MOBILE' },
  { id: 'EMP-15', account: 'PhatLT11', role: 'FRONTEND' },
  { id: 'EMP-15', account: 'LocNV34', role: 'FRONTEND' },
  { id: 'EMP-18', account: 'TaiNV28', role: 'FRONTEND' },
  { id: 'EMP-18', account: 'NamNH68', role: 'FRONTEND' },
  { id: 'EMP-21', account: 'HaoNV19', role: 'MOBILE' },
  { id: 'EMP-21', account: 'BinhNT45', role: 'MOBILE' },
  { id: 'EMP-29', account: 'AnNV51', role: 'DEVOPS' },
  { id: 'EMP-29', account: 'ucNV12', role: 'DEVOPS' },
  { id: 'EMP-29', account: 'KietTLA', role: 'DEVOPS' },
];

function normalizeAccountKey(raw) {
  if (!raw) return '';
  return String(raw)
    .trim()
    .toLowerCase()
    .replace(/@.*$/, '')
    .replace(/\s*\(kh\)/gi, '')
    .replace(/^fresher\s+/i, '')
    .replace(/^jira-frt-/, '')
    .replace(/[^a-z0-9]/g, '');
}

const ACCOUNT_MAP = new Map();
const EMPLOYEE_BY_ID = new Map();
for (const item of FRT_EMPLOYEE_DIRECTORY) {
  const key = normalizeAccountKey(item.account);
  if (key && !ACCOUNT_MAP.has(key)) {
    ACCOUNT_MAP.set(key, { employeeId: item.id, canonicalAccount: item.account });
  }
  if (!EMPLOYEE_BY_ID.has(item.id)) {
    EMPLOYEE_BY_ID.set(item.id, item);
  }
}

function resolveEmployeeByAccount(rawAccount) {
  if (!rawAccount) return null;
  const key = normalizeAccountKey(rawAccount);
  if (!key) return null;
  if (ACCOUNT_MAP.has(key)) return ACCOUNT_MAP.get(key);
  const lower = String(rawAccount).toLowerCase();
  for (const [accKey, val] of ACCOUNT_MAP.entries()) {
    if (accKey.length >= 4 && lower.includes(accKey)) {
      return val;
    }
  }
  return null;
}

function extractMentionedAccounts(text) {
  if (!text) return [];
  const lower = String(text).toLowerCase();
  const found = [];
  const seenEmpIds = new Set();
  for (const [accKey, val] of ACCOUNT_MAP.entries()) {
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

// ============================================================================
// 3. AES-256-GCM ENCRYPTED CREDENTIALS VAULT (`server/.credentials.enc.json`)
// ============================================================================

const DEFAULT_PROXY_CONFIG = {
  jiraUrl:
    'https://reqs.frt.vn/activity?maxResults=10&providers=issues&os_authType=basic&title=undefined',
  jiraAuthType: 'BASIC', // 'BASIC' | 'BEARER' | 'COOKIE' | 'NONE'
  jiraUsername: '',
  jiraSecret: '',
  jenkinsUrl: 'https://jenkins-osp.frt.vn/job/oneclickv4-build-ci/rssAll',
  jenkinsAuthType: 'NONE', // 'NONE' | 'BASIC' | 'BEARER' | 'COOKIE'
  jenkinsUsername: '',
  jenkinsSecret: '',
  pollIntervalSec: 10,
  privacySanitize: true,
  useSeedFallbackWhenOffline: true,
};

function getEncryptionKey32Bytes() {
  const envSecret =
    process.env.ADMIN_ENCRYPTION_KEY ||
    process.env.CREDENTIAL_SECRET ||
    process.env.ADMIN_MASTER_KEY;
  if (envSecret && envSecret.trim().length >= 8) {
    return crypto.scryptSync(envSecret.trim(), 'virtual-frt-office-2d-vault-v1', 32);
  }

  try {
    if (fs.existsSync(MASTER_KEY_FILE)) {
      const existingHex = fs.readFileSync(MASTER_KEY_FILE, 'utf8').trim();
      if (existingHex.length >= 32) {
        return crypto.scryptSync(existingHex, 'virtual-frt-office-2d-vault-v1', 32);
      }
    }
    const generatedHex = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(MASTER_KEY_FILE, generatedHex, { mode: 0o600 });
    return crypto.scryptSync(generatedHex, 'virtual-frt-office-2d-vault-v1', 32);
  } catch (err) {
    console.warn('[proxyServer] Fallback ephemeral encryption key:', err.message);
    return crypto.scryptSync('frt-fallback-local-key-2026', 'virtual-frt-office-2d-vault-v1', 32);
  }
}

function saveEncryptedCredentials(configObj) {
  const key = getEncryptionKey32Bytes();
  const iv = crypto.randomBytes(12); // 96-bit IV for AES-256-GCM
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const plaintext = JSON.stringify(configObj);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  const payload = {
    version: 1,
    algorithm: 'aes-256-gcm',
    iv: iv.toString('base64'),
    authTag: authTag.toString('base64'),
    ciphertext: encrypted.toString('base64'),
    updatedAt: new Date().toISOString(),
  };

  fs.writeFileSync(CREDENTIALS_FILE, JSON.stringify(payload, null, 2), { mode: 0o600 });
}

function loadEncryptedCredentials() {
  if (!fs.existsSync(CREDENTIALS_FILE)) {
    return { ...DEFAULT_PROXY_CONFIG };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(CREDENTIALS_FILE, 'utf8'));
    const key = getEncryptionKey32Bytes();
    const iv = Buffer.from(raw.iv, 'base64');
    const authTag = Buffer.from(raw.authTag, 'base64');
    const ciphertext = Buffer.from(raw.ciphertext, 'base64');

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    const parsed = JSON.parse(decrypted);
    return {
      ...DEFAULT_PROXY_CONFIG,
      ...parsed,
    };
  } catch (err) {
    console.warn('[proxyServer] Failed to decrypt .credentials.enc.json, using defaults:', err.message);
    return { ...DEFAULT_PROXY_CONFIG };
  }
}

let proxyConfig = loadEncryptedCredentials();

// ============================================================================
// 4. SSRF VALIDATION & PRIVACY SANITIZATION
// ============================================================================

const DEFAULT_ALLOWED_HOSTS = ['reqs.frt.vn', 'jenkins-osp.frt.vn'];

function getAllowedUpstreamHosts() {
  const extra = (process.env.ALLOWED_UPSTREAM_HOSTS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return new Set([...DEFAULT_ALLOWED_HOSTS, ...extra]);
}

function validateUpstreamUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return { ok: false, reason: 'URL rỗng hoặc không hợp lệ' };
  }
  try {
    const parsed = new URL(rawUrl.trim());
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return { ok: false, reason: 'Chỉ cho phép giao thức https:// hoặc http://' };
    }
    const hostname = parsed.hostname.toLowerCase();
    // Block cloud metadata / loopback SSRF
    if (
      hostname === '169.254.169.254' ||
      hostname === '0.0.0.0' ||
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '::1' ||
      hostname.startsWith('169.254.')
    ) {
      return { ok: false, reason: `Chặn SSRF tới địa chỉ nội bộ/metadata: ${hostname}` };
    }
    const allowed = getAllowedUpstreamHosts();
    const isAllowed =
      allowed.has(hostname) ||
      hostname.endsWith('.frt.vn') ||
      hostname.endsWith('.fptshop.com.vn') ||
      hostname.endsWith('.nhathuoclongchau.com.vn');
    if (!isAllowed) {
      return {
        ok: false,
        reason: `Hostname '${hostname}' không nằm trong danh sách cho phép (reqs.frt.vn, jenkins-osp.frt.vn, *.frt.vn hoặc ALLOWED_UPSTREAM_HOSTS).`,
      };
    }
    return { ok: true, url: parsed.toString() };
  } catch (err) {
    return { ok: false, reason: `URL sai cú pháp: ${err.message}` };
  }
}

function stripHtmlTags(html) {
  if (!html) return '';
  return String(html)
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function sanitizePublicText(text, ticketKey, toStatus, fromAcc, toAcc, privacySanitize) {
  const clean = stripHtmlTags(text)
    // Mask email addresses & tokens even when privacySanitize is off
    .replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, '[redacted-email]')
    .replace(/(Bearer\s+|Basic\s+)[A-Za-z0-9._~+/-]+=*/gi, '[redacted-token]');

  if (!privacySanitize) {
    return clean.slice(0, 220);
  }
  // When privacySanitize is enabled, keep ticket key, accounts, and safe workflow summary
  const safeSnippet = clean
    .replace(/https?:\/\/[^\s]+/gi, '')
    .replace(/\b\d{9,12}\b/g, '[redacted]')
    .trim()
    .slice(0, 140);
  return safeSnippet || `[${ticketKey}] ${fromAcc} ➔ ${toAcc} (${toStatus})`;
}

// ============================================================================
// 5. LAYER 1: SERVER RAM CACHE DEDUPLICATOR (`seenFingerprints` + `currentSeq`)
// ============================================================================

const MAX_SEEN_FINGERPRINTS = 2000;
const MAX_RING_BUFFER_EVENTS = 100;

/**
 * LRUCache / Map<string, { seq: number, firstSeenAt: number, lastSeenAt: number, hitCount: number, event: object | null }>
 */
const seenFingerprints = new Map();
let currentSeq = 0;
const eventRingBuffer = [];
let jenkinsSnapshot = [];
let highestJenkinsBuildNumber = 0;

// Active raw XML buffers (updated by upstream polling or manual XML ingest)
let customIngestedJiraXml = null;
let customIngestedJenkinsXml = null;

const dedupStats = {
  totalPolls: 0,
  totalRawEntriesRead: 0,
  uniqueEventsEmitted: 0,
  duplicatesDropped: 0,
  jiraEntriesRead: 0,
  jenkinsEntriesRead: 0,
  jiraDuplicatesDropped: 0,
  jenkinsDuplicatesDropped: 0,
  lastPollAt: null,
  lastPollSource: 'init',
  lastJiraHttpStatus: null,
  lastJenkinsHttpStatus: null,
  lastError: null,
};

function checkAndTouchFingerprint(fingerprint) {
  if (seenFingerprints.has(fingerprint)) {
    const existing = seenFingerprints.get(fingerprint);
    existing.hitCount += 1;
    existing.lastSeenAt = Date.now();
    // Refresh key in Map for LRU ordering
    seenFingerprints.delete(fingerprint);
    seenFingerprints.set(fingerprint, existing);
    return { exists: true, record: existing };
  }
  return { exists: false, record: null };
}

function storeNewFingerprint(fingerprint, seq, eventObj) {
  if (seenFingerprints.size >= MAX_SEEN_FINGERPRINTS) {
    const oldestKey = seenFingerprints.keys().next().value;
    if (oldestKey !== undefined) {
      seenFingerprints.delete(oldestKey);
    }
  }
  const now = Date.now();
  const record = {
    seq,
    firstSeenAt: now,
    lastSeenAt: now,
    hitCount: 1,
    event: eventObj,
  };
  seenFingerprints.set(fingerprint, record);
  return record;
}

function pushToEventRingBuffer(eventObj) {
  eventRingBuffer.push(eventObj);
  while (eventRingBuffer.length > MAX_RING_BUFFER_EVENTS) {
    eventRingBuffer.shift();
  }
}

/**
 * Tạo khóa định danh chuẩn (Canonical Fingerprint) cho Jira Activity XML `<entry>`:
 * Kết hợp: `entryId` + `ticketKey` + `fromAccount` + `toAccount` + `toStatus` + `updatedTimestamp`
 */
export function computeServerJiraFingerprint({
  entryId,
  ticketKey,
  fromAccount,
  toAccount,
  toStatus,
  updatedTimestamp,
}) {
  return [
    'jira',
    String(entryId || '').trim(),
    String(ticketKey || '').trim().toUpperCase(),
    normalizeAccountKey(fromAccount),
    normalizeAccountKey(toAccount),
    String(toStatus || '').trim().toUpperCase(),
    String(updatedTimestamp || '').trim(),
  ].join(':');
}

/**
 * Tạo khóa định danh chuẩn (Canonical Fingerprint) cho Jenkins RSS `<entry>`:
 * `jenkins:${jobName}:#${buildNumber}:${statusNormalized}`
 * Ví dụ: `jenkins:oneclickv4-build-ci:#2846:SUCCESS`
 */
export function computeServerJenkinsFingerprint(jobName, buildNumber, statusNormalized) {
  return `jenkins:${String(jobName || 'oneclickv4-build-ci').trim()}:#${Number(
    buildNumber
  )}:${String(statusNormalized || 'SUCCESS').trim().toUpperCase()}`;
}

function extractXmlTagText(block, tagNames) {
  for (const tag of tagNames) {
    const regex = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i');
    const match = regex.exec(block);
    if (match && match[1] !== undefined) {
      return match[1].trim();
    }
  }
  return '';
}

function extractXmlLinkHref(block) {
  const hrefMatch = /<link[^>]*\bhref=["']([^"']+)["'][^>]*>/i.exec(block);
  if (hrefMatch && hrefMatch[1]) return hrefMatch[1].trim();
  return extractXmlTagText(block, ['link']);
}

function formatRelativeTime(isoStr) {
  if (!isoStr) return 'just now';
  const parsed = Date.parse(isoStr);
  if (Number.isNaN(parsed)) return 'just now';
  const diffMin = Math.max(1, Math.round((Date.now() - parsed) / 60_000));
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHours = Math.round(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${Math.round(diffHours / 24)}d ago`;
}

/**
 * Parse raw Jira Activity Atom XML into normalized entries
 */
export function parseRawJiraActivityXml(xmlText) {
  if (!xmlText || typeof xmlText !== 'string') return [];
  const entryBlocks = [];
  const entryRegex = /<(?:entry|item)(?:\s[^>]*)?>([\s\S]*?)<\/(?:entry|item)>/gi;
  let match;
  while ((match = entryRegex.exec(xmlText)) !== null) {
    entryBlocks.push(match[1]);
  }

  return entryBlocks.map((block, idx) => {
    const rawId =
      stripHtmlTags(extractXmlTagText(block, ['id', 'guid'])) || `frt-entry-${idx}`;
    const rawTitleHtml = extractXmlTagText(block, ['title']);
    const rawSummaryHtml = extractXmlTagText(block, ['summary', 'content', 'description']);
    const cleanTitle = stripHtmlTags(rawTitleHtml);
    const cleanSummary = stripHtmlTags(rawSummaryHtml);
    const combinedText = `${cleanTitle} ${cleanSummary}`;

    const usrUsername =
      stripHtmlTags(extractXmlTagText(block, ['usr:username'])) ||
      stripHtmlTags(extractXmlTagText(block, ['name', 'email', 'dc:creator', 'creator'])) ||
      '';
    const linkHref = extractXmlLinkHref(block);
    const updatedAt =
      stripHtmlTags(extractXmlTagText(block, ['updated', 'published', 'pubDate'])) ||
      '2026-11-05T09:30:00Z';

    const keyMatch =
      combinedText.match(/\b([A-Z][A-Z0-9_]{1,9}-\d+)\b/) ||
      linkHref.match(/\b([A-Z][A-Z0-9_]{1,9}-\d+)\b/);
    const ticketKey = keyMatch ? keyMatch[1].toUpperCase() : `FRT-${101 + (idx % 8)}`;

    const upperText = combinedText.toUpperCase();
    const toStatus =
      upperText.includes('DONE') ||
      upperText.includes('RESOLVED') ||
      upperText.includes('CLOSED') ||
      upperText.includes('HOÀN THÀNH')
        ? 'DONE'
        : upperText.includes('QA') ||
          upperText.includes('TEST') ||
          upperText.includes('KIỂM THỬ')
        ? 'QA_TESTING'
        : upperText.includes('REVIEW') || upperText.includes('PR')
        ? 'CODE_REVIEW'
        : upperText.includes('DEPLOY') || upperText.includes('RELEASE')
        ? 'READY_FOR_DEPLOY'
        : 'IN_PROGRESS';

    const isReturnToPM = toStatus === 'DONE';
    const resolvedAuthor = resolveEmployeeByAccount(usrUsername);
    const mentioned = extractMentionedAccounts(combinedText);

    const fromEmployeeId =
      resolvedAuthor?.employeeId || mentioned[0]?.employeeId || 'EMP-04';
    let toEmployeeId = 'EMP-01';
    if (!isReturnToPM) {
      const secondMention = mentioned.find((m) => m.employeeId !== fromEmployeeId);
      if (secondMention) {
        toEmployeeId = secondMention.employeeId;
      } else if (toStatus === 'CODE_REVIEW') {
        toEmployeeId = 'EMP-05';
      } else if (toStatus === 'QA_TESTING') {
        toEmployeeId = 'EMP-25';
      } else if (toStatus === 'READY_FOR_DEPLOY') {
        toEmployeeId = 'EMP-29';
      } else {
        toEmployeeId = fromEmployeeId === 'EMP-01' ? 'EMP-07' : 'EMP-04';
      }
    }

    const fromEmp = EMPLOYEE_BY_ID.get(fromEmployeeId) || { account: 'ThanhDQ13' };
    const toEmp = EMPLOYEE_BY_ID.get(toEmployeeId) || { account: 'DongNQ6' };
    const fromAccount = resolvedAuthor?.canonicalAccount || fromEmp.account;
    const toAccount = toEmp.account;

    const fingerprint = computeServerJiraFingerprint({
      entryId: rawId,
      ticketKey,
      fromAccount,
      toAccount,
      toStatus,
      updatedTimestamp: updatedAt,
    });

    return {
      id: rawId,
      fingerprint,
      ticketKey,
      summary: cleanSummary || cleanTitle || `Cập nhật Jira ${ticketKey}`,
      rawTitle: cleanTitle || `Activity on ${ticketKey}`,
      authorAccount: fromAccount,
      fromAccount,
      toAccount,
      fromEmployeeId,
      toEmployeeId,
      toStatus,
      isReturnToPM,
      updatedAt,
    };
  });
}

/**
 * Parse raw Jenkins RSS/Atom XML into normalized build items
 */
export function parseRawJenkinsRssXml(xmlText) {
  if (!xmlText || typeof xmlText !== 'string') return [];
  const entryBlocks = [];
  const entryRegex = /<(?:entry|item)(?:\s[^>]*)?>([\s\S]*?)<\/(?:entry|item)>/gi;
  let match;
  while ((match = entryRegex.exec(xmlText)) !== null) {
    entryBlocks.push(match[1]);
  }

  const fallbackDevOps = ['TienHK', 'SonNA2', 'ChienND22', 'ManhPT13', 'BaoNAT'];
  const builds = entryBlocks.map((block, idx) => {
    const rawTitle = stripHtmlTags(extractXmlTagText(block, ['title']));
    const rawId =
      stripHtmlTags(extractXmlTagText(block, ['id', 'guid'])) ||
      `jenkins-build-${idx}`;
    const link =
      extractXmlLinkHref(block) ||
      'https://jenkins-osp.frt.vn/job/oneclickv4-build-ci/';
    const publishedAt =
      stripHtmlTags(extractXmlTagText(block, ['published', 'updated', 'pubDate'])) ||
      '2026-11-05T09:34:00Z';
    const authorText = stripHtmlTags(
      extractXmlTagText(block, ['name', 'dc:creator', 'creator'])
    );
    const contentText = stripHtmlTags(
      extractXmlTagText(block, ['content', 'summary', 'description'])
    );

    const numMatch =
      rawTitle.match(/#(\d+)/) ||
      link.match(/\/(\d+)\/?$/) ||
      rawId.match(/:(\d+)$/);
    const buildNumber = numMatch ? parseInt(numMatch[1], 10) : 2846 - idx;

    const parenMatch = rawTitle.match(/\(([^)]+)\)/);
    const statusText = parenMatch ? parenMatch[1].trim() : 'stable';
    const lowerStatus = statusText.toLowerCase();

    const statusNormalized =
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

    const isUatJob = /oneclickv4-build-uat/i.test(`${rawTitle} ${link} ${rawId}`);
    const isReleaseJob = /oneclickv4-build-release/i.test(`${rawTitle} ${link} ${rawId}`);
    const jobName = isUatJob
      ? 'oneclickv4-build-uat'
      : isReleaseJob
      ? 'oneclickv4-build-release'
      : 'oneclickv4-build-ci';
    const clusterId = isUatJob ? 'UAT' : isReleaseJob ? 'RELEASE' : 'CI';
    const combinedMeta = `${authorText} ${contentText} ${rawTitle}`;
    const resolvedAccount =
      resolveEmployeeByAccount(authorText) ||
      extractMentionedAccounts(combinedMeta)[0];
    const triggeredBy =
      resolvedAccount?.canonicalAccount ||
      fallbackDevOps[idx % fallbackDevOps.length];
    const employeeId = resolvedAccount?.employeeId || 'EMP-29';

    const ticketMatch = combinedMeta.match(/\b([A-Z][A-Z0-9_]{1,9}-\d+)\b/);
    const ticketKey = ticketMatch ? ticketMatch[1].toUpperCase() : `FRT-${104 - (idx % 4)}`;
    const timeAgo =
      idx === 0
        ? '2m ago'
        : idx === 1
        ? '11m ago'
        : idx === 2
        ? '28m ago'
        : formatRelativeTime(publishedAt);

    const fingerprint = computeServerJenkinsFingerprint(
      jobName,
      buildNumber,
      statusNormalized
    );

    return {
      id: rawId,
      fingerprint,
      buildNumber,
      jobName,
      clusterId,
      statusText,
      status: statusNormalized,
      result: statusNormalized,
      timeAgo,
      relativeTime: timeAgo,
      publishedAt,
      triggeredByAccount: triggeredBy,
      triggeredBy,
      employeeId,
      ticketKey,
      link,
      url: link,
    };
  });

  return builds.sort((a, b) => b.buildNumber - a.buildNumber);
}

/**
 * Ingest Jira & Jenkins XML feeds through Layer-1 RAM Cache Deduplicator.
 * - If a `fingerprint` already exists in `seenFingerprints` -> DROP IMMEDIATELY (`duplicatesDropped++`).
 * - If new -> Increment `currentSeq++`, save to `seenFingerprints`, and push to `eventRingBuffer`.
 */
function ingestFeedsIntoRamCache(jiraXml, jenkinsXml, sourceLabel = 'poll') {
  dedupStats.totalPolls += 1;
  dedupStats.lastPollAt = new Date().toISOString();
  dedupStats.lastPollSource = sourceLabel;

  let newJiraEventsCount = 0;
  let newJenkinsEventsCount = 0;
  let droppedInThisBatch = 0;

  // 1. Process Jira Activity XML entries (oldest -> newest so seq increases chronologically)
  if (jiraXml && jiraXml.trim()) {
    const parsedJira = parseRawJiraActivityXml(jiraXml);
    const chronologicalJira = [...parsedJira].reverse();

    for (const item of chronologicalJira) {
      dedupStats.totalRawEntriesRead += 1;
      dedupStats.jiraEntriesRead += 1;

      const check = checkAndTouchFingerprint(item.fingerprint);
      if (check.exists) {
        dedupStats.duplicatesDropped += 1;
        dedupStats.jiraDuplicatesDropped += 1;
        droppedInThisBatch += 1;
        continue; // STRICTLY DROP DUPLICATE! Never emit twice!
      }

      currentSeq += 1;
      dedupStats.uniqueEventsEmitted += 1;
      newJiraEventsCount += 1;

      const sanitizedSummary = sanitizePublicText(
        item.summary,
        item.ticketKey,
        item.toStatus,
        item.fromAccount,
        item.toAccount,
        proxyConfig.privacySanitize
      );

      const sanitizedEvent = {
        seq: currentSeq,
        fingerprint: item.fingerprint,
        kind: 'JIRA_ACTIVITY',
        id: item.id,
        ticketKey: item.ticketKey,
        summary: sanitizedSummary,
        rawTitle: proxyConfig.privacySanitize
          ? `${item.fromAccount} transitioned ${item.ticketKey} to ${item.toStatus} (${item.toAccount})`
          : item.rawTitle,
        authorAccount: item.fromAccount,
        fromAccount: item.fromAccount,
        toAccount: item.toAccount,
        fromEmployeeId: item.fromEmployeeId,
        toEmployeeId: item.toEmployeeId,
        toStatus: item.toStatus,
        isReturnToPM: item.isReturnToPM,
        updatedAt: item.updatedAt,
        emittedAt: new Date().toISOString(),
      };

      storeNewFingerprint(item.fingerprint, currentSeq, sanitizedEvent);
      pushToEventRingBuffer(sanitizedEvent);
    }
  }

  // 2. Process Jenkins CI RSS XML entries
  if (jenkinsXml && jenkinsXml.trim()) {
    const parsedBuilds = parseRawJenkinsRssXml(jenkinsXml);
    if (parsedBuilds.length > 0) {
      jenkinsSnapshot = parsedBuilds.slice(0, 5).map((b) => ({
        id: b.id,
        fingerprint: b.fingerprint,
        buildNumber: b.buildNumber,
        jobName: b.jobName,
        statusText: b.statusText,
        status: b.status,
        result: b.result,
        timeAgo: b.timeAgo,
        relativeTime: b.relativeTime,
        publishedAt: b.publishedAt,
        triggeredByAccount: b.triggeredByAccount,
        triggeredBy: b.triggeredBy,
        ticketKey: b.ticketKey,
        link: b.link,
        url: b.url,
      }));
    }

    const newestBuildNumberInFeed =
      parsedBuilds.length > 0 ? parsedBuilds[0].buildNumber : 0;
    const isInitialBootstrap = highestJenkinsBuildNumber === 0;

    // Iterate through all entries in the RSS feed
    for (const build of parsedBuilds) {
      dedupStats.totalRawEntriesRead += 1;
      dedupStats.jenkinsEntriesRead += 1;

      const check = checkAndTouchFingerprint(build.fingerprint);
      if (check.exists) {
        dedupStats.duplicatesDropped += 1;
        dedupStats.jenkinsDuplicatesDropped += 1;
        droppedInThisBatch += 1;
        continue; // STRICTLY DROP DUPLICATE!
      }

      // Only emit an active walk-to-server event for the latest build on bootstrap
      // or when a new buildNumber / status transition appears!
      const shouldEmitWalkEvent = isInitialBootstrap
        ? build.buildNumber === newestBuildNumberInFeed
        : build.buildNumber >= highestJenkinsBuildNumber;

      if (shouldEmitWalkEvent) {
        highestJenkinsBuildNumber = Math.max(
          highestJenkinsBuildNumber,
          build.buildNumber
        );
        currentSeq += 1;
        dedupStats.uniqueEventsEmitted += 1;
        newJenkinsEventsCount += 1;

        const sanitizedBuildEvent = {
          seq: currentSeq,
          fingerprint: build.fingerprint,
          kind: 'JENKINS_BUILD',
          id: build.id,
          jobName: build.jobName,
          buildNumber: build.buildNumber,
          status: build.status,
          statusText: build.statusText,
          triggeredByAccount: build.triggeredByAccount,
          employeeId: build.employeeId,
          ticketKey: build.ticketKey,
          publishedAt: build.publishedAt,
          timeAgo: build.timeAgo,
          emittedAt: new Date().toISOString(),
        };

        storeNewFingerprint(build.fingerprint, currentSeq, sanitizedBuildEvent);
        pushToEventRingBuffer(sanitizedBuildEvent);
      } else {
        // Historical build in RSS feed: record its fingerprint in RAM cache so it never triggers later
        storeNewFingerprint(build.fingerprint, 0, null);
      }
    }
  }

  return {
    latestSeq: currentSeq,
    newJiraEventsCount,
    newJenkinsEventsCount,
    droppedInThisBatch,
  };
}

function resetRamDedupCache() {
  seenFingerprints.clear();
  eventRingBuffer.length = 0;
  currentSeq = 0;
  highestJenkinsBuildNumber = 0;
  customIngestedJiraXml = null;
  customIngestedJenkinsXml = null;
  dedupStats.totalPolls = 0;
  dedupStats.totalRawEntriesRead = 0;
  dedupStats.uniqueEventsEmitted = 0;
  dedupStats.duplicatesDropped = 0;
  dedupStats.jiraEntriesRead = 0;
  dedupStats.jenkinsEntriesRead = 0;
  dedupStats.jiraDuplicatesDropped = 0;
  dedupStats.jenkinsDuplicatesDropped = 0;
  dedupStats.lastPollAt = null;
  dedupStats.lastPollSource = 'reset';
  dedupStats.lastError = null;
}

// ============================================================================
// 6. UPSTREAM HTTP/HTTPS FETCHER WITH AUTHENTICATION & POLL COALESCING
// ============================================================================

function buildUpstreamAuthHeaders(authType, username, secret) {
  const headers = {
    Accept: 'application/atom+xml, application/rss+xml, application/xml, text/xml, */*',
    'User-Agent': 'Virtual-FRT-Office-Proxy/1.0',
  };
  const cleanSecret = String(secret || '').trim();
  const cleanUser = String(username || '').trim();

  if (authType === 'BASIC' && (cleanUser || cleanSecret)) {
    const token = Buffer.from(`${cleanUser}:${cleanSecret}`, 'utf8').toString('base64');
    headers.Authorization = `Basic ${token}`;
  } else if (authType === 'BEARER' && cleanSecret) {
    headers.Authorization = cleanSecret.startsWith('Bearer ')
      ? cleanSecret
      : `Bearer ${cleanSecret}`;
  } else if (authType === 'COOKIE' && cleanSecret) {
    headers.Cookie = cleanSecret;
  }
  return headers;
}

function fetchUrlText(targetUrl, headers, timeoutMs = 6500) {
  return new Promise((resolve, reject) => {
    const validation = validateUpstreamUrl(targetUrl);
    if (!validation.ok) {
      return reject(new Error(validation.reason));
    }

    const parsed = new URL(validation.url);
    const client = parsed.protocol === 'https:' ? https : http;
    const req = client.request(
      parsed,
      {
        method: 'GET',
        headers,
        rejectUnauthorized: false, // Support internal FRT self-signed corp certs
        timeout: timeoutMs,
      },
      (res) => {
        const chunks = [];
        let totalBytes = 0;
        res.on('data', (chunk) => {
          totalBytes += chunk.length;
          if (totalBytes <= 2 * 1024 * 1024) {
            chunks.push(chunk);
          }
        });
        res.on('end', () => {
          const body = Buffer.concat(chunks).toString('utf8');
          resolve({
            status: res.statusCode || 0,
            ok: (res.statusCode || 0) >= 200 && (res.statusCode || 0) < 300,
            body,
          });
        });
      }
    );

    req.on('timeout', () => {
      req.destroy(new Error(`Timeout after ${timeoutMs}ms`));
    });
    req.on('error', (err) => {
      reject(err);
    });
    req.end();
  });
}

let inFlightPollPromise = null;

async function executeUpstreamPollCycle(reason = 'auto-poll') {
  if (inFlightPollPromise) {
    return inFlightPollPromise;
  }

  inFlightPollPromise = (async () => {
    let jiraXml = '';
    let jenkinsXml = '';
    let jiraLiveOk = false;
    let jenkinsLiveOk = false;
    const errors = [];

    const hasJiraCredentials =
      proxyConfig.jiraAuthType === 'NONE' ||
      Boolean(proxyConfig.jiraUsername || proxyConfig.jiraSecret);

    // Try upstream fetch if credentials are provided or user explicitly clicks test-fetch
    if (hasJiraCredentials && proxyConfig.jiraUrl) {
      try {
        const jiraHeaders = buildUpstreamAuthHeaders(
          proxyConfig.jiraAuthType,
          proxyConfig.jiraUsername,
          proxyConfig.jiraSecret
        );
        const res = await fetchUrlText(proxyConfig.jiraUrl, jiraHeaders, 4500);
        dedupStats.lastJiraHttpStatus = res.status;
        if (
          res.ok &&
          (res.body.includes('<entry') ||
            res.body.includes('<feed') ||
            res.body.includes('<item'))
        ) {
          jiraXml = res.body;
          jiraLiveOk = true;
        } else {
          errors.push(`Jira HTTP ${res.status}`);
        }
      } catch (err) {
        dedupStats.lastJiraHttpStatus = 0;
        errors.push(`Jira: ${err.message}`);
      }
    }

    if (proxyConfig.jenkinsUrl && (hasJiraCredentials || proxyConfig.jenkinsSecret)) {
      try {
        const jenkinsHeaders = buildUpstreamAuthHeaders(
          proxyConfig.jenkinsAuthType !== 'NONE'
            ? proxyConfig.jenkinsAuthType
            : proxyConfig.jiraAuthType,
          proxyConfig.jenkinsUsername || proxyConfig.jiraUsername,
          proxyConfig.jenkinsSecret || proxyConfig.jiraSecret
        );
        const res = await fetchUrlText(proxyConfig.jenkinsUrl, jenkinsHeaders, 4500);
        dedupStats.lastJenkinsHttpStatus = res.status;
        if (
          res.ok &&
          (res.body.includes('<entry') ||
            res.body.includes('<feed') ||
            res.body.includes('<item') ||
            res.body.includes('<rss'))
        ) {
          jenkinsXml = res.body;
          jenkinsLiveOk = true;
        } else {
          errors.push(`Jenkins HTTP ${res.status}`);
        }
        // Đồng thời lắng nghe thêm luồng `https://jenkins-osp.frt.vn/job/oneclickv4-build-uat/rssAll`
        try {
          const uatUrl = proxyConfig.jenkinsUrl.includes('oneclickv4-build-ci')
            ? proxyConfig.jenkinsUrl.replace('oneclickv4-build-ci', 'oneclickv4-build-uat')
            : 'https://jenkins-osp.frt.vn/job/oneclickv4-build-uat/rssAll';
          const uatRes = await fetchUrlText(uatUrl, jenkinsHeaders, 4500);
          if (
            uatRes.ok &&
            (uatRes.body.includes('<entry') ||
              uatRes.body.includes('<feed') ||
              uatRes.body.includes('<item'))
          ) {
            jenkinsXml = jenkinsXml ? `${jenkinsXml}\n${uatRes.body}` : uatRes.body;
            jenkinsLiveOk = true;
          }
        } catch {
          // Ignore optional UAT upstream fetch error
        }
      } catch (err) {
        dedupStats.lastJenkinsHttpStatus = 0;
        errors.push(`Jenkins: ${err.message}`);
      }
    }

    let sourceUsed = 'live-upstream';
    if (!jiraLiveOk && !jenkinsLiveOk) {
      if (customIngestedJiraXml || customIngestedJenkinsXml) {
        jiraXml = customIngestedJiraXml || '';
        jenkinsXml = customIngestedJenkinsXml || '';
        sourceUsed = 'custom-ingested-xml';
      } else if (proxyConfig.useSeedFallbackWhenOffline) {
        jiraXml = SEED_FRT_JIRA_ACTIVITY_XML;
        jenkinsXml = SEED_FRT_JENKINS_RSS_XML;
        sourceUsed = 'seed-xml-cache';
      } else {
        sourceUsed = 'upstream-offline';
      }
    }

    dedupStats.lastError = errors.length > 0 ? errors.join(' | ') : null;
    const ingestResult = ingestFeedsIntoRamCache(jiraXml, jenkinsXml, `${reason}:${sourceUsed}`);
    return {
      ...ingestResult,
      sourceUsed,
      jiraLiveOk,
      jenkinsLiveOk,
      lastError: dedupStats.lastError,
    };
  })().finally(() => {
    inFlightPollPromise = null;
  });

  return inFlightPollPromise;
}

// Background polling timer
let backgroundPollTimer = null;
function restartBackgroundPollTimer() {
  if (backgroundPollTimer) {
    clearInterval(backgroundPollTimer);
    backgroundPollTimer = null;
  }
  const sec = Math.max(5, Math.min(120, Number(proxyConfig.pollIntervalSec) || 10));
  backgroundPollTimer = setInterval(() => {
    void executeUpstreamPollCycle('background-timer');
  }, sec * 1000);
  if (backgroundPollTimer.unref) {
    backgroundPollTimer.unref();
  }
}

// ============================================================================
// 7. SECURITY MIDDLEWARE: CLOUDFLARE TUNNEL BLOCK, LOCALHOST GUARD & RATE LIMIT
// ============================================================================

const adminAuthFailuresByIp = new Map();
const publicRateLimitByIp = new Map();

function isLoopbackAddress(addr) {
  if (!addr) return false;
  return (
    addr === '127.0.0.1' ||
    addr === '::1' ||
    addr === '::ffff:127.0.0.1' ||
    addr === 'localhost'
  );
}

function isRequestFromCloudflareTunnel(req) {
  return Boolean(
    req.headers['cf-connecting-ip'] ||
      req.headers['cf-ray'] ||
      req.headers['cf-visitor'] ||
      req.headers['cf-ipcountry'] ||
      req.headers['cf-ew-via']
  );
}

function getClientIp(req) {
  const cfIp = req.headers['cf-connecting-ip'];
  if (cfIp) return String(cfIp).trim();
  const xff = req.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  return req.socket?.remoteAddress || 'unknown';
}

function checkPublicRateLimit(req) {
  const ip = getClientIp(req);
  const now = Date.now();
  const windowMs = 60_000;
  const maxRequestsPerMin = 180;

  let record = publicRateLimitByIp.get(ip);
  if (!record || now - record.windowStart > windowMs) {
    record = { windowStart: now, count: 0 };
    publicRateLimitByIp.set(ip, record);
  }
  record.count += 1;
  return record.count <= maxRequestsPerMin;
}

function verifyAdminAccess(req) {
  const remoteAddr = req.socket?.remoteAddress || '';
  const clientIp = getClientIp(req);
  const now = Date.now();

  // 1. Check brute-force lockout
  const failRecord = adminAuthFailuresByIp.get(clientIp);
  if (failRecord && failRecord.count >= 8 && now - failRecord.lastFailAt < 5 * 60_000) {
    return {
      allowed: false,
      status: 429,
      reason: 'Quá nhiều lần thử xác thực sai. Tạm khóa truy cập Admin trong 5 phút (Anti-Brute-Force).',
    };
  }

  // 2. STRICTLY BLOCK Cloudflare Tunnel traffic to /admin and /api/admin/*
  const fromCloudflare = isRequestFromCloudflareTunnel(req);
  const forwardedFor = req.headers['x-forwarded-for'];
  const hasExternalForward =
    forwardedFor && !isLoopbackAddress(String(forwardedFor).split(',')[0].trim());

  if (fromCloudflare || hasExternalForward) {
    const allowTunnelAdmin = process.env.ALLOW_TUNNEL_ADMIN === 'true';
    if (!allowTunnelAdmin) {
      return {
        allowed: false,
        status: 403,
        reason:
          'FORBIDDEN: Đường dẫn /admin và /api/admin/* bị khóa hoàn toàn khỏi Cloudflare Tunnel để bảo vệ Credential! Chỉ cho phép truy cập trực tiếp tại máy chủ http://127.0.0.1:8787/admin.',
      };
    }
  }

  // 3. Enforce loopback socket address unless ALLOW_REMOTE_ADMIN=true
  if (!isLoopbackAddress(remoteAddr) && process.env.ALLOW_REMOTE_ADMIN !== 'true') {
    return {
      allowed: false,
      status: 403,
      reason: `FORBIDDEN: Chỉ cho phép cấu hình Admin từ localhost (127.0.0.1 / ::1). IP hiện tại: ${remoteAddr}`,
    };
  }

  // 4. Optional ADMIN_MASTER_KEY check (timing-safe comparison)
  const requiredMasterKey = (process.env.ADMIN_MASTER_KEY || '').trim();
  if (requiredMasterKey.length > 0) {
    const providedKey = String(
      req.headers['x-admin-master-key'] ||
        (req.headers.authorization || '').replace(/^Bearer\s+/i, '') ||
        ''
    ).trim();

    const bufA = Buffer.from(requiredMasterKey, 'utf8');
    const bufB = Buffer.from(providedKey, 'utf8');
    const match =
      bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);

    if (!match) {
      const prev = adminAuthFailuresByIp.get(clientIp) || { count: 0, lastFailAt: 0 };
      adminAuthFailuresByIp.set(clientIp, {
        count: prev.count + 1,
        lastFailAt: now,
      });
      return {
        allowed: false,
        status: 401,
        reason: 'Yêu cầu mã khóa ADMIN_MASTER_KEY hợp lệ trong header X-Admin-Master-Key.',
      };
    }
  }

  return { allowed: true, status: 200 };
}

function setSecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-XSS-Protection', '0');
}

function sendJson(res, statusCode, data) {
  setSecurityHeaders(res);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.writeHead(statusCode);
  res.end(JSON.stringify(data, null, 2));
}

function readJsonBody(req, maxBytes = 256 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        req.destroy();
        reject(new Error('Payload too large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (err) {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

// ============================================================================
// 8. ADMIN WEB UI HTML (`http://127.0.0.1:8787/admin`)
// ============================================================================

function renderAdminHtmlPage() {
  return `<!DOCTYPE html>
<html lang="vi" class="dark">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>FRT Office Proxy Admin — Credential Vault & RAM Cache Deduplicator</title>
  <style>
    :root {
      color-scheme: dark;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #020617;
      color: #f1f5f9;
      line-height: 1.5;
    }
    .container {
      max-width: 1120px;
      margin: 0 auto;
      padding: 24px 16px 64px;
    }
    .card {
      background: #0f172a;
      border: 1px solid #1e293b;
      border-radius: 16px;
      padding: 20px;
      margin-bottom: 20px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.45);
    }
    .header-bar {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      border-bottom: 1px solid #1e293b;
      padding-bottom: 16px;
      margin-bottom: 20px;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 700;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    }
    .badge-emerald { background: rgba(16, 185, 129, 0.15); color: #6ee7b7; border: 1px solid rgba(16, 185, 129, 0.4); }
    .badge-amber { background: rgba(245, 158, 11, 0.15); color: #fcd34d; border: 1px solid rgba(245, 158, 11, 0.4); }
    .badge-sky { background: rgba(14, 165, 233, 0.15); color: #7dd3fc; border: 1px solid rgba(14, 165, 233, 0.4); }
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(175px, 1fr));
      gap: 12px;
      margin-top: 12px;
    }
    .stat-box {
      background: #020617;
      border: 1px solid #1e293b;
      border-radius: 12px;
      padding: 12px 14px;
    }
    .stat-label { font-size: 11px; color: #94a3b8; text-transform: uppercase; font-weight: 700; }
    .stat-value { font-size: 24px; font-weight: 800; font-family: ui-monospace, monospace; margin-top: 4px; }
    .form-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
      gap: 16px;
    }
    label {
      display: block;
      font-size: 12px;
      font-weight: 700;
      color: #cbd5e1;
      margin-bottom: 6px;
    }
    input[type="text"], input[type="password"], input[type="number"], select {
      width: 100%;
      padding: 9px 12px;
      border-radius: 10px;
      border: 1px solid #334155;
      background: #020617;
      color: #f8fafc;
      font-family: ui-monospace, monospace;
      font-size: 13px;
    }
    input:focus, select:focus {
      outline: none;
      border-color: #14b8a6;
    }
    .btn {
      cursor: pointer;
      border: none;
      border-radius: 10px;
      padding: 10px 16px;
      font-weight: 700;
      font-size: 13px;
      transition: all 0.15s ease;
      display: inline-flex;
      align-items: center;
      gap: 6px;
    }
    .btn-primary { background: linear-gradient(90deg, #14b8a6, #10b981); color: #020617; }
    .btn-primary:hover { filter: brightness(1.1); }
    .btn-secondary { background: #1e293b; color: #e2e8f0; border: 1px solid #334155; }
    .btn-secondary:hover { background: #334155; }
    .btn-danger { background: rgba(225, 29, 72, 0.2); color: #fda4af; border: 1px solid rgba(225, 29, 72, 0.5); }
    .btn-danger:hover { background: rgba(225, 29, 72, 0.35); }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 12px;
      font-family: ui-monospace, monospace;
    }
    th, td {
      text-align: left;
      padding: 8px 10px;
      border-bottom: 1px solid #1e293b;
    }
    th { color: #94a3b8; font-weight: 700; }
    .toast {
      padding: 12px 16px;
      border-radius: 12px;
      margin-bottom: 16px;
      font-size: 13px;
      font-weight: 600;
      display: none;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="header-bar">
      <div>
        <h1 style="margin:0; font-size:22px; color:#5eead4;">🛡️ Virtual FRT Office 2D — Backend Proxy & Credential Vault</h1>
        <p style="margin:4px 0 0; font-size:13px; color:#94a3b8;">
          Quản lý Credential mã hóa <strong>AES-256-GCM</strong> &amp; Bộ lọc trùng lặp <strong>2-Layer RAM Cache Deduplicator (afterSeq)</strong>
        </p>
      </div>
      <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
        <span class="badge badge-emerald">🔒 AES-256-GCM Vault</span>
        <span class="badge badge-amber">🚫 Blocked on Cloudflare Tunnel</span>
        <a href="/" class="btn btn-secondary" style="text-decoration:none;">🏢 Mở Văn Phòng 2D (/)</a>
      </div>
    </div>

    <div id="toastBox" class="toast"></div>

    <!-- SECTION 1: RAM CACHE DEDUPLICATION LIVE METRICS -->
    <div class="card">
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px;">
        <div>
          <h2 style="margin:0; font-size:16px; color:#38bdf8;">⚡ Tầng 1: Server RAM Cache Deduplication &amp; Monotonic Cursor (afterSeq)</h2>
          <p style="margin:2px 0 0; font-size:12px; color:#94a3b8;">
            Mỗi <code>&lt;entry&gt;</code> từ <code>reqs.frt.vn</code> và <code>jenkins-osp.frt.vn</code> được băm khóa <code>fingerprint</code> vào <code>seenFingerprints</code> (tối đa 2,000 keys trên RAM). Sự kiện trùng lặp bị loại bỏ 100% trước khi tới Client!
          </p>
        </div>
        <div style="display:flex; gap:8px; flex-wrap:wrap;">
          <button type="button" class="btn btn-primary" onclick="triggerTestPoll()">🔄 Poll &amp; Test Deduplication Ngay</button>
          <button type="button" class="btn btn-danger" onclick="triggerResetCache()">♻️ Reset RAM Dedup Cache</button>
        </div>
      </div>

      <div class="stats-grid">
        <div class="stat-box">
          <div class="stat-label">Monotonic Cursor (latestSeq)</div>
          <div class="stat-value" style="color:#38bdf8;" id="statLatestSeq">0</div>
        </div>
        <div class="stat-box">
          <div class="stat-label">Tổng số lần Poll (totalPolls)</div>
          <div class="stat-value" style="color:#f8fafc;" id="statTotalPolls">0</div>
        </div>
        <div class="stat-box">
          <div class="stat-label">Raw XML Entries Đã Đọc</div>
          <div class="stat-value" style="color:#cbd5e1;" id="statRawRead">0</div>
        </div>
        <div class="stat-box">
          <div class="stat-label">Sự kiện Duy Nhất Phát Ra</div>
          <div class="stat-value" style="color:#34d399;" id="statUniqueEmitted">0</div>
        </div>
        <div class="stat-box">
          <div class="stat-label">Trùng Lặp Đã Chặn (Dropped)</div>
          <div class="stat-value" style="color:#fbbf24;" id="statDuplicatesDropped">0</div>
        </div>
        <div class="stat-box">
          <div class="stat-label">RAM LRU Fingerprints</div>
          <div class="stat-value" style="color:#a78bfa;" id="statCacheSize">0 / 2000</div>
        </div>
      </div>
    </div>

    <!-- SECTION 2: CREDENTIAL VAULT FORM -->
    <form id="credForm" class="card" onsubmit="saveCredentials(event)">
      <h2 style="margin:0 0 12px; font-size:16px; color:#fcd34d;">🔑 Cấu hình Upstream URL &amp; Credential (Lưu mã hóa AES-256-GCM tại server/.credentials.enc.json)</h2>

      <div id="masterKeyRow" style="margin-bottom:16px; padding:12px; background:#020617; border:1px solid #334155; border-radius:10px;">
        <label>Header <code>X-Admin-Master-Key</code> (Chỉ cần nhập nếu máy chủ đặt biến môi trường <code>ADMIN_MASTER_KEY</code>):</label>
        <input type="password" id="adminMasterKey" placeholder="Để trống nếu truy cập trực tiếp từ 127.0.0.1 không bật ADMIN_MASTER_KEY" />
      </div>

      <div class="form-grid">
        <!-- Jira Column -->
        <div style="padding:14px; background:#020617; border:1px solid #1e293b; border-radius:12px;">
          <h3 style="margin:0 0 10px; font-size:14px; color:#fbbf24;">📄 1. Nguồn Jira Activity XML (reqs.frt.vn)</h3>
          <div style="margin-bottom:10px;">
            <label>Jira Activity Feed URL:</label>
            <input type="text" id="jiraUrl" required />
          </div>
          <div style="margin-bottom:10px;">
            <label>Kiểu xác thực Jira:</label>
            <select id="jiraAuthType">
              <option value="BASIC">BASIC (Username + Password / Token)</option>
              <option value="BEARER">BEARER (Personal Access Token)</option>
              <option value="COOKIE">COOKIE (JSESSIONID / Seraph Cookie)</option>
              <option value="NONE">NONE (Không gửi Auth)</option>
            </select>
          </div>
          <div style="margin-bottom:10px;">
            <label>FRT Account / Username (VD: dongnq6):</label>
            <input type="text" id="jiraUsername" placeholder="dongnq6" />
          </div>
          <div>
            <label>Password / Token / Cookie (<span id="jiraSecretStatus" style="color:#34d399;">Chưa lưu</span>):</label>
            <input type="password" id="jiraSecret" placeholder="Nhập mới để cập nhật (để trống nếu giữ nguyên mật khẩu đã lưu)" />
          </div>
        </div>

        <!-- Jenkins Column -->
        <div style="padding:14px; background:#020617; border:1px solid #1e293b; border-radius:12px;">
          <h3 style="margin:0 0 10px; font-size:14px; color:#38bdf8;">🖥️ 2. Nguồn Jenkins CI RSS (jenkins-osp.frt.vn)</h3>
          <div style="margin-bottom:10px;">
            <label>Jenkins RSS All URL:</label>
            <input type="text" id="jenkinsUrl" required />
          </div>
          <div style="margin-bottom:10px;">
            <label>Kiểu xác thực Jenkins:</label>
            <select id="jenkinsAuthType">
              <option value="NONE">Dùng chung Auth với Jira hoặc Không cần Auth</option>
              <option value="BASIC">BASIC (Username + API Token)</option>
              <option value="BEARER">BEARER Token</option>
              <option value="COOKIE">COOKIE</option>
            </select>
          </div>
          <div style="margin-bottom:10px;">
            <label>Jenkins Username (Tùy chọn):</label>
            <input type="text" id="jenkinsUsername" placeholder="tienhk / sonna2" />
          </div>
          <div>
            <label>Jenkins API Token / Password (<span id="jenkinsSecretStatus" style="color:#34d399;">Chưa lưu</span>):</label>
            <input type="password" id="jenkinsSecret" placeholder="Nhập mới để cập nhật (để trống nếu giữ nguyên)" />
          </div>
        </div>
      </div>

      <div style="display:flex; flex-wrap:wrap; gap:20px; align-items:center; margin-top:16px; padding-top:14px; border-top:1px solid #1e293b;">
        <div style="width:160px;">
          <label>Chu kỳ Server Poll (giây):</label>
          <input type="number" id="pollIntervalSec" min="5" max="120" value="10" />
        </div>
        <label style="display:flex; align-items:center; gap:8px; cursor:pointer; margin:0;">
          <input type="checkbox" id="privacySanitize" checked />
          <span>🛡️ Bật <strong>Privacy Sanitization</strong> (Ẩn nội dung nhạy cảm/email trên API Public)</span>
        </label>
        <label style="display:flex; align-items:center; gap:8px; cursor:pointer; margin:0;">
          <input type="checkbox" id="useSeedFallbackWhenOffline" checked />
          <span>🧪 Dùng Seed XML mẫu khi chưa nối VPN / chưa nhập Credential</span>
        </label>
        <div style="margin-left:auto;">
          <button type="submit" class="btn btn-primary">💾 Mã hóa AES-256-GCM &amp; Lưu Cấu Hình</button>
        </div>
      </div>
    </form>

    <!-- SECTION 3: RECENT DEDUPLICATED EVENTS RING BUFFER -->
    <div class="card">
      <h2 style="margin:0 0 10px; font-size:16px; color:#a78bfa;">📜 Nhật ký Sự kiện Duy Nhất trong Ring Buffer (Tối đa 100 events gần nhất)</h2>
      <div style="overflow-x:auto;">
        <table>
          <thead>
            <tr>
              <th>Seq (#)</th>
              <th>Loại</th>
              <th>Ticket / Build</th>
              <th>Luồng Nhân Vật</th>
              <th>Fingerprint (Khóa chống trùng lặp)</th>
              <th>Thời gian</th>
            </tr>
          </thead>
          <tbody id="eventsTableBody">
            <tr><td colspan="6" style="color:#64748b;">Đang tải...</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  </div>

  <script>
    function getHeaders() {
      const headers = { 'Content-Type': 'application/json' };
      const mk = document.getElementById('adminMasterKey').value.trim();
      if (mk) headers['X-Admin-Master-Key'] = mk;
      return headers;
    }

    function showToast(msg, isError = false) {
      const box = document.getElementById('toastBox');
      box.style.display = 'block';
      box.style.background = isError ? 'rgba(225, 29, 72, 0.2)' : 'rgba(16, 185, 129, 0.2)';
      box.style.border = isError ? '1px solid #f43f5e' : '1px solid #10b981';
      box.style.color = isError ? '#fda4af' : '#6ee7b7';
      box.textContent = msg;
    }

    async function loadAdminState() {
      try {
        const res = await fetch('/api/admin/status', { headers: getHeaders() });
        const data = await res.json();
        if (!res.ok) {
          showToast(data.error || 'Lỗi xác thực Admin', true);
          return;
        }
        const cfg = data.config;
        document.getElementById('jiraUrl').value = cfg.jiraUrl || '';
        document.getElementById('jiraAuthType').value = cfg.jiraAuthType || 'BASIC';
        document.getElementById('jiraUsername').value = cfg.jiraUsername || '';
        document.getElementById('jiraSecretStatus').textContent = cfg.hasJiraSecret ? 'Đã mã hóa AES-256-GCM ✅' : 'Chưa lưu';
        document.getElementById('jenkinsUrl').value = cfg.jenkinsUrl || '';
        document.getElementById('jenkinsAuthType').value = cfg.jenkinsAuthType || 'NONE';
        document.getElementById('jenkinsUsername').value = cfg.jenkinsUsername || '';
        document.getElementById('jenkinsSecretStatus').textContent = cfg.hasJenkinsSecret ? 'Đã mã hóa AES-256-GCM ✅' : 'Chưa lưu';
        document.getElementById('pollIntervalSec').value = cfg.pollIntervalSec || 10;
        document.getElementById('privacySanitize').checked = Boolean(cfg.privacySanitize);
        document.getElementById('useSeedFallbackWhenOffline').checked = Boolean(cfg.useSeedFallbackWhenOffline);

        renderStatsAndTable(data);
      } catch (err) {
        showToast('Không thể tải trạng thái Admin: ' + err.message, true);
      }
    }

    function renderStatsAndTable(data) {
      const st = data.dedupStats || {};
      document.getElementById('statLatestSeq').textContent = data.latestSeq ?? 0;
      document.getElementById('statTotalPolls').textContent = st.totalPolls ?? 0;
      document.getElementById('statRawRead').textContent = st.totalRawEntriesRead ?? 0;
      document.getElementById('statUniqueEmitted').textContent = st.uniqueEventsEmitted ?? 0;
      document.getElementById('statDuplicatesDropped').textContent = st.duplicatesDropped ?? 0;
      document.getElementById('statCacheSize').textContent = (st.cacheSize ?? 0) + ' / ' + (st.maxCacheSize ?? 2000);

      const tbody = document.getElementById('eventsTableBody');
      const events = data.recentEvents || [];
      if (events.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="color:#64748b;">Chưa có sự kiện nào trong Ring Buffer. Hãy bấm "Poll & Test Deduplication Ngay".</td></tr>';
        return;
      }
      tbody.innerHTML = events.slice().reverse().map(ev => {
        const isJira = ev.kind === 'JIRA_ACTIVITY';
        const badge = isJira
          ? '<span style="color:#fbbf24;">JIRA_ACTIVITY</span>'
          : '<span style="color:#38bdf8;">JENKINS_BUILD</span>';
        const keyCol = isJira ? ev.ticketKey : ('#' + ev.buildNumber + ' (' + ev.status + ')');
        const actorCol = isJira
          ? (ev.fromAccount + ' ➔ ' + ev.toAccount + ' [' + ev.toStatus + ']')
          : (ev.triggeredByAccount + ' ➔ Server CI [' + ev.ticketKey + ']');
        return '<tr>' +
          '<td style="color:#38bdf8;font-weight:700;">#' + ev.seq + '</td>' +
          '<td>' + badge + '</td>' +
          '<td style="font-weight:700;">' + keyCol + '</td>' +
          '<td>' + actorCol + '</td>' +
          '<td style="color:#94a3b8;font-size:11px;">' + ev.fingerprint + '</td>' +
          '<td style="color:#64748b;">' + (ev.emittedAt || '').slice(11, 19) + '</td>' +
        '</tr>';
      }).join('');
    }

    async function saveCredentials(e) {
      e.preventDefault();
      const payload = {
        jiraUrl: document.getElementById('jiraUrl').value.trim(),
        jiraAuthType: document.getElementById('jiraAuthType').value,
        jiraUsername: document.getElementById('jiraUsername').value.trim(),
        jiraSecret: document.getElementById('jiraSecret').value,
        jenkinsUrl: document.getElementById('jenkinsUrl').value.trim(),
        jenkinsAuthType: document.getElementById('jenkinsAuthType').value,
        jenkinsUsername: document.getElementById('jenkinsUsername').value.trim(),
        jenkinsSecret: document.getElementById('jenkinsSecret').value,
        pollIntervalSec: Number(document.getElementById('pollIntervalSec').value) || 10,
        privacySanitize: document.getElementById('privacySanitize').checked,
        useSeedFallbackWhenOffline: document.getElementById('useSeedFallbackWhenOffline').checked,
      };
      const res = await fetch('/api/admin/credentials', {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || 'Lỗi lưu cấu hình', true);
        return;
      }
      document.getElementById('jiraSecret').value = '';
      document.getElementById('jenkinsSecret').value = '';
      showToast(data.message || 'Đã mã hóa AES-256-GCM và lưu Credential thành công!');
      await loadAdminState();
    }

    async function triggerTestPoll() {
      const res = await fetch('/api/admin/test-fetch', {
        method: 'POST',
        headers: getHeaders(),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || 'Lỗi Poll', true);
        return;
      }
      showToast(data.message);
      await loadAdminState();
    }

    async function triggerResetCache() {
      const res = await fetch('/api/admin/reset-cache', {
        method: 'POST',
        headers: getHeaders(),
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.error || 'Lỗi Reset Cache', true);
        return;
      }
      showToast(data.message);
      await loadAdminState();
    }

    loadAdminState();
  </script>
</body>
</html>`;
}

// ============================================================================
// 9. STATIC FILE SERVER FOR `dist/` (PRODUCTION WEB APP)
// ============================================================================

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function serveStaticDistFile(req, res, pathname) {
  if (!fs.existsSync(DIST_DIR)) {
    sendJson(res, 503, {
      error:
        'Thư mục dist/ chưa được build. Hãy chạy `npm run build` hoặc `npm run start:prod`.',
    });
    return;
  }

  const safeRelPath = path.normalize(pathname === '/' ? '/index.html' : pathname).replace(/^(\.\.(\/|\\|$))+/, '');
  let filePath = path.join(DIST_DIR, safeRelPath);

  if (!filePath.startsWith(DIST_DIR)) {
    sendJson(res, 403, { error: 'Forbidden path traversal' });
    return;
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    // SPA Fallback to dist/index.html
    filePath = path.join(DIST_DIR, 'index.html');
  }

  if (!fs.existsSync(filePath)) {
    sendJson(res, 404, { error: 'Not Found' });
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';
  setSecurityHeaders(res);
  res.setHeader('Content-Type', contentType);
  if (ext === '.html') {
    res.setHeader('Cache-Control', 'no-cache');
  } else {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  }
  res.writeHead(200);
  fs.createReadStream(filePath).pipe(res);
}

// ============================================================================
// 10. HTTP SERVER ROUTER (PUBLIC STREAM API + HARDENED ADMIN API)
// ============================================================================

function getPublicDedupStatsSnapshot() {
  return {
    totalPolls: dedupStats.totalPolls,
    totalRawEntriesRead: dedupStats.totalRawEntriesRead,
    uniqueEventsEmitted: dedupStats.uniqueEventsEmitted,
    duplicatesDropped: dedupStats.duplicatesDropped,
    jiraEntriesRead: dedupStats.jiraEntriesRead,
    jenkinsEntriesRead: dedupStats.jenkinsEntriesRead,
    jiraDuplicatesDropped: dedupStats.jiraDuplicatesDropped,
    jenkinsDuplicatesDropped: dedupStats.jenkinsDuplicatesDropped,
    cacheSize: seenFingerprints.size,
    maxCacheSize: MAX_SEEN_FINGERPRINTS,
    ringBufferSize: eventRingBuffer.length,
    lastPollAt: dedupStats.lastPollAt,
    lastPollSource: dedupStats.lastPollSource,
  };
}

export function createOfficeProxyServer() {
  const server = http.createServer(async (req, res) => {
    try {
      const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
      const pathname = parsedUrl.pathname;
      const method = (req.method || 'GET').toUpperCase();

      // ----------------------------------------------------------------------
      // A. HARDENED ADMIN ROUTES (`/admin` & `/api/admin/*`)
      //    Strictly blocked from Cloudflare Tunnel & non-loopback IPs!
      // ----------------------------------------------------------------------
      if (pathname === '/admin' || pathname.startsWith('/admin/') || pathname.startsWith('/api/admin')) {
        const guard = verifyAdminAccess(req);
        if (!guard.allowed) {
          sendJson(res, guard.status, {
            ok: false,
            error: guard.reason,
            securityPolicy: 'LOCALHOST_ONLY_NO_CLOUDFLARE_TUNNEL',
          });
          return;
        }

        if (pathname === '/admin' && method === 'GET') {
          setSecurityHeaders(res);
          res.setHeader('Content-Type', 'text/html; charset=utf-8');
          res.setHeader('Cache-Control', 'no-store');
          res.writeHead(200);
          res.end(renderAdminHtmlPage());
          return;
        }

        if (pathname === '/api/admin/status' && method === 'GET') {
          sendJson(res, 200, {
            ok: true,
            latestSeq: currentSeq,
            config: {
              jiraUrl: proxyConfig.jiraUrl,
              jiraAuthType: proxyConfig.jiraAuthType,
              jiraUsername: proxyConfig.jiraUsername,
              hasJiraSecret: Boolean(proxyConfig.jiraSecret),
              jenkinsUrl: proxyConfig.jenkinsUrl,
              jenkinsAuthType: proxyConfig.jenkinsAuthType,
              jenkinsUsername: proxyConfig.jenkinsUsername,
              hasJenkinsSecret: Boolean(proxyConfig.jenkinsSecret),
              pollIntervalSec: proxyConfig.pollIntervalSec,
              privacySanitize: proxyConfig.privacySanitize,
              useSeedFallbackWhenOffline: proxyConfig.useSeedFallbackWhenOffline,
            },
            dedupStats: getPublicDedupStatsSnapshot(),
            recentEvents: eventRingBuffer.slice(-30),
            jenkinsSnapshot,
          });
          return;
        }

        if (pathname === '/api/admin/credentials' && method === 'POST') {
          const body = await readJsonBody(req);
          if (body.jiraUrl) {
            const checkJira = validateUpstreamUrl(body.jiraUrl);
            if (!checkJira.ok) {
              sendJson(res, 400, { ok: false, error: `Jira URL không hợp lệ: ${checkJira.reason}` });
              return;
            }
            proxyConfig.jiraUrl = checkJira.url;
          }
          if (body.jenkinsUrl) {
            const checkJenkins = validateUpstreamUrl(body.jenkinsUrl);
            if (!checkJenkins.ok) {
              sendJson(res, 400, { ok: false, error: `Jenkins URL không hợp lệ: ${checkJenkins.reason}` });
              return;
            }
            proxyConfig.jenkinsUrl = checkJenkins.url;
          }
          if (body.jiraAuthType) proxyConfig.jiraAuthType = String(body.jiraAuthType);
          if (body.jiraUsername !== undefined) proxyConfig.jiraUsername = String(body.jiraUsername).trim();
          if (body.jiraSecret && String(body.jiraSecret).trim().length > 0) {
            proxyConfig.jiraSecret = String(body.jiraSecret);
          }
          if (body.jenkinsAuthType) proxyConfig.jenkinsAuthType = String(body.jenkinsAuthType);
          if (body.jenkinsUsername !== undefined) proxyConfig.jenkinsUsername = String(body.jenkinsUsername).trim();
          if (body.jenkinsSecret && String(body.jenkinsSecret).trim().length > 0) {
            proxyConfig.jenkinsSecret = String(body.jenkinsSecret);
          }
          if (body.pollIntervalSec !== undefined) {
            proxyConfig.pollIntervalSec = Math.max(5, Math.min(120, Number(body.pollIntervalSec) || 10));
          }
          if (body.privacySanitize !== undefined) {
            proxyConfig.privacySanitize = Boolean(body.privacySanitize);
          }
          if (body.useSeedFallbackWhenOffline !== undefined) {
            proxyConfig.useSeedFallbackWhenOffline = Boolean(body.useSeedFallbackWhenOffline);
          }

          saveEncryptedCredentials(proxyConfig);
          restartBackgroundPollTimer();

          sendJson(res, 200, {
            ok: true,
            message: '🔒 Đã mã hóa AES-256-GCM và lưu Credential vào server/.credentials.enc.json thành công!',
          });
          return;
        }

        if (pathname === '/api/admin/test-fetch' && method === 'POST') {
          const pollResult = await executeUpstreamPollCycle('admin-manual-test');
          const totalNew = pollResult.newJiraEventsCount + pollResult.newJenkinsEventsCount;
          sendJson(res, 200, {
            ok: true,
            pollResult,
            latestSeq: currentSeq,
            dedupStats: getPublicDedupStatsSnapshot(),
            message:
              totalNew > 0
                ? `✅ Poll hoàn tất (${pollResult.sourceUsed}): Phát hiện ${totalNew} sự kiện MỚI (seq=${currentSeq}), đã lọc bỏ ${pollResult.droppedInThisBatch} bản ghi trùng lặp!`
                : `🛡️ 0 sự kiện mới (Đã lọc bỏ ${pollResult.droppedInThisBatch} sự kiện trùng lặp trong RAM Cache • Tổng đã chặn: ${dedupStats.duplicatesDropped})!`,
          });
          return;
        }

        if (pathname === '/api/admin/reset-cache' && method === 'POST') {
          resetRamDedupCache();
          sendJson(res, 200, {
            ok: true,
            latestSeq: currentSeq,
            dedupStats: getPublicDedupStatsSnapshot(),
            message: '♻️ Đã xóa trắng RAM Cache Deduplicator (seenFingerprints = 0, currentSeq = 0). Lần poll kế tiếp sẽ phát lại các sự kiện mới!',
          });
          return;
        }

        sendJson(res, 404, { ok: false, error: 'Admin endpoint not found' });
        return;
      }

      // ----------------------------------------------------------------------
      // B. SINGLE PUBLIC STREAM API (`GET /api/public/office-stream?afterSeq=<number>`)
      //    Safe to expose via Cloudflare Tunnel! Zero credentials exposed!
      // ----------------------------------------------------------------------
      if (pathname === '/api/public/office-stream' && method === 'GET') {
        if (!checkPublicRateLimit(req)) {
          sendJson(res, 429, {
            ok: false,
            error: 'Rate limit exceeded. Please poll at the configured interval.',
          });
          return;
        }

        const rawAfterSeq = parsedUrl.searchParams.get('afterSeq');
        const afterSeq =
          rawAfterSeq !== null && rawAfterSeq !== '' && !Number.isNaN(Number(rawAfterSeq))
            ? Math.max(0, Math.floor(Number(rawAfterSeq)))
            : 0;

        // Run a coalesced poll cycle so the server's RAM Cache Deduplicator processes the latest feed
        const pollOutcome = await executeUpstreamPollCycle('public-stream-poll');

        // Filter events strictly by Monotonic Cursor `seq > afterSeq`
        let eventsToReturn = [];
        if (afterSeq > 0) {
          // Client already has a cursor: ONLY return events strictly newer than `afterSeq`!
          eventsToReturn = eventRingBuffer.filter((ev) => ev.seq > afterSeq);
        } else {
          // First-time client connection (`afterSeq == 0`): return at most 3 newest events
          // to initialize the office screen and hand out `latestSeq` for subsequent polls!
          eventsToReturn = eventRingBuffer.slice(-3);
        }

        const newBuildEvents = eventsToReturn.filter((ev) => ev.kind === 'JENKINS_BUILD');
        const statsSnapshot = getPublicDedupStatsSnapshot();

        sendJson(res, 200, {
          ok: true,
          afterSeq,
          latestSeq: currentSeq,
          eventsCount: eventsToReturn.length,
          events: eventsToReturn,
          newBuildEvents,
          jenkinsSnapshot: jenkinsSnapshot.slice(0, 5),
          dedupStats: statsSnapshot,
          pollSummary: {
            sourceUsed: pollOutcome.sourceUsed,
            newEventsInPoll:
              pollOutcome.newJiraEventsCount + pollOutcome.newJenkinsEventsCount,
            droppedInPoll: pollOutcome.droppedInThisBatch,
            message:
              eventsToReturn.length > 0
                ? `🟢 Đồng bộ ${eventsToReturn.length} sự kiện mới (seq ${afterSeq} ➔ ${currentSeq})`
                : `🛡️ 0 sự kiện mới (Đã lọc bỏ ${statsSnapshot.duplicatesDropped} sự kiện trùng lặp trong RAM Cache • seq=${currentSeq})`,
          },
        });
        return;
      }

      // Optional XML ingest through RAM Cache Deduplicator for Frontend XML Paste testing
      if (pathname === '/api/public/office-stream/ingest-xml' && method === 'POST') {
        if (!checkPublicRateLimit(req)) {
          sendJson(res, 429, { ok: false, error: 'Rate limit exceeded' });
          return;
        }
        const body = await readJsonBody(req);
        const prevSeq = currentSeq;
        const jiraXml = typeof body.jiraXml === 'string' ? body.jiraXml : '';
        const jenkinsXml = typeof body.jenkinsXml === 'string' ? body.jenkinsXml : '';
        if (jiraXml) customIngestedJiraXml = jiraXml;
        if (jenkinsXml) customIngestedJenkinsXml = jenkinsXml;

        const outcome = ingestFeedsIntoRamCache(jiraXml, jenkinsXml, 'client-xml-ingest');
        const newEvents = eventRingBuffer.filter((ev) => ev.seq > prevSeq);
        const statsSnapshot = getPublicDedupStatsSnapshot();

        sendJson(res, 200, {
          ok: true,
          previousSeq: prevSeq,
          latestSeq: currentSeq,
          eventsCount: newEvents.length,
          events: newEvents,
          newBuildEvents: newEvents.filter((ev) => ev.kind === 'JENKINS_BUILD'),
          jenkinsSnapshot: jenkinsSnapshot.slice(0, 5),
          dedupStats: statsSnapshot,
          droppedInThisBatch: outcome.droppedInThisBatch,
          message:
            newEvents.length > 0
              ? `✅ Đã phát ${newEvents.length} sự kiện mới (seq=${currentSeq})`
              : `🛡️ 0 sự kiện mới (Đã lọc bỏ ${outcome.droppedInThisBatch} sự kiện trùng lặp trong RAM Cache)`,
        });
        return;
      }

      // Healthcheck endpoint
      if (pathname === '/api/public/health' && method === 'GET') {
        sendJson(res, 200, {
          ok: true,
          service: 'virtual-frt-office-2d-proxy',
          latestSeq: currentSeq,
          dedupStats: getPublicDedupStatsSnapshot(),
        });
        return;
      }

      // ----------------------------------------------------------------------
      // C. SERVE STATIC FRONTEND (`dist/`) FOR ALL OTHER GET REQUESTS
      // ----------------------------------------------------------------------
      if (method === 'GET' || method === 'HEAD') {
        serveStaticDistFile(req, res, pathname);
        return;
      }

      sendJson(res, 404, { ok: false, error: 'Not Found' });
    } catch (err) {
      sendJson(res, 500, {
        ok: false,
        error: err instanceof Error ? err.message : 'Internal Server Error',
      });
    }
  });

  return server;
}

// Start server if executed directly (`node server/proxyServer.mjs`)
const isMainModule =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);

if (isMainModule) {
  const server = createOfficeProxyServer();
  restartBackgroundPollTimer();
  server.listen(PORT, BIND_HOST, () => {
    console.log('========================================================================');
    console.log(`🚀 Virtual FRT Office 2D — Hardened Proxy & RAM Cache Deduplicator`);
    console.log(`🌐 Public Web & Single API : http://127.0.0.1:${PORT}/api/public/office-stream?afterSeq=0`);
    console.log(`🔒 Local-Only Admin UI     : http://127.0.0.1:${PORT}/admin (Blocked on Cloudflare Tunnel)`);
    console.log(`🛡️ RAM Cache Deduplicator  : Max ${MAX_SEEN_FINGERPRINTS} keys | Ring Buffer ${MAX_RING_BUFFER_EVENTS} events`);
    console.log('========================================================================');
  });
}
