using System.Text;
using System.Text.Json;
using ActivityAgent.Service.Configuration;
using ActivityAgent.Service.Models;
using Microsoft.Extensions.Logging;

namespace ActivityAgent.Service.Services;

/// <summary>
/// HTTP client for communicating with SasWatch backend API
/// </summary>
public class ApiClient
{
    private readonly HttpClient _httpClient;
    private readonly AgentConfig _config;
    private readonly string _clientId;
    private readonly ILogger<ApiClient> _logger;

    public ApiClient(AgentConfig config, ILogger<ApiClient> logger)
    {
        _config = config;
        _logger = logger;
        _clientId = GetOrCreateClientId();

        // Configure HTTP client
        var handler = new HttpClientHandler
        {
            UseProxy = true,
            UseDefaultCredentials = true
        };

        _httpClient = new HttpClient(handler)
        {
            Timeout = TimeSpan.FromSeconds(5)
        };

        // Set API key header (matches SasWatch backend auth)
        _httpClient.DefaultRequestHeaders.Add("X-API-Key", _config.ApiKey);
    }

    /// <summary>
    /// Test connection to API
    /// </summary>
    public async Task<bool> TestConnectionAsync()
    {
        try
        {
            _logger.LogInformation("Testing API connection to {Url}", _config.HealthCheckUrl);
            var response = await _httpClient.GetAsync(_config.HealthCheckUrl);
            
            if (response.IsSuccessStatusCode)
            {
                _logger.LogInformation("API connection successful");
                return true;
            }

            _logger.LogWarning("API health check returned {StatusCode}", response.StatusCode);
            return false;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to connect to API");
            return false;
        }
    }

    /// <summary>
    /// Send single event to API
    /// </summary>
    public async Task<bool> SendEventAsync(ActivityEvent evt)
    {
        try
        {
            var payload = TrackingPayload.FromActivityEvent(evt, _clientId);
            var json = JsonSerializer.Serialize(payload);
            var content = new StringContent(json, Encoding.UTF8, "application/json");

            var response = await _httpClient.PostAsync(_config.ApiUrl, content);

            if (response.IsSuccessStatusCode)
            {
                _logger.LogDebug("Event sent: {EventType} - {Url}", evt.EventType, evt.Url ?? evt.ProcessName);
                return true;
            }

            var responseBody = await response.Content.ReadAsStringAsync();
            _logger.LogWarning("API returned {StatusCode}: {Response}", response.StatusCode, responseBody);
            return false;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to send event: {Event}", evt);
            return false;
        }
    }

    /// <summary>
    /// Send batch of events to API (with rate limiting)
    /// </summary>
    public async Task<int> SendBatchAsync(List<ActivityEvent> events)
    {
        if (events.Count == 0)
        {
            return 0;
        }

        int successCount = 0;
        int failCount = 0;

        _logger.LogInformation("Sending batch of {Count} events", events.Count);

        foreach (var evt in events)
        {
            if (await SendEventAsync(evt))
            {
                successCount++;
            }
            else
            {
                failCount++;
            }

            // Rate limiting: 100 req/min = ~600ms between requests
            // Add small delay to avoid hitting rate limit
            if (events.Count > 1)
            {
                await Task.Delay(700);
            }
        }

        if (failCount > 0)
        {
            _logger.LogWarning("Batch complete: {Success} succeeded, {Failed} failed", successCount, failCount);
        }
        else
        {
            _logger.LogInformation("Batch complete: {Success} events sent successfully", successCount);
        }

        return successCount;
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
}

