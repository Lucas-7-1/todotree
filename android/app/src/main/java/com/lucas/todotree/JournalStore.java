package com.lucas.todotree;

import android.content.*;
import android.database.*;
import android.database.sqlite.*;
import android.graphics.*;
import android.media.ExifInterface;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.text.SimpleDateFormat;
import java.util.*;
import java.util.zip.*;
import org.json.*;

/** Journal state and immutable originals are isolated from task persistence. */
public final class JournalStore extends SQLiteOpenHelper {

  final File root, originals, previews, staging;
  static final long IMAGE_LIMIT = 25L * 1024 * 1024;
  private int exports;

  public JournalStore(Context context) {
    super(context, "journal.db", null, 1);
    root = new File(context.getFilesDir(), "journal");
    originals = new File(root, "originals");
    previews = new File(root, "previews");
    staging = new File(root, "staging");
    for (File d : new File[] { root, originals, previews, staging })
      if (!d.isDirectory() && !d.mkdirs()) throw new IllegalStateException(
        "无法创建手帐目录"
      );
    setWriteAheadLoggingEnabled(true);
  }

  @Override
  public void onCreate(SQLiteDatabase db) {
    db.execSQL(
      "CREATE TABLE entries(id TEXT PRIMARY KEY,book_id TEXT NOT NULL,event_date TEXT NOT NULL,sort_time TEXT NOT NULL,created_at TEXT NOT NULL,deleted_at TEXT,rating INTEGER,has_images INTEGER NOT NULL,search_text TEXT NOT NULL,version INTEGER NOT NULL,body TEXT NOT NULL)"
    );
    db.execSQL(
      "CREATE INDEX entries_date ON entries(deleted_at,event_date,sort_time,created_at,id)"
    );
    db.execSQL(
      "CREATE INDEX entries_book_date ON entries(book_id,deleted_at,event_date)"
    );
    db.execSQL("CREATE TABLE books(id TEXT PRIMARY KEY,body TEXT NOT NULL)");
    db.execSQL(
      "CREATE TABLE attachments(id TEXT PRIMARY KEY,body TEXT NOT NULL)"
    );
    db.execSQL(
      "CREATE TABLE refs(owner_id TEXT NOT NULL,kind TEXT NOT NULL,attachment_id TEXT NOT NULL,PRIMARY KEY(owner_id,kind,attachment_id))"
    );
    db.execSQL("CREATE INDEX refs_attachment ON refs(attachment_id)");
    db.execSQL(
      "CREATE TABLE drafts(id TEXT PRIMARY KEY,updated_at TEXT NOT NULL,body TEXT NOT NULL)"
    );
    db.execSQL(
      "CREATE TABLE operations(id TEXT PRIMARY KEY,result TEXT NOT NULL)"
    );
    try {
      writeBody(
        db,
        "books",
        new JSONObject()
          .put("id", "daily")
          .put("name", "日常")
          .put("created_at", now())
      );
    } catch (Exception e) {
      throw new IllegalStateException(e);
    }
  }

  @Override
  public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {
    throw new IllegalStateException("手帐升级尚未定义，原数据已保留");
  }

  static String now() {
    SimpleDateFormat f = new SimpleDateFormat(
      "yyyy-MM-dd'T'HH:mm:ss.SSS'Z'",
      Locale.US
    );
    f.setTimeZone(TimeZone.getTimeZone("UTC"));
    return f.format(new Date());
  }

  static String text(JSONObject o, String k) {
    return o.isNull(k) ? "" : o.optString(k, "");
  }

  static JSONArray array(JSONObject o, String k) {
    JSONArray a = o.optJSONArray(k);
    return a == null ? new JSONArray() : a;
  }

  private static void writeBody(SQLiteDatabase db, String table, JSONObject o)
    throws Exception {
    ContentValues v = new ContentValues();
    v.put("id", o.getString("id"));
    v.put("body", o.toString());
    db.insertWithOnConflict(table, null, v, SQLiteDatabase.CONFLICT_REPLACE);
  }

  private static JSONObject get(SQLiteDatabase db, String table, String id)
    throws Exception {
    try (
      Cursor c = db.query(
        table,
        new String[] { "body" },
        "id=?",
        new String[] { id },
        null,
        null,
        null
      )
    ) {
      return c.moveToFirst() ? new JSONObject(c.getString(0)) : null;
    }
  }

