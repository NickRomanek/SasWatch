using System.Collections.Concurrent;
using ActivityAgent.Service.Models;

namespace ActivityAgent.Service.Services;

/// <summary>
/// Thread-safe in-memory queue for activity events
/// </summary>
public class EventQueue
{
    private readonly ConcurrentQueue<ActivityEvent> _queue = new();
    private readonly HashSet<string> _recentEvents = new();
    private readonly object _lock = new();
    private const int MaxRecentEvents = 1000;

    /// <summary>
    /// Add event to queue (with deduplication)
    /// </summary>
    public void Enqueue(ActivityEvent evt)
    {
        // Create a unique key for deduplication
        var key = $"{evt.EventType}:{evt.ProcessName}:{evt.Url}:{evt.WindowTitle}";

        lock (_lock)
        {
            // Skip if we've seen this exact event recently
            if (_recentEvents.Contains(key))
            {
                return;
            }

            _recentEvents.Add(key);
            _queue.Enqueue(evt);

            // Prevent memory growth
            if (_recentEvents.Count > MaxRecentEvents)
            {
                _recentEvents.Clear();
            }
        }
    }

    /// <summary>
    /// Get all events from queue
    /// </summary>
    public List<ActivityEvent> DequeueAll()
    {
        var events = new List<ActivityEvent>();

        while (_queue.TryDequeue(out var evt))
        {
            events.Add(evt);
        }

        return events;
    }

    /// <summary>
    /// Get current queue size
    /// </summary>
    public int Count => _queue.Count;
}

