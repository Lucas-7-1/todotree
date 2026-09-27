using System;
using System.IO;
using System.Text;
using System.Collections;
using System.Collections.Generic;
using System.Web.Script.Serialization;

namespace TodoTreeHost
{
    // One file replacement commits task state and its history together.
    internal sealed class DurableWorkspace
    {
        internal readonly string DirectoryPath;
        private readonly string file;
        private readonly object gate = new object();
        private readonly JavaScriptSerializer json = new JavaScriptSerializer { MaxJsonLength = Int32.MaxValue, RecursionLimit = 256 };
        private string recoveryError;
        internal bool Ready { get { return recoveryError == null; } }
        private readonly List<string> candidates = new List<string>();
        private static readonly string[] names = { "tasks.json", "task_events.json", "settings.json", "ai_settings.json", "reports.json", "ai_attempts.json" };
        private static readonly string[] keys = { "tasks", "events", "settings", "ai_settings", "reports", "attempts" };

        internal DurableWorkspace(string directory, string legacyDirectory)
        {
            DirectoryPath = directory;
            Directory.CreateDirectory(directory);
            file = Path.Combine(directory, "workspace.json");
            try
            {
                if (File.Exists(file)) { ReadValid(file); return; }
                if (File.Exists(file + ".bak") || Directory.GetFiles(directory, "workspace.json.*.tmp").Length > 0 || (Directory.Exists(Path.Combine(directory, "backups")) && Directory.GetFiles(Path.Combine(directory, "backups"), "*.json").Length > 0)) throw new InvalidDataException("主文件缺失，发现备份，请选择恢复点");
                Dictionary<string, object> local = ReadLegacy(directory);
                Dictionary<string, object> old = String.Equals(Path.GetFullPath(directory), Path.GetFullPath(legacyDirectory), StringComparison.OrdinalIgnoreCase) ? null : ReadLegacy(legacyDirectory);
                if (local != null && old != null && json.Serialize(local) != json.Serialize(old))
                {
                    candidates.Add(directory); candidates.Add(legacyDirectory);
                    throw new InvalidDataException("发现两套不同的旧版数据，请选择迁移来源；原文件均已保留");
                }
                Dictionary<string, object> data = local ?? old ?? EmptyData();
                Dictionary<string, object> initial = Envelope(data, 0, "migration");
                if (local != null || old != null) BackupLegacy(local != null ? directory : legacyDirectory);
                WriteAtomic(file, json.Serialize(initial));
            }
            catch (Exception ex) { recoveryError = ex.Message; }
        }