  private static JSONArray all(SQLiteDatabase db, String table)
    throws Exception {
    JSONArray a = new JSONArray();
    try (
      Cursor c = db.query(
        table,
        new String[] { "body" },
        null,
        null,
        null,
        null,
        null
      )
    ) {
      while (c.moveToNext()) a.put(new JSONObject(c.getString(0)));
    }
    return a;
  }

  private void refs(
    SQLiteDatabase db,
    String owner,
    String kind,
    JSONArray images
  ) throws Exception {
    db.delete("refs", "owner_id=? AND kind=?", new String[] { owner, kind });
    Set<String> seen = new HashSet<>();
    for (int i = 0; i < images.length(); i++) {
      String id = images.getString(i);
      if (!seen.add(id)) throw new Exception("图片重复");
      if (
        get(db, "attachments", id) == null || !new File(originals, id).isFile()
      ) throw new Exception("图片尚未保存，请重试导入");
      ContentValues v = new ContentValues();
      v.put("owner_id", owner);
      v.put("kind", kind);
      v.put("attachment_id", id);
      db.insertOrThrow("refs", null, v);
    }
  }

  static void validate(JSONObject e, boolean publish) throws Exception {
    String id = e.getString("id"),
      date = e.getString("event_date"),
      zone = e.getString("event_timezone");
    if (id.isEmpty() || id.length() > 150) throw new Exception("记录编号无效");
    if (
      !date.matches("\\d{4}-\\d{2}-\\d{2}") ||
      !Arrays.asList(TimeZone.getAvailableIDs()).contains(zone)
    ) throw new Exception("日期或时区无效");
    SimpleDateFormat f = new SimpleDateFormat("yyyy-MM-dd", Locale.US);
    f.setLenient(false);
    f.setTimeZone(TimeZone.getTimeZone(zone));
    f.parse(date);
    if (date.compareTo(f.format(new Date())) > 0) throw new Exception(
      "手帐记录今天及过去发生的事情"
    );
    if (
      !text(e, "event_time").isEmpty() &&
      !text(e, "event_time").matches("([01]\\d|2[0-3]):[0-5]\\d")
    ) throw new Exception("时间无效");
    String[] fields = { "title", "description", "reflection", "location_text" };
    int[] limits = { 100, 20000, 5000, 200 };
    for (int i = 0; i < fields.length; i++) if (
      text(e, fields[i]).length() > limits[i]
    ) throw new Exception("内容超过字数上限");
    if (
      !e.isNull("rating") &&
      (e.getDouble("rating") != e.optInt("rating") ||
        e.optInt("rating") < 1 ||
        e.optInt("rating") > 5)
    ) throw new Exception("评分应为 1–5 星，也可留空");
    if (
      array(e, "images").length() > 20 || array(e, "tags").length() > 10
    ) throw new Exception("最多 20 张图片、10 个标签");
    for (int i = 0; i < array(e, "tags").length(); i++) if (
      array(e, "tags").getString(i).length() > 20
    ) throw new Exception("标签最多 20 字");
    if (
      publish &&
      text(e, "title").trim().isEmpty() &&
      text(e, "description").trim().isEmpty() &&
      text(e, "reflection").trim().isEmpty() &&
      e.isNull("rating") &&
      array(e, "images").length() == 0
    ) throw new Exception("写点内容或添加照片再保存");
  }

  private void putEntry(SQLiteDatabase db, JSONObject e) throws Exception {
    String id = e.getString("id");
    JSONArray images = array(e, "images");
    if (get(db, "books", e.optString("book_id", "daily")) == null) e.put(
      "book_id",
      "daily"
    );
    Set<String> ids = new HashSet<>();
    for (int i = 0; i < images.length(); i++) ids.add(images.getString(i));
    if (!ids.contains(text(e, "cover_attachment_id"))) e.put(
      "cover_attachment_id",
      images.length() > 0 ? images.getString(0) : JSONObject.NULL
    );
    ContentValues v = new ContentValues();
    v.put("id", id);
    v.put("book_id", e.optString("book_id", "daily"));
    v.put("event_date", e.getString("event_date"));
    v.put(
      "sort_time",
      text(e, "event_time").isEmpty() ? "99:99" : e.getString("event_time")
    );
    v.put("created_at", e.getString("created_at"));
    if (e.isNull("deleted_at")) v.putNull("deleted_at");
    else v.put("deleted_at", e.getString("deleted_at"));
    if (e.isNull("rating")) v.putNull("rating");
    else v.put("rating", e.getInt("rating"));
    v.put("has_images", images.length() > 0 ? 1 : 0);
    v.put("version", e.getInt("version"));
    v.put(
      "search_text",
      (
        text(e, "title") +
        " " +
        text(e, "description") +
        " " +
        text(e, "reflection") +
        " " +
        text(e, "location_text") +
        " " +
        array(e, "tags")
      ).toLowerCase(Locale.ROOT)
    );
    v.put("body", e.toString());
    db.insertWithOnConflict(
      "entries",
      null,
      v,
      SQLiteDatabase.CONFLICT_REPLACE
    );
    refs(db, id, "entry", images);
  }

