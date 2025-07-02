/**
 * 无结果页面预览工具
 * 用于展示和测试美观的无结果页面设计
 */

window.previewNoResults = {
    /**
     * 直接预览无结果页面设计
     */
    showPreview() {
        console.log('🎨 显示无结果页面预览...');
        
        try {
            // 获取结果容器
            const searchResults = document.getElementById('searchResults');
            if (!searchResults) {
                console.error('找不到搜索结果容器');
                return;
            }
            
            // 清除搜索动画（如果有的话）
            if (typeof clearSearchAnimations === 'function') {
                clearSearchAnimations();
            }
            
            // 清空容器
            searchResults.innerHTML = '';
            
            // 调用 displayResults 函数显示无结果页面
            if (typeof displayResults === 'function') {
                displayResults([]); // 传入空数组触发无结果页面
            } else {
                // 如果函数不可用，直接创建HTML
                this.createNoResultsPageDirectly(searchResults);
            }
            
            console.log('✅ 无结果页面预览已显示');
            
            // 提供交互提示
            setTimeout(() => {
                console.log('💡 提示: 您现在可以看到美观的无结果页面设计！');
                console.log('🔧 包含的功能:');
                console.log('   • 🔍 动画搜索图标');
                console.log('   • 🌊 波纹扩散效果');
                console.log('   • 📝 实用的查询建议');
                console.log('   • 💡 友好的提示信息');
                console.log('   • ✨ 渐变背景和阴影');
                console.log('   • 🎭 流畅的入场动画');
            }, 1000);
            
        } catch (error) {
            console.error('❌ 显示预览时出错:', error);
        }
    },

    /**
     * 直接创建无结果页面（备用方法）
     */
    createNoResultsPageDirectly(container) {
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
        container.appendChild(noResultsDiv);
        
        // 更新统计信息
        const resultCountElement = document.getElementById('resultCount');
        if (resultCountElement) {
            resultCountElement.textContent = '0';
        }
        
        const resultStatsElement = document.getElementById('resultStats');
        if (resultStatsElement) {
            resultStatsElement.style.display = 'flex';
        }
    },

    /**
     * 分析无结果页面的设计元素
     */
    analyzeDesign() {
        console.log('🔍 分析无结果页面设计元素...');
        
        const elements = [
            {
                name: '主容器',
                selector: '.no-results',
                features: ['渐变背景', '圆角边框', '阴影效果', '入场动画']
            },
            {
                name: '动画区域',
                selector: '.no-results-animation',
                features: ['搜索图标', '弹跳动画', '波纹效果']
            },
            {
                name: '波纹动画',
                selector: '.search-waves .wave',
                features: ['3层波纹', '扩散效果', '渐进延迟']
            },
            {
                name: '内容区域',
                selector: '.no-results-content',
                features: ['分层结构', '渐进显示', '清晰层次']
            },
            {
                name: '建议列表',
                selector: '.no-results-suggestions li',
                features: ['逐项动画', '实用建议', '视觉引导']
            },
            {
                name: '提示区域',
                selector: '.no-results-tips',
                features: ['高亮背景', '图标提示', '延迟显示']
            }
        ];
        
        const analysis = elements.map(element => {
            const domElements = document.querySelectorAll(element.selector);
            return {
                ...element,
                count: domElements.length,
                exists: domElements.length > 0,
                status: domElements.length > 0 ? '✅ 存在' : '❌ 缺失'
            };
        });
        
        console.log('📊 设计元素分析结果:');
        console.table(analysis);
        
        // 统计设计完整性
        const existingElements = analysis.filter(el => el.exists).length;
        const totalElements = analysis.length;
        const completeness = (existingElements / totalElements * 100).toFixed(1);
        
        console.log(`\n🎯 设计完整性: ${existingElements}/${totalElements} (${completeness}%)`);
        
        if (completeness >= 80) {
            console.log('🎉 设计元素完整，无结果页面效果很好！');
        } else {
            console.log('⚠️ 部分设计元素缺失，可能影响用户体验');
        }
        
        return {
            elements: analysis,
            completeness: parseFloat(completeness),
            summary: `设计完整性 ${completeness}%`
        };
    },

    /**
     * 展示设计特色
     */
    showDesignFeatures() {
        console.log('✨ 美观无结果页面的设计特色:');
        
        const features = [
            {
                icon: '🎨',
                title: '视觉设计',
                items: [
                    '渐变背景效果',
                    '柔和阴影投射',
                    '圆角现代风格',
                    '层次分明布局'
                ]
            },
            {
                icon: '🎭',
                title: '动画效果',
                items: [
                    '入场淡入上移',
                    '搜索图标弹跳',
                    '波纹扩散动画',
                    '建议逐项显示'
                ]
            },
            {
                icon: '📝',
                title: '内容设计',
                items: [
                    '清晰的状态说明',
                    '实用的操作建议',
                    '友好的提示信息',
                    '视觉化的引导'
                ]
            },
            {
                icon: '🚀',
                title: '用户体验',
                items: [
                    '明确的反馈信息',
                    '降低用户困惑',
                    '提供解决方案',
                    '保持视觉一致性'
                ]
            }
        ];
        
        features.forEach(feature => {
            console.log(`\n${feature.icon} ${feature.title}:`);
            feature.items.forEach(item => {
                console.log(`   • ${item}`);
            });
        });
        
        console.log('\n🎯 与用户反馈的对比:');
        console.log('   用户期望: "没结果不应该弄个好看的页面吗没结果提示"');
        console.log('   现在效果: ✅ 美观的无结果页面，包含动画和实用建议');
        console.log('   改进程度: 从空白区域 → 视觉丰富的引导页面');
    },

    /**
     * 快速测试无结果页面
     */
    quickTest() {
        console.log('⚡ 快速测试无结果页面...');
        
        // 显示预览
        this.showPreview();
        
        // 等待2秒后分析
        setTimeout(() => {
            const analysis = this.analyzeDesign();
            
            // 等待1秒后显示特色
            setTimeout(() => {
                this.showDesignFeatures();
                
                console.log('\n🎉 快速测试完成！');
                console.log('💡 您现在可以在右侧看到美观的无结果页面设计');
            }, 1000);
        }, 2000);
    }
};

// 自动加载提示
if (typeof window !== 'undefined' && window.console) {
    console.log('🎨 无结果页面预览工具已加载');
    console.log('💡 可用命令:');
    console.log('   previewNoResults.showPreview() - 显示无结果页面预览');
    console.log('   previewNoResults.analyzeDesign() - 分析设计元素');
    console.log('   previewNoResults.showDesignFeatures() - 展示设计特色');
    console.log('   previewNoResults.quickTest() - 快速测试全流程');
} 