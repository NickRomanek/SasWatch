# Enterprise Deployment Guide

## 🔒 Security & Compliance

### Code Signing Certificate

**Required for Enterprise Deployment:**
- Windows will show warnings for unsigned executables
- Intune may block unsigned MSI packages
- Users/IT will trust signed software more

**Options:**

#### Option 1: Commercial Code Signing Certificate (Recommended)
- **Provider:** DigiCert, Sectigo, GlobalSign
- **Cost:** $200-500/year
- **Type:** EV (Extended Validation) or OV (Organization Validation)
- **Benefit:** Immediate trust, no SmartScreen warnings
- **Process:**
  1. Purchase certificate
  2. Verify your organization
  3. Install on build machine
  4. Sign MSI and EXE files

```powershell
# Sign the executable
signtool sign /f "YourCert.pfx" /p "password" /tr http://timestamp.digicert.com /td SHA256 /fd SHA256 ActivityAgent.Service.exe

# Sign the MSI
signtool sign /f "YourCert.pfx" /p "password" /tr http://timestamp.digicert.com /td SHA256 /fd SHA256 ActivityAgent.msi
```

#### Option 2: Self-Signed Certificate (Testing/Internal)
- **Use Case:** Internal testing, small deployments
- **Limitation:** Requires deploying certificate to all machines
- **Process:**

```powershell
# Create self-signed certificate
$cert = New-SelfSignedCertificate `
    -Type CodeSigningCert `
    -Subject "CN=Your Company, O=Your Company, C=US" `
    -KeyUsage DigitalSignature `
    -FriendlyName "Activity Agent Code Signing" `
    -CertStoreLocation "Cert:\CurrentUser\My" `
    -KeyExportPolicy Exportable `
    -KeySpec Signature `
    -KeyLength 2048 `
    -KeyAlgorithm RSA `
    -HashAlgorithm SHA256 `
    -NotAfter (Get-Date).AddYears(3)

# Export certificate
Export-Certificate -Cert $cert -FilePath "ActivityAgentCert.cer"
Export-PfxCertificate -Cert $cert -FilePath "ActivityAgentCert.pfx" -Password (ConvertTo-SecureString -String "YourPassword" -Force -AsPlainText)

# Sign files
signtool sign /f "ActivityAgentCert.pfx" /p "YourPassword" /tr http://timestamp.digicert.com /td SHA256 /fd SHA256 ActivityAgent.Service.exe
```

**Deploy Certificate via Intune:**
```
Intune → Devices → Configuration Profiles → Create Profile
→ Windows 10 and later → Templates → Trusted certificate
→ Upload ActivityAgentCert.cer
→ Assign to all devices
```

#### Option 3: Azure Code Signing (Modern Approach)
- **Provider:** Azure Key Vault + Azure Trusted Signing
- **Cost:** Pay-as-you-go (~$10-20/month)
- **Benefit:** No certificate management, cloud-based
- **Best for:** Modern DevOps pipelines

### Data Privacy & Compliance

**What the Agent Collects:**
- ✅ Application names (e.g., "chrome.exe", "Acrobat.exe")
- ✅ Window titles (e.g., "Document1.pdf - Adobe Acrobat")
- ✅ Browser URLs (e.g., "https://google.com")
- ✅ Network domains (e.g., "api.company.com")
- ✅ Windows username, computer name
- ✅ Timestamps

**What the Agent Does NOT Collect:**
- ❌ File contents
- ❌ Keystrokes
- ❌ Screenshots (unless explicitly enabled)
- ❌ Passwords or credentials
- ❌ Personal files or documents
- ❌ Email content
- ❌ Chat messages

**GDPR/Privacy Compliance:**
1. **User Notification:** Inform employees about monitoring
2. **Data Minimization:** Only collect necessary data
3. **Retention Policy:** Set data retention limits (30/60/90 days)
4. **Access Control:** Limit who can view activity data
5. **Data Encryption:** HTTPS for transmission, encrypted storage

**Recommended Privacy Policy Template:**
```
"This device is monitored for software license optimization. 
We track which applications you use and when, to ensure proper 
license allocation. We do not monitor file contents, keystrokes, 
or personal data. Data is encrypted and retained for 90 days."
```

### Network Security

**Firewall Rules:**
```
Outbound HTTPS (443) to: your-app.railway.app
Protocol: HTTPS only (TLS 1.2+)
Authentication: API key in header
```

**Proxy Support:**
```csharp
// Agent respects system proxy settings automatically
var handler = new HttpClientHandler
{
    UseProxy = true,
    UseDefaultCredentials = true
};
var client = new HttpClient(handler);
```

### Anti-Tamper Protection

**Service Protection:**
```csharp
// Set service recovery options
sc failure ActivityMonitorService reset= 86400 actions= restart/60000/restart/60000/restart/60000

