import java.util.Properties

plugins {
    id("com.android.application")
}

android {
    namespace = "com.saro.cyberdeck"
    compileSdk = 34

    defaultConfig {
        applicationId = "com.saro.cyberdeck"
        minSdk = 24
        targetSdk = 34
        versionCode = 1
        versionName = "1.0.0-saro"
    }

    val localProperties = Properties()
    val localPropertiesFile = rootProject.file("local.properties")
    if (localPropertiesFile.exists()) {
        localProperties.load(localPropertiesFile.inputStream())
    }

    fun getProp(name: String): String {
        return (localProperties.getProperty(name) ?: project.findProperty(name)) as String? ?: ""
    }

    signingConfigs {
        create("release") {
            storeFile = file(getProp("MY_KEYSTORE_FILE"))
            storePassword = getProp("MY_KEYSTORE_PASSWORD")
            keyAlias = getProp("MY_KEY_ALIAS")
            keyPassword = getProp("MY_KEY_PASSWORD")
        }
    }

    buildTypes {
        release {
            signingConfig = signingConfigs.getByName("release")
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

dependencies {
    implementation("androidx.appcompat:appcompat:1.6.1")
    implementation("com.google.android.material:material:1.11.0")
    implementation("androidx.constraintlayout:constraintlayout:2.1.4")
    implementation("androidx.recyclerview:recyclerview:1.3.2")
    implementation("androidx.cardview:cardview:1.0.0")
    implementation("androidx.swiperefreshlayout:swiperefreshlayout:1.1.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("org.json:json:20231013")
}
