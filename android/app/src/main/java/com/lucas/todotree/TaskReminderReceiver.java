package com.lucas.todotree;

import android.app.*;
import android.content.*;
import android.database.*;
import android.database.sqlite.*;
import android.net.Uri;
import android.os.*;
import androidx.core.app.*;
import org.json.*;
import java.net.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.text.ParsePosition;
import java.util.Locale;
import java.util.TimeZone;
import java.util.Date;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.security.MessageDigest;
import android.util.Base64;

/** Native alarm delivery is isolated from the task completion state machine. */
public class TaskReminderReceiver extends BroadcastReceiver {
  static final String CHANNEL="task-reminders";
  static void channel(Context c) {NotificationManager m=(NotificationManager)c.getSystemService(Context.NOTIFICATION_SERVICE);if(Build.VERSION.SDK_INT>=26)m.createNotificationChannel(new NotificationChannel(CHANNEL,"待办提醒",NotificationManager.IMPORTANCE_DEFAULT));}
  static boolean active(JSONObject task) {return task!=null&&"open".equals(task.optString("status"))&&task.isNull("deleted_at")&&task.isNull("archived_at");}
  static long trigger(JSONObject r) {try{String value=r.getString("trigger_at");for(String pattern:new String[]{"yyyy-MM-dd'T'HH:mm:ss.SSSXXX","yyyy-MM-dd'T'HH:mm:ssXXX"}){SimpleDateFormat f=new SimpleDateFormat(pattern,Locale.US);f.setTimeZone(TimeZone.getTimeZone("UTC"));f.setLenient(false);ParsePosition position=new ParsePosition(0);Date d=f.parse(value,position);if(d!=null&&position.getIndex()==value.length())return d.getTime();}return -1;}catch(Exception e){return -1;}}
  static JSONObject readTask(Context c,String id) throws Exception {if(id==null||!c.getDatabasePath("todotree.db").exists())return null;try(SQLiteDatabase db=SQLiteDatabase.openDatabase(c.getDatabasePath("todotree.db").getPath(),null,SQLiteDatabase.OPEN_READONLY);Cursor rows=db.rawQuery("SELECT body FROM records WHERE collection='tasks' AND id=?",new String[]{id})){return rows.moveToFirst()?new JSONObject(rows.getString(0)):null;}}
  static PendingIntent pending(Context c,String id,String revision) {Intent i=new Intent(c,TaskReminderReceiver.class).setAction("com.lucas.todotree.TASK_REMINDER").setData(Uri.parse("todotree://reminder/"+Uri.encode(id))).putExtra("task_id",id).putExtra("revision",revision);return PendingIntent.getBroadcast(c,0,i,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);}
  static void cancel(Context c,String id) {AlarmManager a=(AlarmManager)c.getSystemService(Context.ALARM_SERVICE);PendingIntent p=pending(c,id,"");a.cancel(p);p.cancel();NotificationManagerCompat.from(c).cancel("task:"+id,id.hashCode());}
  static void schedule(Context c,JSONObject task) throws Exception {
    String id=task.getString("id");cancel(c,id);JSONObject r=task.optJSONObject("reminder");if(!active(task)||r==null||!r.optBoolean("enabled"))return;
    long at=trigger(r);if(at<=System.currentTimeMillis())return;
    String revision=r.optString("revision");if(revision.isEmpty())return;
    AlarmManager a=(AlarmManager)c.getSystemService(Context.ALARM_SERVICE);PendingIntent p=pending(c,id,revision);
    if(r.optBoolean("exact")&&(Build.VERSION.SDK_INT<31||a.canScheduleExactAlarms()))a.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP,at,p);
    else a.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP,at,p);
  }
  static void reconcile(Context c) throws Exception {if(!c.getDatabasePath("todotree.db").exists())return;try(SQLiteDatabase db=SQLiteDatabase.openDatabase(c.getDatabasePath("todotree.db").getPath(),null,SQLiteDatabase.OPEN_READONLY);Cursor rows=db.rawQuery("SELECT body FROM records WHERE collection='tasks' AND body LIKE '%\"reminder\"%'",null)){while(rows.moveToNext())schedule(c,new JSONObject(rows.getString(0)));}}
  static boolean current(Context c,String id,String version) throws Exception {JSONObject t=readTask(c,id);JSONObject r=t==null?null:t.optJSONObject("reminder");return active(t)&&r!=null&&r.optBoolean("enabled")&&version.equals(r.optString("revision"));}
  static void notifyTask(Context c,String id,String title,boolean hidden) {
    channel(c);Intent open=new Intent(c,MainActivity.class).setAction("com.lucas.todotree.OPEN_TASK").setData(Uri.parse("todotree://task/"+Uri.encode(id))).putExtra("task_id",id).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP|Intent.FLAG_ACTIVITY_SINGLE_TOP);
    PendingIntent tap=PendingIntent.getActivity(c,0,open,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
    Notification n=new NotificationCompat.Builder(c,CHANNEL).setSmallIcon(android.R.drawable.ic_lock_idle_alarm).setContentTitle(hidden?"TodoTree 待办提醒":title).setContentText("点此查看待办，完成需要在应用内确认").setContentIntent(tap).setAutoCancel(true).setVisibility(NotificationCompat.VISIBILITY_PRIVATE).build();
    NotificationManagerCompat.from(c).notify("task:"+id,id.hashCode(),n);
  }
  static boolean webhook(String raw) {try{URI u=new URI(raw);return "https".equals(u.getScheme())&&"open.feishu.cn".equals(u.getHost())&&u.getUserInfo()==null&&u.getPort()==-1&&u.getQuery()==null&&u.getFragment()==null&&u.getPath().matches("/open-apis/bot/v2/hook/[a-zA-Z0-9-]{8,200}");}catch(Exception e){return false;}}
  static String signature(String secret,String timestamp) throws Exception {Mac h=Mac.getInstance("HmacSHA256");h.init(new SecretKeySpec((timestamp+"\n"+secret).getBytes(StandardCharsets.UTF_8),"HmacSHA256"));return Base64.encodeToString(h.doFinal(new byte[0]),Base64.NO_WRAP);}
  static String destination(String hook) throws Exception {byte[] hash=MessageDigest.getInstance("SHA-256").digest(hook.getBytes(StandardCharsets.UTF_8));StringBuilder out=new StringBuilder();for(byte b:hash)out.append(String.format(Locale.US,"%02x",b&255));return out.toString();}
  private void sendFeishu(Context c,IntegrationStore store,JSONObject task,JSONObject config,String version,String key) throws Exception {
    JSONObject prefs=config.getJSONObject("settings"),secrets=config.getJSONObject("secrets");String hook=secrets.optString("feishu_webhook");
    if(!prefs.optBoolean("feishu_enabled")||!prefs.optBoolean("feishu_verified")||prefs.optString("feishu_label").trim().isEmpty()||!webhook(hook)){store.receipt(key,"disabled","飞书渠道未验证或未开启");return;}
    if(!destination(hook).equals(task.getJSONObject("reminder").optString("feishu_destination"))){store.receipt(key,"disabled","飞书目的地已变更，请重新保存这条提醒");return;}
    String id=task.getString("id");if(!current(c,id,version)){store.receipt(key,"cancelled","任务已完成、删除或改期");return;}
    JSONObject payload=new JSONObject();payload.put("msg_type","text");JSONObject text=new JSONObject();text.put("text","TodoTree 待办提醒\n"+task.getString("title")+"\n请在 TodoTree 中查看并确认完成。");payload.put("content",text);
    String secret=secrets.optString("feishu_secret");if(!secret.isEmpty()){String ts=String.valueOf(System.currentTimeMillis()/1000);payload.put("timestamp",ts);payload.put("sign",signature(secret,ts));}
    HttpURLConnection connection=(HttpURLConnection)new URL(hook).openConnection();connection.setInstanceFollowRedirects(false);connection.setConnectTimeout(3000);connection.setReadTimeout(4000);connection.setRequestMethod("POST");connection.setDoOutput(true);connection.setRequestProperty("Content-Type","application/json");
    boolean sent=false;
    try {byte[] body=payload.toString().getBytes(StandardCharsets.UTF_8);connection.setFixedLengthStreamingMode(body.length);sent=true;try(OutputStream out=connection.getOutputStream()){out.write(body);}int status=connection.getResponseCode();
      if(status<200||status>=300){store.receipt(key,"rejected","飞书返回 HTTP "+status+"，未自动重试");return;}
      ByteArrayOutputStream bytes=new ByteArrayOutputStream();try(InputStream in=connection.getInputStream()){byte[] b=new byte[2048];int n;while((n=in.read(b))!=-1){if(bytes.size()+n>64*1024)throw new IOException();bytes.write(b,0,n);}}
      JSONObject reply=new JSONObject(bytes.toString("UTF-8"));int code=reply.has("code")?reply.getInt("code"):reply.optInt("StatusCode",-1);store.receipt(key,code==0?"accepted":"rejected",code==0?"飞书接口已接受，不代表用户已阅读":"机器人拒绝请求，请核对安全设置");
    }catch(Exception e){store.receipt(key,sent?"unknown":"failed",sent?"发送结果未确认，可能送达；不会自动重发":"请求未发送，请检查连接");}finally{connection.disconnect();}
  }
  @Override public void onReceive(Context c,Intent intent) {
    final PendingResult pending=goAsync();new Thread(()->{try {
      if(!"com.lucas.todotree.TASK_REMINDER".equals(intent.getAction())){reconcile(c);return;}
      String id=intent.getStringExtra("task_id"),version=intent.getStringExtra("revision");if(version==null||!current(c,id,version))return;
      JSONObject task=readTask(c,id),r=task.getJSONObject("reminder");long at=trigger(r),now=System.currentTimeMillis();if(at>now){schedule(c,task);return;}if(at<0||now-at>86400000L)return; // No stale burst after downtime.
      JSONArray channels=r.getJSONArray("channels");try(IntegrationStore store=new IntegrationStore(c)) {
        for(int i=0;i<channels.length();i++){String target=channels.getString(i),key=id+":"+version+":"+target;if(!store.claim(key,id,target))continue;
          if(!current(c,id,version)){store.receipt(key,"cancelled","任务已完成、删除或改期");continue;}
          if(target.equals("local")){channel(c);NotificationChannel ch=Build.VERSION.SDK_INT>=26?((NotificationManager)c.getSystemService(Context.NOTIFICATION_SERVICE)).getNotificationChannel(CHANNEL):null;
            if(!NotificationManagerCompat.from(c).areNotificationsEnabled()||(ch!=null&&ch.getImportance()==NotificationManager.IMPORTANCE_NONE)){store.receipt(key,"blocked","通知权限或渠道被关闭");continue;}
            try{notifyTask(c,id,task.getString("title"),r.optBoolean("hide_title",true));store.receipt(key,"posted","已提交系统通知，不代表用户已阅读");}catch(SecurityException e){store.receipt(key,"blocked","系统未允许通知");}
          }else if(target.equals("feishu")){try{sendFeishu(c,store,task,store.snapshot(),version,key);}catch(Exception e){store.receipt(key,"failed","连接配置不可读，请重新核对凭证");}}
        }
      }
    }catch(Exception ignored){}finally{pending.finish();}},"task-reminder").start();
  }
}
