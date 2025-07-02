# 🛠️ 自动更新系统 - 开发者指南

## 概述

本指南面向需要理解、修改或扩展信息查询助手自动更新系统的开发者。

## 🏗️ 架构概览

### 核心组件

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   主进程        │    │   渲染进程      │    │  GitHub Actions │
│   main.js       │◄──►│   renderer.js   │    │   release.yml   │
│                 │    │                 │    │                 │
│ • autoUpdater   │    │ • UpdateManager │    │ • 自动构建      │
│ • IPC处理器     │    │ • UI组件        │    │ • 发布管理      │
│ • 错误处理      │    │ • 事件绑定      │    │ • 测试验证      │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
         └───────────────────────┼───────────────────────┘
                                 │
                    ┌─────────────────┐
                    │  GitHub Releases│
                    │                 │
                    │ • 版本文件      │
                    │ • 更新元数据    │
                    │ • 安装程序      │
                    └─────────────────┘
```

### 更新流程

1. **检查阶段**: 主进程调用 `autoUpdater.checkForUpdates()`
2. **通知阶段**: 通过IPC向渲染进程发送更新状态
3. **下载阶段**: 用户确认后开始下载更新文件
4. **安装阶段**: 应用退出时自动安装更新

## 📁 文件结构

### 主要文件

```
src/
├── main/
│   └── main.js                 # 主进程，包含autoUpdater逻辑
├── renderer/
│   ├── index.html             # 更新UI组件
│   ├── renderer.js            # UpdateManager类
│   └── styles.css             # 更新界面样式
scripts/
├── release.js                 # 版本发布管理
└── test-update.js             # 更新功能测试
.github/workflows/
└── release.yml                # CI/CD自动构建
docs/
├── UPDATE_SYSTEM.md           # 完整技术文档
├── USER_GUIDE.md              # 用户使用指南
└── DEVELOPER_GUIDE.md         # 本文档
```

### 配置文件

- `package.json`: electron-builder配置和发布设置
- `.github/workflows/release.yml`: GitHub Actions工作流
- `auto_update_task_progress.md`: 开发进度记录

## 🔧 主进程实现

### autoUpdater配置

```javascript
const { autoUpdater } = require('electron-updater');

// 基础配置
autoUpdater.autoDownload = false;        // 用户选择下载
autoUpdater.autoInstallOnAppQuit = true; // 退出时自动安装

// 开发环境跳过更新检查
if (process.env.NODE_ENV === 'development') {
    autoUpdater.updateConfigPath = null;
}
```

### 事件处理器

```javascript
// 检查更新事件
autoUpdater.on('checking-for-update', () => {
    sendUpdateStatusToRenderer('checking-for-update');
});

// 发现新版本事件
autoUpdater.on('update-available', (info) => {
    sendUpdateStatusToRenderer('update-available', info);
});

// 错误处理事件
autoUpdater.on('error', async (error) => {
    const classification = await classifyUpdateError(error);
    sendUpdateStatusToRenderer('error', { 
        error: error.message, 
        classification 
    });
});
```

### IPC通信处理器

主要的IPC处理器包括：

- `check-for-updates`: 手动检查更新
- `download-update`: 开始下载更新
- `install-update`: 安装并重启
- `get-update-settings`: 获取更新设置
- `save-update-settings`: 保存更新设置
- `retry-update`: 重试失败的更新
- `execute-recovery-strategy`: 执行错误恢复策略

## 🎨 渲染进程实现

### UpdateManager类

```javascript
class UpdateManager {
    constructor() {
        this.currentState = 'idle';
        this.updateInfo = null;
        this.downloadProgress = null;
        this.settings = this.loadSettings();
        
        this.initializeEventListeners();
        this.initErrorRecovery();
        this.initEnhancedFeatures();
    }
    
    // 状态管理
    setState(newState, data = null) {
        this.currentState = newState;
        this.updateUI(newState, data);
    }
    
