import { createSidebarConfig, SidebarConfig } from '../types';

export const sidebarConfig: SidebarConfig = {
  groups: [
    createSidebarConfig.group({
      id: 'storage',
      label: 'sidebar.storage.label',
      items: [
        createSidebarConfig.item({
          id: 'dashboard',
          title: 'sidebar.storage.dashboard',
          icon: 'lucideLayoutDashboard',
          url: '/',
          exact: true,
        }),
        createSidebarConfig.item({
          id: 'buckets',
          title: 'sidebar.storage.buckets',
          icon: 'lucideDatabase',
          url: '/buckets',
        }),
        createSidebarConfig.item({
          id: 'keys',
          title: 'sidebar.storage.keys',
          icon: 'lucideKey',
          url: '/keys',
        }),
        createSidebarConfig.item({
          id: 'settings',
          title: 'sidebar.storage.settings',
          icon: 'lucideSettings',
          url: '/settings',
        }),
        createSidebarConfig.item({
          id: 'backup-restore',
          title: 'sidebar.admin.backupRestore',
          icon: 'lucideArchive',
          url: '/backup-restore',
        }),
        createSidebarConfig.item({
          id: 'replication',
          title: 'sidebar.admin.replication',
          icon: 'lucideRefreshCw',
          url: '/replication',
        }),
      ],
    }),
  ],
};

// Reserved for future secondary navigation (Help/Docs); empty for now.
export const secondaryNavConfig: SidebarConfig = {
  groups: [],
};
