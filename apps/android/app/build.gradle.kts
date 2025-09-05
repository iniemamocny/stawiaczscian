
plugins { id("com.android.application"); id("org.jetbrains.kotlin.android") }
android {
    namespace "com.mebloplan.scanner"
    compileSdk 35
    defaultConfig { applicationId "com.mebloplan.scanner"; minSdk 26; targetSdk 35; versionCode 1; versionName "1.0" }
    buildTypes { release { isMinifyEnabled = false } }
}
dependencies {
    implementation("com.google.ar:core:1.46.0")
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("com.google.android.material:material:1.12.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")
    testImplementation("junit:junit:4.13.2")
    testImplementation("com.squareup.okhttp3:mockwebserver:4.12.0")
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.8.1")
}
