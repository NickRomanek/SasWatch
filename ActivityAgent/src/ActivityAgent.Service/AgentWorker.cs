using ActivityAgent.Service.Configuration;
using ActivityAgent.Service.Monitors;
using ActivityAgent.Service.Services;
using Microsoft.Extensions.Logging;

namespace ActivityAgent.Service;

/// <summary>
/// Status information for UI updates
/// </summary>
public class WorkerStatus
{
    public bool IsConnected { get; set; }
    public int EventsSent { get; set; }
    public int EventsQueued { get; set; }
    public int ErrorCount { get; set; }
    public DateTime? LastSyncTime { get; set; }
    public string? RecentLog { get; set; }
}

/// <summary>
/// Main worker that coordinates all monitors and sends data to API.
/// Refactored from BackgroundService for WPF tray application use.
/// </summary>
public class AgentWorker : IDisposable
{
    private readonly ILogger<AgentWorker> _logger;
    private readonly AgentConfig _config;
    private readonly SocketClient _socketClient;
    private readonly PersistentQueue _persistentQueue;
    private readonly EventQueue _eventQueue;
    private readonly List<IMonitor> _monitors;
    
    // Statistics for UI
    private int _eventsSent;
    private int _errorCount;
    private DateTime? _lastSyncTime;

    // Heartbeat interval for keeping socket connection alive
    private const int HeartbeatIntervalSeconds = 60;
    private DateTime _lastHeartbeat = DateTime.MinValue;
    
    private bool _isRunning;
    private bool _disposed;

    public event EventHandler<WorkerStatus>? StatusChanged;

    public AgentWorker(AgentConfig config, ILoggerFactory loggerFactory)
    {
        _config = config;
        _logger = loggerFactory.CreateLogger<AgentWorker>();
        _eventQueue = new EventQueue();

        // Initialize Socket.IO client (primary) with HTTP fallback
        var socketLogger = loggerFactory.CreateLogger<SocketClient>();
        _socketClient = new SocketClient(_config, socketLogger);
        
        // Initialize persistent queue for offline resilience
        var queueLogger = loggerFactory.CreateLogger<PersistentQueue>();
        _persistentQueue = new PersistentQueue(queueLogger);

        // Track connection state changes
        _socketClient.ConnectionStateChanged += OnConnectionStateChanged;

        // Initialize monitors based on configuration
        _monitors = new List<IMonitor>();

        if (_config.EnableApplicationMonitoring)
        {
            _monitors.Add(new ApplicationMonitor(_eventQueue, _logger));
        }

        if (_config.EnableWindowFocusMonitoring)
        {
            _monitors.Add(new WindowFocusMonitor(_eventQueue, _logger));
        }

        if (_config.EnableNetworkMonitoring)
        {
            _monitors.Add(new NetworkMonitor(_eventQueue, _logger));
        }
    }

    private void OnConnectionStateChanged(object? sender, bool isConnected)
    {
        if (isConnected)
        {
            _logger.LogInformation("Real-time connection established");
            RaiseStatusChanged("Connected to server");
        }
        else
        {
            _logger.LogWarning("Real-time connection lost - events will be queued");
            RaiseStatusChanged("Connection lost");
        }
    }

    public async Task StartAsync(CancellationToken cancellationToken)
    {
        _isRunning = true;
        
        _logger.LogInformation("==============================================");
        _logger.LogInformation("Activity Agent Starting");
        _logger.LogInformation("==============================================");
        _logger.LogInformation("API URL: {ApiUrl}", _config.ApiUrl);
        _logger.LogInformation("Check Interval: {Interval}s", _config.CheckIntervalSeconds);
        _logger.LogInformation("Monitors Enabled: {Count}", _monitors.Count);

        RaiseStatusChanged("Starting...");

        // Connect to Socket.IO (attempts real-time connection)
        _logger.LogInformation("Connecting to backend...");
        await _socketClient.ConnectAsync(cancellationToken);
        
        if (_socketClient.IsConnected)
        {
            _logger.LogInformation("Real-time connection established via Socket.IO");
            RaiseStatusChanged("Connected via Socket.IO");
        }
        else
        {
            _logger.LogWarning("Socket.IO connection failed - using HTTP fallback mode");
            RaiseStatusChanged("Using HTTP fallback");
        }

        // Test connection
        var connected = await _socketClient.TestConnectionAsync(cancellationToken);
        if (!connected)
        {
            _logger.LogWarning("Cannot reach API - will retry later");
            RaiseStatusChanged("API unreachable - will retry");
        }

        // Process any events that were queued while offline
        await ProcessPersistentQueueAsync(cancellationToken);

        // Start all monitors
        foreach (var monitor in _monitors)
        {
            try
            {
                monitor.Start();
                _logger.LogInformation("Started: {MonitorName}", monitor.Name);
                RaiseStatusChanged($"Started {monitor.Name}");
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to start {MonitorName}", monitor.Name);
                _errorCount++;
            }
        }

        _logger.LogInformation("All monitors started. Beginning main loop...");
        RaiseStatusChanged("Monitoring active");

        // Main loop
        while (!cancellationToken.IsCancellationRequested && _isRunning)
        {
            try
            {
                await ProcessEventsAsync(cancellationToken);
                await Task.Delay(TimeSpan.FromSeconds(_config.CheckIntervalSeconds), cancellationToken);
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error in main loop");
                _errorCount++;
                RaiseStatusChanged($"Error: {ex.Message}");
                await Task.Delay(TimeSpan.FromSeconds(30), cancellationToken);
            }
        }

        await CleanupAsync();
    }

