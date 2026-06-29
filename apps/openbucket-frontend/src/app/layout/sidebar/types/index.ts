export interface SidebarItemBase {
  id?: string;
  title: string;
  icon?: string;
  url?: string;
  disabled?: boolean;
  /** Exact router-link match (set for index routes like `/` so they don't stay active everywhere). */
  exact?: boolean;
}

export interface SidebarBadge {
  content: string | number;
  variant?: 'default' | 'secondary' | 'destructive' | 'outline';
}

export interface SidebarMenuItem {
  label?: string;
  icon?: string;
  onClick?: () => void;
  separator?: boolean;
  isLabel?: boolean;
  disabled?: boolean;
}

export interface SidebarItemAction {
  type: 'dropdown' | 'button';
  icon?: string;
  ariaLabel?: string;
  showOnHover?: boolean;
  menuItems?: SidebarMenuItem[];
  onClick?: () => void;
}

export interface SidebarSubItem extends SidebarItemBase {
  type: 'sub-item';
}

export interface SimpleSidebarItem extends SidebarItemBase {
  type: 'item';
  badge?: SidebarBadge;
  action?: SidebarItemAction;
}

export interface CollapsibleSidebarItem extends SidebarItemBase {
  type: 'collapsible';
  items: SidebarSubItem[];
  defaultOpen?: boolean;
  badge?: SidebarBadge;
}

export interface SubmenuSidebarItem extends SidebarItemBase {
  type: 'submenu';
  items: SidebarSubItem[];
  badge?: SidebarBadge;
}

export interface SidebarSeparator {
  type: 'separator';
  id?: string;
}

export interface SidebarSkeleton {
  type: 'skeleton';
  count?: number;
  id?: string;
}

export type SidebarItem =
  | SimpleSidebarItem
  | CollapsibleSidebarItem
  | SubmenuSidebarItem
  | SidebarSeparator
  | SidebarSkeleton;

export interface SidebarGroupAction {
  icon: string;
  ariaLabel: string;
  onClick?: () => void;
  title?: string;
}

export interface SidebarGroup {
  type: 'group';
  id?: string;
  label?: string;
  collapsible?: boolean;
  defaultOpen?: boolean;
  groupAction?: SidebarGroupAction;
  items: SidebarItem[];
}

export interface SidebarConfig {
  groups: SidebarGroup[];
}

export type SidebarConfigBuilder = {
  group: (config: Omit<SidebarGroup, 'type'>) => SidebarGroup;
  item: (config: Omit<SimpleSidebarItem, 'type'>) => SimpleSidebarItem;
  collapsible: (
    config: Omit<CollapsibleSidebarItem, 'type'>,
  ) => CollapsibleSidebarItem;
  submenu: (config: Omit<SubmenuSidebarItem, 'type'>) => SubmenuSidebarItem;
  subItem: (config: Omit<SidebarSubItem, 'type'>) => SidebarSubItem;
  separator: () => SidebarSeparator;
  skeleton: (count?: number) => SidebarSkeleton;
};

export const createSidebarConfig: SidebarConfigBuilder = {
  group: (config) => ({ type: 'group' as const, ...config }),
  item: (config) => ({ type: 'item' as const, ...config }),
  collapsible: (config) => ({ type: 'collapsible' as const, ...config }),
  submenu: (config) => ({ type: 'submenu' as const, ...config }),
  subItem: (config) => ({ type: 'sub-item' as const, ...config }),
  separator: () => ({ type: 'separator' as const }),
  skeleton: (count = 3) => ({ type: 'skeleton' as const, count }),
};
