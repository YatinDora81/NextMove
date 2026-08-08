import { defineConfig } from 'wxt';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  srcDir: 'src',
  outDir: 'build',
  modules: ['@wxt-dev/module-react'],
  vite: () => ({
    plugins: [tailwindcss()],
  }),
  manifest: {
    name: 'NextMove Autofill',
    description:
      'Fill any job application in one click. Your data stays on your device. AI answers with your own free Gemini keys.',
    minimum_chrome_version: '116',
    key: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAvlk+TGntT5uCn0LTk1Q8IXYIlmnIUm3ODTJcv/hwD6N2BpJ/g+Qjo1Pw6enBTdyEVc41SqpF74yh0a5egrYcuqA4K9Sb3BFmbECDUcwPyevxhQ6r0JwEryERbNxRrmOrVtdTFEmqx+KT0EKUfBjFQhBwdxRjF8LajZ4nPM8pF6bVwlRXovo0zxQDwGpTAvGy4ge4aiTnB0mOBYG4rg/yyz8dY2rhg7zoiwD43Y/zTUov2B0r/nis5aQtKqA0MpNt6WRs6tsgatCubzOvbCeYENca+ptTIr5+wFspOZoI9Zdm+04cyacpKiqVqDlUW9zZzClliiSOWcnpJusHEXZYMwIDAQAB',
    permissions: ['storage', 'scripting', 'alarms', 'contextMenus'],
    externally_connectable: {
      matches: [
        'https://nextmove-yatin.vercel.app/*',
        'http://localhost/*',
        'http://127.0.0.1/*',
      ],
    },
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
  },
});
