import { useState } from 'preact/hooks';
import styles from './Modal.module.css';

type ModalProps = {
  setIsOpen: (isOpen: boolean) => void;
  handleAction: () => void;
  headingText: string;
  buttonText: string;
  children?: preact.ComponentChildren;
  showCancelButton?: boolean;
};

const Modal = ({
  setIsOpen,
  handleAction,
  headingText,
  buttonText,
  children,
  showCancelButton = true,
}: ModalProps) => {
  const [isDoingAction, setIsDoingAction] = useState(false);
  const handleOnClick = () => {
    setIsDoingAction(true);
    handleAction();
  };

  return (
    <div
      className={styles.modalOverlay}
      role='presentation'
      onClick={() => setIsOpen(false)}
    >
      <div
        className={styles.modal}
        role='dialog'
        aria-modal='true'
        aria-labelledby='delete-account-title'
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id='delete-account-title' className={styles.modalTitle}>
          {headingText}
        </h2>
        {children}
        <div className={styles.modalActions}>
          {showCancelButton ? (
            <button
              type='button'
              className={styles.modalCancelButton}
              onClick={() => setIsOpen(false)}
              disabled={isDoingAction}
            >
              キャンセル
            </button>
          ) : null}
          <button
            type='button'
            className={styles.modalActionButton}
            onClick={handleOnClick}
            disabled={isDoingAction}
          >
            {isDoingAction ? 'お待ちください...' : buttonText}
          </button>
        </div>
      </div>
    </div>
  );
};

export default Modal;
