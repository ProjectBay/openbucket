import type { Surface } from './request-metrics.service';
import { RouteClass, StatusClass, routeClass, statusClass } from './route-class';

/** TEST-1202 — bounded label derivation for the Prometheus HTTP metrics. */
describe('route-class label derivation (TEST-1202)', () => {
  describe('statusClass', () => {
    it('collapses codes to their class', () => {
      expect(statusClass(100)).toBe('1xx');
      expect(statusClass(200)).toBe('2xx');
      expect(statusClass(204)).toBe('2xx');
      expect(statusClass(301)).toBe('3xx');
      expect(statusClass(404)).toBe('4xx');
      expect(statusClass(499)).toBe('4xx');
      expect(statusClass(500)).toBe('5xx');
      expect(statusClass(503)).toBe('5xx');
    });

    it('boundary codes land in the expected class', () => {
      expect(statusClass(199)).toBe('1xx');
      expect(statusClass(299)).toBe('2xx');
      expect(statusClass(399)).toBe('3xx');
    });

    it('out-of-range codes clamp to a valid class (no new series)', () => {
      expect(statusClass(0)).toBe('1xx');
      expect(statusClass(-1)).toBe('1xx');
      expect(statusClass(600)).toBe('5xx');
      expect(statusClass(999)).toBe('5xx');
    });

    it('only ever yields one of the five status classes', () => {
      const seen = new Set<StatusClass>();
      for (let code = 0; code <= 999; code++) seen.add(statusClass(code));
      expect([...seen].sort()).toEqual(['1xx', '2xx', '3xx', '4xx', '5xx']);
    });
  });

  describe('routeClass', () => {
    it('admin surface is always the constant "admin"', () => {
      expect(routeClass('admin', undefined)).toBe('admin');
      expect(routeClass('admin', 's3-object')).toBe('admin'); // scope ignored off the s3 surface
    });

    it('s3 surface uses the classifier scope', () => {
      expect(routeClass('s3', 's3-service')).toBe('s3-service');
      expect(routeClass('s3', 's3-bucket')).toBe('s3-bucket');
      expect(routeClass('s3', 's3-object')).toBe('s3-object');
    });

    it('s3 surface with an unset/unknown scope falls back to "s3"', () => {
      expect(routeClass('s3', undefined)).toBe('s3');
      expect(routeClass('s3', 'something-else')).toBe('s3');
    });

    it('never emits a value outside the finite route-class set', () => {
      const allowed: RouteClass[] = ['admin', 's3-service', 's3-bucket', 's3-object', 's3'];
      const surfaces: Surface[] = ['admin', 's3'];
      const scopes = [undefined, 's3-service', 's3-bucket', 's3-object', 'evil', ''];
      const seen = new Set<string>();
      for (const s of surfaces) for (const sc of scopes) seen.add(routeClass(s, sc));
      for (const v of seen) expect(allowed).toContain(v);
      // Cardinality bound: at most |surfaces| × |route classes| distinct series.
      expect(seen.size).toBeLessThanOrEqual(allowed.length);
    });
  });
});
