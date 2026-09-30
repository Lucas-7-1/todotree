package com.lucas.todotree;

import android.Manifest;
import android.app.*;
import android.content.*;
import android.net.Uri;
import android.os.*;
import android.provider.*;
import androidx.core.app.NotificationManagerCompat;
import com.getcapacitor.*;
import com.getcapacitor.annotation.*;
import java.util.concurrent.*;
import org.json.*;

@CapacitorPlugin(name="Health",permissions={@Permission(alias="notifications",strings={Manifest.permission.POST_NOTIFICATIONS})})
public class HealthPlugin extends Plugin {
  private HealthStore store;private final ExecutorService disk=Executors.newSingleThreadExecutor();
  @Override public void load(){store=new HealthStore(getContext());}
  @Override protected void handleOnResume(){disk.execute(()->{try(android.database.Cursor rows=store.getReadableDatabase().rawQuery("SELECT body FROM records WHERE kind='session'",null)){while(rows.moveToNext()){JSONObject entry=new JSONObject(rows.getString(0));if(HealthRestService.eligible(getContext(),entry,SystemClock.elapsedRealtime()))HealthRestService.sync(getContext(),entry);}}catch(Exception ignored){}});}
  @PluginMethod public void read(PluginCall c){disk.execute(()->{try{c.resolve(new JSObject(store.snapshot().toString()));}catch(Exception e){c.reject("健康读取失败，原数据未覆盖："+e.getMessage());}});}
  @PluginMethod public void commit(PluginCall c){disk.execute(()->{try{
    JSONObject ack; synchronized(HealthRestReceiver.DELIVERY_LOCK) {ack=store.commit(c.getData());
    // A reminder failure must not misreport a committed training fact as unsaved.
    try{JSONArray changes=c.getData().getJSONArray("changes");for(int i=0;i<changes.length();i++){JSONObject e=changes.getJSONObject(i);if(e.getString("kind").equals("session"))HealthRestReceiver.schedule(getContext(),e);}}
    catch(Exception reminder){ack.put("reminder_error","记录已保存，系统休息提醒未设置成功");}}
    c.resolve(new JSObject(ack.toString()));
  }catch(Exception e){c.reject("健康保存未确认："+e.getMessage());}});}
  @PluginMethod public void takeLaunchSession(PluginCall c){Intent intent=getActivity().getIntent();String id=intent==null?null:intent.getStringExtra("health_session");if(intent!=null)intent.removeExtra("health_session");JSObject result=new JSObject();result.put("session_id",id==null?JSONObject.NULL:id);c.resolve(result);}
  @Override protected void handleOnNewIntent(Intent intent){String id=intent.getStringExtra("health_session");if(id!=null){JSObject result=new JSObject();result.put("session_id",id);notifyListeners("openSession",result,true);intent.removeExtra("health_session");}}
  @Override protected void handleOnDestroy(){disk.shutdown();super.handleOnDestroy();}
  @PluginMethod public void clock(PluginCall c){JSObject o=new JSObject();o.put("wall",System.currentTimeMillis());o.put("mono",SystemClock.elapsedRealtime());o.put("boot",HealthRestReceiver.boot(getContext()));c.resolve(o);}
  private JSObject status(){JSObject o=new JSObject();o.put("granted",NotificationManagerCompat.from(getContext()).areNotificationsEnabled());AlarmManager a=(AlarmManager)getContext().getSystemService(Context.ALARM_SERVICE);o.put("exact",Build.VERSION.SDK_INT<31||a.canScheduleExactAlarms());o.put("countdown",HealthRestService.running());NotificationChannel ch=getContext().getSystemService(NotificationManager.class).getNotificationChannel("workout-rest");o.put("rest_channel",ch==null||ch.getImportance()!=NotificationManager.IMPORTANCE_NONE);return o;}
  @PluginMethod public void notificationStatus(PluginCall c){c.resolve(status());}
  @PluginMethod public void requestNotifications(PluginCall c){if(Build.VERSION.SDK_INT>=33&&getPermissionState("notifications")!=PermissionState.GRANTED)requestPermissionForAlias("notifications",c,"permissionResult");else c.resolve(status());}
  @PermissionCallback private void permissionResult(PluginCall c){c.resolve(status());}
  @PluginMethod public void exactSettings(PluginCall c){try{if(Build.VERSION.SDK_INT>=31)getActivity().startActivity(new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM,Uri.parse("package:"+getContext().getPackageName())));c.resolve();}catch(Exception e){c.reject("无法打开准时提醒设置");}}
  @PluginMethod public void openTimer(PluginCall c){try{Intent i=new Intent(AlarmClock.ACTION_SET_TIMER).putExtra(AlarmClock.EXTRA_LENGTH,Math.max(1,c.getInt("seconds",60))).putExtra(AlarmClock.EXTRA_MESSAGE,"TodoTree 组间休息").putExtra(AlarmClock.EXTRA_SKIP_UI,false);getActivity().startActivity(i);c.resolve();}catch(Exception e){c.reject("没有可用的系统计时器，可使用应用内计时");}}
}
