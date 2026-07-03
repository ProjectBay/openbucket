import { Injectable, inject, signal } from '@angular/core';
import {
  ActivatedRoute,
  ActivatedRouteSnapshot,
  NavigationEnd,
  Router,
} from '@angular/router';
import { filter } from 'rxjs/operators';

export interface Breadcrumb {
  label: string;
  url: string;
  isLast: boolean;
}

@Injectable({ providedIn: 'root' })
export class BreadcrumbService {
  private readonly router = inject(Router);
  private readonly activatedRoute = inject(ActivatedRoute);

  private readonly _breadcrumbs = signal<Breadcrumb[]>([]);
  readonly breadcrumbs = this._breadcrumbs.asReadonly();

  constructor() {
    this._breadcrumbs.set(this.buildBreadcrumbs(this.activatedRoute.root));
    this.router.events
      .pipe(filter((e) => e instanceof NavigationEnd))
      .subscribe(() => {
        this._breadcrumbs.set(this.buildBreadcrumbs(this.activatedRoute.root));
      });
  }

  private buildBreadcrumbs(
    route: ActivatedRoute,
    url = '',
    breadcrumbs: Breadcrumb[] = [],
  ): Breadcrumb[] {
    const children: ActivatedRoute[] = route.children;
    if (children.length === 0) {
      if (breadcrumbs.length > 0) {
        breadcrumbs[breadcrumbs.length - 1].isLast = true;
      }
      return breadcrumbs;
    }

    for (const child of children) {
      const snap: ActivatedRouteSnapshot = child.snapshot;
      if (snap.url.length === 0) {
        return this.buildBreadcrumbs(child, url, breadcrumbs);
      }
      const routeURL = snap.url.map((s) => s.path).join('/');
      url += `/${routeURL}`;
      // Use the route's OWN data, not `snap.data` — Angular merges parent data
      // into children, so a `:name` child would otherwise inherit its parent's
      // `breadcrumb` (rendering "Buckets > Buckets" instead of the bucket name).
      const label = snap.routeConfig?.data?.['breadcrumb'];
      if (label) {
        breadcrumbs.push({ label, url, isLast: false });
      } else if (snap.routeConfig?.path?.includes(':')) {
        // Dynamic segment (e.g. :name): the matched URL already holds the real
        // value (the bucket name), so use it directly instead of dropping it.
        breadcrumbs.push({ label: routeURL, url, isLast: false });
      } else {
        breadcrumbs.push({
          label: this.generateLabelFromPath(routeURL),
          url,
          isLast: false,
        });
      }
      return this.buildBreadcrumbs(child, url, breadcrumbs);
    }

    return breadcrumbs;
  }

  private generateLabelFromPath(path: string): string {
    return path
      .split('-')
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  }
}
