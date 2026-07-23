import type { Plugin } from 'vite';
import { readFileSync, writeFileSync } from 'node:fs';
import {
  existsSync,
  readFileSync as readFile,
  writeFileSync as writeFile,
} from 'node:fs';
import { resolve } from 'node:path';

// sitemap.xmlに載せる用の公開ルート定義

export const PUBLIC_ROUTES = [
  '/',
  '/performances',
  '/timetable',
  '/pamphlet',
  '/students/login',
  '/junior/login',
  '/t',
  '/info',
  '/map',
  '/faq',
];

export const EXCLUDE_ROUTES = [
  '/admin',
  '/admin/*',
  '/t/*',
  '/day-tickets',
  '/day-tickets/*',
  '/auth',
  '/auth/*',
  '/gunawan',
  '/gunawanrio',
  '/rio',
  '/riogunawan',
];

type ParsedConfig = Record<string, string | number | boolean | string[]>;

const parseScalar = (value: string): string | number | boolean => {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  if (/^-?\d+$/.test(value)) {
    return Number(value);
  }
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }
  return value;
};

const parseConfigYaml = (yamlText: string): ParsedConfig => {
  const lines = yamlText.split('\n');
  const parsed: ParsedConfig = {};
  let currentArrayKey: string | null = null;

  for (const rawLine of lines) {
    const line = rawLine.replace(/\r$/, '');
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    const arrayItemMatch = line.match(/^\s*-\s*(.+)$/);
    if (arrayItemMatch && currentArrayKey) {
      const nextValue = arrayItemMatch[1].trim();
      const currentValue = parsed[currentArrayKey];
      if (Array.isArray(currentValue)) {
        currentValue.push(String(parseScalar(nextValue)));
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

const readConfigYaml = (rootDir: string): ParsedConfig => {
  const configPath = resolve(rootDir, 'public/config.yaml');
  const configRaw = readFileSync(configPath, 'utf8');
  return parseConfigYaml(configRaw);
};

interface SitemapPluginOptions {
  baseUrl?: string;
  additionalRoutes?: string[];
  noindexRoutes?: string[];
}

const escapeXml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');

const normalizeRoute = (route: string) =>
  route === '/' ? '/' : route.replace(/\/+$/g, '');

const routeMatches = (route: string, pattern: string) => {
  const normalizedRoute = normalizeRoute(route);
  const normalizedPattern = normalizeRoute(pattern);

  if (normalizedPattern.endsWith('/*')) {
    const prefix = normalizedPattern.slice(0, -2);
    return (
      normalizedRoute === prefix || normalizedRoute.startsWith(`${prefix}/`)
    );
  }

  return normalizedRoute === normalizedPattern;
};

const routeToHtmlPath = (route: string) => {
  const normalized = normalizeRoute(route);
  if (normalized === '/') {
    return resolve(process.cwd(), 'dist/index.html');
  }
  return resolve(process.cwd(), 'dist', normalized.slice(1), 'index.html');
};

export function sitemapPlugin(options: SitemapPluginOptions = {}): Plugin {
  return {
    name: 'vite-plugin-sitemap',
    apply: 'build',
    closeBundle: async () => {
      const rootDir = process.cwd();
      const config = readConfigYaml(rootDir);

      // Get baseUrl from config or options
      const siteUrl =
        options.baseUrl ||
        process.env.VITE_SITE_URL ||
        process.env.SITE_URL ||
        String(config.site_url || 'https://gaiensai.com');
      const baseUrl = siteUrl.startsWith('https://')
        ? siteUrl
        : `https://${siteUrl}`;

      // Define routes to include in sitemap
      const defaultRoutes = PUBLIC_ROUTES;

      const additionalRoutes = options.additionalRoutes || [];
      const allRoutes = [...defaultRoutes, ...additionalRoutes];

      // Define excluded routes
      const excludedRoutes = EXCLUDE_ROUTES;
      const noindexRoutes = options.noindexRoutes || excludedRoutes;

      // Filter out excluded routes
      const filteredRoutes = allRoutes.filter((route) => {
        return !excludedRoutes.some((excluded) =>
          routeMatches(route, excluded),
        );
      });

      // Generate sitemap XML
      const currentDate = new Date().toISOString().split('T')[0];
      const urls = filteredRoutes
        .map((route) => {
          const url = baseUrl + route;
          return `  <url>
    <loc>${escapeXml(url)}</loc>
    <lastmod>${currentDate}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>${route === '/' ? '1.0' : '0.8'}</priority>
  </url>`;
        })
        .join('\n');

      const sitemapXml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`;

      // Write sitemap.xml to dist directory
      const distDir = resolve(rootDir, 'dist');
      const sitemapPath = resolve(distDir, 'sitemap.xml');

      writeFileSync(sitemapPath, sitemapXml, 'utf8');

      // Inject noindex metadata into generated HTML for excluded pages.
      for (const route of noindexRoutes) {
        if (route.includes('*')) {
          continue;
        }

        const htmlPath = routeToHtmlPath(route);
        if (!existsSync(htmlPath)) {
          continue;
        }

        const html = readFile(htmlPath, 'utf8');
        if (html.includes('meta name="robots" content="noindex, nofollow"')) {
          continue;
        }

        const metaTag = '<meta name="robots" content="noindex, nofollow" />';
        const updated = html.includes('</head>')
          ? html.replace('</head>', `  ${metaTag}\n</head>`)
          : html;
        writeFile(htmlPath, updated, 'utf8');
      }
    },
  };
}
