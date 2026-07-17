import { useTitle } from '../../hooks/useTitle';
import styles from '../../styles/sub-pages.module.css';
import mapImage from '../../assets/map.jpg';

const Map = () => {
  useTitle('校内マップ');
  return (
    <>
      <h1 className={styles.pageTitle}>校内マップ</h1>

      <img src={mapImage} alt='校内マップ' className={styles.map} />

      {/* 別のタブで開くボタンを追加 */}
      <div className={styles.buttonContainer}>
        <a
          href={mapImage}
          target='_blank'
          rel='noopener noreferrer'
          className={styles.openButton}
        >
          別のタブでマップを開く
        </a>
      </div>
    </>
  );
};

export default Map;
