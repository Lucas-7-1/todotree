package com.lucas.todotree;

import android.content.*;
import android.database.*;
import android.database.sqlite.*;
import android.security.keystore.*;
import android.util.Base64;
import org.json.*;
import javax.crypto.*;
import javax.crypto.spec.GCMParameterSpec;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;

/** Small connection preferences and delivery receipts, separate from business facts. */
public final class IntegrationStore extends SQLiteOpenHelper {
  private static final Object KEY_LOCK = new Object();
  public IntegrationStore(Context c) { super(c, "integrations.db", null, 1); setWriteAheadLoggingEnabled(true); }
  @Override public void onCreate(SQLiteDatabase db) {
    db.execSQL("CREATE TABLE prefs (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    db.execSQL("CREATE TABLE deliveries (delivery_key TEXT PRIMARY KEY, task_id TEXT NOT NULL, channel TEXT NOT NULL, status TEXT NOT NULL, message TEXT NOT NULL, at INTEGER NOT NULL)");
    db.execSQL("CREATE INDEX delivery_task_time ON deliveries(task_id, at DESC)");
  }
  @Override public void onUpgrade(SQLiteDatabase db,int old,int next) { throw new IllegalStateException("未定义的连接数据升级，已停止写入"); }
  private String get(SQLiteDatabase db,String key,String fallback) { try(Cursor c=db.rawQuery("SELECT value FROM prefs WHERE key=?",new String[]{key})) {return c.moveToFirst()?c.getString(0):fallback;} }
  private void put(SQLiteDatabase db,String key,String value) {ContentValues v=new ContentValues();v.put("key",key);v.put("value",value);db.insertWithOnConflict("prefs",null,v,SQLiteDatabase.CONFLICT_REPLACE);}
  private SecretKey key() throws Exception { synchronized(KEY_LOCK) {
    KeyStore ks=KeyStore.getInstance("AndroidKeyStore");ks.load(null);String alias="TodoTreeIntegrations";
    if(!ks.containsAlias(alias)) {KeyGenerator g=KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");g.init(new KeyGenParameterSpec.Builder(alias,KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT).setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());g.generateKey();}
    return (SecretKey)ks.getKey(alias,null);
  } }
  private String seal(String text) throws Exception {Cipher c=Cipher.getInstance("AES/GCM/NoPadding");c.init(Cipher.ENCRYPT_MODE,key());return Base64.encodeToString(c.getIV(),Base64.NO_WRAP)+":"+Base64.encodeToString(c.doFinal(text.getBytes(StandardCharsets.UTF_8)),Base64.NO_WRAP);}
  private String open(String text) throws Exception {if(text.isEmpty())return "{}";String[] p=text.split(":",2);if(p.length!=2)throw new IllegalStateException();Cipher c=Cipher.getInstance("AES/GCM/NoPadding");c.init(Cipher.DECRYPT_MODE,key(),new GCMParameterSpec(128,Base64.decode(p[0],Base64.NO_WRAP)));return new String(c.doFinal(Base64.decode(p[1],Base64.NO_WRAP)),StandardCharsets.UTF_8);}
  public static JSONObject defaults() throws Exception {return new JSONObject("{\"city\":\"\",\"off_enabled\":true,\"foods\":[],\"feishu_label\":\"\",\"feishu_verified\":false,\"feishu_enabled\":false}");}
  public JSONObject snapshot() throws Exception {SQLiteDatabase db=getReadableDatabase();db.beginTransactionNonExclusive();try{JSONObject result=new JSONObject();result.put("revision",Long.parseLong(get(db,"revision","0")));result.put("settings",new JSONObject(get(db,"settings",defaults().toString())));JSONObject secrets=new JSONObject(open(get(db,"secrets","")));for(String k:new String[]{"amap_key","usda_key","feishu_webhook","feishu_secret"})if(!secrets.has(k))secrets.put(k,"");result.put("secrets",secrets);db.setTransactionSuccessful();return result;}finally{db.endTransaction();}}
  public JSONObject save(JSONObject value) throws Exception {
    JSONObject settings=value.getJSONObject("settings"),secrets=value.getJSONObject("secrets");
    if(settings.getString("city").length()>100 || settings.getString("feishu_label").length()>100 || settings.getJSONArray("foods").length()>200)throw new IllegalArgumentException("连接配置过大");
    settings.getBoolean("off_enabled");settings.getBoolean("feishu_verified");settings.getBoolean("feishu_enabled");
    JSONObject allowed=new JSONObject();for(String k:new String[]{"amap_key","usda_key","feishu_webhook","feishu_secret"}) {String v=secrets.getString(k);if(v.length()>4000)throw new IllegalArgumentException("凭证格式无效");allowed.put(k,v);}
    String sealed=seal(allowed.toString());SQLiteDatabase db=getWritableDatabase();db.beginTransaction();
    try {long revision=Long.parseLong(get(db,"revision","0"));if(value.getLong("revision")!=revision)throw new IllegalStateException("连接配置已有新版本，请重新打开");put(db,"settings",settings.toString());put(db,"secrets",sealed);put(db,"revision",String.valueOf(revision+1));db.setTransactionSuccessful();}finally {db.endTransaction();}
    return snapshot();
  }
  public JSONObject resetCredentials() throws Exception {
    SQLiteDatabase db=getWritableDatabase();JSONObject prefs=new JSONObject(get(db,"settings",defaults().toString()));prefs.put("feishu_verified",false);prefs.put("feishu_enabled",false);
    synchronized(KEY_LOCK){KeyStore ks=KeyStore.getInstance("AndroidKeyStore");ks.load(null);ks.deleteEntry("TodoTreeIntegrations");}
    JSONObject secrets=new JSONObject();for(String k:new String[]{"amap_key","usda_key","feishu_webhook","feishu_secret"})secrets.put(k,"");
    JSONObject v=new JSONObject();v.put("revision",Long.parseLong(get(db,"revision","0")));v.put("settings",prefs);v.put("secrets",secrets);return save(v);
  }
  /** Claim before an external side effect. A crash becomes 'attempting', never a blind resend. */
  public boolean claim(String key,String id,String channel) {SQLiteDatabase db=getWritableDatabase();ContentValues v=new ContentValues();v.put("delivery_key",key);v.put("task_id",id);v.put("channel",channel);v.put("status","attempting");v.put("message","结果尚未确认");v.put("at",System.currentTimeMillis());return db.insertWithOnConflict("deliveries",null,v,SQLiteDatabase.CONFLICT_IGNORE)!=-1;}
  public void receipt(String key,String status,String message) {SQLiteDatabase db=getWritableDatabase();ContentValues v=new ContentValues();v.put("status",status);v.put("message",message);v.put("at",System.currentTimeMillis());db.update("deliveries",v,"delivery_key=?",new String[]{key});db.delete("deliveries","at<?",new String[]{String.valueOf(System.currentTimeMillis()-31L*86400000)});}
  public JSONArray deliveries(String id) throws Exception {JSONArray rows=new JSONArray();try(Cursor c=getReadableDatabase().rawQuery("SELECT channel,status,message,at FROM deliveries WHERE task_id=? ORDER BY at DESC LIMIT 20",new String[]{id})){while(c.moveToNext()){JSONObject r=new JSONObject();r.put("channel",c.getString(0));r.put("status",c.getString(1));r.put("message",c.getString(2));r.put("at",c.getLong(3));rows.put(r);}}return rows;}
}
