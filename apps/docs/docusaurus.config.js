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
  favicon: 'img/logo-icon.png',

  // Load Inter (set as --ifm-font-family-base in src/css/custom.css).
  stylesheets: [
    'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap',
  ],

  // Privacy-friendly, cookieless analytics via our self-hosted Plausible
  // instance (https://analytics.projectbay.dev). `data-domain` is the site
  // name registered in Plausible; it matches this docs site's public URL.
  scripts: [
    {
      src: 'https://analytics.projectbay.dev/js/script.js',
      defer: true,
      'data-domain': 'projectbay.github.io/openbucket',
    },
  ],

  future: {
    v4: true, // forward-compat with Docusaurus v4
  },

  // GitHub Pages: https://projectbay.github.io/openbucket/
  url: 'https://projectbay.github.io',
  baseUrl: '/openbucket/',
  organizationName: 'ProjectBay',
  projectName: 'openbucket',

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
        blog: {
          showReadingTime: true,
          blogTitle: 'OpenBucket blog',
          blogDescription:
            'Tutorials, recipes, and updates from the OpenBucket project.',
          postsPerPage: 10,
          blogSidebarTitle: 'Recent posts',
          blogSidebarCount: 'ALL',
          // RSS/Atom feeds power dev.to/Hashnode syndication and Google Discover.
          feedOptions: {
            type: ['rss', 'atom'],
            title: 'OpenBucket blog',
            description:
              'Tutorials, recipes, and updates from the OpenBucket project.',
            copyright: `Copyright © ${new Date().getFullYear()} OpenBucket contributors.`,
          },
        },
        theme: {
          customCss: './src/css/custom.css',
        },
        sitemap: {
          lastmod: 'date',
          changefreq: 'weekly',
          priority: 0.5,
          filename: 'sitemap.xml',
        },
      }),
    ],
  ],

  // Structured data (JSON-LD) — describes the project to search engines as a
  // SoftwareApplication so it can qualify for richer results.
  headTags: [
    {
      tagName: 'script',
      attributes: {type: 'application/ld+json'},
      innerHTML: JSON.stringify({
        '@context': 'https://schema.org',
        '@type': 'SoftwareApplication',
        name: 'OpenBucket',
        applicationCategory: 'DeveloperApplication',
        operatingSystem: 'Linux, macOS, Windows, Docker',
        description:
          'A self-hosted, S3-compatible object store you can run as a container — or embed in a NestJS app. Speaks the Amazon S3 wire protocol (SigV4, presigned URLs, multipart, versioning, object lock) from a single Node.js process.',
        url: 'https://projectbay.github.io/openbucket/',
        license: 'https://opensource.org/licenses/MIT',
        codeRepository: 'https://github.com/ProjectBay/openbucket',
        offers: {
          '@type': 'Offer',
          price: '0',
          priceCurrency: 'USD',
        },
      }),
    },
  ],

  themeConfig:
    /** @type {import('@docusaurus/preset-classic').ThemeConfig} */
    ({
      // Default Open Graph / Twitter share image (branded 1200×630 card).
      image: 'img/openbucket-social-card.png',
      // Global <meta> tags. Docusaurus already emits og:* and twitter:card
      // (summary_large_image, from `image` above); this adds keywords + author.
      metadata: [
        {
          name: 'keywords',
          content:
            'S3-compatible, object store, self-hosted, NestJS, S3 API, SigV4, presigned URLs, MinIO alternative, self-hosted S3, Docker, Node.js, TypeScript',
        },
        {name: 'author', content: 'OpenBucket contributors'},
        // Google Search Console ownership verification for the URL-prefix
        // property https://projectbay.github.io/openbucket/ — must stay in
        // place permanently (Google rechecks it periodically).
        {
          name: 'google-site-verification',
          content: '385QXR-SSO8L38WaH39K5Su1q3j0_B0ZcK-LHq0CCeY',
        },
      ],
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
            to: '/blog',
            position: 'left',
            label: 'Blog',
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
