using System.Net;
using System.Net.Sockets;
using System.Text;
using WarThunderResearchCalculator;

var count = 0;
void Check(bool condition, string name)
{
    if (!condition) throw new Exception(name);
    count++;
}

var scratch = Path.Combine(Path.GetTempPath(), "wt-launcher-policy-" + Guid.NewGuid().ToString("N"));
var cwd = Environment.CurrentDirectory;
Directory.CreateDirectory(scratch);
var changed = new[] { "NODE_OPTIONS", "NODE_PATH", "WT_HOST", "PORT", "WT_ADMIN_TOKEN", "WT_ENABLE_UPDATES", "WT_PUBLIC_ORIGIN", "RENDER_EXTERNAL_URL" };
var originalEnv = changed.ToDictionary(key => key, Environment.GetEnvironmentVariable);
try
{
    var app = Directory.CreateDirectory(Path.Combine(scratch, "app space")).FullName;
    var unrelated = Directory.CreateDirectory(Path.Combine(scratch, "unrelated")).FullName;
    var installed = Directory.CreateDirectory(Path.Combine(scratch, "node installation")).FullName;
    File.WriteAllText(Path.Combine(unrelated, "node.exe"), "Never execute this fixture");
    File.WriteAllText(Path.Combine(unrelated, "main.js"), "Never execute this fixture");
    File.WriteAllText(Path.Combine(unrelated, "package.json"), "{}");
    Environment.CurrentDirectory = unrelated;
    Check(LaunchPolicy.FindAppDirectory(app) is null, "Do not discover apps in the working directory");
    var child = Directory.CreateDirectory(Path.Combine(unrelated, "child")).FullName;
    Check(LaunchPolicy.FindAppDirectory(child) is null, "Do not discover apps in ancestors");
    File.WriteAllText(Path.Combine(app, "main.js"), "// fixture");
    File.WriteAllText(Path.Combine(app, "package.json"), "{}");
    Check(LaunchPolicy.FindAppDirectory(app) == app, "Application files beside launcher are accepted");
    Check(LaunchPolicy.FindNode(app, null) is null, "Do not execute working-directory node.exe");
    Check(LaunchPolicy.FindNode(app, string.Join(Path.PathSeparator, ".", "", "..", "./relative")) is null, "Ignore all relative PATH entries");
    File.WriteAllText(Path.Combine(installed, "node.exe"), "Never execute this fixture");
    Check(LaunchPolicy.FindNode(app, '"' + installed + '"') == Path.Combine(installed, "node.exe"), "Absolute installed Node path works");
    File.WriteAllText(Path.Combine(app, "node.exe"), "Never execute this fixture");
    Check(LaunchPolicy.FindNode(app, installed) == Path.Combine(app, "node.exe"), "Bundled Node has priority");
    foreach (var name in changed) Environment.SetEnvironmentVariable(name, "fixture-untrusted-value");
    var info = LaunchPolicy.ServerStartInfo(app, Path.Combine(app, "node.exe"));
    Check(info.FileName == Path.Combine(app, "node.exe") && info.WorkingDirectory == app, "Explicit executable and working directory");
    Check(info.ArgumentList.Count == 1 && info.ArgumentList[0] == Path.Combine(app, "main.js"), "Absolute script argument safely handles spaces");
    Check(!info.UseShellExecute && info.CreateNoWindow, "No shell or visible helper window");
    Check(info.Environment["WT_HOST"] == "127.0.0.1" && info.Environment["PORT"] == "3000", "Desktop cannot inherit remote hosting settings");
    Check(changed.Where(key => key != "WT_HOST" && key != "PORT").All(key => !info.Environment.ContainsKey(key)), "No inherited preload or hosted administrator configuration");
    Check(LaunchPolicy.Url == "http://localhost:3000", "Preserve saved-plan browser origin");
    Check(LaunchPolicy.HealthUrl == "http://127.0.0.1:3000/healthz", "Health probe uses a literal loopback address");

    using var stop = new CancellationTokenSource();
    var listener = new TcpListener(IPAddress.Loopback, 0);
    listener.Start();
    var origin = "http://127.0.0.1:" + ((IPEndPoint)listener.LocalEndpoint).Port;
    var redirected = 0;
    var service = "{\"success\":true,\"service\":\"war-thunder-research-calculator\"}";
    var server = Task.Run(async () =>
    {
        while (!stop.IsCancellationRequested)
        {
            using var connection = await listener.AcceptTcpClientAsync(stop.Token);
            using var stream = connection.GetStream();
            using var reader = new StreamReader(stream, Encoding.ASCII, false, 1024, true);
            var first = await reader.ReadLineAsync(stop.Token);
            while (!string.IsNullOrEmpty(await reader.ReadLineAsync(stop.Token))) { }
            var route = first!.Split(' ')[1];
            var body = route switch { "/ok" or "/destination" => service, "/html" => "<html>another service</html>",
                "/large" => new string('x', 5000), "/array" => "[]", "/wrong" => "{\"success\":true,\"service\":\"other\"}",
                "/false" => "{\"success\":false,\"service\":\"war-thunder-research-calculator\"}", _ => "invalid JSON" };
            if (route == "/destination") redirected++;
            var status = route == "/redirect" ? "302 Found" : route == "/error" ? "500 Internal Server Error" : "200 OK";
            var type = route == "/html" ? "text/html" : "application/json";
            var payload = Encoding.UTF8.GetBytes(body);
            var header = $"HTTP/1.1 {status}\r\nContent-Type: {type}\r\nContent-Length: {payload.Length}\r\nConnection: close\r\n";
            if (route == "/redirect") header += $"Location: {origin}/destination\r\n";
            await stream.WriteAsync(Encoding.ASCII.GetBytes(header + "\r\n"));
            await stream.WriteAsync(payload);
        }
    });
    try
    {
        var originalProxy = HttpClient.DefaultProxy;
        var proxy = new RejectingProxy();
        HttpClient.DefaultProxy = proxy;
        try
        {
            using var client = LaunchPolicy.CreateHealthClient();
            Check(client.MaxResponseContentBufferSize == 4096, "Health response size is bounded");
            Check(client.Timeout == TimeSpan.FromSeconds(2), "Health probe time is bounded");
            Check(await LaunchPolicy.IsCalculatorAsync(client, new Uri(origin + "/ok")), "Recognize actual calculator health response");
            foreach (var route in new[] { "/html", "/wrong", "/array", "/false", "/invalid", "/large", "/error", "/redirect" })
                Check(!await LaunchPolicy.IsCalculatorAsync(client, new Uri(origin + route)), "Reject health response " + route);
            Check(redirected == 0, "Health probe never follows redirects");
            Check(proxy.Calls == 0, "Health probe never uses the configured proxy");
        }
        finally { HttpClient.DefaultProxy = originalProxy; }
    }
    finally
    {
        stop.Cancel();
        listener.Stop();
        try { await server; } catch (OperationCanceledException) { } catch (SocketException) when (stop.IsCancellationRequested) { }
    }
    Console.WriteLine($"Launcher policy: {count} checks passed; no fixture executable was run.");
}

finally
{
    Environment.CurrentDirectory = cwd;
    foreach (var pair in originalEnv) Environment.SetEnvironmentVariable(pair.Key, pair.Value);
    Directory.Delete(scratch, true);
}

internal sealed class RejectingProxy : IWebProxy
{
    public int Calls { get; private set; }
    public ICredentials? Credentials { get; set; }
    public Uri GetProxy(Uri destination) { Calls++; return new Uri("http://127.0.0.1:9"); }
    public bool IsBypassed(Uri host) { Calls++; return false; }
}
