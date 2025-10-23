// Options page functionality

document.addEventListener('DOMContentLoaded', async () => {
    // Load current configuration
    const config = await chrome.storage.local.get(['apiUrl', 'apiKey', 'clientId']);
    
    if (config.apiUrl) {
        document.getElementById('apiUrl').value = config.apiUrl;
    }
    
    if (config.apiKey) {
        document.getElementById('apiKey').value = config.apiKey;
        showCurrentConfig(config);
    }
    
    // Save configuration
    document.getElementById('configForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const apiUrl = document.getElementById('apiUrl').value.trim();
        const apiKey = document.getElementById('apiKey').value.trim();
        
        if (!apiUrl || !apiKey) {
            showStatus('Please fill in all fields', 'error');
            return;
        }
        
        // Validate URL format
        try {
            new URL(apiUrl);
        } catch {
            showStatus('Invalid API URL format', 'error');
            return;
        }
        
        // Save to storage
        await chrome.storage.local.set({ apiUrl, apiKey });
        
        showStatus('✓ Configuration saved successfully!', 'success');
        showCurrentConfig({ apiUrl, apiKey });
        
        // Hide success message after 3 seconds
        setTimeout(() => {
            document.getElementById('status').style.display = 'none';
        }, 3000);
    });
    
    // Test connection
    document.getElementById('testBtn').addEventListener('click', async () => {
        const apiUrl = document.getElementById('apiUrl').value.trim();
        const apiKey = document.getElementById('apiKey').value.trim();
        
        if (!apiUrl || !apiKey) {
            showStatus('Please fill in all fields first', 'error');
            return;
        }
        
        const testBtn = document.getElementById('testBtn');
        testBtn.disabled = true;
        testBtn.textContent = '🔄 Testing...';
        
        try {
            // Test health endpoint
            const healthUrl = apiUrl.replace('/api/track', '/api/health');
            const healthRes = await fetch(healthUrl);
            
            if (!healthRes.ok) {
                throw new Error(`Health check failed: ${healthRes.status}`);
            }
            
            // Test actual track endpoint with API key
            const testRes = await fetch(apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-API-Key': apiKey
                },
                body: JSON.stringify({
                    event: 'extension_test',
                    url: 'test',
                    clientId: 'test-client',
                    why: 'configuration_test',
                    when: new Date().toISOString()
                })
            });
            
            if (testRes.ok) {
                showStatus('✓ Connection successful! API key is valid.', 'success');
            } else if (testRes.status === 401) {
                showStatus('✗ Invalid API key. Please check your API key.', 'error');
            } else {
                const errorText = await testRes.text();
                showStatus(`✗ Connection failed: ${testRes.status} ${errorText}`, 'error');
            }
        } catch (error) {
            showStatus(`✗ Cannot reach API: ${error.message}`, 'error');
        } finally {
            testBtn.disabled = false;
            testBtn.textContent = '🧪 Test Connection';
        }
    });
});

function showStatus(message, type) {
    const statusDiv = document.getElementById('status');
    statusDiv.textContent = message;
    statusDiv.className = `status ${type}`;
    statusDiv.style.display = 'block';
}

function showCurrentConfig(config) {
    const configInfo = document.getElementById('configInfo');
    const currentConfig = document.getElementById('currentConfig');
    
    const maskedKey = config.apiKey ? 
        config.apiKey.substring(0, 8) + '...' + config.apiKey.substring(config.apiKey.length - 4) : 
        'Not set';
    
    currentConfig.innerHTML = `
        <div style="margin: 5px 0;">URL: ${config.apiUrl || 'Not set'}</div>
        <div style="margin: 5px 0;">API Key: ${maskedKey}</div>
        ${config.clientId ? `<div style="margin: 5px 0;">Client ID: ${config.clientId}</div>` : ''}
    `;
    
    configInfo.style.display = 'block';
}

