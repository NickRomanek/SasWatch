using System.Collections.ObjectModel;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Threading;
using ActivityAgent.Service.Configuration;

namespace ActivityAgent.Service;

/// <summary>
/// Main window for SasWatch Activity Agent GUI
/// </summary>
public partial class MainWindow : Window
{
    private readonly AgentWorker? _worker;
    private readonly ObservableCollection<string> _recentActivity = new();
    
    private static readonly string LogPath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
        "ActivityAgent", "logs");

    public MainWindow(AgentWorker? worker)
    {
        InitializeComponent();
        _worker = worker;
        
        // Bind recent activity list
        RecentActivityList.ItemsSource = _recentActivity;
        
        // Load initial configuration
        LoadConfiguration();
        
        // Load logs on startup
        Loaded += (s, e) => RefreshLogs();
        
        // Set up auto-refresh timer for logs (every 5 seconds)
        var logTimer = new DispatcherTimer
        {
            Interval = TimeSpan.FromSeconds(5)
        };
        logTimer.Tick += (s, e) => RefreshLogs();
        logTimer.Start();
    }

    private void LoadConfiguration()
    {
        var config = AgentConfig.LoadFromRegistry();
        
        ApiUrlText.Text = string.IsNullOrEmpty(config.ApiUrl) ? "Not configured" : config.ApiUrl;
        
        // Update monitor badges based on config
        AppMonitorBadge.Background = config.EnableApplicationMonitoring 
            ? new SolidColorBrush((Color)ColorConverter.ConvertFromString("#0f3460")!)
            : new SolidColorBrush((Color)ColorConverter.ConvertFromString("#333")!);
            
        WindowMonitorBadge.Background = config.EnableWindowFocusMonitoring
            ? new SolidColorBrush((Color)ColorConverter.ConvertFromString("#0f3460")!)
            : new SolidColorBrush((Color)ColorConverter.ConvertFromString("#333")!);
            
        BrowserMonitorBadge.Background = config.EnableBrowserMonitoring
            ? new SolidColorBrush((Color)ColorConverter.ConvertFromString("#0f3460")!)
            : new SolidColorBrush((Color)ColorConverter.ConvertFromString("#333")!);
            
        NetworkMonitorBadge.Visibility = config.EnableNetworkMonitoring 
            ? Visibility.Visible 
            : Visibility.Collapsed;
    }

    /// <summary>
    /// Update UI with current worker status
    /// </summary>
    public void UpdateStatus(WorkerStatus status)
    {
        // Update connection indicator
        if (status.IsConnected)
        {
            StatusIndicator.Fill = new SolidColorBrush((Color)ColorConverter.ConvertFromString("#4ecca3")!);
            StatusText.Text = "Connected";
            ConnectedText.Text = "Yes";
        }
        else
        {
            StatusIndicator.Fill = new SolidColorBrush((Color)ColorConverter.ConvertFromString("#e94560")!);
            StatusText.Text = "Disconnected";
            ConnectedText.Text = "No";
        }
        
        // Update statistics
        EventsSentText.Text = status.EventsSent.ToString("N0");
        EventsQueuedText.Text = status.EventsQueued.ToString("N0");
        ErrorCountText.Text = status.ErrorCount.ToString("N0");
        
        // Update last sync time
        LastSyncText.Text = status.LastSyncTime?.ToString("HH:mm:ss") ?? "Never";
        
        // Add to recent activity
        if (!string.IsNullOrEmpty(status.RecentLog))
        {
            var logEntry = $"[{DateTime.Now:HH:mm:ss}] {status.RecentLog}";
            _recentActivity.Insert(0, logEntry);
            
            // Keep only last 50 entries
            while (_recentActivity.Count > 50)
            {
                _recentActivity.RemoveAt(_recentActivity.Count - 1);
            }
        }
    }

    private void Settings_Click(object sender, RoutedEventArgs e)
    {
        var settingsWindow = new SettingsWindow
        {
            Owner = this
        };
        
        if (settingsWindow.ShowDialog() == true && settingsWindow.SettingsChanged)
        {
            // Reload configuration
            LoadConfiguration();
            
            // Show restart message
            var result = MessageBox.Show(
                "Settings saved successfully!\n\n" +
                "The agent needs to restart to apply changes.\n\n" +
                "Would you like to restart now?",
                "Restart Required",
                MessageBoxButton.YesNo,
                MessageBoxImage.Question);
            
            if (result == MessageBoxResult.Yes)
            {
                // Restart application
                var exePath = System.Diagnostics.Process.GetCurrentProcess().MainModule?.FileName 
                    ?? System.Reflection.Assembly.GetExecutingAssembly().Location
                    ?? AppDomain.CurrentDomain.BaseDirectory + "SasWatchAgent.exe";
                
                Application.Current.Shutdown();
                System.Diagnostics.Process.Start(exePath);
            }
        }
    }

    private void RefreshLogs_Click(object sender, RoutedEventArgs e)
    {
        RefreshLogs();
    }

    private void ClearLogs_Click(object sender, RoutedEventArgs e)
    {
        LogsTextBox.Clear();
    }

    private void RefreshLogs()
    {
        try
        {
            if (!Directory.Exists(LogPath))
            {
                LogsTextBox.Text = "Log directory not found.";
                return;
            }

            // Get the most recent log file
            var logFiles = Directory.GetFiles(LogPath, "activity-agent-*.log")
                .OrderByDescending(f => new FileInfo(f).LastWriteTime)
                .ToList();

            if (logFiles.Count == 0)
            {
                LogsTextBox.Text = "No log files found.";
                return;
            }

            // Read the most recent log file (last 1000 lines to avoid memory issues)
            var logFile = logFiles.First();
            var lines = File.ReadAllLines(logFile);
            var recentLines = lines.TakeLast(1000);
            
            var wasAutoScroll = AutoScrollCheckBox.IsChecked == true;
            var scrollPosition = LogsTextBox.SelectionStart;
            
            LogsTextBox.Text = string.Join(Environment.NewLine, recentLines);
            
            // Auto-scroll to bottom if enabled
            if (wasAutoScroll)
            {
                LogsTextBox.ScrollToEnd();
            }
        }
        catch (Exception ex)
        {
            LogsTextBox.Text = $"Error loading logs: {ex.Message}";
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

    private void HideToTray_Click(object sender, RoutedEventArgs e)
    {
        Hide();
    }
}

