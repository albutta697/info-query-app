/**
 * 紧急重置功能 - 用于查询卡住时的快速恢复
 * 可以通过浏览器控制台调用
 */

window.emergencyReset = {
    /**
     * 立即停止所有查询并重置界面
     */
    async stopAllQueries() {
        console.log('🚨 执行紧急重置...');
        
        try {
            // 1. 设置全局停止标志
            window.globalShouldStop = true;
            
            // 2. 清除所有搜索动画
            this.clearAllAnimations();
            
            // 3. 重置查询状态
            this.resetQueryStatus();
            
            // 4. 重置按钮状态
            this.resetButtonStates();
            
            // 5. 清除页面级取消信号
            if (typeof setPageLevelCancelSignal === 'function') {
                await setPageLevelCancelSignal(false);
            }
            
            // 6. 重置浏览器状态（如果可用）
            if (window.browserManager) {
                try {
                    await this.resetBrowserState();
                } catch (error) {
                    console.warn('重置浏览器状态失败:', error);
                }
            }
            
            console.log('✅ 紧急重置完成');
            return { success: true, message: '所有查询已停止，界面已重置' };
            
        } catch (error) {
            console.error('❌ 紧急重置失败:', error);
            return { success: false, error: error.message };
        }
    },

    /**
     * 清除所有搜索动画
     */
    clearAllAnimations() {
        console.log('清除所有动画...');
        
        // 清除骨架屏
        document.querySelectorAll('.skeleton-item').forEach(item => item.remove());
        
        // 清除搜索指示器
        const searchingIndicator = document.querySelector('.searching-indicator');
        if (searchingIndicator) searchingIndicator.remove();
        
        // 清除波纹容器
        const rippleContainer = document.querySelector('.ripple-container');
        if (rippleContainer) rippleContainer.remove();
        
        // 清除数据处理动画
        const dataProcessing = document.querySelector('.data-processing-container');
        if (dataProcessing) dataProcessing.remove();
        
        // 清除进度图标
        document.querySelectorAll('.progress-icon').forEach(icon => icon.remove());
        
        // 移除进度条动画类
        const progressBars = document.querySelectorAll('.progress-bar');
        progressBars.forEach(bar => {
            bar.classList.remove('animated');
            bar.style.width = '0%';
            bar.parentElement.style.display = 'none';
        });
    },

    /**
     * 重置查询状态
     */
    resetQueryStatus() {
        console.log('重置查询状态...');
        
        // 重置全局变量
        if (typeof isQuerying !== 'undefined') {
            window.isQuerying = false;
        }
        
        if (typeof searchCompleted !== 'undefined') {
            window.searchCompleted = false;
        }
        
        // 重置浏览器管理器查询状态
        if (window.browserManager && window.browserManager.setQueryingStatus) {
            window.browserManager.setQueryingStatus(false);
        }
        
        // 更新状态文本
        if (typeof updateStatus === 'function') {
            updateStatus('查询已重置');
        }
        
        if (typeof updateAdvancedStatus === 'function') {
            updateAdvancedStatus('查询已重置');
        }
        
        // 重置进度
        if (typeof updateProgress === 'function') {
            updateProgress(0);
        }
        
        if (typeof updateAdvancedProgress === 'function') {
            updateAdvancedProgress(0);
        }
    },

    /**
     * 重置按钮状态
     */
    resetButtonStates() {
        console.log('重置按钮状态...');
        
        // 重置快速查询按钮
        const quickSearch = document.getElementById('quickSearch');
        if (quickSearch) {
            quickSearch.textContent = '开始查询';
            quickSearch.classList.remove('cancel-mode');
            quickSearch.disabled = false;
        }
        
        // 重置高级查询按钮
        const advancedSearch = document.getElementById('advancedSearch');
        if (advancedSearch) {
            advancedSearch.textContent = '开始查询';
            advancedSearch.classList.remove('cancel-mode');
            advancedSearch.disabled = false;
        }
        
        // 重置其他相关按钮
        const clearData = document.getElementById('clearData');
        if (clearData) {
            clearData.disabled = false;
        }
    },

    /**
     * 重置浏览器状态
     */
    async resetBrowserState() {
        console.log('重置浏览器状态...');
        
        if (!window.browserManager) {
            console.warn('browserManager 不可用');
            return;
        }
        
        try {
            // 尝试重置主页面
            if (window.browserManager.mainPage && !window.browserManager.mainPage.isClosed()) {
                await window.browserManager.mainPage.goto(
                    window.browserManager.config.BASE_URL, 
                    { 
                        waitUntil: 'domcontentloaded', 
                        timeout: 5000 
                    }
                ).catch(err => {
                    console.warn('页面导航失败，尝试刷新:', err);
                    return window.browserManager.mainPage.reload({ 
                        waitUntil: 'domcontentloaded', 
                        timeout: 5000 
                    });
                });
            }
            
            console.log('浏览器状态已重置');
        } catch (error) {
            console.error('重置浏览器状态失败:', error);
            throw error;
        }
    },

    /**
     * 诊断当前查询状态
     */
    diagnoseCurrentState() {
        console.log('🔍 诊断当前查询状态...');
        
        const diagnosis = {
            timestamp: new Date().toISOString(),
            globalShouldStop: window.globalShouldStop,
            isQuerying: window.isQuerying,
            searchCompleted: window.searchCompleted,
            activeButtons: {},
            activeAnimations: {},
            browserManager: {
                available: !!window.browserManager,
                querying: window.browserManager?.isQuerying || false,
                mainPageClosed: window.browserManager?.mainPage?.isClosed() || 'unknown'
            }
        };
        
        // 检查按钮状态
        const quickSearch = document.getElementById('quickSearch');
        if (quickSearch) {
            diagnosis.activeButtons.quickSearch = {
                text: quickSearch.textContent,
                disabled: quickSearch.disabled,
                classList: Array.from(quickSearch.classList)
            };
        }
        
        const advancedSearch = document.getElementById('advancedSearch');
        if (advancedSearch) {
            diagnosis.activeButtons.advancedSearch = {
                text: advancedSearch.textContent,
                disabled: advancedSearch.disabled,
                classList: Array.from(advancedSearch.classList)
            };
        }
        
        // 检查动画元素
        diagnosis.activeAnimations = {
            skeletonItems: document.querySelectorAll('.skeleton-item').length,
            searchingIndicator: !!document.querySelector('.searching-indicator'),
            rippleContainer: !!document.querySelector('.ripple-container'),
            dataProcessing: !!document.querySelector('.data-processing-container'),
            progressIcons: document.querySelectorAll('.progress-icon').length
        };
        
        console.table(diagnosis);
        return diagnosis;
    },

    /**
     * 快速修复建议
     */
    getQuickFixes() {
        const fixes = [
            {
                name: '立即停止查询',
                action: 'emergencyReset.stopAllQueries()',
                description: '停止所有查询并重置界面'
            },
            {
                name: '诊断状态',
                action: 'emergencyReset.diagnoseCurrentState()',
                description: '检查当前查询和界面状态'
            },
            {
                name: '刷新页面',
                action: 'location.reload()',
                description: '强制刷新整个页面（最后手段）'
            },
            {
                name: '重启浏览器进程',
                action: 'browserManager.restartBrowser()',
                description: '重启浏览器进程（需要浏览器管理器）'
            }
        ];
        
        console.log('🛠️ 可用的快速修复方案：');
        fixes.forEach((fix, index) => {
            console.log(`${index + 1}. ${fix.name}`);
            console.log(`   操作: ${fix.action}`);
            console.log(`   说明: ${fix.description}\n`);
        });
        
        return fixes;
    }
};

// 自动诊断（仅在控制台中）
if (typeof window !== 'undefined' && window.console) {
    console.log('🚨 紧急重置工具已加载');
    console.log('💡 如果查询卡住，请在控制台输入: emergencyReset.stopAllQueries()');
    console.log('🔍 查看可用修复方案: emergencyReset.getQuickFixes()');
} 