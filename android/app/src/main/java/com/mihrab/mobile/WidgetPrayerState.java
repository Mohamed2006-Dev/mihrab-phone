package com.mihrab.mobile;

/** Pure selection contract matching src/ui/prayer-display.js. */
public final class WidgetPrayerState {
 public final int index;public final boolean elapsed;public final long changeAt;
 private WidgetPrayerState(int index,boolean elapsed,long changeAt){this.index=index;this.elapsed=elapsed;this.changeAt=changeAt;}
 public static WidgetPrayerState select(long now,long[] times,long grace){
  int recent=-1,future=-1;long recentAt=0,futureAt=Long.MAX_VALUE;
  for(int i=0;i<times.length;i++){
   long at=times[i];if(at<=0)continue;
   if(at<=now&&now-at<grace&&at>recentAt){recent=i;recentAt=at;}
   if(at>now&&at<futureAt){future=i;futureAt=at;}
  }
  return recent>=0?new WidgetPrayerState(recent,true,recentAt+grace):new WidgetPrayerState(future,false,futureAt);
 }
 public static String title(String name){String value=name==null?"":name.trim();return value.startsWith("صلاة ")?value:"صلاة "+value;}
}
