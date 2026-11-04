package com.mihrab.mobile;

import android.app.ActivityManager;
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

@CapacitorPlugin(name="MihrabDevice")
public class MihrabDevicePlugin extends Plugin {
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
    @PluginMethod public void getStorageStats(PluginCall call){
        try{
            android.content.pm.ApplicationInfo info=getContext().getApplicationInfo();
            long application=new java.io.File(info.sourceDir).length();
            if(info.splitSourceDirs!=null)for(String split:info.splitSourceDirs)application+=new java.io.File(split).length();
            java.io.File root=getContext().getDataDir();String canonical=root.getCanonicalPath();long all=0;
            java.io.File[] children=root.listFiles();if(children!=null)for(java.io.File child:children)all+=bytes(child,canonical);
            long cache=bytes(getContext().getCacheDir(),canonical)+bytes(getContext().getCodeCacheDir(),canonical);
            if(info.nativeLibraryDir!=null){java.io.File lib=new java.io.File(info.nativeLibraryDir);String base=lib.getCanonicalPath();java.io.File[] libs=lib.listFiles();if(libs!=null)for(java.io.File f:libs)application+=bytes(f,base);}
            JSObject disk=new JSObject();disk.put("application",application);disk.put("data",Math.max(0,all-cache));disk.put("profile",cache);disk.put("total",application+all);
            JSObject result=new JSObject();result.put("disk",disk);result.put("memory",android.os.Debug.getPss()*1024L);call.resolve(result);
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
                boolean requested=supported&&manager.requestPinAppWidget(new android.content.ComponentName(getContext(),MihrabPrayerWidget.class),null,null);
                JSObject result=new JSObject();result.put("supported",supported);result.put("requested",requested);call.resolve(result);
            }catch(Exception error){call.reject("تعذر طلب إضافة ويدجت المواقيت.",error);}
        });
    }

}
