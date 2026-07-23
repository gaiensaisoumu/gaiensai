/* eslint-disable no-console */

import '@supabase/functions-js/edge-runtime.d.ts';

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { compare, hash } from 'bcryptjs';

import { getCorsHeaders } from '@shared/cors.ts';
import { getEnv } from '@shared/getEnv.ts';
import HttpError from '@shared/HttpError.ts';

const ADMIN_CONTROL_PANEL_SESSION_DURATION_MS = 1000 * 60 * 60 * 8;
const ADMIN_AUTH_MAX_FAILED_ATTEMPTS = 5;
const ADMIN_AUTH_LOCK_DURATION_MS = 1000 * 60 * 10; // 10分

type AdminAuthRequest = {
  action?: unknown;
  password?: unknown;
  currentPassword?: unknown;
  newPassword?: unknown;
  eventYear?: unknown;
  showLength?: unknown;
  maxTicketsPerUser?: unknown;
  maxTicketsPerJuniorUser?: unknown;
  juniorReleaseOpen?: unknown;
  ticketIssuingEnabled?: unknown;
  activeTicketTypeIds?: unknown;
  ticketIssueModes?: unknown;
  defaultClassTotalCapacity?: unknown;
  defaultClassJuniorCapacity?: unknown;
  defaultGymCapacity?: unknown;
  table?: unknown;
  recordId?: unknown;
  column?: unknown;
  value?: unknown;
  name?: unknown;
  teachers?: unknown;
  users?: unknown;
  studentId?: unknown;
  accountType?: unknown;
  juniorPassword?: unknown;
  secretCode?: unknown;
  maxAdmissionOnlyJuniorAccounts?: unknown;
};

type TicketIssueMode =
  'open' | 'only-own' | 'public-rehearsals' | 'auto' | 'off';

type TicketIssueModes = {
  classInvite: TicketIssueMode;
  rehearsalInvite: TicketIssueMode;
  gymInvite: TicketIssueMode;
  entryOnly: TicketIssueMode;
  sameDayClass: TicketIssueMode;
  sameDayGym: TicketIssueMode;
  juniorClass: TicketIssueMode;
  juniorGym: TicketIssueMode;
  juniorEntryOnly: TicketIssueMode;
};

type AdminAuthBody =
  | { mode: 'login'; password: string }
  | { mode: 'verifySession' }
  | { mode: 'logoutSession' }
  | { mode: 'changePassword'; currentPassword: string; newPassword: string }
  | { mode: 'getSettings' }
  | { mode: 'getTeachers' }
  | { mode: 'updateTeacher'; teacherId: number; name: string }
  | { mode: 'updateAllTeachers'; teachers: { id: number; name: string }[] }
  | { mode: 'deleteAllStudentAccounts' }
  | { mode: 'deleteAccountsByType'; accountType: 'student' | 'junior' }
  | { mode: 'deleteAllTicketsAndResetCounters' }
  | { mode: 'getStudentUsers' }
  | {
      mode: 'resetUserPassword';
      studentId: string;
      newPassword: string;
    }
  | {
      mode: 'bulkCreateUsers';
      users: { id: string; password: string }[];
    }
  | {
      mode: 'updateTicketTypeSettings';
      activeTicketTypeIds: number[];
      ticketIssueModes: TicketIssueModes;
    }
  | {
      mode: 'updateSettings';
      eventYear: number;
      showLength: number;
      maxTicketsPerUser: number;
      maxTicketsPerJuniorUser: number;
      maxAdmissionOnlyJuniorAccounts: number;
      juniorReleaseOpen: boolean;
      ticketIssuingEnabled: boolean;
      defaultClassTotalCapacity: number;
      defaultClassJuniorCapacity: number;
      defaultGymCapacity: number;
    }
  | {
      mode: 'updateAcceptingStatus';
      table: string;
      recordId: number;
      column: string;
      value: boolean | number;
    }
  | { mode: 'getJuniorPassword' }
  | { mode: 'updateJuniorPassword'; juniorPassword: string }
  | { mode: 'validateJuniorSecretCode'; secretCode: string };

type AdminConfigRow = {
  id: number;
  admin_password: string;
};

type AdminSettingsRow = {
  id: number;
  event_year: number;
  show_length: number;
  max_tickets_per_user: number;
  max_tickets_per_junior_user: number;
  max_admission_only_junior_accounts: number;
  junior_release_open: boolean;
  is_active: boolean;
};

type AdminSessionRow = {
  id: string;
  expires_at: string;
};

type AdminRateLimitRow = {
  ip_address: string;
  failed_attempts: number;
  locked_until: string | null;
};

type TicketIssueControlsRow = {
  class_invite_mode: TicketIssueMode;
  rehearsal_invite_mode: TicketIssueMode;
  gym_invite_mode: TicketIssueMode;
  entry_only_mode: TicketIssueMode;
  same_day_class_mode: TicketIssueMode;
  same_day_gym_mode: TicketIssueMode;
  junior_class_mode: TicketIssueMode;
  junior_gym_mode: TicketIssueMode;
  junior_entry_only_mode: TicketIssueMode;
};

const ADMIN_SESSION_TOKEN_HEADER = 'x-admin-session-token';
const MAX_SESSION_TOKEN_LENGTH = 512;
const MAX_IP_ADDRESS_LENGTH = 128;
const MANAGED_TICKET_TYPE_IDS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;
const TICKET_ISSUE_MODE_VALUES = [
  'open',
  'only-own',
  'public-rehearsals',
  'auto',
  'off',
] as const;
const DEFAULT_TICKET_ISSUE_MODES: TicketIssueModes = {
  classInvite: 'open',
  rehearsalInvite: 'open',
  gymInvite: 'open',
  entryOnly: 'open',
  sameDayClass: 'open',
  sameDayGym: 'open',
  juniorClass: 'open',
  juniorGym: 'open',
  juniorEntryOnly: 'open',
};

const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

const hashToken = async (token: string): Promise<string> => {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(token),
  );
  return toHex(new Uint8Array(digest));
};

const createRawToken = (): string => {
  const random = new Uint8Array(32);
  crypto.getRandomValues(random);
  return `adm_${toHex(random)}`;
};

const readSessionToken = (req: Request): string | null => {
  const token = req.headers.get(ADMIN_SESSION_TOKEN_HEADER)?.trim() ?? '';
  if (!token) {
    return null;
  }

  if (token.length > MAX_SESSION_TOKEN_LENGTH) {
    throw new HttpError(400, 'セッショントークンが長すぎます。');
  }

  return token;
};

