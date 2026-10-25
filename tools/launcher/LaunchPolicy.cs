using System.Diagnostics;
using System.Net;
using System.Text.Json;

namespace WarThunderResearchCalculator;

internal static class LaunchPolicy
{
    internal const int Port = 3000;
    // Preserve the browser origin so existing localStorage plans remain available.
    internal const string Url = "http://localhost:3000";
    internal const string HealthUrl = "http://127.0.0.1:3000/healthz";

    internal static string? FindAppDirectory(string directory)
    {
        if (!Path.IsPathFullyQualified(directory)) return null;
        return File.Exists(Path.Combine(directory, "main.js")) && File.Exists(Path.Combine(directory, "package.json"))
            ? Path.GetFullPath(directory) : null;
    }

    internal static string? FindNode(string appDir, string? pathValue)
    {
        var bundled = Path.Combine(appDir, "node.exe");
        if (File.Exists(bundled)) return bundled;
        foreach (var entry in (pathValue ?? "").Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries))
        {
            var directory = entry.Trim().Trim('"');
            // Relative PATH entries resolve against an unrelated working directory.
            if (!Path.IsPathFullyQualified(directory)) continue;
            try
            {
                var candidate = Path.Combine(directory, "node.exe");
                if (File.Exists(candidate)) return candidate;
            }
            catch (ArgumentException) { }
        }
        return null;
    }

    internal static ProcessStartInfo ServerStartInfo(string appDir, string nodePath)
    {
        var info = new ProcessStartInfo
        {
            FileName = nodePath,
            WorkingDirectory = appDir,
            UseShellExecute = false,
            CreateNoWindow = true,
        };
        info.ArgumentList.Add(Path.Combine(appDir, "main.js"));
        foreach (var name in new[] { "NODE_OPTIONS", "NODE_PATH", "WT_ADMIN_TOKEN", "WT_ENABLE_UPDATES", "WT_PUBLIC_ORIGIN", "RENDER_EXTERNAL_URL" })
            info.Environment.Remove(name);
        info.Environment["WT_HOST"] = "127.0.0.1";
        info.Environment["PORT"] = Port.ToString();
        return info;
    }

    internal static HttpClient CreateHealthClient() => new(new HttpClientHandler
    {
        AllowAutoRedirect = false,
        UseProxy = false,
        UseCookies = false,
    })
    {
        Timeout = TimeSpan.FromSeconds(2),
        MaxResponseContentBufferSize = 4096,
    };

    internal static async Task<bool> IsCalculatorAsync(HttpClient client, Uri healthUrl)
    {
        try
        {
            using var response = await client.GetAsync(healthUrl);
            if (response.StatusCode != HttpStatusCode.OK || response.Content.Headers.ContentType?.MediaType != "application/json") return false;
            using var document = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
            var root = document.RootElement;
            return root.ValueKind == JsonValueKind.Object
                && root.TryGetProperty("success", out var success) && success.ValueKind == JsonValueKind.True
                && root.TryGetProperty("service", out var service) && service.ValueKind == JsonValueKind.String
                && service.GetString() == "war-thunder-research-calculator";
        }
        catch (HttpRequestException) { return false; }
        catch (TaskCanceledException) { return false; }
        catch (JsonException) { return false; }
    }
}
