package com.lucas.todotree;

import android.app.Activity;
import android.content.ContentValues;
import android.content.Intent;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.*;
import com.getcapacitor.annotation.*;
import org.json.*;
import javax.crypto.*;
import javax.crypto.spec.GCMParameterSpec;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.text.SimpleDateFormat;
import java.util.*;
import java.util.concurrent.*;

/** All local state changes run on one worker and commit atomically, outside the UI thread. */
@CapacitorPlugin(name = "NativeWorkspace")
public class NativeWorkspacePlugin extends Plugin {
    private final ExecutorService disk = Executors.newSingleThreadExecutor();
    private final ExecutorService network = Executors.newFixedThreadPool(2);
    private final Map<String, Request> requests = new ConcurrentHashMap<>();
    private SQLiteOpenHelper helper;
    private static final Set<String> COLLECTIONS = new HashSet<>(Arrays.asList("tasks", "events", "reports", "attempts"));
    private static final int LIMIT = 32 * 1024 * 1024;
    private static class Request { volatile boolean cancelled; volatile HttpURLConnection connection; }
    @Override public void load() {
        helper = new SQLiteOpenHelper(getContext(), "todotree.db", null, 1) {
            @Override public void onCreate(SQLiteDatabase db) {
                db.execSQL("CREATE TABLE records (collection TEXT NOT NULL, id TEXT NOT NULL, body TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(collection,id))");
                db.execSQL("CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
            }
            @Override public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {
                throw new IllegalStateException("未定义的数据升级，已停止写入");
            }
        };
        helper.setWriteAheadLoggingEnabled(true);
    }
    private String get(SQLiteDatabase db, String key, String fallback) {
        try (Cursor c = db.query("meta", new String[]{"value"}, "key=?", new String[]{key}, null,null,null)) {
            return c.moveToFirst() ? c.getString(0) : fallback;
        }
    }
    private void put(SQLiteDatabase db, String key, String value) {
        ContentValues v = new ContentValues(); v.put("key",key); v.put("value",value);
        db.insertWithOnConflict("meta",null,v,SQLiteDatabase.CONFLICT_REPLACE);
    }
    private String now() { SimpleDateFormat f = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",Locale.US); f.setTimeZone(TimeZone.getTimeZone("UTC")); return f.format(new Date()); }
    private javax.crypto.SecretKey key() throws Exception {
        KeyStore ks = KeyStore.getInstance("AndroidKeyStore"); ks.load(null);
        if (!ks.containsAlias("TodoTreeAI")) {
            KeyGenerator g = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore");
            g.init(new KeyGenParameterSpec.Builder("TodoTreeAI",KeyProperties.PURPOSE_ENCRYPT|KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build()); g.generateKey();
        }
        return (javax.crypto.SecretKey) ks.getKey("TodoTreeAI", null);
    }
    private String encrypt(String text) throws Exception {
        if (text.isEmpty()) return "";
        Cipher c = Cipher.getInstance("AES/GCM/NoPadding"); c.init(Cipher.ENCRYPT_MODE,key());
        return Base64.encodeToString(c.getIV(),Base64.NO_WRAP)+":"+Base64.encodeToString(c.doFinal(text.getBytes(StandardCharsets.UTF_8)),Base64.NO_WRAP);
    }
    private String decrypt(String text) throws Exception {
        if (text.isEmpty()) return "";
        String[] parts=text.split(":",2); Cipher c=Cipher.getInstance("AES/GCM/NoPadding");
        c.init(Cipher.DECRYPT_MODE,key(),new GCMParameterSpec(128,Base64.decode(parts[0],Base64.NO_WRAP)));
        return new String(c.doFinal(Base64.decode(parts[1],Base64.NO_WRAP)),StandardCharsets.UTF_8);
    }
    private JSObject ack(SQLiteDatabase db) throws Exception {
        JSObject o=new JSObject(); o.put("revision",Long.parseLong(get(db,"revision","0")));
        o.put("operation_id",get(db,"operation_id","android-init")); o.put("saved_at",get(db,"saved_at",now())); return o;
    }
    private JSObject snapshot(SQLiteDatabase db, boolean includeKey) throws Exception {
        JSObject o=ack(db); o.put("schema_version",2); JSONObject data=new JSONObject();
        for (String collection: COLLECTIONS) {
            JSONArray rows=new JSONArray();
            try (Cursor c=db.query("records",new String[]{"body"},"collection=?",new String[]{collection},null,null,"position ASC, id ASC")) {
                while(c.moveToNext()) rows.put(new JSONObject(c.getString(0)));
            }
            data.put(collection,rows);
        }
        data.put("settings",new JSONObject(get(db,"settings","{}")));
        JSONObject ai=new JSONObject(get(db,"ai_settings","{}"));
        if(includeKey) {
            try { ai.put("api_key",decrypt(get(db,"api_key",""))); }
            catch(Exception e) { ai.put("api_key", ""); ai.put("key_reentry_required",true); }
        }
        data.put("ai_settings",ai); o.put("data",data); return o;
    }
    @Override protected void handleOnDestroy() {
        for(Request r:requests.values()) { r.cancelled=true; if(r.connection!=null) r.connection.disconnect(); }
        network.shutdownNow(); disk.execute(() -> helper.close()); disk.shutdown();
    }
    @PluginMethod public void read(PluginCall call) {
        disk.execute(() -> { try { call.resolve(snapshot(helper.getReadableDatabase(),true)); }
            catch(Exception e) { call.reject("读取本地数据库失败，未清空数据", "READ_FAILED"); } });
    }
    private void backup(SQLiteDatabase db, boolean checkpoint) throws Exception {
        File dir=new File(getContext().getFilesDir(),"backups"); if(!dir.exists() && !dir.mkdirs()) throw new IOException();
        String day=new SimpleDateFormat("yyyy-MM-dd",Locale.US).format(new Date());
        File out=new File(dir, checkpoint ? "checkpoint-"+System.currentTimeMillis()+".json" : "daily-"+day+".json");
        if(out.exists()) return;
        File temp=new File(dir,out.getName()+".tmp");
        try(FileOutputStream stream=new FileOutputStream(temp)) { stream.write(snapshot(db,false).toString().getBytes(StandardCharsets.UTF_8)); stream.getFD().sync(); }
        if(!temp.renameTo(out)) throw new IOException();
        File[] files=dir.listFiles((d,n)->n.endsWith(".json"));
        if(files!=null) { Arrays.sort(files,Comparator.comparingLong(File::lastModified).reversed()); for(int i=14;i<files.length;i++) files[i].delete(); }
    }
    @PluginMethod public void commit(PluginCall call) {
        disk.execute(() -> {
            SQLiteDatabase db=null;
            try {
                db=helper.getWritableDatabase(); String op=call.getString("operation_id");
                if(op==null || op.isEmpty()) throw new Exception("缺少操作编号");
                if(op.equals(get(db,"operation_id",""))) { call.resolve(ack(db)); return; }
                long revision=Long.parseLong(get(db,"revision","0"));
                if(call.getData().getLong("expected_revision")!=revision) throw new Exception("数据版本冲突，请重新打开应用");
                backup(db,call.getBoolean("checkpoint",false));
                JSONArray changes=call.getArray("changes"); if(changes==null) throw new Exception("缺少变更数据");
                JSONObject ai=new JSONObject(call.getObject("ai_settings",new JSObject()).toString());
                String secret=ai.optString("api_key",""); ai.remove("api_key");
                String sealed=encrypt(secret);
                db.beginTransaction();
                for(int i=0;i<changes.length();i++) {
                    JSONObject row=changes.getJSONObject(i); String collection=row.getString("collection"),id=row.getString("id");
                    if(!COLLECTIONS.contains(collection) || id.isEmpty()) throw new Exception("非法记录类型");
                    if(row.isNull("value")) db.delete("records","collection=? AND id=?",new String[]{collection,id});
                    else { String body=row.getString("value"); new JSONObject(body);
                        ContentValues v=new ContentValues();v.put("collection",collection);v.put("id",id);v.put("body",body);v.put("position",row.optInt("position",i));
                        db.insertWithOnConflict("records",null,v,SQLiteDatabase.CONFLICT_REPLACE);
                    }
                }
                put(db,"settings",call.getObject("settings",new JSObject()).toString()); put(db,"ai_settings",ai.toString()); put(db,"api_key",sealed);
                put(db,"revision",String.valueOf(revision+1)); put(db,"operation_id",op); put(db,"saved_at",now());
                db.setTransactionSuccessful(); db.endTransaction(); call.resolve(ack(db));
            } catch(Exception e) {
                if(db!=null && db.inTransaction()) db.endTransaction();
                call.reject("保存失败，未确认完成："+e.getClass().getSimpleName(),"WRITE_FAILED");
            }
        });
    }
    @PluginMethod public void exportFile(PluginCall call) {
        Intent intent=new Intent(Intent.ACTION_CREATE_DOCUMENT); intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(call.getString("mimeType","application/json")); intent.putExtra(Intent.EXTRA_TITLE,call.getString("filename","TodoTree-Backup.json"));
        startActivityForResult(call,intent,"exportResult");
    }
    @ActivityCallback private void exportResult(PluginCall call, ActivityResult result) {
        if(call==null) return;
        if(result.getResultCode()!=Activity.RESULT_OK || result.getData()==null) { JSObject o=new JSObject();o.put("cancelled",true);call.resolve(o);return; }
        disk.execute(() -> { try(OutputStream stream=getContext().getContentResolver().openOutputStream(result.getData().getData(),"wt")) {
            if(stream==null) throw new IOException(); stream.write(call.getString("content","").getBytes(StandardCharsets.UTF_8)); call.resolve();
        } catch(Exception e) { call.reject("备份导出失败，请选择可写入的位置"); } });
    }
    @PluginMethod public void http(PluginCall call) {
        String id=call.getString("id",""); Request request=new Request();
        if(id.isEmpty() || requests.putIfAbsent(id,request)!=null) { call.reject("重复请求");return; }
        network.execute(() -> {
            try {
                URL url=new URL(call.getString("url",""));
                if(!"https".equals(url.getProtocol())) throw new IOException("HTTPS required");
                if(request.cancelled) throw new IOException("Cancelled");
                HttpURLConnection c=(HttpURLConnection)url.openConnection(); request.connection=c;
                c.setInstanceFollowRedirects(false); // Do not forward credentials to redirect targets.
                c.setConnectTimeout(15000); c.setReadTimeout(Math.min(90000,Math.max(1000,call.getInt("timeout",90000))));
                c.setRequestMethod(call.getString("method","GET"));
                JSONObject headers=call.getObject("headers",new JSObject());
                Iterator<String> names=headers.keys(); while(names.hasNext()) { String name=names.next(); c.setRequestProperty(name,headers.getString(name)); }
                String body=call.getString("body");
                if(request.cancelled) throw new IOException("Cancelled");
                if(body!=null) { c.setDoOutput(true);try(OutputStream out=c.getOutputStream()){out.write(body.getBytes(StandardCharsets.UTF_8));} }
                int status=c.getResponseCode(); InputStream source=status>=400?c.getErrorStream():c.getInputStream();
                ByteArrayOutputStream bytes=new ByteArrayOutputStream();
                if(source!=null) try(InputStream in=source) { byte[] buffer=new byte[8192];int n;while((n=in.read(buffer))!=-1) { if(request.cancelled || bytes.size()+n>LIMIT) throw new IOException();bytes.write(buffer,0,n); } }
                JSObject response=new JSObject();response.put("status",status);response.put("body",bytes.toString("UTF-8"));call.resolve(response);
            } catch(Exception e) { call.reject(request.cancelled?"请求已取消":"模型网络请求失败，请检查网络和接口地址","HTTP_FAILED"); }
            finally { if(request.connection!=null) request.connection.disconnect();requests.remove(id); }
        });
    }
    @PluginMethod public void cancelHttp(PluginCall call) {
        Request r=requests.get(call.getString("id",""));if(r!=null){r.cancelled=true;if(r.connection!=null)r.connection.disconnect();}call.resolve();
    }
}
