# Mesima 4.8 verification — 2026-09-17

Release: web 4.8; Android package il.mesima.app, versionName 1.7, versionCode 17; Windows 4.8 x64.

## Passed

- **34 Node tests** (`node --test tests/*.test.mjs`). Includes legacy backup/retention, transactions, multi-project membership, native completion replay, transport validation, concurrent sync merges, and 13 new checks in reflection-48.test.mjs.
- New model checks cover history independent of archive; duplicate completion and undo; title/project snapshots; next-day reminders; no elapsed reminder on undo; recurring checklist cycles and multiple reminder times; standalone checklist completion; daily 18:00 boundary; past/future dates; Sunday-to-Saturday range across a DST boundary; all 25 completion rows visible on expansion; escaped free text; all seven daily notes in weekly summary; project/event links without scheduling; manual sublocation coordinate inheritance; task relations; concurrent completions and separate daily/weekly notes across devices; legacy migration without invented times.
- **12 Android JVM unit tests, zero failures/errors**: BackupsTest 3, CloudSyncHttpTest 3, NativeStateTest 5, UpdaterVersionTest 1. Native tests include day-specific pending completion, completed unarchived tasks, recurring checklist cycle cancellation/undo, and persisted trip state.
- **6 new browser UI scenarios** (`tools/ui-48-test.mjs`): 18:00 visibility, all completion rows, note persistence/focus during store updates, historical/future dates, independent day/week expansion, seven-day content, project/event picker and reverse navigation, staged task relations, manual sublocation create/edit, mobile and desktop layouts. No browser JavaScript errors.
- **6 existing 4.7 UI scenarios** (`tools/ui-47-test.mjs`): inline child expansion, long-press reorder, Today reset, notification text/completion, stable search/save, full-width desktop.
- **9 existing editor/settings scenarios** (`tools/ui-test.mjs`): cancelled checklist drafts, focused input saves, conversion reversal, direct description copy and opt-in archive retention. No browser JavaScript errors.
- **5 Android/desktop transport integration scenarios** (`tools/sync-native-transport-test.mjs`): Android bridge upload and desktop download while browser fetch fails, offline merge, deletion, conditional commit conflict, network retry and permission-error recovery. Synthetic cloud backend; no user cloud data was modified.
- **Packaged Windows launch/restart** (`tools/desktop-test.mjs`): isolated renderer, cloud UI, local snapshot, project persistence, completion history and reflection persistence, cancellation of a snoozed notification after occurrence completion. Uses a disposable profile.
- **Signed APK verification** (`tools/verify-release.py`): same signing certificate as original 4.4; APK assets/index.html exactly equals release index.html. Certificate SHA-256: `5e94ddd181cb9f72fd89f6911db2059c986a85db9abd14d1da19b6efee727d42`.
- Original 4.4 source artifacts checked against existing SHA-256 manifest and unchanged.
- Mobile daily/weekly screenshots and a desktop screenshot captured under test-results. Daily expanded and weekly layouts visually inspected.

## Physical-device boundary

No physical Android device or emulator was connected. Actual notification tone/vibration, AlarmManager delivery during sleep and OEM background behavior were not physically exercised. Android code compiled and its cancellation rules passed JVM tests. After installing, verify a two-reminder habit: complete after the first reminder; confirm the second is absent and next-day reminders remain.

## Compatibility

Update every syncing client to 4.8. New completions/reflections collections are not understood by old clients. Firebase rules are unchanged. A same-note simultaneous edit uses the existing deterministic field conflict resolution; text paragraphs are not merged. No exact completion time is invented for legacy habit logs.

## Delivery

Release artifacts are saved in App Version 4.8. After user approval, the signed APK and source archive were uploaded to the user's Google Drive. Windows delivery was cancelled at the user's request. The GitHub publication uses the same verified index.html and signed APK; the repository contains canonical source files, with local signing keys, private configuration, build logs and legacy duplicate uploads excluded from the current tree.
