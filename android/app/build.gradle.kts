import org.gradle.api.DefaultTask
import org.gradle.api.file.DirectoryProperty
import org.gradle.api.file.RegularFileProperty
import org.gradle.api.tasks.InputFile
import org.gradle.api.tasks.OutputDirectory
import org.gradle.api.tasks.TaskAction

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
    alias(libs.plugins.kotlin.serialization)
    alias(libs.plugins.ksp)
}

android {
    namespace = "io.github.serabin1.rssreader"
    compileSdk = 37

    defaultConfig {
        applicationId = "io.github.serabin1.rssreader"
        minSdk = 26
        targetSdk = 36
        // CI derives both from the android-v* release tag (major*10000 + minor*100 + patch),
        // so every published APK installs as an update over the previous one.
        versionCode = providers.gradleProperty("versionCode").map(String::toInt).getOrElse(1)
        versionName = providers.gradleProperty("versionName").getOrElse("1.0.0-dev")
        // The web app's origin: home of the sync endpoints and the live curated
        // feed list. Feeds themselves are fetched directly — Android has no
        // CORS, so /api/feed is a web-only concern.
        buildConfigField("String", "WEB_ORIGIN", "\"https://my-rss-reader.serabin1.workers.dev\"")
    }

    // The release key exists only in CI secrets. Every published APK must carry
    // the same signature or Android refuses to install it as an update, so it
    // can't be the debug key, which is generated per machine.
    val releaseKeystore = providers.environmentVariable("ANDROID_KEYSTORE_FILE").orNull
    signingConfigs {
        if (releaseKeystore != null) {
            create("release") {
                storeFile = file(releaseKeystore)
                storePassword = providers.environmentVariable("ANDROID_KEYSTORE_PASSWORD").get()
                keyAlias = providers.environmentVariable("ANDROID_KEY_ALIAS").get()
                keyPassword = providers.environmentVariable("ANDROID_KEYSTORE_PASSWORD").get()
            }
        }
    }

    buildTypes {
        release {
            // Locally, without the release key, signed with the debug key so an
            // optimised build can still be installed — debug builds run Compose
            // unoptimised and scroll noticeably worse.
            signingConfig = signingConfigs.findByName("release") ?: signingConfigs.getByName("debug")
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

}

// The curated list ships as a snapshot of the web app's own file, used only
// until the first successful fetch of the live one — see CuratedFeeds.
abstract class CopyCuratedFeeds : DefaultTask() {
    @get:InputFile abstract val source: RegularFileProperty
    @get:OutputDirectory abstract val outputDir: DirectoryProperty

    @TaskAction
    fun copy() {
        val target = outputDir.get().file("curated-feeds.opml").asFile
        source.get().asFile.copyTo(target, overwrite = true)
    }
}

val copyCuratedFeeds = tasks.register<CopyCuratedFeeds>("copyCuratedFeeds") {
    source.set(rootProject.layout.projectDirectory.file("../public/curated-feeds.opml"))
}

androidComponents {
    onVariants { variant ->
        variant.sources.assets?.addGeneratedSourceDirectory(copyCuratedFeeds, CopyCuratedFeeds::outputDir)
    }
}

ksp {
    arg("room.schemaLocation", "$projectDir/schemas")
}

// The shared Rust crate ships inside the APK, built from android/../rust.
// Hooked into the JNI packaging tasks rather than preBuild, so running unit
// tests doesn't require a Rust toolchain. Release builds need one.
val cargoBuildRust = tasks.register<Exec>("cargoBuildRustRssReaderCore") {
    workingDir = rootProject.file("../rust")
    commandLine("cargo", "build", "--release", "--target", "aarch64-linux-android")
}

val copyRustJniLibs = tasks.register<Copy>("copyRustJniLibs") {
    dependsOn(cargoBuildRust)
    from("../../rust/target/aarch64-linux-android/release/librss_reader_core.so")
    into(layout.buildDirectory.dir("jniLibs/arm64-v8a"))
}

android.sourceSets.getByName("main").jniLibs.directories.add(layout.buildDirectory.dir("jniLibs").get().asFile.absolutePath)

// Wire the library into the JNI packaging tasks, if any exist (task names
// moved between AGP versions). Soft hook: silent no-op when none match, so
// the unit-test task (no Rust toolchain in Android CI) is unaffected.
val copyRustJniLibsTask = copyRustJniLibs
afterEvaluate {
    tasks.matching {
        it.name.startsWith("mergeDebug") && (it.name.contains("JniLib") || it.name.contains("NativeLib"))
            || it.name.startsWith("mergeRelease") && (it.name.contains("JniLib") || it.name.contains("NativeLib"))
    }.configureEach { dependsOn(copyRustJniLibsTask) }
}

dependencies {
    implementation(libs.androidx.core.ktx)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.lifecycle.runtime.compose)
    implementation(libs.androidx.lifecycle.viewmodel.compose)
    implementation(libs.androidx.navigation.compose)
    implementation(libs.androidx.room.runtime)
    implementation(libs.androidx.room.ktx)
    ksp(libs.androidx.room.compiler)
    implementation(libs.androidx.work.runtime.ktx)
    implementation(libs.androidx.datastore.preferences)
    implementation(libs.androidx.browser)

    implementation(platform(libs.compose.bom))
    implementation(libs.compose.ui)
    implementation(libs.compose.ui.tooling.preview)
    implementation(libs.compose.material3)
    implementation(libs.compose.material.icons.core)
    debugImplementation(libs.compose.ui.tooling)

    implementation(libs.okhttp)
    implementation(libs.kotlinx.serialization.json)
    implementation(libs.kotlinx.coroutines.android)
    implementation(libs.zxing.core)

    testImplementation(libs.junit)
}
