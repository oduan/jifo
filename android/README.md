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

Debug builds use `http://10.1.13.2:8080/api/` and allow HTTP cleartext traffic. Release builds use `https://jifo.apecho.com/api/` and do not enable debug cleartext configuration.

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
