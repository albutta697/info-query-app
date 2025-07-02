@echo off
echo ================================
echo 准备GitHub上传文件包
echo ================================

echo 正在创建上传文件夹...
if exist "github_upload" rmdir /s /q "github_upload"
mkdir "github_upload"

echo 复制核心源代码文件...
xcopy "src" "github_upload\src" /e /i /y

echo 复制配置文件...
copy "package.json" "github_upload\"
copy "package-lock.json" "github_upload\"
copy "README.md" "github_upload\"

echo 复制构建相关文件...
xcopy "build" "github_upload\build" /e /i /y
xcopy "assets" "github_upload\assets" /e /i /y

echo 复制脚本文件...
copy "build-app.bat" "github_upload\"
copy "build-app.ps1" "github_upload\"
copy "start-app.bat" "github_upload\"
copy "start-app.ps1" "github_upload\"
copy "verify-build.bat" "github_upload\"

echo 复制文档文件...
copy "RELEASE_DEMO.md" "github_upload\"
if exist "scripts" xcopy "scripts" "github_upload\scripts" /e /i /y

echo ================================
echo 完成！文件已准备在 github_upload 文件夹中
echo 你可以将 github_upload 文件夹中的所有内容上传到GitHub
echo ================================
pause 