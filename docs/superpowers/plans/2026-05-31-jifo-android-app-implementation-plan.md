# Jifo Android App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增一个 Kotlin + XML View 的原生 Android App，完整对齐 Jifo Web 功能，包含 RecyclerView 笔记列表、抽屉、FAB 输入、设置、访问密钥、Room 离线缓存、outbox 和 WorkManager 同步。

**Architecture:** Android 新增在 `android/` 目录下，采用单 Activity + Fragment/XML View 架构。UI 层通过 ViewModel 读取 Repository，Repository 同时访问 Room 和 Retrofit API，SyncCoordinator/WorkManager 负责 outbox push 与 pull。后端只做小改动：将冲突副本文案改为 `此条笔记冲突` 并补测试。

**Tech Stack:** Kotlin, Android XML Views, RecyclerView, DrawerLayout, Material Components, ViewModel/LiveData, Room, Retrofit/OkHttp/Moshi, WorkManager, JUnit, Robolectric, AndroidX Test, Go backend tests.

---

## Scope Check

本计划覆盖一个完整 Android v1，但按可验证任务分解：

1. 先改后端冲突副本文案，确保同步协议一致。
2. 新建 Android 工程骨架和测试环境。
3. 建立 Android 数据模型、Room、API、Auth、Notes、Sync。
4. 再实现 XML UI：登录、主界面、抽屉、RecyclerView、bottom sheet、设置。
5. 最后做端到端验证和文档。

当前执行环境检查显示 `java`、`gradle`、`sdkmanager` 未在 PATH 中。执行计划时，Task 0 是环境门禁；如果 JDK/Android SDK 不存在，必须先安装 Android Studio 或 Temurin JDK 17 + Android SDK，再继续 Android 构建验证。

---

## File Structure

### Backend 修改

- Modify: `backend/internal/sync/service.go`
  - 将冲突副本前缀从旧长句改为 `此条笔记冲突`。
  - 保留第二个 block 为 `divider`。
- Modify: `backend/internal/sync/service_test.go`
  - 增加或更新冲突副本测试，锁定文案、divider 和 `plainText`。
- Modify: `docs/sync.md`
  - 将协议文档中的冲突副本文案更新为 `此条笔记冲突`。

### Android 工程文件

- Create: `android/settings.gradle.kts`
- Create: `android/build.gradle.kts`
- Create: `android/gradle.properties`
- Create: `android/app/build.gradle.kts`
- Create: `android/app/src/main/AndroidManifest.xml`
- Create: `android/app/src/main/java/com/jifo/app/JifoApplication.kt`
- Create: `android/app/src/main/java/com/jifo/app/MainActivity.kt`
- Create: `android/app/src/main/res/values/colors.xml`
- Create: `android/app/src/main/res/values/dimens.xml`
- Create: `android/app/src/main/res/values/strings.xml`
- Create: `android/app/src/main/res/values/styles.xml`
- Create: `android/app/src/main/res/drawable/*.xml`

### Android Data/Core

- Create: `android/app/src/main/java/com/jifo/app/core/model/NoteBlock.kt`
- Create: `android/app/src/main/java/com/jifo/app/core/model/NoteModels.kt`
- Create: `android/app/src/main/java/com/jifo/app/core/model/TagModels.kt`
- Create: `android/app/src/main/java/com/jifo/app/core/model/HeatmapModels.kt`
- Create: `android/app/src/main/java/com/jifo/app/core/model/AccessKeyModels.kt`
- Create: `android/app/src/main/java/com/jifo/app/core/model/AuthModels.kt`
- Create: `android/app/src/main/java/com/jifo/app/core/time/Clock.kt`
- Create: `android/app/src/main/java/com/jifo/app/core/id/IdGenerator.kt`

### Android Network

- Create: `android/app/src/main/java/com/jifo/app/network/JifoApi.kt`
- Create: `android/app/src/main/java/com/jifo/app/network/ApiClientFactory.kt`
- Create: `android/app/src/main/java/com/jifo/app/network/AuthInterceptor.kt`
- Create: `android/app/src/main/java/com/jifo/app/network/ApiError.kt`

### Android Room

- Create: `android/app/src/main/java/com/jifo/app/data/local/JifoDatabase.kt`
- Create: `android/app/src/main/java/com/jifo/app/data/local/Converters.kt`
- Create: `android/app/src/main/java/com/jifo/app/data/local/NoteEntity.kt`
- Create: `android/app/src/main/java/com/jifo/app/data/local/TagEntity.kt`
- Create: `android/app/src/main/java/com/jifo/app/data/local/HeatmapDayEntity.kt`
- Create: `android/app/src/main/java/com/jifo/app/data/local/OutboxOperationEntity.kt`
- Create: `android/app/src/main/java/com/jifo/app/data/local/AuthSessionEntity.kt`
- Create: `android/app/src/main/java/com/jifo/app/data/local/SyncStateEntity.kt`
- Create: `android/app/src/main/java/com/jifo/app/data/local/NoteDao.kt`
- Create: `android/app/src/main/java/com/jifo/app/data/local/TagDao.kt`
- Create: `android/app/src/main/java/com/jifo/app/data/local/HeatmapDao.kt`
- Create: `android/app/src/main/java/com/jifo/app/data/local/OutboxDao.kt`
- Create: `android/app/src/main/java/com/jifo/app/data/local/AuthSessionDao.kt`
- Create: `android/app/src/main/java/com/jifo/app/data/local/SyncStateDao.kt`

### Android Repositories and Sync

- Create: `android/app/src/main/java/com/jifo/app/auth/AuthRepository.kt`
- Create: `android/app/src/main/java/com/jifo/app/notes/NotesRepository.kt`
- Create: `android/app/src/main/java/com/jifo/app/settings/SettingsRepository.kt`
- Create: `android/app/src/main/java/com/jifo/app/sync/SyncCoordinator.kt`
- Create: `android/app/src/main/java/com/jifo/app/sync/JifoSyncWorker.kt`
- Create: `android/app/src/main/java/com/jifo/app/sync/SyncScheduler.kt`

### Android UI

- Create: `android/app/src/main/res/layout/activity_main.xml`
- Create: `android/app/src/main/res/layout/fragment_login.xml`
- Create: `android/app/src/main/res/layout/fragment_notes.xml`
- Create: `android/app/src/main/res/layout/layout_drawer.xml`
- Create: `android/app/src/main/res/layout/item_note.xml`
- Create: `android/app/src/main/res/layout/item_tag.xml`
- Create: `android/app/src/main/res/layout/item_heatmap_cell.xml`
- Create: `android/app/src/main/res/layout/bottom_sheet_note_editor.xml`
- Create: `android/app/src/main/res/layout/bottom_sheet_settings.xml`
- Create: `android/app/src/main/java/com/jifo/app/auth/LoginFragment.kt`
- Create: `android/app/src/main/java/com/jifo/app/auth/LoginViewModel.kt`
- Create: `android/app/src/main/java/com/jifo/app/notes/NotesFragment.kt`
- Create: `android/app/src/main/java/com/jifo/app/notes/NotesViewModel.kt`
- Create: `android/app/src/main/java/com/jifo/app/notes/NoteAdapter.kt`
- Create: `android/app/src/main/java/com/jifo/app/notes/NoteEditorBottomSheet.kt`
- Create: `android/app/src/main/java/com/jifo/app/drawer/DrawerViewModel.kt`
- Create: `android/app/src/main/java/com/jifo/app/drawer/TagAdapter.kt`
- Create: `android/app/src/main/java/com/jifo/app/settings/SettingsBottomSheet.kt`
- Create: `android/app/src/main/java/com/jifo/app/settings/SettingsViewModel.kt`

### Android Tests

- Create test helpers under `android/app/src/test/java/com/jifo/app/test/`.
- Create Room DAO tests under `android/app/src/test/java/com/jifo/app/data/local/`.
- Create repository tests under `android/app/src/test/java/com/jifo/app/notes/`, `auth/`, `settings/`.
- Create sync tests under `android/app/src/test/java/com/jifo/app/sync/`.
- Create UI tests under `android/app/src/androidTest/java/com/jifo/app/`.

---

## Task 0: Environment Gate

**Files:** none

- [ ] **Step 1: Check Java and Android SDK**

Run:

```bash
where.exe java 2>nul || true
where.exe sdkmanager 2>nul || true
where.exe adb 2>nul || true
```

