import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// eslint-disable-next-line no-undef
const rootDir = process.cwd();
const configPath = resolve(rootDir, 'public/config.yaml');
const outputPath = resolve(rootDir, 'index.html');

const parseScalar = (value) => {
  if (/^-?\d+$/.test(value)) {
    return Number(value);
  }
  return value;
};

const parseConfigYaml = (yamlText) => {
  const lines = yamlText.split('\n');
  const parsed = {};
  let currentArrayKey = null;

  for (const rawLine of lines) {
    const line = rawLine.replace(/\r$/, '');
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const arrayItemMatch = line.match(/^\s*-\s*(.+)$/);
    if (arrayItemMatch && currentArrayKey) {
      const nextValue = arrayItemMatch[1].trim();
      if (Array.isArray(parsed[currentArrayKey])) {
        parsed[currentArrayKey].push(nextValue);
      }
      continue;
    }

    const keyValueMatch = line.match(/^([a-zA-Z_][\w]*)\s*:\s*(.*)$/);
    if (!keyValueMatch) {
      currentArrayKey = null;
      continue;
    }

    const key = keyValueMatch[1];
    const value = keyValueMatch[2].trim();

    if (value === '') {
      parsed[key] = [];
      currentArrayKey = key;
      continue;
    }

    currentArrayKey = null;
    parsed[key] = parseScalar(value);
  }

  return parsed;
};

const escapeHtml = (value) =>
  String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');

const normalizeSiteUrl = (value) =>
  String(value)
    .trim()
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '');

const configRaw = readFileSync(configPath, 'utf8');
const parsed = parseConfigYaml(configRaw);

const siteUrl = normalizeSiteUrl(parsed.site_url ?? 'gaiensai.pages.dev');
const eventName = String(parsed.name ?? '外苑祭').trim();
const year = Number(parsed.year ?? 2025);
const school = String(parsed.school ?? '東京都立青山高校').trim();
const operatingOrganization = String(
  parsed.operating_organization ?? '外苑祭総務',
).trim();
const catchCopy = String(parsed.catchCopy ?? '熱狂が、幕を開ける。').trim();
const metaDescription = String(
  parsed.meta_description ??
  `${school}${eventName}公式サイト。このサイトでは、${eventName}について知り、公演一覧やタイムスケジュールを見ることができます。また、もらった招待券を表示したり、青高生は招待券を発行することもできます。`,
).trim();

if (!siteUrl) {
  throw new Error('config.yaml の site_url が空です。');
}

const baseUrl = `https://${siteUrl}`;
const siteTitle = `${eventName}${year} 公式サイト`;

const userHtml = `<!doctype html>
<html lang="ja">

<head prefix="og: https://ogp.me/ns#">
  <!-- 重要
    もし今index.htmlを直接変更しようとしている場合、その変更は反映されません。index.htmlを変更する必要がある場合は、
    /scripts/generate-index-from-config.mjsに移動して、その中のconst html内を編集してください。
    現在そのファイルを変更中の場合は、特に気にする必要はありません。
  -->

  <!--
    - 外苑祭チケットシステム
    - Web Site: ${baseUrl}/
    - Git Repository: https://github.com/Rio-Gunawan/gaiensai

    - Copyright (c) 2026 Rio Gunawan(aoym 79th)
    -  and Gaiensai Festival General Affairs Committee, Tokyo Metropolitan Aoyama High School
    - Released under the MIT license.
    - See https://github.com/Rio-Gunawan/gaiensai/blob/main/LICENSE
  -->

  <meta charset="UTF-8" />
  <link rel="icon" href="/favicon.ico" type="image/vnd.microsoft.icon" />
  <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
  <link rel="apple-touch-icon" href="/icon.png">
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />

  <meta name="description" content="${escapeHtml(metaDescription)}">
  <meta name="author" content="${escapeHtml(operatingOrganization)}">
  <meta name="theme-color" content="#081b47">
  <title>${escapeHtml(siteTitle)}</title>

  <!-- PWAマニフェスト関連のmetaタグ(共通) -->
  <meta name="mobile-web-app-capable" content="yes">
  <!-- PWAマニフェスト関連のmetaタグ(iOS用) -->
  <meta name="apple-mobile-web-app-capable" content="yes" />
  <meta name="apple-mobile-web-app-status-bar-style" content="default" />
  <meta name="apple-mobile-web-app-title" content="${escapeHtml(siteTitle)}" />

  <meta property="og:site_name" content="${escapeHtml(siteTitle)}" />
  <meta property="og:title" content="${escapeHtml(siteTitle)}" />
  <meta property="og:type" content="website" />
  <meta property="og:url" content="${baseUrl}/" />
  <meta property="og:image" content="${baseUrl}/og.jpg" />
  <meta property="og:description" content="${escapeHtml(metaDescription)}" />
  <meta property="og:locale" content="ja_JP" />
  <meta name="keywords" content="${escapeHtml(
  `${eventName},${school},文化祭,高校,${catchCopy}`,
)}" />
</head>

<body>
  <div id="app"></div>
  <script type="module" src="/src/main.tsx"></script>
</body>

</html>
`;

writeFileSync(outputPath, userHtml, 'utf8');
// eslint-disable-next-line no-console
console.log(`Generated ${outputPath} from ${configPath}`);
