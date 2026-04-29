/* eslint-disable no-console */

import '@supabase/functions-js/edge-runtime.d.ts';

import { createClient } from '@supabase/supabase-js';

import { getCorsHeaders } from '@shared/cors.ts';
import { getEnv } from '@shared/getEnv.ts';
import HttpError from '@shared/HttpError.ts';
import {
  generateManualCode,
  generateTicketCode,
  signCode,
} from '@shared/generateTicketCode.ts';
import { issueWithRollback, type RpcClient } from './issueWithRollback.ts';
import {
  YEAR_BITS,
  AFFILIATION_NUMBER_BITS,
  SERIAL_BITS,
} from '@shared/ticketDataType.ts';

type IssueTicketsRequest = {
  ticketTypeId: number;
  relationshipId: number;
  performanceId: number;
  scheduleId: number;
  issueCount: number;
  turnstileToken?: string;
  // If provided, the backend will (cancel old + issue new) transitionally.
  // Intended for "relationship change" reissue.
  cancelCode?: string;
  // 変更先の間柄ID
  targetRelationshipId?: number;
};

type TicketIssueMode =
  | 'open'
  | 'only-own'
  | 'public-rehearsals'
  | 'auto'
  | 'off';

type TicketIssueControls = {
  classInvite: TicketIssueMode;
  rehearsalInvite: TicketIssueMode;
  gymInvite: TicketIssueMode;
  entryOnly: TicketIssueMode;
  sameDayClass: TicketIssueMode;
  sameDayGym: TicketIssueMode;
};

const SELF_RELATIONSHIP_ID = 1;
const ANONYMOUS_AFFILIATION = 0;
const DAY_TICKET_ANONYMOUS_AFFILIATION = 1600; // 学年=16、クラス=00 として当日券を表す
const DAY_TICKET_GUEST_USER_ID = '00000000-0000-0000-0000-00000000d001';
const TICKET_ISSUE_MODE_VALUES = new Set<string>([
  'open',
  'only-own',
  'public-rehearsals',
  'auto',
  'off',
]);
const DEFAULT_TICKET_ISSUE_CONTROLS: TicketIssueControls = {
  classInvite: 'open',
  rehearsalInvite: 'open',
  gymInvite: 'open',
  entryOnly: 'open',
  sameDayClass: 'open',
  sameDayGym: 'open',
};

const padNumber = (value: number, length: number): string =>
  String(value).padStart(length, '0');

const parseRequestBody = (body: unknown): IssueTicketsRequest => {
  if (!body || typeof body !== 'object') {
    throw new HttpError(
      400,
      'リクエストボディが正しくありません。システム担当にお問い合わせください。',
    );
  }

  const parsed = body as Record<string, unknown>;

  const ticketTypeId = Number(parsed.ticketTypeId);
  const relationshipId = Number(parsed.relationshipId);
  const performanceId = Number(parsed.performanceId);
  const scheduleId = Number(parsed.scheduleId);
  const issueCount = Number(parsed.issueCount);
  const turnstileToken = parsed.turnstileToken;
  const cancelCodeRaw = parsed.cancelCode;
  const targetRelationshipId = Number(parsed.targetRelationshipId);

  if (
    !Number.isInteger(ticketTypeId) ||
    !Number.isInteger(relationshipId) ||
    !Number.isInteger(performanceId) ||
    !Number.isInteger(scheduleId) ||
    !Number.isInteger(issueCount)
  ) {
    throw new HttpError(
      400,
      'リクエストボディのフィールドはすべて整数でなければなりません。システム担当にお問い合わせください。',
    );
  }

  if (ticketTypeId < 1 || relationshipId < 1 || issueCount < 1) {
    throw new HttpError(
      400,
      'リクエストボディに無効な数値範囲が含まれています。システム担当にお問い合わせください。',
    );
  }

  if (performanceId > 99 || scheduleId > 99) {
    throw new HttpError(400, 'performanceId or scheduleId exceeds 2 digits');
  }

  if (issueCount > 100) {
    throw new HttpError(400, 'Cannot issue more than 100 tickets at a time');
  }

  const cancelCode =
    typeof cancelCodeRaw === 'string' && cancelCodeRaw.trim().length > 0
      ? cancelCodeRaw.trim()
      : undefined;

  return {
    ticketTypeId,
    relationshipId,
    performanceId,
    scheduleId,
    issueCount,
    turnstileToken:
      typeof turnstileToken === 'string' ? turnstileToken.trim() : undefined,
    cancelCode,
    targetRelationshipId,
  };
};

