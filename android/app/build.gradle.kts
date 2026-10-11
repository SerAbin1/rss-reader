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
        versionCode = 1
        versionName = "0.1.0"
        // The web app's origin: home of the sync endpoints and the live curated
        // feed list. Feeds themselves are fetched directly — Android has no
        // CORS, so /api/feed is a web-only concern.
        buildConfigField("String", "WEB_ORIGIN", "\"https://my-rss-reader.pages.dev\"")
    }

    buildTypes {
        release {
            // Prelaunch: signed with the debug key so an optimised build can be
            // installed locally — debug builds run Compose unoptimised and
            // scroll noticeably worse. Needs a real key before any release.
            signingConfig = signingConfigs.getByName("debug")
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    // The TS tests' fixtures, shared rather than copied, so both parsers are
    // held to the same documents.
    sourceSets.getByName("test").resources.directories.add("../../src/lib/__fixtures__")
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
