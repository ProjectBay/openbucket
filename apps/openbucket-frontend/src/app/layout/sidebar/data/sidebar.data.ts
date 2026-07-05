import { createSidebarConfig, SidebarConfig, SidebarItem } from '../types';

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
          id: 'search',
          title: 'sidebar.storage.search',
          icon: 'lucideSearch',
          url: '/search',
        }),
        createSidebarConfig.item({
          id: 'keys',
          title: 'sidebar.storage.keys',
          icon: 'lucideKey',
          url: '/keys',
        }),
        createSidebarConfig.item({
          id: 'users',
          title: 'sidebar.admin.users',
          icon: 'lucideUsers',
          url: '/users',
          // EPIC-11: full-admin only. Hidden from read-only admins (fullAdminGuard
          // also redirects a deep-link); the server RolesGuard is authoritative.
          requiresFullAdmin: true,
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
        createSidebarConfig.item({
          id: 'audit',
          title: 'sidebar.admin.audit',
          icon: 'lucideScrollText',
          url: '/audit',
        }),
      ],
    }),
  ],
};

// Reserved for future secondary navigation (Help/Docs); empty for now.
export const secondaryNavConfig: SidebarConfig = {
  groups: [],
};

/** True if a sidebar item is visible to a principal with the given role (EPIC-11). */
function itemVisible(item: SidebarItem, isFullAdmin: boolean): boolean {
  return !('requiresFullAdmin' in item && item.requiresFullAdmin) || isFullAdmin;
}

/**
 * Project a sidebar config for a principal's role (EPIC-11): drops
 * full-admin-only entries (e.g. `/users`) for read-only admins. Pure — used by
 * the shell sidebars via a computed over `AuthService.isFullAdmin()`.
 */
export function sidebarConfigForRole(
  config: SidebarConfig,
  isFullAdmin: boolean,
): SidebarConfig {
  return {
    groups: config.groups.map((group) => ({
      ...group,
      items: group.items.filter((item) => itemVisible(item, isFullAdmin)),
    })),
  };
}
