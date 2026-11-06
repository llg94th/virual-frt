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
// VAULT_DIR: thư mục lưu credential/master key và danh sách nhân sự trong ngày (Docker mount volume riêng, không đè lên code server/)
const VAULT_DIR = process.env.VAULT_DIR ? path.resolve(process.env.VAULT_DIR) : __dirname;
const CREDENTIALS_FILE = path.join(VAULT_DIR, '.credentials.enc.json');
const MASTER_KEY_FILE = path.join(VAULT_DIR, '.master.key');
const ACTIVE_USERS_TODAY_FILE = path.join(VAULT_DIR, '.active-users-today.json');

const PORT = Number(process.env.PORT || 8787);
const BIND_HOST = process.env.BIND_HOST || '0.0.0.0';

// ============================================================================
// 1. REAL-TIME CONNECTION DIAGNOSTIC LOG BUFFER (NO FAKE SEED XML!)
// ============================================================================

const MAX_CONNECTION_LOGS = 80;
const connectionLogs = [];

function pushConnectionLog(entry) {
  const logItem = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    timestamp: new Date().toISOString(),
    ...entry,
  };
  connectionLogs.push(logItem);
  while (connectionLogs.length > MAX_CONNECTION_LOGS) {
    connectionLogs.shift();
  }
  return logItem;
}

// ============================================================================
// 2. TODAY'S WORKING USERS REGISTRY (100% REAL USERS FROM JIRA/JENKINS, NO MOCK USERNAMES!)
// ============================================================================

const INACTIVITY_CHECKOUT_WINDOW_MS = 2 * 60 * 60 * 1000; // 2 hours

function getTodayDateKey() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

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

let activeUsersDayKey = getTodayDateKey();
/** Map<normalizedKey, ActiveOfficeUserRecord> */
const activeUsersTodayMap = new Map();
/** Next sequential seat index 1..30 */
let nextSeatCursor = 1;

function loadPersistedActiveUsersToday() {
  try {
    if (!fs.existsSync(ACTIVE_USERS_TODAY_FILE)) return;
    const raw = JSON.parse(fs.readFileSync(ACTIVE_USERS_TODAY_FILE, 'utf8'));
    const today = getTodayDateKey();
    if (!raw || raw.dayKey !== today || !Array.isArray(raw.users)) return;
    activeUsersTodayMap.clear();
    let maxSlot = 0;
    for (const u of raw.users) {
      const key = normalizeAccountKey(u.account);
      if (!key) continue;
      activeUsersTodayMap.set(key, u);
      const numMatch = String(u.employeeId || '').match(/EMP-(\d+)/);
      if (numMatch) {
        maxSlot = Math.max(maxSlot, parseInt(numMatch[1], 10));
      }
    }
    nextSeatCursor = (maxSlot % 30) + 1;
  } catch {
    // ignore corrupt snapshot
  }
}

function savePersistedActiveUsersToday() {
  try {
    const payload = {
      dayKey: activeUsersDayKey,
      updatedAt: new Date().toISOString(),
      users: Array.from(activeUsersTodayMap.values()),
    };
    fs.writeFileSync(ACTIVE_USERS_TODAY_FILE, JSON.stringify(payload, null, 2), 'utf8');
  } catch {
    // ignore fs write warnings
  }
}

function ensureCurrentDayRegistry() {
  const today = getTodayDateKey();
  if (today !== activeUsersDayKey) {
    activeUsersDayKey = today;
    activeUsersTodayMap.clear();
    nextSeatCursor = 1;
    savePersistedActiveUsersToday();
  }
}

function isSystemOrTicketString(raw) {
  if (!raw) return true;
  const clean = String(raw).trim();
  if (!clean) return true;
  if (/^(unknown|jenkins|hudson|system|jira-bot|jira-system|jira-user|anonymous)$/i.test(clean)) {
    return true;
  }
  // Reject Jira ticket keys like TADS-66493, FADS-51688, FI-35314
  if (/^[A-Z][A-Z0-9_]{1,9}-\d+$/i.test(clean)) {
    return true;
  }
  return false;
}

/**
 * Allocate or retrieve a dedicated seat (`EMP-01` .. `EMP-30`) for a real user today.
 * Strictly 100% real accounts — zero mock usernames!
 */
function registerOrUpdateActiveUserToday({
  account,
  displayName,
  email,
  ticketKey,
  status,
  summary,
  updatedAt,
  source = 'JIRA',
}) {
  ensureCurrentDayRegistry();
  const cleanAcc = String(account || '')
    .trim()
    .replace(/@.*$/, '');
  if (isSystemOrTicketString(cleanAcc)) return null;

  const key = normalizeAccountKey(cleanAcc);
  if (!key) return null;

  const parsedMs = updatedAt ? Date.parse(updatedAt) : Date.now();
  const eventMs = Number.isNaN(parsedMs) ? Date.now() : parsedMs;
  const eventIso = new Date(eventMs).toISOString();

  let existing = activeUsersTodayMap.get(key);
  if (!existing) {
    // Find first unoccupied EMP-01 .. EMP-30 slot
    const usedEmpIds = new Set(
      Array.from(activeUsersTodayMap.values()).map((u) => u.employeeId)
    );
    let chosenEmpId = `EMP-${String(nextSeatCursor).padStart(2, '0')}`;
    for (let i = 0; i < 30; i++) {
      const slotNum = ((nextSeatCursor - 1 + i) % 30) + 1;
      const cid = `EMP-${String(slotNum).padStart(2, '0')}`;
      if (!usedEmpIds.has(cid)) {
        chosenEmpId = cid;
        nextSeatCursor = (slotNum % 30) + 1;
        break;
      }
    }

    existing = {
      employeeId: chosenEmpId,
      account: cleanAcc,
      displayName: displayName && displayName.trim() ? displayName.trim() : cleanAcc,
      email: email || '',
      firstSeenAt: eventIso,
      lastEventAt: eventIso,
      lastEventAtMs: eventMs,
      lastTicketKey: ticketKey || '',
      lastStatus: status || 'IN_PROGRESS',
      lastSummary: summary || '',
      eventsCount: 1,
      source,
    };
    activeUsersTodayMap.set(key, existing);
  } else {
    existing.eventsCount = (existing.eventsCount || 1) + 1;
    if (displayName && displayName.trim() && existing.displayName === existing.account) {
      existing.displayName = displayName.trim();
    }
    if (email && !existing.email) {
      existing.email = email;
    }
    if (eventMs >= (existing.lastEventAtMs || 0)) {
      existing.lastEventAt = eventIso;
      existing.lastEventAtMs = eventMs;
      if (ticketKey) existing.lastTicketKey = ticketKey;
      if (status) existing.lastStatus = status;
      if (summary) existing.lastSummary = summary;
      existing.source = source;
    }
  }

  return existing;
}

function resolveEmployeeByAccount(rawAccount) {
  ensureCurrentDayRegistry();
  if (!rawAccount) return null;
  const key = normalizeAccountKey(rawAccount);
  if (!key) return null;
  const existing = activeUsersTodayMap.get(key);
  if (existing) {
    return {
      employeeId: existing.employeeId,
      canonicalAccount: existing.account,
    };
  }
  return null;
}

function getActiveUsersTodaySnapshot() {
  ensureCurrentDayRegistry();
  const allUsers = Array.from(activeUsersTodayMap.values()).sort(
    (a, b) => (b.lastEventAtMs || 0) - (a.lastEventAtMs || 0)
  );
  // Reference time: latest event in the feed or wall clock
  const newestEventMs =
    allUsers.length > 0
      ? Math.max(...allUsers.map((u) => u.lastEventAtMs || 0), Date.now())
      : Date.now();

  return allUsers.map((u) => {
    const idleMs = Math.max(0, newestEventMs - (u.lastEventAtMs || newestEventMs));
    const isWorking = idleMs < INACTIVITY_CHECKOUT_WINDOW_MS;
    return {
      ...u,
      isWorking,
      idleMinutes: Math.round(idleMs / 60000),
    };
  });
}

loadPersistedActiveUsersToday();

// ============================================================================
// 3. AES-256-GCM ENCRYPTED CREDENTIALS VAULT (`server/.credentials.enc.json`)
// ============================================================================

