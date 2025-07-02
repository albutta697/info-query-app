// 引入electron模块
const { ipcRenderer } = require('electron');
const PerformanceMonitor = require('./performance-monitor');
const BrowserManager = require('./browser-manager');
const QueryExecutor = require('./query-executor');
const utils = require('./utils');
const logger = require('./logger');
const domManager = require('./dom-manager');
const { asyncManager, eventManager } = require('./async-manager');

// 全局错误处理
window.addEventListener('error', (event) => {
    logger.critical('全局错误:', event.error);
    showTrayNotification(`发生错误: ${event.error.message}`, 'error');
});

window.addEventListener('unhandledrejection', (event) => {
    logger.critical('未处理的Promise错误:', event.reason);
    showTrayNotification(`异步错误: ${event.reason}`, 'error');
});

// 全局变量和配置
const CONFIG = {
    MIN_BROWSERS: 2,  // 最小并行查询数
    BROWSER_TIMEOUT: 30000, // 浏览器超时时间（毫秒）
    BASE_URL: 'http://192.168.100.195:8081/#/user', // 基础URL
    NETWORK_TEST_COUNT: 3, // 网络测试次数
    DEFAULT_MAX_BROWSERS: 100, // 默认最大并行数
    ABSOLUTE_MAX_BROWSERS: 100 // 最大并行数
};

// 添加查询状态标记
let searchCompleted = false;
let isQuerying = false;
let currentQueryController = null; // 用于取消查询

// 【新增】将CONFIG暴露到window对象上，以便其他模块访问
window.CONFIG = CONFIG;

// 实例化管理器
let performanceMonitor = new PerformanceMonitor(CONFIG);
let browserManager = new BrowserManager(CONFIG);
let queryExecutor = new QueryExecutor(CONFIG);

// 【新增】将QueryExecutor类暴露到window对象上，以便全局访问重置方法
window.QueryExecutor = QueryExecutor;

// DOM元素
let pasteArea, quickSearch, progressBar, searchStatus, searchResults, previewArea;
let advancedProgressBar, advancedSearchStatus;

// 存储数据
let addressList = [];
let currentAddressIndex = 0;
let firstName = '';
let lastName = '';
let birthDate = '';
let zipCode = '';
let state = '';
let useStateSearch = false;
let globalShouldStop = false; // 全局取消标志

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', async () => {
    console.log("页面已加载完成，开始初始化...");
    initElements();
    addEventListeners();
    initTabSwitching(); // 初始化标签切换
    updateStatus('界面已就绪，后台正在初始化浏览器引擎...');
    
    // 获取系统信息
    getSystemInfo();
    updateSystemInfo();
    
    // 确保预览区域可见
    const previewArea = document.querySelector('.preview-area');
    if (previewArea) {
        previewArea.style.display = 'block';
        previewArea.style.visibility = 'visible';
        console.log('初始化预览区域为可见状态');
    }

    // 窗口控制按钮
    const minimizeBtn = document.querySelector('.window-control.minimize');
    const maximizeBtn = document.querySelector('.window-control.maximize');
    const closeBtn = document.querySelector('.window-control.close');
    
    if (minimizeBtn) {
        minimizeBtn.addEventListener('click', () => {
            console.log('点击最小化按钮');
            ipcRenderer.send('window-minimize');
        });
    }
    
    if (maximizeBtn) {
        maximizeBtn.addEventListener('click', () => {
            console.log('点击最大化按钮');
            ipcRenderer.send('window-maximize');
        });
    }
    
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            console.log('点击关闭按钮');
            ipcRenderer.send('window-close');
        });
    }
    
    // 清空数据按钮
    const clearDataBtn = document.getElementById('clearDataBtn');
    if (clearDataBtn) {
        clearDataBtn.addEventListener('click', () => {
            console.log('点击清空数据按钮');
            
            // 清空输入区域和结果区域
            if (pasteArea) {
                pasteArea.value = '';
                handlePasteAreaInput(); // 触发输入处理以更新预览
            }
            
            if (searchResults) {
                searchResults.innerHTML = '';
            }
            
            // 重置状态和进度条
            updateProgress(0);
            updateStatus('数据已清空，请粘贴新的查询资料');
            
            // 显示清空成功提示
            showTrayNotification('数据已成功清空');
        });
    }
    
    // 先让界面显示，然后在后台初始化浏览器（非阻塞）
    initBrowserAndLogin().catch(error => {
        console.error('后台初始化浏览器失败:', error);
        updateStatus('浏览器初始化失败，请检查网络连接后重试');
    });
    
    // 设置无头模式切换开关
    setupHeadlessToggle();

    // 设置按钮弹窗逻辑
    const settingsBtn = document.getElementById('settingsBtn');
    const settingsModal = document.getElementById('settingsModal');
    const settingsModalClose = document.getElementById('settingsModalClose');
    const settingsCancelBtn = document.getElementById('settingsCancelBtn');
    const settingsForm = document.getElementById('settingsForm');
    // 自动填充设置表单
    function fillSettingsForm() {
        const saved = JSON.parse(localStorage.getItem('appSettings') || '{}');
        if (saved.url) document.getElementById('setting-url').value = saved.url;
        if (saved.username) document.getElementById('setting-username').value = saved.username;
        if (saved.password) document.getElementById('setting-password').value = saved.password;
        document.getElementById('setting-headless').checked = saved.headless !== false;
        if (saved.refreshInterval) document.getElementById('setting-refresh').value = saved.refreshInterval;
    }
    // 打开弹窗时自动填充
    if (settingsBtn && settingsModal) {
        settingsBtn.addEventListener('click', () => {
            fillSettingsForm();
            settingsModal.style.display = 'flex';
        });
    }
    if (settingsModalClose) {
        settingsModalClose.addEventListener('click', () => {
            settingsModal.style.display = 'none';
        });
    }
    if (settingsCancelBtn) {
        settingsCancelBtn.addEventListener('click', () => {
            settingsModal.style.display = 'none';
        });
    }
    // 设置表单提交事件
    if (settingsForm) {
        settingsForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const url = document.getElementById('setting-url').value.trim();
            const username = document.getElementById('setting-username').value.trim();
            const password = document.getElementById('setting-password').value.trim();
            const headless = document.getElementById('setting-headless').checked;
            const refreshInterval = parseInt(document.getElementById('setting-refresh').value, 10) || 5;
            const settings = { url, username, password, headless, refreshInterval };
            localStorage.setItem('appSettings', JSON.stringify(settings));
            // 同步全局变量和CONFIG
            CONFIG.BASE_URL = url;
            window.CONFIG = CONFIG; // 确保window.CONFIG也被更新
            window.SETTINGS = settings;
            // 关闭弹窗并提示
            settingsModal.style.display = 'none';
            showTrayNotification('设置已保存，将使用新参数登录');
            // 重启浏览器并重新登录
            if (browserManager && browserManager.closeAll) {
                await browserManager.closeAll();
                await initBrowserAndLogin();
            }
        });
    }
    // 应用启动时自动加载设置
    const saved = JSON.parse(localStorage.getItem('appSettings') || '{}');
    if (saved.url) {
        CONFIG.BASE_URL = saved.url;
        window.CONFIG = CONFIG; // 确保window.CONFIG也被更新
    }
    window.SETTINGS = saved;
    
    // 检查并显示启动演示提示
    checkAndShowStartupDemo();
});

// 初始化DOM元素引用
function initElements() {
    console.log("初始化DOM元素...");
    pasteArea = document.getElementById('paste-area');
    console.log("粘贴区域元素:", pasteArea ? "找到" : "未找到");
    quickSearch = document.getElementById('quickSearch');
    console.log("查询按钮元素:", quickSearch ? "找到" : "未找到");
    progressBar = document.getElementById('progressBar');
    searchStatus = document.getElementById('searchStatus');
    searchResults = document.getElementById('searchResults');
    
    // 获取高级查询相关元素
    advancedProgressBar = document.getElementById('advancedProgressBar');
    advancedSearchStatus = document.getElementById('advancedSearchStatus');
    
    // 获取预览区域元素并确保其可见性
    previewArea = document.querySelector('.preview-area');
    console.log("预览区域元素:", previewArea ? "找到" : "未找到");
    
    systemStatus = document.getElementById('systemStatus');
    
    // 查找预览区域中的元素
    const previewNameElement = document.getElementById('preview-name');
    const previewDobElement = document.getElementById('preview-dob');
    console.log("预览姓名元素:", previewNameElement ? "找到" : "未找到");
    console.log("预览生日元素:", previewDobElement ? "找到" : "未找到");
    
    // 确保预览行可见
    const nameRow = document.querySelector('.preview-row-name');
    if (nameRow) {
        nameRow.style.setProperty('display', 'flex', 'important');
        nameRow.style.setProperty('visibility', 'visible', 'important');
    }
    
    const dobRow = document.querySelector('.preview-row-dob');
    if (dobRow) {
        dobRow.style.setProperty('display', 'flex', 'important');
        dobRow.style.setProperty('visibility', 'visible', 'important');
    }
    
    // 确保预览区域初始可见 - 使用setProperty和!important确保覆盖其他样式
    if (previewArea) {
        previewArea.style.setProperty('display', 'block', 'important');
        previewArea.style.setProperty('visibility', 'visible', 'important');
        console.log("预览区域已设置为可见 (在initElements中)");
        
        // 检查样式是否成功应用
        const computedStyle = window.getComputedStyle(previewArea);
        console.log("预览区域计算样式 - display:", computedStyle.display, "visibility:", computedStyle.visibility);
    } else {
        console.error("初始化过程中未找到预览区域元素(.preview-area)，请检查HTML结构");
    }
}

// 添加事件监听器
function addEventListeners() {
    // 添加查询按钮点击事件
    eventManager.addEventListener(quickSearch, 'click', async () => {
        logger.debug('查询按钮被点击，当前 isQuerying 状态:', isQuerying);
        logger.debug('按钮当前文本:', quickSearch.textContent);
        logger.debug('按钮当前类:', quickSearch.className);
        
        if (isQuerying) {
            logger.info('执行取消查询');
            cancelCurrentQuery();
        } else {
            logger.info('执行开始查询');
            await handleSearchWithAsyncManager();
        }
    });
    
    // 添加高级查询按钮点击事件
    const advancedSearchBtn = document.getElementById('advancedSearch');
    if (advancedSearchBtn) {
        eventManager.addEventListener(advancedSearchBtn, 'click', async () => {
            logger.debug('高级查询按钮被点击，当前 isQuerying 状态:', isQuerying);
            logger.debug('按钮当前文本:', advancedSearchBtn.textContent);
            logger.debug('按钮当前类:', advancedSearchBtn.className);
            
            if (isQuerying) {
                logger.info('执行取消高级查询');
                cancelCurrentQuery();
            } else {
                logger.info('执行开始高级查询');
                await handleAdvancedSearchWithAsyncManager();
            }
        });
    }
    
    // 添加清空高级表单按钮点击事件
    const clearAdvancedFormBtn = document.getElementById('clearAdvancedFormBtn');
    if (clearAdvancedFormBtn) {
        eventManager.addEventListener(clearAdvancedFormBtn, 'click', clearAdvancedForm);
    }
    
    // 添加粘贴区域事件
    eventManager.addEventListener(pasteArea, 'input', handlePasteAreaInput);
    
    // 添加键盘快捷键支持
    eventManager.addEventListener(pasteArea, 'keydown', (e) => {
        // Ctrl+Enter 或 Cmd+Enter 开始查询
        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            e.preventDefault();
            handleSearchWithAsyncManager();
        }
    });
    
    // 全局键盘快捷键
    eventManager.addEventListener(document, 'keydown', (e) => {
        // Esc 取消查询
        if (e.key === 'Escape' && isQuerying) {
            e.preventDefault();
            cancelCurrentQuery();
        }
        
        // Ctrl+L 或 Cmd+L 清空数据
        if ((e.ctrlKey || e.metaKey) && e.key === 'l') {
            e.preventDefault();
            const clearBtn = document.getElementById('clearDataBtn');
            if (clearBtn) clearBtn.click();
        }
    });
    
    // 添加点击事件，仅在查询完成后清空内容
    eventManager.addEventListener(pasteArea, 'click', function() {
        if (searchCompleted && this.value.trim()) {
            this.value = '';
            previewArea.style.display = 'none';
            updateStatus('');
            searchCompleted = false;
        }
    });
    
    // 日期格式信息图标点击事件
    const dateFormatInfo = document.getElementById('date-format-info');
    if (dateFormatInfo) {
        eventManager.addEventListener(dateFormatInfo, 'click', showDateFormatHelper);
    }
    
    // 关闭日期格式帮助窗口
    const closeHelper = document.querySelector('.close-helper');
    if (closeHelper) {
        eventManager.addEventListener(closeHelper, 'click', hideDateFormatHelper);
    }
    
    // 点击背景关闭帮助窗口
    eventManager.addEventListener(document, 'click', function(event) {
        const helper = document.getElementById('date-format-helper');
        const infoIcon = document.getElementById('date-format-info');
        
        if (helper && helper.style.display !== 'none' && 
            !helper.contains(event.target) && 
            event.target !== infoIcon) {
            hideDateFormatHelper();
        }
    });
    
    // 获取系统信息
    getSystemInfo();

    // 窗口控制按钮功能已在DOMContentLoaded事件中添加，这里不再重复添加
}

// 获取系统信息
async function getSystemInfo() {
    try {
        const info = await ipcRenderer.invoke('get-system-info');
        
        // 获取网络延迟（使用简单的ping测试）
        let networkLatency = await testNetworkLatency();
        
        // 获取当前并发数（从window全局变量获取，如果存在的话）
        let concurrentCount = window.currentConcurrentCount || 4;
        
        // 更新系统状态显示
        systemStatus.textContent = `📊 系统状态：CPU 核心 ${info.cpuCount} | 网络延迟 ${networkLatency}ms | 并发数 ${concurrentCount}`;
    } catch (error) {
        console.error('获取系统信息失败:', error);
        systemStatus.textContent = `📊 系统状态：获取失败`;
    }
}

// 测试网络延迟
async function testNetworkLatency() {
    try {
        const startTime = Date.now();
        // 使用一个公共API进行简单的网络延迟测试
        const response = await fetch('https://jsonplaceholder.typicode.com/todos/1', { 
            method: 'HEAD',
            cache: 'no-cache'
        });
        const endTime = Date.now();
        const latency = endTime - startTime;
        
        // 返回测得的延迟，如果异常则返回默认值
        return latency > 0 ? latency : 145;
    } catch (error) {
        console.error('测试网络延迟失败:', error);
        return 145; // 失败时返回默认值
    }
}

// 清除预览区域的函数
function clearPreview() {
    console.log("执行clearPreview函数...");
    
    // 清除全局变量
    window.firstName = '';
    window.lastName = '';
    window.birthDate = '';
    
    const previewNameElement = document.getElementById('preview-name');
    const previewDobElement = document.getElementById('preview-dob');
    const previewArea = document.querySelector('.preview-area');
    
    console.log("获取到预览区域元素:", {
        姓名元素: previewNameElement ? "存在" : "不存在",
        生日元素: previewDobElement ? "存在" : "不存在",
        预览区域: previewArea ? "存在" : "不存在"
    });
    
    // 重置预览内容，但保持预览区域可见
    if (previewNameElement) {
        previewNameElement.innerText = '未识别';
    } else {
        console.error("未找到预览姓名元素(#preview-name)");
    }
    
    if (previewDobElement) {
        previewDobElement.innerText = '未识别';
    } else {
        console.error("未找到预览生日元素(#preview-dob)");
    }
    
    // 注意：我们不再隐藏预览区域，而是保持其可见
    if (previewArea) {
        // 确保预览区域可见
        previewArea.style.setProperty('display', 'block', 'important');
        previewArea.style.setProperty('visibility', 'visible', 'important');
        console.log('预览区域内容已重置，但保持可见状态');
    } else {
        console.error("未找到预览区域元素(.preview-area)");
    }
    
    console.log('预览区域内容已清除');
}

// 修复导入资料预览区域
function handlePasteAreaInput() {
    const pasteContent = document.getElementById('paste-area').value.trim();
    if (!pasteContent) {
        clearPreview();
        return;
    }

    // 尝试解析输入内容
    const lines = pasteContent.split('\n').filter(line => line.trim());
    if (lines.length === 0) {
        clearPreview();
        return;
    }

    try {
        console.log("开始解析输入数据，共", lines.length, "行");
        
        // 创建全局变量来存储数据，类似1.js的做法
        window.firstName = '';
        window.lastName = '';
        window.birthDate = '';
        
        // 根据使用说明中指定的顺序来获取数据
        if (lines.length >= 1) {
            window.firstName = lines[0].trim();
            console.log("识别到名:", window.firstName);
        }
        
        if (lines.length >= 2) {
            window.lastName = lines[1].trim();
            console.log("识别到姓:", window.lastName);
        }
        
        // 【智能识别第3行】- 判断是生日还是邮编列表
        if (lines.length >= 3) {
            const thirdLine = lines[2].trim();
            
            // 检查第3行是否像邮编列表（多个5位数字，用空格分隔）
            const zipCodePattern = /^(\d{5}(\s+\d{5})*)\s*$/;
            const isZipCodeList = zipCodePattern.test(thirdLine);
            
            // 检查第3行是否像日期格式
            const datePatterns = [
                /^\d{1,2}\/\d{1,2}\/\d{4}$/,  // MM/DD/YYYY 或 M/D/YYYY
                /^\d{1,2}-\d{1,2}-\d{4}$/,    // MM-DD-YYYY 或 M-D-YYYY
                /^\d{4}-\d{1,2}-\d{1,2}$/,    // YYYY-MM-DD 或 YYYY-M-D
                /^\d{1,2}\/\d{4}$/,           // MM/YYYY 或 M/YYYY
                /^\d{1,2}-\d{4}$/,            // MM-YYYY 或 M-YYYY
                /^\d{6}$/,                    // YYYYMM (如 202401)
                /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},?\s+\d{4}$/i, // Month DD, YYYY
                /^\d{1,2}\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{4}$/i     // DD Month YYYY
            ];
            
            const isDateFormat = datePatterns.some(pattern => pattern.test(thirdLine));
            
            console.log(`第3行内容分析: "${thirdLine}" - 邮编格式:${isZipCodeList}, 日期格式:${isDateFormat}`);
            
            if (isZipCodeList && !isDateFormat) {
                // 第3行是邮编列表，说明没有生日信息
                console.log("识别为邮编列表格式，跳过生日字段");
                window.birthDate = ''; // 没有生日信息
                window.zipCode = thirdLine; // 第3行是邮编
                
                // 第4行应该是州
                if (lines.length >= 4) {
                    window.state = lines[3].trim();
                    console.log("识别到州:", window.state);
                    
                    // 第5行开始是地址
                    window.addressList = [];
                    for (let i = 4; i < lines.length; i++) {
                        const addr = lines[i].trim();
                        if (addr) {
                            window.addressList.push(addr);
                        }
                    }
                } else {
                    window.state = '';
                    window.addressList = [];
                }
            } else {
                // 第3行是生日（或者无法确定，按原来的逻辑处理）
                console.log("识别为生日格式或未知格式，按原逻辑处理");
                window.birthDate = thirdLine;
                
                // 第4行是邮编
                if (lines.length >= 4) {
                    window.zipCode = lines[3].trim();
                    console.log("识别到邮编:", window.zipCode);
                } else {
                    window.zipCode = '';
                }
                
                // 第5行是州
                if (lines.length >= 5) {
                    window.state = lines[4].trim();
                    console.log("识别到州:", window.state);
                } else {
                    window.state = '';
                }
                
                // 第6行开始是地址
                window.addressList = [];
                for (let i = 5; i < lines.length; i++) {
                    const addr = lines[i].trim();
                    if (addr) {
                        window.addressList.push(addr);
                    }
                }
            }
            
            console.log("解析完成:", {
                firstName: window.firstName,
                lastName: window.lastName,
                birthDate: window.birthDate,
                zipCode: window.zipCode,
                state: window.state,
                addressCount: window.addressList?.length || 0
            });
        }
        
        // 更新预览区域 - 使用类似1.js的方式直接设置内容
        const previewNameElement = document.getElementById('preview-name');
        const previewDobElement = document.getElementById('preview-dob');
        const previewArea = document.querySelector('.preview-area');
        
        console.log("获取到预览区域元素:", previewArea ? "成功" : "失败");
        
        // 显示完整的姓名 (名+姓)
        if (previewNameElement) {
            previewNameElement.innerText = `${window.firstName} ${window.lastName}`.trim() || '未识别';
            console.log("设置预览姓名为:", previewNameElement.innerText);
        } else {
            console.error("未找到预览姓名元素(preview-name)");
        }
        
        // 显示出生日期 - 如果没有生日就显示"未提供"
        if (previewDobElement) {
            previewDobElement.innerText = window.birthDate || '未提供';
            console.log("设置预览出生日期为:", previewDobElement.innerText);
            
            // 确保出生日期行可见
            const dobRow = document.querySelector('.preview-row-dob');
            if (dobRow) {
                dobRow.style.setProperty('display', 'flex', 'important');
                dobRow.style.setProperty('visibility', 'visible', 'important');
                dobRow.style.setProperty('height', 'auto', 'important');
                dobRow.style.setProperty('opacity', '1', 'important');
                console.log("强制设置出生日期行可见");
            } else {
                console.error("未找到出生日期行元素(.preview-row-dob)");
            }
        } else {
            console.error("未找到预览生日元素(preview-dob)");
        }
        
        // 强制显示预览区域，设置为block而不是flex等其他值
        if (previewArea) {
            // 强制显示，使用!important确保覆盖可能的其他样式
            previewArea.style.setProperty('display', 'block', 'important');
            previewArea.style.setProperty('visibility', 'visible', 'important');
            console.log("预览区域已设置为可见 (使用setProperty和important)");
        } else {
            console.error("未找到预览区域元素(.preview-area)，请检查HTML结构");
        }
    } catch (error) {
        console.error('解析输入内容时出错:', error);
        clearPreview();
    }
}

// 处理查询按钮点击
async function handleSearch() {
    if (isQuerying) {
        console.log('查询正在进行中，忽略点击');
        return;
    }
    
    // 重置全局取消标志
    globalShouldStop = false;
    
    // 重置页面级取消信号
    await setPageLevelCancelSignal(false);
    
    // 【新增】重置页面状态检查标记，确保新查询会重新检查页面状态
    if (window.QueryExecutor) {
        window.QueryExecutor.resetPageStateCheck();
        console.log('已重置页面状态检查标记');
    }

    try {
        // 【步骤调整1】立即解析输入内容和设置查询状态
        const pasteContent = document.getElementById('paste-area').value.trim();
        if (!pasteContent) {
            updateStatus('请先粘贴查询资料');
            return;
        }
        
        // 解析输入内容
        const lines = pasteContent.split('\n').filter(line => line.trim());
        if (lines.length < 2) {
            updateStatus('输入内容不足，至少需要名字和姓氏');
            return;
        }

        // 立即设置查询状态和UI
        isQuerying = true;
        if (browserManager.setQueryingStatus) {
            browserManager.setQueryingStatus(true);
        }
        quickSearch.textContent = '取消查询';
        quickSearch.classList.add('cancel-mode');
        
        // 清空之前的结果
        searchResults.innerHTML = '';
        
        // 显示查询中的动画
        showSearchingAnimation();
        
        // 显示结果统计区域（包含数据库总数）
        const resultStatsElement = document.getElementById('resultStats');
        if (resultStatsElement) {
            resultStatsElement.style.display = 'flex';
        }

        // 【步骤调整2】立即解析查询参数 - 使用智能识别逻辑
        firstName = lines[0].trim();
        lastName = lines[1].trim();
        
        // 同时设置到window对象上，确保全局可访问
        window.firstName = firstName;
        window.lastName = lastName;
        
        // 【智能识别第3行】- 判断是生日还是邮编列表（与预览逻辑保持一致）
        if (lines.length > 2) {
            const thirdLine = lines[2].trim();
            
            // 检查第3行是否像邮编列表（多个5位数字，用空格分隔）
            const zipCodePattern = /^(\d{5}(\s+\d{5})*)\s*$/;
            const isZipCodeList = zipCodePattern.test(thirdLine);
            
            // 检查第3行是否像日期格式
            const datePatterns = [
                /^\d{1,2}\/\d{1,2}\/\d{4}$/,  // MM/DD/YYYY 或 M/D/YYYY
                /^\d{1,2}-\d{1,2}-\d{4}$/,    // MM-DD-YYYY 或 M-D-YYYY
                /^\d{4}-\d{1,2}-\d{1,2}$/,    // YYYY-MM-DD 或 YYYY-M-D
                /^\d{1,2}\/\d{4}$/,           // MM/YYYY 或 M/YYYY
                /^\d{1,2}-\d{4}$/,            // MM-YYYY 或 M-YYYY
                /^\d{6}$/,                    // YYYYMM (如 202401)
                /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2},?\s+\d{4}$/i, // Month DD, YYYY
                /^\d{1,2}\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{4}$/i     // DD Month YYYY
            ];
            
            const isDateFormat = datePatterns.some(pattern => pattern.test(thirdLine));
            
            console.log(`[查询] 第3行内容分析: "${thirdLine}" - 邮编格式:${isZipCodeList}, 日期格式:${isDateFormat}`);
            
            if (isZipCodeList && !isDateFormat) {
                // 第3行是邮编列表，说明没有生日信息
                console.log("[查询] 识别为邮编列表格式，跳过生日字段");
                birthDate = ''; // 没有生日信息
                window.birthDate = '';
                zipCode = thirdLine; // 第3行是邮编
                window.zipCode = zipCode;
                
                // 第4行应该是州
                if (lines.length > 3) {
                    state = lines[3].trim();
                    window.state = state;
                    console.log("[查询] 识别到州:", state);
                } else {
                    state = '';
                    window.state = '';
                }
                
                // 第5行开始是地址
                addressList = [];
                for (let i = 4; i < lines.length; i++) {
                    const addr = lines[i].trim();
                    if (addr) {
                        addressList.push(addr);
                    }
                }
            } else {
                // 第3行是生日（或者无法确定，按原来的逻辑处理）
                console.log("[查询] 识别为生日格式或未知格式，按原逻辑处理");
                birthDate = thirdLine;
                window.birthDate = birthDate;
                
                // 第4行是邮编
                if (lines.length > 3) {
                    zipCode = lines[3].trim();
                    window.zipCode = zipCode;
                    console.log("[查询] 识别到邮编:", zipCode);
                } else {
                    zipCode = '';
                    window.zipCode = '';
                }
                
                // 第5行是州
                if (lines.length > 4) {
                    state = lines[4].trim();
                    window.state = state;
                    console.log("[查询] 识别到州:", state);
                } else {
                    state = '';
                    window.state = '';
                }
                
                // 第6行开始是地址
                addressList = [];
                for (let i = 5; i < lines.length; i++) {
                    const addr = lines[i].trim();
                    if (addr) {
                        addressList.push(addr);
                    }
                }
            }
        } else {
            // 如果只有2行或更少，清空其他字段
            birthDate = '';
            window.birthDate = '';
            zipCode = '';
            window.zipCode = '';
            state = '';
            window.state = '';
            addressList = [];
        }
        
        // 使用州搜索标志
        useStateSearch = state && state.trim() !== '';
        window.useStateSearch = useStateSearch;
        
        // 确保window.addressList也被设置
        window.addressList = [...addressList];
        
                    console.log('查询参数已解析:', {
                firstName: window.firstName,
                lastName: window.lastName,
                birthDate: window.birthDate,
                zipCode: window.zipCode,
                state: window.state,
                useStateSearch: window.useStateSearch,
                addressCount: window.addressList.length
            });
            
            console.log('🎯 查询策略: 第一次查询使用姓名+州+邮编，如无结果且有生日则自动回退查询使用姓名+生日');
        
        // 如果没有地址，显示提示
        if (addressList.length === 0) {
            updateStatus('警告：未提供地址，查询结果可能不准确');
        }

        // 重置进度条和状态
        updateProgress(0);
        updateStatus('正在准备查询...');
        
        // 清空上次的结果
        searchCompleted = false;
        
        // 重置地址索引
        window.currentAddressIndex = 0;

        // 【步骤调整3】立即执行核心查询，跳过初始化性能监控
        console.log('[进度] 开始核心查询流程，设置进度为10%');
        updateProgress(10);
        
        // 确保浏览器已初始化（这是查询的必要条件）
        if (!browserManager.browser) {
            console.log('浏览器未初始化，正在重新初始化...');
            await browserManager.initBrowser();
        }
        
        // 检查登录状态（这是查询的必要条件）
        if (!browserManager.isLoggedIn) {
            console.log('登录状态已失效，需要重新登录');
            const firstPage = await browserManager.getAvailablePage();
            await browserManager.ensureLoggedIn(firstPage, async (page) => {
                await queryExecutor.performLogin(page);
            });
            browserManager.releasePage(firstPage);
        }
        
        // 【步骤调整4】立即执行查询
        console.log('[进度] 开始执行查询，设置进度为20%');
        updateProgress(20);
        
        const results = await performSearch();
        
        // 检查是否被取消
        if (globalShouldStop) {
            updateStatus('查询已取消');
            updateProgress(0);
            return;
        }
        
        // 更新进度
        console.log('[进度] 查询完成，设置进度为100%');
        updateProgress(100);
        
        // 标记查询完成状态
        searchCompleted = true;
        
        // 【步骤调整5】立即处理和显示结果
        if (!results || !Array.isArray(results)) {
            console.warn('查询返回了无效结果:', results);
            updateStatus('查询未返回有效结果，请重试');
            return;
        }
        
        if (results.length === 0) {
            updateStatus('未找到匹配结果，请尝试其他地址或信息');
            displayResults([]);
        } else {
            updateStatus(`查询成功：找到 ${results.length} 条记录`);
            
            // 处理结果，添加全名和日期匹配标志
            try {
                const processedResults = results
                    .filter(result => result !== null && result !== undefined)
                    .map(result => {
                        try {
                            const firstName = result.firstName || '';
                            const middleName = result.middleName || '';
                            const lastName = result.lastName || '';
                            
                            const middleNamePart = middleName ? ` ${middleName} ` : ' ';
                            const fullName = `${firstName}${middleNamePart}${lastName}`;
                            
                            return {
                                ...result,
                                fullName,
                                isDateMatch: birthDate ? utils.isDateMatch(result.dob, birthDate) : false
                            };
                        } catch (itemError) {
                            console.error('处理结果项时出错:', itemError);
                            return {
                                ...result,
                                fullName: result.firstName ? `${result.firstName} ${result.lastName || ''}` : '数据错误',
                                isDateMatch: false,
                                hasError: true
                            };
                        }
                    });
                
                // 显示结果
                displayResults(processedResults);
            } catch (processError) {
                console.error('处理查询结果时出错:', processError);
                updateStatus('处理查询结果时出错，请重试');
            }
        }

        // 【步骤调整6】将性能监控和网络测试移到后台异步执行
        // 不等待这些操作完成，让它们在后台运行
        backgroundOptimizationTasks().catch(error => {
            console.log('后台优化任务失败，但不影响查询结果:', error.message);
        });
        
    } catch (error) {
        console.error('查询错误:', error);
        updateStatus(`查询出错: ${error.message}`);
        updateProgress(0);
    } finally {
        console.log('🔧 查询完成，开始清理状态和动画...');
        
        clearSearchAnimations();
        
        // 重置查询状态
        console.log('设置 isQuerying 为 false');
        isQuerying = false;
        if (browserManager.setQueryingStatus) {
            browserManager.setQueryingStatus(false);
        }
        
        // 重置按钮状态
        if (quickSearch) {
            quickSearch.textContent = '开始查询';
            quickSearch.classList.remove('cancel-mode');
        }
        
        // 确保在查询结束时重置取消标志
        if (globalShouldStop) {
            globalShouldStop = false;
            console.log('重置全局停止标志');
            try {
                await setPageLevelCancelSignal(false);
            } catch (error) {
                console.error('重置页面级取消信号失败:', error);
            }
        }
        
        console.log('✅ 查询状态和动画清理完成');
    }
}

// 【新增】后台优化任务函数
async function backgroundOptimizationTasks() {
    try {
        console.log('🔄 开始执行后台优化任务...');
        
        // 启动实时数据监控（如果还没启动）
        startRealTimeDataMonitoring();
        
        // 更新数据库总数（如果还没更新）
        try {
            await updateTotalDataCount();
            console.log('后台任务：数据库总数已更新');
        } catch (error) {
            console.error('后台任务：更新数据库总数失败:', error);
        }
        
        // 执行网络测试和性能监控（不阻塞主查询）
        try {
            await performanceMonitor.testNetworkLatency();
            performanceMonitor.calculateRecommendedBrowsers();
            console.log('后台任务：网络测试和性能监控完成');
            console.log('后台任务：', performanceMonitor.getStatusDescription());
        } catch (error) {
            console.error('后台任务：网络测试失败:', error);
        }
        
        // 【用户要求：新增】执行页面优化任务（清空表单、回到第一页等）
        try {
            if (browserManager && browserManager.browser && queryExecutor) {
                console.log('后台任务：开始页面优化...');
                const page = await browserManager.getAvailablePage();
                if (page) {
                    // 调用QueryExecutor的后台页面优化方法
                    await queryExecutor.performBackgroundPageOptimization(page);
                    browserManager.releasePage(page);
                    console.log('后台任务：页面优化完成');
                }
            }
        } catch (error) {
            console.error('后台任务：页面优化失败:', error);
        }
        
        console.log('✅ 后台优化任务完成');
    } catch (error) {
        console.error('后台优化任务执行失败:', error);
    }
}

