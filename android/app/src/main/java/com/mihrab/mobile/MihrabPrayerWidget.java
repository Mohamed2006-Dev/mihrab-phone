package com.mihrab.mobile;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.SystemClock;
import android.view.View;
import android.widget.RemoteViews;
import org.json.JSONArray;
import org.json.JSONObject;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;

/** Native home-screen view. No WebView, GPS polling, network or per-second service. */
public class MihrabPrayerWidget extends AppWidgetProvider {
    private static final String REFRESH="com.mihrab.mobile.WIDGET_REFRESH";
    private static PendingIntent refreshIntent(Context context){
        return PendingIntent.getBroadcast(context,65500,new Intent(context,MihrabPrayerWidget.class).setAction(REFRESH),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
    }
    @Override public void onUpdate(Context context,AppWidgetManager manager,int[] ids){refreshAll(context);}
    @Override public void onEnabled(Context context){refreshAll(context);}
    @Override public void onDisabled(Context context){((AlarmManager)context.getSystemService(Context.ALARM_SERVICE)).cancel(refreshIntent(context));}
    @Override public void onReceive(Context context,Intent intent){
        super.onReceive(context,intent);
        String action=intent.getAction();
        if(REFRESH.equals(action)||Intent.ACTION_BOOT_COMPLETED.equals(action)||Intent.ACTION_TIME_CHANGED.equals(action)||Intent.ACTION_TIMEZONE_CHANGED.equals(action)||Intent.ACTION_MY_PACKAGE_REPLACED.equals(action))refreshAll(context);
    }
    public static boolean refreshAll(Context context){
        AppWidgetManager manager=AppWidgetManager.getInstance(context);
        int[] ids=manager.getAppWidgetIds(new ComponentName(context,MihrabPrayerWidget.class));
        if(ids.length==0)return true;
        try{
            JSONObject data=new JSONObject(context.getSharedPreferences("mihrab_widget",Context.MODE_PRIVATE).getString("schedule","{}"));
            JSONArray prayers=data.optJSONArray("prayers");
            long now=System.currentTimeMillis();
            long grace=Math.max(0,Math.min(1200000,data.optLong("graceMs",1200000)));
            long[] times=new long[prayers==null?0:prayers.length()];
            for(int i=0;i<times.length;i++)times[i]=prayers.getJSONObject(i).optLong("at");
            WidgetPrayerState state=WidgetPrayerState.select(now,times,grace);
            JSONObject next=state.index<0?null:prayers.getJSONObject(state.index);
            long nextAt=state.index<0?0:times[state.index];boolean elapsed=state.elapsed;
            RemoteViews view=new RemoteViews(context.getPackageName(),R.layout.prayer_widget);
            view.setTextViewText(R.id.widget_city,data.optString("city","محراب"));
            String prayerName=next==null?"":next.optString("name").trim();
            view.setTextViewText(R.id.widget_prayer,next==null?"افتح محراب لتحديث المواقيت":WidgetPrayerState.title(prayerName));
            view.setViewVisibility(R.id.widget_countdown,next==null?View.GONE:View.VISIBLE);
            view.setViewVisibility(R.id.widget_remaining,next==null?View.GONE:View.VISIBLE);
            SimpleDateFormat time=new SimpleDateFormat("HH:mm",Locale.US);time.setTimeZone(TimeZone.getTimeZone(data.optString("timeZone","UTC")));
            // Use the same wall-clock label as the app, including its timezone corrections.
            String clock = next == null ? "—" : next.optString("time24", "");
            if (next != null && !clock.matches("(?:[01][0-9]|2[0-3]):[0-5][0-9]")) {
                clock = time.format(new Date(nextAt)); // Schedules cached before the update.
            }
            view.setTextViewText(R.id.widget_time, clock);
            if(next!=null){
                view.setTextViewText(R.id.widget_remaining,elapsed?"مضى على الأذان  ":"الوقت المتبقي  ");
                view.setBoolean(R.id.widget_countdown,"setCountDown",!elapsed);
                view.setChronometer(R.id.widget_countdown,SystemClock.elapsedRealtime()+nextAt-now,elapsed?"+%s":"%s",true);
            }
            Intent open=new Intent(context,MainActivity.class).setData(android.net.Uri.parse("mihrab://prayers")).setFlags(Intent.FLAG_ACTIVITY_NEW_TASK|Intent.FLAG_ACTIVITY_CLEAR_TOP);
            view.setOnClickPendingIntent(R.id.widget_root,PendingIntent.getActivity(context,65501,open,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE));
            manager.updateAppWidget(ids,view);
            AlarmManager alarm=(AlarmManager)context.getSystemService(Context.ALARM_SERVICE);
            alarm.cancel(refreshIntent(context));
            if(next!=null){
                long trigger=SystemClock.elapsedRealtime()+Math.max(1000,state.changeAt-now+1000);
                if(Build.VERSION.SDK_INT<31||alarm.canScheduleExactAlarms())alarm.setExact(AlarmManager.ELAPSED_REALTIME,trigger,refreshIntent(context));
                else alarm.set(AlarmManager.ELAPSED_REALTIME,trigger,refreshIntent(context));
            }
            return true;
        }catch(Exception error){android.util.Log.e("MihrabWidget","Could not render prayer widget",error);return false;}
    }
}
