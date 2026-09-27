using System;
using System.IO;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using System.Diagnostics;
using System.Reflection;

[assembly: AssemblyTitle("TodoTree")]
[assembly: AssemblyDescription("TodoTree - 个人树状任务管理工具")]
[assembly: AssemblyProduct("TodoTree")]
[assembly: AssemblyCopyright("Copyright © 2026")]
[assembly: AssemblyVersion("1.2.0.0")]
[assembly: AssemblyFileVersion("1.2.0.0")]

namespace TodoTreeHost
{
    class Program
    {
        private static HttpListener _listener;
        private static bool _isRunning = true;
        private static string _dataDir;
        private static DurableWorkspace _workspace;
        private static string _tasksFilePath;
        private static string _settingsFilePath;
        private static string _eventsFilePath;
        private static string _aiSettingsFilePath;
        private static string _aiReportsFilePath;
        private static string _aiAttemptsFilePath;
        private static string _portFilePath;
        private static DateTime _startTime = DateTime.UtcNow;
        private static DateTime _lastActivity = DateTime.UtcNow;
        private static bool _hasConnected = false;
        private static readonly string _instanceId = Guid.NewGuid().ToString("N");
        private static readonly object _fileLock = new object();

        [STAThread]
        static void Main(string[] args)
        {
            InitDataDirectory();

            bool ownsMutex = false;
            Mutex singleInstanceMutex = null;

            try
            {
                // 1. Single instance check using named Mutex
                singleInstanceMutex = new Mutex(true, @"Local\TodoTree_SingleInstance_Mutex_2026", out ownsMutex);
                if (!ownsMutex)
                {
                    // Another instance is already running
                    CheckAlreadyRunning();
                    return;
                }

                _workspace = new DurableWorkspace(_dataDir, Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "data"));
                int port = GetAvailablePort();
                string serverUrl = string.Format("http://127.0.0.1:{0}/", port);

                File.WriteAllText(_portFilePath, port.ToString());

                StartHttpServer(serverUrl);

                // 2. Launch browser window
                OpenBrowser(serverUrl);

                // 3. Heartbeat lifecycle: stay alive as long as webpage is active
                _startTime = DateTime.UtcNow;
                _lastActivity = DateTime.UtcNow;

                while (_isRunning)
                {
                    Thread.Sleep(1000);

                    if (!_hasConnected)
                    {
                        // Allow up to 90 seconds for initial launch
                        if ((DateTime.UtcNow - _startTime).TotalSeconds > 90)
                        {
                            break;
                        }
                    }
                    else
                    {
                        // Active page pings every 2.5s.
                        // Background tab throttling may delay pings up to 60s.
                        // 120 seconds threshold safely prevents false terminations.
                        if ((DateTime.UtcNow - _lastActivity).TotalSeconds > 120)
                        {
                            break;
                        }
                    }
                }
            }
            catch (Exception ex)
            {
                try
                {
                    string errLog = Path.Combine(_dataDir, "startup_error.log");
                    File.WriteAllText(errLog, ex.ToString());
                }
                catch { }
            }
            finally
            {
                // Only clean port file and release mutex if this instance owns it
                if (ownsMutex)
                {
                    try
                    {
                        if (File.Exists(_portFilePath)) File.Delete(_portFilePath);
                    }
                    catch { }

                    try
                    {
                        if (singleInstanceMutex != null)
                        {
                            singleInstanceMutex.ReleaseMutex();
                            singleInstanceMutex.Close();
                        }
                    }
                    catch { }
                }

                StopHttpServer();
            }
        }

        private static bool CheckAlreadyRunning()
        {
            try
            {
                if (File.Exists(_portFilePath))
                {
                    string savedPortStr = File.ReadAllText(_portFilePath).Trim();
                    int savedPort;
                    if (int.TryParse(savedPortStr, out savedPort) && savedPort > 0 && savedPort < 65536)
                    {
                        string checkUrl = string.Format("http://127.0.0.1:{0}/api/ping", savedPort);
                        HttpWebRequest req = (HttpWebRequest)WebRequest.Create(checkUrl);
                        req.Timeout = 1200;
                        req.Method = "GET";
                        using (HttpWebResponse resp = (HttpWebResponse)req.GetResponse())
                        {
                            if (resp.StatusCode == HttpStatusCode.OK)
                            {
                                OpenBrowser(string.Format("http://127.0.0.1:{0}/", savedPort));
                                return true;
                            }
                        }
                    }
                }
            }
            catch
            {
                // Not responding
            }
            return false;
        }

