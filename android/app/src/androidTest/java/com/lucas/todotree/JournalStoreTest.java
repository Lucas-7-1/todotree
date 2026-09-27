package com.lucas.todotree;

import static org.junit.Assert.*;

import android.content.*;
import android.database.DatabaseErrorHandler;
import android.database.sqlite.SQLiteDatabase;
import android.graphics.Bitmap;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.*;
import java.util.*;
import org.json.*;
import org.junit.Test;
import org.junit.runner.RunWith;

@RunWith(AndroidJUnit4.class)
public class JournalStoreTest {

  private Context context(String prefix) {
    Context target =
      InstrumentationRegistry.getInstrumentation().getTargetContext();
    return new ContextWrapper(target) {
      @Override
      public File getDatabasePath(String name) {
        return target.getDatabasePath(prefix + name);
      }

      @Override
      public SQLiteDatabase openOrCreateDatabase(
        String n,
        int m,
        SQLiteDatabase.CursorFactory f
      ) {
        return target.openOrCreateDatabase(prefix + n, m, f);
      }

      @Override
      public SQLiteDatabase openOrCreateDatabase(
        String n,
        int m,
        SQLiteDatabase.CursorFactory f,
        DatabaseErrorHandler h
      ) {
        return target.openOrCreateDatabase(prefix + n, m, f, h);
      }

      @Override
      public File getFilesDir() {
        File dir = new File(target.getFilesDir(), prefix);
        dir.mkdirs();
        return dir;
      }
    };
  }

  private JSONObject entry(String id) throws Exception {
    return new JSONObject()
      .put("id", id)
      .put("book_id", "daily")
      .put("event_date", "2026-01-01")
      .put("event_time", JSONObject.NULL)
      .put("event_timezone", "Asia/Shanghai")
      .put("title", "")
      .put("description", "在贵阳散步")
      .put("reflection", "很放松")
      .put("rating", JSONObject.NULL)
      .put("location_text", "")
      .put("tags", new JSONArray())
      .put("images", new JSONArray())
      .put("cover_attachment_id", JSONObject.NULL)
      .put("version", 0)
      .put("created_at", JournalStore.now())
      .put("updated_at", JournalStore.now())
      .put("deleted_at", JSONObject.NULL);
  }

  private JSONObject op(String action) throws Exception {
    return new JSONObject()
      .put("action", action)
      .put("operation_id", UUID.randomUUID().toString());
  }

  private JSONObject publish(JournalStore s, JSONObject e) throws Exception {
    return s.command(
      op("publish")
        .put("entry", e)
        .put("expected_version", e.getInt("version"))
        .put("draft_id", "draft-" + e.getString("id"))
    );
  }

  private byte[] image(int color) throws Exception {
    Bitmap b = Bitmap.createBitmap(40, 30, Bitmap.Config.ARGB_8888);
    b.eraseColor(color);
    ByteArrayOutputStream out = new ByteArrayOutputStream();
    b.compress(Bitmap.CompressFormat.PNG, 100, out);
    b.recycle();
    return out.toByteArray();
  }

  @Test
  public void journalReopenDraftIdempotencyAndDateIsolation() throws Exception {
    Context c = context("journal-test-" + System.nanoTime());
    JournalStore s = new JournalStore(c);
    JSONObject e = entry("walk"),
      draft = new JSONObject()
        .put("id", "draft-walk")
        .put("entry", e)
        .put("base_version", 0);
    s.command(op("saveDraft").put("draft", draft));
    assertEquals(0, s.command(op("list")).getJSONArray("entries").length());
    s.close();
    s = new JournalStore(c);
    assertEquals(1, s.command(op("boot")).getJSONArray("drafts").length());
    JSONObject p = op("publish")
      .put("entry", e)
      .put("draft_id", "draft-walk")
      .put("expected_version", 0);
    JSONObject saved = s.command(p);
    assertEquals(1, saved.getInt("version"));
    assertEquals(1, s.command(p).getInt("version"));
    assertEquals(0, s.command(op("boot")).getJSONArray("drafts").length());
    assertEquals(
      1,
      s
        .command(op("month").put("from", "2026-01-01").put("to", "2026-01-31"))
        .getInt("count")
    );
    assertEquals(
      0,
      s
        .command(op("list").put("date", "2026-01-02"))
        .getJSONArray("entries")
        .length()
    );
    JSONObject edited = new JSONObject(saved.toString()).put(
      "event_date",
      "2026-01-03"
    );
    publish(s, edited);
    assertEquals(
      0,
      s
        .command(op("list").put("date", "2026-01-01"))
        .getJSONArray("entries")
        .length()
    );
    try {
      publish(s, saved);
      fail("stale write accepted");
    } catch (Exception expected) {}
    s.close();
  }

