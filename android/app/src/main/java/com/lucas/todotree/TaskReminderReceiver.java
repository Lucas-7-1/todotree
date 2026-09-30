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
import java.text.*;
import java.util.*;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.security.MessageDigest;
import android.util.Base64;

/** Versioned reminders never mutate task completion or record health/journal facts. */
public class TaskReminderReceiver extends BroadcastReceiver {
  static final String CHANNEL="task-reminders", FIRE="com.lucas.todotree.TASK_REMINDER", SNOOZE="com.lucas.todotree.SNOOZE";
  private static final Timer networkDeadline=new Timer("reminder-http-deadline",true);
  static void channel(Context c){if(Build.VERSION.SDK_INT>=26)c.getSystemService(NotificationManager.class).createNotificationChannel(new NotificationChannel(CHANNEL,"待办提醒",NotificationManager.IMPORTANCE_DEFAULT));}
  static boolean active(JSONObject task){return task!=null&&"open".equals(task.optString("status"))&&task.isNull("deleted_at")&&task.isNull("archived_at");}
  static long trigger(JSONObject rule){try{String value=rule.getString("trigger_at");for(String pattern:new String[]{"yyyy-MM-dd'T'HH:mm:ss.SSSXXX","yyyy-MM-dd'T'HH:mm:ssXXX"}){SimpleDateFormat format=new SimpleDateFormat(pattern,Locale.US);format.setTimeZone(TimeZone.getTimeZone("UTC"));format.setLenient(false);ParsePosition p=new ParsePosition(0);Date d=format.parse(value,p);if(d!=null&&p.getIndex()==value.length())return d.getTime();}return -1;}catch(Exception e){return -1;}}
  static JSONObject readTask(Context c,String id)throws Exception{if(id==null||!c.getDatabasePath("todotree.db").exists())return null;try(SQLiteDatabase db=SQLiteDatabase.openDatabase(c.getDatabasePath("todotree.db").getPath(),null,SQLiteDatabase.OPEN_READONLY);Cursor rows=db.rawQuery("SELECT body FROM records WHERE collection='tasks' AND id=?",new String[]{id})){return rows.moveToFirst()?new JSONObject(rows.getString(0)):null;}}
  private static Intent intent(Context c,String id,String version,String mode){return new Intent(c,TaskReminderReceiver.class).setAction(FIRE).setData(Uri.parse("todotree://"+mode+"/"+Uri.encode(id))).putExtra("task_id",id).putExtra("revision",version).putExtra("mode",mode);}
  static PendingIntent pending(Context c,String id,String revision){return PendingIntent.getBroadcast(c,0,intent(c,id,revision,"reminder"),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);}
  private static void cancelAlarms(Context c,String id){for(String mode:new String[]{"reminder","snooze","retry"}){PendingIntent p=PendingIntent.getBroadcast(c,0,intent(c,id,"",mode),PendingIntent.FLAG_NO_CREATE|PendingIntent.FLAG_IMMUTABLE);if(p!=null){c.getSystemService(AlarmManager.class).cancel(p);p.cancel();}}}
  static void cancel(Context c,String id){cancelAlarms(c,id);NotificationManagerCompat.from(c).cancel("task:"+id,id.hashCode());try(IntegrationStore store=new IntegrationStore(c)){store.clearSnooze(id);store.clearRetry(id);}catch(Exception ignored){}}
  private static void at(Context c,Intent intent,long time,boolean exact){AlarmManager alarm=c.getSystemService(AlarmManager.class);PendingIntent p=PendingIntent.getBroadcast(c,0,intent,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);if(exact&&(Build.VERSION.SDK_INT<31||alarm.canScheduleExactAlarms()))alarm.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP,time,p);else alarm.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP,time,p);}
  static void schedule(Context c,JSONObject task)throws Exception{
    String id=task.getString("id");cancelAlarms(c,id);NotificationManagerCompat.from(c).cancel("task:"+id,id.hashCode());JSONObject rule=task.optJSONObject("reminder");
    if(!active(task)||rule==null||!rule.optBoolean("enabled")||rule.optString("revision").isEmpty()){cancel(c,id);return;}
    String version=rule.getString("revision");long due=trigger(rule),now=System.currentTimeMillis();if(due>now)at(c,intent(c,id,version,"reminder"),due,rule.optBoolean("exact"));
    try(IntegrationStore store=new IntegrationStore(c)){
      JSONObject snooze=store.snooze(id);if(snooze!=null){if(!version.equals(snooze.getString("revision")))store.clearSnooze(id);else if(snooze.getLong("due")>now)at(c,intent(c,id,version,"snooze").putExtra("sequence",snooze.getInt("sequence")),snooze.getLong("due"),rule.optBoolean("exact"));}
      JSONObject retry=store.retry(id);if(retry!=null){if(!version.equals(retry.getString("revision")))store.clearRetry(id);else at(c,intent(c,id,version,"retry"),Math.max(now+1000,retry.getLong("due")),false);}
    }
  }
  static void reconcile(Context c)throws Exception{
    if(!c.getDatabasePath("todotree.db").exists())return;TaskReminderQueue.drain(c);int missed=0;
    try(SQLiteDatabase db=SQLiteDatabase.openDatabase(c.getDatabasePath("todotree.db").getPath(),null,SQLiteDatabase.OPEN_READONLY);Cursor rows=db.rawQuery("SELECT body FROM records WHERE collection='tasks' AND body LIKE '%\"reminder\"%'",null);IntegrationStore store=new IntegrationStore(c)){
      while(rows.moveToNext()){
        JSONObject task=new JSONObject(rows.getString(0));schedule(c,task);JSONObject rule=task.optJSONObject("reminder");
        if(active(task)&&rule!=null&&rule.optBoolean("enabled")&&trigger(rule)>0&&System.currentTimeMillis()-trigger(rule)>300000){
          JSONArray channels=rule.optJSONArray("channels");boolean fresh=false;
          if(channels!=null)for(int i=0;i<channels.length();i++){String target=channels.getString(i),key=task.getString("id")+":"+rule.optString("revision")+":"+target;if(store.claim(key,task.getString("id"),target)){store.receipt(key,"missed","原定提醒时刻已错过，请核对任务；不会集中补发");fresh=true;}}
          if(fresh)missed++;
        }
      }
      if(missed>0&&store.missedSummaryDue())missedNotification(c,missed);
    }
  }
  private static void missedNotification(Context c,int count){channel(c);if(!NotificationManagerCompat.from(c).areNotificationsEnabled())return;Intent open=new Intent(c,MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP|Intent.FLAG_ACTIVITY_SINGLE_TOP);PendingIntent tap=PendingIntent.getActivity(c,7302,open,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);NotificationManagerCompat.from(c).notify("missed",7302,new NotificationCompat.Builder(c,CHANNEL).setSmallIcon(android.R.drawable.ic_lock_idle_alarm).setContentTitle("有待办提醒错过原定时刻").setContentText(count+" 条提醒需核对，点此查看待办").setContentIntent(tap).setAutoCancel(true).build());}
  static boolean current(Context c,String id,String version)throws Exception{JSONObject task=readTask(c,id),rule=task==null?null:task.optJSONObject("reminder");return active(task)&&rule!=null&&rule.optBoolean("enabled")&&version.equals(rule.optString("revision"));}
  static void notifyTask(Context c,String id,String title,boolean hidden){notifyTask(c,id,title,hidden,"");}
  static void notifyTask(Context c,String id,String title,boolean hidden,String version){
    channel(c);Intent open=new Intent(c,MainActivity.class).setAction("com.lucas.todotree.OPEN_TASK").setData(Uri.parse("todotree://task/"+Uri.encode(id))).putExtra("task_id",id).addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP|Intent.FLAG_ACTIVITY_SINGLE_TOP);
    if("test".equals(id)){open.removeExtra("task_id");open.setData(null);}
    PendingIntent tap=PendingIntent.getActivity(c,0,open,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
    NotificationCompat.Builder builder=new NotificationCompat.Builder(c,CHANNEL).setSmallIcon(android.R.drawable.ic_lock_idle_alarm).setContentTitle(hidden?"TodoTree 待办提醒":title).setContentText("点此查看待办，完成需要在应用内确认").setContentIntent(tap).setAutoCancel(true).setVisibility(NotificationCompat.VISIBILITY_PRIVATE);
    int sequence=0;try(IntegrationStore store=new IntegrationStore(c)){JSONObject previous=store.snooze(id);if(previous!=null&&version.equals(previous.optString("revision")))sequence=previous.optInt("sequence");}catch(Exception ignored){}
    if(!version.isEmpty()&&sequence<3){Intent later=new Intent(c,TaskReminderReceiver.class).setAction(SNOOZE).setData(Uri.parse("todotree://snooze-action/"+Uri.encode(id)+"/"+sequence)).putExtra("task_id",id).putExtra("revision",version).putExtra("sequence",sequence);PendingIntent snooze=PendingIntent.getBroadcast(c,0,later,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);builder.addAction(android.R.drawable.ic_lock_idle_alarm,"5 分钟后提醒",snooze);}
    NotificationManagerCompat.from(c).notify("task:"+id,id.hashCode(),builder.build());
  }
  static boolean webhook(String raw){try{URI u=new URI(raw);return "https".equals(u.getScheme())&&"open.feishu.cn".equals(u.getHost())&&u.getUserInfo()==null&&u.getPort()==-1&&u.getQuery()==null&&u.getFragment()==null&&u.getPath().matches("/open-apis/bot/v2/hook/[a-zA-Z0-9-]{8,200}");}catch(Exception e){return false;}}
  static String signature(String secret,String timestamp)throws Exception{Mac h=Mac.getInstance("HmacSHA256");h.init(new SecretKeySpec((timestamp+"\n"+secret).getBytes(StandardCharsets.UTF_8),"HmacSHA256"));return Base64.encodeToString(h.doFinal(new byte[0]),Base64.NO_WRAP);}
  static String destination(String hook)throws Exception{byte[] hash=MessageDigest.getInstance("SHA-256").digest(hook.getBytes(StandardCharsets.UTF_8));StringBuilder out=new StringBuilder();for(byte b:hash)out.append(String.format(Locale.US,"%02x",b&255));return out.toString();}
  private String path(Context c,JSONObject task)throws Exception{List<String> names=new ArrayList<>();Set<String> seen=new HashSet<>();String parent=task.optString("parent_id");while(!parent.isEmpty()&&!"null".equals(parent)&&seen.add(parent)&&names.size()<20){JSONObject p=readTask(c,parent);if(p==null)break;names.add(p.optString("title"));parent=p.optString("parent_id");}Collections.reverse(names);StringBuilder text=new StringBuilder();for(String name:names){if(text.length()>0)text.append(" / ");text.append(name);}return text.toString();}
  private void sendFeishu(Context c,IntegrationStore store,JSONObject task,String version,String key,boolean retry)throws Exception{
    JSONObject config=store.snapshot(),prefs=config.getJSONObject("settings"),secrets=config.getJSONObject("secrets");String hook=secrets.optString("feishu_webhook");
    if(!prefs.optBoolean("feishu_enabled")||!prefs.optBoolean("feishu_verified")||prefs.optString("feishu_label").trim().isEmpty()||!webhook(hook)||!destination(hook).equals(task.getJSONObject("reminder").optString("feishu_destination"))){store.receipt(key,"disabled","飞书渠道未验证、未开启或目的地已变更");return;}
    if(!current(c,task.getString("id"),version)){store.receipt(key,"cancelled","任务已完成、删除或改期");return;}
    String text="TodoTree 待办提醒\n"+task.getString("title")+"\n项目："+path(c,task)+"\n提醒："+task.getJSONObject("reminder").optString("trigger_at")+"\n打开待办：todotree://task/"+Uri.encode(task.getString("id"));
    JSONObject payload=new JSONObject().put("msg_type","text").put("content",new JSONObject().put("text",text.substring(0,Math.min(4000,text.length()))));String secret=secrets.optString("feishu_secret");if(!secret.isEmpty()){String ts=String.valueOf(System.currentTimeMillis()/1000);payload.put("timestamp",ts).put("sign",signature(secret,ts));}
    HttpURLConnection connection=(HttpURLConnection)new URL(hook).openConnection();connection.setInstanceFollowRedirects(false);connection.setConnectTimeout(3000);connection.setReadTimeout(4000);connection.setRequestMethod("POST");connection.setDoOutput(true);connection.setRequestProperty("Content-Type","application/json");
    TimerTask timeout=new TimerTask(){public void run(){connection.disconnect();}};networkDeadline.schedule(timeout,8000);
    boolean sent=false;
    try{
      byte[] bytes=payload.toString().getBytes(StandardCharsets.UTF_8);connection.setFixedLengthStreamingMode(bytes.length);connection.connect();sent=true;try(OutputStream out=connection.getOutputStream()){out.write(bytes);}int status=connection.getResponseCode();
      if(!retry&&(status==429||status==503)){long delay=60000;try{delay=Math.max(30000,Math.min(300000,Long.parseLong(connection.getHeaderField("Retry-After"))*1000));}catch(Exception ignored){}long due=System.currentTimeMillis()+delay;store.retryLater(key,task.getString("id"),version,due);at(c,intent(c,task.getString("id"),version,"retry"),due,false);return;}
      if(status<200||status>=300){store.receipt(key,"rejected","飞书返回 HTTP "+status+"，发送已停止");return;}
      ByteArrayOutputStream response=new ByteArrayOutputStream();try(InputStream in=connection.getInputStream()){byte[] b=new byte[2048];int n;while((n=in.read(b))!=-1){if(response.size()+n>65536)throw new IOException();response.write(b,0,n);}}
      JSONObject reply=new JSONObject(response.toString("UTF-8"));int code=reply.has("code")?reply.getInt("code"):reply.optInt("StatusCode",-1);store.receipt(key,code==0?"accepted":"rejected",code==0?"飞书接口已接受，不代表用户已阅读":"机器人拒绝请求，请核对安全设置");
    }catch(Exception error){store.receipt(key,sent?"unknown":"failed",sent?"发送结果未确认，可能送达；不会自动重发":"请求未发送，请检查连接");}finally{timeout.cancel();networkDeadline.purge();connection.disconnect();}
  }
  @Override public void onReceive(Context c,Intent incoming){
    final PendingResult pending=goAsync();new Thread(()->{try{
      if(!FIRE.equals(incoming.getAction())&&!SNOOZE.equals(incoming.getAction())){reconcile(c);return;}
      String id=incoming.getStringExtra("task_id"),version=incoming.getStringExtra("revision");if(version==null||!current(c,id,version))return;JSONObject task=readTask(c,id),rule=task.getJSONObject("reminder");
      try(IntegrationStore store=new IntegrationStore(c)){
        if(SNOOZE.equals(incoming.getAction())){JSONObject next=store.snooze(id,version,System.currentTimeMillis()+300000,incoming.getIntExtra("sequence",0));at(c,intent(c,id,version,"snooze").putExtra("sequence",next.getInt("sequence")),next.getLong("due"),rule.optBoolean("exact"));NotificationManagerCompat.from(c).cancel("task:"+id,id.hashCode());return;}
        String mode=incoming.getStringExtra("mode");boolean retry="retry".equals(mode),snoozed="snooze".equals(mode);String suffix="";long due=trigger(rule);
        if(snoozed){JSONObject saved=store.snooze(id);if(saved==null||!version.equals(saved.optString("revision"))||saved.optInt("sequence")!=incoming.getIntExtra("sequence",-1))return;due=saved.getLong("due");suffix=":snooze:"+saved.getInt("sequence");}
        if(retry){JSONObject saved=store.retry(id);if(saved==null||!version.equals(saved.optString("revision")))return;due=saved.getLong("due");}
        if(due>System.currentTimeMillis()){schedule(c,task);return;}if(due<0)return;
        JSONArray channels=retry?new JSONArray().put("feishu"):snoozed?new JSONArray().put("local"):rule.getJSONArray("channels");
        for(int i=0;i<channels.length();i++){
          String target=channels.getString(i),key=id+":"+version+":"+target+suffix;
          if(retry?!store.claimRetry(key):!store.claim(key,id,target))continue;
          if(!current(c,id,version)){store.receipt(key,"cancelled","任务已完成、删除或改期");continue;}
          if(System.currentTimeMillis()-due>300000){store.receipt(key,"missed","提醒已错过原定时刻，未集中补发");if(store.missedSummaryDue())missedNotification(c,1);continue;}
          if("local".equals(target)){channel(c);NotificationChannel ch=Build.VERSION.SDK_INT>=26?c.getSystemService(NotificationManager.class).getNotificationChannel(CHANNEL):null;if(!NotificationManagerCompat.from(c).areNotificationsEnabled()||(ch!=null&&ch.getImportance()==NotificationManager.IMPORTANCE_NONE)){store.receipt(key,"blocked","通知权限或渠道被关闭");continue;}try{notifyTask(c,id,task.getString("title"),rule.optBoolean("hide_title",true),version);store.receipt(key,"posted","已提交系统通知，不代表用户已阅读");}catch(SecurityException error){store.receipt(key,"blocked","系统未允许通知");}}
          else if("feishu".equals(target)){try{sendFeishu(c,store,task,version,key,retry);}catch(Exception error){store.receipt(key,"failed","连接配置不可读，请核对凭证");}}
        }
      }
    }catch(Exception ignored){}finally{pending.finish();}},"task-reminder").start();
  }
}
