import NormalSection from '../../components/ui/NormalSection';
import { useTitle } from '../../hooks/useTitle';
import styles from '../../styles/sub-pages.module.css';

const Info = () => {
  useTitle('ご来場の注意');
  return (
    <>
      <h1 className={styles.pageTitle}>ご来場の注意</h1>
      <NormalSection>
        <h2>青山高校への入退場</h2>
        <ul>
          <li>
            正門正面で受付を終えた後に体育館公演を見られる方は体育館へ、そうでない方は校舎へお入りください。
          </li>
          <li>
            サイトへのアクセス過多により開きにくくなることが想定されます。そのため、チケットのQRコードを事前にスクリーンショットや印刷するなどしておくことを強く推奨します。また、本サイトは一度開くと一時的に端末に情報が保存されるため、来場前に一度サイトを開いておくことも推奨します。
          </li>
          <li>
            著しく酒気を帯びた方や外苑祭の円滑な進行を妨害しうる方、その他青山高校またはスタッフが入場拒否を相当と判断した方については入場をお断りすることがございます。
          </li>
        </ul>
      </NormalSection>
      <NormalSection>
        <h2>写真撮影について</h2>
        <ul>
          <li>本校の<strong>生徒、保護者プレートをつけている保護者の方、学校関係者</strong>以外の写真撮影は<strong>固くお断りして</strong>おります。</li>
          <li>また、本校の生徒、保護者の方、学校関係者であっても、写真や動画をSNSなどにアップしないようにお願いします。</li>
        </ul>
      </NormalSection>
      <NormalSection>
        <h2>校内での行動</h2>
        <ul>
          <li>
            事故や混乱防止のため、青山高校やスタッフの指示には必ず従ってください。
          </li>
          <li>
            外苑祭のプログラムについて、やむを得ない事情で予告なく変更/中止する可能性がございます。予めご了承ください。
          </li>
          <li>
            敷地内は<strong>完全禁煙</strong>となっております。ご理解とご協力の程よろしくお願いします。
          </li>
          <li>
            校内にゴミ箱はありません。校内で発生したゴミのお持ち帰りにご協力ください。
          </li>
          <li>
            大変暑くなることが予想されますので、体調に十分注意し、こまめな<strong>水分補給</strong>をお願いします。その他ハンディファンの使用など各自工夫して対策をお願いします。
          </li>
          <li>
            校内は大変狭く、外苑祭には多くの方々にご来場いただいているため毎年大変混雑しております。そのため、他のご来場者の方々の邪魔にならないように配慮してください。
          </li>
          <li>
            公平を期すために公演中には北側(４組と５組の教室の間の)階段は封鎖されます。ご理解ください。
          </li>
          <li>落とし物は3階総務室にて管理しております。</li>
          <li>
            ご不明点がありましたら、前日までは
            <a
              href='https://docs.google.com/forms/d/e/1FAIpQLSeMds1IgEh7OBHcO5bYnSrUAWEp2fWdJ_yEBMyhywQrK2JgTw/viewform?usp=header'
              target='_blank'
              rel='noopener noreferrer'
            >
              お問い合わせ
            </a>
            よりお願いします。当日はSTAFFのネームホルダーをかけた外苑祭総務までお声かけくか、3階総務室までお越しください。。
          </li>
        </ul>
      </NormalSection>
      <NormalSection>
        <h2>自動販売機について</h2>
        <ul>
          <li>自動販売機は1階にございますが、早い時間での<strong>売り切れ</strong>が予想されます。別途お飲み物をご用意ください。</li>
          <li>電子マネー、QRコード決済に対応しております。</li>
        </ul>
      </NormalSection>
      <NormalSection>
        <h2>災害時の対応について</h2>
        <ul>
          <li>
            地震または災害の発生時には青山高校またはスタッフの判断によって入場者の安全確認を優先し、外苑祭全体を一時中断することがございます。
          </li>
          <li>
            災害時の避難については校内放送などの手段でアナウンスするため指示に従って落ち着いて行動してください。
          </li>
        </ul>
      </NormalSection>
    </>
  );
};

export default Info;
