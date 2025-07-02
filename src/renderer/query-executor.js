const { delay, interruptibleDelay, addressMatches, formatDate, waitForTableContentChangeOrAppear, waitForTableContentChangeOrAppearAdvanced } = require('./utils');

// 添加重试工具函数
async function retryOperation(operation, maxRetries = 3, delay = 1000) {
    let lastError;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await operation();
        } catch (error) {
            lastError = error;
            console.log(`操作失败，尝试第 ${attempt}/${maxRetries} 次重试，错误:`, error.message);
            if (attempt < maxRetries) {
                await new Promise(resolve => setTimeout(resolve, delay));
                // 每次重试增加延迟
                delay = Math.min(delay * 1.5, 5000);
            }
        }
    }
    throw lastError;
}

class QueryExecutor {
    constructor(config) {
        this.config = config;
    }

    // 清空查询表单的辅助方法
    async clearSearchForm(page) {
        try {
            console.log('开始彻底清空查询表单...');
            
            // 第一次清空：基本清理
            const firstClearResult = await page.evaluate(() => {
                const formInputs = document.querySelectorAll('.n-input__input-el');
                let clearedCount = 0;
                const problematicFields = [];
                
                formInputs.forEach((input, index) => {
                    const originalValue = input.value;
                    if (originalValue) {
                        // 多种方式清空输入框
                        input.value = '';
                        input.setAttribute('value', '');
                        
                        // 触发多个事件确保清空生效
                        input.dispatchEvent(new Event('input', { bubbles: true }));
                        input.dispatchEvent(new Event('change', { bubbles: true }));
                        input.dispatchEvent(new Event('blur', { bubbles: true }));
                        
                        clearedCount++;
                        
                        // 检查是否清空成功
                        if (input.value !== '') {
                            problematicFields.push({
                                index,
                                value: input.value,
                                placeholder: input.placeholder
                            });
                        }
                    }
                });
                
                console.log(`第一次清空：已处理 ${clearedCount} 个表单字段`);
                return { clearedCount, problematicFields };
            });
            
            if (firstClearResult.problematicFields.length > 0) {
                console.log('发现未清空的字段，进行二次清理:', firstClearResult.problematicFields);
            }
            
            // 等待一下让事件处理完成
            try {
                await interruptibleDelay(200);
            } catch (error) {
                if (error.message === 'Operation cancelled') {
                    console.log('清空表单操作被取消');
                    throw error;
                }
            }
            
            // 第二次清空：针对性清理和验证
            const secondClearResult = await page.evaluate(() => {
                const formItems = document.querySelectorAll('.n-form-item');
                const specialFields = ['FirstName', 'LastName', 'zip', 'address', 'DOB', 'SSN', 'city', 'st'];
                let specialClearedCount = 0;
                
                formItems.forEach(item => {
                    const labelEl = item.querySelector('.n-form-item-label');
                    if (!labelEl) return;
                    
                    const label = labelEl.textContent;
                    const input = item.querySelector('.n-input__input-el');
                    if (!input) return;
                    
                    // 针对特定字段的彻底清理
                    if (specialFields.includes(label)) {
                        const originalValue = input.value;
                        
                        // 使用更强制的方式清空
                        input.focus();
                        input.select();
                        document.execCommand('delete');
                        
                        // 再次设置为空
                        input.value = '';
                        input.setAttribute('value', '');
                        
                        // 触发所有相关事件
                        ['input', 'change', 'keyup', 'keydown', 'blur'].forEach(eventType => {
                            input.dispatchEvent(new Event(eventType, { bubbles: true }));
                        });
                        
                        if (originalValue) {
                            console.log(`特别清除 ${label} 字段，原值: ${originalValue}, 新值: ${input.value}`);
                            specialClearedCount++;
                        }
                        
                        // 最后验证
                        if (input.value !== '') {
                            console.warn(`警告: ${label} 字段清空可能失败，当前值: ${input.value}`);
                        }
                    }
                });
                
                // 最终验证所有输入框是否为空
                const allInputs = document.querySelectorAll('.n-input__input-el');
                const nonEmptyInputs = Array.from(allInputs).filter(input => input.value !== '');
                
                return {
                    specialClearedCount,
                    totalInputs: allInputs.length,
                    nonEmptyInputs: nonEmptyInputs.length,
                    nonEmptyValues: nonEmptyInputs.map(input => ({
                        value: input.value,
                        placeholder: input.placeholder
                    }))
                };
            });
            
            // 等待清空操作完全生效
            try {
                await interruptibleDelay(300);
            } catch (error) {
                if (error.message === 'Operation cancelled') {
                    console.log('清空表单操作被取消');
                    throw error;
                }
            }
            
            // 报告清理结果
            console.log('表单清理完成:', {
                第一次清理: firstClearResult.clearedCount + ' 个字段',
                第二次清理: secondClearResult.specialClearedCount + ' 个特殊字段',
                总输入框数: secondClearResult.totalInputs,
                未清空数量: secondClearResult.nonEmptyInputs
            });
            
            if (secondClearResult.nonEmptyInputs > 0) {
                console.warn('警告: 仍有输入框未能清空:', secondClearResult.nonEmptyValues);
            }
            
            return secondClearResult.nonEmptyInputs === 0;
        } catch (error) {
            console.error('清空查询表单失败:', error);
            return false;
        }
    }

    // 在单个浏览器中执行查询
    async executeQuery(browser, searchParams) {
        const { firstName, lastName, zipCode, state, address, useStateSearch, birthDate } = searchParams;

        return new Promise(async (resolve, reject) => {
            // 检查全局取消标志
            if (window.globalShouldStop) {
                console.log('查询开始前检测到取消标志，直接返回');
                resolve([]);
                return;
            }
            let page = null;
            const timeout = setTimeout(() => {
                if (!window.globalShouldStop) {
                    reject(new Error('查询超时'));
                }
            }, this.config.BROWSER_TIMEOUT);

            try {
                // 使用BrowserManager获取可用页面
                page = await browser.getAvailablePage();
                
                // 检查取消标志
                if (window.globalShouldStop) {
                    console.log('获取页面后检测到取消标志');
                    clearTimeout(timeout);
                    resolve([]);
                    return;
                }

                // 回到第一页
                await goToFirstPage(page);
                
                // 检查取消标志
                if (window.globalShouldStop) {
                    console.log('回到第一页后检测到取消标志');
                    clearTimeout(timeout);
                    resolve([]);
                    return;
                }
                
                // 【修改】使用单次页面状态检查函数
                await ensurePageStateOnce(page, this);
                
                // 设置查询参数
                console.log('正在设置查询参数...');
                await this.setSearchParams(page, searchParams);
                
                // 检查取消标志
                if (window.globalShouldStop) {
                    console.log('设置参数后检测到取消标志');
                    clearTimeout(timeout);
                    resolve([]);
                    return;
                }
                
                // 执行查询并获取结果
                console.log(`正在查询地址: ${address}...`);
                const results = await this.performSearch(page, address);
                console.log(`查询完成，找到 ${results.length} 条结果`);
                
                clearTimeout(timeout);
                resolve(results);
            } catch (error) {
                clearTimeout(timeout);
                if (error.message === 'Operation cancelled' || window.globalShouldStop) {
                    console.log('查询被取消');
                    resolve([]);
                } else {
                    console.error('查询执行错误:', error);
                    reject(error);
                }
            } finally {
                if (page) {
                    // 释放页面而不是关闭它，以便复用
                    browser.releasePage(page);
                }
            }
        });
    }
    
    // 高级搜索方法 - 不进行地址匹配过滤（除非用户填写了地址）
    async executeAdvancedQuery(browser, searchParams, progressCallback = null) {
        const { firstName, lastName, dob, ssn, address, city, state, zipCode } = searchParams;

        return new Promise(async (resolve, reject) => {
            // 检查全局取消标志
            if (window.globalShouldStop) {
                console.log('高级查询开始前检测到取消标志，直接返回');
                resolve([]);
                return;
            }
            let page = null;
            try {
                // 使用BrowserManager获取可用页面
                page = await browser.getAvailablePage();

                // 回到第一页
                await goToFirstPage(page);
                
                // 【修改】使用单次页面状态检查函数
                await ensurePageStateOnce(page, this);
                
                // 设置高级查询参数
                console.log('正在设置高级查询参数...');
                await this.setAdvancedSearchParams(page, searchParams);
                
                // 执行查询并获取结果
                console.log(`正在执行高级查询...`);
                const results = await this.performAdvancedSearch(page, address, progressCallback);
                console.log(`高级查询完成，找到 ${results.length} 条结果`);
                
                resolve(results);
            } catch (error) {
                console.error('高级查询执行错误:', error);
                reject(error);
            } finally {
                if (page) {
                    // 释放页面而不是关闭它，以便复用
                    browser.releasePage(page);
                }
            }
        });
    }

