import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
import eslintReact from "@eslint-react/eslint-plugin";
import { defineConfig } from "eslint/config";

export default defineConfig([
  // 1. グローバルな無視設定
  {
    ignores: ["dist/**", "node_modules/**"]
  },

  // 2. 基本となる推奨設定の適用
  js.configs.recommended,
  ...tseslint.configs.recommended,

  // 3. React / TypeScript プロジェクト共通のベース設定
  {
    files: ["**/*.{js,mjs,cjs,ts,mts,cts,jsx,tsx}"],
    plugins: {
      "react-hooks": reactHooks,
      "@eslint-react": eslintReact,
    },
    languageOptions: {
      globals: globals.browser
    },
    rules: {
      // プラグインの推奨ルールをここで展開して有効化
      ...reactHooks.configs.recommended.rules,
      ...eslintReact.configs.recommended.rules,

      // --- プロジェクト固有のカスタムルール ---
      // セミコロン強制
      "semi": ["warn", "always"],

      // 開発時に便利な警告
      "no-console": "warn",
      "no-debugger": "warn",

      // TypeScriptと重複する機能をオフ
      "@typescript-eslint/no-unused-vars": "off",
      "@typescript-eslint/no-undef": "off",

      // @eslint-reactルールの調整
      "@eslint-react/set-state-in-effect": "off",
      "@eslint-react/exhaustive-deps": "off",
      "@eslint-react/no-array-index-key": "off",
      "@eslint-react/web-api-no-leaked-timeout": "off",
      "@eslint-react/web-api-no-leaked-event-listener": "off",
      "@eslint-react/purity": "off",
      "@eslint-react/naming-convention-ref-name": "off",
      "@eslint-react/no-unnecessary-use-prefix": "off",
      "@eslint-react/no-use-context": "off",
      "@eslint-react/no-context-provider": "off",
      "@eslint-react/use-state": "off",

      // react-hooksルールの調整
      "react-hooks/exhaustive-deps": "off",

      // コード品質
      "no-var": "error",
      "prefer-const": "warn",
      "eqeqeq": ["error", "always"],
      "curly": ["warn", "all"],

      // Preact環境：React 17以降やPreactではJSXScopeは不要ですが、
      // @eslint-react ではデフォルトでオフ、または別のルール名（@eslint-react/react/no-missing-react-importなど仕様による）になります。
      // 旧プラグインの "react/react-in-jsx-scope" は不要なので削除して問題ありません。
    },
  },
]);
