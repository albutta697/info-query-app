# PowerShell启动脚本
Write-Host "正在启动信息查询助手..." -ForegroundColor Cyan
Set-Location -Path $PSScriptRoot
npm start
Write-Host "按任意键退出..." -ForegroundColor Yellow
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown") 