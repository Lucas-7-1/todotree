package com.lucas.todotree;

import android.Manifest;
import android.app.*;
import android.content.*;
import android.net.Uri;
import android.os.Build;
import android.provider.*;
import androidx.core.app.NotificationManagerCompat;
import com.getcapacitor.*;
import com.getcapacitor.annotation.*;
import org.json.*;
import java.util.UUID;
import java.util.concurrent.*;

@CapacitorPlugin(name="Connections", permissions={@Permission(alias="notifications", strings={Manifest.permission.POST_NOTIFICATIONS})})
public class ConnectionsPlugin extends Plugin {
  private IntegrationStore store;
  private final ExecutorService disk=Executors.newSingleThreadExecutor();
  private String queuedText,queuedShare,queuedTask;
  @Override public void load() {store=new IntegrationStore(getContext());capture(getActivity().getIntent(),false);disk.execute(()->{try{TaskReminderReceiver.reconcile(getContext());}catch(Exception ignored){}});}
  private void capture(Intent i,boolean emit) {
    if(i==null)return;
    if(Intent.ACTION_SEND.equals(i.getAction())&&"text/plain".equals(i.getType())) {
      CharSequence text=i.getCharSequenceExtra(Intent.EXTRA_TEXT);if(text!=null&&!text.toString().trim().isEmpty()) {queuedText=text.toString().substring(0,Math.min(8000,text.length()));queuedShare=UUID.randomUUID().toString();i.removeExtra(Intent.EXTRA_TEXT);
        if(emit&&hasListeners("sharedText")){JSObject r=new JSObject();r.put("text",queuedText);r.put("share_id",queuedShare);notifyListeners("sharedText",r);queuedText=null;queuedShare=null;}
      }
    }
    String id=i.getStringExtra("task_id");if(id!=null&&!id.isEmpty()) {queuedTask=id;i.removeExtra("task_id");if(emit&&hasListeners("openTask")){JSObject r=new JSObject();r.put("task_id",id);notifyListeners("openTask",r);queuedTask=null;}}
  }
  @Override protected void handleOnNewIntent(Intent i) {capture(i,true);}
  @PluginMethod public void takeSharedText(PluginCall c) {JSObject r=new JSObject();r.put("text",queuedText==null?JSONObject.NULL:queuedText);r.put("share_id",queuedShare==null?JSONObject.NULL:queuedShare);queuedText=null;queuedShare=null;c.resolve(r);}
  @PluginMethod public void takeTask(PluginCall c) {JSObject r=new JSObject();r.put("task_id",queuedTask==null?JSONObject.NULL:queuedTask);queuedTask=null;c.resolve(r);}
  @PluginMethod public void read(PluginCall c) {disk.execute(()->{try{c.resolve(new JSObject(store.snapshot().toString()));}catch(Exception e){c.reject("连接配置无法解密或读取，未覆盖原数据，请检查本机凭证");}});}
  @PluginMethod public void save(PluginCall c) {disk.execute(()->{try{c.resolve(new JSObject(store.save(c.getData()).toString()));}catch(Exception e){c.reject("连接保存失败，未覆盖原配置："+e.getClass().getSimpleName());}});}
  @PluginMethod public void resetCredentials(PluginCall c) {disk.execute(()->{try{c.resolve(new JSObject(store.resetCredentials().toString()));}catch(Exception e){c.reject("连接凭证重置失败，任务与个人标签未清空");}});}
  @PluginMethod public void taskDelivery(PluginCall c) {disk.execute(()->{try{JSObject r=new JSObject();r.put("rows",store.deliveries(c.getString("task_id","")));c.resolve(r);}catch(Exception e){c.reject("提醒记录读取失败");}});}
  @PluginMethod public void share(PluginCall c) {try{String text=c.getString("text","");if(text.trim().isEmpty()||text.length()>8000)throw new IllegalArgumentException();Intent i=new Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT,text);getActivity().startActivity(Intent.createChooser(i,c.getString("title","分享待办")));c.resolve();}catch(Exception e){c.reject("没有可用的系统分享入口");}}
  @PluginMethod public void openCalendar(PluginCall c) {try{long start=c.getData().getLong("start"),end=c.getData().getLong("end");if(start<=0||end<=start)throw new IllegalArgumentException();Intent i=new Intent(Intent.ACTION_INSERT).setData(CalendarContract.Events.CONTENT_URI).putExtra(CalendarContract.Events.TITLE,c.getString("title","")).putExtra(CalendarContract.EXTRA_EVENT_BEGIN_TIME,start).putExtra(CalendarContract.EXTRA_EVENT_END_TIME,end);getActivity().startActivity(i);c.resolve();}catch(Exception e){c.reject("没有可用的日历应用，待办仍保存在 TodoTree");}}
  private JSObject status() {TaskReminderReceiver.channel(getContext());JSObject r=new JSObject();r.put("granted",NotificationManagerCompat.from(getContext()).areNotificationsEnabled());AlarmManager a=(AlarmManager)getContext().getSystemService(Context.ALARM_SERVICE);r.put("exact",Build.VERSION.SDK_INT<31||a.canScheduleExactAlarms());NotificationChannel ch=Build.VERSION.SDK_INT>=26?((NotificationManager)getContext().getSystemService(Context.NOTIFICATION_SERVICE)).getNotificationChannel(TaskReminderReceiver.CHANNEL):null;r.put("task_channel",ch==null||ch.getImportance()!=NotificationManager.IMPORTANCE_NONE);return r;}
  @PluginMethod public void notificationStatus(PluginCall c) {c.resolve(status());}
  @PluginMethod public void requestNotifications(PluginCall c) {if(Build.VERSION.SDK_INT>=33&&getPermissionState("notifications")!=PermissionState.GRANTED)requestPermissionForAlias("notifications",c,"permissionsResult");else c.resolve(status());}
  @PermissionCallback private void permissionsResult(PluginCall c) {c.resolve(status());}
  @PluginMethod public void exactSettings(PluginCall c) {try{if(Build.VERSION.SDK_INT>=31)getActivity().startActivity(new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM,Uri.parse("package:"+getContext().getPackageName())));c.resolve();}catch(Exception e){c.reject("无法打开准时提醒设置");}}
  @PluginMethod public void testNotification(PluginCall c) {try{JSObject s=status();if(!s.getBoolean("granted")||!s.getBoolean("task_channel")){c.reject("通知或渠道未开启，请先开启再测试");return;}TaskReminderReceiver.notifyTask(getContext(),"test","TodoTree 通知测试",false);c.resolve();}catch(Exception e){c.reject("测试通知未能提交");}}
  @Override protected void handleOnDestroy() {disk.execute(()->store.close());disk.shutdown();super.handleOnDestroy();}
}
