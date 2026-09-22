# Local release storage

The user requests old version folders be removed when a new version is completed, to reduce disk use.

Keep one current `App Version X` folder and the canonical `GitHub Mesima` checkout. Reuse Android tools, Electron downloads and Node dependencies under the sibling `.mesima-build-tools`; keep private signing/configuration files in sibling `.mesima-private`, never in the repository or public source archive. Do not recreate a full dependency tree in every release.

After the new signed APK and Windows package have passed their checks, run `tools/prune-versions.ps1 -KeepVersion X` to inspect and then with `-Apply` to clean. It updates the workspace's `Mesima.lnk` shortcut, preserves compact private source archives, copies original documents and security reports, validates those copies, checks absolute target paths and skips any version that is running. Do not force-close the user's app. Never clean the installed application's profile or backups as part of version cleanup.

Keep `.mesima-private/original-4.4` for the original signing configuration and source-integrity checks. This small reference is not an installed build or a duplicated toolchain. Private source archives may contain original Firebase configuration and must not be published.
