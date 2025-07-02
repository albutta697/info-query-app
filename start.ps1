# 信息查询助手启动脚本
Write-Host "正在启动信息查询助手..." -ForegroundColor Cyan

# 切换到脚本所在目录
$scriptPath = Split-Path -Parent $MyInvocation.MyCommand.Definition
Set-Location -Path $scriptPath

# 尝试方法1：使用npx启动
Write-Host "尝试使用npx启动..." -ForegroundColor Yellow
try {
    npx electron .
}
catch {
    Write-Host "npx方法启动失败，尝试备用方法..." -ForegroundColor Red
    
    # 尝试方法2：使用node_modules中的electron
    try {
        Write-Host "尝试使用node_modules中的electron启动..." -ForegroundColor Yellow
        & "./node_modules/.bin/electron.ps1" .
    }
    catch {
        Write-Host "所有启动方法均失败！" -ForegroundColor Red
        Write-Host $_.Exception.Message
        Read-Host "按回车键退出"
        exit 1
    }
}

Write-Host "应用启动成功！" -ForegroundColor Green 