// 取消当前查询
async function cancelCurrentQuery() {
    console.log('取消查询被触发');
    console.log('当前 currentQueryController 状态:', currentQueryController);
    
    // 设置全局取消标志
    globalShouldStop = true;
    console.log('设置 globalShouldStop = true');
    
    // 停止实时数据监控
    stopRealTimeDataMonitoring();
    
    // 设置页面级取消信号
    await setPageLevelCancelSignal(true);
    
    if (currentQueryController) {
        console.log('调用 currentQueryController.abort()');
        currentQueryController.abort();
        currentQueryController = null;
    }
    
    console.log('设置 isQuerying 为 false');
    isQuerying = false;
    
    if (browserManager && browserManager.setQueryingStatus) {
        console.log('调用 browserManager.setQueryingStatus(false)');
        browserManager.setQueryingStatus(false);
    }
    
    // 清除所有查询动画
    clearSearchAnimations();
    
    // 立即停止所有正在进行的操作
    if (browserManager && browserManager.browser) {
        try {
            console.log('尝试立即停止所有查询操作');
            
            // 获取所有页面
            const pages = await browserManager.browser.pages();
            console.log(`当前打开的页面数: ${pages.length}`);
            
            // 在所有页面上执行停止操作
            for (const page of pages) {
                if (!page.isClosed()) {
                    try {
                        // 停止页面上的所有网络请求和JavaScript执行
                        await page.evaluate(() => {
                            // 停止所有正在进行的请求
                            if (window.stop) {
                                window.stop();
                            }
                            // 清除所有定时器
                            const highestId = setTimeout(() => {}, 0);
                            for (let i = 0; i < highestId; i++) {
                                clearTimeout(i);
                                clearInterval(i);
                            }
                        }).catch(err => console.log('停止页面操作时出错:', err));
                        
                        // 如果不是主页面，立即强制关闭它
                        if (page !== browserManager.mainPage) {
                            try {
                                // 立即关闭页面，不等待任何操作完成
                                await Promise.race([
                                    page.close(),
                                    new Promise((_, reject) => setTimeout(() => reject(new Error('强制关闭超时')), 1000))
                                ]);
                                console.log('快速关闭了一个查询页面');
                            } catch (closeError) {
                                console.error('强制关闭页面失败:', closeError);
                                // 即使关闭失败也继续，不阻塞后续操作
                            }
                        }
                    } catch (err) {
                        console.error('处理页面时出错:', err);
                    }
                }
            }
            
            // 重置主页面状态
            if (browserManager.mainPage && !browserManager.mainPage.isClosed()) {
                try {
                    // 导航回基础URL，使用更短的超时时间
                    await browserManager.mainPage.goto(browserManager.config.BASE_URL, { 
                        waitUntil: 'domcontentloaded', 
                        timeout: 3000 
                    }).catch(err => {
                        console.log('重置页面导航失败，尝试刷新:', err);
                        // 如果导航失败，尝试刷新页面
                        return browserManager.mainPage.reload({ 
                            waitUntil: 'domcontentloaded', 
                            timeout: 3000 
                        }).catch(err2 => console.error('刷新页面也失败:', err2));
                    });
                    console.log('主页面已重置');
                } catch (error) {
                    console.error('重置主页面时出错:', error);
                }
            }
        } catch (error) {
            console.error('停止查询操作时出错:', error);
        }
    }
    
    console.log('更新状态为"查询已取消"');
    updateStatus('查询已取消');
    updateProgress(0);
    
    // 同时更新高级查询的状态
    updateAdvancedStatus('查询已取消');
    updateAdvancedProgress(0);
    
    console.log('恢复按钮文本和样式');
    if (quickSearch) {
        quickSearch.textContent = '开始查询';
        quickSearch.classList.remove('cancel-mode');
        console.log('普通查询按钮当前类:', quickSearch.className);
    } else {
        console.error('quickSearch 按钮不存在');
    }
    
    // 恢复高级查询按钮
    const advancedSearchBtn = document.getElementById('advancedSearch');
    if (advancedSearchBtn) {
        advancedSearchBtn.textContent = '开始查询';
        advancedSearchBtn.classList.remove('cancel-mode');
        console.log('高级查询按钮当前类:', advancedSearchBtn.className);
    }
    
    // 清空当前地址索引，防止下次查询从错误的位置开始
    if (window.currentAddressIndex > 0) {
        console.log(`重置地址索引从 ${window.currentAddressIndex} 到 0`);
        window.currentAddressIndex = 0;
    }
}

// 设置页面级取消信号
async function setPageLevelCancelSignal(shouldCancel) {
    try {
        if (browserManager && browserManager.mainPage && !browserManager.mainPage.isClosed()) {
            await browserManager.mainPage.evaluate((cancel) => {
                try {
                    // 设置localStorage标志
                    localStorage.setItem('globalShouldStop', cancel.toString());
                    
                    // 如果存在页面级取消管理器，直接设置状态
                    if (window.pageLevelCancel) {
                        if (cancel) {
                            window.pageLevelCancel.shouldStop = true;
                            console.log('[页面级] 直接设置取消状态为true');
                        } else {
                            window.pageLevelCancel.reset();
                            console.log('[页面级] 重置取消状态为false');
                        }
                    }
                } catch (error) {
                    console.error('[页面级] 设置取消信号失败:', error);
                }
            }, shouldCancel);
            
            console.log(`页面级取消信号已设置为: ${shouldCancel}`);
        }
    } catch (error) {
        console.error('设置页面级取消信号失败:', error);
    }
}

// 清除所有搜索动画
function clearSearchAnimations() {
    console.log('🧹 开始清除所有搜索动画...');
    
    try {
        // 移除骨架屏
        const skeletonItems = document.querySelectorAll('.skeleton-item');
        console.log(`清除 ${skeletonItems.length} 个骨架屏元素`);
        skeletonItems.forEach(item => item.remove());
        
        // 移除搜索指示器
        const searchingIndicator = document.querySelector('.searching-indicator');
        if (searchingIndicator) {
            console.log('清除搜索指示器');
            searchingIndicator.remove();
        }
        
        // 移除波纹容器
        const rippleContainer = document.querySelector('.ripple-container');
        if (rippleContainer) {
            console.log('清除波纹容器');
            rippleContainer.remove();
        }
        
        // 移除数据处理动画
        const dataProcessing = document.querySelector('.data-processing-container');
        if (dataProcessing) {
            console.log('清除数据处理动画');
            dataProcessing.remove();
        }
        
        // 移除进度图标
        const progressIcons = document.querySelectorAll('.progress-icon');
        console.log(`清除 ${progressIcons.length} 个进度图标`);
        progressIcons.forEach(icon => icon.remove());
        
        // 移除进度条动画类并重置
        if (progressBar) {
            progressBar.classList.remove('animated');
            progressBar.style.width = '0%';
            progressBar.parentElement.style.display = 'none';
            console.log('重置主进度条');
        }
        if (advancedProgressBar) {
            advancedProgressBar.classList.remove('animated');
            advancedProgressBar.style.width = '0%';
            advancedProgressBar.parentElement.style.display = 'none';
            console.log('重置高级进度条');
        }
        
        // 清除可能残留的动画类
        const animatedElements = document.querySelectorAll('.animated-entry');
        animatedElements.forEach(element => {
            element.classList.remove('animated-entry');
        });
        
        console.log('✅ 所有搜索动画已清除完成');
        
    } catch (error) {
        console.error('❌ 清除搜索动画时出错:', error);
    }
}

// 更新进度条 - 同时控制右侧查询动画进度
function updateProgress(percent) {
    // 更新左侧进度条
    if (progressBar) {
        // 添加动画类
        progressBar.classList.add('animated');
        
        // 设置进度
        progressBar.style.width = `${percent}%`;
        
        // 当进度为0时隐藏进度条，否则显示
        progressBar.parentElement.style.display = percent === 0 ? 'none' : 'block';
        
        // 如果有进度图标，更新其位置和动画
        let progressIcon = document.querySelector('.progress-icon');
        if (!progressIcon && percent > 0) {
            progressIcon = document.createElement('div');
            progressIcon.className = 'progress-icon';
            progressBar.parentElement.appendChild(progressIcon);
        }
        
        if (progressIcon) {
            if (percent <= 0 || percent >= 100) {
                progressIcon.style.display = 'none';
            } else {
                progressIcon.style.display = 'block';
                progressIcon.style.animation = `move-with-progress ${(100 - percent) * 0.1}s linear`;
                progressIcon.style.left = `${percent}%`;
            }
        }
        
        // 进度完成时移除动画类
        if (percent >= 100) {
            setTimeout(() => {
                progressBar.classList.remove('animated');
                if (progressIcon) {
                    progressIcon.remove();
                }
            }, 500);
        }
    }
    
    // 更新右侧查询动画的进度圆环
    updateQueryAnimationProgress(percent);
}

// 更新查询动画中的进度状态
function updateQueryAnimationProgress(percent) {
    console.log(`[进度更新] 更新查询动画进度: ${percent}%`);
    
    // 更新进度圆环
    const progressCircle = document.querySelector('.processing-circle');
    if (progressCircle) {
        console.log(`[进度更新] 找到进度圆环，更新为: ${percent}%`);
        
        // 更新进度百分比显示
        const roundedPercent = Math.round(percent);
        progressCircle.setAttribute('data-progress', roundedPercent);
        
        // 更新备用百分比文本元素
        const progressText = progressCircle.querySelector('.progress-text');
        if (progressText) {
            progressText.textContent = `${roundedPercent}%`;
            console.log(`[进度更新] 更新百分比文本: ${roundedPercent}%`);
        }
        
        // 更新进度填充旋转
        const progressFill = progressCircle.querySelector('.progress-fill');
        if (progressFill) {
            const rotationDegree = (percent / 100) * 360;
            progressFill.style.transform = `rotate(${rotationDegree}deg)`;
            console.log(`[进度更新] 进度填充旋转: ${rotationDegree}度`);
            
            // 添加进度完成时的特殊效果
            if (percent >= 100) {
                progressFill.style.background = `conic-gradient(
                    from 270deg,
                    var(--success-500) 0deg,
                    var(--success-600) 180deg,
                    var(--success-500) 270deg,
                    var(--success-500) 360deg
                )`;
                
                // 添加完成动画
                setTimeout(() => {
                    progressCircle.style.animation = 'progress-complete 0.8s ease-out';
                }, 100);
                console.log('[进度更新] 进度完成，应用成功样式');
            }
        } else {
            console.warn('[进度更新] 未找到.progress-fill元素');
        }
    } else {
        console.warn('[进度更新] 未找到.processing-circle元素');
    }
    
    // 更新搜索指示器的进度感
    const searchingIndicator = document.querySelector('.searching-indicator');
    if (searchingIndicator) {
        // 根据进度调整背景色彩强度
        const alpha = 0.08 + (percent / 100) * 0.12; // 从0.08到0.2
        searchingIndicator.style.background = `linear-gradient(135deg, 
            var(--primary-bg) 0%, 
            rgba(63, 140, 255, ${alpha}) 50%, 
            var(--primary-bg) 100%)`;
        
        // 进度完成时的特殊样式
        if (percent >= 100) {
            searchingIndicator.style.background = `linear-gradient(135deg, 
                rgba(34, 197, 94, 0.1) 0%, 
                rgba(34, 197, 94, 0.2) 50%, 
                rgba(34, 197, 94, 0.1) 100%)`;
            searchingIndicator.style.borderColor = 'rgba(34, 197, 94, 0.3)';
        }
    }
}

// 进度完成动画
const progressCompleteStyle = document.createElement('style');
progressCompleteStyle.textContent = `
@keyframes progress-complete {
    0% { transform: scale(1); }
    50% { transform: scale(1.1); filter: brightness(1.2); }
    100% { transform: scale(1); filter: brightness(1); }
}
`;
document.head.appendChild(progressCompleteStyle);

// 测试进度更新功能
function testProgressUpdate() {
    console.log('[测试] 开始测试进度更新功能');
    
    // 模拟查询开始，创建搜索动画
    showSearchingAnimation();
    
    // 模拟进度更新
    let progress = 0;
    const interval = setInterval(() => {
        progress += 10;
        console.log(`[测试] 更新进度到: ${progress}%`);
        updateProgress(progress);
        
        if (progress >= 100) {
            clearInterval(interval);
            console.log('[测试] 进度测试完成');
        }
    }, 500);
}

// 将测试函数暴露到全局作用域
window.testProgressUpdate = testProgressUpdate;

// 更新状态显示
function updateStatus(message) {
    searchStatus.textContent = message;
    searchStatus.style.display = message ? 'block' : 'none';
}

// 【新增】日期格式转换函数：将各种日期格式转换为YYYYMM
function convertDateToYYYYMM(dateStr) {
    if (!dateStr || typeof dateStr !== 'string') {
        return '';
    }
    
    const cleanDate = dateStr.trim();
    if (!cleanDate) {
        return '';
    }
    
    console.log(`[日期转换] 输入: "${cleanDate}"`);
    
    try {
        // 月份映射表
        const monthMap = {
            'jan': '01', 'january': '01', '1月': '01',
            'feb': '02', 'february': '02', '2月': '02',
            'mar': '03', 'march': '03', '3月': '03',
            'apr': '04', 'april': '04', '4月': '04',
            'may': '05', 'may': '05', '5月': '05',
            'jun': '06', 'june': '06', '6月': '06',
            'jul': '07', 'july': '07', '7月': '07',
            'aug': '08', 'august': '08', '8月': '08',
            'sep': '09', 'september': '09', '9月': '09',
            'oct': '10', 'october': '10', '10月': '10',
            'nov': '11', 'november': '11', '11月': '11',
            'dec': '12', 'december': '12', '12月': '12'
        };
        
        // 格式1: YYYY-MM-DD, YYYY/MM/DD
        let match = cleanDate.match(/^(\d{4})[-/](\d{1,2})[-/]\d{1,2}$/);
        if (match) {
            const year = match[1];
            const month = match[2].padStart(2, '0');
            console.log(`[日期转换] 识别为YYYY-MM-DD格式: ${year}${month}`);
            return `${year}${month}`;
        }
        
        // 格式2: MM/DD/YYYY, MM-DD-YYYY
        match = cleanDate.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
        if (match) {
            const month = match[1].padStart(2, '0');
            const year = match[3];
            console.log(`[日期转换] 识别为MM/DD/YYYY格式: ${year}${month}`);
            return `${year}${month}`;
        }
        
        // 格式3: MM/YYYY, MM-YYYY
        match = cleanDate.match(/^(\d{1,2})[-/](\d{4})$/);
        if (match) {
            const month = match[1].padStart(2, '0');
            const year = match[2];
            console.log(`[日期转换] 识别为MM/YYYY格式: ${year}${month}`);
            return `${year}${month}`;
        }
        
        // 格式4: Month DD, YYYY (如 "Jan 15, 2000" 或 "January 15, 2000")
        match = cleanDate.match(/^([A-Za-z]+)\s+\d{1,2},?\s+(\d{4})$/i);
        if (match) {
            const monthName = match[1].toLowerCase();
            const year = match[2];
            const monthNum = monthMap[monthName];
            if (monthNum) {
                console.log(`[日期转换] 识别为Month DD, YYYY格式: ${year}${monthNum}`);
                return `${year}${monthNum}`;
            }
        }
        
        // 格式5: DD Month YYYY (如 "15 Jan 2000" 或 "15 January 2000")
        match = cleanDate.match(/^\d{1,2}\s+([A-Za-z]+)\s+(\d{4})$/i);
        if (match) {
            const monthName = match[1].toLowerCase();
            const year = match[2];
            const monthNum = monthMap[monthName];
            if (monthNum) {
                console.log(`[日期转换] 识别为DD Month YYYY格式: ${year}${monthNum}`);
                return `${year}${monthNum}`;
            }
        }
        
        // 格式6: YYYYMM (已经是目标格式)
        match = cleanDate.match(/^(\d{4})(\d{2})$/);
        if (match) {
            const year = match[1];
            const month = match[2];
            if (parseInt(month) >= 1 && parseInt(month) <= 12) {
                console.log(`[日期转换] 已经是YYYYMM格式: ${year}${month}`);
                return `${year}${month}`;
            }
        }
        
        // 格式7: 中文日期格式 "YYYY年MM月"
        match = cleanDate.match(/^(\d{4})年(\d{1,2})月/);
        if (match) {
            const year = match[1];
            const month = match[2].padStart(2, '0');
            console.log(`[日期转换] 识别为中文年月格式: ${year}${month}`);
            return `${year}${month}`;
        }
        
        // 格式8: 尝试使用JavaScript Date解析（作为最后的备选方案）
        const date = new Date(cleanDate);
        if (!isNaN(date.getTime()) && date.getFullYear() > 1900 && date.getFullYear() < 2030) {
            const year = date.getFullYear();
            const month = (date.getMonth() + 1).toString().padStart(2, '0');
            console.log(`[日期转换] JavaScript Date解析成功: ${year}${month}`);
            return `${year}${month}`;
        }
        
        console.log(`[日期转换] 无法识别日期格式: "${cleanDate}"`);
        return '';
        
    } catch (error) {
        console.error('[日期转换] 转换过程中出错:', error);
        return '';
    }
}

// 执行查询
async function performSearch() {
    let allResults = []; // 确保始终有一个数组可以返回
    
    try {
        // 清空上次的结果
        searchCompleted = false;
        
        // 重置全局取消标志
        globalShouldStop = false;
        console.log('重置 globalShouldStop = false');
        
        // 创建一个标志位用于检查是否应该停止
        let shouldStop = false;
        currentQueryController = {
            abort: () => {
                shouldStop = true;
                globalShouldStop = true;
                console.log('查询已被中断，设置 shouldStop = true, globalShouldStop = true');
            }
        };
        console.log('创建了 currentQueryController');
        
        // 【彻底优化】跳过网络测试和性能监控，直接进入核心查询
        console.log('[进度] 跳过网络测试，直接开始查询，设置进度为30%');
        updateProgress(30);
        
        // 确保 window.addressList 已定义
        if (!window.addressList) {
            console.error('错误: window.addressList 未定义');
            window.addressList = [];
        }
        
        // 获取地址列表用于后续匹配
        const addressList = window.addressList || [];
        console.log(`准备查询，共有 ${addressList.length} 个地址需要匹配`);
        
        // 设置为单页面查询模式
        browserManager.setMaxPages(1);
        window.currentConcurrentCount = 1;
        document.getElementById('parallelCount').textContent = 1;
        
        // 【彻底优化】浏览器和登录状态检查在handleSearch中已完成，这里跳过
        
        // 执行单次查询，不设置地址参数，然后在前端匹配所有地址
        try {
            console.log('[进度] 立即执行查询，设置进度为40%');
            updateProgress(40);
            updateStatus('正在执行单次查询...');
            
            // 准备查询参数（第一次查询：不包含地址和生日，只用姓名+州+邮编）
            const searchParams = {
                firstName: window.firstName || '',
                lastName: window.lastName || '',
                birthDate: '', // 第一次查询不使用生日
                zipCode: window.zipCode || '',
                state: window.state || '',
                address: '', // 不设置地址参数
                useStateSearch: !!window.useStateSearch
            };
            
            console.log('📋 第一次查询参数:', searchParams);
            
            // 【关键优化】立即执行查询，设置更高的起始进度
            console.log('[进度] 瞬时连接服务器，设置进度为50%');
            updateProgress(50);
            
            // 启动模拟进度更新（从50%慢慢增加到85%）
            let currentSimulatedProgress = 50;
            let realProgressReceived = false;
            const progressSimulationInterval = setInterval(() => {
                if (!realProgressReceived && currentSimulatedProgress < 85) {
                    currentSimulatedProgress += 2;
                    console.log(`[模拟进度] 更新进度为${currentSimulatedProgress}%`);
                    updateProgress(currentSimulatedProgress);
                }
            }, 400); // 每400ms增加2%
            
            // 创建进度回调函数
            const progressCallback = (currentPage, totalPages) => {
                if (totalPages > 0) {
                    realProgressReceived = true;
                    clearInterval(progressSimulationInterval);
                    
                    // 50%~95%的进度分配给分页查询
                    const baseProgress = 50;
                    const maxProgress = 95;
                    const pageProgress = ((currentPage / totalPages) * (maxProgress - baseProgress));
                    const finalProgress = Math.min(baseProgress + pageProgress, maxProgress);
                    console.log(`[普通查询进度] 正在处理第${currentPage}/${totalPages}页，设置进度为${Math.round(finalProgress)}%`);
                    updateProgress(Math.round(finalProgress));
                }
            };
            
            const rawResults = await queryExecutor.executeSingleQueryForAllAddresses(browserManager, searchParams, progressCallback);
            
            // 查询完成，清除模拟进度定时器
            clearInterval(progressSimulationInterval);
            
            // 检查是否被取消
            if (shouldStop || globalShouldStop) {
                updateStatus('查询已取消');
                return allResults;
            }
            
            console.log(`单次查询完成，获得 ${rawResults.length} 条原始结果`);
            
            // 【智能回退查询机制】如果第一次查询无结果且原来有邮编/州信息，尝试用生日重新查询
            if (rawResults.length === 0 && (window.zipCode || window.state) && window.birthDate) {
                console.log('🔄 第一次查询无结果，启动智能回退查询（清除邮编州，使用生日）');
                updateStatus('第一次查询无结果，正在尝试使用生日重新查询...');
                updateProgress(60); // 设置回退查询进度
                
                try {
                    // 转换生日格式为YYYYMM（用于回退查询）
                    const formattedBirthDate = convertDateToYYYYMM(window.birthDate);
                    console.log(`生日格式转换: "${window.birthDate}" -> "${formattedBirthDate}"`);
                    
                    if (formattedBirthDate) {
                        // 创建回退查询参数（清除邮编和州，使用生日）
                        const fallbackSearchParams = {
                            firstName: window.firstName || '',
                            lastName: window.lastName || '',
                            birthDate: formattedBirthDate, // YYYYMM格式
                            zipCode: '', // 清除邮编
                            state: '', // 清除州
                            address: '', // 不设置地址参数
                            useStateSearch: false // 不使用州搜索
                        };
                        
                        console.log('🔄 执行回退查询，参数:', fallbackSearchParams);
                        
                        // 创建回退查询进度回调
                        const fallbackProgressCallback = (currentPage, totalPages) => {
                            if (totalPages > 0) {
                                const baseProgress = 60;
                                const maxProgress = 90;
                                const pageProgress = ((currentPage / totalPages) * (maxProgress - baseProgress));
                                const finalProgress = Math.min(baseProgress + pageProgress, maxProgress);
                                console.log(`[回退查询进度] 正在处理第${currentPage}/${totalPages}页，设置进度为${Math.round(finalProgress)}%`);
                                updateProgress(Math.round(finalProgress));
                            }
                        };
                        
                        // 执行回退查询
                        const fallbackResults = await queryExecutor.executeSingleQueryForAllAddresses(browserManager, fallbackSearchParams, fallbackProgressCallback);
                        
                        if (fallbackResults && fallbackResults.length > 0) {
                            console.log(`🎯 回退查询成功！找到 ${fallbackResults.length} 条结果`);
                            rawResults.splice(0, 0, ...fallbackResults); // 将回退结果合并到主结果
                            updateStatus(`智能回退查询成功：通过生日找到 ${fallbackResults.length} 条记录`);
                        } else {
                            console.log('🔍 回退查询也无结果');
                            updateStatus('使用生日的回退查询也未找到结果');
                        }
                    } else {
                        console.log('⚠️ 生日格式转换失败，跳过回退查询');
                    }
                } catch (fallbackError) {
                    console.error('回退查询执行失败:', fallbackError);
                    updateStatus('回退查询执行失败，显示原始查询结果');
                }
            }
            
            console.log('[进度] 查询完成，设置进度为95%');
            updateProgress(95); // 查询完成就直接95%，因为这是最耗时的步骤
            
            // 在前端对结果进行地址匹配
            updateStatus('正在匹配地址...');
            
            for (const result of rawResults) {
                // 检查是否被取消
                if (shouldStop || globalShouldStop) {
                    console.log('地址匹配过程中检测到取消标志');
                    break;
                }
                
                // 格式化日期
                result.dob = utils.formatDate(result.dob);
                
                // 检查结果是否与任何输入的地址匹配
                let matchedAddress = null;
                for (const address of addressList) {
                    if (utils.addressMatches(address, result.address)) {
                        matchedAddress = address;
                        console.log(`找到匹配地址: ${result.address} 匹配 ${address}`);
                        break;
                    }
                }
                
                // 如果匹配到地址，或者没有提供地址列表，则添加到结果中
                if (matchedAddress || addressList.length === 0) {
                    result.matchedInputAddress = matchedAddress; // 记录匹配的输入地址
                    allResults.push(result);
                }
            }
            
            console.log(`地址匹配完成，找到 ${allResults.length} 条匹配结果`);
            
        } catch (error) {
            console.error('执行查询时出错:', error);
            updateStatus(`查询出错: ${error.message}`);
            // 确保清除模拟进度定时器
            if (typeof progressSimulationInterval !== 'undefined') {
                clearInterval(progressSimulationInterval);
            }
            return allResults;
        }
        
        // 如果被取消，不显示结果
        if (shouldStop || globalShouldStop) {
            updateStatus('查询已取消');
            currentQueryController = null;
            return allResults; // 返回当前收集的结果
        }
        
        // 去重并处理结果
        try {
            const uniqueResults = utils.removeDuplicateResults(allResults);
            console.log(`查询完成，总共找到 ${allResults.length} 条记录，去重后 ${uniqueResults.length} 条`);
            
            // 标记查询完成状态
            searchCompleted = true;
            console.log('[进度] 数据处理完成，设置进度为100%');
            updateProgress(100);
            updateStatus(`查询成功：找到 ${uniqueResults.length} 条不重复记录`);
            
            // 【移到后台】查询完成后更新数据库统计移到后台执行
            updateTotalDataCount().catch(error => {
                console.error('查询完成后更新数据库统计失败:', error);
            });
            
            // 处理结果，添加全名和日期匹配标志
            const processedResults = uniqueResults.map(result => {
                if (!result) return null; // 跳过无效结果
                
                const middleNamePart = result.middleName ? ` ${result.middleName} ` : ' ';
                return {
                    ...result,
                    fullName: `${result.firstName || ''}${middleNamePart}${result.lastName || ''}`,
                    isDateMatch: window.birthDate ? utils.isDateMatch(result.dob, window.birthDate) : false
                };
            }).filter(Boolean); // 过滤掉null结果
            
            // 按日期匹配和姓名排序
            processedResults.sort((a, b) => {
                // 首先按日期匹配排序
                if (a.isDateMatch !== b.isDateMatch) {
                    return a.isDateMatch ? -1 : 1;
                }
                
                // 然后按姓名排序
                return a.fullName.localeCompare(b.fullName);
            });
            
            allResults = processedResults; // 更新返回结果为处理后的结果
        } catch (processError) {
            console.error('处理最终结果时出错:', processError);
        }
        
        // 【移到后台】页面刷新操作移到后台执行
        if (!globalShouldStop && browserManager.autoRefreshPage) {
            setTimeout(async () => {
                try {
                    if (typeof browserManager.refreshAndPrepareAdvancedSearchPage === 'function') {
                        await browserManager.refreshAndPrepareAdvancedSearchPage(browserManager.autoRefreshPage);
                        console.log('[后台任务] 页面刷新与准备完成');
                    }
                } catch (error) {
                    console.error('[后台任务] 页面刷新失败:', error.message);
                }
            }, 0);
        }
        
    } catch (error) {
        console.error('查询错误:', error);
        updateStatus(`查询出错: ${error.message}`);
    } finally {
        currentQueryController = null;
        
        // 停止实时数据监控
        stopRealTimeDataMonitoring();
        
        // 确保在查询结束时重置取消标志
        if (globalShouldStop) {
            globalShouldStop = false;
            console.log('查询结束，重置 globalShouldStop = false');
        }
    }
    
    // 始终返回一个数组，即使是空数组
    return Array.isArray(allResults) ? allResults : [];
}

// 显示搜索结果 - 已被新的displayResults函数替代
// 保留此函数以兼容可能的其他调用
function _displayResultsLegacy(results) {
    displayResults(results, false);
}

// 创建结果卡片
function createResultCard(result, isDateMatch) {
    // 检查 result 是否有效
    if (!result) {
        console.error('创建结果卡片时收到无效的结果对象');
        return document.createElement('div'); // 返回空的div避免错误
    }
    
    const card = document.createElement('div');
    card.className = `result-item ${isDateMatch ? 'date-match' : ''}`;
    
    try {
        // 安全获取属性值，确保即使属性不存在也返回空字符串
        const safeGet = (obj, prop) => {
            if (!obj || obj[prop] === undefined || obj[prop] === null) {
                return '';
            }
            return obj[prop];
        };
        
        // 构建全名，包含中间名（如果有）
        let fullName = '';
        const firstName = safeGet(result, 'firstName');
        const middleName = safeGet(result, 'middleName');
        const lastName = safeGet(result, 'lastName');
        
        if (safeGet(result, 'fullName')) {
            // 如果已经有预处理的全名，直接使用
            fullName = result.fullName;
        } else {
            // 否则构建全名
            const middleNamePart = middleName ? ` ${middleName} ` : ' ';
            fullName = `${firstName}${middleNamePart}${lastName}`;
        }
        
        // 构建结果卡片内容
        const fields = [
            { key: 'name', label: '姓名', value: fullName },
            { key: 'dob', label: '出生日期', value: safeGet(result, 'dob') },
            { key: 'ssn', label: 'SSN', value: safeGet(result, 'ssn') },
            { key: 'address', label: '地址', value: safeGet(result, 'address') },
            { key: 'city', label: '城市', value: safeGet(result, 'city') },
            { key: 'state', label: '州', value: safeGet(result, 'state') },
            { key: 'phone', label: '电话', value: safeGet(result, 'phone') },
            { key: 'email', label: '邮箱', value: safeGet(result, 'email') },
            { key: 'zip', label: '邮编', value: safeGet(result, 'zip') }
        ];
        
        fields.forEach(field => {
            // 只显示有值的字段
            if (field.value) {
                try {
                    const fieldRow = document.createElement('div');
                    
                    const label = document.createElement('strong');
                    label.setAttribute('data-field', field.key);
                    label.textContent = field.label;
                    
                    const value = document.createElement('span');
                    value.textContent = field.value;
                    value.title = field.value; // 添加tooltip显示完整值
                    
                    const copyButton = document.createElement('button');
                    copyButton.className = 'copy-button';
                    copyButton.textContent = '复制';
                    copyButton.addEventListener('click', () => {
                        navigator.clipboard.writeText(field.value)
                            .then(() => {
                                copyButton.textContent = '已复制';
                                copyButton.classList.add('copied');
                                setTimeout(() => {
                                    copyButton.textContent = '复制';
                                    copyButton.classList.remove('copied');
                                }, 1500);
                            })
                            .catch(err => {
                                console.error('复制失败:', err);
                            });
                    });
                    
                    fieldRow.appendChild(label);
                    fieldRow.appendChild(value);
                    fieldRow.appendChild(copyButton);
                    card.appendChild(fieldRow);
                } catch (fieldError) {
                    console.error(`创建字段 ${field.key} 时出错:`, fieldError);
                }
            }
        });
    } catch (error) {
        console.error('创建结果卡片时出错:', error);
        // 添加错误提示到卡片
        const errorMsg = document.createElement('div');
        errorMsg.className = 'error-message';
        errorMsg.textContent = '结果数据处理错误';
        card.appendChild(errorMsg);
    }
    
    return card;
}

// 显示日期格式帮助信息
function showDateFormatHelper() {
    const dobElement = document.getElementById('preview-dob');
    const helper = document.getElementById('date-format-helper');
    const analysisDiv = document.getElementById('current-date-analysis');
    
    // 获取当前日期格式分析
    const dateStr = dobElement.innerText;
    if (dateStr && dateStr !== '未识别') {
        const analysis = utils.testDateFormat(dateStr);
        
        // 清空并重新填充分析区域
        analysisDiv.innerHTML = '<h4>当前日期分析:</h4>';
        
        if (typeof analysis === 'object') {
            Object.entries(analysis).forEach(([key, value]) => {
                const item = document.createElement('div');
                item.className = 'analysis-item';
                
                const label = document.createElement('div');
                label.className = 'analysis-label';
                label.textContent = key + ':';
                
                const valueElem = document.createElement('div');
                valueElem.className = 'analysis-value';
                valueElem.textContent = value;
                
                item.appendChild(label);
                item.appendChild(valueElem);
                analysisDiv.appendChild(item);
            });
        } else {
            analysisDiv.innerHTML += `<p>${analysis}</p>`;
        }
    } else {
        analysisDiv.innerHTML = '<p>暂无日期信息可分析</p>';
    }
    
    // 显示帮助窗口
    helper.style.display = 'block';
}

// 隐藏日期格式帮助信息
function hideDateFormatHelper() {
    const helper = document.getElementById('date-format-helper');
    helper.style.display = 'none';
}

// 更新底部系统信息
function updateSystemInfo() {
    // 初始调用getSystemInfo以立即显示系统信息
    getSystemInfo();
    
    // 设置定时器每30秒更新一次系统信息
    setInterval(() => {
        getSystemInfo();
    }, 30000);
}

// 显示托盘提示
function showTrayNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `tray-notification tray-notification-${type}`;
    notification.textContent = message;
    document.body.appendChild(notification);
    
    // 3秒后自动移除提示
    setTimeout(() => {
        notification.classList.add('hide');
        setTimeout(() => {
            if (notification.parentNode) {
                document.body.removeChild(notification);
            }
        }, 500);
    }, 3000);
}

// 初始化浏览器并执行登录
async function initBrowserAndLogin() {
    try {
        console.log('开始后台初始化浏览器...');
        updateStatus('正在后台初始化浏览器...');
        
        // 给界面一些时间渲染
        await new Promise(resolve => setTimeout(resolve, 100));
        
        // 初始化浏览器
        await browserManager.initBrowser();
        console.log('浏览器初始化完成');
        
        // 获取一个页面并执行登录
        const page = await browserManager.getAvailablePage();
        console.log('获取页面成功，准备登录');
        
        await browserManager.ensureLoggedIn(page, async (p) => {
            await queryExecutor.performLogin(p);
        });
        
        // 释放页面
        browserManager.releasePage(page);
        
        console.log('自动登录完成');
        updateStatus('🎉 系统完全就绪！浏览器已登录，请粘贴查询资料开始使用');
        
        // 启动会话保活机制
        await browserManager.startSessionKeepAlive();
        console.log('会话保活机制已启动，将定期刷新登录状态');
        
        // 首次获取数据库总数据量
        try {
            await updateTotalDataCount();
            console.log('已获取数据库总数据量');
        } catch (error) {
            console.error('首次获取数据库总数失败:', error);
        }
        
        // 启动定期更新数据库总数（每30分钟更新一次）
        setInterval(async () => {
            try {
                await updateTotalDataCount();
                console.log('⏰ 定期更新数据库总数完成');
            } catch (error) {
                console.error('⏰ 定期更新数据库总数失败:', error);
            }
        }, 30 * 60 * 1000); // 30分钟
        
        // 显示登录成功提示
        showTrayNotification('已成功登录到查询系统');
    } catch (error) {
        console.error('自动初始化浏览器并登录失败:', error);
        updateStatus('⚠️ 浏览器初始化失败，界面功能正常，请检查网络后可手动重试');
        showTrayNotification('浏览器初始化失败，请检查网络连接', 'warning');
    }
}

// 初始化标签切换功能
function initTabSwitching() {
    const tabs = document.querySelectorAll('.tab-item');
    const panels = document.querySelectorAll('.query-panel');
    
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const targetTab = tab.getAttribute('data-tab');
            
            // 移除所有活动状态
            tabs.forEach(t => t.classList.remove('active'));
            panels.forEach(p => p.classList.remove('active'));
            
            // 添加活动状态
            tab.classList.add('active');
            const targetPanel = document.getElementById(targetTab + '-panel');
            if (targetPanel) {
                targetPanel.classList.add('active');
            }
            
            // 如果切换到工具箱标签，初始化工具箱功能
            if (targetTab === 'toolkit-query') {
                initToolkitTab();
            }
        });
    });
}

// 初始化工具箱标签页功能
function initToolkitTab() {
    console.log('初始化工具箱标签页功能');
    
    // 生成书签链接和JavaScript代码
    generateBookmarkTools();
    
    // 添加复制代码按钮事件
    const copyCodeBtn = document.getElementById('copyCodeBtn');
    if (copyCodeBtn && !copyCodeBtn.dataset.initialized) {
        copyCodeBtn.dataset.initialized = 'true';
        copyCodeBtn.addEventListener('click', copyBookmarkCode);
    }
    
    // 初始化智能安装助手
    initSmartInstaller();
}

