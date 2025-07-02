const { app, BrowserWindow, ipcMain, dialog, protocol } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { autoUpdater } = require('electron-updater');

// 保持window对象的全局引用，避免JavaScript对象被垃圾回收时，窗口被自动关闭
let mainWindow;

// 配置自动更新器
function configureAutoUpdater() {
    // 设置更新配置
    autoUpdater.autoDownload = false; // 不自动下载，让用户选择
    autoUpdater.autoInstallOnAppQuit = true; // 应用退出时自动安装
    
    // 开发环境下的更新设置
    if (!app.isPackaged) {
        console.log('开发环境：跳过自动更新检查');
        return;
    }

    // 配置更新事件监听器
    autoUpdater.on('checking-for-update', () => {
        console.log('正在检查更新...');
        sendUpdateStatusToRenderer('checking-for-update', '正在检查更新...');
    });

    autoUpdater.on('update-available', (info) => {
        console.log('发现可用更新:', info.version);
        
        // 【第7步增强】成功事件时重置重试计数器
        retryAttempts = 0;
        lastKnownGoodVersion = info.version;
        
        sendUpdateStatusToRenderer('update-available', {
            version: info.version,
            releaseNotes: info.releaseNotes,
            releaseDate: info.releaseDate
        });
    });

    autoUpdater.on('update-not-available', (info) => {
        console.log('当前已是最新版本:', info.version);
        sendUpdateStatusToRenderer('update-not-available', '当前已是最新版本');
    });

    autoUpdater.on('error', async (error) => {
        console.error('❌ 更新失败:', error);
        
        // 【第7步增强】错误分类和处理
        const errorType = classifyUpdateError(error);
        console.log(`🔍 错误分类: ${errorType.type} (严重程度: ${errorType.severity})`);
        
        // 记录错误到历史和日志
        logUpdateError(error, errorType);
        
        // 发送增强的错误信息到渲染进程
        sendUpdateStatusToRenderer('error', {
            error: error,
            classification: errorType,
            retryAttempts: retryAttempts,
            maxRetries: MAX_RETRY_ATTEMPTS,
            networkStatus: isNetworkAvailable
        });
        
        // 如果错误可恢复，执行恢复策略
        if (errorType.recoverable && errorType.retryable) {
            console.log('🔧 错误可恢复，执行恢复策略...');
            await executeRecoveryStrategy(errorType);
        } else {
            console.log('💥 错误不可恢复，停止重试');
            retryAttempts = MAX_RETRY_ATTEMPTS; // 防止进一步重试
            sendUpdateStatusToRenderer('error-unrecoverable', {
                errorType: errorType,
                message: errorType.userMessage
            });
        }
    });

    autoUpdater.on('download-progress', (progressObj) => {
        const logMessage = `下载进度: ${progressObj.percent.toFixed(2)}% (${progressObj.transferred}/${progressObj.total})`;
        console.log(logMessage);
        sendUpdateStatusToRenderer('download-progress', {
            percent: progressObj.percent,
            transferred: progressObj.transferred,
            total: progressObj.total,
            bytesPerSecond: progressObj.bytesPerSecond
        });
    });

    autoUpdater.on('update-downloaded', (info) => {
        console.log('更新下载完成:', info.version);
        
        // 【第7步增强】成功事件时重置重试计数器
        retryAttempts = 0;
        
        sendUpdateStatusToRenderer('update-downloaded', {
            version: info.version,
            message: '更新已下载完成，重启应用即可完成更新'
        });
    });
}

// 向渲染进程发送更新状态
function sendUpdateStatusToRenderer(event, data) {
    if (mainWindow && mainWindow.webContents) {
        mainWindow.webContents.send('update-status', { event, data });
    }
}

// 检查更新
function checkForUpdates() {
    if (!app.isPackaged) {
        console.log('开发环境：跳过更新检查');
        return;
    }

    console.log('开始检查更新...');
    autoUpdater.checkForUpdatesAndNotify().catch(err => {
        console.error('检查更新失败:', err);
        sendUpdateStatusToRenderer('update-error', {
            message: '检查更新失败: ' + err.message
        });
    });
}

