import Alert from '../../components/ui/Alert';
import NormalSection from '../../components/ui/NormalSection';
import { useEffect, useState } from 'preact/hooks';
import { supabase } from '../../lib/supabase';
import styles from './Settings.module.css';
import Switch from '../../components/ui/Switch';
import { useTitle } from '../../hooks/useTitle';
import { useEventConfig } from '../../hooks/useEventConfig';
import PerformancesTable from '../../features/performances/PerformancesTable';
import GymPerformancesTable from '../../features/performances/GymPerformancesTable';
import LoadingSpinner from '../../components/ui/LoadingSpinner';
import {
  AdminAuthLayout,
  getSessionToken,
  readErrorMessage,
} from '../../layout/AdminAuthLayout';

type ControlPanelSettings = {
  eventYear: number;
  showLength: number;
  maxTicketsPerUser: number;
  maxTicketsPerJuniorUser: number;
  juniorReleaseOpen: boolean;
  ticketIssuingEnabled: boolean;
  activeTicketTypeIds: number[];
  defaultClassTotalCapacity: number;
  defaultClassJuniorCapacity: number;
  defaultGymCapacity: number;
};

type TicketTypeControlValue =
  'open' | 'only-own' | 'public-rehearsals' | 'auto' | 'off';

type TicketTypeControlKey =
  | 'classInvite'
  | 'rehearsalInvite'
  | 'gymInvite'
  | 'entryOnly'
  | 'sameDayClass'
  | 'sameDayGym'
  | 'juniorClass'
  | 'juniorGym'
  | 'juniorEntryOnly';

type TicketTypeControls = Record<TicketTypeControlKey, TicketTypeControlValue>;

const TICKET_TYPE_IDS = {
  classInvite: 1,
  rehearsalInvite: 2,
  gymInvite: 3,
  entryOnly: 4,
  sameDayClass: 8,
  sameDayGym: 9,
  juniorClass: 5,
  juniorGym: 6,
  juniorEntryOnly: 7,
} as const;

