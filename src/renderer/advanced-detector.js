/**
 * 高级页面状态检测器
 * 基于MCP浏览器测试中发现的精确判断方法
 * 提供比现有utils.js更准确的页面状态判断
 */

const { interruptibleDelay } = require('./utils');

class AdvancedDetector {
    constructor() {
        this.detectionTimeouts = new Map(); // 用于管理检测超时
    }

    /**
     * 高级数据变化检测 - 基于MCP测试发现的数据总数变化判断法
     * @param {object} page - Puppeteer页面对象
     * @param {number} timeout - 超时时间(ms)
     * @returns {object} 检测结果
     */
    async detectDataChange(page, timeout = 10000) {
        console.log('[高级检测] 开始数据变化检测...');
        
        const startTime = Date.now();
        
        try {
            // 获取初始数据状态
            const initialState = await this.getDataState(page);
            console.log('[高级检测] 初始数据状态:', initialState);
            
            let attempts = 0;
            while (Date.now() - startTime < timeout) {
                // 检查取消标志
                if (window.globalShouldStop) {
                    throw new Error('Operation cancelled');
                }
                
                attempts++;
                
                // 获取当前数据状态
                const currentState = await this.getDataState(page);
                
                // 数据变化检测逻辑
                const hasChanged = this.analyzeDataChange(initialState, currentState);
                
                if (attempts % 5 === 0) {
                    console.log(`[高级检测] 第${attempts}次检查 - 当前状态:`, currentState);
                }
                
                if (hasChanged.changed) {
                    console.log(`[高级检测] ✅ 数据变化检测成功:`, hasChanged);
                    return {
                        success: true,
                        changeType: hasChanged.type,
                        from: initialState,
                        to: currentState,
                        attempts: attempts,
                        duration: Date.now() - startTime
                    };
                }
                
                // 等待间隔 - 根据MCP测试调整为更合理的间隔
                await new Promise(resolve => setTimeout(resolve, 500));
            }
            
            console.log('[高级检测] ⚠️ 数据变化检测超时');
            return {
                success: false,
                reason: 'timeout',
                initialState: initialState,
                attempts: attempts,
                duration: Date.now() - startTime
            };
            
        } catch (error) {
            console.error('[高级检测] 数据变化检测失败:', error);
            return {
                success: false,
                reason: 'error',
                error: error.message,
                duration: Date.now() - startTime
            };
        }
    }

    /**
     * 获取页面数据状态 - 基于MCP测试中发现的关键指标
     */
    async getDataState(page) {
        try {
            const state = await page.evaluate(() => {
                const result = {
                    timestamp: Date.now(),
                    dataCount: 0,
                    dataCountText: null,
                    hasDataTable: false,
                    tableRows: 0,
                    isNoDataPage: false,
                    pageNumber: 1,
                    hasValidContent: false
                };
                
                try {
                    // 1. 检查数据总数 - 核心指标
                    const allElements = document.querySelectorAll('*');
                    for (let element of allElements) {
                        const text = element.textContent;
                        if (text && text.includes('共') && text.includes('条数据')) {
                            result.dataCountText = text.trim();
                            // 提取数字，例如从"共2,704,360,566条数据"中提取2704360566
                            const match = text.match(/共([\d,]+)条数据/);
                            if (match) {
                                result.dataCount = parseInt(match[1].replace(/,/g, ''));
                            }
                            break;
                        }
                    }
                    
                    // 2. 检查数据表格
                    const table = document.querySelector('table');
                    if (table) {
                        result.hasDataTable = true;
                        const rows = document.querySelectorAll('table tbody tr, .n-data-table-tr');
                        result.tableRows = rows.length;
                        
                        // 检查表格是否有有效内容
                        if (rows.length > 0) {
                            const firstRowText = rows[0].textContent;
                            result.hasValidContent = firstRowText && firstRowText.trim().length > 10;
                        }
                    }
                    
                    // 3. 检查是否是无数据页面
                    for (let element of allElements) {
                        const text = element.textContent;
                        if (text && (text.includes('无数据') || text.includes('暂无数据') || text.includes('No data'))) {
                            result.isNoDataPage = true;
                            break;
                        }
                    }
                    
                    // 4. 获取当前页码
                    const pageElements = document.querySelectorAll('.n-pagination-item--active, .active');
                    if (pageElements.length > 0) {
                        const pageNum = parseInt(pageElements[0].textContent);
                        if (!isNaN(pageNum)) {
                            result.pageNumber = pageNum;
                        }
                    }
                    
                } catch (error) {
                    console.error('[页面内部] 获取数据状态出错:', error);
                }
                
                return result;
            });
            
            return state;
        } catch (error) {
            console.error('[高级检测] 获取数据状态失败:', error);
            return {
                timestamp: Date.now(),
                dataCount: 0,
                dataCountText: null,
                hasDataTable: false,
                tableRows: 0,
                isNoDataPage: false,
                pageNumber: 1,
                hasValidContent: false,
                error: error.message
            };
        }
    }

