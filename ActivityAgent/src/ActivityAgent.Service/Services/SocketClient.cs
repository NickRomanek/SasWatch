using System.Text;
using System.Text.Json;
using ActivityAgent.Service.Configuration;
using ActivityAgent.Service.Models;
using Microsoft.Extensions.Logging;
using SocketIOClient;
using SocketIOClient.Transport;

namespace ActivityAgent.Service.Services;

/// <summary>
/// Socket.IO client for real-time communication with SasWatch backend.
/// Falls back to HTTP when socket connection is unavailable.
/// </summary>
public class SocketClient : IDisposable
{
    private readonly AgentConfig _config;
    private readonly ILogger<SocketClient> _logger;
    private readonly string _clientId;
    private readonly HttpClient _httpClient;
    
    private SocketIOClient.SocketIO? _socket;
    private bool _isConnected;
    private bool _isConnecting;
    private int _reconnectAttempts;
    private DateTime _lastReconnectAttempt = DateTime.MinValue;
    
    private const int MaxReconnectAttempts = 10;
    private const int BaseReconnectDelayMs = 1000;
    private const int MaxReconnectDelayMs = 30000;

    public bool IsConnected => _isConnected;
    public bool UseSocketIO { get; private set; } = true;

    public event EventHandler<bool>? ConnectionStateChanged;

    public SocketClient(AgentConfig config, ILogger<SocketClient> logger)
    {
        _config = config;
        _logger = logger;
        _clientId = GetOrCreateClientId();

        // Setup HTTP client as fallback
        var handler = new HttpClientHandler
        {
            UseProxy = true,
            UseDefaultCredentials = true
        };

        _httpClient = new HttpClient(handler)
        {
            Timeout = TimeSpan.FromSeconds(10)
        };
        _httpClient.DefaultRequestHeaders.Add("X-API-Key", _config.ApiKey);
    }

