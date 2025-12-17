using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using Microsoft.Extensions.Logging;
using ActivityAgent.Service.Models;
using ActivityAgent.Service.Services;
using ActivityEvent = ActivityAgent.Service.Models.ActivityEvent;

namespace ActivityAgent.Service.Monitors;

/// <summary>
/// Monitors browser activity - only tracks web browsing events (URLs/domains)
/// Optimized for lightweight operation, ignoring non-browser window focus
/// </summary>
public partial class WindowFocusMonitor : IMonitor
{
    private readonly EventQueue _eventQueue;
    private readonly ILogger _logger;
    private Timer? _timer;
    private bool _isRunning;
    private string _lastDomain = "";
    private readonly HashSet<string> _recentDomains = new();
    private DateTime _lastDomainClear = DateTime.UtcNow;

    public string Name => "Browser Monitor";

    // Win32 API imports
    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);

    private static readonly string[] BrowserProcesses = { "chrome", "msedge", "firefox", "brave", "opera", "vivaldi", "arc" };

    public WindowFocusMonitor(EventQueue eventQueue, ILogger logger)
    {
        _eventQueue = eventQueue;
        _logger = logger;
    }

    public void Start()
    {
        if (_isRunning) return;

        _isRunning = true;
        _logger.LogInformation("{MonitorName} starting...", Name);

        // Check active window every 5 seconds (optimized from 2s)
        _timer = new Timer(CheckActiveWindow, null, TimeSpan.Zero, TimeSpan.FromSeconds(5));
    }

    public void Stop()
    {
        _isRunning = false;
        _timer?.Dispose();
        _logger.LogInformation("{MonitorName} stopped", Name);
    }

    private void CheckActiveWindow(object? state)
    {
        if (!_isRunning) return;

        try
        {
            // Clear domain cache every 30 minutes
            if ((DateTime.UtcNow - _lastDomainClear).TotalMinutes > 30)
            {
                _recentDomains.Clear();
                _lastDomainClear = DateTime.UtcNow;
            }

            var hwnd = GetForegroundWindow();
            if (hwnd == IntPtr.Zero) return;

            // Get process info first - bail early if not a browser
            GetWindowThreadProcessId(hwnd, out uint processId);
            Process process;
            try
            {
                process = Process.GetProcessById((int)processId);
            }
            catch
            {
                return; // Process exited
            }

            var processName = process.ProcessName.ToLower();

            // OPTIMIZATION: Only track browser windows, skip all others
            if (!BrowserProcesses.Contains(processName))
            {
                return;
            }

            // Get window title
            var titleBuilder = new StringBuilder(256);
            GetWindowText(hwnd, titleBuilder, titleBuilder.Capacity);
            var title = titleBuilder.ToString();

            if (string.IsNullOrEmpty(title)) return;

            // Extract domain and deduplicate
            var url = ExtractUrlFromTitle(title, processName);
            var domain = ExtractDomain(url);

            // Skip if same domain as last check or already tracked recently
            if (string.IsNullOrEmpty(domain) || domain == _lastDomain || _recentDomains.Contains(domain))
            {
                return;
            }

            _lastDomain = domain;
            _recentDomains.Add(domain);

            var evt = new ActivityEvent
            {
                EventType = "web_browsing",
                ProcessName = process.ProcessName,
                WindowTitle = title,
                Browser = processName,
                Url = url,
                Domain = domain,
                Timestamp = DateTime.UtcNow
            };

            _eventQueue.Enqueue(evt);
            _logger.LogDebug("Website visited: {Domain} ({Browser})", domain, processName);
        }
        catch (Exception ex)
        {
            _logger.LogTrace(ex, "Error checking active window");
        }
    }

    private static string ExtractUrlFromTitle(string title, string browser)
    {
        // Browser titles often contain URLs or domains
        // Format examples:
        // - "Page Title - Google Chrome"
        // - "Page Title | Domain"
        // - "https://example.com/page - Browser"

        // Try to extract full URL
        var urlMatch = UrlRegex().Match(title);
        if (urlMatch.Success)
        {
            return urlMatch.Value;
        }

        // Try to extract domain
        var domainMatch = DomainRegex().Match(title);
        if (domainMatch.Success)
        {
            return domainMatch.Value;
        }

        // Return title as-is if no URL/domain found
        return title;
    }

    private static string? ExtractDomain(string? url)
    {
        if (string.IsNullOrEmpty(url)) return null;

        try
        {
            // Try to parse as URI
            if (Uri.TryCreate(url.StartsWith("http") ? url : $"https://{url}", UriKind.Absolute, out var uri))
            {
                return uri.Host;
            }

            // Extract domain pattern
            var domainMatch = DomainRegex().Match(url);
            if (domainMatch.Success)
            {
                return domainMatch.Value;
            }
        }
        catch
        {
            // Ignore parsing errors
        }

        return null;
    }

    [GeneratedRegex(@"https?://[^\s]+")]
    private static partial Regex UrlRegex();

    [GeneratedRegex(@"(?:[a-zA-Z0-9][a-zA-Z0-9-]*\.)+[a-zA-Z]{2,}")]
    private static partial Regex DomainRegex();
}