// 创建主窗口
function createWindow() {
    // 创建浏览器窗口
    mainWindow = new BrowserWindow({
        width: 1280,
        height: 800,
        minWidth: 1024,
        minHeight: 720,
        title: '信息查询助手',
        backgroundColor: '#f9fafb',
        icon: path.join(__dirname, '../renderer/assets/icon.ico'),
        frame: false,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            enableRemoteModule: true,
            webSecurity: false // 临时禁用安全限制，允许加载本地文件
        },
        autoHideMenuBar: true,
        show: false
    });

    // 根据运行环境选择正确的路径
    let indexPath;
    let isPackaged = app.isPackaged;
    console.log('App is packaged:', isPackaged);
    console.log('Current directory:', __dirname);
    console.log('App path:', app.getAppPath());
    console.log('Resource path:', process.resourcesPath);

    if (isPackaged) {
        // 生产环境 - 使用多种备选路径
        const possiblePaths = [
            // 标准asar路径
            path.join(process.resourcesPath, 'app.asar', 'src', 'renderer', 'index.html'),
            // 解压模式下的路径
            path.join(process.resourcesPath, 'app', 'src', 'renderer', 'index.html'),
            // 相对于应用根目录的路径
            path.join(app.getAppPath(), 'src', 'renderer', 'index.html'),
            // 传统路径
            path.join(process.resourcesPath, 'app', 'renderer', 'index.html')
        ];

        // 尝试找到存在的文件路径
        indexPath = possiblePaths.find(p => {
            try {
                return fs.existsSync(p);
            } catch (err) {
                console.log(`Path check error for ${p}:`, err.message);
                return false;
            }
        });

        if (!indexPath) {
            console.error('无法找到有效的index.html路径，将使用默认路径');
            indexPath = path.join(app.getAppPath(), 'src', 'renderer', 'index.html');
        }

        console.log('Production - Using index path:', indexPath);
        console.log('File exists check:', fs.existsSync(indexPath) ? 'Yes' : 'No');
    } else {
        // 开发环境
        indexPath = path.join(__dirname, '../renderer/index.html');
        console.log('Development - Loading from:', indexPath);
    }

    // 加载应用的 index.html
    console.log('Attempting to load:', indexPath);
    
    // 先尝试使用loadFile方法
    mainWindow.loadFile(indexPath).then(() => {
        console.log('Successfully loaded using loadFile');
    }).catch(err => {
        console.error('Failed to load index.html with loadFile:', err);
        
        // 如果loadFile失败，尝试使用loadURL方法
        const fileUrl = `file://${indexPath.replace(/\\/g, '/')}`;
        console.log('Trying alternative URL with loadURL:', fileUrl);
        
        mainWindow.loadURL(fileUrl).then(() => {
            console.log('Successfully loaded using loadURL');
        }).catch(err => {
            console.error('Also failed with loadURL method:', err);
            
            // 如果都失败了，尝试使用绝对路径
            const absoluteUrl = `file:///${app.getAppPath().replace(/\\/g, '/')}/src/renderer/index.html`;
            console.log('Last attempt with absolute URL:', absoluteUrl);
            
            mainWindow.loadURL(absoluteUrl).catch(err => {
                console.error('All loading methods failed:', err);
                dialog.showErrorBox('应用启动错误', `无法加载界面: ${err.message}\n请联系开发人员。`);
            });
        });
    });

    // 当窗口准备好时显示，或者最多延迟1秒
    let windowShown = false;
    
    mainWindow.once('ready-to-show', () => {
        if (!windowShown) {
            windowShown = true;
            mainWindow.show();
            console.log('窗口通过ready-to-show事件显示');
        }
    });
    
    // 备用显示机制：最多延迟1秒就强制显示窗口
    setTimeout(() => {
        if (!windowShown) {
            windowShown = true;
            mainWindow.show();
            console.log('窗口通过超时机制显示');
        }
    }, 1000);

    // 窗口关闭时清空引用
    mainWindow.on('closed', () => {
        mainWindow = null;
    });
    
    // 打开开发者工具（在打包环境中也打开以便查看错误）
    if (!isPackaged || process.env.DEBUG_PROD) {
        mainWindow.webContents.openDevTools();
    }
}

