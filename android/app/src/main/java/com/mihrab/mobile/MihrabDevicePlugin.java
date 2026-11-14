package com.mihrab.mobile;

import android.app.ActivityManager;
import android.app.usage.StorageStats;
import android.app.usage.StorageStatsManager;
import android.content.Context;
import android.os.Build;
import android.view.View;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.graphics.Insets;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name="MihrabDevice",permissions={@com.getcapacitor.annotation.Permission(alias="location",strings={android.Manifest.permission.ACCESS_COARSE_LOCATION}),@com.getcapacitor.annotation.Permission(alias="gallery",strings={android.Manifest.permission.WRITE_EXTERNAL_STORAGE})})
public class MihrabDevicePlugin extends Plugin {
    private boolean hasGps() {
        return getContext().getPackageManager().hasSystemFeature(android.content.pm.PackageManager.FEATURE_LOCATION_GPS);
    }

    @PluginMethod public void requestLocationPermission(PluginCall call) {
        if (!hasGps()) { getPermissionStates(call); return; }
        requestPermissionForAlias("location",call,"locationPermissionResult");
    }
    @com.getcapacitor.annotation.PermissionCallback private void locationPermissionResult(PluginCall call){getPermissionStates(call);}
    @PluginMethod public void getPermissionStates(PluginCall call){
        boolean fine=androidx.core.content.ContextCompat.checkSelfPermission(getContext(),android.Manifest.permission.ACCESS_FINE_LOCATION)==android.content.pm.PackageManager.PERMISSION_GRANTED;
        boolean coarse=androidx.core.content.ContextCompat.checkSelfPermission(getContext(),android.Manifest.permission.ACCESS_COARSE_LOCATION)==android.content.pm.PackageManager.PERMISSION_GRANTED;
        JSObject out=new JSObject();out.put("location",hasGps() && (fine||coarse));out.put("notifications",androidx.core.app.NotificationManagerCompat.from(getContext()).areNotificationsEnabled());call.resolve(out);
    }
    @PluginMethod public void openNotificationSettings(PluginCall call){
        android.content.Intent intent;if(android.os.Build.VERSION.SDK_INT>=26){intent=new android.content.Intent(android.provider.Settings.ACTION_APP_NOTIFICATION_SETTINGS);intent.putExtra(android.provider.Settings.EXTRA_APP_PACKAGE,getContext().getPackageName());}else{intent=new android.content.Intent(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS,android.net.Uri.parse("package:"+getContext().getPackageName()));}getActivity().startActivity(intent);call.resolve();
    }
    @Override public void load(){
        if(android.os.Build.VERSION.SDK_INT>=24){android.net.ConnectivityManager manager=(android.net.ConnectivityManager)getContext().getSystemService(Context.CONNECTIVITY_SERVICE);networkCallback=new android.net.ConnectivityManager.NetworkCallback(){@Override public void onCapabilitiesChanged(android.net.Network n,android.net.NetworkCapabilities capabilities){publishNetwork(capabilities.hasCapability(android.net.NetworkCapabilities.NET_CAPABILITY_VALIDATED));}@Override public void onLost(android.net.Network n){publishNetwork(false);}};manager.registerDefaultNetworkCallback(networkCallback);}
    }
    private android.net.ConnectivityManager.NetworkCallback networkCallback;
    private void publishNetwork(boolean connected){JSObject out=new JSObject();out.put("connected",connected);notifyListeners("networkStatus",out);}
    @Override protected void handleOnDestroy(){if(networkCallback!=null){android.net.ConnectivityManager manager=(android.net.ConnectivityManager)getContext().getSystemService(Context.CONNECTIVITY_SERVICE);manager.unregisterNetworkCallback(networkCallback);}super.handleOnDestroy();}
    @PluginMethod public void renderHadithCard(PluginCall call){
      getActivity().runOnUiThread(()->{
        android.webkit.WebView view=new android.webkit.WebView(getContext());float density=getContext().getResources().getDisplayMetrics().density;int width=1200;
        view.getSettings().setJavaScriptEnabled(true);view.getSettings().setTextZoom(100);view.setInitialScale(100);view.setLayerType(android.view.View.LAYER_TYPE_SOFTWARE,null);
        view.measure(android.view.View.MeasureSpec.makeMeasureSpec(width,android.view.View.MeasureSpec.EXACTLY),android.view.View.MeasureSpec.makeMeasureSpec(2000,android.view.View.MeasureSpec.EXACTLY));view.layout(0,0,width,2000);
        view.setWebViewClient(new android.webkit.WebViewClient(){@Override public void onPageFinished(android.webkit.WebView v,String url){
          v.evaluateJavascript("document.fonts.ready.then(()=>document.documentElement.dataset.cardReady='1')",null);
          android.os.Handler handler=new android.os.Handler(android.os.Looper.getMainLooper());final int[] attempts={0};Runnable poll=new Runnable(){public void run(){v.evaluateJavascript("JSON.stringify({ready:document.documentElement.dataset.cardReady==='1',height:document.querySelector('.canvas').getBoundingClientRect().height})",raw->{try{
            String decoded=new org.json.JSONArray("["+raw+"]").getString(0);org.json.JSONObject size=new org.json.JSONObject(decoded);
            if(!size.getBoolean("ready")){if(++attempts[0]>100)throw new Exception("Font loading timed out");handler.postDelayed(this,50);return;}
            int height=(int)Math.ceil(size.getDouble("height"));if(height<1||height>16000)throw new Exception("Image size exceeds supported limit");v.layout(0,0,width,height);
            handler.postDelayed(()->{try{android.graphics.Bitmap bitmap=android.graphics.Bitmap.createBitmap(1200,height,android.graphics.Bitmap.Config.ARGB_8888);android.graphics.Canvas canvas=new android.graphics.Canvas(bitmap);v.draw(canvas);java.io.ByteArrayOutputStream stream=new java.io.ByteArrayOutputStream();bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG,100,stream);bitmap.recycle();JSObject out=new JSObject();out.put("data",android.util.Base64.encodeToString(stream.toByteArray(),android.util.Base64.NO_WRAP));call.resolve(out);}catch(Exception e){call.reject("تعذر رسم بطاقة الحديث",e);}finally{v.destroy();}},150);
          }catch(Exception e){v.destroy();call.reject("تعذر تجهيز بطاقة الحديث",e);}});}};handler.post(poll);
        }});view.loadDataWithBaseURL("https://localhost/",call.getString("html",""),"text/html","UTF-8",null);
      });
    }
    @PluginMethod public void saveImage(PluginCall call){
      try{
        byte[] bytes=android.util.Base64.decode(call.getString("data",""),android.util.Base64.DEFAULT);
        if(android.os.Build.VERSION.SDK_INT>=29){
          android.content.ContentResolver resolver=getContext().getContentResolver();android.content.ContentValues values=new android.content.ContentValues();values.put(android.provider.MediaStore.Images.Media.DISPLAY_NAME,"mihrab-hadith-"+System.currentTimeMillis()+".png");values.put(android.provider.MediaStore.Images.Media.MIME_TYPE,"image/png");values.put(android.provider.MediaStore.Images.Media.RELATIVE_PATH,"Pictures/الأحاديث-محراب");values.put(android.provider.MediaStore.Images.Media.IS_PENDING,1);
          android.net.Uri uri=resolver.insert(android.provider.MediaStore.Images.Media.EXTERNAL_CONTENT_URI,values);if(uri==null)throw new java.io.IOException("MediaStore insert failed");
          try{try(java.io.OutputStream stream=resolver.openOutputStream(uri)){if(stream==null)throw new java.io.IOException("No output stream");stream.write(bytes);}values.clear();values.put(android.provider.MediaStore.Images.Media.IS_PENDING,0);resolver.update(uri,values,null,null);}catch(Exception e){resolver.delete(uri,null,null);throw e;}
        }else{
          if(androidx.core.content.ContextCompat.checkSelfPermission(getContext(),android.Manifest.permission.WRITE_EXTERNAL_STORAGE)!=android.content.pm.PackageManager.PERMISSION_GRANTED){requestPermissionForAlias("gallery",call,"galleryPermission");return;}
          java.io.File dir=new java.io.File(android.os.Environment.getExternalStoragePublicDirectory(android.os.Environment.DIRECTORY_PICTURES),"الأحاديث-محراب");if(!dir.exists()&&!dir.mkdirs())throw new java.io.IOException("Cannot create gallery folder");java.io.File file=new java.io.File(dir,"mihrab-hadith-"+System.currentTimeMillis()+".png");try(java.io.FileOutputStream stream=new java.io.FileOutputStream(file)){stream.write(bytes);}android.media.MediaScannerConnection.scanFile(getContext(),new String[]{file.getAbsolutePath()},new String[]{"image/png"},null);
        }
        JSObject out=new JSObject();out.put("saved",true);call.resolve(out);
      }catch(Exception e){call.reject("تعذر حفظ الصورة في المعرض",e);}
    }
    @com.getcapacitor.annotation.PermissionCallback private void galleryPermission(PluginCall call){if(getPermissionState("gallery")==com.getcapacitor.PermissionState.GRANTED)saveImage(call);else call.reject("لم يُمنح إذن حفظ الصورة في المعرض.");}
    @PluginMethod public void copyImage(PluginCall call){
        try{java.io.File dir=new java.io.File(getContext().getCacheDir(),"shared-images");if(!dir.exists()&&!dir.mkdirs())throw new java.io.IOException("No cache directory");java.io.File image=new java.io.File(dir,"hadith-"+System.currentTimeMillis()+".png");try(java.io.FileOutputStream stream=new java.io.FileOutputStream(image)){stream.write(android.util.Base64.decode(call.getString("data",""),android.util.Base64.DEFAULT));}
            android.net.Uri uri=androidx.core.content.FileProvider.getUriForFile(getContext(),getContext().getPackageName()+".fileprovider",image);
            android.content.ClipboardManager clipboard=(android.content.ClipboardManager)getContext().getSystemService(Context.CLIPBOARD_SERVICE);clipboard.setPrimaryClip(android.content.ClipData.newUri(getContext().getContentResolver(),"حديث",uri));JSObject out=new JSObject();out.put("copied",true);call.resolve(out);
        }catch(Exception e){call.reject("تعذر نسخ الصورة",e);}
    }
    @PluginMethod
    public void getInfo(PluginCall call) {
        ActivityManager manager=(ActivityManager)getContext().getSystemService(Context.ACTIVITY_SERVICE);
        ActivityManager.MemoryInfo memory=new ActivityManager.MemoryInfo();
        manager.getMemoryInfo(memory);
        String soc=Build.VERSION.SDK_INT>=31?Build.SOC_MODEL:Build.HARDWARE;
        if(soc==null || soc.trim().isEmpty() || soc.equalsIgnoreCase("unknown"))soc=Build.HARDWARE;
        JSObject result=new JSObject();
        result.put("processor",soc);
        result.put("deviceModel",Build.MANUFACTURER+" "+Build.MODEL);
        result.put("memoryGB",Math.round(memory.totalMem/107374182.4)/10.0);
        result.put("logicalCores",Runtime.getRuntime().availableProcessors());
        result.put("cpuMHz",0);
        result.put("source","android");
        JSObject capabilities = new JSObject();
        capabilities.put("rearCamera", getContext().getPackageManager()
            .hasSystemFeature(android.content.pm.PackageManager.FEATURE_CAMERA));
        capabilities.put("gps", hasGps());
        capabilities.put("notifications", getContext().getSystemService(Context.NOTIFICATION_SERVICE) != null);
        result.put("capabilities", capabilities);
        result.put("osVersion", "Android " + Build.VERSION.RELEASE);
        View view=getBridge().getWebView();
        WindowInsetsCompat insets=ViewCompat.getRootWindowInsets(view);
        if(insets!=null){
            Insets bars=insets.getInsets(WindowInsetsCompat.Type.systemBars()|WindowInsetsCompat.Type.displayCutout());
            float density=getContext().getResources().getDisplayMetrics().density;
            int[] pos=new int[2];view.getLocationOnScreen(pos);
            result.put("safeTop",Math.max(0,bars.top-pos[1])/density);
            result.put("safeBottom",bars.bottom/density);
        }
        call.resolve(result);
    }

    private long bytes(java.io.File file, String root) throws java.io.IOException {
        if(file==null||!file.exists()||!file.getCanonicalPath().startsWith(root+java.io.File.separator))return 0;
        if(file.isFile())return file.length();
        long total=0;java.io.File[] children=file.listFiles();if(children!=null)for(java.io.File child:children)total+=bytes(child,root);return total;
    }
    @PluginMethod public void getPowerState(PluginCall call) {
        android.os.PowerManager manager = getContext().getSystemService(android.os.PowerManager.class);
        android.os.BatteryManager battery = getContext().getSystemService(android.os.BatteryManager.class);
        JSObject result = new JSObject();
        result.put("powerSaver", manager != null && manager.isPowerSaveMode());
        if (battery != null) {
            int level = battery.getIntProperty(android.os.BatteryManager.BATTERY_PROPERTY_CAPACITY);
            if (level >= 0 && level <= 100) result.put("lowBattery", level <= 20 && !battery.isCharging());
        }
        call.resolve(result);
    }

    @PluginMethod public void getStorageStats(PluginCall call) {
        new Thread(() -> measureStorage(call), "mihrab-storage").start();
    }

    private void measureStorage(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            try {
                Context context = getContext();
                StorageStatsManager manager = context.getSystemService(StorageStatsManager.class);
                StorageStats stats = manager.queryStatsForPackage(
                    context.getApplicationInfo().storageUuid,
                    context.getPackageName(),
                    android.os.Process.myUserHandle()
                );
                long data = stats.getDataBytes();
                long cache = Math.min(data, stats.getCacheBytes());
                resolveStorage(call, stats.getAppBytes(), data - cache, cache, true);
                return;
            } catch (Exception error) {
                android.util.Log.w("MihrabDevice", "System storage statistics unavailable", error);
            }
        }
        measurePrivateFiles(call);
    }

    private void resolveStorage(PluginCall call, long application, long data, long cache, boolean system) {
        JSObject disk = new JSObject();
        disk.put("application", application);
        disk.put("data", data);
        disk.put("profile", cache);
        disk.put("total", application + data + cache);
        JSObject result = new JSObject();
        result.put("disk", disk);
        result.put("system", system);
        result.put("memory", android.os.Debug.getPss() * 1024L);
        call.resolve(result);
    }

    private void measurePrivateFiles(PluginCall call) {
        try{
            android.content.pm.ApplicationInfo info=getContext().getApplicationInfo();
            long application=new java.io.File(info.sourceDir).length();
            if(info.splitSourceDirs!=null)for(String split:info.splitSourceDirs)application+=new java.io.File(split).length();
            java.io.File root=getContext().getDataDir();String canonical=root.getCanonicalPath();long all=0;
            java.io.File[] children=root.listFiles();if(children!=null)for(java.io.File child:children)all+=bytes(child,canonical);
            long cache=bytes(getContext().getCacheDir(),canonical)+bytes(getContext().getCodeCacheDir(),canonical);
            if(info.nativeLibraryDir!=null){java.io.File lib=new java.io.File(info.nativeLibraryDir);String base=lib.getCanonicalPath();java.io.File[] libs=lib.listFiles();if(libs!=null)for(java.io.File f:libs)application+=bytes(f,base);}
            resolveStorage(call, application, Math.max(0, all - cache), Math.min(all, cache), false);
        }catch(Exception error){call.reject("تعذر قياس ملفات التطبيق",error);}
    }
    @PluginMethod public void getNetworkStats(PluginCall call){
        int uid=android.os.Process.myUid();
        long rx=android.net.TrafficStats.getUidRxBytes(uid),tx=android.net.TrafficStats.getUidTxBytes(uid);
        JSObject result=new JSObject();result.put("supported",rx>=0&&tx>=0);result.put("rx",rx);result.put("tx",tx);
        result.put("boot",android.provider.Settings.Global.getInt(getContext().getContentResolver(),"boot_count",-1));
        call.resolve(result);
    }

    @PluginMethod public void openExternal(PluginCall call){
        String raw=call.getString("url","");android.net.Uri uri=android.net.Uri.parse(raw);
        String scheme=uri.getScheme();
        if(!("https".equals(scheme)||"http".equals(scheme)||"mailto".equals(scheme))||uri.getUserInfo()!=null){call.reject("نوع الرابط غير مسموح.");return;}
        getActivity().runOnUiThread(()->{
            try{
                android.content.Intent intent;
                if("mailto".equals(scheme)){
                    android.net.MailTo mail=android.net.MailTo.parse(raw);
                    intent=new android.content.Intent(android.content.Intent.ACTION_SENDTO,uri);
                    intent.putExtra(android.content.Intent.EXTRA_EMAIL,new String[]{mail.getTo()});
                    intent.putExtra(android.content.Intent.EXTRA_SUBJECT,call.getString("subject",mail.getSubject()));
                    intent.putExtra(android.content.Intent.EXTRA_TEXT,call.getString("body",mail.getBody()));
                    try{intent.setPackage("com.google.android.gm");getActivity().startActivity(intent);}
                    catch(android.content.ActivityNotFoundException missing){intent.setPackage(null);getActivity().startActivity(intent);}
                }else{intent=new android.content.Intent(android.content.Intent.ACTION_VIEW,uri);getActivity().startActivity(intent);}
                JSObject result=new JSObject();result.put("opened",true);call.resolve(result);
            }catch(android.content.ActivityNotFoundException error){call.reject("لا يوجد تطبيق مناسب لفتح الرابط. ثبّت تطبيق بريد لإرسال الرسالة.");}
             catch(Exception error){call.reject("تعذر فتح الرابط في التطبيق الخارجي.",error);}
        });
    }


    @PluginMethod public void updatePrayerWidget(PluginCall call){
        try{
            org.json.JSONObject value=new org.json.JSONObject(call.getString("payload","{}"));
            org.json.JSONArray rows=value.getJSONArray("prayers");
            if(rows.length()>90)throw new IllegalArgumentException("Too many prayers");
            for(int i=0;i<rows.length();i++){
                org.json.JSONObject row=rows.getJSONObject(i);
                if(row.getLong("at")<=0||row.getString("name").length()>60)throw new IllegalArgumentException("Invalid prayer");
            }
            getContext().getSharedPreferences("mihrab_widget",Context.MODE_PRIVATE).edit().putString("schedule",value.toString()).apply();
            if(!MihrabPrayerWidget.refreshAll(getContext()))throw new IllegalStateException("Widget rendering failed");
            JSObject result=new JSObject();result.put("updated",true);call.resolve(result);
        }catch(Exception error){call.reject("تعذر تحديث بيانات ويدجت المواقيت.",error);}
    }
    @PluginMethod public void requestPrayerWidget(PluginCall call){
        getActivity().runOnUiThread(()->{
            try{
                android.appwidget.AppWidgetManager manager=android.appwidget.AppWidgetManager.getInstance(getContext());
                boolean supported=Build.VERSION.SDK_INT>=26&&manager.isRequestPinAppWidgetSupported();
                android.content.ComponentName provider = new android.content.ComponentName(getContext(), MihrabPrayerWidget.class);
                android.widget.RemoteViews preview = new android.widget.RemoteViews(getContext().getPackageName(), R.layout.prayer_widget_preview_image);
                android.os.Bundle extras = new android.os.Bundle();
                extras.putParcelable(android.appwidget.AppWidgetManager.EXTRA_APPWIDGET_PREVIEW, preview);
                if (Build.VERSION.SDK_INT >= 35) {
                    manager.setWidgetPreview(provider, android.appwidget.AppWidgetProviderInfo.WIDGET_CATEGORY_HOME_SCREEN, preview);
                }
                boolean requested = supported && manager.requestPinAppWidget(provider, extras, null);
                JSObject result=new JSObject();result.put("supported",supported);result.put("requested",requested);call.resolve(result);
            }catch(Exception error){call.reject("تعذر طلب إضافة ويدجت المواقيت.",error);}
        });
    }

}
