import { useTitle } from '../../hooks/useTitle';
import styles from '../../styles/sub-pages.module.css';

const Pamphlet = () => {
  useTitle('パンフレット');
  return (
    <>
      <h1 className={styles.pageTitle}>パンフレット</h1>
      <section>準備中</section>
    </>
  );
};

export default Pamphlet;