  private static class Query {

    String where;
    ArrayList<String> args = new ArrayList<>();

    Query(String w) {
      where = w;
    }

    void and(String w, String... a) {
      where += " AND " + w;
      Collections.addAll(args, a);
    }

    String[] args() {
      return args.toArray(new String[0]);
    }
  }

  private Query filter(JSONObject o) {
    Query q = new Query(
      o.optBoolean("trash") ? "deleted_at IS NOT NULL" : "deleted_at IS NULL"
    );
    if (!text(o, "book_id").isEmpty()) q.and(
      "book_id=?",
      o.optString("book_id")
    );
    if (!text(o, "date").isEmpty()) q.and("event_date=?", o.optString("date"));
    if (!text(o, "from").isEmpty()) q.and("event_date>=?", o.optString("from"));
    if (!text(o, "to").isEmpty()) q.and("event_date<=?", o.optString("to"));
    String s = text(o, "query").trim().toLowerCase(Locale.ROOT);
    if (!s.isEmpty()) q.and("instr(search_text,?)>0", s);
    if (o.has("has_images") && !o.isNull("has_images")) q.and(
      "has_images=?",
      o.optBoolean("has_images") ? "1" : "0"
    );
    if (o.optInt("min_rating", 0) > 0) q.and(
      "rating>=?",
      String.valueOf(o.optInt("min_rating"))
    );
    if (o.optInt("max_rating", 0) > 0) q.and(
      "rating<=?",
      String.valueOf(o.optInt("max_rating"))
    );
    return q;
  }

