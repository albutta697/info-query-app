# 自动更新系统文档

## 概览

信息查询助手集成了完整的自动更新系统，支持智能错误处理、自动恢复和用户友好的更新体验。

## 🏗️ 系统架构

### 核心组件

1. **主进程更新管理器** (`src/main/main.js`)
   - 基于 `electron-updater`
   - 智能错误分类和恢复
   - 网络连接监测
   - 自动重试机制

2. **渲染进程更新界面** (`src/renderer/`)
   - 现代化更新通知界面
   - 进度显示和用户交互
   - 错误恢复选项
   - 设置管理面板

3. **自动化发布流程** (`.github/workflows/`)
   - GitHub Actions 自动构建
   - 版本管理和发布
   - 发布前检查
   - 更新文件生成

## 🚀 发布流程

### 1. 本地发布准备

```bash
# 检查发布前置条件
npm run release:check

# 创建新版本（补丁/次要/主要）
npm run release:patch   # 10.1.6 → 10.1.7
npm run release:minor   # 10.1.6 → 10.2.0
npm run release:major   # 10.1.6 → 11.0.0
```

### 2. 推送和自动发布

```bash
# 推送代码和标签到GitHub
git push origin main --tags
```

GitHub Actions 将自动：
- 构建应用程序
- 运行测试
- 生成安装程序
- 创建 GitHub Release
- 上传更新文件

### 3. 发布文件结构

```
Release Assets/
├── 信息查询助手-Setup-10.1.7.exe     # 完整安装程序
├── latest.yml                         # 更新元数据
└── 信息查询助手-Setup-10.1.7.exe.blockmap  # 增量更新文件
```

## 🧪 测试系统

### 完整测试套件

```bash
# 运行完整更新功能测试
npm run test:update

# 仅测试配置
npm run test:config

# 仅测试网络连接
npm run test:network
```

### 测试覆盖范围

1. **配置验证测试**
   - package.json 配置检查
   - electron-updater 集成验证
   - GitHub 发布配置验证

2. **网络连接测试**
   - GitHub API 连接测试
   - Releases API 访问测试
   - 更新服务器可达性测试

3. **版本管理测试**
   - 版本格式验证
   - 版本比较逻辑测试
   - 升级路径验证

4. **错误处理测试**
   - 网络故障模拟
   - 错误分类验证
   - 恢复机制测试

5. **UI组件测试**
   - 更新界面完整性
   - 用户交互验证
   - IPC 通信测试

## 🛠️ 配置说明

### GitHub 发布配置

在 `package.json` 中配置：

```json
{
  "build": {
    "publish": [
      {
        "provider": "github",
        "owner": "albutta697",
        "repo": "info-query-app"
      }
    ]
  }
}
```

### 更新检查配置

主进程中的配置选项：

```javascript
// 更新策略
autoUpdater.autoDownload = false;        // 用户选择下载
autoUpdater.autoInstallOnAppQuit = true; // 退出时自动安装

// 检查间隔
const CHECK_INTERVAL = 3600000; // 1小时检查一次

// 重试设置
const MAX_RETRY_ATTEMPTS = 3;   // 最多重试3次
```

## 👤 用户体验

### 更新通知流程

1. **检查更新**
   - 应用启动3秒后自动检查
   - 支持手动检查更新
   - 状态指示器显示检查进度

2. **发现新版本**
   - 弹出更新通知对话框
   - 显示版本对比和更新说明
   - 用户可选择立即更新或稍后提醒

3. **下载更新**
   - 实时进度显示
   - 下载速度和剩余时间
   - 支持暂停/恢复下载

4. **安装更新**
   - 下载完成后提示重启
   - 应用退出时自动安装
   - 重启后显示更新完成通知

### 错误处理体验

1. **智能错误分类**
   - 网络错误 🌐
   - 权限错误 🔒
   - 磁盘空间错误 💾
   - 文件完整性错误 🔍
   - 服务器错误 🔧

2. **自动恢复选项**
   - 重试更新
   - 检查网络连接
   - 清理更新缓存
   - 网络恢复后自动重试

