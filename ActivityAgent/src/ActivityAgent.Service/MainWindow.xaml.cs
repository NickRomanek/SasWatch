using System.Collections.ObjectModel;
using System.Diagnostics;
using System.IO;
using System.Windows;
using System.Windows.Media;
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

    private void HideToTray_Click(object sender, RoutedEventArgs e)
    {
        Hide();
    }
}

