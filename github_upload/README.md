# 📱 信息查询助手

> 基于Electron的智能个人信息查询桌面应用

[![Version](https://img.shields.io/badge/version-10.1.6-blue.svg)](https://github.com/albutta697/info-query-app/releases)
[![Build Status](https://img.shields.io/badge/build-passing-brightgreen.svg)](#)
[![Auto Update](https://img.shields.io/badge/auto--update-enabled-orange.svg)](#自动更新功能)
[![License](https://img.shields.io/badge/license-ISC-green.svg)](#)

## ✨ 主要功能

- 🔍 **智能信息查询** - 高效的个人信息检索系统
- 🤖 **自动化处理** - 基于Puppeteer的智能自动化
- 🎨 **现代化界面** - 简洁美观的用户体验
- 🔄 **自动更新** - 无缝的版本更新体验
- 🛡️ **安全可靠** - 完整的错误处理和恢复机制

## 🆕 自动更新功能

### 🚀 全新体验
信息查询助手现已支持自动更新！告别手动下载安装包的烦恼：

- ✅ **自动检查** - 应用启动时智能检查新版本
- ✅ **一键更新** - 简单点击即可更新到最新版本
- ✅ **断点续传** - 网络中断也不怕，支持断点续传
- ✅ **智能恢复** - 遇到问题自动分析并提供解决方案
- ✅ **安全可靠** - 多重验证确保更新文件安全性

### 📋 更新流程

1. **自动检查** - 应用启动后自动检查更新
2. **智能通知** - 发现新版本时弹出友好提示
3. **选择下载** - 用户确认后开始下载更新
4. **后台安装** - 应用退出时自动安装新版本

### ⚙️ 灵活设置

- 🔧 **检查频率** - 可设置每小时/每天/每周检查
- 🌐 **网络控制** - 支持仅WiFi环境下载
- 📱 **更新渠道** - 稳定版/测试版/开发版可选
- 🔕 **静音模式** - 可设置静音时段避免打扰

## 📥 安装方式

### 自动更新用户（推荐）
如果您已安装任意版本的信息查询助手：
- 应用会自动提示更新到最新版本
- 享受无缝的更新体验

### 新用户安装
1. 访问 [GitHub Releases](https://github.com/albutta697/info-query-app/releases)
2. 下载最新版本的 `.exe` 安装程序
3. 运行安装程序并按提示完成安装
4. 首次启动后会自动配置更新功能

## 🛠️ 技术架构

### 核心技术栈
- **前端框架**: Electron 28.1.0
- **自动化引擎**: Puppeteer 21.0.0
- **自动更新**: electron-updater 6.1.7
- **构建工具**: electron-builder 24.9.1
- **数据存储**: electron-store 8.1.0

### 更新系统架构
```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   主进程        │    │   渲染进程      │    │  GitHub Actions │
│   main.js       │◄──►│   renderer.js   │    │   release.yml   │
│                 │    │                 │    │                 │
│ • autoUpdater   │    │ • UpdateManager │    │ • 自动构建      │
│ • 错误处理      │    │ • UI组件        │    │ • 发布管理      │
│ • IPC通信       │    │ • 事件绑定      │    │ • 测试验证      │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

## 📚 文档指南

### 用户文档
- 📖 [用户使用指南](docs/USER_GUIDE.md) - 详细的使用说明
- ❓ [常见问题解答](docs/FAQ.md) - 问题排查和解决方案

### 开发者文档  
- 🛠️ [开发者指南](docs/DEVELOPER_GUIDE.md) - 技术实现详解
- 📋 [系统文档](docs/UPDATE_SYSTEM.md) - 完整的技术文档
- 🚀 [发布演示](RELEASE_DEMO.md) - 快速上手指南

## 🚀 开发与发布

### 开发环境设置
```bash
# 克隆项目
git clone https://github.com/albutta697/info-query-app.git
cd info-query-app

# 安装依赖
npm install

# 启动开发模式
npm start

# 构建应用
npm run build
```

### 版本发布流程
```bash
# 发布前检查
npm run release:check

# 创建新版本
npm run release:patch    # 补丁版本 (10.1.6 → 10.1.7)
npm run release:minor    # 次要版本 (10.1.6 → 10.2.0)
npm run release:major    # 主要版本 (10.1.6 → 11.0.0)

# 推送到GitHub（自动触发构建和发布）
git push origin main --tags
```

### 测试套件
```bash
# 完整更新功能测试
npm run test:update

# 配置验证测试
npm run test:config

# 网络连接测试
npm run test:network
```

## 🛡️ 安全特性

### 更新安全
- ✅ **官方源验证** - 仅从官方GitHub仓库获取更新
- ✅ **完整性检查** - 文件哈希值和数字签名验证
- ✅ **安全传输** - HTTPS加密传输
- ✅ **权限控制** - 最小权限原则

### 隐私保护
- 🔒 不收集个人隐私信息
- 🔒 本地数据存储
- 🔒 透明的更新过程
- 🔒 用户完全控制更新行为

## 📊 版本历史

### v10.1.6 (当前版本)
- 🎉 **新增** 完整的自动更新系统
- 🔧 **改进** 智能错误处理和恢复机制
- 🎨 **优化** 现代化更新界面设计
- 🛡️ **增强** 企业级安全保障
- 📱 **完善** 用户体验和无障碍支持

### 历史版本
查看完整版本历史：[GitHub Releases](https://github.com/albutta697/info-query-app/releases)

## 🤝 贡献指南

我们欢迎各种形式的贡献：

### 报告问题
- 🐛 [提交Bug报告](https://github.com/albutta697/info-query-app/issues/new?template=bug_report.md)
- 💡 [建议新功能](https://github.com/albutta697/info-query-app/issues/new?template=feature_request.md)

### 参与开发
1. Fork 项目仓库
2. 创建功能分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 创建 Pull Request

## 📞 技术支持

### 获取帮助
- 📖 查看 [用户指南](docs/USER_GUIDE.md) 和 [FAQ](docs/FAQ.md)
- 🔍 搜索 [已知问题](https://github.com/albutta697/info-query-app/issues)
- 📝 提交 [新问题](https://github.com/albutta697/info-query-app/issues/new)

### 联系方式
- 📧 GitHub Issues（推荐）
- 🌐 项目主页：https://github.com/albutta697/info-query-app

## 📄 许可证

本项目采用 ISC 许可证 - 查看 [LICENSE](LICENSE) 文件了解详情

## 🌟 致谢

感谢所有为这个项目做出贡献的开发者和用户！

特别感谢：
- [Electron](https://electronjs.org/) - 跨平台桌面应用框架
- [Puppeteer](https://pptr.dev/) - 自动化浏览器控制
- [electron-updater](https://github.com/electron-userland/electron-builder/tree/master/packages/electron-updater) - 自动更新解决方案

---

<div align="center">

**🎉 享受自动更新带来的便利！**

如果这个项目对您有帮助，请考虑给我们一个 ⭐ Star

[下载最新版本](https://github.com/albutta697/info-query-app/releases/latest) | [查看文档](docs/) | [报告问题](https://github.com/albutta697/info-query-app/issues)

</div> 