const getClientIp = (req: Request): string => {
  const fromForwardedFor = req.headers
    .get('x-forwarded-for')
    ?.split(',')[0]
    ?.trim();
  const fromRealIp = req.headers.get('x-real-ip')?.trim();
  const fromCf = req.headers.get('cf-connecting-ip')?.trim();
  const candidate = fromForwardedFor || fromRealIp || fromCf || 'unknown';

  if (candidate.length > MAX_IP_ADDRESS_LENGTH) {
    return candidate.slice(0, MAX_IP_ADDRESS_LENGTH);
  }

  return candidate;
};

const normalizePassword = (value: unknown, fieldName: string): string => {
  if (typeof value !== 'string') {
    throw new HttpError(400, `${fieldName} は文字列で送信してください。`);
  }

  const trimmedPassword = value.trim();
  if (trimmedPassword.length === 0) {
    throw new HttpError(400, `${fieldName} を入力してください。`);
  }

  if (trimmedPassword.length > 256) {
    throw new HttpError(400, `${fieldName} が長すぎます。`);
  }

  return trimmedPassword;
};

const normalizeInteger = (
  value: unknown,
  fieldName: string,
  min: number,
  max: number,
) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new HttpError(400, `${fieldName} は数値で送信してください。`);
  }

  if (!Number.isInteger(value)) {
    throw new HttpError(400, `${fieldName} は整数で送信してください。`);
  }

  if (value < min || value > max) {
    throw new HttpError(
      400,
      `${fieldName} は${min}〜${max}の範囲で指定してください。`,
    );
  }

  return value;
};

const isTicketIssueMode = (value: unknown): value is TicketIssueMode =>
  typeof value === 'string' &&
  (TICKET_ISSUE_MODE_VALUES as readonly string[]).includes(value);

const normalizeTicketIssueModes = (value: unknown): TicketIssueModes => {
  if (!value || typeof value !== 'object') {
    throw new HttpError(
      400,
      'ticketIssueModes はオブジェクトで送信してください。',
    );
  }

  const raw = value as Record<string, unknown>;
  if (
    !isTicketIssueMode(raw.classInvite) ||
    !isTicketIssueMode(raw.rehearsalInvite) ||
    !isTicketIssueMode(raw.gymInvite) ||
    !isTicketIssueMode(raw.entryOnly) ||
    !isTicketIssueMode(raw.sameDayClass) ||
    !isTicketIssueMode(raw.sameDayGym) ||
    !isTicketIssueMode(raw.juniorClass) ||
    !isTicketIssueMode(raw.juniorGym) ||
    !isTicketIssueMode(raw.juniorEntryOnly)
  ) {
    throw new HttpError(400, 'ticketIssueModes の値が不正です。');
  }

  return {
    classInvite: raw.classInvite,
    rehearsalInvite: raw.rehearsalInvite,
    gymInvite: raw.gymInvite,
    entryOnly: raw.entryOnly,
    sameDayClass: raw.sameDayClass,
    sameDayGym: raw.sameDayGym,
    juniorClass: raw.juniorClass,
    juniorGym: raw.juniorGym,
    juniorEntryOnly: raw.juniorEntryOnly,
  };
};

