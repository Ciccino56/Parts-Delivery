$ErrorActionPreference = "Stop"

Set-Location -LiteralPath $PSScriptRoot

git add app.js config.js index.html README.md sw.js supabase-shop-auth.sql publish-fix.ps1
git commit -m "Add shop email login"
git push

Write-Host ""
Write-Host "Correzione pubblicata. Attendi 1-2 minuti e poi ricarica GitHub Pages." -ForegroundColor Green
Read-Host "Premi Invio per chiudere"
