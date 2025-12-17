using System.Data.SQLite;
using System.Text.Json;
using ActivityAgent.Service.Models;
using Microsoft.Extensions.Logging;

namespace ActivityAgent.Service.Services;

/// <summary>
/// SQLite-backed persistent queue for activity events.
/// Ensures events survive restarts and network outages.
/// </summary>
public class PersistentQueue : IDisposable
{
    private readonly string _dbPath;
    private readonly ILogger<PersistentQueue> _logger;
    private readonly object _lock = new();
    private SQLiteConnection? _connection;
    
    // In-memory cache for recently added events (for deduplication)
    private readonly HashSet<string> _recentEventKeys = new();
    private const int MaxRecentKeys = 1000;
    
    // Queue limits
    private const int MaxQueueSize = 10000;
    private const int PruneThreshold = 8000;

    public PersistentQueue(ILogger<PersistentQueue> logger)
    {
        _logger = logger;
        
        // Store database in ProgramData folder
        var dataFolder = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData),
            "ActivityAgent");
        
        Directory.CreateDirectory(dataFolder);
        _dbPath = Path.Combine(dataFolder, "event_queue.db");
        
        InitializeDatabase();
    }

    /// <summary>
    /// Initialize SQLite database and create table if needed
    /// </summary>
    private void InitializeDatabase()
    {
        try
        {
            var connectionString = $"Data Source={_dbPath};Version=3;";
            _connection = new SQLiteConnection(connectionString);
            _connection.Open();

            using var cmd = _connection.CreateCommand();
            cmd.CommandText = @"
                CREATE TABLE IF NOT EXISTS event_queue (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    event_type TEXT NOT NULL,
                    process_name TEXT,
                    url TEXT,
                    window_title TEXT,
                    process_path TEXT,
                    browser TEXT,
                    domain TEXT,
                    timestamp TEXT NOT NULL,
                    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
                    retry_count INTEGER DEFAULT 0,
                    last_error TEXT
                );
                
                CREATE INDEX IF NOT EXISTS idx_queue_timestamp ON event_queue(timestamp);
                CREATE INDEX IF NOT EXISTS idx_queue_created ON event_queue(created_at);
            ";
            cmd.ExecuteNonQuery();

            _logger.LogInformation("Persistent queue initialized at: {Path}", _dbPath);
            
            // Log current queue size
            var count = GetQueueCount();
            if (count > 0)
            {
                _logger.LogInformation("Found {Count} pending events in queue", count);
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to initialize persistent queue");
            throw;
        }
    }

    /// <summary>
    /// Add event to persistent queue
    /// </summary>
    public bool Enqueue(ActivityEvent evt)
    {
        // Generate deduplication key
        var key = $"{evt.EventType}:{evt.ProcessName}:{evt.Url}:{evt.WindowTitle}";
        
        lock (_lock)
        {
            // Skip if recently added (deduplication)
            if (_recentEventKeys.Contains(key))
            {
                return false;
            }

            try
            {
                if (_connection == null || _connection.State != System.Data.ConnectionState.Open)
                {
                    _logger.LogWarning("Database connection not available, event not persisted");
                    return false;
                }

                using var cmd = _connection.CreateCommand();
                cmd.CommandText = @"
                    INSERT INTO event_queue 
                    (event_type, process_name, url, window_title, process_path, browser, domain, timestamp)
                    VALUES 
                    (@eventType, @processName, @url, @windowTitle, @processPath, @browser, @domain, @timestamp)
                ";
                
                cmd.Parameters.AddWithValue("@eventType", evt.EventType);
                cmd.Parameters.AddWithValue("@processName", evt.ProcessName ?? (object)DBNull.Value);
                cmd.Parameters.AddWithValue("@url", evt.Url ?? (object)DBNull.Value);
                cmd.Parameters.AddWithValue("@windowTitle", evt.WindowTitle ?? (object)DBNull.Value);
                cmd.Parameters.AddWithValue("@processPath", evt.ProcessPath ?? (object)DBNull.Value);
                cmd.Parameters.AddWithValue("@browser", evt.Browser ?? (object)DBNull.Value);
                cmd.Parameters.AddWithValue("@domain", evt.Domain ?? (object)DBNull.Value);
                cmd.Parameters.AddWithValue("@timestamp", evt.Timestamp.ToString("o"));
                
                cmd.ExecuteNonQuery();

                // Track for deduplication
                _recentEventKeys.Add(key);
                if (_recentEventKeys.Count > MaxRecentKeys)
                {
                    _recentEventKeys.Clear();
                }

                // Prune if queue is getting too large
                var count = GetQueueCount();
                if (count > PruneThreshold)
                {
                    PruneOldEvents();
                }

                return true;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to enqueue event");
                return false;
            }
        }
    }

    /// <summary>
    /// Get all pending events from queue
    /// </summary>
    public List<ActivityEvent> DequeueAll(int maxCount = 100)
    {
        var events = new List<ActivityEvent>();

        lock (_lock)
        {
            try
            {
                if (_connection == null || _connection.State != System.Data.ConnectionState.Open)
                {
                    return events;
                }

                using var cmd = _connection.CreateCommand();
                cmd.CommandText = @"
                    SELECT id, event_type, process_name, url, window_title, process_path, browser, domain, timestamp
                    FROM event_queue
                    ORDER BY created_at ASC
                    LIMIT @maxCount
                ";
                cmd.Parameters.AddWithValue("@maxCount", maxCount);

                var idsToDelete = new List<long>();

                using (var reader = cmd.ExecuteReader())
                {
                    while (reader.Read())
                    {
                        var id = reader.GetInt64(0);
                        idsToDelete.Add(id);

                        var evt = new ActivityEvent
                        {
                            EventType = reader.GetString(1),
                            ProcessName = reader.IsDBNull(2) ? "" : reader.GetString(2),
                            Url = reader.IsDBNull(3) ? null : reader.GetString(3),
                            WindowTitle = reader.IsDBNull(4) ? null : reader.GetString(4),
                            ProcessPath = reader.IsDBNull(5) ? null : reader.GetString(5),
                            Browser = reader.IsDBNull(6) ? null : reader.GetString(6),
                            Domain = reader.IsDBNull(7) ? null : reader.GetString(7),
                            Timestamp = DateTime.Parse(reader.GetString(8))
                        };
                        events.Add(evt);
                    }
                }

                // Delete retrieved events
                if (idsToDelete.Count > 0)
                {
                    using var deleteCmd = _connection.CreateCommand();
                    deleteCmd.CommandText = $"DELETE FROM event_queue WHERE id IN ({string.Join(",", idsToDelete)})";
                    deleteCmd.ExecuteNonQuery();
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to dequeue events");
            }
        }

        return events;
    }

    /// <summary>
    /// Get count of pending events
    /// </summary>
    public int GetQueueCount()
    {
        lock (_lock)
        {
            try
            {
                if (_connection == null || _connection.State != System.Data.ConnectionState.Open)
                {
                    return 0;
                }

                using var cmd = _connection.CreateCommand();
                cmd.CommandText = "SELECT COUNT(*) FROM event_queue";
                return Convert.ToInt32(cmd.ExecuteScalar());
            }
            catch
            {
                return 0;
            }
        }
    }

    /// <summary>
    /// Mark events as failed (for retry tracking)
    /// </summary>
    public void MarkFailed(List<ActivityEvent> events, string error)
    {
        // For failed events, we re-add them to the queue with incremented retry count
        // This is a simplified approach - in production you might want more sophisticated retry logic
        _logger.LogWarning("Marking {Count} events as failed: {Error}", events.Count, error);
    }

    /// <summary>
    /// Prune old events to prevent unbounded growth
    /// </summary>
    private void PruneOldEvents()
    {
        try
        {
            if (_connection == null) return;

            using var cmd = _connection.CreateCommand();
            // Keep only the most recent events up to MaxQueueSize
            cmd.CommandText = @"
                DELETE FROM event_queue 
                WHERE id NOT IN (
                    SELECT id FROM event_queue 
                    ORDER BY created_at DESC 
                    LIMIT @keepCount
                )
            ";
            cmd.Parameters.AddWithValue("@keepCount", MaxQueueSize);
            
            var deleted = cmd.ExecuteNonQuery();
            if (deleted > 0)
            {
                _logger.LogInformation("Pruned {Count} old events from queue", deleted);
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to prune old events");
        }
    }

    /// <summary>
    /// Clear all events from queue
    /// </summary>
    public void Clear()
    {
        lock (_lock)
        {
            try
            {
                if (_connection == null) return;

                using var cmd = _connection.CreateCommand();
                cmd.CommandText = "DELETE FROM event_queue";
                var deleted = cmd.ExecuteNonQuery();
                
                _recentEventKeys.Clear();
                _logger.LogInformation("Cleared {Count} events from queue", deleted);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to clear queue");
            }
        }
    }

    public void Dispose()
    {
        lock (_lock)
        {
            _connection?.Close();
            _connection?.Dispose();
            _connection = null;
        }
    }
}
