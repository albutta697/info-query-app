const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const AdvancedDetector = require('./advanced-detector');

// 浏览器管理器类
class BrowserManager {
    constructor(config) {
        this.config = config;
        this.browser = null; // 单个浏览器实例
        this.mainPage = null; // 只用一个主页面
        this.pages = new Map(); // 兼容旧逻辑，但只用 mainPage
        this.maxPages = config.MAX_CONCURRENT_TABS || 100; // 最大标签页数量
        this.isLoggedIn = false; // 登录状态标志
        this.localChromePath = null; // 存储本地Chrome路径
        this.browserStartupErrors = []; // 存储浏览器启动过程中的错误
        this.keepAliveInterval = null; // 会话保活定时器
        this.keepAlivePage = null; // 用于会话保活的页面
        this.keepAliveIntervalTime = 15 * 60 * 1000; // 默认15分钟检查一次会话（优化：减少不必要的检查）
        this.headless = true; // 默认使用无头模式
        this.autoRefreshInterval = null; // 自动刷新定时器
        this.autoRefreshPage = null; // 用于自动刷新的页面
        
        // 内存管理相关
        this.memoryMonitorInterval = null;
        this.lastMemoryCleanTime = Date.now();
        this.memoryCleanInterval = 30 * 60 * 1000; // 默认30分钟清理一次内存
        this.memoryUsageHistory = [];
        this.memoryThreshold = 500; // MB，超过此值触发内存清理
        
        // 查询状态
        this.isQuerying = false;
        
        // 【新增】高级检测器 - 基于MCP测试的判断方法
        this.advancedDetector = new AdvancedDetector();
    }

    // 检测本地Chrome浏览器路径
    findLocalChromePath() {
        if (this.localChromePath) {
            return this.localChromePath; // 如果已经找到过，直接返回缓存的路径
        }

        // 常见的Chrome安装路径
        const commonPaths = [
            // Windows路径
            'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
            'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
            `C:\\Users\\${process.env.USERNAME}\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe`,
            // macOS路径
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            // Linux路径
            '/usr/bin/google-chrome',
            '/usr/bin/google-chrome-stable'
        ];

        // 检查常见路径
        for (const chromePath of commonPaths) {
            try {
                if (fs.existsSync(chromePath)) {
                    console.log(`找到本地Chrome浏览器: ${chromePath}`);
                    this.localChromePath = chromePath;
                    return chromePath;
                }
            } catch (error) {
                // 忽略错误，继续检查其他路径
            }
        }

        // 尝试通过注册表查找Chrome路径（仅Windows系统）
        if (process.platform === 'win32') {
            try {
                const regQuery = 'reg query "HKEY_LOCAL_MACHINE\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe" /ve';
                const regOutput = execSync(regQuery, { encoding: 'utf8' });
                const match = regOutput.match(/REG_SZ\s+([^\s]+)/);
                if (match && match[1]) {
                    const chromePath = match[1].trim();
                    if (fs.existsSync(chromePath)) {
                        console.log(`通过注册表找到Chrome: ${chromePath}`);
                        this.localChromePath = chromePath;
                        return chromePath;
                    }
                }
            } catch (error) {
                // 注册表查询失败，继续尝试其他方法
                console.log('注册表查询Chrome路径失败');
            }
        }

        console.log('未找到本地Chrome浏览器');
        return null;
    }

    // 处理浏览器启动错误并提供友好提示
    handleBrowserError(error, isLocalChrome) {
        const errorMsg = error.message || '未知错误';
        this.browserStartupErrors.push(errorMsg);
        
        console.error('浏览器启动错误:', errorMsg);
        
        // 分析错误类型并提供具体建议
        if (errorMsg.includes('ENOENT') || errorMsg.includes('Could not find')) {
            if (isLocalChrome) {
                return {
                    title: '无法启动本地Chrome浏览器',
                    message: '找到了Chrome路径，但无法启动它。可能是版本兼容性问题或权限不足。',
                    suggestions: [
                        '确保Chrome浏览器正常工作（手动打开试试）',
                        '尝试以管理员身份运行本应用',
                        '更新Chrome到最新版本'
                    ]
                };
            } else {
                return {
                    title: '找不到Chromium浏览器',
                    message: '无法找到或启动Chromium。这通常是因为puppeteer未能下载Chromium或下载不完整。',
                    suggestions: [
                        '安装Google Chrome浏览器',
                        '确保网络连接正常，重新安装应用',
                        '手动运行 npx puppeteer browsers install chrome'
                    ]
                };
            }
        } else if (errorMsg.includes('permission')) {
            return {
                title: '权限不足',
                message: '没有足够的权限启动浏览器。',
                suggestions: [
                    '以管理员身份运行本应用',
                    '检查浏览器文件的访问权限'
                ]
            };
        } else {
            return {
                title: '浏览器启动失败',
                message: `启动浏览器时发生错误: ${errorMsg}`,
                suggestions: [
                    '重启应用后再试',
                    '检查是否有其他程序占用了浏览器',
                    '确保系统资源充足（内存、磁盘空间等）'
                ]
            };
        }
    }

    // 获取最近的浏览器错误
    getLastBrowserError() {
        return this.browserStartupErrors.length > 0 ? 
            this.browserStartupErrors[this.browserStartupErrors.length - 1] : null;
    }

    // 清除错误记录
    clearErrors() {
        this.browserStartupErrors = [];
    }

    // 设置最大标签页数量
    setMaxPages(count) {
        this.maxPages = Math.max(1, Math.min(count, 100)); // 限制在1-100之间
        return this.maxPages;
    }

    // 设置浏览器的无头模式
    setHeadlessMode(isHeadless) {
        // 如果浏览器已经启动，则需要重启浏览器才能应用新设置
        const needRestart = this.browser !== null;
        
        this.headless = isHeadless;
        console.log(`浏览器无头模式已${isHeadless ? '启用' : '禁用'}`);
        
        if (needRestart) {
            console.log('需要重启浏览器才能应用新设置');
            return false;
        }
        
        return true;
    }

    // 初始化浏览器（如果尚未初始化）
    async initBrowser() {
        if (this.browser) {
            return this.browser; // 已经初始化，直接返回
        }

        // 清除之前的错误
        this.clearErrors();
        
        // 尝试找到本地Chrome浏览器
        const chromePath = this.findLocalChromePath();
        
        const launchOptions = {
            headless: this.headless ? 'new' : false, // 根据设置决定是否使用无头模式
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
            defaultViewport: { width: 1366, height: 768 }
        };
        
        // 如果找到本地Chrome，使用它
        if (chromePath) {
            launchOptions.executablePath = chromePath;
        } else {
            console.log('未找到本地Chrome浏览器，将使用puppeteer自带的Chromium（可能需要下载）');
        }
        
        console.log(`正在启动浏览器 (${this.headless ? '无头模式' : '有界面模式'})...`);
        
        try {
            this.browser = await puppeteer.launch(launchOptions);
            const version = await this.browser.version();
            console.log(`成功启动浏览器: ${version}`);
            
            // 监听浏览器关闭事件
            this.browser.on('disconnected', () => {
                console.log('浏览器已断开连接');
                this.browser = null;
                this.pages.clear();
                this.isLoggedIn = false;
            });
            
            // 启动内存监控
            this.startMemoryMonitor();
            
            return this.browser;
        } catch (error) {
            console.error('启动浏览器失败:', error.message);
            
            // 获取友好的错误信息
            const errorInfo = this.handleBrowserError(error, !!chromePath);
            
            // 如果使用本地Chrome失败，尝试使用puppeteer自带的Chromium
            if (chromePath) {
                console.log('尝试使用puppeteer自带的Chromium...');
                try {
                    this.browser = await puppeteer.launch({
                        headless: this.headless ? 'new' : false,
                        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
                        defaultViewport: { width: 1366, height: 768 }
                    });
                    const version = await this.browser.version();
                    console.log(`成功启动puppeteer自带的Chromium: ${version}`);
                    
                    // 监听浏览器关闭事件
                    this.browser.on('disconnected', () => {
                        console.log('浏览器已断开连接');
                        this.browser = null;
                        this.pages.clear();
                        this.isLoggedIn = false;
                    });
                    
                    // 启动内存监控
                    this.startMemoryMonitor();
                    
                    return this.browser;
                } catch (fallbackError) {
                    // 处理fallback错误
                    const fallbackErrorInfo = this.handleBrowserError(fallbackError, false);
                    throw new Error(`无法启动浏览器。先尝试本地Chrome失败: ${error.message}，然后尝试puppeteer自带Chromium也失败: ${fallbackError.message}`);
                }
            }
            
            throw new Error(`浏览器启动失败: ${errorInfo.title} - ${errorInfo.message}`);
        }
    }

    // 获取一个可用的页面（标签页）
    async getAvailablePage() {
        await this.initBrowser();
        if (this.mainPage && !this.mainPage.isClosed()) {
            // 确保已有页面也注入了取消检查脚本
            await this.injectCancelCheckScript(this.mainPage);
            return this.mainPage;
        }
        this.mainPage = await this.browser.newPage();
        await this.mainPage.setViewport({ width: 1366, height: 900 });
        await this.mainPage.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
        
        // 注入页面级取消检查脚本
        await this.injectCancelCheckScript(this.mainPage);
        
        await this.mainPage.goto(this.config.BASE_URL, { waitUntil: 'networkidle2', timeout: 20000 });
        // 兼容旧逻辑，放入 pages map
        this.pages.set(this.mainPage, 'busy');
        return this.mainPage;
    }

