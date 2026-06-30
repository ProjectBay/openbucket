// @ts-check
// Docusaurus config for the OpenBucket documentation site.
// Deployed to GitHub Pages at https://projectbay.github.io/openbucket/
// See: https://docusaurus.io/docs/api/docusaurus-config

import {themes as prismThemes} from 'prism-react-renderer';

/** @type {import('@docusaurus/types').Config} */
const config = {
  title: 'OpenBucket',
  tagline:
    'A self-hosted, S3-compatible object store you can run as a container — or embed in a NestJS app.',
  favicon: 'img/favicon.ico',

  future: {
    v4: true, // forward-compat with Docusaurus v4
  },

  // GitHub Pages: https://projectbay.github.io/openbucket/
  url: 'https://projectbay.github.io',
  baseUrl: '/openbucket/',
  organizationName: 'ProjectBay',
  projectName: 'openbucket',

  onBrokenLinks: 'throw',

  markdown: {
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
            'https://github.com/ProjectBay/openbucket/tree/main/website/',
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
          alt: 'OpenBucket logo',
          src: 'img/logo.svg',
        },
        items: [
          {
            type: 'docSidebar',
            sidebarId: 'docsSidebar',
            position: 'left',
            label: 'Docs',
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
              {label: 'Getting started', to: '/docs/getting-started'},
              {label: 'Embedding in NestJS', to: '/docs/embedding'},
              {label: 'Architecture', to: '/docs/architecture'},
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