Expected if ready: paths to Java 17+, Android SDK tools, and adb. Current observed output in this session was empty, so this gate will likely fail until local Android tooling is installed.

- [ ] **Step 2: If missing, stop and request environment setup**

Ask the user to install:

```text
Android Studio with Android SDK Platform 35, Android SDK Build-Tools 35.x, Android SDK Platform-Tools, and Temurin/OpenJDK 17.
```

Do not continue Android Gradle verification until `java -version` prints Java 17+ and `sdkmanager --list` works.

- [ ] **Step 3: Verify backend/web tools are still available**

Run:

```bash
cd backend && go test ./...
cd ../web && npm test -- --run
```

Expected: backend and web tests pass before Android work starts. If these fail for unrelated reasons, stop and report exact failures.

---

## Task 1: Backend conflict-copy wording

**Files:**
- Modify: `backend/internal/sync/service_test.go`
- Modify: `backend/internal/sync/service.go`
- Modify: `docs/sync.md`

- [ ] **Step 1: Write failing backend test for conflict prefix**

Add this test to `backend/internal/sync/service_test.go` near existing sync conflict tests. If no helper exists, create users/notes through existing service helpers used in the same file.

```go
func TestPushUpdateConflictCreatesChineseConflictCopy(t *testing.T) {
	ctx := context.Background()
	db := testutil.OpenTestDB(t)
	resetSchemaAndMigrate(t, ctx, db)

	userID := createTestUser(t, ctx, db, "conflict-android@example.com")
	noteSvc := notes.NewService(db)
	svc := NewService(db, noteSvc)

	original, err := noteSvc.Create(ctx, notes.CreateInput{
		UserID: userID,
		ClientID: "android-conflict-original",
		Content: notes.Content{Blocks: []notes.Block{{Type: "paragraph", Text: "远端原文"}}},
		PlainText: "远端原文",
	})
	if err != nil {
		t.Fatalf("create original note: %v", err)
	}

	_, err = noteSvc.Update(ctx, notes.UpdateInput{
		UserID: userID,
		NoteID: original.ID,
		Content: notes.Content{Blocks: []notes.Block{{Type: "paragraph", Text: "其他设备已更新"}}},
		PlainText: "其他设备已更新",
	})
	if err != nil {
		t.Fatalf("simulate remote update: %v", err)
	}

	baseVersion := original.Version
	result, err := svc.Push(ctx, userID, nil, Operation{
		OpID: "android-conflict-op-1",
		Entity: "note",
		Action: "update",
		ClientID: original.ClientID,
		EntityID: &original.ID,
		BaseVersion: &baseVersion,
		Payload: Payload{
			Content: notes.Content{Blocks: []notes.Block{{Type: "paragraph", Text: "本地离线修改"}}},
			PlainText: "本地离线修改",
		},
	})
	if err != nil {
		t.Fatalf("push conflict update: %v", err)
	}
	if result.Status != "conflict_copied" {
		t.Fatalf("status = %q, want conflict_copied", result.Status)
	}
	if result.NoteID == nil {
		t.Fatalf("conflict note id is nil")
	}

	conflict, err := noteSvc.Get(ctx, userID, *result.NoteID)
	if err != nil {
		t.Fatalf("get conflict note: %v", err)
	}
	if got := conflict.Content.Blocks[0].Text; got != "此条笔记冲突" {
		t.Fatalf("conflict prefix = %q, want %q", got, "此条笔记冲突")
	}
	if got := conflict.Content.Blocks[1].Type; got != "divider" {
		t.Fatalf("second block type = %q, want divider", got)
	}
	wantPlain := "此条笔记冲突\n\n----\n本地离线修改"
	if conflict.PlainText != wantPlain {
		t.Fatalf("plainText = %q, want %q", conflict.PlainText, wantPlain)
	}
}
```

- [ ] **Step 2: Run test and verify RED**

Run:

```bash
cd backend && go test ./internal/sync -run TestPushUpdateConflictCreatesChineseConflictCopy -count=1
```

Expected: FAIL because existing prefix is `这是一条冲突副本，原笔记已在其他设备被更新。`.

- [ ] **Step 3: Implement minimal backend wording change**

In `backend/internal/sync/service.go`, update `createConflictCopyTx` to use a constant:

```go
const conflictCopyPrefix = "此条笔记冲突"
```

Then use it in both `Content.Blocks` and `plainText`:

```go
conflictContent.Blocks = append(conflictContent.Blocks,
	notes.Block{Type: "paragraph", Text: conflictCopyPrefix},
	notes.Block{Type: "divider"},
)

plainText := conflictCopyPrefix + "\n\n----"
if payload.PlainText != "" {
	plainText += "\n" + payload.PlainText
}
```

- [ ] **Step 4: Run backend test and verify GREEN**

Run:

```bash
cd backend && go test ./internal/sync -run TestPushUpdateConflictCreatesChineseConflictCopy -count=1
```

Expected: PASS.

- [ ] **Step 5: Update sync docs**

In `docs/sync.md`, replace the conflict copy example text with:

```text
此条笔记冲突

----
<客户端提交内容>
```

- [ ] **Step 6: Run backend package tests**

Run:

```bash
cd backend && go test ./...
```

Expected: PASS.

- [ ] **Step 7: Commit backend conflict change**

```bash
git add backend/internal/sync/service.go backend/internal/sync/service_test.go docs/sync.md
git commit -m "fix(sync): use concise conflict note prefix" -m "Co-Authored-By: Craft Agent <agents-noreply@craft.do>"
```

---

## Task 2: Android Gradle project scaffold

**Files:**
- Create: `android/settings.gradle.kts`
- Create: `android/build.gradle.kts`
- Create: `android/gradle.properties`
- Create: `android/app/build.gradle.kts`
- Create: `android/app/src/main/AndroidManifest.xml`
- Create: `android/app/src/main/java/com/jifo/app/JifoApplication.kt`
- Create: `android/app/src/main/java/com/jifo/app/MainActivity.kt`
- Create: base `res/values` files

- [ ] **Step 1: Create project files**

Create `android/settings.gradle.kts`:

```kotlin
pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}
dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}
rootProject.name = "JifoAndroid"
include(":app")
```

Create `android/build.gradle.kts`:

```kotlin
plugins {
    id("com.android.application") version "8.7.3" apply false
    id("org.jetbrains.kotlin.android") version "2.0.21" apply false
    id("org.jetbrains.kotlin.kapt") version "2.0.21" apply false
}
```

Create `android/gradle.properties`:

```properties
org.gradle.jvmargs=-Xmx3072m -Dfile.encoding=UTF-8
android.useAndroidX=true
android.nonTransitiveRClass=true
kotlin.code.style=official
```

Create `android/app/build.gradle.kts`:

```kotlin
plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.kapt")
}

android {
    namespace = "com.jifo.app"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.jifo.app"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "1.0.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        buildConfigField("String", "DEFAULT_API_BASE_URL", "\"http://10.0.2.2:8080/api\"")
    }

    buildFeatures {
        viewBinding = true
        buildConfig = true
    }

    testOptions {
        unitTests.isIncludeAndroidResources = true
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("androidx.fragment:fragment-ktx:1.8.5")
    implementation("androidx.constraintlayout:constraintlayout:2.2.0")
    implementation("androidx.recyclerview:recyclerview:1.4.0")
    implementation("androidx.drawerlayout:drawerlayout:1.2.0")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.lifecycle:lifecycle-viewmodel-ktx:2.8.7")
    implementation("androidx.lifecycle:lifecycle-livedata-ktx:2.8.7")
    implementation("androidx.room:room-runtime:2.6.1")
    implementation("androidx.room:room-ktx:2.6.1")
    kapt("androidx.room:room-compiler:2.6.1")
    implementation("androidx.work:work-runtime-ktx:2.10.0")
    implementation("com.squareup.retrofit2:retrofit:2.11.0")
    implementation("com.squareup.retrofit2:converter-moshi:2.11.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("com.squareup.okhttp3:logging-interceptor:4.12.0")
    implementation("com.squareup.moshi:moshi:1.15.1")
    implementation("com.squareup.moshi:moshi-kotlin:1.15.1")
    kapt("com.squareup.moshi:moshi-kotlin-codegen:1.15.1")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")

    testImplementation("junit:junit:4.13.2")
    testImplementation("androidx.test:core:1.6.1")
    debugImplementation("androidx.fragment:fragment-testing:1.8.5")
    testImplementation("androidx.arch.core:core-testing:2.2.0")
    testImplementation("org.robolectric:robolectric:4.13")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.9.0")
    testImplementation("com.squareup.okhttp3:mockwebserver:4.12.0")

    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.6.1")
}
```

