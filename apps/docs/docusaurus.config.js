// @ts-check
// Docusaurus config for the OpenBucket documentation site.
// Deployed to GitHub Pages at https://projectbay.github.io/openbucket/
// See: https://docusaurus.io/docs/api/docusaurus-config

import {themes as prismThemes} from 'prism-react-renderer';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));

// First-party, cookieless pageview analytics (self-hosted collector — see
// apps/docs-analytics). The beacon activates only when the docs are built with
// DOCS_ANALYTICS_URL pointing at the collector's /collect endpoint; otherwise it
// is a complete no-op, so local dev and PR/preview builds never phone home.
const analyticsUrl = process.env.DOCS_ANALYTICS_URL;

/** @type {import('@docusaurus/types').Config} */
const config = {
  title: 'OpenBucket',
  tagline:
    'A self-hosted, S3-compatible object store you can run as a container — or embed in a NestJS app.',
  favicon: 'img/logo-icon.png',

  // Load Inter (set as --ifm-font-family-base in src/css/custom.css).
  stylesheets: [
    'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap',
  ],

  future: {
    v4: true, // forward-compat with Docusaurus v4
  },

  // GitHub Pages: https://projectbay.github.io/openbucket/
  url: 'https://projectbay.github.io',
  baseUrl: '/openbucket/',
  organizationName: 'ProjectBay',
  projectName: 'openbucket',

  // Cookieless, first-party pageview beacon (no-op unless DOCS_ANALYTICS_URL is set).
  clientModules: [path.resolve(dirname, 'src/analytics-beacon.js')],

  plugins: [
    // Expose the collector URL to the beacon as a runtime global, but only when
    // DOCS_ANALYTICS_URL was set at build time.
    function docsAnalyticsPlugin() {
      return {
        name: 'openbucket-docs-analytics',
        injectHtmlTags() {
          if (!analyticsUrl) return {};
          const json = JSON.stringify({url: analyticsUrl}).replace(/</g, '\\u003c');
          return {
            headTags: [
              {tagName: 'script', innerHTML: `window.__OB_DOCS_ANALYTICS__=${json};`},
            ],
          };
        },
      };
    },
  ],

  // 'warn' (not 'throw') because the ported whitepaper carries repo-relative
  // links (source paths, sibling design docs) that don't all resolve in-site.
  onBrokenLinks: 'warn',

  markdown: {
    // 'detect' → `.md` is parsed as CommonMark and `.mdx` as MDX. The ported
    // whitepaper/README markdown contains `<...>`/`{...}` (type signatures,
    // generics) that would break the MDX parser; CommonMark passes it through.
    format: 'detect',
    hooks: {
      onBrokenMarkdownLinks: 'warn',
    },
  },

  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      /** @type {import('@docusaurus/preset-classic').Options} */
      ({
        docs: {
          sidebarPath: './sidebars.js',
          editUrl:
            'https://github.com/ProjectBay/openbucket/tree/main/apps/docs/',
        },
        blog: false, // docs-only site
        theme: {
          customCss: './src/css/custom.css',
        },
      }),
    ],
  ],

  themeConfig:
    /** @type {import('@docusaurus/preset-classic').ThemeConfig} */
    ({
      image: 'img/docusaurus-social-card.jpg',
      colorMode: {
        respectPrefersColorScheme: true,
      },
      navbar: {
        title: 'OpenBucket',
        logo: {
          alt: 'OpenBucket',
          src: 'img/logo-icon.png',
        },
        items: [
          {
            type: 'docSidebar',
            sidebarId: 'docsSidebar',
            position: 'left',
            label: 'Docs',
          },
          {
            to: '/docs/getting-started/quickstart-docker',
            position: 'left',
            label: 'Quick start',
          },
          {
            to: '/docs/guides',
            position: 'left',
            label: 'Guides',
          },
          {
            href: 'https://github.com/ProjectBay/openbucket',
            label: 'GitHub',
            position: 'right',
          },
          {
            href: 'https://www.npmjs.com/package/@openbucket/nestjs',
            label: 'npm',
            position: 'right',
          },
        ],
      },
      footer: {
        style: 'dark',
        links: [
          {
            title: 'Docs',
            items: [
              {label: 'Introduction', to: '/docs/intro'},
              {label: 'Quick start', to: '/docs/getting-started/quickstart-docker'},
              {label: 'Guides', to: '/docs/guides'},
              {label: 'Reference', to: '/docs/reference/configuration'},
            ],
          },
          {
            title: 'Community',
            items: [
              {
                label: 'GitHub Discussions',
                href: 'https://github.com/ProjectBay/openbucket/discussions',
              },
              {
                label: 'Issues',
                href: 'https://github.com/ProjectBay/openbucket/issues',
              },
            ],
          },
          {
            title: 'More',
            items: [
              {
                label: 'GitHub',
                href: 'https://github.com/ProjectBay/openbucket',
              },
              {
                label: 'npm: @openbucket/nestjs',
                href: 'https://www.npmjs.com/package/@openbucket/nestjs',
              },
            ],
          },
        ],
        copyright: `Copyright © ${new Date().getFullYear()} OpenBucket contributors. MIT licensed. Built with Docusaurus.`,
      },
      prism: {
        theme: prismThemes.github,
        darkTheme: prismThemes.dracula,
        additionalLanguages: ['bash', 'json'],
      },
    }),
};

export default config;