// 当 Electron 完成初始化并准备创建浏览器窗口时调用此方法
app.whenReady().then(() => {
    // 注册自定义协议处理器，帮助处理文件路径问题
    protocol.registerFileProtocol('app', (request, callback) => {
        const url = request.url.substring(6); // 移除 'app://'
        const appPath = app.getAppPath();
        const filePath = path.join(appPath, url);
        callback({ path: filePath });
    });
    
    configureAutoUpdater();
    createWindow();
    
    // 窗口准备好后延迟检查更新，避免阻塞启动
    setTimeout(() => {
        checkForUpdates();
    }, 3000); // 延迟3秒检查更新
});

// 当所有窗口关闭时退出应用
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (mainWindow === null) {
        createWindow();
    }
});

// 处理窗口控制事件
ipcMain.on('window-minimize', () => {
    if (mainWindow) {
        mainWindow.minimize();
    }
});

ipcMain.on('window-maximize', () => {
    if (mainWindow) {
        if (mainWindow.isMaximized()) {
            mainWindow.unmaximize();
        } else {
            mainWindow.maximize();
        }
    }
});

ipcMain.on('window-close', () => {
    if (mainWindow) {
        mainWindow.close();
    }
});

// 获取系统信息
ipcMain.handle('get-system-info', async () => {
    return {
        cpuCount: os.cpus().length,
        platform: os.platform(),
        release: os.release(),
        totalMemory: os.totalmem(),
        freeMemory: os.freemem()
    };
});

// 处理IPC消息
ipcMain.handle('start-search', async (event, searchParams) => {
    try {
        return { success: true, message: '查询请求已接收' };
    } catch (error) {
        console.error('查询启动错误:', error);
        return { success: false, message: error.message };
    }
});

// 处理错误对话框
ipcMain.handle('show-error', async (event, options) => {
    return dialog.showMessageBox(mainWindow, {
        type: 'error',
        title: options.title || '错误',
        message: options.message || '发生了未知错误',
        buttons: ['确定']
    });
});

// 添加IPC处理器
ipcMain.handle('show-save-dialog', async (event, options) => {
    const result = await dialog.showSaveDialog(BrowserWindow.getFocusedWindow(), options);
    return result.filePath;
});

// 自动更新相关的IPC处理器

// 手动检查更新
ipcMain.handle('check-for-updates', async () => {
    console.log('收到手动检查更新请求');
    checkForUpdates();
    return { success: true, message: '正在检查更新...' };
});

// 开始下载更新
ipcMain.handle('download-update', async () => {
    try {
        console.log('开始下载更新');
        autoUpdater.downloadUpdate();
        return { success: true, message: '开始下载更新' };
    } catch (error) {
        console.error('下载更新失败:', error);
        return { success: false, message: error.message };
    }
});

// 安装更新并重启应用
ipcMain.handle('install-update', async () => {
    try {
        console.log('安装更新并重启应用');
        autoUpdater.quitAndInstall();
        return { success: true, message: '正在重启应用以完成更新' };
    } catch (error) {
        console.error('安装更新失败:', error);
        return { success: false, message: error.message };
    }
});

// 获取当前版本信息
ipcMain.handle('get-version', async () => {
    return {
        version: app.getVersion(),
        name: app.getName()
    };
});

