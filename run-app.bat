@echo off
echo 正在启动信息查询助手...
cd /d "%~dp0"
npx electron .
if %ERRORLEVEL% NEQ 0 (
    echo 启动失败，尝试使用备用方式...
    call node_modules\.bin\electron.cmd .
)
if %ERRORLEVEL% NEQ 0 (
    echo 应用启动失败！
    pause
) else (
    echo 应用启动成功！
) 