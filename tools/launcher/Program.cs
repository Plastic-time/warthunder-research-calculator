using System.Diagnostics;
using System.Net.NetworkInformation;
using System.Windows.Forms;

namespace WarThunderResearchCalculator;

internal static class Program
{
    private const int Port = LaunchPolicy.Port;
    private const string Url = LaunchPolicy.Url;

    [STAThread]
    private static async Task Main(string[] args)
    {
        ApplicationConfiguration.Initialize();
        var shouldOpenBrowser = !args.Any(arg => string.Equals(arg, "--no-browser", StringComparison.OrdinalIgnoreCase));

        try
        {
            var appDir = LaunchPolicy.FindAppDirectory(AppContext.BaseDirectory);
            if (appDir is null)
            {
                ShowError("没有找到 main.js。请把这个启动器放在项目根目录，也就是 main.js 旁边。");
                return;
            }

            if (!IsPortOpen(Port))
            {
                if (!Directory.Exists(Path.Combine(appDir, "node_modules")))
                {
                    ShowError("没有找到 node_modules。请先在项目目录运行 npm install，再双击启动器。");
                    return;
                }

                var nodePath = LaunchPolicy.FindNode(appDir, Environment.GetEnvironmentVariable("PATH"));
                if (nodePath is null)
                {
                    ShowError("没有找到 node.exe。请先安装 Node.js，或把 node.exe 放在启动器旁边。");
                    return;
                }

                StartServer(appDir, nodePath);
            }

            if (!await WaitForServerAsync(TimeSpan.FromSeconds(60)))
            {
                ShowError("服务器没有在 60 秒内启动成功。可以手动运行 node.exe main.js 查看具体报错。");
                return;
            }

            if (shouldOpenBrowser)
            {
                OpenBrowser(Url);
            }
        }
        catch (Exception ex)
        {
            ShowError(ex.Message);
        }
    }

    private static void StartServer(string appDir, string nodePath)
    {
        var startInfo = LaunchPolicy.ServerStartInfo(appDir, nodePath);

        var process = new Process { StartInfo = startInfo };
        if (!process.Start())
        {
            throw new InvalidOperationException("启动 Node.js 服务失败。");
        }
    }

    private static bool IsPortOpen(int port)
    {
        var properties = IPGlobalProperties.GetIPGlobalProperties();
        return properties.GetActiveTcpListeners().Any(endpoint => endpoint.Port == port);
    }

    private static async Task<bool> WaitForServerAsync(TimeSpan timeout)
    {
        using var client = LaunchPolicy.CreateHealthClient();
        var deadline = DateTime.UtcNow + timeout;

        while (DateTime.UtcNow < deadline)
        {
            if (await LaunchPolicy.IsCalculatorAsync(client, new Uri(LaunchPolicy.HealthUrl))) return true;

            await Task.Delay(500);
        }

        return false;
    }

    private static void OpenBrowser(string url)
    {
        Process.Start(new ProcessStartInfo
        {
            FileName = url,
            UseShellExecute = true,
        });
    }

    private static void ShowError(string message)
    {
        MessageBox.Show(message, "War Thunder 研发计算器启动失败", MessageBoxButtons.OK, MessageBoxIcon.Error);
    }
}
