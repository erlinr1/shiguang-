# Keep the JavaScript bridge methods.
-keepclassmembers class com.shici.app.MainActivity$TtsBridge {
    @android.webkit.JavascriptInterface <methods>;
}