  public synchronized JSONObject command(JSONObject o) throws Exception {
    SQLiteDatabase db = getWritableDatabase();
    String action = o.getString("action");
    if (action.equals("boot")) {
      JSONArray drafts = new JSONArray();
      try (
        Cursor c = db.rawQuery(
          "SELECT body FROM drafts ORDER BY updated_at DESC",
          null
        )
      ) {
        while (c.moveToNext()) drafts.put(new JSONObject(c.getString(0)));
      }
      return new JSONObject()
        .put("books", all(db, "books"))
        .put("drafts", drafts);
    }
    if (action.equals("get")) {
      JSONObject e = get(db, "entries", o.getString("id"));
      if (e == null) throw new Exception("记录不存在");
      return e;
    }
    if (action.equals("month")) {
      Query q = filter(o);
      JSONArray days = new JSONArray();
      int count = 0,
        images = 0;
      try (
        Cursor c = db.rawQuery(
          "SELECT event_date,COUNT(*) FROM entries WHERE " +
            q.where +
            " GROUP BY event_date ORDER BY event_date",
          q.args()
        )
      ) {
        while (c.moveToNext()) {
          days.put(
            new JSONObject()
              .put("date", c.getString(0))
              .put("count", c.getInt(1))
          );
          count += c.getInt(1);
        }
      }
      try (
        Cursor c = db.rawQuery(
          "SELECT COUNT(*) FROM refs JOIN entries ON refs.owner_id=entries.id WHERE refs.kind='entry' AND " +
            q.where,
          q.args()
        )
      ) {
        if (c.moveToFirst()) images = c.getInt(0);
      }
      return new JSONObject()
        .put("days", days)
        .put("count", count)
        .put("image_count", images);
    }
    if (action.equals("list")) {
      Query q = filter(o);
      JSONObject cursor = o.optJSONObject("cursor");
      int limit = Math.max(1, Math.min(50, o.optInt("limit", 20)));
      if (cursor != null) {
        String d = cursor.getString("date"),
          t = cursor.getString("time"),
          c = cursor.getString("created"),
          id = cursor.getString("id");
        q.and(
          "(event_date<? OR (event_date=? AND (sort_time>? OR (sort_time=? AND (created_at>? OR (created_at=? AND id>?))))))",
          d,
          d,
          t,
          t,
          c,
          c,
          id
        );
      }
      JSONArray rows = new JSONArray();
      JSONObject next = null;
      boolean more = false;
      try (
        Cursor c = db.query(
          "entries",
          new String[] { "body", "sort_time" },
          q.where,
          q.args(),
          null,
          null,
          "event_date DESC,sort_time ASC,created_at ASC,id ASC",
          String.valueOf(limit + 1)
        )
      ) {
        while (c.moveToNext()) {
          if (rows.length() == limit) {
            more = true;
            break;
          }
          JSONObject e = new JSONObject(c.getString(0));
          next = new JSONObject()
            .put("date", e.getString("event_date"))
            .put("time", c.getString(1))
            .put("created", e.getString("created_at"))
            .put("id", e.getString("id"));
          for (String key : new String[] { "description", "reflection" }) {
            String s = text(e, key);
            e.put(key, s.substring(0, Math.min(180, s.length())));
          }
          rows.put(e);
        }
      }
      return new JSONObject()
        .put("entries", rows)
        .put("cursor", more ? next : JSONObject.NULL);
    }
    if (action.equals("stats")) {
      long bytes = 0;
      try (Cursor c = db.rawQuery("SELECT body FROM attachments", null)) {
        while (c.moveToNext())
          bytes += new JSONObject(c.getString(0)).optLong("byte_size");
      }
      return new JSONObject()
        .put("original_bytes", bytes)
        .put("available_bytes", root.getUsableSpace());
    }
    String op = text(o, "operation_id");
    if (op.isEmpty()) throw new Exception("缺少操作编号");
    try (
      Cursor c = db.rawQuery(
        "SELECT result FROM operations WHERE id=?",
        new String[] { op }
      )
    ) {
      if (c.moveToFirst()) return new JSONObject(c.getString(0));
    }
    JSONObject result = new JSONObject();
    db.beginTransaction();
    try {
      if (action.equals("saveDraft")) {
        JSONObject d = o.getJSONObject("draft"),
          e = d.getJSONObject("entry");
        validate(e, false);
        String id = d.getString("id");
        d.put("updated_at", now());
        ContentValues v = new ContentValues();
        v.put("id", id);
        v.put("updated_at", d.getString("updated_at"));
        v.put("body", d.toString());
        db.insertWithOnConflict(
          "drafts",
          null,
          v,
          SQLiteDatabase.CONFLICT_REPLACE
        );
        refs(db, id, "draft", array(e, "images"));
        result = d;
      } else if (action.equals("discardDraft")) {
        String id = o.getString("id");
        db.delete("drafts", "id=?", new String[] { id });
        db.delete("refs", "owner_id=? AND kind='draft'", new String[] { id });
      } else if (action.equals("publish")) {
        JSONObject e = new JSONObject(o.getJSONObject("entry").toString());
        validate(e, true);
        JSONObject old = get(db, "entries", e.getString("id"));
        int expected = o.getInt("expected_version");
        if (
          (old == null ? 0 : old.getInt("version")) != expected
        ) throw new Exception("记录已变化，草稿已保留，请重新打开核对");
        if (old != null && !old.isNull("deleted_at")) throw new Exception(
          "记录在回收站，请先恢复"
        );
        e.put("version", expected + 1)
          .put("created_at", old == null ? now() : old.getString("created_at"))
          .put("updated_at", now())
          .put("deleted_at", JSONObject.NULL);
        putEntry(db, e);
        String draft = o.getString("draft_id");
        db.delete("drafts", "id=?", new String[] { draft });
        db.delete("refs", "owner_id=? AND kind='draft'", new String[] {
          draft,
        });
        result = e;
      } else if (action.equals("delete") || action.equals("restore")) {
        JSONObject e = get(db, "entries", o.getString("id"));
        if (e == null) throw new Exception("记录不存在");
        if (
          e.getInt("version") != o.getInt("expected_version")
        ) throw new Exception("记录已变化，请刷新后操作");
        e.put("deleted_at", action.equals("delete") ? now() : JSONObject.NULL)
          .put("updated_at", now())
          .put("version", e.getInt("version") + 1);
        putEntry(db, e);
        result = e;
      } else if (action.equals("purge")) {
        JSONObject e = get(db, "entries", o.getString("id"));
        if (e == null || e.isNull("deleted_at")) throw new Exception(
          "仅回收站记录可永久删除"
        );
        db.delete("entries", "id=?", new String[] { e.getString("id") });
        db.delete("refs", "owner_id=? AND kind='entry'", new String[] {
          e.getString("id"),
        });
      } else if (action.equals("saveBook")) {
        JSONObject b = o.getJSONObject("book");
        if (
          text(b, "name").trim().isEmpty() || text(b, "name").length() > 60
        ) throw new Exception("手帐本名称为 1–60 字");
        if (
          b.getString("id").equals("daily") &&
          !b.getString("name").equals("日常")
        ) throw new Exception("日常手帐不可重命名");
        writeBody(db, "books", b);
        JSONArray cover = new JSONArray();
        if (!text(b, "cover_attachment_id").isEmpty()) cover.put(
          b.getString("cover_attachment_id")
        );
        refs(db, b.getString("id"), "book", cover);
        result = b;
      } else if (action.equals("deleteBook")) {
        String id = o.getString("id");
        if (id.equals("daily")) throw new Exception("日常手帐不可删除");
        ArrayList<JSONObject> entries = new ArrayList<>();
        try (
          Cursor c = db.rawQuery(
            "SELECT body FROM entries WHERE book_id=?",
            new String[] { id }
          )
        ) {
          while (c.moveToNext()) entries.add(new JSONObject(c.getString(0)));
        }
        for (JSONObject e : entries) {
          e.put("book_id", "daily")
            .put("version", e.getInt("version") + 1)
            .put("updated_at", now());
          putEntry(db, e);
        }
        db.delete("books", "id=?", new String[] { id });
        db.delete("refs", "owner_id=? AND kind='book'", new String[] { id });
      } else throw new Exception("未知手帐操作");
      if (!action.equals("saveDraft") && !action.equals("discardDraft")) {
        ContentValues v = new ContentValues();
        v.put("id", op);
        v.put("result", result.toString());
        db.insertOrThrow("operations", null, v);
      }
      db.setTransactionSuccessful();
    } finally {
      db.endTransaction();
    }
    return result;
  }

