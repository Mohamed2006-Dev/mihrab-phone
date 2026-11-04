package com.mihrab.mobile;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import androidx.core.splashscreen.SplashScreen;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
 private boolean bootMarkupReady=false;
 public class StartupBridge {
  @JavascriptInterface public void bootMarkupReady(){runOnUiThread(()->{MainActivity.this.bootMarkupReady=true;});}
 }
 @Override public void onCreate(Bundle savedInstanceState){
  SplashScreen splash=SplashScreen.installSplashScreen(this);
  registerPlugin(MihrabDevicePlugin.class);
  super.onCreate(savedInstanceState);
  splash.setKeepOnScreenCondition(()->!bootMarkupReady);
  splash.setOnExitAnimationListener(provider->provider.getView().animate().alpha(0f).setDuration(90).withEndAction(provider::remove).start());
  // Native fallback only: the HTML boot screen still hides uninitialized content.
  getBridge().getWebView().postDelayed(()->bootMarkupReady=true,12000);
 }
 @Override protected void load(){
  android.webkit.WebView view=findViewById(com.getcapacitor.android.R.id.webview);
  view.setBackgroundColor(android.graphics.Color.rgb(11,33,25));
  view.addJavascriptInterface(new StartupBridge(),"MihrabStartup");
  super.load();
 }
}