    // 执行登录 - 完全按照1.js的实现
    async performLogin(page) {
        try {
            // 获取用户配置的账号密码
            let username = '1805'; // 默认值
            let password = '1805'; // 默认值
            
            // 优先从window.SETTINGS读取配置
            if (window.SETTINGS && window.SETTINGS.username && window.SETTINGS.password) {
                username = window.SETTINGS.username;
                password = window.SETTINGS.password;
                console.log('从window.SETTINGS读取到用户配置的账号密码');
            } else {
                // 其次从localStorage读取配置
                try {
                    const savedSettings = JSON.parse(localStorage.getItem('appSettings') || '{}');
                    if (savedSettings.username && savedSettings.password) {
                        username = savedSettings.username;
                        password = savedSettings.password;
                        console.log('从localStorage读取到用户配置的账号密码');
                    } else {
                        console.log('未找到用户配置的账号密码，使用默认值1805');
                    }
                } catch (error) {
                    console.warn('读取localStorage配置失败，使用默认值:', error);
                }
            }
            
            console.log('将使用的登录信息 - 账号:', username, '密码:', password.replace(/./g, '*'));
            
            // 设置网络响应监听，检测登录API的响应状态
            let loginApiSuccess = false;
            const responseHandler = (response) => {
                if (response.url().includes('/api/rest/user/login') && response.status() === 200) {
                    console.log('检测到登录API成功响应:', response.status());
                    loginApiSuccess = true;
                }
            };
            
            page.on('response', responseHandler);
            
            // 等待登录表单加载
            await page.waitForSelector('.n-form', { timeout: 5000 });
            console.log('登录表单已加载');
            
            // 使用evaluateHandle来直接操作DOM，更接近1.js的实现
            await page.evaluate((loginCredentials) => {
                const inputs = document.querySelectorAll('.n-input__input-el');
                if (inputs.length >= 2) {
                    inputs[0].value = loginCredentials.username;
                    inputs[0].dispatchEvent(new Event('input'));
                    inputs[1].value = loginCredentials.password;
                    inputs[1].dispatchEvent(new Event('input'));
                    
                    // 查找登录按钮
                    const buttons = Array.from(document.querySelectorAll('button'));
                    const loginButton = buttons.find(btn => btn.textContent.includes('登录'));
                    if (loginButton) {
                        loginButton.click();
                    }
                }
            }, { username, password });
            
            // 等待登录完成 - 增加等待时间，并检测API响应
            try {
                await interruptibleDelay(1000); // 增加等待时间以确保API响应被捕获
            } catch (error) {
                if (error.message === 'Operation cancelled') {
                    console.log('登录操作被取消');
                    throw error;
                }
            }
            
            // 移除响应监听器
            page.off('response', responseHandler);
            
            console.log('登录完成，API响应状态:', loginApiSuccess ? '成功' : '未检测到成功响应');
            
            // 登录成功后，等待页面加载完成
            await page.waitForSelector('.n-layout-header', { timeout: 5000 }).catch(() => {
                console.log('未找到页面头部，可能页面结构有变化');
            });

            // 登录成功后点击高级搜索并设置每页显示100条
            await page.evaluate(() => {
                // 展开高级搜索
                const arrowIcon = document.querySelector('i.iconfont[class*="_pointer_"]');
                if (arrowIcon && arrowIcon.classList.contains('icon-arrow-down')) {
                    const advancedSearchButton = document.querySelector('span[class*="_icon-title_"][style*="color: rgb(68, 126, 217)"]');
                    if (advancedSearchButton) {
                        advancedSearchButton.click();
                        console.log('已点击高级搜索按钮');
                    }
                }
            });

            // 等待高级搜索展开
            try {
                await interruptibleDelay(500);
            } catch (error) {
                if (error.message === 'Operation cancelled') {
                    console.log('展开高级搜索被取消');
                    throw error;
                }
            }

            // 设置每页显示100条
            await page.evaluate(() => {
                const pageSizeSelect = document.querySelector('.n-base-selection');
                if (pageSizeSelect) {
                    pageSizeSelect.click();
                }
            });

            // 等待下拉菜单显示
            try {
                await interruptibleDelay(500);
            } catch (error) {
                if (error.message === 'Operation cancelled') {
                    console.log('等待下拉菜单被取消');
                    throw error;
                }
            }

            // 选择每页100条
            await page.evaluate(() => {
                const menuItems = document.querySelectorAll('.n-base-select-option');
                const option100 = Array.from(menuItems).find(item => item.textContent.includes('100'));
                if (option100) {
                    option100.click();
                    console.log('已设置每页显示100条');
                }
            });

            // 等待下拉菜单关闭
            try {
                await interruptibleDelay(500);
            } catch (error) {
                if (error.message === 'Operation cancelled') {
                    console.log('等待下拉菜单关闭被取消');
                    throw error;
                }
            }
            
            // 登录成功后清空所有表单字段，防止登录凭据被错误地用作查询参数
            await this.clearSearchForm(page);
            console.log('登录后已清空所有表单字段');
            
            // 设置登录成功标记到sessionStorage，供登录状态检查使用
            await page.evaluate((apiSuccess) => {
                try {
                    const loginData = {
                        timestamp: Date.now(),
                        apiSuccess: apiSuccess
                    };
                    window.sessionStorage.setItem('loginSuccess', JSON.stringify(loginData));
                    console.log('已设置登录成功标记，包含API响应状态');
                } catch (e) {
                    console.warn('设置登录成功标记失败:', e.message);
                }
            }, loginApiSuccess);
            
        } catch (error) {
            console.error('登录失败:', error);
            throw new Error('登录失败: ' + error.message);
        }
    }

