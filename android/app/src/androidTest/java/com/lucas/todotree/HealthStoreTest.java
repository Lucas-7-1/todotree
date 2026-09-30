package com.lucas.todotree;
import static org.junit.Assert.*;
import android.content.*;
import android.database.DatabaseErrorHandler;
import android.database.sqlite.SQLiteDatabase;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.File;
import org.json.*;
import org.junit.Test;
import org.junit.runner.RunWith;
@RunWith(AndroidJUnit4.class)
public class HealthStoreTest {
  private Context context() {
    Context target=InstrumentationRegistry.getInstrumentation().getTargetContext();String prefix="health-test-"+System.nanoTime()+"-";
    return new ContextWrapper(target) {
      @Override public File getDatabasePath(String name){return target.getDatabasePath(prefix+name);}
      @Override public SQLiteDatabase openOrCreateDatabase(String n,int m,SQLiteDatabase.CursorFactory f){return target.openOrCreateDatabase(prefix+n,m,f);}
      @Override public SQLiteDatabase openOrCreateDatabase(String n,int m,SQLiteDatabase.CursorFactory f,DatabaseErrorHandler h){return target.openOrCreateDatabase(prefix+n,m,f,h);}
      @Override public File getFilesDir(){File d=new File(target.getFilesDir(),prefix);d.mkdirs();return d;}
    };
  }
  private JSONObject record(String id,int version) throws Exception {
    return new JSONObject().put("id",id).put("kind","weight").put("day","2026-01-01").put("version",version).put("created_at","2026-01-01T00:00:00Z").put("updated_at","2026-01-01T00:00:00Z").put("deleted_at",JSONObject.NULL).put("body",new JSONObject().put("kg",60).put("occurred_at","2026-01-01T00:00:00Z"));
  }
  private JSONObject op(String id,long revision,JSONObject... changes) throws Exception {JSONArray a=new JSONArray();for(JSONObject r:changes)a.put(r);return new JSONObject().put("operation_id",id).put("expected_revision",revision).put("changes",a);}
  @Test public void committedFactsAndAckSurviveProcessReopen() throws Exception {
    Context c=context();JSONObject write=op("once",0,record("a",1));try(HealthStore s=new HealthStore(c)){assertEquals(1,s.commit(write).getLong("revision"));}
    try(HealthStore s=new HealthStore(c)){assertEquals(1,s.snapshot().getJSONArray("records").length());assertEquals(1,s.commit(write).getLong("revision"));assertEquals(1,s.snapshot().getLong("revision"));}
    File[] backups=new File(c.getFilesDir(),"health-backups").listFiles();assertNotNull(backups);assertTrue(backups.length>0);
  }
  @Test public void staleAndPartiallyInvalidBatchesNeverOverwriteValidFacts() throws Exception {
    try(HealthStore s=new HealthStore(context())){
      s.commit(op("first",0,record("a",1)));
      try{s.commit(op("stale",0,record("b",1)));fail("must reject stale revision");}catch(Exception expected){}
      try{s.commit(op("invalid",1,record("b",1),record("a",99)));fail("must roll back entire batch");}catch(Exception expected){}
      assertEquals(1,s.snapshot().getJSONArray("records").length());assertEquals(1,s.snapshot().getLong("revision"));
    }
  }
  @Test public void deletionIsDurableAndRestoreKeepsOriginalCreationTime() throws Exception {
    Context c=context();try(HealthStore s=new HealthStore(c)){s.commit(op("first",0,record("a",1)));s.commit(op("delete",1,record("a",2).put("deleted_at","2026-01-02T00:00:00Z")));}
    try(HealthStore s=new HealthStore(c)){assertFalse(s.snapshot().getJSONArray("records").getJSONObject(0).isNull("deleted_at"));s.commit(op("restore",2,record("a",3)));assertTrue(s.snapshot().getJSONArray("records").getJSONObject(0).isNull("deleted_at"));assertEquals("2026-01-01T00:00:00Z",s.snapshot().getJSONArray("records").getJSONObject(0).getString("created_at"));}
  }
}