// 显示更新对话框
ipcMain.handle('show-update-dialog', async (event, options) => {
    const result = await dialog.showMessageBox(mainWindow, {
        type: 'info',
        title: '发现新版本',
        message: `发现新版本 ${options.version}`,
        detail: options.releaseNotes || '点击"立即更新"开始下载新版本',
        buttons: ['立即更新', '稍后提醒', '忽略此版本'],
        defaultId: 0,
        cancelId: 1
    });
    
    return {
        response: result.response,
        action: ['update', 'later', 'ignore'][result.response]
    };
});

// 更新设置管理
ipcMain.handle('get-update-settings', async () => {
    const settings = {
        autoCheck: true,
        checkInterval: 24, // 小时
        autoDownload: false,
        notifyOnAvailable: true,
        includePrereleases: false
    };
    return settings;
});

ipcMain.handle('save-update-settings', async (event, settings) => {
    try {
        // 保存更新设置到应用数据
        console.log('保存更新设置:', settings);
        
        // 应用新的设置
        if (settings.autoDownload !== undefined) {
            autoUpdater.autoDownload = settings.autoDownload;
        }
        
        return { success: true, message: '更新设置已保存' };
    } catch (error) {
        console.error('保存更新设置失败:', error);
        return { success: false, message: error.message };
    }
});

// 更新状态查询
ipcMain.handle('get-update-status', async () => {
    return {
        isChecking: false,
        isDownloading: false,
        isUpdateAvailable: false,
        downloadProgress: 0,
        currentVersion: app.getVersion(),
        latestVersion: null,
        lastCheckTime: null,
        error: null
    };
});

// 更新历史记录
ipcMain.handle('get-update-history', async () => {
    const history = [
        {
            version: app.getVersion(),
            date: new Date().toISOString(),
            type: 'current',
            status: 'installed'
        }
    ];
    return history;
});

// 清除更新缓存
ipcMain.handle('clear-update-cache', async () => {
    try {
        console.log('清除更新缓存');
        // 【第7步增强】使用新的缓存清理功能
        const result = await clearUpdateCache();
        return { 
            success: result, 
            message: result ? '更新缓存已清除' : '缓存清除失败或不存在缓存目录' 
        };
    } catch (error) {
        console.error('清除更新缓存失败:', error);
        return { success: false, message: error.message };
    }
});

// 获取更新渠道信息
ipcMain.handle('get-update-channel', async () => {
    return {
        current: 'stable',
        available: ['stable', 'beta', 'alpha']
    };
});

// 切换更新渠道
ipcMain.handle('set-update-channel', async (event, channel) => {
    try {
        console.log('切换更新渠道到:', channel);
        // 这里可以添加切换渠道的逻辑
        return { success: true, message: `已切换到 ${channel} 渠道` };
    } catch (error) {
        console.error('切换更新渠道失败:', error);
        return { success: false, message: error.message };
    }
});

// 强制检查更新（忽略间隔限制）
ipcMain.handle('force-check-updates', async () => {
    console.log('强制检查更新');
    try {
        await autoUpdater.checkForUpdatesAndNotify();
        return { success: true, message: '强制检查更新已启动' };
    } catch (error) {
        console.error('强制检查更新失败:', error);
        return { success: false, message: error.message };
    }
});

// 获取更新信息详情
ipcMain.handle('get-update-info', async () => {
    return {
        updateURL: 'https://github.com/albutta697/info-query-app/releases',
        feedURL: autoUpdater.getFeedURL(),
        platform: process.platform,
        arch: process.arch,
        appPath: app.getAppPath(),
        userDataPath: app.getPath('userData')
    };
});

// 重启应用（不安装更新）
ipcMain.handle('restart-app', async () => {
    console.log('重启应用');
    app.relaunch();
    app.exit();
});

/* ========================================
   第7步：错误处理和恢复机制的IPC处理器
   ======================================== */

// 获取错误历史记录
ipcMain.handle('get-error-history', async () => {
    return {
        errors: updateErrorHistory,
        retryAttempts: retryAttempts,
        maxRetries: MAX_RETRY_ATTEMPTS,
        networkStatus: isNetworkAvailable,
        lastKnownGoodVersion: lastKnownGoodVersion
    };
});