  public synchronized void attachToDraft(String draftId, String imageId)
    throws Exception {
    SQLiteDatabase db = getWritableDatabase();
    JSONObject draft = get(db, "drafts", draftId);
    if (draft == null) throw new Exception("草稿已关闭，请重新选择图片");
    JSONObject e = draft.getJSONObject("entry");
    JSONArray images = array(e, "images");
    for (int i = 0; i < images.length(); i++) if (
      images.getString(i).equals(imageId)
    ) return;
    if (images.length() >= 20) throw new Exception("最多 20 张图片");
    images.put(imageId);
    e.put("images", images);
    command(
      new JSONObject()
        .put("action", "saveDraft")
        .put("operation_id", UUID.randomUUID().toString())
        .put("draft", draft)
    );
  }

  static String sha(File file) throws Exception {
    MessageDigest digest = MessageDigest.getInstance("SHA-256");
    try (InputStream in = new FileInputStream(file)) {
      byte[] b = new byte[65536];
      int n;
      while ((n = in.read(b)) != -1) digest.update(b, 0, n);
    }
    StringBuilder s = new StringBuilder();
    for (byte b : digest.digest())
      s.append(String.format(Locale.US, "%02x", b & 255));
    return s.toString();
  }

  static long copy(InputStream in, OutputStream out, long limit)
    throws Exception {
    byte[] b = new byte[65536];
    long total = 0;
    int n;
    while ((n = in.read(b)) != -1) {
      total += n;
      if (total > limit) throw new IOException("文件超过支持大小");
      out.write(b, 0, n);
    }
    return total;
  }

  public JSONObject importImage(InputStream input) throws Exception {
    File temp = File.createTempFile("import-", ".part", staging);
    try {
      try (FileOutputStream out = new FileOutputStream(temp)) {
        copy(input, out, IMAGE_LIMIT);
        out.getFD().sync();
      }
      BitmapFactory.Options size = new BitmapFactory.Options();
      size.inJustDecodeBounds = true;
      BitmapFactory.decodeFile(temp.getPath(), size);
      if (
        size.outWidth <= 0 ||
        size.outHeight <= 0 ||
        (long) size.outWidth * size.outHeight > 100000000L
      ) throw new IOException("图片格式不支持或分辨率过大");
      String id = sha(temp);
      JSONObject a = new JSONObject()
        .put("id", id)
        .put("content_hash", id)
        .put("mime_type", size.outMimeType)
        .put("byte_size", temp.length())
        .put("width", size.outWidth)
        .put("height", size.outHeight)
        .put("created_at", now());
      synchronized (this) {
        File dest = new File(originals, id);
        if (!dest.isFile() && !temp.renameTo(dest)) throw new IOException(
          "图片保存失败"
        );
        writeBody(getWritableDatabase(), "attachments", a);
      }
      try {
        preview(id);
      } catch (Exception ignored) {
        /* Original is durable; derived previews can be rebuilt. */
      }
      return a;
    } finally {
      temp.delete();
    }
  }

