using System;
using System.IO;
using System.Collections.Generic;
using System.Web.Script.Serialization;
using TodoTreeHost;

class HostPersistenceTests
{
    static JavaScriptSerializer json = new JavaScriptSerializer();
    static int count;
    static void Check(bool value, string name) { if (!value) throw new Exception(name); count++; Console.WriteLine("PASS " + name); }
    static Dictionary<string, object> Parse(string text) { return (Dictionary<string, object>)json.DeserializeObject(text); }
    static string Operation(Dictionary<string, object> current, string id) { return json.Serialize(new { operation_id = id, expected_revision = current["revision"], data = current["data"] }); }
    static void Main()
    {
        string root = Path.Combine(Path.GetTempPath(), "todotree-tests-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        try
        {
            string data = Path.Combine(root, "data"), legacy = Path.Combine(root, "legacy");
            Directory.CreateDirectory(legacy);
            File.WriteAllText(Path.Combine(legacy, "tasks.json"), "[{\"id\":\"a\",\"parent_id\":null,\"title\":\"A\",\"status\":\"open\"}]");
            var store = new DurableWorkspace(data, legacy);
            var initial = Parse(store.Read());
            Check(Convert.ToInt64(initial["revision"]) == 0, "legacy migrated to fixed directory");
            Check(File.Exists(Path.Combine(legacy, "tasks.json")), "migration preserves original");
            string op = Operation(initial, "first");
            string committed = store.Commit(op);
            Check(Convert.ToInt64(Parse(committed)["revision"]) == 1, "revision increments");
            Check(store.Commit(op) == committed, "idempotent retry");
            bool conflict = false; try { store.Commit(Operation(initial, "stale")); } catch (InvalidOperationException) { conflict = true; }
            Check(conflict && store.Read() == committed, "stale write rejected without changing file");
            bool invalid = false; try { store.Commit("{\"expected_revision\":1,\"operation_id\":\"bad\",\"data\":{}}"); } catch (InvalidDataException) { invalid = true; }
            Check(invalid && store.Read() == committed, "invalid data preserves valid file");
            Check(File.Exists(Path.Combine(data, "workspace.json.bak")), "atomic replace preserves previous snapshot");
            store.Checkpoint();
            Check(Directory.GetFiles(Path.Combine(data, "backups"), "checkpoint-*.json").Length == 1, "checkpoint created");
            Check(Directory.GetFiles(Path.Combine(data, "backups"), "daily-*.json").Length == 1, "daily backup created once");
            var reopened = new DurableWorkspace(data, Path.Combine(root, "moved-exe"));
            Check(reopened.Read() == committed, "moving executable does not change workspace");
            File.WriteAllText(Path.Combine(data, "workspace.json"), "corrupted");
            var broken = new DurableWorkspace(data, legacy);
            bool blocked = false; try { broken.Read(); } catch (InvalidDataException) { blocked = true; }
            Check(blocked && File.ReadAllText(Path.Combine(data, "workspace.json")) == "corrupted", "corruption blocks initialization and preserves bytes");
            broken.Recover("{\"backup\":\"workspace.json.bak\"}");
            Check(Parse(broken.Read()).ContainsKey("data"), "validated backup restores workspace");
            Check(Directory.GetFiles(data, "workspace.json.recovery-*").Length == 1, "recovery retains damaged original");
            string conflictData = Path.Combine(root, "conflict"); Directory.CreateDirectory(conflictData);
            File.WriteAllText(Path.Combine(conflictData, "tasks.json"), "[]");
            var migration = new DurableWorkspace(conflictData, legacy);
            Check(Parse(migration.Diagnostics())["error"] != null, "different legacy copies require selection");
            Check(!File.Exists(Path.Combine(conflictData, "workspace.json")), "migration conflict does not overwrite either copy");
            migration.Recover("{\"migration\":1}");
            Check(Parse(migration.Read()).ContainsKey("data"), "explicit migration selection succeeds");
            Console.WriteLine(count + " host assertions passed");
        }
        finally { Directory.Delete(root, true); }
    }
}
