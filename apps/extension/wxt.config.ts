import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

const CHROMIUM_ONLY = {
  minimum_chrome_version: '116',
  key: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAvlk+TGntT5uCn0LTk1Q8IXYIlmnIUm3ODTJcv/hwD6N2BpJ/g+Qjo1Pw6enBTdyEVc41SqpF74yh0a5egrYcuqA4K9Sb3BFmbECDUcwPyevxhQ6r0JwEryERbNxRrmOrVtdTFEmqx+KT0EKUfBjFQhBwdxRjF8LajZ4nPM8pF6bVwlRXovo0zxQDwGpTAvGy4ge4aiTnB0mOBYG4rg/yyz8dY2rhg7zoiwD43Y/zTUov2B0r/nis5aQtKqA0MpNt6WRs6tsgatCubzOvbCeYENca+ptTIr5+wFspOZoI9Zdm+04cyacpKiqVqDlUW9zZzClliiSOWcnpJusHEXZYMwIDAQAB',
  externally_connectable: {
    matches: [
      'https://nextmove-yatin.vercel.app/*',
      'http://localhost/*',
      'http://127.0.0.1/*',
    ],
  },
} as const;

const FIREFOX_ONLY = {
  browser_specific_settings: {
    gecko: {
      id: 'nextmove-autofill@nextmoveapp.com',
      strict_min_version: '115.0',
      data_collection_permissions: {
        required: ['none'],
        optional: ['personallyIdentifyingInfo', 'websiteContent', 'websiteActivity'],
      },
    },
  },
} as const;

export default defineConfig({
  srcDir: 'src',
  outDir: 'build',
  modules: ['@wxt-dev/module-react'],
  hooks: {
    'vite:build:extendConfig': (entrypoints, viteConfig) => {
      if (!entrypoints.every((entrypoint) => entrypoint.inputPath.endsWith('.html'))) return;
      const output = viteConfig.build?.rollupOptions?.output;
      if (!output || Array.isArray(output)) return;
      output.codeSplitting = {
        groups: [
          { name: 'react', test: /[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
          { name: 'dexie', test: /[\\/]node_modules[\\/]dexie[\\/]/ },
        ],
      };
    },
  },
  vite: () => ({
    plugins: [tailwindcss()],
  }),
  manifest: ({ browser }) => ({
    name: 'NextMove Autofill',
    description:
      'Fill any job application in one click. Your data stays on your device. AI answers with your own free Gemini keys.',
    ...(browser === 'firefox' ? FIREFOX_ONLY : CHROMIUM_ONLY),
    permissions: ['storage', 'scripting', 'alarms', 'contextMenus'],
    host_permissions: [
      'https://generativelanguage.googleapis.com/*',
      'https://nextmove-yatin.vercel.app/*',
    ],
    action: {
      default_popup: 'popup.html',
      default_title: 'NextMove Autofill (Alt+J)',
    },
    options_page: 'options.html',
    commands: {
      'fill-page': {
        suggested_key: { default: 'Alt+J' },
        description: 'Fill this application',
      },
    },
    content_security_policy: {
      extension_pages: "script-src 'self'; object-src 'self'",
    },
    icons: {
      16: 'icons/16.png',
      48: 'icons/48.png',
      128: 'icons/128.png',
    },
  }),
});