    // 注入页面级取消检查脚本
    async injectCancelCheckScript(page) {
        try {
            // 使用 evaluateOnNewDocument 替代 addInitScript，兼容性更好
            await page.evaluateOnNewDocument(() => {
                // 页面级取消状态管理
                window.pageLevelCancel = {
                    shouldStop: false,
                    checkInterval: null,
                    
                    // 启动取消检查
                    startChecking: function() {
                        if (this.checkInterval) {
                            clearInterval(this.checkInterval);
                        }
                        
                        this.checkInterval = setInterval(() => {
                            // 检查localStorage中的取消标志
                            try {
                                const cancelFlag = localStorage.getItem('globalShouldStop');
                                if (cancelFlag === 'true') {
                                    this.shouldStop = true;
                                    console.log('[页面级] 检测到取消信号');
                                }
                            } catch (error) {
                                // localStorage访问失败时的备用检查
                                console.warn('[页面级] localStorage访问失败:', error);
                            }
                        }, 10); // 每10ms检查一次
                    },
                    
                    // 停止取消检查
                    stopChecking: function() {
                        if (this.checkInterval) {
                            clearInterval(this.checkInterval);
                            this.checkInterval = null;
                        }
                        this.shouldStop = false;
                    },
                    
                    // 检查是否应该取消
                    shouldCancel: function() {
                        return this.shouldStop;
                    },
                    
                    // 重置取消状态
                    reset: function() {
                        this.shouldStop = false;
                        try {
                            localStorage.setItem('globalShouldStop', 'false');
                        } catch (error) {
                            console.warn('[页面级] 重置localStorage失败:', error);
                        }
                    }
                };
                
                // 页面加载时立即启动检查
                window.pageLevelCancel.startChecking();
                console.log('[页面级] 取消检查机制已注入并启动');
                
                // 页面卸载时清理
                window.addEventListener('beforeunload', () => {
                    window.pageLevelCancel.stopChecking();
                });
            });
            
            console.log('页面级取消检查脚本注入成功 (使用 evaluateOnNewDocument)');
        } catch (error) {
            console.error('注入页面级取消检查脚本失败:', error);
            // 提供fallback机制
            try {
                console.log('尝试使用备用方案直接注入脚本...');
                await this.injectCancelCheckScriptFallback(page);
            } catch (fallbackError) {
                console.error('备用脚本注入也失败:', fallbackError);
            }
        }
    }

    // 备用脚本注入方案
    async injectCancelCheckScriptFallback(page) {
        try {
            // 直接在页面中执行脚本
            await page.evaluate(() => {
                if (window.pageLevelCancel) {
                    return; // 如果已经存在，不重复注入
                }
                
                // 页面级取消状态管理
                window.pageLevelCancel = {
                    shouldStop: false,
                    checkInterval: null,
                    
                    startChecking: function() {
                        if (this.checkInterval) {
                            clearInterval(this.checkInterval);
                        }
                        
                        this.checkInterval = setInterval(() => {
                            try {
                                const cancelFlag = localStorage.getItem('globalShouldStop');
                                if (cancelFlag === 'true') {
                                    this.shouldStop = true;
                                    console.log('[页面级] 检测到取消信号 (备用方案)');
                                }
                            } catch (error) {
                                console.warn('[页面级] localStorage访问失败:', error);
                            }
                        }, 10);
                    },
                    
                    stopChecking: function() {
                        if (this.checkInterval) {
                            clearInterval(this.checkInterval);
                            this.checkInterval = null;
                        }
                        this.shouldStop = false;
                    },
                    
                    shouldCancel: function() {
                        return this.shouldStop;
                    },
                    
                    reset: function() {
                        this.shouldStop = false;
                        try {
                            localStorage.setItem('globalShouldStop', 'false');
                        } catch (error) {
                            console.warn('[页面级] 重置localStorage失败:', error);
                        }
                    }
                };
                
                window.pageLevelCancel.startChecking();
                console.log('[页面级] 取消检查机制已注入并启动 (备用方案)');
            });
            
            console.log('备用页面级取消检查脚本注入成功');
        } catch (error) {
            console.error('备用脚本注入失败:', error);
            throw error;
        }
    }

    // 执行登录（如果尚未登录）
    async ensureLoggedIn(page, loginFunction) {
        if (this.isLoggedIn) {
            console.log('已经登录，无需重新登录');
            
            // 即使已登录标志为true，也验证一下当前页面的登录状态
            const isActuallyLoggedIn = await this.checkLoginStatus(page);
            if (isActuallyLoggedIn) {
                return true;
            }
            
            // 如果验证失败，尝试使用已存在的cookies
            if (this.pages.size > 1) {
                try {
                    // 获取另一个页面的cookies
                    const otherPages = Array.from(this.pages.keys()).filter(p => p !== page);
                    if (otherPages.length > 0) {
                        const sourcePage = otherPages[0];
                        const cookies = await sourcePage.cookies(this.config.BASE_URL);
                        
                        // 应用cookies到当前页面
                        await page.setCookie(...cookies);
                        console.log('已从其他标签页恢复登录状态');
                        
                        // 复制localStorage和sessionStorage
                        try {
                            const storageData = await sourcePage.evaluate(() => {
                                const localStorage = Object.assign({}, window.localStorage);
                                const sessionStorage = Object.assign({}, window.sessionStorage);
                                return { localStorage, sessionStorage };
                            });
                            
                            // 在当前页面中应用localStorage和sessionStorage
                            await page.evaluate((data) => {
                                // 清空现有存储
                                window.localStorage.clear();
                                window.sessionStorage.clear();
                                
                                // 应用localStorage
                                for (const [key, value] of Object.entries(data.localStorage)) {
                                    window.localStorage.setItem(key, value);
                                }
                                
                                // 应用sessionStorage
                                for (const [key, value] of Object.entries(data.sessionStorage)) {
                                    window.sessionStorage.setItem(key, value);
                                }
                            }, storageData);
                            
                            console.log('已复制localStorage和sessionStorage数据');
                        } catch (storageError) {
                            console.error('复制存储数据失败:', storageError.message);
                        }
                        
                        // 刷新页面以应用cookies
                        await page.goto(this.config.BASE_URL, { 
                            waitUntil: 'networkidle2', 
                            timeout: 10000 
                        });
                        
                        // 再次检查登录状态
                        const isNowLoggedIn = await this.checkLoginStatus(page);
                        if (isNowLoggedIn) {
                            return true;
                        }
                    }
                } catch (error) {
                    console.error('恢复登录状态失败:', error.message);
                }
            }
            
            // 如果恢复失败，重置登录状态标志
            console.log('登录状态已失效，需要重新登录');
            this.isLoggedIn = false;
        }

        try {
            // 访问目标网站
            await page.goto(this.config.BASE_URL, { 
                waitUntil: 'networkidle2', 
                timeout: 30000 
            });
            
            // 执行登录
            console.log('正在执行首次登录或重新登录...');
            await loginFunction(page);
            
            // 标记为已登录
            this.isLoggedIn = true;
            console.log('登录成功，会话已建立');
            
            // 将新的会话状态同步到所有其他页面
            await this.syncSessionToAllPages(page);
            
            return true;
        } catch (error) {
            console.error('登录失败:', error.message);
            return false;
        }
    }

    // 释放页面（将状态设置为空闲）
    releasePage(page) {
        if (this.pages.has(page)) {
            this.pages.set(page, 'idle');
        }
    }

    // 关闭一个页面
    async closePage(page) {
        if (this.pages.has(page)) {
            this.pages.delete(page);
            await page.close().catch(err => console.error('关闭页面错误:', err));
        }
    }

    // 关闭所有页面和浏览器
    async closeAll() {
        try {
            // 先执行清理
            await this.cleanupBeforeClose();
            
            if (this.browser) {
                await this.browser.close();
                this.browser = null;
                this.mainPage = null;
                this.pages.clear();
                this.isLoggedIn = false;
                console.log('浏览器已关闭');
            }
            return true;
        } catch (error) {
            console.error('关闭浏览器错误:', error);
            return false;
        }
    }
    
    // 获取数据库总数据量
    async getDataStats(page) {
        try {
            if (!page || page.isClosed()) {
                return null;
            }
            
            const dataStats = await page.evaluate(() => {
                // 查找包含"共xxx条数据"的元素
                const elements = Array.from(document.querySelectorAll('*'));
                const statsElement = elements.find(el => 
                    el.textContent && 
                    el.textContent.includes('共') && 
                    el.textContent.includes('条数据') &&
                    el.textContent.match(/共\d+条数据/)
                );
                
                if (statsElement) {
                    const match = statsElement.textContent.match(/共(\d+)条数据/);
                    if (match && match[1]) {
                        const count = parseInt(match[1]);
                        const isFiltered = count < 2000000000; // 如果少于20亿，可能是筛选后的结果
                        return {
                            totalCount: count,
                            rawText: statsElement.textContent,
                            found: true,
                            isFiltered: isFiltered,
                            status: isFiltered ? '筛选结果' : '全部数据',
                            formattedCount: count.toLocaleString()
                        };
                    }
                }
                
                return {
                    totalCount: 0,
                    rawText: '',
                    found: false,
                    isFiltered: false,
                    status: '无数据',
                    formattedCount: '0'
                };
            });
            
            console.log('数据库统计获取结果:', dataStats);
            return dataStats;
        } catch (error) {
            console.error('获取数据库统计失败:', error.message);
            return null;
        }
    }