    // 设置查询参数 - 按照1.js的实现
    async setSearchParams(page, searchParams) {
        const { firstName, lastName, zipCode, state, address, useStateSearch } = searchParams;
        
        try {
            // 先清空所有表单字段，然后填写查询参数
            await page.evaluate(() => {
                // 清空所有输入字段
                const formInputs = document.querySelectorAll('.n-input__input-el');
                formInputs.forEach(input => {
                    input.value = '';
                    input.dispatchEvent(new Event('input'));
                });
                console.log('已清空所有表单字段');
            });
            
            // 等待清空操作完成
            try {
                await interruptibleDelay(500);
            } catch (error) {
                if (error.message === 'Operation cancelled') {
                    console.log('等待清空操作被取消');
                    throw error;
                }
            }

            // 填写查询参数
            await page.evaluate((params) => {
                const formItems = document.querySelectorAll('.n-form-item');
                
                formItems.forEach(item => {
                    const labelEl = item.querySelector('.n-form-item-label');
                    if (!labelEl) return;
                    
                    const label = labelEl.textContent;
                    const input = item.querySelector('.n-input__input-el');
                    if (!input) return;
                    
                    if (label === 'FirstName') {
                        input.value = params.firstName || '';
                        input.dispatchEvent(new Event('input'));
                        console.log('设置FirstName:', params.firstName || '(清空)');
                    } else if (label === 'LastName') {
                        input.value = params.lastName || '';
                        input.dispatchEvent(new Event('input'));
                        console.log('设置LastName:', params.lastName || '(清空)');
                    } else if (label === 'DOB') {
                        input.value = params.birthDate || '';
                        input.dispatchEvent(new Event('input'));
                        console.log('设置DOB:', params.birthDate || '(清空)');
                    } else if (label === 'zip') {
                        input.value = params.zipCode || '';
                        input.dispatchEvent(new Event('input'));
                        console.log('设置zip:', params.zipCode || '(清空)');
                    } else if (label === 'st') {
                        input.value = (params.useStateSearch && params.state) ? params.state : '';
                        input.dispatchEvent(new Event('input'));
                        console.log('设置st:', (params.useStateSearch && params.state) ? params.state : '(清空)');
                    } else if (label === 'address') {
                        input.value = params.address || '';
                        input.dispatchEvent(new Event('input'));
                        console.log('设置address:', params.address || '(清空)');
                    }
                });
            }, searchParams);
            
            console.log('查询参数设置完成，开始验证...');
            
            // 验证参数是否正确设置
            const verificationResult = await page.evaluate((expectedParams) => {
                const formItems = document.querySelectorAll('.n-form-item');
                const actualValues = {};
                const mismatches = [];
                
                formItems.forEach(item => {
                    const labelEl = item.querySelector('.n-form-item-label');
                    if (!labelEl) return;
                    
                    const label = labelEl.textContent;
                    const input = item.querySelector('.n-input__input-el');
                    if (!input) return;
                    
                    actualValues[label] = input.value;
                    
                    // 检查是否与预期值匹配
                    const expectedValue = (() => {
                        if (label === 'FirstName') return expectedParams.firstName || '';
                        if (label === 'LastName') return expectedParams.lastName || '';
                        if (label === 'DOB') return expectedParams.birthDate || '';
                        if (label === 'zip') return expectedParams.zipCode || '';
                        if (label === 'st') return (expectedParams.useStateSearch && expectedParams.state) ? expectedParams.state : '';
                        if (label === 'address') return expectedParams.address || '';
                        return input.value; // 其他字段不验证
                    })();
                    
                    if (input.value !== expectedValue) {
                        mismatches.push({ field: label, expected: expectedValue, actual: input.value });
                    }
                });
                
                // 检查是否有意外的值（特别是登录凭据）
                const suspiciousValues = [];
                Object.entries(actualValues).forEach(([field, value]) => {
                    if (value === '1805' || value === 'admin' || value === 'password') {
                        suspiciousValues.push({ field, value });
                    }
                });
                
                return {
                    actualValues,
                    mismatches,
                    suspiciousValues,
                    isValid: mismatches.length === 0 && suspiciousValues.length === 0
                };
            }, searchParams);
            
            if (!verificationResult.isValid) {
                console.error('参数验证失败:', {
                    不匹配项: verificationResult.mismatches,
                    可疑值: verificationResult.suspiciousValues,
                    实际值: verificationResult.actualValues
                });
                
                // 如果发现可疑值，尝试再次清空并设置
                if (verificationResult.suspiciousValues.length > 0) {
                    console.log('发现可疑值（可能是登录凭据），尝试重新清空并设置...');
                    await this.clearSearchForm(page);
                    
                    // 重新设置参数
                    await page.evaluate((params) => {
                        const formItems = document.querySelectorAll('.n-form-item');
                        
                        formItems.forEach(item => {
                            const labelEl = item.querySelector('.n-form-item-label');
                            if (!labelEl) return;
                            
                            const label = labelEl.textContent;
                            const input = item.querySelector('.n-input__input-el');
                            if (!input) return;
                            
                            // 确保清空
                            input.value = '';
                            input.dispatchEvent(new Event('input', { bubbles: true }));
                            
                            // 重新设置正确的值
                            if (label === 'FirstName') {
                                input.value = params.firstName || '';
                                input.dispatchEvent(new Event('input', { bubbles: true }));
                            } else if (label === 'LastName') {
                                input.value = params.lastName || '';
                                input.dispatchEvent(new Event('input', { bubbles: true }));
                            } else if (label === 'DOB') {
                                input.value = params.birthDate || '';
                                input.dispatchEvent(new Event('input', { bubbles: true }));
                            } else if (label === 'zip') {
                                input.value = params.zipCode || '';
                                input.dispatchEvent(new Event('input', { bubbles: true }));
                            } else if (label === 'st') {
                                input.value = (params.useStateSearch && params.state) ? params.state : '';
                                input.dispatchEvent(new Event('input', { bubbles: true }));
                            } else if (label === 'address') {
                                input.value = params.address || '';
                                input.dispatchEvent(new Event('input', { bubbles: true }));
                            }
                        });
                    }, searchParams);
                }
            } else {
                console.log('✅ 查询参数验证通过');
            }
            
        } catch (error) {
            console.error('设置查询参数失败:', error);
            throw new Error('设置查询参数失败: ' + error.message);
        }
    }
    
    // 设置高级查询参数 - 支持更多字段
    async setAdvancedSearchParams(page, searchParams) {
        const { firstName, lastName, dob, ssn, address, city, state, zipCode, phone, email } = searchParams;
        
        try {
            // 先清空所有表单字段，然后填写查询参数
            await page.evaluate(() => {
                // 清空所有输入字段
                const formInputs = document.querySelectorAll('.n-input__input-el');
                formInputs.forEach(input => {
                    input.value = '';
                    input.dispatchEvent(new Event('input'));
                });
                console.log('已清空所有高级查询表单字段');
            });
            
            // 等待清空操作完成
            try {
                await interruptibleDelay(500);
            } catch (error) {
                if (error.message === 'Operation cancelled') {
                    console.log('等待清空操作被取消');
                    throw error;
                }
            }
            
            // 填写高级查询参数 - 支持更多字段
            await page.evaluate((params) => {
                const formItems = document.querySelectorAll('.n-form-item');
                
                formItems.forEach(item => {
                    const labelEl = item.querySelector('.n-form-item-label');
                    if (!labelEl) return;
                    
                    const label = labelEl.textContent;
                    const input = item.querySelector('.n-input__input-el');
                    if (!input) return;
                    
                    // 填写所有可能的字段
                    if (label === 'FirstName' && params.firstName) {
                        input.value = params.firstName;
                        input.dispatchEvent(new Event('input'));
                        console.log('设置高级查询FirstName:', params.firstName);
                    } else if (label === 'LastName' && params.lastName) {
                        input.value = params.lastName;
                        input.dispatchEvent(new Event('input'));
                        console.log('设置高级查询LastName:', params.lastName);
                    } else if (label === 'DOB' && params.dob) {
                        input.value = params.dob;
                        input.dispatchEvent(new Event('input'));
                    } else if (label === 'SSN' && params.ssn) {
                        input.value = params.ssn;
                        input.dispatchEvent(new Event('input'));
                    } else if (label === 'address' && params.address) {
                        input.value = params.address;
                        input.dispatchEvent(new Event('input'));
                    } else if (label === 'city' && params.city) {
                        input.value = params.city;
                        input.dispatchEvent(new Event('input'));
                    } else if (label === 'st' && params.state) {
                        input.value = params.state;
                        input.dispatchEvent(new Event('input'));
                    } else if (label === 'zip' && params.zipCode) {
                        input.value = params.zipCode;
                        input.dispatchEvent(new Event('input'));
                    } else if (label === 'phone' && params.phone) {
                        input.value = params.phone;
                        input.dispatchEvent(new Event('input'));
                        console.log('设置高级查询Phone:', params.phone);
                    } else if (label === 'email' && params.email) {
                        input.value = params.email;
                        input.dispatchEvent(new Event('input'));
                        console.log('设置高级查询Email:', params.email);
                    }
                });
            }, searchParams);
            
            console.log('高级查询参数设置完成');
        } catch (error) {
            console.error('设置高级查询参数失败:', error);
            throw new Error('设置高级查询参数失败: ' + error.message);
        }
    }