  @Test
  public void originalSurvivesBackupRestoreDeletionAndCorruptImport()
    throws Exception {
    JournalStore s = new JournalStore(
      context("journal-images-" + System.nanoTime())
    );
    JSONObject img = s.importImage(new ByteArrayInputStream(image(0xff2a775a)));
    String id = img.getString("id");
    JSONObject e = entry("photo")
      .put("description", "")
      .put("reflection", "")
      .put("images", new JSONArray().put(id));
    JSONObject a = publish(s, e),
      b = publish(s, entry("other").put("images", new JSONArray().put(id)));
    assertTrue(new File(s.originals, id).isFile());
    assertTrue(s.media(id).getString("thumbnail").endsWith("-thumb.jpg"));
    JSONObject removed = s.command(
      op("delete")
        .put("id", a.getString("id"))
        .put("expected_version", a.getInt("version"))
    );
    s.command(op("purge").put("id", a.getString("id")));
    new File(s.originals, id).setLastModified(1);
    s.cleanup();
    assertTrue("Shared image deleted", new File(s.originals, id).isFile());
    ByteArrayOutputStream out = new ByteArrayOutputStream();
    s.exportZip(out);
    byte[] archive = out.toByteArray();
    JournalStore restored = new JournalStore(
      context("journal-restore-" + System.nanoTime())
    );
    assertEquals(
      1,
      restored.importZip(new ByteArrayInputStream(archive)).getInt("added")
    );
    assertEquals(
      1,
      restored.command(op("list")).getJSONArray("entries").length()
    );
    assertTrue(new File(restored.originals, id).isFile());
    assertTrue(new File(restored.originals, id).delete());
    restored.importZip(new ByteArrayInputStream(archive));
    assertEquals(id, JournalStore.sha(new File(restored.originals, id)));
    try (
      FileOutputStream damaged = new FileOutputStream(
        new File(restored.originals, id)
      )
    ) {
      damaged.write(new byte[] { 1, 2, 3 });
    }
    restored.importZip(new ByteArrayInputStream(archive));
    assertEquals(id, JournalStore.sha(new File(restored.originals, id)));
    assertEquals(
      1,
      restored.command(op("list")).getJSONArray("entries").length()
    );
    try {
      restored.importZip(
        new ByteArrayInputStream(Arrays.copyOf(archive, archive.length / 2))
      );
      fail("corrupt archive accepted");
    } catch (Exception expected) {}
    assertEquals(
      1,
      restored.command(op("list")).getJSONArray("entries").length()
    );
    JSONObject current = restored.command(
      op("get").put("id", b.getString("id"))
    );
    JSONObject trash = restored.command(
      op("delete")
        .put("id", current.getString("id"))
        .put("expected_version", current.getInt("version"))
    );
    restored.command(
      op("restore")
        .put("id", trash.getString("id"))
        .put("expected_version", trash.getInt("version"))
    );
    assertEquals(1, restored.command(op("month")).getInt("count"));
    s.close();
    restored.close();
  }

  @Test
  public void tenThousandEventsAndThousandPicturesQueryBoundedPages()
    throws Exception {
    JournalStore s = new JournalStore(
      context("journal-load-" + System.nanoTime())
    );
    String[] media = new String[1000];
    for (int i = 0; i < 1000; i++) media[i] = s
      .importImage(new ByteArrayInputStream(image(0xff000000 | i)))
      .getString("id");
    SQLiteDatabase db = s.getWritableDatabase();
    db.beginTransaction();
    try {
      for (int i = 0; i < 10000; i++) publish(
        s,
        entry("record-" + i).put(
          "images",
          i < 1000 ? new JSONArray().put(media[i]) : new JSONArray()
        )
      );
      db.setTransactionSuccessful();
    } finally {
      db.endTransaction();
    }
    long[] samples = new long[20];
    for (int i = 0; i < 20; i++) {
      long start = android.os.SystemClock.elapsedRealtime();
      JSONObject month = s.command(
        op("month").put("from", "2026-01-01").put("to", "2026-01-31")
      );
      assertEquals(10000, month.getInt("count"));
      assertEquals(1000, month.getInt("image_count"));
      samples[i] = android.os.SystemClock.elapsedRealtime() - start;
    }
    Arrays.sort(samples);
    android.util.Log.i(
      "JournalPerformance",
      "10000 entries/1000 originals month p95=" + samples[18] + "ms"
    );
    assertTrue(
      "Month query p95 exceeded target: " + samples[18],
      samples[18] < 300
    );
    JSONObject page = s.command(op("list"));
    assertEquals(20, page.getJSONArray("entries").length());
    JSONObject next = s.command(
      op("list").put("cursor", page.getJSONObject("cursor"))
    );
    Set<String> ids = new HashSet<>();
    for (int i = 0; i < 20; i++) ids.add(
      page.getJSONArray("entries").getJSONObject(i).getString("id")
    );
    for (int i = 0; i < 20; i++) assertFalse(
      ids.contains(
        next.getJSONArray("entries").getJSONObject(i).getString("id")
      )
    );
    s.close();
  }