// 初始化演示系统
function initSmartInstaller() {
    console.log('初始化视频演示系统');
    
    // 检测浏览器（用于演示中的快捷键显示）
    detectBrowser();
    
    // 初始化演示按钮事件
    const demoBtn = document.getElementById('showDragDemo');
    
    if (demoBtn && !demoBtn.dataset.initialized) {
        demoBtn.dataset.initialized = 'true';
        demoBtn.addEventListener('click', showDragDemo);
    }
    
    // 初始化拖拽监听（保留给书签按钮）
    initDragFeedback();
}

// 检测浏览器类型
function detectBrowser() {
    const userAgent = navigator.userAgent;
    let browserName = '未知浏览器';
    let shortcutKey = 'Ctrl+Shift+B';
    let dragTip = '拖拽时会自动显示书签栏';
    
    if (userAgent.includes('Chrome') && !userAgent.includes('Edg')) {
        browserName = 'Chrome 浏览器';
        dragTip = 'Chrome会在拖拽时自动显示书签栏';
    } else if (userAgent.includes('Edg')) {
        browserName = 'Microsoft Edge 浏览器';
        dragTip = 'Edge会在拖拽时自动显示书签栏';
    } else if (userAgent.includes('Firefox')) {
        browserName = 'Firefox 浏览器';
        dragTip = 'Firefox拖拽时会显示书签添加提示';
    } else if (userAgent.includes('Safari') && !userAgent.includes('Chrome')) {
        browserName = 'Safari 浏览器';
        shortcutKey = 'Cmd+Shift+B';
        dragTip = 'Safari会自动处理书签添加';
    }
    
    // 更新界面显示
    const browserDetection = document.getElementById('browserDetection');
    const browserSpecificTip = document.getElementById('browserSpecificTip');
    const shortcutKeyDisplay = document.getElementById('shortcutKeyDisplay');
    
    if (browserDetection) {
        browserDetection.textContent = `检测到：${browserName}`;
    }
    
    if (browserSpecificTip) {
        browserSpecificTip.textContent = dragTip;
    }
    
    if (shortcutKeyDisplay) {
        shortcutKeyDisplay.textContent = `按 ${shortcutKey}`;
    }
    
    // 存储快捷键信息供其他函数使用
    window.bookmarkShortcut = shortcutKey;
    
    // 返回快捷键供直接调用使用
    return shortcutKey;
}

// 一键准备书签栏
function prepareBookmarkBar() {
    const prepareBtn = document.getElementById('prepareBookmarkBar');
    const dragStatus = document.getElementById('dragStatus');
    const shortcutKey = window.bookmarkShortcut || 'Ctrl+Shift+B';
    
    // 复制快捷键到剪贴板
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(shortcutKey).then(() => {
            // 更新按钮状态
            const originalText = prepareBtn.innerHTML;
            prepareBtn.innerHTML = '<span class="action-icon">✅</span>已复制快捷键';
            prepareBtn.style.background = 'linear-gradient(to right, var(--success-500), #059669)';
            
            // 更新状态提示
            updateDragStatus('success', `${shortcutKey} 已复制！现在去目标浏览器按下这个快捷键显示书签栏`);
            
            // 显示详细指导
            showDetailedInstructions(shortcutKey);
            
            setTimeout(() => {
                prepareBtn.innerHTML = originalText;
                prepareBtn.style.background = '';
                updateDragStatus('ready', '书签栏准备完成，可以开始拖拽了！');
            }, 3000);
            
            showTrayNotification(`书签栏快捷键 ${shortcutKey} 已复制到剪贴板`, 'success');
        }).catch(err => {
            console.error('复制失败:', err);
            fallbackPrepareBookmarkBar(shortcutKey);
        });
    } else {
        fallbackPrepareBookmarkBar(shortcutKey);
    }
}

// 降级准备方案
function fallbackPrepareBookmarkBar(shortcutKey) {
    updateDragStatus('info', `请手动按 ${shortcutKey} 显示书签栏，然后拖拽绿色按钮`);
    showTrayNotification(`请按 ${shortcutKey} 显示书签栏`, 'info');
    showDetailedInstructions(shortcutKey);
}

// 显示详细指导
function showDetailedInstructions(shortcutKey) {
    const instructionModal = document.createElement('div');
    instructionModal.className = 'instruction-modal';
    instructionModal.innerHTML = `
        <div class="modal-content">
            <div class="modal-header">
                <h4>📖 详细安装指导</h4>
                <button class="close-modal">×</button>
            </div>
            <div class="modal-body">
                <div class="step-list">
                    <div class="step-item">
                        <div class="step-number">1</div>
                        <div class="step-content">
                            <strong>切换到目标浏览器</strong>
                            <p>打开您想要安装书签的浏览器窗口</p>
                        </div>
                    </div>
                    <div class="step-item">
                        <div class="step-number">2</div>
                        <div class="step-content">
                            <strong>按下快捷键：${shortcutKey}</strong>
                            <p>这会显示或隐藏书签栏</p>
                        </div>
                    </div>
                    <div class="step-item">
                        <div class="step-number">3</div>
                        <div class="step-content">
                            <strong>拖拽绿色按钮</strong>
                            <p>将下方的绿色按钮拖拽到书签栏任意位置</p>
                        </div>
                    </div>
                    <div class="step-item">
                        <div class="step-number">4</div>
                        <div class="step-content">
                            <strong>完成安装</strong>
                            <p>看到书签出现在书签栏中即表示安装成功</p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    document.body.appendChild(instructionModal);
    
    // 关闭模态框
    const closeBtn = instructionModal.querySelector('.close-modal');
    closeBtn.addEventListener('click', () => {
        instructionModal.remove();
    });
    
    // 点击背景关闭
    instructionModal.addEventListener('click', (e) => {
        if (e.target === instructionModal) {
            instructionModal.remove();
        }
    });
    
    // 3秒后自动关闭
    setTimeout(() => {
        if (document.body.contains(instructionModal)) {
            instructionModal.remove();
        }
    }, 8000);
}

// 更新拖拽状态
function updateDragStatus(type, message) {
    const dragStatus = document.getElementById('dragStatus');
    if (!dragStatus) return;
    
    const statusIcon = dragStatus.querySelector('.status-icon');
    const statusText = dragStatus.querySelector('.status-text');
    
    // 更新图标和样式
    const icons = {
        info: '💡',
        success: '✅',
        ready: '🎯',
        dragging: '🚀'
    };
    
    const colors = {
        info: '#3b82f6',
        success: '#10b981',
        ready: '#059669',
        dragging: '#f59e0b'
    };
    
    if (statusIcon) {
        statusIcon.textContent = icons[type] || '💡';
    }
    
    if (statusText) {
        statusText.textContent = message;
        statusText.style.color = colors[type] || '#6b7280';
    }
    
    // 添加动画效果
    dragStatus.style.transform = 'scale(1.05)';
    setTimeout(() => {
        dragStatus.style.transform = 'scale(1)';
    }, 200);
}

// 演示拖拽过程（真实视频版）
function showDragDemo() {
    const demoBtn = document.getElementById('showDragDemo');
    const shortcutKey = window.bookmarkShortcut || 'Ctrl+Shift+B';
    
    // 更新按钮状态
    const originalText = demoBtn.innerHTML;
    demoBtn.innerHTML = '<span class="demo-icon">🎬</span>演示中...';
    demoBtn.disabled = true;
    
    // 开始逐步演示系统
    startStepByStepDemo(shortcutKey);
    
    // 恢复按钮（总演示时间约40秒）
    setTimeout(() => {
        demoBtn.innerHTML = originalText;
        demoBtn.disabled = false;
    }, 40000);
    
    // 显示演示状态
    console.log('🎬 正在播放11步详细演示教程...');
}

// 紧凑演示系统 - 8步单容器模式
function startStepByStepDemo(shortcutKey, hideProgressElements = false) {
    // 创建紧凑演示容器
    const demoContainer = createCompactDemoContainer(hideProgressElements);
    
    // 演示步骤配置（更详细的11步真实流程）
    const demoSteps = [
        { id: 1, title: '欢迎使用', duration: 3000, handler: () => showWelcomeStepCompact(demoContainer) },
        { id: 2, title: '显示书签栏', duration: 4000, handler: () => showKeyboardStepCompact(demoContainer, shortcutKey) },
        { id: 3, title: '浏览器界面', duration: 3000, handler: () => showBrowserInterfaceCompact(demoContainer) },
        { id: 4, title: '拖拽安装', duration: 4000, handler: () => showDragStepCompact(demoContainer) },
        { id: 5, title: '安装完成', duration: 3000, handler: () => showInstallationCompleteCompact(demoContainer) },
        { id: 6, title: '打开目标网站', duration: 3000, handler: () => showWebsiteOpenCompact(demoContainer) },
        { id: 7, title: '点击工具', duration: 3000, handler: () => showToolClickCompact(demoContainer) },
        { id: 8, title: '信息提取', duration: 4000, handler: () => showExtractionCompact(demoContainer) },
        { id: 9, title: '复制信息', duration: 3000, handler: () => showCopyInfoCompact(demoContainer) },
        { id: 10, title: '粘贴到查询助手', duration: 4000, handler: () => showPasteToQueryCompact(demoContainer) },
        { id: 11, title: '开始查询', duration: 4000, handler: () => showQueryResultCompact(demoContainer) }
    ];
    
    // 初始化步骤指示器
    updateStepIndicator(demoContainer, 1, demoSteps.length, hideProgressElements);
    
    // 执行演示序列
    let currentStep = 0;
    
    function executeNextStep() {
        if (currentStep < demoSteps.length) {
            const step = demoSteps[currentStep];
            
            // 更新步骤指示器
            updateStepIndicator(demoContainer, step.id, demoSteps.length, hideProgressElements);
            
            // 执行步骤
            step.handler();
            
            currentStep++;
            
            // 安排下一步
            if (currentStep < demoSteps.length) {
                setTimeout(executeNextStep, step.duration);
            } else {
                // 演示完成，3秒后关闭
                setTimeout(() => {
                    demoContainer.remove();
                }, step.duration);
            }
        }
    }
    
    // 开始演示
    executeNextStep();
    
    console.log('🎬 正在播放11步详细真实演示教程...');
}

// 第一步：欢迎演示
function showWelcomeStep() {
    const welcomeModal = createStepModal('welcome-step', {
        title: '🎬 完整安装演示',
        subtitle: '步骤 1/5：演示准备',
        content: `
            <div class="step-welcome">
                <div class="welcome-icon">📚</div>
                <div class="welcome-text">
                    <h3>欢迎观看书签工具安装演示</h3>
                    <p>这个演示将模拟真实的浏览器操作过程</p>
                    <div class="demo-features">
                        <div class="feature-item">✨ 真实浏览器界面</div>
                        <div class="feature-item">🎯 逐步操作指导</div>
                        <div class="feature-item">🚀 流畅拖拽动画</div>
                    </div>
                </div>
            </div>
        `,
        showNext: false
    });
    
    console.log('📖 第1步：演示准备中...');
    
    // 3秒后自动进入下一步
    setTimeout(() => {
        welcomeModal.remove();
    }, 2800);
}

// 第二步：快捷键演示
function showKeyboardStepDemo(shortcutKey) {
    const keyboardModal = createStepModal('keyboard-step', {
        title: '⌨️ 显示书签栏',
        subtitle: '步骤 2/5：按下快捷键',
        content: `
            <div class="step-keyboard">
                <div class="keyboard-instruction">
                    <p>在目标浏览器中按下快捷键组合：</p>
                    <div class="key-combination-large">
                        ${shortcutKey.split('+').map(key => 
                            `<div class="demo-key-large" data-key="${key}">${key}</div>`
                        ).join('<span class="key-plus-large">+</span>')}
                    </div>
                    <p class="key-effect">这会显示或隐藏浏览器的书签栏</p>
                </div>
            </div>
        `,
        showNext: false
    });
    
    console.log('⌨️ 第2步：演示快捷键操作...');
    
    // 模拟按键
    setTimeout(() => {
        simulateKeyboardDemo(shortcutKey);
    }, 500);
    
    // 5秒后进入下一步
    setTimeout(() => {
        keyboardModal.remove();
    }, 4800);
}

// 第三步：浏览器界面演示
function showBrowserInterfaceDemo() {
    const browserModal = createStepModal('browser-step', {
        title: '🌐 浏览器界面',
        subtitle: '步骤 3/5：识别浏览器元素',
        content: `
            <div class="step-browser">
                <div class="browser-mockup">
                    <div class="browser-header">
                        <div class="browser-controls">
                            <div class="control-btn close"></div>
                            <div class="control-btn minimize"></div>
                            <div class="control-btn maximize"></div>
                        </div>
                        <div class="browser-tabs">
                            <div class="browser-tab active">
                                <span class="tab-icon">🏠</span>
                                <span class="tab-title">新标签页</span>
                            </div>
                            <div class="new-tab-btn">+</div>
                        </div>
                    </div>
                    <div class="browser-navigation">
                        <div class="nav-buttons">
                            <button class="nav-btn">←</button>
                            <button class="nav-btn">→</button>
                            <button class="nav-btn">↻</button>
                        </div>
                        <div class="address-bar">
                            <span class="address-text">https://example.com</span>
                        </div>
                        <div class="browser-menu">⋮</div>
                    </div>
                    <div class="bookmark-bar" id="demo-bookmark-bar">
                        <div class="bookmark-item">📁 收藏夹</div>
                        <div class="bookmark-item">⭐ 常用网站</div>
                        <div class="bookmark-item">🔖 工具</div>
                        <div class="bookmark-drop-zone">
                            <span class="drop-indicator">拖拽到这里 ↓</span>
                        </div>
                    </div>
                    <div class="browser-content">
                        <div class="content-placeholder">网页内容区域</div>
                    </div>
                </div>
            </div>
        `,
        showNext: false
    });
    
    console.log('🌐 第3步：识别浏览器书签栏位置...');
    
    // 高亮书签栏
    setTimeout(() => {
        const bookmarkBar = document.getElementById('demo-bookmark-bar');
        if (bookmarkBar) {
            bookmarkBar.classList.add('highlight-bookmark-bar');
        }
    }, 1000);
    
    // 4秒后进入下一步
    setTimeout(() => {
        browserModal.remove();
    }, 3800);
}

// 第四步：真实拖拽演示
function showRealisticDragStepDemo() {
    const dragModal = createStepModal('drag-step', {
        title: '🎯 拖拽操作',
        subtitle: '步骤 4/5：执行拖拽',
        content: `
            <div class="step-drag">
                <div class="drag-demo-area">
                    <div class="drag-instruction">
                        <p>观看绿色按钮拖拽到书签栏的完整过程：</p>
                    </div>
                    <div class="mini-browser">
                        <div class="mini-bookmark-bar">
                            <div class="mini-bookmark">📁 收藏</div>
                            <div class="mini-bookmark">⭐ 网站</div>
                            <div class="mini-drop-zone" id="mini-drop-target">
                                <span class="mini-drop-text">目标位置</span>
                            </div>
                        </div>
                    </div>
                    <div class="drag-source-area">
                        <div class="fake-bookmark-btn" id="fake-drag-source">
                            📗 提取个人信息工具
                        </div>
                    </div>
                    <div class="mouse-cursor" id="demo-cursor">🖱️</div>
                </div>
            </div>
        `,
        showNext: false
    });
    
    console.log('🎯 第4步：演示真实拖拽操作...');
    
    // 开始拖拽动画
    setTimeout(() => {
        startRealisticDragAnimation();
    }, 500);
    
    // 5秒后进入下一步
    setTimeout(() => {
        dragModal.remove();
    }, 4800);
}

// 第五步：完成演示
function showCompletionStepDemo() {
    const completionModal = createStepModal('completion-step', {
        title: '🎉 安装完成',
        subtitle: '步骤 5/5：演示完成',
        content: `
            <div class="step-completion">
                <div class="completion-animation">
                    <div class="success-icon">✅</div>
                    <h3>书签工具安装成功！</h3>
                    <div class="completion-details">
                        <div class="detail-item">
                            <span class="detail-icon">📗</span>
                            <span class="detail-text">工具已添加到书签栏</span>
                        </div>
                        <div class="detail-item">
                            <span class="detail-icon">🌐</span>
                            <span class="detail-text">可在任何网页上使用</span>
                        </div>
                        <div class="detail-item">
                            <span class="detail-icon">⚡</span>
                            <span class="detail-text">一键提取个人信息</span>
                        </div>
                    </div>
                    <div class="next-action">
                        <p>现在请拖拽下方的绿色按钮到您的浏览器书签栏</p>
                    </div>
                </div>
            </div>
        `,
        showNext: false
    });
    
    console.log('🎉 演示完成！现在可以拖拽绿色按钮到浏览器书签栏了');
    
    // 3秒后自动关闭
    setTimeout(() => {
        completionModal.remove();
    }, 2800);
}

// 创建紧凑演示容器（新版）
function createCompactDemoContainer(hideProgressElements = false) {
    const modal = document.createElement('div');
    modal.id = 'compact-demo-modal';
    modal.className = 'step-demo-modal';
    
    // 根据是否隐藏进度元素来决定内容结构
    const progressSection = hideProgressElements ? '' : `
        <!-- 步骤进度指示器 -->
        <div class="demo-steps-progress" id="demo-progress">
            <!-- 动态生成进度点 -->
        </div>
        
        <!-- 当前步骤标题 -->
        <div class="demo-current-step" id="demo-current-step">
            准备开始演示...
        </div>
    `;
    
    modal.innerHTML = `
        <div class="step-modal-content">
            <div class="step-header">
                <h2 class="step-title">🎬 完整演示教程</h2>
                <div class="step-subtitle">书签工具安装与使用全流程</div>
            </div>
            <div class="step-body">
                <div class="compact-demo-container">
                    ${progressSection}
                    
                    <!-- 演示内容区域 -->
                    <div class="demo-content-area ${hideProgressElements ? 'full-height' : ''}">
                        <div class="demo-stage" id="demo-stage">
                            <!-- 动态内容区域 -->
                        </div>
                    </div>
                    
                    <!-- 演示控制栏 -->
                    <div class="demo-controls">
                        <button class="demo-control-btn" onclick="pauseDemo()">⏸️ 暂停</button>
                        <button class="demo-control-btn primary" onclick="closeDemo()">✕ 关闭</button>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // 动画显示
    setTimeout(() => {
        modal.style.opacity = '1';
    }, 10);
    
    return modal;
}

// 更新步骤指示器
function updateStepIndicator(container, currentStep, totalSteps, hideProgressElements = false) {
    const progressContainer = container.querySelector('#demo-progress');
    const currentStepDisplay = container.querySelector('#demo-current-step');
    
    // 如果隐藏进度元素，则不显示任何进度相关内容
    if (hideProgressElements) {
        if (progressContainer) {
            progressContainer.style.display = 'none';
        }
        if (currentStepDisplay) {
            currentStepDisplay.style.display = 'none';
        }
        return;
    }
    
    // 步骤标题映射
    const stepTitles = [
        '欢迎使用', '显示书签栏', '浏览器界面', '拖拽安装', 
        '安装完成', '打开目标网站', '点击工具', '信息提取', 
        '复制信息', '粘贴到查询助手', '开始查询'
    ];
    
    // 更新当前步骤标题
    if (currentStepDisplay) {
        currentStepDisplay.textContent = `第${currentStep}步：${stepTitles[currentStep - 1]} (${currentStep}/${totalSteps})`;
    }
    
    // 生成或更新进度点
    if (progressContainer) {
        let dotsHTML = '';
        for (let i = 1; i <= totalSteps; i++) {
            let dotClass = 'demo-step-dot';
            if (i < currentStep) {
                dotClass += ' completed';
            } else if (i === currentStep) {
                dotClass += ' active';
            }
            
            dotsHTML += `<div class="${dotClass}"></div>`;
            
            // 添加连接线（除了最后一个点）
            if (i < totalSteps) {
                const connectorClass = i < currentStep ? 'demo-step-connector completed' : 'demo-step-connector';
                dotsHTML += `<div class="${connectorClass}"></div>`;
            }
        }
        progressContainer.innerHTML = dotsHTML;
    }
}