    // 检查登录状态是否有效 - 优化版本
    async checkLoginStatus(page) {
        try {
            console.log('开始检查登录状态...');
            
            // 获取页面基本信息
            const pageInfo = await page.evaluate(() => {
                // 检查查询相关的关键元素
                const queryButtons = Array.from(document.querySelectorAll('button')).filter(btn => 
                    btn.textContent && btn.textContent.includes('查询')
                );
                const hasQueryButton = queryButtons.length > 0 && queryButtons.some(btn => !btn.disabled);
                
                // 检查表单输入框的状态
                const formInputs = document.querySelectorAll('.n-input__input-el');
                const hasActiveInputs = formInputs.length > 0 && Array.from(formInputs).some(input => 
                    !input.disabled && !input.readOnly
                );
                
                // 检查导航菜单项（登录后会有信息管理、信息导出、用户管理等菜单）
                const hasNavMenus = Array.from(document.querySelectorAll('p')).some(p => 
                    ['信息管理', '信息导出', '用户管理'].includes(p.textContent.trim())
                );
                
                // 检查数据统计文本（登录后会显示"共xxx条数据"）
                const hasDataStats = Array.from(document.querySelectorAll('*')).some(el => 
                    el.textContent && el.textContent.includes('共') && el.textContent.includes('条数据')
                );
                
                return {
                    url: window.location.href,
                    pathname: window.location.pathname,
                    hash: window.location.hash,
                    title: document.title,
                    hasLoginForm: !!document.querySelector('.n-form'),
                    hasQueryForm: !!document.querySelector('input[placeholder="请输入"]'),
                    hasDataTable: !!document.querySelector('table'),
                    hasNavigation: !!document.querySelector('.n-layout-header'),
                    hasQueryButton: hasQueryButton,
                    hasActiveInputs: hasActiveInputs,
                    formInputCount: formInputs.length,
                    hasNavMenus: hasNavMenus,
                    hasDataStats: hasDataStats
                };
            });
            
            console.log('页面信息:', pageInfo);
            
            // 优化的登录状态判断逻辑
            const loginChecks = {
                // 方法1: URL路径判断 (最可靠)
                urlCheck: pageInfo.hash === '#/user',
                
                // 方法2: 页面标题判断
                titleCheck: pageInfo.title === '信息管理',
                
                // 方法3: 关键UI元素组合判断
                uiElementsCheck: pageInfo.hasNavMenus && pageInfo.hasDataStats && pageInfo.hasDataTable,
                
                // 方法4: 查询功能可用性判断
                queryFunctionCheck: pageInfo.hasQueryButton && pageInfo.hasActiveInputs && pageInfo.formInputCount >= 3,
                
                // 反向检查：是否在登录页面
                notOnLoginPage: !pageInfo.hash.includes('/login') && pageInfo.title !== '登录' && !pageInfo.hasLoginForm
            };
            
            console.log('登录状态检查结果:', loginChecks);
            
            // 组合判断逻辑（优先级从高到低）
            
            // 1. 最强判断：URL + 标题 + UI元素 + 查询功能都通过
            if (loginChecks.urlCheck && loginChecks.titleCheck && 
                loginChecks.uiElementsCheck && loginChecks.queryFunctionCheck) {
                console.log('✅ 通过全面检查确认已登录状态（最高可信度）');
                this.isLoggedIn = true;
                return true;
            }
            
            // 2. 强判断：URL + 标题 + 查询功能通过
            if (loginChecks.urlCheck && loginChecks.titleCheck && loginChecks.queryFunctionCheck) {
                console.log('✅ 通过URL、标题和功能检查确认已登录状态');
                this.isLoggedIn = true;
                return true;
            }
            
            // 3. 中等判断：URL + 标题通过，且不在登录页面
            if (loginChecks.urlCheck && loginChecks.titleCheck && loginChecks.notOnLoginPage) {
                console.log('✅ 通过URL和标题检查确认已登录状态');
                this.isLoggedIn = true;
                return true;
            }
            
            // 4. 检查是否明确在登录页面
            if (pageInfo.hash.includes('/login') || pageInfo.title === '登录' || pageInfo.hasLoginForm) {
                console.log('❌ 确认当前在登录页面，需要登录');
                this.isLoggedIn = false;
                return false;
            }
            
            // 5. 备用判断：有UI元素特征且查询功能可用
            if (loginChecks.uiElementsCheck && loginChecks.queryFunctionCheck && loginChecks.notOnLoginPage) {
                console.log('✅ 通过UI元素和功能特征确认已登录状态');
                this.isLoggedIn = true;
                return true;
            }
            
            // 6. 检查登录成功标记（保留原有逻辑作为补充）
            try {
                const loginData = await page.evaluate(() => {
                    const loginSuccessMarker = window.sessionStorage.getItem('loginSuccess');
                    if (loginSuccessMarker) {
                        try {
                            const data = JSON.parse(loginSuccessMarker);
                            const now = Date.now();
                            // 如果登录标记在30分钟内，认为是有效的
                            const isValid = (now - data.timestamp) < 30 * 60 * 1000;
                            return {
                                isValid: isValid,
                                apiSuccess: data.apiSuccess || false
                            };
                        } catch (e) {
                            // 兼容旧格式（纯数字时间戳）
                            const loginTime = parseInt(loginSuccessMarker);
                            const now = Date.now();
                            const isValid = (now - loginTime) < 30 * 60 * 1000;
                            return {
                                isValid: isValid,
                                apiSuccess: false
                            };
                        }
                    }
                    return { isValid: false, apiSuccess: false };
                });
                
                if (loginData.isValid && loginChecks.notOnLoginPage) {
                    console.log('✅ 通过登录成功标记确认已登录状态');
                    this.isLoggedIn = true;
                    return true;
                }
            } catch (logError) {
                console.warn('检查登录标记时出错:', logError.message);
            }
            
            // 默认保守判断为未登录
            console.log('⚠️ 无法明确判断登录状态，保守判断为未登录');
            this.isLoggedIn = false;
            return false;
            
        } catch (error) {
            console.error('检查登录状态出错:', error.message);
            // 出错时保守判断为未登录
            this.isLoggedIn = false;
            return false;
        }
    }

    // 启动会话保活机制 - 修复重复登录问题
    async startSessionKeepAlive() {
        // 如果已经有保活定时器，先清除
        if (this.keepAliveInterval) {
            clearInterval(this.keepAliveInterval);
            this.keepAliveInterval = null;
        }
        try {
            console.log('启动会话保活机制...');
            
            // 准备保活页面（但不立即检查登录状态，避免重复登录）
            if (!this.mainPage || this.mainPage.isClosed()) {
                this.mainPage = await this.browser.newPage();
                await this.mainPage.setViewport({ width: 1366, height: 900 });
                await this.mainPage.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
                await this.mainPage.goto(this.config.BASE_URL, { waitUntil: 'networkidle2', timeout: 20000 });
            }
            this.keepAlivePage = this.mainPage;
            
            console.log('保活页面已准备，跳过首次登录检查（避免重复登录）');
            
            // 启动定时检查（优化后的智能保活）
            this.keepAliveInterval = setInterval(async () => {
                try {
                    console.log('🔄 执行定时会话保活检查...');
                    
                    // 先检查浏览器和页面状态
                    if (!this.browser || !this.mainPage || this.mainPage.isClosed()) {
                        console.log('⚠️ 保活页面已关闭，重新创建...');
                        if (!this.browser) {
                            console.log('浏览器已关闭，保活机制停止');
                            return;
                        }
                        this.mainPage = await this.browser.newPage();
                        await this.mainPage.setViewport({ width: 1366, height: 900 });
                        await this.mainPage.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
                        await this.mainPage.goto(this.config.BASE_URL, { waitUntil: 'networkidle2', timeout: 20000 });
                    }
                    this.keepAlivePage = this.mainPage;
                    
                    // 快速检查URL和标题（最可靠的判断方法）
                    const quickCheck = await this.mainPage.evaluate(() => ({
                        url: window.location.href,
                        hash: window.location.hash,
                        title: document.title
                    }));
                    
                    // 如果URL和标题都正确，很可能登录状态正常
                    if (quickCheck.hash === '#/user' && quickCheck.title === '信息管理') {
                        console.log('✅ 快速检查通过：登录状态正常');
                        return;
                    }
                    
                    // 如果快速检查失败，执行完整检查
                    console.log('⚠️ 快速检查未通过，执行完整登录状态检查...');
                    const isLoggedIn = await this.checkLoginStatus(this.mainPage);
                    
                    if (!isLoggedIn) {
                        console.log('❌ 登录状态失效，执行重新登录...');
                        const queryExecutor = require('./query-executor');
                        const executor = new queryExecutor(this.config);
                        await executor.performLogin(this.mainPage);
                        console.log('✅ 定时保活重新登录完成');
                    } else {
                        console.log('✅ 完整检查通过：登录状态正常');
                    }
                } catch (e) {
                    console.error('❌ 保活定时器执行失败:', e.message);
                }
            }, this.keepAliveIntervalTime);
            
            console.log(`会话保活机制已启动，每${this.keepAliveIntervalTime/1000/60}分钟检查一次（基于本地浏览器特性优化）`);
        } catch (e) {
            console.error('启动会话保活失败:', e.message);
        }
    }
    
