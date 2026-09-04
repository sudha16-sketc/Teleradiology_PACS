/**
 * Deterministic role-based navigation tests for the web permission model.
 *
 * These functions live in apps/web but are pure (no React/DOM), so they are
 * tested here through the API's existing Jest harness rather than adding a new
 * test runner to the web workspace.
 */
import { navigationForRole, roleHasAccess } from '../../web/src/lib/permissions.js';

const ALL_ROLES = ['ADMIN', 'MANAGER', 'RADIOLOGIST', 'HOSPITAL'] as const;

describe('Phase 3 -- role-based navigation (permissions.ts)', () => {
  it('UI-ROLE-1a: roleHasAccess restricts each role to its authorized routes', () => {
    // ADMIN bypasses all rules.
    expect(roleHasAccess('ADMIN', '/audit')).toBe(true);
    expect(roleHasAccess('ADMIN', '/settings/users')).toBe(true);

    // MANAGER: operational + admin-view routes. The /hospitals prefix is
    // intentionally open to managers (hospital management); nav hides the
    // hospital-only submit flow (verified in UI-ROLE-1c).
    expect(roleHasAccess('MANAGER', '/worklist')).toBe(true);
    expect(roleHasAccess('MANAGER', '/analytics')).toBe(true);
    expect(roleHasAccess('MANAGER', '/hospitals')).toBe(true);

    // HOSPITAL: own flows only, no manager/admin operational navigation.
    expect(roleHasAccess('HOSPITAL', '/hospitals')).toBe(true);
    expect(roleHasAccess('HOSPITAL', '/worklist')).toBe(false);
    expect(roleHasAccess('HOSPITAL', '/analytics')).toBe(false);
    expect(roleHasAccess('HOSPITAL', '/audit')).toBe(false);

    // RADIOLOGIST: assignment worklist + reading, no admin/manager nav.
    expect(roleHasAccess('RADIOLOGIST', '/worklist')).toBe(true);
    expect(roleHasAccess('RADIOLOGIST', '/reading')).toBe(true);
    expect(roleHasAccess('RADIOLOGIST', '/analytics')).toBe(false);
    expect(roleHasAccess('RADIOLOGIST', '/audit')).toBe(false);
    expect(roleHasAccess('RADIOLOGIST', '/hospitals')).toBe(false);
  });

  it('UI-ROLE-1b: orphan /queue routes are NOT globally accessible', () => {
    // Only ADMIN/MANAGER may reach the operational queue.
    for (const role of ALL_ROLES) {
      const expected = role === 'ADMIN' || role === 'MANAGER';
      expect(roleHasAccess(role, '/queue')).toBe(expected);
      expect(roleHasAccess(role, '/queue/verification')).toBe(expected);
    }
  });

  it('UI-ROLE-1c: each role only sees its own navigation items', () => {
    const adminNav = navigationForRole('ADMIN');
    const adminHrefs = adminNav.map((n) => n.href);
    expect(adminHrefs).toContain('/audit');
    expect(adminHrefs).toContain('/settings');
    expect(adminHrefs).toContain('/admin/registration-requests');

    const managerNav = navigationForRole('MANAGER');
    const managerHrefs = managerNav.map((n) => n.href);
    // Manager sees operational queue + analytics, not admin-only items.
    expect(managerHrefs).toContain('/worklist');
    expect(managerHrefs).toContain('/analytics');
    expect(managerHrefs).not.toContain('/audit');
    expect(managerHrefs).not.toContain('/settings');
    expect(managerHrefs).not.toContain('/admin/registration-requests');

    const radNav = navigationForRole('RADIOLOGIST');
    const radHrefs = radNav.map((n) => n.href);
    expect(radHrefs).toContain('/worklist');
    expect(radHrefs).toContain('/reading');
    expect(radHrefs).not.toContain('/analytics');
    expect(radHrefs).not.toContain('/audit');
    expect(radHrefs).not.toContain('/hospitals/submit');

    const hospitalNav = navigationForRole('HOSPITAL');
    const hospitalHrefs = hospitalNav.map((n) => n.href);
    expect(hospitalHrefs).toContain('/hospitals');
    expect(hospitalHrefs).toContain('/hospitals/submit');
    expect(hospitalHrefs).toContain('/hospitals/reports');
    expect(hospitalHrefs).not.toContain('/worklist');
    expect(hospitalHrefs).not.toContain('/reading');
    expect(hospitalHrefs).not.toContain('/analytics');
  });
});