    /**
     * 分析数据变化 - 基于MCP测试的变化模式
     */
    analyzeDataChange(initialState, currentState) {
        // 1. 数据总数变化检测（最重要的指标）
        if (initialState.dataCount !== currentState.dataCount) {
            const changeType = currentState.dataCount > initialState.dataCount ? 'increase' : 'decrease';
            return {
                changed: true,
                type: 'dataCount',
                subType: changeType,
                detail: `数据总数从 ${initialState.dataCount} 变为 ${currentState.dataCount}`
            };
        }
        
        // 2. 表格行数变化检测
        if (initialState.tableRows !== currentState.tableRows) {
            return {
                changed: true,
                type: 'tableRows',
                detail: `表格行数从 ${initialState.tableRows} 变为 ${currentState.tableRows}`
            };
        }
        
        // 3. 页面内容有效性变化
        if (initialState.hasValidContent !== currentState.hasValidContent) {
            return {
                changed: true,
                type: 'contentValidity',
                detail: `内容有效性从 ${initialState.hasValidContent} 变为 ${currentState.hasValidContent}`
            };
        }
        
        // 4. 无数据状态变化
        if (initialState.isNoDataPage !== currentState.isNoDataPage) {
            return {
                changed: true,
                type: 'noDataStatus',
                detail: `无数据状态从 ${initialState.isNoDataPage} 变为 ${currentState.isNoDataPage}`
            };
        }
        
        // 5. 页码变化检测（用于翻页操作）
        if (initialState.pageNumber !== currentState.pageNumber) {
            return {
                changed: true,
                type: 'pageNumber',
                detail: `页码从 ${initialState.pageNumber} 变为 ${currentState.pageNumber}`
            };
        }
        
        return {
            changed: false,
            type: 'noChange',
            detail: '未检测到显著变化'
        };
    }

    /**
     * 高级搜索展开状态检测 - 基于MCP测试发现的字段检测法
     */
    async checkAdvancedSearchExpanded(page) {
        try {
            console.log('[高级检测] 检查高级搜索展开状态...');
            
            const result = await page.evaluate(() => {
                // 基于MCP测试发现的特征：高级搜索展开后会有SSN, city, st, phone, email, zip字段
                const advancedFields = ['SSN', 'city', 'st', 'phone', 'email', 'zip'];
                
                let foundAdvancedFields = 0;
                const foundFieldDetails = [];
                const fieldStatus = {};
                
                advancedFields.forEach(fieldName => {
                    fieldStatus[fieldName] = false;
                    
                    // 查找包含字段名的元素
                    const fieldLabel = Array.from(document.querySelectorAll('*')).find(el => 
                        el.textContent && el.textContent.trim() === fieldName
                    );
                    
                    if (fieldLabel) {
                        // 查找对应的输入框（通常在附近）
                        const parent = fieldLabel.closest('div');
                        if (parent && parent.querySelector('input[placeholder="请输入"]')) {
                            foundAdvancedFields++;
                            foundFieldDetails.push(fieldName);
                            fieldStatus[fieldName] = true;
                        }
                    }
                });
                
                // 如果找到至少4个高级字段，认为高级搜索已展开
                const isExpanded = foundAdvancedFields >= 4;
                
                return {
                    isExpanded: isExpanded,
                    foundFields: foundAdvancedFields,
                    totalAdvancedFields: advancedFields.length,
                    foundFieldDetails: foundFieldDetails,
                    fieldStatus: fieldStatus,
                    expansionScore: foundAdvancedFields / advancedFields.length
                };
            });
            
            console.log('[高级检测] 高级搜索状态:', {
                展开状态: result.isExpanded ? '已展开' : '未展开',
                找到字段: `${result.foundFields}/${result.totalAdvancedFields}`,
                字段详情: result.foundFieldDetails,
                扩展评分: result.expansionScore
            });
            
            return result;
            
        } catch (error) {
            console.error('[高级检测] 检查高级搜索状态失败:', error);
            return {
                isExpanded: false,
                foundFields: 0,
                error: error.message
            };
        }
    }

