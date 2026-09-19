# Mesima 4.9 validation

- 37 Node model tests passed: existing reminders/reflections/sync, independent note-part merge and deletion, widget eligibility and non-scheduling, overlapping events, recurring checklist carryover, persisted trip expiry.
- Browser integration at 412 × 915 passed: read/edit notes, opt-in multipart conversion preserving existing content, independent editing and createdAt, independent folds after reload, hierarchical widget selection and reconfiguration, no habit selections, note preview opt-in, shopping selection, compact membership UI, scrollable modals with no visible scrollbar.
- The previous 4.8 browser regression suite also passed, including daily/weekly reflection persistence, project-event navigation, related tasks, manual sublocations and desktop layout.
- 18 Android JVM tests passed, including five widget presentation cases and six native state/trip cases. Calendar range is rolling seven days; task/manual deduplication and completion are covered; shopping commands are durable/idempotent; note preview defaults and stale-choice privacy are covered.
- Signed release build uses application ID `il.mesima.app`, versionName `1.8`, versionCode `19`. The packaged bridge version and bundled HTML are checked against the APK itself before delivery.

No Android phone or emulator was connected. Launcher rendering, taps under manufacturer-specific background restrictions, and actual location hardware behaviour still require a device check. Browser tests exercise the web picker with a fake native configuration bridge; JVM tests exercise the native presentation/state model. These checks are not a physical-device test or a live two-account Firebase security test.

The separate security assessment is a source review and protection proposal, not a penetration-test certificate. No encryption of sensitive notes is claimed or implemented here. No Windows installer is built for this release.