    // 停止会话保活机制
    stopSessionKeepAlive() {
        if (this.keepAliveInterval) {
            console.log('停止会话保活机制');
            clearInterval(this.keepAliveInterval);
            this.keepAliveInterval = null;
            
            // 关闭保活页面
            if (this.keepAlivePage && !this.keepAlivePage.isClosed()) {
                this.keepAlivePage.close().catch(err => console.error('关闭保活页面出错:', err));
                this.keepAlivePage = null;
            }
        }
    }
    
    // 验证查询功能是否真正可用
    async verifyQueryCapability(page) {
        try {
            console.log('开始验证查询功能可用性...');
            
            // 1. 检查页面是否完全加载
            const pageLoadStatus = await page.evaluate(() => {
                return {
                    readyState: document.readyState,
                    hasBody: !!document.body,
                    bodyHasContent: document.body ? document.body.children.length > 0 : false
                };
            });
            
            if (pageLoadStatus.readyState !== 'complete' || !pageLoadStatus.bodyHasContent) {
                console.log('❌ 页面未完全加载');
                return { capable: false, reason: '页面未完全加载' };
            }
            
            // 2. 检查查询表单元素
            const formStatus = await page.evaluate(() => {
                const formItems = document.querySelectorAll('.n-form-item');
                const inputs = document.querySelectorAll('.n-input__input-el');
                const buttons = Array.from(document.querySelectorAll('button'));
                const queryButton = buttons.find(btn => btn.textContent && btn.textContent.includes('查询'));
                
                // 检查必要的输入字段
                const requiredFields = ['FirstName', 'LastName', 'zip', 'address'];
                const foundFields = [];
                
                formItems.forEach(item => {
                    const label = item.querySelector('.n-form-item-label');
                    const input = item.querySelector('.n-input__input-el');
                    if (label && input) {
                        const fieldName = label.textContent;
                        if (requiredFields.includes(fieldName)) {
                            foundFields.push({
                                name: fieldName,
                                disabled: input.disabled,
                                readOnly: input.readOnly,
                                value: input.value
                            });
                        }
                    }
                });
                
                return {
                    formItemCount: formItems.length,
                    inputCount: inputs.length,
                    hasQueryButton: !!queryButton,
                    queryButtonDisabled: queryButton ? queryButton.disabled : true,
                    foundRequiredFields: foundFields,
                    allRequiredFieldsFound: foundFields.length >= 3, // 至少找到3个必要字段
                    hasEnabledInputs: Array.from(inputs).some(input => !input.disabled && !input.readOnly)
                };
            });
            
            if (!formStatus.hasQueryButton) {
                return { capable: false, reason: '未找到查询按钮' };
            }
            
            if (!formStatus.allRequiredFieldsFound) {
                return { capable: false, reason: '必要的查询字段不完整' };
            }
            
            if (!formStatus.hasEnabledInputs) {
                return { capable: false, reason: '所有输入框都被禁用' };
            }
            
            // 3. 测试是否可以输入内容
            const inputTestResult = await page.evaluate(() => {
                try {
                    const testInput = document.querySelector('.n-input__input-el');
                    if (testInput && !testInput.disabled && !testInput.readOnly) {
                        const originalValue = testInput.value;
                        testInput.value = 'test';
                        testInput.dispatchEvent(new Event('input'));
                        const canInput = testInput.value === 'test';
                        testInput.value = originalValue;
                        testInput.dispatchEvent(new Event('input'));
                        return canInput;
                    }
                    return false;
                } catch (e) {
                    return false;
                }
            });
            
            if (!inputTestResult) {
                return { capable: false, reason: '无法在输入框中输入内容' };
            }
            
            // 4. 检查高级搜索状态（使用高级检测器）
            if (this.advancedDetector) {
                const advancedStatus = await this.advancedDetector.checkPageReadiness(page);
                if (advancedStatus.score < 60) {
                    console.log('⚠️ 页面准备度较低:', advancedStatus.score);
                    return { 
                        capable: false, 
                        reason: `页面准备度不足 (${advancedStatus.score}%)`, 
                        details: advancedStatus.issues 
                    };
                }
            }
            
            console.log('✅ 查询功能验证通过');
            return { 
                capable: true, 
                details: {
                    formStatus,
                    inputTestPassed: inputTestResult
                }
            };
            
        } catch (error) {
            console.error('验证查询功能时出错:', error);
            return { capable: false, reason: '验证过程出错: ' + error.message };
        }
    }
    
    // 将会话状态从源页面同步到所有活动页面
    async syncSessionToAllPages(sourcePage) {
        try {
            console.log('开始同步会话状态到所有活动页面...');
            
            // 获取源页面的cookies、localStorage和sessionStorage
            const cookies = await sourcePage.cookies(this.config.BASE_URL);
            console.log(`获取到 ${cookies.length} 个cookies`);
            
            let storageData = { localStorage: {}, sessionStorage: {} };
            
            try {
                // 尝试获取localStorage和sessionStorage
                storageData = await sourcePage.evaluate(() => {
                    // 创建存储对象的深拷贝，避免引用问题
                    const localStorage = {};
                    const sessionStorage = {};
                    
                    // 复制localStorage
                    for (let i = 0; i < window.localStorage.length; i++) {
                        const key = window.localStorage.key(i);
                        localStorage[key] = window.localStorage.getItem(key);
                    }
                    
                    // 复制sessionStorage
                    for (let i = 0; i < window.sessionStorage.length; i++) {
                        const key = window.sessionStorage.key(i);
                        sessionStorage[key] = window.sessionStorage.getItem(key);
                    }
                    
                    return { localStorage, sessionStorage };
                });
                
                console.log(`获取到 ${Object.keys(storageData.localStorage).length} 个localStorage项和 ${Object.keys(storageData.sessionStorage).length} 个sessionStorage项`);
            } catch (storageError) {
                console.error('获取存储数据失败:', storageError.message);
                console.log('将继续同步cookies，但存储数据同步将被跳过');
            }
            
            // 计算需要同步的页面数量
            const activePages = Array.from(this.pages.keys()).filter(p => p !== sourcePage && !p.isClosed());
            console.log(`需要同步到 ${activePages.length} 个活动页面`);
            
            // 同步到所有活动页面
            let successCount = 0;
            for (let page of activePages) {
                try {
                    // 应用cookies
                    await page.setCookie(...cookies);
                    
                    // 应用localStorage和sessionStorage
                    if (Object.keys(storageData.localStorage).length > 0 || Object.keys(storageData.sessionStorage).length > 0) {
                        await page.evaluate((data) => {
                            try {
                                // 应用localStorage
                                for (const [key, value] of Object.entries(data.localStorage)) {
                                    window.localStorage.setItem(key, value);
                                }
                                
                                // 应用sessionStorage
                                for (const [key, value] of Object.entries(data.sessionStorage)) {
                                    window.sessionStorage.setItem(key, value);
                                }
                                
                                return true;
                            } catch (e) {
                                console.error('在页面内应用存储数据时出错:', e);
                                return false;
                            }
                        }, storageData);
                    }
                    
                    // 如果当前页面处于空闲状态，刷新页面以应用新的会话状态
                    if (this.pages.get(page) === 'idle') {
                        try {
                            await page.reload({ waitUntil: 'networkidle2', timeout: 10000 });
                        } catch (reloadError) {
                            console.error('刷新页面失败:', reloadError.message);
                        }
                    }
                    
                    successCount++;
                    console.log(`成功同步会话状态到页面 ${successCount}/${activePages.length}`);
                } catch (pageError) {
                    console.error(`同步到页面失败:`, pageError.message);
                }
            }
            
            console.log(`会话状态同步完成，成功: ${successCount}/${activePages.length}`);
            return successCount > 0;
        } catch (error) {
            console.error('同步会话状态过程中发生错误:', error.message);
            return false;
        }
    }

    // 检查高级搜索是否已展开 - 使用高级检测器
    async checkAdvancedSearchExpanded(page) {
        try {
            console.log('[高级判断] 开始检查高级搜索展开状态...');
            
            const result = await this.advancedDetector.checkAdvancedSearchExpanded(page);
            
            console.log('[高级判断] 高级搜索展开状态检查结果:', {
                展开状态: result.isExpanded ? '已展开' : '未展开',
                找到字段数: `${result.foundFields}/${result.totalAdvancedFields}`,
                找到的字段: result.foundFieldDetails,
                扩展评分: result.expansionScore,
                字段状态: result.fieldStatus
            });
            
            return result.isExpanded;
            
        } catch (error) {
            console.error('[高级判断] 检查高级搜索展开状态失败:', error);
            return false;
        }
    }

