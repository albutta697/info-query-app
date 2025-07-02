@echo off
chcp 65001 > nul
setlocal enabledelayedexpansion

echo [INFO] 正在准备打包信息查询助手...
echo.

:: 检查 Node.js 环境
echo [CHECK] 检查 Node.js 环境...
node --version > nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] 未检测到 Node.js，请确保已安装 Node.js
    pause
    exit /b 1
)

:: 检查必要文件
echo [CHECK] 检查必要文件...
if not exist "src\main\main.js" (
    echo [ERROR] 未找到主程序文件 src\main\main.js
    pause
    exit /b 1
)

if not exist "build\icon.ico" (
    echo [ERROR] 未找到应用图标 build\icon.ico
    pause
    exit /b 1
)

:: 检查 node_modules
echo [CHECK] 检查 node_modules...
if not exist "node_modules" (
    echo [ERROR] 未找到 node_modules 目录，请先运行 npm install
    pause
    exit /b 1
)

:: 设置环境变量，确保使用现有依赖
set ELECTRON_BUILDER_ALLOW_UNRESOLVED_DEPENDENCIES=true
set ELECTRON_BUILDER_CACHE=%CD%\node_modules\electron\dist
set ELECTRON_SKIP_BINARY_DOWNLOAD=1
set npm_config_build_from_source=true

:: 显示打包信息
echo.
echo [INFO] 打包配置:
echo - 使用现有node_modules依赖
echo - 跳过依赖检查和重新安装
echo - 创建Windows安装程序(NSIS)
echo.

:: 清理dist目录
echo [TASK] 清理dist目录...
if exist dist (
    echo [INFO] 正在删除旧的构建文件...
    rmdir /s /q dist
    if !ERRORLEVEL! NEQ 0 (
        echo [ERROR] 无法删除旧的dist目录
        pause
        exit /b 1
    )
)
mkdir dist

:: 执行打包命令
echo [TASK] 开始打包...
call npm run dist
set BUILD_RESULT=!ERRORLEVEL!

:: 检查打包结果
if !BUILD_RESULT! EQU 0 (
    echo.
    echo [SUCCESS] 打包成功！
    echo [INFO] 安装程序位于 dist 目录
    echo.
    echo [CHECK] 正在验证生成的文件...
    if exist "dist\信息查询助手 Setup.exe" (
        echo [SUCCESS] 安装程序已生成: dist\信息查询助手 Setup.exe
    ) else (
        echo [WARN] 未找到预期的安装程序文件
    )
) else (
    echo.
    echo [ERROR] 打包过程中出现错误，错误代码: !BUILD_RESULT!
    echo [INFO] 请检查以上日志信息，排查问题原因。
)

echo.
echo [INFO] 打包流程已完成。
pause 