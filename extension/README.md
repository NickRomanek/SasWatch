# Adobe Web Usage Sensor - Chrome Extension

## Overview

This Chrome extension tracks when users visit Adobe web applications and reports usage to your SasWatch account. It works alongside the PowerShell desktop monitoring to provide complete Adobe usage visibility.

## Features

- ✅ **Multi-Tenant Support** - Each organization uses their own API key
- ✅ **Adobe Web Tracking** - Monitors Adobe.com, Acrobat, Express, Admin Console, etc.
- ✅ **Easy Configuration** - Simple options page for setup
- ✅ **API Key Authentication** - Secure account-scoped tracking
- ✅ **Connection Testing** - Verify configuration before deployment
- ✅ **Duplicate Suppression** - Prevents spam (1 event per site per minute)

## Tracked Adobe Sites

- adobe.com (main site)
- acrobat.adobe.com (Acrobat Web)
- express.adobe.com (Adobe Express)
- adminconsole.adobe.com (Admin Console)
- spark.adobe.com (Adobe Spark)
- creative.adobe.com (Creative Cloud Web)
- And all *.adobe.com subdomains

## Installation

### Option 1: Chrome Web Store (Recommended for Production)

1. Package the extension (see "Packaging" section below)
2. Submit to Chrome Web Store
3. Users install from Web Store
4. Configure with API key

### Option 2: Developer Mode (For Testing)

1. Open Chrome and go to `chrome://extensions/`
2. Enable "Developer mode" (top right toggle)
3. Click "Load unpacked"
4. Select the `extension` folder
5. Extension is now installed!

### Option 3: Enterprise Deployment (via Policy)

Deploy via Google Workspace Admin Console:
1. Package extension as .crx file
2. Upload to Google Admin Console
3. Push to all users via policy
4. Pre-configure API settings via managed storage

## Configuration

### For Individual Users

1. Click the extension icon in Chrome
2. Click "Options" or right-click → "Options"
3. Enter your SasWatch API URL:
   - Local: `http://localhost:3000/api/track`
   - Production: `https://your-app.railway.app/api/track`
4. Enter your API Key (from SasWatch Account Settings)
5. Click "Save Configuration"
6. Click "Test Connection" to verify

### For Enterprise Deployment (Pre-configured)

Set managed storage policy in Google Workspace Admin:

```json
{
  "apiUrl": {
    "Value": "https://your-app.railway.app/api/track"
  },
  "apiKey": {
    "Value": "your-organization-api-key-here"
  }
}
```

Users won't need to configure anything!

## Usage

Once configured, the extension automatically:

1. Monitors Chrome navigation to Adobe sites
2. Detects when users visit Adobe web applications
3. Sends usage event to SasWatch API with API key
4. Data appears in organization's SasWatch dashboard

**No user interaction required after setup!**

## Data Collected

For each Adobe site visit:
- Event type: `adobe_web_login_detected`
- URL: Adobe site visited
- Tab ID: Browser tab identifier
- Client ID: Anonymous browser identifier (UUID)
- Timestamp: When the visit occurred
- Trigger: Which navigation event detected it

**NOT collected:**
- Personal information
- Browsing history (non-Adobe sites)
- File names or content
- Passwords or credentials

## Packaging for Distribution

### Create ZIP for Chrome Web Store

```bash
cd extension
zip -r adobe-sensor.zip . -x ".*" -x "README.md"
```

### Create CRX for Enterprise

```bash
# Use Chrome's built-in packing tool
chrome://extensions/ → Pack extension → Select extension directory
```

## Testing

### Manual Test

1. Configure extension with local API URL
2. Visit https://acrobat.adobe.com
3. Check Chrome DevTools Console for logs:
   - `[AdobeSensor] POST { url, tabId, why }`
   - `[AdobeSensor] ✓ POST success 200`
4. Check SasWatch dashboard for event

### Connection Test

1. Open extension options
2. Enter API URL and Key
3. Click "Test Connection"
4. Should show: "✓ Connection successful! API key is valid."

## Troubleshooting

### "No API key configured"

**Solution:** Right-click extension → Options → Enter API key

### "✗ POST failed 401"

**Solution:** Invalid API key. Get new key from SasWatch Account Settings

### "✗ Cannot reach API"

**Solution:** 
- Check API URL is correct
- Verify SasWatch is running
- Check network/firewall settings

### Extension not tracking

**Check:**
1. Extension is enabled in `chrome://extensions/`
2. API key is configured (click extension icon → Options)
3. Visiting actual Adobe sites (*.adobe.com)
4. Check browser console for errors (F12)

### Events not appearing in dashboard

**Check:**
1. API key matches your SasWatch account
2. Connection test passes in options
3. Using correct API URL (check /api/track endpoint)
4. Account is active in SasWatch

## Development

### Project Structure

```
extension/
├── background.js       # Service worker (main logic)
├── options.html        # Configuration page UI
├── options.js          # Configuration page logic
├── manifest.json       # Extension manifest (v3)
├── icon128.png         # Extension icon
└── README.md           # This file
```

### Making Changes

1. Edit files
2. Go to `chrome://extensions/`
3. Click refresh icon on extension card
4. Test changes

### Console Logging

Enable verbose logging:
- Open Chrome DevTools
- Go to Sources → Service Workers
- Click "Inspect" next to extension
- Console will show all `[AdobeSensor]` logs

## Privacy & Security

- **API Key Storage**: Stored in Chrome's local storage (encrypted by Chrome)
- **Data Transmission**: HTTPS only in production
- **No Telemetry**: No data sent except to configured API
- **Open Source**: Code is fully auditable
- **Minimal Permissions**: Only requests necessary permissions

## Permissions Explained

- `storage` - Store API URL, API key, and client ID
- `tabs` - Monitor navigation events
- `webNavigation` - Detect Adobe site visits
- `host_permissions` - Access Adobe domains to monitor usage

## Version History

### v3.0.0 (Current)
- ✅ Multi-tenant support with API keys
- ✅ Configuration options page
- ✅ Connection testing
- ✅ Better error handling
- ✅ Updated for SasWatch multi-tenant API

### v2.0.0 (Legacy)
- Single-tenant with hardcoded endpoint
- Basic Adobe site tracking

### v1.0.0 (Legacy)
- Initial release

## Support

For SasWatch-related issues:
- Check SasWatch documentation
- Verify API key in Account Settings
- Test API endpoint with curl/Postman

For extension-specific issues:
- Check browser console for errors
- Verify extension is enabled
- Try reinstalling extension

## License

Private/Proprietary - Part of SasWatch platform

---

**Questions?** See SasWatch documentation in `README.md` or `START-HERE.md`