    /**
     * 分页设置检测 - 基于MCP测试发现的文本检测法
     */
    async checkPageSizeIs100(page) {
        try {
            console.log('[高级检测] 检查分页设置状态...');
            
            const result = await page.evaluate(() => {
                // 基于MCP测试发现的特征：查找分页选择器文本
                const pageSizeElements = Array.from(document.querySelectorAll('*')).filter(el => 
                    el.textContent && el.textContent.includes('/ 页')
                );
                
                let currentPageSize = null;
                let foundPageSizeElement = false;
                let pageSizeElementText = '';
                let allPageSizeTexts = [];
                
                pageSizeElements.forEach(el => {
                    const text = el.textContent.trim();
                    allPageSizeTexts.push(text);
                    
                    const match = text.match(/(\d+)\s*\/\s*页/);
                    if (match) {
                        currentPageSize = parseInt(match[1]);
                        foundPageSizeElement = true;
                        pageSizeElementText = text;
                    }
                });
                
                const is100PerPage = currentPageSize === 100;
                
                return {
                    is100PerPage: is100PerPage,
                    currentPageSize: currentPageSize,
                    foundPageSizeElement: foundPageSizeElement,
                    pageSizeElementsCount: pageSizeElements.length,
                    pageSizeElementText: pageSizeElementText,
                    allPageSizeTexts: allPageSizeTexts
                };
            });
            
            console.log('[高级检测] 分页设置状态:', {
                是否100每页: result.is100PerPage ? '是' : '否',
                当前设置: result.currentPageSize ? `${result.currentPageSize}/页` : '未找到',
                元素文本: result.pageSizeElementText || '无',
                所有分页文本: result.allPageSizeTexts
            });
            
            return result;
            
        } catch (error) {
            console.error('[高级检测] 检查分页设置失败:', error);
            return {
                is100PerPage: false,
                currentPageSize: null,
                error: error.message
            };
        }
    }

    /**
     * 综合页面准备状态检测 - 基于MCP测试的多重指标判断
     */
    async checkPageReadiness(page) {
        try {
            console.log('[高级检测] 开始综合页面准备状态检测...');
            
            // 并行检查多个指标
            const [dataState, advancedSearch, pageSize] = await Promise.all([
                this.getDataState(page),
                this.checkAdvancedSearchExpanded(page),
                this.checkPageSizeIs100(page)
            ]);
            
            // 综合评估页面准备状态
            const readiness = this.evaluatePageReadiness(dataState, advancedSearch, pageSize);
            
            console.log('[高级检测] 页面准备状态评估:', readiness);
            
            return readiness;
            
        } catch (error) {
            console.error('[高级检测] 综合页面准备状态检测失败:', error);
            return {
                isReady: false,
                score: 0,
                issues: ['检测过程出错'],
                error: error.message
            };
        }
    }

    /**
     * 评估页面准备状态
     */
    evaluatePageReadiness(dataState, advancedSearch, pageSize) {
        const checks = {
            hasDataCount: dataState.dataCount > 0,
            hasDataTable: dataState.hasDataTable,
            advancedExpanded: advancedSearch.isExpanded,
            pageSize100: pageSize.is100PerPage,
            hasValidContent: dataState.hasValidContent
        };
        
        // 计算准备度评分
        const weights = {
            hasDataCount: 0.3,      // 数据总数最重要
            hasDataTable: 0.2,      // 数据表格存在
            advancedExpanded: 0.25, // 高级搜索展开
            pageSize100: 0.15,      // 分页设置
            hasValidContent: 0.1    // 内容有效性
        };
        
        let score = 0;
        const issues = [];
        
        Object.entries(checks).forEach(([key, passed]) => {
            if (passed) {
                score += weights[key];
            } else {
                issues.push(this.getIssueDescription(key));
            }
        });
        
        const isReady = score >= 0.7; // 70%以上认为准备就绪
        
        return {
            isReady: isReady,
            score: Math.round(score * 100),
            checks: checks,
            issues: issues,
            details: {
                dataState: dataState,
                advancedSearch: advancedSearch,
                pageSize: pageSize
            }
        };
    }

