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

The emulator default API URL is `http://10.0.2.2:8080/api`.
