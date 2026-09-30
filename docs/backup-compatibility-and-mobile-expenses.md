# Preview 8: backup compatibility and mobile expense inputs

## Problems and resulting behavior

The journal's generic inline input rule affected inputs nested in vertical labels, forcing expense amounts to zero width. Amounts now use a dedicated responsive grid, and the generic rule only applies to direct child inputs. Blank amounts remain unknown; entering zero still records a free expense. Bill and item accounting rules are unchanged.

Task backup parsing previously had separate legacy and workspace paths. Android acknowledged exports before closing the destination stream and did not verify saved bytes. Browser downloads revoked their Blob URL immediately. These are confirmed weaknesses; the individual reported `Unexpected end of JSON input` cannot be attributed to one of them without the original failing file.

The settings page now shares a validated import path for schema 1 task backups and schema 2 workspaces. Native imports read the document picker URI directly, with bounded reads and explicit UTF-8/BOM UTF-16 decoding. Empty, truncated, wrong-domain, invalid graph and checksum-mismatched files never replace the current workspace. Successful browser restores checkpoint the previous state atomically.

Exports retain schema 2 and add optional format, export-time and data SHA-256 metadata. Old schema 2 files without checksums remain supported. Native export stages complete content, closes the destination stream and verifies its byte length and SHA-256 by reading it back before confirming success. Browser UI only confirms that a download started, since it cannot verify the final filesystem write.

## Compatibility boundaries

- The actual `9af2ecb` backup reader and writer are used by compatibility tests. New and old task workspace exports preserve the same business data; timestamps and optional metadata need not be byte-identical.
- Schema 1 only carries its actual tasks/settings. Existing reports and completion history remain intact when restoring this task-only format. Missing completion timestamps are not invented.
- Task backup excludes API keys. A restore keeps the current device's existing key and never adopts a key from an imported file.
- Journal photos and health data use their separate backup entries. Task backup is not a whole-application backup.
- Files are limited to 32 MiB. A checksum detects corruption, not a trusted sender. No attempt is made to reconstruct missing JSON bytes.
- Damaged imports preserve the current data. To diagnose the user's particular legacy file, obtain the original JSON rather than a screenshot or retyped contents.

## Validation

- 96 automated JavaScript tests passed: tasks, persistence, native bridge, journal, health and 11 backup compatibility tests.
- Production TypeScript/Vite build passed.
- Browser regression passed for invalid files, cancellation, retrying the same file, full restore, and the atomic pre-restore checkpoint.
- Expense inputs were checked at 320, 360, 393, 430 and 768 CSS pixels with real Chinese fonts. Long decimal values save and reopen correctly; blank and zero remain distinct.
- Five Android document IO instrumentation tests cover close failures, exact saved bytes, BOM decoding, invalid encoding/oversize input and protection against empty export truncating a previous file. Their execution, and the native build, are verified by the branch's Android workflow rather than claimed from browser tests.
- Run 36698165564 built both Android variants and passed the five new document tests plus existing storage tests. Two UI tests were blocked by a captured system `Quickstep isn't responding` dialog. UI setup now clears only emulator launcher processes and checks application window focus before real touch injection; TodoTree failures remain visible. The full suite is rerun after this test environment correction.

## Native packaging

Version code is 8, version name `1.0.0-life-preview.8`. Application IDs and existing signing configuration are unchanged. CI debug signing alone does not establish that an APK can update a separately signed previous preview; do not ask users to uninstall their only copy of data to try an update.

The native storage test no longer assumes the release package ID when running the preview package. CI checks out full Git history for the historical compatibility test and runs the new backup/expense browser regression.