const parseBody = (body: unknown): AdminAuthBody => {
  if (!body || typeof body !== 'object') {
    throw new HttpError(400, 'リクエストボディが不正です。');
  }

  const { action, password, currentPassword, newPassword } =
    body as AdminAuthRequest;

  if (action === 'verify') {
    return { mode: 'verifySession' };
  }

  if (action === 'logout') {
    return { mode: 'logoutSession' };
  }

  if (action === 'getTeachers') {
    return { mode: 'getTeachers' };
  }

  if (action === 'changePassword') {
    const normalizedCurrentPassword = normalizePassword(
      currentPassword,
      'currentPassword',
    );
    const normalizedNewPassword = normalizePassword(newPassword, 'newPassword');

    if (normalizedNewPassword.length < 8) {
      throw new HttpError(400, 'newPassword は8文字以上で設定してください。');
    }

    return {
      mode: 'changePassword',
      currentPassword: normalizedCurrentPassword,
      newPassword: normalizedNewPassword,
    };
  }

  if (action === 'deleteAllStudentAccounts') {
    return { mode: 'deleteAllStudentAccounts' };
  }

  if (action === 'deleteAccountsByType') {
    const { accountType } = body as AdminAuthRequest;
    if (accountType !== 'student' && accountType !== 'junior') {
      throw new HttpError(
        400,
        'accountType は student または junior を指定してください。',
      );
    }
    return { mode: 'deleteAccountsByType', accountType };
  }

  if (action === 'deleteAllTicketsAndResetCounters') {
    return { mode: 'deleteAllTicketsAndResetCounters' };
  }

  if (action === 'getStudentUsers') {
    return { mode: 'getStudentUsers' };
  }

  if (action === 'resetUserPassword') {
    const { studentId, newPassword } = body as AdminAuthRequest;
    if (!studentId) {
      throw new HttpError(400, 'studentId を指定してください。');
    }
    return {
      mode: 'resetUserPassword',
      studentId: String(studentId),
      newPassword: normalizePassword(newPassword, 'newPassword'),
    };
  }

  if (action === 'updateTeacher') {
    const { recordId, name } = body as AdminAuthRequest;
    return {
      mode: 'updateTeacher',
      teacherId: normalizeInteger(recordId, 'recordId', 1, 1000000),
      name: normalizePassword(name, 'name'),
    };
  }

  if (action === 'updateAllTeachers') {
    const { teachers } = body as AdminAuthRequest;
    if (!Array.isArray(teachers)) {
      throw new HttpError(400, 'teachers は配列で送信してください。');
    }
    return {
      mode: 'updateAllTeachers',
      teachers: (teachers as Record<string, unknown>[]).map((t) => ({
        id: normalizeInteger(t.id, 'id', 1, 1000000),
        name: normalizePassword(t.name, 'name'),
      })),
    };
  }

  if (action === 'bulkCreateUsers') {
    const { users } = body as AdminAuthRequest;
    if (!Array.isArray(users)) {
      throw new HttpError(400, 'users は配列で送信してください。');
    }
    const validatedUsers: { id: string; password: string }[] = users.map(
      (u: Record<string, unknown>) => ({
        id: String(u.id ?? ''),
        password: String(u.password ?? ''),
      }),
    );
    return { mode: 'bulkCreateUsers', users: validatedUsers };
  }

  if (action === 'updateAcceptingStatus') {
    const { table, recordId, column, value } = body as AdminAuthRequest;
    if (typeof table !== 'string') {
      throw new HttpError(400, 'table は文字列で送信してください。');
    }
    if (typeof column !== 'string') {
      throw new HttpError(400, 'column は文字列で送信してください。');
    }
    if (typeof value !== 'boolean' && typeof value !== 'number') {
      throw new HttpError(400, 'value は真偽値または数値で送信してください。');
    }

    // バリデーション: 許可されたテーブルとカラムのみ
    const allowedUpdates: Record<string, string[]> = {
      class_performances: ['is_accepting', 'total_capacity', 'junior_capacity'],
      gym_performances: ['is_accepting', 'capacity'],
      performances_schedule: ['is_active'],
      relationships: ['is_accepting'],
    };

    if (!allowedUpdates[table] || !allowedUpdates[table].includes(column)) {
      throw new HttpError(
        400,
        '不正なテーブルまたはカラムの更新リクエストです。',
      );
    }

    return {
      mode: 'updateAcceptingStatus',
      table,
      recordId: normalizeInteger(recordId, 'recordId', 1, 1000000),
      column,
      value,
    };
  }

  if (action === 'getSettings') {
    return { mode: 'getSettings' };
  }

  if (action === 'updateSettings') {
    const {
      eventYear,
      showLength,
      maxTicketsPerUser,
      maxTicketsPerJuniorUser,
      juniorReleaseOpen,
      ticketIssuingEnabled,
      defaultClassTotalCapacity,
      defaultClassJuniorCapacity,
      defaultGymCapacity,
      maxAdmissionOnlyJuniorAccounts,
    } = body as AdminAuthRequest;

    const total = normalizeInteger(
      defaultClassTotalCapacity,
      'defaultClassTotalCapacity',
      1,
      1000,
    );
    const junior = normalizeInteger(
      defaultClassJuniorCapacity,
      'defaultClassJuniorCapacity',
      0,
      1000,
    );

    if (junior > total) {
      throw new HttpError(400, '中学生枠は合計定員以下で指定してください。');
    }

    if (typeof juniorReleaseOpen !== 'boolean') {
      throw new HttpError(
        400,
        'juniorReleaseOpen は真偽値で送信してください。',
      );
    }
    if (typeof ticketIssuingEnabled !== 'boolean') {
      throw new HttpError(
        400,
        'ticketIssuingEnabled は真偽値で送信してください。',
      );
    }

    return {
      mode: 'updateSettings',
      eventYear: normalizeInteger(eventYear, 'eventYear', 2020, 2100),
      showLength: normalizeInteger(showLength, 'showLength', 1, 300),
      maxTicketsPerUser: normalizeInteger(
        maxTicketsPerUser,
        'maxTicketsPerUser',
        1,
        100,
      ),
      maxTicketsPerJuniorUser: normalizeInteger(
        maxTicketsPerJuniorUser,
        'maxTicketsPerJuniorUser',
        1,
        100,
      ),
      juniorReleaseOpen,
      ticketIssuingEnabled,
      defaultClassTotalCapacity: total,
      defaultClassJuniorCapacity: junior,
      defaultGymCapacity: normalizeInteger(
        defaultGymCapacity,
        'defaultGymCapacity',
        1,
        2000,
      ),
      maxAdmissionOnlyJuniorAccounts: normalizeInteger(
        maxAdmissionOnlyJuniorAccounts,
        'maxAdmissionOnlyJuniorAccounts',
        0,
        100,
      ),
    };
  }

  if (action === 'updateTicketTypeSettings') {
    const { activeTicketTypeIds, ticketIssueModes } = body as AdminAuthRequest;
    if (!Array.isArray(activeTicketTypeIds)) {
      throw new HttpError(
        400,
        'activeTicketTypeIds は数値配列で送信してください。',
      );
    }

    const normalizedIds = Array.from(
      new Set(
        activeTicketTypeIds.map((value) =>
          normalizeInteger(value, 'activeTicketTypeIds', 1, 1000),
        ),
      ),
    );

    for (const id of normalizedIds) {
      if (
        !MANAGED_TICKET_TYPE_IDS.includes(
          id as (typeof MANAGED_TICKET_TYPE_IDS)[number],
        )
      ) {
        throw new HttpError(400, `管理対象外の券種IDです: ${id}`);
      }
    }

    return {
      mode: 'updateTicketTypeSettings',
      activeTicketTypeIds: normalizedIds,
      ticketIssueModes: normalizeTicketIssueModes(ticketIssueModes),
    };
  }

  if (action === 'login' || typeof action === 'undefined') {
    const isLegacyChangePasswordRequest =
      typeof currentPassword !== 'undefined' ||
      typeof newPassword !== 'undefined';
    if (isLegacyChangePasswordRequest) {
      const normalizedCurrentPassword = normalizePassword(
        currentPassword,
        'currentPassword',
      );
      const normalizedNewPassword = normalizePassword(
        newPassword,
        'newPassword',
      );

      if (normalizedNewPassword.length < 8) {
        throw new HttpError(400, 'newPassword は8文字以上で設定してください。');
      }

      return {
        mode: 'changePassword',
        currentPassword: normalizedCurrentPassword,
        newPassword: normalizedNewPassword,
      };
    }

    return {
      mode: 'login',
      password: normalizePassword(password, 'password'),
    };
  }

  if (action === 'updateJuniorPassword') {
    const { juniorPassword } = body as AdminAuthRequest;
    return {
      mode: 'updateJuniorPassword',
      juniorPassword: String(juniorPassword ?? ''),
    };
  }

  if (action === 'getJuniorPassword') {
    return { mode: 'getJuniorPassword' };
  }

  if (action === 'validateJuniorSecretCode') {
    const { secretCode } = body as AdminAuthRequest;
    return {
      mode: 'validateJuniorSecretCode',
      secretCode: String(secretCode ?? ''),
    };
  }

  throw new HttpError(400, 'action が不正です。');
};

