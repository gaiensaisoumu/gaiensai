import styles from '../../styles/sub-pages.module.css';
import { preload, Scan } from '../../routes';
import { useTitle } from '../../hooks/useTitle';

const AdminHome = () => {
  useTitle('管理画面');
  return (
    <div>
      <h1 className={styles.pageTitle}>管理画面</h1>
      <section>
        <h2>管理画面へようこそ</h2>
        <p>
          セキュリティ上の理由から、各ページへのURLは貼っていません。Teamsのマニュアルからそれぞれのページへアクセスしてください。
        </p>
      </section>
      <section>
        <h2>リンク集</h2>
        <p>
          開発中はリンクがないと不便なので、仮としてリンクを貼っておきます。本番なのにリンクが残っていることに気づいた方は至急お知らせください。
        </p>
        <ul>
          <li>
            <a href='/admin/scan' onMouseEnter={() => preload(Scan)}>
              カメラ使用のスキャンページ
            </a>
          </li>
          <li>
            <a href='/admin/register' onMouseEnter={() => preload(Scan)}>
              スキャナ用チケットスキャンページ
            </a>
          </li>
          <li>
            <a href='/admin/history' onMouseEnter={() => preload(Scan)}>
              チケットスキャン履歴
            </a>
          </li>
          <li>
            <a href='/admin/settings' onMouseEnter={() => preload(Scan)}>
              コントロールパネル
            </a>
          </li>
        </ul>
      </section>
    </div>
  );
};

export default AdminHome;
