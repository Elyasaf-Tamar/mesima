# Project delivery instructions

The owner wants requested changes delivered directly to the live app, unless they explicitly ask otherwise.

- Implement the requested changes, upload them to GitHub, and publish them through the established release process.
- Complete publication yourself; do not stop at a draft PR or require the owner to try a preview, run tests, or approve publication again.
- Keep the existing automated release gates. Verify the actual outcome and report failures honestly.
- This authorization covers the requested changes and their delivery; it does not cover unrelated changes or bypassing access controls.
- Distinguish code uploaded to GitHub, the live app updated, and an APK released. Never claim a later stage has completed without evidence.
- When native Android changes require installation, provide the new release APK and explain that the owner must install it on the phone.
- APK upgrades must retain the existing application ID and original release signing key, preserve user data, and include the required production configuration.
- Do not present a debug or differently signed APK as a compatible release update, or require uninstalling the existing app to install it.
- If signing material, configuration, or access is missing, identify the concrete blocker and the remaining step instead of claiming publication succeeded.
- After delivery, report what changed, what worked, what failed or remains blocked, and provide the GitHub/live-app links and APK when needed.