const fetchAdminConfig = async (adminClient: SupabaseClient) => {
  const { data, error } = await adminClient
    .from('configs')
    .select('id, admin_password')
    .limit(1);

  if (error) {
    throw error;
  }

  const config = data?.[0] as AdminConfigRow | undefined;
  if (!config || typeof config.id !== 'number') {
    throw new HttpError(500, 'configs.id が取得できませんでした。');
  }

  if (
    typeof config.admin_password !== 'string' ||
    config.admin_password.length === 0
  ) {
    throw new HttpError(500, '管理者パスワードが設定されていません。');
  }

  if (!isBcryptHash(config.admin_password)) {
    throw new HttpError(
      500,
      'configs.admin_password が bcrypt ハッシュ形式ではありません。',
    );
  }

  return {
    id: config.id,
    passwordHash: config.admin_password,
  };
};

const fetchAdminSettings = async (adminClient: SupabaseClient) => {
  const { data, error } = await adminClient
    .from('configs')
    .select(
      'id, event_year, show_length, max_tickets_per_user, max_tickets_per_junior_user, max_admission_only_junior_accounts, junior_release_open, is_active',
    )
    .limit(1);

  if (error) {
    throw error;
  }

  const row = data?.[0] as AdminSettingsRow | undefined;
  if (!row || typeof row.id !== 'number') {
    throw new HttpError(500, 'configs が取得できませんでした。');
  }

  return row;
};

