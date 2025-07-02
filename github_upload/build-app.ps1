# 设置输出编码为 UTF-8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

Write-Host "[INFO] 正在准备打包信息查询助手..." -ForegroundColor Cyan
Write-Host

# 检查 Node.js 环境
Write-Host "[CHECK] 检查 Node.js 环境..." -ForegroundColor Yellow
try {
    $nodeVersion = node --version
    Write-Host "[INFO] 检测到 Node.js 版本: $nodeVersion" -ForegroundColor Green
} catch {
    Write-Host "[ERROR] 未检测到 Node.js，请确保已安装 Node.js" -ForegroundColor Red
    pause
    exit 1
}

# 检查必要文件
Write-Host "[CHECK] 检查必要文件..." -ForegroundColor Yellow
if (-not (Test-Path "src\main\main.js")) {
    Write-Host "[ERROR] 未找到主程序文件 src\main\main.js" -ForegroundColor Red
    pause
    exit 1
}

if (-not (Test-Path "build\icon.ico")) {
    Write-Host "[ERROR] 未找到应用图标 build\icon.ico" -ForegroundColor Red
    pause
    exit 1
}

# 检查 node_modules
Write-Host "[CHECK] 检查 node_modules..." -ForegroundColor Yellow
if (-not (Test-Path "node_modules")) {
    Write-Host "[ERROR] 未找到 node_modules 目录，请先运行 npm install" -ForegroundColor Red
    pause
    exit 1
}

# 设置环境变量
$env:ELECTRON_BUILDER_ALLOW_UNRESOLVED_DEPENDENCIES = "true"
$env:ELECTRON_BUILDER_CACHE = Join-Path $PWD "node_modules\electron\dist"
$env:ELECTRON_SKIP_BINARY_DOWNLOAD = "1"
$env:npm_config_build_from_source = "true"

# 显示打包信息
Write-Host
Write-Host "[INFO] 打包配置:" -ForegroundColor Cyan
Write-Host "- 使用现有node_modules依赖"
Write-Host "- 跳过依赖检查和重新安装"
Write-Host "- 创建Windows安装程序(NSIS)"
Write-Host

# 清理dist目录
Write-Host "[TASK] 清理dist目录..." -ForegroundColor Yellow
if (Test-Path "dist") {
    Write-Host "[INFO] 正在删除旧的构建文件..." -ForegroundColor Cyan
    Remove-Item -Path "dist" -Recurse -Force
    if (-not $?) {
        Write-Host "[ERROR] 无法删除旧的dist目录" -ForegroundColor Red
        pause
        exit 1
    }
}
New-Item -ItemType Directory -Path "dist" | Out-Null

# 执行打包命令
Write-Host "[TASK] 开始打包..." -ForegroundColor Yellow
npm run dist
$buildResult = $LASTEXITCODE

# 检查打包结果
if ($buildResult -eq 0) {
    Write-Host
    Write-Host "[SUCCESS] 打包成功！" -ForegroundColor Green
    Write-Host "[INFO] 安装程序位于 dist 目录" -ForegroundColor Cyan
    Write-Host
    Write-Host "[CHECK] 正在验证生成的文件..." -ForegroundColor Yellow
    if (Test-Path "dist\信息查询助手 Setup.exe") {
        Write-Host "[SUCCESS] 安装程序已生成: dist\信息查询助手 Setup.exe" -ForegroundColor Green
    } else {
        Write-Host "[WARN] 未找到预期的安装程序文件" -ForegroundColor Yellow
    }
} else {
    Write-Host
    Write-Host "[ERROR] 打包过程中出现错误，错误代码: $buildResult" -ForegroundColor Red
    Write-Host "[INFO] 请检查以上日志信息，排查问题原因。" -ForegroundColor Cyan
}

Write-Host
Write-Host "[INFO] 打包流程已完成。" -ForegroundColor Cyan
pause