- [ ] **Step 2: Create minimal app class and activity**

Create `JifoApplication.kt`:

```kotlin
package com.jifo.app

import android.app.Application

class JifoApplication : Application()
```

Create `MainActivity.kt`:

```kotlin
package com.jifo.app

import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity

class MainActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
    }
}
```

Create `AndroidManifest.xml`:

```xml
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <uses-permission android:name="android.permission.INTERNET" />
    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />

    <application
        android:name=".JifoApplication"
        android:allowBackup="true"
        android:icon="@mipmap/ic_launcher"
        android:label="@string/app_name"
        android:theme="@style/Theme.Jifo">
        <activity
            android:name=".MainActivity"
            android:exported="true">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
    </application>
</manifest>
```

- [ ] **Step 3: Create base resources**

Create `strings.xml`:

```xml
<resources>
    <string name="app_name">Jifo</string>
    <string name="login">登录</string>
    <string name="register">注册</string>
    <string name="note_placeholder">记录此刻想法…</string>
</resources>
```

Create `colors.xml`:

```xml
<resources>
    <color name="jifo_bg">#F5F0E8</color>
    <color name="jifo_bg_soft">#FBF7EF</color>
    <color name="jifo_ink">#201B16</color>
    <color name="jifo_muted">#817568</color>
    <color name="jifo_line">#1A201B16</color>
    <color name="jifo_card_solid">#FFFDF8</color>
    <color name="jifo_green">#3D7C4A</color>
    <color name="jifo_green_dark">#26382B</color>
    <color name="jifo_amber">#E8B85B</color>
    <color name="jifo_danger">#A94438</color>
    <color name="jifo_tag_text">#7D5CA6</color>
    <color name="jifo_tag_bg">#EFE7FB</color>
</resources>
```

Create `activity_main.xml`:

```xml
<FrameLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:id="@+id/main_container"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:background="@color/jifo_bg" />
```

- [ ] **Step 4: Run scaffold build**

Run:

```bash
cd android && ./gradlew testDebugUnitTest
```

Expected: Gradle downloads dependencies and unit test task completes, even with zero tests. If wrapper is not present, create wrapper using installed Gradle:

```bash
cd android && gradle wrapper --gradle-version 8.10.2
```

- [ ] **Step 5: Commit scaffold**

```bash
git add android
git commit -m "feat(android): scaffold native app project" -m "Co-Authored-By: Craft Agent <agents-noreply@craft.do>"
```

---

## Task 3: Core models and JSON mapping

**Files:**
- Create model files under `android/app/src/main/java/com/jifo/app/core/model/`
- Create tests under `android/app/src/test/java/com/jifo/app/core/model/`

- [ ] **Step 1: Write failing mapper tests**

Create `NoteBlockTest.kt`:

```kotlin
package com.jifo.app.core.model

import org.junit.Assert.assertEquals
import org.junit.Test

class NoteBlockTest {
    @Test fun plainTextFromBlocksUsesParagraphsDividerAndImageAlt() {
        val blocks = listOf(
            NoteBlock.Paragraph("第一段 #标签"),
            NoteBlock.Divider,
            NoteBlock.Image(mediaId = "media-1", url = null, alt = "截图")
        )

        assertEquals("第一段 #标签\n\n----\n截图", blocks.toPlainText())
    }

    @Test fun extractsUniqueTagPaths() {
        val blocks = listOf(NoteBlock.Paragraph("今天 #思考 #产品/移动端 #思考"))

        assertEquals(listOf("思考", "产品/移动端"), blocks.extractTagPaths())
    }
}
```

- [ ] **Step 2: Run and verify RED**

```bash
cd android && ./gradlew testDebugUnitTest --tests "com.jifo.app.core.model.NoteBlockTest"
```

Expected: FAIL because `NoteBlock` does not exist.

- [ ] **Step 3: Implement models**

Create `NoteBlock.kt`:

```kotlin
package com.jifo.app.core.model

import com.squareup.moshi.JsonClass

@JsonClass(generateAdapter = true)
sealed class NoteBlock {
    abstract val type: String

    @JsonClass(generateAdapter = true)
    data class Paragraph(val text: String) : NoteBlock() {
        override val type: String = "paragraph"
    }

    @JsonClass(generateAdapter = true)
    data object Divider : NoteBlock() {
        override val type: String = "divider"
    }

    @JsonClass(generateAdapter = true)
    data class Image(
        val mediaId: String? = null,
        val url: String? = null,
        val alt: String? = null
    ) : NoteBlock() {
        override val type: String = "image"
    }
}

private val tagPattern = Regex("#[^\\s#]+")

fun List<NoteBlock>.toPlainText(): String = mapNotNull { block ->
    when (block) {
        is NoteBlock.Paragraph -> block.text.takeIf { it.isNotBlank() }
        NoteBlock.Divider -> "----"
        is NoteBlock.Image -> block.alt?.takeIf { it.isNotBlank() }
    }
}.joinToString("\n\n")

fun List<NoteBlock>.extractTagPaths(): List<String> = asSequence()
    .filterIsInstance<NoteBlock.Paragraph>()
    .flatMap { tagPattern.findAll(it.text).map { match -> match.value.removePrefix("#").trim('/') } }
    .filter { it.isNotBlank() }
    .distinct()
    .toList()
```

Create `NoteModels.kt`:

```kotlin
package com.jifo.app.core.model

import com.squareup.moshi.JsonClass

@JsonClass(generateAdapter = true)
data class NoteContent(val blocks: List<NoteBlock> = emptyList())

data class Note(
    val id: String,
    val clientId: String,
    val blocks: List<NoteBlock>,
    val plainText: String,
    val createdAt: String,
    val updatedAt: String,
    val version: Long,
    val deletedAt: String? = null,
    val syncStatus: SyncStatus = SyncStatus.SYNCED
)

enum class SyncStatus { SYNCED, PENDING, SYNCING, FAILED }
```

- [ ] **Step 4: Run mapper tests and verify GREEN**

```bash
cd android && ./gradlew testDebugUnitTest --tests "com.jifo.app.core.model.NoteBlockTest"
```

Expected: PASS.

- [ ] **Step 5: Commit models**

```bash
git add android/app/src/main/java/com/jifo/app/core/model android/app/src/test/java/com/jifo/app/core/model
git commit -m "feat(android): add core note models" -m "Co-Authored-By: Craft Agent <agents-noreply@craft.do>"
```

---

## Task 4: Room database and DAOs

**Files:**
- Create local entity/DAO/database files
- Create DAO tests

- [ ] **Step 1: Write failing DAO tests**

Create `NoteDaoTest.kt`:

```kotlin
package com.jifo.app.data.local

import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test

class NoteDaoTest {
    private lateinit var db: JifoDatabase

    @Before fun setUp() {
        db = Room.inMemoryDatabaseBuilder(
            ApplicationProvider.getApplicationContext(),
            JifoDatabase::class.java
        ).allowMainThreadQueries().build()
    }

    @After fun tearDown() { db.close() }

    @Test fun observesNotesNewestFirstAndSearchesPlainText() = runTest {
        db.noteDao().upsertAll(listOf(
            NoteEntity(id = "1", clientId = "c1", contentJson = "[]", plainText = "苹果 #食物", createdAt = "2026-05-30T01:00:00Z", updatedAt = "2026-05-30T01:00:00Z", version = 1),
            NoteEntity(id = "2", clientId = "c2", contentJson = "[]", plainText = "香蕉 #食物", createdAt = "2026-05-31T01:00:00Z", updatedAt = "2026-05-31T01:00:00Z", version = 1)
        ))

        val rows = db.noteDao().observeNotes(search = "香蕉", tagPath = null).first()

        assertEquals(listOf("2"), rows.map { it.id })
    }

    @Test fun outboxOrdersPendingOperationsByLocalSeq() = runTest {
        db.outboxDao().insert(OutboxOperationEntity(opId = "op-2", entity = "note", action = "update", clientId = "c", baseVersion = 1, payloadJson = "{}", createdAt = "2026-05-31T02:00:00Z"))
        db.outboxDao().insert(OutboxOperationEntity(opId = "op-1", entity = "note", action = "create", clientId = "c", baseVersion = 0, payloadJson = "{}", createdAt = "2026-05-31T01:00:00Z"))

        assertEquals(listOf("op-2", "op-1"), db.outboxDao().pendingOrFailed().map { it.opId })
    }
}
```