    // 检查分页设置是否为100/页 - 使用高级检测器
    async checkPageSizeIs100(page) {
        try {
            console.log('[高级判断] 开始检查分页设置状态...');
            
            const result = await this.advancedDetector.checkPageSizeIs100(page);
            
            console.log('[高级判断] 分页设置状态检查结果:', {
                是否100每页: result.is100PerPage ? '是' : '否',
                当前设置: result.currentPageSize ? `${result.currentPageSize}/页` : '未找到',
                元素文本: result.pageSizeElementText || '无',
                找到元素数: result.pageSizeElementsCount,
                所有分页文本: result.allPageSizeTexts,
                元素检测: result.foundPageSizeElement ? '成功' : '失败'
            });
            
            return result.is100PerPage;
            
        } catch (error) {
            console.error('[高级判断] 检查分页设置状态失败:', error);
            return false;
        }
    }

    // 仅准备高级搜索页面设置（不刷新页面）
    async prepareAdvancedSearchPage(page) {
        const utils = require('./utils');
        
        try {
            console.log('开始准备高级搜索页面设置...');
            
            if (!page || page.isClosed()) {
                console.error('prepareAdvancedSearchPage 错误: 页面不存在或已关闭');
                throw new Error('页面不存在或已关闭');
            }

            // 1. 检查高级搜索是否已展开
            const isAdvancedExpanded = await this.checkAdvancedSearchExpanded(page);
            
            if (!isAdvancedExpanded) {
                console.log('高级搜索未展开，尝试点击...');
                
                // 尝试多种方式点击高级搜索
                let clickSuccess = false;
                
                // 方法1：通过文本查找高级搜索按钮
                try {
                    clickSuccess = await page.evaluate(() => {
                        const elements = Array.from(document.querySelectorAll('*'));
                        const advancedButton = elements.find(el => 
                            el.textContent && el.textContent.trim() === '高级搜索' && 
                            el.style.cursor === 'pointer'
                        );
                        if (advancedButton) {
                            advancedButton.click();
                            console.log('通过文本找到并点击了高级搜索按钮');
                            return true;
                        }
                        return false;
                    });
                } catch (e) {
                    console.warn('方法1点击高级搜索失败:', e.message);
                }

                // 方法2：如果方法1失败，尝试点击箭头图标
                if (!clickSuccess) {
                    try {
                        clickSuccess = await page.evaluate(() => {
                            const arrowIcons = document.querySelectorAll('i[class*="icon-arrow"]');
                            for (const icon of arrowIcons) {
                                if (icon.offsetParent !== null) { // 确保元素可见
                                    icon.click();
                                    console.log('通过箭头图标点击了高级搜索');
                                    return true;
                                }
                            }
                            return false;
                        });
                    } catch (e) {
                        console.warn('方法2点击箭头图标失败:', e.message);
                    }
                }

                // 方法3：如果前面都失败，尝试原来的选择器
                if (!clickSuccess) {
                    try {
                        clickSuccess = await page.evaluate(() => {
                            const arrowIcon = document.querySelector('i.iconfont[class*="_pointer_"]');
                            if (arrowIcon && arrowIcon.classList.contains('icon-arrow-down')) {
                                const advancedSearchButton = document.querySelector('span[class*="_icon-title_"][style*="color: rgb(68, 126, 217)"]');
                                if (advancedSearchButton) {
                                    advancedSearchButton.click();
                                    console.log('通过原选择器点击了高级搜索');
                                    return true;
                                }
                            }
                            return false;
                        });
                    } catch (e) {
                        console.warn('方法3原选择器失败:', e.message);
                    }
                }

                console.log('高级搜索点击结果:', clickSuccess ? '成功' : '所有方法都失败');

                // 等待展开
                if (clickSuccess) {
                    try {
                        await utils.interruptibleDelay(1500);
                    } catch (delayError) {
                        if (delayError.message === 'Operation cancelled') {
                            throw delayError;
                        }
                    }
                }
            } else {
                console.log('高级搜索已经展开，跳过点击');
            }

            // 2. 检查每页显示设置（使用统一的方法）
            const isPageSize100 = await this.checkPageSizeIs100(page);
            
            if (!isPageSize100) {
                console.log('每页显示不是100条，尝试设置...');
                
                // 点击页面大小选择器
                let pageSizeClicked = false;
                try {
                    pageSizeClicked = await page.evaluate(() => {
                        const pageSizeSelect = document.querySelector('.n-base-selection');
                        if (pageSizeSelect) {
                            pageSizeSelect.click();
                            return true;
                        }
                        return false;
                    });
                } catch (e) {
                    console.error('点击页面大小选择器失败:', e);
                }

                if (pageSizeClicked) {
                    // 等待下拉菜单
                    try {
                        await utils.interruptibleDelay(1000);
                    } catch (delayError) {
                        if (delayError.message === 'Operation cancelled') {
                            throw delayError;
                        }
                    }

                    // 选择100条
                    try {
                        const option100Selected = await page.evaluate(() => {
                            const menuItems = document.querySelectorAll('.n-base-select-option');
                            const option100 = Array.from(menuItems).find(item => item.textContent.includes('100'));
                            if (option100) {
                                option100.click();
                                console.log('已设置每页显示100条');
                                return true;
                            }
                            return false;
                        });
                        console.log('设置100条结果:', option100Selected ? '成功' : '未找到选项');
                    } catch (e) {
                        console.error('选择100条选项失败:', e);
                    }

                    // 等待设置生效
                    try {
                        await utils.interruptibleDelay(1000);
                    } catch (delayError) {
                        if (delayError.message === 'Operation cancelled') {
                            throw delayError;
                        }
                    }
                }
            } else {
                console.log('每页显示已经是100条，跳过设置');
            }

            console.log('高级搜索页面设置准备完成');
            return true;
        } catch (error) {
            console.error('准备高级搜索页面设置失败:', error);
            throw error;
        }
    }