  @Test
  public void deletingBookKeepsPublishedEntriesAndEditableDrafts()
    throws Exception {
    JournalStore store = new JournalStore(
      context("journal-book-" + System.nanoTime())
    );
    store.command(
      op("saveBook").put(
        "book",
        new JSONObject().put("id", "trip").put("name", "贵阳之旅")
      )
    );
    JSONObject saved = publish(
      store,
      entry("book-event").put("book_id", "trip")
    );
    JSONObject draft = new JSONObject()
      .put("id", "editing-trip")
      .put(
        "entry",
        new JSONObject(saved.toString()).put("reflection", "草稿中的新感受")
      )
      .put("base_version", saved.getInt("version"));
    store.command(op("saveDraft").put("draft", draft));
    store.command(op("deleteBook").put("id", "trip"));
    JSONObject kept = store
      .command(op("boot"))
      .getJSONArray("drafts")
      .getJSONObject(0);
    assertEquals("daily", kept.getJSONObject("entry").getString("book_id"));
    JSONObject result = store.command(
      op("publish")
        .put("entry", kept.getJSONObject("entry"))
        .put("draft_id", kept.getString("id"))
        .put("expected_version", kept.getInt("base_version"))
    );
    assertEquals("草稿中的新感受", result.getString("reflection"));
    assertEquals("daily", result.getString("book_id"));
    store.close();
  }

  @Test public void treeMoveUndoAndCrossDayRecords() throws Exception {
    JournalStore s=new JournalStore(context("journal-tree-"+System.nanoTime()));
    JSONObject a=publish(s,entry("a")),b=publish(s,entry("b"));
    JSONObject c=publish(s,entry("c").put("parent_id","a").put("event_date","2026-01-02"));
    JSONObject d=publish(s,entry("d").put("parent_id","c"));
    assertEquals(1,s.command(op("children").put("parent_id","a")).getInt("total"));
    JSONObject move=op("move").put("id","c").put("expected_version",1).put("parent_id","b").put("book_id","daily");
    s.command(move);s.command(move); // idempotency
    assertEquals("b",s.command(op("get").put("id","c")).getString("parent_id"));
    assertEquals("2026-01-02",s.command(op("get").put("id","c")).getString("event_date"));
    assertEquals("b",s.command(op("get").put("id","d")).getJSONArray("path").getJSONObject(0).getString("id"));
    s.command(op("undo").put("undo_id",move.getString("operation_id")));
    assertEquals("a",s.command(op("get").put("id","c")).getString("parent_id"));
    assertEquals(1,s.command(op("month").put("date","2026-01-02")).getInt("count"));
    try{s.command(op("move").put("id","a").put("expected_version",1).put("parent_id","d").put("book_id","daily"));fail("cycle accepted");}catch(Exception expected){assertTrue(expected.getMessage().contains("自身"));}
    s.close();
  }
  @Test public void treeDeleteRestoreDoesNotReviveOlderTrash() throws Exception {
    JournalStore s=new JournalStore(context("journal-delete-tree-"+System.nanoTime()));
    publish(s,entry("root"));publish(s,entry("old").put("parent_id","root"));publish(s,entry("live").put("parent_id","root"));
    s.command(op("delete").put("id","old").put("expected_version",1));
    JSONObject deleted=s.command(op("delete").put("id","root").put("expected_version",1).put("expected_count",1));
    assertEquals(0,s.command(op("list")).getJSONArray("entries").length());
    s.command(op("restore").put("id","root").put("expected_version",deleted.getInt("version")));
    assertTrue(s.command(op("get").put("id","live")).isNull("deleted_at"));
    assertFalse(s.command(op("get").put("id","old")).isNull("deleted_at"));
    assertEquals(2,s.command(op("month")).getInt("count"));s.close();
  }
  @Test public void treeBackupConflictCopiesWholeComponentAndRemapsDrafts() throws Exception {
    JournalStore s=new JournalStore(context("journal-tree-backup-"+System.nanoTime()));
    JSONObject root=publish(s,entry("root"));publish(s,entry("child").put("parent_id","root"));
    JSONObject draft=new JSONObject().put("id","draft-child-detail").put("entry",entry("draft-new").put("parent_id","child")).put("base_version",0);
    s.command(op("saveDraft").put("draft",draft));
    ByteArrayOutputStream bytes=new ByteArrayOutputStream();s.exportZip(bytes);
    root.put("description","修改后的正文");publish(s,root);
    JSONObject imported=s.importZip(new ByteArrayInputStream(bytes.toByteArray()));assertEquals(2,imported.getInt("added"));
    JSONArray rows=s.command(op("children").put("parent_id",JSONObject.NULL)).getJSONArray("entries");String copiedRoot="";
    for(int i=0;i<rows.length();i++)if(!rows.getJSONObject(i).getString("id").equals("root"))copiedRoot=rows.getJSONObject(i).getString("id");
    assertFalse(copiedRoot.isEmpty());JSONArray children=s.command(op("children").put("parent_id",copiedRoot)).getJSONArray("entries");assertEquals(1,children.length());assertNotEquals("child",children.getJSONObject(0).getString("id"));
    JSONArray drafts=s.command(op("boot")).getJSONArray("drafts");boolean found=false;
    for(int i=0;i<drafts.length();i++)if(children.getJSONObject(0).getString("id").equals(drafts.getJSONObject(i).getJSONObject("entry").optString("parent_id")))found=true;
    assertTrue("Imported draft must attach to copied child",found);s.close();
  }
  @Test public void treeDepthChecksCompleteSubtree() throws Exception {
    JournalStore s=new JournalStore(context("journal-tree-depth-"+System.nanoTime()));
    String parent="";for(int i=1;i<=5;i++){JSONObject e=entry("level"+i);if(!parent.isEmpty())e.put("parent_id",parent);publish(s,e);parent=e.getString("id");}
    try{publish(s,entry("sixth").put("parent_id",parent));fail("sixth level accepted");}catch(Exception expected){assertTrue(expected.getMessage().contains("5 层"));}
    assertEquals(5,s.command(op("month")).getInt("count"));s.close();
  }