    // UI更新
    updateUI(state, data) {
        switch (state) {
            case 'checking-for-update':
                this.showCheckingIndicator();
                break;
            case 'update-available':
                this.showUpdateModal(data);
                break;
            case 'downloading':
                this.showDownloadProgress(data);
                break;
            // ... 其他状态处理
        }
    }
}
```

### UI组件

主要UI组件包括：

- `#updateStatusIndicator`: 状态指示器
- `#updateNotificationModal`: 更新通知弹窗
- `#updateCompleteNotification`: 更新完成通知
- `#updateErrorNotification`: 错误通知
- `#updateSettingsPanel`: 设置面板

## 🔍 错误处理系统

### 错误分类

```javascript
function classifyUpdateError(error) {
    // 网络错误
    if (error.message.includes('ENOTFOUND') || 
        error.message.includes('ETIMEDOUT')) {
        return {
            type: 'network',
            severity: 'medium',
            recoverable: true,
            userMessage: '网络连接失败，请检查网络设置'
        };
    }
    
    // 权限错误
    if (error.message.includes('EACCES') || 
        error.message.includes('permission denied')) {
        return {
            type: 'permission',
            severity: 'high',
            recoverable: true,
            userMessage: '权限不足，请以管理员身份运行'
        };
    }
    
    // ... 其他错误类型
}
```

### 恢复策略

```javascript
async function executeRecoveryStrategy(strategy) {
    switch (strategy) {
        case 'retry_update':
            return await retryUpdateCheck();
        case 'clear_cache':
            return await clearUpdateCache();
        case 'check_network':
            return await checkNetworkConnectivity();
        case 'reset_settings':
            return await resetUpdateSettings();
    }
}
```

## 🚀 发布流程

### 本地发布

```bash
# 发布前检查
npm run release:check

# 创建新版本
npm run release:patch    # 补丁版本
npm run release:minor    # 次要版本  
npm run release:major    # 主要版本

# 推送到GitHub
git push origin main --tags
```

### 自动化流程

GitHub Actions会自动：

1. 检出代码和设置环境
2. 安装依赖和重建原生模块
3. 运行发布前检查和测试
4. 构建和打包应用程序
5. 验证构建输出和连接性
6. 创建GitHub Release并上传文件

### 发布文件

每次发布会生成：

- `信息查询助手-Setup-X.X.X.exe`: 完整安装程序
- `latest.yml`: 更新元数据文件
- `*.blockmap`: 增量更新文件

## 🧪 测试系统

### 测试脚本

```bash
# 完整测试套件
npm run test:update

# 配置验证测试
npm run test:config

# 网络连接测试
npm run test:network
```

### 测试覆盖

- 配置验证测试
- GitHub连接测试
- 版本检查测试
- 更新文件验证测试
- 错误处理测试
- 网络故障恢复测试
- 更新UI组件测试
- 用户交互测试

## 🔧 自定义和扩展

### 添加新的错误类型

1. **扩展错误分类器**:
   ```javascript
   function classifyUpdateError(error) {
       if (error.message.includes('YOUR_PATTERN')) {
           return {
               type: 'your_error_type',
               severity: 'medium',
               recoverable: true,
               userMessage: '您的错误描述'
           };
       }
   }
   ```

2. **添加恢复策略**:
   ```javascript
   async function executeRecoveryStrategy(strategy) {
       switch (strategy) {
           case 'your_strategy':
               // 实现恢复逻辑
               break;
       }
   }
   ```

3. **更新UI组件**:
   ```javascript
   getRecoveryActions(errorType) {
       const actions = {
           your_error_type: [
               { 
                   type: 'your_action', 
                   label: '您的操作',
                   icon: '🔧'
               }
           ]
       };
   }
   ```

### 自定义更新检查逻辑

```javascript
// 修改检查间隔
const CHECK_INTERVAL = 7200000; // 2小时

// 添加自定义条件
function shouldCheckForUpdates() {
    // 自定义逻辑，如用户设置、网络状态等
    return userSettings.autoUpdate && isNetworkAvailable();
}

// 自定义更新源
autoUpdater.setFeedURL({
    provider: 'generic',
    url: 'https://your-update-server.com/updates'
});
```

