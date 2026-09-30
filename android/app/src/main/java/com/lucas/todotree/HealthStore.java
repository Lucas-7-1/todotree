package com.lucas.todotree;

import android.content.*;
import android.database.*;
import android.database.sqlite.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import org.json.*;

/** Dedicated durable facts; revisions and the exact operation ack commit together. */
final class HealthStore extends SQLiteOpenHelper {
  private final Context context;
  HealthStore(Context context) { super(context,"health.db",null,1);this.context=context;setWriteAheadLoggingEnabled(true); }
  @Override public void onCreate(SQLiteDatabase db) {
    db.execSQL("CREATE TABLE records(id TEXT PRIMARY KEY,kind TEXT NOT NULL,day TEXT NOT NULL,version INTEGER NOT NULL,body TEXT NOT NULL)");
    db.execSQL("CREATE INDEX health_kind_day ON records(kind,day,id)");
    db.execSQL("CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT NOT NULL)");
    db.execSQL("CREATE TABLE operations(id TEXT PRIMARY KEY,ack TEXT NOT NULL)");
  }
  @Override public void onUpgrade(SQLiteDatabase db,int old,int next) {throw new IllegalStateException("健康升级版本未知，原数据保留");}
  private String meta(SQLiteDatabase db,String key,String fallback) {try(Cursor c=db.rawQuery("SELECT value FROM meta WHERE key=?",new String[]{key})){return c.moveToFirst()?c.getString(0):fallback;}}
  private void putMeta(SQLiteDatabase db,String key,String value) {ContentValues v=new ContentValues();v.put("key",key);v.put("value",value);if(db.insertWithOnConflict("meta",null,v,SQLiteDatabase.CONFLICT_REPLACE)<0)throw new SQLiteException("健康元数据写入失败");}
  JSONObject record(SQLiteDatabase db,String id) throws Exception {try(Cursor c=db.rawQuery("SELECT body FROM records WHERE id=?",new String[]{id})){return c.moveToFirst()?new JSONObject(c.getString(0)):null;}}
  JSONObject snapshot() throws Exception {return snapshot(getReadableDatabase());}
  private JSONObject snapshot(SQLiteDatabase db) throws Exception {
    JSONArray records=new JSONArray();try(Cursor c=db.rawQuery("SELECT body FROM records ORDER BY id",null)){while(c.moveToNext())records.put(new JSONObject(c.getString(0)));}
    return new JSONObject().put("schema_version",1).put("revision",Long.parseLong(meta(db,"revision","0"))).put("operation_id",meta(db,"operation_id","init")).put("saved_at",meta(db,"saved_at","")).put("records",records);
  }
  private void checkpoint(SQLiteDatabase db) throws Exception {
    String day=JournalStore.now().substring(0,10);if(meta(db,"checkpoint_day","").equals(day))return;
    File dir=new File(context.getFilesDir(),"health-backups");if(!dir.isDirectory()&&!dir.mkdirs())throw new IOException("无法创建健康恢复点");
    File tmp=new File(dir,day+".part"),target=new File(dir,day+".json");
    try(FileOutputStream out=new FileOutputStream(tmp)){out.write(snapshot(db).toString().getBytes(StandardCharsets.UTF_8));out.getFD().sync();}
    if(!tmp.renameTo(target))throw new IOException("健康恢复点未保存");
    File[] files=dir.listFiles((d,n)->n.endsWith(".json"));if(files!=null){Arrays.sort(files,Comparator.comparing(File::getName));for(int i=0;i<files.length-14;i++)if(!files[i].delete())break;}
    putMeta(db,"checkpoint_day",day);
  }
  JSONObject commit(JSONObject input) throws Exception {
    SQLiteDatabase db=getWritableDatabase();db.beginTransaction();
    try {
      String id=input.getString("operation_id");
      try(Cursor c=db.rawQuery("SELECT ack FROM operations WHERE id=?",new String[]{id})){if(c.moveToFirst()){JSONObject ack=new JSONObject(c.getString(0));db.setTransactionSuccessful();return ack;}}
      long revision=Long.parseLong(meta(db,"revision","0"));if(input.getLong("expected_revision")!=revision)throw new Exception("健康数据版本冲突，请重新打开核对");
      checkpoint(db);
      JSONArray changes=input.getJSONArray("changes");Set<String> seen=new HashSet<>();
      for(int i=0;i<changes.length();i++) {
        JSONObject e=changes.getJSONObject(i);String eid=e.getString("id");JSONObject old=record(db,eid);
        if(!seen.add(eid)||e.getInt("version")!=(old==null?1:old.getInt("version")+1))throw new Exception("健康记录重复或版本冲突");
        if(!Arrays.asList("weight","sleep","intake","template","plan","occurrence","session","outbox","draft").contains(e.getString("kind"))||!e.getString("day").matches("\\d{4}-\\d{2}-\\d{2}"))throw new Exception("健康记录格式无效");
        e.getJSONObject("body");
        if(old!=null&&!old.getString("created_at").equals(e.getString("created_at")))throw new Exception("原始输入时间不能改写");
        ContentValues v=new ContentValues();v.put("id",eid);v.put("kind",e.getString("kind"));v.put("day",e.getString("day"));v.put("version",e.getInt("version"));v.put("body",e.toString());if(db.insertWithOnConflict("records",null,v,SQLiteDatabase.CONFLICT_REPLACE)<0)throw new SQLiteException("健康记录写入失败");
      }
      JSONObject ack=new JSONObject().put("revision",revision+1).put("operation_id",id).put("saved_at",JournalStore.now());
      putMeta(db,"revision",String.valueOf(revision+1));putMeta(db,"operation_id",id);putMeta(db,"saved_at",ack.getString("saved_at"));
      ContentValues op=new ContentValues();op.put("id",id);op.put("ack",ack.toString());db.insertOrThrow("operations",null,op);db.setTransactionSuccessful();return ack;
    } finally {db.endTransaction();}
  }
}
