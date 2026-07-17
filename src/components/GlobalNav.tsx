import { preload, Home, Students, Performances, Junior } from '../routes';

const GlobalNav = () => {
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
          <a href='#'>パンフレット</a>
        </li>
        <li>
          <a href='/performances' onMouseEnter={() => preload(Performances)}>
            公演一覧
          </a>
        </li>
        <li>
          <a href='/timetable'>タイムテーブル</a>
        </li>
        <li>
          <a href='#'>ご来場の注意</a>
        </li>
        <li>
          <a href='/map'>校内マップ</a>
        </li>
        <li>
          <a href='#'>アクセス</a>
        </li>
        <li>
          <a href='/faq'>FAQ</a>
        </li>
        <li>
          <a href='https://docs.google.com/forms/d/e/1FAIpQLSeMds1IgEh7OBHcO5bYnSrUAWEp2fWdJ_yEBMyhywQrK2JgTw/viewform?usp=header'>
            お問い合わせ
          </a>
        </li>
      </ul>
    </nav>
  );
};

export default GlobalNav;