        private static void OpenBrowser(string url)
        {
            string browser = FindBrowser();
            if (!string.IsNullOrEmpty(browser))
            {
                try
                {
                    ProcessStartInfo psi = new ProcessStartInfo();
                    psi.FileName = browser;
                    psi.Arguments = string.Format(
                        "--app=\"{0}\" --window-size=1280,820 --no-first-run --no-default-browser-check",
                        url
                    );
                    psi.UseShellExecute = false;
                    Process.Start(psi);
                    return;
                }
                catch { }
            }

            try
            {
                Process.Start(url);
            }
            catch { }
        }

        private static void InitDataDirectory()
        {
            string legacyDir = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "data");
            _dataDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "TodoTree", "data");


            _tasksFilePath = Path.Combine(_dataDir, "tasks.json");
            _settingsFilePath = Path.Combine(_dataDir, "settings.json");
            _eventsFilePath = Path.Combine(_dataDir, "task_events.json");
            _aiSettingsFilePath = Path.Combine(_dataDir, "ai_settings.json");
            _aiReportsFilePath = Path.Combine(_dataDir, "reports.json");
            _aiAttemptsFilePath = Path.Combine(_dataDir, "ai_attempts.json");
            _portFilePath = Path.Combine(_dataDir, "port.txt");
        }

        private static int GetAvailablePort()
        {
            TcpListener l = null;
            try
            {
                l = new TcpListener(IPAddress.Loopback, 0);
                l.Start();
                return ((IPEndPoint)l.LocalEndpoint).Port;
            }
            finally
            {
                if (l != null) l.Stop();
            }
        }

        private static void StartHttpServer(string prefix)
        {
            _listener = new HttpListener();
            _listener.Prefixes.Add(prefix);
            _listener.Start();

            Thread listenerThread = new Thread(ListenLoop);
            listenerThread.IsBackground = true;
            listenerThread.Start();
        }

        private static void StopHttpServer()
        {
            _isRunning = false;
            if (_listener != null)
            {
                try
                {
                    _listener.Stop();
                    _listener.Close();
                }
                catch { }
            }
        }

        private static void ListenLoop()
        {
            while (_isRunning && _listener != null && _listener.IsListening)
            {
                try
                {
                    HttpListenerContext ctx = _listener.GetContext();
                    ThreadPool.QueueUserWorkItem(HandleRequest, ctx);
                }
                catch (HttpListenerException)
                {
                    if (!_isRunning) break;
                    Thread.Sleep(20);
                }
                catch (ObjectDisposedException)
                {
                    break;
                }
                catch (Exception)
                {
                    if (!_isRunning) break;
                    Thread.Sleep(20);
                }
            }
        }

        private static void SafeClose(HttpListenerResponse res)
        {
            try
            {
                res.Close();
            }
            catch { }
        }

        private static void HandleRequest(object state)
        {
            HttpListenerContext ctx = (HttpListenerContext)state;
            HttpListenerRequest req = ctx.Request;
            HttpListenerResponse res = ctx.Response;

            _lastActivity = DateTime.UtcNow;
            _hasConnected = true;

            try
            {
                if (req.Headers["Origin"] != null && req.Headers["Origin"] != req.Url.GetLeftPart(UriPartial.Authority))
                { res.StatusCode = 403; SafeClose(res); return; }
                res.Headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
                res.Headers["Access-Control-Allow-Headers"] = "Content-Type";
                res.Headers["Cache-Control"] = "no-cache, no-store, must-revalidate";

                if (req.HttpMethod == "OPTIONS")
                {
                    res.StatusCode = 200;
                    SafeClose(res);
                    return;
                }

                string path = req.Url.AbsolutePath.ToLowerInvariant();

                if (req.HttpMethod == "POST" && (path == "/api/tasks" || path == "/api/events" || path == "/api/settings" || path.StartsWith("/api/ai/")))
                {
                    res.StatusCode = 409;
                    SendJson(res, "{\"error\":\"请关闭旧版窗口，使用新版程序重新打开\"}");
                    return;
                }
                if (path == "/" || path == "/index.html")
                {
                    ServeHtml(res);
                }
                else if (path == "/api/ping")
                {
                    byte[] pong = Encoding.UTF8.GetBytes("{\"status\":\"ok\"}");
                    res.ContentType = "application/json; charset=utf-8";
                    res.OutputStream.Write(pong, 0, pong.Length);
                    SafeClose(res);
                }
                else if (path == "/api/health")
                {
                    int uptime = (int)(DateTime.UtcNow - _startTime).TotalSeconds;
                    string healthJson = string.Format(
                        "{{\"status\":\"ok\",\"instance_id\":\"{0}\",\"uptime_sec\":{1},\"db_ready\":{3},\"timestamp\":\"{2}\"}}",
                        _instanceId,
                        uptime,
                        DateTime.UtcNow.ToString("o"),
                        _workspace.Ready ? "true" : "false"
                    );
                    byte[] payload = Encoding.UTF8.GetBytes(healthJson);
                    res.ContentType = "application/json; charset=utf-8";
                    res.OutputStream.Write(payload, 0, payload.Length);
                    SafeClose(res);
                }
                else if (path == "/api/workspace" || path == "/api/backup" || path == "/api/storage-info" || path == "/api/recover" || path == "/api/open-data-dir")
                {
                    try
                    {
                        string body = "";
                        if (req.HttpMethod == "POST") using (var reader = new StreamReader(req.InputStream, Encoding.UTF8)) body = reader.ReadToEnd();
                        string result;
                        if (path == "/api/workspace" && req.HttpMethod == "GET") result = _workspace.Read();
                        else if (path == "/api/workspace" && req.HttpMethod == "POST") result = _workspace.Commit(body);
                        else if (path == "/api/storage-info" && req.HttpMethod == "GET") result = _workspace.Diagnostics();
                        else if (path == "/api/backup" && req.HttpMethod == "POST") { _workspace.Checkpoint(); result = "{}"; }
                        else if (path == "/api/recover" && req.HttpMethod == "POST") { _workspace.Recover(body); result = "{}"; }
                        else if (path == "/api/open-data-dir" && req.HttpMethod == "POST") { Process.Start("explorer.exe", _dataDir); result = "{}"; }
                        else { res.StatusCode = 405; SafeClose(res); return; }
                        SendJson(res, result);
                    }
                    catch (Exception ex)
                    {
                        res.StatusCode = ex is InvalidOperationException ? 409 : 503;
                        SendJson(res, new System.Web.Script.Serialization.JavaScriptSerializer().Serialize(new { error = ex.Message }));
                    }
                }
                else if (path == "/api/tasks")
                {
                    if (req.HttpMethod == "GET")
                    {
                        HandleGetTasks(res);
                    }
                    else if (req.HttpMethod == "POST")
                    {
                        HandlePostTasks(req, res);
                    }
                    else
                    {
                        res.StatusCode = 405;
                        SafeClose(res);
                    }
                }
                else if (path == "/api/settings")
                {
                    if (req.HttpMethod == "GET")
                    {
                        HandleGetSettings(res);
                    }
                    else if (req.HttpMethod == "POST")
                    {
                        HandlePostSettings(req, res);
                    }
                    else
                    {
                        res.StatusCode = 405;
                        SafeClose(res);
                    }
                }
                else if (path == "/api/events")
                {
                    if (req.HttpMethod == "GET") HandleGetJsonFile(res, _eventsFilePath, "[]");
                    else if (req.HttpMethod == "POST") HandlePostJsonFile(req, res, _eventsFilePath);
                    else { res.StatusCode = 405; SafeClose(res); }
                }
                else if (path == "/api/ai/settings")
                {
                    if (req.HttpMethod == "GET") HandleGetJsonFile(res, _aiSettingsFilePath, "{}");
                    else if (req.HttpMethod == "POST") HandlePostJsonFile(req, res, _aiSettingsFilePath);
                    else { res.StatusCode = 405; SafeClose(res); }
                }
                else if (path == "/api/ai/reports")
                {
                    if (req.HttpMethod == "GET") HandleGetJsonFile(res, _aiReportsFilePath, "[]");
                    else if (req.HttpMethod == "POST") HandlePostJsonFile(req, res, _aiReportsFilePath);
                    else { res.StatusCode = 405; SafeClose(res); }
                }
                else if (path == "/api/ai/attempts")
                {
                    if (req.HttpMethod == "GET") HandleGetJsonFile(res, _aiAttemptsFilePath, "[]");
                    else if (req.HttpMethod == "POST") HandlePostJsonFile(req, res, _aiAttemptsFilePath);
                    else { res.StatusCode = 405; SafeClose(res); }
                }
                else if (path == "/api/exit")
                {
                    _isRunning = false;
                    res.StatusCode = 200;
                    SafeClose(res);
                }
                else
                {
                    ServeStaticFile(path, res);
                }
            }
            catch (HttpListenerException)
            {
                // Client aborted socket (e.g. F5 reload) - safely swallow without process crash
                SafeClose(res);
            }
            catch (SocketException)
            {
                SafeClose(res);
            }
            catch (IOException)
            {
                SafeClose(res);
            }
            catch (ObjectDisposedException)
            {
                // Socket already disposed
            }
            catch (Exception)
            {
                try
                {
                    res.StatusCode = 500;
                    SafeClose(res);
                }
                catch { }
            }
        }

        private static void ServeHtml(HttpListenerResponse res)
        {
            string html = null;
            Assembly asm = Assembly.GetExecutingAssembly();
            foreach (string name in asm.GetManifestResourceNames())
            {
                if (name.EndsWith(".html", StringComparison.OrdinalIgnoreCase))
                    using (var stream = asm.GetManifestResourceStream(name))
                    using (var reader = new StreamReader(stream, Encoding.UTF8)) { html = reader.ReadToEnd(); break; }
            }
            if (html == null)
            {
                string root = AppDomain.CurrentDomain.BaseDirectory;
                foreach (string relative in new[] { "TodoTree_一键直达.html", "dist/TodoTree_一键直达.html", "index.html", "dist/index.html" })
                { string path = Path.Combine(root, relative); if (File.Exists(path)) { html = File.ReadAllText(path, Encoding.UTF8); break; } }
            }
            if (html == null) { res.StatusCode = 404; html = "<h1>TodoTree HTML bundle not found</h1>"; }
            html = html.Replace("<head>", "<head><script>window.__TODOTREE_DESKTOP__=true;</script>");
            byte[] bytes = Encoding.UTF8.GetBytes(html);
            res.ContentType = "text/html; charset=utf-8";
            res.OutputStream.Write(bytes, 0, bytes.Length); SafeClose(res);
        }

        private static void ServeStaticFile(string urlPath, HttpListenerResponse res)
        {
            string rel = urlPath.TrimStart('/').Replace('/', Path.DirectorySeparatorChar);
            string baseDir = AppDomain.CurrentDomain.BaseDirectory;
            string localPath = Path.Combine(baseDir, rel);
            if (!File.Exists(localPath))
            {
                localPath = Path.Combine(baseDir, "dist", rel);
            }

            if (File.Exists(localPath))
            {
                string ext = Path.GetExtension(localPath).ToLowerInvariant();
                if (ext == ".js") res.ContentType = "application/javascript; charset=utf-8";
                else if (ext == ".css") res.ContentType = "text/css; charset=utf-8";
                else if (ext == ".json") res.ContentType = "application/json; charset=utf-8";
                else if (ext == ".png") res.ContentType = "image/png";
                else if (ext == ".svg") res.ContentType = "image/svg+xml";
                else res.ContentType = "application/octet-stream";

                byte[] bytes = File.ReadAllBytes(localPath);
                res.OutputStream.Write(bytes, 0, bytes.Length);
                SafeClose(res);
            }
            else
            {
                res.StatusCode = 404;
                SafeClose(res);
            }
        }

        private static void HandleGetTasks(HttpListenerResponse res)
        {
            lock (_fileLock)
            {
                // If tasks.json missing but backup exists, restore from backup
                if (!File.Exists(_tasksFilePath))
                {
                    string bak = _tasksFilePath + ".bak";
                    if (File.Exists(bak))
                    {
                        try { File.Copy(bak, _tasksFilePath, true); } catch { }
                    }
                }

                if (File.Exists(_tasksFilePath))
                {
                    byte[] bytes = File.ReadAllBytes(_tasksFilePath);
                    res.ContentType = "application/json; charset=utf-8";
                    res.OutputStream.Write(bytes, 0, bytes.Length);
                    SafeClose(res);
                }
                else
                {
                    byte[] empty = Encoding.UTF8.GetBytes("[]");
                    res.ContentType = "application/json; charset=utf-8";
                    res.OutputStream.Write(empty, 0, empty.Length);
                    SafeClose(res);
                }
            }
        }

        private static void SendJson(HttpListenerResponse res, string value)
        {
            res.ContentType = "application/json; charset=utf-8";
            byte[] bytes = Encoding.UTF8.GetBytes(value);
            res.OutputStream.Write(bytes, 0, bytes.Length);
            SafeClose(res);
        }

        private static void SafeAtomicWrite(string targetFilePath, Stream inputStream)
        {
            using (var reader = new StreamReader(inputStream, Encoding.UTF8))
                DurableWorkspace.WriteAtomic(targetFilePath, reader.ReadToEnd());
        }

        private static void HandlePostTasks(HttpListenerRequest req, HttpListenerResponse res)
        {
            try
            {
                SafeAtomicWrite(_tasksFilePath, req.InputStream);
                byte[] ok = Encoding.UTF8.GetBytes("{\"ok\":true}");
                res.ContentType = "application/json; charset=utf-8";
                res.OutputStream.Write(ok, 0, ok.Length);
                SafeClose(res);
            }
            catch (Exception)
            {
                try
                {
                    res.StatusCode = 500;
                    SafeClose(res);
                }
                catch { }
            }
        }

        private static void HandleGetSettings(HttpListenerResponse res)
        {
            lock (_fileLock)
            {
                if (File.Exists(_settingsFilePath))
                {
                    byte[] bytes = File.ReadAllBytes(_settingsFilePath);
                    res.ContentType = "application/json; charset=utf-8";
                    res.OutputStream.Write(bytes, 0, bytes.Length);
                    SafeClose(res);
                }
                else
                {
                    byte[] empty = Encoding.UTF8.GetBytes("{}");
                    res.ContentType = "application/json; charset=utf-8";
                    res.OutputStream.Write(empty, 0, empty.Length);
                    SafeClose(res);
                }
            }
        }

        private static void HandlePostSettings(HttpListenerRequest req, HttpListenerResponse res)
        {
            try
            {
                SafeAtomicWrite(_settingsFilePath, req.InputStream);
                byte[] ok = Encoding.UTF8.GetBytes("{\"ok\":true}");
                res.ContentType = "application/json; charset=utf-8";
                res.OutputStream.Write(ok, 0, ok.Length);
                SafeClose(res);
            }
            catch (Exception)
            {
                try
                {
                    res.StatusCode = 500;
                    SafeClose(res);
                }
                catch { }
            }
        }

        private static void HandleGetJsonFile(HttpListenerResponse res, string filePath, string defaultJson)
        {
            lock (_fileLock)
            {
                if (File.Exists(filePath))
                {
                    byte[] bytes = File.ReadAllBytes(filePath);
                    res.ContentType = "application/json; charset=utf-8";
                    res.OutputStream.Write(bytes, 0, bytes.Length);
                    SafeClose(res);
                }
                else
                {
                    byte[] empty = Encoding.UTF8.GetBytes(defaultJson);
                    res.ContentType = "application/json; charset=utf-8";
                    res.OutputStream.Write(empty, 0, empty.Length);
                    SafeClose(res);
                }
            }
        }

        private static void HandlePostJsonFile(HttpListenerRequest req, HttpListenerResponse res, string filePath)
        {
            try
            {
                SafeAtomicWrite(filePath, req.InputStream);
                byte[] ok = Encoding.UTF8.GetBytes("{\"ok\":true}");
                res.ContentType = "application/json; charset=utf-8";
                res.OutputStream.Write(ok, 0, ok.Length);
                SafeClose(res);
            }
            catch (Exception)
            {
                try
                {
                    res.StatusCode = 500;
                    SafeClose(res);
                }
                catch { }
            }
        }

        private static string FindBrowser()
        {
            string[] candidates = new string[]
            {
                @"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
                @"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), @"Microsoft\Edge\Application\msedge.exe"),
                @"C:\Program Files\Google\Chrome\Application\chrome.exe",
                @"C:\Program Files\Chrome\Application\chrome.exe",
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), @"Google\Chrome\Application\chrome.exe")
            };

            foreach (string path in candidates)
            {
                if (File.Exists(path))
                {
                    return path;
                }
            }

            return null;
        }
    }
}