    // 刷新并准备高级搜索页面（保持向后兼容）
    async refreshAndPrepareAdvancedSearchPage(page, forceRefresh = true) {
        const queryExecutor = require('./query-executor');
        const utils = require('./utils');
        
        try {
            console.log('开始刷新并准备高级搜索页面...', forceRefresh ? '(强制刷新)' : '(检查后刷新)');
            
            if (!page || page.isClosed()) {
                console.error('refreshAndPrepareAdvancedSearchPage 错误: 页面不存在或已关闭');
                throw new Error('页面不存在或已关闭');
            }
            
            // 检查是否需要刷新页面
            let needsRefresh = forceRefresh;
            
            if (!forceRefresh) {
                // 检查页面状态，决定是否需要刷新
                try {
                    const currentUrl = page.url();
                    const hasLoginForm = await page.evaluate(() => {
                        return !!document.querySelector('.n-form');
                    });
                    
                    needsRefresh = !currentUrl.includes(this.config.BASE_URL) || hasLoginForm;
                    console.log('页面状态检查结果:', needsRefresh ? '需要刷新' : '无需刷新');
                } catch (e) {
                    console.warn('检查页面状态失败，将进行刷新:', e.message);
                    needsRefresh = true;
                }
            }
            
            if (needsRefresh) {
            // 1. 刷新页面（推荐goto BASE_URL，兼容性更好）
            console.log('1. 正在导航到基础URL...');
            try {
                await page.goto(this.config.BASE_URL, { waitUntil: 'networkidle2', timeout: 20000 });
                console.log('页面导航完成');
            } catch (navError) {
                console.error('导航到基础URL失败:', {
                    message: navError.message,
                    name: navError.name,
                    stack: navError.stack
                });
                
                // 如果导航失败，尝试刷新页面
                try {
                    console.log('尝试刷新页面...');
                    await page.reload({ waitUntil: 'networkidle2', timeout: 10000 });
                    console.log('页面刷新成功');
                } catch (reloadError) {
                    console.error('页面刷新也失败:', reloadError.message);
                    throw new Error(`导航失败: ${navError.message}, 刷新也失败: ${reloadError.message}`);
                }
            }

            // 2. 检查是否需要登录
            console.log('2. 检查是否需要登录...');
            let hasLoginForm = false;
            try {
                hasLoginForm = await page.evaluate(() => {
                    const loginForm = document.querySelector('.n-form');
                    return !!loginForm;
                });
                console.log('登录表单检查结果:', hasLoginForm ? '需要登录' : '无需登录');
            } catch (evalError) {
                console.error('检查登录表单时出错:', evalError);
                // 如果页面已关闭，则抛出错误
                if (evalError.message.includes('Target closed')) {
                    throw evalError;
                }
                // 其他错误假设需要登录
                hasLoginForm = true;
            }
            
            if (hasLoginForm) {
                // 自动登录
                console.log('检测到登录表单，执行自动登录...');
                try {
                    const executor = new queryExecutor(this.config);
                    await executor.performLogin(page);
                    console.log('自动登录完成');
                } catch (loginError) {
                    console.error('自动登录失败:', {
                        message: loginError.message,
                        name: loginError.name,
                        stack: loginError.stack
                    });
                    throw new Error(`自动登录失败: ${loginError.message}`);
                }
            } else {
                console.log('无需登录，会话有效');
            }

            // 3. 等待主页面头部出现，确保页面已加载
            console.log('3. 等待页面头部出现...');
            try {
                await page.waitForSelector('.n-layout-header', { timeout: 10000 });
                console.log('页面头部已加载');
            } catch (headerError) {
                console.warn('未找到页面头部，可能页面结构有变化:', headerError.message);
                // 继续执行，不中断流程
            }
                        } else {
                console.log('页面无需刷新，直接进入设置阶段');
            }

            // 4. 调用准备高级搜索设置（无论是否刷新了页面）
            console.log('4. 准备高级搜索设置...');
            await this.prepareAdvancedSearchPage(page);
            
            // 5. 验证页面设置状态（使用新的状态检测方法）
            console.log('5. 验证页面设置状态...');
            let settingsVerified = false;
            let retryCount = 0;
            const maxRetries = 3;
            
            while (!settingsVerified && retryCount < maxRetries) {
                try {
                    // 检查高级搜索是否展开
                    const isAdvancedExpanded = await this.checkAdvancedSearchExpanded(page);
                    console.log(`高级搜索展开状态: ${isAdvancedExpanded ? '已展开' : '未展开'}`);
                    
                    // 检查分页设置是否为100/页
                    const isPageSize100 = await this.checkPageSizeIs100(page);
                    console.log(`分页设置状态: ${isPageSize100 ? '100/页' : '非100/页'}`);
                    
                    // 如果两个设置都已完成，验证通过
                    if (isAdvancedExpanded && isPageSize100) {
                        settingsVerified = true;
                        console.log('✅ 页面设置验证通过');
                        break;
                    }
                    
                    // 如果设置未完成，重新调用准备方法
                    console.log(`❌ 页面设置未完成 (高级搜索: ${isAdvancedExpanded}, 100/页: ${isPageSize100}), 重试第 ${retryCount + 1} 次...`);
                    retryCount++;
                    
                    if (retryCount < maxRetries) {
                        // 等待一段时间后重试
                        await new Promise(resolve => setTimeout(resolve, 2000));
                        await this.prepareAdvancedSearchPage(page);
                    }
                    
                } catch (verifyError) {
                    console.error(`页面设置验证出错 (第 ${retryCount + 1} 次):`, verifyError.message);
                    retryCount++;
                    
                    if (retryCount < maxRetries) {
                        await new Promise(resolve => setTimeout(resolve, 2000));
                    }
                }
            }
            
            if (!settingsVerified) {
                console.warn('⚠️ 页面设置验证失败，但继续执行');
            }
            
            // 6. 等待表格内容出现或变化 - 使用高级等待方法
            console.log('6. 等待表格内容出现或变化...');
            try {
                // 优先使用高级检测器的等待方法
                const waitResult = await this.advancedDetector.waitForQueryComplete(page, 10000);
                if (waitResult.success) {
                    console.log('表格内容已加载/变化 (高级检测):', waitResult);
                } else {
                    console.log('高级检测未成功，使用备用等待方法');
                    const utils = require('./utils');
                    if (typeof utils.waitForTableContentChangeOrAppear === 'function') {
                        await utils.waitForTableContentChangeOrAppear(page, null, 10000);
                        console.log('表格内容已加载/变化 (备用方法)');
                    } else {
                        console.error('waitForTableContentChangeOrAppear 函数未找到，跳过等待表格内容加载');
                        // 简单延时作为备选方案
                        await new Promise(res => setTimeout(res, 2000));
                    }
                }
            } catch (tableError) {
                console.warn('等待表格内容出错:', {
                    message: tableError.message,
                    name: tableError.name,
                    stack: tableError.stack
                });
                // 继续执行，不中断流程
                console.log('尝试简单延时作为备选方案...');
                await new Promise(res => setTimeout(res, 2000));
            }
            
            console.log('刷新并准备高级搜索页面完成');
            return true;
        } catch (error) {
            console.error('刷新并准备高级搜索页面失败:', {
                message: error.message,
                name: error.name,
                stack: error.stack,
                time: new Date().toISOString()
            });
            
            // 如果是取消操作，直接抛出
            if (error.message === 'Operation cancelled') {
                throw error;
            }
            
            // 其他错误尝试恢复
            try {
                console.log('尝试恢复页面状态...');
                await page.reload({ waitUntil: 'networkidle2', timeout: 10000 }).catch(e => {
                    console.error('页面重载失败:', e.message);
                });
            } catch (recoveryError) {
                console.error('恢复页面状态失败:', recoveryError);
            }
            
            throw new Error(`刷新页面失败: ${error.message}`);
        }
    }

    // 启动自动刷新机制，定时刷新并准备高级搜索页面
    async startAutoRefresh(interval = null) {
        if (this.autoRefreshInterval) {
            clearInterval(this.autoRefreshInterval);
            this.autoRefreshInterval = null;
        }
        const refreshMs = interval || this.config.refreshInterval || 3 * 60 * 1000;
        // 只用 mainPage
        if (!this.mainPage || this.mainPage.isClosed()) {
            this.mainPage = await this.browser.newPage();
            await this.mainPage.setViewport({ width: 1366, height: 900 });
            await this.mainPage.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
            await this.mainPage.goto(this.config.BASE_URL, { waitUntil: 'networkidle2', timeout: 20000 });
        }
        this.autoRefreshPage = this.mainPage;
        // 首次启动时使用新的准备方法
        try {
            await this.prepareAdvancedSearchPage(this.mainPage);
            console.log('[自动刷新] 首次页面设置完成（无刷新）');
        } catch (error) {
            console.warn('[自动刷新] 首次准备失败，使用完整刷新:', error.message);
            await this.refreshAndPrepareAdvancedSearchPage(this.mainPage, true);
        }
        
        this.autoRefreshInterval = setInterval(async () => {
            try {
                if (!this.mainPage || this.mainPage.isClosed()) {
                    this.mainPage = await this.browser.newPage();
                    await this.mainPage.setViewport({ width: 1366, height: 900 });
                    await this.mainPage.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36');
                    await this.mainPage.goto(this.config.BASE_URL, { waitUntil: 'networkidle2', timeout: 20000 });
                this.autoRefreshPage = this.mainPage;
                    // 页面重新创建后需要完整刷新
                    await this.refreshAndPrepareAdvancedSearchPage(this.mainPage, true);
                } else {
                    this.autoRefreshPage = this.mainPage;
                    // 页面存在时优先使用准备方法
                    try {
                        await this.prepareAdvancedSearchPage(this.mainPage);
                        console.log(`[自动刷新] 页面设置完成（无刷新）`);
                    } catch (error) {
                        console.warn('[自动刷新] 页面准备失败，使用条件刷新:', error.message);
                        await this.refreshAndPrepareAdvancedSearchPage(this.mainPage, false);
                    }
                }
                console.log(`[自动刷新] 已完成本轮页面准备`);
            } catch (e) {
                console.error('[自动刷新] 页面准备失败:', e.message);
            }
        }, refreshMs);
        console.log(`[自动刷新] 已启动，刷新间隔(ms):`, refreshMs);
    }

    // 启动内存监控
    startMemoryMonitor() {
        if (this.memoryMonitorInterval) {
            clearInterval(this.memoryMonitorInterval);
        }
        
        this.memoryMonitorInterval = setInterval(async () => {
            try {
                // 检查是否需要清理内存
                const needsCleanup = await this.checkMemoryUsage();
                if (needsCleanup) {
                    await this.cleanupMemoryOptimized();
                }
            } catch (error) {
                // 使用日志管理器，减少重复错误输出
                if (window.logger) {
                    window.logger.error('内存监控错误', 'memory_monitor', error.message);
                } else {
                    console.error('内存监控错误:', error.message);
                }
            }
        }, 60000); // 每分钟检查一次内存使用情况
        
        if (window.logger) {
            window.logger.info('内存监控已启动');
        } else {
            console.log('内存监控已启动');
        }
    }
    
    // 停止内存监控
    stopMemoryMonitor() {
        if (this.memoryMonitorInterval) {
            clearInterval(this.memoryMonitorInterval);
            this.memoryMonitorInterval = null;
            console.log('内存监控已停止');
        }
    }
    
    // 检查内存使用情况
    async checkMemoryUsage() {
        if (!this.browser || !this.mainPage) {
            return false;
        }
        
        try {
            // 获取浏览器进程内存使用情况
            const metrics = await this.mainPage.metrics();
            const jsHeapSizeMB = Math.round(metrics.JSHeapUsedSize / 1024 / 1024);
            
            // 记录内存使用历史
            this.memoryUsageHistory.push({
                timestamp: Date.now(),
                jsHeapSizeMB
            });
            
            // 只保留最近10次记录
            if (this.memoryUsageHistory.length > 10) {
                this.memoryUsageHistory.shift();
            }
            
            console.log(`当前内存使用: ${jsHeapSizeMB}MB`);
            
            // 检查是否需要清理内存
            const timeSinceLastClean = Date.now() - this.lastMemoryCleanTime;
            const memoryExceedsThreshold = jsHeapSizeMB > this.memoryThreshold;
            const timeForRoutineClean = timeSinceLastClean > this.memoryCleanInterval;
            
            // 如果内存使用超过阈值或者达到定期清理时间，则进行清理
            return memoryExceedsThreshold || timeForRoutineClean;
        } catch (error) {
            console.error('检查内存使用错误:', error.message);
            return false;
        }
    }
    
