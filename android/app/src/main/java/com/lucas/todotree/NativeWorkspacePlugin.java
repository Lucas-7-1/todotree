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
                Set<String> reminderIds=new HashSet<>();
                db.beginTransaction();
                for(int i=0;i<changes.length();i++) {
                    JSONObject row=changes.getJSONObject(i); String collection=row.getString("collection"),id=row.getString("id");
                    if(!COLLECTIONS.contains(collection) || id.isEmpty()) throw new Exception("非法记录类型");
                    if("tasks".equals(collection)) {
                        boolean hasRule=!row.isNull("value")&&new JSONObject(row.getString("value")).optJSONObject("reminder")!=null;
                        if(hasRule)reminderIds.add(id);
                        else try(Cursor old=db.rawQuery("SELECT body FROM records WHERE collection='tasks' AND id=?",new String[]{id})) {if(old.moveToFirst()&&new JSONObject(old.getString(0)).optJSONObject("reminder")!=null)reminderIds.add(id);}
                    }
                    if(row.isNull("value")) db.delete("records","collection=? AND id=?",new String[]{collection,id});
                    else { String body=row.getString("value"); new JSONObject(body);
                        ContentValues v=new ContentValues();v.put("collection",collection);v.put("id",id);v.put("body",body);v.put("position",row.optInt("position",i));
                        db.insertWithOnConflict("records",null,v,SQLiteDatabase.CONFLICT_REPLACE);
                    }
                }
                put(db,"settings",call.getObject("settings",new JSObject()).toString()); put(db,"ai_settings",ai.toString()); put(db,"api_key",sealed);
                put(db,"revision",String.valueOf(revision+1)); put(db,"operation_id",op); put(db,"saved_at",now());
                db.setTransactionSuccessful(); db.endTransaction();
                JSObject committed=ack(db);
                try { for(int i=0;i<changes.length();i++) {JSONObject row=changes.getJSONObject(i);if("tasks".equals(row.optString("collection"))&&reminderIds.contains(row.optString("id"))) {if(row.isNull("value"))TaskReminderReceiver.cancel(getContext(),row.getString("id"));else TaskReminderReceiver.schedule(getContext(),new JSONObject(row.getString("value")));}} }
                catch(Exception reminder) {committed.put("reminder_error","任务已保存，系统提醒未设置成功，请打开任务重新检查");}
                call.resolve(committed);
            } catch(Exception e) {
                if(db!=null && db.inTransaction()) db.endTransaction();
                call.reject("保存失败，未确认完成："+e.getClass().getSimpleName(),"WRITE_FAILED");
            }
        });
    }
    @PluginMethod public void exportFile(PluginCall call) {
        disk.execute(() -> {
            File stage = null;
            try {
                String content = call.getString("content");
                if (content == null || content.trim().isEmpty()) throw new IOException("Empty export");
                byte[] bytes = content.getBytes(StandardCharsets.UTF_8);
                if (bytes.length > LIMIT) throw new IOException("Export too large");
                if (call.getString("mimeType", "application/json").contains("json")) new JSONObject(content);
                stage = File.createTempFile("backup-export-", ".tmp", getContext().getCacheDir());
                try (FileOutputStream stream = new FileOutputStream(stage)) { stream.write(bytes); stream.getFD().sync(); }
                call.getData().put("export_stage_path", stage.getAbsolutePath());
                call.getData().remove("content");
                getBridge().executeOnMainThread(() -> {
                    try {
                        Intent intent=new Intent(Intent.ACTION_CREATE_DOCUMENT); intent.addCategory(Intent.CATEGORY_OPENABLE);
                        intent.setType(call.getString("mimeType","application/json")); intent.putExtra(Intent.EXTRA_TITLE,call.getString("filename","TodoTree-Backup.json"));
                        startActivityForResult(call,intent,"exportResult");
                    } catch (Exception e) { removeExportStage(call); call.reject("无法打开文件保存窗口，请重试", "EXPORT_PICKER_FAILED"); }
                });
            } catch (Exception e) {
                if (stage != null) stage.delete();
                call.reject("未能准备完整导出文件，请检查内容与 32 MB 大小限制", "EXPORT_PREPARE_FAILED");
            }
        });
    }
    private void removeExportStage(PluginCall call) {
        String path = call.getString("export_stage_path");
        if (path != null) new File(path).delete();
    }
    @ActivityCallback private void exportResult(PluginCall call, ActivityResult result) {
        if(call==null) return;
        if(result.getResultCode()!=Activity.RESULT_OK || result.getData()==null) { removeExportStage(call); JSObject o=new JSObject();o.put("cancelled",true);call.resolve(o);return; }
        disk.execute(() -> {
            try {
                String path = call.getString("export_stage_path");
                if (path == null) throw new IOException("Missing staged backup");
                byte[] bytes = BackupDocumentIO.read(new FileInputStream(path));
                BackupDocumentIO.writeVerified(getContext().getContentResolver(), result.getData().getData(), bytes);
                JSObject saved = new JSObject(); saved.put("verified", true); saved.put("byte_count", bytes.length);
                call.resolve(saved);
            } catch(Exception e) { call.reject("文件写入或回读校验失败，不能确认备份完整；请换一个本地目录重新导出", "EXPORT_VERIFY_FAILED"); }
            finally { removeExportStage(call); }
        });
    }
    @PluginMethod public void importFile(PluginCall call) {
        try {
            Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT); intent.addCategory(Intent.CATEGORY_OPENABLE);
            intent.setType("*/*"); intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"application/json", "text/plain", "application/octet-stream"});
            startActivityForResult(call, intent, "importResult");
        } catch (Exception e) { call.reject("无法打开备份选择窗口，请重试", "IMPORT_PICKER_FAILED"); }
    }
    @ActivityCallback private void importResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
            JSObject cancelled = new JSObject(); cancelled.put("cancelled", true); call.resolve(cancelled); return;
        }
        disk.execute(() -> {
            try {
                byte[] bytes = BackupDocumentIO.read(getContext().getContentResolver().openInputStream(result.getData().getData()));
                if (bytes.length == 0) { call.reject("备份文件为空，请保存到本机后重试或从旧版重新导出", "IMPORT_EMPTY"); return; }
                JSObject imported = new JSObject(); imported.put("content", BackupDocumentIO.decode(bytes)); imported.put("byte_count", bytes.length);
                call.resolve(imported);
            } catch (Exception e) { call.reject("无法完整读取备份，可能未下载、编码损坏或超过 32 MB；现有数据未改变", "IMPORT_READ_FAILED"); }
        });
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
