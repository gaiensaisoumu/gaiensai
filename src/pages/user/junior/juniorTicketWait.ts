import { supabase } from '../../../lib/supabase';

export const JUNIOR_ENTRY_ONLY_TICKET_TYPE_ID = 7;
const ISSUE_POLL_MAX_RETRIES = 20;
const ISSUE_POLL_INTERVAL_MS = 300;

export const waitForJuniorEntryOnlyTicketIssued = async (): Promise<boolean> => {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  const userId = session?.user?.id;

  if (!userId) {
    return false;
  }

  for (let i = 0; i < ISSUE_POLL_MAX_RETRIES; i++) {
    const { count, error } = await supabase
      .from('tickets')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .eq('status', 'valid')
      .eq('ticket_type', JUNIOR_ENTRY_ONLY_TICKET_TYPE_ID);

    if (!error && Number(count ?? 0) > 0) {
      return true;
    }

    await new Promise((resolve) => {
      window.setTimeout(resolve, ISSUE_POLL_INTERVAL_MS);
    });
  }

  return false;
};
