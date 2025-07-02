/**
 * 验证无结果修复的测试工具
 * 用于确认查询无结果时能正确显示美观页面而不是空白
 */

window.testFixVerification = {
    /**
     * 模拟普通查询无结果的完整流程
     */
    async simulateStandardSearchNoResults() {
        console.log('🧪 测试普通查询无结果修复...');
        
        try {
            // 1. 清空结果区域，模拟查询前状态
            const searchResults = document.getElementById('searchResults');
            if (searchResults) {
                searchResults.innerHTML = '<div style="padding: 20px; color: #999;">等待查询结果...</div>';
            }
            
            // 2. 调用 handleSearch 中的无结果处理逻辑
            // 模拟 results.length === 0 的情况
            console.log('2️⃣ 模拟 handleSearch 中 results.length === 0 的处理');
            
            // 调用状态更新和结果显示
            if (typeof updateStatus === 'function') {
                updateStatus('未找到匹配结果，请尝试其他地址或信息');
            }
            
            // 🚨 关键测试：调用 displayResults([]) 
            if (typeof displayResults === 'function') {
                displayResults([]);
                console.log('✅ 已调用 displayResults([])');
            } else {
                console.error('❌ displayResults 函数不可用');
                return false;
            }
            
            // 3. 验证结果
            await new Promise(resolve => setTimeout(resolve, 500)); // 等待DOM更新
            
            const noResultsElement = document.querySelector('.no-results');
            const hasCorrectDisplay = !!noResultsElement;
            
            if (hasCorrectDisplay) {
                console.log('✅ 普通查询无结果修复成功！显示了美观的无结果页面');
                this.verifyNoResultsPageElements();
                return true;
            } else {
                console.error('❌ 普通查询无结果修复失败！没有显示美观页面');
                return false;
            }
            
        } catch (error) {
            console.error('❌ 测试普通查询时出错:', error);
            return false;
        }
    },
    
    /**
     * 模拟高级查询无结果的完整流程
     */
    async simulateAdvancedSearchNoResults() {
        console.log('🧪 测试高级查询无结果修复...');
        
        try {
            // 清空结果区域
            const searchResults = document.getElementById('searchResults');
            if (searchResults) {
                searchResults.innerHTML = '<div style="padding: 20px; color: #999;">等待查询结果...</div>';
            }
            
            // 模拟高级查询的无结果处理
            console.log('2️⃣ 模拟高级查询 displayResults([], true)');
            
            if (typeof displayResults === 'function') {
                displayResults([], true); // 高级查询的调用方式
                console.log('✅ 已调用 displayResults([], true)');
            } else {
                console.error('❌ displayResults 函数不可用');
                return false;
            }
            
            // 验证结果
            await new Promise(resolve => setTimeout(resolve, 500));
            
            const noResultsElement = document.querySelector('.no-results');
            const hasCorrectDisplay = !!noResultsElement;
            
            if (hasCorrectDisplay) {
                console.log('✅ 高级查询无结果处理正常！显示了美观的无结果页面');
                this.verifyNoResultsPageElements();
                return true;
            } else {
                console.error('❌ 高级查询无结果处理异常！');
                return false;
            }
            
        } catch (error) {
            console.error('❌ 测试高级查询时出错:', error);
            return false;
        }
    },
    
    /**
     * 验证无结果页面的关键元素
     */
    verifyNoResultsPageElements() {
        console.log('🔍 验证无结果页面元素...');
        
        const checks = [
            { name: '无结果页面主体', selector: '.no-results', expected: true },
            { name: '动画区域', selector: '.no-results-animation', expected: true },
            { name: '搜索图标', selector: '.no-results-icon', expected: true },
            { name: '波纹动画', selector: '.search-waves', expected: true },
            { name: '标题', selector: '.no-results-title', expected: true },
            { name: '建议列表', selector: '.no-results-suggestions', expected: true },
            { name: '提示区域', selector: '.no-results-tips', expected: true },
            // 确保旧的动画元素已清除
            { name: '骨架屏元素', selector: '.skeleton-item', expected: false },
            { name: '搜索指示器', selector: '.searching-indicator', expected: false },
            { name: '波纹容器', selector: '.ripple-container', expected: false }
        ];
        
        let allPassed = true;
        
        checks.forEach(check => {
            const element = document.querySelector(check.selector);
            const exists = !!element;
            const passed = exists === check.expected;
            
            if (passed) {
                console.log(`✅ ${check.name}: ${exists ? '存在' : '不存在'} (符合预期)`);
            } else {
                console.warn(`⚠️ ${check.name}: ${exists ? '存在' : '不存在'} (不符合预期)`);
                allPassed = false;
            }
        });
        
        // 检查文本内容
        const titleElement = document.querySelector('.no-results-title');
        if (titleElement && titleElement.textContent.includes('未找到匹配结果')) {
            console.log('✅ 标题文本正确');
        } else {
            console.warn('⚠️ 标题文本可能有问题');
            allPassed = false;
        }
        
        const suggestionsElement = document.querySelector('.no-results-suggestions');
        if (suggestionsElement && suggestionsElement.children.length >= 4) {
            console.log('✅ 建议列表包含足够的项目');
        } else {
            console.warn('⚠️ 建议列表项目不足');
            allPassed = false;
        }
        
        return allPassed;
    },
    
    /**
     * 运行完整的修复验证测试
     */
    async runFullVerification() {
        console.log('🚀 开始完整的无结果修复验证测试...');
        console.log('================================================');
        
        let allTestsPassed = true;
        
        // 测试1：普通查询无结果
        console.log('\n📋 测试1：普通查询无结果处理');
        const standardTestResult = await this.simulateStandardSearchNoResults();
        if (!standardTestResult) {
            allTestsPassed = false;
        }
        
        // 等待一秒后进行下一个测试
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // 测试2：高级查询无结果  
        console.log('\n📋 测试2：高级查询无结果处理');
        const advancedTestResult = await this.simulateAdvancedSearchNoResults();
        if (!advancedTestResult) {
            allTestsPassed = false;
        }
        
        // 最终报告
        console.log('\n================================================');
        if (allTestsPassed) {
            console.log('🎉 所有测试通过！无结果修复工作正常');
            console.log('💡 现在无论是普通查询还是高级查询，当无结果时都会显示美观的引导页面');
            console.log('🔧 修复前：查询无结果 → 空白页面 + 动画卡住');
            console.log('✨ 修复后：查询无结果 → 美观引导页面 + 动画正确清除');
        } else {
            console.log('❌ 部分测试失败，需要检查修复代码');
        }
        
        return allTestsPassed;
    },
    
    /**
     * 快速测试 - 一键验证修复效果
     */
    quickTest() {
        console.log('⚡ 快速测试无结果修复效果...');
        this.simulateStandardSearchNoResults();
    }
};

// 添加快捷方式
window.verifyFix = window.testFixVerification.runFullVerification.bind(window.testFixVerification);
window.quickTestFix = window.testFixVerification.quickTest.bind(window.testFixVerification);

console.log('🛠️ 无结果修复验证工具已加载');
console.log('📞 使用方式:');
console.log('  verifyFix() - 运行完整验证测试');
console.log('  quickTestFix() - 快速测试修复效果');
console.log('  testFixVerification.simulateStandardSearchNoResults() - 测试普通查询');
console.log('  testFixVerification.simulateAdvancedSearchNoResults() - 测试高级查询'); 