  @Test public void flatV1DatabaseMigratesWithoutLosingRecordOrDraft() throws Exception {
    Context c=context("journal-v1-upgrade-"+System.nanoTime());
    SQLiteDatabase db=c.openOrCreateDatabase("journal.db",0,null);
    db.execSQL("CREATE TABLE entries(id TEXT PRIMARY KEY,book_id TEXT NOT NULL,event_date TEXT NOT NULL,sort_time TEXT NOT NULL,created_at TEXT NOT NULL,deleted_at TEXT,rating INTEGER,has_images INTEGER NOT NULL,search_text TEXT NOT NULL,version INTEGER NOT NULL,body TEXT NOT NULL)");
    db.execSQL("CREATE TABLE books(id TEXT PRIMARY KEY,body TEXT NOT NULL)");
    db.execSQL("CREATE TABLE attachments(id TEXT PRIMARY KEY,body TEXT NOT NULL)");
    db.execSQL("CREATE TABLE refs(owner_id TEXT NOT NULL,kind TEXT NOT NULL,attachment_id TEXT NOT NULL,PRIMARY KEY(owner_id,kind,attachment_id))");
    db.execSQL("CREATE TABLE drafts(id TEXT PRIMARY KEY,updated_at TEXT NOT NULL,body TEXT NOT NULL)");
    db.execSQL("CREATE TABLE operations(id TEXT PRIMARY KEY,result TEXT NOT NULL)");
    JSONObject old=entry("legacy").put("version",1),draft=new JSONObject().put("id","legacy-draft").put("entry",entry("draft-new")).put("base_version",0);
    db.execSQL("INSERT INTO books VALUES(?,?)",new Object[]{"daily",new JSONObject().put("id","daily").put("name","日常").put("created_at",JournalStore.now()).toString()});
    db.execSQL("INSERT INTO entries VALUES(?,?,?,?,?,?,?,?,?,?,?)",new Object[]{"legacy","daily","2026-01-01","99:99",old.getString("created_at"),null,null,0,"散步",1,old.toString()});
    db.execSQL("INSERT INTO drafts VALUES(?,?,?)",new Object[]{"legacy-draft",JournalStore.now(),draft.toString()});db.setVersion(1);db.close();
    JournalStore upgraded=new JournalStore(c);JSONObject restored=upgraded.command(op("get").put("id","legacy"));
    assertTrue(restored.isNull("parent_id"));assertEquals(old.getString("description"),restored.getString("description"));assertEquals(old.getString("event_date"),restored.getString("event_date"));
    assertEquals(1,upgraded.command(op("boot")).getJSONArray("drafts").length());assertTrue(new File(upgraded.root,"before-tree-upgrade.zip").isFile());
    publish(upgraded,entry("first-child").put("parent_id","legacy"));assertEquals(1,upgraded.command(op("children").put("parent_id","legacy")).getInt("total"));upgraded.close();
    upgraded=new JournalStore(c);assertEquals(2,upgraded.command(op("month")).getInt("count"));upgraded.close();
  }
}
