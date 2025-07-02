/**
 * 测试无结果时动画清理的修复
 * 用于验证查询没有结果时动画是否正确停止
 */

window.testNoResultsFix = {
    /**
     * 模拟无结果查询流程
     */
    async simulateNoResultsQuery() {
        console.log('🧪 开始测试无结果查询流程...');
        
        try {
            // 1. 模拟开始查询（显示动画）
            console.log('1️⃣ 模拟显示查询动画');
            if (typeof showSearchingAnimation === 'function') {
                showSearchingAnimation();
            } else {
                console.warn('showSearchingAnimation 函数不可用');
            }
            
            // 等待2秒模拟查询过程
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            // 2. 模拟查询完成但无结果
            console.log('2️⃣ 模拟查询完成，无结果');
            if (typeof displayResults === 'function') {
                displayResults([]); // 传入空数组模拟无结果
            } else {
                console.warn('displayResults 函数不可用');
            }
            
            // 3. 验证动画是否已清除
            setTimeout(() => {
                this.verifyAnimationsCleared();
            }, 500);
            
            console.log('✅ 无结果查询流程测试完成');
            
        } catch (error) {
            console.error('❌ 测试过程中出错:', error);
        }
    },

    /**
     * 验证动画是否已清除
     */
    verifyAnimationsCleared() {
        console.log('🔍 验证动画清理状态...');
        
        const checks = [
            { name: '骨架屏元素', selector: '.skeleton-item' },
            { name: '搜索指示器', selector: '.searching-indicator' },
            { name: '波纹容器', selector: '.ripple-container' },
            { name: '数据处理动画', selector: '.data-processing-container' },
            { name: '进度图标', selector: '.progress-icon' }
        ];
        
        let allClear = true;
        const results = [];
        
        checks.forEach(check => {
            const elements = document.querySelectorAll(check.selector);
            const isCleared = elements.length === 0;
            
            results.push({
                name: check.name,
                selector: check.selector,
                count: elements.length,
                cleared: isCleared
            });
            
            if (!isCleared) {
                allClear = false;
                console.warn(`⚠️ ${check.name} 未完全清除，还有 ${elements.length} 个元素`);
            } else {
                console.log(`✅ ${check.name} 已清除`);
            }
        });
        
        // 检查无结果页面是否显示
        const noResultsElement = document.querySelector('.no-results');
        const hasNoResultsPage = !!noResultsElement;
        
        // 检查无结果页面的关键元素
        const noResultsChecks = [
            { name: '无结果页面主体', selector: '.no-results' },
            { name: '动画区域', selector: '.no-results-animation' },
            { name: '搜索图标', selector: '.no-results-icon' },
            { name: '波纹动画', selector: '.search-waves' },
            { name: '内容区域', selector: '.no-results-content' },
            { name: '标题', selector: '.no-results-title' },
            { name: '建议列表', selector: '.no-results-suggestions' },
            { name: '提示区域', selector: '.no-results-tips' }
        ];
        
        let noResultsScore = 0;
        noResultsChecks.forEach(check => {
            const element = document.querySelector(check.selector);
            const exists = !!element;
            
            results.push({
                name: check.name,
                selector: check.selector,
                count: exists ? 1 : 0,
                cleared: false, // 这些应该存在
                expected: true,
                status: exists ? '✅' : '❌'
            });
            
            if (exists) {
                noResultsScore++;
                console.log(`✅ ${check.name} 正确显示`);
            } else {
                console.warn(`⚠️ ${check.name} 未显示`);
            }
        });
        
        const noResultsComplete = noResultsScore === noResultsChecks.length;
        if (!noResultsComplete) {
            allClear = false;
        }
        
        // 生成报告
        console.log('\n📊 动画清理验证报告:');
        console.table(results);
        
        console.log(`\n🎯 无结果页面完整性: ${noResultsScore}/${noResultsChecks.length}`);
        
        if (allClear && noResultsComplete) {
            console.log('🎉 所有检查通过！动画清理和美观无结果页面显示正常');
            console.log('✨ 无结果页面包含：动画、波纹效果、建议列表、提示区域');
        } else {
            console.log('❌ 存在问题，请检查上述警告');
            if (!allClear) console.log('   - 动画清理不完整');
            if (!noResultsComplete) console.log('   - 无结果页面元素缺失');
        }
        
        return {
            success: allClear && noResultsComplete,
            results: results,
            noResultsScore: `${noResultsScore}/${noResultsChecks.length}`,
            summary: `动画清理${allClear ? '成功' : '失败'}，无结果页面${noResultsComplete ? '完整' : '不完整'}`
        };
    },

    /**
     * 检查当前动画状态
     */
    checkCurrentAnimationState() {
        console.log('🔍 检查当前动画状态...');
        
        const state = {
            searching: {
                skeletonItems: document.querySelectorAll('.skeleton-item').length,
                searchingIndicator: !!document.querySelector('.searching-indicator'),
                rippleContainer: !!document.querySelector('.ripple-container'),
                dataProcessing: !!document.querySelector('.data-processing-container'),
                progressIcons: document.querySelectorAll('.progress-icon').length
            },
            results: {
                noResultsPage: !!document.querySelector('.no-results'),
                resultItems: document.querySelectorAll('.result-item').length,
                resultCount: document.getElementById('resultCount')?.textContent || 'N/A'
            },
            status: {
                isQuerying: window.isQuerying,
                globalShouldStop: window.globalShouldStop,
                quickSearchText: document.getElementById('quickSearch')?.textContent || 'N/A',
                advancedSearchText: document.getElementById('advancedSearch')?.textContent || 'N/A'
            }
        };
        
        console.log('当前动画状态:', state);
        return state;
    },

    /**
     * 手动清理所有动画（紧急情况使用）
     */
    forceCleanAnimations() {
        console.log('🚨 强制清理所有动画...');
        
        if (typeof clearSearchAnimations === 'function') {
            clearSearchAnimations();
            console.log('✅ 已调用 clearSearchAnimations()');
        } else {
            console.warn('clearSearchAnimations 函数不可用，执行手动清理');
            
            // 手动清理
            document.querySelectorAll('.skeleton-item, .searching-indicator, .ripple-container, .data-processing-container, .progress-icon').forEach(el => el.remove());
            
            const progressBars = document.querySelectorAll('.progress-bar');
            progressBars.forEach(bar => {
                bar.classList.remove('animated');
                bar.style.width = '0%';
                bar.parentElement.style.display = 'none';
            });
            
            console.log('✅ 手动清理完成');
        }
        
        // 验证清理结果
        setTimeout(() => {
            this.verifyAnimationsCleared();
        }, 100);
    }
};

// 自动加载提示
if (typeof window !== 'undefined' && window.console) {
    console.log('🧪 无结果修复测试工具已加载');
    console.log('💡 可用命令:');
    console.log('   testNoResultsFix.simulateNoResultsQuery() - 模拟无结果查询');
    console.log('   testNoResultsFix.checkCurrentAnimationState() - 检查当前状态');
    console.log('   testNoResultsFix.forceCleanAnimations() - 强制清理动画');
} 