    // 清理内存
    async cleanupMemory() {
        console.log('开始清理内存...');
        
        try {
            if (!this.browser || !this.mainPage) {
                return;
            }
            
            // 记录清理前的内存使用
            const beforeMetrics = await this.mainPage.metrics();
            const beforeMB = Math.round(beforeMetrics.JSHeapUsedSize / 1024 / 1024);
            
            // 1. 执行垃圾回收
            if (this.mainPage && !this.mainPage.isClosed()) {
                await this.mainPage.evaluate(() => {
                    if (window.gc) {
                        window.gc();
                    }
                });
            }
            
            // 2. 清理页面缓存和会话数据
            if (this.mainPage && !this.mainPage.isClosed()) {
                await this.mainPage.evaluate(() => {
                    // 清理不必要的DOM元素
                    const resultItems = document.querySelectorAll('.result-item');
                    if (resultItems.length > 100) {
                        // 如果结果项过多，只保留最近的100个
                        const toRemove = Array.from(resultItems).slice(100);
                        toRemove.forEach(item => item.remove());
                    }
                    
                    // 清理控制台日志
                    console.clear();
                });
                
                // 清理页面缓存
                const client = await this.mainPage.target().createCDPSession();
                await client.send('Network.clearBrowserCache');
                await client.send('Network.clearBrowserCookies');
                
                // 可选：重新加载页面（仅在空闲时）
                if (!this.isQuerying) {
                    await this.mainPage.reload({ waitUntil: 'networkidle2' });
                }
            }
            
            // 3. 关闭不必要的页面（保留mainPage）
            for (const [page, status] of this.pages.entries()) {
                if (page !== this.mainPage && !page.isClosed()) {
                    await page.close();
                    this.pages.delete(page);
                }
            }
            
            // 记录清理后的内存使用
            const afterMetrics = await this.mainPage.metrics();
            const afterMB = Math.round(afterMetrics.JSHeapUsedSize / 1024 / 1024);
            
            console.log(`内存清理完成: ${beforeMB}MB -> ${afterMB}MB (节省 ${beforeMB - afterMB}MB)`);
            
            // 更新最后清理时间
            this.lastMemoryCleanTime = Date.now();
            
            return true;
        } catch (error) {
            console.error('内存清理错误:', error.message);
            return false;
        }
    }
    
    // 关闭浏览器前执行清理
    async cleanupBeforeClose() {
        try {
            // 停止所有定时器
            this.stopSessionKeepAlive();
            this.stopMemoryMonitor();
            
            if (this.autoRefreshInterval) {
                clearInterval(this.autoRefreshInterval);
                this.autoRefreshInterval = null;
            }
            
            // 【新增】清理高级检测器
            if (this.advancedDetector) {
                this.advancedDetector.cleanup();
            }
            
            // 关闭所有页面
            if (this.browser) {
                const pages = await this.browser.pages();
                for (const page of pages) {
                    if (!page.isClosed()) {
                        await page.close().catch(e => console.log('关闭页面错误:', e.message));
                    }
                }
            }
            
            return true;
        } catch (error) {
            console.error('清理错误:', error.message);
            return false;
        }
    }

    // 设置查询状态
    setQueryingStatus(status) {
        this.isQuerying = status;
    }
    
    // 重置页面状态
    async resetPageState() {
        try {
            console.log('开始重置页面状态...');
            
            // 如果有主页面，尝试导航回基础URL
            if (this.mainPage && !this.mainPage.isClosed()) {
                try {
                    // 停止页面上的所有操作
                    await this.mainPage.evaluate(() => {
                        // 停止所有正在进行的请求
                        if (window.stop) {
                            window.stop();
                        }
                    });
                    
                    // 重新导航到基础URL
                    await this.mainPage.goto(this.config.BASE_URL, { 
                        waitUntil: 'domcontentloaded', 
                        timeout: 10000 
                    }).catch(err => {
                        console.error('重置页面导航失败:', err);
                    });
                    
                    console.log('页面状态已重置');
                } catch (error) {
                    console.error('重置页面状态时出错:', error);
                }
            }
            
            // 重置查询状态
            this.isQuerying = false;
            
            return true;
        } catch (error) {
            console.error('重置页面状态失败:', error);
            return false;
        }
    }

    // 检查数据刷新是否成功的综合方法 - 使用高级检测器
    async checkDataRefreshSuccess(page) {
        try {
            console.log('[高级判断] 开始检查数据刷新状态...');
            
            // 使用高级检测器进行综合页面准备状态检测
            const readiness = await this.advancedDetector.checkPageReadiness(page);
            
            console.log('[高级判断] 数据刷新状态检查结果:', readiness);
            
            return {
                success: readiness.isReady,
                details: readiness.details,
                summary: this.generateAdvancedRefreshSummary(readiness),
                score: readiness.score,
                issues: readiness.issues,
                checks: readiness.checks
            };
            
        } catch (error) {
            console.error('[高级判断] 检查数据刷新状态时出错:', error);
            return {
                success: false,
                details: null,
                summary: `检查失败: ${error.message}`,
                score: 0,
                issues: ['检测过程出错'],
                error: error.message
            };
        }
    }
    
    // 评估刷新是否成功
    evaluateRefreshSuccess(refreshStatus) {
        if (!refreshStatus || refreshStatus.errors.length > 0) {
            return false;
        }
        
        // 数据统计检查：应该有合理的数据量
        const hasValidDataCount = refreshStatus.dataCount > 0;
        
        // 高级搜索检查：应该保持展开状态
        const advancedSearchOK = refreshStatus.advancedSearchExpanded;
        
        // 分页设置检查：应该是100/页
        const pageSizeOK = refreshStatus.pageSizeSetting && 
                          refreshStatus.pageSizeSetting.includes('100');
        
        // 数据表格检查：应该有数据显示
        const hasData = refreshStatus.hasDataTable;
        
        console.log('刷新成功评估:', {
            hasValidDataCount,
            advancedSearchOK, 
            pageSizeOK,
            hasData,
            overall: hasValidDataCount && advancedSearchOK && pageSizeOK
        });
        
        // 至少要满足数据统计和高级搜索两个核心条件
        return hasValidDataCount && advancedSearchOK && pageSizeOK;
    }
    
    // 生成高级刷新状态摘要 - 基于高级检测器结果
    generateAdvancedRefreshSummary(readiness) {
        if (!readiness) {
            return '无法获取刷新状态';
        }
        
        const parts = [];
        const details = readiness.details;
        
        // 数据统计
        if (details.dataState && details.dataState.dataCountText) {
            parts.push(`数据统计: ${details.dataState.dataCountText}`);
        } else {
            parts.push('数据统计: 未找到');
        }
        
        // 高级搜索状态
        if (details.advancedSearch) {
            const expansionScore = Math.round(details.advancedSearch.expansionScore * 100);
            parts.push(`高级搜索: ${details.advancedSearch.isExpanded ? '已展开' : '未展开'} (${expansionScore}%)`);
        }
        
        // 分页设置
        if (details.pageSize && details.pageSize.pageSizeElementText) {
            parts.push(`分页设置: ${details.pageSize.pageSizeElementText}`);
        } else {
            parts.push('分页设置: 未找到');
        }
        
        // 数据表格
        if (details.dataState) {
            const tableInfo = details.dataState.hasDataTable ? 
                `有数据(${details.dataState.tableRows}行)` : '无数据';
            parts.push(`数据表格: ${tableInfo}`);
        }
        
        const status = readiness.isReady ? '✅ 成功' : '❌ 失败';
        const scoreText = `(评分: ${readiness.score}%)`;
        
        let summary = `[${status}] ${parts.join(', ')} ${scoreText}`;
        
        // 如果有问题，添加问题列表
        if (readiness.issues && readiness.issues.length > 0) {
            summary += ` - 问题: ${readiness.issues.join(', ')}`;
        }
        
        return summary;
    }
    
    // 保留原有方法以便兼容性
    generateRefreshSummary(refreshStatus, isSuccess) {
        if (!refreshStatus) {
            return '无法获取刷新状态';
        }
        
        const parts = [];
        
        // 数据统计
        if (refreshStatus.dataCountElement) {
            parts.push(`数据统计: ${refreshStatus.dataCountElement}`);
        } else {
            parts.push('数据统计: 未找到');
        }
        
        // 高级搜索状态
        parts.push(`高级搜索: ${refreshStatus.advancedSearchExpanded ? '已展开' : '已收起'}`);
        
        // 分页设置
        if (refreshStatus.pageSizeSetting) {
            parts.push(`分页设置: ${refreshStatus.pageSizeSetting}`);
        } else {
            parts.push('分页设置: 未找到');
        }
        
        // 数据表格
        parts.push(`数据表格: ${refreshStatus.hasDataTable ? '有数据' : '无数据'}`);
        
        const status = isSuccess ? '✅ 成功' : '❌ 失败';
        return `[${status}] ${parts.join(', ')}`;
    }
    