const DEFAULT_PROXY_CONFIG = {
  jiraUrl:
    'https://reqs.frt.vn/activity?maxResults=10&providers=issues&os_authType=basic',
  jiraAuthType: 'BASIC', // 'BASIC' | 'BEARER' | 'COOKIE' | 'NONE'
  jiraUsername: '',
  jiraSecret: '',
  jenkinsUrl: 'https://jenkins-osp.frt.vn/job/oneclickv4-build-ci/rssAll',
  jenkinsUatUrl: 'https://jenkins-osp.frt.vn/job/oneclickv4-build-uat/rssAll',
  jenkinsAuthType: 'NONE', // 'NONE' | 'BASIC' | 'BEARER' | 'COOKIE'
  jenkinsUsername: '',
  jenkinsSecret: '',
  pollIntervalSec: 10,
  privacySanitize: false,
  useSeedFallbackWhenOffline: false,
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

const DEFAULT_ALLOWED_HOSTS = ['reqs.frt.vn', 'jenkins-osp.frt.vn', 'jenkins-osp'];

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

function decodeHtmlEntities(str) {
  if (!str) return '';
  const entityMap = {
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
  // Decode up to 2 passes to handle double-escaped entities like `&amp;oacute;` or `&lt;a href=...&gt;`
  for (let pass = 0; pass < 2; pass++) {
    out = out.replace(
      /&(?:nbsp|amp|lt|gt|quot|#39|apos|[a-z]+);/gi,
      (match) => entityMap[match.toLowerCase()] ?? match
    );
  }
  return out;
}

function stripHtmlTags(html) {
  if (!html) return '';
  // Quan trọng: Phải giải mã `&lt;a href="..."&gt;` thành `<a href="...">` TRƯỚC khi xóa thẻ `<...>`!
  const decoded = decodeHtmlEntities(html);
  return decoded
    .replace(/<[^>]*>/g, ' ')
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

// Phải lớn hơn tổng số entry Jenkins RSS đọc mỗi lượt (~2500/poll cho CI+UAT); nếu nhỏ hơn, fingerprint Jira
// bị đẩy khỏi cache giữa 2 lần poll và cùng một sự kiện Jira bị phát lại liên tục.
const MAX_SEEN_FINGERPRINTS = Math.max(2000, Number(process.env.MAX_SEEN_FINGERPRINTS) || 50000);
const MAX_RING_BUFFER_EVENTS = 100;

/**
 * LRUCache / Map<string, { seq: number, firstSeenAt: number, lastSeenAt: number, hitCount: number, event: object | null }>
 */
const seenFingerprints = new Map();
let currentSeq = 0;
const eventRingBuffer = [];
let jenkinsSnapshot = [];
const highestJenkinsBuildByJob = new Map();

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
  lastJenkinsUatHttpStatus: null,
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

function hashStringToIndex(str, mod) {
  let h = 2166136261;
  const s = String(str || '');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % Math.max(1, mod);
}

function extractAllXmlTagValues(block, tagName) {
  const results = [];
  const regex = new RegExp(`<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tagName}>`, 'gi');
  let m;
  while ((m = regex.exec(block)) !== null) {
    const val = stripHtmlTags(m[1]).trim();
    if (val && !results.includes(val)) {
      results.push(val);
    }
  }
  return results;
}

// Global memory of the most recent real actor per Jira ticket key (e.g. AL-5090 -> huyenttm4 -> cuongph27 -> thundm)
const lastActorByTicketKey = new Map();
// Global memory mapping numeric LDAP IDs & normalized Vietnamese names -> real account (e.g. 106123 -> ngannn10)
const knownUserAccountLookup = new Map();

function vietnameseNameToFrtAccount(rawName) {
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
  // Standard FPT/FRT account convention: GivenName + Initials (e.g. "Le Nguyen Tan Loc" -> "LocLNT")
  const given = words[words.length - 1];
  const givenFormatted =
    given.charAt(0).toUpperCase() + given.slice(1).toLowerCase();
  const initials = words
    .slice(0, -1)
    .map((w) => w.charAt(0).toUpperCase())
    .join('');
  return `${givenFormatted}${initials}`;
}

function extractMentionedUsersFromJiraHtml(rawHtml) {
  if (!rawHtml) return [];
  const decoded = decodeHtmlEntities(rawHtml);
  const results = [];
  const linkRegex =
    /<a\b([^>]*ViewProfile\.jspa\?name=([^"&'\s>]+)[^>]*)>([\s\S]*?)<\/a>/gi;
  let m;
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

/**
 * Parse raw Jira Activity Atom XML into normalized entries (100% REAL DATA, NO FAKE FALLBACK ACCOUNTS!)
 * Supports FRT Jira format where:
 * - `<author><email>ngannn10@fpt.com</email><name>Nguyễn Ngọc Ngân</name><usr:username>106123</usr:username></author>`
 * - `<author><email>thundm@fpt.com</email><name>Nguyễn Đình Minh Thư ⏰</name><usr:username>37699</usr:username></author>`
 * - `<author><email>cuongph27@fpt.com</email><name>cuongph27</name><usr:username>cuongph27</usr:username></author>`
 * - `<activity:object><title type="text">AL-5090</title><summary type="text">[Core Specimen] Định nghĩa IndexGroup</summary></activity:object>`
 */
export function parseRawJiraActivityXml(xmlText) {
  if (!xmlText || typeof xmlText !== 'string') return [];
  const entryBlocks = [];
  const entryRegex = /<(?:entry|item)(?:\s[^>]*)?>([\s\S]*?)<\/(?:entry|item)>/gi;
  let match;
  while ((match = entryRegex.exec(xmlText)) !== null) {
    entryBlocks.push(match[1]);
  }

  // First pass: parse raw fields for each entry & register known author LDAP/name -> email account
  const rawItems = entryBlocks.map((block, idx) => {
    const rawId =
      stripHtmlTags(extractXmlTagText(block, ['id', 'guid'])) || `frt-entry-${idx}`;
    const rawTitleHtml = extractXmlTagText(block, ['title']);
    const rawContentHtml = extractXmlTagText(block, ['content']);
    const rawSummaryHtml = extractXmlTagText(block, ['summary', 'description']);
    const cleanTitle = stripHtmlTags(rawTitleHtml);
    const cleanSummary = stripHtmlTags(rawContentHtml || rawSummaryHtml);

    // Extract <activity:object> & <activity:target> blocks for exact ticket key & issue summary
    const objectBlock = extractXmlTagText(block, ['activity:object', 'object']);
    const targetBlock = extractXmlTagText(block, ['activity:target', 'target']);
    const objectTicketTitle =
      stripHtmlTags(extractXmlTagText(objectBlock, ['title'])) ||
      stripHtmlTags(extractXmlTagText(targetBlock, ['title']));
    const objectIssueSummary =
      stripHtmlTags(extractXmlTagText(objectBlock, ['summary'])) ||
      stripHtmlTags(extractXmlTagText(targetBlock, ['summary']));

    // Extract <author> block
    const authorBlock = extractXmlTagText(block, ['author']) || block;
    const authorEmail = stripHtmlTags(extractXmlTagText(authorBlock, ['email']));
    const emailPrefix = authorEmail.includes('@')
      ? authorEmail.split('@')[0].trim()
      : '';
    const rawUsrUsername = stripHtmlTags(
      extractXmlTagText(authorBlock, ['usr:username', 'username'])
    );
    // In FRT Jira, some users have numeric LDAP IDs in <usr:username> (e.g. 106123 for ngannn10@fpt.com)
    const nonNumericUsrUsername =
      rawUsrUsername && !/^\d+$/.test(rawUsrUsername) ? rawUsrUsername : '';
    const authorDisplayName = stripHtmlTags(
      extractXmlTagText(authorBlock, ['name', 'dc:creator', 'creator'])
    ).trim();

    // Priority: 1) email prefix (`ngannn10`, `sangpt19`, `ThuyPTT45`, `DuyenDTT3`), 2) non-numeric usr:username, 3) converted Vietnamese name
    const realAuthorAccount =
      emailPrefix ||
      nonNumericUsrUsername ||
      vietnameseNameToFrtAccount(authorDisplayName) ||
      authorDisplayName ||
      rawUsrUsername ||
      'jira-user';

    if (realAuthorAccount && realAuthorAccount !== 'jira-user') {
      if (rawUsrUsername) {
        knownUserAccountLookup.set(rawUsrUsername.toLowerCase(), realAuthorAccount);
      }
      if (authorDisplayName) {
        knownUserAccountLookup.set(authorDisplayName.toLowerCase(), realAuthorAccount);
      }
    }

    // Collect all non-numeric usernames/emails + ViewProfile links in the entry block (in case of assignee/target person)
    const allEmailsInBlock = extractAllXmlTagValues(block, 'email')
      .map((e) => (e.includes('@') ? e.split('@')[0].trim() : ''))
      .filter(Boolean);
    const allUsrInBlock = extractAllXmlTagValues(block, 'usr:username').filter(
      (u) => !/^\d+$/.test(u)
    );
    const profileMentions = [
      ...extractMentionedUsersFromJiraHtml(rawTitleHtml),
      ...extractMentionedUsersFromJiraHtml(rawContentHtml),
      ...extractMentionedUsersFromJiraHtml(rawSummaryHtml),
    ];

    const linkHref = extractXmlLinkHref(block);
    const updatedAt =
      stripHtmlTags(extractXmlTagText(block, ['updated', 'published', 'pubDate'])) ||
      new Date().toISOString();

    const keyMatch =
      objectTicketTitle.match(/^([A-Z][A-Z0-9_]{1,9}-\d+)$/i) ||
      cleanTitle.match(/\b([A-Z][A-Z0-9_]{1,9}-\d+)\b/) ||
      linkHref.match(/\b([A-Z][A-Z0-9_]{1,9}-\d+)\b/);
    const ticketKey = keyMatch ? keyMatch[1].toUpperCase() : `JIRA-${idx + 1}`;

    const isCommentOrAttachment =
      /<category[^>]*term=["']comment["']/i.test(block) ||
      /\b(commented|attached)\b/i.test(cleanTitle);
    const isCreatedVerb =
      !isCommentOrAttachment &&
      (/<category[^>]*term=["']created["']/i.test(block) ||
        /\bcreated\b/i.test(cleanTitle));

    // CHỈ entry chuyển trạng thái thật (verb `jira/transition`, hoặc tiêu đề "changed the status to") mới tạo sự kiện.
    // Comment / đính kèm file / sửa field / thêm fix version... bị bỏ qua, không có chuyến đi mang tài liệu.
    const isTransition =
      /streams\.atlassian\.com\/syndication\/verbs\/jira\/transition/i.test(block) ||
      /\bchanged the status to\b/i.test(cleanTitle) ||
      /\btransitioned\b/i.test(cleanTitle);

    // Trạng thái đích thật nằm trong <category term="3. Testing"/> của entry transition
    const categoryTerms = [...block.matchAll(/<category[^>]*\bterm=["']([^"']*)["']/gi)].map((m) =>
      m[1].trim()
    );
    const statusTerm = isTransition
      ? categoryTerms.find((t) => t && !/^(comment|created)$/i.test(t)) || ''
      : '';
    const classifySource = statusTerm || cleanTitle;

    // Classify status strictly (never match substring 'PR' inside 'ViewProfile'!)
    const toStatus =
      /\b(done|resolved|closed|hoàn thành)\b/i.test(classifySource)
        ? 'DONE'
        : /\b(qa|testing|kiểm thử|uat)\b/i.test(classifySource)
        ? 'QA_TESTING'
        : /\b(code review|in review|pull request|merge request|review)\b/i.test(classifySource)
        ? 'CODE_REVIEW'
        : /\b(fix version|release\/|deploy|ready for deploy)\b/i.test(classifySource)
        ? 'READY_FOR_DEPLOY'
        : isCreatedVerb || /\b(confirm|open|to ?do|backlog)\b/i.test(statusTerm)
        ? 'TODO'
        : 'IN_PROGRESS';

    const displaySummary =
      objectIssueSummary
        ? `[${ticketKey}] ${objectIssueSummary} — ${cleanTitle}`
        : cleanTitle || cleanSummary || `Cập nhật Jira ${ticketKey}`;

    return {
      rawId,
      ticketKey,
      cleanTitle,
      cleanSummary,
      displaySummary,
      realAuthorAccount,
      authorDisplayName,
      authorEmail,
      allEmailsInBlock,
      allUsrInBlock,
      profileMentions,
      toStatus,
      isTransition,
      updatedAt,
    };
  });

  // Process chronologically (oldest -> newest) so `lastActorByTicketKey` and `activeUsersTodayMap` link real collaborators
  const chronological = [...rawItems].reverse();
  const parsedByRawId = new Map();

  for (const item of chronological) {
    const fromAccount = item.realAuthorAccount;
    const authorRecord = registerOrUpdateActiveUserToday({
      account: fromAccount,
      displayName: item.authorDisplayName || fromAccount,
      email: item.authorEmail,
      ticketKey: item.ticketKey,
      status: item.toStatus,
      summary: item.displaySummary,
      updatedAt: item.updatedAt,
      source: 'JIRA',
    });
    const fromEmployeeId =
      authorRecord?.employeeId ||
      `EMP-${((hashStringToIndex(fromAccount, 30) % 30) + 1)
        .toString()
        .padStart(2, '0')}`;

    const isReturnToPM = item.toStatus === 'DONE';

    // Resolve any profile mentions in <title>/<content>/<summary> (e.g. "changed the Assignee to 'Lê Nguyễn Tấn Lộc'" or "@Bùi Thị Huyền Trân")
    const resolvedMentionUsers = [];
    for (const m of item.profileMentions) {
      const byLdap =
        m.ldapOrUser && knownUserAccountLookup.get(m.ldapOrUser.toLowerCase());
      const byName =
        m.displayText && knownUserAccountLookup.get(m.displayText.toLowerCase());
      const nonNumericLdap =
        m.ldapOrUser && !/^\d+$/.test(m.ldapOrUser) ? m.ldapOrUser : '';
      const acc =
        byLdap ||
        byName ||
        nonNumericLdap ||
        vietnameseNameToFrtAccount(m.displayText);
      if (acc) {
        resolvedMentionUsers.push({
          account: acc,
          displayName: m.displayText || acc,
        });
      }
    }

    const candidateTargetUsers = [];
    for (const em of item.allEmailsInBlock) {
      candidateTargetUsers.push({ account: em, displayName: em });
    }
    for (const u of item.allUsrInBlock) {
      candidateTargetUsers.push({ account: u, displayName: u });
    }
    for (const mu of resolvedMentionUsers) {
      candidateTargetUsers.push(mu);
    }

    // Find target collaborator (100% REAL USERS ONLY — ZERO MOCK USERNAMES!):
    // 1) Explicit 2nd user in the same XML entry (e.g. ThuyPTT45 -> LocLNT, DuyenDTT3 -> TranBTH)
    // 2) Previous real user who created/updated the same ticket (`TADS-66493`: ngannn10 <-> sangpt19)
    // 3) Another real active user working today in `activeUsersTodayMap`, or `fromAccount` itself if no other user exists yet
    const explicitSecondObj = candidateTargetUsers.find(
      (u) =>
        u.account &&
        normalizeAccountKey(u.account) !== normalizeAccountKey(fromAccount)
    );
    if (explicitSecondObj) {
      registerOrUpdateActiveUserToday({
        account: explicitSecondObj.account,
        displayName: explicitSecondObj.displayName,
        email: '',
        ticketKey: item.ticketKey,
        status: item.toStatus,
        summary: item.displaySummary,
        updatedAt: item.updatedAt,
        source: 'JIRA',
      });
    }

    const prevTicketCollaborator = lastActorByTicketKey.get(item.ticketKey);
    let targetUserAccount =
      explicitSecondObj?.account ||
      (prevTicketCollaborator &&
      normalizeAccountKey(prevTicketCollaborator) !== normalizeAccountKey(fromAccount)
        ? prevTicketCollaborator
        : '');

    if (!targetUserAccount) {
      // Pick another real user working today from activeUsersTodayMap (if any)
      for (const [, activeUser] of activeUsersTodayMap.entries()) {
        if (
          normalizeAccountKey(activeUser.account) !==
          normalizeAccountKey(fromAccount)
        ) {
          targetUserAccount = activeUser.account;
          break;
        }
      }
    }

    // Update last actor for this ticket key
    lastActorByTicketKey.set(item.ticketKey, fromAccount);

    // Chỉ tạo sự kiện đi bộ giao tài liệu khi là chuyển trạng thái (transition), đổi Assignee hoặc có tag đồng nghiệp thứ 2.
    // Các thao tác sửa field nhỏ lẻ của 1 người vẫn đã được ghi nhận vào `activeUsersTodayMap` (ngồi làm việc tại bàn)!
    const isAssigneeChange = /\bchanged the assignee to\b/i.test(item.cleanTitle);
    if (!item.isTransition && !isAssigneeChange && !explicitSecondObj) {
      continue;
    }

    // Never fallback to mock accounts like DongNQ6 or ThanhDQ13!
    const toAccount = targetUserAccount || fromAccount;
    const resolvedTarget = resolveEmployeeByAccount(toAccount);
    const toEmployeeId = resolvedTarget?.employeeId || fromEmployeeId;

    const fingerprint = computeServerJiraFingerprint({
      entryId: item.rawId,
      ticketKey: item.ticketKey,
      fromAccount,
      toAccount,
      toStatus: item.toStatus,
      updatedTimestamp: item.updatedAt,
    });

    parsedByRawId.set(item.rawId, {
      id: item.rawId,
      fingerprint,
      ticketKey: item.ticketKey,
      summary: item.displaySummary,
      rawTitle: item.cleanTitle || `Activity on ${item.ticketKey}`,
      authorAccount: fromAccount,
      authorDisplayName: item.authorDisplayName || fromAccount,
      fromAccount,
      toAccount,
      fromEmployeeId,
      toEmployeeId,
      toStatus: item.toStatus,
      isReturnToPM,
      updatedAt: item.updatedAt,
    });
  }

  savePersistedActiveUsersToday();
  return rawItems.map((it) => parsedByRawId.get(it.rawId)).filter(Boolean);
}

/**
 * Parse raw Jenkins RSS/Atom XML into normalized build items (100% REAL DATA!)
 * Supports FRT Jenkins `oneclickv4-build-ci` & `oneclickv4-build-uat` format:
 * - `<title>oneclickv4-build-ci bo-ci-agentos-worker:ci-41475 (stable)</title>`
 * - `<title>oneclickv4-build-ci lab-ci-lab-payment:ci-41449 (broken since this build)</title>`
 * - `<title>oneclickv4-build-ci #41362 (aborted)</title>`
 */
export function parseRawJenkinsRssXml(xmlText) {
  if (!xmlText || typeof xmlText !== 'string') return [];
  const entryBlocks = [];
  const entryRegex = /<(?:entry|item)(?:\s[^>]*)?>([\s\S]*?)<\/(?:entry|item)>/gi;
  let match;
  while ((match = entryRegex.exec(xmlText)) !== null) {
    entryBlocks.push(match[1]);
  }

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
      new Date().toISOString();
    const authorText = stripHtmlTags(
      extractXmlTagText(block, ['name', 'dc:creator', 'creator'])
    );
    const contentText = stripHtmlTags(
      extractXmlTagText(block, ['content', 'summary', 'description'])
    );

    // 1. Extract status inside trailing parentheses: `(stable)`, `(broken since this build)`, `(back to normal)`, `(aborted)`
    const parenMatch = rawTitle.match(/\(([^)]+)\)\s*$/);
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

    // 2. Parse jobName, serviceName, and buildTag from `<title>` without `(...)`
    // Example: `oneclickv4-build-ci bo-ci-agentos-worker:ci-41475`
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

    const isUatJob = /oneclickv4-build-uat|\buat\b/i.test(`${firstToken} ${link} ${rawId}`);
    const isReleaseJob = /oneclickv4-build-release|\brelease\b/i.test(`${firstToken} ${link} ${rawId}`);
    const jobName =
      firstToken && !firstToken.includes(':')
        ? firstToken
        : isUatJob
        ? 'oneclickv4-build-uat'
        : isReleaseJob
        ? 'oneclickv4-build-release'
        : 'oneclickv4-build-ci';
    const clusterId = isUatJob ? 'UAT' : isReleaseJob ? 'RELEASE' : 'CI';

    // 3. Extract real user if present (`Started by user ...`), otherwise use real microservice name (`bo-ci-agentos-worker`)
    const combinedMeta = `${authorText} ${contentText}`;
    const startedByMatch =
      combinedMeta.match(/Started by user\s+([a-zA-Z0-9._-]+)/i) ||
      combinedMeta.match(/by\s+([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+)/i);
    const rawUserFromJenkins =
      (startedByMatch ? startedByMatch[1].replace(/@.*$/, '') : '') ||
      (authorText && !/jenkins|hudson|anonymous|system/i.test(authorText) ? authorText : '');

    // Real build target / ticket label: e.g. `ci-41475` or `bo-ci-agentos-worker`
    const jiraKeyMatch = combinedMeta.match(/\b([A-Z]{2,8}-\d+)\b/);
    const ticketKey =
      (jiraKeyMatch ? jiraKeyMatch[1].toUpperCase() : '') ||
      buildTag ||
      serviceName ||
      `#${buildNumber}`;

    let userRecord = null;
    if (rawUserFromJenkins) {
      userRecord = registerOrUpdateActiveUserToday({
        account: rawUserFromJenkins,
        displayName: rawUserFromJenkins,
        email: '',
        ticketKey,
        status: statusNormalized === 'FAILURE' ? 'IN_PROGRESS' : 'READY_FOR_DEPLOY',
        summary: `${jobName} ${serviceName || ''} #${buildNumber} (${statusText})`,
        updatedAt: publishedAt,
        source: 'JENKINS',
      });
    } else if (activeUsersTodayMap.size > 0) {
      // Pick an active real user working today to walk to the Jenkins Server
      const activeList = Array.from(activeUsersTodayMap.values());
      userRecord = activeList[hashStringToIndex(serviceName || jobName, activeList.length)];
    }

    const triggeredBy =
      userRecord?.account ||
      rawUserFromJenkins ||
      serviceName ||
      jobName;

    const employeeId =
      userRecord?.employeeId ||
      `EMP-${((hashStringToIndex(triggeredBy, 30) % 30) + 1)
        .toString()
        .padStart(2, '0')}`;
    const timeAgo = formatRelativeTime(publishedAt);

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
      serviceName: serviceName || jobName,
      buildTag: buildTag || `#${buildNumber}`,
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
          ? `${item.fromAccount} (${item.authorDisplayName || item.fromAccount}) transitioned ${item.ticketKey} to ${item.toStatus} (${item.toAccount})`
          : item.rawTitle,
        authorAccount: item.fromAccount,
        authorDisplayName: item.authorDisplayName || item.fromAccount,
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

  // 2. Process Jenkins CI & UAT RSS XML entries
  if (jenkinsXml && jenkinsXml.trim()) {
    const parsedBuilds = parseRawJenkinsRssXml(jenkinsXml);
    if (parsedBuilds.length > 0) {
      jenkinsSnapshot = parsedBuilds.slice(0, 8).map((b) => ({
        id: b.id,
        fingerprint: b.fingerprint,
        buildNumber: b.buildNumber,
        jobName: b.jobName,
        clusterId: b.clusterId || 'CI',
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

    // Track newest build number per jobName (e.g. oneclickv4-build-ci vs oneclickv4-build-uat)
    const newestBuildInFeedByJob = new Map();
    for (const b of parsedBuilds) {
      const prevMax = newestBuildInFeedByJob.get(b.jobName) || 0;
      if (b.buildNumber > prevMax) {
        newestBuildInFeedByJob.set(b.jobName, b.buildNumber);
      }
    }

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

      const prevHighestForJob = highestJenkinsBuildByJob.get(build.jobName) || 0;
      const newestInFeedForJob = newestBuildInFeedByJob.get(build.jobName) || 0;
      const isInitialBootstrapForJob = prevHighestForJob === 0;

      // Only emit an active walk-to-server event for the latest build of each job on bootstrap
      // or when a new buildNumber / status transition appears!
      const shouldEmitWalkEvent = isInitialBootstrapForJob
        ? build.buildNumber === newestInFeedForJob
        : build.buildNumber >= prevHighestForJob;

      if (shouldEmitWalkEvent) {
        highestJenkinsBuildByJob.set(
          build.jobName,
          Math.max(prevHighestForJob, build.buildNumber)
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
          serviceName: build.serviceName || build.jobName,
          buildTag: build.buildTag || `#${build.buildNumber}`,
          clusterId: build.clusterId || 'CI',
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
  highestJenkinsBuildByJob.clear();
  activeUsersTodayMap.clear();
  lastActorByTicketKey.clear();
  nextSeatCursor = 1;
  savePersistedActiveUsersToday();
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
// 6. UPSTREAM HTTP/HTTPS FETCHER WITH AUTHENTICATION & DIAGNOSTIC LOGGER
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
  const startedAt = Date.now();
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
          const durationMs = Date.now() - startedAt;
          resolve({
            status: res.statusCode || 0,
            ok: (res.statusCode || 0) >= 200 && (res.statusCode || 0) < 300,
            durationMs,
            contentType: String(res.headers['content-type'] || ''),
            byteLength: Buffer.byteLength(body, 'utf8'),
            body,
          });
        });
      }
    );

    req.on('timeout', () => {
      req.destroy(new Error(`Timeout sau ${timeoutMs}ms`));
    });
    req.on('error', (err) => {
      reject(err);
    });
    req.end();
  });
}

/**
 * Thực thi kết nối tới Jira hoặc Jenkins RSS và ghi nhận log chẩn đoán chi tiết vào `connectionLogs`.
 */
async function diagnoseAndFetchUpstream({
  target,
  url,
  kind, // 'JIRA' | 'JENKINS'
  authType,
  username,
  secret,
  timeoutMs = 5500,
}) {
  const cleanUrl = String(url || '').trim();
  if (!cleanUrl) {
    const emptyLog = pushConnectionLog({
      target,
      url: '(chưa cấu hình URL)',
      authType,
      username: username || '(trống)',
      ok: false,
      status: 0,
      durationMs: 0,
      byteLength: 0,
      entriesCount: 0,
      message: '⚠️ Chưa nhập URL cho nguồn này.',
      sampleItems: [],
      bodyPreview: '',
    });
    return { ok: false, body: '', logEntry: emptyLog };
  }

  const startedAt = Date.now();
  try {
    const headers = buildUpstreamAuthHeaders(authType, username, secret);
    const res = await fetchUrlText(cleanUrl, headers, timeoutMs);
    const bodyTrimmed = res.body.trim();
    const isXmlFeed =
      bodyTrimmed.includes('<entry') ||
      bodyTrimmed.includes('<feed') ||
      bodyTrimmed.includes('<item') ||
      bodyTrimmed.includes('<rss');
    const isHtmlLogin =
      !isXmlFeed &&
      (bodyTrimmed.toLowerCase().includes('<!doctype html') ||
        bodyTrimmed.toLowerCase().includes('<html') ||
        bodyTrimmed.toLowerCase().includes('login'));

    let entriesCount = 0;
    let sampleItems = [];
    if (res.ok && isXmlFeed) {
      if (kind === 'JIRA') {
        const parsed = parseRawJiraActivityXml(res.body);
        entriesCount = parsed.length;
        sampleItems = parsed.slice(0, 3).map(
          (it) => `[${it.ticketKey}] ${it.fromAccount} ➔ ${it.toAccount} (${it.toStatus})`
        );
      } else {
        const parsed = parseRawJenkinsRssXml(res.body);
        entriesCount = parsed.length;
        sampleItems = parsed.slice(0, 3).map(
          (b) => `${b.jobName} #${b.buildNumber} (${b.status}) by ${b.triggeredByAccount} [${b.ticketKey}]`
        );
      }
    }

    const ok = Boolean(res.ok && isXmlFeed);
    let message = '';
    if (ok) {
      message = `✅ Kết nối thành công HTTP ${res.status} (${res.durationMs}ms, ${res.byteLength} bytes) — Đọc được ${entriesCount} <entry> XML.`;
    } else if (res.status === 401 || res.status === 403) {
      message = `❌ Lỗi xác thực HTTP ${res.status} (${res.durationMs}ms) — Kiểm tra lại Username / Password / Token / Cookie!`;
    } else if (isHtmlLogin) {
      message = `⚠️ Server trả về trang HTML Login thay vì XML (HTTP ${res.status}, ${res.byteLength} bytes) — Sai thông tin đăng nhập hoặc phiên Cookie hết hạn!`;
    } else {
      message = `❌ Phản hồi không hợp lệ HTTP ${res.status} (${res.durationMs}ms, ${res.byteLength} bytes) — Không tìm thấy thẻ <entry>/<feed>/<rss>.`;
    }

    const logEntry = pushConnectionLog({
      target,
      url: cleanUrl,
      authType,
      username: username || '(none)',
      ok,
      status: res.status,
      durationMs: res.durationMs,
      byteLength: res.byteLength,
      contentType: res.contentType,
      entriesCount,
      message,
      sampleItems,
      bodyPreview: stripHtmlTags(bodyTrimmed.slice(0, 260)),
    });

    return { ok, status: res.status, body: ok ? res.body : '', logEntry };
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    const errMsg = err instanceof Error ? err.message : String(err);
    const logEntry = pushConnectionLog({
      target,
      url: cleanUrl,
      authType,
      username: username || '(none)',
      ok: false,
      status: 0,
      durationMs,
      byteLength: 0,
      contentType: '',
      entriesCount: 0,
      message: `❌ Lỗi kết nối mạng (${durationMs}ms): ${errMsg}`,
      sampleItems: [],
      bodyPreview: errMsg,
    });
    return { ok: false, status: 0, body: '', logEntry };
  }
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
    let jenkinsUatLiveOk = false;
    const errors = [];

    const hasJiraCredentials =
      proxyConfig.jiraAuthType === 'NONE' ||
      Boolean(proxyConfig.jiraUsername || proxyConfig.jiraSecret);

    // 1. Poll Jira Activity XML
    // Khi bắt đầu ngày mới hoặc chưa gom đủ danh sách nhân sự làm việc trong ngày,
    // tự động nâng maxResults lên 50 ở lần kéo đầu để lấy trọn danh sách user làm việc từ đầu ngày!
    if (hasJiraCredentials && proxyConfig.jiraUrl) {
      let effectiveJiraUrl = proxyConfig.jiraUrl;
      if (activeUsersTodayMap.size < 5 && /maxResults=\d+/i.test(effectiveJiraUrl)) {
        effectiveJiraUrl = effectiveJiraUrl.replace(/maxResults=\d+/i, 'maxResults=50');
      }
      const jiraDiag = await diagnoseAndFetchUpstream({
        target: 'JIRA',
        url: effectiveJiraUrl,
        kind: 'JIRA',
        authType: proxyConfig.jiraAuthType,
        username: proxyConfig.jiraUsername,
        secret: proxyConfig.jiraSecret,
        timeoutMs: 5000,
      });
      dedupStats.lastJiraHttpStatus = jiraDiag.status;
      if (jiraDiag.ok) {
        jiraXml = jiraDiag.body;
        jiraLiveOk = true;
      } else {
        errors.push(`Jira: ${jiraDiag.logEntry.message}`);
      }
    }

    const effectiveJenkinsAuthType =
      proxyConfig.jenkinsAuthType !== 'NONE'
        ? proxyConfig.jenkinsAuthType
        : proxyConfig.jiraAuthType;
    const effectiveJenkinsUser =
      proxyConfig.jenkinsUsername || proxyConfig.jiraUsername;
    const effectiveJenkinsSecret =
      proxyConfig.jenkinsSecret || proxyConfig.jiraSecret;

    // 2. Poll Jenkins CI RSS (`jenkinsUrl`)
    if (proxyConfig.jenkinsUrl && (hasJiraCredentials || proxyConfig.jenkinsSecret)) {
      const ciDiag = await diagnoseAndFetchUpstream({
        target: 'JENKINS_CI',
        url: proxyConfig.jenkinsUrl,
        kind: 'JENKINS',
        authType: effectiveJenkinsAuthType,
        username: effectiveJenkinsUser,
        secret: effectiveJenkinsSecret,
        timeoutMs: 5000,
      });
      dedupStats.lastJenkinsHttpStatus = ciDiag.status;
      if (ciDiag.ok) {
        jenkinsXml = ciDiag.body;
        jenkinsLiveOk = true;
      } else {
        errors.push(`Jenkins CI: ${ciDiag.logEntry.message}`);
      }
    }

    // 3. Poll Jenkins UAT RSS (`jenkinsUatUrl`)
    if (proxyConfig.jenkinsUatUrl && (hasJiraCredentials || proxyConfig.jenkinsSecret)) {
      const uatDiag = await diagnoseAndFetchUpstream({
        target: 'JENKINS_UAT',
        url: proxyConfig.jenkinsUatUrl,
        kind: 'JENKINS',
        authType: effectiveJenkinsAuthType,
        username: effectiveJenkinsUser,
        secret: effectiveJenkinsSecret,
        timeoutMs: 5000,
      });
      dedupStats.lastJenkinsUatHttpStatus = uatDiag.status;
      if (uatDiag.ok) {
        jenkinsXml = jenkinsXml ? `${jenkinsXml}\n${uatDiag.body}` : uatDiag.body;
        jenkinsUatLiveOk = true;
        jenkinsLiveOk = true;
      } else {
        errors.push(`Jenkins UAT: ${uatDiag.logEntry.message}`);
      }
    }

    let sourceUsed = 'live-upstream';
    if (!jiraLiveOk && !jenkinsLiveOk) {
      if (customIngestedJiraXml || customIngestedJenkinsXml) {
        jiraXml = customIngestedJiraXml || '';
        jenkinsXml = customIngestedJenkinsXml || '';
        sourceUsed = 'custom-ingested-xml';
      } else {
        // Không bao giờ tự bơm dữ liệu mẫu (Seed XML) nữa!
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
      jenkinsUatLiveOk,
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
          <button type="button" class="btn btn-secondary" onclick="triggerTestConnection()">🔌 Test Connection (Jira + Jenkins CI + UAT)</button>
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
      <h2 style="margin:0 0 12px; font-size:16px; color:#fcd34d;">🔑 Cấu hình Upstream URL &amp; Credential (Lưu mã hóa AES-256-GCM tại server/.credentials.enc.json — 100% Dữ liệu Thật, Không Seed Mẫu)</h2>

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

        <!-- Jenkins Column (CI + UAT) -->
        <div style="padding:14px; background:#020617; border:1px solid #1e293b; border-radius:12px;">
          <h3 style="margin:0 0 10px; font-size:14px; color:#38bdf8;">🖥️ 2. Nguồn Jenkins CI &amp; UAT RSS (jenkins-osp.frt.vn)</h3>
          <div style="margin-bottom:10px;">
            <label>Jenkins CI RSS All URL (oneclickv4-build-ci):</label>
            <input type="text" id="jenkinsUrl" required placeholder="https://jenkins-osp.frt.vn/job/oneclickv4-build-ci/rssAll" />
          </div>
          <div style="margin-bottom:10px;">
            <label>Jenkins UAT RSS All URL (oneclickv4-build-uat):</label>
            <input type="text" id="jenkinsUatUrl" placeholder="https://jenkins-osp.frt.vn/job/oneclickv4-build-uat/rssAll" />
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

      <div style="display:flex; flex-wrap:wrap; gap:14px; align-items:center; margin-top:16px; padding-top:14px; border-top:1px solid #1e293b;">
        <div style="width:160px;">
          <label>Chu kỳ Server Poll (giây):</label>
          <input type="number" id="pollIntervalSec" min="5" max="120" value="10" />
        </div>
        <label style="display:flex; align-items:center; gap:8px; cursor:pointer; margin:0;">
          <input type="checkbox" id="privacySanitize" checked />
          <span>🛡️ Bật <strong>Privacy Sanitization</strong> (Ẩn nội dung nhạy cảm/email trên API Public)</span>
        </label>
        <div style="margin-left:auto; display:flex; gap:10px; flex-wrap:wrap;">
          <button type="button" class="btn btn-secondary" onclick="triggerTestConnection()">🔌 Test Connection Ngay (Jira + Jenkins CI + UAT)</button>
          <button type="submit" class="btn btn-primary">💾 Mã hóa AES-256-GCM &amp; Lưu Cấu Hình</button>
        </div>
      </div>
    </form>

    <!-- SECTION 2.5: LIVE CONNECTION DIAGNOSTIC LOGS (JIRA vs JENKINS CI vs JENKINS UAT) -->
    <div class="card">
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:10px; margin-bottom:10px;">
        <div>
          <h2 style="margin:0; font-size:16px; color:#34d399;">📡 Nhật ký Kiểm tra Kết nối (Test Connection Logs — Jira &amp; Jenkins CI / UAT)</h2>
          <p style="margin:2px 0 0; font-size:12px; color:#94a3b8;">
            Hiển thị chi tiết mã HTTP, thời gian phản hồi (ms), dung lượng XML, phát hiện lỗi Redirect trang Login HTML và danh sách mẫu các bản ghi đọc được.
          </p>
        </div>
        <button type="button" class="btn btn-secondary" onclick="triggerTestConnection()">🧪 Chạy Test Connection (3 Nguồn)</button>
      </div>
      <div style="overflow-x:auto;">
        <table>
          <thead>
            <tr>
              <th>Thời gian</th>
              <th>Nguồn</th>
              <th>Trạng thái HTTP</th>
              <th>Độ trễ / Dung lượng</th>
              <th>Số Entry XML</th>
              <th>Chi tiết Chẩn đoán &amp; Bản ghi Mẫu (Real XML)</th>
            </tr>
          </thead>
          <tbody id="connectionLogsTableBody">
            <tr><td colspan="6" style="color:#64748b;">Chưa có log kết nối. Hãy bấm "🔌 Test Connection Ngay" để kiểm tra kết nối Jira, Jenkins CI và Jenkins UAT.</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- SECTION 3: RECENT DEDUPLICATED EVENTS RING BUFFER -->
    <div class="card">
      <h2 style="margin:0 0 10px; font-size:16px; color:#a78bfa;">📜 Nhật ký Sự kiện Duy Nhất trong Ring Buffer (Tối đa 100 events thật gần nhất)</h2>
      <div style="overflow-x:auto;">
        <table>
          <thead>
            <tr>
              <th>Seq (#)</th>
              <th>Loại</th>
              <th>Ticket / Build</th>
              <th>Luồng Nhân Vật (Real Account)</th>
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
        document.getElementById('jenkinsUatUrl').value = cfg.jenkinsUatUrl || 'https://jenkins-osp.frt.vn/job/oneclickv4-build-uat/rssAll';
        document.getElementById('jenkinsAuthType').value = cfg.jenkinsAuthType || 'NONE';
        document.getElementById('jenkinsUsername').value = cfg.jenkinsUsername || '';
        document.getElementById('jenkinsSecretStatus').textContent = cfg.hasJenkinsSecret ? 'Đã mã hóa AES-256-GCM ✅' : 'Chưa lưu';
        document.getElementById('pollIntervalSec').value = cfg.pollIntervalSec || 10;
        document.getElementById('privacySanitize').checked = Boolean(cfg.privacySanitize);

        renderStatsAndTable(data);
        renderConnectionLogs(data.connectionLogs || []);
      } catch (err) {
        showToast('Không thể tải trạng thái Admin: ' + err.message, true);
      }
    }

    function renderConnectionLogs(logs) {
      const tbody = document.getElementById('connectionLogsTableBody');
      if (!logs || logs.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="color:#64748b;">Chưa có log kết nối. Hãy bấm "🔌 Test Connection Ngay" để kiểm tra kết nối Jira, Jenkins CI và Jenkins UAT.</td></tr>';
        return;
      }
      tbody.innerHTML = logs.map(item => {
        const statusBadge = item.ok
          ? '<span style="color:#34d399;font-weight:700;">🟢 HTTP ' + item.status + ' OK</span>'
          : '<span style="color:#f43f5e;font-weight:700;">🔴 ' + (item.status ? ('HTTP ' + item.status) : 'ERR') + '</span>';
        const targetBadge = item.target === 'JIRA'
          ? '<span style="color:#fbbf24;font-weight:700;">JIRA</span>'
          : (item.target === 'JENKINS_UAT'
              ? '<span style="color:#c084fc;font-weight:700;">JENKINS_UAT</span>'
              : '<span style="color:#38bdf8;font-weight:700;">JENKINS_CI</span>');
        const samplesHtml = (item.sampleItems && item.sampleItems.length > 0)
          ? '<div style="margin-top:4px;color:#cbd5e1;font-size:11px;">• ' + item.sampleItems.join('<br/>• ') + '</div>'
          : (item.bodyPreview ? '<div style="margin-top:4px;color:#fda4af;font-size:11px;">Snippet: ' + item.bodyPreview + '</div>' : '');
        return '<tr>' +
          '<td style="color:#94a3b8;white-space:nowrap;">' + (item.time || '').slice(11, 19) + '</td>' +
          '<td>' + targetBadge + '<div style="font-size:10px;color:#64748b;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="' + (item.url || '') + '">' + (item.url || '') + '</div></td>' +
          '<td>' + statusBadge + '<div style="font-size:10px;color:#94a3b8;">Auth: ' + (item.authType || 'NONE') + ' (' + (item.username || '-') + ')</div></td>' +
          '<td style="white-space:nowrap;">' + (item.durationMs ?? 0) + ' ms<br/><span style="color:#64748b;font-size:11px;">' + (item.byteLength ?? 0) + ' B</span></td>' +
          '<td style="font-weight:700;color:#38bdf8;">' + (item.entriesCount ?? 0) + ' entries</td>' +
          '<td><div style="font-weight:600;color:' + (item.ok ? '#6ee7b7' : '#fda4af') + ';">' + (item.message || '') + '</div>' + samplesHtml + '</td>' +
        '</tr>';
      }).join('');
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
        tbody.innerHTML = '<tr><td colspan="6" style="color:#64748b;">Chưa có sự kiện thật nào trong Ring Buffer (Đã tắt hoàn toàn Seed mẫu). Hãy bấm "🔌 Test Connection" hoặc "🔄 Poll & Test Deduplication Ngay".</td></tr>';
        return;
      }
      tbody.innerHTML = events.slice().reverse().map(ev => {
        const isJira = ev.kind === 'JIRA_ACTIVITY';
        const badge = isJira
          ? '<span style="color:#fbbf24;">JIRA_ACTIVITY</span>'
          : '<span style="color:#38bdf8;">JENKINS_BUILD (' + (ev.clusterId || 'CI') + ')</span>';
        const keyCol = isJira ? ev.ticketKey : ('#' + ev.buildNumber + ' (' + ev.status + ')');
        const actorCol = isJira
          ? (ev.fromAccount + ' ➔ ' + ev.toAccount + ' [' + ev.toStatus + ']')
          : (ev.triggeredByAccount + ' ➔ Server ' + (ev.clusterId || 'CI') + ' [' + ev.ticketKey + ']');
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
        jenkinsUatUrl: document.getElementById('jenkinsUatUrl').value.trim(),
        jenkinsAuthType: document.getElementById('jenkinsAuthType').value,
        jenkinsUsername: document.getElementById('jenkinsUsername').value.trim(),
        jenkinsSecret: document.getElementById('jenkinsSecret').value,
        pollIntervalSec: Number(document.getElementById('pollIntervalSec').value) || 10,
        privacySanitize: document.getElementById('privacySanitize').checked,
        useSeedFallbackWhenOffline: false,
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

    async function triggerTestConnection() {
      showToast('🔌 Đang kiểm tra kết nối trực tiếp tới Jira, Jenkins CI và Jenkins UAT...');
      const payload = {
        jiraUrl: document.getElementById('jiraUrl').value.trim(),
        jiraAuthType: document.getElementById('jiraAuthType').value,
        jiraUsername: document.getElementById('jiraUsername').value.trim(),
        jiraSecret: document.getElementById('jiraSecret').value,
        jenkinsUrl: document.getElementById('jenkinsUrl').value.trim(),
        jenkinsUatUrl: document.getElementById('jenkinsUatUrl').value.trim(),
        jenkinsAuthType: document.getElementById('jenkinsAuthType').value,
        jenkinsUsername: document.getElementById('jenkinsUsername').value.trim(),
        jenkinsSecret: document.getElementById('jenkinsSecret').value,
      };
      try {
        const res = await fetch('/api/admin/test-connection', {
          method: 'POST',
          headers: getHeaders(),
          body: JSON.stringify(payload),
        });
        const data = await res.json();
        if (!res.ok) {
          showToast(data.error || 'Lỗi Test Connection', true);
          return;
        }
        renderConnectionLogs(data.connectionLogs || []);
        showToast(data.message, !data.allOk);
      } catch (err) {
        showToast('Lỗi gọi API test-connection: ' + err.message, true);
      }
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
              jenkinsUatUrl:
                proxyConfig.jenkinsUatUrl ||
                'https://jenkins-osp.frt.vn/job/oneclickv4-build-uat/rssAll',
              jenkinsAuthType: proxyConfig.jenkinsAuthType,
              jenkinsUsername: proxyConfig.jenkinsUsername,
              hasJenkinsSecret: Boolean(proxyConfig.jenkinsSecret),
              pollIntervalSec: proxyConfig.pollIntervalSec,
              privacySanitize: proxyConfig.privacySanitize,
              useSeedFallbackWhenOffline: false,
            },
            dedupStats: getPublicDedupStatsSnapshot(),
            recentEvents: eventRingBuffer.slice(-30),
            jenkinsSnapshot,
            connectionLogs,
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
              sendJson(res, 400, { ok: false, error: `Jenkins CI URL không hợp lệ: ${checkJenkins.reason}` });
              return;
            }
            proxyConfig.jenkinsUrl = checkJenkins.url;
          }
          if (body.jenkinsUatUrl !== undefined) {
            const rawUat = String(body.jenkinsUatUrl || '').trim();
            if (rawUat) {
              const checkJenkinsUat = validateUpstreamUrl(rawUat);
              if (!checkJenkinsUat.ok) {
                sendJson(res, 400, { ok: false, error: `Jenkins UAT URL không hợp lệ: ${checkJenkinsUat.reason}` });
                return;
              }
              proxyConfig.jenkinsUatUrl = checkJenkinsUat.url;
            } else {
              proxyConfig.jenkinsUatUrl = '';
            }
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
          proxyConfig.useSeedFallbackWhenOffline = false;

          saveEncryptedCredentials(proxyConfig);
          restartBackgroundPollTimer();

          sendJson(res, 200, {
            ok: true,
            message: '🔒 Đã mã hóa AES-256-GCM và lưu Credential (Jira + Jenkins CI + Jenkins UAT) vào server/.credentials.enc.json thành công!',
          });
          return;
        }

        if (pathname === '/api/admin/test-connection' && method === 'POST') {
          const body = await readJsonBody(req);
          const testJiraUrl = String(body.jiraUrl || proxyConfig.jiraUrl || '').trim();
          const testJiraAuthType = String(body.jiraAuthType || proxyConfig.jiraAuthType || 'BASIC');
          const testJiraUser =
            body.jiraUsername !== undefined
              ? String(body.jiraUsername).trim()
              : proxyConfig.jiraUsername;
          const testJiraSecret =
            body.jiraSecret && String(body.jiraSecret).trim().length > 0
              ? String(body.jiraSecret)
              : proxyConfig.jiraSecret;

          const testJenkinsUrl = String(body.jenkinsUrl || proxyConfig.jenkinsUrl || '').trim();
          const testJenkinsUatUrl = String(
            body.jenkinsUatUrl !== undefined
              ? body.jenkinsUatUrl
              : proxyConfig.jenkinsUatUrl || 'https://jenkins-osp.frt.vn/job/oneclickv4-build-uat/rssAll'
          ).trim();
          const rawJenkinsAuthType = String(
            body.jenkinsAuthType || proxyConfig.jenkinsAuthType || 'NONE'
          );
          const effectiveJenkinsAuthType =
            rawJenkinsAuthType !== 'NONE' ? rawJenkinsAuthType : testJiraAuthType;
          const testJenkinsUser =
            (body.jenkinsUsername !== undefined
              ? String(body.jenkinsUsername).trim()
              : proxyConfig.jenkinsUsername) || testJiraUser;
          const testJenkinsSecret =
            (body.jenkinsSecret && String(body.jenkinsSecret).trim().length > 0
              ? String(body.jenkinsSecret)
              : proxyConfig.jenkinsSecret) || testJiraSecret;

          const [jiraRes, ciRes, uatRes] = await Promise.all([
            diagnoseAndFetchUpstream({
              target: 'JIRA',
              url: testJiraUrl,
              kind: 'JIRA',
              authType: testJiraAuthType,
              username: testJiraUser,
              secret: testJiraSecret,
              timeoutMs: 6000,
            }),
            diagnoseAndFetchUpstream({
              target: 'JENKINS_CI',
              url: testJenkinsUrl,
              kind: 'JENKINS',
              authType: effectiveJenkinsAuthType,
              username: testJenkinsUser,
              secret: testJenkinsSecret,
              timeoutMs: 6000,
            }),
            diagnoseAndFetchUpstream({
              target: 'JENKINS_UAT',
              url: testJenkinsUatUrl,
              kind: 'JENKINS',
              authType: effectiveJenkinsAuthType,
              username: testJenkinsUser,
              secret: testJenkinsSecret,
              timeoutMs: 6000,
            }),
          ]);

          const allOk = Boolean(jiraRes.ok && ciRes.ok && (!testJenkinsUatUrl || uatRes.ok));
          const summaryParts = [
            `Jira: ${jiraRes.ok ? `OK (${jiraRes.logEntry.entriesCount} entries)` : `FAIL (HTTP ${jiraRes.status || 'ERR'})`}`,
            `Jenkins CI: ${ciRes.ok ? `OK (${ciRes.logEntry.entriesCount} builds)` : `FAIL (HTTP ${ciRes.status || 'ERR'})`}`,
            `Jenkins UAT: ${uatRes.ok ? `OK (${uatRes.logEntry.entriesCount} builds)` : `FAIL (HTTP ${uatRes.status || 'ERR'})`}`,
          ];

          sendJson(res, 200, {
            ok: true,
            allOk,
            results: {
              jira: jiraRes.logEntry,
              jenkinsCi: ciRes.logEntry,
              jenkinsUat: uatRes.logEntry,
            },
            connectionLogs,
            message: `${allOk ? '✅ Tất cả kết nối đều THÀNH CÔNG!' : '⚠️ Kết quả kiểm tra kết nối:'} ${summaryParts.join(' | ')}`,
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
            connectionLogs,
            message:
              totalNew > 0
                ? `✅ Poll hoàn tất (${pollResult.sourceUsed}): Phát hiện ${totalNew} sự kiện MỚI (seq=${currentSeq}), đã lọc bỏ ${pollResult.droppedInThisBatch} bản ghi trùng lặp!`
                : pollResult.sourceUsed === 'upstream-offline'
                ? `⚠️ Chưa lấy được XML thật từ Jira / Jenkins (${pollResult.lastError || 'Kiểm tra bảng Nhật ký Kết nối bên dưới'}). Không dùng dữ liệu mẫu!`
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
      // B0. PUBLIC TODAY'S ACTIVE USERS API (`GET /api/public/active-users`)
      //     Trả về danh sách toàn bộ nhân sự thực tế đang làm việc từ đầu ngày đến hiện tại
      //     để Frontend đặt nhân sự ngồi sẵn vào bàn ngay khi mở trang, KHÔNG bị dồn event gây giật lag!
      // ----------------------------------------------------------------------
      if (pathname === '/api/public/active-users' && method === 'GET') {
        if (!checkPublicRateLimit(req)) {
          sendJson(res, 429, {
            ok: false,
            error: 'Rate limit exceeded. Please poll at the configured interval.',
          });
          return;
        }

        // Đồng bộ luồng upstream nếu cần để danh sách user trong ngày luôn mới nhất
        await executeUpstreamPollCycle('public-active-users');

        const activeUsers = getActiveUsersTodaySnapshot();
        const workingUsersCount = activeUsers.filter((u) => u.isWorking).length;
        const compactJenkinsSnapshot = jenkinsSnapshot.slice(0, 5).map((b) => ({
          id: b.id,
          fingerprint: b.fingerprint,
          buildNumber: b.buildNumber,
          jobName: b.jobName,
          clusterId: b.clusterId || 'CI',
          status: b.status,
          statusText: b.statusText,
          triggeredByAccount: b.triggeredByAccount,
          ticketKey: b.ticketKey,
          timeAgo: b.timeAgo,
        }));

        sendJson(res, 200, {
          ok: true,
          dayKey: activeUsersDayKey,
          latestSeq: currentSeq,
          totalActiveUsers: activeUsers.length,
          workingUsersCount,
          users: activeUsers,
          jenkinsSnapshot: compactJenkinsSnapshot,
        });
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
        const rawLimit = parsedUrl.searchParams.get('limit');
        const maxEvents =
          rawLimit !== null && rawLimit !== '' && !Number.isNaN(Number(rawLimit))
            ? Math.max(1, Math.min(10, Math.floor(Number(rawLimit))))
            : 2;

        // Run a coalesced poll cycle so the server's RAM Cache Deduplicator processes the latest feed
        const pollOutcome = await executeUpstreamPollCycle('public-stream-poll');

        // Filter events strictly by Monotonic Cursor `seq > afterSeq`
        // QUAN TRỌNG: Danh sách nhân sự làm việc trong ngày đã được cấp qua `activeUsers` (ngồi sẵn tại bàn),
        // nên luồng `events` chỉ trả tối đa 1-2 sự kiện mới nhất để diễn hoạt đi bộ mượt mà 60fps, KHÔNG dồn cục gây lag!
        let rawEvents = [];
        if (afterSeq > 0) {
          // Client already has a cursor: ONLY return events strictly newer than `afterSeq` (capped at maxEvents = 2)
          rawEvents = eventRingBuffer.filter((ev) => ev.seq > afterSeq).slice(-maxEvents);
        } else {
          // First-time client connection (`afterSeq == 0`):
          // Chỉ phát tối đa 1 sự kiện gần nhất làm hiệu ứng di chuyển, toàn bộ user khác được nạp tĩnh qua `activeUsers`!
          rawEvents = eventRingBuffer.slice(-1);
        }

        // Chỉ trả về các trường thông tin thực sự cần thiết cho Game 2D
        const eventsToReturn = rawEvents.map((ev) =>
          ev.kind === 'JIRA_ACTIVITY'
            ? {
                seq: ev.seq,
                fingerprint: ev.fingerprint,
                kind: 'JIRA_ACTIVITY',
                ticketKey: ev.ticketKey,
                fromAccount: ev.fromAccount,
                toAccount: ev.toAccount,
                fromEmployeeId: ev.fromEmployeeId,
                toEmployeeId: ev.toEmployeeId,
                toStatus: ev.toStatus,
                isReturnToPM: ev.isReturnToPM,
                summary: ev.summary,
                updatedAt: ev.updatedAt,
              }
            : {
                seq: ev.seq,
                fingerprint: ev.fingerprint,
                kind: 'JENKINS_BUILD',
                jobName: ev.jobName,
                clusterId: ev.clusterId || 'CI',
                buildNumber: ev.buildNumber,
                status: ev.status,
                statusText: ev.statusText,
                triggeredByAccount: ev.triggeredByAccount,
                employeeId: ev.employeeId,
                ticketKey: ev.ticketKey,
                timeAgo: ev.timeAgo,
                publishedAt: ev.publishedAt,
              }
        );

        const newBuildEvents = eventsToReturn.filter((ev) => ev.kind === 'JENKINS_BUILD');
        const compactJenkinsSnapshot = jenkinsSnapshot.slice(0, 5).map((b) => ({
          id: b.id,
          fingerprint: b.fingerprint,
          buildNumber: b.buildNumber,
          jobName: b.jobName,
          clusterId: b.clusterId || 'CI',
          status: b.status,
          statusText: b.statusText,
          triggeredByAccount: b.triggeredByAccount,
          ticketKey: b.ticketKey,
          timeAgo: b.timeAgo,
        }));
        const activeUsers = getActiveUsersTodaySnapshot();
        const statsSnapshot = getPublicDedupStatsSnapshot();

        sendJson(res, 200, {
          ok: true,
          afterSeq,
          latestSeq: currentSeq,
          eventsCount: eventsToReturn.length,
          events: eventsToReturn,
          newBuildEvents,
          activeUsers,
          jenkinsSnapshot: compactJenkinsSnapshot,
          dedupStats: statsSnapshot,
          pollSummary: {
            sourceUsed: pollOutcome.sourceUsed,
            newEventsInPoll:
              pollOutcome.newJiraEventsCount + pollOutcome.newJenkinsEventsCount,
            droppedInPoll: pollOutcome.droppedInThisBatch,
            message:
              eventsToReturn.length > 0
                ? `🟢 Đồng bộ ${eventsToReturn.length} sự kiện mới • ${activeUsers.length} nhân sự trong ngày (seq ${afterSeq} ➔ ${currentSeq})`
                : `🛡️ 0 sự kiện mới (${activeUsers.length} nhân sự trong ngày • seq=${currentSeq})`,
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
