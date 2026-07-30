# Jifo Android

Native Android client for Jifo.

## Requirements

- JDK 17+ (Android Studio bundled JBR works)
- Android SDK Platform 35
- Android SDK Build Tools 35.x
- Android SDK Platform Tools

## Environment example

```bash
export JAVA_HOME="/c/Program Files/Android/Android Studio/jbr"
export ANDROID_HOME="$USERPROFILE/AppData/Local/Android/Sdk"
export ANDROID_SDK_ROOT="$ANDROID_HOME"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$PATH"
```

## Run tests

```bash
./gradlew testDebugUnitTest
```

## Build debug APK

```bash
./gradlew assembleDebug
```

Debug builds default to `http://10.0.2.2:8086/api/` (the Android emulator's host-loopback address). Release builds default to `https://jifo.apecho.com/api/`. The login screen can select another self-hosted server; release builds require HTTPS, while debug builds also allow HTTP for local development.

The compile-time default can be overridden without editing source:

```bash
./gradlew assembleDebug -PjifoApiBaseUrl=https://notes.example.com/api/
# Or set JIFO_ANDROID_API_BASE_URL in the build environment.
```

Changing server or account clears credentials, cached notes, pending media and outbox operations before the new account is used. Android backup is disabled so Room data and tokens are not copied through the platform backup service.

Text and image notes are stored locally first. Pending images are kept in Room together with the note outbox and uploaded automatically by WorkManager when a network connection is available.

## GitHub release build

Pushing a tag matching `v*` triggers `.github/workflows/android-release.yml`. The workflow runs Android unit tests, builds a signed release APK, writes a SHA-256 checksum, and publishes both files to a GitHub Release.

Configure these repository Actions secrets before creating the first tag:

- `ANDROID_KEYSTORE_BASE64`: Base64-encoded release keystore file.
- `ANDROID_KEYSTORE_PASSWORD`: Keystore password.
- `ANDROID_KEY_ALIAS`: Signing key alias.
- `ANDROID_KEY_PASSWORD`: Signing key password.

Example tag and push:

```bash
git tag v1.0.0
git push github v1.0.0
```

The Android `versionName` becomes `1.0.0`, and `versionCode` uses the GitHub Actions run number.