    // 执行查询并获取结果 - 完全按照1.js的实现
    async performSearch(page, searchAddress) {
        const results = [];
        try {
            // 点击查询按钮 - 添加页面级取消检查
            await page.evaluate(() => {
                // 页面级取消检查
                if (window.pageLevelCancel && window.pageLevelCancel.shouldCancel()) {
                    console.log('[页面级] 查询按钮点击操作被取消');
                    return false;
                }
                
                const buttons = Array.from(document.querySelectorAll('button'));
                const searchButton = buttons.find(btn => btn.textContent.includes('查询'));
                if (searchButton && !window.pageLevelCancel?.shouldCancel()) {
                    searchButton.click();
                    return true;
                }
                return false;
            });
            // 等待查询结果加载 - 使用快速取消机制
            try {
                const cancelPromise = new Promise((_, reject) => {
                    const checkCancel = () => {
                        if (window.globalShouldStop) {
                            reject(new Error('Operation cancelled'));
                            return;
                        }
                        setTimeout(checkCancel, 10); // 每10ms检查一次
                    };
                    checkCancel();
                });
                
                await Promise.race([
                    interruptibleDelay(3000),
                    cancelPromise
                ]);
            } catch (error) {
                if (error.message === 'Operation cancelled') {
                    console.log('等待查询结果被立即取消');
                    return results;
                }
            }
            
            // 检查全局取消标志
            if (window.globalShouldStop) {
                console.log('等待查询结果时检测到取消标志');
                return results;
            }
            // 检查是否有结果
            const hasNoData = await page.evaluate(() => {
                const noDataText = document.querySelector('.n-empty__description');
                return noDataText && noDataText.textContent.includes('暂无数据');
            });
            if (hasNoData) {
                console.log('查询无结果');
                return results;
            }
            // 获取总页数
            const totalPages = await getTotalPageCount(page);
            console.log(`共 ${totalPages} 页`);
            let currentPage = 1;
            let hasNextPage = true;
            let oldRows = null;
            // 只有填写地址时才查多页，否则只查第一页
            const shouldPaginate = !!searchAddress && searchAddress.trim() !== '';
            while (hasNextPage) {
                // 检查全局取消标志
                if (window.globalShouldStop) {
                    console.log('检测到取消标志，停止查询');
                    break;
                }
                
                console.log(`正在处理第 ${currentPage} 页结果...`);
                // 获取当前页的所有结果 - 添加页面级取消检查
                const pageResults = await page.evaluate((searchAddr) => {
                    // 页面级取消检查
                    if (window.pageLevelCancel && window.pageLevelCancel.shouldCancel()) {
                        console.log('[页面级] 数据获取操作被取消');
                        return [];
                    }
                    
                    const pageResults = [];
                    const rows = document.querySelectorAll('.n-data-table-tr');
                    if (rows.length === 0) {
                        return pageResults;
                    }
                    
                    rows.forEach((row, index) => {
                        // 在处理每行时检查取消
                        if (window.pageLevelCancel && window.pageLevelCancel.shouldCancel()) {
                            console.log(`[页面级] 处理第${index}行时被取消`);
                            return; // 跳出forEach
                        }
                        
                        const cells = row.querySelectorAll('.n-data-table-td');
                        if (cells.length > 13) {
                            const result = {
                                firstName: cells[0]?.textContent?.trim() || '',
                                middleName: cells[1]?.textContent?.trim() || '',
                                lastName: cells[2]?.textContent?.trim() || '',
                                dob: cells[4]?.textContent?.trim() || '',
                                ssn: cells[5]?.textContent?.trim() || '',
                                address: cells[6]?.textContent?.trim() || '',
                                city: cells[7]?.textContent?.trim() || '',
                                state: cells[8]?.textContent?.trim() || '',
                                phone: cells[10]?.textContent?.trim() || '', // 正确：phone在第10列
                                email: cells[11]?.textContent?.trim() || '', // 正确：email在第11列
                                zip: cells[13]?.textContent?.trim() || ''
                            };
                            pageResults.push(result);
                        }
                    });
                    return pageResults;
                }, searchAddress);
                for (const result of pageResults) {
                    // 检查全局取消标志
                    if (window.globalShouldStop) {
                        console.log('处理结果时检测到取消标志，停止处理');
                        hasNextPage = false;
                        break;
                    }
                    
                    result.dob = formatDate(result.dob);
                    if (addressMatches(searchAddress, result.address)) {
                        console.log(`找到匹配地址: ${result.address}`);
                        results.push(result);
                    } else {
                        console.log(`地址不匹配: ${result.address}`);
                    }

                }
                // 判断是否有下一页
                const nextPageInfo = await getNextPageButtonInfo(page);
                if (shouldPaginate && nextPageInfo.exists && !nextPageInfo.disabled && currentPage < totalPages) {
                    // 翻页前保存当前表格内容
                    oldRows = await page.evaluate(() => Array.from(document.querySelectorAll('.n-data-table-tr')).map(r => r.innerText));
                    // 点击下一页 - 添加页面级取消检查
                    await page.evaluate(() => {
                        // 页面级取消检查
                        if (window.pageLevelCancel && window.pageLevelCancel.shouldCancel()) {
                            console.log('[页面级] 翻页操作被取消');
                            return false;
                        }
                        
                        const btns = Array.from(document.querySelectorAll('div.n-pagination-item--button'));
                        let nextBtn = null;
                        for (const btn of btns) {
                            // 在循环中也检查取消
                            if (window.pageLevelCancel && window.pageLevelCancel.shouldCancel()) {
                                console.log('[页面级] 查找翻页按钮时被取消');
                                return false;
                            }
                            
                            const svg = btn.querySelector('svg');
                            if (svg && svg.innerHTML.includes('M7.73271 4.20694')) {
                                nextBtn = btn;
                                break;
                            }
                        }
                        
                        if (nextBtn && !window.pageLevelCancel?.shouldCancel()) {
                            nextBtn.click();
                            return true;
                        }
                        return false;
                    });
                    currentPage++;
                    // 等待表格内容变化，使用Promise.race确保取消信号优先
                    try {
                        const cancelPromise = new Promise((_, reject) => {
                            const checkCancel = () => {
                                if (window.globalShouldStop) {
                                    reject(new Error('Operation cancelled'));
                                    return;
                                }
                                setTimeout(checkCancel, 10); // 每10ms检查一次
                            };
                            checkCancel();
                        });
                        
                        await Promise.race([
                            waitForTableContentChangeOrAppear(page, oldRows, 10000),
                            cancelPromise
                        ]);
                    } catch (error) {
                        if (error.message === 'Operation cancelled') {
                            console.log('等待表格变化被立即取消');
                            hasNextPage = false;
                            break;
                        }
                        console.error('等待表格变化时出错:', error);
                        hasNextPage = false;
                        break;
                    }
                } else {
                    hasNextPage = false;
                }
                // 如果不需要分页，查完第一页就退出
                if (!shouldPaginate) {
                    break;
                }
            }
            console.log(`查询完成，找到 ${results.length} 条匹配结果`);
        } catch (error) {
            console.error('执行查询失败:', error);
            console.log('由于错误返回部分结果:', results.length);
        }
        return results;
    }
    
