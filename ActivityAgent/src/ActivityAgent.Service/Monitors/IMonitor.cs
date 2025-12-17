namespace ActivityAgent.Service.Monitors;

/// <summary>
/// Interface for activity monitors
/// </summary>
public interface IMonitor
{
    /// <summary>
    /// Start monitoring
    /// </summary>
    void Start();

    /// <summary>
    /// Stop monitoring
    /// </summary>
    void Stop();

    /// <summary>
    /// Get monitor name
    /// </summary>
    string Name { get; }
}

