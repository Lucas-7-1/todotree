package com.lucas.todotree;

import android.app.*;
import android.content.*;
import android.os.*;
import android.provider.Settings;
import androidx.core.app.*;
import org.json.*;

/** Legacy alarms are cancelled; foreground countdowns use monotonic time. */
public class HealthRestReceiver extends BroadcastReceiver {
  static final Object DELIVERY_LOCK = new Object();
  static String boot(Context context) { return String.valueOf(Settings.Global.getInt(context.getContentResolver(), Settings.Global.BOOT_COUNT, -1)); }
  static void cancelLegacy(Context context, String id) {
    Intent intent = new Intent(context, HealthRestReceiver.class).setAction("com.lucas.todotree.REST." + id);
    PendingIntent pending = PendingIntent.getBroadcast(context, 0, intent, PendingIntent.FLAG_NO_CREATE | PendingIntent.FLAG_IMMUTABLE);
    if (pending != null) { ((AlarmManager)context.getSystemService(Context.ALARM_SERVICE)).cancel(pending); pending.cancel(); }
  }
  static void schedule(Context context, JSONObject entry) throws Exception { HealthRestService.sync(context, entry); }
  static void deliver(Context context, String id, int version) {
    synchronized(DELIVERY_LOCK) {try (HealthStore store = new HealthStore(context)) {
      JSONObject entry = store.record(store.getReadableDatabase(), id);
      if (entry == null || entry.getInt("version") != version || !entry.isNull("deleted_at")) return;
      JSONObject body = entry.getJSONObject("body"), rest = body.optJSONObject("rest");
      if (!"rest".equals(body.optString("phase")) || rest == null || rest.optBoolean("paused")
          || !boot(context).equals(rest.optString("boot")) || rest.getLong("deadline_mono") > SystemClock.elapsedRealtime()) return;
      if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) return;
      try (IntegrationStore delivery = new IntegrationStore(context)) {
        String key = "rest:" + id + ":" + version;
        if (!delivery.claim(key, id, "rest")) return;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if(Build.VERSION.SDK_INT>=26)manager.createNotificationChannel(new NotificationChannel("workout-rest", "训练休息提醒", NotificationManager.IMPORTANCE_DEFAULT));
        Intent open = new Intent(context, MainActivity.class).putExtra("health_session", id)
          .addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent launch = PendingIntent.getActivity(context, id.hashCode(), open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        manager.notify(id, id.hashCode(), new NotificationCompat.Builder(context, "workout-rest")
          .setSmallIcon(android.R.drawable.ic_lock_idle_alarm).setContentTitle("组间休息结束")
          .setContentText("下一组已准备好，点此返回训练").setContentIntent(launch).setAutoCancel(true)
          .setVisibility(NotificationCompat.VISIBILITY_PRIVATE).build());
        delivery.receipt(key, "delivered", "休息结束提醒已提交系统");
      }
    } catch (Exception ignored) { }}
  }
  @Override public void onReceive(Context context, Intent intent) {
    if (Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction()) || intent.getStringExtra("id") == null) return;
    final PendingResult pending = goAsync();
    new Thread(() -> { try { deliver(context, intent.getStringExtra("id"), intent.getIntExtra("version", -1)); }
      finally { pending.finish(); } }, "health-rest").start();
  }
}