// 手动重试更新
ipcMain.handle('retry-update', async () => {
    try {
        console.log('手动重试更新请求');
        
        // 检查是否已达到最大重试次数
        if (retryAttempts >= MAX_RETRY_ATTEMPTS) {
            return { 
                success: false, 
                message: `已达到最大重试次数 (${MAX_RETRY_ATTEMPTS})，请稍后再试` 
            };
        }
        
        // 重置重试计数器（用户手动重试）
        retryAttempts = 0;
        
        const success = await retryUpdateCheck();
        return { 
            success: success, 
            message: success ? '重试已启动' : '重试启动失败' 
        };
    } catch (error) {
        console.error('手动重试失败:', error);
        return { success: false, message: error.message };
    }
});

// 检查网络连接状态
ipcMain.handle('check-network-connectivity', async () => {
    try {
        const isConnected = await checkNetworkConnectivity();
        return {
            success: true,
            connected: isConnected,
            message: isConnected ? '网络连接正常' : '网络连接不可用'
        };
    } catch (error) {
        console.error('网络检查失败:', error);
        return { 
            success: false, 
            connected: false, 
            message: error.message 
        };
    }
});

// 重置重试计数器
ipcMain.handle('reset-retry-count', async () => {
    try {
        const previousAttempts = retryAttempts;
        retryAttempts = 0;
        console.log(`重试计数器已重置 (之前: ${previousAttempts})`);
        
        return { 
            success: true, 
            message: `重试计数器已重置 (之前: ${previousAttempts})`,
            previousAttempts: previousAttempts
        };
    } catch (error) {
        console.error('重置重试计数器失败:', error);
        return { success: false, message: error.message };
    }
});

// 获取恢复状态信息
ipcMain.handle('get-recovery-status', async () => {
    try {
        return {
            retryAttempts: retryAttempts,
            maxRetries: MAX_RETRY_ATTEMPTS,
            canRetry: retryAttempts < MAX_RETRY_ATTEMPTS,
            networkAvailable: isNetworkAvailable,
            lastKnownGoodVersion: lastKnownGoodVersion,
            errorHistoryCount: updateErrorHistory.length,
            recoveryStrategiesAvailable: [
                'network_retry',
                'cache_clear',
                'integrity_check',
                'manual_retry'
            ]
        };
    } catch (error) {
        console.error('获取恢复状态失败:', error);
        return { 
            error: error.message,
            retryAttempts: retryAttempts,
            maxRetries: MAX_RETRY_ATTEMPTS,
            canRetry: false
        };
    }
});

// 执行特定恢复策略
ipcMain.handle('execute-recovery-strategy', async (event, strategyType) => {
    try {
        console.log(`执行恢复策略: ${strategyType}`);
        
        switch (strategyType) {
            case 'clear_cache':
                const cacheCleared = await clearUpdateCache();
                return { 
                    success: cacheCleared, 
                    message: cacheCleared ? '缓存已清理' : '缓存清理失败' 
                };
                
            case 'check_network':
                const networkOk = await checkNetworkConnectivity();
                return { 
                    success: true, 
                    networkAvailable: networkOk,
                    message: networkOk ? '网络连接正常' : '网络连接不可用' 
                };
                
            case 'reset_retry':
                retryAttempts = 0;
                return { 
                    success: true, 
                    message: '重试计数器已重置' 
                };
                
            case 'force_retry':
                retryAttempts = 0; // 重置计数器
                const retrySuccess = await retryUpdateCheck();
                return { 
                    success: retrySuccess, 
                    message: retrySuccess ? '强制重试已启动' : '强制重试失败' 
                };
                
            default:
                return { 
                    success: false, 
                    message: `未知的恢复策略: ${strategyType}` 
                };
        }
    } catch (error) {
        console.error('执行恢复策略失败:', error);
        return { success: false, message: error.message };
    }
});