    // 执行高级查询并获取结果 - 不进行地址匹配过滤（除非用户填写了地址）
    async performAdvancedSearch(page, searchAddress, progressCallback = null) {
        const results = [];
        try {
            // 检查页面是否有效
            if (!page || page.isClosed()) {
                console.error('performAdvancedSearch: 页面无效或已关闭');
                return results;
            }
            
            // 点击查询按钮 - 添加页面级取消检查
            await page.evaluate(() => {
                // 页面级取消检查
                if (window.pageLevelCancel && window.pageLevelCancel.shouldCancel()) {
                    console.log('[页面级] 高级查询按钮点击操作被取消');
                    return false;
                }
                
                const buttons = Array.from(document.querySelectorAll('button'));
                const searchButton = buttons.find(btn => btn.textContent.includes('查询'));
                if (searchButton && !window.pageLevelCancel?.shouldCancel()) {
                    searchButton.click();
                    return true;
                }
                return false;
            });
            // 等待查询结果加载 - 使用快速取消机制
            try {
                const cancelPromise = new Promise((_, reject) => {
                    const checkCancel = () => {
                        if (window.globalShouldStop) {
                            reject(new Error('Operation cancelled'));
                            return;
                        }
                        setTimeout(checkCancel, 10); // 每10ms检查一次
                    };
                    checkCancel();
                });
                
                await Promise.race([
                    interruptibleDelay(3000),
                    cancelPromise
                ]);
            } catch (error) {
                if (error.message === 'Operation cancelled') {
                    console.log('等待高级查询结果被立即取消');
                    return results;
                }
            }
            
            // 检查全局取消标志
            if (window.globalShouldStop) {
                console.log('高级查询等待结果时检测到取消标志');
                return results;
            }
            // 检查是否有结果
            const hasNoData = await page.evaluate(() => {
                const noDataText = document.querySelector('.n-empty__description');
                return noDataText && noDataText.textContent.includes('暂无数据');
            });
            if (hasNoData) {
                console.log('高级查询无结果');
                return results;
            }
            // 获取总页数
            const totalPages = await getTotalPageCount(page);
            console.log(`共 ${totalPages} 页`);
            let currentPage = 1;
            let hasNextPage = true;
            let oldRows = null;
            // 只有填写地址时才查多页，否则只查第一页
            const shouldPaginate = !!searchAddress && searchAddress.trim() !== '';
            while (hasNextPage) {
                // 检查全局取消标志
                if (window.globalShouldStop) {
                    console.log('高级查询处理结果时检测到取消标志，停止查询');
                    break;
                }
                
                console.log(`正在处理高级查询第 ${currentPage} 页结果...`);
                
                // 调用进度回调
                if (progressCallback && typeof progressCallback === 'function') {
                    try {
                        progressCallback(currentPage, totalPages);
                    } catch (callbackError) {
                        console.error('进度回调执行出错:', callbackError);
                    }
                }
                // 获取当前页的所有结果
                try {
                    const pageResults = await page.evaluate((searchAddr) => {
                        try {
                            // 页面级取消检查
                            if (window.pageLevelCancel && window.pageLevelCancel.shouldCancel()) {
                                console.log('[页面级] 高级查询数据获取操作被取消');
                                return [];
                            }
                            
                            const pageResults = [];
                            const rows = document.querySelectorAll('.n-data-table-tr');
                            if (!rows || rows.length === 0) {
                                return pageResults;
                            }
                            
                            rows.forEach((row, index) => {
                                try {
                                    // 在处理每行时检查取消
                                    if (window.pageLevelCancel && window.pageLevelCancel.shouldCancel()) {
                                        console.log(`[页面级] 高级查询处理第${index}行时被取消`);
                                        return; // 跳出forEach
                                    }
                                    
                                    const cells = row.querySelectorAll('.n-data-table-td');
                                    if (cells && cells.length > 13) {
                                        // 安全获取单元格文本
                                        const safeGetText = (cell) => {
                                            if (!cell) return '';
                                            return (cell.textContent || '').trim();
                                        };
                                        
                                        const result = {
                                            firstName: safeGetText(cells[0]),
                                            middleName: safeGetText(cells[1]),
                                            lastName: safeGetText(cells[2]),
                                            dob: safeGetText(cells[4]),
                                            ssn: safeGetText(cells[5]),
                                            address: safeGetText(cells[6]),
                                            city: safeGetText(cells[7]),
                                            state: safeGetText(cells[8]),
                                            phone: safeGetText(cells[10]), // 正确：phone在第10列
                                            email: safeGetText(cells[11]), // 正确：email在第11列
                                            zip: safeGetText(cells[13]),
                                            isAdvancedResult: true
                                        };
                                        pageResults.push(result);
                                    }
                                } catch (rowError) {
                                    console.error(`处理第 ${index} 行时出错:`, rowError);
                                    // 继续处理其他行
                                }
                            });
                            return pageResults;
                        } catch (evalError) {
                            console.error('evaluate 函数内部错误:', evalError);
                            return []; // 返回空数组而不是抛出错误
                        }
                    }, searchAddress);
                    
                    // 处理页面结果
                    if (Array.isArray(pageResults)) {
                        for (const result of pageResults) {
                            try {
                                if (!result) continue; // 跳过无效结果
                                
                                // 格式化日期
                                const formattedDob = formatDate(result.dob || '');
                                result.dob = formattedDob;
                                
                                // 检查地址匹配
                                if (searchAddress && !addressMatches(searchAddress, result.address || '')) {
                                    console.log(`高级查询：地址不匹配: ${result.address}`);
                                    continue;
                                }
                                
                                results.push(result);
                            } catch (resultError) {
                                console.error('处理结果项时出错:', resultError);
                            }
                        }
                    } else {
                        console.error('页面结果不是数组:', pageResults);
                    }
                } catch (pageError) {
                    console.error(`获取第 ${currentPage} 页结果时出错:`, pageError);
                }
                
                // 判断是否有下一页
                try {
                    const nextPageInfo = await getNextPageButtonInfo(page);
                    if (shouldPaginate && nextPageInfo.exists && !nextPageInfo.disabled && currentPage < totalPages) {
                        // 翻页前保存当前表格内容
                        try {
                            oldRows = await page.evaluate(() => Array.from(document.querySelectorAll('.n-data-table-tr')).map(r => r.innerText));
                        } catch (rowsError) {
                            console.error('获取表格行时出错:', rowsError);
                            oldRows = [];
                        }
                        
                        // 点击下一页 - 添加页面级取消检查
                        await page.evaluate(() => {
                            try {
                                // 页面级取消检查
                                if (window.pageLevelCancel && window.pageLevelCancel.shouldCancel()) {
                                    console.log('[页面级] 高级查询翻页操作被取消');
                                    return false;
                                }
                                
                                const btns = Array.from(document.querySelectorAll('div.n-pagination-item--button'));
                                let nextBtn = null;
                                for (const btn of btns) {
                                    // 在循环中也检查取消
                                    if (window.pageLevelCancel && window.pageLevelCancel.shouldCancel()) {
                                        console.log('[页面级] 高级查询查找翻页按钮时被取消');
                                        return false;
                                    }
                                    
                                    const svg = btn.querySelector('svg');
                                    if (svg && svg.innerHTML.includes('M7.73271 4.20694')) {
                                        nextBtn = btn;
                                        break;
                                    }
                                }
                                
                                if (nextBtn && !window.pageLevelCancel?.shouldCancel()) {
                                    nextBtn.click();
                                    return true;
                                }
                                return false;
                            } catch (clickError) {
                                console.error('点击下一页按钮时出错:', clickError);
                                return false;
                            }
                        });
                        currentPage++;
                        
                        // 等待表格内容变化，使用Promise.race确保取消信号优先  
                        try {
                            const cancelPromise = new Promise((_, reject) => {
                                const checkCancel = () => {
                                    if (window.globalShouldStop) {
                                        reject(new Error('Operation cancelled'));
                                        return;
                                    }
                                    setTimeout(checkCancel, 10); // 每10ms检查一次
                                };
                                checkCancel();
                            });
                            
                            await Promise.race([
                                waitForTableContentChangeOrAppear(page, oldRows, 10000),
                                cancelPromise
                            ]);
                        } catch (error) {
                            if (error.message === 'Operation cancelled') {
                                console.log('高级查询等待表格变化被立即取消');
                                hasNextPage = false;
                                break;
                            }
                            console.error('等待表格内容变化时出错:', error);
                            hasNextPage = false;
                        }
                    } else {
                        hasNextPage = false;
                    }
                } catch (nextPageError) {
                    console.error('检查下一页按钮时出错:', nextPageError);
                    hasNextPage = false;
                }
                
                // 如果不需要分页，查完第一页就退出
                if (!shouldPaginate) {
                    break;
                }
            }
            console.log(`高级查询完成，找到 ${results.length} 条结果`);
        } catch (error) {
            console.error('执行高级查询失败:', error);
            console.log('由于错误返回部分高级查询结果:', results.length);
        }
        
        // 确保返回的结果是有效的数组
        return Array.isArray(results) ? results : [];
    }

    // 【新增】确保高级搜索是展开状态
    async ensureAdvancedSearchExpanded(page) {
        try {
            // 检查高级搜索是否已经展开
            const isExpanded = await page.evaluate(() => {
                // 查找高级搜索的字段，如果能找到SSN、city等字段说明已展开
                const formItems = document.querySelectorAll('.n-form-item');
                let hasAdvancedFields = false;
                
                formItems.forEach(item => {
                    const labelEl = item.querySelector('.n-form-item-label');
                    if (labelEl) {
                        const label = labelEl.textContent;
                        if (label === 'SSN' || label === 'city' || label === 'st' || label === 'phone' || label === 'email') {
                            hasAdvancedFields = true;
                        }
                    }
                });
                
                return hasAdvancedFields;
            });

            if (isExpanded) {
                console.log('高级搜索已经是展开状态，无需操作');
                return;
            }

            console.log('高级搜索未展开，正在点击展开...');
            
            // 查找并点击高级搜索按钮
            const clicked = await page.evaluate(() => {
                // 查找高级搜索按钮的多种可能选择器
                const selectors = [
                    'span:contains("高级搜索")',
                    '[class*="advanced"]',
                    '[class*="高级"]',
                    '.advanced-search',
                    'button:contains("高级搜索")'
                ];

                // 使用更通用的方法查找高级搜索按钮
                const allElements = document.querySelectorAll('*');
                let advancedButton = null;
                
                for (const element of allElements) {
                    const text = element.textContent || '';
                    if (text.includes('高级搜索') && (element.tagName === 'SPAN' || element.tagName === 'BUTTON' || element.tagName === 'DIV')) {
                        // 检查元素是否可点击（有点击事件或cursor为pointer）
                        const style = window.getComputedStyle(element);
                        if (style.cursor === 'pointer' || element.onclick || element.getAttribute('role') === 'button') {
                            advancedButton = element;
                            break;
                        }
                    }
                }

                // 如果没找到，尝试查找包含箭头图标的元素
                if (!advancedButton) {
                    const arrows = document.querySelectorAll('i[class*="arrow"], [class*="icon"]');
                    for (const arrow of arrows) {
                        const parent = arrow.parentElement;
                        if (parent && parent.textContent.includes('高级搜索')) {
                            advancedButton = parent;
                            break;
                        }
                    }
                }

                if (advancedButton) {
                    console.log('找到高级搜索按钮，正在点击...');
                    advancedButton.click();
                    return true;
                } else {
                    console.log('未找到高级搜索按钮');
                    return false;
                }
            });

            if (clicked) {
                // 等待高级搜索展开
                console.log('已点击高级搜索按钮，等待展开...');
                
                try {
                    await interruptibleDelay(600); // 等待展开动画完成（优化：减少等待时间）
                } catch (error) {
                    if (error.message === 'Operation cancelled') {
                        console.log('等待高级搜索展开被取消');
                        throw error;
                    }
                }

                // 验证高级搜索是否成功展开
                const expandedAfterClick = await page.evaluate(() => {
                    const formItems = document.querySelectorAll('.n-form-item');
                    let hasAdvancedFields = false;
                    
                    formItems.forEach(item => {
                        const labelEl = item.querySelector('.n-form-item-label');
                        if (labelEl) {
                            const label = labelEl.textContent;
                            if (label === 'SSN' || label === 'city' || label === 'st' || label === 'phone' || label === 'email') {
                                hasAdvancedFields = true;
                            }
                        }
                    });
                    
                    return hasAdvancedFields;
                });

                if (expandedAfterClick) {
                    console.log('✅ 高级搜索已成功展开');
                } else {
                    console.warn('⚠️ 高级搜索可能未成功展开，但继续执行');
                }
            } else {
                console.warn('⚠️ 未能找到或点击高级搜索按钮，继续执行');
            }

        } catch (error) {
            console.error('检查/展开高级搜索时出错:', error);
            // 不抛出错误，允许查询继续执行
            console.log('高级搜索展开失败，但继续执行查询');
        }
    }

