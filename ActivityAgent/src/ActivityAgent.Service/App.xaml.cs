using System.Diagnostics;
using System.IO;
using System.Windows;
using System.Windows.Controls;
using ActivityAgent.Service.Configuration;
using Hardcodet.Wpf.TaskbarNotification;
using Microsoft.Extensions.Logging;
using Serilog;

namespace ActivityAgent.Service;

/// <summary>
/// WPF Application with System Tray support for SasWatch Activity Agent
/// </summary>
public partial class App : Application
{
    private TaskbarIcon? _notifyIcon;
    private AgentWorker? _worker;
    private MainWindow? _mainWindow;
    private CancellationTokenSource? _cts;
    
    private static readonly string LogPath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
        "ActivityAgent", "logs");

    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);

        // Configure logging
        Directory.CreateDirectory(LogPath);
        
        Log.Logger = new LoggerConfiguration()
            .MinimumLevel.Information()
            .WriteTo.File(
                Path.Combine(LogPath, "activity-agent-.log"),
                rollingInterval: RollingInterval.Day,
                retainedFileCountLimit: 30,
                outputTemplate: "[{Timestamp:yyyy-MM-dd HH:mm:ss} {Level:u3}] {Message:lj}{NewLine}{Exception}")
            .CreateLogger();

        Log.Information("==============================================");
        Log.Information("SasWatch Activity Agent Starting");
        Log.Information("==============================================");

        try
        {
            // Create system tray icon
            _notifyIcon = new TaskbarIcon
            {
                ToolTipText = "SasWatch Activity Agent",
                ContextMenu = (ContextMenu)FindResource("TrayMenu"),
                Visibility = Visibility.Visible
            };
            
            // Try to load icon from resources, fall back to default
            try
            {
                var iconUri = new Uri("pack://application:,,,/Resources/icon.ico");
                var streamInfo = GetResourceStream(iconUri);
                if (streamInfo != null)
                {
                    _notifyIcon.Icon = new System.Drawing.Icon(streamInfo.Stream);
                }
            }
            catch
            {
                // Use a default system icon if resource not found
                _notifyIcon.Icon = System.Drawing.SystemIcons.Application;
            }

            // Double-click to show window
            _notifyIcon.TrayMouseDoubleClick += (s, args) => ShowMainWindow();

            // Load and validate configuration
            var config = AgentConfig.LoadFromRegistry();
            if (!config.IsValid())
            {
                Log.Warning("Configuration not set - showing setup window");
                ShowConfigurationPrompt();
            }
            else
            {
                // Start the worker
                StartWorker(config);
            }

            // Show main window on startup (unless HideGui is enabled)
            if (!config.HideGui)
            {
                ShowMainWindow();
            }
            
            Log.Information("Application started successfully");
        }
        catch (Exception ex)
        {
            Log.Fatal(ex, "Failed to start application");
            MessageBox.Show($"Failed to start: {ex.Message}", "Error", MessageBoxButton.OK, MessageBoxImage.Error);
            Shutdown();
        }
    }

    private void StartWorker(AgentConfig config)
    {
        _cts = new CancellationTokenSource();
        
        // Create logger factory for worker
        var loggerFactory = LoggerFactory.Create(builder =>
        {
            builder.AddSerilog(Log.Logger);
        });

        _worker = new AgentWorker(config, loggerFactory);
        
        // Subscribe to status updates
        _worker.StatusChanged += OnWorkerStatusChanged;
        
        // Start worker in background
        Task.Run(async () =>
        {
            try
            {
                await _worker.StartAsync(_cts.Token);
            }
            catch (OperationCanceledException)
            {
                Log.Information("Worker stopped");
            }
            catch (Exception ex)
            {
                Log.Error(ex, "Worker error");
            }
        });
    }

    private void OnWorkerStatusChanged(object? sender, WorkerStatus status)
    {
        Dispatcher.Invoke(() =>
        {
            // Update tray icon tooltip
            if (_notifyIcon != null)
            {
                _notifyIcon.ToolTipText = status.IsConnected 
                    ? $"SasWatch Agent - Connected ({status.EventsSent} events sent)"
                    : "SasWatch Agent - Disconnected";
            }
            
            // Update main window if open
            if (_mainWindow != null && _mainWindow.IsVisible)
            {
                _mainWindow.UpdateStatus(status);
            }
        });
    }

    private void ShowConfigurationPrompt()
    {
        MessageBox.Show(
            "Please configure the agent via registry:\n\n" +
            "HKLM\\Software\\ActivityAgent\n\n" +
            "Required keys:\n" +
            "  - ApiUrl (e.g., https://app.saswatch.com/api/track)\n" +
            "  - ApiKey (from your SasWatch account)\n\n" +
            "Or run setup-local-config.ps1 as Administrator.",
            "Configuration Required",
            MessageBoxButton.OK,
            MessageBoxImage.Information);
    }

    private void ShowMainWindow()
    {
        var config = AgentConfig.LoadFromRegistry();
        if (config.HideGui)
        {
            // In HideGui mode, don't show the window
            return;
        }

        if (_mainWindow == null)
        {
            _mainWindow = new MainWindow(_worker);
            _mainWindow.Closing += (s, e) =>
            {
                e.Cancel = true;
                _mainWindow.Hide();
            };
        }
        _mainWindow.Show();
        _mainWindow.Activate();
        
        if (_mainWindow.WindowState == WindowState.Minimized)
        {
            _mainWindow.WindowState = WindowState.Normal;
        }
    }

    // Context menu handlers
    private void ShowWindow_Click(object sender, RoutedEventArgs e)
    {
        var config = AgentConfig.LoadFromRegistry();
        if (config.HideGui)
        {
            // Temporarily allow showing window even in HideGui mode when explicitly requested
            var tempConfig = config;
            tempConfig.HideGui = false;
            ShowMainWindow();
        }
        else
        {
            ShowMainWindow();
        }
    }
    
    private void ViewLogs_Click(object sender, RoutedEventArgs e)
    {
        if (Directory.Exists(LogPath))
        {
            Process.Start("explorer.exe", LogPath);
        }
        else
        {
            MessageBox.Show("Log directory not found.", "Info", MessageBoxButton.OK, MessageBoxImage.Information);
        }
    }

    private void OpenDashboard_Click(object sender, RoutedEventArgs e)
    {
        var config = AgentConfig.LoadFromRegistry();
        var baseUrl = config.ApiUrl?.Replace("/api/track", "") ?? "https://app.saswatch.com";
        
        try
        {
            Process.Start(new ProcessStartInfo
            {
                FileName = baseUrl,
                UseShellExecute = true
            });
        }
        catch (Exception ex)
        {
            MessageBox.Show($"Failed to open browser: {ex.Message}", "Error", MessageBoxButton.OK, MessageBoxImage.Error);
        }
    }

    private void Exit_Click(object sender, RoutedEventArgs e)
    {
        Shutdown();
    }

    protected override void OnExit(ExitEventArgs e)
    {
        Log.Information("Application shutting down...");
        
        _cts?.Cancel();
        _worker?.StopAsync().Wait(TimeSpan.FromSeconds(5));
        _notifyIcon?.Dispose();
        
        Log.Information("Application stopped");
        Log.CloseAndFlush();
        
        base.OnExit(e);
    }
}

