# Build, verify and release

## Shared tools and private inputs

Use Node 22.12 or newer, a full JDK 17, Gradle 8.9 and Android SDK 35. Keep reusable tools under the sibling `.mesima-build-tools`, or set `MESIMA_TOOLS_DIR` to another shared directory. Android scripts use its `android` child; Electron downloads use `electron-cache`.

Private signing and Firebase configuration are supplied outside source control. The ordinary build works without the historical 4.4 source archive. A local Android or Windows build can omit Firebase configuration entirely.

## Verification gate

From the repository root:

```sh
npm ci
npm run build
npm test
npm run test:archive
npx playwright install chromium
npm run test:ui
npm run test:rules
```

Build Android with `gradle -p android testDebugUnitTest assembleDebug --no-daemon`, then run `python3 tools/verify-apk-version.py android/app/build/outputs/apk/debug/app-debug.apk`. Development APKs are signed with a development key and must not be published as updates to the installed release.

The Pages workflow calls the verification workflow from the same commit and deploys only after it succeeds. Pushing a feature branch runs verification without publishing Pages.

## Signed Android release

The `Publish signed Android release` workflow runs after `Verify web and Android` succeeds on `main` in this repository. It checks out the exact verified commit, skips a version that is already published, builds the signed Android package, and uploads a draft GitHub Release. It publishes that release only after its asset sizes and SHA-256 hashes match the local package. A failed build or upload leaves the previous published release intact.

For this personal app, the automated build can recover the original signing key from the owner's historical source archive at a pinned Git commit. `tools/ci-android-release.py` verifies the archive, key and public certificate fingerprints before use. It also recovers the existing Firebase client configuration from the pinned, original public 4.9 APK and compares all six packaged Firebase resource values after building. Signing inputs stay in a temporary directory and are removed after the build; they are not included in new commits or release artifacts. Missing or mismatched inputs fail the release rather than creating another key or publishing a local-only APK.

The release includes the signed APK, standalone HTML, public source archives and checksums. Version-specific Hebrew notes come from `RELEASE-NOTES-<version>-HE.md`, with the version's changelog as a fallback. The published tag must identify the exact verified commit. A published release is never silently replaced by a different commit; increment the app version for a new release.

This workflow does not deploy Firebase rules. The 4.9.2 Firestore rules must be deployed separately with an authorized Firebase management identity to support current-version metadata when creating new cloud backups. Client configuration recovery does not provide that management access. The full sync envelope's format change does not change the Firestore pointer's schema or paths.

For a manual build with locally supplied signing inputs:

Supply the existing release key through `MESIMA_KEYSTORE`, `MESIMA_STORE_PASSWORD`, `MESIMA_KEY_ALIAS` and `MESIMA_KEY_PASSWORD`. Do not generate a replacement key for an existing installation.

```sh
python3 tools/sign-release.py
python3 tools/verify-release.py
```

Verification checks the packaged native version, exact current HTML and the expected signing certificate. It can obtain that public certificate fingerprint from the supplied keystore, or use `MESIMA_SIGNING_CERT_SHA256` when the verification machine does not hold the private key. `--offline` is optional when all Gradle dependencies are already cached.

## Windows package

```sh
npm ci --prefix desktop
node desktop/build.cjs
python3 tools/archive-windows.py
```

The builder uses the checked-in desktop dependency lockfile. `node tools/download-electron.cjs` can populate the shared runtime cache and checks the official SHA-256 before making the downloaded archive available to the builder. The packaged application uses the Firebase configuration supplied explicitly for the build; missing configuration produces a usable local-only build.

On Windows, run `npm run test:desktop` after packaging. It starts the actual packaged application in an isolated test profile, checks local persistence across a restart, and supports builds with or without Firebase configuration. A successful cross-platform packaging check verifies the archive and its assets; it does not replace a Windows runtime check.

## Public source and checksums

```sh
python3 tools/archive-source.py
node tools/package.mjs
```

A full manifest requires the release APK, Windows ZIP, standalone HTML and both source ZIPs. The APK must pass release verification before a full manifest is written. Missing artifacts are errors, rather than silently omitted entries.

For an explicitly source-only handoff:

```sh
python3 tools/archive-source.py
node tools/package.mjs --source-only
```

`--verify-originals` additionally checks the historical references listed in `original-sha256.json` against `.mesima-private/original-4.4` (or `MESIMA_PRIVATE_DIR/original-4.4`). It is not required for an ordinary fresh checkout. Never publish a private historical archive containing configuration or signing inputs.

Publishing website content, Firebase rules, signed installers and GitHub Releases are separate release steps. A source commit does not itself update every deployed component. When upgrading to 4.9.2, update all sync clients because the full sync envelope moves to schema 2; the Firestore pointer remains schema 1.

## Existing workstation cleanup policy

Keep one current `App Version X` folder and the canonical `GitHub Mesima` checkout. After the new signed APK and Windows package have passed their checks, run `tools/prune-versions.ps1 -KeepVersion X` to inspect the proposed cleanup, then use `-Apply` only for the intended obsolete version folders.

The cleanup tool preserves compact private source archives and original documents, validates copies, checks absolute target paths and skips versions that are running. Do not force-close the user's app. Never clean an installed application's profile or backups as part of version cleanup. A code-review branch without a verified signed release does not meet these cleanup prerequisites.
