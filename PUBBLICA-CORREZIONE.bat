@echo off
cd /d "%~dp0"
echo Pubblico le modifiche su GitHub...
git add app.js config.js index.html styles.css README.md sw.js supabase-shop-auth.sql publish-fix.ps1 PUBBLICA-CORREZIONE.bat
git commit -m "Add route ETA"
git push
echo.
echo Fatto. Attendi 1-2 minuti, poi ricarica l'app online.
pause