- [ ] **Step 2: Run and verify RED**

```bash
cd android && ./gradlew testDebugUnitTest --tests "com.jifo.app.data.local.NoteDaoTest"
```

Expected: FAIL because database classes do not exist.

- [ ] **Step 3: Implement entities and DAOs**

Create `NoteEntity.kt`:

```kotlin
package com.jifo.app.data.local

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "notes")
data class NoteEntity(
    @PrimaryKey val id: String,
    val clientId: String,
    val contentJson: String,
    val plainText: String,
    val createdAt: String,
    val updatedAt: String,
    val version: Long,
    val deletedAt: String? = null,
    val syncStatus: String = "SYNCED",
    val lastError: String? = null
)
```

Create `OutboxOperationEntity.kt`:

```kotlin
package com.jifo.app.data.local

import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "outbox_operations")
data class OutboxOperationEntity(
    @PrimaryKey(autoGenerate = true) val localSeq: Long = 0,
    val opId: String,
    val entity: String,
    val action: String,
    val noteId: String? = null,
    val clientId: String,
    val baseVersion: Long,
    val payloadJson: String,
    val status: String = "pending",
    val retryCount: Int = 0,
    val lastError: String? = null,
    val createdAt: String
)
```

Create `NoteDao.kt`:

```kotlin
package com.jifo.app.data.local

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import kotlinx.coroutines.flow.Flow

@Dao
interface NoteDao {
    @Query("""
        SELECT * FROM notes
        WHERE deletedAt IS NULL
          AND (:search IS NULL OR plainText LIKE '%' || :search || '%')
          AND (:tagPath IS NULL OR plainText LIKE '%#' || :tagPath || '%')
        ORDER BY createdAt DESC
    """)
    fun observeNotes(search: String?, tagPath: String?): Flow<List<NoteEntity>>

    @Query("SELECT * FROM notes WHERE id = :id LIMIT 1")
    suspend fun getById(id: String): NoteEntity?

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(note: NoteEntity)

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsertAll(notes: List<NoteEntity>)
}
```

Create `OutboxDao.kt`:

```kotlin
package com.jifo.app.data.local

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query

@Dao
interface OutboxDao {
    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insert(operation: OutboxOperationEntity): Long

    @Query("SELECT * FROM outbox_operations WHERE status IN ('pending', 'failed') ORDER BY localSeq ASC")
    suspend fun pendingOrFailed(): List<OutboxOperationEntity>

    @Query("UPDATE outbox_operations SET status = :status, lastError = :lastError WHERE opId = :opId")
    suspend fun updateStatus(opId: String, status: String, lastError: String?)

    @Query("DELETE FROM outbox_operations WHERE opId = :opId")
    suspend fun deleteByOpId(opId: String)
}
```

Create `JifoDatabase.kt` with all entities as they are introduced in this task and later tasks. Start with notes/outbox, then extend in later tasks:

```kotlin
package com.jifo.app.data.local

import androidx.room.Database
import androidx.room.RoomDatabase

@Database(
    entities = [NoteEntity::class, OutboxOperationEntity::class],
    version = 1,
    exportSchema = true
)
abstract class JifoDatabase : RoomDatabase() {
    abstract fun noteDao(): NoteDao
    abstract fun outboxDao(): OutboxDao
}
```

- [ ] **Step 4: Run DAO tests and verify GREEN**

```bash
cd android && ./gradlew testDebugUnitTest --tests "com.jifo.app.data.local.NoteDaoTest"
```

Expected: PASS.

- [ ] **Step 5: Commit Room base**

```bash
git add android/app/src/main/java/com/jifo/app/data/local android/app/src/test/java/com/jifo/app/data/local
git commit -m "feat(android): add Room notes and outbox storage" -m "Co-Authored-By: Craft Agent <agents-noreply@craft.do>"
```

---

## Task 5: Retrofit API and auth refresh

**Files:**
- Create network files
- Create auth session DAO/entity
- Create tests with MockWebServer

- [ ] **Step 1: Write failing auth retry test**

Create `AuthInterceptorTest.kt`:

```kotlin
package com.jifo.app.network

import kotlinx.coroutines.test.runTest
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.assertEquals
import org.junit.Test

class AuthInterceptorTest {
    @Test fun refreshesTokenAndRetriesUnauthorizedRequest() = runTest {
        val server = MockWebServer()
        server.enqueue(MockResponse().setResponseCode(401).setBody("{\"error\":{\"code\":\"unauthorized\"}}"))
        server.enqueue(MockResponse().setResponseCode(200).setBody("{\"accessToken\":\"new-access\",\"refreshToken\":\"new-refresh\",\"user\":{\"id\":\"u1\",\"email\":\"a@example.com\",\"username\":\"A\"}}"))
        server.enqueue(MockResponse().setResponseCode(200).setBody("{\"total\":42}"))
        server.start()

        val session = InMemoryTokenStore(accessToken = "old-access", refreshToken = "old-refresh")
        val api = ApiClientFactory.createForTest(server.url("/api/").toString(), session)

        val stats = api.noteStats()

        assertEquals(42, stats.total)
        assertEquals("Bearer old-access", server.takeRequest().getHeader("Authorization"))
        assertEquals("/api/auth/refresh", server.takeRequest().path)
        assertEquals("Bearer new-access", server.takeRequest().getHeader("Authorization"))
        server.shutdown()
    }
}
```

- [ ] **Step 2: Run and verify RED**

```bash
cd android && ./gradlew testDebugUnitTest --tests "com.jifo.app.network.AuthInterceptorTest"
```

Expected: FAIL because network classes do not exist.

- [ ] **Step 3: Implement API DTOs and client**

Create `JifoApi.kt`:

```kotlin
package com.jifo.app.network

import com.squareup.moshi.JsonClass
import retrofit2.http.Body
import retrofit2.http.DELETE
import retrofit2.http.GET
import retrofit2.http.PATCH
import retrofit2.http.POST
import retrofit2.http.Path
import retrofit2.http.Query

@JsonClass(generateAdapter = true)
data class AuthRequest(val email: String, val password: String, val username: String? = null, val deviceCode: String)
@JsonClass(generateAdapter = true)
data class RefreshRequest(val refreshToken: String)
@JsonClass(generateAdapter = true)
data class UserDto(val id: String, val email: String, val username: String?)
@JsonClass(generateAdapter = true)
data class AuthResponse(val accessToken: String, val refreshToken: String?, val user: UserDto?)
@JsonClass(generateAdapter = true)
data class NoteStatsDto(val total: Int)

interface JifoApi {
    @POST("auth/login") suspend fun login(@Body body: AuthRequest): AuthResponse
    @POST("auth/register") suspend fun register(@Body body: AuthRequest): AuthResponse
    @POST("auth/refresh") suspend fun refresh(@Body body: RefreshRequest): AuthResponse
    @GET("notes/stats") suspend fun noteStats(): NoteStatsDto
}
```

Create `TokenStore.kt` and `InMemoryTokenStore` for tests:

```kotlin
package com.jifo.app.network

interface TokenStore {
    suspend fun accessToken(): String?
    suspend fun refreshToken(): String?
    suspend fun save(accessToken: String, refreshToken: String?)
    suspend fun clear()
}

class InMemoryTokenStore(
    private var accessToken: String?,
    private var refreshToken: String?
) : TokenStore {
    override suspend fun accessToken() = accessToken
    override suspend fun refreshToken() = refreshToken
    override suspend fun save(accessToken: String, refreshToken: String?) {
        this.accessToken = accessToken
        this.refreshToken = refreshToken
    }
    override suspend fun clear() {
        accessToken = null
        refreshToken = null
    }
}
```

Create `ApiClientFactory.kt` using OkHttp authenticator:

```kotlin
package com.jifo.app.network

import com.squareup.moshi.Moshi
import com.squareup.moshi.kotlin.reflect.KotlinJsonAdapterFactory
import kotlinx.coroutines.runBlocking
import okhttp3.Authenticator
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.Route
import retrofit2.Retrofit
import retrofit2.converter.moshi.MoshiConverterFactory

object ApiClientFactory {
    fun create(baseUrl: String, tokenStore: TokenStore): JifoApi = createForTest(baseUrl, tokenStore)

    fun createForTest(baseUrl: String, tokenStore: TokenStore): JifoApi {
        val moshi = Moshi.Builder().add(KotlinJsonAdapterFactory()).build()
        lateinit var refreshApi: JifoApi
        val authClient = OkHttpClient.Builder()
            .addInterceptor { chain ->
                val token = runBlocking { tokenStore.accessToken() }
                val request = if (token != null) chain.request().newBuilder().header("Authorization", "Bearer $token").build() else chain.request()
                chain.proceed(request)
            }
            .authenticator(object : Authenticator {
                override fun authenticate(route: Route?, response: Response): Request? {
                    if (responseCount(response) >= 2) return null
                    val refresh = runBlocking { tokenStore.refreshToken() } ?: return null
                    val refreshed = runBlocking { refreshApi.refresh(RefreshRequest(refresh)) }
                    runBlocking { tokenStore.save(refreshed.accessToken, refreshed.refreshToken) }
                    return response.request.newBuilder().header("Authorization", "Bearer ${refreshed.accessToken}").build()
                }
            })
            .build()
        refreshApi = Retrofit.Builder()
            .baseUrl(baseUrl)
            .addConverterFactory(MoshiConverterFactory.create(moshi))
            .client(OkHttpClient())
            .build()
            .create(JifoApi::class.java)
        return Retrofit.Builder()
            .baseUrl(baseUrl)
            .addConverterFactory(MoshiConverterFactory.create(moshi))
            .client(authClient)
            .build()
            .create(JifoApi::class.java)
    }

    private fun responseCount(response: Response): Int {
        var count = 1
        var prior = response.priorResponse
        while (prior != null) {
            count++
            prior = prior.priorResponse
        }
        return count
    }
}
```

- [ ] **Step 4: Run auth retry test and verify GREEN**

```bash
cd android && ./gradlew testDebugUnitTest --tests "com.jifo.app.network.AuthInterceptorTest"
```

Expected: PASS.

- [ ] **Step 5: Commit network layer**

```bash
git add android/app/src/main/java/com/jifo/app/network android/app/src/test/java/com/jifo/app/network
git commit -m "feat(android): add API client with token refresh" -m "Co-Authored-By: Craft Agent <agents-noreply@craft.do>"
```

---

## Task 6: Notes repository offline operations

**Files:**
- Create: `android/app/src/main/java/com/jifo/app/notes/NotesRepository.kt`
- Create: `android/app/src/main/java/com/jifo/app/notes/NoteJson.kt`
- Modify: `android/app/src/main/java/com/jifo/app/data/local/NoteDao.kt`
- Modify: `android/app/src/main/java/com/jifo/app/data/local/OutboxDao.kt`
- Create: `android/app/src/test/java/com/jifo/app/notes/NotesRepositoryTest.kt`
- Create: `android/app/src/test/java/com/jifo/app/test/TestDatabaseFactory.kt`
- Create: `android/app/src/test/java/com/jifo/app/test/Fakes.kt`

- [ ] **Step 1: Write failing offline create test**

Create `NotesRepositoryTest.kt`:

```kotlin
package com.jifo.app.notes

import com.jifo.app.core.model.NoteBlock
import com.jifo.app.data.local.JifoDatabase
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

class NotesRepositoryTest {
    @Test fun createNoteWritesLocalNoteAndOutboxInOneOperation() = runTest {
        val db = TestDatabaseFactory.create()
        val repo = NotesRepository(db, FakeSyncScheduler(), FixedIdGenerator("client-note-1", "op-1"), FixedClock("2026-05-31T09:00:00Z"))

        repo.createNote(listOf(NoteBlock.Paragraph("本地记录 #Android")))

        val notes = db.noteDao().observeNotes(null, null).first()
        val outbox = db.outboxDao().pendingOrFailed()
        assertEquals("本地记录 #Android", notes.single().plainText)
        assertEquals("PENDING", notes.single().syncStatus)
        assertEquals("create", outbox.single().action)
        assertEquals(0, outbox.single().baseVersion)
    }
}
```

- [ ] **Step 2: Run and verify RED**

```bash
cd android && ./gradlew testDebugUnitTest --tests "com.jifo.app.notes.NotesRepositoryTest"
```

Expected: FAIL because `NotesRepository` and test helpers do not exist.

- [ ] **Step 3: Implement repository create/update/delete**

Create `NotesRepository.kt`:

```kotlin
package com.jifo.app.notes

import com.jifo.app.core.id.IdGenerator
import com.jifo.app.core.model.NoteBlock
import com.jifo.app.core.model.toPlainText
import com.jifo.app.core.time.Clock
import com.jifo.app.data.local.JifoDatabase
import com.jifo.app.data.local.NoteEntity
import com.jifo.app.data.local.OutboxOperationEntity
import com.jifo.app.sync.SyncScheduler
import androidx.room.withTransaction
import kotlinx.coroutines.flow.map

class NotesRepository(
    private val db: JifoDatabase,
    private val syncScheduler: SyncScheduler,
    private val idGenerator: IdGenerator,
    private val clock: Clock
) {
    fun observeNotes(search: String?, tagPath: String?) = db.noteDao().observeNotes(search?.takeIf { it.isNotBlank() }, tagPath).map { it }

    suspend fun createNote(blocks: List<NoteBlock>) {
        val clientId = idGenerator.newClientId("android-note")
        val opId = idGenerator.newOpId()
        val now = clock.nowIso()
        val plainText = blocks.toPlainText()
        val contentJson = NoteJson.encodeBlocks(blocks)
        db.withTransaction {
            db.noteDao().upsert(NoteEntity(
                id = clientId,
                clientId = clientId,
                contentJson = contentJson,
                plainText = plainText,
                createdAt = now,
                updatedAt = now,
                version = 0,
                syncStatus = "PENDING"
            ))
            db.outboxDao().insert(OutboxOperationEntity(
                opId = opId,
                entity = "note",
                action = "create",
                clientId = clientId,
                baseVersion = 0,
                payloadJson = NoteJson.encodePayload(blocks, plainText),
                createdAt = now
            ))
        }
        syncScheduler.scheduleNow()
    }
}
```

Create `NoteJson.kt`:

```kotlin
package com.jifo.app.notes

import com.jifo.app.core.model.NoteBlock
import org.json.JSONArray
import org.json.JSONObject

object NoteJson {
    fun encodeBlocks(blocks: List<NoteBlock>): String = JSONArray(blocks.map { block ->
        when (block) {
            is NoteBlock.Paragraph -> JSONObject().put("type", "paragraph").put("text", block.text)
            NoteBlock.Divider -> JSONObject().put("type", "divider")
            is NoteBlock.Image -> JSONObject().put("type", "image").apply {
                block.mediaId?.let { put("mediaId", it) }
                block.url?.let { put("url", it) }
                block.alt?.let { put("alt", it) }
            }
        }
    }).toString()

    fun encodePayload(blocks: List<NoteBlock>, plainText: String): String = JSONObject()
        .put("content", JSONObject().put("blocks", JSONArray(encodeBlocks(blocks))))
        .put("plainText", plainText)
        .toString()
}
```

- [ ] **Step 4: Run repository test and verify GREEN**

```bash
cd android && ./gradlew testDebugUnitTest --tests "com.jifo.app.notes.NotesRepositoryTest"
```

Expected: PASS.

- [ ] **Step 5: Add tests for update/delete baseVersion**

Add tests that seed a synced note with `version = 3`, call `updateNote`, and assert outbox `baseVersion = 3`; seed a synced note, call `deleteNote`, and assert local `deletedAt` non-null and outbox action `delete`.

Run:

```bash
cd android && ./gradlew testDebugUnitTest --tests "com.jifo.app.notes.NotesRepositoryTest"
```

Expected: initially FAIL before implementation, then PASS after adding update/delete repository methods.

- [ ] **Step 6: Commit repository offline operations**

```bash
git add android/app/src/main/java/com/jifo/app/notes android/app/src/test/java/com/jifo/app/notes android/app/src/test/java/com/jifo/app/test
git commit -m "feat(android): add offline notes repository" -m "Co-Authored-By: Craft Agent <agents-noreply@craft.do>"
```

---

## Task 7: Sync coordinator and WorkManager

