package com.lucas.todotree;

import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import java.util.*;
import org.json.*;

/** Journal-only relationships. No task completion or priority logic. */
final class JournalTree {
  private final JournalStore store;
  private final SQLiteDatabase db;
  private Map<String, JSONObject> graph;
  JournalTree(JournalStore store, SQLiteDatabase db) { this.store=store; this.db=db; }
  private String parent(JSONObject e) { return JournalStore.text(e,"parent_id"); }
  private boolean deleted(JSONObject e) { return !JournalStore.text(e,"deleted_at").isEmpty(); }
  static void normalize(JSONObject e) throws JSONException {
    if (!e.has("parent_id")) e.put("parent_id",JSONObject.NULL);
    if (!e.has("sort_order")) e.put("sort_order",0);
    if (!e.has("deletion_batch_id")) e.put("deletion_batch_id",JSONObject.NULL);
  }
  private Map<String,JSONObject> graph() throws Exception {
    if(graph!=null) return graph;
    graph=new LinkedHashMap<>();
    try(Cursor c=db.rawQuery("SELECT id,parent_id,book_id,sort_order,version,deleted_at,created_at,deletion_batch_id FROM entries",null)) {
      while(c.moveToNext()) { JSONObject e=new JSONObject().put("id",c.getString(0)).put("parent_id",c.isNull(1)?JSONObject.NULL:c.getString(1)).put("book_id",c.getString(2)).put("sort_order",c.getDouble(3)).put("version",c.getInt(4)).put("deleted_at",c.isNull(5)?JSONObject.NULL:c.getString(5)).put("created_at",c.getString(6)).put("deletion_batch_id",c.isNull(7)?JSONObject.NULL:c.getString(7)); graph.put(e.getString("id"),e); }
    }
    return graph;
  }
  private List<JSONObject> descendants(String id) throws Exception {
    Map<String,List<JSONObject>> children=new HashMap<>();
    for(JSONObject e:graph().values()) children.computeIfAbsent(parent(e),k->new ArrayList<>()).add(e);
    List<JSONObject> out=new ArrayList<>(); Set<String> seen=new HashSet<>();seen.add(id);
    Deque<JSONObject> queue=new ArrayDeque<>(children.getOrDefault(id,Collections.emptyList()));
    while(!queue.isEmpty()) { JSONObject e=queue.removeFirst();String eid=e.getString("id");if(!seen.add(eid))throw new Exception("事件层级存在循环");out.add(e);queue.addAll(children.getOrDefault(eid,Collections.emptyList())); }
    return out;
  }
  static void validateGraph(Map<String,JSONObject> nodes) throws Exception {
    for(JSONObject e:nodes.values()) {
      Set<String> seen=new HashSet<>();seen.add(e.getString("id"));String pid=JournalStore.text(e,"parent_id"); int depth=1;
      while(!pid.isEmpty()) {
        if(!seen.add(pid))throw new Exception("事件层级存在循环");
        JSONObject p=nodes.get(pid);if(p==null)throw new Exception("所属事件不存在："+pid);
        if(!p.getString("book_id").equals(e.getString("book_id")))throw new Exception("父子事件必须属于同一本手帐");
        if(JournalStore.text(e,"deleted_at").isEmpty()&&!JournalStore.text(p,"deleted_at").isEmpty())throw new Exception("所属事件在回收站，请先恢复或移为独立事件");
        if(++depth>5)throw new Exception("事件最多支持 5 层");pid=JournalStore.text(p,"parent_id");
      }
    }
  }
  void validatePublish(JSONObject e, JSONObject old) throws Exception {
    normalize(e); e.remove("path");e.remove("child_count");e.remove("other_date_count");
    if(old!=null && (!parent(old).equals(parent(e))||!old.getString("book_id").equals(e.getString("book_id"))))throw new Exception("请通过移动到调整所属事件或手帐本");
    if(old==null) {
      String clause=parent(e).isEmpty()?"parent_id IS NULL":"parent_id=?";
      String[] args=parent(e).isEmpty()?new String[]{e.getString("book_id")}:new String[]{parent(e),e.getString("book_id")};
      try(Cursor c=db.rawQuery("SELECT COALESCE(MAX(sort_order),0)+1024 FROM entries WHERE "+clause+" AND book_id=?",args)){c.moveToFirst();e.put("sort_order",c.getDouble(0));}
    }
    // Publishing edits content, never relationships. New nodes need only their
    // ancestor chain; avoid scanning 10k records on every keystroke/save.
    String pid=parent(e);int depth=1;Set<String> seen=new HashSet<>();seen.add(e.getString("id"));
    while(!pid.isEmpty()) {
      if(!seen.add(pid))throw new Exception("事件层级存在循环");JSONObject ancestor=JournalStore.get(db,"entries",pid);
      if(ancestor==null||deleted(ancestor))throw new Exception("所属事件不存在或在回收站，请选择独立事件");
      if(!ancestor.getString("book_id").equals(e.getString("book_id")))throw new Exception("父子事件必须属于同一本手帐");
      if(++depth>5)throw new Exception("事件最多支持 5 层");pid=parent(ancestor);
    }
  }
  JSONObject decorate(JSONObject e, boolean snippet) throws Exception {
    normalize(e);String id=e.getString("id");
    try(Cursor c=db.rawQuery("SELECT COUNT(*) FROM entries WHERE parent_id=? AND deleted_at IS NULL",new String[]{id})){c.moveToFirst();e.put("child_count",c.getInt(0));}
    int other=0;
    if(e.optInt("child_count")>0)try(Cursor c=db.rawQuery("WITH RECURSIVE branch(id,event_date,deleted_at) AS (SELECT id,event_date,deleted_at FROM entries WHERE parent_id=? UNION ALL SELECT e.id,e.event_date,e.deleted_at FROM entries e JOIN branch b ON e.parent_id=b.id) SELECT COUNT(*) FROM branch WHERE deleted_at IS NULL AND event_date<>?",new String[]{id,e.getString("event_date")})){c.moveToFirst();other=c.getInt(0);}
    e.put("other_date_count",other);
    JSONArray path=new JSONArray();List<JSONObject> chain=new ArrayList<>();Set<String> seen=new HashSet<>();seen.add(id);String pid=parent(e);
    while(!pid.isEmpty()) { if(!seen.add(pid))throw new Exception("事件层级存在循环"); JSONObject p=JournalStore.get(db,"entries",pid); if(p==null)break;
      String title=JournalStore.text(p,"title");if(title.isEmpty())title=JournalStore.text(p,"description");if(title.isEmpty())title="一段记录";
      chain.add(new JSONObject().put("id",pid).put("title",title.substring(0,Math.min(100,title.length()))).put("event_date",p.getString("event_date")));pid=parent(p);
    }
    for(int i=chain.size()-1;i>=0;i--)path.put(chain.get(i));e.put("path",path);
    if(snippet)for(String key:new String[]{"description","reflection"}){String v=JournalStore.text(e,key);e.put(key,v.substring(0,Math.min(180,v.length())));}
    return e;
  }
  JSONObject children(JSONObject o) throws Exception {
    String pid=JournalStore.text(o,"parent_id");
    String where=(pid.isEmpty()?"parent_id IS NULL":"parent_id=?")+" AND deleted_at IS NULL";List<String> args=new ArrayList<>();if(!pid.isEmpty())args.add(pid);
    if(!JournalStore.text(o,"book_id").isEmpty()){where+=" AND book_id=?";args.add(o.getString("book_id"));}
    String[] params=args.toArray(new String[0]);int count;
    try(Cursor c=db.rawQuery("SELECT COUNT(*) FROM entries WHERE "+where,params)){c.moveToFirst();count=c.getInt(0);}
    String direction=o.optString("direction","asc").equals("desc")?" DESC":" ASC";
    String order=o.optString("sort","event").equals("created")?"created_at"+direction+",id"+direction:"event_date"+direction+",CASE WHEN sort_time='99:99' THEN 1 ELSE 0 END,sort_time"+direction+",created_at,id";
    JSONArray rows=new JSONArray();try(Cursor c=db.query("entries",new String[]{"body"},where,params,null,null,order,Math.max(0,o.optInt("offset"))+",20")) {while(c.moveToNext())rows.put(decorate(new JSONObject(c.getString(0)),true));}
    return new JSONObject().put("entries",rows).put("total",count);
  }
  JSONObject branch(String id) throws Exception {int n=0;for(JSONObject e:descendants(id))if(!deleted(e))n++;return new JSONObject().put("count",n);}
  private JSONObject full(String id) throws Exception {JSONObject e=JournalStore.get(db,"entries",id);if(e==null)throw new Exception("记录不存在");normalize(e);return e;}
  private JSONObject bump(JSONObject e) throws Exception { return new JSONObject(e.toString()).put("version",e.getInt("version")+1).put("updated_at",JournalStore.now()); }
  JSONObject mutate(String action, JSONObject o) throws Exception {
    String id=JournalStore.text(o,"id");String op=o.getString("operation_id");
    LinkedHashMap<String,JSONObject> before=new LinkedHashMap<>(),after=new LinkedHashMap<>();
    JSONObject result=new JSONObject();
    if(action.equals("undo")) {
      JSONObject previous=null;try(Cursor c=db.rawQuery("SELECT result FROM operations WHERE id=?",new String[]{o.getString("undo_id")})){if(c.moveToFirst())previous=new JSONObject(c.getString(0));}
      if(previous==null||previous.optBoolean("undone")||!previous.has("undo_before"))throw new Exception("操作已撤销或不可撤销");
      JSONArray saved=previous.getJSONArray("undo_before");JSONObject versions=previous.getJSONObject("undo_after");
      for(int i=0;i<saved.length();i++){JSONObject old=saved.getJSONObject(i),current=full(old.getString("id"));String key=old.getString("id");if(current.getInt("version")!=versions.getInt(key))throw new Exception("相关记录已修改，请刷新后使用移动或恢复");before.put(key,current);after.put(key,new JSONObject(old.toString()).put("version",current.getInt("version")+1).put("updated_at",JournalStore.now()));}
      previous.put("undone",true);android.content.ContentValues v=new android.content.ContentValues();v.put("result",previous.toString());db.update("operations",v,"id=?",new String[]{o.getString("undo_id")});
    } else {
      JSONObject e=full(id);
      if(!action.equals("purge")&&e.getInt("version")!=o.getInt("expected_version"))throw new Exception("记录已变化，请刷新后操作");
      if(action.equals("move")) {
        if(deleted(e))throw new Exception("请先恢复事件");
        String pid=JournalStore.text(o,"parent_id"),book=o.getString("book_id");
        if(JournalStore.get(db,"books",book)==null)throw new Exception("目标手帐不存在");
        if(!pid.isEmpty()){JSONObject target=full(pid);if(deleted(target)||!target.getString("book_id").equals(book))throw new Exception("目标事件不可用");if(o.has("target_version")&&target.getInt("version")!=o.getInt("target_version"))throw new Exception("目标已变化，请重新选择");}
        List<JSONObject> subtree=descendants(id);subtree.add(0,e);
        for(JSONObject child:subtree) {String key=child.getString("id");if(key.equals(pid))throw new Exception("不能移入自身或自己的细节");if(key.equals(id)||!child.getString("book_id").equals(book)){JSONObject old=full(key);before.put(key,old);after.put(key,bump(old).put("book_id",book));}}
        JSONObject moved=after.get(id);moved.put("parent_id",pid.isEmpty()?JSONObject.NULL:pid);
        List<JSONObject> peers=new ArrayList<>();for(JSONObject peer:graph().values())if(parent(peer).equals(pid)&&!deleted(peer)&&!peer.getString("id").equals(id)&&peer.getString("book_id").equals(book))peers.add(peer);
        peers.sort((a,b)-> {int c=Double.compare(a.optDouble("sort_order"),b.optDouble("sort_order"));if(c==0)c=a.optString("created_at").compareTo(b.optString("created_at"));return c!=0?c:a.optString("id").compareTo(b.optString("id"));});
        int at=peers.size();String beforeId=JournalStore.text(o,"before_id");if(!beforeId.isEmpty()){at=-1;for(int i=0;i<peers.size();i++)if(peers.get(i).getString("id").equals(beforeId))at=i;if(at<0)throw new Exception("排序位置已变化，请重试");}
        double prev=at>0?peers.get(at-1).optDouble("sort_order"):0, next=at<peers.size()?peers.get(at).optDouble("sort_order"):0;
        moved.put("sort_order",at==0?(peers.isEmpty()?1024:next-1024):at==peers.size()?prev+1024:(prev+next)/2);
        if(at>0&&at<peers.size()&&next-prev<0.0001){peers.add(at,moved);for(int i=0;i<peers.size();i++){String key=peers.get(i).getString("id");JSONObject old=full(key);before.putIfAbsent(key,old);after.put(key,(key.equals(id)?moved:bump(old)).put("sort_order",(i+1)*1024));}}
      } else if(action.equals("setCover")) {
        String attachment=o.getString("attachment_id");boolean found=false;JSONArray images=JournalStore.array(e,"images");for(int i=0;i<images.length();i++)if(images.getString(i).equals(attachment))found=true;
        if(!found||deleted(e))throw new Exception("封面必须来自当前事件的照片");before.put(id,e);after.put(id,bump(e).put("cover_attachment_id",attachment));
      } else if(action.equals("delete")) {
        if(deleted(e))throw new Exception("事件已经在回收站");List<JSONObject> affected=new ArrayList<>();affected.add(e);for(JSONObject p:descendants(id))if(!deleted(p))affected.add(full(p.getString("id")));
        if(affected.size()>1&&o.optInt("expected_count",-1)!=affected.size()-1)throw new Exception("细节数量已变化，请重新确认删除");
        for(JSONObject p:affected){String key=p.getString("id");before.put(key,p);after.put(key,bump(p).put("deleted_at",JournalStore.now()).put("deletion_batch_id",op));}
      } else if(action.equals("restore")) {
        if(!deleted(e))throw new Exception("事件已经恢复");List<JSONObject> affected=new ArrayList<>();affected.add(e);String batch=JournalStore.text(e,"deletion_batch_id");
        for(JSONObject p:descendants(id))if(deleted(p)&&!batch.isEmpty()&&batch.equals(JournalStore.text(p,"deletion_batch_id")))affected.add(full(p.getString("id")));
        JSONObject parent=parent(e).isEmpty()?null:JournalStore.get(db,"entries",parent(e));boolean root=parent==null||deleted(parent);String book=e.getString("book_id");if(JournalStore.get(db,"books",book)==null)book="daily";
        for(JSONObject p:affected){String key=p.getString("id");before.put(key,p);JSONObject next=bump(p).put("deleted_at",JSONObject.NULL).put("deletion_batch_id",JSONObject.NULL).put("book_id",book);if(key.equals(id)&&root)next.put("parent_id",JSONObject.NULL);after.put(key,next);}
        result.put("restored_as_root",!parent(e).isEmpty()&&root);
      } else if(action.equals("purge")) {
        List<JSONObject> affected=descendants(id);affected.add(e);for(JSONObject p:affected)if(!deleted(p))throw new Exception("仅回收站记录可永久删除");
        for(JSONObject p:affected){String key=p.getString("id");db.delete("entries","id=?",new String[]{key});db.delete("refs","owner_id=? AND kind='entry'",new String[]{key});}return result;
      }
    }
    Map<String,JSONObject> proposed=new LinkedHashMap<>(graph());proposed.putAll(after);validateGraph(proposed);
    JSONArray saved=new JSONArray();JSONObject versions=new JSONObject();
    for(Map.Entry<String,JSONObject> change:after.entrySet()){String key=change.getKey();store.putEntry(db,change.getValue());saved.put(before.get(key));versions.put(key,change.getValue().getInt("version"));}
    if(after.containsKey(id)){JSONObject e=after.get(id);Iterator<String> keys=e.keys();while(keys.hasNext()){String k=keys.next();result.put(k,e.get(k));}}
    return result.put("operation_id",op).put("count",after.size()).put("undo_before",saved).put("undo_after",versions);
  }
}