// 用于存储更新设置的全局变量
let updateSettings = {
    autoCheck: true,
    autoDownload: false,
    updateChannel: 'stable',
    checkInterval: 3600000 // 1小时
};

/* ========================================
   第7步：完善错误处理和恢复机制
   ======================================== */

// 错误处理和恢复机制的全局变量
let retryAttempts = 0;
const MAX_RETRY_ATTEMPTS = 3;
let isNetworkAvailable = true;
let lastKnownGoodVersion = null;
let updateErrorHistory = [];

/**
 * 增强的错误分类器
 */
function classifyUpdateError(error) {
    const errorType = {
        type: 'unknown',
        severity: 'medium',
        recoverable: true,
        retryable: true,
        userMessage: '更新过程中出现未知错误'
    };

    if (!error) return errorType;

    const message = error.message?.toLowerCase() || '';
    
    // 网络相关错误
    if (message.includes('net::') || message.includes('network') || 
        message.includes('timeout') || message.includes('connection')) {
        return {
            type: 'network',
            severity: 'low',
            recoverable: true,
            retryable: true,
            userMessage: '网络连接问题，将自动重试'
        };
    }
    
    // 权限相关错误
    if (message.includes('permission') || message.includes('access') || 
        message.includes('eacces') || message.includes('eperm')) {
        return {
            type: 'permission',
            severity: 'high',
            recoverable: false,
            retryable: false,
            userMessage: '权限不足，请以管理员身份运行应用'
        };
    }
    
    // 磁盘空间错误
    if (message.includes('enospc') || message.includes('disk') || 
        message.includes('space')) {
        return {
            type: 'disk_space',
            severity: 'high',
            recoverable: false,
            retryable: false,
            userMessage: '磁盘空间不足，请清理磁盘后重试'
        };
    }
    
    // 文件完整性错误
    if (message.includes('checksum') || message.includes('signature') || 
        message.includes('corrupt')) {
        return {
            type: 'integrity',
            severity: 'medium',
            recoverable: true,
            retryable: true,
            userMessage: '文件完整性校验失败，将重新下载'
        };
    }
    
    // 服务器错误
    if (message.includes('404') || message.includes('500') || 
        message.includes('server')) {
        return {
            type: 'server',
            severity: 'medium',
            recoverable: true,
            retryable: true,
            userMessage: '服务器暂时不可用，稍后将自动重试'
        };
    }

    return errorType;
}

/**
 * 网络连接检测
 */
async function checkNetworkConnectivity() {
    try {
        const { net } = require('electron');
        
        // 检测到GitHub的连接
        const isGitHubReachable = await new Promise((resolve) => {
            const request = net.request('https://api.github.com/');
            request.on('response', (response) => {
                resolve(response.statusCode === 200 || response.statusCode === 403);
            });
            request.on('error', () => resolve(false));
            request.setTimeout(5000, () => resolve(false));
            request.end();
        });
        
        isNetworkAvailable = isGitHubReachable;
        return isGitHubReachable;
    } catch (error) {
        console.error('网络检测失败:', error);
        isNetworkAvailable = false;
        return false;
    }
}

/**
 * 自动重试机制
 */
async function retryUpdateCheck() {
    if (retryAttempts >= MAX_RETRY_ATTEMPTS) {
        console.log(`❌ 达到最大重试次数 (${MAX_RETRY_ATTEMPTS})，停止重试`);
        sendUpdateStatusToRenderer('max-retries-reached', {
            attempts: retryAttempts,
            maxAttempts: MAX_RETRY_ATTEMPTS
        });
        return false;
    }
    
    // 检查网络连接
    const networkOk = await checkNetworkConnectivity();
    if (!networkOk) {
        console.log('⚠️ 网络不可用，延迟重试');
        setTimeout(() => retryUpdateCheck(), 30000); // 30秒后重试
        return false;
    }
    
    retryAttempts++;
    console.log(`🔄 第 ${retryAttempts} 次重试更新检查...`);
    
    // 延迟递增重试
    const retryDelay = Math.min(1000 * Math.pow(2, retryAttempts - 1), 60000); // 最多1分钟
    
    setTimeout(() => {
        sendUpdateStatusToRenderer('retry-attempt', {
            attempt: retryAttempts,
            maxAttempts: MAX_RETRY_ATTEMPTS,
            delay: retryDelay
        });
        autoUpdater.checkForUpdatesAndNotify();
    }, retryDelay);
    
    return true;
}