**Files:**
- Create: `android/app/src/main/java/com/jifo/app/sync/SyncCoordinator.kt`
- Create: `android/app/src/main/java/com/jifo/app/sync/JifoSyncWorker.kt`
- Create: `android/app/src/main/java/com/jifo/app/sync/SyncScheduler.kt`
- Extend `JifoApi.kt` with sync endpoints
- Create sync tests

- [ ] **Step 1: Write failing sync result test**

Create `SyncCoordinatorTest.kt`:

```kotlin
package com.jifo.app.sync

import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class SyncCoordinatorTest {
    @Test fun conflictCopiedClearsOutboxAndDoesNotOverwriteOriginalNote() = runTest {
        val db = TestDatabaseFactory.create()
        db.noteDao().upsert(TestNotes.synced(id = "note-1", clientId = "client-1", plainText = "远端原始", version = 2))
        db.outboxDao().insert(TestOutbox.update(opId = "op-1", noteId = "note-1", clientId = "client-1", baseVersion = 1, plainText = "本地修改"))
        val api = FakeSyncApi(pushResults = listOf(PushResultDto("op-1", "conflict_copied", "conflict-1", 3)), pullNotes = emptyList())
        val sync = SyncCoordinator(db, api)

        sync.runOnce()

        assertNull(db.outboxDao().getByOpId("op-1"))
        assertEquals("远端原始", db.noteDao().getById("note-1")!!.plainText)
    }
}
```

- [ ] **Step 2: Run and verify RED**

```bash
cd android && ./gradlew testDebugUnitTest --tests "com.jifo.app.sync.SyncCoordinatorTest"
```

Expected: FAIL because sync classes do not exist.

- [ ] **Step 3: Implement sync endpoints and coordinator**

Extend `JifoApi.kt`:

```kotlin
@JsonClass(generateAdapter = true)
data class SyncPushRequest(val operations: List<SyncOperationDto>)
@JsonClass(generateAdapter = true)
data class SyncOperationDto(val opId: String, val entity: String, val action: String, val clientId: String, val noteId: String?, val baseVersion: Long, val payload: Map<String, Any?>)
@JsonClass(generateAdapter = true)
data class SyncPushResponse(val results: List<PushResultDto>)
@JsonClass(generateAdapter = true)
data class PushResultDto(val opId: String, val status: String, val noteId: String?, val version: Long)

@POST("sync/push") suspend fun push(@Body body: SyncPushRequest): SyncPushResponse
@GET("sync/pull") suspend fun pull(@Query("updatedAt") updatedAt: String?, @Query("id") id: String?, @Query("limit") limit: Int = 100): SyncPullResponse
```

Create `SyncCoordinator.kt`:

```kotlin
package com.jifo.app.sync

import androidx.room.withTransaction
import com.jifo.app.data.local.JifoDatabase
import com.jifo.app.network.JifoApi

class SyncCoordinator(
    private val db: JifoDatabase,
    private val api: JifoApi
) {
    suspend fun runOnce() {
        val operations = db.outboxDao().pendingOrFailed()
        if (operations.isNotEmpty()) {
            val response = api.push(SyncDtoMapper.toPushRequest(operations))
            for (result in response.results) {
                when (result.status) {
                    "created", "updated", "deleted", "restored", "duplicate" -> db.withTransaction {
                        SyncResultApplier.applySuccess(db, result)
                        db.outboxDao().deleteByOpId(result.opId)
                    }
                    "conflict_copied", "delete_conflict_ignored" -> db.outboxDao().deleteByOpId(result.opId)
                    else -> db.outboxDao().updateStatus(result.opId, "failed", "push_status:${result.status}")
                }
            }
        }
        val cursor = db.syncStateDao().getCursor()
        val pull = api.pull(cursor?.updatedAt, cursor?.id)
        db.withTransaction {
            SyncResultApplier.applyPull(db, pull)
        }
    }
}
```

- [ ] **Step 4: Run sync tests and verify GREEN**

```bash
cd android && ./gradlew testDebugUnitTest --tests "com.jifo.app.sync.SyncCoordinatorTest"
```

Expected: PASS.

- [ ] **Step 5: Add WorkManager worker**

Create `JifoSyncWorker.kt`:

```kotlin
package com.jifo.app.sync

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters

class JifoSyncWorker(
    appContext: Context,
    params: WorkerParameters
) : CoroutineWorker(appContext, params) {
    override suspend fun doWork(): Result {
        return try {
            ServiceLocator.syncCoordinator(applicationContext).runOnce()
            Result.success()
        } catch (error: Throwable) {
            Result.retry()
        }
    }
}
```

Create `SyncScheduler.kt`:

```kotlin
package com.jifo.app.sync

interface SyncScheduler {
    fun scheduleNow()
}
```

Create Android implementation using `OneTimeWorkRequestBuilder<JifoSyncWorker>()` with `NetworkType.CONNECTED`.

- [ ] **Step 6: Commit sync layer**

```bash
git add android/app/src/main/java/com/jifo/app/sync android/app/src/test/java/com/jifo/app/sync android/app/src/main/java/com/jifo/app/network
git commit -m "feat(android): add outbox sync coordinator" -m "Co-Authored-By: Craft Agent <agents-noreply@craft.do>"
```

---

## Task 8: Auth and settings repositories

**Files:**
- Create/modify auth repository and session storage
- Create/modify settings repository
- Extend `JifoApi.kt`
- Create tests

- [ ] **Step 1: Write failing auth payload test**

Create `AuthRepositoryTest.kt`:

```kotlin
package com.jifo.app.auth

import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

class AuthRepositoryTest {
    @Test fun loginSendsAndroidDeviceCodeAndPersistsSession() = runTest {
        val api = FakeAuthApi()
        val store = InMemorySessionStore()
        val repo = AuthRepository(api, store, FixedIdGenerator("android-device-1"))

        repo.login("user@example.com", "password123")

        assertEquals("android-device-1", api.lastAuthRequest!!.deviceCode)
        assertEquals("access-token", store.current()!!.accessToken)
    }
}
```

- [ ] **Step 2: Run and verify RED**

```bash
cd android && ./gradlew testDebugUnitTest --tests "com.jifo.app.auth.AuthRepositoryTest"
```

Expected: FAIL because repository does not exist.

- [ ] **Step 3: Implement AuthRepository**

Create `AuthRepository.kt`:

```kotlin
package com.jifo.app.auth

import com.jifo.app.core.id.IdGenerator
import com.jifo.app.network.AuthRequest
import com.jifo.app.network.JifoApi

class AuthRepository(
    private val api: JifoApi,
    private val sessionStore: SessionStore,
    private val idGenerator: IdGenerator
) {
    suspend fun login(email: String, password: String) {
        val response = api.login(AuthRequest(email = email, password = password, deviceCode = sessionStore.deviceCode() ?: idGenerator.newDeviceCode("android")))
        sessionStore.save(response)
    }

    suspend fun register(email: String, password: String) {
        val username = email.substringBefore('@').ifBlank { email }
        val response = api.register(AuthRequest(email = email, password = password, username = username, deviceCode = sessionStore.deviceCode() ?: idGenerator.newDeviceCode("android")))
        sessionStore.save(response)
    }

    suspend fun logout() = sessionStore.clear()
}
```

- [ ] **Step 4: Add settings API tests and implementation**

Test list/create/delete:

```kotlin
@Test fun createAccessKeyReturnsOneTimeSecret() = runTest {
    val api = FakeSettingsApi(secret = "jifo_secret")
    val repo = SettingsRepository(api)

    val result = repo.createAccessKey("Android")

    assertEquals("jifo_secret", result.secret)
}
```

Implement `SettingsRepository` as a thin wrapper around:

```kotlin
@GET("settings/access-keys") suspend fun accessKeys(): AccessKeyListDto
@POST("settings/access-keys") suspend fun createAccessKey(@Body body: CreateAccessKeyRequest): CreateAccessKeyResponse
@DELETE("settings/access-keys/{id}") suspend fun deleteAccessKey(@Path("id") id: String)
```

- [ ] **Step 5: Run tests and verify GREEN**

```bash
cd android && ./gradlew testDebugUnitTest --tests "com.jifo.app.auth.AuthRepositoryTest" --tests "com.jifo.app.settings.SettingsRepositoryTest"
```

Expected: PASS.

- [ ] **Step 6: Commit auth/settings repositories**

```bash
git add android/app/src/main/java/com/jifo/app/auth android/app/src/main/java/com/jifo/app/settings android/app/src/test/java/com/jifo/app/auth android/app/src/test/java/com/jifo/app/settings
git commit -m "feat(android): add auth and settings repositories" -m "Co-Authored-By: Craft Agent <agents-noreply@craft.do>"
```