    // 【新增】确保页面显示100条记录
    async ensurePageSize100(page) {
        try {
            // 检查当前页面显示数量
            const currentPageSize = await page.evaluate(() => {
                // 查找页面显示数量选择器
                const pageSizeElement = document.querySelector('.n-base-selection .n-base-selection-label');
                if (pageSizeElement) {
                    const text = pageSizeElement.textContent || '';
                    // 提取数字，比如 "100 / 页" 中的 100
                    const match = text.match(/(\d+)\s*\/\s*页/);
                    return match ? parseInt(match[1]) : null;
                }
                return null;
            });

            if (currentPageSize === 100) {
                console.log('页面显示数量已经是100条，无需调整');
                return;
            }

            console.log(`当前页面显示${currentPageSize || '未知'}条，正在设置为100条...`);

            // 点击页面显示数量选择器
            const selectorClicked = await page.evaluate(() => {
                const pageSizeSelect = document.querySelector('.n-base-selection');
                if (pageSizeSelect) {
                    pageSizeSelect.click();
                    return true;
                }
                return false;
            });

            if (selectorClicked) {
                // 等待下拉菜单显示（优化：减少等待时间）
                try {
                    await interruptibleDelay(300);
                } catch (error) {
                    if (error.message === 'Operation cancelled') {
                        console.log('等待页面大小下拉菜单被取消');
                        throw error;
                    }
                }

                // 选择100条选项
                const option100Selected = await page.evaluate(() => {
                    const menuItems = document.querySelectorAll('.n-base-select-option');
                    const option100 = Array.from(menuItems).find(item => {
                        const text = item.textContent || '';
                        return text.includes('100') && text.includes('页');
                    });
                    
                    if (option100) {
                        option100.click();
                        console.log('已选择100条/页选项');
                        return true;
                    } else {
                        console.log('未找到100条/页选项');
                        return false;
                    }
                });

                if (option100Selected) {
                    // 等待下拉菜单关闭和页面更新（优化：减少等待时间）
                    try {
                        await interruptibleDelay(600);
                    } catch (error) {
                        if (error.message === 'Operation cancelled') {
                            console.log('等待页面大小设置完成被取消');
                            throw error;
                        }
                    }

                    // 验证设置是否成功
                    const newPageSize = await page.evaluate(() => {
                        const pageSizeElement = document.querySelector('.n-base-selection .n-base-selection-label');
                        if (pageSizeElement) {
                            const text = pageSizeElement.textContent || '';
                            const match = text.match(/(\d+)\s*\/\s*页/);
                            return match ? parseInt(match[1]) : null;
                        }
                        return null;
                    });

                    if (newPageSize === 100) {
                        console.log('✅ 页面显示数量已成功设置为100条');
                    } else {
                        console.warn(`⚠️ 页面显示数量设置可能失败，当前显示${newPageSize || '未知'}条`);
                    }
                } else {
                    console.warn('⚠️ 未能选择100条/页选项');
                }
            } else {
                console.warn('⚠️ 未能点击页面显示数量选择器');
            }

        } catch (error) {
            console.error('设置页面显示数量时出错:', error);
            // 不抛出错误，允许查询继续执行
            console.log('页面显示数量设置失败，但继续执行查询');
        }
    }

    // 【新增】重置页面状态检查标记的公共方法
    static resetPageStateCheck() {
        resetPageStateCheck();
    }

    // 【新增】执行单次查询获取所有结果，用于前端地址匹配
    async executeSingleQueryForAllAddresses(browser, searchParams, progressCallback = null) {
        const { firstName, lastName, zipCode, state, useStateSearch, birthDate } = searchParams;

        return new Promise(async (resolve, reject) => {
            // 检查全局取消标志
            if (window.globalShouldStop) {
                console.log('单次查询开始前检测到取消标志，直接返回');
                resolve([]);
                return;
            }
            let page = null;
            const timeout = setTimeout(() => {
                if (!window.globalShouldStop) {
                    reject(new Error('查询超时'));
                }
            }, this.config.BROWSER_TIMEOUT);

            try {
                // 使用BrowserManager获取可用页面
                page = await browser.getAvailablePage();
                
                // 检查取消标志
                if (window.globalShouldStop) {
                    console.log('获取页面后检测到取消标志');
                    clearTimeout(timeout);
                    resolve([]);
                    return;
                }

                // 【用户要求：移除】将回到第一页操作移到后台执行
                // await goToFirstPage(page);
                
                // 【用户要求：优化】使用快速页面状态检查，跳过复杂的页面设置
                await this.ensurePageStateQuick(page);
                
                // 【用户要求：优化】设置查询参数（简化版本，减少清空操作）
                console.log('正在快速设置查询参数...');
                await this.setSearchParamsQuick(page, searchParams);
                
                // 检查取消标志
                if (window.globalShouldStop) {
                    console.log('设置参数后检测到取消标志');
                    clearTimeout(timeout);
                    resolve([]);
                    return;
                }
                
                // 执行查询并获取所有结果（不进行地址过滤）
                console.log('正在执行单次查询获取所有结果...');
                const results = await this.performSearchWithoutAddressFilter(page, progressCallback);
                console.log(`单次查询完成，找到 ${results.length} 条结果`);
                
                clearTimeout(timeout);
                resolve(results);
            } catch (error) {
                clearTimeout(timeout);
                if (error.message === 'Operation cancelled' || window.globalShouldStop) {
                    console.log('单次查询被取消');
                    resolve([]);
                } else {
                    console.error('单次查询执行错误:', error);
                    reject(error);
                }
            } finally {
                if (page) {
                    // 释放页面而不是关闭它，以便复用
                    browser.releasePage(page);
                }
            }
        });
    }

    // 【新增】快速页面状态检查，跳过复杂设置
    async ensurePageStateQuick(page) {
        try {
            console.log('执行快速页面状态检查...');
            
            // 仅检查基本查询元素是否存在
            const hasBasicElements = await page.evaluate(() => {
                const hasQueryButton = !!Array.from(document.querySelectorAll('button')).find(btn => 
                    btn.textContent && btn.textContent.includes('查询')
                );
                const hasInputs = document.querySelectorAll('.n-input__input-el').length >= 2; // 至少要有姓名输入框
                return hasQueryButton && hasInputs;
                });
            
            if (!hasBasicElements) {
                console.log('基本查询元素不存在，跳过等待直接继续...');
                // 【彻底移除】不再等待表单加载，直接继续
            }
            
            console.log('✅ 快速页面状态检查完成');
            } catch (error) {
            console.error('快速页面状态检查失败:', error);
            // 不抛出错误，允许查询继续
                }
            }

