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
        // Access Keys, Admin Users, Backup & Restore, Replication and Audit Log
        // now live as tabs inside /settings.
        createSidebarConfig.item({
          id: 'settings',
          title: 'sidebar.storage.settings',
          icon: 'lucideSettings',
          url: '/settings',
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

/**
 * The console indicator (STORY-1204): stamp a small red (destructive) badge with
 * the corrupt-object count onto the `settings` item — where the Integrity tab
 * lives. Pure and hidden at zero (no badge when `corruptCount <= 0`), so the
 * indicator only appears when there is corruption to surface. Used by the shell
 * sidebars via a computed over `IntegritySignalStore.corrupt()`.
 */
export function sidebarConfigWithIntegrityBadge(
  config: SidebarConfig,
  corruptCount: number,
): SidebarConfig {
  if (corruptCount <= 0) return config;
  return {
    groups: config.groups.map((group) => ({
      ...group,
      items: group.items.map((item) =>
        item.type === 'item' && item.id === 'settings'
          ? { ...item, badge: { content: corruptCount, variant: 'destructive' as const } }
          : item,
      ),
    })),
  };
}
