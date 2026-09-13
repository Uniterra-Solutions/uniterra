/**
 * PBT suite for the CLI's launch-surface plan (#28) — `planSurfaces` in
 * `src/install-logic.ts`, compiled dist.
 *
 * Business invariants locked here:
 *  - SURFACE-UNIQUE: for ANY command/open/dry-run/platform/destination there is
 *    at most one Electron launch, it exists exactly when the run was asked to
 *    open the app and is not a dry run, it targets the Electron app of that
 *    platform — and a browser surface NEVER appears. Issue #28 is the defect
 *    where an update produced a second (web) surface beside the app.
 *  - SURFACE-NOOPEN: with `--no-open` the surface list is empty — nothing may
 *    be launched in any other shape (a browser, a system opener, a detached
 *    spawn) as a "replacement" for the suppressed launch.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fc from 'fast-check';
import { launchTarget, planSurfaces, type InstallPlatform } from '../dist/install-logic.js';

const commandArb = fc.constantFrom<'setup' | 'update'>('setup', 'update');
const platformArb = fc.constantFrom<InstallPlatform>('macos', 'windows');
const destinationArb = fc.oneof(
  { weight: 2, arbitrary: fc.constant('/Users/someone/Applications/Uniterra.app') },
  { weight: 1, arbitrary: fc.constant('C:\\Users\\someone\\AppData\\Local\\Programs\\Uniterra') },
  { weight: 2, arbitrary: fc.string({ maxLength: 40 }) },
  { weight: 1, arbitrary: fc.constant('') },
  { weight: 1, arbitrary: fc.constant('   ') },
  { weight: 1, arbitrary: fc.constant('/tmp/üniçode 路徑/Uniterra.app') },
);

test('SURFACE-UNIQUE: one Electron launch at most, never a browser', () => {
  fc.assert(
    fc.property(
      commandArb,
      fc.boolean(),
      fc.boolean(),
      platformArb,
      destinationArb,
      (command, open, dryRun, platform, destination) => {
        const surfaces = planSurfaces(command, open, dryRun, platform, destination);
        const electron = surfaces.filter((surface) => surface.kind === 'electron-app');
        const browser = surfaces.filter((surface) => surface.kind === 'browser');
        assert.equal(
          browser.length,
          0,
          `a browser surface is the #28 defect, got ${JSON.stringify(surfaces)}`,
        );
        assert.ok(electron.length <= 1, 'at most one Electron launch per run');
        assert.equal(
          electron.length,
          open && !dryRun ? 1 : 0,
          'the app is launched exactly when the run opens it and is not a dry run',
        );
        if (electron[0] !== undefined) {
          assert.equal(electron[0].target, launchTarget(platform, destination));
          assert.ok(
            !/^[a-z]+:\/\//iu.test(electron[0].target),
            'the Electron surface is a path to the app, never a URL',
          );
        }
        assert.equal(
          surfaces.length,
          electron.length,
          'the plan contains nothing but Electron launches',
        );
      },
    ),
    { numRuns: 400 },
  );
});

test('SURFACE-NOOPEN: with --no-open nothing is launched at all', () => {
  fc.assert(
    fc.property(
      commandArb,
      fc.boolean(),
      platformArb,
      destinationArb,
      (command, dryRun, platform, destination) => {
        assert.deepEqual(
          planSurfaces(command, false, dryRun, platform, destination),
          [],
          '--no-open means zero surfaces, whatever else is asked for',
        );
      },
    ),
    { numRuns: 200 },
  );
});

test('SURFACE-NOOPEN regression: a dry run launches nothing, even with open requested', () => {
  assert.deepEqual(planSurfaces('update', true, true, 'macos', '/Applications/Uniterra.app'), []);
  assert.deepEqual(
    planSurfaces('setup', true, true, 'windows', 'C:\\Uniterra'),
    [],
    'a dry run must not reach the OS at all',
  );
});
