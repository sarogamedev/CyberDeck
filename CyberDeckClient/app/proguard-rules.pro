# Add project specific ProGuard rules here.
-keepclassmembers class com.cyberdeck.client.** { *; }
-dontwarn okhttp3.**
-dontwarn okio.**
-keep class okhttp3.** { *; }
