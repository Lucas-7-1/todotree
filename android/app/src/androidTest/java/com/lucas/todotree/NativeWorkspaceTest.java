package com.lucas.todotree;
import static org.junit.Assert.*;
import android.content.Context;
import android.content.ContextWrapper;
import android.database.DatabaseErrorHandler;
import java.io.File;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import com.getcapacitor.*;
import org.json.*;
import org.junit.Test;
import org.junit.runner.RunWith;
import java.util.concurrent.*;

/** Executes real Android SQLite and Keystore; no mocked storage implementation. */
@RunWith(AndroidJUnit4.class)
public class NativeWorkspaceTest {
    static class Call extends PluginCall {
        final CompletableFuture<JSObject> result=new CompletableFuture<>();
        Call(JSObject data) { super(null,"NativeWorkspace","test","test",data); }
        @Override public void resolve(JSObject data) { result.complete(data); }
        @Override public void resolve() { result.complete(new JSObject()); }
        @Override public void reject(String message,String code) { result.completeExceptionally(new Exception(code)); }
        JSObject await() throws Exception { return result.get(15,TimeUnit.SECONDS); }
    }
    NativeWorkspacePlugin plugin(Context context) {
        NativeWorkspacePlugin p=new NativeWorkspacePlugin() { @Override public Context getContext(){return context;} };
        p.load();return p;
    }
    JSObject read(NativeWorkspacePlugin p) throws Exception { Call c=new Call(new JSObject());p.read(c);return c.await(); }
    @Test public void atomicCommitRetryRollbackReopenAndEncryptedKey() throws Exception {
        Context target=InstrumentationRegistry.getInstrumentation().getTargetContext();
        assertEquals("com.lucas.todotree",target.getPackageName());
        // Never delete the live WebView workspace left by another instrumented test.
        Context context=new ContextWrapper(target) {
            private String testName(String name) { return "storage-test-"+name; }
            @Override public File getDatabasePath(String name) { return target.getDatabasePath(testName(name)); }
            @Override public boolean deleteDatabase(String name) { return target.deleteDatabase(testName(name)); }
            @Override public SQLiteDatabase openOrCreateDatabase(String name,int mode,SQLiteDatabase.CursorFactory factory) {
                return target.openOrCreateDatabase(testName(name),mode,factory);
            }
            @Override public SQLiteDatabase openOrCreateDatabase(String name,int mode,SQLiteDatabase.CursorFactory factory,DatabaseErrorHandler handler) {
                return target.openOrCreateDatabase(testName(name),mode,factory,handler);
            }
            @Override public File getFilesDir() {
                File dir=new File(target.getFilesDir(),"storage-test");dir.mkdirs();return dir;
            }
        };
        context.deleteDatabase("todotree.db");
        NativeWorkspacePlugin p=plugin(context);
        try {
            assertEquals(0,read(p).getLong("revision"));
            // JSON parses small numbers as Integer, not Long. Must accept bridge revision 0.
            JSObject op=new JSObject("{\"expected_revision\":0,\"operation_id\":\"first\",\"changes\":[],\"settings\":{},\"ai_settings\":{\"api_key\":\"instrumented-test-key\"}}");
            JSONArray changes=new JSONArray();
            changes.put(new JSONObject().put("collection","tasks").put("id","a").put("position",0).put("value", "{\"id\":\"a\",\"title\":\"测试任务\",\"status\":\"done\",\"parent_id\":null}"));
            changes.put(new JSONObject().put("collection","events").put("id","e").put("position",0).put("value","{\"event_id\":\"e\",\"task_id\":\"a\"}"));
            op.put("changes",changes);Call write=new Call(op);p.commit(write);assertEquals(1,write.await().getLong("revision"));
            Call retry=new Call(op);p.commit(retry);assertEquals(1,retry.await().getLong("revision"));
            JSONObject data=read(p).getJSONObject("data");assertEquals(1,data.getJSONArray("events").length());assertEquals("instrumented-test-key",data.getJSONObject("ai_settings").getString("api_key"));
            // Force a failure after a valid delete in the same transaction: neither may persist.
            JSObject bad=new JSObject(op.toString());bad.put("expected_revision",1);bad.put("operation_id","bad");
            bad.put("changes",new JSONArray().put(new JSONObject().put("collection","tasks").put("id","a").put("value",JSONObject.NULL)).put(new JSONObject().put("collection","illegal").put("id","x").put("value","{}")));
            Call failed=new Call(bad);p.commit(failed);try { failed.await(); fail("bad transaction accepted"); } catch(ExecutionException expected) {}
            assertEquals(1,read(p).getJSONObject("data").getJSONArray("tasks").length());
            // Inspect disk to ensure credentials are not stored in plain text.
            try(SQLiteDatabase db=SQLiteDatabase.openDatabase(context.getDatabasePath("todotree.db").getPath(),null,SQLiteDatabase.OPEN_READONLY);Cursor cursor=db.rawQuery("SELECT value FROM meta WHERE key IN ('api_key','ai_settings')",null)) {
                while(cursor.moveToNext()) assertFalse(cursor.getString(0).contains("instrumented-test-key"));
            }
            NativeWorkspacePlugin reopened=plugin(context);
            try {assertEquals(1,read(reopened).getLong("revision"));assertEquals("测试任务",read(reopened).getJSONObject("data").getJSONArray("tasks").getJSONObject(0).getString("title"));}
            finally {reopened.handleOnDestroy();}
        } finally {p.handleOnDestroy();}
    }
}
