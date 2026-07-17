import { useTitle } from '../../hooks/useTitle';
import styles from '../../styles/sub-pages.module.css';

const Info = () => {
  useTitle('ご来場の注意');
  return (
    <>
      <h1 className={styles.pageTitle}>ご来場の注意</h1>
      <section>準備中</section>
    </>
  );
};

export default Info;
