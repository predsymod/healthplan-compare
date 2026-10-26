@echo off
REM Node comes from fnm, which is not activated in a fresh cmd window, so run npm through it
REM Port 3100 so it does not clash with other local frontends on 3000
start "healthplan-compare" cmd /k "fnm exec --using=default cmd /c npm run dev -- -p 3100"
start "" http://localhost:3100
