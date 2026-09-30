package com.lucas.todotree;

import android.app.*;
import android.content.*;
import android.database.Cursor;
import android.os.*;
import androidx.core.app.*;
import androidx.core.content.ContextCompat;
import java.util.*;
import java.util.concurrent.*;
import org.json.*;

/** Active only during user-started rest. No polling or training fact writes. */
public class HealthRestService extends Service {
  static final String CHANNEL = "workout-countdown";
  private static volatile HealthRestService live;
  private final Handler main = new Handler(Looper.getMainLooper());
  private final ExecutorService disk = Executors.newSingleThreadExecutor();
  private final Map<String, JSONObject> rests = new HashMap<>();
  private PowerManager.WakeLock wake;
  private boolean destroyed;

  static boolean eligible(Context context, JSONObject entry, long now) {
    if (entry == null || !entry.isNull("deleted_at")) return false;
    JSONObject body = entry.optJSONObject("body"), rest = body == null ? null : body.optJSONObject("rest");
    long deadline = rest == null ? 0 : rest.optLong("deadline_mono");
    return body != null && "rest".equals(body.optString("phase")) && rest != null
      && !rest.optBoolean("paused") && HealthRestReceiver.boot(context).equals(rest.optString("boot"))
      && deadline > now && deadline - now <= 3_600_000;
  }
  static void sync(Context context, JSONObject entry) throws Exception {
    HealthRestReceiver.cancelLegacy(context, entry.getString("id"));
    NotificationManagerCompat.from(context).cancel(entry.getString("id"), entry.getString("id").hashCode());
    if (eligible(context, entry, SystemClock.elapsedRealtime())) {
      ContextCompat.startForegroundService(context, new Intent(context, HealthRestService.class).putExtra("id", entry.getString("id")));
    } else {
      HealthRestService service = live;
      if (service != null) service.main.post(() -> service.refresh(entry.optString("id")));
    }
  }
  static void stopDiagnostic(Context context){HealthRestService service=live;if(service!=null)service.main.post(()->{service.rests.entrySet().removeIf(entry->entry.getValue().optBoolean("diagnostic"));service.arm();});try(IntegrationStore store=new IntegrationStore(context)){store.cancelDiagnostic();}catch(Exception ignored){}}
  private void diagnostic(Intent intent){
    try(IntegrationStore store=new IntegrationStore(this)){
      int seconds=Math.max(1,Math.min(120,intent.getIntExtra("test_seconds",30)));String id="rest-test-"+UUID.randomUUID();long due=SystemClock.elapsedRealtime()+seconds*1000L;
      JSONObject state=new JSONObject().put("id",id).put("state","running").put("seconds",seconds).put("started_at",System.currentTimeMillis()).put("boot",HealthRestReceiver.boot(this)).put("deadline",due);store.saveDiagnostic(state);
      rests.entrySet().removeIf(entry->entry.getValue().optBoolean("diagnostic"));rests.put(id,testEntry(state));arm();
    }catch(Exception error){stop();}
  }
  private JSONObject testEntry(JSONObject state)throws Exception{return new JSONObject().put("id",state.getString("id")).put("version",1).put("deleted_at",JSONObject.NULL).put("diagnostic",true).put("body",new JSONObject().put("phase","rest").put("rest",new JSONObject().put("paused",false).put("boot",state.getString("boot")).put("deadline_mono",state.getLong("deadline"))));}
  private void deliverDiagnostic(JSONObject entry){
    try(IntegrationStore store=new IntegrationStore(this)){
      JSONObject state=store.claimDiagnostic(entry.optString("id"));if(state==null)return;
      NotificationManager manager=getSystemService(NotificationManager.class);if(Build.VERSION.SDK_INT>=26)manager.createNotificationChannel(new NotificationChannel("workout-rest","训练休息提醒",NotificationManager.IMPORTANCE_DEFAULT));
      if(!NotificationManagerCompat.from(this).areNotificationsEnabled()||(Build.VERSION.SDK_INT>=26&&manager.getNotificationChannel("workout-rest").getImportance()==NotificationManager.IMPORTANCE_NONE)){state.put("state","blocked");store.saveDiagnostic(state);return;}
      PendingIntent open=PendingIntent.getActivity(this,7303,new Intent(this,MainActivity.class),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
      manager.notify("rest-test",7303,new NotificationCompat.Builder(this,"workout-rest").setSmallIcon(android.R.drawable.ic_lock_idle_alarm).setContentTitle("锁屏休息计时测试结束").setContentText("请打开连接设置，确认是否听到或看到提醒").setContentIntent(open).setAutoCancel(true).build());
      state.put("state","posted").put("fired_at",System.currentTimeMillis());store.saveDiagnostic(state);
    }catch(Exception ignored){}
  }
  static boolean running() { return live != null; }
  @Override public void onCreate() {
    super.onCreate(); live = this;
    if(Build.VERSION.SDK_INT>=26)getSystemService(NotificationManager.class).createNotificationChannel(new NotificationChannel(CHANNEL, "训练休息倒计时", NotificationManager.IMPORTANCE_LOW));
    wake = ((PowerManager)getSystemService(POWER_SERVICE)).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, getPackageName() + ":rest");
    wake.setReferenceCounted(false);
  }
  @Override public int onStartCommand(Intent intent, int flags, int startId) {
    startForeground(7301, notification(null));
    if(intent!=null&&intent.hasExtra("test_seconds"))diagnostic(intent);else refresh(intent == null ? null : intent.getStringExtra("id"));
    return START_STICKY;
  }
  private void refresh(String id) {
    if (destroyed) return;
    disk.execute(() -> {
      Map<String, JSONObject> loaded = new HashMap<>(); boolean ok = true;
      try (HealthStore store = new HealthStore(this)) {
        if (id != null) {
          JSONObject entry = store.record(store.getReadableDatabase(), id);
          if (eligible(this, entry, SystemClock.elapsedRealtime())) loaded.put(id, entry);
        } else {
          try (Cursor c = store.getReadableDatabase().rawQuery("SELECT body FROM records WHERE kind='session'", null)) {
            while (c.moveToNext()) {
              JSONObject entry = new JSONObject(c.getString(0));
              if (eligible(this, entry, SystemClock.elapsedRealtime())) loaded.put(entry.getString("id"), entry);
            }
          }
        }
        if(id==null)try(IntegrationStore delivery=new IntegrationStore(this)){JSONObject test=delivery.diagnostic();if(test!=null&&"running".equals(test.optString("state"))&&HealthRestReceiver.boot(this).equals(test.optString("boot"))){if(test.getLong("deadline")>SystemClock.elapsedRealtime())loaded.put(test.getString("id"),testEntry(test));else deliverDiagnostic(testEntry(test));}}
      } catch (Exception error) { ok = false; }
      final boolean readable = ok;
      main.post(() -> {
        if (destroyed) return;
        if (!readable) { stop(); return; }
        if (id == null) rests.clear(); else rests.remove(id);
        rests.putAll(loaded); arm();
      });
    });
  }
  private final Runnable expire = () -> {
    long now = SystemClock.elapsedRealtime(); List<JSONObject> due = new ArrayList<>();
    Iterator<JSONObject> iterator = rests.values().iterator();
    while (iterator.hasNext()) {
      JSONObject entry = iterator.next();
      if (entry.optJSONObject("body").optJSONObject("rest").optLong("deadline_mono") <= now) { due.add(entry); iterator.remove(); }
    }
    if (!due.isEmpty()) disk.execute(() -> {
      for (JSONObject entry : due) {if(entry.optBoolean("diagnostic"))deliverDiagnostic(entry);else HealthRestReceiver.deliver(this, entry.optString("id"), entry.optInt("version"));}
      main.post(()->{if(!destroyed)arm();});
    });
    if(due.isEmpty()||!rests.isEmpty())arm();
  };
  private void arm() {
    main.removeCallbacks(expire);
    if (rests.isEmpty()) { stop(); return; }
    JSONObject next = null; long deadline = Long.MAX_VALUE, last = 0;
    for (JSONObject entry : rests.values()) {
      long end = entry.optJSONObject("body").optJSONObject("rest").optLong("deadline_mono");
      if (end < deadline) { deadline = end; next = entry; } last = Math.max(last, end);
    }
    if (wake.isHeld()) wake.release();
    wake.acquire(Math.max(1, Math.min(3_660_000, last - SystemClock.elapsedRealtime() + 60_000)));
    startForeground(7301, notification(next));
    main.postDelayed(expire, Math.max(1, deadline - SystemClock.elapsedRealtime()));
  }
  private Notification notification(JSONObject entry) {
    String id = entry == null ? "" : entry.optString("id");
    Intent open = new Intent(this, MainActivity.class).putExtra("health_session", id).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
    PendingIntent launch = PendingIntent.getActivity(this, 7301, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL).setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
      .setContentTitle("训练休息计时").setContentText("点此返回，可暂停、延长或结束休息").setContentIntent(launch)
      .setOngoing(true).setOnlyAlertOnce(true).setVisibility(NotificationCompat.VISIBILITY_PRIVATE);
    if (entry != null) {
      long remaining = entry.optJSONObject("body").optJSONObject("rest").optLong("deadline_mono") - SystemClock.elapsedRealtime();
      builder.setWhen(System.currentTimeMillis() + Math.max(0, remaining)).setUsesChronometer(true).setChronometerCountDown(true);
    }
    return builder.build();
  }
  private void stop() {
    main.removeCallbacks(expire); if (wake != null && wake.isHeld()) wake.release();
    stopForeground(STOP_FOREGROUND_REMOVE); stopSelf();
  }
  @Override public void onDestroy() {
    destroyed = true; if (live == this) live = null; main.removeCallbacksAndMessages(null);
    if (wake != null && wake.isHeld()) wake.release(); disk.shutdown(); super.onDestroy();
  }
  @Override public IBinder onBind(Intent intent) { return null; }
}