    private async Task ProcessEventsAsync(CancellationToken cancellationToken)
    {
        // Get events from in-memory queue
        var events = _eventQueue.DequeueAll();

        if (events.Count > 0)
        {
            _logger.LogInformation("Processing {Count} events from queue", events.Count);

            if (_socketClient.IsConnected && _socketClient.UseSocketIO)
            {
                // Send in real-time via Socket.IO
                var sent = await _socketClient.SendBatchAsync(events, cancellationToken);
                _eventsSent += sent;
                _lastSyncTime = DateTime.Now;
                
                if (sent < events.Count)
                {
                    // Queue failed events for retry
                    var failedEvents = events.Skip(sent).ToList();
                    foreach (var evt in failedEvents)
                    {
                        _persistentQueue.Enqueue(evt);
                    }
                    _logger.LogWarning("{Failed} events queued for retry", failedEvents.Count);
                }
                
                RaiseStatusChanged($"Sent {sent} events");
            }
            else
            {
                // No socket connection - persist events for later
                foreach (var evt in events)
                {
                    _persistentQueue.Enqueue(evt);
                }
                _logger.LogInformation("Events persisted to queue (socket not connected)");
                
                // Try to send via HTTP fallback
                await ProcessPersistentQueueAsync(cancellationToken);
            }
        }

        // Send heartbeat to keep connection alive
        if (_socketClient.IsConnected && 
            (DateTime.UtcNow - _lastHeartbeat).TotalSeconds > HeartbeatIntervalSeconds)
        {
            await _socketClient.SendHeartbeatAsync(cancellationToken);
            _lastHeartbeat = DateTime.UtcNow;
        }

        // Periodically process persistent queue (retry failed events)
        var pendingCount = _persistentQueue.GetQueueCount();
        if (pendingCount > 0)
        {
            _logger.LogDebug("Persistent queue has {Count} pending events", pendingCount);
            await ProcessPersistentQueueAsync(cancellationToken);
        }
        
        // Always update status
        RaiseStatusChanged(null);
    }

    private async Task ProcessPersistentQueueAsync(CancellationToken cancellationToken)
    {
        try
        {
            var pendingEvents = _persistentQueue.DequeueAll(50);
            
            if (pendingEvents.Count == 0)
            {
                return;
            }

            _logger.LogInformation("Retrying {Count} events from persistent queue", pendingEvents.Count);
            
            var sent = await _socketClient.SendBatchAsync(pendingEvents, cancellationToken);
            _eventsSent += sent;
            _lastSyncTime = DateTime.Now;
            
            if (sent < pendingEvents.Count)
            {
                var failedEvents = pendingEvents.Skip(sent).ToList();
                foreach (var evt in failedEvents)
                {
                    _persistentQueue.Enqueue(evt);
                }
                _logger.LogWarning("{Failed} events failed to send, re-queued", failedEvents.Count);
            }
            else
            {
                _logger.LogInformation("Successfully sent {Count} events from persistent queue", sent);
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error processing persistent queue");
            _errorCount++;
        }
    }

    private void RaiseStatusChanged(string? logMessage)
    {
        StatusChanged?.Invoke(this, new WorkerStatus
        {
            IsConnected = _socketClient.IsConnected,
            EventsSent = _eventsSent,
            EventsQueued = _eventQueue.Count + _persistentQueue.GetQueueCount(),
            ErrorCount = _errorCount,
            LastSyncTime = _lastSyncTime,
            RecentLog = logMessage
        });
    }

    public async Task StopAsync()
    {
        _isRunning = false;
        await CleanupAsync();
    }

    private async Task CleanupAsync()
    {
        _logger.LogInformation("Stopping all monitors...");
        
        foreach (var monitor in _monitors)
        {
            try
            {
                monitor.Stop();
                _logger.LogInformation("Stopped: {MonitorName}", monitor.Name);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error stopping {MonitorName}", monitor.Name);
            }
        }

        // Disconnect socket
        await _socketClient.DisconnectAsync();
        
        _logger.LogInformation("Activity Agent Stopped");
        RaiseStatusChanged("Stopped");
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        
        _persistentQueue.Dispose();
        _socketClient.Dispose();
    }
}

