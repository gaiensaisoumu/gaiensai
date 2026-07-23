import { useEffect, useState } from 'preact/hooks';
import IssuedTicketCardList from '../../../features/tickets/IssuedTicketCardList';
import { useDecodedSerialTickets } from '../../../features/tickets/useDecodedSerialTickets';

import {
  DAY_TICKET_RESULT_STORAGE_KEY,
  type IssueResultPayload,
} from '../../../features/issue/issueResultStorage';
import styles from '../students/Issue.module.css';
import BackButton from '../../../components/ui/BackButton';
import { useTicketStorage } from '../../../features/tickets/useTicketStorage';
import { useTitle } from '../../../hooks/useTitle';
import { NoIndexMeta } from '../../../components/NoIndexMeta';

const DayTicketIssueResult = () => {
  const [result, setResult] = useState<IssueResultPayload | null>(null);
  const { saveTicketToCache } = useTicketStorage();

  useTitle('当日券発券完了');

  useEffect(() => {
    const raw = window.sessionStorage.getItem(DAY_TICKET_RESULT_STORAGE_KEY);

    if (!raw) {
      setResult(null);
      return;
    }

    try {
      const parsed = JSON.parse(raw) as IssueResultPayload;
      if (!parsed.issuedTickets || parsed.issuedTickets.length === 0) {
        setResult(null);
        return;
      }

      setResult(parsed);

      void Promise.all(
        parsed.issuedTickets.map((ticket) =>
          saveTicketToCache(
            ticket.code,
            ticket.signature,
            {
              performanceName: parsed.performanceName,
              performanceTitle: parsed.performanceTitle ?? null,
              scheduleName: parsed.scheduleName,
              scheduleDate: parsed.scheduleDate,
              scheduleTime: parsed.scheduleTime,
              scheduleEndTime: parsed.scheduleEndTime,
              ticketTypeLabel: parsed.ticketTypeLabel,
              relationshipName: parsed.relationshipName,
              relationshipId: parsed.relationshipId,
            },
            'valid',
          ),
        ),
      );
    } catch {
      setResult(null);
    }
  }, []);

  const issuedTickets = useDecodedSerialTickets(result?.issuedTickets ?? []);

  return (
    <>
      <NoIndexMeta />
      <div className={styles.issuePage}>
        <BackButton href='/day-tickets' />
        <h1 className={styles.pageTitle}>当日券発券完了</h1>

        {!result ? (
          <section className={styles.issuedSection}>
            <p>表示できる発券結果がありません。</p>
            <a href='/day-tickets' className={styles.topBackButton}>
              当日券発券画面へ戻る
            </a>
          </section>
        ) : (
          <section className={styles.issuedSection}>
            <IssuedTicketCardList
              title='発券したチケット一覧'
              showSortControl
              showSerialNumber
              showTicketCode
              tickets={issuedTickets.map((ticket) => ({
                ...ticket,
                performanceName: result.performanceName,
                performanceTitle: result.performanceTitle,
                scheduleName: result.scheduleName,
                ticketTypeLabel: result.ticketTypeLabel,
                relationshipName: result.relationshipName,
                status: 'valid',
              }))}
            />
          </section>
        )}

        <a href='/day-tickets' className={styles.buttonLink}>
          当日券発券画面へ戻る
        </a>
      </div>
    </>
  );
};

export default DayTicketIssueResult;
