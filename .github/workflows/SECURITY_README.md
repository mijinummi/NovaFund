# Security Audit Workflow

## Overview
Automated security auditing for NovaFund dependencies using `npm audit` integrated into CI/CD pipeline.

## Features

### 🔍 Automated Scanning
- **Daily scheduled audits** at 6:00 AM UTC
- **PR-triggered audits** when package files change
- **Push-triggered audits** to main branch

### 📊 Severity Levels
- **Critical**: Fails the build immediately
- **High**: Warns if > 5 vulnerabilities found
- **Medium/Low**: Informational only

### 🎯 What Gets Audited
- Backend dependencies (NestJS, Prisma, etc.)
- Frontend dependencies (Next.js, React, etc.)

### 📝 Automated Reporting
- Creates GitHub issues for critical vulnerabilities
- Uploads audit results as artifacts (30-day retention)
- Provides summary in GitHub Actions tab
- Includes fix commands and recommendations

## Workflow Triggers

### 1. Pull Requests
Triggered when any of these files change:
- `backend/package-lock.json`
- `frontend/package-lock.json`
- `backend/package.json`
- `frontend/package.json`
- `.github/workflows/security.yml`

### 2. Push to Main
Same file triggers as PRs, runs on every push to main branch.

### 3. Scheduled (Daily)
Runs every day at 6:00 AM UTC regardless of file changes.

## Jobs

### Backend Security Audit
1. Installs backend dependencies
2. Runs `npm audit --audit-level=high`
3. Checks for critical and high severity vulnerabilities
4. Uploads detailed audit results
5. Creates GitHub issue if critical vulns found

### Frontend Security Audit
Same process as backend, but for frontend dependencies.

### Security Summary
Aggregates results from both audits and provides a summary.

## Interpreting Results

### ✅ Passing Audit
```
✅ Security audit passed
```
No critical vulnerabilities and ≤ 5 high severity vulnerabilities.

### ⚠️ Warning
```
⚠️  Warning: More than 5 high severity vulnerabilities found
```
More than 5 high severity vulnerabilities detected. Review and fix recommended.

### ❌ Failing Audit
```
❌ CRITICAL vulnerabilities found!
```
Critical vulnerabilities detected. Build fails, GitHub issue created automatically.

## Fixing Vulnerabilities

### Quick Fix
```bash
# For backend
cd backend
npm audit fix

# For frontend
cd frontend
npm audit fix
```

### Force Fix (May introduce breaking changes)
```bash
npm audit fix --force
```

### Manual Fix
1. Review the audit report:
   ```bash
   npm audit
   ```

2. Update specific packages:
   ```bash
   npm update <package-name>
   ```

3. Or edit `package.json` and run:
   ```bash
   npm install
   ```

## Viewing Audit Results

### GitHub Actions Tab
1. Go to Actions → Security Audit workflow
2. Click on the latest run
3. Check job outputs for summary

### Download Artifacts
1. Go to the workflow run
2. Scroll to "Artifacts" section
3. Download `backend-audit-results` or `frontend-audit-results`
4. Open the JSON file to see detailed vulnerability information

### GitHub Issues
Critical vulnerabilities automatically create issues with:
- List of vulnerable packages
- Severity levels
- Affected versions
- Fix recommendations
- Action items checklist

## Configuration

### Adjust Severity Thresholds
Edit `.github/workflows/security.yml`:

```yaml
# Change from critical to high to fail on high severity
if [ "$CRITICAL_VULNS" -gt 0 ]; then
# Change to:
if [ "$HIGH_VULNS" -gt 0 ]; then
```

### Change Warning Threshold
```yaml
# Currently warns if > 5 high vulns
if [ "$HIGH_VULNS" -gt 5 ]; then
# Change to warn on any high vulns:
if [ "$HIGH_VULNS" -gt 0 ]; then
```

### Adjust Schedule
```yaml
# Current: Daily at 6 AM UTC
- cron: '0 6 * * *'

# Change to: Every 6 hours
- cron: '0 */6 * * *'

# Or: Weekly on Sunday at 9 AM
- cron: '0 9 * * 0'
```

## Best Practices

### 1. Regular Updates
- Keep dependencies updated regularly
- Don't wait for automated audits to find issues
- Review and merge dependency update PRs promptly

### 2. Test After Updates
- Always run tests after updating dependencies
- Check for breaking changes
- Verify functionality in staging environment

### 3. Monitor GitHub Issues
- Watch for automated security issues
- Prioritize critical vulnerabilities
- Set up notifications for security labels

### 4. Use Dependabot (Optional)
Consider enabling GitHub Dependabot for automated PRs:
```yaml
# .github/dependabot.yml
version: 2
updates:
  - package-ecosystem: "npm"
    directory: "/backend"
    schedule:
      interval: "weekly"
  - package-ecosystem: "npm"
    directory: "/frontend"
    schedule:
      interval: "weekly"
```

## Transparent Security Posture

This workflow ensures:
- ✅ All dependencies are regularly scanned
- ✅ Vulnerabilities are caught early
- ✅ Team is automatically notified of critical issues
- ✅ Clear remediation steps provided
- ✅ Security status visible to all contributors
- ✅ Historical audit results preserved

## Integration with Other Tools

### Snyk (Alternative)
For more advanced scanning, you can integrate Snyk:
```bash
npm install -g snyk
snyk auth
snyk test
```

### GitHub Advanced Security
If you have GitHub Enterprise, consider enabling:
- CodeQL for code analysis
- Secret scanning
- Dependency review

## Troubleshooting

### Audit Fails But No Critical Vulns
- Check if npm version is up to date
- Run `npm audit` locally to see full report
- Some vulnerabilities may not have fixes yet

### False Positives
- Some dev dependencies may show vulnerabilities
- These are less risky if not in production
- Consider using `npm audit --production` for production-only scan

### Network Issues
- Audit requires internet access to npm registry
- CI/CD must have outbound HTTPS access
- Check proxy settings if behind corporate firewall

## Support

For questions or improvements to the security workflow:
1. Check existing issues in the repository
2. Create a new issue with the `security` label
3. Propose changes via pull request
