using Microsoft.Win32;

namespace ActivityAgent.Service.Configuration;

/// <summary>
/// Configuration for the Activity Agent, loaded from Windows Registry
/// </summary>
public class AgentConfig
{
    public string ApiUrl { get; set; } = "https://your-app.railway.app/api/track";
    public string ApiKey { get; set; } = "";
    public string HealthCheckUrl => ApiUrl.Replace("/api/track", "/api/health");
    
    /// <summary>
    /// How often to send queued events to the API (seconds)
    /// </summary>
    public int CheckIntervalSeconds { get; set; } = 30;
    
    /// <summary>
    /// Track web browsing (browser URLs/domains)
    /// </summary>
    public bool EnableBrowserMonitoring { get; set; } = true;
    
    /// <summary>
    /// Track network connections - DISABLED by default (high volume, low value)
    /// </summary>
    public bool EnableNetworkMonitoring { get; set; } = false;
    
    /// <summary>
    /// Track application launches
    /// </summary>
    public bool EnableApplicationMonitoring { get; set; } = true;
    
    /// <summary>
    /// Track window focus changes - Now only tracks browser URLs when enabled
    /// </summary>
    public bool EnableWindowFocusMonitoring { get; set; } = true;

    /// <summary>
    /// Load configuration from Windows Registry
    /// Location: HKLM\Software\ActivityAgent
    /// </summary>
    public static AgentConfig LoadFromRegistry()
    {
        var config = new AgentConfig();

        try
        {
            using var key = Registry.LocalMachine.OpenSubKey(@"Software\ActivityAgent");
            if (key == null)
            {
                Console.WriteLine("Registry key not found: HKLM\\Software\\ActivityAgent");
                return config;
            }

            config.ApiUrl = key.GetValue("ApiUrl") as string ?? config.ApiUrl;
            config.ApiKey = key.GetValue("ApiKey") as string ?? config.ApiKey;
            
            if (key.GetValue("CheckInterval") is int interval)
            {
                config.CheckIntervalSeconds = interval;
            }

            // Use property defaults to keep in sync
            config.EnableBrowserMonitoring = GetBoolValue(key, "EnableBrowser", config.EnableBrowserMonitoring);
            config.EnableNetworkMonitoring = GetBoolValue(key, "EnableNetwork", config.EnableNetworkMonitoring);
            config.EnableApplicationMonitoring = GetBoolValue(key, "EnableApps", config.EnableApplicationMonitoring);
            config.EnableWindowFocusMonitoring = GetBoolValue(key, "EnableWindowFocus", config.EnableWindowFocusMonitoring);

            Console.WriteLine($"Configuration loaded from registry:");
            Console.WriteLine($"  API URL: {config.ApiUrl}");
            Console.WriteLine($"  API Key: {(string.IsNullOrEmpty(config.ApiKey) ? "NOT SET" : "***")}");
            Console.WriteLine($"  Check Interval: {config.CheckIntervalSeconds}s");
            Console.WriteLine($"  Monitors:");
            Console.WriteLine($"    Application Monitoring: {(config.EnableApplicationMonitoring ? "ENABLED" : "DISABLED")}");
            Console.WriteLine($"    Browser Monitoring: {(config.EnableBrowserMonitoring ? "ENABLED" : "DISABLED")}");
            Console.WriteLine($"    Window Focus Monitoring: {(config.EnableWindowFocusMonitoring ? "ENABLED" : "DISABLED")}");
            Console.WriteLine($"    Network Monitoring: {(config.EnableNetworkMonitoring ? "ENABLED" : "DISABLED")}");
        }
        catch (Exception ex)
        {
            Console.WriteLine($"Error loading configuration from registry: {ex.Message}");
        }

        return config;
    }

    private static bool GetBoolValue(RegistryKey key, string name, bool defaultValue)
    {
        var value = key.GetValue(name);
        if (value is int intValue)
        {
            return intValue != 0;
        }
        return defaultValue;
    }

    /// <summary>
    /// Save configuration to Windows Registry
    /// Requires administrator privileges
    /// </summary>
    public static bool SaveToRegistry(AgentConfig config)
    {
        try
        {
            using var key = Registry.LocalMachine.CreateSubKey(@"Software\ActivityAgent", true);
            if (key == null)
            {
                return false;
            }

            key.SetValue("ApiUrl", config.ApiUrl ?? "", RegistryValueKind.String);
            key.SetValue("ApiKey", config.ApiKey ?? "", RegistryValueKind.String);
            key.SetValue("CheckInterval", config.CheckIntervalSeconds, RegistryValueKind.DWord);
            key.SetValue("EnableApps", config.EnableApplicationMonitoring ? 1 : 0, RegistryValueKind.DWord);
            key.SetValue("EnableBrowser", config.EnableBrowserMonitoring ? 1 : 0, RegistryValueKind.DWord);
            key.SetValue("EnableWindowFocus", config.EnableWindowFocusMonitoring ? 1 : 0, RegistryValueKind.DWord);
            key.SetValue("EnableNetwork", config.EnableNetworkMonitoring ? 1 : 0, RegistryValueKind.DWord);

            return true;
        }
        catch (UnauthorizedAccessException)
        {
            // Need admin rights to write to HKLM
            return false;
        }
        catch (Exception ex)
        {
            Console.WriteLine($"Error saving configuration: {ex.Message}");
            return false;
        }
    }

    /// <summary>
    /// Validate configuration
    /// </summary>
    public bool IsValid()
    {
        if (string.IsNullOrWhiteSpace(ApiUrl))
        {
            Console.WriteLine("ERROR: ApiUrl is not configured");
            return false;
        }

        if (string.IsNullOrWhiteSpace(ApiKey))
        {
            Console.WriteLine("ERROR: ApiKey is not configured");
            return false;
        }

        if (CheckIntervalSeconds < 1)
        {
            Console.WriteLine("ERROR: CheckInterval must be at least 1 second");
            return false;
        }

        return true;
    }
}

