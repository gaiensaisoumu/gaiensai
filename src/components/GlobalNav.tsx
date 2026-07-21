import { preload, Home, Students, Performances, Junior, TimeTable, Pamphlet, Info, Map, FAQ } from '../routes';

const GlobalNav = () => {
  const isSecretBaseUnlocked = localStorage.getItem('secretBaseUnlocked') === 'true';
  return (
    <nav>
      <ul>
        <li>
          <a href='/' onMouseEnter={() => preload(Home)}>
            ホーム
          </a>
        </li>
        <li>
          <a href='/students' onMouseEnter={() => preload(Students)}>
            生徒用ページ
          </a>
        </li>
        <li>
          <a href='/junior' onMouseEnter={() => preload(Junior)}>
            中学生用ページ
          </a>
        </li>
        <li>
          <a href='/t'>チケット</a>
        </li>
        <li>
          <a href='/performances' onMouseEnter={() => preload(Performances)}>
            公演一覧
          </a>
        </li>
        <li>
          <a href='/timetable' onMouseEnter={() => preload(TimeTable)}>
            タイムテーブル
          </a>
        </li>
        <li>
          <a href='/pamphlet' onMouseEnter={() => preload(Pamphlet)}>
            パンフレット
          </a>
        </li>
        <li>
          <a href='/info' onMouseEnter={() => preload(Info)}>
            ご来場の注意
          </a>
        </li>
        <li>
          <a href='/map' onMouseEnter={() => preload(Map)}>
            校内マップ
          </a>
        </li>
        <li>
          <a href='https://www.metro.ed.jp/aoyama-h/access/access.html'>
            アクセス
          </a>
        </li>
        <li>
          <a href='/faq' onMouseEnter={() => preload(FAQ)}>
            FAQ
          </a>
        </li>
        <li>
          <a href='https://docs.google.com/forms/d/e/1FAIpQLSfGsEXv2e1IoDbF2RjhrCyK5myHU0Dq-YJ4_3dHMhNeLAvjUg/viewform?usp=dialog'>
            お問い合わせ
          </a>
        </li>
        {isSecretBaseUnlocked && (
          <>
            <li>
              <a href='/gunawan'>開発者の秘密基地</a>
            </li>
            <li>
              <a href='/rio?mode=arcade'>ミニゲーム</a>
            </li>
          </>
        )}
      </ul>
    </nav>
  );
};

export default GlobalNav;
