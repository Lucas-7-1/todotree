# Persistent workspace and bulk task operations

## Changes

The desktop host now uses `%LOCALAPPDATA%\TodoTree\data\workspace.json` as the authoritative workspace. A single versioned snapshot contains tasks, completion events, settings, AI settings, reports and generation attempts. Browser-only usage uses one IndexedDB transaction. Browser storage is a recovery cache, not confirmation that a desktop disk write succeeded.

All writes use an expected revision and operation ID. Requests are serialized in the client and host. Stale revisions are rejected, a lost acknowledgement can retry the exact request, and failed writes pause editing with a recovery copy instead of reporting success. Task completion and its audit events are generated and committed together. Reconnection no longer reloads an older snapshot over pending edits.

The host writes a temporary file, calls `Flush(true)`, and uses `File.Replace` for existing snapshots. The old main file is never deleted first. A daily pre-write backup retains 14 dates. Explicit checkpoints precede imports, resets and permanent removal. Backup files stay on the same disk; users should export complete backups to another device/location for hardware failure protection.

## Upgrade and recovery

1. Close old TodoTree processes and export/copy the old data before upgrading.
2. Build **both** the frontend and the new host (instructions below). Replacing TypeScript alone does not update the old EXE.
3. On first start the host inspects the old executable's `data` directory and the fixed LocalAppData directory. Original files remain untouched, and a migration copy is created.
4. Different valid legacy datasets require explicit source selection. Corrupt data blocks initialization rather than resetting to an empty workspace. The recovery screen can list validated checkpoints and open the data folder.
5. A failed/ambiguous browser request retains its complete candidate. Retry saves the same operation. Conflicts must be exported/reviewed; they are never resolved by blindly incrementing a revision. The recovery screen can export that candidate and explicitly discard the pending marker after export.

The data folder and last successful save time are shown in Settings. Complete JSON exports include history and reports but omit the API key. An imported backup preserves the local API key. Old task/settings-only backups remain importable and retain existing report/history data.

If a *legacy* file is malformed and no valid versioned recovery point exists, the original file remains available through “打开数据目录” for manual repair. The application does not guess which damaged data to replace. Old EXEs must not be run against the new workspace: legacy write endpoints return an upgrade error.

## Completion and selection

- Normal completion checkboxes accumulate a pending set. One bottom confirmation commits the set; an unsuccessful batch preserves the checks.
- “多选” is a separate mode: selection never means completed. Supported batch operations are completion, explicit archive (“搞定”), quadrant, deadline, today planning and recycle-bin removal.
- Shift selects the displayed range. “全选当前结果” uses the full filter result, not mounted rows. Context-only ancestors are excluded. Filter changes clear explicit selection; pending completion remains until confirmed/cancelled.
- Leaving the tree with pending completion offers confirm/discard/stay. Refresh uses an unsaved-work warning.
- Subtree operations deduplicate selected ancestors/descendants. Property changes modify explicit selections only. One batch creates one undo step. Delete/Backspace previews batch deletion without affecting text editing.
- An intermediate completed branch stays struck through while any sibling branch under the actual root remains open. Only root-wide completion automatically archives the tree. “搞定” archives an already completed subtree early.
- Exit animation runs after acknowledgement on a bounded visual copy; persistence does not depend on an animation callback.

## Validation

Run `npm ci`, then `npm test` and `npm run build`.

The suite exercises the real TypeScript, React components and App, plus isolated actual persistence modules with simulated disk failure, stale/conflicting versions, malformed/empty responses, unacknowledged candidates, ordered writes, idempotent retry, task/event atomicity and full backup redaction/validation. Mocks cannot prove Windows filesystem crash durability.

The Windows workflow `.github/workflows/windows-validation.yml` compiles and executes `tests/host-persistence.cs` against the real C# store, then builds a desktop executable artifact. It covers migration, conflict protection, backups, reopen, corrupt-file preservation and restore. A physical Windows reboot/power-loss test and visual frame-rate review remain release checks.

Manual Windows commands:

```powershell
npm ci
npm test
npm run build
node bundle-singlefile.mjs
$compiler = "$env:WINDIR\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
& $compiler /nologo /r:System.Web.Extensions.dll /out:host-tests.exe desktop-host\DurableWorkspace.cs tests\host-persistence.cs
if ($LASTEXITCODE -ne 0) { throw 'Host test compilation failed' }
.\host-tests.exe
if ($LASTEXITCODE -ne 0) { throw 'Host persistence tests failed' }
& $compiler /nologo /target:winexe /r:System.Web.Extensions.dll /out:TodoTree.exe /resource:dist\TodoTree_一键直达.html desktop-host\Program.cs desktop-host\DurableWorkspace.cs
```

Do not distribute the previously tracked TodoTree.exe as this release; it has not been rebuilt by editing these sources. Do not overwrite user data when deploying.