  public synchronized JSONObject media(String id) throws Exception {
    if (!id.matches("[0-9a-f]{64}")) throw new Exception("图片编号无效");
    JSONObject meta = get(getReadableDatabase(), "attachments", id);
    if (meta == null || !new File(originals, id).isFile()) throw new Exception(
      "原图缺失，请从备份恢复"
    );
    preview(id);
    return new JSONObject()
      .put("original", "file://" + new File(originals, id))
      .put("preview", "file://" + new File(previews, id + ".jpg"))
      .put("thumbnail", "file://" + new File(previews, id + "-thumb.jpg"))
      .put("mime_type", meta.optString("mime_type", "image/jpeg"));
  }

  private synchronized void preview(String id) throws Exception {
    File out = new File(previews, id + ".jpg"),
      thumb = new File(previews, id + "-thumb.jpg"),
      source = new File(originals, id);
    if (out.isFile() && thumb.isFile()) return;
    BitmapFactory.Options o = new BitmapFactory.Options();
    o.inJustDecodeBounds = true;
    BitmapFactory.decodeFile(source.getPath(), o);
    int sample = 1;
    while (Math.max(o.outWidth, o.outHeight) / sample > 2048) sample *= 2;
    o.inSampleSize = sample;
    o.inJustDecodeBounds = false;
    Bitmap b = BitmapFactory.decodeFile(source.getPath(), o);
    if (b == null) throw new IOException("预览无法生成");
    try {
      int orientation = 1;
      try {
        orientation = new ExifInterface(source.getPath()).getAttributeInt(
          ExifInterface.TAG_ORIENTATION,
          1
        );
      } catch (IOException ignored) {}
      Matrix m = new Matrix();
      switch (orientation) {
        case 2:
          m.setScale(-1, 1);
          break;
        case 3:
          m.setRotate(180);
          break;
        case 4:
          m.setScale(1, -1);
          break;
        case 5:
          m.setRotate(90);
          m.postScale(-1, 1);
          break;
        case 6:
          m.setRotate(90);
          break;
        case 7:
          m.setRotate(270);
          m.postScale(-1, 1);
          break;
        case 8:
          m.setRotate(270);
          break;
      }
      if (!m.isIdentity()) {
        Bitmap changed = Bitmap.createBitmap(
          b,
          0,
          0,
          b.getWidth(),
          b.getHeight(),
          m,
          true
        );
        if (changed != b) {
          b.recycle();
          b = changed;
        }
      }
      saveBitmap(b, out);
      float ratio = Math.min(1f, 640f / Math.max(b.getWidth(), b.getHeight()));
      Bitmap small = Bitmap.createScaledBitmap(
        b,
        Math.max(1, Math.round(b.getWidth() * ratio)),
        Math.max(1, Math.round(b.getHeight() * ratio)),
        true
      );
      saveBitmap(small, thumb);
      if (small != b) small.recycle();
    } finally {
      b.recycle();
    }
  }

  private void saveBitmap(Bitmap b, File dest) throws Exception {
    File temp = new File(dest + ".part");
    try (FileOutputStream out = new FileOutputStream(temp)) {
      if (
        !b.compress(Bitmap.CompressFormat.JPEG, 88, out)
      ) throw new IOException();
      out.getFD().sync();
    }
    if (!temp.renameTo(dest)) throw new IOException("预览保存失败");
  }

  public synchronized void cleanup() throws Exception {
    if (exports > 0) return;
    SQLiteDatabase db = getWritableDatabase();
    long cutoff = System.currentTimeMillis() - 86400000L;
    File[] files = originals.listFiles();
    if (files != null) for (File f : files) {
      if (f.lastModified() >= cutoff) continue;
      try (
        Cursor c = db.rawQuery(
          "SELECT 1 FROM refs WHERE attachment_id=? LIMIT 1",
          new String[] { f.getName() }
        )
      ) {
        if (c.moveToFirst()) continue;
      }
      if (f.delete()) {
        new File(previews, f.getName() + ".jpg").delete();
        new File(previews, f.getName() + "-thumb.jpg").delete();
        db.delete("attachments", "id=?", new String[] { f.getName() });
      }
    }
    files = staging.listFiles();
    if (files != null) for (File f : files)
      if (f.isFile() && f.lastModified() < cutoff) f.delete();
  }