    // 【新增】快速设置查询参数，最小化清空操作
    async setSearchParamsQuick(page, searchParams) {
        const { firstName, lastName, birthDate, zipCode, state, useStateSearch } = searchParams;
        
        try {
            // 【彻底优化】瞬时设置查询参数，无任何延迟
            await page.evaluate((params) => {
                const formItems = document.querySelectorAll('.n-form-item');
                
                formItems.forEach(item => {
                    const labelEl = item.querySelector('.n-form-item-label');
                    if (!labelEl) return;
                    
                    const label = labelEl.textContent;
                    const input = item.querySelector('.n-input__input-el');
                    if (!input) return;
                    
                    // 直接设置值，无需先清空再填写
                    if (label === 'FirstName') {
                        input.value = params.firstName || '';
                        input.dispatchEvent(new Event('input', { bubbles: true }));
                        console.log('瞬时设置FirstName:', params.firstName || '(清空)');
                    } else if (label === 'LastName') {
                        input.value = params.lastName || '';
                        input.dispatchEvent(new Event('input', { bubbles: true }));
                        console.log('瞬时设置LastName:', params.lastName || '(清空)');
                    } else if (label === 'DOB') {
                        input.value = params.birthDate || '';
                        input.dispatchEvent(new Event('input', { bubbles: true }));
                        console.log('瞬时设置DOB:', params.birthDate || '(清空)');
                    } else if (label === 'zip') {
                        input.value = params.zipCode || '';
                        input.dispatchEvent(new Event('input', { bubbles: true }));
                        console.log('瞬时设置zip:', params.zipCode || '(清空)');
                    } else if (label === 'st') {
                        input.value = (params.useStateSearch && params.state) ? params.state : '';
                        input.dispatchEvent(new Event('input', { bubbles: true }));
                        console.log('瞬时设置st:', (params.useStateSearch && params.state) ? params.state : '(清空)');
                    } else if (label === 'address') {
                        // 清空地址字段，因为我们要在前端匹配
                        input.value = '';
                        input.dispatchEvent(new Event('input', { bubbles: true }));
                        console.log('瞬时清空address字段用于前端匹配');
                    }
                });
            }, searchParams);
            
            // 【彻底移除】完全不等待，让填写过程瞬时完成
            // 原来的代码：await interruptibleDelay(100);
            
            console.log('✅ 瞬时查询参数设置完成');
            
        } catch (error) {
            console.error('快速设置查询参数失败:', error);
            throw new Error('快速设置查询参数失败: ' + error.message);
        }
    }

    // 【新增】后台页面优化任务
    async performBackgroundPageOptimization(page) {
        try {
            console.log('🔄 开始执行后台页面优化任务...');
            
            // 【用户要求的后台任务1】回到第一页
            try {
                console.log('后台任务：检查并回到第一页...');
                await goToFirstPage(page);
                console.log('✅ 后台任务：已回到第一页');
            } catch (error) {
                console.error('后台任务：回到第一页失败:', error);
            }
            
            // 【用户要求的后台任务2】完整的表单清空和页面设置
            try {
                console.log('后台任务：执行完整表单清空...');
                await this.clearSearchForm(page);
                console.log('✅ 后台任务：完整表单清空完成');
            } catch (error) {
                console.error('后台任务：表单清空失败:', error);
            }
            
            // 后台任务3：确保高级搜索展开
            try {
                console.log('后台任务：确保高级搜索展开...');
                await this.ensureAdvancedSearchExpanded(page);
                console.log('✅ 后台任务：高级搜索展开完成');
            } catch (error) {
                console.error('后台任务：高级搜索展开失败:', error);
            }
            
            // 后台任务4：确保页面显示100条
            try {
                console.log('后台任务：确保页面显示100条...');
                await this.ensurePageSize100(page);
                console.log('✅ 后台任务：页面显示设置完成');
            } catch (error) {
                console.error('后台任务：页面显示设置失败:', error);
            }
            
            console.log('✅ 后台页面优化任务全部完成');
        } catch (error) {
            console.error('后台页面优化任务执行失败:', error);
        }
    }

    // 执行查询但不进行地址过滤
    async performSearchWithoutAddressFilter(page, progressCallback = null) {
        const results = [];
        try {
            // 点击查询按钮
            await page.evaluate(() => {
                if (window.pageLevelCancel && window.pageLevelCancel.shouldCancel()) {
                    console.log('[页面级] 查询按钮点击操作被取消');
                    return false;
                }
                
                const buttons = Array.from(document.querySelectorAll('button'));
                const searchButton = buttons.find(btn => btn.textContent.includes('查询'));
                if (searchButton && !window.pageLevelCancel?.shouldCancel()) {
                    searchButton.click();
                    return true;
                }
                return false;
            });
            
            // 等待查询结果加载
            try {
                const cancelPromise = new Promise((_, reject) => {
                    const checkCancel = () => {
                        if (window.globalShouldStop) {
                            reject(new Error('Operation cancelled'));
                            return;
                        }
                        setTimeout(checkCancel, 10);
                    };
                    checkCancel();
                });
                
                await Promise.race([
                    interruptibleDelay(3000),
                    cancelPromise
                ]);
            } catch (error) {
                if (error.message === 'Operation cancelled') {
                    console.log('等待查询结果被立即取消');
                    return results;
                }
            }
            
            // 检查全局取消标志
            if (window.globalShouldStop) {
                console.log('等待查询结果时检测到取消标志');
                return results;
            }
            
            // 检查是否有结果
            const hasNoData = await page.evaluate(() => {
                const noDataText = document.querySelector('.n-empty__description');
                return noDataText && noDataText.textContent.includes('暂无数据');
            });
            if (hasNoData) {
                console.log('查询无结果');
                return results;
            }
            
            // 获取总页数
            const totalPages = await getTotalPageCount(page);
            console.log(`共 ${totalPages} 页`);
            let currentPage = 1;
            let hasNextPage = true;
            let oldRows = null;
            
            // 获取所有页面的结果，不进行地址过滤
            while (hasNextPage) {
                // 检查全局取消标志
                if (window.globalShouldStop) {
                    console.log('检测到取消标志，停止查询');
                    break;
                }
                
                console.log(`正在处理第 ${currentPage} 页结果...`);
                
                // 调用进度回调
                if (progressCallback && typeof progressCallback === 'function') {
                    try {
                        progressCallback(currentPage, totalPages);
                    } catch (callbackError) {
                        console.error('进度回调执行出错:', callbackError);
                    }
                }
                
                // 获取当前页的所有结果
                const pageResults = await page.evaluate(() => {
                    if (window.pageLevelCancel && window.pageLevelCancel.shouldCancel()) {
                        console.log('[页面级] 数据获取操作被取消');
                        return [];
                    }
                    
                    const pageResults = [];
                    const rows = document.querySelectorAll('.n-data-table-tr');
                    if (rows.length === 0) {
                        return pageResults;
                    }
                    
                    rows.forEach((row, index) => {
                        if (window.pageLevelCancel && window.pageLevelCancel.shouldCancel()) {
                            console.log(`[页面级] 处理第${index}行时被取消`);
                            return;
                        }
                        
                        const cells = row.querySelectorAll('.n-data-table-td');
                        if (cells.length > 13) {
                            const result = {
                                firstName: cells[0]?.textContent?.trim() || '',
                                middleName: cells[1]?.textContent?.trim() || '',
                                lastName: cells[2]?.textContent?.trim() || '',
                                dob: cells[4]?.textContent?.trim() || '',
                                ssn: cells[5]?.textContent?.trim() || '',
                                address: cells[6]?.textContent?.trim() || '',
                                city: cells[7]?.textContent?.trim() || '',
                                state: cells[8]?.textContent?.trim() || '',
                                zip: cells[13]?.textContent?.trim() || ''
                            };
                            pageResults.push(result);
                        }
                    });
                    return pageResults;
                });
                
                // 将当前页的结果添加到总结果中（不进行地址过滤）
                for (const result of pageResults) {
                    if (window.globalShouldStop) {
                        console.log('处理结果时检测到取消标志，停止处理');
                        hasNextPage = false;
                        break;
                    }
                    
                    results.push(result);
                }
                
                // 判断是否有下一页
                const nextPageInfo = await getNextPageButtonInfo(page);
                if (nextPageInfo.exists && !nextPageInfo.disabled && currentPage < totalPages) {
                    // 翻页前保存当前表格内容
                    try {
                        oldRows = await page.evaluate(() => Array.from(document.querySelectorAll('.n-data-table-tr')).map(r => r.innerText));
                    } catch (rowsError) {
                        console.error('获取表格行时出错:', rowsError);
                        oldRows = [];
                    }
                    
                    // 点击下一页
                    await page.evaluate(() => {
                        if (window.pageLevelCancel && window.pageLevelCancel.shouldCancel()) {
                            console.log('[页面级] 翻页操作被取消');
                            return false;
                        }
                        
                        const btns = Array.from(document.querySelectorAll('div.n-pagination-item--button'));
                        let nextBtn = null;
                        for (const btn of btns) {
                            if (window.pageLevelCancel && window.pageLevelCancel.shouldCancel()) {
                                console.log('[页面级] 查找翻页按钮时被取消');
                                return false;
                            }
                            
                            const svg = btn.querySelector('svg');
                            if (svg && svg.innerHTML.includes('M7.73271 4.20694')) {
                                nextBtn = btn;
                                break;
                            }
                        }
                        
                        if (nextBtn && !window.pageLevelCancel?.shouldCancel()) {
                            nextBtn.click();
                            return true;
                        }
                        return false;
                    });
                    currentPage++;
                    
                    // 等待表格内容变化
                    try {
                        const cancelPromise = new Promise((_, reject) => {
                            const checkCancel = () => {
                                if (window.globalShouldStop) {
                                    reject(new Error('Operation cancelled'));
                                    return;
                                }
                                setTimeout(checkCancel, 10);
                            };
                            checkCancel();
                        });
                        
                        await Promise.race([
                            waitForTableContentChangeOrAppear(page, oldRows, 10000),
                            cancelPromise
                        ]);
                    } catch (error) {
                        if (error.message === 'Operation cancelled') {
                            console.log('等待表格变化被立即取消');
                            hasNextPage = false;
                            break;
                        }
                        console.error('等待表格变化时出错:', error);
                        hasNextPage = false;
                        break;
                    }
                } else {
                    hasNextPage = false;
                }
            }
            
            console.log(`查询完成，找到 ${results.length} 条结果（未进行地址过滤）`);
        } catch (error) {
            console.error('执行查询失败:', error);
            console.log('由于错误返回部分结果:', results.length);
        }
        return results;
    }
}

