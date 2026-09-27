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
}
