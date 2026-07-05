import { Routes } from '@angular/router';

import { authGuard, mustNotRotateGuard, unauthGuard } from './auth/auth.guard';

/**
 * SPA routes (§5.11). `/login` and `/force-rotate` sit outside the shell;
 * everything else is behind [authGuard, mustNotRotateGuard] under the app shell.
 * `/` renders the dashboard; unknown routes render the 404 inside the shell.
 * All feature components are lazy-loaded.
 */
export const appRoutes: Routes = [
  {
    path: 'login',
    canActivate: [unauthGuard],
    loadComponent: () => import('./auth/login.component').then((m) => m.LoginComponent),
  },
  {
    path: 'force-rotate',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./auth/force-rotate.component').then((m) => m.ForceRotateComponent),
  },

  {
    path: '',
    canActivate: [authGuard, mustNotRotateGuard],
    // Real app shell (sidebar + header, variant-switchable via AppearanceStore).
    loadComponent: () => import('./layout').then((m) => m.DynamicShellLayout),
    children: [
      {
        path: '',
        pathMatch: 'full',
        loadComponent: () => import('./home/home.component').then((m) => m.HomeComponent),
      },
      {
        path: 'buckets',
        data: { breadcrumb: 'sidebar.storage.buckets' },
        children: [
          {
            path: '',
            pathMatch: 'full',
            loadComponent: () =>
              import('./buckets/bucket-list.component').then((m) => m.BucketListComponent),
          },
          {
            path: ':name',
            children: [
              {
                path: '',
                pathMatch: 'full',
                loadComponent: () =>
                  import('./buckets/bucket-detail.component').then(
                    (m) => m.BucketDetailComponent,
                  ),
              },
              {
                path: 'browse',
                data: { breadcrumb: 'breadcrumb.objects' },
                loadComponent: () =>
                  import('./objects/object-browser.component').then(
                    (m) => m.ObjectBrowserComponent,
                  ),
              },
            ],
          },
        ],
      },
      {
        path: 'keys',
        loadComponent: () => import('./keys/keys-list.component').then((m) => m.KeysListComponent),
      },
      {
        path: 'settings',
        loadComponent: () =>
          import('./settings/settings.component').then((m) => m.SettingsComponent),
      },
      {
        path: 'backup-restore',
        data: { breadcrumb: 'sidebar.admin.backupRestore' },
        loadComponent: () =>
          import('./backup-restore/backup-restore.component').then((m) => m.BackupRestoreComponent),
      },
      {
        path: 'replication',
        data: { breadcrumb: 'sidebar.admin.replication' },
        loadComponent: () =>
          import('./replication/replication.component').then((m) => m.ReplicationComponent),
      },
      {
        path: 'about',
        data: { breadcrumb: 'about.title' },
        loadComponent: () => import('./about/about.component').then((m) => m.AboutComponent),
      },
      {
        path: '**',
        loadComponent: () =>
          import('./not-found/not-found.component').then((m) => m.NotFoundComponent),
      },
    ],
  },
];
