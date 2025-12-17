using System.Diagnostics;
using Microsoft.Extensions.Logging;
using ActivityAgent.Service.Models;
using ActivityAgent.Service.Services;
using ActivityEvent = ActivityAgent.Service.Models.ActivityEvent;

namespace ActivityAgent.Service.Monitors;

/// <summary>
/// Monitors application launches - tracks when apps are started
/// Optimized to only report genuine launches, not running apps
/// </summary>
public class ApplicationMonitor : IMonitor
{
    private readonly EventQueue _eventQueue;
    private readonly ILogger _logger;
    private readonly Dictionary<int, string> _trackedProcesses = new(); // PID -> ProcessName
    private readonly HashSet<string> _reportedLaunches = new(); // ProcessName (dedupe within session)
    private Timer? _timer;
    private bool _isRunning;
    private bool _initialScanComplete;
    private DateTime _lastCleanup = DateTime.UtcNow;

    // System/background processes to ignore
    private static readonly HashSet<string> IgnoredProcesses = new(StringComparer.OrdinalIgnoreCase)
    {
        "dwm", "ApplicationFrameHost", "csrss", "smss", "wininit", "winlogon",
        "services", "lsass", "svchost", "conhost", "RuntimeBroker", "taskhostw",
        "SearchHost", "SearchIndexer", "ShellExperienceHost", "StartMenuExperienceHost",
        "SystemSettings", "WidgetService", "TextInputHost", "ctfmon", "dllhost",
        "sihost", "fontdrvhost", "MsMpEng", "SecurityHealthService", "spoolsv"
    };

    public string Name => "Application Launch Monitor";

    public ApplicationMonitor(EventQueue eventQueue, ILogger logger)
    {
        _eventQueue = eventQueue;
        _logger = logger;
    }

    public void Start()
    {
        if (_isRunning) return;

        _isRunning = true;
        _initialScanComplete = false;
        _logger.LogInformation("{MonitorName} starting...", Name);

        // Check for new applications every 10 seconds (optimized from 5s)
        _timer = new Timer(CheckApplications, null, TimeSpan.Zero, TimeSpan.FromSeconds(10));
    }

    public void Stop()
    {
        _isRunning = false;
        _timer?.Dispose();
        _logger.LogInformation("{MonitorName} stopped", Name);
    }

    private void CheckApplications(object? state)
    {
        if (!_isRunning) return;

        try
        {
            // Periodic cleanup of stale entries (every 5 minutes)
            if ((DateTime.UtcNow - _lastCleanup).TotalMinutes > 5)
            {
                CleanupStaleProcesses();
                _lastCleanup = DateTime.UtcNow;
            }

            var currentProcessIds = new HashSet<int>();
            var processes = Process.GetProcesses()
                .Where(p => !string.IsNullOrEmpty(p.MainWindowTitle))
                .Where(p => !IgnoredProcesses.Contains(p.ProcessName));

            foreach (var process in processes)
            {
                try
                {
                    currentProcessIds.Add(process.Id);
                    
                    // Skip if already tracking this exact process
                    if (_trackedProcesses.ContainsKey(process.Id))
                    {
                        continue;
                    }

                    var processName = process.ProcessName;
                    _trackedProcesses[process.Id] = processName;

                    // Skip reporting on initial scan (these apps were already running)
                    if (!_initialScanComplete)
                    {
                        continue;
                    }

                    // Deduplicate: only report first launch of each app per session
                    if (_reportedLaunches.Contains(processName))
                    {
                        _logger.LogTrace("Skipping duplicate launch: {ProcessName}", processName);
                        continue;
                    }

                    _reportedLaunches.Add(processName);

                    // Get process path
                    string? processPath = null;
                    try
                    {
                        processPath = process.MainModule?.FileName;
                    }
                    catch
                    {
                        // Some processes don't allow access to MainModule
                    }

                    var evt = new ActivityEvent
                    {
                        EventType = "application_launch",
                        ProcessName = processName,
                        WindowTitle = process.MainWindowTitle,
                        ProcessPath = processPath,
                        Timestamp = DateTime.UtcNow
                    };

                    _eventQueue.Enqueue(evt);
                    _logger.LogInformation("Application launched: {ProcessName}", processName);
                }
                catch (Exception ex)
                {
                    _logger.LogTrace(ex, "Could not access process");
                }
            }

            // Mark initial scan complete after first run
            if (!_initialScanComplete)
            {
                _initialScanComplete = true;
                _logger.LogInformation("Initial process scan complete. Tracking {Count} running apps.", _trackedProcesses.Count);
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error in {MonitorName}", Name);
        }
    }

    private void CleanupStaleProcesses()
    {
        var runningPids = new HashSet<int>(Process.GetProcesses().Select(p => p.Id));
        var stalePids = _trackedProcesses.Keys.Where(pid => !runningPids.Contains(pid)).ToList();

        foreach (var pid in stalePids)
        {
            if (_trackedProcesses.TryGetValue(pid, out var processName))
            {
                // Allow this app to be reported again if relaunched
                _reportedLaunches.Remove(processName);
            }
            _trackedProcesses.Remove(pid);
        }

        if (stalePids.Count > 0)
        {
            _logger.LogDebug("Cleaned up {Count} exited processes", stalePids.Count);
        }
    }
}

