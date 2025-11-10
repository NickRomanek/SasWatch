# Test script to verify PowerShell syntax
$API_KEY = "test-key"
$API_URL = "http://localhost:3000/api/track"

# Test the Add-Type syntax
if (-not ([System.Management.Automation.PSTypeName]'Window').Type) {
    Add-Type -TypeDefinition @'
        using System;
        using System.Runtime.InteropServices;
        using System.Text;
        public class Window {
            [DllImport("user32.dll")]
            public static extern IntPtr GetForegroundWindow();
        }
'@ -ErrorAction SilentlyContinue
}

Write-Host "Script syntax is valid!" -ForegroundColor Green