  public void exportZip(OutputStream destination) throws Exception {
    JSONObject manifest;
    JSONArray attachments = new JSONArray();
    synchronized (this) {
      SQLiteDatabase db = getReadableDatabase();
      manifest = new JSONObject()
        .put("format", "todotree-journal")
        .put("schema_version", 1)
        .put("exported_at", now())
        .put("entries", all(db, "entries"))
        .put("books", all(db, "books"))
        .put("drafts", all(db, "drafts"));
      try (
        Cursor c = db.rawQuery(
          "SELECT DISTINCT attachments.body FROM attachments JOIN refs ON attachments.id=refs.attachment_id",
          null
        )
      ) {
        while (c.moveToNext()) attachments.put(new JSONObject(c.getString(0)));
      }
      manifest.put("attachments", attachments);
      exports++;
    }
    try (ZipOutputStream zip = new ZipOutputStream(destination)) {
      zip.putNextEntry(new ZipEntry("manifest.json"));
      zip.write(manifest.toString().getBytes(StandardCharsets.UTF_8));
      zip.closeEntry();
      for (int i = 0; i < attachments.length(); i++) {
        String id = attachments.getJSONObject(i).getString("id");
        File f = new File(originals, id);
        if (!f.isFile() || !sha(f).equals(id)) throw new IOException(
          "图片缺失或损坏，备份未完成"
        );
        zip.putNextEntry(new ZipEntry("media/" + id));
        try (InputStream in = new FileInputStream(f)) {
          copy(in, zip, IMAGE_LIMIT);
        }
        zip.closeEntry();
      }
    } finally {
      synchronized (this) {
        exports--;
      }
    }
  }

