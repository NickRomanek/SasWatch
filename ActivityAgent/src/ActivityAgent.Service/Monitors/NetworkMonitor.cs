using System.Net;
using System.Net.NetworkInformation;
using ActivityAgent.Service.Models;
using ActivityAgent.Service.Services;
using Microsoft.Extensions.Logging;

namespace ActivityAgent.Service.Monitors;

/// <summary>
/// Monitors network connections to external domains
/// </summary>
public class NetworkMonitor : IMonitor
{
    private readonly EventQueue _eventQueue;
    private readonly ILogger _logger;
    private readonly Dictionary<string, DateTime> _recentDomains = new();
    private Timer? _timer;
    private bool _isRunning;

    public string Name => "Network Monitor";

    public NetworkMonitor(EventQueue eventQueue, ILogger logger)
    {
        _eventQueue = eventQueue;
        _logger = logger;
    }

    public void Start()
    {
        if (_isRunning) return;

        _isRunning = true;
        _logger.LogInformation("{MonitorName} starting...", Name);

        // Check network connections every 30 seconds
        _timer = new Timer(CheckConnections, null, TimeSpan.Zero, TimeSpan.FromSeconds(30));
    }

    public void Stop()
    {
        _isRunning = false;
        _timer?.Dispose();
        _logger.LogInformation("{MonitorName} stopped", Name);
    }

    private void CheckConnections(object? state)
    {
        if (!_isRunning) return;

        try
        {
            var properties = IPGlobalProperties.GetIPGlobalProperties();
            var connections = properties.GetActiveTcpConnections()
                .Where(c => c.State == TcpState.Established)
                .Where(c => !IsPrivateIp(c.RemoteEndPoint.Address.ToString()));

            foreach (var conn in connections)
            {
                try
                {
                    var ip = conn.RemoteEndPoint.Address.ToString();

                    // Try to resolve IP to hostname
                    string domain;
                    try
                    {
                        var hostEntry = Dns.GetHostEntry(ip);
                        domain = hostEntry.HostName;
                    }
                    catch
                    {
                        // DNS resolution failed, use IP
                        domain = ip;
                    }

                    // Only report each domain once per hour
                    if (_recentDomains.TryGetValue(domain, out var lastReported))
                    {
                        if ((DateTime.UtcNow - lastReported).TotalHours < 1)
                        {
                            continue;
                        }
                    }

                    _recentDomains[domain] = DateTime.UtcNow;

                    var evt = new ActivityEvent
                    {
                        EventType = "network_activity",
                        ProcessName = "Network",
                        Url = domain,
                        Domain = domain,
                        Timestamp = DateTime.UtcNow
                    };

                    _eventQueue.Enqueue(evt);
                    _logger.LogDebug("Network connection: {Domain}", domain);
                }
                catch (Exception ex)
                {
                    _logger.LogTrace(ex, "Error processing connection");
                }
            }

            // Clean up old entries
            if (_recentDomains.Count > 1000)
            {
                var cutoff = DateTime.UtcNow.AddHours(-24);
                var oldKeys = _recentDomains.Where(kvp => kvp.Value < cutoff).Select(kvp => kvp.Key).ToList();
                foreach (var key in oldKeys)
                {
                    _recentDomains.Remove(key);
                }
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error in {MonitorName}", Name);
        }
    }

    private static bool IsPrivateIp(string ip)
    {
        return ip.StartsWith("10.") ||
               ip.StartsWith("192.168.") ||
               ip.StartsWith("172.16.") ||
               ip.StartsWith("172.17.") ||
               ip.StartsWith("172.18.") ||
               ip.StartsWith("172.19.") ||
               ip.StartsWith("172.20.") ||
               ip.StartsWith("172.21.") ||
               ip.StartsWith("172.22.") ||
               ip.StartsWith("172.23.") ||
               ip.StartsWith("172.24.") ||
               ip.StartsWith("172.25.") ||
               ip.StartsWith("172.26.") ||
               ip.StartsWith("172.27.") ||
               ip.StartsWith("172.28.") ||
               ip.StartsWith("172.29.") ||
               ip.StartsWith("172.30.") ||
               ip.StartsWith("172.31.") ||
               ip.StartsWith("127.") ||
               ip.StartsWith("169.254.");
    }
}

