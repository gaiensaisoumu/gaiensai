import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { VitePWA } from 'vite-plugin-pwa';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';

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

const readConfigYaml = (): ParsedConfig => {
  const rootDir = fileURLToPath(new URL('.', import.meta.url));
  const configPath = resolve(rootDir, 'public/config.yaml');
  const configRaw = readFileSync(configPath, 'utf8');
  return parseConfigYaml(configRaw);
};

const parsedConfig = readConfigYaml();
const pwaIncludeAssets = Array.isArray(parsedConfig.pwa_include_assets)
  ? parsedConfig.pwa_include_assets
  : ['favicon.ico', 'apple-touch-icon.png', 'favicon.svg'];
const pwaManifestName = String(parsedConfig.pwa_manifest_name ?? '外苑祭 公式サイト');
const pwaManifestShortName = String(
  parsedConfig.pwa_manifest_short_name ?? pwaManifestName,
);
const pwaManifestDescription = String(
  parsedConfig.meta_description ?? '外苑祭 公式サイト',
);
const pwaManifestThemeColor = String(
  parsedConfig.pwa_manifest_theme_color ?? '#081b47',
);
const pwaManifestBackgroundColor = String(
  parsedConfig.pwa_manifest_background_color ?? '#081b47',
);
type PwaDisplay = 'fullscreen' | 'standalone' | 'minimal-ui' | 'browser';
const pwaDisplayOptions: readonly PwaDisplay[] = [
  'fullscreen',
  'standalone',
  'minimal-ui',
  'browser',
];
const pwaManifestDisplayRaw = String(
  parsedConfig.pwa_manifest_display ?? 'standalone',
);
const pwaManifestDisplay = pwaDisplayOptions.includes(
  pwaManifestDisplayRaw as PwaDisplay,
)
  ? (pwaManifestDisplayRaw as PwaDisplay)
  : 'standalone';

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    preact(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: pwaIncludeAssets,
      manifest: {
        name: pwaManifestName,
        short_name: pwaManifestShortName,
        description: pwaManifestDescription,
        theme_color: pwaManifestThemeColor,
        background_color: pwaManifestBackgroundColor,
        display: pwaManifestDisplay,
        icons: [
          {
            src: 'pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: 'pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
        ],
      },
      workbox: {
        globPatterns: [
          '**/*.{js,css,html,ico,png,svg,jpg,jpeg,webp,json,yaml}',
        ],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/.*supabase\.co\/.*/,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'supabase-api',
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 60,
              },
            },
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      '@ticket-codec': fileURLToPath(
        new URL(
          './supabase/functions/_shared/decodeTicketCode.ts',
          import.meta.url,
        ),
      ),
    },
  },
  build: {
    // CSSの圧縮を以前の esbuild に戻す
    cssMinify: 'esbuild',
  },
});
