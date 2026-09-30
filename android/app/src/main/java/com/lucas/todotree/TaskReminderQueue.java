package com.lucas.todotree;

import android.content.*;
import android.database.*;
import android.database.sqlite.*;
import java.util.*;
import org.json.*;

/** Registration intent is committed atomically with task facts; recovery is bounded. */
final class TaskReminderQueue {
  static void ensure(SQLiteDatabase db) {
    db.execSQL("CREATE TABLE IF NOT EXISTS reminder_queue (task_id TEXT PRIMARY KEY, workspace_revision INTEGER NOT NULL)");
  }
  static void enqueue(SQLiteDatabase db, String id, long revision) {
    ensure(db); ContentValues values = new ContentValues(); values.put("task_id", id); values.put("workspace_revision", revision);
    db.insertWithOnConflict("reminder_queue", null, values, SQLiteDatabase.CONFLICT_REPLACE);
  }
  static int drain(Context context) throws Exception {
    if (!context.getDatabasePath("todotree.db").exists()) return 0;
    try (SQLiteDatabase db = SQLiteDatabase.openDatabase(context.getDatabasePath("todotree.db").getPath(), null, SQLiteDatabase.OPEN_READWRITE)) {
      ensure(db); List<String> ids = new ArrayList<>(); List<Long> versions = new ArrayList<>();
      try (Cursor rows = db.rawQuery("SELECT task_id,workspace_revision FROM reminder_queue LIMIT 500", null)) {
        while (rows.moveToNext()) { ids.add(rows.getString(0)); versions.add(rows.getLong(1)); }
      }
      int errors = 0;
      for (int i = 0; i < ids.size(); i++) {
        try {
          JSONObject task = TaskReminderReceiver.readTask(context, ids.get(i));
          if (task == null) TaskReminderReceiver.cancel(context, ids.get(i)); else TaskReminderReceiver.schedule(context, task);
          db.delete("reminder_queue", "task_id=? AND workspace_revision=?", new String[]{ids.get(i), String.valueOf(versions.get(i))});
        } catch (Exception error) { errors++; }
      }
      try (Cursor rows = db.rawQuery("SELECT COUNT(*) FROM reminder_queue", null)) { rows.moveToFirst(); return rows.getInt(0); }
    }
  }
}