/**
 * 清理更新缓存
 */
async function clearUpdateCache() {
    try {
        const { app } = require('electron');
        const path = require('path');
        const fs = require('fs').promises;
        
        const cacheDir = path.join(app.getPath('userData'), 'info-query-app-updater');
        
        // 检查缓存目录是否存在
        try {
            await fs.access(cacheDir);
            await fs.rmdir(cacheDir, { recursive: true });
            console.log('✅ 更新缓存已清理');
            return true;
        } catch (error) {
            if (error.code !== 'ENOENT') {
                console.error('清理缓存失败:', error);
            }
            return false;
        }
    } catch (error) {
        console.error('清理缓存过程出错:', error);
        return false;
    }
}

/**
 * 记录错误历史
 */
function logUpdateError(error, errorType) {
    const errorRecord = {
        timestamp: new Date().toISOString(),
        error: {
            message: error.message || error.toString(),
            stack: error.stack,
            code: error.code
        },
        classification: errorType,
        retryAttempt: retryAttempts,
        networkStatus: isNetworkAvailable,
        version: {
            current: app.getVersion(),
            attempted: lastKnownGoodVersion
        }
    };
    
    updateErrorHistory.push(errorRecord);
    
    // 保持最近50条错误记录
    if (updateErrorHistory.length > 50) {
        updateErrorHistory = updateErrorHistory.slice(-50);
    }
    
    // 写入日志文件
    writeErrorLog(errorRecord);
}

/**
 * 写入错误日志文件
 */
async function writeErrorLog(errorRecord) {
    try {
        const { app } = require('electron');
        const path = require('path');
        const fs = require('fs').promises;
        
        const logDir = path.join(app.getPath('userData'), 'logs');
        const logFile = path.join(logDir, 'update-errors.log');
        
        // 确保日志目录存在
        await fs.mkdir(logDir, { recursive: true });
        
        const logEntry = `[${errorRecord.timestamp}] ${JSON.stringify(errorRecord)}\n`;
        await fs.appendFile(logFile, logEntry);
    } catch (error) {
        console.error('写入错误日志失败:', error);
    }
}

/**
 * 恢复策略执行器
 */
async function executeRecoveryStrategy(errorType) {
    console.log(`🔧 执行恢复策略: ${errorType.type}`);
    
    switch (errorType.type) {
        case 'network':
            // 网络错误 - 等待网络恢复后重试
            sendUpdateStatusToRenderer('recovery-waiting-network');
            await new Promise(resolve => setTimeout(resolve, 5000));
            return await retryUpdateCheck();
            
        case 'integrity':
            // 完整性错误 - 清理缓存后重试
            sendUpdateStatusToRenderer('recovery-clearing-cache');
            await clearUpdateCache();
            return await retryUpdateCheck();
            
        case 'server':
            // 服务器错误 - 延迟重试
            sendUpdateStatusToRenderer('recovery-server-retry');
            await new Promise(resolve => setTimeout(resolve, 10000));
            return await retryUpdateCheck();
            
        case 'permission':
            // 权限错误 - 提示用户
            sendUpdateStatusToRenderer('recovery-permission-error', {
                message: '需要管理员权限，请重新启动应用'
            });
            return false;
            
        case 'disk_space':
            // 磁盘空间错误 - 提示用户
            sendUpdateStatusToRenderer('recovery-disk-space-error', {
                message: '磁盘空间不足，请清理后重试'
            });
            return false;
            
        default:
            // 其他错误 - 基本重试
            return await retryUpdateCheck();
    }
}