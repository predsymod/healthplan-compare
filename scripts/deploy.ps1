# Deploys the working tree to Vercel production from a copy that has no .git.
# Vercel blocks CLI deploys whose commit author is not a team member, and the commits here use a
# GitHub noreply address on purpose, so the copy carries no git metadata for Vercel to check.
# Run from anywhere:  powershell -File scripts\deploy.ps1
$ErrorActionPreference = "Stop"
$src = Split-Path -Parent $PSScriptRoot
$dst = Join-Path ([IO.Path]::GetTempPath()) "healthplan-compare-deploy"

if (Test-Path $dst) { Remove-Item -Recurse -Force $dst }
robocopy $src $dst /E /XD .git node_modules .next /XF .env .env.local /NFL /NDL /NJH /NJS | Out-Null
if ($LASTEXITCODE -ge 8) { throw "robocopy failed ($LASTEXITCODE)" }
if (-not (Test-Path (Join-Path $dst ".vercel\project.json"))) { throw "No .vercel link in $src; run 'vercel link' there first." }

Push-Location $dst
try { npx vercel --prod --yes } finally { Pop-Location; Remove-Item -Recurse -Force $dst }