const DEFAULT_TICKET_TYPE_CONTROLS: TicketTypeControls = {
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

const buildActiveTicketTypeIds = (controls: TicketTypeControls): number[] => {
  const activeIds = new Set<number>();
  if (controls.classInvite !== 'off') {
    activeIds.add(TICKET_TYPE_IDS.classInvite);
  }
  if (controls.rehearsalInvite !== 'off') {
    activeIds.add(TICKET_TYPE_IDS.rehearsalInvite);
  }
  if (controls.gymInvite !== 'off') {
    activeIds.add(TICKET_TYPE_IDS.gymInvite);
  }
  if (controls.entryOnly !== 'off') {
    activeIds.add(TICKET_TYPE_IDS.entryOnly);
  }
  if (controls.sameDayClass !== 'off') {
    activeIds.add(TICKET_TYPE_IDS.sameDayClass);
  }
  if (controls.sameDayGym !== 'off') {
    activeIds.add(TICKET_TYPE_IDS.sameDayGym);
  }
  if (controls.juniorClass !== 'off') {
    activeIds.add(TICKET_TYPE_IDS.juniorClass);
  }
  if (controls.juniorGym !== 'off') {
    activeIds.add(TICKET_TYPE_IDS.juniorGym);
  }
  if (controls.juniorEntryOnly !== 'off') {
    activeIds.add(TICKET_TYPE_IDS.juniorEntryOnly);
  }
  return Array.from(activeIds);
};

const mapActiveIdsToTicketTypeControls = (
  activeTicketTypeIds: number[],
): TicketTypeControls => {
  const activeIdSet = new Set(activeTicketTypeIds);
  return {
    classInvite: activeIdSet.has(TICKET_TYPE_IDS.classInvite) ? 'open' : 'off',
    rehearsalInvite: activeIdSet.has(TICKET_TYPE_IDS.rehearsalInvite)
      ? 'open'
      : 'off',
    gymInvite: activeIdSet.has(TICKET_TYPE_IDS.gymInvite) ? 'open' : 'off',
    entryOnly: activeIdSet.has(TICKET_TYPE_IDS.entryOnly) ? 'open' : 'off',
    sameDayClass: activeIdSet.has(TICKET_TYPE_IDS.sameDayClass)
      ? 'open'
      : 'off',
    sameDayGym: activeIdSet.has(TICKET_TYPE_IDS.sameDayGym) ? 'open' : 'off',
    juniorClass: activeIdSet.has(TICKET_TYPE_IDS.juniorClass) ? 'open' : 'off',
    juniorGym: activeIdSet.has(TICKET_TYPE_IDS.juniorGym) ? 'open' : 'off',
    juniorEntryOnly: activeIdSet.has(TICKET_TYPE_IDS.juniorEntryOnly)
      ? 'open'
      : 'off',
  };
};

const isTicketTypeControlValue = (
  value: unknown,
): value is TicketTypeControlValue =>
  value === 'open' ||
  value === 'only-own' ||
  value === 'public-rehearsals' ||
  value === 'auto' ||
  value === 'off';

const NUMERIC_SETTING_META = {
  eventYear: { label: '年度', min: 2020, max: 2100 },
  showLength: { label: '1公演の長さ（分）', min: 1, max: 300 },
  maxTicketsPerUser: { label: '1人あたりのチケット購入上限', min: 1, max: 100 },
  maxTicketsPerJuniorUser: {
    label: '中学生のチケット購入上限',
    min: 1,
    max: 100,
  },
  defaultClassTotalCapacity: {
    label: 'クラス公演の定員(合計)',
    min: 1,
    max: 1000,
  },
  defaultClassJuniorCapacity: {
    label: 'クラス公演の中学生枠',
    min: 0,
    max: 1000,
  },
  defaultGymCapacity: { label: '体育館公演の定員', min: 1, max: 2000 },
} as const;

type NumericSettingKey = keyof typeof NUMERIC_SETTING_META;
type SettingsMessageScope =
  | 'modal'
  | 'globalSection'
  | 'ticketSection'
  | 'detailSection'
  | 'deletionTool'
  | null;
type AccountDeletionType = 'student' | 'junior';

const SettingsContent = () => {
  const { config } = useEventConfig();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [passwordChangeError, setPasswordChangeError] = useState<string | null>(
    null,
  );
  const [passwordChangeSuccess, setPasswordChangeSuccess] = useState<
    string | null
  >(null);
  const [settings, setSettings] = useState<ControlPanelSettings>({
    eventYear: 2025,
    showLength: 60,
    maxTicketsPerUser: 20,
    maxTicketsPerJuniorUser: 2,
    juniorReleaseOpen: false,
    ticketIssuingEnabled: true,
    activeTicketTypeIds: [
      TICKET_TYPE_IDS.classInvite,
      TICKET_TYPE_IDS.rehearsalInvite,
      TICKET_TYPE_IDS.gymInvite,
      TICKET_TYPE_IDS.entryOnly,
      TICKET_TYPE_IDS.sameDayClass,
      TICKET_TYPE_IDS.sameDayGym,
    ],
    defaultClassTotalCapacity: 40,
    defaultClassJuniorCapacity: 5,
    defaultGymCapacity: 300,
  });
  const [ticketTypeControls, setTicketTypeControls] =
    useState<TicketTypeControls>(DEFAULT_TICKET_TYPE_CONTROLS);
  const [isSettingsLoading, setIsSettingsLoading] = useState(false);
  const [isSyncingSetting, setIsSyncingSetting] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [settingsSuccess, setSettingsSuccess] = useState<string | null>(null);
  const [settingsMessageScope, setSettingsMessageScope] =
    useState<SettingsMessageScope>(null);
  const [classPerformances, setClassPerformances] = useState<
    {
      id: number;
      class_name: string;
      is_accepting: boolean;
      total_capacity: number;
      junior_capacity: number;
    }[]
  >([]);
  const [gymPerformances, setGymPerformances] = useState<
    {
      id: number;
      group_name: string;
      round_name: string;
      is_accepting: boolean;
      capacity: number;
    }[]
  >([]);
  const [schedules, setSchedules] = useState<
    { id: number; round_name: string; is_active: boolean }[]
  >([]);
  const [relationships, setRelationships] = useState<
    { id: number; name: string; is_accepting: boolean }[]
  >([]);
  const [editingNumericKey, setEditingNumericKey] =
    useState<NumericSettingKey | null>(null);
  const [editingNumericValue, setEditingNumericValue] = useState('');
  const [editingPerformanceInfo, setEditingPerformanceInfo] = useState<{
    table: 'class_performances' | 'gym_performances';
    id: number;
    column: string;
    label: string;
    min: number;
    max: number;
  } | null>(null);
  const [activeDetailTab, setActiveDetailTab] = useState<
    'performances' | 'gym_performances' | 'schedules' | 'relationships'
  >('performances');
  const [isModalSubmitting, setIsModalSubmitting] = useState(false);
  const [juniorPassword, setJuniorPassword] = useState('');
  const [juniorPasswordConfirm, setJuniorPasswordConfirm] = useState('');
  const [hasJuniorPassword, setHasJuniorPassword] = useState(false);
  const [isUpdatingJuniorPassword, setIsUpdatingJuniorPassword] =
    useState(false);
  const [juniorPasswordError, setJuniorPasswordError] = useState<string | null>(
    null,
  );
  const [juniorPasswordSuccess, setJuniorPasswordSuccess] = useState<
    string | null
  >(null);

  useTitle('コントロールパネル - 管理画面');

  const handlePasswordChange = async (event: Event) => {
    setSettingsMessageScope(null); // Clear any previous messages

    event.preventDefault();
    setPasswordChangeError(null);
    setPasswordChangeSuccess(null);

    if (newPassword.length < 8) {
      setPasswordChangeError('新しいパスワードは8文字以上で入力してください。');
      return;
    }

    if (newPassword !== confirmNewPassword) {
      setPasswordChangeError(
        '新しいパスワードと確認用パスワードが一致しません。',
      );
      return;
    }

    setIsChangingPassword(true);

    try {
      const { data, error } = await supabase.functions.invoke('admin-auth', {
        body: {
          action: 'changePassword',
          currentPassword,
          newPassword,
        },
        headers: {
          'x-admin-session-token': getSessionToken() ?? '',
        },
      });

      if (error) {
        throw error;
      }

      if (!data?.changed) {
        setPasswordChangeError(
          'パスワード変更に失敗しました。時間をおいて再度お試しください。',
        );
        return;
      }

      setCurrentPassword('');
      setNewPassword('');
      setConfirmNewPassword('');
      setPasswordChangeSuccess('管理者パスワードを変更しました。');
    } catch (error) {
      const message = await readErrorMessage(error);
      setPasswordChangeError(`パスワード変更に失敗しました。${message}`);
    } finally {
      setIsChangingPassword(false);
    }
  };

  const [showDeleteAllAccountsModal, setShowDeleteAllAccountsModal] =
    useState(false);
  const [showDeleteAllTicketsModal, setShowDeleteAllTicketsModal] =
    useState(false);
  const [pendingDeleteAccountType, setPendingDeleteAccountType] =
    useState<AccountDeletionType>('student');
  const [isDeletingAllAccounts, setIsDeletingAllAccounts] = useState(false);
  const [isDeletingAllTickets, setIsDeletingAllTickets] = useState(false);

  const handleDeleteAllAccounts = async () => {
    setSettingsMessageScope('deletionTool');
    setSettingsError(null);
    setSettingsSuccess(null);
    setIsDeletingAllAccounts(true);
    setShowDeleteAllAccountsModal(false);
    let totalDeletedSoFar = 0;
    const accountType = pendingDeleteAccountType;
    const accountLabel =
      accountType === 'student' ? '生徒アカウント' : '中学生アカウント';

    try {
      const token = getSessionToken();
      if (!token) {
        throw new Error('セッションがありません。再ログインしてください。');
      }

      while (true) {
        const { data, error } = await supabase.functions.invoke('admin-auth', {
          body: {
            action: 'deleteAccountsByType',
            accountType,
          },
          headers: {
            'x-admin-session-token': token,
          },
        });

        if (error) {
          throw error;
        }

        if (!data?.deleted) {
          throw new Error('削除に失敗しました。');
        }

        totalDeletedSoFar += data.count;

        if (data.remaining > 0) {
          setSettingsSuccess(
            `${accountLabel}を現在 ${totalDeletedSoFar} 件削除しました。5秒後に次のバッチを開始します...`,
          );
          await new Promise((resolve) => setTimeout(resolve, 5000));
        } else {
          break;
        }
      }

      setSettingsSuccess(
        `合計 ${totalDeletedSoFar} 件の${accountLabel}を削除しました。`,
      );
    } catch (error) {
      const message = await readErrorMessage(error);
      setSettingsError(`${accountLabel}の削除に失敗しました。${message}`);
    } finally {
      setIsDeletingAllAccounts(false);
      // 削除後、生徒アカウント管理ページの一覧を更新する必要があるが、
      // ここでは直接的な更新は行わず、ユーザーに手動更新を促すか、
      // ページ遷移を推奨する。
    }
  };

  const handleDeleteAllTickets = async () => {
    setSettingsMessageScope('deletionTool');
    setSettingsError(null);
    setSettingsSuccess(null);
    setIsDeletingAllTickets(true);
    setShowDeleteAllTicketsModal(false);

    try {
      const token = getSessionToken();
      if (!token) {
        throw new Error('セッションがありません。再ログインしてください。');
      }

      const { data, error } = await supabase.functions.invoke('admin-auth', {
        body: {
          action: 'deleteAllTicketsAndResetCounters',
        },
        headers: {
          'x-admin-session-token': token,
        },
      });

      if (error) {
        throw error;
      }

      if (!data?.deleted || !data?.countersReset) {
        throw new Error('チケット削除またはカウンターリセットに失敗しました。');
      }

      const deletedTicketCount =
        typeof data.deletedTicketCount === 'number'
          ? data.deletedTicketCount
          : 0;
      setSettingsSuccess(
        `合計 ${deletedTicketCount} 件のチケットを削除し、カウンターをリセットしました。`,
      );
    } catch (error) {
      const message = await readErrorMessage(error);
      setSettingsError(
        `チケット削除とカウンターリセットに失敗しました。${message}`,
      );
    } finally {
      setIsDeletingAllTickets(false);
    }
  };

  useEffect(() => {
    let isActive = true;
    const token = getSessionToken();
    if (!token) {
      return;
    }

    const loadSettings = async () => {
      setIsSettingsLoading(true);
      setSettingsError(null);
      setSettingsSuccess(null);
      setSettingsMessageScope(null);

      try {
        const { data, error } = await supabase.functions.invoke('admin-auth', {
          body: { action: 'getSettings' },
          headers: {
            'x-admin-session-token': token,
          },
        });

        if (error) {
          throw error;
        }

        const nextSettings = data?.settings;
        if (
          !nextSettings ||
          typeof nextSettings.eventYear !== 'number' ||
          typeof nextSettings.showLength !== 'number' ||
          typeof nextSettings.maxTicketsPerUser !== 'number' ||
          typeof nextSettings.juniorReleaseOpen !== 'boolean' ||
          typeof nextSettings.ticketIssuingEnabled !== 'boolean' ||
          typeof nextSettings.defaultClassTotalCapacity !== 'number' ||
          typeof nextSettings.defaultClassJuniorCapacity !== 'number' ||
          typeof nextSettings.defaultGymCapacity !== 'number' ||
          !Array.isArray(nextSettings.activeTicketTypeIds)
        ) {
          throw new Error('設定データの形式が不正です。');
        }

        if (isActive) {
          // テーブルデータのフェッチ
          const [
            { data: cp },
            { data: gp },
            { data: sch },
            { data: rel },
            { data: jp },
          ] = await Promise.all([
            supabase
              .from('class_performances')
              .select(
                'id, class_name, is_accepting, total_capacity, junior_capacity',
              )
              .order('class_name'),
            supabase
              .from('gym_performances')
              .select('id, group_name, round_name, is_accepting, capacity')
              .order('id'),
            supabase
              .from('performances_schedule')
              .select('id, round_name, is_active')
              .order('id'),
            supabase
              .from('relationships')
              .select('id, name, is_accepting')
              .order('id'),
            supabase.functions.invoke('admin-auth', {
              body: { action: 'getJuniorPassword' },
              headers: {
                'x-admin-session-token': token,
              },
            }),
          ]);

          if (cp) {
            setClassPerformances(cp);
          }
          if (gp) {
            setGymPerformances(gp);
          }
          if (sch) {
            setSchedules(sch);
          }
          if (rel) {
            setRelationships(rel);
          }
          if (jp && !jp.error) {
            setHasJuniorPassword(jp.hasPassword || false);
          }

          const activeTicketTypeIds = nextSettings.activeTicketTypeIds
            .filter((id: unknown) => typeof id === 'number')
            .map((id: number) => Math.trunc(id));
          const controlsFromApi = nextSettings.ticketIssueModes;
          const nextControls: TicketTypeControls =
            controlsFromApi &&
            typeof controlsFromApi === 'object' &&
            isTicketTypeControlValue(
              (controlsFromApi as Record<string, unknown>).classInvite,
            ) &&
            isTicketTypeControlValue(
              (controlsFromApi as Record<string, unknown>).rehearsalInvite,
            ) &&
            isTicketTypeControlValue(
              (controlsFromApi as Record<string, unknown>).gymInvite,
            ) &&
            isTicketTypeControlValue(
              (controlsFromApi as Record<string, unknown>).entryOnly,
            ) &&
            isTicketTypeControlValue(
              (controlsFromApi as Record<string, unknown>).sameDayClass,
            ) &&
            isTicketTypeControlValue(
              (controlsFromApi as Record<string, unknown>).sameDayGym,
            ) &&
            isTicketTypeControlValue(
              (controlsFromApi as Record<string, unknown>).juniorClass,
            ) &&
            isTicketTypeControlValue(
              (controlsFromApi as Record<string, unknown>).juniorGym,
            ) &&
            isTicketTypeControlValue(
              (controlsFromApi as Record<string, unknown>).juniorEntryOnly,
            )
              ? {
                  classInvite: (
                    controlsFromApi as Record<string, TicketTypeControlValue>
                  ).classInvite,
                  rehearsalInvite: (
                    controlsFromApi as Record<string, TicketTypeControlValue>
                  ).rehearsalInvite,
                  gymInvite: (
                    controlsFromApi as Record<string, TicketTypeControlValue>
                  ).gymInvite,
                  entryOnly: (
                    controlsFromApi as Record<string, TicketTypeControlValue>
                  ).entryOnly,
                  sameDayClass: (
                    controlsFromApi as Record<string, TicketTypeControlValue>
                  ).sameDayClass,
                  sameDayGym: (
                    controlsFromApi as Record<string, TicketTypeControlValue>
                  ).sameDayGym,
                  juniorClass: (
                    controlsFromApi as Record<string, TicketTypeControlValue>
                  ).juniorClass,
                  juniorGym: (
                    controlsFromApi as Record<string, TicketTypeControlValue>
                  ).juniorGym,
                  juniorEntryOnly: (
                    controlsFromApi as Record<string, TicketTypeControlValue>
                  ).juniorEntryOnly,
                }
              : mapActiveIdsToTicketTypeControls(activeTicketTypeIds);
          setSettings({
            ...nextSettings,
            activeTicketTypeIds,
          });
          setTicketTypeControls(nextControls);
        }
      } catch (error) {
        const message = await readErrorMessage(error);
        if (isActive) {
          setSettingsMessageScope('globalSection');
          setSettingsError(`設定の読み込みに失敗しました。${message}`);
        }
      } finally {
        if (isActive) {
          setIsSettingsLoading(false);
        }
      }
    };

    void loadSettings();

    return () => {
      isActive = false;
    };
  }, []);

  const syncSettings = async (
    nextSettings: ControlPanelSettings,
    successMessage = '設定を更新しました。',
    messageScope: Exclude<SettingsMessageScope, null> = 'ticketSection',
  ) => {
    const token = getSessionToken();
    if (!token) {
      setSettingsMessageScope(messageScope);
      setSettingsError('セッションがありません。再ログインしてください。');
      return false;
    }

    setSettingsMessageScope(messageScope);
    setSettingsError(null);
    setSettingsSuccess(null);
    setIsSyncingSetting(true);

    try {
      const { data, error } = await supabase.functions.invoke('admin-auth', {
        body: {
          action: 'updateSettings',
          eventYear: nextSettings.eventYear,
          showLength: nextSettings.showLength,
          maxTicketsPerUser: nextSettings.maxTicketsPerUser,
          maxTicketsPerJuniorUser: nextSettings.maxTicketsPerJuniorUser,
          juniorReleaseOpen: nextSettings.juniorReleaseOpen,
          ticketIssuingEnabled: nextSettings.ticketIssuingEnabled,
          defaultClassTotalCapacity: nextSettings.defaultClassTotalCapacity,
          defaultClassJuniorCapacity: nextSettings.defaultClassJuniorCapacity,
          defaultGymCapacity: nextSettings.defaultGymCapacity,
        },
        headers: {
          'x-admin-session-token': token,
        },
      });

      if (error) {
        throw error;
      }

      if (!data?.updated) {
        throw new Error('設定の保存に失敗しました。');
      }

      setSettings(nextSettings);
      setSettingsSuccess(successMessage);
      return true;
    } catch (error) {
      const message = await readErrorMessage(error);
      setSettingsError(`設定の保存に失敗しました。${message}`);
      return false;
    } finally {
      setIsSyncingSetting(false);
    }
  };

  const handleToggleTableValue = async (
    table:
      | 'class_performances'
      | 'gym_performances'
      | 'performances_schedule'
      | 'relationships',
    id: number,
    column: string,
    nextValue: boolean | number,
    messageScope: SettingsMessageScope = 'globalSection',
  ): Promise<boolean> => {
    if (isSettingsLoading || isSyncingSetting) {
      return false;
    }

    const token = getSessionToken();
    if (!token) {
      setSettingsError('セッションがありません。再ログインしてください。');
      return false;
    }

    setSettingsError(null);
    setSettingsSuccess(null);
    setSettingsMessageScope(messageScope);
    setIsSyncingSetting(true);

    try {
      const { error } = await supabase.functions.invoke('admin-auth', {
        body: {
          action: 'updateAcceptingStatus',
          table,
          recordId: id,
          column,
          value: nextValue,
        },
        headers: {
          'x-admin-session-token': token,
        },
      });

      if (error) {
        throw error;
      }

      // ローカルステートの更新
      if (table === 'class_performances') {
        setClassPerformances((prev) =>
          prev.map((p) =>
            p.id === id ? ({ ...p, [column]: nextValue } as typeof p) : p,
          ),
        );
      } else if (table === 'gym_performances') {
        setGymPerformances((prev) =>
          prev.map((p) =>
            p.id === id ? ({ ...p, [column]: nextValue } as typeof p) : p,
          ),
        );
      } else if (table === 'performances_schedule') {
        setSchedules((prev) =>
          prev.map((s) =>
            s.id === id ? { ...s, is_active: nextValue as boolean } : s,
          ),
        );
      } else if (table === 'relationships') {
        setRelationships((prev) =>
          prev.map((r) =>
            r.id === id ? { ...r, is_accepting: nextValue as boolean } : r,
          ),
        );
      }
      setSettingsSuccess('設定を更新しました。');
      return true;
    } catch (error) {
      const message = await readErrorMessage(error);
      setSettingsError(`設定の保存に失敗しました。${message}`);
      return false;
    } finally {
      setIsSyncingSetting(false);
    }
  };

  const syncTicketTypeControls = async (
    nextControls: TicketTypeControls,
    successMessage = '券種別の受付設定を更新しました。',
  ) => {
    const token = getSessionToken();
    if (!token) {
      setSettingsMessageScope('ticketSection');
      setSettingsError('セッションがありません。再ログインしてください。');
      return false;
    }

    const activeTicketTypeIds = buildActiveTicketTypeIds(nextControls);
    const previousActiveTicketTypeIds = settings.activeTicketTypeIds;

    setSettingsMessageScope('ticketSection');
    setSettingsError(null);
    setSettingsSuccess(null);
    setIsSyncingSetting(true);

    setSettings((prev) => ({
      ...prev,
      activeTicketTypeIds,
    }));

    try {
      const { data, error } = await supabase.functions.invoke('admin-auth', {
        body: {
          action: 'updateTicketTypeSettings',
          activeTicketTypeIds,
          ticketIssueModes: {
            classInvite: nextControls.classInvite,
            rehearsalInvite: nextControls.rehearsalInvite,
            gymInvite: nextControls.gymInvite,
            entryOnly: nextControls.entryOnly,
            sameDayClass: nextControls.sameDayClass,
            sameDayGym: nextControls.sameDayGym,
            juniorClass: nextControls.juniorClass,
            juniorGym: nextControls.juniorGym,
            juniorEntryOnly: nextControls.juniorEntryOnly,
          },
        },
        headers: {
          'x-admin-session-token': token,
        },
      });

      if (error) {
        throw error;
      }

      if (!data?.updated) {
        throw new Error('券種別設定の保存に失敗しました。');
      }

      setSettingsSuccess(successMessage);
      return true;
    } catch (error) {
      const message = await readErrorMessage(error);
      setSettingsError(`券種別設定の保存に失敗しました。${message}`);
      setSettings((prev) => ({
        ...prev,
        activeTicketTypeIds: previousActiveTicketTypeIds,
      }));
      return false;
    } finally {
      setIsSyncingSetting(false);
    }
  };

  const openNumericEditModal = (key: NumericSettingKey) => {
    setEditingNumericKey(key);
    setEditingNumericValue(String(settings[key]));
    setSettingsMessageScope('modal');
    setSettingsError(null);
    setSettingsSuccess(null);
  };

  const openIndividualNumericEditModal = (
    table: 'class_performances' | 'gym_performances',
    id: number,
    column: string,
    label: string,
    min: number,
    max: number,
    currentValue: number,
  ) => {
    setEditingPerformanceInfo({ table, id, column, label, min, max });
    setEditingNumericValue(String(currentValue));
    setSettingsMessageScope('modal');
    setSettingsError(null);
    setSettingsSuccess(null);
  };

  const closeNumericEditModal = () => {
    setEditingNumericKey(null);
    setEditingPerformanceInfo(null);
    setEditingNumericValue('');
    setSettingsMessageScope(null);
    setSettingsError(null);
    setSettingsSuccess(null);
  };

  const handleConfirmNumericEdit = async () => {
    if (editingPerformanceInfo) {
      const { table, id, column, label, min, max } = editingPerformanceInfo;
      const parsed = Number(editingNumericValue);
      if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
        setSettingsError(
          `${label}は${min}〜${max}の範囲の整数で入力してください。`,
        );
        return;
      }

      // 個別クラス設定：中学生枠と合計定員の整合性チェック
      if (table === 'class_performances') {
        const targetPerf = classPerformances.find((p) => p.id === id);
        if (targetPerf) {
          if (
            column === 'total_capacity' &&
            parsed < targetPerf.junior_capacity
          ) {
            setSettingsError(
              '合計定員は現在の中学生枠より少なく設定できません。',
            );
            return;
          }
          if (
            column === 'junior_capacity' &&
            parsed > targetPerf.total_capacity
          ) {
            setSettingsError(
              '中学生枠は現在の合計定員より多く設定できません。',
            );
            return;
          }
        }
      }

      setIsModalSubmitting(true);
      const success = await handleToggleTableValue(
        table,
        id,
        column,
        parsed,
        'detailSection',
      );
      setIsModalSubmitting(false);
      if (success) {
        closeNumericEditModal();
      }
      return;
    }

    if (!editingNumericKey) {
      return;
    }

    const key = editingNumericKey;
    const meta = NUMERIC_SETTING_META[key];
    const parsed = Number(editingNumericValue);
    if (!Number.isInteger(parsed) || parsed < meta.min || parsed > meta.max) {
      setSettingsError(
        `${meta.label}は${meta.min}〜${meta.max}の範囲の整数で入力してください。`,
      );
      return;
    }

    // 全体デフォルト設定：中学生枠と合計定員の整合性チェック
    if (
      key === 'defaultClassTotalCapacity' &&
      parsed < settings.defaultClassJuniorCapacity
    ) {
      setSettingsError(
        '合計定員のデフォルト値は現在の中学生枠のデフォルト値より少なく設定できません。',
      );
      return;
    }
    if (
      key === 'defaultClassJuniorCapacity' &&
      parsed > settings.defaultClassTotalCapacity
    ) {
      setSettingsError(
        '中学生枠のデフォルト値は現在の合計定員のデフォルト値より多く設定できません。',
      );
      return;
    }
    setIsModalSubmitting(true);
    const nextSettings = { ...settings, [key]: parsed };
    const success = await syncSettings(
      nextSettings,
      `${meta.label}を更新しました。`,
      key === 'eventYear' || key === 'showLength'
        ? 'globalSection'
        : 'ticketSection',
    );
    setIsModalSubmitting(false);
    if (success) {
      closeNumericEditModal();
    }
  };

  const handleTicketTypeControlChange = (
    key: TicketTypeControlKey,
    nextValue: TicketTypeControlValue,
  ) => {
    if (isSettingsLoading || isSyncingSetting) {
      return;
    }

    const previousControls = ticketTypeControls;
    const nextControls: TicketTypeControls = {
      ...previousControls,
      [key]: nextValue,
    };
    setTicketTypeControls(nextControls);

    const labelByKey: Record<TicketTypeControlKey, string> = {
      classInvite: '招待券(クラス公演)受付',
      rehearsalInvite: '招待券(リハーサル)受付',
      gymInvite: '招待券(体育館公演)受付',
      entryOnly: '招待券(入場専用券)受付',
      sameDayClass: '当日券(クラス公演)受付',
      sameDayGym: '当日券(体育館公演)受付',
      juniorClass: '中学生券(クラス公演)受付',
      juniorGym: '中学生券(体育館公演)受付',
      juniorEntryOnly: '中学生券(入場専用券)受付',
    };

    void syncTicketTypeControls(
      nextControls,
      `${labelByKey[key]}を更新しました。`,
    ).then((updated) => {
      if (!updated) {
        setTicketTypeControls(previousControls);
      }
    });
  };

  const handleJuniorPasswordUpdate = async (event: Event) => {
    event.preventDefault();
    setJuniorPasswordError(null);
    setJuniorPasswordSuccess(null);

    if (juniorPassword.length < 4) {
      setJuniorPasswordError('合言葉は4文字以上で入力してください。');
      return;
    }

    if (juniorPassword !== juniorPasswordConfirm) {
      setJuniorPasswordError('合言葉と確認用合言葉が一致しません。');
      return;
    }

    setIsUpdatingJuniorPassword(true);

    try {
      const token = getSessionToken();
      if (!token) {
        throw new Error('セッションがありません。再ログインしてください。');
      }

      const { data, error } = await supabase.functions.invoke('admin-auth', {
        body: {
          action: 'updateJuniorPassword',
          juniorPassword,
        },
        headers: {
          'x-admin-session-token': token,
        },
      });

      if (error) {
        throw error;
      }

      if (!data?.updated) {
        throw new Error('合言葉の更新に失敗しました。');
      }

      setJuniorPassword('');
      setJuniorPasswordConfirm('');
      setHasJuniorPassword(true);
      setJuniorPasswordSuccess('合言葉を更新しました。');
    } catch (error) {
      const message = await readErrorMessage(error);
      setJuniorPasswordError(`合言葉の更新に失敗しました。${message}`);
    } finally {
      setIsUpdatingJuniorPassword(false);
    }
  };

  return (
    <div>
      {!isSettingsLoading && settings.eventYear !== config.year && (
        <Alert type='error'>
          <p>
            Supabase側の設定年度 ({settings.eventYear}) と、 config.yamlの年度 (
            {config.year}) が一致していません。
            不具合の原因となるため、忘れずにconfig.yamlの年度を更新してください。
          </p>
        </Alert>
      )}
      <Alert type='warning'>
        <p>
          このページはシステム全体に影響を与えます。設定変更には十分ご注意ください。
        </p>
      </Alert>
      <NormalSection>
        <h2>全体</h2>
        <div className={styles.formGrid}>
          <div className={styles.field}>
            <div className={styles.settingLabelGroup}>
              <label
                className={styles.settingLabel}
                htmlFor='settings-event-year'
              >
                年度
              </label>
              <p className={styles.settingHint}>
                ここでの変更はチケットの年度情報のみ適用されます
              </p>
            </div>
            <div className={styles.settingControlGroup}>
              <span id='settings-event-year' className={styles.fieldValue}>
                {settings.eventYear}
              </span>
              <button
                type='button'
                className={styles.inlineEditButton}
                onClick={() => openNumericEditModal('eventYear')}
                disabled={isSettingsLoading || isSyncingSetting}
              >
                変更する
              </button>
            </div>
          </div>
          <div className={styles.field}>
            <label
              className={styles.settingLabel}
              htmlFor='settings-show-length-minutes'
            >
              1公演の長さ（分）
            </label>
            <div className={styles.settingControlGroup}>
              <span
                id='settings-show-length-minutes'
                className={styles.fieldValue}
              >
                {settings.showLength}
              </span>
              <button
                type='button'
                className={styles.inlineEditButton}
                onClick={() => openNumericEditModal('showLength')}
                disabled={isSettingsLoading || isSyncingSetting}
              >
                変更する
              </button>
            </div>
          </div>
        </div>
        {settingsMessageScope === 'globalSection' && isSettingsLoading && (
          <LoadingSpinner message='設定を読み込み中です...' />
        )}
        {settingsMessageScope === 'globalSection' && settingsError && (
          <p className={styles.authError}>{settingsError}</p>
        )}
        {settingsMessageScope === 'globalSection' && settingsSuccess && (
          <p className={styles.authSuccess}>{settingsSuccess}</p>
        )}
      </NormalSection>

      <NormalSection>
        <h2>生徒アカウント管理</h2>
        <p className={styles.noteText}>
          学年・クラス・出席番号の全組み合わせに対するログインアカウントを一括生成し、Authへ登録します。
        </p>
        <a href='/admin/student-accounts' className={styles.linkButton}>
          こちらで変更
        </a>
      </NormalSection>

      <NormalSection>
        <h2>中学生アカウント管理</h2>
        <p className={styles.noteText}>
          csvファイルから、中学生アカウントのIDとパスワードを一括でAuthへ登録します。
        </p>
        <a href='/admin/junior-accounts' className={styles.linkButton}>
          こちらで変更
        </a>
      </NormalSection>

      <NormalSection>
        <h2>中学生用合言葉設定</h2>
        <p className={styles.noteText}>
          中学生アカウント登録時に必要な合言葉を設定します。
        </p>
        <div className={styles.formGroup}>
          <label className={styles.settingLabel}>現在の合言葉設定</label>
          <p className={styles.fieldValue}>
            {hasJuniorPassword ? '設定済み' : '未設定'}
          </p>
        </div>
        <form onSubmit={handleJuniorPasswordUpdate}>
          <div className={styles.formGroup}>
            <label htmlFor='junior-password' className={styles.label}>
              新しい合言葉
            </label>
            <input
              id='junior-password'
              type='text'
              className={styles.input}
              value={juniorPassword}
              onChange={(e) => setJuniorPassword(e.currentTarget.value)}
              placeholder='4文字以上の合言葉'
              minLength={4}
              required
            />
          </div>
          <div className={styles.formGroup}>
            <label htmlFor='junior-password-confirm' className={styles.label}>
              合言葉（確認）
            </label>
            <input
              id='junior-password-confirm'
              type='text'
              className={styles.input}
              value={juniorPasswordConfirm}
              onChange={(e) => setJuniorPasswordConfirm(e.currentTarget.value)}
              placeholder='同じ合言葉を再度入力'
              minLength={4}
              required
            />
          </div>
          {juniorPasswordError && (
            <p className={styles.authError}>{juniorPasswordError}</p>
          )}
          {juniorPasswordSuccess && (
            <p className={styles.authSuccess}>{juniorPasswordSuccess}</p>
          )}
          <button
            type='submit'
            className={styles.submitButton}
            disabled={isUpdatingJuniorPassword}
          >
            {isUpdatingJuniorPassword ? '更新中...' : '合言葉を更新'}
          </button>
        </form>
      </NormalSection>

      <NormalSection>
        <h2>公演空き状況</h2>
        <h3>クラス公演</h3>
        <PerformancesTable showToggleRemainingMode={true} />
        <h3>体育館公演</h3>
        <GymPerformancesTable />
      </NormalSection>
      <NormalSection>
        <h2>チケット発券</h2>
        <div className={styles.formGrid}>
          <div>
            <h3>券種別の受付設定</h3>
            <div className={styles.field}>
              <label className={styles.settingLabel}>チケット発券全体</label>
              <label>
                <Switch
                  id='ticket-issuing-enabled'
                  onChange={(checked: boolean) => {
                    if (isSettingsLoading || isSyncingSetting) {
                      return;
                    }

                    setSettings((prev) => {
                      const next = { ...prev, ticketIssuingEnabled: checked };
                      void syncSettings(
                        next,
                        checked
                          ? 'チケット発券を有効化しました。'
                          : 'チケット発券を停止しました。',
                        'ticketSection',
                      ).then((updated) => {
                        if (!updated) {
                          setSettings((current) => ({
                            ...current,
                            ticketIssuingEnabled: prev.ticketIssuingEnabled,
                          }));
                        }
                      });
                      return next;
                    });
                  }}
                  checked={settings.ticketIssuingEnabled}
                />
              </label>
            </div>
            <div className={styles.field}>
              <label
                className={styles.settingLabel}
                htmlFor='ticket-class-invite'
              >
                招待券(クラス公演)受付
              </label>
              <select
                id='ticket-class-invite'
                className={styles.fieldControl}
                value={ticketTypeControls.classInvite}
                onChange={(event) =>
                  handleTicketTypeControlChange(
                    'classInvite',
                    (event.target as HTMLSelectElement)
                      .value as TicketTypeControlValue,
                  )
                }
                disabled={isSettingsLoading || isSyncingSetting}
              >
                <option value='open'>すべて</option>
                <option value='only-own'>自クラスのみ</option>
                <option value='off'>無効</option>
              </select>
            </div>
            <div className={styles.field}>
              <label
                className={styles.settingLabel}
                htmlFor='ticket-rehearsal-invite'
              >
                招待券(リハーサル)受付
              </label>
              <select
                id='ticket-rehearsal-invite'
                className={styles.fieldControl}
                value={ticketTypeControls.rehearsalInvite}
                onChange={(event) =>
                  handleTicketTypeControlChange(
                    'rehearsalInvite',
                    (event.target as HTMLSelectElement)
                      .value as TicketTypeControlValue,
                  )
                }
                disabled={isSettingsLoading || isSyncingSetting}
              >
                <option value='open'>すべて</option>
                <option value='public-rehearsals'>公開リハーサルのみ</option>
                <option value='off'>無効</option>
              </select>
            </div>
            <div className={styles.field}>
              <label
                className={styles.settingLabel}
                htmlFor='ticket-gym-invite'
              >
                招待券(体育館公演)受付
              </label>
              <select
                id='ticket-gym-invite'
                className={styles.fieldControl}
                value={ticketTypeControls.gymInvite}
                onChange={(event) =>
                  handleTicketTypeControlChange(
                    'gymInvite',
                    (event.target as HTMLSelectElement)
                      .value as TicketTypeControlValue,
                  )
                }
                disabled={isSettingsLoading || isSyncingSetting}
              >
                <option value='open'>すべて</option>
                <option value='only-own'>自部活のみ</option>
                <option value='off'>無効</option>
              </select>
            </div>
            <div className={styles.field}>
              <span className={styles.settingLabel}>
                招待券(入場専用券)受付
              </span>
              <label>
                <Switch
                  id='ticket-entry-only'
                  checked={ticketTypeControls.entryOnly === 'open'}
                  onChange={(checked) =>
                    handleTicketTypeControlChange(
                      'entryOnly',
                      checked ? 'open' : 'off',
                    )
                  }
                ></Switch>
              </label>
            </div>

            <div className={styles.field}>
              <label className={styles.settingLabel}>
                中学生券(クラス公演)受付
              </label>
              <label>
                <Switch
                  checked={ticketTypeControls.juniorClass === 'open'}
                  onChange={(checked) =>
                    handleTicketTypeControlChange(
                      'juniorClass',
                      checked ? 'open' : 'off',
                    )
                  }
                />
              </label>
            </div>
            <div className={styles.field}>
              <label className={styles.settingLabel}>
                中学生券(体育館公演)受付
              </label>
              <label>
                <Switch
                  checked={ticketTypeControls.juniorGym === 'open'}
                  onChange={(checked) =>
                    handleTicketTypeControlChange(
                      'juniorGym',
                      checked ? 'open' : 'off',
                    )
                  }
                />
              </label>
            </div>
            <div className={styles.field}>
              <label className={styles.settingLabel}>
                中学生券(入場専用)受付
              </label>
              <label>
                <Switch
                  checked={ticketTypeControls.juniorEntryOnly === 'open'}
                  onChange={(checked) =>
                    handleTicketTypeControlChange(
                      'juniorEntryOnly',
                      checked ? 'open' : 'off',
                    )
                  }
                />
              </label>
            </div>
            <div className={styles.field}>
              <label
                className={styles.settingLabel}
                htmlFor='ticket-same-day-class'
              >
                当日券(クラス公演)受付
              </label>
              <select
                id='ticket-same-day-class'
                className={styles.fieldControl}
                value={ticketTypeControls.sameDayClass}
                onChange={(event) =>
                  handleTicketTypeControlChange(
                    'sameDayClass',
                    (event.target as HTMLSelectElement)
                      .value as TicketTypeControlValue,
                  )
                }
                disabled={isSettingsLoading || isSyncingSetting}
              >
                <option value='open'>有効</option>
                <option value='auto'>当日のみ</option>
                <option value='off'>無効</option>
              </select>
            </div>
            <div className={styles.field}>
              <label
                className={styles.settingLabel}
                htmlFor='ticket-same-day-gym'
              >
                当日券(体育館公演)受付
              </label>
              <select
                id='ticket-same-day-gym'
                className={styles.fieldControl}
                value={ticketTypeControls.sameDayGym}
                onChange={(event) =>
                  handleTicketTypeControlChange(
                    'sameDayGym',
                    (event.target as HTMLSelectElement)
                      .value as TicketTypeControlValue,
                  )
                }
                disabled={isSettingsLoading || isSyncingSetting}
              >
                <option value='open'>有効</option>
                <option value='auto'>当日のみ</option>
                <option value='off'>無効</option>
              </select>
            </div>
          </div>
          <div>
            <h3>チケット数の受付設定</h3>
            <div className={styles.field}>
              <label
                className={styles.settingLabel}
                htmlFor='ticket-class-total'
              >
                クラス公演の1公演あたりのチケット数(中学生券含む)
              </label>
              <div className={styles.settingControlGroup}>
                <span id='ticket-class-total' className={styles.fieldValue}>
                  {settings.defaultClassTotalCapacity}
                </span>
                <button
                  type='button'
                  className={styles.inlineEditButton}
                  onClick={() =>
                    openNumericEditModal('defaultClassTotalCapacity')
                  }
                  disabled={isSettingsLoading || isSyncingSetting}
                >
                  変更する
                </button>
              </div>
            </div>
            <div className={styles.field}>
              <label
                className={styles.settingLabel}
                htmlFor='ticket-class-junior'
              >
                クラス公演の1公演あたり中学生枠
              </label>
              <div className={styles.settingControlGroup}>
                <span id='ticket-class-junior' className={styles.fieldValue}>
                  {settings.defaultClassJuniorCapacity}
                </span>
                <button
                  type='button'
                  className={styles.inlineEditButton}
                  onClick={() =>
                    openNumericEditModal('defaultClassJuniorCapacity')
                  }
                  disabled={isSettingsLoading || isSyncingSetting}
                >
                  変更する
                </button>
              </div>
            </div>
            <div className={styles.field}>
              <label className={styles.settingLabel} htmlFor='ticket-gym-total'>
                体育館公演の1公演あたりのチケット数
              </label>
              <div className={styles.settingControlGroup}>
                <span id='ticket-gym-total' className={styles.fieldValue}>
                  {settings.defaultGymCapacity}
                </span>
                <button
                  type='button'
                  className={styles.inlineEditButton}
                  onClick={() => openNumericEditModal('defaultGymCapacity')}
                  disabled={isSettingsLoading || isSyncingSetting}
                >
                  変更する
                </button>
              </div>
            </div>
          </div>
          <div>
            <h3>その他設定</h3>
            <div className={styles.field}>
              <label
                className={styles.settingLabel}
                htmlFor='ticket-max-per-user'
              >
                1人あたりのチケット発行上限
              </label>
              <div className={styles.settingControlGroup}>
                <span id='ticket-max-per-user' className={styles.fieldValue}>
                  {settings.maxTicketsPerUser}
                </span>
                <button
                  type='button'
                  className={styles.inlineEditButton}
                  onClick={() => openNumericEditModal('maxTicketsPerUser')}
                  disabled={isSettingsLoading || isSyncingSetting}
                >
                  変更する
                </button>
              </div>
            </div>
            <div className={styles.field}>
              <label
                className={styles.settingLabel}
                htmlFor='ticket-junior-max-per-user'
              >
                中学生のチケット発行上限
              </label>
              <div className={styles.settingControlGroup}>
                <span
                  id='ticket-junior-max-per-user'
                  className={styles.fieldValue}
                >
                  {settings.maxTicketsPerJuniorUser}
                </span>
                <button
                  type='button'
                  className={styles.inlineEditButton}
                  onClick={() =>
                    openNumericEditModal('maxTicketsPerJuniorUser')
                  }
                  disabled={isSettingsLoading || isSyncingSetting}
                >
                  変更する
                </button>
              </div>
            </div>
            <div className={styles.field}>
              <label className={styles.settingLabel}>中学生枠の一般解放</label>
              <label>
                <Switch
                  id='ticket-junior-release'
                  onChange={(checked: boolean) => {
                    if (isSettingsLoading || isSyncingSetting) {
                      return;
                    }

                    setSettings((prev) => {
                      const next = { ...prev, juniorReleaseOpen: checked };
                      // 非同期通信をバックグラウンドで実行
                      void syncSettings(
                        next,
                        '中学生枠の一般解放設定を更新しました。',
                        'ticketSection',
                      ).then((updated) => {
                        // 失敗した場合は以前の値を参照して戻す
                        if (!updated) {
                          setSettings((current) => ({
                            ...current,
                            juniorReleaseOpen: prev.juniorReleaseOpen,
                          }));
                        }
                      });
                      return next;
                    });
                  }}
                  checked={settings.juniorReleaseOpen}
                />
              </label>
            </div>
          </div>
        </div>
        {settingsMessageScope === 'ticketSection' && isSettingsLoading && (
          <LoadingSpinner message='設定を読み込み中です...' />
        )}
        {settingsMessageScope === 'ticketSection' && settingsError && (
          <p className={styles.authError}>{settingsError}</p>
        )}
        {settingsMessageScope === 'ticketSection' && settingsSuccess && (
          <p className={styles.authSuccess}>{settingsSuccess}</p>
        )}
      </NormalSection>
      <NormalSection>
        <h2>詳細な受付・有効設定</h2>
        <div className={styles.tabList} role='tablist'>
          <button
            type='button'
            role='tab'
            className={`${styles.tabButton} ${activeDetailTab === 'performances' ? styles.tabButtonActive : ''}`}
            aria-selected={activeDetailTab === 'performances'}
            onClick={() => setActiveDetailTab('performances')}
          >
            クラス
          </button>
          <button
            type='button'
            role='tab'
            className={`${styles.tabButton} ${activeDetailTab === 'gym_performances' ? styles.tabButtonActive : ''}`}
            aria-selected={activeDetailTab === 'gym_performances'}
            onClick={() => setActiveDetailTab('gym_performances')}
          >
            部活
          </button>
          <button
            type='button'
            role='tab'
            className={`${styles.tabButton} ${activeDetailTab === 'schedules' ? styles.tabButtonActive : ''}`}
            aria-selected={activeDetailTab === 'schedules'}
            onClick={() => setActiveDetailTab('schedules')}
          >
            公演回
          </button>
          <button
            type='button'
            role='tab'
            className={`${styles.tabButton} ${activeDetailTab === 'relationships' ? styles.tabButtonActive : ''}`}
            aria-selected={activeDetailTab === 'relationships'}
            onClick={() => setActiveDetailTab('relationships')}
          >
            間柄
          </button>
        </div>

        <div className={styles.tabContent}>
          {activeDetailTab === 'performances' && (
            <div className={styles.toggleList}>
              <h3>クラス公演の受付</h3>
              {classPerformances.map((p) => (
                <div key={`cp-${p.id}`} className={styles.field}>
                  <span className={styles.settingLabel}>{p.class_name}</span>
                  <div className={styles.settingControlGroup}>
                    <span className={styles.settingHint}>
                      定員: {p.total_capacity}名
                    </span>
                    <button
                      type='button'
                      className={styles.inlineEditButton}
                      onClick={(e) => {
                        e.preventDefault();
                        openIndividualNumericEditModal(
                          'class_performances',
                          p.id,
                          'total_capacity',
                          `${p.class_name}の合計定員`,
                          1,
                          1000,
                          p.total_capacity,
                        );
                      }}
                    >
                      変更
                    </button>
                    <span className={styles.settingHint}>
                      中学生: {p.junior_capacity}名
                    </span>
                    <button
                      type='button'
                      className={styles.inlineEditButton}
                      onClick={(e) => {
                        e.preventDefault();
                        openIndividualNumericEditModal(
                          'class_performances',
                          p.id,
                          'junior_capacity',
                          `${p.class_name}の中学生枠`,
                          0,
                          1000,
                          p.junior_capacity,
                        );
                      }}
                    >
                      変更
                    </button>
                    <label>
                      <Switch
                        checked={p.is_accepting}
                        onChange={(val) =>
                          handleToggleTableValue(
                            'class_performances',
                            p.id,
                            'is_accepting',
                            val,
                            'detailSection',
                          )
                        }
                      />
                    </label>
                  </div>
                </div>
              ))}
            </div>
          )}

          {activeDetailTab === 'gym_performances' && (
            <div className={styles.toggleList}>
              <h3>部活(体育館公演)の受付</h3>
              {gymPerformances.map((p) => (
                <div key={`gp-${p.id}`} className={styles.field}>
                  <span className={styles.settingLabel}>
                    {p.group_name} {p.round_name}
                  </span>
                  <div className={styles.settingControlGroup}>
                    <span className={styles.settingHint}>
                      定員: {p.capacity}名
                    </span>
                    <button
                      type='button'
                      className={styles.inlineEditButton}
                      onClick={(e) => {
                        e.preventDefault();
                        openIndividualNumericEditModal(
                          'gym_performances',
                          p.id,
                          'capacity',
                          `${p.group_name} ${p.round_name}の定員`,
                          1,
                          2000,
                          p.capacity,
                        );
                      }}
                    >
                      変更
                    </button>
                    <label>
                      <Switch
                        checked={p.is_accepting}
                        onChange={(val) =>
                          handleToggleTableValue(
                            'gym_performances',
                            p.id,
                            'is_accepting',
                            val,
                            'detailSection',
                          )
                        }
                      />
                    </label>
                  </div>
                </div>
              ))}
            </div>
          )}

          {activeDetailTab === 'schedules' && (
            <div className={styles.toggleList}>
              <h3>公演回の有効状態</h3>
              {schedules.map((s) => (
                <div key={`sch-${s.id}`} className={styles.field}>
                  <span className={styles.settingLabel}>{s.round_name}</span>
                  <label>
                    <Switch
                      checked={s.is_active}
                      onChange={(val) =>
                        handleToggleTableValue(
                          'performances_schedule',
                          s.id,
                          'is_active',
                          val,
                          'detailSection',
                        )
                      }
                    />
                  </label>
                </div>
              ))}
            </div>
          )}

          {activeDetailTab === 'relationships' && (
            <div className={styles.toggleList}>
              <h3>間柄の受付</h3>
              {relationships.map((r) => (
                <div key={`rel-${r.id}`} className={styles.field}>
                  <span className={styles.settingLabel}>{r.name}</span>
                  <label>
                    <Switch
                      checked={r.is_accepting}
                      onChange={(val) =>
                        handleToggleTableValue(
                          'relationships',
                          r.id,
                          'is_accepting',
                          val,
                          'detailSection',
                        )
                      }
                    />
                  </label>
                </div>
              ))}
            </div>
          )}
        </div>
        {settingsMessageScope === 'detailSection' && isSyncingSetting && (
          <p className={styles.statusMessage}>設定を更新中です...</p>
        )}
        {settingsMessageScope === 'detailSection' && settingsError && (
          <p className={styles.authError}>{settingsError}</p>
        )}
        {settingsMessageScope === 'detailSection' && settingsSuccess && (
          <p className={styles.authSuccess}>{settingsSuccess}</p>
        )}
      </NormalSection>
      <NormalSection>
        <h2>削除ツール</h2>
        <p className={styles.noteText}>
          データの削除は慎重に行う必要があります。削除を行う前に、必ずデータのバックアップを取ってください。
        </p>
        <div className={styles.deleteButtonContainer}>
          <h3>チケットの削除</h3>
          <p className={styles.noteText}>
            全ての発券済みチケットを削除し、残席カウンターとチケット採番カウンターをリセットします。
          </p>
          <button
            type='button'
            className={`${styles.authButton} ${styles.settingModalConfirmDanger}`}
            onClick={() => setShowDeleteAllTicketsModal(true)}
            disabled={isDeletingAllAccounts || isDeletingAllTickets}
          >
            全てのチケットを削除してカウンターをリセット
          </button>
          <h3>生徒アカウントの削除</h3>
          <button
            type='button'
            className={`${styles.authButton} ${styles.settingModalConfirmDanger}`}
            onClick={() => {
              setPendingDeleteAccountType('student');
              setShowDeleteAllAccountsModal(true);
            }}
            disabled={isDeletingAllAccounts || isDeletingAllTickets}
          >
            全ての生徒アカウントを削除
          </button>
          <h3>中学生アカウントの削除</h3>
          <button
            type='button'
            className={`${styles.authButton} ${styles.settingModalConfirmDanger}`}
            onClick={() => {
              setPendingDeleteAccountType('junior');
              setShowDeleteAllAccountsModal(true);
            }}
            disabled={isDeletingAllAccounts || isDeletingAllTickets}
          >
            全ての中学生アカウントを削除
          </button>
        </div>
        {settingsMessageScope === 'deletionTool' && settingsError && (
          <p className={styles.authError}>{settingsError}</p>
        )}
        {settingsMessageScope === 'deletionTool' && settingsSuccess && (
          <p className={styles.authSuccess}>{settingsSuccess}</p>
        )}
      </NormalSection>
      <NormalSection>
        <h2>パスワード変更</h2>
        <form className={styles.passwordForm} onSubmit={handlePasswordChange}>
          <label className={styles.authLabel} htmlFor='admin-current-password'>
            現在の管理者パスワード
          </label>
          <input
            id='admin-current-password'
            type='password'
            className={styles.authInput}
            value={currentPassword}
            onInput={(event) =>
              setCurrentPassword((event.target as HTMLInputElement).value)
            }
            autoComplete='current-password'
            required
          />
          <label className={styles.authLabel} htmlFor='admin-new-password'>
            新しい管理者パスワード
          </label>
          <input
            id='admin-new-password'
            type='password'
            className={styles.authInput}
            value={newPassword}
            onInput={(event) =>
              setNewPassword((event.target as HTMLInputElement).value)
            }
            autoComplete='new-password'
            minLength={8}
            required
          />
          <label
            className={styles.authLabel}
            htmlFor='admin-new-password-confirm'
          >
            新しい管理者パスワード（確認）
          </label>
          <input
            id='admin-new-password-confirm'
            type='password'
            className={styles.authInput}
            value={confirmNewPassword}
            onInput={(event) =>
              setConfirmNewPassword((event.target as HTMLInputElement).value)
            }
            autoComplete='new-password'
            minLength={8}
            required
          />
          {passwordChangeError && (
            <p className={styles.authError}>{passwordChangeError}</p>
          )}
          {passwordChangeSuccess && (
            <p className={styles.authSuccess}>{passwordChangeSuccess}</p>
          )}
          <button
            type='submit'
            className={styles.authButton}
            disabled={isChangingPassword}
          >
            {isChangingPassword ? '変更中...' : 'パスワードを変更'}
          </button>
        </form>
      </NormalSection>
      {(editingNumericKey || editingPerformanceInfo) && (
        <div
          className={styles.settingModalOverlay}
          role='presentation'
          onClick={closeNumericEditModal}
        >
          <div
            className={styles.settingModal}
            role='dialog'
            aria-modal='true'
            aria-labelledby='settings-edit-title'
            onClick={(event) => event.stopPropagation()}
          >
            <h3 id='settings-edit-title' className={styles.settingModalTitle}>
              {editingNumericKey
                ? NUMERIC_SETTING_META[editingNumericKey].label
                : editingPerformanceInfo?.label}
              を変更
            </h3>
            <input
              className={styles.fieldControl}
              type='number'
              min={
                editingNumericKey
                  ? NUMERIC_SETTING_META[editingNumericKey].min
                  : editingPerformanceInfo?.min
              }
              max={
                editingNumericKey
                  ? NUMERIC_SETTING_META[editingNumericKey].max
                  : editingPerformanceInfo?.max
              }
              value={editingNumericValue}
              onInput={(event) =>
                setEditingNumericValue((event.target as HTMLInputElement).value)
              }
            />
            {settingsMessageScope === 'modal' && settingsError && (
              <p className={styles.authError}>{settingsError}</p>
            )}
            {settingsMessageScope === 'modal' && settingsSuccess && (
              <p className={styles.authSuccess}>{settingsSuccess}</p>
            )}
            <div className={styles.settingModalActions}>
              <button
                type='button'
                className={styles.settingModalCancel}
                onClick={closeNumericEditModal}
                disabled={isModalSubmitting}
              >
                キャンセル
              </button>
              <button
                type='button'
                className={styles.settingModalConfirm}
                onClick={handleConfirmNumericEdit}
                disabled={isModalSubmitting}
              >
                {isModalSubmitting ? '同期中...' : 'OK'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showDeleteAllAccountsModal && (
        <div
          className={styles.settingModalOverlay}
          role='presentation'
          onClick={() => setShowDeleteAllAccountsModal(false)}
        >
          <div
            className={styles.settingModal}
            role='dialog'
            aria-modal='true'
            aria-labelledby='delete-all-accounts-title'
            onClick={(event) => event.stopPropagation()}
          >
            <h3
              id='delete-all-accounts-title'
              className={styles.settingModalTitle}
            >
              {pendingDeleteAccountType === 'student'
                ? '全ての生徒アカウントを削除しますか？'
                : '全ての中学生アカウントを削除しますか？'}
            </h3>
            <p>
              この操作は取り消せません。
              {pendingDeleteAccountType === 'student'
                ? '全ての生徒アカウント'
                : '全ての中学生アカウント'}
              がAuthとpublic.usersの両方から削除されます。本当に実行しますか？
            </p>
            <div className={styles.settingModalActions}>
              <button
                type='button'
                className={styles.settingModalCancel}
                onClick={() => setShowDeleteAllAccountsModal(false)}
                disabled={isDeletingAllAccounts}
              >
                キャンセル
              </button>
              <button
                type='button'
                className={`${styles.settingModalConfirm} ${styles.settingModalConfirmDanger}`}
                onClick={handleDeleteAllAccounts}
                disabled={isDeletingAllAccounts}
              >
                {isDeletingAllAccounts ? '削除中...' : '削除'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showDeleteAllTicketsModal && (
        <div
          className={styles.settingModalOverlay}
          role='presentation'
          onClick={() => setShowDeleteAllTicketsModal(false)}
        >
          <div
            className={styles.settingModal}
            role='dialog'
            aria-modal='true'
            aria-labelledby='delete-all-tickets-title'
            onClick={(event) => event.stopPropagation()}
          >
            <h3
              id='delete-all-tickets-title'
              className={styles.settingModalTitle}
            >
              全てのチケットを削除してカウンターをリセットしますか？
            </h3>
            <p>
              この操作は取り消せません。全ての発券済みチケットが削除され、残席カウンターとチケット採番カウンターがリセットされます。本当に実行しますか？
            </p>
            <div className={styles.settingModalActions}>
              <button
                type='button'
                className={styles.settingModalCancel}
                onClick={() => setShowDeleteAllTicketsModal(false)}
                disabled={isDeletingAllTickets}
              >
                キャンセル
              </button>
              <button
                type='button'
                className={`${styles.settingModalConfirm} ${styles.settingModalConfirmDanger}`}
                onClick={handleDeleteAllTickets}
                disabled={isDeletingAllTickets}
              >
                {isDeletingAllTickets ? '削除中...' : '削除してリセット'}
              </button>
            </div>
          </div>
        </div>
      )}

      {isDeletingAllAccounts && (
        <div className={styles.settingModalOverlay}>
          <LoadingSpinner
            message={
              pendingDeleteAccountType === 'student'
                ? '全ての生徒アカウントを削除中です...'
                : '全ての中学生アカウントを削除中です...'
            }
          />
        </div>
      )}

      {isDeletingAllTickets && (
        <div className={styles.settingModalOverlay}>
          <LoadingSpinner message='全てのチケットを削除し、カウンターをリセット中です...' />
        </div>
      )}
    </div>
  );
};

const Settings = () => {
  useTitle('コントロールパネル - 管理画面');
  return (
    <AdminAuthLayout
      title='コントロールパネル'
      description='システム全体設定と管理者セキュリティをここで管理します。'
    >
      <SettingsContent />
    </AdminAuthLayout>
  );
};

export default Settings;