3. **用户指导**
   - 清晰的错误说明
   - 可操作的解决方案
   - 技术详情（可展开）
   - 支持联系方式

## 🔧 开发指南

### 添加新的错误处理

1. **扩展错误分类器**

```javascript
function classifyUpdateError(error) {
    // 添加新的错误类型判断
    if (error.message.includes('YOUR_ERROR_PATTERN')) {
        return {
            type: 'your_error_type',
            severity: 'medium',
            recoverable: true,
            retryable: true,
            userMessage: '用户友好的错误描述'
        };
    }
}
```

2. **添加恢复策略**

```javascript
async function executeRecoveryStrategy(strategy) {
    switch (strategy) {
        case 'your_recovery_strategy':
            // 实现您的恢复逻辑
            break;
    }
}
```

3. **更新UI组件**

在 `src/renderer/renderer.js` 中添加对应的恢复选项：

```javascript
getRecoveryActions(errorType) {
    const typeSpecificActions = {
        your_error_type: [
            { 
                type: 'your_recovery_action', 
                icon: '🔧', 
                label: '您的恢复操作',
                description: '操作描述'
            }
        ]
    };
}
```

### 自定义更新检查

```javascript
// 修改检查间隔
const CHECK_INTERVAL = 7200000; // 2小时

// 添加自定义检查条件
function shouldCheckForUpdates() {
    // 您的自定义逻辑
    return true;
}
```

## 📋 故障排除

### 常见问题

1. **更新检查失败**
   ```bash
   # 检查网络连接
   npm run test:network
   
   # 验证配置
   npm run test:config
   ```

2. **GitHub API 访问问题**
   - 确认仓库是 Public
   - 检查 GitHub 服务状态
   - 验证网络连接

3. **构建失败**
   ```bash
   # 重新安装依赖
   npm ci
   
   # 重建原生模块
   npm run rebuild-native
   
   # 运行发布前检查
   npm run release:check
   ```

4. **更新文件损坏**
   ```bash
   # 清理本地缓存
   npm run dist -- --publish=never
   
   # 手动清理构建目录
   rm -rf dist/
   ```

### 调试模式

启用详细日志：

```javascript
// 在主进程中启用
process.env.NODE_ENV = 'development';
autoUpdater.logger = console;
```

### 测试更新流程

1. **本地测试**
   ```bash
   # 创建测试版本
   npm version patch --no-git-tag-version
   npm run dist
   ```

2. **模拟更新**
   - 降低当前版本号
   - 发布新版本到GitHub
   - 启动应用测试更新流程

## 🔒 安全考虑

1. **代码签名**
   - 配置代码签名证书
   - 验证下载文件完整性

2. **更新验证**
   - 验证更新来源
   - 检查文件签名
   - 确认版本合法性

3. **权限管理**
   - 最小权限原则
   - 用户确认机制
   - 安全错误处理

## 📈 监控和分析

### 更新成功率监控

可以添加分析代码来跟踪：
- 更新检查成功率
- 下载完成率
- 安装成功率
- 错误类型分布

### 性能指标

- 更新检查响应时间
- 下载速度统计
- 错误恢复时间
- 用户交互延迟

## 🔮 未来扩展

1. **增量更新**
   - 实现差异更新
   - 减少下载大小
   - 提高更新速度

2. **多渠道支持**
   - Beta 测试渠道
   - 开发者预览版
   - 稳定发行版

3. **高级错误恢复**
   - 机器学习错误预测
   - 自适应重试策略
   - 智能网络优化

4. **用户体验优化**
   - 后台静默更新
   - 更新调度优化
   - 个性化更新设置

---

## 📞 支持和反馈

如果在使用自动更新系统时遇到问题，请：

1. 查看本文档的故障排除部分
2. 运行相关测试命令进行诊断
3. 在 GitHub Issues 中报告问题
4. 提供详细的错误日志和环境信息

更新系统会持续改进，您的反馈对我们非常宝贵！ 