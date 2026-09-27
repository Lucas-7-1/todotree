package com.lucas.todotree;

import android.app.Activity;
import android.content.*;
import android.net.Uri;
import android.provider.MediaStore;
import androidx.activity.result.ActivityResult;
import androidx.core.content.FileProvider;
import com.getcapacitor.*;
import com.getcapacitor.annotation.*;
import java.io.*;
import java.util.*;
import java.util.concurrent.*;
import org.json.*;

@CapacitorPlugin(name = "Journal")
public class JournalPlugin extends Plugin {

  private JournalStore store;
  private final ExecutorService disk = Executors.newSingleThreadExecutor(),
    files = Executors.newSingleThreadExecutor();

  @Override
  public void load() {
    store = new JournalStore(getContext());
    disk.execute(() -> {
      try {
        store.cleanup();
      } catch (Exception ignored) {}
    });
  }

  private JSObject object(JSONObject o) throws Exception {
    return new JSObject(o.toString());
  }

  private void reject(PluginCall c, Exception e) {
    c.reject(
      e.getMessage() == null ? "手帐操作失败，原记录已保留" : e.getMessage(),
      "JOURNAL_FAILED"
    );
  }

  @PluginMethod
  public void command(PluginCall call) {
    disk.execute(() -> {
      try {
        call.resolve(object(store.command(call.getData())));
      } catch (Exception e) {
        reject(call, e);
      }
    });
  }

  @PluginMethod
  public void media(PluginCall call) {
    files.execute(() -> {
      try {
        call.resolve(object(store.media(call.getString("id", ""))));
      } catch (Exception e) {
        reject(call, e);
      }
    });
  }

  @PluginMethod
  public void pickImages(PluginCall call) {
    try {
      if (call.getBoolean("camera", false)) {
        File photo = File.createTempFile(
          "journal-camera-",
          ".jpg",
          getContext().getCacheDir()
        );
        call.getData().put("camera_path", photo.getAbsolutePath());
        Uri uri = FileProvider.getUriForFile(
          getContext(),
          getContext().getPackageName() + ".fileprovider",
          photo
        );
        Intent intent = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
        intent.putExtra(MediaStore.EXTRA_OUTPUT, uri);
        intent.addFlags(
          Intent.FLAG_GRANT_READ_URI_PERMISSION |
            Intent.FLAG_GRANT_WRITE_URI_PERMISSION
        );
        intent.setClipData(ClipData.newRawUri("photo", uri));
        startActivityForResult(call, intent, "picked");
      } else {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("image/*");
        intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        startActivityForResult(call, intent, "picked");
      }
    } catch (Exception e) {
      reject(call, new Exception("无法打开相机或相册，可继续文字记录"));
    }
  }

  @ActivityCallback
  private void picked(PluginCall call, ActivityResult result) {
    if (call == null) return;
    if (result.getResultCode() != Activity.RESULT_OK) {
      String camera = call.getString("camera_path");
      if (camera != null) new File(camera).delete();
      JSObject out = new JSObject();
      out.put("cancelled", true);
      call.resolve(out);
      return;
    }
    files.execute(() -> {
      try {
        List<Uri> uris = new ArrayList<>();
        String camera = call.getString("camera_path");
        if (camera != null) uris.add(Uri.fromFile(new File(camera)));
        else if (result.getData() != null) {
          Intent intent = result.getData();
          if (intent.getClipData() != null) for (
            int i = 0;
            i < intent.getClipData().getItemCount();
            i++
          ) uris.add(intent.getClipData().getItemAt(i).getUri());
          else if (intent.getData() != null) uris.add(intent.getData());
        }
        int limit = Math.max(0, Math.min(20, call.getInt("limit", 20)));
        JSONArray images = new JSONArray(),
          errors = new JSONArray();
        for (int i = 0; i < uris.size(); i++) {
          if (i >= limit) {
            errors.put("最多可再添加 " + limit + " 张图片，其余未导入");
            break;
          }
          JSObject progress = new JSObject();
          progress.put("done", i);
          progress.put("total", Math.min(limit, uris.size()));
          notifyListeners("importProgress", progress);
          try (
            InputStream in = getContext()
              .getContentResolver()
              .openInputStream(uris.get(i))
          ) {
            if (in == null) throw new IOException("无法读取图片");
            JSONObject image = store.importImage(in);
            String draftId = call.getString("draft_id", "");
            // Pin each imported original in the durable draft before acknowledging it to JS.
            if (!draftId.isEmpty()) store.attachToDraft(
              draftId,
              image.getString("id")
            );
            images.put(image);
          } catch (Exception e) {
            errors.put(
              "第 " +
                (i + 1) +
                " 张：" +
                (e.getMessage() == null ? "导入失败" : e.getMessage())
            );
          }
        }
        if (camera != null) new File(camera).delete();
        JSObject out = new JSObject();
        out.put("images", images);
        out.put("errors", errors);
        call.resolve(out);
      } catch (Exception e) {
        reject(call, e);
      }
    });
  }