// 辅助函数：查找并判断分页"下一页"按钮是否可点击
async function getNextPageButtonInfo(page) {
    return await page.evaluate(() => {
        // 找到所有分页按钮
        const btns = Array.from(document.querySelectorAll('div.n-pagination-item--button'));
        // 选中含有右箭头SVG的那个（通常是最后一个）
        let nextBtn = null;
        for (const btn of btns) {
            // 判断是否含有右箭头SVG
            const svg = btn.querySelector('svg');
            if (svg && svg.innerHTML.includes('M7.73271 4.20694')) { // 路径唯一
                nextBtn = btn;
                break;
            }
        }
        if (!nextBtn) return { exists: false, disabled: true };
        // 判断禁用：class含有disabled或is-disabled
        const classList = nextBtn.className || '';
        const disabled = classList.includes('is-disabled') || classList.includes('n-pagination-item--disabled') || nextBtn.getAttribute('aria-disabled') === 'true';
        return { exists: true, disabled };
    });
}

// 辅助函数：统计分页总页数
async function getTotalPageCount(page) {
    return await page.evaluate(() => {
        const items = Array.from(document.querySelectorAll('.n-pagination-item'));
        let maxPage = 1;
        for (const item of items) {
            const num = parseInt(item.textContent.trim(), 10);
            if (!isNaN(num) && num > maxPage) {
                maxPage = num;
            }
        }
        return maxPage;
    });
}

// 辅助函数：回到第一页
async function goToFirstPage(page) {
    // 判断当前是否在第一页
    const isFirstPage = await page.evaluate(() => {
        const items = Array.from(document.querySelectorAll('div.n-pagination-item.n-pagination-item--clickable'));
        const firstPageBtn = items.find(el => el.textContent.trim() === '1');
        return firstPageBtn && firstPageBtn.classList.contains('n-pagination-item--active');
    });
    if (isFirstPage) {
        // 已经在第一页，无需操作
        return;
    }
    // 记录翻页前的表格内容
    const oldRows = await page.evaluate(() => Array.from(document.querySelectorAll('.n-data-table-tr')).map(r => r.innerText));
    // 点击分页栏中内容为1的按钮
    const clicked = await page.evaluate(() => {
        const items = Array.from(document.querySelectorAll('div.n-pagination-item.n-pagination-item--clickable'));
        const firstPageBtn = items.find(el => el.textContent.trim() === '1');
        if (firstPageBtn && !firstPageBtn.className.includes('is-disabled') && !firstPageBtn.className.includes('n-pagination-item--disabled')) {
            firstPageBtn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
            firstPageBtn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
            firstPageBtn.click();
            return true;
        }
        return false;
    });
    if (clicked) {
        try {
            await waitForTableContentChangeOrAppear(page, oldRows, 10000);
        } catch (error) {
            if (error.message === 'Operation cancelled') {
                console.log('回到第一页时等待被取消');
                throw error;
            }
            throw error;
        }
    }
}

// 【新增】全局页面状态检查标记
let isPageStateChecked = false;
let pageStateCheckPromise = null;

// 【新增】确保页面状态只检查设置一次的方法
async function ensurePageStateOnce(page, queryExecutorInstance) {
    // 如果已经检查过，但需要验证状态是否仍然有效
    if (isPageStateChecked) {
        console.log('页面状态已检查过，验证是否仍然有效...');
        
        // 快速验证关键元素是否存在
        const isStateValid = await page.evaluate(() => {
            const hasQueryButton = !!Array.from(document.querySelectorAll('button')).find(btn => 
                btn.textContent && btn.textContent.includes('查询')
            );
            const hasInputs = document.querySelectorAll('.n-input__input-el').length >= 4;
            const hasAdvancedFields = !!Array.from(document.querySelectorAll('.n-form-item-label')).find(label => 
                label.textContent === 'SSN' || label.textContent === 'city'
            );
            
            return hasQueryButton && hasInputs && hasAdvancedFields;
        });
        
        if (isStateValid) {
            console.log('✅ 页面状态验证通过，可以继续');
            return;
        } else {
            console.log('⚠️ 页面状态已失效，需要重新设置');
            isPageStateChecked = false;
        }
    }
    
    // 如果正在检查中，等待检查完成
    if (pageStateCheckPromise) {
        console.log('页面状态检查正在进行中，等待完成...');
        await pageStateCheckPromise;
        return;
    }
    
    // 开始检查，设置Promise
    pageStateCheckPromise = (async () => {
        try {
            console.log('开始页面状态检查和设置...');
            
            // 等待页面基本元素加载
            try {
                await page.waitForSelector('.n-form', { timeout: 5000 });
            } catch (e) {
                console.log('等待表单加载超时，继续执行');
            }
            
            // 检查并确保高级搜索是展开状态
            console.log('检查高级搜索状态...');
            await queryExecutorInstance.ensureAdvancedSearchExpanded(page);
            
            // 确保页面显示100条记录
            console.log('检查页面显示数量...');
            await queryExecutorInstance.ensurePageSize100(page);
            
            // 清空所有表单，防止残留数据
            console.log('清空表单防止数据残留...');
            await queryExecutorInstance.clearSearchForm(page);
            
            // 再次验证状态
            const finalStateValid = await page.evaluate(() => {
                const hasQueryButton = !!Array.from(document.querySelectorAll('button')).find(btn => 
                    btn.textContent && btn.textContent.includes('查询') && !btn.disabled
                );
                const inputs = document.querySelectorAll('.n-input__input-el');
                const hasCleanInputs = Array.from(inputs).every(input => 
                    input.value === '' || input.placeholder
                );
                
                return hasQueryButton && hasCleanInputs && inputs.length >= 4;
            });
            
            if (!finalStateValid) {
                console.warn('⚠️ 页面状态设置后验证未完全通过，但继续执行');
            }
            
            // 标记为已检查
            isPageStateChecked = true;
            console.log('✅ 页面状态检查和设置完成，后续查询将跳过此步骤');
            
        } catch (error) {
            console.error('页面状态检查设置失败:', error);
            // 即使失败也标记为已检查，避免无限重试
            isPageStateChecked = true;
        } finally {
            // 清除Promise引用
            pageStateCheckPromise = null;
        }
    })();
    
    await pageStateCheckPromise;
}

// 【新增】重置页面状态检查标记的方法（在需要时调用）
function resetPageStateCheck() {
    isPageStateChecked = false;
    pageStateCheckPromise = null;
    console.log('页面状态检查标记已重置');
}

module.exports = QueryExecutor; 
