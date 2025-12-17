using ActivityAgent.Service.Configuration;
using ActivityAgent.Service.Monitors;
using ActivityAgent.Service.Services;

namespace ActivityAgent.Service;

/// <summary>
/// Main worker service that coordinates all monitors and sends data to API.
/// Uses Socket.IO for real-time communication with HTTP fallback.
/// </summary>
public class Worker : BackgroundService
{
    private readonly ILogger<Worker> _logger;
    private readonly AgentConfig _config;
    private readonly SocketClient _socketClient;
    private readonly PersistentQueue _persistentQueue;
    private readonly EventQueue _eventQueue;
    private readonly List<IMonitor> _monitors;
    private readonly ILoggerFactory _loggerFactory;

    // Heartbeat interval for keeping socket connection alive
    private const int HeartbeatIntervalSeconds = 60;
    private DateTime _lastHeartbeat = DateTime.MinValue;

    public Worker(ILogger<Worker> logger, ILoggerFactory loggerFactory)
    {
        _logger = logger;
        _loggerFactory = loggerFactory;
        _config = AgentConfig.LoadFromRegistry();
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
            _monitors.Add(new ApplicationMonitor(_eventQueue, logger));
        }

        if (_config.EnableWindowFocusMonitoring)
        {
            _monitors.Add(new WindowFocusMonitor(_eventQueue, logger));
        }

        if (_config.EnableNetworkMonitoring)
        {
            _monitors.Add(new NetworkMonitor(_eventQueue, logger));
        }
    }

    private void OnConnectionStateChanged(object? sender, bool isConnected)
    {
        if (isConnected)
        {
            _logger.LogInformation("Real-time connection established");
            // Process any pending events from persistent queue
            _ = ProcessPersistentQueueAsync(CancellationToken.None);
        }
        else
        {
            _logger.LogWarning("Real-time connection lost - events will be queued");
        }
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("==============================================");
        _logger.LogInformation("Activity Agent Service Starting");
        _logger.LogInformation("==============================================");
        _logger.LogInformation("API URL: {ApiUrl}", _config.ApiUrl);
        _logger.LogInformation("Check Interval: {Interval}s", _config.CheckIntervalSeconds);
        _logger.LogInformation("Monitors Enabled: {Count}", _monitors.Count);
        _logger.LogInformation("Real-Time Mode: Socket.IO with HTTP fallback");

        // Validate configuration
        if (!_config.IsValid())
        {
            _logger.LogError("Invalid configuration. Service cannot start.");
            _logger.LogError("Please configure the agent via registry: HKLM\\Software\\ActivityAgent");
            _logger.LogError("Required keys: ApiUrl, ApiKey");
            return;
        }

        // Connect to Socket.IO (attempts real-time connection)
        _logger.LogInformation("Connecting to backend...");
        await _socketClient.ConnectAsync(stoppingToken);
        
        if (_socketClient.IsConnected)
        {
            _logger.LogInformation("Real-time connection established via Socket.IO");
        }
        else
        {
            _logger.LogWarning("Socket.IO connection failed - using HTTP fallback mode");
        }

        // Test connection (socket or HTTP)
        var connected = await _socketClient.TestConnectionAsync(stoppingToken);
        if (!connected)
        {
            _logger.LogWarning("Cannot reach API - will retry later");
        }

        // Process any events that were queued while offline
        await ProcessPersistentQueueAsync(stoppingToken);

        // Start all monitors
        foreach (var monitor in _monitors)
        {
            try
            {
                monitor.Start();
                _logger.LogInformation("Started: {MonitorName}", monitor.Name);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to start {MonitorName}", monitor.Name);
            }
        }

        _logger.LogInformation("All monitors started. Beginning main loop...");
        _logger.LogInformation("==============================================");

        // Main loop - collect events and send to API
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                // Get events from in-memory queue
                var events = _eventQueue.DequeueAll();

                if (events.Count > 0)
                {
                    _logger.LogInformation("Processing {Count} events from queue", events.Count);

                    // If socket is connected, send immediately (real-time)
                    if (_socketClient.IsConnected && _socketClient.UseSocketIO)
                    {
                        // Send in real-time via Socket.IO
                        var sent = await _socketClient.SendBatchAsync(events, stoppingToken);
                        
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
                        await ProcessPersistentQueueAsync(stoppingToken);
                    }
                }
                else
                {
                    _logger.LogDebug("No events in queue");
                }

                // Send heartbeat to keep connection alive
                if (_socketClient.IsConnected && 
                    (DateTime.UtcNow - _lastHeartbeat).TotalSeconds > HeartbeatIntervalSeconds)
                {
                    await _socketClient.SendHeartbeatAsync(stoppingToken);
                    _lastHeartbeat = DateTime.UtcNow;
                }

                // Periodically process persistent queue (retry failed events)
                var pendingCount = _persistentQueue.GetQueueCount();
                if (pendingCount > 0)
                {
                    _logger.LogDebug("Persistent queue has {Count} pending events", pendingCount);
                    await ProcessPersistentQueueAsync(stoppingToken);
                }

                // Wait before next check
                await Task.Delay(TimeSpan.FromSeconds(_config.CheckIntervalSeconds), stoppingToken);
            }
            catch (OperationCanceledException)
            {
                // Service is stopping
                break;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error in main loop");
                await Task.Delay(TimeSpan.FromSeconds(30), stoppingToken);
            }
        }

        // Cleanup
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
        _persistentQueue.Dispose();
        _socketClient.Dispose();

        _logger.LogInformation("Activity Agent Service Stopped");
    }

    /// <summary>
    /// Process events from persistent queue (retry sending failed events)
    /// </summary>
    private async Task ProcessPersistentQueueAsync(CancellationToken stoppingToken)
    {
        try
        {
            var pendingEvents = _persistentQueue.DequeueAll(50); // Process in batches
            
            if (pendingEvents.Count == 0)
            {
                return;
            }

            _logger.LogInformation("Retrying {Count} events from persistent queue", pendingEvents.Count);
            
            var sent = await _socketClient.SendBatchAsync(pendingEvents, stoppingToken);
            
            if (sent < pendingEvents.Count)
            {
                // Re-queue failed events
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
        }
    }
}
