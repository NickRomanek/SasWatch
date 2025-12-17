using System.Text.Json.Serialization;

namespace ActivityAgent.Service.Models;

/// <summary>
/// Payload sent to the SasWatch API - matches backend schema exactly
/// </summary>
public class TrackingPayload
{
    [JsonPropertyName("event")]
    public string Event { get; set; } = "";

    [JsonPropertyName("url")]
    public string Url { get; set; } = "";

    [JsonPropertyName("tabId")]
    public int? TabId { get; set; } = null;

    [JsonPropertyName("clientId")]
    public string ClientId { get; set; } = "";

    [JsonPropertyName("windowsUser")]
    public string WindowsUser { get; set; } = "";

    [JsonPropertyName("computerName")]
    public string ComputerName { get; set; } = "";

    [JsonPropertyName("userDomain")]
    public string UserDomain { get; set; } = "";

    [JsonPropertyName("why")]
    public string Why { get; set; } = "agent_monitor";

    [JsonPropertyName("when")]
    public string When { get; set; } = "";

    // Additional optional fields
    [JsonPropertyName("windowTitle")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? WindowTitle { get; set; }

    [JsonPropertyName("processPath")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? ProcessPath { get; set; }

    [JsonPropertyName("browser")]
    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string? Browser { get; set; }

    /// <summary>
    /// Create payload from ActivityEvent
    /// </summary>
    public static TrackingPayload FromActivityEvent(ActivityEvent evt, string clientId)
    {
        return new TrackingPayload
        {
            Event = evt.EventType,
            Url = evt.Url ?? evt.ProcessName ?? "unknown",
            ClientId = clientId,
            WindowsUser = Environment.UserName,
            ComputerName = Environment.MachineName,
            UserDomain = Environment.UserDomainName,
            Why = "agent_monitor",
            When = evt.Timestamp.ToString("o"), // ISO 8601 format
            WindowTitle = evt.WindowTitle,
            ProcessPath = evt.ProcessPath,
            Browser = evt.Browser
        };
    }
}