const verifyTurnstileToken = async (
  req: Request,
  token: string,
): Promise<void> => {
  const secret = getEnv('TURNSTILE_SECRET_KEY');
  const ipHeader =
    req.headers.get('cf-connecting-ip') ??
    req.headers.get('x-forwarded-for') ??
    '';
  const remoteIp = ipHeader.split(',')[0]?.trim();

  const body = new URLSearchParams({
    secret,
    response: token,
  });

  if (remoteIp) {
    body.set('remoteip', remoteIp);
  }

  const verifyRes = await fetch(
    'https://challenges.cloudflare.com/turnstile/v0/siteverify',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    },
  );

  if (!verifyRes.ok) {
    throw new HttpError(
      502,
      'Turnstile検証サーバーへの接続に失敗しました。時間をおいて再度お試しください。',
    );
  }

  const verifyPayload = (await verifyRes.json()) as {
    success?: boolean;
    'error-codes'?: string[];
  };

  if (!verifyPayload.success) {
    const codes = (verifyPayload['error-codes'] ?? []).join(', ');
    throw new HttpError(
      403,
      `Turnstile認証に失敗しました。${codes ? `(${codes})` : ''}`,
    );
  }
};

const validatePerformanceAndSchedule = (
  body: IssueTicketsRequest,
  admissionOnlyTicketTypeIds: number[],
): 'admission' | 'class' | 'gym' => {
  const admissionOnlySet = new Set(admissionOnlyTicketTypeIds);
  const isAdmissionOnly = admissionOnlySet.has(body.ticketTypeId);

  if (isAdmissionOnly) {
    if (body.performanceId !== 0 || body.scheduleId !== 0) {
      throw new HttpError(
        400,
        'リクエストが間違っています。システム担当にお問い合わせください。Admission-only ticket requires performanceId=0 and scheduleId=0',
      );
    }
    return 'admission';
  }

  const isGym = body.performanceId > 0 && body.scheduleId === 0;
  if (isGym) {
    return 'gym';
  }

  if (body.performanceId < 1 || body.scheduleId < 1) {
    throw new HttpError(
      400,
      'リクエストが間違っています。システム担当にお問い合わせください。performanceId and scheduleId must be positive for this ticket type',
    );
  }

  return 'class';
};

const getStudentGradeClass = (
  affiliation: number,
): { grade: number; classNo: number } => ({
  grade: Math.floor(affiliation / 10000),
  classNo: Math.floor((affiliation % 10000) / 100),
});

const getJstDateKey = (date: Date): string => {
  const formatter = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(date);
};

type TicketIssueControlsReader = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (
        column: string,
        value: unknown,
      ) => {
        maybeSingle: () => PromiseLike<{
          data: unknown;
          error: { message: string } | null;
        }>;
      };
    };
  };
};

const readTicketIssueControls = async (
  adminClient: TicketIssueControlsReader,
): Promise<TicketIssueControls> => {
  const { data, error } = await adminClient
    .from('ticket_issue_controls')
    .select(
      'class_invite_mode, rehearsal_invite_mode, gym_invite_mode, entry_only_mode, same_day_class_mode, same_day_gym_mode',
    )
    .eq('id', 1)
    .maybeSingle();

  if (error) {
    console.warn(
      'ticket_issue_controls read failed, fallback to defaults',
      error,
    );
    return DEFAULT_TICKET_ISSUE_CONTROLS;
  }

  if (!data) {
    return DEFAULT_TICKET_ISSUE_CONTROLS;
  }

  const classInvite = (data as Record<string, unknown>).class_invite_mode;
  const rehearsalInvite = (data as Record<string, unknown>)
    .rehearsal_invite_mode;
  const gymInvite = (data as Record<string, unknown>).gym_invite_mode;
  const entryOnly = (data as Record<string, unknown>).entry_only_mode;
  const sameDayClass = (data as Record<string, unknown>).same_day_class_mode;
  const sameDayGym = (data as Record<string, unknown>).same_day_gym_mode;

  if (
    typeof classInvite !== 'string' ||
    typeof rehearsalInvite !== 'string' ||
    typeof gymInvite !== 'string' ||
    typeof entryOnly !== 'string' ||
    typeof sameDayClass !== 'string' ||
    typeof sameDayGym !== 'string'
  ) {
    return DEFAULT_TICKET_ISSUE_CONTROLS;
  }

  if (
    !TICKET_ISSUE_MODE_VALUES.has(classInvite) ||
    !TICKET_ISSUE_MODE_VALUES.has(rehearsalInvite) ||
    !TICKET_ISSUE_MODE_VALUES.has(gymInvite) ||
    !TICKET_ISSUE_MODE_VALUES.has(entryOnly) ||
    !TICKET_ISSUE_MODE_VALUES.has(sameDayClass) ||
    !TICKET_ISSUE_MODE_VALUES.has(sameDayGym)
  ) {
    return DEFAULT_TICKET_ISSUE_CONTROLS;
  }

  return {
    classInvite: classInvite as TicketIssueMode,
    rehearsalInvite: rehearsalInvite as TicketIssueMode,
    gymInvite: gymInvite as TicketIssueMode,
    entryOnly: entryOnly as TicketIssueMode,
    sameDayClass: sameDayClass as TicketIssueMode,
    sameDayGym: sameDayGym as TicketIssueMode,
  };
};