        private Dictionary<string, object> EmptyData()
        {
            var data = new Dictionary<string, object>();
            for (int i = 0; i < keys.Length; i++) data[keys[i]] = i == 2 || i == 3 ? (object)new Dictionary<string, object>() : new object[0];
            return data;
        }
        private Dictionary<string, object> ReadLegacy(string directory)
        {
            bool exists = false;
            var data = EmptyData();
            for (int i = 0; i < names.Length; i++)
            {
                string path = Path.Combine(directory, names[i]);
                if (File.Exists(path)) { exists = true; data[keys[i]] = json.DeserializeObject(File.ReadAllText(path, Encoding.UTF8)); }
                else if (File.Exists(path + ".bak")) throw new InvalidDataException("旧版主文件缺失但存在备份：" + path);
            }
            if (!exists) return null;
            ValidateData(data);
            return data;
        }
        private void BackupLegacy(string source)
        {
            string dest = Path.Combine(DirectoryPath, "backups", "migration-" + DateTime.UtcNow.ToString("yyyyMMdd-HHmmss-ffff"));
            Directory.CreateDirectory(dest);
            foreach (string name in names) if (File.Exists(Path.Combine(source, name))) File.Copy(Path.Combine(source, name), Path.Combine(dest, name));
        }
        private Dictionary<string, object> Envelope(Dictionary<string, object> data, long revision, string operation)
        {
            return new Dictionary<string, object> { { "schema_version", 2 }, { "revision", revision }, { "operation_id", operation }, { "saved_at", DateTime.UtcNow.ToString("o") }, { "data", data } };
        }
        private static IList ArrayField(Dictionary<string, object> data, string key)
        {
            object value;
            if (!data.TryGetValue(key, out value) || !(value is IList)) throw new InvalidDataException("缺失列表：" + key);
            return (IList)value;
        }
        private void ValidateData(Dictionary<string, object> data)
        {
            foreach (string key in new[] { "events", "reports", "attempts" }) ArrayField(data, key);
            foreach (string key in new[] { "settings", "ai_settings" })
                if (!data.ContainsKey(key) || !(data[key] is Dictionary<string, object>)) throw new InvalidDataException("缺失设置：" + key);
            var ids = new Dictionary<string, Dictionary<string, object>>();
            foreach (object item in ArrayField(data, "tasks"))
            {
                var task = item as Dictionary<string, object>;
                if (task == null || !task.ContainsKey("id") || !(task["id"] is string) || !task.ContainsKey("title") || !(task["title"] is string) || !task.ContainsKey("status") || !task.ContainsKey("parent_id")) throw new InvalidDataException("任务结构不完整");
                string id = (string)task["id"];
                string status = Convert.ToString(task["status"]);
                if (id.Length == 0 || ids.ContainsKey(id) || (status != "open" && status != "done")) throw new InvalidDataException("任务 ID 或状态非法");
                ids.Add(id, task);
            }
            foreach (var pair in ids)
            {
                var visited = new HashSet<string>(); visited.Add(pair.Key);
                string parent = Convert.ToString(pair.Value["parent_id"]);
                while (parent.Length > 0)
                {
                    if (!ids.ContainsKey(parent) || !visited.Add(parent) || visited.Count > 5) throw new InvalidDataException("父子关系不合法");
                    parent = Convert.ToString(ids[parent]["parent_id"]);
                }
            }
            foreach (object item in ArrayField(data, "events"))
            {
                var entry = item as Dictionary<string, object>;
                if (entry == null || !entry.ContainsKey("event_id") || !entry.ContainsKey("task_id") || !entry.ContainsKey("event_type")) throw new InvalidDataException("历史事件损坏");
            }
        }
        private Dictionary<string, object> ReadValid(string path)
        {
            var value = json.DeserializeObject(File.ReadAllText(path, Encoding.UTF8)) as Dictionary<string, object>;
            if (value == null || !value.ContainsKey("schema_version") || Convert.ToInt32(value["schema_version"]) != 2 || !value.ContainsKey("revision") || Convert.ToInt64(value["revision"]) < 0 || !value.ContainsKey("data")) throw new InvalidDataException("存储版本或结构不合法");
            ValidateData((Dictionary<string, object>)value["data"]);
            return value;
        }
        internal string Read()
        {
            lock (gate)
            {
                if (recoveryError != null) throw new InvalidDataException(recoveryError);
                try { return json.Serialize(ReadValid(file)); }
                catch (Exception ex) { recoveryError = ex.Message; throw; }
            }
        }
        internal string Commit(string body)
        {
            lock (gate)
            {
                var current = json.DeserializeObject(Read()) as Dictionary<string, object>;
                var op = json.DeserializeObject(body) as Dictionary<string, object>;
                if (op == null || !op.ContainsKey("operation_id") || !op.ContainsKey("expected_revision") || !op.ContainsKey("data")) throw new InvalidDataException("写入请求不完整");
                string operation = Convert.ToString(op["operation_id"]);
                long expected = Convert.ToInt64(op["expected_revision"]);
                if (operation.Length == 0) throw new InvalidDataException("操作编号不能为空");
                if (Convert.ToString(current["operation_id"]) == operation)
                {
                    if (Convert.ToInt64(current["revision"]) != expected + 1 || json.Serialize(current["data"]) != json.Serialize(op["data"])) throw new InvalidOperationException("操作编号重复但数据不同");
                    return json.Serialize(current);
                }
                if (Convert.ToInt64(current["revision"]) != expected) throw new InvalidOperationException("数据版本冲突，未覆盖磁盘数据。请导出待恢复副本后重新加载");
                var data = op["data"] as Dictionary<string, object>;
                if (data == null) throw new InvalidDataException("数据为空");
                ValidateData(data);
                DailyBackup();
                string next = json.Serialize(Envelope(data, expected + 1, operation));
                WriteAtomic(file, next);
                return next;
            }
        }
        internal static void WriteAtomic(string path, string body)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(path));
            string temp = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
            try
            {
                byte[] bytes = new UTF8Encoding(false).GetBytes(body);
                using (var stream = new FileStream(temp, FileMode.CreateNew, FileAccess.Write, FileShare.None))
                { stream.Write(bytes, 0, bytes.Length); stream.Flush(true); }
                if (File.Exists(path)) File.Replace(temp, path, path + ".bak", true);
                else File.Move(temp, path);
            }
            finally { if (File.Exists(temp)) File.Delete(temp); }
        }
        private void DailyBackup()
        {
            string dir = Path.Combine(DirectoryPath, "backups"); Directory.CreateDirectory(dir);
            string target = Path.Combine(dir, "daily-" + DateTime.UtcNow.ToString("yyyyMMdd") + ".json");
            if (!File.Exists(target)) WriteAtomic(target, Read());
            string[] files = Directory.GetFiles(dir, "daily-*.json"); Array.Sort(files, StringComparer.Ordinal);
            for (int i = 0; i < files.Length - 14; i++) File.Delete(files[i]);
        }
        internal void Checkpoint()
        {
            lock (gate) { WriteAtomic(Path.Combine(DirectoryPath, "backups", "checkpoint-" + DateTime.UtcNow.ToString("yyyyMMdd-HHmmss-ffff") + ".json"), Read()); }
        }
        internal string Diagnostics()
        {
            lock (gate)
            {
                var backups = new List<object>();
                string dir = Path.Combine(DirectoryPath, "backups");
                var paths = new List<string>();
                if (File.Exists(file + ".bak")) paths.Add(file + ".bak");
                paths.AddRange(Directory.GetFiles(DirectoryPath, "workspace.json.*.tmp"));
                if (Directory.Exists(dir)) paths.AddRange(Directory.GetFiles(dir, "*.json"));
                foreach (string path in paths)
                {
                    try { var value = ReadValid(path); backups.Add(new { name = Path.GetFileName(path), revision = value["revision"], saved_at = value["saved_at"], task_count = ArrayField((Dictionary<string, object>)value["data"], "tasks").Count }); } catch { }
                }
                var migrations = new List<object>();
                for (int i = 0; i < candidates.Count; i++)
                {
                    var data = ReadLegacy(candidates[i]);
                    migrations.Add(new { index = i, path = candidates[i], task_count = ArrayField(data, "tasks").Count, last_write = File.Exists(Path.Combine(candidates[i], "tasks.json")) ? File.GetLastWriteTimeUtc(Path.Combine(candidates[i], "tasks.json")).ToString("o") : "" });
                }
                return json.Serialize(new { directory = DirectoryPath, error = recoveryError, backups = backups, migrations = migrations });
            }
        }
        internal void Recover(string body)
        {
            lock (gate)
            {
                var choice = json.DeserializeObject(body) as Dictionary<string, object>;
                Dictionary<string, object> value;
                if (choice.ContainsKey("migration"))
                {
                    int index = Convert.ToInt32(choice["migration"]);
                    if (index < 0 || index >= candidates.Count) throw new InvalidDataException("无效迁移来源");
                    BackupLegacy(candidates[index]);
                    value = Envelope(ReadLegacy(candidates[index]), 0, "migration-" + Guid.NewGuid().ToString("N"));
                }
                else
                {
                    string name = Convert.ToString(choice["backup"]);
                    if (Path.GetFileName(name) != name) throw new InvalidDataException("无效备份名称");
                    string path = name == "workspace.json.bak" || (name.StartsWith("workspace.json.") && name.EndsWith(".tmp")) ? Path.Combine(DirectoryPath, name) : Path.Combine(DirectoryPath, "backups", name);
                    value = ReadValid(path);
                    // Restore is a new version. Preserve the old file, including corrupt bytes.
                    long revision = Convert.ToInt64(value["revision"]);
                    try { revision = Math.Max(revision, Convert.ToInt64(ReadValid(file)["revision"])); } catch { }
                    value = Envelope((Dictionary<string, object>)value["data"], revision + 1, "restore-" + Guid.NewGuid().ToString("N"));
                }
                if (File.Exists(file)) File.Copy(file, file + ".recovery-" + DateTime.UtcNow.ToString("yyyyMMdd-HHmmss-ffff"));
                WriteAtomic(file, json.Serialize(value)); recoveryError = null; candidates.Clear();
            }
        }
    }
}
