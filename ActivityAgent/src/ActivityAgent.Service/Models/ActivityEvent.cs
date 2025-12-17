namespace ActivityAgent.Service.Models;

/// <summary>
/// Represents an activity event detected by a monitor
/// </summary>
public class ActivityEvent
{
    public string EventType { get; set; } = "";
    public string ProcessName { get; set; } = "";
    public string? Url { get; set; }
    public string? WindowTitle { get; set; }
    public string? ProcessPath { get; set; }
    public string? Browser { get; set; }
    public string? Domain { get; set; }
    public DateTime Timestamp { get; set; } = DateTime.UtcNow;

    public override string ToString()
    {
        return $"[{EventType}] {ProcessName} - {WindowTitle ?? Url ?? "N/A"}";
    }
}

