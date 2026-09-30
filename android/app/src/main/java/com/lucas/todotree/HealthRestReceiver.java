package com.lucas.todotree;

import android.app.*;
import android.content.*;
import android.database.Cursor;
import android.os.*;
import android.provider.Settings;
import androidx.core.app.*;
import org.json.*;

/** One versioned native alarm; receiving it never starts or completes a set. */
public class HealthRestReceiver extends BroadcastReceiver {
  static String boot(Context context){return String.valueOf(Settings.Global.getInt(context.getContentResolver(),Settings.Global.BOOT_COUNT,-1));}
  static void schedule(Context context,JSONObject entry) throws Exception {
    String id=entry.getString("id");Intent intent=new Intent(context,HealthRestReceiver.class).setAction("com.lucas.todotree.REST."+id).putExtra("id",id).putExtra("version",entry.getInt("version"));
    PendingIntent pending=PendingIntent.getBroadcast(context,0,intent,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
    AlarmManager alarm=(AlarmManager)context.getSystemService(Context.ALARM_SERVICE);alarm.cancel(pending);NotificationManagerCompat.from(context).cancel(id,id.hashCode());
    JSONObject s=entry.getJSONObject("body"),r=s.optJSONObject("rest");
    if(!entry.isNull("deleted_at")||!s.optString("phase").equals("rest")||r==null||r.optBoolean("paused")||!r.optString("boot").equals(boot(context)))return;
    long deadline=r.getLong("deadline_mono");if(deadline<=SystemClock.elapsedRealtime())return;
    if(Build.VERSION.SDK_INT<31||alarm.canScheduleExactAlarms())alarm.setExactAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP,deadline,pending);
    else alarm.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP,deadline,pending);
  }
  @Override public void onReceive(Context context,Intent intent) {
    final PendingResult pending=goAsync();new Thread(()->{try(HealthStore store=new HealthStore(context)) {
      if(Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())||"android.app.action.SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED".equals(intent.getAction())) {
        try(Cursor c=store.getReadableDatabase().rawQuery("SELECT body FROM records WHERE kind='session'",null)){while(c.moveToNext())schedule(context,new JSONObject(c.getString(0)));}return;
      }
      String id=intent.getStringExtra("id");JSONObject entry=store.record(store.getReadableDatabase(),id);if(entry==null||entry.getInt("version")!=intent.getIntExtra("version",-1)||!entry.isNull("deleted_at"))return;
      JSONObject s=entry.getJSONObject("body"),r=s.optJSONObject("rest");if(!s.optString("phase").equals("rest")||r==null||r.optBoolean("paused")||!r.optString("boot").equals(boot(context))||r.getLong("deadline_mono")>SystemClock.elapsedRealtime())return;
      if(!NotificationManagerCompat.from(context).areNotificationsEnabled())return;
      String key=id+":"+entry.getInt("version");SharedPreferences prefs=context.getSharedPreferences("health-delivery",Context.MODE_PRIVATE);if(prefs.getBoolean(key,false))return;
      NotificationManager manager=(NotificationManager)context.getSystemService(Context.NOTIFICATION_SERVICE);
      if(Build.VERSION.SDK_INT>=26)manager.createNotificationChannel(new NotificationChannel("workout-rest","训练休息提醒",NotificationManager.IMPORTANCE_DEFAULT));
      Intent open=new Intent(context,MainActivity.class).putExtra("health_session",id).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP|Intent.FLAG_ACTIVITY_SINGLE_TOP);
      PendingIntent launch=PendingIntent.getActivity(context,id.hashCode(),open,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
      Notification notification=new NotificationCompat.Builder(context,"workout-rest").setSmallIcon(android.R.drawable.ic_lock_idle_alarm).setContentTitle("组间休息结束").setContentText("下一组已准备好，点此返回训练").setContentIntent(launch).setAutoCancel(true).setVisibility(NotificationCompat.VISIBILITY_PRIVATE).build();
      manager.notify(id,id.hashCode(),notification);prefs.edit().putBoolean(key,true).commit();
    }catch(Exception ignored){}finally{pending.finish();}},"health-rest").start();
  }
}