  public JSONObject importZip(InputStream input) throws Exception {
    File folder = new File(staging, "backup-" + UUID.randomUUID());
    if (!folder.mkdir()) throw new IOException();
    Set<String> names = new HashSet<>();
    long total = 0;
    try {
      try (ZipInputStream zip = new ZipInputStream(input)) {
        ZipEntry entry;
        while ((entry = zip.getNextEntry()) != null) {
          String name = entry.getName();
          if (
            !names.add(name) ||
            entry.isDirectory() ||
            !(
              name.equals("manifest.json") || name.matches("media/[0-9a-f]{64}")
            )
          ) throw new IOException("备份包含非法路径或重复文件");
          File dest = new File(
            folder,
            name.equals("manifest.json") ? name : name.substring(6)
          );
          try (FileOutputStream out = new FileOutputStream(dest)) {
            total += copy(
              zip,
              out,
              name.equals("manifest.json") ? 64L * 1024 * 1024 : IMAGE_LIMIT
            );
            out.getFD().sync();
          }
          if (total > 10L * 1024 * 1024 * 1024) throw new IOException(
            "备份超过 10 GiB"
          );
          zip.closeEntry();
        }
      }
      File mf = new File(folder, "manifest.json");
      if (!mf.isFile()) throw new IOException("缺少备份清单");
      JSONObject manifest;
      try (
        InputStream in = new FileInputStream(mf);
        ByteArrayOutputStream bytes = new ByteArrayOutputStream()
      ) {
        copy(in, bytes, 64L * 1024 * 1024);
        manifest = new JSONObject(bytes.toString("UTF-8"));
      }
      if (
        !manifest.optString("format").equals("todotree-journal") ||
        manifest.optInt("schema_version") != 1
      ) throw new IOException("不是支持的手帐备份");
      JSONArray media = manifest.getJSONArray("attachments");
      Set<String> ids = new HashSet<>();
      for (int i = 0; i < media.length(); i++) {
        JSONObject a = media.getJSONObject(i);
        String id = a.getString("id");
        if (!id.matches("[0-9a-f]{64}") || !ids.add(id)) throw new IOException(
          "图片清单无效"
        );
        File f = new File(folder, id);
        if (
          !f.isFile() ||
          f.length() != a.getLong("byte_size") ||
          !sha(f).equals(id)
        ) throw new IOException("备份图片缺失或校验失败");
      }
      if (names.size() != ids.size() + 1) throw new IOException(
        "备份包含未声明附件"
      );
      for (String collection : new String[] { "entries", "drafts" }) {
        JSONArray records = manifest.getJSONArray(collection);
        Set<String> unique = new HashSet<>();
        for (int i = 0; i < records.length(); i++) {
          JSONObject record = records.getJSONObject(i),
            e = collection.equals("drafts")
              ? record.getJSONObject("entry")
              : record;
          validate(e, collection.equals("entries"));
          if (!unique.add(record.getString("id"))) throw new IOException(
            "备份记录重复"
          );
          for (int k = 0; k < array(e, "images").length(); k++) if (
            !ids.contains(array(e, "images").getString(k))
          ) throw new IOException("备份附件引用缺失");
        }
      }
      File checkpoint = new File(root, "before-import.zip"),
        temp = new File(root, "before-import.zip.part");
      try (FileOutputStream out = new FileOutputStream(temp)) {
        exportZip(out);
      }
      if (!temp.renameTo(checkpoint)) throw new IOException(
        "无法建立恢复检查点"
      );
      synchronized (this) {
        SQLiteDatabase db = getWritableDatabase();
        String operation = "import-" + sha(mf);
        try (
          Cursor c = db.rawQuery(
            "SELECT result FROM operations WHERE id=?",
            new String[] { operation }
          )
        ) {
          if (c.moveToFirst()) return new JSONObject(c.getString(0));
        }
        db.beginTransaction();
        int added = 0,
          conflicts = 0;
        try {
          for (int i = 0; i < media.length(); i++) {
            JSONObject a = media.getJSONObject(i);
            String id = a.getString("id");
            File dest = new File(originals, id);
            if (
              !dest.exists() && !new File(folder, id).renameTo(dest)
            ) throw new IOException("图片恢复失败");
            writeBody(db, "attachments", a);
          }
          Map<String, String> booksMap = new HashMap<>();
          JSONArray books = manifest.getJSONArray("books");
          for (int i = 0; i < books.length(); i++) {
            JSONObject b = books.getJSONObject(i);
            String id = b.getString("id");
            JSONObject existing = get(db, "books", id);
            if (id.equals("daily")) continue;
            if (
              existing != null &&
              !existing.optString("name").equals(b.optString("name"))
            ) {
              b.put("id", UUID.randomUUID().toString());
              booksMap.put(id, b.getString("id"));
            }
            JSONArray cover = new JSONArray();
            if (ids.contains(text(b, "cover_attachment_id"))) cover.put(
              b.getString("cover_attachment_id")
            );
            else b.remove("cover_attachment_id");
            writeBody(db, "books", b);
            refs(db, b.getString("id"), "book", cover);
          }
          Map<String, String> entryMap = new HashMap<>();
          JSONArray entries = manifest.getJSONArray("entries");
          for (int i = 0; i < entries.length(); i++) {
            JSONObject e = entries.getJSONObject(i);
            String id = e.getString("id");
            JSONObject existing = get(db, "entries", id);
            if (
              existing != null && existing.toString().equals(e.toString())
            ) continue;
            if (existing != null) {
              e.put("id", UUID.randomUUID().toString());
              String title = text(e, "title");
              e.put(
                "title",
                title.substring(0, Math.min(90, title.length())) +
                  "（备份副本）"
              );
              entryMap.put(id, e.getString("id"));
              conflicts++;
            }
            if (booksMap.containsKey(e.optString("book_id"))) e.put(
              "book_id",
              booksMap.get(e.getString("book_id"))
            );
            putEntry(db, e);
            added++;
          }
          JSONArray drafts = manifest.getJSONArray("drafts");
          for (int i = 0; i < drafts.length(); i++) {
            JSONObject d = drafts.getJSONObject(i),
              e = d.getJSONObject("entry");
            JSONObject old = get(db, "drafts", d.getString("id"));
            if (old != null && old.toString().equals(d.toString())) continue;
            if (old != null) d.put("id", UUID.randomUUID().toString());
            if (entryMap.containsKey(e.getString("id"))) e.put(
              "id",
              entryMap.get(e.getString("id"))
            );
            if (booksMap.containsKey(e.optString("book_id"))) e.put(
              "book_id",
              booksMap.get(e.getString("book_id"))
            );
            ContentValues v = new ContentValues();
            v.put("id", d.getString("id"));
            v.put("body", d.toString());
            v.put("updated_at", d.optString("updated_at", now()));
            db.insertWithOnConflict(
              "drafts",
              null,
              v,
              SQLiteDatabase.CONFLICT_REPLACE
            );
            refs(db, d.getString("id"), "draft", array(e, "images"));
          }
          JSONObject result = new JSONObject()
            .put("added", added)
            .put("conflicts", conflicts);
          ContentValues op = new ContentValues();
          op.put("id", operation);
          op.put("result", result.toString());
          db.insertOrThrow("operations", null, op);
          db.setTransactionSuccessful();
          return result;
        } finally {
          db.endTransaction();
        }
      }
    } finally {
      File[] files = folder.listFiles();
      if (files != null) for (File f : files) f.delete();
      folder.delete();
    }
  }
}