  @PluginMethod
  public void exportBackup(PluginCall call) {
    Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT);
    i.addCategory(Intent.CATEGORY_OPENABLE);
    i.setType("application/zip");
    i.putExtra(
      Intent.EXTRA_TITLE,
      "TodoTree-Journal-" +
        new java.text.SimpleDateFormat("yyyyMMdd-HHmm", Locale.US).format(
          new Date()
        ) +
        ".zip"
    );
    startActivityForResult(call, i, "exported");
  }

  @ActivityCallback
  private void exported(PluginCall call, ActivityResult r) {
    if (call == null) return;
    if (r.getResultCode() != Activity.RESULT_OK || r.getData() == null) {
      JSObject o = new JSObject();
      o.put("cancelled", true);
      call.resolve(o);
      return;
    }
    files.execute(() -> {
      try (
        OutputStream out = getContext()
          .getContentResolver()
          .openOutputStream(r.getData().getData(), "wt")
      ) {
        if (out == null) throw new IOException("无法写入文件");
        store.exportZip(out);
        call.resolve(new JSObject());
      } catch (Exception e) {
        reject(
          call,
          new Exception("备份未完成，请重新导出：" + e.getMessage())
        );
      }
    });
  }

  @PluginMethod
  public void importBackup(PluginCall call) {
    Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
    i.addCategory(Intent.CATEGORY_OPENABLE);
    i.setType("*/*");
    startActivityForResult(call, i, "imported");
  }

  @ActivityCallback
  private void imported(PluginCall call, ActivityResult r) {
    if (call == null) return;
    if (r.getResultCode() != Activity.RESULT_OK || r.getData() == null) {
      JSObject o = new JSObject();
      o.put("cancelled", true);
      call.resolve(o);
      return;
    }
    files.execute(() -> {
      try (
        InputStream in = getContext()
          .getContentResolver()
          .openInputStream(r.getData().getData())
      ) {
        if (in == null) throw new IOException("无法读取备份");
        call.resolve(object(store.importZip(in)));
      } catch (Exception e) {
        reject(call, e);
      }
    });
  }

  @PluginMethod
  public void openOriginal(PluginCall call) {
    files.execute(() -> {
      try {
        JSONObject m = store.media(call.getString("id", ""));
        Uri uri = FileProvider.getUriForFile(
          getContext(),
          getContext().getPackageName() + ".fileprovider",
          new File(Uri.parse(m.getString("original")).getPath())
        );
        Intent i = new Intent(Intent.ACTION_VIEW);
        i.setDataAndType(uri, m.getString("mime_type"));
        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        getActivity().runOnUiThread(() -> {
          try {
            getActivity().startActivity(i);
            call.resolve();
          } catch (Exception e) {
            call.reject("没有可打开原图的应用，可在手帐内缩放查看");
          }
        });
      } catch (Exception e) {
        reject(call, e);
      }
    });
  }

  @Override
  protected void handleOnDestroy() {
    files.shutdown();
    disk.shutdown(); /* Queued writes finish before SQLite closes; process teardown owns remaining handles. */
  }
}