const fetchTicketIssueControls = async (
  adminClient: SupabaseClient,
): Promise<TicketIssueModes> => {
  const { data, error } = await adminClient
    .from('ticket_issue_controls')
    .select(
      'class_invite_mode, rehearsal_invite_mode, gym_invite_mode, entry_only_mode, same_day_class_mode, same_day_gym_mode, junior_class_mode, junior_gym_mode, junior_entry_only_mode',
    )
    .eq('id', 1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  const row = data as TicketIssueControlsRow | null;
  if (!row) {
    return DEFAULT_TICKET_ISSUE_MODES;
  }

  return {
    classInvite: row.class_invite_mode,
    rehearsalInvite: row.rehearsal_invite_mode,
    gymInvite: row.gym_invite_mode,
    entryOnly: row.entry_only_mode,
    sameDayClass: row.same_day_class_mode,
    sameDayGym: row.same_day_gym_mode,
    juniorClass: row.junior_class_mode,
    juniorGym: row.junior_gym_mode,
    juniorEntryOnly: row.junior_entry_only_mode,
  };
};

const fetchMaxCapacities = async (adminClient: SupabaseClient) => {
  const { data: classData, error: classError } = await adminClient
    .from('class_performances')
    .select('total_capacity, junior_capacity');

  if (classError) {
    throw classError;
  }

  const { data: gymData, error: gymError } = await adminClient
    .from('gym_performances')
    .select('capacity');

  if (gymError) {
    throw gymError;
  }

  const maxClassTotal =
    classData && classData.length > 0
      ? Math.max(...classData.map((row) => row.total_capacity ?? 0))
      : null;
  const maxClassJunior =
    classData && classData.length > 0
      ? Math.max(...classData.map((row) => row.junior_capacity ?? 0))
      : null;
  const maxGym =
    gymData && gymData.length > 0
      ? Math.max(...gymData.map((row) => row.capacity ?? 0))
      : null;

  return { maxClassTotal, maxClassJunior, maxGym };
};

const isBcryptHash = (value: string) => /^\$2[aby]\$\d{2}\$.{53}$/.test(value);

const getRateLimitRow = async (
  adminClient: SupabaseClient,
  ipAddress: string,
): Promise<AdminRateLimitRow | null> => {
  const { data, error } = await adminClient
    .from('admin_auth_rate_limits')
    .select('ip_address, failed_attempts, locked_until')
    .eq('ip_address', ipAddress)
    .limit(1);

  if (error) {
    throw error;
  }

  const row = data?.[0] as AdminRateLimitRow | undefined;
  return row ?? null;
};

const getRemainingLockSeconds = (lockedUntil: string): number => {
  const remainingMs = new Date(lockedUntil).getTime() - Date.now();
  return Math.max(1, Math.ceil(remainingMs / 1000));
};

const ensureIpIsNotLocked = (rateLimitRow: AdminRateLimitRow | null) => {
  if (!rateLimitRow?.locked_until) {
    return;
  }

  const lockExpiresAtMs = new Date(rateLimitRow.locked_until).getTime();
  if (Number.isNaN(lockExpiresAtMs) || lockExpiresAtMs <= Date.now()) {
    return;
  }

  const retryAfterSeconds = getRemainingLockSeconds(rateLimitRow.locked_until);
  throw new HttpError(
    429,
    `試行回数が上限に達しました。${retryAfterSeconds}秒後に再試行してください。`,
  );
};

const registerFailedAttempt = async (
  adminClient: SupabaseClient,
  ipAddress: string,
  rateLimitRow: AdminRateLimitRow | null,
) => {
  const now = new Date();
  const lockStillActive =
    typeof rateLimitRow?.locked_until === 'string' &&
    new Date(rateLimitRow.locked_until).getTime() > now.getTime();

  const baseFailedAttempts = lockStillActive
    ? 0
    : (rateLimitRow?.failed_attempts ?? 0);
  const nextFailedAttempts = baseFailedAttempts + 1;
  const shouldLock = nextFailedAttempts >= ADMIN_AUTH_MAX_FAILED_ATTEMPTS;
  const lockedUntil = shouldLock
    ? new Date(now.getTime() + ADMIN_AUTH_LOCK_DURATION_MS).toISOString()
    : null;

  const { error } = await adminClient.from('admin_auth_rate_limits').upsert(
    {
      ip_address: ipAddress,
      failed_attempts: shouldLock ? 0 : nextFailedAttempts,
      last_failed_at: now.toISOString(),
      locked_until: lockedUntil,
    },
    { onConflict: 'ip_address' },
  );

  if (error) {
    throw error;
  }

  return {
    shouldLock,
    lockedUntil,
    remainingAttempts: shouldLock
      ? 0
      : ADMIN_AUTH_MAX_FAILED_ATTEMPTS - nextFailedAttempts,
  };
};

const clearFailedLoginAttempts = async (
  adminClient: SupabaseClient,
  ipAddress: string,
) => {
  const { error } = await adminClient
    .from('admin_auth_rate_limits')
    .delete()
    .eq('ip_address', ipAddress);

  if (error) {
    throw error;
  }
};

const createSession = async (adminClient: SupabaseClient) => {
  const token = createRawToken();
  const tokenHash = await hashToken(token);
  const expiresAt = new Date(
    Date.now() + ADMIN_CONTROL_PANEL_SESSION_DURATION_MS,
  ).toISOString();

  const { error } = await adminClient.from('admin_sessions').insert({
    token_hash: tokenHash,
    expires_at: expiresAt,
  });

  if (error) {
    throw error;
  }

  return {
    token,
    expiresAt,
  };
};

const findActiveSession = async (
  adminClient: SupabaseClient,
  token: string,
): Promise<(AdminSessionRow & { tokenHash: string }) | null> => {
  const tokenHash = await hashToken(token);
  const nowIso = new Date().toISOString();

  const { data, error } = await adminClient
    .from('admin_sessions')
    .select('id, expires_at')
    .eq('token_hash', tokenHash)
    .is('revoked_at', null)
    .gt('expires_at', nowIso)
    .limit(1);

  if (error) {
    throw error;
  }

  const session = data?.[0] as AdminSessionRow | undefined;
  if (!session) {
    return null;
  }

  return { ...session, tokenHash };
};

const requireValidSession = async (
  adminClient: SupabaseClient,
  req: Request,
) => {
  const sessionToken = readSessionToken(req);
  if (!sessionToken) {
    throw new HttpError(401, 'セッションが無効です。再ログインしてください。');
  }

  const session = await findActiveSession(adminClient, sessionToken);
  if (!session) {
    throw new HttpError(401, 'セッションが無効です。再ログインしてください。');
  }

  return session;
};

Deno.serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({
        error: 'Method not allowed',
      }),
      {
        status: 405,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      },
    );
  }

  try {
    const body = parseBody(await req.json());

    const supabaseUrl = getEnv('SUPABASE_URL');
    const secretKey = getEnv('FOR_ADMIN_SUPABASE_SECRET_KEY');

    const adminClient = createClient(supabaseUrl, secretKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    });

    if (body.mode === 'verifySession') {
      const token = readSessionToken(req);
      if (!token) {
        return new Response(
          JSON.stringify({
            authenticated: false,
          }),
          {
            status: 200,
            headers: {
              ...corsHeaders,
              'Content-Type': 'application/json',
            },
          },
        );
      }

      const session = await findActiveSession(adminClient, token);
      if (!session) {
        return new Response(
          JSON.stringify({
            authenticated: false,
          }),
          {
            status: 200,
            headers: {
              ...corsHeaders,
              'Content-Type': 'application/json',
            },
          },
        );
      }

      await adminClient
        .from('admin_sessions')
        .update({ last_used_at: new Date().toISOString() })
        .eq('id', session.id);

      return new Response(
        JSON.stringify({
          authenticated: true,
          expiresAt: session.expires_at,
        }),
        {
          status: 200,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
          },
        },
      );
    }

    if (body.mode === 'logoutSession') {
      const token = readSessionToken(req);
      if (token) {
        const tokenHash = await hashToken(token);
        await adminClient
          .from('admin_sessions')
          .update({ revoked_at: new Date().toISOString() })
          .eq('token_hash', tokenHash);
      }

      return new Response(
        JSON.stringify({
          loggedOut: true,
        }),
        {
          status: 200,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
          },
        },
      );
    }

    if (body.mode === 'getTeachers') {
      const session = await requireValidSession(adminClient, req);
      const { data, error } = await adminClient
        .from('teachers')
        .select('id, grade, class_id, name')
        .order('grade', { ascending: true })
        .order('class_id', { ascending: true });

      if (error) {
        throw error;
      }

      await adminClient
        .from('admin_sessions')
        .update({ last_used_at: new Date().toISOString() })
        .eq('id', session.id);

      return new Response(JSON.stringify({ teachers: data }), {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      });
    }

    if (body.mode === 'updateTeacher') {
      const session = await requireValidSession(adminClient, req);
      const { error } = await adminClient
        .from('teachers')
        .update({ name: body.name })
        .eq('id', body.teacherId);

      if (error) {
        throw error;
      }

      await adminClient
        .from('admin_sessions')
        .update({ last_used_at: new Date().toISOString() })
        .eq('id', session.id);

      return new Response(JSON.stringify({ updated: true }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (body.mode === 'updateAllTeachers') {
      const session = await requireValidSession(adminClient, req);

      for (const t of body.teachers) {
        const { error } = await adminClient
          .from('teachers')
          .update({ name: t.name })
          .eq('id', t.id);

        if (error) {
          throw error;
        }
      }

      await adminClient
        .from('admin_sessions')
        .update({ last_used_at: new Date().toISOString() })
        .eq('id', session.id);

      return new Response(JSON.stringify({ updated: true }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (
      body.mode === 'deleteAllStudentAccounts' ||
      body.mode === 'deleteAccountsByType'
    ) {
      const session = await requireValidSession(adminClient, req);

      const resolveAccountType = (
        email?: string | null,
      ): 'student' | 'junior' | null => {
        if (!email || !email.endsWith('@gaiensai.local')) {
          return null;
        }

        const localPart = email.split('@')[0] ?? '';
        const asNumber = Number(localPart);
        if (
          Number.isInteger(asNumber) &&
          asNumber >= 10000 &&
          asNumber <= 40000
        ) {
          return 'student';
        }
        return 'junior';
      };

      const targetType: 'student' | 'junior' =
        body.mode === 'deleteAccountsByType' ? body.accountType : 'student';

      // 生徒アカウントを最大1000件取得
      const {
        data: { users },
        error: listError,
      } = await adminClient.auth.admin.listUsers({
        perPage: 1000,
      });

      if (listError) {
        throw listError;
      }

      // accountType に応じた対象ユーザーのみ抽出
      const usersToDelete = users.filter(
        (u) => resolveAccountType(u.email) === targetType,
      );

      // CPU時間制限(soft limit)を回避するため、1回のリクエストでの処理数を制限し、バッチサイズを最適化
      // また、スプレッド構文による配列結合を避け、CPU負荷を軽減
      const MAX_PROCESS_PER_REQUEST = 200;
      const targets = usersToDelete.slice(0, MAX_PROCESS_PER_REQUEST);
      const BATCH_SIZE = 50;

      let deletedCount = 0;
      const errors: string[] = [];
      const deletedAuthIds: string[] = [];
      const deletedEmails: string[] = [];

      for (let i = 0; i < targets.length; i += BATCH_SIZE) {
        const batch = targets.slice(i, i + BATCH_SIZE);
        const results = await Promise.all(
          batch.map((u) => adminClient.auth.admin.deleteUser(u.id)),
        );

        for (const [index, res] of results.entries()) {
          if (res.error) {
            errors.push(res.error.message);
          } else {
            deletedCount++;
            const deletedUser = batch[index];
            deletedAuthIds.push(deletedUser.id);
            if (deletedUser.email) {
              deletedEmails.push(deletedUser.email);
            }
          }
        }
      }

      if (deletedAuthIds.length > 0 || deletedEmails.length > 0) {
        if (deletedAuthIds.length > 0) {
          const { error: deleteUsersByIdError } = await adminClient
            .from('users')
            .delete()
            .in('id', deletedAuthIds);
          if (deleteUsersByIdError) {
            errors.push(
              `public.users(id) delete failed: ${deleteUsersByIdError.message}`,
            );
          }
        }

        if (deletedEmails.length > 0) {
          const { error: deleteUsersByEmailError } = await adminClient
            .from('users')
            .delete()
            .in('email', deletedEmails);
          if (deleteUsersByEmailError) {
            errors.push(
              `public.users(email) delete failed: ${deleteUsersByEmailError.message}`,
            );
          }
        }
      }

      // 生徒アカウントを最大1000件取得
      const {
        data: { users: remainingUsers },
        error,
      } = await adminClient.auth.admin.listUsers({
        perPage: 1000,
      });

      if (error) {
        throw error;
      }

      // accountType に応じた対象ユーザーの残数
      const usersRemaining = remainingUsers.filter(
        (u) => resolveAccountType(u.email) === targetType,
      );

      const remaining = usersRemaining.length;

      await adminClient
        .from('admin_sessions')
        .update({ last_used_at: new Date().toISOString() })
        .eq('id', session.id);

      return new Response(
        JSON.stringify({
          deleted: true,
          accountType: targetType,
          count: deletedCount,
          remaining, // 残数があることをフロントに伝える
          errors: errors.length > 0 ? errors : undefined,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      );
    }

    if (body.mode === 'deleteAllTicketsAndResetCounters') {
      const session = await requireValidSession(adminClient, req);

      const { count: ticketCount, error: countError } = await adminClient
        .from('tickets')
        .select('id', { count: 'exact', head: true });

      if (countError) {
        throw countError;
      }

      const { error: deleteTicketsError } = await adminClient
        .from('tickets')
        .delete()
        .neq('id', '00000000-0000-0000-0000-000000000000');

      if (deleteTicketsError) {
        throw deleteTicketsError;
      }

      const { error: resetClassCountersError } = await adminClient
        .from('class_ticket_counters')
        .update({
          issued_general: 0,
          issued_junior: 0,
          issued_other: 0,
          updated_at: new Date().toISOString(),
        })
        .gte('issued_general', 0);

      if (resetClassCountersError) {
        throw resetClassCountersError;
      }

      const { error: resetGymCountersError } = await adminClient
        .from('gym_ticket_counters')
        .update({
          issued_count: 0,
          updated_at: new Date().toISOString(),
        })
        .gte('issued_count', 0);

      if (resetGymCountersError) {
        throw resetGymCountersError;
      }

      const { error: resetCodeCountersError } = await adminClient
        .from('ticket_code_counters')
        .update({
          last_value: 0,
          updated_at: new Date().toISOString(),
        })
        .gte('last_value', 0);

      if (resetCodeCountersError) {
        throw resetCodeCountersError;
      }

      await adminClient
        .from('admin_sessions')
        .update({ last_used_at: new Date().toISOString() })
        .eq('id', session.id);

      return new Response(
        JSON.stringify({
          deleted: true,
          deletedTicketCount: ticketCount ?? 0,
          countersReset: true,
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      );
    }

    if (body.mode === 'bulkCreateUsers') {
      const session = await requireValidSession(adminClient, req);

      const results = { created: 0, skipped: 0, errors: [] as string[] };
      const failedUsers: { id: string; password: string }[] = [];
      const skippedUsers: { id: string; password: string }[] = [];

      // バッチ内を並列実行して高速化
      const promises = body.users.map(
        async (user: { id: string; password: string }) => {
          const email = `${user.id}@gaiensai.local`;
          const { error } = await adminClient.auth.admin.createUser({
            email,
            password: user.password,
            email_confirm: true,
            user_metadata: { student_id: user.id },
          });

          if (error) {
            const normalizedErrorMessage = error.message.toLowerCase();
            if (
              normalizedErrorMessage.includes('already registered') ||
              normalizedErrorMessage.includes('already been registered')
            ) {
              return { type: 'skipped', user };
            }
            return {
              type: 'error',
              message: `${user.id}: ${error.message}`,
              user,
            };
          }
          return { type: 'created' };
        },
      );

      const rawResults = await Promise.all(promises);
      rawResults.forEach((res) => {
        if (res.type === 'created') {
          results.created++;
        } else if (res.type === 'skipped') {
          results.skipped++;
          skippedUsers.push(res.user!);
        } else if (res.type === 'error') {
          results.errors.push(res.message!);
          failedUsers.push(res.user!);
        }
      });

      await adminClient
        .from('admin_sessions')
        .update({ last_used_at: new Date().toISOString() })
        .eq('id', session.id);

      return new Response(
        JSON.stringify({ ...results, failedUsers, skippedUsers }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      );
    }

    if (body.mode === 'getStudentUsers') {
      const session = await requireValidSession(adminClient, req);

      // 生徒アカウントを最大1000件取得
      const {
        data: { users },
        error,
      } = await adminClient.auth.admin.listUsers({
        perPage: 1000,
      });

      if (error) {
        throw error;
      }

      // @gaiensai.local のドメインを持つユーザーのみを抽出
      const studentUsers = users
        .filter((u) => u.email?.endsWith('@gaiensai.local'))
        .map((u) => ({
          studentId: u.user_metadata?.student_id || u.email?.split('@')[0],
          email: u.email,
          lastSignIn: u.last_sign_in_at,
          createdAt: u.created_at,
        }))
        .sort((a, b) => a.studentId.localeCompare(b.studentId));

      await adminClient
        .from('admin_sessions')
        .update({ last_used_at: new Date().toISOString() })
        .eq('id', session.id);

      return new Response(JSON.stringify({ users: studentUsers }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (body.mode === 'resetUserPassword') {
      const session = await requireValidSession(adminClient, req);

      const email = `${body.studentId}@gaiensai.local`;

      // IDから対象ユーザーを検索 (Auth Admin APIを使用)
      // デフォルトは50件なので、perPageを指定して検索対象を広げる
      const {
        data: { users },
        error: listError,
      } = await adminClient.auth.admin.listUsers({
        perPage: 1000,
      });

      if (listError) {
        throw listError;
      }

      const authUser = users.find((u) => u.email === email);

      if (!authUser) {
        throw new HttpError(
          404,
          '対象の生徒アカウントが見つかりませんでした。',
        );
      }

      // パスワードを更新
      const { error: updateError } =
        await adminClient.auth.admin.updateUserById(authUser.id, {
          password: body.newPassword,
        });

      if (updateError) {
        throw updateError;
      }

      await adminClient
        .from('admin_sessions')
        .update({ last_used_at: new Date().toISOString() })
        .eq('id', session.id);

      return new Response(JSON.stringify({ updated: true }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (body.mode === 'getSettings') {
      const session = await requireValidSession(adminClient, req);
      const settings = await fetchAdminSettings(adminClient);
      const maxCapacities = await fetchMaxCapacities(adminClient);
      const ticketIssueModes = await fetchTicketIssueControls(adminClient);

      const activeTicketTypeIds: number[] = [];
      if (ticketIssueModes.classInvite !== 'off') {
        activeTicketTypeIds.push(1);
      }
      if (ticketIssueModes.rehearsalInvite !== 'off') {
        activeTicketTypeIds.push(2);
      }
      if (ticketIssueModes.gymInvite !== 'off') {
        activeTicketTypeIds.push(3);
      }
      if (ticketIssueModes.entryOnly !== 'off') {
        activeTicketTypeIds.push(4);
      }
      if (ticketIssueModes.sameDayClass !== 'off') {
        activeTicketTypeIds.push(8);
      }
      if (ticketIssueModes.sameDayGym !== 'off') {
        activeTicketTypeIds.push(9);
      }
      if (ticketIssueModes.juniorClass !== 'off') {
        activeTicketTypeIds.push(5);
      }
      if (ticketIssueModes.juniorGym !== 'off') {
        activeTicketTypeIds.push(6);
      }
      if (ticketIssueModes.juniorEntryOnly !== 'off') {
        activeTicketTypeIds.push(7);
      }

      await adminClient
        .from('admin_sessions')
        .update({ last_used_at: new Date().toISOString() })
        .eq('id', session.id);

      return new Response(
        JSON.stringify({
          settings: {
            eventYear: settings.event_year,
            showLength: settings.show_length,
            maxTicketsPerUser: settings.max_tickets_per_user,
            maxTicketsPerJuniorUser: settings.max_tickets_per_junior_user,
            maxAdmissionOnlyJuniorAccounts:
              settings.max_admission_only_junior_accounts,
            juniorReleaseOpen: settings.junior_release_open,
            ticketIssuingEnabled: settings.is_active,
            defaultClassTotalCapacity: maxCapacities.maxClassTotal ?? 0,
            defaultClassJuniorCapacity: maxCapacities.maxClassJunior ?? 0,
            defaultGymCapacity: maxCapacities.maxGym ?? 0,
            activeTicketTypeIds,
            ticketIssueModes,
          },
        }),
        {
          status: 200,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
          },
        },
      );
    }

    if (body.mode === 'updateSettings') {
      const session = await requireValidSession(adminClient, req);
      const currentSettings = await fetchAdminSettings(adminClient);

      const { error: updateError } = await adminClient
        .from('configs')
        .update({
          event_year: body.eventYear,
          show_length: body.showLength,
          max_tickets_per_user: body.maxTicketsPerUser,
          max_tickets_per_junior_user: body.maxTicketsPerJuniorUser,
          max_admission_only_junior_accounts:
            body.maxAdmissionOnlyJuniorAccounts,
          junior_release_open: body.juniorReleaseOpen,
          is_active: body.ticketIssuingEnabled,
        })
        .eq('id', currentSettings.id);

      if (updateError) {
        throw updateError;
      }

      // 全クラス公演のキャパシティを一括更新
      const { error: classUpdateError } = await adminClient
        .from('class_performances')
        .update({
          total_capacity: body.defaultClassTotalCapacity,
          junior_capacity: body.defaultClassJuniorCapacity,
        })
        .neq('id', 0);

      if (classUpdateError) {
        throw classUpdateError;
      }

      // 全体育館公演のキャパシティを一括更新
      const { error: gymUpdateError } = await adminClient
        .from('gym_performances')
        .update({
          capacity: body.defaultGymCapacity,
        })
        .neq('id', 0);

      if (gymUpdateError) {
        throw gymUpdateError;
      }

      await adminClient
        .from('admin_sessions')
        .update({ last_used_at: new Date().toISOString() })
        .eq('id', session.id);

      return new Response(
        JSON.stringify({
          updated: true,
          settings: {
            eventYear: body.eventYear,
            showLength: body.showLength,
            maxTicketsPerUser: body.maxTicketsPerUser,
            maxTicketsPerJuniorUser: body.maxTicketsPerJuniorUser,
            maxAdmissionOnlyJuniorAccounts:
              body.maxAdmissionOnlyJuniorAccounts,
            juniorReleaseOpen: body.juniorReleaseOpen,
            ticketIssuingEnabled: body.ticketIssuingEnabled,
            defaultClassTotalCapacity: body.defaultClassTotalCapacity,
            defaultClassJuniorCapacity: body.defaultClassJuniorCapacity,
            defaultGymCapacity: body.defaultGymCapacity,
          },
        }),
        {
          status: 200,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
          },
        },
      );
    }

    if (body.mode === 'updateTicketTypeSettings') {
      const session = await requireValidSession(adminClient, req);

      const { error: ticketIssueModeUpdateError } = await adminClient
        .from('ticket_issue_controls')
        .upsert(
          {
            id: 1,
            class_invite_mode: body.ticketIssueModes.classInvite,
            rehearsal_invite_mode: body.ticketIssueModes.rehearsalInvite,
            gym_invite_mode: body.ticketIssueModes.gymInvite,
            entry_only_mode: body.ticketIssueModes.entryOnly,
            same_day_class_mode: body.ticketIssueModes.sameDayClass,
            same_day_gym_mode: body.ticketIssueModes.sameDayGym,
            junior_class_mode: body.ticketIssueModes.juniorClass,
            junior_gym_mode: body.ticketIssueModes.juniorGym,
            junior_entry_only_mode: body.ticketIssueModes.juniorEntryOnly,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'id' },
        );

      if (ticketIssueModeUpdateError) {
        throw ticketIssueModeUpdateError;
      }

      await adminClient
        .from('admin_sessions')
        .update({ last_used_at: new Date().toISOString() })
        .eq('id', session.id);

      return new Response(
        JSON.stringify({
          updated: true,
          activeTicketTypeIds: body.activeTicketTypeIds,
          ticketIssueModes: body.ticketIssueModes,
        }),
        {
          status: 200,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
          },
        },
      );
    }

    if (body.mode === 'updateAcceptingStatus') {
      const session = await requireValidSession(adminClient, req);

      const { error: updateError } = await adminClient
        .from(body.table)
        .update({ [body.column]: body.value })
        .eq('id', body.recordId);

      if (updateError) {
        throw updateError;
      }

      await adminClient
        .from('admin_sessions')
        .update({ last_used_at: new Date().toISOString() })
        .eq('id', session.id);

      return new Response(JSON.stringify({ updated: true }), {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (body.mode === 'getJuniorPassword') {
      const session = await requireValidSession(adminClient, req);

      const { data: configData, error: configError } = await adminClient
        .from('configs')
        .select('junior_password')
        .single();

      if (configError) {
        throw new HttpError(500, '合言葉の取得に失敗しました。');
      }

      await adminClient
        .from('admin_sessions')
        .update({ last_used_at: new Date().toISOString() })
        .eq('id', session.id);

      return new Response(
        JSON.stringify({
          hasPassword:
            configData.junior_password !== null &&
            configData.junior_password !== '',
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        },
      );
    }

    if (body.mode === 'updateJuniorPassword') {
      const session = await requireValidSession(adminClient, req);

      // pgcryptoを使用してハッシュ化（RPC関数との互換性のため）
      const { data: hashData, error: hashError } = await adminClient.rpc(
        'hash_password',
        { p_password: body.juniorPassword },
      );

      if (hashError || !hashData) {
        throw new HttpError(500, '合言葉のハッシュ化に失敗しました。');
      }

      const { error: updateError } = await adminClient
        .from('configs')
        .update({ junior_password: hashData })
        .eq('id', 1);

      if (updateError) {
        throw new HttpError(500, '合言葉の更新に失敗しました。');
      }

      await adminClient
        .from('admin_sessions')
        .update({ last_used_at: new Date().toISOString() })
        .eq('id', session.id);

      return new Response(JSON.stringify({ updated: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (body.mode === 'validateJuniorSecretCode') {
      // pgcryptoを使用して検証（RPC関数との互換性のため）
      const { data: isValid, error: validateError } = await adminClient.rpc(
        'validate_junior_secret_code',
        { p_secret_code: body.secretCode },
      );

      if (validateError) {
        throw new HttpError(500, '合言葉の検証に失敗しました。' + validateError.message);
      }

      return new Response(JSON.stringify({ valid: isValid || false }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const config = await fetchAdminConfig(adminClient);

    if (body.mode === 'changePassword') {
      const clientIp = getClientIp(req);
      const currentRateLimitRow = await getRateLimitRow(adminClient, clientIp);
      ensureIpIsNotLocked(currentRateLimitRow);

      const session = await requireValidSession(adminClient, req);

      const currentPasswordMatched = await compare(
        body.currentPassword,
        config.passwordHash,
      );
      if (!currentPasswordMatched) {
        const rateLimitResult = await registerFailedAttempt(
          adminClient,
          clientIp,
          currentRateLimitRow,
        );
        if (rateLimitResult.shouldLock && rateLimitResult.lockedUntil) {
          const retryAfterSeconds = getRemainingLockSeconds(
            rateLimitResult.lockedUntil,
          );
          throw new HttpError(
            429,
            `試行回数が上限に達しました。${retryAfterSeconds}秒後に再試行してください。`,
          );
        }

        throw new HttpError(401, '現在の管理者パスワードが正しくありません。');
      }

      await clearFailedLoginAttempts(adminClient, clientIp);

      const isSameAsCurrent = await compare(
        body.newPassword,
        config.passwordHash,
      );
      if (isSameAsCurrent) {
        throw new HttpError(
          400,
          '新しいパスワードは現在のパスワードと異なる値を指定してください。',
        );
      }

      const newPasswordHash = await hash(body.newPassword, 12);
      const { error: updateError } = await adminClient
        .from('configs')
        .update({ admin_password: newPasswordHash })
        .eq('id', config.id);

      if (updateError) {
        throw updateError;
      }

      await adminClient
        .from('admin_sessions')
        .update({ last_used_at: new Date().toISOString() })
        .eq('id', session.id);

      return new Response(
        JSON.stringify({
          changed: true,
        }),
        {
          status: 200,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
          },
        },
      );
    }

    const clientIp = getClientIp(req);
    const currentRateLimitRow = await getRateLimitRow(adminClient, clientIp);
    ensureIpIsNotLocked(currentRateLimitRow);

    const authenticated = await compare(body.password, config.passwordHash);
    if (!authenticated) {
      const rateLimitResult = await registerFailedAttempt(
        adminClient,
        clientIp,
        currentRateLimitRow,
      );
      if (rateLimitResult.shouldLock && rateLimitResult.lockedUntil) {
        const retryAfterSeconds = getRemainingLockSeconds(
          rateLimitResult.lockedUntil,
        );
        throw new HttpError(
          429,
          `試行回数が上限に達しました。${retryAfterSeconds}秒後に再試行してください。`,
        );
      }

      return new Response(
        JSON.stringify({
          authenticated: false,
          remainingAttempts: rateLimitResult.remainingAttempts,
        }),
        {
          status: 200,
          headers: {
            ...corsHeaders,
            'Content-Type': 'application/json',
          },
        },
      );
    }

    await clearFailedLoginAttempts(adminClient, clientIp);

    const session = await createSession(adminClient);

    return new Response(
      JSON.stringify({
        authenticated: true,
        sessionToken: session.token,
        expiresAt: session.expiresAt,
        sessionDurationMs: ADMIN_CONTROL_PANEL_SESSION_DURATION_MS,
      }),
      {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      },
    );
  } catch (error) {
    console.error(error);

    const isHttpError = error instanceof HttpError;
    return new Response(
      JSON.stringify({
        error: isHttpError
          ? error.message
          : '認証に失敗しました。通信状況と設定を確認してください。',
      }),
      {
        status: isHttpError ? error.status : 500,
        headers: {
          ...corsHeaders,
          'Content-Type': 'application/json',
        },
      },
    );
  }
});