    /**
     * 获取问题描述
     */
    getIssueDescription(checkKey) {
        const descriptions = {
            hasDataCount: '缺少数据总数显示',
            hasDataTable: '数据表格未加载',
            advancedExpanded: '高级搜索未展开',
            pageSize100: '分页设置非100/页',
            hasValidContent: '表格内容无效'
        };
        
        return descriptions[checkKey] || `未知检查项: ${checkKey}`;
    }

    /**
     * 等待查询结果完成 - 基于数据变化的高级等待法
     */
    async waitForQueryComplete(page, timeout = 15000) {
        console.log('[高级检测] 开始等待查询完成...');
        
        const startTime = Date.now();
        
        try {
            // 1. 先等待初始稳定状态
            await interruptibleDelay(1000);
            
            // 2. 使用数据变化检测等待查询完成
            const changeResult = await this.detectDataChange(page, timeout - 1000);
            
            if (changeResult.success) {
                console.log('[高级检测] ✅ 查询完成 - 检测到数据变化');
                
                // 3. 等待页面稳定
                await interruptibleDelay(500);
                
                // 4. 验证最终状态
                const finalState = await this.getDataState(page);
                
                return {
                    success: true,
                    changeType: changeResult.changeType,
                    finalState: finalState,
                    duration: Date.now() - startTime
                };
            } else {
                console.log('[高级检测] ⚠️ 查询可能未完成或无变化');
                return {
                    success: false,
                    reason: changeResult.reason,
                    duration: Date.now() - startTime
                };
            }
            
        } catch (error) {
            console.error('[高级检测] 等待查询完成失败:', error);
            return {
                success: false,
                reason: 'error',
                error: error.message,
                duration: Date.now() - startTime
            };
        }
    }

    /**
     * 等待翻页完成 - 专门用于翻页操作的等待
     */
    async waitForPageChange(page, expectedPageNumber = null, timeout = 10000) {
        console.log('[高级检测] 开始等待翻页完成...');
        
        const startTime = Date.now();
        
        try {
            // 获取翻页前状态
            const initialState = await this.getDataState(page);
            console.log('[高级检测] 翻页前状态:', {
                页码: initialState.pageNumber,
                表格行数: initialState.tableRows
            });
            
            let attempts = 0;
            while (Date.now() - startTime < timeout) {
                if (window.globalShouldStop) {
                    throw new Error('Operation cancelled');
                }
                
                attempts++;
                
                const currentState = await this.getDataState(page);
                
                // 检查页码变化
                const pageChanged = currentState.pageNumber !== initialState.pageNumber;
                
                // 检查数据变化（翻页通常不会改变总数，但会改变表格内容）
                const contentChanged = currentState.tableRows !== initialState.tableRows;
                
                if (attempts % 5 === 0) {
                    console.log(`[高级检测] 第${attempts}次翻页检查:`, {
                        页码变化: pageChanged,
                        内容变化: contentChanged,
                        当前页码: currentState.pageNumber,
                        期望页码: expectedPageNumber
                    });
                }
                
                // 翻页完成的判断条件
                if (pageChanged || contentChanged) {
                    // 如果指定了期望页码，检查是否匹配
                    if (expectedPageNumber && currentState.pageNumber !== expectedPageNumber) {
                        console.log(`[高级检测] 页码不匹配，期望${expectedPageNumber}，实际${currentState.pageNumber}`);
                        await new Promise(resolve => setTimeout(resolve, 200));
                        continue;
                    }
                    
                    console.log('[高级检测] ✅ 翻页完成');
                    return {
                        success: true,
                        fromPage: initialState.pageNumber,
                        toPage: currentState.pageNumber,
                        attempts: attempts,
                        duration: Date.now() - startTime
                    };
                }
                
                await new Promise(resolve => setTimeout(resolve, 200));
            }
            
            console.log('[高级检测] ⚠️ 翻页等待超时');
            return {
                success: false,
                reason: 'timeout',
                attempts: attempts,
                duration: Date.now() - startTime
            };
            
        } catch (error) {
            console.error('[高级检测] 等待翻页完成失败:', error);
            return {
                success: false,
                reason: 'error',
                error: error.message,
                duration: Date.now() - startTime
            };
        }
    }

    /**
     * 清理检测资源
     */
    cleanup() {
        // 清理所有超时器
        this.detectionTimeouts.forEach((timeoutId) => {
            clearTimeout(timeoutId);
        });
        this.detectionTimeouts.clear();
        
        console.log('[高级检测] 资源清理完成');
    }
}

module.exports = AdvancedDetector; 