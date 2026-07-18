export const SCAN_SERVER_URL_STORAGE_KEY = 'scan_server_url';
export const SCAN_SERVER_TIMEOUT_MS = 5000;

export type ScanRecord = {
  id: number;
  ticket_code: string;
  scanned_at: string;
  result: string;
  count: number;
};

export type TicketRow = {
  id: string;
  used_at: string | null;
  count: number;
};

export type SupabaseTicketStatusRow = {
  code: string;
  status: string;
};

export type TicketSyncSummary = {
  total: number;
  lastSyncedAt: string | null;
};

export type OperationLogRow = {
  id: number;
  created_at: string;
  location: string;
  operation_type: string;
  ticket_code: string;
  message: string;
  details: string | null;
};

export const scanResultLabels: Record<string, string> = {
  success: '成功',
  duplicate: '重複',
  reentry: '再入場',
  failed: 'エラー',
  unverified: '署名検証エラー',
  wrongYear: '年度確認エラー',
};

export class ScanServerUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ScanServerUnavailableError';
  }
}

export function isScanServerUnavailableError(error: unknown): boolean {
  return error instanceof ScanServerUnavailableError;
}

export function normalizeServerUrl(localServerUrl: string) {
  let url = localServerUrl.trim();
  if (!/^https?:\/\//i.test(url)) {
    url = 'http://' + url;
  }
  return url.replace(/\/+$/, '');
}

export function buildScanApiUrl(localServerUrl: string) {
  return normalizeServerUrl(localServerUrl) + '/api';
}

function buildScanApiEndpoint(localServerUrl: string, path: string) {
  return buildScanApiUrl(localServerUrl) + path;
}

export function clampCount(next: number) {
  return next < 1 ? 1 : next;
}

async function requestScanServer(
  localServerUrl: string,
  path: string,
  init?: RequestInit,
) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), SCAN_SERVER_TIMEOUT_MS);

  try {
    const response = await fetch(buildScanApiEndpoint(localServerUrl, path), {
      ...init,
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`同期サーバーエラー: ${response.status}`);
    }
    return response.json();
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new ScanServerUnavailableError(
        '同期サーバーが5秒以内に応答しませんでした。',
      );
    }

    if (error instanceof TypeError) {
      throw new ScanServerUnavailableError('同期サーバーに接続できませんでした。');
    }

    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

export async function getTicketOnServer(
  localServerUrl: string,
  ticketId: string,
  count = 1,
  options?: { allowUnknown?: boolean },
) {
  const data = await requestScanServer(localServerUrl, '', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      id: ticketId,
      count,
      allowUnknown: options?.allowUnknown === true,
    }),
  });

  const result = data as {
    status?: string;
    usedAt?: string;
    masterStatus?: string;
  };
  const usedAt =
    typeof result.usedAt === 'string' &&
    !Number.isNaN(new Date(result.usedAt).getTime())
      ? new Date(result.usedAt)
      : null;

  return {
    ticketStatus: typeof result.status === 'string' ? result.status : null,
    ticketUsedAt: usedAt ? usedAt.toLocaleString() : '不明',
    lastUsedAt: usedAt,
    masterStatus:
      typeof result.masterStatus === 'string' ? result.masterStatus : null,
  };
}

export async function fetchScanRecordsFromServer(
  localServerUrl: string,
  options?: { all?: boolean },
) {
  const data = (await requestScanServer(
    localServerUrl,
    '/records' + (options?.all ? '?all=1' : ''),
  )) as { records?: ScanRecord[] };
  return Array.isArray(data.records) ? (data.records as ScanRecord[]) : [];
}

export async function fetchEntryCountFromServer(localServerUrl: string) {
  const data = (await requestScanServer(localServerUrl, '/stats')) as {
    entryCount?: number;
  };
  return typeof data.entryCount === 'number' ? data.entryCount : 0;
}

export async function fetchTicketsFromServer(localServerUrl: string) {
  const data = (await requestScanServer(localServerUrl, '/tickets')) as {
    tickets?: TicketRow[];
  };
  return Array.isArray(data.tickets) ? (data.tickets as TicketRow[]) : [];
}

export async function syncSupabaseTicketsToServer(
  localServerUrl: string,
  tickets: SupabaseTicketStatusRow[],
) {
  const data = (await requestScanServer(localServerUrl, '/tickets/sync', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ tickets }),
  })) as { imported?: number; syncedAt?: string };

  return {
    imported: typeof data.imported === 'number' ? data.imported : 0,
    syncedAt: typeof data.syncedAt === 'string' ? data.syncedAt : null,
  };
}

export async function fetchTicketSyncSummaryFromServer(localServerUrl: string) {
  const data = (await requestScanServer(
    localServerUrl,
    '/tickets/sync-status',
  )) as {
    total?: number;
    lastSyncedAt?: string | null;
  };

  return {
    total: typeof data.total === 'number' ? data.total : 0,
    lastSyncedAt:
      typeof data.lastSyncedAt === 'string' || data.lastSyncedAt === null
        ? data.lastSyncedAt
        : null,
  } satisfies TicketSyncSummary;
}

export async function fetchOperationLogsFromServer(localServerUrl: string) {
  const data = (await requestScanServer(localServerUrl, '/operation-logs')) as {
    logs?: OperationLogRow[];
  };
  return Array.isArray(data.logs) ? (data.logs as OperationLogRow[]) : [];
}

export async function updateRecordCountOnServer(
  localServerUrl: string,
  logId: number,
  code: string,
  count: number,
) {
  await requestScanServer(localServerUrl, '/count', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      logId,
      code,
      count,
    }),
  });
}

export async function updateReentryCountOnServer(
  localServerUrl: string,
  code: string,
  count: number,
) {
  await requestScanServer(localServerUrl, '/reentry', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      code,
      count,
    }),
  });
}

export async function deleteScanRecordOnServer(
  localServerUrl: string,
  logId: number,
) {
  await requestScanServer(localServerUrl, '/records', {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      logId,
    }),
  });
}

export async function logTicketToServer(
  localServerUrl: string,
  code: string,
  result: string,
  count: number,
) {
  const data = (await requestScanServer(localServerUrl, '/log', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      code: code.replace('-', ''),
      result,
      count,
    }),
  })) as { logId?: number };
  return typeof data?.logId === 'number' ? data.logId : null;
}