---

## Task 9: Main XML UI shell, drawer, and note list

**Files:**
- Create layouts and drawables
- Create `NotesFragment`, `NotesViewModel`, `NoteAdapter`, drawer adapters
- Create UI/unit tests

- [ ] **Step 1: Write failing UI structure test**

Create Robolectric test `NotesFragmentTest.kt`:

```kotlin
package com.jifo.app.notes

import androidx.fragment.app.testing.launchFragmentInContainer
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.jifo.app.R
import org.junit.Assert.assertNotNull
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class NotesFragmentTest {
    @Test fun topBarHasMenuLogoAndSearchWithoutTitleRow() {
        val scenario = launchFragmentInContainer<NotesFragment>(themeResId = R.style.Theme_Jifo)
        scenario.onFragment { fragment ->
            val view = fragment.requireView()
            assertNotNull(view.findViewById(R.id.button_menu))
            assertNotNull(view.findViewById(R.id.jifo_logo))
            assertNotNull(view.findViewById(R.id.button_search))
            assertNotNull(view.findViewById(R.id.notes_recycler))
            assertNull(view.findViewById(R.id.workspace_title))
        }
    }
}
```

- [ ] **Step 2: Run and verify RED**

```bash
cd android && ./gradlew testDebugUnitTest --tests "com.jifo.app.notes.NotesFragmentTest"
```

Expected: FAIL because UI does not exist.

- [ ] **Step 3: Implement `fragment_notes.xml`**

Use `DrawerLayout` with compact top bar and RecyclerView:

```xml
<androidx.drawerlayout.widget.DrawerLayout xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:app="http://schemas.android.com/apk/res-auto"
    android:id="@+id/drawer_layout"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:background="@color/jifo_bg">

    <androidx.coordinatorlayout.widget.CoordinatorLayout
        android:layout_width="match_parent"
        android:layout_height="match_parent">

        <LinearLayout
            android:id="@+id/top_bar"
            android:layout_width="match_parent"
            android:layout_height="44dp"
            android:gravity="center_vertical"
            android:orientation="horizontal"
            android:paddingStart="12dp"
            android:paddingEnd="12dp">

            <ImageButton
                android:id="@+id/button_menu"
                android:layout_width="32dp"
                android:layout_height="32dp"
                android:background="@android:color/transparent"
                android:contentDescription="打开菜单"
                android:src="@drawable/ic_menu_24" />

            <LinearLayout
                android:id="@+id/jifo_logo"
                android:layout_width="0dp"
                android:layout_height="match_parent"
                android:layout_weight="1"
                android:gravity="center"
                android:orientation="horizontal">
                <ImageView
                    android:layout_width="24dp"
                    android:layout_height="24dp"
                    android:src="@drawable/ic_jifo_mark" />
                <TextView
                    android:layout_width="wrap_content"
                    android:layout_height="wrap_content"
                    android:layout_marginStart="7dp"
                    android:text="Jifo"
                    android:textColor="@color/jifo_ink"
                    android:textStyle="bold"
                    android:textSize="18sp" />
            </LinearLayout>

            <ImageButton
                android:id="@+id/button_search"
                android:layout_width="32dp"
                android:layout_height="32dp"
                android:background="@android:color/transparent"
                android:contentDescription="搜索笔记"
                android:src="@drawable/ic_search_24" />
        </LinearLayout>

        <androidx.recyclerview.widget.RecyclerView
            android:id="@+id/notes_recycler"
            android:layout_width="match_parent"
            android:layout_height="match_parent"
            android:layout_marginTop="44dp"
            android:clipToPadding="false"
            android:padding="10dp"
            android:paddingBottom="88dp" />

        <com.google.android.material.floatingactionbutton.FloatingActionButton
            android:id="@+id/button_add_note"
            android:layout_width="48dp"
            android:layout_height="48dp"
            android:layout_gravity="bottom|center_horizontal"
            android:layout_marginBottom="20dp"
            android:contentDescription="新建笔记"
            app:backgroundTint="@color/jifo_amber"
            app:srcCompat="@drawable/ic_add_24"
            app:tint="@android:color/white" />
    </androidx.coordinatorlayout.widget.CoordinatorLayout>

    <include
        android:id="@+id/drawer_content"
        layout="@layout/layout_drawer"
        android:layout_width="260dp"
        android:layout_height="match_parent"
        android:layout_gravity="start" />
</androidx.drawerlayout.widget.DrawerLayout>
```

- [ ] **Step 4: Implement drawer layout**

Create `layout_drawer.xml` with username centered and no icon/status:

```xml
<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="260dp"
    android:layout_height="match_parent"
    android:orientation="vertical"
    android:padding="10dp"
    android:background="@color/jifo_card_solid">

    <TextView
        android:id="@+id/text_user_name"
        android:layout_width="match_parent"
        android:layout_height="36dp"
        android:gravity="center_vertical"
        android:textColor="@color/jifo_ink"
        android:textSize="15sp"
        android:textStyle="bold" />

    <LinearLayout
        android:id="@+id/stats_row"
        android:layout_width="match_parent"
        android:layout_height="wrap_content"
        android:orientation="horizontal" />

    <androidx.recyclerview.widget.RecyclerView
        android:id="@+id/heatmap_recycler"
        android:layout_width="match_parent"
        android:layout_height="48dp" />

    <TextView
        android:id="@+id/button_all_notes"
        android:layout_width="match_parent"
        android:layout_height="32dp"
        android:gravity="center_vertical"
        android:text="▦ 全部笔记"
        android:textColor="@color/jifo_green_dark" />

    <androidx.recyclerview.widget.RecyclerView
        android:id="@+id/tag_recycler"
        android:layout_width="match_parent"
        android:layout_height="0dp"
        android:layout_weight="1" />
</LinearLayout>
```

- [ ] **Step 5: Implement adapter and view model binding**

Create `NoteAdapter.kt` using `ListAdapter<NoteEntity, NoteViewHolder>` and `DiffUtil.ItemCallback`. Bind:

- time text from `createdAt` formatted like `yyyy-MM-dd HH:mm:ss`.
- paragraph text with tag spans.
- divider as horizontal line in note block container.
- overflow menu with `编辑` and `删除`.

- [ ] **Step 6: Run UI structure test and verify GREEN**

```bash
cd android && ./gradlew testDebugUnitTest --tests "com.jifo.app.notes.NotesFragmentTest"
```

Expected: PASS.

- [ ] **Step 7: Commit main UI shell**

```bash
git add android/app/src/main/res android/app/src/main/java/com/jifo/app/notes android/app/src/main/java/com/jifo/app/drawer android/app/src/test/java/com/jifo/app/notes
git commit -m "feat(android): add notes screen with drawer and list" -m "Co-Authored-By: Craft Agent <agents-noreply@craft.do>"
```

---

## Task 10: Bottom sheet note editor and search

**Files:**
- Create: `bottom_sheet_note_editor.xml`
- Create: `NoteEditorBottomSheet.kt`
- Modify: `NotesFragment.kt`, `NotesViewModel.kt`
- Create tests

- [ ] **Step 1: Write failing editor state test**

Create `NoteEditorBottomSheetTest.kt`:

```kotlin
package com.jifo.app.notes

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class NoteEditorStateTest {
    @Test fun sendButtonEnabledOnlyWhenTrimmedTextExists() {
        assertFalse(NoteEditorState("").canSend)
        assertFalse(NoteEditorState("   \n").canSend)
        assertTrue(NoteEditorState("hello").canSend)
    }
}
```

- [ ] **Step 2: Run and verify RED**

```bash
cd android && ./gradlew testDebugUnitTest --tests "com.jifo.app.notes.NoteEditorStateTest"
```

Expected: FAIL because `NoteEditorState` does not exist.

- [ ] **Step 3: Implement editor state and bottom sheet XML**

Create `NoteEditorState.kt`:

```kotlin
package com.jifo.app.notes

data class NoteEditorState(val text: String) {
    val canSend: Boolean = text.trim().isNotEmpty()
}
```

Create `bottom_sheet_note_editor.xml`:

```xml
<LinearLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent"
    android:layout_height="wrap_content"
    android:orientation="vertical"
    android:padding="8dp"
    android:background="@drawable/bg_bottom_sheet">

    <EditText
        android:id="@+id/edit_note"
        android:layout_width="match_parent"
        android:layout_height="132dp"
        android:background="@android:color/transparent"
        android:gravity="top|start"
        android:hint="@string/note_placeholder"
        android:inputType="textMultiLine|textCapSentences"
        android:padding="8dp"
        android:textColor="@color/jifo_ink"
        android:textColorHint="@color/jifo_muted" />

    <ImageButton
        android:id="@+id/button_send"
        android:layout_width="34dp"
        android:layout_height="34dp"
        android:layout_gravity="end"
        android:background="@drawable/bg_send_button_enabled"
        android:contentDescription="发送笔记"
        android:src="@drawable/ic_send_24" />
</LinearLayout>
```

Create `NoteEditorBottomSheet.kt` as a `BottomSheetDialogFragment` that:

- listens to text changes,
- sets send enabled when `NoteEditorState(text).canSend`,
- uses grey disabled background when empty,
- calls `onSubmit(text)` and dismisses.

- [ ] **Step 4: Implement search mode**

In `NotesFragment`, clicking `button_search` replaces center logo with an `EditText` search field. Closing search clears query. In `NotesViewModel`, debounce query for 300ms before calling repository `observeNotes(search, tagPath)`.

- [ ] **Step 5: Run tests and verify GREEN**

```bash
cd android && ./gradlew testDebugUnitTest --tests "com.jifo.app.notes.NoteEditorStateTest"
```

Expected: PASS.

- [ ] **Step 6: Commit editor/search**

```bash
git add android/app/src/main/res/layout/bottom_sheet_note_editor.xml android/app/src/main/java/com/jifo/app/notes android/app/src/test/java/com/jifo/app/notes
git commit -m "feat(android): add compact note editor and search" -m "Co-Authored-By: Craft Agent <agents-noreply@craft.do>"
```

---

## Task 11: Login and settings UI

**Files:**
- Create login layout/fragment/viewmodel
- Create settings bottom sheet/layout/viewmodel
- Create tests

- [ ] **Step 1: Write failing login validation test**

Create `LoginViewModelTest.kt`:

```kotlin
package com.jifo.app.auth

import org.junit.Assert.assertEquals
import org.junit.Test

class LoginViewModelTest {
    @Test fun rejectsEmptyEmailBeforeCallingRepository() {
        val repo = FakeAuthRepository()
        val vm = LoginViewModel(repo)

        vm.submitLogin("", "password123")

        assertEquals("请输入邮箱", vm.state.value!!.error)
        assertEquals(0, repo.loginCalls)
    }
}
```

- [ ] **Step 2: Run and verify RED**

```bash
cd android && ./gradlew testDebugUnitTest --tests "com.jifo.app.auth.LoginViewModelTest"
```

Expected: FAIL because LoginViewModel does not exist.

- [ ] **Step 3: Implement login screen**

Create `fragment_login.xml` with:

- Jifo title/brand,
- login/register toggle,
- email input,
- password input,
- primary rounded submit button,
- error text styled with danger color.

Implement `LoginViewModel` with validation:

```kotlin
if (email.isBlank()) return state.value = state.value!!.copy(error = "请输入邮箱")
if (password.length < 8) return state.value = state.value!!.copy(error = "密码至少 8 位")
```

Implement `LoginFragment` to call `AuthRepository.login` or `register`, then navigate to `NotesFragment`.

- [ ] **Step 4: Implement settings bottom sheet**

Create settings UI with:

- access key list,
- create label input,
- one-time secret card,
- delete buttons,
- logout button.

Add `SettingsViewModelTest` for create key secret retention:

```kotlin
@Test fun createAccessKeyShowsOneTimeSecret() = runTest {
    val vm = SettingsViewModel(FakeSettingsRepository(secret = "jifo_secret"))
    vm.createAccessKey("Android")
    assertEquals("jifo_secret", vm.state.value!!.createdSecret)
}
```

- [ ] **Step 5: Run tests and verify GREEN**

```bash
cd android && ./gradlew testDebugUnitTest --tests "com.jifo.app.auth.LoginViewModelTest" --tests "com.jifo.app.settings.SettingsViewModelTest"
```

Expected: PASS.

- [ ] **Step 6: Commit auth/settings UI**

```bash
git add android/app/src/main/res/layout/fragment_login.xml android/app/src/main/res/layout/bottom_sheet_settings.xml android/app/src/main/java/com/jifo/app/auth android/app/src/main/java/com/jifo/app/settings android/app/src/test/java/com/jifo/app/auth android/app/src/test/java/com/jifo/app/settings
git commit -m "feat(android): add login and settings UI" -m "Co-Authored-By: Craft Agent <agents-noreply@craft.do>"
```

---

## Task 12: Final integration, docs, and verification

**Files:**
- Modify: `README.md`
- Create: `android/README.md`
- Modify any Android integration files required by final wiring

- [ ] **Step 1: Wire MainActivity navigation**

`MainActivity` should:

- open `LoginFragment` when no session exists,
- open `NotesFragment` when session exists,
- expose a simple method or navigation callback for logout to return to login.

- [ ] **Step 2: Wire dependency creation**

Create a small `ServiceLocator` in Android application scope:

```kotlin
object ServiceLocator {
    fun database(context: Context): JifoDatabase = Room.databaseBuilder(context, JifoDatabase::class.java, "jifo.db").build()
    fun api(context: Context): JifoApi = ApiClientFactory.create(BuildConfig.DEFAULT_API_BASE_URL, tokenStore(context))
}
```

Use constructor injection in tests and `ServiceLocator` only in Android entry points.

- [ ] **Step 3: Add Android README**

Create `android/README.md`:

```markdown
# Jifo Android

Native Android client for Jifo.

## Requirements

- JDK 17+
- Android SDK Platform 35
- Android SDK Build Tools 35.x

## Run tests

```bash
./gradlew testDebugUnitTest
```

## Build debug APK

```bash
./gradlew assembleDebug
```

The emulator default API URL is `http://10.0.2.2:8080/api`.
```

- [ ] **Step 4: Run full backend verification**

Run:

```bash
cd backend && go test ./...
```

Expected: PASS.

- [ ] **Step 5: Run full web verification**

Run:

```bash
cd web && npm test -- --run && npm run build
```

Expected: PASS.

- [ ] **Step 6: Run full Android verification**

Run:

```bash
cd android && ./gradlew testDebugUnitTest assembleDebug
```

Expected: PASS and debug APK generated under `android/app/build/outputs/apk/debug/`.

- [ ] **Step 7: Inspect final diff**

Run:

```bash
git status --short
git diff --stat HEAD
```

Expected: only intended Android files, backend conflict wording/test, sync docs, and README changes are present if not already committed by previous tasks.

- [ ] **Step 8: Commit final integration changes**

If Task 12 has uncommitted integration or documentation changes, commit them with this command:

```bash
git add README.md android/README.md android/app/src/main/java android/app/src/main/res android/app/build.gradle.kts android/settings.gradle.kts android/build.gradle.kts android/gradle.properties
git commit -m "feat(android): wire app integration" -m "Co-Authored-By: Craft Agent <agents-noreply@craft.do>"
```

- [ ] **Step 9: Completion report**

Report with fresh evidence:

- backend test command output summary,
- web test/build output summary,
- Android unit test/build output summary,
- APK path,
- any environment limitation if Android SDK/JDK was unavailable.

---

## Self-Review

### Spec coverage

- Web feature scope: covered by auth, notes, drawer, search, settings, sync tasks.
- UI v2 adjustments: covered by Task 9 and Task 10 XML requirements.
- RecyclerView native list: covered by Task 9.
- Offline-first Room/outbox/WorkManager: covered by Tasks 4, 6, 7.
- Conflict note prefix and divider: covered by Task 1 and Task 7.
- Access key settings: covered by Task 8 and Task 11.
- Verification: covered by Task 12.

### 占位符检查

The plan avoids deferred work markers and names files, red/green verification commands, and expected outcomes for each task.

### Type consistency

- Sync statuses are strings in Room entities: `SYNCED`, `PENDING`, `SYNCING`, `FAILED` for notes; `pending`, `pushing`, `failed` for outbox, matching the Web sync document distinction.
- Sync result status strings match backend: `created`, `updated`, `deleted`, `restored`, `duplicate`, `conflict_copied`, `delete_conflict_ignored`.
- Conflict prefix is consistently `此条笔记冲突`.
