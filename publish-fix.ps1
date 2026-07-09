$ErrorActionPreference = "Stop"

Set-Location -LiteralPath $PSScriptRoot

git add app.js config.js index.html styles.css README.md sw.js supabase-shop-auth.sql supabase-access-v3.sql publish-fix.ps1 PUBBLICA-CORREZIONE.bat
git commit -m "Add access control"
git push

Write-Host ""
Write-Host "Correzione pubblicata. Attendi 1-2 minuti e poi ricarica GitHub Pages." -ForegroundColor Green
Read-Host "Premi Invio per chiudere"
