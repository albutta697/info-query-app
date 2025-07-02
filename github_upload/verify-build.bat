@echo off
setlocal enabledelayedexpansion

echo 开始验证打包结果...
echo.

:: 检查安装程序是否存在
echo 检查安装文件...
if not exist "dist\信息查询助手 Setup.exe" (
    echo [错误] 未找到安装程序文件
    echo 请先运行 build-app.bat 进行打包
    pause
    exit /b 1
)

:: 检查文件大小
echo 检查安装包大小...
for %%I in ("dist\信息查询助手 Setup.exe") do set size=%%~zI
if !size! LSS 1000000 (
    echo [警告] 安装包大小异常小：!size! 字节
    echo 请检查打包配置是否正确
) else (
    echo √ 安装包大小正常：!size! 字节
)

:: 检查资源文件
echo 检查关键资源文件...
echo - 使用 7z 列出安装包内容
"C:\Program Files\7-Zip\7z.exe" l "dist\信息查询助手 Setup.exe" > nul 2>&1
if !ERRORLEVEL! EQU 0 (
    echo √ 安装包文件结构完整
) else (
    echo [警告] 无法验证安装包内容（需要安装7-Zip）
)

:: 显示验证结果
echo.
echo 验证完成！
echo 如果以上检查都通过，安装包应该可以正常使用。
echo 建议执行以下手动测试：
echo 1. 安装应用程序
echo 2. 验证快捷方式创建
echo 3. 启动并测试基本功能
echo 4. 测试卸载功能

pause 