    /// <summary>
    /// Initialize and connect to Socket.IO server
    /// </summary>
    public async Task ConnectAsync(CancellationToken cancellationToken = default)
    {
        if (_isConnecting || _isConnected)
        {
            _logger.LogDebug("Already connected or connecting, skipping");
            return;
        }

        _isConnecting = true;

        try
        {
            // Build Socket.IO URL (replace /api/track with /agent namespace)
            var baseUrl = _config.ApiUrl.Replace("/api/track", "");
            var socketUrl = $"{baseUrl}/agent";

            _logger.LogInformation("Connecting to Socket.IO: {Url}", socketUrl);

            _socket = new SocketIOClient.SocketIO(socketUrl, new SocketIOOptions
            {
                Auth = new { apiKey = _config.ApiKey, clientId = _clientId },
                Transport = TransportProtocol.WebSocket,
                Reconnection = true,
                ReconnectionAttempts = MaxReconnectAttempts,
                ReconnectionDelay = BaseReconnectDelayMs,
                ReconnectionDelayMax = MaxReconnectDelayMs,
                ConnectionTimeout = TimeSpan.FromSeconds(20)
            });

            SetupEventHandlers();

            await _socket.ConnectAsync();

            // Wait a bit for connection to establish
            var timeout = DateTime.UtcNow.AddSeconds(10);
            while (!_isConnected && DateTime.UtcNow < timeout && !cancellationToken.IsCancellationRequested)
            {
                await Task.Delay(100, cancellationToken);
            }

            if (!_isConnected)
            {
                _logger.LogWarning("Socket.IO connection timed out, will use HTTP fallback");
                UseSocketIO = false;
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to connect to Socket.IO, falling back to HTTP");
            UseSocketIO = false;
            _isConnected = false;
        }
        finally
        {
            _isConnecting = false;
        }
    }

    /// <summary>
    /// Setup Socket.IO event handlers
    /// </summary>
    private void SetupEventHandlers()
    {
        if (_socket == null) return;

        _socket.OnConnected += (sender, args) =>
        {
            _isConnected = true;
            _reconnectAttempts = 0;
            UseSocketIO = true;
            _logger.LogInformation("Socket.IO connected successfully");
            ConnectionStateChanged?.Invoke(this, true);
        };

        _socket.OnDisconnected += (sender, reason) =>
        {
            _isConnected = false;
            _logger.LogWarning("Socket.IO disconnected: {Reason}", reason);
            ConnectionStateChanged?.Invoke(this, false);
        };

        _socket.OnError += (sender, error) =>
        {
            _logger.LogError("Socket.IO error: {Error}", error);
        };

        _socket.OnReconnectAttempt += (sender, attempt) =>
        {
            _reconnectAttempts = attempt;
            _logger.LogInformation("Socket.IO reconnect attempt {Attempt}/{Max}", attempt, MaxReconnectAttempts);
        };

        _socket.OnReconnectFailed += (sender, args) =>
        {
            _logger.LogWarning("Socket.IO reconnection failed after {Attempts} attempts, using HTTP fallback", MaxReconnectAttempts);
            UseSocketIO = false;
        };

        // Handle server acknowledgments
        _socket.On("heartbeat", response =>
        {
            _logger.LogDebug("Heartbeat acknowledged by server");
        });
    }

    /// <summary>
    /// Send a single activity event (uses socket if connected, HTTP otherwise)
    /// </summary>
    public async Task<bool> SendEventAsync(ActivityEvent evt, CancellationToken cancellationToken = default)
    {
        var payload = TrackingPayload.FromActivityEvent(evt, _clientId);

        // Try Socket.IO first if connected
        if (_isConnected && _socket != null && UseSocketIO)
        {
            try
            {
                var tcs = new TaskCompletionSource<bool>();
                
                await _socket.EmitAsync("activity:event", response =>
                {
                    try
                    {
                        var result = response.GetValue<AckResponse>();
                        tcs.SetResult(result?.Success ?? false);
                    }
                    catch
                    {
                        tcs.SetResult(false);
                    }
                }, payload);

                // Wait for acknowledgment with timeout
                var completed = await Task.WhenAny(tcs.Task, Task.Delay(5000, cancellationToken));
                if (completed == tcs.Task && await tcs.Task)
                {
                    _logger.LogDebug("Event sent via Socket.IO: {EventType}", evt.EventType);
                    return true;
                }
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Socket.IO send failed, falling back to HTTP");
            }
        }

        // Fallback to HTTP
        return await SendEventViaHttpAsync(payload, cancellationToken);
    }

    /// <summary>
    /// Send batch of events (uses socket if connected, HTTP otherwise)
    /// </summary>
    public async Task<int> SendBatchAsync(List<ActivityEvent> events, CancellationToken cancellationToken = default)
    {
        if (events.Count == 0) return 0;

        var payloads = events.Select(e => TrackingPayload.FromActivityEvent(e, _clientId)).ToList();

        // Try Socket.IO batch if connected
        if (_isConnected && _socket != null && UseSocketIO)
        {
            try
            {
                var tcs = new TaskCompletionSource<BatchAckResponse>();

                await _socket.EmitAsync("activity:batch", response =>
                {
                    try
                    {
                        var result = response.GetValue<BatchAckResponse>();
                        tcs.SetResult(result ?? new BatchAckResponse());
                    }
                    catch
                    {
                        tcs.SetResult(new BatchAckResponse());
                    }
                }, payloads);

                // Wait for acknowledgment
                var completed = await Task.WhenAny(tcs.Task, Task.Delay(30000, cancellationToken));
                if (completed == tcs.Task)
                {
                    var result = await tcs.Task;
                    if (result.Success)
                    {
                        _logger.LogInformation("Batch sent via Socket.IO: {Processed} processed, {Failed} failed",
                            result.Processed, result.Failed);
                        return result.Processed;
                    }
                }
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Socket.IO batch send failed, falling back to HTTP");
            }
        }

        // Fallback to HTTP (send individually with rate limiting)
        return await SendBatchViaHttpAsync(events, cancellationToken);
    }

    /// <summary>
    /// Send event via HTTP (fallback)
    /// </summary>
    private async Task<bool> SendEventViaHttpAsync(TrackingPayload payload, CancellationToken cancellationToken)
    {
        try
        {
            var json = JsonSerializer.Serialize(payload);
            var content = new StringContent(json, Encoding.UTF8, "application/json");

            var response = await _httpClient.PostAsync(_config.ApiUrl, content, cancellationToken);

            if (response.IsSuccessStatusCode)
            {
                _logger.LogDebug("Event sent via HTTP: {Event}", payload.Event);
                return true;
            }

            var responseBody = await response.Content.ReadAsStringAsync(cancellationToken);
            _logger.LogWarning("HTTP API returned {StatusCode}: {Response}", response.StatusCode, responseBody);
            return false;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to send event via HTTP");
            return false;
        }
    }

    /// <summary>
    /// Send batch via HTTP (fallback with rate limiting)
    /// </summary>
    private async Task<int> SendBatchViaHttpAsync(List<ActivityEvent> events, CancellationToken cancellationToken)
    {
        int successCount = 0;

        _logger.LogInformation("Sending batch of {Count} events via HTTP (fallback)", events.Count);

        foreach (var evt in events)
        {
            if (cancellationToken.IsCancellationRequested) break;

            var payload = TrackingPayload.FromActivityEvent(evt, _clientId);
            if (await SendEventViaHttpAsync(payload, cancellationToken))
            {
                successCount++;
            }

            // Rate limiting for HTTP: ~100 req/min = 600ms between requests
            if (events.Count > 1)
            {
                await Task.Delay(700, cancellationToken);
            }
        }

        _logger.LogInformation("HTTP batch complete: {Success}/{Total} succeeded", successCount, events.Count);
        return successCount;
    }

    /// <summary>
    /// Test connection to API (tries socket first, then HTTP health check)
    /// </summary>
    public async Task<bool> TestConnectionAsync(CancellationToken cancellationToken = default)
    {
        // If socket is connected, we're good
        if (_isConnected && UseSocketIO)
        {
            _logger.LogInformation("Socket.IO connection is active");
            return true;
        }

        // Try HTTP health check
        try
        {
            _logger.LogInformation("Testing HTTP connection to {Url}", _config.HealthCheckUrl);
            var response = await _httpClient.GetAsync(_config.HealthCheckUrl, cancellationToken);

            if (response.IsSuccessStatusCode)
            {
                _logger.LogInformation("HTTP connection successful");
                return true;
            }

            _logger.LogWarning("HTTP health check returned {StatusCode}", response.StatusCode);
            return false;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to connect to API");
            return false;
        }
    }

    /// <summary>
    /// Send heartbeat to keep connection alive
    /// </summary>
    public async Task SendHeartbeatAsync(CancellationToken cancellationToken = default)
    {
        if (_isConnected && _socket != null)
        {
            try
            {
                await _socket.EmitAsync("heartbeat", new { timestamp = DateTime.UtcNow });
            }
            catch (Exception ex)
            {
                _logger.LogDebug(ex, "Heartbeat failed");
            }
        }
    }

    /// <summary>
    /// Disconnect from Socket.IO
    /// </summary>
    public async Task DisconnectAsync()
    {
        if (_socket != null)
        {
            try
            {
                await _socket.DisconnectAsync();
            }
            catch (Exception ex)
            {
                _logger.LogDebug(ex, "Error during disconnect");
            }
            finally
            {
                _isConnected = false;
            }
        }
    }

    /// <summary>
    /// Get or create unique client ID for this machine
    /// </summary>
    private string GetOrCreateClientId()
    {
        var path = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
            "ActivityAgent", "client_id.txt");

        try
        {
            if (File.Exists(path))
            {
                var id = File.ReadAllText(path).Trim();
                if (!string.IsNullOrEmpty(id))
                {
                    _logger.LogInformation("Using existing client ID: {ClientId}", id);
                    return id;
                }
            }

            var newId = Guid.NewGuid().ToString();
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            File.WriteAllText(path, newId);

            _logger.LogInformation("Generated new client ID: {ClientId}", newId);
            return newId;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to get/create client ID, using temporary ID");
            return $"temp_{Guid.NewGuid()}";
        }
    }

    public void Dispose()
    {
        _socket?.Dispose();
        _httpClient.Dispose();
    }

    // Response types for Socket.IO acknowledgments
    private class AckResponse
    {
        public bool Success { get; set; }
        public string? Error { get; set; }
    }

    private class BatchAckResponse
    {
        public bool Success { get; set; }
        public int Processed { get; set; }
        public int Failed { get; set; }
        public string? Error { get; set; }
    }
}