### 扩展UI组件

```javascript
// 添加新的通知类型
showCustomNotification(type, message, actions) {
    const notification = document.createElement('div');
    notification.className = `update-notification ${type}`;
    notification.innerHTML = `
        <div class="notification-content">${message}</div>
        <div class="notification-actions">${actions}</div>
    `;
    document.body.appendChild(notification);
}

// 自定义进度显示
updateDownloadProgress(progress) {
    const progressBar = document.getElementById('downloadProgress');
    progressBar.style.width = `${progress.percent}%`;
    
    // 添加自定义信息
    const speedElement = document.getElementById('downloadSpeed');
    speedElement.textContent = formatBytes(progress.bytesPerSecond) + '/s';
}
```

## 📊 监控和日志

### 日志记录

```javascript
// 错误日志
function logUpdateError(error, classification) {
    const logEntry = {
        timestamp: new Date().toISOString(),
        error: error.message,
        classification,
        version: app.getVersion(),
        platform: process.platform
    };
    
    fs.appendFileSync(
        path.join(app.getPath('userData'), 'update-errors.log'),
        JSON.stringify(logEntry) + '\n'
    );
}

// 成功日志
function logUpdateSuccess(version) {
    console.log(`Successfully updated to version ${version}`);
}
```

### 性能监控

```javascript
// 监控更新性能
class UpdatePerformanceMonitor {
    startTimer(operation) {
        this.timers[operation] = Date.now();
    }
    
    endTimer(operation) {
        const duration = Date.now() - this.timers[operation];
        this.metrics[operation].push(duration);
        return duration;
    }
    
    getAverageTime(operation) {
        const times = this.metrics[operation];
        return times.reduce((a, b) => a + b, 0) / times.length;
    }
}
```

## 🔒 安全考虑

### 代码签名

```javascript
// 验证更新文件签名
autoUpdater.on('update-downloaded', (event, releaseNotes, releaseName) => {
    // 验证文件完整性
    if (!verifySignature(event.downloadedFile)) {
        throw new Error('Update file signature verification failed');
    }
});
```

### 更新验证

```javascript
// 验证更新来源
function validateUpdateSource(updateInfo) {
    const trustedSources = [
        'https://github.com/albutta697/info-query-app'
    ];
    
    return trustedSources.includes(updateInfo.source);
}
```

## 🐛 调试技巧

### 启用详细日志

```javascript
// 开发环境日志
if (process.env.NODE_ENV === 'development') {
    autoUpdater.logger = require('electron-log');
    autoUpdater.logger.transports.file.level = 'debug';
}
```

### 模拟更新场景

```javascript
// 模拟更新可用
function simulateUpdateAvailable() {
    const mockUpdateInfo = {
        version: '10.1.7',
        releaseDate: new Date().toISOString(),
        releaseNotes: 'Mock update for testing'
    };
    
    sendUpdateStatusToRenderer('update-available', mockUpdateInfo);
}

// 模拟错误
function simulateError(errorType) {
    const mockError = new Error(`Mock ${errorType} error`);
    autoUpdater.emit('error', mockError);
}
```

## 📈 最佳实践

1. **用户体验优先**: 确保更新过程不会打断用户工作
2. **渐进式更新**: 优先推送安全修复，功能更新可选
3. **详细反馈**: 提供清晰的进度指示和错误信息
4. **容错设计**: 实现多层级的错误处理和恢复
5. **测试充分**: 在发布前进行全面的更新流程测试

## 📞 技术支持

遇到技术问题时：

1. 查看 `docs/UPDATE_SYSTEM.md` 获取详细技术文档
2. 运行测试套件进行诊断
3. 查看错误日志和性能指标
4. 在GitHub Issues中报告问题并提供详细信息

---

希望这个开发者指南能帮助您更好地理解和扩展自动更新系统！🚀 