// 创建步骤模态框（保留兼容性）
function createStepModal(id, options) {
    const modal = document.createElement('div');
    modal.id = id;
    modal.className = 'step-demo-modal';
    modal.innerHTML = `
        <div class="step-modal-content">
            <div class="step-header">
                <h2 class="step-title">${options.title}</h2>
                <div class="step-subtitle">${options.subtitle}</div>
            </div>
            <div class="step-body">
                ${options.content}
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // 动画显示
    setTimeout(() => {
        modal.style.opacity = '1';
    }, 10);
    
    return modal;
}

// 模拟键盘演示
function simulateKeyboardDemo(shortcutKey) {
    const keys = shortcutKey.split('+');
    let delay = 300;
    
    keys.forEach((key, index) => {
        setTimeout(() => {
            const keyElement = document.querySelector(`[data-key="${key}"]`);
            if (keyElement) {
                keyElement.classList.add('key-pressed');
                
                setTimeout(() => {
                    keyElement.classList.remove('key-pressed');
                }, 600);
            }
        }, delay + index * 300);
    });
}

// 真实拖拽动画
function startRealisticDragAnimation() {
    const cursor = document.getElementById('demo-cursor');
    const source = document.getElementById('fake-drag-source');
    const target = document.getElementById('mini-drop-target');
    
    if (!cursor || !source || !target) return;
    
    // 获取位置
    const sourceRect = source.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const modalRect = document.querySelector('.step-demo-modal').getBoundingClientRect();
    
    // 相对于模态框的位置
    const startX = sourceRect.left - modalRect.left + sourceRect.width / 2;
    const startY = sourceRect.top - modalRect.top + sourceRect.height / 2;
    const endX = targetRect.left - modalRect.left + targetRect.width / 2;
    const endY = targetRect.top - modalRect.top + targetRect.height / 2;
    
    // 初始化光标位置
    cursor.style.left = startX + 'px';
    cursor.style.top = startY + 'px';
    cursor.style.opacity = '1';
    
    // 第一阶段：移动到源头
    setTimeout(() => {
        animateCursorToSource(cursor, source, startX, startY);
    }, 200);
    
    // 第二阶段：开始拖拽
    setTimeout(() => {
        startDragSequence(cursor, source, target, startX, startY, endX, endY);
    }, 1000);
}

// 光标移动到源头动画
function animateCursorToSource(cursor, source, x, y) {
    cursor.style.transition = 'all 0.5s ease';
    cursor.style.transform = 'scale(1.2)';
    
    // 高亮源元素
    source.classList.add('drag-ready');
}

// 拖拽序列
function startDragSequence(cursor, source, target, startX, startY, endX, endY) {
    // 开始拖拽状态
    source.classList.add('being-dragged');
    target.classList.add('drop-ready');
    
    // 创建拖拽克隆
    const clone = source.cloneNode(true);
    clone.className = 'dragging-clone';
    clone.style.position = 'absolute';
    clone.style.left = startX - 50 + 'px';
    clone.style.top = startY - 15 + 'px';
    clone.style.opacity = '0.8';
    clone.style.transform = 'scale(0.9) rotate(5deg)';
    clone.style.pointerEvents = 'none';
    clone.style.zIndex = '10001';
    
    document.querySelector('.step-demo-modal').appendChild(clone);
    
    // 动画到目标
    const duration = 2000;
    const startTime = Date.now();
    
    function animateToTarget() {
        const elapsed = Date.now() - startTime;
        const progress = Math.min(elapsed / duration, 1);
        const easeProgress = easeInOutCubic(progress);
        
        // 计算位置（添加弧形轨迹）
        const currentX = startX + (endX - startX) * easeProgress;
        const arcHeight = 30;
        const arcOffset = Math.sin(progress * Math.PI) * arcHeight;
        const currentY = startY + (endY - startY) * easeProgress - arcOffset;
        
        // 更新克隆位置
        clone.style.left = currentX - 50 + 'px';
        clone.style.top = currentY - 15 + 'px';
        
        // 更新光标位置
        cursor.style.left = currentX + 'px';
        cursor.style.top = currentY + 'px';
        
        // 旋转效果
        const rotation = 5 + progress * 10;
        clone.style.transform = `scale(${0.9 + progress * 0.1}) rotate(${rotation}deg)`;
        
        if (progress < 1) {
            requestAnimationFrame(animateToTarget);
        } else {
            // 拖拽完成
            completeDragAnimation(clone, target, cursor);
        }
    }
    
    requestAnimationFrame(animateToTarget);
}

// 完成拖拽动画
function completeDragAnimation(clone, target, cursor) {
    // 成功效果
    target.classList.add('drop-success');
    clone.style.opacity = '0';
    cursor.style.opacity = '0';
    
    // 在目标位置显示成功效果
    setTimeout(() => {
        const successEffect = document.createElement('div');
        successEffect.className = 'drop-success-effect-mini';
        successEffect.style.position = 'absolute';
        successEffect.style.left = target.getBoundingClientRect().left + 'px';
        successEffect.style.top = target.getBoundingClientRect().top + 'px';
        successEffect.innerHTML = '✨';
        document.body.appendChild(successEffect);
        
        setTimeout(() => {
            successEffect.remove();
            clone.remove();
        }, 1000);
    }, 200);
}

// 缓动函数
function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// 显示拖拽成功效果
function showDropSuccessEffect(x, y, container) {
    const effect = document.createElement('div');
    effect.className = 'drop-success-effect';
    effect.style.left = x - 50 + 'px';
    effect.style.top = y - 50 + 'px';
    container.appendChild(effect);
    
    // 1秒后移除
    setTimeout(() => {
        effect.remove();
    }, 1000);
}

// 动画拖拽路径（延长版）
function animateDragPath() {
    const dragArrow = document.querySelector('.drag-arrow');
    if (!dragArrow) return;
    
    let direction = 1;
    let count = 0;
    const maxCount = 16; // 闪烁8次（每次2个状态），延长动画
    
    const blinkInterval = setInterval(() => {
        dragArrow.style.opacity = dragArrow.style.opacity === '0.3' ? '1' : '0.3';
        dragArrow.style.transform = direction > 0 ? 'scale(1.3)' : 'scale(1)';
        direction *= -1;
        count++;
        
        if (count >= maxCount) {
            clearInterval(blinkInterval);
            dragArrow.style.opacity = '1';
            dragArrow.style.transform = 'scale(1)';
        }
    }, 250); // 稍微加快单次动画，但总时间延长
}

// 显示成功演示（延长版）
function showSuccessDemo() {
    // 创建成功演示覆盖层
    const successDemo = document.createElement('div');
    successDemo.id = 'success-demo-overlay';
    successDemo.className = 'success-demo-overlay';
    successDemo.innerHTML = `
        <div class="success-demo-content">
            <div class="demo-step-indicator">演示步骤 3/3</div>
            <div class="demo-title">🎉 第三步：安装完成</div>
            <div class="demo-description">书签工具已成功添加到浏览器书签栏</div>
            <div class="success-visual">
                <div class="bookmark-bar-demo">
                    <div class="demo-bookmark">📚 其他书签</div>
                    <div class="demo-bookmark new-bookmark">📗 提取个人信息工具</div>
                    <div class="demo-bookmark">🔖 常用网站</div>
                </div>
            </div>
            <div class="demo-instruction">✅ 现在可以在任何包含个人信息的网页上使用这个工具了！</div>
        </div>
    `;
    
    document.body.appendChild(successDemo);
    
    // 动画显示
    setTimeout(() => {
        successDemo.style.opacity = '1';
    }, 10);
    
    // 新书签闪烁效果（延长等待时间）
    setTimeout(() => {
        const newBookmark = document.querySelector('.new-bookmark');
        if (newBookmark) {
            newBookmark.classList.add('highlight-new');
        }
    }, 800);
    
    // 更新状态
    updateDragStatus('success', '🎉 完整演示结束！按照演示步骤即可成功安装书签工具');
    
    // 3.5秒后移除（延长展示时间）
    setTimeout(() => {
        successDemo.style.opacity = '0';
        setTimeout(() => {
            successDemo.remove();
        }, 400);
    }, 3200);
}

// 初始化拖拽反馈
function initDragFeedback() {
    const bookmarkContainer = document.getElementById('bookmarkContainer');
    if (!bookmarkContainer) return;
    
    // 监听拖拽开始事件
    bookmarkContainer.addEventListener('dragstart', (e) => {
        console.log('拖拽开始');
        updateDragStatus('dragging', '正在拖拽...请将按钮放到书签栏');
        
        // 添加拖拽中的视觉效果
        bookmarkContainer.classList.add('dragging');
        
        // 显示全局拖拽提示
        showGlobalDragTip();
    });
    
    // 监听拖拽结束事件
    document.addEventListener('dragend', (e) => {
        console.log('拖拽结束');
        updateDragStatus('ready', '拖拽完成！如果书签栏出现新书签，说明安装成功');
        
        // 移除拖拽中的视觉效果
        bookmarkContainer.classList.remove('dragging');
        
        // 隐藏全局拖拽提示
        hideGlobalDragTip();
        
        // 显示成功提示
        setTimeout(() => {
            updateDragStatus('success', '如果看到书签出现在书签栏，说明安装成功！');
        }, 2000);
    });
}

// 显示全局拖拽提示
function showGlobalDragTip() {
    // 创建全局拖拽提示覆盖层
    const overlay = document.createElement('div');
    overlay.id = 'global-drag-overlay';
    overlay.className = 'global-drag-overlay';
    overlay.innerHTML = `
        <div class="drag-tip-content">
            <div class="drag-tip-icon">🎯</div>
            <div class="drag-tip-text">将书签拖拽到浏览器顶部的书签栏</div>
            <div class="drag-tip-subtext">看到"+"号表示可以放置</div>
        </div>
    `;
    
    document.body.appendChild(overlay);
    
    // 动画显示
    setTimeout(() => {
        overlay.style.opacity = '1';
    }, 10);
}

// 隐藏全局拖拽提示
function hideGlobalDragTip() {
    const overlay = document.getElementById('global-drag-overlay');
    if (overlay) {
        overlay.style.opacity = '0';
        setTimeout(() => {
            overlay.remove();
        }, 300);
    }
}

// 生成书签工具
function generateBookmarkTools() {
    // JavaScript代码（从原始HTML文件中提取的完整版本）
    const jsCodeParts = [
        'javascript:(function(){',
        'const m={"January":"01","February":"02","March":"03","April":"04","May":"05","June":"06","July":"07","August":"08","September":"09","October":"10","November":"11","December":"12","Jan":"01","Feb":"02","Mar":"03","Apr":"04","May":"05","Jun":"06","Jul":"07","Aug":"08","Sep":"09","Oct":"10","Nov":"11","Dec":"12","1月":"01","2月":"02","3月":"03","4月":"04","5月":"05","6月":"06","7月":"07","8月":"08","9月":"09","10月":"10","11月":"11","12月":"12","1":"01","2":"02","3":"03","4":"04","5":"05","6":"06","7":"07","8":"08","9":"09"};function formatDate(year,month){if(!year||!month)return "";const monthNum=m[month];if(monthNum){return year+"-"+monthNum;}const numericMonth=month.toString().replace(/[^0-9]/g,"");if(numericMonth&&numericMonth>=1&&numericMonth<=12){const paddedMonth=numericMonth.length===1?"0"+numericMonth:numericMonth;return year+"-"+paddedMonth;}return year+"-"+month;}',
        'function createGrid(data){const grid=document.createElement("div");grid.style.cssText="position:fixed;top:20px;left:50%;transform:translateX(-50%);background:white;padding:12px;border:1px solid #ccc;border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,0.1);z-index:9999;width:auto;max-width:95%;font-family:Arial,sans-serif;";const header=document.createElement("div");header.style.cssText="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;";const title=document.createElement("div");title.style.cssText="font-weight:bold;font-size:14px;";title.textContent="提取的资料";const closeBtn=document.createElement("button");closeBtn.style.cssText="background:none;border:none;font-size:18px;cursor:pointer;padding:0 5px;";closeBtn.textContent="×";closeBtn.onclick=function(){grid.remove();};header.appendChild(title);header.appendChild(closeBtn);grid.appendChild(header);const contentContainer=document.createElement("div");contentContainer.style.cssText="display:grid;grid-template-columns:repeat(4, 150px);gap:6px;overflow-x:auto;padding-bottom:6px;";const fields=[["名字",data.名字||data.firstName],["中间名",data.中间名||data.middleName],["姓氏",data.姓氏||data.lastName],["性别",data.性别],["年龄",data.年龄],["生日",data.出生日期||data.birthDate],["街道地址",data.街道地址||data.street],["城市",data.城市||data.city],["州",data.州||data.state],["邮编",data.邮编||data.zipCode],["电话",data.电话||data.phone],["邮箱",data.邮箱||data.email],["所有州",data.所有州],["所有邮编",data.所有邮编]];',
        'fields.forEach(function([label,value]){if(value||label==="中间名"){const cell=document.createElement("div");cell.style.cssText="border:1px solid #e0e0e0;border-radius:4px;overflow:hidden;background:#f8f8f8;";const labelDiv=document.createElement("div");labelDiv.style.cssText="font-size:12px;color:#666;padding:2px 6px;background:#f0f0f0;border-bottom:1px solid #e0e0e0;";labelDiv.textContent=label;const valueContainer=document.createElement("div");valueContainer.style.cssText="padding:4px 6px;display:flex;justify-content:space-between;align-items:center;gap:4px;";const valueDiv=document.createElement("div");valueDiv.style.cssText="font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;";valueDiv.textContent=value||"";const copyBtn=document.createElement("button");copyBtn.style.cssText="padding:2px 6px;background:#fff;border:1px solid #ccc;border-radius:3px;cursor:pointer;font-size:11px;white-space:nowrap;";copyBtn.textContent="复制";copyBtn.onclick=function(){navigator.clipboard.writeText(value||"");copyBtn.textContent="已复制";setTimeout(function(){copyBtn.textContent="复制";},1000);};valueContainer.appendChild(valueDiv);valueContainer.appendChild(copyBtn);cell.appendChild(labelDiv);cell.appendChild(valueContainer);contentContainer.appendChild(cell);}});',
        'if(data.其他姓名 && data.其他姓名.length>0){const aliasCell=document.createElement("div");aliasCell.style.cssText="grid-column:1/-1;border:1px solid #e0e0e0;border-radius:4px;overflow:hidden;background:#f8f8f8;margin-top:6px;";const aliasHeader=document.createElement("div");aliasHeader.style.cssText="display:flex;justify-content:space-between;align-items:center;padding:6px;background:#f0f0f0;cursor:pointer;";const aliasLabel=document.createElement("div");aliasLabel.style.cssText="font-weight:bold;font-size:12px;color:#666;";aliasLabel.textContent="其他姓名";const aliasToggleBtn=document.createElement("button");aliasToggleBtn.style.cssText="background:none;border:none;font-size:12px;color:#666;cursor:pointer;";aliasToggleBtn.textContent="▼";const aliasContent=document.createElement("div");aliasContent.style.cssText="display:none;padding:6px;max-height:300px;overflow-y:auto;";data.其他姓名.forEach(function(alias, index){const aliasDiv=document.createElement("div");aliasDiv.style.cssText="display:flex;justify-content:space-between;align-items:center;padding:6px;border-bottom:1px solid #e0e0e0;";const aliasText=document.createElement("div");aliasText.style.cssText="font-size:13px;flex:1;";aliasText.textContent=alias;const aliasCopyBtn=document.createElement("button");aliasCopyBtn.style.cssText="padding:2px 6px;background:#fff;border:1px solid #ccc;border-radius:3px;cursor:pointer;font-size:11px;white-space:nowrap;margin-left:8px;";aliasCopyBtn.textContent="复制";aliasCopyBtn.onclick=function(e){e.stopPropagation();const aliasParts=alias.trim().split(/\\s+/);let aliasFirstName="";let aliasLastName="";if(aliasParts.length>=2){aliasFirstName=aliasParts[0];aliasLastName=aliasParts[aliasParts.length-1];}else if(aliasParts.length===1){aliasFirstName=aliasParts[0];}const birthDate=data.出生日期||data.birthDate||"";const allZips=data.所有邮编||"";const allStates=data.所有州||"";const historicalAddresses=data.历史地址||[];const streetAddresses=historicalAddresses.map(function(addr){if(addr.includes(",")){return addr.split(",")[0].trim();}else{const parts=addr.split(/\\s+[A-Z]{2}\\s+\\d{5}/);if(parts.length>0){return parts[0].trim();}return addr;}}).filter(Boolean);const parts=[];parts.push(aliasFirstName);parts.push(aliasLastName);parts.push(birthDate);parts.push(allZips);parts.push(allStates);streetAddresses.forEach(function(addr){parts.push(addr);});const formattedData=parts.join("\\n");navigator.clipboard.writeText(formattedData);aliasCopyBtn.textContent="已复制";setTimeout(function(){aliasCopyBtn.textContent="复制";},1000);};aliasDiv.appendChild(aliasText);aliasDiv.appendChild(aliasCopyBtn);aliasContent.appendChild(aliasDiv);});aliasHeader.onclick=function(){aliasContent.style.display=aliasContent.style.display==="none"?"block":"none";aliasToggleBtn.textContent=aliasContent.style.display==="none"?"▼":"▲";};aliasHeader.appendChild(aliasLabel);aliasHeader.appendChild(aliasToggleBtn);aliasCell.appendChild(aliasHeader);aliasCell.appendChild(aliasContent);contentContainer.appendChild(aliasCell);}if(data.历史地址&&data.历史地址.length>0){const historyCell=document.createElement("div");historyCell.style.cssText="grid-column:1/-1;border:1px solid #e0e0e0;border-radius:4px;overflow:hidden;background:#f8f8f8;margin-top:6px;";const historyHeader=document.createElement("div");historyHeader.style.cssText="display:flex;justify-content:space-between;align-items:center;padding:6px;background:#f0f0f0;cursor:pointer;";const historyLabel=document.createElement("div");historyLabel.style.cssText="font-weight:bold;font-size:12px;color:#666;";historyLabel.textContent="历史地址";const toggleBtn=document.createElement("button");toggleBtn.style.cssText="background:none;border:none;font-size:12px;color:#666;cursor:pointer;";toggleBtn.textContent="▼";const historyContent=document.createElement("div");historyContent.style.cssText="display:none;padding:6px;max-height:300px;overflow-y:auto;";data.历史地址.forEach(function(addr,index){let addressParts=addr.match(/([^,]+),\\s*([^,]+),\\s*([A-Z]{2})\\s+(\\d{5})/);if(!addressParts){addressParts=addr.match(/^(.+?)\\s+([A-Za-z][A-Za-z\\s]*?)\\s+([A-Z]{2})\\s+(\\d{5})$/);}if(!addressParts){const parts=addr.trim().split(/\\s+/);if(parts.length>=4){const zip=parts[parts.length-1];const state=parts[parts.length-2];const cityStart=Math.max(0,parts.length-4);const streetEnd=cityStart;const street=parts.slice(0,streetEnd+1).join(" ");const city=parts.slice(streetEnd+1,parts.length-2).join(" ");if(/^\\d{5}$/.test(zip)&&/^[A-Z]{2}$/.test(state)){addressParts=[addr,street,city,state,zip];}}}if(addressParts){const street=addressParts[1];const city=addressParts[2];const state=addressParts[3];const zip=addressParts[4];const addrDiv=document.createElement("div");addrDiv.style.cssText="display:grid;grid-template-columns:repeat(5, 110px);gap:6px;margin-bottom:6px;align-items:start;";const fields=[[\'街道地址\',street],[\'城市\',city],[\'州\',state],[\'邮编\',zip]];fields.forEach(function(field){const label=field[0];const value=field[1];const cell=document.createElement("div");cell.style.cssText="border:1px solid #e0e0e0;border-radius:4px;overflow:hidden;background:white;";const labelDiv=document.createElement("div");labelDiv.style.cssText="font-size:12px;color:#666;padding:2px 6px;background:#f0f0f0;border-bottom:1px solid #e0e0e0;";labelDiv.textContent=label;const valueContainer=document.createElement("div");valueContainer.style.cssText="padding:4px 6px;display:flex;justify-content:space-between;align-items:center;gap:4px;";const valueDiv=document.createElement("div");valueDiv.style.cssText="font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;";valueDiv.textContent=value;const copyBtn=document.createElement("button");copyBtn.style.cssText="padding:2px 6px;background:#fff;border:1px solid #ccc;border-radius:3px;cursor:pointer;font-size:11px;white-space:nowrap;";copyBtn.textContent="复制";copyBtn.onclick=function(e){e.stopPropagation();navigator.clipboard.writeText(value);copyBtn.textContent="已复制";setTimeout(function(){copyBtn.textContent="复制";},1000);};valueContainer.appendChild(valueDiv);valueContainer.appendChild(copyBtn);cell.appendChild(labelDiv);cell.appendChild(valueContainer);addrDiv.appendChild(cell);});const copyAllCell=document.createElement("div");copyAllCell.style.cssText="border:1px solid #e0e0e0;border-radius:4px;overflow:hidden;background:white;";const copyAllLabel=document.createElement("div");copyAllLabel.style.cssText="font-size:12px;color:#666;padding:2px 6px;background:#f0f0f0;border-bottom:1px solid #e0e0e0;";copyAllLabel.textContent="完整地址";const copyAllContainer=document.createElement("div");copyAllContainer.style.cssText="padding:4px 6px;display:flex;justify-content:center;align-items:center;";const copyAllBtn=document.createElement("button");copyAllBtn.style.cssText="padding:2px 6px;background:#fff;border:1px solid #ccc;border-radius:3px;cursor:pointer;font-size:11px;";copyAllBtn.textContent="复制完整地址";copyAllBtn.onclick=function(e){e.stopPropagation();navigator.clipboard.writeText(`${street}\\t${city}\\t${state}\\t${zip}`);copyAllBtn.textContent="已复制";setTimeout(function(){copyAllBtn.textContent="复制完整地址";},1000);};copyAllContainer.appendChild(copyAllBtn);copyAllCell.appendChild(copyAllLabel);copyAllCell.appendChild(copyAllContainer);addrDiv.appendChild(copyAllCell);historyContent.appendChild(addrDiv);}});historyHeader.onclick=function(){historyContent.style.display=historyContent.style.display==="none"?"block":"none";toggleBtn.textContent=historyContent.style.display==="none"?"▼":"▲";};historyHeader.appendChild(historyLabel);historyHeader.appendChild(toggleBtn);historyCell.appendChild(historyHeader);historyCell.appendChild(historyContent);contentContainer.appendChild(historyCell);}',
        'grid.appendChild(contentContainer);const copyAllContainer=document.createElement("div");copyAllContainer.style.cssText="display:flex;justify-content:flex-end;gap:8px;margin-top:8px;";const copyAllBtn=document.createElement("button");copyAllBtn.style.cssText="padding:6px 12px;background:#4CAF50;color:white;border:none;border-radius:4px;cursor:pointer;font-size:12px;";copyAllBtn.textContent="复制全部";copyAllBtn.onclick=function(){const firstName=data.名字||data.firstName||"";const middleName=data.中间名||data.middleName||"";const lastName=data.姓氏||data.lastName||"";const age=data.年龄||"";const birthDate=data.出生日期||data.birthDate||"";const streetAddress=data.街道地址||data.street||"";const city=data.城市||data.city||"";const state=data.州||data.state||"";const zipCode=data.邮编||data.zipCode||"";const email=data.邮箱||data.email||"";const phone=data.电话||data.phone||"";const formattedData=[firstName,middleName,lastName,age,birthDate,streetAddress,city,state,zipCode,email,phone];const allData=formattedData.join("\\t");navigator.clipboard.writeText(allData);copyAllBtn.textContent="已复制全部";setTimeout(function(){copyAllBtn.textContent="复制全部";},1000);};',
        'const copyFormattedBtn=document.createElement("button");',
        'copyFormattedBtn.style.cssText="padding:6px 12px;background:#2196F3;color:white;border:none;border-radius:4px;cursor:pointer;font-size:12px;";',
        'copyFormattedBtn.textContent="复制查询格式";',
        'copyFormattedBtn.onclick=function(){',
'const firstName = data.名字 || data.firstName || "";',
'const lastName = data.姓氏 || data.lastName || "";',
'const birthDate = data.出生日期 || data.birthDate || "";',
'const allZips = data.所有邮编 || "";',
'const allStates = data.所有州 || "";',
'const historicalAddresses = data.历史地址 || [];',
'const streetAddresses = historicalAddresses.map(function(addr) {',
'if(addr.includes(",")) {',
'return addr.split(",")[0].trim();',
'} else {',
'const parts = addr.split(/\\s+[A-Z]{2}\\s+\\d{5}/);',
'if(parts.length > 0) {',
'return parts[0].trim();',
'}',
'return addr;',
'}',
'}).filter(Boolean);',
'const parts = [];',
'if(firstName) parts.push(firstName);',
'if(lastName) parts.push(lastName);',
'if(birthDate) parts.push(birthDate);',
'if(allZips) parts.push(allZips);',
'if(allStates) parts.push(allStates);',
'streetAddresses.forEach(function(addr) { if(addr) parts.push(addr); });',
'const formattedData = parts.join("\\n");',
'navigator.clipboard.writeText(formattedData);',
'copyFormattedBtn.textContent="已复制";',
'setTimeout(function(){copyFormattedBtn.textContent="复制查询格式";},1000);',
'};',
        'copyAllContainer.appendChild(copyFormattedBtn);',
        'copyAllContainer.appendChild(copyAllBtn);',
        'grid.appendChild(copyAllContainer);document.body.appendChild(grid);}',
        'function extractAddresses(){return new Promise(function(resolve){const addresses=new Set();const showMoreButtons=document.querySelectorAll(".sc-show-more");let clickCount=0;showMoreButtons.forEach(function(btn){try{const icon=btn.querySelector(".sc-show-more__icon--closed");if(icon&&window.getComputedStyle(icon).display!=="none"){clickCount++;btn.click();}}catch(e){console.error("点击SHOW MORE按钮失败:",e);}});setTimeout(function(){const fullAddressElements=document.querySelectorAll("b.sc-text.sc-text-base.sc-report-link-container__text");fullAddressElements.forEach(function(el){const text=el.textContent.trim();if(text.match(/[A-Z]{2}\\s+\\d{5}/)){addresses.add(text);}});const structuredAddresses=document.querySelectorAll("[itemprop=\\"streetAddress\\"],[itemprop=\\"addressLocality\\"],[itemprop=\\"addressRegion\\"],[itemprop=\\"postalCode\\"]");let currentAddress={};structuredAddresses.forEach(function(el){const type=el.getAttribute("itemprop");const value=el.textContent.trim();if(type==="streetAddress")currentAddress.street=value;else if(type==="addressLocality")currentAddress.city=value;else if(type==="addressRegion")currentAddress.state=value;else if(type==="postalCode"){currentAddress.zip=value;if(currentAddress.street&&currentAddress.city&&currentAddress.state){const fullAddr=`${currentAddress.street}, ${currentAddress.city}, ${currentAddress.state} ${currentAddress.zip}`;addresses.add(fullAddr);currentAddress={};}}});resolve(Array.from(addresses));},clickCount>0?500:0);});}',
        'function extractDataFromPublicDataCheck(){const data={};try{let firstName="",middleName="",lastName="",age="",streetAddress="",city="",state="",zipCode="",phone="",email="",birthDate="",gender="";const aliases=[];const titleElement=document.querySelector(".sc-text.sc-text-xl.sc-text-font-weight-bold");if(titleElement){const fullName=titleElement.textContent.trim();const nameParts=fullName.split(" ");if(nameParts.length===2){firstName=nameParts[0];lastName=nameParts[1];}else if(nameParts.length===3){firstName=nameParts[0];middleName=nameParts[1];lastName=nameParts[2];}}else{const bodyText=document.body.textContent;const nameMatch=bodyText.match(/([A-Z][a-z]+)(?:\\s+([A-Z][a-z]+))?\\s+([A-Z][a-z]+)(?:\\s+is\\s+\\d+\\s+years\\s+old|\\s+aka:|\\s+Male|\\s+Female|\\s+Age\\s+\\d+)/);if(nameMatch){firstName=nameMatch[1];if(nameMatch[2]&&nameMatch[3]){middleName=nameMatch[2];lastName=nameMatch[3];}else if(nameMatch[3]){lastName=nameMatch[3];}}}const aliasesContainer=document.querySelector(".sc-container__body .sc-collapsable-item-list");if(aliasesContainer){const aliasItems=aliasesContainer.querySelectorAll(".sc-collapsable-item-list__item");aliasItems.forEach(function(item){const nameElement=item.querySelector("b.sc-text.sc-text-base.sc-container-line-item__header-text");if(nameElement){const aliasName=nameElement.textContent.trim();if(aliasName&&!aliases.includes(aliasName)){aliases.push(aliasName);}}});}',
        'const bodyText=document.body.textContent;const highlightsElement=document.querySelector(".sc-report-summary__highlights");if(highlightsElement){const highlightsText=highlightsElement.textContent;const genderMatch=highlightsText.match(/(Male|Female)/);if(genderMatch){gender=genderMatch[1];}}const ageMatch=bodyText.match(/(\\d+)\\s+years\\s+old/)||bodyText.match(/Age\\s+(\\d+)/);if(ageMatch){age=ageMatch[1];}const addressMatch=bodyText.match(/(\\d+\\s+[^,]+),\\s*([^,]+),\\s*([A-Z]{2})\\s+(\\d{5})/)||bodyText.match(/([^,]+),\\s*([A-Z]{2})\\s+(\\d{5})/);if(addressMatch){if(addressMatch.length>4){streetAddress=addressMatch[1];city=addressMatch[2];state=addressMatch[3];zipCode=addressMatch[4];}else{streetAddress=addressMatch[1];state=addressMatch[2];zipCode=addressMatch[3];}}',
        'const phoneMatch=bodyText.match(/\\((\\d{3})\\)\\s*(\\d{3})-(\\d{4})/);if(phoneMatch){phone="("+phoneMatch[1]+") "+phoneMatch[2]+"-"+phoneMatch[3];}const emailTextElements=document.querySelectorAll(".sc-container-line-item__header-text");for(let i=0;i<emailTextElements.length;i++){const text=emailTextElements[i].textContent.trim();if(text.includes("@")&&text.includes(".")){const emailMatch=text.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,4})/);if(emailMatch){email=emailMatch[1];break;}}}if(!email){const emailMatch=bodyText.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,4})/);if(emailMatch){email=emailMatch[1];}}const birthMatch=bodyText.match(/born\\s+in\\s+([A-Za-z\\d月]+)\\s+(\\d{4})/i)||bodyText.match(/Born\\s+([A-Za-z\\d月]+)\\s+(\\d{4})/)||bodyText.match(/(\\d{4})年([\\d月]+)/)||bodyText.match(/(\\d{4})-([\\d月]+)/);if(birthMatch){if(birthMatch[0].includes("年")||birthMatch[0].includes("-")){birthDate=formatDate(birthMatch[1],birthMatch[2]);}else{birthDate=formatDate(birthMatch[2],birthMatch[1]);}}',
        'const stateZipElements = document.querySelectorAll(\'span[itemprop="addressRegion"], span[itemprop="postalCode"], b.sc-text.sc-text-base.sc-report-link-container__text\');const states = new Set();const zips = new Set();stateZipElements.forEach(element => {const text = element.textContent.trim();if (element.getAttribute(\'itemprop\') === \'addressRegion\') {states.add(text);} else if (element.getAttribute(\'itemprop\') === \'postalCode\') {zips.add(text);} else if (text.includes(\',\')) {const matches = text.match(/,\\s*[A-Z]{2}\\s+(\\d{5})/);if (matches) {const stateMatch = text.match(/,\\s*([A-Z]{2})\\s+\\d{5}/);if (stateMatch) {states.add(stateMatch[1]);}zips.add(matches[1]);}}});if (states.size > 0) {state = Array.from(states)[0];data["所有州"] = Array.from(states).join(" ");}if (zips.size > 0) {zipCode = Array.from(zips)[0];data["所有邮编"] = Array.from(zips).join(" ");}',
        'if(firstName)data["名字"]=firstName;if(middleName)data["中间名"]=middleName;if(lastName)data["姓氏"]=lastName;if(gender)data["性别"]=gender;if(age)data["年龄"]=age;if(birthDate)data["出生日期"]=birthDate;if(streetAddress)data["街道地址"]=streetAddress;if(city)data["城市"]=city;if(state)data["州"]=state;if(zipCode)data["邮编"]=zipCode;if(phone)data["电话"]=phone;if(email)data["邮箱"]=email;if(aliases.length>0)data["其他姓名"]=aliases;data["历史地址"]=extractAddresses();',
        'const locationElements=document.querySelectorAll("*");for(let el of locationElements){const text=el.textContent.trim();if(text.match(/^\\d+\\s+[A-Za-z]/)){const nextSibling=el.nextElementSibling;if(nextSibling){const addressParts=nextSibling.textContent.trim().match(/([^,]+),\\s*([A-Z]{2})\\s+(\\d{5})/);if(addressParts){data["街道地址"]=text;data["城市"]=addressParts[1];data["州"]=addressParts[2];data["邮编"]=addressParts[3];break;}}}}const phoneElements=document.querySelectorAll("a[href*=\\"tel:\\"]");if(phoneElements.length>0){data["电话"]=phoneElements[0].textContent.trim();}const emailElements=document.querySelectorAll("a[href*=\\"mailto:\\"]");if(emailElements.length>0){const emailText=emailElements[0].textContent.trim();data["邮箱"]=emailText;}}catch(e){console.error("提取错误:",e);}return data;}',
        'function extractDataFromOtherSite(){try{const n=document.querySelector("h1.oh1")?.textContent.trim()||"";let t="",s=document.querySelectorAll("div.mt-2");for(const a of s)if(a?.textContent?.includes("years old")){t=a.textContent.trim();break}if(!t){console.warn("未找到包含年龄的文本");return{}}let g="",y="",b="";const r=t.match(/born in ([\\w月]+) (\\d{4})/i)||t.match(/(\\d{4})年([\\d月]+)/)||t.match(/(\\d{4})-([\\d月]+)/);if(r){if(r[0].includes("年")||r[0].includes("-")){y=r[1];b=r[2];}else{y=r[2];b=r[1];}}const states = new Set();const zips = new Set();const aliases = [];const alternateNameElements = document.querySelectorAll(\'[itemprop="alternateName"]\');if(alternateNameElements.length > 0){alternateNameElements.forEach(function(element){const aliasName = element.textContent.trim();if(aliasName && !aliases.includes(aliasName)){aliases.push(aliasName);}});}else{const bodyText = document.body.textContent;if(bodyText.includes("Also Seen As")){const aliasSection = bodyText.substring(bodyText.indexOf("Also Seen As") + 13);const aliasText = aliasSection.substring(0, 500);const aliasMatch = aliasText.match(/([A-Za-z]+(?:\\s+[A-Za-z]+){1,3}(?:\\s*,\\s*[A-Za-z]+(?:\\s+[A-Za-z]+){1,3})*)/);if(aliasMatch){const aliasList = aliasMatch[0].split(",");for(let i=0; i<aliasList.length; i++){const trimmedAlias = aliasList[i].trim();if(trimmedAlias && !aliases.includes(trimmedAlias)){aliases.push(trimmedAlias);}}}}}const stateZipElements = document.querySelectorAll(\'[itemprop="addressRegion"], [itemprop="postalCode"], b.sc-text.sc-text-base.sc-report-link-container__text\');stateZipElements.forEach(function(element){const text = element.textContent.trim();if(element.getAttribute(\'itemprop\') === \'addressRegion\') {states.add(text);} else if(element.getAttribute(\'itemprop\') === \'postalCode\') {zips.add(text);} else if(text.includes(\',\')) {const matches = text.match(/,\\s*[A-Z]{2}\\s+(\\d{5})/);if(matches) {const stateMatch = text.match(/,\\s*([A-Z]{2})\\s+\\d{5}/);if(stateMatch) {states.add(stateMatch[1]);}zips.add(matches[1]);}}});let o = states.size > 0 ? Array.from(states)[0] : "";let i = zips.size > 0 ? Array.from(zips)[0] : "";',
        'const l=document.querySelector("a.dt-hd.link-to-more.olnk");let d="",c="",p="",u="";if(l){d=l.querySelector("[itemprop=\\"streetAddress\\"]")?.textContent.trim()||"";c=l.querySelector("[itemprop=\\"addressLocality\\"]")?.textContent.trim()||"";if(!o)o=l.querySelector("[itemprop=\\"addressRegion\\"]")?.textContent.trim()||"";if(!i)i=l.querySelector("[itemprop=\\"postalCode\\"]")?.textContent.trim()||"";}p=document.querySelector("[itemprop=\\"telephone\\"]")?.textContent.trim()||"";const f=document.querySelectorAll(".row.pl-sm-2[style*=\\"padding-bottom:6px;\\"] div div");for(const a of f){const v=a?.textContent?.trim();if(v?.includes("@")){const emailMatch=v.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,4})/);u=emailMatch?emailMatch[1]:"";break;}}',
        'let h="",middle="",w="";const nameMatch=t.match(/([A-Za-z]+(?:\\s+[A-Za-z]+)*)\\s+is\\s+\\d+/i);if(nameMatch){const fullName=nameMatch[1].trim();const nameParts=fullName.split(/\\s+/);if(nameParts.length>=3){h=nameParts[0];middle=nameParts[1];w=nameParts.slice(2).join(" ");}else if(nameParts.length===2){h=nameParts[0];w=nameParts[1];}else{h=nameParts[0];}}else if(n){const nameParts=n.split(/\\s+/);if(nameParts.length>=3){h=nameParts[0];middle=nameParts[1];w=nameParts.slice(2).join(" ");}else if(nameParts.length===2){h=nameParts[0];w=nameParts[1];}else{h=nameParts[0];}}',
        'return{firstName:h,middleName:middle,lastName:w,birthDate:y&&b?formatDate(y,b):"",street:d,city:c,state:states.size > 0 ? Array.from(states)[0] : "",zipCode:zips.size > 0 ? Array.from(zips)[0] : "",phone:p,email:u,所有州:Array.from(states).join(" "),所有邮编:Array.from(zips).join(" "),其他姓名:aliases.length > 0 ? aliases : undefined,历史地址:extractAddresses()};}catch(error){console.error("提取过程中出错:",error);return{};}}',
        'function extractDataFromWhitepages(){try{const data={};let firstName="",middleName="",lastName="",age="",streetAddress="",city="",state="",zipCode="",phone="",email="",birthDate="";const aliases=[];const historicalAddresses=[];const bigNameElement=document.querySelector("h1[data-qa-selector=\\"big-name-in-header\\"] span, .big-name span");if(bigNameElement){const fullName=bigNameElement.textContent.trim();const nameParts=fullName.split(/\\s+/);if(nameParts.length>=3){firstName=nameParts[0];middleName=nameParts[1];lastName=nameParts.slice(2).join(" ");}else if(nameParts.length===2){firstName=nameParts[0];lastName=nameParts[1];}}else{const breadcrumbElement=document.querySelector(".breadcrumb-item-text");if(breadcrumbElement){const breadcrumbText=breadcrumbElement.textContent.trim();const nameMatch=breadcrumbText.match(/^([A-Za-z]+)\\s+([A-Za-z])\\s+([A-Za-z]+)/);if(nameMatch){firstName=nameMatch[1];middleName=nameMatch[2];lastName=nameMatch[3];}}}const addressElement=document.querySelector("h1[data-qa-selector=\\"big-name-in-header\\"] strong, .big-name strong");if(addressElement){const addressText=addressElement.textContent.trim();const addressMatch=addressText.match(/(.+?),\\s*(.+?),\\s*([A-Z]{2})\\s+(\\d{5})/);if(addressMatch){streetAddress=addressMatch[1];city=addressMatch[2];state=addressMatch[3];zipCode=addressMatch[4];}}const ageElement=document.querySelector(".person-age, .restricted-birthdate");if(ageElement){const ageText=ageElement.textContent.trim();const ageMatch=ageText.match(/(\\d+)\\s+years\\s+old/);if(ageMatch){age=ageMatch[1];}const birthMatch=ageText.match(/\\((\\w{3})\\s+(\\d{1,2}),\\s+(\\d{4})\\)/);if(birthMatch){const monthAbbr=birthMatch[1];const day=birthMatch[2].padStart(2,"0");const year=birthMatch[3];const monthMap={"Jan":"01","Feb":"02","Mar":"03","Apr":"04","May":"05","Jun":"06","Jul":"07","Aug":"08","Sep":"09","Oct":"10","Nov":"11","Dec":"12"};const monthNum=monthMap[monthAbbr]||monthAbbr;birthDate=monthNum+"/"+day+"/"+year;}}const bodyText=document.body.textContent;const addressMatch=bodyText.match(/(\\d+\\s+[^,]+),\\s*([^,]+),\\s*([A-Z]{2})\\s+(\\d{5})/);if(addressMatch&&!streetAddress){streetAddress=addressMatch[1];city=addressMatch[2];state=addressMatch[3];zipCode=addressMatch[4];}const phoneElements=document.querySelectorAll("a[data-qa-selector=\\"phone-number-link\\"], [data-qa-selector=\\"phone-number\\"] a, a[href^=\\"tel:\\"], .contact-info a");phoneElements.forEach(function(phoneEl){const phoneText=phoneEl.textContent.trim();if(phoneText.match(/\\(\\d{3}\\)\\s*\\d{3}-\\d{4}/)){phone=phoneText;return;}});let emailFound=false;const emailContainers=document.querySelectorAll(".outer-email-container, .email-address-container, .contact-info, [data-qa-selector*=\\"email\\"], .email-field, .email");emailContainers.forEach(function(emailContainer){if(!emailFound){const emailText=emailContainer.textContent.trim();const obfElement=emailContainer.querySelector(".obf");if(obfElement){const allText=emailContainer.textContent.replace(/\\s+/g," ").trim();const emailMatch=allText.match(/\\b([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,4})\\b/);if(emailMatch){email=emailMatch[1];emailFound=true;}}else{const emailMatch=emailText.match(/\\b([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,4})\\b/);if(emailMatch){email=emailMatch[1];emailFound=true;}}}});if(!emailFound){const bodyText=document.body.textContent;const emailPattern=/\\b([a-zA-Z0-9._%+-]+)\\s*@\\s*([a-zA-Z0-9.-]+)\\s*\\.\\s*([a-zA-Z]{2,4})\\b/g;let match;while((match=emailPattern.exec(bodyText))!==null){const cleanEmail=match[1]+"@"+match[2]+"."+match[3];if(cleanEmail.length>5&&cleanEmail.length<50&&cleanEmail.match(/^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,4}$/)){email=cleanEmail;emailFound=true;break;}}}const aliasElement=document.querySelector("[data-qa-selector=\\"person-aliases-mobile\\"], [data-qa-selector=\\"person-aliases-desktop\\"]");if(aliasElement){const aliasText=aliasElement.textContent.trim();if(aliasText){const aliasMatches=aliasText.split(",");aliasMatches.forEach(function(alias){const trimmedAlias=alias.trim();if(trimmedAlias&&!aliases.includes(trimmedAlias)){aliases.push(trimmedAlias);}});}}const addressSet=new Set();const carouselContainer=document.querySelector(".carousel-container");if(carouselContainer){const addressCards=carouselContainer.querySelectorAll(".address-card");addressCards.forEach(function(card){const displayView=card.querySelector(".display-address-view");if(displayView){const addressLine1=displayView.querySelector(".address-line1");const addressLine2=displayView.querySelector(".address-line2");if(addressLine1&&addressLine2){const street=addressLine1.textContent.trim();const cityStateZip=addressLine2.textContent.trim();if(street&&cityStateZip){const fullAddress=street+", "+cityStateZip;if(fullAddress.match(/\\d+.*[A-Z]{2}\\s+\\d{5}/)&&fullAddress.length>15){addressSet.add(fullAddress);}}}}});}if(addressSet.size===0){const allAddressLinks=document.querySelectorAll("a[href*=\\"/address/\\\"]");allAddressLinks.forEach(function(link){const addressContainer=link.closest(".display-address-view, .address-card");if(addressContainer){const addressLine1=addressContainer.querySelector(".address-line1");const addressLine2=addressContainer.querySelector(".address-line2");if(addressLine1&&addressLine2){const street=addressLine1.textContent.trim();const cityStateZip=addressLine2.textContent.trim();if(street&&cityStateZip){const fullAddress=street+", "+cityStateZip;if(fullAddress.match(/\\d+.*[A-Z]{2}\\s+\\d{5}/)&&fullAddress.length>15){addressSet.add(fullAddress);}}}}});}if(addressSet.size===0){const addressElements=document.querySelectorAll("a[href*=\\"/address/\\\"]");addressElements.forEach(function(element){const addressText=element.textContent.trim();if(addressText.length>20&&addressText.match(/\\d+.*,.*[A-Z]{2}\\s+\\d{5}$/)){addressSet.add(addressText);}});}const finalAddresses=Array.from(addressSet).filter(function(addr){const parts=addr.split(",");return parts.length>=2&&addr.match(/[A-Z]{2}\\s+\\d{5}$/)&&addr.length>15;});const states=new Set();const zips=new Set();if(state){states.add(state);}if(zipCode){zips.add(zipCode);}finalAddresses.forEach(function(addr){const stateMatch=addr.match(/\\b([A-Z]{2})\\s+\\d{5}/);const zipMatch=addr.match(/\\b(\\d{5})\\b/);if(stateMatch){states.add(stateMatch[1]);}if(zipMatch){zips.add(zipMatch[1]);}});if(firstName)data["名字"]=firstName;if(middleName)data["中间名"]=middleName;if(lastName)data["姓氏"]=lastName;if(age)data["年龄"]=age;if(birthDate)data["出生日期"]=birthDate;if(streetAddress)data["街道地址"]=streetAddress;if(city)data["城市"]=city;if(state)data["州"]=state;if(zipCode)data["邮编"]=zipCode;if(phone)data["电话"]=phone;if(email)data["邮箱"]=email;if(aliases.length>0)data["其他姓名"]=aliases;if(finalAddresses.length>0)data["历史地址"]=finalAddresses;if(states.size>0)data["所有州"]=Array.from(states).join(" ");if(zips.size>0)data["所有邮编"]=Array.from(zips).join(" ");return data;}catch(error){console.error("Whitepages提取过程中出错:",error);return{};}}function extractDataFromFastPeopleSearch(){try{const data={};let firstName="",middleName="",lastName="",age="",streetAddress="",city="",state="",zipCode="",phone="",email="",birthDate="";const aliases=[];const historicalAddresses=[];const fullNameElement=document.querySelector(".fullname");if(fullNameElement){const fullNameText=fullNameElement.textContent.trim();const parts=fullNameText.split(/\\s+/);if(parts.length>=3){firstName=parts[0];middleName=parts[1];lastName=parts.slice(2).join(" ");}else if(parts.length===2){firstName=parts[0];lastName=parts[1];}}if(!firstName||!lastName){const h1Element=document.querySelector("h1#details-header");if(h1Element){const nameText=h1Element.textContent.trim();const nameMatch=nameText.match(/^([A-Za-z]+)\\s+([A-Za-z]+)(?:\\s+in)?/);if(nameMatch){firstName=nameMatch[1];lastName=nameMatch[2];}}}const ageElement=document.querySelector("h2#age-header");if(ageElement){const ageMatch=ageElement.textContent.match(/Age\\s+(\\d+)/);if(ageMatch){age=ageMatch[1];}}const bodyText=document.body.textContent;const birthMatch=bodyText.match(/was born in ([A-Za-z]+) of (\\d{4})/i)||bodyText.match(/born in ([A-Za-z]+) (\\d{4})/i);if(birthMatch){birthDate=formatDate(birthMatch[2],birthMatch[1]);}const currentAddressElement=document.querySelector("#current_address_section h3 a");if(currentAddressElement){const addressHtml=currentAddressElement.innerHTML;const addressLines=addressHtml.split("<br>");if(addressLines.length>=2){streetAddress=addressLines[0].trim();const secondLine=addressLines[1].trim();const addressMatch=secondLine.match(/^(.+?)\\s+([A-Z]{2})\\s+(\\d{5})$/);if(addressMatch){city=addressMatch[1].trim();state=addressMatch[2];zipCode=addressMatch[3];}}}const phoneElements=document.querySelectorAll("#phone_number_section dl dt strong a, #phone_number_section dl dt a");if(phoneElements.length>0){phone=phoneElements[0].textContent.trim();}const emailElements=document.querySelectorAll("#email_section .detail-box-email h3");if(emailElements.length>0){email=emailElements[0].textContent.trim();}const akaElements=document.querySelectorAll("#aka-links .detail-box-email h3");akaElements.forEach(function(akaEl){const akaText=akaEl.textContent.trim();if(akaText&&!aliases.includes(akaText)){aliases.push(akaText);}});const prevAddressElements=document.querySelectorAll("#previous-addresses .detail-box-address .address-link a");prevAddressElements.forEach(function(addrEl){const addrHtml=addrEl.innerHTML.trim();if(addrHtml.length>10){const lines=addrHtml.split(/<br\\s*\\/?>/i);if(lines.length>=2){const streetAddress=lines[0].trim();const cityStateZip=lines[1].trim();const match=cityStateZip.match(/^(.+?)\\s+([A-Z]{2})\\s+(\\d{5})$/);if(match){const city=match[1].trim();const state=match[2];const zipCode=match[3];const fullAddress=streetAddress+", "+city+", "+state+" "+zipCode;historicalAddresses.push(fullAddress);}}else{const addrText=addrHtml.replace(/<br\\s*\\/?>/gi," ").replace(/\\s+/g," ").trim();historicalAddresses.push(addrText);}}});const allAddressLinks=document.querySelectorAll("a[href*=\\"/address/\\"]");const states=new Set();const zips=new Set();allAddressLinks.forEach(function(link){const href=link.getAttribute("href");const addrMatch=href.match(/-([a-z]{2})-([0-9]{5})$/);if(addrMatch){const extractedState=addrMatch[1].toUpperCase();const extractedZip=addrMatch[2];states.add(extractedState);zips.add(extractedZip);}});const faqText=document.querySelector(".faqs-container");if(faqText){const faqContent=faqText.textContent;const allZipMatches=faqContent.match(/\\b\\d{5}\\b/g);const allStateMatches=faqContent.match(/\\b[A-Z]{2}\\b/g);if(allZipMatches){allZipMatches.forEach(function(zip){zips.add(zip);});}if(allStateMatches){allStateMatches.forEach(function(st){if(st!=="US"&&st!=="FL"&&st!=="CA"){states.add(st);}});}}if(state){states.add(state);}if(zipCode){zips.add(zipCode);}if(firstName)data["名字"]=firstName;if(middleName)data["中间名"]=middleName;if(lastName)data["姓氏"]=lastName;if(age)data["年龄"]=age;if(birthDate)data["出生日期"]=birthDate;if(streetAddress)data["街道地址"]=streetAddress;if(city)data["城市"]=city;if(state)data["州"]=state;if(zipCode)data["邮编"]=zipCode;if(phone)data["电话"]=phone;if(email)data["邮箱"]=email;if(aliases.length>0)data["其他姓名"]=aliases;if(historicalAddresses.length>0)data["历史地址"]=historicalAddresses;if(states.size>0)data["所有州"]=Array.from(states).join(" ");if(zips.size>0)data["所有邮编"]=Array.from(zips).join(" ");return data;}catch(error){console.error("FastPeopleSearch提取过程中出错:",error);return{};}}',
        'function extractDataFromFastBackgroundCheck(){try{const data={};let firstName="",middleName="",lastName="",age="",streetAddress="",city="",state="",zipCode="",phone="",email="",birthDate="";const aliases=[];const historicalAddresses=[];const states=new Set();const zips=new Set();let jsonData=null;const scripts=document.querySelectorAll("script[type=\\"application/ld+json\\"]");for(let script of scripts){try{const json=JSON.parse(script.textContent);if(json["@type"]==="ItemPage"&&json.mainEntity&&json.mainEntity["@type"]==="Person"){jsonData=json.mainEntity;break;}else if(json["@type"]==="Person"){jsonData=json;break;}}catch(e){continue;}}if(jsonData){if(jsonData.givenName)firstName=jsonData.givenName;if(jsonData.familyName)lastName=jsonData.familyName;if(jsonData.name){const fullName=jsonData.name;const nameParts=fullName.split(/\\s+/);if(nameParts.length>=3&&!firstName){firstName=nameParts[0];middleName=nameParts.slice(1,-1).join(" ");lastName=nameParts[nameParts.length-1];}else if(nameParts.length>=3&&firstName&&!middleName){const fullNameParts=fullName.split(/\\s+/);if(fullNameParts.length>=3){middleName=fullNameParts[1];}}}if(jsonData.alternateName&&Array.isArray(jsonData.alternateName)){jsonData.alternateName.forEach(function(alias){if(alias&&!aliases.includes(alias)){aliases.push(alias);}});}if(jsonData.homeLocation&&Array.isArray(jsonData.homeLocation)){jsonData.homeLocation.forEach(function(location,index){if(location.address){const addr=location.address;let fullAddr="";if(addr.streetAddress)fullAddr+=addr.streetAddress;if(addr.addressLocality){if(fullAddr)fullAddr+=", ";fullAddr+=addr.addressLocality;}if(addr.addressRegion){if(fullAddr)fullAddr+=", ";fullAddr+=addr.addressRegion;states.add(addr.addressRegion);}if(addr.postalCode){if(fullAddr)fullAddr+=" ";fullAddr+=addr.postalCode;zips.add(addr.postalCode);}if(index===0){if(addr.streetAddress)streetAddress=addr.streetAddress;if(addr.addressLocality)city=addr.addressLocality;if(addr.addressRegion)state=addr.addressRegion;if(addr.postalCode)zipCode=addr.postalCode;}if(fullAddr&&index>0){historicalAddresses.push(fullAddr);}}});}if(jsonData.telephone&&Array.isArray(jsonData.telephone)&&jsonData.telephone.length>0){phone=jsonData.telephone[0];}if(jsonData.email&&Array.isArray(jsonData.email)&&jsonData.email.length>0){email=jsonData.email[0];}}if(!firstName||!lastName){const h1Element=document.querySelector("h1");if(h1Element){const h1Text=h1Element.textContent.trim();const nameParts=h1Text.split(/\\s+/);if(nameParts.length>=2){if(!firstName)firstName=nameParts[0];if(!lastName)lastName=nameParts[nameParts.length-1];if(nameParts.length>=3&&!middleName){middleName=nameParts.slice(1,-1).join(" ");}}}}if(!age){const ageElements=document.querySelectorAll("*");for(let el of ageElements){const text=el.textContent;if(text.includes("Age")){const ageMatch=text.match(/Age[:\\s]+(\\d+)/i);if(ageMatch){age=ageMatch[1];break;}}}}if(!birthDate){const bodyText=document.body.textContent;const birthMatch=bodyText.match(/Born[:\\s]+([A-Za-z]+)\\s+(\\d{4})/i)||bodyText.match(/born in ([A-Za-z]+) of (\\d{4})/i);if(birthMatch){birthDate=formatDate(birthMatch[2],birthMatch[1]);}}if(!phone){const phoneElements=document.querySelectorAll("a[href^=\\"tel:\\"], *");phoneElements.forEach(function(el){const text=el.textContent;const phoneMatch=text.match(/\\((\\d{3})\\)\\s*(\\d{3})-(\\d{4})/);if(phoneMatch&&!phone){phone="("+phoneMatch[1]+") "+phoneMatch[2]+"-"+phoneMatch[3];}});}if(!email){const emailElements=document.querySelectorAll("*");for(let el of emailElements){const text=el.textContent;const emailMatch=text.match(/\\b([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,4})\\b/);if(emailMatch){email=emailMatch[1];break;}}}if(!streetAddress){const addressSections=document.querySelectorAll("*");for(let section of addressSections){const text=section.textContent;if(text.includes("Current Address")||text.includes("current-address")||text.includes("5700 Green Hill Ct")){const parent=section.parentElement||section;const addressMatch=parent.textContent.match(/(\\d+[^,]+),\\s*([^,]+),\\s*([A-Z]{2})\\s+(\\d{5})/);if(addressMatch){streetAddress=addressMatch[1];city=addressMatch[2];state=addressMatch[3];zipCode=addressMatch[4];states.add(state);zips.add(zipCode);break;}}}}console.log("开始提取历史地址...");const addressSection=document.querySelector("#person-address-section");console.log("找到地址section:",addressSection);if(addressSection){const addressItems=addressSection.querySelectorAll("li");console.log("找到地址项目数量:",addressItems.length);addressItems.forEach(function(item,index){console.log("处理地址项目",index+1);const link=item.querySelector("a");if(link){const linkHTML=link.innerHTML.trim();console.log("原始HTML:",linkHTML);const lines=linkHTML.split("<br>").map(function(line){return line.trim();}).filter(function(line){return line;});console.log("分割后的行:",lines);if(lines.length>=2){const street=lines[0];const cityStateZip=lines[1];console.log("街道:",street,"城市州邮编:",cityStateZip);const match=cityStateZip.match(/^(.+?),\\s*([A-Z]{2})\\s+(\\d{5})$/);if(match){const cityName=match[1];const stateName=match[2];const zipName=match[3];const fullAddr=street+", "+cityName+", "+stateName+" "+zipName;const isCurrentAddress=item.textContent.includes("Current Address");console.log("完整地址:",fullAddr,"是否当前地址:",isCurrentAddress);if(!isCurrentAddress&&!historicalAddresses.includes(fullAddr)){historicalAddresses.push(fullAddr);states.add(stateName);zips.add(zipName);console.log("添加历史地址:",fullAddr);}else if(isCurrentAddress&&!streetAddress){streetAddress=street;city=cityName;state=stateName;zipCode=zipName;states.add(stateName);zips.add(zipName);console.log("设置当前地址:",fullAddr);}}else{console.log("正则匹配失败:",cityStateZip);}}else{console.log("行数不足:",lines.length);}}else{console.log("未找到链接");}})}else{console.log("备用方案：查找所有地址链接");const allAddressLinks=document.querySelectorAll("a[href*=\\"/address/\\\"]");console.log("找到地址链接数量:",allAddressLinks.length);allAddressLinks.forEach(function(link,index){if(index<15){const linkHTML=link.innerHTML.trim();const lines=linkHTML.split("<br>").map(function(line){return line.trim();}).filter(function(line){return line;});if(lines.length>=2){const street=lines[0];const cityStateZip=lines[1];const match=cityStateZip.match(/^(.+?),\\s*([A-Z]{2})\\s+(\\d{5})$/);if(match){const cityName=match[1];const stateName=match[2];const zipName=match[3];const fullAddr=street+", "+cityName+", "+stateName+" "+zipName;const parentText=link.parentElement?link.parentElement.textContent:"";const isCurrentAddress=parentText.includes("Current Address");if(!isCurrentAddress&&!historicalAddresses.includes(fullAddr)){historicalAddresses.push(fullAddr);states.add(stateName);zips.add(zipName);console.log("备用方案添加:",fullAddr);}}}}})}console.log("最终历史地址数量:",historicalAddresses.length,historicalAddresses);if(aliases.length===0){const akaSection=document.querySelector("#person-aka-section");if(akaSection){const akaItems=akaSection.querySelectorAll("ol li");akaItems.forEach(function(item){const alias=item.textContent.trim();if(alias&&!aliases.includes(alias)){aliases.push(alias);}});}}if(firstName)data["名字"]=firstName;if(middleName)data["中间名"]=middleName;if(lastName)data["姓氏"]=lastName;if(age)data["年龄"]=age;if(birthDate)data["出生日期"]=birthDate;if(streetAddress)data["街道地址"]=streetAddress;if(city)data["城市"]=city;if(state)data["州"]=state;if(zipCode)data["邮编"]=zipCode;if(phone)data["电话"]=phone;if(email)data["邮箱"]=email;if(aliases.length>0)data["其他姓名"]=aliases;if(historicalAddresses.length>0)data["历史地址"]=historicalAddresses;if(states.size>0)data["所有州"]=Array.from(states).join(" ");if(zips.size>0)data["所有邮编"]=Array.from(zips).join(" ");return data;}catch(error){console.error("FastBackgroundCheck提取过程中出错:",error);return{};}}',
        'function extractData(){let data={};if(window.location.hostname.includes("whitepages.com")||document.querySelector(".big-name")||document.querySelector("[data-qa-selector=\\"big-name-in-header\\"]")){data=extractDataFromWhitepages();}else if(window.location.hostname.includes("fastpeoplesearch.com")||document.querySelector("#details-header")||document.querySelector(".detail-box")){data=extractDataFromFastPeopleSearch();}else if(window.location.hostname.includes("fastbackgroundcheck.com")&&!window.location.hostname.includes("truepeoplesearch.com")&&(document.querySelector("script[type=\\"application/ld+json\\"]")&&document.body.textContent.includes("Age")&&document.body.textContent.includes("Current Address"))){data=extractDataFromFastBackgroundCheck();}else if(document.querySelector(".sc-text.sc-text-xl.sc-text-font-weight-bold")||document.querySelector(".sc-report-summary__highlights")){data=extractDataFromPublicDataCheck();}else if(document.querySelector("h1.oh1")||document.querySelector("[itemprop=\\"streetAddress\\"]")||window.location.hostname.includes("truepeoplesearch.com")){data=extractDataFromOtherSite();}return data;}',
        'const extractedData=extractData();if(Object.keys(extractedData).length>0){if(window.location.hostname.includes("whitepages.com")||window.location.hostname.includes("fastpeoplesearch.com")||window.location.hostname.includes("fastbackgroundcheck.com")){createGrid(extractedData);}else{extractAddresses().then(function(addresses){extractedData.历史地址=addresses;createGrid(extractedData);});}}else{alert("未找到数据或页面结构不匹配");}',
        '})();'
    ];

    // 合并代码
    const fullJsCode = jsCodeParts.join('');
    
    // 生成可拖拽的书签链接
    generateBookmarkLink(fullJsCode);
    
    // 显示JavaScript代码
    displayJavaScriptCode(fullJsCode);
}

// 生成可拖拽的书签链接
function generateBookmarkLink(jsCode) {
    const bookmarkContainer = document.getElementById('bookmarkContainer');
    if (!bookmarkContainer) return;
    
    // 清空容器
    bookmarkContainer.innerHTML = '';
    
    // 创建书签链接
    const bookmarkLink = document.createElement('a');
    bookmarkLink.href = jsCode;
    bookmarkLink.className = 'bookmark-link';
    bookmarkLink.title = '拖拽到书签栏使用';
            bookmarkLink.textContent = '📚 提取个人信息工具 10.1.6';
    bookmarkLink.draggable = true;
    
    // 添加拖拽样式
    bookmarkLink.style.cssText = `
        display: inline-block;
        background: linear-gradient(135deg, #4CAF50, #45a049);
        color: white;
        padding: 12px 20px;
        text-decoration: none;
        border-radius: 8px;
        font-size: 14px;
        font-weight: 600;
        margin: 10px 0;
        border: 2px solid #45a049;
        transition: all 0.3s ease;
        cursor: grab;
        box-shadow: 0 2px 8px rgba(76, 175, 80, 0.3);
        user-select: none;
    `;
    
    // 添加悬停效果
    bookmarkLink.addEventListener('mouseenter', function() {
        this.style.transform = 'translateY(-2px)';
        this.style.boxShadow = '0 4px 12px rgba(76, 175, 80, 0.4)';
    });
    
    bookmarkLink.addEventListener('mouseleave', function() {
        this.style.transform = 'translateY(0)';
        this.style.boxShadow = '0 2px 8px rgba(76, 175, 80, 0.3)';
    });
    
    bookmarkLink.addEventListener('mousedown', function() {
        this.style.cursor = 'grabbing';
    });
    
    bookmarkLink.addEventListener('mouseup', function() {
        this.style.cursor = 'grab';
    });
    
    bookmarkContainer.appendChild(bookmarkLink);
}

// 显示JavaScript代码
function displayJavaScriptCode(jsCode) {
    const jsCodeDisplay = document.getElementById('jsCodeDisplay');
    if (!jsCodeDisplay) return;
    
    jsCodeDisplay.textContent = jsCode;
    jsCodeDisplay.style.cssText = `
        background: #f8f9fa;
        border: 1px solid #e9ecef;
        border-radius: 6px;
        padding: 12px;
        font-family: 'Courier New', monospace;
        font-size: 11px;
        overflow-x: auto;
        white-space: pre-wrap;
        word-break: break-all;
        max-height: 200px;
        overflow-y: auto;
        margin-bottom: 10px;
        line-height: 1.4;
    `;
}

// 复制书签代码到剪贴板
function copyBookmarkCode() {
    const jsCodeDisplay = document.getElementById('jsCodeDisplay');
    const copyCodeBtn = document.getElementById('copyCodeBtn');
    
    if (!jsCodeDisplay || !copyCodeBtn) return;
    
    const codeText = jsCodeDisplay.textContent;
    
    // 使用现代剪贴板API
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(codeText).then(() => {
            // 成功复制的视觉反馈
            const originalText = copyCodeBtn.innerHTML;
            copyCodeBtn.innerHTML = '<span class="copy-icon">✅</span>已复制';
            copyCodeBtn.style.background = 'linear-gradient(to right, var(--success-500), #059669)';
            
            setTimeout(() => {
                copyCodeBtn.innerHTML = originalText;
                copyCodeBtn.style.background = '';
            }, 2000);
            
            showTrayNotification('书签代码已复制到剪贴板', 'success');
        }).catch(err => {
            console.error('复制失败:', err);
            fallbackCopyToClipboard(codeText, copyCodeBtn);
        });
    } else {
        // 降级方案
        fallbackCopyToClipboard(codeText, copyCodeBtn);
    }
}

// 降级复制方案
function fallbackCopyToClipboard(text, button) {
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.left = '-999999px';
    textArea.style.top = '-999999px';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();
    
    try {
        const successful = document.execCommand('copy');
        if (successful) {
            const originalText = button.innerHTML;
            button.innerHTML = '<span class="copy-icon">✅</span>已复制';
            button.style.background = 'linear-gradient(to right, var(--success-500), #059669)';
            
            setTimeout(() => {
                button.innerHTML = originalText;
                button.style.background = '';
            }, 2000);
            
            showTrayNotification('书签代码已复制到剪贴板', 'success');
        } else {
            throw new Error('复制命令失败');
        }
    } catch (err) {
        console.error('降级复制也失败:', err);
        showTrayNotification('复制失败，请手动选择代码复制', 'error');
    }
    
    document.body.removeChild(textArea);
}

// 清空高级查询表单
function clearAdvancedForm() {
    console.log('清空高级查询表单');
    
    // 清空所有输入字段
    const formInputs = document.querySelectorAll('#advanced-query-panel input');
    formInputs.forEach(input => {
        input.value = '';
    });
    
    // 清空结果区域
    if (searchResults) {
        searchResults.innerHTML = '';
    }
    
    // 重置状态和进度条
    updateAdvancedProgress(0);
    updateAdvancedStatus('表单已清空，请填写查询条件');
    
    // 显示清空成功提示
    showTrayNotification('高级查询表单已清空');
}

// 处理高级查询
async function handleAdvancedSearch() {
    console.log('handleAdvancedSearch 被调用');
    
    // 重置全局取消标志
    globalShouldStop = false;
    console.log('重置 globalShouldStop = false');
    
    // 重置页面级取消信号
    await setPageLevelCancelSignal(false);
    
    // 【新增】重置页面状态检查标记，确保新查询会重新检查页面状态
    if (window.QueryExecutor) {
        window.QueryExecutor.resetPageStateCheck();
        console.log('已重置页面状态检查标记');
    }
    
    try {
        const advancedSearchBtn = document.getElementById('advancedSearch');

        // 【步骤调整1】立即获取和验证表单数据
        const firstName = document.getElementById('adv-firstName').value.trim();
        const lastName = document.getElementById('adv-lastName').value.trim();
        const dob = document.getElementById('adv-dob').value.trim();
        const ssn = document.getElementById('adv-ssn').value.trim();
        const address = document.getElementById('adv-address').value.trim();
        const city = document.getElementById('adv-city').value.trim();
        const state = document.getElementById('adv-state').value.trim();
        const zipCode = document.getElementById('adv-zip').value.trim();
        const phone = document.getElementById('adv-phone').value.trim();
        const email = document.getElementById('adv-email').value.trim();

        // 验证至少填写了一个字段
        if (!firstName && !lastName && !dob && !ssn && !address && !city && !state && !zipCode && !phone && !email) {
            updateAdvancedStatus('请至少填写一个查询条件');
            return;
        }

        // 【步骤调整2】立即设置查询状态和UI
        isQuerying = true;
        if (browserManager.setQueryingStatus) {
            browserManager.setQueryingStatus(true);
        }
        advancedSearchBtn.textContent = '取消查询';
        advancedSearchBtn.classList.add('cancel-mode');

        // 清空之前的结果
        searchResults.innerHTML = '';
        
        // 显示查询中的动画
        showSearchingAnimation();

        // 显示结果统计区域（包含数据库总数）
        const resultStatsElement = document.getElementById('resultStats');
        if (resultStatsElement) {
            resultStatsElement.style.display = 'flex';
        }

        // 重置进度条
        updateAdvancedProgress(0);
        updateAdvancedStatus('正在准备高级查询...');

        // 清空上次的结果
        searchCompleted = false;

        // 【步骤调整3】立即执行核心查询，跳过网络测试和性能监控
        console.log('[高级查询进度] 开始核心查询流程，设置进度为10%');
        updateAdvancedProgress(10);
        
        // 确保浏览器已初始化（这是查询的必要条件）
        if (!browserManager.browser) {
            console.log('浏览器未初始化，正在重新初始化...');
            await browserManager.initBrowser();
        }
        
        // 检查登录状态（这是查询的必要条件）
        console.log('[高级查询进度] 检查登录状态，设置进度为20%');
        updateAdvancedProgress(20);
        
        if (!browserManager.isLoggedIn) {
            console.log('登录状态已失效，需要重新登录');
            const firstPage = await browserManager.getAvailablePage();
            await browserManager.ensureLoggedIn(firstPage, async (page) => {
                await queryExecutor.performLogin(page);
            });
            browserManager.releasePage(firstPage);
            
            console.log('[高级查询进度] 登录完成，设置进度为25%');
            updateAdvancedProgress(25);
        } else {
            console.log('登录状态有效，继续执行高级查询');
        }

        // 设置并发数到全局变量，用于系统状态显示
        window.currentConcurrentCount = 1; // 高级查询只使用一个并发
        document.getElementById('parallelCount').textContent = 1;
        
        // 再次检查是否被取消
        if (globalShouldStop) {
            updateAdvancedStatus('查询已取消');
            return;
        }
        
        // 【步骤调整4】立即执行高级查询
        updateAdvancedStatus('正在执行高级查询...');
        console.log('[高级查询进度] 开始执行查询，设置进度为30%');
        updateAdvancedProgress(30);
        
        // 执行高级查询
        const searchParams = {
            firstName,
            lastName,
            dob,
            ssn,
            address,
            city,
            state,
            zipCode,
            phone,
            email
        };
        
        let results = [];
        try {
            // 执行高级查询，传入进度回调
            console.log('[高级查询进度] 正在连接服务器，设置进度为40%');
            updateAdvancedProgress(40);
            
            // 启动模拟进度更新（从40%慢慢增加到85%）
            let currentSimulatedProgress = 40;
            let realProgressReceived = false;
            const progressSimulationInterval = setInterval(() => {
                if (!realProgressReceived && currentSimulatedProgress < 85) {
                    currentSimulatedProgress += 2;
                    console.log(`[高级查询模拟进度] 更新进度为${currentSimulatedProgress}%`);
                    updateAdvancedProgress(currentSimulatedProgress);
                }
            }, 400); // 每400ms增加2%
            
            // 创建进度回调函数
            const progressCallback = (currentPage, totalPages) => {
                if (totalPages > 0) {
                    realProgressReceived = true;
                    clearInterval(progressSimulationInterval);
                    
                    // 40%~95%的进度分配给分页查询
                    const baseProgress = 40;
                    const maxProgress = 95;
                    const pageProgress = ((currentPage / totalPages) * (maxProgress - baseProgress));
                    const finalProgress = Math.min(baseProgress + pageProgress, maxProgress);
                    console.log(`[高级查询进度] 正在处理第${currentPage}/${totalPages}页，设置进度为${Math.round(finalProgress)}%`);
                    updateAdvancedProgress(Math.round(finalProgress));
                }
            };
            
            results = await queryExecutor.executeAdvancedQuery(browserManager, searchParams, progressCallback);
            
            // 查询完成，清除模拟进度定时器
            clearInterval(progressSimulationInterval);
            
            console.log('[高级查询进度] 查询完成，设置进度为95%');
            updateAdvancedProgress(95);
            
            // 检查结果是否有效
            if (!results) {
                console.warn('高级查询返回了无效结果');
                results = []; // 确保结果是数组
            }
        } catch (queryError) {
            console.error('执行高级查询时出错:', queryError);
            updateAdvancedStatus(`查询出错: ${queryError.message}`);
            // 确保清除模拟进度定时器
            if (typeof progressSimulationInterval !== 'undefined') {
                clearInterval(progressSimulationInterval);
            }
            results = []; // 确保结果是数组
        }
        
        // 检查是否被取消
        if (window.globalShouldStop) {
            updateAdvancedStatus('查询已取消');
            updateAdvancedProgress(0);
            return;
        }
        
        // 更新进度
        console.log('[高级查询进度] 数据处理完成，设置进度为100%');
        updateAdvancedProgress(100);
        
        // 标记查询完成状态
        searchCompleted = true;
        updateAdvancedStatus(`查询成功：找到 ${results.length} 条记录`);
        
        // 【步骤调整5】立即处理和显示结果
        let processedResults = [];
        try {
            // 确保结果是数组并且每个项目都有效
            if (Array.isArray(results)) {
                processedResults = results
                    .filter(result => result !== null && result !== undefined) // 过滤掉无效结果
                    .map(result => {
                        try {
                            // 安全获取属性
                            const firstName = result.firstName || '';
                            const middleName = result.middleName || '';
                            const lastName = result.lastName || '';
                            
                            // 构建全名，包含中间名（如果有）
                            const middleNamePart = middleName ? ` ${middleName} ` : ' ';
                            const fullName = `${firstName}${middleNamePart}${lastName}`;
                            
                            // 检查 birthDate 是否存在
                            const isDateMatch = window.birthDate && result.dob ? 
                                utils.isDateMatch(result.dob, window.birthDate) : false;
                            
                            return {
                                ...result,
                                fullName,
                                isDateMatch
                            };
                        } catch (itemError) {
                            console.error('处理结果项时出错:', itemError);
                            // 返回带有错误标记的结果项
                            return {
                                ...result,
                                fullName: result.firstName ? `${result.firstName} ${result.lastName || ''}` : '数据错误',
                                isDateMatch: false,
                                hasError: true
                            };
                        }
                    });
            } else {
                console.error('高级查询结果不是数组:', results);
            }
        } catch (processError) {
            console.error('处理高级查询结果时出错:', processError);
        }
        
        // 显示结果
        displayResults(processedResults, true);

        // 【步骤调整6】将性能监控和网络测试移到后台异步执行
        // 启动实时数据监控和数据库统计更新
        startRealTimeDataMonitoring();
        updateTotalDataCount().catch(error => {
            console.error('高级查询完成后更新数据库统计失败:', error);
        });

        // 不等待后台优化任务完成
        backgroundOptimizationTasks().catch(error => {
            console.log('高级查询后台优化任务失败，但不影响查询结果:', error.message);
        });
        
        // [事件触发] 高级查询后主动刷新页面 - 只有在未取消的情况下才刷新
        if (!globalShouldStop && browserManager.autoRefreshPage) {
            console.log('[事件触发] 高级查询后主动刷新页面');
            try {
                // 检查方法是否存在
                if (typeof browserManager.refreshAndPrepareAdvancedSearchPage === 'function') {
                    await browserManager.refreshAndPrepareAdvancedSearchPage(browserManager.autoRefreshPage);
                    console.log('[事件触发] 页面刷新与准备完成');
                } else {
                    console.error('[事件触发] refreshAndPrepareAdvancedSearchPage 方法不存在');
                }
            } catch (error) {
                console.error('[事件触发] 页面刷新失败:', error.message);
            }
        } else if (globalShouldStop) {
            console.log('[事件触发] 高级查询已取消，跳过页面刷新');
        } else {
            console.log('[事件触发] 高级查询后未找到autoRefreshPage，未刷新');
        }
        
    } catch (error) {
        console.error('高级查询错误:', error);
        // 添加更详细的错误日志，包括错误堆栈
        console.error('错误详情:', {
            message: error.message,
            stack: error.stack,
            name: error.name,
            time: new Date().toISOString()
        });
        
        // 根据错误类型提供更具体的用户提示
        let errorMessage = `高级查询出错: ${error.message}`;
        if (error.message.includes('timeout')) {
            errorMessage = '查询超时，请检查网络连接后重试';
        } else if (error.message.includes('navigation')) {
            errorMessage = '页面导航错误，请检查网络连接后重试';
        }
        
        updateAdvancedStatus(errorMessage);
        updateAdvancedProgress(0);
    } finally {
        console.log('🔧 高级查询完成，开始清理状态和动画...');
        
        // 停止实时数据监控
        stopRealTimeDataMonitoring();
        
        clearSearchAnimations();
        
        // 重置查询状态
        console.log('高级查询设置 isQuerying 为 false');
        isQuerying = false;
        if (browserManager.setQueryingStatus) {
            browserManager.setQueryingStatus(false);
        }
        
        // 重置按钮状态
        const advancedSearchBtn = document.getElementById('advancedSearch');
        if (advancedSearchBtn) {
            advancedSearchBtn.textContent = '开始查询';
            advancedSearchBtn.classList.remove('cancel-mode');
        }
        
        // 确保在查询结束时重置取消标志
        if (globalShouldStop) {
            globalShouldStop = false;
            console.log('高级查询结束，重置 globalShouldStop = false');
            // 同时重置页面级取消信号
            try {
                await setPageLevelCancelSignal(false);
            } catch (error) {
                console.error('重置页面级取消信号失败:', error);
            }
        }
        
        console.log('✅ 高级查询状态和动画清理完成');
    }
}

// 更新高级查询进度条
function updateAdvancedProgress(percent) {
    console.log(`[高级查询进度] 更新进度: ${percent}%`);
    
    // 更新左侧进度条
    if (advancedProgressBar) {
        // 添加动画类
        advancedProgressBar.classList.add('animated');
        
        // 设置进度
        advancedProgressBar.style.width = `${percent}%`;
        
        // 当进度为0时隐藏进度条，否则显示
        advancedProgressBar.parentElement.style.display = percent === 0 ? 'none' : 'block';
        
        // 如果有进度图标，更新其位置和动画
        let progressIcon = advancedProgressBar.parentElement.querySelector('.progress-icon');
        if (!progressIcon && percent > 0) {
            progressIcon = document.createElement('div');
            progressIcon.className = 'progress-icon';
            advancedProgressBar.parentElement.appendChild(progressIcon);
        }
        
        if (progressIcon) {
            if (percent <= 0 || percent >= 100) {
                progressIcon.style.display = 'none';
            } else {
                progressIcon.style.display = 'block';
                progressIcon.style.animation = `move-with-progress ${(100 - percent) * 0.1}s linear`;
                progressIcon.style.left = `${percent}%`;
            }
        }
        
        // 进度完成时移除动画类
        if (percent >= 100) {
            setTimeout(() => {
                advancedProgressBar.classList.remove('animated');
                if (progressIcon) {
                    progressIcon.remove();
                }
            }, 500);
        }
    }
    
    // 更新右侧查询动画中的进度圆环
    updateQueryAnimationProgress(percent);
}

// 更新高级查询状态显示
function updateAdvancedStatus(message) {
    if (advancedSearchStatus) {
        advancedSearchStatus.textContent = message;
        advancedSearchStatus.style.display = message ? 'block' : 'none';
    }
}

// 显示搜索结果 - 扩展以支持高级查询结果
function displayResults(results, isAdvancedSearch = false) {
    console.log('🎯 开始显示结果，结果数量:', results?.length || 0);
    
    // 🚨 关键修复：无论有无结果，都要先清除搜索动画
    clearSearchAnimations();
    
    // 清空之前的结果
    searchResults.innerHTML = '';
    
    // 确保 results 是有效的数组
    if (!results || !Array.isArray(results) || results.length === 0) {
        console.log('📋 显示结果: 无结果或结果无效', { results });
        
        // 🎨 显示美观的无结果页面
        const noResultsDiv = document.createElement('div');
        noResultsDiv.className = 'no-results';
        noResultsDiv.innerHTML = `
            <div class="no-results-animation">
                <div class="no-results-icon">🔍</div>
                <div class="search-waves">
                    <div class="wave wave-1"></div>
                    <div class="wave wave-2"></div>
                    <div class="wave wave-3"></div>
                </div>
            </div>
            <div class="no-results-content">
                <h3 class="no-results-title">未找到匹配结果</h3>
                <p class="no-results-message">请尝试以下操作：</p>
                <ul class="no-results-suggestions">
                    <li>✓ 检查姓名和地址的拼写是否正确</li>
                    <li>✓ 尝试使用不同的地址格式</li>
                    <li>✓ 减少查询条件，使用更通用的信息</li>
                    <li>✓ 确认出生日期格式正确</li>
                </ul>
                <div class="no-results-tips">
                    <span class="tips-icon">💡</span>
                    <span>建议输入多个地址以提高匹配成功率</span>
                </div>
            </div>
        `;
        searchResults.appendChild(noResultsDiv);
        
        // 更新结果计数器为0
        const resultCountElement = document.getElementById('resultCount');
        if (resultCountElement) {
            resultCountElement.textContent = '0';
        }
        
        // 显示结果统计区域
        const resultStatsElement = document.getElementById('resultStats');
        if (resultStatsElement) {
            resultStatsElement.style.display = 'flex';
        }
        
        console.log('✅ 美观的无结果页面显示完成，动画已清除');
        return; // 提前返回，避免后续处理
    }
    
    try {
        if (isAdvancedSearch) {
            // 高级查询结果不分组，直接显示
            results.forEach((result, index) => {
                try {
                    // 确保每个结果对象都是有效的
                    if (!result) {
                        console.warn(`跳过无效结果对象，索引: ${index}`);
                        return; // 跳过此结果
                    }
                    
                    const resultCard = createResultCard(result, false);
                    resultCard.classList.add('animated-entry');
                    resultCard.style.animationDelay = `${Math.min(index * 0.1, 0.6)}s`;
                    searchResults.appendChild(resultCard);
                } catch (itemError) {
                    console.error(`处理结果项时出错，索引: ${index}`, itemError);
                    // 继续处理其他结果项
                }
            });
        } else {
            // 标准查询结果分组显示
            // 分组结果，确保 filter 方法在有效数组上调用
            const matchResults = Array.isArray(results) ? 
                results.filter(result => result && result.isDateMatch) : [];
                
            const otherResults = Array.isArray(results) ? 
                results.filter(result => result && !result.isDateMatch) : [];
            
            // 显示完全匹配组
            if (matchResults.length > 0) {
                // 添加完全匹配组标题
                const matchGroupTitle = document.createElement('div');
                matchGroupTitle.className = 'result-group-title match-group';
                matchGroupTitle.textContent = '完全匹配记录';
                searchResults.appendChild(matchGroupTitle);
                
                // 添加完全匹配记录
                matchResults.forEach((result, index) => {
                    try {
                        if (!result) return; // 跳过无效结果
                        
                        const resultCard = createResultCard(result, true);
                        resultCard.classList.add('animated-entry');
                        resultCard.style.animationDelay = `${Math.min(index * 0.1, 0.6)}s`;
                        searchResults.appendChild(resultCard);
                    } catch (itemError) {
                        console.error(`处理匹配结果项时出错，索引: ${index}`, itemError);
                    }
                });
            }
            
            // 显示其他匹配组
            if (otherResults.length > 0) {
                // 添加其他匹配组标题
                const otherGroupTitle = document.createElement('div');
                otherGroupTitle.className = 'result-group-title other-group';
                otherGroupTitle.textContent = '其他匹配记录';
                searchResults.appendChild(otherGroupTitle);
                
                // 添加其他匹配记录
                otherResults.forEach((result, index) => {
                    try {
                        if (!result) return; // 跳过无效结果
                        
                        const resultCard = createResultCard(result, false);
                        resultCard.classList.add('animated-entry');
                        resultCard.style.animationDelay = `${Math.min(index * 0.1, 0.6)}s`;
                        searchResults.appendChild(resultCard);
                    } catch (itemError) {
                        console.error(`处理其他结果项时出错，索引: ${index}`, itemError);
                    }
                });
            }
        }
        
        // 添加结果计数器动画
        const resultCountElement = document.getElementById('resultCount');
        if (resultCountElement) {
            resultCountElement.textContent = results.length;
            resultCountElement.classList.add('result-counter');
            
            // 移除并重新添加动画类以触发动画
            setTimeout(() => {
                resultCountElement.classList.remove('result-counter');
                void resultCountElement.offsetWidth; // 触发重绘
                resultCountElement.classList.add('result-counter');
            }, 10);
        }
        
        const resultStatsElement = document.getElementById('resultStats');
        if (resultStatsElement) {
            resultStatsElement.style.display = 'flex';
        }
    } catch (error) {
        console.error('显示查询结果时发生错误:', error);
        
        // 出错时显示错误提示
        searchResults.innerHTML = '';
        const errorDiv = document.createElement('div');
        errorDiv.className = 'error-message';
        errorDiv.textContent = '显示结果时发生错误，请重试';
        searchResults.appendChild(errorDiv);
        
        // 确保结果统计区域可见
        const resultStatsElement = document.getElementById('resultStats');
        if (resultStatsElement) {
            resultStatsElement.style.display = 'flex';
        }
        
        const resultCountElement = document.getElementById('resultCount');
        if (resultCountElement) {
            resultCountElement.textContent = '0';
        }
    }
}

// 显示查询中的骨架屏动画
function showSearchingAnimation() {
    // 清空结果区域
    searchResults.innerHTML = '';
    
    // 添加查询中指示器 - 带进度功能，圆环和文字垂直布局
    const searchingIndicator = document.createElement('div');
    searchingIndicator.className = 'searching-indicator';
    searchingIndicator.innerHTML = `
        <div class="progress-container">
            <div class="processing-icon">
                <div class="processing-circle" data-progress="0">
                    <div class="progress-fill"></div>
                    <span class="progress-text">0%</span>
                </div>
            </div>
            <span class="searching-text">正在查询中<span class="searching-dots"></span></span>
        </div>
    `;
    searchResults.appendChild(searchingIndicator);
    
    // 添加波纹效果容器
    const rippleContainer = document.createElement('div');
    rippleContainer.className = 'ripple-container';
    searchResults.appendChild(rippleContainer);
    
    // 创建多个波纹
    createRipples(rippleContainer);
    
    // 添加骨架屏
    for (let i = 0; i < 3; i++) {
        const skeletonItem = document.createElement('div');
        skeletonItem.className = 'skeleton-item';
        skeletonItem.innerHTML = `
            <div style="padding: 16px; position: relative; z-index: 1;">
                <div class="skeleton-row short"></div>
                <div class="skeleton-row medium"></div>
                <div class="skeleton-row long"></div>
                <div class="skeleton-row medium"></div>
            </div>
        `;
        searchResults.appendChild(skeletonItem);
    }
    
    // 添加数据处理动画
    const dataProcessing = document.createElement('div');
    dataProcessing.className = 'data-processing-container';
    dataProcessing.innerHTML = `
        <div class="processing-text">正在处理数据，请稍候...</div>
        <div class="processing-subtext refreshing-data">正在匹配最佳结果</div>
    `;
    searchResults.appendChild(dataProcessing);
    
    // 更新状态统计
    document.getElementById('resultStats').style.display = 'flex';
    document.getElementById('resultCount').textContent = '...';
}

// 创建波纹动画
function createRipples(container) {
    const colors = [
        'rgba(63, 140, 255, 0.1)',
        'rgba(63, 140, 255, 0.08)',
        'rgba(63, 140, 255, 0.05)'
    ];
    
    for (let i = 0; i < 3; i++) {
        const ripple = document.createElement('div');
        ripple.className = 'ripple';
        ripple.style.width = `${200 + i * 100}px`;
        ripple.style.height = `${200 + i * 100}px`;
        ripple.style.left = '50%';
        ripple.style.top = '50%';
        ripple.style.marginLeft = `-${(200 + i * 100) / 2}px`;
        ripple.style.marginTop = `-${(200 + i * 100) / 2}px`;
        ripple.style.background = colors[i];
        ripple.style.animationDelay = `${i * 0.5}s`;
        
        container.appendChild(ripple);
    }
}

// 设置无头模式切换开关
function setupHeadlessToggle() {
    const headlessToggle = document.getElementById('headlessToggle');
    const restartBrowserBtn = document.getElementById('restartBrowserBtn');
    
    // 初始化开关状态
    headlessToggle.checked = true; // 默认启用无头模式
    
    // 监听开关变化
    headlessToggle.addEventListener('change', () => {
        const isHeadless = headlessToggle.checked;
        browserManager.setHeadlessMode(isHeadless);
        console.log(`无头模式已${isHeadless ? '启用' : '禁用'}`);
        
        // 如果浏览器已启动，提示需要重启
        if (browserManager.browser) {
            updateStatus(`无头模式已${isHeadless ? '启用' : '禁用'}，需要重启浏览器才能生效`);
            showTrayNotification(`无头模式已${isHeadless ? '启用' : '禁用'}，点击"重启浏览器"按钮使更改生效`);
        }
    });
    
    // 监听重启按钮点击
    eventManager.addEventListener(restartBrowserBtn, 'click', async () => {
        updateStatus('正在重启浏览器...');
        
        try {
            // 关闭当前浏览器
            await browserManager.closeAll();
            
            // 重新初始化浏览器并登录
            await initBrowserAndLogin();
            
            updateStatus('浏览器已重启，会话已恢复');
            showTrayNotification('浏览器已重启，会话已恢复');
        } catch (error) {
            logger.error('重启浏览器失败', 'browser_restart', error);
            updateStatus(`重启浏览器失败: ${error.message}`, 'error');
        }
    });
}

// 使用异步管理器的查询处理函数
async function handleSearchWithAsyncManager() {
    const operationId = 'standard_search';
    
    try {
        await asyncManager.createCancellableOperation(operationId, async (cancellationToken) => {
            return await handleSearch(cancellationToken);
        }, 60000); // 60秒超时
    } catch (error) {
        if (error.message.includes('Operation cancelled')) {
            logger.info('标准查询被取消');
        } else {
            logger.error('标准查询失败', 'search_operation', error);
        }
    }
}

// 使用异步管理器的高级查询处理函数
async function handleAdvancedSearchWithAsyncManager() {
    const operationId = 'advanced_search';
    
    try {
        await asyncManager.createCancellableOperation(operationId, async (cancellationToken) => {
            return await handleAdvancedSearch(cancellationToken);
        }, 60000); // 60秒超时
    } catch (error) {
        if (error.message.includes('Operation cancelled')) {
            logger.info('高级查询被取消');
        } else {
            logger.error('高级查询失败', 'advanced_search_operation', error);
        }
    }
}

// 优化的取消查询函数
function cancelCurrentQueryOptimized() {
    // 使用异步管理器取消所有查询操作
    asyncManager.cancelOperation('standard_search', 'User cancelled');
    asyncManager.cancelOperation('advanced_search', 'User cancelled');
    
    // 设置全局取消标志
    globalShouldStop = true;
    
    // 重置UI状态
    resetQueryUIState();
    
    logger.info('已取消所有查询操作');
}

// 重置查询UI状态
function resetQueryUIState() {
    isQuerying = false;
    
    // 重置按钮状态
    const quickSearchBtn = document.getElementById('quickSearch');
    const advancedSearchBtn = document.getElementById('advancedSearch');
    
    if (quickSearchBtn) {
        quickSearchBtn.textContent = '开始查询';
        quickSearchBtn.classList.remove('cancel-mode');
    }
    
    if (advancedSearchBtn) {
        advancedSearchBtn.textContent = '开始查询';
        advancedSearchBtn.classList.remove('cancel-mode');
    }
    
    // 重置进度条
    updateProgress(0);
    updateAdvancedProgress(0);
}

// 优化的结果显示函数
function displayResultsOptimized(results, isAdvancedSearch = false) {
    const containerId = 'searchResults';
    const container = document.getElementById(containerId);
    
    if (!container) {
        logger.error('结果容器不存在', 'display_results');
        return;
    }
    
    try {
        // 使用DOM管理器来管理结果显示
        domManager.manageResults(container, results, (result, isDateMatch) => {
            return createResultCard(result, isDateMatch);
        });
        
        // 更新统计信息
        updateResultStats(results.length, isAdvancedSearch);
        
        logger.info(`显示结果完成: ${results.length} 条记录`);
    } catch (error) {
        logger.error('显示结果失败', 'display_results', error);
        
        // 显示错误信息
        container.innerHTML = `
            <div class="error-message">
                <h3>显示结果时出错</h3>
                <p>请刷新页面后重试</p>
            </div>
        `;
    }
}

// 实时数据监控相关变量
let realTimeDataMonitorInterval = null;
let lastKnownDataCount = null;

// 启动实时数据监控
function startRealTimeDataMonitoring() {
    // 如果已有监控，先停止
    if (realTimeDataMonitorInterval) {
        clearInterval(realTimeDataMonitorInterval);
        realTimeDataMonitorInterval = null;
    }
    
    console.log('🔄 启动实时数据监控，每1秒检查一次数据变化');
    
    // 在状态栏显示监控状态
    const resultStatsElement = document.getElementById('resultStats');
    if (resultStatsElement) {
        resultStatsElement.style.display = 'flex';
        // 给统计区域添加一个小的监控指示器
        const totalDataCountElement = document.getElementById('totalDataCount');
        if (totalDataCountElement && !totalDataCountElement.getAttribute('data-monitoring')) {
            totalDataCountElement.setAttribute('data-monitoring', 'true');
            totalDataCountElement.style.position = 'relative';
            
            // 不再显示转圈圈的监控指示器，仅记录监控状态
        }
    }
    
    realTimeDataMonitorInterval = setInterval(async () => {
        try {
            // 如果查询已经完成或被取消，停止监控
            if (searchCompleted || globalShouldStop) {
                console.log('📊 查询状态变化，停止实时数据监控');
                stopRealTimeDataMonitoring();
                return;
            }
            
            // 获取一个可用的页面来检查数据统计
            let page = null;
            if (browserManager && browserManager.mainPage && !browserManager.mainPage.isClosed()) {
                page = browserManager.mainPage;
            } else if (browserManager && browserManager.browser) {
                try {
                    page = await browserManager.getAvailablePage();
                } catch (error) {
                    console.error('实时监控获取页面失败:', error);
                    return;
                }
            }
            
            if (page) {
                const dataStats = await browserManager.getDataStats(page);
                
                if (dataStats && dataStats.found) {
                    // 检查数据是否有变化
                    if (lastKnownDataCount !== dataStats.totalCount) {
                        console.log(`📊 检测到数据变化: ${lastKnownDataCount} → ${dataStats.totalCount}`);
                        lastKnownDataCount = dataStats.totalCount;
                        
                        // 立即更新前端显示
                        const totalDataCountElement = document.getElementById('totalDataCount');
                        if (totalDataCountElement && dataStats) {
                            const formattedCount = dataStats.formattedCount || dataStats.totalCount.toLocaleString();
                            totalDataCountElement.textContent = `${formattedCount}条`;
                            
                            // 根据数据类型设置颜色
                            if (dataStats.isFiltered) {
                                totalDataCountElement.style.color = '#059669'; // 绿色表示筛选结果
                                totalDataCountElement.title = `筛选结果：共${formattedCount}条数据`;
                            } else {
                                totalDataCountElement.style.color = '#2563eb'; // 蓝色表示全部数据
                                totalDataCountElement.title = `数据库总量：共${formattedCount}条数据`;
                            }
                            
                            console.log(`✅ 实时更新数据统计: ${formattedCount}条 (${dataStats.status})`);
                        }
                    }
                }
                
                // 如果是从browserManager获取的临时页面，释放它
                if (page !== browserManager.mainPage) {
                    browserManager.releasePage(page);
                }
            }
        } catch (error) {
            console.error('实时数据监控出错:', error);
        }
            }, 1000); // 每1秒检查一次
}

// 停止实时数据监控
function stopRealTimeDataMonitoring() {
    if (realTimeDataMonitorInterval) {
        console.log('⏹️ 停止实时数据监控');
        clearInterval(realTimeDataMonitorInterval);
        realTimeDataMonitorInterval = null;
        lastKnownDataCount = null;
        
        // 清除监控状态标记
        const totalDataCountElement = document.getElementById('totalDataCount');
        if (totalDataCountElement) {
            totalDataCountElement.removeAttribute('data-monitoring');
        }
    }
}

// 更新数据库总数据量显示
async function updateTotalDataCount() {
    const totalDataCountElement = document.getElementById('totalDataCount');
    
    if (!totalDataCountElement) {
        return;
    }
    
    // 显示加载状态
    totalDataCountElement.textContent = '获取中...';
    totalDataCountElement.style.color = '#94a3b8';
    
    try {
        // 获取一个可用的页面来查询数据统计
        let page = null;
        if (browserManager && browserManager.mainPage && !browserManager.mainPage.isClosed()) {
            page = browserManager.mainPage;
        } else if (browserManager && browserManager.getAvailablePage) {
            page = await browserManager.getAvailablePage();
        }
        
        if (page) {
            const dataStats = await browserManager.getDataStats(page);
            
            if (dataStats && dataStats.found) {
                // 使用格式化后的数字显示
                const formattedCount = dataStats.formattedCount || dataStats.totalCount.toLocaleString();
                totalDataCountElement.textContent = `${formattedCount}条`;
                
                // 更新已知数据量（用于实时监控对比）
                lastKnownDataCount = dataStats.totalCount;
                
                                         // 根据数据类型设置不同颜色
                if (dataStats.isFiltered) {
                    totalDataCountElement.style.color = '#059669'; // 绿色表示筛选结果
                    totalDataCountElement.title = `筛选结果：共${formattedCount}条数据（实时监控中）`;
                } else {
                    totalDataCountElement.style.color = '#2563eb'; // 蓝色表示全部数据
                    totalDataCountElement.title = `数据库总量：共${formattedCount}条数据（实时监控中）`;
                }
                
                console.log(`✅ 数据统计更新成功: ${formattedCount}条 (${dataStats.status})`);
            } else {
                totalDataCountElement.textContent = '暂无数据';
                totalDataCountElement.style.color = '#f59e0b';
                lastKnownDataCount = 0;
                console.log('⚠️ 未能获取数据库统计信息');
            }
            
            // 如果是临时获取的页面，释放它
            if (browserManager.releasePage && page !== browserManager.mainPage) {
                browserManager.releasePage(page);
            }
        } else {
            totalDataCountElement.textContent = '未连接';
            totalDataCountElement.style.color = '#ef4444';
            console.log('⚠️ 无可用页面获取数据库统计');
        }
    } catch (error) {
        console.error('更新数据库总数失败:', error.message);
        totalDataCountElement.textContent = '获取失败';
        totalDataCountElement.style.color = '#ef4444';
    }
}

// 更新结果统计
function updateResultStats(count, isAdvanced = false) {
    const resultStatsElement = document.getElementById('resultStats');
    const resultCountElement = document.getElementById('resultCount');
    
    if (resultStatsElement) {
        resultStatsElement.style.display = 'flex';
    }
    
    if (resultCountElement) {
        resultCountElement.textContent = count.toString();
    }
    
    // 同时更新数据库总数（异步执行，不阻塞UI）
    updateTotalDataCount().catch(error => {
        console.error('更新数据库总数时出错:', error);
    });
    
    // 显示内存统计（仅在DEBUG模式下）
    if (logger && logger.shouldLog && logger.shouldLog('DEBUG') && domManager && domManager.getMemoryStats) {
        const memStats = domManager.getMemoryStats();
        logger.debug('内存统计:', memStats);
    }
}

// 清理资源函数
function cleanup() {
    logger.info('开始清理应用资源...');
    
    try {
        // 清理事件监听器
        eventManager.cleanup();
        
        // 清理异步操作
        asyncManager.destroy();
        
        // 清理DOM管理器
        domManager.destroy();
        
        // 清理浏览器管理器
        if (browserManager && browserManager.cleanupBeforeClose) {
            browserManager.cleanupBeforeClose();
        }
        
        logger.info('应用资源清理完成');
    } catch (error) {
        logger.error('清理资源时出错', 'cleanup', error);
    }
}

// 在窗口关闭前清理资源
window.addEventListener('beforeunload', cleanup);

// ==================== 紧凑演示步骤函数 ====================

// 第1步：欢迎使用（紧凑版）
function showWelcomeStepCompact(container) {
    const stage = container.querySelector('#demo-stage');
    stage.innerHTML = `
        <div class="step-welcome">
            <div class="welcome-icon">📚</div>
            <div class="welcome-text">
                <h3>欢迎观看书签工具完整演示</h3>
                <p>本演示将展示从安装到使用的完整流程</p>
                <div class="demo-features">
                    <div class="feature-item">✨ 真实浏览器操作</div>
                    <div class="feature-item">🎯 逐步操作指导</div>
                    <div class="feature-item">🚀 实际使用场景</div>
                </div>
            </div>
        </div>
    `;
    console.log('📖 第1步：欢迎演示');
}

// 第2步：显示书签栏（紧凑版）
function showKeyboardStepCompact(container, shortcutKey) {
    // 防护检查：确保shortcutKey不为undefined
    if (!shortcutKey) {
        shortcutKey = 'Ctrl+Shift+B'; // 默认值
        console.warn('showKeyboardStepCompact: shortcutKey为空，使用默认值');
    }
    
    const stage = container.querySelector('#demo-stage');
    stage.innerHTML = `
        <div class="step-keyboard">
            <div class="keyboard-instruction">
                <p>在浏览器中按下快捷键组合：</p>
                <div class="key-combination-large">
                    ${shortcutKey.split('+').map(key => 
                        `<div class="demo-key-large" data-key="${key}">${key}</div>`
                    ).join('<span class="key-plus-large">+</span>')}
                </div>
                <p class="key-effect">这会显示或隐藏浏览器的书签栏</p>
            </div>
        </div>
    `;
    
    // 模拟按键
    setTimeout(() => {
        simulateKeyboardDemo(shortcutKey);
    }, 500);
    
    console.log('⌨️ 第2步：演示快捷键操作');
}

// 第3步：浏览器界面（紧凑版）
function showBrowserInterfaceCompact(container) {
    const stage = container.querySelector('#demo-stage');
    stage.innerHTML = `
        <div class="step-browser">
            <div class="browser-mockup">
                <div class="browser-header">
                    <div class="browser-controls">
                        <div class="control-btn close"></div>
                        <div class="control-btn minimize"></div>
                        <div class="control-btn maximize"></div>
                    </div>
                    <div class="browser-tabs">
                        <div class="browser-tab active">
                            <span class="tab-icon">🏠</span>
                            <span class="tab-title">新标签页</span>
                        </div>
                    </div>
                </div>
                <div class="browser-navigation">
                    <div class="nav-buttons">
                        <button class="nav-btn">←</button>
                        <button class="nav-btn">→</button>
                        <button class="nav-btn">↻</button>
                    </div>
                    <div class="address-bar">
                        <span class="address-text">https://example.com</span>
                    </div>
                </div>
                <div class="bookmark-bar" id="demo-bookmark-bar-compact">
                    <div class="bookmark-item">📁 收藏夹</div>
                    <div class="bookmark-item">⭐ 常用网站</div>
                    <div class="bookmark-drop-zone">
                        <span class="drop-indicator">拖拽到这里 ↓</span>
                    </div>
                </div>
                <div class="browser-content">
                    <div class="content-placeholder">网页内容区域</div>
                </div>
            </div>
        </div>
    `;
    
    // 高亮书签栏
    setTimeout(() => {
        const bookmarkBar = container.querySelector('#demo-bookmark-bar-compact');
        if (bookmarkBar) {
            bookmarkBar.classList.add('highlight-bookmark-bar');
        }
    }, 1000);
    
    console.log('🌐 第3步：识别浏览器书签栏位置');
}

// 第4步：拖拽操作（紧凑版 - 适应小窗口）
function showDragStepCompact(container) {
    const stage = container.querySelector('#demo-stage');
    stage.innerHTML = `
        <div class="step-drag" style="background: linear-gradient(135deg, #f8fafc, #f1f5f9); padding: 20px; border-radius: 12px;">
            <div class="drag-demo-area">
                <div class="drag-instruction" style="text-align: center; margin-bottom: 20px;">
                    <h3 style="color: #1e40af; margin: 0 0 8px 0; font-size: 18px;">🎯 拖拽操作演示</h3>
                    <p style="font-size: 15px; font-weight: 600; color: #475569; margin: 0;">观看绿色按钮拖拽到书签栏的完整过程</p>
                </div>
                <div class="mini-browser" style="background: white; border: 2px solid #e2e8f0; border-radius: 8px; margin-bottom: 20px;">
                    <div class="mini-bookmark-bar" style="padding: 12px; background: #f8fafc; border-bottom: 1px solid #e2e8f0;">
                        <div class="mini-bookmark" style="background: #e2e8f0; padding: 6px 12px; border-radius: 4px; font-size: 13px;">📁 收藏</div>
                        <div class="mini-bookmark" style="background: #e2e8f0; padding: 6px 12px; border-radius: 4px; font-size: 13px;">⭐ 网站</div>
                        <div class="mini-drop-zone" id="mini-drop-target-compact" style="
                            background: linear-gradient(135deg, #dbeafe, #bfdbfe); 
                            border: 2px dashed #3b82f6; 
                            padding: 8px 16px; 
                            border-radius: 6px; 
                            position: relative;
                            animation: targetPulse 2s ease-in-out infinite;
                        ">
                            <span class="mini-drop-text" style="font-size: 13px; font-weight: 700; color: #1e40af;">📍 拖拽到这里</span>
                        </div>
                    </div>
                </div>
                <div class="drag-source-area" style="text-align: center; margin-bottom: 20px;">
                    <div style="margin-bottom: 8px; font-size: 14px; color: #64748b; font-weight: 500;">👇 拖拽这个绿色按钮</div>
                    <div class="fake-bookmark-btn" id="fake-drag-source-compact" style="
                        background: linear-gradient(135deg, #22c55e, #16a34a); 
                        color: white; 
                        padding: 12px 20px; 
                        border-radius: 8px; 
                        font-size: 15px; 
                        font-weight: 700; 
                        box-shadow: 0 4px 12px rgba(34, 197, 94, 0.4);
                        cursor: grab;
                        transition: all 0.3s ease;
                        animation: sourcePulse 1.5s ease-in-out infinite;
                    ">
                        📗 提取个人信息工具
                    </div>
                </div>
                <div class="mouse-cursor" id="demo-cursor-compact" style="
                    position: absolute; 
                    font-size: 26px; 
                    z-index: 1000; 
                    opacity: 0; 
                    filter: drop-shadow(2px 2px 4px rgba(0,0,0,0.3));
                    transition: all 0.2s ease;
                ">🖱️</div>
                
                <!-- 拖拽轨迹指示 -->
                <div class="drag-path-indicator" style="
                    position: absolute;
                    top: 50%;
                    left: 50%;
                    transform: translate(-50%, -50%);
                    pointer-events: none;
                    opacity: 0.6;
                ">
                    <svg width="280" height="140" style="position: absolute;">
                        <path d="M 50 115 Q 140 30 230 80" stroke="#3b82f6" stroke-width="3" stroke-dasharray="10,5" fill="none" opacity="0.5">
                            <animate attributeName="stroke-dashoffset" values="0;-15" dur="1s" repeatCount="indefinite"/>
                        </path>
                        <circle cx="50" cy="115" r="4" fill="#22c55e"/>
                        <circle cx="230" cy="80" r="4" fill="#3b82f6"/>
                    </svg>
                </div>
            </div>
        </div>
    `;
    
    // 开始拖拽动画（延迟更长，让用户先看清楚界面）
    setTimeout(() => {
        startCompactDragAnimation(container);
    }, 800);
    
    console.log('🎯 第4步：演示拖拽操作（增强版）');
}

// 第5步：安装完成（紧凑版）
function showInstallationCompleteCompact(container) {
    const stage = container.querySelector('#demo-stage');
    stage.innerHTML = `
        <div class="step-completion">
            <div class="completion-animation">
                <div class="success-icon">✅</div>
                <h3>书签工具安装成功！</h3>
                <div class="completion-details">
                    <div class="detail-item">
                        <span class="detail-icon">📗</span>
                        <span class="detail-text">工具已添加到书签栏</span>
                    </div>
                    <div class="detail-item">
                        <span class="detail-icon">🌐</span>
                        <span class="detail-text">可在任何网页上使用</span>
                    </div>
                    <div class="detail-item">
                        <span class="detail-icon">⚡</span>
                        <span class="detail-text">一键提取个人信息</span>
                    </div>
                </div>
                <div class="next-action">
                    <p>接下来将演示工具的实际使用过程</p>
                </div>
            </div>
        </div>
    `;
    console.log('🎉 第5步：安装完成');
}

// 第6步：打开目标网站（紧凑版）
function showWebsiteOpenCompact(container) {
    const stage = container.querySelector('#demo-stage');
    stage.innerHTML = `
        <div class="real-usage-demo">
            <div class="demo-website">
                <div class="demo-website-header">
                    <span>🌐</span>
                    <div class="demo-url-bar demo-typing-url">正在输入网址...</div>
                </div>
                <div class="demo-bookmark-bar">
                    <div class="demo-bookmark-item">📁 收藏夹</div>
                    <div class="demo-bookmark-item demo-bookmark-tool">📗 提取个人信息工具</div>
                    <div class="demo-bookmark-item">⭐ 常用网站</div>
                </div>
                <div class="demo-website-content">
                    <div class="demo-loading">
                        <div class="demo-loading-spinner"></div>
                        <p>正在加载 TruePeopleSearch...</p>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    // 模拟网址输入
    setTimeout(() => {
        const urlBar = container.querySelector('.demo-url-bar');
        if (urlBar) {
            urlBar.classList.remove('demo-typing-url');
            urlBar.textContent = 'truepeoplesearch.com/find/person/p8n066r09842r2240619';
        }
    }, 1000);
    
    // 模拟页面加载完成
    setTimeout(() => {
        const content = container.querySelector('.demo-website-content');
        if (content) {
            content.innerHTML = `
                <div class="demo-person-info">
                    <div class="demo-person-name">Susie Banegas</div>
                    <div class="demo-person-details">
                        <div class="demo-detail-item">📅 60 years old</div>
                        <div class="demo-detail-item">🏠 714 W Baetz Blvd</div>
                        <div class="demo-detail-item">🏙️ San Antonio, TX</div>
                        <div class="demo-detail-item">📞 (210) 924-1955</div>
                    </div>
                </div>
            `;
        }
    }, 2000);
    
    console.log('🌐 第6步：打开目标网站 TruePeopleSearch');
}

// 第7步：点击工具（紧凑版）
function showToolClickCompact(container) {
    const stage = container.querySelector('#demo-stage');
    stage.innerHTML = `
        <div class="real-usage-demo">
            <div class="demo-website">
                <div class="demo-website-header">
                    <span>🌐</span>
                    <div class="demo-url-bar">truepeoplesearch.com/find/person/p8n066r09842r2240619</div>
                </div>
                <div class="demo-bookmark-bar">
                    <div class="demo-bookmark-item">📁 收藏夹</div>
                    <div class="demo-bookmark-item demo-bookmark-tool demo-tool-ready">📗 提取个人信息工具</div>
                    <div class="demo-bookmark-item">⭐ 常用网站</div>
                </div>
                <div class="demo-website-content">
                    <div class="demo-person-info">
                        <div class="demo-person-name">Susie Banegas</div>
                        <div class="demo-person-details">
                            <div class="demo-detail-item">📅 60 years old</div>
                            <div class="demo-detail-item">🏠 714 W Baetz Blvd</div>
                            <div class="demo-detail-item">🏙️ San Antonio, TX</div>
                            <div class="demo-detail-item">📞 (210) 924-1955</div>
                        </div>
                    </div>
                    <div class="demo-click-indicator" style="position: absolute; top: -60px; left: 50%; transform: translateX(-50%);">
                        <div class="demo-cursor-pointer">👆</div>
                        <div class="demo-click-text">点击书签栏中的工具</div>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    // 工具高亮脉冲动画
    setTimeout(() => {
        const toolBookmark = container.querySelector('.demo-bookmark-tool');
        if (toolBookmark) {
            toolBookmark.classList.add('demo-tool-pulse');
        }
    }, 500);
    
    // 模拟点击动画
    setTimeout(() => {
        const toolBookmark = container.querySelector('.demo-bookmark-tool');
        if (toolBookmark) {
            toolBookmark.classList.add('demo-tool-clicked');
        }
    }, 2000);
    
    console.log('👆 第7步：点击书签栏中的提取工具');
}

// 第8步：信息提取（紧凑版 - 模拟提取结果）
function showExtractionCompact(container) {
    const stage = container.querySelector('#demo-stage');
    stage.innerHTML = `
        <div class="real-usage-demo" style="background: linear-gradient(135deg, #fdf4ff, #fae8ff); padding: 10px; border-radius: 8px; height: 100%; overflow: hidden;">
            <div style="text-align: center; margin-bottom: 8px;">
                <h3 style="color: #7c3aed; margin: 0 0 3px 0; font-size: 14px;">📊 工具自动提取信息</h3>
                <p style="color: #64748b; margin: 0; font-size: 10px;">书签工具正在分析网页内容并提取个人信息</p>
            </div>
            <div class="demo-website" style="border: 1px solid #e2e8f0; border-radius: 6px; background: white; overflow: hidden; height: calc(100% - 45px);">
                <div class="demo-website-header" style="background: #f8fafc; padding: 6px 10px; border-bottom: 1px solid #e2e8f0; display: flex; align-items: center; gap: 8px;">
                    <span style="font-size: 14px;">🌐</span>
                    <div class="demo-url-bar" style="background: white; border: 1px solid #d1d5db; border-radius: 4px; padding: 4px 8px; font-size: 10px; color: #374151; flex: 1;">truepeoplesearch.com/find/person/p8n066r09842r2240619</div>
                </div>
                <div class="demo-website-content" style="padding: 10px; height: calc(100% - 40px); overflow-y: auto;">
                    <div class="demo-person-info" style="background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 6px; padding: 10px; position: relative;">
                        <div class="demo-person-name" style="font-size: 16px; font-weight: 700; color: #1f2937; margin-bottom: 8px;">Susie Banegas</div>
                        <div class="demo-person-details" style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-bottom: 10px;">
                            <div class="demo-detail-item" style="font-size: 10px; color: #374151; padding: 4px 6px; background: white; border-radius: 3px;">📅 60 years old</div>
                            <div class="demo-detail-item" style="font-size: 10px; color: #374151; padding: 4px 6px; background: white; border-radius: 3px;">🏠 714 W Baetz Blvd</div>
                            <div class="demo-detail-item" style="font-size: 10px; color: #374151; padding: 4px 6px; background: white; border-radius: 3px;">🏙️ San Antonio, TX</div>
                            <div class="demo-detail-item" style="font-size: 10px; color: #374151; padding: 4px 6px; background: white; border-radius: 3px;">📞 (210) 924-1955</div>
                        </div>
                        <div class="demo-extraction-progress" style="background: white; border-radius: 4px; padding: 8px; border: 1px solid #d1d5db;">
                            <div class="demo-progress-text" style="font-size: 10px; color: #059669; font-weight: 600; margin-bottom: 6px;">正在分析页面信息...</div>
                            <div class="demo-progress-bar" style="background: #e5e7eb; height: 4px; border-radius: 2px; overflow: hidden; margin-bottom: 4px;">
                                <div class="demo-progress-fill" style="height: 100%; background: linear-gradient(135deg, #059669, #047857); border-radius: 2px; width: 0%; transition: width 0.5s ease;"></div>
                            </div>
                            <div style="font-size: 8px; color: #6b7280; text-align: center;">提取个人信息中...</div>
                        </div>
                    </div>
                </div>
                        <!-- 提取结果弹窗 - 隐藏状态 -->
                        <div class="demo-extraction-popup" style="
                            position: absolute;
                            top: 50%;
                            left: 50%;
                            transform: translate(-50%, -50%);
                            background: white;
                            border: 2px solid #22c55e;
                            border-radius: 8px;
                            box-shadow: 0 8px 25px rgba(0,0,0,0.15);
                            width: 90%;
                            max-height: 70%;
                            display: none;
                            flex-direction: column;
                            z-index: 100;
                        ">
                            <div class="demo-popup-header" style="display: flex; justify-content: space-between; align-items: center; padding: 6px 10px; border-bottom: 1px solid #e2e8f0; background: #f0fdf4;">
                                <div class="demo-popup-title" style="font-size: 12px; color: #059669; font-weight: 700;">📋 提取的资料</div>
                                <button class="demo-popup-close" style="width: 16px; height: 16px; border-radius: 50%; background: #f1f5f9; border: 1px solid #cbd5e1; font-size: 10px; cursor: pointer;">×</button>
                            </div>
                            <div class="demo-popup-content" style="flex: 1; padding: 8px; overflow-y: auto;">
                                <div class="demo-extracted-grid" style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 4px;">
                                    <div class="demo-field-item" style="border: 1px solid #e2e8f0; background: #f9fafb; border-radius: 3px; overflow: hidden;">
                                        <div class="demo-field-label" style="background: #f3f4f6; color: #374151; font-weight: 600; font-size: 8px; padding: 2px 4px;">名字</div>
                                        <div class="demo-field-value" style="padding: 4px; font-size: 9px; display: flex; justify-content: space-between; align-items: center;">
                                            Susie <button class="demo-copy-btn" style="background: #e5e7eb; border: none; border-radius: 2px; font-size: 7px; padding: 1px 2px; cursor: pointer;">复制</button>
                                        </div>
                                    </div>
                                    <div class="demo-field-item" style="border: 1px solid #e2e8f0; background: #f9fafb; border-radius: 3px; overflow: hidden;">
                                        <div class="demo-field-label" style="background: #f3f4f6; color: #374151; font-weight: 600; font-size: 8px; padding: 2px 4px;">姓氏</div>
                                        <div class="demo-field-value" style="padding: 4px; font-size: 9px; display: flex; justify-content: space-between; align-items: center;">
                                            Banegas <button class="demo-copy-btn" style="background: #e5e7eb; border: none; border-radius: 2px; font-size: 7px; padding: 1px 2px; cursor: pointer;">复制</button>
                                        </div>
                                    </div>
                                    <div class="demo-field-item" style="border: 1px solid #e2e8f0; background: #f9fafb; border-radius: 3px; overflow: hidden;">
                                        <div class="demo-field-label" style="background: #f3f4f6; color: #374151; font-weight: 600; font-size: 8px; padding: 2px 4px;">生日</div>
                                        <div class="demo-field-value" style="padding: 4px; font-size: 9px; display: flex; justify-content: space-between; align-items: center;">
                                            1965-05 <button class="demo-copy-btn" style="background: #e5e7eb; border: none; border-radius: 2px; font-size: 7px; padding: 1px 2px; cursor: pointer;">复制</button>
                                        </div>
                                    </div>
                                    <div class="demo-field-item" style="border: 1px solid #e2e8f0; background: #f9fafb; border-radius: 3px; overflow: hidden;">
                                        <div class="demo-field-label" style="background: #f3f4f6; color: #374151; font-weight: 600; font-size: 8px; padding: 2px 4px;">地址</div>
                                        <div class="demo-field-value" style="padding: 4px; font-size: 9px; display: flex; justify-content: space-between; align-items: center;">
                                            714 W Baetz Blvd <button class="demo-copy-btn" style="background: #e5e7eb; border: none; border-radius: 2px; font-size: 7px; padding: 1px 2px; cursor: pointer;">复制</button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            <div class="demo-popup-actions" style="padding: 6px; border-top: 1px solid #e2e8f0; background: #f8fafc; display: flex; justify-content: center; gap: 4px;">
                                <button class="demo-action-btn success demo-copy-format-btn" style="background: linear-gradient(135deg, #10b981, #059669); color: white; padding: 4px 8px; border-radius: 3px; font-size: 9px; font-weight: 700; border: none; cursor: pointer;">复制查询格式</button>
                                <button class="demo-action-btn primary" style="background: #6366f1; color: white; padding: 4px 8px; border-radius: 3px; font-size: 9px; font-weight: 700; border: none; cursor: pointer;">复制全部</button>
                            </div>
                        </div>
            </div>
        </div>
    `;
    
    // 模拟提取进度
    setTimeout(() => {
        const progressFill = container.querySelector('.demo-progress-fill');
        if (progressFill) {
            progressFill.style.width = '100%';
        }
    }, 1000);
    
    // 显示提取结果弹窗
    setTimeout(() => {
        const popup = container.querySelector('.demo-extraction-popup');
        if (popup) {
            popup.style.display = 'flex';
            popup.style.opacity = '0';
            popup.style.transform = 'translate(-50%, -50%) scale(0.9)';
            popup.style.transition = 'all 0.3s ease';
            
            // 动画显示
            setTimeout(() => {
                popup.style.opacity = '1';
                popup.style.transform = 'translate(-50%, -50%) scale(1)';
            }, 10);
        }
    }, 2500);
    
    console.log('📊 第8步：工具自动提取页面信息');
}

// 第9步：复制信息（紧凑版 - 适应新容器）
function showCopyInfoCompact(container) {
    const stage = container.querySelector('#demo-stage');
    stage.innerHTML = `
        <div class="real-usage-demo" style="background: linear-gradient(135deg, #f0f9ff, #e0f2fe); padding: 10px; border-radius: 8px; height: 100%; overflow: hidden;">
            <div style="text-align: center; margin-bottom: 8px;">
                <h3 style="color: #0369a1; margin: 0 0 3px 0; font-size: 14px;">✂️ 复制提取的信息</h3>
                <p style="color: #64748b; margin: 0; font-size: 10px;">点击"复制查询格式"按钮将信息复制到剪贴板</p>
            </div>
            <div class="demo-extraction-popup" style="
                position: relative; 
                display: flex; 
                flex-direction: column;
                background: white;
                border-radius: 6px;
                border: 1px solid #e2e8f0;
                box-shadow: 0 2px 8px rgba(0,0,0,0.1);
                height: calc(100% - 45px);
                overflow: hidden;
            ">
                <div class="demo-popup-header" style="
                    display: flex; 
                    justify-content: space-between; 
                    align-items: center; 
                    padding: 6px 10px; 
                    border-bottom: 1px solid #e2e8f0; 
                    background: #f8fafc;
                    flex-shrink: 0;
                ">
                    <div class="demo-popup-title" style="font-size: 12px; color: #059669; font-weight: 700;">📋 提取的资料</div>
                    <button class="demo-popup-close" style="
                        width: 16px; 
                        height: 16px; 
                        border-radius: 50%; 
                        background: #f1f5f9; 
                        border: 1px solid #cbd5e1; 
                        font-size: 10px;
                        cursor: pointer;
                    ">×</button>
                </div>
                <div class="demo-popup-content" style="flex: 1; padding: 8px; overflow: hidden;">
                    <div class="demo-extracted-grid" style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 6px; margin-bottom: 6px;">
                        ${[
                            ['名字', 'Susie'],
                            ['姓氏', 'Banegas'],
                            ['生日', '1965-05'],
                            ['地址', '714 W Baetz Blvd'],
                            ['城市', 'San Antonio'],
                            ['州', 'TX'],
                        ].map(([label, value]) => `
                            <div class="demo-field-item" style="border: 1px solid #e2e8f0; background: white; border-radius: 3px; overflow: hidden;">
                                <div class="demo-field-label" style="background: #f8fafc; color: #475569; font-weight: 600; font-size: 9px; padding: 3px 5px;">${label}</div>
                                <div class="demo-field-value" style="padding: 4px; font-size: 10px; display: flex; justify-content: space-between; align-items: center;">
                                    ${value} 
                                    <button class="demo-copy-btn" style="background: #e2e8f0; border: none; border-radius: 2px; font-size: 8px; padding: 1px 3px; cursor: pointer;">复制</button>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
                <div class="demo-popup-actions" style="
                    padding: 8px; 
                    border-top: 1px solid #e2e8f0; 
                    background: #f8fafc;
                    flex-shrink: 0;
                ">
                    <div style="display: flex; justify-content: center; gap: 6px; align-items: center; margin-bottom: 6px;">
                        <!-- 包裹绿色按钮并放置箭头提示 -->
                        <div style="position: relative; display: inline-block;">
                            <!-- 指示器 -->
                            <div style="
                                position: absolute;
                                top: -50px;
                                left: 50%;
                                transform: translateX(-50%);
                                background: linear-gradient(135deg, #10b981, #059669);
                                color: white;
                                padding: 6px 10px;
                                border-radius: 6px;
                                font-size: 10px;
                                font-weight: 700;
                                white-space: nowrap;
                                box-shadow: 0 4px 12px rgba(16,185,129,0.4);
                                animation: demo-click-indicator-pulse 2s ease-in-out infinite;
                                z-index: 100;
                            ">
                                <div style="font-size: 14px; margin-bottom: 2px;">👇</div>
                                点击此按钮
                            </div>

                            <!-- 绿色复制查询格式按钮 -->
                            <button class="demo-action-btn success demo-copy-format-btn" style="
                                background: linear-gradient(135deg, #10b981, #059669); 
                                color: white; 
                                padding: 6px 12px; 
                                border-radius: 4px; 
                                font-size: 12px; 
                                font-weight: 700; 
                                border: none; 
                                box-shadow: 0 2px 6px rgba(16, 185, 129, 0.4);
                                animation: demo-btn-pulse 1.5s ease-in-out infinite;
                                cursor: pointer;
                            ">📋 复制查询格式</button>
                        </div>

                        <!-- 复制全部按钮 -->
                        <button class="demo-action-btn primary" style="
                            background: #6366f1; 
                            color: white; 
                            padding: 6px 12px; 
                            border-radius: 4px; 
                            font-size: 12px; 
                            font-weight: 700; 
                            border: none;
                            cursor: pointer;
                        ">复制全部</button>
                    </div>

                    <div class="demo-copy-success" style="
                        display: none; 
                        text-align: center; 
                        background: #dcfce7; 
                        color: #166534; 
                        padding: 4px 8px; 
                        border-radius: 3px; 
                        font-weight: 600;
                        border: 1px solid #bbf7d0;
                        font-size: 10px;
                    ">✅ 已复制到剪贴板！准备粘贴到查询助手</div>
                </div>
            </div>
        </div>
    `;

    // 设置复制按钮高亮效果
    setTimeout(() => {
        const copyBtn = container.querySelector('.demo-copy-format-btn');
        if (copyBtn) {
            copyBtn.style.transform = 'scale(1.05)';
            copyBtn.style.boxShadow = '0 6px 20px rgba(16, 185, 129, 0.6)';
        }
    }, 100);

    // 模拟点击反馈
    setTimeout(() => {
        const copyBtn = container.querySelector('.demo-copy-format-btn');
        const successMsg = container.querySelector('.demo-copy-success');
        if (copyBtn && successMsg) {
            copyBtn.style.transform = 'scale(0.95)';
            copyBtn.style.background = 'linear-gradient(135deg, #059669, #047857)';
            copyBtn.innerHTML = '✅ 已复制';
            successMsg.style.display = 'block';
            successMsg.style.animation = 'demo-fade-in 0.5s ease';
        }
    }, 2000);

    console.log('📋 第9步：点击复制查询格式按钮');
}


// 第10步：粘贴到查询助手（紧凑版 - 超小尺寸）
function showPasteToQueryCompact(container) {
    const stage = container.querySelector('#demo-stage');
    stage.innerHTML = `
        <div class="real-usage-demo" style="background: linear-gradient(135deg, #fafafa, #f4f4f5); padding: 8px; border-radius: 6px; height: 100%; overflow: hidden;">
            <div style="text-align: center; margin-bottom: 6px;">
                <h3 style="color: #7c3aed; margin: 0 0 2px 0; font-size: 12px;">📝 粘贴到查询助手</h3>
                <p style="color: #64748b; margin: 0; font-size: 9px;">将复制的信息粘贴到信息查询助手中</p>
            </div>
            <div class="demo-query-app" style="border: 1px solid #e2e8f0; border-radius: 4px; background: white; overflow: hidden; height: calc(100% - 35px);">
                <div class="demo-app-sidebar" style="padding: 12px; border-bottom: 1px solid #e2e8f0; height: 100%; display: flex; flex-direction: column;">
                    <div class="demo-app-title" style="font-size: 14px; font-weight: 700; color: #1e293b; margin-bottom: 8px;">📊 信息查询助手</div>
                    <div class="demo-input-area demo-input-empty" id="demo-input-area" style="
                        flex: 1;
                        min-height: 80px; 
                        font-size: 11px; 
                        padding: 10px; 
                        border: 2px dashed #cbd5e1; 
                        border-radius: 4px; 
                        background: #f8fafc; 
                        color: #64748b;
                        margin-bottom: 10px;
                        line-height: 1.3;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                    ">
                        请粘贴要查询的信息...
                    </div>
                    <button class="demo-query-btn demo-btn-disabled" disabled style="
                        width: 100%; 
                        padding: 8px 12px; 
                        font-size: 12px; 
                        font-weight: 700; 
                        border-radius: 4px; 
                        background: #94a3b8; 
                        color: white; 
                        border: none;
                        margin-bottom: 8px;
                    ">开始查询</button>
                    <div class="demo-paste-hint" style="text-align: center; padding: 6px; background: #fef3c7; border-radius: 4px; border: 1px solid #fcd34d;">
                        <div class="demo-cursor-pointer" style="font-size: 16px; margin-bottom: 2px;">👆</div>
                        <div class="demo-hint-text" style="font-size: 9px; color: #92400e; font-weight: 600;">在输入框中按 Ctrl+V 粘贴</div>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    // 模拟粘贴操作
    setTimeout(() => {
        const inputArea = container.querySelector('#demo-input-area');
        const queryBtn = container.querySelector('.demo-query-btn');
        const hint = container.querySelector('.demo-paste-hint');
        
        if (inputArea && queryBtn && hint) {
            // 隐藏提示
            hint.style.opacity = '0';
            
            // 显示粘贴内容（带打字效果）
            inputArea.classList.remove('demo-input-empty');
            inputArea.classList.add('demo-typing-effect');
            inputArea.style.background = '#f0fdf4';
            inputArea.style.border = '1px solid #22c55e';
            inputArea.style.color = '#1f2937';
            inputArea.style.fontWeight = '600';
            inputArea.style.display = 'block';
            inputArea.style.textAlign = 'left';
            inputArea.style.alignItems = 'flex-start';
            inputArea.style.justifyContent = 'flex-start';
            inputArea.innerHTML = `Susie<br>Banegas<br>1965-05<br>78221<br>TX<br>714 W Baetz Blvd`;
            
            // 启用查询按钮
            queryBtn.disabled = false;
            queryBtn.style.background = 'linear-gradient(135deg, #7c3aed, #6d28d9)';
            queryBtn.style.transform = 'scale(1.02)';
            queryBtn.style.boxShadow = '0 3px 10px rgba(124, 58, 237, 0.4)';
        }
    }, 1500);
    
    // 高亮查询按钮
    setTimeout(() => {
        const queryBtn = container.querySelector('.demo-query-btn');
        if (queryBtn) {
            queryBtn.style.animation = 'demo-btn-pulse 1.5s ease-in-out infinite';
            // 添加点击指示器 - 紧凑版
            const sidebar = container.querySelector('.demo-app-sidebar');
            if (sidebar) {
                const indicator = document.createElement('div');
                indicator.style.cssText = `
                    position: absolute;
                    top: -25px;
                    left: 50%;
                    transform: translateX(-50%);
                    background: rgba(124, 58, 237, 0.9);
                    color: white;
                    padding: 4px 8px;
                    border-radius: 4px;
                    font-size: 8px;
                    font-weight: 600;
                    animation: demo-click-indicator-pulse 2s ease-in-out infinite;
                    z-index: 100;
                    text-align: center;
                `;
                indicator.innerHTML = `
                    <div style="font-size: 12px; margin-bottom: 1px;">👇</div>
                    <div>点击开始查询</div>
                `;
                queryBtn.style.position = 'relative';
                queryBtn.appendChild(indicator);
            }
        }
    }, 3000);
    
    console.log('📝 第10步：粘贴信息到查询助手');
}

// 第11步：开始查询（紧凑版 - 超小尺寸）
function showQueryResultCompact(container) {
    const stage = container.querySelector('#demo-stage');
    stage.innerHTML = `
        <div class="real-usage-demo" style="background: linear-gradient(135deg, #f0f9ff, #e0f2fe); padding: 8px; border-radius: 6px; height: 100%; overflow: hidden;">
            <div style="text-align: center; margin-bottom: 6px;">
                <h3 style="color: #0284c7; margin: 0 0 2px 0; font-size: 12px;">🔍 开始查询</h3>
                <p style="color: #64748b; margin: 0; font-size: 9px;">正在查询数据库，即将显示详细结果</p>
            </div>
            <div class="demo-query-app" style="border: 1px solid #e2e8f0; border-radius: 4px; background: white; overflow: hidden; height: calc(100% - 35px); display: flex;">
                <div class="demo-app-sidebar" style="padding: 10px; border-right: 1px solid #e2e8f0; width: 45%; display: flex; flex-direction: column;">
                    <div class="demo-app-title" style="font-size: 12px; font-weight: 700; color: #1e293b; margin-bottom: 6px;">📊 信息查询助手</div>
                    <div class="demo-input-area" style="
                        flex: 1;
                        min-height: 60px; 
                        font-size: 9px; 
                        padding: 8px; 
                        border: 1px solid #22c55e; 
                        border-radius: 4px; 
                        background: #f0fdf4; 
                        color: #1f2937;
                        margin-bottom: 8px;
                        line-height: 1.2;
                        font-weight: 600;
                        overflow: hidden;
                    ">Susie<br>Banegas<br>1965-05<br>78221<br>TX<br>714 W Baetz Blvd</div>
                    <button class="demo-query-btn demo-btn-clicked" disabled style="
                        width: 100%; 
                        padding: 6px 10px; 
                        font-size: 10px; 
                        font-weight: 700; 
                        border-radius: 4px; 
                        background: linear-gradient(135deg, #f59e0b, #d97706); 
                        color: white; 
                        border: none;
                        margin-bottom: 8px;
                        animation: demo-query-pulse 1.5s ease-in-out infinite;
                    ">🔄 查询中...</button>
                    <div class="demo-query-progress" style="background: #f8fafc; padding: 8px; border-radius: 4px; border: 1px solid #e2e8f0;">
                        <div class="demo-progress-text" style="font-size: 9px; color: #475569; font-weight: 600; margin-bottom: 6px;">正在搜索数据库...</div>
                        <div class="demo-progress-bar" style="background: #e2e8f0; height: 6px; border-radius: 3px; margin-bottom: 4px; overflow: hidden;">
                            <div class="demo-progress-fill demo-progress-animate" style="height: 100%; background: linear-gradient(135deg, #0284c7, #0369a1); border-radius: 3px; width: 0%;"></div>
                        </div>
                        <div class="demo-progress-percent" style="text-align: center; font-size: 8px; font-weight: 700; color: #0284c7;">0%</div>
                    </div>
                </div>
                <div class="demo-app-results" style="padding: 10px; width: 55%; overflow-y: auto;">
                    <div class="demo-results-title" style="font-size: 12px; font-weight: 700; color: #1e293b; margin-bottom: 8px;">🔍 查询结果</div>
                    <div class="demo-searching-indicator" style="text-align: center; padding: 12px;">
                        <div class="demo-loading-spinner" style="width: 24px; height: 24px; margin: 0 auto 8px; border: 2px solid #e2e8f0; border-top: 2px solid #0284c7; border-radius: 50%; animation: spin 1s linear infinite;"></div>
                        <p style="font-size: 9px; color: #64748b; font-weight: 500; margin: 0;">正在查询中，请稍候...</p>
                    </div>
                </div>
            </div>
        </div>
    `;
    
    // 模拟查询进度
    let progress = 0;
    const progressInterval = setInterval(() => {
        progress += Math.random() * 15 + 5;
        if (progress > 100) progress = 100;
        
        const progressFill = container.querySelector('.demo-progress-fill');
        const progressPercent = container.querySelector('.demo-progress-percent');
        if (progressFill && progressPercent) {
            progressFill.style.width = progress + '%';
            progressPercent.textContent = Math.round(progress) + '%';
        }
        
        if (progress >= 100) {
            clearInterval(progressInterval);
            
                            // 显示查询结果
                setTimeout(() => {
                    const resultsContainer = container.querySelector('.demo-app-results');
                    if (resultsContainer) {
                        resultsContainer.innerHTML = `
                            <div class="demo-results-title" style="font-size: 12px; font-weight: 700; color: #1e293b; margin-bottom: 8px;">
                                🔍 查询结果 <span class="demo-result-count" style="color: #059669; font-size: 8px;">(找到3条记录)</span>
                            </div>
                            <div class="demo-result-item demo-result-animate" style="
                                animation-delay: 0.2s; 
                                border: 1px solid #dcfce7; 
                                background: #f0fdf4; 
                                padding: 6px; 
                                border-radius: 4px; 
                                margin-bottom: 6px;
                            ">
                                <div class="demo-result-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                                    <strong style="color: #059669; font-size: 8px;">✅ 精确匹配</strong>
                                    <span class="demo-result-score" style="background: #059669; color: white; padding: 1px 3px; border-radius: 2px; font-size: 6px; font-weight: 600;">98%</span>
                                </div>
                                <div class="demo-result-content" style="font-size: 7px; line-height: 1.3; color: #374151;">
                                    <strong>姓名:</strong> Susie Banegas<br>
                                    <strong>地址:</strong> 714 W Baetz Blvd, San Antonio, TX<br>
                                    <strong>年龄:</strong> 60岁 (1965年生)
                                </div>
                            </div>
                            <div class="demo-result-item demo-result-animate" style="
                                animation-delay: 0.5s; 
                                border: 1px solid #fed7aa; 
                                background: #fffbeb; 
                                padding: 6px; 
                                border-radius: 4px; 
                                margin-bottom: 6px;
                            ">
                                <div class="demo-result-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                                    <strong style="color: #ea580c; font-size: 8px;">🔍 相关匹配</strong>
                                    <span class="demo-result-score" style="background: #ea580c; color: white; padding: 1px 3px; border-radius: 2px; font-size: 6px; font-weight: 600;">85%</span>
                                </div>
                                <div class="demo-result-content" style="font-size: 7px; line-height: 1.3; color: #374151;">
                                    <strong>姓名:</strong> Susie H Banegas<br>
                                    <strong>地址:</strong> 713 Wagner Ave, San Antonio, TX<br>
                                    <strong>关系:</strong> 可能是同一人或亲属
                                </div>
                            </div>
                            <div class="demo-result-item demo-result-animate" style="
                                animation-delay: 0.8s; 
                                border: 1px solid #bfdbfe; 
                                background: #eff6ff; 
                                padding: 6px; 
                                border-radius: 4px; 
                                margin-bottom: 8px;
                            ">
                                <div class="demo-result-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px;">
                                    <strong style="color: #2563eb; font-size: 8px;">📞 联系方式</strong>
                                    <span class="demo-result-score" style="background: #2563eb; color: white; padding: 1px 3px; border-radius: 2px; font-size: 6px; font-weight: 600;">92%</span>
                                </div>
                                <div class="demo-result-content" style="font-size: 7px; line-height: 1.3; color: #374151;">
                                    <strong>电话:</strong> (210) 924-1955<br>
                                    <strong>归属地:</strong> San Antonio, Texas<br>
                                    <strong>状态:</strong> 活跃号码
                                </div>
                            </div>
                            <div class="demo-query-complete" style="
                                text-align: center; 
                                padding: 8px; 
                                background: linear-gradient(135deg, #f0fdf4, #dcfce7); 
                                border-radius: 4px; 
                                border: 1px solid #22c55e;
                            ">
                                <div class="demo-complete-icon" style="font-size: 16px; margin-bottom: 3px;">🎉</div>
                                <div class="demo-complete-text" style="font-size: 8px; font-weight: 600; color: #059669;">查询完成！找到了详细的个人信息记录</div>
                            </div>
                        `;
                    }
                
                // 重置查询按钮
                const queryBtn = container.querySelector('.demo-query-btn');
                if (queryBtn) {
                    queryBtn.innerHTML = '✅ 查询完成';
                    queryBtn.disabled = false;
                    queryBtn.style.background = 'linear-gradient(135deg, #22c55e, #16a34a)';
                    queryBtn.style.animation = 'none';
                    queryBtn.style.transform = 'scale(1)';
                    queryBtn.style.boxShadow = '0 2px 6px rgba(34, 197, 94, 0.3)';
                    queryBtn.style.fontSize = '10px';
                }
            }, 500);
        }
    }, 200);
    
    console.log('🔍 第11步：开始查询并显示详细结果');
}

// 紧凑拖拽动画（适应新容器）
function startCompactDragAnimation(container) {
    const cursor = container.querySelector('#demo-cursor-compact');
    const source = container.querySelector('#fake-drag-source-compact');
    const target = container.querySelector('#mini-drop-target-compact');
    
    if (!cursor || !source || !target) return;
    
    // 获取容器相对位置
    const stage = container.querySelector('#demo-stage');
    const stageRect = stage.getBoundingClientRect();
    const sourceRect = source.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    
    // 相对于演示舞台的位置
    const startX = sourceRect.left - stageRect.left + sourceRect.width / 2;
    const startY = sourceRect.top - stageRect.top + sourceRect.height / 2;
    const endX = targetRect.left - stageRect.left + targetRect.width / 2;
    const endY = targetRect.top - stageRect.top + targetRect.height / 2;
    
    // 初始化光标位置
    cursor.style.left = startX + 'px';
    cursor.style.top = startY + 'px';
    cursor.style.opacity = '1';
    
    // 高亮源元素
    source.style.transform = 'scale(1.1)';
    source.style.boxShadow = '0 8px 25px rgba(34, 197, 94, 0.6)';
    source.style.animation = 'none'; // 停止脉冲动画
    
    // 准备拖拽提示
    setTimeout(() => {
        const dragHint = document.createElement('div');
        dragHint.style.cssText = `
            position: absolute;
            top: ${startY - 40}px;
            left: ${startX}px;
            transform: translateX(-50%);
            background: rgba(34, 197, 94, 0.9);
            color: white;
            padding: 6px 12px;
            border-radius: 6px;
            font-size: 12px;
            font-weight: 600;
            z-index: 999;
            animation: demo-fade-in 0.3s ease;
        `;
        dragHint.textContent = '开始拖拽';
        stage.appendChild(dragHint);
        
        // 1秒后移除提示
        setTimeout(() => dragHint.remove(), 1000);
    }, 200);
    
    // 开始拖拽动画
    setTimeout(() => {
        source.style.opacity = '0.6';
        target.style.background = 'linear-gradient(135deg, #bfdbfe, #93c5fd)';
        target.style.transform = 'scale(1.05)';
        
        // 创建拖拽影子
        const dragShadow = source.cloneNode(true);
        dragShadow.style.cssText = `
            position: absolute;
            left: ${startX - 50}px;
            top: ${startY - 15}px;
            background: linear-gradient(135deg, #22c55e, #16a34a);
            color: white;
            padding: 12px 20px;
            border-radius: 8px;
            font-size: 16px;
            font-weight: 700;
            box-shadow: 0 8px 25px rgba(34, 197, 94, 0.7);
            z-index: 998;
            opacity: 0.9;
            transform: scale(0.95) rotate(5deg);
            pointer-events: none;
        `;
        stage.appendChild(dragShadow);
        
        // 动画到目标
        const duration = 2500; // 增加拖拽时间
        const startTime = Date.now();
        
        function animateToTarget() {
            const elapsed = Date.now() - startTime;
            const progress = Math.min(elapsed / duration, 1);
            const easeProgress = easeInOutCubic(progress);
            
            // 计算位置（添加弧形轨迹）
            const currentX = startX + (endX - startX) * easeProgress;
            const arcHeight = 30; // 增加弧形高度
            const arcOffset = Math.sin(progress * Math.PI) * arcHeight;
            const currentY = startY + (endY - startY) * easeProgress - arcOffset;
            
            // 更新光标位置
            cursor.style.left = currentX + 'px';
            cursor.style.top = currentY + 'px';
            cursor.style.transform = `scale(${1 + progress * 0.2})`; // 光标逐渐变大
            
            // 更新拖拽影子位置
            dragShadow.style.left = currentX - 50 + 'px';
            dragShadow.style.top = currentY - 15 + 'px';
            dragShadow.style.transform = `scale(${0.95 + progress * 0.1}) rotate(${5 + progress * 5}deg)`;
            
            if (progress < 1) {
                requestAnimationFrame(animateToTarget);
            } else {
                // 拖拽完成
                target.style.background = 'linear-gradient(135deg, #22c55e, #16a34a)';
                target.style.color = 'white';
                target.querySelector('.mini-drop-text').textContent = '✅ 安装成功';
                cursor.style.opacity = '0';
                dragShadow.style.opacity = '0';
                
                // 成功效果
                setTimeout(() => {
                    const successMsg = document.createElement('div');
                    successMsg.style.cssText = `
                        position: absolute;
                        top: 50%;
                        left: 50%;
                        transform: translate(-50%, -50%);
                        background: linear-gradient(135deg, #22c55e, #16a34a);
                        color: white;
                        padding: 16px 24px;
                        border-radius: 10px;
                        font-size: 18px;
                        font-weight: 700;
                        box-shadow: 0 8px 25px rgba(34, 197, 94, 0.5);
                        z-index: 1000;
                        animation: demo-fade-in 0.5s ease;
                    `;
                    successMsg.innerHTML = '🎉 拖拽安装成功！';
                    stage.appendChild(successMsg);
                    
                    setTimeout(() => successMsg.remove(), 1500);
                }, 200);
            }
        }
        
        requestAnimationFrame(animateToTarget);
    }, 800);
}

// 演示控制函数
function pauseDemo() {
    console.log('演示暂停（功能待实现）');
}

function closeDemo() {
    const demoModal = document.getElementById('compact-demo-modal');
    if (demoModal) {
        demoModal.remove();
    }
}

// ==================== 启动演示提示功能 ====================

// 检查并显示启动演示提示
function checkAndShowStartupDemo() {
    // 延迟1秒显示，确保界面完全加载
    setTimeout(() => {
        const demoPromptSetting = getDemoPromptSetting();
        
        // 如果用户选择了"下次不再提醒"，则不显示提示
        if (demoPromptSetting === 'never') {
            console.log('用户已选择下次不再提醒演示，跳过启动演示提示');
            return;
        }
        
        // 显示启动演示提示
        createStartupDemoPrompt();
    }, 1000);
}

// 获取演示提示设置
function getDemoPromptSetting() {
    try {
        return localStorage.getItem('demoPromptSetting') || 'show';
    } catch (error) {
        console.error('读取演示提示设置失败:', error);
        return 'show';
    }
}

// 设置演示提示偏好
function setDemoPromptSetting(setting) {
    try {
        localStorage.setItem('demoPromptSetting', setting);
        console.log('演示提示设置已保存:', setting);
    } catch (error) {
        console.error('保存演示提示设置失败:', error);
    }
}

// 创建启动演示提示模态框
function createStartupDemoPrompt() {
    // 检查是否已存在提示模态框
    const existing = document.getElementById('startup-demo-prompt');
    if (existing) {
        existing.remove();
    }
    
    const modal = document.createElement('div');
    modal.id = 'startup-demo-prompt';
    modal.className = 'startup-demo-modal';
    modal.innerHTML = `
        <div class="startup-demo-content">
            <div class="startup-demo-header">
                <div class="startup-demo-icon">🎬</div>
                <h2 class="startup-demo-title">欢迎使用信息查询助手！</h2>
                <p class="startup-demo-subtitle">观看2分钟安装演示，快速上手书签工具使用方法</p>
            </div>
            
            <div class="startup-demo-preview">
                <div class="demo-preview-card">
                    <div class="preview-icon">📺</div>
                    <div class="preview-content">
                        <h4>📋 11步完整教程演示</h4>
                        <p>✨ 浏览器书签栏显示方法</p>
                        <p>🎯 工具拖拽安装全过程</p>
                        <p>🔍 信息提取与查询实操</p>
                        <p>⚡ 2分钟掌握全部功能</p>
                    </div>
                </div>
            </div>
            
            <div class="startup-demo-actions">
                <button class="startup-action-btn watch-btn" onclick="handleStartupDemoChoice('watch')">
                    <span class="btn-icon">🎬</span>
                    <span class="btn-text">观看演示教程</span>
                </button>
                
                <div class="startup-secondary-actions">
                    <button class="startup-action-btn close-btn" onclick="handleStartupDemoChoice('close')">
                        <span class="btn-icon">⏭️</span>
                        <span class="btn-text">跳过，直接开始</span>
                    </button>
                    
                    <button class="startup-action-btn never-btn" onclick="handleStartupDemoChoice('never')">
                        <span class="btn-icon">🔕</span>
                        <span class="btn-text">不再显示此提示</span>
                    </button>
                </div>
            </div>
            
            <div class="startup-demo-footer">
                <small>💡 您可随时在【工具箱】页面重新观看完整演示</small>
            </div>
        </div>
    `;
    
    document.body.appendChild(modal);
    
    // 动画显示
    setTimeout(() => {
        modal.style.opacity = '1';
        modal.style.transform = 'scale(1)';
    }, 10);
    
    console.log('启动演示提示已显示');
}

// 处理启动演示选择
function handleStartupDemoChoice(choice) {
    const modal = document.getElementById('startup-demo-prompt');
    
    switch (choice) {
        case 'watch':
            console.log('用户选择观看演示');
            // 关闭提示框
            if (modal) modal.remove();
            // 延迟一下再启动演示，确保提示框完全消失
            setTimeout(() => {
                const shortcutKey = detectBrowser();
                startStepByStepDemo(shortcutKey, true); // 第二个参数表示隐藏进度元素
            }, 300);
            break;
            
        case 'close':
            console.log('用户选择稍后再说');
            if (modal) modal.remove();
            break;
            
        case 'never':
            console.log('用户选择下次不再提醒');
            setDemoPromptSetting('never');
            if (modal) modal.remove();
            showTrayNotification('已设置不再显示演示提示');
            break;
    }
}

// ==================== 自动更新管理模块 ====================

// 更新管理器类
class UpdateManager {
    constructor() {
        this.currentVersion = '10.1.6';
        this.updateStatus = 'idle'; // idle, checking, available, downloading, downloaded, error
        this.downloadProgress = 0;
        this.latestVersion = null;
        this.releaseNotes = null;
        this.settings = this.loadSettings();
        
        // 初始化组件元素
        this.initializeElements();
        this.bindEvents();
        
        // 初始化第6步增强功能
        this.initEnhancedFeatures();
        
        // 【第7步】初始化错误恢复功能
        this.initErrorRecovery();
        
        console.log('🔄 更新管理器已初始化（包含增强功能和错误恢复）');
    }
    
    // 初始化DOM元素
    initializeElements() {
        this.elements = {
            statusIndicator: document.getElementById('updateStatusIndicator'),
            notificationModal: document.getElementById('updateNotificationModal'),
            completeNotification: document.getElementById('updateCompleteNotification'),
            errorNotification: document.getElementById('updateErrorNotification'),
            settingsPanel: document.getElementById('updateSettingsPanel'),
            
            // 模态框内的元素
            currentVersionDisplay: document.getElementById('currentVersionDisplay'),
            latestVersionDisplay: document.getElementById('latestVersionDisplay'),
            releaseNotesContent: document.getElementById('releaseNotesContent'),
            progressContainer: document.getElementById('updateProgressContainer'),
            downloadProgressBar: document.getElementById('downloadProgressBar'),
            downloadPercentage: document.getElementById('downloadPercentage'),
            downloadSpeed: document.getElementById('downloadSpeed'),
            downloadSize: document.getElementById('downloadSize'),
            
            // 按钮
            updateNowBtn: document.getElementById('updateNowBtn'),
            updateLaterBtn: document.getElementById('updateLaterBtn'),
            restartNowBtn: document.getElementById('restartNowBtn'),
            restartLaterBtn: document.getElementById('restartLaterBtn'),
            retryUpdateBtn: document.getElementById('retryUpdateBtn'),
            dismissErrorBtn: document.getElementById('dismissErrorBtn'),
            
            // 设置相关
            autoCheckUpdates: document.getElementById('autoCheckUpdates'),
            autoDownloadUpdates: document.getElementById('autoDownloadUpdates'),
            updateCheckInterval: document.getElementById('updateCheckInterval'),
            updateChannel: document.getElementById('updateChannel'),
            checkUpdateNow: document.getElementById('checkUpdateNow'),
            clearUpdateCache: document.getElementById('clearUpdateCache'),
            settingsCurrentVersion: document.getElementById('settingsCurrentVersion'),
            lastCheckTime: document.getElementById('lastCheckTime')
        };
        
        // 初始化显示内容
        if (this.elements.currentVersionDisplay) {
            this.elements.currentVersionDisplay.textContent = this.currentVersion;
        }
        if (this.elements.settingsCurrentVersion) {
            this.elements.settingsCurrentVersion.textContent = this.currentVersion;
        }
    }
    
    // 绑定事件
    bindEvents() {
        // 主进程更新事件监听
        ipcRenderer.on('update-checking-for-update', () => {
            this.handleCheckingForUpdate();
        });
        
        ipcRenderer.on('update-available', (event, info) => {
            this.handleUpdateAvailable(info);
        });
        
        ipcRenderer.on('update-not-available', (event, info) => {
            this.handleUpdateNotAvailable(info);
        });
        
        ipcRenderer.on('update-download-progress', (event, progressInfo) => {
            this.handleDownloadProgress(progressInfo);
        });
        
        ipcRenderer.on('update-downloaded', (event, info) => {
            this.handleUpdateDownloaded(info);
        });
        
        ipcRenderer.on('update-error', (event, error) => {
            this.handleUpdateError(error);
        });
        
        ipcRenderer.on('update-status-changed', (event, status) => {
            this.updateStatus = status;
            this.updateUI();
        });
        
        // UI事件绑定
        this.bindUIEvents();
    }
    
    // 绑定UI事件
    bindUIEvents() {
        // 关闭按钮
        const updateModalClose = document.getElementById('updateModalClose');
        if (updateModalClose) {
            updateModalClose.addEventListener('click', () => {
                this.hideUpdateModal();
            });
        }
        
        // 更新操作按钮
        if (this.elements.updateNowBtn) {
            this.elements.updateNowBtn.addEventListener('click', () => {
                this.startDownload();
            });
        }
        
        if (this.elements.updateLaterBtn) {
            this.elements.updateLaterBtn.addEventListener('click', () => {
                this.hideUpdateModal();
                this.scheduleReminder();
            });
        }
        
        if (this.elements.restartNowBtn) {
            this.elements.restartNowBtn.addEventListener('click', () => {
                this.installUpdate();
            });
        }
        
        if (this.elements.restartLaterBtn) {
            this.elements.restartLaterBtn.addEventListener('click', () => {
                this.hideCompleteNotification();
            });
        }
        
        if (this.elements.retryUpdateBtn) {
            this.elements.retryUpdateBtn.addEventListener('click', () => {
                this.hideErrorNotification();
                this.checkForUpdates();
            });
        }
        
        if (this.elements.dismissErrorBtn) {
            this.elements.dismissErrorBtn.addEventListener('click', () => {
                this.hideErrorNotification();
            });
        }
        
        // 设置相关按钮
        if (this.elements.checkUpdateNow) {
            this.elements.checkUpdateNow.addEventListener('click', () => {
                this.checkForUpdates();
            });
        }
        
        if (this.elements.clearUpdateCache) {
            this.elements.clearUpdateCache.addEventListener('click', () => {
                this.clearCache();
            });
        }
        
        // 设置面板关闭
        const updateSettingsClose = document.getElementById('updateSettingsClose');
        if (updateSettingsClose) {
            updateSettingsClose.addEventListener('click', () => {
                this.hideSettingsPanel();
            });
        }
        
        // 设置变更监听
        if (this.elements.autoCheckUpdates) {
            this.elements.autoCheckUpdates.addEventListener('change', (e) => {
                this.settings.autoCheck = e.target.checked;
                this.saveSettings();
                ipcRenderer.invoke('save-update-settings', this.settings);
            });
        }
        
        if (this.elements.autoDownloadUpdates) {
            this.elements.autoDownloadUpdates.addEventListener('change', (e) => {
                this.settings.autoDownload = e.target.checked;
                this.saveSettings();
                ipcRenderer.invoke('save-update-settings', this.settings);
            });
        }
        
        if (this.elements.updateCheckInterval) {
            this.elements.updateCheckInterval.addEventListener('change', (e) => {
                this.settings.checkInterval = parseInt(e.target.value);
                this.saveSettings();
                ipcRenderer.invoke('save-update-settings', this.settings);
            });
        }
        
        if (this.elements.updateChannel) {
            this.elements.updateChannel.addEventListener('change', (e) => {
                this.settings.channel = e.target.value;
                this.saveSettings();
                ipcRenderer.invoke('save-update-settings', this.settings);
                ipcRenderer.invoke('set-update-channel', e.target.value);
            });
        }
        
        // 自动下载复选框
        const autoUpdateCheckbox = document.getElementById('autoUpdateCheckbox');
        if (autoUpdateCheckbox) {
            autoUpdateCheckbox.addEventListener('change', (e) => {
                this.settings.autoDownload = e.target.checked;
                this.saveSettings();
                ipcRenderer.invoke('save-update-settings', this.settings);
            });
        }
    }
    
    // 加载设置
    loadSettings() {
        try {
            const saved = localStorage.getItem('updateSettings');
            return saved ? JSON.parse(saved) : {
                autoCheck: true,
                autoDownload: false,
                checkInterval: 24,
                channel: 'stable'
            };
        } catch (error) {
            console.error('加载更新设置失败:', error);
            return {
                autoCheck: true,
                autoDownload: false,
                checkInterval: 24,
                channel: 'stable'
            };
        }
    }
    
    // 保存设置
    saveSettings() {
        try {
            localStorage.setItem('updateSettings', JSON.stringify(this.settings));
        } catch (error) {
            console.error('保存更新设置失败:', error);
        }
    }
    
    // 应用设置到UI
    applySettingsToUI() {
        if (this.elements.autoCheckUpdates) {
            this.elements.autoCheckUpdates.checked = this.settings.autoCheck;
        }
        if (this.elements.autoDownloadUpdates) {
            this.elements.autoDownloadUpdates.checked = this.settings.autoDownload;
        }
        if (this.elements.updateCheckInterval) {
            this.elements.updateCheckInterval.value = this.settings.checkInterval;
        }
        if (this.elements.updateChannel) {
            this.elements.updateChannel.value = this.settings.channel;
        }
        
        const autoUpdateCheckbox = document.getElementById('autoUpdateCheckbox');
        if (autoUpdateCheckbox) {
            autoUpdateCheckbox.checked = this.settings.autoDownload;
        }
    }
    
    // 事件处理方法
    handleCheckingForUpdate() {
        console.log('🔄 开始检查更新');
        this.updateStatus = 'checking';
        this.showStatusIndicator('检查更新中...', 'checking');
        this.updateLastCheckTime();
    }
    
    handleUpdateAvailable(info) {
        console.log('✅ 发现新版本:', info);
        const previousStatus = this.updateStatus;
        this.updateStatus = 'available';
        this.latestVersion = info.version;
        this.releaseNotes = info.releaseNotes;
        
        // 【第6步增强】状态过渡动画
        this.animateStateTransition(previousStatus, 'available');
        
        // 【第6步增强】无障碍通告
        this.announceStatusUpdate(`发现新版本 ${info.version}`);
        
        this.hideStatusIndicator();
        this.showUpdateModal(info);
        
        // 【第6步增强】版本比较动画
        this.enhanceVersionComparison(this.currentVersion, info.version);
        
        showTrayNotification(`发现新版本 ${info.version}`, 'info');
    }
    
    handleUpdateNotAvailable(info) {
        console.log('ℹ️ 当前已是最新版本');
        this.updateStatus = 'idle';
        this.hideStatusIndicator();
        
        // 如果是手动检查，显示提示
        if (this.manualCheck) {
            showTrayNotification('当前已是最新版本', 'success');
            this.manualCheck = false;
        }
    }
    
    handleDownloadProgress(progressInfo) {
        this.downloadProgress = progressInfo.percent;
        
        if (this.elements.downloadProgressBar) {
            this.elements.downloadProgressBar.style.width = `${progressInfo.percent}%`;
        }
        if (this.elements.downloadPercentage) {
            this.elements.downloadPercentage.textContent = `${Math.round(progressInfo.percent)}%`;
        }
        if (this.elements.downloadSpeed && progressInfo.bytesPerSecond) {
            const speed = this.formatBytes(progressInfo.bytesPerSecond) + '/s';
            this.elements.downloadSpeed.textContent = speed;
        }
        if (this.elements.downloadSize && progressInfo.transferred && progressInfo.total) {
            const sizeText = `${this.formatBytes(progressInfo.transferred)} / ${this.formatBytes(progressInfo.total)}`;
            this.elements.downloadSize.textContent = sizeText;
        }
        
        // 【第6步增强】增强进度显示动画
        this.enhanceProgressDisplay(progressInfo);
        
        // 【第6步增强】增强下载速度显示
        if (progressInfo.bytesPerSecond && progressInfo.transferred && progressInfo.total) {
            this.updateDownloadSpeed(progressInfo.transferred, progressInfo.total, Date.now() - (this.performanceMetrics?.downloadStartTime || Date.now()));
        }
        
        console.log(`⬇️ 下载进度: ${Math.round(progressInfo.percent)}%`);
    }
    
    handleUpdateDownloaded(info) {
        console.log('✅ 更新下载完成');
        const previousStatus = this.updateStatus;
        this.updateStatus = 'downloaded';
        
        // 【第6步增强】状态过渡动画
        this.animateStateTransition(previousStatus, 'downloaded');
        
        // 【第6步增强】无障碍通告
        this.announceStatusUpdate('更新已下载完成，可以重启应用');
        
        // 【第6步增强】触觉反馈（成功）
        this.provideTactileFeedback('success');
        
        this.hideUpdateModal();
        this.showCompleteNotification();
        
        showTrayNotification('更新已下载完成，重启应用即可使用新版本', 'success');
    }
    
    handleUpdateError(error) {
        console.error('❌ 更新失败:', error);
        const previousStatus = this.updateStatus;
        this.updateStatus = 'error';
        
        // 【第6步增强】状态过渡动画
        this.animateStateTransition(previousStatus, 'error');
        
        // 【第6步增强】增强错误反馈
        this.enhanceErrorFeedback(error);
        
        // 【第6步增强】无障碍通告
        this.announceStatusUpdate(`更新失败: ${error.message || '未知错误'}`);
        
        this.hideStatusIndicator();
        this.hideUpdateModal();
        this.showErrorNotification(error.message || '更新检查失败');
        
        showTrayNotification('更新失败: ' + (error.message || '未知错误'), 'error');
    }
    
    // UI显示方法
    showStatusIndicator(text, type = 'checking') {
        if (!this.elements.statusIndicator) return;
        
        const icon = this.elements.statusIndicator.querySelector('.update-indicator-icon');
        const textEl = this.elements.statusIndicator.querySelector('.update-indicator-text');
        
        if (icon) {
            icon.textContent = type === 'checking' ? '🔄' : '📥';
        }
        if (textEl) {
            textEl.textContent = text;
        }
        
        this.elements.statusIndicator.classList.add('show');
    }
    
    hideStatusIndicator() {
        if (this.elements.statusIndicator) {
            this.elements.statusIndicator.classList.remove('show');
        }
    }
    
    showUpdateModal(info) {
        if (!this.elements.notificationModal) return;
        
        // 更新版本信息
        if (this.elements.latestVersionDisplay) {
            this.elements.latestVersionDisplay.textContent = info.version;
        }
        
        // 更新发布说明
        if (this.elements.releaseNotesContent && info.releaseNotes) {
            this.elements.releaseNotesContent.innerHTML = this.formatReleaseNotes(info.releaseNotes);
        }
        
        // 重置进度显示
        if (this.elements.progressContainer) {
            this.elements.progressContainer.style.display = 'none';
        }
        
        // 显示模态框
        this.elements.notificationModal.style.display = 'flex';
        setTimeout(() => {
            this.elements.notificationModal.classList.add('show');
        }, 10);
    }
    
    hideUpdateModal() {
        if (this.elements.notificationModal) {
            this.elements.notificationModal.classList.remove('show');
            setTimeout(() => {
                this.elements.notificationModal.style.display = 'none';
            }, 300);
        }
    }
    
    showCompleteNotification() {
        if (!this.elements.completeNotification) return;
        
        this.elements.completeNotification.style.display = 'block';
        setTimeout(() => {
            this.elements.completeNotification.classList.add('show');
        }, 10);
    }
    
    hideCompleteNotification() {
        if (this.elements.completeNotification) {
            this.elements.completeNotification.classList.remove('show');
            setTimeout(() => {
                this.elements.completeNotification.style.display = 'none';
            }, 300);
        }
    }
    
    showErrorNotification(message) {
        if (!this.elements.errorNotification) return;
        
        const errorMessage = document.getElementById('updateErrorMessage');
        if (errorMessage) {
            errorMessage.textContent = message;
        }
        
        this.elements.errorNotification.style.display = 'block';
        setTimeout(() => {
            this.elements.errorNotification.classList.add('show');
        }, 10);
    }
    
    hideErrorNotification() {
        if (this.elements.errorNotification) {
            this.elements.errorNotification.classList.remove('show');
            setTimeout(() => {
                this.elements.errorNotification.style.display = 'none';
            }, 300);
        }
    }
    
    showSettingsPanel() {
        if (!this.elements.settingsPanel) return;
        
        this.applySettingsToUI();
        this.elements.settingsPanel.style.display = 'block';
        setTimeout(() => {
            this.elements.settingsPanel.classList.add('show');
        }, 10);
    }
    
    hideSettingsPanel() {
        if (this.elements.settingsPanel) {
            this.elements.settingsPanel.classList.remove('show');
            setTimeout(() => {
                this.elements.settingsPanel.style.display = 'none';
            }, 300);
        }
    }
    
    // 操作方法
    async checkForUpdates(manual = false) {
        this.manualCheck = manual;
        try {
            await ipcRenderer.invoke('check-for-updates');
        } catch (error) {
            console.error('检查更新失败:', error);
            this.handleUpdateError(error);
        }
    }
    
    async startDownload() {
        try {
            // 【第6步增强】记录下载开始时间
            if (this.performanceMetrics) {
                this.performanceMetrics.downloadStartTime = Date.now();
            }
            
            // 【第6步增强】无障碍通告
            this.announceStatusUpdate('开始下载更新');
            
            // 显示下载进度
            if (this.elements.progressContainer) {
                this.elements.progressContainer.style.display = 'block';
            }
            
            // 更新按钮状态
            if (this.elements.updateNowBtn) {
                this.elements.updateNowBtn.disabled = true;
                this.elements.updateNowBtn.textContent = '下载中...';
            }
            
            await ipcRenderer.invoke('download-update');
        } catch (error) {
            console.error('下载更新失败:', error);
            this.handleUpdateError(error);
        }
    }
    
    async installUpdate() {
        try {
            await ipcRenderer.invoke('install-update');
        } catch (error) {
            console.error('安装更新失败:', error);
            showTrayNotification('安装更新失败: ' + error.message, 'error');
        }
    }
    
    async clearCache() {
        try {
            await ipcRenderer.invoke('clear-update-cache');
            showTrayNotification('更新缓存已清除', 'success');
        } catch (error) {
            console.error('清除缓存失败:', error);
            showTrayNotification('清除缓存失败: ' + error.message, 'error');
        }
    }
    
    scheduleReminder() {
        // 30分钟后再次提醒
        setTimeout(() => {
            if (this.updateStatus === 'available') {
                showTrayNotification('有新版本可用，建议尽快更新', 'info');
            }
        }, 30 * 60 * 1000);
    }
    
    // 工具方法
    formatBytes(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }
    
    formatReleaseNotes(notes) {
        if (typeof notes === 'string') {
            // 简单的文本格式化
            return notes.split('\n').map(line => {
                line = line.trim();
                if (line.startsWith('* ') || line.startsWith('- ')) {
                    return `<p>• ${line.substring(2)}</p>`;
                } else if (line) {
                    return `<p>${line}</p>`;
                }
                return '';
            }).join('');
        }
        return '<p>• 新增自动更新功能</p><p>• 优化性能和稳定性</p><p>• 修复已知问题</p>';
    }
    
    updateLastCheckTime() {
        const now = new Date();
        const timeStr = now.toLocaleString('zh-CN');
        if (this.elements.lastCheckTime) {
            this.elements.lastCheckTime.textContent = timeStr;
        }
        localStorage.setItem('lastUpdateCheck', timeStr);
    }
    
    updateUI() {
        // 根据当前状态更新UI
        // 这里可以添加更多状态相关的UI更新逻辑
    }
    
    /* ========================================
       第6步：增强用户交互和进度显示逻辑
       ======================================== */
    
    /**
     * 增强进度条动画效果
     */
    enhanceProgressDisplay(progressData) {
        const progressFill = document.querySelector('.progress-bar-fill');
        if (progressFill) {
            // 添加光效动画
            progressFill.classList.add('progress-enhanced');
            
            // 更新进度数值时添加动画
            const percentage = document.querySelector('.progress-percentage');
            if (percentage) {
                percentage.classList.add('updating');
                setTimeout(() => {
                    percentage.classList.remove('updating');
                }, 300);
            }
        }
    }
    
    /**
     * 添加键盘快捷键支持
     */
    initKeyboardShortcuts() {
        document.addEventListener('keydown', (event) => {
            // Escape键关闭模态框
            if (event.key === 'Escape') {
                this.hideAllNotifications();
            }
            
            // Enter键确认操作
            if (event.key === 'Enter') {
                const visibleModal = document.querySelector('.update-notification-modal.show');
                if (visibleModal) {
                    const primaryBtn = visibleModal.querySelector('.update-btn.primary');
                    if (primaryBtn && !primaryBtn.disabled) {
                        primaryBtn.click();
                    }
                }
            }
            
            // Space键暂停/继续下载
            if (event.key === ' ' && event.ctrlKey) {
                event.preventDefault();
                this.handlePauseResumeDownload();
            }
            
            // F5刷新检查更新
            if (event.key === 'F5') {
                event.preventDefault();
                this.checkForUpdates(true);
            }
        });
    }
    
    /**
     * 隐藏所有通知
     */
    hideAllNotifications() {
        this.hideUpdateModal();
        this.hideCompleteNotification();
        this.hideErrorNotification();
        this.hideSettingsPanel();
    }
    
    /**
     * 处理下载暂停/恢复
     */
    handlePauseResumeDownload() {
        if (this.updateStatus === 'downloading') {
            window.electronAPI?.pauseUpdate();
            this.showToast('下载已暂停', 'info');
        } else if (this.updateStatus === 'paused') {
            window.electronAPI?.resumeUpdate();
            this.showToast('下载已恢复', 'info');
        }
    }
    
    /**
     * 增强版本比较动画
     */
    enhanceVersionComparison(currentVersion, newVersion) {
        const versionComparison = document.querySelector('.version-comparison');
        if (versionComparison) {
            // 添加动画类
            const newVersionElement = versionComparison.querySelector('.version-item.new');
            if (newVersionElement) {
                newVersionElement.classList.add('version-highlight');
            }
            
            // 箭头流动动画
            const arrow = versionComparison.querySelector('.version-arrow');
            if (arrow) {
                arrow.classList.add('flowing');
            }
        }
    }
    
    /**
     * 智能状态过渡动画
     */
    animateStateTransition(fromState, toState) {
        const indicator = this.elements.statusIndicator;
        if (!indicator) return;
        
        // 移除所有状态类
        indicator.classList.remove('idle', 'checking', 'downloading', 'downloaded', 'error', 'success');
        
        // 添加过渡动画
        indicator.classList.add('update-status-transition');
        
        // 应用新状态
        setTimeout(() => {
            indicator.classList.add(toState);
            indicator.classList.remove('update-status-transition');
        }, 150);
    }
    
    /**
     * 增强错误处理UI反馈
     */
    enhanceErrorFeedback(error) {
        const errorNotification = this.elements.errorNotification;
        if (errorNotification) {
            // 错误震动效果
            errorNotification.style.animation = 'errorShake 0.5s ease';
            
            // 根据错误类型显示不同图标
            const errorIcon = errorNotification.querySelector('.error-icon');
            if (errorIcon) {
                if (error.code === 'NETWORK_ERROR') {
                    errorIcon.textContent = '📡';
                } else if (error.code === 'PERMISSION_ERROR') {
                    errorIcon.textContent = '🔒';
                } else {
                    errorIcon.textContent = '⚠️';
                }
            }
        }
    }
    
    /**
     * 触觉反馈（移动端）
     */
    provideTactileFeedback(type = 'light') {
        if ('vibrate' in navigator) {
            switch (type) {
                case 'light':
                    navigator.vibrate(10);
                    break;
                case 'medium':
                    navigator.vibrate(25);
                    break;
                case 'heavy':
                    navigator.vibrate(50);
                    break;
                case 'success':
                    navigator.vibrate([50, 50, 100]);
                    break;
                case 'error':
                    navigator.vibrate([100, 50, 100, 50, 100]);
                    break;
            }
        }
    }
    
    /**
     * 智能Toast通知系统
     */
    showToast(message, type = 'info', duration = 3000) {
        // 创建toast容器
        let toastContainer = document.querySelector('.toast-container');
        if (!toastContainer) {
            toastContainer = document.createElement('div');
            toastContainer.className = 'toast-container';
            document.body.appendChild(toastContainer);
        }
        
        // 创建toast元素
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        toast.innerHTML = `
            <div class="toast-icon">${this.getToastIcon(type)}</div>
            <div class="toast-message">${message}</div>
            <button class="toast-close" onclick="this.parentElement.remove()">✕</button>
        `;
        
        // 添加到容器
        toastContainer.appendChild(toast);
        
        // 触发入场动画
        setTimeout(() => {
            toast.classList.add('toast-show');
        }, 10);
        
        // 自动移除
        setTimeout(() => {
            toast.classList.remove('toast-show');
            setTimeout(() => {
                if (toast.parentElement) {
                    toast.remove();
                }
            }, 300);
        }, duration);
        
        // 提供触觉反馈
        this.provideTactileFeedback(type === 'error' ? 'error' : 'light');
    }
    
    /**
     * 获取Toast图标
     */
    getToastIcon(type) {
        const icons = {
            info: 'ℹ️',
            success: '✅',
            warning: '⚠️',
            error: '❌'
        };
        return icons[type] || icons.info;
    }
    
    /**
     * 增强下载速度计算和显示
     */
    updateDownloadSpeed(bytesReceived, totalBytes, timeElapsed) {
        const speed = bytesReceived / (timeElapsed / 1000); // 字节/秒
        const speedElement = this.elements.downloadSpeed;
        
        if (speedElement) {
            const formattedSpeed = this.formatBytes(speed) + '/s';
            speedElement.textContent = formattedSpeed;
            
            // 添加速度指示器动画
            speedElement.classList.add('speed-updating');
            setTimeout(() => {
                speedElement.classList.remove('speed-updating');
            }, 500);
            
            // 估算剩余时间
            const remainingBytes = totalBytes - bytesReceived;
            const estimatedTimeLeft = remainingBytes / speed;
            this.updateTimeRemaining(estimatedTimeLeft);
        }
    }
    
    /**
     * 更新剩余时间显示
     */
    updateTimeRemaining(secondsLeft) {
        const timeElement = document.querySelector('.time-remaining');
        if (timeElement && secondsLeft > 0) {
            const formattedTime = this.formatTime(secondsLeft);
            timeElement.textContent = `剩余时间: ${formattedTime}`;
            timeElement.style.display = 'block';
        }
    }
    
    /**
     * 格式化时间显示
     */
    formatTime(seconds) {
        if (seconds < 60) {
            return `${Math.round(seconds)}秒`;
        } else if (seconds < 3600) {
            const minutes = Math.floor(seconds / 60);
            const remainingSeconds = Math.round(seconds % 60);
            return `${minutes}分${remainingSeconds}秒`;
        } else {
            const hours = Math.floor(seconds / 3600);
            const minutes = Math.floor((seconds % 3600) / 60);
            return `${hours}小时${minutes}分钟`;
        }
    }
    
    /**
     * 增强设置面板交互
     */
    enhanceSettingsPanel() {
        const settingsPanel = this.elements.settingsPanel;
        if (!settingsPanel) return;
        
        // 添加设置项实时验证
        const checkboxes = settingsPanel.querySelectorAll('input[type="checkbox"]');
        checkboxes.forEach(checkbox => {
            checkbox.addEventListener('change', (e) => {
                // 添加视觉反馈
                const label = e.target.closest('label');
                if (label) {
                    label.classList.add('setting-changed');
                    setTimeout(() => {
                        label.classList.remove('setting-changed');
                    }, 300);
                }
                
                // 提供触觉反馈
                this.provideTactileFeedback('light');
            });
        });
        
        // 添加设置冲突检测
        this.validateSettingsCombination();
    }
    
    /**
     * 验证设置组合
     */
    validateSettingsCombination() {
        const autoCheck = this.elements.autoCheckUpdates?.checked;
        const autoDownload = this.elements.autoDownloadUpdates?.checked;
        const autoInstall = document.querySelector('#autoInstall')?.checked;
        
        // 逻辑验证和用户提示
        if (autoInstall && !autoDownload) {
            this.showToast('自动安装需要启用自动下载', 'warning');
        }
        
        if (autoDownload && !autoCheck) {
            this.showToast('自动下载需要启用自动检查', 'warning');
        }
    }
    
    /**
     * 增强模态框交互
     */
    enhanceModalInteraction() {
        const modal = this.elements.notificationModal;
        if (!modal) return;
        
        // 点击外部关闭
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                this.hideUpdateModal();
            }
        });
        
        // 阻止内容点击冒泡
        const content = modal.querySelector('.update-modal-content');
        if (content) {
            content.addEventListener('click', (e) => {
                e.stopPropagation();
            });
        }
    }
    
    /**
     * 性能监控和优化
     */
    initPerformanceMonitoring() {
        // 监控更新过程的性能指标
        this.performanceMetrics = {
            downloadStartTime: null,
            downloadEndTime: null,
            checkStartTime: null,
            checkEndTime: null
        };
        
        // 检测低性能设备
        this.detectLowPerformanceDevice();
    }
    
    /**
     * 检测低性能设备
     */
    detectLowPerformanceDevice() {
        const hardwareConcurrency = navigator.hardwareConcurrency || 2;
        const memory = navigator.deviceMemory || 2;
        
        if (hardwareConcurrency <= 2 || memory <= 2) {
            // 为低性能设备优化
            this.optimizeForLowPerformance();
        }
    }
    
    /**
     * 低性能设备优化
     */
    optimizeForLowPerformance() {
        // 减少动画
        document.body.classList.add('reduce-animations');
        
        // 降低更新检查频率
        this.settings.checkInterval = Math.max(
            this.settings.checkInterval * 2, 
            30 * 60 * 1000 // 最少30分钟
        );
        
        // 简化UI反馈
        this.settings.enableAdvancedAnimations = false;
    }
    
    /**
     * 增强无障碍支持
     */
    enhanceAccessibility() {
        // 为屏幕阅读器添加实时更新通知
        this.createAccessibilityAnnouncer();
        
        // 增强键盘导航
        this.enhanceKeyboardNavigation();
        
        // 高对比度模式支持
        this.checkHighContrastMode();
    }
    
    /**
     * 创建无障碍通告器
     */
    createAccessibilityAnnouncer() {
        if (!document.querySelector('#update-announcer')) {
            const announcer = document.createElement('div');
            announcer.id = 'update-announcer';
            announcer.setAttribute('aria-live', 'polite');
            announcer.setAttribute('aria-atomic', 'true');
            announcer.style.position = 'absolute';
            announcer.style.left = '-10000px';
            announcer.style.width = '1px';
            announcer.style.height = '1px';
            announcer.style.overflow = 'hidden';
            document.body.appendChild(announcer);
        }
    }
    
    /**
     * 通告状态更新
     */
    announceStatusUpdate(message) {
        const announcer = document.querySelector('#update-announcer');
        if (announcer) {
            announcer.textContent = message;
        }
    }
    
    /**
     * 增强键盘导航
     */
    enhanceKeyboardNavigation() {
        // 为所有按钮添加焦点管理
        const buttons = document.querySelectorAll('.update-btn, .complete-btn, .error-btn, .setting-btn');
        
        buttons.forEach((button, index) => {
            button.setAttribute('tabindex', index + 1);
            
            button.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    button.click();
                }
            });
        });
    }
    
    /**
     * 检查高对比度模式
     */
    checkHighContrastMode() {
        if (window.matchMedia('(prefers-contrast: high)').matches) {
            document.body.classList.add('high-contrast');
        }
    }
    
    /**
     * 初始化增强功能
     */
    initEnhancedFeatures() {
        this.initKeyboardShortcuts();
        this.enhanceSettingsPanel();
        this.enhanceModalInteraction();
        this.initPerformanceMonitoring();
        this.enhanceAccessibility();
        
        // 添加CSS样式到DOM
        this.injectEnhancedStyles();
    }
    
    /**
     * 【第7步】初始化错误恢复功能
     */
    initErrorRecovery() {
        console.log('🛡️ 初始化错误恢复功能');
        
        // 初始化错误恢复状态
        this.errorRecovery = {
            enabled: true,
            maxRetries: 3,
            retryDelay: 2000,
            currentRetries: 0,
            lastError: null,
            recoveryStrategies: ['cache-clear', 'restart-service', 'force-update']
        };
        
        // 监听应用级错误
        window.addEventListener('error', (event) => {
            if (event.filename && event.filename.includes('renderer.js')) {
                this.handleGlobalError(event.error);
            }
        });
        
        // 监听未处理的Promise拒绝
        window.addEventListener('unhandledrejection', (event) => {
            if (event.reason && event.reason.toString().includes('update')) {
                this.handleGlobalError(event.reason);
            }
        });
        
        console.log('✅ 错误恢复功能初始化完成');
    }
    
    /**
     * 全局错误处理
     */
    handleGlobalError(error) {
        console.error('🚨 检测到全局错误:', error);
        
        if (this.errorRecovery.currentRetries < this.errorRecovery.maxRetries) {
            this.errorRecovery.currentRetries++;
            this.errorRecovery.lastError = error;
            
            console.log(`🔄 尝试错误恢复 (${this.errorRecovery.currentRetries}/${this.errorRecovery.maxRetries})`);
            
            // 延迟后尝试恢复
            setTimeout(() => {
                this.attemptErrorRecovery();
            }, this.errorRecovery.retryDelay);
        } else {
            console.error('❌ 错误恢复尝试次数已达上限');
            this.showFatalErrorNotification(error);
        }
    }
    
    /**
     * 尝试错误恢复
     */
    async attemptErrorRecovery() {
        try {
            const strategy = this.errorRecovery.recoveryStrategies[this.errorRecovery.currentRetries - 1];
            console.log(`🛠️ 执行恢复策略: ${strategy}`);
            
            switch (strategy) {
                case 'cache-clear':
                    await this.clearCache();
                    await this.checkForUpdates();
                    break;
                case 'restart-service':
                    await ipcRenderer.invoke('restart-update-service');
                    break;
                case 'force-update':
                    await ipcRenderer.invoke('force-check-updates');
                    break;
            }
            
            // 恢复成功，重置计数器
            this.errorRecovery.currentRetries = 0;
            console.log('✅ 错误恢复成功');
            
        } catch (recoveryError) {
            console.error('🚨 错误恢复失败:', recoveryError);
            this.handleGlobalError(recoveryError);
        }
    }
    
    /**
     * 显示致命错误通知
     */
    showFatalErrorNotification(error) {
        const notification = document.createElement('div');
        notification.className = 'fatal-error-notification';
        notification.innerHTML = `
            <div class="fatal-error-content">
                <h3>🚨 更新系统遇到严重错误</h3>
                <p>更新功能暂时不可用，请重启应用或联系技术支持。</p>
                <details>
                    <summary>错误详情</summary>
                    <pre>${error.message || error.toString()}</pre>
                </details>
                <button onclick="this.parentElement.parentElement.remove()">关闭</button>
            </div>
        `;
        
        // 添加基础样式
        notification.style.cssText = `
            position: fixed;
            top: 20px;
            left: 50%;
            transform: translateX(-50%);
            z-index: 10001;
            background: #fef2f2;
            border: 1px solid #fecaca;
            border-radius: 8px;
            padding: 16px;
            max-width: 400px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        `;
        
        notification.querySelector('.fatal-error-content').style.cssText = `
            text-align: left;
        `;
        
        notification.querySelector('h3').style.cssText = `
            margin: 0 0 8px 0;
            color: #dc2626;
        `;
        
        notification.querySelector('p').style.cssText = `
            margin: 0 0 12px 0;
            color: #374151;
        `;
        
        notification.querySelector('button').style.cssText = `
            background: #dc2626;
            color: white;
            border: none;
            padding: 8px 16px;
            border-radius: 4px;
            cursor: pointer;
        `;
        
        document.body.appendChild(notification);
        
        // 10秒后自动隐藏
        setTimeout(() => {
            if (notification.parentElement) {
                notification.remove();
            }
        }, 10000);
    }
    
    /**
     * 注入增强样式
     */
    injectEnhancedStyles() {
        if (!document.querySelector('#enhanced-update-styles')) {
            const styles = document.createElement('style');
            styles.id = 'enhanced-update-styles';
            styles.textContent = `
                /* Toast通知样式 */
                .toast-container {
                    position: fixed;
                    top: 20px;
                    right: 20px;
                    z-index: 10000;
                    pointer-events: none;
                }
                
                .toast {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    padding: 12px 16px;
                    background: white;
                    border-radius: 8px;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
                    margin-bottom: 8px;
                    transform: translateX(400px);
                    opacity: 0;
                    transition: all 0.3s ease;
                    pointer-events: auto;
                    max-width: 300px;
                }
                
                .toast.toast-show {
                    transform: translateX(0);
                    opacity: 1;
                }
                
                .toast-info { border-left: 4px solid #3b82f6; }
                .toast-success { border-left: 4px solid #22c55e; }
                .toast-warning { border-left: 4px solid #f59e0b; }
                .toast-error { border-left: 4px solid #ef4444; }
                
                .toast-icon {
                    font-size: 16px;
                    flex-shrink: 0;
                }
                
                .toast-message {
                    flex: 1;
                    font-size: 14px;
                    color: #374151;
                }
                
                .toast-close {
                    background: none;
                    border: none;
                    font-size: 14px;
                    color: #6b7280;
                    cursor: pointer;
                    padding: 0;
                    width: 20px;
                    height: 20px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }
                
                /* 设置变更动画 */
                .setting-changed {
                    animation: settingHighlight 0.3s ease !important;
                }
                
                @keyframes settingHighlight {
                    0% { background-color: transparent; }
                    50% { background-color: rgba(59, 130, 246, 0.1); }
                    100% { background-color: transparent; }
                }
                
                /* 速度更新动画 */
                .speed-updating {
                    animation: speedPulse 0.5s ease;
                }
                
                @keyframes speedPulse {
                    0%, 100% { transform: scale(1); }
                    50% { transform: scale(1.05); }
                }
                
                /* 剩余时间显示 */
                .time-remaining {
                    font-size: 12px;
                    color: #6b7280;
                    margin-top: 4px;
                    display: none;
                }
                
                /* 低性能设备优化 */
                .reduce-animations * {
                    animation-duration: 0.1s !important;
                    transition-duration: 0.1s !important;
                }
                
                /* 高对比度模式 */
                .high-contrast .update-btn {
                    border: 2px solid #000 !important;
                }
                
                .high-contrast .update-modal-content {
                    border: 3px solid #000 !important;
                }
            `;
            document.head.appendChild(styles);
        }
    }
}

// 全局更新管理器实例
let updateManager = null;

// 初始化更新管理器
function initializeUpdateManager() {
    try {
        updateManager = new UpdateManager();
        
        // 在设置按钮添加更新设置入口
        addUpdateSettingsEntry();
        
        // 应用启动后延迟检查更新
        setTimeout(() => {
            if (updateManager.settings.autoCheck) {
                updateManager.checkForUpdates();
            }
        }, 5000); // 5秒后检查
        
        console.log('✅ 更新管理器初始化完成');
    } catch (error) {
        console.error('❌ 更新管理器初始化失败:', error);
    }
}

// 在设置中添加更新设置入口
function addUpdateSettingsEntry() {
    const settingsModal = document.getElementById('settingsModal');
    if (!settingsModal) return;
    
    const settingsForm = settingsModal.querySelector('#settingsForm');
    if (!settingsForm) return;
    
    // 在表单中添加更新设置按钮
    const updateSettingsBtn = document.createElement('div');
    updateSettingsBtn.className = 'form-group';
    updateSettingsBtn.innerHTML = `
        <button type="button" id="openUpdateSettings" class="action-button" style="width: 100%; margin-top: 10px;">
            <span style="margin-right: 8px;">🔄</span>更新设置
        </button>
    `;
    
    // 插入到表单的保存按钮之前
    const buttonGroup = settingsForm.querySelector('.button-group');
    if (buttonGroup) {
        settingsForm.insertBefore(updateSettingsBtn, buttonGroup);
        
        // 添加点击事件
        const openUpdateSettingsBtn = document.getElementById('openUpdateSettings');
        if (openUpdateSettingsBtn) {
            openUpdateSettingsBtn.addEventListener('click', () => {
                // 关闭设置弹窗
                settingsModal.style.display = 'none';
                // 显示更新设置面板
                if (updateManager) {
                    updateManager.showSettingsPanel();
                }
            });
        }
    }
}

// 初始化更新管理器
document.addEventListener('DOMContentLoaded', () => {
    // 延迟初始化，确保其他组件先完成
    setTimeout(() => {
        initializeUpdateManager();
    }, 2000);
});

// 导出更新管理器实例供其他模块使用
window.updateManager = updateManager;