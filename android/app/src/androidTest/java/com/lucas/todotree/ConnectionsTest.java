package com.lucas.todotree;

import static org.junit.Assert.*;
import android.app.*;
import android.content.*;
import android.database.*;
import android.database.sqlite.*;
import android.net.Uri;
import android.os.*;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import com.getcapacitor.JSObject;
import org.json.*;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.io.File;
import java.time.Instant;

/** Real Keystore, SQLite CAS, PendingIntent cancellation and broadcast delivery. */
@RunWith(AndroidJUnit4.class)
public class ConnectionsTest {
  private Context isolated(String prefix) {
    Context base=InstrumentationRegistry.getInstrumentation().getTargetContext();
    return new ContextWrapper(base) {
      @Override public File getDatabasePath(String name){return base.getDatabasePath(prefix+name);}
      @Override public SQLiteDatabase openOrCreateDatabase(String name,int mode,SQLiteDatabase.CursorFactory factory){return base.openOrCreateDatabase(prefix+name,mode,factory);}
      @Override public SQLiteDatabase openOrCreateDatabase(String name,int mode,SQLiteDatabase.CursorFactory factory,DatabaseErrorHandler handler){return base.openOrCreateDatabase(prefix+name,mode,factory,handler);}
      @Override public File getFilesDir(){File d=new File(base.getFilesDir(),prefix);d.mkdirs();return d;}
    };
  }
  @Test public void secretsAreEncryptedAndConnectionCASAndReceiptsSurviveReopen() throws Exception {
    Context c=isolated("connection-test-");c.getDatabasePath("integrations.db").delete();
    try(IntegrationStore s=new IntegrationStore(c)) {
      JSONObject first=s.snapshot();first.getJSONObject("secrets").put("amap_key","native-fixture-secret");first.getJSONObject("settings").put("city","贵阳");JSONObject saved=s.save(first);assertEquals(1,saved.getLong("revision"));assertEquals("native-fixture-secret",saved.getJSONObject("secrets").getString("amap_key"));
      try{s.save(first);fail("stale write accepted");}catch(IllegalStateException expected){}
      try(Cursor rows=s.getReadableDatabase().rawQuery("SELECT value FROM prefs",null)){while(rows.moveToNext())assertFalse(rows.getString(0).contains("native-fixture-secret"));}
      assertTrue(s.claim("a:v1:local","a","local"));assertFalse(s.claim("a:v1:local","a","local"));s.receipt("a:v1:local","posted","已提交");assertEquals(1,s.deliveries("a").length());
    }
    try(IntegrationStore reopened=new IntegrationStore(c)){assertEquals("贵阳",reopened.snapshot().getJSONObject("settings").getString("city"));assertEquals("native-fixture-secret",reopened.snapshot().getJSONObject("secrets").getString("amap_key"));assertFalse(reopened.claim("a:v1:local","a","local"));assertTrue(reopened.claim("a:v2:local","a","local"));}
  }
  @Test public void boundedSnoozesAndKnownRejectionRetryAreDurableAndClaimedOnce() throws Exception{
    Context c=isolated("delivery-queue-test-");c.getDatabasePath("integrations.db").delete();
    try(IntegrationStore s=new IntegrationStore(c)){
      assertEquals(1,s.snooze("a","v1",1000).getInt("sequence"));assertEquals(2,s.snooze("a","v1",2000).getInt("sequence"));assertEquals(3,s.snooze("a","v1",3000).getInt("sequence"));
      try{s.snooze("a","v1",4000);fail("must cap snooze");}catch(IllegalStateException expected){}assertEquals(3,s.snooze("a").getInt("sequence"));assertEquals(1,s.snooze("a","v2",5000).getInt("sequence"));
      assertTrue(s.claim("a:v1:feishu","a","feishu"));s.retryLater("a:v1:feishu","a","v1",1000);assertNotNull(s.retry("a"));assertTrue(s.claimRetry("a:v1:feishu"));assertFalse(s.claimRetry("a:v1:feishu"));assertNull(s.retry("a"));s.receipt("a:v1:feishu","unknown","结果未知");assertFalse(s.claimRetry("a:v1:feishu"));
    }
    try(IntegrationStore reopened=new IntegrationStore(c)){assertEquals("v2",reopened.snooze("a").getString("revision"));reopened.clearSnooze("a");assertNull(reopened.snooze("a"));}
  }
  private JSONObject reminder(String version,long when) throws Exception {return new JSONObject().put("enabled",true).put("trigger_at",Instant.ofEpochMilli(when).toString()).put("timezone","Asia/Shanghai").put("revision",version).put("exact",false).put("hide_title",true).put("channels",new JSONArray().put("local"));}
  private JSONObject task(String id,String version,long when) throws Exception {return new JSONObject().put("id",id).put("title","原生提醒测试").put("parent_id",JSONObject.NULL).put("status","open").put("deleted_at",JSONObject.NULL).put("archived_at",JSONObject.NULL).put("reminder",reminder(version,when));}
  private void commit(NativeWorkspacePlugin plugin,JSONObject row) throws Exception {
    NativeWorkspaceTest h=new NativeWorkspaceTest();JSObject current=h.read(plugin);JSObject op=new JSObject();op.put("expected_revision",current.getLong("revision"));op.put("operation_id","native-reminder-test-"+System.nanoTime());op.put("settings",current.getJSONObject("data").getJSONObject("settings"));op.put("ai_settings",current.getJSONObject("data").getJSONObject("ai_settings"));op.put("changes",new JSONArray().put(row));NativeWorkspaceTest.Call call=new NativeWorkspaceTest.Call(op);plugin.commit(call);call.await();
  }
  private JSONObject row(JSONObject task) throws Exception {return new JSONObject().put("collection","tasks").put("id",task.getString("id")).put("value",task.toString()).put("position",500);}
  private PendingIntent pending(Context c,String id) {Intent i=new Intent(c,TaskReminderReceiver.class).setAction("com.lucas.todotree.TASK_REMINDER").setData(Uri.parse("todotree://reminder/"+Uri.encode(id)));return PendingIntent.getBroadcast(c,0,i,PendingIntent.FLAG_NO_CREATE|PendingIntent.FLAG_IMMUTABLE);}
  @Test public void completedDeletedAndRemovedRulesCancelNativeAlarmAndOldVersionsAreIgnored() throws Exception {
    Context c=isolated("reminder-state-test-");c.getDatabasePath("todotree.db").delete();NativeWorkspacePlugin plugin=new NativeWorkspaceTest().plugin(c);String id="alarm-state-test";
    try {
      JSONObject t=task(id,"one",System.currentTimeMillis()+3600000);commit(plugin,row(t));assertNotNull(pending(c,id));assertTrue(TaskReminderReceiver.current(c,id,"one"));assertFalse(TaskReminderReceiver.current(c,id,"older"));
      t.put("status","done");commit(plugin,row(t));assertNull(pending(c,id));assertFalse(TaskReminderReceiver.current(c,id,"one"));
      t.put("status","open");t.put("reminder",reminder("two",System.currentTimeMillis()+3600000));commit(plugin,row(t));assertNotNull(pending(c,id));t.put("deleted_at","now");commit(plugin,row(t));assertNull(pending(c,id));
      t.put("deleted_at",JSONObject.NULL);commit(plugin,row(t));assertNotNull(pending(c,id));t.remove("reminder");commit(plugin,row(t));assertNull(pending(c,id));
      assertEquals(-1,TaskReminderReceiver.trigger(new JSONObject().put("trigger_at","not-a-time")));assertEquals(-1,TaskReminderReceiver.trigger(new JSONObject().put("trigger_at","2026-01-01T00:00:00Zgarbage")));
    } finally {TaskReminderReceiver.cancel(c,id);plugin.handleOnDestroy();}
  }
  private void broadcast(Context c,String id,String version) {c.sendBroadcast(new Intent(c,TaskReminderReceiver.class).setAction("com.lucas.todotree.TASK_REMINDER").putExtra("task_id",id).putExtra("revision",version));}
  @Test public void destinationFingerprintMatchesTheBrowserAndTimestampsKeepTheirOffset() throws Exception {
    assertEquals("41ad2322e8c7d3e7f79c4c6955a0b81e6be7840a67ba45c638afc918c128323b",TaskReminderReceiver.destination("https://open.feishu.cn/open-apis/bot/v2/hook/fixture-12345"));
    assertNotEquals(TaskReminderReceiver.destination("https://open.feishu.cn/open-apis/bot/v2/hook/fixture-12345"),TaskReminderReceiver.destination("https://open.feishu.cn/open-apis/bot/v2/hook/fixture-67890"));
    assertEquals(TaskReminderReceiver.trigger(new JSONObject().put("trigger_at","2026-09-30T01:00:00Z")),TaskReminderReceiver.trigger(new JSONObject().put("trigger_at","2026-09-30T09:00:00+08:00")));
    assertEquals(-1,TaskReminderReceiver.trigger(new JSONObject().put("trigger_at","2026-02-31T00:00:00Z")));
  }
  @Test public void realBroadcastPostsOnceAndNeverCompletesTaskOrResendsOnDuplicate() throws Exception {
    Context c=InstrumentationRegistry.getInstrumentation().getTargetContext();String id="broadcast-test-"+System.nanoTime(),version="v-"+System.nanoTime();NativeWorkspacePlugin plugin=new NativeWorkspaceTest().plugin(c);
    ParcelFileDescriptor p=InstrumentationRegistry.getInstrumentation().getUiAutomation().executeShellCommand("pm grant "+c.getPackageName()+" android.permission.POST_NOTIFICATIONS");try(ParcelFileDescriptor.AutoCloseInputStream in=new ParcelFileDescriptor.AutoCloseInputStream(p)){while(in.read()!=-1){}}
    try(IntegrationStore s=new IntegrationStore(c)) {
      JSONObject t=task(id,version,System.currentTimeMillis()-5000);commit(plugin,row(t));TaskReminderReceiver.channel(c);broadcast(c,id,version);
      long until=SystemClock.elapsedRealtime()+8000;while(s.deliveries(id).length()==0||s.deliveries(id).getJSONObject(0).optString("status").equals("attempting")){assertTrue("native delivery timed out",SystemClock.elapsedRealtime()<until);SystemClock.sleep(50);}
      assertEquals("posted",s.deliveries(id).getJSONObject(0).getString("status"));assertEquals("open",TaskReminderReceiver.readTask(c,id).getString("status"));
      broadcast(c,id,version);SystemClock.sleep(400);assertEquals(1,s.deliveries(id).length());
      t.put("status","done");commit(plugin,row(t));broadcast(c,id,version);SystemClock.sleep(300);assertEquals(1,s.deliveries(id).length());
    } finally {TaskReminderReceiver.cancel(c,id);commit(plugin,new JSONObject().put("collection","tasks").put("id",id).put("value",JSONObject.NULL));plugin.handleOnDestroy();}
  }
}
