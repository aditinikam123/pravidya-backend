# Stop Node processes and regenerate Prisma
Write-Host "Stopping Node processes..." -ForegroundColor Yellow

# Stop all Node processes
$nodeProcesses = Get-Process node -ErrorAction SilentlyContinue
if ($nodeProcesses) {
    Write-Host "Found $($nodeProcesses.Count) Node process(es), stopping..." -ForegroundColor Yellow
    Stop-Process -Name node -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
    Write-Host "Node processes stopped." -ForegroundColor Green
} else {
    Write-Host "No Node processes found." -ForegroundColor Green
}

Write-Host "`nRegenerating Prisma client..." -ForegroundColor Yellow
npm run prisma:generate

if ($LASTEXITCODE -eq 0) {
    Write-Host "`n✅ Prisma client regenerated successfully!" -ForegroundColor Green
    Write-Host "`nYou can now start the backend server with: npm start" -ForegroundColor Cyan
} else {
    Write-Host "`n❌ Prisma generation failed. Check the error above." -ForegroundColor Red
}