// Prevent non-admin users from stopping service
sc sdset ActivityMonitorService "D:(A;;CCLCSWRPWPDTLOCRRC;;;SY)(A;;CCDCLCSWRPWPDTLOCRSDRCWDWO;;;BA)(A;;CCLCSWLOCRRC;;;IU)(A;;CCLCSWLOCRRC;;;SU)"
```

**File Protection:**
```xml
<!-- In WiX installer -->
<Component Id="ServiceComponent" Guid="*">
    <File Id="ServiceExe" Source="ActivityAgent.Service.exe" KeyPath="yes">
        <!-- Only SYSTEM and Admins can modify -->
        <PermissionEx User="SYSTEM" GenericAll="yes" />
        <PermissionEx User="Administrators" GenericAll="yes" />
        <PermissionEx User="Users" GenericRead="yes" GenericExecute="yes" />
    </File>
</Component>
```

### Logging & Auditing

**Agent Logs:**
- Location: `C:\ProgramData\ActivityAgent\logs\`
- Retention: 30 days
- Contents: Connection status, errors, event counts (not actual data)

**Backend Audit Trail:**
- Track which accounts access data
- Log API key usage
- Monitor for suspicious patterns

### Deployment Best Practices

**1. Pilot Deployment:**
```
Week 1: Deploy to IT team (5-10 machines)
Week 2: Deploy to test group (50 machines)
Week 3: Deploy to department (200 machines)
Week 4+: Full rollout
```

**2. Intune Configuration:**
```
Assignment Type: Required (for licensed users)
Install Context: System
Restart Behavior: No restart required
Detection Method: File exists
Return Codes: 0=Success, 1=Failure
```

**3. User Communication:**
```
Subject: New Software License Monitoring Tool

We're deploying a tool to help optimize our Adobe licenses.
This will track which applications you use to ensure we have
the right number of licenses. No personal data is collected.

Questions? Contact IT Support.
```

**4. Monitoring Dashboard:**
- Track deployment success rate
- Monitor agent connection status
- Alert on failed installations
- Report on data collection rates

### Performance Impact

**Resource Usage:**
- CPU: <1% average
- Memory: ~30-50 MB
- Network: ~1-5 KB/minute
- Disk: ~10 MB (agent + logs)

**Optimization:**
- Batch events (send every 10 seconds, not real-time)
- Rate limiting (100 events/minute max)
- Offline caching (SQLite queue)
- Efficient Win32 hooks (event-driven, not polling)

### Uninstall & Opt-Out

**Clean Uninstall:**
```powershell
# Via Intune
Remove assignment → Agent uninstalls automatically

# Manual
msiexec /x {PRODUCT-GUID} /qn

# Removes:
- Service
- Executable files
- Registry keys
- Scheduled tasks
```

**Data Deletion:**
- Users can request data deletion via admin portal
- Admins can purge user data from backend
- Automatic purge after retention period

### Compliance Checklist

- [ ] Obtain code signing certificate
- [ ] Draft privacy policy
- [ ] Get legal approval for monitoring
- [ ] Notify employees (email/policy)
- [ ] Configure data retention (backend)
- [ ] Set up access controls (who can view data)
- [ ] Test with IT security team
- [ ] Document incident response plan
- [ ] Create user FAQ
- [ ] Train support staff

### Recommended Rollout Timeline

**Month 1: Preparation**
- Week 1-2: Development & testing
- Week 3: Security review
- Week 4: Legal/HR approval

**Month 2: Pilot**
- Week 1: IT team deployment
- Week 2-3: Test group (50 users)
- Week 4: Evaluation & fixes

**Month 3: Rollout**
- Week 1-2: Department rollout (25% of org)
- Week 3-4: Full deployment (100% of org)

**Month 4: Optimization**
- Monitor performance
- Gather feedback
- Adjust policies
- Optimize license allocation

## 🎯 Success Metrics

**Technical:**
- 95%+ successful installations
- <1% agent failures
- <5 second API response time
- 99.9% uptime

**Business:**
- Identify 20-40% unused licenses
- ROI: 3-6 months
- Reduce Adobe spend by $X/year
- Improve license allocation

## 📞 Support Plan

**Tier 1 (Help Desk):**
- "Is the agent installed?" → Check Intune
- "Agent not working?" → Reinstall via Intune
- "Privacy concerns?" → Share privacy policy

**Tier 2 (IT Team):**
- Installation failures → Check logs
- Network issues → Verify firewall rules
- Performance issues → Review resource usage

**Tier 3 (Development):**
- Agent bugs → Code fixes
- Backend issues → Server troubleshooting
- Feature requests → Roadmap planning

---

**Next Steps:**
1. Review this document with IT/Legal/HR
2. Obtain code signing certificate
3. Draft privacy policy
4. Plan pilot deployment
5. Build agent (ready to proceed!)

