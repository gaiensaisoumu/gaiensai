import { useEffect, useState, useCallback, useRef } from 'preact/hooks';
import { registerSW } from 'virtual:pwa-register';
import styles from '../styles/pwa-update-toast.module.css';

interface PWAUpdateToastProps {
  // Optional: custom selector for textareas/inputs to check for unsaved data
  unsavedInputSelector?: string;
}

export const PWAUpdateToast = ({
  unsavedInputSelector,
}: PWAUpdateToastProps) => {
  const [needRefresh, setNeedRefresh] = useState(false);
  const [showWarning, setShowWarning] = useState(false);

  // 1. useEffect内で生成された updateSW 関数を保持するための Ref
  const updateSWRef = useRef<((reloadPage?: boolean) => void) | null>(null);

  // Check if there are unsaved inputs
  const hasUnsavedData = useCallback((): boolean => {
    const selector =
      unsavedInputSelector ||
      'textarea, input[type="text"], input[type="search"]';
    const inputs = document.querySelectorAll(selector);

    for (const input of inputs) {
      const element = input as HTMLInputElement | HTMLTextAreaElement;
      if (element.value && element.value.trim() !== '') {
        return true;
      }
    }
    return false;
  }, [unsavedInputSelector]);

  // Register service worker
  useEffect(() => {
    const updateSW = registerSW({
      onNeedRefresh() {
        setNeedRefresh(true);
      },
      onRegistered(registration: ServiceWorkerRegistration | undefined) {
        if (!registration) {
          return;
        }

        // 1. 定期チェック（既存の処理）
        const intervalId = setInterval(
          () => {
            registration.update();
          },
          30 * 60 * 1000,
        );

        // 2. ★ iOS対策: アプリ（画面）に戻ってきたときに強制作動させる
        const handleVisibilityChange = () => {
          if (document.visibilityState === 'visible') {
            registration.update(); // サーバーへ更新がないか見に行く
          }
        };
        document.addEventListener('visibilitychange', handleVisibilityChange);

        return () => {
          clearInterval(intervalId);
          document.removeEventListener(
            'visibilitychange',
            handleVisibilityChange,
          );
        };
      },
      onRegisterError(error: Error) {
        // eslint-disable-next-line no-console
        console.error('SW registration error', error);
      },
    });

    updateSWRef.current = updateSW;

    return () => {};
  }, []);

  // 実際に更新（skipWaiting & リロード）を実行する内部関数
  const executeUpdate = useCallback(() => {
    if (updateSWRef.current) {
      // 4. Refに保持しておいた関数に true を渡して実行する
      updateSWRef.current(true);
    }
  }, []);

  // Handle update click with data protection
  const handleUpdate = useCallback(() => {
    if (hasUnsavedData()) {
      setShowWarning(true);
      return;
    }

    executeUpdate();
  }, [hasUnsavedData, executeUpdate]);

  // Handle "あとで" click
  const handleDismiss = useCallback(() => {
    setNeedRefresh(false);
    setShowWarning(false);
  }, []);

  // Handle force update from warning dialog
  const handleForceUpdate = useCallback(() => {
    setShowWarning(false);
    executeUpdate();
  }, [executeUpdate]);

  if (!needRefresh) {
    return null;
  }

  return (
    <div className={styles.pwaUpdateToast}>
      <div className={styles.pwaUpdateToastContent}>
        <p className={styles.pwaUpdateToastMessage}>
          新しいバージョンが利用可能です
        </p>
        <div className={styles.pwaUpdateToastButtons}>
          <button
            className={`${styles.pwaUpdateToastButton} ${styles.pwaUpdateToastButtonUpdate}`}
            onClick={handleUpdate}
          >
            更新
          </button>
          <button
            className={`${styles.pwaUpdateToastButton} ${styles.pwaUpdateToastButtonDismiss}`}
            onClick={handleDismiss}
          >
            あとで
          </button>
        </div>
      </div>

      {showWarning && (
        <div className={styles.pwaUpdateWarningOverlay}>
          <div className={styles.pwaUpdateWarningDialog}>
            <h3 className={styles.pwaUpdateWarningTitle}>
              未保存のデータがあります
            </h3>
            <p className={styles.pwaUpdateWarningMessage}>
              更新すると、入力中のデータが失われる可能性があります。本当に更新しますか？
            </p>
            <div className={styles.pwaUpdateWarningButtons}>
              <button
                className={`${styles.pwaUpdateWarningButton} ${styles.pwaUpdateWarningButtonCancel}`}
                onClick={() => setShowWarning(false)}
              >
                キャンセル
              </button>
              <button
                className={`${styles.pwaUpdateWarningButton} ${styles.pwaUpdateWarningButtonConfirm}`}
                onClick={handleForceUpdate}
              >
                更新する
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