    // 检查查询结果是否有效
    async checkQueryResults(page, searchParams = {}) {
        try {
            console.log('开始验证查询结果...');
            
            const queryStatus = await page.evaluate((params) => {
                const result = {
                    timestamp: new Date().toISOString(),
                    searchParams: params,
                    dataCount: 0,
                    dataCountText: null,
                    hasResults: false,
                    isNoDataPage: false,
                    tableRows: 0,
                    hasValidResults: false,
                    errors: []
                };
                
                try {
                    // 1. 检查数据统计
                    const dataCountElements = document.querySelectorAll('*');
                    for (let element of dataCountElements) {
                        const text = element.textContent;
                        if (text && text.includes('共') && text.includes('条数据')) {
                            result.dataCountText = text.trim();
                            const match = text.match(/共(\d+)条数据/);
                            if (match) {
                                result.dataCount = parseInt(match[1]);
                            }
                            break;
                        }
                    }
                    
                    // 2. 检查是否显示"无数据"页面
                    const noDataElements = document.querySelectorAll('*');
                    for (let element of noDataElements) {
                        const text = element.textContent;
                        if (text && (text.includes('无数据') || text.includes('暂无数据'))) {
                            result.isNoDataPage = true;
                            break;
                        }
                    }
                    
                    // 3. 统计表格行数
                    const tableRows = document.querySelectorAll('table tbody tr');
                    result.tableRows = tableRows.length;
                    
                    // 4. 判断是否有有效结果
                    result.hasResults = result.dataCount > 0;
                    result.hasValidResults = result.hasResults && result.tableRows > 0 && !result.isNoDataPage;
                    
                } catch (error) {
                    result.errors.push(error.message);
                }
                
                return result;
            }, searchParams);
            
            console.log('查询结果验证:', queryStatus);
            
            return {
                success: queryStatus.hasValidResults,
                details: queryStatus,
                summary: this.generateQuerySummary(queryStatus)
            };
            
        } catch (error) {
            console.error('验证查询结果时出错:', error);
            return {
                success: false,
                details: null,
                summary: `验证失败: ${error.message}`
            };
        }

    }
    
    // 生成查询状态摘要
    generateQuerySummary(queryStatus) {
        if (!queryStatus) {
            return '无法获取查询状态';
        }
        
        const parts = [];
        
        if (queryStatus.dataCountText) {
            parts.push(queryStatus.dataCountText);
        } else {
            parts.push('数据统计: 未找到');
        }
        
        parts.push(`表格行数: ${queryStatus.tableRows}`);
        
        if (queryStatus.isNoDataPage) {
            parts.push('显示: 无数据页面');
        }
        
        const status = queryStatus.hasValidResults ? '✅ 有结果' : 
                      queryStatus.isNoDataPage ? '⚠️ 无数据' : '❌ 异常';
        return `[${status}] ${parts.join(', ')}`;
    }
    
    // 带重试机制的页面准备方法
    async preparePageWithRetry(page, maxRetries = 3) {
        console.log(`开始页面准备，最大重试次数: ${maxRetries}`);
        
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            console.log(`第 ${attempt} 次尝试准备页面...`);
            
            try {
                // 首先检查登录状态
                const loginStatus = await this.checkLoginStatus(page);
                if (!loginStatus.isLoggedIn) {
                    console.log('检测到未登录，尝试自动登录...');
                    const loginResult = await this.autoLogin(page);
                    if (!loginResult.success) {
                        console.error(`第 ${attempt} 次登录失败:`, loginResult.message);
                        continue;
                    }
                }
                
                // 尝试无刷新准备
                console.log('尝试无刷新页面准备...');
                const prepareResult = await this.prepareAdvancedSearchPage(page);
                
                // 检查准备结果
                const refreshCheck = await this.checkDataRefreshSuccess(page);
                console.log(`第 ${attempt} 次准备结果:`, refreshCheck.summary);
                
                if (refreshCheck.success) {
                    console.log(`✅ 第 ${attempt} 次页面准备成功`);
                    return {
                        success: true,
                        attempt: attempt,
                        method: 'no-refresh',
                        details: refreshCheck.details,
                        summary: refreshCheck.summary
                    };
                }
                
                // 如果无刷新失败，尝试条件刷新
                if (attempt < maxRetries) {
                    console.log('无刷新准备失败，尝试条件刷新...');
                    const refreshResult = await this.refreshAndPrepareAdvancedSearchPage(page, false);
                    
                    const secondCheck = await this.checkDataRefreshSuccess(page);
                    console.log(`第 ${attempt} 次条件刷新结果:`, secondCheck.summary);
                    
                    if (secondCheck.success) {
                        console.log(`✅ 第 ${attempt} 次条件刷新成功`);
                        return {
                            success: true,
                            attempt: attempt,
                            method: 'conditional-refresh',
                            details: secondCheck.details,
                            summary: secondCheck.summary
                        };
                    }
                    
                    // 最后尝试强制刷新
                    if (attempt === maxRetries - 1) {
                        console.log('条件刷新失败，尝试强制刷新...');
                        await this.refreshAndPrepareAdvancedSearchPage(page, true);
                        
                        const finalCheck = await this.checkDataRefreshSuccess(page);
                        console.log(`第 ${attempt} 次强制刷新结果:`, finalCheck.summary);
                        
                        return {
                            success: finalCheck.success,
                            attempt: attempt,
                            method: 'force-refresh',
                            details: finalCheck.details,
                            summary: finalCheck.summary
                        };
                    }
                }
                
            } catch (error) {
                console.error(`第 ${attempt} 次页面准备出错:`, error);
                if (attempt === maxRetries) {
                    return {
                        success: false,
                        attempt: attempt,
                        method: 'failed',
                        error: error.message,
                        summary: `准备失败: ${error.message}`
                    };
                }
                
                // 等待后重试
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }
        
        return {
            success: false,
            attempt: maxRetries,
            method: 'exhausted',
            summary: `所有重试都失败，共尝试 ${maxRetries} 次`
        };
    }
    
    // 优化的内存清理方法
    async cleanupMemoryOptimized() {
        const logger = window.logger;
        
        if (logger) {
            logger.memory('开始优化内存清理...');
        } else {
            console.log('开始优化内存清理...');
        }
        
        try {
            if (!this.browser || !this.mainPage) {
                return false;
            }
            
            // 记录清理前的内存使用
            const beforeMetrics = await this.mainPage.metrics();
            const beforeMB = Math.round(beforeMetrics.JSHeapUsedSize / 1024 / 1024);
            
            // 1. 智能DOM清理
            if (this.mainPage && !this.mainPage.isClosed()) {
                await this.mainPage.evaluate(() => {
                    // 只清理大量的结果项，保留最近的50个
                    const resultItems = document.querySelectorAll('.result-card, .result-item');
                    if (resultItems.length > 50) {
                        const toRemove = Array.from(resultItems).slice(50);
                        toRemove.forEach(item => {
                            if (item.parentNode) {
                                item.parentNode.removeChild(item);
                            }
                        });
                    }
                    
                    // 触发垃圾回收（如果可用）
                    if (window.gc && typeof window.gc === 'function') {
                        window.gc();
                    }
                });
            }
            
            // 2. 清理不活跃的页面
            let closedPages = 0;
            for (const [page, status] of this.pages.entries()) {
                if (page !== this.mainPage && !page.isClosed() && status === 'idle') {
                    try {
                        await page.close();
                        this.pages.delete(page);
                        closedPages++;
                    } catch (closeError) {
                        // 忽略页面关闭错误
                    }
                }
            }
            
            // 3. 选择性的缓存清理（每5分钟一次，避免过于频繁）
            const now = Date.now();
            if (!this.lastCacheCleanTime || (now - this.lastCacheCleanTime) > 300000) {
                try {
                    const client = await this.mainPage.target().createCDPSession();
                    await client.send('Network.clearBrowserCache');
                    await client.detach();
                    this.lastCacheCleanTime = now;
                } catch (cdpError) {
                    // CDP操作失败时使用日志管理器记录
                    if (logger) {
                        logger.warn('清理浏览器缓存失败', cdpError.message);
                    }
                }
            }
            
            // 记录清理后的内存使用
            const afterMetrics = await this.mainPage.metrics();
            const afterMB = Math.round(afterMetrics.JSHeapUsedSize / 1024 / 1024);
            const saved = beforeMB - afterMB;
            
            if (logger) {
                logger.memory(`内存清理完成: ${beforeMB}MB -> ${afterMB}MB (节省 ${saved}MB), 关闭页面: ${closedPages}`);
            } else {
                console.log(`内存清理完成: ${beforeMB}MB -> ${afterMB}MB (节省 ${saved}MB), 关闭页面: ${closedPages}`);
            }
            
            // 更新最后清理时间
            this.lastMemoryCleanTime = Date.now();
            
            return true;
        } catch (error) {
            if (logger) {
                logger.error('优化内存清理失败', 'memory_cleanup', error.message);
            } else {
                console.error('优化内存清理失败:', error.message);
            }
            return false;
        }
    }
}

module.exports = BrowserManager; 