export const handleIssueTicketsRequest = async (
  req: Request,
): Promise<Response> => {
  const corsHeaders = getCorsHeaders(req);

  // CORSプリフライトリクエストへの対応
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const body = parseRequestBody(await req.json());
    const authorization = req.headers.get('Authorization') ?? '';
    const accessToken = authorization.startsWith('Bearer ')
      ? authorization.slice('Bearer '.length).trim()
      : '';

    const supabaseUrl = getEnv('SUPABASE_URL');
    const publishableKey = getEnv('PUBLISHABLE_KEY');
    const secretKey = getEnv('FOR_ISSUE_TICKETS_SUPABASE_SECRET_KEY');

    const authClient = createClient(supabaseUrl, publishableKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    const adminClient = createClient(supabaseUrl, secretKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    const { data: allTicketTypes, error: ticketTypesError } = await adminClient
      .from('ticket_types')
      .select('id, name, type');

    const findIdByName = (name: string, type: string) =>
      allTicketTypes?.find((t) => t.name === name && t.type === type)?.id;

    const classInviteId = findIdByName('クラス公演(当日)', '招待券');
    const rehearsalInviteId = findIdByName('クラス公演(リハーサル)', '招待券');
    const gymInviteId = findIdByName('体育館公演', '招待券');
    const entryOnlyId = findIdByName('入場専用券', '招待券');
    const juniorEntryOnlyId = findIdByName('入場専用券', '中学生券');
    const sameDayClassId = findIdByName('クラス公演', '当日券');
    const sameDayGymId = findIdByName('体育館公演', '当日券');

    if (ticketTypesError || !allTicketTypes) {
      throw new HttpError(
        500,
        'チケット情報の取得に失敗しました。外苑祭総務にお問い合わせください。',
      );
    }

    const dayTicketTypeIds = new Set(
      (allTicketTypes as Array<{ id: number; type: string | null }>)
        .filter((t) => t.type === '当日券')
        .map((t) => Number(t.id)),
    );

    const admissionOnlyTicketTypeIds = (
      allTicketTypes as Array<{ id: number; name: string }>
    )
      .filter((t) => t.name === '入場専用券')
      .map((t) => Number(t.id));

    if (admissionOnlyTicketTypeIds.length === 0) {
      throw new HttpError(
        500,
        "ticket_types に name='入場専用券' のデータがありません。外苑祭総務にお問い合わせください。",
      );
    }

    // 入場専用券かどうかの判定
    const isAdmissionOnlyTicket = admissionOnlyTicketTypeIds.includes(
      body.ticketTypeId,
    );

    const isDayTicket = dayTicketTypeIds.has(body.ticketTypeId);

    const relationshipId = isDayTicket
      ? SELF_RELATIONSHIP_ID
      : body.relationshipId;

    if (!isDayTicket && !accessToken) {
      throw new HttpError(
        401,
        '認証情報がありません。Bearerトークンを含むAuthorizationヘッダーが必要です。',
      );
    }

    const shouldResolveUser = accessToken.length > 0;
    let user: {
      id: string;
    } | null = null;
    let userRow: {
      affiliation: number | null;
      role: string | null;
      clubs: string[] | null;
      junior_usage_type: number | null;
    } | null = null;

    if (shouldResolveUser) {
      const {
        data: { user: authUser },
        error: authError,
      } = await authClient.auth.getUser(accessToken);

      if (authError || !authUser) {
        if (!isDayTicket) {
          throw new HttpError(
            401,
            'ログイン情報の確認に失敗しました。正しくログインされていますか?',
          );
        }
      } else {
        user = { id: authUser.id };
        const { data: resolvedUserRow, error: userRowError } = await adminClient
          .from('users')
          .select('affiliation, role, clubs, junior_usage_type')
          .eq('id', authUser.id)
          .maybeSingle();

        if (userRowError) {
          throw new HttpError(
            500,
            'ユーザーデータの取得に失敗しました。外苑祭総務にお問い合わせください。',
          );
        }

        userRow = (resolvedUserRow ?? null) as {
          affiliation: number | null;
          role: string | null;
          clubs: string[] | null;
          junior_usage_type: number | null;
        } | null;
      }
    }

    if (!isDayTicket && (!user || !userRow)) {
      throw new HttpError(
        401,
        'ログイン情報の確認に失敗しました。正しくログインされていますか?',
      );
    }

    if (
      !isDayTicket &&
      (!userRow || (userRow.role !== 'student' && userRow.role !== 'junior'))
    ) {
      throw new HttpError(403, '発券可能な利用者ではありません。');
    }

    const isAuthenticatedStudent = Boolean(user && userRow);
    const isJuniorUser = Boolean(userRow && userRow.role === 'junior');
    const isJuniorEntryOnlyTicket =
      juniorEntryOnlyId !== undefined &&
      body.ticketTypeId === juniorEntryOnlyId;
    const requiresTurnstile =
      !isDayTicket && !(isJuniorUser && isJuniorEntryOnlyTicket);

    if (requiresTurnstile) {
      if (!body.turnstileToken) {
        throw new HttpError(400, 'Turnstileトークンがありません。');
      }
      await verifyTurnstileToken(req, body.turnstileToken);
    }

    const affiliation = isAuthenticatedStudent
      ? Number(userRow?.affiliation ?? -1)
      : isDayTicket
        ? DAY_TICKET_ANONYMOUS_AFFILIATION
        : ANONYMOUS_AFFILIATION;

    if (isAuthenticatedStudent) {
      if (!Number.isInteger(affiliation)) {
        throw new HttpError(400, 'ユーザーデータの所属情報が不正です。');
      }

      if (isJuniorUser) {
        if (affiliation < 100000) {
          throw new HttpError(
            400,
            '中学生アカウントの所属番号が不正です。外苑祭総務にお問い合わせください。',
          );
        }
      } else if (affiliation < 10000 || affiliation > 39999) {
        throw new HttpError(
          400,
          'ユーザーデータの学年クラス番号が不正です。外苑祭総務にお問い合わせください。',
        );
      }
    } else if (!isDayTicket) {
      throw new HttpError(401, 'ログイン情報の確認に失敗しました。');
    }

    if (!isDayTicket && isJuniorUser) {
      if (body.relationshipId !== SELF_RELATIONSHIP_ID) {
        throw new HttpError(400, '中学生アカウントは本人分のみ発券できます。');
      }
      if (body.issueCount !== 1) {
        throw new HttpError(400, '中学生アカウントの発券枚数は1枚固定です。');
      }
    }

    const issueMode = validatePerformanceAndSchedule(
      body,
      admissionOnlyTicketTypeIds,
    );
    const issueUserId = user?.id ?? DAY_TICKET_GUEST_USER_ID;

    let gymPerformanceRow: { id: number; group_name: string } | null = null;
    if (issueMode === 'gym') {
      const { data, error } = await adminClient
        .from('gym_performances')
        .select('id, group_name')
        .eq('id', body.performanceId)
        .maybeSingle();

      if (error || !data) {
        throw new HttpError(
          409,
          '体育館公演情報が見つかりません。ページを更新してからやり直してください。',
        );
      }
      gymPerformanceRow = data as { id: number; group_name: string };
    }

    if (body.cancelCode && body.issueCount !== 1) {
      throw new HttpError(400, '差し替え発券は1枚ずつのみ対応しています。');
    }
    if (isDayTicket && body.cancelCode) {
      throw new HttpError(400, '当日券の差し替え発券には対応していません。');
    }

    // Check per-user max tickets before reserving serial numbers to avoid
    // incrementing the counter when the user would exceed their limit.
    const { data: configRow, error: configError } = await adminClient
      .from('configs')
      .select(
        'max_tickets_per_user, max_tickets_per_junior_user, is_active, event_year',
      )
      .order('id', { ascending: true })
      .maybeSingle();

    if (configError) {
      throw new HttpError(
        500,
        '設定の取得に失敗しました。外苑祭総務にお問い合わせください。',
      );
    }

    if (
      !configRow ||
      configRow.max_tickets_per_user === null ||
      configRow.max_tickets_per_junior_user === null ||
      configRow.event_year === null
    ) {
      throw new HttpError(
        500,
        'チケット発行設定が見つかりません。外苑祭総務にお問い合わせください。',
      );
    }

    if (configRow.is_active === false) {
      throw new HttpError(
        409,
        '現在チケット発券は停止中です。しばらくしてから再度お試しください。',
      );
    }

    // 詳細な受付・有効設定のチェック
    // 1. 間柄の受付状態チェック
    const { data: relData, error: relError } = await adminClient
      .from('relationships')
      .select('is_accepting')
      .eq('id', relationshipId)
      .maybeSingle();

    if (
      relError ||
      (relData && !(relData as { is_accepting: boolean }).is_accepting)
    ) {
      throw new HttpError(
        403,
        '選択された間柄は現在チケットの受付を停止しています。',
      );
    }

    // 2. 公演・公演回の受付状態チェック
    if (issueMode === 'class') {
      const { data: perfData, error: perfError } = await adminClient
        .from('class_performances')
        .select('is_accepting')
        .eq('id', body.performanceId)
        .maybeSingle();
      if (
        perfError ||
        (perfData && !(perfData as { is_accepting: boolean }).is_accepting)
      ) {
        throw new HttpError(
          403,
          '選択されたクラスは現在チケットの受付を停止しています。',
        );
      }

      const { data: schData, error: schError } = await adminClient
        .from('performances_schedule')
        .select('is_active')
        .eq('id', body.scheduleId)
        .maybeSingle();
      if (
        schError ||
        (schData && !(schData as { is_active: boolean }).is_active)
      ) {
        throw new HttpError(403, '選択された公演回は現在無効化されています。');
      }
    } else if (issueMode === 'gym') {
      const { data: perfData, error: perfError } = await adminClient
        .from('gym_performances')
        .select('is_accepting')
        .eq('id', body.performanceId)
        .maybeSingle();
      if (
        perfError ||
        (perfData && !(perfData as { is_accepting: boolean }).is_accepting)
      ) {
        throw new HttpError(
          403,
          '選択された部活・団体は現在チケットの受付を停止しています。',
        );
      }
    }

    const ticketIssueControls = await readTicketIssueControls(
      adminClient as unknown as TicketIssueControlsReader,
    );

    if (classInviteId !== undefined && body.ticketTypeId === classInviteId) {
      if (ticketIssueControls.classInvite === 'off') {
        throw new HttpError(409, 'クラス公演招待券の受付は停止中です。');
      }
      if (ticketIssueControls.classInvite === 'only-own') {
        const { grade, classNo } = getStudentGradeClass(affiliation);
        const ownClassName = `${grade}-${classNo}`;
        const { data: classPerformance, error: classPerformanceError } =
          await adminClient
            .from('class_performances')
            .select('class_name')
            .eq('id', body.performanceId)
            .maybeSingle();
        if (classPerformanceError || !classPerformance) {
          throw new HttpError(
            409,
            'クラス公演情報の取得に失敗しました。ページを更新してからやり直してください。',
          );
        }
        if (classPerformance.class_name !== ownClassName) {
          throw new HttpError(
            403,
            'この設定では自クラス公演のみ発券できます。',
          );
        }
      }
    } else if (
      rehearsalInviteId !== undefined &&
      body.ticketTypeId === rehearsalInviteId
    ) {
      if (ticketIssueControls.rehearsalInvite === 'off') {
        throw new HttpError(409, 'リハーサル招待券の受付は停止中です。');
      }
      if (ticketIssueControls.rehearsalInvite === 'public-rehearsals') {
        const { data: rehearsalRow, error: rehearsalError } = await adminClient
          .from('rehearsals')
          .select('id')
          .eq('class_id', body.performanceId)
          .eq('round_id', body.scheduleId)
          .eq('is_active', true)
          .eq('type', 'unofficial')
          .limit(1)
          .maybeSingle();
        if (rehearsalError) {
          throw new HttpError(
            500,
            '公開リハーサル情報の取得に失敗しました。時間をおいて再度お試しください。',
          );
        }
        if (!rehearsalRow) {
          throw new HttpError(
            403,
            'この設定では公開リハーサルのみ発券できます。',
          );
        }
      }
    } else if (gymInviteId !== undefined && body.ticketTypeId === gymInviteId) {
      if (ticketIssueControls.gymInvite === 'off') {
        throw new HttpError(409, '体育館公演招待券の受付は停止中です。');
      }
      if (ticketIssueControls.gymInvite === 'only-own') {
        const clubs = userRow?.clubs ?? [];
        if (
          !gymPerformanceRow ||
          !clubs.includes(gymPerformanceRow.group_name)
        ) {
          throw new HttpError(
            403,
            'この設定では自部活の公演のみ発券できます。',
          );
        }
      }
    } else if (
      (entryOnlyId !== undefined && body.ticketTypeId === entryOnlyId) ||
      body.ticketTypeId === juniorEntryOnlyId
    ) {
      if (ticketIssueControls.entryOnly === 'off') {
        throw new HttpError(409, '入場専用券の受付は停止中です。');
      }

      if (isJuniorUser && isJuniorEntryOnlyTicket) {
        const {
          count: existingJuniorEntryOnlyCount,
          error: existingJuniorEntryOnlyError,
        } = await adminClient
          .from('tickets')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', issueUserId)
          .eq('status', 'valid')
          .eq('ticket_type', body.ticketTypeId);

        if (existingJuniorEntryOnlyError) {
          throw new HttpError(
            500,
            '入場専用券の発券状況確認に失敗しました。時間をおいて再度お試しください。',
          );
        }

        if (Number(existingJuniorEntryOnlyCount ?? 0) > 0 && !body.cancelCode) {
          throw new HttpError(
            409,
            '中学生券の入場専用券は既に発券済みです（1人1枚）。',
          );
        }
      }
    } else if (
      (sameDayClassId !== undefined && body.ticketTypeId === sameDayClassId) ||
      (sameDayGymId !== undefined && body.ticketTypeId === sameDayGymId)
    ) {
      const mode =
        body.ticketTypeId === sameDayClassId
          ? ticketIssueControls.sameDayClass
          : ticketIssueControls.sameDayGym;
      if (mode === 'off') {
        throw new HttpError(409, '当日券受付は停止中です。');
      }
      if (mode === 'auto') {
        const todayKey = getJstDateKey(new Date());
        if (body.ticketTypeId === sameDayClassId) {
          const { data: scheduleRow, error: scheduleError } = await adminClient
            .from('performances_schedule')
            .select('start_at')
            .eq('id', body.scheduleId)
            .maybeSingle();
          if (scheduleError || !scheduleRow?.start_at) {
            throw new HttpError(409, '公演日時の取得に失敗しました。');
          }
          const scheduleKey = getJstDateKey(new Date(scheduleRow.start_at));
          if (scheduleKey !== todayKey) {
            throw new HttpError(
              403,
              'この設定では当日分の当日券のみ発券できます。',
            );
          }
        } else {
          const { data: gymRow, error: gymError } = await adminClient
            .from('gym_performances')
            .select('start_at')
            .eq('id', body.performanceId)
            .maybeSingle();
          if (gymError || !gymRow?.start_at) {
            throw new HttpError(409, '公演日時の取得に失敗しました。');
          }
          const scheduleKey = getJstDateKey(new Date(gymRow.start_at));
          if (scheduleKey !== todayKey) {
            throw new HttpError(
              403,
              'この設定では当日分の当日券のみ発券できます。',
            );
          }
        }
      }
    }

    const maxTicketsPerUser = isJuniorUser
      ? Number(configRow.max_tickets_per_junior_user)
      : Number(configRow.max_tickets_per_user);
    const configuredYear = Number(configRow.event_year);
    if (!Number.isInteger(configuredYear) || configuredYear < 0) {
      throw new HttpError(
        500,
        '設定された年度が不正です。外苑祭総務にお問い合わせください。',
      );
    }

    if (!isDayTicket && body.issueCount > maxTicketsPerUser) {
      throw new HttpError(
        409,
        `1回の発行枚数がユーザ上限を超えています。最大 ${maxTicketsPerUser} 枚までです。
        さらに必要な場合は、まだ発行可能枚数に余裕がある他の生徒に、招待券を分けてもらえないかと相談してください。`,
      );
    }

    // For transactional "replace/reissue", validate the target ticket early and
    // adjust the per-user ticket limit check to account for the cancellation.
    let replaceTicketOffset = 0;
    let oldTicket: {
      id: string;
      user_id: string;
      status: string;
      ticket_type: number;
      person_count: number;
    } | null = null;
    if (body.cancelCode) {
      const { data: fetchedOldTicket, error: oldTicketError } =
        await adminClient
          .from('tickets')
          .select('id, user_id, status, ticket_type, person_count')
          .eq('code', body.cancelCode)
          .maybeSingle();

      if (oldTicketError || !fetchedOldTicket) {
        throw new HttpError(
          409,
          '差し替え対象のチケット情報の取得に失敗しました。時間をおいて再度お試しください。',
        );
      }
      oldTicket = fetchedOldTicket; // 取得したチケット情報を外部スコープの変数に代入

      if (oldTicket.user_id !== user?.id) {
        throw new HttpError(403, '差し替え対象のチケットが不正です。');
      }

      if (oldTicket.status !== 'valid') {
        throw new HttpError(
          409,
          '差し替え対象のチケットが有効ではありません。',
        );
      }

      if (Number(oldTicket.ticket_type) !== body.ticketTypeId) {
        throw new HttpError(
          409,
          '差し替え対象のチケット情報が一致しません。ページを更新してからやり直してください。',
        );
      }

      if (
        (entryOnlyId !== undefined && body.ticketTypeId === entryOnlyId) ||
        (juniorEntryOnlyId !== undefined &&
          body.ticketTypeId === juniorEntryOnlyId)
      ) {
        if (body.performanceId !== 0 || body.scheduleId !== 0) {
          throw new HttpError(
            409,
            '差し替え対象のチケット情報が一致しません。ページを更新してからやり直してください。',
          );
        }
      } else if (issueMode === 'gym') {
        const { data: gymTicket, error: gymTicketError } = await adminClient
          .from('gym_tickets')
          .select('performance_id')
          .eq('id', oldTicket.id)
          .maybeSingle();

        if (gymTicketError || !gymTicket) {
          throw new HttpError(
            409,
            '差し替え対象のチケット情報の取得に失敗しました。時間をおいて再度お試しください。',
          );
        }

        if (
          Number(gymTicket.performance_id) !== body.performanceId ||
          body.scheduleId !== 0
        ) {
          throw new HttpError(
            409,
            '差し替え対象のチケット情報が一致しません。ページを更新してからやり直してください。',
          );
        }
      } else {
        const { data: classTicket, error: classTicketError } = await adminClient
          .from('class_tickets')
          .select('class_id, round_id')
          .eq('id', oldTicket.id)
          .maybeSingle();

        if (classTicketError || !classTicket) {
          throw new HttpError(
            409,
            '差し替え対象のチケット情報の取得に失敗しました。時間をおいて再度お試しください。',
          );
        }

        if (
          Number(classTicket.class_id) !== body.performanceId ||
          Number(classTicket.round_id) !== body.scheduleId
        ) {
          throw new HttpError(
            409,
            '差し替え対象のチケット情報が一致しません。ページを更新してからやり直してください。',
          );
        }
      }

      replaceTicketOffset = 1;
    }

    let existingCountQuery = adminClient
      .from('tickets')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', issueUserId)
      .eq('status', 'valid');

    // 入場専用券は上限カウントの対象外とする
    if (admissionOnlyTicketTypeIds.length > 0) {
      existingCountQuery = existingCountQuery.not(
        'ticket_type',
        'in',
        `(${admissionOnlyTicketTypeIds.join(',')})`,
      );
    }

    const { count: existingCount, error: existingCountError } =
      await existingCountQuery;

    if (existingCountError) {
      throw new HttpError(
        500,
        '既存チケット数の取得に失敗しました。外苑祭総務にお問い合わせください。',
      );
    }

    const existing = Number(existingCount ?? 0);
    const effectiveExisting = Math.max(0, existing - replaceTicketOffset);

    const juniorUsageType = isJuniorUser
      ? Number(userRow?.junior_usage_type ?? -1)
      : -1;

    // usageType 0 (共通): 1レコード(1コード)で2人分
    // usageType 1 (別々): 2レコード(2コード)で1人分ずつ
    // usageType 1 (別々): 2レコード発行するが、差し替え時は1枚ずつ行うため 1 に固定
    const numCodes =
      !isDayTicket && isJuniorUser && juniorUsageType === 1 && !body.cancelCode
        ? body.issueCount * 2
        : body.issueCount;
    const personCountPerTicket =
      !isDayTicket &&
      isJuniorUser &&
      ((!body.cancelCode && juniorUsageType === 0) ||
        body.targetRelationshipId === 2)
        ? 2
        : 1;
    const totalPersonCount = numCodes * personCountPerTicket;
    const maxTicketsPerJuniorUser =
      juniorUsageType === 0 || juniorUsageType === 1
        ? maxTicketsPerUser * 2
        : maxTicketsPerUser;
    // 入場専用券のリクエストまたは間柄の変更時は制限チェックをスキップする
    const isExemptLimit =
      isAdmissionOnlyTicket || body.targetRelationshipId !== undefined;

    if (
      !isDayTicket &&
      !isExemptLimit &&
      effectiveExisting + totalPersonCount > maxTicketsPerJuniorUser
    ) {
      throw new HttpError(
        409,
        `チケット発行上限を超えています（既に ${existing} 人分）。1ユーザあたり最大 ${maxTicketsPerUser} 人分までです。
        さらに必要な場合は、まだ発行可能枚数に余裕がある他の生徒に、招待券を分けてもらえないかと相談してください。`,
      );
    }

    // チケットコードのプレフィックスを生成（学年クラス番号 + チケット種別 + 間柄 + 公演ID + 回ID + 発行年をYEAR_BITSで割ったあまり）
    const issuedYear = configuredYear;
    const issuedYearForPrefix = issuedYear % 2 ** Number(YEAR_BITS);
    const concatenated = `${padNumber(affiliation, 5)}${padNumber(body.ticketTypeId, 1)}${padNumber(relationshipId, 1)}${padNumber(body.performanceId, 2)}${padNumber(body.scheduleId, 2)}${padNumber(issuedYearForPrefix, 2)}`;
    const basePrefix = generateManualCode(BigInt(concatenated));

    // チケットコードに埋め込むフラグの決定ロジック
    const getEncodingRelationshipId = (index: number): number => {
      if (!isJuniorUser || isDayTicket) {
        return relationshipId;
      }
      if (body.targetRelationshipId) {
        return body.targetRelationshipId;
      }
      // junior_usage_type マッピング (0:両方共通->2, 1:別々->0or1, 2:本人のみ->0, 3:保護者のみ->1)
      switch (juniorUsageType) {
        case 0:
          return 2; // both
        case 1:
          return index % 2 === 0 ? 0 : 1; // 1枚目: middle-school, 2枚目: guardian
        case 2:
          return 0; // middle-school
        case 3:
          return 1; // guardian
        default:
          return relationshipId;
      }
    };

    const maxSerialLimit =
      affiliation === DAY_TICKET_ANONYMOUS_AFFILIATION && isDayTicket
        ? 2 ** (Number(AFFILIATION_NUMBER_BITS) + Number(SERIAL_BITS))
        : 2 ** Number(SERIAL_BITS);

    // プレフィックスをキーとして発行枚数をデータベースに登録し、シリアル番号を取得
    const { data: counterData, error: counterError } = await adminClient.rpc(
      'increment_ticket_code_counter',
      {
        p_prefix: basePrefix,
        p_increment: numCodes,
        p_max_value: maxSerialLimit,
      },
    );

    if (counterError?.message.includes('exceeded')) {
      throw new HttpError(
        409,
        `同一種類(公演クラス・回・間柄が同じチケット)のチケット発行可能最大枚数(${maxSerialLimit - 1}枚)を超えています。申し訳ありませんが、公演回を変えて発行してください。`,
      );
    }

    if (counterError) {
      throw new HttpError(
        500,
        'チケットコードのカウンターの更新に失敗しました。しばらく時間を置いてから、もう一度お試しください。:' +
          counterError.message,
      );
    }

    if (counterData === null) {
      throw new HttpError(
        500,
        '一時的にエラーが発生しました。時間をおいてもう一度お試しください。',
      );
    }
    const endSerial = counterData as number;
    let issuedTickets: Array<{ code: string; signature: string }>;

    const { data, error } = await adminClient.rpc('get_remaining_seats', {
      p_performance_id: body.performanceId,
      p_schedule_id: body.scheduleId,
    });
    if (error) {
      console.error(error);
    } else {
      console.log(data);
    }

    if (!body.cancelCode) {
      issuedTickets = await issueWithRollback({
        adminClient: adminClient as unknown as RpcClient,
        userId: issueUserId,
        issueCount: numCodes,
        issueMode,
        ticketTypeId: body.ticketTypeId,
        relationshipId,
        performanceId: body.performanceId,
        scheduleId: body.scheduleId,
        affiliation,
        issuedYear,
        basePrefix,
        endSerial,
        personCount: personCountPerTicket,
        encodingRelationshipId: getEncodingRelationshipId,
        generateCode: generateTicketCode,
        signTicketCode: signCode,
      });
    } else {
      const startSerial = endSerial - numCodes + 1;
      let shouldRollbackCounter = true;

      try {
        const serial = startSerial;
        const ticketData = {
          affiliation,
          relationship:
            body.targetRelationshipId ?? getEncodingRelationshipId(0),
          type: body.ticketTypeId,
          performance: body.performanceId,
          schedule: body.scheduleId,
          year: issuedYear,
          serial,
        };

        const code = await generateTicketCode(ticketData);
        const signature = await signCode(code);

        const reissueRpcName =
          issueMode === 'gym'
            ? 'reissue_gym_ticket_change_relationship_with_codes'
            : 'reissue_ticket_change_relationship_with_codes';

        const { data, error } = await adminClient.rpc(reissueRpcName, {
          p_user_id: issueUserId,
          p_old_code: body.cancelCode,
          p_ticket_type_id: body.ticketTypeId,
          p_performance_id: body.performanceId,
          p_schedule_id: body.scheduleId,
          p_new_relationship_id: relationshipId,
          p_issue_count: 1,
          p_codes: [code],
          p_signatures: [signature],
          p_person_count: personCountPerTicket,
        });

        if (error) {
          throw new HttpError(409, error.message);
        }

        issuedTickets =
          (data as Array<{ code: string; signature: string }>) ?? [];
        shouldRollbackCounter = false;
      } finally {
        if (shouldRollbackCounter) {
          const { data: rollbackApplied, error: rollbackError } =
            await adminClient.rpc('rollback_ticket_code_counter', {
              p_prefix: basePrefix,
              p_decrement: numCodes,
              p_expected_last_value: endSerial,
            });

          if (rollbackError) {
            console.error('Failed to rollback ticket code counter', {
              userId: issueUserId,
              prefix: basePrefix,
              issueCount: body.issueCount,
              endSerial,
              rollbackError,
            });
          } else if (rollbackApplied !== true) {
            console.error(
              'Counter rollback was skipped because state changed',
              {
                userId: issueUserId,
                prefix: basePrefix,
                issueCount: body.issueCount,
                endSerial,
              },
            );
          }
        }
      }
    }

    console.log('Issued tickets successfully', {
      userId: issueUserId,
      isDayTicket,
      isAuthenticatedStudent,
      issueMode,
      ticketTypeId: body.ticketTypeId,
      affiliation,
      relationshipId,
      performanceId: body.performanceId,
      scheduleId: body.scheduleId,
      issueCount: body.issueCount,
      cancelCode: body.cancelCode ?? null,
    });

    return new Response(
      JSON.stringify({
        issuedTickets,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      },
    );
  } catch (error) {
    const httpError = error instanceof HttpError ? error : null;
    const status = httpError?.status ?? 500;
    const message =
      error instanceof Error ? error.message : 'Unexpected server error';

    console.error('Error processing request:', { error, status, message });

    return new Response(JSON.stringify({ error: message }), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
};

if (import.meta.main) {
  Deno.serve(handleIssueTicketsRequest);
}
